import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  OTP_PEPPER: z.string().min(32).optional(),
  ADMIN_USERNAME: z.string().min(3).optional(),
  ADMIN_PASSWORD: z.string().min(10).optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  CHECK_USERNAME: z.string().min(3).optional(),
  CHECK_PASSWORD: z.string().min(10).optional(),
  CHECK_PASSWORD_HASH: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().email().optional(),
  MAIL_FROM_NAME: z.string().default("Qiskit Fall Fest"),
  PUBLIC_URL: z.string().url().optional(),
  EVENT_TZ: z.string().default("Asia/Kolkata"),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const e = parsed.data;
export const isProd = e.NODE_ENV === "production";

// Fail fast in production: never boot with missing security-critical config.
if (isProd) {
  const missing = ["DATABASE_URL", "JWT_SECRET", "SESSION_SECRET", "OTP_PEPPER", "ADMIN_USERNAME", "CHECK_USERNAME", "SENDGRID_API_KEY", "MAIL_FROM"].filter(
    (k) => !(e as Record<string, unknown>)[k],
  );
  if (!e.ADMIN_PASSWORD && !e.ADMIN_PASSWORD_HASH) missing.push("ADMIN_PASSWORD_HASH");
  if (!e.CHECK_PASSWORD && !e.CHECK_PASSWORD_HASH) missing.push("CHECK_PASSWORD_HASH");
  if (e.ADMIN_USERNAME && e.ADMIN_USERNAME === e.CHECK_USERNAME) missing.push("CHECK_USERNAME (must differ from ADMIN_USERNAME)");
  if (missing.length) {
    console.error("Missing required production env vars:", missing.join(", "));
    process.exit(1);
  }
}

// Dev-only throwaway secrets so `npm run dev` works with zero setup.
const dev = (s: string) => `dev-only-${s}-`.padEnd(40, "x");
export const config = {
  env: e.NODE_ENV,
  port: e.PORT,
  databaseUrl: e.DATABASE_URL,
  jwtSecret: e.JWT_SECRET ?? dev("jwt"),
  sessionSecret: e.SESSION_SECRET ?? dev("session"),
  otpPepper: e.OTP_PEPPER ?? dev("otp"),
  adminUser: e.ADMIN_USERNAME ?? "admin",
  adminPassword: e.ADMIN_PASSWORD ?? (isProd ? undefined : "admin-dev-password"),
  adminPasswordHash: e.ADMIN_PASSWORD_HASH,
  checkUser: e.CHECK_USERNAME ?? "check",
  checkPassword: e.CHECK_PASSWORD ?? (isProd ? undefined : "check-dev-password"),
  checkPasswordHash: e.CHECK_PASSWORD_HASH,
  sendgridKey: e.SENDGRID_API_KEY,
  mailFrom: e.MAIL_FROM ?? "no-reply@example.org",
  mailFromName: e.MAIL_FROM_NAME,
  publicUrl: e.PUBLIC_URL,
  tz: e.EVENT_TZ,
};
