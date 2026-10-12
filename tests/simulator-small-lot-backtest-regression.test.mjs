import fs from 'node:fs';
import { buildSimulatorEngineInput } from '../app/simulator/simulator-engine-input.js';
import { EngineAPI } from '../engine/index.mjs';
import { initializePortfolio, prepareHistoricalData } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
prepareHistoricalData();
export const base = { startAlter:65, startVermoegen:600000, depotwertAlt:480000, einstandAlt:400000, tagesgeld:120000, geldmarktEtf:0,
 startFloorBedarf:24000, startFlexBedarf:6000, minimumFlexAnnual:0, flexBudgetAnnual:0, flexBudgetRecharge:0,
 renteMonatlich:0, renteStartOffsetJahre:0, rentAdjPct:0, goldAktiv:false, goldZielProzent:0, goldFloorProzent:0, goldSteuerfrei:false,
 risikoprofil:'sicherheits-dynamisch', rebalancingBand:20, liquidityRunwayYears:3, maxSkimPctOfEq:10, maxBearRefillPctOfEq:5,
 marketCapeRatio:20, capeRatio:20, kirchensteuerSatz:0, startSPB:1000, dynamicFlex:false, goGoActive:false,
 pflegefallLogikAktivieren:false, geschlecht:'m', partner:{aktiv:false}, accumulationPhase:{enabled:false} };
export const lot = (type, value, id = type) => ({ trancheId:id, sourceProfileId:'synthetic', type, category:type==='gold'?'gold':type==='geldmarkt'?'money_market':type==='anleihe'?'bonds':'equity', marketValue:value, costBasis:value*.8, purchaseDate:'2000-01-01', tqf:.3 });
function execute(inputs, period, observer = () => {}, engine = EngineAPI) {
 const states=[];
 const result=runHistoricalBacktest({inputs,period,historicalDataProvider:createHistoricalBacktestContractProvider(),initializePortfolio,totalPortfolio:portfolioTotal,
 computeAdjustmentPct:()=>0, resolveHorizon:()=>({horizonYears:30,diagnostics:{longevityMode:'none'}}),
 simulateYear:(...args)=>{ observer(args[0],args[3]); const r=simulateOneYear(...args.slice(0,4),null,0,null,1,engine); states.push(JSON.parse(JSON.stringify(r.newState??null))); return r; },breakOnRuin:true});
 return {result,states};
}

// Dieses Orakel wird ausschließlich gelesen, niemals aus dem aktuellen Code erzeugt.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/simulator-small-lot-controls-v1.json', import.meta.url), 'utf8'));
for (const c of fixture.cases) {
    assertEqual(JSON.stringify(execute(c.inputs, c.period)), JSON.stringify(c.projection), c.name + ': vollständige Finanzbytes und Folgezustände bleiben identisch');
}
const smallInputs = { ...base, startVermoegen:600001, depotwertAlt:0, einstandAlt:0, tagesgeld:600000,
    startFloorBedarf:240000, startFlexBedarf:0,
    detailledTranches:[{...lot('aktien_neu',1),schemaVersion:2,taxExempt:false}] };
