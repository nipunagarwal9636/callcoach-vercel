/* Agent performance: audit trend, common mistakes, before/after coaching, from qa_audits + AI-scored calls. */
let agSel = null, agTeam = "", agSort = "attention", agQ = "", agChart = null;

function agRisk(a) {
  const fatal = a.audits.filter((x) => x.fatal).length;
  return fatal * 3 + a.complaints * 2 + a.free_look + (a.certified ? 0 : 2) + (a.avg_qa != null && a.avg_qa < 60 ? 2 : 0);
}

function renderAgents() {
  const A = D.agents, el = $("#v-agents");
  const improved = A.agents.filter((a) => a.before_after && a.before_after.n_after >= 2).map((a) => ({ a, d: a.before_after.after - a.before_after.before }))
    .sort((x, y) => y.d - x.d).slice(0, 5);
  const teams = [...new Map(A.agents.map((a) => [a.team_lead_id, a.team_lead])).entries()].sort();
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Agents</h2><p>Each agent's quality across the quarter, from ${A.n_audits} human audits plus the AI-scored calls. Built for coaching, not discipline: the scorecard guide says a person reviews the evidence before any action.</p></div></div>
  <div class="panel improved"><h3>Most improved after their first coaching session</h3><p class="small muted" style="margin:2px 0 10px">Average audit score before vs after, agents with at least 2 audits after coaching.</p>
    <div class="imp">${improved.map(({ a, d }) => `<button class="imp-i" data-id="${a.id}"><b>${esc(a.name)}</b><span class="small muted">${a.team_lead_id}</span><span class="up">${d >= 0 ? "+" : ""}${d.toFixed(0)} pts</span><span class="small muted">${a.before_after.before.toFixed(0)} to ${a.before_after.after.toFixed(0)}</span></button>`).join("")}</div></div>
  <div class="grid-ag" style="margin-top:18px">
    <div class="panel"><div class="filters" style="margin:0 0 10px">
      <label>Search<input id="ag-q" value="${esc(agQ)}" placeholder="Name or ID"></label>
      <label>Team<select id="ag-team"><option value="">All teams</option>${teams.map(([id, n]) => `<option value="${id}" ${id === agTeam ? "selected" : ""}>${id} ${esc(n)}</option>`).join("")}</select></label>
      <label>Sort<select id="ag-sort"><option value="attention">Needs attention</option><option value="score" ${agSort === "score" ? "selected" : ""}>Lowest audit score</option><option value="name" ${agSort === "name" ? "selected" : ""}>Name</option></select></label></div>
      <div class="ag-list" id="ag-list"></div></div>
    <div id="ag-prof"></div></div>`;
  $("#ag-q").oninput = (e) => { agQ = e.target.value; drawAgList(); };
  $("#ag-team").onchange = (e) => { agTeam = e.target.value; drawAgList(); };
  $("#ag-sort").onchange = (e) => { agSort = e.target.value; drawAgList(); };
  $$(".imp-i").forEach((b) => b.onclick = () => { agSel = b.dataset.id; drawAgList(); });
  drawAgList();
}

function drawAgList() {
  const q = agQ.toLowerCase();
  let list = D.agents.agents.filter((a) => (!agTeam || a.team_lead_id === agTeam) && (!q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)));
  list.sort(agSort === "name" ? (a, b) => a.name.localeCompare(b.name) : agSort === "score" ? (a, b) => (a.avg_qa ?? 101) - (b.avg_qa ?? 101) : (a, b) => agRisk(b) - agRisk(a));
  if (!agSel || !list.find((a) => a.id === agSel)) agSel = list[0]?.id;
  $("#ag-list").innerHTML = list.map((a) => `<button class="ag-i ${a.id === agSel ? "on" : ""}" data-id="${a.id}"><span><b>${esc(a.name)}</b><br><span class="small muted">${a.id}, ${a.team_lead_id}, ${a.tenure} mo</span></span>
    <span class="ag-sc" style="color:${a.avg_qa == null ? "var(--na)" : a.avg_qa < 60 ? "var(--fatal)" : a.avg_qa < 75 ? "var(--major)" : "var(--pass)"}">${a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)}</span></button>`).join("") || `<div class="empty">No agents match.</div>`;
  $$(".ag-i").forEach((b) => b.onclick = () => { agSel = b.dataset.id; drawAgList(); });
  drawProfile(D.agents.agents.find((a) => a.id === agSel));
}

function drawProfile(a) {
  const box = $("#ag-prof"); if (!a) { box.innerHTML = ""; return; }
  const F = D.agents.floor_rate, fatal = a.audits.filter((x) => x.fatal).length, log = Store.get("coachLog", {})[a.id] || [];
  const lags = a.audits.map((x) => x.feedback_days).filter((x) => x != null);
  const params = D.order.filter((p) => a.fail_rate[p] != null);
  box.innerHTML = `<div class="panel"><div class="rv-head"><div><h2 style="font-size:24px">${esc(a.name)}</h2>
      <p class="small muted">${a.id}, team ${a.team_lead_id} (${esc(a.team_lead)}), ${a.tenure} months, ${esc(a.prior)}, speaks ${esc(a.languages)}</p></div>
      <div>${a.certified ? `<span class="chip MET">IRDAI certified</span>` : `<span class="chip FATAL">Not IRDAI certified</span>`}</div></div>
    <div class="kpis k5" style="margin-top:14px">
      <div class="kpi"><b>${a.avg_qa == null ? "–" : a.avg_qa.toFixed(0)}</b><span>avg audit score (floor ${D.agents.floor_avg.toFixed(0)})</span></div>
      <div class="kpi ${fatal ? "fatal" : ""}"><b>${fatal}/${a.audits.length}</b><span>audits with a fatal error</span></div>
      <div class="kpi ${a.complaints ? "major" : ""}"><b>${a.complaints}</b><span>complaints${a.complaints ? ": " + Object.keys(a.complaint_cats).map((k) => k.toLowerCase().replace(/_/g, " ")).join(", ") : ""}</span></div>
      <div class="kpi"><b>${a.free_look}/${a.sales}</b><span>sales cancelled in free-look</span></div>
      <div class="kpi"><b>${lags.length ? (lags.reduce((x, y) => x + y, 0) / lags.length).toFixed(0) + " d" : "–"}</b><span>avg days from audit to feedback</span></div>
    </div></div>
  <div class="grid2" style="margin-top:16px">
    <div class="panel"><h3>Audit scores over the quarter</h3><p class="small muted" style="margin:2px 0 8px">Red points are fatal audits (score 0). The dashed line marks the first coaching session.</p><div class="chartbox" style="height:240px"><canvas id="ag-ch"></canvas></div>
      ${a.before_after ? `<div class="ba"><span>Before coaching <b>${a.before_after.before.toFixed(0)}</b> <span class="small muted">(${a.before_after.n_before} audits)</span></span><span>After <b>${a.before_after.after.toFixed(0)}</b> <span class="small muted">(${a.before_after.n_after})</span></span><span class="${a.before_after.after >= a.before_after.before ? "up" : "down"}">${a.before_after.after >= a.before_after.before ? "+" : ""}${(a.before_after.after - a.before_after.before).toFixed(0)} pts</span></div>` : `<p class="small muted">${a.audits.some((x) => x.coached) ? "Coached, but too few audits since to compare." : "No coaching session on record this quarter."}</p>`}</div>
    <div class="panel"><h3>Where points are lost</h3><p class="small muted" style="margin:2px 0 10px">Share of this agent's audits failing each parameter, against the floor.</p>
      <div class="pbars">${params.map((p) => { const v = a.fail_rate[p], fl = F[p]; return `<div class="pbar"><span class="small">${p} ${esc(pname(p))}</span><div class="track"><i style="width:${Math.max(1, v * 100)}%;background:${v > fl * 1.5 && v > 0.1 ? "var(--fatal)" : "var(--ink-3)"}"></i><u style="left:${fl * 100}%"></u></div><b class="small">${pct(v)}</b></div>`; }).join("")}</div>
      <p class="small muted" style="margin-top:6px">Black tick: floor average. Red: well above the floor.</p></div></div>
  <div class="grid2" style="margin-top:16px">
    <div class="panel"><h3>Most common auditor notes</h3>${a.mistakes.length ? `<ul class="mist">${a.mistakes.map(([m, n]) => `<li><span>${esc(m)}</span><b>${n}×</b></li>`).join("")}</ul>` : `<p class="muted small">No audit comments.</p>`}
      ${a.labelled.length ? `<h3 style="margin-top:16px">AI-scored calls</h3><div class="routes" style="margin-top:8px">${a.labelled.map((c) => `<button class="chip ${c.fatal.length ? "FATAL" : c.flags.length ? "MAJOR" : "MET"} linkchip" data-call="${c.id}">${c.id}: ${c.score}</button>`).join("")}</div>` : ""}</div>
    <div class="panel"><h3>Coaching plan</h3>
      ${a.coach_modules.length ? `<p class="small muted" style="margin:2px 0 10px">Modules built from this agent's own calls.</p><div class="mods">${a.coach_modules.map((p) => `<div class="mod"><span><b>${p}</b> ${esc(D.scorecard.find((x) => x.id === p).theme)}</span><span><button class="btn ghost small" data-open="${p}">Open</button><button class="btn small" data-done="${p}">${log.find((l) => l.p === p) ? "Coached again" : "Mark coached"}</button></span></div>`).join("")}</div>`
        : `<p class="small muted">No flagged calls in the labelled set, so no module yet. Audit notes on the left show where to start.</p>`}
      ${log.length ? `<h4 style="margin:14px 0 6px">Coaching log</h4><ul class="mist">${log.slice().reverse().map((l) => `<li><span>${l.p} ${esc(pname(l.p))}, by ${esc(l.by)}</span><b class="small">${when(l.ts)}</b></li>`).join("")}</ul>` : ""}
    </div></div>`;
  $$("[data-call]", box).forEach((b) => b.onclick = () => { const c = D.calls.find((x) => x.id === b.dataset.call); const body = drawer(resultBlock(c.scored[D.modes[0]], c.turns, c.labels), true); animateRings(body); });
  $$("[data-open]", box).forEach((b) => b.onclick = () => {
    location.hash = "#coaching";
    setTimeout(() => { $("#co-who").value = a.id; fillCoachParam(); $("#co-param").value = b.dataset.open; renderLesson(); }, 60);
  });
  $$("[data-done]", box).forEach((b) => b.onclick = async () => {
    const m = needMe(); if (!m) return;
    const L = Store.get("coachLog", {}); (L[a.id] = L[a.id] || []).push({ p: b.dataset.done, by: m.name, ts: Date.now() }); Store.set("coachLog", L);
    await Trail.add("Coaching session logged", `${a.id} ${b.dataset.done}`, `${a.name}: ${D.scorecard.find((x) => x.id === b.dataset.done).theme}`);
    toast("Logged. The next audits show whether it worked."); drawProfile(a);
  });
  if (window.Chart) {
    agChart?.destroy();
    const pts = a.audits.map((x) => ({ x: x.date, y: x.score, fatal: x.fatal }));
    const first = a.audits.find((x) => x.coached);
    agChart = new Chart($("#ag-ch"), { type: "line", data: { labels: pts.map((p) => p.x), datasets: [{ data: pts.map((p) => p.y), borderColor: "#1B2440", tension: 0.25, pointRadius: 6,
      pointBackgroundColor: pts.map((p) => (p.fatal ? "#D6453D" : "#1B2440")), pointBorderColor: "#fff", pointBorderWidth: 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Score ${c.raw}${pts[c.dataIndex].fatal ? " (fatal)" : ""}` } } },
        scales: { y: { min: 0, max: 100, grid: { color: "#EEF1F6" } }, x: { grid: { display: false } } } },
      plugins: [{ id: "coachline", afterDraw(ch) {
        if (!first) return; const i = pts.findIndex((p) => p.x === first.date); if (i < 0) return;
        const x = ch.scales.x.getPixelForValue(i), { top, bottom } = ch.chartArea, g = ch.ctx;
        g.save(); g.setLineDash([5, 4]); g.strokeStyle = "#1F9D7A"; g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
      } }] });
  }
}

RENDER.agents = renderAgents;
