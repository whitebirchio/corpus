import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Corpus",
        short_name: "Corpus",
        description: "Personal health dashboard",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        background_color: "#f9f9f7",
        theme_color: "#f9f9f7",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Auth redirects and API calls must never be answered by the SPA shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
        // The zxing decoder wasm (~1 MB) is Scan-tab-only: keep it out of the
        // install-time precache and cache it on first use instead. Its hashed
        // filename makes the cache-first entry effectively immutable.
        globIgnores: ["**/*.wasm"],
        maximumFileSizeToCacheInBytes: 700 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.wasm$/,
            handler: "CacheFirst",
            options: {
              cacheName: "corpus-wasm",
              expiration: { maxEntries: 2 },
            },
          },
          {
            // Offline-tolerant, not offline-capable (SPEC §4): a cold open
            // with no network shows the last-seen dashboard for a day.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith("/api/") && request.method === "GET",
            handler: "NetworkFirst",
            options: {
              cacheName: "corpus-api",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 64, maxAgeSeconds: 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    // HMR UI against the full worker stack: `npm run dev` (wrangler on :8788)
    // in one terminal, `npm run dev:ui` (this, on :5173) in another.
    proxy: {
      "/api": "http://localhost:8788",
      "/auth": "http://localhost:8788",
    },
  },
});
