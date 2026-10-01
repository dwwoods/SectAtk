// Wound model tests — the gating table from design doc §3.2. Each row's
// behaviour (can shout, can sound off, can fight, can move) is asserted for
// every (severity, location) combination that matters, plus the silent
// casualty mechanic (throat/cns → no evidence).

import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';
import {
  canShout,
  canSoundOff,
  canFightFromWound,
  canMoveFromWound,
  createWound,
  rollWoundLocation,
  rollWoundSeverity,
  type Wound,
  type WoundLocation,
  type WoundSeverity,
} from '../../src/sim/wounds';

const rng = createRng(0xdead);

function makeWound(severity: WoundSeverity, location: WoundLocation): Wound {
  return createWound(severity, location, 100, rng);
}

describe('wound model — gating table (§3.2)', () => {
  // ── can shout ──────────────────────────────────────────────────────────
  it('fatal-cns: cannot shout regardless of location', () => {
    expect(canShout(makeWound('fatal-cns', 'chest'), rng)).toBe(false);
    expect(canShout(makeWound('fatal-cns', 'throat'), rng)).toBe(false);
    expect(canShout(makeWound('fatal-cns', 'thigh'), rng)).toBe(false);
  });

  it('throat location: cannot shout regardless of severity', () => {
    for (const sev of ['fatal-cns', 'mortal', 'serious', 'minor'] as const) {
      expect(canShout(makeWound(sev, 'throat'), rng)).toBe(false);
    }
  });

  it('mortal wound (non-throat): can shout', () => {
    expect(canShout(makeWound('mortal', 'chest'), rng)).toBe(true);
    expect(canShout(makeWound('mortal', 'abdomen'), rng)).toBe(true);
  });

  it('serious wound (non-throat): can shout', () => {
    expect(canShout(makeWound('serious', 'thigh'), rng)).toBe(true);
    expect(canShout(makeWound('serious', 'leg'), rng)).toBe(true);
  });

  it('minor wound (non-throat): may shout (probabilistic)', () => {
    // Try 100 times; at 60% chance, we should see at least one true.
    let shouted = false;
    for (let i = 0; i < 100; i++) {
      if (canShout(makeWound('minor', 'arm'), rng)) { shouted = true; break; }
    }
    expect(shouted).toBe(true);
  });

  // ── can sound off ──────────────────────────────────────────────────────
  it('fatal-cns: cannot sound off', () => {
    expect(canSoundOff(makeWound('fatal-cns', 'head'))).toBe(false);
  });

  it('mortal: can sound off (briefly)', () => {
    expect(canSoundOff(makeWound('mortal', 'chest'))).toBe(true);
  });

  it('serious: can sound off (screams "hit")', () => {
    expect(canSoundOff(makeWound('serious', 'leg'))).toBe(true);
  });

  it('minor: can sound off', () => {
    expect(canSoundOff(makeWound('minor', 'arm'))).toBe(true);
  });

  // ── can fight ──────────────────────────────────────────────────────────
  it('fatal-cns, mortal, serious: cannot fight', () => {
    expect(canFightFromWound(makeWound('fatal-cns', 'head'))).toBe(false);
    expect(canFightFromWound(makeWound('mortal', 'chest'))).toBe(false);
    expect(canFightFromWound(makeWound('serious', 'abdomen'))).toBe(false);
  });

  it('minor: can fight (degraded)', () => {
    expect(canFightFromWound(makeWound('minor', 'arm'))).toBe(true);
  });

  // ── can move ───────────────────────────────────────────────────────────
  it('fatal-cns, mortal, serious: cannot move', () => {
    expect(canMoveFromWound(makeWound('fatal-cns', 'head'))).toBe(false);
    expect(canMoveFromWound(makeWound('mortal', 'chest'))).toBe(false);
    expect(canMoveFromWound(makeWound('serious', 'leg'))).toBe(false);
  });

  it('minor: can move (degraded)', () => {
    expect(canMoveFromWound(makeWound('minor', 'leg'))).toBe(true);
  });

  // ── silent casualty mechanic ───────────────────────────────────────────
  it('fatal-cns + throat: produces no cry (cryUntil is null)', () => {
    const w = makeWound('fatal-cns', 'throat');
    expect(w.cryUntil).toBeNull();
  });

  it('fatal-cns + any location: no cry', () => {
    const w = makeWound('fatal-cns', 'head');
    expect(w.cryUntil).toBeNull();
  });

  it('mortal + throat: no cry (throat still silences)', () => {
    const w = makeWound('mortal', 'throat');
    expect(w.cryUntil).toBeNull();
  });

  it('mortal + non-throat: cries briefly (cryUntil set)', () => {
    const w = makeWound('mortal', 'chest');
    expect(w.cryUntil).not.toBeNull();
    expect(w.cryUntil!).toBeGreaterThan(100);
  });

  it('serious + non-throat: screams (cryUntil = Infinity)', () => {
    const w = makeWound('serious', 'thigh');
    expect(w.cryUntil).toBe(Infinity);
  });

  it('minor wound: may or may not cry (cryUntil set or null)', () => {
    let hasCry = false;
    let noCry = false;
    for (let i = 0; i < 100; i++) {
      const w = makeWound('minor', 'arm');
      if (w.cryUntil !== null) hasCry = true;
      else noCry = true;
    }
    expect(hasCry).toBe(true);
    expect(noCry).toBe(true);
  });

  // ── roll distribution sanity ───────────────────────────────────────────
  it('rollWoundLocation: produces all seven locations over many rolls', () => {
    const seen = new Set<WoundLocation>();
    for (let i = 0; i < 200; i++) seen.add(rollWoundLocation(rng));
    expect(seen.size).toBe(7);
  });

  it('rollWoundSeverity: produces all four severities over many rolls', () => {
    const seen = new Set<WoundSeverity>();
    for (let i = 0; i < 100; i++) seen.add(rollWoundSeverity(rng));
    expect(seen.size).toBe(4);
  });
});