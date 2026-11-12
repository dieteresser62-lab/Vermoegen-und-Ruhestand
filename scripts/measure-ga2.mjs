// GA-2 [M1]: Monte Carlo alt gegen neu auf denselben Marktpfaden, Sophie mit Ratenkredit (feste geplante Ausgabe).
// Aufruf: node scripts/measure-ga2.mjs <Wurzel> <ausgabe.json> [Pfade] [ansparen|entnahme]. Die Wurzel kann ein alter Stand sein.
// „entnahme“ (GA-2c): Max und Erika im Ruhestand, feste Ausgabe 500 €/Monat in den ersten fünf Jahren.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [root, output, countArg, mode = 'ansparen'] = process.argv.slice(2);
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters } = await load('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await load('engine/index.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { quantile } = await load('app/simulator/simulator-utils.js');
const { plannedExpensesForYear } = await load('app/profile/household-planned-expenses.js');
const count = Number(countArg || 2000), chunk = 250, refYear = 2026;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const auto = { id: 'muster-auto', monat: '2029-04', betrag: 25000, bezeichnung: 'Auto', priceFactor: 1 };
const loan = amount => ({ id: 'muster-kredit', bezeichnung: 'Ratenkredit', betragMonat: amount, ab: null, bis: mode === 'entnahme' ? '2030-12' : '2032-12', anpassung: 'keine', priceFactor: 1 });
const household = mode === 'entnahme' ? 'max-erika' : 'sophie';
const amount = value => Number.isFinite(value) ? value : 0;
const isBear = row => /bear|bär|crash/i.test(String(row.Regime || ''));

async function measure(items) {
    const inputs = await measurementInputs(0, household, '2026-10-16');
    inputs.plannedExpenses = items; inputs.plannedExpensesReferenceYear = refYear;
    const fixed = items.filter(item => Object.hasOwn(item, 'betragMonat'));
    const metrics = { paths: 0, technical: 0, fails: 0, finalReal: [], cutPct: [], spendReal: [], plannedReal: [],
        drops: 0, dropsWithoutFixed: 0, yearPairs: 0, maxJump: 0, maxJumpWithoutFixed: 0, market: [] };
    for (let start = 0; start < count; start += chunk) {
        const size = Math.min(chunk, count - start);
        const mc = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: count },
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, index) => start + index) });
        metrics.paths += size; metrics.technical += mc.technicalInventory.technicalError; metrics.fails += mc.totals.failCount;
        metrics.finalReal.push(...mc.pathSummaries.finalValueRealEur);
        for (const run of mc.runMeta) {
            const rows = run.logDataRows.filter(row => row.financiallyEvaluable !== false && Number.isFinite(row.inflation_factor_cum));
            metrics.market.push(rows.map(row => [row.histJahr, row.inflation]));
            let spend = 0, planned = 0, previous = null, previousFree = null;
            for (const row of rows) {
                const factor = row.inflation_factor_cum;
                // Neu steckt die feste Ausgabe in floor_brutto, alt in geplante_ausgaben. Beide Sichten gleich herleiten.
                const fixedNominal = plannedExpensesForYear(fixed, refYear + row.jahr - 1, factor);
                const fixedInFloor = amount(row.geplante_ausgaben) + 0.005 < plannedExpensesForYear(items, refYear + row.jahr - 1, factor) ? fixedNominal : 0;
                const budget = (amount(row.floor_brutto) + amount(row.flex_haushalt_erfuellt) + (fixedInFloor ? 0 : fixedNominal)) / factor;
                const free = budget - fixedNominal / factor;
                spend += budget; planned += (amount(row.geplante_ausgaben) - (fixedInFloor ? 0 : fixedNominal)) / factor;
                metrics.cutPct.push(amount(row.flex_haushalt_kuerzung_pct));
                if (previous !== null && previous > 0) {
                    metrics.yearPairs++;
                    if (!isBear(row) && budget < previous * .95) metrics.drops++;
                    if (!isBear(row) && free < previousFree * .95) metrics.dropsWithoutFixed++;
                    metrics.maxJump = Math.max(metrics.maxJump, Math.abs(budget / previous - 1) * 100);
                    if (previousFree > 0) metrics.maxJumpWithoutFixed = Math.max(metrics.maxJumpWithoutFixed, Math.abs(free / previousFree - 1) * 100);
                }
                previous = budget; previousFree = free;
            }
            metrics.spendReal.push(spend); metrics.plannedReal.push(planned);
        }
    }
    const evaluable = metrics.paths - metrics.technical, mean = list => list.reduce((sum, value) => sum + value, 0) / (list.length || 1);
    return { successPct: (evaluable - metrics.fails) / evaluable * 100, fails: metrics.fails, technical: metrics.technical,
        finalRealP10: quantile(metrics.finalReal, .1), finalRealP50: quantile(metrics.finalReal, .5),
        meanFlexCutPct: mean(metrics.cutPct), meanSpendRealPerPath: mean(metrics.spendReal), meanOnceRealPerPath: mean(metrics.plannedReal),
        dropYearsOutsideBear: metrics.drops, dropYearsOutsideBearWithoutFixed: metrics.dropsWithoutFixed, yearPairs: metrics.yearPairs,
        maxJumpPct: metrics.maxJump, maxJumpWithoutFixedPct: metrics.maxJumpWithoutFixed, marketHash: hash(metrics.market) };
}

const cases = {};
const plans = mode === 'entnahme'
    ? { ohneFest: [], fest: [loan(500)], minus30: [loan(350)], plus30: [loan(650)] }
    : { ohneKredit: [auto], kredit: [auto, loan(300)], minus30: [auto, loan(210)], plus30: [auto, loan(390)] };
for (const [name, items] of Object.entries(plans)) {
    cases[name] = await measure(items);
    console.log(JSON.stringify({ name, ...cases[name] }));
}
writeFileSync(output, JSON.stringify({ household: mode === 'entnahme' ? 'Max und Erika (Beispiel), feste Ausgabe bis 12/2030' : 'Sophie (Beispielhaushalt), Auto 2029 plus Ratenkredit bis 12/2032',
    parameters: { ...parameters, anzahl: count }, cases }, null, 2) + '\n');
