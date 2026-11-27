/**
 * Sicht auf den Grundbestand 1925–2025 für eingefrorene Klasse-3-Belege (JD-2a, jahresrobust).
 *
 * Solange kein Jahr angehängt ist, ist die Sicht der Live-Stand selbst. Nach einer Übernahme vergleicht ein Beleg
 * die Live-Jahressätze bis 2025 (Inhaltshash) und das Manifest, das der heutige Code für den Grundbestand baut
 * (Zeitraum 1925–2025, Revision des Grundbestands). Ändert sich ein altes Jahr oder der Manifestcode, fällt das auf.
 */
import { GRUNDBESTAND, grundbestandRecords } from '../../scripts/lib/jahresdaten/grundbestand.mjs';
import { buildHistoricalDataManifest, HISTORICAL_DATA, HISTORICAL_DATENSTAND } from '../../app/simulator/simulator-data.js';
import { canonicalizeHistoricalContractValue, computeHistoricalDatasetHash, sha256Hex } from '../../app/simulator/historical-backtest-contract.js';

/** Live-Jahressätze bis zum Grundbestandsende. */
export const GRUNDBESTAND_DATA = Object.freeze(grundbestandRecords(HISTORICAL_DATA));

/** Datenstand des Grundbestands: live, solange das Endjahr das Grundbestandsende ist. */
export const GRUNDBESTAND_DATENSTAND = HISTORICAL_DATENSTAND.endYear === GRUNDBESTAND.endYear
    ? HISTORICAL_DATENSTAND
    : Object.freeze({ ...HISTORICAL_DATENSTAND, endYear: GRUNDBESTAND.endYear, revision: GRUNDBESTAND.revision,
        contentHash: computeHistoricalDatasetHash(GRUNDBESTAND_DATA) });

/** Manifest des Grundbestands aus dem heutigen Manifestcode. */
export const GRUNDBESTAND_MANIFEST = buildHistoricalDataManifest(GRUNDBESTAND_DATENSTAND);

/**
 * Wertehash einer Kettentabelle über die Jahre bis zum Grundbestandsende (gleiche Kanonisierung wie die Kettenhashes).
 * Ohne angehängte Jahre gleich dem Wertehash der Kette.
 * @param {Record<string, number>} values
 */
export function grundbestandWerteHash(values) {
    return sha256Hex(canonicalizeHistoricalContractValue(grundbestandRecords(values)));
}
