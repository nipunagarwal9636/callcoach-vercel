/* Customer recovery: fatal errors on calls that became sales get a callback with the correct facts, tracked to resolution. */
const COLS = [["awaiting", "Awaiting review", "AI found a fatal error on a sale. A reviewer confirms before anyone calls the customer."],
  ["tocall", "To call", "Confirmed. Call within 48 hours of the flag."], ["contacted", "Contacted", "Customer reached; record what they decided."],
  ["resolved", "Resolved", ""]];
const OUTCOMES = { retained: "Kept the policy, now fully informed", cancelled: "Cancelled in free-look, refund started", escalated: "Escalated to insurer or compliance", unreachable: "Unreachable after 3 attempts", noaction: "No action: reviewer overturned the finding" };
const OWNERS = ["Retention desk", "Team lead", "Compliance"];
const SLA_H = 48;

function cases() { return Store.get("cases", {}); }
function saveCases(c) { Store.set("cases", c); updateBadges(); }

function seedCases() {
  const c = cases(); let i = 0, changed = false; const now = Date.now();
  for (const call of D.calls) {
    const s = call.scored[D.modes[0]];
    if (!(s.fatal.length && call.outcome === "SALE") || c[call.id]) continue;
    // demo clock: stagger opening times so the SLA timers differ
    c[call.id] = { id: call.id, opened: now - ((i++ * 7) % 46) * 3600e3, status: "awaiting", owner: "", fatal: s.fatal, notes: [], source: "AI flag on a sale" };
    changed = true;
  }
  if (changed) saveCases(c);
}

async function openCase(x, fatal, why) {
  const c = cases(), k = x.id;
  if (!c[k]) c[k] = { id: k, opened: Date.now(), status: "tocall", owner: "", fatal, notes: [], source: why };
  else if (c[k].status === "awaiting") c[k].status = "tocall";
  c[k].fatal = fatal; saveCases(c);
  await Trail.add("Recovery case ready to call", k, `${why}: ${fatal.join(", ")}`);
}
async function closeIfOverturned(x) {
  const c = cases();
  if (c[x.id] && c[x.id].status === "awaiting") { c[x.id].status = "resolved"; c[x.id].outcome = "noaction"; c[x.id].closed = Date.now(); saveCases(c);
    await Trail.add("Recovery case closed", x.id, OUTCOMES.noaction); }
}

