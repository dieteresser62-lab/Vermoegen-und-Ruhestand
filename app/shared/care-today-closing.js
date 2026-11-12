/** FR-73 Punkt 13 und Gutachten PFA-2, Befund 1: Was der Jahresabschluss „Pflegewerte“ an den Personen festhält.
 * Der eigene Wert „Pflegekosten heute über die Kasse hinaus“ wird wie die Staffel fortgeschrieben; ohne „Im Heim seit“
 * verankert der Abschluss das Planjahr, in dem Heimjahr 1 angesetzt wurde, damit das Heimjahr danach weiterzählt.
 * Geschrieben wird nur hier (Abschluss), nie beim Lesen. */
import { CARE_VALUE_KEYS, careTodayFromRecord } from '../profile/profile-care.js';
import { balanceCareSettings, readBalancePersonStatus } from './person-data-status.js';
import { wholeEuro } from './care-prices.js';

/** × (1 + Inflation) × (1 + Kostenanstieg), auf ganze Euro.
 *
 * @param {number} monthly Eigener Wert in €/Monat.
 * @param {{inflationRate: number, driftPercent: number}} rates Prozentsätze des Abschlusses.
 * @returns {number} Fortgeschriebener Wert in €/Monat.
 */
export const projectCareTodayMonthly = (monthly, { inflationRate, driftPercent }) => wholeEuro(monthly * (1 + inflationRate / 100) * (1 + driftPercent / 100));

/** Personen des Haushalts mit heutigem Pflegezustand aus Registry und Livequelle; nur lesend.
 *
 * @param {import('../../typcheck/datenvertraege.js').RecordReader} storage Speicheradapter.
 * @param {{ids?: string[], activeId?: string|null, referenceYear?: number}} [options] Rechenumfang; ohne Angabe alle Haushaltsmitglieder.
 * @returns {{profileId: string, name: string, live: boolean, care: ReturnType<typeof careTodayFromRecord>}[]} Personen mit Pflegegrad heute.
 */
function carePersons(storage, { ids, activeId = storage.getItem('rs_current_profile'), referenceYear } = {}) {
    const status = readBalancePersonStatus({ storage, win: null, referenceYear });
    if (!status.ready || status.status === 'demo') return [];
    const settings = balanceCareSettings(status);
    return (status.entries || []).filter(entry => !ids || ids.includes(entry.profileId)).map(entry => ({ profileId: entry.profileId,
        name: entry.name || entry.profileId, live: entry.profileId === activeId, care: careTodayFromRecord(entry.data, settings), preset: settings.preset }))
        .filter(person => person.care.grade > 0);
}

/** Argon FR73A B4: Der eigene Wert wirkt nur bei Pflege zu Hause und nicht beim amtlichen Durchschnitt. Ein im Heim
 * stehen gebliebener Wert bleibt gespeichert, wird aber weder angezeigt noch fortgeschrieben.
 *
 * @param {{care: ReturnType<typeof careTodayFromRecord>, preset?: string}} person Person aus {@link carePersons}.
 * @returns {boolean} Ob der eigene Wert gilt.
 */
const ownValueApplies = person => Number.isFinite(person.care.homeCostsMonthly) && person.care.form !== 'residential' && person.preset !== 'amtlich';

/** Eigene Werte für Pflege zu Hause heute mit ihrer Fortschreibung, für die Anzeige im Dialog.
 *
 * @param {import('../../typcheck/datenvertraege.js').RecordReader} storage Speicheradapter.
 * @param {{inflationRate: number, driftPercent: number, ids?: string[]}} options Prozentsätze des Abschlusses.
 * @returns {{profileId: string, name: string, monthly: number, projected: number}[]} Personen mit eigenem Wert.
 */
export function careTodayOwnValuesForClosing(storage, { inflationRate, driftPercent, ids }) {
    return carePersons(storage, { ids }).filter(ownValueApplies)
        .map(person => ({ profileId: person.profileId, name: person.name, monthly: /** @type {number} */ (person.care.homeCostsMonthly),
            projected: projectCareTodayMonthly(/** @type {number} */ (person.care.homeCostsMonthly), { inflationRate, driftPercent }) }));
}

/** Abschluss: wirksame eigene Werte fortschreiben und den Heimjahr-Anker setzen; schreibt Registry und, für die aktive Person,
 * die Livequelle desselben Adapters. Ein im Dialog bestätigter eigener Betrag (`ownValues`, €/Monat je Person) ersetzt
 * die Fortschreibung und wird nicht nochmals erhöht (Gutachten PFA-4, Befund 3).
 *
 * @param {import('../../typcheck/datenvertraege.js').RecordStorage} storage Speicheradapter des Abschlussentwurfs.
 * @param {{ids: string[], activeId: string, inflationRate: number, driftPercent: number, targetYear: number, ownValues?: Record<string, number>}} options Rechenumfang und Abschlusswerte.
 * @returns {{profileId: string, key: string, value: string}[]} Geschriebene Felder.
 */
export function applyCareTodayClosing(storage, { ids, activeId, inflationRate, driftPercent, targetYear, ownValues = {} }) {
    const raw = storage.getItem('rs_profiles_v1');
    if (!raw) return [];
    for (const value of Object.values(ownValues)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Der eigene Pflegewert im Jahresabschluss muss ein Betrag ab 0 €/Monat sein.');
    }
    const registry = JSON.parse(raw), changes = [];
    for (const person of carePersons(storage, { ids, activeId, referenceYear: targetYear })) {
        const data = registry.profiles?.[person.profileId]?.data;
        if (!data) continue;
        const patch = {};
        if (ownValueApplies(person)) {
            const own = ownValues[person.profileId];
            patch[CARE_VALUE_KEYS.homeCostsMonthly] = String(own ?? projectCareTodayMonthly(/** @type {number} */ (person.care.homeCostsMonthly), { inflationRate, driftPercent }));
        }
        if (person.care.form === 'residential' && !person.care.residentialSince && !person.care.residentialFirstYear) {
            patch[CARE_VALUE_KEYS.residentialFirstYear] = String(targetYear);
        }
        for (const [key, value] of Object.entries(patch)) {
            data[key] = value;
            if (person.live) storage.setItem(key, value);
            changes.push({ profileId: person.profileId, key, value });
        }
    }
    if (changes.length) storage.setItem('rs_profiles_v1', JSON.stringify(registry));
    return changes;
}
