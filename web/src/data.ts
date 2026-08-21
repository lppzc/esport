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

/* ---------------- 赛事（event）派生数据 ---------------- */

/** 未标注 stage 的比赛在筛选面板中的展示名 */
export const UNLABELED_STAGE = '未标注阶段';

export interface EventStageInfo {
  /** `${gameId}::${eventName}::${stage}`，stage 为空串表示未标注阶段 */
  key: string;
  /** 所属赛事 key */
  eventKey: string;
  stage: string;
  count: number;
}

export interface EventInfo {
  /** `${gameId}::${eventName}`（eventName 两端空白已归一） */
  key: string;
  gameId: string;
  eventName: string;
  matchCount: number;
  /** 阶段按首次出现（开赛时间升序）排列 */
  stages: EventStageInfo[];
  /** 最早 / 最晚一场开赛时间（ISO），赛事列表按最新比赛倒序排列 */
  firstTime: string;
  lastTime: string;
}

/**
 * 赛事 key：`游戏ID::赛事名`。赛事名做 trim 归一——
 * 爬虫数据里存在「无畏契约进化者杯系列赛 第一幕  」与「… 第一幕」
 * 这类仅差尾随空格的写法，trim 后合并为同一赛事。
 */
export function eventKeyOf(gameId: string, eventName: string): string {
  return `${gameId}::${eventName.trim()}`;
}

/** 阶段筛选 key：`游戏ID::赛事名::阶段` */
export function eventStageKeyOf(gameId: string, eventName: string, stage: string): string {
  return `${gameId}::${eventName.trim()}::${stage}`;
}

function buildEvents(): EventInfo[] {
  const byKey = new Map<string, EventInfo>();
  // 按开赛时间升序遍历：stages 自然获得时间顺序（小组赛 → 淘汰赛 → 决赛）
  const sorted = [...matches].sort((a, b) => a.startTime.localeCompare(b.startTime));
  for (const m of sorted) {
    const key = eventKeyOf(m.gameId, m.eventName);
    let ev = byKey.get(key);
    if (!ev) {
      ev = {
        key,
        gameId: m.gameId,
        eventName: m.eventName.trim(),
        matchCount: 0,
        stages: [],
        firstTime: m.startTime,
        lastTime: m.startTime,
      };
      byKey.set(key, ev);
    }
    ev.matchCount += 1;
    if (m.startTime < ev.firstTime) ev.firstTime = m.startTime;
    if (m.startTime > ev.lastTime) ev.lastTime = m.startTime;
    let st = ev.stages.find((s) => s.stage === m.stage);
    if (!st) {
      st = { key: eventStageKeyOf(m.gameId, m.eventName, m.stage), eventKey: key, stage: m.stage, count: 0 };
      ev.stages.push(st);
    }
    st.count += 1;
  }
  // 最新赛事排前面（用户最关心的通常是进行中/临近的赛事）
  return [...byKey.values()].sort((a, b) => b.lastTime.localeCompare(a.lastTime));
}

/** 全部赛事（按所属游戏分组时直接 filter 即可） */
export const events: EventInfo[] = buildEvents();

export const eventByKey = new Map(events.map((e) => [e.key, e]));

export const eventStageByKey: Map<string, EventStageInfo> = new Map(
  events.flatMap((e) => e.stages.map((s) => [s.key, s] as const)),
);

/** 整赛 key + 其全部阶段 key，用于整体勾选/取消时一次性增删 */
export function eventFilterKeysOf(ev: EventInfo): string[] {
  return [ev.key, ...ev.stages.map((s) => s.key)];
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
