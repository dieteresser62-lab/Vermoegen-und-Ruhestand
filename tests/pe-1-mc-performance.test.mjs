// PE-1, Analyse auftrag/mp1/MP-1-befunde.md und Berichte A–D:
// delete und bedingte Spreads machten die jährlichen Objektkopien in V8 teuer.
// Quelltext-Verträge verhindern diese Fallen; Zeitgrenzen wären lastabhängig.
import { readFileSync } from 'node:fs';
import { normalizeTranche, freezeEngineTrancheSnapshot } from '../types/tranche-contract.js';
import { prepareGuardrailPlanInputs, selectGuardrailPlanInputs, shouldResetGuardrailState } from '../app/shared/guardrail-history.js';
import { restoreSimulatorLogOrder } from '../app/simulator/simulator-log-order.js';
import { classifyTrancheCategoryCached, calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const code = name => read(name).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
for (const file of ['app/simulator/simulator-engine-input.js', 'engine/planners/SpendingPlanner.mjs',
    'engine/planners/spending-diagnosis.mjs']) {
    assert(!/\bdelete\s+(?:inputsCtx|engineInput|newState|keyParams|state\s*\.\s*keyParams)\b/.test(code(file)),
        `${file}: jährliche Eingaben und Ergebnisobjekte bleiben ohne delete`);
}
const resultSource = code('app/simulator/simulator-year-result.js');
const start = resultSource.indexOf('        logData: {');
const end = resultSource.indexOf('\n        totalTaxesThisYear', start);
assert(start >= 0 && end > start, 'Das logData-Literal ist für die Gegenprobe auffindbar');
assert(!/^ {12}\.\.\./m.test(resultSource.slice(start, end)), 'Keine Spreads auf der obersten Ebene des logData-Literals');

// Der normale Selector muss Änderungen desselben Eingabeobjekts weiter erkennen.
const inputs = { floorBedarf: 30000, horizonYears: 35, decumulation: { mode: 'standard' } };
const plan = prepareGuardrailPlanInputs(inputs);
assert(Object.isFrozen(plan), 'Vorbereitete Paketwerte sind unveränderlich');
assert(selectGuardrailPlanInputs(plan) === plan, 'Vorbereitete Planwerte werden direkt wiederverwendet');
inputs.floorBedarf++;
assert(shouldResetGuardrailState(plan, inputs), 'Eine spätere Formularänderung wird nicht durch Identitätscaching verdeckt');
assertEqual(plan.floorBedarf, 30000, 'Die Paketprojektion gehört ihrem ursprünglichen Plan');
assertEqual(selectGuardrailPlanInputs({ ...inputs, horizonYears: 12, guardrailPlanHorizonYears: 35 }).horizonYears, 35,
    'Abgeleiteter Resthorizont verändert den festen Planhorizont nicht');

// Werte haben den Vorrang des ursprünglichen Literals, frühe Gruppen behalten
// ihre Position auch bei Überschneidungen und unbekannten eigenen Schlüsseln.
const inherited = { abgang_erben: 2, entscheidung: 'früh' };
const inflow = JSON.parse('{"unbekannt":3,"__proto__":4}');
const expense = { unbekannt: 5 };
const expected = { ...inherited, ...inflow, ...expense, entscheidung: 'fest', FlexRatePct: 80,
    personalPayoutSales: [], personAccounts: [], pension_annual: 20000, threeBucket: {} };
const scrambled = { threeBucket: {}, personAccounts: [], pension_annual: 20000,
    personalPayoutSales: [], FlexRatePct: 80, entscheidung: 'fest', ...inflow, unbekannt: 5, abgang_erben: 2 };
const ordered = restoreSimulatorLogOrder(scrambled, [inherited, inflow, expense]);
assertEqual(JSON.stringify(ordered), JSON.stringify(expected), 'Die öffentliche Protokollreihenfolge und alle Werte bleiben bytegleich');
assert(Object.hasOwn(ordered, '__proto__'), 'Unbekannte Schlüssel bleiben eigene Datenfelder');

const fixture = JSON.parse(read('tests/fixtures/pe-1-max-erika.json'));
const raw = { ...fixture.detailledTranches[0] };
normalizeTranche(raw, { mode: 'engine' });
raw.marketValue = 12345;
assertEqual(normalizeTranche(raw, { mode: 'engine' }).marketValue, 12345, 'Editierbare Rohtranchen werden erneut gelesen');
const snapshot = freezeEngineTrancheSnapshot({ ...raw });
const first = normalizeTranche(snapshot, { mode: 'engine' });
const second = normalizeTranche(snapshot, { mode: 'engine' });
assertEqual(JSON.stringify(first), JSON.stringify(second), 'Wiederholte Normalisierung privater Snapshots bleibt bytegleich');
assert(first !== second, 'Jeder Aufrufer erhält eine eigene Ergebniskopie');
first.marketValue = 7;
assertEqual(normalizeTranche(snapshot, { mode: 'engine' }).marketValue, 12345, 'Eine Ausgabemutation verunreinigt den Zwischenspeicher nicht');
const invalidDate = { ...raw, purchaseDate: '2025-02-30' };
let errors = [];
for (const index of [1, 7]) {
    try { normalizeTranche(invalidDate, { mode: 'engine', index }); }
    catch (error) { errors.push(error.errors.find(entry => entry.field === 'purchaseDate')?.index); }
}
assertEqual(JSON.stringify(errors), '[1,7]', 'Ungültige Datumswerte liefern weiterhin den aktuellen Fehlerkontext');
const categoryInput = { type: 'aktien_alt', category: 'equity' };
assertEqual(classifyTrancheCategoryCached(categoryInput), 'equity', 'Erfolgreiche Klassifikation');
categoryInput.type = 'anleihe';
let rejected = false;
try {
    calculateWithdrawalDistribution([{ profileId: 'synthetisch', inputs: { geldmarktEtf: 1000 }, tranches: [categoryInput] }],
        { netWithdrawal: 100 });
} catch { rejected = true; }
assert(rejected, 'Auch mit Geldmarktwert bleibt die Klassifikationsprüfung wirksam');

const baseConfig = JSON.parse(read('src-tauri/tauri.conf.json'));
const perfConfig = JSON.parse(read('src-tauri/tauri.pe-1-perf.conf.json'));
assert(!baseConfig.app.windows[0].additionalBrowserArgs, 'Der V8-Schalter ist im normalen Build nicht aktiviert');
assert(perfConfig.app.windows[0].additionalBrowserArgs.includes('--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection'),
    'Die optionale Messkonfiguration erhält die Standardargumente von Tauri/Wry');
assert(perfConfig.app.windows[0].additionalBrowserArgs.includes('--js-flags=--invocation-count-for-turbofan=300'),
    'Die optionale Messkonfiguration reicht den V8-Schalter an WebView2 durch');
