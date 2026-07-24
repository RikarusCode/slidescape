import { DurableObject } from "cloudflare:workers";
import {
  createGame,
  advanceBotAction,
  drawFish,
  endTurn,
  legalMoves,
  migrateGameState,
  move,
  PLAYER_COLOR_ORDER,
  placeElephantSealAndPoop,
  playFish,
  resolvePoopChoice,
  roll,
  type BotActionKind,
  type ClientCommand,
  type GameMode,
  type LobbySettings,
  type PlayerColor
} from "@slidescape/game";
import {
  cleanName,
  parseWireMessage,
  playerCount,
  publicGameState,
  randomSeed,
  RECONNECT_MS,
  ROOM_TTL_MS,
  sendEvent,
  sendReply,
  serializeEvent
} from "./helpers.js";
import type { ActionReply, PublicLobby, RoomMember, RoomSnapshot, SessionIdentity } from "./types.js";

interface SocketAttachment {
  memberId: string;
}
// Move pacing = the visible pause before a bot move, drawn uniformly in
// [floor, budget]. The bot's search (iterative deepening) runs eagerly and
// synchronously when the move is scheduled, then the result is just held until
// the pause elapses -- so calculation hides inside the pause rather than adding
// to it. First move of a turn gets the big window; each later move (shorter
// remaining horizon, so cheaper) gets the small one.
const FIRST_MOVE_FLOOR_MS = 1_000;
const FIRST_MOVE_BUDGET_MS = 2_000;
const LATER_MOVE_FLOOR_MS = 750;
const LATER_MOVE_BUDGET_MS = 1_000;
// Roll / card / choice / end-turn are instant decisions -- a short, snappy pause.
const BOT_STEP_DELAY_MS = 450;
const BOT_OPENING_DELAY_MS = 1_100;
// Fixed search depth per move. The 595+1293-game self-play A/B found depth 4 /
// beam 4 the strength sweet spot, so a SINGLE bounded search at this depth is
// both optimal and cheap (~50-400ms). We deliberately do NOT run a multi-level
// deepening loop: it relied on Date.now() advancing to bound itself, but on
// deployed Cloudflare Date.now() is frozen during synchronous execution, so the
// loop would never time-bound and would run many heavy searches per handler --
// the freeze. One bounded search has no clock dependency and can't over-run.
const MOVE_SEARCH_DEPTH = 4;
const BOT_NAMES = [
  "Polar Bot",
  "Frost Bot",
  "Glacier Bot",
  "Iceberg Bot",
  "Blizzard Bot",
  "Krill Bot",
  "Moonlight Bot",
  "Orca Bot",
  "Humpback Bot",
  "Blue Whale Bot"
];

function pickBotNames(count: number): string[] {
  const pool = [...BOT_NAMES];
  const chosen: string[] = [];
  while (chosen.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(index, 1)[0]!);
  }
  return chosen;
}

export class GameRoom extends DurableObject<Env> {
  async initializePrivate(
    id: string,
    code: string,
    identity: SessionIdentity,
    settings: Omit<LobbySettings, "privacy">
  ): Promise<PublicLobby | undefined> {
    if (await this.ctx.storage.get<RoomSnapshot>("room")) return undefined;
    const member = this.member(identity);
    const room: RoomSnapshot = {
      id,
      code,
      hostId: member.playerId,
      settings: { ...settings, privacy: "private" },
      members: [member],
      processed: [],
      disconnectDeadlines: {},
      expiresAt: Date.now() + ROOM_TTL_MS
    };
    await this.save(room);
    return this.publicLobby(room);
  }

  async initializePublic(id: string, mode: GameMode, identities: SessionIdentity[]): Promise<PublicLobby> {
    const existing = await this.ctx.storage.get<RoomSnapshot>("room");
    if (existing) return this.publicLobby(existing);
    const members = identities.map((identity) => this.member(identity));
    const room: RoomSnapshot = {
      id,
      hostId: members[0]!.playerId,
      settings: { mode, privacy: "random", turnTimerSeconds: 90 },
      members,
      processed: [],
      disconnectDeadlines: {},
      expiresAt: Date.now() + ROOM_TTL_MS
    };
    await this.save(room);
    return this.publicLobby(room);
  }

