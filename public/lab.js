/* Accuracy lab: run the deployed engine (rules, or rules + AI judge) on the test sets live and measure it. */
const LAB = { running: false, stop: false };
const FATALP = ["P2", "P5", "P6"];
const norm = (r) => (r === "REVIEW" ? "NOT_MET" : r);

function labMetrics(rows) {
  let agree = 0, tot = 0, tp = 0, fp = 0, ftrue = 0, fhit = 0, err = 0; const per = {};
  for (const { call, res } of rows) {
    for (const p of D.order) {
      const y = call.labels[p], g = res.results[p].result, yt = y === "NOT_MET", yp = g === "NOT_MET" || g === "REVIEW";
      per[p] = per[p] || { tp: 0, fp: 0, fn: 0 };
      if (yt && yp) { tp++; per[p].tp++; } if (!yt && yp) { fp++; per[p].fp++; } if (yt && !yp) per[p].fn++;
      agree += norm(g) === y; tot++;
    }
    const fatal = call.true_score === 0 && FATALP.some((p) => call.labels[p] === "NOT_MET");
    if (fatal) { ftrue++; if (FATALP.some((p) => ["NOT_MET", "REVIEW"].includes(res.results[p].result))) fhit++; }
    err += Math.abs(res.score - call.true_score);
  }
  return { n: rows.length, fatal_recall: ftrue ? fhit / ftrue : null, fatal_hit: fhit, fatal_true: ftrue, precision: tp + fp ? tp / (tp + fp) : null, agreement: tot ? agree / tot : null, mae: rows.length ? err / rows.length : null, per };
}

