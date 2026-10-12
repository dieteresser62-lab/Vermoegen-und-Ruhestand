import { registeredPlanTrial, planTrialPatch, planTrialDifferences } from '../shared/plan-trial.js';
import { readBalanceInflationSource, renderBalanceInflationSource } from './balance-inflation-source.js';
import { BALANCE_STORAGE_FIELD_IDS, buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { readBalancePersonStatus, projectParticipatingPerson } from '../shared/person-data-status.js';
import { PLAN_FIELDS, BALANCE_PLAN_INPUT_KEYS, HOUSEHOLD_PLAN_KEY, buildPlanRecord, readBalanceHouseholdPlan, projectPlanToBalance, assertPlanValues } from '../profile/household-plan.js';
import { validateBalanceInputs } from './balance-update-pipeline.js';
/**
 * Module: Balance Reader
 * Purpose: Responsible for reading and parsing all user inputs from the DOM.
 *          Handles currency parsing, boolean conversion, and aggregating detailed tranche data.
 * Usage: Used by balance-main.js to gather the current application state before updates.
 * Dependencies: balance-utils.js, depot-tranchen-status.js
 */
"use strict";

/**
 * ===================================================================================
 * BALANCE-APP UI-EINGABE-LESER
 * ===================================================================================
 */

import { UIUtils } from './balance-utils.js';
import {
    TRANCHE_STATUS_STATES,
    calculateAggregatedValues,
    getTranchenStatus
} from '../tranches/depot-tranchen-status.js';
import { CONFIG, ValidationError } from './balance-config.js';
import { LIQUIDITY_RUNWAY_CONTRACT_V1 } from '../../types/liquidity-runway-contract.js';
import {
    PROFILE_STORAGE_KEYS,
    PROFILE_VALUE_KEYS,
    readProfileHealthBucketFromStorage,
    readProfileOverridesFromStorage, parseProfileOverridesFromData, parseProfileHealthBucketFromData
} from '../profile/profile-state.js';
import { assertProfileDataLoadable } from '../profile/profile-storage.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { LONGEVITY_DEFAULTS, normalizeLongevityMode } from '../simulator/dynamic-flex-longevity-contract.js';

// Module-level DOM reference
let dom = null;
let hasLoggedTranchenAggregation = false;

const REQUIRED_BALANCE_CURRENCY_FIELDS = new Set([
    'floorBedarf',
    'flexBedarf',
    'minimumFlexAnnual'
]);

const BALANCE_CURRENCY_FIELD_LABELS = Object.freeze({
    floorBedarf: 'Floor-Bedarf p.a.',
    flexBedarf: 'Flex-Bedarf p.a.',
    minimumFlexAnnual: 'Mindest-Flex p.a.',
    flexBudgetAnnual: 'Flex-Budget p.a.',
    flexBudgetRecharge: 'Flex-Budget-Aufladung',
    tagesgeld: 'Tagesgeld',
    geldmarktEtf: 'Geldmarkt-ETF',
    depotwertAlt: 'Alt-Depot',
    depotwertNeu: 'Neu-Depot',
    goldWert: 'Goldwert',
    renteMonatlich: 'Monatliche Rente',
    costBasisAlt: 'Kostenbasis Alt-Depot',
    costBasisNeu: 'Kostenbasis Neu-Depot',
    goldCost: 'Kostenbasis Gold',
    sparerPauschbetrag: 'Sparer-Pauschbetrag'
});

/**
 * Liest einen Balance-Waehrungswert ueber den strukturierten Parser-Contract.
 * Pflichtfelder bleiben von optionalen Leerwerten und von der gueltigen 0
 * unterscheidbar; ungueltige Teilstrings werden feldbezogen abgewiesen.
 */
export function parseBalanceCurrencyInput(
    fieldId,
    rawValue,
    { required = REQUIRED_BALANCE_CURRENCY_FIELDS.has(fieldId) } = {}
) {
    const result = UIUtils.parseCurrencyResult(rawValue, { required });
    if (result.valid) return result.value ?? 0;

    const label = BALANCE_CURRENCY_FIELD_LABELS[fieldId] || fieldId;
    let message = `${label} enthaelt keine gueltige vollstaendige Zahl.`;
    if (result.error.code === 'number_required') {
        message = `${label} darf nicht leer sein.`;
    } else if (result.error.code === 'number_non_finite') {
        message = `${label} muss eine endliche Zahl sein.`;
    }
    throw new ValidationError([{
        fieldId,
        message,
        code: result.error.code
    }]);
}

/**
 * Initialisiert den UIReader mit DOM-Referenzen
 *
 * @param {Object} domRefs - Objekt mit DOM-Elementreferenzen (inputs, controls)
 */
export function initUIReader(domRefs) {
    dom = domRefs;
    UIReader.planFormSource = null;
}

export function getMarketDataProvenanceViewModel(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return {
            available: false,
            text: 'Keine persistierte Marktdaten-Provenienz.',
            schemaVersion: null,
            periodId: null,
            asOf: null,
            source: null,
            instrument: null,
            highScope: null,
            enginePolicy: null,
            engineReferenceApplied: null
        };
    }
    const instrument = String(meta.instrument || meta.ticker || 'unbekannt');
    const source = String(meta.source || 'unbekannt');
    const periodId = String(meta.periodId || 'ohne Periode');
    const asOf = String(meta.asOf || 'ohne Stichtag');
    const highScope = String(
        meta.highScope ||
        meta.high?.scope ||
        meta.ath?.scope ||
        (Number.isFinite(meta.ath?.value) ? 'allTimeHigh' : 'unbekannt')
    );
    const coverage = meta.coverage && typeof meta.coverage === 'object'
        ? `; Abdeckung ${meta.coverage.start || '?'} bis ${meta.coverage.end || '?'} (${meta.coverage.rowCount ?? '?'} Zeilen)`
        : '';
    const importTime = meta.importedAt ? `; Import ${meta.importedAt}` : '';
    const enginePolicy = typeof meta.engineReference?.policy === 'string'
        ? meta.engineReference.policy
        : null;
    const engineReferenceApplied = typeof meta.engineReference?.applied === 'boolean'
        ? meta.engineReference.applied
        : null;
    const engineReference = enginePolicy === 'window_high_as_conservative_ath_lower_bound'
        ? (
            engineReferenceApplied === true
                ? '; Engine-Referenz: konservative ATH-Untergrenze angewendet'
                : '; Engine-Referenz: nicht angewendet (kein belegter Fensterabstand)'
        )
        : '';
    return {
        available: true,
        text: `${instrument} · ${periodId} · Stichtag ${asOf} · ${source} · Hoch-Scope ${highScope}${engineReference}${coverage}${importTime}`,
        schemaVersion: Number.isInteger(meta.schemaVersion) ? meta.schemaVersion : null,
        periodId,
        asOf,
        source,
        instrument,
        highScope,
        enginePolicy,
        engineReferenceApplied
    };
}

