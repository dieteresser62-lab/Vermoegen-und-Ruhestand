import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { paymentPortfolio, paymentInterest, noDepotInheritance } from './helpers/ev-1-cases.mjs';
import { applyUnmarriedInheritance } from '../app/simulator/simulator-inheritance.js';
import { survivorLiquidityTarget } from '../app/simulator/simulator-survivor.js';
import { calculateHouseholdPensionForYear } from '../app/simulator/simulator-household-pension.js';
import { calculateTargetLiquidityBalanceLike } from '../app/simulator/simulator-engine-direct-utils.js';
import { beginPersonalTaxYear, payPersonalExtraCost } from '../app/simulator/simulator-personal-tax.js';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';

const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const controls = JSON.parse(readFileSync(new URL('./fixtures/ev-1-byte-controls.json', import.meta.url)));
function payment(config, cost, options = {}) {
    const portfolio = paymentPortfolio(config), action = { steuer: 0 };
    beginPersonalTaxYear(portfolio);
    const result = payPersonalExtraCost(portfolio, 'erika', cost, paymentInterest, action, options);
    return { portfolio, action, result };
}
{
    const { portfolio, result } = payment({}, 250000, { liquidityReserve: 150000 });
    assert(portfolio.liquiditaet >= 150000, 'Erbschaftsteuer und Verkaufssteuer erhalten Tagesgeld plus Geldmarkt');
    assertClose(portfolio.geldmarktEtf, 60000, 1e-8, 'Geldmarkt bleibt Teil der geschützten Reserve');
    assert(result.sources.length > 0 && result.extraTax > 0, 'Depot finanziert große Steuer samt Kapitalertragsteuer');
    assertClose(result.shortfall, 0, 1e-7, 'Steuer ist gedeckt');
}
{
    const { portfolio, result } = payment({ depot: 10000, gain: 0 }, 100000, { liquidityReserve: 150000 });
    assertClose(portfolio.depotTranchesAktien[0].marketValue, 0, 1e-7, 'Zu kleines Depot wird ausgeschöpft');
    assert(portfolio.liquiditaet < 150000 && portfolio.liquiditaet > 0, 'Danach bezahlt vorhandene Liquidität den Rest');
    assertClose(result.shortfall, 0, 1e-7, 'Kein Ruin bei genügend vorhandenem Geld');
}
{
    const { portfolio, result } = payment({ gain: 0 }, 100000, { liquidityReserve: 200000 });
    assertClose(portfolio.liquiditaet, 150000, 1e-7, 'B4 Schutz erhält nur den vorhandenen Bestand unter dem Ziel; keine Auffüllung');
    assertClose(result.shortfall, 0, 1e-7, 'B4 Depot deckt die Zahlung trotz nicht aufgefüllter Reserve');
}
{
    const { portfolio, result } = payment({ cash: 450000 }, 250000,
        { cashAlreadyRaised: true, inheritedTaxCash: 300000, liquidityReserve: 150000 });
    assertEqual(result.sources.length, 0, 'FR-54: eigens geerbtes Steuergeld zuerst, ohne weitere Verkäufe');
    assertClose(portfolio.liquiditaet, 260000, 1e-7, 'Übrige Liquidität bleibt stehen');
}
for (const [name, config, cost] of [['zero', {}, 0], ['noDepot', { depot: 0 }, 25000]]) {
    assertEqual(hash(payment(config, cost)), controls[name], `${name}: vollständige Zahlung bytegleich zum Ausgangsstand`);
}
assertEqual(hash(noDepotInheritance(applyUnmarriedInheritance, beginPersonalTaxYear)), controls.inheritanceNoDepot,
    'Ohne Depot: vollständiger Nachlass, Zahlungsbeleg und Jahressteuer bytegleich');
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const household = { p1Alive: false, p2Alive: true };
const run = (inputs, state = initMcRunState(inputs), index = 0, data = year) =>
    simulateOneYear(state, inputs, data, index, null, 0, household, 1, EngineAPI);
{
    const married = { ...structuredClone(fixture), partnership: { status: 'married' } };
    const result = run(married);
    assertEqual(result.logData.erbschaftsteuer, 0, 'Ehe mit 100 % unter Freibetrag');
    assertEqual(hash(result), controls.married, 'Steuerfreie Ehe: gesamtes Todesjahr bytegleich');
}
const inputs = { ...structuredClone(fixture), dynamicFlex: false, goldAktiv: false,
    startFloorBedarf: 40000, startFlexBedarf: 20000, minimumFlexAnnual: 0,
    survivorFloorPercent: 75, survivorFlexPercent: 50, survivorMinimumFlexPercent: 50,
    renteMonatlich: 0, rentAdjPct: 0, partner: { ...fixture.partner, monatsrente: 0, brutto: 0 },
    partnership: { status: 'unmarried', inheritance: { muster_a: 100, muster_b: 100 } } };
{
    const state = initMcRunState(inputs);
    const portfolio = { ...state.portfolio, homeRent: { amount: 12000, inflationFactor: 1, active: true } };
    const before = JSON.stringify(portfolio);
    const target = survivorLiquidityTarget({ state, portfolio, inputs: { ...inputs,
        pflegeKostenStaffelPreset: 'custom', pflegeGradeConfigs: { ...inputs.pflegeGradeConfigs,
            4: { ...inputs.pflegeGradeConfigs[4], careForm: 'residential' } } },
        transition: { survivor: { deceasedProfileId: 'muster_a', survivorProfileId: 'muster_b', deathYearIndex: 0 } },
        household: { ...household, care: { p2: { active: true, grade: 4, flexFactor: 0, zusatzFloorZiel: 0 } } },
        yearIndex: 0, inflationFactor: 1, marketData: {},
        pension: calculateHouseholdPensionForYear({ inputs, yearIndex: 0, ...household }) });
    assertEqual(target, calculateTargetLiquidityBalanceLike(inputs, {}, 30000, 0, 0),
        'Reserveziel ohne Wohnmiete des verstorbenen Haushalts bei Heimpflege des Hinterbliebenen');
    assertEqual(JSON.stringify(portfolio), before, 'Zielprojektion verändert keine laufende Mietbuchung');
}
for (const lot of inputs.detailledTranches) { lot.marketValue *= 4; lot.costBasis *= 4; lot.shares *= 4; }
for (const person of inputs.simulationPeople) person.tagesgeld = 200000;
inputs.tagesgeld = 400000;
const death = run(inputs), estate = death.logData.inheritance;
assertEqual(death.kind, 'success', 'Erbfall mit großem Depot rechnet');
assert(death.logData.liqEnd + 2 >= estate.funding.reserveTarget, 'Steuerzahlung verbraucht bei ausreichendem Depot keine Liquidität unter dem Ziel; sie füllt nicht auf');
const next = run(inputs, death.newState, 1);
assertEqual(next.kind, 'success', 'Folgejahr rechnet ohne Ruin');
assert(!/Notfüllung/.test(next.logData.aktionUndGrund || ''), 'Im Folgejahr keine Runway-Notfüllung');
assertClose(estate.funding.saleUsed + estate.funding.liquidityUsed, estate.tax + estate.funding.saleTax, .01,
    'Herkunft stimmt mit Erbschaftsteuer plus Verkaufssteuer auf den Cent überein');
