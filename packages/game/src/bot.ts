import { FENCE_POSITIONS, GOAL_GUARD_BOUNDARIES, GOAL_LANES } from "./config.js";
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
const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
const COLORS: Color[] = ["green", "yellow", "red", "blue"];

const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const inside = ({ x, y }: Position) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
const posKey = ({ x, y }: Position) => `${x},${y}`;
const manhattan = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cellIndex = ({ x, y }: Position) => y * BOARD_SIZE + x;
const step = (position: Position, direction: Direction): Position => ({
  x: position.x + DELTA[direction].x,
  y: position.y + DELTA[direction].y
});

// The fixed direction each color travels to reach its own goal edge. Used
// only to propose candidate elephant-seal targets below, not for evaluation.
const HOME_DIRECTION: Record<Color, Direction> = { green: "down", yellow: "left", red: "up", blue: "right" };

// Mirrors engine.ts's private crossesGoalGuard: the goal edge is walled off
// except for the two-wide lane in front of it, so a piece can't just slide
// sideways along the edge into its goal from anywhere -- it has to already
// be lined up with the lane before it gets there.
function crossesGoalGuard(from: Position, to: Position): boolean {
  if (from.y === to.y && (from.y === 0 || from.y === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.x, to.x));
  }
  if (from.x === to.x && (from.x === 0 || from.x === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.y, to.y));
  }
  return false;
}

// --- goal-distance map ---
//
// A plain "how many squares until the goal edge" axis distance is actively
// misleading here: it rewards parking a piece just outside its lane against
// the guarded edge as "almost home," when that square is actually a dead
// end (the guard wall blocks sliding along the edge into the lane from
// outside it). This does a real breadth-first search over single-step
// adjacency, respecting the guard, so a piece only reads as "close" when it
// actually has an open route into its own lane.
const MAX_GOAL_DISTANCE = 40;

function goalDistances(color: Color, blockers: Set<number>): Int16Array {
  const dist = new Int16Array(BOARD_SIZE * BOARD_SIZE).fill(-1);
  const queue: Position[] = [];
  for (const goal of GOAL_LANES[color]) {
    const index = cellIndex(goal);
    if (blockers.has(index)) continue;
    dist[index] = 0;
    queue.push(goal);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    const nextDist = dist[cellIndex(current)]! + 1;
    for (const direction of DIRECTIONS) {
      const next = step(current, direction);
      if (!inside(next) || crossesGoalGuard(current, next)) continue;
      const index = cellIndex(next);
      if (blockers.has(index) || dist[index] !== -1) continue;
      dist[index] = nextDist;
      queue.push(next);
    }
  }
  return dist;
}

// One shared occupied-cell set, then one BFS per color (not per piece --
// pieces of the same color share a map). A color's own pieces are excluded
// from its own blockers: a penguin isn't meaningfully blocked by itself, and
// treating teammates as passable keeps this to exactly 4 BFS passes
// regardless of how many pieces are on the board.
function buildGoalDistanceMaps(state: GameState): Record<Color, Int16Array> {
  const baseline = new Set<number>();
  for (const piece of state.pieces) if (!piece.scored) baseline.add(cellIndex(piece.position));
  if (state.fenceActive) for (const position of FENCE_POSITIONS) baseline.add(cellIndex(position));

  const sameColorIndices: Record<Color, number[]> = { green: [], yellow: [], red: [], blue: [] };
  for (const piece of state.pieces) {
    if (piece.color && !piece.scored) sameColorIndices[piece.color].push(cellIndex(piece.position));
  }

  const maps = {} as Record<Color, Int16Array>;
  for (const color of COLORS) {
    const blockers = new Set(baseline);
    for (const index of sameColorIndices[color]) blockers.delete(index);
    maps[color] = goalDistances(color, blockers);
  }
  return maps;
}

