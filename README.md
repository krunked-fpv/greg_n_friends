# WildPulse // Bio-Telemetry Command Deck

WildPulse is an isomorphic Conservation Mission Control and live wildlife bio-telemetry portal built for **Greg**. It tracks tagged avian, marine, terrestrial mammal, and reptile expeditions across an antimeridian-safe MapLibre GL JS viewport, pairs 60fps temporal playback with derived bio-kinematics, and displays honest feed provenance and researcher attribution on every animal record.

---

## Dual-Mode Architecture

WildPulse operates seamlessly in two deployment topologies from a single codebase and relative `./` asset graph:

1. **Local Full-Stack Mode (`npm run dev` or `npm start`)**
   - Runs an Express + TypeScript telemetry proxy (`127.0.0.1:3001`) alongside the Vite React/MapLibre HUD (`127.0.0.1:5173`).
   - Serializes outbound Movebank REST requests through a strict 1-concurrent-request FIFO mutex queue (`minIntervalMs >= 450`, in-flight request coalescing, and `Retry-After` backoff), backed by a 2-tier memory + disk TTL cache (`.cache/telemetry/*.json`).
   - Supports on-demand **Movebank Study ID importing**, optional **Movebank Direct-Read** Basic Auth credentials, interactive **`license-md5` study terms handshakes**, and live **IOOS ATN ERDDAP** marine tracks.

2. **GitHub Pages Unleashed Mode (`GITHUB_PAGES_BASE=./`)**
   - Runs purely as a subpath-portable static bundle (`https://<user>.github.io/<repo>/`) with zero backend proxy required.
   - Hydrates `./data/ci-live-snapshot.json` refreshed every 6 hours by GitHub Actions, queries CORS-enabled live endpoints directly from the browser (IOOS ATN ERDDAP, Open-Meteo Weather & Marine, iNaturalist, GBIF, Wikipedia REST, BigDataCloud reverse-geocode), runs batch kinematics & interpolation inside a dedicated WebWorker, and falls back gracefully to `./data/fallback-fleet.json`.

```text
+----------------------------------------------------------------------------------+
|                       WILDPULSE DUAL-MODE COMMAND DECK                           |
+----------------------------------------------------------------------------------+
|                                                                                  |
|  Browser HUD (React + MapLibre GL JS + 60fps playbackClock + Kinematics Worker)  |
|   |-- Relative asset resolution via document.baseURI / import.meta.env.BASE_URL  |
|   |-- Enrichment (CORS): Open-Meteo, Marine, iNaturalist, GBIF, Wikipedia, Geo   |
|   v                                                                              |
|  +--------------------------- 4-Tier Telemetry Waterfall ---------------------+  |
|  | [Tier 1] ./api/health -> ./api/fleet & ./api/studies/:id (Local Proxy)     |  |
|  |    |-> Express Proxy (127.0.0.1:3001): FIFO Queue (maxConcurrency=1)       |  |
|  |    |   + 2-Tier TTL Cache (.cache/telemetry) + Movebank license-md5        |  |
|  |    `-> 404/Timeout on Static Host -----------------------------------+    |  |
|  |                                                                       v    |  |
|  | [Tier 2] ./data/ci-live-snapshot.json  (CI 6h Harvest: CACHED)             |  |
|  |    +                                                                       |  |
|  | [Tier 3] https://atn.ioos.us/erddap/... (Browser-Direct CORS: LIVE API)    |  |
|  |    +                                                                       |  |
|  | [Tier 4] ./data/fallback-fleet.json    (10-Animal Seed Archive: DEMO FEED) |  |
|  +----------------------------------------------------------------------------+  |
+----------------------------------------------------------------------------------+
```

---

## Local Full-Stack Quickstart

### Prerequisites
- **Node.js 22+** and **npm 10+**

### 1. Install Dependencies & Start Dev Mode
```bash
npm install
npm run dev
```
- **Frontend HUD**: `http://127.0.0.1:5173/` (Vite proxies `./api/*` -> `http://127.0.0.1:3001`)
- **Express Telemetry Proxy**: `http://127.0.0.1:3001/api/health`

### 2. Optional Environment Configuration (`.env`)
Copy `.env.example` to `.env` when customizing ports, cache TTL, or Movebank Direct-Read credentials (never commit `.env`):

```env
PORT=3001
CACHE_TTL_MINUTES=30
MOVEBANK_USERNAME=
MOVEBANK_PASSWORD=
GITHUB_PAGES_BASE=./
```

### 3. Production Build & Subpath Verification
```bash
# Typecheck client + server and bundle ./dist with relative paths
npm run build

# Run full-stack production server (Express serves ./dist + /api/*)
npm start

# OR test GitHub Pages project subpath behavior locally (/wildpulse/, /api/* -> 404)
node scripts/serve-subpath-preview.mjs
# Open http://127.0.0.1:4273/wildpulse/ (override port with SUBPATH_PORT)
```

### Additional Scripts
| Command | Purpose |
| :--- | :--- |
| `npm run seed:generate` | Regenerate the 10-animal, 1,500-fix `public/data/fallback-fleet.json` archive |
| `npm run harvest:telemetry` | Run `TelemetryProvider` to produce `public/data/ci-live-snapshot.json` |
| `npm run typecheck` | Run strict TypeScript checks (`tsconfig.app.json` + `tsconfig.server.json`) |
| `npm test` | Execute the Vitest unit test suite |
| `npm run test:e2e` | Run Playwright end-to-end verification |

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `[` | Toggle Left Fleet Discovery Panel |
| `]` | Toggle Right Animal Bio-Dossier Drawer |
| `Space` | Play / Pause Migration Playback *(ignored while typing in inputs or textareas)* |
| `F` | Toggle Follow-Cam tracking on active individual |
| `Esc` | Close Study Importer modal or clear active selection |
| `1` – `4` | Switch Basemaps: `1` Dark Tactical, `2` Satellite, `3` Terrain, `4` Ocean Bathymetry |

