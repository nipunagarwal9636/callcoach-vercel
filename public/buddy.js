/* Live AI Sales Buddy: the agent rehearses with a simulated customer; a live coach flags risky lines as they're said. */
const BUDDY = { persona: "ramesh", turns: [], coach: null, busy: false, ai: null, voice: false, rec: null, ms: [] };
const PERSONAS_UI = {
  ramesh: { name: "Ramesh Gupta", tag: "58, has BP, Hinglish. Wants to ask his wife before buying.", plan: "Insurer B · Health Secure Plus" },
  kamla: { name: "Kamla Devi", tag: "66, diabetic, gets confused by numbers. Her daughter decides.", plan: "Insurer A · Senior Care" },
  vikram: { name: "Vikram Shah", tag: "34, switching car insurer, has 3 claim-free years. Sharp questions.", plan: "Insurer E · Car Shield comprehensive" },
};

function renderBuddy() {
  if (BUDDY.ai === null) BUDDY.ai = !!STATUS.llm;
  const el = $("#v-buddy"), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Live Sales Buddy</h2><p>Practise a call before it's real. You are the agent; the customer is simulated. The coach on the right watches every line and stops a mistake while it can still be fixed.</p></div></div>
  ${BUDDY.focus ? `<div class="focusbar"><div><span class="small">Lesson practice</span><b>${BUDDY.focus} ${esc(LESSON_RULES[BUDDY.focus].short)}</b><span class="small">${esc(LESSON_RULES[BUDDY.focus].test)} Pass = ${BUDDY.focus} met when you end the call.</span></div>
    <ul>${LESSON_RULES[BUDDY.focus].do.slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><button class="btn ghost small" id="bd-free">Free practice instead</button></div>` : ""}
  <div class="personas" ${BUDDY.focus ? "hidden" : ""}>${Object.entries(PERSONAS_UI).map(([k, p]) => `<button class="persona ${k === BUDDY.persona ? "on" : ""}" data-p="${k}"><b>${p.name}</b><span class="small">${p.tag}</span><span class="small muted">Plan to sell: ${p.plan}</span></button>`).join("")}</div>
  <div class="grid-buddy">
    <div class="panel chatp">
      <div class="chat-top"><span class="small muted" id="bd-src">${STATUS.api ? "Customer replies from a script" : "Needs the engine (dev_server.py or Vercel)"}</span>
        <span class="chat-opts"><label class="toggle" style="margin:0"><input type="checkbox" id="bd-ai" ${STATUS.llm ? "" : "disabled"} ${BUDDY.ai ? "checked" : ""}> <span class="small">AI customer${STATUS.llm ? "" : " (needs key)"}</span></label>
        <button class="btn ghost small" id="bd-reset">New call</button></span></div>
      <div class="chat" id="bd-chat"></div>
      <div class="compose"><textarea id="bd-in" rows="2" placeholder="Type what you'd say to the customer, then press Enter"></textarea>
        ${SR || STATUS.stt ? `<button class="btn ghost mic" id="bd-mic" title="Speak your line (English or Hinglish)" aria-pressed="false">🎙 Speak</button>` : ""}
        <button class="btn" id="bd-send">Say it</button></div>
      <div class="micst idle" id="bd-micst" hidden></div>
      <div class="micopts small">${SR || STATUS.stt ? `<label>Voice <select id="bd-eng">${SR ? `<option value="browser">Browser, instant captions</option>` : ""}${STATUS.stt ? `<option value="whisper">Whisper, more accurate for Hinglish</option>` : ""}</select></label>
        <label class="toggle" style="margin:0"><input type="checkbox" id="bd-auto" ${MIC.auto ? "checked" : ""}> Send when I pause</label>` : `<span class="muted">Voice input needs Chrome or Edge. You can still type.</span>`}</div>
      <div class="cta" style="margin-top:10px"><button class="btn ghost small" id="bd-end">End call and score it</button><span class="small muted" id="bd-ms"></span></div>
    </div>
    <div class="coachp" id="bd-coach"></div>
  </div>`;
  $$(".persona").forEach((b) => b.onclick = () => { BUDDY.persona = b.dataset.p; BUDDY.turns = []; renderBuddy(); });
  $("#bd-ai").onchange = (e) => { BUDDY.ai = e.target.checked; };
  $("#bd-free")?.addEventListener("click", () => { BUDDY.focus = null; BUDDY.turns = []; renderBuddy(); });
  $("#bd-reset").onclick = () => { BUDDY.turns = []; renderBuddy(); };
  $("#bd-send").onclick = () => { if (MIC.on) { MIC.final = ""; clearTimeout(MIC.timer); } sendLine(); };
  $("#bd-in").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendLine(); } };
  $("#bd-end").onclick = endCall;
  if (MIC.on) stopMic(false);
  $("#bd-mic")?.addEventListener("click", (e) => { e.currentTarget.blur(); toggleMic(SR); });
  const eng = $("#bd-eng"); if (eng) { if (MIC.engine && [...eng.options].some((o) => o.value === MIC.engine)) eng.value = MIC.engine;
    eng.onchange = () => { MIC.engine = eng.value; try { localStorage.setItem("cc:mic-engine", eng.value); } catch {} if (MIC.on) stopMic(false); }; }
  $("#bd-auto")?.addEventListener("change", (e) => { MIC.auto = e.target.checked; try { localStorage.setItem("cc:mic-auto", MIC.auto ? "1" : "0"); } catch {} });
  drawChat();
  if (!BUDDY.turns.length && STATUS.api) step(true);
  else drawCoach();
}

function drawChat() {
  const c = $("#bd-chat"); if (!c) return;
  c.innerHTML = BUDDY.turns.map((t, i) => `<div class="msg ${t.s === "AGENT" ? "me" : "them"} ${t.flag ? "flag-" + t.flag : ""}"><span class="small muted">${t.s === "AGENT" ? "You" : PERSONAS_UI[BUDDY.persona].name}</span><p>${esc(t.t)}</p>${t.flagText ? `<span class="msg-flag">${esc(t.flagText)}</span>` : ""}</div>`).join("")
    + (BUDDY.busy ? `<div class="msg them typing"><span></span><span></span><span></span></div>` : "");
  c.scrollTop = c.scrollHeight;
}

function drawCoach() {
  const k = BUDDY.coach, box = $("#bd-coach"); if (!box) return;
  if (!k) { box.innerHTML = `<div class="panel"><p class="muted small">The coach starts with your first line.</p></div>`; return; }
  const R = 46, C = 2 * Math.PI * R, col = k.meter >= 75 ? "var(--pass)" : k.meter >= 45 ? "var(--major)" : "var(--fatal)";
  const icon = { done: "✓", ok: "✓", todo: "○", fail: "✗" };
  box.innerHTML = `<div class="panel"><div class="meter"><svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R}" fill="none" stroke="#E8ECF3" stroke-width="10"/><circle cx="55" cy="55" r="${R}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - k.meter / 100)}" transform="rotate(-90 55 55)" style="transition:stroke-dashoffset .5s"/></svg><div><b>${k.meter}</b><span class="small muted">compliance so far</span></div></div>
      ${k.alerts.map((a) => `<div class="buddy-alert ${a.level}"><b>${esc(a.title)}</b><div class="small">You said: <s>${esc(a.said.slice(0, 120))}</s></div><div class="say"><span class="small muted">Say instead</span><p>${esc(a.fix)}</p><button class="linkbtn" data-say="${esc(a.fix)}">Use this line</button></div></div>`).join("")}
      ${k.nudges.length ? `<h4>Next best line</h4>${k.nudges.map((n) => `<div class="nudge ${n.urgent ? "urgent" : ""}"><span class="small"><b>${esc(n.why)}</b></span><p>${esc(n.say)}</p><button class="linkbtn" data-say="${esc(n.say)}">Use this line</button></div>`).join("")}` : ""}
      <h4>Checklist</h4><ul class="check">${k.checklist.map((c) => `<li class="${c.state}"><span class="ic">${icon[c.state]}</span><span>${c.id} ${esc(c.label)}${c.items ? `<ul>${c.items.map((x) => `<li class="${x.done ? "done" : "todo"}">${x.done ? "✓" : "○"} ${esc(x.label)}</li>`).join("")}</ul>` : ""}</span></li>`).join("")}</ul>
      ${k.plan ? `<p class="small muted">Disclosures come from the policy wording for ${esc(k.plan)}.</p>` : ""}</div>`;
  $$("[data-say]", box).forEach((b) => b.onclick = () => { $("#bd-in").value = b.dataset.say; $("#bd-in").focus(); });
}

async function step(openerOnly) {
  if (!STATUS.api) return;
  BUDDY.busy = true; drawChat();
  try {
    const t0 = performance.now();
    const r = await fetch("/api/buddy", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: BUDDY.persona, turns: BUDDY.turns.map(({ s, t }) => ({ s, t })), use_llm: BUDDY.ai, reply: true, focus: BUDDY.focus, docs: Store.get("uploads", []).map((d) => ({ id: d.id, name: d.name, text: d.text })) }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    BUDDY.coach = j.coach;
    const last = [...BUDDY.turns].reverse().find((t) => t.s === "AGENT");
    if (last && j.coach.alerts.length) { last.flag = j.coach.alerts[0].level; last.flagText = j.coach.alerts[0].title; }
    if (j.reply) BUDDY.turns.push({ s: "CUSTOMER", t: j.reply });
    BUDDY.ms.push(Math.round(performance.now() - t0));
    $("#bd-src").textContent = j.reply_source === "ai" ? `AI customer (${STATUS.provider})` : "Customer replies from a script";
    $("#bd-ms").textContent = `Coach responded in ${BUDDY.ms[BUDDY.ms.length - 1]} ms`;
  } catch (e) { toast("Buddy error: " + e.message); }
  BUDDY.busy = false; drawChat(); drawCoach();
}

function sendLine() {
  const v = $("#bd-in").value.trim(); if (!v || BUDDY.busy) return;
  BUDDY.turns.push({ s: "AGENT", t: v }); $("#bd-in").value = ""; step(false);
}

/* ---- Voice input: continuous browser speech (instant) or Whisper (more accurate). Auto-sends after a short pause. ---- */
const MIC = { on: false, r: null, final: "", timer: null, engine: null, auto: true, mr: null, stream: null, ctx: null };
try { MIC.auto = localStorage.getItem("cc:mic-auto") !== "0"; MIC.engine = localStorage.getItem("cc:mic-engine"); } catch {}

function micUI(state, text) {
  const b = $("#bd-mic"), st = $("#bd-micst"); if (!b) return;
  b.classList.toggle("live", state === "listening"); b.classList.toggle("busy", state === "working");
  b.setAttribute("aria-pressed", state === "listening" ? "true" : "false");
  b.innerHTML = state === "listening" ? "■ Stop" : state === "working" ? "…" : "🎙 Speak";
  if (st) { st.hidden = !text; st.innerHTML = text || ""; st.className = "micst " + state; }
}

function toggleMic(SR) {
  if (MIC.on) return stopMic(true);
  const engine = $("#bd-eng")?.value || "browser";
  MIC.on = true; MIC.final = ""; $("#bd-in").value = "";
  if (engine === "whisper") return startWhisper();
  startRec(SR);
}

function stopMic(sendNow) {
  MIC.on = false; clearTimeout(MIC.timer);
  if (MIC.r) { try { MIC.r.abort(); } catch {} MIC.r = null; }
  if (MIC.mr && MIC.mr.state === "recording") { MIC.sendAfter = sendNow; MIC.mr.stop(); return; }
  cleanupStream();
  micUI("idle", "");
  if (sendNow && $("#bd-in")?.value.trim()) sendLine();
}

function startRec(SR) {
  const r = new SR(); r.lang = "en-IN"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  r.onstart = () => micUI("listening", `<span class="dot"></span> Listening. Speak naturally; ${MIC.auto ? "your line is sent after a 1.5-second pause" : "press Stop or Say it when you're done"}.`);
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) MIC.final = (MIC.final + " " + tr).trim(); else interim += " " + tr;
    }
    $("#bd-in").value = (MIC.final + " " + interim).trim();
    const st = $("#bd-micst"); if (st && interim.trim()) st.innerHTML = `<span class="dot"></span> Hearing: <i>${esc(interim.trim().slice(-80))}</i>`;
    armSend();
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Microphone is blocked. Allow it from the lock icon in the address bar, then try again."); stopMic(false); }
    else if (e.error === "audio-capture") { toast("No microphone found. Plug one in or type your line."); stopMic(false); }
    else if (e.error === "network") { toast("Browser speech needs internet. Switching to Whisper may help."); }
    // "no-speech" and "aborted" are normal: onend restarts listening
  };
  r.onend = () => {
    if (MIC.on && $("#bd-mic") && MIC.r === r) { setTimeout(() => { if (MIC.on && MIC.r === r) { try { startRec(SR); } catch { stopMic(false); } } }, 150); }
  };
  MIC.r = r;
  try { r.start(); } catch { stopMic(false); }
}

function armSend() {
  clearTimeout(MIC.timer); if (!MIC.auto) return;
  MIC.timer = setTimeout(flushSpeech, 1500);
}

function flushSpeech() {
  if (!MIC.on) return;
  if (BUDDY.busy) { armSend(); return; }          // wait for the customer to finish replying
  if (!$("#bd-in").value.trim()) return;
  MIC.final = "";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (MIC.r) { const old = MIC.r; MIC.r = null; try { old.abort(); } catch {} }   // drop pending words so nothing is sent twice
  sendLine();
  if (MIC.on && SR) setTimeout(() => MIC.on && !MIC.r && startRec(SR), 200);
}

async function startWhisper() {
  try { MIC.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { toast("Microphone is blocked. Allow it from the lock icon in the address bar."); MIC.on = false; return micUI("idle", ""); }
  recordWhisperLine();
}

function recordWhisperLine() {
  if (!MIC.on || !MIC.stream) return;
  const chunks = [], mr = new MediaRecorder(MIC.stream); MIC.mr = mr; MIC.sendAfter = MIC.auto;
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" }); MIC.mr = null;
    if (blob.size > 3000 && heard) {
      micUI("working", `<span class="dot"></span> Transcribing with Whisper…`);
      try {
        const r = await fetch("/api/transcribe", { method: "POST", headers: { "X-Filename": "buddy.webm", "Content-Type": blob.type, "X-Speaker": "AGENT" }, body: blob });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
        const txt = (j.turns || []).map((t) => t.t).join(" ").trim();
        if (txt) { $("#bd-in").value = ($("#bd-in").value + " " + txt).trim(); if (MIC.sendAfter) sendLine(); }
      } catch (e) { toast("Whisper: " + e.message); }
    }
    if (MIC.on) recordWhisperLine(); else { cleanupStream(); micUI("idle", ""); if (MIC.sendAfter === true && $("#bd-in")?.value.trim()) sendLine(); }
  };
  // simple voice-activity detection: stop after 1.5 s of quiet once speech was heard (max 30 s)
  MIC.ctx = MIC.ctx || new (window.AudioContext || window.webkitAudioContext)();
  const src = MIC.ctx.createMediaStreamSource(MIC.stream), an = MIC.ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
  const buf = new Float32Array(an.fftSize); let heard = false, quietSince = 0; const t0 = Date.now();
  const tick = () => {
    if (mr.state !== "recording") return;
    an.getFloatTimeDomainData(buf); let sum = 0; for (const v of buf) sum += v * v; const rms = Math.sqrt(sum / buf.length);
    if (rms > 0.02) { heard = true; quietSince = 0; } else if (heard && !quietSince) quietSince = Date.now();
    if ((MIC.auto && heard && quietSince && Date.now() - quietSince > 1500) || Date.now() - t0 > 30000) return mr.stop();
    requestAnimationFrame(tick);
  };
  mr.start(); micUI("listening", `<span class="dot"></span> Listening (Whisper). ${MIC.auto ? "Your line is transcribed and sent when you pause." : "Press Stop when you're done."}`); tick();
}

function cleanupStream() { MIC.stream?.getTracks().forEach((t) => t.stop()); MIC.stream = null; }

async function endCall() {
  if (!BUDDY.turns.some((t) => t.s === "AGENT")) return toast("Say something first");
  const text = BUDDY.turns.map((t) => `${t.s}: ${t.t}`).join("\n");
  const body = drawer(`<h2>Your practice call, scored</h2><p class="small muted" style="margin:6px 0 14px">The same scorecard and engine as a real call.</p><div id="bd-score"><span class="spin" style="border-color:rgba(27,36,64,.2);border-top-color:var(--ink)"></span></div>`, true);
  try {
    const r = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, use_llm: BUDDY.ai }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    const avg = BUDDY.ms.length ? Math.round(BUDDY.ms.reduce((a, b) => a + b, 0) / BUDDY.ms.length) : null;
    let verdict = "";
    if (BUDDY.focus) {
      const p = BUDDY.focus, res = j.result.results[p]?.result, passed = res === "MET" && !j.result.fatal.length;
      Memory.lesson(p, { tries: (Memory.get().lessons?.[p]?.tries || 0) + 1, passed: Memory.get().lessons?.[p]?.passed || passed, history: [...(Memory.get().lessons?.[p]?.history || []), { ts: Date.now(), score: j.result.score, passed }] });
      verdict = `<div class="verdict-card ${passed ? "pass" : "fail"}"><b>${passed ? "Lesson passed" : "Not yet. Try again"}</b><span>${p} ${esc(pname(p))}: ${res === "MET" ? "met" : res === "NOT_APPLICABLE" ? "didn't come up; keep the call going until it does" : "not met"}${j.result.fatal.length && res === "MET" ? `, but the call still had a fatal error (${j.result.fatal.join(", ")})` : ""}.</span>
        <div class="cta" style="margin-top:10px"><button class="btn small" onclick="closeDrawer();practise('${p}')">Practise again</button><a class="btn ghost small" href="#coaching" onclick="closeDrawer()">Back to lessons</a></div></div>`;
    }
    Memory.update((m) => { m.practice = [...(m.practice || []), { ts: Date.now(), focus: BUDDY.focus, persona: BUDDY.persona, score: j.result.score, fatal: j.result.fatal }].slice(-50); });
    $("#bd-score", body).innerHTML = verdict + (avg ? `<p class="small muted" style="margin-bottom:10px">Average live-coach response: ${avg} ms over ${BUDDY.ms.length} lines.</p>` : "") + resultBlock(j.result, j.turns, null);
    animateRings(body);
    await Trail.add("Practice call scored", PERSONAS_UI[BUDDY.persona].name, `score ${j.result.score}, flags ${j.result.flags.join(", ") || "none"}`);
  } catch (e) { $("#bd-score", body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

RENDER.buddy = renderBuddy;

window.addEventListener("hashchange", () => { if (MIC.on && location.hash !== "#buddy") stopMic(false); });
