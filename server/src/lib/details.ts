// The one-time academic details asked from SRM-AP people on first sign-in. The lists live here so every app shows the same choices.
import { z } from "zod";

export const SCHOOLS = ["SEAS", "ESLA", "PSB", "Other"];
export const PROGRAMS = ["B.Tech", "M.Tech", "BCA", "MCA", "B.Sc", "M.Sc", "BBA", "MBA", "B.A.", "M.A.", "B.Com", "Ph.D.", "Other"];

export const Details = z.object({
  regNo: z.string().trim().toUpperCase().regex(/^AP\d{8,13}$/, "Enter your registration number, like AP25110010123."),
  school: z.enum(SCHOOLS as [string, ...string[]], { message: "Choose your school." }),
  semester: z.number({ message: "Choose your semester." }).int().min(1, "Choose your semester.").max(8, "Choose your semester."),
  course: z.string({ message: "Enter your course, like CSE." }).trim().min(2, "Enter your course, like CSE.").max(60, "That course name is too long."),
  program: z.enum(PROGRAMS as [string, ...string[]], { message: "Choose your program." }),
  // first-semester students have no CGPA yet: "NA" (or null) is stored as empty
  cgpa: z.preprocess((v) => (typeof v === "string" ? (/^\s*(n\/?a|nil|none|-)?\s*$/i.test(v) ? null : Number(v.trim().replace(",", "."))) : v),
    z.number({ message: "Enter your CGPA as a number from 0 to 10, or NA if you are in the first semester." }).min(0, "Enter your CGPA as a number from 0 to 10.").max(10, "Enter your CGPA as a number from 0 to 10.")
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "CGPA can have at most 2 decimals.").nullable()),
});

/** NA is only for people in their first semester; everyone else has a CGPA to give. */
export const cgpaMissing = (d: { semester: number; cgpa: number | null }) => d.cgpa === null && d.semester > 1 ? "Enter your CGPA as a number from 0 to 10. NA is only for the first semester." : null;

export const detailsOut = (u: Record<string, any>) => u.details_at ? { regNo: u.reg_no, school: u.school, semester: u.semester, course: u.course, program: u.program, cgpa: u.cgpa === null ? null : Number(u.cgpa) } : null;
