"use strict";

import { validateTailRiskHorizonCompatibility } from './tail-risk-contract.js';
import {
    LIQUIDITY_RUNWAY_CONTRACT_V1,
    isValidLiquidityRunwayYears,
    resolveLiquidityRunwayYears
} from '../../types/liquidity-runway-contract.js';

export class SimulatorValidationError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = 'SimulatorValidationError';
        this.errors = Array.isArray(errors) ? errors : [];
    }
}

// Feldzuordnung an der UI-Grenze; der gemeinsame Parametervertrag bleibt unverändert.
export function simulatorValidationFieldId(error) {
    if (error?.errors?.[0]?.fieldId) return error.errors[0].fieldId;
    if (!error?.code?.startsWith('MC_PARAMETER_')) return null;
    const labels = {
        'Anzahl der Simulationen': 'mcAnzahl', 'Simulationsdauer in Jahren': 'mcDauer',
        'Blockgroesse in Jahren': 'mcBlockSize', 'Erwartete Blocklaenge in Jahren': 'mcBlockSize',
        'Zufalls-Seed': 'mcSeed', 'Simulationsmethode': 'mcMethode', 'RNG-Modus': 'rngMode',
        'Startjahr-Modus': 'mcStartYearMode', 'Startjahr-Filter': 'mcStartYearFilter',
        'Startjahr-Halbwertszeit': 'mcStartYearHalfLife', 'Worker-Anzahl': 'mcWorkerCount',
        'Job-Timebudget in Millisekunden': 'mcWorkerBudget',
        'P1-Startalter': 'p1Geburtsdatum', 'P2-Startalter': 'r2Geburtsdatum'
    };
    return Object.entries(labels).find(([label]) => error.message?.startsWith(`MonteCarloParametersV1: ${label} `))?.[1] || null;
}

export function validateSimulatorInputs(inputs = {}) {
    const errors = [];
    const minimumFlexAnnualInput = inputs.minimumFlexAnnual;
    const minimumFlexAnnualMissing = minimumFlexAnnualInput == null || minimumFlexAnnualInput === '';
    let minimumFlexAnnual = 0;
    if (!minimumFlexAnnualMissing) {
        try {
            minimumFlexAnnual = Number(minimumFlexAnnualInput);
        } catch {
            minimumFlexAnnual = Number.NaN;
        }
    }
    const startFlexBedarfRaw = Number(inputs.startFlexBedarf);
    const startFlexBedarf = Number.isFinite(startFlexBedarfRaw) ? startFlexBedarfRaw : 0;
    const liquidityRunwayYears = resolveLiquidityRunwayYears(inputs).years;

    if (!Number.isFinite(minimumFlexAnnual)) {
        errors.push({ fieldId: 'minimumFlexAnnual', message: 'Mindest-Flex p.a. muss eine gueltige Zahl sein.' });
    } else if (minimumFlexAnnual < 0) {
        errors.push({ fieldId: 'minimumFlexAnnual', message: 'Mindest-Flex p.a. darf nicht negativ sein.' });
    }
    if (Number.isFinite(minimumFlexAnnual) && minimumFlexAnnual > startFlexBedarf) {
        errors.push(
            { fieldId: 'minimumFlexAnnual', message: 'Mindest-Flex p.a. darf nicht größer als Flex-Bedarf p.a. sein.' },
            { fieldId: 'startFlexBedarf', message: 'Flex-Bedarf p.a. ist die Obergrenze für Mindest-Flex.' }
        );
    }
    if (
        !Number.isFinite(liquidityRunwayYears)
        || liquidityRunwayYears < LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears
        || liquidityRunwayYears > LIQUIDITY_RUNWAY_CONTRACT_V1.maximumYears
        || !isValidLiquidityRunwayYears(liquidityRunwayYears)
    ) {
        errors.push({
            fieldId: 'liquidityRunwayYears',
            message: `Liquiditäts-Runway muss zwischen ${LIQUIDITY_RUNWAY_CONTRACT_V1.minimumYears} und ${LIQUIDITY_RUNWAY_CONTRACT_V1.maximumYears} Jahren in ${LIQUIDITY_RUNWAY_CONTRACT_V1.stepYears}-Jahres-Schritten liegen.`
        });
    }

    const tailRiskValidation = validateTailRiskHorizonCompatibility(inputs, inputs.tailRiskHorizonYears);
    const tailRiskInputErrors = Array.isArray(inputs.tailRiskValidationErrors)
        ? inputs.tailRiskValidationErrors
        : [];
    if (!tailRiskValidation.valid) {
        for (const error of tailRiskValidation.errors) {
            errors.push({
                fieldId: error.fieldId,
                message: error.message || 'Ungueltiger Tail-Risk-Parameter.'
            });
        }
    }
    if (tailRiskInputErrors.length > 0) {
        for (const error of tailRiskInputErrors) {
            const alreadyReported = errors.some(existing => existing.fieldId === error.fieldId && existing.message === error.message);
            if (!alreadyReported) {
                errors.push({
                    fieldId: error.fieldId,
                    message: error.message || 'Ungueltiger Tail-Risk-Parameter.'
                });
            }
        }
    }

    if (errors.length > 0) {
        const first = errors[0];
        throw new SimulatorValidationError(
            first?.message || 'Ungueltige Simulator-Eingaben.',
            errors
        );
    }

    return inputs;
}

