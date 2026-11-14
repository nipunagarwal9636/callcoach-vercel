/* Local state for the demo: review decisions, recovery cases, uploaded policies, coaching status, benchmark runs.
   Lives in this browser (localStorage). The audit trail is hash-chained so any edit to past entries is detectable. */
const MEM = {};
const Store = {
  get(k, d) {
    try { const v = localStorage.getItem("cc:" + k); return v == null ? (k in MEM ? MEM[k] : d) : JSON.parse(v); } catch { return k in MEM ? MEM[k] : d; }
  },
  set(k, v) { MEM[k] = v; try { localStorage.setItem("cc:" + k, JSON.stringify(v)); } catch { /* storage full or blocked: keep in memory */ } },
  del(k) { delete MEM[k]; try { localStorage.removeItem("cc:" + k); } catch { } },
};

const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const crore = (n) => (Math.abs(n) >= 1e7 ? "₹" + (n / 1e7).toFixed(2) + " cr" : Math.abs(n) >= 1e5 ? "₹" + (n / 1e5).toFixed(1) + " lakh" : inr(n));
const when = (ts) => new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pname = (p) => D.scorecard.find((x) => x.id === p)?.name || p;
const psev = (p) => D.scorecard.find((x) => x.id === p)?.severity || "MINOR";

function me() { return Store.get("me", { name: "", role: "QA auditor" }); }
function needMe() {
  const m = me();
  if (m.name) return m;
  const n = prompt("Your name for the audit trail (for example: Priya, QA auditor)", "");
  if (!n) return null;
  const v = { name: n.trim().slice(0, 40), role: "QA auditor" }; Store.set("me", v); return v;
}

/* ---- SHA-256 hash chain ---- */
async function sha256(text) {
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return "fnv" + (h >>> 0).toString(16);
}
const Trail = {
  all() { return Store.get("trail", []); },
  body(e) { return JSON.stringify([e.seq, e.ts, e.actor, e.role, e.action, e.ref, e.detail, e.prev]); },
  async add(action, ref, detail) {
    const m = me(), all = Trail.all(), prev = all.length ? all[all.length - 1].hash : "GENESIS";
    const e = { seq: all.length + 1, ts: Date.now(), actor: m.name || "unknown", role: m.role, action, ref, detail, prev };
    e.hash = await sha256(Trail.body(e));
    all.push(e); Store.set("trail", all); updateBadges(); return e;
  },
  async verify() {
    const all = Trail.all(); let prev = "GENESIS";
    for (const e of all) {
      if (e.prev !== prev || (await sha256(Trail.body(e))) !== e.hash) return { ok: false, at: e.seq, n: all.length };
      prev = e.hash;
    }
    return { ok: true, n: all.length };
  },
  csv() {
    const rows = [["seq", "time", "actor", "role", "action", "reference", "detail", "prev_hash", "hash"]].concat(
      Trail.all().map((e) => [e.seq, new Date(e.ts).toISOString(), e.actor, e.role, e.action, e.ref, e.detail, e.prev, e.hash]));
    return rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  },
};

function download(name, text, type = "text/plain") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function updateBadges() {
  try {
    const pend = reviewItems().filter((x) => !x.done).length;
    $("#b-review").textContent = pend || "";
    const open = Object.values(Store.get("cases", {})).filter((c) => c.status !== "resolved" && (!window.roleSeesCall || roleSeesCall(callOf(c.id)))).length;
    $("#b-recovery").textContent = open || "";
  } catch { /* data not loaded yet */ }
}

/* drawer for detail panels */
function drawer(html, wide) {
  let d = $("#drawer");
  if (!d) {
    d = document.createElement("div"); d.id = "drawer";
    d.innerHTML = `<div class="dr-bg"></div><div class="dr-in" role="dialog" aria-modal="true"><button class="dr-x" aria-label="Close">✕</button><div class="dr-body"></div></div>`;
    document.body.appendChild(d);
    d.querySelector(".dr-bg").onclick = closeDrawer; d.querySelector(".dr-x").onclick = closeDrawer;
    addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());
  }
  d.classList.toggle("wide", !!wide);
  d.querySelector(".dr-body").innerHTML = html; d.classList.add("on"); document.body.style.overflow = "hidden";
  return d.querySelector(".dr-body");
}
function closeDrawer() { $("#drawer")?.classList.remove("on"); document.body.style.overflow = ""; }

/* policy library: seeded samples + uploads */
function policyDocs() { return [...D.policies, ...Store.get("uploads", [])]; }

/* Calls the reviewer needs to see: fatal, human-review or conduct, from saved results plus live-scored calls sent for review. */
function reviewItems() {
  const dec = Store.get("decisions", {});
  const items = D.calls.map((c) => ({ id: c.id, call: c, s: c.scored[D.modes[0]], live: false }))
    .concat(Store.get("liveQueue", []).map((x) => ({ id: x.id, call: x.call, s: x.s, live: true })))
    .filter((x) => x.s.fatal.length || x.s.review.length || x.s.conduct_alert);
  return items.map((x) => ({ ...x, done: !!dec[x.id]?.signed, dec: dec[x.id] }))
    .sort((a, b) => (a.done - b.done) || (b.s.priority - a.s.priority));
}
ONBOOT.push(updateBadges);
