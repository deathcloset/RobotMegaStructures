import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  optimizeDeps: {
    // @rms/shared exports raw TS source; let Vite process it as source instead
    // of trying to pre-bundle it as a dependency.
    exclude: ['@rms/shared'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
