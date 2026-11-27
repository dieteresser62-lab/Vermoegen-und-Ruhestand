/** FR-87: „Reichweite zuerst“ je Person, nur Musterhaushalte (keine Nutzerdaten).
 * node scripts/measure-fr87.mjs <Quellordner> <Ausgabe.json> [balance|montecarlo]
 * balance: Jahresabschluss zum 02.01.2027 über den Weg der App (evaluateStoredAnnualHousehold), je Person Verkauf, Auszahlung, Liquidität
 * und Ist-Reichweite danach (Liquidität nach Auszahlung ÷ halbe Jahresentnahme, gleicher Bedarfsanteil je Person).
 * montecarlo: 2.000 Läufe, Seed 12345 (Parameter aus ek-1b-measurement), Grundbedarf gedeckt und Endvermögen real P10/P50.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output, part = 'balance'] = process.argv.slice(2);
if (!root || !output) throw new Error('Quellordner und Ausgabe erforderlich.');
const load = file => import(pathToFileURL(resolve(root, file)).href);
const MODE = 'runway_first', DATE = '2027-01-02';
const COUPLES = ['max-erika', 'jan-lena', 'helga-werner', 'martin-petra'];
const withMode = records => {
    const plan = JSON.parse(records.household_plan_v1);
    for (const entry of Object.values(plan.entries)) entry.values.householdWithdrawalMode = MODE;
    return { ...records, household_plan_v1: JSON.stringify(plan) };
};
const round = value => Math.round(value * 100) / 100;
const result = { root: resolve(root), part, mode: MODE, testDate: DATE, rows: [] };

if (part === 'balance') {
    const { EngineAPI } = await load('engine/index.mjs');
    const { createMusterHaushaltRecords } = await load('app/demo/muster-haushalt.js');
    const { buildBalanceEngineInputFromStorage } = await load('app/balance/balance-input-storage.js');
    const { evaluateStoredAnnualHousehold } = await load('app/balance/balance-main-profilverbund.js');
    const { prepareBalanceEngineAssets } = await load('app/balance/balance-health-bucket.js');
    const { setAppTestDate } = await load('app/shared/app-clock.js');
    setAppTestDate(DATE);
    for (const id of COUPLES) {
        const records = withMode(createMusterHaushaltRecords(DATE, id));
        const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2027 });
        const runs = evaluateStoredAnnualHousehold(calc.inputData, calc.profiles, calc.engineLastState, { engineApi: EngineAPI, withdrawalMode: MODE });
        const operative = prepareBalanceEngineAssets(calc.inputData, calc.profiles).profiles;
        const annual = runs.distribution.items.reduce((sum, item) => sum + item.withdrawalAmount, 0);
        for (const profile of operative) {
            const action = runs.find(run => run.profileId === profile.profileId).ui.action;
            const sources = action.quellen || [];
            const cashSpent = sources.filter(source => source.kind === 'liquiditaet').reduce((sum, source) => sum + source.brutto, 0);
            const sold = sources.filter(source => source.kind !== 'liquiditaet').reduce((sum, source) => sum + source.brutto, 0);
            const before = (profile.inputs.tagesgeld || 0) + (profile.inputs.geldmarktEtf || 0);
            const payout = runs.distribution.items.find(item => item.profileId === profile.profileId)?.withdrawalAmount || 0;
            const after = before - cashSpent + (action.verwendungen?.liquiditaet || 0) - payout;
            result.rows.push({ household: id, profileId: profile.profileId, liquidityBefore: round(before), sold: round(sold),
                refill: round(action.verwendungen?.liquiditaet || 0), cashSpent: round(cashSpent), payout: round(payout),
                liquidityAfter: round(after), runwayYearsAfter: annual > 0 ? round(after / (annual / 2)) : null });
        }
    }
} else {
    const { measurementInputs, parameters, hash } = await load('tests/helpers/ek-1b-measurement.mjs');
    const { EngineAPI } = await load('engine/index.mjs');
    const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
    const { quantile } = await load('app/simulator/simulator-utils.js');
    for (const id of ['max-erika', 'jan-lena']) {
        const inputs = await measurementInputs(0, id, DATE);
        inputs.householdWithdrawalMode = MODE;
        const count = 2000, real = [];
        let failed = 0, technicalError = 0;
        for (let start = 0; start < count; start += 250) {
            const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: { ...parameters, anzahl: count }, widowOptions: inputs.widowOptions,
                useCapeSampling: false, runRange: { start, count: 250 }, engine: EngineAPI });
            real.push(...chunk.pathSummaries.finalValueRealEur);
            failed += chunk.totals.failCount; technicalError += chunk.technicalInventory.technicalError;
        }
        result.rows.push({ household: id, parameters: { ...parameters, anzahl: count }, inputsHash: hash(inputs), technicalError,
            floorCoveredPct: round((count - technicalError - failed) / (count - technicalError) * 100),
            terminalRealP10: Math.round(quantile(real, .1)), terminalRealP50: Math.round(quantile(real, .5)) });
        console.log(`${id}: fertig`);
    }
}
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.rows));
