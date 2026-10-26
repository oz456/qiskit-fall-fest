// First sign-in only, SRM-AP people only: academic details asked once. An organiser can clear them if something was mistyped.
import { ApiError, api } from "../api.js";
import { button, h, toast } from "../ui.js";
import { S } from "../store.js";

export function detailsView({ onDone, onSignOut }) {
  const opts = S.detailsOptions || { schools: ["SEAS", "ESLA", "PSB", "Other"], programs: ["Other"] };
  let saving = false, errField = "", errText = "";
  const input = (attrs) => h("input", { autocomplete: "off", ...attrs });
  const select = (name, list, placeholder) => h("select", { name, "aria-label": placeholder, required: true },
    h("option", { value: "", disabled: true, selected: true }, placeholder), ...list.map((x) => h("option", { value: x }, x)));
  const regNo = input({ name: "regNo", placeholder: "AP25110010123", autocapitalize: "characters", maxlength: 15 });
  const school = select("school", opts.schools, "Choose your school");
  const semester = select("semester", [1, 2, 3, 4, 5, 6, 7, 8], "Semester");
  const program = select("program", opts.programs, "Program");
  const course = input({ name: "course", placeholder: "e.g. CSE, ECE, Data Science", maxlength: 60 });
  const cgpa = input({ name: "cgpa", placeholder: "e.g. 8.45", inputmode: "decimal", maxlength: 5 });
  const wrap = (label, el, field) => h("label", { class: "fl" }, label, h("div", { class: "field" + (errField === field ? " bad" : "") }, el));
  const root = h("div", { class: "details" });
  const msg = h("div", { class: "err", role: "alert" });
  const submit = h("div");

  async function save(ev) {
    ev.preventDefault();
    const n = Number(cgpa.value.trim());
    if (!cgpa.value.trim() || !Number.isFinite(n)) { errField = "cgpa"; errText = "Enter your CGPA as a number from 0 to 10."; return draw(); }
    saving = true; errField = errText = ""; draw();
    try { await api.saveDetails({ regNo: regNo.value.trim(), school: school.value, semester: Number(semester.value), course: course.value.trim(), program: program.value, cgpa: n }); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "already_set") return onDone();
      saving = false; errField = (e instanceof ApiError && e.field) || ""; errText = e instanceof ApiError ? e.message : "Couldn’t save. Check your connection and try again.";
      if (!(e instanceof ApiError) || e.status === 0) toast(errText);
      return draw();
    }
    onDone();
  }
  function draw() {
    msg.textContent = errText;
    submit.replaceChildren(button("Continue", { onclick: () => form.requestSubmit(), loading: saving, disabled: saving }));
    for (const [el, f] of [[regNo, "regNo"], [school, "school"], [semester, "semester"], [program, "program"], [course, "course"], [cgpa, "cgpa"]]) el.parentElement?.classList.toggle("bad", errField === f);
  }
  const form = h("form", { class: "details", style: { padding: 0, minHeight: 0 }, onsubmit: save },
    wrap("Registration number", regNo, "regNo"), wrap("School", school, "school"),
    h("div", { class: "row2" }, wrap("Semester", semester, "semester"), wrap("Program", program, "program")),
    wrap("Course", course, "course"), wrap("CGPA", cgpa, "cgpa"), msg, submit);
  root.append(
    h("div", { class: "intro" }, h("div", { class: "label" }, "One-time setup"), h("h1", { class: "h1", style: { fontSize: "30px", lineHeight: "34px" } }, "Tell us about yourself"),
      h("p", { class: "body muted" }, "We only ask this once. It helps the organisers with attendance and certificates.")),
    form, h("button", { class: "link", type: "button", onclick: onSignOut }, "Not you? Sign out"));
  draw();
  return { el: root };
}
