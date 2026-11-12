/** UR-1: Aufklappzeilen „Annahmen für spätere Pflege“ im Reiter Pflege. Zugeklappt nennt jede Zeile einen Satz mit den
 * aktuellen Werten; aufgeklappt stehen die Bedienteile. Auf- und Zuklappen ist reine Darstellung im Dokument: Es schreibt
 * nie, und beim nächsten Seitenaufruf ist wieder alles zugeklappt. */
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { residentialComponents, residentialMonthly } from '../shared/household-care-values.js';

export const CARE_ROWS = Object.freeze(['Home', 'Heim', 'Flex', 'Rise', 'Allowance']);
const GRADES = [1, 2, 3, 4, 5];
const PRESET_LABELS = { custom: 'Eigene Werte', ambulant: 'Ambulant', amtlich: 'Amtlicher Durchschnitt' };
const num = value => formatDisplayNumber(Number(value), { fractionDigits: 0 });
const pct = value => Number(value).toLocaleString('de-DE');
const month = value => String(value || '').split('-').reverse().join('.');

/** UR-2: Herkunft von Pflegegeld oder Heimwert: „gesetzlich, Stand 01.2026“, „mitgeliefert, Stand 07.2026“,
 * „fortgeschrieben, Stand …“ oder nach eigener Änderung „von Hand, gültig ab MM.JJJJ“.
 *
 * @param {{origin: string, asOf: string, validFrom: string}} part `allowance` oder `residential` des Pflegewerte-Records.
 * @param {'allowance'|'residential'} kind Teil des Records.
 * @returns {string} Herkunft für Zeilenkopf und Quelle.
 */
export function careOriginText(part, kind) {
    if (part.origin === 'von Hand') return `von Hand, gültig ab ${month(part.validFrom)}`;
    return `${kind === 'allowance' ? 'gesetzlich' : part.origin}, Stand ${month(part.asOf)}`;
}

/** „Grad 1 bis 3“, „Grad 4 und 5“, „Grad 2“ oder „Grad 1, 3 und 5“. */
function gradeList(grades) {
    if (grades.length === 1) return `Grad ${grades[0]}`;
    const contiguous = grades.every((grade, index) => index === 0 || grade === grades[index - 1] + 1);
    if (contiguous && grades.length > 2) return `Grad ${grades[0]} bis ${grades[grades.length - 1]}`;
    return `Grad ${grades.slice(0, -1).join(', ')} und ${grades[grades.length - 1]}`;
}

/** Je Zeile ein Satz aus den gespeicherten Werten, wie die Bedienteile sie zeigen. Rechnet nichts Neues und schreibt nie.
 *
 * @param {{values: Record<string, string>, careValues: import("../../typcheck/datenvertraege.js").HouseholdCareValues,
 *   officialCosts?: Record<number, number>|null, homeGrades?: Set<number>}} input Werte des Reiters Pflege.
 * @returns {Record<string, string>} Satz je Zeile ({@link CARE_ROWS}).
 */
export function careRowSummaries({ values, careValues, officialCosts = null, homeGrades = new Set() }) {
    const official = values.pflegeKostenStaffelPreset === 'amtlich';
    const annual = grade => official ? officialCosts[grade] : Number(values[`pflegeStufe${grade}Zusatz`]);
    const amounts = grades => `${grades.map(grade => num(annual(grade) / 12)).join(' / ')} €/Monat`;
    // Wie die Tabelle: Zeilen „im Heim“ rechnen mit Heimkosten, außer jemand lebt heute mit diesem Grad zu Hause.
    const residential = grade => !official && values[`pflegeStufe${grade}Form`] === 'residential' && !homeGrades.has(grade);
    const home = GRADES.filter(grade => !residential(grade)), heim = GRADES.filter(residential);
    const staffel = official ? `${gradeList(GRADES)}: ${amounts(GRADES)}`
        : [home.length ? `${gradeList(home)} zu Hause: ${amounts(home)}` : '', heim.length ? `${gradeList(heim)} im Heim` : ''].filter(Boolean).join(' · ');
    const components = residentialComponents(careValues.residential);
    return {
        Home: `${PRESET_LABELS[values.pflegeKostenStaffelPreset] || PRESET_LABELS.custom} · ${staffel} · Deckel ${num(values.pflegeMaxFloor)} €/Jahr je Person`,
        Heim: `Eigenanteil ${num(residentialMonthly(components, 1))} €/Monat im 1. Heimjahr, ab dem 4. Jahr ${num(residentialMonthly(components, 4))} € · eigene Ausgaben ${num(values.pflegeHeimEigeneAusgaben)} €/Monat je Person · ${careOriginText(careValues.residential, 'residential')}`,
        Flex: `Vom Wunsch- und Mindest-Flex bleiben bei Grad 1 bis 5: ${GRADES.map(grade => pct(values[`pflegeStufe${grade}FlexCut`])).join(' / ')} %`,
        Rise: `${pct(values.pflegeKostenDrift)} % p.a. über der Inflation · regionaler Zuschlag ${pct(values.pflegeRegionalZuschlag)} % · gilt für zu Hause und Heim`,
        Allowance: `Grad 2 bis 5: ${[2, 3, 4, 5].map(grade => num(careValues.allowance.values[grade])).join(' / ')} €/Monat · nur bei Pflege durch Angehörige · ${careOriginText(careValues.allowance, 'allowance')}`
    };
}

