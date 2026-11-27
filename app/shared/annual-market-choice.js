/** Altbestand [A7]: Belege und Protokolle aus der Zeit vor FR-89 mit der Wahl „Jahreshoch“ bleiben lesbar.
 * Neue Abschlüsse speichern keine Lesart mehr; das Allzeithoch kommt automatisch aus den Tageskursen. */

/** @param {string|null|undefined} value */
const marketChoiceDate = value => value?.split('-').reverse().join('.') || 'Datum nicht belegt';

/** Text der alten Wahl „Mit dem Jahreshoch“, sonst `null`.
 * @param {{reading?: string, asOf?: string}|null|undefined} reading @returns {string|null} */
export const annualMarketChoiceLabel = reading => reading?.reading === 'year_high'
    ? `Plan mit dem Jahreshoch vom ${marketChoiceDate(reading.asOf)} (Wahl im Jahresabschluss)` : null;
