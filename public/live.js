/* Live call monitor: listen to a real conversation, transcribe it as it happens, and flag fatal errors with the fix on screen. */
const LIVE = { on: false, engine: "browser", lang: "en-IN", mode: "manual", speaker: "AGENT", plan: "insurer-b-health-secure-plus",
  turns: [], interim: "", coach: null, log: [], seen: new Set(), rec: null, mr: null, sound: true, playing: false, t0: 0, busy: 0, ms: [] };
const SR_ = window.SpeechRecognition || window.webkitSpeechRecognition;

function renderLive() {
  const el = $("#v-live");
  const plans = policyDocs();
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Live call</h2><p>Put a real conversation on speaker next to the laptop, or have two people talk in the room. CallCoach transcribes it as it happens, and the moment the agent says something fatal it turns red and shows the line that fixes it, while the customer is still on the call.</p></div></div>
  <div class="panel live-ctl">
    <div class="lc-row">
      <button class="btn big ${LIVE.on ? "stop" : ""}" id="lv-go">${LIVE.on ? '<span class="rec-dot"></span> Stop listening' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg> Start listening'}</button>
      <button class="btn ghost" id="lv-sample">${LIVE.playing ? "Stop sample" : "Play a sample call"}</button>
      <button class="btn ghost" id="lv-end" ${LIVE.turns.length ? "" : "disabled"}>End call and score it</button>
      <button class="btn ghost small" id="lv-clear" ${LIVE.turns.length ? "" : "disabled"}>Clear</button>
      <span class="lc-time" id="lv-time"></span>
    </div>
    <div class="lc-row opts">
      <label>Listen with<select id="lv-engine">
        <option value="browser" ${LIVE.engine === "browser" ? "selected" : ""} ${SR_ ? "" : "disabled"}>Browser speech (Chrome or Edge)${SR_ ? "" : " – not available here"}</option>
        <option value="whisper" ${LIVE.engine === "whisper" ? "selected" : ""} ${STATUS.stt ? "" : "disabled"}>Whisper AI, 6-second chunks${STATUS.stt ? "" : " – needs STT key"}</option></select></label>
      <label>Language<select id="lv-lang"><option value="en-IN">English + Hinglish (en-IN)</option><option value="hi-IN" ${LIVE.lang === "hi-IN" ? "selected" : ""}>Hindi (hi-IN)</option></select></label>
      <label>Who's speaking<select id="lv-mode"><option value="manual">I switch it (Space bar)</option><option value="auto" ${LIVE.mode === "auto" ? "selected" : ""}>Detect automatically${STATUS.llm ? " (AI)" : " (rules)"}</option></select></label>
      <label>Plan being sold<select id="lv-plan">${plans.map((d) => `<option value="${d.id}" ${d.id === LIVE.plan ? "selected" : ""}>${esc(d.name.replace(/ with zero depreciation/, ""))}</option>`).join("")}</select></label>
      <label class="toggle" style="margin:0 0 6px"><input type="checkbox" id="lv-sound" ${LIVE.sound ? "checked" : ""}> <span>Alert sound</span></label>
    </div>
    ${!SR_ && !STATUS.stt ? `<div class="alert" style="margin:10px 0 0">This browser can't transcribe speech. Open the app in Chrome or Edge, or add STT_PROVIDER and STT_API_KEY for Whisper. "Play a sample call" works everywhere.</div>` : ""}
  </div>
  <div class="grid-live">
    <div class="panel"><div class="spk" id="lv-spk"></div><div class="lv-tx" id="lv-tx"></div></div>
    <div id="lv-dash"></div>
  </div>`;
  $("#lv-go").onclick = () => (LIVE.on ? stopListening() : startListening());
  $("#lv-sample").onclick = () => (LIVE.playing ? (LIVE.playing = false) : playSample());
  $("#lv-end").onclick = endLive;
  $("#lv-clear").onclick = () => { if (LIVE.on) stopListening(); Object.assign(LIVE, { turns: [], log: [], seen: new Set(), coach: null, interim: "", ms: [] }); renderLive(); };
  $("#lv-engine").onchange = (e) => (LIVE.engine = e.target.value);
  $("#lv-lang").onchange = (e) => (LIVE.lang = e.target.value);
  $("#lv-mode").onchange = (e) => { LIVE.mode = e.target.value; drawSpeaker(); };
  $("#lv-plan").onchange = (e) => { LIVE.plan = e.target.value; analyse(); };
  $("#lv-sound").onchange = (e) => (LIVE.sound = e.target.checked);
  drawSpeaker(); drawTx(); drawDash();
}

function drawSpeaker() {
  const b = $("#lv-spk"); if (!b) return;
  b.innerHTML = LIVE.mode === "manual"
    ? `<span class="small muted">Now speaking</span><div class="seg big-seg"><button data-sp="AGENT" class="${LIVE.speaker === "AGENT" ? "on" : ""}">Agent</button><button data-sp="CUSTOMER" class="${LIVE.speaker === "CUSTOMER" ? "on" : ""}">Customer</button></div><span class="small muted">Press <kbd>Space</kbd> to switch</span>`
    : `<span class="small muted">Speaker is detected for each sentence${STATUS.llm ? " by AI" : " by rules"}. Click a line's label to correct it.</span>`;
  $$("[data-sp]", b).forEach((x) => x.onclick = () => { LIVE.speaker = x.dataset.sp; drawSpeaker(); });
}

function drawTx() {
  const box = $("#lv-tx"); if (!box) return;
  const bad = new Map(); for (const l of LIVE.log) { const o = bad.get(l.turnIdx); if (!o || l.level === "fatal") bad.set(l.turnIdx, l); }
  const n = LIVE.log.filter((l) => l.turnIdx !== undefined);
  ["#lv-end", "#lv-clear"].forEach((s) => { const b = $(s); if (b) b.disabled = !LIVE.turns.length; });
  box.innerHTML = (LIVE.turns.length || LIVE.interim ? "" : `<div class="empty">Press <b>Start listening</b> and talk, or play a sample call. Lines appear here as they're spoken.</div>`)
    + LIVE.turns.map((t, i) => { const a = bad.get(i);
      return `<div class="lv-line ${t.s === "AGENT" ? "ag" : "cu"} ${a ? "hit-" + a.level : ""}"><button class="who" data-flip="${i}" title="Click to switch speaker">${t.s === "AGENT" ? "Agent" : "Customer"}</button>
        <div><p>${a && t.s === "AGENT" ? `<mark>${esc(t.t)}</mark>` : esc(t.t)}</p>${LIVE.log.filter((l) => l.turnIdx === i).map((l) => `<span class="msg-flag ${l.level}">${esc(l.title)}</span>`).join(" ")}</div><span class="small muted">${t.at}</span></div>`; }).join("")
    + (LIVE.interim ? `<div class="lv-line interim ${LIVE.speaker === "AGENT" ? "ag" : "cu"}"><span class="who">${LIVE.mode === "manual" ? (LIVE.speaker === "AGENT" ? "Agent" : "Customer") : "…"}</span><div><p>${esc(LIVE.interim)}</p></div></div>` : "");
  $$("[data-flip]", box).forEach((b) => b.onclick = () => { const t = LIVE.turns[+b.dataset.flip]; t.s = t.s === "AGENT" ? "CUSTOMER" : "AGENT"; drawTx(); analyse(); });
  box.scrollTop = box.scrollHeight;
}

function drawDash() {
  const d = $("#lv-dash"); if (!d) return;
  const k = LIVE.coach, fatal = LIVE.log.filter((l) => l.level === "fatal"), major = LIVE.log.filter((l) => l.level !== "fatal");
  const state = fatal.length ? "fatal" : major.length ? "warn" : "clean";
  const latest = LIVE.log[LIVE.log.length - 1];
  const avg = LIVE.ms.length ? Math.round(LIVE.ms.reduce((a, b) => a + b, 0) / LIVE.ms.length) : null;
  d.innerHTML = `<div class="light ${state}"><div class="lamp"></div><div><b>${state === "fatal" ? `${fatal.length} fatal error${fatal.length > 1 ? "s" : ""}` : state === "warn" ? `${major.length} warning${major.length > 1 ? "s" : ""}` : "Clean so far"}</b>
      <span>${state === "fatal" ? "Fix it on this call, before it ends" : state === "warn" ? "Not fatal, but coach it" : LIVE.turns.length ? "No rule broken yet" : "Waiting for the call to start"}</span></div>
      ${k ? `<div class="lmeter"><b>${k.meter}</b><span>compliance</span></div>` : ""}</div>
    ${latest ? `<div class="fixnow ${latest.level}"><span class="small">${latest.level === "fatal" ? "Fatal" : "Warning"}, ${latest.at}: ${esc(latest.param)}</span><h3>${esc(latest.title)}</h3>
      <p class="small">Agent said: <s>${esc(latest.said.slice(0, 160))}</s></p>
      <div class="say"><span class="small muted">Fix it now. Say this</span><p>${esc(latest.fix)}</p><button class="linkbtn" data-copy="${esc(latest.fix)}">Copy line</button></div></div>` : ""}
    ${k && k.nudges.length ? `<div class="panel"><h4>Next best line for the agent</h4>${k.nudges.map((n) => `<div class="nudge ${n.urgent ? "urgent" : ""}"><span class="small"><b>${esc(n.why)}</b></span><p>${esc(n.say)}</p></div>`).join("")}</div>` : ""}
    ${LIVE.log.length > 1 ? `<div class="panel"><h4>Everything flagged on this call</h4><ul class="evlog">${LIVE.log.slice().reverse().map((l) => `<li class="${l.level}"><span class="chip ${l.level === "fatal" ? "FATAL" : l.level === "major" ? "MAJOR" : "MINOR"}">${esc(l.param)}</span><span>${esc(l.title)}</span><span class="small muted">${l.at}</span></li>`).join("")}</ul></div>` : ""}
    ${k ? `<div class="panel"><h4>Checklist</h4><ul class="check">${k.checklist.map((c) => `<li class="${c.state}"><span class="ic">${{ done: "✓", ok: "✓", todo: "○", fail: "✗" }[c.state]}</span><span>${c.id} ${esc(c.label)}${c.items ? `<ul>${c.items.map((x) => `<li class="${x.done ? "done" : "todo"}">${x.done ? "✓" : "○"} ${esc(x.label)}</li>`).join("")}</ul>` : ""}</span></li>`).join("")}</ul>
      ${avg != null ? `<p class="small muted" style="margin-top:8px">Checked in ${avg} ms per line on average.</p>` : ""}</div>` : ""}`;
  $$("[data-copy]", d).forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast("Copied"); });
  document.body.classList.toggle("live-fatal", state === "fatal" && LIVE.on);
}

