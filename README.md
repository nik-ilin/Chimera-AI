<div align="center">

# Chimera

**A digital record label for artists who don't have one.**

![Chimera](https://github.com/nik-ilin/Chimera-AI/blob/master/main%20photo.png)

</div>

---

> **Status:** in active development.
>
> The AI layer runs on IBM Granite through watsonx. Granite is a small open model, which keeps running costs low but also caps output quality; longer generations come out rougher than they would on a larger commercial model.
>
> **Coming soon:** an Influencer module, a Video creator module, and support for stronger image and video generation models.

## Why

Most independent musicians write their own songs, shoot their own content, book their own shows and manage their own calendar. A signed artist gets a team for all of that.

Chimera is an attempt to close that gap: a single portal that covers the work of a manager, a copywriter, a graphic designer and a booking agent. Everything it produces is based on your artist profile, so the output changes depending on who is using it.

It is built for independent and emerging artists releasing music without a label, a manager or a marketing team behind them.

## Modules

Each module maps to a real role inside a traditional label.

### ✅ Ghostwriting

A writing assistant for lyrics. It reads the rhyme scheme and meter of what you have already written, and suggests lines that fit the pattern.

### ✅ Post Writing

Captions and copy for Instagram and TikTok, written from your artist profile so they carry your voice rather than a generic one.

### 🚧 Personal Manager

Calendar, tour dates and bookings in one place. It syncs with Google Calendar and CalDAV, and confirmed dates feed into a map and a running budget.

### 🚧 Visual Design

Cover art and promotional images, generated from the release, its genre and the visual identity you already use.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router), auth via GitHub / Google / email |
| Backend | Python (FastAPI) |
| Database | Supabase (Postgres) with row-level security |
| AI core | IBM Granite via watsonx |
| Orchestration | LangChain + LangFlow |

**Why Granite.** The model is open and IBM documents its training data, which matters when the input is unreleased material. It is also inexpensive to run, which keeps the tool free for the artists using it.

LangChain and LangFlow handle orchestration between the modules, so context from one is available to the others.

## Repo structure

```
chimera/
├── frontend/          Next.js app
│   └── src/app/
│       └── portal/    The four modules
├── backend/           FastAPI service
│   ├── db/migrations/ Run these in order
│   └── main.py
├── langflow/          Chain definitions
└── docs/
```

## Getting started

**Requirements:** Node.js 20+, Python 3.11+, a Supabase project, and an IBM Cloud account with watsonx access.

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/chimera.git
cd chimera
```

### 2. Database

Run the migrations in `backend/db/migrations/` against your Supabase project, in order, via the Supabase SQL editor.

### 3. Backend

Start here: the frontend will not work without it.

```bash
cd backend
cp .env.example .env          # fill in the values — each one is documented in the file
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
... (32 líneas restantes)
