import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa import kv  # noqa: E402
from qa.web import need_user, read_json, send  # noqa: E402


class handler(BaseHTTPRequestHandler):
    """Per-user memory (practice history, lessons, last visit) and shared app state (review decisions, cases, trail).
    GET ?scope=me|shared, POST {scope, state}. Without Upstash the browser keeps it locally."""

    def _key(self, u, scope):
        return f"callcoach:user:{u['u']}" if scope == "me" else "callcoach:shared"

    def do_GET(self):
        u = need_user(self)
        if not u:
            return
        scope = (parse_qs(urlparse(self.path).query).get("scope") or ["me"])[0]
        if not kv.available():
            return send(self, 200, {"kv": False, "state": None})
        send(self, 200, {"kv": True, "state": kv.get_json(self._key(u, scope), {})})

    def do_POST(self):
        u = need_user(self)
        if not u:
            return
        b = read_json(self)
        if not kv.available():
            return send(self, 200, {"kv": False})
        scope = b.get("scope", "me")
        if scope == "shared" and u["role"] == "agent":
            return send(self, 403, {"error": "Agents can't change shared review data."})
        kv.set_json(self._key(u, scope), b.get("state") or {})
        send(self, 200, {"kv": True, "ok": True})
