/* UX layer: sidebar icons, top bar, command palette, guided demo (autopilot), welcome, shortcuts, small motion. */
const ICONS = {
  overview: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  demo: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
  live: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  policy: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9.5 14.5l2 2 3.5-4"/>',
  review: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  flags: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  recovery: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  coaching: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5M21 9v6"/>',
  agents: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3.3 3 3.5 6"/>',
  buddy: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  results: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  patterns: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  roi: '<path d="M7 4h11M7 9h11M7 4c5 0 7 2 7 5s-3 5-7 5l8 6"/>',
};
const svg = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;
const STAGE = { overview: ["", "Overview"], live: ["Detect", "Live call"], demo: ["Detect", "Score a call"], policy: ["Detect", "Policy check"], review: ["Decide", "Review queue"], flags: ["Decide", "Today's flags"],
  recovery: ["Fix", "Customer recovery"], coaching: ["Fix", "Coaching"], agents: ["Fix", "Agents"], buddy: ["Prevent", "Live Sales Buddy"], results: ["Prove", "Accuracy"],
  patterns: ["Prove", "Floor patterns"], roi: ["Prove", "P&L and ROI"] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, ms = 9000) { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await wait(120); } return null; }

/* ---------- shell ---------- */
function setupShell() {
  $$("#nav a").forEach((a) => { if (!a.querySelector("svg")) a.insertAdjacentHTML("afterbegin", `<span class="ni">${svg(a.dataset.v)}</span>`); });
  const main = $("main");
  main.insertAdjacentHTML("afterbegin", `<div class="topbar">
    <button class="iconbtn menu" id="menu-btn" aria-label="Open menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div class="crumb" id="crumb"></div>
    <button class="searchbtn" id="cmdk-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><span>Search calls, agents, pages</span><kbd>Ctrl K</kbd></button>
    <button class="btn small tourbtn" id="tour-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>Guided demo</button>
  </div>`);
  $("#menu-btn").onclick = () => document.body.classList.toggle("navopen");
  $("#nav").addEventListener("click", () => document.body.classList.remove("navopen"));
  $("#cmdk-btn").onclick = openPalette;
  $("#tour-btn").onclick = () => Tour.start(0);
  $("#side").insertAdjacentHTML("beforeend", `<div class="side-foot">Sirisha Bhatia, Gunjan Ahuja, Aditya Mohan, Nipun Agarwal<br>PS-04, synthetic data</div>`);
  addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); }
    else if (e.key === "?" && !typing) openHelp();
    else if (!typing && location.hash === "#review" && rvTab === "queue") reviewKeys(e);
  });
}

window.onRoute = (view) => {
  const [stage, name] = STAGE[view] || ["", ""];
  $("#crumb").innerHTML = stage ? `<span class="muted">${stage}</span><span class="sep">/</span><b>${name}</b>` : `<b>${name}</b>`;
  const el = $("#v-" + view); el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  document.title = (view === "overview" ? "" : name + " · ") + "CallCoach QA";
  Tour.sync(view);
};

