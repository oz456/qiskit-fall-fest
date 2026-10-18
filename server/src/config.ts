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
  // JSON array: [{"user":"a@gmail.com","pass":"16-char app password"}, ...] — several accounts = round-robin
  SMTP_ACCOUNTS: z.string().optional(),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_DAILY_LIMIT: z.coerce.number().default(1900), // per account; use 450 for a free @gmail.com, ~1900 for Workspace
  MAIL_FROM_NAME: z.string().default("Qiskit Fall Fest"),
  PUBLIC_URL: z.string().url().optional(),
  EVENT_TZ: z.string().default("Asia/Kolkata"),
  PHOTO_BUCKET: z.string().optional(), // private GCS bucket for attendee selfies (prod); dev/tests use PHOTO_DIR
  PHOTO_DIR: z.string().default(".photos"),
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
  const missing = ["DATABASE_URL", "JWT_SECRET", "SESSION_SECRET", "OTP_PEPPER", "ADMIN_USERNAME", "CHECK_USERNAME", "SMTP_ACCOUNTS"].filter(
    (k) => !(e as Record<string, unknown>)[k],
  );
  if (!e.ADMIN_PASSWORD_HASH) missing.push("ADMIN_PASSWORD_HASH (plain ADMIN_PASSWORD is dev-only)");
  if (!e.CHECK_PASSWORD_HASH) missing.push("CHECK_PASSWORD_HASH (plain CHECK_PASSWORD is dev-only)");
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
  photoBucket: e.PHOTO_BUCKET,
  photoDir: e.PHOTO_DIR,
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
  smtpAccounts: ((): { user: string; pass: string }[] => {
    if (!e.SMTP_ACCOUNTS) return [];
    try {
      const a = JSON.parse(e.SMTP_ACCOUNTS);
      if (!Array.isArray(a) || !a.every((x) => typeof x?.user === "string" && typeof x?.pass === "string")) throw new Error("shape");
      return a.map((x) => ({ user: x.user, pass: String(x.pass).replace(/\s+/g, "") }));
    } catch { console.error("SMTP_ACCOUNTS must be a JSON array of {user,pass}"); process.exit(1); }
  })(),
  smtpHost: e.SMTP_HOST, smtpPort: e.SMTP_PORT, smtpDailyLimit: e.SMTP_DAILY_LIMIT,
  mailFromName: e.MAIL_FROM_NAME,
  publicUrl: e.PUBLIC_URL,
  tz: e.EVENT_TZ,
};
