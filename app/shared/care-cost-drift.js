// FR-73 Punkt 8 (geändert 12.11.2026): Pflegekosten steigen je Kalenderjahr um die Inflation und zusätzlich um eine erste Rate
// bis einschließlich eines Wechseljahrs, danach um eine zweite Rate. Der Preisschritt in ein Kalenderjahr y nimmt die Rate von y.
// Simulator, Backtest, Balance und Jahresabschluss rechnen über dieselben Funktionen.
import { appNow } from './app-clock.js';

/** Eingabegrenzen für ein neues Bis-Jahr. Im Spielbereich gilt das Jahr der Fachuhr. */
export const CARE_DRIFT_YEAR_RANGE = Object.freeze({ get min() { return appNow().getFullYear(); }, max: 2100 });
/** Vorgabe: + 5 % bis einschließlich 2035, ab 2036 + 2 % über der Inflation. */
export const CARE_DRIFT_SCHEDULE_DEFAULT = Object.freeze({ firstPercent: 5, untilYear: 2035, afterPercent: 2 });
/** Erste Rate, die ohne gespeicherte zweite Rate als Vorgabe gilt. Die alte Vorgabe 3,5 % kommt hier schon als 5 % an:
 * Der Resolver deutet sie im Altbestand um; ein bewusst eingetragener Wert (`driftMarked`, auch 3,5 %) bleibt (PFA-4 B6). */
const DEFAULT_FIRST_RATES = new Set([5]);

/** Wirksamer Verlauf nach der Altbestandsregel [A7]:
 * - zweite Rate gespeichert → so, wie gespeichert (Wechseljahr fehlend = Vorgabe);
 * - erste Rate fehlend oder genau 5 % (die alte Vorgabe 3,5 % liefert der Resolver schon als 5 %) → Vorgabe;
 * - sonst x dauerhaft (zweite Rate = x).
 * @param {{firstPercent?: number|null, untilYear?: number|null, afterPercent?: number|null}} [stored]
 * @returns {{firstPercent: number, untilYear: number, afterPercent: number}} */
export function resolveCareDriftSchedule({ firstPercent = null, untilYear = null, afterPercent = null } = {}) {
    const finite = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isFinite(value);
    const until = finite(untilYear) ? /** @type {number} */ (untilYear) : CARE_DRIFT_SCHEDULE_DEFAULT.untilYear;
    if (finite(afterPercent)) {
        return { firstPercent: finite(firstPercent) ? /** @type {number} */ (firstPercent) : CARE_DRIFT_SCHEDULE_DEFAULT.firstPercent,
            untilYear: until, afterPercent: /** @type {number} */ (afterPercent) };
    }
    if (!finite(firstPercent) || DEFAULT_FIRST_RATES.has(/** @type {number} */ (firstPercent))) return { ...CARE_DRIFT_SCHEDULE_DEFAULT };
    return { firstPercent: /** @type {number} */ (firstPercent), untilYear: until, afterPercent: /** @type {number} */ (firstPercent) };
}

/** Rate über der Inflation in Prozent für den Preisschritt in das Kalenderjahr `year`.
 * @param {number} year @param {{firstPercent: number, untilYear: number, afterPercent: number}} schedule @returns {number} */
export function careDriftRateForYear(year, schedule) {
    return year <= schedule.untilYear ? schedule.firstPercent : schedule.afterPercent;
}

/** Preisfaktor ohne Inflation vom Preisstand `fromYear` bis `toYear`: Produkt der Schritte in die Jahre fromYear+1 … toYear.
 * @param {number} fromYear @param {number} toYear @param {{firstPercent: number, untilYear: number, afterPercent: number}} schedule
 * @returns {number} */
export function careCostDriftFactor(fromYear, toYear, schedule) {
    if (schedule.firstPercent === schedule.afterPercent) return Math.pow(1 + schedule.firstPercent / 100, Math.max(0, toYear - fromYear));
    const first = Math.max(0, Math.min(toYear, schedule.untilYear) - fromYear);
    const after = Math.max(0, toYear - Math.max(fromYear, schedule.untilYear));
    return Math.pow(1 + schedule.firstPercent / 100, first) * Math.pow(1 + schedule.afterPercent / 100, after);
}

