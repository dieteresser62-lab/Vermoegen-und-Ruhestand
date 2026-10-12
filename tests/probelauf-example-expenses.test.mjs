import { bindOverviewExampleExpenses } from '../app/overview/overview-example-expenses.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createProbelaufController, PROBELAUF_STATE_KEY } from '../app/shared/probelauf-state.js';
import { generateExampleExpensesCsv, canGenerateExampleExpenses, resolveExampleExpensesBasis, EXAMPLE_SOURCE } from '../app/demo/beispielausgaben.js';
import { importExpenses, requestExpensesPreview } from '../app/balance/balance-expenses-import.js';
import { parseCategoryCsv } from '../app/balance/balance-expenses-csv.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import strict from 'node:assert/strict';
const assert = {
    equal: (a, b, message = 'Werte gleich') => assertEqual(a, b, message),
    ok: (value, message = 'Bedingung erfüllt') => globalThis.assert(value, message),
    deepEqual: (a, b, message = 'Strukturen gleich') => { strict.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), message); globalThis.assert(true, message); },
    throws: (...args) => { strict.throws(...args); globalThis.assert(true, 'Verweigerung bestätigt'); },
    rejects: async (...args) => { await strict.rejects(...args); globalThis.assert(true, 'Asynchrone Verweigerung bestätigt'); },
    match: (...args) => { strict.match(...args); globalThis.assert(true, 'Format stimmt'); },
    notEqual: (...args) => { strict.notEqual(...args); globalThis.assert(true, 'Variation bestätigt'); }
};

const oldDate = getAppTestDate();
const records = {}, points = new Map(); let writes = 0;
const adapter = { name: 'example-expenses-memory', async loadAll() { return { ...records }; },
    async saveBatch({ deletes, upserts }) { writes++; deletes.forEach(key => delete records[key]); upserts.forEach(([key, value]) => records[key] = value); },
    async listSnapshots() { return [...points.values()].map(({ records, ...point }) => point); },
    async readSnapshot(id) { return structuredClone(points.get(id)); }, async writeSnapshot(point) { points.set(point.id, structuredClone(point)); }, async deleteSnapshot(id) { points.delete(id); } };
