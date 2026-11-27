/** @import {Random} from '../../typcheck/rechenkern.js' */
/**
 * Module: Simulator Utils
 * Purpose: Critical utility functions for the simulation.
 *          Includes RNG (Random Number Generator), math helpers (quantile, mean), and text formatting.
 * Usage: Used universally across the simulation and engine modules.
 * Dependencies: simulator-formatting.js
 */
"use strict";

// --- UI & UTILITIES ---

export {
    formatCurrency,
    formatCurrencyShortLog,
    formatCurrencyRounded
} from './simulator-formatting.js';

/**
 * Verkürzt Textbezeichnungen für kompakte Darstellung
 *
 * @param text
 * @returns Ergebnis der Operation.
 */
export const shortenText = (text) => {
    if (!text) return "";
    const map = {
        "Markt heiß gelaufen": "HEISS", "Stabiler Höchststand": "ATH",
        "Best. Erholung": "ERHOLUNG", "Erholung im Bärenmarkt": "REC_BÄR",
        "Junge Korrektur": "KORREKTUR", "Tiefer Bär": "BÄR",
        "Seitwärts Lang": "SEITWÄRTS"
    };
    for (const [key, value] of Object.entries(map)) {
        text = text.replace(key, value);
    }
    return text.replace("(Stagflation)", "(S)");
};

/**
 * Verkürzt Grund-Text für Transaktionen
 *
 * @param reason
 * @param szenario
 * @returns Ergebnis der Operation.
 */
export const shortenReasonText = (reason, szenario) => {
    const reasonMap = {
        'emergency': 'Notfall-Refill', 'min_runway': 'MinRW-Refill', 'target_gap': 'Puffer-Refill',
        'reinvest': 'Reinvest', 'rebalance_up': 'Rebal.(G+)', 'rebalance_down': 'Rebal.(G-)',
        'rebuild_gold': 'Gold-Wiederaufbau', 'shortfall': 'DECKUNGSLÜCKE', 'none': ''
    };
    const reasonText = reasonMap[reason] || '';
    const szenarioText = shortenText(szenario);
    let combinedText = szenarioText;
    if (reasonText && reasonText.length > 0 && reasonText !== 'none') {
        combinedText += ` / ${reasonText}`;
    }
    if (combinedText.includes('/')) {
        return combinedText.split('/')[1].trim();
    }
    return szenarioText;
};

/**
 * Lineare Interpolation
 *
 * @param x
 * @param x0
 * @param x1
 * @param y0
 * @param y1
 * @returns Ergebnis der Operation.
 */
export const lerp = (x, x0, x1, y0, y1) => y0 + (Math.min(Math.max(x, x0), x1) - x0) * (y1 - y0) / (x1 - x0);

/**
 * Mathematische Hilfsfunktionen
 *
 * @param arr
 * @returns Ergebnis der Operation.
 */
export const sum = arr => arr.reduce((a, b) => a + b, 0);
/**
 * @param arr
 * @returns {number} Ergebnis der Operation.
 */
export const mean = arr => arr.length > 0 ? sum(arr) / arr.length : 0;

/**
 * Random Number Generator mit Seed
 * Supports forking for independent RNG streams
 *
 * @param {number} [seed] Seed des Zufallsstroms.
 * @returns {Random} Ergebnis der Operation.
 */
export function rng(seed = 123456789) {
    // Auch Seed 0 und auf 0 gekürzte 32-Bit-Seeds müssen den Nullzustand verlassen.
    let x = (seed | 0) || 123456789;
    // Xorshift32: schneller, deterministischer RNG für Reproduzierbarkeit.
    const generator = () => (x = (x ^= (x << 13)), x ^= (x >>> 17), x ^= (x << 5), (x >>> 0) / 4294967296);

    // Fork: deterministische Ableitung eines unabhängigen Streams (Label-mix).
    generator.fork = (label = '') => {
        let derivedSeed = x;
        for (let i = 0; i < label.length; i++) {
            derivedSeed = ((derivedSeed << 5) - derivedSeed + label.charCodeAt(i)) | 0;
        }
        return rng(derivedSeed);
    };

    return generator;
}

export const RUNIDX_COMBO_SETUP = 0x7fffffff;

function normalizeSeed(value) {
    return (Number.isFinite(value) ? value : 0) >>> 0;
}

function mix32(x) {
    let h = x >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/**
 * @param {number} baseSeed Gemeinsamer Startseed.
 * @param {number} comboIdx Index der Parameterkombination.
 * @param {number} runIdx Index des Simulationslaufs.
 * @returns {number} Ergebnis der Operation.
 */
export function makeRunSeed(baseSeed, comboIdx, runIdx) {
    const base = normalizeSeed(baseSeed);
    const combo = normalizeSeed(comboIdx);
    const run = normalizeSeed(runIdx);
    // Zweistufiges Mischen reduziert Korrelationen zwischen Combo- und Run-Index.
    let h = mix32(base ^ mix32(combo + 0x9e3779b9));
    h = mix32(h ^ mix32(run + 0x85ebca6b));
    return h >>> 0;
}

/**
 * Berechnet ein Quantil performant mithilfe des Quickselect-Algorithmus.
 * @param {Float64Array|number[]} arr - Das Array von Zahlen.
 * @param {number} q - Das Quantil (z.B. 0.5 für Median).
 * @returns {number} Der Wert am angegebenen Quantil.
 */
export function quantile(arr, q) {
    if (!arr || arr.length === 0) return 0;
    const sorted = new Float64Array(arr);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;

    const quickselect = (a, k) => {
        let l = 0, r = a.length - 1;
        while (l < r) {
            let pivot = a[k];
            let i = l, j = r;
            do {
                while (a[i] < pivot) i++;
                while (a[j] > pivot) j--;
                if (i <= j) {
                    [a[i], a[j]] = [a[j], a[i]];
                    i++; j--;
                }
            } while (i <= j);
            if (j < k) l = i;
            if (k < i) r = j;
        }
        return a[k];
    };

    if (rest === 0) {
        return quickselect(sorted, base);
    } else {
        const v1 = quickselect(sorted, base);
        const v2 = quickselect(sorted, base + 1);
        return v1 + rest * (v2 - v1);
    }
}
