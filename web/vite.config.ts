import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served under https://hunterthemilkman.com/projects/contextfabric/
// If you deploy to a bare subdomain instead, change base to "/".
export default defineConfig({
  base: "/projects/contextfabric/",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
