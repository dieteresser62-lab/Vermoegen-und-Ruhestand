import fs from 'node:fs';
import { canonicalDecimalInput, readDecimalInput, displayDecimalInput, bindDecimalInputDisplay } from '../app/tranches/tranchen-manager-decimal-input.js';
import { readProfileAssetValuesFromDom, applyProfileAssetValuesToDom } from '../app/profile/profile-asset-values.js';
import { bindInfoPopovers } from '../app/shared/designsystem-info-popover.js';
for (const text of ['7,5', '7.5']) assertEqual(readDecimalInput(text), 7.5, 'Komma und Punkt ergeben kanonisch 7.5');
for (const text of ['7,5.0', '1.234,56', 'abc', 'Infinity', '0x10']) assert(Number.isNaN(readDecimalInput(text)), `Mehrdeutiger/ungültiger Wert ${text} wird nicht umgedeutet`);
assertEqual(canonicalDecimalInput(''), '', 'Optional leer bleibt leer');
assertEqual(displayDecimalInput(0.1234567890123), '0,1234567890123', 'Stückzahlen verlieren keine Präzision');
const source = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
const ids = [...source.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assertEqual(new Set(ids).size, ids.length, 'Manager besitzt keine doppelten IDs');
for (const button of source.matchAll(/<button\b[^>]*class="[^"]*\bds-info-button\b[^"]*"[^>]*>/g)) {
    const helpId = button[0].match(/aria-describedby="([^"]+)"/)?.[1];
    assert(helpId && !/\s/.test(helpId), 'Jeder Info-Knopf beschreibt genau eine Hilfe');
    assertEqual(ids.filter(id => id === helpId).length, 1, `${helpId}: genau eine vorhandene ID`);
    assert(new RegExp(`<span id="${helpId}"[^>]*role="tooltip"`).test(source), `${helpId}: Ziel ist ein Tooltip`);
}
const inventory = fs.readFileSync(new URL('../docs/design/funktionsinventar.json', import.meta.url), 'utf8');
for (const [field, helpId, text] of [
    ['profileHealthBucketInitialAmount', 'managerFieldHelp7', 'Diagnostisch inflationsindexiert, nominal gehalten.'],
    ['profileGoldZiel', 'managerFieldHelp8', 'Zielanteil von Gold am Depot in Prozent.']
]) {
    const labelHelp = source.match(new RegExp(`<div class="pv-label-help"><label for="${field}">[^<]*</label>([\\s\\S]*?)</div>`))?.[1];
    assert(labelHelp?.includes('class="ds-info"'), `${field}: Feldlabel besitzt seine Infohilfe`);
    assert(labelHelp?.includes(`aria-describedby="${helpId}"`), `${field}: Knopf verweist auf die eigene Hilfe`);
    assert(labelHelp?.includes(`id="${helpId}"`) && labelHelp.includes(text), `${field}: vollständiger Hilfetext bleibt seinem Feld zugeordnet`);
    assert(inventory.includes(`"#${helpId}"`), `${helpId}: Funktionsinventar führt die Hilfe`);
}
for (const input of source.matchAll(/<input\b[^>]*>/g)) {
    if (/id="profileAlter"/.test(input[0])) assert(input[0].includes('type="number"'), 'Alter behält Ganzzahlfeld');
    else assert(!input[0].includes('type="number"'), 'Alle Dezimalfelder sind Texteingaben');
}
const fields = Object.fromEntries(['profileGeburtsdatum','profileGeschlecht','profileRentenbeginn','profileRentenanpassungArt','profileRentenanpassungPct','profileKirchensteuerPct','profileSparerPauschbetrag','profileRenteSteuerquotePct','profileTagesgeld','profileRenteMonatlich','profileSonstigeEinkuenfte','profileAlter','profileGoldAktiv','profileGoldZiel','profileGoldFloor','profileGoldBand','profileGoldSteuerfrei','profileHealthBucketEnabled','profileHealthBucketInitialAmount','profileHealthBucketAssetSource','profileHealthBucketTriggerMinGrade','profileHealthBucketTriggerMode','profileHealthBucketCoverageMode','profileHealthBucketReturnMode','profileHealthBucketTargetMode'].map(id => [id, { value: '', getAttribute: () => id === 'profileAlter' ? 'numeric' : 'decimal' }]));
const doc = { getElementById: id => fields[id] };
// Selects besitzen kein decimal inputmode.
for (const id of ['profileGoldAktiv','profileGoldSteuerfrei','profileHealthBucketEnabled','profileHealthBucketAssetSource','profileHealthBucketTriggerMinGrade','profileHealthBucketTriggerMode','profileHealthBucketCoverageMode','profileHealthBucketReturnMode','profileHealthBucketTargetMode']) fields[id].getAttribute = () => null;
applyProfileAssetValuesToDom({ tagesgeld: 7.5, renteMonatlich: 1.5, alter: 67, goldZiel: 7.5 }, doc);
assertEqual(fields.profileTagesgeld.value, '7,5', 'Gespeichertes Tagesgeld wird deutsch angezeigt');
assertEqual(readProfileAssetValuesFromDom(doc).tagesgeld, 7.5, 'DOM-Reader übernimmt Komma vor Fachvalidator');
fields.profileTagesgeld.value = '7,5.0'; let failed = false;
try { readProfileAssetValuesFromDom(doc); } catch { failed = true; }
assert(failed, 'Ungültiger Text bleibt am bisherigen Validierungsworkflow');

