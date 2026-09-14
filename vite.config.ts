import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Allow access through tunnels/reverse proxies (e.g. *.trycloudflare.com)
    // used by the browser-verification workflow.
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: true,
    // The public verification URL (xxx.trycloudflare.com) arrives with a
    // non-local Host header; without this Vite responds 403 to tunnel traffic.
    allowedHosts: true,
  },
  build: { target: 'es2020', outDir: 'dist' }
});