function clock() { const s = Math.floor((Date.now() - LIVE.t0) / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

async function addSegment(text, speaker) {
  text = text.trim(); if (!text) return;
  let s = speaker || LIVE.speaker;
  const at = LIVE.t0 ? clock() : "";
  const i = LIVE.turns.push({ s, t: text, at }) - 1;
  drawTx();
  if (!speaker && LIVE.mode === "auto" && STATUS.api) {
    try {
      const r = await fetch("/api/label", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, context: LIVE.turns.slice(0, i).map(({ s, t }) => ({ s, t })), use_llm: true }) });
      const j = await r.json(); if (r.ok) LIVE.turns[i].s = j.speaker;
    } catch { /* keep the current speaker */ }
    drawTx();
  }
  analyse();
}

async function analyse() {
  if (!STATUS.api || !LIVE.turns.length) return drawDash();
  const my = ++LIVE.busy, t0 = performance.now();
  try {
    const r = await fetch("/api/buddy", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: "live", plan: LIVE.plan, reply: false, turns: LIVE.turns.map(({ s, t }) => ({ s, t })), docs: Store.get("uploads", []).map((d) => ({ id: d.id, name: d.name, text: d.text })) }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    if (my !== LIVE.busy) return;
    LIVE.ms.push(Math.round(performance.now() - t0));
    LIVE.coach = j.coach;
    const lastAgent = LIVE.turns.map((t, i) => [t, i]).filter(([t]) => t.s === "AGENT").pop();
    let fresh = null;
    const rank = { minor: 0, major: 1, fatal: 2 };
    for (const a of [...j.coach.alerts].sort((x, y) => rank[x.level] - rank[y.level])) {
      const key = lastAgent[1] + "|" + a.title;
      if (LIVE.seen.has(key)) continue;
      LIVE.seen.add(key);
      fresh = { ...a, turnIdx: lastAgent[1], at: lastAgent[0].at || "" }; LIVE.log.push(fresh);
    }
    if (fresh) { flash(fresh.level); drawTx(); }
  } catch (e) { toast("Live check: " + e.message); }
  drawDash();
}

