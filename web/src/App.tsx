import { useMemo, useState } from 'react';
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

  const toggleTeam = (id: string) => {
    setSelectedTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const dayKeys = useMemo(() => {
    const s = new Set<string>();
    for (const m of filtered) s.add(dateKeyOf(m.startTime));
    return [...s];
  }, [filtered]);

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
          {selectedTeamIds.length > 0 && <> · 按已选 {selectedTeamIds.length} 支战队筛选</>}
        </div>
        <Timeline matches={filtered} />
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
