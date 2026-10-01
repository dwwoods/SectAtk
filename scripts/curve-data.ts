// Generate the suppression→ROF curve as CSV for the Phase 9 tuning pass.
// The curve shape (logistic, centred at SUPPRESSION_HALF_LEVEL) determines
// how sharply the firefight turns — this is the design doc §9.3 risk
// "ammunition balance — the dominant risk."
//
// Usage: npx tsx scripts/curve-data.ts > artifacts/suppression-curve.csv

import { suppressionCurveSamples } from '../src/sim/suppression';
import { SUPPRESSION_HALF_LEVEL, SUPPRESSION_MAX_LEVEL } from '../src/sim/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(dir, '..', 'artifacts');
mkdirSync(outDir, { recursive: true });

const samples = suppressionCurveSamples(100);

let csv = 'suppression,rof_mult\n';
for (const s of samples) {
  csv += `${s.suppression.toFixed(3)},${s.rofMult.toFixed(6)}\n`;
}
csv += `\n# half-level: ${SUPPRESSION_HALF_LEVEL}\n`;
csv += `# pinned threshold: ${SUPPRESSION_MAX_LEVEL}\n`;

const outFile = resolve(outDir, 'suppression-curve.csv');
writeFileSync(outFile, csv);
console.log(`wrote ${outFile} (${samples.length} samples)`);