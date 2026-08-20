export interface Game {
  id: string;
  name: string;
  sub: string;
  color: string;
}

export interface Team {
  /** 全局唯一 ID：`游戏前缀:原始ID`，如 vct:21 / dfpl:blg */
  id: string;
  gameId: string;
  name: string;
  fullName: string;
  logo: string;
}

export type MatchStatus = 'finished' | 'live' | 'upcoming' | 'canceled';

interface MatchBase {
  id: string;
  gameId: string;
  startTime: string;
  status: MatchStatus;
  eventName: string;
  stage: string;
  subStage: string;
  format: string;
}

/** 无畏契约等：A/B 两队对阵 */
export interface DuelMatch extends MatchBase {
  kind: 'duel';
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
}

/** 三角洲行动等：多队同场积分赛 */
export interface MultiMatch extends MatchBase {
  kind: 'multi';
  teamIds: string[];
  /** 按名次排序的战队 id（第一名在前），仅已结束时有意义 */
  ranking: string[];
}

export type Match = DuelMatch | MultiMatch;

export interface EsportsData {
  generatedAt: string;
  games: Game[];
  teams: Team[];
  matches: Match[];
}
