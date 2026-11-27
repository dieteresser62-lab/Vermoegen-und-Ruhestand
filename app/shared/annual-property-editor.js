import { readAnnualProperties, annualPropertyProposal } from './annual-property-values.js';
import { persistenceStorage } from './persistence-facade.js';
import { parseHouseholdPlanNumber } from './household-plan-fields.js';
import { formatDisplayNumber } from './designsystem-number-format.js';

const money = value => formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2, minimumFractionDigits: 0 });
const amountText = value => formatDisplayNumber(value, { fractionDigits: 2, minimumFractionDigits: 0 });
const percent = value => formatDisplayNumber(value, { unit: 'percent', fractionDigits: 2, minimumFractionDigits: 0 });
const signed = value => `${value < 0 ? '−' : '+'} ${money(Math.abs(value))}`;
const dayText = date => date.split('-').reverse().join('.');
const monthText = month => month.split('-').reverse().join('.');
const thousands = value => value >= 1000 || value <= -1000 ? `${(value / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} T` : value.toLocaleString('de-DE');
const niceStep = value => { const power = 10 ** Math.floor(Math.log10(value)); return [1, 2, 2.5, 5, 10].map(factor => factor * power).find(step => step >= value - 1e-9); };
const SVG = 'http://www.w3.org/2000/svg';

/** FR-85: Schritt „Immobilienwerte“ im Jahresabschluss, gebaut wie „Pflegewerte“ (Entwurf IM-1). Der Entwurf bleibt bis zum
 * Jahresbatch im Dialog; gespeichert wird erst mit dem Abschluss.
 *
 * @param {{doc: Document, targetYear: number, people: {id: string, name: string}[], listen: (...args: any[]) => void,
 *   storage?: {getItem: (key: string) => string|null}, onState?: () => void}} options
 * @returns {{present: boolean, root: HTMLElement, setInflation: (rate: number|null) => boolean,
 *   read: () => {present: boolean, confirmed: boolean, dirty: boolean, values: {year: number, entries: {profileId: string, id: string, wert: number, grund?: string}[]}},
 *   accept: () => {year: number, entries: {profileId: string, id: string, wert: number, grund?: string}[]}}}
 */
