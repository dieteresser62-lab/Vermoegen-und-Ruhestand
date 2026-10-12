import { createOverviewWealthComparisonFixture, createOverviewFirstPlanningFixture } from './browser-smoke.test.mjs';
import { loadProfileIntoLocalStorage } from '../app/profile/profile-storage.js';
import { PersistenceFacade as fixturePersistence } from '../app/shared/persistence-facade.js';
import { createAnnualCloseArchiveReader } from '../app/shared/annual-close-evidence.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { readyAnnualFixture, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { projectOverviewFromRecords, projectOverviewWithAnnualArchive } from '../app/overview/overview-model.js';
import { projectAnnualClosePreparation, projectOverview, buildBalanceOverviewSummary, isPlanFixed, overviewPriceLabel, overviewPricesDone, overviewQuoteLabel, overviewAllocationView, overviewHistoryView } from '../app/overview/overview-model.js';
import { overviewScope, OVERVIEW_SUMMARY_KEY, summaryEntryKey } from '../app/overview/overview-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { deriveOverviewOccasion, deriveOverviewPlanningStart, overviewBackupAge, projectFocusExpenses, parseOverviewTarget } from '../app/overview/overview-model.js';
import { preflightAnnualPeriod } from '../app/balance/balance-annual-period.js';
import { persistenceStorage, resetPersistenceForTests, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { loadProfileRegistry } from '../app/profile/profile-registry.js';
import { storeOverviewSummary, storeMonthProvision } from '../app/overview/overview-storage.js';
import { beginSimulationSummary, completeSimulationSummary, workshopProvenanceFor } from '../app/simulator/simulator-overview-summary.js';
import { OVERVIEW_SIMULATION_KEY, projectSimulationSummaries } from '../app/overview/overview-simulation-summary.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { completedComparisonFixture } from './household-plan-comparison.test.mjs?fixture';

for (const options of [{}, { adjusted: true }, { receipt: false }, { preview: 'missing' }, { preview: 'invalid' }, { preview: 'stale' }]) {
    const f = completedComparisonFixture(options), before = JSON.stringify(f);
    const view = projectOverview({ registry: f.registry, activeId: 'z', liveData: f.records, now: f.now });
    assertEqual(view.occasion.annualState, 'done', 'Vergleichsprobe stellt ausdrücklich einen abgeschlossenen Jahreszustand her');
    assertEqual(view.planComparison.previewStatus, options.preview === 'stale' ? 'stale' : ['missing', 'invalid'].includes(options.preview) ? 'missing' : 'current', 'Aktualität stammt aus der heutigen Vorschau');
    if (options.receipt !== false) {
        assertEqual(view.summary.monthlyWithdrawal, 1500, 'FR-1: feste Startseitenanzeige verwendet ausschließlich adopted');
        assert(!view.nextSteps.some(step => step.id === 'action'), 'Materielle heutige Vorschau erzeugt neben dem beschlossenen Plan keine Umsetzungspflicht');
    }
    if (['missing', 'invalid'].includes(options.preview)) {
        assertEqual(view.previewSummary, null, 'Fehlende oder ungültige Vorschau fällt nicht auf den Beleg zurück');
        assertEqual(view.planComparison.rows[0].preview, '—', 'Vergleich zeigt keine ersatzweise Belegvorschau');
    } else {
        assertEqual(view.previewSummary.monthlyWithdrawal, 1600, 'Heutige Vorschau bleibt unabhängig vom beschlossenen Plan verfügbar');
        assertEqual(view.previewSummary.createdAt, options.preview === 'stale' ? '2026-10-08T12:00:00Z' : f.now.toISOString(), 'Vorschau bewahrt ihr eigenes Rechendatum');
        if (options.receipt !== false && options.preview !== 'stale') {
            assertEqual(view.planComparison.rows[0].delta.replaceAll('\u00a0', ' '), '+100 €', 'Delta wird gegen adopted gebildet');
            assertEqual(view.planComparison.rows[3].delta, '+5,0 Prozentpunkte', 'Liquiditätsdelta gegen beschlossenen Plan');
        }
    }
    assertEqual(view.planComparison.adjusted, Boolean(options.adjusted), 'Bewusste Anpassung bleibt sichtbar');
    assertEqual(view.planComparison.recordStatus, options.receipt === false ? 'missing' : 'valid', 'Fehlender Beleg bleibt unbelegt');
    assertEqual(JSON.stringify(f), before, 'Modellprojektion verändert weder Plan noch Beleg noch Registry');
}

const now = new Date(2026, 9, 6, 12);
const lot = { schemaVersion: 2, trancheId: 'synthetic', name: 'Synthetisch', shares: 2, purchasePrice: 10, currentPrice: 20,
    category: 'equity', type: 'aktien_neu', tqf: 0.3, taxExempt: false, ticker: '', isin: '', purchaseDate: '', notes: '' };
const meta = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null };
const data = { depot_tranchen: JSON.stringify([lot]), profile_tagesgeld: '100', [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: meta }) };
const registry = { version: 1, profiles: { a: { meta: { name: 'A' }, data }, b: { meta: { name: 'B' }, data: { ...data, profile_tagesgeld: '200' } } } };
const bytes = JSON.stringify(registry);
let model = projectOverview({ registry, activeId: 'a', liveData: data, now });
assertEqual(model.household.assets, 380, 'Vermögen: zwei Depots plus Tagesgeld, keine Reserve-Doppelsumme');
assertEqual(model.household.allocation.aktien_neu, 80, 'Allokation verwendet dieselben Tranchen');
assertEqual(model.household.allocation.cash, 300, 'Tagesgeld genau einmal je Person');
assertEqual(model.summary, null, 'Ohne Summary kein erfundener Plan');
assertEqual(overviewPriceLabel(model), 'Kurszeit unbekannt', 'Fehlendes asOf täuscht kein heute vor');
assertEqual(JSON.stringify(registry), bytes, 'Projektion mutiert keine Registry');
const scope = overviewScope('household', ['a', 'b']);
const summary = buildBalanceOverviewSummary({ modelResult: { ui: { spending: { monatlicheEntnahme: 900 }, liquiditaet: { deckungNachher: 110 }, market: { szenarioText: 'Synthetische Phase' } } }, monthlyBudget: 1500, metadata: meta, scope, now });
const raw = JSON.stringify({ version: 1, entries: { [summaryEntryKey(2026, scope)]: { ...summary, status: 'vorläufig' } } });
registry.profiles.a.data = { ...data, [OVERVIEW_SUMMARY_KEY]: raw }; registry.profiles.b.data[OVERVIEW_SUMMARY_KEY] = raw;
model = projectOverview({ registry, activeId: 'a', liveData: registry.profiles.a.data, now });
assertEqual(model.summary.monthlyWithdrawal, 900, 'Haushalt nimmt einen gemeinsamen Plan, keine Summe');
assertEqual(model.summary.monthlyBudget, 1500, 'Budget bleibt von Entnahme verschieden');
assertEqual(model.summary.status, 'fest', 'Leser gleicht vorläufige Commit-Summary nach Finalisierung ab');
assertEqual(isPlanFixed({ ...meta, pendingCommit: { periodId: 'calendar-year:2025' } }, 2026), false, 'Recovery ist kein fester Jahresplan');
registry.profiles.b.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ annualPeriodMetadata: { ...meta, pendingCommit: { periodId: 'calendar-year:2025' } } });
assertEqual(projectOverview({ registry, activeId: 'a', liveData: registry.profiles.a.data, now }).summary.status, 'vorläufig', 'Haushalt erst fest, wenn alle Mitglieder bestätigen');
registry.profiles.b.meta.belongsToHousehold = false;
assertEqual(projectOverview({ registry, activeId: 'a', liveData: registry.profiles.a.data, now }).summary, null, 'Geänderte Mitgliedschaft verwendet keinen alten Haushalt');
registry.profiles.a.meta.belongsToHousehold = false;
model = projectOverview({ registry, activeId: 'a', liveData: data, now });
assertEqual(model.members.length, 0, 'Leere Auswahl ersetzt nicht alle Profile');
assertEqual(model.household, null, 'Leere Auswahl erfindet keine Summe');
registry.profiles.a.meta.belongsToHousehold = true; registry.profiles.b.meta.belongsToHousehold = true;
registry.profiles.b.data.depot_tranchen = '{broken';
assertEqual(projectOverview({ registry, activeId: 'a', liveData: data, now }).complete, false, 'Beschädigter Haushaltsbestand ist unvollständig');
assertEqual(projectOverview({ registry: null, activeId: null, now }).available, false, 'Recovery legt keine Defaults an');

const quoteRegistry = structuredClone(registry);
quoteRegistry.profiles.b.data = { ...data };
quoteRegistry.profiles.a.data = { ...data };
const quoteSeconds = Math.floor(now.getTime() / 1000);
quoteRegistry.profiles.a.data.depot_tranchen = JSON.stringify([{ ...lot, asOf: quoteSeconds }]);
quoteRegistry.profiles.b.data.depot_tranchen = JSON.stringify([{ ...lot, asOf: quoteSeconds - 86400 }]);
const quotes = projectOverview({ registry: quoteRegistry, activeId: 'a', liveData: quoteRegistry.profiles.a.data, now });
assertEqual(quotes.quoteDate, new Date((quoteSeconds - 86400) * 1000).toISOString(), 'Kurszeit folgt dem ältesten echten UTC-Sekundenstand aller Mitglieder');
assert(overviewPriceLabel(quotes).includes(new Date((quoteSeconds - 86400) * 1000).toLocaleDateString('de-DE')), 'Kurszeit wird lokal angezeigt');

assertEqual(overviewPriceLabel({ ...quotes, priceReport: { status: 'running' } }), 'Kurse werden aktualisiert …', 'Echter Fortschrittsstatus bleibt erkennbar');
assertEqual(overviewPriceLabel({ ...quotes, priceReport: { status: 'complete', updated: 1, results: [{ status: 'updated' }, { status: 'skipped' }] } }), 'Kurse teilweise verfügbar', 'Echter Teilbericht bleibt trotz gespeichertem Kurszeitpunkt sichtbar');
assertEqual(overviewPriceLabel({ ...quotes, priceReport: { status: 'storage-failed' } }), 'Kursspeicherung nicht bestätigt', 'Unbestätigte Kurswrites täuschen keinen Erfolg vor');

const singleScope = overviewScope('single', ['a']);
const completed = year => ({ schemaVersion: 1, lastCommittedPeriod: 'calendar-year:' + year, pendingCommit: null });
const provision = (month, selectedScope = singleScope) => JSON.stringify({ version: 1, entries: {
    [JSON.stringify([month, selectedScope.key])]: { month, scope: selectedScope, completedAt: '2027-01-02T12:00:00Z' }
} });
const scenario = { now: new Date(2026, 11, 31, 23, 59), scope: singleScope, metadata: [completed(2025)], provisions: [provision('2026-11')],
    planning: deriveOverviewPlanningStart({ now, scope: singleScope, store: { years: { 2025: { months: { 1: { profiles: { a: { categories: {} } } } } } } } }) };
const scenarioBytes = JSON.stringify(scenario);
assertEqual(deriveOverviewOccasion(scenario).kind, 'play', '31. Dezember prüft November und Abschluss 2025');
assertEqual(JSON.stringify(scenario), scenarioBytes, 'Anlassfunktion verändert kein Argument');
const january = { ...scenario, now: new Date(2027, 0, 1) };
assertEqual(deriveOverviewOccasion(january).kind, 'annual', '1. Januar gibt neuem Vorjahresabschluss Vorrang');
assertEqual(deriveOverviewOccasion(january).closingYear, 2026, 'Januarabschluss betrifft das vorige Kalenderjahr');
const januaryDone = { ...january, metadata: [completed(2026)] };
assertEqual(deriveOverviewOccasion(januaryDone).kind, 'monthly', 'Januar nach Abschluss prüft offenen Dezember');
assertEqual(deriveOverviewOccasion(januaryDone).month, '2026-12', 'Dezember liegt im richtigen Vorjahr');
assertEqual(deriveOverviewOccasion({ ...januaryDone, provisions: [provision('2026-12')] }).kind, 'play', 'Erledigter Dezember führt zum Durchspielen');
const march = { ...januaryDone, now: new Date(2027, 2, 1), provisions: [] };
assertEqual(deriveOverviewOccasion(march).month, '2027-02', 'Monatsanfang prüft Februar');
assertEqual(deriveOverviewOccasion({ ...march, metadata: [completed(2025)], provisions: [provision('2027-02')] }).kind, 'annual', 'Verspäteter Jahresabschluss bleibt außerhalb Januar vorrangig');
assertEqual(deriveOverviewOccasion({ ...march, metadata: [completed(2028)] }).annualState, 'unclear', 'Widersprüchliche Zukunftsperiode wird nicht bestätigt');
assertEqual(deriveOverviewOccasion({ ...march, metadata: [null] }).annualState, 'unclear', 'Legacy bleibt ungeklärt');
assertEqual(deriveOverviewOccasion({ ...march, metadata: [completed(2026)], dataAvailable: false }).annualState, 'unavailable', 'Fehlende Daten sind nicht erledigt');
assertEqual(deriveOverviewOccasion({ ...march, metadata: [{ ...completed(2026), pendingCommit: { periodId: 'calendar-year:2026' } }] }).annualState, 'recovery', 'Recovery hat Vorrang');
assertEqual(deriveOverviewOccasion({ ...march, scope, metadata: [completed(2026), completed(2025)] }).kind, 'annual', 'Haushalt braucht jeden Jahresabschluss');
assertEqual(deriveOverviewOccasion({ ...march, scope, metadata: [completed(2026), completed(2026)], provisions: [provision('2027-02', scope), null] }).kind, 'monthly', 'Haushalt braucht jeden Monatshaken');
assertEqual(deriveOverviewOccasion({ ...march, provisions: [provision('2027-02', scope)] }).kind, 'monthly', 'Haushaltshaken täuscht keinen Einzelhaken vor');
for (const [days, warning, recommended] of [[7, false, false], [7 + 1 / 86400, false, true], [29.999, false, true], [30, true, true]]) {
    const age = overviewBackupAge(now, new Date(now.getTime() - days * 86400000).toISOString());
    assertEqual(age.warning, warning, days + ' Tage: Pillengrenze unabhängig');
    assertEqual(age.recommended, recommended, days + ' Tage: Fokusempfehlung unabhängig');
}
assertEqual(overviewBackupAge(now, null).recommended, true, 'Fehlende Sicherung wird empfohlen');
const expenseStore = { years: { 2026: { months: { 12: { profiles: { a: { categories: {} }, b: { categories: { food: -25 } }, foreign: { categories: { food: -900 } } } } } } } };
const expenseBytes = JSON.stringify(expenseStore);
assertEqual(projectFocusExpenses(expenseStore, singleScope, 2026, 12).complete, true, 'Gültiger Nullimport ist vollständig');
assertEqual(projectFocusExpenses(expenseStore, scope, 2026, 12).spent, 25, 'Ausgaben verwenden gefilterte Personen und bestehende Vorzeichen');
assertEqual(projectFocusExpenses(expenseStore, scope, 2027, 12).complete, false, 'Fehlender Monat ist kein Nullimport');
assertEqual(JSON.stringify(expenseStore), expenseBytes, 'Fokusausgaben bleiben schreibfrei');
for (const [page, hash] of [['balance', 'abschluss'], ['balance', 'jahresabschluss'], ['balance', 'ausgaben'], ['balance', 'ausgaben-import'], ['simulator', 'backtest'], ['simulator', 'monte-carlo'], ['simulator', 'annahmen'], ['simulator', 'werkstatt'], ['manager', 'personen']]) {
    assertEqual(parseOverviewTarget(page, { hash: '#' + hash }).target, hash === 'abschluss' ? 'jahresabschluss' : hash, 'Bekanntes Ziel: ' + hash);
}
assertEqual(parseOverviewTarget('balance', { hash: '#ausgaben-import', search: '?year=2026&month=12' }).month, 12, 'Validierte Monatsauswahl');
for (const search of ['?year=abc', '?year=1800', '?year=2026&month=13', '?year=2026&month=0', '?month=2', '?year=2026&year=2027', '?year=2026&month=01', '?execute=true']) {
    assertEqual(parseOverviewTarget('balance', { hash: '#ausgaben', search }), null, 'Ungültige Parameter lösen nichts aus: ' + search);
}
assertEqual(parseOverviewTarget('balance', { hash: '#unbekannt' }), null, 'Unbekannter Hash löst keine Aktion aus');
assertEqual(overviewPriceLabel({ ...quotes, quoteDate: now.toISOString(), priceReport: { status: 'offline', updated: 0 } }), 'Kursdienst nicht erreichbar · Kurse von heute', 'Offline täuscht trotz frischem gespeicherten Kurs keinen Abruf vor');
const januaryScope = overviewScope('single', ['a']);
const yearSummary = (year, monthlyBudget) => ({ ...summary, year, scope: januaryScope, monthlyBudget });
const januaryData = { ...data, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: completed(2026) }),
    [OVERVIEW_SUMMARY_KEY]: JSON.stringify({ version: 1, entries: {
        [summaryEntryKey(2026, januaryScope)]: yearSummary(2026, 100),
        [summaryEntryKey(2027, januaryScope)]: yearSummary(2027, 999)
    } }) };
