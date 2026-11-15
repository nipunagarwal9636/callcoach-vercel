/* CallCoach QA: static front end. Data from /data/*.json, live scoring from /api/*. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x, d = 0) => (x == null ? "n/a" : (x * 100).toFixed(d) + "%");
const D = {};
let STATUS = { llm: false, stt: false, api: false };
const SEV_COLOR = { FATAL: "var(--fatal)", MAJOR: "var(--major)", MINOR: "var(--minor)", NONE: "var(--pass)" };

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 3200);
}
async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }

/* ---------------- result helpers ---------------- */
function chipFor(r) {
  if (r.result === "NOT_MET") return `<span class="chip ${r.severity}">Not met, ${r.severity.toLowerCase()}</span>`;
  if (r.result === "REVIEW") return `<span class="chip REVIEW">Human review</span>`;
  if (r.result === "MET") return `<span class="chip MET">Met</span>`;
  return `<span class="chip NA">Not applicable</span>`;
}
function ring(score, severity) {
  const R = 64, C = 2 * Math.PI * R, col = score === 0 ? "var(--fatal)" : score < 70 ? "var(--major)" : "var(--pass)";
  return `<div class="ring"><svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="${R}" fill="none" stroke="#E8ECF3" stroke-width="12"/>
  <circle class="fg" cx="75" cy="75" r="${R}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - score / 100)}"/></svg>
  <div class="val"><div><b>${score}</b><span>out of 100</span></div></div></div>`;
}
function animateRings(root) { requestAnimationFrame(() => setTimeout(() => $$("circle.fg", root).forEach((c) => (c.style.strokeDashoffset = c.dataset.off)), 40)); }

function routes(s) {
  const out = [];
  if (s.fatal?.length) out.push(`<span class="chip FATAL">Fatal: ${s.fatal.join(", ")}, score set to 0</span>`);
  if (s.review?.length) out.push(`<span class="chip REVIEW">Human review: ${s.review.join(", ")}</span>`);
  if (s.callback_needed) out.push(`<span class="chip ink">Customer call-back</span>`);
  if (s.conduct_alert) out.push(`<span class="chip FATAL">Conduct alert, turn ${s.conduct_alert.turn}</span>`);
  if (!out.length) out.push(`<span class="chip MET">No fatal issues</span>`);
  return out.join("");
}

function scorecardHTML(s, labels) {
  return `<div class="params">${D.scorecard.map((p) => {
    const r = s.results[p.id], bad = r.result === "NOT_MET", rev = r.result === "REVIEW";
    let truth = "";
    if (labels) {
      const got = rev ? "NOT_MET" : r.result, ok = got === labels[p.id];
      truth = `<span class="truth ${ok ? "ok" : "no"}">${ok ? "Matches label" : "Label: " + labels[p.id].replace("_", " ").toLowerCase()}</span>`;
    }
    const ev = (bad || rev) && r.quote ? `<div class="ev"><span class="tn">Turn ${esc((r.turns || []).join(", "))}</span><mark>${esc(r.quote)}</mark></div>` : "";
    const pts = p.points == null ? "fatal" : p.points + " pts";
    return `<div class="prow ${bad ? "bad" : rev ? "rev" : ""}"><div class="pid">${p.id}</div>
      <div><div class="pname">${esc(p.name)} <span class="small muted">${pts}</span></div>${ev}<div class="why">${esc(r.reason)}${r.source ? ` <span class="muted">(${esc(r.source)})</span>` : ""}</div></div>
      <div class="right">${chipFor(r)}${truth}</div></div>`;
  }).join("")}</div>`;
}

function transcriptHTML(turns, s) {
  const bad = {};
  for (const p of D.scorecard) {
    const r = s.results[p.id];
    if (r.result === "NOT_MET" || r.result === "REVIEW") (r.turns || []).forEach((t) => (bad[t] = bad[t] || []).push(p.id));
  }
  if (s.conduct_alert) (bad[s.conduct_alert.turn] = bad[s.conduct_alert.turn] || []).push("OTP");
  return `<div class="tx">${turns.map((t) => {
    const b = bad[t.n], sp = t.s === "AGENT" ? "Agent" : "Customer";
    const tags = b ? `<span class="tags">${[...new Set(b)].map((x) => `<span class="chip ${x === "OTP" || D.scorecard.find((p) => p.id === x)?.severity === "FATAL" ? "FATAL" : "MAJOR"}">${x}</span>`).join(" ")}</span>` : "";
    return `<div class="t ${t.s === "AGENT" ? "a" : "c"}"><span class="no">${t.n}</span><div><span class="sp">${sp}${tags}</span><span class="body">${b && t.s === "AGENT" ? `<mark>${esc(t.t)}</mark>` : esc(t.t)}</span></div></div>`;
  }).join("")}</div>`;
}

