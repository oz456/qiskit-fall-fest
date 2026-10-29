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
    let state = data, busy = false, err = "", renaming = false;
    const draw = () => {
      const t = state?.team, nm = state?.naming;
      if (!t) {
        body.replaceChildren(
          h("h2", { class: "h1" }, "Your team"),
          h("p", { class: "body muted" }, state ? "You haven’t formed or joined a team yet. Create your team, or accept an invitation, on the Qiskit Fall Fest website (Learning portal, Hackathon)." : "We couldn’t load your team right now. Check your connection and try again."));
        return;
      }
      if (renaming) return drawRename(t);
      const rows = t.members.map((m) => h("div", { class: "teamrow" },
        h("div", { class: "teamav" + (m.role === "leader" ? " lead" : "") }, initials(m.name)),
        h("div", { class: "meta" }, h("div", { class: "name" }, m.name + (m.you ? " (you)" : "")), h("div", { class: "where" }, m.role === "leader" ? "Team lead" : "Teammate"))));
      body.replaceChildren(
        h("div", { class: "teamhead" }, h("h2", { class: "h1" + (t.nameHidden ? " blurname" : ""), style: { margin: 0 }, "aria-label": t.nameHidden ? "Team name not given yet" : null }, t.name), nm?.canEdit ? button("Rename", { cls: "alt", onclick: () => { renaming = true; err = ""; draw(); } }) : null),
        h("p", { class: "body muted", style: { margin: "4px 0 0" } }, [t.problemStatementId, `${t.members.length} ${t.members.length === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")),
        nm?.note ? h("p", { class: "body", style: { margin: "12px 0 0" } }, nm.note) : null,
        nm?.canAssign ? h("div", { style: { margin: "14px 0 4px" } }, button(busy ? "Getting your name…" : "Get my team name", { onclick: assign, disabled: busy })) : null,
        nm?.canPractice ? h("div", { style: { margin: "8px 0 4px" } }, button("Practice the naming round", { cls: "alt", onclick: practice, disabled: busy }), h("p", { class: "small muted", style: { margin: "6px 0 0" } }, "Test teams only: starts the 100-second round right now.")) : null,
        err ? h("div", { class: "err", role: "alert" }, err) : null,
        !t.founder && !nm?.note ? h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "Team names are inspired by India’s founders.") : null,
        h("div", { class: "teamlist" }, rows));
    };
    function drawRename(t) {
      const input = h("input", { type: "text", name: "teamName", maxlength: "40", value: t.name, "aria-label": "Team name", autocomplete: "off" });
      const note = h("div", { class: "err", role: "alert" });
      const actions = h("div");
      const drawActions = () => actions.replaceChildren(h("div", { class: "twobtn" }, button("Cancel", { cls: "alt", onclick: () => { renaming = false; draw(); }, disabled: busy }), button(busy ? "Saving…" : "Save name", { onclick: save, disabled: busy })));
      async function save() {
        const name = input.value.replace(/\s+/g, " ").trim();
        if (name.length < 3 || name.length > 40) { note.textContent = "A team name must be 3 to 40 characters."; return; }
        if (name === t.name) { renaming = false; return draw(); }
        busy = true; note.textContent = ""; drawActions();
        try { await api.renameTeam(name); toast("Team name changed"); renaming = false; }
        catch (e) { note.textContent = e instanceof ApiError ? e.message : "Couldn’t save. Check your connection and try again."; }
        busy = false;
        const fresh = await loadTeam(); if (fresh) { state = fresh; onChanged?.(fresh); }
        if (renaming) drawActions(); else draw();
      }
      input.onkeydown = (e) => { if (e.key === "Enter") save(); };
      drawActions();
      body.replaceChildren(h("h2", { class: "h1" }, "Change your team name"), h("p", { class: "body muted" }, "Everyone in the team, and the organisers, will see the new name. No other team can have the same name."),
        h("label", { class: "fl" }, "Team name", h("div", { class: "field" }, input)), note, actions);
      setTimeout(() => { input.focus(); input.select(); }, 50);
    }
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
    async function practice() {
      busy = true; err = ""; draw();
      try { await api.practiceTeamNames(); toast("Practice round started: you have 100 seconds"); }
      catch (e) { err = e instanceof ApiError ? e.message : "Couldn’t start the practice round. Check your connection."; }
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