const observed = [];
const engine = { ...EngineAPI, simulateSingleYear(input, state) {
    observed.push(structuredClone(input));
    return EngineAPI.simulateSingleYear(input, state);
} };
const small = execute(smallInputs, {startYear:2005,endYear:2009}, () => {}, engine);
assert(['completed','ruin'].includes(small.result.outcome.kind), 'Produktiver historischer Kleinstlotlauf liefert Fachresultat statt technischen Abbruch');
assert(small.states.some(state => state?.portfolio.depotTranchesAktien.some(t => t.simulationLotStatus === 'sold')), 'Produktiver Lauf verkauft das kleine neue Aktienlot');
assert(observed.length >= 3, 'Nach dem Verkauf folgt eine weitere produktive Engineeingabe');
assertEqual(JSON.stringify(observed[2].detailledTranches), '[]', 'Folgejahr darf das ursprüngliche Startlot nicht wieder einsetzen');
assertEqual(observed[2].depotwertNeu, 0, 'Nach Verkauf ist auch das neue Aktienaggregat null');
assertEqual(observed[2].costBasisNeu, 0, 'Nach Verkauf ist die zugehörige Kostenbasis null');
assertEqual(observed[0].depotwertNeu, observed[0].detailledTranches[0].marketValue, 'Renditefortschreibung bindet Lot und Aggregat an denselben echten Wert');
assertEqual(JSON.stringify(smallInputs.detailledTranches), JSON.stringify([{...lot('aktien_neu',1),schemaVersion:2,taxExempt:false}]), 'Produktiver Lauf erhält die ursprünglichen Eingabetranchen');

function inputFor(portfolio) {
    return buildSimulatorEngineInput({inputs:base,portfolio, marketDataCurrentYear:{},marketDataHist:{},yearData:{inflation:0},yearIndex:0,
        liquiditaet:600000,effectiveBaseFloor:24000,baseFlex:0,temporaryFlexFactor:1,baseFlexBudgetAnnual:0,baseFlexBudgetRecharge:0,pensionAnnual:0,resolvedCapeRatio:20}).engineInput;
}
const portfolio = {depotTranchesAktien:[{...lot('aktien_neu',.000001),simulationLotStatus:'sold'}],depotTranchesGold:[],depotTranchesGeldmarkt:[],tagesgeld:600000,liquiditaet:600000};
const orphan = inputFor(portfolio);
assertEqual(orphan.depotwertNeu, 0, 'Bewusst verwaister Sold-Lot-Rest hat vor Engineaufruf kein Aggregat');
assertEqual(orphan.costBasisNeu, 0, 'Verwaister Rest hat auch keine Kostenbasis');
assertEqual(JSON.stringify(orphan.detailledTranches), '[]', 'Verwaister Rest ist kein detaillierter Quellbestand');
portfolio.depotTranchesAktien[0].simulationLotStatus = 'open';
const open = inputFor(portfolio);
assertEqual(open.depotwertNeu, .000001, 'Offenes positives Kleinstlot bleibt ohne Centgrenze verfügbar');
assertEqual(open.detailledTranches[0].marketValue, .000001, 'Kleinstlotdetails behalten denselben echten Wert');
console.log('Kleinstlot-Regression und sieben eingefrorene Finanzkontrollen bestanden.');
const orphanState = structuredClone(small.states[0]);
Object.assign(orphanState.portfolio.depotTranchesAktien[0], {marketValue:.000001,costBasis:.0000008,simulationLotStatus:'sold'});
let boundary;
const orphanYear = simulateOneYear(orphanState, smallInputs, {jahr:2006,rendite:0,inflation:0,zinssatz:0,gold_eur_perf:0},1,null,0,null,1,
    {...EngineAPI,simulateSingleYear(input,state){boundary=structuredClone(input);return EngineAPI.simulateSingleYear(input,state);}});
assertEqual(boundary.depotwertNeu,0,'Echter Engineaufruf erhält für ein verwaistes Sold-Lot-Aggregat null');
assertEqual(boundary.costBasisNeu,0,'Echter Engineaufruf erhält für den verwaisten Rest keine Kostenbasis');
assertEqual(JSON.stringify(boundary.detailledTranches),'[]','Echter Engineaufruf erhält keine erfundenen Ersatzlots');
assertEqual(orphanYear.kind,'success','Verwaister Rest wird ohne Änderung der Aktionsvalidierung verarbeitet');
portfolio.depotTranchesAktien[0].marketValue=1e-12;
assertEqual(inputFor(portfolio).depotwertNeu,1e-12,'Auch ein offenes positives Lot unter der Verkaufsepsilon wird an der Eingabegrenze nicht weggerundet');
