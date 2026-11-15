import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time  # noqa: E402

from qa import kv  # noqa: E402
from qa.web import need_user, read_json, send  # noqa: E402

KEY = "callcoach:feed"


class handler(BaseHTTPRequestHandler):
    """Newly scored calls, shared across devices when Upstash Redis is connected.
    GET -> items this account may see. POST {item} -> add (item carries agent_id and team_lead_id)."""

    def do_GET(self):
        u = need_user(self)
        if not u:
            return
        if not kv.available():
            return send(self, 200, {"kv": False, "items": []})
        its = kv.items(KEY, 300)
        r = u["role"]
        if r == "tl":
            its = [i for i in its if i.get("team_lead_id") == u.get("team")]
        elif r == "agent":
            its = [i for i in its if i.get("agent_id") == u.get("agent")]
        send(self, 200, {"kv": True, "items": its})

    def do_POST(self):
        u = need_user(self)
        if not u:
            return
        if not kv.available():
            return send(self, 200, {"kv": False})
        item = read_json(self).get("item") or {}
        if u["role"] == "agent":
            item["agent_id"], item["team_lead_id"] = u["agent"], u["team"]
        item.update(by=u["name"], by_role=u["role"], ts=item.get("ts") or int(time.time() * 1000))
        kv.push(KEY, item, keep=500)
        send(self, 200, {"kv": True, "ok": True})
