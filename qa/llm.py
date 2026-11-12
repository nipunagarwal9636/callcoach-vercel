"""LLM layer: one OpenAI-compatible client for Gemini, Groq, OpenAI, OpenRouter or Anthropic.

Configure with environment variables or Streamlit secrets:
  LLM_PROVIDER = gemini | groq | openai | openrouter | anthropic
  LLM_API_KEY  = your key
  LLM_MODEL    = optional override
  STT_PROVIDER / STT_API_KEY = groq | openai (for audio; defaults to the LLM settings)
"""
import json
import os
import re
import time

from .scorecard import ORDER, rubric_text

PROVIDERS = {
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-2.5-flash"),
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
    "openai": (None, "gpt-4o-mini"),
    "openrouter": ("https://openrouter.ai/api/v1", "google/gemini-2.5-flash"),
    "anthropic": ("https://api.anthropic.com/v1/", None),
}
STT_MODELS = {"groq": "whisper-large-v3-turbo", "openai": "whisper-1"}


def _setting(name, default=None):
    v = os.environ.get(name)
    if v:
        return v
    try:
        import streamlit as st
        return st.secrets.get(name, default)
    except Exception:
        return default


def config():
    prov = (_setting("LLM_PROVIDER") or "").lower()
    key = _setting("LLM_API_KEY")
    if not prov or not key or prov not in PROVIDERS:
        return None
    base, model = PROVIDERS[prov]
    return dict(provider=prov, key=key, base=base, model=_setting("LLM_MODEL") or model)


def available():
    c = config()
    return bool(c and c["model"])


def client(cfg=None):
    from openai import OpenAI
    cfg = cfg or config()
    return OpenAI(api_key=cfg["key"], base_url=cfg["base"]) if cfg["base"] else OpenAI(api_key=cfg["key"])


def _parse_json(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def chat_json(system, user, temperature=0.0, retries=3, max_tokens=2500):
    cfg = config()
    cl = client(cfg)
    last = None
    for attempt in range(retries):
        try:
            kw = dict(model=cfg["model"], temperature=temperature, max_tokens=max_tokens,
                      messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
            try:
                resp = cl.chat.completions.create(response_format={"type": "json_object"}, **kw)
            except Exception as e:  # some providers reject response_format
                if "response_format" in str(e) or "json" in str(e).lower():
                    resp = cl.chat.completions.create(**kw)
                else:
                    raise
            out = _parse_json(resp.choices[0].message.content)
            usage = getattr(resp, "usage", None)
            out["_usage"] = dict(prompt=getattr(usage, "prompt_tokens", 0), completion=getattr(usage, "completion_tokens", 0)) if usage else {}
            return out
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1) + (8 if "429" in str(e) else 0))
    raise RuntimeError(f"LLM call failed: {last}")


