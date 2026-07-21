import { ArrowRight, Clock3, Medal } from "lucide-react";
import { PLAYER_COLOR_HEX, type GameState, type PlayerState, type ScoreSnapshot } from "@slidescape/game";
import { PenguinGlyph } from "./PieceGlyphs.js";

const targetFor = (state: GameState) =>
  state.mode === "quick-2" ? 4 : state.mode === "strategic-2" ? 10 : 6;

function resultHistory(state: GameState): ScoreSnapshot[] {
  const initial = {
    moveNumber: 0,
    scores: Object.fromEntries(state.players.map((player) => [player.id, 0]))
  };
  if (state.scoreHistory?.length)
    return state.scoreHistory[0]?.moveNumber === 0 ? state.scoreHistory : [initial, ...state.scoreHistory];
  return [
    initial,
    {
      moveNumber: state.moveNumber ?? 0,
      scores: Object.fromEntries(state.players.map((player) => [player.id, player.score]))
    }
  ];
}

function ProgressChart({ state }: { state: GameState }) {
  const width = 560;
  const height = 230;
  const inset = { left: 34, right: 30, top: 18, bottom: 34 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const target = targetFor(state);
  const history = resultHistory(state);
  const lastMove = Math.max(1, state.moveNumber ?? 0, ...history.map((snapshot) => snapshot.moveNumber));
  const x = (moveNumber: number) => inset.left + (moveNumber / lastMove) * plotWidth;
  const y = (score: number) => inset.top + plotHeight - (score / target) * plotHeight;
  const tickSegments = Math.min(5, lastMove);
  const moveTicks = [
    ...new Set(
      Array.from({ length: tickSegments + 1 }, (_, index) => Math.round((index / tickSegments) * lastMove))
    )
  ];

  return (
    <section className="results-chart-panel" aria-labelledby="race-title">
      <div className="results-section-title">
        <span />
        <h2 id="race-title">Race across the ice</h2>
        <span />
      </div>
      <svg
        className="results-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Penguins escaped as the match progressed"
      >
        {Array.from({ length: target + 1 }, (_, score) => (
          <g key={score}>
            <line
              x1={inset.left}
              y1={y(score)}
              x2={width - inset.right}
              y2={y(score)}
              className="chart-grid"
            />
            <text x={inset.left - 10} y={y(score) + 4} textAnchor="end" className="chart-label">
              {score}
            </text>
          </g>
        ))}
        {moveTicks.map((moveNumber) => (
          <g key={`move-${moveNumber}`}>
            <line
              x1={x(moveNumber)}
              y1={inset.top}
              x2={x(moveNumber)}
              y2={inset.top + plotHeight}
              className="chart-grid chart-grid-vertical"
            />
            <text x={x(moveNumber)} y={height - 20} textAnchor="middle" className="chart-label">
              {moveNumber}
            </text>
          </g>
        ))}
        <line
          x1={inset.left}
          y1={inset.top + plotHeight}
          x2={width - inset.right}
          y2={inset.top + plotHeight}
          className="chart-axis"
        />
        {state.players.map((player) => {
          const points = history
            .map((snapshot) => `${x(snapshot.moveNumber)},${y(snapshot.scores[player.id] ?? 0)}`)
            .join(" ");
          const final = history.at(-1)!;
          const finalScore = final.scores[player.id] ?? player.score;
          return (
            <g key={player.id}>
              <polyline
                points={points}
                fill="none"
                stroke={PLAYER_COLOR_HEX[player.themeColor]}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                cx={x(final.moveNumber)}
                cy={y(finalScore)}
                r="6"
                fill="white"
                stroke={PLAYER_COLOR_HEX[player.themeColor]}
                strokeWidth="4"
              />
            </g>
          );
        })}
        <text x={width / 2} y={height - 5} textAnchor="middle" className="chart-caption">
          Move number (0–{lastMove})
        </text>
      </svg>
      <div className="chart-legend">
        {state.players.map((player) => (
          <span key={player.id}>
            <i style={{ background: PLAYER_COLOR_HEX[player.themeColor] }} />
            {player.name}
          </span>
        ))}
      </div>
    </section>
  );
}

function WinnerPenguin({ winner }: { winner: PlayerState }) {
  return (
    <div className="winner-podium" aria-hidden="true">
      <svg viewBox="0 0 1 1">
        <PenguinGlyph color={PLAYER_COLOR_HEX[winner.themeColor]} facing="up" />
      </svg>
      <div className="podium-ice">
        <Medal />
      </div>
    </div>
  );
}

export function GameResults({
  state,
  playerId,
  onHome
}: {
  state: GameState;
  playerId: string;
  onHome: () => void;
}) {
  const winner = state.players.find((player) => player.id === state.winnerId) ?? state.players[0]!;
  const rankings = [...state.players].sort(
    (a, b) => b.score - a.score || state.turnOrder.indexOf(a.id) - state.turnOrder.indexOf(b.id)
  );
  const runnerUp = rankings.find((player) => player.id !== winner.id);
  const margin = Math.max(0, winner.score - (runnerUp?.score ?? 0));
  const isWinner = winner.id === playerId;

  return (
    <section className="results-screen" role="dialog" aria-modal="true" aria-labelledby="results-title">
      <header className="results-hero">
        <div>
          <h1 id="results-title">{isWinner ? "You win!" : `${winner.name} wins!`}</h1>
          <p>
            {isWinner
              ? "Your penguins found the cleanest path across the ice."
              : `${winner.name}'s team reached safety first.`}
          </p>
        </div>
        <WinnerPenguin winner={winner} />
      </header>

      <div className="results-grid">
        <section className="standings-panel" aria-labelledby="standings-title">
          <div className="results-section-title">
            <span />
            <h2 id="standings-title">Final standings</h2>
            <span />
          </div>
          <ol>
            {rankings.map((player, index) => (
              <li key={player.id} className={player.id === winner.id ? "winner" : ""}>
                <b>{index + 1}</b>
                <span className="standing-penguin">
                  <svg viewBox="0 0 1 1">
                    <PenguinGlyph color={PLAYER_COLOR_HEX[player.themeColor]} facing="up" />
                  </svg>
                </span>
                <span>
                  <strong>{player.name}</strong>
                  {player.id === playerId ? <small>You</small> : null}
                </span>
                <span className="standing-score">
                  <strong>{player.score}</strong>
                  <small>escaped</small>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <ProgressChart state={state} />
      </div>

      <section className="results-stats" aria-label="Match highlights">
        <div>
          <Clock3 />
          <span>
            <small>Total turns</small>
            <strong>{state.turn.number}</strong>
          </span>
        </div>
        <div>
          <Medal />
          <span>
            <small>Winning margin</small>
            <strong>
              {margin} {margin === 1 ? "penguin" : "penguins"}
            </strong>
          </span>
        </div>
      </section>

      <div className="results-actions">
        <button className="results-primary" onClick={onHome}>
          Back to home <ArrowRight />
        </button>
      </div>
    </section>
  );
}