const controller = () => createProbelaufController({ win: { location: { href: 'http://localhost/index.html?probelauf=1' } }, session: null, reload() {}, restoreReload() {} });
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { resolve, promise }; };
const sum = csv => Object.values(parseCategoryCsv(csv)).reduce((a, b) => a + Math.abs(b), 0);
const key = 'balance_expenses_v1';
try {
    P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false });
    let c = controller(); await c.initialize();
    const input = { controller: c, ids: ['muster_a', 'muster_b'], profileId: 'muster_a', year: 2026, month: 10, basis: 5000 };
    assert.equal(canGenerateExampleExpenses(c), false, 'URL allein erlaubt keine Beispiele');
    assert.throws(() => generateExampleExpensesCsv(input), /Probelauf/);
    assert.throws(() => generateExampleExpensesCsv({ ...input, controller: true }), /Probelauf/);
    const baselineWrites = writes;
    await assert.rejects(importExpenses({ targets: [{ ...input, source: EXAMPLE_SOURCE, text: async () => 'Kategorie;Betrag\nTest;1,00' }], controller: c, confirm: async () => true }), /Probelauf/);
    assert.equal(writes, baselineWrites, 'Verweigerung ist schreibfrei');
    await c.start(async () => ({ source: 'demo', testDate: '2026-11-02' }));
    assert.throws(() => generateExampleExpensesCsv(input), /Probelauf/, 'Alter Koordinator ist nach Start gesperrt');
    P.resetPersistenceForTests(adapter); await P.init({ installLifecycleHooks: false }); c = controller(); await c.initialize(); input.controller = c;
    assert.equal(canGenerateExampleExpenses(c), true);
    const csv = generateExampleExpensesCsv(input);
    assert.equal(csv, generateExampleExpensesCsv({ ...input, ids: ['muster_b', 'muster_a'] }), 'Reihenfolge verändert CSV nicht');
    assert.equal(csv, generateExampleExpensesCsv(input), 'Wiederholung ist bytegleich');
    assert.notEqual(csv, generateExampleExpensesCsv({ ...input, month: 11 }));
    assert.notEqual(csv, generateExampleExpensesCsv({ ...input, year: 2027 }));
    assert.match(csv, /^Kategorie;Betrag\n/);
    assert.ok(csv.split('\n').slice(1).every(line => /;-\d+,\d{2}$/.test(line)));
    for (const ids of [['eigene-person'], ['muster_a', 'muster_b'], ['a', 'b', 'c', 'd']]) {
        for (let i = 0; i < 24; i++) {
            const year = 2026 + Math.floor(i / 12), month = i % 12 + 1;
            const csvs = ids.map(profileId => generateExampleExpensesCsv({ ...input, ids, profileId, year, month }));
            const total = csvs.reduce((a, csv) => a + sum(csv), 0);
            assert.ok(total >= 4250 - .01 && total <= 5500 + .01, 'Haushalt liegt 85–110 Prozent ohne Personenmultiplikator');
            if ((year * 12 + month - 1) % 5 === 0) { assert.ok(csvs.some(csv => csv.includes('Reparatur;'))); assert.ok(total > 5000); }
            if (month === 12) assert.ok(total >= 5250 - .01, 'Dezember hat höheren saisonalen Faktor');
        }
    }
    assert.equal(resolveExampleExpensesBasis({ year: 2026, ids: input.ids, budget: 1234 }), 1234);
    assert.equal(resolveExampleExpensesBasis({ year: 2020, ids: input.ids }), 5000, 'Gemeinsamer Jahresbedarf nur einmal');
    const balanceRaw = storage.getItem(CONFIG.STORAGE.LS_KEY);
    for (const inputs of [{ floorBedarf: 0, flexBedarf: 0 }, { floorBedarf: 'kaputt', flexBedarf: 100 }, {}]) {
        storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({ ...JSON.parse(balanceRaw), inputs }));
        assert.throws(() => resolveExampleExpensesBasis({ year: 2020, ids: input.ids }), /gültig/);
    }
    storage.setItem(CONFIG.STORAGE.LS_KEY, balanceRaw); await P.flush();
    assert.throws(() => generateExampleExpensesCsv({ ...input, basis: 0 }));
    const target = profileId => ({ ...input, profileId, source: EXAMPLE_SOURCE, text: async () => generateExampleExpensesCsv({ ...input, profileId }) });
    const original = storage.getItem(key), beforeWrites = writes;
    const cancelled = await importExpenses({ targets: [target('muster_a')], controller: c, confirm: async targets => {
        assert.equal(storage.getItem(key), original, 'Vor Vorschau kein Write');
        assert.equal(targets[0].total, sum(csv), 'Vorschau folgt unverändertem Parser');
        assert.deepEqual(targets[0].categories, parseCategoryCsv(csv)); return false;
    } });
    assert.equal(cancelled.status, 'cancelled'); assert.equal(writes, beforeWrites);
    await assert.rejects(importExpenses({ targets: [target('muster_a'), { ...target('muster_b'), text: async () => 'Kategorie;Betrag\nDefekt;abc' }], controller: c, confirm: async () => { throw new Error('Darf nicht bestätigt werden'); } }));
    assert.equal(storage.getItem(key), original, 'Ungültige Sammel-CSV erhält Zielrecords');
    const single = await importExpenses({ targets: [target('muster_a')], controller: c, confirm: async () => true });
    assert.equal(single.status, 'saved');
    const afterSingle = JSON.parse(storage.getItem(key));
    assert.deepEqual(afterSingle.years[2026].months[10].profiles.muster_a.categories, parseCategoryCsv(csv));
    assert.deepEqual(afterSingle.years[2026].months[10].profiles.muster_b, JSON.parse(original).years[2026].months[10].profiles.muster_b, 'Einzelimport erhält andere Person byteinhaltlich');
    const all = await importExpenses({ targets: input.ids.map(target), controller: c, confirm: async targets => { assert.ok(targets[0].replacing); return true; } });
    assert.equal(all.status, 'saved');
    assert.equal(records[key], storage.getItem(key), 'Cache und dauerhaftes Backend getrennt bestätigt');
    assert.deepEqual(JSON.parse(records[key]).years[2026].months[10].profiles.muster_a.categories, afterSingle.years[2026].months[10].profiles.muster_a.categories, 'Einzel- und Gesamtimport gleich');
    await importExpenses({ targets: [{ ...target('muster_a'), source: undefined, text: async () => 'Kategorie;Betrag\nEcht;123,45' }], controller: c, confirm: async () => true });
    assert.equal(JSON.parse(records[key]).years[2026].months[10].profiles.muster_a.source, undefined, 'Echte CSV ersetzt Herkunft');
    await importExpenses({ targets: [{ ...target('muster_a'), source: undefined, text: async () => 'Kategorie;Betrag\nAusgabe;-100,00\nErstattung;20,00' }], controller: c,
        confirm: async targets => { assert.equal(targets[0].total, 80, 'Vorschaugesamt entspricht bestehender Rechenlogik bei Erstattung'); assert.equal(targets[0].categories.Erstattung, 20); return false; } });
    // Doppelaktionen sind serialisiert, auch über eine verzögerte Vorschau.
    const gate = deferred(), entered = deferred(), order = [];
    const first = importExpenses({ targets: [target('muster_a')], controller: c, confirm: async () => { order.push(1); entered.resolve(); return gate.promise; } });
    const second = importExpenses({ targets: [target('muster_b')], controller: c, confirm: async () => { order.push(2); return true; } });
    await entered.promise; assert.deepEqual(order, [1]); gate.resolve(true); await Promise.all([first, second]); assert.deepEqual(order, [1, 2]);
    {
        const held = deferred(), ready = deferred();
        const bound = { ...target('muster_a'), text: async () => { ready.resolve(); await held.promise; return csv; } };
        const job = importExpenses({ targets: [bound], controller: c, confirm: async () => true });
        await ready.promise; bound.year = 2028; bound.month = 1; bound.profileId = 'muster_b'; held.resolve(); await job;
        assert.equal(JSON.parse(records[key]).years[2028], undefined, 'Import bindet Zielwerte vor erstem Await als eigene Kopie');
    }
    // Wechsel während Text-/Vorschauawait: unveränderte Rohrecords, kein Flush.
    for (const delay of ['text', 'preview']) {
        const hold = deferred(), ready = deferred(); let current = true;
        const raw = storage.getItem(key), count = writes;
        const job = importExpenses({ targets: [{ ...target('muster_a'), text: async () => { if (delay === 'text') { ready.resolve(); await hold.promise; } return csv; } }], controller: c,
            isCurrent: () => current, confirm: async () => { ready.resolve(); return hold.promise; } });
        await ready.promise; current = false; hold.resolve(true); await assert.rejects(job, /Kontext/);
        assert.equal(storage.getItem(key), raw); assert.equal(writes, count);
    }
    // Guard verhindert Navigation und Probelaufende während bestätigtem Flush.
    const guard = createNavigationGuard({ decide: async () => true }), hold = deferred(), ready = deferred();
    const job = importExpenses({ targets: [target('muster_a')], controller: c, guard, confirm: async () => true,
        flush: async ownedFlush => { ready.resolve(); await hold.promise; return ownedFlush(); } });
    await ready.promise; assert.ok(guard.reasons().some(reason => reason.phase === 'commit'));
    assert.equal(await guard.prepare(), null, 'Navigation während Flush gesperrt'); hold.resolve(); await job; assert.equal(guard.reasons().length, 0);
    // Fall A: echte CSV-Lesung bleibt offen; nur die eigene Lease endet bei jedem Ausgang.
    for (const outcome of ['saved', 'cancelled', 'file-error', 'flush-error', 'aborted']) {
        const g = createNavigationGuard(), entered = deferred(), release = deferred(), external = new AbortController();
        const foreignOwner = 'foreign-draft-' + outcome;
        const foreign = g.register(foreignOwner, { read: () => ({ phase: 'idle', dirty: true, message: 'Fremder Entwurf' }) });
        const raw = storage.getItem(key), durable = records[key];
        let textReturned = false;
        const job = importExpenses({ controller: c, guard: g, signal: external.signal,
            targets: [{ ...target('muster_a'), source: undefined, text: async () => {
                entered.resolve(); await release.promise; textReturned = true;
                if (outcome === 'file-error') throw new Error('SYNTHETIC_FILE_READ');
                return 'Kategorie;Betrag\nCSV-Probe;-250';
            } }], confirm: async () => outcome !== 'cancelled',
            flush: outcome === 'flush-error' ? async () => { throw new Error('SYNTHETIC_CSV_FLUSH'); } : null
        }).then(result => ({ result }), error => ({ error }));
        try {
            await entered.promise;
            assert.equal(textReturned, false, outcome + ': echte Textoperation ist während lesender Kontrolle offen');
            assert.ok(g.reasons().some(reason => String(reason.owner) === 'Symbol(expenses-import)' && reason.phase === 'running'), outcome + ': eigene Importlease schützt die offene Lesung');
            assert.equal(storage.getItem(key), raw, outcome + ': lesende Kontrolle erhält den Cache');
            assert.equal(records[key], durable, outcome + ': lesende Kontrolle erhält den dauerhaften Bestand');
            let prevented = false; g.beforeUnload({ preventDefault() { prevented = true; } });
            assert.ok(prevented, outcome + ': Reload bleibt während Lesen geschützt');
            if (outcome === 'aborted') external.abort();
        } finally { release.resolve(); }
        const { result, error } = await job;
        if (outcome === 'file-error') assert.equal(error?.message, 'SYNTHETIC_FILE_READ');
        else if (outcome === 'aborted') assert.equal(error?.code, 'EXPENSES_ABORTED');
        else assert.equal(result?.status, outcome === 'flush-error' ? 'partial' : outcome, outcome + ': tatsächlicher Importausgang');
        assert.deepEqual(g.reasons().map(reason => reason.owner), [foreignOwner], outcome + ': eigene Lease entfernt, fremder Entwurf weiterhin geschützt');
        if (outcome !== 'saved') {
            assert.equal(storage.getItem(key), raw, outcome + ': kein veränderter Ausgabenbestand');
            assert.equal(records[key], durable, outcome + ': dauerhafte Bytes erhalten');
        } else assert.deepEqual(JSON.parse(records[key]).years[2026].months[10].profiles.muster_a.categories,
            { 'CSV-Probe': -250 }, 'Bestätigte CSV bleibt dauerhaft sichtbar');
        const retry = await importExpenses({ controller: c, guard: g, targets: [target('muster_a')], confirm: async () => true });
        assert.equal(retry.status, 'saved', outcome + ': Folgeimport bleibt möglich');
        assert.deepEqual(g.reasons().map(reason => reason.owner), [foreignOwner], outcome + ': Folgeimport entfernt keine fremde Lease');
        foreign.unregister();
        const navigation = await g.prepare(); assert.ok(navigation, outcome + ': nach Ende fremder Arbeit ist Navigation möglich'); g.end(navigation);
        let reloadBlocked = false; g.beforeUnload({ preventDefault() { reloadBlocked = true; } });
        assert.equal(reloadBlocked, false, outcome + ': Reload nach beendeter Arbeit freigegeben');
    }
    // Teilfehler wird pro Person gemeldet; kein Erfolg für unbestätigten Flush.
    let flushes = 0, successes = 0;
    const partial = await importExpenses({ targets: input.ids.map(target), controller: c, confirm: async () => true,
        flush: async ownedFlush => { if (++flushes === 1) throw new Error('Synthetischer Flushfehler'); return ownedFlush(); }, onSuccess: () => successes++ });
    assert.equal(partial.status, 'partial'); assert.deepEqual(partial.results.map(item => item.ok), [false, true]); assert.equal(successes, 1);
    // Kontrollierte Warteepisoden: keine echten Zehnsekundenpausen.
    for (const source of [undefined, EXAMPLE_SOURCE]) for (const when of ['before', 'confirmed']) {
        const g = createNavigationGuard(); let held, elapsed = 0, previews = 0, progress = [];
        if (when === 'before') held = g.register('startup-writer', { read: () => ({ phase: 'commit' }) });
        const raw = storage.getItem(key), durable = records[key];
        const result = await importExpenses({ controller: c, guard: g, targets: [{ ...target('muster_a'), source }],
            clock: () => elapsed, wait: async ms => {
                elapsed += ms;
                assert.equal(storage.getItem(key), raw, 'Warten verändert keinen Zielcache');
                assert.equal(records[key], durable, 'Warten verändert kein Zielbackend');
                assert.ok(!g.reasons().some(r => typeof r.owner === 'symbol' && r.phase === 'commit'), 'Wartephase besitzt keine eigene Commitlease');
                held.unregister();
            }, onProgress: text => progress.push(text), confirm: async prepared => {
                previews++; assert.equal(storage.getItem(key), raw, 'Vorschau bleibt schreibfrei');
                if (when === 'confirmed') held = g.register('wealth-writer', { read: () => ({ phase: 'commit' }) });
                return true;
            } });
        assert.equal(result.status, 'saved'); assert.equal(previews, 1);
        assert.ok(progress.includes('Speichert noch …'), 'Import meldet Wartephase');
        assert.equal(g.reasons().length, 0, 'Warte- und Commitlease vollständig gelöst');
    }
    {
        const g = createNavigationGuard(), held = g.register('slow', { read: () => ({ phase: 'commit' }) });
        let elapsed = 0, opened = false, succeeded = false;
        const raw = storage.getItem(key), durable = records[key];
        await assert.rejects(importExpenses({ controller: c, guard: g, targets: [target('muster_a')],
            clock: () => elapsed, wait: async ms => { elapsed += ms; }, confirm: async () => { opened = true; return true; }, onSuccess: () => { succeeded = true; }
        }), { code: 'EXPENSES_BUSY' });
        assert.equal(elapsed, 10000, 'Wartegrenze beträgt genau zehn Sekunden');
        assert.equal(storage.getItem(key), raw); assert.equal(records[key], durable);
        assert.equal(opened || succeeded, false, 'Timeout öffnet weder Vorschau noch Erfolg');
        assert.equal(g.reasons().length, 1, 'Timeout lässt nur fremden Besitzer zurück');
        held.unregister(); await Promise.resolve();
        assert.equal(records[key], durable, 'Nach Freigabe kein verspäteter Timeoutwrite');
        assert.equal((await importExpenses({ controller: c, targets: [target('muster_a')], confirm: async () => false })).status, 'cancelled', 'Importqueue nach Timeout wieder nutzbar');
    }
    for (const change of ['profile', 'date', 'session', 'recovery', 'abort', 'persisted']) {
        const g = createNavigationGuard(), held = g.register('local', { read: () => ({ phase: 'commit' }) });
        const external = new AbortController(), raw = storage.getItem(key), durable = records[key], originalSession = records[PROBELAUF_STATE_KEY];
        let current = true;
        const wrapped = { initialize() {}, get state() { return c.state; }, runtime: c.runtime, blocked: false };
        await assert.rejects(importExpenses({ controller: wrapped, guard: g, signal: external.signal, targets: [target('muster_a')],
            isCurrent: () => current, wait: async () => {
                if (change === 'profile') current = false;
                if (change === 'date') setAppTestDate('2026-11-03');
                if (change === 'session') Object.defineProperty(wrapped, 'state', { value: { ...c.state, snapshotId: 'anderer-kontext' } });
                if (change === 'recovery') wrapped.blocked = true;
                if (change === 'abort') external.abort();
                if (change === 'persisted') records[PROBELAUF_STATE_KEY] = JSON.stringify({ ...c.state, testDate: '2026-11-04' });
            }, confirm: async () => { throw new Error('Vorschau darf nicht öffnen'); }
        }), error => ['EXPENSES_CONTEXT', 'EXPENSES_ABORTED'].includes(error.code));
        assert.equal(storage.getItem(key), raw); assert.equal(records[key], durable);
        assert.equal(g.reasons().length, 1); held.unregister(); records[PROBELAUF_STATE_KEY] = originalSession; setAppTestDate(c.state.testDate);
    }
    // Persistierte Sitzungsabweichung schließt eine echte Vorschau über das Signal.
    {
        const entered = deferred(), originalSession = records[PROBELAUF_STATE_KEY], raw = storage.getItem(key);
        const job = importExpenses({ controller: c, targets: [target('muster_a')], confirm: async (prepared, { signal }) => {
            entered.resolve(); return new Promise(resolve => signal.addEventListener('abort', () => resolve(false), { once: true }));
        } });
        await entered.promise; records[PROBELAUF_STATE_KEY] = JSON.stringify({ ...c.state, snapshotId: 'extern' });
        await assert.rejects(job, { code: 'EXPENSES_CONTEXT' });
        assert.equal(storage.getItem(key), raw); records[PROBELAUF_STATE_KEY] = originalSession;
    }
    // Bestätigte erste Person bleibt bei Timeout des zweiten Sammelziels erhalten.
    {
        const g = createNavigationGuard(); let held, elapsed = 0;
        const result = await importExpenses({ controller: c, guard: g, targets: input.ids.map(target), confirm: async () => true,
            clock: () => elapsed, wait: async ms => { elapsed += ms; }, onSuccess: () => { held = g.register('followup', { read: () => ({ phase: 'commit' }) }); }
        });
        assert.equal(result.status, 'partial'); assert.deepEqual(result.results.map(item => item.ok), [true, false]);
        assert.equal(result.results[1].error.code, 'EXPENSES_BUSY');
        assert.equal(records[key], storage.getItem(key), 'Bestätigtes Sammelteil bleibt dauerhaft'); held.unregister();
    }
    {
        const local = { initialize() {}, state: c.state, runtime: c.runtime, blocked: false, busy: true };
        let waits = 0;
        const result = await importExpenses({ controller: local, targets: [target('muster_a')],
            wait: async () => { waits++; local.busy = false; }, confirm: async () => { local.busy = true; return true; } });
        assert.equal(result.status, 'saved'); assert.equal(waits, 2, 'Nur vorübergehende Controllerbeschäftigung wird vor und nach Bestätigung abgewartet');
    }
    {
        const g = createNavigationGuard(); let held, elapsed = 0, confirmed = false;
        const raw = storage.getItem(key), durable = records[key];
        await assert.rejects(importExpenses({ controller: c, guard: g, targets: [target('muster_a')],
            clock: () => elapsed, wait: async ms => { elapsed += ms; }, confirm: async () => { confirmed = true; held = g.register('late-start', { read: () => ({ phase: 'commit' }) }); return true; }
        }), { code: 'EXPENSES_BUSY' });
        assert.equal(confirmed, true); assert.equal(storage.getItem(key), raw); assert.equal(records[key], durable, 'Timeout nach Bestätigung beginnt keinen Zielwrite'); held.unregister();
    }
    // Fremde Kandidaten und technische Folgefehler behalten ihren bestehenden Vertrag.
    {
        const foreign = JSON.stringify({ version: 1, activeYear: 2026, years: { '2026': { months: { '10': { profiles: { muster_a: { categories: { Fremd: -77 }, updatedAt: '2026-11-02T00:00:00.000Z' } } } } } } });
        const result = await importExpenses({ controller: c, targets: [target('muster_a')], confirm: async () => true,
            flush: async ownedFlush => { storage.setItem(key, foreign); await ownedFlush(); throw new Error('Synthetischer Folgeflushfehler'); } });
        assert.equal(result.status, 'partial'); assert.equal(storage.getItem(key), foreign); assert.equal(records[key], foreign, 'Rollback überschreibt keinen fremden Ausgabenkandidaten');
        let followup = 0;
        const confirmed = await importExpenses({ controller: c, targets: [target('muster_a')], confirm: async () => true,
            onSuccess: async () => { throw new Error('Vermögenserfassung fehlgeschlagen'); }, onFollowupError: () => { followup++; throw new Error('Meldungsfehler'); } });
        assert.equal(confirmed.status, 'saved'); assert.equal(followup, 1); assert.equal(records[key], storage.getItem(key), 'Folgefehler ändern bestätigten Import nicht');
    }
    {
        const g = createNavigationGuard(), external = new AbortController(), entered = deferred(), release = deferred();
        const job = importExpenses({ controller: c, guard: g, signal: external.signal, targets: [target('muster_a')], confirm: async () => true,
            flush: async ownedFlush => { entered.resolve(); await release.promise; return ownedFlush(); } });
        await entered.promise; external.abort(); await Promise.resolve();
        assert.ok(g.reasons().some(reason => reason.phase === 'commit'), 'Signalabbruch gibt begonnenen Flushbesitz nicht vorzeitig frei');
        release.resolve(); const result = await job; assert.equal(result.status, 'saved'); assert.equal(g.reasons().length, 0);
    }
    // Auch die eigene Importqueue beendet unbegonnene Ziele vor fremdem Flushende.
    {
        const g = createNavigationGuard(), entered = deferred(), release = deferred();
        const first = importExpenses({ controller: c, guard: g, targets: [target('muster_a')], confirm: async () => true,
            flush: async ownedFlush => { entered.resolve(); await release.promise; return ownedFlush(); } });
        await entered.promise;
        const raw = storage.getItem(key), durable = records[key]; let secondConfirmed = false;
        await assert.rejects(importExpenses({ controller: c, guard: g, targets: [target('muster_b')], timeoutMs: 5,
            confirm: async () => { secondConfirmed = true; return true; } }), { code: 'EXPENSES_BUSY' });
        assert.equal(secondConfirmed, false); assert.equal(storage.getItem(key), raw); assert.equal(records[key], durable);
        assert.equal(g.reasons().length, 1, 'Queue-Timeout löst nur die unbegonnene Importlease');
        const cancelled = new AbortController();
        const discarded = importExpenses({ controller: c, guard: g, signal: cancelled.signal, targets: [target('muster_b')], confirm: async () => true });
        cancelled.abort(); await assert.rejects(discarded, { code: 'EXPENSES_ABORTED' });
        assert.equal(g.reasons().length, 1, 'Expliziter Queueabbruch wartet nicht auf fremdes Flushende');
        release.resolve(); await first; await Promise.resolve();
        assert.equal(secondConfirmed, false, 'Abgelaufener Importqueueauftrag öffnet später keine Vorschau');
        assert.equal(g.reasons().length, 0);
    }
    // Startseitenbinder: reale Statusknoten über Hintergrundprojektion erhalten.
    for (const selection of ['one', 'all']) for (const mode of ['released', 'confirmed', 'timeout', 'context', 'cancel']) {
        const nodes = [], doc = { activeElement: null, querySelectorAll: () => nodes.filter(node => node.dataset.overviewExample), querySelector: () => null };
        const create = id => { const listeners = new Map(); const node = { id, textContent: '', dataset: {}, setAttribute() {}, focus() {},
            addEventListener(type, fn) { listeners.set(type, fn); }, fire(type, event) { return listeners.get(type)?.(event); } }; nodes.push(node); return node; };
        const focus = create('overviewFocus'), status = create('overviewExampleExpensesStatus'), button = create('button'); button.dataset.overviewExample = selection;
        doc.getElementById = id => nodes.find(node => node.id === id);
        const g = getPageNavigationGuard(doc, {});
        let held = ['released', 'timeout', 'context'].includes(mode) ? g.register('startup', { read: () => ({ phase: 'commit' }) }) : null;
        let model = { activeId: 'muster_a', scope: { key: 'household', ids: input.ids }, now: new Date('2026-11-02'),
            expenses: { year: 2026, month: 9 }, expenseBudget: 5000, occasion: { kind: 'monthly' }, members: input.ids.map(id => ({ id, name: id })) };
        let elapsed = 0, confirms = 0, controls;
        const raw = storage.getItem(key), durable = records[key];
        const refresh = () => { model = controls.projectModel({ ...model }); status.textContent = ''; controls.syncButtons(); };
        controls = bindOverviewExampleExpenses({ doc, win: {}, controller: c, getModel: () => model, refresh,
            choose: async () => 'muster_a', confirm: async () => { confirms++; if (mode === 'confirmed') held = g.register('late-writer', { read: () => ({ phase: 'commit' }) }); return mode !== 'cancel'; },
            importOptions: { clock: () => elapsed, wait: async ms => {
                elapsed += ms; assert.equal(status.textContent, 'Speichert noch …', 'Startseite rendert Wartehinweis');
                refresh(); assert.equal(status.textContent, 'Speichert noch …', 'Startseitenmeldung überlebt Hintergrundrender');
                assert.equal(storage.getItem(key), raw); assert.equal(records[key], durable);
                if (['released', 'confirmed'].includes(mode)) { held.unregister(); held = null; }
                if (mode === 'context') { model = { ...model, activeId: 'muster_b' }; refresh(); }
            } }
        });
        await focus.fire('click', { target: { closest: () => button } });
        if (mode === 'timeout') assert.equal(status.textContent, 'Gerade wird noch gespeichert. Bitte in ein paar Sekunden erneut versuchen.');
        if (mode === 'context') assert.ok(/abgebrochen/.test(status.textContent));
        if (mode === 'cancel') assert.equal(status.textContent, 'Import abgebrochen.');
        if (['released', 'confirmed'].includes(mode)) assert.ok(status.textContent.includes('Beispielausgaben importiert.'));
        assert.equal(status.textContent.includes('Ein unerwarteter Anwendungsfehler ist aufgetreten'), false);
        if (['timeout', 'context'].includes(mode)) { assert.equal(confirms, 0); assert.equal(records[key], durable); }
        held?.unregister(); assert.equal(g.reasons().length, 0, 'Startseitenimport löst sämtliche eigenen Leases');
    }
    // Enden während verzögerter Vorschau verwirft den Import vollständig.
    const endGate = deferred(), endReady = deferred();
    const pending = importExpenses({ targets: [target('muster_a')], controller: c, confirm: async () => { endReady.resolve(); return endGate.promise; } });
    await endReady.promise; await c.end(async () => true); const restored = JSON.stringify(records);
    endGate.resolve(true); await assert.rejects(pending, /Kontext/); assert.equal(JSON.stringify(records), restored);
} finally { P.resetPersistenceForTests(); setAppTestDate(oldDate); }
console.log('Beispielausgaben: Generator, Importgrenze und Nebenläufigkeit geprüft.');

