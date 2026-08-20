import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchStatus } from './types';
import {
  games,
  matches as allMatches,
  teams as allTeams,
  teamById,
  gameById,
  matchTeamIds,
  dateKeyOf,
  todayKey,
  gameStyle,
} from './data';
import { TeamLogo } from './components/TeamLogo';
import { TeamPicker } from './components/TeamPicker';
import { Timeline } from './components/Timeline';

type GameFilter = string; // 'all' | gameId
type StatusFilter = 'all' | MatchStatus;
type SortOrder = 'desc' | 'asc';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'live', label: '进行中' },
  { value: 'upcoming', label: '未开始' },
  { value: 'finished', label: '已结束' },
];

/** 浏览限制：初始只加载时间轴起点起 3 个月内的赛程 */
const INITIAL_MONTHS = 3;
/** 每次滚动到底部后继续扩展的月数 */
const CHUNK_MONTHS = 3;

/** 日期 d 偏移 n 个月后的时间戳 */
function shiftMonths(d: Date, n: number): number {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + n);
  return r.getTime();
}

function scrollToTodayOrNearest(keys: string[]) {
  if (keys.length === 0) return;
  const tk = todayKey();
  const sorted = [...keys].sort();
  const target = sorted.find((k) => k >= tk) ?? sorted[sorted.length - 1];
  const el = document.getElementById(`day-${target}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function App() {
  const [gameFilter, setGameFilter] = useState<GameFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [visibleMonths, setVisibleMonths] = useState(INITIAL_MONTHS);

  // 筛选或排序方向变化后，浏览窗口重置回初始 3 个月
  const filterSignature = `${gameFilter}|${statusFilter}|${sortOrder}|${selectedTeamIds.join(',')}`;
  const [lastSignature, setLastSignature] = useState(filterSignature);
  if (filterSignature !== lastSignature) {
    setLastSignature(filterSignature);
    setVisibleMonths(INITIAL_MONTHS);
  }

  const filtered = useMemo(() => {
    const list = allMatches.filter((m) => {
      if (gameFilter !== 'all' && m.gameId !== gameFilter) return false;
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (selectedTeamIds.length > 0) {
        const ids = matchTeamIds(m);
        if (!selectedTeamIds.some((t) => ids.includes(t))) return false;
      }
      return true;
    });
    list.sort((a, b) =>
      sortOrder === 'desc'
        ? b.startTime.localeCompare(a.startTime)
        : a.startTime.localeCompare(b.startTime)
    );
    return list;
  }, [gameFilter, statusFilter, selectedTeamIds, sortOrder]);

  /**
   * 浏览限制：从排序后列表的起点（desc=最新一场，asc=最旧一场）开始，
   * 仅展示 visibleMonths 个月内的比赛，其余等滚动到底部再加载
   */
  const visible = useMemo(() => {
    if (filtered.length === 0) return filtered;
    const anchor = new Date(filtered[0].startTime);
    const boundary = shiftMonths(anchor, sortOrder === 'desc' ? -visibleMonths : visibleMonths);
    return filtered.filter((m) => {
      const t = new Date(m.startTime).getTime();
      return sortOrder === 'desc' ? t >= boundary : t <= boundary;
    });
  }, [filtered, visibleMonths, sortOrder]);

  const hasMore = visible.length < filtered.length;

  // 哨兵元素接近视口时自动加载下一段赛程
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleMonths((v) => v + CHUNK_MONTHS);
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, visibleMonths, visible.length, filtered.length]);

  const toggleTeam = (id: string) => {
    setSelectedTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const dayKeys = useMemo(() => {
    const s = new Set<string>();
    for (const m of visible) s.add(dateKeyOf(m.startTime));
    return [...s];
  }, [visible]);

  return (
    <div className="app">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">⚡</span>
          <div>
            <h1>电竞赛程 · Esports Timeline</h1>
            <p className="brand-sub">
              {games.length} 个游戏 · {allTeams.length} 支战队 · {allMatches.length} 场比赛
            </p>
          </div>
        </div>
        <p className="brand-note">
          同名战队按所属游戏区分：BLG / JDG / NOVA / Q9 / TEC / WBG 等名字在不同游戏中是完全不同的战队
        </p>
      </header>

      <div className="filter-bar">
        <div className="filter-row">
          <div className="seg" role="tablist" aria-label="游戏筛选">
            <button
              className={`seg-item ${gameFilter === 'all' ? 'active' : ''}`}
              onClick={() => setGameFilter('all')}
            >
              全部游戏
            </button>
            {games.map((g) => (
              <button
                key={g.id}
                className={`seg-item ${gameFilter === g.id ? 'active' : ''}`}
                style={gameFilter === g.id ? gameStyle(g.color) : undefined}
                onClick={() => setGameFilter(g.id)}
              >
                <span className="seg-dot" style={{ background: g.color }} />
                {g.name}
              </button>
            ))}
          </div>

          <div className="seg" role="tablist" aria-label="状态筛选">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`seg-item ${statusFilter === o.value ? 'active' : ''}`}
                onClick={() => setStatusFilter(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="filter-actions">
            <button
              className="btn ghost"
              onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
              title="切换时间轴方向"
            >
              {sortOrder === 'desc' ? '↓ 新→旧' : '↑ 旧→新'}
            </button>
            <button className="btn ghost" onClick={() => scrollToTodayOrNearest(dayKeys)}>
              定位今天
            </button>
          </div>
        </div>

        <div className="filter-row team-row">
          <button className="btn primary" onClick={() => setPickerOpen(true)}>
            🏆 筛选战队{selectedTeamIds.length > 0 ? `（${selectedTeamIds.length}）` : ''}
          </button>
          <div className="chips">
            {selectedTeamIds.map((id) => {
              const t = teamById.get(id);
              const game = t ? gameById.get(t.gameId) : undefined;
              if (!t) return null;
              return (
                <span key={id} className="chip" style={gameStyle(game?.color)}>
                  <TeamLogo team={t} size={20} />
                  <span className="chip-name">{t.name}</span>
                  <span className="chip-game">{game?.name}</span>
                  <button
                    className="chip-x"
                    onClick={() => toggleTeam(id)}
                    aria-label={`移除 ${t.name}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <main>
        <div className="result-meta">
          共 <b>{filtered.length}</b> 场比赛
          {hasMore && (
            <>
              {' '}· 已加载 <b>{visible.length}</b> 场（近 {visibleMonths} 个月）
            </>
          )}
          {selectedTeamIds.length > 0 && <> · 按已选 {selectedTeamIds.length} 支战队筛选</>}
        </div>
        <Timeline matches={visible} />
        {hasMore ? (
          <div className="load-more" ref={sentinelRef}>
            <button
              className="btn ghost"
              onClick={() => setVisibleMonths((v) => v + CHUNK_MONTHS)}
            >
              ↓ 加载{sortOrder === 'desc' ? '更早' : '更晚'}的赛程（{CHUNK_MONTHS} 个月）
            </button>
            <span className="load-more-hint">继续下滑会自动加载之后的比赛</span>
          </div>
        ) : (
          filtered.length > 0 && (
            <div className="load-more end">
              <span className="load-more-hint">已加载全部赛程</span>
            </div>
          )
        )}
      </main>

      <footer className="site-footer">
        数据来源：VCT 无畏契约赛事（vct.qq.com）· DF 烽火职业联赛（df.qq.com）·
        战队身份按「游戏 + 队伍」唯一标识
      </footer>

      <TeamPicker
        open={pickerOpen}
        selected={selectedTeamIds}
        onToggle={toggleTeam}
        onClear={() => setSelectedTeamIds([])}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
