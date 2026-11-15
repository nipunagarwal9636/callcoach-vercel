"""Coaching modules built from an agent's (or team's) own flagged calls.

Structure follows L&D's template, fixed where Quality criticised it: real calls from the floor, one topic,
a better version, a practice scenario, and a success measure tied to the scorecard.
"""
import re

from . import llm
from .privacy import find_names, mask_text
from .rules import PRESSURE, OTP_ASK, OTP_SAFE
from .scorecard import COACHING_THEME, PARAMS

BETTER = {
    "P1": ("Hello, am I speaking with [customer]? I'm [your name] from PolicyNest Insurance Brokers. You'd enquired about health insurance on our website, so I'm calling to help with that.",
           "Hello, kya meri baat [customer] ji se ho rahi hai? Main [aapka naam], PolicyNest Insurance Brokers se. Aapne website pe enquiry ki thi, usi ke liye call kiya."),
    "P2": ("Before we start, this call is recorded for quality and compliance. Is that okay with you?",
           "Shuru karne se pehle bata doon, ye call quality aur compliance ke liye record ho rahi hai. Theek hai?"),
    "P3": ("Before I suggest anything: who would you like to cover and their ages? Does anyone have an existing illness or regular medicine? Do you have any cover today, including from your employer? And what budget are you thinking of?",
           "Plan batane se pehle kuch sawaal: kis-kis ko cover karna hai aur unki age? Kisi ko koi existing bimari ya regular dawai? Abhi koi cover hai, company wala bhi? Aur budget kitna soch rahe hain?"),
    "P4": ("Cashless treatment is available at the insurer's network hospitals (or garages); elsewhere you pay and claim reimbursement. I'll send you the network list.",
           "Cashless sirf insurer ke network hospitals (ya garages) mein milta hai; baaki jagah aap pay karke reimbursement claim karte hain. Main network list bhej deta hoon."),
    "P5": ("Thank you for telling me. Your [condition] is a pre-existing condition, so it's covered after a 3-year waiting period. There's also a 30-day initial waiting period and 2 years for specific illnesses like cataract or hernia. It's all in the policy wording I'll send you.",
           "Bataane ke liye shukriya. Aapki [condition] pehle se maujood bimari hai, iske liye 3 saal ka waiting period hai. Saath mein 30 din ka initial waiting period aur cataract ya hernia jaisi bimariyon ke liye 2 saal. Ye sab policy wording mein hai, main bhej deta hoon."),
    "P6": ("Claims are assessed by the insurer under the policy wording, the same way for every customer. What I can do is explain exactly what's covered and help you with the paperwork, so your claim goes smoothly.",
           "Claim ka decision insurer policy wording ke hisaab se leta hai, sabke liye same process hai. Main aapko clearly bata deta hoon kya cover hai aur claim ke time paperwork mein help karunga, taaki sab smooth rahe."),
    "P7": ("Of course, please discuss it with your family. I'll WhatsApp you the details and the policy wording now. Shall I call you tomorrow evening at a time that suits you?",
           "Bilkul, aap family se baat kar lijiye. Main details aur policy wording abhi WhatsApp kar deta hoon. Kal shaam aapke time pe call karoon?"),
    "P8": ("The premium is Rs X including GST. I'll send a secure payment link to your registered number. Please don't share any OTP with anyone, including me.",
           "Premium Rs X hai GST ke saath. Main registered number pe secure link bhejta hoon. OTP kisi ko mat dijiye, mujhe bhi nahi."),
    "P9": ("Sorry, please go ahead. (Pause, let the customer finish.) Just to make sure I understood: you're asking about ... Let me explain that.",
           "Sorry, aap boliye. (Customer ko poora bolne dein.) Main sahi samjha: aap ... ke baare mein puchh rahe hain? Main samjhata hoon."),
    "P10": ("To summarise: [plan], premium Rs X including GST. You'll receive the policy by email within a day, and you have a free-look period to review it and cancel if it isn't right for you. Anything else I can help with?",
            "Summary: [plan], premium Rs X GST ke saath. Policy ek din mein email pe aa jayegi, aur free-look period mein aap review karke cancel bhi kar sakte hain. Aur kuch?"),
}

