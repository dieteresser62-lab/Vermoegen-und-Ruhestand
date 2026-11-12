/** UR-1: „Erfasste Vermögensstände“ im Reiter Verlauf als Aufklappzeile. Zugeklappt nennt der Kopf Anzahl, letztes Datum und
 * Einheit; aufgeklappt steht die unveränderte Tabelle in einem Kasten mit eigener Scrollleiste. Auf- und Zuklappen ist
 * reine Darstellung im Dokument: Es schreibt nie, und jeder Seitenaufruf beginnt zugeklappt. */

const dateLabel = value => String(value || '').split('-').reverse().join('.');

/** Kopfzeile der zugeklappten Zeile.
 *
 * @param {{asOf: string}[]} rows Erfasste Stände, älteste zuerst (wie `projectHistoryClosures`).
 * @returns {string} „N Einträge · zuletzt TT.MM.JJJJ · nominale Euro“, leer ohne Stände.
 */
export function wealthRecordsSummary(rows) {
    if (!rows?.length) return '';
    const latest = rows.reduce((last, row) => row.asOf > last ? row.asOf : last, rows[0].asOf);
    return `${rows.length} ${rows.length === 1 ? 'Eintrag' : 'Einträge'} · zuletzt ${dateLabel(latest)} · nominale Euro`;
}

function paint(doc) {
    const body = doc.getElementById('managerWealthRecordsBody');
    const open = body ? !body.hidden : false;
    doc.getElementById('managerWealthRecordsToggle')?.setAttribute('aria-expanded', String(open));
    const action = doc.getElementById('managerWealthRecordsAction');
    if (action) action.textContent = open ? '▾ ausblenden' : '▸ zeigen';
}

/** Zeigt die Zeile nur, wenn es Stände gibt, und setzt den Kopftext. Der Klappzustand bleibt, wie er ist.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {{asOf: string}[]} rows Erfasste Stände der Ansicht.
 * @returns {void}
 */
export function renderWealthRecords(doc, rows) {
    const summary = wealthRecordsSummary(rows);
    const row = doc.getElementById('managerWealthRecords');
    if (row) row.hidden = !summary;
    const text = doc.getElementById('managerWealthRecordsSummary');
    if (text) text.textContent = summary;
    paint(doc);
}

const bound = new WeakSet();

/** Bindet den Zeilenkopf genau einmal je Dokument; der native Knopf übernimmt Enter und Leertaste.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @returns {void}
 */
export function bindWealthRecords(doc) {
    if (!doc?.getElementById || bound.has(doc)) return;
    bound.add(doc);
    doc.getElementById('managerWealthRecordsToggle')?.addEventListener('click', () => {
        const body = doc.getElementById('managerWealthRecordsBody');
        if (body) body.hidden = !body.hidden;
        paint(doc);
    });
}
