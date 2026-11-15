/* Customer recovery: fatal errors on calls that became sales get a callback with the correct facts, tracked to resolution. */
const COLS = [["awaiting", "Awaiting review", "AI found a fatal error on a sale. A reviewer confirms before anyone calls the customer."],
  ["tocall", "To call", "Confirmed. Assign the callback to an agent; call within 48 hours."], ["contacted", "Callback done", "The agent logged the outcome. The team lead checks it and closes the case."],
  ["resolved", "Resolved", ""]];
const OUTCOMES = { retained: "Kept the policy, now fully informed", cancelled: "Cancelled in free-look, refund started", escalated: "Escalated to insurer or compliance", unreachable: "Unreachable after 3 attempts", noaction: "No action: reviewer overturned the finding" };
const OWNERS = ["Retention desk", "Compliance"];
/* Agents a callback can go to: the team of the call's team lead (a TL only sees their own team). */
function teamAgents(call) {
  const tl = window.role && role().role === "tl" ? Auth.user().team : call?.team_lead_id;
  return (D.agents?.agents || []).filter((a) => !tl || a.team_lead_id === tl);
}
/* Snapshot of what an agent needs to make the callback, since agents can't open other agents' calls. */
function caseSnap(id) {
  const call = callOf(id); if (!call) return null;
  const s = call.scored?.[D.modes[0]] || {}, doc = planFor(call);
  return { agent: call.agent, agent_id: call.agent_id, product: call.product, premium: call.premium, plan: doc?.name || "", otp: !!s.conduct_alert,
    ev: (cases()[id]?.fatal || s.fatal || []).map((p) => ({ p, quote: s.results?.[p]?.quote || "", turns: s.results?.[p]?.turns || [] })) };
}
const SLA_H = 48;

function cases() { return Store.get("cases", {}); }
function saveCases(c) { Store.set("cases", c); updateBadges(); }

function seedCases() {
  const c = cases(); let i = 0, changed = false; const now = Date.now();
  for (const call of D.calls) {
    const s = call.scored[D.modes[0]];
    const old = c[call.id];
    if (old && old.age == null && old.source === "AI flag on a sale" && old.status === "awaiting") { old.age = Math.round((Date.now() - old.opened) / 3600e3) % 46; changed = true; }   // older demo data
    if (!(s.fatal.length && call.outcome === "SALE") || old) continue;
    // demo clock: stagger opening times so the SLA timers differ
    c[call.id] = { id: call.id, opened: now, age: (i++ * 7) % 46, status: "awaiting", owner: "", fatal: s.fatal, notes: [], source: "AI flag on a sale" };
    changed = true;
  }
  if (changed) saveCases(c);
}

async function openCase(x, fatal, why) {
  const c = cases(), k = x.id;
  if (!c[k]) c[k] = { id: k, opened: Date.now(), status: "tocall", owner: "", fatal, notes: [], source: why };
  else if (c[k].status === "awaiting") { c[k].status = "tocall"; c[k].confirmed = Date.now(); }
  c[k].fatal = fatal; saveCases(c);
  await Trail.add("Recovery case ready to call", k, `${why}: ${fatal.join(", ")}`);
}
async function closeIfOverturned(x) {
  const c = cases();
  if (c[x.id] && c[x.id].status === "awaiting") { c[x.id].status = "resolved"; c[x.id].outcome = "noaction"; c[x.id].closed = Date.now(); saveCases(c);
    await Trail.add("Recovery case closed", x.id, OUTCOMES.noaction); }
}

