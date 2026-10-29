// "Your team" sheet for hackathon participants: the team lead on top, then teammates. The lead can rename the team (unless organisers have switched that off).
import { ApiError, api } from "../api.js";
import { button, h, openSheet, toast } from "../ui.js";

export async function loadTeam() {
  try { return await api.team(); } catch { return null; }   // null = couldn't load (offline); the card then just says it's included in the pass
}

const initials = (n) => String(n || "?").split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase() || "?";

export function openTeam(data, { onRenamed } = {}) {
  openSheet((close) => {
    const body = h("div");
    let state = data;
    const draw = () => {
      const t = state?.team;
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
        h("div", { class: "teamhead" }, h("h2", { class: "h1", style: { margin: 0 } }, t.name), state.canRename ? button("Rename", { cls: "alt", onclick: rename }) : null),
        h("p", { class: "body muted" }, [t.problemStatementId, `${t.members.length} ${t.members.length === 1 ? "member" : "members"}`].filter(Boolean).join(" · ")),
        state.canRename && state.renameNote ? h("p", { class: "small muted", style: { margin: "-6px 0 4px" } }, state.renameNote) : null,
        h("div", { class: "teamlist" }, rows),
        t.isLeader && !state.canRename ? h("p", { class: "body muted" }, "Team names can’t be changed any more.") : null);
    };
    function rename() {
      const input = h("input", { type: "text", name: "teamName", maxlength: "40", value: state.team.name, "aria-label": "Team name", autocomplete: "off" });
      const err = h("div", { class: "err", role: "alert" });
      let saving = false;
      const actions = h("div");
      const drawActions = () => actions.replaceChildren(h("div", { class: "twobtn" }, button("Cancel", { cls: "alt", onclick: draw, disabled: saving }), button(saving ? "Saving…" : "Save name", { onclick: save, disabled: saving })));
      async function save() {
        const name = input.value.replace(/\s+/g, " ").trim();
        if (name.length < 3 || name.length > 40) { err.textContent = "A team name must be 3 to 40 characters."; return; }
        if (name === state.team.name) return draw();
        saving = true; err.textContent = ""; drawActions();
        try {
          const r = await api.renameTeam(name);
          state = { ...state, team: { ...state.team, name: r.name } };
          toast("Team name changed"); onRenamed?.(state); draw();
        } catch (e) {
          saving = false; err.textContent = e instanceof ApiError ? e.message : "Couldn’t save. Check your connection and try again.";
          if (e instanceof ApiError && e.status === 403) state = { ...state, canRename: false };
          drawActions();
        }
      }
      input.onkeydown = (e) => { if (e.key === "Enter") save(); };
      drawActions();
      body.replaceChildren(h("h2", { class: "h1" }, "Rename your team"), h("p", { class: "body muted" }, "Everyone in the team, and the organisers, will see the new name."), state.renameNote ? h("p", { class: "small muted", style: { margin: "-6px 0 8px" } }, state.renameNote) : null,
        h("label", { class: "fl" }, "Team name", h("div", { class: "field" }, input)), err, actions);
      setTimeout(() => { input.focus(); input.select(); }, 50);
    }
    draw();
    return [body];
  });
}
