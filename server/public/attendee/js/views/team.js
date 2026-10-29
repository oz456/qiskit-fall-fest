// "Your team" sheet for hackathon participants: the lead on top, then teammates (view only).
// Team names are handed out from a list of Indian founders: at the naming time the lead taps "Get my team name" (the server picks), and teams still without a name get one automatically.
import { ApiError, api } from "../api.js";
import { button, h, openSheet, toast } from "../ui.js";

export async function loadTeam() {
  try { return await api.team(); } catch { return null; }   // null = couldn't load (offline); the card then just says it's included in the pass
}

const initials = (n) => String(n || "?").split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase() || "?";

export function openTeam(data, { onChanged } = {}) {
  openSheet((close) => {
    const body = h("div");
    let state = data, busy = false, err = "";
    const draw = () => {
      const t = state?.team, nm = state?.naming;
      if (!t) {
        body.replaceChildren(
          h("h2", { class: "h1" }, "Your team"),
          h("p", { class: "body muted" }, state ? "You haven’t formed or joined a team yet. Create your team, or accept an invitation, on the Qiskit Fall Fest website (Learning portal, Hackathon)." : "We couldn’t load your team right now. Check your connection and try again."));
        return;
      }
      const rows = t.members.map((m) => h("div", { class: "teamrow" },
        h("div", { class: "teamav" + (m.role === "leader" ? " lead" : "") }, initials(m.name)),
        h("div", { class: "meta" }, h("div", { class: "name" }, m.name + (m.you ? " (you)" : "")), h("div", { class: "where" }, m.role === "leader" ? "Team lead" : "Teammate"))));
      body.replaceChildren(
        h("h2", { class: "h1", style: { margin: 0 } }, t.name),
        h("p", { class: "body muted", style: { margin: "4px 0 0" } }, [t.founder ? `Inspired by ${t.founder}` : null, t.problemStatementId, `${t.members.length} ${t.members.length === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")),
        nm?.note ? h("p", { class: "body", style: { margin: "12px 0 0" } }, nm.note) : null,
        nm?.canAssign ? h("div", { style: { margin: "14px 0 4px" } }, button(busy ? "Getting your name…" : "Get my team name", { onclick: assign, disabled: busy })) : null,
        err ? h("div", { class: "err", role: "alert" }, err) : null,
        !t.founder && !nm?.note ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "Team names are inspired by India’s founders.") : null,
        h("div", { class: "teamlist" }, rows));
    };
    async function assign() {
      busy = true; err = ""; draw();
      try {
        const r = await api.assignTeamName();
        toast(`Your team is ${r.name}`);
      } catch (e) { err = e instanceof ApiError ? e.message : "Couldn’t get the name. Check your connection and try again."; }
      busy = false;
      const fresh = await loadTeam(); if (fresh) { state = fresh; onChanged?.(fresh); }
      draw();
    }
    // keep the sheet current while the naming time comes and the names go out
    const poll = setInterval(async () => {
      if (!body.isConnected) { clearInterval(poll); return; }
      if (busy || document.hidden) return;
      const fresh = await loadTeam(); if (fresh) { const changed = JSON.stringify(fresh) !== JSON.stringify(state); state = fresh; if (changed) { onChanged?.(fresh); draw(); } }
    }, 3000);
    draw();
    return [body];
  });
}