const januaryRegistry = { version: 1, profiles: { a: { meta: { name: 'A' }, data: januaryData } } };
const januaryModel = projectOverview({ registry: januaryRegistry, activeId: 'a', liveData: januaryData, now: january.now });
assertEqual(januaryModel.summary.monthlyBudget, 999, 'Januarplan liest neues Planungsjahr');
assertEqual(januaryModel.expenseBudget, 100, 'Dezembervergleich liest ausschließlich Budget des Vorjahrs');
const withoutOldBudget = { ...januaryData, [OVERVIEW_SUMMARY_KEY]: JSON.stringify({ version: 1, entries: { [summaryEntryKey(2027, januaryScope)]: yearSummary(2027, 999) } }) };
assertEqual(projectOverview({ registry: januaryRegistry, activeId: 'a', liveData: withoutOldBudget, now: january.now }).expenseBudget, null, 'Fehlendes Vorjahresbudget wird nicht durch heutigen Plan ersetzt');

// Jahresband: unabhängige synthetische Monatswerte mit fremden und offenen Daten.
const { projectOverviewYear, projectOverviewWealth, projectOverviewSales } = await import('../app/overview/overview-model.js');
const { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry } = await import('../types/wealth-history-contract.js');
const yearStore = { years: { 2026: { months: {
    1: { profiles: { a: { categories: { food: -100 } }, b: { categories: {} }, foreign: { categories: { food: -9000 } } } },
    2: { profiles: { a: { categories: { food: -150 } }, b: { categories: { food: -50 } } } },
    3: { profiles: { a: { categories: { food: -400 } } } },
    4: { profiles: { a: { categories: {} }, b: { categories: {} } } },
    9: { profiles: { a: { categories: { food: -90000 } }, b: { categories: {} } } },
    10: { profiles: { a: { categories: { food: -80000 } }, b: { categories: {} } } }
} } } };
const yearBefore = JSON.stringify(yearStore);
const bandArgs = { store: yearStore, scope, now: new Date(2026, 8, 1), budgetSummary: { year: 2026, scope, monthlyBudget: 100 } };
const band = projectOverviewYear(bandArgs);
assertEqual(band.months.length, 12, 'Jahresband hat zwölf Monate');
assertEqual(band.total, 700, 'Jahressumme enthält vollständige und belegte Teilmonate, keine fremden/offenen Daten');
assertEqual(band.months[0].state, 'complete', 'Nullimport des Partners ist vollständig');
assertEqual(band.months[2].state, 'partial', 'Fehlender Partner macht Teilmonat');
assertEqual(band.months[3].spent, 0, 'Gültiger Nullmonat bleibt null Euro');
assertEqual(band.months[4].state, 'missing', 'Fehlender Import ist eigener Zustand');
assertEqual(band.months[8].state, 'open', 'Aktueller Monat bleibt offen trotz gespeicherter Daten');
assertEqual(band.months[9].spent, null, 'Zukünftiger Monat bleibt ausgeschlossen');
assertEqual(band.months[0].overBudget, false, 'Budgetgleichheit ist keine Überschreitung');
assertEqual(band.overBudgetCount, 2, 'Strikte Überschreitung zählt auch belegte Teilwerte, mit Unvollständigkeitsstatus');
assertEqual(band.highest.month, 3, 'Höchster Monat folgt derselben gefilterten Summe');
assertEqual(band.forecast, 1800, 'Median von 100 und 200 mal zwölf; Teilmonat ist keine belastbare Hochrechnungsbasis');
assertEqual(band.forecastIncomplete, true, 'Datenlücken werden an Hochrechnung kenntlich');
assertEqual(JSON.stringify(yearStore), yearBefore, 'Jahresprojektion ergänzt und mutiert keinen Eingabestore');
const averageBand = projectOverviewYear({ ...bandArgs, now: new Date(2026, 1, 1) });
assertEqual(averageBand.forecast, 1200, 'Ein positiver Datenmonat verwendet bestehende Durchschnittsregel');
assertEqual(projectOverviewYear({ ...bandArgs, store: null }).forecast, null, 'Leere Daten erzeugen keine Nullhochrechnung');
assertEqual(projectOverviewYear({ ...bandArgs, store: { years: { 2026: { months: { 1: yearStore.years[2026].months[4] } } } } }).forecast, null, 'Ein Nullimport mit übrigen fehlenden Monaten ist keine sichere Nullhochrechnung');
assertEqual(projectOverviewYear({ ...bandArgs, budgetSummary: { year: 2027, scope, monthlyBudget: 999 } }).budget, null, 'Fremdes Budgetjahr bleibt ausgeschlossen');
assertEqual(projectOverviewYear({ ...bandArgs, budgetSummary: { year: 2026, scope: singleScope, monthlyBudget: 999 } }).overBudgetCount, null, 'Fremder Budgetumfang liefert keine Überbudgetanzahl');
const emptyBand = projectOverviewYear({ ...bandArgs, budgetSummary: null, store: {} });
assertEqual(emptyBand.total, null, 'Leerer Bestand ist keine Nullsumme');
assertEqual(emptyBand.budget, null, 'Fehlender historischer Record liefert keine Linie');
const retrospective = projectOverviewYear({ ...bandArgs, now: new Date(2027, 0, 5), retrospective: true });
assertEqual(retrospective.year, 2026, 'Januarrückblick zeigt Vorjahr');
assertEqual(retrospective.lastMonth, 12, 'Rückblick betrachtet zwölf abgeschlossene Monate');
assertEqual(projectOverviewYear({ ...bandArgs, now: new Date(2027, 0, 5) }).lastMonth, 0, 'Erledigter Januar hat noch keinen abgeschlossenen Monat des laufenden Jahrs');

// Jahresgrenzen bleiben validiert, belegen in Schema 1 aber keinen historischen Umfang.
const amounts = total => ({ tagesgeld: total, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0 });
const historyState = { wealthHistory: { schemaVersion: 1, entries: [
    createManualWealthHistoryEntry(amounts(100), '2026-01-01'),
    createManualWealthHistoryEntry(amounts(120), '2026-07-01'),
    createAnnualWealthHistoryEntry(amounts(150), 2026)
] } };
const comparisonArgs = { states: [historyState], members: [{ id: 'a', valid: true, allocation: { gold: 0, anleihe: 0 } }], scope: singleScope,
    comparisonScope: singleScope, year: 2026, retrospective: true, currentAssets: 175 };
const missingScopeReason = 'Kein eindeutiger Vergleichsstand für diesen Profil-/Haushaltsumfang';
assertEqual(projectOverviewWealth(comparisonArgs).delta, null, 'Vollständiger Rückblick belegt keinen historischen Umfang (vormals 50)');
assertEqual(projectOverviewWealth(comparisonArgs).percent, null, 'Scheinbarer Einzelverlauf gibt auch keinen Prozentvergleich frei');
assertEqual(projectOverviewWealth(comparisonArgs).reason, missingScopeReason, 'Vollständige Grenzen scheitern ausdrücklich am fehlenden Umfang');
assertEqual(projectOverviewWealth({ ...comparisonArgs, retrospective: false }).delta, null, 'Manueller Jahresbeginn belegt keinen historischen Umfang (vormals 75)');
assertEqual(projectOverviewWealth({ ...comparisonArgs, year: 2027, retrospective: false }).delta, null, 'Bestätigtes Vorjahresende belegt keinen historischen Umfang (vormals 25)');
assertEqual(projectOverviewWealth({ ...comparisonArgs, states: [{ wealthHistory: { schemaVersion: 1, entries: historyState.wealthHistory.entries.slice(1) } }] }).delta, null, 'Stand mitten im Jahr ist kein Jahresbeginn');
assertEqual(projectOverviewWealth({ ...comparisonArgs, states: [{ wealthHistory: { schemaVersion: 1, entries: historyState.wealthHistory.entries.slice(0, 2) } }] }).delta, null, 'Rückblick benötigt bestätigtes Jahresende');
assertEqual(projectOverviewWealth({ ...comparisonArgs, comparisonScope: scope }).delta, null, 'Mitgliederwechsel erfindet keine Gesamtänderung');
for (const asset of ['gold', 'anleihe']) assertEqual(projectOverviewWealth({ ...comparisonArgs, members: [{ ...comparisonArgs.members[0], allocation: { [asset]: 1 } }] }).delta, null, 'Nicht erfasste Klasse blockiert Gesamtvergleich: ' + asset);
assertEqual(projectOverviewWealth({ ...comparisonArgs, states: [{ wealthHistory: { schemaVersion: 1, entries: [{ ...historyState.wealthHistory.entries[0], total: 999 }] } }] }).delta, null, 'Ungültiger Verlauf bleibt ohne Gesamtänderung');
assertEqual(projectOverviewWealth({ ...comparisonArgs, states: [{ wealthHistory: { schemaVersion: 1, entries: [{ ...historyState.wealthHistory.entries[0], total: 999 }] } }] }).reason,
    'Gespeicherter Vermögensverlauf ungültig', 'Beschädigter Verlauf behält seine spezifische Diagnose');
assertEqual(projectOverviewWealth({ ...comparisonArgs, retrospective: false, currentAssets: NaN }).reason,
    'Aktueller Bestand unvollständig', 'Unvollständiger heutiger Bestand bleibt eigenständig abgesichert');

// Zwei gespeicherte Haushaltsstände sind keine addierbaren Einzelstände.
const householdMembers = ['a', 'b'].map(id => ({ id, valid: true, allocation: { gold: 0, anleihe: 0 } }));
const householdHistory = start => ({ wealthHistory: { schemaVersion: 1, entries: [start,
    createAnnualWealthHistoryEntry(amounts(1100), 2027)] } });
const sharedHouseholdState = householdHistory(createAnnualWealthHistoryEntry(amounts(1000), 2026));
const householdComparisonArgs = { states: [sharedHouseholdState, structuredClone(sharedHouseholdState)],
    members: householdMembers, scope, comparisonScope: scope, year: 2027, retrospective: false, currentAssets: 1000 };
for (const start of [createAnnualWealthHistoryEntry(amounts(1000), 2026), createManualWealthHistoryEntry(amounts(1000), '2027-01-01')]) {
    for (const retrospective of [false, true]) {
        const args = { ...householdComparisonArgs, states: [householdHistory(start), householdHistory(start)], retrospective };
        const before = JSON.stringify(args);
        const comparison = projectOverviewWealth(args);
        assertEqual(comparison.delta, null, `${start.reason}, Rückblick ${retrospective}: Haushalt erfindet weder -1000 noch Nulländerung`);
        assertEqual(comparison.percent, null, `${start.reason}, Rückblick ${retrospective}: kein Haushaltsprozentvergleich`);
        assertEqual(comparison.reason, missingScopeReason, 'Vollständige Haushaltsgrenzen scheitern nur am Herkunftsnachweis');
        assertEqual(JSON.stringify(args), before, 'Haushaltsvergleich verändert weder Historie noch Mitgliedschaft');
    }
}

// Früherer Haushaltsstand bleibt in A, auch wenn heute nur A mit passender Summary ausgewählt ist.
const switchNow = new Date(2027, 9, 6, 12);
const switchMetadata = completed(2026);
function switchData(cash, selectedScope) {
    const plan = buildBalanceOverviewSummary({ modelResult: { ui: { spending: { monatlicheEntnahme: 100 } } }, monthlyBudget: 100,
        metadata: switchMetadata, scope: selectedScope, now: switchNow });
    return { depot_tranchen: '[]', profile_tagesgeld: String(cash),
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ ...sharedHouseholdState, annualPeriodMetadata: switchMetadata }),
        [OVERVIEW_SUMMARY_KEY]: JSON.stringify({ version: 1, entries: { [summaryEntryKey(2027, selectedScope)]: plan } }) };
}
const formerHousehold = { version: 1, profiles: {
    a: { meta: { name: 'A', belongsToHousehold: true }, data: switchData(400, scope) },
    b: { meta: { name: 'B', belongsToHousehold: true }, data: switchData(600, scope) }
} };
const formerProjection = projectOverview({ registry: formerHousehold, activeId: 'a', liveData: formerHousehold.profiles.a.data, now: switchNow });
assertEqual(formerProjection.household.assets, 1000, 'Aktueller Haushalt zählt 400 plus 600 genau einmal');
assertEqual(formerProjection.summary.scope.key, scope.key, 'Haushaltsfixture hat eine passende gemeinsame Summary');
assertEqual(formerProjection.comparison.reason, missingScopeReason, 'Vollständige Haushaltsprojektion sperrt trotz passender Summary');
assertEqual(formerProjection.comparison.delta, null, 'Vollständige Haushaltsprojektion erfindet keine Differenz');
assertEqual(formerProjection.comparison.percent, null, 'Vollständige Haushaltsprojektion erfindet keinen Prozentvergleich');
for (const removed of [false, true]) {
    const switched = structuredClone(formerHousehold);
    switched.profiles.a.data = switchData(400, singleScope);
    if (removed) delete switched.profiles.b;
    else switched.profiles.b.meta.belongsToHousehold = false;
    const before = JSON.stringify(switched);
    const projected = projectOverview({ registry: switched, activeId: 'a', liveData: switched.profiles.a.data, now: switchNow });
    assertEqual(projected.scope.key, singleScope.key, 'Heute ist A allein im ausgewählten Umfang');
    assertEqual(projected.summary.scope.key, singleScope.key, 'Passende Einzel-Summary darf die alte Historie nicht freigeben');
    assertEqual(projected.household.assets, 400, 'Aktueller Einzelbestand bleibt korrekt');
    const direct = projectOverviewWealth({ ...householdComparisonArgs, states: [sharedHouseholdState],
        members: [householdMembers[0]], scope: singleScope, comparisonScope: singleScope, currentAssets: 400 });
    for (const comparison of [direct, projected.comparison, projected.annual.comparison]) {
        assertEqual(comparison.delta, null, `Früheres Mitglied ${removed ? 'gelöscht' : 'ausgeschlossen'}: keine erfundene Einzeländerung`);
        assertEqual(comparison.percent, null, 'Früherer Haushaltsstand liefert keinen Einzelprozentvergleich');
        assertEqual(comparison.reason, missingScopeReason, 'Passende heutige Einzel-Summary belegt keinen historischen Umfang');
    }
    assertEqual(JSON.stringify(switched), before, 'Einzelprojektion schreibt weder Historie noch Mitgliedschaft');
    assertEqual(JSON.stringify(JSON.parse(switched.profiles.a.data[CONFIG.STORAGE.LS_KEY]).wealthHistory),
        JSON.stringify(sharedHouseholdState.wealthHistory), 'Früherer Haushaltsverlauf bleibt vollständig erhalten');
}

