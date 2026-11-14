"""Policy-grounded checks: compare what the agent said with the plan's policy wording.

Works offline with regex fact extraction (for wordings that state limits plainly, like the seeded samples), and
optionally asks the LLM to judge any other product statement against the retrieved clauses (any uploaded PDF).
"""
import re
from pathlib import Path

from . import llm

I = re.I
SEED_DIR = Path(__file__).with_name("policies")
WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ek": 1, "do": 2, "teen": 3, "char": 4, "paanch": 5}


def _num(s):
    s = str(s).lower().replace(",", "")
    return float(WORDNUM[s]) if s in WORDNUM else float(s)


# ---------------- documents ----------------
def seed_docs():
    out = []
    for p in sorted(SEED_DIR.glob("*.md")):
        txt = p.read_text(encoding="utf-8")
        out.append(dict(id=p.stem, name=txt.splitlines()[0].lstrip("# ").split(":")[0].strip(), text=txt, source="sample"))
    return out


def plan_name(doc):
    if doc.get("name"):
        return doc["name"]
    m = re.search(r"Insurer\s+\w+\s*[·:-]\s*[^\n:]{3,60}", doc["text"])
    return m.group(0).strip() if m else doc.get("id", "policy")


def chunks(doc):
    """Split into clauses: markdown headings, numbered headings ('3.2 Title'), else ~600-char paragraphs."""
    text = doc["text"]
    parts = re.split(r"\n(?=#{1,4}\s|\d+(?:\.\d+)+\s+[A-Z])", text)
    out = []
    if len(parts) > 2:
        for p in parts[1:]:
            head, _, body = p.strip().partition("\n")
            head = head.lstrip("# ").strip()
            m = re.match(r"(\d+(?:\.\d+)*)\s+(.*)", head)
            cid, title = (m.group(1), m.group(2)) if m else (str(len(out) + 1), head)
            out.append(dict(id=cid, title=title, text=(body.strip() or head)))
    else:
        buf, n = "", 0
        for para in re.split(r"\n\s*\n", text):
            buf += para.strip() + " "
            if len(buf) > 600:
                n += 1
                out.append(dict(id=f"p{n}", title=f"Passage {n}", text=buf.strip()))
                buf = ""
        if buf.strip():
            out.append(dict(id=f"p{n + 1}", title=f"Passage {n + 1}", text=buf.strip()))
    return out


def domain_of(doc):
    t = doc["text"].lower()
    return "MOTOR" if re.search(r"\b(idv|motor|car|garage|own-damage)\b", t) and not re.search(r"hospital", t) else "HEALTH"


# ---------------- facts from the wording ----------------
F = {
    "initial_wait_days": r"initial waiting period[^.\d]{0,40}(\d+)\s*days",
    "specific_wait_months": r"specific (?:illness|disease)[^.]{0,80}?(\d+)\s*months",
    "ped_wait_months": r"pre-?existing[^.]{0,160}?(\d+)\s*months",
    "room_rent_pct": r"room rent[^.]{0,60}?(\d+(?:\.\d+)?)\s*%",
    "copay_pct": r"co-?payment[^.\d]{0,60}?(\d+)\s*%",
    "deductible_inr": r"compulsory deductible[^.]{0,40}?(?:₹|rs\.?|inr)\s?([\d,]+)",
    "zero_dep_claims": r"zero depreciation[^.]{0,80}?(\d+|one|two|three)\s+claims",
}


def facts(doc):
    t = doc["text"]
    f = {}
    for k, pat in F.items():
        m = re.search(pat, t, I)
        if m:
            f[k] = _num(m.group(1))
    if re.search(r"cashless[^.]{0,80}only[^.]{0,30}network|only at (the )?(insurer'?s )?network", t, I):
        f["cashless_network_only"] = True
    if re.search(r"no return of premium|no (maturity|survival) benefit|no payout for a claim-free", t, I):
        f["no_return_of_premium"] = True
    if re.search(r"(no intermediary can guarantee|decided by the insurer|subject to the (policy )?terms)", t, I):
        f["claims_not_guaranteed"] = True
    if re.search(r"(no-claim bonus|ncb)[^.]{0,160}(proof|evidence)", t, I):
        f["ncb_needs_proof"] = True
    if re.search(r"(water|hydrostatic)[^.]{0,80}not covered|engine[^.]{0,80}not covered", t, I):
        f["engine_water_excluded"] = True
    return f


