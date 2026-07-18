import { memo, useMemo } from "react";
import { COLOR_HEX, GOAL_LANES, legalMoves, type Color, type GameState, type LegalMove, type Piece, type Position } from "@slidescape/game";

const GRID = Array.from({ length: 18 }, (_, index) => index);
const positionKey = (position: Position) => `${position.x},${position.y}`;

function rotationFor(color?: Color) {
  if (color === "green") return 180;
  if (color === "yellow") return 90;
  if (color === "blue") return -90;
  return 0;
}

function PieceGlyph({ piece, selected }: { piece: Piece; selected: boolean }) {
  const color = piece.color ? COLOR_HEX[piece.color] : "#ffffff";
  if (piece.kind === "hay") return (
    <g className="piece ice-block-piece" aria-label={`${piece.color} ice block`}>
      <rect x=".14" y=".16" width=".72" height=".68" rx=".12" fill="#bcecff" stroke="#0b315d" strokeWidth=".06" />
      <path d="M.22 .28l.18-.08h.35l.09.12-.11.38-.24.08-.29-.16z" fill="#eaf9ff" opacity=".8" />
      <path d="M.19 .76h.62" stroke={color} strokeWidth=".09" />
    </g>
  );
  if (piece.kind === "cow") return <g className="piece walrus-piece" aria-label="walrus">
    <ellipse cx=".5" cy=".53" rx=".34" ry=".3" fill="#9aabba" stroke="#0b315d" strokeWidth=".07" />
    <circle cx=".4" cy=".46" r=".035" fill="#071a33"/><circle cx=".6" cy=".46" r=".035" fill="#071a33"/>
    <ellipse cx=".5" cy=".57" rx=".13" ry=".09" fill="#718596" />
    <path d="M.43 .61l.03.2.05-.18M.57 .61l-.03.2-.05-.18" fill="#fff" stroke="#0b315d" strokeWidth=".025" />
    <path d="M.37 .56l-.17-.04M.37 .61l-.18.04M.63 .56l.17-.04M.63 .61l.18.04" stroke="#0b315d" strokeWidth=".025" />
  </g>;
  return (
    <g className="piece penguin-piece" aria-label={`${piece.color} penguin`}>
      {selected ? <circle cx=".5" cy=".5" r=".43" fill="none" stroke="#ff7a45" strokeWidth=".1" /> : null}
      <ellipse cx=".5" cy=".53" rx=".27" ry=".34" fill="#071a33" stroke="#0b315d" strokeWidth=".05" />
      <ellipse cx=".5" cy=".57" rx=".18" ry=".24" fill="#f8fdff" />
      <circle cx=".42" cy=".4" r=".035" fill="#fff"/><circle cx=".58" cy=".4" r=".035" fill="#fff"/>
      <circle cx=".42" cy=".4" r=".016" fill="#071a33"/><circle cx=".58" cy=".4" r=".016" fill="#071a33"/>
      <path d="M.45 .47l.05-.06.05.06-.05.05z" fill="#ff7a45" />
      <path d="M.27 .56h.46" stroke={color} strokeWidth=".09" />
    </g>
  );
}

interface BoardProps {
  state: GameState;
  playerId: string;
  selectedId?: string;
  onSelect: (pieceId: string) => void;
  onMove: (move: LegalMove) => void;
  specialMoves?: LegalMove[];
  onEmptyCell?: (position: Position) => void;
  onPoopSelect?: (position: Position) => void;
  selectedPoop?: Position;
}

export const Board = memo(function Board({ state, playerId, selectedId, onSelect, onMove, specialMoves, onEmptyCell, onPoopSelect, selectedPoop }: BoardProps) {
  const viewer = state.players.find((player) => player.id === playerId);
  const rotation = rotationFor(viewer?.colors[0]);
  const available = useMemo(() => legalMoves(state, playerId), [state, playerId]);
  const selectedMoves = specialMoves ?? (selectedId ? available.filter((move) => move.pieceId === selectedId) : []);
  const moveByCell = new Map(selectedMoves.filter((move) => !move.scores).map((move) => [positionKey(move.to), move]));
  const goals = Object.entries(GOAL_LANES) as [Color, Position[]][];
  const pieces = state.pieces.filter((piece) => !piece.scored);

  return (
    <div className="board-frame" aria-label="Slidescape game board">
      <svg viewBox="0 0 17 17" role="grid" className="board" style={{ rotate: `${rotation}deg` }}>
        <rect width="17" height="17" rx=".12" className="board-base" />
        {Array.from({ length: 17 * 17 }, (_, index) => {
          const x = index % 17; const y = Math.floor(index / 17);
          const target = moveByCell.get(`${x},${y}`);
          return <rect key={index} x={x} y={y} width="1" height="1" className={target ? "cell legal-cell" : (x + y) % 2 ? "cell cell-alt" : "cell"} onClick={target ? () => onMove(target) : onEmptyCell ? () => onEmptyCell({ x, y }) : undefined} />;
        })}
        {GRID.map((index) => <path key={`v${index}`} d={`M${index} 0v17`} className="grid-line" />)}
        {GRID.map((index) => <path key={`h${index}`} d={`M0 ${index}h17`} className="grid-line" />)}
        {goals.flatMap(([color, cells]) => cells.map((cell) => <rect key={`${color}-${positionKey(cell)}`} x={cell.x + .04} y={cell.y + .04} width=".92" height=".92" fill={COLOR_HEX[color]} className="goal-cell" />))}
        {state.fenceActive ? <circle cx="8.5" cy="8.5" r="1.16" className="cow-fence" /> : null}
        {state.poop.map((poop, index) => <g key={`${positionKey(poop)}-${index}`} transform={`translate(${poop.x} ${poop.y})`} aria-label="poop" onClick={() => onPoopSelect?.(poop)} className={onPoopSelect ? "selectable" : ""}>{selectedPoop && positionKey(selectedPoop) === positionKey(poop) ? <circle cx=".5" cy=".5" r=".4" fill="none" stroke="#2f80d0" strokeWidth=".08"/> : null}<circle cx=".5" cy=".5" r=".27" fill="#8b572a" stroke="#3b2618" strokeWidth=".07" /><path d="M.36 .52c.03-.2.32-.19.29-.01-.02.12-.22.14-.22.02 0-.08.13-.1.15-.03" fill="none" stroke="#2d2118" strokeWidth=".055" strokeLinecap="round" /></g>)}
        {pieces.map((piece) => <g key={piece.id} transform={`translate(${piece.position.x} ${piece.position.y})`} onClick={() => onSelect(piece.id)} className={available.some((move) => move.pieceId === piece.id) ? "selectable" : ""}><PieceGlyph piece={piece} selected={piece.id === selectedId} /></g>)}
        {selectedMoves.filter((move) => move.scores).map((move) => { const x = move.to.x + .5; const y = move.to.y + .5; return <g key={move.direction} className="score-arrow" onClick={() => onMove(move)} transform={`translate(${x} ${y}) rotate(${move.direction === "down" ? 180 : move.direction === "left" ? -90 : move.direction === "right" ? 90 : 0})`}><circle r=".36" /><text y=".18" textAnchor="middle">⇧</text></g>})}
      </svg>
    </div>
  );
});
