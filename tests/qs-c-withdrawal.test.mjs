import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { EngineAPI } from '../engine/index.mjs';
import { finalizeThreeBucketAction } from '../engine/transactions/three-bucket-logic.mjs';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { initializePortfolio, buyStocksNeu } from '../app/simulator/simulator-portfolio.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
const year = { jahr: 2000, rendite: 0, gold_eur_perf: 0, bond_return: 0, inflation: 2, zinssatz: 0, lohn: 3 };
// Gegenprobe 1: aufgehobener Verlustverkauf darf keinen Verlustvortrag erzeugen.
const lot=(id,type,value,cost)=>({schemaVersion:2,trancheId:id,type,category:type==='anleihe'?'bonds':type==='gold'?'gold':'equity',marketValue:value,costBasis:cost,tqf:type==='aktien_neu'?.3:0,taxExempt:type==='gold',purchaseDate:'2000-01-01'});
const netInput={depotwertAlt:0,depotwertNeu:650000,goldWert:200000,goldCost:200000,tagesgeld:100000,geldmarktEtf:0,inflation:0,renteAktiv:false,renteMonatlich:0,floorBedarf:24000,flexBedarf:12000,aktuellesAlter:67,goldAktiv:true,goldZielProzent:10,goldFloorProzent:0,goldSteuerfrei:true,liquidityRunwayYears:3,risikoprofil:'sicherheits-dynamisch',endeVJ:100,endeVJ_1:95,endeVJ_2:90,endeVJ_3:85,ath:100,jahreSeitAth:0,sparerPauschbetrag:0,kirchensteuerSatz:0,decumulation:{mode:'3_bucket_jilge',bondTargetFactor:5,drawdownTrigger:15},detailledTranches:[lot('eq','aktien_neu',600000,600000),lot('bond','anleihe',50000,100000),lot('gold','gold',200000,200000)],finalizeThreeBucketAction:true};
const netResult=EngineAPI.simulateSingleYear(netInput,{taxState:{lossCarry:0}});
assert(!netResult.error,'QS-C 1: Drei-Töpfe-Gegenprobe rechnet');
assertEqual(netResult.newState.taxState.lossCarry,0,'QS-C 1: aufgehobener Anleihenverkauf erzeugt keinen Verlustvortrag');
assertEqual(netResult.ui.action.quellen.filter(q=>q.category==='bonds').length,0,'QS-C 1: Restauftrag hat keinen Anleihenverkauf');
assertClose(netResult.ui.action.verwendungen.bonds,87000,.01,'QS-C 1: verrechneter Anleihenkauf 87000 Euro');
const gross=EngineAPI.simulateSingleYear({...netInput,deferTaxSettlement:true},{taxState:{lossCarry:0}});
const attributed=attributeHouseholdAction({householdAction:{...gross.ui.action,quellen:gross.ui.action.quellen.map(q=>({...q,sourceProfileId:'a',trancheId:'a:'+q.trancheId}))},profiles:[
 {profileId:'a',inputs:netInput,tranches:netInput.detailledTranches,hasExplicitTrancheOverride:true},
 {profileId:'b',inputs:{...netInput,tagesgeld:0,depotwertNeu:0,goldWert:0},tranches:[],hasExplicitTrancheOverride:true}]});
