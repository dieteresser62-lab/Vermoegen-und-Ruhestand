import { deriveAnnualCloseEvidence, createAnnualCloseArchiveReader } from '../app/shared/annual-close-evidence.js';
import { planScope } from '../app/profile/household-plan.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { readyAnnualFixture, annualServiceFixture, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { createAnnualWealthHistoryEntry, createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { createAnnualSnapshot, consumeAnnualRetry, validateAnnualRetry, ANNUAL_RETRY_SESSION_KEY } from '../app/shared/annual-coordinator.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { projectOverview, projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { buildSnapshotRestorePlan } from '../app/shared/snapshot-restore.js';

const amounts = { tagesgeld: 100, geldmarktEtf: 200, depotwertAlt: 300, depotwertNeu: 400 };
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
const project = (sample, snapshots = []) => deriveAnnualCloseEvidence({ targetYear: 2026, scope: sample.scope,
    activeId: sample.records.rs_current_profile, records: sample.records, snapshots });
const change = (sample, patch) => {
    const state = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]); patch(state);
    sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
};
for (const marker of ['ageAdjustedForInflation', 'lastInflationAppliedAtAge', 'cumulativeInflationFactor', 'needsAdjustedForInflationYear', 'lastInflationAppliedAtYear', 'annualMarketDataMeta']) {
    const sample = legacySample();
    change(sample, state => {
        if (marker === 'lastInflationAppliedAtAge') state.lastState[marker] = 67;
        else if (marker === 'cumulativeInflationFactor') state.lastState[marker] = 1.02;
        else state[marker] = marker === 'ageAdjustedForInflation' ? 67 : marker === 'annualMarketDataMeta' ? { targetYear: 2026 } : 2027;
    });
    const before = JSON.stringify(sample.records);
    assertEqual(project(sample).status, 'legacy_confirmation_required', marker + ': echter alter oder teilweiser Marker braucht Klärung');
    assertEqual(project(sample).allowOpenConfirmation, ['ageAdjustedForInflation', 'lastInflationAppliedAtAge', 'cumulativeInflationFactor'].includes(marker),
        marker + ': nur undatierte Altmarker erlauben die Antwort noch offen');
    assertEqual(JSON.stringify(sample.records), before, marker + ': Ableitung verändert keine Finanzquellen');
}
{
    const sample = legacySample();
    assertEqual(project(sample).status, 'ready', 'Echter metadatenloser Altbestand ohne Indiz ist offen');
    assertEqual(project(sample, [{ kind: 'annual-close-pre-mutation', activeProfileId: sample.records.rs_current_profile, createdAt: annualTestNow().toISOString() }]).status,
        'legacy_confirmation_required', 'Ein isolierter Vorabpunkt ist kein Jahreserfolg');
    change(sample, state => { state.wealthHistory.entries = [createManualWealthHistoryEntry(amounts, '2026-12-31'), createAnnualWealthHistoryEntry(amounts, 2025 + 2)]; });
    assertEqual(project(sample).status, 'ready', 'Manuelle Stände und fremde Jahre zählen nicht');
    change(sample, state => { state.wealthHistory.entries = [createAnnualWealthHistoryEntry(amounts, 2026)]; });
    assertEqual(project(sample).status, 'already_committed', 'Passender validierter Jahresverlauf belegt den Abschluss');
    assertEqual(project(sample).committedAt, null, 'Stichtag erfindet keinen Abschlusszeitpunkt');
    change(sample, state => { state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
        pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'pending' } }; });
    assertEqual(project(sample).status, 'incomplete_recovery', 'Pending bleibt trotz Jahresverlauf vorrangig');
}
const archiveDeferred = () => {
    let resolve;
    return { promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
};
{
    const sample = legacySample(), context = { targetYear: 2026, activeId: sample.records.rs_current_profile, scope: sample.scope };
    const snapshot = SnapshotArchive.buildSnapshot({ id: 'read-only-before', kind: 'annual-close-pre-mutation',
        createdAt: annualTestNow().toISOString(), activeProfileId: context.activeId,
        records: SnapshotArchive.captureCurrentRecords({ keys: Object.keys(sample.records), getItem: key => sample.records[key] }) });
    const index = SnapshotArchive.toSnapshotIndexEntry(snapshot), reads = [];
    const others = [{ ...index, id: 'foreign-profile', activeProfileId: 'outside' },
        { ...index, id: 'foreign-year', createdAt: '2026-01-02T12:00:00Z' },
        { ...index, id: 'foreign-kind', kind: 'manual' }];
    const original = JSON.stringify(sample.records);
    let writes = 0;
    const archive = { listSnapshots: async () => [index, ...others],
        readSnapshot: async id => { reads.push(id); return structuredClone(snapshot); },
        createSnapshot: async () => { writes++; }, writeSnapshot: async () => { writes++; },
        deleteSnapshot: async () => { writes++; } };
    const reader = createAnnualCloseArchiveReader({ archive });
    assertEqual(reader.read(context).status, 'loading', 'Unbestätigte Archivlesung ist noch nicht freigegeben');
    assertEqual(reader.read(context).snapshots.length, 0, 'Loading liefert keine vermeintlich bestätigte Evidence');
    assertEqual(reads.length, 0, 'Synchrone Projektion startet keine automatische Refreshschleife');
    const loaded = await reader.refresh(context);
    assertEqual(loaded.status, 'loaded', 'Passende Archivlesung wird ausdrücklich bestätigt');
    assertEqual(JSON.stringify(reads), JSON.stringify([snapshot.id]), 'Nur Payloads passender Profil-, Jahres- und Artpunkte werden gelesen');
    assert(loaded.snapshots[0].records, 'Bestätigte Lesung enthält Payload statt bloßem Index');
    assertEqual(deriveAnnualCloseEvidence({ ...context, records: sample.records, snapshots: loaded.snapshots }).status,
        'ready', 'Bytegleicher markerloser Payload bestätigt nur den offenen Vorabstand');
    const live = { ...sample.records, depot_tranchen: sample.records.depot_tranchen + ' ' };
    assertEqual(deriveAnnualCloseEvidence({ ...context, records: live, snapshots: reader.read(context).snapshots }).status,
        'legacy_confirmation_required', 'Frische Finanzrecords werden trotz unveränderter Archivlesung neu klassifiziert');
    for (const projection of [projectOverview, projectOverviewFromRecords]) {
        const view = projection({ registry: JSON.parse(live.rs_profiles_v1), activeId: context.activeId,
            liveData: live, now: annualTestNow(), snapshots: loaded.snapshots });
        assertEqual(view.occasion.annualState, 'unclear', 'Echter Snapshot plus Kurswrite projiziert sichtbare Jahresklärung');
    }

    assertEqual(deriveAnnualCloseEvidence({ ...context, records: live, snapshots: others }).status,
        'ready', 'Fremdes Profil, Jahr und Snapshotkind erzeugen keine Vorabpunktklärung');
    const copied = reader.read(context); copied.snapshots[0].records.profile_tagesgeld = '999';
    assertEqual(reader.read(context).snapshots[0].records.profile_tagesgeld, snapshot.records.profile_tagesgeld,
        'Projektion kann bestätigte Archivdaten nicht verändern');
    assertEqual(writes, 0, 'Lesen und Projektion schreiben oder löschen keine Archivpunkte');
    assertEqual(JSON.stringify(sample.records), original, 'Lesender Archivanschluss erhält sämtliche Quellbytes');

    for (const fault of ['index', 'payload', 'missing', 'profile', 'year', 'kind', 'records']) {
        let broken = true;
        const faulty = createAnnualCloseArchiveReader({ archive: {
            listSnapshots: async () => { if (broken && fault === 'index') throw new Error('INDEX_FAILURE'); return [index]; },
            readSnapshot: async () => {
                if (!broken) return snapshot;
                if (fault === 'payload') throw new Error('PAYLOAD_FAILURE');
                if (fault === 'missing') return null;
                if (fault === 'records') return { ...snapshot, records: null };
                return { ...snapshot, ...(fault === 'profile' ? { activeProfileId: 'outside' }
                    : fault === 'year' ? { createdAt: '2026-01-02T12:00:00Z' } : { kind: 'manual' }) };
            }
        } });
        const failed = await faulty.refresh(context);
        assertEqual(failed.status, 'error', fault + ': fehlende oder widersprüchliche Payloads sind keine leere Freigabe');
        assertEqual(failed.snapshots.length, 0, fault + ': Fehler liefert keine bestätigten Snapshots');
        assert(failed.error, fault + ': Archivfehler bleibt sichtbar');
        assertEqual(faulty.read(context).status, 'error', fault + ': synchrone Projektion erhält den Fehlerstatus');
        broken = false;
        assertEqual((await faulty.refresh(context)).status, 'loaded', fault + ': ausdrücklicher neuer Versuch kann erfolgreich lesen');
    }
    for (const stage of ['index', 'payload']) {
        for (const changed of ['profile', 'scope', 'year']) {
            const reached = archiveDeferred(), gate = archiveDeferred();
            let held = true;
            const wait = async () => { if (held) { held = false; reached.resolve(); await gate.promise; } };
            const delayed = createAnnualCloseArchiveReader({ archive: {
                listSnapshots: async () => { if (stage === 'index') await wait(); return [index]; },
                readSnapshot: async () => { if (stage === 'payload') await wait(); return snapshot; }
            } });
            const waiting = delayed.refresh(context);
            await reached.promise;
            assertEqual(delayed.read(context).status, 'loading', stage + ': ausstehende Lesung sperrt Freigabe');
            const next = { ...context, ...(changed === 'profile' ? { activeId: 'outside' }
                : changed === 'year' ? { targetYear: 2025 } : { scope: planScope('single', [context.activeId]) }) };
            assertEqual(delayed.read(next).status, 'loading', changed + ': Kontextwechsel verwirft alte Freigabe sofort');
            gate.resolve();
            const stale = await waiting;
            assertEqual(stale.status, 'stale', stage + '/' + changed + ': verspätete Antwort wird verworfen');
            assertEqual(stale.snapshots.length, 0, stage + '/' + changed + ': kein fremder Jahresstatus');
            assertEqual(delayed.read(next).status, 'loading', stage + '/' + changed + ': altes Resultat bestätigt neuen Kontext nicht');
            assertEqual((await delayed.refresh(next)).status, 'loaded', stage + '/' + changed + ': aktueller Kontext kann neu lesen');
            assertEqual((await delayed.refresh(context)).status, 'loaded', stage + '/' + changed + ': passende erneute Lesung funktioniert');
        }
    }
    {
        const gate = archiveDeferred(), reached = archiveDeferred();
        let first = true;
        const delayed = createAnnualCloseArchiveReader({ archive: {
            listSnapshots: async () => { if (first) { first = false; reached.resolve(); await gate.promise; } return [index]; },
            readSnapshot: async () => snapshot
        } });
        const older = delayed.refresh(context); await reached.promise;
        assertEqual((await delayed.refresh(context)).status, 'loaded', 'Neuere Lesung desselben Kontextes bestätigt Evidence');
        gate.resolve();
        assertEqual((await older).status, 'stale', 'Überholte Lesung desselben Kontextes darf neuere Bestätigung nicht ersetzen');
        assertEqual(delayed.read(context).status, 'loaded', 'Aktuell bestätigte Lesung bleibt nach verspäteter Antwort erhalten');
    }
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

    // Eine ehrliche Offen-Antwort muss bis zum echten Fachwrite führen, auch über
    // die getrennte Belegprüfung und Vorbereitung der Seitenbinder hinweg.
    {
        const sample = legacySample();
        change(sample, state => {
            state.lastState.cumulativeInflationFactor = 1.10;
            state.lastState.lastInflationAppliedAtAge = 66;
            state.ageAdjustedForInflation = 66;
            state.lastInflationAppliedAtYear = 2026;
            state.needsAdjustedForInflationYear = 2026;
        });
        const env = await annualServiceFixture({ sample });
        let questions = 0;
        const service = env.create({ getLegacyDecision: async () => { questions++; return 'not_committed'; } });
        assertEqual((await service.reconcilePeriod({ clarify: true })).status, 'ready', 'Vorjahresmarker: noch offen führt zur normalen Vorbereitung');
        const open = await env.persistence.readPersistedRecords();
        const clarified = JSON.parse(open[CONFIG.STORAGE.LS_KEY]);
        assertEqual(clarified.annualPeriodMetadata.lastCommittedPeriod, null, 'Offenklärung behauptet keinen Abschluss');
        delete clarified.annualPeriodMetadata;
        assertEqual(JSON.stringify(clarified), sample.records[CONFIG.STORAGE.LS_KEY], 'Offenklärung bewahrt sämtliche Finanzfelder');
        for (const key of Object.keys(sample.records).filter(key => key !== CONFIG.STORAGE.LS_KEY))
            assertEqual(open[key], sample.records[key], key + ': Offenklärung bewahrt Rohbytes');
        assertEqual(env.snapshots.size, 0, 'Offenklärung erzeugt keinen Snapshot');
        assertEqual((await service.close()).status, 'already_committed', 'Vorjahresfaktor erlaubt echten Abschluss 2026');
        assertEqual(questions, 1, 'Seitenvorprüfung und Abschluss fragen zusammen genau einmal');
        const after = await env.persistence.readPersistedRecords();
        assertEqual(JSON.parse(after[CONFIG.STORAGE.LS_KEY]).lastState.cumulativeInflationFactor, 1.10 * 1.021,
            'Vorjahresfaktor wird genau einmal mit der neuen Inflation fortgeschrieben');
        assertEqual(JSON.parse(after.household_plan_v1).entries[sample.scope.key].values.floorBedarf, 30642,
            'Bedarfsplan erhält die Zieljahresinflation genau einmal');
        assertEqual(env.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, 'Vorjahresmarker: genau ein Fachbatch');
        assertEqual((await env.create().close()).status, 'already_committed', 'Reload wiederholt den geklärten Jahresabschluss nicht');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), JSON.stringify(after), 'Wiederholung erhält Inflation und Finanzbytes');
    }
    for (const marker of ['needsAdjustedForInflationYear', 'lastInflationAppliedAtYear', 'annualMarketDataMeta']) {
        const sample = legacySample();
        change(sample, state => { state[marker] = marker === 'annualMarketDataMeta' ? { targetYear: 2026 } : 2027; });
        const env = await annualServiceFixture({ sample }), before = JSON.stringify(await env.persistence.readPersistedRecords());
        const service = env.create({ getLegacyDecision: async () => 'not_committed' });
        assertEqual((await service.close()).status, 'legacy_confirmation_required', marker + ': echte Zieljahresteilanpassung bleibt trotz Offen-Antwort gesperrt');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), before, marker + ': Sperre erhält Finanzbytes und fehlende Metadaten');
        assertEqual(env.batches.length + env.snapshots.size, 0, marker + ': kein Write und kein neuer Punkt');
    }
    {
        const sample = legacySample(); change(sample, state => { state.lastState.cumulativeInflationFactor = 1.10; });
        const env = await annualServiceFixture({ sample });
        assertEqual((await env.create({ getLegacyDecision: async () => 'cancel' }).close()).status, 'cancelled', 'Abbrechen der Klärung startet keine Vorbereitung');
        assertEqual(env.batches.length + env.snapshots.size + env.reports.length, 0, 'Klärungsabbruch schreibt und meldet keinen Fehler');
    }
    // Abruffehler ohne ETF-Retry: normaler Jahresknopf nach echtem H3-Restore.
    {
        const env = await annualServiceFixture({ sample: legacySample() });
        const failed = await env.create({ prepareMarketData: async () => { throw new Error('FETCH_INJECTED'); } }).close();
        assertEqual(failed.status, 'incomplete_recovery', 'Abruffehler beginnt echte Jahres-Recovery');
        assertEqual(failed.retryContext, null, 'Abruffehler hat keinen Handkurs-Retrykontext');
        const snapshot = await SnapshotArchive.readSnapshot(failed.recovery.snapshotId);
        assertEqual(JSON.parse(snapshot.records[CONFIG.STORAGE.LS_KEY]).annualPeriodMetadata, undefined, 'Vorabpunkt enthält den ursprünglichen metadatenlosen Stand');
        const live = await env.persistence.readPersistedRecords();
        const records = { ...live, ...snapshot.records };
        const restored = buildSnapshotRestorePlan(snapshot, live);
        await env.persistence.replaceRecordsTransactional(restored.records, { allowKey: restored.allowKey });
        const restoredRecords = await env.persistence.readPersistedRecords();
        assertEqual(Object.keys(restoredRecords).length, Object.keys(records).length, 'H3-Restore erhält den vollständigen Schlüsselumfang');
        for (const [key, value] of Object.entries(records)) assertEqual(restoredRecords[key], value, key + ': H3-Restore lädt den vollständigen Vorabstand');
        assertEqual(env.snapshots.size, 1, 'Vorabpunkt bleibt nach Rückladen archiviert');
        const quoteRecords = structuredClone(restoredRecords), quoteRegistry = JSON.parse(quoteRecords.rs_profiles_v1);
        const tranches = JSON.parse(quoteRecords.depot_tranchen);
        tranches[0].currentPrice += 1; tranches[0].asOf = Math.floor(annualTestNow().getTime() / 1000);
        quoteRecords.depot_tranchen = JSON.stringify(tranches);
        quoteRegistry.profiles[quoteRecords.rs_current_profile].data.depot_tranchen = quoteRecords.depot_tranchen;
        quoteRecords.rs_profiles_v1 = JSON.stringify(quoteRegistry);
        await env.persistence.replaceRecordsTransactional({ depot_tranchen: quoteRecords.depot_tranchen, rs_profiles_v1: quoteRecords.rs_profiles_v1 },
            { allowKey: key => ['depot_tranchen', 'rs_profiles_v1'].includes(key) });
        const quoted = await env.persistence.readPersistedRecords();
        for (const projection of [projectOverview, projectOverviewFromRecords]) {
            assertEqual(projection({ registry: JSON.parse(quoted.rs_profiles_v1), activeId: quoted.rs_current_profile,
                liveData: quoted, now: annualTestNow(), snapshots: [snapshot] }).occasion.annualState,
                'unclear', 'Vollständiger H3-Restore plus bestätigter Kurs-/Registrywrite projiziert Jahresklärung');
        }
        await env.persistence.replaceRecordsTransactional(restored.records, { allowKey: restored.allowKey });

        assertEqual(project({ records: snapshot.records, scope: legacySample().scope }, [snapshot]).status, 'ready', 'Quellgleicher Vorabpunkt sperrt offenen Stand nicht');
        const older = { ...snapshot, id: 'older-point', records: { ...snapshot.records, profile_tagesgeld: '888' } };
        assertEqual(project({ records: snapshot.records, scope: legacySample().scope }, [older, snapshot]).status, 'ready', 'Ältere abweichende Archivpunkte verklemmen den bestätigten Vorabstand nicht');
        let questions = 0;
        const service = env.create({ snapshotId: 'after-recovery', getLegacyDecision: async () => { questions++; return 'cancel'; } });
        assertEqual((await service.close()).status, 'already_committed', 'Normaler Jahresknopf funktioniert nach Restore ohne Falschantwort');
        assertEqual(questions, 0, 'Zurückgeladener offener Vorabstand braucht keine Abschlussbehauptung');
        const after = JSON.stringify(await env.persistence.readPersistedRecords());
        assertEqual(JSON.parse(env.storage.getItem(CONFIG.STORAGE.LS_KEY)).lastState.cumulativeInflationFactor, 1.021, 'Recovery-Neustart wendet Inflation einmal an');
        assertEqual(env.batches.filter(batch => batch.upserts.some(([key]) => key === ANNUAL_PLAN_RECORD_KEY)).length, 1, 'Recovery-Neustart schreibt genau einen Fachbatch');
        await env.create().close();
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), after, 'Recovery-Neustart bleibt auch nach Reload idempotent');
        const changed = { ...snapshot.records, profile_tagesgeld: '777' };
        assertEqual(project({ records: changed, scope: legacySample().scope }, [snapshot]).allowOpenConfirmation, true, 'Abweichender markerloser Quellsatz erlaubt ausdrückliche Offenklärung, keinen stillen Restorenachweis');
        const partial = { ...snapshot.records, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ ...JSON.parse(snapshot.records[CONFIG.STORAGE.LS_KEY]), lastInflationAppliedAtYear: 2027 }) };
        assertEqual(project({ records: partial, scope: legacySample().scope }, [{ ...snapshot, records: partial }]).allowOpenConfirmation, false, 'Selbst ein quellgleicher Punkt erlaubt keine doppelte Zieljahresanpassung');
    }
    for (const marked of [false, true]) {
        const sample = legacySample(), registry = JSON.parse(sample.records.rs_profiles_v1);
        const activeState = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]);
        if (marked) activeState.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
        sample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(activeState);
        const otherId = sample.scope.ids.find(id => id !== sample.records.rs_current_profile);
        const pendingState = JSON.parse(registry.profiles[otherId].data[CONFIG.STORAGE.LS_KEY]);
        pendingState.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null,
            pendingCommit: { periodId: 'calendar-year:2026', phase: 'writes_started', snapshotId: 'other-member-before' } };
        registry.profiles[otherId].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(pendingState);
        sample.records.rs_profiles_v1 = JSON.stringify(registry);
        const env = await annualServiceFixture({ sample }), before = JSON.stringify(await env.persistence.readPersistedRecords());
        let preparations = 0;
        const service = env.create({ getPlanningStatus: () => projectOverview({ registry: JSON.parse(env.storage.getItem('rs_profiles_v1')),
            activeId: sample.records.rs_current_profile, liveData: env.persistence.exportAllSync().records, now: annualTestNow() }),
            confirmAnnual: async () => { preparations++; return {}; } });
        assertEqual((await service.reconcilePeriod()).status, 'incomplete_recovery', 'Pending eines anderen Haushaltsmitglieds hat vor lokalen Metadaten Vorrang');
        const result = await service.close();
        assertEqual(result.status, 'incomplete_recovery', 'Fremder Pendingstand startet weder Anpassung noch Jahreswrite');
        assertEqual(result.recovery.snapshotId, 'other-member-before', 'Vorhandener Recoverypunkt bleibt auch ohne lokalen Pendingmarker das Ladenziel');
        assertEqual(preparations + env.batches.length + env.snapshots.size, 0, 'Pending verhindert Vorbereitung, Übernahme und Vorabpunkt');
        assertEqual(JSON.stringify(await env.persistence.readPersistedRecords()), before, 'Pendingprüfung bewahrt sämtliche Finanzbytes');
    }
    const source = await annualServiceFixture(); await source.create().close();
    const committed = await source.persistence.readPersistedRecords();
    const sample = legacySample(); sample.records[ANNUAL_PLAN_RECORD_KEY] = committed[ANNUAL_PLAN_RECORD_KEY];
    assertEqual(project(sample).status, 'already_committed', 'Passender endgültiger FR-3-Beleg bestätigt ohne Metadaten');
    assert(project(sample).committedAt, 'Belegzeitpunkt bleibt belegt');
    assertEqual(deriveAnnualCloseEvidence({ targetYear: 2027, scope: sample.scope, activeId: sample.records.rs_current_profile, records: sample.records }).status, 'ready', 'Planbeleg aus anderem Jahr zählt nicht');
    const otherScope = planScope('single', ['other']);
    assertEqual(deriveAnnualCloseEvidence({ targetYear: 2026, scope: otherScope, activeId: sample.records.rs_current_profile, records: sample.records }).status, 'ready', 'Fremder Planumfang zählt nicht');
    const env = await annualServiceFixture({ sample });
    let financial = 0;
    const service = env.create({ commit: () => { financial++; throw new Error('UNEXPECTED_FINANCIAL_WRITE'); } });
    assertEqual((await service.reconcilePeriod()).status, 'already_committed', 'Metadatenübernahme nutzt den Beleg');
    assertEqual(financial + env.snapshots.size, 0, 'Übernahme hat weder Finanzwrite noch Snapshot');
    const after = await env.persistence.readPersistedRecords();
    for (const [key, value] of Object.entries(sample.records)) if (key !== CONFIG.STORAGE.LS_KEY) assertEqual(after[key], value, key + ': Metadatenübernahme erhält Rohbytes');
    const original = JSON.parse(sample.records[CONFIG.STORAGE.LS_KEY]), migrated = JSON.parse(after[CONFIG.STORAGE.LS_KEY]);
    delete migrated.annualPeriodMetadata;
    assertEqual(JSON.stringify(migrated), JSON.stringify(original), 'Übernahme ändert im Balancestand ausschließlich Periodenmetadaten');
    assertEqual((await service.close()).status, 'already_committed', 'Wiederholung schreibt kein Jahr');

    // Quellenwechsel während der asynchronen Ableitung lässt keine Übernahme zu.
    const failing = await annualServiceFixture({ sample, faults: { write: batch => {
        if (batch.upserts.some(([key, raw]) => key === CONFIG.STORAGE.LS_KEY && JSON.parse(raw).annualPeriodMetadata)) throw new Error('METADATA_INJECTED');
    } } });
    let adoptionFailed = false; try { await failing.create().reconcilePeriod(); } catch { adoptionFailed = true; }
    assert(adoptionFailed, 'Gescheiterte Metadatenübernahme wird nicht als bestätigt ausgegeben');
    assertEqual(JSON.stringify(await failing.persistence.readPersistedRecords()), JSON.stringify(sample.records), 'Metadatenrollback erhält sämtliche Backendbytes');
    assertEqual(failing.storage.getItem(CONFIG.STORAGE.LS_KEY), sample.records[CONFIG.STORAGE.LS_KEY], 'Metadatenrollback erhält unbestätigten Cachezustand');

    const changed = await annualServiceFixture({ sample });
    const changing = changed.create({ archive: { ...SnapshotArchive, async listSnapshots() {
        changed.storage.setItem('profile_tagesgeld', '777'); return [];
    } } });
    let rejected = false; try { await changing.reconcilePeriod(); } catch { rejected = true; }
    assert(rejected, 'Quellwechsel während Ableitung verhindert Übernahme');
    assertEqual(JSON.parse(changed.storage.getItem(CONFIG.STORAGE.LS_KEY)).annualPeriodMetadata, undefined, 'Quellwechsel bestätigt keinen Vermerk');

    // Geschützter ETF-Retry mit tatsächlich metadatenlosem Vorabpunkt.
    const retrySample = legacySample(), retryEnv = await annualServiceFixture({ sample: retrySample });
    const failed = await retryEnv.create({ prepareMarketData: async () => ({ ok: false, results: { errors: [{ step: 'ETF & Nachrücken', error: 'offline' }] } }) }).close();
    assertEqual(failed.status, 'incomplete_recovery', 'Metadatenloser Start erzeugt bei ETF-Fehler echte Recovery');
    const snapshot = await SnapshotArchive.readSnapshot(failed.recovery.snapshotId);
    for (const [key, value] of Object.entries(snapshot.records)) retryEnv.storage.setItem(key, value);
    await retryEnv.persistence.flush();
    const session = new Map(), ss = { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) };
    const request = { ...failed.retryContext, token: 'once', price: 160.4, createdAt: Date.now() };
    ss.setItem(ANNUAL_RETRY_SESSION_KEY, JSON.stringify(request)); ss.setItem(ANNUAL_RETRY_SESSION_KEY + '.proof', JSON.stringify(request));
    const token = consumeAnnualRetry(ss);
    assertEqual(consumeAnnualRetry(ss), null, 'Sessiontoken wird synchron nur einmal ausgeliefert');
    assert(await validateAnnualRetry(token, { storage: retryEnv.storage, getReferenceDate: annualTestNow }), 'Gleiche metadatenlose Periode und vollständiger Quellsatz sind retryfähig');
    const retryService = retryEnv.create({ clock: Date.now });
    assertEqual((await retryService.close({ resume: token, confirmedPreparation: {} })).status, 'already_committed', 'Geschützter Retry setzt dieselbe sicher abgeleitete Periode fort');
    assert(!await validateAnnualRetry(token, { storage: retryEnv.storage, getReferenceDate: annualTestNow }), 'Verbrauchter Token kann keinen weiteren Jahreswrite starten');
} finally { PersistenceFacade.resetPersistenceRuntimeForTests(); }
