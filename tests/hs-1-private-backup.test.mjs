import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';

const dir = await mkdtemp(join(tmpdir(), 'hs1-private-test-'));
try {
    for (const valid of [true, false]) {
        const file = join(dir, 'synthetic.json');
        const payload = buildFullPersistenceBackup({ storage: { exportAllSync: () => ({ records: createMusterHaushaltRecords('2026-10-29', 'max-erika') }) } });
        await writeFile(file, valid ? JSON.stringify(payload) : '{synthetic-secret-do-not-print');
        const result = spawnSync(process.execPath, ['scripts/check-hs1-backup.mjs', file], { encoding: 'utf8' });
        if (result.error) throw new Error('Synthetischer Prüfprozess konnte nicht gestartet werden.');
        assertEqual(result.status, valid ? 0 : 1, 'HS-1 private Probe prüft Erfolg und gesäuberten Fehler');
        assertEqual(result.stderr, '', 'HS-1 private Probe gibt keine Fehlermeldung mit Daten aus');
        const [metadata, comparison] = result.stdout.trim().split('\n');
        const counts = JSON.parse(metadata);
        assert(Object.entries(counts).every(([key, value]) => /Hash$/.test(key)
            ? /^[0-9a-f]{64}$/.test(value) : Number.isInteger(value)), 'HS-1 Ausgabe enthält ausschließlich Prüfsummen und Zählwerte');
        assertEqual(comparison, valid ? 'alt = neu' : undefined, 'HS-1 nur erfolgreiche Bytegleichheit wird bestätigt');
    }
} finally { await rm(dir, { recursive: true }); }
