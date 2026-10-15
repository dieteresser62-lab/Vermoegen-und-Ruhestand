import { createInfoPopover } from './designsystem-info-popover.js';
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
    explanation = 'Nach der Überweisung des Monatsbetrags. Fließt in den Vermögensverlauf ein.', prefix = 'tagesgeld', monthly = false, closePresentation = false, requireConfirmation = false, asOfLabel = '', proposals = {} }) {
    const monthlyClose = monthly && closePresentation && requireConfirmation;
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
        input.value = person.value === null ? '' : monthly ? monthlyDisplay(person.value) : displayDecimalInput(person.value);
        label.setAttribute('for', input.id); label.textContent = closePresentation ? `Tagesgeld ${person.name}` : `${person.name} · Tagesgeld (€)`;
        if (asOfLabel) {
            const date = doc.createElement('small'); date.textContent = asOfLabel; date.dataset.tagesgeldDate = ''; label.append(date);
        }
        const last = doc.createElement('small'); last.id = `${input.id}-hint`;
        const lastDate = [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
        last.textContent = person.error ? person.error : lastDate
            ? monthly ? `zuletzt bestätigt am ${cashDateDisplay(lastDate)}: ${monthlyDisplay(person.value)} €`
                : `zuletzt am ${cashDateDisplay(lastDate).slice(0, 6)} · ${displayDecimalInput(person.value)} €`
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

/** Flüchtiger Entwurf: Personen einzeln prüfen; allein der Abschlussbesitzer speichert. */
function createCloseCashFields({ doc, people, title, explanation, prefix, asOfLabel, proposals }) {
    const node = (tag, text, className = '') => {
        const element = doc.createElement(tag); element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const button = (text, anchor, id) => {
        const element = node('button', text, 'ds-button ds-button-secondary'); element.type = 'button';
        element.dataset[anchor] = id; return element;
    };
    const root = node('section', undefined, 'tagesgeld-fields tagesgeld-close-fields');
    if (title) root.append(node('h3', title));
    const dates = [...new Set(people.map(person => [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1)).filter(Boolean))];
    const provenance = node('p', `${asOfLabel || 'Kontostand heute'} · ${dates.length === 1 && people.every(person => person.lastDate || person.confirmedDate)
        ? `vorbelegt mit dem Stand vom ${cashDateDisplay(dates[0])}` : dates.length ? 'vorbelegt mit den zuletzt erfassten Ständen' : 'noch kein datierter Tagesgeld-Stand'} · gespeichert mit dem Abschluss `, 'tagesgeld-provenance');
    provenance.dataset.tagesgeldDate = '';
    const sources = people.map(person => {
        const date = [person.lastDate, person.confirmedDate].filter(Boolean).sort().at(-1);
        return `${person.name}: ${person.error || (date ? 'Stand vom ' + cashDateDisplay(date) : 'Noch kein datierter Tagesgeld-Stand')}`;
    }).join('. ');
    provenance.append(createInfoPopover(doc, 'Herkunft und Speicherung des Tagesgelds', `${explanation} ${sources}.`)); root.append(provenance);
    const confirmed = new Set();
    const fields = people.map((person, index) => {
        const row = node('div', undefined, 'tagesgeld-person');
        const name = node('div', undefined, 'tagesgeld-person-name');
        const label = node('label', `Tagesgeld ${person.name}`), input = node('input', undefined, 'ds-input');
        input.id = `${prefix}-${index + 1}`; label.setAttribute('for', input.id);
        input.type = 'text'; input.value = person.value === null ? '' : monthlyDisplay(person.value);
        input.required = true; input.hidden = true; input.dataset.tagesgeldPerson = person.id;
        input.setAttribute('inputmode', 'decimal'); input.setAttribute('lang', 'de');
        const status = node('small'); status.id = `${input.id}-hint`; status.dataset.tagesgeldStatus = '';
        const error = node('small', '', 'tagesgeld-error'); error.id = `${input.id}-error`; error.setAttribute('role', 'alert');
        input.setAttribute('aria-describedby', `${status.id} ${error.id}`);
        name.append(label, status);
        const value = node('strong', person.value === null ? '—' : `${monthlyDisplay(person.value)} €`, 'ds-readonly-value');
        const unit = node('span', '€', 'tagesgeld-unit'); unit.hidden = true;
        const confirmButton = button('Stand stimmt', 'tagesgeldConfirm', person.id);
        const edit = button('Ändern', 'tagesgeldEdit', person.id); edit.className = 'ds-button ds-button-ghost';
        const apply = button('Übernehmen', 'tagesgeldApply', person.id); apply.hidden = true;
        const badge = node('span', '', 'ds-badge tagesgeld-person-badge'); badge.hidden = true;
        const proposalHint = node('small'); proposalHint.dataset.tagesgeldProposal = person.id;
        const useProposal = button('Vorschlag übernehmen', 'tagesgeldPropose', person.id);
        useProposal.dataset.tagesgeldPropose = person.id;
        useProposal.hidden = true; proposalHint.hidden = true;
        name.append(proposalHint);
        row.append(name, value, input, unit, confirmButton, badge, edit, apply, useProposal, error); root.append(row);
        return { person, row, input, status, error, value, unit, confirmButton, edit, apply, badge, proposalHint, useProposal, proposal: proposals[person.id], playValue: null, editing: false };
    });
    const parse = field => {
        if (field.person.error) throw new Error(field.person.error);
        return parseMonthlyCashInput(field.input.value);
    };
    const sync = field => {
        const done = confirmed.has(field.person.id), changed = done && (field.playValue || parse(field) !== field.person.value);
        const date = [field.person.lastDate, field.person.confirmedDate].filter(Boolean).sort().at(-1);
        field.status.textContent = field.editing ? 'neuen Kontostand eintragen' : changed ? `geändert · vorher ${field.person.value === null ? '—' : monthlyDisplay(field.person.value) + ' €'}`
            : done ? `bestätigt${date ? ' · Stand vom ' + cashDateDisplay(date) : ' · kein datierter Ausgangsstand'}` : 'noch nicht bestätigt';
        if (done && field.playValue) field.status.textContent += ' · Spielwert';
        field.input.hidden = !field.editing; field.unit.hidden = !field.editing; field.value.hidden = field.editing;
        field.confirmButton.hidden = field.editing || done; field.edit.hidden = field.editing; field.apply.hidden = !field.editing;
        field.badge.hidden = field.editing || !done; field.badge.textContent = changed ? 'geändert' : 'bestätigt';
        field.row.dataset.state = done ? 'done' : 'open';
        field.useProposal.hidden = !field.proposal || field.editing || Boolean(field.playValue);
        field.useProposal.disabled = Boolean(field.proposal?.error);
        if (done) field.value.textContent = `${monthlyDisplay(parse(field))} €`;
    };
    const showProposal = field => {
        Array.from(field.proposalHint.children || []).forEach(child => child.remove());
        field.proposalHint.hidden = !field.proposal;
        field.proposalHint.textContent = !field.proposal ? '' : Number.isFinite(field.proposal.value)
            ? `Vorschlag: ${monthlyDisplay(field.proposal.value)} € · Spielwert ` : `Spielwert nicht verfügbar: ${field.proposal.error}`;
        if (field.proposal?.explanation) field.proposalHint.append(createInfoPopover(doc, `Herleitung des Tagesgeld-Vorschlags für ${field.person.name}`,
            field.proposal.explanation + (field.proposal.error ? ' ' + field.proposal.error : '')));
    };
    const validate = field => {
        try { parse(field); field.error.textContent = ''; field.input.setAttribute('aria-invalid', 'false'); return true; }
        catch (failure) {
            confirmed.delete(field.person.id); field.editing = true; sync(field);
            field.error.textContent = failure.message; field.input.setAttribute('aria-invalid', 'true'); return false;
        }
    };
    const api = { root, inputs: fields.map(field => field.input), confirmationButtons: fields.map(field => field.confirmButton),
        get hasChanges() { return fields.some(field => Boolean(field.playValue)); },
        updateProposals(next) {
            for (const field of fields) {
                if (JSON.stringify(field.proposal) === JSON.stringify(next[field.person.id])) continue;
                if (field.playValue) {
                    confirmed.delete(field.person.id); field.playValue = null;
                    field.input.value = field.person.value === null ? '' : monthlyDisplay(field.person.value);
                    field.value.textContent = field.person.value === null ? '—' : `${monthlyDisplay(field.person.value)} €`;
                }
                field.proposal = next[field.person.id]; showProposal(field); sync(field);
            }
        },
        get openPeople() { return fields.filter(field => field.editing || !confirmed.has(field.person.id)).map(field => field.person.name); },
        get ready() { return fields.length > 0 && fields.every(field => {
            try { parse(field); return !field.editing && confirmed.has(field.person.id); } catch { return false; }
        }); },
        bind(listen, onChange = () => {}) {
            for (const field of fields) {
                listen(field.edit, 'click', () => {
                    if (field.proposal && !field.proposal.error && (field.playValue || field.input.value === monthlyDisplay(field.person.value))) field.input.value = monthlyDisplay(field.proposal.value);
                    confirmed.delete(field.person.id); field.playValue = null; field.editing = true; sync(field); onChange(); field.input.focus();
                });
                listen(field.input, 'input', () => { confirmed.delete(field.person.id); field.playValue = null; field.editing = true; validate(field); sync(field); onChange(); });
                const accept = () => {
                    if (validate(field)) {
                        if (field.editing && field.proposal && !field.proposal.error && parse(field) === field.proposal.value) field.playValue = structuredClone(field.proposal);
                        confirmed.add(field.person.id); field.editing = false;
                    }
                    sync(field); onChange();
                    if (field.editing) field.input.focus(); else field.edit.focus();
                };
                listen(field.confirmButton, 'click', accept); listen(field.apply, 'click', accept);
                listen(field.useProposal, 'click', () => {
                    if (!field.proposal || field.proposal.error) return;
                    field.input.value = monthlyDisplay(field.proposal.value); field.playValue = structuredClone(field.proposal); accept();
                });
                listen(field.input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); accept(); } });
            }
        },
        focusConfirmation() {
            const field = fields.find(field => field.editing || !confirmed.has(field.person.id));
            if (!field) return true;
            (field.editing ? field.input : field.confirmButton).focus(); return false;
        },
        read() {
            let invalid;
            const values = {};
            for (const field of fields) {
                if (validate(field)) values[field.person.id] = parse(field); else invalid ||= field.input;
            }
            if (invalid) { invalid.focus(); throw new Error('Bitte die markierten Tagesgeldfelder prüfen.'); }
            const playValues = Object.fromEntries(fields.filter(field => field.playValue).map(field => [field.person.id, structuredClone(field.playValue)]));
            return { people: structuredClone(people), values, ...(Object.keys(playValues).length ? { playValues } : {}) };
        }
    };
    fields.forEach(field => { showProposal(field); sync(field); }); return api;
}
