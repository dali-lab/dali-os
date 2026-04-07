import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
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
