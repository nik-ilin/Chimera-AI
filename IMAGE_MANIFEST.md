# Chimera — Image Manifest (Phase 3 / Stage B)

Every generated-image slot in the UI is rendered by `<ImagePlaceholder>`
(`frontend/src/components/ImagePlaceholder.tsx`) until a real asset exists.

## How to swap a placeholder for a real image
1. Generate the PNG per the spec below.
2. Drop it into **`frontend/public/images/<id>.png`**.
3. In the file/line listed, add one prop: `src="/images/<id>.png"`.
   (The placeholder already reserves the exact dimensions/aspect, so the
   layout does not shift.)

Reference material for art direction lives in the repo-root `images/` folder —
those are **direction only**, never to be reproduced.

## Placeholders

| id | used in | aspect | orientation | description (subject · mood) |
|----|---------|--------|-------------|------------------------------|
| `landing-hero` | `frontend/src/app/page.tsx` (hero) | 4/5 | portrait | Abstract editorial artwork evoking an AI-native record label — layered light, chromatic ink bloom on warm paper. Calm, premium, mysterious. |
| `landing-texture` | `frontend/src/app/page.tsx` (footer band) | 16/6 | wide | Soft grain/gradient texture strip in cream→clay tones. Subtle, decorative, no subject. |
| `onboarding-aside` | `frontend/src/app/onboarding/OnboardingClient.tsx` (aside) | 3/4 | portrait | Quiet conceptual image of a lone creator/instrument silhouette in warm light. Editorial, contemplative. |
| `portal-avatar` | `frontend/src/app/portal/musician/page.tsx` (profile block) | 1/1 | square | User avatar fallback — abstract warm gradient monogram tile. |
| `module-posts` | `frontend/src/app/portal/musician/page.tsx` (Post Writing card) | 4/3 | landscape | Caption/typography motif — fragments of social copy on paper. Warm, tactile. |
| `module-ghostwrite` | `frontend/src/app/portal/musician/page.tsx` (Ghostwriting card) | 4/3 | landscape | Lyric sheet / handwritten verse motif under warm light. Intimate. |
| `module-visual` | `frontend/src/app/portal/musician/page.tsx` (Visual Design card, locked) | 4/3 | landscape | Album-cover art-direction collage. Muted, cinematic. |
| `module-manager` | `frontend/src/app/portal/musician/page.tsx` (Manager card, locked) | 4/3 | landscape | Calendar/agenda + city-gig motif. Organised, calm. |
| `posts-empty` | `frontend/src/app/portal/musician/posts/PostWritingClient.tsx` (empty state) | 1/1 | square | Minimal decorative mark inviting a first caption. Light, playful. |
| `ghostwrite-empty` | `frontend/src/app/portal/musician/ghostwrite/GhostwriteClient.tsx` (empty state) | 1/1 | square | Minimal decorative mark for the blank lyric session. Intimate, warm. |

_Total: 10 placeholders. All render as labelled neutral boxes until swapped._
