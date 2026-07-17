import Redis from "ioredis";
import type { GameState } from "@haywire/game";

export interface GameStore {
  save(state: GameState): Promise<void>;
  load(id: string): Promise<GameState | undefined>;
}

class MemoryStore implements GameStore {
  private readonly games = new Map<string, GameState>();
  async save(state: GameState) { this.games.set(state.id, structuredClone(state)); }
  async load(id: string) { return this.games.get(id); }
}

class RedisStore implements GameStore {
  constructor(private readonly redis: Redis) {}
  async save(state: GameState) {
    await this.redis.set(`haywire:game:${state.id}`, JSON.stringify(state), "EX", 86_400);
  }
  async load(id: string) {
    const value = await this.redis.get(`haywire:game:${id}`);
    return value ? JSON.parse(value) as GameState : undefined;
  }
}

export function createStore(): GameStore {
  const url = process.env.REDIS_URL;
  return url ? new RedisStore(new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false })) : new MemoryStore();
}