/* ---------- command palette ---------- */
let palItems = [], palIdx = 0;
function paletteSource() {
  const pages = Object.entries(STAGE).map(([k, [st, n]]) => ({ kind: "Page", label: n, sub: st || "Home", icon: k, go: () => (location.hash = "#" + k) }));
  const calls = D.calls.map((c) => ({ kind: "Call", label: `${c.id} ${c.agent}`, sub: `${c.product.replace("_", " ").toLowerCase()}, ${c.language}, score ${c.scored[D.modes[0]].score}`, icon: "demo",
    go: async () => { location.hash = "#demo"; await until(() => $("#pick")); demoSrc = "labelled"; $$("#src-seg button").forEach((x) => x.classList.toggle("on", x.dataset.s === "labelled")); $("#pick").value = c.id; loadPick(); scoreDemo(); } }));
  const agents = D.agents.agents.map((a) => ({ kind: "Agent", label: a.name, sub: `${a.id}, ${a.team_lead_id}, audit score ${a.avg_qa == null ? "n/a" : a.avg_qa.toFixed(0)}`, icon: "agents",
    go: () => { agSel = a.id; agQ = ""; agTeam = ""; location.hash = "#agents"; if (rendered.agents) drawAgList(); } }));
  const actions = [
    { kind: "Action", label: "Start the guided demo", sub: "Autopilot through the whole loop", icon: "overview", go: () => Tour.start(0) },
    { kind: "Action", label: "Verify the audit trail", sub: "Review queue, audit trail", icon: "review", go: async () => { rvTab = "trail"; location.hash = "#review"; if (rendered.review) renderReview(); await until(() => $("#tr-verify")); $("#tr-verify").click(); } },
    { kind: "Action", label: "Run the stress set live", sub: "Accuracy", icon: "results", go: async () => { location.hash = "#results"; const b = await until(() => $("[data-run=stress]")); b?.click(); } },
    { kind: "Action", label: "Practise with Ramesh", sub: "Live Sales Buddy", icon: "buddy", go: () => { BUDDY.persona = "ramesh"; BUDDY.turns = []; location.hash = "#buddy"; if (rendered.buddy) renderBuddy(); } },
    { kind: "Action", label: "Keyboard shortcuts", sub: "Press ?", icon: "overview", go: openHelp },
  ];
  return [...actions, ...pages, ...calls, ...agents];
}
function openPalette() {
  const all = paletteSource();
  const m = modal(`<div class="pal"><div class="pal-in"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
    <input id="pal-q" placeholder="Try QT-092, an agent's name, or 'policy'" autocomplete="off"></div><div class="pal-list" id="pal-list"></div>
    <div class="pal-foot small muted"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>`, "palm");
  const draw = () => {
    const q = $("#pal-q").value.trim().toLowerCase();
    palItems = (q ? all.filter((x) => (x.label + " " + x.sub + " " + x.kind).toLowerCase().includes(q)) : all.slice(0, 9)).slice(0, 40);
    palIdx = Math.min(palIdx, Math.max(0, palItems.length - 1));
    $("#pal-list").innerHTML = palItems.map((x, i) => `<button class="pal-i ${i === palIdx ? "on" : ""}" data-i="${i}"><span class="pal-ic">${svg(x.icon, 16)}</span><span><b>${esc(x.label)}</b><span class="small muted"> ${esc(x.sub)}</span></span><span class="chip NA">${x.kind}</span></button>`).join("")
      || `<div class="empty small">Nothing matches. Try a call ID like QT-041.</div>`;
    $$(".pal-i").forEach((b) => b.onclick = () => pick(+b.dataset.i));
    $(".pal-i.on")?.scrollIntoView({ block: "nearest" });
  };
  const pick = (i) => { const x = palItems[i]; closeModal(); x?.go(); };
  $("#pal-q").oninput = () => { palIdx = 0; draw(); };
  $("#pal-q").onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palIdx = Math.min(palItems.length - 1, palIdx + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); draw(); }
    else if (e.key === "Enter") pick(palIdx);
  };
  draw(); setTimeout(() => $("#pal-q").focus(), 30);
}

