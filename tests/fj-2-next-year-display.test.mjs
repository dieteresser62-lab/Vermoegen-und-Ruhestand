import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { projectNextYearBudget } from '../app/balance/balance-next-year-budget.js';
import { renderBalanceMarketPreview, createAnnualMarketReadings, projectionReasons, projectionAssumptions } from '../app/balance/balance-market-preview-renderer.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
import { INFLATION_RESULT_METRIC } from '../app/balance/balance-annual-inflation.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { isHiddenBearMarket } from '../app/balance/balance-market-preview.js';
import { fjFixture, fixtureNow, stateKey, changeProfiles, setPrices } from './helpers/fj-1-fixtures.mjs';

const project = (storage = fjFixture(), options = {}) => projectNextYearBudget({ storage, engineApi: EngineAPI, now: fixtureNow, ...options });
const doc = new MockDocument(), get = id => doc.getElementById(id);
const text = node => node.textContent.replaceAll('\u00a0', ' ');
const all = node => [node, ...node.children.flatMap(all)];
const tags = (node, tag) => all(node).filter(item => item.tagName.toLowerCase() === tag);
const detail = key => all(get('balanceMarketPreviewBody')).find(item => Object.hasOwn(item.dataset, key));
const view = project();
assertEqual(view.state, 'same', 'Musterhaushalt hat keine Marktwirkung');
const inflation = view.rule.components.find(item => item.kind === 'inflation');
const rounding = view.rule.components.find(item => item.kind === 'rounding');
assertEqual(inflation.amount, 1200, 'Inflation ist ungerundeter Bedarfsanstieg');
assertEqual(rounding.amount, 800, '800 Euro sind eigene Rundungskomponente');
assertEqual(rounding.text, 'Rundung der Planwerte', 'Rundung heißt nicht Markt');
assert(view.rule.components.every(item => !/Markt/.test(item.text)), 'Bei same wird keine Marktwirkung behauptet');
assert(view.rule.reasons.every(item => Math.abs(item.amount) >= 1), 'Gründe unter einem Euro entfallen');
assertEqual(view.rule.reasons[0].effect, 'income', 'Größere Einkommensänderung zuerst');
const reasons = projectionReasons(view);
for (const label of ['Rente Erika ab 07/2027', '+9.600 € Einkünfte', 'Inflation +1.200 € Bedarf', 'Rundung der Planwerte +800 € Bedarf']) assert(reasons.includes(label), 'Wirkungsart und Grund: ' + label);
assert(!/Summe|Gesamt/.test(reasons), 'Verschiedene Wirkungsarten werden nicht summiert');
const assumptions = projectionAssumptions(view);
for (const label of ['Annahmen: Inflation 2,00 % (Annahme', 'Vermögen Stand 30.12.2026', 'Kurs Stand 30.12.2026', 'Restentnahmen bis Dezember nicht abgezogen', 'CAPE 25,00', 'Stand Datum nicht belegt']) assert(assumptions.includes(label), 'Annahme sichtbar: ' + label);
assertEqual(view.assumptions[0].year, null, 'Gleicher Simulatorwert belegt kein Inflationsjahr');
const coincident = fjFixture();
changeProfiles(coincident.records, profile => {
    const state = JSON.parse(profile.data[stateKey]);
    state.annualMarketDataMeta = { ...state.annualMarketDataMeta, inflation: { rate: 2, year: 2025 } };
    profile.data[stateKey] = JSON.stringify(state);
});
assertEqual(project(coincident).assumptions[0].year, null, 'Zufällig gleicher alter Jahreswert datiert die Annahme nicht');
const tiny = fjFixture();
changeProfiles(tiny.records, profile => {
    const state = JSON.parse(profile.data[stateKey]); state.inputs.inflation = 0.0001;
    profile.data[stateKey] = JSON.stringify(state);
});
const tinyView = project(tiny);
assert(Math.abs(tinyView.rule.components.find(item => item.kind === 'inflation').amount) < 1, 'Probe enthält Bedarfsänderung unter einem Euro');
assert(!tinyView.rule.reasons.some(item => item.kind === 'inflation'), 'Grund unter einem Euro wird weggelassen');

