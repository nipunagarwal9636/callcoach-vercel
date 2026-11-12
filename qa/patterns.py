"""Floor-wide patterns from PS-04_calls_and_audits.xlsx (1-in-25 sample of Jul-Sep 2026)."""
import pandas as pd

SCALE = 25 / 3  # sample count -> calls per month on the full floor


def load(path):
    x = pd.ExcelFile(path)
    calls = pd.read_excel(x, "calls")
    dups = int(calls.duplicated().sum())
    calls = calls.drop_duplicates().copy()
    calls["call_start"] = pd.to_datetime(calls["call_start"])
    audits = pd.read_excel(x, "qa_audits")
    agents = pd.read_excel(x, "agents")
    complaints = pd.read_excel(x, "complaints")
    a = audits.merge(calls[["call_id", "call_start", "team_lead_id", "product", "customer_language"]], on="call_id", how="left") \
              .merge(agents[["agent_id", "tenure_months", "gender", "irdai_certified", "team_lead_name"]], on="agent_id", how="left")
    a["P5_fail"] = a["P5_mandatory"].eq("FAIL")
    a["P6_fail"] = a["P6_no"].eq("FAIL")
    a["P2_fail"] = a["P2_recording"].eq("FAIL")
    a["P7_fail"] = a["P7_no"] < 15
    a["P8_fail"] = a["P8_premium"] < 15
    a["dom"] = a["call_start"].dt.day
    a["month_end"] = a["call_start"].dt.days_in_month - a["dom"] < 7
    a["tenure_band"] = pd.cut(a["tenure_months"], [-1, 6, 12, 24, 999], labels=["0-6 m", "7-12 m", "13-24 m", "25+ m"])
    calls["month_end"] = calls["call_start"].dt.days_in_month - calls["call_start"].dt.day < 7
    return dict(calls=calls, audits=a, agents=agents, complaints=complaints, duplicates=dups,
                blank_lead=int(calls["lead_source"].isna().sum()))


def sizing(d):
    c, a, cm = d["calls"], d["audits"], d["complaints"]
    sales = c[c.outcome == "SALE"]
    fl = sales[sales.free_look_cancelled]
    audited = set(a.call_id)
    comp_calls = c[c.complaint_within_30d]
    fa = a[a.fatal_error]
    return {
        "calls_per_month": round(len(c) * SCALE),
        "sales_per_month": round(len(sales) * SCALE),
        "audit_share": len(audited & set(c.call_id)) / len(c),
        "complaints_per_1000_sales": 1000 * sales.complaint_within_30d.sum() / len(sales),
        "free_look_rate": sales.free_look_cancelled.mean(),
        "refund_per_quarter_cr": fl.premium_inr.sum() * 25 / 1e7,
        "complaint_calls": len(comp_calls), "complaint_calls_audited": int(comp_calls.call_id.isin(audited).sum()),
        "free_look_calls": len(fl), "free_look_audited": int(fl.call_id.isin(audited).sum()),
        "recording_fail": 1 - c.recording_available.mean(),
        "fatal_audits": len(fa), "fatal_with_feedback": int(fa.feedback_given_on.notna().sum()),
        "fatal_coached": int(fa.coaching_session_held.sum()),
        "feedback_reached": a.feedback_given_on.notna().mean(), "coaching_rate": a.coaching_session_held.mean(),
        "audit_lag_days": float((pd.to_datetime(a.audit_date) - a.call_start.dt.normalize()).dt.days.median()),
        "feedback_lag_days": float((pd.to_datetime(a.feedback_given_on) - a.call_start.dt.normalize()).dt.days.median()),
        "complaint_mix": cm.category.value_counts(normalize=True).round(3).to_dict(),
        "bima_bharosa": int(cm.channel.str.contains("Bima", na=False).sum()),
    }


def by(d, col):
    a = d["audits"]
    g = a.groupby(col, observed=True).agg(audits=("audit_id", "count"), disclosure_fail=("P5_fail", "mean"),
                                         pressure_fail=("P7_fail", "mean"), false_promise=("P6_fail", "mean"),
                                         fatal=("fatal_error", "mean"), avg_score=("total_score", "mean"))
    return g


def team_view(d):
    a, c, ag = d["audits"], d["calls"], d["agents"]
    g = by(d, "team_lead_id")
    names = ag.groupby("team_lead_id").team_lead_name.first()
    sales = c[c.outcome == "SALE"]
    g["team_lead"] = names
    g["complaints_per_1000_sales"] = sales.groupby("team_lead_id").complaint_within_30d.mean() * 1000
    g["free_look_rate"] = sales.groupby("team_lead_id").free_look_cancelled.mean()
    g["uncertified_agents"] = ag[~ag.irdai_certified].groupby("team_lead_id").size()
    g["uncertified_agents"] = g["uncertified_agents"].fillna(0).astype(int)
    return g


def month_end(d):
    a, c = d["audits"], d["calls"]
    sales = c[c.outcome == "SALE"]
    out = a.groupby("month_end")[["P7_fail", "P6_fail", "P5_fail"]].mean()
    out["free_look_rate"] = sales.groupby("month_end").free_look_cancelled.mean()
    return out


def auditors(d):
    return d["audits"].groupby("auditor_id").agg(audits=("audit_id", "count"), fatal_rate=("fatal_error", "mean"),
                                                 avg_score=("total_score", "mean"))


def findings(d):
    """T9: the floor-wide story with a stated root cause."""
    t = team_view(d)
    floor_p5, floor_p7 = d["audits"].P5_fail.mean(), d["audits"].P7_fail.mean()
    worst_p5 = t.disclosure_fail.idxmax(); worst_p7 = t.pressure_fail.idxmax(); best_p5 = t.disclosure_fail.idxmin()
    me = month_end(d)
    out = [
        dict(title=f"{worst_p5} ({t.loc[worst_p5, 'team_lead']}) fails disclosures far above the floor",
             evidence=f"{t.loc[worst_p5, 'disclosure_fail']:.0%} of audited calls vs {floor_p5:.0%} floor; best team {best_p5} at {t.loc[best_p5, 'disclosure_fail']:.0%}. "
                      f"Brief (all calls): 26.8% vs 9-12%.",
             cause="Whole-team pattern, so the likely cause is the team's script or the lead's guidance (scorecard guide section 10). "
                   f"Benchmark against {best_p5}'s script.",
             action="Team-level disclosure module; review the team script with Quality."),
        dict(title=f"{worst_p7} ({t.loc[worst_p7, 'team_lead']}) pressure-sells far above the floor",
             evidence=f"{t.loc[worst_p7, 'pressure_fail']:.0%} of audited calls vs {floor_p7:.0%} floor; {t.loc[worst_p7, 'uncertified_agents']} agents not IRDAI-certified.",
             cause="Team culture and certification gap; pressure is coached, not random.",
             action="Team-level 'respecting the customer's decision' module; certification check with compliance."),
        dict(title="Pressure and false promises rise in the last week of the month",
             evidence=f"Pressure {me.loc[False, 'P7_fail']:.0%} -> {me.loc[True, 'P7_fail']:.0%}; false promises {me.loc[False, 'P6_fail']:.1%} -> {me.loc[True, 'P6_fail']:.1%}; "
                      f"free-look {me.loc[False, 'free_look_rate']:.1%} -> {me.loc[True, 'free_look_rate']:.1%} of sales.",
             cause="Monthly premium targets: agents push to close before month end, and the extra sales come back as refunds.",
             action="Daily month-end alerts to team leads; recommend operations review target design."),
    ]
    return out
