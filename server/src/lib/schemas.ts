import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
export const Email = z.string().trim().toLowerCase().email().max(254);

export const EventInput = z.object({
  title: text(120).min(2),
  description: text(2000).default(""),
  track: z.enum(["Main", "Workshop", "Talk", "Hackathon", "Social", "Competition"]),
  location: text(120).default(""),
  speaker: text(120).default(""),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  published: z.boolean().default(true),
  collectOd: z.boolean().default(false),
}).refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: "End must be after start", path: ["endsAt"] });

export const UserInput = z.object({ email: Email, name: text(100).min(1), college: text(150).nullable().default(null) });
export const AnnouncementInput = z.object({ title: text(120).min(2), body: text(2000).min(2) });
export const FaqInput = z.object({ question: text(200).min(2), answer: text(2000).min(2), position: z.number().int().min(0).max(1000).default(0) });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
export const SettingsInput = z.object({ fest_name: text(100).min(1), venue: text(100), support_note: text(300), fest_start: Day, fest_end: Day, team_rename: z.enum(["on", "off"]) }).partial();
export const TicketCreate = z.object({
  kind: z.enum(["General", "Mentor help", "Grievance"]),
  topic: text(60).min(1),
  message: text(2000).min(5),
});
export const TicketReply = z.object({ body: text(2000).min(1) });
export const TicketStatus = z.object({ status: z.enum(["open", "in_progress", "resolved"]) });
