// Seeded PRNG for the sim. mulberry32: a single uint32 of state, no
// dependency. State lives on a plain object (not a closure) so it can be
// serialized alongside entity state for the determinism gate and, later,
// for AAR journal replay.

export interface RngState {
  state: number; // uint32
}

export function createRng(seed: number): RngState {
  return { state: seed >>> 0 };
}

// Advances the state and returns a float in [0, 1). Mutates `rng.state` —
// callers that need to serialize mid-sequence just read `rng.state` after.
export function nextFloat(rng: RngState): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
