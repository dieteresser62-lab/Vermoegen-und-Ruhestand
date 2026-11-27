/**
 * Die sechs historischen Ketten in der Reihenfolge der Jahressätze (wie HISTORICAL_CHAIN_SERIES).
 * Jede Kette liefert dieselbe Schnittstelle: KETTE, lesen, schreiben, endjahr, endjahrSetzen,
 * zeileBerechnen, gespeichert, plausibilitaet, lieferungAusOriginalen.
 */
import * as aktien from './ketten/aktien.mjs';
import * as inflation from './ketten/inflation.mjs';
import * as geldmarkt from './ketten/geldmarkt.mjs';
import * as lohn from './ketten/lohn.mjs';
import * as gold from './ketten/gold.mjs';
import * as cape from './ketten/cape.mjs';

/** @typedef {typeof aktien | typeof inflation | typeof geldmarkt | typeof lohn | typeof gold | typeof cape} KettenModul */

/** @type {readonly KettenModul[]} */
export const KETTEN = Object.freeze([aktien, inflation, geldmarkt, lohn, gold, cape]);

/** @param {string} id Ordnername der Kette. @returns {KettenModul} */
export function kette(id) {
    const found = KETTEN.find(modul => modul.KETTE.id === id);
    if (!found) throw new Error(`Unbekannte Kette ${id}.`);
    return found;
}
