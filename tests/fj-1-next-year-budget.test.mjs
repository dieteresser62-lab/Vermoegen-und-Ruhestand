import { EngineAPI } from '../engine/index.mjs';
import { projectNextYearBudget } from '../app/balance/balance-next-year-budget.js';
import { computeAnnualPlanUpdate, captureAnnualRecords } from '../app/balance/balance-annual-storage.js';
import { evaluateAnnualDraft, commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { createManualAnnualQuote } from '../app/shared/annual-marketdata.js';
import { INFLATION_RESULT_METRIC } from '../app/balance/balance-annual-inflation.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { resolvePlanOverviewRates } from '../app/simulator/simulator-plan-overview.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { summarizeBalanceAction } from '../app/balance/balance-action-summary.js';
import { fjFixture, fixtureNow, stateKey, setPrices, changeProfiles } from './helpers/fj-1-fixtures.mjs';

const json = JSON.stringify;
const project = (storage, options = {}) => projectNextYearBudget({ storage, engineApi: EngineAPI, now: fixtureNow, ...options });
const inflation = (rate, year = 2026) => ({ rate, year, source: 'Jahresquelle im Test', dataAsOf: '2027-01-01',
    fetchStatus: 'ok_manual', metric: INFLATION_RESULT_METRIC });
const annualSources = view => ({ inflation: inflation(view.assumptions.find(item => item.kind === 'inflation').value, view.closingYear),
    etf: createManualAnnualQuote(view.quote.price, `calendar-year:${view.closingYear}`),
    cape: { capeRatio: view.assumptions.find(item => item.kind === 'cape').value, capeAsOf: `${view.closingYear}-12-01`,
        capeSource: 'Manuelle Ergänzung', capeFetchStatus: 'ok_fallback_stored', capeUpdatedAt: fixtureNow().toISOString() } });

// Abgleich mit tatsächlich ausgeführtem Jahrescommit, unverändertem Kurs und Bestand.
const household = fjFixture(), bytes = json(household.records), view = project(household);
assert(view.state !== 'not_reliable', 'Musterhaushalt liefert die Folgejahresprojektion: ' + view.reason);
assertEqual(view.closingYear, 2026, 'Nächster Abschluss ist 2026');
assertEqual(view.targetYear, 2027, 'Zieljahr ist das Folgeplanjahr');
assertEqual(view.rule.targetYear, 2027, 'Regel nennt Zieljahr');
assertEqual(view.high.targetYear, 2027, 'Hochreferenz nennt Zieljahr');
assertEqual(view.rule.floor, 31000, 'Grundbedarf übernimmt die gerundete Jahresempfehlung');
assertEqual(view.rule.monthlyBudget, 5100, 'Budget enthält Inflationsfortschreibung');
assertEqual(view.rule.annualIncome - view.current.annualIncome, 9600, 'Erikas Rentenbeginn Juli zählt sechs Monatsrenten');
assertEqual(view.rule.ageByPerson.muster_a, 68, 'Alter des Folgejahres statt heutiger Jahresbasis');
assertEqual(view.rule.reasons[0].kind, 'income', 'Größter Änderungsbetrag wird zuerst genannt');
for (const variant of [view.rule, view.high]) {
    assert(variant.reasons.length <= 3, 'Höchstens drei größte Änderungsgründe');
    assert(variant.reasons.every((reason, i, all) => !i || Math.abs(all[i - 1].amount) >= Math.abs(reason.amount)), 'Gründe nach Betrag sortiert');
    assertEqual(variant.components.length, 5, 'Rundung bleibt neben den bisherigen Wirkungen nachlesbar');
    assertEqual(variant.annualBudget, variant.monthlyBudget * 12, 'BP-1-Jahresbudget folgt dem gerundeten Monat');
    assertEqual(variant.releasedFlex, variant.annualBudget - variant.floor, 'Freigegebener Flex derselben Variante');
    assertEqual(json(variant.assumptions), json(view.assumptions), 'Annahmen identisch je Variante');
}
assertEqual(json(household.records), bytes, 'Projektion lässt alle Originalbytes unverändert');
const closingNow = () => new Date('2027-01-02T12:00:00Z');
changeProfiles(household.records, profile => {
    const state = JSON.parse(profile.data[stateKey]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'test-pre-close' };
    profile.data[stateKey] = json(state);
});
const draft = computeAnnualPlanUpdate({ targetYear: 2026, storage: household, marketData: annualSources(view), now: closingNow });
const evaluated = evaluateAnnualDraft(draft, { engineApi: EngineAPI, now: closingNow });
assertEqual(view.rule.monthlyBudget, Math.round(evaluated.monthlyBudget), '30.12.-Projektion trifft die tatsächliche Jahresrechnung');
assertEqual(view.rule.tax, evaluated.outcome.action.steuer, 'Steuer stimmt mit Jahresrechnung überein');
const committed = await commitAnnualPlanUpdate({ draft, storage: household, engineApi: EngineAPI, now: closingNow,
    persistence: { flush: async () => true, replaceRecordsTransactional: async (records, options) => {
        for (const [key, raw] of Object.entries(records)) household.setItem(key, raw);
        options.postValidate(household.records);
    } } });
assertEqual(committed.receipt.adopted.monthlyBudget, evaluated.monthlyBudget, 'Tatsächlicher Commit übernimmt dasselbe Monatsbudget');
assertEqual(json(committed.receipt.adopted.action), json(evaluated.outcome.action), 'Tatsächlicher Commit übernimmt dieselbe vollständige Handlungsanweisung');
assertEqual(view.rule.mainAction.type, committed.receipt.adopted.action.type, 'Projektion trifft festgeschriebenen Handlungstyp');
assertEqual(view.rule.mainAction.netAmount, summarizeBalanceAction(committed.receipt.adopted.action, committed.receipt.adopted.action).amount,
    'Projektion trifft das Netto der festgeschriebenen Hauptaktion');
assertEqual(view.rule.mainAction.netAmount, view.comparison.rule.mainAction.netAmount, 'Handlungsnetto bleibt seiner Variante zugeordnet');

// Januar vor Abschluss nutzt den vorbereiteten Jahreswert und keine Folgejahreskurse.
const january = fjFixture();
setPrices(january.records, [['2025-12-31', 150], ['2026-07-14', 200], ['2026-12-30', 170], ['2027-01-02', 230]]);
const januaryView = project(january, { now: closingNow, annualInflation: inflation(6) });
assert(januaryView.state !== 'not_reliable', 'Offener Januarabschluss wird unterstützt: ' + januaryView.reason);
assertEqual(januaryView.targetYear, 2027, 'Januar vor Abschluss plant 2027');
assertEqual(januaryView.quote.asOf, '2026-12-30', 'Januar-Vergleichskurs bleibt im Abschlussjahr');
assertEqual(januaryView.assumptions[0].value, 6, 'Vorbereitete Jahresinflation hat im Januar Vorrang');
assertEqual(januaryView.assumptions[0].source, 'Jahresquelle im Test', 'Januar nennt die tatsächliche Inflationsquelle');
const badInflation = project(january, { now: closingNow, annualInflation: inflation(6, 2025) });
assertEqual(badInflation.state, 'not_reliable', 'Falsches Inflationsjahr wird nicht still umgedeutet');
changeProfiles(january.records, profile => {
    const state = JSON.parse(profile.data[stateKey]);
    state.annualMarketDataMeta = { ...state.annualMarketDataMeta, inflation: inflation(4) };
    profile.data[stateKey] = json(state);
});
assertEqual(project(january, { now: closingNow }).assumptions[0].value, 4, 'Passender gespeicherter Januar-Jahreswert wird übernommen');

// Erledigter Abschluss projiziert den nächsten, ohne den alten erneut anzuwenden.
setPrices(household.records, [['2025-12-31', 150], ['2026-07-14', 200], ['2026-12-30', 170], ['2027-01-02', 171]]);
const afterClose = project(household, { now: closingNow });
assert(afterClose.state !== 'not_reliable', 'Nach erledigtem Abschluss ist die nächste Projektion verfügbar: ' + afterClose.reason);
assertEqual(afterClose.closingYear, 2027, 'Nach Abschluss ist 2027 das nächste Abschlussjahr');
assertEqual(afterClose.targetYear, 2028, 'Nach Abschluss zielt die Projektion auf 2028');
assertEqual(afterClose.quote.price, 171, 'Nach Abschluss ist der Januarkurs zulässig');

for (const rate of [2, 6]) {
    const storage = fjFixture('renate');
    changeProfiles(storage.records, profile => {
        const state = JSON.parse(profile.data[stateKey]); state.inputs.inflation = rate;
        profile.data[stateKey] = json(state);
    });
    const result = project(storage);
    assert(result.state !== 'not_reliable', rate + ' % Inflation rechnet');
    assertEqual(result.assumptions[0].value, rate, 'Simulator-Jahreswert wird mit ' + rate + ' % verwendet');
    assert(result.assumptions[0].source.includes('zuletzt eingetragener Jahreswert'), 'Simulator-Herkunft wird genannt');
    const next = evaluateAnnualDraft(computeAnnualPlanUpdate({ targetYear: 2026, storage, marketData: annualSources(result), now: closingNow }), { engineApi: EngineAPI, now: closingNow });
    assertEqual(result.rule.monthlyBudget, Math.round(next.monthlyBudget), rate + ' %: Parität zur bestehenden Jahresrechnung');
    assertEqual(result.rule.floor, next.values.floorBedarf, rate + ' %: identisch indexierter und gerundeter Grundbedarf');
}
const noInflation = fjFixture('renate');
changeProfiles(noInflation.records, profile => {
    const state = JSON.parse(profile.data[stateKey]); delete state.inputs.inflation;
    delete state.balanceInputFields?.inflation; profile.data[stateKey] = json(state);
});
const fallbackInflation = project(noInflation);
assertEqual(fallbackInflation.assumptions[0].value, resolvePlanOverviewRates({}).inflation.value,
    'Ohne eigenen Jahreswert gilt exakt das Reihenmittel der Simulator-Fortschreibung');
assert(fallbackInflation.assumptions[0].source.includes('kein eigener Wert'), 'Reihenmittel wird als Annahme mit Herkunft ausgewiesen');
const changedPlan = fjFixture('renate');
const planSource = buildBalanceEngineInputFromStorage({ storage: changedPlan, referenceYear: 2026 }).householdPlan;
const values = { ...planSource.entry.values, floorBedarf: planSource.entry.values.floorBedarf + 10000 };
changedPlan.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(planSource.raw, [{ scope: planSource.scope, values }], { now: fixtureNow }).raw);
const changedView = project(changedPlan);
assertEqual(changedView.rule.components.find(item => item.kind === 'inflation').amount,
    (values.floorBedarf + values.flexBedarf) * 0.02,
    'Bewusste Bedarfsänderung wird nicht als Inflation gegenüber dem Jahresbeleg ausgegeben');