  async initializeBot(
    id: string,
    mode: GameMode,
    identity: SessionIdentity
  ): Promise<{ lobby: PublicLobby; game: NonNullable<RoomSnapshot["game"]> }> {
    const existing = this.migrateRoom(await this.ctx.storage.get<RoomSnapshot>("room"));
    if (existing?.game)
      return {
        lobby: this.publicLobby(existing),
        game: publicGameState(existing.game)
      };
    const botNames = pickBotNames(playerCount(mode) - 1);
    const bots = Array.from({ length: playerCount(mode) - 1 }, (_, index) =>
      this.member(
        {
          playerId: crypto.randomUUID(),
          reconnectToken: crypto.randomUUID(),
          name: botNames[index]!
        },
        true
      )
    );
    const members = [this.member(identity), ...bots];
    const room: RoomSnapshot = {
      id,
      hostId: identity.playerId,
      settings: { mode, privacy: "random", turnTimerSeconds: 0 },
      members,
      processed: [],
      disconnectDeadlines: {},
      expiresAt: Date.now() + ROOM_TTL_MS
    };
    room.game = createGame(
      id,
      mode,
      members.map(({ playerId, name, colorChoice }) => ({
        id: playerId,
        name,
        colorChoice
      })),
      randomSeed()
    );
    await this.save(room);
    return { lobby: this.publicLobby(room), game: publicGameState(room.game) };
  }

  async joinPrivate(identity: SessionIdentity): Promise<PublicLobby> {
    const room = await this.requireRoom();
    if (room.settings.privacy !== "private" || room.game) throw new Error("That room is unavailable.");
    const existing = room.members.find((candidate) => candidate.playerId === identity.playerId);
    if (existing) {
      if (existing.reconnectToken !== identity.reconnectToken)
        throw new Error("That player session is invalid.");
      existing.name = identity.name;
    } else {
      if (room.members.length >= playerCount(room.settings.mode)) throw new Error("That room is full.");
      room.members.push(this.member(identity));
    }
    room.expiresAt = Date.now() + ROOM_TTL_MS;
    await this.save(room);
    const lobby = this.publicLobby(room);
    this.broadcast("lobby-state", lobby);
    return lobby;
  }

