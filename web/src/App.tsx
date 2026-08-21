import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchStatus } from './types';
import {
  games,
  matches as allMatches,
  teams as allTeams,
  teamById,
  gameById,
  eventKeyOf,
  eventStageKeyOf,
  eventByKey,
  eventStageByKey,
  matchTeamIds,
  dateKeyOf,
  todayKey,
  gameStyle,
  UNLABELED_STAGE,
} from './data';
import { TeamLogo } from './components/TeamLogo';
import { TeamPicker } from './components/TeamPicker';
import { EventPicker } from './components/EventPicker';
import { Timeline } from './components/Timeline';

type SortOrder = 'desc' | 'asc';

const STATUS_OPTIONS: { value: MatchStatus; label: string }[] = [
  { value: 'live', label: '进行中' },
  { value: 'upcoming', label: '未开始' },
  { value: 'finished', label: '已结束' },
  { value: 'canceled', label: '已取消' },
];

/** 用户筛选偏好的本地持久化：跨访问保留「游戏 / 状态 / 战队 / 赛事 / 排序」选择 */
const STORAGE_KEY = 'esports-filters-v1';
const ALL_STATUSES: MatchStatus[] = ['live', 'upcoming', 'finished', 'canceled'];

interface SavedFilters {
  games: string[];
  statuses: MatchStatus[];
  teams: string[];
  /** 赛事筛选 key：整赛（`game::event`）或阶段（`game::event::stage`） */
  events: string[];
  sort: SortOrder;
}

/** 读取并校验持久化的筛选偏好；数据随 CI 更新会增删战队/游戏/赛事，失效 id 直接丢弃 */
function loadSavedFilters(): SavedFilters {
  const empty: SavedFilters = { games: [], statuses: [], teams: [], events: [], sort: 'desc' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<SavedFilters> | null;
    if (!p || typeof p !== 'object') return empty;
    const gameIds = new Set(games.map((g) => g.id));
    const teamIds = new Set(allTeams.map((t) => t.id));
    const eventIds = new Set<string>([...eventByKey.keys(), ...eventStageByKey.keys()]);
    return {
      games: Array.isArray(p.games)
        ? p.games.filter((x): x is string => typeof x === 'string' && gameIds.has(x))
        : [],
      statuses: Array.isArray(p.statuses)
        ? p.statuses.filter((x): x is MatchStatus => typeof x === 'string' && (ALL_STATUSES as string[]).includes(x))
        : [],
      teams: Array.isArray(p.teams)
        ? p.teams.filter((x): x is string => typeof x === 'string' && teamIds.has(x))
        : [],
      events: Array.isArray(p.events)
        ? p.events.filter((x): x is string => typeof x === 'string' && eventIds.has(x))
        : [],
      sort: p.sort === 'asc' ? 'asc' : 'desc',
    };
  } catch {
    return empty; // 隐私模式 / JSON 损坏等：静默降级为默认
  }
}