def clause_for(doc, *keys):
    best, score = None, 0
    for c in chunks(doc):
        s = sum(1 for k in keys if re.search(k, c["title"] + " " + c["text"], I))
        if s > score:
            best, score = c, s
    return best


# ---------------- what the agent said ----------------
HEALTH_WORDS = r"(sugar|diabet\w*|bp|blood pressure|hypertension|thyroid|asthma|heart|cholesterol|kidney)"
CLAIM_KEYS = r"(cover|cashless|waiting|claim|premium|idv|sum insured|lakh|co-?pay|deductible|zero dep|ncb|no[- ]claim|room rent|refund|wapas|back|guarantee|day one|pehle din|network|garage|hospital)"


def _clauses(text):
    return [c.strip() for c in re.split(r"[.;!?]|,\s|\baur\b|\band\b", text) if c.strip()]


def _cmp(said, actual, unit):
    return ("SUPPORTED" if abs(said - actual) < 1e-6 else "CONTRADICTED"), f"{actual:g} {unit}"


def check_statement(turn_no, text, f, doc, prev_customer=""):
    """Return findings for one agent turn against the policy facts."""
    out = []

    def add(topic, verdict, policy, param, keys):
        c = clause_for(doc, *keys)
        out.append(dict(kind="claim", topic=topic, verdict=verdict, turn=turn_no, said=text, policy=policy, param=param,
                        clause=c, source="rules"))

    low = text.lower()
    # cashless scope
    if re.search(r"\b(all|every|saare|sabhi|har)\b[^.]{0,30}\b(hospitals?|garages?)\b[^.]{0,50}cashless|cashless[^.]{0,30}\b(all|every|saare|har)\b[^.]{0,20}(hospital|garage)", low):
        if f.get("cashless_network_only"):
            add("Cashless scope", "CONTRADICTED", "Cashless only at network hospitals/garages", "P4", ["cashless", "network"])
    elif re.search(r"network[^.]{0,40}cashless|cashless[^.]{0,40}network", low) and f.get("cashless_network_only"):
        add("Cashless scope", "SUPPORTED", "Cashless only at network hospitals/garages", "P4", ["cashless", "network"])
    # waiting periods, clause by clause
    for cl in _clauses(text):
        c = cl.lower()
        m = re.search(r"(\d+|one|two|three|ek|do|teen)\s*(din|days?|saal|years?|months?|mahine)", c)
        if re.search(r"(koi|no)\s+waiting|waiting (period )?nahi|without (any )?waiting|from day one|pehle din se|day 1 se", c):
            if f.get("ped_wait_months") or f.get("initial_wait_days"):
                add("Waiting period", "CONTRADICTED", f"Pre-existing diseases wait {f.get('ped_wait_months', 0):g} months; initial wait {f.get('initial_wait_days', 0):g} days",
                    "P6" if re.search(r"day one|pehle din", c) else "P5", ["pre-existing", "waiting"])
            continue
        if not m:
            continue
        n, unit = _num(m.group(1)), m.group(2)
        months = n * 12 if unit.startswith(("saal", "year")) else n / 30 if unit.startswith(("din", "day")) else n
        if re.search(r"initial|30 ?(din|day)", c) and unit.startswith(("din", "day")) and "initial_wait_days" in f:
            v, pol = _cmp(n, f["initial_wait_days"], "days")
            add("Initial waiting period", v, pol, "P5", ["initial waiting"])
        elif re.search(r"specific|cataract|hernia", c) and "specific_wait_months" in f:
            v, pol = _cmp(months, f["specific_wait_months"], "months")
            add("Specific-illness waiting", v, pol, "P5", ["specific"])
        elif (re.search(r"pre-?existing|pehle se maujood|ped\b", c) or (re.search(HEALTH_WORDS, c) and re.search(r"wait|cover|baad", c))) and "ped_wait_months" in f:
            v, pol = _cmp(months, f["ped_wait_months"], "months")
            add("Pre-existing disease waiting", v, pol, "P5", ["pre-existing"])
    # 'it's covered' straight after an illness question
    if re.search(r"(sab|everything|it'?s all|all)\s+(is\s+)?cover|sab cover|tension mat|don'?t worry[^.]{0,30}cover|cover ho jayega|covered hai", low) \
            and re.search(HEALTH_WORDS + r"|\[health condition\]", prev_customer.lower()) and f.get("ped_wait_months"):
        add("Existing illness covered?", "CONTRADICTED", f"Pre-existing diseases wait {f['ped_wait_months']:g} months", "P5", ["pre-existing"])
    # limits waved away when the customer asks about conditions
    if re.search(r"kuch nahi.{0,40}simple|nothing to worry|no conditions|koi condition nahi|koi (shart|terms) nahi|nothing (much )?to (know|worry)", low) \
            and re.search(r"condition|terms|shart|kuch (aur|bhi)|anything (else )?i should know|catch|dhyan|claim", prev_customer.lower()):
        lim = [_fact_text(k, f[k]) for k in ("deductible_inr", "zero_dep_claims", "ped_wait_months", "copay_pct", "room_rent_pct") if f.get(k)]
        add("Conditions waved away", "CONTRADICTED", "Policy has limits: " + "; ".join(lim[:3]), "P5", ["deductible", "waiting", "co-pay", "terms"])
    # co-pay, room rent
    m = re.search(r"(\d+)\s*%\s*co-?pay", low) or re.search(r"co-?pay\w*[^.]{0,20}?(\d+)\s*%", low)
    if m and "copay_pct" in f:
        v, pol = _cmp(_num(m.group(1)), f["copay_pct"], "% co-payment")
        add("Co-payment", v, pol, "P5", ["co-pay"])
    elif re.search(r"(no|koi|zero)\s+co-?pay|co-?pay (nahi|nahin)", low) and f.get("copay_pct", 0) > 0:
        add("Co-payment", "CONTRADICTED", f"{f['copay_pct']:g}% co-payment", "P5", ["co-pay"])
    m = re.search(r"room rent[^.]{0,40}?(\d+(?:\.\d+)?)\s*%", low)
    if m and "room_rent_pct" in f:
        v, pol = _cmp(_num(m.group(1)), f["room_rent_pct"], "% of sum insured per day")
        add("Room rent limit", v, pol, "P5", ["room rent"])
    elif re.search(r"no room rent (limit|capping)|room rent (ki )?koi limit nahi|any room", low) and "room_rent_pct" in f:
        add("Room rent limit", "CONTRADICTED", f"{f['room_rent_pct']:g}% of sum insured per day", "P5", ["room rent"])
    # motor
    m = re.search(r"deductible[^.]{0,30}?(?:₹|rs\.?)\s?([\d,]+)|(?:₹|rs\.?)\s?([\d,]+)[^.]{0,30}deductible", low)
    if m and "deductible_inr" in f:
        v, pol = _cmp(_num(m.group(1) or m.group(2)), f["deductible_inr"], "rupees per claim")
        add("Compulsory deductible", v, pol, "P5", ["deductible"])
    elif re.search(r"no deductible|deductible (nahi|nahin)|koi deductible", low) and "deductible_inr" in f:
        add("Compulsory deductible", "CONTRADICTED", f"₹{f['deductible_inr']:,.0f} per claim", "P5", ["deductible"])
    m = re.search(r"zero dep\w*[^.]{0,40}?(\d+|one|two|three|do|teen)\s+claims?", low)
    if m and "zero_dep_claims" in f:
        v, pol = _cmp(_num(m.group(1)), f["zero_dep_claims"], "claims a year")
        add("Zero-dep claim limit", v, pol, "P5", ["zero depreciation"])
    elif re.search(r"unlimited (zero dep|claims)|zero dep\w*[^.]{0,30}(unlimited|any number)", low) and "zero_dep_claims" in f:
        add("Zero-dep claim limit", "CONTRADICTED", f"{f['zero_dep_claims']:g} claims a year", "P5", ["zero depreciation"])
    if re.search(r"ncb|no[- ]claim bonus", low) and f.get("ncb_needs_proof"):
        ok = re.search(r"proof|document|praman", low)
        add("NCB transfer", "SUPPORTED" if ok else "CONTRADICTED", "NCB transfers only with proof from the previous policy", "P5", ["no-claim", "ncb"])
    # promises
    if re.search(r"(premium|paisa|money|paise)\s*(back|wapas|return)|get (your|the) (premium|money) back|wapas mil", low) and f.get("no_return_of_premium"):
        add("Return of premium", "CONTRADICTED", "No return of premium or claim-free payout", "P6", ["return of premium"])
    if re.search(r"100\s?%\s*(approved|pass|claim|sure)|guarantee|pakka (pass|approve)|definitely (be )?(approved|settled|paid)|never (be )?rejected", low) \
            and not re.search(r"(no|can'?t|cannot|not|nahi)\s+(a\s+)?guarantee|guarantee nahi", low) and f.get("claims_not_guaranteed"):
        add("Claim approval", "CONTRADICTED", "Claims are decided by the insurer; no one can guarantee approval", "P6", ["claims", "guarantee"])
    return out


