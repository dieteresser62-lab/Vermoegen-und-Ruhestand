/** FR-49: Dokumentation getrennt vom veräußerbaren Vermögen. */
export const IMMOBILIEN_KEY = 'profile_immobilien_v1';

/** Nur Anzeige: gespeicherte eigene Wertanteile der Haushaltsmitglieder. */
/**
 * @param profiles Personenquellen des ausgewählten Bereichs.
 * @returns Summe belegter eigener Immobilienanteile oder null.
 */
export function householdImmobilienValue(profiles) {
    if (!profiles.length || profiles.some(profile => !profile.valid)) return null;
    const entries = profiles.flatMap(profile => profile.values?.immobilien || []);
    if (!entries.length) return null;
    const total = entries.reduce((sum, entry) => sum + entry.wert, 0);
    return Number.isFinite(total) ? total : null;
}

/**
 * @param entries Einträge der betroffenen Liste.
 * @returns Feldbezogene Fehler der Immobilienliste.
 */
export function immobilienErrors(entries) {
    if (!Array.isArray(entries)) return [{ field: 'immobilien', message: 'Die Immobilienliste ist beschädigt.' }];
    const errors = [], ids = new Set();
    entries.forEach((entry, index) => {
        const add = (field, message) => errors.push({ field: `immobilie-${index}-${field}`, message });
        if (!entry || typeof entry !== 'object') { add('bezeichnung', 'Die Immobilienzeile ist beschädigt.'); return; }
        if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) add('id', 'Die Immobilienkennung fehlt oder ist doppelt.');
        ids.add(entry.id);
        if (typeof entry.bezeichnung !== 'string' || !entry.bezeichnung.trim() || entry.bezeichnung.length > 60) add('bezeichnung', 'Bitte eine Bezeichnung mit höchstens 60 Zeichen eingeben.');
        if (!['selbst', 'vermietet'].includes(entry.nutzung)) add('nutzung', 'Bitte die Nutzung wählen.');
        if (typeof entry.wert !== 'number' || !Number.isFinite(entry.wert) || entry.wert < 0) add('wert', 'Bitte einen Wert ab 0 Euro eingeben.');
        if (typeof entry.stand !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(entry.stand)) add('stand', 'Bitte einen gültigen Stand als MM.JJJJ eingeben.');
        if (typeof entry.mieteNetto !== 'number' || !Number.isFinite(entry.mieteNetto * 12) || entry.mieteNetto < 0) add('mieteNetto', 'Bitte eine Nettomiete ab 0 Euro eingeben.');
        if (entry.ortsueblicheMiete !== undefined && (typeof entry.ortsueblicheMiete !== 'number' || !Number.isFinite(entry.ortsueblicheMiete * 12) || entry.ortsueblicheMiete < 0)) add('ortsueblicheMiete', 'Bitte eine ortsübliche Miete ab 0 Euro eingeben oder das Feld leeren.');
        if (!['keine', 'inflation'].includes(entry.anpassung)) add('anpassung', 'Bitte keine oder Inflation wählen.');
        if (entry.wertverlauf !== undefined && !validWertverlauf(entry.wertverlauf)) add('wertverlauf', 'Der Wertverlauf der Immobilie ist beschädigt.');
    });
    return errors;
}

/** FR-85: Herkunft eines Eintrags im Wertverlauf. */
export const WERTVERLAUF_HERKUNFT = Object.freeze(['jahresabschluss', 'eingabe']);
const validDay = date => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1000-01-01') return false;
    const ms = Date.parse(date + 'T00:00:00Z');
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
};
/** Datierte Werte, je Tag höchstens einer, aufsteigend; ein Jahresabschluss-Eintrag liegt immer auf dem 31.12.
 * @param {unknown} list @returns {boolean} */
