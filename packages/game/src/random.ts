export function nextRandom(seed: number): [number, number] {
  let value = (seed + 0x6d2b79f5) | 0;
  let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
  return [((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, value >>> 0];
}

export function shuffle<T>(items: T[], seed: number): [T[], number] {
  const copy = [...items];
  let cursor = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const [value, next] = nextRandom(cursor);
    cursor = next;
    const swap = Math.floor(value * (index + 1));
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
  }
  return [copy, cursor];
}