REQUIRED = {
    "HEALTH": [("initial_wait_days", "Initial waiting period", r"initial waiting|30[- ]?(din|day)", ["initial waiting"]),
               ("specific_wait_months", "Specific-illness waiting", r"specific|cataract|hernia", ["specific"]),
               ("ped_wait_months", "Pre-existing disease waiting", r"pre-?existing|pehle se maujood", ["pre-existing"]),
               ("room_rent_pct", "Room rent limit", r"room rent", ["room rent"]),
               ("copay_pct", "Co-payment", r"co-?pay", ["co-pay"])],
    "MOTOR": [("deductible_inr", "Compulsory deductible", r"deductible", ["deductible"]),
              ("zero_dep_claims", "Zero-dep claim limit", r"zero dep\w*[^.]{0,40}(claim|limit)", ["zero depreciation"]),
              ("engine_water_excluded", "Engine / water damage exclusion", r"engine|paani|water", ["engine"]),
              ("ncb_needs_proof", "NCB transfer needs proof", r"ncb|no[- ]claim bonus", ["no-claim", "ncb"])],
}
PAY = r"premium\b[^.]{0,30}(₹|\brs\.?|\brupees)\s?\d|payment link|secure link|link (bhej|send)|\botp\b"


def pick_doc(turns, docs):
    txt = " ".join(t["t"] if isinstance(t, dict) else t.text for t in turns).lower()
    best, score = None, 0
    for d in docs:
        name = plan_name(d).lower()
        words = [w for w in re.findall(r"[a-z]{3,}", name) if w not in ("insurer", "policy", "wording", "summary", "with", "the")]
        s = sum(1 for w in words if w in txt) + (3 if name.split(":")[0] in txt else 0)
        if s > score:
            best, score = d, s
    return best if score >= 2 else None


