import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { probelaufDomainChecksum, projectProbelaufDomain, summarizeProbelaufChanges, probelaufRecordContext } from '../app/shared/probelauf-records.js';
import { buildProbelaufEndReview, calculateProbelaufEndReview, loadProbelaufBalance, probelaufTransferability, projectProbelaufComparison, probelaufMonteCarloRuns } from '../app/shared/probelauf-comparison.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { planScope } from '../app/profile/household-plan.js';
import { overviewScope, summaryEntryKey } from '../app/overview/overview-storage.js';
import { simulationEntryKey } from '../app/overview/overview-simulation-summary.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { SnapshotArchive as A } from '../app/shared/snapshot-archive.js';

const now = new Date('2026-10-15T10:00:00Z');
const original = createMusterHaushaltRecords('2026-10-15');
const rawBytes = JSON.stringify(original);
const edit = (records, key, mutate) => { const value = JSON.parse(records[key]); mutate(value); records[key] = JSON.stringify(value); };
const changes = records => summarizeProbelaufChanges(original, records);
const copy = () => ({ ...original });
assertEqual(changes(copy()).count, 0, 'Unveränderte Kopie hat keine Änderungen');
{
    const records = copy(); edit(records, 'rs_profiles_v1', registry => { registry.trancheReconciliation = { schemaVersion: 1, actions: [{ actionId: 'sale', eventType: 'sale_reconciled' }] }; });
    assert(probelaufDomainChecksum(records) !== probelaufDomainChecksum(original), 'Verkaufs- und Bestätigungsrecords zählen zum echten Fachbestand');
    assertEqual(changes(records).groups[0].label, 'Depot/Tranchen', 'Verkäufe und Bestätigungen im Depot gruppiert');
    edit(records, 'rs_profiles_v1', registry => { delete registry.trancheReconciliation; registry.profiles.muster_b.data.profile_tagesgeld = '99'; });
    assert(probelaufDomainChecksum(records) !== probelaufDomainChecksum(original), 'Fachänderung einer inaktiven Person ändert Prüfsumme');
}
for (const [key, value, expected] of [['profile_gold_aktiv', 'true', 'Gold'], ['profile_gold_ziel_pct', '10', 'Gold-Zielanteil'], ['profile_tagesgeld', '20000', 'Tagesgeld'], ['profile_rente_monatlich', '2400', 'Rente pro Monat']]) {
    const records = copy(); records[key] = value;
    const result = changes(records);
    assertEqual(result.count, 1, `${expected}: eine Änderung statt Registry-/Live-Doppelzählung`);
    assert(result.groups[0].rows[0].label.includes(expected), `${expected}: Alltagssprache`);
    assert(result.groups[0].rows[0].before !== result.groups[0].rows[0].after, `${expected}: vorher und nachher unterscheidbar`);
}
{
    const records = copy(); edit(records, 'household_plan_v1', plan => { Object.values(plan.entries)[0].values.flexBedarf = 32000; });
    const result = changes(records);
    assertEqual(result.count, 1, 'Gemeinsamer Flexbedarf wird einmal gezählt');
    assert(result.groups[0].rows[0].label.includes('Wunschbedarf (Flex)'), 'Flex heißt Wunschbedarf');
    assert(result.groups[0].rows[0].after.includes('32.000'), 'Flex-Nachherwert in Euro');
}
for (const operation of ['new', 'changed', 'deleted']) {
    const records = copy(); edit(records, 'depot_tranchen', lots => {
        if (operation === 'new') lots.push({ ...lots[0], trancheId: 'new_gold', type: 'gold', name: 'Gold', shares: 7 });
        else if (operation === 'changed') lots[0].shares += 2;
        else lots.pop();
    });
    const result = changes(records);
    assertEqual(result.count, 1, `${operation}: genau eine Tranche`);
    assertEqual(result.groups[0].label, 'Depot/Tranchen', `${operation}: im Depot gruppiert`);
    assert(result.groups[0].rows[0].label.includes({ new: 'neu', changed: 'geändert', deleted: 'gelöscht' }[operation]), `${operation}: Art der Änderung benannt`);
}
{
    const records = copy(); edit(records, 'balance_expenses_v1', expenses => { expenses.years[2026].months[9].profiles.muster_a.categories.Wohnen = -1400; });
    const result = changes(records);
    assertEqual(result.count, 1, 'Ein Ausgabenposten zählt einmal');
    assertEqual(result.groups[0].label, 'Ausgaben', 'Ausgaben im eigenen Bereich');
    assert(result.groups[0].rows[0].label.includes('Wohnen'), 'Ausgabenkategorie sichtbar');
}
{
    const records = copy(); edit(records, CONFIG.STORAGE.LS_KEY, state => { state.annualPeriodMetadata.lastCommittedPeriod = 'calendar-year:2026'; });
    const result = changes(records);
    assertEqual(result.groups[0].label, 'Abschlüsse', 'Jahresabschluss separat');
    assert(result.closes[0].includes('2026'), 'Abschlussjahr benannt');
    edit(records, 'overview_month_provision_v1', record => { record.entries.new = { month: '2026-10', completedAt: now.toISOString() }; });
    assertEqual(changes(records).count, 2, 'Monats- und Jahresabschluss erkannt');
}
{
    const records = copy();
    edit(records, 'overview_month_provision_v1', record => {
        record.entries = Object.fromEntries(['10', '11', '12'].map(month => [month, { month: `2026-${month}`, completedAt: now.toISOString() }]));
        record.entries.open = { month: '2027-01' };
    });
    edit(records, CONFIG.STORAGE.LS_KEY, state => { state.annualPeriodMetadata.lastCommittedPeriod = 'calendar-year:2026'; });
    const summary = changes(records);
    assertEqual(summary.closes.join(' · '), 'Oktober bis Dezember 2026 · Jahr 2026', 'Monatsreihe und Jahr lesbar, gelöschte und offene Monate zählen nicht als Abschluss');
    edit(records, 'overview_month_provision_v1', record => { delete record.entries['11']; });
    assertEqual(changes(records).closes.join(' · '), 'Oktober 2026 · Dezember 2026 · Jahr 2026', 'Lücken werden nicht als abgeschlossene Monate ausgegeben');
    edit(records, 'overview_month_provision_v1', record => { record.entries = {}; });
    edit(records, CONFIG.STORAGE.LS_KEY, state => { delete state.annualPeriodMetadata.lastCommittedPeriod; });
    assertEqual(changes(records).closes.length, 0, 'Entfernte Abschlussbelege ergeben keinen Abschluss für einen offenen Monat oder ein offenes Jahr');
}
{
    const records = copy();
    records.rs_current_profile = 'muster_b'; records.rs_active_profile = 'muster_b';
    const b = JSON.parse(records.rs_profiles_v1).profiles.muster_b.data;
    for (const key of Object.keys(original)) if (Object.hasOwn(b, key)) records[key] = b[key];
    assertEqual(changes(records).count, 0, 'Profilwechsel ohne Fachänderung erzeugt keine Änderungen');
    assertEqual(probelaufDomainChecksum(records), probelaufDomainChecksum(original), 'Profilwechsel ändert Fachprüfsumme nicht');
}
{
    const records = copy(); records.ui_theme = 'anders'; records.rs_daily_prices_v1 = '{"new":true}'; records.simScratch = 'Sitzung';
    edit(records, 'depot_tranchen', lots => { lots[0].currentPrice = 123; lots[0].asOf = 999; });
    edit(records, 'household_plan_v1', plan => { const entry = Object.values(plan.entries)[0]; entry.updatedAt = '2026-10-16T00:00:00Z'; entry.values.cape.value = 12; });
    edit(records, 'rs_profiles_v1', registry => { registry.profiles.muster_a.meta.updatedAt = 'later'; });
    assertEqual(changes(records).count, 0, 'Technik, Sitzungen, Zeitstempel und Kurse erzeugen keine Änderungen');
    assertEqual(probelaufDomainChecksum(records), probelaufDomainChecksum(original), 'Technik und Kurse ändern Fachprüfsumme nicht');
}
const start = { source: 'copy', testDate: null, hasDateJump: false, realDomainChecksum: probelaufDomainChecksum(original), initialMonteCarloRuns: [], initialDomain: projectProbelaufDomain(original) };
assert(probelaufTransferability(start, original).eligible, 'Kopie ohne Sprung und echte Änderung übernehmbar');
assertEqual(probelaufTransferability({ ...start, hasDateJump: true, testDate: '2026-10-15' }, original).reason, 'date', 'Auch Rücksprung bleibt gesperrt');
assertEqual(probelaufTransferability({ ...start, source: 'demo' }, original).reason, 'demo', 'Max und Erika gesperrt');
assertEqual(probelaufTransferability(start, { ...original, profile_tagesgeld: '1' }).reason, 'real-changed', 'Geänderter echter Bestand gesperrt');
assert(!probelaufTransferability({ source: 'copy', testDate: null }, original).eligible, 'Alte Sitzung ohne Startprüfsumme sicher gesperrt');
for (const state of [{ ...start, source: 'demo' }, { ...start, hasDateJump: true, testDate: '2027-01-02' }, { ...start, hasDateJump: true }]) {
    const inaccessibleReal = new Proxy({}, { get() { throw new Error('Kein Echtzugriff erlaubt'); }, ownKeys() { throw new Error('Keine echten Schlüssel erlaubt'); } });
    const playRecords = { ...original, profile_tagesgeld: '20000' };
    const review = await calculateProbelaufEndReview({ state, realRecords: inaccessibleReal, playRecords, now });
    assertEqual(review.real, null, 'Muster oder Datumssprung berechnet keinen echten Bestand');
    assertEqual(review.changes, null, 'Muster oder Datumssprung vergleicht keine Fachdaten mit Echt');
    assertEqual(review.madeChanges.planChangeCount, 1, 'Eigene Änderung zählt ausschließlich gegen initialDomain');
    assertEqual(review.play.status, 'ready', 'Spielbudget bleibt ohne echten Bestand berechenbar');
    const old = buildProbelaufEndReview({ state: { ...state, initialDomain: undefined }, realRecords: inaccessibleReal, playRecords, now });
    assertEqual(old.madeChanges, null, 'Fehlender Anfangsstand wird nicht durch Echtvergleich ersetzt');
}
{
    const missing = projectProbelaufComparison({}, { now, engineApi: EngineAPI, balance: await loadProbelaufBalance() });
    assertEqual(missing.status, 'error', 'Fehlender Haushalt ist nicht berechenbar');
    assert(missing.error.includes('Haushalt'), 'Fehlender Haushalt mit lesbarem Grund');
    assertEqual(missing.monthlyBudget, null, 'Fehlendes Budget bleibt fehlend');
    assertEqual(missing.action, null, 'Fehlende Handlung bleibt fehlend');
    assertEqual(missing.liquidity, null, 'Fehlende Liquidität bleibt fehlend');
    assertEqual(missing.monteCarlo, null, 'Fehlender MC-Lauf bleibt fehlend');
    const records = copy(), scope = overviewScope('household', ['muster_a', 'muster_b']);
    edit(records, 'rs_profiles_v1', registry => {
        for (const profile of Object.values(registry.profiles)) {
            const summary = JSON.parse(profile.data.overview_balance_summary_v1);
            Object.assign(summary.entries[summaryEntryKey(2026, scope)], { action: { verb: 'Gold kaufen', amount: 18000 }, liquidityBefore: 77 });
            profile.data.overview_balance_summary_v1 = JSON.stringify(summary);
        }
    });
    records.overview_balance_summary_v1 = JSON.parse(records.rs_profiles_v1).profiles.muster_a.data.overview_balance_summary_v1;
    const result = projectProbelaufComparison(records, { now, engineApi: EngineAPI, balance: await loadProbelaufBalance() });
    assertEqual(result.monthlyBudget, 4700, 'Frische Vorschau ersetzt gespeicherte 5000-Euro-Projektion');
    assertEqual(result.action.verb, 'Aktien verkaufen', 'Art stammt aus echter Haushaltsrechnung statt gespeichertem Goldkauf');
    assert(result.action.amount > 18000, 'Handlungsbetrag stammt aus frischer Rechnung');
    assertEqual(result.liquidity, 62.5, 'Liquidität vor Umsetzung aus frischer Haushaltsrechnung');
    const entry = { scope, kind: 'montecarlo', completedAt: '2026-10-14T10:00:00Z', statement: 'completed', priceBasis: 'heute',
        fingerprintVersion: 2, sourceFingerprint: 'a'.repeat(64), runFingerprint: 'b'.repeat(64), deviationApplied: false,
        metrics: { runs: 100, covered: 94, successPct: 94, median: 100, p5: 5 } };
    const storeRun = () => {
        const raw = JSON.stringify({ version: 1, entries: { [simulationEntryKey(scope, 'montecarlo')]: entry } });
        records.overview_simulation_summary_v1 = raw;
        edit(records, 'rs_profiles_v1', registry => { for (const profile of Object.values(registry.profiles)) profile.data.overview_simulation_summary_v1 = raw; });
    };
    storeRun(); const initialMonteCarloRuns = probelaufMonteCarloRuns(records);
    assertEqual(projectProbelaufComparison(records, { now }).monteCarlo.successPct, 94, 'Echter letzter MC-Lauf mit Erfolgsquote');
    assertEqual(projectProbelaufComparison(records, { now, play: true, state: { initialMonteCarloRuns } }).monteCarlo, null, 'Mitkopierter MC-Lauf zählt im Spielbereich nicht');
    entry.completedAt = '2026-10-15T10:00:00Z'; storeRun();
    assertEqual(projectProbelaufComparison(records, { now, play: true, state: { initialMonteCarloRuns } }).monteCarlo.completedAt, entry.completedAt, 'Neuer Spiel-MC-Lauf mit Datum');
    const review = buildProbelaufEndReview({ state: start, realRecords: {}, playRecords: records, now });
    assertEqual(review.budgetDelta, null, 'Fehlender Vergleichswert erzeugt keine Differenz');
    assertEqual(probelaufRecordContext(records).registry.profiles.muster_a.data.overview_simulation_summary_v1, records.overview_simulation_summary_v1, 'Liveprojektion ohne Writes');
}
{
    const records = copy();
    const scope = planScope('household', ['muster_a', 'muster_b']);
    const outcome = { monthlyWithdrawal: 2700, monthlyBudget: 5000, liquidityBefore: 77, liquidityAfter: 100, flexRate: 100,
        marketPhase: 'Synthetischer Jahresplan', action: { type: 'NONE', title: 'Nichts tun' },
        snapshot: { plan: Object.values(JSON.parse(records.household_plan_v1).entries)[0].values, inflation: 2,
            ageByPerson: { muster_a: 67, muster_b: 65 } } };
    records.annual_plan_record_v1 = buildAnnualPlanRecord(null, { targetYear: 2025, scope,
        committedAt: '2026-01-02T12:00:00Z', recommended: outcome }).raw;
    const before = JSON.stringify(records);
    const review = await calculateProbelaufEndReview({ state: start, realRecords: records, playRecords: records, now });
    assertEqual(review.real.monthlyBudget, 4700, 'Festgeschriebener Plan ersetzt frische Vorschau nicht');
    assertEqual(review.real.fixedPlan.monthlyBudget, 5000, 'Festgeschriebener Betrag bleibt als getrennte Info erhalten');
    assertEqual(review.real.fixedPlan.committedAt, '2026-01-02T12:00:00Z', 'Planinfo enthält Belegdatum');
    assertEqual(JSON.stringify(records), before, 'Frische Vorschau überschreibt keinen Jahresbeleg');
}
{
    const pending = buildProbelaufEndReview({ state: start, realRecords: original, playRecords: original, now });
    assertEqual(pending.real.status, 'pending', 'Ohne geladene Engine noch keine erfundenen Vorschauwerte');
    const failed = await calculateProbelaufEndReview({ state: start, realRecords: original, playRecords: original, now },
        { engineLoader: { load() { throw new Error('Engine konnte nicht geladen werden'); } } });
    assertEqual(failed.real.status, 'error', 'Ladefehler betrifft die echte Vorschau');
    assertEqual(failed.play.error, 'Engine konnte nicht geladen werden', 'Ladefehler bleibt mit Grund sichtbar');
    const broken = { ...original, profile_geburtsdatum: 'ungültig' };
    const partial = await calculateProbelaufEndReview({ realRecords: original, playRecords: broken, now });
    assertEqual(partial.real.status, 'ready', 'Spiel-Rechenfehler verhindert echte Vorschau nicht');
    assertEqual(partial.play.status, 'error', 'Fehlerhafte Personendaten werden nicht durch gespeicherte Ergebnisse ersetzt');
    assert(partial.play.error.length > 0, 'Rechenfehler mit Grund');
}
assertEqual(JSON.stringify(original), rawBytes, 'Reine Bausteine verändern keine Eingaberecords');

