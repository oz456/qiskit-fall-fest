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
  CHECK_ACCOUNTS: z.string().optional(), // JSON [{"user":"AP…","hash":"scrypt$…"}]: named door logins; when set, CHECK_USERNAME/CHECK_PASSWORD_HASH are not needed
  // JSON array: [{"user":"a@gmail.com","pass":"16-char app password"}, ...] — several accounts = round-robin
  SMTP_ACCOUNTS: z.string().optional(),
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_DAILY_LIMIT: z.coerce.number().default(1900), // per account; use 450 for a free @gmail.com, ~1900 for Workspace
  MAIL_FROM_NAME: z.string().default("Qiskit Fall Fest"),
  PUBLIC_URL: z.string().url().optional(),
  EVENT_TZ: z.string().default("Asia/Kolkata"),
  VAPID_PUBLIC_KEY: z.string().optional(),   // web push for the home-screen web app (generate once with `npm run vapid`)
  VAPID_PRIVATE_KEY: z.string().optional(),
  FCM_PROJECT: z.string().optional(),      // Firebase project for Android pushes (default: the Cloud Run project)
  FCM_TEST_TOKEN: z.string().optional(),   // dev only: a gcloud access token so a local server can send real pushes
  APNS_KEY_P8: z.string().optional(),      // Apple push key (.p8 text); iPhone pushes stay off until this + the two below are set
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_TOPIC: z.string().default("org.qiskit.fallfest.amaravati"),
  SYNC_SECRET: z.string().min(20).optional(),    // shared with the main website: it pushes registrations to /integrations/website/*, we pull its export with it
  WEBSITE_URL: z.string().url().default("https://www.qffsrmap2026.com"),
  WEB_APP_PLATFORMS: z.string().default("ios"), // who may open the /attendee web app: comma list of ios,android,desktop (production: ios only)
  PHOTO_BUCKET: z.string().optional(), // private GCS bucket for attendee selfies (prod); dev/tests use PHOTO_DIR
  PHOTO_DIR: z.string().default(".photos"),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const e = parsed.data;
function parseAccounts(raw?: string): { user: string; hash: string }[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((x) => typeof x?.user === "string" && x.user.length >= 3 && typeof x?.hash === "string" && x.hash.startsWith("scrypt$")) : []; } catch { return []; }
}
export const isProd = e.NODE_ENV === "production";

// Fail fast in production: never boot with missing security-critical config.
if (isProd) {
  const missing = ["DATABASE_URL", "JWT_SECRET", "SESSION_SECRET", "OTP_PEPPER", "ADMIN_USERNAME", "SMTP_ACCOUNTS"].filter(
    (k) => !(e as Record<string, unknown>)[k],
  );
  if (!e.ADMIN_PASSWORD_HASH) missing.push("ADMIN_PASSWORD_HASH (plain ADMIN_PASSWORD is dev-only)");
  if (!e.CHECK_ACCOUNTS) {
    if (!e.CHECK_USERNAME) missing.push("CHECK_USERNAME (or CHECK_ACCOUNTS)");
    if (!e.CHECK_PASSWORD_HASH) missing.push("CHECK_PASSWORD_HASH (plain CHECK_PASSWORD is dev-only; or set CHECK_ACCOUNTS)");
  }
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
  vapid: e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY ? { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.PUBLIC_URL ?? "https://app.qffsrmap2026.com" } : undefined,
  website: { baseUrl: e.WEBSITE_URL.replace(/\/+$/, ""), secret: e.SYNC_SECRET },
  webAppPlatforms: e.WEB_APP_PLATFORMS.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  fcmProject: e.FCM_PROJECT, fcmTestToken: isProd ? undefined : e.FCM_TEST_TOKEN,
  apns: e.APNS_KEY_P8 && e.APNS_KEY_ID && e.APNS_TEAM_ID ? { key: e.APNS_KEY_P8.replace(/\\n/g, "\n"), keyId: e.APNS_KEY_ID, teamId: e.APNS_TEAM_ID, topic: e.APNS_TOPIC } : undefined,
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
  checkAccounts: parseAccounts(e.CHECK_ACCOUNTS),
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
