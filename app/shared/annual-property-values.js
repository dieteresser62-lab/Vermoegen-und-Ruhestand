/** FR-85: Immobilienwerte im Jahresabschluss fortschreiben. Lesen und Vorschlag ohne Writes; geschrieben wird nur im Abschlussentwurf. */
import { IMMOBILIEN_KEY, readImmobilienRecord, immobilienWertverlauf, immobilienWertAm, setWertverlaufEintrag, writeImmobilien } from '../profile/profile-immobilien.js';

const yearEnd = year => `${year}-12-31`;
/** Je Immobilie und Jahr höchstens ein Jahresabschluss-Eintrag (Nachtrag 4).
 * @param {{datum: string, herkunft: string}[]} verlauf @param {number} year @returns {boolean} */
const closedFor = (verlauf, year) => verlauf.some(item => item.datum === yearEnd(year) && item.herkunft === 'jahresabschluss');
/** Liegt der erste belegte Wertstand ganz nach dem 31.12., ist der Wert schon neuer als das Abschlussjahr: kein Vorschlag
 * (Steuerung 16.11.2026; Gutachten IM-1 P2: auch mit Verlauf, der erst nach dem Jahr beginnt). Ohne Verlauf zählt der Stand.
 * @param {{wert: number, stand: string, wertverlauf?: {datum: string, wert: number, herkunft: string}[]}} home @param {number} year @returns {boolean} */
const newerThanYear = (home, year) => immobilienWertverlauf(home)[0].datum > yearEnd(year);

/** Personendaten wie beim Tagesgeld: die aktive Person aus dem Livespeicher, die übrigen aus der Registry.
 * @param {{getItem: (key: string) => string|null}} storage @param {any} registry @param {string} id @param {string|null} activeId */
const homesRaw = (storage, registry, id, activeId) => id === activeId ? storage.getItem(IMMOBILIEN_KEY) : registry?.profiles?.[id]?.data?.[IMMOBILIEN_KEY] ?? null;

/** Immobilien der Personen im Abschluss, die für das Jahr noch keinen Jahresabschluss-Eintrag haben und deren Wert nicht schon neuer ist. Verkaufte (entfernte)
 * Immobilien erscheinen nicht. Wert bisher ist der Wert am 31.12. des Jahres, sonst der erste bekannte.
 * @param {{storage: {getItem: (key: string) => string|null}, people: {id: string, name: string}[], targetYear: number}} options
 * @returns {{profileId: string, name: string, id: string, bezeichnung: string, nutzung: string, mieteNetto: number, stand: string,
 *   base: number, later: {datum: string, wert: number}|null}[]} */
export function readAnnualProperties({ storage, people, targetYear }) {
    let registry = null;
    try { registry = JSON.parse(storage.getItem('rs_profiles_v1') || 'null'); } catch { registry = null; }
    const activeId = storage.getItem('rs_current_profile');
    return people.flatMap(person => {
        let entries = [];
        try { entries = readImmobilienRecord(homesRaw(storage, registry, person.id, activeId)).entries; } catch { entries = []; }
        return entries.flatMap(home => {
            const verlauf = immobilienWertverlauf(home);
            if (closedFor(verlauf, targetYear) || newerThanYear(home, targetYear)) return [];
            const later = verlauf.filter(item => item.datum > yearEnd(targetYear)).at(-1) || null;
            return [{ profileId: person.id, name: person.name, id: home.id, bezeichnung: home.bezeichnung, nutzung: home.nutzung,
                mieteNetto: home.mieteNetto, stand: home.stand, base: immobilienWertAm(verlauf, yearEnd(targetYear)),
                later: later && { datum: later.datum, wert: later.wert } }];
        });
    });
}

/** Wert × (1 + Inflation), auf ganze Euro gerundet; ohne Inflation der bisherige Wert.
 * @param {number} base @param {number|null} rate Inflation in Prozent. @returns {number} */
export function annualPropertyProposal(base, rate) {
    return Number.isFinite(rate) ? Math.floor(base * (100 + /** @type {number} */ (rate)) / 100 + 0.5 + 1e-9) : base;
}

/** Bestätigte Werte in den Abschlussentwurf: Eintrag zum 31.12. mit Herkunft „Jahresabschluss“ (gegebenenfalls mit Grund).
 * Gibt es keinen späteren Eintrag, werden Wert und Stand (Januar des Folgejahrs, damit der Simulator das Jahr nicht noch einmal
 * fortschreibt) gesetzt; sonst bleibt der aktuelle Wert. Ein schon vorhandener Jahresabschluss-Eintrag bleibt unverändert.
 * @param {{adapter: {getItem: (key: string) => string|null, setItem: (key: string, value: string) => void}, activeId: string,
 *   targetYear: number, propertyValues: {year: number, entries: {profileId: string, id: string, wert: number, grund?: string}[]}}} options
 * @returns {void} */
export function applyAnnualPropertyValues({ adapter, activeId, targetYear, propertyValues }) {
    if (propertyValues.year !== targetYear) throw new Error('Die Immobilienwerte sind nicht für dieses Jahr bestätigt.');
    if (!propertyValues.entries.length) return;
    const registry = JSON.parse(/** @type {string} */ (adapter.getItem('rs_profiles_v1')));
    for (const profileId of [...new Set(propertyValues.entries.map(entry => entry.profileId))]) {
        if (!registry.profiles?.[profileId]) throw new Error('Die Haushaltsperson ist nicht mehr vorhanden.');
        const record = readImmobilienRecord(homesRaw(adapter, registry, profileId, activeId));
        for (const confirmed of propertyValues.entries.filter(entry => entry.profileId === profileId)) {
            if (!Number.isFinite(confirmed.wert) || confirmed.wert < 0) throw new Error('Der Immobilienwert ist ungültig.');
            const home = record.entries.find(entry => entry.id === confirmed.id);
            if (!home) throw new Error('Die Immobilie ist nicht mehr vorhanden.');
            const verlauf = immobilienWertverlauf(home);
            if (closedFor(verlauf, targetYear) || newerThanYear(home, targetYear)) continue;
            const grund = typeof confirmed.grund === 'string' ? confirmed.grund.trim().slice(0, 120) : '';
            home.wertverlauf = setWertverlaufEintrag(verlauf, { datum: yearEnd(targetYear), wert: confirmed.wert, herkunft: 'jahresabschluss', ...(grund ? { grund } : {}) });
            if (!verlauf.some(item => item.datum > yearEnd(targetYear))) { home.wert = confirmed.wert; home.stand = `${targetYear + 1}-01`; }
        }
        const raw = writeImmobilien(record.entries, record.beendet);
        registry.profiles[profileId].data[IMMOBILIEN_KEY] = raw;
        if (profileId === activeId) adapter.setItem(IMMOBILIEN_KEY, raw);
    }
    adapter.setItem('rs_profiles_v1', JSON.stringify(registry));
}
