import { buildApp } from "./app.ts";
import { config, isProd } from "./config.ts";
import { migrate, openDb } from "./db.ts";

// Only the web server needs the photo bucket (the backup job shares this config and must not).
if (isProd && !config.photoBucket) { console.error("Missing required production env var: PHOTO_BUCKET"); process.exit(1); }

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