// WT-1 (FR-77 Punkt 5): Ohne verdeckten Bärenmarkt zeigt die Balance nichts zum Jahreshoch; die Grundzeile bleibt.
renderBalanceMarketPreview(doc, null, view);
assert(text(get('balanceBudgetReasons')).startsWith('Warum anders als 2026:'), 'Grundzeile nennt Vergleichsjahr');
assert(get('balanceMarketPreview').hidden && text(get('balanceMarketPreviewBody')) === '', 'Gleiche Lesarten: kein Block zum Jahreshoch');
assert(get('balanceHighBudget').hidden, 'same ohne Zusatzzeile');
const renderer = new SummaryRenderer({ outputs: {} });
const previousDoc = globalThis.document;
globalThis.document = doc;
try { renderer.renderBudgetOrigin({}, { ...view.displayEvaluation.modelResult.ui, input: view.displayEvaluation.inputData, nextYearBudget: view }); }
finally { globalThis.document = previousDoc; }
assertEqual(text(get('balanceBudgetPreview')), 'Budget 2027 · Projektion mit heutigen Werten', 'Linke Karte zeigt dieselbe Projektion');

// Januar: dieselbe vorbereitete Jahresquelle hat Vorrang, falsches Jahr wird abgewiesen.
const annualInflation = { rate: 6, year: 2026, source: 'Bestätigte Januarquelle', dataAsOf: '2027-01-01', fetchStatus: 'ok_manual', metric: INFLATION_RESULT_METRIC };
const january = project(fjFixture(), { now: () => new Date('2027-01-15T12:00:00Z'), annualInflation });
assertEqual(january.assumptions[0].value, 6, 'Januar reicht Jahresinflation durch');
assertEqual(january.assumptions[0].year, 2026, 'Januar nennt Abschlussjahr');
assert(projectionAssumptions(january).includes('(Bestätigte Januarquelle)'), 'Januar nennt tatsächliche Quelle');
assertEqual(project(fjFixture(), { now: () => new Date('2027-01-15T12:00:00Z'), annualInflation: { ...annualInflation, year: 2025 } }).state, 'not_reliable', 'Falsches Jahr nicht still ersetzt');

// Hochdatum stammt aus dem beteiligten Profil mit Jahresabschluss, nicht aus dem aktiven Spiegel.
const dated = fjFixture();
dated.records.rs_current_profile = 'muster_b';
dated.records.rs_active_profile = 'muster_b';
changeProfiles(dated.records, (profile, id) => {
    const state = JSON.parse(profile.data[stateKey]);
    state.annualMarketDataMeta ||= { ath: {} };
    state.inputs.ath = 150; (state.profilverbundHouseholdInputs ||= {}).ath = 150; (state.balanceInputFields ||= {}).ath = { value: '150', checked: false };
    if (id === 'muster_a') state.annualMarketDataMeta.ath = { ...state.annualMarketDataMeta.ath, value: 150, lastHighAsOf: '2024-06-17' };
    else state.annualMarketDataMeta.ath.lastHighAsOf = '2023-01-10';
    profile.data[stateKey] = JSON.stringify(state);
});
setPrices(dated.records, [['2025-12-31', 150], ['2026-12-30', 140]]);
const datedView = project(dated);
assert(datedView.state !== 'not_reliable', 'Profilquelle mit Abschluss bleibt auswertbar: ' + datedView.reason);
assertEqual(datedView.marketPreview.rule.high.asOf, '2024-06-17', 'Hochdatum wie p25 aus abgeschlossenem Profil');