assertClose(death.logData.portfolio_flow_delta, 0, .05, 'Steuerverkauf vollständig bilanziert');
const html = renderProtocolTable([death.logData], { source: 'mc', inputs });
assert(html.includes('Kapitalertragsteuer zur Bezahlung') && html.includes('aus Verkauf') && html.includes('aus Liquidität'),
    'Todesjahr-ⓘ trennt Steuerarten und nennt beide Zahlungsquellen');
assert(!html.includes('aus geerbtem Steuergeld'), 'Ohne FR-54 bleibt der Beleg bei zwei Herkünften');
{
    // Gutachten Fall 7: Haus, geerbtes Tagesgeld und freigegebene Pflegereserve.
    const portfolio = paymentPortfolio({ cash: 110000, moneyMarket: 0, depot: 400000 });
    const deceased = paymentPortfolio({ cash: 100000, moneyMarket: 0, depot: 800000 });
    portfolio.personAccounts.push({ ...deceased.personAccounts[0], profileId: 'max' });
    portfolio.depotTranchesAktien.push(...deceased.depotTranchesAktien.map(lot =>
        ({ ...lot, trancheId: 'max-depot', sourceProfileId: 'max' })));
    portfolio.healthBucketTranches = [];
    portfolio.healthBucketCashOwners = [{ profileId: 'max', amount: 6000 }];
    portfolio.healthBucketCashAmount = portfolio.healthBucketGeldmarkt = 6000;
    portfolio.tagesgeld = portfolio.liquiditaet = 210000;
    beginPersonalTaxYear(portfolio);
    const specialInputs = { ...inputs, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }],
        partnership: { status: 'unmarried', inheritance: { max: 0 }, homeAndTaxInheritance: { max: true } },
        home: [{ id: 'haus', profileId: 'max', nutzung: 'selbst', wert: 400000, stand: '2026-01' }],
        referenceYear: 2026, homeReferenceYear: 2026 };
    const result = applyUnmarriedInheritance({ portfolio, inputs: specialInputs, household, inflationFactor: 1,
        transition: { deathThisYear: true, survivor: { deceasedProfileId: 'max', survivorProfileId: 'erika', deathYearIndex: 0 } },
        pension: { rente1BruttoEigen: 0 }, personalInterest: paymentInterest, actionResult: { steuer: 0 },
        reserveTarget: () => 200000 });
    const estate = result.inheritance, funding = estate.funding;
    assertEqual(estate.homeAndTax, true, 'B3 Fall 7 verwendet Immobilien und Steuergeld');
    assertClose(portfolio.liquiditaet, 110000, .01, 'B3 eigene Liquidität bleibt unverbraucht');
    assertClose(funding.liquidityUsed, 0, .01, 'B3 geerbtes Bargeld zählt nicht als eigene Liquidität');
    assert(funding.inheritedTaxCashUsed > 100000, 'B3 geerbtes Steuergeld enthält die freigegebene Pflegereserve');
    assertClose(funding.inheritedTaxCashUsed, estate.taxCash - funding.saleGross, .01, 'B3 dritte Herkunft enthält nur den geerbten Baranteil');
    assertClose(funding.saleUsed + funding.liquidityUsed + funding.inheritedTaxCashUsed, estate.tax + funding.saleTax,
        .01, 'B3 drei Herkünfte ergeben Erbschaftsteuer plus Kapitalertragsteuer');
    const specialHtml = renderProtocolTable([{ ...death.logData, inheritance: estate }], { source: 'mc', inputs: specialInputs });
    assert(specialHtml.includes('aus geerbtem Steuergeld'), 'B3 Todesjahr-ⓘ nennt die dritte Herkunft');
}
const bearInputs = structuredClone(inputs);
for (const person of bearInputs.simulationPeople) person.tagesgeld = 150000;
bearInputs.tagesgeld = 300000;
const bear = run(bearInputs, undefined, 0, { ...year, rendite: -.35 });
assertEqual(bear.kind, 'success', 'Erbfall im Bärenmarkt rechnet');
assert(bear.logData.inheritance.funding.saleGross > 0, 'Auch im Bärenmarkt wird zur Steuerzahlung verkauft');
assert(bear.logData.liqEnd + 2 >= bear.logData.inheritance.funding.reserveTarget, 'Bärenmarkt wahrt das Reserveziel');
{
    const { measurementInputs } = await import('./helpers/ek-1b-measurement.mjs');
    const residential = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    residential.pflegeKostenStaffelPreset = 'custom';
    residential.pflegeGradeConfigs[3].careForm = 'residential';
    const result = simulateOneYear(initMcRunState(residential), residential, year, 0, null, 0,
        { ...household, care: { p2: { active: true, grade: 3 } } }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Todesjahr mit hinterbliebener Person im Pflegeheim rechnet');
    assertEqual(result.logData.inheritance.residenceIneligible, true, 'Heimpflege verhindert das Wohnrecht');
    const html = renderProtocolTable([result.logData], { source: 'mc', inputs: residential });
    assert(html.includes('Wohnrecht entfällt (Pflegeheim), Haus an die übrigen Erben'), 'Todesjahr-ⓘ erklärt das entfallene Wohnrecht');
    const tooltip = html.match(/class="ds-info protocol-inheritance-info"[\s\S]*?role="tooltip">([\s\S]*?)<\/span><\/span>/)?.[1] || '';
    assert(tooltip.length > 0, 'Todesjahr-ⓘ ist vorhanden');
    assert(tooltip.replace(/<[^>]+>/g, ' ').split(/[.!?](?:\s|$)/).filter(s => s.trim()).length <= 3,
        'Höchstens drei Sätze im Todesjahr-ⓘ');
}
