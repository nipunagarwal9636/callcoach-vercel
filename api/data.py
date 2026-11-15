import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa.auth import WEB  # noqa: E402
from qa.web import need_user, send  # noqa: E402

ALLOWED = {"scorecard": None, "policies": None, "calls": None, "agents": None, "coaching": None, "calllog": None,
           "patterns": {"admin", "qa", "tl"}, "evaluation": {"admin", "qa"}, "stress": {"admin", "qa"}}
_CACHE = {}


def load(name):
    if name not in _CACHE:
        _CACHE[name] = json.loads((WEB / f"{name}.json").read_text())
    return _CACHE[name]


def mine(u, agent_id, team_id):
    r = u["role"]
    return r in ("admin", "qa") or (r == "tl" and team_id == u.get("team")) or (r == "agent" and agent_id == u.get("agent"))


def scoped(name, u):
    d = load(name)
    if u["role"] in ("admin", "qa") or name in ("scorecard", "policies", "patterns"):
        return d
    if name == "calls":
        return dict(d, calls=[c for c in d["calls"] if mine(u, c["agent_id"], c["team_lead_id"])])
    if name == "calllog":
        return [c for c in d if mine(u, c["a"], c["tl"])]
    if name == "agents":
        return dict(d, agents=[a for a in d["agents"] if mine(u, a["id"], a["team_lead_id"])])
    if name == "coaching":
        return dict(agents={k: v for k, v in d["agents"].items() if mine(u, k, v["team_lead_id"])},
                    teams={k: v for k, v in d["teams"].items() if u["role"] == "tl" and k == u.get("team")})
    return d


class handler(BaseHTTPRequestHandler):
    """GET /api/data?name=calls (Authorization: Bearer <token>) -> that dataset, cut down to what this account may see."""

    def do_GET(self):
        u = need_user(self)
        if not u:
            return
        name = (parse_qs(urlparse(self.path).query).get("name") or [""])[0]
        if name not in ALLOWED:
            return send(self, 404, {"error": "unknown dataset"})
        if ALLOWED[name] and u["role"] not in ALLOWED[name]:
            return send(self, 403, {"error": "Your account can't see this."})
        send(self, 200, scoped(name, u))
