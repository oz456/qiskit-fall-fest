// Server-to-server endpoints for the main website. Authenticated with the shared secret only (no cookies, no browser use).
//   POST /integrations/website/attendees  { people: [...] }   the website tells us about new/changed registrations (instant)
//   POST /integrations/website/reconcile                        Cloud Scheduler: pull the website's full export (safety net, every 10 min)
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { sha256, safeEqual } from "../lib/crypto.ts";
import { reconcile, upsertPeople } from "../lib/website-sync.ts";

const Person = z.object({ email: z.string().max(200), name: z.string().max(200).optional().default(""), institution: z.string().max(300).nullish(), isActive: z.boolean().optional(), role: z.string().max(40).optional(), passTier: z.enum(["general", "flagship"]).nullish(), srmBasis: z.enum(["srm_email", "personal_says_srm", "outside"]).optional() });

export function integrationRoutes(app: FastifyInstance, db: Db) {
  const authorised = (header: string | undefined) => {
    const secret = config.website.secret; const m = /^Bearer (.{20,200})$/.exec(header ?? "");
    return Boolean(secret && m && safeEqual(sha256(m[1]!), sha256(secret)));   // hashes first: constant time whatever the lengths
  };
  app.register(async (api) => {
    api.addHook("preHandler", async (req, reply) => { if (!authorised(req.headers.authorization)) return reply.code(401).send({ error: "unauthorized", message: "Missing or wrong key." }); });
    api.post("/integrations/website/attendees", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req) => {
      const { people } = z.object({ people: z.array(Person).min(1).max(500) }).parse(req.body);
      const r = await upsertPeople(db, people);
      await db.query("INSERT INTO sync_runs (trigger,status,finished_at,seen,created,updated,skipped,error) VALUES ('push','ok',now(),$1,$2,$3,$4,$5)", [r.seen, r.created, r.updated, r.skipped, r.failed.length ? r.failed.slice(0, 3).join("; ").slice(0, 500) : null]);
      return { ok: true, created: r.created, updated: r.updated, skipped: r.skipped, failed: r.failed.length };
    });
    api.post("/integrations/website/reconcile", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async () => reconcile(db, "scheduler"));
  });
}