JUDGE_SYSTEM = """You are a senior QA auditor at PolicyNest Insurance Brokers, an Indian health and motor insurance broker.
You audit sales-call transcripts (English, Hindi, Hinglish) against the company scorecard, exactly as written, like a careful human auditor.

How to judge:
- Score each of the 10 parameters independently: MET, NOT_MET or NOT_APPLICABLE.
- Every NOT_MET must cite evidence: the turn number(s) and the exact words. If you cannot point to evidence, it is MET.
- Absences count: if a required item never happens (e.g. no recording disclosure, no waiting-period disclosure before payment), mark NOT_MET, cite the turn where it should have happened, and set quote to "(absent) " plus what was missing.
- Context decides. A reassurance like "it's covered" is a P5 failure only if it misstates the limits for what the customer asked (e.g. an existing illness that has a waiting period). It is fine if the benefit really is covered.
- Pick the right parameter: a wrong feature claim such as "every garage/hospital is cashless" or a wrong sum insured/IDV is P4, not P5. Missing or misstated waiting periods, co-pay, deductibles or exclusions is P5. Guarantees of claims, returns or premium back are P6.
- P7: a customer saying they want to discuss with family or think is NOT pressure if the agent respects it and offers a follow-up. False urgency ("price goes up tomorrow", "only today"), pushing after "not now", or emotional pressure ("everyone regrets waiting") is NOT_MET. NOT_APPLICABLE only if the customer never hesitated and no pressure happened.
- P8: NOT_APPLICABLE if no premium or payment is discussed. Asking for an OTP, PIN, CVV or card number is NOT_MET and a conduct alert.
- P10: judged on the final close. After a sale it must mention documents and the free-look period.
- Personal details are masked as [NAME], [PHONE], [HEALTH CONDITION]; treat [HEALTH CONDITION] as a real existing illness.
- Be conservative on fatal parameters (P2, P5, P6): if you are unsure, still give your best answer but set confidence below 0.6 so a human reviews it.
- Rule-layer hints are given to you. They can be wrong in both directions: verify them in context.

Return ONLY JSON:
{"parameters": [{"id": "P1", "result": "MET|NOT_MET|NOT_APPLICABLE", "evidence_turns": [int], "quote": "exact words or (absent) ...", "reason": "one short sentence", "confidence": 0.0-1.0}, ... all 10 in order P1..P10],
 "conduct_alert": true|false,
 "customer_flags": ["senior citizen" | "existing illness" | "confused" | "motor switcher", ...],
 "summary": "one sentence a team lead can read"}"""


def judge(call_masked, rule_findings):
    hints = "\n".join(
        f"- {p}: rules say {f.result}" + (f" at turn(s) {f.turns}: \"{f.quote[:120]}\"" if f.turns or f.quote else "") + f" ({f.reason})"
        for p, f in rule_findings.items())
    user = f"""SCORECARD
{rubric_text()}

RULE-LAYER HINTS (verify, do not copy blindly)
{hints}

TRANSCRIPT (turn numbers in brackets)
{call_masked.as_text()}

Return the JSON now."""
    out = _parse_or_empty(chat_json(JUDGE_SYSTEM, user))
    return out


def _parse_or_empty(out):
    params = {}
    for item in out.get("parameters", []):
        pid = str(item.get("id", "")).upper().strip()
        if pid in ORDER:
            res = str(item.get("result", "MET")).upper().replace(" ", "_")
            if res not in ("MET", "NOT_MET", "NOT_APPLICABLE"):
                res = "MET"
            turns = item.get("evidence_turns") or []
            if isinstance(turns, (int, str)):
                turns = [turns]
            turns = [int(t) for t in turns if str(t).strip().isdigit()]
            params[pid] = dict(result=res, turns=turns, quote=str(item.get("quote", "") or ""),
                               reason=str(item.get("reason", "") or ""), confidence=float(item.get("confidence", 0.8) or 0.8))
    out["params"] = params
    return out


# ---------- speaker labelling for audio ----------
def label_speakers(segments):
    """segments: list of str. Returns list of 'AGENT'/'CUSTOMER'."""
    numbered = "\n".join(f"{i}: {s}" for i, s in enumerate(segments))
    sys = ("You label who is speaking in an Indian insurance sales call transcript split into segments. The AGENT works for "
           "PolicyNest and sells; the CUSTOMER answers. Return JSON {\"labels\": [\"AGENT\"|\"CUSTOMER\", ...]} with one label per segment.")
    out = chat_json(sys, numbered, max_tokens=1500)
    labels = [("AGENT" if str(x).upper().startswith("A") else "CUSTOMER") for x in out.get("labels", [])]
    if len(labels) != len(segments):
        labels = ["AGENT" if i % 2 == 0 else "CUSTOMER" for i in range(len(segments))]
    return labels


def stt_config():
    prov = (_setting("STT_PROVIDER") or _setting("LLM_PROVIDER") or "").lower()
    key = _setting("STT_API_KEY") or (_setting("LLM_API_KEY") if prov == (_setting("LLM_PROVIDER") or "").lower() else None)
    if prov not in STT_MODELS or not key:
        return None
    base = PROVIDERS[prov][0]
    return dict(provider=prov, key=key, base=base, model=_setting("STT_MODEL") or STT_MODELS[prov])
