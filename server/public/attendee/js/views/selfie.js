// First sign-in only: one mandatory selfie, taken with the front camera. Door staff compare it with your face.
import { ApiError, api } from "../api.js";
import { button, confirmDialog, h, icon, spinner, toast } from "../ui.js";

export function selfieView({ onDone, onSignOut }) {
  let stream = null, blob = null, previewUrl = null, uploading = false, camError = null, ready = false;
  const root = h("div", { class: "selfie" });
  const video = h("video", { autoplay: true, playsinline: true, muted: true, "aria-label": "Camera preview" });
  video.muted = true;
  const frame = h("div", { class: "frame" });
  const controls = h("div", { style: { alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center" } });
  root.append(
    h("div", { class: "intro" }, h("div", { class: "label" }, "One-time setup"), h("h1", { class: "h1", style: { fontSize: "30px", lineHeight: "34px" } }, "Take a clear selfie"),
      h("p", { class: "body muted" }, "Use a clear, original picture of yourself. It can’t be changed later and will be used to verify your identity at the door.")),
    frame, controls);

  async function startCamera() {
    camError = null; ready = false; draw();
    if (!navigator.mediaDevices?.getUserMedia) { camError = { title: "Camera not available", text: /android/i.test(navigator.userAgent) ? "This browser can’t open the camera. Open the page in Chrome." : "This browser can’t open the camera. Open the page in Safari on your iPhone." }; return draw(); }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1440 } }, audio: false });
      video.srcObject = stream; await video.play().catch(() => {}); ready = true; draw();
    } catch (e) {
      camError = e && (e.name === "NotAllowedError" || e.name === "SecurityError")
        ? { title: "Camera access is off", text: /android/i.test(navigator.userAgent) ? "Allow the camera for this site: tap the lock icon next to the address, choose Permissions → Camera → Allow, then try again. If you opened this link inside another app (WhatsApp, Instagram), open it in Chrome instead." : "Allow the camera for this page: in Safari tap aA → Website Settings → Camera → Allow, then try again." }
        : { title: "Couldn’t open the camera", text: "Close other apps that use the camera, then try again." };
      draw();
    }
  }
  const stopCamera = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };

  async function capture() {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return;
    const W = 720, H = 960, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
    g.translate(W, 0); g.scale(-1, 1); g.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);   // mirrored, like the preview the person approved
    let q = 0.85, out = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
    while (out && out.size > 380_000 && q > 0.4) { q -= 0.1; out = await new Promise((r) => c.toBlob(r, "image/jpeg", q)); }   // server limit is 400 KB
    if (!out) return toast("That didn’t work. Try again.");
    blob = out; previewUrl = URL.createObjectURL(out); stopCamera(); draw();
  }
  function retake() { if (previewUrl) URL.revokeObjectURL(previewUrl); blob = previewUrl = null; startCamera(); }

  async function upload() {
    if (!(await confirmDialog({ title: "Use this photo?", text: "It can’t be changed later and will be used to verify your identity.", yes: "Yes, use it", no: "Retake" }))) return retake();
    uploading = true; draw();
    try { await api.uploadPhoto(blob); }
    catch (e) { if (!(e instanceof ApiError && e.status === 409)) { uploading = false; toast(e instanceof ApiError ? e.message : "Couldn’t upload. Check your connection and try again."); return draw(); } }
    onDone();
  }

  function draw() {
    frame.replaceChildren(); controls.replaceChildren();
    if (blob) frame.append(h("img", { src: previewUrl, alt: "Your selfie" }));
    else if (camError) frame.append(h("div", { class: "msg2" }, h("div", { class: "bubble mint", style: { width: "56px", height: "56px" } }, icon("camera")), h("div", { class: "title" }, camError.title), h("p", { class: "small muted" }, camError.text)));
    else { frame.append(video, h("div", { class: "oval" })); if (!ready) frame.append(h("div", { style: { position: "absolute" } }, spinner())); }
    controls.append(h("div", { class: "lockline" }, icon("lock"), "Final once saved · only event staff can see it"));
    if (blob) controls.append(h("div", { class: "twobtn" }, button("Retake", { cls: "alt", onclick: retake, disabled: uploading }), button("Use photo", { onclick: upload, loading: uploading })));
    else if (camError) controls.append(button("Try again", { onclick: startCamera }));
    else controls.append(h("button", { class: "shutter", type: "button", "aria-label": "Take selfie", disabled: !ready, onclick: capture }, h("i")));
    controls.append(h("button", { class: "link", type: "button", style: { marginTop: "12px" }, onclick: onSignOut }, "Not you? Sign out"));
  }
  draw(); startCamera();
  return { el: root, destroy() { stopCamera(); if (previewUrl) URL.revokeObjectURL(previewUrl); } };
}