def verify(turns, docs, doc_id=None, use_llm=False):
    """turns: list of {n, s, t}. Returns the matched plan, findings and the clause list used."""
    docs = docs or seed_docs()
    doc = next((d for d in docs if d.get("id") == doc_id), None) if doc_id else pick_doc(turns, docs)
    if not doc:
        return dict(plan=None, findings=[], note="No policy in the library matches the plan named on this call. Pick one manually or upload its wording.")
    f = facts(doc)
    dom = domain_of(doc)
    findings = []
    prev_c = ""
    agent_turns = []
    for t in turns:
        if t["s"] == "CUSTOMER":
            prev_c = t["t"]
            continue
        agent_turns.append(t)
        findings += check_statement(t["n"], t["t"], f, doc, prev_c)
    # dedupe (same topic+turn)
    seen, uniq = set(), []
    for x in findings:
        k = (x["topic"], x["turn"])
        if k not in seen:
            seen.add(k); uniq.append(x)
    findings = uniq
    # omissions before payment
    pay = next((t for t in agent_turns if re.search(PAY, t["t"], I)), None)
    pitched = any(re.search(r"suggest|recommend|plan", t["t"], I) for t in agent_turns)
    before = " ".join(t["t"] for t in agent_turns if not pay or t["n"] < pay["n"])
    for key, label, pat, keys in REQUIRED[dom]:
        if key not in f or (key == "copay_pct" and not f[key]):
            continue
        if any(x["topic"] == label for x in findings):
            continue
        if re.search(pat, before, I):
            continue
        if pay or pitched:
            c = clause_for(doc, *keys)
            findings.append(dict(kind="omission", topic=label, verdict="MISSING" if pay else "PENDING", turn=pay["n"] if pay else None,
                                 said="(never said before payment)" if pay else "(not said yet; no payment reached, so not a failure)", policy=_fact_text(key, f[key]),
                                 param="P5", clause=c, source="rules"))
    if use_llm and llm.available():
        try:
            findings += _llm_verify(agent_turns, doc, findings)
        except Exception as e:  # keep the rule results
            findings.append(dict(kind="note", topic="AI check", verdict="ERROR", turn=None, said=str(e)[:160], policy="", param="", clause=None, source="llm"))
    order = {"CONTRADICTED": 0, "MISSING": 1, "PENDING": 2, "UNVERIFIED": 3, "SUPPORTED": 4, "ERROR": 5}
    findings.sort(key=lambda x: (order.get(x["verdict"], 5), x["turn"] or 999))
    return dict(plan=dict(id=doc.get("id"), name=plan_name(doc), domain=dom, facts=f, source=doc.get("source", "upload")),
                findings=findings, clauses=chunks(doc))


