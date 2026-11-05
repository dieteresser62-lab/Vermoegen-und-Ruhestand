/** @import * as D from "../../../typcheck/datenvertraege.js" */
/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { init } from './initialization.js';
import { toNullPrototypeRecords, normalizeSnapshotListArchive, serializeSnapshotListArchive } from './record-format.js';
import { storeState, assertDocumentWritable, PROBELAUF_STATE_KEY, LOCAL_SNAPSHOT_ARCHIVE_KEY } from './state.js';
import { withProbelaufOperation } from './writes.js';
import { createPersistenceAreas } from '../persistence-areas.js';
import { clearScheduledFlush } from './batch-flush.js';
import { readPersistedRecords } from './exchange.js';
import { musterHaushalt } from '../../demo/muster-haushalte.js';
import { replaceRecordsTransactionalWith } from '../persistence-transaction.js';

/** Nur lesend, auch Migrationen und Quarantäne sind hier ausgeschlossen. */
export async function readRealRecords() {
    await init();
    if (!storeState.areaManager) throw new Error('Speicherbereiche benötigen einen Laufzeitadapter.');
    return toNullPrototypeRecords(await storeState.areaManager.readRealRecords());
}

export async function readRealSnapshots() {
    await init();
    if (!storeState.areaManager) throw new Error('Speicherbereiche benötigen einen Laufzeitadapter.');
    return storeState.areaManager.readRealSnapshots();
}

/** Fundament für SB-2: Nach Aktivieren/Verwerfen ist ein Dokumentneustart nötig. */
/**
 * @param {Parameters<NonNullable<ReturnType<typeof createPersistenceAreas>>['activate']>[0]} input
 * @param {I.ReplaceOptions} [options]
 */
export async function activatePlayArea(input, options = {}) {
    await init();
    assertDocumentWritable();
    if (!storeState.areaManager || storeState.areaControl.activeArea !== 'echt') throw new Error('Spielbereich kann hier nicht aktiviert werden.');
    const activate = async () => {
        assertDocumentWritable();
        if (storeState.dirtyKeys.size || storeState.deletedKeys.size) throw new Error('Bitte zuerst die echten Eingaben speichern.');
        storeState.areaReloadRequired = true;
        try { await /** @type {NonNullable<typeof storeState.areaManager>} */ (storeState.areaManager).activate(input); }
        catch (error) { storeState.areaReloadRequired = false; throw error; }
    };
    return storeState.probelaufProtection?.ownsWrites?.(options) ? activate() : withProbelaufOperation(activate);
}

/**
 * @param {I.ReplaceOptions} [options]
 */
export async function discardPlayArea(options = {}) {
    await init();
    assertDocumentWritable();
    if (!storeState.areaManager || storeState.areaControl.activeArea !== 'spiel') throw new Error('Kein Spielbereich aktiv.');
    const discard = async () => {
        assertDocumentWritable();
        storeState.areaReloadRequired = true;
        clearScheduledFlush();
        storeState.dirtyKeys.clear();
        storeState.deletedKeys.clear();
        await /** @type {NonNullable<typeof storeState.areaManager>} */ (storeState.areaManager).discard(storeState.adapter);
    };
    return storeState.probelaufProtection?.ownsWrites?.(options) ? discard() : withProbelaufOperation(discard);
}

/** Einziger Schreibweg vom Spielbereich in den echten Bestand. */
/**
 * @param {{state: Parameters<typeof import('../probelauf-comparison.js').probelaufTransferability>[0], expectedPlayChecksum: string, now?: Date}} input
 * @param {I.ReplaceOptions} [options]
 */
