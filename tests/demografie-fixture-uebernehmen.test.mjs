import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'demografie-fixture-'));
try {
    const script = join(dir, 'scripts', 'demografie-fixture-uebernehmen.mjs');
    const fixtureDir = join(dir, 'tests', 'fixtures');
    const fixture = join(fixtureDir, 'minimum-flex-severe-affordability-measurement-v1.json');
    const log = join(dir, 'aufnahme.log');
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(fixtureDir, { recursive: true });
    copyFileSync(new URL('../scripts/demografie-fixture-uebernehmen.mjs', import.meta.url), script);

    const before = [
        '{',
        '  "backtest": {',
        '    "wert": 1',
        '  },',
        '  "demography": {',
        '    "schemaVersion": "MinimumFlexSevereAffordabilityDemographyMeasurementV1",',
        '    "targetSummary": {',
        '      "messwert": 1',
        '    }',
        '  }',
        '}',
        ''
    ].join('\n');
    const after = before.replace('"messwert": 1', '"messwert": 2');
    const marker = '__MINIMUM_FLEX_AFFORDABILITY_DEMOGRAPHY_';
    const block = [
        marker + 'START__',
        '{"schemaVersion":"MinimumFlexSevereAffordabilityDemographyMeasurementV1","targetSummary":{"messwert":2}}',
        marker + 'END__'
    ];

    for (const eol of ['\n', '\r\n']) {
        writeFileSync(fixture, before);
        writeFileSync(log, ['Lauf gestartet', ...block, 'Lauf beendet', ''].join(eol));
        const result = spawnSync(process.execPath, [script, log], { encoding: 'utf8' });
        if (result.error) throw result.error;
        assertEqual(result.status, 0, 'Die synthetische Aufnahme lässt sich übernehmen');
        assertEqual(readFileSync(fixture, 'utf8'), after, 'Nur die Demografie ändert sich, mit Einrückung und LF wie in der Fixture');
    }

    for (const badBlock of [block.slice(0, 2), [...block, ...block], [block[0], '{', block[2]]]) {
        writeFileSync(log, badBlock.join('\n'));
        const result = spawnSync(process.execPath, [script, log], { encoding: 'utf8' });
        if (result.error) throw result.error;
        assertEqual(result.status, 1, 'Ein unvollständiger, doppelter oder ungültiger Messblock scheitert');
        assertEqual(readFileSync(fixture, 'utf8'), after, 'Bei einem ungültigen Log bleibt die Fixture bytegleich');
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}
