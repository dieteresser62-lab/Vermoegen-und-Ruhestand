import { appNow } from '../shared/app-clock.js';
import { marketPriceAdapter, isSyntheticPriceMode } from '../shared/market-price-adapter.js';
import { personReferenceYear } from '../profile/profile-person-data.js';
import { formatDisplayPercentValue } from '../shared/shared-formatting.js';
/**
 * Module: Balance Annual Inflation
 * Purpose: Fetches one validated calendar-year inflation value and applies it atomically to Balance needs.
 * Usage: Used by balance-binder-annual.js and balance-binder.js during annual updates and manual adjustments.
 * Dependencies: balance-config.js, balance-utils.js, balance-renderer.js, balance-storage.js,
 *               balance-annual-period.js
 */
"use strict";

import { AppError } from './balance-config.js';
import { UIUtils } from './balance-utils.js';
import { UIRenderer } from './balance-renderer.js';
import { StorageManager } from './balance-storage.js';
import { deriveCompletedCalendarYear } from './balance-annual-period.js';
import { BALANCE_UPDATE_MODE } from './balance-update-pipeline.js';
import { createAnnualNavigationLifecycle } from './balance-annual-orchestrator.js';

export const INFLATION_RESULT_METRIC = 'consumer_prices_all_items_annual_average_growth_pct';

const INFLATION_RATE_MIN = -10;
const INFLATION_RATE_MAX = 50;
const DEFAULT_TIMEOUT_MS = 8000;
const NEED_INPUT_IDS = Object.freeze([
    'floorBedarf',
    'flexBedarf',
    'minimumFlexAnnual',
    'flexBudgetAnnual',
    'flexBudgetRecharge'
]);

const SOURCE_REQUESTS = Object.freeze([
    Object.freeze({
        id: 'ecb',
        label: 'ECB (HICP)',
        fetchStatus: 'ok_primary_ecb'
    }),
    Object.freeze({
        id: 'world_bank',
        label: 'World Bank (CPI)',
        fetchStatus: 'ok_fallback_world_bank'
    }),
    Object.freeze({
        id: 'oecd',
        label: 'OECD (CPI)',
        fetchStatus: 'ok_fallback_oecd'
    })
]);

function sourceError(source, fetchStatus, message, originalError = null) {
    return new AppError(message, {
        source,
        fetchStatus,
        originalError
    });
}

function parseFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function assertInflationRate(value) {
    const rate = parseFiniteNumber(value);
    if (rate === null || rate < INFLATION_RATE_MIN || rate > INFLATION_RATE_MAX) {
        throw new AppError(
            `Die Inflationsrate muss zwischen ${INFLATION_RATE_MIN} und ${INFLATION_RATE_MAX} Prozent liegen.`
        );
    }
    const factor = 1 + rate / 100;
    if (!Number.isFinite(factor) || factor <= 0) {
        throw new AppError('Der Inflationsfaktor muss endlich und groesser als null sein.');
    }
    return rate;
}