// Tatsächliche Verkaufsrecords, Bestätigungen und Korrekturen an der vorhandenen Lesergrenze.
const { previewTrancheReconciliation, previewCashPostingConfirmation, previewCashPostingCorrection } = await import('../app/tranches/tranche-reconciliation.js');
const saleRegistry = { version: 1, profiles: { a: { data: {} }, foreign: { data: {} } }, trancheReconciliation: { schemaVersion: 1, actions: [] } };
function addSale(id, profileId = 'a', executedAt = '2026-07-14', cashStatus = 'pending_manual_posting') {
    const action = { actionId: id, profileId, trancheId: lot.trancheId, executedAt, sharesSold: 1, grossProceeds: 110, fees: 10, cashStatus,
        ...(cashStatus === 'confirmed_already_reflected' ? { cashBalanceAfterPostingEur: 500, cashConfirmedAt: '2026-07-14T12:00:00Z' } : {}) };
    const record = structuredClone(previewTrancheReconciliation({ profileId, tranches: [lot], action, registry: saleRegistry }).auditRecord);
    saleRegistry.trancheReconciliation.actions.push(record); return record;
}
const actualSale = addSale('sale-1');
addSale('sale-2', 'a', '2026-07-14', 'confirmed_already_reflected');
addSale('pending');
const legacySale = addSale('legacy'); delete legacySale.eventType; delete legacySale.cashStatus;
addSale('foreign-sale', 'foreign'); addSale('next-year', 'a', '2027-07-14'); addSale('future-month', 'a', '2026-12-14');
saleRegistry.trancheReconciliation.actions.push(previewCashPostingConfirmation({ profileId: 'a', targetActionId: actualSale.actionId,
    cashBalanceAfterPostingEur: 1000, confirmedAt: '2026-07-15T12:00:00Z', registry: saleRegistry }).auditRecord);
saleRegistry.trancheReconciliation.actions.push(previewCashPostingCorrection({ profileId: 'a', targetActionId: actualSale.actionId,
    cashBalanceAfterPostingEur: 999, correctedAt: '2026-07-16T12:00:00Z', correctionReason: 'Synthetische Korrektur', registry: saleRegistry }).auditRecord);
const salesBytes = JSON.stringify(saleRegistry);
const salesProjection = projectOverviewSales(saleRegistry, singleScope, 2026, now);
assertEqual(salesProjection.count, 4, 'Vier tatsächliche Verkäufe; Cashereignisse und fremde/zukünftige Ausführungen zählen nicht');
assertEqual(salesProjection.net, 200, 'Nur zwei bestätigte Nettoerlöse; Cashkorrektur ist kein weiterer Erlös');
assertEqual(salesProjection.unconfirmed, 2, 'Offener und Legacy-Cashstatus bleiben kenntlich');
assertEqual(JSON.stringify(saleRegistry), salesBytes, 'Verkaufsprojektion bleibt rein lesend');
const duplicateSales = structuredClone(saleRegistry); duplicateSales.trancheReconciliation.actions.push(actualSale);
assertEqual(projectOverviewSales(duplicateSales, singleScope, 2026, now).count, null, 'Doppelte Action-ID ist ein ungültiger Verlauf, keine Doppelzählung');

const defaultData = { depot_tranchen: '[]', profile_tagesgeld: '0' };
const defaultRegistry = { version: 1, profiles: { a: { meta: { name: 'Default' }, data: defaultData } } };
assertEqual(projectOverview({ registry: defaultRegistry, activeId: 'a', liveData: defaultData, now }).firstStart, true, 'Leeres Defaultprofil zählt nicht als eigene Vermögensdaten');
assertEqual(projectOverview({ registry: defaultRegistry, activeId: 'a', liveData: defaultData, now, recovery: true }).firstStart, false, 'Recovery wird nicht als Erststart maskiert');
assertEqual(projectOverview({ registry: defaultRegistry, activeId: 'a', liveData: { ...defaultData, profile_tagesgeld: '1' }, now }).firstStart, false, 'Eigener Bestand beendet Erststart');
const marchOpen = projectOverview({ registry: januaryRegistry, activeId: 'a', liveData: { ...januaryData,
    [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: completed(2025) }) }, now: new Date(2027, 2, 1) });
assertEqual(marchOpen.annual.year, 2027, 'Offener Abschluss im März zeigt laufendes Jahr');
assertEqual(projectOverview({ registry: januaryRegistry, activeId: 'a', liveData: { ...januaryData,
    [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: completed(2025) }) }, now: new Date(2027, 0, 5) }).annual.year, 2026, 'Nur Januar mit offenem Abschluss zeigt Vorjahresband');
assertEqual(januaryModel.annual.year, 2027, 'Januar nach Abschluss zeigt laufendes Jahresband');
const boundaryRegistry = structuredClone(saleRegistry);
boundaryRegistry.trancheReconciliation.actions = [{ ...actualSale, executedAt: '2026-01-01' }];
assertEqual(projectOverviewSales(boundaryRegistry, singleScope, 2026, new Date(2026, 0, 1)).count, 1, 'Verkauf am 1. Januar folgt Kalendertag statt UTC-Zeitzonenverschiebung');

// Beschriftung und bisheriger Erledigthaken sind voneinander unabhängig.
const successfulQuotes = { ...quotes, priceTranches: quotes.priceTranches.map(t => ({ ...t, asOf: quoteSeconds })), quoteDate: now.toISOString(), priceReport: { status: 'complete', updated: 2,
    retrievedAt: new Date(2026, 9, 6, 9, 12).getTime(), results: quotes.priceTranches.map(t => ({ profileId: t.profileId, trancheId: t.trancheId || t.id, status: 'updated' })) } };
assertEqual(overviewPriceLabel(successfulQuotes), 'Kurse aktualisiert · heute 09:12', 'Uhrzeit stammt aus dem echten Abrufbericht');
assertEqual(overviewPricesDone(successfulQuotes), true, 'Umbenennung erhält Erledigthaken');
for (const retrievedAt of [undefined, null, 'ungültig']) {
    const withoutTime = { ...successfulQuotes, priceReport: { ...successfulQuotes.priceReport, retrievedAt } };
    assertEqual(overviewPriceLabel(withoutTime), 'Gespeicherte Kurse · Kurse von heute', 'Ohne Abrufzeit keine Musteruhrzeit');
    assertEqual(overviewPricesDone(withoutTime), true, 'Fehlende Abrufzeit ändert bisherigen Kurshaken nicht');
}
assertEqual(overviewQuoteLabel(successfulQuotes), 'Kurse von heute', 'Marktchip liest Kursdatum');
assertEqual(overviewQuoteLabel({ ...successfulQuotes, quoteDate: null }), 'Kurszeit unbekannt', 'Kein Marktchipdatum ohne Provenienz');
assertEqual(overviewPriceLabel({ ...successfulQuotes, quoteDate: quotes.quoteDate }), 'Kurse aktualisiert · heute 09:12', 'Erfolgreiche Abrufzeit bleibt unabhängig vom älteren Marktzeitpunkt sichtbar');
assertEqual(overviewPricesDone({ ...successfulQuotes, quoteDate: quotes.quoteDate }), true, 'Bestätigter heutiger Abruf erledigt auch einen älteren Kursstand');
const failureLabels = new Set();
for (const status of ['running', 'offline', 'timeout', 'storage-failed']) {
    const failed = { ...successfulQuotes, priceReport: { status, updated: 0, results: [{ status: 'failed' }] } };
    failureLabels.add(overviewPriceLabel(failed));
    assertEqual(overviewPricesDone(failed), false, 'Fehlbericht bleibt unerledigt: ' + status);
}
assertEqual(failureLabels.size, 4, 'Laufender, Offline-, Timeout- und Speicherfehlerbericht bleiben unterscheidbar');
assertEqual(overviewPricesDone({ ...successfulQuotes, priceReport: { status: 'complete', updated: 1, results: [{ status: 'updated' }, { status: 'failed' }] } }), false, 'Teilbericht bleibt unerledigt');
for (const status of [undefined, 'waiting', 'started', 'loading', 'running', 'recovery', 'unavailable', 'offline', 'timeout', 'changed', 'cancelled', 'storage-failed', 'complete']) {
    for (const updated of [0, 1]) for (const results of [undefined, [{ status: 'updated' }], [{ status: 'skipped' }]]) {
        const report = { status, updated, results };
        assertEqual(overviewPricesDone({ ...successfulQuotes, priceReport: report }), false, 'Unvollständiger oder unbelegter Bericht erhält keinen Haken: ' + status);
    }
}

for (const mismatched of [{ ...summary, year: 2025 }, { ...summary, scope: singleScope }]) {
    const fixtureRegistry = structuredClone(quoteRegistry);
    for (const profile of Object.values(fixtureRegistry.profiles)) profile.data[OVERVIEW_SUMMARY_KEY] = JSON.stringify({
        version: 1, entries: { [summaryEntryKey(2026, scope)]: mismatched } });
    assertEqual(projectOverview({ registry: fixtureRegistry, activeId: 'a', liveData: fixtureRegistry.profiles.a.data, now }).summary, null,
        'Unpassendes Summaryjahr oder unpassender Umfang bleibt leer');
}

// Planungsbeginn: echte, unveränderte Live-/Registrybytes und vier Belegarten.
const firstYearState = { wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(amounts(100), '2026-01-01')] } };
const summaryRaw = (year, selected = singleScope, extra = {}) => JSON.stringify({ version: 1, entries: {
    [summaryEntryKey(year, selected)]: { year, scope: selected, monthlyWithdrawal: 50, monthlyBudget: 80,
        createdAt: '2030-01-01T12:00:00Z', ...extra }
} });
const expensesRaw = years => JSON.stringify({ version: 1, activeYear: 1900, years });
const expenseMonth = (...ids) => ({ profiles: Object.fromEntries(ids.map(id => [id, { categories: {} }])) });
const firstYearData = { depot_tranchen: '[]', profile_tagesgeld: '100', [CONFIG.STORAGE.LS_KEY]: JSON.stringify(firstYearState),
    balance_expenses_v1: expensesRaw({ 2026: { months: { 1: expenseMonth('a') } } }), [OVERVIEW_SUMMARY_KEY]: summaryRaw(2026) };
function firstYearProjection(live = firstYearData, date = new Date(2027, 0, 5), other = null, options = {}) {
    const selected = { version: 1, profiles: { a: { meta: { name: 'A' }, data: firstYearData }, ...(other || {}) } };
    const before = JSON.stringify({ selected, live });
    const result = projectOverview({ registry: selected, activeId: 'a', liveData: live, now: date, ...options });
    assertEqual(JSON.stringify({ selected, live }), before, 'Planungsleser bewahrt sämtliche Quellbytes');
    return result;
}
for (let month = 0; month < 12; month++) {
    const date = new Date(2026, month, 5);
    const initial = firstYearProjection(firstYearData, date);
    assertEqual(initial.firstPlanningYear, 2026, 'Beginn aus echten Belegen im Monat ' + month);
    assertEqual(initial.occasion.kind, month === 0 ? 'start' : 'monthly', 'Kein Jahresabschluss 2025 im Monat ' + month);
    assertEqual(initial.annual.retrospective, false, 'Kein planfremder Rückblick im Monat ' + month);
    assertEqual(initial.year, 2026, 'Kopfpille behält Planungsjahr');
    const previous = initial.occasion.month;
    const withHook = firstYearProjection({ ...firstYearData, overview_month_provision_v1: provision(previous) }, date);
    assertEqual(withHook.occasion.kind, month === 0 ? 'start' : 'play', 'Vormonatshaken gilt auch im ersten Jahr: ' + previous);
    if (month === 0) {
        assertEqual(JSON.stringify(initial.expenses.rows), '[]', 'Dezember vor Beginn erzeugt keine fehlenden Personenrecords');
        assertEqual(initial.expenses.beforePlanning, true, 'Monat vor Beginn bleibt ausdrücklich erkennbar');
        assertEqual(initial.expenses.complete, false, 'Monat vor Beginn wird nicht als Nullimport erfunden');
        assertEqual(initial.expenses.spent, null, 'Vor Beginn gibt es keinen erfundenen Ausgabenbetrag');
    }
    if (month === 2) assertEqual(initial.expenses.rows[0].present, false, 'Fehlender Februar innerhalb Startjahr bleibt fehlend');
}
const firstClosing = firstYearProjection();
assertEqual(firstClosing.occasion.annualState, 'open', 'Erster regulärer Abschluss 2026 ist offen');
assertEqual(firstClosing.annual.year, 2026, 'Erster Januarabschluss zeigt genau das Vorjahr');
assertEqual(firstClosing.annual.retrospective, true, 'Erster Abschluss zeigt Rückblick');
assertEqual(firstClosing.expenses.missingMonths.length, 11, 'Genaue elf fehlende Monate bleiben im Modell');
assertEqual(preflightAnnualPeriod({ targetYear: 2026, currentAge: 67, metadata: null }).status,
    'legacy_confirmation_required', 'Balance behält trotz offener Übersicht die einmalige Bestätigung');
