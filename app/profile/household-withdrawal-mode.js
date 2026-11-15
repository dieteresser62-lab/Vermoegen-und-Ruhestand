// Haushaltsentnahmemodus (Verteilung im Haushalt). FR-80: Neben steueroptimiert, anteilig und nach Reichweite gibt es
// „Eine Person trägt“; gespeichert als `one_carries:<Person>` im vorhandenen Feld `householdWithdrawalMode`, ohne neues Feld
// und ohne Schreib-Migration (alte Werte bleiben gültig).

export const WITHDRAWAL_MODES = Object.freeze(['tax_optimized', 'proportional', 'runway_first']);
export const ONE_CARRIES = 'one_carries';
const PREFIX = `${ONE_CARRIES}:`;

/** Gespeicherter Wert für „Eine Person trägt“. @param {string} profileId @returns {string} */
export const oneCarriesMode = profileId => `${PREFIX}${profileId}`;

/** Art des Modus und die tragende Person (nur bei „Eine Person trägt“).
 * @param {unknown} mode @returns {{kind: string, carrierId: string|null}} */
export function parseWithdrawalMode(mode) {
    const text = typeof mode === 'string' ? mode : '';
    if (text.startsWith(PREFIX) && text.length > PREFIX.length) return { kind: ONE_CARRIES, carrierId: text.slice(PREFIX.length) };
    return { kind: text || 'tax_optimized', carrierId: null };
}

/** Gültiger gespeicherter Wert. @param {unknown} mode @returns {boolean} */
export const isWithdrawalMode = mode => WITHDRAWAL_MODES.includes(/** @type {string} */ (mode))
    || parseWithdrawalMode(mode).kind === ONE_CARRIES && !/[\s:]/.test(/** @type {string} */ (parseWithdrawalMode(mode).carrierId));

/** Tragende Person, wenn sie zu den gerechneten Personen gehört; sonst null (dann gilt „steueroptimiert“, FR-80 Punkt 5).
 * @param {unknown} mode @param {{profileId?: string}[]} profiles @returns {string|null} */
export function activeCarrier(mode, profiles) {
    const { kind, carrierId } = parseWithdrawalMode(mode);
    return kind === ONE_CARRIES && profiles.some(profile => profile?.profileId === carrierId) ? carrierId : null;
}

/** TRG-1b (P3-6): „Eine Person trägt“ ist gewählt, die tragende Person gehört aber nicht mehr zum Haushalt (gelöscht).
 * Gerechnet wird dann steueroptimiert; Haushalt & Plan und Balance sagen es. @param {unknown} mode @param {{profileId?: string}[]} profiles */
export const carrierMissing = (mode, profiles) => parseWithdrawalMode(mode).kind === ONE_CARRIES && profiles.length > 0 && !activeCarrier(mode, profiles);
/** VN-3 (Ergänzung 1 FR-80): Das Vermögen der tragenden Person reicht nicht für ihr Liquiditätsziel; die andere Person verkauft dafür
 * nichts. Gleicher Wortlaut in Balance und Simulator. @param {string} name @param {string} money formatierter Fehlbetrag */
export const CARRIER_RESERVE_SHORT_TEXT = (name, money) => `Reserve von ${name || 'der tragenden Person'} unter Ziel: Das eigene Vermögen reicht nicht zum Auffüllen, es fehlen ${money}. Für das Auffüllen verkauft die andere Person nichts.`;
export const CARRIER_MISSING_TEXT = 'Die tragende Person gibt es nicht mehr – bitte neu wählen. Bis dahin rechnet die App steueroptimiert.';
