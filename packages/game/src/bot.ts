import { FENCE_POSITIONS } from "./config.js";
import {
  drawFish,
  endTurn,
  legalMoves,
  legalMovesForPiece,
  move,
  placeElephantSealAndPoop,
  playFish,
  resolvePoopChoice,
  roll
} from "./engine.js";
import {
  BOARD_SIZE,
  type Color,
  type Direction,
  type FishPlay,
  type GameState,
  type LegalMove,
  type Piece,
  type PoopCardId,
  type Position
} from "./types.js";

export type BotActionKind = "roll" | "move" | "choice" | "end-turn" | "fish" | "draw-fish" | "elephant-seal";

export interface BotActionResult {
  state: GameState;
  kind: BotActionKind;
}

// --- small geometry helpers (mirrors of the private ones in engine.ts) ---

const DELTA: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
};

const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const inside = ({ x, y }: Position) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
const posKey = ({ x, y }: Position) => `${x},${y}`;
const manhattan = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const step = (position: Position, direction: Direction): Position => ({
  x: position.x + DELTA[direction].x,
  y: position.y + DELTA[direction].y
});

// The fixed direction each color travels to reach its own goal edge.
const HOME_DIRECTION: Record<Color, Direction> = { green: "down", yellow: "left", red: "up", blue: "right" };

// 0 (at start line) .. BOARD_SIZE - 1 (touching the goal edge), regardless of color.
const PROGRESS: Record<Color, (position: Position) => number> = {
  green: (p) => p.y,
  red: (p) => BOARD_SIZE - 1 - p.y,
  yellow: (p) => BOARD_SIZE - 1 - p.x,
  blue: (p) => p.x
};

// --- heuristic evaluation ---
//
// Higher is always better for `botId`. All weights live on the same rough
// scale (a handful of points per square of progress) so board-quality and
// card-economy decisions can be compared directly.

const SCORE_WEIGHT = 1_000;
const PROGRESS_WEIGHT = 10;
const BLOCK_WEIGHT = 15;
const FISH_CARD_WEIGHT = 25;

function pendingPoopPenalty(state: GameState): number {
  const player = state.players.find((candidate) => candidate.id === state.turn.activePlayerId);
  if (!player) return 0;
  const severity: Record<PoopCardId, number> = {
    "return-penguin": player.score > 0 ? 100 : 0,
    "skip-turn": 50,
    "two-move-turn": 20,
    "opponent-moves": 15,
    "discard-fish": player.fishCard ? 25 : 0
  };
  return state.turn.pendingPoop.reduce((total, card) => total + severity[card], 0);
}

function evaluate(state: GameState, botId: string): number {
  let total = 0;

  for (const player of state.players) {
    const sign = player.id === botId ? 1 : -1;
    total += sign * player.score * SCORE_WEIGHT;
    if (player.fishCard) total += sign * FISH_CARD_WEIGHT;
  }

  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || !piece.ownerId) continue;
    const sign = piece.ownerId === botId ? 1 : -1;
    total += sign * PROGRESS[piece.color](piece.position) * PROGRESS_WEIGHT;
  }

  // Ice blocks and the elephant seal sitting directly ahead of an opposing
  // penguin's home lane are worth something: they choke that piece's slide.
  for (const blocker of state.pieces) {
    if (blocker.kind === "penguin" || blocker.scored) continue;
    for (const penguin of state.pieces) {
      if (penguin.kind !== "penguin" || penguin.scored || !penguin.color || !penguin.ownerId) continue;
      if (!same(step(penguin.position, HOME_DIRECTION[penguin.color]), blocker.position)) continue;
      total += (penguin.ownerId === botId ? -1 : 1) * BLOCK_WEIGHT;
    }
  }

  const penalty = pendingPoopPenalty(state);
  total += (state.turn.activePlayerId === botId ? -1 : 1) * penalty;

  return total;
}

// --- bounded-depth, bounded-width search over the bot's own remaining moves ---
//
// Every move spent this turn belongs to the same actor, so this is plain
// maximization (no adversary to model) over a shallow, pruned tree. Depth and
// beam width are capped so a single decision stays well under a millisecond
// budget of board clones.

