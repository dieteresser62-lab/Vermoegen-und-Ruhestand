// Ausschließlich synthetisch; vollständige MC-Chunks vor/nach ohne Feldfilter.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, countArg = '2000', selection] = process.argv.slice(2);
const from = file => import(pathToFileURL(resolve(root, file)).href);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const { measurementInputs, parameters } = await from('tests/helpers/ek-1b-measurement.mjs');
const { EngineAPI } = await from('engine/index.mjs');
const { runMonteCarloChunk } = await from('app/simulator/monte-carlo-runner.js');
const { applyUnmarriedInheritance } = await from('app/simulator/simulator-inheritance.js');
const { personalAssetValues } = await from('app/simulator/simulator-unmarried.js');
const { createMusterHaushaltRecords } = await from('app/demo/muster-haushalt.js');
const { buildBalanceEngineInputFromStorage } = await from('app/balance/balance-input-storage.js');
const { runParityScenarios } = await from('tests/extended/parity-scenarios.mjs');
const { source } = await from('tests/extended/parity-replay-fixture.mjs');
const { inheritanceNetProceeds } = await import('../../app/profile/household-inheritance-sale.js');
let observedSales = [];
// Optionale reine Messsonde im Ausgangsordner: keine Änderung an Rechnung oder Logs.
globalThis.__es1EstateObserver = ({ portfolio, deceasedProfileId, deceased, account, proceeds, special, actionResult }) => {
    const tranches = ['depotTranchesAktien','depotTranchesGold','depotTranchesGeldmarkt','healthBucketTranches']
        .flatMap(key => portfolio[key] || []).filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === deceasedProfileId);
    const cash = (portfolio.healthBucketCashOwners || []).filter(row => row.profileId === deceasedProfileId).reduce((s,row)=>s+row.amount,0);
    if (cash) tranches.push({type:'anleihe',category:'bonds',marketValue:cash,costBasis:cash,taxExempt:true});
    const previous = actionResult?.personalAnnualTaxes?.find(row => row.profileId === account.profileId);
    const net = inheritanceNetProceeds({cash:deceased.tagesgeld,tranches,reservedHomeProceeds:proceeds,kirchensteuerSatz:account.kirchensteuerSatz,
        sparerPauschbetrag:Math.max(0,(account.sparerPauschbetrag||0)-(previous?.details?.spbUsedThisYear||0)),taxStatePrev:account.taxState});
    observedSales.push(special.taxCash-net(special.taxCash));
};
const count = Number(countArg), params = { ...parameters, anzahl: count };
const median = values => { const s = [...values].sort((a,b) => a-b), m = (s.length-1)/2;
    return s.length ? (s[Math.floor(m)]+s[Math.ceil(m)])/2 : null; };
const result = selection ? JSON.parse(readFileSync(output,'utf8'))
    : { synthetic: true, testDate: '2026-10-23', parameters: params, scenarios: {}, compatibility: {}, counterchecks: [] };
