# Phase 0 Repository Reconnaissance

## Workspace State
- Repository root: `c:\greg_n_friends`
- Git branch: `main` (commit `93a888d Initial commit`, remote: none)
- Tracked files prior to WildPulse scaffolding:
  - `.gitattributes` (`* text=auto` LF normalization)
- Legacy scripts, workflows, or existing data pipelines: **None** (greenfield TypeScript repository). Zero existing functionality to displace.

## Host Environment & Toolchain
- Operating System: Windows
- Node.js runtime: `v22.23.5` and npm `10.9.9` at `C:\Users\alexg\AppData\Local\nodejs-v22` (note: not pre-populated in fresh subshell `$env:PATH`, so scripts/shells prepend `C:\Users\alexg\AppData\Local\nodejs-v22`).
- Headless Browser Binaries: Playwright Chromium binaries present in `$env:LOCALAPPDATA\ms-playwright` (`chromium-1248`, `chromium_headless_shell-1248`), plus system Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`).

## Live Upstream API & CORS Verification (Executed During Reconnaissance)
1. **Movebank Outbound REST API** (`https://www.movebank.org/movebank/service/public/json`):
   - Public query confirmed `200 OK` on study `2911040` (*Phoebastria irrorata*, Galápagos Albatrosses, individual `4262-84830876`, `sensor_type=gps`).
   - Confirmed unqueued parallel hits immediately trigger `429` rate limiting (`"You have triggered a rate limiting mechanism"`), and responses omit CORS headers—validating the server-side `maxConcurrency = 1` serialized FIFO mutex queue (`minIntervalMs >= 450`) and disk/memory TTL cache.
2. **IOOS Animal Telemetry Network (ATN) ERDDAP** (`https://atn.ioos.us/erddap/`):
   - Confirmed `200 OK` WITH `Access-Control-Allow-Origin` CORS headers, making it viable both server-side and directly from static GitHub Pages browsers.
   - Fast per-deployment trajectory tables verified (`<250ms` response with `&orderByLimit("160")`):
     - `atn_174822_spotted-seal_trajectory_20180414-20181103` (*Phoca largha*, NOAA Alaska Fisheries Science Center)
     - `atn_94821_blainvilles-beaked-whale_trajectory_20091221-20100111` (*Mesoplodon densirostris*, Cascadia Research Collective)
     - `atn_85568_short-finned-pilot-whale_trajectory_20080705-20080802` (*Globicephala macrorhynchus*, Cascadia Research Collective)
   - Note: Avoid unconstrained `stanford_import_ssm_public` queries without tight filters due to table scan timeout risk.
3. **Keyless Enrichment & Basemap Providers** (all confirmed `200 OK`):
   - `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json`
   - `https://api.open-meteo.com/v1/forecast`
   - `https://marine-api.open-meteo.com/v1/marine`
   - `https://api.inaturalist.org/v1/taxa`
   - `https://api.gbif.org/v1/species/match`
   - `https://en.wikipedia.org/api/rest_v1/page/summary/<Scientific_name>`
   - `https://api.bigdatacloud.net/data/reverse-geocode-client`

## Security & Secret Hygiene
- Credentials (`MOVEBANK_USERNAME`, `MOVEBANK_PASSWORD`) and runtime settings (`PORT`, `CACHE_TTL_MINUTES`, `GITHUB_PAGES_BASE`) are loaded strictly from environment variables (`process.env`) and GitHub Actions Secrets, documented in `.env.example`, and excluded from Git via `.gitignore`.