/* ---------- modal ---------- */
function modal(html, cls = "") {
  closeModal();
  const m = document.createElement("div"); m.id = "modal"; m.className = cls;
  m.innerHTML = `<div class="m-bg"></div><div class="m-in" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(m); m.querySelector(".m-bg").onclick = closeModal;
  requestAnimationFrame(() => m.classList.add("on"));
  return m;
}
function closeModal() { $("#modal")?.remove(); }
addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#modal")) closeModal(); });

function openHelp() {
  modal(`<div class="mpad"><h2>Keyboard shortcuts</h2><table class="t keys" style="margin-top:14px"><tbody>
    <tr><td><kbd>Ctrl</kbd> <kbd>K</kbd></td><td>Search calls, agents and pages</td></tr>
    <tr><td><kbd>?</kbd></td><td>This list</td></tr>
    <tr><td><kbd>C</kbd></td><td>Review queue: confirm the next open finding</td></tr>
    <tr><td><kbd>O</kbd></td><td>Review queue: overturn it (asks for a reason)</td></tr>
    <tr><td><kbd>S</kbd></td><td>Review queue: sign off the call</td></tr>
    <tr><td><kbd>J</kbd> <kbd>K</kbd></td><td>Review queue: next / previous call</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Close a panel</td></tr></tbody></table></div>`);
}
function reviewKeys(e) {
  const k = e.key.toLowerCase();
  if (k === "c") $("[data-c]")?.click();
  else if (k === "o") { const i = $("[data-reason]"); if (i) { e.preventDefault(); i.focus(); toast("Type the reason, then press Overturn"); } }
  else if (k === "s") $("#rv-sign:not([disabled])")?.click();
  else if (k === "j" || k === "k") {
    const items = $$(".rv-item"), i = items.findIndex((b) => b.classList.contains("on"));
    items[Math.max(0, Math.min(items.length - 1, i + (k === "j" ? 1 : -1)))]?.click();
  }
}

/* ---------- welcome ---------- */
function welcome() {
  if (Store.get("welcomed")) return;
  const m = modal(`<div class="welcome"><div class="wl-art"><div class="wl-line"><span class="small">Agent, turn 7</span><p><span class="hl hl-anim" id="wl-hl">Don't worry about that, it's all covered.</span></p></div><div class="wl-stamp">FATAL P5</div></div>
    <div class="mpad"><h2>Every call heard. Every miss fixed.</h2><p class="muted" style="margin:8px 0 18px">CallCoach scores every PolicyNest sales call, checks it against the policy, sends real mistakes to a person, and turns them into callbacks and coaching. Where do you want to start?</p>
    <div class="wl-opts">
      <button data-w="tour"><b>Take the 3-minute guided demo</b><span>Autopilot walks through the whole loop. Best for judges.</span></button>
      <button data-w="tl"><b>I'm a team lead</b><span>My team's flags, callbacks and coaching</span></button>
      <button data-w="qa"><b>I'm a QA auditor</b><span>Review AI findings, keep the trail clean</span></button>
      <button data-w="agent"><b>I'm an agent</b><span>My calls, my coaching, practice</span></button>
      <button data-w="explore"><b>Show me everything</b><span>Full view of every page</span></button>
    </div>
    <label class="fld" style="margin-top:16px">Your name, for the audit trail (optional)<input id="wl-name" value="${esc(me().name)}" placeholder="e.g. Priya" maxlength="40"></label></div></div>`, "wide");
  setTimeout(() => $("#wl-hl")?.classList.add("go"), 300);
  $$("[data-w]", m).forEach((b) => b.onclick = () => {
    const n = $("#wl-name").value.trim(); if (n) Store.set("me", { name: n, role: "QA auditor" });
    Store.set("welcomed", 1); closeModal();
    const w = b.dataset.w;
    if (w === "tour") Tour.start(0);
    else if (w === "explore") setRole({ role: "full" });
    else { setRole({ role: w }); if (w !== "qa") setTimeout(openRoles, 200); }
  });
}

/* ---------- guided demo (autopilot) ---------- */
const TOUR = [
  { view: "overview", title: "One loop, five stages", body: "A sales call is replayed. The highlighter marks the exact sentence that broke the rules, and the stamp shows the verdict. Everything else in the app follows from this moment.",
    act: async () => { location.hash = "#overview"; await wait(200); heroReplay(); } },
  { view: "live", title: "Detect: catch it during the call", body: "A call plays as if live. The moment the agent says “sab cover hai”, promises a claim or asks for an OTP, the dashboard turns red and shows the exact line to say instead. Press Start listening to do this with a real conversation.", focus: "#lv-dash",
    act: async () => { location.hash = "#live"; await until(() => $("#lv-sample")); await playSample(); } },
  { view: "demo", title: "Detect: score a real call", body: "QT-001: the customer asks about his illness and the agent says “it's all covered”. The engine scores all 10 parameters and quotes the turn for every failure.", focus: "#score-btn",
    act: async () => { location.hash = "#demo"; await until(() => $("#pick")); $$("#src-seg button")[0].click(); $("#pick").value = "QT-001"; loadPick(); await scoreDemo(); } },
  { view: "demo", title: "Detect: check it against the policy", body: "The same call is checked against the plan's policy wording. Each contradiction cites the clause, e.g. pre-existing diseases wait 36 months.", focus: "#as-pol",
    act: async () => { if (!$("#as-pol")) { await TOUR[1].act(); } const p = await until(() => $("#as-pol .pol-head")); p?.closest(".panel").scrollIntoView({ behavior: "smooth", block: "start" }); } },
  { view: "review", title: "Decide: a person confirms", body: "AI never has the last word on a fatal finding. The auditor confirms or overturns it with a reason, and every action is chained into the audit trail.", focus: "#rv-detail",
    act: async () => { Store.set("reviewOpen", "QT-001"); rvTab = "queue"; rvFilter = "all"; location.hash = "#review"; if (rendered.review) renderReview();
      await until(() => $("#rv-detail .rv-find")); await wait(500);
      for (const b of $$("#rv-detail [data-c]")) { b.click(); await wait(700); }
      const s = await until(() => $("#rv-sign:not([disabled])"), 3000); await wait(400); s?.click(); } },
  { view: "recovery", title: "Fix: call the customer back", body: "QT-001 was a sale, so a confirmed fatal error opens a recovery case. The callback script is filled in with this plan's correct facts.", focus: ".board",
    act: async () => { location.hash = "#recovery"; await until(() => $(".board")); await wait(400); showScript("QT-001"); } },
  { view: "buddy", title: "Prevent: practise before it's real", body: "The agent rehearses with a simulated customer. Watch the coach catch “sab cover hai” the moment it's said, and suggest the correct line with the plan's numbers.", focus: "#bd-coach",
    act: async () => { closeDrawer(); BUDDY.persona = "ramesh"; BUDDY.turns = []; location.hash = "#buddy"; if (rendered.buddy) renderBuddy(); await until(() => $("#bd-in"));
      for (const l of ["Hello, main Neha, PolicyNest Insurance Brokers se. Aapne website pe health insurance ke liye enquiry ki thi.", "Shuru karne se pehle bata doon, ye call record ho rahi hai. Theek hai?", "Kisi ko koi bimari ya regular dawai?", "Uski tension mat lijiye, sab cover hai."]) {
        await until(() => !BUDDY.busy); await typeInto($("#bd-in"), l); sendLine(); await wait(500); } } },
  { view: "results", title: "Prove: measure it live", body: "The deployed engine runs the 12 reworded stress calls right now. With a key set, this is the AI judge's real accuracy and speed, measured in front of you.", focus: ".lab",
    act: async () => { location.hash = "#results"; const b = await until(() => $("[data-run=stress]:not([disabled])")); b?.click(); } },
  { view: "roi", title: "Prove: the rupees", body: "The brief's own numbers with our assumptions tagged. Drag any slider; the break-even line shows how little has to go right for this to pay.", focus: "#roi-hero",
    act: async () => { location.hash = "#roi"; await until(() => $("#roi-sc")); for (const s of ["low", "high", "base"]) { $(`#roi-sc [data-s=${s}]`).click(); await wait(900); } } },
  { view: "review", title: "Trust: try to cheat the trail", body: "First the chain verifies as intact. Then the tamper test quietly edits an old decision in storage, and verification points to the exact entry where the chain breaks. Press Undo tamper test afterwards.", focus: "#rv-body",
    act: async () => { rvTab = "trail"; location.hash = "#review"; if (rendered.review) renderReview(); await until(() => $("#tr-tamper"));
      if (Store.get("tamper")) { $("#tr-tamper").click(); await until(() => !Store.get("tamper")); await wait(300); }
      $("#tr-verify").click(); await wait(1500); $("#tr-tamper").click(); } },
];
async function typeInto(el, text) { el.value = ""; for (const ch of text) { el.value += ch; await wait(text.length > 60 ? 8 : 18); } }

