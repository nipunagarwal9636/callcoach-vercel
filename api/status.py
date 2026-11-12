from http.server import BaseHTTPRequestHandler

from _util import send
from qa import llm


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        c = llm.config() or {}
        s = llm.stt_config() or {}
        send(self, 200, {"llm": llm.available(), "provider": c.get("provider"), "model": c.get("model"),
                         "stt": bool(s), "stt_provider": s.get("provider")})
