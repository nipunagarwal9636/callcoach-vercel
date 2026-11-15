/* Sign-in: every user has an account; the server only sends each account the data it may see. */
const Auth = {
  get() { try { return JSON.parse(localStorage.getItem("cc:session") || "null"); } catch { return null; } },
  set(s) { try { localStorage.setItem("cc:session", JSON.stringify(s)); } catch { } Auth._s = s; },
  clear() { try { localStorage.removeItem("cc:session"); } catch { } Auth._s = null; },
  ok() { const s = Auth._s || Auth.get(); return !!(s && s.token && s.user && s.user.exp * 1000 > Date.now()); },
  user() { return (Auth._s || Auth.get())?.user; },
  token() { return (Auth._s || Auth.get())?.token; },
  async api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + Auth.token() } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { Auth.clear(); const e = new Error(j.error || "Signed out"); e.status = 401; setTimeout(() => location.reload(), 1200); throw e; }
    if (!r.ok) { const e = new Error(j.error || r.status); e.status = r.status; throw e; }
    return j;
  },
  logout() { Auth.clear(); location.hash = ""; location.reload(); },
  showLogin() {
    return new Promise(async (resolve) => {
      let demo = [], hint = "";
      try { const j = await (await fetch("/api/login")).json(); demo = j.demo || []; hint = j.hint || ""; } catch { }
      const roleTxt = { admin: "Full view of everything", qa: "Review AI findings", tl: "Your team's day", agent: "Your calls and coaching" };
      const roleName = { admin: "Admin", qa: "QA auditor", tl: "Team lead", agent: "Agent" };
      const el = document.createElement("div"); el.id = "login";
      el.innerHTML = `<div class="lg-art"><a class="brand"><span class="dot"></span>CallCoach QA</a>
        <div class="lg-call"><div class="lg-line c"><span>Customer</span><p>Mujhe 4 saal se BP hai. Ye cover hoga na?</p></div>
          <div class="lg-line a"><span>Agent</span><p><span class="hl hl-anim" id="lg-hl">Uski tension mat lijiye, sab cover hai.</span></p></div>
          <div class="lg-stamp">FATAL P5</div>
          <div class="lg-fix"><span>Say this instead</span><p>Ye pehle se maujood bimari hai, iske liye 3 saal ka waiting period hai.</p></div></div>
        <h1>Every call heard.<br>Every miss fixed.</h1><p class="lg-sub">Sign in to see what matters to you: your calls, your team, or your review desk.</p></div>
      <div class="lg-form"><form id="lg-f" autocomplete="on"><h2>Sign in</h2>
        <label class="fld">Username<input id="lg-u" name="username" autocomplete="username" placeholder="e.g. SA-001, TL-3, QA-1 or admin" required></label>
        <label class="fld">Password<input id="lg-p" name="password" type="password" autocomplete="current-password" required></label>
        <p class="lg-err" id="lg-err" role="alert"></p>
        <button class="btn" type="submit" id="lg-go">Sign in</button>
        <div class="lg-demo"><span class="small muted">Demo accounts, one click</span>
          <div class="lg-chips">${demo.map((d) => `<button type="button" class="lg-chip" data-u="${d.username}" data-r="${d.role}"><b>${roleName[d.role]}</b><span>${esc(d.name)}</span><span class="small muted">${roleTxt[d.role]}</span></button>`).join("")}</div>
          <p class="small muted">${esc(hint)}</p></div></form></div>`;
      document.body.appendChild(el);
      setTimeout(() => $("#lg-hl")?.classList.add("go"), 500);
      const go = async (u, p) => {
        $("#lg-err").textContent = ""; $("#lg-go").disabled = true; $("#lg-go").innerHTML = `<span class="spin"></span> Signing in`;
        try {
          const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
          const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn't sign in");
          Auth.set(j); el.classList.add("out"); setTimeout(() => el.remove(), 350); resolve(j.user);
        } catch (e) { $("#lg-err").textContent = e.message === "Failed to fetch" ? "The server isn't reachable. Run dev_server.py or open the Vercel link." : e.message; $("#lg-go").disabled = false; $("#lg-go").textContent = "Sign in"; }
      };
      $("#lg-f").onsubmit = (e) => { e.preventDefault(); go($("#lg-u").value, $("#lg-p").value); };
      $$(".lg-chip", el).forEach((b) => b.onclick = () => { $("#lg-u").value = b.dataset.u.toUpperCase(); $("#lg-p").value = b.dataset.r === "admin" ? "admin123" : "demo123"; go(b.dataset.u, $("#lg-p").value); });
      setTimeout(() => $("#lg-u").focus(), 100);
    });
  },
};
