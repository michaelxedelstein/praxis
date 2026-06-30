/**
 * Praxis headless brain — entry point. Same `core` brain that runs in-process
 * inside Electron, here exposed as a standalone authenticated service so the
 * phone (or a desktop pointed at a relay) can reach it.
 */
import { loadEnv } from "./env.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const server = await createServer(env);
  await server.listen();

  const shutdown = async (signal: string) => {
    server.app.log.info(`Received ${signal}, shutting down…`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal: failed to start Praxis brain");
  console.error(err);
  process.exit(1);
});
