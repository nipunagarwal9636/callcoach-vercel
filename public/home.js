/* Dashboards: one per account type. Every tile opens its detail underneath. */
let HOME = { tile: null };
async function calllog() { if (!D.calllog) D.calllog = await Auth.api("/api/data?name=calllog").catch(() => []); return D.calllog; }
const fmtMin = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
const prodName = (p) => ({ HEALTH_NEW: "Health", HEALTH_SENIOR: "Senior health", MOTOR_NEW: "Car, new", MOTOR_SWITCH: "Car, switch" }[p] || String(p).replace(/_/g, " ").toLowerCase());
const outName = (o) => ({ SALE: "Sale", FOLLOW_UP: "Follow-up", NOT_INTERESTED: "Not interested", CALLBACK: "Callback" }[o] || String(o).replace(/_/g, " ").toLowerCase());
const SEVW = { FATAL: 3, MAJOR: 2, MINOR: 1 };

function tile(k, icon, val, label, sub, tone = "") {
  return `<button class="tile ${tone} ${HOME.tile === k ? "on" : ""}" data-tile="${k}"><span class="t-ic">${svg(icon, 18)}</span><b>${val}</b><span class="t-l">${label}</span>${sub ? `<span class="t-s">${sub}</span>` : ""}<span class="t-go">${HOME.tile === k ? "Hide" : "Open"}</span></button>`;
}
function wireTiles(root, render) {
  $$("[data-tile]", root).forEach((b) => b.onclick = () => {
    HOME.tile = HOME.tile === b.dataset.tile ? null : b.dataset.tile;
    $$("[data-tile]", root).forEach((x) => { x.classList.toggle("on", x.dataset.tile === HOME.tile); $(".t-go", x).textContent = x.dataset.tile === HOME.tile ? "Hide" : "Open"; });
    const d = $("#home-detail"); d.innerHTML = HOME.tile ? render(HOME.tile) : ""; d.classList.toggle("on", !!HOME.tile);
    if (HOME.tile) { wireDetail(d); setTimeout(() => d.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30); }
  });
  if (HOME.tile) { const d = $("#home-detail"); d.innerHTML = render(HOME.tile); d.classList.add("on"); wireDetail(d); }
}
function wireDetail(d) {
  $$("[data-call]", d).forEach((b) => b.onclick = () => openCallAny(b.dataset.call));
  $$("[data-prac]", d).forEach((b) => b.onclick = () => practise(b.dataset.prac));
  $$("[data-lesson]", d).forEach((b) => b.onclick = () => openLesson(b.dataset.lesson, b.dataset.who));
  $$("[data-agent]", d).forEach((b) => b.onclick = () => agentDrawer(b.dataset.agent));
  $$("[data-filter]", d).forEach((s) => s.onchange = () => { HOME.filter = s.value; const k = HOME.tile; HOME.tile = null; $(`[data-tile="${k}"]`).click(); });
}
async function openLesson(p, who) {
  location.hash = "#coaching";
  await until(() => $("#co-who") && rendered.coaching, 3000);
  coScope = "agents"; fillCoachWho();
  if (who) $("#co-who").value = who; fillCoachParam();
  if ([...$("#co-param").options].some((o) => o.value === p)) { $("#co-param").value = p; renderLesson(); }
}
function openCallAny(id) {
  const c = D.calls.find((x) => x.id === id);
  if (c) { const b = drawer(resultBlock(c.scored[D.modes[0]], c.turns, role().role === "agent" ? null : c.labels), true); return animateRings(b); }
  const f = Feed.cache.find((x) => x.id === id);
  if (f) { const b = drawer(`<p class="small muted" style="margin-bottom:10px">Scored ${when(f.ts)} by ${esc(f.by)} (${f.source || "live"})</p>` + resultBlock(f.s, f.turns, null), true); return animateRings(b); }
  const l = (D.calllog || []).find((x) => x.id === id);
  if (l) drawer(callLogDetail(l));
}
function callLogDetail(l) {
  return `<h2>Call ${l.id}</h2><p class="small muted" style="margin:6px 0 14px">${l.at}, ${prodName(l.p)}, ${esc(l.src)}, customer aged ${esc(l.age)}, ${esc(l.lang)}</p>
    <div class="kpis k4"><div class="kpi"><b>${fmtMin(l.sec)}</b><span>talk time</span></div><div class="kpi ${l.out === "SALE" ? "pass" : ""}"><b>${outName(l.out)}</b><span>outcome</span></div>
      <div class="kpi"><b>${l.prem ? inr(l.prem) : "–"}</b><span>premium</span></div><div class="kpi ${l.cmp || l.fl ? "fatal" : ""}"><b>${l.cmp ? "Complaint" : l.fl ? "Cancelled" : "None"}</b><span>after the sale</span></div></div>
    ${l.qa ? `<div class="panel" style="margin-top:16px"><h3>Human QA audit by ${esc(l.qa.by)}: ${l.qa.score}/100${l.qa.fatal ? ` <span class="chip FATAL">fatal</span>` : ""}</h3>
      <div class="routes" style="margin:10px 0">${l.qa.fails.length ? l.qa.fails.map((p) => `<span class="chip ${psev(p)}">${p} ${esc(pname(p))}</span>`).join("") : `<span class="chip MET">No points lost</span>`}</div>
      ${l.qa.note ? `<p class="small">Auditor's note: “${esc(l.qa.note)}”</p>` : ""}
      <div class="cta" style="margin-top:12px">${l.qa.fails.slice(0, 2).map((p) => `<button class="btn small" onclick="closeDrawer();practise('${p}')">Practise ${p}</button>`).join("")}</div></div>`
      : `<p class="small muted" style="margin-top:14px">Not audited. Only a sample of calls is heard by QA today; every new call scored by CallCoach appears on your dashboard.</p>`}`;
}

