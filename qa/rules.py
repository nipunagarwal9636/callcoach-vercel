"""Rule layer: fast, deterministic checks for red-flag phrases, absences and applicability.

Each check returns a Finding. Rules are written from the scorecard guide (definitions + red-flag list),
in English and Hinglish, and are deliberately generic (not tied to one script) so the LLM judge
only has to resolve context.
"""
import re
from dataclasses import dataclass, field

I = re.I


@dataclass
class Finding:
    param: str
    result: str                 # MET | NOT_MET | NOT_APPLICABLE | REVIEW
    turns: list = field(default_factory=list)
    quote: str = ""
    reason: str = ""
    confidence: float = 0.9
    source: str = "rules"


def rx(*parts):
    return re.compile("|".join(parts), I)


# ---------- shared vocab ----------
HEALTH_COND = rx(r"\b(sugar|diabet\w*|bp|blood pressure|thyroid|asthma|heart|cardiac|cholesterol|kidney|cancer|arthritis|"
                 r"pre[- ]?existing|existing (illness|disease|condition)|bimari|dawai|medicine|medication|surgery|operation)\b")
NEGATION = rx(r"\b(don'?t|do not|never|not|no one|nobody|mat|na|nahi|kisi ko)\b")
PAID = rx(r"\b(i'?ve paid|paid|pay kar diya|payment (done|ho gaya|kar diya)|ho gaya payment)\b")
HESITATE = rx(r"\b(discuss|think (about|it over)|let me think|sochk|soch ke|soch(unga|ungi|na hai)|baat karke|consult|compare|"
              r"get back|baad mein|not now|abhi nahi|puchh(na|ke|kar|unga|ungi)|ask (him|her|them|my)|talk to (my|him|her)|"
              r"check with|not interested|nahi chahiye|interest nahi|later)\b")
FOLLOWUP = rx(r"\b(call (you )?(back|tomorrow|later)|kal (shaam |subah )?call|call karoon|call karu|follow[- ]?up|whatsapp|"
              r"send (you )?(the )?details|details bhej|bhej (deta|deti|dunga|dungi)|aapke time pe|your (own )?time|take your time|"
              r"no rush|koi jaldi nahi)\b")


def _agent_turns(call):
    return [t for t in call.turns if t.speaker == "AGENT"]


def _first(turns, pat):
    for t in turns:
        if pat.search(t.text):
            return t
    return None


def _prev_customer(call, turn_no):
    prev = [t for t in call.turns if t.speaker == "CUSTOMER" and t.no < turn_no]
    return prev[-1] if prev else None


def is_sale(call):
    return any(t.speaker == "CUSTOMER" and PAID.search(t.text) for t in call.turns)


def domain(call):
    txt = " ".join(t.text for t in call.turns).lower()
    motor = len(re.findall(r"\b(car|gaadi|vehicle|idv|garage|zero dep|motor|bike|ncb|deductible)\b", txt))
    health = len(re.findall(r"\b(health|hospital|waiting period|sum insured|illness|bimari|co-?pay|room rent)\b", txt))
    return "MOTOR" if motor > health else "HEALTH"


# ---------- P1 ----------
NAME_INTRO = rx(r"\b(i'?m|i am|my name is|this is|main|mera naam)\s+[A-Z][a-z]+", r"\bmain\s+\w+,")
COMPANY = rx(r"policy\s?nest")
REASON = rx(r"enquir|inquir|calling (to|about|regarding)|call kiya|regarding|because you|aapne .{0,40}(enquiry|request)|you'?d (asked|requested)")


def p1(call):
    first = _agent_turns(call)[:2]
    txt = " ".join(t.text for t in first)
    has_name = bool(re.search(r"\b(?i:i'?m|i am|my name is|this is)\s+[A-Z][a-z]+", txt)) or bool(re.search(r"\b(?i:main|mera naam(?: hai)?)\s+[A-Z][a-z]+", txt))
    has_co, has_reason = bool(COMPANY.search(txt)), bool(REASON.search(txt))
    t0 = first[0] if first else None
    if has_name and has_co:
        return Finding("P1", "MET", reason="Name and company given" + ("" if has_reason else " (reason for call not explicit)"), confidence=0.9)
    missing = [w for w, ok in (("own name", has_name), ("company", has_co), ("reason for call", has_reason)) if not ok]
    return Finding("P1", "NOT_MET", [t0.no] if t0 else [], t0.text if t0 else "", "Opening misses: " + ", ".join(missing), 0.9)


