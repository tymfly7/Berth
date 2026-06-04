import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // bind 0.0.0.0 so the dev server is reachable via the LAN IP, not just localhost
    strictPort: true,  // keep the port at 5173 so config.js's dev-port detection holds
    warmup: {
      clientFiles: ['./src/main.jsx', './src/pages/AdminView.jsx', './src/pages/PublicView.jsx'],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    globals: true,
  },
})