/* every checked call for an agent: human audits, AI-scored calls, and newly shared calls */
function checkedCalls(a) {
  const out = [];
  for (const x of a.audits) out.push({ id: x.call, date: x.date, src: "QA audit", score: x.score, fatal: x.fatal, fails: x.fails, note: x.comment });
  for (const c of D.calls.filter((c) => c.agent_id === a.id)) { const s = c.scored[D.modes[0]]; out.push({ id: c.id, date: c.call_start?.slice(0, 10) || "", src: "AI scored", score: s.score, fatal: !!s.fatal.length, fails: D.order.filter((p) => ["NOT_MET", "REVIEW"].includes(s.results[p].result)) }); }
  for (const f of Feed.cache.filter((f) => f.agent_id === a.id)) out.push({ id: f.id, date: new Date(f.ts).toISOString().slice(0, 10), src: "New", score: f.s.score, fatal: !!f.s.fatal.length, fails: D.order.filter((p) => ["NOT_MET", "REVIEW"].includes(f.s.results[p].result)), isNew: true });
  return out.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
}
function mistakeCounts(checked) {
  const m = {}; for (const c of checked) for (const p of c.fails) m[p] = (m[p] || 0) + 1;
  return Object.entries(m).sort((x, y) => y[1] * SEVW[psev(y[0])] - x[1] * SEVW[psev(x[0])]);
}
function errorRow(c) {
  return `<button class="crow ${c.fatal ? "bad" : c.fails.length ? "warn" : "ok"}" data-call="${c.id}"><span class="cr-id"><b>${c.id}</b><span class="small muted">${c.date}, ${c.src}</span></span>
    <span class="cr-f">${c.fails.length ? c.fails.map((p) => `<span class="chip ${psev(p)}">${p}</span>`).join(" ") : `<span class="chip MET">No errors</span>`}${c.isNew ? ` <span class="chip ink">new</span>` : ""}</span><b class="cr-s">${c.score}</b></button>`;
}

