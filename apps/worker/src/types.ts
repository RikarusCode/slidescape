import type { BotActionKind, GameMode, GameState, LegalMove, LobbySettings, PlayerColor } from "@slidescape/game";

export interface SessionIdentity {
  playerId: string;
  reconnectToken: string;
  name: string;
}

export interface RoomMember extends SessionIdentity {
  ready: boolean;
  connected: boolean;
  isBot?: boolean;
  colorChoice?: PlayerColor;
}

export interface PublicLobby {
  id: string;
  code?: string;
  hostId: string;
  settings: LobbySettings;
  requiredPlayers: number;
  members: Array<{
    id: string;
    name: string;
    ready: boolean;
    connected: boolean;
    isBot?: boolean;
    colorChoice?: PlayerColor;
  }>;
  started: boolean;
}

export interface RoomSnapshot {
  id: string;
  code?: string;
  hostId: string;
  settings: LobbySettings;
  members: RoomMember[];
  game?: GameState;
  processed: string[];
  disconnectDeadlines: Record<string, number>;
  botActionAt?: number;
  /**
   * Anytime iterative-deepening search spread across alarm ticks. While set, the
   * bot is refining its next action: each tick deepens the search one level
   * until the wall-clock budget is nearly spent (or it can't usefully go
   * deeper), then commits `best` -- but never before `floor` (the minimum
   * visible pause). `forVersion` guards against applying it if some other event
   * (a forfeit, etc.) mutated `game` in the meantime.
   */
  botThinking?: BotThinking;
  /**
   * The bot's carried-forward principal variation within the current turn -- the
   * remaining planned moves after the last committed one. Seeds each subsequent
   * move's search so a shorter, time-boxed re-search can't "forget" the plan
   * that justified an earlier move. Cleared when the turn or actor changes.
   */
  botPlan?: LegalMove[];
  expiresAt: number;
}

export interface BotThinking {
  forVersion: number;
  best: { state: GameState; kind: BotActionKind; plan?: LegalMove[] };
  depth: number; // deepest search level the eager precompute reached (info/monitoring).
}

export interface QueueEntry extends SessionIdentity {
  mode: GameMode;
  queuedAt: number;
}

export interface WireMessage {
  id?: string;
  event?: string;
  payload?: unknown;
  replyTo?: string;
}

export interface ActionReply {
  ok: boolean;
  message?: string;
  waiting?: boolean;
  roomId?: string;
  lobby?: PublicLobby;
  game?: GameState;
}