/** Preisfaktor der Simulator-Eingaben für `yearIndex` (Verhältnisse wie `pflegeKostenDrift`). Ohne zweite Rate oder ohne
 * Kalenderjahr des Index 0 (`pflegeKostenStartJahr`) wie bisher: (1 + Rate) ^ yearIndex.
 * @param {any} inputs Simulator-Eingaben mit `pflegeKostenDrift` und optional `pflegeKostenDriftBis`, `pflegeKostenDriftDanach`, `pflegeKostenStartJahr`.
 * @param {number} yearIndex @returns {number} */
export function simulatorCareDriftFactor(inputs, yearIndex) {
    const first = Number(inputs?.pflegeKostenDrift) || 0;
    const after = Number(inputs?.pflegeKostenDriftDanach), until = Number(inputs?.pflegeKostenDriftBis), start = Number(inputs?.pflegeKostenStartJahr);
    if (!Number.isFinite(after) || after === first || !Number.isFinite(until) || !Number.isFinite(start)) return Math.pow(1 + first, yearIndex);
    return careCostDriftFactor(start, start + yearIndex, { firstPercent: first * 100, untilYear: until, afterPercent: after * 100 });
}

/** Kurztext für Anzeigen: „Inflation + 5 % bis 2035, danach + 2 %“ oder bei gleichen Raten „Inflation + x %“.
 * @param {{firstPercent: number, untilYear: number, afterPercent: number}} schedule @returns {string} */
export function careDriftLabel(schedule) {
    const pct = (/** @type {number} */ value) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)} %`;
    return schedule.firstPercent === schedule.afterPercent ? `Inflation + ${pct(schedule.firstPercent)}`
        : `Inflation + ${pct(schedule.firstPercent)} bis ${schedule.untilYear}, danach + ${pct(schedule.afterPercent)}`;
}

/** Simulator-Eingaben aus dem Verlauf: `pflegeKostenDrift` (erste Rate als Verhältnis) wie bisher; bei verschiedenen Raten
 * zusätzlich Wechseljahr, zweite Rate und das Kalenderjahr von `yearIndex = 0`. Gleiche Raten ergeben die bisherigen Eingaben.
 * @param {{firstPercent: number, untilYear: number, afterPercent: number}} schedule @param {number|null|undefined} startYear
 * @returns {{pflegeKostenDrift: number, pflegeKostenDriftBis?: number, pflegeKostenDriftDanach?: number, pflegeKostenStartJahr?: number}} */
export function careDriftInputPatch(schedule, startYear) {
    const first = Math.max(0, schedule.firstPercent) / 100;
    if (schedule.firstPercent === schedule.afterPercent) return { pflegeKostenDrift: first };
    return { pflegeKostenDrift: first, pflegeKostenDriftBis: schedule.untilYear, pflegeKostenDriftDanach: Math.max(0, schedule.afterPercent) / 100,
        ...(startYear != null && Number.isFinite(Number(startYear)) ? { pflegeKostenStartJahr: Number(startYear) } : {}) };
}

/** Ohne Pflegelogik und ohne Pflegegrad heute rechnet niemand Pflegekosten; dann bleiben die Eingaben wie vor dem Verlauf
 * (nur `pflegeKostenDrift`), damit Läufe ohne Pflege bytegleich bleiben. Ändert das übergebene Objekt.
 * @template {Record<string, any>} T @param {T} inputs @returns {T} */
export function dropUnusedCareDrift(inputs) {
    if (inputs.pflegefallLogikAktivieren === true || inputs.careToday?.grade || inputs.partner?.careToday?.grade) return inputs;
    for (const key of ['pflegeKostenDriftBis', 'pflegeKostenDriftDanach', 'pflegeKostenStartJahr']) delete inputs[key];
    return inputs;
}
