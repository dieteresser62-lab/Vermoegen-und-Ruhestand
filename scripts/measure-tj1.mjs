/** TJ-1: Anlage aus Liquidität im Todesjahr, synthetische Max-/Erika-Pfade, zwei getrennte Quellstände.
 * node scripts/measure-tj1.mjs <Quellordner> <Ausgabe.json> [married|zero|tb-married50|tb-unmarried50] [2000]
 * node scripts/measure-tj1.mjs --vergleich <alt.json> <neu.json>
 * married: Musterhaushalt wie er ist; zero: „Nicht verheiratet“, Erbanteil 0 %; tb-…50: Drei Töpfe, Erbanteil 50 %.
 * Unter einer Jahresentnahme: Liquidität am Ende des Todesjahres kleiner als dessen geplante Entnahme.
 * Beträge nominal, Endvermögen real.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantile = (values, p) => { const v = values.slice().sort((a, b) => a - b), x = (v.length - 1) * p;
    return v.length ? v[Math.floor(x)] + (v[Math.ceil(x)] - v[Math.floor(x)]) * (x % 1) : null; };

if (process.argv[2] === '--vergleich') {
    const [before, after] = process.argv.slice(3, 5).map(file => JSON.parse(readFileSync(file, 'utf8')));
    if (before.variant !== after.variant || before.params.anzahl !== after.params.anzahl) throw Error('Ungleiche Messungen.');
    const pairs = before.deathYears.map(row => [row, after.deathYears.find(other => other.path === row.path)]);
    const sameStart = pairs.every(([a, b]) => b && a.jahr === b.jahr && a.beforeDeathSha256 === b.beforeDeathSha256);
    const side = (rows, key) => ({ purchases: rows.filter(r => r.purchase > .01).length,
        settlementSales: rows.filter(r => r.settlementSale > .01).length, payoutSales: rows.filter(r => r.payoutSale > .01).length,
        withoutCash: rows.filter(r => r.liqEnd <= 1).length, belowOneYear: rows.filter(r => r.liqEnd < r.need).length,
        withSale: rows.filter(r => r.sale > .01).length,
        liqEndP50: quantile(rows.map(r => r.liqEnd), .5), liqEndP10: quantile(rows.map(r => r.liqEnd), .1),
        purchaseMean: rows.reduce((sum, r) => sum + r.purchase, 0) / Math.max(1, rows.length), key });
    const summary = { variant: before.variant, paths: before.params.anzahl, deathYears: pairs.length,
        sameMarketPathsBeforeDeath: sameStart, completeOutputEqual: before.completeOutputSha256 === after.completeOutputSha256,
        backtestEqual: before.backtestSha256 === after.backtestSha256,
        purchaseAboveSurvivorShare: pairs.filter(([a, b]) => a.purchase > b.purchase + .01).length,
        changedDeathYears: pairs.filter(([a, b]) => ['purchase', 'liqEnd', 'sale', 'tax', 'bondRefill']
            .some(key => Math.abs((a[key] || 0) - (b[key] || 0)) > .01)).length,
        additionalSale: (rows => ({ years: rows.length, sum: rows.reduce((t, d) => t + d, 0), median: quantile(rows, .5), max: Math.max(0, ...rows) }))(
            pairs.map(([a, b]) => (b.sale || 0) - (a.sale || 0)).filter(d => Math.abs(d) > .01)),
        additionalTax: (rows => ({ years: rows.length, sum: rows.reduce((t, d) => t + d, 0), median: quantile(rows, .5), max: Math.max(0, ...rows) }))(
            pairs.map(([a, b]) => (b.tax || 0) - (a.tax || 0)).filter(d => Math.abs(d) > .01)),
        bondRefillChange: (rows => ({ years: rows.length, sum: rows.reduce((t, d) => t + d, 0) }))(
            pairs.map(([a, b]) => (b.bondRefill || 0) - (a.bondRefill || 0)).filter(d => Math.abs(d) > .01)),
        before: { ...side(before.deathYears, 'alt'), successPct: before.successPct, ruinPaths: before.ruinPaths,
            realP50: before.realP50, realP10: before.realP10 },
        after: { ...side(after.deathYears, 'neu'), successPct: after.successPct, ruinPaths: after.ruinPaths,
            realP50: after.realP50, realP10: after.realP10 } };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
}

const [root, output, variant = 'zero', countArg = '2000'] = process.argv.slice(2);
if (!root || !output || !['married', 'zero', 'tb-married50', 'tb-unmarried50'].includes(variant)) throw Error('Quellordner, Ausgabe und gültige Variante erforderlich.');
const load = file => import(pathToFileURL(resolve(root, file)));
const { measurementInputs, parameters, backtest } = await load('tests/helpers/ek-1b-measurement.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await load('engine/index.mjs');
const inputs = await measurementInputs(0, 'max-erika');
if (variant !== 'married') {
    const percent = variant === 'zero' ? 0 : 50, shares = Object.fromEntries(inputs.simulationPeople.map(person => [person.profileId, percent]));
    inputs.partnership = { schemaVersion: 1, status: variant === 'tb-married50' ? 'married' : 'unmarried', inheritance: shares,
        ...(variant === 'tb-married50' ? { marriedInheritance: shares } : {}) };
}
if (variant.startsWith('tb-')) Object.assign(inputs, { mode: '3_bucket_jilge', decumulation: { ...inputs.decumulation, mode: '3_bucket_jilge' } });
const params = { ...parameters, anzahl: Number(countArg) }, digest = createHash('sha256'), end = [], deathYears = [];
let failed = 0;
for (let start = 0; start < params.anzahl; start += 50) {
    const size = Math.min(50, params.anzahl - start), indices = Array.from({ length: size }, (_, i) => start + i);
    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: params, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start, count: size }, logIndices: indices, engine: EngineAPI });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw Error(JSON.stringify(chunk.technicalInventory));
    digest.update(JSON.stringify(chunk));
    failed += chunk.totals.failCount;
    end.push(...chunk.pathSummaries.finalValueRealEur);
    chunk.runMeta.forEach((run, i) => {
        const rows = run.logDataRows || [], index = rows.findIndex(row => row.SurvivorDeathYear === true);
        if (index < 0) return;
        const row = rows[index];
        deathYears.push({ path: start + i, jahr: row.jahr, beforeDeathSha256: hash(rows.slice(0, index)),
            purchase: (row.kaufAkt || 0) + (row.kaufGld || 0), liqEnd: row.liqEnd ?? row.liquiditaet ?? 0,
            leaves: row.abgang_erben || 0, settlementSale: (row.tax_funding_sale_gross || 0) + (row.inheritance?.funding?.saleGross || 0),
            payoutSale: (row.personalPayoutSales || []).reduce((sum, person) => sum + person.gross, 0),
            sale: row.vk?.vkGes || 0, tax: row.steuern_gesamt || 0, bondRefill: row.bondRefillNet || 0, need: row.entnahme_plan || 0 });
    });
    if ((start + size) % 250 === 0) console.log(`${variant}: ${start + size}/${params.anzahl}`);
}
const result = { variant, params, inputHash: hash(inputs), partnership: inputs.partnership ?? null,
    completeOutputSha256: digest.digest('hex'), backtestSha256: hash(backtest(inputs)),
    successPct: 100 * (params.anzahl - failed) / params.anzahl, ruinPaths: failed,
    realP50: quantile(end, .5), realP10: quantile(end, .1), deathYears };
writeFileSync(output, JSON.stringify(result) + '\n');
console.log(`TJ-1 ${variant}: ${params.anzahl} Pfade, ${deathYears.length} Todesjahre, Erfolg ${result.successPct.toFixed(2)} %.`);
