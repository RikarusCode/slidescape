import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BOARD_SIZE, COLOR_HEX, COLOR_ORDER, FENCE_POSITIONS, legalMoves, PLAYER_COLOR_HEX, type Color, type Direction, type GameState, type LegalMove, type Piece, type Position } from "@slidescape/game";
import { IceBlockGlyph, nearestFacingRotation, PenguinGlyph, PoopGlyph, startingFacing, WalrusGlyph } from "./PieceGlyphs.js";

const GRID = Array.from({ length: BOARD_SIZE + 1 }, (_, index) => index);
const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }
};
const positionKey = (position: Position) => `${position.x},${position.y}`;
const inside = ({ x, y }: Position) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
const adjacent = (position: Position, direction: Direction): Position => ({
  x: position.x + DELTA[direction].x,
  y: position.y + DELTA[direction].y
});

function rotationFor(color?: Color) {
  if (color === "green") return 180;
  if (color === "yellow") return 90;
  if (color === "blue") return -90;
  return 0;
}

function directionRotation(direction: Direction) {
  if (direction === "right") return 90;
  if (direction === "down") return 180;
  if (direction === "left") return -90;
  return 0;
}

function PieceGlyph({ piece, selected, color, walrusFacing, walrusRotation }: { piece: Piece; selected: boolean; color: string; walrusFacing?: Direction; walrusRotation?: number }) {
  if (piece.kind === "ice") return <g aria-label={`${piece.color} ice block`}><IceBlockGlyph color={color}/></g>;
  if (piece.kind === "walrus") return <g aria-label="walrus"><WalrusGlyph facing={walrusFacing ?? piece.facing} rotationDegrees={walrusRotation}/></g>;
  return <g aria-label={`${piece.color} penguin`}><PenguinGlyph color={color} facing={piece.facing ?? startingFacing(piece.color)} selected={selected}/></g>;
}

