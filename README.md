# Slidescape

Slidescape is a real-time strategy board game about sliding penguins across the ice and escaping them through the opposite side of the board. It supports public matchmaking, code-based private rooms, and single-player matches against bots in three formats:

| Mode     | Players | Setup                         | Win condition         |
| -------- | ------: | ----------------------------- | --------------------- |
| Beginner |       2 | One opposing flock per player | Escape 4 penguins     |
| Standard |       2 | Two flocks per player         | Escape 10 penguins    |
| Classic  |       4 | One flock per player          | Escape all 6 penguins |

Penguins slide until blocked, while ice blocks move one square at a time. The shared elephant seal, Fish cards, Poop cards, and the rule that every flock must retain a route to its exit add tactical constraints. The complete rules are available in the application.

## Features

- Server-authoritative multiplayer over WebSockets
- Public queues, private six-character room codes, and bot matches
- Optional 45-second, 90-second, or 3-minute turn timers for private rooms
- Reconnection support and persisted match state
- Responsive React interface with animated pieces, score history, and sound controls
- Deterministic, independently tested game engine shared by the client and server

## Architecture

Slidescape is a pnpm monorepo deployed as one Cloudflare Worker:

- `apps/web` contains the React 19 and Vite client. Its production build is served through Workers Static Assets.
- `apps/worker` contains the HTTP API, WebSocket protocol, matchmaking, and room coordination.
- `packages/game` contains the TypeScript rules engine, board configuration, bot logic, and shared protocol types.

Public queues are serialized by one `Matchmaker` Durable Object per game mode. Every match runs in its own `GameRoom` Durable Object, which stores the canonical lobby and game snapshot in SQLite-backed Durable Object storage. Durable Object alarms handle bot pacing, turn deadlines, reconnect forfeits, and inactive-room cleanup; WebSocket Hibernation allows connections to survive object eviction.

The current runtime does not require application secrets or separately provisioned KV, D1, or Redis services.

## Local development

Use Node.js 22, as configured in CI. The workspace pins pnpm 10.12.1.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:5173>. Vite proxies API, health, and WebSocket traffic to Wrangler on port `8787`. Local Durable Object state is stored under `.wrangler/`.

## Commands

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`             | Build shared code and the initial web bundle, then start Vite and Wrangler |
| `pnpm build`           | Build the rules package, web client, and Worker bundle                     |
| `pnpm typecheck`       | Type-check all workspaces and Worker integration tests                     |
| `pnpm test`            | Run unit tests and workerd-backed Worker integration tests                 |
| `pnpm test:worker`     | Run only the Worker integration suite                                      |
| `pnpm test:smoke`      | Test a Worker running at `http://127.0.0.1:8787`                           |
| `pnpm benchmark:rules` | Benchmark initial legal-move generation in all modes                       |
| `pnpm format:check`    | Check formatting with Prettier                                             |
| `pnpm deploy:dry`      | Build and validate the Cloudflare deployment without publishing            |

Set `SLIDESCAPE_URL` to run the smoke test against another Worker URL.

## Deployment

Authenticate Wrangler, validate the deployment, and publish:

```sh
pnpm wrangler login
pnpm deploy:dry
pnpm deploy
```

[`wrangler.jsonc`](./wrangler.jsonc) defines the Worker, static assets, observability, and both SQLite-backed Durable Object classes. Wrangler creates the required namespaces during deployment; no separate storage setup is needed.

After changing Worker bindings, regenerate and check the environment types:

```sh
pnpm wrangler types apps/worker/src/worker-configuration.d.ts
pnpm wrangler types apps/worker/src/worker-configuration.d.ts --check
```

Runtime health is exposed at `GET /health`. Do not commit `.dev.vars`, credentials, or API tokens.

## Project layout

```text
apps/
  web/       React client and static assets
  worker/    Cloudflare Worker and Durable Objects
packages/
  game/      Rules engine, bots, shared types, and unit tests
scripts/     Smoke test and rules benchmark
docs/        Performance and maintainability audit
```

Slidescape is an independent fan-made project inspired by the [Chickapig board game](https://www.chickapig.com/chickapig). It is not affiliated with or endorsed by Chickapig or its creators.