# ---------- P2 ----------
RECORD = rx(r"\brecord(ed|ing)?\b", r"record (ho|kar) rah", r"recording")
PERSONAL = rx(r"\b(\d{2}|ages?|umar|saal ka|years? old|budget|lakh|hazaar|model|claims?|expire|park|cover(ed)? (hai|already)|company ka|"
              r"wife|husband|beta|beti|son|daughter|mother|father)\b")


def p2(call):
    rec = None
    for t in _agent_turns(call):
        if RECORD.search(t.text) and not re.search(r"not (being )?record", t.text, I):
            rec = t
            break
    if rec is None:
        return Finding("P2", "NOT_MET", [], "No recording disclosure anywhere in the call",
                       "Absence: the customer is never told the call is recorded", 0.95)
    shared = [t for t in call.turns if t.speaker == "CUSTOMER" and t.no < rec.no and (PERSONAL.search(t.text) or HEALTH_COND.search(t.text))]
    if shared:
        s = shared[0]
        return Finding("P2", "NOT_MET", [s.no, rec.no], rec.text,
                       f"Recording disclosed at turn {rec.no}, after the customer shared personal details at turn {s.no}", 0.85)
    return Finding("P2", "MET", [rec.no], rec.text, "Recording disclosed before any personal details", 0.95)


# ---------- P3 ----------
SKIP_NEED = rx(r"best plan (directly|seedha)", r"seedha best plan", r"directly (tell|give|suggest)", r"without (asking|wasting)",
               r"straight to the (best )?plan")
RECOMMEND = rx(r"\b(i'?d suggest|i suggest|i'?d recommend|i recommend|suggest kar|recommend kar|plan (lijiye|le lijiye)|go with)")
NEED_Q = rx(r"\b(who|kis-kis|kisko|age|umar|existing|bimari|illness|disease|medic|dawai|sugar|bp|thyroid|current|abhi koi|already|"
            r"employer|company wala|company ka|budget|kitna soch|which car|kaunsi|model|year|claims?|expir|park|usage|chalate)\b")


def p3(call):
    rec = _first(_agent_turns(call), RECOMMEND)
    limit = rec.no if rec else 10 ** 6
    skip = _first([t for t in _agent_turns(call) if t.no < limit], SKIP_NEED)
    qs = [t for t in _agent_turns(call) if t.no < limit and ("?" in t.text or re.search(r"\b(kya|kitna|kaun|kab|which|what|how|when)\b", t.text, I)) and NEED_Q.search(t.text)]
    if skip:
        return Finding("P3", "NOT_MET", [skip.no], skip.text, "Agent pitches without asking need-analysis questions", 0.95)
    if rec is None and not qs:
        return Finding("P3", "MET", reason="No recommendation made; need analysis not tested", confidence=0.6)
    if len(qs) >= 3:
        return Finding("P3", "MET", [q.no for q in qs], " | ".join(q.text for q in qs[:3]), f"{len(qs)} need-analysis questions before recommending", 0.9)
    return Finding("P3", "NOT_MET", [rec.no] if rec else [], rec.text if rec else "",
                   f"Only {len(qs)} relevant question(s) before the recommendation (needs 3)", 0.8)


# ---------- P4 ----------
OVERCLAIM = rx(r"\b(all|every|saare|sabhi|har)\s+(\w+\s+){0,3}(hospitals?|garages?)\b[^.]{0,40}\bcashless",
               r"(hospitals?|garages?)[^.]{0,20}(everywhere|anywhere|kahin bhi|sab jagah)[^.]{0,20}cashless",
               r"cashless (everywhere|anywhere|at any (hospital|garage)|kahin bhi)",
               r"har garage cashless", r"india ka har garage",
               r"cashless[^.]{0,40}\b(at|in|across)\s+(every|all|any|har)\s+(\w+\s+){0,2}(hospitals?|garages?)",
               r"\b(every|all|har)\s+(garage|hospital)s?\s+(across|in)\s+india", r"unlimited (cover|claims?|sum insured)", r"no (sub-?)?limits? at all")


