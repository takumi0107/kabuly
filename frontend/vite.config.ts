import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api and /webhook requests to the Go server in dev
      "/api": "http://localhost:8080",
      "/webhook": "http://localhost:8080",
    },
  },
});
