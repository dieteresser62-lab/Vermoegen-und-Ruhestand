import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { annualTestMarketData as marketData, annualTestNow as now, annualServiceFixture } from './helpers/balance-storage-fixtures.mjs';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { classifyMarketPreview, prepareMarketPreview, projectMarketPreview, deriveYearEndMarketInputs } from '../app/balance/balance-market-preview.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { normalizeBalanceImportDocument, createBalanceExportDocument } from '../app/balance/balance-binder-imports.js';
import { emptyHistorySymbol, historyDay, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectAnnualCloseResult, createAnnualActionResult } from '../app/shared/annual-close-result.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';

const key = 'ruhestandsmodellValues_v29_guardrails';
const records = createMusterHaushaltRecords('2026-12-15');
const state = JSON.parse(records[key]);
state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'ar2-before', phase: 'writes_started' };
records[key] = JSON.stringify(state);
const storage = annualRecordStorage(records), yearHigh = { value: 250, asOf: '2026-06-15' };
const options = { targetYear: 2026, marketData, storage, now };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const draft = computeAnnualPlanUpdate(options), plain = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now });
// Aus den Quellen vor AR-2 ermittelt, gleicher Musterhaushalt, identischer Zeitpunkt.
assertEqual(hash(draft.records), 'aeac523006dd72fde26591464f7b22656ed1a4004c7318a6af89a382078463aa', 'Ohne Wahl bleibt der Jahresentwurf bytegleich zum Ausgangsstand');
assertEqual(hash(plain.records), '634a5aebc0add1eca20d29e2f8d3d053799c699bb969c158a5d24d8594e49ec1', 'Ohne Wahl bleiben alle Abschlussrecords bytegleich zum Ausgangsstand');
const chosenDraft = computeAnnualPlanUpdate({ ...options, yearHigh });
const chosen = prepareAnnualCommitRecords(chosenDraft, { engineApi: EngineAPI, now });
const after = JSON.parse(chosen.records[key]), age = (Date.parse('2026-12-31') - Date.parse(yearHigh.asOf)) / 86400000 / 365.2425;
assertEqual(after.inputs.ath, 250, 'Gewähltes Jahreshoch wird Engine-Hoch');
assertEqual(after.inputs.jahreSeitAth, age, 'Hochalter zählt bis Abschlussstichtag als Jahresbruchteil');
assertEqual(after.annualMarketDataMeta.ath.reading, 'year_high', 'Meta hält die gewählte Lesart');
assertEqual(after.annualMarketDataMeta.ath.lastHighAsOf, yearHigh.asOf, 'Meta hält das Datum des gewählten Hochs');
assertEqual(chosen.receipt.adopted.snapshot.marketReading.asOf, yearHigh.asOf, 'Jahresbeleg hält die Wahl');
assertEqual(JSON.stringify(storage.records), JSON.stringify(records), 'Beide Varianten bleiben im privaten Entwurf');
const registry = JSON.parse(chosen.records.rs_profiles_v1);
for (const profile of Object.values(registry.profiles)) {
    const own = JSON.parse(profile.data[key]);
    assertEqual(own.inputs.ath, 250, 'Jedes Haushaltsmitglied erhält dieselbe Hochbasis');
}
const followingStorage = annualRecordStorage({ ...records, ...chosen.records });
for (const price of [180, 260]) {
    const market = { inflation: { ...marketData.inflation, year: 2027 },
        etf: { ...marketData.etf, price, asOf: '2027-12-31', date: new Date('2027-12-31'), targetYear: 2027 },
        cape: { ...marketData.cape, capeAsOf: '2027-12-01', capeUpdatedAt: '2028-01-02T12:00:00Z' } };
    const next = computeAnnualPlanUpdate({ targetYear: 2027, marketData: market, storage: followingStorage, now: () => new Date('2028-01-02T12:00:00Z') });
    const input = JSON.parse(next.records[key]).inputs;
    assertEqual(input.jahreSeitAth, price > 250 ? 0 : age + 1, 'Folgejahr: Alter +1 oder neues Hoch setzt 0');
    assertEqual(input.ath, Math.max(price, 250), 'Folgejahr: bisherige Hochfortschreibung bleibt');
}
assertEqual(deriveYearEndMarketInputs(after.inputs, 250).jahreSeitAth, 0, 'Gleichstand am Hoch setzt wie bisher 0');
const exported = payload => createBalanceExportDocument(payload, { householdPlan: { status: 'valid', entry: { values: chosen.receipt.adopted.snapshot.plan } } });
assertEqual(normalizeBalanceImportDocument(exported(after)).payload.inputs.jahreSeitAth, age, 'Import akzeptiert Jahresbruchteil und Jahreshoch-Meta');
const legacy = { inputs: { aktuellesAlter: 68, floorBedarf: 30000, flexBedarf: 30000, runwayTargetMonths: 48, ath: 150, jahreSeitAth: 2 },
    annualMarketDataMeta: { schemaVersion: 1, periodId: 'calendar-year:2025', targetYear: 2025, price: 140,
        asOf: '2025-12-31', ticker: 'VWCE.DE', source: 'Synthetische Altquelle', ath: { value: 150, yearsSince: 2, evaluatedAsOf: '2025-12-31', lastHighAsOf: null } } };
