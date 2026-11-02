import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The production app is served by server/index.js on PORT (default 3000).
// `npm run dev` runs Vite on 3100 and proxies /api to the Node server on 8787.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3100,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  }
})
