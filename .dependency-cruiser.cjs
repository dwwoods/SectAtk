// Enforces the one non-negotiable rule dependency-cruiser CAN express (see
// design doc §10): /src/sim imports nothing from /render, /ui, or /audio.
// The reverse direction (render/ui/audio importing sim) is allowed and
// expected.
//
// Two other non-negotiable rules from §10 are NOT import-graph rules —
// markers.ts reads Knowledge only, and /audio never writes Knowledge —
// because both legitimately import Knowledge's types. Those need
// assert-based tests when those files land (Phases 5-6), not lint. See
// CLAUDE.md.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sim-must-not-import-render',
      severity: 'error',
      comment: '/src/sim is pure and headless — it must never import from /src/render.',
      from: { path: '^src/sim' },
      to: { path: '^src/render' },
    },
    {
      name: 'sim-must-not-import-ui',
      severity: 'error',
      comment: '/src/sim is pure and headless — it must never import from /src/ui.',
      from: { path: '^src/sim' },
      to: { path: '^src/ui' },
    },
    {
      name: 'sim-must-not-import-audio',
      severity: 'error',
      comment: '/src/sim is pure and headless — it must never import from /src/audio.',
      from: { path: '^src/sim' },
      to: { path: '^src/audio' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