for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
    const f = await playFixture(kind, original); let c = await f.boot();
    await A.createSnapshot({ id: 'original', label: 'Vorhandener echter Punkt', records: original });
    const before = f.realBytes();
    await c.start(() => ({ source: 'copy', testDate: null })); c = await f.boot();
    assert(/^[a-f0-9]{64}$/.test(c.state.realDomainChecksum), `${kind}: Startprüfsumme dauerhaft im Spiel-Steuerrecord`);
    assert(Number.isFinite(Date.parse(c.state.startedAt)), `${kind}: Startzeit dauerhaft gespeichert`);
    assert((await c.readEndReview()).transfer.eligible, `${kind}: Kopie unverändert übernehmbar`);
    P.setItemSync('profile_gold_aktiv', 'true'); P.setItemSync('profile_gold_ziel_pct', '10'); P.setItemSync('profile_tagesgeld', '20000');
    const plan = JSON.parse(P.getItemSync('household_plan_v1')); Object.values(plan.entries)[0].values.flexBedarf = 32000;
    P.setItemSync('household_plan_v1', JSON.stringify(plan)); await P.flush();
    const playBefore = JSON.stringify(await P.readPersistedRecords());
    const review = await c.readEndReview();
    assertEqual(review.changes.count, 4, `${kind}: echte Persistenzfunktionen liefern fachliche Änderungen`);
    assertEqual(review.real.monthlyBudget, 4700, `${kind}: echte Vorschau frisch gerechnet ohne Balance zu öffnen`);
    assertEqual(review.play.monthlyBudget, 4800, `${kind}: Flexerhöhung erhöht Monatsbudget ohne Balance zu öffnen`);
    assertEqual(review.budgetDelta, 100, `${kind}: Differenz aus beiden frischen Rechnungen`);
    assertEqual(review.play.action.goldPurchaseAmount, 40000, `${kind}: Gold-Handlungsanweisung aus echten Spielwerten`);
    assert(review.play.liquidity !== review.real.liquidity, `${kind}: geänderte Deckung des Liquiditätsziels`);
    assertEqual(JSON.stringify(await P.readPersistedRecords()), playBefore, `${kind}: Vorschau lässt auch Spielrecords und Metadaten bytegleich`);
    assertEqual(f.realBytes(), before, `${kind}: Vergleich und Änderung lassen echte Records, Archive und Metadaten bytegleich`);
    await c.end(async () => { await c.readEndReview(); return false; });
    assertEqual(f.realBytes(), before, `${kind}: Weiter spielen erhält echte Bytes`);
    const noRealReads = { ...P, readRealRecords() { throw new Error('Echter Bestand darf für diese Zusammenfassung nicht gelesen werden'); },
        readRealSnapshots() { throw new Error('Echtes Archiv darf für diese Zusammenfassung nicht gelesen werden'); } };
    await c.changeDate('2027-01-02'); c = await f.boot({ persistence: noRealReads });
    const jumped = await c.readEndReview();
    assertEqual(jumped.transfer.reason, 'date', `${kind}: Datumssprung dauerhaft gesperrt ohne Echtzugriff`);
    assertEqual(jumped.real, null, `${kind}: keine echte Rechnung nach Datumssprung`);
    await c.end(async () => { await c.readEndReview(); return true; });
    assertEqual(f.realBytes(), before, `${kind}: Verwerfen nach Vergleich erhält echte Bytes`);
    c = await f.boot(); await c.start(() => ({ source: 'demo', testDate: null })); c = await f.boot({ persistence: noRealReads });
    assertEqual((await c.readEndReview()).transfer.reason, 'demo', `${kind}: Musterquelle gesperrt`);
    assertEqual((await c.readEndReview()).madeChanges.count, 0, `${kind}: frischer Muster-Haushalt zählt nicht als selbst geändert`);
    P.setItemSync('profile_gold_aktiv', 'true'); await P.flush();
    assertEqual((await c.readEndReview()).madeChanges.count, 1, `${kind}: im Muster nur selbst gemachte Änderung gezählt`);
    assertEqual((await c.readEndReview()).real, null, `${kind}: Max und Erika liest und berechnet keine echten Daten`);
    await c.changeDate('2027-01-02'); c = await f.boot({ persistence: noRealReads });
    assertEqual((await c.readEndReview()).madeChanges.planChangeCount, 1, `${kind}: Max und Erika nach Datumssprung zählt weiterhin nur eigene Änderung`);
    await c.end(() => true); assertEqual(f.realBytes(), before, `${kind}: Mustervergleich und Ende erhalten echte Bytes`);
    c = await f.boot(); await c.start(() => ({ source: 'copy', testDate: null })); c = await f.boot();
    const realAdapter = f.areas.makeAdapter('echt'); await realAdapter.open();
    await realAdapter.saveBatch({ upserts: [['profile_tagesgeld', '22222']], deletes: [] }); realAdapter.close?.();
    const changedReal = f.realBytes();
    assertEqual((await c.readEndReview()).transfer.reason, 'real-changed', `${kind}: fremde echte Änderung erkannt`);
    assertEqual((await c.readEndReview()).real.status, 'ready', `${kind}: echter Fremdwrite behält frischen Vergleich`);
    assertEqual((await c.readEndReview()).madeChanges.count, 0, `${kind}: fremde echte Änderung zählt nicht als im Spielbereich gemacht`);
    assertEqual(f.realBytes(), changedReal, `${kind}: Lesen ersetzt fremde Änderung nicht`);
    await c.end(() => true); assertEqual(f.realBytes(), changedReal, `${kind}: Verwerfen erhält fremde Änderung bytegleich`);
}
