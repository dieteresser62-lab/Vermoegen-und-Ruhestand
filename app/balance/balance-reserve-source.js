import { ActionRenderer } from './balance-renderer-action.js';
import { summarizeBalanceAction } from './balance-action-summary.js';
import { currentYearActionSource, recalculatedActionSource } from './balance-reserves.js';

/** Dieselbe Aktionsaufbereitung ohne DOM-Schreibzugriff für Diagnose und Reserven „nach Umsetzung“.
 * @param {any} currentYear Laufendes Jahr (Eingaben, Aktion, Ziel, Personeneinträge).
 * @param {ReturnType<typeof currentYearActionSource>} source Aktionsquelle.
 * @returns {{source: ReturnType<typeof currentYearActionSource>, prepared: any[], base: ReturnType<typeof summarizeBalanceAction>}} */
export function prepareReserveSource(currentYear, source) {
    const prepared = new ActionRenderer({}).prepareExecutionEntries(source.entries, currentYear.zielLiquiditaet);
    return { source, prepared, base: summarizeBalanceAction(source.action, source.action, prepared) };
}

/** Aktionsquelle der Reservekarte: festgeschriebene Handlungsanweisung mit offenem Rest, sonst die Neuberechnung.
 * WT-1: Wirft die Aufbereitung des Belegs (etwa weil die Liquidität nach einem Kauf nicht mehr reicht), rechnen Karte und
 * Diagnose mit der Neuberechnung weiter. Die Seite bricht nie ab.
 * @param {any} currentYear @param {any} [confirmed] Beleg aus `projectBalanceActionOrigin` samt Umsetzungsstand. */
export function reserveActionSource(currentYear, confirmed = null) {
    try { return prepareReserveSource(currentYear, currentYearActionSource(currentYear, confirmed)); }
    catch (error) {
        if (!confirmed) throw error;
        console.warn('Jahresbeleg nicht auf heutige Bestände anwendbar; Reserven rechnen neu:', error);
        return prepareReserveSource(currentYear, recalculatedActionSource(currentYear));
    }
}
