import { marketPriceAdapter, isSyntheticPriceMode } from '../shared/market-price-adapter.js';
import { appNow } from '../shared/app-clock.js';
import { SYNTHETIC_MARKET_SOURCE } from '../shared/probelauf-prices.js';
/**
 * Module: Balance Annual Market Data
 * Purpose: Manages market data updates for the annual review process ("Nachrücken").
 *          It fetches ETF prices (e.g., Vanguard FTSE All-World) via Yahoo (local proxy and optional custom proxy)
 *          and updates the historical performance data (ATH, Years since ATH).
 * Usage: Used by balance-binder-annual.js to support the "Nachrücken" workflow.
 * Dependencies: balance-config.js, balance-renderer.js
 */
"use strict";

import { AppError, CONFIG } from './balance-config.js';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { UIRenderer } from './balance-renderer.js';
import { StorageManager } from './balance-storage.js';
import {
    ANNUAL_PERIOD_SCHEMA_VERSION,
    deriveCompletedCalendarYear
} from './balance-annual-period.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { createAnnualNavigationLifecycle } from './balance-annual-orchestrator.js';

import { ANNUAL_MARKET_DATA_META_KEY, ANNUAL_MARKET_DATA_SCHEMA_VERSION, ANNUAL_PERIOD_METADATA_KEY, CAPE_SOURCES, createAnnualMarketDataRequest, createManualAnnualQuote, isPlausibleAnnualClosePrice, isCapePlausible, selectAnnualCloseQuote, toNumber, validatePreparedAnnualQuote, createAnnualMarketDataReaders } from '../shared/annual-marketdata.js';
export { ANNUAL_MARKET_DATA_META_KEY, ANNUAL_MARKET_DATA_SCHEMA_VERSION, isPlausibleAnnualClosePrice, createAnnualMarketDataRequest, createManualAnnualQuote, validatePreparedAnnualQuote, selectAnnualCloseQuote } from '../shared/annual-marketdata.js';

