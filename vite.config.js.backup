import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    host: '0.0.0.0',   // 👈 allow access from other devices
    port: 5173,        // or any port you use
    strictPort: true
  }
})
