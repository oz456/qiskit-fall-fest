import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { migrate, openDb } from "./db.ts";

const db = await openDb();
await migrate(db);
const app = await buildApp(db);

const stop = async (sig: string) => {
  app.log.info({ sig }, "shutting down");
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

await app.listen({ port: config.port, host: "0.0.0.0" });
