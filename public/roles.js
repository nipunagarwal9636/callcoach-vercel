/* Role views: Team lead, QA auditor, Agent, or Full view. Each role sees its own pages and a personal "My day" home. */
ICONS.home = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
STAGE.home = ["", "My day"];

const ROLES = {
  full: { label: "Full view", who: "Everything, for judges and managers", nav: null },
  tl: { label: "Team lead", who: "Your team's flags, callbacks and coaching", nav: ["home", "live", "demo", "flags", "recovery", "coaching", "agents", "buddy", "patterns"] },
  qa: { label: "QA auditor", who: "Review AI findings and keep the trail clean", nav: ["home", "live", "demo", "policy", "review", "flags", "results", "patterns"] },
  agent: { label: "Agent", who: "Your calls, your coaching, your practice", nav: ["home", "live", "buddy", "coaching"] },
};
function role() { return Store.get("role", { role: "full", team: "TL-3", agent: "SA-001" }); }
function setRole(r) {
  Store.set("role", { ...role(), ...r });
  for (const k of Object.keys(rendered)) delete rendered[k];
  ["#v-agents", "#v-recovery", "#v-review", "#v-home"].forEach((s) => { const e = $(s); if (e) e.innerHTML = ""; });
  coScope = "agents"; agSel = null; agTeam = ""; agQ = "";
  applyRole(); location.hash = role().role === "full" ? "#overview" : "#home"; route();
}
function teamName(id) { return D.coach.teams[id]?.name || D.agents.agents.find((a) => a.team_lead_id === id)?.team_lead || id; }
function me_agent() { return D.agents.agents.find((a) => a.id === role().agent) || D.agents.agents[0]; }
function roleSeesCall(call) {
  const r = role();
  if (!call || r.role === "full" || r.role === "qa") return true;
  if (r.role === "tl") return call.team_lead_id === r.team || call.team_lead_id === "-";
  return call.agent_id === r.agent;
}

window.roleGuard = (view) => {
  const r = ROLES[role().role];
  if (!r.nav || r.nav.includes(view)) return view;
  if (view !== "overview") toast(`Not part of the ${r.label} view. Switch to Full view from the menu at the top left.`);
  return "home";
};

function applyRole() {
  const R = role(), r = ROLES[R.role];
  $$("#nav a").forEach((a) => { a.hidden = r.nav ? !r.nav.includes(a.dataset.v) : a.dataset.v === "home"; });
  $$("#nav .grp").forEach((g) => {
    let n = g.nextElementSibling, any = false;
    while (n && !n.classList.contains("grp")) { if (n.tagName === "A" && !n.hidden) any = true; n = n.nextElementSibling; }
    g.hidden = !any;
  });
  const who = R.role === "tl" ? `${teamName(R.team)} (${R.team})` : R.role === "agent" ? me_agent().name : R.role === "qa" ? (me().name || "QA team") : "All pages";
  let b = $("#rolebtn");
  if (!b) { b = document.createElement("button"); b.id = "rolebtn"; $("#side .brand").after(b); b.onclick = openRoles; }
  b.innerHTML = `<span class="rb-r">${r.label}</span><span class="rb-w">${esc(who)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5"/></svg>`;
  document.body.dataset.role = R.role;
  updateBadges();
}

