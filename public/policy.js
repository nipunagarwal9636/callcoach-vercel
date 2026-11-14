/* Policy check: compare what the agent said with the plan's policy wording, clause by clause. */
const VERDICT = { CONTRADICTED: ["FATAL", "Contradicts policy"], MISSING: ["MAJOR", "Not disclosed"], PENDING: ["NA", "Not said yet"],
  UNVERIFIED: ["REVIEW", "Not in wording"], SUPPORTED: ["MET", "Matches policy"], ERROR: ["NA", "AI error"] };

function findingsHTML(res, opts = {}) {
  if (!res.plan) return `<div class="empty">${esc(res.note || "No matching policy.")}</div>`;
  const f = opts.limit ? res.findings.filter((x) => x.verdict !== "SUPPORTED").slice(0, opts.limit) : res.findings;
  const n = (v) => res.findings.filter((x) => x.verdict === v).length;
  return `<div class="pol-head"><div><span class="small muted">Matched plan</span><h3>${esc(res.plan.name)}</h3></div>
    <div class="routes">${n("CONTRADICTED") ? `<span class="chip FATAL">${n("CONTRADICTED")} contradict the policy</span>` : ""}${n("MISSING") ? `<span class="chip MAJOR">${n("MISSING")} not disclosed</span>` : ""}<span class="chip MET">${n("SUPPORTED")} match</span></div></div>
    <div class="pol-list">${f.map((x, i) => {
      const [k, lab] = VERDICT[x.verdict] || ["NA", x.verdict];
      return `<div class="pol-row ${k}"><div><span class="chip ${k}">${lab}</span>${x.param ? `<span class="small muted" style="margin-left:6px">${x.param}</span>` : ""}${x.source === "llm" ? `<span class="chip REVIEW" style="margin-left:6px">AI</span>` : ""}</div>
        <div><b>${esc(x.topic)}</b>${x.turn ? `<span class="small muted"> turn ${x.turn}</span>` : ""}
          <div class="said-l">${x.kind === "omission" ? `<span class="muted">${esc(x.said)}</span>` : `<mark>${esc(x.said.length > 180 ? x.said.slice(0, 180) + "…" : x.said)}</mark>`}</div>
          <div class="pol-says"><span class="muted small">Policy says</span> ${esc(x.policy)}</div>
          ${x.clause ? `<details class="clause"><summary>Clause ${esc(x.clause.id)} ${esc(x.clause.title || "")}</summary><blockquote>${esc(x.clause.text)}</blockquote></details>` : ""}</div></div>`;
    }).join("") || `<p class="muted small">No problems against the policy.</p>`}</div>`;
}

async function runVerify(transcript, docId, useLLM) {
  if (!STATUS.api) throw new Error("The engine isn't reachable. Run dev_server.py or deploy to Vercel.");
  const r = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, docs: policyDocs().map((d) => ({ id: d.id, name: d.name, text: d.text })), doc_id: docId || null, use_llm: useLLM }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j;
}