if (selection === 'counterchecks') result.counterchecks = [];
for (const cash of [0,200000]) for (const own of [0,100000]) {
    const portfolio = { simulationSourceProfileId: 'a', personAccounts: ['a','b'].map((profileId,i) => ({ profileId,
        tagesgeld: i ? own : cash, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } })),
        depotTranchesAktien: [{ trancheId:'equity',sourceProfileId:'a',marketValue:1000000,costBasis:500000,type:'aktien_alt',category:'equity',tqf:0}],
        depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [], healthBucketCashOwners: [] };
    const log = applyUnmarriedInheritance({ portfolio, transition: { deathThisYear:true,survivor:{deceasedProfileId:'a',survivorProfileId:'b'} },
        inputs:{ partnership:{ status:'unmarried',inheritance:{a:0},homeAndTaxInheritance:{a:true} },homeReferenceYear:2026,
            home:[{id:'haus',profileId:'a',wert:800000,stand:'2026-10',nutzung:'selbst'}]},inflationFactor:1,
        pension:{rente1BruttoEigen:0,rente2BruttoEigen:0},personalInterest:{items:[]},actionResult:{steuer:0} });
    if (!selection || selection === 'counterchecks') result.counterchecks.push({ cash, own, sparerPauschbetrag: 1000,
        taxCash:log.inheritance.taxCash,tax:log.erbschaftsteuer,
        saleTax:log.inheritancePayment.extraTax,shortfall:log.inheritancePayment.shortfall,
        survivorMoney:personalAssetValues(portfolio)[0].value });
}
if (selection === 'counterchecks') { writeFileSync(output,JSON.stringify(result,null,2)+'\n'); process.exit(0); }
async function measure(inputs,key) {
    const chunks=[],end=[],xs=[],taxes=[],saleTaxes=[]; let ruin=0,technical=0,unpaid=0,maxFlowDelta=0;
    for (let start=0;start<count;start+=100) {
        const size=Math.min(100,count-start);
        observedSales = [];
        const chunk=await runMonteCarloChunk({inputs,engine:EngineAPI,monteCarloParams:params,widowOptions:inputs.widowOptions,
            useCapeSampling:false,runRange:{start,count:size},logIndices:Array.from({length:size},(_,i)=>start+i)});
        chunks.push(hash(chunk)); ruin+=chunk.totals.failCount;technical+=chunk.technicalInventory.technicalError;
        end.push(...chunk.pathSummaries.finalValueRealEur);
        for (const run of chunk.runMeta) {
            const estates=run.logDataRows.filter(row=>row.inheritance);
            xs.push(estates.reduce((s,row)=>s+(row.inheritance.taxCash||0),0));
            taxes.push(estates.reduce((s,row)=>s+(row.erbschaftsteuer||0),0));
            saleTaxes.push(estates.reduce((s,row)=>s+(row.inheritance.taxCashSaleTax ?? (row.inheritance.homeAndTax ? observedSales.shift() : 0) ?? 0),0));
            if (estates.some(row=>row.recordType==='terminal_ruin')) unpaid++;
            for (const row of run.logDataRows) maxFlowDelta=Math.max(maxFlowDelta,Math.abs(row.portfolio_flow_delta||0));
        }
        console.log(`${key}: ${start+size}/${count}`);
    }
    assert.equal(technical,0,`${key}: keine technischen Fehler`);
    return {inputsSha256:hash(inputs),sha256:hash(chunks),coveredPct:100*(count-ruin)/count,ruin,unpaid,
        medianX:median(xs),medianTax:median(taxes),medianSaleTaxOnX:median(saleTaxes),medianEndReal:median(end),maxFlowDelta};
}
for (const key of ['muster','gross25','married','unmarried50','unmarried0','noHome','floor100']) {
    if (selection && !selection.split(',').includes(key)) continue;
    const inputs=await measurementInputs(0,undefined,'2026-10-23');
    inputs.home=[{id:'haus',profileId:inputs.simulationPeople[0].profileId,bezeichnung:'Haus',nutzung:'selbst',wert:800000,stand:'2026-10',mieteNetto:0,anpassung:'keine'}];
    inputs.homeReferenceYear=2026;
    const percent=key==='gross25'?25:key==='unmarried50'?50:0;
    inputs.partnership={schemaVersion:1,status:key==='married'?'married':'unmarried',inheritance:{muster_a:percent,muster_b:percent},marriedInheritance:{muster_a:100,muster_b:100}};
    if (['muster','gross25'].includes(key)) inputs.partnership.homeAndTaxInheritance={muster_a:true};
    if (key==='gross25') {
        for (const [id,target] of [['muster_a',2700000],['muster_b',300000]]) {
            const person=inputs.simulationPeople.find(p=>p.profileId===id),lots=inputs.detailledTranches.filter(lot=>lot.sourceProfileId===id);
            const factor=target/(person.tagesgeld+lots.reduce((s,lot)=>s+lot.marketValue,0));person.tagesgeld*=factor;
            for (const lot of lots) {lot.marketValue*=factor;lot.costBasis*=factor;lot.shares*=factor;}
        }
        inputs.startVermoegen=3000000;inputs.tagesgeld=inputs.simulationPeople.reduce((s,p)=>s+p.tagesgeld,0);
        inputs.geldmarktEtf=inputs.detailledTranches.filter(lot=>lot.category==='money_market').reduce((s,lot)=>s+lot.marketValue,0);
        inputs.depotwertAlt=3000000-inputs.tagesgeld-inputs.geldmarktEtf;
        inputs.einstandAlt=inputs.detailledTranches.filter(lot=>lot.category==='equity').reduce((s,lot)=>s+lot.costBasis,0);
        inputs.partner.careToday={grade:2,progression:'usual'};
    }
    if (key==='noHome') inputs.home=[];
    if (key==='floor100') inputs.survivorFloorPercent=100;
    result.scenarios[key]=await measure(inputs,key);writeFileSync(output,JSON.stringify(result,null,2)+'\n');
}
const {durationMs,...parity}=runParityScenarios({source});assert.equal(parity.failed,false);result.compatibility.parity=hash(parity);
const records=createMusterHaushaltRecords('2026-10-23');
const balance=buildBalanceEngineInputFromStorage({storage:{getItem:key=>records[key]??null},referenceYear:2026});
result.compatibility.balanceInput=hash(balance);result.compatibility.balanceCalculation=hash(EngineAPI.simulateSingleYear(balance.engineInput,balance.engineLastState));
writeFileSync(output,JSON.stringify(result,null,2)+'\n');process.exit(0);
