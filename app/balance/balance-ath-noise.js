/** Grundrauschen am Allzeithoch (FR-89, Ergänzung 3): eine Stelle für alle Engine-Aufrufe der Balance. Liegt der Kurs (`endeVJ`)
 * höchstens `CONFIG.MARKET.ATH_NOISE_BAND_PCT` unter dem echten Hoch, sieht die Engine ath = Kurs und jahreSeitAth = 0, also
 * „am Hoch“. Gespeichert und angezeigt bleibt das echte Hoch mit Datum und Alter. Engine, Simulator und Backtest bleiben unverändert. */
import { CONFIG } from './balance-config.js';

export const ATH_NOISE_BAND_PCT = CONFIG.MARKET.ATH_NOISE_BAND_PCT;
/** Zusatz, wo das Hoch steht, wenn die Regel greift. */
export const ATH_NOISE_BAND_TEXT = `gilt als Höchststand (Grundrauschen bis ${ATH_NOISE_BAND_PCT} %)`;

/** Echter Abstand des Kurses unter dem Hoch in Prozent; `null` ohne gültige Werte.
 * @param {{ath?: number|null, endeVJ?: number|null}|null|undefined} inputs @returns {number|null} */
export function athDistancePct(inputs) {
    const ath = Number(inputs?.ath), index = Number(inputs?.endeVJ);
    return ath > 0 && index > 0 ? (ath - index) / ath * 100 : null;
}

/** Ein Jahr im Sinn der Marktanalyse (FR-90): ab 11,95 Monaten zählt ein Hoch als ein Jahr alt, auch das vom 31.12. des Vorjahrs
 * am Jahresende (365 Tage = 11,99 Monate). */
const ONE_YEAR_MONTHS = 11.95;

/** Der Kurs liegt unter dem Hoch, höchstens im Grundrauschen, und das echte Hoch ist jünger als ein Jahr (FR-89, Ergänzung 4).
 * Sonst gälte ein Minusjahr am Vorjahreshoch als Höchststand. Auf oder über dem Hoch greift die Regel nicht; dort sieht die
 * Engine ohnehin einen Höchststand. Alter 0 bei einem Kurs unter dem Hoch (Altbestand, Handeingabe) zählt die Marktanalyse als
 * zwölf Monate; auch dann greift sie nicht. @param {{ath?: number|null, endeVJ?: number|null, jahreSeitAth?: number|null}|null|undefined} inputs */
export function athNoiseBandApplies(inputs) {
    const distance = athDistancePct(inputs), age = Number(inputs?.jahreSeitAth);
    return distance !== null && distance > 0 && distance <= ATH_NOISE_BAND_PCT && Number.isFinite(age) && age > 0 && age * 12 < ONE_YEAR_MONTHS;
}

/** Engine-Eingabe der Balance: im Grundrauschen ath = Kurs und jahreSeitAth = 0; sonst unverändert. Wiederholt anwendbar.
 * @template {{ath?: number|null, endeVJ?: number|null, jahreSeitAth?: number|null}} T @param {T} input @returns {T} */
export function withAthNoiseBand(input) {
    return athNoiseBandApplies(input) ? { ...input, ath: input.endeVJ, jahreSeitAth: 0 } : input;
}