function flash(level) {
  document.body.classList.remove("flash-fatal", "flash-major"); void document.body.offsetWidth;
  document.body.classList.add(level === "fatal" ? "flash-fatal" : "flash-major");
  if (!LIVE.sound) return;
  try {
    const ac = flash.ac || (flash.ac = new (window.AudioContext || window.webkitAudioContext)());
    [0, 0.18].forEach((d, k) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = level === "fatal" ? (k ? 520 : 780) : 660; o.type = "sine";
      g.gain.setValueAtTime(0.0001, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.16);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.18); });
  } catch { /* no audio */ }
}

/* ---------- listening ---------- */
async function startListening() {
  if (LIVE.playing) LIVE.playing = false;
  if (!LIVE.t0 || !LIVE.turns.length) LIVE.t0 = Date.now();
  if (LIVE.engine === "browser") {
    if (!SR_) return toast("Use Chrome or Edge for live listening, or pick Whisper");
    const r = new SR_(); r.lang = LIVE.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) { LIVE.interim = ""; addSegment(res[0].transcript); } else interim += res[0].transcript;
      }
      LIVE.interim = interim; drawTx();
    };
    r.onerror = (e) => { if (e.error === "not-allowed") { toast("Microphone blocked. Allow it in the address bar and try again."); stopListening(); } else if (e.error !== "no-speech" && e.error !== "aborted") toast("Speech: " + e.error); };
    r.onend = () => { if (LIVE.on && LIVE.engine === "browser") { try { r.start(); } catch { /* already restarting */ } } };
    LIVE.rec = r;
    try { r.start(); } catch (e) { return toast(e.message); }
  } else {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("Microphone blocked. Allow it in the address bar."); }
    LIVE.stream = stream; whisperLoop();
  }
  LIVE.on = true; LIVE.tick = setInterval(() => { const t = $("#lv-time"); if (t) t.textContent = clock(); }, 1000);
  renderLive(); toast("Listening. Speak normally; lines appear as you finish each sentence.");
}

