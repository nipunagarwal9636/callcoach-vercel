# CallCoach QA (PS-04): web version for Vercel

Every PolicyNest sales call scored against the 10-parameter scorecard, with the evidence turn marked, risk routed, floor patterns
found, and coaching built from the agent's own calls. All data is synthetic.

- `public/`: the site (HTML, CSS, JS). Precomputed results live in `public/data/*.json`.
- `api/`: Python serverless functions. `score` (rules + optional AI judge), `status`, `coach` (AI-personalised module), `transcribe` (audio).
- `qa/`: the scoring engine, shared with the Streamlit version.

## Run it on your laptop

```bash
pip install openai pandas openpyxl
python dev_server.py            # open http://localhost:3000
```

## Deploy on Vercel (about 5 minutes)

1. Push this folder to a new GitHub repository (it must be the repo root, with `vercel.json` at the top).
2. On vercel.com: **Add New → Project**, import the repo. Framework preset: **Other**. Leave build settings empty. Deploy.
3. To switch on the AI judge: **Project → Settings → Environment Variables**, add
   - `LLM_PROVIDER` = `gemini` (or `groq`, `openai`, `openrouter`)
   - `LLM_API_KEY` = your key (free Gemini key: aistudio.google.com/apikey)
   - optional for audio upload: `STT_PROVIDER` = `groq`, `STT_API_KEY` = your Groq key

   Then **Deployments → Redeploy**. The dot in the top bar turns green and says which model is on.

Never commit keys. They live only in Vercel's environment variables.

## Refresh the numbers after an AI-judge run

```bash
pip install pandas openpyxl openai
LLM_PROVIDER=gemini LLM_API_KEY=... python scripts/evaluate.py --llm --sleep 6
python scripts/export_web.py    # rewrites public/data/*.json; Results page gains a "Rules and AI judge" tab
```

## Honest limits

- The labelled transcripts are template-generated, so the rule layer scores them almost perfectly. The 12 hand-written stress calls
  reword violations; rules alone get 18 of 23 checks, which is why the AI judge exists.
- Audio uploads are limited to about 4 MB on Vercel's free plan.
- No pure-Hindi labelled calls, so Hindi accuracy is untested.