assertEqual(attributed.profileActions[0].taxStateNext.lossCarry,0,'QS-C 1: auch persönliche Fortschreibung nach Haushaltsattribution ohne fiktiven Verlust');
const records=createMusterHaushaltRecords('2026-10-23','martin-petra');
const plans=JSON.parse(records.household_plan_v1);Object.values(plans.entries).forEach(entry=>entry.values.jointAssessment=true);records.household_plan_v1=JSON.stringify(plans);
assertEqual(buildBalanceEngineInputFromStorage({storage:{getItem:key=>records[key]??null},referenceYear:2026}).engineInput.jointAssessment,false,'QS-C 6: auch Balance schaltet Zusammenveranlagung ohne Ehe aus');
const saved = { document: globalThis.document, window: globalThis.window };
try {
 const sophie = await measurementInputs(0, 'sophie', '2026-10-23');
 const stock = sophie.detailledTranches.find(t=>t.category==='equity');
 assertEqual(stock.tqf, .3, 'QS-C 2: Sophie hat Aktien-ETF mit 30 % Teilfreistellung');
 const portfolio=initializePortfolio(sophie);buyStocksNeu(portfolio,20800);
 assertEqual(portfolio.depotTranchesAktien.at(-1).tqf,.3,'QS-C 2: Nachkauf übernimmt die ETF-Teilfreistellung');
 // Fremde Fondsmerkmale dürfen einen eigenen Kauf ohne Vorlage nicht bestimmen.
 const owned=initializePortfolio({tagesgeld:1000,simulationSourceProfileId:'a',
  simulationPeople:[{profileId:'a',tagesgeld:1000},{profileId:'b',tagesgeld:0}],
  detailledTranches:[{...stock,sourceProfileId:'b',tqf:0}]});
 buyStocksNeu(owned,100,'a');
 assertEqual(owned.depotTranchesAktien.at(-1).tqf,.3,'QS-C 2: eigene ETF-Standardvorlage ohne fremde Teilfreistellung');
 const base={...sophie, plannedExpenses:[], startFloorBedarf:0,startFlexBedarf:0,minimumFlexAnnual:0,dynamicFlex:false,
  renteAktiv:false,renteMonatlich:0,partner:{aktiv:false},detailledTranches:[],tagesgeld:100000,
  simulationPeople:undefined,startSPB:1000,kirchensteuerSatz:0,
  accumulationPhase:{enabled:true,sparrate:1000,sparrateIndexing:'inflation'},transitionYear:3};
 for(const [indexing,factor] of [['none',1],['inflation',1.02],['wage',1.03]]){
  const inputs={...base,accumulationPhase:{...base.accumulationPhase,sparrateIndexing:indexing}};
  let state=initMcRunState(inputs,4);
  for(let i=0;i<2;i++){
   const result=simulateOneYear(state,inputs,year,i,null,0,null,1,EngineAPI);
   assertEqual(result.kind,'success','QS-C 4: Ansparjahr abgeschlossen');
   assertClose(result.newState.accumulationState.sparrateThisYear,12000*factor**i,.01,`QS-C 4: ${indexing} Jahr ${i+1}`);
   state=result.newState;
  }
  const historical=backtest(inputs,2000,2001);
  assertEqual(historical.outcome.kind,'completed','QS-C 4: historischer Ansparlauf abgeschlossen');
  const totals=historical.rows.map(({row})=>Number(/Sparrate: ([\d.]+)/.exec(row.aktionUndGrund)?.[1]));
  assertClose(totals[0],12000,.01,'QS-C 4: erstes Backtestjahr mit konfigurierter Sparrate');
  assertClose(totals[1],12000*(indexing==='inflation'?1+historical.rows[1].row.inflation/100:indexing==='wage'?1+createHistoricalBacktestContractProvider().getRecord(2001).realized.wagePensionAdjustment.value/100:1),.01,'QS-C 4: Folgesparrate wird fortgeschrieben');
 }
 const taxInputs={...base,accumulationPhase:{enabled:true,sparrate:0},startSPB:1000};
 const interestYear={...year,inflation:0,zinssatz:4};
 const result=simulateOneYear(initMcRunState(taxInputs,4),taxInputs,interestYear,0,null,0,null,1,EngineAPI);
 assertEqual(result.kind,'success','QS-C 5: Altformat-Ansparjahr rechnet');
 assertClose(result.logData.cashInterestEarned,4000,.01,'QS-C 5: 4000 Euro Zinsen');
 assertClose(result.totalTaxesThisYear,791.25,.01,'QS-C 5: Zinsen im Altformat werden besteuert');
 assertClose(result.logData.portfolio_total_end,103208.75,.01,'QS-C 5: Endvermögen enthält Zinssteuer');
 const pair=await measurementInputs(0,'martin-petra','2026-10-23');
 const unmarried={...pair,jointAssessment:true,fixedIncome:[],plannedInflows:[],plannedExpenses:[],home:[],pflegefallLogikAktivieren:false,startFloorBedarf:12000,startFlexBedarf:0,minimumFlexAnnual:0,dynamicFlex:false,
  detailledTranches:[],tagesgeld:100000,simulationPeople:pair.simulationPeople.map((p,i)=>({...p,tagesgeld:i?0:100000,sparerPauschbetrag:1000})),
  renteAktiv:true,renteMonatlich:1000,partner:{...pair.partner,aktiv:true,brutto:0},careToday:null,immobilien:[]};
 const run=(ctx,jointAssessment)=>{const state=initMcRunState(unmarried,4);
  state.marketDataHist={...state.marketDataHist,endeVJ:70,endeVJ_1:100,endeVJ_2:100,endeVJ_3:100,ath:100,jahreSeitAth:1};
  return simulateOneYear(state,{...unmarried,jointAssessment},{...year,inflation:0,zinssatz:5},0,null,0,ctx,1,EngineAPI);};
 const context={p1Alive:true,p2Alive:true,widowBenefits:{p1FromP2:false,p2FromP1:false}};
 for(const ctx of [null,context]) {
  assertClose(run(ctx,true).totalTaxesThisYear,run(ctx,false).totalTaxesThisYear,.01,'QS-C 6: ohne Ehe gilt Einzelveranlagung mit und ohne Ereigniskontext');
  assertClose(run(ctx,true).totalTaxesThisYear,1055,.01,'QS-C 6: 5000 Euro Zinsen verbrauchen nur den eigenen Pauschbetrag');
 }
} finally {Object.assign(globalThis,saved);setAppTestDate(null);P.resetPersistenceRuntimeForTests();}
// Gegenprobe 3: 0,5 und 1 Prozent müssen vor Aktienverkäufen bei -2 % schützen.
for(const trigger of [.5,1,1.1]){
 const lots=[{schemaVersion:2,trancheId:'qs-c-eq',type:'aktien_neu',category:'equity',marketValue:100000,costBasis:100000,tqf:.3}];
 const result=finalizeThreeBucketAction({detailedTranches:lots,engineInput:{detailledTranches:lots,decumulation:{mode:'3_bucket_jilge',bondTargetFactor:5,drawdownTrigger:trigger},sparerPauschbetrag:0,kirchensteuerSatz:0},
  market:{sKey:'peak_stable'},pendingAction:{type:'NONE',quellen:[],verwendungen:{liquiditaet:0,aktien:0,gold:0},steuer:0,nettoErlös:0},realReturnEq:-.02,annualWithdrawalTarget:10000,currentBondValuation:0});
 assertEqual(result.threeBucketState.isBadYear,true,`QS-C 3: ${trigger} Prozent schützt bei -2 Prozent`);
 assertEqual(result.updatedAction.verwendungen.bonds||0,0,'QS-C 3: kein Aktienverkauf für Anleihenauffüllung');
}