function validWertverlauf(list) {
    return Array.isArray(list) && list.length > 0 && list.every((item, index) => item !== null && typeof item === 'object'
        && validDay(item.datum) && (index === 0 || item.datum > list[index - 1].datum)
        && typeof item.wert === 'number' && Number.isFinite(item.wert) && item.wert >= 0
        && WERTVERLAUF_HERKUNFT.includes(item.herkunft) && (item.herkunft !== 'jahresabschluss' || item.datum.endsWith('-12-31'))
        && (item.grund === undefined || typeof item.grund === 'string' && item.grund.trim() !== '' && item.grund.length <= 120));
}
/** Entfernte Immobilien behalten ihren Verlauf bis zum Tag des Entfernens (FR-85 Punkt 4, Nachtrag 2).
 * @param {unknown} list @returns {boolean} */
function validBeendet(list) {
    const ids = new Set();
    return Array.isArray(list) && list.every(item => {
        const valid = item !== null && typeof item === 'object' && typeof item.id === 'string' && item.id !== '' && !ids.has(item.id)
            && typeof item.bezeichnung === 'string' && ['selbst', 'vermietet'].includes(item.nutzung) && validDay(item.ende)
            && validWertverlauf(item.wertverlauf) && item.wertverlauf.at(-1).datum <= item.ende;
        ids.add(item?.id);
        return valid;
    });
}

/**
 * @param raw Gespeicherter Rohwert.
 * @returns Geprüfte Kopien der Immobilienangaben.
 */
export function readImmobilien(raw) {
    return readImmobilienRecord(raw).entries;
}
/** Ganzer Record mit den beendeten Verläufen entfernter Immobilien; `readImmobilien` liefert nur die heutigen.
 * @param raw Gespeicherter Rohwert.
 * @returns {{entries: any[], beendet: any[]}} Geprüfte Kopien.
 */
export function readImmobilienRecord(raw) {
    if (raw == null || raw === '') return { entries: [], beendet: [] };
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error('Immobilien: unbekannte Version oder beschädigte Liste.');
    const errors = immobilienErrors(value.entries);
    if (errors.length) throw new Error(errors[0].message);
    if (value.beendet !== undefined && !validBeendet(value.beendet)) throw new Error('Immobilien: Der Verlauf entfernter Immobilien ist beschädigt.');
    assertStoredRecord(value.entries, value.beendet || []);
    return { entries: value.entries.map(entry => ({ ...entry })), beendet: (value.beendet || []).map(entry => ({ ...entry })) };
}
/** @param entries Heutige Immobilien. @param beendet Verläufe entfernter Immobilien; leer entfällt das Feld (bytegleich zu früher).
 * @returns {string} */
export const writeImmobilien = (entries, beendet = []) => {
    const errors = immobilienErrors(entries);
    if (errors.length) throw new Error(errors[0].message);
    if (!validBeendet(beendet)) throw new Error('Immobilien: Der Verlauf entfernter Immobilien ist beschädigt.');
    assertStoredRecord(entries, beendet);
    return JSON.stringify(beendet.length ? { schemaVersion: 1, entries, beendet } : { schemaVersion: 1, entries });
};

/** Gespeicherter Record (nicht der Formularentwurf): Der aktuelle Wert ist der letzte Verlaufseintrag, und eine Immobilie
 * ist entweder heutig oder beendet (Gutachten IM-1, P2).
 * @param {{id: string, bezeichnung: string, wert: number, wertverlauf?: {wert: number}[]}[]} entries @param {{id: string, bezeichnung: string}[]} beendet */
function assertStoredRecord(entries, beendet) {
    for (const entry of entries) if (entry.wertverlauf && entry.wertverlauf.at(-1).wert !== entry.wert)
        throw new Error(`Immobilie „${entry.bezeichnung}“: Der aktuelle Wert passt nicht zum letzten Eintrag im Wertverlauf.`);
    const active = new Set(entries.map(entry => entry.id));
    const both = beendet.find(item => active.has(item.id));
    if (both) throw new Error(`Immobilie „${both.bezeichnung}“ steht zugleich unter den heutigen und den entfernten Immobilien.`);
}

/** FR-85: Wertverlauf beim Lesen ergänzt. Fehlt er, gilt der heutige Wert ab seinem Stand.
 * @param {{wert: number, stand: string, wertverlauf?: {datum: string, wert: number, herkunft: string, grund?: string}[]}} entry
 * @returns {{datum: string, wert: number, herkunft: string, grund?: string}[]} */
