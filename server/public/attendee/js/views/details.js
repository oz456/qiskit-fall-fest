// First sign-in only, SRM-AP people only: academic details asked once. An organiser can clear them if something was mistyped.
import { ApiError, api } from "../api.js";
import { button, h, toast } from "../ui.js";
import { S } from "../store.js";

export function detailsView({ onDone, onSignOut, extra = false }) {   // extra: saved earlier, only section and gender are missing
  const opts = S.detailsOptions || { schools: ["SEAS", "ESLA", "PSB", "Other"], programs: ["Other"], genders: ["Male", "Female"] };
  let saving = false, errField = "", errText = "";
  const input = (attrs) => h("input", { autocomplete: "off", ...attrs });
  const select = (name, list, placeholder) => h("select", { name, "aria-label": placeholder, required: true },
    h("option", { value: "", disabled: true, selected: true }, placeholder), ...list.map((x) => h("option", { value: x }, x)));
  const regNo = input({ name: "regNo", placeholder: "AP25110010123", autocapitalize: "characters", maxlength: 15 });
  const school = select("school", opts.schools, "Choose your school");
  const semester = select("semester", [1, 2, 3, 4, 5, 6, 7, 8], "Semester");
  const program = select("program", opts.programs, "Program");
  const course = input({ name: "course", placeholder: "e.g. CSE, ECE, Data Science", maxlength: 60 });
  const section = input({ name: "section", placeholder: "e.g. A or S12", autocapitalize: "characters", maxlength: 12 });
  const gender = select("gender", opts.genders || ["Male", "Female"], "Gender");
  const cgpa = input({ name: "cgpa", placeholder: "e.g. 8.45, or NA", inputmode: "text", autocapitalize: "characters", maxlength: 5 });
  const wrap = (label, el, field) => h("label", { class: "fl" }, label, h("div", { class: "field" + (errField === field ? " bad" : "") }, el));
  const root = h("div", { class: "details" });
  const msg = h("div", { class: "err", role: "alert" });
  const submit = h("div");

  async function save(ev) {
    ev.preventDefault();
    const raw = cgpa.value.trim().replace(",", "."), na = /^n\/?a$/i.test(raw), n = na ? null : Number(raw);
    if (!section.value.trim()) { errField = "section"; errText = "Enter your section, like A or S12."; return draw(); }
    if (!extra && (!raw || (!na && !Number.isFinite(n)))) { errField = "cgpa"; errText = "Enter your CGPA as a number from 0 to 10, or NA if you are in the first semester."; return draw(); }
    saving = true; errField = errText = ""; draw();
    try { await api.saveDetails(extra ? { section: section.value.trim(), gender: gender.value } : { regNo: regNo.value.trim(), school: school.value, semester: Number(semester.value), course: course.value.trim(), program: program.value, section: section.value.trim(), gender: gender.value, cgpa: n }); }
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
    for (const [el, f] of [[regNo, "regNo"], [school, "school"], [semester, "semester"], [program, "program"], [course, "course"], [section, "section"], [gender, "gender"], [cgpa, "cgpa"]]) el.parentElement?.classList.toggle("bad", errField === f);
  }
  const form = h("form", { class: "details", style: { padding: 0, minHeight: 0 }, onsubmit: save },
    ...(extra ? [h("div", { class: "row2" }, wrap("Section", section, "section"), wrap("Gender", gender, "gender"))] : [
      wrap("Registration number", regNo, "regNo"), wrap("School", school, "school"),
      h("div", { class: "row2" }, wrap("Semester", semester, "semester"), wrap("Program", program, "program")),
      wrap("Course", course, "course"),
      h("div", { class: "row2" }, wrap("Section", section, "section"), wrap("Gender", gender, "gender")),
      wrap("CGPA", cgpa, "cgpa"), h("p", { class: "small muted", style: { margin: "-6px 0 0" } }, "First semester? You don’t have a CGPA yet. Enter NA (or 0).")]), msg, submit);
  root.append(
    h("div", { class: "intro" }, h("div", { class: "label" }, "One-time setup"), h("h1", { class: "h1", style: { fontSize: "30px", lineHeight: "34px" } }, extra ? "Two more details" : "Tell us about yourself"),
      h("p", { class: "body muted" }, extra ? "We forgot to ask for these. Your other details are already saved." : "We only ask this once. It helps the organisers with attendance and certificates.")),
    form, h("button", { class: "link", type: "button", onclick: onSignOut }, "Not you? Sign out"));
  draw();
  return { el: root };
}
