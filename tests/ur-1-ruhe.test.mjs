// UR-1: Pflege-Reiter mit Aufklappzeilen, Pflegeband und übernommene Rentenanpassung auf der Personenkarte,
// Nur Anzeige: Lesen und Aufklappen schreiben nie. Testdatum 23.10.2026. Die Aufklappzeile „Erfasste Vermögensstände“ entfiel mit VS-2.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { readCareFieldValues } from '../app/shared/care-price-fields.js';
import { readCareValues, officialCareCosts } from '../app/shared/household-care-values.js';
import { careRowSummaries, setCareRows, revealCareRowFor, CARE_ROWS } from '../app/tranches/tranchen-manager-care-rows.js';
import { pensionAdoption, renderManagerHouseholdAdoption, careReserveHouseholdText, genitive } from '../app/tranches/tranchen-manager-household-adoption.js';
import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { CARE_HINT_TEXT, renderCareHint, refreshCareHints } from '../app/shared/care-hint.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
setAppTestDate('2026-10-23');

const plain = text => String(text).replace(/ /g, ' ');
const summaries = (records, extra = {}) => {
    const { storage, counts } = countingStorage(records);
    const values = { ...readCareFieldValues(storage), ...extra };
    const careValues = readCareValues(storage);
    const result = careRowSummaries({ values, careValues, officialCosts: values.pflegeKostenStaffelPreset === 'amtlich' ? officialCareCosts(careValues) : null });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Sätze der Zeilen lesen ohne Schreiben');
    return Object.fromEntries(Object.entries(result).map(([key, text]) => [key, plain(text)]));
};

// 1. Zusammenfassungssätze aus den gespeicherten Werten (Vorgabestaffel, eigene Staffel, Heim, Flex, Pflegegeld).
{
    const base = summaries(pfa2Records({}).records);
    assertEqual(base.Home, 'Eigene Werte · Grad 1 bis 3 zu Hause: 300 / 500 / 1.500 €/Monat · Grad 4 und 5 im Heim · Deckel 120.000 €/Jahr je Person',
        'Pflege zu Hause: Vorgabestaffel mit Formen und Deckel');
    assertEqual(base.Heim, 'Eigenanteil 3.364 €/Monat im 1. Heimjahr, ab dem 4. Jahr 2.111 € · eigene Ausgaben 500 €/Monat je Person · mitgeliefert, Stand 07.2026', 'Pflege im Heim: Eigenanteil, eigene Ausgaben und Herkunft (UR-2)');
    assertEqual(base.Flex, 'Vom Wunsch- und Mindest-Flex bleiben bei Grad 1 bis 5: 100 / 100 / 50 / 0 / 0 %', 'Flex bei Pflege: Vorgabe 100/100/50/0/0');
    assertEqual(base.Rise, '5 % p.a. über der Inflation bis 2035, danach 2 % · regionaler Zuschlag 0 % · gilt für zu Hause und Heim', 'Kostenanstieg (bis 2035 + 5 %, danach + 2 %) und Zuschlag');
    assert(base.Allowance.startsWith('Grad 2 bis 5: 347 / 599 / 800 / 990 €/Monat · nur bei Pflege durch Angehörige · gesetzlich, Stand '), `Pflegegeld der Kasse: ${base.Allowance}`);
    const own = summaries(pfa2Records({}).records, { pflegeStufe3Zusatz: '21000', pflegeStufe4Form: 'home-support', pflegeMaxFloor: '90000',
        pflegeKostenDrift: '3.5', pflegeKostenDriftDanach: '3.5', pflegeRegionalZuschlag: '12.5', pflegeStufe1FlexCut: '90', pflegeHeimEigeneAusgaben: '650' });
    assertEqual(own.Home, 'Eigene Werte · Grad 1 bis 4 zu Hause: 300 / 500 / 1.750 / 2.667 €/Monat · Grad 5 im Heim · Deckel 90.000 €/Jahr je Person',
        'Eigene Staffel: neuer Betrag und Form erscheinen nach der Änderung');
    assertEqual(own.Rise, '3,5 % p.a. über der Inflation · regionaler Zuschlag 12,5 % · gilt für zu Hause und Heim', 'Dezimalwerte mit Komma');
    assert(own.Flex.endsWith('90 / 100 / 50 / 0 / 0 %') && own.Heim.includes('eigene Ausgaben 650 €/Monat je Person'), 'Flex und eigene Ausgaben folgen den Werten');
    const official = summaries(pfa2Records({ sim: { sim_pflegeKostenStaffelPreset: 'amtlich' } }).records);
    assert(official.Home.startsWith('Amtlicher Durchschnitt · Grad 1 bis 5: ') && !official.Home.includes('im Heim'), `Amtlicher Durchschnitt ohne Formen: ${official.Home}`);
}

