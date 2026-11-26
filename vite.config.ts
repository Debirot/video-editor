/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Tauri espera porta fixa e não deve limpar a tela (mensagens do Rust aparecem no mesmo terminal).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  worker: { format: "es" },
  build: {
    target: "es2023",
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
