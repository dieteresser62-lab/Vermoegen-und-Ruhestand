const ABENDBOERSEN = ['SG', 'DU', 'MU'];
const BOERSEN = { GER: 'Xetra', STU: 'Stuttgart', DUS: 'Düsseldorf', MUN: 'München/gettex' };
const BOERSEN_NACH_ENDUNG = { DE: 'Xetra', SG: 'Stuttgart', DU: 'Düsseldorf', MU: 'München/gettex' };
const MAX_ALTER_MS = 7 * 86400_000;
// Wie die Einzelprüfung im Kursdienst: Eine Uhr, die bis zu fünf Minuten nachgeht, verwirft keinen frischen Kurs.
const ZUKUNFT_MS = 5 * 60_000;
const berlinerTag = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function kurssymbole(ticker) {
    return ticker.toUpperCase().endsWith('.DE')
        ? [ticker, ...ABENDBOERSEN.map(endung => `${ticker.slice(0, -3)}.${endung}`)]
        : [ticker];
}

export function boersenname(ticker, exchangeName) {
    const endung = ticker.match(/\.([A-Z]+)$/i)?.[1].toUpperCase();
    return Object.hasOwn(BOERSEN_NACH_ENDUNG, endung) ? BOERSEN_NACH_ENDUNG[endung]
        : Object.hasOwn(BOERSEN, exchangeName) ? BOERSEN[exchangeName] : exchangeName || null;
}

/**
 * Wählt aus den Tageskursen eines Tickers. Bei anderen Endungen steht nur der
 * eingetragene Ticker zur Wahl. Alle Zeitangaben sind ISO-Zeitpunkte.
 * @template {{kurs?: number, vortag?: number|null, waehrung?: string|null, zeit?: string|null, fehler?: string}} T
 * @param {string} ticker @param {T[]} kurse @param {string} jetzt
 */
export function waehle(ticker, [basis, ...abends], jetzt) {
    if (!ticker.toUpperCase().endsWith('.DE')) return basis ?? { fehler: 'kein Kurs' };

    const stand = Date.parse(jetzt);
    const gueltig = kurs => {
        const zeit = Date.parse(kurs?.zeit);
        return !kurs?.fehler && Number.isFinite(kurs?.kurs) && kurs.kurs > 0 && kurs.waehrung === 'EUR'
            && zeit <= stand + ZUKUNFT_MS && stand - zeit <= MAX_ALTER_MS;
    };
    const xetra = gueltig(basis) ? basis : null;
    const heute = berlinerTag.format(stand);
    let bester = xetra;
    for (const kurs of abends) {
        if (!gueltig(kurs)) continue;
        const zeit = Date.parse(kurs.zeit);
        if (xetra && (berlinerTag.format(zeit) !== heute
            || Math.abs(kurs.kurs - xetra.kurs) > xetra.kurs * 0.05 + xetra.kurs * Number.EPSILON)) continue;
        if (!bester || zeit > Date.parse(bester.zeit)) bester = kurs;
    }
    if (!bester) return basis?.fehler ? basis : { fehler: 'kein Kurs' };
    if (!xetra || bester === xetra) return bester;
    const vortag = berlinerTag.format(Date.parse(xetra.zeit)) === heute ? xetra.vortag : xetra.kurs;
    return { ...bester, vortag };
}
