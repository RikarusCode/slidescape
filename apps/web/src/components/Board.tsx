import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";
import {
  BOARD_SIZE,
  COLOR_HEX,
  COLOR_ORDER,
  FENCE_POSITIONS,
  PLAYER_COLOR_HEX,
  type Color,
  type Direction,
  type GameState,
  type LegalMove,
  type Piece,
  type Position
} from "@slidescape/game";
import {
  IceBlockGlyph,
  nearestFacingRotation,
  PenguinGlyph,
  PoopGlyph,
  startingFacing,
  ElephantSealGlyph
} from "./PieceGlyphs.js";

const GRID = Array.from({ length: BOARD_SIZE + 1 }, (_, index) => index);
const BOARD_CELLS = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
  const x = index % BOARD_SIZE;
  const y = Math.floor(index / BOARD_SIZE);
  return (
    <rect
      key={index}
      x={x}
      y={y}
      width="1"
      height="1"
      data-board-cell={`${x},${y}`}
      className={(x + y) % 2 ? "cell cell-alt" : "cell"}
    />
  );
});
const GRID_LINES = (
  <>
    {GRID.map((index) => (
      <path key={`v${index}`} d={`M${index} 0v${BOARD_SIZE}`} className="grid-line" />
    ))}
    {GRID.map((index) => (
      <path key={`h${index}`} d={`M0 ${index}h${BOARD_SIZE}`} className="grid-line" />
    ))}
  </>
);
const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
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

function PieceGlyph({
  piece,
  selected,
  color,
  elephantSealFacing,
  elephantSealRotation
}: {
  piece: Piece;
  selected: boolean;
  color: string;
  elephantSealFacing?: Direction;
  elephantSealRotation?: number;
}) {
  if (piece.kind === "ice")
    return (
      <g aria-label={`${piece.color} ice block`}>
        <IceBlockGlyph color={color} />
      </g>
    );
  if (piece.kind === "elephant-seal")
    return (
      <g aria-label="elephant seal">
        <ElephantSealGlyph
          facing={elephantSealFacing ?? piece.facing}
          rotationDegrees={elephantSealRotation}
        />
      </g>
    );
  return (
    <g aria-label={`${piece.color} penguin`}>
      <PenguinGlyph color={color} facing={piece.facing ?? startingFacing(piece.color)} selected={selected} />
    </g>
  );
}

interface AnimatedPieceProps {
  piece: Piece;
  selected: boolean;
  selectable: boolean;
  fenceActive: boolean;
  color: string;
  elephantSealFacing?: Direction;
  positionOverride?: Position;
  facingOverride?: Direction;
  onSelect: (pieceId: string) => void;
}

const sameOptionalPosition = (left?: Position, right?: Position) =>
  left === right || (left?.x === right?.x && left?.y === right?.y);

const AnimatedPiece = memo(
  function AnimatedPiece({
    piece,
    selected,
    selectable,
    fenceActive,
    color,
    elephantSealFacing,
    positionOverride,
    facingOverride,
    onSelect
  }: AnimatedPieceProps) {
    const visualPosition =
      piece.kind === "elephant-seal" && fenceActive
        ? { x: 6.5, y: 6.5 }
        : (positionOverride ?? piece.position);
    const visualFacing = facingOverride ?? elephantSealFacing ?? piece.facing ?? "down";
    const node = useRef<SVGGElement>(null);
    const previous = useRef({ ...visualPosition });
    const previousFacing = useRef(visualFacing);
    const elephantSealRotation = useRef(directionRotation(visualFacing));
    const visualElephantSealRotation =
      piece.kind === "elephant-seal"
        ? nearestFacingRotation(elephantSealRotation.current, visualFacing)
        : undefined;
    if (visualElephantSealRotation !== undefined) elephantSealRotation.current = visualElephantSealRotation;
    const [reducedMotion] = useState(
      () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );

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
      const timer = window.setTimeout(() => {
        frame = requestAnimationFrame(animate);
      }, turnDelay);
      return () => {
        window.clearTimeout(timer);
        cancelAnimationFrame(frame);
      };
    }, [visualPosition.x, visualPosition.y, visualFacing, reducedMotion]);

    return (
      <g
        ref={node}
        data-piece-id={piece.id}
        transform={`translate(${visualPosition.x} ${visualPosition.y})`}
        onClick={
          selectable && !(piece.kind === "elephant-seal" && fenceActive)
            ? () => onSelect(piece.id)
            : undefined
        }
        className={`board-piece ${selectable ? "selectable" : ""}`.trim()}
      >
        <PieceGlyph
          piece={{ ...piece, facing: visualFacing }}
          selected={selected}
          color={color}
          elephantSealRotation={visualElephantSealRotation}
        />
      </g>
    );
  },
  (previous, next) =>
    previous.piece.id === next.piece.id &&
    previous.piece.kind === next.piece.kind &&
    previous.piece.color === next.piece.color &&
    previous.piece.facing === next.piece.facing &&
    sameOptionalPosition(previous.piece.position, next.piece.position) &&
    previous.selected === next.selected &&
    previous.selectable === next.selectable &&
    previous.fenceActive === next.fenceActive &&
    previous.color === next.color &&
    previous.elephantSealFacing === next.elephantSealFacing &&
    sameOptionalPosition(previous.positionOverride, next.positionOverride) &&
    previous.facingOverride === next.facingOverride &&
    previous.onSelect === next.onSelect
);