/* ================= Agent ================= */
async function homeAgent() {
  const a = me_agent(), log = (await calllog()).filter((x) => x.a === a.id), mem = Memory.get();
  const checked = checkedCalls(a), mist = mistakeCounts(checked), sales = log.filter((x) => x.out === "SALE");
  const errCalls = checked.filter((c) => c.fails.length), newOnes = Feed.unseen().filter((f) => f.agent_id === a.id);
  const lessons = mem.lessons || {}, passed = Object.values(lessons).filter((l) => l.passed).length;
  const plan = mist.map(([p]) => p).slice(0, 4);
  const since = mem.prevLast ? Math.round((Date.now() - mem.prevLast) / 864e5) : null;
  const lastPrac = (mem.practice || []).slice(-1)[0];
  const ini = a.name.split(" ").map((w) => w[0]).join("");
  $("#v-home").innerHTML = `<div class="hero2"><div class="h2-l"><span class="av big agent">${ini}</span><div><span class="small">${greet()}</span><h2>${esc(a.name.split(" ")[0])}, here's your day</h2>
      <p class="mem">${since == null ? "First time here. Start with the plan below." : `Welcome back${since ? `, last here ${since} day${since > 1 ? "s" : ""} ago` : ""}.`}
      ${lastPrac ? ` Last practice: ${lastPrac.focus ? lastPrac.focus + ", " : ""}score ${lastPrac.score}.` : ""} ${newOnes.length ? `<b>${newOnes.length} new scored call${newOnes.length > 1 ? "s" : ""} since then.</b>` : ""}</p></div></div>
    <button class="profile-chip" id="me-prof"><span>${a.id}</span><span>${a.team_lead_id}, ${esc(a.team_lead)}</span><span>${a.tenure} months${a.certified ? "" : ", not yet certified"}</span><span class="linkbtn">My profile</span></button></div>
    ${newOnes.length ? `<div class="newbar">${svg("demo", 16)} <b>New:</b> ${newOnes.map((f) => `<button class="linkbtn" data-call="${f.id}">${f.id} scored ${f.s.score}${f.s.fatal.length ? " (fatal)" : ""}</button>`).join(", ")} <button class="linkbtn" id="seen">Mark seen</button></div>` : ""}
    <div class="tiles">${tile("customers", "agents", log.length, "Customers contacted", `${new Set(log.map((l) => l.src)).size} lead sources`)}
      ${tile("calls", "demo", log.length, "Calls done", `${fmtMin(Math.round(log.reduce((s, l) => s + l.sec, 0) / Math.max(1, log.length)))} average`)}
      ${tile("sales", "roi", sales.length, "Converted sales", `${pct(sales.length / Math.max(1, log.length))} conversion, ${crore(sales.reduce((s, l) => s + l.prem, 0))}`, "pass")}
      ${tile("errors", "review", `${errCalls.length}/${checked.length}`, "Checked calls with errors", `${checked.filter((c) => c.fatal).length} fatal`, errCalls.length ? "fatal" : "pass")}
      ${tile("mistakes", "flags", mist.length ? mist[0][0] : "None", "Most common mistake", mist.length ? esc(pname(mist[0][0])) : "Keep it up", mist.length ? "major" : "pass")}
      ${tile("coaching", "coaching", `${passed}/${plan.length || 0}`, "Lessons passed", lastPrac ? `last practice ${when(lastPrac.ts)}` : "start your first practice", "review")}</div>
    <div id="home-detail" class="detail"></div>
    <div class="grid2" style="margin-top:20px"><div class="panel"><h3>Your plan this week</h3><p class="small muted" style="margin:2px 0 10px">Built from your own calls${a.tenure < 6 ? " and set for a new joiner" : ""}. Each lesson has a practice call with the Sales Buddy.</p><div class="acts">
      ${!a.certified ? `<div class="act hot"><span class="act-ic">${svg("review", 18)}</span><span><b>Finish your IRDAI certification</b><span class="small muted">Required before selling on your own</span></span><span></span></div>` : ""}
      ${plan.map((p) => { const st = lessons[p] || {}; return `<div class="act ${psev(p) === "FATAL" && !st.passed ? "hot" : ""}"><span class="act-ic">${st.passed ? "✓" : svg("coaching", 18)}</span><span><b>${p} ${esc(LESSON_RULES[p].short)}</b><span class="small muted">${st.passed ? "Passed" : st.tries ? `Practised ${st.tries}×, not passed yet` : `Lost points on ${mist.find((m) => m[0] === p)[1]} call${mist.find((m) => m[0] === p)[1] > 1 ? "s" : ""}`}</span></span>
        <span class="act-b">${a.coach_modules.includes(p) ? `<button class="btn ghost small" data-lesson="${p}">Lesson</button>` : ""}<button class="btn small" data-prac="${p}">Practise</button></span></div>`; }).join("") || `<p class="muted small">No mistakes on your checked calls. Practise a free call to stay sharp.</p>`}</div></div>
      <div class="panel"><h3>Your audit scores</h3><div class="chartbox" style="height:220px"><canvas id="me-ch"></canvas></div><p class="small muted">Floor average ${D.agents.floor_avg.toFixed(0)}. Scores are reviewed by a person before anything goes on your record.</p></div></div>`;
  wireTiles($("#v-home"), (k) => agentDetail(k, a, log, checked, mist, sales));
  wireDetail($("#v-home"));
  $("#seen")?.addEventListener("click", () => { Feed.markSeen(); homeAgent(); });
  $("#me-prof").onclick = () => profileDrawer(a);
  scoreChart($("#me-ch"), a);
}
function profileDrawer(a) {
  drawer(`<div class="pd-h"><span class="av big agent">${a.name.split(" ").map((w) => w[0]).join("")}</span><div><h2>${esc(a.name)}</h2><p class="muted">${a.id}</p></div></div>
    <table class="t" style="margin-top:16px"><tbody>${[["Team lead", `${a.team_lead} (${a.team_lead_id})`], ["Tenure", `${a.tenure} months`], ["Experience before PolicyNest", a.prior], ["Languages", a.languages],
      ["IRDAI certified", a.certified ? "Yes" : "Not yet"], ["Monthly premium target", inr(a.target)], ["Calls this quarter (sample)", a.calls], ["Sales this quarter (sample)", `${a.sales}, ${crore(a.premium)}`],
      ["Complaints", a.complaints ? Object.entries(a.complaint_cats).map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, " ")}`).join(", ") : "None"], ["Audit average", a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)]]
      .map(([k, v]) => `<tr><td class="muted">${k}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</tbody></table>`);
}
function scoreChart(cv, a) {
  if (!window.Chart || !cv || !a.audits.length) return;
  scoreChart.c?.destroy();
  scoreChart.c = new Chart(cv, { type: "line", data: { labels: a.audits.map((x) => x.date.slice(5)), datasets: [{ data: a.audits.map((x) => x.score), borderColor: "#1B2440", backgroundColor: "rgba(255,227,110,.35)", fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: a.audits.map((x) => (x.fatal ? "#D6453D" : "#1B2440")) }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, grid: { color: "#EEF1F6" } }, x: { grid: { display: false } } } } });
}
function bars(rows, total) { const mx = Math.max(1, ...rows.map((r) => r[1])); return `<div class="hbars">${rows.map(([k, v]) => `<div class="hb"><span>${esc(k)}</span><div class="track"><i style="width:${(v / mx) * 100}%"></i></div><b>${v}${total ? ` <span class="small muted">${pct(v / total)}</span>` : ""}</b></div>`).join("")}</div>`; }
const countBy = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);

