/** @import * as I from "../../../typcheck/speicher-integration.js" */

import { PersistenceFacade } from '../persistence-facade.js';
import { PROBELAUF_STATE_KEY } from '../persistence-key-policy.js';
import { getAppTestDate } from '../app-clock.js';
import { PROBELAUF_BACKUP_MESSAGE, PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE } from './schema.js';
import { hasOwn } from './records.js';

/** Jeder Steuerrecord sperrt, auch beschädigte oder noch nicht aktive Phasen. */
/**
 * @param {I.BackupOptions} [options]
 * @returns {Promise<void>}
 */
export async function assertFullBackupAllowed(options = {}) {
    const persistence = options.persistence || PersistenceFacade;
    const check = () => {
        const coordinator = options.probelaufController;
        if (persistence.getPersistenceStatus?.().activeArea === 'spiel'
            || getAppTestDate() !== null || coordinator?.state || coordinator?.busy || coordinator?.blocked
            || persistence.getItemSync(PROBELAUF_STATE_KEY) !== null) {
            /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
            const error = new Error(PROBELAUF_BACKUP_MESSAGE);
            /** @type {I.AppError} */ (error).code = 'probelauf_backup_blocked';
            throw error;
        }
    };
    check();
    let records;
    try {
        records = await persistence.readPersistedRecords(key => key === PROBELAUF_STATE_KEY);
    } catch (cause) {
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error(PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE);
        /** @type {I.AppError} */ (error).code = 'probelauf_backup_state_unavailable';
        error.cause = cause;
        throw error;
    }
    check();
    if (hasOwn(records, PROBELAUF_STATE_KEY)) {
        /** @type {import('../../../typcheck/runtime-contracts.js').AppError} */
        const error = new Error(PROBELAUF_BACKUP_MESSAGE);
        /** @type {I.AppError} */ (error).code = 'probelauf_backup_blocked';
        throw error;
    }
}
