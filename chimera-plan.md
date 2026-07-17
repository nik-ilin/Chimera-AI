# Chimera — AI-Powered Record Label Platform
## Hackathon Architecture & Implementation Plan
### IBM AI Builders Challenge — "Reimagine Creative Industries with AI"

---

## Top-Level Overview

**Goal:** Build a working web prototype of Chimera — a platform that acts as an AI-powered record label / agency for content creators. For this hackathon, only the **Musician vertical** is implemented. The platform onboards users through a creator-profiling router and delivers a tailored portal with four AI-powered service modules.

**Scope:** Musician portal only. The Influencer and Video Creator verticals exist as UI stubs (greyed-out cards) that declare the product vision without requiring implementation.

**Approach:**
- **Next.js (App Router)** handles all pages, routing, and UI
- **Python FastAPI** is the AI microservice — all Granite/LangChain/LangFlow-backed endpoints live here
- **Supabase** provides the database (user data, calendar events, outreach history) and NextAuth.js-compatible OAuth (GitHub / Google)
- **IBM Granite via watsonx.ai** is the reasoning core for every text-generation task
- **LangFlow** is the visual orchestration layer where AI chains are built, iterated, and exported; FastAPI calls LangFlow's REST API endpoints
- **Hugging Face Inference API** (Stable Diffusion) is the swappable image generation peripheral
- **Instagrapi** handles Instagram automation (demo account only; ToS risk acknowledged)
- **Google Calendar API** + **Ticketmaster Discovery API** power the Personal Manager's scheduling and opportunity-finding features

**Hackathon deliverables:** public GitHub repo, working prototype, clear README, 3-minute demo video.

---

