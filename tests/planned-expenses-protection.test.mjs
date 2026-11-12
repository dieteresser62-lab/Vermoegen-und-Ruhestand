import { EngineAPI } from '../engine/index.mjs';
import { applyThreeBucketLogic } from '../engine/transactions/three-bucket-logic.mjs';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { withPlannedExpensePrices } from '../app/balance/balance-inflation-source.js';
import { projectPlannedPosts } from '../app/balance/balance-planned-posts.js';
import { createPlannedPostsView } from '../app/balance/balance-planned-posts-renderer.js';
import { plannedExpensesForYear } from '../app/profile/household-planned-expenses.js';
import { planScope } from '../app/profile/household-plan.js';
import { CONFIG } from '../app/balance/balance-config.js';
const close = (a,b,text) => assertClose(a,b,.02,text);
const decumulation = { mode: '3_bucket_jilge', bondTargetFactor:5, drawdownTrigger:15, bondRefillThreshold:null };
const lot = (id, value, bonds=false) => ({ schemaVersion:2, trancheId:id, sourceProfileId:'max', type:bonds?'anleihe':'aktien_neu',
    category:bonds?'bonds':'equity', shares:value/100, purchasePrice:100, currentPrice:100, marketValue:value, costBasis:value, purchaseDate:'2020-01-01', tqf:0, taxExempt:true });
for (const bondValue of [100000, 2000, 0]) {
    const lots = [lot('stock',300000), ...(bondValue ? [lot('bond',bondValue,true)] : [])];
    const pending = { nettoErlös:50000, steuer:0, quellen:[{kind:'aktien_neu',brutto:50000}], verwendungen:{liquiditaet:50000}, plannedExpenseFunding:true };
    const result = applyThreeBucketLogic(lots, { decumulation, plannedExpenseLiquidityReserve:35000, sparerPauschbetrag:0,
        detailledTranches:lots, depotwertNeu:300000, depotwertAlt:0, goldWert:0 }, {}, pending, -.25, bondValue);
    const bonds = result.updatedAction.quellen.filter(q=>q.category==='bonds').reduce((s,q)=>s+q.netto,0);
    const stocks = result.updatedAction.quellen.filter(q=>q.category!=='bonds').reduce((s,q)=>s+q.netto,0);
    close(bonds, Math.min(bondValue,50000), 'Balance im Bär: vorhandene Anleihen zuerst');
    close(stocks, Math.min(35000,Math.max(0,50000-bonds)), 'Balance: Aktien decken höchstens den ungedeckten Ausgabenteil');
    close(result.updatedAction.verwendungen.liquiditaet,result.updatedAction.nettoErlös,'Verwendungen stimmen mit erzieltem Netto überein');
}
const person = { profile_person_schema_version:'1', profile_geburtsdatum:'1960-01-01', profile_geschlecht:'w', profile_rentenbeginn:'2026-01-01',
    profile_rente_monatlich:'0', profile_rentenanpassung_art:'fix', profile_rentenanpassung_pct:'0', profile_tagesgeld:'0', sim_simStartVermoegen:'300000' };
const single = buildSimulatorInputsFromProfileData(person,{referenceYear:2026,planValues:null});
const base = { ...combineSimulatorProfiles([{profileId:'max',inputs:single}],'max',{planValues:null}).combined,
    startVermoegen:300000, startFloorBedarf:12000,startFlexBedarf:6000, minimumFlexAnnual:0, dynamicFlex:false,
    goldAktiv:false, pflegefallLogikAktivieren:false, healthBucket:{enabled:false}, entnahmeStrategie:'3_bucket_jilge',decumulation,
    maxSkimPctOfEq:0,maxBearRefillPctOfEq:0 };
prepareHistoricalDataOnce();
const simulate = (inputs, data={}) => simulateOneYear(initMcRunState(inputs,0),inputs,
    {jahr:2002,rendite:-.25,gold_eur_perf:0,zinssatz:0,inflation:0,lohn:0,...data},0,null,0,null,1,EngineAPI);
