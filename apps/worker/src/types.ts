import type { GameMode, GameState, LegalMove, LobbySettings, PlayerColor } from "@slidescape/game";

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
  /**
   * When the bot next acts. It's purely a pacing timer: the action is computed
   * when the alarm fires, not cached here, so the search time adds to the pause
   * rather than eating it. Whenever it's a bot's turn this must be a future time
   * (see GameRoom.ensureBotScheduled) or the room would appear frozen.
   */
  botActionAt?: number;
  /**
   * The bot's carried-forward principal variation within the current turn -- the
   * remaining planned moves after the last committed one. Seeds each subsequent
   * move's search so a shorter re-search can't "forget" the plan that justified
   * an earlier move. Cleared when the turn or actor changes.
   */
  botPlan?: LegalMove[];
  expiresAt: number;
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
