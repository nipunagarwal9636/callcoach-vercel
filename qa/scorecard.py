"""PolicyNest QA scorecard v2.3, encoded exactly as the compliance guide defines it."""

PARAMS = {
    "P1": dict(name="Opening and identification", points=5, severity="MINOR", stage="Opening",
               met="Agent gives own name, says they are calling from PolicyNest Insurance Brokers, and states why they are calling.",
               fail="No name, no company, or no reason for the call (e.g. 'Hello sir, health insurance chahiye? Best plan hai')."),
    "P2": dict(name="Recording consent", points=None, severity="FATAL", stage="Opening",
               met="Before any discussion of products or personal details, the customer is told the call is recorded.",
               fail="Disclosure missing, or given only after the customer has shared personal or health information."),
    "P3": dict(name="Need analysis", points=15, severity="MINOR", stage="Discovery",
               met="At least three relevant questions (health: who/ages, existing illness or medication, existing cover, budget; motor: vehicle and year, current policy and claims, expiry, usage/parking) used in the recommendation.",
               fail="Agent pitches a plan without asking."),
    "P4": dict(name="Accurate product explanation", points=15, severity="MAJOR", stage="Pitch",
               met="Plan name, sum insured or IDV and main features stated correctly.",
               fail="Wrong sum insured or IDV, or claims like 'all hospitals are cashless' / 'every garage is cashless' when only network ones are."),
    "P5": dict(name="Mandatory disclosures", points=None, severity="FATAL", stage="Pitch",
               met="Before payment the customer hears the limits. Health: initial waiting period, specific-illness waiting periods, pre-existing disease waiting period, and any co-pay / room-rent limit / sub-limit. Motor: compulsory deductible, add-on conditions (e.g. zero-dep claim limit), what is not covered without an add-on.",
               fail="Any of these missing or misstated. Worst pattern: answering a question about an existing illness with 'don't worry, it's covered'."),
    "P6": dict(name="No false promises", points=None, severity="FATAL", stage="Pitch",
               met="No guarantee of claim approval, no 'everything is covered', no promised returns/refunds/no-claim payouts the product lacks, no pre-existing condition covered from day one.",
               fail="'100% approved', 'guaranteed', 'you'll get your premium back', 'covered from day one'."),
    "P7": dict(name="No pressure selling", points=15, severity="MAJOR", stage="Objections",
               met="When the customer wants to think, compare or consult family, the agent respects it and offers a follow-up.",
               fail="False urgency ('price goes up tomorrow'), pushing after a clear 'not now', or emotional pressure ('everyone regrets waiting')."),
    "P8": dict(name="Premium and payment process", points=15, severity="MAJOR", stage="Payment",
               met="Premium stated including GST; payment only through a secure link to the registered number; never asks for OTP, PIN, CVV or card number.",
               fail="Premium without GST ('just Rs X'), or asking for an OTP/PIN/CVV/card number (also a conduct escalation)."),
    "P9": dict(name="Listening and courtesy", points=20, severity="MINOR", stage="Throughout",
               met="Lets the customer finish, answers patiently, respectful language.",
               fail="Talking over the customer ([overlap]), repeated interruption, dismissive phrases ('you're not understanding', 'listen to me first')."),
    "P10": dict(name="Closing and next steps", points=15, severity="MINOR", stage="Close",
                met="Summarises plan, premium, what happens next and when; after a sale, says documents will arrive and mentions the free-look period.",
                fail="Abrupt end with no summary (e.g. 'Okay sir, done. Bye.')."),
}

ORDER = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]
FATAL = ["P2", "P5", "P6"]
SEVERITY_RANK = {"FATAL": 3, "MAJOR": 2, "MINOR": 1, "NONE": 0}

COACHING_THEME = {
    "P1": "Opening the call properly", "P2": "Taking recording consent", "P3": "Asking need-analysis questions",
    "P4": "Explaining cover accurately", "P5": "Disclosing waiting periods and exclusions", "P6": "Never promising outcomes",
    "P7": "Respecting the customer's decision", "P8": "Quoting premium with GST; payment safety",
    "P9": "Listening without interrupting", "P10": "Closing with summary and free-look",
}


def call_score(results: dict) -> int:
    """results: {param_id: 'MET'|'NOT_MET'|'NOT_APPLICABLE'|'REVIEW'}. REVIEW on a fatal parameter counts as a fail (conservative)."""
    if any(results.get(p) in ("NOT_MET", "REVIEW") for p in FATAL):
        return 0
    return sum(PARAMS[p]["points"] for p in ORDER
               if PARAMS[p]["points"] and results.get(p) not in ("NOT_MET", "REVIEW"))


def rubric_text() -> str:
    lines = []
    for p in ORDER:
        d = PARAMS[p]
        w = "FATAL (any fail sets call score to 0)" if d["points"] is None else f"{d['points']} points, {d['severity'].lower()}"
        lines.append(f"{p} {d['name']} [{w}]\n  MET: {d['met']}\n  NOT_MET: {d['fail']}")
    return "\n".join(lines)
