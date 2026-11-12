// UR-1c (Codex-Befund P2 zu UR-1): Die Zeile „Angesetzt“ im Pflegeband nennt auch für eine Person außerhalb des Haushalts
// den Betrag der gemeinsamen Bedarfsrechnung (Regionalzuschlag, Deckel), wie der Simulator für dieses Einzelprofil im
// ersten Jahr. Nur Anzeige: nichts wird geschrieben. Synthetische Daten, Testdatum 23.10.2026.
// UR-1d: Die Referenz rechnet mit dem Einzelplan der Außenperson (readSimulatorHouseholdPlan mit profileId); ohne bestätigten
// Einzelplan gibt es keine Betragszeile. Der Pflegehinweis schließt nur die geöffnete Person per Profil-ID aus.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope, readSimulatorHouseholdPlan } from '../app/profile/household-plan.js';
import { renderCareHint, refreshCareHints } from '../app/shared/care-hint.js';
setAppTestDate('2026-10-23');

const OUTSIDE = 'muster_aussen';
const plain = text => String(text).replace(/[  ]/g, ' ');
const euro = value => `${Math.round(value).toLocaleString('de-DE')} €/Monat`;

/** Außenperson Grad 3 zu Hause mit eigenen Pflegewerten; sie ist die geöffnete Person. `floor` legt ihren bestätigten
 * Einzelplan an (null: kein Einzelplan); der Haushaltsplan behält 36.000 € Grundbedarf. */
function outsideRecords({ own = '', sim = {}, floor = 36000 }) {
    const base = pfa2Records({});
    const records = structuredClone(base.records);
    if (floor !== null) records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(records[HOUSEHOLD_PLAN_KEY], [{ scope: planScope('single', [OUTSIDE]),
        values: { ...base.values, floorBedarf: floor } }], { now: () => new Date('2026-10-23T12:00:00Z') }).raw;
    const registry = JSON.parse(records.rs_profiles_v1);
    const data = { ...structuredClone(registry.profiles[IDS[1]].data), profile_care_grade_today: '3', profile_care_form_today: 'home-support',
        profile_care_progression: 'usual', profile_care_home_costs_monthly: own, ...sim };
    registry.profiles[OUTSIDE] = { ...structuredClone(registry.profiles[IDS[1]]), data };
    Object.assign(registry.profiles[OUTSIDE].meta, { id: OUTSIDE, name: 'Muster außen', belongsToHousehold: false });
    records.rs_profiles_v1 = JSON.stringify(registry);
    for (const key of Object.keys(records)) if (/^(profile_|sim_pflege)/.test(key)) delete records[key];
    Object.assign(records, data, { rs_current_profile: OUTSIDE, rs_active_profile: OUTSIDE });
    return records;
}

/** Rechnung: Simulator für das Einzelprofil mit seinem eigenen Plan (profileId), erstes Jahr, Pflegezusatz zu Hause je Monat. */
function simulatorMonthly(records) {
    const { storage } = countingStorage(records);
    const registry = JSON.parse(records.rs_profiles_v1), plan = readSimulatorHouseholdPlan({ storage, profileId: OUTSIDE });
    assertEqual(plan.status, 'valid', 'Referenz: bestätigter Einzelplan der Außenperson');
    const planValues = plan.entry.values;
    const inputs = combineSimulatorProfiles([{ profileId: OUTSIDE, name: 'Muster außen',
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[OUTSIDE].data, { storage, referenceYear: 2026, planValues }) }], OUTSIDE, { planValues }).combined;
    return fixedCareTodayForYear(inputs, initMcRunState(inputs), 0).careFloorAddition / 12;
}

/** Karte: Pflegeband der geöffneten Person mit denselben Werten im Formular. */
function cardLine(records, own) {
    const { storage, counts } = countingStorage(records);
    const nodes = { profileCareGradeToday: { value: '3' }, profileCareFormToday: { value: 'home-support' }, profileCareHomeCostsMonthly: { value: own },
        profileCareAllowanceSummary: {} };
    syncManagerCareToday({ getElementById: id => nodes[id] ?? null }, storage);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Pflegeband liest ohne Schreiben');
    return plain(nodes.profileCareAllowanceSummary.textContent);
}

// Fall 1: eigener Wert leer, Staffel 1.500 €/Monat, Regionalzuschlag 20 % → 1.800 €/Monat.
{
    const records = outsideRecords({ sim: { sim_pflegeRegionalZuschlag: '20' } });
    const reference = simulatorMonthly(records);
    assertClose(reference, 1800, 1e-6, 'Rechnung Fall 1: Staffel 1.500 € × 1,2');
    const line = cardLine(records, '');
    assert(line.startsWith(`Angesetzt: ${euro(reference)} Staffel für Grad 3`), `Fall 1: Karte wie Rechnung (${line})`);
}