/** Schreibt die Sätze in die Zeilenköpfe; fehlende Knoten werden übersprungen.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {Record<string, string>} summaries Ergebnis von {@link careRowSummaries}.
 * @returns {void}
 */
export function renderCareRowSummaries(doc, summaries) {
    for (const key of CARE_ROWS) {
        const node = doc.getElementById(`managerCareRow${key}Summary`);
        if (node && node.textContent !== summaries[key]) node.textContent = summaries[key];
    }
}

const rowBody = (doc, key) => doc.getElementById(`managerCareRow${key}Body`);
const presentRows = doc => CARE_ROWS.filter(key => rowBody(doc, key));

/** Spiegelt den sichtbaren Zustand in Knopftext und aria-expanded, einzeln und für „Alle Details“. */
function paint(doc) {
    const rows = presentRows(doc);
    for (const key of rows) {
        const open = !rowBody(doc, key).hidden;
        doc.getElementById(`managerCareRow${key}Toggle`)?.setAttribute('aria-expanded', String(open));
        const action = doc.getElementById(`managerCareRow${key}Action`);
        if (action) action.textContent = open ? '▾ ausblenden' : '▸ zeigen';
    }
    const all = doc.getElementById('managerCareToggleAll');
    if (all) {
        const expanded = rows.length > 0 && rows.every(key => !rowBody(doc, key).hidden);
        all.textContent = expanded ? '▾ Alle Details ausblenden' : '▸ Alle Details zeigen';
        all.setAttribute('aria-expanded', String(expanded));
    }
}

/** Öffnet oder schließt Zeilen. Nur Darstellung.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {Record<string, boolean>} changes Zeile → offen.
 * @returns {void}
 */
export function setCareRows(doc, changes) {
    for (const [key, open] of Object.entries(changes)) {
        const body = rowBody(doc, key);
        if (body) body.hidden = !open;
    }
    paint(doc);
}

/** Sprungziel in eine zugeklappte Zeile: öffnet die Zeile, die das Element enthält.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {string} elementId Kennung des Sprungziels.
 * @returns {string|null} Geöffnete Zeile oder null, wenn das Ziel in keiner Zeile liegt.
 */
export function revealCareRowFor(doc, elementId) {
    const element = doc.getElementById(elementId);
    if (!element) return null;
    const key = presentRows(doc).find(row => rowBody(doc, row) === element || rowBody(doc, row).contains?.(element));
    if (!key) return null;
    if (rowBody(doc, key).hidden) setCareRows(doc, { [key]: true });
    return key;
}

const bound = new WeakSet();

/** Bindet die Zeilenköpfe und „Alle Details“ genau einmal je Dokument. Native Knöpfe übernehmen Enter und Leertaste.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @returns {void}
 */
export function bindCareRows(doc) {
    if (!doc?.getElementById || bound.has(doc)) return;
    bound.add(doc);
    for (const key of CARE_ROWS) {
        doc.getElementById(`managerCareRow${key}Toggle`)?.addEventListener('click', () => setCareRows(doc, { [key]: rowBody(doc, key)?.hidden === true }));
    }
    doc.getElementById('managerCareToggleAll')?.addEventListener('click', () => {
        const rows = presentRows(doc), open = !rows.every(key => !rowBody(doc, key).hidden);
        setCareRows(doc, Object.fromEntries(rows.map(key => [key, open])));
    });
    paint(doc);
}
