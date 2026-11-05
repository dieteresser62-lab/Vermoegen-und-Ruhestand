/** Gemeinsamer Replace mit Readback und kompensierendem Rollback. */
function recordsMatch(expected, actual) {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (expectedKeys.length !== actualKeys.length) return false;
    return expectedKeys.every((key, index) => (
        key === actualKeys[index] &&
        expected[key] === actual[key]
    ));
}

function createPersistenceError(code, message) {
    const error = /** @type {import("../../typcheck/runtime-contracts.js").AppError} */ (new Error(message));
    error.name = 'PersistenceError';
    error.code = code;
    return error;
}

function createFullReplacePlan(targetRecords, currentRecords, allowKey) {
    const targetKeys = new Set(Object.keys(targetRecords));
    return {
        deleteKeys: Object.keys(currentRecords).filter(key => allowKey(key) && !targetKeys.has(key)),
        upserts: Object.entries(targetRecords),
        allowKey
    };
}

function createRestoreError(cause, rollbackError = null) {
    const error = /** @type {import("../../typcheck/runtime-contracts.js").AppError & {failureCode?: string; rollbackCode?: string}} */ (new Error(
        rollbackError
            ? 'Persistenz-Restore fehlgeschlagen; auch der kompensierende Rollback konnte nicht verifiziert werden.'
            : 'Persistenz-Restore fehlgeschlagen; der vorherige Livebestand wurde wiederhergestellt.'
    ));
    error.name = 'PersistenceRestoreError';
    error.code = rollbackError ? 'rollback_failed' : 'restore_rolled_back';
    error.cause = cause;
    error.rollbackError = rollbackError;
    error.failureCode = cause?.code || 'persistence_transaction_write_failed';
    error.rollbackCode = rollbackError?.code
        || (rollbackError ? 'persistence_transaction_rollback_failed' : null);
    return error;
}

/**
 * @param storage Speicherzugriff des Aufrufers.
 * @param records Serialisierte Speicherrecords.
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export async function replaceRecordsTransactionalWith(storage, records, options = {}) {
    const allowKey = typeof options.allowKey === 'function' ? options.allowKey : () => true;
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
        throw new Error('Restore-Records muessen ein Objekt sein.');
    }

    const targetRecords = Object.create(null);
    Object.entries(records).forEach(([key, value]) => {
        const normalizedKey = String(key);
        if (!allowKey(normalizedKey)) {
            throw new Error(`Persistenz-Key ${normalizedKey} ist fuer diesen Restore nicht erlaubt.`);
        }
        if (typeof value !== 'string') {
            throw new Error(`Persistenzwert ${normalizedKey} muss als String vorliegen.`);
        }
        targetRecords[normalizedKey] = value;
    });

    await storage.flush(options);
    options.navigationOperation.check();
    const versions = storage.captureKeyVersions?.();
    const unchanged = key => !versions || storage.getKeyVersion(key) === versions.get(key);
    const ownKey = key => allowKey(key) && unchanged(key);
    const ownRecords = records => Object.fromEntries(Object.entries(records).filter(([key]) => ownKey(key)));
    const previousRecords = await storage.readPersistedRecords(allowKey);
    options.navigationOperation.check();
    // Optionaler optimistischer Vertrag: der gesicherte Rohbestand muss sowohl
    // dauerhaft als auch im Cache noch gelten. Vor dem Commit gibt es nichts
    // zurückzurollen; insbesondere darf ein fremder Write nicht ersetzt werden.
    if (options.expectedRecords !== undefined
        && (!recordsMatch(options.expectedRecords, previousRecords)
            || !recordsMatch(options.expectedRecords, await storage.captureRecordsByPolicy(allowKey)))) {
        throw createPersistenceError(
            'persistence_precondition_mismatch',
            'Der Rohbestand hat sich seit der Sicherung geändert. Bitte neu laden und erneut prüfen.'
        );
    }
    const replacePlan = createFullReplacePlan(targetRecords, previousRecords, allowKey);

    options.navigationOperation.commit();
    try {
        await storage.replaceLiveRecords(targetRecords, {
            ...options,
            ...replacePlan,
            allowKey: ownKey,
            restoreLock: true
        });
        // Angenommene Eingaben bleiben eigene Writes und werden vor der
        // Postvalidierung dauerhaft gespeichert; sie sind kein Restore-Mismatch.
        await storage.flush(options);
        const confirmedRecords = await storage.readPersistedRecords(allowKey);
        const confirmedCache = await storage.captureRecordsByPolicy(allowKey);
        if (!recordsMatch(ownRecords(targetRecords), ownRecords(confirmedRecords)) || !recordsMatch(ownRecords(targetRecords), ownRecords(confirmedCache))) {
            throw createPersistenceError(
                'persistence_readback_mismatch',
                'Backend oder Cache stimmt nicht mit dem Restore-Ziel ueberein.'
            );
        }
        if (typeof options.postValidate === 'function') {
            const validationResult = await options.postValidate(confirmedRecords);
            if (validationResult === false || validationResult?.ok === false) {
                throw new Error(validationResult?.message || 'Die Post-Load-Validierung ist fehlgeschlagen.');
            }
        }
        return {
            ok: true,
            previousRecords,
            records: confirmedRecords,
            deletedCount: replacePlan.deleteKeys.length,
            upsertCount: replacePlan.upserts.length
        };
    } catch (cause) {
        let rollbackError = null;
        try {
            const currentRecords = await storage.readPersistedRecords(allowKey);
            const rollbackVisibleKeys = Object.fromEntries(
                [...new Set([
                    ...Object.keys(currentRecords),
                    ...Object.keys(targetRecords)
                ])].map(key => [key, currentRecords[key] ?? targetRecords[key]])
            );
            const rollbackPlan = createFullReplacePlan(previousRecords, rollbackVisibleKeys, ownKey);
            await storage.replaceLiveRecords(previousRecords, {
                ...options,
                ...rollbackPlan,
                postValidate: undefined,
                restoreLock: true
            });
            const confirmedRollback = await storage.readPersistedRecords(allowKey);
            const confirmedRollbackCache = await storage.captureRecordsByPolicy(allowKey);
            if (!recordsMatch(ownRecords(previousRecords), ownRecords(confirmedRollback))
                || !recordsMatch(ownRecords(previousRecords), ownRecords(confirmedRollbackCache))) {
                throw createPersistenceError(
                    'persistence_rollback_readback_mismatch',
                    'Backend oder Cache ist nach dem Rollback nicht bytegleich zum vorherigen Livebestand.'
                );
            }
        } catch (error) {
            rollbackError = error;
        }
        throw createRestoreError(cause, rollbackError);
    }
}