  async validateSession(identity: SessionIdentity): Promise<boolean> {
    const room = await this.ctx.storage.get<RoomSnapshot>("room");
    return Boolean(
      room?.members.some(
        (member) => member.playerId === identity.playerId && member.reconnectToken === identity.reconnectToken
      )
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") ?? "";
    const reconnectToken = url.searchParams.get("reconnectToken") ?? "";
    const room = this.migrateRoom(await this.ctx.storage.get<RoomSnapshot>("room"));
    const member = room?.members.find(
      (candidate) => candidate.playerId === playerId && candidate.reconnectToken === reconnectToken
    );
    if (!room || !member) return new Response("Room session unavailable", { status: 403 });

    // Adopt the name the player currently has, not the one frozen when they
    // joined the queue -- e.g. someone who queued as the default "Penguin
    // Player" and then renamed themselves before the match formed should enter
    // under their new name. The URL only carries a name for the human connect,
    // so a missing param leaves the existing name untouched (bots, reconnects).
    if (url.searchParams.has("name") && !member.isBot) {
      const name = cleanName(url.searchParams.get("name"));
      member.name = name;
      room.game?.players.forEach((player) => {
        if (player.id === member.playerId) player.name = name;
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({
      memberId: member.playerId
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [member.playerId]);
    member.connected = true;
    delete room.disconnectDeadlines[member.playerId];
    room.game?.players.forEach((player) => {
      if (player.id === member.playerId) player.connected = true;
    });
    room.expiresAt = Date.now() + ROOM_TTL_MS;
    this.ensureBotScheduled(room);
    await this.save(room);
    const lobby = this.publicLobby(room);
    sendEvent(server, "session", {
      playerId: member.playerId,
      reconnectToken: member.reconnectToken,
      roomId: room.id
    });
    sendEvent(server, "lobby-state", lobby);
    if (room.game)
      sendEvent(
        server,
        room.game.status === "finished" ? "game-over" : "game-state",
        publicGameState(room.game)
      );
    this.broadcast("lobby-state", lobby, member.playerId);
    if (room.game)
      this.broadcast(
        room.game.status === "finished" ? "game-over" : "game-state",
        room.game,
        member.playerId
      );
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, value: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.memberId) return socket.close(1008, "Missing session");
    if ((typeof value === "string" ? value.length : value.byteLength) > 65_536)
      return socket.close(1009, "Message too large");
    let message;
    try {
      message = parseWireMessage(value);
    } catch {
      return sendReply(socket, undefined, {
        ok: false,
        message: "Invalid message."
      });
    }

    try {
      const reply = await this.handleEvent(attachment.memberId, message.event ?? "", message.payload);
      sendReply(socket, message.id, reply);
    } catch (error) {
      sendReply(socket, message.id, {
        ok: false,
        message: error instanceof Error ? error.message : "The room command failed."
      });
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.markDisconnected(socket);
  }
  async webSocketError(socket: WebSocket): Promise<void> {
    await this.markDisconnected(socket);
  }

  async alarm(): Promise<void> {
    const room = this.migrateRoom(await this.ctx.storage.get<RoomSnapshot>("room"));
    if (!room) return;
    const now = Date.now();
    if (room.expiresAt <= now && this.ctx.getWebSockets().length === 0) {
      await this.ctx.storage.deleteAll();
      return;
    }
    if (room.expiresAt <= now) room.expiresAt = now + ROOM_TTL_MS;

    for (const [memberId, deadline] of Object.entries(room.disconnectDeadlines)) {
      if (deadline <= now) this.forfeitDisconnected(room, memberId);
    }
    if (room.game?.status === "playing" && room.botActionAt && room.botActionAt <= now) {
      await this.advanceScheduledBot(room);
      this.resetTurnDeadline(room);
    } else if (
      room.game?.status === "playing" &&
      room.game.turn.timerDeadline &&
      room.game.turn.timerDeadline <= now
    ) {
      await this.completeTimedTurn(room);
    }
    // Safety net: never leave a live bot turn without a future alarm.
    this.ensureBotScheduled(room);
    await this.save(room);
    if (room.game) this.broadcast(room.game.status === "finished" ? "game-over" : "game-state", room.game);
    else this.broadcast("lobby-state", this.publicLobby(room));
  }

  private member(identity: SessionIdentity, isBot = false): RoomMember {
    return {
      ...identity,
      ready: false,
      connected: !isBot,
      isBot: isBot || undefined
    };
  }

  private async handleEvent(memberId: string, event: string, payload: unknown): Promise<ActionReply> {
    const room = await this.requireRoom();
    const member = room.members.find((candidate) => candidate.playerId === memberId);
    if (!member) throw new Error("You are not in this room.");
    room.expiresAt = Date.now() + ROOM_TTL_MS;

    if (event === "ready") {
      if (!room.game) member.ready = payload === true;
      if (
        !room.game &&
        room.members.length === playerCount(room.settings.mode) &&
        room.members.every((candidate) => candidate.ready || candidate.isBot)
      ) {
        room.game = createGame(
          room.id,
          room.settings.mode,
          room.members.map(({ playerId, name, colorChoice }) => ({
            id: playerId,
            name,
            colorChoice
          })),
          randomSeed()
        );
        this.scheduleBotAction(room, "opening");
        this.resetTurnDeadline(room);
      }
      await this.save(room);
      this.broadcast(room.game ? "game-state" : "lobby-state", room.game ?? this.publicLobby(room));
      return { ok: true };
    }

    if (event === "select-color") {
      const color = (payload as { color?: PlayerColor } | undefined)?.color;
      if (room.settings.privacy !== "private" || room.game)
        throw new Error("Colors can only be chosen before a private game begins.");
      if (color && !PLAYER_COLOR_ORDER.includes(color)) throw new Error("Choose a valid player color.");
      if (
        color &&
        room.members.some((candidate) => candidate.playerId !== memberId && candidate.colorChoice === color)
      )
        throw new Error("That color has already been claimed.");
      member.colorChoice = color;
      member.ready = false;
      await this.save(room);
      this.broadcast("lobby-state", this.publicLobby(room));
      return { ok: true };
    }

    if (event === "leave-lobby") {
      if (room.game) throw new Error("The game has already started.");
      room.members = room.members.filter((candidate) => candidate.playerId !== memberId);
      if (memberId === room.hostId || room.members.length === 0) {
        this.broadcast("lobby-closed", "The room host returned home.");
        await this.ctx.storage.deleteAll();
      } else {
        await this.save(room);
        this.broadcast("lobby-state", this.publicLobby(room));
      }
      return { ok: true };
    }

    if (event === "leave-game") {
      this.leaveGame(room, memberId);
      await this.save(room);
      this.broadcast(room.game?.status === "finished" ? "game-over" : "game-state", room.game);
      return { ok: true };
    }

    if (event === "command") {
      await this.applyCommand(room, memberId, payload as ClientCommand);
      this.resetTurnDeadline(room);
      await this.save(room);
      this.broadcast(room.game?.status === "finished" ? "game-over" : "game-state", room.game);
      return { ok: true };
    }

    throw new Error("Unknown room action.");
  }

  private async applyCommand(room: RoomSnapshot, actorId: string, command: ClientCommand): Promise<void> {
    if (!command || typeof command !== "object" || typeof command.commandId !== "string")
      throw new Error("Invalid game command.");
    if (!room.game) throw new Error("The game has not started.");
    if (room.processed.includes(command.commandId)) return;
    if (command.expectedVersion !== room.game.version)
      throw new Error("The board changed. Your view has been refreshed.");
    let next = room.game;
    if (command.type === "roll") next = roll(next, actorId);
    else if (command.type === "draw-fish") next = drawFish(next, actorId);
    else if (command.type === "move") next = move(next, actorId, command.move);
    else if (command.type === "place-elephant-seal")
      next = placeElephantSealAndPoop(next, actorId, command.to, {
        leavePoop: command.leavePoop
      });
    else if (command.type === "play-fish") next = playFish(next, actorId, command.play);
    else if (command.type === "resolve-poop-choice")
      next = resolvePoopChoice(next, actorId, command.pieceId, command.to);
    else if (command.type === "end-turn") next = endTurn(next, actorId);
    else throw new Error("Unknown game command.");
    room.game = next;
    room.processed.push(command.commandId);
    if (room.processed.length > 500) room.processed = room.processed.slice(-250);
    this.scheduleBotAction(room);
  }

  private activeMemberIsBot(room: RoomSnapshot): boolean {
    return Boolean(
      room.game && room.members.find((member) => member.playerId === room.game!.turn.activePlayerId)?.isBot
    );
  }

  // Arm the bot from outside the alarm loop (connect / command / commit / forced
  // completion). Swallows a precompute failure into a short retry so it can never
  // fail its caller; the alarm loop then escalates a persistent failure to a
  // forced turn completion (see advanceScheduledBot), so the room can't freeze.
  private scheduleBotAction(room: RoomSnapshot, prev?: BotActionKind | "opening"): void {
    try {
      this.beginThinking(room, prev);
    } catch {
      room.botActionAt = Date.now() + BOT_STEP_DELAY_MS;
    }
  }

  // Self-healing invariant: whenever it's a bot's turn in a live game there must
  // be a FUTURE pacing alarm. If one is missing or overdue -- e.g. a game
  // persisted by an older build froze mid-turn, or an alarm was lost across a
  // Durable Object eviction -- (re)arm it so reconnecting resumes play instead
  // of showing a stuck board. Safe to call anywhere: it no-ops when it isn't the
  // bot's turn or a valid future alarm is already pending.
  private ensureBotScheduled(room: RoomSnapshot): void {
    if (!room.game || room.game.status !== "playing" || !this.activeMemberIsBot(room)) return;
    if (room.botActionAt !== undefined && room.botActionAt > Date.now()) return;
    delete room.botActionAt;
    delete room.botThinking; // possibly stale or from an older build's shape.
    this.scheduleBotAction(room);
  }

  // Compute the bot's next action now and hold it until a single pacing alarm.
  // ONE bounded search -- no deepening loop, no wall-clock dependency -- so it
  // can't over-run or misbehave when Date.now() is frozen (deployed Cloudflare)
  // or CPU is constrained. Instant actions (roll / card / choice / end-turn) get
  // a short fixed pause; a move gets a random pause in [floor, budget] purely for
  // a natural cadence (the search itself is fast and hides inside it). `prev` is
  // the action that led here: after a roll the next move is the turn's first (big
  // window); "opening" is the game's very first action. May throw if the state is
  // genuinely broken -- callers decide whether to swallow (scheduleBotAction) or
  // escalate to a forced completion (advanceScheduledBot).
  private beginThinking(room: RoomSnapshot, prev?: BotActionKind | "opening"): void {
    if (!this.activeMemberIsBot(room) || room.game?.status !== "playing") {
      delete room.botActionAt;
      delete room.botThinking;
      delete room.botPlan;
      return;
    }
    if (room.botActionAt !== undefined) return; // already scheduled/thinking.
    const game = room.game;
    const actor = game.turn.activePlayerId;
    const now = Date.now();
    const depth = Math.min(MOVE_SEARCH_DEPTH, Math.max(1, game.turn.movesRemaining));
    const best = advanceBotAction(game, actor, { maxDepth: depth, plan: room.botPlan });

    let delay: number;
    if (best.kind !== "move") {
      delay = prev === "opening" ? BOT_OPENING_DELAY_MS : BOT_STEP_DELAY_MS;
    } else {
      const firstMove = prev === "roll";
      const floorMs = firstMove ? FIRST_MOVE_FLOOR_MS : LATER_MOVE_FLOOR_MS;
      const budgetMs = firstMove ? FIRST_MOVE_BUDGET_MS : LATER_MOVE_BUDGET_MS;
      delay = Math.round(floorMs + Math.random() * (budgetMs - floorMs));
    }
    room.botThinking = {
      forVersion: game.version,
      best: { state: best.state, kind: best.kind, plan: best.plan },
      depth
    };
    room.botActionAt = now + delay;
  }

  private async advanceScheduledBot(room: RoomSnapshot): Promise<void> {
    try {
      this.stepScheduledBot(room);
    } catch {
      // Absolute backstop: if anything at all goes wrong advancing the bot --
      // a broken precompute, or even committing an already-computed move --
      // force the turn to complete with simple legal moves rather than leaving
      // the room frozen. This must never be reachable in practice; it exists so
      // that a bot decision can never strand a game with no path forward.
      try {
        delete room.botThinking;
        delete room.botPlan;
        await this.completeTimedTurn(room);
      } catch {
        // Even forced completion failed (should be impossible). Keep a future
        // alarm armed so the room keeps trying rather than freezing outright.
        if (room.game?.status === "playing" && this.activeMemberIsBot(room)) {
          room.botActionAt = Date.now() + BOT_STEP_DELAY_MS;
        }
      }
    }
  }

  private stepScheduledBot(room: RoomSnapshot): void {
    const game = room.game;
    const thinking = room.botThinking;
    delete room.botActionAt;
    if (!game || game.status !== "playing" || !this.activeMemberIsBot(room)) {
      delete room.botThinking;
      delete room.botPlan;
      return;
    }
    if (!thinking || thinking.forVersion !== game.version) {
      // No plan, or the game moved on under us: recompute from scratch. Use the
      // throwing beginThinking (not the swallowing scheduleBotAction) so a
      // genuinely broken state escalates to the completeTimedTurn backstop
      // rather than silently retrying forever.
      delete room.botThinking;
      this.beginThinking(room);
      return;
    }
    // The alarm fired at the scheduled pause time (botActionAt): apply the held
    // action. Timing lives entirely in botActionAt, so there's nothing to re-gate.
    this.commitBotAction(room, thinking.best);
  }

  // Apply the chosen action and schedule the next one. Carries the principal
  // variation forward across moves within a turn (so the next move's search is
  // anchored to it) and clears it whenever the action isn't a move.
  private commitBotAction(room: RoomSnapshot, best: NonNullable<RoomSnapshot["botThinking"]>["best"]): void {
    delete room.botThinking;
    room.game = best.state;
    if (best.kind === "move") room.botPlan = best.plan;
    else delete room.botPlan;
    this.scheduleBotAction(room, best.kind);
  }

  private async completeTimedTurn(room: RoomSnapshot): Promise<void> {
    let state = room.game;
    if (!state || state.status !== "playing") return;
    // Force-completion invalidates any in-progress search and carried plan.
    delete room.botThinking;
    delete room.botActionAt;
    delete room.botPlan;
    const actor = state.turn.activePlayerId;
    let guard = 96;
    if (state.turn.pendingFishChoice) {
      state = playFish(state, actor, {
        cardId: state.turn.pendingFishChoice.cardId,
        choice: "keep-two"
      });
    }
    if (state.turn.pendingChoice) {
      while (state.turn.pendingChoice && guard-- > 0) {
        const option =
          state.turn.pendingChoice.options[state.seed % state.turn.pendingChoice.options.length]!;
        const position = option.positions[state.seed % option.positions.length]!;
        state = resolvePoopChoice(state, actor, option.pieceId, position);
      }
      room.game = state;
      this.scheduleBotAction(room);
      this.resetTurnDeadline(room);
      return;
    }
    while (state.turn.phase === "awaiting-roll" && state.turn.forcedPieceOwnerIds?.length && guard-- > 0) {
      const moves = legalMoves(state, actor);
      if (!moves.length) break;
      state = move(state, actor, moves[(state.seed + guard) % moves.length]!);
    }
    if (state.turn.phase === "awaiting-roll") state = roll(state, actor);
    while (state.turn.phase === "moving" && state.turn.movesRemaining > 0 && guard-- > 0) {
      const moves = legalMoves(state, actor);
      if (!moves.length) break;
      state = move(state, actor, moves[(state.seed + guard) % moves.length]!);
    }
    state = endTurn(state, actor);
    while (state.turn.pendingChoice && guard-- > 0) {
      const option = state.turn.pendingChoice.options[state.seed % state.turn.pendingChoice.options.length]!;
      const position = option.positions[state.seed % option.positions.length]!;
      state = resolvePoopChoice(state, actor, option.pieceId, position);
    }
    room.game = state;
    this.scheduleBotAction(room);
    this.resetTurnDeadline(room);
  }

  private leaveGame(room: RoomSnapshot, memberId: string): void {
    if (!room.game || room.game.status === "finished") throw new Error("You are not in an active game.");
    const game = room.game;
    if (room.settings.mode !== "classic-4") {
      game.status = "finished";
      game.winnerId = game.players.find((player) => player.id !== memberId)?.id;
    } else {
      const leavingIndex = game.turnOrder.indexOf(memberId);
      game.pieces = game.pieces.filter((piece) => piece.ownerId !== memberId);
      game.turnOrder = game.turnOrder.filter((id) => id !== memberId);
      if (game.turn.activePlayerId === memberId && game.turnOrder.length > 0)
        game.turn.activePlayerId = game.turnOrder[Math.max(0, leavingIndex) % game.turnOrder.length]!;
      if (game.turnOrder.length === 1) {
        game.status = "finished";
        game.winnerId = game.turnOrder[0];
      }
    }
    game.version += 1;
    room.members = room.members.filter((candidate) => candidate.playerId !== memberId);
    delete room.disconnectDeadlines[memberId];
  }

  private forfeitDisconnected(room: RoomSnapshot, memberId: string): void {
    const member = room.members.find((candidate) => candidate.playerId === memberId);
    delete room.disconnectDeadlines[memberId];
    if (!member || member.connected || !room.game || room.game.status === "finished") return;
    this.leaveGame(room, memberId);
  }

  private async markDisconnected(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.memberId) return;
    const room = this.migrateRoom(await this.ctx.storage.get<RoomSnapshot>("room"));
    const member = room?.members.find((candidate) => candidate.playerId === attachment.memberId);
    if (!room || !member || member.isBot) return;
    const anotherSocketIsOpen = this.ctx
      .getWebSockets(member.playerId)
      .some((candidate) => candidate !== socket && candidate.readyState === WebSocket.OPEN);
    if (anotherSocketIsOpen || (!member.connected && room.disconnectDeadlines[member.playerId])) return;
    member.connected = false;
    room.game?.players.forEach((player) => {
      if (player.id === member.playerId) player.connected = false;
    });
    room.disconnectDeadlines[member.playerId] = Date.now() + RECONNECT_MS;
    await this.save(room);
    this.broadcast("lobby-state", this.publicLobby(room));
    if (room.game) this.broadcast(room.game.status === "finished" ? "game-over" : "game-state", room.game);
  }

  private resetTurnDeadline(room: RoomSnapshot): void {
    if (!room.game || room.game.status !== "playing") return;
    if (!room.settings.turnTimerSeconds) {
      delete room.game.turn.timerDeadline;
      delete room.game.turn.timerDurationSeconds;
      return;
    }
    if (room.game.turn.timerDeadline) return;
    room.game.turn.timerDurationSeconds = room.settings.turnTimerSeconds;
    room.game.turn.timerDeadline = Date.now() + room.settings.turnTimerSeconds * 1_000;
  }

  private publicLobby(room: RoomSnapshot): PublicLobby {
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      settings: room.settings,
      requiredPlayers: playerCount(room.settings.mode),
      members: room.members.map(({ playerId, reconnectToken: _token, ...member }) => ({
        id: playerId,
        ...member
      })),
      started: Boolean(room.game)
    };
  }

  private broadcast(event: string, payload: unknown, exceptMemberId?: string): void {
    const clientPayload =
      payload && (event === "game-state" || event === "game-over")
        ? publicGameState(payload as NonNullable<RoomSnapshot["game"]>)
        : payload;
    const message = serializeEvent(event, clientPayload);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.memberId !== exceptMemberId && socket.readyState === WebSocket.OPEN)
        socket.send(message);
    }
  }

  private async requireRoom(): Promise<RoomSnapshot> {
    const room = this.migrateRoom(await this.ctx.storage.get<RoomSnapshot>("room"));
    if (!room) throw new Error("That room is unavailable.");
    return room;
  }

  private migrateRoom(room: RoomSnapshot | undefined): RoomSnapshot | undefined {
    if (room?.game) room.game = migrateGameState(room.game);
    return room;
  }

  private async save(room: RoomSnapshot): Promise<void> {
    const deadlines = [
      room.expiresAt,
      room.game?.turn.timerDeadline,
      room.botActionAt,
      ...Object.values(room.disconnectDeadlines)
    ].filter((value): value is number => typeof value === "number" && value > Date.now());
    const alarmAt = deadlines.length ? Math.min(...deadlines) : undefined;
    await Promise.all([
      this.ctx.storage.put("room", room),
      alarmAt !== undefined ? this.ctx.storage.setAlarm(alarmAt) : this.ctx.storage.deleteAlarm()
    ]);
  }
}
