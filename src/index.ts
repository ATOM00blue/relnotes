import { run } from "./cli.js";

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`relnotes: ${message}\n`);
  process.exitCode = 1;
});