for (const source of [
    { [CONFIG.STORAGE.LS_KEY]: JSON.stringify(firstYearState) },
    { balance_expenses_v1: firstYearData.balance_expenses_v1 },
    { [OVERVIEW_SUMMARY_KEY]: summaryRaw(2026) }
]) {
    assertEqual(firstYearProjection({ depot_tranchen: '[]', profile_tagesgeld: '100', ...source }).firstPlanningYear, 2026,
        'Jede gültige Einzelquelle belegt denselben Beginn');
}
for (const year of [2026, 2032]) {
    const empty = firstYearProjection({ depot_tranchen: '[]', profile_tagesgeld: '100' }, new Date(year, 0, 5));
    assertEqual(empty.firstPlanningYear, year, 'Ohne Belege gilt injiziertes laufendes Jahr ' + year);
    assertEqual(empty.occasion.kind, 'start', 'Ohne Belege kein Vorjahresanlass ' + year);
}
const oldData = { ...firstYearData, balance_expenses_v1: expensesRaw({
    2024: { months: { 1: expenseMonth('a') } }, 2025: { months: { 12: expenseMonth('a') } }
}) };
const legacy = firstYearProjection(oldData, new Date(2026, 0, 5));
assertEqual(legacy.occasion.annualState, 'open', 'Ältere Daten ohne Abschlussindiz lassen das aktuelle Jahr offen');
assertEqual(legacy.occasion.annualReason, undefined, 'Ältere Jahreszahlen allein erfordern keine Klärung');
const annualHistory = { wealthHistory: { schemaVersion: 1, entries: [createAnnualWealthHistoryEntry(amounts(100), 2026)] } };
const unmarked = firstYearProjection({ ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(annualHistory) });
assertEqual(unmarked.occasion.annualState, 'done', 'Passender Jahresverlauf bestätigt den Abschluss auch ohne Periodenvermerk');
assertEqual(unmarked.firstPlanningYear, 2026, 'Jahresenddatum erfindet kein vorheriges Planungsjahr');
for (const [state, expected, reason] of [
    [{ ...firstYearState, annualPeriodMetadata: completed(2028) }, 'unclear', 'contradictory_metadata'],
    [{ ...firstYearState, annualPeriodMetadata: { schemaVersion: 99, lastCommittedPeriod: null, pendingCommit: null } }, 'unclear', 'contradictory_metadata'],
    [{ ...firstYearState, annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', phase: 'snapshot_confirmed', snapshotId: 'synthetic' } } }, 'recovery', undefined]
]) {
    const projected = firstYearProjection({ ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) });
    assertEqual(projected.occasion.annualState, expected, 'Erster Abschluss verdeckt keinen Sonderzustand');
    assertEqual(projected.occasion.annualReason, reason, 'Sonderzustand behält eigenen Grund');
}
assertEqual(firstYearProjection(firstYearData, new Date(2027, 0, 5), null, { recovery: true }).occasion.annualState, 'recovery', 'Allgemeine Recovery bei belegtem Vorjahr bleibt vorrangig');
assertEqual(firstYearProjection(firstYearData, new Date(2026, 0, 5), null, { recovery: true }).occasion.annualState, 'recovery', 'Recovery bleibt auch vor Planungsbeginn als Wiederherstellungsanlass sichtbar');
assertEqual(firstYearProjection({ ...firstYearData, depot_tranchen: '{broken' }).occasion.annualState, 'unavailable', 'Fehlender notwendiger Bestand bleibt eigener Zustand');
assertEqual(firstYearProjection({ ...firstYearData, [CONFIG.STORAGE.LS_KEY]: '{broken' }).occasion.annualState, 'unavailable', 'Beschädigter Fachstate wird nicht als fehlende Metadaten freigegeben');
for (const invalidMetadata of [false, 0, '', [], { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:1800', pendingCommit: null }]) {
    assertEqual(firstYearProjection({ ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ ...firstYearState, annualPeriodMetadata: invalidMetadata }) }).occasion.annualReason,
        'contradictory_metadata', 'Vorhandene ungültige Metadaten werden nicht zu Legacy normalisiert');
}
const withConfirmed = { ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ ...firstYearState, annualPeriodMetadata: completed(2026) }) };
assertEqual(firstYearProjection(withConfirmed).occasion.kind, 'monthly', 'Bestätigtes Vorjahr gibt Monatsanlass frei');
assertEqual(firstYearProjection(withConfirmed).annual.retrospective, false, 'Bestätigtes Vorjahr hat keinen Rückblick');
assertEqual(firstYearProjection({ ...withConfirmed, [OVERVIEW_SUMMARY_KEY]: '{broken' }).occasion.kind,
    'monthly', 'Beschädigte Anzeige-Summary hebt einen gültigen bestätigten Abschluss nicht auf');
assertEqual(firstYearProjection({ ...withConfirmed, overview_month_provision_v1: provision('2026-12') }).occasion.kind, 'play', 'Bestätigtes Vorjahr und Dezemberhaken geben Durchspielen frei');
const otherPerson = state => ({ b: { meta: { name: 'B' }, data: { depot_tranchen: '[]', profile_tagesgeld: '100', [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) } } });
assertEqual(firstYearProjection(firstYearData, new Date(2027, 0, 5), otherPerson({ annualPeriodMetadata: completed(2026) })).occasion.annualState, 'done', 'Eindeutiger gemeinsamer Ablagestand bestätigt den Abschluss ohne persönlichen Vermerk bei A');
assertEqual(firstYearProjection(firstYearData, new Date(2027, 0, 5), otherPerson({ annualPeriodMetadata: completed(2025) })).occasion.annualState, 'open', 'Eindeutiger älterer Ablagestand erlaubt den regulären Folgeabschluss');
assertEqual(firstYearProjection(firstYearData, new Date(2027, 0, 5), otherPerson({ annualPeriodMetadata: completed(2028) })).occasion.annualState, 'unclear', 'Widerspruch eines Partners bleibt vorrangig');

// Quellenfehler verhindern nur die Legacy-Ausnahme, keinen regulär offenen Folgeabschluss.
const followUpData = { ...firstYearData,
    [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ ...firstYearState, annualPeriodMetadata: completed(2025) }) };
for (const [source, damaged] of [
    ['Summarycontainer', { [OVERVIEW_SUMMARY_KEY]: '{broken' }],
    ['Ausgabenstore', { balance_expenses_v1: '{broken' }],
    ['Ausgabenrecord 2022', { balance_expenses_v1: expensesRaw({
        2022: { months: { 1: { profiles: { a: { categories: { total: 'broken' } } } } } },
        2026: { months: { 1: expenseMonth('a') } }
    }) }]
]) {
    for (const [label, partner] of [
        ['ready', null],
        ['ready/ready', otherPerson({ annualPeriodMetadata: completed(2025) })],
        ['ready/already_committed', otherPerson({ annualPeriodMetadata: completed(2026) })]
    ]) {
        const projected = firstYearProjection({ ...followUpData, ...damaged }, new Date(2027, 0, 5), partner);
        const context = label + ' mit beschädigtem ' + source;
        assertEqual(projected.metadata.map(metadata => preflightAnnualPeriod({ targetYear: 2026, currentAge: 0, metadata }).status).join('/'),
            label, context + ': echte Preflightstatus');
        assert(projected.planning.errors.length > 0, context + ': Quellenfehler bleibt im Modell');
        assertEqual(projected.occasion.kind, 'annual', context + ': Jahresanlass bleibt bestehen');
        assertEqual(projected.occasion.annualState, label === 'ready/already_committed' ? 'unclear' : 'open', context + ': widersprüchliche Ablagen werden geklärt');
        assertEqual(projected.occasion.annualReason, label === 'ready/already_committed' ? 'contradictory_metadata' : undefined, context + ': Quellenfehler verdeckt keinen Periodenwiderspruch');
    }
}

const irrelevant = { ...firstYearData, balance_expenses_v1: expensesRaw({
    1900: { months: {} }, 2020: { months: { 1: expenseMonth('foreign') } },
    2021: { months: { 0: expenseMonth('a'), 13: expenseMonth('a'), '01': expenseMonth('a') } },
    2022: { months: { 1: { profiles: { a: { categories: { total: 'broken' } } } } } },
    2026: { months: { 1: expenseMonth('a') } }
}), [OVERVIEW_SUMMARY_KEY]: summaryRaw(2010, overviewScope('single', ['foreign'])) };
assertEqual(firstYearProjection(irrelevant).firstPlanningYear, 2026, 'Leere Jahre, fremde Personen, ungültige Monate und Kategorien sowie fremde Summary zählen nicht');
assertEqual(firstYearProjection(irrelevant).occasion.annualReason, 'invalid_evidence', 'Ungültiger ausgewählter Ausgabenbeleg bleibt kenntlich');
assertEqual(firstYearProjection({ ...firstYearData, [OVERVIEW_SUMMARY_KEY]: summaryRaw(2000, singleScope, { monthlyBudget: 'broken' }) }).firstPlanningYear, 2026, 'Beschädigte Summary zieht Beginn nicht zurück');
assertEqual(firstYearProjection({ ...firstYearData, [OVERVIEW_SUMMARY_KEY]: '{broken' }).occasion.annualReason, 'invalid_evidence', 'Beschädigter Summarycontainer gibt erste Ausnahme nicht frei');
assertEqual(firstYearProjection({ ...firstYearData, balance_expenses_v1: '{broken' }).occasion.annualReason, 'invalid_evidence', 'Beschädigter Ausgabenstore gibt erste Ausnahme nicht frei');
const corruptHistory = { wealthHistory: { schemaVersion: 1, entries: [{ ...firstYearState.wealthHistory.entries[0], total: 999 }] } };
assertEqual(firstYearProjection({ ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(corruptHistory) }).firstPlanningYear, 2026, 'Beschädigter Verlauf zieht Beginn nicht zurück');
assertEqual(firstYearProjection({ ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(corruptHistory) }).occasion.annualState, 'unavailable', 'Beschädigter Verlauf wird nicht durch erste Ausnahme verdeckt');

// Jede Belegart kann bei jeder Person das Minimum liefern, ohne Haushaltssummen zu addieren.
for (const id of ['a', 'b']) for (const kind of ['committed', 'pending', 'expenses', 'wealth', 'summary']) {
    const index = scope.ids.indexOf(id), metadata = [null, null], states = [null, null], summarySources = [null, null];
    let store = null;
    if (kind === 'committed') metadata[index] = completed(2024);
    if (kind === 'pending') metadata[index] = { pendingCommit: { periodId: 'calendar-year:2024' } };
    if (kind === 'expenses') store = { years: { 2024: { months: { 1: expenseMonth(id) } } } };
    if (kind === 'wealth') states[index] = firstYearState;
    if (kind === 'summary') summarySources[index] = summaryRaw(2024, scope);
    const start = deriveOverviewPlanningStart({ now: new Date(2030, 0, 5), scope, metadata, states, summarySources, store });
    assertEqual(start.firstPlanningYear, kind === 'wealth' ? 2026 : 2024, id + ': Minimum aus ' + kind);
    assert(start.evidence.some(entry => entry.id === id && entry.kind === kind), id + ': Belegzuordnung aus ' + kind);
}
const mixedStart = deriveOverviewPlanningStart({ now: new Date(2030, 0, 5), scope,
    metadata: [completed(2024), { pendingCommit: { periodId: 'calendar-year:2022' } }], states: [firstYearState, annualHistory],
    summarySources: [summaryRaw(2025, scope), summaryRaw(2021, scope)],
    store: { years: { 2023: { months: { 1: expenseMonth('a', 'b') } } } } });
assertEqual(mixedStart.firstPlanningYear, 2021, 'Minimum berücksichtigt alle Belegarten beider Personen gemeinsam');
assertEqual(new Set(mixedStart.evidence.map(entry => entry.kind)).size, 6, 'Alle Quellen werden auch bei schon gefundenem älteren Jahr gelesen');
const reversedRegistry = { version: 1, profiles: { b: otherPerson({ annualPeriodMetadata: completed(2026) }).b,
    a: { meta: { name: 'A' }, data: { ...firstYearData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(annualHistory) } } } };
const reversed = projectOverview({ registry: reversedRegistry, activeId: 'a', liveData: reversedRegistry.profiles.a.data, now: new Date(2027, 0, 5) });
assertEqual(reversed.occasion.annualState, 'done', 'Passender Jahresstand ergänzt den fehlenden Vermerk unabhängig von der Registryreihenfolge');

const gapMonths = (missingA, missingB) => Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    return [month, expenseMonth(...['a', 'b'].filter(id => !(id === 'a' ? missingA : missingB).includes(month)))];
}));
for (const [missingA, missingB] of [[[10, 11, 12], [10, 11, 12]], [[], [12]], [[1, 5, 12], [2, 4]]]) {
    const gaps = firstYearProjection({ depot_tranchen: '[]', profile_tagesgeld: '100', balance_expenses_v1: expensesRaw({ 2026: { months: gapMonths(missingA, missingB) } }) },
        new Date(2027, 0, 5), otherPerson({}));
    const expected = Array.from({ length: 12 }, (_, index) => index + 1).flatMap(month => ['a', 'b']
        .filter(id => (id === 'a' ? missingA : missingB).includes(month)).map(id => ({ id, month })));
    assertEqual(JSON.stringify(gaps.expenses.missingMonths), JSON.stringify(expected), 'Kompakte Anzeige behält exakte fehlende Personenmonate');
}

// P8: derselbe Live-/Registryvertrag gilt auch für die Tageshistorie.
const { historyDay: dailyDay } = await import('../app/tranches/tranchen-history-store.js');
const dailyStart = dailyDay('2026-01-01');
const dailyLot = { ...lot, trancheId: 'daily', shares: 1, purchaseDate: '2026-01-01', ticker: 'DAILY.DE' };
const dailyData = { profile_tagesgeld: '5', depot_tranchen: JSON.stringify([dailyLot]), profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 5, entries: [] }) };
const dailyRegistry = { profiles: { a: { meta: { name: 'A' }, data: { ...dailyData, profile_tagesgeld: '999' } },
    b: { meta: { name: 'B' }, data: { ...dailyData } }, outsider: { meta: { name: 'Außen', belongsToHousehold: false }, data: { profile_tagesgeld: '10000', depot_tranchen: '[]' } } } };
const dailyLive = { ...dailyData, rs_wealth_history_start_v1: JSON.stringify({ version: 1, startDate: '2026-01-01' }),
    rs_daily_prices_v1: JSON.stringify({ version: 1, symbols: { 'DAILY.DE': { currency: 'EUR', days: [dailyStart], closes: [10], queried: [[dailyStart, dailyStart + 4]], failures: 0, lastError: null } } }) };
