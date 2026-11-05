import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createAnnualNavigationLifecycle } from '../app/balance/balance-annual-orchestrator.js';
import { createBalanceWealthHistoryService, createManualWealthHistoryController } from '../app/balance/balance-wealth-history.js';
import { PersistenceFacade, persistenceStorage, resetPersistenceForTests, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';
import { storeOverviewSummary, overviewScope } from '../app/overview/overview-storage.js';

const STATE = CONFIG.STORAGE.LS_KEY, REGISTRY = PROFILE_STORAGE_KEYS.registry;
const result = { ok: true, inputData: { tagesgeld: 100, geldmarktEtf: 200, depotwertAlt: 300, depotwertNeu: 400 } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function until(predicate) {
    for (let turn = 0; turn < 200; turn++) { if (predicate()) return; await Promise.resolve(); }
    throw new Error('Kontrollierte Verlaufsbarriere nicht erreicht.');
}
async function fixture(stage, { fail = false } = {}) {
    const state = { annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null },
        wealthHistory: { schemaVersion: 1, entries: [] } };
    const records = new Map(Object.entries({ [STATE]: JSON.stringify(state),
        [PROFILE_STORAGE_KEYS.current]: 'a', [PROFILE_STORAGE_KEYS.active]: 'a',
        [REGISTRY]: JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a', name: 'Test' }, data: { [STATE]: JSON.stringify(state) } } } }) }));
    const before = records.get(STATE), gate = deferred(), entered = deferred();
    let held = false, written = false, writes = 0, reads = 0, registrations = 0;
    const pause = async current => {
        if (stage !== current || held) return;
        held = true; entered.resolve(); await gate.promise;
    };
    const adapter = {
        name: 'wealth-navigation-memory', async open() {},
        async loadAll() {
            reads++;
            if (reads > 1) await pause(written ? 'readback' : 'prewrite-read');
            return Object.fromEntries(records);
        },
        async saveBatch({ upserts, deletes }) {
            writes++;
            await pause(written ? 'rollback' : 'write');
            deletes.forEach(key => records.delete(key));
            upserts.forEach(([key, raw]) => records.set(key, raw));
            written = true;
        }
    };
    resetPersistenceForTests(adapter); await PersistenceFacade.init();
    const guard = createNavigationGuard({ decide: async () => true });
    const register = guard.register;
    guard.register = (...args) => { registrations++; return register(...args); };
    const persistence = {
        async flush() { await pause('preflush'); return PersistenceFacade.flush(); },
        replaceRecordsTransactional(records, options) {
            return PersistenceFacade.replaceRecordsTransactional(records, { ...options,
                postValidate: async confirmed => {
                    await pause('postvalidate');
                    if (fail) throw new Error('SYNTHETIC_POSTVALIDATION');
                    return options.postValidate(confirmed);
                }
            });
        }
    };
    const storage = { getItem: key => persistenceStorage.getItem(key) };
    const makeService = () => createBalanceWealthHistoryService({ storage, persistence, guard,
        loadState: () => JSON.parse(persistenceStorage.getItem(STATE)),
        loadRegistry: () => JSON.parse(persistenceStorage.getItem(REGISTRY)) });
    const service = makeService();
    const capture = (service, day = '2026-07-01', options = {}) => service.captureManual({ result, asOf: day, ...options });
    const ui = { button: { disabled: false }, status: { textContent: '' }, refreshes: 0 };
    const controller = createManualWealthHistoryController({ service, update: () => result, button: ui.button, status: ui.status,
        now: () => new Date(2026, 6, 1), refresh: () => { ui.refreshes++; } });
    return { persistence, storage, service, makeService, guard, controller, ui, capture, before, records, entered, gate,
        registrations: () => registrations, writes: () => writes };
}

try {
    console.log('Früher eigener Erfassungsgrund vor offenem Übersichtsergebnis');
    for (const leave of [false, true]) {
        const env = await fixture(null), overview = deferred();
        let updates = 0, decisions = 0;
        const controller = createManualWealthHistoryController({ service: env.service,
            update: () => { updates++; return { ...result, overviewPersistence: overview.promise }; },
            button: env.ui.button, status: env.ui.status, refresh: () => { env.ui.refreshes++; } });
        const running = controller.capture();
        assertEqual(env.guard.reasons()[0]?.phase, 'preparing', 'Klick registriert synchron eigenen Erfassungsgrund');
        await until(() => updates === 1);
        const navigation = env.guard.prepare({ decide: async () => { decisions++; return leave; } });
        if (!leave) {
            assertEqual(await navigation, null, 'Bleiben erhält denselben Vorgang');
            assertEqual(updates, 1, 'Bleiben startet keine Ersatzvorschau');
            overview.resolve(true);
            assertEqual((await running).status, 'saved', 'Bestehender Vorgang endet erfolgreich');
        } else {
            const attempt = await navigation;
            assert(attempt, 'Verlassen wartet auf tatsächliches Handlerende ohne offenes Übersichtspromise');
            assertEqual((await running).status, 'cancelled', 'Verlassen beendet Vorbereitung');
            assertEqual(env.writes(), 0, 'Abbruch vor Erfassungswrites');
            assertEqual(env.ui.refreshes, 1, 'UI-Cleanup gehört zum Handlerende');
            env.guard.end(attempt);
            overview.resolve(true);
            await Promise.resolve(); await Promise.resolve();
            assertEqual(env.writes(), 0, 'Späte Übersicht führt nicht zu nachlaufender Erfassung');
            assertEqual((await controller.capture()).status, 'saved', 'Wiederholung nach Abbruch funktioniert');
        }
        assertEqual(decisions, 1, 'Vorbereitung fragt Navigation nach');
        assert(!env.ui.button.disabled, 'Controls nach Handlerende frei');
        assertEqual(env.guard.reasons().length, 0, 'Erfassungsgrund nach Handlerende frei');
    }
    {
        const env = await fixture(null), hold = deferred(), began = deferred();
        const first = env.service.runManual(async operation => { began.resolve(); await hold.promise; operation.check(); }).catch(error => error);
        await began.promise;
        const queued = env.controller.capture();
        let cleanupAtRelease = false;
        const unwatch = env.guard.subscribe(reasons => { if (!reasons.length) cleanupAtRelease = !env.ui.button.disabled && env.ui.refreshes === 1; });
        const navigation = env.guard.prepare();
        await until(() => env.guard.reasons()[0]?.phase === 'cancelling');
        hold.resolve();
        assertEqual((await first).name, 'AbortError', 'Navigation kündigt auch vorgelagerten Queuejob');
        assertEqual((await queued).status, 'cancelled', 'Noch nicht gestarteter Capturehandler endet gekündigt');
        const attempt = await navigation;
        assert(attempt, 'Navigation wartet auch queued Handlercleanup');
        assert(cleanupAtRelease, 'Queuegrund endet erst nach UI-Cleanup des noch nicht gestarteten Handlers');
        assertEqual(env.writes(), 0, 'Gekündigte Queue erzeugt keine Erfassungswrites');
        unwatch(); env.guard.end(attempt);
        assertEqual((await env.controller.capture()).status, 'saved', 'Wiederholung nach queued Abbruch funktioniert');
    }
    {
        const env = await fixture(null), hold = deferred(), began = deferred();
        const first = env.service.runManual(async () => { began.resolve(); await hold.promise; });
        await began.promise;
        const queued = env.controller.capture();
        const state = JSON.parse(persistenceStorage.getItem(STATE)); state.changedAfterClick = true;
        persistenceStorage.setItem(STATE, JSON.stringify(state));
        hold.resolve(); await first;
        assertEqual((await queued).status, 'failed', 'Klickquellen bleiben auch vor dem ersten Queuewarten gebunden');
        assertEqual(env.writes(), 0, 'Quellenwechsel während Queuewarten erzeugt keinen stale Verlaufwrite');
        assertEqual(env.guard.reasons().length, 0, 'Queuequellenfehler gibt Controls und Guard frei');
    }
    {
        const env = await fixture(null), overview = deferred();
        const controller = createManualWealthHistoryController({ service: env.service, refresh() {},
            update: () => ({ ...result, overviewPersistence: overview.promise }) });
        const running = controller.capture();
        const foreign = env.guard.register(Symbol('kurzer fremder Write'), { read: () => ({ phase: 'commit' }) });
        foreign.unregister(); overview.resolve(true);
        assertEqual((await running).status, 'failed', 'Fremder Commit vor erstem Queuecallback wird nicht ignoriert');
        assertEqual(env.writes(), 0, 'Kurzzeitiger fremder Grund erzeugt keinen Verlaufwrite');
        assertEqual(env.guard.reasons().length, 0, 'Früher Fremdgrundfehler endet ohne Dauersperre');
    }
    console.log('Regression Befund 1: manueller Controller mit echtem PREVIEW-Übersichtswriter');
    {
        const env = await fixture('postvalidate'), overviewGate = deferred();
        let overviewEntered = false;
        let clock = new Date(2026, 6, 1, 23, 59);
        const controller = createManualWealthHistoryController({ service: env.service,
            update: ({ navigationOperation }) => ({ ...result, overviewPersistence: storeOverviewSummary({ year: 2026,
                scope: overviewScope('single', ['a']), monthlyWithdrawal: 100, monthlyBudget: 200,
                createdAt: '2026-07-01T12:00:00Z' }, { expectedProfileId: 'a', storage: persistenceStorage,
                guard: env.guard, navigationOperation, flush: async () => { overviewEntered = true; await overviewGate.promise; return PersistenceFacade.flush(); } }) }),
            button: env.ui.button, status: env.ui.status, now: () => clock, refresh: () => {} });
        const pending = controller.capture();
        await until(() => overviewEntered);
        assertEqual(env.writes(), 0, 'Offene Übersicht startet keinen Verlaufwrite');
        assertEqual(env.guard.reasons().filter(reason => reason.phase === 'preparing').length, 1, 'Übersichtflush erhält eigenen kündigbaren Erfassungsgrund');
        assertEqual(env.guard.reasons().filter(reason => reason.phase === 'commit').length, 1, 'Übersichtflush schützt tatsächlich gestarteten Übersichtwrite');
        assertEqual(await env.guard.prepare(), null, 'Übersichtflush ist Commit, keine kündigbare Vorflushvorbereitung');
        assertEqual((await controller.capture()).status, 'in_flight', 'Doppelklick während Übersicht bleibt gebunden');
        clock = new Date(2026, 6, 2, 0, 1);
        overviewGate.resolve();
        // Vorher endet der Controller bereits mit NAVIGATION_WRITE_BUSY. Ein Race
        // macht diesen Fehler sichtbar, ohne auf eine unerreichbare Barriere zu warten.
        const boundary = await Promise.race([pending, env.entered.promise.then(() => ({ status: 'confirming' }))]);
        assertEqual(boundary.status, 'confirming', 'Eigener Übersichtswriter erlaubt anschließende Verlaufspersistenz');
        assert(env.ui.status.textContent !== 'Stand gesichert', 'Kein Erfolg vor bestätigtem Verlauf');
        env.gate.resolve();
        assertEqual((await pending).status, 'saved', 'Manueller Controller bestätigt den Folgewrite');
        assertEqual(env.ui.status.textContent, 'Stand gesichert', 'Erfolg nach Readback');
        const history = JSON.parse(env.records.get(STATE)).wealthHistory.entries;
        assertEqual(history.length, 1, 'Genau ein manueller Stand');
        assertEqual(history[0].asOf, '2026-07-01', 'Ursprünglicher Klicktag');
        assertEqual(env.guard.reasons().length, 0, 'Übersicht und Verlauf geben ihre Gründe frei');
    }
    {
        const env = await fixture('preflush');
        const controller = createManualWealthHistoryController({ service: env.service, refresh: () => {},
            update: ({ navigationOperation }) => {
                const completion = storeOverviewSummary({ year: 2026, scope: overviewScope('single', ['a']),
                    monthlyWithdrawal: 100, monthlyBudget: 200, createdAt: '2026-07-01T12:00:00Z' }, {
                    expectedProfileId: 'a', storage: persistenceStorage, guard: env.guard, navigationOperation, flush: () => PersistenceFacade.flush()
                });
                return { ...result, overviewNavigationOwner: completion.navigationOwner,
                    overviewPersistence: completion.catch(() => false) };
            } });
        const pending = controller.capture(); await env.entered.promise;
        assertEqual(env.guard.reasons()[0]?.phase, 'preparing', 'Verlaufs-Preflush nach Übersicht ist kündigbare Erfassungsvorbereitung');
        const navigation = env.guard.prepare();
        await until(() => env.guard.reasons()[0]?.phase === 'cancelling');
        env.gate.resolve();
        assertEqual((await pending).status, 'cancelled', 'Navigation kündigt Folgeerfassung nach bestätigter Übersicht');
        const attempt = await navigation;
        assert(attempt, 'Navigation wartet auch nach Übersicht auf tatsächliches Handlerende');
        assertEqual(JSON.parse(env.records.get(STATE)).wealthHistory.entries.length, 0, 'Gekündigter Folgewrite ergänzt keinen Stand');
        env.guard.end(attempt);
        assertEqual(env.guard.reasons().length, 0, 'Abbruch hinterlässt keine offenen Gründe');
        assertEqual((await controller.capture()).status, 'saved', 'Erfassung nach Übersicht und Abbruch erneut erreichbar');
        assertEqual(JSON.parse(env.records.get(STATE)).wealthHistory.entries.length, 1, 'Retry sichert genau einen Stand');
    }
    {
        const env = await fixture(null);
        let foreign;
        const controller = createManualWealthHistoryController({ service: env.service, refresh() {},
            update: ({ navigationOperation }) => {
                foreign = env.guard.register(Symbol('fremde Vorbereitung'), { read: () => ({ phase: 'preparing' }) });
                return { ...result, overviewPersistence: storeOverviewSummary({ year: 2026, scope: overviewScope('single', ['a']),
                    monthlyWithdrawal: 100, monthlyBudget: 200, createdAt: '2026-07-01T12:00:00Z' }, {
                    expectedProfileId: 'a', storage: persistenceStorage, guard: env.guard, navigationOperation }) };
            } });
        assertEqual((await controller.capture()).status, 'failed', 'Eigener Erfassungsgrund erlaubt keine fremde Vorbereitung');
        assertEqual(env.writes(), 0, 'Fremder Grund verhindert Übersicht- und Verlaufwrites');
        assertEqual(persistenceStorage.getItem('overview_balance_summary_v1'), null, 'Keine Übersicht trotz fremdem Vorbereitungsgrund');
        assertEqual(env.guard.reasons().length, 1, 'Handlerende gibt fremden Grund nicht frei');
        foreign.unregister();
    }
    for (const stage of ['preflush', 'prewrite-read']) {
        const env = await fixture(stage);
        const first = env.controller.capture();
        await env.entered.promise;
        const second = env.capture(env.makeService(), '2026-07-02').catch(error => error);
        assertEqual(env.registrations(), 1, `${stage}: mehrere Dienste registrieren genau einen Queueprovider`);
        let handedOff = false;
        const navigation = env.guard.prepare().then(attempt => { handedOff = Boolean(attempt); return attempt; });
        await until(() => env.guard.reasons()[0]?.phase === 'cancelling');
        assertEqual(handedOff, false, `${stage}: Navigation wartet tatsächliches Vorbereitungsende`);
        assert(env.ui.button.disabled, `${stage}: Erfassung bleibt bis Handlerende beschäftigt`);
        let denied = false;
        try { await env.capture(env.makeService(), '2026-07-03'); } catch { denied = true; }
        assert(denied, `${stage}: reservierte Navigation weist neue Erfassung am Dienst ab`);
        env.gate.resolve();
        assertEqual((await first).status, 'cancelled', `${stage}: gekündigter Capturehandler endet`);
        assertEqual((await second).name, 'AbortError', `${stage}: gekündigter Queueeintrag schreibt nicht später`);
        const attempt = await navigation;
        assert(attempt && handedOff, `${stage}: bestätigtes Queueende erlaubt Navigation ohne Deadlock`);
        assertEqual(env.ui.refreshes, 1, `${stage}: Handoff erfolgt nach UI-Fehlerabschluss`);
        assert(!env.ui.button.disabled, `${stage}: Captureknopf nach Kündigung wieder bedienbar`);
        assertEqual(env.writes(), 0, `${stage}: kein Write nach bestätigter Kündigung`);
        assertEqual(env.records.get(STATE), env.before, `${stage}: bestätigter Verlauf bleibt bytegleich`);
        env.guard.end(attempt);
        assertEqual((await env.controller.capture()).status, 'saved', `${stage}: erneute Erfassung nach Kündigung erreichbar`);
    }
    for (const stage of ['write', 'readback', 'postvalidate', 'rollback']) {
        const env = await fixture(stage, { fail: stage === 'rollback' });
        const running = env.controller.capture();
        await env.entered.promise;
        assertEqual(env.guard.reasons()[0]?.phase, 'commit', `${stage}: reale Transaktion hält Commit bis bestätigtem Ende`);
        assertEqual(await env.guard.prepare(), null, `${stage}: App-Navigation bleibt gesperrt`);
        let native = 0;
        env.guard.beforeUnload({ preventDefault() { native++; } });
        assertEqual(native, 1, `${stage}: native Browsernachfrage bleibt aktiv`);
        const foreign = env.guard.register(Symbol('foreign-write'), { read: () => ({ phase: 'commit' }) });
        env.gate.resolve();
        const outcome = await running;
        assertEqual(outcome.status, stage === 'rollback' ? 'failed' : 'saved', `${stage}: Handler meldet tatsächlichen Abschluss`);
        assertEqual(env.guard.reasons().length, 1, `${stage}: inneres Ende entsperrt keinen fremden Besitzer`);
        foreign.unregister();
        assertEqual(env.guard.reasons().length, 0, `${stage}: terminales Ende hinterlässt keine Dauersperre`);
        if (stage === 'rollback') {
            assertEqual(env.records.get(STATE), env.before, 'Rollback bestätigt vorherigen Verlauf bytegleich');
            assert(env.ui.status.textContent.includes('Stand nicht bestätigt'), 'Rollbackfehler behält vorhandene Fehleranzeige');
            // Neuer Dienst nutzt denselben Provider, ohne die Fehlerquelle der ersten Fixture.
            const retry = createBalanceWealthHistoryService({ storage: env.storage, persistence: PersistenceFacade, guard: env.guard,
                loadState: () => JSON.parse(persistenceStorage.getItem(STATE)), loadRegistry: () => JSON.parse(persistenceStorage.getItem(REGISTRY)) });
            await env.capture(retry);
            assertEqual(JSON.parse(env.records.get(STATE)).wealthHistory.entries.length, 1, 'Erneute Erfassung nach terminalem Fehler ist erreichbar');
        }
    }
    {
        const env = await fixture(null);
        const flush = env.persistence.flush;
        env.persistence.flush = async () => false;
        assertEqual((await env.controller.capture()).status, 'failed', 'Flush-false bestätigt keinen manuellen Verlauf');
        assertEqual(env.writes(), 0, 'Flush-false startet keinen Transaktionswrite');
        assertEqual(env.records.get(STATE), env.before, 'Flush-false erhält bestätigten Verlauf bytegleich');
        assertEqual(env.guard.reasons().length, 0, 'Flush-false endet ohne dauerhafte Queuegründe');
        env.persistence.flush = flush;
        assertEqual((await env.controller.capture()).status, 'saved', 'Capture nach Flush-false ist erneut bedienbar');
        const attempt = await env.guard.prepare();
        let blocked = false;
        try { await env.service.runAnnual(() => {}); } catch { blocked = true; }
        assert(blocked, 'Reservierte Navigation blockiert auch direkten Jahresstart am Dienst');
        env.guard.end(attempt);
        assertEqual((await env.controller.capture()).status, 'saved', 'Abgewiesener Jahresstart hinterlässt keinen annual-Zähler');
    }
    {
        const env = await fixture('preflush');
        const previousDocument = globalThis.document;
        const oldDocument = {}, currentDocument = {}, nextDocument = {};
        const makeDefaultService = () => createBalanceWealthHistoryService({
            storage: env.storage, persistence: env.persistence,
            loadState: () => JSON.parse(persistenceStorage.getItem(STATE)),
            loadRegistry: () => JSON.parse(persistenceStorage.getItem(REGISTRY))
        });
        try {
            globalThis.document = oldDocument;
            makeDefaultService();
            const oldGuard = getPageNavigationGuard();
            globalThis.document = currentDocument;
            const currentGuard = getPageNavigationGuard();
            let registrations = 0;
            const register = currentGuard.register;
            currentGuard.register = (...args) => { registrations++; return register(...args); };
            const service = makeDefaultService();
            makeDefaultService();
            const running = env.capture(service).catch(error => error);
            await env.entered.promise;
            assertEqual(currentGuard.reasons()[0]?.phase, 'preparing', 'Defaultdienst schützt die Queue am aktuellen Dokument');
            assertEqual(oldGuard.reasons().length, 0, 'Dokumentwechsel entfernt den Verlaufprovider vom alten Seitenguard');
            assertEqual(registrations, 1, 'Dasselbe aktuelle Dokument erhält genau einen Verlaufprovider');
            const annual = createAnnualNavigationLifecycle();
            let annualStarts = 0;
            assertEqual((await annual.run({}, () => { annualStarts++; })).status, 'in_flight',
                'Jahresstart sieht nach Dokumentwechsel die aktive Verlaufsvorbereitung');
            assertEqual(annualStarts, 0, 'Abgewiesener Jahresstart führt keine Fachaktion aus');
            globalThis.document = nextDocument;
            let bindingError;
            try { makeDefaultService(); } catch (error) { bindingError = error; }
            assertEqual(bindingError?.message, 'WEALTH_HISTORY_NAVIGATION_GUARD_CHANGED',
                'Laufende Queue erlaubt keinen Wechsel ihres Seitenguards');
            assertEqual(currentGuard.reasons()[0]?.phase, 'preparing', 'Abgewiesene Neubindung erhält den laufenden Besitzer');
            globalThis.document = currentDocument;
            const navigation = currentGuard.prepare({ decide: async () => true });
            await until(() => currentGuard.reasons()[0]?.phase === 'cancelling');
            env.gate.resolve();
            assertEqual((await running).name, 'AbortError', 'Aktueller Seitenguard kündigt die tatsächliche Verlaufsvorbereitung');
            const attempt = await navigation;
            assert(attempt, 'Navigation wird erst nach Queueende am aktuellen Dokument freigegeben');
            assertEqual(env.writes(), 0, 'Gekündigte Vorbereitung schreibt nach Dokumentwechsel keinen Record');
            currentGuard.end(attempt);
            await env.capture(service);
            assertEqual(JSON.parse(env.records.get(STATE)).wealthHistory.entries.length, 1,
                'Erfassung bleibt nach Dokumentwechsel und Kündigung erneut erreichbar');
        } finally {
            env.gate.resolve();
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
        }
    }
    {
        const env = await fixture('write');
        const first = env.capture(env.service);
        await env.entered.promise;
        const second = env.capture(env.makeService(), '2026-07-02');
        const states = [];
        const unwatch = env.guard.subscribe(reasons => states.push(reasons.map(reason => reason.phase).join(',')));
        env.gate.resolve(); await first; await second; unwatch();
        assertEqual(states.filter(value => value === '').length, 1, 'Erfolgreiche Queuefortsetzung besitzt keine ungeschützte Navigationslücke');
        const confirmed = JSON.parse(env.records.get(STATE));
        assertEqual(confirmed.wealthHistory.entries.length, 2, 'Beide bestätigten Queuerecords bleiben erhalten');
        assertEqual(JSON.parse(env.records.get(REGISTRY)).profiles.a.data[STATE], env.records.get(STATE), 'Queueende bestätigt identische Registrykopie');
    }
    for (const change of ['profile', 'source']) {
        const env = await fixture('write');
        const first = env.capture(env.service);
        await env.entered.promise;
        const second = env.capture(env.makeService(), '2026-07-02', { validateSource: () => {
            if (change === 'source' && changed) throw new Error('SOURCE_CHANGED');
        } }).catch(error => error);
        let changed = false;
        const states = [];
        const unwatch = env.guard.subscribe(reasons => states.push(reasons.map(reason => reason.phase).join(',')));
        if (change === 'profile') persistenceStorage.setItem(PROFILE_STORAGE_KEYS.current, 'b');
        changed = true; env.gate.resolve();
        const outcome = await first.catch(error => error);
        if (change === 'source') assert(outcome.wealthHistory, 'Erster Queuewrite bleibt bei späterem Sourcewechsel bestätigt');
        assert(await second instanceof Error, `${change}: queued Fortsetzung prüft Kontext und Source erneut`);
        unwatch();
        assertEqual(states.filter(value => value === '').length, 1, `${change}: keine Freigabelücke zwischen Queuetransaktion und Fortsetzung`);
        if (change === 'source') assertEqual(JSON.parse(env.records.get(STATE)).wealthHistory.entries.length, 1,
            'Sourcefehler erhält bereits bestätigten Verlauf ohne stale Folgeeintrag');
        assertEqual(env.registrations(), 1, `${change}: Folgeabschluss erzeugt keine doppelte Providerregistrierung`);
    }
    {
        const env = await fixture('readback');
        const finalFlush = deferred(), flushEntered = deferred();
        const annual = createAnnualNavigationLifecycle({ guard: env.guard, flush: async () => { flushEntered.resolve(); await finalFlush.promise; } });
        const running = annual.run({}, navigationOperation => env.service.runAnnual(async context => {
            navigationOperation.commit('finalizing');
            await env.service.finalizeAnnual({ context, result, targetYear: 2026,
                metadata: { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2026', pendingCommit: null }, navigationOperation });
        }, { navigationOperation }));
        await env.entered.promise;
        assertEqual(env.guard.reasons().length, 1, 'Jährliche Finalisierung übernimmt äußeren Besitzer ohne zweiten Verlustgrund');
        assertEqual(env.guard.reasons()[0].annualPhase, 'finalizing', 'Innerer Transaktionscommit erhält äußere Jahresphase');
        assertEqual(await env.guard.prepare({ intent: 'close' }), null, 'Jährlicher finaler Readback sperrt auch übernommenen Schließversuch');
        env.gate.resolve(); await flushEntered.promise;
        assertEqual(await env.guard.prepare(), null, 'Inneres Readbackende entsperrt äußeren Jahres-Schlussflush nicht');
        finalFlush.resolve(); await running;
        assertEqual(env.guard.reasons().length, 0, 'Erst äußeres Jahresende gibt Navigation frei');
        assertEqual(JSON.parse(env.records.get(STATE)).wealthHistory.entries[0].id, 'annual:2026', 'Jährlicher Verlauf behält unveränderte Recordidentität');
    }
} finally { resetPersistenceRuntimeForTests(); }
