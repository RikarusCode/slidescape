const baseUrl = process.env.SLIDESCAPE_URL ?? "http://127.0.0.1:8787";
const websocketBase = baseUrl.replace(/^http/, "ws");
const timeoutMs = 6_000;

function identity(name) {
  return { playerId: crypto.randomUUID(), reconnectToken: crypto.randomUUID(), name };
}

async function post(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const reply = await response.json();
  if (!reply.ok) throw new Error(`${path}: ${reply.message ?? response.status}`);
  return reply;
}

function connection(path) {
  const socket = new WebSocket(`${websocketBase}${path}`);
  const events = [];
  const waiters = [];
  const replies = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.replyTo) {
      const resolve = replies.get(message.replyTo);
      replies.delete(message.replyTo);
      resolve?.(message.payload);
      return;
    }
    const waiterIndex = waiters.findIndex((waiter) => waiter.event === message.event);
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message.payload);
    else events.push(message);
  });

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket open timed out: ${path}`)), timeoutMs);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`WebSocket failed: ${path}`)); }, { once: true });
  });

  function next(event) {
    const index = events.findIndex((message) => message.event === event);
    if (index >= 0) return Promise.resolve(events.splice(index, 1)[0].payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Event timed out: ${event}`)), timeoutMs);
      waiters.push({ event, resolve: (payload) => { clearTimeout(timer); resolve(payload); } });
    });
  }

  function send(event, payload) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { replies.delete(id); reject(new Error(`Reply timed out: ${event}`)); }, timeoutMs);
      replies.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
      socket.send(JSON.stringify({ id, event, payload }));
    });
  }

  return { socket, opened, next, send };
}

function roomConnection(roomId, player) {
  const query = new URLSearchParams({ playerId: player.playerId, reconnectToken: player.reconnectToken });
  return connection(`/ws/room/${encodeURIComponent(roomId)}?${query}`);
}

function queueConnection(mode, player) {
  const query = new URLSearchParams({ playerId: player.playerId, reconnectToken: player.reconnectToken, name: player.name });
  return connection(`/ws/queue/${mode}?${query}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await (await fetch(`${baseUrl}/health`)).json();
assert(health.ok, "Worker health check failed.");

const host = identity("Smoke Host");
const guest = identity("Smoke Guest");
const created = await post("/api/private/create", { ...host, mode: "quick-2", turnTimerSeconds: 45 });
assert(/^[A-Z2-9]{6}$/.test(created.roomId), "Private room code was not generated.");
await post("/api/private/join", { ...guest, code: created.roomId });

const hostRoom = roomConnection(created.roomId, host);
const guestRoom = roomConnection(created.roomId, guest);
await Promise.all([hostRoom.opened, guestRoom.opened]);
const [hostLobby, guestLobby] = await Promise.all([hostRoom.next("lobby-state"), guestRoom.next("lobby-state")]);
assert(hostLobby.members.length === 2 && guestLobby.members.length === 2, "Private lobby did not converge to two players.");

const hostColor = await hostRoom.send("select-color", { color: "berry-pink" });
const duplicateColor = await guestRoom.send("select-color", { color: "berry-pink" });
assert(hostColor.ok && !duplicateColor.ok, "Private color claims were not enforced atomically.");
await hostRoom.send("ready", true);
await guestRoom.send("ready", true);
const [hostGame, guestGame] = await Promise.all([hostRoom.next("game-state"), guestRoom.next("game-state")]);
assert(hostGame.id === guestGame.id && hostGame.players.length === 2, "Private game state did not converge.");
assert(hostGame.turn.timerDeadline > Date.now(), "Private turn alarm deadline was not armed.");

hostRoom.socket.close(1000, "Reconnect test");
const hostReconnect = roomConnection(created.roomId, host);
await hostReconnect.opened;
const restored = await hostReconnect.next("game-state");
assert(restored.id === hostGame.id && restored.version === hostGame.version, "Room reconnect did not restore canonical state.");

const queueOne = identity("Queue One");
const queueTwo = identity("Queue Two");
const firstQueue = queueConnection("quick-2", queueOne);
await firstQueue.opened;
const secondQueue = queueConnection("quick-2", queueTwo);
await secondQueue.opened;
const [firstMatch, secondMatch] = await Promise.all([firstQueue.next("matched"), secondQueue.next("matched")]);
assert(firstMatch.roomId === secondMatch.roomId, "Public matchmaking assigned different rooms.");
const publicOne = roomConnection(firstMatch.roomId, queueOne);
const publicTwo = roomConnection(secondMatch.roomId, queueTwo);
await Promise.all([publicOne.opened, publicTwo.opened]);
const publicLobby = await publicOne.next("lobby-state");
assert(publicLobby.members.length === 2 && publicLobby.settings.turnTimerSeconds === 90, "Public lobby settings are incorrect.");

for (const active of [guestRoom, hostReconnect, publicOne, publicTwo]) active.socket.close(1000, "Smoke complete");
console.log(JSON.stringify({ ok: true, privateCode: created.roomId, publicRoomId: firstMatch.roomId, checks: 8 }));
