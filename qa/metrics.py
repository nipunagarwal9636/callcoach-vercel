"""Evaluation against the labelled transcripts (Brief section 7)."""
from .scorecard import ORDER, FATAL, call_score


def _flag(r):
    return r in ("NOT_MET", "REVIEW")


def evaluate(pred: dict, labels: dict, meta: dict, ids=None):
    """pred: {tid: {param: result}}; labels: {tid: {param: label_row}}; meta: {tid: meta_row}."""
    ids = ids or sorted(pred)
    per = {}
    agree = tot = 0
    for p in ORDER:
        tp = fp = fn = tn = 0
        for tid in ids:
            yt = labels[tid][p]["result"] == "NOT_MET"
            yp = _flag(pred[tid][p])
            tp += yt and yp; fp += (not yt) and yp; fn += yt and (not yp); tn += (not yt) and (not yp)
            # agreement: exact match of MET / NOT_MET / NOT_APPLICABLE (REVIEW counts as NOT_MET)
            pr = "NOT_MET" if pred[tid][p] == "REVIEW" else pred[tid][p]
            agree += pr == labels[tid][p]["result"]; tot += 1
        prec = tp / (tp + fp) if tp + fp else None
        rec = tp / (tp + fn) if tp + fn else None
        per[p] = dict(tp=tp, fp=fp, fn=fn, tn=tn, precision=prec, recall=rec, support=tp + fn)
    # fatal recall at call level and parameter level
    ftp = sum(per[p]["tp"] for p in FATAL); ffn = sum(per[p]["fn"] for p in FATAL); ffp = sum(per[p]["fp"] for p in FATAL)
    call_fatal_true = [tid for tid in ids if meta[tid]["fatal_error"]]
    call_fatal_hit = [tid for tid in call_fatal_true if any(_flag(pred[tid][p]) for p in FATAL)]
    call_fatal_fp = [tid for tid in ids if not meta[tid]["fatal_error"] and any(_flag(pred[tid][p]) for p in FATAL)]
    all_tp = sum(v["tp"] for v in per.values()); all_fp = sum(v["fp"] for v in per.values())
    errs = [abs(call_score(pred[tid]) - meta[tid]["true_score"]) for tid in ids]
    return dict(
        n_calls=len(ids),
        per_param=per,
        fatal_param_recall=ftp / (ftp + ffn) if ftp + ffn else None,
        fatal_param_precision=ftp / (ftp + ffp) if ftp + ffp else None,
        fatal_call_recall=len(call_fatal_hit) / len(call_fatal_true) if call_fatal_true else None,
        fatal_calls=len(call_fatal_true), fatal_calls_missed=sorted(set(call_fatal_true) - set(call_fatal_hit)),
        fatal_false_alarms=call_fatal_fp,
        flag_precision=all_tp / (all_tp + all_fp) if all_tp + all_fp else None,
        parameter_agreement=agree / tot,
        score_mae=sum(errs) / len(errs),
        exact_score=sum(e == 0 for e in errs) / len(errs),
    )
