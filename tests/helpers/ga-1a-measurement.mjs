// Synthetisch, sequenziell, fester Seed; vollständige Ergebnisbytes ohne Feldfilter.
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EngineAPI } from '../../engine/index.mjs';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { quantile } from '../../app/simulator/simulator-utils.js';
import { measurementInputs, backtest, parameters, hash } from './ek-1b-measurement.mjs';

export async function measureExpenses(items, count = 2000) {
    const inputs = await measurementInputs();
    if (items.length) Object.assign(inputs, { plannedExpenses: items, plannedExpensesReferenceYear: 2026 });
    const historical = backtest(inputs);
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: { ...parameters, anzahl: count }, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start: 0, count }, engine: EngineAPI });
    const technicalError = chunk.technicalInventory.technicalError;
    const real = [...chunk.pathSummaries.finalValueRealEur];
    return { inputsHash: hash(inputs), monteCarloHash: hash(chunk), backtestHash: hash(historical),
        evaluable: count - technicalError, technicalError, successPct: (count - technicalError - chunk.totals.failCount) / (count - technicalError) * 100,
        terminalRealP10: quantile(real, .1), terminalRealP50: quantile(real, .5),
        counterchecks: [[2000, 2025], [1965, 1999]].map(([start, end]) => {
            const result = backtest(inputs, start, end), last = result.rows.at(-1);
            if (result.outcome.kind !== 'completed') throw new Error(`Gegenprobe ${start}–${end}: ${result.outcome.kind}`);
            return { period: `${start}–${end}`, hash: hash(result), rowCount: result.rows.length, lastWealth: last.wertAktien + last.wertGold + last.liquiditaet };
        }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const count = Number(process.argv[3] || 2000);
    const auto = { id: 'auto', monat: '2028-04', betrag: 35000, bezeichnung: 'Auto' };
    const loan = { id: 'kredit', betragMonat: 450, ab: '2026-01', bis: '2027-12', anpassung: 'keine', bezeichnung: 'Kredit' };
    const baseline = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : null;
    const cases = {};
    for (const [name, items] of Object.entries({ without: [], auto: [auto], loan: [loan], both: [auto, loan],
        minus30: [{ ...auto, betrag: auto.betrag * .7 }, { ...loan, betragMonat: loan.betragMonat * .7 }],
        plus30: [{ ...auto, betrag: auto.betrag * 1.3 }, { ...loan, betragMonat: loan.betragMonat * 1.3 }] })) {
        console.log(`${name}: ${count} Pfade`);
        cases[name] = await measureExpenses(items, count);
        console.log(JSON.stringify({ name, ...cases[name] }));
    }
    const parity = baseline ? Object.fromEntries(['inputsHash', 'monteCarloHash', 'backtestHash'].map(key => [key, { before: baseline[key], after: cases.without[key], equal: baseline[key] === cases.without[key] }])) : null;
    if (parity && Object.values(parity).some(item => !item.equal)) throw new Error('Ohne Ausgaben sind Eingaben oder Ergebnisbytes verändert.');
    writeFileSync(process.argv[2], JSON.stringify({ household: 'Max und Erika Mustermann, synthetisch', parameters: { ...parameters, anzahl: count },
        expensePlan: [auto, loan], terminalMetric: 'Endvermögen bis Tod, Ruin oder Horizont, real in Startkaufkraft', parity, cases }, null, 2) + '\n');
}
