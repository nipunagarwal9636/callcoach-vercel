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
    "P6": ("Claims are decided by the insurer under the policy wording, so I can't promise approval. What I can do is explain exactly what is covered so there are no surprises.",
           "Claim ka decision insurer policy wording ke hisaab se leta hai, isliye main guarantee nahi de sakta. Main aapko clearly bata sakta hoon kya cover hai, taaki baad mein koi surprise na ho."),
    "P7": ("Of course, please discuss it with your family. I'll WhatsApp you the details and the policy wording now. Shall I call you tomorrow evening at a time that suits you?",
           "Bilkul, aap family se baat kar lijiye. Main details aur policy wording abhi WhatsApp kar deta hoon. Kal shaam aapke time pe call karoon?"),
    "P8": ("The premium is Rs X including GST. I'll send a secure payment link to your registered number. Please don't share any OTP with anyone, including me.",
           "Premium Rs X hai GST ke saath. Main registered number pe secure link bhejta hoon. OTP kisi ko mat dijiye, mujhe bhi nahi."),
    "P9": ("Sorry, please go ahead. (Pause, let the customer finish.) Just to make sure I understood: you're asking about ... Let me explain that.",
           "Sorry, aap boliye. (Customer ko poora bolne dein.) Main sahi samjha: aap ... ke baare mein puchh rahe hain? Main samjhata hoon."),
    "P10": ("To summarise: [plan], premium Rs X including GST. You'll receive the policy by email within a day, and you have a free-look period to review it and cancel if it isn't right for you. Anything else I can help with?",
            "Summary: [plan], premium Rs X GST ke saath. Policy ek din mein email pe aa jayegi, aur free-look period mein aap review karke cancel bhi kar sakte hain. Aur kuch?"),
}

PRACTICE = {
    "P1": "Role-play 5 openings in a row with your team lead playing a busy customer who asks 'who is this?'.",
    "P2": "Open 5 practice calls; the team lead checks the recording line comes before any question about the customer.",
    "P3": "Team lead plays a customer who says 'just tell me the best plan'. Ask your 4 questions anyway and use the answers in the recommendation.",
    "P4": "Explain 3 plans from the quote sheet; the team lead checks sum insured/IDV and the cashless wording against the quote.",
    "P5": "Team lead plays a 52-year-old customer with diabetes who asks 'will my sugar be covered?'. Answer with all three waiting periods and any co-pay, in your own words.",
    "P6": "Team lead asks 'Will my claim definitely be approved?' and 'Do I get money back if I don't claim?'. Answer honestly three times in a row.",
    "P7": "Team lead says 'Let me discuss with my wife' three different ways. Each time, respect it, send details and book a follow-up. No urgency lines.",
    "P8": "Walk through payment 3 times: premium with GST, secure link, and the 'never share OTP' line.",
    "P9": "Team lead interrupts you mid-sentence 3 times with a confused question. Stop, let them finish, paraphrase, then answer.",
    "P10": "Close 3 practice sales with plan, premium, documents timeline and free-look period.",
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


def _llm_personalise(module):
    ex = "\n".join(f"Call {e['call']}: " + " | ".join(f"[{n}] {s}: {t}" for n, s, t in e["lines"]) for e in module["excerpts"])
    sys = ("You are a sales-quality coach at an Indian insurance broker. Write short, specific, respectful coaching for a sales agent, "
           "based only on the excerpts given. Never suggest urgency, pressure, guarantees or asking for OTPs. Do not include customer names or "
           "health details. Match the language of the excerpts (English or Hinglish). Return JSON: "
           "{\"feedback\": \"2-3 sentences on what went wrong, citing the excerpt\", \"better\": \"one compliant line the agent could have said\", "
           "\"practice\": \"one role-play scenario\"}")
    user = f"Rule: {module['rule']}\nExcerpts:\n{ex}"
    out = llm.chat_json(sys, user, temperature=0.3, max_tokens=700)
    module.update(feedback=out.get("feedback", ""), better=out.get("better", module["better"]),
                  practice=out.get("practice", module["practice"]), generated_by="llm")
    return module
