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

OUT = ROOT / "public/data"
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
