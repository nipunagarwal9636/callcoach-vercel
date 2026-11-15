"""Export everything the static web app shows into public/data/*.json.
Run after scripts/evaluate.py (and after `--llm` if you have hybrid results)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from qa.coaching import build_module  # noqa: E402
from qa.patterns import SCALE, auditors, by, findings, load, month_end, sizing, team_view  # noqa: E402
from qa.scorecard import COACHING_THEME, ORDER, PARAMS  # noqa: E402
from qa.transcript import load_labelled  # noqa: E402

OUT = ROOT / "qa/webdata"
OUT.mkdir(parents=True, exist_ok=True)


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, float) and o != o:
        return None
    if hasattr(o, "item"):
        return o.item()
    return o


def dump(name, obj):
    (OUT / name).write_text(json.dumps(clean(obj), ensure_ascii=False, separators=(",", ":"), default=str))
    print("wrote", name, (OUT / name).stat().st_size // 1024, "KB")


calls, labels, meta = load_labelled(ROOT / "data/transcripts_labelled.xlsx")
agents = pd.read_excel(ROOT / "data/calls_and_audits.xlsx", "agents").set_index("agent_id")
modes = [m for m in ("hybrid", "rules") if (ROOT / f"results/{m}_scored.json").exists()]
scored = {m: json.loads((ROOT / f"results/{m}_scored.json").read_text()) for m in modes}
main = modes[0]

# scorecard
dump("scorecard.json", [dict(id=p, **{k: v for k, v in PARAMS[p].items()}, theme=COACHING_THEME[p]) for p in ORDER])

# calls: transcript + meta + labels + scored results per mode
rows = []
for tid in sorted(calls):
    c = calls[tid]; m = c.meta
    a = agents.loc[m["agent_id"]] if m["agent_id"] in agents.index else None
    rows.append(dict(
        id=tid, call_id=m["call_id"], agent_id=m["agent_id"], agent=(a["agent_name"] if a is not None else m["agent_id"]),
        gender=(a["gender"] if a is not None else None), team_lead_id=m["team_lead_id"],
        team_lead=(a["team_lead_name"] if a is not None else m["team_lead_id"]), tenure=m["agent_tenure_months"],
        product=m["product"], language=m["language"], outcome=m["outcome"], complaint=bool(m["complaint_within_30d"]),
        free_look=bool(m["free_look_cancelled"]), true_score=m["true_score"], theme=m["primary_coaching_theme"],
        turns=[dict(n=t.no, s=t.speaker, t=t.text) for t in c.turns],
        labels={p: labels[tid][p]["result"] for p in ORDER},
        scored={mode: scored[mode][tid] for mode in modes},
    ))
_cs = pd.read_excel(ROOT / "data/calls_and_audits.xlsx", "calls").drop_duplicates("call_id").set_index("call_id")
for r in rows:
    if r["call_id"] in _cs.index:
        r["premium"] = int(_cs.loc[r["call_id"], "premium_inr"])
        r["call_start"] = str(_cs.loc[r["call_id"], "call_start"])[:16]
dump("calls.json", dict(modes=modes, calls=rows))

# coaching: per agent and per team, every flagged parameter
coach = dict(agents={}, teams={})
for mode in modes[:1]:
    sc = scored[mode]
    by_agent, by_team = {}, {}
    for tid, c in calls.items():
        by_agent.setdefault(c.meta["agent_id"], []).append(tid)
        by_team.setdefault(c.meta["team_lead_id"], []).append(tid)
    for aid, ids in by_agent.items():
        flagged = sorted({p for t in ids for p in sc[t]["flags"]}, key=ORDER.index)
        if not flagged:
            continue
        name = agents.loc[aid, "agent_name"] if aid in agents.index else aid
        who = f"{name} ({aid})"
        mods = {p: build_module(who, {t: calls[t] for t in ids}, {t: sc[t] for t in ids}, param=p) for p in flagged}
        auto = build_module(who, {t: calls[t] for t in ids}, {t: sc[t] for t in ids})
        coach["agents"][aid] = dict(name=name, team_lead_id=calls[ids[0]].meta["team_lead_id"], calls=len(ids),
                                    fatal=sum(bool(sc[t]["fatal"]) for t in ids), auto=auto["param"], modules=mods)
    for tl, ids in by_team.items():
        shared = {}
        for t in ids:
            for p in sc[t]["flags"]:
                shared.setdefault(p, set()).add(calls[t].meta["agent_id"])
        mods = {p: build_module(f"team {tl}", {t: calls[t] for t in ids}, {t: sc[t] for t in ids}, param=p, scope="team")
                for p, ag in shared.items() if len(ag) >= 2}
        name = agents[agents.team_lead_id == tl].team_lead_name.iloc[0]
        coach["teams"][tl] = dict(name=name, shared={p: len(a) for p, a in shared.items()}, modules=mods)
dump("coaching.json", coach)

# floor patterns
d = load(ROOT / "data/calls_and_audits.xlsx")
s = sizing(d)
t = team_view(d)
me = month_end(d)
patterns = dict(
    sizing=s,
    funnel=[dict(stage="Calls with a fatal error", n=18300), dict(stage="Heard by QA (3%)", n=550),
            dict(stage="Marked fatal by auditors", n=round(s["fatal_audits"] * SCALE)),
            dict(stage="Feedback reached the agent", n=round(s["fatal_with_feedback"] * SCALE)),
            dict(stage="Coaching held", n=round(s["fatal_coached"] * SCALE))],
    findings=findings(d),
    teams=[dict(id=i, **r) for i, r in t.reset_index().set_index("team_lead_id").to_dict("index").items()],
    month_end=dict(rest=me.loc[False].to_dict(), last7=me.loc[True].to_dict()),
    auditors=[dict(id=i, **r) for i, r in auditors(d).to_dict("index").items()],
    tenure=[dict(band=str(i), **r) for i, r in by(d, "tenure_band").to_dict("index").items()],
    product=[dict(product=i, **r) for i, r in by(d, "product").to_dict("index").items()],
    cleaning=dict(duplicates=d["duplicates"], blank_lead=d["blank_lead"]),
)
dump("patterns.json", patterns)

# evaluation
ev = {}
for mode in ("rules", "hybrid"):
    p = ROOT / f"results/{mode}_eval.json"
    if p.exists():
        ev[mode] = dict(eval=json.loads(p.read_text()),
                        scenarios=json.loads((ROOT / f"results/{mode}_scenarios.json").read_text()),
                        stress=json.loads((ROOT / f"results/{mode}_stress.json").read_text()))
dump("evaluation.json", ev)

# demo inputs
dump("stress.json", json.loads((ROOT / "data/stress_set.json").read_text()))

# ---------------- agent performance ----------------
xl = pd.read_excel(ROOT / "data/calls_and_audits.xlsx", None)
aud = xl["qa_audits"].copy()
cl = xl["calls"].drop_duplicates()
cmp_ = xl["complaints"]
ag = xl["agents"]
PCOLS = {"P1": ("P1_opening", 5), "P2": ("P2_recording", None), "P3": ("P3_need", 15), "P4": ("P4_accurate", 15), "P5": ("P5_mandatory", None),
         "P6": ("P6_no", None), "P7": ("P7_no", 15), "P8": ("P8_premium", 15), "P9": ("P9_listening", 20), "P10": ("P10_closing", 15)}


def fails(r):
    out = []
    for p, (c, pts) in PCOLS.items():
        v = r[c]
        if pts is None:
            if str(v).upper() == "FAIL":
                out.append(p)
        elif pd.notna(v) and float(v) < pts:
            out.append(p)
    return out


aud["fails"] = aud.apply(fails, axis=1)
aud["audit_date"] = pd.to_datetime(aud["audit_date"])
aud["feedback_given_on"] = pd.to_datetime(aud["feedback_given_on"])
floor_rate = {p: float(aud["fails"].apply(lambda f: p in f).mean()) for p in PCOLS}
sales = cl[cl.outcome == "SALE"]
lab_by_agent = {}
for r in rows:
    lab_by_agent.setdefault(r["agent_id"], []).append(dict(id=r["id"], score=r["scored"][main]["score"], fatal=r["scored"][main]["fatal"],
                                                          flags=r["scored"][main]["flags"], true_score=r["true_score"]))
agents_out = []
for a in ag.to_dict("records"):
    aid = a["agent_id"]
    A = aud[aud.agent_id == aid].sort_values("audit_date")
    S = sales[sales.agent_id == aid]
    audits = []
    for r in A.to_dict("records"):
        lag = (r["feedback_given_on"] - r["audit_date"]).days if pd.notna(r["feedback_given_on"]) else None
        audits.append(dict(id=r["audit_id"], call=r["call_id"], date=r["audit_date"].strftime("%Y-%m-%d"), score=int(r["total_score"]),
                           fatal=bool(r["fatal_error"]), fails=r["fails"], comment=str(r["auditor_comment"]) if pd.notna(r["auditor_comment"]) else "",
                           feedback_days=lag, coached=bool(r["coaching_session_held"]), auditor=r["auditor_id"]))
    mistakes = {}
    for r in audits:
        for c in [x.strip() for x in r["comment"].split(";") if x.strip() and x.strip().lower() not in ("nan", "")]:
            mistakes[c] = mistakes.get(c, 0) + 1
    rate = {p: (sum(p in r["fails"] for r in audits) / len(audits)) if audits else None for p in PCOLS}
    first_coach = next((i for i, r in enumerate(audits) if r["coached"]), None)
    ba = None
    if first_coach is not None and 0 < first_coach + 1 < len(audits):
        before = [r["score"] for r in audits[: first_coach + 1]]
        after = [r["score"] for r in audits[first_coach + 1:]]
        ba = dict(before=sum(before) / len(before), after=sum(after) / len(after), n_before=len(before), n_after=len(after),
                  coached_on=audits[first_coach]["date"])
    C = cmp_[cmp_.agent_id == aid]
    agents_out.append(dict(
        id=aid, name=a["agent_name"], team_lead_id=a["team_lead_id"], team_lead=a["team_lead_name"], tenure=int(a["tenure_months"]),
        prior=a["prior_experience"], languages=a["languages"], certified=bool(a["irdai_certified"]), target=int(a["monthly_premium_target_inr"]),
        calls=int(a["sample_calls"]), sales=int(a["sample_sales"]), premium=int(a["sample_premium_inr"]),
        free_look=int(S["free_look_cancelled"].sum()), complaints=int(len(C)),
        complaint_cats={k: int(v) for k, v in C["category"].value_counts().items()},
        avg_qa=(None if pd.isna(a["avg_qa_score"]) else float(a["avg_qa_score"])), audits=audits, fail_rate=rate,
        mistakes=sorted(mistakes.items(), key=lambda x: -x[1])[:5], before_after=ba, labelled=lab_by_agent.get(aid, []),
        coach_modules=list(coach["agents"].get(aid, {}).get("modules", {}).keys()),
    ))
dump("agents.json", dict(floor_rate=floor_rate, floor_avg=float(aud["total_score"].mean()), n_audits=int(len(aud)), agents=agents_out))

# ---------------- policy library seed ----------------
from qa.policy import seed_docs, facts, chunks  # noqa: E402
dump("policies.json", [dict(id=d["id"], name=d["name"], text=d["text"], source="sample", facts=facts(d), clauses=len(chunks(d))) for d in seed_docs()])

# ---------------- call log (every sampled call, with its human audit if any) ----------------
_a = aud.set_index("call_id")
log = []
for r in cl.sort_values("call_start").to_dict("records"):
    row = dict(id=r["call_id"], at=str(r["call_start"])[:16], a=r["agent_id"], tl=r["team_lead_id"], p=r["product"], src=r["lead_source"],
               lang=r["customer_language"], age=r["customer_age_band"], sec=int(r["talk_seconds"]), out=r["outcome"], prem=int(r["premium_inr"]),
               cmp=bool(r["complaint_within_30d"]), fl=bool(r["free_look_cancelled"]))
    if r["call_id"] in _a.index:
        x = _a.loc[r["call_id"]]
        x = x.iloc[0] if hasattr(x, "iloc") and getattr(x, "ndim", 1) > 1 else x
        row["qa"] = dict(score=int(x["total_score"]), fatal=bool(x["fatal_error"]), fails=x["fails"], by=x["auditor_id"],
                         note=str(x["auditor_comment"]) if pd.notna(x["auditor_comment"]) else "")
    log.append(row)
dump("calllog.json", log)
