"""Live AI Sales Buddy: a simulated customer plus a real-time compliance coach for role-play practice.

The coach is deterministic (rules + policy facts) so it reacts instantly; the customer is an LLM persona when a key is set,
otherwise a scripted persona that reacts to what the agent says.
"""
import re

from . import llm, policy
from .coaching import BETTER
from .rules import (DISMISS, FOLLOWUP, FREELOOK, GST, HESITATE, MISSTATE, OTP_ASK, OTP_SAFE, OVERCLAIM, PRESSURE, PREMIUM_AMT,
                    PROMISE, NO_PROMISE, RECORD, SUMMARY, COMPANY, NAME_INTRO, REASON, NEED_Q)

I = re.I

PERSONAS = {
    "ramesh": dict(
        name="Ramesh Gupta", tag="58, BP patient, Hinglish, wants to ask his wife", plan="insurer-b-health-secure-plus", lang="hi",
        brief="You are Ramesh Gupta, 58, retired bank clerk from Jaipur, speaking Hinglish. You enquired on the website about health insurance "
              "for you and your wife (54). You have had high BP for 4 years and take daily medicine. Your office cover of 3 lakh ended at retirement. "
              "Budget about 20-25 thousand a year. You worry whether your BP will be covered. You never buy on the first call: you want to discuss with your wife. "
              "If the agent pressures you, you get annoyed. If asked for an OTP you get suspicious.",
        script=[
            (r"record", "Haan theek hai, record kar lijiye."),
            (r"kis-?kis|who.*cover|kisko|family|age|umar", "Main aur meri wife. Main 58 ka hoon, wife 54 ki."),
            (r"bimari|illness|disease|medic|dawai|health|sugar|bp|condition", "Haan, mujhe 4 saal se BP hai, roz dawai leta hoon. Ye cover hoga na?"),
            (r"existing|current|abhi koi|already|company|office|employer", "Office ka 3 lakh ka cover tha, retire hone ke baad khatam ho gaya."),
            (r"budget|kitna|afford", "Saal ka 20-25 hazaar tak chal jayega."),
            (r"suggest|recommend|plan", "Achha. Par mera BP wala kab se cover hoga?"),
            (r"pre-?existing|pehle se maujood|3 saal|36|waiting", "Teen saal? Hmm, theek hai, kam se kam saaf bataya aapne."),
            (r"premium|₹|\brs\b", "Theek hai... main wife se baat karke kal batata hoon."),
        ],
        opener="Haan ji, boliye?",
    ),
    "kamla": dict(
        name="Kamla Devi", tag="66, senior with diabetes, daughter decides", plan="insurer-a-senior-care", lang="hi",
        brief="You are Kamla Devi, 66, from Lucknow, speaking simple Hinglish. Your daughter Priya asked you to look at senior health insurance. "
              "You have diabetes for 8 years. You get confused by numbers and ask the agent to repeat. You want your daughter to see the details first.",
        script=[
            (r"record", "Haan beta, theek hai."),
            (r"kis-?kis|who.*cover|kisko|age|umar", "Sirf mere liye, beta. Main 66 ki hoon."),
            (r"bimari|illness|disease|medic|dawai|health|sugar|bp|condition", "Sugar hai, aath saal se. Uska kya hoga?"),
            (r"existing|current|abhi koi|already", "Koi policy nahi hai abhi."),
            (r"budget|kitna", "Beti dekhegi, woh hi decide karegi."),
            (r"suggest|recommend|plan", "Ye sab thoda samjha dijiye, mujhe numbers samajh nahi aate."),
            (r"co-?pay|20", "Matlab har baar thoda paisa humein dena padega? Achha."),
            (r"premium|₹|\brs\b", "Aap ye sab meri beti ko WhatsApp kar dijiye, woh dekh legi."),
        ],
        opener="Haan, hello? Kaun bol raha hai?",
    ),
    "vikram": dict(
        name="Vikram Shah", tag="Car owner switching insurer, has NCB, English", plan="insurer-e-car-shield", lang="en",
        brief="You are Vikram Shah, 34, software engineer in Pune, speaking English. Your 2021 Hyundai Creta policy expires in 12 days and you want to switch "
              "insurer for a better price. You have had no claims for 3 years and expect your NCB to carry over. You park in a society basement. "
              "You ask sharp questions about claims and deductibles and dislike vague answers.",
        script=[
            (r"record", "Sure, go ahead."),
            (r"vehicle|car|model|year", "2021 Hyundai Creta, petrol."),
            (r"current|existing|expire|policy", "Current policy expires in 12 days. No claims in 3 years, so I should keep my NCB, right?"),
            (r"park|usage|use", "Parked in my society basement, mostly city driving."),
            (r"suggest|recommend|plan", "What's the catch? Anything I pay at claim time?"),
            (r"deductible|1,?000", "Okay, a thousand per claim is fine. And the NCB?"),
            (r"ncb|no[- ]claim", "Got it, I'll dig out the old policy for the NCB proof."),
            (r"premium|₹|\brs\b", "Send me the quote on email, I'll compare tonight and get back."),
        ],
        opener="Hello, Vikram here.",
    ),
}

