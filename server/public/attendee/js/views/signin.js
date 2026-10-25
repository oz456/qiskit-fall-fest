// Sign in: email -> 6-digit code. Same layout as the mobile apps (poster headline, atom artwork, partner footer).
import { ApiError, api } from "../api.js";
import { atom } from "../atom.js";
import { h, icon, sparkle } from "../ui.js";

export function lockup() {
  return h("div", { class: "lockup" }, h("img", { src: "/shared/qiskit.svg", alt: "" }),
    h("div", {}, h("b", {}, "IBM ", h("strong", {}, "Quantum")), h("span", {}, "Qiskit Fall Fest 2026")));
}
export function partnerLine() {
  return h("div", { class: "partner" }, h("div", { class: "l" }, h("img", { src: "/shared/qiskit.svg", alt: "" }), "In partnership with IBM"), h("div", { class: "s" }, "SRM UNIVERSITY AP · AMARAVATI"));
}

export function signInView({ onDone }) {
  let step = 0, email = "", loading = false, error = null, info = "", cooldown = 0, timer = 0;
  const root = h("div", { class: "signin" });
  const formBox = h("div", { class: "form" });
  const canvas = h("canvas", { "aria-hidden": "true" });
  const art = h("div", { class: "art" }, canvas, h("span", { class: "sp", style: { left: "6px", top: "14px" } }, sparkle(22, "#7e1322")), h("span", { class: "sp", style: { left: "70px", top: "52%" } }, sparkle(13, "#eb732f")));
  root.append(
    h("div", { class: "top" }, h("div", { style: { display: "flex", alignItems: "flex-start", flex: "1" } }, lockup(), h("div", { class: "tag" }, "Learn", h("br"), "Build", h("br"), "Belong"))),
    h("h1", { class: "hero-title" }, "Qiskit", h("br"), h("span", { class: "m" }, "Fall Fest"), h("span", { class: "y" }, "SRMAP 2026")),
    art, formBox, h("div", { style: { marginTop: "4px" } }, partnerLine()),
  );
  requestAnimationFrame(() => atom(canvas, { color: "#161818", electron: "#eb732f", line: 1.4, period: 8 }));

  const shake = () => { formBox.classList.remove("shake"); void formBox.offsetWidth; formBox.classList.add("shake"); };
  const fail = (msg) => { error = msg; draw(); shake(); };
  const tick = () => { clearInterval(timer); timer = setInterval(() => { cooldown = Math.max(0, cooldown - 1); if (!cooldown) clearInterval(timer); const r = document.getElementById("resend"); if (r) r.textContent = cooldown ? `Resend in ${cooldown}s` : "Resend code"; }, 1000); };

  async function sendCode() {
    const e = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail("Enter the email you registered with");
    loading = true; error = null; draw();
    try { const r = await api.requestCode(e); info = r.message; step = 1; cooldown = 30; tick(); }
    catch (x) { error = x instanceof ApiError ? x.message : "Something went wrong. Try again."; shake(); }
    loading = false; draw();
  }
  async function verify(code) {
    if (loading) return; loading = true; error = null; draw();
    try { await api.verify(email, code); onDone(); return; }
    catch (x) { error = x instanceof ApiError ? x.message : "Something went wrong. Try again."; shake(); }
    loading = false; draw(true);
  }

  function draw(keepFocus = false) {
    formBox.replaceChildren();
    if (step === 0) {
      const input = h("input", { type: "email", inputmode: "email", autocomplete: "email", autocapitalize: "none", autocorrect: "off", spellcheck: "false", enterkeyhint: "send", placeholder: "you@example.com", value: email, "aria-label": "Email",
        oninput: (e) => { email = e.target.value; if (error) { error = null; errBox.replaceChildren(); } }, onkeydown: (e) => { if (e.key === "Enter") sendCode(); } });
      const errBox = h("div", {}); if (error) errBox.append(errNode(error));
      formBox.append(h("label", { class: "field" }, icon("mail"), input), h("p", { class: "small muted", style: { padding: "0 6px" } }, "Use the email you registered with. We’ll send a 6-digit code. No password needed."), errBox,
        h("button", { class: "btn", type: "button", disabled: loading, onclick: sendCode }, loading ? h("span", { class: "spin" }) : ["Send code", icon("arrowR")]));
    } else {
      let code = "";
      const cells = Array.from({ length: 6 }, () => h("div", { class: "cell" }));
      const input = h("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", autocomplete: "one-time-code", maxlength: "6", "aria-label": "6-digit code", disabled: loading,
        oninput: (e) => { code = e.target.value.replace(/\D/g, "").slice(0, 6); e.target.value = code; paint(); if (error) { error = null; errBox.replaceChildren(); } if (code.length === 6) verify(code); } });
      const paint = () => cells.forEach((c, i) => { c.textContent = code[i] || ""; c.classList.toggle("on", i === code.length); });
      paint();
      const errBox = h("div", {}); if (error) errBox.append(errNode(error));
      formBox.append(h("h2", { class: "h2" }, "Enter your code"), h("p", { class: "small muted" }, info || `We sent a code to ${email}`),
        h("div", { class: "codes", onclick: () => input.focus() }, cells, input), errBox,
        h("button", { class: "btn", type: "button", disabled: loading, onclick: () => (code.length === 6 ? verify(code) : (error = "Enter the 6-digit code", draw(), shake())) }, loading ? h("span", { class: "spin" }) : ["Verify", icon("arrowR")]),
        h("div", { class: "row2" },
          h("button", { class: "link", type: "button", onclick: () => { step = 0; error = null; draw(); } }, "Change email"),
          h("button", { class: "link", id: "resend", type: "button", onclick: () => { if (!cooldown) sendCode(); } }, cooldown ? `Resend in ${cooldown}s` : "Resend code")));
      if (!loading || keepFocus) setTimeout(() => input.focus(), 50);
    }
  }
  const errNode = (m) => h("div", { class: "err", role: "alert" }, icon("warn", ""), m);
  draw();
  return { el: root, destroy() { clearInterval(timer); } };
}
