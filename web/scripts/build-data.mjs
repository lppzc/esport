/**
 * 数据归一化脚本：将两份爬虫数据（DFPL / VCT）合并为统一的 esports.json。
 *
 * 核心设计：战队全局唯一 ID 采用 `游戏前缀:原始ID` 格式，
 * 因此不同游戏中同名（甚至同 logo）的战队天然是两个不同实体。
 *   - 无畏契约战队：`vct:<team_id>`（如 vct:21 = BLG）
 *   - 三角洲行动战队：`dfpl:<club_id>`（如 dfpl:blg = BLG，与上面的 BLG 完全无关）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const dfpl = JSON.parse(readFileSync(join(root, 'dfpl_output', 'dfpl_data.json'), 'utf8'));
const vct = JSON.parse(readFileSync(join(root, 'output', 'vct_data.json'), 'utf8'));

const games = [
  { id: 'vct', name: '无畏契约', sub: 'VALORANT · VCT', color: '#ff4655' },
  { id: 'dfpl', name: '三角洲行动', sub: 'DF 烽火职业联赛', color: '#f5a623' },
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
console.log(`战队: ${teams.length} 支（VCT ${vct.teams.length} + DFPL ${clubBest.size}）`);
console.log(`比赛: ${matches.length} 场`, byGame);
console.log(`跨游戏/跨记录同名战队(${dupNames.length}个): ${dupNames.join(', ')}`);
const refIds = new Set();
for (const m of matches) {
  if (m.kind === 'duel') { refIds.add(m.teamAId); refIds.add(m.teamBId); }
  else m.teamIds.forEach((id) => refIds.add(id));
}
console.log(`被比赛引用的战队: ${refIds.size} 支`);
