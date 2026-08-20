import type { Match, MatchStatus } from '../types';
import { gameById, teamById, formatTime, gameStyle } from '../data';
import { TeamLogo } from './TeamLogo';

const statusText: Record<MatchStatus, string> = {
  live: '进行中',
  upcoming: '未开始',
  finished: '已结束',
  canceled: '已取消',
};

function GameBadge({ gameId }: { gameId: string }) {
  const game = gameById.get(gameId);
  if (!game) return null;
  return (
    <span className="game-badge" style={gameStyle(game.color)} title={game.sub}>
      {game.name}
    </span>
  );
}

function StatusTag({ status }: { status: MatchStatus }) {
  return (
    <span className={`status-tag ${status}`}>
      {status === 'live' && <span className="live-dot" />}
      {statusText[status]}
    </span>
  );
}

function DuelBody({ match }: { match: Extract<Match, { kind: 'duel' }> }) {
  const a = teamById.get(match.teamAId);
  const b = teamById.get(match.teamBId);
  if (!a || !b) return null;
  const aWin = match.status === 'finished' && match.scoreA > match.scoreB;
  const bWin = match.status === 'finished' && match.scoreB > match.scoreA;
  const showScore = match.status === 'finished' || match.status === 'live';

  return (
    <div className="duel">
      <div className={`duel-side ${aWin ? 'win' : ''}`}>
        <TeamLogo team={a} />
        <span className="duel-name">{a.name}</span>
      </div>
      <div className="duel-center">
        {showScore ? (
          <span className={`duel-score ${aWin ? 'a-win' : ''} ${bWin ? 'b-win' : ''}`}>
            <b className={aWin ? 'win-num' : ''}>{match.scoreA}</b>
            <i>:</i>
            <b className={bWin ? 'win-num' : ''}>{match.scoreB}</b>
          </span>
        ) : (
          <span className="duel-time">{formatTime(match.startTime)}</span>
        )}
        <span className="duel-vs">{match.status === 'upcoming' ? 'VS' : match.format || 'VS'}</span>
      </div>
      <div className={`duel-side right ${bWin ? 'win' : ''}`}>
        <TeamLogo team={b} />
        <span className="duel-name">{b.name}</span>
      </div>
    </div>
  );
}

function MultiBody({ match }: { match: Extract<Match, { kind: 'multi' }> }) {
  const finished = match.status === 'finished' && match.ranking.length >= 2;
  const ids = finished ? match.ranking : match.teamIds;
  return (
    <div className={`multi ${finished ? 'ranked' : ''}`}>
      {ids.map((id, i) => {
        const t = teamById.get(id);
        if (!t) return null;
        return (
          <div className="multi-team" key={id}>
            <span className={`multi-rank ${i === 0 && finished ? 'first' : ''}`}>
              {finished ? i + 1 : '·'}
            </span>
            <TeamLogo team={t} size={28} />
            <span className="multi-name">{t.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MatchCard({ match }: { match: Match }) {
  const game = gameById.get(match.gameId);
  return (
    <article className={`match-card ${match.status}`} style={gameStyle(game?.color)}>
      <div className="mc-top">
        <GameBadge gameId={match.gameId} />
        <span className="mc-event" title={match.eventName}>{match.eventName}</span>
        {(match.stage || match.subStage) && (
          <span className="mc-stage">
            {match.stage}
            {match.subStage ? ` · ${match.subStage}` : ''}
          </span>
        )}
        <span className="mc-format">{match.format}</span>
        <StatusTag status={match.status} />
      </div>
      {match.kind === 'duel' ? <DuelBody match={match} /> : <MultiBody match={match} />}
      <span className="mc-time">{formatTime(match.startTime)}</span>
    </article>
  );
}