function AnimatedPiece({ piece, selected, selectable, fenceActive, color, walrusFacing, positionOverride, facingOverride, onSelect }: { piece: Piece; selected: boolean; selectable: boolean; fenceActive: boolean; color: string; walrusFacing?: Direction; positionOverride?: Position; facingOverride?: Direction; onSelect: (pieceId: string) => void }) {
  const visualPosition = piece.kind === "walrus" && fenceActive ? { x: 6.5, y: 6.5 } : positionOverride ?? piece.position;
  const visualFacing = facingOverride ?? walrusFacing ?? piece.facing ?? "down";
  const node = useRef<SVGGElement>(null);
  const previous = useRef({ ...visualPosition });
  const previousFacing = useRef(visualFacing);
  const walrusRotation = useRef(directionRotation(visualFacing));
  const visualWalrusRotation = piece.kind === "walrus" ? nearestFacingRotation(walrusRotation.current, visualFacing) : undefined;
  if (visualWalrusRotation !== undefined) walrusRotation.current = visualWalrusRotation;
  const [reducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useLayoutEffect(() => {
    const element = node.current;
    const from = previous.current;
    const to = { ...visualPosition };
    const turnsBeforeMoving = previousFacing.current !== visualFacing;
    previous.current = to;
    previousFacing.current = visualFacing;
    if (!element) return;
    const destination = `translate(${to.x} ${to.y})`;
    if (from.x === to.x && from.y === to.y) {
      element.setAttribute("transform", destination);
      return;
    }

    let frame = 0;
    let start: number | undefined;
    const duration = reducedMotion ? 140 : 380;
    element.setAttribute("transform", `translate(${from.x} ${from.y})`);
    const animate = (now: number) => {
      start ??= now;
      const progress = Math.max(0, Math.min(1, (now - start) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = from.x + (to.x - from.x) * eased;
      const y = from.y + (to.y - from.y) * eased;
      element.setAttribute("transform", `translate(${x} ${y})`);
      if (progress < 1) frame = requestAnimationFrame(animate);
      else element.setAttribute("transform", destination);
    };
    const turnDelay = turnsBeforeMoving && !reducedMotion ? 160 : 0;
    const timer = window.setTimeout(() => { frame = requestAnimationFrame(animate); }, turnDelay);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [visualPosition.x, visualPosition.y, visualFacing, reducedMotion]);

  return <g
    ref={node}
    data-piece-id={piece.id}
    transform={`translate(${visualPosition.x} ${visualPosition.y})`}
    onClick={selectable && !(piece.kind === "walrus" && fenceActive) ? () => onSelect(piece.id) : undefined}
    className={`board-piece ${selectable ? "selectable" : ""}`.trim()}
  >
    <PieceGlyph piece={{ ...piece, facing: visualFacing }} selected={selected} color={color} walrusRotation={visualWalrusRotation}/>
  </g>;
}

function GoalGuards({ colors }: { colors: Record<Color, string> }) {
  return <g className="goal-guards" aria-hidden="true">
    <path d="M6 0v.86M8 0v.86" stroke={colors.red}/>
    <path d="M6 13.14V14M8 13.14V14" stroke={colors.green}/>
    <path d="M0 6h.86M0 8h.86" stroke={colors.yellow}/>
    <path d="M13.14 6H14M13.14 8H14" stroke={colors.blue}/>
  </g>;
}

interface BoardProps {
  state: GameState;
  playerId: string;
  selectedId?: string;
  onSelect: (pieceId: string) => void;
  onMove: (move: LegalMove) => void;
  specialMoves?: LegalMove[];
  specialSelectableIds?: string[];
  onEmptyCell?: (position: Position) => void;
  onPoopSelect?: (position: Position) => void;
  selectedPoop?: Position;
}

export const Board = memo(function Board({ state, playerId, selectedId, onSelect, onMove, specialMoves, specialSelectableIds, onEmptyCell, onPoopSelect, selectedPoop }: BoardProps) {
  const [optimisticMove, setOptimisticMove] = useState<{ pieceId: string; to: Position; direction: Direction }>();
  const viewer = state.players.find((player) => player.id === playerId);
  const rotation = rotationFor(viewer?.colors[0]);
  const available = useMemo(() => legalMoves(state, playerId), [state, playerId]);
  const selectedPiece = state.pieces.find((piece) => piece.id === selectedId && !piece.scored);
  const selectedMoves = specialMoves ?? (selectedId ? available.filter((move) => move.pieceId === selectedId) : []);
  const directionControls = selectedMoves.flatMap((move) => {
    if (!selectedPiece || move.scores) return [];
    const position = adjacent(selectedPiece.position, move.direction);
    return inside(position) ? [{ move, position }] : [];
  });
  const projectedMoves = selectedPiece?.kind === "penguin" ? selectedMoves.filter((move) => !move.scores) : [];
  const pieces = state.pieces.filter((piece) => !piece.scored);
  const playerById = new Map(state.players.map((player) => [player.id, player]));
  const sideColors = Object.fromEntries(COLOR_ORDER.map((color) => {
    const owner = state.players.find((player) => player.colors.includes(color));
    return [color, owner ? PLAYER_COLOR_HEX[owner.themeColor] : COLOR_HEX[color]];
  })) as Record<Color, string>;

  useEffect(() => {
    if (!optimisticMove) return;
    const canonical = state.pieces.find((piece) => piece.id === optimisticMove.pieceId)?.position;
    if (canonical?.x === optimisticMove.to.x && canonical.y === optimisticMove.to.y) {
      setOptimisticMove(undefined);
      return;
    }
    const rollback = window.setTimeout(() => setOptimisticMove(undefined), 1_800);
    return () => window.clearTimeout(rollback);
  }, [state.version, optimisticMove]);

  const submitMove = (requested: LegalMove) => {
    if (!requested.scores) setOptimisticMove({ pieceId: requested.pieceId, to: { ...requested.to }, direction: requested.direction });
    onMove(requested);
  };

  return (
    <div className="board-frame" aria-label="Slidescape game board">
      <svg viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`} role="grid" className="board" style={{ rotate: `${rotation}deg` }}>
        <rect width={BOARD_SIZE} height={BOARD_SIZE} rx=".12" className="board-base"/>
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
          const x = index % BOARD_SIZE;
          const y = Math.floor(index / BOARD_SIZE);
          return <rect
            key={index}
            x={x}
            y={y}
            width="1"
            height="1"
            className={(x + y) % 2 ? "cell cell-alt" : "cell"}
            onClick={onEmptyCell ? () => onEmptyCell({ x, y }) : undefined}
          />;
        })}
        {GRID.map((index) => <path key={`v${index}`} d={`M${index} 0v${BOARD_SIZE}`} className="grid-line"/>)}
        {GRID.map((index) => <path key={`h${index}`} d={`M0 ${index}h${BOARD_SIZE}`} className="grid-line"/>)}
        <GoalGuards colors={sideColors}/>
        {projectedMoves.map((move) => <rect
          key={`projection-${move.direction}`}
          x={move.to.x + .08}
          y={move.to.y + .08}
          width=".84"
          height=".84"
          rx=".14"
          className="projected-cell"
          aria-hidden="true"
        />)}
        {state.fenceActive ? <g className="walrus-fence" aria-label="walrus fence">
          <rect x="6.08" y="6.08" width="1.84" height="1.84" rx=".16" className="walrus-fence-frame"/>
          {FENCE_POSITIONS.map((position) => <rect key={positionKey(position)} x={position.x + .12} y={position.y + .12} width=".76" height=".76" rx=".1" className="walrus-fence-ice"/>)}
        </g> : null}
        {state.poop.map((poop, index) => <g key={`${positionKey(poop)}-${index}`} transform={`translate(${poop.x} ${poop.y})`} aria-label="poop" onClick={() => onPoopSelect?.(poop)} className={onPoopSelect ? "selectable" : ""}>{selectedPoop && positionKey(selectedPoop) === positionKey(poop) ? <circle cx=".5" cy=".5" r=".4" fill="none" stroke="#2f80d0" strokeWidth=".08"/> : null}<PoopGlyph/></g>)}
        {pieces.map((piece) => <AnimatedPiece
          key={piece.id}
          piece={piece}
          selected={piece.id === selectedId}
          selectable={specialSelectableIds ? specialSelectableIds.includes(piece.id) : available.some((move) => move.pieceId === piece.id)}
          fenceActive={state.fenceActive}
          color={piece.ownerId ? PLAYER_COLOR_HEX[playerById.get(piece.ownerId)!.themeColor] : "#ffffff"}
          walrusFacing={piece.kind === "walrus" && state.fenceActive ? startingFacing(viewer?.colors[0]) : undefined}
          positionOverride={optimisticMove?.pieceId === piece.id ? optimisticMove.to : undefined}
          facingOverride={optimisticMove?.pieceId === piece.id ? optimisticMove.direction : undefined}
          onSelect={onSelect}
        />)}
        {directionControls.map(({ move, position }) => <g
          key={`control-${move.direction}`}
          transform={`translate(${position.x} ${position.y})`}
          className="move-control"
          role="button"
          aria-label={`Slide ${move.direction} to row ${move.to.y + 1}, column ${move.to.x + 1}`}
          onClick={(event) => { event.stopPropagation(); submitMove(move); }}
        >
          <rect x=".14" y=".14" width=".72" height=".72" rx=".28"/>
          <path d="M.5 .3L.34 .48h.1v.22h.12V.48h.1z" transform={`rotate(${directionRotation(move.direction)} .5 .5)`}/>
        </g>)}
        {selectedMoves.filter((move) => move.scores).map((move) => {
          const x = move.to.x + .5;
          const y = move.to.y + .5;
          return <g key={`score-${move.direction}`} className="score-arrow" onClick={() => submitMove(move)} transform={`translate(${x} ${y}) rotate(${directionRotation(move.direction)})`}><circle r=".36"/><path d="M0-.22L-.16 0h.1v.22h.12V0h.1z"/></g>;
        })}
      </svg>
    </div>
  );
});
