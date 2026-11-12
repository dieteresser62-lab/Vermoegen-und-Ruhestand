// FR-78: Anzeige ohne Scheingenauigkeit. Gerundet wird nur der sichtbare Betrag einer berechneten Größe; gerechnet,
// gespeichert, exportiert und protokolliert wird weiter ungerundet. Die Engine-Staffel `CONFIG.ANTI_PSEUDO_ACCURACY`
// bleibt davon unberührt. Ohne Importe, damit Übersicht und Balance keine schweren Module laden.

/** Anzeigestaffel (Ergänzung FR-78): [Obergrenze exklusiv, Stufe] in Euro. */
export const DISPLAY_ROUNDING = Object.freeze({
    /** Jahres- und Bestandswerte. */
    ANNUAL_TIERS: Object.freeze([
        Object.freeze({ limit: 10000, step: 500 }),
        Object.freeze({ limit: 25000, step: 1000 }),
        Object.freeze({ limit: 50000, step: 2500 }),
        Object.freeze({ limit: 200000, step: 5000 }),
        Object.freeze({ limit: 1000000, step: 10000 }),
        Object.freeze({ limit: Infinity, step: 25000 })
    ]),
    /** Monatswerte. */
    MONTHLY_TIERS: Object.freeze([
        Object.freeze({ limit: 2000, step: 50 }),
        Object.freeze({ limit: 5000, step: 100 }),
        Object.freeze({ limit: Infinity, step: 250 })
    ])
});

/** Werte bis einen halben Cent neben einer Stufe gelten als genau auf der Stufe. */
const ON_STEP_TOLERANCE = 0.005;

/** Stufe für einen Betrag ohne Vorzeichen. @param {number} amount @param {'annual'|'monthly'} [period] @returns {number} */
export function displayRoundingStep(amount, period = 'annual') {
    const tiers = period === 'monthly' ? DISPLAY_ROUNDING.MONTHLY_TIERS : DISPLAY_ROUNDING.ANNUAL_TIERS;
    const value = Math.abs(amount);
    return (tiers.find(tier => value < tier.limit) || tiers[tiers.length - 1]).step;
}

/**
 * Rundet einen Betrag für die Anzeige. Gerundet wird der Betrag ohne Vorzeichen; ein Wert genau auf einer Stufe bleibt.
 * Nicht endliche Werte kommen unverändert zurück, damit die Formatierer ihren Platzhalter zeigen.
 * @template T
 * @param {T} value
 * @param {{direction: 'up'|'down', period?: 'annual'|'monthly'}} options
 * @returns {T|number}
 */
export function roundForDisplay(value, { direction, period = 'annual' }) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return value;
    const amount = Math.abs(value);
    const step = displayRoundingStep(amount, period);
    const nearest = Math.round(amount / step) * step;
    const rounded = Math.abs(amount - nearest) <= ON_STEP_TOLERANCE ? nearest
        : (direction === 'up' ? Math.ceil(amount / step) : Math.floor(amount / step)) * step;
    return value < 0 ? -rounded : rounded;
}

/** Was ausgegeben oder gebraucht wird (Bedarf, Ziele, Verkaufs- und Umschichtungsbeträge, Steuer): aufrunden.
 * @param {number|null|undefined} value @returns {any} */
export const displayUp = value => roundForDisplay(value, { direction: 'up' });
/** Was zur Verfügung steht (Liquidität nach Umsetzung, Vermögens-Projektion): abrunden. @param {number|null|undefined} value @returns {any} */
export const displayDown = value => roundForDisplay(value, { direction: 'down' });
/** Monatlicher Bedarf: aufrunden. @param {number|null|undefined} value @returns {any} */
export const displayMonthlyUp = value => roundForDisplay(value, { direction: 'up', period: 'monthly' });
/** Monatsbudget und Flex-Spielraum: abrunden. @param {number|null|undefined} value @returns {any} */
export const displayMonthlyDown = value => roundForDisplay(value, { direction: 'down', period: 'monthly' });

/** Jahreswert aus dem Monatswert (Ergänzung FR-78 Punkt 2): gerundeter Monatswert × 12.
 * @param {number|null|undefined} monthly @param {'up'|'down'} direction @returns {any} */
export function displayAnnualFromMonthly(monthly, direction) {
    const rounded = roundForDisplay(monthly, { direction, period: 'monthly' });
    return typeof rounded === 'number' && Number.isFinite(rounded) ? rounded * 12 : rounded;
}

/** RD-1c: Betrag einer Hauptaktion. Ein Kauf ist Geld, das zum Anlegen zur Verfügung steht, und wird abgerundet; so unterschreitet
 * der angezeigte Kauf nie die Reserve. Verkäufe und Umschichtungen werden aufgerundet.
 * @param {string|null|undefined} verb z. B. „Aktien kaufen“ @param {number|null|undefined} amount @returns {any} */
export function displayActionAmount(verb, amount) {
    if (!/ kaufen$/.test(String(verb || ''))) return displayUp(amount);
    const down = displayDown(amount);
    // Ein Kauf unter der kleinsten Stufe stünde sonst als 0 €; dann ganze Euro, abgerundet.
    return down === 0 && typeof amount === 'number' && amount >= 1 ? Math.floor(amount) : down;
}
