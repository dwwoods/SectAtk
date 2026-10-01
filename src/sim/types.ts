// Shared primitive types for the sim. Kept dependency-free so config.ts can
// import stance types without circularity.

export type StanceName = 'prone' | 'crouch' | 'stand';

export interface Vec2 {
  x: number;
  z: number;
}

/** A smoke cloud (design doc §2.5): a drifting LOS-blocking volume,
    thrown toward the believed threat and advected by the wind each tick.
    Plain serializable data, like everything else the determinism gate
    has to see. */
export interface SmokeCloud {
  id: string;
  pos: Vec2;
  /** Metres — the footprint LOS is tested against. */
  radius: number;
  /** Seconds left before the cloud thins out and stops blocking LOS. */
  remaining: number;
}
