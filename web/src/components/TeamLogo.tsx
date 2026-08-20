import { useState } from 'react';
import type { Team } from '../types';
import { gameById } from '../data';

const palette = [
  '#ff4655', '#f5a623', '#4fc3f7', '#ba68c8',
  '#66bb6a', '#ff7043', '#26c6da', '#ec407a',
];

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** 战队 logo，加载失败时回退为按战队 ID 着色的名称缩写色块 */
export function TeamLogo({ team, size = 34 }: { team: Team; size?: number }) {
  const [failed, setFailed] = useState(false);
  const game = gameById.get(team.gameId);
  if (failed || !team.logo) {
    return (
      <span
        className="team-logo fallback"
        style={{ width: size, height: size, background: hashColor(team.id), fontSize: Math.round(size * 0.36) }}
        title={team.name}
      >
        {team.name.slice(0, 2)}
      </span>
    );
  }
  return (
    <span
      className="team-logo"
      style={{ width: size, height: size, borderColor: game ? `${game.color}55` : undefined }}
      title={team.name}
    >
      <img src={team.logo} alt={team.name} loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}
