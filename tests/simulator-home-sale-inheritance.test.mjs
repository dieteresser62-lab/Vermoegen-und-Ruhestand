import { inheritancePreview, homeAndTaxEstate, inheritanceTax, readPartnership, inheritsHomeAndTax } from '../app/profile/household-partnership.js';
import { inheritanceNetProceeds } from '../app/profile/household-inheritance-sale.js';
import { sellHomesForExternalCare } from '../app/simulator/simulator-home-sale.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { applyUnmarriedInheritance, homeValueAtDeath } from '../app/simulator/simulator-inheritance.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { buildMonteCarloRuinLogRow } from '../app/simulator/mc-log-builder.js';

const home = { profileId: 'muster_a', id: 'haus', wert: 800000, nutzung: 'selbst', stand: '2026-10' };
const external = { active: true, grade: 4 }, family = { active: true, grade: 2 };
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const base = () => ({ ...structuredClone(fixture), home: [{ ...home }], homeReferenceYear: 2026 });
for (const [partner, care1, care2, expected] of [[false, external, null, true], [true, external, external, true],
    [true, external, family, false], [true, family, external, false]]) {
    const inputs = base(); inputs.partner.aktiv = partner;
    const state = initMcRunState(inputs), portfolio = structuredClone(state.portfolio);
    const household = { p1Alive: true, p2Alive: partner, care: { p1: care1, p2: care2 } };
    const sale = sellHomesForExternalCare({ portfolio, state, inputs, household, yearIndex: 4, inflationFactor: 1.2 });
    assertEqual(Boolean(sale), expected, `Verkauf nur bei externer Pflege aller Lebenden: ${partner}/${care1.grade}/${care2?.grade}`);
    if (!sale) continue;
    assertClose(sale.immobilienverkauf, homeValueAtDeath(home, inputs, 1.2) * .9, .001, '90 Prozent des fortgeschriebenen Werts');
    assertEqual(sale.immobilienverkauf_jahr, 2030, 'Kalenderjahr des Verkaufs');
    assertEqual(sellHomesForExternalCare({ portfolio, state, inputs, household, yearIndex: 5, inflationFactor: 1.3 }), null, 'Kein zweiter Verkauf');
    assert(!state.portfolio.homeSales, 'Eingangsstate bleibt unverändert');
}
{
    const inputs = base(); inputs.home.push({ ...home, profileId: 'muster_b', wert: 200000 });
    const state = initMcRunState(inputs), portfolio = structuredClone(state.portfolio);
    const before = portfolio.personAccounts.map(person => person.tagesgeld);
    sellHomesForExternalCare({ portfolio, state, inputs, household: { p1Alive: true, p2Alive: true,
        care: { p1: external, p2: external } }, yearIndex: 0, inflationFactor: 1 });
    assertClose(portfolio.personAccounts[0].tagesgeld - before[0], 720000, .001, 'Erlös des Hauptprofils bleibt auf dessen Tagesgeld');
    assertClose(portfolio.personAccounts[1].tagesgeld - before[1], 180000, .001, 'Erlös des Partnerprofils bleibt auf dessen Tagesgeld');
}
{
    const inputs = base(); inputs.partner.aktiv = false;
    inputs.tagesgeld = 0; inputs.geldmarktEtf = 0; inputs.aktien = 0; inputs.gold = 0;
    inputs.detailledTranches = []; inputs.simulationPeople = [inputs.simulationPeople[0]];
    Object.assign(inputs.simulationPeople[0], { tagesgeld: 0, geldmarktEtf: 0 });
    const state = initMcRunState(inputs), household = { p1Alive: true, p2Alive: false, care: { p1: external } };
    const result = simulateOneYear(state, inputs, year, 0, external, 0, household, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Erlös steht vor Entnahme und Ruinprüfung im selben Jahr bereit');
    assertEqual(result.logData.immobilienverkauf, 720000, 'Jahresprotokoll enthält Verkauf');
    const document = projectScenarioLogV2([{ ...result.logData, recordType: 'financial_year', financiallyEvaluable: true }]);
    assertEqual(document.records[0].immobilienverkauf, 720000, 'JSON-Export erhält nominalen Immobilienerlös');
    const csv = serializeScenarioLogCsvV2(document);
    assert(csv.includes('immobilienverkauf_jahr') && csv.includes('immobilienverkauf_personen'), 'CSV-Export enthält Verkaufsjahr und Eigentümer');
    assertClose(result.logData.portfolio_flow_delta, 0, .05, 'Verkauf bilanziert');
    const html = renderProtocolTable([result.logData], { source: 'mc', inputs, logDetailLevel: 'normal' });
    assert(html.includes('data-protocol-column="home-sale"') && html.includes('data-protocol-column="home-sale-year"'), 'Normalansicht zeigt Betrag und Jahr');
    assert(!getProtocolColumns({ source: 'mc', rows: [{}] }).some(column => column.id === 'home-sale'), 'Ohne Verkauf keine leeren Verkaufsspalten');
    const next = simulateOneYear(result.newState, inputs, year, 1, external, 0, household, 1, EngineAPI);
    assertEqual(next.logData.immobilienverkauf, undefined, 'Verkauf bleibt im Folgejahr abgeschlossen');
    const rentInputs = { ...inputs, home: [{ ...home, nutzung: 'vermietet' }], fixedIncomeReferenceYear: 2026,
        fixedIncome: [{ profileId: home.profileId, id: 'immobilie:haus', art: 'sonstige', betragMonat: 1000, ab: null, bis: null, anpassung: 'keine' }] };
    assertEqual(calculateFixedIncomeForYear({ inputs: rentInputs, state: result.newState, yearIndex: 0, inflationFactor: 1, household, care: null }).total, 0, 'Miete endet schon im Verkaufsjahr');
}
{
    const inputs = base(), state = initMcRunState(inputs);
    const aloneExternal = { p1Alive: true, p2Alive: true, care: { p1: external, p2: family } };
    const first = simulateOneYear(state, inputs, year, 0, null, 0, aloneExternal, 1, EngineAPI);
    assertEqual(first.logData.immobilienverkauf, undefined, 'Paar verkauft nicht bei nur einer extern gepflegten Person');
    const bothExternal = { ...aloneExternal, care: { p1: external, p2: external } };
    const second = simulateOneYear(first.newState, inputs, year, 1, null, 0, bothExternal, 1, EngineAPI);
    assertEqual(second.logData.immobilienverkauf_jahr, 2027, 'Verkauf genau beim ersten Wechsel aller Lebenden in externe Pflege');
    const backtest = simulateOneYear(state, { ...inputs, careToday: { grade: 3 }, partner: { ...inputs.partner, careToday: { grade: 3 } } }, year, 0, null, 0, null, 1, EngineAPI);
    assertEqual(backtest.logData.immobilienverkauf, undefined, 'Backtest mit festem Pflegegrad verkauft weiterhin nicht');
    const configuredFamily = { ...inputs, pflegeGradeConfigs: { ...inputs.pflegeGradeConfigs, 4: { careForm: 'family' } } };
    assertEqual(sellHomesForExternalCare({ portfolio: structuredClone(state.portfolio), state, inputs: configuredFamily,
        household: bothExternal, yearIndex: 0, inflationFactor: 1 }), null, 'Gewählte Pflegeform geht vor Grad-Vorgabe');
}
for (const percent of [0, 25, 100]) {
    const estate = homeAndTaxEstate(3000000, 800000, percent);
    assertClose(estate.taxCash, estate.tax, 1, 'Steuergeld deckt die Steuer einschließlich Geldquote');
    assertClose(estate.inherited, estate.taxCash + (3000000 - estate.taxCash) * percent / 100, .001, 'Quote nur auf übriges Geldvermögen');
    assertClose(estate.tax, inheritanceTax(800000 + estate.inherited), .001, 'Tarif aus FR-51');
    const inputs = base();
    inputs.partnership = { status: 'unmarried', inheritance: { muster_a: percent }, homeAndTaxInheritance: { muster_a: true } };
    const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Immobilienerbe im Todesjahr berechenbar');
    const log = result.logData.inheritance;
    assertEqual(log.inheritedHome, 800000, 'Immobilie vollständig beim Partner');
    assertClose(log.taxCash - log.taxCashSaleTax, log.tax, 1, 'Netto-Steuergeld im Jahrespfad ausreichend');
    assertClose(log.inherited, log.taxCash + (log.assets - log.taxCash) * percent / 100, .001, 'Rest des Nachlasses folgt der Quote');
    assertClose(result.logData.portfolio_flow_delta, 0, .05, 'Nachlass und Steuergeld bilanziert');
    const rental = { ...inputs, fixedIncomeReferenceYear: 2026, fixedIncome: [{ profileId: home.profileId,
        id: 'immobilie:haus', art: 'sonstige', betragMonat: 1000, ab: null, bis: null, anpassung: 'keine' }] };
    assertEqual(calculateFixedIncomeForYear({ inputs: rental, state: result.newState, yearIndex: 1, inflationFactor: 1,
        household: { p1Alive: false, p2Alive: true }, deathThisYear: false }).total, 12000, 'FR-54 erhält volle Miete unabhängig von der Geldquote');
    const sold = simulateOneYear(result.newState, inputs, year, 1, null, 0, { p1Alive: false, p2Alive: true, care: { p2: external } }, 1, EngineAPI);
    assertClose(sold.logData.immobilienverkauf, 720000, .001, 'Alle geerbten Anteile stehen beim späteren Verkauf bereit');
}
assertClose(homeAndTaxEstate(1000000, 800000, 0).taxCash, 334285.7142857143, 1, 'Handrechnung Klasse III');
const limited = inheritancePreview(10000, 800000, 0, { homeAndTax: true });
assert(limited.shortfall > 0 && limited.taxCash === 10000, 'Unzureichendes Geldvermögen bleibt als Steuerlücke sichtbar');
assertEqual(inheritsHomeAndTax(readPartnership(null), 'max'), false, 'Altbestand ohne Häkchen ist aus');
const record = { schemaVersion: 1, status: 'unmarried', maritalPropertyRegime: 'community', inheritance: { max: 25 }, homeAndTaxInheritance: { max: true } };
assertEqual(JSON.stringify(readPartnership(JSON.stringify(record))), JSON.stringify(record), 'Häkchen unabhängig von Prozentquote gespeichert');
assertEqual(inheritsHomeAndTax({ ...record, status: 'married' }, 'max'), false, 'Ehe ignoriert das unverheiratete Häkchen');
let rejected = false; try { readPartnership({ ...record, homeAndTaxInheritance: { max: 'true' } }); } catch { rejected = true; }
assert(rejected, 'Import verwirft ungültige Häkchenwerte');

// EP-2b: Der am Jahresende verteilte Nachlass darf nicht schon am Jahresanfang verkauft werden.
for (const deceasedIndex of [0, 1]) {
    const inputs = base(), deceasedId = inputs.simulationPeople[deceasedIndex].profileId;
    const survivorId = inputs.simulationPeople[1 - deceasedIndex].profileId;
    inputs.home[0].profileId = deceasedId;
    inputs.partnership = { status: 'unmarried', inheritance: { [deceasedId]: 0 }, homeAndTaxInheritance: { [deceasedId]: true } };
    const household = { p1Alive: deceasedIndex !== 0, p2Alive: deceasedIndex !== 1,
        care: { [deceasedIndex === 0 ? 'p2' : 'p1']: external } };
    const state = initMcRunState(inputs);
    const death = simulateOneYear(state, inputs, year, 0, null, 0, household, 1, EngineAPI);
    assertEqual(death.kind, 'success', 'Todesjahr mit extern gepflegtem Partner bleibt berechenbar');
    assertEqual(death.logData.immobilienverkauf, undefined, 'Kein Verkauf vor dem Nachlass im Todesjahr');
    assertEqual(death.logData.inheritance.inheritedHome, 800000, 'FR-54 vererbt das vollständige Haus trotz externer Pflege');
    assert(!death.newState.portfolio.homeSales, 'Haus bleibt bis nach dem Nachlass unverkauft');
    const next = simulateOneYear(death.newState, inputs, year, 1, null, 0, household, 1, EngineAPI);
    assertClose(next.logData.immobilienverkauf, 720000, .001, 'Verkauf frühestens im Folgejahr');
    assertEqual(next.logData.immobilienverkauf_personen[0].profileId, survivorId, 'Erlös geht auf das Konto der erbenden Person');
    assertClose(death.logData.portfolio_flow_delta, 0, .05, 'Nachlass im Todesjahr bilanziert');
    assertClose(next.logData.portfolio_flow_delta, 0, .05, 'Geerbter Verkauf im Folgejahr bilanziert');
}
for (const percent of [0, 50, 100]) {
    const inputs = base(); inputs.partnership = { status: 'unmarried', inheritance: { muster_a: percent } };
    const household = { p1Alive: false, p2Alive: true, care: { p2: external } };
    const death = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, household, 1, EngineAPI);
    assertEqual(death.logData.immobilienverkauf, undefined, 'Auch ohne FR-54 kein Verkauf im Todesjahr');
    assertEqual(death.logData.inheritance.inheritedHome, 800000 * percent / 100, 'Nachlassquote bestimmt verbleibendes Haus');
    const next = simulateOneYear(death.newState, inputs, year, 1, null, 0, household, 1, EngineAPI);
    assertClose(next.logData.immobilienverkauf || 0, 720000 * percent / 100, .001, 'Folgejahr verkauft nur den geerbten Anteil');
}

