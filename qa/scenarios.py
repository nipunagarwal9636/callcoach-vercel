"""The brief's acceptance tests T1-T10, run automatically."""
import json
from pathlib import Path

from .coaching import build_module
from .engine import score_call
from .patterns import findings, load as load_patterns
from .transcript import parse_text

ROOT = Path(__file__).resolve().parent.parent


def _stress():
    return {s["id"]: s for s in json.loads((ROOT / "data/stress_set.json").read_text())}


def run(calls, scored, patterns_data=None, use_llm=False):
    st = _stress()
    out = []

    def add(tid, name, ok, detail):
        out.append(dict(id=tid, scenario=name, passed=bool(ok), detail=detail))

    s = scored["QT-092"]; r = s["results"]["P5"]
    add("T1", "Health call: customer mentions BP, agent says 'sab cover hai'",
        r["result"] == "NOT_MET" and s["score"] == 0 and 14 in r["turns"],
        f"P5 {r['result']} (FATAL), turn {r['turns']}: \"{r['quote'][:60]}\", call score {s['score']}")
    s = scored["QT-041"]; r = s["results"]["P6"]
    add("T2", "Agent says the claim is '100% pass, guarantee'", r["result"] == "NOT_MET" and s["score"] == 0,
        f"P6 {r['result']} (FATAL), turn {r['turns']}: \"{r['quote'][:60]}\"")
    s = scored["QT-033"]; r = s["results"]["P8"]
    add("T3", "Agent asks the customer to read out the OTP", r["result"] == "NOT_MET" and s["conduct_alert"] is not None,
        f"P8 {r['result']} (MAJOR) + conduct alert to a person at turn {(s['conduct_alert'] or {}).get('turn')}")
    s4 = score_call(parse_text(st["S10"]["transcript"]), use_llm=use_llm)
    add("T4", "Motor: 'every garage cashless' and a higher IDV", s4["results"]["P4"]["result"] == "NOT_MET" and s4["results"]["P5"]["result"] == "MET",
        f"P4 {s4['results']['P4']['result']} ({s4['results']['P4']['reason'][:60]}); P5 {s4['results']['P5']['result']}: a wrong feature claim is P4, not a missing disclosure")
    s5 = score_call(parse_text(st["S05"]["transcript"]), use_llm=use_llm)
    add("T5", "'Let me discuss with my wife' + follow-up offered", s5["results"]["P7"]["result"] == "MET",
        f"P7 {s5['results']['P7']['result']}: no false positive on 'discuss'")
    s = scored["QT-045"]; r = s["results"]["P2"]
    add("T6", "No recording disclosure anywhere", r["result"] == "NOT_MET" and s["score"] == 0 and "no recording" in r["quote"].lower(),
        f"P2 {r['result']} (FATAL), evidence: \"{r['quote']}\"")
    s = scored["QT-016"]
    add("T7", "Clean call (coaching theme 'None')", s["score"] == 100 and not s["flags"], f"Score {s['score']}, flags: {s['flags'] or 'none'}")
    agent_calls = {k: calls[k] for k in calls if calls[k].meta.get("agent_id") == "SA-071"}
    mod = build_module("SA-071", agent_calls, {k: scored[k] for k in agent_calls}, param="P5")
    add("T8", "Agent with 3 flagged disclosure calls", mod and len(mod["excerpts"]) == 3 and mod["better"] and mod["practice"] and "Target" in mod["measure"],
        f"Module '{mod['title']}' with {len(mod['excerpts'])} excerpts from their own calls, rule, better version, practice, target" if mod else "no module")
    if patterns_data is None:
        patterns_data = load_patterns(ROOT / "data/calls_and_audits.xlsx")
    f = findings(patterns_data)
    add("T9", "Calls sheet as a whole", "TL-3" in f[0]["title"] and "TL-1" in f[1]["title"] and "rise" in f[2]["title"],
        " | ".join(x["title"] for x in f))
    s = scored["QT-001"]; r = s["results"]["P9"]
    add("T10", "Hinglish/English call where the agent talks over the customer ([overlap])", r["result"] == "NOT_MET" and 9 in r["turns"],
        f"P9 {r['result']}, turn {r['turns']}: \"{r['quote'][:60]}\"")
    return out


def run_stress(use_llm=False):
    rows = []
    for s in _stress().values():
        res = score_call(parse_text(s["transcript"]), use_llm=use_llm)
        for p, exp in s["expected"].items():
            got = res["results"][p]["result"]
            got_n = "NOT_MET" if got == "REVIEW" else got
            rows.append(dict(case=s["id"], about=s["about"], param=p, expected=exp, got=got, correct=got_n == exp,
                             reason=res["results"][p]["reason"]))
    return rows
