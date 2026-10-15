import { annualCloseArchiveReader } from '../app/shared/annual-close-evidence.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import fs from 'node:fs';
import path from 'node:path';
import { createAnnualMonthSession } from '../app/shared/annual-close-session.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { createAnnualMarketDataReaders, prepareAnnualMarketData } from '../app/shared/annual-marketdata.js';
import { bindOverviewAnnualClose, getOverviewAnnualClose } from '../app/overview/overview-annual-close.js';
import { projectOverviewFromRecords } from '../app/overview/overview-main.js';
import { projectOverviewWithAnnualArchive } from '../app/overview/overview-model.js';
import { renderOverviewFocus } from '../app/overview/overview-renderer.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { annualServiceFixture, readyAnnualFixture, annualTestNow, annualTestMarketData, installAnnualLocks, installBalanceStorageForm } from './helpers/balance-storage-fixtures.mjs';
import { UIBinder, initUIBinder, preserveUIBinderStateForTests } from '../app/balance/balance-binder.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { EngineAPI } from '../engine/index.mjs';
import { planScope, HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { ANNUAL_PLAN_RECORD_KEY, annualPlanEntryKey, assertAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { appNow, getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { SYNTHETIC_MARKET_SOURCE } from '../app/shared/probelauf-prices.js';
import { dialogElements } from '../app/shared/close-dialog.js';

export async function annualUntil(predicate) {
    for (let turn = 0; turn < 400; turn++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
    throw new Error('Jahresbinder erreicht erwartete Phase nicht.');
}
export async function overviewAnnualFixture({ sample = readyAnnualFixture(), coordinatorOptions = {}, faults = {}, monthFactory, readers: suppliedReaders, archived = false, now = annualTestNow } = {}) {
    const env = await annualServiceFixture({ sample, faults });
    const { doc } = createDialogFixture(); const win = { document: doc, location: { reload() {} }, sessionStorage: new Map() };
    win.sessionStorage = { getItem: key => win.session.get(key) ?? null, setItem: (key, value) => win.session.set(key, value), removeItem: key => win.session.delete(key) }; win.session = new Map();
    doc.defaultView = win; globalThis.document = doc; globalThis.window = win;
    for (const id of ['overviewFocus', 'overviewAnnualStatus', 'overviewAnnualLog']) { const node = doc.createElement('div'); node.id = id; doc.body.append(node); }
    let model, controls, monthSaveCalls = 0;
    const refresh = () => {
        const options = { registry: JSON.parse(env.storage.getItem('rs_profiles_v1')), activeId: env.storage.getItem('rs_current_profile'),
            liveData: env.persistence.exportAllSync().records, now: now() };
        model = archived ? projectOverviewWithAnnualArchive(options, { onChange: refresh }) : projectOverviewFromRecords(options);
        if (archived) renderOverviewFocus(doc, model);
        controls?.syncButtons();
    };
    refresh();
    const readers = suppliedReaders || { prepareInflation: async () => structuredClone(annualTestMarketData.inflation), prepareETF: async () => structuredClone(annualTestMarketData.etf), prepareCape: async () => structuredClone(annualTestMarketData.cape) };
    controls = bindOverviewAnnualClose({ doc, win, getModel: () => model, refresh, now, readers,
        operationLock: env.options.operationLock, engineLoader: env.options.engineLoader,
        coordinatorOptions: { ...env.options, now, clock: Date.now, ...coordinatorOptions }, createMonthSession: async options => {
            const session = await (monthFactory || createAnnualMonthSession)(options), save = session.save;
            session.save = function (...args) { monthSaveCalls++; return save.apply(this, args); };
            return session;
        } });
    return { ...env, doc, win, controls, refresh, get model() { return model; },
        get monthSaveCalls() { return monthSaveCalls; },
        open() {
            const button = doc.createElement('button'); button.dataset.overviewAnnual = ''; doc.getElementById('overviewFocus').append(button);
            // Delegierter echter Klick und direkt aufrufbarer Binder verwenden dieselbe start-Methode.
            return controls.start({ opener: button });
        }, close: () => controls.dispose() };
}

export function markerlessAnnualFixture() {
    const sample = readyAnnualFixture(), registry = JSON.parse(sample.records.rs_profiles_v1);
    const strip = data => {
        const state = JSON.parse(data[CONFIG.STORAGE.LS_KEY]);
        for (const key of ['annualPeriodMetadata', 'annualMarketDataMeta', 'ageAdjustedForInflation', 'needsAdjustedForInflationYear', 'lastInflationAppliedAtYear']) delete state[key];
        delete state.lastState.lastInflationAppliedAtAge; state.lastState.cumulativeInflationFactor = 1;
        state.wealthHistory = { schemaVersion: 1, entries: [] };
        data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); delete data[ANNUAL_PLAN_RECORD_KEY];
    };
    strip(sample.records); Object.values(registry.profiles).forEach(profile => strip(profile.data));
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    return sample;
}

/** Dieselbe echte Fehlergrenze und Archivevidenz für die beiden Seitenbinder. */
export async function verifySamePageAnnualArchive(destination) {
    const saved = { create: SnapshotArchive.createSnapshot, read: SnapshotArchive.readSnapshot,
        render: UIRenderer.renderContext, error: UIRenderer.handleActionError, clear: UIRenderer.clearActionError,
        toast: UIRenderer.toast, doc: globalThis.document, win: globalThis.window, date: getAppTestDate() };
    const restoreBinder = preserveUIBinderStateForTests(), restoreLocks = installAnnualLocks();
    try {
        setAppTestDate('2027-01-02');
        UIRenderer.handleActionError = () => {}; UIRenderer.clearActionError = () => {}; UIRenderer.toast = () => {};
        for (const name of ['AbortError', 'Error']) {
            const sample = markerlessAnnualFixture(), failure = new Error('SYNTHETIC_AFTER_CONFIRMED_ANNUAL_SNAPSHOT'); failure.name = name;
            let confirmed = false, payloadReads = 0, snapshotCalls = 0;
            const f = await overviewAnnualFixture({ sample, archived: true });
            await annualUntil(() => f.model.occasion.annualState === 'open');
            const original = JSON.stringify(await f.persistence.readPersistedRecords());
            SnapshotArchive.createSnapshot = async (...args) => {
                snapshotCalls++;
                const point = await saved.create(...args), readback = await saved.read(point.id);
                assertEqual(JSON.stringify(readback), JSON.stringify(point), destination + ': echter Vorabpunkt bytegleich zurückgelesen');
                confirmed = true; throw failure;
            };
            SnapshotArchive.readSnapshot = async (...args) => {
                const point = await saved.read(...args);
                if (confirmed) { payloadReads++; assertEqual(point.kind, 'annual-close-pre-mutation', 'Nachlesung liest gespeicherte Jahrespayload'); }
                return point;
            };
            let start = () => f.open(), binding, renderer, outputs;
            if (destination === 'balance') {
                f.win.EngineAPI = EngineAPI;
                const dom = installBalanceStorageForm(JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, sample.values);
                dom.controls = { jahresabschlussBtn: f.doc.createElement('button'), btnJahresUpdate: f.doc.createElement('button'), btnJahresUpdateLog: f.doc.createElement('button') };
                dom.expenses = { yearSelect: { value: '2026' } }; dom.containers = {}; dom.outputs = {};
                initUIBinder(dom, { inputs: {} }, () => ({ ok: true }), () => {});
                binding = preserveUIBinderStateForTests().handlers;
                outputs = Object.fromEntries(['balanceNextAnnualLabel', 'balanceActionPeriod', 'balanceActionFootnote', 'balanceNextAnnual'].map(id => [id, f.doc.createElement('button')]));
                Object.values(outputs).forEach(node => f.doc.body.append(node));
                renderer = new SummaryRenderer({ outputs, controls: dom.controls });
                UIRenderer.renderContext = () => renderer.renderContext();
                start = () => UIBinder.handleJahresabschluss();
            }
            try {
                const closing = start();
                await prepareCloseFixture(f.doc);
                await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
                assertEqual((await start()).status, 'in_flight', 'Paralleler Einstieg beginnt keinen weiteren Versuch');
                await f.doc.getElementById('annualConfirmBtn').fire('click');
                const result = await closing;
                assertEqual(result.status, name === 'AbortError' ? 'cancelled' : 'invalid', destination + ': ursprünglicher Fehlerstatus bleibt erhalten');
                assert(result.error === failure, 'Nachlesung erhält dieselbe ursprüngliche Ausnahme');
                assert(confirmed && payloadReads > 0, 'Beendeter Versuch liest den gerade bestätigten Punkt durch den gemeinsamen Reader');
                assertEqual(snapshotCalls, 1, 'Nur ein Jahresversuch und eine Archivierung');
                assertEqual(f.snapshots.size, 1, 'Ein bestätigter Jahresvorabpunkt, kein Monatsbeleg');
                assertEqual(f.batches.length, 0, 'Vor Metadatenstart kein Jahresfachbatch');
                assertEqual(JSON.stringify(await f.persistence.readPersistedRecords()), original, 'Archivierung erhält sämtliche Finanzbytes');
                const state = JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY));
                assert(!state.annualPeriodMetadata && !f.storage.getItem(ANNUAL_PLAN_RECORD_KEY), 'Vorabpunkt bestätigt keine Jahresperiode');
                assertEqual(state.lastState.cumulativeInflationFactor, 1, 'Vorabpunkt verändert keine Inflation');
                assertEqual((binding?.getAnnualModel() || f.model).occasion.annualState, 'open', 'Quellgleicher Vorabstand bleibt offen');

                const registry = JSON.parse(f.storage.getItem('rs_profiles_v1')), lots = JSON.parse(f.storage.getItem('depot_tranchen'));
                lots[0].currentPrice += 1; const raw = JSON.stringify(lots);
                registry.profiles[f.model.activeId].data.depot_tranchen = raw;
                await f.persistence.replaceRecordsTransactional({ depot_tranchen: raw, rs_profiles_v1: JSON.stringify(registry) },
                    { allowKey: key => ['depot_tranchen', 'rs_profiles_v1'].includes(key) });
                const evidence = async () => JSON.stringify({ records: await f.persistence.readPersistedRecords(), batches: f.batches, snapshots: [...f.snapshots] });
                const afterQuote = await evidence(), readsBefore = payloadReads, nodesBefore = f.doc.querySelectorAll('dialog').length;
                f.refresh(); renderer?.renderContext();
                assertEqual((binding?.getAnnualModel() || f.model).occasion.annualState, 'unclear', destination + ': reines Rendern erkennt späteren Kurswrite');
                if (outputs) {
                    assertEqual(outputs.balanceNextAnnualLabel.textContent, 'Jahresstatus klären', 'Echter Summaryrenderer bietet Klärung an');
                    assertEqual(outputs.balanceActionPeriod.textContent, 'Vorläufige Vorschau · Jahresabschluss 2026', 'Heutige Aktion bleibt trotz ungeklärter Periode eine Vorschau für den anstehenden Abschluss');
                    assert(outputs.balanceNextAnnualLabel.isConnected && !outputs.balanceNextAnnual.disabled, 'Klärung sichtbar und erreichbar');
                } else {
                    const host = f.doc.getElementById('overviewFocus');
                    assert(host.isConnected && !host.hidden && /<button[^>]*data-overview-annual>Jahresstatus klären<\/button>/.test(host.innerHTML), 'Produktiver Startseitenrenderer zeigt den Klärungsknopf');
                }
                assertEqual(await evidence(), afterQuote, 'Reines Rendern erhält bestätigte Finanzbytes, Batches und Snapshotzahl');
                assertEqual(payloadReads, readsBefore, 'Kein eigener Readerrefresh nach dem Versuch und keine Refreshschleife');
                assertEqual(f.doc.querySelectorAll('dialog').length, nodesBefore, 'Rendern öffnet keinen weiteren Dialog');
                assertEqual(f.doc.querySelectorAll('[data-page-dialog-host]').length, 0, 'Kein Klärungspopup vor einem weiteren Jahresklick');
                assertEqual(snapshotCalls, 1, 'Kein zweiter Jahresversuch nach Folgewrite');
            } finally {
                await f.doc.getElementById('annualCloseBtn')?.fire('click');
                binding?.closeCoordinator.dispose(); f.close();
                SnapshotArchive.createSnapshot = saved.create; SnapshotArchive.readSnapshot = saved.read;
            }
        }
    } finally {
        restoreBinder(); restoreLocks(); setAppTestDate(saved.date);
        SnapshotArchive.createSnapshot = saved.create; SnapshotArchive.readSnapshot = saved.read;
        UIRenderer.renderContext = saved.render; UIRenderer.handleActionError = saved.error;
        UIRenderer.clearActionError = saved.clear; UIRenderer.toast = saved.toast;
        globalThis.document = saved.doc; globalThis.window = saved.win;
    }
}

export async function verifyAnnualFinalReadGuards(destination) {
    const saved = { list: SnapshotArchive.listSnapshots, refresh: annualCloseArchiveReader.refresh,
        render: UIRenderer.renderContext, doc: globalThis.document, win: globalThis.window, date: getAppTestDate() };
    const restoreBinder = preserveUIBinderStateForTests(), restoreLocks = installAnnualLocks();
    try {
        for (const change of ['resume', ...(destination === 'balance' ? ['exception'] : []), 'error', 'profile', 'scope', 'year']) {
            setAppTestDate('2027-01-02');
            const sample = markerlessAnnualFixture(), f = await overviewAnnualFixture({ sample, archived: true, now: appNow });
            // Die Fixture startet mit aktueller, leerer Archivevidenz.
            await saved.refresh.call(annualCloseArchiveReader, { targetYear: 2026, activeId: sample.records.rs_current_profile, scope: sample.scope });
            f.refresh();
            await SnapshotArchive.createSnapshot({ id: 'guard-before', kind: 'annual-close-pre-mutation', createdAt: annualTestNow().toISOString(),
                activeProfileId: sample.records.rs_current_profile,
                records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(sample.records), getItem: key => sample.records[key] }) });
            let finishing = false, entered = false, release, held = new Promise(resolve => { release = resolve; });
            const answers = [];
            SnapshotArchive.listSnapshots = async (...args) => {
                const points = await saved.list(...args);
                if (finishing && !entered) { entered = true; await held; if (change === 'error') throw new Error('SYNTHETIC_FINAL_ARCHIVE_READ_FAILED'); }
                return points;
            };
            annualCloseArchiveReader.refresh = async function (context) {
                const answer = await saved.refresh.call(this, context); answers.push(answer); return answer;
            };
            let binding, renderer, start = options => options ? f.controls.start(options) : f.open();
            if (destination === 'balance') {
                f.win.EngineAPI = EngineAPI;
                const dom = installBalanceStorageForm(JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, sample.values);
                dom.controls = {}; dom.containers = {}; dom.outputs = {};
                initUIBinder(dom, { inputs: {} }, () => ({ ok: true }), () => {});
                binding = preserveUIBinderStateForTests().handlers;
                renderer = new SummaryRenderer({ outputs: {}, controls: {} });
                UIRenderer.renderContext = () => renderer.renderContext();
                start = options => UIBinder.handleJahresabschluss(options);
            }
            try {
                const exception = new Error('SYNTHETIC_PREPARATION_EXCEPTION');
                if (change === 'exception') binding.closeCoordinator.prepare = async () => { finishing = true; throw exception; };
                if (change === 'resume') finishing = true;
                const closing = start(change === 'resume' ? { resume: { profileId: 'invalid', targetYear: 2026 } } : undefined)
                    .catch(error => { assert(error === exception, 'Nachlesung erhält die ursprüngliche geworfene Binderausnahme'); return { status: 'thrown' }; });
                if (!['resume', 'exception'].includes(change)) {
                    await annualUntil(() => f.doc.getElementById('annualCloseBtn'));
                    finishing = true;
                    await f.doc.getElementById('annualCloseBtn').fire('click');
                }
                await annualUntil(() => entered);
                assertEqual((await start()).status, 'in_flight', destination + ': Nachlesung hält Parallelitätsschutz bis zum Ende');
                if (change === 'profile') await f.persistence.replaceRecordsTransactional({ rs_current_profile: 'muster_b', rs_active_profile: 'muster_b' },
                    { allowKey: key => ['rs_current_profile', 'rs_active_profile'].includes(key) });
                if (change === 'scope') {
                    const registry = JSON.parse(f.storage.getItem('rs_profiles_v1'));
                    registry.profiles.muster_b.meta.belongsToHousehold = false;
                    await f.persistence.replaceRecordsTransactional({ rs_profiles_v1: JSON.stringify(registry) }, { allowKey: key => key === 'rs_profiles_v1' });
                }
                if (change === 'year') setAppTestDate('2028-01-02');
                // Nur der aktuelle produktive Renderanschluss bindet den neuen Kontext.
                if (['profile', 'scope', 'year'].includes(change)) {
                    f.refresh(); renderer?.renderContext();
                    const next = binding?.getAnnualModel() || f.model;
                    assert(next.occasion.annualState !== 'open' && next.occasion.annualState !== 'done', change + ': ausstehender neuer Kontext gibt nicht aus alten Payloads frei');
                }
                const before = JSON.stringify({ records: await f.persistence.readPersistedRecords(), batches: f.batches, snapshots: [...f.snapshots] });
                release();
                assertEqual((await closing).status, change === 'exception' ? 'thrown' : 'cancelled', destination + ': abschließende Lesung ersetzt Abbruch oder Ausnahme nicht');
                if (change === 'error') {
                    assert(answers.some(answer => answer.status === 'error' && answer.error === 'SYNTHETIC_FINAL_ARCHIVE_READ_FAILED'), 'Readerfehler bleibt als fehlgeschlagene Evidenz sichtbar');
                    assertEqual((binding?.getAnnualModel() || f.model).occasion.annualState, 'unclear', 'Readerfehler gibt den markerlosen Stand nicht offen frei');
                } else if (['profile', 'scope', 'year'].includes(change)) {
                    assert(answers.some(answer => answer.status === 'stale' && answer.context.activeId === sample.records.rs_current_profile && answer.context.targetYear === 2026), change + ': verspätete Antwort wird verworfen');
                    const next = binding?.getAnnualModel() || f.model;
                    const archive = annualCloseArchiveReader.read({ targetYear: appNow().getFullYear() - 1, activeId: next.activeId, scope: next.scope });
                    assert(archive.status === 'loaded' && answers.some(answer => answer.status === 'loaded'
                        && JSON.stringify(answer.context) === JSON.stringify(archive.context)), 'Anzeige verwendet ausschließlich die bestätigte Lesung des neuen Kontexts');
                } else {
                    assert(answers.some(answer => answer.status === 'loaded'), change + ': früher Endpfad umgeht die gemeinsame Nachlesung nicht');
                }
                assertEqual(JSON.stringify({ records: await f.persistence.readPersistedRecords(), batches: f.batches, snapshots: [...f.snapshots] }), before, 'Abschlusslesung erhält Records, Batches und Archiv nach ausdrücklichem Kontextwechsel');
                assertEqual(f.doc.querySelectorAll('[data-page-dialog-host]').length, 0, 'Nachlesung öffnet keine Klärung');
                assert(!f.doc.getElementById('balanceAnnualClose')?.open && !getPageNavigationGuard(f.doc, f.win).isBusy(), 'Vorbereitung und Navigationsbesitzer sind aufgeräumt');
            } finally {
                release(); binding?.closeCoordinator.dispose(); f.close();
                SnapshotArchive.listSnapshots = saved.list; annualCloseArchiveReader.refresh = saved.refresh;
                UIRenderer.renderContext = saved.render;
            }
        }
    } finally {
        restoreBinder(); restoreLocks(); setAppTestDate(saved.date);
        SnapshotArchive.listSnapshots = saved.list; annualCloseArchiveReader.refresh = saved.refresh;
        UIRenderer.renderContext = saved.render; globalThis.document = saved.doc; globalThis.window = saved.win;
    }
}