// Fall 2: eigener Wert 500 €/Monat, Grundbedarf 36.000 €/Jahr, Pflege-Floor 36.100 €/Jahr → 8,33 €/Monat (gerundet 8 €).
{
    const records = outsideRecords({ own: '500', sim: { sim_pflegeMaxFloor: '36100' } });
    const reference = simulatorMonthly(records);
    assertClose(reference, 100 / 12, 1e-6, 'Rechnung Fall 2: Deckel 36.100 € − Grundbedarf 36.000 € = 100 €/Jahr');
    const line = cardLine(records, '500');
    assert(line.startsWith(`Angesetzt: ${euro(reference)} eigener Wert`), `Fall 2: Karte wie Rechnung (${line})`);
}

// Gegenprobe Haushaltsmitglied mit Zuschlag: Werner Grad 3 zu Hause, Staffel 1.500 €, Zuschlag 20 % → 1.800 €/Monat.
{
    const records = pfa2Records({ care: [null, { grade: 3, form: 'home-support' }], sim: { sim_pflegeRegionalZuschlag: '20' } }).records;
    const registry = JSON.parse(records.rs_profiles_v1);
    Object.assign(records, registry.profiles[IDS[1]].data, { rs_current_profile: IDS[1], rs_active_profile: IDS[1] });
    const { storage, counts } = countingStorage(records);
    const nodes = { profileCareGradeToday: { value: '3' }, profileCareFormToday: { value: 'home-support' }, profileCareHomeCostsMonthly: { value: '' }, profileCareAllowanceSummary: {} };
    syncManagerCareToday({ getElementById: id => nodes[id] ?? null }, storage);
    assert(plain(nodes.profileCareAllowanceSummary.textContent).startsWith('Angesetzt: 1.800 €/Monat Staffel für Grad 3'), `Haushaltsmitglied mit Zuschlag: ${plain(nodes.profileCareAllowanceSummary.textContent)}`);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Haushaltsmitglied: liest ohne Schreiben');
}

// UR-1d (Codex-Fall): Haushalt 36.000 €, Einzelplan der Außenperson 12.000 €, Floor 36.100 €, eigener Wert 500 € → 500 €/Monat.
{
    const records = outsideRecords({ own: '500', sim: { sim_pflegeMaxFloor: '36100' }, floor: 12000 });
    const reference = simulatorMonthly(records);
    assertClose(reference, 500, 1e-6, 'Rechnung UR-1d: Einzelplan 12.000 € lässt unter dem Deckel 36.100 € Platz für 500 €/Monat');
    const line = cardLine(records, '500');
    assert(line.startsWith(`Angesetzt: ${euro(reference)} eigener Wert`), `UR-1d: Karte rechnet mit dem Einzelplan der Außenperson (${line})`);
    const none = cardLine(outsideRecords({ own: '500', sim: { sim_pflegeMaxFloor: '36100' }, floor: null }), '500');
    assert(none.startsWith('Angesetzt: eigener Wert') && !/\d €\/Monat eigener Wert/.test(none), `Ohne bestätigten Einzelplan keine Betragszeile (${none})`);
}

// UR-1d: Zwei namensgleiche Profile im Pflegehinweis; nur die geöffnete Person (Profil-ID) entfällt.
{
    const host = () => ({ hidden: true, html: '', set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; }, replaceChildren() { this.html = ''; } });
    const persons = [{ profileId: 'alex_1', name: 'Alex', grade: 3, residential: false, own: false, monthly: 1500 },
        { profileId: 'alex_2', name: 'Alex', grade: 2, residential: false, own: false, monthly: 500 }];
    const card = host();
    renderCareHint(card, { done: false, persons }, { except: 'alex_1' });
    const text = plain(card.html);
    assert(!text.includes('1.500 €/Monat') && text.includes('Pflege Alex: 500 €/Monat'), `Namensgleiche andere Person bleibt im Hinweis (${text})`);
    const records = pfa2Records({ care: [{ grade: 2, form: 'family' }, { grade: 3, form: 'home-support' }] }).records;
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) registry.profiles[id].meta.name = 'Alex';
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[IDS[1]].data, { rs_current_profile: IDS[1], rs_active_profile: IDS[1] });
    const hosts = { profileCareHint: Object.assign(host(), { id: 'profileCareHint' }), managerPlanCareHint: Object.assign(host(), { id: 'managerPlanCareHint' }) };
    const { storage, counts } = countingStorage(records);
    refreshCareHints({ getElementById: id => hosts[id] || null }, { storage });
    const onCard = plain(hosts.profileCareHint.html), onPlan = plain(hosts.managerPlanCareHint.html);
    assert(!onCard.includes('Pflege Alex: 1.500 €/Monat') && onCard.includes('Pflege Alex: 500 €/Monat') && onPlan.includes('Pflege Alex: 1.500 €/Monat'),
        `Personenkarte: nur die geöffnete Alex entfällt (${onCard})`);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Hinweise lesen ohne Schreiben');
}

// Nicht verlässlich berechenbar (Formular weicht vom gespeicherten Stand ab): keine Betragszeile statt einer falschen.
{
    const records = outsideRecords({ sim: { sim_pflegeRegionalZuschlag: '20' } });
    const line = cardLine(records, '250');
    assert(line.startsWith('Angesetzt: eigener Wert') && !/\d €\/Monat eigener Wert/.test(line), `Ungespeicherter eigener Wert: ohne Betrag (${line})`);
}
setAppTestDate(null);