function resultBlock(s, turns, labels, extra = "") {
  const nFail = D.scorecard.filter((p) => s.results[p.id].result === "NOT_MET").length;
  return `<div class="panel"><div class="verdict-head">${ring(s.score, s.severity)}<div style="flex:1;min-width:220px">
      <h3>${s.fatal?.length ? "Fatal error found" : nFail ? `${nFail} parameter${nFail > 1 ? "s" : ""} to coach` : "Clean call"}</h3>
      <p class="small muted" style="margin-top:4px">Scored by ${s.mode === "hybrid" ? "rules and the AI judge" : "the rule layer"}${s.seconds ? ` in ${s.seconds.toFixed(1)} s` : ""}.${s.llm_error ? " AI judge error: " + esc(s.llm_error) : ""}</p>
      <div class="routes">${routes(s)}</div></div></div>
    ${s.conduct_alert ? `<div class="alert"><b>Conduct alert.</b> ${esc(s.conduct_alert.reason)}: “${esc(s.conduct_alert.quote)}”</div>` : ""}
    ${scorecardHTML(s, labels)}</div>
    <div class="panel" style="margin-top:20px"><h3 style="margin-bottom:12px">Transcript, evidence marked</h3>${transcriptHTML(turns, s)}${extra}</div>`;
}

/* ---------------- overview ---------------- */
function heroReplay() {
  const call = D.calls.find((c) => c.id === "QT-092");
  const box = $("#replay"), stamp = $("#stamp"), verdict = $("#verdict");
  clearTimeout(heroReplay.h); (heroReplay.timers || []).forEach(clearTimeout); heroReplay.timers = [];
  stamp.classList.remove("go"); verdict.style.opacity = 0;
  if (!call) return;
  const show = call.turns.filter((t) => t.n >= 7 && t.n <= 14);
  box.innerHTML = show.map((t) => `<div class="line ${t.s === "AGENT" ? "ag" : "cust"}" data-n="${t.n}"><span class="who">${t.s === "AGENT" ? "Agent" : "Customer"}, ${t.n}</span><span class="txt">${t.n === 14 ? `<span class="hl hl-anim" id="ev">${esc(t.t)}</span>` : esc(t.t)}</span></div>`).join("");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lines = $$(".line", box), T = (f, ms) => heroReplay.timers.push(setTimeout(f, reduce ? 0 : ms));
  lines.forEach((l, i) => T(() => l.classList.add("in"), 250 + i * 420));
  const end = 250 + lines.length * 420;
  T(() => $("#ev")?.classList.add("go"), end + 200);
  T(() => stamp.classList.add("go"), end + 1100);
  T(() => (verdict.style.opacity = 1), end + 1500);
}

function renderOverview() {
  if (!D.eval?.rules?.eval) { heroReplay(); return; }
  const r = D.eval.rules?.eval?.overall, h = D.eval.hybrid?.eval?.overall;
  const o = h || r, stz = (D.eval.hybrid || D.eval.rules)?.stress || [];
  const sc = (D.eval.hybrid || D.eval.rules)?.scenarios || [];
  $("#ov-strip").innerHTML = [
    [`${Math.round(o.fatal_call_recall * o.fatal_calls)} / ${o.fatal_calls}`, "fatal calls caught (target 90%)"],
    [pct(o.flag_precision), "of flags are real (target 80%)"],
    [`${sc.filter((x) => x.passed).length} / ${sc.length}`, "brief test scenarios passed"],
    [`${stz.filter((x) => x.correct).length} / ${stz.length}`, `reworded stress checks, ${h ? "rules and AI" : "rules alone"}`],
  ].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
  setTimeout(() => $("#hero-hl").classList.add("go"), 300);
  heroReplay();
}

/* ---------------- demo ---------------- */
let demoSrc = "labelled";
function toText(turns) { return turns.map((t) => `${t.s}: ${t.t}`).join("\n"); }
function fillPick() {
  const sel = $("#pick");
  if (demoSrc === "labelled") {
    const fav = ["QT-092", "QT-041", "QT-033", "QT-016", "QT-001"];
    const rank = (id) => (fav.includes(id) ? fav.indexOf(id) : 99);
    const ordered = [...D.calls].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
    sel.innerHTML = ordered.map((c) => `<option value="${c.id}">${c.id}: ${esc(c.agent)}, ${c.product.replace("_", " ").toLowerCase()}, ${c.language}${fav.includes(c.id) ? " (featured)" : ""}</option>`).join("");
  } else {
    sel.innerHTML = D.stress.map((s) => `<option value="${s.id}">${s.id}: ${esc(s.about)}</option>`).join("");
  }
  loadPick();
}
function loadPick() {
  const id = $("#pick").value;
  if (demoSrc === "labelled") { const c = D.calls.find((x) => x.id === id); $("#tx").value = toText(c.turns); $("#demo-note").textContent = `Labelled by the problem owner: true score ${c.true_score}. The scorecard shows where we match the label.`; }
  else { const s = D.stress.find((x) => x.id === id); $("#tx").value = s.transcript; $("#demo-note").textContent = "Hand-written to reword a violation. Expected: " + Object.entries(s.expected || {}).map(([k, v]) => `${k} ${String(v).replace("_", " ").toLowerCase()}`).join(", "); }
}

