# Slidescape

Slidescape is a responsive, server-authoritative ice strategy game for two or four players. The React client and multiplayer Worker deploy together on Cloudflare. Public queues use one matchmaking Durable Object per mode, while every private, public, or bot match has its own SQLite-backed room Durable Object.

## Cloudflare architecture

- **Worker Static Assets** serves the Vite application and its artwork.
- **Matchmaker Durable Objects** serialize each public queue.
- **GameRoom Durable Objects** own lobby membership, WebSockets, game state, reconnects, bots, and commands.
- **Durable Object SQLite storage** persists every accepted state change.
- **WebSocket Hibernation** keeps idle room connections inexpensive.
- **Durable Object alarms** enforce turn timers, reconnect deadlines, and room cleanup.

KV, D1, Redis, accounts, and application secrets are not required.

## Local development

Requirements: Node.js 22+, pnpm 10+, and Wrangler 4.

```powershell
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api`, `/ws`, and `/health` to the local Worker on port `8787`. Local Durable Object data is kept beneath `.wrangler/`.

Useful commands:

- `pnpm dev` — build the shared rules and initial frontend, then run Vite and the local Worker.
- `pnpm typecheck` — type-check the rules, Worker, Worker integration tests, and web client.
- `pnpm test` — run all rules, UI utility, protocol, and Durable Object integration tests.
- `pnpm test:worker` — run the production Worker integration suite inside Cloudflare's local runtime.
- `pnpm test:smoke` — smoke-test a Worker already running at `http://127.0.0.1:8787`.
- `pnpm build` — build the rules, web assets, and Worker deployment bundle.
- `pnpm deploy:dry` — validate the complete Cloudflare deployment without publishing it.
- `pnpm deploy` — build and publish Slidescape to Cloudflare.

## First deployment

Authenticate once:

```powershell
pnpm wrangler login
pnpm wrangler whoami
```

Then deploy:

```powershell
pnpm deploy
```

If Wrangler reports a certificate-chain error on a Windows network that inspects HTTPS traffic, retry with the Windows certificate store enabled:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
pnpm deploy
```

Wrangler reads [`wrangler.jsonc`](./wrangler.jsonc) and automatically provisions the two SQLite-backed Durable Object namespaces. It also uploads `apps/web/dist` and returns the new `workers.dev` URL. No dashboard storage setup is necessary.

Check production health and logs:

```powershell
Invoke-RestMethod https://YOUR-WORKER.workers.dev/health
pnpm wrangler tail slidescape
```

To use a custom domain, open **Cloudflare Dashboard → Workers & Pages → slidescape → Settings → Domains & Routes → Add → Custom Domain**. Cloudflare provisions HTTPS automatically.

## Configuration policy

Treat `wrangler.jsonc` as the production source of truth. After changing bindings, regenerate and verify environment types:

```powershell
pnpm wrangler types apps/worker/src/worker-configuration.d.ts
pnpm wrangler types apps/worker/src/worker-configuration.d.ts --check
```

Do not commit `.dev.vars`, credentials, API tokens, or other secrets. Slidescape currently needs no runtime secrets.

## Project structure

- `packages/game` — deterministic rules, board configuration, cards, protocol types, and tests.
- `apps/worker` — Cloudflare Worker, matchmaking, room Durable Objects, persistence, alarms, and WebSockets.
- `apps/web` — responsive React/Vite client.
