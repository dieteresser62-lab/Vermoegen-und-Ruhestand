import strict from 'node:assert/strict';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { preparePlayAction, commitPlayAction, pendingPlayActions, preparePlayCredit } from '../app/balance/balance-play-execution.js';
import { readReconciliationHistory } from '../app/tranches/tranche-reconciliation.js';

const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const records = () => JSON.stringify(Object.fromEntries(P.keysSync().sort().map(key => [key, P.getItemSync(key)])));
const sales = () => readReconciliationHistory(registry()).filter(event => event.eventType === 'sale_reconciled');
const entries = () => Object.entries(registry().profiles).map(([profileId, profile]) => {
    const lot = JSON.parse(profile.data.depot_tranchen)[1];
    return { profileId, input: { sparerPauschbetrag: 0 }, action: {
        quellen: [1000, 500].map(brutto => ({ kind: lot.type, trancheId: `${profileId}:${lot.trancheId}`,
            sourceProfileId: profileId, brutto, steuer: 0 })),
        verwendungen: { gold: 250, liquiditaet: 1250 }
    } };
});
const rejectUnchanged = async (job, pattern, message) => {
    const before = records();
    await strict.rejects(job, pattern);
    assertEqual(records(), before, message);
};

const oldDate = getAppTestDate(), originalNow = Date.now;
const batchIds = new Set(), actionIds = new Set();
// Derselbe Spieltag und sogar dieselbe reale Millisekunde erzeugen mit UUID
// keine Wiederverwendung. Keine Kennung wird an preparePlayAction übergeben.
const prepare = async controller => {
    const before = records();
    let prepared;
    try {
        Date.now = () => 1793617200000;
        prepared = await preparePlayAction({ controller, entries: entries() });
    } finally { Date.now = originalNow; }
    assertEqual(records(), before, 'Vorschau verändert weder Bestand noch Audit');
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(prepared.batch.id),
        'Produktionsvorgabe erzeugt eine UUID statt einer Kennung aus dem Spieltag');
    assert(!batchIds.has(prepared.batch.id), 'Neue Vorschau hat eine neue Stapelkennung');
    batchIds.add(prepared.batch.id);
    for (const person of prepared.batch.people) {
        assertEqual(person.saleIds.length, 2, 'Zwei Verkäufe derselben Person werden getrennt gekennzeichnet');
        person.saleIds.forEach((id, index) => {
            assertEqual(id, `${prepared.batch.id}-${person.profileId}-${index + 1}`, 'Aktionskennung enthält Stapel, Person und Verkaufsnummer');
            assert(!actionIds.has(id), 'Aktionskennung wurde in keinem vorherigen Ablauf verwendet');
            actionIds.add(id);
        });
    }
    return prepared;
};
const execute = async (controller, prepared) => {
    const count = sales().length;
    await commitPlayAction(prepared, { controller });
    const newSales = sales().slice(count);
    assertEqual(newSales.length, 4, 'Bestätigung verbucht jeden vorbereiteten Verkauf genau einmal');
    assertEqual(JSON.stringify(newSales.map(event => event.actionId)), JSON.stringify(prepared.batch.people.flatMap(person => person.saleIds)),
        'Audit erhält genau die vorbereiteten Aktionskennungen');
    assertEqual(new Set(sales().map(event => event.actionId)).size, sales().length, 'Gespeicherte Verkaufskennungen sind eindeutig');
};
const credit = async (controller, prepared) => {
    await commitPlayAction(await preparePlayCredit(prepared.batch.id, { controller }), { controller });
    assertEqual(pendingPlayActions().length, 0, 'Gutschrift gibt die nächste Ausführung frei');
};

try {
    for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
        for (const source of ['copy', 'demo']) {
            const f = await playFixture(kind, createMusterHaushaltRecords('2026-11-02'));
            const realBefore = f.realBytes();
            let controller = await f.boot();
            const start = async () => {
                await controller.start(async () => ({ source, householdId: 'max-erika', testDate: '2026-11-02' }));
                controller = await f.boot();
            };
            await start();
            const first = await prepare(controller);
            // Abbrechen und erneut öffnen: Der erste Entwurf ist nie gespeichert.
            const confirmed = await prepare(controller);
            await execute(controller, confirmed);
            await rejectUnchanged(() => commitPlayAction(confirmed, { controller }), /geändert/,
                'Erneutes Bestätigen scheitert vor einem zweiten Verkaufsaufruf');
            await rejectUnchanged(() => commitPlayAction(first, { controller }), /geändert/,
                'Ein überholter abgebrochener Entwurf wird nicht ausgeführt');
            await rejectUnchanged(() => preparePlayAction({ controller, entries: entries() }), /Gutschrift/,
                'Ausstehende Gutschrift verhindert eine weitere Verkaufsbuchung');

            const saved = records();
            controller = await f.boot();
            assertEqual(records(), saved, `${kind}/${source}: Neuladen erhält den gespeicherten Stand ohne Wiederholung`);
            assertEqual(pendingPlayActions()[0].id, confirmed.batch.id, 'Neuladen setzt nur die offene Gutschrift fort');
            await rejectUnchanged(() => commitPlayAction(confirmed, { controller }), /geändert/,
                'Auch nach Neuladen ist ein alter Buchungsentwurf gesperrt');
            await credit(controller, confirmed);
            const again = await prepare(controller);
            await execute(controller, again);
            await credit(controller, again);
            assertEqual(sales().length, 8, 'Erneutes Ausführen erzeugt vier neue Verkäufe mit neuen Kennungen');

            if (source === 'demo') {
                await controller.restart(async () => true);
                controller = await f.boot();
                assertEqual(sales().length, 0, 'Beispiel neu starten verwirft die bisherigen Spielbuchungen');
                const restarted = await prepare(controller);
                await execute(controller, restarted);
                await credit(controller, restarted);
            }
            assertEqual(f.realBytes(), realBefore, `${kind}/${source}: Buchungen und Neuladen erhalten echte Daten bytegleich`);
            await controller.end(async () => true);
            controller = await f.boot();
            assertEqual(f.realBytes(), realBefore, `${kind}/${source}: Beenden erhält echte Daten bytegleich`);
            await start();
            assertEqual(sales().length, 0, 'Neuer Spielbereich enthält keine alten Spielbuchungen');
            const fresh = await prepare(controller);
            await execute(controller, fresh);
            await credit(controller, fresh);
            await controller.end(async () => true);
            assertEqual(f.realBytes(), realBefore, `${kind}/${source}: Beenden und neu starten erhalten echte Daten bytegleich`);
        }
    }
} finally {
    Date.now = originalNow;
    P.resetPersistenceRuntimeForTests();
    setAppTestDate(oldDate);
}
