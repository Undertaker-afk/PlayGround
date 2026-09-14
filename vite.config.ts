import { defineConfig } from 'vite';

export default defineConfig({
  // Allow public tunnel URLs (e.g. *.trycloudflare.com) used by browser verification.
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 3000, allowedHosts: true },
  build: { target: 'esnext' }
});
