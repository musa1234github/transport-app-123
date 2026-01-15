import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/", // ✅ CHANGED: Critical for Netlify hosting
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
          routing: ["react-router-dom"]
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    open: true // Auto-open browser on dev
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"]
  }
})