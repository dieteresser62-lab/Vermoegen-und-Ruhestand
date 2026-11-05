import { PersistenceFacade as persistence } from '../app/shared/persistence-facade.js';
import { installProfileBfcacheRefresh } from '../app/profile/profile-navigation.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { MemoryWebStorage } from './helpers/persistence-area-backends.mjs';

// HS-1d: Ein altes Dokument erhält seinen Besitz erst durch einen echten Neustart.
for (const outcome of ['stay', 'not-ready', 'flush-failed', 'reload-failed', 'queued-write', 'success']) {
    const records = { sim_mcSeed: 'bestätigt' }, events = new Map();
    let writes = 0;
    persistence.resetPersistenceForTests({ name: 'hs1-memory', async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) { writes++; deletes.forEach(key => delete records[key]); Object.assign(records, Object.fromEntries(upserts)); },
        async writeSnapshot() { writes++; } });
    try {
        await persistence.init({ installLifecycleHooks: false, debounceMs: 60000 });
        const host = { hidden: true, textContent: '' };
        const doc = { getElementById: () => host, addEventListener() {}, removeEventListener() {} };
        const win = { addEventListener: (type, handler) => events.set(type, handler) };
        const guard = createNavigationGuard({ decide: () => outcome !== 'stay' });
        guard.register('result', { read: () => ({ result: true }) });
        installProfileBfcacheRefresh({ doc, win, guard, ready: () => outcome !== 'not-ready',
            flusher: () => outcome !== 'flush-failed', reload() { if (outcome === 'reload-failed') throw new Error('synthetic reload'); } });
        await events.get('pageshow')({ persisted: false });
        assertEqual(persistence.hasSyncWriteBlocks(), false, 'HS-1d normaler Seitenstart bleibt schreibfähig');
        if (outcome === 'queued-write') persistence.setItemSync('sim_mcSeed', 'wartender alter Write');
        await events.get('pageshow')({ persisted: true });
        let error;
        try { persistence.setItemSync('sim_mcSeed', 'veraltet'); } catch (cause) { error = cause; }
        assertEqual(error?.code, 'PERSISTENCE_RELOAD_REQUIRED', `HS-1d ${outcome}: altes Dokument schreibt nicht`);
        if (outcome === 'queued-write') {
            let flushError;
            try { await persistence.flush(); } catch (cause) { flushError = cause; }
            assertEqual(flushError?.code, 'PERSISTENCE_RELOAD_REQUIRED', 'HS-1d auch vor Rückkehr eingereihte Writes bleiben gesperrt');
        }
        try { await persistence.writeSnapshot({ id: 'synthetic' }, { guard: null }); } catch { /* Erwartete Schreibsperre. */ }
        assertEqual(writes, 0, `HS-1d ${outcome}: auch direkte Archivwrites sind gesperrt`);
        assertEqual(records.sim_mcSeed, 'bestätigt', 'HS-1d bestätigter Bestand bleibt bytegleich');
        assert(host.textContent.includes('neu laden'), 'HS-1d erklärt die nötige Rückkehr zum bestätigten Stand');
    } finally { persistence.resetPersistenceForTests(); }
}

// Auch Bereichsaktionen besitzen direkte Adapterwrites außerhalb des normalen Flushs.
for (const action of ['activate', 'discard', 'adopt']) {
    persistence.resetPersistenceRuntimeForTests();
    const localStorage = new MemoryWebStorage(), sessionStorage = new MemoryWebStorage();
    const win = { localStorage, sessionStorage, addEventListener() {}, removeEventListener() {} };
    const options = { window: win, localStorage, indexedDB: null, installLifecycleHooks: false };
    try {
        await persistence.init(options);
        if (action !== 'activate') {
            await persistence.activatePlayArea({ source: 'copy', records: { sim_mcSeed: 'synthetisch' } });
            persistence.resetPersistenceRuntimeForTests();
            await persistence.init(options);
        }
        const before = JSON.stringify([...localStorage.records]);
        const events = new Map();
        win.addEventListener = (type, handler) => events.set(type, handler);
        installProfileBfcacheRefresh({ win, doc: {}, guard: createNavigationGuard(), ready: () => false });
        await events.get('pageshow')({ persisted: true });
        let error;
        try {
            if (action === 'activate') await persistence.activatePlayArea({ source: 'copy', records: { sim_mcSeed: 'veraltet' } });
            else if (action === 'discard') await persistence.discardPlayArea();
            else await persistence.adoptPlayArea({ state: { version: 2, phase: 'active' } });
        } catch (cause) { error = cause; }
        assertEqual(error?.code, 'PERSISTENCE_RELOAD_REQUIRED', `HS-1d ${action}: altes Dokument startet keine Bereichsaktion`);
        assertEqual(JSON.stringify([...localStorage.records]), before, `HS-1d ${action}: beide Bereiche bleiben bytegleich`);
    } finally { persistence.resetPersistenceRuntimeForTests(); }
}
