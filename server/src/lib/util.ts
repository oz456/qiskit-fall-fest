import { randomInt } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Queryable, Row } from "../db.ts";
import { config } from "../config.ts";

export const normEmail = (e: string) => e.trim().toLowerCase();

export async function audit(q: Queryable, req: FastifyRequest | null, action: string, entity?: string, entityId?: string, detail?: unknown) {
  await q.query("INSERT INTO audit_log (action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5)", [
    action, entity ?? null, entityId ?? null, detail === undefined ? null : JSON.stringify(detail), req?.ip ?? null,
  ]);
}

/** yyyy-mm-dd of an instant in the event timezone. */
export function eventDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const newTicketCode = () => `QFF-${randomInt(1000, 10000)}`;

export const eventOut = (r: Row, extra: Row = {}) => ({
  id: r.id, title: r.title, description: r.description, track: r.track, location: r.location, speaker: r.speaker,
  startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
  capacity: r.capacity, registrationRequired: r.registration_required, published: r.published,
  ...extra,
});
