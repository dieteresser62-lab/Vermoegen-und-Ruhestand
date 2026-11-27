import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { readPartnership, testamentEstate, testamentDescription, inheritancePreview, inheritanceTaxable, inheritanceTariff } from '../app/profile/household-partnership.js';
import { HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { protocolActionShortText, renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { testamentHomeFields } from '../app/tranches/tranchen-manager-testament.js';
import { INVALID_MOVE_OUT_YEARS } from '../app/profile/household-partnership.js';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';

// ER-2: „Verkauf mit Wohnkapital“. Erfundene Zahlen: Haus 400.000 €, je zur Hälfte; 30 % vom Nettoerlös; Miete 1.200 € im Monat.
const rule = { home: 'housing-capital', housingCapitalPercent: 30, monthlyRent: 1200 };
const record = (status, testament = rule) => ({
    schemaVersion: 1, status, maritalPropertyRegime: 'separation', inheritance: { muster_helga: 10 },
    marriedInheritance: { muster_helga: 50 }, testament: { muster_helga: testament }
});

assertEqual(JSON.stringify(readPartnership(record('married')).testament.muster_helga), JSON.stringify(rule),
    'Die Validierung kennt „Verkauf mit Wohnkapital“ mit Prozentsatz und Miete');
const message = testament => { try { readPartnership(record('married', testament)); return ''; } catch (error) { return error.message; } };
for (const housingCapitalPercent of [undefined, 0, .5, 101, '30', Number.NaN]) {
    assertEqual(message({ ...rule, housingCapitalPercent }), 'Bitte das Wohnkapital mit 1 bis 100 Prozent vom Nettoerlös eintragen.',
        'Wohnkapital ist Pflicht und liegt zwischen 1 und 100 %');
}
for (const monthlyRent of [undefined, 0, -1200, '1200']) {
    assertEqual(message({ ...rule, monthlyRent }), 'Bitte die monatliche Miete der überlebenden Person eintragen.', 'Monatsmiete ist Pflicht und positiv');
}
assertEqual(message({ ...rule, housingCapitalPercent: 1 }) + message({ ...rule, housingCapitalPercent: 100 }), '', 'Grenzwerte 1 und 100 % sind erlaubt');
assertEqual(testamentDescription(rule), 'Verkauf mit Wohnkapital 30 %, Miete 1.200 € im Monat', 'Kurzbeschreibung nennt Prozentsatz und Miete');
const fields = testamentHomeFields(0, rule);
assert(fields.includes('Wohnkapital in % vom Nettoerlös') && fields.includes('Monatliche Miete der überlebenden Person')
    && !fields.includes('data-testament="residenceTax"'), 'Nur Prozentsatz und Miete, keine Steuerwahl nach § 23');
assertEqual(testamentHomeFields(0, { home: 'money' }), '', 'Bei anderen Optionen keine Zusatzfelder');

// Geldvermächtnis: voller Betrag zum übrigen Erwerb, kein Kapitalwert, kein § 23, keine Familienheim-Befreiung.
for (const [status, taxable, tax] of [['married', 254000, 27940], ['unmarried', 734000, 220200]]) {
    for (const residenceTax of [undefined, 'annual']) {
        const estate = testamentEstate(700000, 200000, 200000, 100, { ...rule, residenceTax }, { status, partnerAge: 76 });
        assertClose(estate.housingCapital, 54000, 1e-6, 'Wohnkapital = 30 % von 90 % des Hausanteils');
        assertEqual(estate.residenceCapital, 0, 'Kein Kapitalwert');
        assertEqual(estate.exemptHome, 0, 'Keine Familienheim-Befreiung');
        assertEqual(estate.residenceTax, undefined, 'Keine Jahressteuer nach § 23');
        assertEqual(estate.taxable, taxable, `Steuerpflichtiger Erwerb aus Geld und Wohnkapital (${status})`);
        assertClose(estate.tax, tax, 1e-6, `Steuer nach dem Status (${status})`);
    }
}
const preview = inheritancePreview(100000, 200000, 0, { status: 'unmarried', selfUsedHome: 200000, testament: rule });
assertClose(preview.housingCapital, 54000, 1e-6, 'Vorschau rechnet das Wohnkapital');
assertClose(preview.tax, 10200, 1e-6, 'Vorschau besteuert das Wohnkapital nach Steuerklasse III');
assertClose(preview.remains, 43800, 1e-6, 'Wohnkapital nach Steuer bleibt im Haushalt');

const base = await measurementInputs(0, 'helga-werner', HANDBOOK_MUSTER_DATE, 'haus-pg3');
const alive = { p1Alive: false, p2Alive: true };
const inCare = { ...alive, care: { p2: { active: true, grade: 4, heimJahr: 1, careForm: 'residential' } } };
const run = (inputs, state = initMcRunState(inputs), index = 0, household = alive, inflation = 0) =>
    simulateOneYear(state, inputs, { jahr: 2000, inflation, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        index, null, 0, household, 1, EngineAPI);
const inputsFor = (status, testament = rule) => ({
    ...base, partnership: readPartnership(record(status, testament)),
    home: base.home.map(home => ({ ...home, wert: 200000, stand: `${base.homeReferenceYear}-01` }))
});
const cash = (result, profileId = 'muster_werner') => result.newState.portfolio.personAccounts.find(row => row.profileId === profileId).tagesgeld;

for (const status of ['married', 'unmarried']) {
    const inputs = inputsFor(status);
    const death = run(inputs), estate = death.logData.inheritance;
    assertEqual(death.kind, 'success', 'Todesjahr vollständig berechnet');
    assertEqual(estate.homeMode, 'housing-capital', 'Nachlass nennt die Option');
    assertClose(estate.housingCapital, 54000, 1e-6, 'Wohnkapital = 30 % × Nettoerlös im Todesjahr');
    assertEqual(estate.residenceCapital, 0, 'Kein Kapitalwert im Simulator');
    assertEqual(estate.exemptHome, undefined, 'Keine Familienheim-Befreiung im Simulator');
    assertEqual(death.logData.immobilien_selbst_end, 200000, 'Der eigene Hausanteil bleibt der überlebenden Person');
    assertEqual(death.newState.portfolio.homeSales.length, 1, 'Nur der Anteil der verstorbenen Person wird verkauft');
    assert(estate.inherited > 0, 'Es gibt einen übrigen Erwerb aus Geld');
    const taxable = inheritanceTaxable(estate.inherited + estate.housingCapital,
        { status, pensionAllowance: estate.pensionAllowance?.amount || 0 });
    assertEqual(estate.taxable ?? 0, taxable, 'Steuer auf Geldvermächtnis plus übrigen Erwerb');
    assertClose(estate.tax, inheritanceTariff(taxable, status).tax, 1e-6, 'Tarif nach dem Status');
    if (status === 'unmarried') assert(estate.tax > 0, 'Unverheiratet fällt Steuer an');
    assertClose(death.logData.portfolio_flow_delta, 0, .05, 'Wohnkapital ist als Zufluss bilanziert');
    assertEqual(death.logData.miete_nach_erbfall, undefined, 'Keine Miete im Todesjahr');
    if (status === 'married') {
        const doubled = run(inputsFor(status, { ...rule, housingCapitalPercent: 60 }));
        assertClose(cash(doubled) - cash(death), 54000, 1e-6, 'Das Wohnkapital liegt im Todesjahr auf dem Tagesgeld der überlebenden Person');
    }
    const html = renderProtocolTable([death.logData], { source: 'mc', inputs });
    assert(html.includes('Wohnkapital') && !html.includes('Familienheim-Befreiung angenommen'), 'Protokoll zeigt den Zufluss ohne Familienheim-Befreiung');

    const first = run(inputs, death.newState, 1, alive, 2), firstLog = first.logData;
    assertEqual(first.kind, 'success', 'Erstes Mietjahr vollständig berechnet');
    assertEqual(firstLog.miete_nach_erbfall, 14400, 'Miete beginnt im Folgejahr mit 12 × 1.200 €');
    assertEqual(firstLog.rente_aus_erbe, undefined, 'Keine Rente aus dem Erbe');
    const withoutRent = structuredClone(death.newState);
    delete withoutRent.portfolio.rentBequest;
    const comparison = run(inputs, withoutRent, 1, alive, 2).logData;
    assertEqual(firstLog.floor_brutto - comparison.floor_brutto, 14400, 'Miete erhöht den Grundbedarf');
    assertEqual(firstLog.sonstige_einkuenfte, comparison.sonstige_einkuenfte, 'Die Miete bringt keine Einnahme');
    const breakdown = protocolCashflowBreakdown(firstLog, { inputs });
    assert(breakdown.expenses.some(row => row.label === 'Miete nach Verkauf im Erbfall' && row.amount === 14400), 'Ausgaben-ⓘ nennt die Miete');
    assert(!breakdown.incomes.some(row => row.label.includes('Erbe')), 'Einnahmen-ⓘ ohne Erbzahlung');
    const second = run(inputs, first.newState, 2);
    assertClose(second.logData.miete_nach_erbfall, 14688, 1e-7, 'Miete folgt der Inflation seit Planstart');
    const care = run(inputs, second.newState, 3, inCare);
    assertEqual(care.logData.miete_nach_erbfall, 0, 'Bei dauerhafter Heimpflege endet die Miete');
    assertEqual(run(inputs, care.newState, 4).logData.miete_nach_erbfall, 0, 'Die Miete beginnt nach dem Heim nicht wieder');
}

const inputs = inputsFor('unmarried');
const deathInCare = run(inputs, undefined, 0, inCare);
assertEqual(deathInCare.logData.inheritance.housingCapital, undefined, '1825: Bei dauerhaftem Heim entfällt das Wohnkapital auch nach 0 Jahren');
assertEqual(run(inputs, deathInCare.newState, 1, inCare).logData.miete_nach_erbfall, undefined, 'Bei Heimpflege im Todesjahr beginnt keine Miete');
const immediateSavingInputs = { ...inputs, accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 5 };
const saving = run(immediateSavingInputs);
assertClose(saving.logData.inheritance.housingCapital, 54000, 1e-6, 'Wohnkapital auch in der Ansparphase');
assertClose(saving.logData.portfolio_flow_delta, 0, .05, 'Die Ansparphase bilanziert das Wohnkapital');
const immediateSaving = run(immediateSavingInputs, saving.newState, 1);
const noRentState = structuredClone(saving.newState);
delete noRentState.portfolio.rentBequest;
const noRentSaving = run(immediateSavingInputs, noRentState, 1);
const immediateExpenses = protocolCashflowBreakdown(immediateSaving.logData, { inputs: immediateSavingInputs }).expenses;
assertEqual(immediateSaving.logData.floor_brutto, 14400, 'Bei sofortigem Verkauf enthält der Grundbedarf im Ansparjahr die Miete');
assertClose(noRentSaving.logData.portfolio_active_end - immediateSaving.logData.portfolio_active_end, 14400, .05,
    'Die Miete geht im Ansparjahr vom Vermögen ab');
assert(immediateExpenses.some(row => row.label === 'Miete nach Verkauf im Erbfall' && row.amount === 14400)
    && !immediateExpenses.some(row => row.label === 'Grundbedarf' && row.amount < 0), 'Ausgaben-ⓘ zeigt die Miete ohne negativen Grundbedarf');
assertClose(immediateSaving.logData.portfolio_flow_delta, 0, .05, 'Die sofort beginnende Miete ist im Ansparjahr bilanziert');
const sold = initMcRunState(inputs);
sold.portfolio.homeSales = inputs.home.map(home => JSON.stringify([home.profileId, home.id]));
const soldDeath = run(inputs, sold);
assertEqual(soldDeath.logData.inheritance.housingCapital, undefined, 'Ein früherer Verkauf löst kein Wohnkapital aus');
assertEqual(soldDeath.newState.portfolio.rentBequest, undefined, 'Ein früherer Verkauf löst keine Miete aus');

for (const moveOutYears of [-1, 1.5, 11, '1', null, NaN]) {
    assertEqual(message({ ...rule, moveOutYears }), INVALID_MOVE_OUT_YEARS, 'Die Validierung weist ungültige Auszugsjahre ab');
}
for (const moveOutYears of [0, 1, 2, 10]) {
    assertEqual(readPartnership(record('unmarried', { ...rule, moveOutYears })).testament.muster_helga.moveOutYears,
        moveOutYears, 'Die Validierung übernimmt ganze Auszugsjahre von 0 bis 10');
}
assert(fields.includes('data-testament="moveOutYears" inputmode="numeric" value="0"') && fields.includes('Verkauf und Miete also im zweiten Folgejahr'),
    'Das Auszugsfeld beginnt bei 0 und erklärt den Mietbeginn bei einem Jahr');
const zero = inputsFor('unmarried', { ...rule, moveOutYears: 0 });
const oldDeath = run(inputs), zeroDeath = run(zero);
// ER-2e (Befund 1825): Werner lebt beim Tod von Helga schon dauerhaft im Heim. Auszug nach 0 rechnet wie Auszug nach 1.
const careDeaths = [0, 1].map(moveOutYears => {
    const careInputs = inputsFor('unmarried', { ...rule, moveOutYears });
    const careDeath = run(careInputs, undefined, 0, inCare);
    const estate = careDeath.logData.inheritance;
    assertEqual(estate.housingCapital, undefined, `1825: Bei dauerhaftem Heim entfällt das Wohnkapital (Auszug nach ${moveOutYears})`);
    assertEqual(estate.housingCapitalCancelled, true, 'Das Todesjahr führt den Wegfall im Beleg');
    assertEqual(estate.inheritedHome, 0, 'Der Hausanteil geht an die übrigen Erben');
    assertEqual(careDeath.newState.portfolio.rentBequest, undefined, 'Nach dem Erbfall beginnt keine Miete');
    assertEqual(careDeath.newState.portfolio.pendingHousingCapital, undefined, 'Kein späterer Verkauf mit Wohnkapital vorgemerkt');
    assertEqual(run(careInputs, careDeath.newState, 1, inCare).logData.miete_nach_erbfall, undefined, 'Auch im Folgejahr keine Miete');
    const action = protocolActionShortText(careDeath.logData, { source: 'mc' });
    assert(action.includes('Wohnkapital entfällt bei dauerhafter Heimpflege') && !action.includes('Hausanteil verkauft'),
        'Der Kurztext des Todesjahrs nennt den Wegfall');
    assert(renderProtocolTable([careDeath.logData], { source: 'mc', inputs: careInputs }).includes('Wohnkapital entfällt bei dauerhafter Heimpflege. Die übrigen Erben erhalten den Hausanteil.'),
        'Das Erbe-ⓘ nennt den Grund für den Wegfall');
    return careDeath.logData;
});
assertEqual(careDeaths[0].erbschaftsteuer, careDeaths[1].erbschaftsteuer, 'Die Erbschaftsteuer rechnet bei Auszug nach 0 ohne Wohnkapital, wie nach 1');
assert(careDeaths[0].erbschaftsteuer < zeroDeath.logData.erbschaftsteuer, 'Ohne Wohnkapital sinkt der Erwerb');
assertClose(zeroDeath.logData.inheritance.housingCapital, 54000, 1e-6, 'Gegenprobe: Werner zu Hause, Auszug nach 0, Wohnkapital im Todesjahr');
assertEqual(inheritancePreview(100000, 200000, 0, { selfUsedHome: 200000, testament: rule, housingCapitalEligible: false }).housingCapital,
    undefined, 'Auch die Vorschau berücksichtigt das Heim bei Auszug nach 0');
// ER-2e (Befund 1814): Auszug nach 0 nennt im Todesjahr Verkauf, Wohnkapital, Mietbeginn und den übrigen Hauserlös.
const zeroAction = protocolActionShortText(zeroDeath.logData, { source: 'mc' });
assert(zeroAction.includes('Hausanteil verkauft · Wohnkapital 54.000\u00a0€ aufs Tagesgeld · Mietbeginn im Folgejahr'),
    '1814: Die Todesjahrhandlung nennt Verkauf und Mietbeginn bei Auszug nach 0');
assert(zeroAction.includes('Geld und 126.000\u00a0€ Hauserlös verlassen den Haushalt'), '1814: Der übrige Hauserlös steht in der Erbangabe');
assert(renderProtocolTable([zeroDeath.logData], { source: 'mc', inputs: zero }).includes('<span>Übriger Hauserlös an die anderen Erben</span><span>126.000'),
    'Das Erbe-ⓘ weist den übrigen Hauserlös mit Betrag aus');
assertEqual(JSON.stringify(zeroDeath), JSON.stringify(oldDeath), '0 und fehlendes Auszugsfeld rechnen im Todesjahr bytegleich');
assertEqual(JSON.stringify(run(zero, zeroDeath.newState, 1)), JSON.stringify(run(inputs, oldDeath.newState, 1)),
    '0 und fehlendes Auszugsfeld rechnen auch im Mietjahr bytegleich');

// Im Todesjahr 10.000 € Geldanteil, daher bleiben 10.000 € Freibetrag in Steuerklasse III.
const delayed = inputsFor('unmarried', { ...rule, moveOutYears: 1, minimum: 10000, minimumStand: `${base.homeReferenceYear}-01` });
delayed.partnership.inheritance.muster_helga = 0;
const waiting = run(delayed);
assertEqual(waiting.logData.inheritance.moveOutYears, 1, 'Todesjahr zeigt den späteren Auszug');
assertEqual(waiting.newState.portfolio.homeSales?.length ?? 0, 0, 'Im Todesjahr bleibt der Hausanteil zum mietfreien Wohnen verfügbar');
assertEqual(waiting.logData.erbschaftsteuer, 0, 'Im Todesjahr fällt nur Steuer auf den übrigen Erwerb an');
assertEqual(waiting.logData.wohnrechtsteuer, undefined, 'Beim mietfreien Wohnen fällt keine Wohnrechtsteuer an');
assertEqual(waiting.logData.miete_nach_erbfall, undefined, 'Im Todesjahr fällt keine Miete an');
assert(renderProtocolTable([waiting.logData], { source: 'mc', inputs: delayed }).includes('Mietfrei bis Ende des 1. Jahres nach dem Todesjahr'),
    'Das Todesjahrprotokoll nennt das Ende der mietfreien Zeit');

const firstFollowingYear = run(delayed, waiting.newState, 1, alive, 10);
assertEqual(firstFollowingYear.logData.miete_nach_erbfall ?? 0, 0, 'Auszug nach einem Jahr: Im ersten Folgejahr fällt keine Miete an');
assertEqual(firstFollowingYear.logData.housingCapitalMove.kind, 'staying', 'Der Anteil bleibt das ganze erste Folgejahr zum mietfreien Wohnen verfügbar');
assertEqual(firstFollowingYear.newState.portfolio.homeSales?.length ?? 0, 0, 'Im ersten Folgejahr gibt es keinen Verkauf');
const move = run(delayed, firstFollowingYear.newState, 2, alive, 5);
assertEqual(move.kind, 'success', 'Auszugsjahr vollständig berechnet');
assertClose(move.logData.housingCapitalMove.amount, 62370, 1e-6, 'Auszug nach einem Jahr nutzt 231.000 € Hauswert im zweiten Folgejahr');
assertEqual(move.newState.portfolio.homeSales.length, 1, 'Im Auszugsjahr wird nur der Anteil der verstorbenen Person verkauft');
assertEqual(move.logData.housingCapitalMove.allowanceRemaining, 10000, 'Nur der im Todesjahr unverbrauchte Freibetrag bleibt');
assertEqual(move.logData.erbschaftsteuer, 15690, 'Im Auszugsjahr entstehen 30 % Steuer auf abgerundet 52.300 €');
assertClose(move.logData.liqStart - firstFollowingYear.newState.portfolio.liquiditaet, 46680, 1, 'Zu Jahresbeginn liegen Wohnkapital abzüglich Steuer auf Tagesgeld');
assertClose(move.logData.miete_nach_erbfall, 15840, 1e-6, 'Im zweiten Folgejahr fällt die volle seit Planstart fortgeschriebene Jahresmiete an');
assertClose(run(delayed, move.newState, 3).logData.miete_nach_erbfall, 16632, 1e-6, 'Miete wird seit Planstart fortgeschrieben');
assertClose(move.logData.portfolio_flow_delta, 0, .05, 'Die Flussbilanz enthält den Zufluss');
const moveHtml = renderProtocolTable([move.logData], { source: 'mc', inputs: delayed });
assert(moveHtml.includes('Hausanteil verkauft') && moveHtml.includes('Mietbeginn') && moveHtml.includes('Freibetragsrest aus dem Todesjahr'),
    'Das Protokoll zeigt Verkauf, Mietbeginn und Freibetragsrest');
assert(protocolCashflowBreakdown(move.logData, { inputs: delayed }).expenses.some(row => row.label === 'Miete nach Verkauf im Erbfall'),
    'Ausgaben im Auszugsjahr enthalten die Miete');

// Nach Freibetrag sind 94.000 € im Todesjahr und 148.000 € nach Auszug steuerpflichtig, beide mit 11 %.
const progressive = inputsFor('married', { ...rule, moveOutYears: 1, minimum: 850000, minimumStand: `${base.homeReferenceYear}-01` });
progressive.partnership.marriedInheritance.muster_helga = 0;
progressive.rente1 = 0;
progressive.rente2 = 0;
const progressiveStart = initMcRunState(progressive);
progressiveStart.portfolio.personAccounts.find(person => person.profileId === 'muster_helga').tagesgeld += 1000000;
const progressiveDeath = run(progressive, progressiveStart);
const progressiveWaiting = run(progressive, progressiveDeath.newState, 1);
const progressiveMove = run(progressive, progressiveWaiting.newState, 2);
assertEqual(progressiveDeath.logData.inheritance.taxable, 94000, 'Progression: Der Freibetrag ist im Todesjahr aufgebraucht');
assertClose(progressiveDeath.logData.erbschaftsteuer, 10340, .01, 'Progression: 11 % Steuer auf 94.000 € im Todesjahr');
assertClose(progressiveMove.logData.erbschaftsteuer, 5940, .01, 'Progression: 16.280 € gemeinsame Steuer abzüglich 10.340 € aus dem Todesjahr');
assertClose(progressiveMove.logData.portfolio_flow_delta, 0, .05, 'Die Flussbilanz enthält die progressive Steuer');

// In der Vorschau ergibt 50.080 € + 54.054 € vor Rundung einen Gesamterwerb von 104.100 €.
const progressivePreview = inheritancePreview(550080, 200200, 100,
    { status: 'married', selfUsedHome: 200200, testament: { ...rule, moveOutYears: 1 } });
assertClose(progressivePreview.moveOutTax, 7951, .01, 'Vorschau: Rundung nach Zusammenrechnung und Abzug von 3.500 € Todesjahrsteuer');

const twoYears = inputsFor('unmarried', { ...rule, moveOutYears: 2 });
const twoYearsDeath = run(twoYears);
const stillAtHome = run(twoYears, twoYearsDeath.newState, 1);
assertEqual(stillAtHome.logData.housingCapitalMove.kind, 'staying', 'Die überlebende Person wohnt im ersten Folgejahr weiter mietfrei');
const lastYearAtHome = run(twoYears, stillAtHome.newState, 2);
assertEqual(lastYearAtHome.logData.housingCapitalMove.kind, 'staying', 'Auch das zweite Folgejahr bleibt bei zwei Jahren mietfrei');
assertEqual(run(twoYears, lastYearAtHome.newState, 3).logData.housingCapitalMove.kind, 'sold', 'Bei zwei Jahren erfolgt der Verkauf im dritten Folgejahr');
const earlyCare = run(twoYears, stillAtHome.newState, 2, inCare);
assertEqual(earlyCare.logData.housingCapitalMove.reason, 'care', 'Dauerhafte Heimpflege vor dem Auszug beendet den Anspruch');
const deceasedHomeKey = twoYearsDeath.newState.portfolio.pendingHousingCapital.homeKeys[0];
assert(earlyCare.newState.portfolio.homeSales.includes(deceasedHomeKey), 'Der an die Erben abgegebene Hausanteil ist für weitere Verkäufe gesperrt');
const noMove = run(twoYears, earlyCare.newState, 3);
assertEqual(noMove.logData.housingCapitalMove, undefined, 'Im vorgesehenen Auszugsjahr gibt es kein Wohnkapital');
assertEqual(noMove.logData.miete_nach_erbfall, undefined, 'Nach dem Heim beginnt keine Miete');
assertEqual(noMove.newState.portfolio.pendingHousingCapital, undefined, 'Der Hausanteil geht an die übrigen Erben');
const earlyDeath = run(twoYears, stillAtHome.newState, 2, { p1Alive: false, p2Alive: false });
assertEqual(earlyDeath.logData.housingCapitalMove.reason, 'death', 'Auch der Tod vor dem Auszug beendet den Anspruch');

const accumulation = { ...delayed, accumulationPhase: { enabled: true, sparrate: 1000 }, transitionYear: 5 };
const accumulationDeath = run(accumulation);
const accumulationWaiting = run(accumulation, accumulationDeath.newState, 1);
const accumulationMove = run(accumulation, accumulationWaiting.newState, 2);
assertEqual(accumulationMove.logData.miete_nach_erbfall, 14400, 'Auch im Ansparjahr wird die Miete ab dem Auszug bezahlt');
assertClose(accumulationMove.logData.portfolio_flow_delta, 0, .05, 'Die Flussbilanz im Ansparjahr enthält Kapital, Steuer und Miete');

for (const [phase, scenario, beforeMove, withTax, inflation] of [
    ['Entnahmejahr', delayed, firstFollowingYear.newState, move, 5],
    ['Ansparjahr', accumulation, accumulationWaiting.newState, accumulationMove, 0]
]) {
    const tax = withTax.logData.erbschaftsteuer;
    assert(tax > 0, `${phase}: Der spätere Auszug löst Erbschaftsteuer aus`);
    const withoutTaxState = structuredClone(beforeMove);
    withoutTaxState.portfolio.pendingHousingCapital.allowanceRemaining = 1000000;
    // Dieselbe Liquidität nach dem Auszug hält Zinsen, Verkäufe und andere Steuern gleich.
    withoutTaxState.portfolio.personAccounts.find(person => person.profileId === 'muster_werner').tagesgeld -= tax;
    syncPersonalLiquidity(withoutTaxState.portfolio);
    const withoutTax = run(scenario, withoutTaxState, 2, alive, inflation);
    assertEqual(withoutTax.logData.erbschaftsteuer, 0, `${phase}: Vergleich ohne Steuer auf das Wohnkapital`);
    assertClose(withTax.totalTaxesThisYear - withoutTax.totalTaxesThisYear, tax, .01, `${phase}: Wohnkapitalsteuer zählt genau einmal zu den Jahressteuern`);
    assertClose(withTax.logData.steuern_gesamt, withTax.totalTaxesThisYear, .01, `${phase}: Protokoll und Jahressumme stimmen überein`);
}
