import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// PWA shell for the offline-first app (§6). The service worker precaches the app itself;
// API calls and pack downloads must always go to the network (§6.6).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "generateSW",
      manifest: {
        name: "DiscVault",
        short_name: "DiscVault",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        icons: [],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
