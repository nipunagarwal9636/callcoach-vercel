/* P&L and ROI: the brief's own numbers plus clearly marked assumptions, all editable. */
const ROI_IN = [
  // key, label, default, min, max, step, unit, source
  ["calls", "Connected sales calls a month", 100000, 20000, 300000, 5000, "", "brief"],
  ["auditHours", "QA auditor hours a month today", 870, 100, 2000, 10, "h", "brief"],
  ["fatalRate", "Calls with a fatal error", 18.3, 1, 40, 0.1, "%", "brief"],
  ["saleRate", "Calls that end in a sale", 19.3, 5, 40, 0.1, "%", "data pack"],
  ["avgPremium", "Average premium per sale", 22056, 5000, 60000, 500, "₹", "data pack"],
  ["freeLook", "Sales cancelled in free-look", 5.3, 0, 15, 0.1, "%", "brief"],
  ["complaints", "Complaints per 1,000 sales", 30, 0, 100, 1, "", "brief"],
  ["aiCost", "AI cost per scored call", 0.7, 0.1, 5, 0.05, "₹", "our estimate"],
  ["auditorRate", "Loaded cost of an auditor hour", 350, 150, 1500, 10, "₹", "assumption"],
  ["reviewMin", "Human minutes per reviewed call", 3, 1, 20, 0.5, "min", "assumption"],
  ["disputeRate", "Other calls sent to a human (unsure)", 2, 0, 20, 0.5, "%", "assumption"],
  ["complaintCost", "Cost to handle one complaint", 1500, 0, 10000, 100, "₹", "assumption"],
  ["flReduce", "Free-look cancellations avoided", 20, 0, 60, 1, "%", "assumption"],
  ["cmpReduce", "Complaints avoided", 25, 0, 80, 1, "%", "assumption"],
  ["platform", "Platform, hosting and support a month", 200000, 0, 1500000, 10000, "₹", "assumption"],
  ["build", "One-time build and rollout", 2500000, 0, 20000000, 100000, "₹", "assumption"],
];
let ROI = null;

function roiCalc(v) {
  const sales = v.calls * v.saleRate / 100;
  const today = { qa: v.auditHours * v.auditorRate, refunds: sales * v.freeLook / 100 * v.avgPremium, complaints: sales / 1000 * v.complaints * v.complaintCost };
  const fatalSales = sales * v.fatalRate / 100;
  const reviewCalls = fatalSales + v.calls * v.disputeRate / 100;
  const reviewHours = reviewCalls * v.reviewMin / 60;
  const cc = { ai: v.calls * v.aiCost, review: reviewHours * v.auditorRate, platform: v.platform,
    refunds: today.refunds * (1 - v.flReduce / 100), complaints: today.complaints * (1 - v.cmpReduce / 100) };
  const totToday = today.qa + today.refunds + today.complaints;
  const totCC = cc.ai + cc.review + cc.platform + cc.refunds + cc.complaints;
  const net = totToday - totCC;
  // break-even free-look reduction (other levers unchanged)
  const fixedCC = cc.ai + cc.review + cc.platform + cc.complaints;
  const be = today.refunds ? Math.max(0, (fixedCC - today.qa - today.complaints) / today.refunds) * 100 : null;
  return { sales, fatalSales, reviewCalls, reviewHours, today, cc, totToday, totCC, net, be, payback: net > 0 ? v.build / net : null,
    perCall: (cc.ai + cc.review + cc.platform) / v.calls, coverage: 100, hoursFreed: v.auditHours - reviewHours };
}

const ROI_MAIN = ["calls", "flReduce", "cmpReduce", "aiCost"];   // the four numbers most people want to try
const ROI_SC = { low: { flReduce: 8, cmpReduce: 10, auditorRate: 300 }, base: { flReduce: 20, cmpReduce: 25, auditorRate: 350 }, high: { flReduce: 35, cmpReduce: 40, auditorRate: 450 } };
let roiScen = "base";

