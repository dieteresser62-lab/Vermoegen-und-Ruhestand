/** Ausschließlich synthetische Haushalte; Laufzeit ohne Modul-Ladezeit. */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { projectNextYearBudget } from '../app/balance/balance-next-year-budget.js';
import { fjFixture, fixtureNow } from '../tests/helpers/fj-1-fixtures.mjs';

const measurements = {};
for (const id of ['max-erika', 'renate']) {
    const storage = fjFixture(id), elapsed = [];
    for (let iteration = 0; iteration <= 20; iteration++) {
        const start = performance.now();
        const result = projectNextYearBudget({ storage, engineApi: EngineAPI, now: fixtureNow });
        elapsed.push(performance.now() - start);
        if (result.state === 'not_reliable') throw new Error('Synthetische Projektion nicht auswertbar.');
    }
    measurements[id] = { people: Object.keys(JSON.parse(storage.getItem('rs_profiles_v1')).profiles).length,
        calls: elapsed.length, firstMs: elapsed[0], meanMs: elapsed.slice(1).reduce((a, b) => a + b, 0) / 20,
        maxMs: Math.max(...elapsed), thresholdMs: 300 };
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(measurements, null, 2) + '\n');
console.log(JSON.stringify(measurements));