def p4(call):
    for t in _agent_turns(call):
        m = OVERCLAIM.search(t.text)
        if m and not re.search(r"\bnot (all|every)\b|only network|sirf network", t.text, I):
            return Finding("P4", "NOT_MET", [t.no], t.text, "Inaccurate feature claim: only network hospitals/garages are cashless", 0.9)
    return Finding("P4", "MET", reason="No inaccurate feature claim detected (sum insured / IDV vs quote not checkable without the quote)", confidence=0.75)


# ---------- P5 ----------
MISSTATE = rx(r"(sab|sabkuch|sab kuch|everything|it'?s all|all)\s+(is\s+)?covered", r"sab cover", r"\btension mat\b", r"don'?t worry[^.]{0,30}cover",
              r"no waiting( period)? (for you|at all|applicable)", r"koi waiting nahi", r"waiting period nahi (hai|lagega)",
              r"nothing (like that|to worry)", r"kuch nahi\W{0,3}\s*(bahut\s+)?(simple|aasaan)", r"\b(very|bahut) simple\b", r"claim mein kuch nahi", r"covered from (day one|the first day)",
              r"pehle din se cover", r"no (hidden )?(conditions|exclusions)")
ASK_LIMIT = rx(r"\b(cover(ed)? hoga|covered\?|will (that|it|this) be covered|is (it|that) covered|anything i should know|koi condition|"
               r"kuch (dhyan|janna)|any (catch|condition|exclusion)|waiting|claims?)\b")
H_INIT = rx(r"initial waiting", r"30[- ]?(din|day)", r"thirty[- ]day")
H_SPEC = rx(r"specific (illness|bimari|disease)", r"cataract|hernia", r"2 (saal|years?)|two years")
H_PED = rx(r"pre[- ]?existing", r"pehle se maujood", r"3 (saal|years?)|three years")
H_COPAY = rx(r"co-?pay", r"room rent", r"sub-?limit")
M_DED = rx(r"deductible")
M_ADDON = rx(r"zero dep\w*[^.]{0,40}(limit|claims? a year|do claim|two claims)", r"not covered without", r"add-?on", r"ncb|no[- ]claim bonus")
PAY_TURN = rx(r"premium\b[^.]{0,30}(₹|\brs\.?|\brupees)\s?\d", r"payment link|secure link|link (bhej|send)", r"\botp\b")


def _clean(text):
    """Drop negated risky phrases ("pehle din se cover nahi hai") so a correct line isn't flagged."""
    from .policy import clean_negations
    return clean_negations(text)


def p5(call):
    agent = _agent_turns(call)
    # 1) Misstatements (worst pattern), judged against the customer's preceding question
    for t in agent:
        if MISSTATE.search(_clean(t.text)):
            prev = _prev_customer(call, t.no)
            ctx = prev.text if prev else ""
            if HEALTH_COND.search(ctx) or ASK_LIMIT.search(ctx):
                return Finding("P5", "NOT_MET", [t.no] + ([prev.no] if prev else []), t.text,
                               f"Misstated limits in reply to the customer's question (turn {prev.no if prev else '?'}: \"{ctx[:80]}\")", 0.95)
            return Finding("P5", "REVIEW", [t.no], t.text,
                           "Reassurance phrase found but context unclear (may be true for this benefit): send to a human", 0.5)
    # 2) Absence of required disclosures before payment, once a plan has been pitched
    rec = _first(agent, RECOMMEND)
    pay = _first(agent, PAY_TURN)
    if rec is None and pay is None:
        return Finding("P5", "MET", reason="No plan pitched and no limits misstated", confidence=0.6)
    cutoff = pay.no if pay else 10 ** 6
    before = " ".join(t.text for t in agent if t.no < cutoff)
    if domain(call) == "HEALTH":
        have = {"initial waiting": bool(H_INIT.search(before)), "specific-illness waiting": bool(H_SPEC.search(before)),
                "pre-existing disease waiting": bool(H_PED.search(before))}
    else:
        have = {"compulsory deductible": bool(M_DED.search(before)), "add-on conditions / exclusions": bool(M_ADDON.search(before))}
    missing = [k for k, ok in have.items() if not ok]
    if not missing:
        dt = _first([t for t in agent if t.no < cutoff], H_PED if domain(call) == "HEALTH" else M_DED)
        return Finding("P5", "MET", [dt.no] if dt else [], dt.text if dt else "", "Required disclosures given before payment", 0.9)
    anchor = pay or rec
    return Finding("P5", "NOT_MET", [anchor.no], "(no disclosure of " + ", ".join(missing) + " before payment)",
                   "Absence: mandatory disclosures missing before payment: " + ", ".join(missing), 0.85)


