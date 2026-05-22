import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
    // Ensure a single copy of yjs (and related collab libs) is loaded.
    // Duplicate yjs instances silently break sync because each instance
    // has its own internal Y.Doc class identity — updates from one can't
    // be applied to the other.
    dedupe: [
      "yjs",
      "y-prosemirror",
      "y-protocols",
      "@hocuspocus/provider",
      "@tiptap/core",
      "@tiptap/pm",
      "@tiptap/react",
    ],
  },
  optimizeDeps: {
    include: [
      "yjs",
      "y-prosemirror",
      "@hocuspocus/provider",
      "@dnd-kit/core",
      "@dnd-kit/utilities",
    ],
  },
  ssr: {
    noExternal: ["@dnd-kit/core", "@dnd-kit/utilities"],
    external: [
      "@prisma/client",
      "@prisma/adapter-pg",
      "@hocuspocus/server",
      "@hocuspocus/provider",
      "yjs",
      "y-prosemirror",
      "y-protocols",
    ],
  },
  server: {
    port: 3001,
    host: "0.0.0.0",
    cors: {
      origin: [
        "http://localhost:5173",
        process.env.FRONTEND_URL ?? "",
      ].filter(Boolean),
      credentials: true,
    },
  },
});
