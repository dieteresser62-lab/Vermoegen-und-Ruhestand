import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { PARTNERSHIP_KEY, readPartnership, testamentEstate } from '../app/profile/household-partnership.js';
import { lifetimeUseMultiplier } from '../app/shared/life-expectancy.js';
import { HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { homeWasSold, inheritedHomeShare, sellHomesForEmergency } from '../app/simulator/simulator-home-sale.js';
import { updateCareMeta } from '../app/simulator/simulator-engine-helpers.js';

const rule = { home: 'rent-bequest', monthlyRent: 1500 };
const record = (status, testament = rule) => ({
    schemaVersion: 1, status, maritalPropertyRegime: 'separation', inheritance: {},
    marriedInheritance: { muster_helga: 0 }, testament: { muster_helga: testament }
});
const validationMessage = 'Bitte die monatliche Miete für die überlebende Person eintragen.';
for (const monthlyRent of [undefined, 0, -1500, '1500']) {
    let error;
    try { readPartnership(record('married', { ...rule, monthlyRent })); } catch (caught) { error = caught; }
    assertEqual(error?.message, validationMessage, 'Neuer Modus erfordert einen positiven Monatsbetrag');
}
assertEqual(readPartnership(record('married')).testament.muster_helga.monthlyRent, 1500, 'Neuer Modus akzeptiert 1.500 Euro');

const base = await measurementInputs(0, 'helga-werner', HANDBOOK_MUSTER_DATE, 'haus-pg3', records => ({
    ...records, [PARTNERSHIP_KEY]: JSON.stringify(record('unmarried'))
}));
const alive = { p1Alive: false, p2Alive: true };
const inCare = { ...alive, care: { p2: { active: true, grade: 4, heimJahr: 1, careForm: 'residential' } } };
const run = (inputs, state = initMcRunState(inputs), index = 0, household = alive, inflation = 0) =>
    simulateOneYear(state, inputs, { jahr: 2000, inflation, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        index, null, 0, household, 1, EngineAPI);
const inputsFor = (status, residenceTax) => ({
    ...base, partnership: readPartnership(record(status, { ...rule, residenceTax })),
    home: base.home.map(home => ({ ...home, wert: 60000, stand: `${base.homeReferenceYear}-01` }))
});
const expectedCapital = 18000 * lifetimeUseMultiplier(76, 'm');
assertEqual(lifetimeUseMultiplier(70, 'w', 2025), 11.107, 'JA-1: Ältere Stichtage verwenden die Tabelle 2026');
assertEqual(lifetimeUseMultiplier(70, 'w', 2026), 11.107, 'JA-1: Frau 70 im Jahr 2026');
assertEqual(lifetimeUseMultiplier(70, 'w', 2027), 11.179, 'JA-1: Frau 70 im Jahr 2027');
assertEqual(lifetimeUseMultiplier(70, 'm', 2030), 10.054, 'JA-1: Spätere Stichtage verwenden die jüngste Tabelle');
assertEqual(lifetimeUseMultiplier(0, 'm', 2027), 18.407, 'JA-1: Die Tabelle beginnt bei Alter 0');
{
    const inputs = { ...inputsFor('unmarried', 'immediate'), residenceReferenceYear: 2027,
        simulationPeople: base.simulationPeople.map((person, index) => index === 1 ? { ...person, geburtsdatum: '1951-01-01' } : person) };
    const state = initMcRunState(inputs);
    const value = yearData => simulateOneYear(structuredClone(state), inputs, yearData, 0, null, 0, alive, 1, EngineAPI).logData.inheritance.residenceCapital;
    const market = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
    assertClose(value(market), 18000 * 8.057, 1e-7, 'JA-1: Monte Carlo nimmt das modellierte Todesjahr, nicht das gezogene Marktjahr');
    assertClose(value({ ...market, jahr: 2026, temporal: { simulationYear: 2026 } }), expectedCapital, 1e-7,
        'JA-1: Ein historisches Todesjahr verwendet die historische Stichtagsregel');
}
for (const status of ['married', 'unmarried']) {
    for (const residenceTax of ['immediate', 'annual']) {
        const inputs = inputsFor(status, residenceTax);
        const death = run(inputs), estate = death.logData.inheritance;
        assertEqual(death.kind, 'success', 'Todesjahr vollständig berechnet');
        assertEqual(inputs.home.filter(home => home.id === 'muster-haus').length, 2, 'Beide Hausanteile haben die Demo-Objektkennung');
        assertEqual(death.logData.immobilien_selbst_end, 60000, 'Der eigene Anteil am Musterhaus bleibt mit vollem Wert erhalten');
        assertEqual(death.newState.portfolio.homeSales.length, 1, 'Nur der Anteil der verstorbenen Person wird verkauft');
        assertEqual(death.logData.rente_aus_erbe, undefined, 'Zahlung beginnt im Folgejahr');
        assertEqual(death.logData.miete_aus_erbe, undefined, 'Miete beginnt im Folgejahr');
        assertEqual(death.logData.wohnrechtsteuer, undefined, 'Keine Vorauszahlung im Todesjahr');
        assertClose(estate.residenceCapital, expectedCapital, 1e-7, 'Kapitalwert aus 18.000 € ohne Deckel, Alter 76');
        assertEqual(testamentEstate(0, 60000, 60000, 100, rule, { status, partnerAge: 76 }).exemptHome, 0, 'Keine Familienheim-Befreiung');
        const immediateTax = status === 'married' ? 0 : Math.floor((expectedCapital - 20000) / 100) * 100 * .3;
        assertClose(estate.tax, residenceTax === 'annual' ? 0 : immediateTax, 1e-7, 'Sofortsteuer nach Steuerklasse I oder III');
        assertClose(death.logData.portfolio_flow_delta, 0, .05, 'Verkaufserlös fließt vollständig außerhalb des Haushalts');

        const first = run(inputs, death.newState, 1, alive, 2);
        const firstLog = first.logData;
        assertEqual(first.kind, 'success', 'Erstes Zahlungsjahr vollständig berechnet');
        assertEqual(firstLog.rente_aus_erbe, 18000, '1.500 Euro ergeben 18.000 Euro Einnahmen');
        assertEqual(firstLog.miete_aus_erbe, 18000, 'Miete kommt ungekürzt zum Grundbedarf');
        assertClose(firstLog.portfolio_flow_delta, 0, .05, 'Rente und Miete sind vollständig bilanziert');
        if (residenceTax === 'immediate') {
            const withoutPayment = structuredClone(death.newState);
            delete withoutPayment.portfolio.rentBequest;
            const comparison = run(inputs, withoutPayment, 1, alive, 2).logData;
            assertEqual(firstLog.floor_brutto - comparison.floor_brutto, 18000, 'Miete erhöht den Grundbedarf um volle 18.000 Euro');
            assertEqual(firstLog.entscheidung.jahresEntnahme, comparison.entscheidung.jahresEntnahme, 'Rente deckt die Miete vollständig');
        }
        const second = run(inputs, first.newState, 2);
        assertClose(second.logData.rente_aus_erbe, 18360, 1e-7, 'Rente folgt der Inflation seit Planstart');
        assertClose(second.logData.miete_aus_erbe, 18360, 1e-7, 'Miete folgt derselben Inflation');
        const breakdown = protocolCashflowBreakdown(firstLog, { inputs });
        assert(breakdown.incomes.some(row => row.label === 'Rente aus dem Erbe · Werner' && row.amount === 18000), 'Einnahmen-ⓘ nennt die Rente und den Profilnamen');
        assert(breakdown.expenses.some(row => row.label === 'Miete aus dem Erbe' && row.amount === 18000), 'Ausgaben-ⓘ nennt die Miete');
        if (residenceTax === 'annual') {
            assertEqual(estate.residenceTax.rate, status === 'married' ? 0 : .3, 'Jahressteuersatz aus dem Gesamterwerb');
            assertEqual(firstLog.wohnrechtsteuer, 0, 'Freibetrag deckt das erste volle Zahlungsjahr');
            assertClose(second.logData.wohnrechtsteuer, status === 'married' ? 0 : 4800, 1e-7, 'Zweiter Jahreswert verbraucht die restlichen 2.000 Euro');
            const care = run(inputs, second.newState, 3, inCare);
            assertClose(care.logData.rente_aus_erbe, 18360, 1e-7, 'Im Heim läuft die Rente weiter');
            assertEqual(care.logData.miete_aus_erbe, 0, 'Mit Heimpflege endet die Miete');
            assertClose(care.logData.wohnrechtsteuer, status === 'married' ? 0 : 5400, 1e-7, 'Steuer läuft im Heim auf unveränderter Jahresbasis weiter');
            const afterCare = run(inputs, care.newState, 4);
            assertEqual(afterCare.logData.miete_aus_erbe, 0, 'Miete bleibt nach dauerhafter Heimpflege beendet');
            const last = run(inputs, care.newState, 4, { p1Alive: false, p2Alive: false });
            assertEqual(last.logData.rente_aus_erbe, undefined, 'Tod beendet Rente');
            assertEqual(last.logData.wohnrechtsteuer, undefined, 'Tod beendet Jahressteuer');
            const html = renderProtocolTable([death.logData, firstLog, second.logData], { source: 'mc', inputs });
            assert(html.includes('Erbschaftsteuer jährlich (§ 23)') && html.includes('Kapitalwert der Rente aus dem Erbe'), 'Steuerdetails benennen die Rente');
        }
    }
}

const inputs = inputsFor('unmarried', 'annual');
const savingInputs = { ...inputsFor('married', 'immediate'), accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 5 };
const savingDeath = run(savingInputs);
const rentSaving = run(savingInputs, savingDeath.newState, 1);
const noRentState = structuredClone(savingDeath.newState);
delete noRentState.portfolio.rentBequest;
const noRentSaving = run(savingInputs, noRentState, 1);
assertEqual(rentSaving.logData.rente_aus_erbe, 18000, 'ER-1: Die Rente fließt im Ansparjahr');
assertEqual(rentSaving.logData.floor_brutto, 18000, 'ER-1: Die gleich hohe Miete steht im Grundbedarf des Ansparjahrs');
assertClose(rentSaving.logData.portfolio_active_end, noRentSaving.logData.portfolio_active_end, .05,
    'ER-1: Rente und Miete gleichen sich im Ansparjahr aus');
const deathInCare = run(inputs, undefined, 0, inCare, 2);
assertClose(deathInCare.logData.inheritance.residenceTax.annualValue, 18360, 1e-7, 'Heim im Todesjahr lässt Steuer auf inflationiertem Jahreswert bestehen');
const firstInCare = run(inputs, deathInCare.newState, 1, inCare);
assertClose(firstInCare.logData.rente_aus_erbe, 18360, 1e-7, 'Rente entsteht auch bei Heimpflege im Todesjahr');
assertEqual(firstInCare.logData.miete_aus_erbe, 0, 'Bei Heimpflege im Todesjahr beginnt keine Miete');
const saving = run({ ...inputs, accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 5 },
    deathInCare.newState, 1, inCare);
assertClose(saving.logData.rente_aus_erbe, 18360, 1e-7, 'Die Rente fließt auch im Ansparpfad');
assertEqual(saving.logData.miete_aus_erbe, 0, 'Keine Miete im Heim während der Ansparphase');
assertClose(saving.logData.portfolio_flow_delta, 0, .05, 'Die Ansparphase bilanziert den Zufluss im Heim');
const sold = initMcRunState(inputs);
sold.portfolio.homeSales = inputs.home.map(home => JSON.stringify([home.profileId, home.id]));
assertEqual(run(inputs, sold).newState.portfolio.rentBequest, undefined, 'Ein früherer Verkauf löst kein Rentenvermächtnis aus');

const acute = { ...inputs, pflegeModellTyp: 'akut' };
const acuteDeath = run(acute, undefined, 0, inCare);
assertEqual(run(acute, acuteDeath.newState, 1, inCare).logData.miete_aus_erbe, 18000, 'Bei akuter Heimpflege läuft die Miete weiter');
// Pflege zum Planstart endet auch im Akutmodell nie. Ein späteres Heim nach häuslicher Pflege ist daher dauerhaft.
const acuteCare = initialGrade => updateCareMeta({ active: true, initialGrade, initialProgressionFactor: 1, grade: 4,
    currentYearInCare: 5, durationYears: 1 }, { ...acute, pflegefallLogikAktivieren: true }, 80, {}, () => .99, {}, 5, true).active;
assertEqual([acuteCare(0), acuteCare(2)].join(), 'false,true', 'Akutdauer beendet nur neu gezogene Pflege');
const acuteWithHomeCare = { ...acute, partner: { ...acute.partner, careToday: { grade: 2, form: 'home-support' } } };
const homeCareAtStart = { ...inCare, care: { p2: { ...inCare.care.p2, initialGrade: 2 } } };
const deathAfterHomeCare = run(acuteWithHomeCare, undefined, 0, homeCareAtStart);
assertEqual(deathAfterHomeCare.newState.portfolio.rentBequest.rentEnded, true, 'Heim nach häuslicher Pflege zum Planstart beendet die Miete auch im Akutmodell');
assertEqual(run(acuteWithHomeCare, deathAfterHomeCare.newState, 1).logData.miete_aus_erbe, 0, 'Die beendete Miete beginnt nicht wieder');

const stillOwned = {
    ...inputs,
    partnership: { ...inputs.partnership, inheritance: { muster_helga: 50 } },
    home: [...inputs.home, { ...inputs.home[0], id: 'mietwohnung', nutzung: 'vermietet', wert: 40000 }]
};
assertEqual(run(stillOwned).logData.immobilien_vermietet_end, 20000, 'Vermietetes Eigentum folgt der regulären Geldquote');

const initial = initMcRunState(stillOwned);
const survivor = { deceasedProfileId: 'muster_helga', survivorProfileId: 'muster_werner' };
const [deceasedHome, ownHome, rentedHome] = stillOwned.home;
assertEqual(inheritedHomeShare(stillOwned, initial.portfolio, survivor, deceasedHome, 0), 0, 'Ohne gebuchten Nachlass zählt der Hausanteil der verstorbenen Person mit 0');
assertEqual(inheritedHomeShare(stillOwned, initial.portfolio, survivor, ownHome, 1), 1, 'Ohne gebuchten Nachlass zählt der eigene Hausanteil voll');
assertEqual(inheritedHomeShare(stillOwned, initial.portfolio, survivor, rentedHome, 2), .5, 'Ohne gebuchten Nachlass gilt für die Mietwohnung die Geldquote');

const beforeSale = initMcRunState(inputs);
const sale = sellHomesForEmergency({ portfolio: beforeSale.portfolio, state: beforeSale, inputs, household: alive,
    yearIndex: 0, inflationFactor: 1, beforeRuin: true, maxSales: 1 });
assertEqual(sale?.immobilienverkauf_personen[0].profileId, survivor.survivorProfileId, 'Im Todesjahr kann die überlebende Person ihren eigenen Anteil am Musterhaus verkaufen');
assertEqual(sale?.immobilienverkauf, 54000, 'Der eigene Notverkauf liefert den Erlös für genau einen Anteil');
assertEqual(homeWasSold(beforeSale.portfolio, deceasedHome, 0), false, 'Der Anteil der verstorbenen Person bleibt bis zur Nachlassbuchung gesperrt');

const mixed = { ...stillOwned, partnership: { ...inputsFor('married', 'immediate').partnership, marriedInheritance: { muster_helga: 50 } } };
const mixedDeath = run(mixed).logData;
assertEqual(mixedDeath.inheritance.inheritedHome, 20000, 'Im Mischbestand erbt die überlebende Person einen Anteil an der Mietwohnung');
assert(!renderProtocolTable([mixedDeath], { source: 'mc', inputs: mixed }).includes('Familienheim-Befreiung angenommen'), 'Im Mischbestand mit Rentenvermächtnis erscheint keine Familienheim-Befreiung');
