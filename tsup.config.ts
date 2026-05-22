import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Library entry: ESM + CJS with type declarations.
    entry: { lib: "src/lib.ts" },
    format: ["esm", "cjs"],
    target: "node18",
    outDir: "dist",
    clean: true,
    dts: true,
    splitting: false,
    sourcemap: true,
  },
  {
    // Binary entry: ESM only, with a shebang.
    entry: { index: "src/index.ts" },
    format: ["esm"],
    target: "node18",
    outDir: "dist",
    clean: false,
    dts: false,
    splitting: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