// Kontrollierter Nachlass ohne Jahresentnahme: 400.000 Tagesgeld, 600.000 Depot, 800.000 Haus.
for (const [cash, percent] of [[400000, 0], [400000, 25], [400000, 50], [100000, 25]]) {
    const inputs = base();
    inputs.partnership = { status: 'unmarried', inheritance: { muster_a: percent }, homeAndTaxInheritance: { muster_a: true } };
    const portfolio = initMcRunState(inputs).portfolio;
    for (const account of portfolio.personAccounts) { account.tagesgeld = account.profileId === 'muster_a' ? cash : 0; account.geldmarktEtf = 0; }
    portfolio.depotTranchesAktien = [{ trancheId: 'nachlass', sourceProfileId: 'muster_a', category: 'equity', marketValue: 1000000 - cash,
        costBasis: (1000000 - cash) / 2, shares: 100 }];
    portfolio.depotTranchesGold = []; portfolio.depotTranchesGeldmarkt = [];
    portfolio.healthBucketTranches = []; portfolio.healthBucketCashOwners = [];
    portfolio.healthBucketCashAmount = 0; portfolio.healthBucketGeldmarkt = 0;
    const estate = homeAndTaxEstate(1000000, 800000, percent, inheritanceNetProceeds({ cash, tranches: portfolio.depotTranchesAktien, sparerPauschbetrag: portfolio.personAccounts[1].sparerPauschbetrag }));
    const result = applyUnmarriedInheritance({ portfolio, inputs, inflationFactor: 1,
        transition: { deathThisYear: true, survivor: { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b' } },
        pension: { rente1BruttoEigen: 0, rente2BruttoEigen: 0 }, personalInterest: { items: [] }, actionResult: { steuer: 0 } });
    const transferredCash = portfolio.personAccounts[0].tagesgeld + result.inheritancePayment.paidCost + result.inheritancePayment.paidTax
        - result.inheritancePayment.sources.reduce((sum, source) => sum + source.brutto, 0);
    const expectedCash = Math.min(cash, estate.taxCash) + Math.max(0, cash - estate.taxCash) * percent / 100;
    assertClose(transferredCash, expectedCash, .001, 'Steuergeld zuerst aus Tagesgeld, Quote danach aus dessen Rest');
    assertClose(result.inheritance.inherited, estate.inherited, .001, 'Gesamterbe bleibt nach FR-54 unverändert');
    const transferredDepot = portfolio.depotTranchesAktien.reduce((sum, lot) => sum + lot.marketValue, 0)
        + result.inheritancePayment.sources.reduce((sum, source) => sum + source.brutto, 0);
    assertClose(transferredDepot, estate.inherited - expectedCash, .001, 'Depot überträgt nur den fehlenden Steuerrest und die Quote vom übrigen Depot');
    if (cash >= estate.taxCash) {
        assertEqual(result.inheritancePayment.sources.length, 0, 'Ausreichendes Nachlass-Tagesgeld vermeidet Steuerverkauf');
        assertClose(portfolio.depotTranchesAktien.reduce((sum, lot) => sum + lot.marketValue, 0), (1000000 - cash) * percent / 100, .001, 'Nur zusätzliche Quote aus dem übrigen Depot');
    } else {
        assert(result.inheritancePayment.sources.length > 0, 'Fehlendes Tagesgeld kommt anteilig aus dem Depot');
        const lot = portfolio.depotTranchesAktien[0];
        if (lot?.marketValue > 0) assertClose(lot.costBasis / lot.marketValue, .5, 1e-10, 'Anteilig übertragene Einstandswerte bleiben erhalten');
    }
}

for (const profileId of ['altes_profil', undefined]) {
    const inputs = base(); inputs.partner.aktiv = false; inputs.simulationPeople = [inputs.simulationPeople[0]];
    inputs.detailledTranches = inputs.detailledTranches.filter(lot => lot.sourceProfileId === 'muster_a');
    inputs.tagesgeld = inputs.simulationPeople[0].tagesgeld;
    inputs.home[0].profileId = profileId;
    const state = initMcRunState(inputs), portfolio = structuredClone(state.portfolio);
    const before = portfolio.personAccounts[0].tagesgeld;
    const sale = sellHomesForExternalCare({ portfolio, state, inputs,
        household: { p1Alive: true, p2Alive: false, care: { p1: external } }, yearIndex: 0, inflationFactor: 1 });
    assertClose(sale?.immobilienverkauf, 720000, .001, 'Altdaten-Immobilie wird der einzigen Person zugeordnet');
    assertClose(portfolio.personAccounts[0].tagesgeld - before, 720000, .001, 'Einzige Person erhält den Erlös auf Tagesgeld');
    assertEqual(sellHomesForExternalCare({ portfolio, state, inputs,
        household: { p1Alive: true, p2Alive: false, care: { p1: external } }, yearIndex: 1, inflationFactor: 1 }), null, 'Auch Altdaten-Immobilie nur einmal verkaufen');
}
{
    const inputs = base(); inputs.home[0].profileId = 'unbekannt';
    const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0,
        { p1Alive: true, p2Alive: true, care: { p1: external, p2: external } }, 1, EngineAPI);
    assertEqual(result.logData.immobilienverkauf, undefined, 'Unbekannten Eigentümer im Paar nicht erraten');
    assert(result.logData.immobilienverkauf_hinweis?.includes('nicht zugeordnet'), 'Unklare Zuordnung bleibt als Protokollhinweis sichtbar');
    const html = renderProtocolTable([result.logData], { source: 'mc', inputs, logDetailLevel: 'normal' });
    assert(html.includes('Eigentümer nicht zugeordnet'), 'Vorhandene Handlungsbegründung zeigt den Hinweis');
    const exported = projectScenarioLogV2([{ ...result.logData, recordType: 'financial_year', financiallyEvaluable: true }]);
    assert(exported.records[0].immobilienverkauf_hinweis?.includes('nicht zugeordnet'), 'Hinweis bleibt auch im Export erhalten');
    const ruin = buildMonteCarloRuinLogRow({ result, inputs, simulationsJahr: 0, yearData: year,
        lifeLogContext: { hasPartner: true, p1Alive: true, p2Alive: true, careMetaP1: external, careMetaP2: external } });
    assert(ruin.aktionUndGrund.includes('Eigentümer nicht zugeordnet') && ruin.immobilienverkauf_hinweis,
        'Auch eine Ruinzeile verliert den Eigentümerhinweis nicht');
}

// EP-3: Externe Kosten ab PG3 erlauben noch keinen Verkauf.
for (const [partner, firstGrade, secondGrade, familyCare, expected] of [
    [false, 3, null, false, false], [false, 4, null, false, true], [false, 4, null, true, false],
    [true, 4, 3, false, false], [true, 3, 4, false, false], [true, 4, 4, false, true]
]) {
    const inputs = base(); inputs.partner.aktiv = partner;
    if (familyCare) inputs.pflegeGradeConfigs = { ...inputs.pflegeGradeConfigs, 4: { careForm: 'family' } };
    const state = initMcRunState(inputs), portfolio = structuredClone(state.portfolio);
    const sale = sellHomesForExternalCare({ portfolio, state, inputs, yearIndex: 0, inflationFactor: 1,
        household: { p1Alive: true, p2Alive: partner, care: {
            p1: { active: true, grade: firstGrade }, p2: { active: true, grade: secondGrade } } } });
    assertEqual(Boolean(sale), expected, `PG4-Schwelle: Paar ${partner}, Grade ${firstGrade}/${secondGrade}, Angehörige ${familyCare}`);
    if (sale) {
        assertEqual(sale.immobilienverkauf, 720000, 'PG4 extern verkauft im ersten Jahr für 90 Prozent');
        const marker = portfolio.personAccounts[0].homeSaleProceeds[0];
        assertEqual(JSON.stringify(marker), JSON.stringify({ homeId: 'haus', amount: 720000, year: 2026 }), 'Nominale Vormerkung je Eigentümer und Immobilie');
    }
}

// Verkauf zu Lebzeiten beider Personen, späterer Tod wie im synthetischen Log-27-Pfad.
for (const deceasedIndex of [0, 1]) {
    const inputs = base(), deceasedId = inputs.simulationPeople[deceasedIndex].profileId;
    inputs.home[0].profileId = deceasedId;
    inputs.simulationPeople[deceasedIndex].tagesgeld += 1000000;
    inputs.tagesgeld += 1000000;
    inputs.startVermoegen += 1000000;
    inputs.partnership = { status: 'unmarried', inheritance: { [deceasedId]: 0 }, homeAndTaxInheritance: { [deceasedId]: true } };
    const state = initMcRunState(inputs);
    const alive = { p1Alive: true, p2Alive: true, care: { p1: external, p2: external } };
    const sale = simulateOneYear(state, inputs, year, 0, null, 0, alive, 1, EngineAPI);
    assertEqual(sale.kind, 'success', 'Beide PG4 extern: Verkauf zu Lebzeiten');
    const proceeds = sale.logData.immobilienverkauf;
    const next = simulateOneYear(sale.newState, inputs, year, 1, null, 0, alive, 1, EngineAPI);
    const marker = next.newState.portfolio.personAccounts.find(row => row.profileId === deceasedId).homeSaleProceeds[0];
    assertEqual(marker.amount, proceeds, 'Vormerkung bleibt nominal über weitere Jahresrechnungen erhalten');
    const death = simulateOneYear(next.newState, inputs, year, 2, null, 0,
        { ...alive, p1Alive: deceasedIndex !== 0, p2Alive: deceasedIndex !== 1 }, 1, EngineAPI);
    assertEqual(death.kind, 'success', 'Späterer Tod nach Verkauf berechenbar');
    const estate = death.logData.inheritance;
    assertEqual(estate.inheritedHome, proceeds, 'FR-54 erhält den vorgemerkten Erlös als Immobilienerbe');
    assertClose(estate.taxCash - estate.taxCashSaleTax, estate.tax, 1, 'Netto-X deckt die Steuer auf Erlös und X');
    assertClose(estate.inherited, estate.taxCash, .001, 'Bei 0 Prozent nur X aus dem übrigen Geld');
    assertClose(death.logData.portfolio_flow_delta, 0, .05, 'Umordnung des Hauserlöses erzeugt kein zusätzliches Vermögen');
    const html = renderProtocolTable([death.logData], { source: 'mc', inputs, logDetailLevel: 'normal' });
    assert(html.includes('Hauserlös (verkauft im Jahr 2026)'), 'Todesjahr nennt den früheren Hausverkauf');
    assertEqual(sale.newState.portfolio.personAccounts.find(row => row.profileId === deceasedId).homeSaleProceeds[0].amount,
        proceeds, 'Spätere Jahre verändern frühere Personenzustände nicht');
}

// Kontrollierte Bestände: Erlös vollständig/teilweise verbraucht oder inzwischen im Depot.
for (const [cash, depot, marked, percent, special, married] of [
    [1200000, 600000, 720000, 0, true, false], [100000, 1700000, 720000, 25, true, false],
    [100000, 1700000, 720000, 100, true, false], [40000, 60000, 720000, 0, true, false],
    [0, 0, 720000, 0, true, false], [40000, 60000, 720000, 0, false, false],
    [400000, 600000, 720000, 100, true, true]
]) {
    const inputs = base(); inputs.partnership = { status: married ? 'married' : 'unmarried', inheritance: { muster_a: percent },
        marriedInheritance: { muster_a: percent }, homeAndTaxInheritance: { muster_a: special } };
    function estateWithMarker(withMarker) {
        const portfolio = initMcRunState(inputs).portfolio;
        for (const account of portfolio.personAccounts) {
            account.tagesgeld = account.profileId === 'muster_a' ? cash : 1000000;
            if (withMarker && account.profileId === 'muster_a') account.homeSaleProceeds = [
                { homeId: 'haus', amount: marked * .75, year: 2026 }, { homeId: 'wohnung', amount: marked * .25, year: 2027 }];
        }
        portfolio.homeSales = [JSON.stringify(['muster_a', 'haus'])];
        portfolio.depotTranchesAktien = depot ? [{ trancheId: 'nachlass', sourceProfileId: 'muster_a', category: 'equity',
            marketValue: depot, costBasis: depot, shares: 100 }] : [];
        portfolio.depotTranchesGold = []; portfolio.depotTranchesGeldmarkt = [];
        portfolio.healthBucketTranches = []; portfolio.healthBucketCashOwners = [];
        portfolio.healthBucketCashAmount = 0; portfolio.healthBucketGeldmarkt = 0;
        const result = applyUnmarriedInheritance({ portfolio, inputs, inflationFactor: 2,
            transition: { deathThisYear: true, survivor: { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b' } },
            pension: { rente1BruttoEigen: 0, rente2BruttoEigen: 0 }, personalInterest: { items: [] }, actionResult: { steuer: 0 } });
        return { portfolio, result };
    }
    const { portfolio, result } = estateWithMarker(true), log = result.inheritance;
    if (!special || married) {
        assertEqual(JSON.stringify({ portfolio, result }), JSON.stringify(estateWithMarker(false)), 'Ohne FR-54 oder bei Ehe bleibt die Rechnung bytegleich');
        continue;
    }
    const available = cash + depot, proceeds = Math.min(marked, available);
    const expected = homeAndTaxEstate(available - proceeds, proceeds, percent);
    assertEqual(log.inheritedHome, proceeds, 'Hauserlös auf vorhandenes Geldvermögen begrenzt, ohne Inflationsfortschreibung');
    assertClose(log.inherited, expected.inherited, .001, 'X und Quote nur vom Geld nach Abzug des Hauserlöses');
    assertClose(log.leaves, available - proceeds - expected.inherited, .001, 'An Erben enthält nur den übrigen Geldanteil');
    const transferred = portfolio.personAccounts[0].tagesgeld - 1000000 + result.inheritancePayment.paidCost
        + result.inheritancePayment.paidTax - result.inheritancePayment.sources.reduce((sum, row) => sum + row.brutto, 0);
    const reserved = proceeds + expected.taxCash;
    assertClose(transferred, Math.min(cash, reserved) + Math.max(0, cash - reserved) * percent / 100, .001,
        'Hauserlös und X zuerst aus Tagesgeld, fehlender Rest anteilig aus Depot');
    const remainingDepot = portfolio.depotTranchesAktien.reduce((sum, lot) => sum + lot.marketValue, 0);
    assertClose(transferred + remainingDepot + result.inheritancePayment.sources.reduce((sum, row) => sum + row.brutto, 0),
        proceeds + expected.inherited, .001, 'Erlös und X genau einmal übertragen');
    if (available > marked) assertClose(log.taxCash, log.tax, 1, 'Ausreichender übriger Nachlass deckt Steuer bis auf einen Euro');
}
