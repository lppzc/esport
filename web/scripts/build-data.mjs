/**
 * 数据归一化脚本：将三份爬虫数据（DFPL / VCT / CS）合并为统一的 esports.json。
 *
 * 核心设计：战队全局唯一 ID 采用 `游戏前缀:原始ID` 格式，
 * 因此不同游戏中同名（甚至同 logo）的战队天然是两个不同实体。
 *   - 无畏契约战队：`vct:<team_id>`（如 vct:21 = BLG）
 *   - 三角洲行动战队：`dfpl:<club_id>`（如 dfpl:blg = BLG，与上面的 BLG 完全无关）
 *   - 反恐精英战队：`cs:<team_id>`（如 cs:hltv_team_13924，5EPlay 为 HLTV 数据镜像）
 *
 * 数据来源优先级：增量合并存储 data_store/（含历史保留的比赛，比分最新）
 * > 原始爬虫输出 output/ 与 dfpl_output/（首次基线）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/** 按优先级取第一个存在的数据文件 */
function pickSource(candidates, label) {
  for (const p of candidates) {
    if (existsSync(p)) return { path: p, data: JSON.parse(readFileSync(p, 'utf8')) };
  }
  throw new Error(`找不到 ${label} 数据文件: ${candidates.join(' 或 ')}`);
}

const vctSrc = pickSource([
  join(root, 'data_store', 'vct_data.json'),
  join(root, 'output', 'vct_data.json'),
], 'VCT');
const dfplSrc = pickSource([
  join(root, 'data_store', 'dfpl_data.json'),
  join(root, 'dfpl_output', 'dfpl_data.json'),
], 'DFPL');
const csSrc = pickSource([
  join(root, 'data_store', 'cs_data.json'),
  join(root, 'cs_output', 'cs_data.json'),
], 'CS');
const vct = vctSrc.data;
const dfpl = dfplSrc.data;
const cs = csSrc.data;
console.log(`数据源: VCT <- ${vctSrc.path}`);
console.log(`数据源: DFPL <- ${dfplSrc.path}`);
console.log(`数据源: CS <- ${csSrc.path}`);

const games = [
  { id: 'vct', name: '无畏契约', sub: 'VALORANT · VCT', color: '#ff4655' },
  { id: 'dfpl', name: '三角洲行动', sub: 'DF 烽火职业联赛', color: '#f5a623' },
  { id: 'cs', name: '反恐精英', sub: 'Counter-Strike · HLTV', color: '#38bdf8' },
];

/* ---------------- 战队 ---------------- */
const teams = [];

// 无畏契约：每条 team 记录即一支战队（注意：VCT 内部就存在两个不同的 NOVA，id 不同）
for (const t of vct.teams) {
  const name = t.short_name || t.sp_name || t.full_name || `队伍${t.team_id}`;
  teams.push({
    id: `vct:${t.team_id}`,
    gameId: 'vct',
    name,
    fullName: t.full_name && t.full_name !== name ? t.full_name : '',
    logo: t.dark_logo || t.light_logo || '',
  });
}

// 三角洲行动：同一俱乐部在 S1/S2 赛季各有一条记录（名字、logo 相同），
// 按 club_id 合并为一个战队实体，取最新赛季的名称与 logo。
const seasonOrder = new Map(dfpl.seasons.map((s, i) => [s.season_id, i]));
const clubBest = new Map();
for (const t of dfpl.teams) {
  if (t.club_id === 'dd') continue; // “待定”占位队伍，不是真实战队
  const cur = clubBest.get(t.club_id);
  if (!cur || (seasonOrder.get(t.season_id) ?? 0) > (seasonOrder.get(cur.season_id) ?? 0)) {
    clubBest.set(t.club_id, t);
  }
}
for (const [club, t] of clubBest) {
  teams.push({
    id: `dfpl:${club}`,
    gameId: 'dfpl',
    name: t.name_zh || t.name_en || club,
    fullName: t.name_en && t.name_en !== t.name_zh ? t.name_en : '',
    logo: t.logo_url || '',
  });
}

// 反恐精英：5EPlay（HLTV 数据镜像），每条 team 记录即一支战队；
// 同一战队可能存在 hltv_team_* 与 csgo_tm_* 两套 id，按 team_id 原样保留。
for (const t of cs.teams) {
  if (!t.name) continue;
  teams.push({
    id: `cs:${t.team_id}`,
    gameId: 'cs',
    name: t.name,
    fullName: '',
    logo: t.logo || '',
  });
}

const teamIdSet = new Set(teams.map((t) => t.id));

/* ---------------- 比赛 ---------------- */
const matches = [];