export function createMarketdataHandlers({
    dom,
    appState,
    debouncedUpdate,
    applyAnnualInflation,
    navigationLifecycle = createAnnualNavigationLifecycle()
}) {
    const { prepareETF, prepareCape, fetchVanguardETFPrice } = createAnnualMarketDataReaders();
    const readActiveAnnualMarketDataContext = () => {
        const state = StorageManager.loadState() || {};
        const metadata = state?.[ANNUAL_PERIOD_METADATA_KEY];
        const pendingCommit = metadata?.pendingCommit;
        const periodId = pendingCommit?.periodId;
        const request = createAnnualMarketDataRequest(periodId);
        const lastCommittedPeriod = metadata?.lastCommittedPeriod;
        const lastCommittedRequest = lastCommittedPeriod === null
            ? null
            : createAnnualMarketDataRequest(lastCommittedPeriod);
        const completedYear = deriveCompletedCalendarYear(appNow());
        const validLastCommittedPeriod = (
            lastCommittedPeriod === null ||
            (
                lastCommittedRequest &&
                request &&
                lastCommittedRequest.targetYear < request.targetYear
            )
        );
        const validCommitContext = (
            metadata &&
            typeof metadata === 'object' &&
            !Array.isArray(metadata) &&
            metadata.schemaVersion === ANNUAL_PERIOD_SCHEMA_VERSION &&
            pendingCommit &&
            typeof pendingCommit === 'object' &&
            !Array.isArray(pendingCommit) &&
            pendingCommit.phase === 'writes_started' &&
            typeof pendingCommit.snapshotId === 'string' &&
            pendingCommit.snapshotId.trim() !== '' &&
            request &&
            Number.isInteger(completedYear) &&
            request.targetYear <= completedYear &&
            validLastCommittedPeriod
        );
        if (!validCommitContext) {
            throw new AppError(
                'ETF-Jahresenddaten benoetigen einen gueltigen laufenden Jahres-Commit mit bestaetigtem Snapshot. '
                + 'Der Marktdatenabruf wurde vor jeder Aenderung abgebrochen.'
            );
        }
        return { state, request };
    };

    const readMarketInputs = () => {
        const marketInputs = {};
        ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth'].forEach(id => {
            const value = Number(dom.inputs[id]?.value);
            if (!Number.isFinite(value)) {
                throw new AppError(`Das Marktdatenfeld ${id} ist vor der Persistenz ungueltig.`);
            }
            marketInputs[id] = value;
        });
        return marketInputs;
    };

    let etfInFlight = false;
    const executeNachrueckenMitETF = async ({ nested = false, manualPrice, preparedResult } = {}, navigationOperation) => {
        if (etfInFlight) {
            if (nested) {
                throw new AppError(
                    'Der ETF-Abruf läuft bereits. Der Jahresschritt kann nicht parallel ausgeführt werden.',
                    { code: 'etf_fetch_in_flight' }
                );
            }
            return;
        }
        etfInFlight = true;
        if (!nested) UIRenderer.clearActionError('annual');
        const btn = dom.controls.btnNachrueckenMitETF;  // Kann undefined sein (wenn von Jahres-Update aufgerufen)
        const originalText = btn?.innerHTML;
        let rollbackContext = null;

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ ETF...';
            }

            const { request } = readActiveAnnualMarketDataContext();

            if (btn) {
                UIRenderer.toast(`Rufe VWCE.DE Jahresendkurs fuer ${request.targetYear} ab...`, 'info');
            }

            // 1. ETF-Kurs abrufen
            const etfData = manualPrice === undefined
                ? preparedResult ? validatePreparedAnnualQuote(preparedResult, request) : await fetchVanguardETFPrice(request, navigationOperation)
                : createManualAnnualQuote(manualPrice, request.periodId);
            navigationOperation.check();
            const etfPrice = Math.round(etfData.price);
            if (!isPlausibleAnnualClosePrice(etfPrice)) {
                throw new AppError('Der gelieferte ETF-Jahresendkurs ist nicht plausibel.');
            }

            // Die laufende Periode darf sich waehrend des asynchronen Abrufs nicht geaendert haben.
            const activeContext = readActiveAnnualMarketDataContext();
            const state = activeContext.state;
            if (activeContext.request.periodId !== request.periodId) {
                throw new AppError(
                    'Die laufende Jahresperiode hat sich waehrend des Marktdatenabrufs geaendert. '
                    + 'Es wurden keine Marktdaten uebernommen.'
                );
            }

            // 2. Nachrücken durchführen (bestehende Logik)
            if (btn) {
                btn.innerHTML = '⏳ Nachr...';
            }

            // Speichere alte Werte für Fehlerrollback und Rückgabe
            const oldATH = parseFloat(dom.inputs.ath.value) || 0;
            const oldJahreSeitAth = parseInt(dom.inputs.jahreSeitAth.value) || 0;
            const previousMeta = state[ANNUAL_MARKET_DATA_META_KEY];
            navigationOperation.commit();

            const previousInputs = {
                endeVJ: dom.inputs.endeVJ.value,
                endeVJ_1: dom.inputs.endeVJ_1.value,
                endeVJ_2: dom.inputs.endeVJ_2.value,
                endeVJ_3: dom.inputs.endeVJ_3.value,
                ath: dom.inputs.ath.value,
                jahreSeitAth: dom.inputs.jahreSeitAth.value
            };
            rollbackContext = {
                state,
                marketData: previousInputs
            };

            // Verschiebe die Werte
            dom.inputs.endeVJ_3.value = dom.inputs.endeVJ_2.value;
            dom.inputs.endeVJ_2.value = dom.inputs.endeVJ_1.value;
            dom.inputs.endeVJ_1.value = dom.inputs.endeVJ.value;

            // 3. Neuen ETF-Wert in Ende VJ eintragen (ohne Nachkommastellen)
            dom.inputs.endeVJ.value = etfPrice.toString();

            // 4. ATH-Logik anwenden
            const currentATH = oldATH;
            const newValue = etfPrice;
            const previousJahreSeitAth = oldJahreSeitAth;

            let isNewATH = false;
            let newJahreSeitAth = previousJahreSeitAth;

            if (newValue >= currentATH) {
                dom.inputs.jahreSeitAth.value = '0';
                newJahreSeitAth = 0;
            } else {
                newJahreSeitAth = previousJahreSeitAth + 1;
                dom.inputs.jahreSeitAth.value = newJahreSeitAth.toString();
            }

            if (newValue > currentATH) {
                // Neues Allzeithoch!
                dom.inputs.ath.value = etfPrice.toString();
                isNewATH = true;
            }

            const newATH = isNewATH ? etfPrice : oldATH;
            const lastHighAsOf = newValue >= currentATH
                ? etfData.asOf
                : previousMeta?.ath?.lastHighAsOf || null;
            const marketDataMeta = {
                schemaVersion: ANNUAL_MARKET_DATA_SCHEMA_VERSION,
                periodId: request.periodId,
                targetYear: request.targetYear,
                price: etfPrice,
                asOf: etfData.asOf,
                ticker: etfData.ticker,
                source: etfData.source,
                ...(isSyntheticPriceMode() && previousMeta?.inflation?.year === request.targetYear
                    ? { inflation: previousMeta.inflation } : {}),
                ath: {
                    value: newATH,
                    yearsSince: newJahreSeitAth,
                    evaluatedAsOf: etfData.asOf,
                    lastHighAsOf
                }
            };

            // 5. Inflation anwenden
            applyAnnualInflation();

            // 6. Marktdatenfelder und ihre Metadaten gemeinsam persistieren.
            debouncedUpdate();
            const persistContext = readActiveAnnualMarketDataContext();
            if (persistContext.request.periodId !== request.periodId) {
                throw new AppError('Die laufende Jahresperiode ist vor der Marktdatenpersistenz nicht mehr gueltig.');
            }
            const nextState = persistContext.state;
            nextState.inputs = {
                ...(nextState.inputs && typeof nextState.inputs === 'object' ? nextState.inputs : {}),
                ...readMarketInputs()
            };
            nextState[ANNUAL_MARKET_DATA_META_KEY] = marketDataMeta;
            StorageManager.saveState(nextState);

            // 7. Feedback

            const usedDate = etfData.date.toLocaleDateString('de-DE', { timeZone: 'UTC' });
            const athStatus = isNewATH ? '🎯 Neues Allzeithoch!' : `Jahre seit Allzeithoch: ${newJahreSeitAth}`;

            if (btn) {
                UIRenderer.toast(
                    `✅ Nachrücken mit ETF abgeschlossen!\n` +
                    `VWCE.DE: ${etfPrice} € (${usedDate})\n` +
                    `Quelle: ${etfData.source}\n` +
                    `${athStatus}`
                );
            }

            // Rückgabe für Jahres-Update Modal
            const result = {
                price: etfPrice,
                date: usedDate,
                asOf: etfData.asOf,
                ticker: etfData.ticker,
                source: etfData.source,
                targetYear: request.targetYear,
                periodId: request.periodId,
                ath: {
                    old: oldATH,
                    new: newATH,
                    isNew: isNewATH,
                    yearsSince: newJahreSeitAth,
                    evaluatedAsOf: etfData.asOf,
                    lastHighAsOf
                }
            };
            rollbackContext = null;
            return result;

        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            if (rollbackContext) {
                Object.entries(rollbackContext.marketData).forEach(([key, value]) => {
                    dom.inputs[key].value = value;
                });
                try {
                    StorageManager.saveState(rollbackContext.state);
                } catch (rollbackError) {
                    console.error('Marktdaten-Rollback konnte nicht persistiert werden:', rollbackError);
                }
            }
            console.error('Nachrücken mit ETF fehlgeschlagen:', err);
            UIRenderer.handleActionError(err, 'annual');
            throw err; // Re-throw für Jahres-Update
        } finally {
            etfInFlight = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    };

    const updateCapeInputsIfPresent = (capeRatio) => {
        const value = toNumber(capeRatio);
        if (!Number.isFinite(value)) return;
        const target = Math.max(0, value);
        if (dom.inputs.marketCapeRatio) {
            dom.inputs.marketCapeRatio.value = target.toFixed(1);
        }
        if (dom.inputs.capeRatio) {
            dom.inputs.capeRatio.value = target.toFixed(1);
        }
    };

    const persistCapeMeta = (metaPatch) => {
        const state = StorageManager.loadState() || {};
        const currentMeta = state.capeMeta || {};
        state.capeMeta = {
            ...currentMeta,
            ...metaPatch
        };
        StorageManager.saveState(state);
    };

    const executeFetchCapeAuto = async ({ nested = false, preparedResult } = {}, navigationOperation) => {
        if (!nested) UIRenderer.clearActionError('annual');
        const result = preparedResult || await prepareCape({ signal: navigationOperation.controller.signal });
        if (preparedResult && (!(result.capeSource === CAPE_SOURCES.STORED.id ? Number.isFinite(result.capeRatio) && result.capeRatio > 0 : isCapePlausible(result.capeRatio)) || !result.capeSource
            || !['ok_primary', 'ok_fallback_mirror', 'ok_fallback_stored', 'warn_stale_source', 'ok_synthetic'].includes(result.capeFetchStatus))) {
            throw new AppError('Der vorbereitete CAPE-Stand ist ungültig.');
        }
        navigationOperation.check();
        navigationOperation.commit();
        const { sourceLabel, errors, ...meta } = result;
        persistCapeMeta(meta);
        if (result.capeFetchStatus !== 'error_no_source_no_stored') {
            updateCapeInputsIfPresent(result.capeRatio);
            debouncedUpdate();
        }
        return result;
    };

    const handleNachrueckenMitETF = (options = {}) => etfInFlight
        ? executeNachrueckenMitETF(options, null)
        : navigationLifecycle.run(options, operation => executeNachrueckenMitETF(options, operation));
    const handleFetchCapeAuto = (options = {}) => navigationLifecycle.run(options,
        operation => executeFetchCapeAuto(options, operation));
    return {
        handleNachrueckenMitETF,
        handleFetchCapeAuto,
        prepareETF,
        prepareCape
    };
}