async function scoreDemo() {
  const btn = $("#score-btn"), out = $("#demo-out"), text = $("#tx").value.trim();
  if (!text) return toast("Paste a transcript first, one line per turn");
  btn.disabled = true; btn.innerHTML = `<span class="spin"></span> Scoring`;
  const useLLM = $("#use-llm").checked;
  const lab = demoSrc === "labelled" ? D.calls.find((c) => c.id === $("#pick").value) : null;
  const unchanged = lab && text === toText(lab.turns).trim();
  try {
    let s, turns, masked = "";
    if (STATUS.api) {
      const r = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: text, use_llm: useLLM }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      s = j.result; turns = j.turns; masked = j.masked;
    } else if (unchanged) {
      s = lab.scored[D.modes[0]]; turns = lab.turns;
      toast("Engine offline, showing the saved result for this call");
    } else throw new Error("The scoring engine isn't reachable. Run the app with dev_server.py or deploy to Vercel.");
    const extra = masked ? `<details class="mask"><summary>What the AI judge sees (masked)</summary><pre>${esc(masked)}</pre></details>` : "";
    out.innerHTML = resultBlock(s, turns, unchanged ? lab.labels : null, extra);
    animateRings(out);
    if (window.afterScore) window.afterScore(out, s, turns, text, lab && unchanged ? lab : null);
    if (innerWidth < 1020) out.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    out.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  } finally { btn.disabled = false; btn.textContent = "Score this call"; }
}

async function transcribe(file) {
  if (!file) return;
  if (file.size > 4.2e6) return toast("That file is over 4 MB. Trim it or use a shorter role-play.");
  $("#demo-note").textContent = "Transcribing and labelling speakers…";
  try {
    const r = await fetch("/api/transcribe", { method: "POST", headers: { "X-Filename": file.name, "Content-Type": file.type || "application/octet-stream" }, body: file });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    $("#tx").value = j.transcript; $("#demo-note").textContent = `Transcribed ${j.turns?.length || 0} turns. Check the speaker labels, then score.`;
  } catch (e) { $("#demo-note").textContent = "Couldn't transcribe: " + e.message; }
}

