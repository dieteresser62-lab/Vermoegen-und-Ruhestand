// JD-1 Nachtrag 2, Befund 2: Vor jedem Monte-Carlo-Start werden Inhaltshash und Randjahre gegen den Datenstand geprüft,
// zusammen mit der Regimeverteilung. Gegenproben aus dem Gutachten im Speicher eines Kindprozesses; die Dateien bleiben.
import { spawnSync } from 'node:child_process';
import { HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';

console.log('--- Historical Data Monte Carlo Preflight Tests ---');

const root = new URL('../', import.meta.url);
function probe(override) {
    const run = spawnSync(process.execPath, ['--import', './tests/helpers/historical-datenstand-override-register.mjs', './tests/helpers/mc-preflight-probe.mjs'], {
        cwd: root, encoding: 'utf8', env: { ...process.env, JD1_DATENSTAND_OVERRIDE: override ? JSON.stringify(override) : '' }
    });
    assertEqual(run.status, 0, `Probe läuft durch: ${run.stderr}`);
    return JSON.parse(run.stdout.trim().split('\n').at(-1));
}

console.log('Test 1: gültiger Datenstand startet unverändert');
const valid = probe(null);
assertEqual(valid.stand.contentHash, HISTORICAL_DATENSTAND.contentHash, 'Probe nutzt den eingebetteten Datenstand');
assertEqual(JSON.stringify(valid.worker.map(message => message.type)), '["ready"]', 'Worker-Init meldet bereit');
assertEqual(valid.preflight.ok, true, 'Vorprüfung besteht');

console.log('Test 2: nur das Endjahr im Datenstand auf das Folgejahr gesetzt');
const endYear = probe({ endYear: HISTORICAL_DATENSTAND.endYear + 1 });
assertEqual(endYear.stand.endYear, HISTORICAL_DATENSTAND.endYear + 1, 'Override greift');
assertEqual(endYear.worker[0]?.type, 'error', 'Worker-Init bricht ab');
assert(endYear.worker[0]?.message.startsWith('SIMULATOR_HISTORICAL_DATA_CONTRACT:') && endYear.worker[0].message.includes('HISTORICAL_DATASET_INVALID'),
    'Worker meldet abweichende Randjahre');
assertEqual(endYear.preflight.code, 'SIMULATOR_HISTORICAL_DATA_CONTRACT', 'Vorprüfung bricht ab');
assertEqual(endYear.preflight.causeCode, 'HISTORICAL_DATASET_INVALID', 'Ursache sind die Randjahre');

console.log('Test 3: Inhaltshash aus Nullen');
const zeroHash = probe({ contentHash: '0'.repeat(64) });
assertEqual(zeroHash.stand.contentHash, '0'.repeat(64), 'Override greift');
assertEqual(zeroHash.worker[0]?.type, 'error', 'Worker-Init bricht ab');
assert(zeroHash.worker[0]?.message.includes('HISTORICAL_DATA_HASH_MISMATCH'), 'Worker meldet abweichenden Hash');
assertEqual(zeroHash.preflight.code, 'SIMULATOR_HISTORICAL_DATA_CONTRACT', 'Vorprüfung bricht ab');
assertEqual(zeroHash.preflight.causeCode, 'HISTORICAL_DATA_HASH_MISMATCH', 'Ursache ist der Hash');

console.log('✅ Historical data Monte Carlo preflight tests passed');
