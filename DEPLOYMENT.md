# Deploying Chimera

Two services: the **Next.js frontend → Vercel**, the **FastAPI AI microservice →
Railway or Render**. Supabase and IBM watsonx are managed services.

```
Browser ──HTTPS──▶ Vercel (Next.js) ──HTTPS + service token──▶ Railway/Render (FastAPI) ──▶ watsonx / Supabase
```

---

## 1. Frontend → Vercel

Vercel auto-detects Next.js. Because this is a monorepo:

- **Root Directory:** `frontend`
- **Build command / Output:** default (Next.js preset)
- **Install command:** default (`npm install`)

### Frontend env vars (Vercel → Project → Settings → Environment Variables)
| Var | Notes |
|-----|-------|
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | **The deployed frontend URL**, e.g. `https://chimera.vercel.app`. Not localhost. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth app |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side (Supabase adapter). **Never** `NEXT_PUBLIC_`. |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT secret |
| `FASTAPI_INTERNAL_URL` | **The deployed backend URL**, e.g. `https://chimera-backend.onrender.com` |
| `CHIMERA_SERVICE_TOKEN` | Must equal the backend value |

> `trustHost: true` is set in `src/lib/auth.ts`, so Auth.js accepts the Vercel
> host. Still set `AUTH_URL` so OAuth callback URLs are correct.

### GitHub OAuth app
Update the callback URL to `https://<your-vercel-domain>/api/auth/callback/github`.

---

## 2. Backend → Railway or Render

The repo ships both:
- **Railway:** `backend/Procfile` (`web: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}`). Set the service **Root Directory** to `backend`.
- **Render:** `render.yaml` blueprint (Root Directory `backend`, health check `/api/health`).

Python is pinned via `backend/runtime.txt` / `backend/.python-version` (3.11.9).

### Backend env vars
| Var | Notes |
|-----|-------|
| `CHIMERA_SERVICE_TOKEN` | Must equal the frontend value |
| `ALLOWED_ORIGINS` | **The deployed frontend origin**, e.g. `https://chimera.vercel.app` (comma-separated, no trailing slash) |
| `WATSONX_API_KEY` / `WATSONX_PROJECT_ID` / `WATSONX_URL` | watsonx.ai; `WATSONX_URL` must match the project's region |
| `GRANITE_MODEL_ID` | e.g. `ibm/granite-8b-code-instruct` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Service-role DB access |
| `APP_ENV` | `production` |

---

## 3. Supabase (once)
- Run migrations `001` → `004` in the SQL Editor.
- **Expose the `next_auth` schema:** Settings → API → Exposed schemas → add `next_auth`.
- The watsonx project must be linked to a Watson Machine Learning instance.

---

## ⚠️ Production gotchas (read before demoing)

1. **`AUTH_URL` and `ALLOWED_ORIGINS` must point at the deployed domains**, not
   localhost. Wrong `ALLOWED_ORIGINS` silently blocks every frontend→backend call
   (CORS); wrong `AUTH_URL` breaks the OAuth callback.
2. **Vercel function duration vs. streaming.** The AI Route Handlers set
   `export const maxDuration = 300`. Vercel enforces a plan cap (Hobby ≈ 60s,
   Pro up to 300s). watsonx time-to-first-token can be tens of seconds, so on the
   **Hobby plan long generations may be cut off mid-stream** — use Pro, or point
   the browser at the backend’s SSE more directly, before the demo.
3. **Backend cold start.** `supabase-py` is imported lazily (startup is fast), and
   warmed in the background on boot. On Railway/Render free tiers the container
   **spins down when idle**; the first request after idle is slow. Use a paid/
   always-on plan for the demo (the `render.yaml` uses `starter`, not free).
4. **Supabase free tier pauses** after ~1 week of inactivity — the first request
   then fails until it resumes. Hit the dashboard before demoing.
5. **Service token must match** on both sides, or every AI route returns 401.
6. **GitHub OAuth callback** must be updated to the Vercel domain (see above).
7. No localhost is hardcoded in app code — all cross-service URLs come from env
   (`FASTAPI_INTERNAL_URL`, `ALLOWED_ORIGINS`, `AUTH_URL`). Keep it that way.
