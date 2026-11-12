from http.server import BaseHTTPRequestHandler
from urllib.parse import unquote

from _util import send
from qa.stt import transcribe


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4_400_000:
                return send(self, 413, {"error": "Audio too large for a serverless upload (keep it under ~4 MB, e.g. a 2-3 minute mp3)."})
            data = self.rfile.read(n)
            name = unquote(self.headers.get("X-Filename") or "call.mp3")
            call = transcribe(data, name)
            text = "\n".join(f"{t.speaker}: {t.text}" for t in call.turns)
            send(self, 200, {"transcript": text, "turns": len(call.turns)})
        except Exception as e:
            send(self, 500, {"error": str(e)[:300]})
