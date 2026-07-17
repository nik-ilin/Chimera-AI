# Chimera — AI-Powered Record Label

> **IBM AI Builders Challenge** — "Reimagine Creative Industries with AI"

Chimera is a web platform that acts as an AI-powered record label and creative agency for musicians. It gives independent artists the tools that major labels provide — personal manager, visual design, post copywriting, and lyric ghostwriting — powered by **IBM Granite** via watsonx.ai.

---

## Architecture

```
Browser (Next.js)
    │  HTTPS only
    ▼
Next.js App Router (Vercel)     — pages, Route Handlers, auth
    │  Internal token-protected HTTP
    ▼
Python FastAPI (Railway)        — all AI and third-party API calls
    │
    ├── LangFlow REST endpoints — Granite chains (profiling, captions, lyrics, image briefs)
    ├── IBM watsonx.ai / Granite — reasoning core for all text tasks
    ├── HuggingFace (Stable Diffusion) — image generation
    ├── Instagrapi — Instagram outreach (demo account only)
    ├── Google Calendar API — scheduling
    └── Ticketmaster Discovery API — concert opportunities
```

Supabase (PostgreSQL + Auth + Storage) is used by both layers — Next.js via the anon key (RLS-protected), FastAPI via the service-role key.

---

## Modules

| Module | Description |
|---|---|
| **Personal Manager** | Calendar (Google), Instagram outreach, concert-opportunity finder |
| **Visual Design** | Promo images and album cover art via Stable Diffusion |
| **Post Writing** | AI-generated Instagram and TikTok captions with hashtag sets |
| **Ghostwriting** | Multi-turn lyric writing with rhyme and meter guidance |

---

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- A Supabase project
- IBM Cloud account with watsonx.ai access

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/chimera.git
cd chimera
```

### 2. Environment variables

```bash
# Frontend
cp .env.example frontend/.env.local

# Backend
cp .env.example backend/.env
```

Fill in all values. See `.env.example` for descriptions of each variable.

### 3. Supabase schema

Run the migration in your Supabase SQL Editor:

```
backend/db/migrations/001_initial_schema.sql
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### 5. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# → http://localhost:8000/api/health
```

### 6. LangFlow (Phase 2+)

```bash
pip install langflow==0.6.x  # pin to the version in requirements.txt
langflow run
# → http://localhost:7860
# Import chain JSON files from /langflow/
```

---

## API keys required

| Service | Where to get it |
|---|---|
| IBM watsonx.ai | cloud.ibm.com → Watson Studio project |
| Supabase | supabase.com → project settings |
| GitHub OAuth | github.com/settings/developers |
| Google OAuth + Calendar | console.cloud.google.com |
| HuggingFace | huggingface.co/settings/tokens |
| Ticketmaster | developer.ticketmaster.com |

---

## Security

- All third-party API calls happen **server-side** (FastAPI or Next.js Route Handlers). The browser never holds any secret.
- FastAPI is protected by a shared internal service token. Every route requires `Authorization: Bearer <CHIMERA_SERVICE_TOKEN>`.
- Supabase Row Level Security is enabled on all tables. Every row is restricted to its owner.
- See `CONVENTIONS.md` for the full security policy.

---

## Legal notice

The Instagram automation feature uses Instagrapi (unofficial API). This is a proof-of-concept intended for a demo account only and does not comply with Instagram's ToS. Do not use with a real artist account.

---

## Phase status

| Phase | Description | Status |
|---|---|---|
| 1 | Foundation — scaffold, auth, Supabase, FastAPI health | ✅ Complete |
| 2 | AI Core — Granite + LangFlow chains | ⬜ Pending |
| 3 | Post Writing + Ghostwriting modules | ⬜ Pending |
| 4 | Visual Design + Personal Manager | ⬜ Pending |
| 5 | Integration, deployment, demo video | ⬜ Pending |

---

Made with IBM Bob.
