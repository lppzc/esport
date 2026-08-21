/**
 * 增量更新编排（合并部分）：把 snapshots/ 下的最新爬取快照合并进
 * data_store/ 持久存储。前端数据重建由调用方串联（见 update.ps1 / CI）：
 *
 *   python vct_crawler.py  --out-dir snapshots/vct
 *   python dfpl_crawler.py --all-seasons --out-dir snapshots/dfpl
 *   python cs_crawler.py   --out-dir snapshots/cs
 *   node scripts/update.mjs
 *   node web/scripts/build-data.mjs      # 从 data_store 优先读取，重建 esports.json
 *
 * 合并规则（见 merge-data.mjs）：
 *   - 新快照中存在的比赛整条覆盖（比分/状态/名次随之刷新）
 *   - 存储有而新快照没有的保留（官网下架的历史比赛不丢）
 *   - 本次确实爬过该赛事/赛季却缺失的，标记 missing_from_source
 */
import { mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  root, snapshotPaths,
  ensureStore, loadStore, saveStore, loadSnapshot,
  mergeVct, mergeDfpl, mergeCs,
} from './merge-data.mjs';

const now = new Date().toISOString();

/* ---------- 1. 初始化存储（首次运行时从基线快照建立） ---------- */
const inited = ensureStore();
if (inited.length) console.log(`[init] 初始化存储: ${inited.join(', ')}（基线 = 原始爬虫输出）`);

/* ---------- 2. VCT 合并 ---------- */
const vctSnap = loadSnapshot('vct');
if (vctSnap) {
  // 本次真实爬到的赛事：快照 events 即成功列表，meta.failed_events 里是失败的
  const failed = new Set((vctSnap.meta.failed_events || []).map((f) => f.event_id));
  const crawled = new Set(vctSnap.events.map((e) => e.event_id).filter((id) => !failed.has(id)));
  const { data, stats } = mergeVct(loadStore('vct'), vctSnap, crawled, now);
  saveStore('vct', data);
  console.log(
    `[vct] 新增 ${stats.added} / 更新 ${stats.updated} / 官网缺失保留 ${stats.keptMissing} / 未爬赛事保留 ${stats.keptUntouched}`
  );
} else {
  console.log('[vct] 无新快照，跳过合并');
}

/* ---------- 3. DFPL 合并 ---------- */
const dfplSnap = loadSnapshot('dfpl');
if (dfplSnap) {
  const crawled = new Set(dfplSnap.meta.season_ids || []);
  const { data, stats } = mergeDfpl(loadStore('dfpl'), dfplSnap, crawled, now);
  saveStore('dfpl', data);
  console.log(
    `[dfpl] 新增 ${stats.added} / 更新 ${stats.updated} / 官网缺失保留 ${stats.keptMissing} / 未爬赛季保留 ${stats.keptUntouched}`
  );
} else {
  console.log('[dfpl] 无新快照，跳过合并');
}

/* ---------- 4. CS 合并 ---------- */
const csSnap = loadSnapshot('cs');
if (csSnap) {
  // 本次真实爬到的赛事：快照 events 即成功列表（CS 爬虫单次全量抓取，无 failed 概念）
  const crawled = new Set(csSnap.events.map((e) => e.event_id));
  const { data, stats } = mergeCs(loadStore('cs'), csSnap, crawled, now);
  saveStore('cs', data);
  console.log(
    `[cs] 新增 ${stats.added} / 更新 ${stats.updated} / 官网缺失保留 ${stats.keptMissing} / 未爬赛事保留 ${stats.keptUntouched}`
  );
} else {
  console.log('[cs] 无新快照，跳过合并');
}

/* ---------- 5. 快照归档（保留最近一次，便于排查） ---------- */
if (vctSnap || dfplSnap || csSnap) {
  const archiveDir = join(root, 'snapshots', 'archive');
  mkdirSync(archiveDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, '-').slice(0, 19);
  for (const game of ['vct', 'dfpl', 'cs']) {
    if (existsSync(snapshotPaths[game])) {
      copyFileSync(snapshotPaths[game], join(archiveDir, `${game}_${stamp}.json`));
    }
  }
  console.log('[archive] 快照已归档到 snapshots/archive/');
}

console.log('✔ 合并完成（下一步: node web/scripts/build-data.mjs 重建前端数据）');
