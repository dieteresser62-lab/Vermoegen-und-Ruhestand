/** FR-73: ausschließlich lesende Auflösung gespeicherter Pflegepreise an der Eingabegrenze.
 * Wirksame Runner-Eingaben (insbesondere der Drift als Verhältnis) werden hier nie eingelesen. */
export const CARE_COST_DEFAULTS = Object.freeze({ 1: 3600, 2: 6000, 3: 18000, 4: 32000, 5: 60000 });
export const CARE_DRIFT_DEFAULT_PERCENT = 5;
const LEGACY = { 1: 6000, 2: 12000 };
const GRADES = [1, 2, 3, 4, 5];
const numberOr = (raw, fallback) => {
    const text = raw == null ? '' : String(raw).trim();
    const value = Number(text.replace(',', '.'));
    return !text || !Number.isFinite(value) ? fallback : Math.max(0, value);
};

/** raw darf fehlen; eine bewusste Null bleibt Null. Keine Speicherzugriffe oder Schreibmethoden.
 * `reinterpret: false` liest bewusst gespeicherte Werte (Markierung im Pflegewerte-Record) ohne Umdeutung. */
export function resolveCareSetting(key, raw, { reinterpret = true } = {}) {
    const grade = /^sim_pflegeStufe([1-5])Zusatz$/.exec(key)?.[1];
    if (grade) {
        const value = numberOr(raw, CARE_COST_DEFAULTS[grade]);
        return reinterpret && value === LEGACY[grade] ? CARE_COST_DEFAULTS[grade] : value;
    }
    if (key === 'sim_pflegeKostenDrift') {
        const value = numberOr(raw, CARE_DRIFT_DEFAULT_PERCENT);
        return reinterpret && value === 3.5 ? CARE_DRIFT_DEFAULT_PERCENT : value;
    }
    if (key === 'sim_pflegeMaxFloor') return numberOr(raw, 120000);
    if (key === 'sim_pflegeHeimEigeneAusgaben') return numberOr(raw, 500);
    if (key === 'sim_pflegeCustomCosts') return parseRememberedCareCosts(raw, { reinterpret })?.values ?? null;
    return raw;
}

const validRemembered = values => GRADES.every(g => typeof values?.[g] === 'string' && values[g].trim() !== ''
    && Number.isFinite(Number(values[g])) && Number(values[g]) >= 0);

/** Gemerkte Staffel „Individuelle Werte“ (`sim_pflegeCustomCosts`). Gutachten PFA-2, Befund 7: Die bewusste
 * Eingabe steht am gemerkten Datensatz selbst (`{version: 1, origin: 'von Hand', values}`); ein flacher
 * Altbestand ohne Markierung bleibt Altbestand, gleich ob der Haushalt inzwischen einen Preisblock hat.
 * `defaultGrades` nennt die Grade, deren gemerkter Altwert nur „Vorgabe“ bedeutet.
 *
 * @param {unknown} raw Gespeicherter JSON-Text.
 * @param {{reinterpret?: boolean}} [options]
 * @returns {{values: Record<number, string>, marked: boolean, defaultGrades: number[]}|null} Gemerkte Beträge oder null.
 */
export function parseRememberedCareCosts(raw, { reinterpret = true } = {}) {
    let parsed;
    try { parsed = JSON.parse(/** @type {string} */ (raw)); } catch { return null; }
    const marked = parsed?.version === 1 && parsed.origin === 'von Hand' && parsed.values && typeof parsed.values === 'object';
    const values = marked ? parsed.values : parsed;
    if (!validRemembered(values)) return null;
    const resolved = Object.fromEntries(GRADES.map(g => [g,
        String(resolveCareSetting(`sim_pflegeStufe${g}Zusatz`, values[g], { reinterpret: reinterpret && !marked }))]));
    const defaultGrades = marked ? [] : GRADES.filter(g => [LEGACY[g], CARE_COST_DEFAULTS[g]].includes(Number(values[g])));
    return { values: resolved, marked, defaultGrades };
}

/** Schreibform einer bewusst gemerkten Staffel (Markierung am Datensatz).
 *
 * @param {Record<number, string>} values Fünf Feldwerte als Text.
 * @returns {string} JSON für `sim_pflegeCustomCosts`.
 */
export const rememberedCareCostsRecord = values => JSON.stringify({ version: 1, origin: 'von Hand', values });

/** Gemeinsamer Lesepfad für Speicheradapter und Profilrecords; der Adapter braucht nur getItem. */
export function readCareCostSettings(source) {
    const read = key => typeof source?.getItem === 'function' ? source.getItem(key) : source?.[key];
    return { costs: Object.fromEntries(GRADES.map(g => [g, resolveCareSetting(`sim_pflegeStufe${g}Zusatz`, read(`sim_pflegeStufe${g}Zusatz`))])),
        driftPercent: resolveCareSetting('sim_pflegeKostenDrift', read('sim_pflegeKostenDrift')),
        maximumFloor: resolveCareSetting('sim_pflegeMaxFloor', read('sim_pflegeMaxFloor')),
        ownExpensesMonthly: resolveCareSetting('sim_pflegeHeimEigeneAusgaben', read('sim_pflegeHeimEigeneAusgaben')),
        rememberedCosts: resolveCareSetting('sim_pflegeCustomCosts', read('sim_pflegeCustomCosts')) };
}