if (!new URL(import.meta.url).searchParams.has('fixture')) {
// Tatsächlicher Startseitenimportgraph, einschließlich normalem Monatsbinder.
const visited = new Set(), forbidden = [];
function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?:import\s+(?:[^;]*?\s+from\s*)?|export\s+[^;]*?\s+from\s*)['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), match[1]);
        if (/\/(?:engine\/index\.mjs|engine\.js|balance-main\.js)$/.test(target)) forbidden.push(target);
        else visit(target);
    }
}
visit(path.resolve('app/overview/overview-main.js'));
assertEqual(forbidden.join(','), '', 'Tatsächliche Startseite und Monatsbinder importieren keine Engine oder versteckte Balanceinitialisierung');
assert(visited.has(path.resolve('app/shared/annual-close-dialog.js')), 'Importprüfung erfasst auch den gemeinsamen Jahresrenderer');
const old = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate(), toast: UIRenderer.toast }, restoreLocks = installAnnualLocks();
const restoreBinder = preserveUIBinderStateForTests();
const storageEvidence = async f => JSON.stringify({ records: await f.persistence.readPersistedRecords(),
    batches: f.batches, snapshots: [...f.snapshots], monthSaveCalls: f.monthSaveCalls });
const visible = node => {
    if (!node?.isConnected) return false;
    for (let parent = node; parent; parent = parent.parent) if (parent.hidden) return false;
    return true;
};
const dialogStatus = root => root.querySelectorAll('.close-dialog-status').find(node => node.getAttribute('role') === 'status').textContent;
const checkAction = (root, receipt) => {
    const section = root.querySelector('[data-annual-action-result]');
    assert(visible(section), 'Beschlossene Handlung steht in eigenem sichtbarem Element');
    const texts = dialogElements(section).map(node => node.textContent);
    assert(texts.includes(`Handlungsanweisung ${receipt.year} · festgeschrieben`), 'Handlung nennt das bestätigte Planjahr');
    assert(texts.some(text => text.includes(receipt.adopted.action.type === 'NONE' ? 'Nichts tun – kein Handlungsbedarf' : receipt.adopted.action.title === 'Profilverbund-Transaktionen' ? 'Vorgeschlagene Verkäufe nach Person' : receipt.adopted.action.title)), 'Handlung enthält den Titel aus dem persistierten adopted-Beleg');
    for (let node = section; node; node = node.parent) {
        assert(!node.className?.includes('ds-note-error') && node.getAttribute('role') !== 'alert', 'Handlung wird nicht als Fehler gekennzeichnet');
    }
};
try {
    UIRenderer.toast = () => {};
    setAppTestDate('2027-01-02');

    await verifySamePageAnnualArchive('overview');
    await verifyAnnualFinalReadGuards('overview');

    // Reale Seitenbinder klären auch einen absichtlich veralteten offenen Anzeigestand.
    for (const destination of ['overview', 'balance']) for (const stale of [false, true]) for (const decision of ['cancel', 'not_committed']) {
        const sample = readyAnnualFixture(), registry = JSON.parse(sample.records.rs_profiles_v1);
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
        const f = await overviewAnnualFixture({ sample });
        const context = { targetYear: 2026, activeId: sample.records.rs_current_profile, scope: sample.scope };
        await annualCloseArchiveReader.refresh(context);
        assertEqual(f.model.occasion.annualState, 'open', destination + ': absichtlich alter offener Anzeigestand');
        const point = SnapshotArchive.buildSnapshot({ id: 'isolated-before', kind: 'annual-close-pre-mutation',
            createdAt: annualTestNow().toISOString(), activeProfileId: context.activeId,
            records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(sample.records), getItem: key => sample.records[key] }) });
        f.snapshots.set(point.id, point);
        const lots = JSON.parse(sample.records.depot_tranchen); lots[0].currentPrice += 1;
        registry.profiles[context.activeId].data.depot_tranchen = JSON.stringify(lots);
        await f.persistence.replaceRecordsTransactional({ depot_tranchen: JSON.stringify(lots), rs_profiles_v1: JSON.stringify(registry) }, { allowKey: key => ['depot_tranchen', 'rs_profiles_v1'].includes(key) });
        if (!stale) await annualCloseArchiveReader.refresh(context);
        let start = () => f.open(), binding;
        if (destination === 'balance') {
            f.win.EngineAPI = EngineAPI;
            const dom = installBalanceStorageForm(JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, sample.values);
            dom.controls = { jahresabschlussBtn: f.doc.createElement('button'), btnJahresUpdate: f.doc.createElement('button'), btnJahresUpdateLog: f.doc.createElement('button') };
            dom.expenses = { yearSelect: { value: '2026' } }; dom.containers = {}; dom.outputs = {};
            initUIBinder(dom, {}, () => ({ ok: true }), () => {});
            binding = preserveUIBinderStateForTests().handlers;
            start = () => UIBinder.handleJahresabschluss();
            if (!stale) {
                const outputs = Object.fromEntries(['balanceNextAnnualLabel', 'balanceActionPeriod', 'balanceActionFootnote', 'balanceNextAnnual'].map(id => [id, f.doc.createElement('button')]));
                new SummaryRenderer({ outputs, controls: dom.controls }).renderContext();
                assertEqual(outputs.balanceNextAnnualLabel.textContent, 'Jahresstatus klären', 'Summary bietet Jahresklärung vor Nutzeraktion');
                assert(outputs.balanceActionPeriod.textContent.startsWith('Vorläufige Vorschau'), 'Balance trennt die vorläufige Aktion vom Jahresstatus');
                assert(!outputs.balanceNextAnnual.disabled, 'Balanceklärung bleibt erreichbar');
                assertEqual(binding.getAnnualModel().occasion.annualState, 'unclear', 'Summary und Bindermodell stimmen überein');
            }
        }
        const before = await storageEvidence(f);
        assertEqual(f.doc.querySelectorAll('[data-page-dialog-host]').length, 0, 'Archivlesen und Binden öffnen kein Popup');
        const closing = start();
        await annualUntil(() => f.doc.getElementById('pageDialogInput'));
        assertEqual(await storageEvidence(f), before, destination + ': vor Klärungsantwort keine Vorbereitung oder Übernahme');
        if (decision === 'cancel') {
            await f.doc.querySelector('[data-page-dialog-cancel]').fire('click');
            assertEqual((await closing).status, 'cancelled', destination + ': Klärungsabbruch beendet echten Binder');
            assertEqual(await storageEvidence(f), before, destination + ': Abbruch erhält Finanzbytes, Archiv und Batches');
            assert(!f.doc.getElementById('balanceAnnualClose')?.open, 'Abbruch öffnet keine Vorbereitung');
        } else {
            f.doc.getElementById('pageDialogInput').value = 'not_committed';
            await f.doc.querySelector('[data-page-dialog-accept]').fire('click');
            await prepareCloseFixture(f.doc);
            await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
            assertEqual(f.doc.querySelectorAll('[data-page-dialog-host]').length, 0, destination + ': Offenklärung führt direkt in normale Vorbereitung');
            const metadata = JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY)).annualPeriodMetadata;
            assertEqual(metadata.lastCommittedPeriod, null, 'Offenentscheidung ist kein Jahreserfolg');
            if (destination === 'overview') {
                await f.doc.getElementById('annualConfirmBtn').fire('click');
                assertEqual((await closing).status, 'already_committed', 'Startseitenabschluss folgt ohne zweite Klärungsfrage');
                assertEqual(f.model.occasion.annualState, 'done', 'Abschließende Archivlesung erhält bestätigten Jahresstatus');
                assertEqual(f.snapshots.size, 3, 'Isolierter Punkt plus einmaliger Jahres- und Monatsbeleg');
                assertEqual(f.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, 'Genau ein fachlicher Jahreswrite nach Offenklärung');
                assertEqual(f.doc.querySelectorAll('[data-page-dialog-host]').length, 0, 'Coordinatorabschluss wiederholt die Klärung nicht');
                const receipt = Object.values(JSON.parse(f.storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
                checkAction(f.doc.getElementById('balanceAnnualClose'), receipt);
                assertEqual(f.doc.querySelector('[data-annual-combined-result]').children[1], f.doc.querySelector('[data-annual-action-result]'), 'Startseite zeigt Handlung bereits im ersten Ergebnis direkt nach Alles gespeichert');
                await f.doc.getElementById('annualCloseBtn').fire('click');
            } else {
                await f.doc.getElementById('annualConfirmBtn').fire('click');
                assertEqual((await closing).status, 'already_committed', 'Balanceabschluss folgt ohne zweite Klärungsfrage');
                assertEqual(binding.getAnnualModel().occasion.annualState, 'done', 'Balance behält nach Nachlesung den bestätigten Jahresstatus');
                assertEqual(f.snapshots.size, 3, 'Balance erhält isolierten Punkt plus Jahres- und Monatsbeleg');
                assertEqual(f.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, 'Balance schreibt genau einen fachlichen Jahresbatch');
                assertEqual(f.doc.querySelectorAll('[data-page-dialog-host]').length, 0, 'Balanceabschluss wiederholt die Offenklärung nicht');
                assertEqual(JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY)).lastState.cumulativeInflationFactor, 1.025, 'Balance wendet Jahresinflation nach Offenklärung genau einmal an');
                const receipt = Object.values(JSON.parse(f.storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
                checkAction(f.doc.getElementById('balanceAnnualClose'), receipt);
                assertEqual(f.doc.querySelector('[data-annual-combined-result]').children[1], f.doc.querySelector('[data-annual-action-result]'), 'Balance zeigt dieselbe belegte Handlung bereits im ersten Ergebnis');
                await f.doc.getElementById('annualCloseBtn').fire('click');
            }
        }
        binding?.closeCoordinator.dispose(); f.close();
    }
    // Zwei echte Datumsmodelle: Die sichtbare Phasengrenze entsteht vor jedem Write.
    for (const [date, month, monthIndex] of [['2027-01-02', 'Januar', 0], ['2027-02-02', 'Februar', 1]]) {
        const previousDate = getAppTestDate(); setAppTestDate(date);
        const f = await overviewAnnualFixture();
        const before = await storageEvidence(f);
        const project = now => projectOverviewFromRecords({ registry: JSON.parse(f.storage.getItem('rs_profiles_v1')),
            activeId: f.storage.getItem('rs_current_profile'), liveData: f.persistence.exportAllSync().records, now });
        let model = project(new Date(`${date}T12:00:00+01:00`)), binding, preparation;
        const dialog = createAnnualCloseDialog({ document: f.doc, getModel: () => model });
        const checkMonth = expected => {
            const root = binding.root;
            assertEqual(root.querySelectorAll('[data-close-dialog-step]').length, 6, `${date}: sechs Jahresschritte`);
            assert(!root.querySelector('[data-close-dialog-group]') && !root.querySelector('[data-close-dialog-step="month"]'), `${date}: keine alte Phasengliederung`);
            assert(!root.querySelector('#annualMonthStepConfirm') && !root.dataset.annualYearResult, `${date}: Anzeige bestätigt weder Jahr noch Monat`);
        };
        try {
            assertEqual(model.now.getMonth(), monthIndex, `${date}: Modell enthält tatsächlich den Testmonat`);
            assertEqual(model.occasion.closingYear, 2026, `${date}: Zieljahr bleibt 2026`);
            assertEqual(model.occasion.annualState, 'open', `${date}: Jahresbestand ist noch offen`);
            const people = captureCashPeople({ storage: f.storage, ids: model.scope.ids, activeId: model.activeId });
            preparation = dialog.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
            checkMonth(month);
            assertEqual(await storageEvidence(f), before, `${date}: Öffnen bleibt vollständig schreibfrei`);
            const readers = Object.fromEntries(['Inflation', 'ETF', 'Cape'].map(label => [`prepare${label}`, async () => structuredClone(annualTestMarketData[label.toLowerCase()])]));
            const packet = await prepareAnnualMarketData({ targetYear: 2026, readers, now: () => model.now });
            binding.updateMarketData({ values: packet.marketData, errors: {} });
            checkMonth(month);
            assertEqual(await storageEvidence(f), before, `${date}: Marktdatenabrufe erhalten Rohrecords, Batches, Snapshots und Monatswritezählung`);
            assert(binding.hasVisited('prices') && !binding.hasVisited('market') && !binding.hasVisited('preview'), 'Asynchrone Vorbereitung zählt keine verborgenen Besuche');
            const confirm = f.doc.getElementById('annualConfirmBtn');
            assert(confirm.disabled, 'Gültige Jahresvorbelegung und fertige Marktdaten bleiben gesperrt');
            for (const id of ['expenses', 'budget', 'cash', 'market', 'preview']) binding.activate(id);
            assert(confirm.disabled && !binding.firstUnvisited(), 'Sechs Besuche ohne Tagesgeldbestätigung reichen nicht aus');
            binding.activate('cash');
            const fields = binding.root.querySelectorAll('[data-tagesgeld-person]');
            await binding.root.querySelectorAll('[data-tagesgeld-confirm]')[0].fire('click'); assert(confirm.disabled, 'Erste Jahresbestätigung gilt nur für die betreffende Person');
            await binding.root.querySelectorAll('[data-tagesgeld-confirm]')[1].fire('click');
            assert(!confirm.disabled && !binding.hasVisited('month'), 'Sechs Besuche plus Stand stimmt geben den Jahresknopf ohne Ergebnisbesuch frei');
            assertEqual(await storageEvidence(f), before, 'Jahresbesuche und persönliche Bestätigung bleiben schreibfrei');
            // Ein anderer Modellmonat deckt eine nur einmalige Beschriftung auf.
            model = project(new Date(`2027-${monthIndex === 0 ? '02' : '01'}-02T12:00:00+01:00`));
            binding.update(model); checkMonth(monthIndex === 0 ? 'Februar' : 'Januar');
            model = project(new Date(`${date}T12:00:00+01:00`)); binding.update(model); checkMonth(month);
            assertEqual(await storageEvidence(f), before, `${date}: Modellrefresh bleibt vollständig schreibfrei`);
            await binding.requestClose();
            assertEqual(await preparation, null, `${date}: Schließen verwirft die Vorbereitung`);
            assertEqual(await storageEvidence(f), before, `${date}: Schließen erhält die vollständige Speicherevidenz bytegleich`);
        } finally {
            await binding?.requestClose(); await preparation; f.close(); setAppTestDate(previousDate);
        }
    }
    // Der echte Dialog muss auch die Vorfahren des bewusst geöffneten Editors erhalten.
    for (const matching of [true, false, 'active']) {
        const sample = readyAnnualFixture();
        const original = JSON.parse(sample.records[HOUSEHOLD_PLAN_KEY]).entries[sample.scope.key].values;
        const values = { ...original, ...dynamicFlexPresetPatch('ausgewogen'),
            dynamicFlex: matching === 'active', goGoMultiplier: matching === false ? 1.17 : 1.1 };
        sample.records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(sample.records[HOUSEHOLD_PLAN_KEY], [{ scope: sample.scope, values }]).raw;
        const f = await overviewAnnualFixture({ sample }), before = await storageEvidence(f), gates = [];
        let binding;
        const dialog = createAnnualCloseDialog({ document: f.doc, getModel: () => f.model,
            evaluatePlan: options => {
                const evaluate = () => evaluateAnnualPlanPreview({ ...options, storage: f.storage,
                    engineLoader: f.options.engineLoader, now: annualTestNow });
                if (!options.adoptedPlanPatch) return evaluate();
                let release;
                const done = new Promise(resolve => { release = resolve; }).then(evaluate);
                gates.push({ patch: options.adoptedPlanPatch, release, done }); return done;
            } });
        const people = captureCashPeople({ storage: f.storage, ids: f.model.scope.ids, activeId: f.model.activeId });
        let preparation = dialog.showAnnualPreparation({ targetYear: 2026, model: f.model, people,
            confirmDiscard: async () => true, onReady: handle => { binding = handle; } });
        try {
            binding.updateMarketData({ values: structuredClone(annualTestMarketData), errors: {} });
            const root = binding.root, confirm = f.doc.getElementById('annualConfirmBtn');
            await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            await root.querySelector('[data-close-dialog-activate="preview"]').fire('click');
            await root.querySelector('[data-annual-plan-toggle]').fire('click');
            const editor = root.querySelector('[data-annual-plan-editor]');
            const custom = editor.querySelector('[data-plan-dynamic-preset="custom"]');
            const details = editor.querySelector('[data-plan-dynamic-details]');
            const minimum = f.doc.getElementById('annualPlan_minimumFlexAnnual');
            const detailTexts = () => editor.querySelectorAll('[data-annual-plan-field]')
                .filter(field => field.dataset.annualPlanField !== 'dynamicFlex')
                .map(field => [field.dataset.annualPlanField, field.value, field.checked]);
            const beforeTexts = JSON.stringify(detailTexts());
            minimum.focus(); await minimum.fire('focus');
            custom.focus(); await minimum.fire('blur', { relatedTarget: custom });
            await custom.fire('click');
            const check = label => {
                assertEqual(custom.getAttribute('aria-pressed'), 'true', label + ': Custom bleibt markiert');
                assert(f.doc.getElementById('annualPlan_dynamicFlex').checked, label + ': Dynamik aktiv');
                assert(!details.hidden, label + ': Detailcontainer offen');
                assert(visible(details), label + ': alle Vorfahren im gemeinsamen Jahresdialog sichtbar');
            };
            check('Unmittelbar nach Customklick und Fokuswechsel');
            assert(f.doc.activeElement === custom, 'Customklick erhält den nativen Knopffokus');
            assertEqual(JSON.stringify(detailTexts()), beforeTexts, 'Customaktivierung erhält sämtliche übrigen Feldtexte und Checkboxen');
            if (matching !== 'active') {
                assert(confirm.disabled && gates.length === 1, 'Aktivierung wartet auf genau eine Vorschau');
                assertEqual(JSON.stringify(gates[0].patch), JSON.stringify({ dynamicFlex: true }), 'Aus → Custom erzeugt allein den Aktivierungspatch');
                check('Während verzögerter Aktivierungsvorschau');
                gates.shift().release(); await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            } else assertEqual(gates.length, 0, 'Aktive Customöffnung startet keine Rechnung');
            check('Nach aktueller Vorschau');
            binding.updateMarketData({ values: structuredClone(annualTestMarketData), errors: {} });
            await annualUntil(() => gates.length === (matching === 'active' ? 0 : 1)
                && editor.querySelector('[data-annual-plan-status]').textContent === (matching === 'active' ? 'Dein Plan ist gültig.' : 'Dein Plan wird berechnet …'));
            if (gates.length) { gates.shift().release(); await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled); }
            assert(root.querySelector('[data-annual-plan-editor]') === editor, 'Basisprojektion erhält dieselbe Editorinstanz');
            check('Nach erneuter Basisprojektion im selben Dialog');
            minimum.focus(); await minimum.fire('focus');
            // Ein echtes focus-Ereignis selektiert im Zahlenbinder den gesamten Text.
            // Die einfache DOM-Fixture tut dies bei focus() nicht automatisch.
            const nativeFocus = minimum.focus;
            minimum.select = () => { minimum.selectionStart = 0; minimum.selectionEnd = minimum.value.length; };
            minimum.focus = function (...args) { nativeFocus.apply(this, args); void minimum.fire('focus'); };
            minimum.value = String(values.minimumFlexAnnual + 100);
            minimum.selectionStart = minimum.selectionEnd = minimum.value.length;
            await minimum.fire('input');
            const older = gates.shift();
            check('Nach Feldeingabe während neuer Rechnung');
            assert(f.doc.activeElement === minimum, 'Schrittprojektion erhält den Fokus im gültigen Customfeld');
            assertEqual(minimum.selectionStart, minimum.value.length, 'Schrittprojektion erhält die native Schreibposition statt den Text neu auszuwählen');
            minimum.value = String(values.minimumFlexAnnual + 200); await minimum.fire('input');
            const latest = gates.shift();
            assert(confirm.disabled, 'Neue Feldrevision sperrt die Bestätigung');
            latest.release(); await latest.done; await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            const currentResult = editor.querySelectorAll('[data-annual-adopted]').map(cell => cell.textContent).join('|');
            older.release(); await older.done; await Promise.resolve();
            check('Nach älterer verspäteter Vorschauantwort');
            assertEqual(editor.querySelectorAll('[data-annual-adopted]').map(cell => cell.textContent).join('|'), currentResult, 'Ältere Antwort ersetzt nicht das aktuelle Ergebnis');
            assertEqual(minimum.value, String(values.minimumFlexAnnual + 200), 'Ältere Antwort erhält den aktuellen Feldtext');
            assert(f.doc.activeElement === minimum && !confirm.disabled, 'Aktuelle Antwort und Altantwort erhalten Fokus und gültige Bestätigung');
            // Die DOM-Fixture hat keinen nativen blur; der Schrittkopf bildet hier
            // lediglich dessen Rückkehr zum Body nach, ohne Fachlogik zu ersetzen.
            const previewStep = root.querySelector('[data-close-dialog-activate="preview"]');
            previewStep.blur = () => { f.doc.activeElement = f.doc.body; };
            f.doc.activeElement = f.doc.body;
            binding.updateMarketData({ values: structuredClone(annualTestMarketData), errors: {} });
            assert(f.doc.activeElement === f.doc.body, 'Hintergrundprojektion stiehlt keinen Body-Fokus');
            check('Während Hintergrundprojektion ohne Feldfokus');
            await annualUntil(() => gates.length === 1);
            gates.shift().release(); await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            assert(f.doc.activeElement === f.doc.body, 'Hintergrundantwort stiehlt keinen Body-Fokus');
            minimum.focus(); await minimum.fire('focus');
            // Eine ausdrücklich gewählte andere Ansicht darf keine Antwort zurückholen.
            minimum.value = String(values.minimumFlexAnnual + 300); await minimum.fire('input');
            const away = gates.shift();
            await root.querySelector('[data-close-dialog-activate="market"]').fire('click');
            away.release(); await away.done; await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            assertEqual(root.querySelector('[data-close-dialog-activate="preview"]').getAttribute('aria-expanded'), 'false', 'Antwort respektiert den bewussten Schrittwechsel');
            await root.querySelector('[data-close-dialog-activate="preview"]').fire('click');
            check('Nach erneutem Anzeigen des Anpassungspanels');
            assertEqual(await storageEvidence(f), before, 'Custom und sämtliche Vorschauen erhalten Plan-, Beleg- und Snapshotbytes');
            await root.querySelector('[data-annual-plan-discard]').fire('click');
            await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            assert(details.hidden, 'Verwerfen löst die lokale Customabsicht auf presetgleicher Basis');
            await custom.fire('click');
            if (gates.length) { gates.shift().release(); await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled); }
            check('Erneute Customwahl vor Dialogabbruch');
            await binding.requestClose();
            assertEqual(await preparation, null, 'Abbruch übernimmt keinen Jahresentwurf');
            assertEqual(await storageEvidence(f), before, 'Abbruch erhält Plan-, Beleg- und Snapshotbytes');
            preparation = dialog.showAnnualPreparation({ targetYear: 2026, model: f.model, people,
                confirmDiscard: async () => true, onReady: handle => { binding = handle; } });
            binding.updateMarketData({ values: structuredClone(annualTestMarketData), errors: {} });
            await prepareCloseFixture(globalThis.document); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
            await binding.root.querySelector('[data-close-dialog-activate="preview"]').fire('click');
            await binding.root.querySelector('[data-annual-plan-toggle]').fire('click');
            assert(binding.root !== root, 'Neuer Dialog besitzt eine neue Instanz');
            assert(binding.root.querySelector('[data-plan-dynamic-details]').hidden, 'Neuer Dialog übernimmt keine lokale Customabsicht');
            assertEqual(binding.root.querySelector('[data-plan-dynamic-preset="' + (matching === 'active' ? 'ausgewogen' : 'off') + '"]').getAttribute('aria-pressed'), 'true', 'Neuer Dialog erkennt allein gespeicherte Fachwerte');
        } finally {
            await binding?.requestClose(); await preparation; f.close();
        }
    }
    // Feldfehler bleiben auch ohne dokumentweite ID-Auflösung beim Neuberechnen erhalten.
    {
        const f = await overviewAnnualFixture();
        const before = await storageEvidence(f), lookup = f.doc.getElementById;
        f.doc.getElementById = id => /^annualTagesgeld-\d+-error$/.test(id) ? null : lookup(id);
        let binding, evaluations = 0;
        const dialog = createAnnualCloseDialog({ document: f.doc, getModel: () => f.model,
            evaluatePlan: options => {
                evaluations++;
                return evaluateAnnualPlanPreview({ ...options, storage: f.storage,
                    engineLoader: f.options.engineLoader, now: annualTestNow });
            } });
        const people = captureCashPeople({ storage: f.storage, ids: f.model.scope.ids, activeId: f.model.activeId });
        const preparation = dialog.showAnnualPreparation({ targetYear: 2026, model: f.model, people,
            confirmDiscard: async () => true, onReady: handle => { binding = handle; } });
        try {
            const root = binding.root, inputs = root.querySelectorAll('[data-tagesgeld-person]');
            assert(root.open && inputs.length > 0, 'Jahresdialog mit Tagesgeldpersonen öffnet ohne dokumentweiten Fehlerzugriff');
            binding.updateMarketData({ values: structuredClone(annualTestMarketData), errors: {} });
            const confirm = f.doc.getElementById('annualConfirmBtn');
            await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
            assert(evaluations >= 2, 'Vollständige Marktdaten durchlaufen die echte Planneuberechnung und Feldprüfung ohne Wurf');
            await root.querySelector('[data-close-dialog-activate="cash"]').fire('click');
            for (const input of inputs) {
                const original = input.value, error = root.querySelector(`#${input.id}-error`);
                assertEqual(f.doc.getElementById(error.id), null, 'Host löst Tagesgeldfehler absichtlich nicht über das Dokument auf');
                input.value = '-1'; await input.fire('input');
                binding.updateMarketData({ values: structuredClone(annualTestMarketData), errors: {} });
                await annualUntil(() => root.querySelector('[data-annual-plan-status]').textContent === 'Dein Plan ist gültig.');
                assertEqual(input.getAttribute('aria-invalid'), 'true', 'Ungültiges Tagesgeld bleibt nach Marktdatenupdate als ungültig markiert');
                assert(error.textContent && visible(error), 'Konkreter Tagesgeldfehler bleibt nach der Neuberechnung sichtbar');
                assert(confirm.disabled, 'Ungültiges Tagesgeld sperrt den Jahresknopf trotz vollständiger Marktdaten und gültigem Plan');
                input.value = original; await input.fire('input');
                await prepareCloseFixture(globalThis.document); await annualUntil(() => !confirm.disabled);
                assertEqual(input.getAttribute('aria-invalid'), 'false', 'Korrigiertes Tagesgeld entfernt die Ungültigmarkierung');
                assertEqual(error.textContent, '', 'Korrigiertes Tagesgeld leert denselben Feldfehler');
                assert(!confirm.disabled, 'Gültiges Tagesgeld aller Personen gibt den Jahresknopf frei');
            }
            assertEqual(await storageEvidence(f), before, 'Feldprüfung und wiederholte Planneuberechnung bleiben schreibfrei');
        } finally {
            await binding?.requestClose(); await preparation;
            f.doc.getElementById = lookup; f.close();
        }
    }
    // Pflichtdaten werden im echten gemeinsamen Dialog vorbereitet, ohne Records zu ändern.
    for (const manual of [false, true]) {
        const calls = { inflation: 0, etf: 0, cape: 0 };
        const readers = Object.fromEntries(['Inflation', 'ETF', 'Cape'].map(label => {
            const type = label.toLowerCase();
            return [`prepare${label}`, async () => { calls[type]++; if (manual && calls[type] === 1) throw new Error('Abruf fehlt'); return structuredClone(annualTestMarketData[type]); }];
        }));
        const f = await overviewAnnualFixture({ readers, coordinatorOptions: { prepareMarketData: options => prepareAnnualMarketData({ ...options, readers, now: annualTestNow }) } });
        const before = await storageEvidence(f), closing = f.open();
        await annualUntil(() => f.doc.getElementById('annualHandCape') && calls.cape === 1);
        const root = f.doc.getElementById('balanceAnnualClose');
        const row = id => root.querySelector(`[data-close-dialog-step="${id}"]`);
        const cash = root.querySelectorAll('[data-tagesgeld-person]');
        const readiness = root.querySelector('[data-close-dialog-status]');
        assertEqual(readiness.textContent, 'Noch offen: Ausgaben Dezember', 'Jahresfuß nennt den Schrittnamen ohne angehängtes Verb');
        for (const id of ['expenses', 'budget']) await row(id).children[0].fire('click');
        assertEqual(readiness.textContent, 'Noch offen: Tagesgeld am 31.12.2026', 'Jahresendstand bekommt kein zusätzliches Verb');
        await row('cash').children[0].fire('click');
        assertEqual(row('cash').dataset.state, 'current', 'Vorbelegte Tagesgeldentwürfe bleiben unbestätigt');
        assertEqual(readiness.textContent, 'Noch offen: Marktdaten automatisch holen', 'Marktdatenhinweis ergänzt kein zweites Verb');
        await row('market').children[0].fire('click');
        assertEqual(readiness.textContent, 'Noch offen: Plan 2027 prüfen', 'Planprüfung bekommt kein zusätzliches ansehen');
        await row('preview').children[0].fire('click');
        assertEqual(readiness.textContent, `Noch offen: Tagesgeld ${f.model.members.map(person => person.name).join(', ')} bestätigen oder ändern`, 'Nach allen Besuchen bleiben die unbestätigten Personen im Jahresfuß offen');
        await prepareCloseFixture(f.doc);
        await row('cash').children[0].fire('click');
        assert(dialogElements(row('cash')).some(node => node.textContent.includes('erst mit dem Jahresabschluss gespeichert')), 'Eingetragen ist kein Speicherbeleg');
        assert(cash.length >= 2, 'Pflichtprüfung umfasst mehrere Haushaltspersonen');
        for (const input of cash) {
            const original = input.value; input.value = '-1'; await input.fire('input');
            assert(input.getAttribute('aria-invalid') === 'true' && f.doc.getElementById('annualConfirmBtn').disabled, 'Ungültiges Tagesgeld jeder Person sperrt den Jahresknopf');
            assertEqual(row('cash').dataset.state, 'current', 'Ungültiger Tagesgeldentwurf bleibt offen');
            assert(readiness.textContent.includes('Tagesgeld von '), 'Bereitschaft nennt die konkrete fehlende Person');
            input.value = original; await input.fire('input');
        }
        if (manual) {
            await annualUntil(() => root.querySelector('#annualMarketRetryBtn')?.hidden === false);
            f.doc.getElementById('annualHandInflation').value = '51'; await f.doc.getElementById('annualHandInflation').fire('input');
            assert(f.doc.getElementById('annualConfirmBtn').disabled && f.doc.getElementById('annualHandInflation').getAttribute('aria-invalid') === 'true', 'Unplausible Inflation bleibt gesperrt');
            for (const [id, value] of [['annualHandInflation', '0'], ['annualHandPrice', '160.4'], ['annualHandCape', '30']]) {
                f.doc.getElementById(id).value = value; await f.doc.getElementById(id).fire('input');
            }
            await root.querySelector('#annualMarketRetryBtn').fire('click');
            for (const [id, value] of [['annualHandInflation', '0'], ['annualHandPrice', '160.4'], ['annualHandCape', '30']]) {
                assertEqual(f.doc.getElementById(id).value, value, 'Später erfolgreicher Abruf erhält den bereits eingetragenen Handwert');
            }
        }
        await prepareCloseFixture(globalThis.document); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
        assertEqual(JSON.stringify(calls), JSON.stringify({ inflation: manual ? 2 : 1, etf: manual ? 2 : 1, cape: manual ? 2 : 1 }), 'Öffnen und ausdrücklicher Retry bereiten jeweils die bestehenden drei Abrufe vor');
        if (!manual) for (const id of ['annualHandInflation', 'annualHandPrice', 'annualHandCape']) {
            const input = f.doc.getElementById(id);
            assert(input.disabled && input.parent.hidden, 'Erfolgreicher automatischer Pflichtwert bietet keine Handersetzung an');
        }
        assertEqual(row('market').dataset.state, 'done', 'Vollständige automatische oder manuelle Marktdaten sind bereit');
        assert(!manual || dialogElements(row('market')).some(node => node.textContent.includes('Manuelle Ergänzung')), 'Handwerte zeigen ihre Herkunft');
        await row('preview').children[0].fire('click');
        assert(!root.querySelector('[data-close-dialog-next="preview"]'), 'Letzter Jahresschritt ohne Weiter');
        assertEqual(await storageEvidence(f), before, 'Eingaben, Abrufe und Weiter erhalten sämtliche Speicherbytes und Snapshots');
        if (manual) {
            await f.doc.getElementById('annualConfirmBtn').fire('click'); assertEqual((await closing).status, 'already_committed', 'Vollständige Handergänzung schließt über den bisherigen Jahresdienst ab');
            const records = await f.persistence.readPersistedRecords();
            const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
            assertEqual(state.capeMeta.capeRatio, 30, 'Jahreswrite übernimmt den manuellen CAPE der Vorschau');
            assertEqual(state.annualMarketDataMeta.source, 'Manueller Schlusskurs', 'Jahreswrite übernimmt denselben manuellen ETF-Schlusskurs');
            const receipt = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
            assertEqual(f.model.summary.monthlyWithdrawal, receipt.adopted.monthlyWithdrawal, 'Handergänzung und Abschluss haben dieselbe Berechnungsbasis');
        } else { root.close(); await closing; }
        f.close();
    }
    // Die produktiven Vorableser im Spielbereich bleiben synthetisch und schreibfrei.
    {
        const fetchBefore = globalThis.fetch; let networkCalls = 0;
        globalThis.fetch = () => { networkCalls++; throw new Error('Kein Netz im Spielbereich'); };
        const f = await overviewAnnualFixture({ readers: createAnnualMarketDataReaders({ now: annualTestNow }) });
        try {
            const before = await storageEvidence(f), closing = f.open();
            await prepareCloseFixture(globalThis.document); await annualUntil(() => f.doc.getElementById('annualConfirmBtn')?.disabled === false);
            const root = f.doc.getElementById('balanceAnnualClose');
            const market = root.querySelector('[data-close-dialog-step="market"]');
            assertEqual(market.dataset.state, 'done', 'Synthetische Vorableser erledigen den Marktdatenschritt');
            assertEqual(market.querySelectorAll('.close-dialog-tile').length, 3, 'Alle drei vorbereiteten Jahreswerte stehen in Kacheln');
            assert(market.querySelector('[data-annual-market-provenance]').textContent.includes(SYNTHETIC_MARKET_SOURCE.replace(' · ', ', ')),
                'Gemeinsame Herkunft weist alle vorbereiteten Jahreswerte als synthetisch aus');
            assertEqual(networkCalls, 0, 'Produktive Jahresvorbereitung startet im Spielbereich keinen Netzzugriff');
            assertEqual(await storageEvidence(f), before, 'Synthetische Vorbereitung verändert keine Finanzrecords oder Snapshots');
            root.close(); await closing;
        } finally { f.close(); globalThis.fetch = fetchBefore; }
    }
    for (const action of ['cancel', 'discard', 'adjust', 'unchanged']) {
        const f = await overviewAnnualFixture({ archived: true }); const before = JSON.stringify(await f.persistence.readPersistedRecords()), cache = JSON.stringify(f.persistence.exportAllSync().records);
        const closing = f.open();
        await prepareCloseFixture(globalThis.document); await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
        const root = f.doc.getElementById('balanceAnnualClose');
        assert(root.open, action + ': Startseite öffnet den gemeinsamen Dialog');
        assert(!root.querySelector('[data-close-dialog-step="month"]'), 'Vor dem Write genau sechs Vorbereitungen');
        assertEqual(JSON.stringify(await f.persistence.readPersistedRecords()), before, 'Vorbereitung schreibt keine Finanzrecords');
        await root.querySelector('[data-annual-plan-toggle]').fire('click');
        const field = f.doc.getElementById('annualPlan_floorBedarf'); field.value = '21000'; const changing = field.fire('input');
        assert(f.doc.getElementById('annualConfirmBtn').disabled, 'Eingabe sperrt Bestätigung bis zur aktuellen Berechnung'); await changing;
        await prepareCloseFixture(globalThis.document); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
        const invalid = f.doc.getElementById('annualPlan_minimumFlexAnnual');
        await invalid.fire('focus'); // Eingabefokus zeigt die ungerundete Rechenbasis (FR-14).
        const originalMinimum = invalid.value; invalid.value = '999999'; await invalid.fire('input');
        await annualUntil(() => root.querySelector('[data-annual-plan-status]').textContent.includes('Mindest-Flex'));
        assert(f.doc.getElementById('annualConfirmBtn').disabled, 'Ungültige Planwerte sperren sichtbar');
        invalid.value = originalMinimum; await invalid.fire('input'); await prepareCloseFixture(globalThis.document); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
        if (action !== 'adjust') {
            await root.querySelector('[data-annual-plan-discard]').fire('click'); await prepareCloseFixture(globalThis.document); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
            assert(field.value !== '21000', 'Verwerfen stellt den ursprünglichen Planwert wieder her');
        }
        if (action === 'cancel') {
            await root.fire('keydown', { key: 'Escape' }); assertEqual((await closing).status, 'cancelled', 'Escape bricht vor Jahreswrite ab');
            assertEqual(JSON.stringify(await f.persistence.readPersistedRecords()), before, 'Abbruch erhält sämtliche Backendbytes');
            assertEqual(JSON.stringify(f.persistence.exportAllSync().records), cache, 'Abbruch erhält sämtliche Cachebytes');
            assert(!f.doc.getElementById('overviewAnnualStatus').textContent.includes('wurde bereits abgeschlossen'), 'Vorbereitungsabbruch zeigt keinen Abschlussinfohinweis');
        } else {
            await f.doc.getElementById('annualConfirmBtn').fire('click');
            const result = await closing;
            assert(root.querySelector('[data-annual-combined-result="C"]'), 'Ein Hauptklick zeigt den bestätigten Jahres- und Monatsbeleg');
            const backup = root.querySelector('[data-overview-backup]');
            f.doc.dispatchEvent(new Event('overview-backup-changed'));
            assert(!visible(backup), 'Vorab-Sicherung bleibt nach Jahreswrite und Backupereignis ausgeblendet');
            assertEqual(result.status, 'already_committed', 'Startseite bestätigt echtes Jahr');
            assertEqual(f.model.occasion.annualState, 'done', 'Produktive Archivprojektion bleibt nach Erfolg abgeschlossen');
            assert(!f.doc.getElementById('overviewAnnualStatus').textContent.includes('wurde bereits abgeschlossen'), 'Neuer Erfolg mit results erzeugt keinen Doppelhinweis');
            const records = await f.persistence.readPersistedRecords(), receipt = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
            checkAction(root, receipt);
            assertEqual(receipt.adjusted, action === 'adjust', 'Anpassungsbeleg nur bei tatsächlich geändertem Plan');
            assertEqual(JSON.stringify(receipt.adjustedFields), JSON.stringify(action === 'adjust' ? ['floorBedarf'] : []), 'Exakte Änderungspfade');
            const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
            assertEqual(state.annualPeriodMetadata.pendingCommit, null, 'Jahresmarker finalisiert');
            assertEqual(f.model.summary.monthlyWithdrawal, receipt.adopted.monthlyWithdrawal, 'Festgeschriebene Anzeige aus adopted');
            assertEqual(f.doc.getElementById('annualConfirmBtn').textContent, 'Fertig', 'Nach automatischem Monatsteil bleibt nur Fertig');
            assertEqual(f.snapshots.size, 2, 'Jahr und Monat besitzen nach dem Hauptklick getrennte Belege');
            const beforeAction = await storageEvidence(f);
            f.controls.showAction();
            checkAction(root, receipt);
            assertEqual(await storageEvidence(f), beforeAction, 'Handlungsöffnung vor Januar erhält Backend, Batches, Snapshots und Saveanzahl');
            if (action === 'unchanged') {
                await f.doc.getElementById('annualCloseBtn').fire('click');
                assertEqual(f.model.occasion.kind, 'play', 'Schließen nach dem Hauptklick lässt keinen Dezember offen');
                await f.doc.getElementById('overviewAnnualLog').fire('click');
                assertEqual(f.doc.getElementById('balanceAnnualClose').querySelectorAll('[data-tagesgeld-person]').length, 0,
                    'Monatsretry nach Wiederöffnung fragt Cash nicht nochmals ab');
            }
            const resultRoot = f.doc.getElementById('balanceAnnualClose');
            assert(resultRoot.querySelector('[data-annual-combined-result="C"]'), 'Ergebnis C auf der Startseite');
            assertEqual(f.snapshots.size, 2, 'Getrennte Jahres-/Monatsbelege');
            assertEqual(f.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, 'Genau ein fachlicher Jahreswrite');
            const finalized = JSON.stringify(await f.persistence.readPersistedRecords());
            const completed = await storageEvidence(f);
            const actionRoot = resultRoot;
            checkAction(actionRoot, receipt);
            assert(!f.doc.getElementById('annualShowAction'), 'Kein separater Handlungsanweisungsknopf');
            assertEqual(await storageEvidence(f), completed, 'Unmittelbare Handlung erhält Backend, Batches, Snapshots und Saveanzahl');
            assertEqual(f.monthSaveCalls, 1, 'Genau eine erfolgreiche Monatsbereitstellung');
            await f.doc.getElementById('annualConfirmBtn').fire('click');
            assert(!actionRoot.open, 'Fertig schließt die bestätigte Handlungsanzeige');
            assertEqual(JSON.stringify(await f.persistence.readPersistedRecords()), finalized, 'Fertig schreibt nicht nochmals');
            await f.doc.getElementById('overviewAnnualLog').fire('click');
            assert(dialogElements(f.doc.getElementById('annualResults')).some(node => node.textContent === 'Protokoll'), 'Startseitenprotokoll nach Schließen wieder erreichbar');
            await f.doc.getElementById('annualConfirmBtn').fire('click');
            assertEqual(await storageEvidence(f), completed, 'Auch Schließen und Protokoll erhalten vollständigen Backend- und Snapshotbestand');
            assertEqual(getOverviewAnnualClose({}), undefined, 'Zugriff auf ungebundenes Dokument erzeugt keinen Binder');
            const pageControls = getOverviewAnnualClose(f.doc);
            assert(pageControls === f.controls, 'Zugriff liefert exakt den bereits mit Seitenabhängigkeiten gebundenen Binder');
            const repeated = await pageControls.start();
            assertEqual(repeated.status, 'already_committed', 'Erneuter Start erreicht echten Koordinatorstatus');
            assertEqual(f.doc.getElementById('overviewAnnualStatus').textContent, 'Die Jahresperiode 2026 wurde bereits abgeschlossen.', 'Startseitenbinder nennt exakt das Jahr aus periodId, nicht das Planjahr 2027');
            assert(!f.doc.getElementById('balanceAnnualClose')?.open, 'Erneuter Start öffnet keinen Jahresdialog');
            assertEqual(await storageEvidence(f), completed, 'Erneuter Start erhält Backend, Batches, Snapshots und Saveanzahl');

        }
        f.close();
    }
    // Monatsfehler dürfen den bestätigten Jahresbatch nicht wiederholen.
    {
        let fail = true;
        const f = await overviewAnnualFixture({ faults: { write: async batch => {
            if (fail && batch.upserts.some(([key]) => key === 'overview_month_provision_v1')) { fail = false; throw new Error('Monatswrite fehlgeschlagen'); }
        } } });
        const closing = f.open(); await prepareCloseFixture(globalThis.document); await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
        await f.doc.getElementById('annualConfirmBtn').fire('click'); await closing;
        const year = f.storage.getItem(CONFIG.STORAGE.LS_KEY), record = f.storage.getItem(ANNUAL_PLAN_RECORD_KEY);
        assert(f.doc.getElementById('annualConfirmBtn').textContent.includes('Erneut versuchen'), 'Monatsfehler bietet ausschließlich Monatsretry');
        assertEqual(f.storage.getItem(CONFIG.STORAGE.LS_KEY), year, 'Monatsfehler erhält abgeschlossenen Jahresstand');
        assertEqual(f.storage.getItem(ANNUAL_PLAN_RECORD_KEY), record, 'Monatsfehler erhält Jahresbeleg bytegleich');
        const failed = await storageEvidence(f);
        const failedStatus = dialogStatus(f.doc.getElementById('balanceAnnualClose'));
        f.controls.showAction();
        const failureRoot = f.doc.getElementById('balanceAnnualClose');
        checkAction(failureRoot, Object.values(JSON.parse(record).entries)[0]);
        assert(dialogElements(failureRoot).some(node => node.textContent.includes('Der Dezember-Abschluss konnte nicht gespeichert werden.')), 'Fehlgeschlagener Monatswrite bestätigt keinen Monat');
        assertEqual(dialogStatus(failureRoot), failedStatus, 'Handlungsöffnung erhält den bisherigen Monatsfehlertext');
        assert(f.doc.getElementById('annualConfirmBtn').textContent.includes('Erneut versuchen'), 'Handlungsöffnung erhält den ausdrücklichen Monatsretry');
        assert(!failureRoot.querySelector('[data-annual-action-result]').children[1].textContent.includes('Bereitstellung nicht bestätigt'), 'Monatsfehler und beschlossene Handlung bleiben getrennt');
        assertEqual(await storageEvidence(f), failed, 'Handlungsöffnung nach Monatsfehler ist vollständig schreibfrei');
        await f.doc.getElementById('annualConfirmBtn').fire('click');
        assertEqual(f.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, 'Monatsretry wiederholt den Jahreswrite nicht');
        await f.doc.getElementById('annualConfirmBtn').fire('click'); f.close();
    }
    // Wiederöffnung darf einen erforderlichen Monatsrestore nicht zum Retry herabstufen.
    {
        const f = await overviewAnnualFixture({ monthFactory: options => createAnnualMonthSession({ ...options, store: async () => {
            const error = new Error('Monatsrollback fehlgeschlagen'); error.code = 'rollback_failed'; throw error;
        } }) });
        const closing = f.open(); await prepareCloseFixture(globalThis.document); await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
        await f.doc.getElementById('annualConfirmBtn').fire('click'); await closing;
        await f.doc.getElementById('annualConfirmBtn').fire('click');
        const recoveryStatus = dialogStatus(f.doc.getElementById('balanceAnnualClose')), before = await storageEvidence(f);
        assert(recoveryStatus.includes('Wiederherstellung erforderlich'), 'Fehlgeschlagener Rollback fordert Wiederherstellung');
        await f.doc.getElementById('annualCloseBtn').fire('click');
        await f.doc.getElementById('overviewAnnualLog').fire('click');
        const root = f.doc.getElementById('balanceAnnualClose');
        assertEqual(dialogStatus(root), recoveryStatus, 'Wiederöffnung erhält den bestehenden Recoverytext');
        assert(f.doc.getElementById('annualConfirmBtn').disabled, 'Recovery bietet keinen Monatsretry');
        assert(visible(f.doc.getElementById('annualShowRecovery')) && f.doc.getElementById('annualShowRecovery').textContent === 'Wiederherstellungspunkte anzeigen', 'Recoveryziel bleibt nach Wiederöffnung bedienbar');
        assert(!root.querySelector('[data-annual-combined-result="C"]'), 'Recovery bestätigt keinen Monat');
        await f.doc.getElementById('annualCloseBtn').fire('click');
        assertEqual(await storageEvidence(f), before, 'Recoverywiederöffnung und Schließen erhalten alle Backendbytes und Belege'); f.close();
    }
    // Fehlender, beschädigter oder für ein anderes Jahr/einen anderen Umfang
    // bestätigter Beleg darf keine aktuelle Vorschau als Beschluss ausgeben.
    {
        const source = await overviewAnnualFixture();
        const closing = source.open(); await prepareCloseFixture(globalThis.document); await annualUntil(() => source.doc.getElementById('annualConfirmBtn') && !source.doc.getElementById('annualConfirmBtn').disabled);
        await source.doc.getElementById('annualConfirmBtn').fire('click'); await closing;
        const records = await source.persistence.readPersistedRecords();
        await source.doc.getElementById('annualCloseBtn').fire('click'); source.close();
        for (const missing of ['missing', 'invalid', 'year', 'scope']) {
            const changed = structuredClone(records);
            if (missing === 'missing') delete changed[ANNUAL_PLAN_RECORD_KEY];
            else if (missing === 'invalid') changed[ANNUAL_PLAN_RECORD_KEY] = '{';
            else {
                const record = JSON.parse(changed[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(record.entries)[0];
                if (missing === 'year') { entry.year++; entry.periodId = `calendar-year:${entry.year - 1}`; }
                else {
                    entry.scope = planScope('household', ['anderer_a', 'anderer_b']);
                    entry.adopted.snapshot.ageByPerson = { anderer_a: 66, anderer_b: 65 };
                }
                record.entries = { [annualPlanEntryKey(entry.year, entry.scope)]: entry };
                assertAnnualPlanRecord(record);
                changed[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
            }
            const f = await overviewAnnualFixture({ sample: { records: changed } }), before = await storageEvidence(f);
            f.controls.showAction();
            const root = f.doc.getElementById('balanceAnnualClose'), section = root.querySelector('[data-annual-action-result]');
            assert(root.open && visible(section), missing + ': Fehlende beschlossene Handlung wird sichtbar erklärt');
            assert(dialogElements(section).some(node => node.textContent.includes('fehlt eine bestätigte Handlungsanweisung')), missing + ': kein Rückfall auf Vorschau');
            assert(!root.querySelector('[data-annual-preview]'), missing + ': kein als Beschluss ausgegebener Vorschauplan');
            await f.doc.getElementById('annualCloseBtn').fire('click');
            assertEqual(await storageEvidence(f), before, missing + ': Backendbytes und Snapshotbestand erhalten'); f.close();
        }
    }
    // Echter Restore und neue Dokumentgeneration; beide Seitenbinder erhalten denselben Beschluss.
    for (const destination of ['overview', 'balance']) {
        const f = await overviewAnnualFixture({ archived: true, coordinatorOptions: { confirmRestore: async () => true,
            prepareMarketData: async () => ({ ok: false, results: { inflation: annualTestMarketData.inflation,
                cape: annualTestMarketData.cape, errors: [{ step: 'ETF & Nachrücken', error: 'ETF fehlt' }] }, error: new Error('ETF fehlt') }) } });
        const closing = f.open(); await prepareCloseFixture(globalThis.document); await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
        await f.doc.getElementById('balanceAnnualClose').querySelector('[data-annual-plan-toggle]').fire('click');
        const planField = f.doc.getElementById('annualPlan_floorBedarf'); planField.value = '21000'; await planField.fire('input');
        await prepareCloseFixture(globalThis.document); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
        const cashField = f.doc.getElementById('balanceAnnualClose').querySelector('[data-tagesgeld-person]');
        const personId = cashField.getAttribute('data-tagesgeld-person'), confirmedCash = 43210.75;
        cashField.value = '43.210,75'; await cashField.fire('input');
        await f.doc.getElementById('balanceAnnualClose').querySelector(`[data-tagesgeld-apply="${personId}"]`).fire('click');
        await f.doc.getElementById('annualConfirmBtn').fire('click');
        assertEqual((await closing).status, 'incomplete_recovery', 'Startseite zeigt unterbrochenes Jahresergebnis');
        assertEqual(f.model.occasion.annualState, 'recovery', 'Begonnener Teilfehler behält auch nach Archivnachlesung Recoveryvorrang');
        await f.doc.getElementById('annualCloseBtn').fire('click');
        await f.doc.getElementById('overviewAnnualLog').fire('click');
        assert(!f.doc.getElementById('annualRetryBtn').hidden, 'Fehlerprotokoll bleibt nach Schließen mit Handkursretry bedienbar');
        f.doc.getElementById('annualHandPrice').value = '161.5'; await f.doc.getElementById('annualRetryBtn').fire('click');
        const requestRaw = f.win.session.get('balance.annual-retry.once');
        assert(requestRaw, 'Echter Restore legt tabgebundenen Wiederaufnahmeauftrag ab');
        assertEqual(JSON.parse(requestRaw).adoptedPlanPatch.floorBedarf, 21000, 'Einmalauftrag erhält den bestätigten Planpatch');
        assertEqual(JSON.parse(requestRaw).cash.values[personId], confirmedCash, 'Einmalauftrag erhält die bestätigten Jahresend-Cashwerte');
        const restored = await f.persistence.readPersistedRecords(), snapshots = [...f.snapshots.values()];
        assert(Number(restored.profile_tagesgeld) !== confirmedCash, 'Restore enthält den alten Cashstand statt der bestätigten Jahresendwerte');
        await f.doc.getElementById('annualCloseBtn').fire('click'); f.close();
        const resumed = await overviewAnnualFixture({ sample: { records: restored }, coordinatorOptions: {
            prepareMarketData: options => prepareAnnualMarketData({ ...options, now: annualTestNow, readers: {
                prepareInflation: async () => annualTestMarketData.inflation, prepareCape: async () => annualTestMarketData.cape } }) } });
        for (const snapshot of snapshots) resumed.snapshots.set(snapshot.id, snapshot);
        resumed.win.session.set('balance.annual-retry.once', requestRaw); resumed.win.session.set('balance.annual-retry.once.proof', requestRaw);
        const request = resumed.controls.consumeRetry();
        assert(request && resumed.controls.consumeRetry() === null, 'Startseite konsumiert Auftrag synchron genau einmal');
        let resume = request => resumed.controls.resume(request);
        if (destination === 'balance') {
            resumed.win.EngineAPI = EngineAPI;
            const dom = installBalanceStorageForm(JSON.parse(resumed.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, readyAnnualFixture().values);
            dom.controls = { jahresabschlussBtn: resumed.doc.createElement('button'), btnJahresUpdate: resumed.doc.createElement('button'), btnJahresUpdateLog: resumed.doc.createElement('button') };
            dom.expenses = { yearSelect: { value: '2026' } }; dom.containers = {}; dom.outputs = {};
            initUIBinder(dom, {}, () => ({ ok: true }), () => {});
            resume = request => UIBinder.resumeAnnualRetry(request);
        }
        const result = await resume(request); resumed.refresh();
        assertEqual(result.status, 'already_committed', 'Neue Startseitengeneration setzt dieselbe Jahresperiode fort');
        assertEqual(result.status, 'already_committed', destination + ': tatsächlicher Seitenbinder übernimmt den Wiederaufnahmebeschluss');
        const receipt = Object.values(JSON.parse(resumed.storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
        assertEqual(receipt.adjusted, true, 'Handkurs-Wiederaufnahme erhält die bewusste Plananpassung');
        assertEqual(JSON.stringify(receipt.adjustedFields), JSON.stringify(['floorBedarf']), 'Handkurs-Wiederaufnahme erhält die exakten Änderungspfade');
        assertEqual(Number(resumed.storage.getItem('profile_tagesgeld')), confirmedCash, 'Handkurs-Wiederaufnahme speichert die bestätigten Jahresend-Cashwerte');
        assertEqual(resumed.model.summary.monthlyWithdrawal, receipt.adopted.monthlyWithdrawal, 'Wiederaufnahme zeigt den Monatsbetrag aus dem beschlossenen Plan');
        assertEqual(resumed.doc.getElementById('annualConfirmBtn').textContent, 'Fertig', 'Wiederaufnahme speichert den Monat automatisch aus bestätigtem Plan und Cash');
        assertEqual(JSON.parse(resumed.storage.getItem(CONFIG.STORAGE.LS_KEY)).annualMarketDataMeta.source, 'Manueller Schlusskurs', 'Wiederaufnahme verwendet eingegebenen Handkurs');
        assertEqual((await resume(request)).status, 'cancelled', 'Verbrauchter Auftrag startet keinen zweiten Jahreswrite');
        await resumed.doc.getElementById('annualCloseBtn').fire('click');
        if (destination === 'balance') preserveUIBinderStateForTests().handlers.closeCoordinator.dispose();
        resumed.close();
    }
} finally { restoreBinder(); restoreLocks(); UIRenderer.toast = old.toast; globalThis.document = old.doc; globalThis.window = old.win; setAppTestDate(old.date); PersistenceFacade.resetPersistenceRuntimeForTests(); }
}