const lowerStorage = fjFixture();
changeProfiles(lowerStorage.records, profile => {
    const state = JSON.parse(profile.data[stateKey]);
    const values = { endeVJ: 105, endeVJ_1: 100, endeVJ_2: 95, endeVJ_3: 90, ath: 105, jahreSeitAth: 0 };
    Object.assign(state.inputs, values); Object.assign(state.profilverbundHouseholdInputs, values);
    for (const [key, value] of Object.entries(values)) (state.balanceInputFields ||= {})[key] = { value: String(value), checked: false };
    profile.data[stateKey] = JSON.stringify(state);
});
setPrices(lowerStorage.records, [['2025-12-31', 100], ['2026-07-14', 140], ['2026-12-30', 103]]);
const lower = project(lowerStorage);
assertEqual(lower.state, 'budget_lower', 'Folgejahr mit höherem Hoch hat niedrigeres Budget');
assertEqual(lower.high.components.find(item => item.kind === 'market').amount, lower.comparison.difference.annualBudget, 'Marktwirkung nur aus Variantenvergleich');
renderBalanceMarketPreview(doc, null);
renderBalanceMarketPreview(doc, null, lower);
const lowerHidden = isHiddenBearMarket(lower.marketPreview);
assertEqual(!get('balanceMarketPreview').hidden, lowerHidden, 'Block nur bei verdecktem Bärenmarkt');
assertEqual(!get('balanceHighBudget').hidden, lowerHidden, 'Hochzeile beim Budget nur bei verdecktem Bärenmarkt');
if (lowerHidden) assert(text(get('balanceMarketPreviewBody')).includes('Bärenmarkt, den die Jahresregel nicht sieht'), 'Verdeckter Bär nennt den Block');
const calm = structuredClone(lower); calm.marketPreview.high.market = { ...calm.marketPreview.rule.market };
renderBalanceMarketPreview(doc, null, calm);
assert(get('balanceMarketPreview').hidden && get('balanceHighBudget').hidden, 'Anderes Budget ohne verdeckten Bären bleibt unsichtbar');

const planned = fjFixture('renate');
const calculation = buildBalanceEngineInputFromStorage({ storage: planned, referenceYear: 2026 });
planned.setItem('household_planned_expenses_v1', JSON.stringify({ version: 1, entries: { [calculation.scope.key]: { scope: calculation.scope,
    items: [{ id: 'car', bezeichnung: 'Auto', betrag: 25000, monat: '2027-04', priceYear: 2026 }] } } }));
const plannedView = project(planned);
assert(projectionReasons(plannedView).includes('Auto 2027 −25.500 € geplante Zahlungen'), 'Planposten nennt Bezeichnung, Jahr und Zahlungswirkung');
const minimal = fjFixture('renate');
const plan = buildBalanceEngineInputFromStorage({ storage: minimal, referenceYear: 2026 }).householdPlan;
minimal.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(plan.raw, [{ scope: plan.scope, values: { ...plan.entry.values, floorBedarf: 0, flexBedarf: 0, minimumFlexAnnual: 0 } }], { now: fixtureNow }).raw);
const zero = project(minimal);
assert(zero.rule.reasons.every(reason => Math.abs(reason.amount) >= 1), 'Nulländerungen nicht als Gründe angezeigt');

// Nicht möglich: Ergebnis mit Grund, keine Varianten; p25-Rechnung bleibt eigener Fallback.
const failed = project(fjFixture(), { engineApi: { simulateSingleYear: () => { throw new Error('Projektionsprobe'); } } });
renderBalanceMarketPreview(doc, lower.marketPreview, failed);
assert(get('balanceMarketPreview').hidden && text(get('balanceMarketPreviewBody')) === '', 'Projektionsfehler: Balance zeigt nichts zum Jahreshoch');
assert(get('balanceBudgetReasons').hidden && get('balanceHighBudget').hidden, 'Fehler entfernt alte Zusatzzeilen');
assert(createAnnualMarketReadings(doc, view.marketPreview).hidden, 'Jahresabschluss: belastbare Kurse ohne verdeckten Bären zeigen nichts');
const main = fs.readFileSync(new URL('../app/balance/balance-main.js', import.meta.url), 'utf8');
assert(main.includes('annualInflation: options.annualInflation'), 'Balance reicht vorbereitete Januarquelle durch');
assert(main.includes('projected?.modelResult || modelResult'), 'Fehler lässt bisherige Vorschau bestehen');
assert(main.includes('profileActionResults: projected.profilverbundRuns'), 'Empfehlung verwendet Profilaktionen derselben Projektion');
