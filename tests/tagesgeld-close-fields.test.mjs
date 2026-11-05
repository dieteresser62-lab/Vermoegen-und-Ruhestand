import { createTagesgeldFields } from '../app/shared/tagesgeld-fields.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const person = { id: 'max', name: 'Max Mustermann', value: 18000, lastDate: '2026-10-01' };
const proposal = { value: 18500.125, source: 'spielwert', explanation: 'Synthetischer Vorschlag' };
function fixture(people = [person], proposals = {}) {
    const { doc } = createDialogFixture();
    const fields = createTagesgeldFields({ doc, people, proposals, monthly: true, closePresentation: true, requireConfirmation: true, title: '' });
    doc.body.append(fields.root); fields.bind((node, type, callback) => node.addEventListener(type, callback));
    return { doc, fields, input: fields.inputs[0] };
}

{
    const { doc, fields, input } = fixture();
    assert(fields.ready && !input.hidden, 'TG-1: gültiger letzter Stand ist sofort direkt überschreibbar');
    assertEqual(input.value, '18.000', 'TG-1: letzter bekannter Stand ist vorbelegt');
    assertEqual(doc.querySelector('[data-tagesgeld-status]').textContent, 'Stand vom 01.10.2026', 'TG-1: Datum steht klein bei der Person');
    assertEqual(doc.querySelectorAll('button').length, 1, 'TG-1: nur das bestehende Herkunfts-Info bleibt, keine Bestätigungsknöpfe');
    input.value = '19.001,125'; await input.fire('input');
    assertEqual(fields.read().values.max, 19001.125, 'TG-1: Abschlussauftrag erhält den überschriebenen Feldwert ohne Übernehmen');
    assertEqual(doc.querySelector('[data-tagesgeld-status]').textContent, 'geändert · vorher 18.000\u00a0€', 'TG-1: geänderter Wert nennt den Ausgangsbetrag ohne Euro-Umbruch');
    let prevented = false;
    await input.fire('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
    assert(prevented && fields.ready && !input.hidden, 'TG-1: Enter bleibt im offenen Eingabefeld');
}
{
    const { fields, input } = fixture([{ ...person, value: null, lastDate: null }]);
    assertEqual(input.value, '', 'TG-1: fehlender Stand bleibt leer');
    assert(!fields.ready && fields.openPeople.includes(person.name), 'TG-1: leerer Stand sperrt und nennt die Person');
    input.value = '0'; await input.fire('input');
    assert(fields.ready && fields.read().values.max === 0, 'TG-1: explizite Null ist ein gültiger Stand');
    input.value = '-1'; await input.fire('input');
    assert(!fields.ready && fields.openPeople.includes(person.name), 'TG-1: ungültiger Stand sperrt erneut');
    assertEqual(input.getAttribute('aria-invalid'), 'true', 'TG-1: ungültiger Stand zeigt einen Feldfehler');
}
{
    const { doc, fields, input } = fixture([person], { max: proposal });
    assertEqual(input.value, '18.500,125', 'TG-1: Spielbereich ist mit Vorschlag vorbelegt');
    assertEqual(fields.read().playValues.max.source, 'spielwert', 'TG-1: unveränderter Vorschlag bleibt Spielwert');
    assert(doc.querySelector('[data-tagesgeld-proposal]').textContent.includes('Spielwert · Vorschlag'), 'TG-1: Vorschlag ist als Spielwert beschriftet');
    fields.updateProposals({ max: { ...proposal, value: 18600 } });
    assertEqual(input.value, '18.600', 'TG-1: unberührtes Feld folgt neuem Vorschlag');
    assertEqual(fields.read().playValues.max.value, 18600, 'TG-1: Herkunft folgt neuem Vorschlag');
    input.value = '17.000'; await input.fire('input');
    assertEqual(fields.read().values.max, 17000, 'TG-1: eigene Spielbereichseingabe wird direkt übernommen');
    assert(!fields.read().playValues, 'TG-1: überschriebener Vorschlag ist ein normaler Wert');
    assert(doc.querySelector('[data-tagesgeld-proposal]').hidden, 'TG-1: eigene Eingabe trägt keinen sichtbaren Spielwerthinweis');
    fields.updateProposals({ max: { ...proposal, value: 18700 } });
    assertEqual(input.value, '17.000', 'TG-1: eigene Eingabe bleibt bei neuem Vorschlag erhalten');
}
{
    const { doc, fields, input } = fixture([person], { max: { error: 'Ausgaben fehlen' } });
    assert(fields.ready && !fields.read().playValues, 'TG-1: Vorschlagsfehler lässt gültigen letzten Stand zu');
    assertEqual(input.value, '18.000', 'TG-1: Vorschlagsfehler fällt auf letzten Stand zurück');
    assertEqual(doc.querySelector('[data-tagesgeld-proposal]').textContent, 'Spielwert nicht verfügbar: Ausgaben fehlen', 'TG-1: Vorschlagsfehler wird erklärt');
    fields.updateProposals({ max: proposal });
    fields.updateProposals({ max: { error: 'Nicht berechenbar' } });
    assertEqual(input.value, '18.000', 'TG-1: späterer Vorschlagsfehler stellt letzten Stand wieder her');
}

{
    const { doc, fields, input } = fixture();
    input.value = '95000'; await input.fire('input');
    assertEqual(input.value, '95000', 'NB-1b: beim Tippen bleibt die Eingabe unverändert');
    await input.fire('change');
    assertEqual(input.value, '95.000', 'NB-1b: change formatiert den gültigen Abschlussbetrag');
    assertEqual(fields.read().values.max, 95000, 'NB-1b: Formatierung erhält den gespeicherten Zahlenwert');
    input.value = 'ungültig'; await input.fire('input'); await input.fire('change');
    assertEqual(input.value, 'ungültig', 'NB-1b: ungültige Eingabe bleibt zur Korrektur stehen');
    assert(!fields.ready && doc.querySelector('.tagesgeld-error').textContent.length > 0, 'NB-1b: ungültige Eingabe zeigt Feldmeldung');
}
{
    const { fields, input } = fixture([person], { max: { ...proposal, value: 95000 } });
    input.value = '95000'; await input.fire('input'); await input.fire('change');
    assertEqual(input.value, '95.000', 'NB-1b: gleicher Spielwert wird bei change formatiert');
    assertEqual(fields.read().playValues.max.value, 95000, 'NB-1b: reine Formatierung erhält Spielwertherkunft');
    input.value = '30000'; await input.fire('input'); await input.fire('change');
    assertEqual(input.value, '30.000', 'NB-1b: eigener Wert wird formatiert');
    assert(!fields.read().playValues, 'NB-1b: eigener Wert bleibt überschrieben');
    fields.updateProposals({ max: proposal });
    assertEqual(input.value, '30.000', 'NB-1b: Vorschlagsupdate überschreibt die formatierte eigene Eingabe nicht');
}
