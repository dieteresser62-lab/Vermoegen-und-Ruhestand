// SV-1: Daten & Sicherung holt einen Punkt nach einfacher Rückfrage für den ganzen Haushalt zurück; Abbruch schreibt nichts.
// Nur synthetische Daten: Musterhaushalt Max und Erika, Testdatum 2026-10-02.
import fs from 'node:fs';
import { bindDataRestoration, createDataRestorationController, snapshotTitle, snapshotTime } from '../app/data/data-restoration.js';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS as K, IMPORT_POINT_LABELS } from '../app/shared/snapshot-archive.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';

// 1 · Anlass in Worten.
assertEqual(snapshotTitle({ kind: K.monthlyClosePreMutation, label: 'Monatsabschluss 2026-09', createdAt: '2026-10-01T12:00:00Z' }), 'Vor dem Monatsabschluss September 2026', 'Monatspunkt nennt den Monat');
assertEqual(snapshotTitle({ kind: K.annualClosePreMutation, label: 'Max', createdAt: '2027-01-05T12:00:00Z' }), 'Vor dem Jahresabschluss 2026', 'Jahrespunkt nennt das abgeschlossene Jahr');
assertEqual(snapshotTitle({ kind: K.fullBackupImportRecovery, label: 'Vollbackup-Import Recovery 2026-10-13T12:00:00Z', createdAt: '2026-10-13T12:00:00Z' }), 'Vor dem Einspielen einer Sicherung', 'Einspielpunkt ohne technischen Namen');
for (const label of Object.values(IMPORT_POINT_LABELS)) assertEqual(snapshotTitle({ kind: K.fullBackupImportRecovery, label, createdAt: '2026-10-13T12:00:00Z' }), label, 'Punkt vor dem Einspielen nennt seinen Anlass: ' + label);
assert(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/.test(snapshotTime('2026-10-13T12:00:00Z')), 'Datum und Uhrzeit deutsch');

async function boot(seed) {
    const values = { ...seed }, points = new Map();
    resetPersistenceForTests({ name: 'sv1-data-restoration', async loadAll() { return { ...values }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => delete values[key]); upserts.forEach(([key, value]) => { values[key] = value; }); },
        async writeSnapshot(point) { points.set(point.id, structuredClone(point)); }, async readSnapshot(id) { return structuredClone(points.get(id)); },
        async listSnapshots() { return [...points.values()].map(({ records, ...entry }) => entry); }, async deleteSnapshot(id) { points.delete(id); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return { values, points };
}
function pageDocument(decision) {
    const doc = createPresentationTestDocument(), create = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = create(tag); node.dataset = {}; node.focus = () => {};
        node.removeEventListener = type => node.events.delete(type);
        node.classList = { contains: value => node.className.split(' ').includes(value), add() {}, remove() {} };
        node.close = () => { node.open = false; };
        node.showModal = () => { node.open = true; queueMicrotask(() => doc.nodes.find(item => decision.accept ? item.dataset?.pageDialogAccept === '' : item.dataset?.pageDialogCancel === '').click()); };
        return node;
    };
    doc.body = doc.createElement('body');
    for (const match of fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8').matchAll(/\bid="([^"]+)"/g)) {
        if (doc.getElementById(match[1])) continue;
        const node = doc.createElement('div'); node.id = match[1]; doc.body.appendChild(node);
    }
    doc.contains = () => true; doc.addEventListener = () => {}; doc.removeEventListener = () => {};
    doc.documentElement = { dataset: { suitePage: 'data' } }; doc.querySelectorAll = () => [];
    return doc;
}

// 2 · Abbruch der Rückfrage schreibt nichts; Bestätigung holt den ganzen Haushalt zurück und legt „Vor dem Zurückholen“ an.
for (const accept of [false, true]) {
    const seed = createMusterHaushaltRecords('2026-10-02');
    const { values, points } = await boot({ ...seed, profile_tagesgeld: '777' });
    await SnapshotArchive.createSnapshot({ id: 'monat', kind: K.monthlyClosePreMutation, label: 'Monatsabschluss 2026-09', activeProfileId: seed.rs_current_profile,
        records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(seed), getItem: key => seed[key] }) });
    const decision = { accept }, doc = pageDocument(decision);
    let reloads = 0;
    bindDataRestoration(doc, { guard: createNavigationGuard({ decide: async () => true }), reload: () => { reloads++; } });
    const button = doc.createElement('button'); button.dataset.restorePoint = 'monat';
    doc.getElementById('dataSnapshotList').appendChild(button);
    const before = JSON.stringify(values);
    await doc.getElementById('dataSnapshotList').events.get('click')({ target: { closest: () => button } });
    const textOf = node => [node.textContent, ...node.children.map(textOf)].join(' ');
    const dialogText = doc.nodes.filter(node => node.id === 'pageDialogDescription').map(textOf).join(' ');
    assert(dialogText.includes('Der heutige Stand wird ersetzt') && dialogText.includes('Vor dem Monatsabschluss September 2026'), 'Rückfrage nennt Datum, Anlass und Folge');
    // JW-1a (Fable P2-5): Vor dem Verwerfen sagt die Rückfrage, was seit dem Punkt erfasst wurde und verloren geht.
    assert(dialogText.includes('Was du seitdem eingetragen hast') && dialogText.includes('Verkäufe') && dialogText.includes('importierte Ausgaben'), 'Rückfrage nennt, was verloren geht');
    if (!accept) {
        assertEqual(JSON.stringify(values), before, 'Abbruch der Rückfrage schreibt nichts');
        assertEqual(points.size, 1, 'Abbruch legt keinen Punkt an');
        assertEqual(doc.getElementById('dataRestoreStatus').textContent, 'Zurückholen abgebrochen.', 'Abbruch wird gemeldet');
    } else {
        assertEqual(values.profile_tagesgeld, seed.profile_tagesgeld, 'Bestätigung holt den Stand des Punkts zurück');
        assertEqual([...points.values()].filter(point => point.label === IMPORT_POINT_LABELS.restore).length, 1, 'Bestätigung legt genau einen Punkt „Vor dem Zurückholen“ an');
        assertEqual(reloads, 1, 'Nach dem Zurückholen lädt die Seite einmal neu');
    }
}

// 3 · Controller: ein Vorgang je Seite; nach erfolgreichem Zurückholen gesperrt.
{
    const seed = createMusterHaushaltRecords('2026-10-02');
    await boot(seed);
    await SnapshotArchive.createSnapshot({ id: 'jahr', kind: K.annualClosePreMutation, activeProfileId: seed.rs_current_profile,
        records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(seed), getItem: key => seed[key] }) });
    const controller = createDataRestorationController({ guard: createNavigationGuard({ decide: async () => true }), reload: () => {} });
    assertEqual((await controller.executeRestore()).status, 'in_flight', 'Ohne gelesenen Punkt kein Zurückholen');
    assert(await controller.preview('jahr'), 'Punkt gelesen');
    assertEqual((await controller.executeRestore()).status, 'restored', 'Jahrespunkt zurückgeholt');
    assert(controller.blocked && await controller.preview('jahr') === null, 'Nach dem Zurückholen bleibt die alte Seite gesperrt');
}
