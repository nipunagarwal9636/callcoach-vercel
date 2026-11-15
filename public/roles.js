/* Accounts and what each role sees. The signed-in account decides the view; the server already filters the data. */
ICONS.home = '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>';
ICONS.logout = '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>';
STAGE.home = ["", "Dashboard"];

const ROLES = {
  admin: { label: "Admin", home: "Control room", nav: null },
  tl: { label: "Team lead", home: "My team", nav: ["home", "live", "demo", "flags", "recovery", "coaching", "agents", "buddy"] },
  qa: { label: "QA auditor", home: "Review desk", nav: ["home", "live", "demo", "policy", "review", "flags", "results"] },
  agent: { label: "Agent", home: "My dashboard", nav: ["home", "coaching", "buddy", "live"] },
};
function role() { const u = Auth.user() || { role: "admin" }; return { role: u.role, team: u.team, agent: u.agent, name: u.name, u: u.u }; }
function teamName(id) { return D.coach.teams?.[id]?.name || D.agents.agents.find((a) => a.team_lead_id === id)?.team_lead || id; }
function me_agent() { return D.agents.agents.find((a) => a.id === role().agent) || D.agents.agents[0]; }
function roleSeesCall(call) {
  const r = role();
  if (r.role === "admin" || r.role === "qa") return true;
  if (!call) return false;
  if (r.role === "tl") return call.team_lead_id === r.team || call.team_lead_id === "-";
  return call.agent_id === r.agent;
}
window.roleGuard = (view) => {
  const r = ROLES[role().role];
  if (!r.nav || r.nav.includes(view)) return view;
  if (view !== "overview") toast(`That page isn't part of your ${r.label} account.`);
  return "home";
};

function applyRole() {
  const R = role(), r = ROLES[R.role];
  $$("#nav a").forEach((a) => { a.hidden = r.nav ? !r.nav.includes(a.dataset.v) : false; });
  const home = $('#nav a[data-v="home"]'); home.hidden = false; home.lastChild.textContent = r.home;
  STAGE.home = ["", r.home];
  if (R.role === "agent") { const c = $('#nav a[data-v="coaching"]'); c.lastChild.textContent = "My lessons"; const b = $('#nav a[data-v="buddy"]'); b.lastChild.textContent = "Practise a call"; }
  $$("#nav .grp").forEach((g) => {
    let n = g.nextElementSibling, any = false;
    while (n && !n.classList.contains("grp")) { if (n.tagName === "A" && !n.hidden) any = true; n = n.nextElementSibling; }
    g.hidden = !any;
  });
  $("#rolebtn")?.remove();
  const sub = R.role === "tl" ? `Team lead, ${R.team}` : R.role === "agent" ? `Agent ${R.agent}, ${R.team}` : R.role === "qa" ? "QA auditor" : "Full view";
  const ini = (R.name || "?").replace(/^Auditor /, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const card = document.createElement("div"); card.id = "rolebtn";
  card.innerHTML = `<span class="av ${R.role}">${esc(ini)}</span><span class="rb-t"><b>${esc(R.name)}</b><span>${esc(sub)}</span></span>
    <button class="iconbtn" id="logout" title="Sign out" aria-label="Sign out">${svg("logout", 17)}</button>`;
  $("#side .brand").after(card);
  $("#logout").onclick = () => { if (confirm("Sign out?")) Auth.logout(); };
  document.body.dataset.role = R.role;
  $("#tour-btn").hidden = R.role !== "admin";
  updateBadges();
}

/* scope pages that are shared between roles */
const _fcw = fillCoachWho;
fillCoachWho = function () {
  _fcw();
  const R = role(), sel = $("#co-who"); if (!sel) return;
  const seg = $("#co-seg");
  if (R.role === "agent") { seg.hidden = true; $("#co-who-l").hidden = true; }
  else if (R.role === "tl") { seg.hidden = false; }
  if (!sel.options.length) { $("#lesson").innerHTML = `<div class="empty">No lesson yet: none of your scored calls broke a rule. Practise a call with the Live Sales Buddy to keep it that way.</div>`; $("#co-param").innerHTML = ""; return; }
  fillCoachParam();
};
const _rf = RENDER.flags;
RENDER.flags = () => { const R = role(); $("#f-tl-l").hidden = R.role === "tl" || R.role === "agent"; if ($("#f-tl-l").hidden) $("#f-tl").value = ""; _rf(); };
const _ra = RENDER.agents;
RENDER.agents = () => { const R = role(); if (R.role === "tl") agTeam = R.team; _ra(); if (R.role === "tl") { $("#ag-team").value = R.team; $("#ag-team").disabled = true; } };
const _rr2 = RENDER.recovery;
RENDER.recovery = () => { _rr2(); const R = role(); if (R.role === "tl") $("#v-recovery .sec-head p")?.insertAdjacentHTML("beforeend", ` <b>Showing team ${R.team} only.</b>`); };
RENDER.coaching = () => { if (role().role !== "admin") fillCoachWho(); };

const _pal = paletteSource;
paletteSource = function () { const r = ROLES[role().role]; return _pal().filter((x) => (x.kind !== "Page" || !r.nav || r.nav.includes(Object.keys(STAGE).find((k) => STAGE[k][1] === x.label))) && (x.kind !== "Action" || role().role === "admin" || !/demo|stress|trail/i.test(x.label))); };

ONBOOT.unshift(async () => { await Promise.all([Memory.load(), Sync.pull(), Feed.refresh()]); });
ONBOOT.push(() => {
  applyRole();
  if (!location.hash || location.hash === "#overview" && role().role !== "admin") location.hash = "#home";
  setInterval(async () => {
    const before = new Set(Feed.cache.map((i) => i.id + ":" + i.ts)), cb0 = JSON.stringify(Store.get("cases", {}));
    await Promise.all([Feed.refresh(), Sync.pull()]);
    if (JSON.stringify(Store.get("cases", {})) !== cb0) { if (location.hash === "#home") RENDER.home(); if (location.hash === "#recovery") renderRecovery(); }
    const fresh = Feed.cache.filter((i) => !before.has(i.id + ":" + i.ts) && i.by !== role().name);
    if (fresh.length) { toast(`New scored call: ${fresh[0].id}, score ${fresh[0].s.score}`); updateBadges(); if (location.hash === "#home") RENDER.home(); }
  }, 15000);
});
