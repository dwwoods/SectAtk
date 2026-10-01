import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'reference/**',
      'reference-camera-spike.html',
      '.dependency-cruiser.cjs',
      'scripts/**', // dev/automation scripts, not production code
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
