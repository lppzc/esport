/**
 * 数据合并层：把一次爬取的「最新快照」合并进「持久化存储」，实现增量更新。
 *
 * 核心策略（对应需求）：
 *   1. 新数据中存在的记录 → 用新数据覆盖（未开始/进行中比赛的赛程变化、比分、
 *      状态流转都会正常更新）；
 *   2. 存储中有、新数据中没有的记录 → 保留不删（官网下架的历史比赛仍可查看），
 *      并且仅当该记录所属的赛事/赛季本次确实被爬过时，才标记
 *      `missing_from_source: true`（说明官网已无此条目，而非本次没爬到）；
 *   3. 战队/赛事取并集，字段以新数据为准；战队的参赛赛事 id 取并集。
 *
 * 存储文件与爬虫输出同 schema（vct_data.json / dfpl_data.json），
 * 额外在 meta 里记录合并历史，在记录上最多追加 missing_from_source /
 * missing_since 两个标记字段。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..');
export const storeDir = join(root, 'data_store');

export const storePaths = {
  vct: join(storeDir, 'vct_data.json'),
  dfpl: join(storeDir, 'dfpl_data.json'),
};

export const snapshotPaths = {
  vct: join(root, 'snapshots', 'vct', 'vct_data.json'),
  dfpl: join(root, 'snapshots', 'dfpl', 'dfpl_data.json'),
};

/** 原始爬虫快照目录（初始化存储的基线来源） */
const baselinePaths = {
  vct: join(root, 'output', 'vct_data.json'),
  dfpl: join(root, 'dfpl_output', 'dfpl_data.json'),
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ------------------------------------------------------------------ */
/* VCT                                                                 */
/* ------------------------------------------------------------------ */

/**
 * @param {object} store   已有合并存储（vct_data.json 结构）
 * @param {object} fresh   本次爬取快照（可为部分事件的子集）
 * @param {Set<number>} crawledEventIds 本次真实抓取成功的赛事 id
 * @param {string} now     ISO 时间
 */
export function mergeVct(store, fresh, crawledEventIds, now) {
  const stats = { added: 0, updated: 0, keptMissing: 0, keptUntouched: 0 };

  /* --- 赛事：并集，新数据优先 --- */
  const evFresh = new Map(fresh.events.map((e) => [e.event_id, e]));
  const events = new Map(store.events.map((e) => [e.event_id, e]));
  for (const [id, fe] of evFresh) events.set(id, fe);
  const eventList = [...events.values()];

  /* --- 战队：并集，新数据优先；event_ids 取并集 --- */
  const teams = new Map(store.teams.map((t) => [t.team_id, t]));
  for (const ft of fresh.teams) {
    const st = teams.get(ft.team_id);
    if (st) {
      ft.event_ids = [...new Set([...(st.event_ids || []), ...(ft.event_ids || [])])];
    }
    teams.set(ft.team_id, ft);
  }

  /* --- 比赛：新数据覆盖；存量保留（按所属赛事是否被爬过打标） --- */
  const mFresh = new Map(fresh.matches.map((m) => [m.match_id, m]));
  const matches = [];
  const seen = new Set();
  for (const sm of store.matches) {
    const fm = mFresh.get(sm.match_id);
    if (fm) {
      matches.push(fm);
      seen.add(fm.match_id);
      stats.updated++;
      continue;
    }
    if (crawledEventIds.has(sm.event_id)) {
      // 该赛事本次爬过却没这条比赛 → 官网已下架，保留并打标
      if (!sm.missing_from_source) {
        sm.missing_from_source = true;
        sm.missing_since = now;
      }
      stats.keptMissing++;
    } else {
      stats.keptUntouched++; // 本次未爬该赛事，无法判断，原样保留
    }
    matches.push(sm);
  }
  for (const fm of fresh.matches) {
    if (!seen.has(fm.match_id)) {
      matches.push(fm);
      stats.added++;
    }
  }
  matches.sort((a, b) => (a.match_date || '').localeCompare(b.match_date || ''));

  /* --- 重算赛事计数（快照只含子集时 count 不准） --- */
  for (const e of eventList) {
    e.match_count = matches.reduce((n, m) => n + (m.event_id === e.event_id ? 1 : 0), 0);
    e.teams_count = [...teams.values()].reduce(
      (n, t) => n + ((t.event_ids || []).includes(e.event_id) ? 1 : 0), 0
    );
  }

  /* --- 选手：由合并后的战队名单重建 --- */
  const players = [];
  for (const t of teams.values()) players.push(...(t.players || []));

  const merged = {
    meta: mergeMeta(store.meta, fresh.meta, now, stats, [...crawledEventIds]),
    events: eventList,
    teams: [...teams.values()],
    players,
    matches,
  };
  return { data: merged, stats };
}

/* ------------------------------------------------------------------ */
/* DFPL                                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {object} store
 * @param {object} fresh
 * @param {Set<string>} crawledSeasonIds 本次真实抓取成功的赛季 id
 * @param {string} now
 */
export function mergeDfpl(store, fresh, crawledSeasonIds, now) {
  const stats = { added: 0, updated: 0, keptMissing: 0, keptUntouched: 0 };

  /* 赛季：并集，新数据优先 */
  const seasons = new Map(store.seasons.map((s) => [s.season_id, s]));
  for (const [id, fs] of new Map(fresh.seasons.map((s) => [s.season_id, s]))) {
    seasons.set(id, fs);
  }

  /* 战队：并集，新数据优先 */
  const teams = new Map(store.teams.map((t) => [t.team_id, t]));
  for (const ft of fresh.teams) teams.set(ft.team_id, ft);

  /* 赛程：新数据覆盖；存量保留 */
  const sFresh = new Map(fresh.schedules.map((s) => [s.schedule_id, s]));
  const schedules = [];
  const seen = new Set();
  for (const ss of store.schedules) {
    const fs = sFresh.get(ss.schedule_id);
    if (fs) {
      schedules.push(fs);
      seen.add(fs.schedule_id);
      stats.updated++;
      continue;
    }
    if (crawledSeasonIds.has(ss.season_id)) {
      if (!ss.missing_from_source) {
        ss.missing_from_source = true;
        ss.missing_since = now;
      }
      stats.keptMissing++;
    } else {
      stats.keptUntouched++;
    }
    schedules.push(ss);
  }
  for (const fs of fresh.schedules) {
    if (!seen.has(fs.schedule_id)) {
      schedules.push(fs);
      stats.added++;
    }
  }
  schedules.sort((a, b) => String(a.start_timestamp || '').localeCompare(String(b.start_timestamp || '')));

  const merged = {
    meta: mergeMeta(store.meta, fresh.meta, now, stats, [...crawledSeasonIds]),
    seasons: [...seasons.values()],
    teams: [...teams.values()],
    players: store.players || [],
    schedules,
  };
  return { data: merged, stats };
}

/* ------------------------------------------------------------------ */
/* 公共                                                                */
/* ------------------------------------------------------------------ */

function mergeMeta(storeMeta, freshMeta, now, stats, crawledIds) {
  const history = [
    ...((storeMeta && storeMeta.merge_history) || []),
    {
      at: now,
      crawled_ids: crawledIds,
      matches_added: stats.added,
      matches_updated: stats.updated,
      matches_kept_missing: stats.keptMissing,
    },
  ].slice(-50); // 只保留最近 50 次合并记录
  return {
    ...(storeMeta || {}),
    source_page: freshMeta.source_page,
    api_base: freshMeta.api_base,
    fetched_at: freshMeta.fetched_at,
    merged_at: now,
    merge_history: history,
  };
}

/** 存储不存在时，用原始爬虫快照初始化基线 */
export function ensureStore() {
  mkdirSync(storeDir, { recursive: true });
  const inited = [];
  for (const game of ['vct', 'dfpl']) {
    if (existsSync(storePaths[game])) continue;
    const base = baselinePaths[game];
    if (!existsSync(base)) continue;
    const data = readJson(base);
    data.meta = {
      ...data.meta,
      merged_at: data.meta?.fetched_at || new Date().toISOString(),
      merge_history: [],
      init: { from: base, at: new Date().toISOString(), note: '由原始爬虫快照初始化基线' },
    };
    writeFileSync(storePaths[game], JSON.stringify(data));
    inited.push(game);
  }
  return inited;
}

export function loadStore(game) {
  return readJson(storePaths[game]);
}

export function saveStore(game, data) {
  writeFileSync(storePaths[game], JSON.stringify(data));
}

export function loadSnapshot(game) {
  return existsSync(snapshotPaths[game]) ? readJson(snapshotPaths[game]) : null;
}

export function hasStore(game) {
  return existsSync(storePaths[game]);
}
