import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ClientCommand, GameMode, GameState, PlayerColor, TurnTimerSeconds } from "@slidescape/game";
import { useAudioScene } from "./components/AudioSettings.js";
import { Home, WaitingRoom, type LobbyState } from "./components/Lobby.js";
import { connectGame, readSession, SESSION_KEY, type GameSocket, type Session } from "./socket.js";

interface ActionReply {
  ok: boolean;
  message?: string;
  waiting?: boolean;
}

const loadGameView = () => import("./components/GameView.js");
const GameView = lazy(() => loadGameView().then((module) => ({ default: module.GameView })));
const prefetchGameView = () => {
  void loadGameView().catch(() => undefined);
};

export function mergeCanonicalState(current: GameState | undefined, incoming: GameState): GameState {
  if (!current || current.id !== incoming.id || current.version < incoming.version) return incoming;
  if (current.version > incoming.version) return current;
  const presenceChanged = current.players.some(
    (player, index) => player.connected !== incoming.players[index]?.connected
  );
  return presenceChanged ? incoming : current;
}

export function App() {
  const [name, setName] = useState(() => localStorage.getItem("slidescape-name") ?? "");
  const [mode, setMode] = useState<GameMode>("quick-2");
  const [code, setCode] = useState("");
  const [privateTimerSeconds, setPrivateTimerSeconds] = useState<TurnTimerSeconds>(0);
  const [session, setSession] = useState<Session>();
  const [lobby, setLobby] = useState<LobbyState>();
  const [game, setGame] = useState<GameState>();
  const [message, setMessage] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<GameSocket | undefined>(undefined);
  useAudioScene(game ? (game.status === "finished" ? "results" : "game") : "lobby");

  const ensureSocket = () => {
    if (socketRef.current) return socketRef.current;
    const socket = connectGame(name.trim() || "Penguin Player");
    socketRef.current = socket;
    localStorage.setItem("slidescape-name", name.trim() || "Penguin Player");
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (error: Error) => {
      setConnected(false);
      setSearching(false);
      setMessage(
        error.message || "Could not reach the game server. Check that it is running, then try again."
      );
    });
    socket.on("session-reset", (value: string) => {
      setGame(undefined);
      setLobby(undefined);
      setSearching(false);
      setMessage(value);
    });
    socket.on("session", (value: Session) => {
      const previous = readSession();
      if (previous && previous.reconnectToken !== value.reconnectToken) {
        setGame(undefined);
        setLobby(undefined);
        setSearching(false);
        setMessage("Your previous match is no longer available. You can start a new game.");
      }
      setSession(value);
      localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    });
    socket.on("lobby-state", (value: LobbyState) => {
      prefetchGameView();
      setLobby(value);
      setSearching(false);
      setMessage(undefined);
    });
    socket.on("lobby-closed", (value: string) => {
      setLobby(undefined);
      setMessage(value);
    });
    const acceptCanonicalState = (value: GameState) =>
      setGame((current) => mergeCanonicalState(current, value));
    socket.on("game-state", (value: GameState) => {
      acceptCanonicalState(value);
      setSearching(false);
      setMessage(undefined);
    });
    socket.on("game-over", acceptCanonicalState);
    socket.on("server-message", (value: string) => setMessage(value));
    return socket;
  };

  useEffect(() => {
    if (readSession()) ensureSocket();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = undefined;
    };
  }, []);

  // Keep the live socket + persisted name in step with the input, so a name
  // changed after queuing (or between games) is the one carried into the match.
  useEffect(() => {
    const resolved = name.trim() || "Penguin Player";
    socketRef.current?.setName(resolved);
    localStorage.setItem("slidescape-name", resolved);
  }, [name]);
  const emitWithReply = (event: string, payload: unknown, handleReply: (reply: ActionReply) => void) => {
    const socket = ensureSocket();
    setMessage(undefined);
    socket.timeout(5000).emit(event, payload, (error: Error | null, reply?: ActionReply) => {
      if (error || !reply) {
        setSearching(false);
        setMessage("The game server did not respond. Please try again.");
        return;
      }
      handleReply(reply);
    });
  };
  const action = (event: string, payload: unknown) => {
    emitWithReply(event, payload, (reply) => {
      if (!reply.ok) setMessage(reply.message ?? "Something went wrong.");
      else if (reply.waiting) setMessage("Searching for another player…");
    });
  };
  const send = (command: ClientCommand) => action("command", command);
  const queueRandom = () => {
    prefetchGameView();
    emitWithReply("join-queue", { mode }, (reply) => {
      if (!reply.ok) setMessage(reply.message ?? "Could not join matchmaking.");
      else if (reply.waiting) {
        setSearching(true);
        setMessage(undefined);
      }
    });
  };
  const cancelQueue = () => {
    ensureSocket().emit("leave-lobby", () => {
      setSearching(false);
      setMessage(undefined);
    });
  };
  const leaveLobby = () => {
    const socket = ensureSocket();
    socket.emit("leave-lobby", () => {
      setLobby(undefined);
      setGame(undefined);
      setMessage(undefined);
    });
  };

  const returnHome = (notice?: string) => {
    socketRef.current?.disconnect();
    socketRef.current = undefined;
    localStorage.removeItem(SESSION_KEY);
    setConnected(false);
    setSession(undefined);
    setGame(undefined);
    setLobby(undefined);
    setSearching(false);
    setMessage(notice);
  };

  const leaveGame = () => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      returnHome();
      return;
    }
    socket
      .timeout(3000)
      .emit("leave-game", (error: Error | null, reply?: { ok: boolean; message?: string }) => {
        if (error) returnHome("The match connection was lost, so you were returned home locally.");
        else returnHome(reply?.ok ? undefined : "That match had already ended on the server.");
      });
  };

  if (game && session)
    return (
      <Suspense
        fallback={
          <main className="game-loading" role="status">
            Preparing the ice…
          </main>
        }
      >
        <GameView
          state={game}
          playerId={session.playerId}
          roomCode={lobby?.code}
          connected={connected}
          message={message}
          send={send}
          onLeaveGame={leaveGame}
          onReturnHome={() => returnHome()}
        />
      </Suspense>
    );
  if (lobby && session)
    return (
      <WaitingRoom
        lobby={lobby}
        playerId={session.playerId}
        message={message}
        onLeave={leaveLobby}
        onReady={(ready) => ensureSocket().emit("ready", ready)}
        onColorChange={(color?: PlayerColor) => action("select-color", { color })}
      />
    );
  return (
    <Home
      name={name}
      setName={setName}
      mode={mode}
      setMode={setMode}
      code={code}
      setCode={setCode}
      privateTimerSeconds={privateTimerSeconds}
      setPrivateTimerSeconds={setPrivateTimerSeconds}
      onCreate={() =>
        action("create-private", {
          mode,
          turnTimerSeconds: privateTimerSeconds
        })
      }
      onJoin={() => action("join-private", { code })}
      onQueue={queueRandom}
      onCancelQueue={cancelQueue}
      onBot={() => {
        prefetchGameView();
        action("play-bot", { mode });
      }}
      searching={searching}
      message={message}
    />
  );
}