function sla(cs) {
  if (cs.status === "resolved") return "";
  const left = cs.opened + SLA_H * 3600e3 - Date.now(), h = Math.round(Math.abs(left) / 3600e3);
  return left < 0 ? `<span class="chip FATAL">Overdue ${h}h</span>` : `<span class="chip ${h < 12 ? "MAJOR" : "NA"}">Due in ${h}h</span>`;
}
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
  const all = Object.values(cases()), el = $("#v-recovery");
  const res = all.filter((c) => c.status === "resolved"), prem = (k) => res.filter((c) => c.outcome === k).reduce((a, c) => a + (callOf(c.id)?.premium || 0), 0);
  const overdue = all.filter((c) => c.status !== "resolved" && c.opened + SLA_H * 3600e3 < Date.now()).length;
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Customer recovery</h2><p>When a fatal error happened on a call that became a sale, the customer bought on wrong information. The scorecard says: call them back and correct it. Each case comes with a script that has this plan's correct facts filled in.</p></div></div>
  <div class="kpis k5">
    <div class="kpi fatal"><b>${all.filter((c) => c.status !== "resolved").length}</b><span>open cases</span></div>
    <div class="kpi major"><b>${overdue}</b><span>past the 48-hour target</span></div>
    <div class="kpi pass"><b>${res.length}</b><span>resolved</span></div>
    <div class="kpi"><b>${crore(prem("retained"))}</b><span>premium kept, customer now informed</span></div>
    <div class="kpi"><b>${crore(prem("cancelled"))}</b><span>refunded in free-look</span></div>
  </div>
  <p class="small muted" style="margin:10px 0 0">Demo clock: opening times of the sample cases are staggered so the timers differ.</p>
  <div class="board">${COLS.map(([k, name, hint]) => {
    const cs = all.filter((c) => c.status === k).sort((a, b) => a.opened - b.opened);
    return `<div class="col"><div class="col-h"><b>${name}</b><span class="chip NA">${cs.length}</span></div>${hint ? `<p class="small muted">${hint}</p>` : ""}
      ${cs.map((c) => caseCard(c)).join("") || `<div class="empty small">Nothing here</div>`}</div>`;
  }).join("")}</div>`;
  $$(".case [data-act]", el).forEach((b) => b.onclick = () => caseAction(b.dataset.id, b.dataset.act));
  $$(".case select[data-owner]", el).forEach((s) => s.onchange = async () => {
    const c = cases(); c[s.dataset.owner].owner = s.value; saveCases(c); await Trail.add("Recovery case assigned", s.dataset.owner, s.value);
  });
}

function caseCard(c) {
  const call = callOf(c.id); if (!call) return "";
  const plan = planFor(call);
  return `<div class="case"><div class="case-h"><b>${c.id}</b>${sla(c)}</div>
    <div class="small">${esc(call.agent)}, ${plan ? esc(plan.name.replace(/ with zero depreciation/, "")) : String(call.product).toLowerCase()}${call.premium ? `, ${inr(call.premium)}` : ""}</div>
    <div class="routes" style="margin:6px 0">${c.fatal.map((p) => `<span class="chip FATAL">${p} ${esc(pname(p))}</span>`).join("")}</div>
    ${c.status === "awaiting" ? `<button class="btn ghost small" data-act="review" data-id="${c.id}">Review the finding</button>` : ""}
    ${c.status === "tocall" ? `<select data-owner="${c.id}"><option value="">Assign to…</option>${OWNERS.map((o) => `<option ${o === c.owner ? "selected" : ""}>${o}</option>`).join("")}</select>
      <div class="cta" style="margin-top:8px"><button class="btn small" data-act="script" data-id="${c.id}">Callback script</button><button class="btn ghost small" data-act="contacted" data-id="${c.id}">Mark contacted</button></div>` : ""}
    ${c.status === "contacted" ? `<div class="cta" style="margin-top:4px"><button class="btn small" data-act="resolve" data-id="${c.id}">Record outcome</button><button class="btn ghost small" data-act="script" data-id="${c.id}">Script</button></div>` : ""}
    ${c.status === "resolved" ? `<span class="chip ${c.outcome === "retained" || c.outcome === "noaction" ? "MET" : c.outcome === "cancelled" ? "MAJOR" : "NA"}">${esc(OUTCOMES[c.outcome] || c.outcome)}</span>` : ""}
    ${c.owner && c.status !== "tocall" ? `<div class="small muted" style="margin-top:6px">Owner: ${esc(c.owner)}</div>` : ""}</div>`;
}

async function caseAction(id, act) {
  if (act === "review") { Store.set("reviewOpen", id); rvTab = "queue"; rvFilter = "all"; location.hash = "#review"; return; }
  if (act === "script") return showScript(id);
  if (!needMe()) return;
  const c = cases();
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
  const c = cases()[id], call = callOf(id), doc = planFor(call), f = doc?.facts || {};
  const plan = doc ? doc.name : "your policy";
  const ped = f.ped_wait_months ? `${f.ped_wait_months / 12} years` : null;
  const fix = {
    P5: doc && /HEALTH|hospital/i.test(doc.text) ? [
      `Any illness you already had when you bought the policy, for example the condition you mentioned, is covered only after a waiting period of ${ped || "the period in your policy"}. It is not covered from day one.`,
      f.initial_wait_days ? `There is also an initial waiting period of ${f.initial_wait_days} days for any illness, except accidents.` : "",
      f.specific_wait_months ? `Some specific illnesses, such as cataract or hernia, have a ${f.specific_wait_months / 12}-year waiting period.` : "",
      f.room_rent_pct ? `Room rent is limited to ${f.room_rent_pct}% of your sum insured per day.` : "",
      f.copay_pct ? `You pay ${f.copay_pct}% of every claim yourself (co-payment).` : ""]
      : [f.deductible_inr ? `Every own-damage claim has a compulsory deductible of ${inr(f.deductible_inr)}.` : "",
        f.zero_dep_claims ? `Zero depreciation covers up to ${f.zero_dep_claims} claims a year.` : "",
        f.engine_water_excluded ? "Engine damage from water is not covered without the engine protect add-on." : "",
        f.ncb_needs_proof ? "Your no-claim bonus transfers only once we have proof from your previous policy." : ""],
    P6: ["Claims are decided by the insurer under the policy wording. Nobody, including us, can guarantee a claim will be approved.",
      f.no_return_of_premium ? "This plan does not return your premium if you don't claim." : ""],
    P2: ["We should have told you at the start that your call was recorded. I'm sorry we didn't. This call is recorded for quality and compliance."],
  };
  const lines = c.fatal.flatMap((p) => fix[p] || []).filter(Boolean);
  drawer(`<h2>Callback script: ${id}</h2><p class="small muted" style="margin:6px 0 16px">Filled in from ${doc ? `the policy wording for <b>${esc(plan)}</b>` : "the scorecard (no matching policy in the library)"}. Say it in your own words; don't read it robotically.</p>
    <ol class="script">
      <li><b>Open and record.</b> “Hello, this is [your name] from PolicyNest Insurance Brokers, about the ${esc(plan)} policy you bought with us. This call is recorded for quality and compliance. Is now a good time?”</li>
      <li><b>Say why you're calling.</b> “On your earlier call, some important terms weren't explained correctly. I want to make sure you have the full picture before you rely on the policy.”</li>
      <li><b>Correct the facts.</b><ul>${lines.map((l) => `<li>“${esc(l)}”</li>`).join("")}</ul></li>
      <li><b>Give the choice.</b> “If you're still within the free-look period${f.free_look_days ? ` of ${f.free_look_days} days` : ""} from receiving the documents, you can keep the policy knowing these terms, or cancel it for a refund. There's no pressure either way. What would you like to do?”</li>
      <li><b>Close.</b> “I'll email you this summary with the policy wording. If you have questions later, reply to that email or call us.”</li>
    </ol>
    ${c.fatal.includes("P8") || callOf(id).turns.some((t) => /otp/i.test(t.t)) ? `<div class="alert"><b>OTP on this call.</b> If the customer shared an OTP, tell them to contact their bank now, and log a conduct case.</div>` : ""}
    <p class="small muted">Wrong on the original call (evidence):</p>${c.fatal.map((p) => { const r = callOf(id).scored?.[D.modes[0]]?.results?.[p]; return r?.quote ? `<div class="said"><b>${p}</b> turn ${esc((r.turns || []).join(", "))}: <mark>${esc(r.quote)}</mark></div>` : ""; }).join("")}`, true);
}

RENDER.recovery = renderRecovery; ALWAYS.add("recovery");
ONBOOT.push(() => { seedCases(); updateBadges(); });
