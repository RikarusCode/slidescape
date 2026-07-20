import type { GameMode, GameState, LobbySettings, PlayerColor } from "@slidescape/game";

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