export const SIMULATOR_CONTRACT_ERROR_MESSAGES_DE = Object.freeze({
    SIMULATOR_HISTORICAL_DATA_UNAVAILABLE: 'Historische Marktdaten sind nicht verfügbar: Lade oder prüfe den historischen Datenbestand, bevor du die Simulation erneut startest.',
    SIMULATOR_STRESS_PRESET_UNKNOWN: 'Unbekanntes Stressszenario: Das gespeicherte Preset ist nicht mehr verfügbar. Öffne das Profil, wähle ein vorhandenes Stressszenario und speichere erneut.',
    SIMULATOR_STRESS_POOL_EMPTY: 'Historisches Stressszenario nicht ausführbar: Der zugehörige historische Rohpool ist leer. Wähle ein synthetisches Stressszenario oder prüfe den Datenbestand.',
    SIMULATOR_STRESS_SEQUENCE_INVALID: 'Stresssequenz unvollständig: Für mindestens ein Stressjahr fehlt eine gültige Rendite. Wähle ein anderes Szenario oder prüfe den Presetvertrag.',
    SIMULATOR_STRESS_INPUT_INVALID: 'Stressberechnung abgebrochen: Rendite-, Inflations- oder Golddaten sind ungültig. Prüfe den historischen Datenbestand.',
    SIMULATOR_STRESS_EFFECTIVE_POOL_EMPTY: 'Historisches Stressszenario nicht ausführbar: Unter dem aktiven Startjahrfilter gibt es keine geeigneten Jahre. Setze die Grenze früher, erlaube geschätzte Jahre oder wähle ein synthetisches Stressszenario.',
    SIMULATOR_STRESS_EFFECTIVE_POOL_TOO_SMALL: 'Historisches Stressszenario nicht belastbar: Unter dem aktiven Startjahrfilter bleiben zu wenige unterschiedliche Jahre. Setze die Grenze früher, erlaube geschätzte Jahre oder wähle ein synthetisches Stressszenario.',
    SIMULATOR_REGIME_INPUT_INVALID: 'Regimeklassifikation nicht möglich: Rendite oder Inflation ist ungültig. Prüfe den historischen Datenbestand.',
    SIMULATOR_REGIME_TRANSITIONS_EMPTY: 'Historischer Regimevertrag unvollständig: Für mindestens ein Marktregime fehlen beobachtete Übergänge. Prüfe und bestätige die aktualisierte Datenklassifikation.',
    SIMULATOR_REGIME_DISTRIBUTION_DRIFT: 'Historischer Regimevertrag geändert: Die beobachtete Verteilung weicht vom geprüften Datenstand ab. Prüfe und aktualisiere den Regimevertrag vor der Simulation.',
    SIMULATOR_REGIME_TRANSITIONS_INVALID: 'Regime-Sampling nicht möglich: Die Übergangsdaten des aktuellen Marktregimes fehlen oder sind ungültig. Prüfe den Regimevertrag.',
    SIMULATOR_REGIME_TRANSITION_SELECTION_FAILED: 'Regime-Sampling abgebrochen: Die Übergangszähler ergeben keine gültige Auswahl. Prüfe die Transitionsmatrix.',
    MC_SAMPLING_DATA_EMPTY: 'Monte-Carlo-Sampling nicht ausführbar: Der historische Jahresdatenbestand ist leer. Prüfe oder lade die historischen Marktdaten und starte erneut.',
    MC_SAMPLING_METHOD_INVALID: 'Monte-Carlo-Sampling nicht ausführbar: Die gewählte Sampling-Methode ist unbekannt. Wähle eine verfügbare Methode und starte erneut.',
    MC_SAMPLING_NO_START_CANDIDATES: 'Monte-Carlo-Sampling nicht ausführbar: Der aktive Startjahrfilter liefert keine geeigneten Startjahre. Setze die Grenze früher oder lockere den Datenfilter.',
    MC_SAMPLING_NO_BLOCK_START_CANDIDATES: 'Blockbootstrap nicht ausführbar: Für Filter und Blocklänge bleibt kein vollständiger Startblock. Setze die Startjahrgrenze früher oder verkürze den Block.',
    MC_SAMPLING_REGIME_TRANSITIONS_INVALID: 'Regime-Sampling nicht ausführbar: Für mindestens ein erreichbares Regime fehlen gültige Übergänge. Prüfe die Transitionsmatrix.',
    MC_SAMPLING_REGIME_POOL_EMPTY: 'Regime-Sampling nicht ausführbar: Der aktive Startjahrfilter enthält nicht alle erreichbaren Marktregime. Setze die Grenze früher oder wähle eine andere Sampling-Methode.',
    MC_SAMPLING_RUNTIME_CONTRACT_MISMATCH: 'Sampling-Lauf abgebrochen: Vorprüfung und Laufzeit verwenden unterschiedliche Methoden. Starte den Lauf mit unveränderten Einstellungen erneut.',
    MC_SAMPLING_YEAR_OUTSIDE_EFFECTIVE_UNIVERSE: 'Sampling-Lauf abgebrochen: Ein gezogenes Jahr liegt außerhalb des vorgeprüften Datenbereichs. Prüfe Filter und Datenbestand.',
    MC_SAMPLING_RUNTIME_STATE_INVALID: 'Sampling-Lauf abgebrochen: Der interne Samplingzustand ist unvollständig. Starte den Lauf neu; bleibt der Fehler bestehen, melde ihn zur Diagnose.',
    MC_SAMPLING_RUNTIME_DELEGATE_INVALID: 'Sampling-Lauf abgebrochen: Die Jahresauswahl ist technisch nicht verfügbar. Starte die Anwendung neu.',
    MC_SAMPLING_RUNTIME_DISPATCH_INVALID: 'Sampling-Lauf abgebrochen: Für die gewählte Methode existiert kein gültiger Laufzeitpfad. Wähle eine verfügbare Methode.',
    SIMULATOR_REGIME_POOL_EMPTY: 'Regime-Sampling abgebrochen: Im wirksamen Jahresbereich fehlt das gezogene Marktregime. Setze die Startjahrgrenze früher oder wähle eine andere Sampling-Methode.'
});