// Concave, not linear: a piece already near its goal loses a lot of value
// for each extra square of distance (finishing the job matters a lot), but
// a piece that's already stuck far from its lane -- e.g. parked against the
// guarded edge one column off, needing a multi-move detour back around --
// loses comparatively little for temporarily drifting even farther as part
// of that detour. A linear scale punishes that necessary "backward" step
// just as harshly as it punishes losing ground near the goal, which made
// the search prefer never touching an already-bad piece at all over
// spending moves to actually fix it.
function progressValue(dist: number): number {
  const clamped = dist < 0 ? MAX_GOAL_DISTANCE : Math.min(dist, MAX_GOAL_DISTANCE);
  return MAX_GOAL_DISTANCE - Math.sqrt(clamped * MAX_GOAL_DISTANCE);
}

// --- heuristic evaluation ---
//
// Higher is always better for `botId`. All weights live on the same rough
// scale so board-quality and card-economy decisions can be compared
// directly. `threats` is the set of opponent piece ids that had an
// immediate scoring move available in the state the search started from --
// carried through so every candidate can be checked for whether it still
// leaves that door open.

const SCORE_WEIGHT = 1_000;
// Own progress is summed across the whole fleet and weighted well above the
// opponent term on purpose: the board is shared, so almost any real forward
// move for one of the bot's own pieces also incidentally opens or closes a
// few cells of somebody else's path. If both terms carried equal weight,
// that incidental, easily-reversible side effect could outweigh the bot's
// own concrete progress, and the "safe" choice would always be to shuffle an
// inert ice block back and forth forever rather than ever risk moving a
// penguin -- which is exactly the passivity this is designed to avoid. Acute
// danger (an opponent one move from scoring) is handled separately and much
// more strongly by THREAT_PENALTY below, so this term only has to cover
// everyday jockeying for position, not the "are they about to win" question.
const OWN_PROGRESS_WEIGHT = 12;
const OPPONENT_PROGRESS_WEIGHT = 3;
const FISH_CARD_WEIGHT = 25;
const THREAT_PENALTY = 500;

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

// How many of the pieces that could score immediately (as of when the
// search started) still can, in this candidate state. Only ever non-zero
// for opponent pieces (see computeOpponentScoringThreats), so it's always a
// straight penalty -- no sign flip needed.
function remainingThreatPenalty(state: GameState, threats: readonly string[]): number {
  if (threats.length === 0) return 0;
  let count = 0;
  for (const pieceId of threats) {
    if (legalMovesForPiece(state, pieceId).some((candidate) => candidate.scores)) count += 1;
  }
  return count * THREAT_PENALTY;
}

// Opponent penguins that can escape on their very next move, given the
// current board. Computed once per decision from the real state (not
// re-derived per search node) and then re-checked per candidate via
// remainingThreatPenalty, so the search feels the urgency of a piece it's
// about to let slip through, not just generic opponent progress.
function computeOpponentScoringThreats(state: GameState, actorId: string): string[] {
  const threats: string[] = [];
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.ownerId || piece.ownerId === actorId) continue;
    if (legalMovesForPiece(state, piece.id).some((candidate) => candidate.scores)) threats.push(piece.id);
  }
  return threats;
}

function evaluate(state: GameState, botId: string, threats: readonly string[] = []): number {
  let total = 0;

  for (const player of state.players) {
    const sign = player.id === botId ? 1 : -1;
    total += sign * player.score * SCORE_WEIGHT;
    if (player.fishCard) total += sign * FISH_CARD_WEIGHT;
  }

  // The bot wants its *whole* fleet advancing, so its own pieces are summed.
  // Opponents are judged only by their single most-advanced piece per
  // player: that's the actual near-term threat. Summing across an entire
  // opposing fleet would let one ice/seal placement that marginally nudges
  // several of their pieces at once outweigh a real, concrete move forward
  // for the bot's own penguins -- exactly the kind of aggregate,
  // easily-disturbed advantage a piece can obsessively chase back and forth
  // without ever committing to it.
  const distanceMaps = buildGoalDistanceMaps(state);
  let ownProgress = 0;
  const bestOpponentProgress = new Map<string, number>();
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || !piece.ownerId) continue;
    const dist = distanceMaps[piece.color]![cellIndex(piece.position)]!;
    const value = progressValue(dist);
    if (piece.ownerId === botId) {
      ownProgress += value;
    } else {
      const current = bestOpponentProgress.get(piece.ownerId);
      if (current === undefined || value > current) bestOpponentProgress.set(piece.ownerId, value);
    }
  }
  total += ownProgress * OWN_PROGRESS_WEIGHT;
  for (const value of bestOpponentProgress.values()) total -= value * OPPONENT_PROGRESS_WEIGHT;

  total -= remainingThreatPenalty(state, threats);

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

