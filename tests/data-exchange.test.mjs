import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createDataExchangeController, createDataBalanceContext, bindDataExchange } from '../app/data/data-exchange.js';
import { importBalanceFile, connectLegacySnapshotFolder } from '../app/balance/balance-file-service.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createBalanceExportDocument } from '../app/balance/balance-binder-imports.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PersistenceFacade as p, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { buildSnapshot, SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { previewSnapshotRetention } from '../app/shared/snapshot-retention.js';
import { bindDataRestoration } from '../app/data/data-restoration.js';
import { projectDataModel } from '../app/data/data-model.js';
import { renderDataPage } from '../app/data/data-renderer.js';
const guard = createNavigationGuard({ decide: async () => true });
const c = createDataExchangeController({ guard });
let release, writes = 0; const gate = new Promise(resolve => release = resolve);
const first = c.run(async operation => { await gate; operation.check(); writes++; }).catch(error => ({ error }));
assertEqual((await c.run(async () => writes++)).status, 'in_flight', 'Austauschcontroller sperrt Doppelklick');
const navigation = guard.prepare();
for (let i = 0; i < 10 && !guard.reasons().some(reason => reason.phase === 'cancelling'); i++) await Promise.resolve();
release(); await first;
assertEqual(writes, 0, 'Navigation bricht vorbereiteten Austausch vor Write ab');
const attempt = await navigation; assert(attempt, 'Navigation wartet bis Austauschende'); guard.end(attempt);
await c.run(async operation => { operation.commit(); assertEqual(await guard.prepare(), null, 'Importcommit hält Navigation gesperrt'); });

const records = createMusterHaushaltRecords('2026-09-01'), points = new Map();
resetPersistenceForTests({ name: 'data-exchange', loadAll: async () => ({ ...records }),
    saveBatch: async batch => { for (const key of batch.deletes) delete records[key]; for (const [key, value] of batch.upserts) records[key] = value; },
    writeSnapshot: async snapshot => points.set(snapshot.id, snapshot), readSnapshot: async id => points.get(id), listSnapshots: async () => [...points.values()] });
await p.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const canonicalState = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
for (const key of ['goldBestand', 'zielLiquiditaetJahre', 'runwayMinM', 'runwayTargetM']) delete canonicalState.inputs[key];
const file = createBalanceExportDocument(canonicalState);
for (const fail of ['dry', 'final', 'none']) {
    const order = [], operation = { check() {}, commit() { order.push('commit'); } };
    let calls = 0, error;
    try { await importBalanceFile(file, { navigationOperation: operation, applyInputs() { order.push('apply'); },
        update: async mode => { order.push(mode); return { ok: !(fail === 'dry' && ++calls === 1 || fail === 'final' && mode === 'persist_inputs') }; },
        replace: async () => { order.push('replace'); return { recoverySnapshotId: 'synthetic' }; }, rollback: async () => order.push('rollback') }); }
    catch (e) { error = e; }
    if (fail === 'dry') { assert(error && !order.includes('replace'), 'Engine-Vorprüfung verhindert Balancewrite'); }
    if (fail === 'final') { assert(error && order.includes('rollback'), 'Engine-Nachprüfung rollt Balanceimport zurück'); }
    if (fail === 'none') assertEqual(order.join(','), 'apply,preview,replace,commit,persist_inputs', 'Beide Seiten benutzen denselben Balance-Importvertrag');
}
const abort = new Error('synthetischer Navigationsabbruch'); abort.name = 'AbortError';
let replaced = false, rolledBack = false, caught;
try {
    await importBalanceFile(file, {
        navigationOperation: { check() { if (replaced) throw abort; }, commit() { throw new Error('Commit nach Abbruch'); } },
        applyInputs() {}, update: async () => ({ ok: true }),
        replace: async () => { replaced = true; return { recoverySnapshotId: 'synthetic' }; },
        rollback: async () => { rolledBack = true; }
    });
} catch (error) { caught = error; }
assert(rolledBack && caught === abort, 'Dienst rollt Kündigung nach Replace zurück und erhält ursprünglichen AbortError');
const source = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
// Kleines DOM-Doppel des echten Eingabeinventars; keine zweite Rechenformel.
const doc = createPresentationTestDocument(), inputs = [];
for (const match of source.matchAll(/<(input|select)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)(?=<\/select>|<input|<\/div|\n|$)/g)) {
    const node = doc.createElement(match[1]); node.id = match[3]; node.type = /type="([^"]+)"/.exec(match[2])?.[1] || 'text';
    node.value = /value="([^"]*)"/.exec(match[2])?.[1] || '';
    if (match[1] === 'select') node.value = /<option[^>]*value="([^"]*)"[^>]*selected/.exec(match[4])?.[1] || /<option[^>]*value="([^"]*)"/.exec(match[4])?.[1] || '';
    node.checked = /\bchecked\b/.test(match[2]);
    node.dataset = {}; node.classList = { contains: value => node.className.split(' ').includes(value) };
    node.className = /class="([^"]*)"/.exec(match[2])?.[1] || ''; doc.body.appendChild(node); inputs.push(node);
}
const previousDocument = globalThis.document, previousWindow = globalThis.window;
const win = { fetch: async () => ({ ok: true, text: async () => source }), DOMParser: class { parseFromString() { return { querySelectorAll: () => inputs }; } } };
try {
    globalThis.document = doc; globalThis.window = win;
    const context = await createDataBalanceContext(doc, win);
    assertEqual(win.EngineAPI, EngineAPI, 'Bereits importierte Engine bleibt im Profilverbund-Dateikontext verfügbar');
    context.applyInputs(file.payload.inputs);
    const before = JSON.stringify(records);
    const preview = await context.update('preview');
    assert(preview.ok, 'Neue Seite nutzt echten Reader und echte Engine-Vorschau');
    assertEqual(JSON.stringify(records), before, 'Balance-Vorprüfung schreibt keinen Bestand');
    const result = await c.run(operation => importBalanceFile(file, { ...context, navigationOperation: operation }));
    assert(result.ok && points.size === 1, 'Neue Seite bestätigt echten Balanceimport mit Recovery');
    // Echter Austauschbinder mit bestätigtem Seitendialog und Kündigung nach Replace.
    const createElement = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = createElement(tag); node.dataset = {}; node.focus = () => {}; node.removeEventListener = type => node.events.delete(type);
        node.close = () => { node.open = false; };
        node.showModal = () => { node.open = true; queueMicrotask(() => doc.nodes.find(item => item.dataset?.pageDialogAccept === '').click()); };
        return node;
    };
    doc.contains = () => true;
    for (const id of ['dataExchangeStatus', 'dataExchangeTechnical', 'dataBalanceImport', 'dataBalanceFile']) { const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node); }
    const { StorageManager } = await import('../app/balance/balance-storage.js');
    const replace = StorageManager.replaceStateFromImport, rollback = StorageManager.rollbackImportReplace;
    let rollbackCalls = 0;
    try {
        StorageManager.replaceStateFromImport = async (payload, options) => {
            const receipt = await replace.call(StorageManager, payload, options);
            options.navigationOperation.controller.abort(); return receipt;
        };
        StorageManager.rollbackImportReplace = async (...args) => { rollbackCalls++; return rollback.apply(StorageManager, args); };
        const controller = bindDataExchange(doc, { win, guard: createNavigationGuard({ decide: async () => true }) });
        const input = doc.getElementById('dataBalanceFile'); input.value = 'chosen'; input.files = [{ text: async () => JSON.stringify(file) }];
        input.events.get('change')({ target: input });
        for (let i = 0; i < 1000 && (controller.busy || !doc.getElementById('dataExchangeStatus').textContent); i++) await new Promise(resolve => setImmediate(resolve));
        assertEqual(rollbackCalls, 1, 'Sicherungsseite rollt Kündigung nach Replace zurück');
        assertEqual(doc.getElementById('dataExchangeStatus').textContent, 'Austausch abgebrochen.', 'Sicherungsseite meldet Navigationskündigung als Abbruch');
        assertEqual(input.value, '', 'Austauschabbruch bereinigt Dateiauswahl');
        input.files = [{ text: async () => { throw new Error('IndexedDB kv SYNTHETIC_EXCHANGE_FAILED'); } }];
        input.events.get('change')({ target: input });
        for (let i = 0; i < 1000 && controller.busy; i++) await new Promise(resolve => setImmediate(resolve));
        assert(!/IndexedDB|SYNTHETIC_EXCHANGE_FAILED|\bkv\b/.test(doc.getElementById('dataExchangeStatus').textContent), 'Dynamischer Austauschfehler bleibt im Haupttext verständlich');
        assert(doc.getElementById('dataExchangeTechnical').textContent.includes('SYNTHETIC_EXCHANGE_FAILED'), 'Austauschfehlerursache liegt ausschließlich in Details');

    } finally { StorageManager.replaceStateFromImport = replace; StorageManager.rollbackImportReplace = rollback; }
} finally { globalThis.document = previousDocument; globalThis.window = previousWindow; resetPersistenceForTests(); }
let stored = 0;
const { StorageManager } = await import('../app/balance/balance-storage.js'); const set = StorageManager._idbHelper.set;
try {
    StorageManager._idbHelper.set = async () => stored++;
    let abort; try { await connectLegacySnapshotFolder({ showDirectoryPicker: async () => { const error = new Error('Abbruch'); error.name = 'AbortError'; throw error; } }); } catch (error) { abort = error; }
    assert(abort?.name === 'AbortError' && stored === 0, 'Legacy-Ordnerabbruch erhält gespeicherten Handle');
    await connectLegacySnapshotFolder({ showDirectoryPicker: async () => ({ requestPermission: async () => 'granted' }) });
    assertEqual(stored, 1, 'Legacy-Ordnerverbindung benutzt bestehenden Handledienst');
} finally { StorageManager._idbHelper.set = set; }