/* ---------------- flags ---------------- */
function renderFlags() {
  const mode = D.modes[0];
  const rows = D.calls.filter((c) => !window.roleSeesCall || roleSeesCall(c)).map((c) => ({ c, s: c.scored[mode] })).sort((a, b) => b.s.priority - a.s.priority || a.s.score - b.s.score);
  const n = rows.length, fatal = rows.filter((r) => r.s.fatal.length).length;
  const fatalSale = rows.filter((r) => r.s.fatal.length && r.c.outcome === "SALE").length;
  const conduct = rows.filter((r) => r.s.conduct_alert).length;
  const review = rows.filter((r) => r.s.review.length).length;
  const avg = rows.reduce((a, r) => a + r.s.score, 0) / n;
  $("#flag-kpis").innerHTML = [[n, "calls scored", ""], [fatal, "fatal calls", "fatal"], [fatalSale, "fatal and sold: call back", "fatal"],
    [conduct, "OTP or card asks", "major"], [review, "need a human", "review"], [avg.toFixed(0), "average score", "pass"]]
    .map(([b, s, k]) => `<div class="kpi ${k}"><b>${b}</b><span>${s}</span></div>`).join("");
  const urgent = rows.filter((r) => r.s.conduct_alert);
  $("#flag-alert").innerHTML = conduct ? `<div class="alert"><b>${conduct} call${conduct > 1 ? "s" : ""} where the agent asked for an OTP or card detail.</b> These skip the list below and go straight to the team lead and compliance. Open one:
    <div class="alert-calls">${urgent.map(({ c, s }) => `<button class="chip FATAL" data-urgent="${c.id}">${c.id}, ${esc(c.agent)}, score ${s.score}</button>`).join(" ")}</div></div>` : "";
  $$("[data-urgent]").forEach((b) => b.onclick = () => openCallAny(b.dataset.urgent));
  const tls = [...new Map(D.calls.map((c) => [c.team_lead_id, c.team_lead])).entries()].sort();
  if (!$("#f-tl").options.length) $("#f-tl").innerHTML = `<option value="">All teams</option>` + tls.map(([id, nm]) => `<option value="${id}">${esc(nm)} (${id})</option>`).join("");
  const tl = $("#f-tl").value, sev = $("#f-sev").value;
  const list = rows.filter((r) => !r.s.conduct_alert && (!tl || r.c.team_lead_id === tl) && (sev === "all" || (sev === "FATAL" ? r.s.fatal.length : r.s.flags.length)));
  $("#f-count").textContent = `${list.length} call${list.length === 1 ? "" : "s"}`;
  $("#qlist").innerHTML = list.slice(0, 80).map(({ c, s }) => {
    const top = s.top_issue ? s.results[s.top_issue] : null, p = s.top_issue ? D.scorecard.find((x) => x.id === s.top_issue) : null;
    const tags = [s.fatal.length && c.outcome === "SALE" ? `<span class="chip ink">Call back</span>` : "", s.conduct_alert ? `<span class="chip FATAL">OTP ask</span>` : "", c.complaint ? `<span class="chip MAJOR">Complained</span>` : "", c.free_look ? `<span class="chip MINOR">Free-look cancel</span>` : ""].join(" ");
    return `<details class="qitem" data-id="${c.id}"><summary><span class="sev" style="background:${SEV_COLOR[s.severity] || "var(--na)"}"></span>
      <div><div class="nm">${esc(c.agent)}</div><div class="sub">${c.id}, ${esc(c.team_lead)}</div></div>
      <div class="mid"><div class="small">${c.product.replace("_", " ").toLowerCase()}, ${c.language}</div><div class="sub">${c.outcome.toLowerCase().replace("_", " ")}</div></div>
      <div class="iss">${p ? `<b>${p.id} ${esc(p.name)}</b><br><span class="muted small">“${esc((top.quote || top.reason).slice(0, 110))}”</span>` : `<span class="muted">No issues</span>`} <div style="margin-top:4px">${tags}</div></div>
      <div class="sc" style="color:${SEV_COLOR[s.severity]}">${s.score}</div></summary><div class="open"></div></details>`;
  }).join("") || `<div class="empty">No calls match. Try another team or show all calls.</div>`;
  $$(".qitem").forEach((d) => d.addEventListener("toggle", () => {
    if (!d.open || d.dataset.done) return; d.dataset.done = 1;
    const c = D.calls.find((x) => x.id === d.dataset.id);
    $(".open", d).innerHTML = `<div class="grid2" style="margin-top:12px"><div>${scorecardHTML(c.scored[mode], c.labels)}</div><div class="panel" style="align-self:start">${transcriptHTML(c.turns, c.scored[mode])}</div></div>`;
  }));
}

