import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8799" } },
});
