// Fire control — the 2IC's job (design doc §4). The commander sets INTENT
// ('watch-and-shoot' / 'hold' / 'win-the-firefight' / 'rapid'); the 2IC
// translates it into per-man rates and rotates men out to re-bomb on his
// own judgement. Intent-level control keeps the burn lever in the
// commander's hands without the admin (§4.1).
//
// If the 2IC cannot fight, ALL of this silently stops (§4.2): rates are
// no longer adjusted, rotation is no longer managed, and the section's
// fire degrades on its own. Under wound-gating the commander may never
// have been told — he notices the fire has gone ragged, and infers it.
// NOTHING in here may emit an event, a journal entry, or any other
// notification of the lapse; that silence is the mechanic and it is
// assert-tested (tests/invariants/fire-control.test.ts).

import type { Soldier } from '../soldier';
import { isAlive, canFight } from '../soldier';
import { startRebomb } from '../ammunition';
import type { FireIntent } from '../config';
import {
  INTENT_ROF,
  FIRE_DISCIPLINE_LOW_MAGS,
  REBOMB_TRIGGER_MAGS,
  REBOMB_MAX_CONCURRENT,
  MAGS_PER_MAN,
} from '../config';

/** Is anyone managing fire? True while the 2IC is alive and able to
    fight. The answer is sim truth — it must never reach Knowledge. */
export function fireControlActive(friendlies: Soldier[]): boolean {
  const twoIC = friendlies.find((f) => f.role === 'twoIC');
  return !!twoIC && isAlive(twoIC) && canFight(twoIC);
}

/**
 * One tick of the 2IC's fire management. No-ops entirely (and silently)
 * when fire control has lapsed.
 */
export function processFireControl(friendlies: Soldier[], sectionIntent: FireIntent): void {
  if (!fireControlActive(friendlies)) return;

  // 1. Intent → per-man rates, with ammunition discipline: a man running
  //    low on magazines is throttled back to 'hold' regardless of the
  //    section intent — the 2IC's job is to keep the burn sustainable.
  for (const f of friendlies) {
    if (!isAlive(f)) continue;
    let intent = sectionIntent;
    if (
      f.ammo.spareMags <= FIRE_DISCIPLINE_LOW_MAGS &&
      INTENT_ROF[intent] > INTENT_ROF.hold
    ) {
      intent = 'hold';
    }
    f.fireIntent = intent;
  }

  // 2. Re-bombing rotation: men low on magazines with bandolier rounds
  //    left are rotated out to refill — most-depleted first, never more
  //    than REBOMB_MAX_CONCURRENT at once, so the section's fire dips
  //    rather than collapses. (A man forced to re-bomb by an empty mag
  //    still counts against the cap.)
  let rebombing = 0;
  for (const f of friendlies) {
    if (isAlive(f) && f.reBombing) rebombing++;
  }
  if (rebombing >= REBOMB_MAX_CONCURRENT) return;

  const candidates = friendlies
    .filter(
      (f) =>
        isAlive(f) &&
        canFight(f) &&
        !f.reBombing &&
        f.reloadT === 0 &&
        f.ammo.bandolier > 0 &&
        f.ammo.spareMags <= REBOMB_TRIGGER_MAGS &&
        f.ammo.spareMags < MAGS_PER_MAN - 1,
    )
    .sort((a, b) => a.ammo.spareMags - b.ammo.spareMags || (a.id < b.id ? -1 : 1));

  for (const f of candidates) {
    if (rebombing >= REBOMB_MAX_CONCURRENT) break;
    startRebomb(f);
    rebombing++;
  }
}
