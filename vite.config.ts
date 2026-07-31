import { defineConfig } from 'vite';

export default defineConfig({
  // /reference/index.html is a static reference artifact, not an app
  // entry — without this, Vite's dependency scanner crawls it too and
  // warns about its importmap-loaded "three" (not an npm dependency here).
  optimizeDeps: {
    entries: ['index.html'],
  },
});
