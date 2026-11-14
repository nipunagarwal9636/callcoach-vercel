/* Human review: a QA auditor confirms or overturns each fatal/unsure finding; every action is chained into the audit trail. */
let rvTab = "queue", rvSel = null, rvFilter = "pending";

function needsSignoff(s) {
  const out = [];
  for (const p of D.order) {
    const r = s.results[p];
    if (r.result === "REVIEW" || (r.result === "NOT_MET" && psev(p) === "FATAL")) out.push({ key: p, r });
  }
  if (s.conduct_alert) out.push({ key: "OTP", r: { result: "NOT_MET", severity: "FATAL", quote: s.conduct_alert.quote, turns: [s.conduct_alert.turn], reason: s.conduct_alert.reason, source: "rules", confidence: 0.97 } });
  return out;
}

function finalScore(s, dec) {
  const items = dec?.items || {};
  const fatal = D.order.filter((p) => psev(p) === "FATAL" && (["NOT_MET", "REVIEW"].includes(s.results[p].result)) && items[p]?.d !== "overturn");
  if (fatal.length) return { score: 0, fatal };
  let sc = 0;
  for (const p of D.scorecard) {
    if (p.points == null) continue;
    const r = s.results[p.id];
    if (r.result !== "NOT_MET" || items[p.id]?.d === "overturn") sc += p.points;
  }
  return { score: sc, fatal: [] };
}

function agreement() {
  const dec = Store.get("decisions", {}); let c = 0, o = 0; const per = {};
  for (const d of Object.values(dec)) for (const [k, v] of Object.entries(d.items || {})) {
    per[k] = per[k] || { c: 0, o: 0 }; if (v.d === "confirm") { c++; per[k].c++; } else if (v.d === "overturn") { o++; per[k].o++; }
  }
  return { c, o, rate: c + o ? c / (c + o) : null, per };
}