/* ---------------- coaching ---------------- */
let coScope = "agents";
function fillCoachWho() {
  const src = D.coach[coScope];
  const entries = Object.entries(src).sort((a, b) => coScope === "agents" ? (b[1].fatal - a[1].fatal) || a[1].name.localeCompare(b[1].name) : a[0].localeCompare(b[0]));
  $("#co-who-l").firstChild.textContent = coScope === "agents" ? "Agent" : "Team";
  $("#co-who").innerHTML = entries.filter(([, v]) => Object.keys(v.modules).length).map(([id, v]) => `<option value="${id}">${esc(v.name)} (${id})${coScope === "agents" && v.fatal ? `, ${v.fatal} fatal` : ""}</option>`).join("");
  fillCoachParam();
}
function fillCoachParam() {
  const v = D.coach[coScope][$("#co-who").value]; if (!v) return;
  const ps = Object.keys(v.modules).sort((a, b) => D.order.indexOf(a) - D.order.indexOf(b));
  const def = coScope === "agents" && v.auto in v.modules ? v.auto : ps.sort((a, b) => (v.shared?.[b] || 0) - (v.shared?.[a] || 0))[0];
  $("#co-param").innerHTML = D.order.filter((p) => ps.includes(p)).map((p) => { const sc = D.scorecard.find((x) => x.id === p); return `<option value="${p}" ${p === def ? "selected" : ""}>${p} ${esc(sc.theme)}${sc.severity === "FATAL" ? " (fatal)" : ""}</option>`; }).join("");
  renderLesson();
}
function renderLesson(mod) {
  const v = D.coach[coScope][$("#co-who").value]; if (!v) return;
  const m = mod || v.modules[$("#co-param").value]; if (!m) return;
  const sc = D.scorecard.find((x) => x.id === m.param);
  const ex = (m.excerpts || []).map((e) => `<div class="said"><span class="small muted">${e.call}</span><br>${e.lines.map(([n, sp, t]) => `<span class="${sp === "AGENT" ? "" : "c"}"><span class="small muted">${n} ${sp === "AGENT" ? "Agent" : "Customer"}:</span> ${sp === "AGENT" ? `<mark>${esc(t)}</mark>` : esc(t)}</span>`).join("<br>")}</div>`).join("");
  $("#lesson").innerHTML = `<div class="lesson"><div class="lesson-head"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><span class="chip ${sc.severity === "FATAL" ? "FATAL" : sc.severity}">${m.param} ${sc.severity === "FATAL" ? "fatal" : sc.severity.toLowerCase()}</span><span class="chip REVIEW">${esc(m.status || "Draft")}</span></div>
    <h2>${esc(m.title)}</h2><p>${esc(m.objective)}</p></div><div class="lesson-body">
    ${m.feedback ? `<div class="step"><span class="k">✦</span><div><h3>Note from your coach</h3><p>${esc(m.feedback)}</p></div></div>` : ""}
    <div class="step"><span class="k">1</span><div><h3>Why it matters</h3><p>${esc(m.why)}</p></div></div>
    <div class="step"><span class="k">2</span><div><h3>The rule</h3><p>${esc(m.rule)}</p></div></div>
    <div class="step"><span class="k">3</span><div><h3>${coScope === "agents" ? "What you said" : "What the team said"}</h3>${ex || `<p class="muted">No excerpt.</p>`}</div></div>
    <div class="step"><span class="k">4</span><div><h3>Say this instead</h3><div class="better">${esc(m.better)}</div>${m.better_alt ? `<div class="better" style="margin-top:8px">${esc(m.better_alt)}</div>` : ""}</div></div>
    <div class="step"><span class="k">5</span><div><h3>Practise</h3><p>${esc(m.practice)}</p></div></div>
    <div class="step"><span class="k">6</span><div><h3>How we'll know it worked</h3><p>${esc(m.measure)}</p>${m.root_cause ? `<div class="cause"><b>Likely root cause.</b> ${esc(m.root_cause)}</div>` : ""}</div></div>
    <p class="small muted" style="margin-top:10px">Written by ${esc(m.generated_by || "template")}.${m.guardrail?.length ? " Guardrail removed: " + esc(m.guardrail.join(", ")) : " Passed the pressure-language guardrail."}</p>
    </div></div>`;
}
async function personalise() {
  if (!STATUS.llm) return toast("Add LLM_PROVIDER and LLM_API_KEY on the server to switch on AI coaching");
  const v = D.coach[coScope][$("#co-who").value], m = v.modules[$("#co-param").value];
  const b = $("#co-ai"); b.disabled = true; b.innerHTML = `<span class="spin" style="border-color:rgba(27,36,64,.25);border-top-color:var(--ink)"></span> Writing`;
  try {
    const r = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: m }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    renderLesson(j.module); toast("Personalised. Still a draft until Quality signs it off.");
  } catch (e) { toast("Couldn't personalise: " + e.message); }
  finally { b.disabled = false; b.textContent = "Personalise with AI"; }
}

