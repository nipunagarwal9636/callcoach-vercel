"""Local link without Vercel: python dev_server.py  ->  http://localhost:3000
Serves public/ and routes /api/<name> to api/<name>.py, like Vercel does."""
import importlib.util
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [ROOT, os.path.join(ROOT, "api")]
HANDLERS = {}


def load(name):
    if name not in HANDLERS:
        spec = importlib.util.spec_from_file_location(f"api_{name}", os.path.join(ROOT, "api", f"{name}.py"))
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        HANDLERS[name] = mod.handler
    return HANDLERS[name]


class Dev(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=os.path.join(ROOT, "public"), **k)

    def _api(self, method):
        name = self.path.split("?")[0].strip("/").split("/", 1)[1]
        h = load(name)
        getattr(h, method)(self)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("do_GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("do_POST")
        self.send_error(404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    print(f"CallCoach running at http://localhost:{port}")
    ThreadingHTTPServer(("", port), Dev).serve_forever()
