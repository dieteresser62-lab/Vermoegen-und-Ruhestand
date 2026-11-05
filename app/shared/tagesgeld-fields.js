import { createInfoPopover } from './designsystem-info-popover.js';
import { parseCashInput } from '../profile/profile-cash-update.js';
import { displayDecimalInput } from '../tranches/tranchen-manager-decimal-input.js';

/**
 * @param date Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function cashDateDisplay(date) { return date ? date.split('-').reverse().join('.') : ''; }

/** Abschlussdialoge akzeptieren deutsche Tausendergruppen. Der Fachparser bleibt unverändert.
 *
 * @param raw Rohwert vor der bestehenden Prüfung.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
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
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (fraction === undefined ? '' : ',' + fraction.padEnd(2, '0'));
}

/** Gemeinsam verwendete, schreibfreie und text-sichere Personenfelder.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createTagesgeldFields({ doc = document, people, title = 'Tagesgeld-Stand jetzt',
    explanation = 'Nach der Überweisung des Monatsbetrags. Fließt in den Vermögensverlauf ein.', prefix = 'tagesgeld', monthly = false, closePresentation = false, requireConfirmation = false, asOfLabel = '', proposals = {} }) {
    const monthlyClose = monthly && closePresentation;
    if (monthlyClose) return createCloseCashFields({ doc, people, title, explanation, prefix, asOfLabel, proposals });
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
        input.value = person.value === null ? '' : monthlyDisplay(person.value);
        label.setAttribute('for', input.id); label.textContent = closePresentation ? `Tagesgeld ${person.name}` : `${person.name} · Tagesgeld (€)`;
        if (asOfLabel) {
            const date = doc.createElement('small'); date.textContent = asOfLabel; date.dataset.tagesgeldDate = ''; label.append(date);
        }
        const last = doc.createElement('small'); last.id = `${input.id}-hint`;
        const lastDate = [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
        last.textContent = person.error ? person.error : lastDate
            ? monthly ? `zuletzt bestätigt am ${cashDateDisplay(lastDate)}: ${monthlyDisplay(person.value)} €`
                : `zuletzt am ${cashDateDisplay(lastDate).slice(0, 6)} · ${monthlyDisplay(person.value)} €`
            : 'Noch kein datierter Tagesgeld-Stand';
        const error = doc.createElement('small'); error.id = `${input.id}-error`; error.setAttribute('role', 'alert');
        error.className = 'tagesgeld-error';
        input.setAttribute('aria-describedby', `${last.id} ${error.id}`);
        row.append(label, input, last, error);
        let source;
        if (requireConfirmation) {
            source = doc.createElement('small'); source.dataset.tagesgeldStatus = '';
            source.textContent = lastDate ? `Vorbelegt aus dem Stand vom ${cashDateDisplay(lastDate)} · bitte bestätigen.` : 'Vorbelegter Stand · bitte bestätigen.';
            row.append(source);
        }
        if (monthly) { const unit = doc.createElement('span'); unit.className = 'tagesgeld-unit'; unit.textContent = '€'; row.append(unit); }
        root.append(row);
        return { person, input, error, source };
    });
    if (closePresentation) root.append(hint);
    const confirmed = new Set();
    const parse = field => {
        if (field.person.error) throw new Error(field.person.error);
        return parseMonthlyCashInput(field.input.value);
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
                values[person.id] = parseMonthlyCashInput(input.value);
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

/** Direkt überschreibbarer Abschlussentwurf; allein der Abschlussbesitzer speichert. */
function createCloseCashFields({ doc, people, title, explanation, prefix, asOfLabel, proposals }) {
    const node = (tag, text, className = '') => {
        const element = doc.createElement(tag); element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const root = node('section', undefined, 'tagesgeld-fields tagesgeld-close-fields');
    if (title) root.append(node('h3', title));
    const provenance = node('p', `${asOfLabel || 'Kontostand heute'} · gespeichert mit dem Abschluss `, 'tagesgeld-provenance');
    provenance.dataset.tagesgeldDate = '';
    provenance.append(createInfoPopover(doc, 'Herkunft und Speicherung des Tagesgelds', explanation)); root.append(provenance);
    const available = proposal => Boolean(proposal && !proposal.error && Number.isFinite(proposal.value) && proposal.value >= 0);
    const fields = people.map((person, index) => {
        const row = node('div', undefined, 'tagesgeld-person');
        const name = node('div', undefined, 'tagesgeld-person-name');
        const label = node('label', `Tagesgeld ${person.name}`), input = node('input', undefined, 'ds-input');
        input.id = `${prefix}-${index + 1}`; label.setAttribute('for', input.id);
        const proposal = proposals[person.id];
        input.type = 'text'; input.value = available(proposal) ? monthlyDisplay(proposal.value) : person.value === null ? '' : monthlyDisplay(person.value);
        input.required = true; input.dataset.tagesgeldPerson = person.id;
        input.setAttribute('inputmode', 'decimal'); input.setAttribute('lang', 'de'); input.setAttribute('autocomplete', 'off');
        const status = node('small'); status.id = `${input.id}-hint`; status.dataset.tagesgeldStatus = '';
        const error = node('small', '', 'tagesgeld-error'); error.id = `${input.id}-error`; error.setAttribute('role', 'alert');
        const proposalHint = node('small'); proposalHint.id = `${input.id}-proposal`; proposalHint.dataset.tagesgeldProposal = person.id;
        input.setAttribute('aria-describedby', `${status.id} ${proposalHint.id} ${error.id}`);
        name.append(label, status, proposalHint);
        const amount = node('div', undefined, 'tagesgeld-person-amount');
        amount.append(input, node('span', '€', 'tagesgeld-unit'));
        row.append(name, amount, error); root.append(row);
        return { person, row, input, status, error, proposalHint, proposal, overridden: false };
    });
    const parse = field => {
        if (field.person.error) throw new Error(field.person.error);
        return parseMonthlyCashInput(field.input.value);
    };
    const valid = field => { try { parse(field); return true; } catch { return false; } };
    const isPlayValue = field => !field.overridden && available(field.proposal) && valid(field) && parse(field) === field.proposal.value;
    const sync = field => {
        const date = [field.person.lastDate, field.person.confirmedDate].filter(Boolean).sort().at(-1);
        const changed = valid(field) && parse(field) !== field.person.value && !isPlayValue(field);
        field.status.textContent = changed ? `geändert · vorher ${field.person.value === null ? '—' : monthlyDisplay(field.person.value) + '\u00a0€'}`
            : date ? `Stand vom ${cashDateDisplay(date)}` : 'noch kein datierter Stand';
        field.row.dataset.state = valid(field) ? 'done' : 'open';
        Array.from(field.proposalHint.children || []).forEach(child => child.remove());
        field.proposalHint.hidden = !field.proposal || field.overridden && available(field.proposal);
        field.proposalHint.textContent = !field.proposal ? '' : available(field.proposal)
            ? 'Spielwert · Vorschlag ' : `Spielwert nicht verfügbar: ${field.proposal.error || 'Kein gültiger Vorschlag.'}`;
        if (field.proposal?.explanation) field.proposalHint.append(createInfoPopover(doc, `Herleitung des Tagesgeld-Vorschlags für ${field.person.name}`,
            field.proposal.explanation + (field.proposal.error ? ' ' + field.proposal.error : '')));
    };
    const validate = field => {
        try { parse(field); field.error.textContent = ''; field.input.setAttribute('aria-invalid', 'false'); return true; }
        catch (failure) { field.error.textContent = failure.message; field.input.setAttribute('aria-invalid', 'true'); return false; }
    };
    const api = { root, inputs: fields.map(field => field.input),
        updateProposals(next) {
            let changed = false;
            for (const field of fields) {
                if (JSON.stringify(field.proposal) === JSON.stringify(next[field.person.id])) continue;
                field.proposal = next[field.person.id];
                if (!field.overridden) {
                    const value = available(field.proposal) ? field.proposal.value : field.person.value;
                    const text = value === null ? '' : monthlyDisplay(value);
                    changed ||= field.input.value !== text;
                    field.input.value = text;
                    validate(field);
                }
                sync(field);
            }
            return changed;
        },
        get openPeople() { return fields.filter(field => !valid(field)).map(field => field.person.name); },
        get ready() { return fields.length > 0 && fields.every(valid); },
        bind(listen, onChange = () => {}) {
            for (const field of fields) {
                listen(field.input, 'input', () => {
                    if (!isPlayValue(field)) field.overridden = true;
                    validate(field); sync(field); onChange();
                });
                listen(field.input, 'change', () => {
                    if (validate(field)) field.input.value = monthlyDisplay(parse(field));
                    sync(field); onChange();
                });
                listen(field.input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); } });
            }
        },
        focusInvalid() {
            const invalid = fields.filter(field => !validate(field));
            invalid[0]?.input.focus(); return invalid.length === 0;
        },
        read() {
            if (!api.focusInvalid()) throw new Error('Bitte die markierten Tagesgeldfelder prüfen.');
            const values = Object.fromEntries(fields.map(field => [field.person.id, parse(field)]));
            const playValues = Object.fromEntries(fields.filter(isPlayValue).map(field => [field.person.id, structuredClone(field.proposal)]));
            return { people: structuredClone(people), values, ...(Object.keys(playValues).length ? { playValues } : {}) };
        }
    };
    fields.forEach(sync); return api;
}