/* ---------------- patterns ---------------- */
let charts = {};
function renderPatterns() {
  const P = D.patterns, max = P.funnel[0].n;
  $("#funnel").innerHTML = P.funnel.map((f, i) => `<div class="fstep"><span class="small">${esc(f.stage)}</span><div class="track"><div class="fill" style="width:${Math.max(0.6, (f.n / max) * 100)}%;opacity:${1 - i * 0.12}"></div></div><b>${f.n.toLocaleString("en-IN")}</b></div>`).join("") +
    `<p class="small muted" style="margin-top:6px">Of every 18,300 calls with a fatal error, about 108 lead to coaching. CallCoach scores all of them.</p>`;
  $("#findings").innerHTML = P.findings.map((f) => `<div class="finding"><h3>${esc(f.title)}</h3><p class="ev">${esc(f.evidence)}</p><dl><dt>Likely cause</dt><dd>${esc(f.cause)}</dd><dt>What we'd do</dt><dd>${esc(f.action)}</dd></dl></div>`).join("");
  const bar = (x, mx, col) => `<span class="minibar" style="width:${Math.round((x / mx) * 60)}px;background:${col}"></span>${pct(x)}`;
  const mx = (k) => Math.max(...P.teams.map((t) => t[k] || 0));
  $("#teams").innerHTML = `<thead><tr><th>Team</th><th class="num">Audits</th><th>Disclosure fails</th><th>Pressure</th><th>Fatal</th><th class="num">Avg score</th><th class="num">Complaints per 1,000 sales</th><th class="num">Uncertified</th></tr></thead><tbody>` +
    P.teams.map((t) => `<tr><td><b>${t.id}</b> ${esc(t.team_lead)}</td><td class="num">${t.audits}</td><td>${bar(t.disclosure_fail, mx("disclosure_fail"), "var(--fatal)")}</td><td>${bar(t.pressure_fail, mx("pressure_fail"), "var(--major)")}</td><td>${bar(t.fatal, mx("fatal"), "var(--fatal)")}</td><td class="num">${t.avg_score.toFixed(0)}</td><td class="num">${(t.complaints_per_1000_sales ?? 0).toFixed(1)}</td><td class="num">${t.uncertified_agents ?? 0}</td></tr>`).join("") + `</tbody>`;
  $("#tenure").innerHTML = `<thead><tr><th>Tenure</th><th class="num">Audits</th><th class="num">Disclosure</th><th class="num">Pressure</th><th class="num">Fatal</th></tr></thead><tbody>` +
    P.tenure.map((t) => `<tr><td>${esc(t.band)}</td><td class="num">${t.audits}</td><td class="num">${pct(t.disclosure_fail)}</td><td class="num">${pct(t.pressure_fail)}</td><td class="num">${pct(t.fatal)}</td></tr>`).join("") + `</tbody>`;
  if (!window.Chart || charts.month) return;
  Chart.defaults.font.family = "Instrument Sans, system-ui, sans-serif"; Chart.defaults.color = "#4A5571";
  const me = P.month_end, keys = [["P7_fail", "Pressure (P7)"], ["P6_fail", "False promise (P6)"], ["free_look_rate", "Free-look cancels"]];
  charts.month = new Chart($("#ch-month"), { type: "bar", data: { labels: keys.map((k) => k[1]), datasets: [
    { label: "Rest of the month", data: keys.map((k) => me.rest[k[0]] * 100), backgroundColor: "#B9C3D8", borderRadius: 6 },
    { label: "Last 7 days", data: keys.map((k) => me.last7[k[0]] * 100), backgroundColor: "#D6453D", borderRadius: 6 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%` } } }, scales: { y: { ticks: { callback: (v) => v + "%" }, grid: { color: "#EEF1F6" } }, x: { grid: { display: false } } } } });
  charts.aud = new Chart($("#ch-aud"), { type: "bar", data: { labels: P.auditors.map((a) => a.id), datasets: [{ label: "Marked fatal", data: P.auditors.map((a) => a.fatal_rate * 100), backgroundColor: P.auditors.map((a) => a.fatal_rate > 0.15 ? "#D6453D" : a.fatal_rate < 0.08 ? "#3E6FD8" : "#B9C3D8"), borderRadius: 6 }] },
    options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.raw.toFixed(1)}% of ${P.auditors[c.dataIndex].audits} audits` } } }, scales: { x: { ticks: { callback: (v) => v + "%" }, grid: { color: "#EEF1F6" } }, y: { grid: { display: false } } } } });
}

