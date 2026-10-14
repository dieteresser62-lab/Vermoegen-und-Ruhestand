import fs from 'node:fs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { renderManagerProfiles, renderManagerPlanSummary } from '../app/tranches/tranchen-manager-renderer.js';

const elements = tokenizeHTML(fs.readFileSync('depot-tranchen-manager.html', 'utf8')).elements;
const node = id => elements.find(el => el.attrs.id === id);
const inside = (child, parent) => { for (let el = child; el; el = el.parent) if (el === parent) return true; return false; };
const panel = node('managerPlanPanel'), need = elements.find(el => el.attrs.class?.includes('pv-plan-needs'));
const visible = child => {
    for (let el = child; el && el !== panel; el = el.parent) {
        if ('hidden' in el.attrs) return false;
        if (el.parent?.tag === 'details' && el.tag !== 'summary' && !('open' in el.parent.attrs)) return false;
    }
    return inside(child, panel);
};
const more = node('managerPlanMore');
assert(visible(need) && !('open' in more.attrs), 'Bedarf ist offen, Weitere Planwerte startet geschlossen');
assertEqual(elements.filter(el => el.tag === 'input' && inside(el, need)).map(el => el.attrs['data-manager-plan-field']).join(','),
    'floorBedarf,flexBedarf,minimumFlexAnnual', 'Offene Bedarfszeile enthält genau die drei bisherigen Eingaben');
for (const el of elements.filter(el => 'data-manager-plan-field' in el.attrs)) {
    const isNeed = ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual'].includes(el.attrs['data-manager-plan-field']);
    assert(isNeed ? visible(el) : inside(el, more) && !visible(el), 'Feld am vorgesehenen Platz erhalten: ' + el.attrs.id);
}
assert(elements.indexOf(node('managerHousehold')) < elements.indexOf(need)
    && elements.indexOf(more) < elements.indexOf(node('managerPlanComparisonCard')), 'Vermögen, Bedarf, weitere Werte und Planvergleich folgen der freigegebenen Reihenfolge');
const records = createMusterHaushaltRecords('2026-10-13'), registry = JSON.parse(records.rs_profiles_v1);
const hosts = Object.fromEntries(['managerHousehold', 'managerPlanMoreSummary'].map(id => [id, { innerHTML: '', textContent: '' }]));
const doc = { getElementById: id => hosts[id] };
const projection = projectManagerProfiles(registry, records.rs_active_profile, { now: new Date('2026-10-13T12:00:00Z') });
const before = JSON.stringify(projection);
renderManagerProfiles(doc, projection);
const cards = tokenizeHTML(hosts.managerHousehold.innerHTML).elements;
assertEqual(cards.filter(el => el.tag === 'section' && el.attrs.class.includes('ds-card')).length, projection.profiles.length + 1,
    'Zeile 1 enthält Haushaltskarte und genau eine Karte je Person');
const details = cards.filter(el => el.tag === 'details');
assertEqual(details.length, projection.profiles.length + 1, 'Jede Vermögenskarte hat eigene Details');
assert(details.every(el => !('open' in el.attrs)), 'Alle Vermögensdetails starten geschlossen');
const openCards = cards.filter(el => !details.some(detail => inside(el, detail)));
assert(openCards.some(el => el.attrs.class === 'pv-hero-number'), 'Eine Haushaltsleitzahl bleibt offen');
for (const id of ['managerHistoryStart', 'managerHistoryStartConfirm'])
    assert(details.some(detail => inside(cards.find(el => el.attrs.id === id), detail)), id + ': in Haushaltsdetails erhalten');
assert(cards.some(el => el.attrs.class === 'pv-allocation-values') && hosts.managerHousehold.innerHTML.includes('Einstand'), 'Aufteilung und Einstand bleiben in den Details erhalten');
renderManagerPlanSummary(doc, JSON.parse(records.household_plan_v1).entries[Object.keys(JSON.parse(records.household_plan_v1).entries)[0]].values);
assert(['Flex-Budget', 'Reserven', 'Strategie', 'Dynamik', 'CAPE'].every(label => hosts.managerPlanMoreSummary.textContent.includes(label)), 'Zusammenfassung zeigt die tatsächlichen Planwerte');
assertEqual(JSON.stringify(projection), before, 'Neue Anordnung schreibt keine Fachwerte');
