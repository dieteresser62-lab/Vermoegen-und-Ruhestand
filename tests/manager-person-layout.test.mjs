import fs from 'node:fs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { applyProfileAssetValuesToDom, readProfileAssetValuesFromDom, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { renderManagerPersonData, renderManagerView } from '../app/tranches/tranchen-manager-renderer.js';

const elements = tokenizeHTML(fs.readFileSync('depot-tranchen-manager.html', 'utf8')).elements;
const node = id => elements.find(el => el.attrs.id === id);
const inside = (child, parent) => { for (let el = child; el; el = el.parent) if (el === parent) return true; return false; };
const glance = node('managerPersonGlance'), panel = node('managerPersonPanel');
const visible = child => {
    for (let el = child; el && el !== panel; el = el.parent) if ('hidden' in el.attrs) return false;
    return inside(child, panel);
};
const fields = ['profileTagesgeld', 'profileRenteMonatlich', 'profileSonstigeEinkuenfte'];
assertEqual(elements.filter(el => el.tag === 'input' && inside(el, glance)).map(el => el.attrs.id).join(','), fields.join(','), 'Auf einen Blick enthält die drei vorhandenen Alltagseingaben');
for (const id of fields) assert(visible(node(id)) && !('readonly' in node(id).attrs) && !('disabled' in node(id).attrs), id + ': ohne Aufklappen direkt bearbeitbar');
assert(visible(node('managerPensionStartStatus')), 'Beginn der Rente steht unter dem offenen Feld');
for (const card of ['Person', 'Assets', 'Care']) assert('hidden' in node(`manager${card}Body`).attrs && node(`manager${card}Toggle`).attrs['aria-expanded'] === 'false', card + ': Detailkarte startet geschlossen');
for (const [card, toggle] of [['Assets', 'profileGoldAktivToggle'], ['Care', 'profileHealthBucketEnabledToggle']]) {
    assert(visible(node(toggle)) && !inside(node(toggle), node(`manager${card}Toggle`)), card + ': Schalter bleibt bei geschlossenen Details direkt bedienbar und außerhalb des Klappknopfs');
    assert(inside(node(`manager${card}Action`), node(`manager${card}Toggle`)), card + ': sichtbarer Text benennt die Klappaktion');
}
for (const id of ['profileGeburtsdatum', 'profileGeschlecht', 'profileRentenbeginn', 'profileRentenanpassungPct', 'profileKirchensteuerPct', 'profileSparerPauschbetrag', 'profileGoldZiel', 'profileGoldFloor', 'profileGoldBand', 'profileHealthBucketInitialAmount'])
    assert(!visible(node(id)) && elements.filter(el => el.attrs.id === id).length === 1, id + ': bisheriges Detailfeld bleibt eindeutig erhalten');
assert(visible(node('managerCardsToggleAll')), 'Gesamtknopf bleibt außerhalb der Klappen');
assert(inside(node('managerPersonProfileName'), node('managerPersonGlanceTitle')) && inside(node('managerCardsToggleAll'), glance), 'Name und Kartenaktionen gehören zum gemeinsamen offenen Kopf');
assert(node('managePeopleBtn').parent === node('managerSectionNav').parent && !inside(node('managePeopleBtn'), node('managerSectionNav')), 'Person anlegen steht in der Reiterzeile als eigener sekundärer Knopf');
assert(node('managePeopleBtn').attrs.class.includes('ds-button-secondary'), 'Person anlegen erhält die sekundäre Knopfrolle');
assert(inside(node('managerQuoteDetails'), node('managerQuoteInfo')) && node('managerQuoteInfo').attrs.role === 'tooltip', 'Lange Kursdetails verwenden das vorhandene Infomuster');
{
    const hosts = Object.fromEntries(['managePeopleBtn', 'managerPlanPanel', 'managerPersonPanel', 'managerHistoryPanel'].map(id => [id, {}]));
    const doc = { getElementById: id => hosts[id] };
    for (const kind of ['plan', 'person', 'history', 'person']) {
        renderManagerView(doc, { kind });
        assertEqual(hosts.managePeopleBtn.hidden, kind === 'history', kind + ': Person anlegen nur bei Plan und Person sichtbar');
    }
}

const records = createMusterHaushaltRecords('2026-10-13');
const projection = projectManagerProfiles(JSON.parse(records.rs_profiles_v1), records.rs_active_profile);
for (const profile of projection.profiles) {
    const doc = createSelectionDocument();
    for (const el of elements.filter(el => ['input', 'select'].includes(el.tag) && inside(el, panel))) {
        const field = addField(doc, el.attrs.id, '', el.tag === 'select' ? el.children.filter(child => child.tag === 'option').map(child => [child.attrs.value, child.attrs.value]) : undefined);
        field.setAttribute('inputmode', el.attrs.inputmode || '');
    }
    addField(doc, 'managerPensionStartStatus');
    applyProfileAssetValuesToDom(profile.values, doc);
    renderManagerPersonData(doc, profile);
    assert(doc.getElementById('managerPensionStartStatus').textContent.length > 0, profile.name + ': kurzer Rentenbeginn wird projiziert');
    for (const [id, value] of fields.map((id, i) => [id, String([12345, 1700, 300][i])])) doc.getElementById(id).value = value;
    const values = readProfileAssetValuesFromDom(doc);
    const saved = new Map();
    saveProfileAssetValues(values, { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) });
    assertEqual(saved.get('profile_tagesgeld'), '12345', profile.name + ': Tagesgeld bleibt am bisherigen Profilkey');
    assertEqual(saved.get('profile_rente_monatlich'), '1700', profile.name + ': Nettorente bleibt am bisherigen Profilkey');
    assertEqual(saved.get('profile_sonstige_einkuenfte'), '300', profile.name + ': sonstige Einkünfte bleiben am bisherigen Profilkey');
}