/** Kleinste Seite mit Zeilen, Knöpfen und Zählwerk für Attributänderungen. */
function rowsDocument() {
    const nodes = new Map();
    const node = (id, extra = {}) => { const element = { id, hidden: false, textContent: '', attributes: {}, children: [],
        setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
        contains(other) { return other === this || this.children.some(child => child.contains(other)); }, ...extra }; nodes.set(id, element); return element; };
    for (const key of CARE_ROWS) {
        node(`managerCareRow${key}Toggle`); node(`managerCareRow${key}Action`);
        node(`managerCareRow${key}Body`, { hidden: true });
    }
    nodes.get('managerCareRowFlexBody').children.push(node('managerCareFlex3'));
    nodes.get('managerCareRowRiseBody').children.push(node('managerCareRegional'));
    node('pflege');
    return { getElementById: id => nodes.get(id) ?? null, nodes };
}

// 2. Aufklappen ohne Schreiben; Einzelzeilen bleiben konsistent (OP-3: kein „Alle Details“ mehr).
{
    const { storage, counts } = countingStorage(pfa2Records({}).records);
    readCareFieldValues(storage);
    const doc = rowsDocument();
    setCareRows(doc, { Home: true });
    assert(!doc.nodes.get('managerCareRowHomeBody').hidden && doc.nodes.get('managerCareRowHomeAction').textContent === '▾ ausblenden'
        && doc.nodes.get('managerCareRowHomeToggle').attributes['aria-expanded'] === 'true', 'Einzelne Zeile öffnet mit Text und ARIA');
    setCareRows(doc, Object.fromEntries(CARE_ROWS.map(key => [key, true])));
    assert(CARE_ROWS.every(key => doc.nodes.get(`managerCareRow${key}Action`).textContent === '▾ ausblenden'), 'Alle offen: jede Zeile bietet Ausblenden');
    setCareRows(doc, Object.fromEntries(CARE_ROWS.map(key => [key, false])));
    assert(CARE_ROWS.every(key => doc.nodes.get(`managerCareRow${key}Body`).hidden), 'Alle wieder zugeklappt');
    assertEqual(counts.setItem + counts.removeItem, 0, 'Auf- und Zuklappen schreibt nie');
}

// 3. Sprungziel in eine zugeklappte Zeile öffnet genau diese Zeile; Ziele außerhalb der Zeilen öffnen nichts.
{
    const doc = rowsDocument();
    assertEqual(revealCareRowFor(doc, 'managerCareFlex3'), 'Flex', 'Ziel im Flex-Feld öffnet „Flex bei Pflege“');
    assert(!doc.nodes.get('managerCareRowFlexBody').hidden && CARE_ROWS.filter(key => key !== 'Flex').every(key => doc.nodes.get(`managerCareRow${key}Body`).hidden),
        'Nur die Zeile des Ziels ist offen');
    assertEqual(revealCareRowFor(doc, 'managerCareRegional'), 'Rise', 'Regionaler Zuschlag liegt in „Kostenanstieg und Zuschlag“');
    assertEqual(revealCareRowFor(doc, 'pflege'), null, 'Sprungziel „Pflege“ (Kopf des Reiters) klappt nichts auf');
}

