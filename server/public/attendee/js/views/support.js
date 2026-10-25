// Support: options, your tickets (with a "new reply" pill), refreshed whenever the tab is open.
import { S, fmtStamp, hasNewReply, loadAll, subscribe } from "../store.js";
import { bubble, button, h, icon, pill, posterTitle, sectionLabel } from "../ui.js";
import { openFaq, openThread, openTicketForm } from "./sheets.js";

export function supportView() {
  const root = h("div", { class: "screen" });
  const ticketsBox = h("div", {});
  const opt = (ic, title, sub, onclick) => h("button", { class: "opt-row", type: "button", onclick }, bubble(ic, 50), h("div", { class: "t" }, h("div", { class: "title" }, title), h("div", { class: "small muted" }, sub)), icon("chevR"));
  root.append(
    h("div", { class: "passhead" }, h("div", { class: "label" }, "Support & grievances"), posterTitle("We’ve got", "your back.")),
    h("div", { class: "pad" },
      h("div", { class: "card press", role: "button", tabindex: "0", onclick: () => openTicketForm("General") },
        h("div", { class: "row", style: { padding: "22px", gap: "16px" } }, bubble("headset", 54, true), h("div", { class: "meta" }, h("div", { class: "title" }, "Need help?"), h("div", { class: "small muted" }, S.settings.support_note || "Reach our support team or raise a grievance.")), icon("chevR"))),
      h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "support-opts" },
        opt("users", "Request mentor help", "Stuck on your quantum circuit? Ping an expert.", () => openTicketForm("Mentor help")),
        opt("warn", "Submit a grievance", "Report an issue, bug, or team dispute.", () => openTicketForm("Grievance")),
        opt("book", "FAQs & rules", "Hackathon guidelines.", openFaq))),
      h("div", { style: { marginTop: "20px" } }, button("New support ticket", { cls: "soft", icon: "ticket", onclick: () => openTicketForm("General") }))),
    ticketsBox);

  function tickets() {
    ticketsBox.replaceChildren();
    if (!S.tickets.length) return;
    ticketsBox.append(sectionLabel("Your tickets"), h("div", { class: "list" }, S.tickets.map((t) => {
      const last = t.messages.at(-1), fresh = hasNewReply(t);
      return h("div", { class: "card press tkt", role: "button", tabindex: "0", onclick: () => openThread(t.id) },
        h("div", { class: "r" }, h("span", { class: "bodyM" }, t.code),
          t.status === "resolved" ? pill("Resolved", "mint") : fresh ? pill("New reply", "pri") : pill(t.status.replace("_", " ")),
          h("span", { class: "grow" }), h("span", { class: "small muted" }, fmtStamp(Date.parse(t.createdAt)))),
        h("div", { class: "title", style: { fontSize: "15px" } }, `${t.kind} · ${t.topic}`),
        last ? h("div", { class: "last" }, (last.author === "admin" ? "Team: " : "You: ") + last.body) : null);
    })));
  }
  const un = subscribe(tickets); tickets();
  // fresh replies without reopening the app: refresh when this tab opens and every 30 s while it is showing
  loadAll().catch(() => {});
  const timer = setInterval(() => { if (!document.hidden) loadAll().catch(() => {}); }, 30000);
  return { el: root, refresh: loadAll, destroy() { un(); clearInterval(timer); } };
}