const SEARCH_MAX_DEPTH = 2;
const SEARCH_BEAM_WIDTH = 4;
// High-branching turns (many movable pieces/directions at once) fall back to
// a plain 1-ply greedy pick instead of paying for a second ply, so the worst
// case stays bounded regardless of board size or player count.
const WIDE_BRANCHING_CUTOFF = 20;

interface SearchResult {
  move: LegalMove;
  after: GameState;
  value: number;
}

// A stand-in for whichever Poop card would actually be drawn, used only to
// make lookahead nodes feel the (approximate) sting of crossing poop without
// paying to touch the real deck. Moderate severity keeps the bot cautious
// without being paranoid.
const ASSUMED_POOP_CARD: PoopCardId = "two-move-turn";

// Cheap, throwaway state used purely for scoring deeper plies. It mirrors
// applyMoveUnchecked's effects on pieces/score/poop but skips everything
// `move()` normally has to do to be safe for real play (cloning decks/log,
// re-deriving and matching against `legalMoves`, drawing real cards). The
// candidate always comes from `legalMoves`, so it is legal by construction;
// only the single move actually committed by the bot is ever replayed
// through the real engine.
function simulateMoveForSearch(state: GameState, actorId: string, candidate: LegalMove): GameState {
  const pieces = state.pieces.map((piece) => (piece.id === candidate.pieceId ? { ...piece } : piece));
  const piece = pieces.find((candidatePiece) => candidatePiece.id === candidate.pieceId)!;
  const players = state.players.map((player) => ({ ...player, effects: { ...player.effects } }));

  piece.facing = candidate.direction;
  if (candidate.scores) {
    piece.scored = true;
    piece.position = { x: -1, y: -1 };
    const owner = players.find((player) => player.id === piece.ownerId);
    if (owner) owner.score += 1;
  } else {
    piece.position = { ...candidate.to };
  }
  if (candidate.usesFlyover) {
    const mover = players.find((player) => player.id === state.turn.activePlayerId);
    if (mover) mover.effects.flyoverCharges = Math.max(0, mover.effects.flyoverCharges - 1);
  }

  let poop = state.poop;
  let pendingPoop = state.turn.pendingPoop;
  let poopSupply = state.poopSupply;
  if (candidate.crossesPoop.length > 0) {
    poop = poop.filter((token) => !candidate.crossesPoop.some((crossed) => same(crossed, token)));
    poopSupply += candidate.crossesPoop.length;
    pendingPoop = [...pendingPoop, ...candidate.crossesPoop.map(() => ASSUMED_POOP_CARD)];
  }

  return {
    ...state,
    pieces,
    players,
    poop,
    poopSupply,
    turn: {
      ...state.turn,
      pendingPoop,
      movesRemaining: Math.max(0, state.turn.movesRemaining - 1),
      fishDrawAvailable: false
    }
  };
}

interface LiteNode {
  candidate: LegalMove;
  after: GameState;
  value: number;
}

function expandLite(state: GameState, actorId: string): LiteNode[] {
  return legalMoves(state, actorId).map((candidate) => {
    const after = simulateMoveForSearch(state, actorId, candidate);
    return { candidate, after, value: evaluate(after, actorId) };
  });
}

function canContinue(state: GameState, actorId: string): boolean {
  return (
    state.turn.activePlayerId === actorId && state.turn.phase === "moving" && state.turn.movesRemaining > 0
  );
}

// Best evaluate() achievable from `state` after up to `depth` more of the
// actor's own moves. Only used to score lookahead nodes -- never touches the
// real engine, so it is cheap enough to call from inside the beam search.
function bestContinuationValue(state: GameState, actorId: string, depth: number): number {
  const nodes = expandLite(state, actorId);
  if (nodes.length === 0) return evaluate(state, actorId);
  nodes.sort((a, b) => b.value - a.value);
  if (depth <= 1 || nodes.length > WIDE_BRANCHING_CUTOFF) return nodes[0]!.value;
  const beam = nodes.slice(0, SEARCH_BEAM_WIDTH);
  let best = beam[0]!.value;
  for (const node of beam) {
    let value = node.value;
    if (canContinue(node.after, actorId)) value = Math.max(value, bestContinuationValue(node.after, actorId, depth - 1));
    if (value > best) best = value;
  }
  return best;
}

