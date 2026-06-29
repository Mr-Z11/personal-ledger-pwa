import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "script-defer",
      includeAssets: ["icon.svg", "mask-icon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "pwa/*.png"],
      manifest: {
        name: "Ledger Box",
        short_name: "记账",
        description: "个人云端优先记账 PWA",
        lang: "zh-CN",
        theme_color: "#f6f1e7",
        background_color: "#f6f1e7",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        navigateFallback: "/index.html",
        globIgnores: ["**/xlsx-*.js", "**/papaparse*.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkFirst",
            options: {
              cacheName: "ledger-api",
              networkTimeoutSeconds: 5
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "storage-vendor": ["dexie"]
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  },
  preview: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