/* ---------------- results ---------------- */
let resMode;
function renderResults() {
  const modes = ["hybrid", "rules"].filter((m) => D.eval[m]);
  resMode = resMode || modes[0];
  $("#res-seg").hidden = modes.length < 2;
  $("#res-seg").innerHTML = modes.length > 1 ? modes.map((m) => `<button data-m="${m}" class="${m === resMode ? "on" : ""}">${m === "hybrid" ? "Rules and AI judge" : "Rule layer only"}</button>`).join("") : "";
  const E = D.eval[resMode], o = E.eval.overall;
  const T = [[o.fatal_call_recall, 0.9, "Fatal calls caught", `${o.fatal_calls - o.fatal_calls_missed.length} of ${o.fatal_calls}. Target 90% or more`, true],
    [o.flag_precision, 0.8, "Flags that are real", "Target 80% or more", true],
    [o.parameter_agreement, 0.85, "Agreement with labels", "Per parameter. Target 85% or more", true],
    [o.score_mae, 8, "Score error", "Mean points off the true score. Target 8 or less", false]];
  $("#targets").innerHTML = T.map(([v, g, name, goal, up]) => {
    const ok = up ? v >= g : v <= g, w = up ? v * 100 : Math.max(4, 100 - (v / 20) * 100), gx = up ? g * 100 : 100 - (g / 20) * 100;
    return `<div class="target"><span class="small">${name}</span><b style="color:${ok ? "var(--pass)" : "var(--fatal)"}">${up ? pct(v, 1) : v.toFixed(1)}</b><div class="gauge"><i style="width:${w}%;background:${ok ? "var(--pass)" : "var(--fatal)"}"></i><u style="left:${gx}%"></u></div><div class="goal">${goal}</div></div>`;
  }).join("");
  $("#pp").innerHTML = `<thead><tr><th>Parameter</th><th>Severity</th><th class="num">Failures</th><th class="num">Caught</th><th class="num">Missed</th><th class="num">False flags</th><th class="num">Precision</th><th class="num">Recall</th></tr></thead><tbody>` +
    D.scorecard.map((p) => { const v = o.per_param[p.id]; return `<tr><td><b>${p.id}</b> ${esc(p.name)}</td><td><span class="chip ${p.severity}">${p.severity.toLowerCase()}</span></td><td class="num">${v.support}</td><td class="num">${v.tp}</td><td class="num">${v.fn}</td><td class="num">${v.fp}</td><td class="num">${v.precision == null ? "n/a" : v.precision.toFixed(2)}</td><td class="num">${v.recall == null ? "n/a" : v.recall.toFixed(2)}</td></tr>`; }).join("") + `</tbody>`;
  $("#scen").innerHTML = `<thead><tr><th>Test</th><th>Scenario</th><th>Result</th></tr></thead><tbody>` +
    E.scenarios.map((s) => `<tr><td><b>${s.id}</b></td><td>${esc(s.scenario)}<div class="small muted">${esc(s.detail)}</div></td><td>${s.passed ? `<span class="tick">Pass</span>` : `<span class="cross">Fail</span>`}</td></tr>`).join("") + `</tbody>`;
  const fr = [];
  for (const [g, d] of [["Language", E.eval.by_language], ["Agent gender", E.eval.by_agent_gender]]) for (const [k, v] of Object.entries(d)) fr.push([`${g}: ${k === "F" ? "female" : k === "M" ? "male" : k}`, v]);
  $("#fair").innerHTML = `<thead><tr><th>Group</th><th class="num">Calls</th><th class="num">Fatal recall</th><th class="num">Agreement</th><th class="num">Score error</th></tr></thead><tbody>` +
    fr.map(([k, v]) => `<tr><td>${k}</td><td class="num">${v.n_calls}</td><td class="num">${pct(v.fatal_call_recall, 1)}</td><td class="num">${pct(v.parameter_agreement, 1)}</td><td class="num">${v.score_mae.toFixed(1)}</td></tr>`).join("") + `</tbody>`;
  const tok = E.eval.avg_tokens || {}, pin = tok.prompt || 3200, pout = tok.completion || 900, inr = 85;
  const llm = (pin * 0.3 + pout * 2.5) / 1e6 * inr, stt = (7 / 60) * 0.04 * inr;
  $("#cost").innerHTML = `<tbody><tr><td>Rule layer</td><td class="num">₹0</td><td class="small muted">Runs in milliseconds</td></tr>
    <tr><td>AI judge</td><td class="num">₹${llm.toFixed(2)}</td><td class="small muted">Gemini 2.5 Flash, ${tok.prompt ? "measured" : "about"} ${Math.round(pin).toLocaleString()} in, ${Math.round(pout)} out tokens</td></tr>
    <tr><td>Speech-to-text</td><td class="num">₹${stt.toFixed(2)}</td><td class="small muted">Whisper on Groq, 7-minute call</td></tr>
    <tr><td><b>Total per call</b></td><td class="num"><b>₹${(llm + stt).toFixed(2)}</b></td><td class="small muted">Target under ₹3. List prices, may change.</td></tr></tbody>`;
  const all = ["rules", "hybrid"].filter((m) => D.eval[m]).map((m) => { const s = D.eval[m].stress; return `<span class="chip ${m === resMode ? "ink" : "NA"}">${m === "hybrid" ? "Rules and AI" : "Rules"}: ${s.filter((x) => x.correct).length} / ${s.length}</span>`; }).join(" ");
  $("#stress-score").innerHTML = all;
  $("#stress").innerHTML = `<thead><tr><th>Case</th><th>What it rewords</th><th>Check</th><th>Expected</th><th>Got</th><th></th></tr></thead><tbody>` +
    E.stress.map((s) => `<tr><td><b>${s.case}</b></td><td>${esc(s.about)}<div class="small muted">${esc(s.reason)}</div></td><td>${s.param}</td><td>${s.expected.replace("_", " ").toLowerCase()}</td><td>${s.got.replace("_", " ").toLowerCase()}</td><td>${s.correct ? `<span class="tick">✓</span>` : `<span class="cross">✗</span>`}</td></tr>`).join("") + `</tbody>`;
  if (!D.eval.hybrid) $("#stress").insertAdjacentHTML("afterend", "");
}

