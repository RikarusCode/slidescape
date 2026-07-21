# Slidescape performance and maintainability audit

Audited July 20, 2026. Measurements were taken from a production build on Windows with Node.js 24.13.0.
Timing varies by machine, so the checked-in rules benchmark is the repeatable comparison point.

## Critical flows

1. Home screen render, mode selection, audio settings, and rules.
2. Public matchmaking or private-room creation, joining, colors, and readiness.
3. Initial room connection, bot opening delay, reconnect, and leave flows.
4. Every turn command: roll, legal-move generation, board interaction, animation, cards, timers, and bot actions.
5. Durable Object persistence and canonical-state broadcast after accepted commands.
6. Results rendering, score history, and return to the home screen.

The rules engine and board rendering are the most latency-sensitive local paths. Durable Object storage and
WebSocket fan-out are the most latency-sensitive server paths.

## Baselines and results

| Measurement                          |    Before |     After |
| ------------------------------------ | --------: | --------: |
| Quick 2-player legal moves, mean     |  41.23 ms |   4.28 ms |
| Strategic 2-player legal moves, mean | 303.63 ms |  12.45 ms |
| Classic 4-player legal moves, mean   | 144.57 ms |   6.03 ms |
| Initial JavaScript, gzip             |  86.77 kB |  76.85 kB |
| Game-only JavaScript chunk, gzip     |      none |  11.88 kB |
| CSS, gzip                            |  13.11 kB |  11.84 kB |
| Worker bundle, gzip                  | 14.16 KiB | 15.11 KiB |
| pnpm lockfile                        |  94,924 B |  75,264 B |
| Installed package directories        |       218 |       136 |
| Automated tests                      |        53 |        64 |

Run `pnpm benchmark:rules` to repeat the rules-engine measurement. The Worker increase is deliberate: request
size validation, public-state redaction, safer protocol handling, and security headers were added.

The seven music tracks account for about 18.1 MB of deployed static assets. They are not part of initial page
load: the browser streams one shuffled track only after audio is unlocked. Initial game states are approximately
3.3-5.9 kB, so canonical full-state broadcasts remain a reasonable correctness/performance tradeoff.

## Implemented changes

- Replaced clone-and-search goal validation inside every candidate move with shared occupancy maps and one
  reverse-reachability pass per active color. Queue traversal no longer uses `Array.shift()`.
- Generate legal moves once per canonical React state and pass them into the board.
- Hoisted static SVG board cells and grid lines, delegated cell clicks, and memoized unchanged pieces.
- Added optimistic piece motion without allowing interaction while disconnected or outside the active turn.
- Split the match UI from the initial bundle and prefetch it during matchmaking or lobby waiting.
- Ignore equal or older canonical-state duplicates to avoid redundant React renders.
- Preserve same-version player-presence changes while still ignoring duplicate board states, and roll back an
  optimistic move immediately when the server rejects its command.
- Serialize each room broadcast once instead of once per connected socket.
- Coalesce the Durable Object snapshot and alarm operations and avoid unnecessary matchmaking cleanup reads.
- Redact Fish and Poop deck order from every client-facing state while retaining it in canonical storage.
- Hardened queue close/error recovery, HTTP response parsing, input sizes, room-code validation, and security
  headers.
- Fixed a forced-opponent-move edge case that could prevent rolling when no forced move existed.
- Removed obsolete CSS selectors, normalized source formatting, and enforced formatting in CI.
- Replaced the duplicate Fastify/Socket.IO/Redis server with 13 workerd-backed integration tests against the
  production Matchmaker and GameRoom Durable Objects.
- Added direct coverage for Durable Object persistence, eviction recovery, alarms, WebSockets, matchmaking
  cancellation/deduplication, private colors, all timer settings, stale and duplicate commands, bot startup,
  and two- and four-player leave behavior.
- Removed the legacy server's source, compiled output, workspace build, and install-time dependency graph.
- Excluded compiled `dist` tests from Vitest discovery so each TypeScript regression runs exactly once.
- Upgraded Vitest to 4.1 only because the current Cloudflare Workers test integration requires it.
- Unified the rules package on Vitest 4 and added a build-only TypeScript config, keeping tests type-checked while
  removing compiled tests and source maps from `packages/game/dist`.

## Verification

- Strict TypeScript checks pass for game, web, Worker, and Worker integration tests.
- 64 Vitest tests pass across seven files: 49 source-level tests and 15 workerd-backed integration tests.
- Seeded simulations across all three modes verify deterministic replay, version progression, move budgets,
  piece overlap/count invariants, and score consistency.
- The isolated Worker smoke test passes 11 private-room, color, timer, command convergence, reconnect,
  matchmaking, and deck-redaction checks.
- Vite production build and Wrangler deployment dry-run pass. The complete post-cleanup build takes 17.28 seconds
  on the audit machine; the Worker remains 15.05 KiB gzip.
- The production dependency audit reports no known vulnerabilities.
- A five-process benchmark recheck measured medians of 3.10 ms (quick), 14.31 ms (strategic), and 8.52 ms
  (classic). The variation is expected on the Windows audit host; all five runs remained far below the original
  baseline.

## Remaining work

- Capture Core Web Vitals and long-task traces in Chrome against a deployed build. Chrome DevTools automation was
  unavailable in this audit environment, so no synthetic browser timings are claimed here.
- Add browser-level coverage for responsive layouts, reconnect UI, animation continuity, keyboard interaction,
  and audio controls. Current coverage is strongest in deterministic rules and protocol smoke tests.
- Consider major Vite, Lucide, and TypeScript upgrades separately. They were not mixed into this performance pass
  because each requires its own compatibility validation.
