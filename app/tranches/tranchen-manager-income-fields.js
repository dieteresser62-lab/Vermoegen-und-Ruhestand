// Gemeinsame DOM-Hilfen für die beiden Planeditoren; Fachparser bleiben unverändert.
import { incomeMonthInput, incomeMonthDisplay } from '../profile/profile-income.js';
import { canonicalDecimalInput, displayDecimalInput } from './tranchen-manager-decimal-input.js';

/** @param {unknown} raw
 * @returns Normalisierter Monat oder ungültiger Entwurf. */
export function editorMonth(raw) {
    return incomeMonthInput(String(raw || '').trim().replace(/^(\d)[./]/, '0$1.'));
}

/** @param field Eingabefeld des Editors.
 * @param {{amount?: boolean; month?: boolean; openMonth?: boolean; fresh?: boolean; commit?: ()=>void}} [options]
 * @returns {void} */
export function bindEditorCommit(field, { amount = false, month = false, openMonth = false, fresh = false, commit = () => {} } = {}) {
    if (openMonth) {
        field.placeholder = fresh ? 'MM.JJJJ' : '—';
        field.addEventListener('focus', () => { field.placeholder = 'MM.JJJJ'; });
    }
    field.addEventListener('blur', () => {
        if (amount) {
            const value = canonicalDecimalInput(field.value, field);
            if (value !== '' && value !== 'NaN') field.value = displayDecimalInput(value, field);
        }
        if (month) {
            const value = editorMonth(field.value);
            if (/^\d{4}-\d{2}$/.test(value || '')) field.value = incomeMonthDisplay(value);
        }
        if (openMonth) field.placeholder = '—';
        commit();
    });
    field.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); field.blur(); }
    });
}

/** @param {Document} doc
 * @param {Node} field
 * @returns {HTMLDivElement} */
export function editorCell(doc, field) {
    const cell = doc.createElement('div'); cell.className = 'pv-editor-cell';
    cell.appendChild(field); return cell;
}

const errorNotes = new WeakMap();
/** @param doc Dokument des Editors.
 * @param host Optionaler Editorhost.
 * @param {{field: string; message: string}[]} errors
 * @returns {void} */
export function showEditorErrors(doc, host, errors) {
    const owner = host || doc;
    for (const el of errorNotes.get(owner) || []) {
        const field = doc.getElementById(el.id.replace(/-error$/, ''));
        if (field) {
            field.setAttribute('aria-describedby', (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id !== el.id).join(' '));
            field.removeAttribute('aria-invalid');
        }
        el.remove();
    }
    const notes = []; errorNotes.set(owner, notes);
    for (const el of host?.querySelectorAll?.('[aria-invalid]') || []) el.removeAttribute('aria-invalid');
    for (const error of errors) {
        const field = doc.getElementById(error.field);
        if (!field) continue;
        field.setAttribute('aria-invalid', 'true');
        const note = doc.createElement('small'); note.className = 'pv-field-error'; note.id = `${field.id}-error`;
        note.textContent = error.message.replace(/^(?:Einkünfte|Geplante Ausgaben) \d+: /, '');
        const described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== note.id);
        field.setAttribute('aria-describedby', [...described, note.id].join(' '));
        (field.closest?.('.pv-editor-cell') || field.parentElement).appendChild(note);
        notes.push(note);
    }
}

/** @param doc Dokument des Editors.
 * @param {string} id
 * @param {boolean} empty
 * @param {string} headingId
 * @returns {void} */
export function editorEmpty(doc, id, empty, headingId) {
    const note = doc.getElementById(id); if (note) note.hidden = !empty;
    const heading = doc.getElementById(headingId); if (heading) heading.hidden = empty;
}
