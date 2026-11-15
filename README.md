# CallCoach QA (PS-04): every call heard, every miss fixed

Auto-QA and coaching for PolicyNest's sales floor (Masters' Union Applied AI Challenge, PS-04). All data is synthetic.

The product is one loop: **Detect → Decide → Fix → Prevent → Prove**.

| Stage | Page | What it does |
|---|---|---|
| Detect | Score a call | Transcript or audio → 10-parameter scorecard with turn and quote per failure; rules + optional AI judge |
| Detect | Policy check | Checks what the agent said against the plan's policy wording, clause by clause, with citations. Upload any policy PDF |
| Decide | Review queue | QA auditor confirms or overturns each fatal/unsure finding; every action on a SHA-256 hash-chained audit trail (verify, tamper test, CSV export) |
| Decide | Today's flags | Team lead's ranked queue |
| Fix | Customer recovery | Fatal error on a sale → callback case; team lead assigns it to an agent, the agent logs the outcome, the team lead approves or sends it back; 48-hour timer and a courtesy-call script |
| Fix | Coaching / Agents | Modules from the agent's own calls; agent dashboard from 359 audits: trend, mistakes, before/after coaching |
| Prevent | Live Sales Buddy | Role-play with a simulated customer (scripted, or AI with a key); a live coach flags risky lines and suggests the next best line; voice input in Chrome |
| Prove | Accuracy | Run the deployed engine on the stress set or all 110 labelled calls live, with the AI judge on; metrics, latency, export |
| Prove | P&L and ROI | One answer (saved each month) with three scenarios, where the money comes from, payback; assumptions editable under "Change the numbers" |

## Accounts (each role sees only its own data)

| Sign in as | Username | Sees |
|---|---|---|
| Agent | their ID, e.g. `SA-001` | My dashboard (customers, calls, sales, errors per call, mistakes, coaching), lessons, practice |
| Team lead | `TL-1` … `TL-8` | Their team's dashboard, flags, recovery, coaching, agents |
| QA auditor | `QA-1` … `QA-5` | Review desk, review queue, audit trail, accuracy, policy check |
| Admin | `admin` | Everything (full view) |

Demo password `demo123` (admin: `admin123`). The server signs a session token and `/api/data` returns only the rows that
account may see. Set `AUTH_SECRET`, `DEMO_PASSWORD` and `ADMIN_PASSWORD` on Vercel for anything beyond a demo.

### Share state across devices (optional, free)

Vercel → Storage → **Upstash for Redis** → connect to the project (it adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`), then redeploy.
With it, newly scored calls reach the agent's and team lead's dashboards on any device, and review decisions, recovery cases,
the audit trail and each user's memory (practice history, lessons) are shared. Without it, everything works within one browser.

## Run locally

```bash
pip install openai pandas openpyxl
python dev_server.py            # http://localhost:3000
```

## Deploy on Vercel

1. Push this folder to GitHub (repo root = this folder). Vercel: Add New → Project → import → Framework preset **Other** → Deploy.
2. Settings → Environment Variables, then Redeploy:
   - `LLM_PROVIDER` = `groq` (or `gemini`), `LLM_API_KEY` = your key
   - optional `LLM_MODEL` (default for Groq: `openai/gpt-oss-120b`)
   - optional audio: `STT_PROVIDER` = `groq`, `STT_API_KEY` = same Groq key
3. Check `https://<your-app>.vercel.app/api/status` shows `"check": "ok"`.

## Where state lives

Review decisions, the audit trail, recovery cases, coaching logs, uploaded policies and benchmark runs are stored in the
browser (localStorage) for this MVP, so each viewer has their own copy. Production would put the same records in a database
(e.g. Postgres) with sign-in; the hash chain carries over unchanged.

## Refresh the precomputed data

```bash
python scripts/evaluate.py            # rule-layer results
python scripts/export_web.py          # rewrites public/data/*.json
```

## Honest limits

- The labelled transcripts are template-generated and the rules were tuned on them, so 100% there does not generalise.
  The 12-call stress set rewords violations: rules alone get 18/23. The Accuracy page measures the AI judge live.
- Policy wordings in `qa/policies/` are synthetic samples written from the facts agents state in the labelled calls.
- Policy fact extraction is regex-based for plainly worded limits; other statements need the AI check.
- ROI assumptions (auditor cost, reduction rates, platform cost) are ours and editable on the page.
