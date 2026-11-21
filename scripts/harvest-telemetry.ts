import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FleetResponse } from '../src/types/telemetry.ts';
import { TelemetryProvider } from '../server/telemetryProvider.ts';

async function loadExistingSnapshot(outPath: string): Promise<FleetResponse | null> {
  try {
    const raw = await fs.readFile(outPath, 'utf8');
    const parsed = JSON.parse(raw) as FleetResponse;
    if (parsed && Array.isArray(parsed.animals) && parsed.animals.length > 0) {
      return parsed;
    }
  } catch {
    // No existing snapshot yet.
  }
  return null;
}

async function main(): Promise<void> {
  const outPath = path.resolve(
    process.cwd(),
    'public',
    'data',
    'ci-live-snapshot.json',
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const provider = new TelemetryProvider();
  const { fleet, warnings } = await provider.harvestUpstreamSnapshot();

  for (const warn of warnings) {
    console.warn(`[harvest:telemetry] Warning: ${warn}`);
  }

  let outputFleet = fleet;

  // If all upstreams were temporarily throttled/offline, preserve any prior valid snapshot
  // or write a valid empty CI_SNAPSHOT structure cleanly without failing CI.
  if (fleet.animals.length === 0) {
    const existing = await loadExistingSnapshot(outPath);
    if (existing) {
      outputFleet = {
        ...existing,
        generatedAt: fleet.generatedAt,
        connectionMode: 'CI_SNAPSHOT',
      };
      console.warn(
        `[harvest:telemetry] Upstream unavailable; preserved ${existing.animals.length} previously harvested tracks.`,
      );
    } else {
      console.warn(
        '[harvest:telemetry] Upstream returned 0 tracks; wrote empty CI_SNAPSHOT envelope cleanly.',
      );
    }
  }

  await fs.writeFile(
    outPath,
    `${JSON.stringify(outputFleet, null, 2)}\n`,
    'utf8',
  );

  const totalFixes = outputFleet.animals.reduce((sum, a) => sum + a.fixes.length, 0);
  console.log(
    `[harvest:telemetry] Wrote ${outputFleet.animals.length} animal(s) (${totalFixes} fixes) to ${outPath}`,
  );
}

main().catch((err) => {
  console.error('[harvest:telemetry] Unexpected failure:', err);
  process.exitCode = 1;
});
