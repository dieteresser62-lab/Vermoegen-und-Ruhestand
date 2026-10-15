import strict from 'node:assert/strict';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { canExecutePlayAction, preparePlayAction, commitPlayAction, pendingPlayActions, preparePlayCredit } from '../app/balance/balance-play-execution.js';
import { renderBalancePlayExecution, describePlayBookings } from '../app/balance/balance-play-execution-ui.js';
import { initializeProbelaufPage } from '../app/shared/probelauf-state.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { loadProbelaufBalance } from '../app/shared/probelauf-comparison.js';
import { EngineAPI } from '../engine/index.mjs';
import { readReconciliationHistory, projectReconciliationCashStatuses } from '../app/tranches/tranche-reconciliation.js';
import { buildReconciliationCashStatusesHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { evaluateWealthHistory } from '../app/tranches/tranchen-history-model.js';
import { renderWealthHistorySvg } from '../app/tranches/tranchen-history-svg.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';

const rejected = async (job, pattern) => { await strict.rejects(job, pattern); assert(true, 'Auftrag wird ohne Write verweigert'); };
const read = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const raw = () => JSON.stringify(Object.fromEntries(P.keysSync().sort().map(key => [key, P.getItemSync(key)])));
const oldDate = getAppTestDate();
const oldFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Kein Netz im Spielbuchungsweg'); };
const entriesFor = () => Object.entries(read().profiles).map(([profileId, profile]) => {
    const lot = JSON.parse(profile.data.depot_tranchen)[1];
    return { profileId, input: { sparerPauschbetrag: 0 }, action: {
        quellen: [{ kind: lot.type, trancheId: `${profileId}:${lot.trancheId}`, sourceProfileId: profileId, brutto: 10000, steuer: 500 }],
        verwendungen: { gold: 2000, aktien: 1000, bonds: 1000, geldmarkt: 500, liquiditaet: 5000 }
    } };
});
try {
    for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
        const seed = createMusterHaushaltRecords('2026-11-02');
        seed.balance_inputs_v1 = '{"legacy":true}';
        if (kind === 'localstorage') {
            const legacy = JSON.parse(seed.rs_profiles_v1);
            for (const profile of Object.values(legacy.profiles)) {
                const lots = JSON.parse(profile.data.depot_tranchen).map(lot => { const copy = { ...lot, schemaVersion: 1 }; delete copy.taxExempt; return copy; });
                profile.data.depot_tranchen = JSON.stringify(lots);
            }
            seed.rs_profiles_v1 = JSON.stringify(legacy);
            seed.depot_tranchen = legacy.profiles[seed.rs_current_profile].data.depot_tranchen;
        }
        const f = await playFixture(kind, seed), realBefore = f.realBytes();
        let controller = await f.boot();
        assert(!canExecutePlayAction(controller), `${kind}: echter Betrieb bietet keine Erfassung`);
        await rejected(preparePlayAction({ entries: entriesFor(), controller }), /Spielbereich/);
        assertEqual(f.realBytes(), realBefore, `${kind}: Verweigerung erhält echten Altbestand bytegleich`);
        await controller.start(async () => ({ source: 'copy', testDate: '2026-11-02' }));
        controller = await f.boot();
        const entries = entriesFor(), before = raw(), writes = f.writes;
        const plan = await preparePlayAction({ entries, controller, id: `buchung-${kind}` });
        assertEqual(raw(), before, `${kind}: Vorschau und Abbruch schreiben weder Bestand noch Audit`);
        assertEqual(f.writes, writes, `${kind}: Vorschau startet keinen Backendwrite`);
        assertEqual(plan.lines.filter(line => line.kind === 'buy').length, 8, 'Aktien, Gold, Anleihen und Geldmarkt für beide Personen');
        assert(describePlayBookings(plan).includes('Max') && describePlayBookings(plan).includes('Erika')
            && describePlayBookings(plan).includes('Steuern') && describePlayBookings(plan).includes('Gutschrift'), 'Bestätigung nennt Personen, Steuer und offene Gutschrift');
        const firstCash = Number(storage.getItem('profile_tagesgeld'));
        await commitPlayAction(plan, { controller });
        const history = readReconciliationHistory(read()), sales = history.filter(event => event.eventType === 'sale_reconciled');
        assertEqual(sales.length, 2, 'Verkäufe laufen durch den normalen Auditweg');
        assert(sales.every(sale => sale.source === 'spielwert' && sale.actual.taxes === 500 && sale.actual.netProceeds === 9500), 'Steuer und Spielwertherkunft bleiben im normalen Verkaufsbeleg');
        assertEqual(Number(storage.getItem('profile_tagesgeld')), firstCash, 'Gutschrift bleibt bis zur Bestätigung offen');
        for (const person of plan.batch.people) {
            const data = read().profiles[person.profileId].data, lots = JSON.parse(data.depot_tranchen);
            const original = JSON.parse(JSON.parse(plan.before.rs_profiles_v1).profiles[person.profileId].data.depot_tranchen);
            assertClose(lots.find(lot => lot.trancheId === original[1].trancheId).shares, original[1].shares - 10000 / original[1].currentPrice, 1e-9, 'Exakte zugeordnete Verkaufstranche und Stückzahl');
            assertEqual(lots.filter(lot => lot.source === 'spielwert').length, 4, 'Käufe werden als neue normale Tranchen erfasst');
            assertEqual(Object.keys(JSON.parse(data.profile_wealth_history_lots_v1).lots).length, original.length + 4, 'Gemeinsamer Kaufweg hält Verlaufsstammdaten');
        }
        assert(buildReconciliationCashStatusesHtml(projectReconciliationCashStatuses(read())).includes('Spielwert'), 'Cashstatus kennzeichnet die Spielverkäufe sichtbar');
        assertEqual(pendingPlayActions().length, 1, 'Eine Haushaltsgutschrift mit zwei Personen offen');
        await rejected(commitPlayAction(plan, { controller }), /geändert/);
        await rejected(preparePlayAction({ entries, controller }), /Gutschrift/);
        controller = await f.boot();
        assertEqual(pendingPlayActions()[0].id, plan.batch.id, 'Neustart erhält die ausstehende Gutschrift');
        const beforeCredit = raw();
        const credit = await preparePlayCredit(plan.batch.id, { controller });
        assertEqual(raw(), beforeCredit, 'Gutschriftvorschau und Abbruch sind schreibfrei');
        await commitPlayAction(credit, { controller });
        assertEqual(pendingPlayActions().length, 0, 'Beide normalen Cashbestätigungen sind abgeschlossen');
        for (const person of plan.batch.people) {
            const data = read().profiles[person.profileId].data;
            assertEqual(Number(data.profile_tagesgeld), person.cashBefore + 5000, 'Gutschrift zieht Käufe ab und zählt Quellen einmal');
            assert(JSON.parse(data.profile_cash_history_v1).entries.some(entry => entry.source === 'spielwert'), 'Tagesgeldverlauf hält die Herkunft');
        }
        const confirmations = readReconciliationHistory(read()).filter(event => event.eventType === 'cash_posting_confirmed');
        assertEqual(confirmations.length, 2, 'Ein Bestätigungsbeleg je Verkauf');
        assert(confirmations.every(event => event.source === 'spielwert'), 'Protokoll der Gutschrift nennt Spielwert');
        const activeId = storage.getItem('rs_current_profile'), data = read().profiles[activeId].data;
        const projection = evaluateWealthHistory({ profiles: [{ id: activeId, belongsToHousehold: true,
            currentCash: Number(data.profile_tagesgeld), cashHistory: JSON.parse(data.profile_cash_history_v1),
            lots: Object.values(JSON.parse(data.profile_wealth_history_lots_v1).lots) }],
            events: readReconciliationHistory(read()), prices: JSON.parse(storage.getItem('rs_daily_prices_v1')), startDate: '2026-11-01', today: '2026-11-04', assetType: 'aktien_neu' });
        assert(projection.events.some(event => event.kind === 'buy' && event.source === 'spielwert')
            && projection.events.some(event => event.kind === 'sell' && event.source === 'spielwert'), 'Echter Verlauf projiziert Spielkäufe und Spielverkäufe');
        assert(renderWealthHistorySvg(projection).includes('Spielwert'), 'Verlaufsmarken nennen Spielwert');
        await rejected(preparePlayCredit(plan.batch.id, { controller }), /Keine ausstehende/);
        const assetSales = Object.entries(read().profiles).map(([profileId, profile]) => {
            const buys = JSON.parse(profile.data.depot_tranchen).filter(lot => lot.source === 'spielwert');
            return { profileId, action: { quellen: buys.map(lot => ({ kind: lot.type, trancheId: lot.trancheId, brutto: lot.marketValue, steuer: 0 })),
                verwendungen: { liquiditaet: 4500 } } };
        });
        const allSales = await preparePlayAction({ entries: assetSales, controller, id: `vollverkauf-${kind}` });
        assertEqual(allSales.lines.length, 8, 'Auch Gold, Anleihen und Geldmarkt werden über konkrete Tranchen verkauft');
        await commitPlayAction(allSales, { controller });
        for (const profile of Object.values(read().profiles)) assert(!JSON.parse(profile.data.depot_tranchen).some(lot => lot.source === 'spielwert'), 'Vollverkauf entfernt die gekauften Stücke über den normalen Erfassungsweg');
        await commitPlayAction(await preparePlayCredit(allSales.batch.id, { controller }), { controller });
        assertEqual(f.realBytes(), realBefore, `${kind}: Ausführung, Neustart und Gutschrift lassen echte Daten und Sicherungspunkte bytegleich`);
        await controller.end(async () => true);
        assertEqual(f.realBytes(), realBefore, `${kind}: Verwerfen erhält echte Daten und Sicherungspunkte bytegleich`);
    }

    // Die echte Haushaltsrechnung liefert Präfix-IDs und unterschiedliche Quoten.
    const f = await playFixture('tauri', createMusterHaushaltRecords('2026-11-02'));
    let controller = await f.boot(); await controller.start(async () => ({ source: 'copy', testDate: '2026-11-02' })); controller = await f.boot();
    const b = await loadProbelaufBalance();
    const calc = b.buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
    for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
        const runs = b.evaluateStoredAnnualHousehold(calc.inputData, calc.profiles, calc.engineLastState, { engineApi: EngineAPI, withdrawalMode: mode });
        const entries = runs.map(run => ({ profileId: run.profileId, action: run.ui.action, input: run.input }));
        const plan = await preparePlayAction({ controller, entries, id: `rechnung-${mode}` });
        for (const run of runs) assertClose(plan.lines.filter(line => line.profileId === run.profileId).reduce((sum, line) => sum + line.net, 0),
            run.ui.action.nettoErlös, .01, `${mode}: unveränderte Nettoverteilung aus der echten Haushaltsrechnung`);
    }
    const plan = await preparePlayAction({ controller, entries: entriesFor(), id: 'fehler' }), beforeFailure = raw();
    f.fail = true;
    await rejected(commitPlayAction(plan, { controller }), /fehlgeschlagen/);
    assertEqual(raw(), beforeFailure, 'Fehlender Backendcommit rollt alle Personen und Buchungen bytegleich zurück');

    const oldWindow = globalThis.window;
    try {
        const profiles = calc.profiles.map(profile => ({ profileId: profile.profileId,
            tagesgeld: profile.inputs.tagesgeld, geldmarkt: profile.inputs.geldmarktEtf }));
        globalThis.window = { __profilverbundProfileSummaries: profiles,
            __profilverbundActionResults: calc.profiles.map(profile => ({ profileId: profile.profileId, input: profile.inputs, action: { type: 'NONE' } })) };
        const renderer = new ActionRenderer({});
        for (const buy of [true, false]) {
            const entries = renderer._playExecutionEntries({}, {}, {}, 0, { from: buy ? 'Tagesgeld' : 'Geldmarkt-ETF', to: buy ? 'Geldmarkt-ETF' : 'Tagesgeld', amount: 1000 });
            const transfer = await preparePlayAction({ entries, controller });
            assertEqual(transfer.batch.people.length, 2, 'Reine Haushaltsumschichtung erfasst beide Personen');
            const total = profiles.reduce((sum, profile) => sum + (buy ? profile.tagesgeld : profile.geldmarkt), 0);
            for (const [index, entry] of entries.entries()) assertClose(entry.action.quellen[0].brutto,
                1000 * (buy ? profiles[index].tagesgeld : profiles[index].geldmarkt) / total, 1e-8, 'Umschichtung entspricht den dargestellten Profilgewichten');
        }
    } finally { globalThis.window = oldWindow; }

    // Reine Käufe und Geldmarktumschichtung brauchen keine Handerfassung.
    const profileId = storage.getItem('rs_current_profile');
    const beforePurchase = Number(storage.getItem('profile_tagesgeld'));
    const purchase = await preparePlayAction({ controller, entries: [{ profileId, action: { quellen: [{ kind: 'liquiditaet', brutto: 1000 }],
        verwendungen: { geldmarkt: 1000 } }, cashSplit: { fromTagesgeld: 1000, fromGeldmarkt: 0 } }] });
    await commitPlayAction(purchase, { controller });
    assertEqual(Number(storage.getItem('profile_tagesgeld')), beforePurchase - 1000, 'Reiner Kauf bucht Tagesgeld sofort über den normalen Cashwriter');
    const transfer = await preparePlayAction({ controller, entries: [{ profileId, input: { sparerPauschbetrag: 0 },
        action: { quellen: [{ kind: 'geldmarkt', brutto: 2000 }], verwendungen: { liquiditaet: 2000 } } }] });
    assert(transfer.lines[0].taxes > 0 && transfer.batch.people[0].net < 2000, 'Geldmarktumschichtung berechnet Steuern mit der normalen Settlementrechnung');
    const withLossCarry = await preparePlayAction({ controller, entries: [{ profileId, input: { sparerPauschbetrag: 0 },
        action: { taxSettlement: { lossCarryStart: 1000000 }, quellen: [{ kind: 'geldmarkt', brutto: 2000 }], verwendungen: { liquiditaet: 2000 } } }] });
    assertEqual(withLossCarry.lines[0].taxes, 0, 'Geldmarktumschichtung berücksichtigt den bestehenden Verlusttopf');

    // Vorhandene Seitendialoge: Abbrechen, Bestätigen und vorbelegte Gutschrift.
    const { doc } = createDialogFixture();
    for (const id of ['balancePlayExecute', 'balancePlayCredit', 'balancePlayCreditAmount', 'balancePlayExecutionStatus']) {
        const node = doc.createElement(id.includes('Amount') || id.includes('Status') ? 'span' : 'button'); node.id = id; doc.body.append(node);
    }
    const attached = await initializeProbelaufPage({ doc, win: f.win });
    renderBalancePlayExecution(doc, entriesFor());
    const executeButton = doc.getElementById('balancePlayExecute');
    assert(!executeButton.hidden, 'Spielbereich zeigt den Ausführenknopf');
    const beforeCancel = raw();
    let job = executeButton.fire('click');
    const until = async test => { for (let i = 0; i < 400 && !test(); i++) await new Promise(resolve => setTimeout(resolve, 1)); assert(test(), 'Seitendialog hat den erwarteten Zustand'); };
    await until(() => doc.querySelector('[data-page-choice-cancel]'));
    await doc.querySelector('[data-page-choice-cancel]').fire('click'); await job;
    assertEqual(raw(), beforeCancel, 'Echter Abbruchknopf schreibt nichts');
    job = executeButton.fire('click'); await until(() => doc.querySelector('[data-page-choice-accept]'));
    await doc.querySelector('[data-page-choice-accept]').fire('click'); await job;
    assert(!doc.getElementById('balancePlayCredit').hidden, 'Nach Buchung steht Gutschrift bestätigen bereit');
    job = doc.getElementById('balancePlayCredit').fire('click'); await until(() => doc.querySelector('[data-play-credit-person]'));
    assertEqual(parseFloat(doc.querySelector('[data-play-credit-person]').value.replaceAll('.', '').replace(',', '.')), pendingPlayActions()[0].people[0].finalCash, 'Gutschrift ist mit dem berechneten Betrag vorbelegt');
    await doc.querySelector('[data-play-credit-confirm]').fire('click');
    assert(!doc.getElementById('balancePlayCreditDialog'), `Gutschriftdialog bestätigt: ${doc.getElementById('balancePlayCreditDialog')?.querySelector('[role="status"]')?.textContent || ''}`);
    await job;
    assertEqual(pendingPlayActions().length, 0, 'Echter Gutschriftknopf schreibt beide normalen Cashbestätigungen');
    attached.invalidate(); renderBalancePlayExecution(doc, entriesFor()); assert(executeButton.hidden, 'Gesperrter Koordinator verbirgt die Erfassung');
    for (const phase of ['starting', 'active', 'restoring']) assert(!canExecutePlayAction({ initialize() {}, state: { version: 1, active: true, phase, testDate: '2020-01-01' }, runtime: { canContinue: false } }), `Alter Probelauf ${phase} erlaubt keine Erfassung`);

    // Stand heute ohne Testdatum bleibt im getrennten Spielbereich erlaubt.
    const today = await playFixture('localstorage', createMusterHaushaltRecords('2026-10-15'));
    controller = await today.boot(); await controller.start(async () => ({ source: 'copy', testDate: null })); controller = await today.boot();
    assertEqual(controller.state.testDate, null, 'Stand heute hat kein Testdatum');
    assert(canExecutePlayAction(controller), 'Stand heute erlaubt Spielbuchungen');
    const todayPlan = await preparePlayAction({ controller, entries: entriesFor() });
    assert(todayPlan.lines.length > 0, 'Stand heute kann ohne Netz eine Anweisung vorbereiten');
    assertEqual(networkCalls, 0, 'Erzeugte Buchungen und Gutschrift erreichen keinen Netzpfad');
} finally { P.resetPersistenceRuntimeForTests(); setAppTestDate(oldDate); globalThis.fetch = oldFetch; }
