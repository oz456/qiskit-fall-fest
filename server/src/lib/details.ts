// The one-time academic details asked from SRM-AP people on first sign-in. The lists live here so every app shows the same choices.
import { z } from "zod";

export const SCHOOLS = ["SEAS", "ESLA", "PSB", "Other"];
export const GENDERS = ["Male", "Female"];
export const PROGRAMS = ["B.Tech", "M.Tech", "BCA", "MCA", "B.Sc", "M.Sc", "BBA", "MBA", "B.A.", "M.A.", "B.Com", "Ph.D.", "Other"];

export const Details = z.object({
  regNo: z.string().trim().toUpperCase().regex(/^AP\d{8,13}$/, "Enter your registration number, like AP25110010123."),
  school: z.enum(SCHOOLS as [string, ...string[]], { message: "Choose your school." }),
  semester: z.number({ message: "Choose your semester." }).int().min(1, "Choose your semester.").max(8, "Choose your semester."),
  course: z.string({ message: "Enter your course, like CSE." }).trim().min(2, "Enter your course, like CSE.").max(60, "That course name is too long."),
  program: z.enum(PROGRAMS as [string, ...string[]], { message: "Choose your program." }),
  // optional here so an app built before these two existed can still save; people who skipped them are asked again (see Extra)
  section: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9 \-]{0,11}$/, "Enter your section, like A or S12.").optional(),
  gender: z.enum(GENDERS as [string, ...string[]], { message: "Choose Male or Female." }).optional(),
  // first-semester students have no CGPA yet: "NA" (or null) is stored as empty
  cgpa: z.preprocess((v) => (typeof v === "string" ? (/^\s*(n\/?a|nil|none|-)?\s*$/i.test(v) ? null : Number(v.trim().replace(",", "."))) : v),
    z.number({ message: "Enter your CGPA as a number from 0 to 10, or NA if you are in the first semester." }).min(0, "Enter your CGPA as a number from 0 to 10.").max(10, "Enter your CGPA as a number from 0 to 10.")
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "CGPA can have at most 2 decimals.").nullable()),
});

/** Asked later of people who saved their details before section and gender existed. */
export const Extra = z.object({
  section: Details.shape.section.unwrap(),
  gender: z.enum(GENDERS as [string, ...string[]], { message: "Choose Male or Female." }),
});
export const needsExtra = (u: Record<string, any>) => !!u.details_at && (!u.section || !u.gender);

/** NA is only for people in their first semester; everyone else has a CGPA to give. */
export const cgpaMissing = (d: { semester: number; cgpa: number | null }) => d.cgpa === null && d.semester > 1 ? "Enter your CGPA as a number from 0 to 10. NA is only for the first semester." : null;

export const detailsOut = (u: Record<string, any>) => u.details_at ? { regNo: u.reg_no, school: u.school, semester: u.semester, course: u.course, program: u.program, section: u.section ?? null, gender: u.gender ?? null, cgpa: u.cgpa === null ? null : Number(u.cgpa) } : null;

// OD (on-duty) details: the student fills these in their own app after being checked in at an event that collects them.
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 10:30.");
export const OdInput = z.object({
  eventId: z.string().uuid(),
  from: Clock, until: Clock,
  hours: z.number({ message: "Enter the number of hours." }).gt(0, "Hours must be more than 0.").max(24, "Hours cannot be more than 24.").refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Hours can have at most 2 decimals."),
}).refine((v) => v.until > v.from, { message: "OD until time must be after OD from time.", path: ["until"] });

/** Who is asked for the academic details (and OD): an SRM address, someone an organiser asked, or a personal address that says SRM-AP and did not answer "outside".
 *  `needsCheck`: that last kind has not answered "SRM-AP student or outside?" yet, and has no details saved: ask that first. */
export function srmStatus(u: Record<string, any>) {   // needs: email, says_srm, ask_details, srm_answer, details_at
  const srmAddress = String(u.email).trim().toLowerCase().endsWith("@srmap.edu.in");
  const asked = srmAddress || u.ask_details || (u.says_srm && u.srm_answer !== "outside");
  const needsCheck = !srmAddress && !u.ask_details && u.says_srm && u.srm_answer === null && !u.details_at;
  return { asked, needsCheck };
}
