/**
 * Grundbestand der historischen Reihen (JD-2a, Fortschreibungsschicht).
 *
 * Die Originale unter data/historical/<kette>/originals und die sechs Bauskripte bleiben für 1925–2025
 * eingefroren. Ihre Ausgaben sind der Grundbestand. Jedes spätere Jahr kommt nur aus einer
 * Jahreslieferung unter data/historical/<kette>/jahre/<Jahr>/ und wird mit derselben Rechenregel
 * angehängt (scripts/lib/jahresdaten/ketten/*.mjs).
 *
 * Revision und Inhaltshash sind die Kennung des Grundbestands. Eingefrorene Belege (Klasse 3, siehe
 * tests/README.md) vergleichen ihre Werte nach einer Übernahme gegen diese Kennung und die Jahre bis
 * zum Grundbestandsende.
 */
export const GRUNDBESTAND = Object.freeze({
    startYear: 1925,
    endYear: 2025,
    revision: '2026-08-01.4',
    contentHash: 'c79350c5abf2dee2feeaae65c88ed5e58487f878cb598fdffc132fbf48d01e79'
});

/** Letztes Jahr, das die Bauskripte aus den Originalen bauen. */
export const GRUNDBESTAND_END_YEAR = GRUNDBESTAND.endYear;

/**
 * Jahressätze bis zum Grundbestandsende.
 * @template T
 * @param {Record<string, T>} records Jahressätze je Jahr.
 * @returns {Record<string, T>}
 */
export function grundbestandRecords(records) {
    return Object.fromEntries(Object.entries(records).filter(([year]) => Number(year) <= GRUNDBESTAND_END_YEAR));
}
