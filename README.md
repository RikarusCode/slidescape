# Slidescape

Slidescape is a real-time strategy board game in which you slide penguins across an ice board and escape them through the exit on the far side. Penguins slide until they hit an obstacle, ice blocks and a shared elephant seal shuffle one square at a time, and Fish and Poop cards add swings of luck — all under the rule that every flock must always keep a route to its own exit open.

It runs in the browser with server-authoritative multiplayer and supports public matchmaking, private rooms joined by a six-character code, and single-player matches against a bot.

## Game modes

| Mode     | Players | Flocks per player | Win condition      |
| -------- | ------: | ----------------- | ------------------ |
| Beginner |       2 | One               | Escape 4 penguins  |
| Standard |       2 | Two               | Escape 10 penguins |
| Classic  |       4 | One               | Escape 6 penguins  |

The board is a 14×14 grid. Players roll a six-sided die each turn and spend the result as individual moves, split across pieces in any order. The full rules — Fish cards, Poop cards, the elephant seal, and the exit-route restriction — are available in-app from the **How to play** dialog.

## Features

- Server-authoritative multiplayer over WebSockets with optimistic version checks
- Public queues, private six-character room codes, and single-player bot matches
- Optional 45-second, 90-second, or 3-minute turn timers for private rooms
- Reconnection support and match state persisted in Durable Object storage
- Alarm-paced bot opponent driven by the shared rules engine
- Responsive React interface with animated pieces, score history, and sound controls
- Deterministic, independently tested game engine shared by client and server

## Architecture

Slidescape is a pnpm workspace that deploys as a single Cloudflare Worker.

- `apps/web` — React 19 + Vite client. Its production build is served through Workers Static Assets.
- `apps/worker` — HTTP API, WebSocket protocol, matchmaking, and room coordination.
- `packages/game` — TypeScript rules engine, board configuration, cards, bot logic, and shared protocol types (`@slidescape/game`).

One `Matchmaker` Durable Object per game mode serializes public queues. Every match runs in its own `GameRoom` Durable Object, which holds the canonical lobby and game snapshot in SQLite-backed storage. Durable Object alarms handle bot pacing, turn deadlines, reconnect forfeits, and inactive-room cleanup, while WebSocket Hibernation lets connections survive object eviction. The runtime requires no application secrets or separately provisioned KV, D1, or Redis services.

## Local development

Requires Node.js 22 (as used in CI); the workspace pins pnpm 10.12.1.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:5173>. Vite proxies API, health, and WebSocket traffic to Wrangler on port `8787`, and local Durable Object state is stored under `.wrangler/`.

## Commands

| Command                | Purpose                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`             | Build shared code and the web bundle, then run Vite and Wrangler together |
| `pnpm build`           | Build the rules package, web client, and Worker bundle                    |
| `pnpm typecheck`       | Type-check every workspace                                                |
| `pnpm test`            | Run unit tests plus the workerd-backed Worker integration suite           |
| `pnpm test:worker`     | Run only the Worker integration suite                                     |
| `pnpm test:smoke`      | Smoke-test a Worker running at `http://127.0.0.1:8787`                    |
| `pnpm benchmark:rules` | Benchmark initial legal-move generation across all modes                  |
| `pnpm arena`           | Run bots against each other to evaluate their strength                    |
| `pnpm format:check`    | Check formatting with Prettier                                            |
| `pnpm deploy:dry`      | Build and validate the Cloudflare deployment without publishing           |

Set `SLIDESCAPE_URL` to point the smoke test at a different Worker URL.

## Deployment

Authenticate Wrangler, validate the build, then publish:

```bash
pnpm wrangler login
pnpm deploy:dry
pnpm deploy
```

[`wrangler.jsonc`](./wrangler.jsonc) defines the Worker, static assets, observability, and both SQLite-backed Durable Object classes; Wrangler provisions the required namespaces on deploy. After changing Worker bindings, regenerate and verify the environment types:

```bash
pnpm wrangler types apps/worker/src/worker-configuration.d.ts
pnpm wrangler types apps/worker/src/worker-configuration.d.ts --check
```

Runtime health is exposed at `GET /health`. Never commit `.dev.vars`, credentials, or API tokens.

## Project layout

```text
apps/
  web/       React client and static assets
  worker/    Cloudflare Worker and Durable Objects
packages/
  game/      Rules engine, bots, cards, shared types, and unit tests
scripts/     Smoke test, rules benchmark, and bot arena
docs/        Performance and maintainability audit
```

## Acknowledgements

Slidescape is an independent fan-made project inspired by the [Chickapig board game](https://www.chickapig.com/chickapig). It is not affiliated with, sponsored by, or endorsed by Chickapig or its creators.