def _fact_text(k, v):
    return {"initial_wait_days": f"{v:g} days", "specific_wait_months": f"{v:g} months", "ped_wait_months": f"{v:g} months",
            "room_rent_pct": f"{v:g}% of sum insured per day", "copay_pct": f"{v:g}% of every claim", "deductible_inr": f"₹{v:,.0f} per claim",
            "zero_dep_claims": f"{v:g} claims a year", "engine_water_excluded": "Not covered without engine protect add-on",
            "ncb_needs_proof": "Only with proof from the previous policy"}.get(k, str(v))


VERIFY_SYSTEM = """You check what an insurance sales agent said against the plan's policy wording.
For each numbered agent statement that makes a factual claim about the product (cover, limits, waiting periods, cashless, claims, refunds, IDV, add-ons),
decide using ONLY the clauses given: SUPPORTED (a clause says the same), CONTRADICTED (a clause says otherwise), or UNVERIFIED (no clause covers it).
Skip greetings, questions and process talk. Cite the clause id and quote the clause words.
Return ONLY JSON: {"checks": [{"turn": int, "topic": "short", "verdict": "SUPPORTED|CONTRADICTED|UNVERIFIED", "clause_id": "id or null", "clause_quote": "words", "reason": "one sentence"}]}"""


def _llm_verify(agent_turns, doc, existing):
    done = {x["turn"] for x in existing if x["kind"] == "claim"}
    stmts = [t for t in agent_turns if t["n"] not in done and re.search(CLAIM_KEYS, t["t"], I)][:12]
    if not stmts:
        return []
    cl = chunks(doc)
    by_id = {c["id"]: c for c in cl}
    clause_txt = "\n".join(f"[{c['id']}] {c['title']}: {c['text']}" for c in cl)[:9000]
    user = f"Plan: {plan_name(doc)}\n\nPolicy clauses:\n{clause_txt}\n\nAgent statements:\n" + "\n".join(f"[turn {t['n']}] {t['t']}" for t in stmts)
    out = llm.chat_json(VERIFY_SYSTEM, user, max_tokens=1500)
    res = []
    for c in out.get("checks", []):
        v = str(c.get("verdict", "")).upper()
        if v not in ("SUPPORTED", "CONTRADICTED", "UNVERIFIED"):
            continue
        t = next((s for s in stmts if s["n"] == c.get("turn")), None)
        if not t:
            continue
        clause = by_id.get(str(c.get("clause_id"))) or (dict(id=c.get("clause_id"), title="", text=c.get("clause_quote", "")) if c.get("clause_quote") else None)
        res.append(dict(kind="claim", topic=c.get("topic", "Product claim"), verdict=v, turn=t["n"], said=t["t"], policy=c.get("reason", ""),
                        param="P4" if v == "CONTRADICTED" else "", clause=clause, source="llm"))
    return res
