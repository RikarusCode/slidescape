import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import {
  createGame,
  drawHarvest,
  endTurn,
  legalMoves,
  move,
  placeCowAndPoop,
  playHarvest,
  roll,
  type ClientCommand,
  type GameMode,
  type GameState,
  type LobbySettings
} from "@slidescape/game";
import type { GameStore } from "./store.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const playerCount = (mode: GameMode) => mode === "classic-4" ? 4 : 2;

export interface Member {
  id: string;
  name: string;
  socketId: string;
  reconnectToken: string;
  ready: boolean;
  connected: boolean;
  isBot?: boolean;
}

export interface Room {
  id: string;
  code?: string;
  hostId: string;
  settings: LobbySettings;
  members: Member[];
  game?: GameState;
  processed: Set<string>;
  timeout?: NodeJS.Timeout;
}

function roomCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly codeToRoom = new Map<string, string>();
  private readonly queues = new Map<GameMode, Member[]>();
  private readonly memberRoom = new Map<string, string>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly io: Server, private readonly store: GameStore) {}

  guest(name: string, socketId: string): Member {
    return {
      id: randomUUID(),
      name: name.trim().slice(0, 24) || "Penguin Player",
      socketId,
      reconnectToken: randomBytes(24).toString("base64url"),
      ready: false,
      connected: true
    };
  }

  createPrivate(member: Member, settings: Omit<LobbySettings, "privacy">): Room {
    let code = roomCode();
    while (this.codeToRoom.has(code)) code = roomCode();
    const room: Room = {
      id: randomUUID(), code, hostId: member.id, settings: { ...settings, privacy: "private" },
      members: [member], processed: new Set()
    };
    this.rooms.set(room.id, room);
    this.codeToRoom.set(code, room.id);
    this.memberRoom.set(member.id, room.id);
    return room;
  }

  joinPrivate(member: Member, code: string): Room {
    const id = this.codeToRoom.get(code.toUpperCase());
    const room = id ? this.rooms.get(id) : undefined;
    if (!room || room.game) throw new Error("That room is unavailable.");
    if (room.members.length >= playerCount(room.settings.mode)) throw new Error("That room is full.");
    room.members.push(member);
    this.memberRoom.set(member.id, room.id);
    return room;
  }

  queue(member: Member, mode: GameMode): Room | undefined {
    const queue = this.queues.get(mode) ?? [];
    queue.push(member);
    this.queues.set(mode, queue);
    if (queue.length < playerCount(mode)) return undefined;
    const members = queue.splice(0, playerCount(mode));
    const room: Room = {
      id: randomUUID(), hostId: members[0]!.id,
      settings: { mode, privacy: "random", turnTimerSeconds: 90 }, members, processed: new Set()
    };
    this.rooms.set(room.id, room);
    members.forEach((candidate) => this.memberRoom.set(candidate.id, room.id));
    return room;
  }

  async createBotGame(member: Member, mode: GameMode): Promise<Room> {
    const bots = Array.from({ length: playerCount(mode) - 1 }, (_, index) => ({
      ...this.guest(playerCount(mode) === 2 ? "Testing Bot" : `Testing Bot ${index + 1}`, `bot-${randomUUID()}`),
      isBot: true
    }));
    const members = [member, ...bots];
    const room: Room = {
      id: randomUUID(), hostId: member.id,
      settings: { mode, privacy: "random", turnTimerSeconds: 0 }, members, processed: new Set()
    };
    room.game = createGame(room.id, mode, members.map(({ id, name }) => ({ id, name })));
    this.rooms.set(room.id, room);
    members.forEach((candidate) => this.memberRoom.set(candidate.id, room.id));
    await this.store.save(room.game);
    return room;
  }

  roomFor(memberId: string) { return this.rooms.get(this.memberRoom.get(memberId) ?? ""); }

  leaveLobby(memberId: string) {
    for (const [mode, queue] of this.queues) {
      const remaining = queue.filter((member) => member.id !== memberId);
      if (remaining.length !== queue.length) this.queues.set(mode, remaining);
    }

    const room = this.roomFor(memberId);
    if (!room || room.game) return undefined;

    this.memberRoom.delete(memberId);
    room.members = room.members.filter((member) => member.id !== memberId);

    if (room.members.length === 0 || room.hostId === memberId) {
      for (const member of room.members) this.memberRoom.delete(member.id);
      if (room.code) this.codeToRoom.delete(room.code);
      this.rooms.delete(room.id);
      this.io.to(room.id).emit("lobby-closed", "The room host returned home.");
    } else {
      this.emitLobby(room);
    }

    return room.id;
  }

  publicLobby(room: Room) {
    return {
      id: room.id, code: room.code, hostId: room.hostId, settings: room.settings,
      requiredPlayers: playerCount(room.settings.mode),
      members: room.members.map(({ reconnectToken: _token, socketId: _socket, ...member }) => member),
      started: Boolean(room.game)
    };
  }

  emitLobby(room: Room) { this.io.to(room.id).emit("lobby-state", this.publicLobby(room)); }

  async setReady(room: Room, memberId: string, ready: boolean) {
    const member = room.members.find((candidate) => candidate.id === memberId);
    if (!member || room.game) return;
    member.ready = ready;
    if (room.members.length === playerCount(room.settings.mode) && room.members.every((candidate) => candidate.ready)) {
      room.game = createGame(room.id, room.settings.mode, room.members.map(({ id, name }) => ({ id, name })));
      await this.store.save(room.game);
      this.armTimer(room);
      this.io.to(room.id).emit("game-state", room.game);
    } else this.emitLobby(room);
  }

  async command(room: Room, actorId: string, command: ClientCommand) {
    const prior = this.locks.get(room.id) ?? Promise.resolve();
    const work = prior.then(async () => {
      if (!room.game) throw new Error("The game has not started.");
      if (room.processed.has(command.commandId)) return;
      if (command.expectedVersion !== room.game.version) throw new Error("The board changed. Your view has been refreshed.");
      let next = room.game;
      if (command.type === "roll") next = roll(next, actorId);
      if (command.type === "draw-harvest") next = drawHarvest(next, actorId);
      if (command.type === "move") next = move(next, actorId, command.move);
      if (command.type === "place-cow") next = placeCowAndPoop(next, actorId, command.to, { leavePoop: command.leavePoop, poopFrom: command.poopFrom });
      if (command.type === "play-harvest") next = playHarvest(next, actorId, command.play);
      if (command.type === "end-turn") next = endTurn(next, actorId);
      room.game = next;
      room.processed.add(command.commandId);
      if (room.processed.size > 500) room.processed = new Set(Array.from(room.processed).slice(-250));
      await this.store.save(next);
      this.io.to(room.id).emit(next.status === "finished" ? "game-over" : "game-state", next);
      await this.runBotTurns(room);
      this.armTimer(room);
    });
    this.locks.set(room.id, work.catch(() => undefined));
    return work;
  }

  reconnect(token: string, socketId: string): { room: Room; member: Member } | undefined {
    for (const room of this.rooms.values()) {
      const member = room.members.find((candidate) => candidate.reconnectToken === token);
      if (member) {
        member.socketId = socketId;
        member.connected = true;
        room.game?.players.forEach((player) => { if (player.id === member.id) player.connected = true; });
        return { room, member };
      }
    }
    return undefined;
  }

  disconnect(memberId: string) {
    const room = this.roomFor(memberId);
    const member = room?.members.find((candidate) => candidate.id === memberId);
    if (!room || !member) return;
    member.connected = false;
    room.game?.players.forEach((player) => { if (player.id === memberId) player.connected = false; });
    this.emitLobby(room);
    setTimeout(() => this.forfeitDisconnected(room.id, memberId), 120_000).unref();
  }

  private async forfeitDisconnected(roomId: string, memberId: string) {
    const room = this.rooms.get(roomId);
    const member = room?.members.find((candidate) => candidate.id === memberId);
    if (!room?.game || !member || member.connected || room.game.status === "finished") return;
    if (room.settings.mode !== "classic-4") {
      room.game.status = "finished";
      room.game.winnerId = room.game.players.find((player) => player.id !== memberId)?.id;
    } else {
      room.game.pieces = room.game.pieces.filter((piece) => piece.ownerId !== memberId);
      room.game.turnOrder = room.game.turnOrder.filter((id) => id !== memberId);
      if (room.game.turn.activePlayerId === memberId) room.game.turn.activePlayerId = room.game.turnOrder[0]!;
    }
    room.game.version += 1;
    await this.store.save(room.game);
    this.io.to(room.id).emit(room.game.status === "finished" ? "game-over" : "game-state", room.game);
  }

  private armTimer(room: Room) {
    if (room.timeout) clearTimeout(room.timeout);
    if (!room.settings.turnTimerSeconds || !room.game || room.game.status !== "playing") return;
    const durationMs = room.settings.turnTimerSeconds * 1_000;
    room.game.turn.timerDeadline = Date.now() + durationMs;
    room.timeout = setTimeout(() => this.completeTimedTurn(room), durationMs);
    room.timeout.unref();
  }

  private async runBotTurns(room: Room) {
    let state = room.game;
    let turnGuard = 8;
    while (state?.status === "playing" && room.members.find((member) => member.id === state!.turn.activePlayerId)?.isBot && turnGuard-- > 0) {
      const actor = state.turn.activePlayerId;
      let actionGuard = 96;

      while (state.turn.phase === "awaiting-roll" && state.players.find((player) => player.id === actor)!.effects.forcedOpponentMoves > 0 && actionGuard-- > 0) {
        const moves = legalMoves(state, actor);
        if (!moves.length) break;
        state = move(state, actor, moves[state.seed % moves.length]!);
      }

      if (state.turn.phase === "awaiting-roll") state = roll(state, actor);
      while (state.turn.phase === "moving" && state.turn.movesRemaining > 0 && actionGuard-- > 0) {
        const moves = legalMoves(state, actor);
        if (!moves.length) break;
        state = move(state, actor, moves[(state.seed + actionGuard) % moves.length]!);
      }
      state = endTurn(state, actor);
      room.game = state;
      await this.store.save(state);
      this.io.to(room.id).emit(state.status === "finished" ? "game-over" : "game-state", state);
    }
  }

  private async completeTimedTurn(room: Room) {
    let state = room.game;
    if (!state || state.status !== "playing") return;
    const actor = state.turn.activePlayerId;
    try {
      if (state.turn.phase === "awaiting-roll") state = roll(state, actor);
      let guard = 64;
      while (state.turn.movesRemaining > 0 && guard-- > 0) {
        const moves = legalMoves(state, actor);
        if (!moves.length) break;
        const chosen = moves[(state.seed + guard) % moves.length]!;
        state = move(state, actor, chosen);
      }
      state = endTurn(state, actor);
      room.game = state;
      await this.store.save(state);
      this.io.to(room.id).emit(state.status === "finished" ? "game-over" : "game-state", state);
      this.armTimer(room);
    } catch (error) {
      this.io.to(room.id).emit("server-message", error instanceof Error ? error.message : "The timed turn could not be completed.");
    }
  }
}