function agentDetail(k, a, log, checked, mist, sales) {
  const f = HOME.filter || "all";
  const rows = (xs) => `<div class="tablewrap"><table class="t clickable"><thead><tr><th>Call</th><th>When</th><th>Product</th><th>Lead</th><th class="num">Talk</th><th>Outcome</th><th class="num">Premium</th><th>QA</th></tr></thead><tbody>
    ${xs.slice(0, 60).map((l) => `<tr data-call="${l.id}"><td><b>${l.id}</b></td><td>${l.at}</td><td>${prodName(l.p)}</td><td class="small">${esc(l.src)}</td><td class="num">${fmtMin(l.sec)}</td><td>${l.out === "SALE" ? `<span class="chip MET">Sale</span>` : outName(l.out)}${l.fl ? ` <span class="chip MAJOR">cancelled</span>` : ""}${l.cmp ? ` <span class="chip FATAL">complaint</span>` : ""}</td><td class="num">${l.prem ? inr(l.prem) : "–"}</td><td>${l.qa ? `<span class="chip ${l.qa.fatal ? "FATAL" : l.qa.fails.length ? "MAJOR" : "MET"}">${l.qa.score}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>${xs.length > 60 ? `<p class="small muted">Showing the latest 60 of ${xs.length}.</p>` : ""}`;
  if (k === "customers") return `<div class="det-h"><h3>Customers you contacted</h3><p class="small muted">Each call in the sample is a different lead. Click a row to open it.</p></div>
    <div class="grid3"><div><h4>By lead source</h4>${bars(countBy(log, (l) => l.src), log.length)}</div><div><h4>By customer age</h4>${bars(countBy(log, (l) => l.age), log.length)}</div><div><h4>By language</h4>${bars(countBy(log, (l) => l.lang), log.length)}</div></div>${rows([...log].reverse())}`;
  if (k === "calls") { const xs = [...log].reverse().filter((l) => f === "all" || l.out === f);
    return `<div class="det-h"><h3>All your calls</h3><label class="small">Show <select data-filter><option value="all">All outcomes</option>${["SALE", "FOLLOW_UP", "CALLBACK", "NOT_INTERESTED"].map((o) => `<option value="${o}" ${f === o ? "selected" : ""}>${outName(o)}</option>`).join("")}</select></label></div>${bars(countBy(log, (l) => outName(l.out)), log.length)}${rows(xs)}`; }
  if (k === "sales") return `<div class="det-h"><h3>Your converted sales</h3><p class="small muted">${sales.filter((s) => s.fl).length} cancelled in free-look, ${sales.filter((s) => s.cmp).length} complaints. A sale that's cancelled usually means the customer heard something different from the policy.</p></div>
    <div class="grid3"><div><h4>Conversion by product</h4>${bars(countBy(sales, (l) => prodName(l.p)))}</div><div><h4>Premium sold</h4><b class="bignum">${crore(sales.reduce((s, l) => s + l.prem, 0))}</b><span class="small muted">sample of the quarter</span></div><div><h4>Kept vs cancelled</h4>${bars([["Kept", sales.filter((s) => !s.fl).length], ["Cancelled in free-look", sales.filter((s) => s.fl).length]])}</div></div>${rows([...sales].reverse())}`;
  if (k === "errors") return `<div class="det-h"><h3>Errors in each checked call</h3><p class="small muted">Human QA audits, AI-scored calls and new calls. Click a call to see where it went wrong.</p></div><div class="crows">${checked.map(errorRow).join("") || `<p class="muted">No checked calls yet.</p>`}</div>`;
  if (k === "mistakes") return `<div class="det-h"><h3>Your mistakes, by rule</h3><p class="small muted">Across ${checked.length} checked calls, fatal rules weighted highest.</p></div>
    <div class="mlist">${mist.map(([p, n]) => `<div class="mrow"><span class="chip ${psev(p)}">${p}</span><div><b>${esc(LESSON_RULES[p].short)}</b><div class="track"><i style="width:${(n / Math.max(1, checked.length)) * 100}%;background:${psev(p) === "FATAL" ? "var(--fatal)" : "var(--major)"}"></i></div><span class="small muted">${n} of ${checked.length} calls</span></div>
      <span class="act-b">${a.coach_modules.includes(p) ? `<button class="btn ghost small" data-lesson="${p}">Lesson</button>` : ""}<button class="btn small" data-prac="${p}">Practise</button></span></div>`).join("") || `<p class="muted">No mistakes found.</p>`}</div>
    ${a.mistakes.length ? `<h4 style="margin-top:16px">What auditors wrote</h4><ul class="mist">${a.mistakes.map(([m, n]) => `<li><span>“${esc(m)}”</span><b>${n}×</b></li>`).join("")}</ul>` : ""}`;
  if (k === "coaching") { const mem = Memory.get();
    return `<div class="det-h"><h3>Your coaching and practice</h3></div><div class="grid2"><div><h4>Lessons</h4><div class="acts">${D.order.filter((p) => mist.find((m) => m[0] === p) || mem.lessons?.[p]).map((p) => { const st = mem.lessons?.[p] || {}; return `<div class="act"><span class="act-ic">${st.passed ? "✓" : p}</span><span><b>${esc(LESSON_RULES[p].short)}</b><span class="small muted">${st.passed ? "Passed" : st.tries ? `${st.tries} tries` : "Not practised"}</span></span><span class="act-b"><button class="btn small" data-prac="${p}">Practise</button></span></div>`; }).join("") || `<p class="muted small">Nothing to coach.</p>`}</div></div>
      <div><h4>Practice history</h4>${(mem.practice || []).length ? `<ul class="mist">${mem.practice.slice(-8).reverse().map((x) => `<li><span>${when(x.ts)}${x.focus ? `, lesson ${x.focus}` : ", free practice"}</span><b class="${x.fatal?.length ? "down" : "up"}">${x.score}</b></li>`).join("")}</ul>` : `<p class="muted small">No practice calls yet.</p>`}
      ${(Store.get("coachLog", {})[a.id] || []).length ? `<h4 style="margin-top:14px">Sessions with your team lead</h4><ul class="mist">${Store.get("coachLog", {})[a.id].map((l) => `<li><span>${l.p} ${esc(pname(l.p))}</span><b class="small">${when(l.ts)}</b></li>`).join("")}</ul>` : ""}</div></div>`; }
  return "";
}

/* ================= Team lead ================= */
async function homeTL() {
  const R = role(), team = R.team, mode = D.modes[0];
  const log = (await calllog()).filter((l) => l.tl === team), agents = D.agents.agents.filter((a) => a.team_lead_id === team);
  const calls = D.calls.filter((c) => c.team_lead_id === team), fatal = calls.filter((c) => c.scored[mode].fatal.length);
  const feed = Feed.cache.filter((f) => f.team_lead_id === team), newOnes = Feed.unseen().filter((f) => f.team_lead_id === team);
  const open = Object.values(cases()).filter((c) => c.status !== "resolved" && roleSeesCall(callOf(c.id)));
  const needCoach = agents.filter((a) => a.coach_modules.length || a.audits.some((x) => x.fatal)).sort((a, b) => agRisk(b) - agRisk(a));
  const sales = log.filter((l) => l.out === "SALE");
  $("#v-home").innerHTML = `<div class="hero2"><div class="h2-l"><span class="av big tl">${esc(teamName(team).split(" ").map((w) => w[0]).join(""))}</span><div><span class="small">${greet()}, ${esc(teamName(team).split(" ")[0])}</span><h2>Your team today</h2>
      <p class="mem">${team}: ${agents.length} agents. ${newOnes.length ? `<b>${newOnes.length} new scored call${newOnes.length > 1 ? "s" : ""} from your team.</b>` : "No new scored calls since your last visit."}</p></div></div></div>
    ${newOnes.length ? `<div class="newbar">${svg("demo", 16)} <b>New:</b> ${newOnes.map((f) => `<button class="linkbtn" data-call="${f.id}">${esc(f.agent || f.agent_id)}: ${f.id}, ${f.s.score}${f.s.fatal.length ? " fatal" : ""}</button>`).join(", ")} <button class="linkbtn" id="seen">Mark seen</button></div>` : ""}
    <div class="tiles">${tile("fatal", "review", fatal.length + feed.filter((f) => f.s.fatal.length).length, "Calls with a fatal error", "scored by AI", "fatal")}
      ${tile("callbacks", "recovery", open.length, "Customer callbacks open", "fatal error on a sale", open.length ? "major" : "pass")}
      ${tile("coach", "coaching", needCoach.length, "Agents to coach", "ranked by risk", "review")}
      ${tile("agents", "agents", agents.length, "Agents", `${agents.filter((a) => !a.certified).length} not certified`)}
      ${tile("conv", "roi", pct(sales.length / Math.max(1, log.length)), "Team conversion", `${sales.length} sales, ${sales.filter((s) => s.fl).length} cancelled`, "pass")}
      ${tile("new", "demo", feed.length, "Newly scored calls", newOnes.length ? `${newOnes.length} unseen` : "live and pasted calls", newOnes.length ? "fatal" : "")}</div>
    <div id="home-detail" class="detail"></div>
    ${(() => { const f = D.patterns.findings.find((x) => (x.title + x.evidence).includes(team)); return f ? `<div class="panel insight" style="margin-top:20px"><span class="small muted">What the floor data says about your team</span><h3>${esc(f.title)}</h3><p>${esc(f.evidence)}</p><p class="small"><b>Likely cause:</b> ${esc(f.cause)}</p></div>` : ""; })()}`;
  wireTiles($("#v-home"), (k) => tlDetail(k, { team, agents, calls, fatal, feed, open, needCoach, log, sales, mode }));
  wireDetail($("#v-home"));
  $("#seen")?.addEventListener("click", () => { Feed.markSeen(); homeTL(); });
}
function agentTable(agents) {
  return `<div class="tablewrap"><table class="t clickable"><thead><tr><th>Agent</th><th class="num">Audit avg</th><th class="num">Fatal audits</th><th>Top mistake</th><th class="num">Complaints</th><th class="num">Free-look</th></tr></thead><tbody>
    ${agents.map((a) => { const m = mistakeCounts(checkedCalls(a))[0]; return `<tr data-agent="${a.id}"><td><b>${esc(a.name)}</b> <span class="small muted">${a.id}</span>${a.certified ? "" : ` <span class="chip FATAL tiny">uncertified</span>`}</td><td class="num">${a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)}</td><td class="num">${a.audits.filter((x) => x.fatal).length}</td><td>${m ? `<span class="chip ${psev(m[0])}">${m[0]}</span> ${esc(LESSON_RULES[m[0]].short)}` : `<span class="muted">none</span>`}</td><td class="num">${a.complaints}</td><td class="num">${a.free_look}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function tlDetail(k, x) {
  if (k === "fatal") { const rows = [...x.feed.filter((f) => f.s.fatal.length).map((f) => ({ id: f.id, agent: f.agent || f.agent_id, s: f.s, isNew: true })), ...x.fatal.map((c) => ({ id: c.id, agent: c.agent, s: c.scored[x.mode], sale: c.outcome === "SALE" }))];
    return `<div class="det-h"><h3>Fatal errors on your team</h3><p class="small muted">Open a call to see the evidence and the fix.</p></div><div class="crows">${rows.map((r) => `<button class="crow bad" data-call="${r.id}"><span class="cr-id"><b>${esc(r.agent)}</b><span class="small muted">${r.id}${r.sale ? ", sold: callback needed" : ""}</span></span><span class="cr-f">${r.s.fatal.map((p) => `<span class="chip FATAL">${p} ${esc(pname(p))}</span>`).join(" ")}${r.isNew ? ` <span class="chip ink">new</span>` : ""}</span><b class="cr-s">${r.s.score}</b></button>`).join("")}</div>`; }
  if (k === "callbacks") return `<div class="det-h"><h3>Customers to call back</h3><a class="btn small" href="#recovery">Open the recovery board</a></div><div class="crows">${x.open.map((c) => { const call = callOf(c.id); return `<button class="crow ${c.status === "awaiting" ? "warn" : "bad"}" data-call="${c.id}"><span class="cr-id"><b>${esc(call.agent)}</b><span class="small muted">${c.id}, ${c.status === "awaiting" ? "waiting for QA review" : c.status === "tocall" ? "ready to call" : "contacted"}</span></span><span class="cr-f">${c.fatal.map((p) => `<span class="chip FATAL">${p}</span>`).join(" ")}</span><span>${sla(c)}</span></button>`; }).join("") || `<p class="muted">None open.</p>`}</div>`;
  if (k === "coach") { const shared = Object.entries(D.coach.teams?.[x.team]?.shared || {}).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
    return `<div class="det-h"><h3>Who to coach, and on what</h3></div>${shared.length ? `<div class="newbar"><b>One team session covers ${shared[0][1]} agents:</b> ${esc(LESSON_RULES[shared[0][0]].short)} (${shared[0][0]}). <a class="linkbtn" href="#coaching">Open team module</a></div>` : ""}
      <div class="crows">${x.needCoach.map((a) => { const m = mistakeCounts(checkedCalls(a)); return `<button class="crow ${a.audits.some((y) => y.fatal) ? "bad" : "warn"}" data-agent="${a.id}"><span class="cr-id"><b>${esc(a.name)}</b><span class="small muted">${a.id}, ${a.tenure} months${a.certified ? "" : ", uncertified"}</span></span><span class="cr-f">${m.slice(0, 3).map(([p, n]) => `<span class="chip ${psev(p)}">${p} ×${n}</span>`).join(" ")}</span><span class="linkbtn">Profile</span></button>`; }).join("")}</div>`; }
  if (k === "agents") return `<div class="det-h"><h3>Your agents</h3><p class="small muted">Click an agent for their tiles, calls and coaching.</p></div>${agentTable([...x.agents].sort((a, b) => agRisk(b) - agRisk(a)))}`;
  if (k === "conv") { const byAgent = x.agents.map((a) => { const l = x.log.filter((y) => y.a === a.id); return [a, l.length, l.filter((y) => y.out === "SALE").length, l.filter((y) => y.fl).length]; }).sort((p, q) => q[2] / Math.max(1, q[1]) - p[2] / Math.max(1, p[1]));
    return `<div class="det-h"><h3>Conversion by agent</h3><p class="small muted">High conversion with high free-look cancellation is a mis-selling signal.</p></div><div class="tablewrap"><table class="t clickable"><thead><tr><th>Agent</th><th class="num">Calls</th><th class="num">Sales</th><th class="num">Conversion</th><th class="num">Cancelled</th></tr></thead><tbody>${byAgent.map(([a, n, s, fl]) => `<tr data-agent="${a.id}"><td><b>${esc(a.name)}</b></td><td class="num">${n}</td><td class="num">${s}</td><td class="num">${pct(s / Math.max(1, n))}</td><td class="num ${fl / Math.max(1, s) > 0.1 ? "down" : ""}">${fl}</td></tr>`).join("")}</tbody></table></div>`; }
  if (k === "new") return `<div class="det-h"><h3>Newly scored calls</h3><p class="small muted">Calls scored in Score a call or Live call and assigned to your agents appear here automatically.</p></div><div class="crows">${x.feed.map((f) => `<button class="crow ${f.s.fatal.length ? "bad" : f.s.flags.length ? "warn" : "ok"}" data-call="${f.id}"><span class="cr-id"><b>${esc(f.agent || f.agent_id)}</b><span class="small muted">${f.id}, ${when(f.ts)}, by ${esc(f.by)}</span></span><span class="cr-f">${f.s.flags.map((p) => `<span class="chip ${psev(p)}">${p}</span>`).join(" ") || `<span class="chip MET">clean</span>`}</span><b class="cr-s">${f.s.score}</b></button>`).join("") || `<p class="muted">Nothing yet. Score a call and assign it to one of your agents.</p>`}</div>`;
  return "";
}
function agentDrawer(id) {
  const a = D.agents.agents.find((x) => x.id === id); if (!a) return;
  const ch = checkedCalls(a), m = mistakeCounts(ch);
  const b = drawer(`<div class="pd-h"><span class="av big agent">${a.name.split(" ").map((w) => w[0]).join("")}</span><div><h2>${esc(a.name)}</h2><p class="muted">${a.id}, ${a.tenure} months, ${esc(a.languages)}${a.certified ? "" : ", not certified"}</p></div></div>
    <div class="kpis k4" style="margin-top:16px"><div class="kpi"><b>${a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)}</b><span>audit average</span></div><div class="kpi fatal"><b>${ch.filter((c) => c.fatal).length}</b><span>fatal calls</span></div><div class="kpi"><b>${a.sales}</b><span>sales (sample)</span></div><div class="kpi major"><b>${a.free_look}</b><span>free-look cancels</span></div></div>
    <h3 style="margin:18px 0 8px">Mistakes</h3><div class="routes">${m.map(([p, n]) => `<span class="chip ${psev(p)}">${p} ${esc(LESSON_RULES[p].short)} ×${n}</span>`).join("") || `<span class="chip MET">none</span>`}</div>
    <h3 style="margin:18px 0 8px">Checked calls</h3><div class="crows">${ch.map(errorRow).join("")}</div>
    <div class="cta" style="margin-top:16px"><button class="btn" id="ad-full">Full profile</button>${a.coach_modules[0] ? `<button class="btn ghost" id="ad-les">Open coaching</button>` : ""}</div>`, true);
  $$("[data-call]", b).forEach((x) => x.onclick = () => openCallAny(x.dataset.call));
  $("#ad-full", b).onclick = () => { closeDrawer(); agSel = a.id; location.hash = "#agents"; if (rendered.agents) drawAgList(); };
  $("#ad-les", b)?.addEventListener("click", () => { closeDrawer(); openLesson(a.coach_modules[0], a.id); });
}

/* ================= QA auditor ================= */
async function homeQA() {
  const items = reviewItems(), ag = agreement(), v = await Trail.verify(), runs = Store.get("labRuns", {});
  const waiting = items.filter((x) => !x.done), signed = items.filter((x) => x.done), fresh = Feed.cache.filter((f) => f.s.fatal.length || f.s.review.length);
  $("#v-home").innerHTML = `<div class="hero2"><div class="h2-l"><span class="av big qa">${esc((me().name || "QA").replace(/^Auditor /, "").slice(0, 4))}</span><div><span class="small">${greet()}</span><h2>Your review desk</h2>
      <p class="mem">AI scored every call. You decide the ones that matter. ${fresh.length ? `<b>${fresh.length} newly scored call${fresh.length > 1 ? "s" : ""} need a look.</b>` : ""}</p></div></div><a class="btn" href="#review">Start reviewing</a></div>
    <div class="tiles">${tile("wait", "review", waiting.length, "Calls waiting for you", `${waiting.filter((x) => x.call.outcome === "SALE").length} were sales`, "review")}
      ${tile("signed", "flags", signed.length, "Signed off", "by you and your team", "pass")}
      ${tile("agree", "results", ag.rate == null ? "n/a" : pct(ag.rate), "AI findings you confirmed", `${ag.c} confirmed, ${ag.o} overturned`)}
      ${tile("trail", "review", v.ok ? "Intact" : "Broken", "Audit trail", `${v.n} entries`, v.ok ? "pass" : "fatal")}
      ${tile("acc", "results", runs.stress ? `${runs.stress.rows.filter((r) => r.correct).length}/${runs.stress.rows.length}` : "Run it", "Stress test, live", runs.stress ? when(runs.stress.ts) : "12 reworded calls")}
      ${tile("aud", "patterns", `${pct(Math.min(...D.patterns.auditors.map((a) => a.fatal_rate)))}–${pct(Math.max(...D.patterns.auditors.map((a) => a.fatal_rate)))}`, "Auditor fatal-rate spread", "calibration needed", "major")}</div>
    <div id="home-detail" class="detail"></div>`;
  wireTiles($("#v-home"), (k) => qaDetail(k, { waiting, signed, ag, v, runs }));
}
function qaDetail(k, x) {
  const rv = (it) => `<button class="crow ${it.s.fatal.length ? "bad" : "warn"}" onclick="Store.set('reviewOpen','${it.id}');rvTab='queue';location.hash='#review'"><span class="cr-id"><b>${it.id}: ${esc(it.call.agent)}</b><span class="small muted">${it.s.conduct_alert ? "OTP request" : it.s.fatal.length ? "Fatal " + it.s.fatal.join(", ") : "Unsure " + it.s.review.join(", ")}${it.call.outcome === "SALE" ? ", sold" : ""}${it.live ? ", new" : ""}</span></span><span class="cr-f">${it.done ? `<span class="chip MET">Final ${it.dec.signed.final}</span>` : ""}</span><span class="linkbtn">Review</span></button>`;
  if (k === "wait") return `<div class="det-h"><h3>Waiting for review</h3><p class="small muted">Sales first: a customer callback waits on your decision.</p></div><div class="crows">${[...x.waiting].sort((a, b) => (b.call.outcome === "SALE") - (a.call.outcome === "SALE")).slice(0, 30).map(rv).join("")}</div>`;
  if (k === "signed") return `<div class="det-h"><h3>Signed off</h3></div><div class="crows">${x.signed.map(rv).join("") || `<p class="muted">Nothing signed yet.</p>`}</div>`;
  if (k === "agree") return `<div class="det-h"><h3>Where people agree with the AI</h3><p class="small muted">Each confirm or overturn is a live accuracy check on the AI.</p></div><div class="tablewrap"><table class="t"><thead><tr><th>Finding</th><th class="num">Confirmed</th><th class="num">Overturned</th><th class="num">Agreement</th></tr></thead><tbody>${Object.entries(x.ag.per).map(([p, v]) => `<tr><td><b>${p}</b> ${esc(p === "OTP" ? "OTP request" : pname(p))}</td><td class="num">${v.c}</td><td class="num">${v.o}</td><td class="num">${pct(v.c / Math.max(1, v.c + v.o))}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No decisions yet.</td></tr>`}</tbody></table></div>`;
  if (k === "trail") return `<div class="det-h"><h3>Audit trail</h3><a class="btn small" href="#review" onclick="rvTab='trail'">Open and verify</a></div><p>${x.v.ok ? `All ${x.v.n} entries match their hashes. Nobody has edited past decisions.` : `The chain breaks at entry ${x.v.at}. Something was changed after it was written.`}</p>
    <ul class="mist">${Trail.all().slice(-6).reverse().map((e) => `<li><span><b>${esc(e.action)}</b> ${esc(e.ref)}, ${esc(e.actor)}</span><b class="small">${when(e.ts)}</b></li>`).join("")}</ul>`;
  if (k === "acc") return `<div class="det-h"><h3>Keep the AI honest</h3><a class="btn small" href="#results">Open the accuracy lab</a></div>${x.runs.stress ? stressTable(x.runs.stress) : `<p class="muted">No live run yet. Run the stress set in Accuracy.</p>`}`;
  if (k === "aud") return `<div class="det-h"><h3>Auditor calibration</h3><p class="small muted">The same floor, marked fatal at very different rates. A calibration session on 10 shared calls fixes this.</p></div>${bars(D.patterns.auditors.map((a) => [`${a.id}${a.id === me().name.replace("Auditor ", "") ? " (you)" : ""}`, Math.round(a.fatal_rate * 1000) / 10]))}<p class="small muted">Share of each auditor's audits marked fatal, %.</p>`;
  return "";
}

/* ================= Admin ================= */
async function homeAdmin() {
  const mode = D.modes[0], log = await calllog(), items = reviewItems(), open = Object.values(cases()).filter((c) => c.status !== "resolved");
  const fatal = D.calls.filter((c) => c.scored[mode].fatal.length).length, users = { agent: D.agents.agents.length, tl: new Set(D.agents.agents.map((a) => a.team_lead_id)).size, qa: D.patterns.auditors.length };
  const roi = roiCalc(Object.fromEntries(ROI_IN.map((r) => [r[0], Store.get("roi", {})[r[0]] ?? r[2]])));
  $("#v-home").innerHTML = `<div class="hero2"><div class="h2-l"><span class="av big admin">AD</span><div><span class="small">${greet()}</span><h2>Control room</h2><p class="mem">Everything, across ${users.tl} teams, ${users.agent} agents and ${users.qa} QA auditors.</p></div></div>
    <span class="cta" style="margin:0"><a class="btn ghost" href="#overview">Product overview</a><button class="btn tourbtn" onclick="Tour.start(0)">Guided demo</button></span></div>
    <div class="tiles">${tile("calls", "demo", log.length.toLocaleString("en-IN"), "Calls in the sample", `${D.calls.length} scored with labels`)}
      ${tile("fatal", "review", pct(fatal / D.calls.length), "Scored calls with a fatal error", `${fatal} of ${D.calls.length}`, "fatal")}
      ${tile("review", "review", items.filter((x) => !x.done).length, "Waiting for QA review", `${items.filter((x) => x.done).length} signed`, "review")}
      ${tile("callbacks", "recovery", open.length, "Customer callbacks open", "across all teams", "major")}
      ${tile("teams", "agents", users.tl, "Teams", "compare team leads")}
      ${tile("roi", "roi", crore(roi.net), "Net benefit a month", "base case, editable", "pass")}</div>
    <div id="home-detail" class="detail"></div>
    <div class="panel" style="margin-top:20px"><h3>Accounts</h3><p class="small muted" style="margin:2px 0 10px">Everyone signs in with their own ID and sees only their slice; the server filters the data.</p>
      <div class="grid3"><div class="acct"><b>${users.agent}</b> agents<span class="small muted">Sign in with their ID, e.g. SA-001</span></div><div class="acct"><b>${users.tl}</b> team leads<span class="small muted">e.g. TL-3</span></div><div class="acct"><b>${users.qa}</b> QA auditors<span class="small muted">e.g. QA-1</span></div></div></div>`;
  wireTiles($("#v-home"), (k) => {
    if (k === "teams") { const T = D.patterns.teams; return `<div class="det-h"><h3>Teams side by side</h3><a class="btn small" href="#patterns">Floor patterns</a></div><div class="tablewrap"><table class="t"><thead><tr><th>Team</th><th class="num">Audits</th><th class="num">Fatal</th><th class="num">Disclosure fails</th><th class="num">Pressure</th><th class="num">Avg score</th></tr></thead><tbody>${T.map((t) => `<tr><td><b>${t.id}</b> ${esc(t.team_lead)}</td><td class="num">${t.audits}</td><td class="num">${pct(t.fatal)}</td><td class="num">${pct(t.disclosure_fail)}</td><td class="num">${pct(t.pressure_fail)}</td><td class="num">${t.avg_score.toFixed(0)}</td></tr>`).join("")}</tbody></table></div>`; }
    if (k === "roi") return `<div class="det-h"><h3>Monthly P&amp;L</h3><a class="btn small" href="#roi">Open P&amp;L</a></div><div class="kpis k4"><div class="kpi pass"><b>${crore(roi.net)}</b><span>net a month</span></div><div class="kpi"><b>${crore(roi.net * 12)}</b><span>a year</span></div><div class="kpi"><b>${Math.round(roi.reviewHours)} h</b><span>human review time</span></div><div class="kpi"><b>₹${roi.perCall.toFixed(2)}</b><span>all-in cost per call</span></div></div>`;
    if (k === "review") return qaDetail("wait", { waiting: items.filter((x) => !x.done) });
    if (k === "callbacks") return tlDetail("callbacks", { open });
    if (k === "fatal") return `<div class="det-h"><h3>Fatal calls</h3><a class="btn small" href="#flags">Today's flags</a></div><div class="crows">${D.calls.filter((c) => c.scored[mode].fatal.length).slice(0, 25).map((c) => `<button class="crow bad" data-call="${c.id}"><span class="cr-id"><b>${esc(c.agent)}</b><span class="small muted">${c.id}, ${c.team_lead_id}</span></span><span class="cr-f">${c.scored[mode].fatal.map((p) => `<span class="chip FATAL">${p}</span>`).join(" ")}</span><b class="cr-s">0</b></button>`).join("")}</div>`;
    if (k === "calls") return `<div class="det-h"><h3>Calls by outcome and product</h3></div><div class="grid3"><div><h4>Outcome</h4>${bars(countBy(log, (l) => outName(l.out)), log.length)}</div><div><h4>Product</h4>${bars(countBy(log, (l) => prodName(l.p)), log.length)}</div><div><h4>Team</h4>${bars(countBy(log, (l) => l.tl), log.length)}</div></div>`;
    return "";
  });
  wireDetail($("#v-home"));
}

function greet() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
RENDER.home = () => { HOME.tile = null; HOME.filter = null; const r = role().role; return r === "agent" ? homeAgent() : r === "tl" ? homeTL() : r === "qa" ? homeQA() : homeAdmin(); };
ALWAYS.add("home");
