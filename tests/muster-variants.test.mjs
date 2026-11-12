import { readGU1References } from './helpers/gu-1-expectations.mjs';
// LE-1 (FR-75) und KO-2 (Ergänzung FR-76) in einem Leser; Paare, die beide ändern, sind für den vereinten Stand gemessen.
import { readLE1KO2References } from './helpers/le-1-ko-2-expectations.mjs';
import { withoutExampleNeeds } from './helpers/ff-3-expectations.mjs';
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2EReferences } from './helpers/vf-2e-expectations.mjs';
import { readGA2References } from './helpers/ga-2-expectations.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createMusterHaushaltRecords as create } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE, musterVarianten } from '../app/demo/muster-haushalte.js';
import { musterSteckbrief } from '../app/demo/muster-steckbrief.js';
import { readImmobilien, IMMOBILIEN_KEY } from '../app/profile/profile-immobilien.js';
import { incomeFromRecord, effectiveIncomeFromRecord, fixedMonthlyIncome } from '../app/profile/profile-income.js';
import { projectPersonPension } from '../app/profile/profile-person-data.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
const date = '2026-10-23', stateKey = 'ruhestandsmodellValues_v29_guardrails';
const plan = records => Object.values(JSON.parse(records.household_plan_v1).entries)[0].values;
const profiles = records => Object.values(JSON.parse(records.rs_profiles_v1).profiles);
const before = JSON.parse(fs.readFileSync(new URL('./fixtures/mu-2-households-before.json', import.meta.url)));
const previousTZ = process.env.TZ;
try {
    process.env.TZ = 'Europe/Berlin';
    for (const [id, hash] of Object.entries(before)) assertEqual(createHash('sha256').update(JSON.stringify(withoutExampleNeeds(create(date, id)))).digest('hex'), readLE1KO2References(readGU1References(readGA2References(readQSCReferences(readVF2EReferences(hash))))), `${id}: vollständige Records, Drei-Töpfe-Korrekturen gesondert belegt`);
} finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
const mp = create(date, 'martin-petra'), [martin, petra] = profiles(mp);
for (const [person, birth, pensionStart, pension, cash, equity] of [
    [martin, '1959-02-20', '2024-03-01', 2300, 100000, 500000],
    [petra, '1964-06-15', '2031-06-01', 1200, 30000, 70000]]) {
    const d = person.data, lots = JSON.parse(d.depot_tranchen);
    assertEqual(d.profile_geburtsdatum, birth, 'Genaues Geburtsdatum');
    assertEqual(d.profile_rentenbeginn, pensionStart, 'Genauer Rentenbeginn');
    assertEqual(Number(d.profile_rente_monatlich), pension, 'Nettorente');
    assertEqual(Number(d.profile_tagesgeld), cash, 'Eigenes Tagesgeld');
    assertClose(lots.reduce((s, l) => s + l.marketValue, 0), equity, 1e-7, 'Eigener ETF-Bestand');
    assert(lots.every(l => l.category === 'equity'), 'Keine Anleihen oder Gold');
}
assertClose(JSON.parse(martin.data.depot_tranchen).reduce((s, l) => s + l.costBasis, 0), 300000, 1e-7, 'Martins Einstand 300.000 Euro');
assertEqual(JSON.stringify(plan(mp).decumulation), JSON.stringify({ mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }), 'Standard ohne Anleihen-/Goldkonflikt');
assertEqual([plan(mp).floorBedarf, plan(mp).flexBedarf, plan(mp).minimumFlexAnnual].join(), '36000,12000,3000', 'Dreiteiliger Bedarf');
assertEqual(JSON.stringify(JSON.parse(mp.household_partnership_v1)), JSON.stringify({ schemaVersion: 1, status: 'unmarried', inheritance: { muster_martin: 0, muster_petra: 0 }, homeAndTaxInheritance: { muster_martin: true, muster_petra: true } }), 'Beide erben Immobilien und Steuergeld, 0 % vom Rest');
assertEqual(readImmobilien(martin.data[IMMOBILIEN_KEY])[0].wert, 600000, 'Martins Haus');
const [rental] = readImmobilien(petra.data[IMMOBILIEN_KEY]);
assertEqual([rental.wert, rental.mieteNetto, rental.anpassung].join(), '240000,600,inflation', 'Petras vermietete Wohnung');
assertEqual(incomeFromRecord(petra.data).length, 1, 'Nur Gehalt gespeichert');
assertEqual(effectiveIncomeFromRecord(petra.data).filter(e => e.bezeichnung.startsWith('Miete')).length, 1, 'Miete genau einmal abgeleitet');
assertEqual(fixedMonthlyIncome(incomeFromRecord(petra.data), '2031-05'), 2200, 'Gehalt bis Mai 2031');
assertEqual(fixedMonthlyIncome(incomeFromRecord(petra.data), '2031-06'), 0, 'Kein Gehalt ab Juni 2031');
assertEqual(projectPersonPension(petra.data, 2031).renteImJahr, 1200 * 7, 'Rente Juni bis Dezember: sieben Monate');

