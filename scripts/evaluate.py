"""Score all 110 labelled calls, compute the brief's metrics, run T1-T10 and the stress set.

Usage:
  python scripts/evaluate.py            # rule layer only (no API key needed)
  python scripts/evaluate.py --llm      # hybrid: rules + LLM judge (needs LLM_PROVIDER / LLM_API_KEY)
Writes results/<mode>_*.json, which the app reads.
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from qa import llm  # noqa: E402
from qa.engine import score_call  # noqa: E402
from qa.metrics import evaluate  # noqa: E402
from qa.scenarios import run, run_stress  # noqa: E402
from qa.transcript import load_labelled  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--sleep", type=float, default=0.0, help="seconds between LLM calls (free-tier rate limits)")
    args = ap.parse_args()
    if args.llm and not llm.available():
        sys.exit("Set LLM_PROVIDER and LLM_API_KEY first (see README).")
    mode = "hybrid" if args.llm else "rules"
    calls, labels, meta_df = load_labelled(ROOT / "data/transcripts_labelled.xlsx")
    ids = sorted(calls)[: args.limit] if args.limit else sorted(calls)
    out_dir = ROOT / "results"; out_dir.mkdir(exist_ok=True)
    cache_path = out_dir / f"{mode}_scored.json"
    scored = json.loads(cache_path.read_text()) if cache_path.exists() and args.llm else {}
    t0 = time.time()
    for i, tid in enumerate(ids, 1):
        if tid in scored and not scored[tid].get("llm_error"):
            continue
        scored[tid] = score_call(calls[tid], use_llm=args.llm)
        if args.llm:
            cache_path.write_text(json.dumps(scored))
            print(f"[{i}/{len(ids)}] {tid} score={scored[tid]['score']} {scored[tid].get('llm_error') or ''}", flush=True)
            time.sleep(args.sleep)
    cache_path.write_text(json.dumps(scored, indent=1))
    pred = {tid: {p: v["result"] for p, v in scored[tid]["results"].items()} for tid in ids}
    meta = {tid: calls[tid].meta for tid in ids}
    agents = pd.read_excel(ROOT / "data/calls_and_audits.xlsx", "agents")[["agent_id", "gender"]]
    g = dict(zip(agents.agent_id, agents.gender))
    report = dict(mode=mode, model=(llm.config() or {}).get("model") if args.llm else None, overall=evaluate(pred, labels, meta, ids))
    report["by_language"] = {lang: evaluate(pred, labels, meta, [t for t in ids if meta[t]["language"] == lang]) for lang in sorted({meta[t]["language"] for t in ids})}
    report["by_agent_gender"] = {gd: evaluate(pred, labels, meta, [t for t in ids if g.get(meta[t]["agent_id"]) == gd]) for gd in ("F", "M")}
    report["review_rate"] = sum(bool(scored[t]["review"]) for t in ids) / len(ids)
    report["seconds_per_call"] = (time.time() - t0) / max(1, len(ids))
    tok = [scored[t].get("usage") or {} for t in ids]
    report["avg_tokens"] = dict(prompt=sum(x.get("prompt", 0) for x in tok) / len(ids), completion=sum(x.get("completion", 0) for x in tok) / len(ids))
    (out_dir / f"{mode}_eval.json").write_text(json.dumps(report, indent=1, default=str))
    sc = run(calls, scored, use_llm=args.llm) if not args.limit else []
    (out_dir / f"{mode}_scenarios.json").write_text(json.dumps(sc, indent=1))
    stress = run_stress(use_llm=args.llm)
    (out_dir / f"{mode}_stress.json").write_text(json.dumps(stress, indent=1))
    o = report["overall"]
    print(f"\n{mode.upper()} on {o['n_calls']} calls: fatal call recall {o['fatal_call_recall']:.1%}, flag precision {o['flag_precision']:.1%}, "
          f"parameter agreement {o['parameter_agreement']:.1%}, score MAE {o['score_mae']:.2f}")
    print(f"Scenarios passed: {sum(x['passed'] for x in sc)}/{len(sc)}; stress set correct: {sum(x['correct'] for x in stress)}/{len(stress)}")


if __name__ == "__main__":
    main()
