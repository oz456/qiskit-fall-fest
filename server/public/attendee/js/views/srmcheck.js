// Personal-email people whose college says SRM-AP confirm once, right after the sign-in code: SRM-AP student or outside student.
// "Outside" means they are never asked for registration number, semester or OD details.
import { ApiError, api } from "../api.js";
import { button, h, toast } from "../ui.js";

export function srmCheckView({ onDone, onSignOut }) {
  let choice = "", saving = false, errText = "";
  const msg = h("div", { class: "err", role: "alert" });
  const submit = h("div");
  const opt = (value, title, sub) => h("button", { type: "button", class: "card row press" + (choice === value ? " picked" : ""), role: "radio", "aria-checked": String(choice === value), style: { padding: "16px 18px", textAlign: "left", width: "100%", border: choice === value ? "2px solid var(--pri)" : "" }, onclick: () => { choice = value; errText = ""; draw(); } },
    h("div", { class: "meta" }, h("div", { class: "name" }, title), h("div", { class: "where" }, sub)));
  const list = h("div", { role: "radiogroup", "aria-label": "Are you an SRM-AP student?", style: { display: "flex", flexDirection: "column", gap: "12px" } });
  async function save() {
    if (!choice) { errText = "Choose one to continue."; return draw(); }
    saving = true; errText = ""; draw();
    try { await api.saveSrmCheck(choice); }
    catch (e) { saving = false; errText = e instanceof ApiError ? e.message : "Couldn’t save. Check your connection and try again."; if (!(e instanceof ApiError) || e.status === 0) toast(errText); return draw(); }
    onDone();
  }
  function draw() {
    msg.textContent = errText;
    list.replaceChildren(opt("srm", "SRM University-AP student", "You will be asked for your registration number, semester and the other academic details."), opt("outside", "Outside student", "From another college. No academic details are needed."));
    submit.replaceChildren(button("Continue", { onclick: save, loading: saving, disabled: saving }));
  }
  draw();
  return { el: h("div", { class: "details" },
    h("div", { class: "intro" }, h("div", { class: "label" }, "One-time check"), h("h1", { class: "h1", style: { fontSize: "30px", lineHeight: "34px" } }, "Are you an SRM-AP student?"),
      h("p", { class: "body muted" }, "You signed in with a personal email, so we want to be sure. Choose carefully: this is asked only once.")),
    list, msg, submit, h("button", { class: "link", type: "button", onclick: onSignOut }, "Not you? Sign out")) };
}