// Vollständiger Vergleich aller nicht betroffenen Records und Teilrecords.
function unchangedProjection(records, id) {
    const r = structuredClone(records), registry = JSON.parse(r.rs_profiles_v1);
    delete r.rs_household_wealth_captures_v1; // Varianten ändern diese abgeleiteten Personen- und Haushaltssummen.
    const personal = data => {
        const d = { ...data }, state = JSON.parse(d[stateKey]);
        if (id === 'renate') {
            delete d.depot_tranchen; delete d.profile_wealth_history_lots_v1;
            for (const inputs of [state.inputs, state.profilverbundHouseholdInputs]) for (const k of ['geldmarktEtf', 'depotwertAlt', 'depotwertNeu']) delete inputs[k];
            delete state.wealthHistory;
        }
        if (id === 'max-erika') delete d[IMMOBILIEN_KEY];
        if (id === 'jan-lena') for (const inputs of [state.inputs, state.profilverbundHouseholdInputs]) delete inputs.minimumFlexAnnual;
        if (id === 'helga-werner') {
            delete d[IMMOBILIEN_KEY]; delete d.profile_care_grade_today; delete d.profile_care_form_today;
            for (const inputs of [state.inputs, state.profilverbundHouseholdInputs]) delete inputs.floorBedarf;
        }
        if (id === 'sophie') delete d.profile_einkuenfte_v1;
        if (['max-erika', 'jan-lena', 'helga-werner'].includes(id)) {
            const summaries = JSON.parse(d.overview_balance_summary_v1);
            for (const entry of Object.values(summaries.entries)) { delete entry.monthlyBudget; delete entry.monthlyWithdrawal; }
            d.overview_balance_summary_v1 = JSON.stringify(summaries);
        }
        d[stateKey] = JSON.stringify(state); return d;
    };
    for (const p of Object.values(registry.profiles)) p.data = personal(p.data);
    r.rs_profiles_v1 = JSON.stringify(registry);
    const root = personal(r);
    const values = JSON.parse(root.household_plan_v1);
    for (const entry of Object.values(values.entries)) {
        if (id === 'renate') delete entry.values.decumulation.mode;
        if (id === 'jan-lena') delete entry.values.minimumFlexAnnual;
        if (id === 'helga-werner') delete entry.values.floorBedarf;
    }
    root.household_plan_v1 = JSON.stringify(values);
    if (id === 'renate') delete root.rs_daily_prices_v1;
    if (['max-erika', 'renate', 'jan-lena', 'helga-werner'].includes(id)) delete root.annual_plan_record_v1; // neu berechneter Jahresbeleg
    if (id === 'helga-werner') {
        delete root.balance_expenses_v1; delete root.sim_pflegeStufe3Form; // Kategorien folgen dem neuen Grundbedarf
    }
    if (['jan-lena', 'helga-werner'].includes(id)) {
        const needs = JSON.parse(root.household_simulator_needs_v1);
        delete needs.values[id === 'jan-lena' ? 'minimumFlexAnnual' : 'startFloorBedarf']; root.household_simulator_needs_v1 = JSON.stringify(needs);
    }
    if (id === 'martin-petra') delete root.household_partnership_v1;
    return JSON.stringify(root);
}
for (const h of MUSTER_HAUSHALTE) for (const v of musterVarianten(h.id)) {
    const base = create(date, h.id), r = create(date, h.id, v.id), ps = profiles(r), p = plan(r);
    const brief = musterSteckbrief(r, h.id, date, v.id, v.id === 'grund' ? null : base), n = brief.numbers;
    assertClose(n.wealth, ps.reduce((s, person) => s + Number(person.data.profile_tagesgeld) + JSON.parse(person.data.depot_tranchen).reduce((s, l) => s + l.marketValue, 0), 0), 1e-7, `${h.id}/${v.id}: Steckbrief-Geld aus Records`);
    assertEqual(n.totalNeed, p.floorBedarf + p.flexBedarf, `${h.id}/${v.id}: Bedarf aus Records`);
    if (v.id === 'immobilien') {
        const homes = ps.flatMap(person => readImmobilien(person.data[IMMOBILIEN_KEY]));
        assertEqual(homes.reduce((sum, home) => sum + home.wert, 0), 660000, 'Max/Erika: Haus und Mietwohnung zusammen 660.000 Euro');
        assertEqual(homes.find(home => home.nutzung === 'vermietet').mieteNetto, 650, 'Neue Variante: 650 Euro Nettomiete, im Einkommen genau einmal abgeleitet');
        assertEqual(n.wealth, musterSteckbrief(base, h.id, date).numbers.wealth, 'Die neue Variante verändert das anfängliche Geldvermögen nicht');
    }
    if (v.id === 'grund') continue;
    assert(brief.changes.length > 0, 'Variante erklärt Abweichungen');
    // AR-3: Die Marktvariante ändert absichtlich alle Spielkurse und davon abgeleitete Bestände; die Planwerte bleiben die des Grundfalls.
    if (v.id === 'kurssturz') { assertEqual(JSON.stringify(p), JSON.stringify(plan(base)), 'max-erika/kurssturz: Planwerte wie im Grundfall'); continue; }
    // WT-1: Die Variante trägt eingetragene Planverkäufe; Planwerte und Jahresplan bleiben die des Grundfalls.
    if (v.id === 'teilweise') { assertEqual(JSON.stringify(p), JSON.stringify(plan(base)), 'max-erika/teilweise: Planwerte wie im Grundfall'); continue; }
    assert(unchangedProjection(r, h.id) === unchangedProjection(base, h.id), `${h.id}/${v.id}: alle übrigen Daten bytegleich`);
    if (v.id === 'klein') {
        assertEqual([n.cash, n.depot, n.bonds, n.gold].map(Math.round).join(), '15000,75000,0,0', 'Renate: kleines Vermögen');
        assertEqual(p.decumulation.mode, 'standard', 'Renate: Standard');
    }
    if (v.id === 'halten') assertEqual(p.minimumFlexAnnual, 27000, 'Jan/Lena: voller Mindest-Flex');
    if (v.id === 'haus-pg3') {
        assertEqual(n.propertyValue, 450000, 'Helga/Werner: Hauswert');
        assert(ps.every(p => readImmobilien(p.data[IMMOBILIEN_KEY])[0].wert === 225000), 'Je eine Hälfte');
        assertEqual(ps[1].data.profile_care_grade_today, '3', 'Werner: PG3');
        assertEqual(r.sim_pflegeStufe3Form, 'home-support', 'Grad 3: externe Unterstützung zu Hause');
        assertEqual(ps[1].data.profile_care_form_today, 'family', 'Werner heute: Angehörige mit Pflegegeld');
        // FR-73 (PFA-3): Grundbedarf ohne Pflege; die App rechnet Werners 18.000 € selbst dazu (Sollfall A).
        assertEqual(n.floor, 36000, 'Grundbedarf 36.000 € ohne Pflege');
        assertEqual(n.careToday, 18000, 'Heutige Pflegekosten aus der gemeinsamen Bedarfsfunktion');
        assertEqual(n.totalNeed, 48000, 'Gesamtbedarf 48.000 ohne Pflege');
        assertEqual(brief.metrics[2].sub, 'rechnet die App selbst dazu', 'Pflegekachel erklärt die automatische Rechnung');
        assert(brief.changes.includes('bleibt 36.000 € ohne Pflege') && brief.changes.includes('18.000 €'), 'Variante erklärt den unveränderten Grundbedarf und die Pflegekosten');
    }
    if (v.id === 'teilzeit') {
        const income = incomeFromRecord(ps[0].data);
        assertEqual(income.length, 2, 'Sophie: zwei befristete Zeilen');
        assertEqual([income[0].betragMonat, income[0].bis, income[1].betragMonat, income[1].ab, income[1].bis].join(), '3400,2032-12,2600,2033-01,2037-12', 'Teilzeitgrenzen genau');
        assertEqual(n.displaySurplus, 1200, 'Teilzeitüberschuss aus Daten');
    }
    if (['hundert', 'ehe'].includes(v.id)) {
        const partner = JSON.parse(r.household_partnership_v1);
        assert(Object.values(partner.inheritance).every(x => x === 100), 'Beide 100 %');
        assertEqual(partner.status, v.id === 'ehe' ? 'married' : 'unmarried', 'Richtige Partnerschaft');
    }
}
const previous = { document: globalThis.document, window: globalThis.window };
try {
    const inputs = await measurementInputs(0, 'martin-petra', date);
    assertEqual(inputs.fixedIncome.filter(e => e.bezeichnung.startsWith('Miete')).length, 1, 'Simulator erhält Miete genau einmal');
    const rentInputs = { ...inputs, fixedIncome: inputs.fixedIncome.filter(e => e.bezeichnung.startsWith('Miete')) };
    const state = initMcRunState(inputs), survivor = { deceasedProfileId: 'muster_petra', survivorProfileId: 'muster_martin' };
    const household = { p1Alive: true, p2Alive: false };
    const options = { inputs: rentInputs, state: { ...state, survivor }, household, deathThisYear: false, yearIndex: 1, inflationFactor: 1.02 };
    const inherited = calculateFixedIncomeForYear(options);
    assertClose(inherited.total, 600 * 12 * 1.02, 1e-7, 'Produktiver Haushaltsweg: geerbte Wohnung liefert volle fortgeschriebene Miete');
    assertEqual(inherited.persons.find(p => p.amount > 0).profileId, 'muster_martin', 'Miete geht an Martin');
    const external = { ...rentInputs, partnership: { status: 'unmarried', inheritance: { muster_petra: 0 } } };
    assertEqual(calculateFixedIncomeForYear({ ...options, inputs: external }).total, 0, 'Wohnung bei anderen Erben: Miete endet');
    const sold = { ...options.state, portfolio: { ...state.portfolio, homeSales: [JSON.stringify(['muster_petra', rental.id])] } };
    assertEqual(calculateFixedIncomeForYear({ ...options, state: sold }).total, 0, 'Verkaufte Wohnung: Miete endet');
    // Jahrespfad: keine zweite Pflegeausgabe für den heutigen Grad.
    const careInputs = await measurementInputs(0, 'helga-werner', date, 'haus-pg3');
    const result = simulateOneYear(initMcRunState(careInputs), careInputs,
        { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Pflegevariante rechnet');
    assertEqual(result.logData.floor_brutto, 54000, 'FR-73 Sollfall A: Grundbedarf 36.000 € ohne Pflege plus 18.000 € heutige Pflege zu Hause');
} finally { P.resetPersistenceForTests(); setAppTestDate(null); Object.assign(globalThis, previous); }