function renderReview() {
  const el = $("#v-review"), items = reviewItems(), ag = agreement(), m = me();
  rvSel = Store.get("reviewOpen", null) || rvSel; Store.del("reviewOpen");
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Review queue</h2><p>Fatal findings, unsure calls and OTP alerts wait here for a QA auditor. Nothing fatal is final, and nothing reaches an agent's record, until a person confirms it.</p></div>
    <div class="seg" id="rv-seg"><button data-t="queue" class="${rvTab === "queue" ? "on" : ""}">Queue</button><button data-t="trail" class="${rvTab === "trail" ? "on" : ""}">Audit trail</button></div></div>
  <div class="kpis k4">
    <div class="kpi review"><b>${items.filter((x) => !x.done).length}</b><span>calls waiting for a reviewer</span></div>
    <div class="kpi pass"><b>${items.filter((x) => x.done).length}</b><span>signed off</span></div>
    <div class="kpi"><b>${ag.rate == null ? "n/a" : pct(ag.rate)}</b><span>AI findings confirmed by people (${ag.c} of ${ag.c + ag.o})</span></div>
    <div class="kpi"><b>${Trail.all().length}</b><span>entries on the audit trail</span></div>
  </div>
  <div class="who-bar">Reviewing as <input id="rv-me" value="${esc(m.name)}" placeholder="Your name" maxlength="40"> <span class="muted small">QA auditor. Your name is stamped on every decision.</span></div>
  <div id="rv-body"></div>`;
  $("#rv-me").onchange = (e) => Store.set("me", { name: e.target.value.trim(), role: "QA auditor" });
  $$("#rv-seg button").forEach((b) => b.onclick = () => { rvTab = b.dataset.t; renderReview(); });
  rvTab === "queue" ? drawQueue(items) : drawTrail();
}

function drawQueue(items) {
  const list = items.filter((x) => rvFilter === "all" || !x.done);
  if (!rvSel || !items.find((x) => x.id === rvSel)) rvSel = list[0]?.id;
  $("#rv-body").innerHTML = `<div class="grid-rv"><div>
      <div class="filters" style="margin:0 0 10px"><label>Show<select id="rv-f"><option value="pending">Waiting for review</option><option value="all" ${rvFilter === "all" ? "selected" : ""}>All</option></select></label></div>
      <div class="rv-list">${list.map((x) => {
        const why = x.s.conduct_alert ? "OTP request" : x.s.fatal.length ? "Fatal " + x.s.fatal.join(", ") : "Unsure " + x.s.review.join(", ");
        return `<button class="rv-item ${x.id === rvSel ? "on" : ""}" data-id="${x.id}"><span class="sev" style="background:${x.done ? "var(--pass)" : SEV_COLOR[x.s.severity] || "var(--review)"}"></span>
          <span><b>${x.id}</b> ${x.live ? `<span class="chip ink">live</span>` : ""}<br><span class="small muted">${esc(x.call.agent)}, ${why}${x.call.outcome === "SALE" ? ", sold" : ""}</span></span>
          <span class="small">${x.done ? `<span class="chip MET">Signed</span>` : ""}</span></button>`;
      }).join("") || `<div class="empty">Queue is clear.</div>`}</div></div>
    <div id="rv-detail"></div></div>`;
  $("#rv-f").onchange = (e) => { rvFilter = e.target.value; drawQueue(reviewItems()); };
  $$(".rv-item").forEach((b) => b.onclick = () => { rvSel = b.dataset.id; drawQueue(reviewItems()); });
  drawDetail(items.find((x) => x.id === rvSel));
}

function drawDetail(x) {
  const box = $("#rv-detail");
  if (!x) { box.innerHTML = ""; return; }
  const all = Store.get("decisions", {}), dec = all[x.id] || { items: {} }, need = needsSignoff(x.s);
  const decided = need.every((n) => dec.items[n.key]?.d);
  const fs = finalScore(x.s, dec);
  const other = D.order.filter((p) => x.s.results[p].result === "NOT_MET" && psev(p) !== "FATAL");
  box.innerHTML = `<div class="panel"><div class="rv-head"><div><h3>${x.id}: ${esc(x.call.agent)}</h3><p class="small muted">${esc(x.call.team_lead)}, ${String(x.call.product).replace("_", " ").toLowerCase()}, ${x.call.language}, ${String(x.call.outcome).toLowerCase().replace("_", " ")}${x.call.premium ? ", premium " + inr(x.call.premium) : ""}</p></div>
      <div class="rv-score"><span class="small muted">AI score</span><b>${x.s.score}</b>${dec.signed ? `<span class="small muted">Final</span><b style="color:var(--pass)">${dec.signed.final}</b>` : ""}</div></div>
    <div class="routes" style="margin:8px 0 14px">${routes(x.s)}</div>
    ${need.map((n) => {
      const d = dec.items[n.key];
      return `<div class="rv-find ${d ? (d.d === "confirm" ? "conf" : "over") : ""}" data-k="${n.key}">
        <div class="rv-fh"><b>${n.key === "OTP" ? "Conduct: asked for OTP/PIN/card" : `${n.key} ${esc(pname(n.key))}`}</b>${chipFor(n.r)}<span class="small muted">${esc(n.r.source || "")}${n.r.confidence != null ? `, confidence ${n.r.confidence}` : ""}</span></div>
        ${n.r.quote ? `<div class="ev"><span class="tn">Turn ${esc((n.r.turns || []).join(", "))}</span><mark>${esc(n.r.quote)}</mark></div>` : ""}
        <div class="why small">${esc(n.r.reason || "")}</div>
        ${d ? `<div class="rv-dec">${d.d === "confirm" ? "Confirmed" : "Overturned"} by ${esc(d.by)}, ${when(d.ts)}${d.reason ? `: “${esc(d.reason)}”` : ""} ${dec.signed ? "" : `<button class="linkbtn" data-undo="${n.key}">Change</button>`}</div>`
          : `<div class="rv-act"><input placeholder="Reason (required to overturn)" data-reason="${n.key}"><button class="btn small" data-c="${n.key}">Confirm</button><button class="btn ghost small" data-o="${n.key}">Overturn</button></div>`}
      </div>`;
    }).join("")}
    ${other.length ? `<p class="small muted" style="margin-top:12px">Also found, no sign-off needed: ${other.map((p) => `${p} ${esc(pname(p))}`).join("; ")}.</p>` : ""}
    <div class="rv-sign">${dec.signed ? `<span class="chip MET">Signed off by ${esc(dec.signed.by)}, ${when(dec.signed.ts)}. Final score ${dec.signed.final}</span>`
      : `<span class="small muted">Final score if signed now: <b>${fs.score}</b>${fs.fatal.length ? ` (fatal ${fs.fatal.join(", ")} confirmed)` : ""}</span><button class="btn" id="rv-sign" ${decided ? "" : "disabled"}>Sign off call</button>`}</div>
  </div>
  <div class="panel" style="margin-top:16px"><h3 style="margin-bottom:10px">Transcript</h3>${transcriptHTML(x.call.turns, x.s)}</div>`;

  const save = async (k, d, reason) => {
    const m = needMe(); if (!m) return;
    const all = Store.get("decisions", {}); all[x.id] = all[x.id] || { items: {} };
    all[x.id].items[k] = { d, reason, by: m.name, ts: Date.now() }; Store.set("decisions", all);
    await Trail.add(d === "confirm" ? "Finding confirmed" : "Finding overturned", `${x.id} ${k}`, reason || "AI finding upheld");
    renderReview();
  };
  $$("[data-c]", box).forEach((b) => b.onclick = () => save(b.dataset.c, "confirm", $(`[data-reason="${b.dataset.c}"]`, box).value.trim()));
  $$("[data-o]", box).forEach((b) => b.onclick = () => {
    const r = $(`[data-reason="${b.dataset.o}"]`, box).value.trim();
    if (r.length < 5) { toast("Write why you're overturning it. It goes on the audit trail."); $(`[data-reason="${b.dataset.o}"]`, box).focus(); return; }
    save(b.dataset.o, "overturn", r);
  });
  $$("[data-undo]", box).forEach((b) => b.onclick = async () => {
    const all = Store.get("decisions", {}); delete all[x.id].items[b.dataset.undo]; Store.set("decisions", all);
    await Trail.add("Decision reopened", `${x.id} ${b.dataset.undo}`, "Reviewer changed their mind before sign-off"); renderReview();
  });
  $("#rv-sign", box)?.addEventListener("click", async () => {
    const m = needMe(); if (!m) return;
    const all = Store.get("decisions", {}), d = all[x.id] || { items: {} }, f = finalScore(x.s, d);
    d.signed = { by: m.name, ts: Date.now(), final: f.score, fatal: f.fatal }; all[x.id] = d; Store.set("decisions", all);
    await Trail.add("Call signed off", x.id, `final score ${f.score}; confirmed ${Object.entries(d.items).filter(([, v]) => v.d === "confirm").map(([k]) => k).join(", ") || "none"}; overturned ${Object.entries(d.items).filter(([, v]) => v.d === "overturn").map(([k]) => k).join(", ") || "none"}`);
    if (f.fatal.length && x.call.outcome === "SALE") { await openCase(x, f.fatal, "Reviewer confirmed a fatal error on a sale"); toast("Signed off. A customer recovery case was opened."); }
    else { if (!f.fatal.length) await closeIfOverturned(x); toast("Signed off"); }
    const next = reviewItems().find((y) => !y.done); rvSel = next?.id; renderReview();
  });
}

async function drawTrail(banner = "") {
  const all = Trail.all().slice().reverse();
  $("#rv-body").innerHTML = `<div class="panel"><div class="sec-head" style="margin:0 0 12px"><div><h3>Audit trail</h3><p class="small muted">Each entry stores the hash of the one before it (SHA-256). Editing or deleting any past entry breaks the chain from that point, so tampering shows.</p></div>
    <div class="cta" style="margin:0"><button class="btn small" id="tr-verify">Verify chain</button><button class="btn ghost small" id="tr-tamper">${Store.get("tamper") ? "Undo tamper test" : "Tamper test"}</button><button class="btn ghost small" id="tr-csv">Export CSV</button></div></div>
    <div id="tr-banner">${banner}</div>
    ${all.length ? `<div class="tablewrap"><table class="t"><thead><tr><th class="num">#</th><th>When</th><th>Who</th><th>Action</th><th>Reference</th><th>Detail</th><th>Hash</th></tr></thead><tbody>${all.map((e) =>
      `<tr><td class="num">${e.seq}</td><td class="small">${when(e.ts)}</td><td>${esc(e.actor)}</td><td><b>${esc(e.action)}</b></td><td>${esc(e.ref)}</td><td class="small">${esc(e.detail)}</td><td class="mono" title="prev ${esc(e.prev)}">${esc(e.hash.slice(0, 10))}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">No entries yet. Confirm or overturn a finding in the queue and it appears here.</div>`}</div>`;
  $("#tr-csv").onclick = () => download("callcoach-audit-trail.csv", Trail.csv(), "text/csv");
  $("#tr-verify").onclick = async () => {
    const v = await Trail.verify();
    drawTrail(v.ok ? `<div class="okbar">Chain intact: all ${v.n} entries match their hashes.</div>` : `<div class="alert"><b>Chain broken at entry ${v.at}.</b> Someone changed or removed a past entry; everything after it can't be trusted.</div>`);
  };
  $("#tr-tamper").onclick = async () => {
    const t = Trail.all();
    if (Store.get("tamper")) { const b = Store.get("tamper"); t[b.i].detail = b.detail; Store.set("trail", t); Store.del("tamper"); return drawTrail(`<div class="okbar">Tamper test undone. Verify again.</div>`); }
    if (t.length < 2) return toast("Make at least two decisions first");
    const i = Math.max(0, t.length - 3);
    Store.set("tamper", { i, detail: t[i].detail }); t[i].detail = "final score 100; (edited quietly afterwards)"; Store.set("trail", t);
    const v = await Trail.verify();
    drawTrail(`<div class="alert"><b>Tamper test:</b> entry ${t[i].seq} was edited directly in storage. Verify found the chain broken at entry ${v.at}.</div>`);
  };
}

RENDER.review = renderReview; ALWAYS.add("review");
