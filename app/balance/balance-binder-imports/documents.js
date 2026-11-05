// @ts-check
import { isRecord, failImport, BalanceImportError, hasOwn } from './validation-core.js';
import { readBalanceHouseholdPlan, projectPlanToBalance } from '../../profile/household-plan.js';
import { BALANCE_IMPORT_INPUT_SCHEMA_V2, BALANCE_EXPORT_APP_ID, BALANCE_EXPORT_SCHEMA, BALANCE_EXPORT_SCHEMA_VERSION, BALANCE_IMPORT_INPUT_SCHEMA_VERSION, SUPPORTED_LEGACY_APP_VERSIONS } from './schema.js';
import { migrateCurrentBalanceState, migrateBalanceStateV1 } from './migration.js';
import { validateBalanceState } from './state-validation.js';
import { CONFIG } from '../balance-config.js';

function cloneBalanceStateForExport(payload) {
    if (!isRecord(payload)) {
        failImport('invalid_payload', 'Der Balance-Inhalt ist kein Objekt und kann nicht exportiert werden.');
    }
    if (!isRecord(payload.inputs)) {
        failImport('invalid_inputs', 'Der Pflichtbereich „inputs“ fehlt und kann nicht exportiert werden.');
    }
    try {
        const serialized = JSON.stringify(payload);
        if (typeof serialized !== 'string') {
            failImport('invalid_export_payload', 'Der Balance-Zustand ist nicht als JSON darstellbar.');
        }
        return JSON.parse(serialized);
    } catch (error) {
        if (error instanceof BalanceImportError) throw error;
        failImport('invalid_export_payload', 'Der Balance-Zustand ist nicht verlustfrei als JSON darstellbar.');
    }
}

/**
 * @param payload Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function createBalanceExportDocument(payload, { householdPlan = readBalanceHouseholdPlan() } = {}) {
    const source = cloneBalanceStateForExport(payload);
    if (householdPlan.status === 'valid') {
        // Der Dateivertrag bleibt vollständig; diese Projektion ist keine Profilkopie.
        const planInputs = Object.fromEntries(Object.entries(projectPlanToBalance(householdPlan.entry.values))
            .filter(([key]) => Object.hasOwn(BALANCE_IMPORT_INPUT_SCHEMA_V2, key)));
        source.inputs = { ...source.inputs, ...planInputs };
    }
    const exportPayload = migrateCurrentBalanceState(
        source,
        { preserveInvalidRecoveryState: true }
    );
    const validationWarnings = [];
    try {
        validateBalanceState(exportPayload);
    } catch (error) {
        if (!(error instanceof BalanceImportError)) throw error;
        validationWarnings.push({
            code: error.code || 'invalid_balance_state',
            message: error.message
        });
    }
    return {
        appId: BALANCE_EXPORT_APP_ID,
        schema: BALANCE_EXPORT_SCHEMA,
        schemaVersion: BALANCE_EXPORT_SCHEMA_VERSION,
        inputSchemaVersion: BALANCE_IMPORT_INPUT_SCHEMA_VERSION,
        appVersion: CONFIG.APP.VERSION,
        exportedAt: new Date().toISOString(),
        payload: exportPayload,
        ...(validationWarnings.length > 0 ? { validationWarnings } : {})
    };
}

/**
 * @param document Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function normalizeBalanceImportDocument(document) {
    if (!isRecord(document)) {
        failImport('invalid_document', 'Die Importdatei enthält kein gültiges Balance-Dokument. Bitte eine Balance-Exportdatei auswählen.');
    }

    const looksCurrent = ['appId', 'schema', 'schemaVersion', 'appVersion'].some(key => hasOwn(document, key));
    if (looksCurrent) {
        if (document.appId !== BALANCE_EXPORT_APP_ID) {
            failImport('wrong_app', 'Die Datei gehört nicht zur Balance-App. Bitte die passende Balance-Exportdatei auswählen.');
        }
        if (document.schema !== BALANCE_EXPORT_SCHEMA) {
            failImport('wrong_schema', 'Das Importschema wird von der Balance-App nicht unterstützt. Bitte eine passende Exportdatei verwenden.');
        }
        if (![1, BALANCE_EXPORT_SCHEMA_VERSION].includes(document.schemaVersion)) {
            failImport('unsupported_version', 'Die Importversion wird nicht unterstützt. Bitte die Datei mit einer kompatiblen App-Version exportieren.');
        }
        if (
            document.schemaVersion === BALANCE_EXPORT_SCHEMA_VERSION &&
            document.inputSchemaVersion !== BALANCE_IMPORT_INPUT_SCHEMA_VERSION
        ) {
            failImport(
                'unsupported_input_schema_version',
                'Die Version des Balance-Eingabevertrags wird nicht unterstützt.'
            );
        }
        if (
            document.schemaVersion === 1 &&
            hasOwn(document, 'inputSchemaVersion') &&
            document.inputSchemaVersion !== 1
        ) {
            failImport(
                'unsupported_input_schema_version',
                'Die Version-1-Datei enthält einen widersprüchlichen Eingabevertrag.'
            );
        }
        if (typeof document.appVersion !== 'string' || document.appVersion.trim() === '') {
            failImport('invalid_document', 'Die App-Version der Importdatei fehlt. Bitte eine unveränderte Balance-Exportdatei auswählen.');
        }
        if (typeof document.exportedAt !== 'string' || !Number.isFinite(new Date(document.exportedAt).getTime())) {
            failImport('invalid_document', 'Der Exportzeitpunkt der Importdatei ist ungültig. Bitte eine unveränderte Balance-Exportdatei auswählen.');
        }
        if (document.schemaVersion === 1) {
            return {
                payload: migrateBalanceStateV1(document.payload),
                sourceFormat: 'balance-state-v1',
                migrated: true
            };
        }
        const hadCanonicalRunway = isRecord(document.payload?.inputs)
            && hasOwn(document.payload.inputs, 'liquidityRunwayYears');
        const hadRemovedStrategyFields = isRecord(document.payload?.inputs)
            && ['runwayTargetMonths', 'runwayMinMonths', 'targetEq', 'rebalBand'].some(field => hasOwn(document.payload.inputs, field));
        return {
            payload: validateBalanceState(migrateCurrentBalanceState(document.payload)),
            sourceFormat: 'balance-state-v2',
            migrated: !hadCanonicalRunway || hadRemovedStrategyFields
        };
    }

    const looksLegacy = ['app', 'version', 'payload'].some(key => hasOwn(document, key));
    if (looksLegacy) {
        if (document.app !== CONFIG.APP.NAME) {
            failImport('wrong_app', 'Die Legacy-Datei gehört nicht zur Balance-App. Bitte die passende Balance-Exportdatei auswählen.');
        }
        if (!SUPPORTED_LEGACY_APP_VERSIONS.has(document.version)) {
            failImport('unsupported_legacy_version', 'Diese Legacy-Exportversion wird nicht unterstützt. Bitte zuerst mit einer kompatiblen App-Version migrieren.');
        }
        if (!isRecord(document.payload)) {
            failImport('invalid_payload', 'Der Legacy-Balance-Inhalt fehlt oder ist ungültig. Bitte eine vollständige Balance-Exportdatei auswählen.');
        }
        return {
            payload: migrateBalanceStateV1(document.payload),
            sourceFormat: 'legacy-balance-export-v0',
            migrated: true
        };
    }

    failImport('unknown_shape', 'Die Datei hat weder das aktuelle noch ein unterstütztes Legacy-Balance-Format. Bitte eine unveränderte Balance-Exportdatei auswählen.');
}
