/**
 * Monte Carlo und Backtest auf dem Grundbestand 1925–2025 (JD-2a, jahresrobust).
 *
 * Eingefrorene MC- und Backtest-Belege wurden mit dem Jahrespool 1925–2025 und dessen Datensatzkennung gemessen.
 * Nach einer Übernahme enthalten `annualData`, `REGIME_DATA` und `REGIME_TRANSITIONS` weitere Jahre; Ziehung und
 * Regimeübergänge ändern sich, und Backtest-Ergebnisse tragen die neue Revision und den neuen Inhaltshash.
 * - `mitGrundbestandStichprobe(rückruf)` beschränkt den Pool für die Dauer des Rückrufs auf die Jahre bis 2025.
 * - `grundbestandSichtAktivieren()` tut das für den ganzen Testprozess (jede Testdatei läuft in einem eigenen Prozess);
 *   danach liefert `historischerProvider()` den Backtest-Provider des Grundbestands.
 * Ohne angehängte Jahre ändern die Helfer nichts. Sie greifen nur in Stichprobe und Datenquelle ein, nicht in Regeln
 * oder Eingaben. Messskripte (alt/neu) rufen sie nicht auf und rechnen deshalb mit dem neuen Datenstand.
 */
import { annualData, REGIME_DATA, REGIME_TRANSITIONS } from '../../app/simulator/simulator-data.js';
import { createHistoricalBacktestContractProvider } from '../../app/simulator/historical-backtest-contract.js';
import { prepareHistoricalDataOnce } from '../../app/simulator/simulator-engine-helpers.js';
import { GRUNDBESTAND_END_YEAR } from '../../scripts/lib/jahresdaten/grundbestand.mjs';
import { GRUNDBESTAND_DATA, GRUNDBESTAND_MANIFEST } from './grundbestand-sicht.mjs';

/** Gibt es Jahre nach dem Grundbestand im Pool? */
export const HAT_ANGEHAENGTE_JAHRE = annualData.some(entry => entry.jahr > GRUNDBESTAND_END_YEAR);
let sichtAktiv = false;

function uebergaengeZaehlen(eintraege) {
    for (const zeile of Object.values(REGIME_TRANSITIONS)) for (const key of Object.keys(zeile)) zeile[key] = 0;
    for (let index = 0; index < eintraege.length - 1; index += 1) {
        const zeile = REGIME_TRANSITIONS[eintraege[index].regime];
        if (zeile && zeile[eintraege[index + 1].regime] !== undefined) {
            zeile[eintraege[index + 1].regime] += 1;
            zeile.total += 1;
        }
    }
}

/** Beschränkt den Pool auf den Grundbestand; liefert eine Funktion, die ihn wiederherstellt. */
function poolBeschraenken() {
    const pool = [...annualData];
    const regime = Object.fromEntries(Object.entries(REGIME_DATA).map(([label, liste]) => [label, [...liste]]));
    const uebergaenge = JSON.parse(JSON.stringify(REGIME_TRANSITIONS));
    const behalten = entry => entry.jahr <= GRUNDBESTAND_END_YEAR;
    annualData.splice(0, annualData.length, ...pool.filter(behalten));
    for (const [label, liste] of Object.entries(REGIME_DATA)) liste.splice(0, liste.length, ...regime[label].filter(behalten));
    uebergaengeZaehlen(annualData);
    return () => {
        annualData.splice(0, annualData.length, ...pool);
        for (const [label, liste] of Object.entries(REGIME_DATA)) liste.splice(0, liste.length, ...regime[label]);
        for (const [label, zeile] of Object.entries(uebergaenge)) Object.assign(REGIME_TRANSITIONS[label], zeile);
    };
}

/**
 * @template T
 * @param {() => T | Promise<T>} rueckruf
 * @returns {Promise<T>}
 */
export async function mitGrundbestandStichprobe(rueckruf) {
    if (!HAT_ANGEHAENGTE_JAHRE || sichtAktiv) return rueckruf();
    const wiederherstellen = poolBeschraenken();
    try {
        return await rueckruf();
    } finally {
        wiederherstellen();
    }
}

/**
 * Grundbestand für den ganzen Testprozess: Stichprobe und Backtest-Provider. Die einmalige MC-Vorprüfung der App
 * (Stichprobenjahre und Regimezählung gegen den Datenstand) läuft vorher auf dem vollständigen Datenstand.
 */
export function grundbestandSichtAktivieren() {
    if (sichtAktiv) return;
    sichtAktiv = true;
    if (!HAT_ANGEHAENGTE_JAHRE) return;
    prepareHistoricalDataOnce();
    poolBeschraenken();
}

/** Ist die Grundbestandssicht im Testprozess aktiv und gibt es angehängte Jahre? (Worker-Adapter laden sie dann mit.) */
export function grundbestandSichtWirkt() {
    return sichtAktiv && HAT_ANGEHAENGTE_JAHRE;
}

/** Backtest-Provider des Grundbestands 1925–2025; ohne angehängte Jahre derselbe wie der des Datenstands. */
export function grundbestandProvider() {
    return HAT_ANGEHAENGTE_JAHRE
        ? createHistoricalBacktestContractProvider({ records: GRUNDBESTAND_DATA, manifest: GRUNDBESTAND_MANIFEST })
        : createHistoricalBacktestContractProvider();
}

/** Backtest-Provider: nach `grundbestandSichtAktivieren()` der des Grundbestands, sonst der des Datenstands. */
export function historischerProvider() {
    return sichtAktiv ? grundbestandProvider() : createHistoricalBacktestContractProvider();
}