function openRoles() {
  const R = role();
  const teams = [...new Set(D.agents.agents.map((a) => a.team_lead_id))].sort();
  const m = modal(`<div class="mpad"><h2>Choose your view</h2><p class="muted" style="margin:6px 0 16px">Each role sees only what it needs. Switch any time.</p>
    <div class="roles">${Object.entries(ROLES).map(([k, r]) => `<button class="role-o ${R.role === k ? "on" : ""}" data-r="${k}"><span class="ri">${svg({ full: "overview", tl: "flags", qa: "review", agent: "agents" }[k], 20)}</span><b>${r.label}</b><span>${r.who}</span></button>`).join("")}</div>
    <div id="role-id" style="margin-top:14px"></div>
    <div class="cta" style="margin-top:16px"><button class="btn" id="role-go">Open this view</button></div></div>`, "wide");
  let pick = R.role;
  const drawId = () => {
    $("#role-id").innerHTML = pick === "tl" ? `<label class="fld">Which team do you lead?<select id="role-team">${teams.map((t) => `<option value="${t}" ${t === R.team ? "selected" : ""}>${t}: ${esc(teamName(t))}</option>`).join("")}</select></label>`
      : pick === "agent" ? `<label class="fld">Who are you?<select id="role-agent">${[...D.agents.agents].sort((a, b) => a.name.localeCompare(b.name)).map((a) => `<option value="${a.id}" ${a.id === R.agent ? "selected" : ""}>${esc(a.name)} (${a.id}, ${a.team_lead_id})</option>`).join("")}</select></label>`
      : pick === "qa" ? `<label class="fld">Your name, for the audit trail<input id="role-name" value="${esc(me().name)}" placeholder="e.g. Priya"></label>` : "";
  };
  $$("[data-r]", m).forEach((b) => b.onclick = () => { pick = b.dataset.r; $$("[data-r]", m).forEach((x) => x.classList.toggle("on", x === b)); drawId(); });
  drawId();
  $("#role-go", m).onclick = () => {
    const upd = { role: pick };
    if ($("#role-team")) upd.team = $("#role-team").value;
    if ($("#role-agent")) upd.agent = $("#role-agent").value;
    if ($("#role-name")?.value.trim()) Store.set("me", { name: $("#role-name").value.trim(), role: "QA auditor" });
    closeModal(); setRole(upd); toast(`${ROLES[pick].label} view`);
  };
}

/* ---------- My day ---------- */
function greet() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
function renderHome() {
  const R = role();
  if (R.role === "tl") return homeTL(R.team);
  if (R.role === "qa") return homeQA();
  if (R.role === "agent") return homeAgent(me_agent());
  location.hash = "#overview";
}
const actRow = (icon, title, sub, btn, href, cls = "") => `<a class="act ${cls}" href="${href}"><span class="act-ic">${svg(icon, 18)}</span><span><b>${title}</b><span class="small muted">${sub}</span></span><span class="btn small ghost">${btn}</span></a>`;