function responseHeader(response, name) {
    try {
        const value = response?.headers?.get?.(name);
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

function resolveDataAsOf(payload, response, now) {
    const candidates = [
        payload?.header?.prepared,
        payload?.meta?.prepared,
        Array.isArray(payload) ? payload[0]?.lastupdated : null,
        responseHeader(response, 'last-modified'),
        responseHeader(response, 'date')
    ];
    const sourceValue = candidates.find(value => typeof value === 'string' && value.trim());
    if (sourceValue) return sourceValue.trim();

    const fetchedAt = now();
    if (!(fetchedAt instanceof Date) || !Number.isFinite(fetchedAt.getTime())) {
        throw new AppError('Der Datenstand der Inflationsquelle konnte nicht bestimmt werden.');
    }
    return fetchedAt.toISOString();
}

function dimensionSelectionMatches(dimensions, coordinateKey, expectedDimensions) {
    if (!Array.isArray(dimensions)) return false;
    const coordinates = String(coordinateKey).split(':');

    return Object.entries(expectedDimensions).every(([dimensionId, expectedValue]) => {
        const position = dimensions.findIndex(dimension => dimension?.id === dimensionId);
        if (position < 0) return false;
        const valueIndex = Number.parseInt(coordinates[position], 10);
        const actualValue = dimensions[position]?.values?.[valueIndex]?.id;
        return actualValue === expectedValue;
    });
}

function observationNumber(observation) {
    const rawValue = Array.isArray(observation) ? observation[0] : observation;
    return parseFiniteNumber(rawValue);
}

function extractSdmxAnnualValue(payload, targetYear, expectedDimensions) {
    const dataSets = payload?.dataSets || payload?.data?.dataSets;
    const dataSet = dataSets?.[0];
    const structureIndex = Number.isInteger(dataSet?.structure) ? dataSet.structure : 0;
    const structure = payload?.structure?.dimensions
        || payload?.data?.structures?.[structureIndex]?.dimensions;
    const targetPeriod = String(targetYear);
    const values = [];

    if (dataSet?.series && structure?.series && structure?.observation) {
        const timeDimension = structure.observation.find(dimension => dimension?.id === 'TIME_PERIOD');
        const timeIndex = timeDimension?.values?.findIndex(value => value?.id === targetPeriod) ?? -1;
        if (timeIndex >= 0) {
            for (const [seriesKey, series] of Object.entries(dataSet.series)) {
                if (!dimensionSelectionMatches(structure.series, seriesKey, expectedDimensions)) continue;
                const value = observationNumber(series?.observations?.[String(timeIndex)]);
                if (value !== null) values.push(value);
            }
        }
    }

    if (dataSet?.observations && structure?.observation) {
        const dimensions = structure.observation;
        const timePosition = dimensions.findIndex(dimension => dimension?.id === 'TIME_PERIOD');
        for (const [observationKey, observation] of Object.entries(dataSet.observations)) {
            const coordinates = String(observationKey).split(':');
            const timeIndex = Number.parseInt(coordinates[timePosition], 10);
            const period = timePosition >= 0 ? dimensions[timePosition]?.values?.[timeIndex]?.id : null;
            if (period !== targetPeriod) continue;
            if (!dimensionSelectionMatches(dimensions, observationKey, expectedDimensions)) continue;
            const value = observationNumber(observation);
            if (value !== null) values.push(value);
        }
    }

    return values.length === 1 ? values[0] : null;
}

function validateWorldBankPayload(payload, targetYear) {
    if (!Array.isArray(payload) || !Array.isArray(payload[1])) return null;
    const rows = payload[1].filter(row => (
        row?.indicator?.id === 'FP.CPI.TOTL.ZG'
        && row?.countryiso3code === 'DEU'
        && row?.date === String(targetYear)
        && parseFiniteNumber(row?.value) !== null
    ));
    return rows.length === 1 ? Number(rows[0].value) : null;
}

export function validateInflationResult(result, targetYear) {
    const rate = assertInflationRate(result?.rate);
    if (!Number.isInteger(targetYear) || result?.year !== targetYear) {
        throw new AppError(`Die Inflationsquelle lieferte nicht das Zieljahr ${targetYear}.`);
    }
    if (result?.metric !== INFLATION_RESULT_METRIC) {
        throw new AppError('Die Inflationsquelle lieferte eine inkompatible fachliche Kennzahl.');
    }
    if (typeof result?.source !== 'string' || !result.source.trim()) {
        throw new AppError('Die Inflationsquelle fehlt im Ergebnisobjekt.');
    }
    if (typeof result?.dataAsOf !== 'string' || !result.dataAsOf.trim()) {
        throw new AppError('Der Datenstand fehlt im Ergebnisobjekt.');
    }
    if (typeof result?.fetchStatus !== 'string' || !result.fetchStatus.startsWith('ok_')) {
        throw new AppError('Der Fetch-Status des Inflationsergebnisses ist ungueltig.');
    }

    return Object.freeze({
        rate,
        year: targetYear,
        source: result.source.trim(),
        dataAsOf: result.dataAsOf.trim(),
        fetchStatus: result.fetchStatus,
        metric: INFLATION_RESULT_METRIC
    });
}

export function prepareAnnualNeeds(inputs, rateValue) {
    const rate = assertInflationRate(rateValue);
    const factor = 1 + rate / 100;
    const entries = NEED_INPUT_IDS.flatMap(id => {
        const element = inputs[id];
        if (!element) return [];
        const currentAmount = UIUtils.parseCurrency(element.value);
        if (!Number.isFinite(currentAmount) || currentAmount < 0) {
            throw new AppError(`Der Bedarf ${id} ist fuer die Inflationsanpassung ungueltig.`);
        }
        const nextAmount = currentAmount * factor;
        if (
            !Number.isFinite(nextAmount)
            || nextAmount < 0
            || (currentAmount > 0 && nextAmount <= 0)
        ) {
            throw new AppError(`Der fortgeschriebene Bedarf ${id} ist ungueltig.`);
        }
        return [{ id, element, nextAmount, formattedValue: UIUtils.formatNumber(nextAmount) }];
    });
    return { rate, factor, entries };
}

export function createInflationHandlers({
    dom,
    update,
    debouncedUpdate,
    fetchImpl = (...args) => globalThis.fetch(...args),
    now = appNow,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
    clearTimeoutImpl = timeoutId => globalThis.clearTimeout(timeoutId),
    navigationLifecycle = createAnnualNavigationLifecycle()
}) {
    const { prepareInflation } = createInflationReaders({ fetchImpl, now, timeoutMs, setTimeoutImpl, clearTimeoutImpl });

    const prepareNeedMutation = rateValue => prepareAnnualNeeds(dom.inputs, rateValue);

    const prepareInflationState = () => {
        const currentAge = Number.parseInt(dom.inputs.aktuellesAlter?.value, 10);
        if (!Number.isSafeInteger(currentAge) || currentAge < 0) {
            throw new AppError('Das aktuelle Alter ist fuer die Inflationsanpassung ungueltig.');
        }
        const state = StorageManager.loadState() || {};
        return { state, currentAge };
    };

    const commitNeedMutation = (mutation, { inflationInputValue, inflationMeta } = {}) => {
        const { state, currentAge } = prepareInflationState();

        if (inflationInputValue !== undefined) {
            dom.inputs.inflation.value = inflationInputValue;
        }
        mutation.entries.forEach(entry => {
            entry.element.value = entry.formattedValue;
        });
        state.needsAdjustedForInflationYear = personReferenceYear(state.annualPeriodMetadata, now());
        if (inflationMeta) {
            state.annualMarketDataMeta = { ...state.annualMarketDataMeta, inflation: inflationMeta };
        }
        StorageManager.saveState(state);
        update({ mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS });
    };

    const applyInflationToBedarfe = rateOverride => {
        const rateValue = rateOverride === undefined ? dom.inputs.inflation?.value : rateOverride;
        const mutation = prepareNeedMutation(rateValue);
        commitNeedMutation(mutation);
        return mutation;
    };

    const applyAnnualInflation = () => {
        const state = StorageManager.loadState();
        if (!state || !state.lastState) return;

        const currentAge = Number.parseInt(dom.inputs.aktuellesAlter?.value, 10);
        if (!Number.isSafeInteger(currentAge) || currentAge < 0) {
            throw new AppError('Das aktuelle Alter ist fuer die kumulierte Inflation ungueltig.');
        }
        const currentYear = personReferenceYear(state.annualPeriodMetadata, now());
        const lastAppliedYear = Number(state.lastInflationAppliedAtYear) || 0;

        if (currentYear > lastAppliedYear) {
            const rate = assertInflationRate(dom.inputs.inflation?.value);
            const oldFactor = Number(state.lastState.cumulativeInflationFactor ?? 1);
            if (!Number.isFinite(oldFactor) || oldFactor <= 0) {
                throw new AppError('Der bisherige kumulierte Inflationsfaktor ist ungueltig.');
            }
            const nextFactor = oldFactor * (1 + rate / 100);
            if (!Number.isFinite(nextFactor) || nextFactor <= 0) {
                throw new AppError('Der neue kumulierte Inflationsfaktor ist ungueltig.');
            }
            state.lastState.cumulativeInflationFactor = nextFactor;
            state.lastInflationAppliedAtYear = currentYear;
            StorageManager.saveState(state);
            UIRenderer.toast(`Kumulierte Inflation für Planungsjahr ${currentYear} fortgeschrieben.`);
        } else {
            UIRenderer.toast(`Inflation für Planungsjahr ${currentYear} wurde bereits angewendet.`, 'info');
        }
    };

    // Interne Absicherung direkter Handleraufrufe, kein zusätzlicher Balance-Nutzerpfad.
    // Der nested-Fehler bleibt an der bestehenden Grenze des Jahresschritts.
    let fetchInFlight = false;
    const executeFetchInflation = async ({ nested = false, preparedResult } = {}, navigationOperation) => {
        if (fetchInFlight) {
            if (nested) {
                throw new AppError(
                    'Der Inflationsdaten-Abruf läuft bereits. Der Jahresschritt kann nicht parallel ausgeführt werden.',
                    { code: 'inflation_fetch_in_flight' }
                );
            }
            return;
        }
        fetchInFlight = true;
        if (!nested) UIRenderer.clearActionError('annual');
        const btn = dom.controls.btnFetchInflation;
        const originalText = btn?.innerHTML;

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ Lade...';
            }

            const synthetic = isSyntheticPriceMode();
            const targetYear = deriveCompletedCalendarYear(synthetic ? appNow() : now());
            if (!Number.isInteger(targetYear)) {
                throw new AppError('Das Zieljahr fuer die Inflation konnte nicht bestimmt werden.');
            }
            if (btn) UIRenderer.toast(`Versuche Inflationsdaten fuer ${targetYear} abzurufen...`, 'info');

            const validatedResult = preparedResult
                ? validateInflationResult(preparedResult, targetYear)
                : await prepareInflation({ targetYear, signal: navigationOperation.controller.signal });

            const mutation = prepareNeedMutation(validatedResult.rate);
            navigationOperation.commit();
            commitNeedMutation(mutation, { inflationInputValue: validatedResult.rate.toFixed(1),
                inflationMeta: synthetic ? validatedResult : undefined });
            debouncedUpdate();

            if (btn) {
                const formattedRate = formatDisplayPercentValue(
                    validatedResult.rate,
                    { fractionDigits: 1, invalid: 'n/a' }
                );
                UIRenderer.toast(
                    `✅ Inflation ${targetYear}: ${formattedRate} (Quelle: ${validatedResult.source})\n`
                    + 'Bedarfe automatisch angepasst'
                );
            }
            return validatedResult;
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            console.error('Inflation API Fehler:', err);
            UIRenderer.handleActionError(new AppError('Inflationsdaten-Abruf fehlgeschlagen.', { originalError: err }), 'annual');
            throw err;
        } finally {
            fetchInFlight = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    };

    const handleFetchInflation = (options = {}) => fetchInFlight
        ? executeFetchInflation(options, null)
        : navigationLifecycle.run(options, operation => executeFetchInflation(options, operation));
    return {
        applyInflationToBedarfe,
        applyAnnualInflation,
        handleFetchInflation,
        prepareInflation
    };
}

/** Lesender Abrufvertrag, unabhängig von Formularen und Navigation. */
export function createInflationReaders({ fetchImpl = (...args) => globalThis.fetch(...args), now = appNow,
    timeoutMs = DEFAULT_TIMEOUT_MS, setTimeoutImpl = (...args) => globalThis.setTimeout(...args),
    clearTimeoutImpl = id => globalThis.clearTimeout(id) } = {}) {
    const requestJson = async ({ url, source, accept = 'application/json', signal }) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        let timedOut = false;
        let timeoutId;

        try {
            timeoutId = setTimeoutImpl(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);

            const response = await fetchImpl(url, {
                headers: { Accept: accept },
                signal: controller.signal
            });
            if (!response?.ok) {
                throw sourceError(
                    source,
                    'http_error',
                    `${source} antwortete mit HTTP ${response?.status ?? 'unbekannt'}.`
                );
            }

            try {
                return { payload: await response.json(), response };
            } catch (err) {
                throw sourceError(source, 'invalid_response', `${source} lieferte kein gueltiges JSON.`, err);
            }
        } catch (err) {
            if (err instanceof AppError) throw err;
            if (timedOut || (controller.signal.aborted && err?.name === 'AbortError')) {
                throw sourceError(source, 'timeout', `${source} ueberschritt das Zeitlimit.`, err);
            }
            throw sourceError(source, 'request_error', `${source} konnte nicht abgerufen werden.`, err);
        } finally {
            signal?.removeEventListener('abort', abort);
            if (timeoutId !== undefined) clearTimeoutImpl(timeoutId);
        }
    };

    const fetchEcb = async (targetYear, signal) => {
        const url = 'https://data-api.ecb.europa.eu/service/data/'
            + `HICP/A.DE.N.000000.4D0.AVR?startPeriod=${targetYear}&endPeriod=${targetYear}&format=jsondata`;
        const { payload, response } = await requestJson({ url, source: 'ECB', signal });
        const rate = extractSdmxAnnualValue(payload, targetYear, {
            FREQ: 'A',
            REF_AREA: 'DE',
            ICP_ITEM: '000000',
            ICP_SUFFIX: 'AVR'
        });
        if (rate === null) {
            throw sourceError(
                'ECB',
                'incompatible_response',
                `ECB lieferte keinen eindeutigen HICP-Jahresdurchschnitt fuer ${targetYear}.`
            );
        }
        return {
            rate,
            year: targetYear,
            source: SOURCE_REQUESTS[0].label,
            dataAsOf: resolveDataAsOf(payload, response, now),
            fetchStatus: SOURCE_REQUESTS[0].fetchStatus,
            metric: INFLATION_RESULT_METRIC
        };
    };

    const fetchWorldBank = async (targetYear, signal) => {
        const url = 'https://api.worldbank.org/v2/country/DEU/indicator/'
            + `FP.CPI.TOTL.ZG?format=json&date=${targetYear}`;
        const { payload, response } = await requestJson({ url, source: 'World Bank', signal });
        const rate = validateWorldBankPayload(payload, targetYear);
        if (rate === null) {
            throw sourceError(
                'World Bank',
                'incompatible_response',
                `World Bank lieferte keinen eindeutigen CPI-Jahresdurchschnitt fuer ${targetYear}.`
            );
        }
        return {
            rate,
            year: targetYear,
            source: SOURCE_REQUESTS[1].label,
            dataAsOf: resolveDataAsOf(payload, response, now),
            fetchStatus: SOURCE_REQUESTS[1].fetchStatus,
            metric: INFLATION_RESULT_METRIC
        };
    };

    const fetchOecd = async (targetYear, signal) => {
        const url = 'https://sdmx.oecd.org/public/rest/data/'
            + 'OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/'
            + `DEU.A.N.CPI.PA._T.N.GY?startPeriod=${targetYear}&endPeriod=${targetYear}`
            + '&dimensionAtObservation=AllDimensions&format=jsondata';
        const { payload, response } = await requestJson({
            url,
            source: 'OECD',
            signal,
            accept: 'application/vnd.sdmx.data+json;version=2.0.0'
        });
        const rate = extractSdmxAnnualValue(payload, targetYear, {
            REF_AREA: 'DEU',
            FREQ: 'A',
            METHODOLOGY: 'N',
            MEASURE: 'CPI',
            UNIT_MEASURE: 'PA',
            EXPENDITURE: '_T',
            ADJUSTMENT: 'N',
            TRANSFORMATION: 'GY'
        });
        if (rate === null) {
            throw sourceError(
                'OECD',
                'incompatible_response',
                `OECD lieferte keinen eindeutigen CPI-Jahresdurchschnitt fuer ${targetYear}.`
            );
        }
        return {
            rate,
            year: targetYear,
            source: SOURCE_REQUESTS[2].label,
            dataAsOf: resolveDataAsOf(payload, response, now),
            fetchStatus: SOURCE_REQUESTS[2].fetchStatus,
            metric: INFLATION_RESULT_METRIC
        };
    };

    const prepareInflation = async ({ targetYear = deriveCompletedCalendarYear(now()), signal } = {}) => {
        const operation = { controller: { signal }, check() { signal?.throwIfAborted(); } };
        const synthetic = isSyntheticPriceMode();
        if (!Number.isInteger(targetYear) || targetYear < 1900 || targetYear > deriveCompletedCalendarYear(synthetic ? appNow() : now())) throw new AppError('Das Inflationszieljahr ist ungültig.');
        operation.check();
        const attempts = [];
        let validatedResult = null;
        const fetchers = [fetchEcb, fetchWorldBank, fetchOecd];

        if (synthetic) {
            operation.check();
            const result = await marketPriceAdapter('inflation', { year: targetYear }, () => { throw new Error('Unerwarteter Inflationsnetzpfad.'); });
            operation.check();
            validatedResult = validateInflationResult({ ...result, metric: INFLATION_RESULT_METRIC, fetchStatus: 'ok_synthetic' }, targetYear);
        }

        for (let index = 0; !synthetic && index < fetchers.length; index++) {
            operation.check();
            try {
                validatedResult = validateInflationResult(await fetchers[index](targetYear, operation.controller.signal), targetYear);
                operation.check();
                break;
            } catch (err) {
                operation.check();
                attempts.push({
                    source: SOURCE_REQUESTS[index].label,
                    fetchStatus: err?.context?.fetchStatus || 'invalid_response',
                    error: err?.message || 'Unbekannter Fehler'
                });
            }
        }

        if (!validatedResult) {
            throw new AppError(
                `Keine kompatiblen Inflationsdaten fuer ${targetYear} gefunden.`,
                { attempts }
            );
        }

        return validatedResult;
    };

    return { prepareInflation };
}