// 4. Rentenanpassung: übernommen nur für die zweite Person im Haushalt, ihr gespeicherter Wert bleibt unverändert.
{
    const records = pfa2Records({}).records;
    const registry = JSON.parse(records.rs_profiles_v1);
    Object.assign(registry.profiles[IDS[0]].data, { profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '2' });
    Object.assign(registry.profiles[IDS[1]].data, { profile_rentenanpassung_art: 'wage', profile_rentenanpassung_pct: '0' });
    const before = JSON.stringify(registry);
    const projection = projectManagerProfiles(registry, IDS[1]);
    const helga = registry.profiles[IDS[0]].meta.name;
    const adopted = pensionAdoption(projection, IDS[1]);
    assertEqual(`${adopted.value} ${adopted.unit}`, '2,0 % fest', 'Zweite Person sieht die Anpassung des Hauptprofils');
    assertEqual(adopted.reason, `Übernommen: Im Haushalt gilt die Rentenanpassung von ${helga} für beide Renten. Ändern auf ${genitive(helga)} Personenkarte.`, 'Grund nennt das Hauptprofil');
    assertEqual(pensionAdoption(projectManagerProfiles(registry, IDS[0]), IDS[0]), null, 'Hauptprofil bearbeitet seine eigene Anpassung');
    const alone = structuredClone(registry);
    delete alone.profiles[IDS[0]];
    assertEqual(pensionAdoption(projectManagerProfiles(alone, IDS[1]), IDS[1]), null, 'Einpersonenhaushalt bearbeitet seine eigene Anpassung');
    const nodes = Object.fromEntries(['profilePensionAdjustment', 'profilePensionAdopted', 'profilePensionAdoptedValue', 'profilePensionAdoptedUnit',
        'profilePensionAdoptedReason', 'managerIncomeAdoptedNote', 'managerHouseholdCareSettings'].map(id => [id, { hidden: false, value: '', textContent: '' }]));
    nodes.profileRentenanpassungArt = { value: 'wage' }; nodes.profileRentenanpassungPct = { value: '0' };
    renderManagerHouseholdAdoption({ getElementById: id => nodes[id] ?? null }, projection, IDS[1]);
    assert(nodes.profilePensionAdjustment.hidden && !nodes.profilePensionAdopted.hidden && nodes.profilePensionAdoptedValue.value === '2,0'
        && nodes.profilePensionAdoptedReason.textContent.startsWith('Übernommen:'), 'Eigene Felder verborgen, übernommener Wert mit Grund sichtbar');
    assertEqual(`${nodes.profileRentenanpassungArt.value} ${nodes.profileRentenanpassungPct.value}`, 'wage 0', 'Eigene Wertträger der Person bleiben unverändert');
    assertEqual(JSON.stringify(registry), before, 'Anzeige verändert keine gespeicherten Werte');
    assertEqual(genitive('Klaus'), 'Klaus’', 'Genitiv bei Namen auf s');
    // B3: Satz zur Pflegereserve stimmt mit der Haushaltsrechnung (Beträge addiert, Einstellungen der ersten aktiven Person).
    assert(careReserveHouseholdText(projection, IDS[1]).startsWith('Im Haushalt werden die Zielbeträge aktiver Pflegereserven addiert.'), 'Pflegereserve: Satz im Haushalt');
    assertEqual(careReserveHouseholdText(projectManagerProfiles(alone, IDS[1]), IDS[1]), '', 'Ohne zweite Person im Haushalt kein Satz');
}

// 6. UR-1b: Der einmalige Pflegehinweis auf der Personenkarte wiederholt den Betrag des Pflegebands nicht; Haushalt & Plan behält ihn.
{
    const host = () => ({ hidden: true, html: '', set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; }, replaceChildren() { this.html = ''; } });
    const persons = [{ profileId: 'muster_werner', name: 'Werner', grade: 3, residential: false, own: false, monthly: 1500 }, { profileId: 'muster_helga', name: 'Helga', grade: 2, residential: false, own: true, monthly: 0 }];
    const card = host();
    assert(renderCareHint(card, { done: false, persons }, { except: 'muster_werner' }), 'Hinweis bleibt sichtbar');
    const text = plain(card.html);
    assert(text.includes(CARE_HINT_TEXT) && text.includes('Erledigt') && !text.includes('Pflege Werner') && text.includes('Angesetzt: Pflege Helga: 0 €/Monat'),
        'Ohne den Betrag der angezeigten Person, mit dem der anderen');
    renderCareHint(card, { done: false, persons: [persons[0]] }, { except: 'muster_werner' });
    assert(!card.hidden && !card.html.includes('Angesetzt') && card.html.includes('data-care-hint-done'), 'Nur die angezeigte Person: keine Zeile „Angesetzt“, „Erledigt“ bleibt');
    const records = pfa2Records({ care: [null, { grade: 3, form: 'home-support' }] }).records;
    const registry = JSON.parse(records.rs_profiles_v1);
    Object.assign(records, registry.profiles[IDS[1]].data, { rs_current_profile: IDS[1], rs_active_profile: IDS[1] });
    const { storage, counts } = countingStorage(records);
    const hosts = { profileCareHint: Object.assign(host(), { id: 'profileCareHint' }), managerPlanCareHint: Object.assign(host(), { id: 'managerPlanCareHint' }) };
    refreshCareHints({ getElementById: id => hosts[id] || null }, { storage });
    const werner = registry.profiles[IDS[1]].meta.name;
    assert(!plain(hosts.profileCareHint.html).includes(`Pflege ${werner}:`) && plain(hosts.managerPlanCareHint.html).includes(`Pflege ${werner}: 1.500 €/Monat`),
        'Personenkarte ohne doppelte Zeile, Haushalt & Plan mit Betrag');
    assertEqual(counts.setItem + counts.removeItem, 0, 'Hinweise lesen ohne Schreiben');
}

