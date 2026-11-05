import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { personalAssetValues, unmarriedYearShares, unmarriedWithdrawalPlan } from '../app/simulator/simulator-unmarried.js';
import { applyUnmarriedInheritance, homeValueAtDeath } from '../app/simulator/simulator-inheritance.js';
import { beginPersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { inheritanceTax } from '../app/profile/household-partnership.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
const same = (a,b,label) => assertEqual(JSON.stringify(a),JSON.stringify(b),label);
const year = { jahr:2000,inflation:0,rendite:0,gold_eur_perf:0,zinssatz:0 };
const inputs = { ...structuredClone(fixture), partnership:{schemaVersion:1,status:'unmarried',inheritance:{muster_a:0,muster_b:0}} };
const household = {p1Alive:false,p2Alive:true,widowBenefits:{p2FromP1:true,p2FromP1Percent:.55}};
const first = simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,household,1,EngineAPI);
assertEqual(first.kind,'success','Nicht verheiratet: Sterbejahr berechenbar');
assertEqual(first.logData.BereavementQuarterP2,0,'Keine Zahlung im Sterbevierteljahr trotz eingeschalteter Einstellung');
assertEqual(first.newState.widowPensionP2,0,'Keine Witwenrentenbasis');
assert(first.logData.abgang_erben>0,'Bei null Prozent verlässt der gesamte Nachlass den Haushalt');
assertEqual(first.logData.erbschaftsteuer,0,'Ohne Erbe keine Erbschaftsteuer');
assertEqual(first.newState.portfolio.personAccounts.length,1,'Nur eigenes Konto von B bleibt');
assert(first.newState.portfolio.depotTranchesAktien.every(lot=>lot.sourceProfileId==='muster_b'),'Keine Tranche der verstorbenen Person verbleibt');
assertClose(first.logData.portfolio_flow_delta,0,.03,'Nachlass ist vollständig in der Jahresbilanz erklärt');
const second = simulateOneYear(first.newState,inputs,year,1,null,0,household,1,EngineAPI);
assertEqual(second.kind,'success','Auch das Folgejahr bleibt berechenbar');
assertEqual(second.newState.widowPensionP2,0,'Im Folgejahr weiterhin keine Witwenrente');
function estate(percent,{cash=100000,stock=0,home=0}={}){
 const portfolio={simulationSourceProfileId:'a',personAccounts:[{profileId:'a',tagesgeld:cash,sparerPauschbetrag:0,taxState:{lossCarry:0},kirchensteuerSatz:0},{profileId:'b',tagesgeld:10000,sparerPauschbetrag:0,taxState:{lossCarry:0},kirchensteuerSatz:0}],depotTranchesAktien:stock?[{schemaVersion:2,trancheId:'stock',sourceProfileId:'a',type:'aktien_neu',category:'equity',marketValue:stock,costBasis:stock/2,shares:stock/100,purchasePrice:50,currentPrice:100,purchaseDate:'2020-01-01',tqf:.3,taxExempt:false}]:[],depotTranchesGold:[],depotTranchesGeldmarkt:[],healthBucketTranches:[],healthBucketCashOwners:[]};
 beginPersonalTaxYear(portfolio);
 const actionResult={steuer:0};
 const log=applyUnmarriedInheritance({portfolio,transition:{deathThisYear:true,survivor:{deceasedProfileId:'a',survivorProfileId:'b'}},inputs:{simulationPeople:[{profileId:'a'},{profileId:'b'}],referenceYear:2026,partnership:{status:'unmarried',inheritance:{a:percent}},home:[{profileId:'a',wert:home,stand:'2026-10'}]},inflationFactor:1,pension:{rente1BruttoEigen:12000},personalInterest:{items:[]},actionResult});
 return {portfolio,log,actionResult};
}
const zero=estate(0);
assertEqual(zero.portfolio.tagesgeld,10000,'p=0: B behält nur das eigene Tagesgeld');
const full=estate(100);
assertEqual(full.log.erbschaftsteuer,24000,'p=100: 30 Prozent nach 20.000 Euro Freibetrag');
assertEqual(full.portfolio.tagesgeld,86000,'Erbschaftsteuer vollständig vom Tagesgeld bezahlt');
assertEqual(full.actionResult.steuer,0,'Erbschaftsteuer steht nicht in Einkommensteuer');
const sale=estate(100,{cash:0,stock:100000});
assert(sale.log.inheritancePayment.sources.length>0,'Steuer über Tagesgeld hinaus löst eigenen Verkauf aus');
assert(sale.log.inheritancePayment.extraTax>0,'Verkauf zur Zahlung löst Kapitalertragsteuer aus');
assertClose(sale.log.inheritancePayment.shortfall,0,.01,'Steuer samt Verkaufssteuer gedeckt');
const property=estate(100,{home:660000});
assertEqual(property.log.erbschaftsteuer,222000,'Immobilie erhöht die Steuer ohne Verkauf der Immobilie');
assertEqual(property.log.inheritancePayment.shortfall>0,true,'Unverkäufliche Immobilie kann eine ungedeckte Steuer auslösen');
assertEqual(inheritanceTax(7020000),2550000,'Klasse III: Stufentarif mit Härteausgleich oberhalb 6 Mio.');
const partial=estate(50,{stock:10000});
const lot=partial.portfolio.depotTranchesAktien[0];
assertEqual(lot.marketValue,5000,'Teilnachlass halbiert Kurswert');
assertEqual(lot.costBasis,2500,'Teilnachlass erhält anteilige Anschaffungskosten');
assertEqual(lot.shares,50,'Teilnachlass erhält anteilige Stückzahl');
assertEqual(lot.purchaseDate,'2020-01-01','Anschaffungsdatum bleibt erhalten');
const assets={personAccounts:[{profileId:'a',tagesgeld:75000},{profileId:'b',tagesgeld:25000}]};
const shares=unmarriedYearShares(assets,{simulationPeople:[{profileId:'a'},{profileId:'b'}]}, {},false,{p1Alive:true,p2Alive:true},0);
same(unmarriedWithdrawalPlan(shares,10000,assets).items.map(r=>r.withdrawalAmount),[7500,2500],'Gemeinsame Ausgaben nach Jahresanfangsanteilen');
const careShares=unmarriedYearShares(assets,{simulationPeople:[{profileId:'a'},{profileId:'b'}]}, {p2:{active:true,zusatzFloorZiel:30000}},false,{p1Alive:true,p2Alive:true},30000);
same(unmarriedWithdrawalPlan(careShares,40000,assets).items.map(r=>r.withdrawalAmount),[15000,25000],'Pflege zuerst eigenes Vermögen, Rest vom Partner');
for(const status of ['unmarried','married'])for(const percent of [0,50,100]){
 const result=calculateFixedIncomeForYear({inputs:{partnership:{status,inheritance:{a:percent}},fixedIncomeReferenceYear:2026,simulationPeople:[{profileId:'a'},{profileId:'b'}],fixedIncome:[{id:'immobilie:x',profileId:'a',art:'sonstige',betragMonat:650,ab:null,bis:null,anpassung:'inflation'}]},state:{survivor:{deceasedProfileId:'a',survivorProfileId:'b'}},yearIndex:1,inflationFactor:1.1,household:{p1Alive:false,p2Alive:true},deathThisYear:false});
 assertClose(result.total,7800*1.1*(status==='married'?1:percent/100),1e-8,'Miete folgt dem geerbten Immobilienanteil');
 assertEqual(result.persons[0].profileId,'b','Geerbte Miete gehört B');
}
assertClose(homeValueAtDeath({wert:100000,stand:'2026-10'},{referenceYear:2026},1.1),110000,1e-8,'Immobilienkurswert mit kumulierter Inflation');
const html=renderProtocolTable([first.logData],{source:'mc',inputs,logDetailLevel:'detailed'});
assert(html.includes('Erbe:'),'Handlung nennt den Nachlass');
assert(html.includes('An Erben')&&html.includes('Erbschaftsteuer'),'Detailprotokoll enthält die getrennten Spalten');
function cashInputs(){
 const result={...structuredClone(inputs),startVermoegen:100000,depotwertAlt:0,depotwertNeu:0,einstandAlt:0,einstandNeu:0,tagesgeld:100000,geldmarktEtf:0,detailledTranches:[],startFloorBedarf:10000,startFlexBedarf:0,minimumFlexAnnual:0,renteMonatlich:0,partner:{...inputs.partner,monatsrente:0,brutto:0,startInJahren:0,renteStartMonate:12},goldStrategyDiagnostics:[]};
 result.simulationPeople[0].tagesgeld=75000;result.simulationPeople[1].tagesgeld=25000;
 return result;
}
const both={p1Alive:true,p2Alive:true};
for(const kind of ['shared','income','inflow','expense','care','care-overflow']){
 const input=cashInputs();let care=0,ctx=both;
 if(kind==='income')input.renteMonatlich=1000;
 if(kind==='inflow'){input.plannedInflows=[{profileId:'muster_a',year:2026,amount:10000,label:'Einmalig'}];input.plannedInflowsReferenceYear=2026;}
 if(kind==='expense'){input.plannedExpenses=[{id:'auto',bezeichnung:'Auto',art:'einmalig',betrag:10000,monat:'2026-01'}];input.plannedExpensesReferenceYear=2026;}
 if(kind.startsWith('care')){care=kind==='care'?20000:30000;ctx={...both,care:{p2:{active:true,grade:3,zusatzFloorZiel:care,zusatzFloorDelta:care}}};}
 const state=initMcRunState(input),result=simulateOneYear(state,input,year,0,null,care,ctx,1,EngineAPI);
 assertEqual(result.kind,'success',`${kind}: vollständiger persönlicher Jahrespfad`);
 const actual=personalAssetValues(result.newState.portfolio),a=actual.find(r=>r.profileId==='muster_a').value,b=actual.find(r=>r.profileId==='muster_b').value;
 const spending=result.logData.entscheidung.jahresEntnahme+(result.logData.renteSum||0)+(result.logData.sonstige_einkuenfte||0)-(result.logData.einkuenfte_gespart||0);
 const common=spending-care+(result.logData.geplante_ausgaben||0),careB=Math.min(care,Math.max(0,25000-common*.25));
 assertClose(a,75000+(kind==='income'?12000:0)+(kind==='inflow'?10000:0)-common*.75-(care-careB),.03,`${kind}: A trägt exakt Jahresanfangsanteil und nötigen Pflegerest`);
 assertClose(b,25000-common*.25-careB,.03,`${kind}: B trägt exakt eigenen Anteil und eigene Pflege`);
 assertClose(result.logData.portfolio_flow_delta,0,.03,`${kind}: Jahresbilanz stimmt`);
}
for(const percent of [50,100]){
 const input={...structuredClone(inputs),partnership:{status:'unmarried',inheritance:{muster_a:percent}}};
 const result=simulateOneYear(initMcRunState(input),input,year,0,null,0,household,1,EngineAPI);
 assertEqual(result.kind,'success',`p=${percent}: Jahrespfad samt Kapitalertragsteuer`);
 assertClose(result.logData.portfolio_flow_delta,0,.05,`p=${percent}: auch Steuerverkauf und Nachlass sind vollständig bilanziert`);
 assertClose(result.logData.erbschaftsteuer,inheritanceTax(result.logData.inheritance.inherited),.01,`p=${percent}: Steuer mit Kurswert am Jahresende`);
 assertClose(result.logData.steuern_gesamt,result.ui.action.taxSettlement.executedTaxContract.finalAnnualTax,.01,`p=${percent}: Einkommensteuervertrag stimmt weiterhin`);
}
const healthInput={...structuredClone(inputs),healthBucket:{...inputs.healthBucket,enabled:true,initialAmount:20000},healthBucketEnabled:true,healthBucketInitialAmount:20000};
const healthResult=simulateOneYear(initMcRunState(healthInput),healthInput,year,0,null,0,household,1,EngineAPI);
assertEqual(healthResult.kind,'success','Nachlass mit Pflegereserve berechenbar');
assertClose(healthResult.logData.portfolio_flow_delta,0,.05,'Abgang aus Pflegereserve gehört zur Gesamtbilanz, nicht zur aktiven Bilanz');
assertEqual(healthResult.newState.portfolio.healthBucketGeldmarkt,0,'Reserve der verstorbenen Person verlässt bei p=0 den Haushalt');
const saleInput={...structuredClone(inputs),partnership:{status:'unmarried',inheritance:{muster_a:100}},tagesgeld:0,geldmarktEtf:0};
saleInput.simulationPeople.forEach(person=>person.tagesgeld=0);
saleInput.detailledTranches=saleInput.detailledTranches.filter(lot=>lot.category!=='money_market');
const saleState=initMcRunState(saleInput),initialStock=saleState.portfolio.depotTranchesAktien.reduce((s,lot)=>s+lot.marketValue,0);
const saleYear=simulateOneYear(saleState,saleInput,year,0,null,0,household,1,EngineAPI);
assertEqual(saleYear.kind,'success','Erbschaftsteuer ohne Tagesgeld und Geldmarkt durch Verkauf gedeckt');
assertClose(saleYear.logData.vk.vkGes,initialStock-saleYear.logData.wertAktien+(saleYear.logData.kaufAkt||0),.1,'Eigene und geerbte Steuerverkäufe zählen genau einmal');
const impossibleTaxInput={...structuredClone(inputs),partnership:{status:'unmarried',inheritance:{muster_a:100}},home:[{profileId:'muster_a',wert:100000000,stand:'2026-10'}]};
const taxRuin=simulateOneYear(initMcRunState(impossibleTaxInput),impossibleTaxInput,year,0,null,0,household,1,EngineAPI);
assertEqual(taxRuin.kind,'success','FR-61 verkauft die Immobilie vor einem drohenden Steuerruin');
assertEqual(taxRuin.logData.immobilien_notverkauf,true,'Notverkauf wird auch im Todesjahr protokolliert');
assertClose(taxRuin.logData.immobilienverkauf,90000000,.01,'90 Prozent stehen vor der Nachlassrechnung bereit');
const { buildMonteCarloRuinLogRow }=await import('../app/simulator/mc-log-builder.js');
// Die reine Nachlassrechnung oben liefert weiterhin einen echten Steuerfehlbetrag;
// ihre Projektion bleibt unabhängig vom neuen Verkauf im Jahreskoordinator prüfbar.
const terminal=buildMonteCarloRuinLogRow({result:{logData:property.log},simulationsJahr:0,yearData:year,inputs:impossibleTaxInput,lifeLogContext:{hasPartner:true,p1Alive:false,p2Alive:true}});
assert(terminal.erbschaftsteuer>0&&terminal.inheritance,'Auch beim Steuerruin bleibt die Aufschlüsselung im MC-Protokoll');
const {projectScenarioLogV2,serializeScenarioLogCsvV2}=await import('../app/simulator/monte-carlo-export.js');
const exported=projectScenarioLogV2([terminal]);
assertEqual(exported.records[0].erbschaftsteuer,terminal.erbschaftsteuer,'JSON erhält die getrennte Erbschaftsteuer');
assert(serializeScenarioLogCsvV2(exported).includes('abgang_erben')&&serializeScenarioLogCsvV2(exported).includes('erbschaftsteuer'),'CSV ergänzt beide Exportfelder');
const { payPersonalExtraCost }=await import('../app/simulator/simulator-personal-tax.js');
const { settleTaxYear }=await import('../engine/tax-settlement.mjs');
const lossPortfolio={simulationSourceProfileId:'b',personAccounts:[{profileId:'b',tagesgeld:0,sparerPauschbetrag:0,taxState:{lossCarry:0},kirchensteuerSatz:0}],depotTranchesAktien:[{schemaVersion:2,trancheId:'loss',sourceProfileId:'b',type:'aktien_neu',category:'equity',marketValue:50000,costBasis:100000,shares:500,purchasePrice:200,currentPrice:100,purchaseDate:'2020-01-01',tqf:0,taxExempt:false}],depotTranchesGold:[],depotTranchesGeldmarkt:[]};
const lossBook=beginPersonalTaxYear(lossPortfolio),prior=settleTaxYear({...lossBook[0],rawAggregate:{sumRealizedGainSigned:0,sumTaxableAfterTqfSigned:10000}});
const lossAction={steuer:prior.taxDue,personalAnnualTaxes:[{profileId:'b',taxDue:prior.taxDue,saleTaxDue:0,taxCashAdjustment:-prior.taxDue,details:prior.details}],taxSettlement:{...prior.details,taxCashAdjustment:-prior.taxDue,saleTaxDue:0,cashInterestTaxDelta:prior.taxDue}};
const lossPayment=payPersonalExtraCost(lossPortfolio,'b',10000,{items:[{profileId:'b',cashInterest:10000}]},lossAction);
assertClose(lossPayment.extraTax,-prior.taxDue,.01,'Steuerverkauf mit Verlust erstattet die bereits bezahlte Jahressteuer');
assertClose(lossPortfolio.tagesgeld,prior.taxDue,.01,'Erstattung geht auf das Tagesgeld der lebenden Person');
assertClose(lossAction.steuer,0,.01,'Jahressteuer berücksichtigt auch neue Verluste aus dem Steuerverkauf');
