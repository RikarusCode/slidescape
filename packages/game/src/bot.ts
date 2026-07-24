import { FENCE_POSITIONS, GOAL_GUARD_BOUNDARIES, GOAL_LANES, SCORE_TARGET } from "./config.js";
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
import { nextRandom } from "./random.js";
import {
  BOARD_SIZE,
  type Color,
  type Direction,
  type FishCardId,
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
  // Principal variation: the bot's own remaining planned moves this turn AFTER
  // the committed action, best-first. Only populated for "move" actions. The
  // pacing driver carries this forward so a shorter, time-boxed search on the
  // next move can re-score the same plan to full depth and never "forget" it.
  plan?: LegalMove[];
}

export interface BotActionOptions {
  // Cap the move search depth (the pacing driver raises this level-by-level for
  // anytime iterative deepening). Defaults to SEARCH_MAX_DEPTH.
  maxDepth?: number;
  // A carried-forward principal variation to anchor the move search (coherence).
  plan?: LegalMove[];
}

// =====================================================================
// Geometry helpers (mirror the private ones in engine.ts so the bot can
// reason about slides without paying to run the full engine).
// =====================================================================

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

// The fixed direction each color slides to reach its own goal edge.
const HOME_DIRECTION: Record<Color, Direction> = { green: "down", yellow: "left", red: "up", blue: "right" };
// Whether a color's goal "lane track" is a pair of columns (x) or rows (y).
const LANE_IS_COLUMN: Record<Color, boolean> = { green: true, red: true, yellow: false, blue: false };
const LANE_TRACK = [6, 7];

// Mirrors engine crossesGoalGuard: the goal edge is walled off except for the
// 2-wide lane opening, so a piece can't slide sideways along the edge into the
// goal from outside the lane -- it must already be lined up.
function crossesGoalGuard(from: Position, to: Position): boolean {
  if (from.y === to.y && (from.y === 0 || from.y === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.x, to.x));
  }
  if (from.x === to.x && (from.x === 0 || from.x === BOARD_SIZE - 1)) {
    return GOAL_GUARD_BOUNDARIES.some((boundary) => boundary === Math.max(from.y, to.y));
  }
  return false;
}

// Mirrors engine exitsThroughGoal: true when a penguin already sitting on its
// goal-edge lane cell would slide outward through the opening (i.e. score).
function exitsThroughGoal(color: Color, position: Position, direction: Direction): boolean {
  const aligned = GOAL_LANES[color].some((goal) =>
    LANE_IS_COLUMN[color] ? goal.x === position.x : goal.y === position.y
  );
  return (
    aligned &&
    ((color === "green" && direction === "down" && position.y === BOARD_SIZE - 1) ||
      (color === "yellow" && direction === "left" && position.x === 0) ||
      (color === "red" && direction === "up" && position.y === 0) ||
      (color === "blue" && direction === "right" && position.x === BOARD_SIZE - 1))
  );
}

const inLaneTrack = (color: Color, pos: Position) =>
  LANE_TRACK.includes(LANE_IS_COLUMN[color] ? pos.x : pos.y);
const offTrackDistance = (color: Color, pos: Position) =>
  Math.min(...LANE_TRACK.map((t) => Math.abs((LANE_IS_COLUMN[color] ? pos.x : pos.y) - t)));

interface SlideResult {
  stop: Position;
  scores: boolean;
  blocker?: Piece;
}

// Where a penguin of `color` would stop sliding from `from` in `direction`,
// given the occupied board -- and whether that slide scores. This is the
// engine's penguinMove logic minus flyover/poop bookkeeping, which is all the
// bot needs to judge scoring-readiness and who is blocking whom.
function slidePenguin(
  color: Color,
  from: Position,
  direction: Direction,
  occupied: Set<number>,
  pieceAt: Map<number, Piece>
): SlideResult {
  let cursor = from;
  while (true) {
    if (exitsThroughGoal(color, cursor, direction)) return { stop: cursor, scores: true };
    const next = step(cursor, direction);
    if (!inside(next) || crossesGoalGuard(cursor, next)) break;
    const index = cellIndex(next);
    if (occupied.has(index)) return { stop: cursor, scores: false, blocker: pieceAt.get(index) };
    cursor = next;
  }
  return { stop: cursor, scores: false };
}

// =====================================================================
// Goal-distance flood fill (kept as a background gradient for pieces that
// are nowhere near their lane; the tier model below carries the real load).
// =====================================================================

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

// Concave: losing ground near the goal hurts a lot; a far, stuck piece taking
// a necessary backward step as part of a detour barely does. A linear scale
// over-punished that detour and made the search refuse to fix stuck pieces.
function progressValue(dist: number): number {
  const clamped = dist < 0 ? MAX_GOAL_DISTANCE : Math.min(dist, MAX_GOAL_DISTANCE);
  return MAX_GOAL_DISTANCE - Math.sqrt(clamped * MAX_GOAL_DISTANCE);
}