INFO_TRIGGERS = {"ramesh": (1, 2, 3, 4), "kamla": (1, 2, 3, 4), "vikram": (1, 2, 3)}  # answers given only to a question

QWORDS = re.compile(r"\?|\b(kya|kaun|kitna|kitni|kitne|kab|kaise|kis|kisi|koi|kahan|kyun|what|who|how|which|when|where|why|any|do you|are you|is there|can you|could you|would you|have you|does|batayein|bataiye|bataye|bata dijiye)\b", I)
AGENT_CUES = re.compile(r"policynest|insurance brokers|\bplan\b|premium|suggest|recommend|record|waiting period|co-?pay|deductible|network|cashless|sum insured|\bidv\b|\bsir\b|ma'?am|madam|aapko|aapke|aapki|main aapko|calling (from|about)|enquir|link bhej|free-?look|gst|policy wording", I)
CUST_CUES = re.compile(r"\b(mujhe|meri|mera|mere|hum|humein|my wife|my husband|my son|my daughter|beta|beti|wife|husband|budget|kab se|hoga na|ho jayega na|samajh|achha|accha|theek hai|haan|nahi chahiye|sochna|baat karke|i want|i have|i am|i'm \d|we have|our|expire|my car)\b", I)


SPOKEN_PROMISE = re.compile(r"(100|hundred)\s?(%|percent)|definitely (be )?(approved|settled|paid|pass)|\bguarantee|pakka (pass|approve|milega|ho jayega)|claim (kabhi )?reject nahi|never (be )?rejected|premium wapas|paisa wapas|money back", I)


def is_question(text):
    return bool(QWORDS.search(text or ""))


def guess_speaker(text, context):
    """Rule-based guess of who said a live segment: AGENT or CUSTOMER (fallback when no LLM)."""
    a, c = len(AGENT_CUES.findall(text)), len(CUST_CUES.findall(text))
    if a > c:
        return "AGENT"
    if c > a:
        return "CUSTOMER"
    prev = context[-1]["s"] if context else "CUSTOMER"
    return "CUSTOMER" if prev == "AGENT" else "AGENT"


LABEL_SYSTEM = """You label who is speaking on a live Indian insurance sales call. The AGENT works for PolicyNest Insurance Brokers and sells a policy;
the CUSTOMER answers questions and asks about cover. Given the recent conversation and a new segment, say who spoke the new segment.
Return ONLY JSON: {"speaker": "AGENT" or "CUSTOMER"}"""


def label_segment(text, context, use_llm=True):
    if use_llm and llm.available():
        try:
            convo = "\n".join(f"{t['s']}: {t['t']}" for t in context[-8:])
            out = llm.chat_json(LABEL_SYSTEM, f"Recent conversation:\n{convo or '(start of call)'}\n\nNew segment: {text}", max_tokens=300)
            sp = str(out.get("speaker", "")).upper()
            if sp.startswith(("A", "C")):
                return ("AGENT" if sp.startswith("A") else "CUSTOMER"), "ai"
        except Exception:
            pass
    return guess_speaker(text, context), "rules"


HINDI = re.compile(r"\b(hai|hoon|aap|kya|nahi|theek|ji|karna|kijiye|lijiye|bata)\b", I)


