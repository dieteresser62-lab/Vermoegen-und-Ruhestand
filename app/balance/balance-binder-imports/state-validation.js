// @ts-check
import { assertBalanceWealthHistory, WealthHistoryError } from '../../../types/wealth-history-contract.js';
import { failImport, isRecord, hasOwn, cloneJson } from './validation-core.js';
import { validateBalanceInputsAgainstSchema } from './input-validation.js';
import { isValidCumulativeInflationFactor } from '../../../types/cumulative-inflation-contract.js';
import { validateAnnualMarketDataMeta } from './market-provenance.js';
import { ANNUAL_MARKET_DATA_META_KEY } from '../balance-annual-marketdata.js';

export function validateWealthHistoryForImport(payload) {
    try {
        assertBalanceWealthHistory(payload);
    } catch (error) {
        if (!(error instanceof WealthHistoryError)) throw error;
        failImport('invalid_wealth_history', error.message);
    }
}

export function validateBalanceState(payload) {
    if (!isRecord(payload)) {
        failImport('invalid_payload', 'Der Balance-Inhalt ist kein Objekt. Bitte eine unveränderte Balance-Exportdatei auswählen.');
    }
    validateWealthHistoryForImport(payload);
    if (!isRecord(payload.inputs)) {
        failImport('invalid_inputs', 'Der Pflichtbereich „inputs“ fehlt oder ist ungültig. Bitte eine vollständige Balance-Exportdatei auswählen.');
    }

    const inputs = payload.inputs;
    validateBalanceInputsAgainstSchema(inputs);

    if (hasOwn(payload, 'lastState') && payload.lastState !== null && !isRecord(payload.lastState)) {
        failImport('invalid_last_state', 'Der optionale Bereich „lastState“ ist ungültig. Bitte die Importdatei prüfen.');
    }

    const state = payload.lastState;
    if (isRecord(state) && hasOwn(state, 'cumulativeInflationFactor')) {
        const factor = state.cumulativeInflationFactor;
        if (!isValidCumulativeInflationFactor(factor)) {
            failImport('invalid_last_state', 'Der gespeicherte Inflationsfaktor ist ungültig. Bitte eine intakte Exportdatei verwenden.');
        }
    }
    if (isRecord(state?.taxState) && hasOwn(state.taxState, 'lossCarry')) {
        if (!Number.isFinite(state.taxState.lossCarry) || state.taxState.lossCarry < 0) {
            failImport('invalid_last_state', 'Der gespeicherte Verlustvortrag ist ungültig. Bitte eine intakte Exportdatei verwenden.');
        }
    }
    validateAnnualMarketDataMeta(payload[ANNUAL_MARKET_DATA_META_KEY]);
    const marketMeta = payload[ANNUAL_MARKET_DATA_META_KEY];
    // Kein Gleichheitszwang zwischen Meta und Eingaben bei 'year_high': „Allzeithoch“ und „Jahre seit Hoch“
    // bleiben in der Balance änderbar, wie nach der Jahresendregel. Die Meta selbst prüft validateAnnualMarketDataMeta.
    if (
        marketMeta?.sourceType === 'manual_csv' &&
        (
            inputs.endeVJ !== marketMeta.price ||
            inputs.ath !== (
                marketMeta.engineReference?.applied
                    ? marketMeta.engineReference.value
                    : 0
            ) ||
            inputs.jahreSeitAth !== (
                marketMeta.engineReference?.applied
                    ? marketMeta.engineReference.yearsSince
                    : 0
            )
        )
    ) {
        failImport(
            'invalid_market_provenance',
            'Manuelle CSV-Provenienz und persistierte Engine-Marktdaten widersprechen sich.'
        );
    }

    return cloneJson(payload);
}