function renderLab() {
  const runs = Store.get("labRuns", {});
  $("#lab").innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Accuracy</h2><p>Run the deployed engine on the test sets right now and measure it against the labels. With a key set, this is how the AI judge's numbers are produced, live, in front of you.</p></div></div>
  <div class="panel lab">
    <div class="lab-ctl"><label class="toggle" style="margin:0"><input type="checkbox" id="lab-ai" ${STATUS.llm ? "checked" : "disabled"}> <span>${STATUS.llm ? `AI judge on (${STATUS.model})` : "AI judge off: rules only (no key on the server)"}</span></label>
      <span class="cta" style="margin:0"><button class="btn small" data-run="stress">Run stress set (12 calls)</button><button class="btn ghost small" data-run="labelled">Run labelled set (110 calls)</button><button class="btn ghost small" id="lab-stop" disabled>Stop</button></span></div>
    <div class="prog"><i id="lab-bar"></i></div><div class="small muted" id="lab-msg">${STATUS.api ? "Each call goes through /api/score exactly like a live call. Calls are spaced out to respect free-tier rate limits." : "The engine isn't reachable here, so live runs are off. Saved results are below."}</div>
    <div id="lab-out">${runs.stress ? stressTable(runs.stress) : ""}${runs.labelled ? labelledTiles(runs.labelled) : ""}</div>
  </div>`;
  $$("[data-run]").forEach((b) => b.onclick = () => runLab(b.dataset.run));
  $("#lab-stop").onclick = () => { LAB.stop = true; };
}

const secs = (x) => (x < 1000 ? Math.round(x) + " ms" : (x / 1000).toFixed(1) + " s");
function latency(ms) { const s = [...ms].sort((a, b) => a - b); return s.length ? { avg: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] } : null; }

function stressTable(run) {
  const ok = run.rows.filter((r) => r.correct).length, L = latency(run.ms), saved = Object.fromEntries((D.eval.rules?.stress || []).map((r) => [r.case + r.param, r.got]));
  return `<div class="lab-res"><div class="lab-sum"><b>${ok} / ${run.rows.length}</b><span>stress checks right, ${run.ai ? "rules + AI judge" : "rules only"}${run.model ? ` (${esc(run.model)})` : ""}. Rules alone: ${(D.eval.rules?.stress || []).filter((r) => r.correct).length} / ${(D.eval.rules?.stress || []).length}.</span>
    ${L ? `<span class="small muted">Time per call: ${secs(L.avg)} average, ${secs(L.p95)} p95, round trip from your browser. Run ${when(run.ts)}.</span>` : ""}
    <button class="linkbtn" onclick='download("stress-run.json", JSON.stringify(Store.get("labRuns",{}).stress,null,1))'>Export run</button></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Case</th><th>What it rewords</th><th>Check</th><th>Expected</th><th>Rules alone</th><th>This run</th><th></th></tr></thead><tbody>
    ${run.rows.map((r) => `<tr><td><b>${r.case}</b></td><td class="small">${esc(r.about)}</td><td>${r.param}</td><td>${r.expected.replace("_", " ").toLowerCase()}</td><td class="small">${(saved[r.case + r.param] || "").replace("_", " ").toLowerCase()}</td><td>${r.got.replace("_", " ").toLowerCase()}${r.src ? ` <span class="small muted">(${r.src})</span>` : ""}</td><td>${r.correct ? `<span class="tick">✓</span>` : `<span class="cross">✗</span>`}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function labelledTiles(run) {
  const m = run.m, L = latency(run.ms);
  return `<div class="lab-res"><div class="lab-sum"><b>${m.n} calls</b><span>${run.ai ? "rules + AI judge" : "rules only"}${run.model ? ` (${esc(run.model)})` : ""}, run ${when(run.ts)}${m.n < 110 ? ", stopped early" : ""}.</span>${L ? `<span class="small muted">Time per call: ${secs(L.avg)} average, ${secs(L.p95)} p95.</span>` : ""}
    <button class="linkbtn" onclick='download("labelled-run.json", JSON.stringify(Store.get("labRuns",{}).labelled,null,1))'>Export run</button></div>
    <div class="targets">${[["Fatal calls caught", m.fatal_recall, `${m.fatal_hit} of ${m.fatal_true}. Target 90%`, 0.9], ["Flags that are real", m.precision, "Target 80%", 0.8], ["Agreement with labels", m.agreement, "Target 85%", 0.85]].map(([n, v, g, t]) =>
      `<div class="target"><span class="small">${n}</span><b style="color:${v >= t ? "var(--pass)" : "var(--fatal)"}">${pct(v, 1)}</b><div class="goal">${g}</div></div>`).join("")}
      <div class="target"><span class="small">Score error</span><b style="color:${m.mae <= 8 ? "var(--pass)" : "var(--fatal)"}">${m.mae?.toFixed(1)}</b><div class="goal">Mean points off. Target 8 or less</div></div></div></div>`;
}

async function runLab(which) {
  if (!STATUS.api || LAB.running) return;
  const ai = $("#lab-ai").checked, gap = ai ? 2200 : 50;
  const set = which === "stress" ? D.stress.map((s) => ({ key: s.id, text: s.transcript, s })) : D.calls.map((c) => ({ key: c.id, text: c.turns.map((t) => `${t.s}: ${t.t}`).join("\n"), c }));
  LAB.running = true; LAB.stop = false; $("#lab-stop").disabled = false; $$("[data-run]").forEach((b) => (b.disabled = true));
  const rows = [], ms = [], got = [];
  for (let i = 0; i < set.length && !LAB.stop; i++) {
    const x = set[i]; $("#lab-msg").textContent = `Scoring ${x.key} (${i + 1} of ${set.length})…`;
    const t0 = performance.now();
    try {
      const r = await fetch("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: x.text, use_llm: ai }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      ms.push(performance.now() - t0);
      if (j.result.llm_error) $("#lab-msg").textContent = `${x.key}: AI error (${j.result.llm_error}); rules result kept`;
      if (x.s) for (const [p, exp] of Object.entries(x.s.expected)) {
        const g = j.result.results[p].result;
        rows.push({ case: x.key, about: x.s.about, param: p, expected: exp, got: g, src: j.result.results[p].source, correct: (exp === "NOT_MET" ? ["NOT_MET", "REVIEW"].includes(g) : g === exp) });
      } else got.push({ call: x.c, res: j.result });
    } catch (e) { $("#lab-msg").textContent = `${x.key}: ${e.message}`; await new Promise((r) => setTimeout(r, 4000)); }
    $("#lab-bar").style.width = ((i + 1) / set.length * 100) + "%";
    if (gap) await new Promise((r) => setTimeout(r, gap));
  }
  const runs = Store.get("labRuns", {}), base = { ts: Date.now(), ai, model: ai ? STATUS.model : "", ms: ms.map(Math.round) };
  if (which === "stress") runs.stress = { ...base, rows }; else runs.labelled = { ...base, m: labMetrics(got) };
  Store.set("labRuns", runs);
  await Trail.add("Accuracy run", which === "stress" ? "Stress set" : "Labelled set", which === "stress" ? `${rows.filter((r) => r.correct).length}/${rows.length} correct, ${ai ? "AI on" : "rules"}` : `${got.length} calls, fatal recall ${pct(runs.labelled.m.fatal_recall, 1)}, ${ai ? "AI on" : "rules"}`);
  LAB.running = false; $("#lab-msg").textContent = LAB.stop ? "Stopped." : "Done."; renderLab();
}

const _rr = RENDER.results;
RENDER.results = () => { _rr(); renderLab(); };