function whisperLoop() {
  if (!LIVE.stream) return;
  const mr = new MediaRecorder(LIVE.stream), chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    if (LIVE.on) whisperLoop();
    const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" }); if (blob.size < 3000) return;
    LIVE.interim = "Transcribing…"; drawTx();
    try {
      const r = await fetch("/api/transcribe", { method: "POST", headers: { "X-Filename": "live.webm", "Content-Type": blob.type }, body: blob });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      LIVE.interim = "";
      for (const t of j.turns || []) await addSegment(t.t || t.text || "", LIVE.mode === "manual" ? null : (t.s || t.speaker));
    } catch (e) { LIVE.interim = ""; toast("Whisper: " + e.message); }
    drawTx();
  };
  LIVE.mr = mr; mr.start(); setTimeout(() => mr.state === "recording" && mr.stop(), 6000);
}

function stopListening() {
  LIVE.on = false; clearInterval(LIVE.tick);
  try { LIVE.rec?.stop(); } catch { } LIVE.rec = null;
  try { LIVE.mr?.state === "recording" && LIVE.mr.stop(); } catch { }
  LIVE.stream?.getTracks().forEach((t) => t.stop()); LIVE.stream = null;
  LIVE.interim = ""; document.body.classList.remove("live-fatal"); renderLive();
}

