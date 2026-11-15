"""Demo accounts and signed session tokens (HMAC-SHA256). Every role gets only its own slice of data from /api/data."""
import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

WEB = Path(__file__).with_name("webdata")
TTL = 12 * 3600


def _secret():
    return (os.environ.get("AUTH_SECRET") or "callcoach-demo-secret-change-me").encode()


def _pw(kind):
    if kind == "admin":
        return os.environ.get("ADMIN_PASSWORD") or "admin123"
    return os.environ.get("DEMO_PASSWORD") or "demo123"


_USERS = None


def users():
    """username -> {role, name, team?, agent?}. Built from the data pack: 120 agents, 5 team leads, QA auditors, one admin."""
    global _USERS
    if _USERS is None:
        ag = json.loads((WEB / "agents.json").read_text())
        u = {"admin": dict(role="admin", name="Admin (full view)")}
        for a in ag["agents"]:
            u[a["id"].lower()] = dict(role="agent", name=a["name"], agent=a["id"], team=a["team_lead_id"])
            u[a["team_lead_id"].lower()] = dict(role="tl", name=a["team_lead"], team=a["team_lead_id"])
        for q in sorted({x["auditor"] for a in ag["agents"] for x in a["audits"]}):
            u[q.lower()] = dict(role="qa", name=f"Auditor {q}", qa=q)
        _USERS = u
    return _USERS


def login(username, password):
    key = (username or "").strip().lower()
    u = users().get(key)
    if not u or not hmac.compare_digest(password or "", _pw("admin" if u["role"] == "admin" else "user")):
        return None
    payload = dict(u=key, exp=int(time.time()) + TTL, **u)
    return make_token(payload), payload


def make_token(payload):
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(_secret(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{body}.{sig}"


def verify(token):
    try:
        body, sig = (token or "").split(".")
        good = base64.urlsafe_b64encode(hmac.new(_secret(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        if not hmac.compare_digest(sig, good):
            return None
        p = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return p if p.get("exp", 0) > time.time() else None
    except Exception:
        return None


def from_header(h):
    a = h.headers.get("Authorization") or ""
    return verify(a[7:] if a.lower().startswith("bearer ") else a)


def demo_accounts():
    """A few ready-made logins shown on the sign-in page."""
    u = users()
    pick = lambda role, pref: next((k for k in pref if k in u), next(k for k, v in u.items() if v["role"] == role))  # noqa: E731
    out = [("admin", u["admin"])]
    out.append((pick("qa", ["qa-1"]), None))
    out.append((pick("tl", ["tl-3"]), None))
    out.append((pick("agent", ["sa-001"]), None))
    return [dict(username=k, **u[k]) for k, _ in out]