/* Sample cases keep a fixed "age" so the demo clock never drifts into everything being overdue. */
function openedAt(cs) { return cs.age != null ? Date.now() - cs.age * 3600e3 : cs.opened; }
function waitedH(cs) { return Math.max(0, Math.round((Date.now() - openedAt(cs)) / 3600e3)); }
/* The 48-hour callback target starts once a reviewer confirms the finding (To call / Contacted). */
function slaStart(cs) { return cs.confirmed || openedAt(cs); }
function isOverdue(cs) { return (cs.status === "tocall" || cs.status === "contacted") && slaStart(cs) + SLA_H * 3600e3 < Date.now(); }
function sla(cs) {
  if (cs.status === "resolved") return "";
  if (cs.status === "awaiting") { const h = waitedH(cs); return `<span class="chip ${h >= 24 ? "MAJOR" : "NA"}" title="Time since the AI flagged this call">Waiting ${h < 1 ? "under 1h" : h + "h"}</span>`; }
  const left = slaStart(cs) + SLA_H * 3600e3 - Date.now(), h = Math.round(Math.abs(left) / 3600e3);
  return left < 0 ? `<span class="chip FATAL">Overdue ${h}h</span>` : `<span class="chip ${h < 12 ? "MAJOR" : "NA"}">Call within ${h}h</span>`;
}
let recSort = "desc";   // Awaiting review: longest waiting first
function callOf(id) { return D.calls.find((c) => c.id === id) || Store.get("liveQueue", []).find((x) => x.id === id)?.call; }
function planFor(call) {
  const txt = call.turns.map((t) => t.t).join(" ").toLowerCase();
  let best = null, sc = 0;
  for (const d of policyDocs()) {
    const w = d.name.toLowerCase().match(/[a-z]{3,}/g).filter((x) => !["insurer", "policy", "with", "the", "wording"].includes(x));
    const s = w.filter((x) => txt.includes(x)).length; if (s > sc) { best = d; sc = s; }
  }
  return sc >= 2 ? best : null;
}