const Tour = {
  i: -1, busy: false,
  start(i) { Tour.i = i; Tour.draw(); },
  stop() { Tour.i = -1; $("#tour")?.remove(); $$(".tour-focus").forEach((x) => x.classList.remove("tour-focus")); },
  async run() { if (Tour.busy) return; Tour.busy = true; Tour.draw(); try { await TOUR[Tour.i].act(); } catch (e) { console.error(e); } Tour.busy = false; Tour.draw(); },
  go(d) { const n = Tour.i + d; if (n < 0) return; if (n >= TOUR.length) return Tour.end(); Tour.i = n; Tour.draw(); Tour.run(); },
  end() { Tour.stop(); modal(`<div class="mpad"><h2>That's the loop.</h2><p class="muted" style="margin:8px 0 16px">Detect, decide, fix, prevent, prove. Every page is live: press <kbd>Ctrl</kbd> <kbd>K</kbd> to jump to any call or agent.</p><button class="btn" onclick="closeModal()">Explore</button></div>`); },
  sync() { if (Tour.i >= 0) Tour.focus(); },
  focus() {
    $$(".tour-focus").forEach((x) => x.classList.remove("tour-focus"));
    const s = TOUR[Tour.i]?.focus; if (s) setTimeout(() => $(s)?.classList.add("tour-focus"), 250);
  },
  draw() {
    const st = TOUR[Tour.i]; if (!st) return;
    let t = $("#tour"); if (!t) { t = document.createElement("div"); t.id = "tour"; document.body.appendChild(t); }
    t.innerHTML = `<div class="tr-top"><span class="small">Guided demo, ${Tour.i + 1} of ${TOUR.length}</span><button class="tr-x" aria-label="Close guided demo">✕</button></div>
      <div class="tr-prog"><i style="width:${((Tour.i + 1) / TOUR.length) * 100}%"></i></div>
      <h3>${st.title}</h3><p>${st.body}</p>
      <div class="tr-act"><button class="btn ghost small" id="tr-back" ${Tour.i ? "" : "disabled"}>Back</button>
        <button class="btn small show" id="tr-run" ${Tour.busy ? "disabled" : ""}>${Tour.busy ? '<span class="spin"></span> Running' : "Show me"}</button>
        <button class="btn small" id="tr-next" ${Tour.busy ? "disabled" : ""}>${Tour.i === TOUR.length - 1 ? "Finish" : "Next"}</button></div>`;
    $(".tr-x", t).onclick = Tour.stop; $("#tr-back").onclick = () => Tour.go(-1); $("#tr-next").onclick = () => Tour.go(1); $("#tr-run").onclick = Tour.run;
    Tour.focus();
  },
};

/* ---------- small motion: count up the overview strip ---------- */
function countUp(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  $$("b", root).forEach((b) => {
    const m = b.textContent.match(/^(\d+)(.*)$/); if (!m) return;
    const end = +m[1], rest = m[2], t0 = performance.now();
    const f = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3); b.textContent = Math.round(end * e) + rest; if (k < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
}
const _ro = RENDER.overview;
RENDER.overview = () => { _ro(); countUp($("#ov-strip")); };

ONBOOT.push(() => { setupShell(); });