export function createAnnualPropertyEditor({ doc, targetYear, people, listen, storage = persistenceStorage, onState = () => {} }) {
    const rows = readAnnualProperties({ storage, people, targetYear });
    const node = (tag, text = '', className = '') => { const el = doc.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
    const root = node('section', '', 'annual-property-editor'); root.dataset.annualPropertyEditor = '';
    let rate = /** @type {number|null} */ (null), confirmed = false, valid = true;
    /** @type {Map<string, {value?: number, grund: string}>} Eigene Eingaben je Immobilie. */
    const own = new Map();
    const key = row => `${row.profileId}:${row.id}`;
    const proposal = row => annualPropertyProposal(row.base, rate);
    const current = row => own.get(key(row))?.value ?? proposal(row);
    const dirty = () => [...own.values()].some(entry => entry.value !== undefined || entry.grund);
    const hint = node('p', '', 'annual-property-hint'); hint.dataset.annualPropertyHint = '';
    const view = node('div', '', 'annual-property-columns'), list = node('div', '', 'annual-property-list'), side = node('aside', '', 'annual-property-side');
    // Knöpfe unter den Immobilien (linke Spalte), damit sie im Prüffall ohne Scrollen sichtbar sind (Gutachten IM-1, P3).
    const main = node('div', '', 'annual-property-main');
    view.append(main, side);
    const head = row => {
        const header = node('div', '', 'annual-property-head');
        const meta = row.nutzung === 'vermietet' ? `vermietet${row.mieteNetto > 0 ? `, ${money(row.mieteNetto)}/Monat netto` : ''}` : 'selbst bewohnt';
        header.append(node('h4', `${row.bezeichnung} · ${row.name}`), node('small', `${meta} · Stand bisher ${monthText(row.stand)}`));
        return header;
    };
    const cell = (label, value, className = '') => { const box = node('div', '', className); box.append(node('small', label), node('strong', value)); return box; };
    const views = rows.map(row => {
        const section = node('section', '', 'annual-property-home'); section.dataset.annualPropertyHome = row.id;
        const values = node('div', '', 'annual-property-values');
        const inflation = cell(`Inflation ${targetYear}`, '—'), next = cell(`Wert zum 31.12.${targetYear}`, '', 'annual-property-new');
        const delta = node('span', '', 'annual-property-delta'); next.append(delta);
        values.append(cell('Wert bisher', money(row.base)), inflation, next);
        section.append(head(row));
        if (row.later) section.append(node('small', `Wert am ${dayText(row.later.datum)} geändert; der aktuelle Wert bleibt.`, 'annual-property-later'));
        section.append(values); list.append(section);
        return { row, inflation: inflation.querySelector('strong'), value: next.querySelector('strong'), delta };
    });
    side.append(node('h4', 'So erscheint es im Vermögensverlauf'));
    const chart = node('div', '', 'annual-property-chart'); chart.dataset.annualPropertyChart = ''; side.append(chart);
    const facts = node('ul', '', 'annual-property-facts');
    for (const text of [`Der neue Wert gilt zum 31.12.${targetYear}. Davor bleibt der alte Wert stehen; vor dem ersten Eintrag gilt der erste bekannte Wert.`,
        'Die Kurve zeigt dann echtes Gesamtvermögen. Die Hilfslinie „mit heutigem Immobilienwert“ entfällt.',
        'Erbschaftsteuer-Vorschau und Gesamtvermögen auf der Übersicht rechnen mit dem neuen Wert.']) facts.append(node('li', text));
    side.append(facts);
    const button = (text, primary) => { const el = node('button', text, `ds-button ${primary ? 'ds-button-primary' : 'ds-button-secondary'}`); el.type = 'button'; return el; };
    const actions = node('div', '', 'annual-property-actions');
    const confirmButton = button('Unverändert bestätigen', true), edit = button('Werte ändern …', false);
    confirmButton.dataset.annualPropertyConfirm = ''; confirmButton.textContent = 'Unverändert bestätigen';
    edit.dataset.annualPropertyEdit = ''; edit.textContent = 'Werte ändern …';
    edit.setAttribute('aria-expanded', 'false');
    // JV-1: Ohne Inflation des Jahres gäbe es nichts fortzuschreiben; erst mit ihr lässt sich unverändert bestätigen.
    const wait = node('p', `Bestätigen geht, sobald die Inflation ${targetYear} vorliegt (Schritt Marktdaten).`, 'ds-help');
    wait.dataset.annualPropertyWait = ''; wait.id = 'annualPropertyWait';
    actions.append(confirmButton, edit, wait);
    // Variante „Werte ändern …“: Vorschläge als Startwert, je Immobilie Wert und freiwilliger Grund.
    const panel = node('div', '', 'annual-property-fields'); panel.hidden = true; panel.dataset.annualPropertyFields = '';
    const fields = rows.map((row, index) => {
        const section = node('section', '', 'annual-property-home'), header = head(row), meta = header.querySelector('small');
        meta.dataset.annualPropertyMeta = row.id;
        const grid = node('div', '', 'annual-property-edit');
        const valueField = node('div', '', 'ds-field'), reasonField = node('div', '', 'ds-field');
        const input = node('input', '', 'ds-input'), reason = node('input', '', 'ds-input'), error = node('small', '', 'household-plan-error');
        input.type = reason.type = 'text'; input.id = `annualProperty_${index}`; reason.id = `annualPropertyReason_${index}`;
        input.dataset.annualPropertyValue = row.id; reason.dataset.annualPropertyReason = row.id;
        input.setAttribute('inputmode', 'decimal'); reason.value = ''; reason.maxLength = 120; reason.placeholder = 'z. B. Gutachten';
        error.id = `${input.id}_error`; error.hidden = true; input.setAttribute('aria-describedby', error.id);
        const valueLabel = node('label', `Wert zum 31.12.${targetYear}`), reasonLabel = node('label', 'Grund (freiwillig)');
        valueLabel.setAttribute('for', input.id); reasonLabel.setAttribute('for', reason.id);
        // Eurofeld im Einheitenrahmen wie die übrigen Betragsfelder (DS-1).
        const frame = node('span', '', 'ds-unit-frame'); frame.append(input, node('span', '€'));
        valueField.append(valueLabel, frame, error); reasonField.append(reasonLabel, reason);
        grid.append(cell('Wert bisher', money(row.base)), valueField, reasonField);
        section.append(header, grid); panel.append(section);
        return { row, input, reason, error, meta };
    });
    const editActions = node('div', '', 'annual-property-actions');
    const acceptButton = button('Werte übernehmen', true), reset = button('Vorschläge wiederherstellen', false);
    acceptButton.dataset.annualPropertyAccept = ''; reset.dataset.annualPropertyReset = '';
    editActions.append(acceptButton, reset); panel.append(editActions);
    main.append(list, actions);
    root.append(hint, view, panel);

    const svgNode = (tag, attributes, text) => {
        const el = doc.createElementNS(SVG, tag);
        for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
        if (text !== undefined) el.textContent = text;
        return el;
    };
    const renderChart = () => {
        const before = rows.reduce((sum, row) => sum + row.base, 0), after = rows.reduce((sum, row) => sum + current(row), 0);
        const low = Math.min(before, after), high = Math.max(before, after);
        let step = niceStep(Math.max((high - low) / 2, 1)), bottom = Math.floor(low / step) * step;
        while (bottom + 2 * step < high) { step = niceStep(step * 1.01); bottom = Math.floor(low / step) * step; }
        const y = value => 95 - (value - bottom) / (2 * step) * 80;
        const svg = svgNode('svg', { viewBox: '0 0 360 120', role: 'img', 'aria-label': `Immobilien im Verlauf: ${money(before)} bis 30.12.${targetYear}, ab 31.12.${targetYear} ${money(after)}` });
        [0, 1, 2].forEach(index => {
            const value = bottom + (2 - index) * step, yy = 15 + index * 40;
            svg.append(svgNode('line', { x1: 40, y1: yy, x2: 350, y2: yy, class: index === 2 ? 'annual-property-axis' : 'annual-property-grid' }),
                svgNode('text', { x: 34, y: yy + 4, 'text-anchor': 'end' }, thousands(value)));
        });
        svg.append(svgNode('polyline', { points: `40,${y(before)} 290,${y(before)}`, class: 'annual-property-old' }),
            svgNode('polyline', { points: `290,${y(before)} 290,${y(after)} 350,${y(after)}`, class: 'annual-property-step' }),
            svgNode('circle', { cx: 290, cy: y(after), r: 4, class: 'annual-property-point' }),
            svgNode('text', { x: 44, y: 113 }, `Jan ${targetYear}`), svgNode('text', { x: 290, y: 113, 'text-anchor': 'middle' }, `31.12.${targetYear}`),
            svgNode('text', { x: 296, y: Math.max(12, y(after) - 8), class: 'annual-property-step-label' }, money(after)));
        const legend = node('div', '', 'annual-property-legend');
        legend.append(node('span', `bisheriger Wert ${money(before)}`, 'annual-property-legend-old'), node('span', `neuer Wert ab 31.12.${targetYear}`, 'annual-property-legend-step'));
        chart.replaceChildren(svg, legend);
    };
    const render = () => {
        hint.textContent = `${rate === null ? `Sobald die Inflation ${targetYear} vorliegt, wird der bisherige Wert zum 31.12.${targetYear} damit fortgeschrieben`
            : `Fortgeschrieben zum 31.12.${targetYear}: bisheriger Wert plus Inflation ${percent(rate)}`}, auf ganze Euro gerundet. Hast du einen eigenen Wert, etwa aus einem Gutachten, trag ihn über „Werte ändern …“ ein. Verkaufte Immobilien erscheinen hier nicht.`;
        for (const item of views) {
            const value = current(item.row);
            item.inflation.textContent = rate === null ? '—' : percent(rate);
            item.value.textContent = money(value); item.delta.textContent = signed(value - item.row.base);
        }
        for (const field of fields) {
            const entry = own.get(key(field.row));
            field.meta.textContent = `Vorschlag ${money(proposal(field.row))} · ${entry?.value !== undefined ? 'eigener Wert' : 'Vorschlag übernommen'}`;
        }
        renderChart();
        const waiting = rate === null && !dirty();
        confirmButton.disabled = !valid || waiting;
        wait.hidden = !waiting;
        if (waiting) confirmButton.setAttribute('aria-describedby', wait.id); else confirmButton.removeAttribute('aria-describedby');
        confirmButton.textContent = confirmed ? 'Bestätigt' : dirty() ? 'Werte bestätigen' : 'Unverändert bestätigen';
    };
    /** Felder lesen; ein unveränderter Vorschlag zählt nicht als eigener Wert. */
    const collect = () => {
        valid = true;
        for (const field of fields) {
            const amount = parseHouseholdPlanNumber(field.input.value, 'floorBedarf');
            const error = Number.isFinite(amount) && amount >= 0 ? '' : 'Bitte einen Betrag ab 0 eingeben.';
            field.error.textContent = error; field.error.hidden = !error; field.input.setAttribute('aria-invalid', String(Boolean(error)));
            valid &&= !error;
            const grund = String(field.reason.value ?? '').trim();
            const value = !error && Math.abs(amount - proposal(field.row)) >= 0.005 ? amount : undefined;
            if (value === undefined && !grund) own.delete(key(field.row)); else own.set(key(field.row), { value, grund });
        }
    };
    const fillProposals = () => { for (const field of fields) field.input.value = amountText(own.get(key(field.row))?.value ?? proposal(field.row)); };
    const changed = () => { confirmed = false; collect(); render(); onState(); };
    for (const field of fields) {
        listen(field.input, 'input', changed); listen(field.reason, 'input', changed);
        listen(field.input, 'focus', () => field.input.select?.());
        listen(field.input, 'blur', () => { const amount = parseHouseholdPlanNumber(field.input.value, 'floorBedarf'); if (Number.isFinite(amount) && amount >= 0) field.input.value = amountText(amount); });
        listen(field.input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); field.input.blur?.(); } });
    }
    const showPanel = open => { panel.hidden = !open; view.hidden = actions.hidden = open; edit.setAttribute('aria-expanded', String(open)); };
    listen(edit, 'click', () => showPanel(true));
    listen(confirmButton, 'click', () => { if (!valid || (rate === null && !dirty())) return; confirmed = true; render(); onState(); });
    listen(acceptButton, 'click', () => { collect(); if (!valid) { render(); return; } confirmed = true; showPanel(false); render(); onState(); });
    listen(reset, 'click', () => {
        const had = dirty(); own.clear(); for (const field of fields) field.reason.value = '';
        fillProposals(); collect(); if (had) confirmed = false; render(); onState();
    });
    fillProposals(); render();
    const values = () => ({ year: targetYear, entries: rows.map(row => {
        const grund = own.get(key(row))?.grund;
        return { profileId: row.profileId, id: row.id, wert: current(row), ...(grund ? { grund } : {}) };
    }) });
    return { present: rows.length > 0, root,
        /** Abschlussinflation setzen; nur eine Änderung rechnet die Vorschläge neu und hebt die Bestätigung auf. */
        setInflation(next) {
            const value = Number.isFinite(next) ? Number(next) : null;
            if (value === rate) return false;
            rate = value; confirmed = false;
            for (const field of fields) if (own.get(key(field.row))?.value === undefined) field.input.value = amountText(proposal(field.row));
            collect(); render();
            return true;
        },
        read: () => ({ present: rows.length > 0, confirmed: confirmed && valid, dirty: dirty(), values: values() }),
        accept() { if (!confirmed || !valid) throw new Error('Bitte die Immobilienwerte bestätigen.'); return values(); } };
}