// Echte delegierte Einzelpunktlöschung mit echter Deckungsentscheidung.
for (const exchangeText of ['', 'Vorhandene Austauschmeldung']) {
    for (const mode of ['protected', 'success', 'cancel', 'navigation', 'changed', 'delete-error', 'readback-error', 'retained', 'probelauf']) {
        const live = createMusterHaushaltRecords('2026-09-01');
        const profileId = live.rs_current_profile;
        const archive = new Map(['old', 'cover', 'permanent'].map((id, index) => [id, buildSnapshot({
            id, activeProfileId: profileId, records: live,
            createdAt: `2001-01-0${index + 1}T12:00:00Z`,
            kind: id === 'permanent' ? 'annual-close-pre-mutation' : 'manual'
        })]));
        let deletes = 0, refreshes = 0, dialogs = 0, navigationTask;
        resetPersistenceForTests({ name: 'single-point-delete', loadAll: async () => ({ ...live }),
            saveBatch: async () => { throw new Error('Unerwarteter Fachwrite'); },
            readSnapshot: async id => archive.get(id),
            listSnapshots: async () => {
                if (mode === 'readback-error' && deletes) throw new Error('SYNTHETIC_READBACK_FAILED');
                return [...archive.values()];
            },
            deleteSnapshot: async id => {
                deletes++;
                if (mode === 'delete-error') throw new Error('SYNTHETIC_DELETE_FAILED');
                if (mode !== 'retained') archive.delete(id);
            }
        });
        await p.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const originalLive = JSON.stringify(live);
        const beforeArchive = JSON.stringify([...archive]);
        const ui = createPresentationTestDocument();
        const guard = createNavigationGuard({ decide: async () => true });
        const element = ui.createElement.bind(ui);
        ui.contains = () => true;
        ui.createElement = tag => {
            const node = element(tag); node.dataset = {};
            node.focus = () => { ui.activeElement = node; };
            node.removeEventListener = type => node.events.delete(type);
            node.closest = selector => {
                for (let item = node; item; item = item.parentNode) {
                    if (selector === 'li' && item.tagName === 'li'
                        || selector === '[data-delete-point]' && item.dataset?.deletePoint
                        || selector === '[data-restore-preview]' && item.dataset?.restorePreview) return item;
                }
                return null;
            };
            node.close = () => { node.open = false; };
            node.showModal = () => {
                node.open = true; dialogs++;
                const descendants = item => [item, ...item.children.flatMap(descendants)];
                queueMicrotask(() => {
                    if (mode === 'navigation') { navigationTask = guard.prepare(); return; }
                    if (mode === 'changed') archive.set('cover', buildSnapshot({ ...archive.get('cover'), label: 'Geändert im Dialog' }));
                    const key = mode === 'cancel' ? 'pageDialogCancel' : 'pageDialogAccept';
                    descendants(node).find(item => item.dataset?.[key] === '').click();
                });
            };
            return node;
        };
        const html = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
        for (const id of [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])) {
            const node = ui.createElement('div'); node.id = id; ui.body.appendChild(node);
        }
        const refresh = async () => {
            refreshes++;
            assert(ui.getElementById('dataRestoreStatus').textContent !== 'Punkt entfernt.', 'Vor dem Listenrefresh wird kein Erfolg behauptet');
            renderDataPage(ui, await projectDataModel({ records: live, snapshots: await SnapshotArchive.listSnapshots() }));
        };
        await refresh(); refreshes = 0;
        const list = ui.getElementById('dataSnapshotList'), handlers = [];
        list.addEventListener = (type, handler) => { if (type === 'click') handlers.push(handler); };
        bindDataRestoration(ui, { guard });
        const controller = bindDataExchange(ui, { win: {}, guard, refresh });
        const status = ui.getElementById('dataRestoreStatus'), technical = ui.getElementById('dataRestoreTechnical');
        const exchange = ui.getElementById('dataExchangeStatus'), exchangeTechnical = ui.getElementById('dataExchangeTechnical');
        exchange.textContent = exchangeText; exchangeTechnical.textContent = exchangeText ? 'Vorhandene Austauschdetails' : '';
        status.textContent = 'Alte Fehlermeldung'; status.dataset.kind = 'error'; technical.textContent = 'ALTER_TECHNISCHER_FEHLER';
        const retention = await previewSnapshotRetention();
        assertEqual(retention.remove.map(point => point.id).join(','), 'old', 'Echter Dienst entfernt nur den historischen, gleichumfangig abgedeckten Punkt');
        if (mode === 'probelauf') live.rs_probelauf_state_v1 = '{}';
        const id = mode === 'protected' ? 'permanent' : 'old';
        const descendants = node => [node, ...node.children.flatMap(descendants)];
        const button = descendants(list).find(node => node.dataset?.deletePoint === id);
        assert(button && !button.closest('[data-restore-preview]'), 'Löschknopf wird nicht als Vorschauknopf verwechselt');
        const nestedTarget = ui.createElement('span'); button.appendChild(nestedTarget);
        for (const handler of handlers) await handler({ target: nestedTarget });
        for (let i = 0; i < 1000 && controller.busy; i++) await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        assert(!controller.busy, mode + ': Löschoperation beendet');
        if (navigationTask) { const attempt = await navigationTask; assert(attempt, 'Navigation beendet die vorbereitete Löschoperation'); guard.end(attempt); }
        assertEqual(exchange.textContent, exchangeText, mode + ': Austauschmeldung bleibt unverändert');
        assertEqual(exchangeTechnical.textContent, exchangeText ? 'Vorhandene Austauschdetails' : '', mode + ': Austauschdetails bleiben unverändert');
        assert(!status.textContent.includes('Austausch') && !technical.textContent.includes('Austausch'), mode + ': Löschrückmeldung beschreibt keinen Austausch');
        assert(ui.getElementById('dataRestorePreview').hidden, mode + ': delegierter Löschklick öffnet keine Restorevorschau');
        if (mode === 'success') {
            assertEqual(status.textContent, 'Punkt entfernt.', 'Erfolg steht nach Readback und Listenrefresh in der Wiederherstellungskarte');
            assertEqual(status.dataset.kind, 'ok', 'Bestätigter Einzeldelete hat Statusart ok');
            assertEqual(technical.textContent, '', 'Einzeldelete entfernt technische Altmeldung');
            assertEqual(deletes, 1, 'Bestätigung löscht genau einen Punkt');
            assertEqual(refreshes, 1, 'Erfolg aktualisiert die Liste genau einmal');
            assert(!archive.has('old') && archive.has('cover') && archive.has('permanent'), 'Deckungs- und Dauerpunkt bleiben erhalten');
            assert(!descendants(list).some(node => node.dataset?.deletePoint === 'old'), 'Gelöschter Punkt fehlt in aktualisierter Liste');
        } else {
            assertEqual(status.dataset.kind, 'error', mode + ': kein Erfolgsstatus');
            assert(status.textContent !== 'Punkt entfernt.', mode + ': kein vorgezogener Erfolg');
            assertEqual(refreshes, 0, mode + ': kein erfolgreicher Listenrefresh');
            if (mode === 'protected') {
                assertEqual(status.textContent, 'Dieser Punkt ist dauerhaft oder noch nicht abgedeckt und bleibt erhalten.', 'Dauerpunkt erhält die präzise Schutzmeldung');
                assert(technical.textContent.includes('Recovery'), 'Schutzursache steht in Restoredetails');
                assertEqual(dialogs, 0, 'Dauerpunkt bietet keinen Löschdialog');
            }
            if (['cancel', 'navigation'].includes(mode)) assertEqual(status.textContent, 'Punktlöschen abgebrochen.', mode + ': zutreffende Abbruchmeldung');
            if (mode === 'changed') {
                assertEqual(status.textContent, 'Das Archiv hat sich geändert. Bitte erneut prüfen.', 'Archivänderung fordert eine neue Prüfung');
                assert(archive.has('old'), 'Archivänderung erhält den ausgewählten Punkt');
            }
            if (mode === 'probelauf') assertEqual(status.textContent, 'Beende bitte zuerst den Probelauf.', 'Probelaufsperre bleibt handlungsfähig');
            if (mode === 'delete-error') assert(technical.textContent.includes('SYNTHETIC_DELETE_FAILED'), 'Deletefehler steht in Restoredetails');
            if (mode === 'readback-error') assert(technical.textContent.includes('SYNTHETIC_READBACK_FAILED'), 'Readbackfehler steht in Restoredetails');
            if (mode === 'retained') assert(technical.textContent.includes('nicht bestätigt'), 'Unbestätigtes Delete meldet fehlenden Readback');
            if (['delete-error', 'readback-error', 'retained'].includes(mode)) {
                assertEqual(deletes, 1, mode + ': nur ein Deleteversuch');
                assert(!/SYNTHETIC_|ALTER_TECHNISCHER/.test(status.textContent), mode + ': Hauptmeldung bleibt fachlich');
            } else assertEqual(deletes, 0, mode + ': schreibfreier Abbruch/Schutz');
            if (['protected', 'cancel', 'navigation', 'delete-error', 'retained', 'probelauf'].includes(mode)) assertEqual(JSON.stringify([...archive]), beforeArchive, mode + ': Archiv bleibt bytegleich');
        }
        if (mode === 'probelauf') delete live.rs_probelauf_state_v1;
        assertEqual(JSON.stringify(live), originalLive, mode + ': fachliche Livewerte bleiben bytegleich');
        resetPersistenceForTests();
    }
}