PRACTICE = {   # every drill is run with the Live Sales Buddy, so the agent can practise alone and get scored straight away
    "P1": "Start 3 Sales Buddy calls in a row and open each one with your name, PolicyNest and why you're calling, before anything else.",
    "P2": "Run 3 Sales Buddy calls where the recording line is the first thing you say after your name. The coach ticks P2 the moment you say it.",
    "P3": "In the Sales Buddy, when the customer says 'just tell me the best plan', ask your 4 questions first, then use the answers in your recommendation.",
    "P4": "Pitch the plan to the Sales Buddy customer and explain sum insured or IDV and where cashless works (network only). Aim for a clean checklist.",
    "P5": "Practise with Ramesh in the Sales Buddy: when he mentions his BP, explain the waiting periods and any co-pay in your own words. No red flags = pass.",
    "P6": "Ask the Sales Buddy customer to test you on 'Will my claim be approved?' and 'What happens to my premium if I never claim?'. Answer honestly and helpfully until P6 passes.",
    "P7": "When the Sales Buddy customer says 'let me discuss with my family', respect it, offer to send details and book a follow-up. Repeat until no pressure flag.",
    "P8": "Take 3 Sales Buddy calls to payment: premium with GST, secure link, and the 'never share an OTP' line.",
    "P9": "Practise with Kamla in the Sales Buddy: when she's confused, pause, paraphrase her question, then answer simply.",
    "P10": "Close 3 Sales Buddy calls with plan, premium, document timeline and the free-look period. End the call to see the score.",
}

BANNED = [PRESSURE]  # coaching must never teach urgency or pressure


def _lang(call):
    lang = str(call.meta.get("language", "")).lower()
    if lang:
        return "hi" if lang in ("hinglish", "hindi") else "en"
    txt = " ".join(t.text for t in call.turns).lower()
    return "hi" if len(re.findall(r"\b(hai|hoon|aap|kya|nahi|theek)\b", txt)) > 3 else "en"


def excerpts(calls, scored, param, max_n=3):
    """Context turn + flagged turn from each call, masked (no customer personal or health details)."""
    out = []
    for tid, s in scored.items():
        r = s["results"][param]
        if r["result"] not in ("NOT_MET", "REVIEW"):
            continue
        call = calls[tid]
        names = find_names(call)
        turns = sorted(set(r["turns"])) if r["turns"] else []
        if turns:
            main = max(turns)
            prev = [t for t in call.turns if t.no < main and t.speaker == "CUSTOMER"][-1:] if param in ("P5", "P7", "P9", "P6") else []
            lines = [(t.no, t.speaker, mask_text(t.text, names)) for t in prev] + \
                    [(t.no, t.speaker, mask_text(t.text, names)) for t in call.turns if t.no == main]
        else:
            lines = [(None, "NOTE", r["quote"] or r["reason"])]
        out.append(dict(call=tid, lines=lines, reason=r["reason"], lang=_lang(call)))
        if len(out) >= max_n:
            break
    return out


def guardrail(text):
    """Returns list of problems; empty means the module is safe to show."""
    probs = []
    if any(p.search(text) for p in BANNED):
        probs.append("contains urgency / pressure language")
    if OTP_ASK.search(text) and not OTP_SAFE.search(text):
        probs.append("tells the agent to ask for an OTP")
    from .rules import PROMISE, _clean
    if PROMISE.search(_clean(text)):
        probs.append("makes a promise about claims or returns")
    if re.search(r"(?<!\d)[6-9]\d{9}(?!\d)", text):
        probs.append("contains a phone number")
    return probs


def build_module(who, calls, scored, param=None, scope="agent", n_scored=None, use_llm=False):
    """who: agent label or team label; calls/scored: only that agent's (or team's) calls."""
    counts = {}
    for s in scored.values():
        for p in s["flags"]:
            counts[p] = counts.get(p, 0) + 1
    if not counts:
        return None
    if param is None:  # most severe, then most frequent
        sev = {"FATAL": 3, "MAJOR": 2, "MINOR": 1}
        param = max(counts, key=lambda p: (sev[PARAMS[p]["severity"]], counts[p]))
    ex = excerpts(calls, scored, param)
    lang = ex[0]["lang"] if ex else "en"
    d = PARAMS[param]
    n = n_scored or len(scored)
    k = counts.get(param, 0)
    module = dict(
        who=who, scope=scope, param=param, title=f"{COACHING_THEME[param]}: {who}",
        objective=f"After this module {'you' if scope == 'agent' else 'every agent in the team'} will meet {param} ({d['name']}) on every call.",
        why=_why(param),
        rule=f"{param} {d['name']} ({'fatal: the call scores 0' if d['points'] is None else str(d['points']) + ' points, ' + d['severity'].lower()}). MET: {d['met']}",
        excerpts=ex,
        better=BETTER[param][1 if lang == "hi" else 0], better_alt=BETTER[param][0 if lang == "hi" else 1],
        better_en=BETTER[param][0], better_hi=BETTER[param][1],
        practice=PRACTICE[param],
        measure=f"Today: {param} failed on {k} of {n} scored calls ({k / n:.0%}). Target: 0 failures in the next 20 scored calls, checked automatically; review in 7 days.",
        root_cause=None, generated_by="template", guardrail=[],
    )
    if scope == "team":
        module["root_cause"] = ("Several agents in this team fail the same parameter, so the likely cause is the team's script or the team "
                                "lead's own guidance, not individual agents (scorecard guide section 10). Start with the team lead's briefing.")
    if use_llm and llm.available():
        try:
            module = _llm_personalise(module)
        except Exception as e:
            module["llm_error"] = str(e)[:150]
    text = " ".join([module["better"], module["practice"], module.get("feedback", ""), module["why"]])
    module["guardrail"] = guardrail(text)
    if module["guardrail"] and module["generated_by"] == "llm":  # unsafe LLM output -> fall back to approved template
        module["better"] = BETTER[param][1 if lang == "hi" else 0]
        module["feedback"] = ""
        module["generated_by"] = "template (LLM output blocked by guardrail)"
    module["status"] = "Draft: needs Quality sign-off before it reaches the agent"
    return module