function renderPolicy() {
  const el = $("#v-policy");
  const fav = ["QT-092", "QT-001", "QT-079", "QT-041", "QT-033"];
  el.innerHTML = `<div class="sec-head" style="margin-top:0"><div><h2>Policy check</h2><p>Is what the agent said true for this plan? Each claim is checked against the clauses of the plan's policy wording, and every finding cites the clause.</p></div></div>
  <div class="grid-pol">
    <div class="panel"><h3>Policy library</h3><p class="small muted" style="margin:4px 0 12px">Approved wordings the checks use. Upload a PDF or text file; text is read in your browser.</p>
      <div id="pol-docs"></div>
      <label class="upload"><input type="file" id="pol-up" accept=".pdf,.txt,.md" multiple><span>Upload policy wording</span></label>
      <p class="small muted" style="margin-top:12px">No PDF to hand? Download a sample and upload it:</p>
      <div class="samples">${D.policies.map((p) => `<a href="samples/${p.id}.pdf" download>${esc(p.name.replace(/ with zero depreciation/, ""))}.pdf</a>`).join("")}</div>
    </div>
    <div class="panel"><h3>Check a call</h3>
      <label class="fld">Call<select id="pol-pick">${fav.map((id) => `<option value="${id}">${id} (featured)</option>`).join("")}${D.calls.filter((c) => !fav.includes(c.id)).map((c) => `<option value="${c.id}">${c.id}: ${esc(c.agent)}, ${c.product.replace("_", " ").toLowerCase()}</option>`).join("")}<option value="">Paste my own</option></select></label>
      <label class="fld">Transcript<textarea id="pol-tx" spellcheck="false" style="min-height:160px"></textarea></label>
      <div class="filters" style="margin:12px 0 0"><label>Plan<select id="pol-doc"><option value="">Detect from the call</option></select></label>
        <label class="toggle" style="margin:0 0 6px"><input type="checkbox" id="pol-llm" ${STATUS.llm ? "checked" : "disabled"}> <span>${STATUS.llm ? "Also let AI check other statements" : "AI check off (no key)"}</span></label></div>
      <div class="cta" style="margin-top:14px"><button class="btn" id="pol-go">Check against policy</button></div>
      <div id="pol-out" style="margin-top:18px"></div>
    </div>
  </div>`;
  const load = () => { const c = D.calls.find((x) => x.id === $("#pol-pick").value); $("#pol-tx").value = c ? toText(c.turns) : ""; };
  $("#pol-pick").onchange = load; load();
  $("#pol-up").onchange = (e) => uploadDocs([...e.target.files]);
  $("#pol-go").onclick = async () => {
    const b = $("#pol-go"); b.disabled = true; b.innerHTML = `<span class="spin"></span> Checking`;
    try { $("#pol-out").innerHTML = findingsHTML(await runVerify($("#pol-tx").value, $("#pol-doc").value, $("#pol-llm").checked)); }
    catch (e) { $("#pol-out").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    finally { b.disabled = false; b.textContent = "Check against policy"; }
  };
  drawDocs();
}

function drawDocs() {
  const docs = policyDocs();
  $("#pol-docs").innerHTML = docs.map((d) => {
    const nf = Object.keys(d.facts || {}).length;
    return `<div class="doc"><div><b>${esc(d.name)}</b><div class="small muted">${d.source === "sample" ? "Sample wording" : "Uploaded " + when(d.ts)}${nf ? `, ${nf} limits read` : ""}</div></div>
      <div class="doc-act"><button class="btn ghost small" data-view="${d.id}">View</button>${d.source !== "sample" ? `<button class="btn ghost small" data-del="${d.id}">Remove</button>` : ""}</div></div>`;
  }).join("");
  $("#pol-doc").innerHTML = `<option value="">Detect from the call</option>` + docs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  $$("#pol-docs [data-view]").forEach((b) => b.onclick = () => {
    const d = docs.find((x) => x.id === b.dataset.view);
    drawer(`<h2>${esc(d.name)}</h2><p class="small muted" style="margin:6px 0 14px">${d.source === "sample" ? "Synthetic sample wording for the demo." : "Uploaded wording, text extracted in your browser."}</p>
      ${d.facts && Object.keys(d.facts).length ? `<div class="facts">${Object.entries(d.facts).map(([k, v]) => `<span class="chip ink">${esc(k.replace(/_/g, " "))}: ${v === true ? "yes" : v}</span>`).join("")}</div>` : ""}
      <pre class="doctext">${esc(d.text)}</pre>`);
  });
  $$("#pol-docs [data-del]").forEach((b) => b.onclick = () => { Store.set("uploads", Store.get("uploads", []).filter((x) => x.id !== b.dataset.del)); drawDocs(); });
}

async function pdfText(file) {
  if (!window.pdfjsLib) throw new Error("PDF reader didn't load. Upload a .txt instead.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    out += tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n\n";
  }
  return out.replace(/[ \t]+\n/g, "\n");
}

async function uploadDocs(files) {
  for (const f of files) {
    try {
      const text = /\.pdf$/i.test(f.name) ? await pdfText(f) : await f.text();
      if (text.trim().length < 80) throw new Error("no readable text (scanned PDF?)");
      const m = text.match(/Insurer\s+\w+\s*[·:-]\s*[^\n:]{3,60}/);
      const name = (m ? m[0].trim() : f.name.replace(/\.\w+$/, "")).slice(0, 80);
      const doc = { id: "up-" + Date.now() + Math.random().toString(16).slice(2, 6), name, text: text.slice(0, 120000), source: "upload", ts: Date.now() };
      try {
        const r = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: "AGENT: " + name, docs: [doc], doc_id: doc.id }) });
        const j = await r.json(); doc.facts = j.plan?.facts || {};
      } catch { doc.facts = {}; }
      Store.set("uploads", [...Store.get("uploads", []), doc]);
      await Trail.add("Policy uploaded", name, `${text.length.toLocaleString()} characters, ${Object.keys(doc.facts).length} limits read`);
      toast(`Added ${name}`);
    } catch (e) { toast(`Couldn't read ${f.name}: ${e.message}`); }
  }
  drawDocs();
}

/* After "Score a call": policy check + send to review */
window.afterScore = async (out, s, turns, text, lab) => {
  const box = document.createElement("div"); box.className = "panel"; box.style.marginTop = "20px";
  box.innerHTML = `<div class="sec-head" style="margin:0 0 10px"><h3>Checked against the policy wording</h3>
    <button class="btn small" id="to-review">Send to review queue</button></div><div id="as-pol"><span class="small muted">Checking clauses…</span></div>`;
  out.insertBefore(box, out.children[1] || null);
  $("#to-review", box).onclick = () => {
    const id = lab ? lab.id : "LIVE-" + new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "");
    if (!lab) {
      const call = { id, agent: "Live call", agent_id: "-", team_lead: "-", team_lead_id: "-", product: "LIVE", language: "-", outcome: s.sale ? "SALE" : "UNKNOWN", turns, labels: null };
      Store.set("liveQueue", [...Store.get("liveQueue", []).filter((x) => x.id !== id), { id, call, s }]);
    }
    Trail.add("Sent to review", id, `score ${s.score}, flags ${s.flags.join(", ") || "none"}`);
    toast("In the review queue"); location.hash = "#review"; Store.set("reviewOpen", id);
  };
  if (!STATUS.api) { $("#as-pol", box).innerHTML = `<span class="small muted">Policy check needs the engine.</span>`; return; }
  try { $("#as-pol", box).innerHTML = findingsHTML(await runVerify(text, null, false), { limit: 6 }) + `<a class="small" href="#policy">Open the full policy check</a>`; }
  catch (e) { $("#as-pol", box).innerHTML = `<span class="small muted">${esc(e.message)}</span>`; }
};

RENDER.policy = renderPolicy;
