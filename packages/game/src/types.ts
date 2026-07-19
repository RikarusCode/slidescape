export const BOARD_SIZE = 14;

export type GameMode = "quick-2" | "strategic-2" | "classic-4";
export type TurnTimerSeconds = 0 | 45 | 90 | 180;
export type Color = "green" | "yellow" | "red" | "blue";
export type PlayerColor = "arctic-teal" | "sunburst" | "coral-red" | "cobalt-blue" | "aurora-purple" | "berry-pink" | "lime-green";
export type Direction = "up" | "right" | "down" | "left";
export type PieceKind = "pig" | "hay" | "cow";
export type GameStatus = "playing" | "finished";
export type TurnPhase = "awaiting-roll" | "moving" | "resolving-poop";
export type HarvestCardId =
  | "flyover"
  | "avoid-or-two"
  | "relocate-and-roll"
  | "steal-or-two"
  | "move-opponent"
  | "double-roll";
export type PoopCardId =
  | "skip-turn"
  | "return-pig"
  | "two-move-turn"
  | "opponent-moves"
  | "discard-harvest";

export interface Position { x: number; y: number }

export interface Piece {
  id: string;
  kind: PieceKind;
  color?: Color;
  ownerId?: string;
  position: Position;
  facing?: Direction;
  scored?: boolean;
}

export interface PlayerEffects {
  skipTurns: number;
  forcedTwoMoveTurns: number;
  forcedOpponentMoves: number;
  flyoverCharges: number;
  avoidPoopCharges: number;
}

export interface PlayerState {
  id: string;
  name: string;
  colors: Color[];
  themeColor: PlayerColor;
  score: number;
  connected: boolean;
  harvestCard?: HarvestCardId;
  harvestDrawnTurn?: number;
  effects: PlayerEffects;
}

export interface TurnState {
  number: number;
  activePlayerId: string;
  phase: TurnPhase;
  rolled?: number;
  harvestForbidden?: boolean;
  movesRemaining: number;
  pendingPoop: PoopCardId[];
  fishDrawAvailable?: boolean;
  walrusRelocationsRemaining?: number;
  timerDeadline?: number;
}

export interface GameState {
  schemaVersion: 3;
  id: string;
  mode: GameMode;
  status: GameStatus;
  version: number;
  seed: number;
  players: PlayerState[];
  pieces: Piece[];
  poop: Position[];
  fenceActive: boolean;
  poopSupply: number;
  harvestDeck: HarvestCardId[];
  poopDeck: PoopCardId[];
  turnOrder: string[];
  turn: TurnState;
  winnerId?: string;
  log: string[];
}

export interface GameGuest { id: string; name: string; colorChoice?: PlayerColor }

export interface CardDefinition<T extends string = string> {
  id: T;
  deck: "harvest" | "poop";
  copies: number;
  timing: string;
  choices: string[];
  targets: string;
  text: string;
}

export interface LegalMove {
  pieceId: string;
  direction: Direction;
  to: Position;
  scores?: boolean;
  crossesPoop: Position[];
  usesFlyover?: boolean;
}

export type HarvestPlay =
  | { cardId: "flyover" }
  | { cardId: "avoid-or-two"; choice: "avoid" | "two" }
  | { cardId: "relocate-and-roll"; poopFrom?: Position; poopTo?: Position }
  | { cardId: "steal-or-two"; choice: "steal" | "two"; targetPlayerId?: string }
  | { cardId: "move-opponent"; move: LegalMove }
  | { cardId: "double-roll" };

export interface LobbySettings {
  mode: GameMode;
  turnTimerSeconds: TurnTimerSeconds;
  privacy: "private" | "random";
}

export type ClientCommand =
  | { type: "roll"; commandId: string; expectedVersion: number }
  | { type: "draw-harvest"; commandId: string; expectedVersion: number }
  | { type: "move"; commandId: string; expectedVersion: number; move: LegalMove }
  | { type: "place-cow"; commandId: string; expectedVersion: number; to: Position; leavePoop?: boolean; poopFrom?: Position }
  | { type: "play-harvest"; commandId: string; expectedVersion: number; play: HarvestPlay }
  | { type: "end-turn"; commandId: string; expectedVersion: number };

export type ServerEvent =
  | { type: "game-state"; state: GameState }
  | { type: "command-rejected"; commandId: string; message: string }
  | { type: "game-over"; state: GameState };