// =====================================================================
// Per-node board summary: occupied cells, a cell->piece map, and one BFS per
// color. Built once per evaluate() call and shared by every term.
// =====================================================================

interface BoardView {
  occupied: Set<number>;
  pieceAt: Map<number, Piece>;
  distanceMaps: Record<Color, Int16Array>;
}

function buildBoardView(state: GameState): BoardView {
  const occupied = new Set<number>();
  const pieceAt = new Map<number, Piece>();
  for (const piece of state.pieces) {
    if (piece.scored) continue;
    const index = cellIndex(piece.position);
    occupied.add(index);
    pieceAt.set(index, piece);
  }
  if (state.fenceActive) {
    const seal = state.pieces.find((piece) => piece.kind === "elephant-seal");
    for (const position of FENCE_POSITIONS) {
      const index = cellIndex(position);
      occupied.add(index);
      if (seal) pieceAt.set(index, seal);
    }
  }

  // A color's own pieces don't block its own goal reachability (they can move
  // out of the way later); opponents' pieces and ice do. Only colors actually
  // in play get a BFS -- in quick-2 that is 2 of 4, halving this hot path (it
  // runs once per evaluate, per search node).
  const sameColorCells: Record<Color, number[]> = { green: [], yellow: [], red: [], blue: [] };
  const presentColors = new Set<Color>();
  for (const piece of state.pieces) {
    if (!piece.color) continue;
    presentColors.add(piece.color);
    if (!piece.scored) sameColorCells[piece.color].push(cellIndex(piece.position));
  }
  const distanceMaps = {} as Record<Color, Int16Array>;
  for (const color of COLORS) {
    if (!presentColors.has(color)) continue;
    const blockers = new Set(occupied);
    for (const index of sameColorCells[color]) blockers.delete(index);
    distanceMaps[color] = goalDistances(color, blockers);
  }

  return { occupied, pieceAt, distanceMaps };
}

// =====================================================================
// Scoring tiers -- the core reframe. Penguins score by SLIDING into their
// lane, so "how lined up am I" matters far more than raw grid distance.
// =====================================================================

type Tier = "scoring" | "aligned" | "setup" | "far";

interface TierResult {
  tier: Tier;
  blocker?: Piece; // for "aligned": the piece stopping the home slide short.
}

function classifyTier(piece: Piece, view: BoardView): TierResult {
  const color = piece.color!;
  const home = slidePenguin(color, piece.position, HOME_DIRECTION[color], view.occupied, view.pieceAt);
  if (home.scores) return { tier: "scoring" };
  if (inLaneTrack(color, piece.position)) return { tier: "aligned", blocker: home.blocker };
  // One slide onto the lane track (needs a backstop to stop it there).
  for (const direction of DIRECTIONS) {
    const slide = slidePenguin(color, piece.position, direction, view.occupied, view.pieceAt);
    if (!same(slide.stop, piece.position) && inLaneTrack(color, slide.stop)) return { tier: "setup" };
  }
  return { tier: "far" };
}

// =====================================================================
// Evaluation. Higher is better for `botId`. All weights share one scale
// anchored at "an escaped penguin = 1000".
// =====================================================================

const SCORE_WEIGHT = 1_000;
const WIN_WEIGHT = 100_000; // a reached target must dwarf any positional term.

// Tunable evaluation weights. These were fitted by self-play tuning (see the
// tuning harness in the repo history); they are grouped here so they can be
// swept without touching the logic. `__setBotWeights` (bottom of file) lets a
// tuning script override them at runtime without recompiling.
interface Weights {
  scoringReady: number; // in lane, clear shot to the edge -- a banked point.
  aligned: number; // in the lane track but blocked short.
  setup: number; // one slide from landing in the lane track.
  lateral: number; // -lateral * sqrt(cells off the lane track).
  ownProgress: number; // demoted BFS gradient, mainly for far pieces.
  oppProgress: number; // opponents scored by their single best piece.
  oppScoring: number; // penalty per opponent one slide from scoring.
  block: number; // we are the piece stopping an aligned opponent short.
  fishHeld: number; // baseline value of holding any Fish card.
  offenseUrgency: number; // multiplier on own scoring terms when we're 1 from a win.
  defenseUrgency: number; // multiplier on defense terms when an opponent is 1 from a win.
}

const DEFAULT_WEIGHTS: Weights = {
  scoringReady: 320,
  aligned: 130,
  setup: 70,
  lateral: 10,
  ownProgress: 4,
  oppProgress: 2,
  oppScoring: 600,
  block: 40,
  fishHeld: 30,
  offenseUrgency: 1.4,
  defenseUrgency: 1.8
};

let W: Weights = { ...DEFAULT_WEIGHTS };

