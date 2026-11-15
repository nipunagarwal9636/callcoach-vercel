import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa import auth  # noqa: E402
from qa.web import read_json, send  # noqa: E402


class handler(BaseHTTPRequestHandler):
    """GET -> demo accounts for the sign-in page. POST {username, password} -> {token, user}."""

    def do_GET(self):
        send(self, 200, {"demo": auth.demo_accounts(), "hint": "Demo password for agents, team leads and QA: demo123. Admin: admin123."})

    def do_POST(self):
        b = read_json(self)
        out = auth.login(b.get("username"), b.get("password"))
        if not out:
            return send(self, 401, {"error": "Wrong username or password."})
        tok, user = out
        send(self, 200, {"token": tok, "user": user})
