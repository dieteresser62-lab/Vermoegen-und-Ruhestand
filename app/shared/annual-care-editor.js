import { createCareValuesDraft, readCareValues } from './household-care-values.js';
import { persistenceStorage } from './persistence-facade.js';
import { parseHouseholdPlanNumber } from './household-plan-fields.js';

const month = value => value.split('-').reverse().join('.');
const money = value => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Entwurf bleibt bis zum Jahresbatch ausschließlich im Dialog.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createAnnualCareEditor({ doc, targetYear, listen, storage = persistenceStorage, onState = () => {} }) {
    const draft = createCareValuesDraft(readCareValues(storage), targetYear + 1);
    const original = draft.read().values;
    const node = (tag, text = '', className = '') => { const el = doc.createElement(tag); el.textContent = text; el.className = className; return el; };
    const root = node('section', '', 'annual-care-editor'); root.dataset.annualCareEditor = '';
    root.append(node('p', 'Diese Werte rechnet der Simulator für Pflegejahre. Gesetzlich geändert werden sie selten, zuletzt 01.2025; nächste Anpassung voraussichtlich 01.2028.', 'annual-care-explanation'));
    const columns = node('div', '', 'close-dialog-columns'); root.append(columns);
    const headings = new Map();
    const heading = (key, title, part, label) => {
        const head = node('div', '', 'annual-care-heading'), meta = node('small', `Stand ${month(part.asOf)} · ${part.origin} · `);
        const link = node('a', label, 'ds-text-link'); link.href = part.source; link.target = '_blank'; link.rel = 'noopener noreferrer';
        meta.append(link); head.append(node('h4', title), meta);
        const group = node('section'); columns.append(group); group.append(head);
        headings.set(key, next => { meta.textContent = `Stand ${month(next.asOf)} · ${next.origin} · `; meta.append(link); });
        return group;
    };
    const allowance = heading('allowance', 'Pflegegeld je Grad', original.allowance, 'Bundesgesundheitsministerium');
    const tiles = node('div', '', 'annual-care-grades'), displays = new Map();
    for (const grade of [1, 2, 3, 4, 5]) {
        const tile = node('div'), value = node('strong', grade === 1 ? '—' : money(original.allowance.values[grade]) + ' €');
        tile.append(node('small', `Grad ${grade}`), value); tiles.append(tile); displays.set(String(grade), value);
    }
    allowance.append(node('small', '€/Monat'), tiles);
    const residential = heading('residential', 'Heim-Eigenanteil im ersten Jahr', original.residential, 'vdek');
    const home = node('div', '', 'annual-care-home'), homeValue = node('strong', `${money(original.residential.monthly)} €/Monat`);
    home.append(node('span', 'nur für die Staffel „Amtlicher Durchschnitt“'), homeValue); residential.append(home);
    const actions = node('div', '', 'annual-care-actions');
    const confirmButton = doc.createElement('button'); confirmButton.textContent = 'Unverändert bestätigen'; confirmButton.className = 'ds-button ds-button-primary';
    const edit = doc.createElement('button'); edit.textContent = 'Werte ändern …'; edit.className = 'ds-button ds-button-secondary';
    confirmButton.type = edit.type = 'button'; confirmButton.dataset.annualCareConfirm = '';
    edit.dataset.annualCareEdit = ''; actions.append(confirmButton, edit); root.append(actions);
    const panel = node('div', '', 'annual-care-fields'); panel.hidden = true; panel.dataset.annualCareFields = '';
    const inputs = new Map(), errors = new Map();
    for (const [key, label, value] of [...[2, 3, 4, 5].map(grade => [String(grade), `Grad ${grade}`, original.allowance.values[grade]]), ['home', 'Heim-Eigenanteil', original.residential.monthly], ['from', 'gültig ab', `01.${targetYear + 1}`]]) {
        const row = node('div', '', 'ds-field'), input = node('input'), title = node('label', label), error = node('small', '', 'household-plan-error');
        input.type = 'text'; input.id = `annualCare_${key}`; input.dataset.annualCareField = key; input.className = 'ds-input'; input.value = key === 'from' ? value : money(value) + ' €';
        input.setAttribute('inputmode', key === 'from' ? 'numeric' : 'decimal'); title.setAttribute('for', input.id);
        error.id = `${input.id}_error`; error.hidden = true; input.setAttribute('aria-describedby', error.id);
        if (key === 'from') input.placeholder = 'MM.JJJJ';
        row.append(title, input, error); panel.append(row); inputs.set(key, input); errors.set(key, error);
        if (key !== 'from') {
            listen(input, 'focus', () => { input.select?.(); });
            listen(input, 'blur', () => { const amount = parseHouseholdPlanNumber(input.value, 'floorBedarf'); if (Number.isFinite(amount) && amount >= 0) input.value = money(amount) + ' €'; });
        }
        listen(input, 'input', () => { update(); onState(); });
        listen(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur?.(); } });
    }
    panel.append(node('small', 'Geänderte Werte erhalten die Herkunft „von Hand“. Gespeichert wird erst mit dem Jahresabschluss.'));
    root.append(panel);
    let valid = true;
    function update() {
        const next = structuredClone(original); valid = true;
        for (const [key, input] of inputs) {
            let error = '';
            if (key === 'from') { if (!/^(0?[1-9]|1[0-2])[./]\d{4}$/.test(input.value.trim())) error = 'Bitte MM.JJJJ eingeben.'; }
            else {
                const amount = parseHouseholdPlanNumber(input.value, 'floorBedarf');
                if (!Number.isFinite(amount) || amount < 0) error = 'Bitte einen Betrag ab 0 eingeben.';
                else if (key === 'home') next.residential.monthly = amount;
                else next.allowance.values[key] = amount;
            }
            input.setAttribute('aria-invalid', String(Boolean(error))); errors.get(key).textContent = error; errors.get(key).hidden = !error; valid &&= !error;
        }
        confirmButton.disabled = !valid;
        if (valid) {
            const [m, y] = inputs.get('from').value.trim().split(/[./]/), validFrom = `${y}-${m.padStart(2, '0')}`;
            for (const [part, changed] of /** @type {['allowance'|'residential', boolean][]} */ ([['allowance', [2, 3, 4, 5].some(grade => next.allowance.values[grade] !== original.allowance.values[grade])], ['residential', next.residential.monthly !== original.residential.monthly]])) {
                if (changed) Object.assign(next[part], { origin: 'von Hand', validFrom, asOf: validFrom });
            }
            draft.change(next);
            for (const [key, updateHeading] of headings) updateHeading(next[key]);
            for (const grade of [2, 3, 4, 5]) displays.get(String(grade)).textContent = money(next.allowance.values[grade]) + ' €';
            homeValue.textContent = money(next.residential.monthly) + ' €/Monat';
        } else draft.change(draft.read().values);
        confirmButton.textContent = 'Werte bestätigen';
    }
    listen(edit, 'click', () => { panel.hidden = !panel.hidden; edit.setAttribute('aria-expanded', String(!panel.hidden)); });
    listen(confirmButton, 'click', () => { if (!valid) return; draft.confirmValues(); confirmButton.textContent = 'Bestätigt'; onState(); });
    return { root, read: () => ({ ...draft.read(), confirmed: valid && draft.read().confirmed }), accept: draft.accept };
}
