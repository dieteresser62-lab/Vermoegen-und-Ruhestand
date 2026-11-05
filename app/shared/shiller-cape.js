// r.jina.ai liefert die XLS als HTML. Nur Tabellenzellen lesen, kein fremdes HTML einfügen.
export const SHILLER_PAGE_URL = 'https://r.jina.ai/https://www.shillerdata.com/';

const cellText = html => html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').trim();

/**
 * @param html Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function shillerDownloadUrl(html) {
    for (const match of html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
        const url = new URL(match[1].replace(/&amp;/g, '&'), 'https://www.shillerdata.com/');
        if (url.protocol === 'https:' && url.hostname === 'img1.wsimg.com' && /\/ie_data\.xls$/i.test(url.pathname)) {
            return `https://r.jina.ai/${url.href}`;
        }
    }
    throw new Error('shillerdata.com verlinkt keine lesbare ie_data.xls.');
}

function shillerMonth(token) {
    // Excel schreibt Oktober als .1 (Dezimalzahl), Januar als .01.
    const match = token.match(/^((?:18|19|20)\d{2})\.(\d{1,2})$/);
    if (!match) return null;
    const month = Number(match[2].padEnd(2, '0'));
    return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, '0')}-01` : null;
}

/**
 * @param asOf Wert für den bestehenden Aufrufvertrag.
 * @param targetYear Wert für den bestehenden Aufrufvertrag.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function isCapeCurrentForYear(asOf, targetYear) {
    return Number.isInteger(targetYear) && /^\d{4}-(10|11|12)-(0[1-9]|[12]\d|3[01])$/.test(asOf || '')
        && Number(asOf.slice(0, 4)) === targetYear && Number.isFinite(Date.parse(asOf))
        && new Date(asOf).toISOString().slice(0, 10) === asOf;
}

/**
 * @param html Wert für den bestehenden Aufrufvertrag.
 * @param targetYear Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function parseShillerCapeTable(html, targetYear) {
    let best = null;
    for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
        let dateColumn = -1, capeColumn = -1;
        for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const cells = [...row[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];
            const labels = cells.map(cell => cellText(cell[2]));
            if (labels.includes('Date') && labels.includes('CAPE')) {
                // Mehrdeutige Köpfe oder verbundene Zellen dürfen die Spalte nicht verschieben.
                if (labels.filter(label => label === 'Date').length !== 1 || labels.filter(label => label === 'CAPE').length !== 1) return null;
                dateColumn = labels.indexOf('Date'); capeColumn = labels.indexOf('CAPE');
                continue;
            }
            if (dateColumn < 0 || capeColumn < 0) continue;
            if (cells.some(cell => /\b(?:colspan|rowspan)\s*=\s*["']?(?:[2-9]|\d{2,})\b/i.test(cell[1]))) return null;
            const asOf = shillerMonth(labels[dateColumn] || '');
            if (!asOf || Number(asOf.slice(0, 4)) > targetYear) continue;
            const cell = cells[capeColumn];
            // LibreOffice erhält den Originalwert in sdval; die sichtbare Zahl ist gerundet.
            const raw = cell?.[1].match(/\bsdval\s*=\s*"([^"]+)"/i)?.[1] ?? labels[capeColumn];
            const ratio = /^\d+(?:\.\d+)?$/.test(raw || '') ? Number(raw) : NaN;
            if (!Number.isFinite(ratio) || ratio <= 5 || ratio >= 80) continue;
            if (!best || asOf > best.capeAsOf) best = { capeRatio: ratio, capeAsOf: asOf };
        }
    }
    return best;
}

/**
 * @param stored Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function capeManualHint(stored = {}) {
    const value = Number.isFinite(stored.capeRatio) && stored.capeRatio > 0
        ? stored.capeRatio.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : 'kein Wert';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(stored.capeAsOf || '')
        ? new Date(stored.capeAsOf).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Stand unbekannt';
    return `CAPE nicht automatisch ermittelt. Zuletzt gespeichert: ${value} (${date}). `
        + 'Trage den aktuellen Wert aus shillerdata.com (Datentabelle, Spalte CAPE) unten ein.';
}
