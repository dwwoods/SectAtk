// Shared primitive types for the sim. Kept dependency-free so config.ts can
// import stance types without circularity.

export type StanceName = 'prone' | 'crouch' | 'stand';

export interface Vec2 {
  x: number;
  z: number;
}
