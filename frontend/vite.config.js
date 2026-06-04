import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
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
