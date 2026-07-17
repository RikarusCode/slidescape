import { memo, useMemo } from "react";
import { COLOR_HEX, GOAL_LANES, legalMoves, type Color, type GameState, type LegalMove, type Piece, type Position } from "@haywire/game";

const GRID = Array.from({ length: 18 }, (_, index) => index);
const positionKey = (position: Position) => `${position.x},${position.y}`;

function rotationFor(color?: Color) {
  if (color === "green") return 180;
  if (color === "yellow") return 90;
  if (color === "blue") return -90;
  return 0;
}

function PieceGlyph({ piece, selected }: { piece: Piece; selected: boolean }) {
  const color = piece.color ? COLOR_HEX[piece.color] : "#fffdf7";
  if (piece.kind === "hay") return (
    <g className="piece hay-piece" aria-label={`${piece.color} hay bale`}>
      <rect x=".14" y=".24" width=".72" height=".52" rx=".06" fill="#f4c430" stroke="#3b2618" strokeWidth=".07" />
      <path d="M.25 .4h.5M.25 .6h.5" stroke="#3b2618" strokeWidth=".06" />
    </g>
  );
  if (piece.kind === "cow") return <circle className="piece" cx=".5" cy=".5" r=".31" fill="#fffdf7" stroke="#3b2618" strokeWidth=".08" aria-label="cow" />;
  return (
    <g className="piece pig-piece" aria-label={`${piece.color} pig`}>
      {selected ? <circle cx=".5" cy=".5" r=".43" fill="none" stroke="#fff" strokeWidth=".1" /> : null}
      {selected ? <circle cx=".5" cy=".5" r=".38" fill="none" stroke="#3b2618" strokeWidth=".06" /> : null}
      <circle cx=".5" cy=".5" r=".29" fill={color} stroke="#2d2118" strokeWidth=".07" />
      <circle cx=".5" cy=".5" r=".065" fill="#2d2118" />
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
    <div className="board-frame" aria-label="Haywire game board">
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
        {state.fenceActive ? <rect x="7.35" y="7.35" width="2.3" height="2.3" rx=".08" className="cow-fence" /> : null}
        {state.poop.map((poop, index) => <g key={`${positionKey(poop)}-${index}`} transform={`translate(${poop.x} ${poop.y})`} aria-label="poop" onClick={() => onPoopSelect?.(poop)} className={onPoopSelect ? "selectable" : ""}>{selectedPoop && positionKey(selectedPoop) === positionKey(poop) ? <circle cx=".5" cy=".5" r=".4" fill="none" stroke="#2f80d0" strokeWidth=".08"/> : null}<circle cx=".5" cy=".5" r=".27" fill="#8b572a" stroke="#3b2618" strokeWidth=".07" /><path d="M.36 .52c.03-.2.32-.19.29-.01-.02.12-.22.14-.22.02 0-.08.13-.1.15-.03" fill="none" stroke="#2d2118" strokeWidth=".055" strokeLinecap="round" /></g>)}
        {pieces.map((piece) => <g key={piece.id} transform={`translate(${piece.position.x} ${piece.position.y})`} onClick={() => onSelect(piece.id)} className={available.some((move) => move.pieceId === piece.id) ? "selectable" : ""}><PieceGlyph piece={piece} selected={piece.id === selectedId} /></g>)}
        {selectedMoves.filter((move) => move.scores).map((move) => { const x = move.to.x + .5; const y = move.to.y + .5; return <g key={move.direction} className="score-arrow" onClick={() => onMove(move)} transform={`translate(${x} ${y}) rotate(${move.direction === "down" ? 180 : move.direction === "left" ? -90 : move.direction === "right" ? 90 : 0})`}><circle r=".36" /><text y=".18" textAnchor="middle">⇧</text></g>})}
      </svg>
    </div>
  );
});
