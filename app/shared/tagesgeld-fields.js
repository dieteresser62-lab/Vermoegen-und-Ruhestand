import { parseCashInput } from '../profile/profile-cash-update.js';
import { displayDecimalInput } from '../tranches/tranchen-manager-decimal-input.js';

export function cashDateDisplay(date) { return date ? date.split('-').reverse().join('.') : ''; }

/** Nur der Monatsdialog akzeptiert deutsche Tausendergruppen. Der Fachparser bleibt unverändert. */
export function parseMonthlyCashInput(raw) {
    const text = String(raw).trim();
    if (text.includes('.') && (text.includes(',') || /^\d{1,3}(?:\.\d{3})+$/.test(text))) {
        if (!/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) throw new Error('Bitte eine gültige deutsche Zahl eingeben.');
        return parseCashInput(text.replaceAll('.', ''));
    }
    if ((text.match(/\./g) || []).length > 1) throw new Error('Bitte eine gültige deutsche Zahl eingeben.');
    return parseCashInput(text);
}

function monthlyDisplay(value) {
    const text = displayDecimalInput(value);
    const [integer, fraction] = text.split(',');
    if (!/^\d+$/.test(integer)) return text;
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction === undefined ? '' : ',' + fraction);
}

/** Gemeinsam verwendete, schreibfreie und text-sichere Personenfelder. */
export function createTagesgeldFields({ doc = document, people, title = 'Tagesgeld-Stand jetzt',
    explanation = 'Nach der Überweisung des Monatsbetrags. Fließt in den Vermögensverlauf ein.', prefix = 'tagesgeld', monthly = false, closePresentation = false, requireConfirmation = false }) {
    const root = doc.createElement('section'); root.className = 'tagesgeld-fields' + (closePresentation ? ' tagesgeld-close-fields' : '');
    const heading = doc.createElement('h3'); heading.textContent = title;
    const hint = doc.createElement('p'); hint.textContent = explanation;
    if (title) root.append(heading);
    if (!closePresentation) root.append(hint);
    const fields = people.map((person, index) => {
        const row = doc.createElement('div'); row.className = 'tagesgeld-person';
        const label = doc.createElement('label'), input = doc.createElement('input');
        input.id = `${prefix}-${index + 1}`; input.type = 'text'; input.className = 'ds-input';
        input.setAttribute('inputmode', 'decimal'); input.setAttribute('lang', 'de'); input.required = true;
        input.dataset.tagesgeldPerson = person.id;
        input.value = person.value === null ? '' : monthly ? monthlyDisplay(person.value) : displayDecimalInput(person.value);
        label.setAttribute('for', input.id); label.textContent = closePresentation ? `Tagesgeld ${person.name}` : `${person.name} · Tagesgeld (€)`;
        const last = doc.createElement('small'); last.id = `${input.id}-hint`;
        last.textContent = person.error ? person.error : person.lastDate
            ? monthly ? `zuletzt bestätigt am ${cashDateDisplay(person.lastDate)}: ${monthlyDisplay(person.value)} €`
                : `zuletzt am ${cashDateDisplay(person.lastDate).slice(0, 6)} · ${displayDecimalInput(person.value)} €`
            : 'Noch kein datierter Tagesgeld-Stand';
        const error = doc.createElement('small'); error.id = `${input.id}-error`; error.setAttribute('role', 'alert');
        error.className = 'tagesgeld-error';
        input.setAttribute('aria-describedby', `${last.id} ${error.id}`);
        row.append(label, input, last, error);
        if (requireConfirmation) {
            const source = doc.createElement('small');
            source.textContent = person.lastDate ? `Vorbelegt aus dem Stand vom ${cashDateDisplay(person.lastDate)} · bitte bestätigen.` : 'Vorbelegter Stand · bitte bestätigen.';
            row.append(source);
        }
        if (monthly) { const unit = doc.createElement('span'); unit.className = 'tagesgeld-unit'; unit.textContent = '€'; row.append(unit); }
        root.append(row);
        return { person, input, error };
    });
    if (closePresentation) root.append(hint);
    const confirmed = new Set();
    const parse = field => {
        if (field.person.error) throw new Error(field.person.error);
        return monthly ? parseMonthlyCashInput(field.input.value) : parseCashInput(field.input.value);
    };
    const validateField = field => {
        try {
            parse(field); field.error.textContent = ''; field.input.setAttribute('aria-invalid', 'false'); return true;
        } catch (failure) {
            confirmed.delete(field.person.id);
            field.error.textContent = failure.message; field.input.setAttribute('aria-invalid', 'true'); return false;
        }
    };
    const confirmationButton = requireConfirmation ? doc.createElement('button') : null;
    if (confirmationButton) {
        confirmationButton.type = 'button'; confirmationButton.className = 'ds-button ds-button-secondary';
        confirmationButton.textContent = 'Stand stimmt'; confirmationButton.dataset.tagesgeldConfirm = '';
        root.append(confirmationButton);
    }
    const api = { root, confirmationButton, inputs: fields.map(field => field.input),
        get ready() { return fields.length > 0 && fields.every(field => {
            try { parse(field); return !requireConfirmation || confirmed.has(field.person.id); } catch { return false; }
        }); },
        bind(listen, onChange = () => {}) {
            if (!requireConfirmation) return;
            for (const field of fields) listen(field.input, 'input', () => {
                if (validateField(field)) confirmed.add(field.person.id);
                onChange();
            });
            listen(confirmationButton, 'click', () => {
                try { api.read(); fields.forEach(field => confirmed.add(field.person.id)); } catch { /* Feldfehler sind sichtbar. */ }
                onChange();
            });
        },
        focusConfirmation() {
            try { api.read(); } catch { return false; }
            if (!api.ready) { confirmationButton?.focus(); return false; }
            return true;
        },
        read() {
        const values = {}; let invalid = null;
        for (const { person, input, error } of fields) {
            try {
                if (person.error) throw new Error(person.error);
                values[person.id] = monthly ? parseMonthlyCashInput(input.value) : parseCashInput(input.value);
                error.textContent = ''; input.setAttribute('aria-invalid', 'false');
            } catch (failure) {
                confirmed.delete(person.id);
                error.textContent = failure.message; input.setAttribute('aria-invalid', 'true'); invalid ||= input;
            }
        }
        if (invalid) { invalid.focus(); throw new Error('Bitte die markierten Tagesgeldfelder prüfen.'); }
        return { people: structuredClone(people), values };
    } };
    return api;
}
