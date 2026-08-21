import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
import type { Game, Team } from '../types';
import { games, teams, matchCountByTeamId, gameStyle } from '../data';
import { TeamLogo } from './TeamLogo';
import { useBodyScrollLock, useEscapeKey } from '../hooks';

/**
 * 性能要点：
 * 1. 排序器只创建一次——每次按键重新执行带区域参数的 localeCompare 排序是卡顿主因；
 * 2. 各游戏战队列表在模块加载时排好序，搜索时只做线性过滤（过滤保序，无需重新排序）；
 * 3. 单个战队条目用 memo 隔离，配合稳定的 onToggle 回调（App 侧 useCallback），
 *    输入搜索词时绝大部分条目跳过重渲染。
 */
const zhCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

const groupsAll = games.map((game) => ({
  game,
  list: teams
    .filter((t) => t.gameId === game.id)
    .sort((a, b) => zhCollator.compare(a.name, b.name)),
}));

interface PickerItemProps {
  team: Team;
  game: Game;
  matches: number;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

/** 单个战队条目（memo：props 不变则跳过渲染） */
const PickerItem = memo(function PickerItem({
  team, game, matches, isSelected, onToggle,
}: PickerItemProps) {
  return (
    <button
      className={`picker-item ${isSelected ? 'selected' : ''}`}
      style={gameStyle(game.color)}
      onClick={() => onToggle(team.id)}
      title={team.fullName ? `${team.fullName}（${game.name}）` : `${team.name}（${game.name}）`}
    >
      <TeamLogo team={team} size={30} />
      <span className="pi-main">
        <span className="pi-name">{team.name}</span>
        {team.fullName && <span className="pi-full">{team.fullName}</span>}
      </span>
      <span className="pi-meta">
        <span className="pi-game" style={gameStyle(game.color)}>{game.name}</span>
        <span className="pi-matches">{matches} 场</span>
      </span>
      <span className={`pi-check ${isSelected ? 'on' : ''}`}>{isSelected ? '✓' : ''}</span>
    </button>
  );
});

interface Props {
  open: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * 战队筛选面板：按游戏分组展示所有战队。
 * 不同游戏中同名（甚至同 logo）的战队会作为不同条目并列出现，
 * 通过游戏徽章与所属游戏分组明确区分——例如 BLG 在“无畏契约”和“三角洲行动”下各有一条。
 */
export function TeamPicker({ open, selected, onToggle, onClear, onClose }: Props) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      // 只在桌面端自动聚焦搜索框：移动端聚焦会弹出软键盘，遮住面板大半且引发行为异常
      if (window.matchMedia('(pointer: fine)').matches) {
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    }
  }, [open]);

  // 面板打开期间锁定页面滚动（修复移动端滚动穿透），详见 hooks.ts
  useBodyScrollLock(open);
  useEscapeKey(open, onClose);

  // 搜索：对预排序列表做线性过滤（保持原顺序），134 支战队耗时微秒级
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groupsAll;
    return groupsAll.map(({ game, list }) => ({
      game,
      list: list.filter((t) =>
        t.name.toLowerCase().includes(q) ||
        t.fullName.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      ),
    }));
  }, [query]);

  // selected 变化时只重渲染受影响的条目：以 id 为 key 的 Map 查询代替数组 includes
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const totalShown = groups.reduce((n, g) => n + g.list.length, 0);

  if (!open) return null;

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="战队筛选">
        <div className="picker-head">
          <div className="picker-title">
            筛选战队
            <span className="picker-count">{selected.length > 0 ? `已选 ${selected.length}` : ''}</span>
          </div>
          <button className="btn ghost small" onClick={onClear} disabled={selected.length === 0}>
            清空
          </button>
          <button className="btn ghost small" onClick={onClose}>
            完成
          </button>
        </div>
        <div className="picker-search">
          <input
            ref={searchRef}
            value={query}
            onChange={handleChange}
            placeholder="搜索战队，如 BLG、NOVA、成都AG…（同名战队分属不同游戏）"
          />
        </div>
        <div className="picker-body">
          {totalShown === 0 && <div className="picker-empty">没有匹配的战队</div>}
          {groups.map(({ game, list }) =>
            list.length === 0 ? null : (
              <section key={game.id}>
                <div className="picker-group-title" style={gameStyle(game.color)}>
                  <span className="pg-dot" />
                  {game.name}
                  <span className="pg-sub">{game.sub}</span>
                  <span className="pg-count">{list.length} 支</span>
                </div>
                <div className="picker-grid">
                  {list.map((t) => (
                    <PickerItem
                      key={t.id}
                      team={t}
                      game={game}
                      matches={matchCountByTeamId.get(t.id) ?? 0}
                      isSelected={selectedSet.has(t.id)}
                      onToggle={onToggle}
                    />
                  ))}
                </div>
              </section>
            )
          )}
        </div>
        <div className="picker-tip">
          提示：不同游戏中存在同名战队（如 BLG / JDG / NOVA / WBG…），它们是完全不同的队伍，
          此处已按所属游戏 {games.map((g) => g.name).join(' / ')} 分组区分。
        </div>
      </div>
    </div>
  );
}