// Picks the single best next move for `actorId`, looking `depth` moves ahead
// within this turn. Lookahead scoring uses the cheap lite simulation above;
// only the winning root candidate is ever committed via the real engine.
function searchBestMove(state: GameState, actorId: string, depth: number): SearchResult | undefined {
  const nodes = expandLite(state, actorId);
  if (nodes.length === 0) return undefined;
  nodes.sort((a, b) => b.value - a.value);

  let bestNode = nodes[0]!;
  let bestValue = bestNode.value;
  if (depth > 1 && nodes.length <= WIDE_BRANCHING_CUTOFF) {
    for (const node of nodes.slice(0, SEARCH_BEAM_WIDTH)) {
      const value = canContinue(node.after, actorId)
        ? Math.max(node.value, bestContinuationValue(node.after, actorId, depth - 1))
        : node.value;
      if (value > bestValue) {
        bestValue = value;
        bestNode = node;
      }
    }
  }

  return { move: bestNode.candidate, after: move(state, actorId, bestNode.candidate), value: bestValue };
}

// --- elephant seal relocation (only available right after rolling a 1) ---

function elephantSealTargets(state: GameState, actorId: string): Position[] {
  const seen = new Set<string>();
  const targets: Position[] = [];
  const add = (position: Position) => {
    if (!inside(position) || seen.has(posKey(position))) return;
    seen.add(posKey(position));
    targets.push(position);
  };
  const seal = state.pieces.find((piece) => piece.kind === "elephant-seal");
  if (seal) add(seal.position);
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || piece.ownerId === actorId) continue;
    add(step(piece.position, HOME_DIRECTION[piece.color]));
  }
  return targets.slice(0, 10);
}

function occupiedKeysForPlacement(state: GameState): Set<string> {
  const set = new Set(state.pieces.filter((piece) => !piece.scored).map((piece) => posKey(piece.position)));
  for (const poop of state.poop) set.add(posKey(poop));
  if (state.fenceActive) for (const position of FENCE_POSITIONS) set.add(posKey(position));
  return set;
}

// Which existing poop token to recycle: prefer clearing the one sitting
// closest to the bot's own pieces, since that's the one likeliest to bite it.
function chooseRecyclePoop(state: GameState, actorId: string): Position | undefined {
  if (state.poop.length === 0) return undefined;
  let best = state.poop[0]!;
  let bestScore = -Infinity;
  for (const candidate of state.poop) {
    let score = 0;
    for (const piece of state.pieces) {
      if (piece.kind === "penguin" && piece.ownerId === actorId && !piece.scored)
        score += 1 / (1 + manhattan(piece.position, candidate));
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function chooseElephantSealAction(state: GameState, actorId: string): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth);

  let best: { after: GameState; value: number } | undefined;
  for (const to of elephantSealTargets(state, actorId)) {
    const leavePoopOptions = state.poop.length > 0 || state.poopSupply > 0 ? [true, false] : [false];
    for (const leavePoop of leavePoopOptions) {
      const poopFrom = leavePoop && state.poopSupply <= 0 ? chooseRecyclePoop(state, actorId) : undefined;
      if (leavePoop && state.poopSupply <= 0 && !poopFrom) continue;
      let after: GameState;
      try {
        after = placeElephantSealAndPoop(state, actorId, to, { leavePoop, poopFrom });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId);
      if (!best || value > best.value) best = { after, value };
    }
  }

  if (best && (!normal || best.value > normal.value)) return { state: best.after, kind: "elephant-seal" };
  if (normal) return { state: normal.after, kind: "move" };
  return undefined;
}

// --- Fish cards ---
//
// Only one card can ever be held at a time, so at most one of these fires
// per turn. `double-roll`, and the `start` half of `avoid-or-two` /
// `steal-or-two`, are unconditionally beneficial (pure upside, no cost) and
// are always played the instant they're eligible. `flyover` and
// `move-opponent` are situational and only played when they clear a real
// bar over doing nothing.

const FLYOVER_MIN_GAIN = 8;
const SABOTAGE_MIN_GAIN = 5;

function alreadyUsable(state: GameState, actorId: string): boolean {
  const player = state.players.find((candidate) => candidate.id === actorId);
  return Boolean(player && player.fishDrawnTurn !== state.turn.number);
}

function tryPlayDoubleRoll(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "double-roll" || !alreadyUsable(state, actorId)) return undefined;
  return { state: playFish(state, actorId, { cardId: "double-roll" }), kind: "fish" };
}

