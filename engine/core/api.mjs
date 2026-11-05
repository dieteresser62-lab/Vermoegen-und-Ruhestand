// @ts-check
/** @import {EngineInput,EngineState,RunwayProfile,Market,Needs} from '../../typcheck/rechenkern' */
import { ENGINE_API_VERSION, ENGINE_BUILD_ID, CONFIG } from '../config.mjs';
import { AppError } from '../errors.mjs';
import MarketAnalyzer from '../analyzers/MarketAnalyzer.mjs';
import TransactionEngine from '../transactions/TransactionEngine.mjs';
import { _internal_calculateModel } from './annual-model.mjs';
/**
 * ===================================================================
 * ENGINE API (v31)
 * ===================================================================
 * Moderne, zustandslose API für Balance App v38+
 * ===================================================================
 */
const EngineAPI = {
    /**
     * Gibt Versionsinformationen zurück
     */
    getVersion: function () {
        return { api: ENGINE_API_VERSION, build: ENGINE_BUILD_ID };
    },

    /**
     * Gibt Konfiguration zurück
     */
    getConfig: function () {
        return CONFIG;
    },

    /**
     * Analysiert Marktbedingungen
     */
    /** @param {Parameters<typeof MarketAnalyzer.analyzeMarket>[0]} input */
    analyzeMarket: function (input) {
        try {
            return MarketAnalyzer.analyzeMarket(input);
        } catch (e) {
            return { error: /** @type {{message:string}} */ (e).message };
        }
    },

    /**
     * Berechnet Ziel-Liquidität
     */
    /** @param {RunwayProfile} profil
 * @param {Market} market
 * @param {Needs} inflatedBedarf */
    calculateTargetLiquidity: function (profil, market, inflatedBedarf) {
        return TransactionEngine.calculateTargetLiquidity(profil, market, inflatedBedarf);
    },

    /**
     * Simuliert ein einzelnes Jahr. Die lesende Flex-Diagnose ist optional;
     * bestehende Simulator-/Worker-/Exportaufrufe erzeugen keinen Collector.
     */
    /** @param {EngineInput} input
 * @param {EngineState|null} [lastState]
 * @returns {import('../../typcheck/rechenkern').EngineResult} */
    simulateSingleYear: function (input, lastState, { includeFlexTrace = false } = {}) {
        try {
            return _internal_calculateModel(input, lastState, { includeFlexTrace });
        } catch (e) {
            console.error('[EngineAPI] Critical Error in simulateSingleYear:', e);
            if (e instanceof AppError) {
                return { error: e };
            }
            return {
                error: new AppError(
                    "Ein unerwarteter Engine-Fehler ist aufgetreten.",
                    { originalError: e }
                )
            };
        }
    },

    /**
     * @deprecated Veraltete Methode
     */
    /** @param {string} step
 * @param {string} impact
 * @param {string} status
 * @param {string} severity */
    addDecision: function (step, impact, status, severity) {
    },

    /**
     * @deprecated Veraltete Methode
     */
    updateDecision: function () { },

    /**
     * @deprecated Veraltete Methode
     */
    removeDecision: function () { }
};

// Exporte
export { EngineAPI, _internal_calculateModel };
export default { EngineAPI, _internal_calculateModel };
