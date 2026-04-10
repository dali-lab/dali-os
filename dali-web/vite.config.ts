import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // Pre-bundle so the first visit doesn’t trigger "optimized dependencies changed"
  // and a mid-reload race that fails to fetch entry.client.tsx.
  optimizeDeps: {
    include: ["framer-motion"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
    },
    // Framer Motion must use the same React instance as the app; without this,
    // Vite can pre-bundle a second copy and hooks (e.g. useContext in motion.*) break.
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  server: {
    host: "0.0.0.0",
  },
});