function roiSlider([k, l, d, mn, mx, st, u, src]) {
  return `<label class="sl"><span>${l} <span class="chip ${src === "assumption" || src === "our estimate" ? "MAJOR" : "ink"} tiny">${src === "brief" || src === "data pack" ? "from the brief" : "our estimate"}</span></span>
    <span class="sl-row"><input type="range" min="${mn}" max="${mx}" step="${st}" value="${ROI[k]}" data-k="${k}"><output id="o-${k}"></output></span></label>`;
}

function renderROI() {
  ROI = ROI || Object.fromEntries(ROI_IN.map((r) => [r[0], Store.get("roi", {})[r[0]] ?? r[2]]));
  $("#v-roi").innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>P&amp;L and ROI</h2><p>What CallCoach saves PolicyNest each month, after paying for itself. Pick how optimistic to be; everything else is already filled in from the brief.</p></div></div>
  <div class="roi-pick" role="group" aria-label="How optimistic">
    ${[["low", "Cautious", "8% fewer refunds"], ["base", "Likely", "20% fewer refunds"], ["high", "Strong", "35% fewer refunds"]].map(([k, l, d]) => `<button data-s="${k}" class="${roiScen === k ? "on" : ""}"><b>${l}</b><span>${d}</span></button>`).join("")}
  </div>
  <div class="roi-answer" id="roi-hero"></div>
  <div class="grid2 roi-g" style="margin-top:16px">
    <div class="panel"><h3>Where the money comes from</h3><p class="small muted" style="margin:2px 0 12px">Each month, compared with today.</p><div id="roi-bridge"></div></div>
    <div class="panel"><h3>In plain words</h3><ul class="roi-plain" id="roi-plain"></ul></div>
  </div>
  <details class="panel roi-more" style="margin-top:16px"><summary>Change the numbers</summary>
    <p class="small muted">Move a slider and the answer above updates.</p>
    <div class="roi-in">${ROI_IN.filter((r) => ROI_MAIN.includes(r[0])).map(roiSlider).join("")}</div>
    <details class="roi-all"><summary class="small">All ${ROI_IN.length - ROI_MAIN.length} other assumptions</summary><div class="roi-in">${ROI_IN.filter((r) => !ROI_MAIN.includes(r[0])).map(roiSlider).join("")}</div></details>
    <button class="btn ghost small" id="roi-reset" style="margin-top:12px">Reset to defaults</button>
  </details>
  <details class="panel roi-more" style="margin-top:12px"><summary>Full monthly P&amp;L table</summary><div class="tablewrap" style="border:0"><table class="t" id="roi-t"></table></div></details>`;
  $$("#v-roi input[type=range]").forEach((i) => i.oninput = () => { ROI[i.dataset.k] = +i.value; Store.set("roi", ROI); drawROI(); });
  $("#roi-reset").onclick = () => { ROI = null; roiScen = "base"; Store.del("roi"); renderROI(); };
  $$(".roi-pick button").forEach((b) => b.onclick = () => {
    roiScen = b.dataset.s; $$(".roi-pick button").forEach((x) => x.classList.toggle("on", x === b));
    Object.assign(ROI, ROI_SC[roiScen]); Store.set("roi", ROI);
    for (const [k, v] of Object.entries(ROI_SC[roiScen])) { const i = $(`#v-roi input[data-k="${k}"]`); if (i) i.value = v; }
    drawROI();
  });
  drawROI();
}

