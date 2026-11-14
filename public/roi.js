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
let ROI = null, roiChart = null;

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

function renderROI() {
  ROI = ROI || Object.fromEntries(ROI_IN.map((r) => [r[0], Store.get("roi", {})[r[0]] ?? r[2]]));
  $("#v-roi").innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>P&amp;L and ROI</h2><p>A monthly view for the whole floor. Numbers tagged <span class="chip ink">brief</span> or <span class="chip ink">data pack</span> come from PS-04; <span class="chip MAJOR">assumption</span> are ours, so move them and argue with them.</p></div>
    <div class="seg" id="roi-sc"><button data-s="low">Cautious</button><button data-s="base" class="on">Base</button><button data-s="high">Strong</button></div></div>
  <div class="grid-roi">
    <div class="panel roi-in">${ROI_IN.map(([k, l, d, mn, mx, st, u, src]) => `<label class="sl"><span>${l} <span class="chip ${src === "assumption" ? "MAJOR" : "ink"} tiny">${src}</span></span>
      <span class="sl-row"><input type="range" min="${mn}" max="${mx}" step="${st}" value="${ROI[k]}" data-k="${k}"><output id="o-${k}"></output></span></label>`).join("")}
      <button class="btn ghost small" id="roi-reset">Reset to defaults</button></div>
    <div><div class="roi-hero" id="roi-hero"></div>
      <div class="panel" style="margin-top:16px"><h3>Monthly P&amp;L: today vs with CallCoach</h3><div class="chartbox" style="height:260px"><canvas id="roi-ch"></canvas></div></div>
      <div class="panel" style="margin-top:16px"><div class="tablewrap" style="border:0"><table class="t" id="roi-t"></table></div></div>
      <div class="panel" style="margin-top:16px"><h3>If the refund saving is smaller</h3><p class="small muted" style="margin:2px 0 10px">Net monthly benefit at different free-look reductions, other inputs as set.</p><div class="tablewrap" style="border:0"><table class="t" id="roi-sens"></table></div></div>
    </div></div>`;
  $$("#v-roi input[type=range]").forEach((i) => i.oninput = () => { ROI[i.dataset.k] = +i.value; Store.set("roi", ROI); drawROI(); });
  $("#roi-reset").onclick = () => { ROI = null; Store.del("roi"); renderROI(); };
  $$("#roi-sc button").forEach((b) => b.onclick = () => {
    $$("#roi-sc button").forEach((x) => x.classList.toggle("on", x === b));
    const S = { low: { flReduce: 8, cmpReduce: 10, auditorRate: 300 }, base: { flReduce: 20, cmpReduce: 25, auditorRate: 350 }, high: { flReduce: 35, cmpReduce: 40, auditorRate: 450 } }[b.dataset.s];
    Object.assign(ROI, S); Store.set("roi", ROI);
    for (const [k, v] of Object.entries(S)) { const i = $(`#v-roi input[data-k="${k}"]`); if (i) i.value = v; }
    drawROI();
  });
  drawROI();
}

function drawROI() {
  const v = ROI, r = roiCalc(v);
  for (const [k, , , , , , u] of ROI_IN) $("#o-" + k).textContent = u === "₹" ? (v[k] >= 1e5 ? crore(v[k]) : "₹" + (+v[k]).toLocaleString("en-IN")) : (+v[k]).toLocaleString("en-IN") + (u === "%" ? "%" : u ? " " + u : "");
  $("#roi-hero").innerHTML = `<div class="rh"><span>Net benefit a month</span><b class="${r.net >= 0 ? "up" : "down"}">${crore(r.net)}</b></div>
    <div class="rh"><span>A year</span><b>${crore(r.net * 12)}</b></div>
    <div class="rh"><span>Payback on the build</span><b>${r.payback == null ? "never" : r.payback < 1 ? Math.max(1, Math.round(r.payback * 30)) + " days" : r.payback.toFixed(1) + " months"}</b></div>
    <div class="rh"><span>Break-even</span><b>${r.be == null ? "–" : r.be <= 0 ? "Day one" : r.be.toFixed(1) + "%"}</b><span class="small">${r.be <= 0 ? "QA savings alone cover the running cost" : "fewer free-look cancellations needed to cover costs"}</span></div>`;
  const row = (l, a, b, bold) => `<tr${bold ? ' class="tot"' : ""}><td>${l}</td><td class="num">${a == null ? "–" : crore(a)}</td><td class="num">${b == null ? "–" : crore(b)}</td><td class="num ${a != null && b != null ? (a - b >= 0 ? "up" : "down") : ""}">${a != null && b != null ? crore(a - b) : ""}</td></tr>`;
  $("#roi-t").innerHTML = `<thead><tr><th>Per month</th><th class="num">Today</th><th class="num">With CallCoach</th><th class="num">Difference</th></tr></thead><tbody>
    ${row("QA auditing (3% heard)", r.today.qa, null)}
    ${row(`Human review (${Math.round(r.reviewCalls).toLocaleString("en-IN")} calls, ${Math.round(r.reviewHours)} h)`, null, r.cc.review)}
    ${row("AI scoring of every call", null, r.cc.ai)}
    ${row("Platform and support", null, r.cc.platform)}
    ${row("Free-look refunds", r.today.refunds, r.cc.refunds)}
    ${row("Complaint handling", r.today.complaints, r.cc.complaints)}
    ${row("Total", r.totToday, r.totCC, true)}</tbody>
    <tfoot><tr><td colspan="4" class="small muted">Calls heard: 3% today, 100% with CallCoach. Reviewer time: ${Math.round(v.auditHours).toLocaleString("en-IN")} h today, ${Math.round(r.reviewHours)} h with CallCoach, so ${Math.round(Math.max(0, r.hoursFreed))} h a month go to coaching instead. AI cost per call ₹${(+v.aiCost).toFixed(2)}; all-in with human review and platform ₹${r.perCall.toFixed(2)}. Refunds are premium returned, a stand-in for lost revenue; commission effects are not modelled.</td></tr></tfoot>`;
  $("#roi-sens").innerHTML = `<thead><tr><th>Free-look cancellations avoided</th>${[0, 5, 10, 20, 30, 40].map((x) => `<th class="num">${x}%</th>`).join("")}</tr></thead><tbody><tr><td>Net benefit a month</td>${[0, 5, 10, 20, 30, 40].map((x) => { const n = roiCalc({ ...v, flReduce: x }).net; return `<td class="num ${n >= 0 ? "up" : "down"}">${crore(n)}</td>`; }).join("")}</tr></tbody>`;
  if (!window.Chart) return;
  const data = { labels: ["Today", "With CallCoach"], datasets: [
    { label: "QA and review", data: [r.today.qa, r.cc.review], backgroundColor: "#7C86A2" },
    { label: "AI and platform", data: [0, r.cc.ai + r.cc.platform], backgroundColor: "#3E6FD8" },
    { label: "Free-look refunds", data: [r.today.refunds, r.cc.refunds], backgroundColor: "#D6453D" },
    { label: "Complaint handling", data: [r.today.complaints, r.cc.complaints], backgroundColor: "#C8741A" }] };
  if (roiChart) { roiChart.data = data; roiChart.update(); return; }
  roiChart = new Chart($("#roi-ch"), { type: "bar", data, options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${crore(c.raw)}` } } },
    scales: { x: { stacked: true, ticks: { callback: (x) => crore(x) }, grid: { color: "#EEF1F6" } }, y: { stacked: true, grid: { display: false } } } } });
}

RENDER.roi = () => { roiChart?.destroy(); roiChart = null; renderROI(); }; ALWAYS.add("roi");