export const UIReader = {
    planFormSource: null,
    applyHouseholdPlanInputs() {
        const plan = readBalanceHouseholdPlan();
        if (plan.status !== 'valid') { this.planFormSource = null; return plan; }
        if (registeredPlanTrial(globalThis.document)?.read().active) return plan;
        this.applyStoredInputs(projectPlanToBalance(plan.entry.values));
        if (dom.inputs['profilverbund-withdrawal-mode']) dom.inputs['profilverbund-withdrawal-mode'].value = plan.entry.values.householdWithdrawalMode;
        // Null ist ein bewusst nicht gesetzter Schwellenwert, kein altes Formularfeld.
        if (dom.inputs.bondRefillThreshold && plan.entry.values.decumulation.bondRefillThreshold === null) dom.inputs.bondRefillThreshold.value = '';
        this.planFormSource = { scopeKey: plan.scope.key, capeMetaRaw: JSON.stringify(JSON.parse(persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY) || '{}').capeMeta || null), fields: Object.fromEntries(Object.entries(dom.inputs)
            .map(([key, field]) => [key, [String(field.value ?? ''), field.checked === true]])) };
        registeredPlanTrial(globalThis.document)?.render?.({ project: true });
        renderBalanceInflationSource(globalThis.document, { scope: plan.scope });
        return plan;
    },
    /** Nur seit Befüllung ausdrücklich geänderte Planfelder, strikt statt beschneidend. */
    readHouseholdPlanPatch(plan = readBalanceHouseholdPlan()) {
        if (plan.status !== 'valid') return {};
        const trial = registeredPlanTrial(globalThis.document);
        if (trial) {
            if (!trial.read().active) return {};
            // Auch im Versuch bleiben Mindest-Flex-Fehler feldbezogen und
            // durchlaufen denselben Validierungsweg wie das Altformular.
            validateBalanceInputs({
                minimumFlexAnnual: parseBalanceCurrencyInput('minimumFlexAnnual', dom.inputs.minimumFlexAnnual.value),
                flexBedarf: parseBalanceCurrencyInput('flexBedarf', dom.inputs.flexBedarf.value)
            });
            trial.capture?.();
            return planTrialPatch(planTrialDifferences(plan.entry.values, trial.values()));
        }
        const patch = {};
        const source = this.planFormSource;
        if (source && source.scopeKey !== plan.scope.key) throw new Error('Planbereich hat sich geändert. Bitte neu laden.');
        const changed = id => source && dom.inputs[id] && JSON.stringify(source.fields[id])
            !== JSON.stringify([String(dom.inputs[id].value ?? ''), dom.inputs[id].checked === true]);
        const read = (id, original) => {
            const field = dom.inputs[id];
            if (typeof original === 'boolean') return field.checked === true;
            if (typeof original === 'string') return String(field.value);
            if (original === null && String(field.value).trim() === '') return null;
            if (field.classList.contains('currency')) return parseBalanceCurrencyInput(id, field.value);
            const raw = String(field.value).trim().replace(',', '.');
            return raw && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw) : NaN;
        };
        for (const key of PLAN_FIELDS.filter(key => !['cape', 'decumulation'].includes(key))) {
            const id = key === 'householdWithdrawalMode' ? 'profilverbund-withdrawal-mode' : key;
            if (changed(id)) patch[key] = read(id, plan.entry.values[key]);
        }
        for (const [key, value] of Object.entries(plan.entry.values.decumulation)) {
            const id = key === 'mode' ? 'entnahmeStrategie' : key;
            if (changed(id)) { patch.decumulation ??= {}; patch.decumulation[key] = read(id, value); }
        }
        const capeId = dom.inputs.marketCapeRatio ? 'marketCapeRatio' : 'capeRatio';
        if (changed(capeId)) patch.cape = { value: read(capeId, plan.entry.values.cape.value), asOf: null, source: null };
        // Bereits bestätigte Jahresmarktdaten haben Vorrang vor der gerundeten Anzeige.
        const stateRaw = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const meta = stateRaw ? JSON.parse(stateRaw).capeMeta : null;
        if (source && source.capeMetaRaw !== JSON.stringify(meta || null) && meta && meta.capeFetchStatus !== 'error_no_source_no_stored'
            && Number.isFinite(meta.capeRatio) && meta.capeRatio > 0) {
            patch.cape = { value: Number(meta.capeRatio.toFixed(1)), asOf: meta.capeAsOf || null, source: meta.capeSource || null };
        }
        const values = { ...plan.entry.values, ...patch,
            decumulation: { ...plan.entry.values.decumulation, ...patch.decumulation },
            cape: { ...plan.entry.values.cape, ...patch.cape } };
        validateBalanceInputs(values);
        try { assertPlanValues(values); }
        catch (error) { throw new ValidationError([{ fieldId: 'minimumFlexAnnual', message: error.message }]); }
        return patch;
    },
    /** Formularbesitzer: isolierte Rohrecordprojektion; kein Fachwrite und keine Fensteraggregate. */
    captureStorageDraft(metadata = {}, { includePreviewBase = false } = {}) {
        for (const id of REQUIRED_BALANCE_CURRENCY_FIELDS) {
            if (dom.inputs[id]) parseBalanceCurrencyInput(id, dom.inputs[id].value);
        }
        const plan = readBalanceHouseholdPlan();
        const patch = this.readHouseholdPlanPatch(plan);
        if (plan.status === 'valid') {
            const own = readBalanceHouseholdPlan({ profileId: persistenceStorage.getItem('rs_current_profile') });
            if (!registeredPlanTrial(globalThis.document)?.read().active && own.scope.key !== plan.scope.key && Object.keys(patch).length) throw new Error('Die geöffnete Außenperson darf den Haushaltsplan nicht ändern.');
        }
        const state = JSON.parse(persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY) || '{}');
        const trial = registeredPlanTrial(globalThis.document);
        const trialState = trial?.read();
        // Im leeren Demo-Bestand stammen Personenwerte weiterhin aus dem Formular.
        // Reguläre Profile behalten die zentrale Personenprojektion als Besitzer.
        const isDemo = readBalancePersonStatus().status === 'demo';
        const fields = Object.fromEntries(Object.entries(dom.inputs)
            .filter(([id]) => BALANCE_STORAGE_FIELD_IDS.includes(id) && (isDemo || !['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'sonstigeEinkuenfte', 'sparerPauschbetrag', 'kirchensteuerSatz'].includes(id))
                && (plan.status !== 'valid' || !BALANCE_PLAN_INPUT_KEYS.includes(id) && id !== 'profilverbund-withdrawal-mode'))
            .map(([id, field]) => [id, { value: String(id === 'inflation' ? readBalanceInflationSource({ scope: plan.scope }).value : field.value ?? ''), checked: field.checked === true }]));
        const nextState = { ...state, inputs: { ...state.inputs, ...metadata }, balanceInputFields: fields };
        const values = plan.status === 'valid' ? { ...plan.entry.values, ...patch,
            cape: { ...plan.entry.values.cape, ...patch.cape }, decumulation: { ...plan.entry.values.decumulation, ...patch.decumulation } } : null;
        const planRaw = values ? buildPlanRecord(plan.raw, [{ scope: plan.scope, values }]).raw : plan.raw;
        const storage = { getItem: key => key === CONFIG.STORAGE.LS_KEY ? JSON.stringify(nextState)
            : key === HOUSEHOLD_PLAN_KEY ? planRaw : persistenceStorage.getItem(key) };
        const calculation = buildBalanceEngineInputFromStorage({ scope: plan.scope, storage });
        if (trialState?.active && trial.localValues().rebalancingBand !== undefined) {
            const band = trial.localValues().rebalancingBand;
            calculation.inputData.rebalancingBand = band;
            calculation.readerInputData.rebalancingBand = band;
            calculation.profiles = calculation.profiles.map(entry => ({ ...entry, inputs: { ...entry.inputs, rebalancingBand: band } }));
            calculation.history.profiles = calculation.profiles;
        }
        return { storage, patch, fields, plan, trialActive: trialState?.active === true,
            deviationApplied: Boolean(trialState?.active && trialState.differences.length), source: this.readInputSourceFingerprint(),
            // Nur Vorschauen benötigen die unkorrigierte Speicherbasis. Ein ungültiger
            // Altstand darf die Bestätigung eines gültigen Formulars nicht sperren.
            baseSourceFingerprint: includePreviewBase
                ? buildBalanceEngineInputFromStorage({ scope: plan.scope, storage: persistenceStorage }).sourceFingerprint : null,
            calculation };
    },
    /** Rohwerte binden auch direkte Änderungen ohne Inputevent; keine erneute Fachaggregation. */
    readInputSourceFingerprint() {
        return JSON.stringify([Object.entries(dom.inputs).map(([id, field]) =>
            [id, field?.value, field?.checked]), globalThis.window?.__profilverbundPersonSPB]);
    },
    /**
     * Liest alle Benutzereingaben aus dem Formular
     *
     * Sammelt sämtliche Input-Werte (Alter, Vermögen, Bedarf, Marktdaten,
     * Steuern, Guardrail-Parameter etc.) und konvertiert sie in die
     * für die Engine erforderlichen Datentypen.
     *
     * @returns {Object} Strukturiertes Eingabeobjekt mit allen Parametern
     * @property {number} aktuellesAlter - Aktuelles Lebensalter
     * @property {number} floorBedarf - Jährlicher Grundbedarf (€)
     * @property {number} flexBedarf - Jährlicher flexibler Zusatzbedarf (€)
     * @property {number} inflation - Inflationsrate (%)
     * @property {number} tagesgeld - Tagesgeld-Guthaben (€)
     * @property {number} geldmarktEtf - Geldmarkt-ETF-Wert (€)
     * @property {number} depotwertAlt - Wert des Alt-Depots (€)
     * @property {number} depotwertNeu - Wert des Neu-Depots (€)
     * @property {number} goldWert - Wert der Goldbestände (€)
     * @property {number} endeVJ - ETF-Kurs Jahresende (%)
     * @property {number} endeVJ_1 - ETF-Kurs vor 1 Jahr (%)
     * @property {number} endeVJ_2 - ETF-Kurs vor 2 Jahren (%)
     * @property {number} endeVJ_3 - ETF-Kurs vor 3 Jahren (%)
     * @property {number} ath - All-Time-High des ETF (%)
     * @property {number} jahreSeitAth - Jahre seit ATH
     * @property {boolean} renteAktiv - Rente bereits aktiv
     * @property {number} renteMonatlich - Monatliche Rente (€)
     * @property {string} risikoprofil - Risikoprofil (immer 'sicherheits-dynamisch')
     * @property {boolean} goldAktiv - Gold-Modul aktiviert
     * @property {number} goldZielProzent - Gold-Zielanteil (%)
     * @property {number} goldFloorProzent - Gold-Floor-Anteil (%)
     * @property {boolean} goldSteuerfrei - Gold steuerfrei nach 1 Jahr
     * @property {number} rebalancingBand - Rebalancing-Band (%)
     * @property {number} costBasisAlt - Kostenbasis Alt-Depot (€)
     * @property {number} costBasisNeu - Kostenbasis Neu-Depot (€)
     * @property {number} tqfAlt - Teilfreistellungsquote Alt-Depot (%)
     * @property {number} tqfNeu - Teilfreistellungsquote Neu-Depot (%)
     * @property {number} goldCost - Kostenbasis Gold (€)
     * @property {number} kirchensteuerSatz - Kirchensteuersatz als Dezimalrate (0.08 = 8 %)
     * @property {number} sparerPauschbetrag - Sparerpauschbetrag (€)
     * @property {number} liquidityRunwayYears - Ziel-Liquiditäts-Runway (Jahre)
     * @property {number} maxSkimPctOfEq - Max. Skimming-Prozent von Equity (%)
     * @property {number} maxBearRefillPctOfEq - Max. Bear-Refill-Prozent von Equity (%)
     */
    readAllInputs() {
        const num = (id) => dom.inputs[id]
            ? parseBalanceCurrencyInput(id, dom.inputs[id].value)
            : 0;
        const val = (id) => dom.inputs[id] ? dom.inputs[id].value : '';
        const finiteNumber = (id, fallback = 0, { integer = false } = {}) => {
            const rawValue = val(id);
            if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
                return fallback;
            }
            const raw = String(rawValue).trim();
            if (raw.includes('.') && raw.includes(',')) return fallback;
            const normalized = raw.includes(',') ? raw.replace(',', '.') : raw;
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
                return fallback;
            }
            const parsed = Number(normalized);
            if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) return fallback;
            return parsed;
        };
        const checked = (id) => dom.inputs[id] ? dom.inputs[id].checked : false;
        const readPersistedCapeRatio = () => {
            try {
                const raw = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                const direct = Number(parsed?.capeMeta?.capeRatio);
                if (Number.isFinite(direct) && direct > 0) return direct;
                const legacy = Number(parsed?.inputs?.capeRatio);
                if (Number.isFinite(legacy) && legacy > 0) return legacy;
                return null;
            } catch {
                return null;
            }
        };

        // Profilwerte (localStorage) überschreiben DOM-Werte, wenn vorhanden.
        const readiness = readBalancePersonStatus();
        if (readiness.status === 'corrupt') throw readiness.error;
        if (!readiness.ready) throw new ValidationError([{ fieldId: 'aktuellesAlter', code: 'person_data_incomplete', message: readiness.message }]);
        // Nur den ausgewählten Rechenumfang lesend prüfen; Schäden mit Profilname
        // und Rohwert über die bestehende Recovery melden, bevor projiziert wird.
        if (readiness.status !== 'demo') {
            const registryRaw = persistenceStorage.getItem(PROFILE_STORAGE_KEYS.registry);
            for (const entry of readiness.entries) {
                assertProfileDataLoadable(entry.profileId, {
                    meta: { name: entry.name }, data: entry.data
                }, { registryRaw });
            }
        }
        const selectedData = readiness.entries?.find(entry => entry.profileId === readiness.calculationProfileId)?.data;
        const profileOverrides = selectedData ? parseProfileOverridesFromData(selectedData) : readProfileOverridesFromStorage(persistenceStorage);
        const profileTagesgeld = profileOverrides.profileTagesgeld;
        const person = readiness.status === 'demo' ? {
            startAlter: finiteNumber('aktuellesAlter', 0, { integer: true }), renteMonatlich: num('renteMonatlich'),
            sonstigeEinkuenfte: 0, startSPB: num('sparerPauschbetrag'), kirchensteuerSatz: finiteNumber('kirchensteuerSatz')
        } : projectParticipatingPerson(readiness, persistenceStorage.getItem('rs_current_profile'));
        const profileRenteMonatlich = readiness.status === 'demo' || person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12;
        const profileSonstigeEinkuenfte = person.sonstigeEinkuenfte;
        const profileRenteAktiv = profileRenteMonatlich + profileSonstigeEinkuenfte > 0;
        const profileAlter = person.startAlter;
        const profileGoldAktiv = profileOverrides.profileGoldAktiv;
        const profileGoldZiel = profileOverrides.profileGoldZiel;
        const profileGoldFloor = profileOverrides.profileGoldFloor;
        const profileGoldSteuerfrei = profileOverrides.profileGoldSteuerfrei;
        const profileGoldRebalBand = profileOverrides.profileGoldRebalBand;
        const healthBucket = selectedData ? parseProfileHealthBucketFromData(selectedData) : readProfileHealthBucketFromStorage(persistenceStorage);
        // Der Statuspfad trennt nicht geladen, explizit leer, gültig und fehlerhaft.
        // Ein leeres Profilverbund-Override ist kanonisch leer und darf weder auf
        // DOM-Werte noch auf den aktuell gespeicherten Profilbestand zurückfallen.
        const trancheStatus = getTranchenStatus();
        if (trancheStatus.state === TRANCHE_STATUS_STATES.ERROR) {
            throw new ValidationError([{
                fieldId: 'detailledTranches',
                code: trancheStatus.errorCode || 'tranche_status_error',
                message: 'Der Tranchenbestand ist fehlerhaft und kann nicht für die Berechnung verwendet werden.'
            }]);
        }
        const detailledTranches = trancheStatus.state === TRANCHE_STATUS_STATES.VALID
            ? trancheStatus.tranches
            : [];
        const explicitEmptyOverride = trancheStatus.source === 'override'
            && trancheStatus.state === TRANCHE_STATUS_STATES.EMPTY;
        const aggregated = trancheStatus.state === TRANCHE_STATUS_STATES.VALID
            ? calculateAggregatedValues(detailledTranches)
            : (explicitEmptyOverride ? {
                depotwertAlt: 0,
                costBasisAlt: 0,
                depotwertNeu: 0,
                costBasisNeu: 0,
                geldmarktEtf: 0,
                goldWert: 0,
                goldCost: 0,
                bondsWert: 0,
                bondsCost: 0
            } : null);

        const useAggregates = aggregated !== null;

        if (useAggregates && !hasLoggedTranchenAggregation) {
            hasLoggedTranchenAggregation = true;
        }

        // Fallback-Defaults für Gold, wenn Inputs unplausibel/leer sind.
        const DEFAULT_GOLD_ZIEL = 7.5;
        const DEFAULT_GOLD_FLOOR = 1;
        const DEFAULT_GOLD_BAND = 25;

        let goldAktivFinal = (typeof profileGoldAktiv === 'boolean') ? profileGoldAktiv : checked('goldAktiv');
        let goldZielFinal = Number.isFinite(profileGoldZiel)
            ? profileGoldZiel
            : finiteNumber('goldZielProzent', Number.NaN);
        let goldFloorFinal = Number.isFinite(profileGoldFloor) ? profileGoldFloor : (parseFloat(val('goldFloorProzent')) || 0);
        let goldSteuerfreiFinal = (typeof profileGoldSteuerfrei === 'boolean') ? profileGoldSteuerfrei : checked('goldSteuerfrei');
        let rebalancingBandFinal = Number.isFinite(profileGoldRebalBand)
            ? profileGoldRebalBand
            : finiteNumber('rebalancingBand', Number.NaN);

        if (!Number.isFinite(goldZielFinal) || goldZielFinal < 0 || goldZielFinal > 50) {
            goldZielFinal = DEFAULT_GOLD_ZIEL;
        }
        if (!Number.isFinite(goldFloorFinal) || goldFloorFinal < 0 || goldFloorFinal > 50) {
            goldFloorFinal = DEFAULT_GOLD_FLOOR;
        }
        if (goldAktivFinal && (!Number.isFinite(rebalancingBandFinal) || rebalancingBandFinal < 0)) {
            rebalancingBandFinal = DEFAULT_GOLD_BAND;
        } else if (!Number.isFinite(rebalancingBandFinal)) {
            rebalancingBandFinal = 0;
        }

        const hasProfileRenteSum = Number.isFinite(profileRenteMonatlich)
            || Number.isFinite(profileSonstigeEinkuenfte);
        const renteMonatlichFinal = hasProfileRenteSum
            ? (Number.isFinite(profileRenteMonatlich) ? profileRenteMonatlich : 0)
            + (Number.isFinite(profileSonstigeEinkuenfte) ? profileSonstigeEinkuenfte : 0)
            : num('renteMonatlich');
        const renteAktivFinal = hasProfileRenteSum
            ? renteMonatlichFinal > 0
            : ((typeof profileRenteAktiv === 'boolean') ? profileRenteAktiv : val('renteAktiv') === 'ja');
        const capeInputValue = parseFloat(val('marketCapeRatio') || val('capeRatio')) || 0;
        const persistedCapeRatio = readPersistedCapeRatio() || 0;
        const capeRatio = Math.max(0, capeInputValue > 0 ? capeInputValue : persistedCapeRatio);
        const rawDynamicFlex = checked('dynamicFlex');
        const rawHorizonMethod = val('horizonMethod') || 'survival_quantile';
        const horizonMethod = (rawHorizonMethod === 'mean' || rawHorizonMethod === 'survival_quantile')
            ? rawHorizonMethod
            : 'survival_quantile';
        const horizonYears = Math.max(1, Math.min(60, parseFloat(val('horizonYears')) || 30));
        const survivalQuantile = Math.max(0.5, Math.min(0.99, parseFloat(val('survivalQuantile')) || 0.85));
        const goGoActive = checked('goGoActive');
        const goGoMultiplier = Math.max(1.0, Math.min(1.5, parseFloat(val('goGoMultiplier')) || 1.0));
        const longevityMode = normalizeLongevityMode(val('longevityMode') || LONGEVITY_DEFAULTS.mode);
        const longevityQuantileShiftRaw = parseFloat(val('longevityQuantileShift'));
        const longevityRelativePctRaw = parseFloat(val('longevityRelativePct'));
        const longevityBufferYearsRaw = parseFloat(val('longevityBufferYears'));
        // Feature gate for Balance rollout: Dynamic Flex requires a valid CAPE anchor.
        const dynamicFlex = rawDynamicFlex && capeRatio > 0;

        const bondTargetFactor = parseFloat(val('bondTargetFactor'));
        const drawdownTrigger = parseFloat(val('drawdownTrigger'));
        const bondRefillThreshold = parseFloat(val('bondRefillThreshold'));

        const output = {
            aktuellesAlter: profileAlter,
            floorBedarf: num('floorBedarf'),
            flexBedarf: num('flexBedarf'),
            minimumFlexAnnual: num('minimumFlexAnnual'),
            flexBudgetAnnual: num('flexBudgetAnnual'),
            flexBudgetYears: parseFloat(val('flexBudgetYears')) || 0,
            flexBudgetRecharge: num('flexBudgetRecharge'),
            inflation: readBalanceInflationSource({ scope: readBalanceHouseholdPlan().scope }).value,
            tagesgeld: Number.isFinite(profileTagesgeld) ? profileTagesgeld : num('tagesgeld'),
            geldmarktEtf: useAggregates ? aggregated.geldmarktEtf : num('geldmarktEtf'),
            depotwertAlt: useAggregates ? aggregated.depotwertAlt : num('depotwertAlt'),
            depotwertNeu: useAggregates ? aggregated.depotwertNeu : num('depotwertNeu'),
            goldWert: useAggregates ? aggregated.goldWert : num('goldWert'),
            endeVJ: parseFloat(val('endeVJ')) || 0,
            endeVJ_1: parseFloat(val('endeVJ_1')) || 0,
            endeVJ_2: parseFloat(val('endeVJ_2')) || 0,
            endeVJ_3: parseFloat(val('endeVJ_3')) || 0,
            ath: parseFloat(val('ath')) || 0,
            jahreSeitAth: parseFloat(val('jahreSeitAth')) || 0,
            renteAktiv: renteAktivFinal,
            renteMonatlich: renteMonatlichFinal,
            risikoprofil: 'sicherheits-dynamisch',
            goldAktiv: goldAktivFinal,
            goldZielProzent: goldZielFinal,
            goldFloorProzent: goldFloorFinal,
            goldSteuerfrei: goldSteuerfreiFinal,
            rebalancingBand: rebalancingBandFinal,
            costBasisAlt: useAggregates ? aggregated.costBasisAlt : num('costBasisAlt'),
            costBasisNeu: useAggregates ? aggregated.costBasisNeu : num('costBasisNeu'),
            tqfAlt: parseFloat(val('tqfAlt')) || 0,
            tqfNeu: parseFloat(val('tqfNeu')) || 0,
            goldCost: useAggregates ? aggregated.goldCost : num('goldCost'),
            kirchensteuerSatz: person.kirchensteuerSatz,
            sparerPauschbetrag: readiness.status !== 'demo' ? readiness.entries.reduce((sum, entry) => sum + projectParticipatingPerson({ ...readiness, calculationProfileId: entry.profileId }, entry.profileId).startSPB, 0) : person.startSPB,
            liquidityRunwayYears: finiteNumber(
                'liquidityRunwayYears',
                LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears
            ),
            minCashBufferMonths: finiteNumber('minCashBufferMonths', 2, { integer: true }),
            maxSkimPctOfEq: finiteNumber('maxSkimPctOfEq', 0),
            maxBearRefillPctOfEq: finiteNumber('maxBearRefillPctOfEq', 0),
            marketCapeRatio: capeRatio,
            capeRatio: capeRatio,
            dynamicFlex,
            horizonMethod,
            horizonYears,
            survivalQuantile,
            goGoActive,
            goGoMultiplier,
            longevityMode,
            longevityQuantileShift: Number.isFinite(longevityQuantileShiftRaw) ? longevityQuantileShiftRaw : LONGEVITY_DEFAULTS.quantileShift,
            longevityRelativePct: Number.isFinite(longevityRelativePctRaw) ? longevityRelativePctRaw : LONGEVITY_DEFAULTS.relativePct,
            longevityBufferYears: Number.isFinite(longevityBufferYearsRaw) ? longevityBufferYearsRaw : LONGEVITY_DEFAULTS.bufferYears,
            decumulation: {
                mode: val('entnahmeStrategie') || 'standard',
                bondTargetFactor: Number.isFinite(bondTargetFactor) ? bondTargetFactor : 5.0,
                drawdownTrigger: Number.isFinite(drawdownTrigger) ? drawdownTrigger : 15.0,
                bondRefillThreshold: Number.isFinite(bondRefillThreshold) ? bondRefillThreshold : null
            },
            healthBucket,
            healthBucketEnabled: healthBucket.enabled,
            healthBucketInitialAmount: healthBucket.initialAmount,
            healthBucketAssetSource: healthBucket.assetSource,
            healthBucketTriggerMinGrade: healthBucket.triggerMinGrade,
            healthBucketTriggerMode: healthBucket.triggerMode,
            healthBucketCoverageMode: healthBucket.coverageMode,
            healthBucketReturnMode: healthBucket.returnMode,
            healthBucketTargetMode: healthBucket.targetMode,
            profilName: val('profilName') || '',
            // NEU: Detaillierte Tranchen für FIFO und präzise Steuerberechnung
            detailledTranches: detailledTranches.length
                ? detailledTranches
                : (explicitEmptyOverride ? [] : null)
        };
        const plan = readBalanceHouseholdPlan();
        if (plan.status === 'valid') {
            const patch = this.readHouseholdPlanPatch(plan);
            const values = { ...plan.entry.values, ...patch,
                decumulation: { ...plan.entry.values.decumulation, ...patch.decumulation },
                cape: { ...plan.entry.values.cape, ...patch.cape } };
            const projection = projectPlanToBalance(values);
            for (const key of Object.keys(output)) if (Object.hasOwn(projection, key)) output[key] = projection[key];
            output.dynamicFlex = values.dynamicFlex && values.cape.value > 0;
        }
        const trial = registeredPlanTrial(globalThis.document);
        if (trial?.read().active && trial.localValues().rebalancingBand !== undefined) output.rebalancingBand = trial.localValues().rebalancingBand;
        return output;
    },

    /**
     * Wendet gespeicherte Eingabewerte auf das Formular an
     *
     * Lädt Werte aus dem übergebenen Objekt und setzt die entsprechenden
     * DOM-Elemente. Behandelt verschiedene Input-Typen korrekt:
     * - Checkboxen: checked-Attribut
     * - Währungsfelder: Formatierung mit Tausendertrennzeichen
     * - Andere Felder: Direktzuweisung
     *
     * Ruft anschließend applySideEffectsFromInputs() auf, um UI-Panels
     * entsprechend anzuzeigen/zu verbergen.
     *
     * @param {Object} [storedInputs={}] - Gespeicherte Eingabewerte
     */
    applyStoredInputs(storedInputs = {}) {
        Object.keys(dom.inputs).forEach(key => {
            const el = dom.inputs[key];
            if (el && key in storedInputs) {
                if (el.type === 'checkbox') {
                    // Niemals Truthiness fuer persistierte/importierte Booleans.
                    el.checked = storedInputs[key] === true;
                } else if (el.classList.contains('currency')) {
                    el.value = UIUtils.formatNumber(UIUtils.parseCurrency(storedInputs[key]));
                } else if (key === 'renteAktiv') {
                    // Auch unerwartete Legacy-/Korruptionsstrings duerfen die Rente
                    // nicht per Truthiness aktivieren.
                    el.value = storedInputs[key] === true ? 'ja' : 'nein';
                } else {
                    el.value = storedInputs[key];
                }
            }
        });

        if (storedInputs.decumulation && storedInputs.decumulation.mode) {
            if (dom.inputs.entnahmeStrategie) dom.inputs.entnahmeStrategie.value = storedInputs.decumulation.mode;
            const threeBucket = storedInputs.decumulation.threeBucket || storedInputs.decumulation;
            if (dom.inputs.bondTargetFactor && Number.isFinite(threeBucket?.bondTargetFactor)) {
                dom.inputs.bondTargetFactor.value = threeBucket.bondTargetFactor;
            }
            if (dom.inputs.drawdownTrigger && Number.isFinite(threeBucket?.drawdownTrigger)) {
                dom.inputs.drawdownTrigger.value = threeBucket.drawdownTrigger;
            }
            const refillThreshold = Number.isFinite(threeBucket?.bondRefillThreshold)
                ? threeBucket.bondRefillThreshold
                : (Number.isFinite(threeBucket?.bondRefillThresholdPct) ? threeBucket.bondRefillThresholdPct : null);
            if (dom.inputs.bondRefillThreshold && Number.isFinite(refillThreshold)) {
                dom.inputs.bondRefillThreshold.value = refillThreshold;
            } else if (dom.inputs.bondRefillThreshold && Object.hasOwn(threeBucket, 'bondRefillThreshold') && threeBucket.bondRefillThreshold === null) {
                dom.inputs.bondRefillThreshold.value = '';
            }
        }

        this.applySideEffectsFromInputs();
    },

    /**
     * Rendert persistierte Marktdaten-Provenienz sichtbar und als data-*-
     * Attribute fuer Browserdiagnose und Reload-Tests.
     */
    renderMarketDataProvenance(meta) {
        const output = dom?.outputs?.marketDataProvenance;
        if (!output) return getMarketDataProvenanceViewModel(meta);
        const view = getMarketDataProvenanceViewModel(meta);
        output.textContent = view.available ? `${view.instrument} · ${view.asOf} · ${view.source}`
            : 'Herkunft der Marktdaten unbekannt – mit dem Jahres-Update aktualisieren';
        output.title = view.text;
        const explanation = output.ownerDocument?.getElementById('marketDataProvenanceDetail');
        if (explanation) explanation.textContent = view.text;
        const dataset = output.dataset || {};
        const datasetValues = {
            available: String(view.available),
            schemaVersion: view.schemaVersion === null ? '' : String(view.schemaVersion),
            periodId: view.periodId || '',
            asOf: view.asOf || '',
            source: view.source || '',
            instrument: view.instrument || '',
            highScope: view.highScope || '',
            enginePolicy: view.enginePolicy || '',
            engineReferenceApplied: view.engineReferenceApplied === null
                ? ''
                : String(view.engineReferenceApplied)
        };
        Object.entries(datasetValues).forEach(([key, value]) => {
            dataset[key] = value;
        });
        return view;
    },

    /**
     * Wendet UI-Seiteneffekte basierend auf Eingabewerten an
     *
     * Zeigt/verbirgt Panels und aktiviert/deaktiviert Felder abhängig
     * von bestimmten Eingabewerten:
     * - Gold-Panel: nur sichtbar wenn goldAktiv aktiviert
     * - Renten-Feld: nur aktiviert wenn renteAktiv = 'ja'
     * - Setzt inaktive Felder auf 0 zurück
     *
     * Wird automatisch von applyStoredInputs() aufgerufen.
     */
    applySideEffectsFromInputs() {
        const goldAktivInput = dom.inputs.goldAktiv;
        const goldPanel = dom.controls.goldPanel;
        const isGoldActive = goldAktivInput ? goldAktivInput.checked : false;
        if (goldPanel) {
            goldPanel.style.display = isGoldActive ? 'block' : 'none';
        }

        const entnahmeStrategieInput = dom.inputs.entnahmeStrategie;
        const threeBucketConfigGroup = document.getElementById('threeBucketConfigGroup');
        if (entnahmeStrategieInput && threeBucketConfigGroup) {
            const is3Bucket = entnahmeStrategieInput.value === '3_bucket_jilge';
            threeBucketConfigGroup.style.display = is3Bucket ? 'grid' : 'none';
        }

        const renteAktivInput = dom.inputs.renteAktiv;
        const renteMonatlichInput = dom.inputs.renteMonatlich;
        if (renteAktivInput && renteMonatlichInput) {
            const isRenteAktiv = renteAktivInput.value === 'ja';
            renteMonatlichInput.disabled = !isRenteAktiv;
            if (!isRenteAktiv) {
                renteMonatlichInput.value = UIUtils.formatNumber(0);
            }
        }
        registeredPlanTrial(globalThis.document)?.render?.();
    }
};
