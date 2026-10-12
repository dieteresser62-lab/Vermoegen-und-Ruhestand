import { FIELD_STATES, setFieldState } from '../app/shared/field-state.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
const doc = createPresentationTestDocument();
const parent = doc.createElement('div'); doc.body.appendChild(parent);
const field = doc.createElement('input'); parent.appendChild(field);
field.value = '123.45'; field.disabled = true; field.readOnly = true;
for (const [name, value] of Object.entries({ type: 'number', min: '0', max: '999', step: '.01', readonly: '', disabled: '', required: '', 'aria-describedby': 'external-help external-error', 'data-existing': 'unverändert' })) field.setAttribute(name, value);
const baseline = JSON.stringify([...field.attributes].filter(([key]) => !['aria-describedby', 'data-field-state'].includes(key)));
let reasonId;
for (const state of FIELD_STATES) {
    const reason = setFieldState(field, state, `Bestehender Grund: ${state}`);
    reasonId ||= reason.id;
    assertEqual(reason.id, reasonId, `${state}: stabile Begründungs-ID bei Wechsel`);
    assertEqual(field.getAttribute('data-field-state'), state, `${state}: Zustandsdarstellung`);
    assertEqual(reason.textContent, `Bestehender Grund: ${state}`, `${state}: aktueller sichtbarer Grund`);
    assertEqual(field.getAttribute('aria-describedby'), `external-help external-error ${reasonId}`, `${state}: fremde Beschreibungen erhalten`);
    assertEqual(parent.children.length, 2, `${state}: genau ein Grund`);
    assertEqual(field.value, '123.45', `${state}: Wert bleibt identisch`);
    assert(field.disabled && field.readOnly, `${state}: Sperren bleiben identisch`);
    assertEqual(JSON.stringify([...field.attributes].filter(([key]) => !['aria-describedby', 'data-field-state'].includes(key))), baseline, `${state}: Inputattribute bleiben identisch`);
    const writes = field.writes + reason.writes + parent.writes;
    assert(setFieldState(field, state, `Bestehender Grund: ${state}`) === reason, `${state}: idempotenter Grundknoten`);
    assertEqual(field.writes + reason.writes + parent.writes, writes, `${state}: keine erneuten Attribut-/Strukturmutationen`);
}
field.setAttribute('aria-describedby', `external-help external-error later-help ${reasonId}`);
setFieldState(field, 'editable');
assertEqual(parent.children.length, 1, 'Editable ohne Grund entfernt veralteten eigenen Grund');
assertEqual(field.getAttribute('aria-describedby'), 'external-help external-error later-help', 'Später ergänzte Fremdbeschreibung bleibt erhalten');
const refreshed = setFieldState(field, 'warning', 'Bestehende Unsicherheit');
assertEqual(refreshed.id, reasonId, 'Erneute Darstellung verwendet dieselbe eigene ID');
const second = doc.createElement('select'); parent.appendChild(second);
second.disabled = false; second.readOnly = false; second.value = 'auswahl';
const secondReason = setFieldState(second, 'adopted', 'Aus Profil übernommen');
assert(secondReason.id !== reasonId, 'Zwei Felder erhalten eindeutige Gründe');
assert(!second.disabled && !second.readOnly && second.value === 'auswahl', 'Darstellung setzt keine Sperre oder Auswahl');
setFieldState(second, 'editable');
assert(!second.hasAttribute('aria-describedby'), 'Ohne fremde Beschreibungen wird leeres ARIA-Attribut entfernt');
for (const [state, reason] of [['success', 'Grund'], ['inactive', '  '], ['error', null]]) {
    const before = JSON.stringify([...field.attributes]);
    let threw = false;
    try { setFieldState(field, state, reason); } catch { threw = true; }
    assert(threw, 'Ungültiger Zustand oder fehlender Grund wird abgelehnt');
    assertEqual(JSON.stringify([...field.attributes]), before, 'Abgelehnte Aktualisierung bleibt ohne Mutation');
}
const collisionDoc = createPresentationTestDocument();
const reserved = collisionDoc.createElement('span'); reserved.id = `ds-field-reason-${Number(secondReason.id.split('-').at(-1)) + 1}`; collisionDoc.body.appendChild(reserved);
const third = collisionDoc.createElement('input'); collisionDoc.body.appendChild(third);
assert(setFieldState(third, 'empty', 'Noch keine Daten').id !== reserved.id, 'Bestehende fremde ID wird nicht doppelt vergeben');