// Die produktive Vorschau prüft Texte, Vorzeichen, Herkunft, Fokus und Bedienung.
{
    const nodes = [], doc = { activeElement: null };
    doc.createElement = tag => {
        const listeners = new Map();
        const node = { tag, children: [], dataset: {}, setAttribute() {},
            appendChild(child) { this.children.push(child); child.parentNode = this; return child; }, append(...children) { children.forEach(child => this.appendChild(child)); },
            addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
            removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, fire(type) { for (const fn of listeners.get(type) || []) fn({ preventDefault() {} }); },
            showModal() { this.open = true; }, close() { this.open = false; this.fire('close'); },
            remove() { this.parentNode = null; }, focus() { doc.activeElement = this; } };
        nodes.push(node); return node;
    };
    doc.body = doc.createElement('body'); const opener = doc.createElement('button'); opener.focus();
    const pending = requestExpensesPreview([{ profileId: 'a', name: 'Person A', year: 2026, month: 10,
        source: EXAMPLE_SOURCE, replacing: true, categories: { Wohnen: -1250, Erstattung: 20 }, total: 1230 }], { doc });
    const text = field => nodes.find(node => Object.hasOwn(node.dataset, field)).textContent.replace(/\u00a0/g, ' ');
    assert.equal(text('expensesPreviewCategory'), 'Wohnen: 1.250,00 €', 'Kategorie im deutschen Währungsformat ohne Minus');
    assert.equal(text('expensesPreviewSum'), 'Summe: 1.230,00 €'); assert.equal(text('expensesPreviewTotal'), 'Gesamt: 1.230,00 €');
    assert.ok(text('expensesPreviewOrigin').includes('ersetzt')); assert.ok(text('expensesPreviewOrigin').includes('Beispieldaten'));
    const accept = nodes.find(node => Object.hasOwn(node.dataset, 'expensesPreviewAccept'));
    accept.fire('click'); assert.equal(await pending, true); assert.equal(doc.activeElement, opener);
    const aborted = new AbortController();
    const cancelled = requestExpensesPreview([], { doc, signal: aborted.signal }); aborted.abort(); assert.equal(await cancelled, false);
}
