// OD (on-duty) details: after being checked in at an event that collects them, the student gives OD from time, OD until time and the number of hours.
import { ApiError, api } from "../api.js";
import { S, loadAll } from "../store.js";
import { button, h, openSheet, toast } from "../ui.js";

export function openOd(eventId, { onLater } = {}) {
  const ev = S.events.find((e) => e.id === eventId);
  openSheet((close, sheet) => {
    const from = h("input", { type: "time", name: "odFrom", required: true, "aria-label": "OD from time" });
    const until = h("input", { type: "time", name: "odUntil", required: true, "aria-label": "OD until time" });
    const hours = h("input", { type: "number", name: "odHours", inputmode: "decimal", min: "0.25", max: "24", step: "0.25", placeholder: "e.g. 2", "aria-label": "Number of hours" });
    let edited = false; hours.oninput = () => { edited = true; };
    const auto = () => {
      if (edited || !from.value || !until.value) return;
      const mins = (+until.value.slice(0, 2) * 60 + +until.value.slice(3)) - (+from.value.slice(0, 2) * 60 + +from.value.slice(3));
      if (mins > 0) hours.value = String(Math.round(mins / 15) / 4);
    };
    from.onchange = until.onchange = from.oninput = until.oninput = auto;
    const err = h("div", { class: "err", role: "alert" });
    let saving = false;
    const submit = h("div");
    const draw = () => submit.replaceChildren(h("div", { class: "twobtn" }, button("Later", { cls: "alt", onclick: () => { close(); onLater?.(); }, disabled: saving }), button("Save", { onclick: save, loading: saving })));
    async function save() {
      const n = Number(hours.value);
      if (!from.value || !until.value) { err.textContent = "Fill in both times."; return; }
      if (until.value <= from.value) { err.textContent = "OD until time must be after OD from time."; return; }
      if (!(n > 0) || n > 24) { err.textContent = "Enter the number of hours (more than 0, at most 24)."; return; }
      saving = true; err.textContent = ""; draw();
      try { await api.saveOd({ eventId, from: from.value, until: until.value, hours: n }); }
      catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) { saving = false; err.textContent = e instanceof ApiError ? e.message : "Couldn’t save. Check your connection and try again."; return draw(); }
      }
      toast("OD details saved"); close(); loadAll().catch(() => {});
    }
    draw();
    return [
      h("h2", { class: "h1" }, "OD details"),
      h("p", { class: "body muted" }, ev ? `You were checked in at ${ev.title}. Tell us your OD times.` : "You were checked in. Tell us your OD times."),
      h("div", { class: "odgrid" }, h("label", { class: "fl" }, "OD from time", h("div", { class: "field" }, from)), h("label", { class: "fl" }, "OD until time", h("div", { class: "field" }, until))),
      h("label", { class: "fl" }, "Number of hours", h("div", { class: "field" }, hours)),
      err, submit];
  });
}
