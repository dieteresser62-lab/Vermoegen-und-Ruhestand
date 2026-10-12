import { createTagesgeldFields } from '../app/shared/tagesgeld-fields.js';
const doc = { activeElement: null, createElement(tag) {
    return { tag, children: [], dataset: {}, attributes: {}, textContent: '',
        append(...nodes) { this.children.push(...nodes); },
        setAttribute(key, raw) { this.attributes[key] = raw; }, focus() { doc.activeElement = this; } };
} };
const people = [
    { id: 'a', name: '<img src=x onerror=alert(1)>', value: 100.125, lastDate: '2026-09-02', error: null },
    { id: 'b', name: 'B', value: 0, lastDate: null, error: null }
];
const fields = createTagesgeldFields({ doc, people });
assertEqual(fields.root.children[0].textContent, 'Tagesgeld-Stand jetzt', 'Gemeinsamer Monatstitel');
assertEqual(fields.root.children[1].textContent, 'Nach der Überweisung des Monatsbetrags. Fließt in den Vermögensverlauf ein.', 'Verlangter Erklärungstext');
assertEqual(fields.root.children[2].children[0].textContent, people[0].name + ' · Tagesgeld (€)', 'Name wird ausschließlich als Text ausgegeben');
assertEqual(fields.inputs[0].value, '100,125', 'Vorbelegung erhält alle Dezimalstellen');
assertEqual(fields.root.children[2].children[2].textContent, 'zuletzt am 02.09. · 100,125 €', 'Datums- und Betragshinweis');
assertEqual(fields.root.children[3].children[2].textContent, 'Noch kein datierter Tagesgeld-Stand', 'Fehlender Beleg bleibt ehrlich');
assertEqual(fields.inputs[1].value, '0', 'Explizite Null bleibt vorbelegt');
for (const raw of ['', '-0,01', 'NaN', '1.000,50']) {
    fields.inputs[0].value = raw;
    let failed = false; try { fields.read(); } catch { failed = true; }
    assert(failed, 'Ungültiges Feld verhindert Auftrag');
    assert(doc.activeElement === fields.inputs[0], 'Fehler fokussiert das passende Feld');
    assertEqual(fields.inputs[0].value, raw, 'Fehler erhält Eingabetext');
    assertEqual(fields.inputs[0].attributes['aria-invalid'], 'true', 'Feldfehler zugänglich');
}
fields.inputs[0].value = '125,875';
assertEqual(fields.read().values.a, 125.875, 'Bestätigung verwendet denselben Dezimalparser');
assertEqual(fields.read().values.b, 0, 'Null wird bestätigt');
const damaged = createTagesgeldFields({ doc, people: [{ ...people[0], error: 'Beschädigte Historie' }] });
assertEqual(damaged.root.children[2].children[2].textContent, 'Beschädigte Historie', 'Quellfehler hat Vorrang vor Datum und Betrag');
let failed = false; try { damaged.read(); } catch { failed = true; }
assert(failed, 'Beschädigte Quelle blockiert auch plausible Eingabe');

const monthly = createTagesgeldFields({ doc, people, monthly: true });
assertEqual(monthly.root.children[2].children[2].textContent, 'zuletzt bestätigt am 02.09.2026: 100,125 €', 'Monatshinweis nennt vollständigen bestätigten Quellstand');
assertEqual(monthly.root.children[2].children[4].textContent, '€', 'Monatsfeld besitzt sichtbaren Eurozusatz');
for (const [raw, expected] of [['18.000', 18000], ['18000', 18000], ['1.000,50', 1000.5], ['18.000,125', 18000.125], ['0', 0], ['100.1255', 100.1255]]) {
    monthly.inputs[0].value = raw;
    assertEqual(monthly.read().values.a, expected, 'Monatsmodus erhält präzisen Betrag: ' + raw);
}
for (const raw of ['1.00,50', '1.0000,50', '1.00.000', '', '-1', 'Infinity', 'NaN']) {
    monthly.inputs[0].value = raw; let error; try { monthly.read(); } catch (caught) { error = caught; }
    assert(error && doc.activeElement === monthly.inputs[0], 'Ungültiger Monatsbetrag hat Feldfehler: ' + raw);
}

const closeFields = createTagesgeldFields({ doc, people, monthly: true, closePresentation: true, title: '' });
assertEqual(closeFields.root.children[0].children[0].textContent, `Tagesgeld ${people[0].name}`, 'Abschlusslabel nennt Tagesgeld und den sicheren Personennamen');
assertEqual(closeFields.root.children.at(-1).textContent, 'Nach der Überweisung des Monatsbetrags. Fließt in den Vermögensverlauf ein.', 'Abschlusserklärung steht nach den Feldern');
assertEqual(closeFields.root.children[0].children[2].textContent, 'zuletzt bestätigt am 02.09.2026: 100,125 €', 'Abschlussdarstellung erhält den datierten Quellbeleg');
assertEqual(closeFields.inputs[0].value, '100,125', 'Abschlussdarstellung erhält Eingabepräzision');

// FR-4: Bestätigung ist flüchtig, personengebunden und vom Zahlenvergleich unabhängig.
{
    const callbacks = new Map(), listeners = (node, type, callback) => callbacks.set(node, callback);
    const cash = createTagesgeldFields({ doc, people, monthly: true, requireConfirmation: true });
    cash.bind(listeners);
    assert(!cash.ready, 'Vorbelegung bestätigt keine Person'); cash.read();
    assert(!cash.ready, 'Lesen gültiger Felder bestätigt keine Person');
    callbacks.get(cash.inputs[0])();
    assert(!cash.ready, 'Gleiche Zahl bestätigt ausschließlich die erste Person');
    callbacks.get(cash.inputs[1])();
    assert(cash.ready, 'Zweite gleiche Zahl vervollständigt den bestätigten Cashzustand');
    cash.inputs[0].value = '-1'; callbacks.get(cash.inputs[0])();
    assert(!cash.ready && cash.inputs[0].attributes['aria-invalid'] === 'true', 'Ungültige Folgeeingabe sperrt erneut und zeigt Feldfehler');
    callbacks.get(cash.confirmationButton)();
    assert(!cash.ready && doc.activeElement === cash.inputs[0], 'Stand stimmt bestätigt keine ungültigen Werte');
    cash.inputs[0].value = '100,125';
    assert(!cash.focusConfirmation() && doc.activeElement === cash.confirmationButton, 'Weiter validiert und fokussiert die Bestätigung ohne sie auszulösen');
    callbacks.get(cash.confirmationButton)(); assert(cash.ready, 'Stand stimmt bestätigt alle gültigen angezeigten Werte');
    const fresh = createTagesgeldFields({ doc, people, requireConfirmation: true });
    assert(!fresh.ready, 'Neuer Abschluss verwirft persönliche Bestätigungen');
}