/* ---------------- router + boot ---------------- */
const RENDER = { overview: renderOverview, demo: () => {}, flags: renderFlags, coaching: () => {}, results: renderResults };
const ALWAYS = new Set(["overview"]);
const ONBOOT = [];
const rendered = {};
function route() {
  const v = (location.hash || "#overview").slice(1), view0 = RENDER[v] ? v : "overview";
  const view = window.roleGuard ? roleGuard(view0) : view0;
  if (view !== v) { history.replaceState(null, "", "#" + view); }
  $$(".view").forEach((s) => s.classList.toggle("on", s.id === "v-" + view));
  $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.v === view));
  if (!rendered[view] || ALWAYS.has(view)) { RENDER[view](); rendered[view] = 1; }
  scrollTo({ top: 0 });
  window.onRoute?.(view);
}

async function boot() {
  if (!Auth.ok()) { document.body.classList.add("ready"); await Auth.showLogin(); document.body.classList.remove("ready"); }
  const _ur = Auth.user().role, _deny = { patterns: ["agent"], evaluation: ["agent", "tl"], stress: ["agent", "tl"] };
  const get = (n, fb) => (_deny[n]?.includes(_ur) ? Promise.resolve(fb) : Auth.api(`/api/data?name=${n}`)).catch((e) => { if (fb !== undefined && e.status !== 401) return fb; throw e; });
  const [scorecard, calls, coach, patterns, ev, stress, agents, policies] = await Promise.all([
    get("scorecard"), get("calls"), get("coaching"), get("patterns", { sizing: {}, funnel: [{ n: 1 }], findings: [], teams: [], month_end: { rest: {}, last7: {} }, auditors: [], tenure: [], product: [] }),
    get("evaluation", {}), get("stress", []), get("agents"), get("policies")]);
  Object.assign(D, { scorecard, calls: calls.calls, modes: calls.modes, coach, patterns, eval: ev, stress, agents, policies, order: scorecard.map((p) => p.id) });

  try {
    const r = await fetch("/api/status"); if (!r.ok) throw 0;
    STATUS = { ...(await r.json()), api: true };
  } catch { STATUS = { llm: false, stt: false, api: false }; }
  $("#led").classList.toggle("on", STATUS.api);
  $("#status-text").textContent = !STATUS.api ? "Saved results (engine offline)" : STATUS.llm ? `Rules and AI judge on, ${STATUS.model}` : "Rule layer on, AI judge off";
  const ll = $("#use-llm"); ll.disabled = !STATUS.llm; ll.checked = !!STATUS.llm;
  $("#llm-label").textContent = STATUS.llm ? `Use the AI judge as well as rules (${STATUS.provider})` : "AI judge off: add LLM_PROVIDER and LLM_API_KEY on Vercel to switch it on";

  // demo wiring
  $$("#src-seg button").forEach((b) => b.addEventListener("click", () => {
    $$("#src-seg button").forEach((x) => x.classList.toggle("on", x === b)); demoSrc = b.dataset.s;
    const audio = demoSrc === "audio"; $("#audio-wrap").hidden = !audio; $("#pick-wrap").hidden = audio;
    if (audio) { $("#tx").value = ""; $("#demo-note").textContent = STATUS.stt ? "Upload a role-play recording. We transcribe it and label who is speaking." : "Audio needs STT_PROVIDER and STT_API_KEY on the server. You can still paste a transcript."; }
    else fillPick();
  }));
  $("#pick").addEventListener("change", loadPick);
  $("#audio").addEventListener("change", (e) => transcribe(e.target.files[0]));
  $("#score-btn").addEventListener("click", scoreDemo);
  fillPick();

  $("#f-tl").addEventListener("change", renderFlags); $("#f-sev").addEventListener("change", renderFlags);
  $$("#co-seg button").forEach((b) => b.addEventListener("click", () => { $$("#co-seg button").forEach((x) => x.classList.toggle("on", x === b)); coScope = b.dataset.s; fillCoachWho(); }));
  $("#co-who").addEventListener("change", fillCoachParam); $("#co-param").addEventListener("change", () => renderLesson());
  $("#co-ai").addEventListener("click", () => personalise());
  fillCoachWho();
  $("#res-seg").addEventListener("click", (e) => { const m = e.target.dataset?.m; if (m) { resMode = m; renderResults(); } });
  $("#replay-btn").addEventListener("click", heroReplay);
  for (const f of ONBOOT) { try { await f(); } catch (e) { console.error(e); } }
  addEventListener("hashchange", route);
  route();
}
boot().finally(() => document.body.classList.add("ready")).catch((e) => { $("main").innerHTML = `<div class="empty">Couldn't load the app data: ${esc(e.message)}</div>`; });