const formatEvents = [];
const formatDoc = { addEventListener: (name, handler) => formatEvents.push([name, handler]) };
bindDecimalInputDisplay(formatDoc); bindDecimalInputDisplay(formatDoc);
assertEqual(formatEvents.length, 1, 'Wiederholtes Binden installiert genau einen Formatierungspfad');
assertEqual(formatEvents[0][0], 'focusout', 'Delegierter Fokusverlust erreicht dynamische Felder');
const decimalField = (value, overrides = {}) => ({ tagName: 'INPUT', type: 'text', value,
    getAttribute: name => name === 'inputmode' ? 'decimal' : null,
    dispatchEvent() { throw new Error('Formatierung darf keine Events erzeugen'); }, ...overrides });
for (const [raw, expected] of [['7.5', '7,5'], ['7,5', '7,5'], ['0.1234567890123456789', '0,1234567890123456789'], ['', ''], ['7,5.0', '7,5.0'], ['abc', 'abc']]) {
    const field = decimalField(raw);
    formatEvents[0][1]({ target: field });
    assertEqual(field.value, expected, 'Nach Verlassen bleibt Eingabe präzise oder ungültig: ' + raw);
    if (raw === '7.5') assertEqual(readDecimalInput(field.value), 7.5, 'Formatierte Dialogeingabe bleibt kanonisch');
}
for (const override of [{ disabled: true }, { readOnly: true }, { type: 'number' }, { type: 'date' }, { tagName: 'TEXTAREA' }, { getAttribute: () => null }]) {
    const field = decimalField('7.5', override); formatEvents[0][1]({ target: field });
    assertEqual(field.value, '7.5', 'Gesperrtes oder fachfremdes Feld bleibt unverändert');
}

const events = {}, button = { setAttribute() {}, focus() { popDoc.activeElement = this; } };
const host = { dataset: {}, querySelector: () => button, contains: item => item === button,
    addEventListener(type, fn) { events[type] = fn; } };
const popDoc = { activeElement: null, querySelectorAll: () => [host], addEventListener() {} };
button.addEventListener = (type, fn) => { events[`button-${type}`] = fn; };
bindInfoPopovers(popDoc); events.mouseenter(); assertEqual(host.dataset.visible, 'true', 'Hover öffnet Hilfe');
events.focusin(); popDoc.activeElement = button; events.keydown({ key: 'Escape', preventDefault() {} });
assertEqual(host.dataset.visible, 'false', 'Escape schließt trotz bestehendem Fokus');
assertEqual(popDoc.activeElement, button, 'Escape erhält Rückfokus');

// Der tatsächliche Verkaufsreader bleibt DOM-frei isolierbar; nicht nur Adaptertest.
const { functionSource } = await import('./designsystem-selection-dom.mjs');
const saleFields = new Map([
    ['reconcileActionId', 'synthetic-sale'], ['reconcileTrancheId', 'synthetic-lot'], ['reconcileExecutedAt', '2026-01-02'],
    ['reconcileSharesSold', '7,5'], ['reconcileGrossProceeds', '107,5'], ['reconcileFees', '0,5'],
    ['reconcileRecommendedShares', ''], ['reconcileRecommendedGross', ''],
    ['reconcileCashStatus', 'confirmed_already_reflected'], ['reconcileInitialCashBalance', '207,5']
]);
const saleSource = ['readOptionalNumber', 'readReconciliationActionFromDom'].map(name => functionSource('app/tranches/tranchen-manager-page.js', name)).join('\n');
const readSale = new Function('byId', 'readDecimalInput', 'state', 'Date', `${saleSource}\nreturn readReconciliationActionFromDom;`)(id => ({ value: saleFields.get(id) ?? '' }), readDecimalInput, { profileId: 'synthetic-person' }, class extends Date { constructor() { super('2026-01-02T12:00:00.000Z'); } });
const commaSale = readSale();
for (const [key, value] of saleFields) saleFields.set(key, value.replace(',', '.'));
assertEqual(JSON.stringify(readSale()), JSON.stringify(commaSale), 'Verkaufsdialog liefert mit Komma und Punkt denselben kanonischen Auftrag');
assertEqual(commaSale.sharesSold, 7.5, 'Tatsächliche Verkaufsstücke bleiben präzise');
assertEqual(commaSale.grossProceeds, 107.5, 'Tatsächlicher Bruttoerlös bleibt präzise');
assertEqual(commaSale.recommendation, null, 'Leere optionale Empfehlung bleibt fehlend');