function expandLite(state: GameState, actorId: string, threats: readonly string[]): LiteNode[] {
  return legalMoves(state, actorId).map((candidate) => {
    const after = simulateMoveForSearch(state, actorId, candidate);
    return { candidate, after, value: evaluate(after, actorId, threats) };
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
function bestContinuationValue(
  state: GameState,
  actorId: string,
  depth: number,
  threats: readonly string[]
): number {
  const nodes = expandLite(state, actorId, threats);
  if (nodes.length === 0) return evaluate(state, actorId, threats);
  nodes.sort((a, b) => b.value - a.value);
  if (depth <= 1 || nodes.length > WIDE_BRANCHING_CUTOFF) return nodes[0]!.value;
  const beam = nodes.slice(0, SEARCH_BEAM_WIDTH);
  let best = beam[0]!.value;
  for (const node of beam) {
    let value = node.value;
    if (canContinue(node.after, actorId))
      value = Math.max(value, bestContinuationValue(node.after, actorId, depth - 1, threats));
    if (value > best) best = value;
  }
  return best;
}

// A small, root-level-only tie-breaker: among moves that otherwise look
// equally (in)different -- most often several ways to shuffle an inert ice
// block around -- prefer whichever leaves the *moved piece itself* with
// more follow-up options. That's what makes clearing your own ice away from
// in front of your own boxed-in penguin beat shuffling some unrelated ice
// block back and forth: freeing that penguin doesn't improve its goal
// distance yet, but it does open up a new legal slide next turn, which this
// rewards immediately instead of only after the fact.
//
// Two things keep it cheap: it checks only the single piece that moved
// (not the whole board's mobility), and it is applied only to root
// candidates already within MOBILITY_TIEBREAK_BAND of the best -- since it
// is purely a tie-breaker, computing it for clearly-worse candidates would
// be wasted work. It never runs inside the recursive lookahead, so it can't
// multiply through the search tree.
const MOBILITY_WEIGHT = 2;
const MOBILITY_TIEBREAK_BAND = 40;

// Picks the single best next move for `actorId`, looking `depth` moves ahead
// within this turn. Lookahead scoring uses the cheap lite simulation above;
// only the winning root candidate is ever committed via the real engine.
function searchBestMove(
  state: GameState,
  actorId: string,
  depth: number,
  threats: readonly string[]
): SearchResult | undefined {
  const nodes = expandLite(state, actorId, threats);
  if (nodes.length === 0) return undefined;
  nodes.sort((a, b) => b.value - a.value);
  const tieBreakFloor = nodes[0]!.value - MOBILITY_TIEBREAK_BAND;
  for (const node of nodes) {
    if (node.value < tieBreakFloor) break;
    node.value += legalMovesForPiece(node.after, node.candidate.pieceId).length * MOBILITY_WEIGHT;
  }
  nodes.sort((a, b) => b.value - a.value);

  let bestNode = nodes[0]!;
  let bestValue = bestNode.value;
  if (depth > 1 && nodes.length <= WIDE_BRANCHING_CUTOFF) {
    for (const node of nodes.slice(0, SEARCH_BEAM_WIDTH)) {
      const value = canContinue(node.after, actorId)
        ? Math.max(node.value, bestContinuationValue(node.after, actorId, depth - 1, threats))
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

function chooseElephantSealAction(
  state: GameState,
  actorId: string,
  threats: readonly string[]
): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth, threats);

  let best: { after: GameState; value: number } | undefined;
  for (const to of elephantSealTargets(state, actorId)) {
    const leavePoopOptions = state.poop.length > 0 || state.poopSupply > 0 ? [true, false] : [false];
    for (const leavePoop of leavePoopOptions) {
      let after: GameState;
      try {
        after = placeElephantSealAndPoop(state, actorId, to, { leavePoop });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId, threats);
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

function tryPlayFlyover(
  state: GameState,
  actorId: string,
  threats: readonly string[]
): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "flyover" || !alreadyUsable(state, actorId)) return undefined;
  if (state.turn.movesRemaining <= 0) return undefined;
  const baseline = searchBestMove(state, actorId, 1, threats);
  let withFlyover: GameState;
  try {
    withFlyover = playFish(state, actorId, { cardId: "flyover" });
  } catch {
    return undefined;
  }
  const withFlyoverBest = searchBestMove(withFlyover, actorId, 1, threats);
  if (!withFlyoverBest) return undefined;
  const baselineValue = baseline ? baseline.value : evaluate(state, actorId, threats);
  if (withFlyoverBest.value <= baselineValue + FLYOVER_MIN_GAIN) return undefined;
  return { state: withFlyover, kind: "fish" };
}

function trySabotageWithMoveOpponent(
  state: GameState,
  actorId: string,
  threats: readonly string[]
): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "move-opponent" || !alreadyUsable(state, actorId)) return undefined;

  let best: { after: GameState; value: number } | undefined;
  for (const piece of state.pieces) {
    if (piece.kind === "elephant-seal" || piece.scored || !piece.ownerId || piece.ownerId === actorId)
      continue;
    for (const candidate of legalMovesForPiece(state, piece.id)) {
      let after: GameState;
      try {
        after = playFish(state, actorId, { cardId: "move-opponent", move: candidate });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId, threats);
      if (!best || value > best.value) best = { after, value };
    }
  }
  if (!best) return undefined;
  if (best.value <= evaluate(state, actorId, threats) + SABOTAGE_MIN_GAIN) return undefined;
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

function chooseDrawFishOrMove(
  state: GameState,
  actorId: string,
  threats: readonly string[]
): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth, threats);
  let drawn: GameState | undefined;
  try {
    drawn = drawFish(state, actorId);
  } catch {
    drawn = undefined;
  }
  if (drawn) {
    const drawnValue = evaluate(drawn, actorId, threats);
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
    const threats = computeOpponentScoringThreats(state, actorId);
    const best = searchBestMove(state, actorId, 1, threats);
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

    // Snapshot which opponent pieces can score right now, before considering
    // any of the bot's own candidates -- this is what lets the search prefer
    // shutting that down over merely advancing its own pieces.
    const threats = computeOpponentScoringThreats(state, actorId);

    if ((state.turn.elephantSealRelocationsRemaining ?? 0) > 0 && state.turn.movesRemaining > 0) {
      const sealChoice = chooseElephantSealAction(state, actorId, threats);
      if (sealChoice) return sealChoice;
    }

    if (
      state.turn.movesRemaining === 2 &&
      state.turn.fishDrawAvailable &&
      !state.turn.fishForbidden &&
      !active.fishCard
    ) {
      const drawChoice = chooseDrawFishOrMove(state, actorId, threats);
      if (drawChoice) return drawChoice;
    }

    if (state.turn.movesRemaining > 0) {
      const sabotage = trySabotageWithMoveOpponent(state, actorId, threats);
      if (sabotage) return sabotage;

      const flyoverPlay = tryPlayFlyover(state, actorId, threats);
      if (flyoverPlay) return flyoverPlay;

      const best = searchBestMove(state, actorId, SEARCH_MAX_DEPTH, threats);
      if (best) return { state: best.after, kind: "move" };
    }

    const relocate = tryPlayRelocateAndRoll(state, actorId);
    if (relocate) return relocate;
  }

  return { state: endTurn(state, actorId), kind: "end-turn" };
}