function tryStartAvoidOrStealTwo(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (!player || !alreadyUsable(state, actorId)) return undefined;
  if (player.fishCard === "avoid-or-two")
    return { state: playFish(state, actorId, { cardId: "avoid-or-two", choice: "start" }), kind: "fish" };
  if (player.fishCard === "steal-or-two")
    return { state: playFish(state, actorId, { cardId: "steal-or-two", choice: "start" }), kind: "fish" };
  return undefined;
}

const FISH_CARD_PRIORITY = {
  "double-roll": 6,
  "relocate-and-roll": 5,
  "steal-or-two": 4,
  "move-opponent": 3,
  flyover: 2,
  "avoid-or-two": 1
} as const;

function resolvePendingFishChoice(state: GameState, actorId: string): BotActionResult {
  const pending = state.turn.pendingFishChoice!;
  if (pending.cardId === "avoid-or-two") {
    const choice = state.turn.pendingPoop.length > 0 ? "avoid" : "keep-two";
    return { state: playFish(state, actorId, { cardId: "avoid-or-two", choice }), kind: "fish" };
  }
  let target: string | undefined;
  let targetPriority = -1;
  for (const player of state.players) {
    if (player.id === actorId || !player.fishCard) continue;
    const priority = FISH_CARD_PRIORITY[player.fishCard];
    if (priority > targetPriority) {
      targetPriority = priority;
      target = player.id;
    }
  }
  if (target)
    return {
      state: playFish(state, actorId, { cardId: "steal-or-two", choice: "steal", targetPlayerId: target }),
      kind: "fish"
    };
  return { state: playFish(state, actorId, { cardId: "steal-or-two", choice: "keep-two" }), kind: "fish" };
}

function tryPlayFlyover(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "flyover" || !alreadyUsable(state, actorId)) return undefined;
  if (state.turn.movesRemaining <= 0) return undefined;
  const baseline = searchBestMove(state, actorId, 1);
  let withFlyover: GameState;
  try {
    withFlyover = playFish(state, actorId, { cardId: "flyover" });
  } catch {
    return undefined;
  }
  const withFlyoverBest = searchBestMove(withFlyover, actorId, 1);
  if (!withFlyoverBest) return undefined;
  const baselineValue = baseline ? baseline.value : evaluate(state, actorId);
  if (withFlyoverBest.value <= baselineValue + FLYOVER_MIN_GAIN) return undefined;
  return { state: withFlyover, kind: "fish" };
}

function trySabotageWithMoveOpponent(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "move-opponent" || !alreadyUsable(state, actorId)) return undefined;

  let best: { after: GameState; value: number } | undefined;
  for (const piece of state.pieces) {
    if (piece.kind === "elephant-seal" || piece.scored || !piece.ownerId || piece.ownerId === actorId) continue;
    for (const candidate of legalMovesForPiece(state, piece.id)) {
      let after: GameState;
      try {
        after = playFish(state, actorId, { cardId: "move-opponent", move: candidate });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId);
      if (!best || value > best.value) best = { after, value };
    }
  }
  if (!best) return undefined;
  if (best.value <= evaluate(state, actorId) + SABOTAGE_MIN_GAIN) return undefined;
  return { state: best.after, kind: "fish" };
}

function chooseRelocationTarget(state: GameState, actorId: string, poopFrom: Position): Position | undefined {
  const blocked = occupiedKeysForPlacement(state);
  const opponents = state.pieces.filter(
    (piece) => piece.kind === "penguin" && !piece.scored && piece.ownerId && piece.ownerId !== actorId
  );
  let best: Position | undefined;
  let bestScore = -Infinity;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const candidate = { x, y };
      if (same(candidate, poopFrom) || blocked.has(posKey(candidate))) continue;
      let score = 0;
      for (const opponent of opponents) score += 1 / (1 + manhattan(candidate, opponent.position));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }
  return best;
}