// 7.–9. Aus dem entfallenen UR-1c-Test die Fälle ohne Außenperson.
const spaces = text => String(text).replace(/[  ]/g, ' ');
/** Pflegeband der geöffneten Person Werner (Grad 3 zu Hause) mit dem eigenen Wert `own` im Formular; liest ohne Schreiben. */
function wernerCareLine(own) {
    const records = pfa2Records({ care: [null, { grade: 3, form: 'home-support' }], sim: { sim_pflegeRegionalZuschlag: '20' } }).records;
    const registry = JSON.parse(records.rs_profiles_v1);
    Object.assign(records, registry.profiles[IDS[1]].data, { rs_current_profile: IDS[1], rs_active_profile: IDS[1] });
    const { storage, counts } = countingStorage(records);
    const nodes = { profileCareGradeToday: { value: '3' }, profileCareFormToday: { value: 'home-support' }, profileCareHomeCostsMonthly: { value: own },
        profileCareAllowanceSummary: {} };
    syncManagerCareToday({ getElementById: id => nodes[id] ?? null }, storage);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Pflegeband liest ohne Schreiben');
    return spaces(nodes.profileCareAllowanceSummary.textContent);
}

// 7. Haushaltsmitglied Grad 3 zu Hause, Staffel 1.500 €, Regionalzuschlag 20 % → 1.800 €/Monat.
{
    const line = wernerCareLine('');
    assert(line.startsWith('Angesetzt: 1.800 €/Monat Staffel für Grad 3'), `Haushaltsmitglied mit Zuschlag: ${line}`);
}

// 8. UR-1d: Zwei namensgleiche Profile im Pflegehinweis; nur die geöffnete Person (Profil-ID) entfällt.
{
    const host = () => ({ hidden: true, html: '', set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; }, replaceChildren() { this.html = ''; } });
    const persons = [{ profileId: 'alex_1', name: 'Alex', grade: 3, residential: false, own: false, monthly: 1500 },
        { profileId: 'alex_2', name: 'Alex', grade: 2, residential: false, own: false, monthly: 500 }];
    const card = host();
    renderCareHint(card, { done: false, persons }, { except: 'alex_1' });
    const text = spaces(card.html);
    assert(!text.includes('1.500 €/Monat') && text.includes('Pflege Alex: 500 €/Monat'), `Namensgleiche andere Person bleibt im Hinweis (${text})`);
    const records = pfa2Records({ care: [{ grade: 2, form: 'family' }, { grade: 3, form: 'home-support' }] }).records;
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) registry.profiles[id].meta.name = 'Alex';
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[IDS[1]].data, { rs_current_profile: IDS[1], rs_active_profile: IDS[1] });
    const hosts = { profileCareHint: Object.assign(host(), { id: 'profileCareHint' }), managerPlanCareHint: Object.assign(host(), { id: 'managerPlanCareHint' }) };
    const { storage, counts } = countingStorage(records);
    refreshCareHints({ getElementById: id => hosts[id] || null }, { storage });
    const onCard = spaces(hosts.profileCareHint.html), onPlan = spaces(hosts.managerPlanCareHint.html);
    assert(!onCard.includes('Pflege Alex: 1.500 €/Monat') && onCard.includes('Pflege Alex: 500 €/Monat') && onPlan.includes('Pflege Alex: 1.500 €/Monat'),
        `Personenkarte: nur die geöffnete Alex entfällt (${onCard})`);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Hinweise lesen ohne Schreiben');
}

// 9. Ungespeicherter eigener Wert (Formular 250 €, gespeichert leer) ist nicht verlässlich berechenbar: keine Betragszeile statt einer falschen.
{
    const line = wernerCareLine('250');
    assert(line.startsWith('Angesetzt: eigener Wert') && !/\d €\/Monat eigener Wert/.test(line), `Ungespeicherter eigener Wert: ohne Betrag (${line})`);
}
setAppTestDate(null);