def _why(param):
    return {
        "P5": "Non-disclosure drives 30% of complaints. 'Don't worry, it's covered' is the single sentence behind most health mis-selling complaints and free-look refunds.",
        "P7": "Pressure selling drives 29% of complaints and rises in the last week of the month, when free-look cancellations also rise.",
        "P6": "A false promise is fatal: the customer finds out at claim time, complains, and the regulator can get involved.",
        "P2": "Without recording consent the call cannot be used, and the whole call scores 0.",
        "P8": "Asking for an OTP is a conduct issue and a fraud risk; premiums without GST cause payment disputes.",
        "P4": "Saying 'all hospitals are cashless' sets up a failed claim experience and a complaint.",
        "P9": "Talking over customers drives rude-behaviour complaints and lost sales.",
        "P3": "Without need analysis the recommendation can't be suitable, and disclosures can't be tailored.",
        "P10": "Without a summary and the free-look mention, customers are surprised by their policy and cancel.",
        "P1": "Customers hang up on calls that don't say who is calling and why.",
    }[param]


def _llm_personalise(module, profile=None):
    """Rewrite a coaching module for one agent from their own call excerpts. Output is checked by guardrail() in api/coach.py."""
    ex = "\n".join(f"Call {e['call']}: " + " | ".join(f"[{n}] {s}: {t}" for n, s, t in e["lines"]) for e in module.get("excerpts", []))
    p = profile or {}
    who = ", ".join(x for x in [p.get("name") and f"agent {p['name']}", p.get("calls") and f"{p['calls']} checked calls",
                                  p.get("fails") is not None and f"missed this rule on {p['fails']} of them",
                                  p.get("top") and f"other weak rules: {p['top']}", p.get("tries") and f"{p['tries']} Sales Buddy practice attempts on this lesson",
                                  p.get("passed") and "already passed the practice once"] if x)
    sys = ("You are a warm, specific sales-quality coach at PolicyNest, an Indian insurance broker. Personalise coaching for ONE agent, "
           "based only on their own call excerpts. Quote or paraphrase what THEY said. Rules: never suggest urgency, pressure, guarantees, "
           "promised returns or asking for OTPs; never suggest lines that admit fault for the company, blame colleagues, criticise the insurer, "
           "or could damage customer trust; keep every line honest and compliant with the policy wording; no customer names or health details. "
           "Do NOT reuse the generic template line given below; write a line fitted to the agent's own situation. "
           "Return JSON only: {\"feedback\": \"2-3 sentences: what happened on their call and why it matters, citing their words\", "
           "\"strength\": \"one thing they did well in these excerpts, or empty\", "
           "\"tips\": [\"3 short, concrete do-this-next-time tips\"], "
           "\"better\": \"one compliant line in the excerpts' language (English or Hinglish)\", "
           "\"better_other\": \"the same line in the other one (English if better is Hinglish, Hinglish if English)\", "
           "\"practice\": \"one Live Sales Buddy drill (the agent practises alone with the simulated customer), max 30 words\"}")
    user = (f"Rule: {module['param']} {module['rule']}\nAgent profile: {who or 'not given'}\n"
            f"Generic template line (do not copy): {module.get('better', '')}\nExcerpts:\n{ex or '(none)'}")
    out = llm.chat_json(sys, user, temperature=0.5, max_tokens=4000)
    tips = [str(t) for t in (out.get("tips") or []) if str(t).strip()][:4]
    module.update(feedback=out.get("feedback", ""), strength=out.get("strength", ""), tips=tips,
                  better=out.get("better") or module["better"], better_other=out.get("better_other", ""),
                  practice=out.get("practice") or module["practice"], generated_by="llm")
    return module
