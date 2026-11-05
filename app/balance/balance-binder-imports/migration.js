// @ts-check
import { failImport, cloneJson, isRecord, hasOwn, BalanceImportError } from './validation-core.js';
import { LEGACY_BOOLEAN_INPUT_FIELDS } from './schema.js';
import { migrateLiquidityRunwayInput, LIQUIDITY_RUNWAY_CONTRACT_V1 } from '../../../types/liquidity-runway-contract.js';
import { validateWealthHistoryForImport, validateBalanceState } from './state-validation.js';
import { ANNUAL_MARKET_DATA_META_KEY } from '../balance-annual-marketdata.js';
import { buildManualWindowHighEngineReference, validateAnnualMarketDataMeta } from './market-provenance.js';

function migrateLegacyBoolean(value, fieldPath) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string' && typeof value !== 'number') {
        failImport('invalid_legacy_boolean', `Das Legacy-Booleanfeld „${fieldPath}“ ist ungültig.`);
    }
    const normalized = String(value).trim().toLocaleLowerCase('de-DE');
    if (['true', '1', 'yes', 'ja', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nein', 'off'].includes(normalized)) return false;
    failImport('invalid_legacy_boolean', `Das Legacy-Booleanfeld „${fieldPath}“ enthält keinen unterstützten Wert.`);
}

function migrateLegacyStateV0(payload) {
    const migrated = cloneJson(payload);
    const inputs = migrated.inputs;
    if (isRecord(inputs)) {
        LEGACY_BOOLEAN_INPUT_FIELDS.forEach(field => {
            if (hasOwn(inputs, field)) {
                inputs[field] = migrateLegacyBoolean(inputs[field], `inputs.${field}`);
            }
        });
        if (isRecord(inputs.healthBucket) && hasOwn(inputs.healthBucket, 'enabled')) {
            inputs.healthBucket.enabled = migrateLegacyBoolean(
                inputs.healthBucket.enabled,
                'inputs.healthBucket.enabled'
            );
        }
        const migrateLegacyRefillThreshold = container => {
            if (!isRecord(container) || !hasOwn(container, 'bondRefillThresholdPct')) return;
            if (!hasOwn(container, 'bondRefillThreshold')) {
                container.bondRefillThreshold = container.bondRefillThresholdPct;
            }
            delete container.bondRefillThresholdPct;
        };
        if (isRecord(inputs.decumulation)) {
            migrateLegacyRefillThreshold(inputs.decumulation);
            migrateLegacyRefillThreshold(inputs.decumulation.threeBucket);
        }
        migrated.inputs = migrateBalanceLiquidityRunwayInput(inputs, { dropTargetEq: true });
        delete migrated.inputs.rebalBand;
    }

    if (!isRecord(migrated.lastState)) return migrated;
    const state = migrated.lastState;
    if (!Number.isFinite(state.lastInflationAppliedAtAge)) {
        state.lastInflationAppliedAtAge = 0;
    }
    if (!isRecord(state.taxState)) {
        state.taxState = { lossCarry: 0 };
    } else if (!Number.isFinite(state.taxState.lossCarry) || state.taxState.lossCarry < 0) {
        state.taxState.lossCarry = 0;
    }
    return migrated;
}

function migrateBalanceLiquidityRunwayInput(inputs, options) {
    try {
        return migrateLiquidityRunwayInput(inputs, options);
    } catch (error) {
        if (error instanceof RangeError) {
            failImport(
                'invalid_input_bounds',
                `Das Feld „liquidityRunwayYears“ muss zwischen ${LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears} und ${LIQUIDITY_RUNWAY_CONTRACT_V1.maximumYears} Jahren liegen und ein Vielfaches von ${LIQUIDITY_RUNWAY_CONTRACT_V1.stepYears} Jahren sein.`
            );
        }
        throw error;
    }
}

function migrateLegacyPercentRate(inputs, field) {
    if (!isRecord(inputs) || !hasOwn(inputs, field)) return;
    const value = inputs[field];
    if (typeof value === 'number' && Number.isFinite(value) && value > 1 && value <= 100) {
        inputs[field] = value / 100;
    }
}

/**
 * Version-1-Exporte wurden nur gegen einen kleinen Kernvertrag validiert.
 * Der benannte Migrator normalisiert deshalb ausschliesslich eindeutig
 * rekonstruierbare Repraesentationen und uebergibt das Ergebnis danach an
 * denselben vollstaendigen Vertrag wie ein aktueller V2-Import.
 */
export function migrateBalanceStateV1(payload) {
    if (!isRecord(payload)) {
        failImport('invalid_payload', 'Der Balance-Inhalt ist kein Objekt. Bitte eine unveränderte Balance-Exportdatei auswählen.');
    }
    validateWealthHistoryForImport(payload);
    if (!isRecord(payload.inputs)) {
        failImport('invalid_inputs', 'Der Pflichtbereich „inputs“ fehlt oder ist ungültig. Bitte eine vollständige Balance-Exportdatei auswählen.');
    }

    const migrated = migrateLegacyStateV0(payload);
    const inputs = migrated.inputs;
    migrateLegacyPercentRate(inputs, 'tqfAlt');
    migrateLegacyPercentRate(inputs, 'tqfNeu');

    ['aktuellesAlter', 'floorBedarf', 'flexBedarf'].forEach(field => {
        if (!hasOwn(inputs, field) || typeof inputs[field] !== 'number' || !Number.isFinite(inputs[field])) {
            failImport('invalid_core_value', `Das Pflichtfeld „${field}“ fehlt oder ist keine gültige Zahl.`);
        }
    });
    if (!Number.isInteger(inputs.aktuellesAlter) || inputs.aktuellesAlter < 0 || inputs.aktuellesAlter > 130) {
        failImport('invalid_core_value', 'Das Pflichtfeld „aktuellesAlter“ muss eine ganze Zahl zwischen 0 und 130 sein.');
    }
    [
        'floorBedarf',
        'flexBedarf',
        'minimumFlexAnnual',
        'tagesgeld',
        'geldmarktEtf',
        'depotwertAlt',
        'depotwertNeu',
        'goldWert',
        'costBasisAlt',
        'costBasisNeu',
        'goldCost'
    ].forEach(field => {
        if (!hasOwn(inputs, field)) return;
        if (typeof inputs[field] !== 'number' || !Number.isFinite(inputs[field]) || inputs[field] < 0) {
            failImport('invalid_core_value', `Das Feld „${field}“ muss eine nichtnegative, endliche Zahl sein.`);
        }
    });
    if (
        Number.isFinite(inputs.minimumFlexAnnual) &&
        inputs.minimumFlexAnnual > inputs.flexBedarf
    ) {
        failImport('invalid_core_value', 'Das Feld „minimumFlexAnnual“ darf den Flex-Bedarf nicht überschreiten.');
    }

    const marketMeta = migrated[ANNUAL_MARKET_DATA_META_KEY];
    if (marketMeta?.sourceType === 'manual_csv') {
        if (
            marketMeta.high?.engineAthAvailable === false &&
            !hasOwn(marketMeta.high, 'verifiedAllTimeHighAvailable')
        ) {
            marketMeta.high.verifiedAllTimeHighAvailable = false;
            delete marketMeta.high.engineAthAvailable;
        }
        if (
            marketMeta.high?.scope === 'windowHigh' &&
            Number.isFinite(marketMeta.high.value) &&
            Number.isInteger(marketMeta.high.yearsSince) &&
            marketMeta.high.yearsSince >= 0
        ) {
            marketMeta.engineReference = buildManualWindowHighEngineReference(
                marketMeta.price,
                marketMeta.high
            );
            inputs.ath = marketMeta.engineReference.applied
                ? marketMeta.engineReference.value
                : 0;
            inputs.jahreSeitAth = marketMeta.engineReference.applied
                ? marketMeta.engineReference.yearsSince
                : 0;
        }
        validateAnnualMarketDataMeta(marketMeta);
    }

    return validateBalanceState(migrated);
}

export function migrateCurrentBalanceState(payload, { preserveInvalidRecoveryState = false } = {}) {
    if (!preserveInvalidRecoveryState) validateWealthHistoryForImport(payload);
    const migrated = cloneJson(payload);
    if (isRecord(migrated?.inputs)) {
        try {
            migrated.inputs = migrateBalanceLiquidityRunwayInput(migrated.inputs, { dropTargetEq: true });
            delete migrated.inputs.rebalBand;
        } catch (error) {
            if (!(preserveInvalidRecoveryState
                && error instanceof BalanceImportError
                && error.code === 'invalid_input_bounds')) {
                throw error;
            }
        }
    }
    return migrated;
}