# ---------- P6 ----------
PROMISE = rx(r"100\s?%\s*(approved|pass|guarantee|sure|claim)", r"\bguarantee(d)?\b", r"guarantee hai", r"pakka (pass|approve|milega)",
             r"(premium|paisa|money|paise)\s*(back|wapas|return)", r"get (your|the) (premium|money) back", r"wapas mil",
             r"(returns?|interest) of \d+", r"covered from (day one|the first day)", r"pehle din se cover")
NO_PROMISE = rx(r"(no|can'?t|cannot|not|nahi)\s+(a\s+)?guarantee", r"guarantee nahi", r"insurer decides|decided by the insurer|policy wording ke hisaab")


def p6(call):
    for t in _agent_turns(call):
        if PROMISE.search(_clean(t.text)) and not NO_PROMISE.search(t.text):
            return Finding("P6", "NOT_MET", [t.no], t.text, "False promise about claims, returns or benefits", 0.95)
    return Finding("P6", "MET", reason="No guarantees or promised returns", confidence=0.85)


# ---------- P7 ----------
PRESSURE = rx(r"(only|sirf)[^.]{0,25}(today|tonight|aaj)", r"(valid|offer)[^.]{0,15}(till|tak)[^.]{0,10}(tonight|today|aaj)",
              r"(tomorrow|kal se)[^.]{0,40}(go(es)? up|badh|increase|mehenga|zyada)", r"regret", r"pachhta",
              r"everyone[^.]{0,30}(regret|buys?|takes?)", r"last chance", r"abhi kar lete", r"let'?s (just )?do it now",
              r"do it right now", r"abhi le lijiye", r"don'?t (wait|delay)")


def p7(call):
    agent = _agent_turns(call)
    hes = [t for t in call.turns if t.speaker == "CUSTOMER" and HESITATE.search(t.text)]
    press = [t for t in agent if PRESSURE.search(t.text)]
    if press:
        after_hes = [t for t in press if not hes or t.no > hes[0].no]
        ev = after_hes or press
        return Finding("P7", "NOT_MET", [t.no for t in ev], ev[-1].text,
                       "False urgency or emotional pressure" + (" after the customer asked for time" if hes else ""), 0.95)
    if hes:
        fu = _first([t for t in agent if t.no > hes[0].no], FOLLOWUP)
        return Finding("P7", "MET", [hes[0].no] + ([fu.no] if fu else []), fu.text if fu else "",
                       "Customer's wish to think/consult was respected" + (" and a follow-up offered" if fu else ""), 0.9 if fu else 0.7)
    if is_sale(call):
        return Finding("P7", "NOT_APPLICABLE", reason="Customer bought without hesitation; no pressure situation arose", confidence=0.8)
    return Finding("P7", "MET", reason="No pressure detected", confidence=0.75)


# ---------- P8 ----------
OTP_ASK = rx(r"(tell|share|give|read|send|bol|bata|batao|bata dena|bata do|bataiye)[^.]{0,25}\b(otp|pin|cvv)\b",
             r"\b(otp|pin|cvv)\b[^.]{0,25}(bata|batao|bata dena|bata do|tell me|share (it|with me)|bol do|bolo)",
             r"card number[^.]{0,20}(tell|bata|share|bol)", r"(tell|bata|share)[^.]{0,20}card number")
OTP_SAFE = rx(r"(don'?t|do not|never|mat|na)[^.]{0,30}\b(otp|pin|cvv)\b", r"\b(otp|pin|cvv)\b[^.]{0,30}(kisi ko mat|mat (dijiye|batana|bataiye|share)|with anyone)")
GST = rx(r"gst|including (all )?tax|taxes included|tax ke saath")
PREMIUM_AMT = rx(r"premium[^.]{0,25}(₹|\brs\.?|\brupees)\s?\d[\d,]*", r"(₹|\brs\.?)\s?\d[\d,]*[^.]{0,20}premium")