const dailyBytes = JSON.stringify({ dailyRegistry, dailyLive });
const dailyModel = projectOverview({ registry: dailyRegistry, activeId: 'a', liveData: dailyLive, now: new Date(2026, 0, 6), historyPeriod: 'all' });
// Anzeigegrenze: nur Allokationen werden kopiert; keine zweite Fachbewertung.
{
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    for (const [old, fresh, expected] of [[600000, 400000, 1000000], [600000, 0, 600000], [0, 400000, 400000], [0, 0, 0], [null, 400000, null], [600000, undefined, null], [NaN, 0, null]]) {
        const allocation = freeze({ anleihe: 3, aktien_alt: old, gold: 4, aktien_neu: fresh, cash: 5 });
        const before = JSON.stringify(allocation), view = overviewAllocationView(allocation);
        assertEqual(view.aktien, expected, 'Aktienansicht erhält bekannte Summe, Null und Unbekannt');
        assertEqual(Object.keys(view).join(','), 'anleihe,aktien,gold,cash', 'Aktien an erster Aktienposition; andere Formen reihenfolgegleich');
        assert(view.anleihe === 3 && view.gold === 4 && view.cash === 5, 'Andere Anlagen wertgleich');
        assertEqual(JSON.stringify(allocation), before, 'Tief eingefrorene Allokation bleibt bytegleich');
    }
    assertEqual(overviewAllocationView(freeze({ aktien_alt: 600000 })).aktien, null, 'Ohne Typenbeleg ist fehlendes Segment unbekannt');
    for (const key of ['aktien_alt', 'aktien_neu']) {
        assertEqual(overviewAllocationView(freeze({ [key]: 7 }), [key]).aktien, 7, 'Explizit eingeschränkte Reihe enthält nur ' + key);
        assertEqual(overviewAllocationView(freeze({ [key]: null }), [key]).aktien, null, 'Unbekanntes vorhandenes Segment bleibt unbekannt: ' + key);
    }
    const source = freeze(dailyModel.history), before = JSON.stringify(source), view = overviewHistoryView(source);
    assertEqual(view.types.join(','), 'aktien,cash', 'Verlauf ersetzt Typen nur in Ansicht');
    assert(view !== source && view.points !== source.points && view.end === view.points.at(-1), 'Neue Ansichtspunkte mit passendem Endverweis');
    view.points.forEach((p, i) => {
        assert(p !== source.points[i] && p.allocation !== source.points[i].allocation, 'Eigene Punkt-/Allokationskopie');
        assertEqual(p.allocation.aktien, source.points[i].allocation.aktien_neu + source.points[i].allocation.aktien_alt, 'Absolute Aktienbeträge');
        const { allocation: ignoredView, ...viewRest } = p;
        const { allocation: ignoredSource, ...sourceRest } = source.points[i];
        assertEqual(JSON.stringify(viewRest), JSON.stringify(sourceRest), 'Total, known, Qualität und Personenwerte bytegleich');
        assert(p.byProfile === source.points[i].byProfile, 'Personenprojektion bleibt Alt-/Neu-Fachobjekt');
    });
    for (const key of ['metrics', 'measurementStart', 'range', 'gaps', 'events', 'errors']) assert(view[key] === source[key], 'Unveränderte Fachreferenz: ' + key);
    assertEqual(JSON.stringify(source), before, 'Tief eingefrorene vollständige Fachprojektion bleibt bytegleich');
}
assertEqual(dailyModel.history.end.total, 30, 'Tagesverlauf überlagert aktive Registry mit Livecash und schließt Fremdprofil aus');
assertEqual(dailyModel.history.end.day, dailyStart + 4, 'Tagesabschluss endet gestern');
assertEqual(dailyModel.history.metrics.withdrawals, 0, 'Leere belegte Cashhistorie besitzt null Entnahmen');
assertEqual(JSON.stringify({ dailyRegistry, dailyLive }), dailyBytes, 'Tagesprojektion bewahrt Quellrecords');
assertEqual(projectOverview({ registry: dailyRegistry, activeId: 'a', liveData: dailyData, now }).history.status, 'missing', 'Fehlender Beginn ist eigener Leerzustand');
assertEqual(projectOverview({ registry: dailyRegistry, activeId: 'a', liveData: { ...dailyLive, rs_daily_prices_v1: '{' }, now }).history.status, 'corrupt', 'Beschädigter Kursrecord kein Leerzustand');
assertEqual(projectOverview({ registry: dailyRegistry, activeId: 'a', liveData: { ...dailyLive, profile_cash_history_v1: '{' }, now }).history.metrics.status, 'unavailable', 'Beschädigte profilgebundene Historie verhindert exakte Kennzahl');

// Gleiche datierbare und alte unbekannte Bestände in Personen/Übersicht;
// beide Legacyvarianten enthalten das vom Altwriter überschriebene Kaufdatum.
{
    const { captureWealthLots, projectProfileWealthHistory } = await import('../app/profile/profile-wealth-history.js');
    const { projectOverviewHistory } = await import('../app/overview/overview-model.js');
    const { projectManagerProfiles } = await import('../app/tranches/tranchen-manager-profiles.js');
    const valid = { ...dailyLot, trancheId: 'valid', shares: 2 };
    const original = { ...dailyLot, trancheId: 'uncertain', purchaseDate: '2026-01-05' };
    const dated = captureWealthLots(JSON.stringify(captureWealthLots(null, [original], '2026-01-06')), [{ ...original, shares: 3 }], '2026-01-06');
    const legacy = { version: 1, lots: { uncertain: { tranche: original, remainingShares: 1,
        status: 'unknown', capturedAt: '2026-01-03' } } }; // Original war 02.01., Altwriter hat es verloren.
    for (const [kind, copies] of [['datiert', dated], ['alt', legacy]]) for (const removed of [false, true]) {
        const current = removed ? [valid] : [valid, copies.lots.uncertain.tranche];
        const fixture = { profiles: {
            a: { meta: { name: 'A' }, data: { profile_tagesgeld: '100', depot_tranchen: JSON.stringify(current), profile_wealth_history_lots_v1: JSON.stringify(copies) } },
            b: { meta: { name: 'B' }, data: { profile_tagesgeld: '20', depot_tranchen: JSON.stringify([dailyLot]) } },
            outside: { meta: { name: 'Außen', belongsToHousehold: false }, data: { profile_tagesgeld: '9999', depot_tranchen: '[]' } }
        } };
        const prices = JSON.parse(dailyLive.rs_daily_prices_v1);
        prices.symbols['DAILY.DE'].queried = [[dailyStart, dailyStart + 5]];
        const live = { rs_wealth_history_start_v1: dailyLive.rs_wealth_history_start_v1, rs_daily_prices_v1: JSON.stringify(prices) };
        const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
        freeze(fixture); freeze(live);
        const before = JSON.stringify({ fixture, live });
        const context = { status: 'ready', startDate: '2026-01-01', today: '2026-01-07', prices, events: [] };
        const manager = projectManagerProfiles(fixture, 'a', context);
        const overview = projectOverviewHistory({ registry: fixture, profiles: manager.profiles, liveData: live, today: context.today });
        assertEqual(JSON.stringify(manager.householdHistory.points), JSON.stringify(overview.points), kind + ': identische Tageswerte einschließlich bekannter Summen');
        assertEqual(JSON.stringify(manager.householdHistory.errors), JSON.stringify(overview.errors), kind + ': identische Unsicherheitsgrenzen/Diagnosen');
        for (const point of overview.points) {
            assertEqual(point.known, 150, 'Beide gültigen Tranchen und beide Cashbeträge in Haushaltsteilsumme');
            assertEqual(point.byProfile.b.total, 30, 'Gültige zweite Person behält Total');
            assertEqual(point.total, kind === 'datiert' && point.day < dailyDay('2026-01-05') ? 150 : null, 'Gesicherte Datierung oder durchgehende Altunsicherheit');
        }
        assertEqual(manager.profiles.find(person => person.id === 'outside').history.end.total, 9999, 'Außenprofil getrennt bewertet');
        for (const assetType of ['aktien_neu', 'cash']) {
            const result = projectProfileWealthHistory(fixture, manager.profiles, { ...context, assetType });
            assertEqual(result.end.known, assetType === 'cash' ? 120 : 30, 'Anlageform trennt bekannte Cash-/Depotbeiträge');
            assertEqual(result.end.total, assetType === 'cash' ? 120 : null, 'Unbekannte Tranche sperrt keinen reinen Cashfilter');
        }
        if (kind === 'alt') {
            assert(overview.errors.some(error => error.includes('ursprünglicher Kaufbeginn nicht gesichert')), 'Altfallhinweis nennt nicht gesicherten Kaufbeginn');
            const repeated = projectOverviewHistory({ registry: fixture, profiles: manager.profiles, liveData: live, today: context.today });
            assertEqual(JSON.stringify(repeated), JSON.stringify(overview), 'Wiederholung/Reload bleibt konservativ und identisch');
            assert(!copies.lots.uncertain.uncertainty, 'Projektion erzeugt keine nachträgliche Altdatenherkunft');
        }
        assertEqual(JSON.stringify({ fixture, live }), before, 'Personen-/Übersichtsprojektion bewahrt Quell- und Speicherbytes');
    }
}

assertEqual(parseOverviewTarget('balance', { hash: '#handlungsanweisung', search: '' }).target, 'handlungsanweisung', 'Gemeinsamer Handlungsschritt erhält expliziten lesenden Balancezielvertrag');
assertEqual(parseOverviewTarget('balance', { hash: '#handlungsanweisung', search: '?year=2026' }), null, 'Handlungsziel startet keine Periodenauswahl');