---

## Optional Movebank Direct-Read Credentials

WildPulse works immediately without credentials using Movebank's Public JSON API, IOOS ATN ERDDAP marine deployments, and the scientific seed fleet. To unlock private or permission-gated Movebank studies via HTTP Basic Auth:

- **Local Proxy**: Populate `MOVEBANK_USERNAME` and `MOVEBANK_PASSWORD` in `.env`.
- **GitHub Actions CI Snapshot**: Add `MOVEBANK_USERNAME` and `MOVEBANK_PASSWORD` under **Settings -> Secrets and variables -> Actions** in your repository.

If those secrets are unset, `.github/workflows/deploy-pages.yml` passes empty values safely and harvests all public Movebank and IOOS ATN ERDDAP telemetry without failing.

---

## Movebank `license-md5` Study Importer Guide

Because Movebank's REST API omits browser CORS headers and enforces strict rate limits, custom study imports route through the Local Express Proxy (`GET /api/studies/:studyId`):

1. Click **Import Movebank Study** in the Left Fleet Discovery Panel (or start with featured public study **`2911040`** — *Galápagos Albatrosses*, *Phoebastria irrorata*).
2. Enter a numeric Movebank Study ID and submit.
3. If the study enforces researcher license terms, Movebank withholds event coordinates and returns the license agreement text. WildPulse detects this state (`diagnosticStatus: LICENSE_REQUIRED`), hashes the raw UTF-8 terms text into `licenseMd5`, and opens the **Study Terms Confirmation Drawer**.
4. Review the license terms and MD5 digest, then click **Accept License Terms & Load Tracks**. WildPulse replays `GET /api/studies/:studyId?licenseMd5=<hex>`, which forwards `&license-md5=<hex>` to Movebank and merges the normalized tracks into the active fleet.
5. Other explicit diagnostics surfaced in the modal:
   - `AUTH_REQUIRED` (HTTP `401`/`403`): Study requires Movebank Direct-Read credentials in `.env`.
   - `TAG_SILENT`: Valid study metadata returned, but `0` geolocated fixes are currently available.
   - `RATE_LIMITED` (HTTP `429`): Upstream Movebank cooldown triggered; retry after the reported backoff window.

---

## 4-Tier Telemetry Waterfall & Enrichment APIs

Every animal card and Bio-Dossier displays its exact provenance badge (`LIVE API`, `CACHED`, or `DEMO FEED`) and researcher attribution (`studyTitle`, `principalInvestigators`, `institution`, `studyUrl`, `licenseTerms`):

| Tier / Service | Source & Endpoint | Role in WildPulse |
| :--- | :--- | :--- |
| **Tier 1 (Proxy)** | `./api/health`, `./api/fleet`, `./api/studies/:studyId`, `./api/atn/marine` | Local Express Mission Control with serialized Movebank queue & disk/memory TTL cache (`PROXY_LIVE`) |
| **Tier 2 (CI Snapshot)** | `./data/ci-live-snapshot.json` | 6-hour scheduled GitHub Actions telemetry snapshot (`CACHED` / `CI_SNAPSHOT`) |
| **Tier 3 (Browser CORS)** | IOOS ATN ERDDAP (`https://atn.ioos.us/erddap/`) | Direct browser marine deployments (NOAA AFSC & Cascadia Research Collective) (`LIVE_API`) |
| **Tier 4 (Seed Fallback)** | `./data/fallback-fleet.json` | 10 multi-guild animals (1,500 fixes, `±180°` antimeridian crossings, dive/altitude profiles) (`DEMO_FEED`) |
| **Weather & Marine** | Open-Meteo Forecast & Open-Meteo Marine | Ambient air temp, wind speed/direction, pressure, elevation, SST, wave height, ocean currents |
| **Species Ecology** | iNaturalist, GBIF, Wikipedia REST Summary API | Verified taxonomic hierarchy, species photography, conservation extracts, IUCN context |
| **Location & Solar** | BigDataCloud Reverse Geocode + Solar Math | Region/ocean basin labels and deterministic solar elevation & phase (`Daylight`, `Twilight`, `Night`) |
| **Map Basemaps** | CARTO Dark Matter, Esri World Imagery/Ocean, OpenTopoMap | 4 keyless MapLibre GL JS styles preserving active telemetry layers across switches |

---

## GitHub Pages Activation Instructions

`.github/workflows/deploy-pages.yml` automates telemetry harvesting, testing, building, and OIDC deployment on `push` to `main`/`master`, manual `workflow_dispatch`, and every 6 hours (`cron: '0 */6 * * *'`).

1. **Enable GitHub Pages via Actions**:
   - Open your GitHub repository -> **Settings** -> **Pages**.
   - Under **Build and deployment**, set **Source** to **GitHub Actions**.
2. **(Optional) Configure Movebank Secrets**:
   - Open **Settings** -> **Secrets and variables** -> **Actions**.
   - Add `MOVEBANK_USERNAME` and `MOVEBANK_PASSWORD` if your deployment harvests private Movebank Direct-Read studies.
3. **Run or Push**:
   - Push to `main` (or `master`), or navigate to **Actions** -> **Harvest Telemetry & Deploy GitHub Pages** -> **Run workflow**.
4. **Verify Subpath Portability Locally**:
   ```bash
   GITHUB_PAGES_BASE=./ npm run build
   node scripts/serve-subpath-preview.mjs
   ```
   Browse to `http://127.0.0.1:4273/wildpulse/` and verify all `./data/*.json` assets and `./favicon.svg` load with zero 404s while `/api/*` and `/` return `404`.
