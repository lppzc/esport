import { useEffect, useMemo, useRef, useState, memo, useCallback } from 'react';
import type { Game } from '../types';
import {
  games,
  events,
  gameStyle,
  eventFilterKeysOf,
  eventStageByKey,
  UNLABELED_STAGE,
} from '../data';
import type { EventInfo } from '../data';
import { useBodyScrollLock, useEscapeKey } from '../hooks';

/** 模块级预分组（events 已按最新比赛倒序）：搜索时只做线性过滤 */
const groupsAll = games.map((game) => ({
  game,
  list: events.filter((e) => e.gameId === game.id),
}));

interface EventItemProps {
  ev: EventInfo;
  game: Game;
  selectedSet: Set<string>;
  expanded: boolean;
  onToggleEvent: (ev: EventInfo) => void;
  onToggleStage: (ev: EventInfo, stageKey: string) => void;
  onToggleExpand: (eventKey: string) => void;
}

/** 单个赛事条目（memo：props 不变则跳过渲染）——可展开勾选其下阶段 */
const EventItem = memo(function EventItem({
  ev, game, selectedSet, expanded, onToggleEvent, onToggleStage, onToggleExpand,
}: EventItemProps) {
  const full = selectedSet.has(ev.key);
  const stageSelectedCount = ev.stages.reduce((n, s) => n + (selectedSet.has(s.key) ? 1 : 0), 0);
  const partial = !full && stageSelectedCount > 0;
  const expandable = ev.stages.length > 1;
  const show = expanded || partial; // 已做阶段细分时强制展开，选择状态可见

  return (
    <div
      className={`ev-item${full ? ' selected' : ''}${partial ? ' partial' : ''}`}
      style={gameStyle(game.color)}
    >
      <div className="ev-head">
        <button className="ev-row" onClick={() => onToggleEvent(ev)} title={ev.eventName}>
          <span className={`ev-check${full ? ' on' : ''}`}>{full ? '✓' : partial ? '−' : ''}</span>
          <span className="ev-name">{ev.eventName}</span>
          <span className="ev-meta">
            {partial ? `已选 ${stageSelectedCount}/${ev.stages.length} 阶段` : `${ev.matchCount} 场`}
          </span>
        </button>
        {expandable && (
          <button
            className="ev-expand"
            onClick={() => onToggleExpand(ev.key)}
            aria-expanded={show}
            aria-label={show ? `收起 ${ev.eventName} 的阶段` : `展开 ${ev.eventName} 的阶段`}
          >
            {show ? '▾' : '▸'}
          </button>
        )}
      </div>
      {show && (
        <div className="ev-stages">
          {ev.stages.map((s) => {
            const on = selectedSet.has(s.key);
            return (
              <button
                key={s.key}
                className={`ev-stage${on ? ' selected' : ''}`}
                onClick={() => onToggleStage(ev, s.key)}
              >
                <span className={`ev-check small${on ? ' on' : ''}`}>{on ? '✓' : ''}</span>
                <span className="ev-stage-name">{s.stage || UNLABELED_STAGE}</span>
                <span className="ev-stage-count">{s.count} 场</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

interface Props {
  open: boolean;
  /** 已选的筛选 key：整赛 key（选中整个赛事）或阶段 key（只选该赛事的某阶段） */
  selected: string[];
  onChange: (next: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * 赛事筛选面板：按游戏分组展示所有赛事，支持两级筛选——
 * 勾选赛事 = 该赛事全部比赛；展开后勾选具体阶段（小组赛 / 常规赛 /
 * 季后赛 / 淘汰赛 / 决赛等，阶段来自真实数据）= 只看该阶段。
 * 结构与 TeamPicker 相同（移动端底部抽屉 / 桌面端居中模态）。
 */
export function EventPicker({ open, selected, onChange, onClear, onClose }: Props) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useBodyScrollLock(open);
  useEscapeKey(open, onClose);

  useEffect(() => {
    if (open) {
      setQuery('');
      // 展开所有已做阶段细分的赛事，让当前选择一眼可见
      setExpanded(
        new Set(
          selected
            .map((k) => eventStageByKey.get(k)?.eventKey)
            .filter((k): k is string => typeof k === 'string'),
        ),
      );
      if (window.matchMedia('(pointer: fine)').matches) {
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    }
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groupsAll;
    return groupsAll.map(({ game, list }) => ({
      game,
      // 赛事名与阶段名均可搜（如直接搜「季后赛」「淘汰赛」）
      list: list.filter(
        (e) =>
          e.eventName.toLowerCase().includes(q) ||
          e.stages.some((s) => s.stage.toLowerCase().includes(q)),
      ),
    }));
  }, [query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /** 勾选整赛：清除该赛事全部旧选择（含阶段），改为整赛 key；再次点击取消 */
  const toggleEvent = useCallback(
    (ev: EventInfo) => {
      const keys = eventFilterKeysOf(ev);
      if (selected.includes(ev.key)) {
        onChange(selected.filter((k) => !keys.includes(k)));
      } else {
        onChange([...selected.filter((k) => !keys.includes(k)), ev.key]);
      }
    },
    [selected, onChange],
  );

  /** 勾选阶段：覆盖整赛选择（整赛 → 单阶段是「收窄」语义），并确保该赛事展开 */
  const toggleStage = useCallback(
    (ev: EventInfo, stageKey: string) => {
      if (selected.includes(stageKey)) {
        onChange(selected.filter((k) => k !== stageKey));
      } else {
        onChange([...selected.filter((k) => k !== ev.key), stageKey]);
      }
      setExpanded((prev) => new Set(prev).add(ev.key));
    },
    [selected, onChange],
  );

  const toggleExpand = useCallback((eventKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(eventKey)) next.delete(eventKey);
      else next.add(eventKey);
      return next;
    });
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const totalShown = groups.reduce((n, g) => n + g.list.length, 0);

  if (!open) return null;

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="赛事筛选">
        <div className="picker-head">
          <div className="picker-title">
            筛选赛事
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
            placeholder="搜索赛事或阶段，如 大师赛、季后赛、淘汰赛…"
          />
        </div>
        <div className="picker-body">
          {totalShown === 0 && <div className="picker-empty">没有匹配的赛事</div>}
          {groups.map(({ game, list }) =>
            list.length === 0 ? null : (
              <section key={game.id}>
                <div className="picker-group-title" style={gameStyle(game.color)}>
                  <span className="pg-dot" />
                  {game.name}
                  <span className="pg-sub">{game.sub}</span>
                  <span className="pg-count">{list.length} 项赛事</span>
                </div>
                <div className="ev-list">
                  {list.map((ev) => (
                    <EventItem
                      key={ev.key}
                      ev={ev}
                      game={game}
                      selectedSet={selectedSet}
                      expanded={expanded.has(ev.key)}
                      onToggleEvent={toggleEvent}
                      onToggleStage={toggleStage}
                      onToggleExpand={toggleExpand}
                    />
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
        <div className="picker-tip">
          提示：勾选赛事 = 该赛事全部比赛；点右侧 ▸ 展开可只选某个阶段
          （小组赛 / 常规赛 / 季后赛 / 淘汰赛 / 决赛等，来自各赛事真实阶段划分）。
        </div>
      </div>
    </div>
  );
}