for (const bondValue of [200000, 2000, 0]) for (const amount of [100,35000]) {
    const inputs = { ...base,startVermoegen:300000+bondValue,detailledTranches:[lot('stock',300000),...(bondValue?[lot('bond',bondValue,true)]:[])] };
    const plain = simulate(inputs);
    const paid = simulate({...inputs,plannedExpensesReferenceYear:2026,plannedExpenses:[{id:'auto',monat:'2026-04',betrag:amount,bezeichnung:'Auto'}]});
    assertEqual(paid.kind,'success','Simulator kann die Ausgabe im Bärenjahr bezahlen');
    assertEqual(paid.logData.threeBucket.isBadYear,true,'Nachweis erreicht den Anleihenschutz');
    const stockValue = outcome => outcome.newState.portfolio.depotTranchesAktien.filter(t=>t.category==='equity').reduce((s,t)=>s+t.marketValue,0);
    if (bondValue===200000) close(stockValue(paid),225000,'Volle Anleihen: keine Aktienverkäufe für Bedarf oder Ausgabe');
    else assert(stockValue(plain)-stockValue(paid)<=amount+.02,'Leere/knappe Anleihen: zusätzliche Aktienverkäufe höchstens Ausgabe');
    close(paid.logData.portfolio_flow_delta,0,'Finanzierung und Steuer im Vermögensfluss erklärt');
}
{
    const items=[{id:'auto',monat:'2027-04',betrag:25000,bezeichnung:'Auto',priceYear:2026},
        {id:'kredit',betragMonat:450,ab:'2027-10',bis:'2027-12',anpassung:'inflation',bezeichnung:'Ratenkredit',priceYear:2026}];
    const scope=planScope('single',['max']);
    const storage={getItem:key=>key===CONFIG.STORAGE.LS_KEY?JSON.stringify({inputs:{inflation:2}}):null};
    const priced=withPlannedExpensePrices(items,{storage,scope,referenceYear:2027});
    const posts=projectPlannedPosts({items:priced,year:2027,scope});
    // FR-43 (11.11.2026): Reserve nur für die einmalige Ausgabe; der Kredit steht im Grundbedarf.
    close(posts.reserve,25000*1.02,'Balance im zweiten Planjahr verwendet die gespeicherte Inflation');
    close(posts.items.filter(item=>item.fixed).reduce((s,item)=>s+item.amount,0),1350*1.02,'Feste Monatsposten mit derselben Inflation');
    const simItems=withPlannedExpensePrices(items,{storage,scope,referenceYear:2026});
    close(plannedExpensesForYear(simItems,2027,1.02),posts.reserve+1350*1.02,'Simulator und Balance haben dieselbe Preisbasis im zweiten Jahr');
    const current=[{...items[0],priceYear:2027}];
    close(plannedExpensesForYear(withPlannedExpensePrices(current,{storage,scope,referenceYear:2027}),2027),25000,'Im Preisbezugsjahr bleibt der eingegebene Betrag unverändert');
    const doc={createElement:tag=>({tag,dataset:{},children:[],appendChild(child){this.children.push(child);},append(...children){this.children.push(...children);}})};
    const view=createPlannedPostsView(doc,posts), rows=view.children[2].children[1].children;
    assertEqual(rows.length,2,'Feste Monatsausgaben erscheinen als eine Jahreszeile neben dem Auto');
    assert(rows[1].children[0].textContent.includes('10.–12.2027'),'Zeitraum nennt alle drei Kreditmonate');
    assert(rows[1].children[2].children[0].textContent.includes('3 ×'),'Monatszahl steht unter dem Jahresbetrag');
    close(posts.items.filter(item=>!item.fixed).reduce((s,item)=>s+item.amount,0),posts.expenseTotal,'Einmalige Posten addieren sich zur angezeigten Jahressumme');
}
{
    const inputs={...base,startVermoegen:20000,tagesgeld:20000,simulationPeople:[{...base.simulationPeople[0],tagesgeld:20000}],detailledTranches:[],
        plannedExpensesReferenceYear:2026,plannedExpenses:[{id:'auto',monat:'2026-04',betrag:15000,bezeichnung:'Auto'}]};
    const result=simulate(inputs,{rendite:0});
    assertEqual(result.kind,'ruin','Vermögen unter Grundbedarf plus Ausgabe gilt als Ruin');
    assert(result.reason.includes('Geplante Ausgaben ungedeckt'),'Bestehende Ausgaben-Ruinzeile nennt den Grund');
    close(result.logData.geplante_ausgaben,15000,'Terminale Zeile behält den fälligen Betrag');
    const covered=simulate({...inputs,plannedExpenses:[{...inputs.plannedExpenses[0],betrag:5000}]},{rendite:0});
    assertEqual(covered.kind,'success','Genug für Grundbedarf und Ausgabe: Flex darf Zahlung nicht verdrängen');
    close(covered.logData.geplante_ausgaben,5000,'Geplante Ausgabe wird vor verfügbarem Flex reserviert');
}
{
    let cashAtDecision;
    const spy={...EngineAPI,simulateSingleYear(input,state){ cashAtDecision=input.tagesgeld; return EngineAPI.simulateSingleYear(input,state); }};
    const inputs={...base,dynamicFlex:true,detailledTranches:[lot('stock',300000)],fixedIncomeReferenceYear:2026,
        fixedIncome:[{id:'gehalt',art:'sonstige',profileId:'max',bezeichnung:'Gehalt',betragMonat:6000,ab:null,bis:null,anpassung:'keine'}]};
    const result=simulateOneYear(initMcRunState(inputs,0),inputs,{jahr:2002,rendite:0,gold_eur_perf:0,zinssatz:0,inflation:0,lohn:0},0,null,0,null,1,spy);
    assertEqual(result.kind,'success','Dynamic Flex mit hohen Einkünften ist zahlungsfähig');
    close(cashAtDecision,72000-12000-2*6000,'Sicherer Überschuss über Grundbedarf und zweimal Wunsch-Flex steht vor der Verkaufsentscheidung bereit');
}
{
    const items=[{id:'auto',monat:'2027-04',betrag:25000,bezeichnung:'Auto',priceYear:2026}];
    const cash={...base,entnahmeStrategie:'standard',decumulation:{mode:'standard'},startVermoegen:200000,tagesgeld:200000,
        simulationPeople:[{...base.simulationPeople[0],tagesgeld:200000}],detailledTranches:[],plannedExpenses:items,plannedExpensesReferenceYear:2026};
    const first=simulateOneYear(initMcRunState(cash,0),cash,{jahr:2000,rendite:0,gold_eur_perf:0,zinssatz:0,inflation:2,lohn:0},0,null,0,null,1,EngineAPI);
    const second=simulateOneYear(first.newState,cash,{jahr:2001,rendite:0,gold_eur_perf:0,zinssatz:0,inflation:3,lohn:0},1,null,0,null,1,EngineAPI);
    const storage={getItem:key=>key===CONFIG.STORAGE.LS_KEY?JSON.stringify({inputs:{inflation:2}}):null};
    const scope=planScope('single',['max']);
    const posts=projectPlannedPosts({items:withPlannedExpensePrices(items,{storage,scope,referenceYear:2027}),year:2027,scope});
    close(second.logData.geplante_ausgaben,posts.reserve,'Echter Simulatorjahrespfad und Balance sind im zweiten Planjahr inflationsgleich');
}
