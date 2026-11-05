// @ts-check
import { failImport, isRecord, hasOwn } from './validation-core.js';
import { DECUMULATION_FIELDS, HEALTH_BUCKET_FIELDS, GOLD_STRATEGY_DIAGNOSTIC_FIELDS, BALANCE_IMPORT_INPUT_SCHEMA_V2 } from './schema.js';
import { normalizeTrancheCollection } from '../../../types/tranche-contract.js';
import { LIQUIDITY_RUNWAY_CONTRACT_V1 } from '../../../types/liquidity-runway-contract.js';

function validateSchemaField(fieldPath, value, descriptor) {
    if (descriptor.type === 'number' || descriptor.type === 'nullableNumber') {
        if (value === null && descriptor.type === 'nullableNumber') return;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            failImport('invalid_input_type', `Das Importfeld „${fieldPath}“ muss eine endliche Zahl sein.`);
        }
        if (descriptor.integer && !Number.isInteger(value)) {
            failImport('invalid_input_type', `Das Importfeld „${fieldPath}“ muss eine ganze Zahl sein.`);
        }
        if (descriptor.min !== null && descriptor.min !== undefined && value < descriptor.min) {
            failImport('invalid_input_bounds', `Das Importfeld „${fieldPath}“ unterschreitet die erlaubte Untergrenze ${descriptor.min}.`);
        }
        if (descriptor.max !== null && descriptor.max !== undefined && value > descriptor.max) {
            failImport('invalid_input_bounds', `Das Importfeld „${fieldPath}“ überschreitet die erlaubte Obergrenze ${descriptor.max}.`);
        }
        if (descriptor.step) {
            const stepBase = descriptor.min ?? 0;
            const steps = (value - stepBase) / descriptor.step;
            if (Math.abs(steps - Math.round(steps)) >= 1e-9) {
                failImport(
                    'invalid_input_bounds',
                    `Das Importfeld „${fieldPath}“ muss ein Vielfaches von ${descriptor.step} ab ${stepBase} sein.`
                );
            }
        }
        if (descriptor.enum && !descriptor.enum.includes(value)) {
            failImport('invalid_input_value', `Das Importfeld „${fieldPath}“ enthält einen nicht unterstützten Zahlenwert.`);
        }
        return;
    }
    if (descriptor.type === 'boolean') {
        if (typeof value !== 'boolean') {
            failImport('invalid_boolean', `Das Importfeld „${fieldPath}“ muss ein echter Boolean sein.`);
        }
        return;
    }
    if (descriptor.type === 'string') {
        if (typeof value !== 'string' || value.length > descriptor.maxLength) {
            failImport('invalid_input_type', `Das Importfeld „${fieldPath}“ muss ein zulässiger Text sein.`);
        }
        if (descriptor.enum && !descriptor.enum.includes(value)) {
            failImport('invalid_input_value', `Das Importfeld „${fieldPath}“ enthält einen nicht unterstützten Wert.`);
        }
        return;
    }
    if (descriptor.type === 'decumulationNested') {
        if (!isRecord(value)) {
            failImport('invalid_input_type', `Das Importfeld „${fieldPath}“ muss ein Objekt sein.`);
        }
        return;
    }
    failImport('invalid_input_schema', `Für das Importfeld „${fieldPath}“ fehlt ein unterstützter Feldvertrag.`);
}

function validateRecordAgainstSchema(record, schema, pathPrefix) {
    if (!isRecord(record)) {
        failImport('invalid_input_type', `Der Importbereich „${pathPrefix}“ muss ein Objekt sein.`);
    }
    const unknownFields = Object.keys(record).filter(field => !hasOwn(schema, field));
    if (unknownFields.length > 0) {
        failImport(
            'unknown_input_field',
            `Der Importbereich „${pathPrefix}“ enthält nicht unterstützte Felder: ${unknownFields.join(', ')}.`
        );
    }
    Object.entries(schema).forEach(([field, descriptor]) => {
        if (!hasOwn(record, field)) {
            if (descriptor.required) {
                failImport('missing_input_field', `Das Pflichtfeld „${pathPrefix}.${field}“ fehlt.`);
            }
            return;
        }
        validateSchemaField(`${pathPrefix}.${field}`, record[field], descriptor);
    });
}

function validateDecumulation(value, path = 'inputs.decumulation') {
    validateRecordAgainstSchema(value, DECUMULATION_FIELDS, path);
    if (hasOwn(value, 'threeBucket')) {
        const nested = value.threeBucket;
        if (!isRecord(nested)) {
            failImport('invalid_input_type', `Das Importfeld „${path}.threeBucket“ muss ein Objekt sein.`);
        }
        const nestedSchema = {
            bondTargetFactor: DECUMULATION_FIELDS.bondTargetFactor,
            drawdownTrigger: DECUMULATION_FIELDS.drawdownTrigger,
            bondRefillThreshold: DECUMULATION_FIELDS.bondRefillThreshold
        };
        validateRecordAgainstSchema(nested, nestedSchema, `${path}.threeBucket`);
    }
}

function validateHealthBucket(value, path = 'inputs.healthBucket') {
    validateRecordAgainstSchema(value, HEALTH_BUCKET_FIELDS, path);
}

