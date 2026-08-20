import { useMemo } from 'react';
import type { Match } from '../types';
import { gameById, dateKeyOf, todayKey, formatDateLabel } from '../data';
import { MatchCard } from './MatchCard';

interface DayGroup {
  key: string;
  label: string;
  matches: Match[];
  gameIds: Set<string>;
  isToday: boolean;
  isFuture: boolean;
}

function buildGroups(list: Match[]): DayGroup[] {
  const map = new Map<string, Match[]>();
  for (const m of list) {
    const k = dateKeyOf(m.startTime);
    const arr = map.get(k);
    if (arr) arr.push(m);
    else map.set(k, [m]);
  }
  const tk = todayKey();
  return [...map.entries()].map(([key, ms]) => ({
    key,
    label: formatDateLabel(ms[0].startTime),
    matches: ms,
    gameIds: new Set(ms.map((m) => m.gameId)),
    isToday: key === tk,
    isFuture: key > tk,
  }));
}

/** 垂直时间轴：按日期分组展示比赛 */
export function Timeline({ matches }: { matches: Match[] }) {
  const groups = useMemo(() => buildGroups(matches), [matches]);

  if (groups.length === 0) {
    return (
      <div className="timeline empty-state">
        <div className="empty-icon">🎮</div>
        <p>没有符合条件的比赛</p>
        <p className="empty-hint">试试调整游戏、状态筛选，或清除战队筛选</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {groups.map((g) => (
        <section
          className={`day-group ${g.isToday ? 'today' : ''} ${g.isFuture ? 'future' : ''}`}
          key={g.key}
          id={`day-${g.key}`}
        >
          <div className="day-marker">
            <span className="day-dot" />
          </div>
          <div className="day-content">
            <header className="day-header">
              <h3 className="day-date">{g.label}</h3>
              {g.isToday && <span className="today-badge">今天</span>}
              <span className="day-meta">
                {g.matches.length} 场
                {[...g.gameIds].map((gid) => gameById.get(gid)?.name).filter(Boolean).join(' / ')}
              </span>
            </header>
            <div className="day-cards">
              {g.matches.map((m) => (
                <MatchCard key={m.id} match={m} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