// Relative desirability of each Fish card (scaled by W.fishHeld / 30 so a
// single knob can move overall card value during tuning while preserving the
// cards' ordering).
const FISH_CARD_RELATIVE: Record<FishCardId, number> = {
  "double-roll": 40,
  "relocate-and-roll": 40,
  "steal-or-two": 30,
  "move-opponent": 30,
  flyover: 20,
  "avoid-or-two": 20
};
const fishCardValue = (card: FishCardId): number => FISH_CARD_RELATIVE[card] * (W.fishHeld / 30);

interface Urgency {
  offense: number;
  defense: number;
}

function computeUrgency(state: GameState, botId: string): Urgency {
  const target = SCORE_TARGET[state.mode];
  let me = 0;
  let maxOpp = 0;
  for (const player of state.players) {
    if (player.id === botId) me = player.score;
    else maxOpp = Math.max(maxOpp, player.score);
  }
  return {
    offense: me < target && target - me <= 1 ? W.offenseUrgency : 1,
    defense: target - maxOpp <= 1 ? W.defenseUrgency : 1
  };
}

function poopSeverity(card: PoopCardId, holdsFish: boolean, hasScore: boolean): number {
  switch (card) {
    case "return-penguin":
      return hasScore ? 220 : 0; // a full -1 point swing.
    case "skip-turn":
      return 50;
    case "discard-fish":
      return holdsFish ? 25 : 0;
    case "two-move-turn":
      return 20;
    case "opponent-moves":
      return 15;
  }
}

function pendingPoopPenalty(state: GameState): number {
  if (state.turn.pendingPoop.length === 0) return 0;
  const player = state.players.find((candidate) => candidate.id === state.turn.activePlayerId);
  if (!player) return 0;
  return state.turn.pendingPoop.reduce(
    (total, card) => total + poopSeverity(card, Boolean(player.fishCard), player.score > 0),
    0
  );
}

function evaluate(state: GameState, botId: string): number {
  let total = 0;
  const urgency = computeUrgency(state, botId);
  const target = SCORE_TARGET[state.mode];

  // Material + terminal.
  for (const player of state.players) {
    const sign = player.id === botId ? 1 : -1;
    total += sign * player.score * SCORE_WEIGHT;
    if (player.fishCard) total += sign * fishCardValue(player.fishCard);
    if (player.score >= target) total += sign * WIN_WEIGHT;
  }

  const view = buildBoardView(state);

  let ownTierValue = 0;
  let ownProgress = 0;
  const bestOpponentProgress = new Map<string, number>();
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || !piece.ownerId) continue;
    const own = piece.ownerId === botId;
    const { tier, blocker } = classifyTier(piece, view);
    const dist = view.distanceMaps[piece.color]![cellIndex(piece.position)]!;

    if (own) {
      if (tier === "scoring") ownTierValue += W.scoringReady * urgency.offense;
      else if (tier === "aligned") ownTierValue += W.aligned;
      else if (tier === "setup") ownTierValue += W.setup;
      ownTierValue -= W.lateral * Math.sqrt(offTrackDistance(piece.color, piece.position));
      ownProgress += progressValue(dist);
    } else {
      // A scoring-ready opponent is the sharpest signal there is -- captures
      // both "left an existing threat open" and "our move just created one".
      if (tier === "scoring") total -= W.oppScoring * urgency.defense;
      // Reward being the piece that stops an aligned opponent short.
      if (tier === "aligned" && blocker && blocker.ownerId === botId) total += W.block * urgency.defense;
      const value = progressValue(dist);
      const current = bestOpponentProgress.get(piece.ownerId);
      if (current === undefined || value > current) bestOpponentProgress.set(piece.ownerId, value);
    }
  }
  total += ownTierValue;
  total += ownProgress * W.ownProgress;
  for (const value of bestOpponentProgress.values()) total -= value * W.oppProgress;

  // Pending poop lands on whoever's turn it is.
  total += (state.turn.activePlayerId === botId ? -1 : 1) * pendingPoopPenalty(state);

  return total;
}

// =====================================================================
// Cheap lite simulation for lookahead. Mirrors applyMoveUnchecked's effect on
// pieces/score/poop; skips the engine's clone+revalidate+deck work. Candidates
// always come from legalMoves, so they're legal by construction. Only the one
// move the bot actually commits ever goes through the real engine.
// =====================================================================

// Assume crossing poop draws something roughly as bad as a skipped turn -- a
// real deterrent so the search routes penguins around tokens.
const ASSUMED_POOP_CARD: PoopCardId = "skip-turn";

