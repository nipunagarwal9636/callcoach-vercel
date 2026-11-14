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
  <div class="personas">${Object.entries(PERSONAS_UI).map(([k, p]) => `<button class="persona ${k === BUDDY.persona ? "on" : ""}" data-p="${k}"><b>${p.name}</b><span class="small">${p.tag}</span><span class="small muted">Plan to sell: ${p.plan}</span></button>`).join("")}</div>
  <div class="grid-buddy">
    <div class="panel chatp">
      <div class="chat-top"><span class="small muted" id="bd-src">${STATUS.api ? "Customer replies from a script" : "Needs the engine (dev_server.py or Vercel)"}</span>
        <span class="chat-opts"><label class="toggle" style="margin:0"><input type="checkbox" id="bd-ai" ${STATUS.llm ? "" : "disabled"} ${BUDDY.ai ? "checked" : ""}> <span class="small">AI customer${STATUS.llm ? "" : " (needs key)"}</span></label>
        <button class="btn ghost small" id="bd-reset">New call</button></span></div>
      <div class="chat" id="bd-chat"></div>
      <div class="compose"><textarea id="bd-in" rows="2" placeholder="Type what you'd say to the customer, then press Enter"></textarea>
        ${SR ? `<button class="btn ghost mic" id="bd-mic" title="Speak (English or Hinglish)" aria-label="Speak">🎙</button>` : ""}
        <button class="btn" id="bd-send">Say it</button></div>
      <div class="cta" style="margin-top:10px"><button class="btn ghost small" id="bd-end">End call and score it</button><span class="small muted" id="bd-ms"></span></div>
    </div>
    <div class="coachp" id="bd-coach"></div>
  </div>`;
  $$(".persona").forEach((b) => b.onclick = () => { BUDDY.persona = b.dataset.p; BUDDY.turns = []; renderBuddy(); });
  $("#bd-ai").onchange = (e) => { BUDDY.ai = e.target.checked; };
  $("#bd-reset").onclick = () => { BUDDY.turns = []; renderBuddy(); };
  $("#bd-send").onclick = sendLine;
  $("#bd-in").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendLine(); } };
  $("#bd-end").onclick = endCall;
  if (SR) $("#bd-mic").onclick = () => toggleMic(SR);
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
      body: JSON.stringify({ persona: BUDDY.persona, turns: BUDDY.turns.map(({ s, t }) => ({ s, t })), use_llm: BUDDY.ai, reply: true, docs: Store.get("uploads", []).map((d) => ({ id: d.id, name: d.name, text: d.text })) }) });
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

function toggleMic(SR) {
  if (BUDDY.rec) { BUDDY.rec.stop(); return; }
  const r = new SR(); r.lang = "en-IN"; toast("Listening. Speak one line; it sends when you pause."); r.interimResults = true; r.continuous = false;
  const b = $("#bd-mic"); b.classList.add("live");
  r.onresult = (e) => { $("#bd-in").value = [...e.results].map((x) => x[0].transcript).join(" "); };
  r.onend = () => { b.classList.remove("live"); BUDDY.rec = null; if ($("#bd-in").value.trim()) sendLine(); };
  r.onerror = (e) => toast("Mic: " + e.error);
  BUDDY.rec = r; r.start();
}

async function endCall() {
  if (!BUDDY.turns.some((t) => t.s === "AGENT")) return toast("Say something first");
  const text = BUDDY.turns.map((t) => `${t.s}: ${t.t}`).join("\n");
  const body = drawer(`<h2>Your practice call, scored</h2><p class="small muted" style="margin:6px 0 14px">The same scorecard and engine as a real call.</p><div id="bd-score"><span class="spin" style="border-color:rgba(27,36,64,.2);border-top-color:var(--ink)"></span></div>`, true);
  try {
    const r = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, use_llm: BUDDY.ai }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    const avg = BUDDY.ms.length ? Math.round(BUDDY.ms.reduce((a, b) => a + b, 0) / BUDDY.ms.length) : null;
    $("#bd-score", body).innerHTML = (avg ? `<p class="small muted" style="margin-bottom:10px">Average live-coach response: ${avg} ms over ${BUDDY.ms.length} lines.</p>` : "") + resultBlock(j.result, j.turns, null);
    animateRings(body);
    await Trail.add("Practice call scored", PERSONAS_UI[BUDDY.persona].name, `score ${j.result.score}, flags ${j.result.flags.join(", ") || "none"}`);
  } catch (e) { $("#bd-score", body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

RENDER.buddy = renderBuddy;