export function immobilienWertverlauf(entry) {
    return entry.wertverlauf ? entry.wertverlauf.map(item => ({ ...item })) : [{ datum: `${entry.stand}-01`, wert: entry.wert, herkunft: 'eingabe' }];
}
/** Wert an einem Tag: letzter Eintrag bis einschließlich dieses Tages, davor der erste bekannte Wert (ohne Rückrechnung).
 * @param {{datum: string, wert: number}[]} verlauf @param {string} datum YYYY-MM-DD @returns {number} */
export function immobilienWertAm(verlauf, datum) {
    let wert = verlauf[0].wert;
    for (const item of verlauf) { if (item.datum > datum) break; wert = item.wert; }
    return wert;
}
/** Setzt einen Eintrag; ein Eintrag desselben Tages wird ersetzt.
 * @param {{datum: string}[]} verlauf @param {{datum: string, wert: number, herkunft: string, grund?: string}} item */
export function setWertverlaufEintrag(verlauf, item) {
    return [...verlauf.filter(entry => entry.datum !== item.datum), item].sort((a, b) => a.datum.localeCompare(b.datum));
}
/** FR-85 Punkt 2: Speichern in Personen & Vermögen. Ein geänderter Wert ergänzt einen Eintrag „Eingabe“ mit dem Tagesdatum;
 * eine entfernte Immobilie behält ihren Verlauf mit Ende am Tag des Entfernens. Ohne Wertänderung bleiben die Bytes wie bisher.
 * @param {string|null} raw Bisheriger Record. @param {any[]} entries Neue Liste aus dem Formular. @param {string} datum YYYY-MM-DD.
 * @returns {string} */
export function writeImmobilienMitVerlauf(raw, entries, datum) {
    let before = { entries: [], beendet: [] };
    try { before = readImmobilienRecord(raw); } catch { /* Beschädigter Altbestand: das Formular entscheidet wie bisher. */ }
    const next = entries.map(entry => {
        const old = before.entries.find(item => item.id === entry.id), result = { ...entry };
        // Ein Eintrag nach der neuen Eingabe wird nicht übernommen: ein aus dem Stand abgeleiteter (Stand in der Zukunft, Gutachten IM-1,
        // Nachtrag 3) ebenso wie ein gespeicherter nach einem Datumssprung zurück im Spielbereich (JV-1). Die Eingabe ersetzt ihn, der
        // Verlauf bleibt chronologisch und endet mit dem aktuellen Wert. Echte Daten laufen nur vorwärts; dort fällt nichts weg.
        if (old && old.wert !== entry.wert) result.wertverlauf = setWertverlaufEintrag(immobilienWertverlauf(old)
            .filter(item => item.datum <= datum), { datum, wert: entry.wert, herkunft: 'eingabe' });
        else if (old?.wertverlauf) result.wertverlauf = old.wertverlauf;
        else delete result.wertverlauf;
        return result;
    });
    const removed = before.entries.filter(old => !entries.some(entry => entry.id === old.id)).map(old => {
        const verlauf = immobilienWertverlauf(old).filter(item => item.datum <= datum);
        return { id: old.id, bezeichnung: old.bezeichnung, nutzung: old.nutzung, ende: datum,
            wertverlauf: verlauf.length ? verlauf : [{ datum, wert: old.wert, herkunft: 'eingabe' }] };
    });
    return writeImmobilien(next, [...before.beendet.filter(item => !removed.some(entry => entry.id === item.id)), ...removed]);
}

/** Gemeinsame Ableitung für Balance, Simulator und Einkünfteanzeige. */
/**
 * @param entries Einträge der betroffenen Liste.
 * @returns Monatliche Einkünfte aus vermieteten Immobilien.
 */
export function immobilienIncome(entries) {
    return entries.filter(entry => entry.nutzung === 'vermietet' && entry.mieteNetto > 0).map(entry => ({
        id: `immobilie:${entry.id}`, art: 'sonstige', bezeichnung: `Miete · ${entry.bezeichnung}`.slice(0, 60),
        betragMonat: entry.mieteNetto, ab: null, bis: null, anpassung: entry.anpassung
    }));
}