// Schreib- und Lesepfad über Modulgrenzen, ohne vorgegebenen Fingerabdruck/basisCurrent.
{
    const previousDocument = globalThis.document, previousWindow = globalThis.window;
    const today = new Date(), year = today.getFullYear();
    const metadata = { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${year - 1}`, pendingCommit: null };
    const previousMonth = new Date(year, today.getMonth() - 1, 1);
    const month = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;
    const doc = createPresentationTestDocument();
    globalThis.document = doc; globalThis.window = {};
    try {
        for (const ids of [['a'], ['b', 'a']]) {
            const label = ids.length === 1 ? 'Einzelprofil' : 'Haushalt';
            const sourceData = { depot_tranchen: JSON.stringify([lot]), profile_tagesgeld: '100',
                balance_expenses_v1: JSON.stringify({ version: 1, activeYear: previousMonth.getFullYear(), years: { [previousMonth.getFullYear()]: { months: { [previousMonth.getMonth() + 1]: expenseMonth(...ids) } } } }),
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata, inputs: { floorBedarf: 12000, flexBedarf: 0 } }) };
            const fixture = { version: 1, profiles: Object.fromEntries(ids.map(id => [id, {
                meta: { name: `Synthetisch ${id}`, belongsToHousehold: true }, data: { ...sourceData }
            }])) };
            const values = new Map(Object.entries({ ...sourceData, rs_profiles_v1: JSON.stringify(fixture),
                rs_current_profile: 'a', rs_active_profile: 'a' }));
            resetPersistenceForTests({ getItemSync: key => values.get(key) ?? null,
                setItemSync: (key, value) => values.set(key, value), removeItemSync: key => values.delete(key),
                keysSync: () => [...values.keys()] });
            const storage = persistenceStorage;
            const dependencies = { storage, guard: null, flush: async () => true, isBlocked: () => false };
            const selectedScope = overviewScope(ids.length === 1 ? 'single' : 'household', ids);
            const read = () => projectOverview({ registry: loadProfileRegistry(storage).value, activeId: 'a',
                liveData: Object.fromEntries(values), now: today });
            const readSimulations = () => projectSimulationSummaries({ registry: loadProfileRegistry(storage).value, activeId: 'a', liveData: Object.fromEntries(values), scope: selectedScope });
            // Aktive Registry enthält absichtlich den alten State: nur persistierter Livebestand zählt.
            storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ annualPeriodMetadata: metadata,
                inputs: { floorBedarf: 18000, flexBedarf: 0 } }));
            const ui = { input: { aktuellesAlter: 65, floorBedarf: 18000, flexBedarf: 0 },
                action: { quellen: [], verwendungen: {} }, spending: { monatlicheEntnahme: 1500 } };
            const written = buildBalanceOverviewSummary({ modelResult: { ui }, monthlyBudget: 1500, metadata,
                scope: selectedScope, now: today, captureSources: true, activeId: 'a' });
            assert(/^[a-f0-9]{64}$/.test(written.actionBasis.sourceFingerprint), `${label}: Balance erfasst echte Quellen`);
            assertEqual(written.actionBasis.material, false, `${label}: keine materielle Handlung`);
            assertEqual(await storeOverviewSummary(written, { ...dependencies, expectedProfileId: 'a' }), true,
                `${label}: Balanceanzeige wird wirklich gespeichert`);
            assertEqual(await storeMonthProvision({ month, scope: selectedScope, expectedProfileId: 'a' }, dependencies), true,
                `${label}: Monat wird im echten Speicherweg bestätigt`);
            let overview = read();
            assertEqual(overview.scope.key, selectedScope.key, `${label}: Schreib- und Leseumfang identisch`);
            assertEqual(overview.occasion.annualState, 'done', `${label}: Vorjahr abgeschlossen`);
            assertEqual(overview.occasion.monthCompleted, true, `${label}: Monat bestätigt`);
            assertEqual(overview.cashStatus.state, 'valid', `${label}: Cashaudit gültig`);
            assertEqual(JSON.stringify(overview.nextSteps), '[]', `${label}: unveränderte Quellen erzeugen keinen Plan- oder Pflichtschritt`);
            const outputs = { balanceNextSteps: doc.createElement('div'), balanceStepCount: doc.createElement('div') };
            const renderer = new SummaryRenderer({ outputs }, { loadState: () => JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY)) });
            const renderedIds = () => outputs.balanceNextSteps.children.map(node => node.getAttribute('data-next-step'));
            renderer.renderContext(ui.input);
            assert(!renderedIds().includes('annual'), `${label}: Balance erzeugt keinen Jahresschritt für abgeschlossenes Jahr`);
            assertEqual(JSON.stringify(renderedIds()), JSON.stringify(overview.nextSteps.map(step => step.id)),
                `${label}: Balance und Übersicht zeigen dieselbe leere Pflichtliste`);
            assertEqual(outputs.balanceStepCount.textContent, 'Alles erledigt', `${label}: Entwarnung ist belegt`);

            // Alle drei Arten durchlaufen begin → complete → den echten storeSimulationSummary.
            // Der MC-Start bindet den Werkstattbeleg an dieselben dokumentlokalen Inputs.
            const runInputs = {};
            const results = {
                backtest: { request: { startYear: 2000, endYear: 2001 }, outcome: { kind: 'completed' },
                    metrics: { values: { wealth_end_real_eur: 123 } } },
                montecarlo: { outcomeInventory: { schemaVersion: 'MonteCarloOutcomeInventoryV1', requestedRuns: 2,
                    technical_error: 0, ruin: 0, all_dead: 0, horizon_exhausted: 2, floorCoveragePct: 100 },
                    finalOutcomes: { distribution: { values: [100, 200] } } },
                workshop: { variantOrder: ['baseline', 'v'], pairwise: [{ variantId: 'v', comparable: true }],
                    variants: [{ variantId: 'baseline', label: 'Baseline' }, { variantId: 'v', label: 'Alternative',
                        terminalStatus: 'horizon_exhausted', summary: { finalValueRealEur: 456 } }] }
            };
            for (const [kind, result] of Object.entries(results)) {
                if (kind === 'workshop') {
                    const before = storage.getItem(OVERVIEW_SIMULATION_KEY);
                    assertEqual(beginSimulationSummary(kind, runInputs, {}, { storage }), null,
                        `${label}/workshop: ohne Herkunftsbeleg kein Abschlussstart`);
                    assertEqual(storage.getItem(OVERVIEW_SIMULATION_KEY), before,
                        `${label}/workshop: abgewiesener Start erhält gespeicherte Ergebnisse`);
                }
                const context = beginSimulationSummary(kind, runInputs, {}, { storage,
                    workshopProvenance: kind === 'workshop' ? workshopProvenanceFor(runInputs) : null });
                assertEqual(context?.scope.key, selectedScope.key, `${label}/${kind}: Erfassung nutzt denselben Umfang`);
                assertEqual(await completeSimulationSummary(context, result, {}, dependencies), true,
                    `${label}/${kind}: echte Ergebnisablage erfolgreich`);
                overview = read();
                assert(!Object.hasOwn(overview, 'simulations'), `${label}: Übersicht lädt keine Simulationszusammenfassungen`);
                assert(readSimulations()[kind].entry, `${label}/${kind}: Separater Ergebnisleser liest den gespeicherten Eintrag`);
                assertEqual(readSimulations()[kind].stale, false, `${label}/${kind}: unmittelbar nach Schreiben aktuell`);
            }
            // Beim Haushalt nur die inaktive Person ändern: ihr gespeicherter State muss mitzählen.
            if (ids.length > 1) {
                const changed = loadProfileRegistry(storage).value;
                changed.profiles.b.data.profile_tagesgeld = '101';
                storage.setItem('rs_profiles_v1', JSON.stringify(changed));
            } else storage.setItem('profile_tagesgeld', '101');
            overview = read();
            for (const kind of Object.keys(results)) assertEqual(readSimulations()[kind].stale, true,
                `${label}/${kind}: wirksame Änderung macht denselben gespeicherten Eintrag veraltet`);
            assertEqual(JSON.stringify(overview.nextSteps.map(step => step.id)), '[]', `${label}: Änderung erzeugt keine Planprüfpflicht`);
            renderer.renderContext(ui.input);
            assertEqual(JSON.stringify(renderedIds()), JSON.stringify(overview.nextSteps.map(step => step.id)),
                `${label}: Renderer und Übersicht stimmen auch nach wirksamer Änderung überein`);
        }
    } finally {
        resetPersistenceRuntimeForTests(); globalThis.document = previousDocument; globalThis.window = previousWindow;
    }
}

// P13b: echte Browserkonstellation, ohne vorgegebenen annualState.
for (const date of [new Date(2027, 0, 15, 12), new Date(2027, 9, 15, 12)]) {
    const initialized = { depot_tranchen: '[]', profile_tagesgeld: '100000',
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { aktuellesAlter: 67 }, annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null } }),
        balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
    const selected = { version: 1, profiles: { a: { meta: { name: 'Synthetisch' }, data: initialized } } };
    const before = JSON.stringify({ selected, initialized });
    const actual = projectOverview({ registry: selected, activeId: 'a', liveData: initialized, now: date });
    assertEqual(actual.occasion.annualState, 'open', 'Initialisiertes leeres Vorjahr mit offenem Periodenvertrag bleibt fällig');
    assertEqual(actual.firstPlanningYear, 2026, 'Initialisierung und gültiger ausgewählter Periodenstand belegen 2026');
    assertEqual(actual.nextSteps[0].id, 'annual', 'Echte Projektion stellt Jahresabschluss vor Folgeaufgaben');
    assertEqual(actual.nextSteps[0].href, 'Balance.html?year=2026#jahresabschluss', 'Abschlussziel enthält echte Vorjahresperiode');
    assertEqual(actual.expenses.complete, false, 'Fälligkeit bestätigt keinen Import');
    assertEqual(actual.occasion.monthCompleted, false, 'Fälligkeit bestätigt keine Monatsbereitstellung');
    assertEqual(JSON.stringify({ selected, initialized }), before, 'Initialisierungsauswertung verändert keine Quellbytes');
}

{
    const openMeta = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
    const initialized = { depot_tranchen: '[]', profile_tagesgeld: '100',
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: openMeta }),
        balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
    const read = source => projectOverview({ registry: { version: 1, profiles: { a: { meta: { name: 'A' }, data: source } } }, activeId: 'a', liveData: source, now: new Date(2027, 0, 15) });
    for (const store of [
        { version: 1, activeYear: 1900, years: { 2026: { months: {} } } },
        { version: 1, activeYear: 2026, years: {} },
        { version: 1, activeYear: 2026, years: { 2026: { months: [] } } },
        { version: 1, activeYear: 2026, years: { 2026: { months: { 1: expenseMonth('foreign') } } } }
    ]) assertEqual(read({ ...initialized, balance_expenses_v1: JSON.stringify(store) }).occasion.annualState, 'not_applicable', 'Beliebiges activeYear, fehlende Initialisierung und fremde/ungültige Jahre sind kein Beleg');
    assertEqual(read({ ...initialized, [CONFIG.STORAGE.LS_KEY]: '{}' }).occasion.annualState, 'not_applicable', 'Leeres Ausgabenjahr ohne ausgewählten offenen Periodenstand reicht nicht');
    assertEqual(read({ ...initialized, [OVERVIEW_SUMMARY_KEY]: summaryRaw(2027) }).occasion.annualState, 'open', 'P12c: spätere Summary verdrängt gültige Vorjahresinitialisierung nicht');
    assertEqual(read({ ...initialized, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: completed(2026) }) }).occasion.annualState, 'done', 'Bestätigter Abschluss bleibt erledigt');
    for (const metadata of [{ ...openMeta, schemaVersion: 99 }, completed(2028), { ...openMeta, pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'synthetic' } }]) {
        const projected = read({ ...initialized, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata }) });
        assertEqual(projected.nextSteps[0].id, 'annual', 'Widerspruch oder Recovery bleibt erster Prüfschritt ohne Vorjahresimporte');
        assertEqual(projected.occasion.annualState, metadata.pendingCommit ? 'recovery' : 'unclear', 'Periodensonderzustand wird nicht durch fehlenden Beginn verdeckt');
    }
    assertEqual(read({ ...initialized, [CONFIG.STORAGE.LS_KEY]: '{broken' }).occasion.annualState, 'unavailable', 'Fehlender Fachstate bleibt Prüfbedarf');
}

{
    const { setAppTestDate, appNow } = await import('../app/shared/app-clock.js');
    try {
        for (const date of ['2026-11-01', '2027-01-01', '2027-03-01']) {
            setAppTestDate(date);
            const input = { registry: dailyRegistry, activeId: 'a', liveData: dailyLive };
            assertEqual(JSON.stringify(projectOverview(input)), JSON.stringify(projectOverview({ ...input, now: appNow() })), 'Virtuelle Uhr steuert vollständige Übersicht mit unverändertem Projektionsvertrag');
        }
    } finally { setAppTestDate(null); }
}

// Ein Haushalt besitzt einen gemeinsamen Abschluss in genau einem Ablagestand.
{
    const now = new Date(2027, 0, 2), selected = overviewScope('household', ['a', 'b']);
    const state = { annualPeriodMetadata: completed(2026), wealthHistory: { schemaVersion: 1,
        entries: [createManualWealthHistoryEntry(amounts(100), '2026-01-01')] } };
    const plan = buildBalanceOverviewSummary({ modelResult: { ui: { spending: { monatlicheEntnahme: 321 } } },
        monthlyBudget: 654, metadata: completed(2026), scope: selected, now });
    const raw = JSON.stringify({ version: 1, entries: { [summaryEntryKey(2027, selected)]: plan } });
    const common = { depot_tranchen: '[]', profile_tagesgeld: '100', [OVERVIEW_SUMMARY_KEY]: raw };
    const a = { ...common, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) }, b = { ...common };
    const profiles = { a: { meta: { name: 'Synthetisch A' }, data: a }, b: { meta: { name: 'Synthetisch B' }, data: b },
        c: { meta: { name: 'Ungewählte Person', belongsToHousehold: false }, data: { depot_tranchen: '[]', profile_tagesgeld: '100',
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: completed(2030) }) } } };
    for (const activeId of ['a', 'b', 'c']) for (const reverse of [false, true]) {
        const registry = { version: 1, profiles: Object.fromEntries(reverse ? Object.entries(profiles).reverse() : Object.entries(profiles)) };
        const input = { registry, activeId, liveData: profiles[activeId].data, now };
        const bytes = JSON.stringify(input), projected = projectOverview(input);
        assertEqual(projected.periodSource.ids.join(), 'a', 'Abschlussquelle bleibt A unabhängig vom geöffneten Profil');
        assertEqual(projected.occasion.annualState, 'done', 'Gemeinsamer Abschluss 2026 erkannt');
        assertEqual(projected.year, 2027, 'Planjahr aus tatsächlichem Periodenstand');
        assertEqual(projected.summary.status, 'fest', 'Fehlender Balance-Stand von B blockiert Planfestigkeit nicht');
        assertEqual(projected.summary.monthlyWithdrawal, 321, 'Gemeinsame Entnahme wird nicht summiert');
        assertEqual(projected.summary.monthlyBudget, 654, 'Gemeinsames Budget wird nicht summiert');
        assertEqual(JSON.stringify(input), bytes, 'Lesende Projektion bewahrt alle Quellbytes');
    }
    const read = (source, summaryRaw = raw) => projectOverview({ registry: { version: 1, profiles: {
        a: { meta: profiles.a.meta, data: { ...a, [CONFIG.STORAGE.LS_KEY]: source, [OVERVIEW_SUMMARY_KEY]: summaryRaw } },
        b: { meta: profiles.b.meta, data: { ...b, [OVERVIEW_SUMMARY_KEY]: summaryRaw } }
    } }, activeId: 'b', liveData: { ...b, [OVERVIEW_SUMMARY_KEY]: summaryRaw }, now });
    assertEqual(read(JSON.stringify(state), null).summary, null, 'Fehlende gemeinsame Summary erfindet keinen Plan');
    const pending = { ...state, annualPeriodMetadata: { ...completed(2026), pendingCommit: {
        periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'synthetisch' } } };
    assertEqual(read(JSON.stringify(pending)).occasion.annualState, 'recovery', 'Pending der tatsächlichen Quelle bleibt Recovery nach Profilwechsel');
    assertEqual(read('{broken').occasion.annualState, 'unavailable', 'Beschädigte tatsächliche Quelle wird gesperrt');
    const changed = { version: 1, profiles: structuredClone(profiles) }; changed.profiles.a.meta.belongsToHousehold = false;
    assertEqual(projectOverview({ registry: changed, activeId: 'b', liveData: b, now }).summary, null, 'Geänderter Scope übernimmt keinen gemeinsamen Plan');

    const staleOutside = { version: 1, profiles: structuredClone(profiles) };
    staleOutside.profiles.c.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ annualPeriodMetadata: completed(2025) });
    const oldPlan = { ...plan, year: 2026, status: 'vorläufig' };
    staleOutside.profiles.c.data[OVERVIEW_SUMMARY_KEY] = JSON.stringify({ version: 1,
        entries: { [summaryEntryKey(2026, selected)]: oldPlan } });
    const staleBytes = JSON.stringify(staleOutside);
    const afterClose = projectOverview({ registry: staleOutside, activeId: 'a', liveData: a, now });
    assertEqual(afterClose.periodSource.ids.join(), 'a', 'Alte Haushaltsanzeige einer Außenperson ist keine aktuelle Abschlussquelle');
    assertEqual(afterClose.occasion.annualState, 'done', 'Alte Außenperson-Kopie blockiert den Monat nach Jahresabschluss nicht');
    assertEqual(JSON.stringify(staleOutside), staleBytes, 'Quellenzuordnung verändert Außenperson-Records nicht');
    const pendingOutside = { ...staleOutside.profiles.c.data, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(pending) };
    assertEqual(projectOverview({ registry: staleOutside, activeId: 'c', liveData: pendingOutside, now }).occasion.annualState,
        'recovery', 'Geöffneter fremder Writer bleibt trotz alter Anzeige mit Pending vorrangig geschützt');
}

// Haushalt: tatsächlich fehlende Cashhistorie ergänzt vorläufig 0 statt As Entnahmen zu verlieren.
{
    const registry = structuredClone(dailyRegistry), liveData = structuredClone(dailyLive);
    delete registry.profiles.b.data.profile_cash_history_v1;
    liveData.profile_cash_history_v1 = JSON.stringify({ version: 1, baselineValue: 100, entries: [{ date: '2026-01-02', value: 80 }] });
    liveData.profile_tagesgeld = '80';
    const bytes = JSON.stringify({ registry, liveData });
    const result = projectOverview({ registry, liveData, activeId: 'a', now: new Date(2026, 0, 6) });
    assertEqual(result.history.metrics.withdrawals, 20, 'Übersicht behält bestätigte Entnahmen von A plus vorläufige Null von B');
    assertEqual(result.history.metrics.status, 'provisional', 'Haushalt mit fehlender Historie bleibt vorläufig');
    assertEqual(JSON.stringify({ registry, liveData }), bytes, 'Mixprojektion bewahrt Quellbytes');
    delete liveData.profile_cash_history_v1;
    const missingBytes = JSON.stringify({ registry, liveData });
    const missing = projectOverview({ registry, liveData, activeId: 'a', now: new Date(2026, 0, 6) });
    assertEqual(missing.history.metrics.withdrawals, 0, 'Beide fehlenden Historien sind vorläufige Null');
    assertEqual(missing.history.metrics.status, 'provisional', 'Beide fehlenden Historien bleiben vorläufig');
    assertEqual(JSON.stringify({ registry, liveData }), missingBytes, 'Fehlende Historien werden nicht nachgeschrieben');
    liveData.profile_cash_history_v1 = JSON.parse(bytes).liveData.profile_cash_history_v1;
    registry.profiles.b.data.profile_cash_history_v1 = '{';
    const corruptBytes = JSON.stringify({ registry, liveData });
    const corrupt = projectOverview({ registry, liveData, activeId: 'a', now: new Date(2026, 0, 6) });
    assertEqual(corrupt.history.metrics.withdrawals, null, 'Beschädigte Historie wird nicht als fehlende Null gezählt');
    assertEqual(corrupt.history.metrics.status, 'unavailable', 'Beschädigte Quelle verhindert bekannte Kennzahlen');
    assertEqual(JSON.stringify({ registry, liveData }), corruptBytes, 'Beschädigte Quellen werden nicht repariert');
}
import { projectCashFreshness } from '../app/overview/overview-model.js';
import { readCashPerson } from '../app/profile/profile-cash-update.js';
{
    const history = (baselineValue, value, date) => JSON.stringify({ version: 1, baselineValue, entries: [{ date, value }] });
    const storedHistory = history(110, 100, '2026-09-01');
    const liveHistory = history(130, 120.125, '2026-10-01');
    const bHistory = history(210, 200, '2026-09-02');
    const selected = { version: 1, profiles: {
        a: { meta: { name: 'A', belongsToHousehold: true }, data: { profile_tagesgeld: '100', profile_cash_history_v1: storedHistory } },
        b: { meta: { name: 'B', belongsToHousehold: true }, data: { profile_tagesgeld: '200', profile_cash_history_v1: bHistory } },
        c: { meta: { name: 'C', belongsToHousehold: false }, data: { profile_tagesgeld: '999' } }
    } };
    const liveData = { profile_tagesgeld: '120.125', profile_cash_history_v1: liveHistory };
    const before = JSON.stringify({ selected, liveData });
    const projected = projectOverview({ registry: selected, activeId: 'a', liveData, now });
    assertEqual(projected.cashPeople.map(person => person.id).join(','), 'a,b', 'Produktprojektion enthält genau A+B in Haushaltsreihenfolge, kein Außenprofil C');
    const [a, b] = projected.cashPeople;
    assertEqual(a.name, 'A', 'Livecash bleibt der aktiven Person zugeordnet');
    assertEqual(a.value, 120.125, 'Aktives Cashfeld stammt aus Livewert statt Registry');
    assertEqual(a.cashRaw, liveData.profile_tagesgeld, 'Aktiver Cashrohwert bleibt bytegleich zum Livebeleg');
    assertEqual(a.historyRaw, liveHistory, 'Aktive Cashhistorie stammt bytegleich aus Livebestand statt Registry');
    assertEqual(a.lastDate, '2026-10-01', 'Aktives Belegdatum stammt aus Livehistorie');
    assertEqual(a.error, null, 'Abweichende, konsistente Livebelege sind gültig');
    assertEqual(b.value, 200, 'Inaktives Haushaltsmitglied verwendet Registrywert');
    assertEqual(b.cashRaw, '200', 'Inaktiver Cashrohwert bleibt erhalten');
    assertEqual(b.historyRaw, bHistory, 'Inaktive Historie bleibt bytegleich zum Registrybeleg');
    assertEqual(b.error, null, 'Inaktive Registrybelege sind gültig');
    assertEqual(JSON.stringify({ selected, liveData }), before, 'Cashprojektion verändert keine Quellbelege');
}
{
    const person = date => readCashPerson('a', 'A', { profile_tagesgeld: '0', profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 5, entries: [{ date, value: 0 }] }) });
    assertEqual(projectCashFreshness([person('2026-09-03')], '2026-10-08').length, 0, 'Genau 35 Kalendertage sind frisch');
    assertEqual(projectCashFreshness([person('2026-09-02')], '2026-10-08').length, 1, '36 Kalendertage zeigen Hinweis auch bei expliziter Null');
    assertEqual(projectCashFreshness([person('2026-10-09')], '2026-10-08').length, 0, 'Zukünftiger Beleg ist nicht veraltet');
    assertEqual(projectCashFreshness([readCashPerson('a', 'A', {})], '2026-10-08').length, 0, 'Fehlendes Tagesgeld erfindet kein Alter');
    assertEqual(projectCashFreshness([readCashPerson('a', 'A', { profile_tagesgeld: '0' })], '2026-10-08').length, 0, 'Fehlende Historie erfindet kein Datum');
}


// Monatsinhalt und Jahresauswertung bleiben bei verspäteter Bestätigung getrennt.
for (const month of [0, 2]) {
    const date = new Date(2027, month, 2);
    const period = month === 0 ? [2026, 12] : [2027, 2];
    const store = { version: 1, activeYear: 2026, years: { 2026: { months: { 12: { profiles: { a: { categories: { Kosten: -100 } } } } } },
        2027: { months: { 2: { profiles: { a: { categories: { Kosten: -200 } } } } } } } };
    const single = overviewScope('single', ['a']);
    const result = projectAnnualClosePreparation({ scope: single, now: date, planning: { firstPlanningYear: 2026 },
        occasion: { kind: 'annual', previousYear: period[0], previousMonth: period[1], closingYear: 2026 }, expenseBudget: 120,
        summary: { year: 2027, monthlyBudget: 220 } }, { store, annualBudgetSummary: { monthlyBudget: 120 } });
    assertEqual(result.expenses.year, period[0], 'Jahresdialog verwendet tatsächliches Vormonatsjahr');
    assertEqual(result.expenses.month, period[1], 'Jahresdialog verwendet tatsächlichen Vormonat');
    assertEqual(result.expenses.spent, month === 0 ? 100 : 200, 'Monatsausgaben werden nicht durch Jahresausgaben ersetzt');
    assertEqual(result.annual.year, 2026, 'Jahresauswertung bleibt Abschlussjahr');
}

for (const hash of ['#abschluss', '#jahresabschluss']) {
    for (const search of ['?year=2026&month=1', '?year=abc', '?year=2026&year=2027', '?execute=true']) {
        assertEqual(parseOverviewTarget('balance', { hash, search }), null, 'Jahresanker umgehen keine Parameterprüfung: ' + hash + search);
    }
}

for (const days of [29, 30, 31]) {
    const age = overviewBackupAge(now, new Date(now.getTime() - days * 86400000).toISOString());
    assertEqual(age.warning, days >= 30, `${days} Tage: bestehende Erinnerungsschwelle`);
}
for (const invalid of ['ungültig', null]) {
    assertEqual(overviewBackupAge(now, invalid).days, null, 'Ungültige und fehlende Sicherungszeiten bleiben unbekannt');
}
const futureBackupAge = overviewBackupAge(now, new Date(now.getTime() + 86400000).toISOString());
assertEqual(futureBackupAge.days, 0, 'Künftige Sicherungszeit gilt weiterhin als heute');
assertEqual(futureBackupAge.warning, false, 'Künftige Sicherungszeit erzeugt keine Warnung');
assertEqual(futureBackupAge.recommended, false, 'Künftige Sicherungszeit erzeugt keine Jahresempfehlung');
assertEqual(overviewBackupAge(new Date('2026-10-01T00:01:00Z'), '2026-09-30T23:59:00Z').warning, false, 'Tagesgrenze macht eine frische Sicherung nicht überfällig');

// H2: Jahresbeleg aus Livebestand; Profilkopien und Abschlussstatus sind kein Beleg.
{
    const { createMusterHaushaltRecords } = await import('../app/demo/muster-haushalt.js');
    const { planScope } = await import('../app/profile/household-plan.js');
    const { annualPlanEntryKey, ANNUAL_PLAN_RECORD_KEY } = await import('../app/profile/annual-plan-record.js');
    const { sourceFingerprint } = await import('../app/overview/overview-simulation-summary.js');
    const records = createMusterHaushaltRecords('2026-10-09'), registry = JSON.parse(records.rs_profiles_v1), activeId = records.rs_active_profile;
    const ids = Object.keys(registry.profiles), planArea = planScope('household', ids);
    const values = JSON.parse(records.household_plan_v1).entries[planArea.key].values;
    const adopted = { monthlyWithdrawal: 1500, monthlyBudget: 2000, liquidityBefore: 70, liquidityAfter: 80, flexRate: 100,
        marketPhase: 'Synthetisch', action: { type: 'NONE', title: 'Keine Transaktion', quellen: [], verwendungen: {}, steuer: 0 },
        snapshot: { plan: values, inflation: 2.1, ageByPerson: Object.fromEntries(ids.map(id => [id, 60])) } };
    const record = { year: 2026, periodId: 'calendar-year:2026', scope: planArea, committedAt: '2026-01-02T12:00:00Z', adjusted: false, adjustedFields: [], adopted, recommended: { ...adopted, monthlyWithdrawal: 9999 } };
    records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2026, planArea)]: record } });
    for (const profile of Object.values(registry.profiles)) profile.data[ANNUAL_PLAN_RECORD_KEY] = '{fremde Profilkopie';
    const previewScope = overviewScope('household', ids);
    const preview = { year: 2026, scope: previewScope, createdAt: '2026-10-09T12:00:00Z', status: 'fest', monthlyWithdrawal: 1600, monthlyBudget: 2100,
        liquidityBefore: 75, liquidityAfter: 85, marketPhase: 'Synthetisch', action: { verb: 'Nichts tun', amount: null, amountUnit: '€', note: 'Keine Transaktion empfohlen.' },
        actionBasis: { fingerprintVersion: 1, material: false, sourceFingerprint: sourceFingerprint({ registry, activeId, liveData: records, scope: previewScope, kind: 'balance' }) } };
    const previewRaw = JSON.stringify({ version: 1, entries: { [summaryEntryKey(2026, previewScope)]: preview } });
    records[OVERVIEW_SUMMARY_KEY] = previewRaw;
    for (const profile of Object.values(registry.profiles)) profile.data[OVERVIEW_SUMMARY_KEY] = previewRaw;
    const before = JSON.stringify([registry, records]);
    const model = projectOverview({ registry, activeId, liveData: records, now: new Date('2026-10-09T12:00:00Z') });
    assertEqual(model.summary.monthlyWithdrawal, adopted.monthlyWithdrawal, 'Feste Monatsanzeige bleibt beim beschlossenen Plan statt der neuen Vorschau');
    const changedPreview = { ...preview, action: { ...preview.action, verb: 'Aktien verkaufen' }, actionBasis: { ...preview.actionBasis, material: true } };
    const changedRaw = JSON.stringify({ version: 1, entries: { [summaryEntryKey(2026, previewScope)]: changedPreview } });
    const changedRegistry = structuredClone(registry);
    for (const profile of Object.values(changedRegistry.profiles)) profile.data[OVERVIEW_SUMMARY_KEY] = changedRaw;
    const later = projectOverview({ registry: changedRegistry, activeId, liveData: { ...records, [OVERVIEW_SUMMARY_KEY]: changedRaw }, now: new Date('2026-10-09T12:00:00Z') });
    assert(!later.nextSteps.some(step => step.id === 'action'), 'Neue materielle Vorschau erzeugt keinen neuen Umsetzungsschritt');
    assertEqual(records[ANNUAL_PLAN_RECORD_KEY], JSON.parse(before)[1][ANNUAL_PLAN_RECORD_KEY], 'Spätere Vorschau bewahrt Jahresbelegbytes');
    assertEqual(model.planComparison.recordStatus, 'valid', 'Startseite liest globalen Beleg, keine beschädigte Profilkopie');
    assertEqual(model.planComparison.planLabel, 'Plan 2026 · festgeschrieben am 02.01.2026', 'Gültiger Beleg bestimmt festen Plan');
    assertEqual(model.planComparison.rows[0].delta.replace(/\s/g, ''), '+100€', 'Startseitenprojektor liefert +100 Euro aus adopted');
    assertEqual(model.planComparison.rows[3].delta, '+5,0 Prozentpunkte', 'Startseite verwendet gemeinsame Prozentpunktregel');
    assertEqual(JSON.stringify([registry, records]), before, 'Gesamte Startseitenprojektion bleibt schreibfrei');
    const missing = { ...records }; delete missing[ANNUAL_PLAN_RECORD_KEY];
    assertEqual(projectOverview({ registry, activeId, liveData: missing }).planComparison.recordStatus, 'missing', 'Alte Abschlussmetadaten ersetzen globalen Beleg nicht');
    const corrupt = { ...records, [ANNUAL_PLAN_RECORD_KEY]: '{broken' };
    assertEqual(projectOverview({ registry, activeId, liveData: corrupt }).planComparison.recordStatus, 'invalid', 'Beschädigter globaler Beleg ist sichtbar fehlerhaft');
}

// Werktagsanker und Periodenende sind Kalenderregeln, kein erfundener Feiertagskalender.
const priceFixture = (today, date, occasion = {}) => ({ now: new Date(today), quoteDate: new Date(date).toISOString(), occasion,
    priceTranches: [{ profileId: 'a', trancheId: 'lot', asOf: new Date(date).getTime() / 1000 }] });
for (const [today, quote, occasion, expected] of [
    ['2026-10-10T12:00:00', '2026-10-09T17:00:00', {}, true],
    ['2026-10-11T12:00:00', '2026-10-09T17:00:00', {}, true],
    ['2026-10-12T12:00:00', '2026-10-09T17:00:00', {}, true],
    ['2026-10-13T12:00:00', '2026-10-12T17:00:00', {}, true],
    ['2027-01-02T12:00:00', '2026-12-31T17:00:00', { kind: 'annual', closingYear: 2026 }, true],
    ['2026-05-04T12:00:00', '2026-04-30T17:00:00', { kind: 'monthly', previousYear: 2026, previousMonth: 4 }, true],
    ['2027-01-02T12:00:00', '2026-12-30T17:00:00', { kind: 'annual', closingYear: 2026 }, false],
    ['2026-10-10T12:00:00', '2026-10-08T17:00:00', {}, false]
]) assertEqual(overviewPricesDone(priceFixture(today, quote, occasion)), expected, `Kalenderprüfung ${today} / ${quote}`);
const oldPrice = priceFixture('2027-01-02T12:00:00', '2026-12-30T17:00:00', { kind: 'annual', closingYear: 2026 });
const fullReport = { status: 'complete', updated: 1, retrievedAt: oldPrice.now.getTime() - 60000,
    results: [{ profileId: 'a', trancheId: 'lot', status: 'updated' }] };
assert(overviewPricesDone({ ...oldPrice, priceReport: fullReport }), 'Heute bestätigter Abruf deckt Feiertagslücke');
assert(!overviewPricesDone({ ...oldPrice, priceReport: { ...fullReport, retrievedAt: oldPrice.now.getTime() - 86400000 } }), 'Alte Abrufzeit deckt Feiertagslücke nicht');
for (const patch of [
    { priceTranches: [] }, { priceTranches: [{ profileId: 'a', asOf: oldPrice.priceTranches[0].asOf }] },
    { quoteDate: 'ungültig' }, { quoteDate: '2027-01-03T12:00:00' },
    { priceTranches: [{ ...oldPrice.priceTranches[0], asOf: oldPrice.now.getTime() / 1000 + 1 }] },
    { priceReport: { ...fullReport, results: [] } },
    { priceReport: { ...fullReport, results: [{ ...fullReport.results[0], status: 'failed' }] } },
    { priceReport: { ...fullReport, updated: 0 } }
]) assert(!overviewPricesDone({ ...oldPrice, priceReport: fullReport, ...patch }), 'Unbelegte/falsche Kurse erhalten keinen Haken');
assert(overviewPricesDone({ ...oldPrice, priceReport: { ...fullReport, results: [...fullReport.results,
    { profileId: 'fremd', trancheId: 'other', status: 'failed' }] } }), 'Fremder Profilfehler verändert die Haushaltsvollständigkeit nicht');

for (const [kind, expected] of [['missing', 'missing'], ['zero', 'provisional'], ['corrupt', 'invalid'], ['inconsistent', 'invalid']]) {
    const fixtureRegistry = structuredClone(quoteRegistry);
    for (const [id, profile] of Object.entries(fixtureRegistry.profiles)) {
        if (kind === 'missing') delete profile.data[OVERVIEW_SUMMARY_KEY];
        else if (kind === 'corrupt') profile.data[OVERVIEW_SUMMARY_KEY] = '{broken';
        else profile.data[OVERVIEW_SUMMARY_KEY] = JSON.stringify({ version: 1, entries: {
            [summaryEntryKey(2026, scope)]: { ...summary, monthlyBudget: kind === 'zero' ? 0 : id === 'a' ? 100 : 200 }
        } });
    }
    const view = projectOverview({ registry: fixtureRegistry, activeId: 'a', liveData: fixtureRegistry.profiles.a.data, now });
    assertEqual(view.expenseBudgetSource.status, expected, 'Tatsächliche Budgetquelle wird unterschieden: ' + kind);
    if (kind === 'zero') assertEqual(view.expenseBudget, 0, 'Nullbudget bleibt aus der Summaryquelle erhalten');
    assertEqual(structuredClone(view).expenseBudgetSource.status, expected, 'Abschlussmodell bleibt klonbar: ' + kind);
}
assert(!overviewPricesDone({ ...oldPrice, priceReport: { ...fullReport, retrievedAt: oldPrice.now.getTime() + 1 } }), 'Zukünftige Abrufzeit bestätigt keinen Kursstand');
assert(!overviewPricesDone({ ...oldPrice, priceReport: { ...fullReport, results: [...fullReport.results, ...fullReport.results], updated: 2 } }), 'Doppelte Tranchenresultate bestätigen keinen Kursstand');

assert(overviewPriceLabel({ ...oldPrice, scope: { ids: ['a'] }, priceReport: { ...fullReport, results: [...fullReport.results, { profileId: 'fremd', status: 'failed' }] } }).startsWith('Kurse aktualisiert'), 'Fremder Profilfehler täuscht keinen Haushalts-Teilabruf vor');

// Produktiver Archivanschluss: bestätigte Payloads, Kontextwechsel und frische Kursquellen.
{
    const sample = readyAnnualFixture();
    const registry = JSON.parse(sample.records.rs_profiles_v1);
    const strip = raw => {
        const state = JSON.parse(raw);
        for (const key of ['annualPeriodMetadata', 'annualMarketDataMeta', 'ageAdjustedForInflation', 'needsAdjustedForInflationYear', 'lastInflationAppliedAtYear']) delete state[key];
        delete state.lastState.lastInflationAppliedAtAge; state.lastState.cumulativeInflationFactor = 1;
        state.wealthHistory = { schemaVersion: 1, entries: [] };
        return JSON.stringify(state);
    };
    sample.records[CONFIG.STORAGE.LS_KEY] = strip(sample.records[CONFIG.STORAGE.LS_KEY]);
    Object.values(registry.profiles).forEach(profile => { profile.data[CONFIG.STORAGE.LS_KEY] = strip(profile.data[CONFIG.STORAGE.LS_KEY]); });
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    const point = SnapshotArchive.buildSnapshot({ id: 'model-pre-point', kind: 'annual-close-pre-mutation',
        activeProfileId: sample.records.rs_current_profile, createdAt: annualTestNow().toISOString(),
        records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(sample.records), getItem: key => sample.records[key] }) });
    const options = { registry, activeId: sample.records.rs_current_profile, liveData: sample.records, now: annualTestNow() };
    let release, reads = 0, notifications = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const reader = createAnnualCloseArchiveReader({ archive: { listSnapshots: async () => { reads++; await gate; return [point]; }, readSnapshot: async () => point } });
    const notified = new Promise(resolve => {
        const waiting = projectOverviewWithAnnualArchive(options, { reader, onChange: () => { notifications++; resolve(); } });
        assertEqual(waiting.occasion.annualState, 'unclear', 'Produktive ausstehende Lesung gibt nicht normal frei');
        projectOverviewWithAnnualArchive(options, { reader, onChange: () => { notifications++; } });
    });
    const before = JSON.stringify(sample.records);
    release(); await notified;
    assertEqual(reads, 1, 'Beide Anzeigen teilen die laufende Archivlesung');
    assertEqual(notifications, 2, 'Erfolgreiche Lesung aktualisiert beide angemeldeten Anzeigen');
    assertEqual(projectOverviewWithAnnualArchive(options, { reader }).occasion.annualState, 'open', 'Quellgleicher Restorevorabstand bleibt offen');
    // Derselbe Kurs-/Registrywrite wie beim späteren Startkurslauf.
    const lots = JSON.parse(sample.records.depot_tranchen);
    lots[0].currentPrice += 1; lots[0].asOf = Math.floor(annualTestNow().getTime() / 1000);
    sample.records.depot_tranchen = JSON.stringify(lots);
    registry.profiles[options.activeId].data.depot_tranchen = sample.records.depot_tranchen;
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    for (const project of [projectOverview, projectOverviewFromRecords]) {
        assertEqual(project({ ...options, snapshots: [point] }).occasion.annualState, 'unclear', 'Vorabpunkt nach Restore und Startkurswrite verlangt sichtbare Klärung');
    }
    assertEqual(projectOverviewWithAnnualArchive(options, { reader }).occasion.annualState, 'unclear', 'Unverändertes Archiv klassifiziert neue Finanzrecords erneut');
    assertEqual(reads, 1, 'Neue Kursrecords brauchen keinen geänderten Archivindex');
    assertEqual(point.records.depot_tranchen, JSON.parse(before).depot_tranchen, 'Projektion verändert den archivierten Vorabstand nicht');
    const broken = createAnnualCloseArchiveReader({ archive: { listSnapshots: async () => { throw new Error('ARCHIVE_FAILURE'); } } });
    await broken.refresh({ targetYear: 2026, activeId: options.activeId, scope: sample.scope });
    assertEqual(projectOverviewWithAnnualArchive(options, { reader: broken }).occasion.annualState, 'unclear', 'Archivfehler ist keine normale Freigabe');
    for (const changed of ['profile', 'scope', 'year']) {
        let unblock;
        const held = new Promise(resolve => { unblock = resolve; });
        const delayed = createAnnualCloseArchiveReader({ archive: { listSnapshots: async () => { await held; return [point]; }, readSnapshot: async () => point } });
        let staleNotices = 0, currentNotice;
        const updated = new Promise(resolve => { currentNotice = resolve; });
        projectOverviewWithAnnualArchive(options, { reader: delayed, onChange: () => { staleNotices++; } });
        const next = { ...options, registry: structuredClone(registry) };
        if (changed === 'profile') next.activeId = sample.scope.ids.find(id => id !== options.activeId);
        if (changed === 'scope') Object.entries(next.registry.profiles).forEach(([id, profile]) => { profile.meta.belongsToHousehold = id === options.activeId; });
        if (changed === 'year') next.now = new Date(2028, 0, 2);
        const waiting = projectOverviewWithAnnualArchive(next, { reader: delayed, onChange: currentNotice });
        assertEqual(waiting.annualArchive.status, 'loading', changed + ': neuer produktiver Kontext wartet');
        unblock(); await updated;
        assertEqual(staleNotices, 0, changed + ': altes Resultat schaltet alte Anzeige nicht frei');
        assertEqual(projectOverviewWithAnnualArchive(next, { reader: delayed }).annualArchive.status, 'loaded', changed + ': aktuelle Lesung bestätigt nur neuen Kontext');
    }
}

// R-03: Die frühere Browserfixture erbte aus createBalanceStorage einen undatierten
// Inflationsmarker trotz fehlender Periodenmetadaten. Echter Profillader und Archivpfad
// reproduzieren dafür „ambiguous_evidence“; der Erststart braucht eine unmarkierte Quelle.
for (const legacyMarker of [true, false]) for (const year of [2026, 2027]) {
    const storage = createOverviewFirstPlanningFixture();
    if (legacyMarker) {
        const registry = JSON.parse(storage.rs_profiles_v1);
        const person = registry.profiles['january-person'].data;
        const state = JSON.parse(person[CONFIG.STORAGE.LS_KEY]);
        state.lastState.lastInflationAppliedAtAge = 67;
        person[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        storage.rs_profiles_v1 = JSON.stringify(registry);
    }
    const records = structuredClone(storage);
    const adapter = { name: 'browser-first-planning-probe', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); } };
    const reader = createAnnualCloseArchiveReader({ archive: { async listSnapshots() { return []; } } });
    try {
        for (const stage of ['erste Anzeige', 'Reload']) {
            resetPersistenceForTests(adapter); await fixturePersistence.init({ installLifecycleHooks: false });
            assert(loadProfileIntoLocalStorage('january-person'), 'Januarfixture durchläuft echten Profillader: ' + stage);
            await fixturePersistence.flush();
            const liveData = await fixturePersistence.readPersistedRecords(), before = JSON.stringify(liveData);
            const options = { registry: JSON.parse(liveData.rs_profiles_v1), activeId: 'january-person', liveData,
                now: new Date(year, 0, 5, 12) };
            const base = projectOverviewFromRecords(options);
            await reader.refresh({ targetYear: year - 1, activeId: options.activeId, scope: base.scope });
            const view = projectOverviewWithAnnualArchive(options, { reader });
            const label = `${legacyMarker ? 'alte' : 'korrigierte'} Januarfixture ${year}/${stage}`;
            assertEqual(view.firstPlanningYear, 2026, label + ': Vermögensbeleg bestimmt unverändert den Beginn');
            assertEqual(view.annualEvidence.reason, legacyMarker ? 'ambiguous_evidence' : 'no_close_evidence', label + ': konkrete Ursachendiagnose');
            assertEqual(view.occasion.annualState, legacyMarker ? 'unclear' : year === 2026 ? 'not_applicable' : 'open', label + ': Klärung nur bei echtem Altmarker');
            assertEqual(view.occasion.kind, !legacyMarker && year === 2026 ? 'start' : 'annual', label + ': Erstjahr beziehungsweise erster relevanter Abschluss');
            assertEqual(view.annual.retrospective, legacyMarker || year === 2027, label + ': Rückblick erst zum relevanten Jahresabschluss');
            assertEqual(view.annual.year, !legacyMarker && year === 2026 ? 2026 : year - 1, label + ': Jahresband folgt unveränderter Prüfabsicht');
            assertEqual(JSON.stringify(JSON.parse(liveData[CONFIG.STORAGE.LS_KEY]).wealthHistory),
                JSON.stringify(JSON.parse(JSON.parse(storage.rs_profiles_v1).profiles['january-person'].data[CONFIG.STORAGE.LS_KEY]).wealthHistory),
                label + ': historischer Beleg bleibt vollständig erhalten');
            assertEqual(JSON.stringify(await fixturePersistence.readPersistedRecords()), before, label + ': Archiv- und Modellprojektion bleiben schreibfrei');
        }
    } finally { resetPersistenceForTests(); }
}

// Fall C: dieselben Browserfixtures durch den echten Profillader und die DOM-freie Projektion.
// Die Vergleichserwartung stammt aus dem Periodenvertrag, nicht aus gemessenem DOM-Text.
for (const membership of ['household', 'excluded', 'deleted']) for (const retrospective of [false, true]) {
    const fixture = createOverviewWealthComparisonFixture(membership, retrospective);
    const records = structuredClone(fixture.storage);
    const adapter = { name: 'browser-comparison-probe', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); } };
    try {
        resetPersistenceForTests(adapter); await fixturePersistence.init({ installLifecycleHooks: false });
        assert(loadProfileIntoLocalStorage('overview-a'), 'Echter Profilstart lädt die synthetische Vergleichsperson');
        await fixturePersistence.flush();
        for (const stage of ['erste Anzeige', 'Reload']) {
            if (stage === 'Reload') {
                resetPersistenceForTests(adapter); await fixturePersistence.init({ installLifecycleHooks: false });
                assert(loadProfileIntoLocalStorage('overview-a'), 'Erneuter Profilstart liest den dauerhaft gespeicherten Quellsatz');
                await fixturePersistence.flush();
            }
            const liveData = await fixturePersistence.readPersistedRecords(), before = JSON.stringify(liveData);
            const registry = JSON.parse(liveData.rs_profiles_v1);
            const projected = projectOverviewFromRecords({ registry, activeId: 'overview-a', liveData, now: new Date(fixture.fixedTime) });
            const label = `${membership}/${retrospective}/${stage}`;
            const membershipOf = raw => Object.fromEntries(Object.entries(JSON.parse(raw).profiles).map(([id, profile]) => [id, profile.meta.belongsToHousehold]));
            assertEqual(JSON.stringify(membershipOf(liveData.rs_profiles_v1)), JSON.stringify(membershipOf(fixture.storage.rs_profiles_v1)),
                label + ': Mitgliedschaft und gelöschter Partner bleiben unverändert');
            assertEqual(JSON.parse(liveData[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata.lastCommittedPeriod, 'calendar-year:2026', label + ': Liveperiode bleibt erhalten');
            assertEqual(JSON.parse(registry.profiles['overview-a'].data[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata, undefined,
                label + ': Personenrecord enthält nach echtem Laden keine Haushaltsperiode');
            assertEqual(projected.occasion.kind, retrospective ? 'annual' : 'monthly', label + ': Anlass folgt dem offenen Jahr oder dem Vormonat');
            assertEqual(projected.occasion.annualState, retrospective ? 'open' : 'done', label + ': echte Metadaten statt Legacyhistorienentscheidung');
            assertEqual(projected.annual.year, 2027, label + ': Vergleichsjahr folgt Kalender und Anlass');
            assertEqual(projected.annual.retrospective, retrospective, label + ': Januar vor Jahresabschluss ist Rückblick');
            assertEqual(projected.scope.key, fixture.scope.key, label + ': ausgewählter Umfang');
            assertEqual(projected.household.assets, fixture.currentAssets, label + ': aktuelle Bestandswerte');
            assertEqual(projected.previewSummary.year, retrospective ? 2028 : 2027, label + ': heutige passende Vorschau bleibt erhalten');
            for (const comparison of [projected.comparison, projected.annual.comparison]) {
                assertEqual(comparison.delta, null, label + ': keine Differenz ohne eindeutigen historischen Umfang');
                assertEqual(comparison.percent, null, label + ': kein Prozent ohne eindeutigen historischen Umfang');
                assertEqual(comparison.reason, missingScopeReason, label + ': ehrlicher fehlender Vergleichsstand');
            }
            assertEqual(JSON.stringify(JSON.parse(liveData[CONFIG.STORAGE.LS_KEY]).wealthHistory), JSON.stringify(fixture.history), label + ': alte Historie vollständig erhalten');
            assertEqual(JSON.stringify(await fixturePersistence.readPersistedRecords()), before, label + ': Modellprobe bleibt schreibfrei');
        }
    } finally { resetPersistenceForTests(); }
}
// Die alte gelöschte Partnerfixture hatte die Haushaltsperiode ausschließlich im Personenrecord.
{
    const fixture = createOverviewWealthComparisonFixture('deleted', true), records = structuredClone(fixture.storage);
    delete records[CONFIG.STORAGE.LS_KEY];
    try {
        resetPersistenceForTests({ name: 'old-browser-comparison-probe', async loadAll() { return { ...records }; },
            async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); } });
        await fixturePersistence.init({ installLifecycleHooks: false });
        assert(loadProfileIntoLocalStorage('overview-a'), 'Alte Fixture durchläuft denselben echten Profillader');
        await fixturePersistence.flush();
        const liveData = await fixturePersistence.readPersistedRecords();
        const projected = projectOverviewFromRecords({ registry: JSON.parse(liveData.rs_profiles_v1), activeId: 'overview-a', liveData, now: new Date(fixture.fixedTime) });
        assertEqual(JSON.parse(liveData[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata, undefined, 'Alte Fixture verliert die ausschließlich personengebundene Jahresperiode');
        assertEqual(projected.occasion.annualState, 'done', 'Statt der fehlenden Liveperiode liefert Jahresstand 2027 einen Legacyabschlussbeleg');
        assertEqual(projected.occasion.kind, 'monthly', 'Alte Fixture leitet deshalb den offenen Dezember ab');
        assertEqual(projected.annual.retrospective, false, 'Alte Fixture richtet den angeforderten Rückblick nicht ein');
        assertEqual(projected.annual.year, 2028, 'Gegenprobe reproduziert das abweichende Kalenderjahr unabhängig vom Browser');
    } finally { resetPersistenceForTests(); }
}