function validateTranchesOrNull(value, path = 'inputs.detailledTranches') {
    if (value === null) return;
    if (!Array.isArray(value)) {
        failImport('invalid_input_type', `Das Importfeld „${path}“ muss ein Array oder null sein.`);
    }
    try {
        normalizeTrancheCollection(value, { mode: 'engine' });
    } catch {
        failImport(
            'invalid_input_value',
            `Das Importfeld „${path}“ verletzt den kanonischen Tranchenvertrag.`
        );
    }
}

function validateGoldStrategyDiagnostics(value, path = 'inputs.goldStrategyDiagnostics') {
    if (!Array.isArray(value)) {
        failImport('invalid_input_type', `Das Importfeld „${path}“ muss ein Array sein.`);
    }
    value.forEach((entry, index) => {
        validateRecordAgainstSchema(entry, GOLD_STRATEGY_DIAGNOSTIC_FIELDS, `${path}[${index}]`);
        if (entry.operativeLiquidity > entry.assetBase) {
            failImport(
                'invalid_core_value',
                `Das Feld „${path}[${index}].operativeLiquidity“ darf die Vermögensbasis nicht überschreiten.`
            );
        }
        if (entry.excludedHealthBucket > entry.operativeLiquidity) {
            failImport(
                'invalid_core_value',
                `Das Feld „${path}[${index}].excludedHealthBucket“ darf die operative Liquidität nicht überschreiten.`
            );
        }
        if (entry.freeAssetBase !== entry.assetBase - entry.excludedHealthBucket) {
            failImport(
                'invalid_core_value',
                `Die freie Vermögensbasis in „${path}[${index}]“ ist inkonsistent.`
            );
        }
    });
}

export function validateBalanceInputsAgainstSchema(inputs) {
    if (!isRecord(inputs)) {
        failImport('invalid_inputs', 'Der Pflichtbereich „inputs“ fehlt oder ist ungültig. Bitte eine vollständige Balance-Exportdatei auswählen.');
    }
    const unknownFields = Object.keys(inputs).filter(field => !hasOwn(BALANCE_IMPORT_INPUT_SCHEMA_V2, field));
    if (unknownFields.length > 0) {
        failImport(
            'unknown_input_field',
            `Der Balance-Import enthält nicht unterstützte Eingabefelder: ${unknownFields.join(', ')}.`
        );
    }

    Object.entries(BALANCE_IMPORT_INPUT_SCHEMA_V2).forEach(([field, descriptor]) => {
        if (!hasOwn(inputs, field)) {
            if (descriptor.required) {
                failImport('missing_input_field', `Das Pflichtfeld „inputs.${field}“ fehlt.`);
            }
            return;
        }
        const value = inputs[field];
        if (descriptor.type === 'decumulation') {
            validateDecumulation(value);
        } else if (descriptor.type === 'healthBucket') {
            validateHealthBucket(value);
        } else if (descriptor.type === 'tranchesOrNull') {
            validateTranchesOrNull(value);
        } else if (descriptor.type === 'goldStrategyDiagnostics') {
            validateGoldStrategyDiagnostics(value);
        } else {
            validateSchemaField(`inputs.${field}`, value, descriptor);
        }
    });

    if (inputs.liquidityCashMonths > (inputs.liquidityRunwayYears ?? LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears) * 12) {
        failImport('invalid_core_value', 'davon im Tagesgeld ist größer als die Reichweite – eines davon anpassen');
    }

    if (
        Number.isFinite(inputs.minimumFlexAnnual) &&
        Number.isFinite(inputs.flexBedarf) &&
        inputs.minimumFlexAnnual > inputs.flexBedarf
    ) {
        failImport('invalid_core_value', 'Das Feld „minimumFlexAnnual“ darf den Flex-Bedarf nicht überschreiten. Bitte die Importdatei prüfen.');
    }
    if (
        Number.isFinite(inputs.capeRatio) &&
        Number.isFinite(inputs.marketCapeRatio) &&
        inputs.capeRatio !== inputs.marketCapeRatio
    ) {
        failImport('invalid_core_value', 'Die CAPE-Aliasfelder des Imports widersprechen sich.');
    }
    if (isRecord(inputs.healthBucket)) {
        const mirroredFields = {
            enabled: 'healthBucketEnabled',
            initialAmount: 'healthBucketInitialAmount',
            assetSource: 'healthBucketAssetSource',
            triggerMinGrade: 'healthBucketTriggerMinGrade',
            triggerMode: 'healthBucketTriggerMode',
            coverageMode: 'healthBucketCoverageMode',
            returnMode: 'healthBucketReturnMode',
            targetMode: 'healthBucketTargetMode'
        };
        Object.entries(mirroredFields).forEach(([nestedField, flatField]) => {
            if (
                hasOwn(inputs.healthBucket, nestedField) &&
                hasOwn(inputs, flatField) &&
                inputs.healthBucket[nestedField] !== inputs[flatField]
            ) {
                failImport('invalid_core_value', `Die Pflegebucket-Felder „healthBucket.${nestedField}“ und „${flatField}“ widersprechen sich.`);
            }
        });
    }
}