function renderRecovery() {
  seedCases();
  const all = Object.values(cases()).filter((c) => callOf(c.id) && (!window.roleSeesCall || roleSeesCall(callOf(c.id)))), el = $("#v-recovery");
  const res = all.filter((c) => c.status === "resolved"), prem = (k) => res.filter((c) => c.outcome === k).reduce((a, c) => a + (callOf(c.id)?.premium || 0), 0);
  const overdue = all.filter(isOverdue).length, waiting = all.filter((c) => c.status === "awaiting").length;
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Customer recovery</h2><p>When a fatal error happened on a call that became a sale, the customer may not have the full picture. A friendly courtesy call walks them through the key terms. Each case comes with a script that has this plan's facts filled in.</p></div></div>
  <div class="kpis k5">
    <div class="kpi fatal"><b>${all.filter((c) => c.status !== "resolved").length}</b><span>open cases</span></div>
    <button class="kpi ${overdue ? "fatal" : "pass"} kpi-btn" id="rec-overdue" title="${overdue ? "Highlight the overdue cases" : "Every confirmed case is within its 48-hour callback target"}"><b>${overdue}</b><span>${overdue ? "past the 48-hour callback target" : "overdue callbacks"}</span></button>
    <div class="kpi pass"><b>${res.length}</b><span>resolved</span></div>
    <div class="kpi"><b>${crore(prem("retained"))}</b><span>premium kept, customer now informed</span></div>
    <div class="kpi"><b>${crore(prem("cancelled"))}</b><span>refunded in free-look</span></div>
  </div>
  <p class="small muted" style="margin:10px 0 0">${waiting} case${waiting === 1 ? "" : "s"} waiting for a reviewer. The 48-hour callback target starts when a reviewer confirms the finding.</p>
  <div class="board">${COLS.map(([k, name, hint]) => {
    const cs = all.filter((c) => c.status === k).sort((a, b) => k === "awaiting" ? (recSort === "desc" ? openedAt(a) - openedAt(b) : openedAt(b) - openedAt(a)) : k === "resolved" ? (b.closed || 0) - (a.closed || 0) : slaStart(a) - slaStart(b));
    return `<div class="col"><div class="col-h"><b>${name}</b><span class="chip NA">${cs.length}</span></div>${hint ? `<p class="small muted">${hint}</p>` : ""}
      ${k === "awaiting" && cs.length > 1 ? `<button class="sortbtn small" id="rec-sort" aria-label="Change sort order">${recSort === "desc" ? "Longest waiting first ↓" : "Newest first ↑"}</button>` : ""}
      ${cs.map((c) => caseCard(c)).join("") || `<div class="empty small">Nothing here</div>`}</div>`;
  }).join("")}</div>`;
  $$(".case [data-act]", el).forEach((b) => b.onclick = () => caseAction(b.dataset.id, b.dataset.act));
  $("#rec-sort")?.addEventListener("click", () => { recSort = recSort === "desc" ? "asc" : "desc"; renderRecovery(); });
  $("#rec-overdue").onclick = () => {
    const od = $$(".case.overdue", el); if (!od.length) return toast("No overdue callbacks. Every confirmed case is within 48 hours.");
    od[0].scrollIntoView({ behavior: "smooth", block: "center" }); od.forEach((x) => { x.classList.remove("flash"); void x.offsetWidth; x.classList.add("flash"); });
  };
  $$(".case select[data-owner]", el).forEach((s) => s.onchange = () => assignCase(s.dataset.owner, s.value));
}

function caseCard(c) {
  const call = callOf(c.id); if (!call) return "";
  const plan = planFor(call), rep = c.report, isTL = !window.role || ["tl", "admin"].includes(role().role);
  const assign = `<select data-owner="${c.id}" aria-label="Assign the callback"><option value="">${c.assignee || c.owner ? "Reassign to…" : "Assign callback to…"}</option>
      <optgroup label="Agents">${teamAgents(call).map((a) => `<option value="agent:${a.id}" ${c.assignee === a.id ? "selected" : ""}>${esc(a.name)} (${a.id})${a.id === call.agent_id ? ", sold this policy" : ""}</option>`).join("")}</optgroup>
      <optgroup label="Teams">${OWNERS.map((o) => `<option value="team:${o}" ${!c.assignee && o === c.owner ? "selected" : ""}>${o}</option>`).join("")}</optgroup></select>`;
  return `<div class="case ${isOverdue(c) ? "overdue" : ""} ${rep && !c.approved ? "pending" : ""}"><div class="case-h"><b>${c.id}</b>${sla(c)}</div>
    <div class="small">${esc(call.agent)}, ${plan ? esc(plan.name.replace(/ with zero depreciation/, "")) : String(call.product).toLowerCase()}${call.premium ? `, ${inr(call.premium)}` : ""}</div>
    <div class="routes" style="margin:6px 0">${c.fatal.map((p) => `<span class="chip FATAL">${p} ${esc(pname(p))}</span>`).join("")}</div>
    ${c.status === "awaiting" ? (window.role && role().role === "tl" ? `<span class="chip REVIEW">Waiting for a QA reviewer</span>` : `<button class="btn ghost small" data-act="review" data-id="${c.id}">Review the finding</button>`) : ""}
    ${c.status === "tocall" ? `${c.assignee ? `<div class="assigned">${svg("agents", 14)} <span><b>${esc(c.assigneeName)}</b> is making this callback<span class="small muted">Assigned ${when(c.assigned)}${c.sentBack ? `. Sent back: ${esc(c.sentBack)}` : ""}</span></span></div>` : ""}
      ${isTL ? assign : ""}
      <div class="cta" style="margin-top:8px"><button class="btn ${c.assignee ? "ghost " : ""}small" data-act="script" data-id="${c.id}">Callback script</button>${c.assignee ? "" : `<button class="btn ghost small" data-act="contacted" data-id="${c.id}">Mark contacted</button>`}</div>` : ""}
    ${c.status === "contacted" && rep ? `<div class="report"><div class="small muted">${esc(rep.byName)} logged the callback ${when(rep.ts)}</div>
        <b>${esc(OUTCOMES[rep.outcome])}</b>${rep.note ? `<p class="small">“${esc(rep.note)}”</p>` : ""}${rep.scripted ? `<span class="small muted">Used the courtesy script</span>` : ""}</div>
      ${isTL ? `<div class="cta" style="margin-top:8px"><button class="btn small" data-act="approve" data-id="${c.id}">Approve and close</button><button class="btn ghost small" data-act="sendback" data-id="${c.id}">Send back</button></div>` : `<span class="chip REVIEW">Waiting for the team lead's approval</span>`}` : ""}
    ${c.status === "contacted" && !rep ? `<div class="cta" style="margin-top:4px"><button class="btn small" data-act="resolve" data-id="${c.id}">Record outcome</button><button class="btn ghost small" data-act="script" data-id="${c.id}">Script</button></div>` : ""}
    ${c.status === "resolved" ? `<span class="chip ${c.outcome === "retained" || c.outcome === "noaction" ? "MET" : c.outcome === "cancelled" ? "MAJOR" : "NA"}">${esc(OUTCOMES[c.outcome] || c.outcome)}</span>${c.approved ? `<div class="small muted" style="margin-top:6px">Callback by ${esc(c.assigneeName || c.report?.byName || "")}, approved by ${esc(c.approved.by)}</div>` : ""}` : ""}
    ${c.owner && !c.assignee && c.status !== "tocall" && c.status !== "resolved" ? `<div class="small muted" style="margin-top:6px">Owner: ${esc(c.owner)}</div>` : ""}</div>`;
}

async function assignCase(id, val) {
  if (!val) return;
  const c = cases(), cs = c[id], [kind, who] = val.split(/:(.*)/);
  if (kind === "agent") {
    const a = D.agents.agents.find((x) => x.id === who);
    Object.assign(cs, { assignee: a.id, assigneeName: a.name, assigned: Date.now(), owner: a.name, snap: caseSnap(id), assignedBy: me().name });
    if (!cs.confirmed) cs.confirmed = Date.now();
    saveCases(c); await Trail.add("Callback assigned", id, `${a.name} (${a.id}) by ${me().name}`);
    toast(`${a.name.split(" ")[0]} will see this callback on their dashboard`);
  } else {
    delete cs.assignee; delete cs.assigneeName; cs.owner = who; saveCases(c); await Trail.add("Recovery case assigned", id, who);
  }
  renderRecovery();
}

/* Agent logs the callback; the case waits for the team lead's approval. */
function logCallback(id, after) {
  const cs = cases()[id];
  const body = drawer(`<h2>Log the callback for ${id}</h2><p class="small muted" style="margin:6px 0 14px">Your team lead checks this before the case is closed.</p>
    ${Object.entries(OUTCOMES).filter(([k]) => k !== "noaction").map(([k, v]) => `<label class="radio"><input type="radio" name="oc" value="${k}"> ${v}</label>`).join("")}
    <label class="fld">What the customer said<textarea id="oc-note" style="min-height:80px" placeholder="For example: understood the 3-year waiting period and is happy to keep the policy"></textarea></label>
    <label class="toggle" style="margin-top:10px"><input type="checkbox" id="oc-script" checked> I used the courtesy call script and shared the key terms</label>
    <div class="cta" style="margin-top:14px"><button class="btn" id="oc-save">Send to my team lead</button><button class="btn ghost" id="oc-sc">Open the script</button></div>`);
  $("#oc-sc", body).onclick = () => showScript(id);
  $("#oc-save", body).onclick = async () => {
    const v = $("input[name=oc]:checked", body)?.value, note = $("#oc-note", body).value.trim();
    if (!v) return toast("Pick what the customer decided");
    if (note.length < 8) return toast("Add a short note on what the customer said");
    const c = cases(); Object.assign(c[id], { status: "contacted", contacted: Date.now(), sentBack: "",
      report: { outcome: v, note, scripted: $("#oc-script", body).checked, by: me().id, byName: me().name, ts: Date.now() } });
    c[id].notes.push({ ts: Date.now(), by: me().name, text: `Callback logged: ${OUTCOMES[v]}. ${note}` }); saveCases(c);
    await Trail.add("Callback logged by agent", id, `${OUTCOMES[v]}: ${note.slice(0, 120)}`);
    closeDrawer(); toast("Sent to your team lead for approval"); after && after();
  };
}

async function caseAction(id, act) {
  if (act === "review") { Store.set("reviewOpen", id); rvTab = "queue"; rvFilter = "all"; location.hash = "#review"; return; }
  if (act === "script") return showScript(id);
  if (!needMe()) return;
  const c = cases();
  if (act === "approve") {
    const cs = c[id]; Object.assign(cs, { status: "resolved", outcome: cs.report.outcome, closed: Date.now(), approved: { by: me().name, ts: Date.now() } });
    cs.notes.push({ ts: Date.now(), by: me().name, text: "Approved the callback outcome" }); saveCases(c);
    await Trail.add("Callback approved", id, `${OUTCOMES[cs.outcome]}, callback by ${cs.report.byName}`); toast("Approved. Case closed."); return renderRecovery();
  }
  if (act === "sendback") {
    const body = drawer(`<h2>Send ${id} back to ${esc(c[id].report.byName)}</h2><p class="small muted" style="margin:6px 0 14px">Say what's missing. The callback goes back to their list.</p>
      <label class="fld">Reason<textarea id="sb-why" style="min-height:80px" placeholder="For example: please confirm the customer understood the co-payment"></textarea></label>
      <div class="cta" style="margin-top:14px"><button class="btn" id="sb-go">Send back</button></div>`);
    $("#sb-go", body).onclick = async () => {
      const why = $("#sb-why", body).value.trim(); if (!why) return toast("Add a reason");
      const cc = cases(), cs = cc[id]; cs.notes.push({ ts: Date.now(), by: me().name, text: `Sent back: ${why}` });
      Object.assign(cs, { status: "tocall", sentBack: why, report: null }); saveCases(cc);
      await Trail.add("Callback sent back", id, why); closeDrawer(); renderRecovery();
    };
    return;
  }
  if (act === "contacted") { c[id].status = "contacted"; c[id].contacted = Date.now(); saveCases(c); await Trail.add("Customer contacted", id, c[id].owner || "unassigned"); return renderRecovery(); }
  if (act === "resolve") {
    const body = drawer(`<h2>Record the outcome for ${id}</h2><p class="small muted" style="margin:6px 0 14px">What did the customer decide after hearing the correct terms?</p>
      ${Object.entries(OUTCOMES).filter(([k]) => k !== "noaction").map(([k, v]) => `<label class="radio"><input type="radio" name="oc" value="${k}"> ${v}</label>`).join("")}
      <label class="fld">Note<textarea id="oc-note" style="min-height:80px" placeholder="What the customer said"></textarea></label>
      <div class="cta" style="margin-top:14px"><button class="btn" id="oc-save">Save outcome</button></div>`);
    $("#oc-save", body).onclick = async () => {
      const v = $("input[name=oc]:checked", body)?.value; if (!v) return toast("Pick an outcome");
      const cc = cases(); cc[id].status = "resolved"; cc[id].outcome = v; cc[id].closed = Date.now(); cc[id].notes.push({ ts: Date.now(), by: me().name, text: $("#oc-note", body).value }); saveCases(cc);
      await Trail.add("Recovery case resolved", id, OUTCOMES[v] + ($("#oc-note", body).value ? `: ${$("#oc-note", body).value.slice(0, 120)}` : ""));
      closeDrawer(); renderRecovery();
    };
  }
}

function showScript(id) {
  const c = cases()[id], call = callOf(id), doc = call ? planFor(call) : policyDocs().find((d) => d.name === c.snap?.plan), f = doc?.facts || {};
  const plan = doc ? doc.name : "your policy";
  const ped = f.ped_wait_months ? `${f.ped_wait_months / 12} years` : null;
  const fix = {
    P5: doc && /HEALTH|hospital/i.test(doc.text) ? [
      `Any condition you already had when the policy started is covered after a waiting period of ${ped || "the period in your policy"}, and after that it's covered as per your policy terms.`,
      f.initial_wait_days ? `For new illnesses, cover starts after an initial ${f.initial_wait_days} days. Accidents are covered from day one.` : "",
      f.specific_wait_months ? `Some specific illnesses, such as cataract or hernia, have a ${f.specific_wait_months / 12}-year waiting period.` : "",
      f.room_rent_pct ? `Room rent is limited to ${f.room_rent_pct}% of your sum insured per day.` : "",
      f.copay_pct ? `There's a ${f.copay_pct}% co-payment on claims, which helps keep the premium lower.` : ""]
      : [f.deductible_inr ? `Every own-damage claim has a compulsory deductible of ${inr(f.deductible_inr)}.` : "",
        f.zero_dep_claims ? `Zero depreciation covers up to ${f.zero_dep_claims} claims a year.` : "",
        f.engine_water_excluded ? "Water damage to the engine needs the engine protect add-on. I can tell you how to add it if you'd like." : "",
        f.ncb_needs_proof ? "To carry over your no-claim bonus, just send us a copy of your previous policy and we'll apply it." : ""],
    P6: ["Claims are assessed by the insurer against the policy terms, which is how every insurer works. The quickest way to a smooth claim is to share full details and keep your documents handy, and we'll help you with that.",
      f.no_return_of_premium ? "This is a pure protection plan, so the premium covers you for the year rather than coming back as a payout." : ""],
    P2: ["This call is recorded for quality and training, which helps us serve you better."],
  };
  const lines = c.fatal.flatMap((p) => fix[p] || []).filter(Boolean);
  const otp = call ? call.scored?.[D.modes[0]]?.conduct_alert : c.snap?.otp;
  const ev = call ? c.fatal.map((p) => ({ p, ...(call.scored?.[D.modes[0]]?.results?.[p] || {}) })) : c.snap?.ev || [];
  drawer(`<h2>Courtesy call script: ${id}</h2><p class="small muted" style="margin:6px 0 16px">Filled in from ${doc ? `the policy wording for <b>${esc(plan)}</b>` : "the scorecard (no matching policy in the library)"}. Keep it warm and in your own words. The aim is a well-informed, confident customer.</p>
    <ol class="script">
      <li><b>Greet and set the tone.</b> “Hello, this is [your name] from PolicyNest Insurance Brokers. Congratulations again on your ${esc(plan)} policy. This call is recorded for quality and training. Do you have five minutes?”</li>
      <li><b>Say why you're calling.</b> “We call our new customers to walk through the key terms of their policy, so you know exactly how it works before you ever need it.”</li>
      <li><b>Share the key terms.</b><ul>${lines.map((l) => `<li>“${esc(l)}”</li>`).join("")}</ul></li>
      <li><b>Check understanding.</b> “Does that match what you were expecting? Is there anything you'd like me to go over again?”</li>
      <li><b>Mention their rights.</b> “As with every new policy, you have a free-look period${f.free_look_days ? ` of ${f.free_look_days} days` : ""} from receiving your documents to review it. If you'd like to change or cancel anything, just tell me and I'll take care of it.”</li>
      <li><b>Close.</b> “I'll email you a short summary with the policy wording. If anything comes up later, reply to that email or call us, and we'll help.”</li>
    </ol>
    ${otp ? `<div class="alert"><b>Security reminder for the customer.</b> Add: “A quick safety tip we share with all customers: PolicyNest will never ask for an OTP, PIN or card number on a call. If anyone has, please let your bank know.”</div>` : ""}
    <details class="staffnote"><summary>For staff only, never read this out</summary>
      <ul class="small">
        <li>Don't tell the customer the earlier call was wrong or blame a colleague. Present the facts positively as a standard walkthrough.</li>
        <li>Never pressure them to keep or cancel the policy, and don't promise anything the wording doesn't say.</li>
        <li>If they ask to cancel, process it within the free-look period without argument.</li>
        ${otp ? `<li>An OTP or card detail was asked for on this call: log a conduct case with compliance today.</li>` : ""}
        <li>${c.assignee ? "Log what the customer decided with “Log the callback”. Your team lead approves it before the case closes." : "Record what the customer decided under “Record outcome”."}</li>
      </ul>
      <p class="small muted">What the AI found on the original call (evidence):</p>${ev.map((r) => r.quote ? `<div class="said"><b>${r.p}</b> turn ${esc((r.turns || []).join(", "))}: <mark>${esc(r.quote)}</mark></div>` : "").join("")}
    </details>`, true);
}

RENDER.recovery = renderRecovery; ALWAYS.add("recovery");
ONBOOT.push(() => { seedCases(); updateBadges(); });