function simulateMoveForSearch(state: GameState, candidate: LegalMove): GameState {
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

// =====================================================================
// Deterministic, board-derived randomness. NEVER derived from state.seed
// (that literally is the next die roll -- using it would be both peeking and
// self-desyncing). A board hash decorrelated from the dice stream gives
// variety across games while staying byte-identical on replay of a seed.
// =====================================================================

function boardHash(state: GameState): number {
  let h = 0x811c9dc5;
  const mix = (value: number) => {
    h ^= value & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (value >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  for (const piece of state.pieces) mix(piece.scored ? 0x3fff : cellIndex(piece.position));
  for (const player of state.players) mix(player.score);
  mix(state.turn.number);
  mix(state.version);
  return h >>> 0;
}

function boardRandom(state: GameState): number {
  return nextRandom(boardHash(state) ^ 0x9e3779b1)[0];
}

// FNV-1a over the game id -- a stable per-game salt. Needed for opening variety
// because the opening board is byte-identical every game, so `boardHash` alone
// would pick the same "random" opening move every time. Mixing the game id in
// varies the pick across games while staying deterministic within one (so
// seeded replays remain identical).
function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Two decorrelated [0,1) draws for the opening pick: one gates whether to
// randomize this move, the other indexes the candidate band. Salted by game id.
function openingRandoms(state: GameState): [number, number] {
  const [gate, cursor] = nextRandom(boardHash(state) ^ hashString(state.id));
  const [pick] = nextRandom(cursor ^ 0x85ebca6b);
  return [gate, pick];
}

// =====================================================================
// Search: fixed-cost, deterministic maximization over the bot's own remaining
// moves this turn. The bot re-plans every call, so depth 2-3 suffices to avoid
// greedy traps; opponents are handled statically by the eval's threat terms.
// =====================================================================

let SEARCH_MAX_DEPTH = 3;
let EVAL_BUDGET = 1_500; // hard, deterministic cap on evaluate() calls per decision.
const ICE_MOVE_BIAS = 3; // gentle nudge to prefer moving penguins in near-ties.
const TIE_EPS = 6; // candidates within this of the best are "equivalent".
const EXPLORE_PROBABILITY = 0.08; // chance to take a near-best alternative for variety.
const EXPLORE_EPS = 12; // exploration never sacrifices more than this much value.

// Opening variety: for each player's first few turns we frequently pick a
// random move from among the top few candidates, so bots don't play identical
// openings game after game. Suppressed once a win is on the line (see `sharp`).
const OPENING_TURNS = 3; // per player.
const OPENING_EXPLORE_PROBABILITY = 0.25; // chance a given opening move is randomized.
const OPENING_TOP_K = 5; // pick uniformly among this many best candidates.
// A blunder guard so the random pick never gifts a position: candidates more
// than this far below the best are excluded from the opening band regardless of
// rank (roughly half a "scoring-ready" penguin).
const OPENING_MAX_SACRIFICE = 200;

const inOpening = (state: GameState): boolean =>
  state.turn.number <= OPENING_TURNS * state.turnOrder.length;

// Beam floor is 4: the anytime driver bounds cost by wall-clock (it stops
// deepening before a level would overrun the budget), so wide turns no longer
// need to collapse to greedy -- keeping >=4 candidates avoids pruning the best
// multi-move setup at the root, which is where narrow beams lose the most.
let BEAM_OVERRIDE = 0; // >0 forces a flat beam (self-play tuning only).
function beamWidthFor(branching: number): number {
  if (BEAM_OVERRIDE > 0) return BEAM_OVERRIDE;
  if (branching <= 8) return 6;
  if (branching <= 16) return 5;
  return 4;
}

const sameMove = (a: LegalMove, b: LegalMove): boolean =>
  a.pieceId === b.pieceId && a.direction === b.direction;

// Score a carried-forward plan by replaying as much of it as is still legal and
// evaluating the end state. O(remaining) -- one line, not a tree -- so even a
// time-starved shallow search can always weigh the plan at its true depth.
function evaluatePlanLine(
  state: GameState,
  actorId: string,
  plan: LegalMove[]
): { value: number; prefix: LegalMove[] } {
  let cursor = state;
  const prefix: LegalMove[] = [];
  for (const planned of plan) {
    if (!canContinue(cursor, actorId)) break;
    const legal = legalMoves(cursor, actorId).find((candidate) => sameMove(candidate, planned));
    if (!legal) break;
    cursor = simulateMoveForSearch(cursor, legal);
    prefix.push(legal);
  }
  return { value: evaluate(cursor, actorId), prefix };
}

function canContinue(state: GameState, actorId: string): boolean {
  return (
    state.turn.activePlayerId === actorId && state.turn.phase === "moving" && state.turn.movesRemaining > 0
  );
}

function candidateBias(candidate: LegalMove, state: GameState): number {
  const piece = state.pieces.find((entry) => entry.id === candidate.pieceId);
  return piece && piece.kind !== "penguin" ? -ICE_MOVE_BIAS : 0;
}

interface ScoredCandidate {
  candidate: LegalMove;
  after: GameState;
  value: number;
  line: LegalMove[]; // best line found from this candidate, starting with it.
}

interface Continuation {
  value: number;
  line: LegalMove[];
}

interface SearchResult {
  move: LegalMove;
  after: GameState;
  value: number;
  line: LegalMove[]; // full principal variation, starting with `move`.
}

// Best evaluate() reachable from `state` within `depth` more of the actor's
// own moves, plus the line that achieves it. Pure lite-sim; the shared budget
// bounds total work.
function bestContinuation(
  state: GameState,
  actorId: string,
  depth: number,
  budget: { evals: number }
): Continuation {
  if (budget.evals <= 0) return { value: evaluate(state, actorId), line: [] };
  const candidates = legalMoves(state, actorId);
  if (candidates.length === 0) return { value: evaluate(state, actorId), line: [] };

  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    if (budget.evals <= 0) break;
    budget.evals -= 1;
    const after = simulateMoveForSearch(state, candidate);
    scored.push({
      candidate,
      after,
      value: evaluate(after, actorId) + candidateBias(candidate, state),
      line: [candidate]
    });
  }
  scored.sort((a, b) => b.value - a.value);
  if (depth <= 1) return { value: scored[0]!.value, line: scored[0]!.line };

  const width = beamWidthFor(candidates.length);
  let best: Continuation = { value: scored[0]!.value, line: scored[0]!.line };
  for (const node of scored.slice(0, width)) {
    let value = node.value;
    let line = node.line;
    if (canContinue(node.after, actorId)) {
      const cont = bestContinuation(node.after, actorId, depth - 1, budget);
      if (cont.value > value) {
        value = cont.value;
        line = [node.candidate, ...cont.line];
      }
    }
    if (value > best.value) best = { value, line };
  }
  return best;
}

// Root move selection: deep-value the beam, then pick among near-equivalent
// top candidates with board-derived randomness (variety + anti-oscillation),
// escalating to a sharp pick when a win is on the line.
function searchBestMove(
  state: GameState,
  actorId: string,
  depth: number,
  seedPlan?: LegalMove[]
): SearchResult | undefined {
  const candidates = legalMoves(state, actorId);
  if (candidates.length === 0) return undefined;

  const budget = { evals: EVAL_BUDGET };
  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    budget.evals -= 1;
    const after = simulateMoveForSearch(state, candidate);
    return {
      candidate,
      after,
      value: evaluate(after, actorId) + candidateBias(candidate, state),
      line: [candidate]
    };
  });
  scored.sort((a, b) => b.value - a.value);

  if (depth > 1) {
    const width = beamWidthFor(candidates.length);
    for (const node of scored.slice(0, width)) {
      if (canContinue(node.after, actorId)) {
        const cont = bestContinuation(node.after, actorId, depth - 1, budget);
        if (cont.value > node.value) {
          node.value = cont.value;
          node.line = [node.candidate, ...cont.line];
        }
      }
    }
    scored.sort((a, b) => b.value - a.value);
  }

  // Coherence anchor: re-score the carried plan to its true depth and lift its
  // first move to that value, so this (possibly shallower) search can never
  // rank the plan below a greedy alternative it simply didn't look far enough
  // to refute. The search still deviates freely if it finds something better.
  if (seedPlan && seedPlan.length > 0) {
    const anchor = scored.find((entry) => sameMove(entry.candidate, seedPlan[0]!));
    if (anchor) {
      const { value, prefix } = evaluatePlanLine(state, actorId, seedPlan);
      if (value > anchor.value) {
        anchor.value = value;
        anchor.line = prefix;
      }
      scored.sort((a, b) => b.value - a.value);
    }
  }

  const chosen = chooseWithVariety(scored, state, actorId);
  // Commit through the real engine. Candidates come from legalMoves so this
  // should always succeed on the first try; if the engine ever disagrees, fall
  // through to the next-best candidate rather than letting the turn die.
  const ordered = [chosen, ...scored.filter((entry) => entry !== chosen)];
  for (const entry of ordered) {
    try {
      return {
        move: entry.candidate,
        after: move(state, actorId, entry.candidate),
        value: entry.value,
        line: entry.line
      };
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

function chooseWithVariety(scored: ScoredCandidate[], state: GameState, actorId: string): ScoredCandidate {
  const best = scored[0]!;
  const urgency = computeUrgency(state, actorId);
  const sharp = urgency.offense > 1 || urgency.defense > 1;
  const rng = boardRandom(state);

  // Opening variety takes priority over the subtle near-tie exploration: for the
  // first few turns, frequently pick a random move among the top-K (excluding
  // any that sacrifice too much). Uses id-salted draws so the opening differs
  // across games (the opening board alone is identical every game).
  if (!sharp && inOpening(state) && scored.length > 1) {
    const [gate, pick] = openingRandoms(state);
    if (gate < OPENING_EXPLORE_PROBABILITY) {
      const band = scored
        .slice(0, OPENING_TOP_K)
        .filter((entry) => best.value - entry.value <= OPENING_MAX_SACRIFICE);
      return band[Math.floor(pick * band.length)] ?? best;
    }
  }

  if (!sharp && rng < EXPLORE_PROBABILITY && scored.length > 1) {
    const second = scored[1]!;
    if (best.value - second.value <= EXPLORE_EPS) return second;
  }

  // Random pick among the near-equivalent top band. Deterministic given state
  // (replay-safe) but varies across games and cannot form a stable A->B->A
  // cycle because the hash advances with turn.number / version every action.
  const band = scored.filter((entry) => best.value - entry.value <= TIE_EPS);
  return band[Math.floor(rng * band.length)] ?? best;
}

// =====================================================================
// Elephant-seal relocation (roll of 1). Targeted candidates -- block an
// advanced opponent or backstop one of our own penguins -- not blind nearby
// cells, and never drop poop onto our own slide paths.
// =====================================================================

const SEAL_MIN_GAIN = 20;

function ownForwardSlideCells(state: GameState, actorId: string, view: BoardView): Set<number> {
  const cells = new Set<number>();
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color || piece.ownerId !== actorId) continue;
    let cursor = piece.position;
    const home = HOME_DIRECTION[piece.color];
    for (let stepCount = 0; stepCount < BOARD_SIZE; stepCount += 1) {
      const next = step(cursor, home);
      if (!inside(next) || crossesGoalGuard(cursor, next) || view.occupied.has(cellIndex(next))) break;
      cells.add(cellIndex(next));
      cursor = next;
    }
  }
  return cells;
}

function elephantSealTargets(state: GameState, actorId: string): Position[] {
  const seen = new Set<string>();
  const targets: Position[] = [];
  const add = (position: Position) => {
    if (!inside(position) || seen.has(posKey(position))) return;
    seen.add(posKey(position));
    targets.push(position);
  };
  const seal = state.pieces.find((piece) => piece.kind === "elephant-seal");
  if (seal) add(seal.position); // in place, purely to drop a blocking poop.
  for (const piece of state.pieces) {
    if (piece.kind !== "penguin" || piece.scored || !piece.color) continue;
    // One cell ahead of a piece: blocks an opponent, or backstops our own.
    add(step(piece.position, HOME_DIRECTION[piece.color]));
  }
  return targets.slice(0, 12);
}

function chooseElephantSealAction(state: GameState, actorId: string): BotActionResult | undefined {
  const depth = Math.min(SEARCH_MAX_DEPTH, state.turn.movesRemaining);
  const normal = searchBestMove(state, actorId, depth);

  const view = buildBoardView(state);
  const ownSlides = ownForwardSlideCells(state, actorId, view);
  let best: { after: GameState; value: number } | undefined;
  for (const to of elephantSealTargets(state, actorId)) {
    // Only leave poop if the cell threatens an opponent path and not our own.
    const onOwnPath = ownSlides.has(cellIndex(to));
    const leavePoopOptions = onOwnPath ? [false] : [true, false];
    for (const leavePoop of leavePoopOptions) {
      let after: GameState;
      try {
        after = placeElephantSealAndPoop(state, actorId, to, { leavePoop });
      } catch {
        continue;
      }
      const value = evaluate(after, actorId);
      if (!best || value > best.value) best = { after, value };
    }
  }

  if (best && (!normal || best.value >= normal.value + SEAL_MIN_GAIN))
    return { state: best.after, kind: "elephant-seal" };
  if (normal) return { state: normal.after, kind: "move" };
  return undefined;
}

// =====================================================================
// Fish cards. Hold only one at a time, so at most one fires per turn.
// =====================================================================

const FLYOVER_MIN_GAIN = 15; // one-shot charge is precious.
const SABOTAGE_MIN_GAIN = 12;
const DRAW_FISH_FLOOR = 15; // bias toward drawing when no move makes real progress.

function alreadyUsable(state: GameState, actorId: string): boolean {
  const player = state.players.find((candidate) => candidate.id === actorId);
  return Boolean(player && player.fishDrawnTurn !== state.turn.number);
}

// The engine is the source of truth for legality. The bot's preconditions try
// to mirror it, but rather than trust that mirror perfectly, every speculative
// card play is wrapped: if the engine rejects it, we simply skip that option
// and the planner moves on to the next (usually a normal search move). This
// keeps the bot playing well in odd states instead of dropping to the
// last-resort fallback, and means no precondition mismatch can throw.
function tryFishPlay(state: GameState, actorId: string, play: FishPlay): BotActionResult | undefined {
  try {
    return { state: playFish(state, actorId, play), kind: "fish" };
  } catch {
    return undefined;
  }
}

function tryPlayDoubleRoll(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (player?.fishCard !== "double-roll" || !alreadyUsable(state, actorId)) return undefined;
  return tryFishPlay(state, actorId, { cardId: "double-roll" });
}

function tryStartAvoidOrStealTwo(state: GameState, actorId: string): BotActionResult | undefined {
  const player = state.players.find((candidate) => candidate.id === actorId);
  if (!player || !alreadyUsable(state, actorId)) return undefined;
  if (player.fishCard === "avoid-or-two")
    return tryFishPlay(state, actorId, { cardId: "avoid-or-two", choice: "start" });
  // Only start a steal if there is actually a card to take; otherwise it is
  // just "add two", which we still want, so start it either way.
  if (player.fishCard === "steal-or-two")
    return tryFishPlay(state, actorId, { cardId: "steal-or-two", choice: "start" });
  return undefined;
}

function resolvePendingFishChoice(state: GameState, actorId: string): BotActionResult {
  const pending = state.turn.pendingFishChoice!;
  // keep-two is always legal once a choice is pending, so it is the safe
  // fallback if the preferred (avoid/steal) resolution is somehow rejected.
  const keepTwo = () => playFish(state, actorId, { cardId: pending.cardId, choice: "keep-two" });

  if (pending.cardId === "avoid-or-two") {
    const preferred = tryFishPlay(state, actorId, {
      cardId: "avoid-or-two",
      choice: state.turn.pendingPoop.length > 0 ? "avoid" : "keep-two"
    });
    return preferred ?? { state: keepTwo(), kind: "fish" };
  }
  // steal-or-two: take the most valuable opponent card, else keep the +2.
  let target: string | undefined;
  let targetValue = 0;
  for (const player of state.players) {
    if (player.id === actorId || !player.fishCard) continue;
    const value = FISH_CARD_RELATIVE[player.fishCard];
    if (value > targetValue) {
      targetValue = value;
      target = player.id;
    }
  }
  const preferred = target
    ? tryFishPlay(state, actorId, { cardId: "steal-or-two", choice: "steal", targetPlayerId: target })
    : undefined;
  return preferred ?? { state: keepTwo(), kind: "fish" };
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

  const baseline = evaluate(state, actorId);
  let best: { after: GameState; value: number } | undefined;
  for (const piece of state.pieces) {
    if (piece.kind === "elephant-seal" || piece.scored || !piece.ownerId || piece.ownerId === actorId)
      continue;
    for (const candidate of legalMovesForPiece(state, piece.id)) {
      if (candidate.scores) continue; // never hand an opponent a point.
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
  if (!best || best.value <= baseline + SABOTAGE_MIN_GAIN) return undefined;
  return { state: best.after, kind: "fish" };
}

function occupiedKeysForPlacement(state: GameState): Set<string> {
  const set = new Set(state.pieces.filter((piece) => !piece.scored).map((piece) => posKey(piece.position)));
  for (const poop of state.poop) set.add(posKey(poop));
  if (state.fenceActive) for (const position of FENCE_POSITIONS) set.add(posKey(position));
  return set;
}

// Recycle the poop token nearest our own pieces (likeliest to bite us).
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
    // Drawing is worth a fresh card; take it unless a move clears a real
    // progress bar over just holding position.
    const drawnValue = evaluate(drawn, actorId) + DRAW_FISH_FLOOR;
    if (!normal || drawnValue > normal.value) return { state: drawn, kind: "draw-fish" };
  }
  if (normal) return { state: normal.after, kind: "move" };
  return undefined;
}

// Return an escaped penguin to the start cell with the best comeback (lowest
// goal distance), minimizing the regret of the forced -1.
function resolveReturnPenguinChoice(state: GameState, actorId: string): GameState {
  const choice = state.turn.pendingChoice!;
  const view = buildBoardView(state);
  let bestPieceId = choice.options[0]!.pieceId;
  let bestPosition = choice.options[0]!.positions[0]!;
  let bestDist = Infinity;
  for (const option of choice.options) {
    for (const position of option.positions) {
      const dist = view.distanceMaps[option.color]![cellIndex(position)]!;
      const normalized = dist < 0 ? MAX_GOAL_DISTANCE : dist;
      if (normalized < bestDist) {
        bestDist = normalized;
        bestPieceId = option.pieceId;
        bestPosition = position;
      }
    }
  }
  return resolvePoopChoice(state, actorId, bestPieceId, bestPosition);
}

// =====================================================================
// Entry point: one engine transition per call.
//
// `advanceBotAction` must NEVER throw for a valid in-progress bot turn: the
// server computes it eagerly and a throw there strands the turn with no
// scheduled follow-up (the game visibly freezes). So the heuristic planner
// runs inside a guard that, on any unexpected error, falls back to a simple
// always-legal action. The fallback mirrors the engine's own forced-turn
// completion: resolve pending choices, otherwise make one random legal move,
// otherwise roll, otherwise end the turn. It preserves the one-action-per-call
// contract (exactly one version bump) that the pacing loop depends on.
// =====================================================================

export function advanceBotAction(
  state: GameState,
  actorId: string,
  options: BotActionOptions = {}
): BotActionResult {
  const active = state.players.find((player) => player.id === actorId);
  if (!active || state.status !== "playing" || state.turn.activePlayerId !== actorId) {
    throw new Error("The bot is not the active player.");
  }
  try {
    return planBotAction(state, actorId, options);
  } catch {
    return fallbackBotAction(state, actorId);
  }
}

// A minimal, robust always-terminating action used only if the heuristic
// planner throws. Uses the raw PRNG cursor as an index (like the original
// bot); it is a safety valve, not a strategy, so quality does not matter --
// only that it always produces exactly one legal engine transition.
function fallbackBotAction(state: GameState, actorId: string): BotActionResult {
  if (state.turn.pendingChoice) {
    const option = state.turn.pendingChoice.options[state.seed % state.turn.pendingChoice.options.length]!;
    const position = option.positions[state.seed % option.positions.length]!;
    return { state: resolvePoopChoice(state, actorId, option.pieceId, position), kind: "choice" };
  }
  if (state.turn.pendingFishChoice) {
    return {
      state: playFish(state, actorId, { cardId: state.turn.pendingFishChoice.cardId, choice: "keep-two" }),
      kind: "fish"
    };
  }
  if (state.turn.phase === "awaiting-roll" && state.turn.forcedPieceOwnerIds?.length) {
    const moves = legalMoves(state, actorId);
    if (moves.length > 0)
      return { state: move(state, actorId, moves[state.seed % moves.length]!), kind: "move" };
    return { state: roll(state, actorId), kind: "roll" };
  }
  if (state.turn.phase === "awaiting-roll") return { state: roll(state, actorId), kind: "roll" };
  if (state.turn.phase === "moving" && state.turn.movesRemaining > 0) {
    const moves = legalMoves(state, actorId);
    if (moves.length > 0)
      return { state: move(state, actorId, moves[state.seed % moves.length]!), kind: "move" };
  }
  return { state: endTurn(state, actorId), kind: "end-turn" };
}

function planBotAction(state: GameState, actorId: string, options: BotActionOptions = {}): BotActionResult {
  const active = state.players.find((player) => player.id === actorId)!;

  if (state.turn.pendingChoice) {
    return { state: resolveReturnPenguinChoice(state, actorId), kind: "choice" };
  }

  if (state.turn.pendingFishChoice) {
    return resolvePendingFishChoice(state, actorId);
  }

  // Pre-roll forced opponent move: pick the one least useful to them (which is
  // exactly the one maximizing our own eval), never a scoring move.
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

    // Starting avoid/steal is pure upside: it grants +2 now, and only opens a
    // follow-up choice (cancel poop / take a card) when one is actually worth
    // taking. Worst case it is simply "+2 moves".
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

      const depth = Math.min(options.maxDepth ?? SEARCH_MAX_DEPTH, state.turn.movesRemaining);
      const best = searchBestMove(state, actorId, depth, options.plan);
      // Carry forward the plan minus the move we're committing now.
      if (best) return { state: best.after, kind: "move", plan: best.line.slice(1) };
    }

    const relocate = tryPlayRelocateAndRoll(state, actorId);
    if (relocate) return relocate;
  }

  return { state: endTurn(state, actorId), kind: "end-turn" };
}

