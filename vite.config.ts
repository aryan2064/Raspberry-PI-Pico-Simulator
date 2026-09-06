import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: {
    // Our only worker is created as a module worker. The Pyodide loader
    // contains guarded dynamic imports, which force Rollup code-splitting —
    // that's illegal in the default 'iife' worker format, so emit ESM.
    format: "es",
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});