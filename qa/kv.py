"""Shared storage. Uses Upstash Redis (Vercel Storage → Upstash for Redis sets KV_REST_API_URL and KV_REST_API_TOKEN)
when configured; otherwise reports unavailable and the browser keeps state locally."""
import json
import os
import urllib.request


def _cfg():
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    tok = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    return (url.rstrip("/"), tok) if url and tok else None


def available():
    return _cfg() is not None


def cmd(*args):
    url, tok = _cfg()
    req = urllib.request.Request(url, data=json.dumps([str(a) for a in args]).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        out = json.loads(r.read())
    if "error" in out:
        raise RuntimeError(out["error"])
    return out.get("result")


def get_json(key, default=None):
    v = cmd("GET", key)
    return json.loads(v) if v else default


def set_json(key, val):
    cmd("SET", key, json.dumps(val, ensure_ascii=False))


def push(key, val, keep=500):
    cmd("LPUSH", key, json.dumps(val, ensure_ascii=False))
    cmd("LTRIM", key, 0, keep - 1)


def items(key, n=200):
    return [json.loads(x) for x in (cmd("LRANGE", key, 0, n - 1) or [])]