// =====================================================================
// Internal tuning hooks. Not part of the gameplay API -- they let an offline
// self-play harness sweep evaluation weights and search depth without a
// rebuild per configuration. Production never calls these, so the bot always
// runs with DEFAULT_WEIGHTS at full depth.
// =====================================================================

/** @internal Override evaluation weights (merged over defaults). */
export function __setBotWeights(patch: Partial<Weights>): void {
  W = { ...DEFAULT_WEIGHTS, ...patch };
}

/** @internal Restore the shipped default weights. */
export function __resetBotWeights(): void {
  W = { ...DEFAULT_WEIGHTS };
}

/** @internal The shipped default weights (for a tuning harness to sweep from). */
export function __defaultBotWeights(): Weights {
  return { ...DEFAULT_WEIGHTS };
}

/** @internal Force a shallower search for fast weight tuning (production uses 3). */
export function __setSearchMaxDepth(depth: number): void {
  SEARCH_MAX_DEPTH = depth;
}

/** @internal Force a flat beam width for self-play tuning (0 restores the default). */
export function __setBeamWidth(width: number): void {
  BEAM_OVERRIDE = width;
}

/** @internal Override the per-decision evaluate() budget for self-play tuning. */
export function __setEvalBudget(budget: number): void {
  EVAL_BUDGET = budget;
}

/** @internal Restore the shipped default evaluate() budget. */
export function __resetEvalBudget(): void {
  EVAL_BUDGET = 1_500;
}
