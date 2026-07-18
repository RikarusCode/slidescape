import { useEffect, useRef, useState } from "react";
import type { ClientCommand, GameMode, GameState, TurnTimerSeconds } from "@slidescape/game";
import type { Socket } from "socket.io-client";
import { GameView } from "./components/GameView.js";
import { Home, WaitingRoom, type LobbyState } from "./components/Lobby.js";
import { connectGame, readSession, SESSION_KEY, type Session } from "./socket.js";

export function App() {
  const [name, setName] = useState(() => localStorage.getItem("slidescape-name") ?? "");
  const [mode, setMode] = useState<GameMode>("quick-2");
  const [code, setCode] = useState("");
  const [privateTimerSeconds, setPrivateTimerSeconds] = useState<TurnTimerSeconds>(0);
  const [session, setSession] = useState<Session>();
  const [lobby, setLobby] = useState<LobbyState>();
  const [game, setGame] = useState<GameState>();
  const [message, setMessage] = useState<string>();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | undefined>(undefined);

  const ensureSocket = () => {
    if (socketRef.current) return socketRef.current;
    const socket = connectGame(name.trim() || "Penguin Player");
    socketRef.current = socket;
    localStorage.setItem("slidescape-name", name.trim() || "Penguin Player");
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("session", (value: Session) => { setSession(value); localStorage.setItem(SESSION_KEY, JSON.stringify(value)); });
    socket.on("lobby-state", (value: LobbyState) => setLobby(value));
    socket.on("lobby-closed", (value: string) => { setLobby(undefined); setMessage(value); });
    socket.on("game-state", (value: GameState) => { setGame(value); setMessage(undefined); });
    socket.on("game-over", (value: GameState) => setGame(value));
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
  const action = (event: string, payload: unknown) => {
    const socket = ensureSocket();
    socket.emit(event, payload, (reply: { ok: boolean; message?: string; waiting?: boolean }) => {
      if (!reply.ok) setMessage(reply.message ?? "Something went wrong.");
      else if (reply.waiting) setMessage("Searching for another player…");
    });
  };
  const send = (command: ClientCommand) => action("command", command);
  const leaveLobby = () => {
    const socket = ensureSocket();
    socket.emit("leave-lobby", () => {
      setLobby(undefined);
      setGame(undefined);
      setMessage(undefined);
    });
  };

  if (game && session) return <GameView state={game} playerId={session.playerId} roomCode={lobby?.code} connected={connected} send={send}/>;
  if (lobby && session) return <WaitingRoom lobby={lobby} playerId={session.playerId} onLeave={leaveLobby} onReady={(ready) => ensureSocket().emit("ready", ready)}/>;
  return <Home name={name} setName={setName} mode={mode} setMode={setMode} code={code} setCode={setCode} privateTimerSeconds={privateTimerSeconds} setPrivateTimerSeconds={setPrivateTimerSeconds} onCreate={() => action("create-private", { mode, turnTimerSeconds: privateTimerSeconds })} onJoin={() => action("join-private", { code })} onQueue={() => action("join-queue", { mode })} onBot={() => action("play-bot", { mode })} message={message}/>;
}
