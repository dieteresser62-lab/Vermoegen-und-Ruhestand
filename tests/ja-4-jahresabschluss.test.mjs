// JA-4: Jahresabschluss absichern. Je Befund aus dem Gutachten vom 19.11.2026 ein Nachweis (NG-11, NG-15, NG-13, S2).
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { annualTestMarketData, readyAnnualFixture } from './helpers/balance-storage-fixtures.mjs';
import { readCapeReference } from '../app/shared/annual-cape-check.js';

// Jeder Befund läuft für sich; ein Fehlschlag zählt, hält die übrigen Nachweise aber nicht an.
const section = async run => { try { await run(); } catch (error) { if (!error?.isTestAssertionError) throw error; } };

// NG-11: „Steueroptimiert“ nimmt Liquidität in der Personenreihenfolge aus Haushalt & Plan, nicht nach Profilkennung.
await section(async () => {
    const profiles = [{ profileId: 'zeta', inputs: { tagesgeld: 80, geldmarktEtf: 20 }, tranches: [] }, { profileId: 'alpha', inputs: { tagesgeld: 100, geldmarktEtf: 0 }, tranches: [] }];
    const householdAction = { type: 'TRANSACTION', quellen: [{ source: 'Liquidität', kind: 'liquiditaet', brutto: 150, netto: 150, steuer: 0 }],
        verwendungen: { aktien: 150 }, nettoErlös: 150, steuer: 0 };
    const amounts = mode => Object.fromEntries(attributeHouseholdAction({ householdAction, profiles, mode }).profileActions
        .map(entry => [entry.profileId, (entry.action.quellen || []).reduce((total, source) => total + source.brutto, 0)]));
    assertEqual(JSON.stringify(amounts('tax_optimized')), JSON.stringify({ zeta: 100, alpha: 50 }), 'NG-11: erste Person aus Haushalt & Plan zuerst, je Person Tagesgeld und Geldmarkt');
    assertEqual(JSON.stringify(amounts('one_carries:alpha')), JSON.stringify({ zeta: 50, alpha: 100 }), 'NG-11: FR-80 nimmt weiter zuerst die tragende Person');
    assertEqual(Object.values(amounts('tax_optimized')).reduce((a, b) => a + b, 0), 150, 'NG-11: Summe bleibt gleich');
});

// NG-15: Scheitert der Abschluss an einem fremden, währenddessen geschriebenen Schlüssel, gelingt die Rücknahme ohne Schreibsperre.
await section(async () => {
    const sample = balanceStorageFixture('Muster-Haushalt', 'standard', 25);
    const clock = () => new Date('2027-01-02T12:00:00Z');
    if (!sample.records[HOUSEHOLD_PLAN_KEY]) sample.records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope: sample.scope, values: sample.values }], { now: clock }).raw;
    const state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
        pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
    sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    sample.records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    sample.records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: { '2026': { months: {} } } });
    const marketData = { inflation: { rate: 2.14, year: 2026, source: 'ECB (HICP)', dataAsOf: '2027-01-01', fetchStatus: 'ok_primary_ecb',
        metric: 'consumer_prices_all_items_annual_average_growth_pct' },
        etf: { price: 160.2, date: new Date('2026-12-31'), asOf: '2026-12-31', ticker: 'VWCE.DE', source: 'Test', targetYear: 2026 },
        cape: { capeRatio: 28.55, capeAsOf: '2026-12-01', capeSource: 'yale_ie_data_xls', capeFetchStatus: 'ok_primary', capeUpdatedAt: clock().toISOString() } };
    const backend = new Map(Object.entries(sample.records));
    const baseline = JSON.stringify(Object.fromEntries(backend));
    let live = null, armed = false, foreign = false;
    const adapter = { async open() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch({ upserts, deletes }) {
            deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, raw]) => backend.set(key, raw));
            // Verzögertes Speichern einer anderen Seite schreibt mitten im Abschluss einen neuen Schlüssel.
            if (armed && !foreign && upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)) { foreign = true; live.setItem('fremd_waehrend_abschluss', 'x'); }
        } };
    PersistenceFacade.resetPersistenceForTests(adapter); await PersistenceFacade.init({ installLifecycleHooks: false });
    live = (await import('../app/shared/persistence-facade.js')).persistenceStorage;
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: live, now: clock });
    armed = true;
    let error = null;
    try { await commitAnnualPlanUpdate({ draft, storage: live, persistence: PersistenceFacade, engineApi: EngineAPI, now: clock }); }
    catch (caught) { error = caught; }
    assert(foreign, 'NG-15: fremder Schlüssel entsteht während des Abschlusses');
    assert(error, 'NG-15: Abschluss scheitert weiter an der strengen Prüfung');
    assertEqual(error?.code, 'restore_rolled_back', 'NG-15: Rücknahme gelingt statt rollback_failed');
    assert(!PersistenceFacade.hasSyncWriteBlocks(), 'NG-15: keine Schreibsperre nach gelungener Rücknahme');
    const persisted = await PersistenceFacade.readPersistedRecords();
    assertEqual(persisted.fremd_waehrend_abschluss, 'x', 'NG-15: fremder Schlüssel bleibt unberührt');
    const { fremd_waehrend_abschluss: _foreign, ...own } = persisted;
    assertEqual(JSON.stringify(Object.fromEntries(Object.entries(own).sort())), JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(baseline)).sort())),
        'NG-15: Rücknahme stellt den Vorabstand bytegleich her und löscht neu geschriebene Abschlussschlüssel');
    PersistenceFacade.resetPersistenceForTests();
});