def _lang(turns):
    txt = " ".join(t["t"] for t in turns if t["s"] == "AGENT")
    return "hi" if len(HINDI.findall(txt)) >= 2 else "en"


def _line(param, lang):
    en, hi = BETTER[param]
    return hi if lang == "hi" else en


def ped_line(f, lang):
    y = f.get("ped_wait_months", 36) / 12
    extra_en, extra_hi = [], []
    if f.get("initial_wait_days"):
        extra_en.append(f"a {f['initial_wait_days']:g}-day initial waiting period"); extra_hi.append(f"{f['initial_wait_days']:g} din ka initial waiting period")
    if f.get("specific_wait_months"):
        extra_en.append(f"{f['specific_wait_months'] / 12:g} years for specific illnesses like cataract or hernia"); extra_hi.append(f"cataract ya hernia jaisi bimariyon ke liye {f['specific_wait_months'] / 12:g} saal")
    if f.get("copay_pct"):
        extra_en.append(f"a {f['copay_pct']:g}% co-payment on every claim"); extra_hi.append(f"har claim pe {f['copay_pct']:g}% co-payment")
    if lang == "hi":
        return (f"Bataane ke liye shukriya. Ye pehle se maujood bimari hai, iske liye {y:g} saal ka waiting period hai, pehle din se cover nahi hai."
                + (f" Saath mein {', '.join(extra_hi)}." if extra_hi else "") + " Ye sab policy wording mein hai, main bhej deti hoon.")
    return (f"Thank you for telling me. That's a pre-existing condition, so it's covered only after a {y:g}-year waiting period, not from day one."
            + (f" There's also {', '.join(extra_en)}." if extra_en else "") + " It's all in the policy wording I'll send you.")


