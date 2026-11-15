/* Local state for the demo: review decisions, recovery cases, uploaded policies, coaching status, benchmark runs.
   Lives in this browser (localStorage). The audit trail is hash-chained so any edit to past entries is detectable. */
const MEM = {};
const SHARED_KEYS = ["decisions", "cases", "trail", "coachLog", "uploads"];
const Store = {
  get(k, d) {
    try { const v = localStorage.getItem("cc:" + k); return v == null ? (k in MEM ? MEM[k] : d) : JSON.parse(v); } catch { return k in MEM ? MEM[k] : d; }
  },
  set(k, v) { MEM[k] = v; try { localStorage.setItem("cc:" + k, JSON.stringify(v)); } catch { /* storage full or blocked: keep in memory */ } if (SHARED_KEYS.includes(k)) Sync.push(); },
  del(k) { delete MEM[k]; try { localStorage.removeItem("cc:" + k); } catch { } },
};

const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const crore = (n) => (Math.abs(n) >= 1e7 ? "₹" + (n / 1e7).toFixed(2) + " cr" : Math.abs(n) >= 1e5 ? "₹" + (n / 1e5).toFixed(1) + " lakh" : inr(n));
const when = (ts) => new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pname = (p) => D.scorecard.find((x) => x.id === p)?.name || p;
const psev = (p) => D.scorecard.find((x) => x.id === p)?.severity || "MINOR";

const ROLE_NAME = { admin: "Admin", qa: "QA auditor", tl: "Team lead", agent: "Agent" };
function me() { const u = window.Auth && Auth.user(); return u ? { name: u.name, role: ROLE_NAME[u.role] || u.role, id: u.u } : Store.get("me", { name: "", role: "QA auditor" }); }
function needMe() { return me(); }

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