function GoalGuards({ colors }: { colors: Record<Color, string> }) {
  return (
    <g className="goal-guards" aria-hidden="true">
      <path d="M6 0v.86M8 0v.86" stroke={colors.red} />
      <path d="M6 13.14V14M8 13.14V14" stroke={colors.green} />
      <path d="M0 6h.86M0 8h.86" stroke={colors.yellow} />
      <path d="M13.14 6H14M13.14 8H14" stroke={colors.blue} />
    </g>
  );
}

interface BoardProps {
  state: GameState;
  playerId: string;
  selectedId?: string;
  availableMoves: LegalMove[];
  onSelect: (pieceId: string) => void;
  onMove: (move: LegalMove) => void;
  specialMoves?: LegalMove[];
  specialSelectableIds?: string[];
  onEmptyCell?: (position: Position) => void;
  onPoopSelect?: (position: Position) => void;
  selectedPoop?: Position;
  interactionError?: string;
}

export const Board = memo(function Board({
  state,
  playerId,
  selectedId,
  availableMoves,
  onSelect,
  onMove,
  specialMoves,
  specialSelectableIds,
  onEmptyCell,
  onPoopSelect,
  selectedPoop,
  interactionError
}: BoardProps) {
  const [optimisticMove, setOptimisticMove] = useState<{
    pieceId: string;
    to: Position;
    direction: Direction;
  }>();
  const viewer = state.players.find((player) => player.id === playerId);
  const rotation = rotationFor(viewer?.colors[0]);
  const selectedPiece = state.pieces.find((piece) => piece.id === selectedId && !piece.scored);
  const selectedMoves =
    specialMoves ?? (selectedId ? availableMoves.filter((move) => move.pieceId === selectedId) : []);
  const directionControls = selectedMoves.flatMap((move) => {
    if (!selectedPiece || move.scores) return [];
    const position = adjacent(selectedPiece.position, move.direction);
    return inside(position) ? [{ move, position }] : [];
  });
  const projectedMoves =
    selectedPiece?.kind === "penguin" ? selectedMoves.filter((move) => !move.scores) : [];
  const pieces = useMemo(() => state.pieces.filter((piece) => !piece.scored), [state.pieces]);
  const playerById = useMemo(
    () => new Map(state.players.map((player) => [player.id, player])),
    [state.players]
  );
  const selectableIds = useMemo(
    () => new Set(specialSelectableIds ?? availableMoves.map((move) => move.pieceId)),
    [availableMoves, specialSelectableIds]
  );
  const sideColors = useMemo(
    () =>
      Object.fromEntries(
        COLOR_ORDER.map((color) => {
          const owner = state.players.find((player) => player.colors.includes(color));
          return [color, owner ? PLAYER_COLOR_HEX[owner.themeColor] : COLOR_HEX[color]];
        })
      ) as Record<Color, string>,
    [state.players]
  );

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

  useEffect(() => {
    if (interactionError) setOptimisticMove(undefined);
  }, [interactionError]);

  const submitMove = (requested: LegalMove) => {
    if (!requested.scores)
      setOptimisticMove({
        pieceId: requested.pieceId,
        to: { ...requested.to },
        direction: requested.direction
      });
    onMove(requested);
  };

  const handleBoardClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!onEmptyCell) return;
    const target =
      event.target instanceof Element ? event.target.closest<SVGRectElement>("rect[data-board-cell]") : null;
    const coordinates = target?.dataset.boardCell?.split(",").map(Number);
    if (coordinates?.length === 2) onEmptyCell({ x: coordinates[0]!, y: coordinates[1]! });
  };

  return (
    <div className="board-frame" aria-label="Slidescape game board">
      <svg
        viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
        role="grid"
        className="board"
        style={{ rotate: `${rotation}deg` }}
        onClick={handleBoardClick}
      >
        <rect width={BOARD_SIZE} height={BOARD_SIZE} rx=".12" className="board-base" />
        {BOARD_CELLS}
        {GRID_LINES}
        <GoalGuards colors={sideColors} />
        {projectedMoves.map((move) => (
          <rect
            key={`projection-${move.direction}`}
            x={move.to.x + 0.08}
            y={move.to.y + 0.08}
            width=".84"
            height=".84"
            rx=".14"
            className="projected-cell"
            aria-hidden="true"
          />
        ))}
        {state.fenceActive ? (
          <g className="elephant-seal-fence" aria-label="elephant seal fence">
            <rect
              x="6.08"
              y="6.08"
              width="1.84"
              height="1.84"
              rx=".16"
              className="elephant-seal-fence-frame"
            />
            {FENCE_POSITIONS.map((position) => (
              <rect
                key={positionKey(position)}
                x={position.x + 0.12}
                y={position.y + 0.12}
                width=".76"
                height=".76"
                rx=".1"
                className="elephant-seal-fence-ice"
              />
            ))}
          </g>
        ) : null}
        {state.poop.map((poop, index) => (
          <g
            key={`${positionKey(poop)}-${index}`}
            transform={`translate(${poop.x} ${poop.y})`}
            aria-label="poop"
            onClick={() => onPoopSelect?.(poop)}
            className={onPoopSelect ? "selectable" : ""}
          >
            {selectedPoop && positionKey(selectedPoop) === positionKey(poop) ? (
              <circle cx=".5" cy=".5" r=".4" fill="none" stroke="#2f80d0" strokeWidth=".08" />
            ) : null}
            <PoopGlyph />
          </g>
        ))}
        {pieces.map((piece) => (
          <AnimatedPiece
            key={piece.id}
            piece={piece}
            selected={piece.id === selectedId}
            selectable={selectableIds.has(piece.id)}
            fenceActive={state.fenceActive}
            color={piece.ownerId ? PLAYER_COLOR_HEX[playerById.get(piece.ownerId)!.themeColor] : "#ffffff"}
            elephantSealFacing={
              piece.kind === "elephant-seal" && state.fenceActive
                ? startingFacing(viewer?.colors[0])
                : undefined
            }
            positionOverride={optimisticMove?.pieceId === piece.id ? optimisticMove.to : undefined}
            facingOverride={optimisticMove?.pieceId === piece.id ? optimisticMove.direction : undefined}
            onSelect={onSelect}
          />
        ))}
        {directionControls.map(({ move, position }) => (
          <g
            key={`control-${move.direction}`}
            transform={`translate(${position.x} ${position.y})`}
            className="move-control"
            role="button"
            aria-label={`Slide ${move.direction} to row ${move.to.y + 1}, column ${move.to.x + 1}`}
            onClick={(event) => {
              event.stopPropagation();
              submitMove(move);
            }}
          >
            <rect x=".14" y=".14" width=".72" height=".72" rx=".28" />
            <path
              d="M.5 .3L.34 .48h.1v.22h.12V.48h.1z"
              transform={`rotate(${directionRotation(move.direction)} .5 .5)`}
            />
          </g>
        ))}
        {selectedMoves
          .filter((move) => move.scores)
          .map((move) => {
            const x = move.to.x + 0.5;
            const y = move.to.y + 0.5;
            return (
              <g
                key={`score-${move.direction}`}
                className="score-arrow"
                onClick={() => submitMove(move)}
                transform={`translate(${x} ${y}) rotate(${directionRotation(move.direction)})`}
              >
                <circle r=".36" />
                <path d="M0-.22L-.16 0h.1v.22h.12V0h.1z" />
              </g>
            );
          })}
      </svg>
    </div>
  );
});