// Gemeinsamer produktiver Jahresdialog mit Musterwerten; Tagesgeld- und CAPE-Bestätigung bleiben dem Test überlassen.
async function openAnnual({ people, marketData = annualTestMarketData, readCapeReference }) {
    const { doc } = createDialogFixture();
    let binding;
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false, readCapeReference,
        projectMarketReadings: async () => null, projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: marketData, errors: {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    await prepareCloseFixture(doc, { confirmTagesgeld: false, confirmCape: false });
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    const step = id => doc.querySelector(`[data-close-dialog-step="${id}"]`);
    return { doc, binding, pending, text, step, confirm: () => doc.getElementById('annualConfirmBtn') };
}

// NG-13: Ein Tagesgeld-Stand vor dem 31.12. oder ohne Datum muss je Person bestätigt oder geändert werden.
await section(async () => {
    const people = [{ id: 'a', name: 'Max', value: 10000, lastDate: '2026-11-30', confirmedDate: null },
        { id: 'b', name: 'Erika', value: 5000, lastDate: '2026-10-01', confirmedDate: '2026-12-31' },
        { id: 'c', name: 'Sophie', value: 300, lastDate: null, confirmedDate: null }];
    const dialog = await openAnnual({ people });
    const cash = dialog.text(dialog.step('cash'));
    assert(dialog.confirm().disabled, 'NG-13: alter oder undatierter Stand hält den Abschluss an');
    assert(cash.includes('Stand vom 30.11.2026 – bitte den Stand zum 31.12. eintragen oder bestätigen'), 'NG-13: Hinweis nennt den alten Stand');
    assert(cash.includes('Stand ohne Datum – bitte den Stand zum 31.12. eintragen oder bestätigen'), 'NG-13: Hinweis für einen Stand ohne Datum');
    assert(!dialog.doc.querySelector('[data-tagesgeld-confirm-person="b"]'), 'NG-13: Stand vom 31.12. braucht keine Bestätigung');
    await dialog.doc.querySelector('[data-tagesgeld-confirm-person="a"]').fire('click');
    assert(dialog.confirm().disabled, 'NG-13: Bestätigung gilt je Person');
    const input = dialog.doc.querySelector('[data-tagesgeld-person="c"]');
    input.value = '320'; await input.fire('input');
    assert(!dialog.confirm().disabled, 'NG-13: geänderter Wert gilt als Bestätigung, danach geht der Abschluss weiter');
    await dialog.confirm().fire('click');
    const result = await dialog.pending;
    assertEqual(JSON.stringify(result?.cash?.values), JSON.stringify({ a: 10000, b: 5000, c: 320 }), 'NG-13: Abschluss übernimmt die bestätigten Stände');
    dialog.binding.close(true);
});

// S2: Ein CAPE mit mehr als 25 % Abstand zum Bezugswert braucht im Schritt Marktdaten eine Bestätigung für diesen Abschluss.
await section(async () => {
    const people = [{ id: 'a', name: 'Max', value: 10000, lastDate: '2026-12-31', confirmedDate: null }];
    const reference = () => ({ value: 30, label: 'Jahresabschluss 2025' });
    const jump = { ...annualTestMarketData, cape: { ...annualTestMarketData.cape, capeRatio: 40 } };
    const dialog = await openAnnual({ people, marketData: jump, readCapeReference: reference });
    const market = dialog.text(dialog.step('market'));
    assert(dialog.confirm().disabled, 'S2: großer CAPE-Sprung hält den Abschluss an');
    assert(market.includes('40,00') && market.includes('30,00') && market.includes('33 %') && market.includes('Jahresabschluss 2025') && market.includes('yale_ie_data_xls'),
        'S2: Hinweis nennt beide Werte, Abweichung, Bezug und Quelle');
    await dialog.doc.querySelector('[data-annual-cape-confirm]').fire('click');
    assert(!dialog.confirm().disabled, 'S2: „CAPE-Wert bestätigen“ gibt den Abschluss frei');
    dialog.binding.updateMarketData({ values: { ...jump, cape: { ...jump.cape, capeRatio: 41 } }, errors: {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(dialog.confirm().disabled && dialog.doc.querySelector('[data-annual-cape-confirm]'), 'S2: geänderter Wert wird neu geprüft');
    dialog.binding.close(false); await dialog.pending;
    const calm = await openAnnual({ people, marketData: { ...jump, cape: { ...jump.cape, capeRatio: 37 } }, readCapeReference: reference });
    assert(!calm.doc.querySelector('[data-annual-cape-confirm]') && !calm.confirm().disabled, 'S2: Wert innerhalb der Grenze bleibt ohne Hinweis');
    calm.binding.close(false); await calm.pending;
});

// S2 (Nachtrag 1): Bezugswert ist der CAPE des letzten Jahresabschlusses, sonst der letzte Dezemberwert der hinterlegten Reihe.
await section(async () => {
    const { records } = readyAnnualFixture();
    const storage = { getItem: key => records[key] ?? null };
    const chain = readCapeReference({ storage });
    assertEqual(chain.label, 'Dezember 2024, hinterlegte Shiller-Reihe', 'S2: ohne Jahresabschluss gilt das Ende der hinterlegten Reihe');
    assert(chain.value > 37 && chain.value < 38, 'S2: Dezemberwert 2024 der Reihe');
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { ...state.annualPeriodMetadata, lastCommittedPeriod: 'calendar-year:2025' };
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    const plan = JSON.parse(records[HOUSEHOLD_PLAN_KEY]);
    for (const entry of Object.values(plan.entries)) entry.values.cape = { ...entry.values.cape, value: 35.5, asOf: '2025-12-01' };
    records[HOUSEHOLD_PLAN_KEY] = JSON.stringify(plan);
    assertEqual(JSON.stringify(readCapeReference({ storage })), JSON.stringify({ value: 35.5, label: 'Jahresabschluss 2025' }), 'S2: CAPE des letzten Jahresabschlusses hat Vorrang');
});