## Layered Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                      │
│          Next.js App Router  (TypeScript + Tailwind)        │
│  /onboarding → /portal/musician → /portal/[module]         │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / fetch
┌──────────────────────────▼──────────────────────────────────┐
│                       API LAYER                             │
│    Next.js API Routes (/api/*)  ← auth, Supabase reads     │
│    Python FastAPI (:8000/api/*) ← all AI & external APIs   │
└───────┬────────────────────────────────┬────────────────────┘
        │                                │
┌───────▼──────────┐          ┌──────────▼──────────────────┐
│   SUPABASE       │          │   LANGFLOW SERVER            │
│  PostgreSQL DB   │          │   (Visual chain builder)     │
│  Auth (OAuth)    │          │   Exports REST endpoints     │
│  Storage         │          │   called by FastAPI          │
└──────────────────┘          └──────────┬────────────────────┘
                                         │
                    ┌────────────────────▼──────────────────┐
                    │            AI / EXTERNAL SERVICES      │
                    │  IBM watsonx.ai → Granite 3.x (text)  │
                    │  HuggingFace API → Stable Diffusion    │
                    │  Instagrapi → Instagram automation     │
                    │  Google Calendar API                   │
                    │  Ticketmaster Discovery API            │
                    └───────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Onboarding Router
- Landing page with three creator-type cards (Musician, Influencer, Video Creator)
- Musician card is active; the other two are visually stubbed
- Granite classifies the user's self-description text into a creator type (chain built in LangFlow)
- Session/profile stored in Supabase user metadata

### 2. Musician Portal Shell
- Sidebar navigation linking to the four modules
- Persistent user context (artist name, genre, city, social handles) stored in Supabase
- Module cards dashboard as landing view

### 3. Module A — Personal Manager
- **Calendar sub-module:** Google Calendar OAuth integration; view, create, and delete events from the app
- **Instagram Outreach sub-module:** Granite drafts personalized DM to a promoter/venue; Instagrapi sends it from the demo account; history logged to Supabase
- **Concert Finder sub-module:** Ticketmaster Discovery API surfaces open calls and venue listings by city/genre; Granite ranks and annotates results with outreach suggestions

### 4. Module B — Visual Design
- User provides a brief (artist name, mood, genre, color preferences) via a form
- Granite interprets the brief and generates a refined, detailed image prompt (chain in LangFlow)
- Hugging Face Inference API (Stable Diffusion) generates the image
- Result displayed in-app with a download button
- Image variant: promo post vs. album cover (toggle)

### 5. Module C — Post Writing
- User inputs context (event, release, mood, platform target: Instagram or TikTok)
- Granite generates 3 caption variants in the platform's native style (chain in LangFlow)
- Each variant shows estimated character count and hashtag set
- One-click copy to clipboard

### 6. Module D — Ghostwriting
- Multi-turn lyric writing assistant
- User sets: genre, theme, verse/chorus/bridge target, rhyme scheme, syllable target
- Granite generates draft lyrics with inline rhyme and meter annotations
- Edit-and-refine loop: user edits a line, Granite suggests the next line or rewrites a section
- Chain managed in LangFlow (multi-turn memory context)

---

## Recommended Tech Stack Per Module

| Layer / Module | Technology | Role |
|---|---|---|
| Frontend | Next.js 14 App Router + TypeScript | All pages and routing |
| Styling | Tailwind CSS + shadcn/ui | Component library |
| Auth | NextAuth.js v5 + Supabase adapter | GitHub/Google OAuth |
| Database | Supabase (PostgreSQL) | User profiles, events, outreach history, lyrics |
| File storage | Supabase Storage | Generated images |
| AI reasoning core | IBM Granite 3.x via watsonx.ai | ALL text generation tasks |
| AI orchestration | LangFlow (self-hosted or cloud) | Visual chain builder, exports REST endpoints |
| LangChain Python | LangChain + langchain-ibm | FastAPI calls to LangFlow / direct Granite calls |
| Image generation | HuggingFace Inference API (SD XL) | Visual Design module only |
| Instagram automation | Instagrapi (Python) | Personal Manager outreach (demo account) |
| Calendar | Google Calendar API (Python client) | Personal Manager calendar |
| Concert discovery | Ticketmaster Discovery API | Concert Finder sub-module |
| Backend API | Python FastAPI | AI microservice, all external API calls |
| Deployment | Vercel (Next.js) + Railway or Render (FastAPI) | Hosting |

### Where Granite / watsonx / LangFlow fit vs. external services

**Granite (IBM watsonx.ai) handles:**
- Creator-type classification (onboarding)
- Instagram DM drafting
- Concert opportunity ranking and annotation
- Image prompt engineering (brief → SD prompt)
- Caption/post copywriting (Instagram & TikTok)
- Lyric generation, rhyme suggestion, and meter analysis

**LangFlow handles:**
- Visual design and iteration of all Granite chains
- Multi-turn memory management (ghostwriting session)
- Chain export as callable REST endpoints consumed by FastAPI

**External services (peripheral, swappable):**
- Stable Diffusion (HuggingFace) — only service that touches pixels
- Instagrapi — only service that touches Instagram
- Google Calendar API — only service that touches calendar data
- Ticketmaster API — only service that sources event data

---

## MVP Scope: Build vs. Stub vs. Defer

### BUILD FULLY (demo-ready, functional)
| Feature | Reason |
|---|---|
| Onboarding router + Granite classification | Core product differentiator; judges want to see AI first |
| Musician portal shell + navigation | Required to navigate to any module |
| NextAuth + Supabase auth | Required for multi-user demo; ~1 hour setup |
| Module C — Post Writing (caption gen) | Highest reward-to-effort ratio; pure text, no external APIs |
| Module D — Ghostwriting | Highest AI showcase value; pure Granite + LangFlow chain |
| LangFlow chains for Post Writing + Ghostwriting | Required for judging — shows LangFlow in use |

### BUILD PARTIALLY (functional core, limited polish)
| Feature | Reason |
|---|---|
| Module B — Visual Design | Core loop works (brief → prompt → image); skip history/gallery for now |
| Module A — Instagram Outreach | Draft + send works on demo account; skip scheduling and bulk sends |
| Module A — Concert Finder | API call + Granite annotation works; skip filtering/sorting UI |
| Module A — Calendar | Google Calendar read + create event works; skip recurring events, sync |

### STUB / DEFER
| Feature | Reason |
|---|---|
| Influencer and Video Creator portals | Out of scope; show as locked cards |
| Image history / gallery | Nice-to-have, not core |
| Bulk Instagram outreach | ToS risk; single-DM demo is sufficient |
| TikTok-native posting | API access requires approval; caption generation is enough |
| Advanced meter analysis (syllable counter) | Complex NLP; a basic Granite annotation is sufficient |
| Mobile-responsive design | Desktop-only demo is acceptable for a hackathon |

---

## Phased Milestone Plan (13 Days)

### Phase 1 — Foundation (Days 1–2)
**Goal:** Runnable skeleton — both servers up, auth working, DB connected.

- [ ] Initialize GitHub repo with clear structure (`/frontend`, `/backend`, `/langflow`)
- [ ] Scaffold Next.js App Router project with Tailwind + shadcn/ui
- [ ] Scaffold Python FastAPI project with project layout and health check endpoint
- [ ] Configure Supabase project: auth tables, user_profile table, initial schema
- [ ] Wire NextAuth.js v5 with Supabase adapter (GitHub + Google OAuth)
- [ ] Verify end-to-end: login → session → Supabase user record
- [ ] Set up environment variable management (`.env.local` for Next.js, `.env` for FastAPI)
- [ ] Create GitHub repo, initial commit, README stub

### Phase 2 — AI Core & LangFlow Chains (Days 3–4)
**Goal:** Granite is callable; LangFlow chains for core modules are built and exported.

- [ ] Set up watsonx.ai API credentials; verify Granite 3.x responds from FastAPI
- [ ] Install and run LangFlow locally (or deploy to LangFlow Cloud)
- [ ] Build LangFlow chain: **Creator Profiling** (text → creator type classification)
- [ ] Build LangFlow chain: **Caption Writer** (context inputs → 3 Instagram/TikTok variants)
- [ ] Build LangFlow chain: **Lyric Writer** (multi-turn, genre/theme/scheme → lyrics + annotations)
- [ ] Build LangFlow chain: **Image Brief Interpreter** (user brief → SD prompt)
- [ ] Export all chains as LangFlow REST endpoints
- [ ] FastAPI routes that proxy each LangFlow endpoint with request/response validation

### Phase 3 — Musician Portal Shell + Module C & D (Days 5–7)
**Goal:** The two highest-value modules are demo-ready end-to-end.

- [ ] Build onboarding page: creator-type cards + brief text input + Granite classification call
- [ ] Build musician portal shell: sidebar, module cards dashboard, persistent user context form
- [ ] Build Module C (Post Writing): context form → FastAPI → LangFlow → 3 caption variants + copy button
- [ ] Build Module D (Ghostwriting): multi-turn chat UI → FastAPI → LangFlow → lyrics with annotations + edit loop
- [ ] Persist ghostwriting sessions to Supabase (so user can return to a session)
- [ ] Basic error handling and loading states on all AI calls

### Phase 4 — Module A & B (Days 8–10)
**Goal:** All four modules functional (some partially).

- [ ] Module B (Visual Design): brief form → Granite prompt engineering → HuggingFace SD API → image display + download
- [ ] Store generated images in Supabase Storage; show latest image per session
- [ ] Module A — Google Calendar: OAuth flow, read/display events, create event form
- [ ] Module A — Concert Finder: Ticketmaster API call by city/genre → Granite annotation → ranked list UI
- [ ] Module A — Instagram Outreach: venue/promoter input form → Granite DM draft → Instagrapi send → history log in Supabase
- [ ] Stub Influencer and Video Creator portal pages (locked cards with "Coming Soon" label)

### Phase 5 — Integration, Polish & Deliverables (Days 11–13)
**Goal:** Everything works together; hackathon deliverables are submitted.

- [ ] End-to-end smoke test all four modules
- [ ] Fix critical bugs found during integration testing
- [ ] Write full README: project description, architecture diagram, setup instructions, API key list, demo instructions
- [ ] Deploy Next.js to Vercel; deploy FastAPI to Railway or Render; deploy LangFlow (or point to local for demo)
- [ ] Record 3-minute demo video: onboarding → portal → live demo of Post Writing, Ghostwriting, Visual Design, and one Personal Manager feature
- [ ] Final GitHub push; verify repo is public and README renders correctly
- [ ] Submit to IBM AI Builders Challenge

---

## Technical Risks, Dependencies & Legal Concerns

### Risk 1 — IBM watsonx.ai API Access
**Risk:** watsonx.ai credentials and Granite model access may require approval time or have rate limits that interrupt development.
**Mitigation:** Request API access on Day 1. Keep OpenAI or Ollama (local Llama) as a drop-in fallback LLM during development — swap back to Granite before the demo. LangChain's abstraction makes this a one-line change.

### Risk 2 — LangFlow Chain Stability
**Risk:** LangFlow is evolving rapidly; exported chain REST endpoints can break between versions.
**Mitigation:** Pin LangFlow to a specific version in `requirements.txt`. If a chain's export breaks, fall back to calling Granite directly from FastAPI using LangChain Python — the LangFlow chain can still be shown in the demo video as a diagram.

### Risk 3 — Instagram Automation (Instagrapi) — ToS Violation
**Risk:** Instagrapi uses unofficial Instagram APIs. Sending automated DMs, even from a demo account, risks account suspension and IP blocks. Instagram actively detects automation patterns.
**Mitigation:** Use a throwaway Instagram account created solely for the demo. Never run this against a real artist account. Rate-limit to 1 DM per demo session. Add a visible disclaimer in the UI and README that this is a proof-of-concept. Consider showing a "drafted, not sent" flow in the actual recorded demo to avoid the account being banned mid-recording.

### Risk 4 — Google Calendar OAuth Verification
**Risk:** Google Calendar API requires an OAuth consent screen. For unverified apps, users see a security warning ("This app isn't verified"). Getting verification takes weeks.
**Mitigation:** Add the demo/test account as a test user in Google Cloud Console. Test users bypass the verification warning. This is sufficient for a hackathon demo.

### Risk 5 — Ticketmaster API Rate Limits & Data Quality
**Risk:** The free Discovery API tier has rate limits and may not have comprehensive data for all cities/genres.
**Mitigation:** Cache API responses in Supabase. For the demo, pre-load a city/genre combination that has rich data (e.g., New York, Hip-Hop). If the API is insufficient, fall back to a mock JSON dataset that looks realistic.

### Risk 6 — Stable Diffusion HuggingFace Latency
**Risk:** Free HuggingFace Inference API can have queue times of 30–120 seconds during high load, or the model may be loading ("cold start").
**Mitigation:** Show a loading animation with estimated wait time. If HuggingFace is unavailable during the demo, have a pre-generated image cached in Supabase Storage ready to show as a fallback ("previously generated" mode).

### Risk 7 — Solo Timeline Compression
**Risk:** 13 days is tight for one person covering frontend, backend, AI, 4 external APIs, and a demo video.
**Mitigation:** The MVP scope table above is already pruned to the minimum. If time is lost, the priority order is: Ghostwriting > Post Writing > Visual Design > Personal Manager. The first two modules alone are sufficient for a compelling AI demo.

### Risk 8 — Supabase Free Tier Limits
**Risk:** Supabase free tier pauses projects after 1 week of inactivity and has storage/bandwidth limits.
**Mitigation:** Keep the project active. For images, limit storage to the last 5 generated images per user. Supabase's free tier is more than sufficient for a hackathon.

---

## Key Dependencies (Must Resolve on Day 1)

| Dependency | Action Required |
|---|---|
| IBM watsonx.ai API key + Granite model access | Register at cloud.ibm.com, create a Watson Studio project, copy API key and project ID |
| Supabase project | Create at supabase.com, copy URL and anon key |
| Google Cloud project + Calendar API enabled | Enable Calendar API, create OAuth 2.0 credentials |
| Ticketmaster API key | Register at developer.ticketmaster.com (instant approval) |
| HuggingFace API token | Register at huggingface.co (instant approval) |
| Instagram demo account credentials | Create a throwaway Instagram account |
| LangFlow install | `pip install langflow` or use LangFlow Cloud |
| GitHub repo (public) | Create immediately, push daily |

---

## File / Directory Structure

```
chimera/
├── frontend/                    # Next.js App Router
│   ├── app/
│   │   ├── (auth)/             # Login / signup pages
│   │   ├── onboarding/         # Creator type selection + classification
│   │   ├── portal/
│   │   │   └── musician/
│   │   │       ├── page.tsx    # Module dashboard
│   │   │       ├── manager/    # Personal Manager
│   │   │       ├── visual/     # Visual Design
│   │   │       ├── posts/      # Post Writing
│   │   │       └── ghostwrite/ # Ghostwriting
│   │   └── api/                # Next.js API routes (auth, Supabase)
│   ├── components/             # shadcn/ui + custom components
│   └── lib/                    # Supabase client, auth config, API helpers
│
├── backend/                    # Python FastAPI microservice
│   ├── main.py                 # FastAPI app entry point
│   ├── routes/
│   │   ├── classify.py         # Creator profiling endpoint
│   │   ├── captions.py         # Post Writing endpoint
│   │   ├── ghostwrite.py       # Ghostwriting endpoint
│   │   ├── visual.py           # Visual Design endpoint
│   │   ├── manager.py          # Calendar, outreach, concert finder
│   │   └── health.py           # Health check
│   ├── services/
│   │   ├── langflow_client.py  # LangFlow REST API proxy
│   │   ├── granite.py          # Direct LangChain-IBM Granite calls (fallback)
│   │   ├── instagram.py        # Instagrapi wrapper
│   │   ├── calendar.py         # Google Calendar API wrapper
│   │   └── ticketmaster.py     # Ticketmaster API wrapper
│   └── requirements.txt
│
├── langflow/                   # LangFlow chain exports (JSON)
│   ├── creator_profiling.json
│   ├── caption_writer.json
│   ├── lyric_writer.json
│   └── image_brief.json
│
├── README.md                   # Full setup + architecture doc
└── .env.example                # Template for all required env vars
```

---

## Status Tracking

### Sub-Task 1 — Project Foundation
- **Intent:** Get both servers running, auth working, and Supabase connected.
- **Expected Outcomes:** `npm run dev` starts Next.js; `uvicorn main:app` starts FastAPI; OAuth login persists a user record in Supabase.
- **Status:** [x] done
- **Notes:** `npm run build` passes with zero type errors. FastAPI health endpoint tested in-process. Service token guard verified (no token → 401, wrong token → 401, correct token → 200). Supabase migration SQL is written and ready to run. OAuth requires real credentials in `.env.local` to complete the end-to-end login flow.

### Sub-Task 2 — AI Core & LangFlow Chains
- **Intent:** Establish Granite connectivity and build the four AI chains in LangFlow.
- **Expected Outcomes:** FastAPI can call each LangFlow endpoint and return a valid Granite response.
- **Status:** [ ] pending

### Sub-Task 3 — Onboarding Router & Portal Shell
- **Intent:** User can log in, be classified by Granite, and land on the musician portal.
- **Expected Outcomes:** Onboarding page classifies user → redirects to musician portal → shows four module cards.
- **Status:** [ ] pending

### Sub-Task 4 — Module C: Post Writing
- **Intent:** End-to-end caption generation flow.
- **Expected Outcomes:** User fills form → 3 caption variants appear → copy button works.
- **Status:** [ ] pending

### Sub-Task 5 — Module D: Ghostwriting
- **Intent:** Multi-turn lyric writing assistant with Supabase session persistence.
- **Expected Outcomes:** User can start a lyric session, receive Granite-generated lyrics, edit, and get next-line suggestions; session saved and resumable.
- **Status:** [ ] pending

### Sub-Task 6 — Module B: Visual Design
- **Intent:** Brief → Granite prompt → Stable Diffusion image → display and download.
- **Expected Outcomes:** User submits a brief and receives a generated image; image stored in Supabase Storage.
- **Status:** [ ] pending

### Sub-Task 7 — Module A: Personal Manager
- **Intent:** Google Calendar integration, Instagram outreach, and Ticketmaster concert finder.
- **Expected Outcomes:** Each of the three sub-features is independently functional on the demo account.
- **Status:** [ ] pending

### Sub-Task 8 — Integration, Deployment & Deliverables
- **Intent:** Ship the product — deployed, documented, and recorded.
- **Expected Outcomes:** Public GitHub repo with full README; deployed and accessible prototype; 3-minute demo video recorded and uploaded.
- **Status:** [ ] pending