const imported = normalizeBalanceImportDocument({ app: 'Ruhestand-Balancing', version: 'v21.1 Refactored (Engine v31)', payload: legacy });
assertEqual(imported.payload.inputs.liquidityRunwayYears, 4, 'Altbestand mit früherem Schlüssel runwayTargetMonths bleibt importierbar');
assert(!Object.hasOwn(imported.payload.annualMarketDataMeta.ath, 'reading'), 'Fehlende Lesart bleibt unverändert und bedeutet Jahresendregel');
for (const reading of ['year_end', 'year_high']) {
    const copy = structuredClone(after); copy.annualMarketDataMeta.ath.reading = reading;
    assertEqual(normalizeBalanceImportDocument(exported(copy)).payload.annualMarketDataMeta.ath.reading, reading, 'Import akzeptiert ' + reading);
}
const invalid = structuredClone(after); invalid.annualMarketDataMeta.ath.reading = 'automatic';
let rejected = false; try { normalizeBalanceImportDocument(exported(invalid)); } catch { rejected = true; }
assert(rejected, 'Unbekannte Lesart wird abgewiesen');

const annualInputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
const days = ['2025-12-31', '2026-06-15', '2026-12-31'].map(historyDay);
const dailyPrices = { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days, closes: [150, 250, 160.2], queried: [[days[0], days[2]]] } } };
storage.setItem(DAILY_PRICES_KEY, JSON.stringify(dailyPrices));
const prepared = prepareMarketPreview({ inputs: annualInputs, dailyPrices, today: '2026-12-31', yearEndDate: '2025-12-31', hasAnnualClose: true });
const run = market => EngineAPI.simulateSingleYear({ ...draft.before.engineInput, ...market }, draft.before.engineLastState);
const view = projectMarketPreview(prepared, { stored: run(prepared.inputs), rule: run(prepared.ruleInputs), high: run(prepared.highInputs) });
// FR-71 mit Grundrauschen (Nutzer 04.11.): unter 5 % ruhig, unter 10 % höchstens Hinweis, ab 10 % mit anderen Folgen Warnung.
for (const [price, state, expected] of [[237.75, 'same', 'calm'], [237.5, 'same', 'notice'], [237.75, 'budget_lower', 'calm'],
    [225.25, 'budget_lower', 'notice'], [225, 'budget_lower', 'warning'], [225, 'budget_higher', 'warning'],
    [225, 'budget_same_action_differs', 'warning'], [225, 'same', 'notice'], [237.75, 'not_reliable', 'not_reliable']]) {
    const copy = structuredClone(view); copy.quote.price = price; copy.comparison.state = state;
    assertEqual(classifyMarketPreview(copy).stage, expected, `Grenze ${((250 - price) / 250 * 100).toFixed(1)} % / ${state}`);
}
assertEqual(view.rule.deepBear.threshold, 120, 'Schwelle der bisherigen Regel aus gespeichertem Hoch');
const comparison = await projectAnnualMarketReadings({ targetYear: 2026, quote: marketData.etf, marketData, storage, engineLoader: { load: async () => EngineAPI } });
assertEqual(classifyMarketPreview(comparison).stage, 'warning', 'Echter Jahresvergleich mit vorgeschlagenen Bedarfen verlangt Wahl');
assertEqual(comparison.high.monthlyBudget, chosen.receipt.adopted.monthlyBudget, 'Vergleich und beschlossener Plan verwenden dieselbe Rechnung');
const planComparison = projectHouseholdPlanComparison({ year: 2027, scope: chosenDraft.scope, storage: annualRecordStorage({ ...records, ...chosen.records }) });
const result = projectAnnualCloseResult({ targetYear: 2026, confirmed: true, model: { planComparison, scope: chosenDraft.scope } });
const { doc: resultDoc } = createDialogFixture();
assert(createAnnualActionResult({ doc: resultDoc, result }).querySelector('[data-annual-market-choice-label]').textContent.includes('15.06.2026'), 'Handlungsanweisung nennt die gespeicherte Wahl');