const ENGINE_FIELD_LABELS = Object.freeze({
    aktuellesAlter: 'Alter', inflation: 'Inflation', floorBedarf: 'Grundbedarf (Floor)',
    flexBedarf: 'Wunschbedarf (Flex)', minimumFlexAnnual: 'Mindest-Flex',
    tagesgeld: 'Tagesgeld', geldmarktEtf: 'Geldmarkt-ETF', depotwertAlt: 'Altbestand',
    depotwertNeu: 'Neubestand', goldWert: 'Goldbestand', costBasisAlt: 'Einstand Altbestand',
    costBasisNeu: 'Einstand Neubestand', goldCost: 'Einstand Gold', sparerPauschbetrag: 'Sparer-Pauschbetrag',
    aktuelleLiquiditaet: 'Aktuelle Liquidität', renteAktiv: 'Rentenstatus', renteMonatlich: 'Monatsrente',
    goldZielProzent: 'Gold-Zielanteil', goldFloorProzent: 'Gold-Untergrenze',
    rebalancingBand: 'Gold-Umschichtungsband', liquidityRunwayYears: 'Liquiditätsreserve in Jahren',
    flexBudgetAnnual: 'Flex-Budget pro Jahr', flexBudgetYears: 'Flex-Budget in Jahren',
    flexBudgetRecharge: 'Flex-Budget auffüllen', maxSkimPctOfEq: 'Maximal abschöpfen',
    maxBearRefillPctOfEq: 'Maximal auffüllen im Bärenmarkt',
    dynamicFlex: 'Dynamic Flex', goGoActive: 'Go-Go aktiv', horizonMethod: 'Horizontmethode',
    horizonYears: 'Planungshorizont', survivalQuantile: 'Überlebensquantil', goGoMultiplier: 'Go-Go-Faktor',
    longevityMode: 'Langlebigkeitsmodus', longevityQuantileShift: 'Quantilverschiebung',
    longevityRelativePct: 'Relativer Horizontpuffer', longevityBufferYears: 'Jahrespuffer',
    capeRatio: 'CAPE', marketCapeRatio: 'CAPE', ath: 'Allzeithoch',
    endeVJ: 'Kurs Vorjahr', endeVJ_1: 'Kurs vor zwei Jahren', endeVJ_2: 'Kurs vor drei Jahren',
    endeVJ_3: 'Kurs vor vier Jahren', 'lastState.taxState.lossCarry': 'Verlustvortrag',
    shares: 'Stückzahl', purchasePrice: 'Kaufkurs', currentPrice: 'Aktueller Kurs',
    marketValue: 'Marktwert', costBasis: 'Einstandswert', purchaseDate: 'Kaufdatum',
    trancheId: 'Tranchenkennung', name: 'Tranchname', category: 'Anlageklasse', type: 'Anlagetyp',
    tqf: 'Teilfreistellung', taxExempt: 'Steuerfreiheit'
});

export function findSimulatorEngineValidationError(error) {
    if (error?.name === 'ValidationError' && Array.isArray(error.errors)) return error;
    return error?.cause && error.cause !== error ? findSimulatorEngineValidationError(error.cause) : null;
}

export function formatSimulatorValidationError(error) {
    const validation = findSimulatorEngineValidationError(error);
    if (validation?.errors.length) {
        return validation.errors.map(entry => {
            const field = entry.fieldId || entry.field || '';
            const label = ENGINE_FIELD_LABELS[field] || field || 'Eingabe';
            const message = String(entry.message || 'Ungültiger Wert.').split(field || '\0').join(label);
            const tranche = entry.trancheId ? ` (Tranche ${entry.trancheId})` : '';
            const value = Object.hasOwn(entry, 'value') ? ` Wert: ${String(entry.value)}.` : '';
            return `${label}${tranche}: ${message}${value}`;
        }).join('\n');
    }
    if (error instanceof SimulatorValidationError) return error.message;
    if (error?.code && SIMULATOR_CONTRACT_ERROR_MESSAGES_DE[error.code]) {
        return SIMULATOR_CONTRACT_ERROR_MESSAGES_DE[error.code];
    }
    return error?.message || String(error || 'Unbekannter Validierungsfehler');
}
