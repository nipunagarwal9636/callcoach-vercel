/* Lessons: the rule as short bullets, the agent's own words, the better line, and practice with the Sales Buddy on this lesson only. */
const LESSON_RULES = {
  P1: { short: "Open the call properly", do: ["Say your own name", "Say you're calling from PolicyNest Insurance Brokers", "Say why you're calling (their enquiry)"], dont: ["“Hello sir, health insurance chahiye? Best plan hai”"], test: "The customer will ask who you are and why you're calling." },
  P2: { short: "Recording consent comes first", do: ["Tell the customer the call is recorded", "Do it before any product talk or personal detail", "Wait for their OK"], dont: ["Saying it after they've shared age or health details", "Skipping it because the customer is in a hurry"], test: "The customer starts sharing health details straight away. Say the recording line first." },
  P3: { short: "Ask before you recommend", do: ["Ask at least 3 questions", "Health: who and ages, existing illness or medicine, existing cover, budget", "Motor: car and year, current policy and claims, expiry, parking", "Use the answers in your recommendation"], dont: ["Pitching a plan before asking", "Giving in to “just tell me the best plan”"], test: "The customer says “bas best plan bata dijiye”. Ask your questions anyway." },
  P4: { short: "Describe the product correctly", do: ["Say the plan name and sum insured or IDV", "Say cashless works at network hospitals or garages", "Offer to check if their hospital is on the network"], dont: ["“Saare hospitals cashless hain”", "“Every garage is cashless”", "A wrong sum insured or IDV"], test: "The customer asks if every hospital near them is cashless." },
  P5: { short: "Disclose the limits before payment", do: ["Initial waiting period (30 days)", "Specific-illness waiting period", "Pre-existing disease waiting period, with the exact years", "Co-pay, room-rent limit or sub-limits", "Motor: deductible, zero-dep claim limit, what needs an add-on"], dont: ["“Don't worry, it's covered” to an existing illness", "Sending the payment link before the limits"], test: "The customer has BP and asks if it's covered. Give the exact waiting period." },
  P6: { short: "Never promise what the policy doesn't", do: ["Say claims are decided by the insurer under the policy terms", "Say there's no return of premium if there isn't", "Point to the policy wording"], dont: ["“100% claim pass hoga”, “guarantee”", "“Covered from day one” for an existing illness", "“You'll get your premium back”"], test: "The customer asks for a guarantee that the claim will be paid." },
  P7: { short: "Respect “I want to think”", do: ["Agree it's a good idea to discuss with family", "Offer to send details on WhatsApp or email", "Book a follow-up time"], dont: ["“Price goes up tomorrow”", "Pushing after a clear “not now”", "“Everyone regrets waiting”"], test: "The customer says they'll ask their wife first." },
  P8: { short: "Premium with GST, payment only by secure link", do: ["Say the premium including GST", "Send the payment link only to the registered number", "Say you'll never ask for an OTP, PIN or card number"], dont: ["“Sirf ₹X” without GST", "Asking for the OTP or card details, ever"], test: "The customer asks if they should read out the OTP to you." },
  P9: { short: "Listen, don't talk over", do: ["Let the customer finish", "Answer the worry they raised", "Use respectful words"], dont: ["Interrupting", "“Aap samajh nahi rahe”", "“Pehle meri baat suniye”"], test: "The customer has a long worry to share. Let them finish, then answer it." },
  P10: { short: "Close with a summary and next steps", do: ["Repeat plan, premium and what happens next", "After a sale: documents arrive by email, and the free-look period", "Say when you'll follow up"], dont: ["“Okay sir, done. Bye.”"], test: "The customer pays and asks what happens next." },
};
const FOCUS_PERSONA = { P1: "ramesh", P2: "ramesh", P3: "ramesh", P4: "ramesh", P5: "ramesh", P6: "ramesh", P7: "ramesh", P8: "ramesh", P9: "ramesh", P10: "ramesh" };

function practise(p) {
  BUDDY.focus = p; BUDDY.persona = FOCUS_PERSONA[p] || "ramesh"; BUDDY.turns = []; BUDDY.coach = null; BUDDY.ms = [];
  Memory.lesson(p, { opened: Date.now() });
  location.hash = "#buddy"; if (rendered.buddy) renderBuddy();
}

