const assert = Object.assign((value, message = 'FR-61/62: Bedingung erfüllt') => globalThis.assert(value, message), {
    equal: (actual, expected, message = 'FR-61/62: Betrag oder Zustand entspricht der Fachregel') => assertEqual(actual, expected, message)
});
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { sellHomesForEmergency, homeRentForYear, moneyAssets } from '../app/simulator/simulator-home-sale.js';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { homeValueAtDeath } from '../app/simulator/simulator-inheritance.js';
import { renderProtocolTable, protocolActionShortText } from '../app/simulator/protocol-renderer.js';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const alive = { p1Alive: true, p2Alive: false };
function base(partner = false, cash = 10000) {
    const inputs = structuredClone(fixture);
    Object.assign(inputs.partner, { aktiv: partner, brutto: 0, monatsrente: 0 });
    inputs.simulationPeople = inputs.simulationPeople.slice(0,partner ? 2 : 1);
    for (const person of inputs.simulationPeople) Object.assign(person, { tagesgeld: cash, geldmarktEtf: 0 });
    Object.assign(inputs, { tagesgeld: cash * inputs.simulationPeople.length, geldmarktEtf: 0, startVermoegen: cash * inputs.simulationPeople.length,
        detailledTranches: [], startFloorBedarf: 20000, startFlexBedarf: 0, minimumFlexAnnual: 0,
        renteMonatlich: 0, rente1: 0, rente2: 0, survivorFloorPercent: 75, fixedIncome: [], homeReferenceYear: 2026, fixedIncomeReferenceYear: 2026,
        home: [{ profileId: inputs.simulationPeople[0].profileId, id: 'haus', wert: 300000, stand: '2026-10', nutzung: 'selbst' }] });
    return inputs;
}
{
    const inputs = base(), original = initMcRunState(inputs), before = JSON.stringify(original);
    const first = simulateOneYear(original,inputs,year,0,null,0,alive,1,EngineAPI);
    assert.equal(first.kind,'success'); assert.equal(first.logData.immobilien_notverkauf,true);
    assert.equal(first.logData.immobilienverkauf,270000); assert.equal(first.logData.immobilienverkauf_jahr,2026);
    assert.equal(first.logData.wohnmiete,12000); assert.equal(first.logData.floor_brutto,32000);
    assert(Math.abs(first.logData.portfolio_flow_delta)<.01);
    assert.equal(JSON.stringify(original),before,'Versuche verändern den Anfangszustand nicht');
    const second = simulateOneYear(first.newState,inputs,{ ...year,inflation:10 },1,null,0,alive,1,EngineAPI);
    const third = simulateOneYear(second.newState,inputs,year,2,null,0,alive,1,EngineAPI);
    assert.equal(second.logData.immobilienverkauf,undefined); assert(Math.abs(third.logData.wohnmiete-13200)<1e-8);
    const care = { ...alive, care: { p1: { active:true,grade:4 } } };
    const nursing = simulateOneYear(third.newState,inputs,year,3,null,0,care,1,EngineAPI);
    assert.equal(nursing.logData.wohnmiete,0); assert.equal(nursing.logData.wohnmiete_aktiv,false);
    assert.equal(nursing.logData.immobilienverkauf,undefined);
    const terminalPortfolio = structuredClone(third.newState.portfolio);
    assert.equal(homeRentForYear(terminalPortfolio,inputs,{ p1Alive:false,p2Alive:false },1.1),0);
    assert.equal(terminalPortfolio.homeRent.active,false);
    const row = { ...first.logData,recordType:'financial_year',financiallyEvaluable:true,jahr:1 };
    const breakdown = protocolCashflowBreakdown(row,{ inputs });
    assert.equal(breakdown.expenses.find(item => item.label==='Miete nach Notverkauf').amount,12000);
    assert.equal(breakdown.expenses.reduce((sum,item) => sum+item.amount,0),breakdown.totals.ausgaben_gesamt);
    assert(protocolActionShortText(row).startsWith('Notverkauf Immobilie '));
    const html = renderProtocolTable([row],{ source:'mc',inputs,logDetailLevel:'detailed' });
    assert(html.includes('data-protocol-column="home-rent"'));
    const exported = projectScenarioLogV2([row]);
    assert.equal(exported.records[0].wohnmiete,12000); assert.equal(exported.records[0].immobilien_notverkauf,true);
    const csv = serializeScenarioLogCsvV2(exported);
    for (const field of ['immobilien_notverkauf','wohnmiete','wohnmiete_startjahr','wohnmiete_aktiv']) assert(csv.includes(field));
}
// Jahresanfang reicht noch; der Börsenverlust löst erst vor der Ruinprüfung den Verkauf aus.
{
    const inputs = base(false,0);
    inputs.detailledTranches = [{ ...structuredClone(fixture.detailledTranches.find(lot => lot.category === 'equity')), trancheId:'crash',sourceProfileId:inputs.simulationPeople[0].profileId,
        category:'equity',marketValue:40000,costBasis:40000,shares:100,tqf:.3 }];
    inputs.startVermoegen=40000;
    const state=initMcRunState(inputs), before=JSON.stringify(state);
    const result=simulateOneYear(state,inputs,{ ...year,rendite:-.9 },0,null,0,alive,1,EngineAPI);
    assert.equal(result.kind,'success'); assert.equal(result.logData.immobilien_notverkauf,true);
    assert.equal(result.logData.floor_brutto,32000); assert.equal(JSON.stringify(state),before);
    assert(Math.abs(result.logData.portfolio_flow_delta)<.01,'Keine doppelten Renditen/Zahlungen beim zweiten Versuch');
}
// Haushaltsgeld zählt gemeinsam, einschließlich Anleihen, Geldmarkt und Gold.
{
    const inputs=base(true,15000), state=initMcRunState(inputs);
    const options={ portfolio:state.portfolio,state,inputs,household:{ p1Alive:true,p2Alive:true },yearIndex:0,inflationFactor:1,requiredFloor:20000 };
    assert.equal(sellHomesForEmergency(options),null);
    state.portfolio.depotTranchesGold=[{ marketValue:10000 }];
    assert.equal(moneyAssets(state.portfolio),40000);
    state.portfolio.depotTranchesAktien=[{ category:'bonds',marketValue:10000 }];
    state.portfolio.liquiditaet+=10000;
    assert.equal(moneyAssets(state.portfolio),60000);
    assert.equal(sellHomesForEmergency({ ...options,requiredFloor:60000 }),null,'Grenze ist strikt darunter');
}
// Vermietete Immobilie: Einnahmen enden, keine eigene Miete, für beide Verkaufswege.
for(const nursing of [false,true]) {
    const inputs=base(false,0); inputs.home[0].nutzung='vermietet';
    inputs.fixedIncome=[{ profileId:inputs.home[0].profileId,id:'immobilie:haus',art:'sonstige',betragMonat:1000,anpassung:'keine',ab:null,bis:null }];
    const household=nursing ? { ...alive,care:{ p1:{ active:true,grade:4 } } } : alive;
    const result=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,household,1,EngineAPI);
    assert.equal(result.kind,'success'); assert.equal(result.logData.immobilienverkauf,270000);
    assert.equal(result.logData.sonstige_einkuenfte || 0,0); assert.equal(result.logData.wohnmiete,undefined);
    assert.equal(result.logData.floor_brutto,20000);
}
// Pflegeverkauf hat keine neue Wohnmiete, auch bei selbst genutztem Haus.
{
    const inputs=base(),household={ ...alive,care:{ p1:{ active:true,grade:4 } } };
    const result=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,household,1,EngineAPI);
    assert.equal(result.logData.immobilien_notverkauf,undefined); assert.equal(result.newState.portfolio.homeRent,undefined);
}
for (const deceasedIndex of [0,1]) {
    const inputs=base(true,0),deceasedId=inputs.simulationPeople[deceasedIndex].profileId;
    inputs.home[0].profileId=deceasedId;
    inputs.partnership={ status:'unmarried',inheritance:{ [deceasedId]:0 },homeAndTaxInheritance:{ [deceasedId]:true } };
    const both={ p1Alive:true,p2Alive:true };
    const first=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,both,1,EngineAPI);
    assert.equal(first.kind,'success'); assert.equal(first.logData.wohnmiete,12000);
    // Zusätzliches unmarkiertes Geld sichert die Gegenprobe für Steuergeld X.
    first.newState.portfolio.personAccounts.find(person => person.profileId===deceasedId).tagesgeld+=500000;
    syncPersonalLiquidity(first.newState.portfolio);
    const death={ p1Alive:deceasedIndex!==0,p2Alive:deceasedIndex!==1 };
    const second=simulateOneYear(first.newState,inputs,year,1,null,0,death,1,EngineAPI);
    assert.equal(second.kind,'success'); assert.equal(second.logData.wohnmiete,12000,'Miete bleibt im Todesjahr voll');
    assert(second.logData.inheritance.inheritedSaleProceeds>0);
    assert(second.logData.inheritance.inheritedSaleProceeds<=270000);
    assert(Math.abs(second.logData.inheritance.taxCash-second.logData.inheritance.tax)<1);
    const third=simulateOneYear(second.newState,inputs,year,2,null,0,death,1,EngineAPI);
    assert.equal(third.logData.wohnmiete,12000);
    assert.equal(third.logData.floor_brutto,20000*.75+12000,'FR-55 kürzt die Miete nicht');
    assert(Math.abs(second.logData.portfolio_flow_delta)<.01);
    // Notverkauf erst bei drohendem Ruin im Todesjahr: ursprüngliches Eigentum, dann Nachlass.
    const immediate=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,death,1,EngineAPI);
    assert.equal(immediate.kind,'success'); assert.equal(immediate.logData.immobilien_notverkauf,true);
    assert(immediate.logData.inheritance.inheritedSaleProceeds>0);
}
// Geerbter Anteil wird erst nach dem Nachlass verkauft und begründet nur seinen Mietanteil.
{
    const inputs=base(true,100000),owner=inputs.home[0].profileId;
    inputs.partnership={ status:'unmarried',inheritance:{ [owner]:50 } };
    const death={ p1Alive:false,p2Alive:true };
    const first=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,death,1,EngineAPI);
    assert.equal(first.logData.immobilienverkauf,undefined);
    const state=first.newState;
    for(const account of state.portfolio.personAccounts) { account.tagesgeld=0; account.geldmarktEtf=0; }
    state.portfolio.tagesgeld=0; state.portfolio.geldmarktEtf=0; state.portfolio.liquiditaet=0;
    for (const key of ['depotTranchesAktien','depotTranchesGold','depotTranchesGeldmarkt','healthBucketTranches']) state.portfolio[key]=[];
    state.portfolio.healthBucketCashAmount=0; state.portfolio.healthBucketGeldmarkt=0; state.portfolio.healthBucketCashOwners=[];
    const second=simulateOneYear(state,inputs,year,1,null,0,death,1,EngineAPI);
    assert.equal(second.logData.immobilienverkauf,135000); assert.equal(second.logData.wohnmiete,6000);
    assert.equal(second.logData.immobilienverkauf_personen[0].profileId,inputs.simulationPeople[1].profileId);
}
// Fortschreibung vor dem Abschlag, nominale FR-56-Vormerkung.
{
    const inputs=base(),state=initMcRunState(inputs),factor=1.3;
    const sale=sellHomesForEmergency({ portfolio:state.portfolio,state,inputs,household:alive,yearIndex:4,inflationFactor:factor,requiredFloor:20000 });
    const value=homeValueAtDeath(inputs.home[0],inputs,factor);
    assert.equal(sale.immobilienverkauf,value*.9); assert.equal(state.portfolio.homeRent.amount,value*.04);
    assert.equal(state.portfolio.personAccounts[0].homeSaleProceeds[0].amount,value*.9);
}