/** 多选切换：已含则移除，未含则加入 */
function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

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
  // 惰性读取一次持久化的筛选偏好，作为各筛选状态的初始值
  const [savedFilters] = useState(loadSavedFilters);
  const [selectedGameIds, setSelectedGameIds] = useState<string[]>(savedFilters.games);
  const [selectedStatuses, setSelectedStatuses] = useState<MatchStatus[]>(savedFilters.statuses);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>(savedFilters.teams);
  const [selectedEventKeys, setSelectedEventKeys] = useState<string[]>(savedFilters.events);
  const [sortOrder, setSortOrder] = useState<SortOrder>(savedFilters.sort);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [visibleMonths, setVisibleMonths] = useState(INITIAL_MONTHS);

  // 筛选或排序方向变化后，浏览窗口重置回初始 3 个月
  const filterSignature = `${selectedGameIds.join(',')}|${selectedStatuses.join(',')}|${sortOrder}|${selectedTeamIds.join(',')}|${selectedEventKeys.join(',')}`;
  const [lastSignature, setLastSignature] = useState(filterSignature);
  if (filterSignature !== lastSignature) {
    setLastSignature(filterSignature);
    setVisibleMonths(INITIAL_MONTHS);
  }

  // 筛选偏好持久化：任何变化即写回 localStorage（空数组=全部，同样如实保存）
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          games: selectedGameIds,
          statuses: selectedStatuses,
          teams: selectedTeamIds,
          events: selectedEventKeys,
          sort: sortOrder,
        } satisfies SavedFilters),
      );
    } catch {
      /* 存储不可用（隐私模式等）时静默忽略，不影响当次功能 */
    }
  }, [selectedGameIds, selectedStatuses, selectedTeamIds, selectedEventKeys, sortOrder]);

  const filtered = useMemo(() => {
    const list = allMatches.filter((m) => {
      if (selectedGameIds.length > 0 && !selectedGameIds.includes(m.gameId)) return false;
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(m.status)) return false;
      // 赛事筛选：整赛 key 命中=该赛事全部比赛；否则看阶段 key（小组赛/季后赛/淘汰赛…）
      if (selectedEventKeys.length > 0) {
        if (!selectedEventKeys.includes(eventKeyOf(m.gameId, m.eventName))) {
          if (!selectedEventKeys.includes(eventStageKeyOf(m.gameId, m.eventName, m.stage))) {
            return false;
          }
        }
      }
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
  }, [selectedGameIds, selectedStatuses, selectedTeamIds, selectedEventKeys, sortOrder]);

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

  // 滚动超过一屏的一小段后，sticky 筛选栏进入紧凑态（省出垂直空间），
  // 回到顶部还原。passive 监听；值不变时 React 自动 bail out，无重渲染开销。
  const [filterCompact, setFilterCompact] = useState(false);
  useEffect(() => {
    const onScroll = () => setFilterCompact(window.scrollY > 140);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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

  /** 赛事筛选条目数（阶段细分按所属赛事去重后计数，用于按钮徽标） */
  const selectedEventCount = useMemo(() => {
    const s = new Set<string>();
    for (const k of selectedEventKeys) s.add(eventStageByKey.get(k)?.eventKey ?? k);
    return s.size;
  }, [selectedEventKeys]);

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
        {/* 页头说明：桌面端直接展示；移动端折叠为可展开的一行提示，节省首屏空间 */}
        <p className="brand-note">
          同名战队按所属游戏区分：BLG / JDG / NOVA / Q9 / TEC / WBG 等名字在不同游戏中是完全不同的战队
        </p>
        <details className="brand-note collapsed">
          <summary>ℹ️ 同名战队按所属游戏区分，点击展开详情</summary>
          <p>BLG / JDG / NOVA / Q9 / TEC / WBG 等名字在不同游戏中是完全不同的战队</p>
        </details>
      </header>

      <div className={`filter-bar${filterCompact ? ' compact' : ''}`}>
        <div className="filter-row">
          <div className="seg" role="group" aria-label="游戏筛选（可多选）">
            <button
              className={`seg-item ${selectedGameIds.length === 0 ? 'active' : ''}`}
              onClick={() => setSelectedGameIds([])}
            >
              全部游戏
            </button>
            {games.map((g) => {
              const on = selectedGameIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  className={`seg-item ${on ? 'active' : ''}`}
                  style={on ? gameStyle(g.color) : undefined}
                  aria-pressed={on}
                  onClick={() => setSelectedGameIds((prev) => toggleIn(prev, g.id))}
                >
                  <span className="seg-dot" style={{ background: g.color }} />
                  {g.name}
                </button>
              );
            })}
          </div>

          <div className="seg" role="group" aria-label="状态筛选（可多选）">
            <button
              className={`seg-item ${selectedStatuses.length === 0 ? 'active' : ''}`}
              onClick={() => setSelectedStatuses([])}
            >
              全部状态
            </button>
            {STATUS_OPTIONS.map((o) => {
              const on = selectedStatuses.includes(o.value);
              return (
                <button
                  key={o.value}
                  className={`seg-item ${on ? 'active' : ''}`}
                  aria-pressed={on}
                  onClick={() => setSelectedStatuses((prev) => toggleIn(prev, o.value))}
                >
                  {o.label}
                </button>
              );
            })}
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
          <button className="btn primary" onClick={() => setEventPickerOpen(true)}>
            🏟️ 筛选赛事{selectedEventCount > 0 ? `（${selectedEventCount}）` : ''}
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
            {selectedEventKeys.map((key) => {
              const stage = eventStageByKey.get(key);
              const ev = eventByKey.get(stage ? stage.eventKey : key);
              if (!ev) return null;
              const game = gameById.get(ev.gameId);
              return (
                <span key={key} className="chip event-chip" style={gameStyle(game?.color)}>
                  <span className="chip-name">
                    {ev.eventName}
                    {stage ? ` · ${stage.stage || UNLABELED_STAGE}` : ' · 全部阶段'}
                  </span>
                  <span className="chip-game">{game?.name}</span>
                  <button
                    className="chip-x"
                    onClick={() => setSelectedEventKeys((prev) => prev.filter((k) => k !== key))}
                    aria-label={`移除 ${ev.eventName}${stage ? ` ${stage.stage}` : ''} 筛选`}
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
          {selectedGameIds.length > 0 && (
            <>
              {' '}· 游戏：{selectedGameIds.map((id) => gameById.get(id)?.name ?? id).join(' / ')}
            </>
          )}
          {selectedStatuses.length > 0 && (
            <>
              {' '}· 状态：
              {selectedStatuses
                .map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s)
                .join(' / ')}
            </>
          )}
          {selectedTeamIds.length > 0 && <> · 按已选 {selectedTeamIds.length} 支战队筛选</>}
          {selectedEventCount > 0 && (
            <>
              {' '}· 赛事：{selectedEventCount} 项
              {selectedEventKeys.some((k) => eventStageByKey.has(k))
                ? `（含阶段细分，如小组赛 / 季后赛 / 淘汰赛）`
                : ''}
            </>
          )}
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
        CS 赛事（event.5eplay.com，HLTV 数据镜像）·
        战队身份按「游戏 + 队伍」唯一标识
      </footer>

      <TeamPicker
        open={pickerOpen}
        selected={selectedTeamIds}
        onToggle={toggleTeam}
        onClear={() => setSelectedTeamIds([])}
        onClose={() => setPickerOpen(false)}
      />

      <EventPicker
        open={eventPickerOpen}
        selected={selectedEventKeys}
        onChange={setSelectedEventKeys}
        onClear={() => setSelectedEventKeys([])}
        onClose={() => setEventPickerOpen(false)}
      />
    </div>
  );
}
