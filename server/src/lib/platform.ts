// Which devices may use the /attendee web app. The rule is a WHITELIST (iPhone/iPad only), so "Desktop site" mode, other browsers and spoofed
// Android strings all fail closed. The check runs here (every /attendee page, script and font is refused with the gate page, and web API
// calls are refused) and again inside the web app itself, which also compares navigator.platform against the user-agent.
import { config } from "../config.ts";

export type Platform = "ios" | "android" | "desktop";

/** `chPlatform` is the Sec-CH-UA-Platform header Chromium browsers send by default (e.g. "Android"); Safari on iOS does not send it. */
export function detectPlatform(ua: string | undefined, chPlatform?: string): Platform {
  const ch = (chPlatform ?? "").replace(/"/g, "").trim().toLowerCase();
  if (/android/i.test(ua ?? "") || ch === "android") return "android";
  // iPhone/iPad UA but a Chromium client hint naming another OS = a desktop browser pretending: not iOS.
  if (/\b(iPhone|iPod|iPad)\b/.test(ua ?? "") && (!ch || ch === "ios")) return "ios";
  return "desktop";
}

export const webAppAllowed = (p: Platform) => config.webAppPlatforms.includes(p);

const COPY: Record<Exclude<Platform, "ios">, { title: string; text: string; cta: string }> = {
  android: {
    title: "The web app isn’t available on Android",
    text: "Android has its own QFF 2026 app: install it from our downloads page. It has your pass, the schedule, support and instant notifications.",
    cta: "Get the Android app",
  },
  desktop: {
    title: "Open this on your iPhone",
    text: "The attendee web app is made for iPhone. On Android, install the QFF 2026 app from our downloads page. Organisers: the admin and check-in sites are on their own addresses.",
    cta: "Go to downloads",
  },
};

/** A full-page, non-dismissable popup. No scripts and no inline styles: it works under the strict CSP and cannot be closed. */
export function gatePage(p: Exclude<Platform, "ios">): string {
  const c = COPY[p];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#f2e7d7">
<title>QFF 2026</title>
<link rel="icon" href="/shared/favicon.png?v=2" type="image/png">
<link rel="icon" href="/shared/favicon.ico?v=2" sizes="any">
<link rel="preload" href="/shared/fonts/anton.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/notice.css">
</head>
<body class="gate">
<div class="backdrop"></div>
<main class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="t" aria-describedby="d">
  <img src="/shared/qiskit.svg" alt="" width="44" height="44">
  <h1 id="t">${c.title}</h1>
  <p id="d">${c.text}</p>
  <a class="btn" href="/?from=user&amp;platform=${p}">${c.cta}</a>
</main>
</body>
</html>
`;
}

/** Branded page for a browser that asks for an address that doesn't exist. */
export function notFoundPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#f2e7d7">
<title>Page not found · QFF 2026</title>
<link rel="icon" href="/shared/favicon.png?v=2" type="image/png">
<link rel="icon" href="/shared/favicon.ico?v=2" sizes="any">
<link rel="preload" href="/shared/fonts/anton.ttf" as="font" type="font/ttf" crossorigin>
<link rel="stylesheet" href="/notice.css">
</head>
<body class="gate">
<div class="backdrop"></div>
<main class="dialog">
  <img src="/shared/qiskit.svg" alt="" width="44" height="44">
  <h1>Page not found</h1>
  <p>That address doesn’t exist. Head back to the Qiskit Fall Fest 2026 home page to download the app.</p>
  <a class="btn" href="/">Go to home</a>
</main>
</body>
</html>`;
}
