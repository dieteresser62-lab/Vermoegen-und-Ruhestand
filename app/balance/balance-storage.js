import { stripBalancePersonInputs } from '../profile/profile-person-data.js';
/**
 * Module: Balance Storage (StorageManager)
 * Purpose: Manages data persistence via LocalStorage.
 *          Handles state loading/saving, migrations for older versions, and snapshot restore.
 * Usage: Used by balance-main.js and balance-binder.js for all persistence operations.
 * Dependencies: balance-config.js
 */
"use strict";

/**
 * ===================================================================================
 * BALANCE-APP PERSISTENZ-SCHICHT (StorageManager)
 * ===================================================================================
 */

import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';

import { CONFIG, StorageError } from './balance-config.js';
import { assertBalanceWealthHistory, WealthHistoryError } from '../../types/wealth-history-contract.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { restoreSnapshotById } from '../shared/snapshot-restore.js';
import {
    assertCumulativeInflationFactor,
    CumulativeInflationFactorError
} from '../../types/cumulative-inflation-contract.js';

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function validateStoredCumulativeInflationFactor(data) {
    const state = data?.lastState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return data;
    if (hasOwn(state, 'cumulativeInflationFactor')) {
        assertCumulativeInflationFactor(state.cumulativeInflationFactor, {
            path: 'lastState.cumulativeInflationFactor'
        });
    }
    return data;
}

function getStorageGuard(options = {}) {
    return options.guard ?? (globalThis.document ? getPageNavigationGuard() : null);
}

export const StorageManager = {
    /**
     * Lädt den gespeicherten Zustand aus localStorage
     *
     * Enthält:
     * - Benutzereingaben (Vermögen, Bedarf, Marktdaten)
     * - Engine-State (Guardrail-History, Inflationsfaktor, etc.)
     *
     * @returns {Object} Gespeicherter Zustand mit inputs und lastState
     * @throws {StorageError} Bei Lade- oder Parse-Fehlern
     */
    loadState() {
        try {
            const data = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
            const parsed = data ? JSON.parse(data) : {};
            assertBalanceWealthHistory(parsed);
            validateStoredCumulativeInflationFactor(parsed);
            return this._runMigrations(parsed);
        } catch (e) {
            if (e instanceof CumulativeInflationFactorError || e instanceof WealthHistoryError
                || e?.code === 'PERSISTENCE_RELOAD_REQUIRED') throw e;
            throw new StorageError("Fehler beim Laden des Zustands aus dem LocalStorage.", { originalError: e });
        }
    },

    /**
     * Speichert den aktuellen Zustand in localStorage
     *
     * @param {Object} state - Zustand mit inputs und lastState
     * @throws {StorageError} Bei Speicher-Fehlern (z.B. Quota exceeded)
     */
    saveState(state) {
        try {
            assertBalanceWealthHistory(state);
            validateStoredCumulativeInflationFactor(state);
            persistenceStorage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(stripBalancePersonInputs(state)));
        } catch (e) {
            if (e instanceof CumulativeInflationFactorError || e instanceof WealthHistoryError
                || e?.code === 'PERSISTENCE_RELOAD_REQUIRED') throw e;
            throw new StorageError("Fehler beim Speichern des Zustands im LocalStorage.", { originalError: e });
        }
    },

    /**
     * Führt Daten-Migrationen für ältere localStorage-Versionen durch
     *
     * Historische Einmalmigrationen duerfen nur fehlende Metadaten ergaenzen.
     * Ein vorhandener Inflationsfaktor wird vor der Migration strikt validiert
     * und niemals still durch einen Default ersetzt.
     *
     * @param {Object} data - Rohdaten aus localStorage
     * @returns {Object} Migrierte Daten
     * @private
     */
    _runMigrations(data) {
        assertBalanceWealthHistory(data);
        validateStoredCumulativeInflationFactor(data);
        const ensureTaxState = (payload) => {
            if (!payload || typeof payload !== 'object') return payload;
            const state = payload.lastState;
            if (!state || typeof state !== 'object') return payload;
            if (!state.taxState || typeof state.taxState !== 'object') {
                state.taxState = { lossCarry: 0 };
            } else if (!Number.isFinite(state.taxState.lossCarry) || state.taxState.lossCarry < 0) {
                state.taxState.lossCarry = 0;
            }
            payload.lastState = state;
            return payload;
        };
        if (persistenceStorage.getItem(CONFIG.STORAGE.MIGRATION_FLAG)) {
            return ensureTaxState(data);
        }

        let state = data.lastState || {};
        if (state) {
            if (!Number.isFinite(state.lastInflationAppliedAtAge)) {
                state.lastInflationAppliedAtAge = 0;
            }
            data.lastState = state;
        }
        persistenceStorage.setItem(CONFIG.STORAGE.MIGRATION_FLAG, '1');
        return ensureTaxState(data);
    },

    /**
     * Löscht den gespeicherten Zustand (Reset)
     * Entfernt localStorage-Einträge für State und Migrations-Flag
     */
    resetState() {
        persistenceStorage.removeItem(CONFIG.STORAGE.LS_KEY);
        persistenceStorage.removeItem(CONFIG.STORAGE.MIGRATION_FLAG);
    },

    /**
     * Holt einen Wiederherstellungspunkt für den ganzen Haushalt zurück (SV-1).
     *
     * @async
     * @param {string} key - Kennung des Wiederherstellungspunkts
     * @returns {Promise<{status: string, message?: string}>}
     */
    async restoreSnapshot(key, options = {}) {
        return restoreSnapshotById(key, { ...options, guard: getStorageGuard(options) });
    }
};