export async function adoptPlayArea({ state, expectedPlayChecksum, now = new Date() }, options = {}) {
    await init();
    assertDocumentWritable();
    if (!storeState.areaManager || storeState.areaControl.activeArea !== 'spiel' || state?.version !== 2 || state.phase !== 'active'
        || !storeState.probelaufProtection?.ownsWrites?.(options)) throw new Error('Übernehmen ist hier gesperrt.');
    const [{ buildProbelaufTransferRecords, probelaufDomainChecksum }, { probelaufTransferability, calculateProbelaufEndReview }, { SnapshotArchive, SNAPSHOT_KINDS }] = await Promise.all([
        import("../probelauf-records.js"), import("../probelauf-comparison.js"), import("../snapshot-archive.js")
    ]);
    /** @param {string} key */
    const allowKey = key => key !== PROBELAUF_STATE_KEY && key !== LOCAL_SNAPSHOT_ARCHIVE_KEY;
    const playRecords = await readPersistedRecords();
    if (playRecords[PROBELAUF_STATE_KEY] !== JSON.stringify(state)
        || expectedPlayChecksum !== probelaufDomainChecksum(playRecords)) throw new Error('Deine Spieländerungen haben sich seit der Bestätigung geändert. Bitte erneut vergleichen.');
    const realRecords = await readRealRecords();
    const eligibility = probelaufTransferability(state, realRecords);
    if (!eligibility.eligible) throw new Error(eligibility.reason === 'date' ? 'Nach Zeitsprüngen nicht übernehmbar.'
        : eligibility.reason === 'demo' ? `Die Beispieldaten von ${musterHaushalt(state.householdId).name} sind nicht übernehmbar.` : 'Deine echten Daten wurden seit dem Start geändert. Bitte erneut vergleichen.');
    const target = buildProbelaufTransferRecords(realRecords, playRecords);
    const review = await calculateProbelaufEndReview({ state, realRecords, playRecords: target, now });
    const transfer = await storeState.areaManager.openRealTransfer();
    /** @type {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} */
    const real = /** @type {import('../../../typcheck/runtime-contracts.js').PersistenceAdapter} */ (/** @type {unknown} */ (transfer.adapter));
    /** @param {(key: string) => boolean} [policy] */
    const read = async (policy = () => true) => Object.fromEntries(Object.entries(await (real.readPersistedRecords ? real.readPersistedRecords() : real.loadAll())).filter(([key]) => policy(key)));
    const storage = {
        flush: async () => true,
        readPersistedRecords: read,
        captureRecordsByPolicy: /** @param {D.KeyPolicy} policy */ async policy => Object.fromEntries(Object.entries(await real.loadAll()).filter(([key]) => policy(key))),
        async replaceLiveRecords(/** @type {D.StringRecords} */ records, /** @type {{deleteKeys: string[], upserts: [string, string][]}} */ plan) {
            const current = await read();
            assertDocumentWritable();
            await real.saveBatch({ deletes: plan.deleteKeys, upserts: plan.upserts.filter(([key, value]) => current[key] !== value) });
        },
        async writeSnapshot(/** @type {D.Snapshot} */ point) {
            assertDocumentWritable();
            if (real.writeSnapshot) return real.writeSnapshot(point);
            const records = await read(), archive = normalizeSnapshotListArchive(records[LOCAL_SNAPSHOT_ARCHIVE_KEY]);
            assertDocumentWritable();
            await real.saveBatch({ deletes: [], upserts: [[LOCAL_SNAPSHOT_ARCHIVE_KEY, serializeSnapshotListArchive([...archive.snapshots, point])]] });
        },
        async readSnapshot(/** @type {string} */ id) {
            if (real.readPersistedSnapshot) return real.readPersistedSnapshot(id);
            if (real.readSnapshot) return real.readSnapshot(id);
            return normalizeSnapshotListArchive((await read())[LOCAL_SNAPSHOT_ARCHIVE_KEY]).snapshots.find(point => point.id === id);
        }
    };
    let replacing = false;
    try {
        const before = Object.fromEntries(Object.entries(realRecords).filter(([key]) => allowKey(key)));
        if (JSON.stringify(Object.entries(await read(allowKey)).sort()) !== JSON.stringify(Object.entries(before).sort())) throw new Error('Der echte Bestand hat sich während der Prüfung geändert.');
        /** @type {I.Operation} */ (options.navigationOperation).check();
        const snapshot = await SnapshotArchive.createSnapshot({ id: `before_play_transfer_${globalThis.crypto.randomUUID()}`,
            kind: SNAPSHOT_KINDS.probelaufTransferBefore, label: 'Vor Übernahme aus dem Spielbereich', records: before,
            activeProfileId: before.rs_current_profile || before.rs_active_profile || '',
            restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback', liveKeyMode: 'play-transfer' }
        }, { storage, navigationOperation: options.navigationOperation });
        const confirmed = await SnapshotArchive.readSnapshot(snapshot.id, { storage });
        if (JSON.stringify(confirmed) !== JSON.stringify(snapshot)) throw new Error('Der Wiederherstellungspunkt konnte nicht bestätigt werden.');
        // Dieselbe Transaktion wie bei Import/Zurückholen, auf dem echten Adapter.
        replacing = true;
        await replaceRecordsTransactionalWith(storage, target, { ...options, allowKey, expectedRecords: before });
        await storeState.areaManager.finishTransfer(storeState.adapter);
        storeState.areaReloadRequired = true;
        clearScheduledFlush(); storeState.dirtyKeys.clear(); storeState.deletedKeys.clear();
        return { changes: review.changes, monthlyBudget: review.play.monthlyBudget, year: review.play.year,
            snapshotId: snapshot.id, snapshotLabel: snapshot.label, savedAt: new Date().toISOString() };
    } catch (cause) {
        // Der Transaktionsrollback sichert Records. Dieser Schritt holt zusätzlich
        // die Originalbytes samt Backend-Zeitstempeln zurück.
        if (replacing && /** @type {I.AppError} */ (cause).code !== 'persistence_precondition_mismatch') {
            try { await transfer.rollback(); }
            catch (rollbackError) { throw Object.assign(new Error('Übernahme fehlgeschlagen. Der echte Bestand konnte nicht bestätigt werden; bitte Daten & Sicherung prüfen. Der Spielbereich bleibt erhalten.'), { cause, rollbackError, code: 'rollback_failed' }); }
        }
        if (/** @type {I.AppError} */ (cause).code === 'rollback_failed') throw cause;
        throw Object.assign(new Error(`Nicht übernommen: ${/** @type {I.AppError} */ (cause).message} Dein echter Bestand ist unverändert. Der Spielbereich bleibt erhalten.`), { cause });
    } finally { transfer.close(); }
}
