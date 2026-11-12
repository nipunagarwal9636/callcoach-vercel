"""Hybrid scoring engine: rule layer -> (optional) LLM judge -> merge -> score -> routing."""
import time

from . import llm
from .privacy import mask_call
from .rules import Finding, conduct_alert, is_sale, run_rules
from .scorecard import FATAL, ORDER, PARAMS, SEVERITY_RANK, call_score

REVIEW_CONF = 0.6


def _merge(p, r: Finding, l: dict | None):
    """Combine the rule finding and the LLM verdict for one parameter."""
    if l is None:
        return r, None
    lf = Finding(p, l["result"], l["turns"], l["quote"], l["reason"], l["confidence"], "llm")
    if lf.result == "NOT_MET" and not lf.turns and not lf.quote:
        lf = Finding(p, "MET", reason="LLM gave no evidence; no evidence means no failure", confidence=0.5, source="llm")
    r_flag = r.result in ("NOT_MET", "REVIEW")
    l_flag = lf.result == "NOT_MET"
    if p in FATAL:
        if r_flag and l_flag:
            best = lf if lf.turns else r
            return Finding(p, "NOT_MET", best.turns, best.quote, lf.reason or r.reason, max(r.confidence, lf.confidence), "rules+llm"), None
        if l_flag and not r_flag:
            if lf.confidence >= 0.7:
                return Finding(p, "NOT_MET", lf.turns, lf.quote, lf.reason, lf.confidence, "llm"), "LLM found a fatal failure the rules missed"
            return Finding(p, "REVIEW", lf.turns, lf.quote, "Possible fatal failure, low confidence: " + lf.reason, lf.confidence, "llm"), "low-confidence fatal flag"
        if r_flag and not l_flag:
            if r.result == "REVIEW" and lf.confidence >= 0.8:
                return Finding(p, lf.result, lf.turns, lf.quote, "Context check cleared the rule hit: " + lf.reason, lf.confidence, "llm"), None
            return Finding(p, "REVIEW", r.turns, r.quote, f"Rules flagged ({r.reason}); LLM disagreed ({lf.reason}). Human review.", 0.5, "rules+llm"), "rules and LLM disagree on a fatal parameter"
        if lf.confidence < REVIEW_CONF:
            return Finding(p, "REVIEW", lf.turns, lf.quote, "LLM unsure on a fatal parameter: " + lf.reason, lf.confidence, "llm"), "low-confidence pass on a fatal parameter"
        return Finding(p, "MET", r.turns or lf.turns, r.quote or lf.quote, lf.reason or r.reason, min(1.0, (r.confidence + lf.confidence) / 2), "rules+llm"), None
    # non-fatal: agree -> keep; disagree -> explicit high-confidence rule hits win, otherwise the LLM's context wins
    if (r.result == lf.result) or (r_flag and l_flag):
        best = lf if (l_flag and lf.turns) else r
        res = "NOT_MET" if r_flag or l_flag else r.result
        return Finding(p, res, best.turns, best.quote, best.reason, max(r.confidence, lf.confidence), "rules+llm"), None
    if r.confidence >= 0.95 and r_flag:
        return r, f"LLM disagreed ({lf.result}); explicit rule hit kept"
    return lf, f"rules said {r.result}; LLM context used"


def score_call(call, use_llm=None):
    """Returns a JSON-able dict with per-parameter results, score and routing."""
    t0 = time.time()
    rules = run_rules(call)
    use_llm = llm.available() if use_llm is None else (use_llm and llm.available())
    verdict, notes, usage, err = {}, {}, {}, None
    if use_llm:
        try:
            out = llm.judge(mask_call(call), rules)
            verdict = out.get("params", {})
            usage = out.get("_usage", {})
            summary = out.get("summary", "")
            cflags = out.get("customer_flags", [])
        except Exception as e:  # fall back to rules, never block scoring
            err = str(e)[:200]
            use_llm = False
    final = {}
    for p in ORDER:
        f, note = _merge(p, rules[p], verdict.get(p) if use_llm else None)
        final[p] = f
        if note:
            notes[p] = note
    results = {p: f.result for p, f in final.items()}
    score = call_score(results)
    flags = [p for p in ORDER if results[p] in ("NOT_MET", "REVIEW")]
    fatal = [p for p in FATAL if results[p] == "NOT_MET"]
    review = [p for p in ORDER if results[p] == "REVIEW"]
    alert = conduct_alert(call)
    sale = is_sale(call) or str(call.meta.get("outcome", "")).upper() == "SALE"
    top = max(flags, key=lambda p: (SEVERITY_RANK[PARAMS[p]["severity"]], -ORDER.index(p))) if flags else None
    sev = "FATAL" if fatal else ("REVIEW" if review else (PARAMS[top]["severity"] if top else "NONE"))
    priority = (100 if fatal and sale else 90 if fatal else 85 if alert else 70 if review else
                40 if sev == "MAJOR" else 10 if sev == "MINOR" else 0)
    return dict(
        mode="hybrid" if use_llm else "rules",
        results={p: dict(result=f.result, severity=PARAMS[p]["severity"] if f.result in ("NOT_MET", "REVIEW") else "NONE",
                         turns=f.turns, quote=f.quote, reason=f.reason, confidence=round(f.confidence, 2), source=f.source)
                 for p, f in final.items()},
        score=score, fatal=fatal, review=review, flags=flags, severity=sev, priority=priority,
        conduct_alert=alert, sale=sale, callback_needed=bool(fatal and sale), top_issue=top,
        disagreements=notes, llm_error=err, usage=usage, seconds=round(time.time() - t0, 2),
        summary=(summary if use_llm else ""), customer_flags=(cflags if use_llm else []),
    )
