import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const port = Number(process.env.VITE_PORT ?? 3000)
const host = process.env.VITE_HOST ?? "localhost"
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:4000"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host,
    port,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