/* ---------- sample call, played as if live ---------- */
const SAMPLE = [
  ["AGENT", "Hello, main Neha, PolicyNest Insurance Brokers se baat kar rahi hoon. Aapne health insurance ke liye enquiry ki thi."],
  ["CUSTOMER", "Haan ji, boliye."],
  ["AGENT", "Aapko kis kis ko cover karna hai aur unki age kya hai?"],
  ["CUSTOMER", "Main aur meri wife. Main 58 ka hoon, wife 54 ki."],
  ["AGENT", "Kisi ko koi bimari ya regular dawai?"],
  ["CUSTOMER", "Haan, mujhe 4 saal se BP hai. Ye cover hoga na?"],
  ["AGENT", "Uski tension mat lijiye, sab cover hai."],
  ["CUSTOMER", "Achha. Aur claim mein koi dikkat toh nahi aayegi?"],
  ["AGENT", "Bilkul nahi sir, aapka claim 100 percent pass hoga, guarantee hai."],
  ["CUSTOMER", "Theek hai, main wife se baat karke kal batata hoon."],
  ["AGENT", "Sir ye offer sirf aaj tak hai, kal premium badh jayega. Premium 16,480 hai, link bhej rahi hoon, OTP aaye toh mujhe bata dena."],
];
async function playSample() {
  if (LIVE.on) stopListening();
  Object.assign(LIVE, { turns: [], log: [], seen: new Set(), coach: null, interim: "", ms: [], playing: true, t0: Date.now(), plan: "insurer-b-health-secure-plus" });
  renderLive();
  for (const [s, t] of SAMPLE) {
    if (!LIVE.playing) break;
    LIVE.speaker = s; drawSpeaker();
    const words = t.split(" ");
    for (let w = 1; w <= words.length && LIVE.playing; w++) { LIVE.interim = words.slice(0, w).join(" "); drawTx(); await wait(95); }
    LIVE.interim = ""; await addSegment(t, s); await wait(s === "AGENT" ? 1500 : 700);
  }
  LIVE.playing = false; renderLive();
}

/* ---------- end of call ---------- */
async function endLive() {
  if (LIVE.on) stopListening();
  LIVE.playing = false;
  const text = LIVE.turns.map((t) => `${t.s}: ${t.t}`).join("\n");
  const body = drawer(`<h2>Live call, scored</h2><p class="small muted" style="margin:6px 0 14px">The full scorecard, the policy check and what to do next.</p><div id="lv-sum"><span class="spin" style="border-color:rgba(27,36,64,.2);border-top-color:var(--ink)"></span></div>`, true);
  try {
    const r = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, use_llm: STATUS.llm }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    const pol = await runVerify(text, LIVE.plan, false).catch(() => null);
    const fixes = LIVE.log.filter((l) => l.level === "fatal");
    $("#lv-sum", body).innerHTML = `<div class="panel" style="margin-bottom:16px"><h3>Fix plan</h3>
      ${fixes.length ? `<ol class="script">${fixes.map((f) => `<li><b>${esc(f.title)}</b> <span class="small muted">(${esc(f.param)}, ${f.at})</span><div class="small">Said: <s>${esc(f.said)}</s></div><div class="better" style="margin-top:6px">${esc(f.fix)}</div></li>`).join("")}</ol>
        <p class="small" style="margin-top:10px">${j.result.sale ? "This call ended in a sale, so the customer gets a callback with the correct facts." : "If the customer buys later, they must hear the correct terms first."} Send it to the review queue so a QA auditor confirms it.</p>`
        : `<p class="small muted">No fatal errors were flagged live.</p>`}
      <div class="cta" style="margin-top:12px"><button class="btn" id="lv-q">Send to review queue</button></div></div>
      ${pol ? `<div class="panel" style="margin-bottom:16px"><h3 style="margin-bottom:8px">Against the policy wording</h3>${findingsHTML(pol, { limit: 6 })}</div>` : ""}
      ${resultBlock(j.result, j.turns, null)}`;
    animateRings(body);
    $("#lv-q", body).onclick = async () => {
      const id = "LIVE-" + new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "");
      const call = { id, agent: "Live call", agent_id: "-", team_lead: "-", team_lead_id: "-", product: "LIVE", language: "-", outcome: j.result.sale ? "SALE" : "UNKNOWN", turns: j.turns, labels: null };
      Store.set("liveQueue", [...Store.get("liveQueue", []), { id, call, s: j.result }]);
      await Trail.add("Live call sent to review", id, `score ${j.result.score}; live alerts ${LIVE.log.map((l) => l.param).join(", ") || "none"}`);
      closeDrawer(); Store.set("reviewOpen", id); location.hash = "#review";
    };
  } catch (e) { $("#lv-sum", body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

addEventListener("keydown", (e) => {
  if (location.hash !== "#live" || LIVE.mode !== "manual" || e.code !== "Space" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  e.preventDefault(); document.activeElement?.blur?.(); LIVE.speaker = LIVE.speaker === "AGENT" ? "CUSTOMER" : "AGENT"; drawSpeaker(); drawTx();
});
RENDER.live = renderLive;