// Produktiver Dialog mit echter Vorschlags-/Planrechnung: keine Vorauswahl, Sperren und Wechsel.
for (const selection of ['year_high', 'year_end']) {
    const { doc } = createDialogFixture(); let binding, lastEvaluation;
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    const people = captureCashPeople({ storage, registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, ids: draft.scope.ids });
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectMarketReadings: opts => projectAnnualMarketReadings({ ...opts, storage, engineLoader: { load: async () => EngineAPI } }),
        projectPreview: opts => projectAnnualPreview({ ...opts, storage }),
        evaluatePlan: async opts => { lastEvaluation = opts; return evaluateAnnualPlanPreview({ ...opts, storage, now, engineLoader: { load: async () => EngineAPI } }); } });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: marketData, errors: {} });
    const settle = () => new Promise(resolve => setTimeout(resolve, 30)); await settle();
    const all = root => [root, ...root.children.flatMap(all)];
    const marketTab = doc.querySelector('[data-close-dialog-activate="market"]');
    assert(!all(doc.body).some(el => el.type === 'radio' && el.checked), 'Keine Vorauswahl');
    assert(marketTab.getAttribute('aria-label').includes('Wahl offen'), 'Wahl offen schon vor erstem Besuch');
    await prepareCloseFixture(doc, { marketReading: null }); await settle(); binding.activate('market');
    const next = doc.querySelector('[data-close-dialog-next="market"]');
    assert(next.disabled && doc.getElementById('annualConfirmBtn').disabled, 'Weiter und Abschluss bis zur Wahl gesperrt');
    await next.fire('click'); assertEqual(marketTab.getAttribute('aria-current'), 'step', 'Auch programmatisches Weiter überspringt keine Wahl');
    const radio = doc.querySelector(`[data-annual-market-reading="${selection}"]`); radio.checked = true; await radio.fire('change'); await settle();
    assert(marketTab.getAttribute('aria-label').includes(selection === 'year_high' ? 'Jahreshoch' : 'Jahresendregel'), 'Reiter nennt die Wahl');
    assert(!doc.querySelector('[data-close-dialog-next="market"]').disabled, 'Weiter nach Wahl frei');
    await doc.querySelector('[data-close-dialog-next="market"]').fire('click');
    assert(doc.querySelector('[data-annual-market-plan-note]').children[0].textContent.includes('deine Wahl'), 'Plan nennt eigene Wahl');
    await doc.querySelector('[data-annual-market-change]').fire('click'); assertEqual(marketTab.getAttribute('aria-current'), 'step', 'Wahl ändern führt zu Marktdaten');
    binding.activate('preview');
    const floor = doc.getElementById('annualPlan_floorBedarf'); floor.value = '35.000'; await floor.fire('input'); await settle();
    assertEqual(Boolean(lastEvaluation.yearHigh), selection === 'year_high', 'Bedarfsänderung erhält die Wahl in der echten Rechnung');
    assert(!doc.getElementById('annualConfirmBtn').disabled, 'Gültiger Plan mit Wahl abschließbar');
    await doc.getElementById('annualConfirmBtn').fire('click'); const accepted = await pending;
    assertEqual(accepted.yearHigh?.asOf ?? null, selection === 'year_high' ? yearHigh.asOf : null, 'Nur Jahreshochwahl ergänzt Übergabevertrag');
    binding.close(true);
}

// Auch der koordinierte Transaktionspfad übernimmt nur die ausdrücklich bestätigte Hochwahl.
const service = await annualServiceFixture();
try {
    const coordinator = service.create({ confirmAnnual: async () => ({ yearHigh }) });
    const closed = await coordinator.close({ targetYear: 2026 });
    assertEqual(closed.status, 'already_committed', 'Koordinator bestätigt Abschluss mit Jahreshoch');
    assertEqual(JSON.parse(service.backend.get(key)).annualMarketDataMeta.ath.reading, 'year_high', 'Transaktion und Readback halten Jahreshoch');
    assertEqual(closed.results.etf.ath.lastHighAsOf, yearHigh.asOf, 'Ergebnis/Protokoll nennen gewähltes Hoch');
} finally { service.persistence.resetPersistenceRuntimeForTests(); }