// Haushalte ohne Immobilie behalten ihren vollständigen Jahresdatensatz.
{
    const inputs=base(); delete inputs.home;
    const state=initMcRunState(inputs);
    const without=simulateOneYear(structuredClone(state),inputs,year,0,null,0,alive,1,EngineAPI);
    const empty=simulateOneYear(structuredClone(state),{ ...inputs,home:[] },year,0,null,0,alive,1,EngineAPI);
    assert.equal(JSON.stringify(empty),JSON.stringify(without),'Ohne Immobilien keine neuen Zustands- oder Logfelder');
}

// Genau ein Jahresbedarf löst noch nicht aus; erst das folgende Jahr verkauft.
{
    const inputs=base(false,20000),state=initMcRunState(inputs);
    const first=simulateOneYear(state,inputs,year,0,null,0,alive,1,EngineAPI);
    assert.equal(first.logData.immobilienverkauf,undefined);
    const second=simulateOneYear(first.newState,inputs,year,1,null,0,alive,1,EngineAPI);
    assert.equal(second.kind,'success'); assert.equal(second.logData.immobilienverkauf_jahr,2027);
    assert.equal(second.logData.immobilienverkauf,270000); assert.equal(second.logData.wohnmiete,12000);
}
// Auch bei einem zu kleinen Hauserlös bleiben Verkauf und Miete in der Ruinprojektion.
{
    const inputs=base(false,0);inputs.home[0].wert=4000;
    const result=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,alive,1,EngineAPI);
    assert.equal(result.kind,'ruin'); assert.equal(result.newState.portfolio.homeSales.length,1);
    const { buildMonteCarloRuinLogRow }=await import('../app/simulator/mc-log-builder.js');
    const terminal=buildMonteCarloRuinLogRow({ result,simulationsJahr:0,yearData:year,inputs,
        lifeLogContext:{ hasPartner:false,p1Alive:true,p2Alive:false } });
    assert.equal(terminal.immobilien_notverkauf,true); assert.equal(terminal.wohnmiete,160);
    assert.equal(projectScenarioLogV2([terminal]).records[0].wohnmiete,160);
}

