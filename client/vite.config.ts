import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"), // '@' = 'src'
    },
  },
  server: {
    proxy: {
      // Forward API requests to your Node backend
      "/mcp": {
        target: "http://localhost:3000", //  match your server port
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // optional, if you have other endpoints like /api
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/agent": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