def coach(turns, persona_id="ramesh", docs=None, plan_id=None):
    """Checklist state, next-best nudges and red alerts for the conversation so far."""
    per = PERSONAS.get(persona_id) or dict(plan=None, lang="hi")
    docs = docs or policy.seed_docs()
    want = plan_id or per["plan"]
    doc = (next((d for d in docs if d.get("id") == want), None) if want else None) or policy.pick_doc(turns, docs)
    f = policy.facts(doc) if doc else {}
    dom = policy.domain_of(doc) if doc else "HEALTH"
    agent = [t for t in turns if t["s"] == "AGENT"]
    cust = [t for t in turns if t["s"] == "CUSTOMER"]
    A = " ".join(t["t"] for t in agent)
    lang = _lang(turns) if agent else per["lang"]
    alerts, nudges = [], []

    rec_t = next((t for t in agent if RECORD.search(t["t"])), None)
    personal_c = next((t for t in cust if re.search(r"\d{2}|bp|sugar|diabet|bimari|wife|husband|beti|creta|car|policy|cover", t["t"], I)), None)
    rec_state = "done" if rec_t and (not personal_c or rec_t["n"] < personal_c["n"]) else ("fail" if personal_c and (not rec_t or rec_t["n"] > personal_c["n"]) else "todo")
    opening = all(p.search(A) for p in (COMPANY,)) and (NAME_INTRO.search(A) is not None)
    need_q = sum(1 for t in agent if NEED_Q.search(t["t"]))
    illness = next((t for t in cust if re.search(policy.HEALTH_WORDS, t["t"], I)), None)
    hesitated = next((t for t in cust if HESITATE.search(t["t"]) or re.search(r"wife se|baat karke|compare|beti|daughter|get back", t["t"], I)), None)
    pitched = next((t for t in agent if re.search(r"suggest|recommend", t["t"], I)), None)
    pay_t = next((t for t in agent if PREMIUM_AMT.search(t["t"]) or re.search(r"payment link|secure link", t["t"], I)), None)

    # disclosure items from the plan's wording
    disc = []
    for key, label, pat, _ in policy.REQUIRED[dom]:
        if key in f and not (key == "copay_pct" and not f[key]):
            disc.append(dict(label=f"{label}: {policy._fact_text(key, f[key])}", done=bool(re.search(pat, A, I))))
    disc_done = all(d["done"] for d in disc)

    # red alerts on the latest agent line
    if agent:
        last = agent[-1]
        lt = last["t"]
        prevc = " ".join(t["t"] for t in cust if t["n"] < last["n"])
        if OTP_ASK.search(lt) and not OTP_SAFE.search(lt):
            alerts.append(dict(level="fatal", title="Never ask for an OTP", said=lt, fix=_line("P8", lang), param="P8"))
        ill_any = next((t for t in turns if t["n"] < last["n"] and re.search(policy.HEALTH_WORDS, t["t"], I)), None)
        if MISSTATE.search(lt) and (illness or ill_any) and (illness or ill_any)["n"] < last["n"]:
            alerts.append(dict(level="fatal", title="Don't say 'it's covered' to an existing illness", said=lt, fix=ped_line(f, lang) if f.get("ped_wait_months") else _line("P5", lang), param="P5"))
        if (PROMISE.search(lt) or SPOKEN_PROMISE.search(lt)) and not NO_PROMISE.search(lt):
            alerts.append(dict(level="fatal", title="That's a false promise", said=lt, fix=_line("P6", lang), param="P6"))
        if PRESSURE.search(lt):
            alerts.append(dict(level="major", title="That's pressure selling", said=lt, fix=_line("P7", lang), param="P7"))
        if OVERCLAIM.search(lt):
            alerts.append(dict(level="major", title="Cashless is only at network hospitals/garages", said=lt, fix=_line("P4", lang), param="P4"))
        if DISMISS.search(lt):
            alerts.append(dict(level="minor", title="Sounds dismissive", said=lt, fix=_line("P9", lang), param="P9"))
        if doc:
            for x in policy.check_statement(last["n"], lt, f, doc, prevc):
                if x["verdict"] == "CONTRADICTED" and not any(a["param"] == x["param"] for a in alerts):
                    alerts.append(dict(level="fatal" if x["param"] in ("P5", "P6") else "major", title=f"Policy says otherwise: {x['topic']}",
                                       said=lt, fix=f"Policy {x['clause']['id'] if x['clause'] else ''}: {x['policy']}", param=x["param"]))

    # next-best nudges, most urgent first
    if not agent:
        nudges.append(dict(why="Open the call", say=_line("P1", lang)))
    if rec_state == "todo" and agent:
        nudges.append(dict(why="Recording consent before any personal detail", say=_line("P2", lang), urgent=True))
    if rec_state == "fail" and not rec_t:
        nudges.append(dict(why="The customer already shared details. Say the recording line now and note it", say=_line("P2", lang), urgent=True))
    if pitched is None and need_q < 3 and agent:
        nudges.append(dict(why=f"Ask {3 - need_q} more need question(s) before recommending", say=_line("P3", lang)))
    if illness and not re.search(r"pre-?existing|pehle se maujood", A, I) and f.get("ped_wait_months"):
        nudges.append(dict(why="Customer mentioned an illness: give the exact waiting period", say=ped_line(f, lang), urgent=True))
    if pitched and not disc_done:
        miss = [d["label"] for d in disc if not d["done"]]
        nudges.append(dict(why="Disclose before any premium or link: " + "; ".join(miss), say=ped_line(f, lang) if dom == "HEALTH" and f.get("ped_wait_months") else _line("P5", lang), urgent=bool(pay_t)))
    if hesitated and not FOLLOWUP.search(" ".join(t["t"] for t in agent if t["n"] > hesitated["n"])):
        nudges.append(dict(why="Customer wants time: respect it and book a follow-up", say=_line("P7", lang), urgent=True))
    if pay_t and not GST.search(pay_t["t"]):
        nudges.append(dict(why="Say the premium includes GST and that you'll never ask for an OTP", say=_line("P8", lang)))
    if pitched and (hesitated or pay_t) and not SUMMARY.search(" ".join(t["t"] for t in agent[-2:])):
        nudges.append(dict(why="Close with a summary and the next step" + (" and the free-look period" if pay_t else ""), say=_line("P10", lang)))

    fail = {a["param"] for a in alerts}
    checklist = [
        dict(id="P1", label="Name, company and reason", state="done" if opening else "todo"),
        dict(id="P2", label="Recording consent first", state=rec_state),
        dict(id="P3", label=f"Need questions ({min(need_q, 3)}/3)", state="done" if need_q >= 3 else ("fail" if pitched and need_q < 3 else "todo")),
        dict(id="P5", label="Disclosures from the policy", state="done" if disc and disc_done else ("fail" if pay_t and not disc_done else "todo"), items=disc),
        dict(id="P6", label="No promises", state="fail" if "P6" in fail or re.search(PROMISE.pattern, A, I) and not NO_PROMISE.search(A) else "ok"),
        dict(id="P7", label="No pressure; follow-up if asked", state="fail" if PRESSURE.search(A) else ("done" if hesitated and FOLLOWUP.search(A) else "ok")),
        dict(id="P8", label="Premium with GST, no OTP", state="fail" if any(OTP_ASK.search(t["t"]) and not OTP_SAFE.search(t["t"]) for t in agent) else ("done" if pay_t and GST.search(A) else "ok")),
        dict(id="P10", label="Summary and next step", state="done" if SUMMARY.search(A) and re.search(r"whatsapp|email|call|kal|tomorrow|send|bhej", A, I) else "todo"),
    ]
    done = sum(1 for c in checklist if c["state"] in ("done", "ok"))
    fails = sum(1 for c in checklist if c["state"] == "fail")
    meter = max(0, round(100 * done / len(checklist)) - 15 * fails)
    return dict(checklist=checklist, nudges=nudges[:3], alerts=alerts, meter=meter, plan=(policy.plan_name(doc) if doc else None))