renderLesson = function (mod) {
  const v = D.coach[coScope]?.[$("#co-who").value]; if (!v) return;
  const m = mod || v.modules[$("#co-param").value]; if (!m) return;
  const sc = D.scorecard.find((x) => x.id === m.param), R = LESSON_RULES[m.param], st = Memory.get().lessons?.[m.param] || {};
  const lang = Store.get("lessonLang", "hi");
  const ex = (m.excerpts || []).map((e) => `<div class="said"><span class="small muted">From your call ${e.call}</span>${e.lines.map(([n, sp, t]) => `<div class="${sp === "AGENT" ? "" : "c"}"><span class="small muted">${sp === "AGENT" ? "You" : "Customer"}:</span> ${sp === "AGENT" ? `<mark>${esc(t)}</mark>` : esc(t)}</div>`).join("")}</div>`).join("");
  $("#lesson").innerHTML = `<div class="lesson v2"><div class="lesson-head"><div class="lh-chips"><span class="chip ${sc.severity === "FATAL" ? "FATAL" : sc.severity}">${m.param} ${sc.severity === "FATAL" ? "fatal" : sc.severity.toLowerCase()}</span>
      ${st.passed ? `<span class="chip MET">Practice passed</span>` : st.tries ? `<span class="chip MAJOR">Practised ${st.tries}×</span>` : `<span class="chip NA">Not practised yet</span>`}
      ${role().role !== "agent" ? `<span class="chip REVIEW">${esc(m.status || "Draft")}</span>` : ""}</div>
      <h2>${esc(R.short)}</h2><p>${esc(m.why)}</p>
      <button class="btn big buddybtn" id="ls-practise">${svg("buddy", 18)} Practise this lesson with the Sales Buddy</button>
      <p class="small" style="color:#C9D0E4;margin-top:8px">${esc(R.test)}</p></div>
    <div class="lesson-grid">
      <div class="lcard do"><h3>Do this</h3><ul>${R.do.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="lcard dont"><h3>Never this</h3><ul>${R.dont.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="lcard wide"><h3>${coScope === "agents" ? "What happened on your call" : "What the team said"}</h3>${ex || `<p class="muted small">No excerpt.</p>`}</div>
      <div class="lcard wide say-it"><div class="lc-h"><h3>Say this instead</h3><div class="seg small-seg"><button data-l="hi" class="${lang === "hi" ? "on" : ""}">Hinglish</button><button data-l="en" class="${lang === "en" ? "on" : ""}">English</button></div></div>
        <div class="better big">${esc(lang === "hi" ? m.better : m.better_alt || m.better)}</div><button class="linkbtn" id="ls-copy">Copy line</button></div>
      <div class="lcard"><h3>Drill with your team lead</h3><p>${esc(m.practice)}</p></div>
      <div class="lcard"><h3>How you'll know it worked</h3><p>${esc(m.measure)}</p>${m.root_cause ? `<div class="cause"><b>Likely root cause.</b> ${esc(m.root_cause)}</div>` : ""}</div>
    </div>
    ${st.history?.length ? `<div class="lcard wide" style="margin:0 24px 24px"><h3>Your practice on this lesson</h3><ul class="mist">${st.history.slice(-5).reverse().map((h) => `<li><span>${when(h.ts)}: score ${h.score}</span><b class="${h.passed ? "up" : "down"}">${h.passed ? "Passed" : "Not yet"}</b></li>`).join("")}</ul></div>` : ""}
    <p class="small muted" style="padding:0 24px 20px">Written by ${esc(m.generated_by || "template")}. Checked by the pressure-language guardrail.</p></div>`;
  $("#ls-practise").onclick = () => practise(m.param);
  $("#ls-copy").onclick = () => { navigator.clipboard?.writeText(lang === "hi" ? m.better : m.better_alt || m.better); toast("Copied"); };
  $$("[data-l]", $("#lesson")).forEach((b) => b.onclick = () => { Store.set("lessonLang", b.dataset.l); renderLesson(mod); });
  Memory.lesson(m.param, { viewed: Date.now() });
};
