/** FR-49: Dokumentation getrennt vom veräußerbaren Vermögen. */
export const IMMOBILIEN_KEY = 'profile_immobilien_v1';

/** Nur Anzeige: gespeicherte eigene Wertanteile der Haushaltsmitglieder. */
/**
 * @param profiles Personenquellen des ausgewählten Bereichs.
 * @returns Summe belegter eigener Immobilienanteile oder null.
 */
export function householdImmobilienValue(profiles) {
    const members = profiles.filter(profile => profile.belongs);
    if (!members.length || members.some(profile => !profile.valid)) return null;
    const entries = members.flatMap(profile => profile.values?.immobilien || []);
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
    });
    return errors;
}

/**
 * @param raw Gespeicherter Rohwert.
 * @returns Geprüfte Kopien der Immobilienangaben.
 */
export function readImmobilien(raw) {
    if (raw == null || raw === '') return [];
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error('Immobilien: unbekannte Version oder beschädigte Liste.');
    const errors = immobilienErrors(value.entries);
    if (errors.length) throw new Error(errors[0].message);
    return value.entries.map(entry => ({ ...entry }));
}
export const writeImmobilien = entries => {
    const errors = immobilienErrors(entries);
    if (errors.length) throw new Error(errors[0].message);
    return JSON.stringify({ schemaVersion: 1, entries });
};

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
