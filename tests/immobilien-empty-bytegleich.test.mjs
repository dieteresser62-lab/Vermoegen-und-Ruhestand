import { withoutExampleNeeds } from './helpers/ff-3-expectations.mjs';
import { readEV1bReferences } from './helpers/ev-1b-expectations.mjs';
const readMD2References = value => readEV1bReferences(readBeforeEV1bReferences(value));
import { readMD2References as readBeforeEV1bReferences } from './helpers/md-2-expectations.mjs';
import { readZG1References as readBeforeMD2References } from './helpers/zg-1-expectations.mjs';
const readZG1References = value => readMD2References(readBeforeMD2References(value));
import { readEV1References as readBeforeZG1References } from './helpers/ev-1-expectations.mjs';
const readEV1References = value => readZG1References(readBeforeZG1References(value));
import { previousLiquidityInput } from './helpers/lq-1b-expectations.mjs';
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences as readBeforePA1References } from './helpers/vf-2b-expectations.mjs';
import { readPA1References } from './helpers/pa-1-expectations.mjs';
const readVF2BReferences = value => readQSCReferences(readPA1References(readBeforePA1References(value)));
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAS1Hash } from './helpers/as-1-expectations.mjs';
import { readEP1Hash } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash as readBeforeEP1Hash } from './helpers/rng-1-expectations.mjs';
import { readFileSync } from 'node:fs';
import { measure, hash } from './helpers/ek-1b-measurement.mjs';
import { runParityScenarios } from './extended/parity-scenarios.mjs';
import { source } from './extended/parity-replay-fixture.mjs';
import { projectBalanceBudget } from '../app/balance/balance-budget.js';
import { sealParityCase } from '../app/balance/parity-case.js';
import { sealParityReplayLog } from '../app/simulator/parity-replay-contract.js';

// Unveränderte Max-/Erika-Daten; Referenz stammt vom Kopf vor UP-1a.
const readRNG1Hash = before => readQSCReferences(readAS1Hash(readEP1Hash(readBeforeEP1Hash(before))));
const baseline = JSON.parse(readFileSync(new URL('./fixtures/up-1a-parity.json', import.meta.url)));
const { inputs, historical, chunk } = await measure(0, baseline.count, { historicalSurvivor: true });
assertEqual(hash(inputs), readQSCReferences(readVF2BReferences(readGL1References(baseline.inputsHash))), 'Ohne Immobilien: vollständige Eingaben bytegleich zum Ausgangsstand');
assertEqual(hash(historical), readQSCReferences(readVF2BReferences(readGL1References(baseline.backtestHash))), 'Ohne Immobilien: vollständiger Backtest 2000–2025 bytegleich zum Ausgangsstand');
assertEqual(hash(chunk), readEV1References(readQSCReferences(readVF2BReferences(readGL1References(readRNG1Hash(baseline.monteCarloHash))))), 'Ohne Immobilien: vollständige 24 MC-Pfade mit Seed 12345 und belegter Ehe-Erbschaftsteuer');
const { durationMs, ...parity } = runParityScenarios({ source });
assertEqual(parity.cases.length, baseline.parityCases, 'Paritätsbeleg enthält dieselben 208 Jahres- und Fortsetzungsfälle');
assertEqual(parity.failed, false, 'Keine ungeklärten Paritätsabweichungen');
// Der historische Gesamthash bleibt erhalten. Ausschließlich die vier geänderten
// Anzeigegrößen und ihr Haushalts-Flex-Vergleich werden auf die alte Basis zurückgeführt.
// Alle Enginewerte, Zustände, Belege, Aktionen und übrigen Vergleichsfelder bleiben im Hash.
const legacyDisplay = previousLiquidityInput(structuredClone(parity));
// FR-66 ergänzt ausschließlich den Planwert in geschriebenen Planrecords.
// Nur dessen Vorgabe 12 entfernen; sämtliche Rechenwerte bleiben im Byteorakel.
function previousCashPlanRecords(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (key === 'balance_expenses_v1' && typeof child === 'string') {
            value[key] = withoutExampleNeeds({ balance_expenses_v1: child }).balance_expenses_v1;
        } else if (key === 'household_plan_v1' && typeof child === 'string') {
            const record = JSON.parse(child);
            for (const entry of Object.values(record.entries)) if (Object.hasOwn(entry.values, 'liquidityCashMonths')) {
                assertEqual(entry.values.liquidityCashMonths, 12, 'Paritätsbeleg ergänzt nur die Tagesgeldvorgabe, keine Rechenänderung');
                delete entry.values.liquidityCashMonths;
            }
            value[key] = JSON.stringify(record);
        } else previousCashPlanRecords(child);
    }
}
previousCashPlanRecords(legacyDisplay);
function previousDisplayNeed(decision) {
    const { income, saving } = projectBalanceBudget({ ...decision.ui, input: decision.input });
    return decision.ui.vpw?.enabled && Number.isFinite(decision.ui.neuerBedarf) && Number.isFinite(income)
        ? decision.ui.neuerBedarf / 12 + income - saving
        : (decision.input.floorBedarf + decision.input.flexBedarf) / 12;
}
for (const value of legacyDisplay.cases) {
    const balance = value.measured?.balance;
    if (!balance?.projection) continue;
    const projection = balance.projection;
    projection.grossNeed = previousDisplayNeed(balance.decision);
    projection.cut = Math.max(0, projection.grossNeed - projection.budget);
    projection.householdFlex = Math.max(0, projection.grossNeed - balance.decision.input.floorBedarf / 12);
    projection.householdFlexRate = projection.householdFlex > 0 && projection.financedHouseholdFlex !== null
        ? projection.financedHouseholdFlex / projection.householdFlex * 100 : null;
    const row = value.fields.find(row => row.id === 'decision.household.householdFlex');
    if (row) {
        row.simulator.value = Math.max(0, previousDisplayNeed(value.expected) - value.expected.input.floorBedarf / 12) * 12;
        row.balance.value = projection.householdFlex * 12;
        row.delta = row.balance.value - row.simulator.value;
    }
}
legacyDisplay.cases = legacyDisplay.cases.map(value => {
    if (value.replay?.log) value.replay.log = sealParityReplayLog(value.replay.log);
    return sealParityCase(value);
});
assertEqual(hash(legacyDisplay), readQSCReferences(readVF2BReferences(readGL1References(baseline.parityHash))), 'Ohne Immobilien: vollständiger Paritätsbeleg mit bisheriger Anzeigebasis bytegleich zum Ausgangsstand');
