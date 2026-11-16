from http.server import BaseHTTPRequestHandler
from urllib.parse import unquote

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa.web import send  # noqa: E402
from qa.stt import transcribe


class handler(BaseHTTPRequestHandler):
    def do_GET(self):  # warm-up ping so the first live sentence isn't slowed by a cold start
        send(self, 200, {"ok": True})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4_400_000:
                return send(self, 413, {"error": "Audio too large for a serverless upload (keep it under ~4 MB, e.g. a 2-3 minute mp3)."})
            data = self.rfile.read(n)
            name = unquote(self.headers.get("X-Filename") or "call.mp3")
            sp = (self.headers.get("X-Speaker") or "").upper()
            call = transcribe(data, name, sp if sp in ("AGENT", "CUSTOMER") else None)
            text = "\n".join(f"{t.speaker}: {t.text}" for t in call.turns)
            send(self, 200, {"transcript": text, "turns": [dict(s=t.speaker, t=t.text) for t in call.turns]})
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
