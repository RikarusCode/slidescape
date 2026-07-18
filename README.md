# Slidescape

Slidescape is a responsive, real-time ice strategy board game for two or four players. It uses a server-authoritative TypeScript rules engine, random matchmaking, and private rooms with invite codes.

## Run locally

Requirements: Node.js 22+, pnpm 10+, and optionally Docker for Redis.

```powershell
pnpm install
docker compose up -d redis
pnpm dev
```

Open `http://127.0.0.1:5173`. The server runs on port `3001`. Without `REDIS_URL`, the server uses its in-memory development store.

## Commands

- `pnpm dev` — run the web and server development processes.
- `pnpm test` — run deterministic rules tests.
- `pnpm typecheck` — type-check every workspace.
- `pnpm build` — build the game package, server, and web client.

## Structure

- `packages/game` — pure rules engine, board configuration, cards, protocol types, and tests.
- `apps/server` — Fastify/Socket.IO authoritative game rooms and matchmaking.
- `apps/web` — React/Vite responsive game client rendered with CSS and SVG.