function homeTL(team) {
  const calls = D.calls.filter((c) => c.team_lead_id === team), mode = D.modes[0];
  const fatal = calls.filter((c) => c.scored[mode].fatal.length), sales = fatal.filter((c) => c.outcome === "SALE");
  const agents = D.agents.agents.filter((a) => a.team_lead_id === team);
  const open = Object.values(cases()).filter((c) => c.status !== "resolved" && roleSeesCall(callOf(c.id)));
  const needCoach = agents.filter((a) => a.coach_modules.length).sort((a, b) => agRisk(b) - agRisk(a));
  const shared = Object.entries(D.coach.teams[team]?.shared || {}).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  const avg = calls.length ? calls.reduce((s, c) => s + c.scored[mode].score, 0) / calls.length : 0;
  const finding = D.patterns.findings.find((f) => (f.title + f.evidence).includes(team));
  $("#v-home").innerHTML = `<div class="hello"><div><span class="small muted">${greet()}, ${esc(teamName(team))}</span><h2>Your team today</h2><p class="muted">${team}: ${agents.length} agents, ${calls.length} calls scored.</p></div>
      <button class="btn ghost small" onclick="openRoles()">Switch view</button></div>
    <div class="kpis k5"><div class="kpi fatal"><b>${fatal.length}</b><span>calls with a fatal error</span></div><div class="kpi major"><b>${open.length}</b><span>customer callbacks open</span></div>
      <div class="kpi review"><b>${needCoach.length}</b><span>agents with coaching due</span></div><div class="kpi"><b>${avg.toFixed(0)}</b><span>average call score</span></div>
      <div class="kpi"><b>${agents.filter((a) => !a.certified).length}</b><span>agents not yet certified</span></div></div>
    <div class="grid2" style="margin-top:20px"><div class="panel"><h3>Do these first</h3><div class="acts">
      ${sales.length ? actRow("recovery", `Call back ${sales.length} customer${sales.length > 1 ? "s" : ""} who bought on wrong information`, sales.slice(0, 3).map((c) => `${c.id} (${esc(c.agent)})`).join(", "), "Open", "#recovery", "hot") : ""}
      ${needCoach.slice(0, 4).map((a) => actRow("coaching", `Coach ${esc(a.name)}`, `Top issue: ${a.coach_modules.map((p) => D.scorecard.find((x) => x.id === p).theme).slice(0, 2).join(", ")}`, "Module", `#coaching" data-coach="${a.id}`)).join("")}
      ${shared.length ? actRow("agents", `Run one team session on ${D.scorecard.find((x) => x.id === shared[0][0]).theme}`, `${shared[0][1]} of your agents fail ${shared[0][0]}: one session covers them all`, "Module", `#coaching" data-team="${team}`) : ""}
      ${actRow("buddy", "Have your newest agent practise one call", "Live Sales Buddy, 5 minutes", "Practise", "#buddy")}</div></div>
      <div class="panel"><h3>Your agents</h3><div class="tablewrap" style="border:0"><table class="t"><thead><tr><th>Agent</th><th class="num">Audit avg</th><th class="num">Fatal audits</th><th class="num">Complaints</th><th></th></tr></thead><tbody>
        ${agents.sort((a, b) => agRisk(b) - agRisk(a)).map((a) => `<tr><td><b>${esc(a.name)}</b>${a.certified ? "" : ` <span class="chip FATAL tiny">uncertified</span>`}</td><td class="num">${a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)}</td><td class="num">${a.audits.filter((x) => x.fatal).length}</td><td class="num">${a.complaints}</td><td><a class="linkbtn" href="#agents" data-ag="${a.id}">Profile</a></td></tr>`).join("")}</tbody></table></div></div></div>
    ${finding ? `<div class="panel" style="margin-top:20px"><h3>What the floor data says about your team</h3><p style="margin-top:6px">${esc(finding.title)}. ${esc(finding.evidence)}</p><p class="small muted" style="margin-top:6px">Likely cause: ${esc(finding.cause)}</p></div>` : ""}`;
  wireHome();
}

async function homeQA() {
  const items = reviewItems(), ag = agreement(), v = await Trail.verify(), runs = Store.get("labRuns", {}), m = me();
  const waiting = items.filter((x) => !x.done);
  $("#v-home").innerHTML = `<div class="hello"><div><span class="small muted">${greet()}${m.name ? ", " + esc(m.name) : ""}</span><h2>Your review desk</h2><p class="muted">AI scored every call. You decide the ones that matter.</p></div><button class="btn ghost small" onclick="openRoles()">Switch view</button></div>
    <div class="kpis k4"><div class="kpi review"><b>${waiting.length}</b><span>calls waiting for you</span></div><div class="kpi pass"><b>${items.length - waiting.length}</b><span>signed off</span></div>
      <div class="kpi"><b>${ag.rate == null ? "n/a" : pct(ag.rate)}</b><span>AI findings you confirmed</span></div>
      <div class="kpi ${v.ok ? "pass" : "fatal"}"><b>${v.ok ? "Intact" : "Broken"}</b><span>audit trail, ${v.n} entries</span></div></div>
    <div class="grid2" style="margin-top:20px"><div class="panel"><h3>Next in your queue</h3><div class="acts">
      ${waiting.slice(0, 6).map((x) => actRow("review", `${x.id}: ${esc(x.call.agent)}`, x.s.conduct_alert ? "OTP request, conduct alert" : x.s.fatal.length ? `Fatal ${x.s.fatal.join(", ")}${x.call.outcome === "SALE" ? ", sold: callback waits on you" : ""}` : `Unsure ${x.s.review.join(", ")}`, "Review", `#review" data-rv="${x.id}`, x.call.outcome === "SALE" ? "hot" : "")).join("") || `<p class="muted small">Queue is clear.</p>`}</div>
      <p class="small muted" style="margin-top:10px">Keys in the queue: <kbd>C</kbd> confirm, <kbd>O</kbd> overturn, <kbd>S</kbd> sign off, <kbd>J</kbd>/<kbd>K</kbd> next.</p></div>
      <div class="panel"><h3>Keep the AI honest</h3><div class="acts">
        ${actRow("results", "Run the stress set", runs.stress ? `Last run: ${runs.stress.rows.filter((r) => r.correct).length}/${runs.stress.rows.length} right, ${when(runs.stress.ts)}` : "12 reworded calls, measured live", "Run", "#results")}
        ${actRow("review", "Verify the audit trail", v.ok ? "Every entry matches its hash" : `Broken at entry ${v.at}`, "Open", `#review" data-trail="1`, v.ok ? "" : "hot")}
        ${actRow("patterns", "Auditor calibration", `Fatal rates by auditor run from ${pct(Math.min(...D.patterns.auditors.map((a) => a.fatal_rate)))} to ${pct(Math.max(...D.patterns.auditors.map((a) => a.fatal_rate)))}`, "See", "#patterns")}
        ${actRow("policy", "Check a call against the policy wording", "Upload a new policy PDF if a plan changed", "Open", "#policy")}</div></div></div>`;
  wireHome();
}

function homeAgent(a) {
  const mine = D.calls.filter((c) => c.agent_id === a.id), mode = D.modes[0], log = Store.get("coachLog", {})[a.id] || [];
  const last = a.audits[a.audits.length - 1], ba = a.before_after;
  $("#v-home").innerHTML = `<div class="hello"><div><span class="small muted">${greet()}, ${esc(a.name.split(" ")[0])}</span><h2>Your calls, your growth</h2><p class="muted">Scores here help you improve. A person reviews the evidence before anything goes on your record.</p></div><button class="btn ghost small" onclick="openRoles()">Switch view</button></div>
    <div class="kpis k4"><div class="kpi"><b>${a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)}</b><span>your audit average (floor ${D.agents.floor_avg.toFixed(0)})</span></div>
      <div class="kpi ${last?.fatal ? "fatal" : "pass"}"><b>${last ? last.score : "–"}</b><span>latest audit${last ? `, ${last.date}` : ""}</span></div>
      <div class="kpi ${ba && ba.after >= ba.before ? "pass" : ""}"><b>${ba ? (ba.after >= ba.before ? "+" : "") + (ba.after - ba.before).toFixed(0) : "–"}</b><span>points since coaching</span></div>
      <div class="kpi"><b>${log.length}</b><span>coaching sessions logged</span></div></div>
    <div class="grid2" style="margin-top:20px"><div class="panel"><h3>Practise today</h3><div class="acts">
      ${a.coach_modules.slice(0, 3).map((p) => actRow("coaching", D.scorecard.find((x) => x.id === p).theme, `Built from your own calls (${p})`, "Open", `#coaching" data-mod="${p}`)).join("")}
      ${actRow("buddy", "Rehearse with an AI customer", "Ramesh has BP and wants to ask his wife first. Can you stay compliant?", "Start", "#buddy", "hot")}
      ${actRow("live", "Try a live call with a teammate", "See the coach react while you speak", "Open", "#live")}</div>
      ${a.mistakes.length ? `<h3 style="margin-top:18px">What auditors noticed most</h3><ul class="mist">${a.mistakes.slice(0, 3).map(([m, n]) => `<li><span>${esc(m)}</span><b>${n}×</b></li>`).join("")}</ul>` : ""}</div>
      <div class="panel"><h3>Your audit scores</h3><div class="chartbox" style="height:220px"><canvas id="me-ch"></canvas></div>
        ${mine.length ? `<h3 style="margin-top:16px">Your scored calls</h3><div class="routes" style="margin-top:8px">${mine.map((c) => `<button class="chip ${c.scored[mode].fatal.length ? "FATAL" : c.scored[mode].flags.length ? "MAJOR" : "MET"} linkchip" data-call="${c.id}">${c.id}: ${c.scored[mode].score}</button>`).join("")}</div>` : ""}</div></div>`;
  wireHome();
  if (window.Chart && a.audits.length) {
    homeAgent.ch?.destroy();
    homeAgent.ch = new Chart($("#me-ch"), { type: "line", data: { labels: a.audits.map((x) => x.date), datasets: [{ data: a.audits.map((x) => x.score), borderColor: "#1B2440", tension: 0.3, pointRadius: 5, pointBackgroundColor: a.audits.map((x) => (x.fatal ? "#D6453D" : "#1B2440")) }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: "#EEF1F6" } }, x: { grid: { display: false } } } } });
  }
}

function wireHome() {
  const h = $("#v-home");
  $$("[data-call]", h).forEach((b) => b.onclick = () => { const c = D.calls.find((x) => x.id === b.dataset.call); const body = drawer(resultBlock(c.scored[D.modes[0]], c.turns, null), true); animateRings(body); });
  $$("[data-ag]", h).forEach((b) => b.onclick = () => { agSel = b.dataset.ag; });
  $$("[data-rv]", h).forEach((b) => b.onclick = () => { Store.set("reviewOpen", b.dataset.rv); rvTab = "queue"; });
  $$("[data-trail]", h).forEach((b) => b.onclick = () => { rvTab = "trail"; });
  $$("[data-coach]", h).forEach((b) => b.onclick = () => openModule("agents", b.dataset.coach));
  $$("[data-team]", h).forEach((b) => b.onclick = () => openModule("teams", b.dataset.team));
  $$("[data-mod]", h).forEach((b) => b.onclick = () => openModule("agents", role().agent, b.dataset.mod));
}
async function openModule(scope, who, param) {
  await until(() => location.hash === "#coaching" && $("#co-who"), 3000);
  coScope = scope; $$("#co-seg button").forEach((x) => x.classList.toggle("on", x.dataset.s === scope)); fillCoachWho();
  $("#co-who").value = who; fillCoachParam(); if (param) { $("#co-param").value = param; renderLesson(); }
}

/* ---------- scope existing pages to the role ---------- */
const _fcw = fillCoachWho;
fillCoachWho = function () {
  _fcw();
  const R = role(), sel = $("#co-who"); if (!sel) return;
  if (R.role === "agent") { coScope = "agents"; $("#co-seg").hidden = true; [...sel.options].forEach((o) => { if (o.value !== R.agent) o.remove(); }); }
  else if (R.role === "tl") { $("#co-seg").hidden = false; [...sel.options].forEach((o) => { const ok = coScope === "teams" ? o.value === R.team : D.agents.agents.find((a) => a.id === o.value)?.team_lead_id === R.team; if (!ok) o.remove(); }); }
  else $("#co-seg").hidden = false;
  if (!sel.options.length) { $("#lesson").innerHTML = `<div class="empty">No coaching modules yet: none of your calls in the labelled set were flagged. Practise with the Live Sales Buddy instead.</div>`; $("#co-param").innerHTML = ""; return; }
  fillCoachParam();
};
const _rf = RENDER.flags;
RENDER.flags = () => { _rf(); const R = role(); if (R.role === "tl") { $("#f-tl").value = R.team; $("#f-tl").disabled = true; renderFlags(); } else $("#f-tl").disabled = false; };
const _ra = RENDER.agents;
RENDER.agents = () => { const R = role(); if (R.role === "tl") agTeam = R.team; _ra(); if (R.role === "tl") { $("#ag-team").value = R.team; $("#ag-team").disabled = true; } };
const _rr2 = RENDER.recovery;
RENDER.recovery = () => { _rr2(); const R = role(); if (R.role === "tl") $("#v-recovery .sec-head p")?.insertAdjacentHTML("beforeend", ` <b>Showing team ${R.team} only.</b>`); };
RENDER.home = renderHome; ALWAYS.add("home");
RENDER.coaching = () => { if (role().role !== "full") fillCoachWho(); };

/* role-aware welcome + palette */
const _pal = paletteSource;
paletteSource = function () { const r = ROLES[role().role]; return _pal().filter((x) => x.kind !== "Page" || !r.nav || r.nav.includes(Object.keys(STAGE).find((k) => STAGE[k][1] === x.label))); };
const _tourStart = Tour.start;
Tour.start = (i) => { if (role().role !== "full") setRole({ role: "full" }); _tourStart(i); };

ONBOOT.push(() => { applyRole(); });