def p8(call):
    agent = _agent_turns(call)
    otp = [t for t in agent if OTP_ASK.search(t.text) and not OTP_SAFE.search(t.text)]
    if otp:
        return Finding("P8", "NOT_MET", [otp[0].no], otp[0].text, "Agent asked the customer for an OTP/PIN/card detail: conduct escalation", 0.97)
    prem = [t for t in agent if PREMIUM_AMT.search(t.text)]
    link = _first(agent, rx(r"link", r"\botp\b"))
    if not prem and not link:
        return Finding("P8", "NOT_APPLICABLE", reason="No premium or payment discussed", confidence=0.85)
    if prem and not GST.search(prem[0].text):
        t = prem[0]
        return Finding("P8", "NOT_MET", [t.no], t.text, "Premium quoted without saying it includes GST", 0.85)
    t = prem[0] if prem else link
    return Finding("P8", "MET", [t.no], t.text, "Premium stated with GST; payment via secure link", 0.9)


# ---------- P9 ----------
DISMISS = rx(r"you'?re not understanding", r"you don'?t understand", r"listen to me( first)?", r"just listen", r"samajh nahi rah",
             r"pehle meri (baat )?sun", r"meri suniye", r"bas suniye", r"let me finish", r"aap samajh nahi")


def p9(call):
    bad = [t for t in _agent_turns(call) if "[overlap]" in t.text.lower() or DISMISS.search(t.text)]
    if bad:
        t = bad[0]
        why = "Talks over the customer ([overlap])" if "[overlap]" in t.text.lower() else "Dismissive language"
        if "[overlap]" in t.text.lower() and DISMISS.search(t.text):
            why = "Talks over the customer and uses dismissive language"
        return Finding("P9", "NOT_MET", [x.no for x in bad], t.text, why, 0.95)
    return Finding("P9", "MET", reason="No interruptions or dismissive language", confidence=0.85)


# ---------- P10 ----------
SUMMARY = rx(r"summar", r"to recap", r"so (we'?ve|you'?ve) (agreed|chosen)", r"just to confirm", r"\bplan\b[^.]{0,60}premium", r"premium[^.]{0,20}₹")
NEXT = rx(r"email|whatsapp|send|bhej|call (you|karoon|karungi|karunga)|tomorrow|kal|within|ek din|a day|documents?|policy wording|aa jayegi|will (arrive|reach)")
FREELOOK = rx(r"free[- ]?look")
ABRUPT = rx(r"(done|ho gaya)[.!]?\s*bye", r"^\s*(ok(ay)?|theek hai)[^.]{0,15}bye")


def p10(call):
    agent = _agent_turns(call)
    if not agent:
        return Finding("P10", "NOT_MET", reason="No agent turns", confidence=0.5)
    tail = agent[-2:]
    txt = " ".join(t.text for t in tail)
    last = agent[-1]
    if ABRUPT.search(last.text) and not SUMMARY.search(last.text):
        return Finding("P10", "NOT_MET", [last.no], last.text, "Abrupt close with no summary or next step", 0.95)
    if not SUMMARY.search(txt) or not NEXT.search(txt):
        return Finding("P10", "NOT_MET", [last.no], last.text, "Close lacks a summary and/or the next step", 0.75)
    if is_sale(call) and not FREELOOK.search(txt):
        return Finding("P10", "NOT_MET", [last.no], last.text, "Sale closed without mentioning documents and the free-look period", 0.85)
    return Finding("P10", "MET", [last.no], last.text, "Summary and next steps given" + (" including free-look" if is_sale(call) else ""), 0.9)


CHECKS = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10]


def run_rules(call):
    return {f.param: f for f in (c(call) for c in CHECKS)}


def conduct_alert(call):
    for t in _agent_turns(call):
        if OTP_ASK.search(t.text) and not OTP_SAFE.search(t.text):
            return {"turn": t.no, "quote": t.text, "reason": "Agent asked the customer for an OTP/PIN/card detail"}
    return None
