// FR-79 Punkt 11 und Ergänzung 1 Punkt 5: ausdrückliche Entscheidungen zum Jahresplan, getrennt vom versiegelten Jahresbeleg.
// Je Planjahr und Haushalt: Planzeilen mit „Rest bleibt im Depot“ und der Verzicht auf den Geldmarktkauf aus dem Verkaufserlös.
// Fehlt der Schlüssel, gibt es keine Entscheidung (nur beim Lesen ergänzt, keine Schreib-Migration).
import { persistenceStorage } from '../shared/persistence-facade.js';

export const ANNUAL_PLAN_RESOLUTIONS_KEY = 'annual_plan_resolutions_v1';
export const KEEP_IN_DEPOT = 'keep_in_depot';
const REASON_MAX = 500;

/** @param {unknown} value @returns {value is Record<string, any>} */
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));

/** Schlüssel eines Eintrags: Planjahr und die sortierten Personen des Plans. @param {number} year @param {string[]} ids */
export const annualPlanResolutionKey = (year, ids) => JSON.stringify([year, [...new Set(ids)].sort()]);

/** Schlüssel einer Planzeile: die Belegquelle („person:tranche“), ohne Tranche ihre Stelle im Beleg.
 * @param {{trancheId?: string|null, index: number}} line */
export const annualPlanLineKey = line => line.trancheId ? String(line.trancheId) : `#${line.index}`;

/** @param {unknown} raw @returns {{version: 1, entries: Record<string, any>}} */
export function assertAnnualPlanResolutions(raw) {
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!plain(record) || record.version !== 1 || !plain(record.entries)) throw new Error('Beschädigte Entscheidungen zum Jahresplan.');
    for (const [key, entry] of Object.entries(record.entries)) {
        if (!plain(entry) || !Number.isInteger(entry.year) || !Array.isArray(entry.ids) || !entry.ids.length
            || entry.ids.some(id => typeof id !== 'string' || !id) || key !== annualPlanResolutionKey(entry.year, entry.ids)
            || !plain(entry.lines)) throw new Error('Entscheidung zum Jahresplan gehört nicht zum angegebenen Jahr oder Haushalt.');
        for (const line of Object.values(entry.lines)) {
            if (!plain(line) || line.decision !== KEEP_IN_DEPOT || !timestamp(line.decidedAt)
                || line.reason !== undefined && (typeof line.reason !== 'string' || line.reason.length > REASON_MAX)) throw new Error('Ungültige Entscheidung zu einer Planzeile.');
        }
        if (entry.distribution !== undefined && (!plain(entry.distribution) || entry.distribution.keepCash !== true || !timestamp(entry.distribution.decidedAt)))
            throw new Error('Ungültige Entscheidung zur Verteilung.');
    }
    return /** @type {{version: 1, entries: Record<string, any>}} */ (record);
}

/** Entscheidungen eines Plans; ohne Schlüssel oder Eintrag leer. Ein beschädigter Schlüssel zählt als „keine Entscheidung“.
 * @param {{year: number, ids: string[], storage?: {getItem: (key: string) => string|null}}} options */
export function readAnnualPlanResolutions({ year, ids, storage = persistenceStorage }) {
    const empty = { lines: {}, distribution: null, valid: true };
    let raw = null;
    try { raw = storage.getItem(ANNUAL_PLAN_RESOLUTIONS_KEY); } catch { return empty; }
    if (raw === null || raw === undefined) return empty;
    try {
        const entry = assertAnnualPlanResolutions(raw).entries[annualPlanResolutionKey(year, ids)];
        return entry ? { lines: entry.lines, distribution: entry.distribution ?? null, valid: true } : empty;
    } catch { return { ...empty, valid: false }; }
}

/** Neuer Rohwert mit geänderter Entscheidung. `line` mit `decision: null` nimmt „Rest bleibt im Depot“ zurück. `lines` ändert mehrere
 * Zeilen derselben Gruppe (Person und Anlageklasse) auf einmal.
 * @param {string|null} raw @param {{year: number, ids: string[], line?: {key: string, decision: string|null, reason?: string},
 * lines?: {key: string, decision: string|null, reason?: string}[], keepCash?: boolean, now: string}} change */
export function buildAnnualPlanResolutions(raw, { year, ids, line, lines = [], keepCash, now }) {
    const record = raw === null || raw === undefined ? { version: 1, entries: {} } : structuredClone(assertAnnualPlanResolutions(raw));
    const key = annualPlanResolutionKey(year, ids);
    const entry = record.entries[key] ?? { year, ids: [...new Set(ids)].sort(), lines: {} };
    for (const change of [...lines, ...(line ? [line] : [])]) {
        if (change.decision === KEEP_IN_DEPOT) {
            const reason = typeof change.reason === 'string' ? change.reason.trim().slice(0, REASON_MAX) : '';
            entry.lines[change.key] = { decision: KEEP_IN_DEPOT, decidedAt: now, ...(reason ? { reason } : {}) };
        } else delete entry.lines[change.key];
    }
    if (keepCash === true) entry.distribution = { keepCash: true, decidedAt: now };
    else if (keepCash === false) delete entry.distribution;
    record.entries[key] = entry;
    assertAnnualPlanResolutions(record);
    return JSON.stringify(record);
}