function tryPlayRelocateAndRoll(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "relocate-and-roll" || !alreadyUsable(state, actorId)) return undefined;
  if (state.turn.movesRemaining !== 0) return undefined;

  let play: FishPlay = { cardId: "relocate-and-roll" };
  if (state.poop.length > 0) {
    const poopFrom = chooseRecyclePoop(state, actorId) ?? state.poop[0]!;
    const poopTo = chooseRelocationTarget(state, actorId, poopFrom);
    if (!poopTo) return undefined;
    play = { cardId: "relocate-and-roll", poopFrom, poopTo };
  }
  try {
    return { state: playFish(state, actorId, play), kind: "fish" };
  } catch {
    return undefined;
  }
}

function chooseDrawFishOrMove(state: GameState, actorId: string): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth);
  let drawn: GameState | undefined;
  try {
    drawn = drawFish(state, actorId);
  } catch {
    drawn = undefined;
  }
  if (drawn) {
    const drawnValue = evaluate(drawn, actorId);
    if (!normal || drawnValue > normal.value) return { state: drawn, kind: "draw-fish" };
  }
  if (normal) return { state: normal.after, kind: "move" };
  return undefined;
}

function resolveReturnPenguinChoice(state: GameState, actorId: string): GameState {
  const choice = state.turn.pendingChoice!;
  let bestOption = choice.options[0]!;
  for (const option of choice.options) {
    if (option.positions.length > bestOption.positions.length) bestOption = option;
  }
  return resolvePoopChoice(state, actorId, bestOption.pieceId, bestOption.positions[0]!);
}

export function advanceBotAction(state: GameState, actorId: string): BotActionResult {
  const active = state.players.find((player) => player.id === actorId);
  if (!active || state.status !== "playing" || state.turn.activePlayerId !== actorId) {
    throw new Error("The bot is not the active player.");
  }

  if (state.turn.pendingChoice) {
    return { state: resolveReturnPenguinChoice(state, actorId), kind: "choice" };
  }

  if (state.turn.pendingFishChoice) {
    return resolvePendingFishChoice(state, actorId);
  }

  if (state.turn.phase === "awaiting-roll" && state.turn.forcedPieceOwnerIds?.length) {
    const best = searchBestMove(state, actorId, 1);
    if (best) return { state: best.after, kind: "move" };
    return { state: roll(state, actorId), kind: "roll" };
  }

  if (state.turn.phase === "awaiting-roll") {
    return { state: roll(state, actorId), kind: "roll" };
  }

  if (state.turn.phase === "moving") {
    const doubleRoll = tryPlayDoubleRoll(state, actorId);
    if (doubleRoll) return doubleRoll;

    const startAvoidOrSteal = tryStartAvoidOrStealTwo(state, actorId);
    if (startAvoidOrSteal) return startAvoidOrSteal;

    if ((state.turn.elephantSealRelocationsRemaining ?? 0) > 0 && state.turn.movesRemaining > 0) {
      const sealChoice = chooseElephantSealAction(state, actorId);
      if (sealChoice) return sealChoice;
    }

    if (
      state.turn.movesRemaining === 2 &&
      state.turn.fishDrawAvailable &&
      !state.turn.fishForbidden &&
      !active.fishCard
    ) {
      const drawChoice = chooseDrawFishOrMove(state, actorId);
      if (drawChoice) return drawChoice;
    }

    if (state.turn.movesRemaining > 0) {
      const sabotage = trySabotageWithMoveOpponent(state, actorId);
      if (sabotage) return sabotage;

      const flyoverPlay = tryPlayFlyover(state, actorId);
      if (flyoverPlay) return flyoverPlay;

      const best = searchBestMove(state, actorId, SEARCH_MAX_DEPTH);
      if (best) return { state: best.after, kind: "move" };
    }

    const relocate = tryPlayRelocateAndRoll(state, actorId);
    if (relocate) return relocate;
  }

  return { state: endTurn(state, actorId), kind: "end-turn" };
}