/* ---- shared state across devices (Upstash Redis on Vercel, if connected) ---- */
const Sync = {
  t: null, loading: false,
  async pull() {
    if (!STATUS.kv || !Auth.ok()) return;
    try { const j = await Auth.api("/api/state?scope=shared"); Sync.loading = true; for (const k of SHARED_KEYS) if (j.state && j.state[k] !== undefined) Store.set(k, j.state[k]); }
    catch { } finally { Sync.loading = false; }
  },
  push() {
    if (Sync.loading || !window.STATUS?.kv || !Auth.ok() || Auth.user().role === "agent") return;
    clearTimeout(Sync.t);
    Sync.t = setTimeout(() => Auth.api("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "shared", state: Object.fromEntries(SHARED_KEYS.map((k) => [k, Store.get(k, k === "trail" ? [] : {})])) }) }).catch(() => {}), 800);
  },
};

/* ---- per-user memory: last visit, practice sessions, lessons ---- */
const Memory = {
  key() { return "u:" + (Auth.user()?.u || "anon"); },
  get() { return Store.get(Memory.key(), { visits: 0, last: 0, prevLast: 0, practice: [], lessons: {}, seen: [] }); },
  set(m) { Store.set(Memory.key(), m); if (window.STATUS?.kv) { clearTimeout(Memory.t); Memory.t = setTimeout(() => Auth.api("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "me", state: m }) }).catch(() => {}), 600); } },
  update(fn) { const m = Memory.get(); fn(m); Memory.set(m); return m; },
  async load() {
    if (window.STATUS?.kv) { try { const j = await Auth.api("/api/state?scope=me"); if (j.state && Object.keys(j.state).length) Store.set(Memory.key(), { ...Memory.get(), ...j.state }); } catch { } }
    Memory.update((m) => { m.prevLast = m.last; m.last = Date.now(); m.visits = (m.visits || 0) + 1; });
  },
  lesson(p, patch) { return Memory.update((m) => { m.lessons[p] = { ...(m.lessons[p] || {}), ...patch }; }); },
};

/* ---- feed of newly scored calls: reaches the call's agent and team lead ---- */
const Feed = {
  cache: [],
  local() { return Store.get("feed", []); },
  async refresh() {
    let items = Feed.local();
    if (window.STATUS?.kv) { try { const j = await Auth.api("/api/feed"); items = j.items; } catch { } }
    const u = Auth.user();
    Feed.cache = items.filter((i) => u.role === "admin" || u.role === "qa" || (u.role === "tl" ? i.team_lead_id === u.team : i.agent_id === u.agent));
    return Feed.cache;
  },
  async add(item) {
    const u = Auth.user();
    item = { ...item, ts: item.ts || Date.now(), by: u.name, by_role: u.role };
    if (u.role === "agent") { item.agent_id = u.agent; item.team_lead_id = u.team; }
    Store.set("feed", [item, ...Feed.local().filter((x) => x.id !== item.id)].slice(0, 300));
    if (window.STATUS?.kv) { try { await Auth.api("/api/feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) }); } catch { } }
    await Feed.refresh(); updateBadges();
    await Trail.add("Scored call shared", item.id, `${item.agent || item.agent_id}: score ${item.s.score}${item.s.fatal.length ? ", fatal " + item.s.fatal.join(", ") : ""}`);
  },
  unseen() { const seen = new Set(Memory.get().seen || []); return Feed.cache.filter((i) => !seen.has(i.id + ":" + i.ts)); },
  markSeen() { Memory.update((m) => { m.seen = [...new Set([...(m.seen || []), ...Feed.cache.map((i) => i.id + ":" + i.ts)])].slice(-500); }); },
};

/* Calls the reviewer needs to see: fatal, human-review or conduct, from saved results plus live-scored calls sent for review. */
function reviewItems() {
  const dec = Store.get("decisions", {});
  const items = D.calls.map((c) => ({ id: c.id, call: c, s: c.scored[D.modes[0]], live: false }))
    .concat(Store.get("liveQueue", []).map((x) => ({ id: x.id, call: x.call, s: x.s, live: true })))
    .concat((Feed.cache || []).filter((x) => !D.calls.find((c) => c.id === x.id)).map((x) => ({ id: x.id, call: { id: x.id, agent: x.agent || x.agent_id, agent_id: x.agent_id, team_lead: x.team_lead_id, team_lead_id: x.team_lead_id, product: x.product || "LIVE", language: x.language || "-", outcome: x.s.sale ? "SALE" : "UNKNOWN", turns: x.turns, labels: null }, s: x.s, live: true })))
    .filter((x) => x.s.fatal.length || x.s.review.length || x.s.conduct_alert);
  return items.map((x) => ({ ...x, done: !!dec[x.id]?.signed, dec: dec[x.id] }))
    .sort((a, b) => (a.done - b.done) || (b.s.priority - a.s.priority));
}
ONBOOT.push(updateBadges);

/* "Share this scored call" block used by Score a call and Live call */
function shareUI(box, s, turns, source, presetAgent) {
  const u = Auth.user(), id = "NEW-" + new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "") + Math.random().toString(36).slice(2, 4).toUpperCase();
  const pack = (a) => ({ id, agent_id: a.id, team_lead_id: a.team_lead_id, agent: a.name, s, turns, source, sale: !!s.sale });
  const done = (a) => { box.innerHTML = `<div class="shared">${svg("review", 16)} <span>Shared with <b>${esc(a.name)}</b> and team lead <b>${esc(a.team_lead)}</b>. It's on their dashboards now${s.fatal.length || s.review.length ? ", and in the QA review queue" : ""}.</span></div>`; };
  if (u.role === "agent") { const a = me_agent(); Feed.add(pack(a)).then(() => done(a)); box.innerHTML = `<span class="small muted">Sharing with your team lead…</span>`; return; }
  const list = D.agents.agents.filter((a) => u.role !== "tl" || a.team_lead_id === u.team).sort((a, b) => a.name.localeCompare(b.name));
  const pre = presetAgent || Store.get("lastAgent", "");
  box.innerHTML = `<div class="share"><span><b>Whose call is this?</b><span class="small muted">Sharing puts it on the agent's and team lead's dashboards${s.fatal.length ? ", and sends the fatal finding to QA" : ""}.</span></span>
    <select class="sh-a"><option value="">Pick the agent…</option>${list.map((a) => `<option value="${a.id}" ${a.id === pre ? "selected" : ""}>${esc(a.name)} (${a.id}, ${a.team_lead_id})</option>`).join("")}</select>
    <button class="btn small sh-go">Share with agent and team lead</button></div>`;
  $(".sh-go", box).onclick = async () => {
    const a = list.find((x) => x.id === $(".sh-a", box).value); if (!a) return toast("Pick the agent first");
    Store.set("lastAgent", a.id); $(".sh-go", box).disabled = true; await Feed.add(pack(a)); done(a); toast(`Shared with ${a.name}`);
  };
}
