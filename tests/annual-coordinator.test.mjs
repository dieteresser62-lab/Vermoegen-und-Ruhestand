import { annualServiceFixture, readyAnnualFixture, annualTestNow, annualTestMarketData, createAtomicLockProvider } from './helpers/balance-storage-fixtures.mjs';
import { createAnnualSnapshot, createAnnualNavigationLifecycle, consumeAnnualRetry, validateAnnualRetry, ANNUAL_RETRY_SESSION_KEY } from '../app/shared/annual-coordinator.js';
import { deriveAnnualCloseEvidence } from '../app/shared/annual-close-evidence.js';
import { prepareAnnualMarketData } from '../app/shared/annual-marketdata.js';
import { buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { EngineAPI } from '../engine/index.mjs';
const deferred = () => { let resolve; return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) }; };
const bytes = env => JSON.stringify(Object.fromEntries(env.backend));
const annualBatches = env => env.batches.filter(batch => batch.upserts.some(([key]) => key === 'annual_plan_record_v1'));
const phase = env => JSON.parse(env.storage.getItem(CONFIG.STORAGE.LS_KEY)).annualPeriodMetadata?.pendingCommit?.phase;
function legacySample() {
    const sample = readyAnnualFixture(), registry = JSON.parse(sample.records.rs_profiles_v1);
    for (const [id, profile] of Object.entries(registry.profiles)) {
        const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
        delete state.annualPeriodMetadata; delete state.annualMarketDataMeta;
        delete state.lastInflationAppliedAtYear; delete state.needsAdjustedForInflationYear;
        state.wealthHistory = { schemaVersion: 1, entries: [] };
        state.lastState.cumulativeInflationFactor = 1;
        profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        if (id === sample.records.rs_current_profile) sample.records[CONFIG.STORAGE.LS_KEY] = profile.data[CONFIG.STORAGE.LS_KEY];
    }
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    return sample;
}
try {
    for (const fault of ['pending', 'metadata', 'balance', 'receipt', 'future', 'contradictory']) {
        const sample = legacySample();
        const state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
        if (fault === 'pending') state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
            pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'protected-before' } };
        if (fault === 'metadata') state.annualPeriodMetadata = { schemaVersion: 99, lastCommittedPeriod: null, pendingCommit: null };
        if (fault === 'future') state.lastInflationAppliedAtYear = 2028;
        sample.records[CONFIG.STORAGE.LS_KEY] = fault === 'balance' ? '{' : JSON.stringify(state);
        if (fault === 'receipt') sample.records.annual_plan_record_v1 = '{';
        const env = await annualServiceFixture({ sample });
        const snapshot = SnapshotArchive.buildSnapshot({ id: 'protected-before', kind: 'annual-close-pre-mutation',
            createdAt: annualTestNow().toISOString(), activeProfileId: sample.records.rs_current_profile,
            records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(sample.records), getItem: key => sample.records[key] }) });
        env.snapshots.set(snapshot.id, snapshot);
        const before = JSON.stringify(await env.persistence.readPersistedRecords()), archiveBytes = JSON.stringify([...env.snapshots]);
        let questions = 0, preparations = 0;
        const service = env.create({ getLegacyDecision: async () => { questions++; return 'not_committed'; },
            confirmAnnual: async () => { preparations++; return {}; },
            ...(fault === 'contradictory' ? { getPlanningStatus: () => ({ scope: sample.scope, periodSource: { reason: 'contradictory' } }) } : {}) });
        const result = await service.close();
        assertEqual(result.status, fault === 'pending' ? 'incomplete_recovery'
            : ['receipt', 'future'].includes(fault) ? 'legacy_confirmation_required' : 'invalid',
            fault + ': beschädigte oder widersprüchliche Quellen bleiben trotz Vorabpunkt geschützt');
        assertEqual(preparations, 0, fault + ': keine Vorbereitung bei geschützten Quellen');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), before, fault + ': keine Übernahme oder Finanzanpassung');
        assertEqual(env.batches.length, 0, fault + ': kein Fach- oder Metadatenbatch');
        assertEqual(JSON.stringify([...env.snapshots]), archiveBytes, fault + ': Archiv bleibt unverändert');
        if (fault === 'pending') assertEqual(result.recovery.snapshotId, snapshot.id, 'Pending behält seinen gebundenen Recoverypunkt');
    }

    for (const stage of ['index', 'payload']) {
        for (const change of ['profile', 'scope', 'year', 'records']) {
            const sample = legacySample(), env = await annualServiceFixture({ sample });
            await createAnnualSnapshot({ storage: env.storage, archive: SnapshotArchive, profileId: sample.records.rs_current_profile,
                label: 'Vorabstand', date: annualTestNow(), check: () => {}, snapshotId: 'read-before' });
            const reached = deferred(), gate = deferred();
            const wait = async () => { reached.resolve(); await gate.promise; };
            const selectedScope = structuredClone(sample.scope);
            let profileId = sample.records.rs_current_profile, date = annualTestNow(), questions = 0, preparations = 0;
            const service = env.create({ scope: selectedScope, getProfileId: () => profileId, now: () => date,
                archive: { ...SnapshotArchive,
                    listSnapshots: async () => { if (stage === 'index') await wait(); return SnapshotArchive.listSnapshots(); },
                    readSnapshot: async id => { if (stage === 'payload') await wait(); return SnapshotArchive.readSnapshot(id); } },
                getLegacyDecision: async () => { questions++; return 'not_committed'; },
                confirmAnnual: async () => { preparations++; return {}; } });
            const running = service.close(); await reached.promise;
            if (change === 'profile') profileId = 'outside';
            if (change === 'scope') selectedScope.key = 'changed-scope';
            if (change === 'year') date = new Date('2028-01-02T12:00:00Z');
            if (change === 'records') { env.storage.setItem('depot_tranchen', env.storage.getItem('depot_tranchen') + ' '); await env.persistence.flush(); }
            const before = bytes(env), batchCount = env.batches.length, archiveBytes = JSON.stringify([...env.snapshots]);
            gate.resolve();
            assertEqual((await running).status, 'invalid', stage + '/' + change + ': Quellen- oder Kontextwechsel verhindert Freigabe');
            assertEqual(questions + preparations, 0, stage + '/' + change + ': kein Dialog oder Vorbereitung nach Kontextwechsel');
            assertEqual(bytes(env), before, stage + '/' + change + ': keine Jahreswrites nach Kontextwechsel');
            assertEqual(env.batches.length, batchCount, stage + '/' + change + ': kein Metadatenbatch');
            assertEqual(JSON.stringify([...env.snapshots]), archiveBytes, stage + '/' + change + ': kein zusätzlicher Vorabpunkt');
        }
    }
    for (const stage of ['index', 'payload']) {
        const sample = legacySample(), env = await annualServiceFixture({ sample });
        await createAnnualSnapshot({ storage: env.storage, archive: SnapshotArchive, profileId: sample.records.rs_current_profile,
            label: 'Vorabstand', date: annualTestNow(), check: () => {}, snapshotId: 'read-before' });
        let broken = true, questions = 0;
        const before = bytes(env);
        const service = env.create({ archive: { ...SnapshotArchive,
            listSnapshots: async () => { if (broken && stage === 'index') throw new Error('INDEX_FAILURE'); return SnapshotArchive.listSnapshots(); },
            readSnapshot: async id => { if (broken && stage === 'payload') throw new Error('PAYLOAD_FAILURE'); return SnapshotArchive.readSnapshot(id); } },
            getLegacyDecision: async () => { questions++; return 'not_committed'; } });
        assertEqual((await service.close()).status, 'invalid', stage + ': Archivfehler verhindert Jahresfreigabe');
        assertEqual(questions, 0, stage + ': Archivfehler wird nicht durch Klärung übergangen');
        assertEqual(bytes(env), before, stage + ': Archivfehler schreibt keine Metadaten oder Finanzdaten');
        assertEqual(env.batches.length, 0, stage + ': Archivfehler schreibt keinen Batch');
        assertEqual(env.snapshots.size, 1, stage + ': Archivfehler erzeugt keinen neuen Punkt');
        broken = false;
        assertEqual((await service.reconcilePeriod()).status, 'ready', stage + ': ausdrücklicher neuer Versuch kann passend lesen');
    }

    // Echte Snapshotgrenze und vollständiger H3-Restore, jeweils mit späterem Kurswrite.
    for (const origin of ['abort', 'restore']) {
        const sample = legacySample(), env = await annualServiceFixture({ sample });
        const initial = JSON.stringify(await env.persistence.readPersistedRecords());
        const first = await env.create(origin === 'abort' ? {
            createSnapshot: async options => {
                await createAnnualSnapshot(options);
                options.navigationOperation.controller.abort();
                options.check(); // echter AbortError nach bestätigtem Archivwrite, vor persistMetadata
            }
        } : { prepareMarketData: async () => { throw new Error('FETCH_INJECTED'); } }).close();
        assertEqual(first.status, origin === 'abort' ? 'cancelled' : 'incomplete_recovery', origin + ': richtige Abbruchgrenze');
        assertEqual(env.snapshots.size, 1, origin + ': realer Vorabpunkt bleibt archiviert');
        assertEqual(env.batches.filter(batch => batch.upserts.some(([key]) => key === 'annual_plan_record_v1')).length, 0,
            origin + ': Archivierung ist kein Fachabschluss');
        if (origin === 'abort') {
            assertEqual(first.error.name, 'AbortError', 'Abbruch wurde tatsächlich ausgelöst');
            assertEqual(env.batches.length, 0, 'Abbruch liegt vor dem ersten Metadatenwrite');
            assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), initial, 'Abbruch erhält sämtliche Finanzbytes');
            assertEqual(env.reports.length, 0, 'Bewusster Abbruch bleibt fehlerfrei');
        }
        const snapshot = await SnapshotArchive.readSnapshot('annual-before');
        if (origin === 'restore') {
            const plan = buildSnapshotRestorePlan(snapshot, await env.persistence.readPersistedRecords());
            await env.persistence.replaceRecordsTransactional(plan.records, { allowKey: plan.allowKey });
            assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), initial, 'Vollständiger Restore bestätigt ursprüngliche Quellbytes');
        }
        const restored = await env.persistence.readPersistedRecords();
        const states = [JSON.parse(restored[CONFIG.STORAGE.LS_KEY]),
            ...Object.values(JSON.parse(restored.rs_profiles_v1).profiles).map(profile => JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]))];
        for (const state of states) {
            for (const marker of ['annualPeriodMetadata', 'needsAdjustedForInflationYear', 'lastInflationAppliedAtYear', 'annualMarketDataMeta'])
                assertEqual(state[marker], undefined, origin + ': isolierter Vorabstand ohne ' + marker);
            assertEqual(state.wealthHistory.entries.length, 0, origin + ': kein Jahresverlaufsbeleg');
            assertEqual(state.lastState.cumulativeInflationFactor, 1, origin + ': noch keine Inflation');
        }
        assertEqual(restored.annual_plan_record_v1, undefined, origin + ': kein Planabschlussbeleg');
        const evidence = records => deriveAnnualCloseEvidence({ targetYear: 2026, scope: sample.scope,
            activeId: records.rs_current_profile, records, snapshots: [snapshot] });
        assertEqual(evidence(restored).status, 'ready', origin + ': bytegleicher Vorabstand bleibt unmittelbar offen');
        const older = { ...snapshot, id: 'older-pre-point', records: { ...snapshot.records, profile_tagesgeld: '888' } };
        assertEqual(deriveAnnualCloseEvidence({ targetYear: 2026, activeId: restored.rs_current_profile, scope: sample.scope,
            records: restored, snapshots: [older, snapshot] }).status, 'ready', origin + ': älterer abweichender Punkt widerlegt bytegleichen Vorabstand nicht');
        const unrelated = [
            { ...older, activeProfileId: 'outside' }, { ...older, createdAt: '2026-01-02T12:00:00Z' }, { ...older, kind: 'manual' }
        ];
        assertEqual(deriveAnnualCloseEvidence({ targetYear: 2026, activeId: restored.rs_current_profile, scope: sample.scope,
            records: restored, snapshots: unrelated }).status, 'ready', origin + ': fremde Punkte lösen keine neue Klärung aus');

        const tranches = JSON.parse(env.storage.getItem('depot_tranchen'));
        tranches[0].price = Number(tranches[0].price || 100) + 3;
        const quoteRaw = JSON.stringify(tranches);
        env.storage.setItem('depot_tranchen', quoteRaw);
        // Auch die gespeicherte aktive Profilkopie wird real über den enumerierten Adapter geändert.
        const registry = JSON.parse(env.storage.getItem('rs_profiles_v1'));
        registry.profiles[sample.records.rs_current_profile].data.depot_tranchen = quoteRaw;
        env.storage.setItem('rs_profiles_v1', JSON.stringify(registry));
        await env.persistence.flush();
        const changed = await env.persistence.readPersistedRecords(), changedBytes = JSON.stringify(changed);
        assert(changed.depot_tranchen !== snapshot.records.depot_tranchen, origin + ': echter späterer depot_tranchen-Write');
        assertEqual(evidence(changed).status, 'legacy_confirmation_required', origin + ': Kurswrite löst Klärung aus');
        assertEqual(evidence(changed).allowOpenConfirmation, true, origin + ': markerloser Punkt erlaubt ehrliche Offen-Antwort');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), changedBytes, origin + ': Ableitung erhält Quellbytes');
        const archiveBytes = JSON.stringify([...env.snapshots]), batchCount = env.batches.length;
        let questions = 0, preparations = 0;
        const cancelled = env.create({ getLegacyDecision: async () => { questions++; return 'cancel'; },
            confirmAnnual: async () => { preparations++; return {}; } });
        assertEqual((await cancelled.reconcilePeriod()).status, 'legacy_confirmation_required', origin + ': Prüfung ohne clarify bleibt ungelöst');
        assertEqual(questions, 0, origin + ': Hintergrundprüfung öffnet keinen Dialog');
        assertEqual((await cancelled.close()).status, 'cancelled', origin + ': Klärungsabbruch beendet den Versuch');
        assertEqual(questions, 1, origin + ': ausdrückliche Aktion fragt genau einmal');
        assertEqual(preparations, 0, origin + ': Abbruch erreicht keine Vorbereitung');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), changedBytes, origin + ': Abbruch erhält Backend');
        assertEqual(JSON.stringify([...env.snapshots]), archiveBytes, origin + ': Abbruch erhält Archiv');
        assertEqual(env.batches.length, batchCount, origin + ': Abbruch übernimmt keine Metadaten');
        assertEqual(env.reports.length, origin === 'restore' ? 1 : 0, origin + ': Abbruch erzeugt keinen neuen Fehler');
        questions = 0;
        const service = env.create({ snapshotId: 'after-' + origin,
            getLegacyDecision: async () => { questions++; return 'not_committed'; },
            confirmAnnual: async () => { preparations++; return {}; } });
        assertEqual((await service.reconcilePeriod({ clarify: true })).status, 'ready', origin + ': Noch nicht abgeschlossen führt zur offenen Periode');
        const adopted = await env.persistence.readPersistedRecords(), adoptedState = JSON.parse(adopted[CONFIG.STORAGE.LS_KEY]);
        assertEqual(adoptedState.annualPeriodMetadata.lastCommittedPeriod, null, origin + ': Offenklärung behauptet keinen Erfolg');
        delete adoptedState.annualPeriodMetadata;
        assertEqual(JSON.stringify(adoptedState), changed[CONFIG.STORAGE.LS_KEY], origin + ': Offenklärung erhält Finanzfelder');
        for (const key of Object.keys(changed).filter(key => key !== CONFIG.STORAGE.LS_KEY))
            assertEqual(adopted[key], changed[key], origin + ': Offenklärung erhält Record ' + key);
        assertEqual((await service.close()).status, 'already_committed', origin + ': ehrlicher Wiederanlauf schließt regulär ab');
        assertEqual(questions, 1, origin + ': Offenübernahme und Abschluss fragen zusammen einmal');
        assertEqual(preparations, 1, origin + ': genau eine bestätigte Vorbereitung');
        const after = await env.persistence.readPersistedRecords();
        assertEqual(JSON.parse(after[CONFIG.STORAGE.LS_KEY]).lastState.cumulativeInflationFactor, 1 * 1.021, origin + ': Inflation genau einmal');
        assertEqual(JSON.parse(after.household_plan_v1).entries[sample.scope.key].values.floorBedarf, 30642, origin + ': Bedarf genau einmal fortgeschrieben');
        assertEqual(env.batches.filter(batch => batch.upserts.some(([key]) => key === 'annual_plan_record_v1')).length, 1, origin + ': genau ein Fachbatch');
        assertEqual((await env.create().close()).status, 'already_committed', origin + ': neue Instanz bleibt idempotent');
        assertEqual((await service.close()).status, 'already_committed', origin + ': weiterer Aufruf bleibt idempotent');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), JSON.stringify(after), origin + ': Wiederholung erhält Finanzbytes und Faktor');
        assertEqual(env.batches.filter(batch => batch.upserts.some(([key]) => key === 'annual_plan_record_v1')).length, 1, origin + ': Wiederholung erhält Batchanzahl');
    }
    // Echte Zieljahresteilmarker bleiben mit abweichendem UND bytegleichem Punkt gesperrt.
    for (const marker of ['needsAdjustedForInflationYear', 'lastInflationAppliedAtYear', 'annualMarketDataMeta']) {
        for (const identical of [false, true]) {
            const sample = legacySample(), state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
            state[marker] = marker === 'annualMarketDataMeta' ? { targetYear: 2026 } : 2027;
            sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
            const env = await annualServiceFixture({ sample });
            await createAnnualSnapshot({ storage: env.storage, archive: SnapshotArchive,
                profileId: sample.records.rs_current_profile, label: 'Teilanpassung', date: annualTestNow(),
                check: () => {}, snapshotId: 'partial-before' });
            if (!identical) { env.storage.setItem('profile_tagesgeld', '999'); await env.persistence.flush(); }
            const records = await env.persistence.readPersistedRecords(), before = JSON.stringify(records);
            const snapshot = await SnapshotArchive.readSnapshot('partial-before');
            const result = deriveAnnualCloseEvidence({ targetYear: 2026, activeId: records.rs_current_profile,
                scope: sample.scope, records, snapshots: [snapshot] });
            assertEqual(result.allowOpenConfirmation, false, marker + ': Vorabpunkt hebt Teilmarkersperre nicht auf');
            const batchCount = env.batches.length, archiveBytes = JSON.stringify([...env.snapshots]);
            let preparations = 0;
            assertEqual((await env.create({ getLegacyDecision: async () => 'not_committed',
                confirmAnnual: async () => { preparations++; return {}; } }).close()).status, 'legacy_confirmation_required',
                marker + ': Offen-Antwort bleibt unzulässig');
            assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), before, marker + ': keine Metadaten- oder Finanzänderung');
            assertEqual(env.batches.length, batchCount, marker + ': kein weiterer Batch');
            assertEqual(JSON.stringify([...env.snapshots]), archiveBytes, marker + ': kein zusätzlicher Snapshot');
            assertEqual(preparations, 0, marker + ': keine Vorbereitung');
        }
    }

    for (const activeYear of [2026, 2027]) {
        const sample = readyAnnualFixture(); sample.records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear, years: {} });
        const env = await annualServiceFixture({ sample });
        const result = await env.create().close();
        assertEqual(result.status, 'already_committed', `${activeYear}: Periode kommt aus dem Kalendervertrag`);
        assertEqual(JSON.parse(env.storage.getItem('balance_expenses_v1')).activeYear, 2027, 'Abschluss endet genau im Folgejahr');
        assertEqual(annualBatches(env).length, 1, 'Ein Fachbatch enthält den Planbeleg');
        const confirmed = bytes(env); await env.create().close();
        assertEqual(bytes(env), confirmed, 'Neue Instanz wiederholt keinen bestätigten Jahreswrite');
    }
    for (const fault of ['expenses-corrupt', 'expenses-version', 'expenses-year', 'person', 'scope', 'period', 'recovery', 'plan', 'engine']) {
        const sample = readyAnnualFixture();
        if (fault === 'expenses-corrupt') sample.records.balance_expenses_v1 = '{';
        if (fault === 'expenses-version') sample.records.balance_expenses_v1 = '{"version":99,"activeYear":2026,"years":{}}';
        if (fault === 'expenses-year') sample.records.balance_expenses_v1 = '{"version":1,"activeYear":2028,"years":{}}';
        if (fault === 'person') { sample.records.profile_geburtsdatum = ''; sample.records.profile_aktuelles_alter = ''; }
        if (fault === 'period' || fault === 'recovery') {
            const state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
            if (fault === 'period') state.annualPeriodMetadata.schemaVersion = 99;
            else state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'prior', phase: 'finalizing' };
            sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        }
        if (fault === 'plan') delete sample.records[HOUSEHOLD_PLAN_KEY];
        const env = await annualServiceFixture({ sample }), before = bytes(env);
        const overrides = fault === 'scope' ? { scope: { kind: 'single', ids: ['unknown'], key: 'unknown' } }
            : fault === 'engine' ? { engineLoader: { load: async () => { throw new Error('ENGINE_UNAVAILABLE'); } } } : {};
        const result = await env.create(overrides).close();
        assert(['invalid', 'incomplete_recovery'].includes(result.status), fault + ': ungültiger Start sichtbar abgewiesen');
        assertEqual(bytes(env), before, fault + ': vor Fachwrite bleiben sämtliche Backendbytes erhalten');
        assertEqual(env.snapshots.size, 0, fault + ': kein Snapshot bei ungültigen Quellen');
        assertEqual(env.reports.length, 1, fault + ': echter Startfehler wird genau einmal gemeldet');
    }
    // Ohne Abschlussindiz entfällt die pauschale Legacyfrage vollständig.
    {
        const sample = readyAnnualFixture(), state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
        delete state.annualPeriodMetadata; state.wealthHistory = { schemaVersion: 1, entries: [] };
        sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        const registry = JSON.parse(sample.records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) profile.data[CONFIG.STORAGE.LS_KEY] = sample.records[CONFIG.STORAGE.LS_KEY];
        sample.records.rs_profiles_v1 = JSON.stringify(registry);
        const env = await annualServiceFixture({ sample });
        let questions = 0;
        const result = await env.create({ getLegacyDecision: async () => { questions++; return 'cancel'; } }).close();
        assertEqual(result.status, 'already_committed', 'Unmarkierter offener Altbestand schließt normal ab');
        assertEqual(questions, 0, 'Kein pauschales Jahresperiodenpopup');
        assertEqual(annualBatches(env).length, 1, 'Genau ein Fachbatch bei sicher offener Altperiode');
    }
    // Abbruch während Bestätigung, Vorflush, Snapshotwrite/readback: kein Fachwrite.
    for (const barrier of ['confirmation', 'legacy', 'flush', 'snapshot-write', 'snapshot-read']) {
        const reached = deferred(), gate = deferred();
        const wait = async () => { reached.resolve(); await gate.promise; };
        const faults = { ...(barrier === 'snapshot-write' ? { snapshotWrite: wait } : {}),
            ...(barrier === 'snapshot-read' ? { snapshotRead: async snapshot => { await wait(); return snapshot; } } : {}) };
        // snapshotRead ist synchroner Transformanschluss im Fixture; hier explizit asynchron am Archiv.
        delete faults.snapshotRead;
        const sample = readyAnnualFixture();
        if (barrier === 'legacy') { const state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]); delete state.annualPeriodMetadata; state.ageAdjustedForInflation = 67; sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); }
        const env = await annualServiceFixture({ sample, faults });
        const guard = createNavigationGuard({ decide: async () => true });
        const lifecycle = createAnnualNavigationLifecycle({ guard });
        const archive = barrier === 'snapshot-read' ? { ...SnapshotArchive, readSnapshot: async id => { await wait(); return SnapshotArchive.readSnapshot(id); } } : SnapshotArchive;
        const service = env.create({ navigationLifecycle: lifecycle, archive,
            ...(barrier === 'confirmation' ? { confirmAnnual: async () => { await wait(); return {}; } } : {}),
            ...(barrier === 'legacy' ? { getLegacyDecision: async () => { await wait(); return 'not_committed'; } } : {}),
            ...(barrier === 'flush' ? { flushLiveState: wait } : {}) });
        const running = service.close(); await reached.promise;
        const navigation = guard.prepare();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        assertEqual(lifecycle.read().phase, 'cancelling', barrier + ': Vorbereitung kündigbar');
        assertEqual((await service.close()).status, 'in_flight', barrier + ': Abbruchende sperrt Doppelklick');
        gate.resolve();
        assertEqual((await running).status, 'cancelled', barrier + ': Abbruch bestätigt keinen Abschluss');
        assertEqual(env.reports.length, 0, barrier + ': bewusster Abbruch meldet keinen Jahresfehler');
        const attempt = await navigation;
        assert(Boolean(attempt), barrier + ': Navigation erst nach vollständigem Handlerende'); guard.end(attempt);
        assertEqual(annualBatches(env).length, 0, barrier + ': kein verspäteter Fachbatch');
        assertEqual(bytes(env), JSON.stringify(sample.records), barrier + ': ursprüngliche Fachrecords bytegleich');
    }
    {
        const env = await annualServiceFixture(), before = bytes(env);
        const result = await env.create({ confirmAnnual: async ({ cancel, signal }) => {
            cancel();
            assert(signal.aborted, 'Dialogabbruch kündigt die Jahresvorbereitung');
            return null;
        } }).close();
        assertEqual(result.status, 'cancelled', 'Cancelcallback beendet den Lauf als bewussten Abbruch');
        assertEqual(env.reports.length, 0, 'Cancelcallback meldet keinen Jahresfehler');
        assertEqual(bytes(env), before, 'Cancelcallback erhält die ursprünglichen Fachrecords');
        assertEqual(env.snapshots.size, 0, 'Cancelcallback beginnt keinen Snapshot');
    }
    // Jede produktive Commitphase hält Navigation, Abbruch und Restore bis zum Handlerende gesperrt.
    for (const annualPhase of ['snapshot_confirmed', 'writes_started', 'validating', 'finalizing']) {
        const reached = deferred(), gate = deferred();
        const env = await annualServiceFixture({ faults: { write: async batch => {
            const raw = batch.upserts.find(([key]) => key === CONFIG.STORAGE.LS_KEY)?.[1];
            const matches = annualPhase === 'finalizing'
                ? batch.upserts.some(([key]) => key === 'annual_plan_record_v1')
                : raw && JSON.parse(raw).annualPeriodMetadata?.pendingCommit?.phase === annualPhase;
            if (matches) { reached.resolve(); await gate.promise; }
        } } });
        let decisions = 0, restores = 0, reloads = 0;
        const guard = createNavigationGuard({ decide: async () => { decisions++; return true; } });
        const lifecycle = createAnnualNavigationLifecycle({ guard });
        const service = env.create({ navigationLifecycle: lifecycle,
            confirmRestore: async () => { decisions++; return true; },
            restoreSnapshot: async () => { restores++; return { status: 'restored' }; } });
        const running = service.close();
        await reached.promise;
        try {
            const state = lifecycle.read(), before = bytes(env);
            assertEqual(state.phase, 'commit', annualPhase + ': produktiver Lauf besitzt die Commitsperre');
            assertEqual(state.annualPhase, annualPhase, annualPhase + ': Sperre nennt die aktuelle Jahresphase');
            assertEqual(await guard.prepare(), null, annualPhase + ': Navigation erhält keinen Handoff');
            assertEqual(await guard.prepare({ intent: 'close' }), null, annualPhase + ': Schließen kann den Commit nicht abbrechen');
            assertEqual(decisions, 0, annualPhase + ': Commit stellt keine Abbruchentscheidung');
            let prevented = 0;
            const event = { preventDefault() { prevented++; } };
            guard.beforeUnload(event);
            assertEqual(prevented, 1, annualPhase + ': beforeUnload schützt den aktiven Commit');
            assertEqual(event.returnValue, '', annualPhase + ': beforeUnload fordert die native Entscheidung an');
            assertEqual((await service.close()).status, 'in_flight', annualPhase + ': zweiter Abschluss bleibt gesperrt');
            assertEqual((await service.retryAnnualWithManualPrice({ profileId: env.storage.getItem('rs_current_profile'),
                targetYear: 2026, periodId: 'calendar-year:2026', snapshotId: 'annual-before', instrument: 'VWCE.DE' }, 160.4)).status,
                'in_flight', annualPhase + ': Handkursrestore bleibt beim aktiven Jahresbesitzer gesperrt');
            assertEqual(await guard.reload({ mutate: async () => { restores++; }, reload: () => { reloads++; } }), false,
                annualPhase + ': geschützter Snapshotrestore erhält keine Navigationserlaubnis');
            assertEqual(decisions + restores + reloads, 0, annualPhase + ': kein Dialog, Restorewrite oder Reload');
            assertEqual(bytes(env), before, annualPhase + ': gesperrte Versuche verändern keine Backendbytes');
            assertEqual(lifecycle.read().annualPhase, annualPhase, annualPhase + ': Abbruchversuche erhalten den Besitzer');
        } finally { gate.resolve(); }
        assertEqual((await running).status, 'already_committed', annualPhase + ': nach Freigabe regulärer Abschluss');
        assertEqual(annualBatches(env).length, 1, annualPhase + ': genau ein bestätigter Fachbatch');
        assertEqual(lifecycle.read().phase, 'idle', annualPhase + ': Handlerende gibt den Besitzer frei');
    }
    for (const fault of ['preflush', 'snapshot-write', 'snapshot-read', 'snapshot_confirmed', 'writes_started', 'validating', 'finalizing', 'ui']) {
        let armed = true;
        const env = await annualServiceFixture({ faults: {
            snapshotWrite: fault === 'snapshot-write' ? async () => { throw new Error(fault); } : undefined,
            snapshotRead: fault === 'snapshot-read' ? point => ({ ...point, records: { ...point.records, profile_tagesgeld: '1' } }) : undefined,
            write: async batch => {
                const raw = batch.upserts.find(([key]) => key === CONFIG.STORAGE.LS_KEY)?.[1];
                if (armed && raw && JSON.parse(raw).annualPeriodMetadata?.pendingCommit?.phase === fault) { armed = false; throw new Error(fault); }
                if (armed && fault === 'finalizing' && batch.upserts.some(([key]) => key === 'annual_plan_record_v1')) { armed = false; throw new Error(fault); }
            }
        } });
        const before = bytes(env);
        const service = env.create({ ...(fault === 'preflush' ? { flushLiveState: async () => { throw new Error(fault); } } : {}),
            ...(fault === 'ui' ? { projectAnnualState: () => { throw new Error(fault); } } : {}) });
        const result = await service.close();
        assertEqual(env.reports.length, 1, fault + ': echter Fehler wird genau einmal gemeldet');
        const beforeMutation = ['preflush', 'snapshot-write', 'snapshot-read'].includes(fault);
        assertEqual(result.status, fault === 'ui' ? 'already_committed' : beforeMutation ? 'invalid' : 'incomplete_recovery', fault + ': richtige Abschluss-/Recoverygrenze');
        if (beforeMutation) assertEqual(bytes(env), before, fault + ': keine Mutation');
        else if (fault === 'ui') {
            assertEqual(phase(env), undefined, 'UIfehler bewahrt finalisierte Metadaten');
            await service.close(); assertEqual(annualBatches(env).length, 1, 'UIfehler erlaubt keinen zweiten Jahresbatch');
        } else {
            assertEqual(JSON.parse(env.storage.getItem(CONFIG.STORAGE.LS_KEY)).annualPeriodMetadata.pendingCommit.snapshotId, 'annual-before', fault + ': ursprünglicher Recoverypunkt bleibt gebunden');
            if (fault !== 'finalizing') assertEqual(phase(env), fault, 'Fehlerhafte Pendingphase bleibt für Recovery erkennbar');
            const snapshot = await SnapshotArchive.readSnapshot('annual-before');
            const restore = buildSnapshotRestorePlan(snapshot, await env.persistence.readPersistedRecords());
            await env.persistence.replaceRecordsTransactional(restore.records, { allowKey: restore.allowKey });
            assertEqual(bytes(env), before, fault + ': Restore stellt alle H3-Fachrecords bytegleich wieder her');
        }
    }
    // Startseitendienst: echter Restore, Reloadcallback, Einmaltoken, derselbe Recoverypunkt.
    for (const fault of ['none', 'session', 'reload', 'decline']) {
        const env = await annualServiceFixture();
        const values = new Map(); let failed = true, reloads = 0, restores = 0;
        const session = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key),
            setItem(key, value) { if (fault === 'session') throw new Error('SESSION_UNAVAILABLE'); values.set(key, value); } };
        const prepareMarketData = options => prepareAnnualMarketData({ ...options, now: annualTestNow, readers: {
            prepareInflation: async () => annualTestMarketData.inflation,
            prepareCape: async () => annualTestMarketData.cape,
            prepareETF: async () => { if (failed) throw new Error('ETF_FAILURE'); return annualTestMarketData.etf; }
        } });
        const service = env.create({ prepareMarketData, sessionStore: () => session, confirmRestore: async () => fault !== 'decline',
            restoreSnapshot: async (id, options) => {
                const restore = buildSnapshotRestorePlan(await SnapshotArchive.readSnapshot(id), await env.persistence.readPersistedRecords());
                await env.persistence.replaceRecordsTransactional(restore.records, { allowKey: restore.allowKey }); restores++;
                await options.reload(); return { status: 'restored' };
            }, reload: () => { reloads++; return fault !== 'reload'; } });
        const failedResult = await service.close();
        assertEqual(failedResult.status, 'incomplete_recovery', 'ETF-Ausfall bewahrt Recovery');
        const result = await service.retryAnnualWithManualPrice(failedResult.retryContext, 160.4);
        assertEqual(result.status, fault === 'none' ? 'restored' : fault === 'decline' ? 'cancelled' : 'invalid', fault + ': Restore/Reloadfehler sichtbar');
        if (fault !== 'none') {
            assertEqual(session.getItem(ANNUAL_RETRY_SESSION_KEY), null, fault + ': kein unbrauchbarer Reloadauftrag');
            assertEqual(annualBatches(env).length, 0, fault + ': kein Fachwrite');
            if (fault === 'session' || fault === 'decline') assertEqual(restores, 0, fault + ': vor Restore abgewiesen');
            continue;
        }
        assertEqual(reloads, 1, 'Wiederaufnahme lädt dieselbe Seite genau einmal');
        const request = consumeAnnualRetry(session, annualTestNow().getTime());
        assertEqual(consumeAnnualRetry(session, annualTestNow().getTime()), null, 'Auftrag synchron genau einmal konsumiert');
        const validation = { storage: env.storage, archive: SnapshotArchive, getReferenceDate: annualTestNow, now: annualTestNow().getTime() };
        assert(await validateAnnualRetry(request, validation), 'Vollständig bestätigter Restore erlaubt Retry');
        for (const [key, bad] of [['profileId', 'wrong'], ['instrument', 'wrong'], ['targetYear', 2025], ['periodId', 'calendar-year:2025'], ['token', 'manipulated'], ['snapshotId', 'wrong'], ['createdAt', 0], ['price', -1]]) {
            const original = request[key]; request[key] = bad;
            assert(!await validateAnnualRetry(request, validation), key + ': manipulierte Wiederaufnahme abgewiesen'); request[key] = original;
        }
        assert(!await validateAnnualRetry(request, { ...validation, now: annualTestNow().getTime() + 300001 }), 'Abgelaufene Wiederaufnahme abgewiesen');
        const resumed = await service.close({ resume: request, confirmedPreparation: {} });
        assertEqual(resumed.status, 'already_committed', 'Handkurs schließt dieselbe Periode nach Restore ab');
        assertEqual(env.snapshots.size, 1, 'Retry nutzt denselben ursprünglichen Snapshot');
        assertEqual(annualBatches(env).length, 1, 'Retry erzeugt genau einen Fachbatch');
        assert(!await validateAnnualRetry(request, validation), 'Verwendeter Token ist ungültig');
        await service.close({ resume: request }); assertEqual(annualBatches(env).length, 1, 'Erneut verwendeter Token startet keinen Fachwrite');
    }
} finally { PersistenceFacade.resetPersistenceRuntimeForTests(); }
