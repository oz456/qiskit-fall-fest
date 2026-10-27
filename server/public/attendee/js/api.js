// API client. The access token lives in memory only; the refresh token lives in an HttpOnly cookie the page can never read.
// The pass secret never reaches the browser: QR codes come from /v1/pass/codes.
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const hooks = { onSignedOut() {}, onPhotoRequired() {}, onBlocked() {} };

let access = null;
let refreshing = null;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
export function deviceId() {
  try { let d = localStorage.getItem("qff.device"); if (!d) { d = uuid(); localStorage.setItem("qff.device", d); } return d; } catch { return "web-" + uuid(); }
}

async function send(method, path, body, auth) {
  const headers = { "x-qff-client": "web", accept: "application/json" };
  let payload;
  if (body instanceof Blob) { headers["content-type"] = body.type; payload = body; }
  else if (body != null || method === "POST" || method === "PUT" || method === "PATCH") { headers["content-type"] = "application/json"; payload = JSON.stringify(body ?? {}); }
  if (auth && access) headers.authorization = `Bearer ${access}`;
  try { return await fetch(path, { method, headers, body: payload, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new ApiError(0, "network", "Can’t reach the server. Check your connection."); }
}
async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const err = new ApiError(res.status, data.error || "error", data.message || `Request failed (${res.status})`);
  err.field = data.field || "";
  if (err.code === "platform_not_supported") hooks.onBlocked();
  if (err.code === "photo_required") hooks.onPhotoRequired();
  throw err;
}

/** Exchanges the refresh cookie for a new access token. Returns false when there is no valid session (not an error). */
export async function restoreSession() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await send("POST", "/v1/auth/refresh", {}, false);
      if (res.status === 401) { access = null; return false; }
      const data = await parse(res); access = data.accessToken; return true;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function call(method, path, body, { auth = true, retried = false } = {}) {
  if (auth && !access && !(await restoreSession())) { hooks.onSignedOut(); throw new ApiError(401, "unauthorized", "Please sign in again."); }
  const res = await send(method, path, body, auth);
  if (res.status === 401 && auth && !retried) {
    if (await restoreSession()) return call(method, path, body, { auth, retried: true });
    hooks.onSignedOut(); throw new ApiError(401, "unauthorized", "You were signed out. Sign in again to continue.");
  }
  return parse(res);
}

export const api = {
  requestCode: (email) => call("POST", "/v1/auth/request-code", { email: email.trim().toLowerCase() }, { auth: false }),
  async verify(email, code) {
    const r = await call("POST", "/v1/auth/verify", { email: email.trim().toLowerCase(), code, deviceId: deviceId(), deviceName: /android/i.test(navigator.userAgent) ? "Web (Android)" : "Web (iPhone)" }, { auth: false });
    access = r.accessToken; return r;
  },
  async logout() { access = null; try { await send("POST", "/v1/auth/web-logout", {}, false); } catch { /* the cookie is cleared server-side when reachable */ } },
  me: () => call("GET", "/v1/me"),
  events: () => call("GET", "/v1/events"),
  announcements: () => call("GET", "/v1/announcements"),
  tickets: () => call("GET", "/v1/tickets"),
  createTicket: (kind, topic, message) => call("POST", "/v1/tickets", { kind, topic, message }),
  replyTicket: (id, body) => call("POST", `/v1/tickets/${id}/messages`, { body }),
  setSaved: (id, on) => call(on ? "PUT" : "DELETE", `/v1/events/${id}/saved`, on ? {} : undefined),
  uploadPhoto: (blob) => call("PUT", "/v1/me/photo", blob),
  saveDetails: (d) => call("PUT", "/v1/me/details", d),
  passCodes: () => call("GET", "/v1/pass/codes"),
  putPush: (sub) => call("PUT", "/v1/me/push-token", sub),
  delPush: (token) => call("DELETE", `/v1/me/push-token?token=${encodeURIComponent(token)}`),
};
