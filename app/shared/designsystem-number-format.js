// Ausschließlich UI-Ausgabe; Eingaben, Parser und Exportformate bleiben numerisch.
export function formatDisplayNumber(value, { unit = 'number', fractionDigits = 1, minimumFractionDigits = fractionDigits,
    applicable = true, reason = '', allowInfinity = false } = {}) {
    if (!applicable) return `Nicht anwendbar (${reason || 'kein Bezug'})`;
    const suffix = { ratio: '\u00a0%', percent: '\u00a0%', currency: '\u00a0€', years: '\u00a0Jahre', months: '\u00a0Monate', price: '\u00a0€/Stück' }[unit] || '';
    if (value === Infinity && allowInfinity) return '∞' + suffix;
    if (typeof value !== 'number' || !Number.isFinite(value)) return `— (${reason || 'Wert fehlt'})`;
    const scaled = unit === 'ratio' ? value * 100 : value;
    const number = scaled.toLocaleString('de-DE', { minimumFractionDigits, maximumFractionDigits: fractionDigits });
    return number + suffix;
}

export function formatDisplayDate(value) {
    // Der persistierte ISO-Tag wird nur für die Anzeige umgestellt, ohne Zeitzonenwechsel.
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value.split('-').reverse().join('.') : '— (Datum fehlt)';
}

// Bestehende toFixed-Rundung einschließlich binärer Grenzfälle beibehalten.
// Nur sichtbare Texte, niemals Koordinaten, Inputwerte oder Exportprojektionen.
export function formatDisplayFixed(value, digits = 1) {
    return value.toFixed(digits).replace('.', ',');
}

// Bereits skalierte Parameter ohne zusätzliche Rundung oder Einheitenänderung.
export function formatDisplayScalar(value) {
    return typeof value === 'number' ? String(value).replace('.', ',') : value;
}

// Nur bereits formatierte Logzellen; die Exportspalten benutzen weiter Legacy.
export function formatDisplayLogValue(value) {
    if (typeof value !== 'string') return value;
    if (/^[+-]?\d+(?:\.\d+)?(?:%|M)?$/.test(value)) {
        return value.replace('.', ',').replace(/([%M])$/, '\u00a0$1');
    }
    return value.replace(/ (?=€)/g, '\u00a0');
}
