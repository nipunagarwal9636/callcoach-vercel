import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from qa import kv, llm  # noqa: E402
from qa.web import send  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        c = llm.config() or {}
        s = llm.stt_config() or {}
        prov = (os.environ.get("LLM_PROVIDER") or "").strip().strip('"').strip("'").strip().lower()
        key = os.environ.get("LLM_API_KEY") or ""
        if not prov:
            why = "LLM_PROVIDER is not set on this deployment"
        elif prov not in llm.PROVIDERS:
            why = f"LLM_PROVIDER '{prov[:20]}' is not one of: {', '.join(llm.PROVIDERS)}"
        elif not key.strip():
            why = "LLM_API_KEY is not set on this deployment"
        else:
            why = "ok"
        send(self, 200, {"llm": llm.available(), "provider": c.get("provider"), "model": c.get("model"),
                         "stt": bool(s), "stt_provider": s.get("provider"), "check": why,
                         "key_length": len(key.strip()), "kv": kv.available()})