function drawROI() {
  const v = ROI, r = roiCalc(v);
  for (const [k, , , , , , u] of ROI_IN) { const o = $("#o-" + k); if (o) o.textContent = u === "₹" ? (v[k] >= 1e5 ? crore(v[k]) : "₹" + (+v[k]).toLocaleString("en-IN")) : (+v[k]).toLocaleString("en-IN") + (u === "%" ? "%" : u ? " " + u : ""); }
  const pay = r.payback == null ? "never" : r.payback < 1 ? `${Math.max(1, Math.round(r.payback * 30))} days` : `${r.payback.toFixed(1)} months`;
  $("#roi-hero").innerHTML = `<div class="ra-main"><span>Saved each month</span><b class="${r.net >= 0 ? "up" : "down"}">${crore(r.net)}</b><span class="small">${crore(r.net * 12)} a year</span></div>
    <div class="ra-side"><div><span>Pays back the ${crore(v.build)} build in</span><b>${pay}</b></div><div><span>Calls checked</span><b>3% → 100%</b></div></div>`;
  const items = [["Less manual auditing", r.today.qa - r.cc.review, `${Math.round(Math.max(0, r.hoursFreed))} auditor hours a month freed for coaching`],
    ["Fewer free-look refunds", r.today.refunds - r.cc.refunds, `${v.flReduce}% fewer cancellations, because customers hear the right terms`],
    ["Fewer complaints", r.today.complaints - r.cc.complaints, `${v.cmpReduce}% fewer complaints to handle`],
    ["Cost of running CallCoach", -(r.cc.ai + r.cc.platform), `AI on every call plus hosting and support`]];
  const max = Math.max(...items.map((i) => Math.abs(i[1])), 1);
  $("#roi-bridge").innerHTML = items.map(([l, x, d]) => `<div class="br-row"><div class="br-l"><b>${l}</b><span class="small muted">${d}</span></div>
      <div class="br-v ${x >= 0 ? "up" : "down"}">${x >= 0 ? "+" : "−"}${crore(Math.abs(x))}</div><div class="br-bar"><i class="${x >= 0 ? "up" : "down"}" style="width:${Math.abs(x) / max * 100}%"></i></div></div>`).join("")
    + `<div class="br-row tot"><div class="br-l"><b>Saved each month</b></div><div class="br-v ${r.net >= 0 ? "up" : "down"}">${crore(r.net)}</div></div>`;
  $("#roi-plain").innerHTML = [
    `Today auditors hear 3 calls in 100. CallCoach checks all ${(+v.calls).toLocaleString("en-IN")} calls a month for about ₹${r.perCall.toFixed(2)} each.`,
    `People only listen to the ${Math.round(r.reviewCalls).toLocaleString("en-IN")} calls the AI flags, so auditing drops from ${Math.round(v.auditHours)} to ${Math.round(r.reviewHours)} hours.`,
    r.be <= 0 ? "The auditing saving alone covers the running cost, so every avoided refund is extra profit." : `It breaks even once free-look cancellations fall by ${r.be.toFixed(1)}%.`,
    `Even in the cautious case it saves ${crore(roiCalc({ ...v, ...ROI_SC.low }).net)} a month.`].map((t) => `<li>${t}</li>`).join("");
  const row = (l, a, b, bold) => `<tr${bold ? ' class="tot"' : ""}><td>${l}</td><td class="num">${a == null ? "–" : crore(a)}</td><td class="num">${b == null ? "–" : crore(b)}</td><td class="num ${a != null && b != null ? (a - b >= 0 ? "up" : "down") : ""}">${a != null && b != null ? crore(a - b) : ""}</td></tr>`;
  $("#roi-t").innerHTML = `<thead><tr><th>Per month</th><th class="num">Today</th><th class="num">With CallCoach</th><th class="num">Difference</th></tr></thead><tbody>
    ${row("QA auditing (3% heard)", r.today.qa, null)}
    ${row(`Human review (${Math.round(r.reviewCalls).toLocaleString("en-IN")} calls, ${Math.round(r.reviewHours)} h)`, null, r.cc.review)}
    ${row("AI scoring of every call", null, r.cc.ai)}
    ${row("Platform and support", null, r.cc.platform)}
    ${row("Free-look refunds", r.today.refunds, r.cc.refunds)}
    ${row("Complaint handling", r.today.complaints, r.cc.complaints)}
    ${row("Total", r.totToday, r.totCC, true)}</tbody>
    <tfoot><tr><td colspan="4" class="small muted">Refunds are premium returned, a stand-in for lost revenue; commission effects are not modelled.</td></tr></tfoot>`;
}

RENDER.roi = () => renderROI(); ALWAYS.add("roi");