// VF-2b: Nur so viele Immobilien wie nötig; Vermietung vor Selbstnutzung.
{
    const inputs = base(false, 0), owner = inputs.home[0].profileId;
    inputs.home.push({ ...inputs.home[0], id: 'wohnung', nutzung: 'vermietet', wert: 100000 });
    const first = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, alive, 1, EngineAPI);
    assert.equal(first.kind, 'success');
    assert.equal(first.logData.immobilienverkauf_personen.length, 1);
    assert.equal(first.logData.immobilienverkauf_personen[0].homeId, 'wohnung');
    assert.equal(first.logData.wohnmiete, undefined, 'Nicht verkaufte Selbstnutzung erzeugt keine Miete');
    assert.equal(first.newState.portfolio.homeSales.length, 1, 'Haus bleibt unverkauft');
    assert.equal(inputs.home[0].wert, 300000, 'Verbliebener Hauswert unverändert');
}
// Eingabereihenfolge bleibt bei gleicher Nutzung erhalten; ein Verkauf reicht vor Ruin.
for (const small of [false, true]) {
    const inputs = base(false, 0);
    inputs.home = [{ ...inputs.home[0], id: 'erste', nutzung: 'vermietet', wert: small ? 10000 : 50000 },
        { ...inputs.home[0], id: 'zweite', nutzung: 'vermietet' }];
    inputs.detailledTranches = [{ ...structuredClone(fixture.detailledTranches.find(lot => lot.category === 'equity')),
        trancheId: 'crash', sourceProfileId: inputs.simulationPeople[0].profileId,
        category: 'equity', marketValue: 40000, costBasis: 40000, shares: 100, tqf: .3 }];
    inputs.startVermoegen = 40000;
    const state = initMcRunState(inputs), before = JSON.stringify(state);
    const result = simulateOneYear(state, inputs, { ...year, rendite: -.99 }, 0, null, 0, alive, 1, EngineAPI);
    assert.equal(result.kind, 'success');
    assert.equal(result.logData.immobilienverkauf_personen.length, small ? 2 : 1);
    assert.equal(result.logData.immobilienverkauf_personen[0].homeId, 'erste');
    assert.equal(JSON.stringify(state), before, 'Wiederholungen erhalten den ursprünglichen Jahreszustand');
    assert(Math.abs(result.logData.portfolio_flow_delta) < .01, 'Keine doppelte Jahresbuchung bei Einzelverkäufen');
}
// Im Todesjahr steht das Haus der verstorbenen Person vor einer vermieteten Wohnung.
for (const deceasedIndex of [0, 1]) {
    const inputs = base(true, 0), owner = inputs.simulationPeople[deceasedIndex].profileId;
    inputs.home = [{ ...inputs.home[0], id: 'lebend', nutzung: 'vermietet', profileId: inputs.simulationPeople[1 - deceasedIndex].profileId },
        { ...inputs.home[0], id: 'verstorben', profileId: owner }];
    const state = initMcRunState(inputs);
    const sale = sellHomesForEmergency({ portfolio: state.portfolio, state, inputs,
        household: { p1Alive: deceasedIndex !== 0, p2Alive: deceasedIndex !== 1 },
        yearIndex: 0, inflationFactor: 1, requiredFloor: 20000, beforeRuin: true, maxSales: 1 });
    assert.equal(sale.immobilienverkauf_personen.length, 1);
    assert.equal(sale.immobilienverkauf_personen[0].homeId, 'verstorben');
    assert.equal(sale.immobilienverkauf_personen[0].profileId, owner);
}
// Späterer zweiter Verkauf erhält die Miete aus dem ersten Verkauf samt Inflation.
{
    const inputs = base(false, 0); inputs.home.push({ ...inputs.home[0], id: 'zweites', wert: 400000 });
    const state = initMcRunState(inputs), options = { portfolio: state.portfolio, state, inputs, household: alive,
        yearIndex: 0, inflationFactor: 1, requiredFloor: 20000 };
    const first = sellHomesForEmergency(options);
    assert.equal(first.immobilienverkauf_personen.length, 1);
    state.portfolio.personAccounts[0].tagesgeld = 0; syncPersonalLiquidity(state.portfolio);
    const second = sellHomesForEmergency({ ...options, yearIndex: 1, inflationFactor: 2 });
    assert.equal(second.immobilienverkauf_personen.length, 1);
    assert.equal(state.portfolio.homeRent.amount, 56000, 'Beide verkauften Selbstnutzungen tragen Miete');
    assert.equal(state.portfolio.homeRent.startYear, 2026);
}
