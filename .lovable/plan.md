# VEO360 AutoTag — Hackathon Prototype

Industrial B2B SaaS demo: synthetic data generation, mocked training, 360° digital twin with auto-tag hotspots, review queue, asset library.

## Design
- Primary #1BA6E8, background #E9EEF5, text #4A4F57, white cards, Inter font (loaded via link in root head).
- Tokens defined in styles.css (oklch), shadcn components, left sidebar layout in root.

## Pages (each its own route with unique head metadata)
- `/` Dashboard — before/after card (manual vs automatic tagging time), KPI tiles, "Demo mode" button.
- `/synthetic` — drag & drop image, augmentation controls (brightness, contrast, rotation, skew, scale, noise, blur, occlusion, label wear, background), N variants generated on canvas, grid with per-image params, ZIP download (JSZip) with images + labels.json; bounding box tracked through transforms (corners transformed by the same matrix, then axis-aligned box).
- `/training` — stat cards, Recharts loss/accuracy line chart, prediction cards with boxes + OCR text.
- `/twin` — Pannellum 360° viewer (client-only, loaded dynamically), default switchgear panorama (generated image), upload own panorama. Hotspots colored by confidence, "Show auto-tags" toggle, tagged/need-review counter. Click opens right Sheet: asset name, OCR code, confidence bar, cropped label, documents (mock PDFs), maintenance timeline, spare parts table, lifecycle badge, Confirm / Edit / Create support ticket.
- `/review` — table of detections < 0.8 with Approve / Edit / Reject; approving updates shared state seen by the viewer.
- `/assets` — searchable asset type table (615 relay, LV switchgear section, circuit breaker, meter) with documents and site count.

## Demo mode
Guided overlay stepping Synthetic → Training → Twin with highlighted callouts and Next/Exit.

## Technical details
- Mock data in `src/data/*` (detections, assets, training metrics, maintenance, parts). Mock PDFs in `public/docs/`.
- `src/lib/api.ts`: `getDetections(siteId)` (mock now, documented swap to POST /api/detect), `matchAsset(ocrText)` via Fuse.js.
- Shared detection state in a small React context/zustand-like store (in-memory) so Review and Twin stay in sync.
- Deps: jszip, fuse.js, pannellum, recharts (shadcn chart).
- No backend; all client-side.