// 无畏契约：标准 A/B 对阵
const vctStatus = { 1: 'upcoming', 2: 'live', 3: 'finished' };
for (const m of vct.matches) {
  const a = m.team_a?.team_id;
  const b = m.team_b?.team_id;
  if (!a || !b || !m.team_a?.name || !m.team_b?.name) continue; // 队伍未公布
  const idA = `vct:${a}`;
  const idB = `vct:${b}`;
  if (!teamIdSet.has(idA) || !teamIdSet.has(idB)) continue;
  matches.push({
    id: `vct:${m.match_id}`,
    gameId: 'vct',
    kind: 'duel',
    startTime: m.match_date,
    status: vctStatus[m.status_id] || 'upcoming',
    eventName: m.event_name || '',
    stage: m.match_type || '',
    subStage: [m.group_name, m.progress].filter(Boolean).join(' · '),
    format: m.match_format || '',
    teamAId: idA,
    teamBId: idB,
    scoreA: m.score_a ?? 0,
    scoreB: m.score_b ?? 0,
  });
}

// 三角洲行动：多队同场积分赛（每场 6 队，名次由 result_team_ids 顺序给出）
const dfplStatus = { 1: 'upcoming', 2: 'canceled', 3: 'live', 4: 'finished' };
const scheduleTeamToClub = new Map();
for (const t of dfpl.teams) {
  if (t.club_id === 'dd') continue;
  scheduleTeamToClub.set(t.team_id, `dfpl:${t.club_id}`);
}
const seasonName = new Map(dfpl.seasons.map((s) => [s.season_id, s.season_name]));
for (const s of dfpl.schedules) {
  const ids = (s.team_ids || []).map((id) => scheduleTeamToClub.get(id)).filter(Boolean);
  if (ids.length < 2) continue; // 队伍未公布或均为待定
  matches.push({
    id: `dfpl:${s.schedule_id}`,
    gameId: 'dfpl',
    kind: 'multi',
    startTime: s.start_time,
    status: dfplStatus[s.status_id] || 'upcoming',
    eventName: `${seasonName.get(s.season_id) || ''} ${s.stage_name}`.trim(),
    stage: s.round_name || s.stage_name || '',
    subStage: [s.group_name, `第${s.week_num}周`].filter(Boolean).join(' · '),
    format: s.bo_total ? `BO${s.bo_total}` : '',
    teamIds: ids,
    ranking: (s.result_team_ids || []).map((id) => scheduleTeamToClub.get(id)).filter(Boolean),
  });
}

// 反恐精英：标准 A/B 对阵（状态枚举与 VCT 相同：1未开始/2进行中/3已结束）
const csStatus = { 1: 'upcoming', 2: 'live', 3: 'finished' };
for (const m of cs.matches) {
  const a = m.team_a?.team_id;
  const b = m.team_b?.team_id;
  if (!a || !b || !m.team_a?.name || !m.team_b?.name) continue; // 队伍未公布
  const idA = `cs:${a}`;
  const idB = `cs:${b}`;
  if (!teamIdSet.has(idA) || !teamIdSet.has(idB)) continue;
  matches.push({
    id: `cs:${m.match_id}`,
    gameId: 'cs',
    kind: 'duel',
    startTime: m.match_date,
    status: csStatus[m.status_id] || 'upcoming',
    eventName: m.event_name || '',
    stage: m.stage || '',
    subStage: m.round_name || '',
    format: m.match_format || '',
    teamAId: idA,
    teamBId: idB,
    scoreA: m.score_a ?? 0,
    scoreB: m.score_b ?? 0,
  });
}

matches.sort((a, b) => a.startTime.localeCompare(b.startTime));

/* ---------------- 输出 ---------------- */
const out = {
  generatedAt: new Date().toISOString(),
  games,
  teams,
  matches,
};
const outDir = join(here, '..', 'src', 'data');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'esports.json'), JSON.stringify(out));

// 统计报告
const byGame = {};
for (const m of matches) byGame[m.gameId] = (byGame[m.gameId] || 0) + 1;
const nameCounts = {};
for (const t of teams) nameCounts[t.name.toLowerCase()] = (nameCounts[t.name.toLowerCase()] || 0) + 1;
const dupNames = Object.entries(nameCounts).filter(([, c]) => c > 1).map(([n]) => n);
console.log('=== 数据生成完成 ===');
console.log(`战队: ${teams.length} 支（VCT ${vct.teams.length} + DFPL ${clubBest.size} + CS ${cs.teams.length}）`);
console.log(`比赛: ${matches.length} 场`, byGame);
console.log(`跨游戏/跨记录同名战队(${dupNames.length}个): ${dupNames.join(', ')}`);
const refIds = new Set();
for (const m of matches) {
  if (m.kind === 'duel') { refIds.add(m.teamAId); refIds.add(m.teamBId); }
  else m.teamIds.forEach((id) => refIds.add(id));
}
console.log(`被比赛引用的战队: ${refIds.size} 支`);
