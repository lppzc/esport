import type { CSSProperties } from 'react';
import raw from './data/esports.json';
import type { EsportsData, Game, Team, Match } from './types';

export const data = raw as unknown as EsportsData;

export const games: Game[] = data.games;
export const teams: Team[] = data.teams;
export const matches: Match[] = data.matches;

export const gameById = new Map(games.map((g) => [g.id, g]));
export const teamById = new Map(teams.map((t) => [t.id, t]));

/** 比赛的参赛战队 id 列表 */
export function matchTeamIds(match: Match): string[] {
  return match.kind === 'duel' ? [match.teamAId, match.teamBId] : match.teamIds;
}

/** 每支战队参加的比赛场次 */
export const matchCountByTeamId: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const t of teams) m.set(t.id, 0);
  for (const match of matches) {
    for (const id of matchTeamIds(match)) m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
})();

/** 游戏主题色注入为 CSS 变量 --gc */
export function gameStyle(color?: string): CSSProperties {
  return (color ? { '--gc': color } : {}) as CSSProperties;
}

/* ---------------- 时间工具（统一按北京时间展示） ---------------- */

const dtfKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dtfLabel = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});
const dtfTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO 时间 → 北京时区日期 key（yyyy-MM-dd），用于时间轴按日分组 */
export function dateKeyOf(iso: string): string {
  return dtfKey.format(new Date(iso));
}

export function todayKey(): string {
  return dtfKey.format(new Date());
}

export function formatDateLabel(iso: string): string {
  return dtfLabel.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return dtfTime.format(new Date(iso));
}