const first = fjFixture('renate');
delete first.records[ANNUAL_PLAN_RECORD_KEY];
changeProfiles(first.records, profile => {
    delete profile.data[ANNUAL_PLAN_RECORD_KEY];
    profile.data.balance_expenses_v1 = json({ version: 1, activeYear: 2026, years: {} });
    const state = JSON.parse(profile.data[stateKey]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
    profile.data[stateKey] = json(state);
});
assertEqual(projectOverviewFromRecords({ registry: JSON.parse(first.records.rs_profiles_v1), activeId: first.records.rs_current_profile,
    liveData: first.records, now: fixtureNow() }).occasion.annualState, 'not_applicable', 'Erstjahrsfixture hat wirklich keinen fälligen Abschluss');
const firstView = project(first);
assert(firstView.state !== 'not_reliable', 'Erstes Planungsjahr ohne Abschluss wird unterstützt: ' + firstView.reason);
assertEqual(firstView.targetYear, 2027, 'Erstjahr plant den ersten Folgeplan');
assert(firstView.current.source.includes('ohne Abschluss'), 'Unbestätigte laufende Jahresbasis ist gekennzeichnet');

// Geplante Folgejahresposten verändern Reserve, nicht die normale Budgetregel.
const planned = fjFixture('renate'), basePlanned = project(planned);
const scope = buildBalanceEngineInputFromStorage({ storage: planned, referenceYear: 2026 }).scope;
planned.setItem('household_planned_expenses_v1', json({ version: 1, entries: { [scope.key]: { scope,
    items: [{ id: 'car', bezeichnung: 'Auto', betrag: 45000, monat: '2027-04', priceYear: 2026 }] } } }));
changeProfiles(planned.records, profile => {
    const incomes = JSON.parse(profile.data.profile_einkuenfte_v1);
    incomes.entries.push({ id: 'inflow', monat: '2027-03', betrag: 10000, bezeichnung: 'Einmaliger Eingang' });
    profile.data.profile_einkuenfte_v1 = json(incomes);
});
const plannedView = project(planned);
assert(plannedView.state !== 'not_reliable', 'Großer Folgejahresposten rechnet: ' + plannedView.reason);
assertEqual(plannedView.rule.plannedPosts.reserve, 45900, 'Großer Posten wird mit 2 % Preisfortschreibung im Folgejahr reserviert');
assertEqual(plannedView.rule.annualBudget, basePlanned.rule.annualBudget, 'Geplanter Posten ändert keine Budgetregel');
assertEqual(plannedView.rule.components.find(item => item.kind === 'planned_posts').amount, 35900, 'Ausgabe minus einmalige Einkunft als Jahresänderung');
assertEqual(plannedView.rule.components.find(item => item.kind === 'planned_posts').effect, 'planned_flows', 'Planposten werden getrennt vom normalen Budget erklärt');
assertEqual(plannedView.rule.components.find(item => item.kind === 'planned_posts').reserveChange, 45900, 'Einmaleinkunft mindert die bestehende Ausgabenreserve nicht');
assert(plannedView.rule.reasons.some(item => item.kind === 'planned_posts'), 'Großer Posten gehört zu den drei Hauptgründen');
assertEqual(plannedView.assumptions.find(item => item.kind === 'remaining_withdrawals').applied, false, 'Keine spekulativen Restentnahmen abgezogen');
assertEqual(plannedView.assumptions.find(item => item.kind === 'cape').asOf,
    buildBalanceEngineInputFromStorage({ storage: planned, referenceYear: 2026 }).householdPlan.entry.values.cape.asOf, 'CAPE zeigt tatsächliches Speicherdatum');

// Einpersonen-Rentenbeginn erst im Folgejahr.
const pension = fjFixture('renate');
changeProfiles(pension.records, profile => { profile.data.profile_rentenbeginn = '2027-07-01'; });
delete pension.records[ANNUAL_PLAN_RECORD_KEY];
const pensionView = project(pension);
assertEqual(pensionView.current.annualIncome, 0, 'Vor Rentenbeginn kein laufendes Renteneinkommen');
assertEqual(pensionView.rule.annualIncome, 8400, 'Einzelperson erhält sechs von zwölf Rentenmonaten');
assertEqual(pensionView.rule.components.find(item => item.kind === 'income').amount, 8400, 'Rentenbeginn wird mit Jahresbetrag begründet');

// BP-1-Sollfall nach dem Jahreswechsel, beide Varianten identisch bis auf Hoch/Alter.
const market = fjFixture();
changeProfiles(market.records, profile => {
    const state = JSON.parse(profile.data[stateKey]);
    for (const input of [state.inputs, state.profilverbundHouseholdInputs]) Object.assign(input,
        { endeVJ: 105, endeVJ_1: 100, endeVJ_2: 95, endeVJ_3: 90, ath: 105, jahreSeitAth: 0 });
    state.annualPeriodMetadata.lastCommittedPeriod = 'calendar-year:2026';
    state.profilverbundHouseholdLastState = { cumulativeInflationFactor: 1 };
    profile.data[stateKey] = json(state);
});
setPrices(market.records, [['2025-12-31', 100], ['2026-07-14', 140], ['2026-12-31', 105], ['2027-01-14', 140], ['2027-02-12', 103]]);
const seen = [];
const tracedEngine = { simulateSingleYear(input, last) { seen.push(structuredClone({ input, last })); return EngineAPI.simulateSingleYear(input, last); } };
const marketView = project(market, { now: () => new Date('2027-02-12T12:00:00Z'), engineApi: tracedEngine });
assert(marketView.state !== 'not_reliable', 'BP-1-Folgejahr rechnet: ' + marketView.reason);
assertEqual(marketView.targetYear, 2028, 'BP-1-Folgefall plant 2028');
assertEqual(marketView.state, 'budget_lower', 'BP-1-Folgejahr erkennt das tatsächlich niedrigere Budget');
assertEqual(marketView.rule.market.phase, 'side_long', 'Regelphase des Folgejahres aus Engine');
assertEqual(marketView.high.market.phase, 'bear_deep', 'Hochreferenzphase des Folgejahres aus Engine');
assertEqual(marketView.high.market.inputs.ath, 140, 'AR-2: Hoch seit Ende VJ wird verglichen');
assertEqual(marketView.high.market.high.asOf, '2027-01-14', 'Hochdatum bleibt zugeordnet');
assert(Math.abs(marketView.high.market.inputs.jahreSeitAth - 29 / 365.2425) < 1e-12, 'BP-1-Hochalter unverändert');
const withoutHigh = input => Object.fromEntries(Object.entries(input).filter(([key]) => !['ath', 'jahreSeitAth'].includes(key)));
assertEqual(json(withoutHigh(seen[0].input)), json(withoutHigh(seen[1].input)), 'Alle sonstigen Engine-Eingaben beider Varianten identisch');
assertEqual(json(seen[0].last), json(seen[1].last), 'Beide Varianten verwenden identisches fortgeschriebenes Budgetgedächtnis');
assertEqual(seen[0].last.cumulativeInflationFactor, 1.02, 'Inflationsfaktor wird einmal fortgeschrieben');
for (const nextPrice of [140, 145]) {
    setPrices(market.records, [['2025-12-31', 100], ['2026-07-14', 140], ['2026-12-31', 105], ['2027-01-14', 140], ['2027-02-12', nextPrice]]);
    const equal = project(market, { now: () => new Date('2027-02-12T12:00:00Z') });
    assertEqual(equal.state, 'same', 'Gleiches oder höheres aktuelles Hoch liefert same');
    assertEqual(json(equal.rule.market.inputs), json(equal.high.market.inputs), 'Gleiches Hoch hat exakt dieselben Markteingaben');
}
for (const [price, deep] of [[112, false], [111.86, true]]) {
    setPrices(market.records, [['2025-12-31', 100], ['2026-07-14', 140], ['2026-12-31', 105], ['2027-01-14', 140], ['2027-02-12', price]]);
    const boundary = project(market, { now: () => new Date('2027-02-12T12:00:00Z') });
    assertEqual(boundary.high.market.phase === 'bear_deep', deep, 'Folgejahr erhält strenge Bärengrenze bei 20,0/20,1 %');
}

// Fachuhr des Spielbereichs; keine Systemdatumsabhängigkeit bei expliziter Fachuhr.
try {
    setAppTestDate('2026-12-30');
    const play = projectNextYearBudget({ storage: fjFixture(), engineApi: EngineAPI });
    assertEqual(json(play), json(view), 'Spielbereich mit Testdatum liefert bytegleich denselben Entwurf');
} finally { setAppTestDate(null); }

// Jede öffentliche Speicher-/Snapshot-API sowie Lock-, Browser- und Netzwege überwachen.
const writes = [], restores = [];
function spyObject(object, label, except = []) {
    for (const key of Object.keys(object)) {
        if (except.includes(key) || typeof object[key] !== 'function') continue;
        const original = object[key];
        object[key] = () => { writes.push(label + '.' + key); throw new Error('Verbotener Projektionszugriff'); };
        restores.push(() => { object[key] = original; });
    }
}
const guarded = fjFixture();
spyObject(guarded, 'source', ['getItem', 'key']);
spyObject(PersistenceFacade, 'persistence');
spyObject(persistenceStorage, 'globalStorage');
spyObject(SnapshotArchive, 'snapshots');
spyObject(StorageManager, 'balanceStorage');
for (const [key, value] of Object.entries({ navigator: { locks: { request() { writes.push('lock'); throw new Error(); } } },
    localStorage: { setItem() { writes.push('local'); }, removeItem() { writes.push('local'); }, clear() { writes.push('local'); } },
    sessionStorage: { setItem() { writes.push('session'); }, removeItem() { writes.push('session'); }, clear() { writes.push('session'); } },
    fetch() { writes.push('fetch'); throw new Error(); } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
}
try {
    const before = json(captureAnnualRecords(guarded));
    const first = json(project(guarded));
    assert(!first.includes('not_reliable'), 'Projektion bleibt mit gesperrten APIs verfügbar');
    for (let i = 0; i < 3; i++) assertEqual(json(project(guarded)), first, 'Mehrfachaufruf liefert bytegleiches Ergebnis');
    assertEqual(json(captureAnnualRecords(guarded)), before, 'Alle Finanz-, Metadaten- und Registrybytes unverändert');
    assertEqual(project(guarded, { engineApi: { simulateSingleYear() { throw new Error('Testfehler'); } } }).state,
        'not_reliable', 'Auch die Fehlergrenze benötigt keine Speicher- oder Sperr-API');
    assertEqual(writes.length, 0, '0 Speicher-, Sperr-, Snapshot- oder Netzaufrufe');
} finally { restores.reverse().forEach(restore => restore()); }

// Fehlerkapsel: p25 rechnet weiter, Originalspeicher bleibt unberührt.
for (const [label, alter, options] of [
    ['Kurse fehlen', storage => delete storage.records[DAILY_PRICES_KEY]],
    ['Alter Kurs', storage => setPrices(storage.records, [['2025-12-31', 100], ['2026-01-02', 103]])],
    ['Lückenhafte Kurse', storage => { const data = JSON.parse(storage.records[DAILY_PRICES_KEY]); data.symbols['VWCE.DE'].queried = [[data.symbols['VWCE.DE'].days.at(-1), data.symbols['VWCE.DE'].days.at(-1)]]; storage.setItem(DAILY_PRICES_KEY, json(data)); }],
    ['Plan fehlt', storage => delete storage.records[HOUSEHOLD_PLAN_KEY]],
    ['Jahresstand unklar', storage => changeProfiles(storage.records, profile => { const state = JSON.parse(profile.data[stateKey]); state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'test' }; profile.data[stateKey] = json(state); })],
    ['Enginefehler', () => {}, { engineApi: { simulateSingleYear() { throw new Error('Rechenfehler im Test'); } } }]
]) {
    const source = fjFixture(); alter(source); const before = json(source.records);
    const failed = project(source, options);
    assertEqual(failed.state, 'not_reliable', label + ': gekapselt');
    assert(Boolean(failed.reason), label + ': Grund vorhanden');
    assertEqual(failed.comparison.state, 'not_reliable', label + ': BP-1-Zustand');
    assertEqual(json(source.records), before, label + ': keine Speicheränderung');
}
const fallbackStorage = fjFixture(), calculation = buildBalanceEngineInputFromStorage({ storage: fallbackStorage, referenceYear: 2026 });
const p25 = () => evaluateBalanceFileInputs({ inputData: calculation.inputData, persistentState: calculation.history.persistentState,
    profiles: calculation.profiles, profileId: calculation.profileId, engineApi: EngineAPI, publish: false,
    profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state) => evaluateStoredAnnualHousehold(input, profiles, state,
        { engineApi: EngineAPI, withdrawalMode: calculation.householdPlan.entry.values.householdWithdrawalMode }) },
    marketPreviewContext: { calculation, storage: fallbackStorage, now: fixtureNow() } });
const p25Before = json(p25());
project(fallbackStorage, { engineApi: { simulateSingleYear() { throw new Error('Fehlergrenze'); } } });
assertEqual(json(p25()), p25Before, 'Fehler der Folgejahresprojektion lässt p25 vollständig bytegleich');
