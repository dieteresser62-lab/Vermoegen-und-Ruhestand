/**
 * Module: Annual CAPE Check
 * Purpose: S2 (Gutachten 19.11.2026): Ein abgerufener CAPE, der weit vom Bezugswert abweicht, braucht im
 * Jahresabschluss eine ausdrückliche Bestätigung. Keine Rechenregel; nur Hinweis und Bestätigung.
 */
"use strict";

import { CONFIG } from '../balance/balance-config.js';
import { CONFIG as ENGINE_CONFIG } from '../../engine/config.mjs';
import { loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { US_SHILLER_CAPE_BY_RETURN_YEAR } from '../simulator/us-shiller-cape-chain.js';
import { persistenceStorage } from './persistence-facade.js';

/** Mehr als 25 % Abstand zum Bezugswert verlangt eine Bestätigung. */
export const CAPE_JUMP_LIMIT = 0.25;

const plausible = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Letzter Dezemberwert der hinterlegten Shiller-Reihe; das Rückgabejahr t nutzt den Dezember t−1. */
export function capeChainReference() {
    const years = Object.keys(US_SHILLER_CAPE_BY_RETURN_YEAR).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    const year = years.at(-1), value = US_SHILLER_CAPE_BY_RETURN_YEAR[year];
    return plausible(value) ? { value, label: `Dezember ${year - 1}, hinterlegte Shiller-Reihe` }
        : { value: ENGINE_CONFIG.MARKET_VALUATION.DEFAULT_CAPE, label: 'Richtwert der App' };
}

/**
 * Bezugswert: zuerst der CAPE des letzten Jahresabschlusses, sonst der letzte Dezemberwert der hinterlegten Reihe.
 * @param {{storage?: {getItem(key: string): string | null}}} [options]
 * @returns {{value: number, label: string}}
 */
export function readCapeReference({ storage = persistenceStorage } = {}) {
    try {
        const loaded = loadStoredBalanceStateFromData({ [CONFIG.STORAGE.LS_KEY]: storage.getItem(CONFIG.STORAGE.LS_KEY) });
        const period = loaded.status === 'valid' ? loaded.value?.annualPeriodMetadata?.lastCommittedPeriod : null;
        const year = /^calendar-year:(\d{4})$/.exec(period || '')?.[1];
        const plan = readBalanceHouseholdPlan({ storage });
        const cape = plan.status === 'valid' ? plan.entry.values.cape : null;
        // Der Abschluss schreibt den CAPE mit Stand im Abschlussjahr in den Plan; ein anderer Stand stammt nicht aus ihm.
        if (year && plausible(cape?.value) && String(cape.asOf || '').startsWith(`${year}-`)) return { value: cape.value, label: `Jahresabschluss ${year}` };
    } catch { /* Ohne lesbaren Abschluss gilt die hinterlegte Reihe. */ }
    return capeChainReference();
}

/**
 * @param {{capeRatio?: number} | null | undefined} cape Wert im Schritt Marktdaten.
 * @param {{value: number, label: string} | null} reference
 * @returns {{deviation: number, exceeds: boolean} | null}
 */
export function assessCapeJump(cape, reference) {
    if (!plausible(cape?.capeRatio) || !plausible(reference?.value)) return null;
    const deviation = Math.abs(cape.capeRatio - reference.value) / reference.value;
    return { deviation, exceeds: deviation > CAPE_JUMP_LIMIT };
}

/** Bestätigung gilt nur für genau diesen Wert; ein erneuter Abruf mit anderem Wert wird neu geprüft. */
export const capeConfirmationKey = cape => JSON.stringify([cape?.capeRatio, cape?.capeAsOf, cape?.capeSource]);