CUSTOMER_SYSTEM = """You role-play a customer on an insurance sales call so a sales agent can practise. Stay in character.
{brief}
Rules: reply in 1-2 short sentences, in the same language style as your persona. Answer only what the agent asked; reveal facts only when asked.
React naturally: ask about your illness/conditions when it is relevant, push back on pressure, refuse to share any OTP.
Return ONLY JSON: {{"reply": "..."}}"""


def customer_reply(turns, persona_id="ramesh", use_llm=False):
    per = PERSONAS.get(persona_id, PERSONAS["ramesh"])
    agent = [t for t in turns if t["s"] == "AGENT"]
    if not agent:
        return per["opener"], "script"
    if use_llm and llm.available():
        try:
            convo = "\n".join(f"{'AGENT' if t['s'] == 'AGENT' else 'YOU'}: {t['t']}" for t in turns[-16:])
            out = llm.chat_json(CUSTOMER_SYSTEM.format(brief=per["brief"]), f"Conversation so far:\n{convo}\n\nYour next line:", temperature=0.6, max_tokens=400)
            r = str(out.get("reply", "")).strip()
            if r:
                return r, "ai"
        except Exception:
            pass
    last = agent[-1]["t"]
    said = {t["t"] for t in turns if t["s"] == "CUSTOMER"}
    if OTP_ASK.search(last) and not OTP_SAFE.search(last):
        return ("OTP? Woh toh kisi ko nahi batate na? Main nahi bataunga." if per["lang"] == "hi" else "An OTP? No, I'm not sharing that."), "script"
    if PRESSURE.search(last):
        return ("Aap itna jaldi kyun kar rahe ho? Mujhe sochna hai." if per["lang"] == "hi" else "Don't rush me. I said I'll compare first."), "script"
    if FOLLOWUP.search(last):
        return ("Haan, kal shaam call kar lijiye. Details WhatsApp kar dijiye." if per["lang"] == "hi" else "Sure, email me and call tomorrow evening."), "script"
    if SUMMARY.search(last) or re.search(r"anything else|aur kuch", last, I):
        return ("Theek hai, thank you." if per["lang"] == "hi" else "That's all, thanks."), "script"
    asked = is_question(last)
    for i, (pat, reply) in enumerate(per["script"]):
        info = i in INFO_TRIGGERS.get(persona_id, ())
        if reply not in said and re.search(pat, last, I) and (asked or not info):
            return reply, "script"
    if not asked:
        return ("Haan ji." if per["lang"] == "hi" else "Okay."), "script"
    n = len(agent)
    filler = (["Achha.", "Haan ji, boliye.", "Theek hai, aur kya details hain?", "Samajh gaya. Aage bataiye."] if per["lang"] == "hi"
              else ["Okay.", "Right, go on.", "Sure. What else should I know?", "Got it."])
    return filler[n % len(filler)], "script"
