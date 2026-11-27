/** KR-1: Balance-Jahresbudget 2027 je Musterhaushalt (Testdatum 02.01.2027), nur Steckbriefdaten der Muster.
 * node scripts/measure-kr1-januar.mjs <Quellordner> <Ausgabe.json>
 * Weg wie im Jahresabschluss: gespeicherte Musterdaten → buildBalanceEngineInputFromStorage → EngineAPI.simulateSingleYear.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, output] = process.argv.slice(2);
if (!root || !output) throw new Error('Quellordner und Ausgabe erforderlich.');
const load = file => import(pathToFileURL(resolve(root, file)).href);
const { EngineAPI } = await load('engine/index.mjs');
const { MUSTER_HAUSHALTE } = await load('app/demo/muster-haushalte.js');
const { createMusterHaushaltRecords } = await load('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await load('app/balance/balance-input-storage.js');
const { projectBalanceBudget } = await load('app/balance/balance-budget.js');
const { planScope } = await load('app/profile/household-plan.js');
const { setAppTestDate } = await load('app/shared/app-clock.js');

const testDate = '2027-01-02';
setAppTestDate(testDate);
const rows = [];
for (const { id } of MUSTER_HAUSHALTE) {
    const records = createMusterHaushaltRecords(testDate, id);
    const registry = JSON.parse(records.rs_profiles_v1);
    const ids = Object.keys(registry.profiles);
    const scope = planScope(ids.length === 1 ? 'single' : 'household', ids);
    const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, scope });
    const result = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState, { includeFlexTrace: true });
    if (result.error) throw result.error;
    const budget = projectBalanceBudget({ ...result.ui, input: calc.engineInput });
    const guardrails = result.ui.spending.flexTrace?.find(step => step.schritt === 'guardrails');
    const keyParams = result.diagnosis?.keyParams || {};
    rows.push({ id, referenceYear: calc.referenceYear ?? null, dynamicFlex: calc.engineInput.dynamicFlex === true,
        monthlyBudget: budget.budget, monthlyWithdrawal: budget.withdrawal, monthlyIncome: budget.income,
        annualBudget: budget.budget * 12, flexRate: result.ui.spending.details?.flexRate ?? null,
        cutSource: result.ui.spending.kuerzungQuelle ?? null,
        floorRaise: guardrails ? guardrails.rateNachher > guardrails.rateVorher + 1e-9 : null,
        guardrailRateBefore: guardrails?.rateVorher ?? null, guardrailRateAfter: guardrails?.rateNachher ?? null,
        wealthFactor: keyParams.wealthReductionFactor ?? null, withdrawalRateDepot: keyParams.entnahmequoteDepot ?? null,
        market: result.ui.market?.sKey ?? null });
}
writeFileSync(output, JSON.stringify({ root: resolve(root), testDate, rows }, null, 2) + '\n');
for (const row of rows) console.log(`${row.id}: ${row.monthlyBudget?.toFixed(2)} €/Monat, Entnahme ${row.monthlyWithdrawal?.toFixed(2)}, Anhebung ${row.floorRaise}, w ${row.wealthFactor}, ${row.cutSource}`);
