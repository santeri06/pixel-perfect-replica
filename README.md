# Pixel Perfect Replica

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/652a1bc2-1e39-4437-bcbc-e4d1b9906336).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Maintenance log (demo)

Maintenance entries belong to a **physical device**, never to a detection: the image tells the
type ("615"), the device comes from its position and the device register (component list).
**All register and maintenance data is example data stored in the browser** (`isDemo`,
"Example data" badge). Only device positions/anchors come from the CV data.

| Part | File |
|---|---|
| Data model, zod rules | `src/data/maintenance.ts`, `src/data/maintenance.schema.ts` |
| Device register (demo component list + seed history) | `src/data/registry.generated.json` (+ identical `public/field/registry.json`) |
| Register generator | `scripts/build-registry.mjs` |
| Detection → device linking | `src/lib/resolveInstance.ts` (run once on load in `src/lib/store.tsx`) |
| Local storage repository + React hook | `src/lib/maintenanceLocal.ts`, `src/lib/useMaintenance.ts` |
| UI | `src/components/MaintenanceLog.tsx`, `MaintenanceForm.tsx`, `MaintenanceSummary.tsx` (Dashboard), `AssetSheet.tsx` |
| Field App (standalone, no shared code) | `public/field/index.html` |

**When the CV data (`src/data/detections.json`) changes, regenerate the register:**

```sh
node scripts/build-registry.mjs        # or: npm run registry / bun run registry
```

The generator triangulates detections from different scan points into physical devices
(closest approach of the viewing rays + least-squares point), registers up to 5 relays that
have an auto-tagged detection (`--max N` to change), and keeps device IDs, variants and demo
history stable across reruns (matched by 3D position within 0.3 m). `--fresh` starts over.

**Field App:** open `/field/index.html` (or *Open in Field App* on a device in the Digital Twin,
which opens `/field/index.html?asset=<deviceId>`). It shares `localStorage["veo.maintenance.v1"]`
with AutoTag, so the demo works in **two tabs of the same browser** with no network. A phone on
another device needs an API (not in this build). *Settings* in the Field App resets the demo data.

Demo test: Twin → Panel 01 relay (Overdue) → *Open in Field App* → New entry → Save → confirm
device → the AutoTag tab updates without reload, Overdue disappears (also on the Dashboard),
other relays are unchanged, and the entry survives a page reload.
