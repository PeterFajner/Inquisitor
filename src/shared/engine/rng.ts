// A small seeded PRNG (SplitMix32) and unbiased die rolls. For tests and the
// balance simulation only: characters store dice faces, never seeds.

/** SplitMix32: returns a function giving uniform uint32s. */
export function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** A uniform integer in 1..sides from a uint32 source, by rejection sampling. */
export function rollDie(next: () => number, sides: number): number {
  if (!Number.isInteger(sides) || sides < 1) throw new Error(`rollDie: bad sides ${sides}`);
  const limit = 0x100000000 - (0x100000000 % sides);
  for (;;) {
    const r = next();
    if (r < limit) return (r % sides) + 1;
  }
}

/** A die roller `(sides) => 1..sides` from a seed. */
export function seededRoller(seed: number): (sides: number) => number {
  const next = splitmix32(seed);
  return (sides) => rollDie(next, sides);
}

/** A die roller from the platform's crypto RNG (browser and Node). */
export function cryptoRoller(): (sides: number) => number {
  const buf = new Uint32Array(1);
  const next = () => (globalThis.crypto.getRandomValues(buf), buf[0]);
  return (sides) => rollDie(next, sides);
}
