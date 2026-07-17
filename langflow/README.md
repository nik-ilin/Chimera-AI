# LangFlow Chain Exports

This directory stores exported LangFlow chain JSON files.
Each chain is exported from the LangFlow UI and committed here for reproducibility.

## Chains (Phase 2)

| File | Task ID | Status |
|---|---|---|
| `creator_profiling.json` | `classify_creator` | ⬜ Pending Phase 2 |
| `caption_writer.json` | `write_captions` | ⬜ Pending Phase 2 |
| `lyric_writer.json` | `write_lyrics` | ⬜ Pending Phase 2 |
| `image_brief.json` | `build_image_brief` | ⬜ Pending Phase 2 |

## How to use

1. Start LangFlow: `langflow run` (or use LangFlow Cloud)
2. Import a JSON file via **Upload Flow** in the LangFlow UI
3. Iterate on the chain, then re-export and commit the updated JSON
4. FastAPI calls the chain's REST endpoint via `backend/services/langflow_client.py`

## Naming convention
`{task_id}.json` — matches the task IDs in CONVENTIONS.md §4.
