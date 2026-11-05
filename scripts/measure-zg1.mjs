// Synthetische ZG-1-Messung nach auftrag/ev1/ev1-messen.mjs; außerhalb der Suite.
// node scripts/measure-zg1.mjs <Ausgabe.json> [2000] [id/variante,id/variante]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { measurementInputs, backtest, hash } from '../tests/helpers/ek-1b-measurement.mjs';
import { normalizeMonteCarloParametersV1 } from '../app/simulator/monte-carlo-parameters.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
const [output, count = '2000', selection] = process.argv.slice(2);
assert(output);
const params = normalizeMonteCarloParametersV1({ anzahl: Number(count), seed: 12345, maxDauer: 35 });
const q = (values, p) => { const a = values.filter(Number.isFinite).sort((a,b)=>a-b), x=(a.length-1)*p; return a.length ? a[Math.floor(x)]+(a[Math.ceil(x)]-a[Math.floor(x)])*(x%1) : null; };
const result = { params, testDate: '2026-10-28', households: [] };
const cases = [['max-erika','grund'],['max-erika','immobilien'],['jan-lena','grund'],['jan-lena','halten'],['helga-werner','grund'],['helga-werner','haus-pg3'],['martin-petra','ehe'],['gross','grund']];
for (const [id, variant] of cases) {
 if (selection && !selection.split(',').includes(`${id}/${variant}`)) continue;
 const inputs = await measurementInputs(0, id==='gross'?'max-erika':id, result.testDate, variant);
 const people=inputs.simulationPeople;
 inputs.partnership = {schemaVersion:1,status:'married',inheritance:{},marriedInheritance:Object.fromEntries(people.map(p=>[p.profileId,id==='gross'?50:100]))};
 if(id==='gross') {
  for(const [i,p] of people.entries()) {
   const lots=inputs.detailledTranches.filter(t=>t.sourceProfileId===p.profileId);
   const factor=3000000*[.9,.1][i]/(p.tagesgeld+lots.reduce((s,t)=>s+t.marketValue,0));
   p.tagesgeld*=factor;
   for(const t of lots) for(const key of ['marketValue','costBasis','shares']) t[key]*=factor;
  }
  inputs.tagesgeld=people.reduce((s,p)=>s+p.tagesgeld,0);
  inputs.geldmarktEtf=inputs.detailledTranches.filter(t=>t.category==='money_market').reduce((s,t)=>s+t.marketValue,0);
  inputs.startVermoegen=3000000;
  inputs.depotwertAlt=inputs.detailledTranches.filter(t=>t.type==='aktien_alt').reduce((s,t)=>s+t.marketValue,0);
  inputs.einstandAlt=inputs.detailledTranches.filter(t=>t.type==='aktien_alt').reduce((s,t)=>s+t.costBasis,0);
  inputs.partner.careToday={grade:2,progression:'usual'};
  inputs.home=[{id:'zg1-haus',profileId:people[0].profileId,bezeichnung:'Synthetisches Haus',nutzung:'selbst',wert:800000,stand:'2026-10',mieteNetto:0,anpassung:'keine'}];
  inputs.homeReferenceYear=2026;
 }
 const paths=[], chunks=[]; let failures=0;
 for(let start=0;start<params.anzahl;start+=50) {
  const size=Math.min(50,params.anzahl-start);
  const chunk=await runMonteCarloChunk({inputs,monteCarloParams:params,widowOptions:inputs.widowOptions,useCapeSampling:false,
   runRange:{start,count:size},logIndices:Array.from({length:size},(_,i)=>start+i),engine:EngineAPI});
  assert.equal(chunk.financialMetricsValid,true); assert.equal(chunk.batchStatus,'completed');
  chunks.push(hash(chunk)); failures+=chunk.totals.failCount;
  for(const [k,run] of chunk.runMeta.entries()) {
   const death=run.logDataRows.find(r=>r.SurvivorDeathYear);
   paths.push({index:run.index,hash:hash(run),death:death?{year:death.jahr,tax:death.erbschaftsteuer||0,estate:death.inheritance}:null,
    endReal:chunk.pathSummaries.finalValueRealEur[k]});
  }
  if((start+size)%500===0) console.log(`${id}/${variant}: ${start+size}/${params.anzahl}`);
 }
 // Fester Backtest ohne Tod sowie kleine vollständige MC-Kontrollen mit altem Tarif.
 const fixedBacktests=[[2000,2025],[1965,1999]].map(([start,end])=>({start,end,hash:hash(backtest(inputs,start,end))}));
 const controls={};
 for(const status of ['married','unmarried']) {
  const control=structuredClone(inputs); control.partnership.status=status; control.partnership.maritalPropertyRegime='separation';
  control.partnership.inheritance=Object.fromEntries(people.map(p=>[p.profileId,50]));
  const chunk=await runMonteCarloChunk({inputs:control,monteCarloParams:params,widowOptions:inputs.widowOptions,useCapeSampling:false,
   runRange:{start:0,count:50},logIndices:Array.from({length:50},(_,i)=>i),engine:EngineAPI});
  controls[status]=hash(chunk);
 }
 const taxes=paths.filter(p=>p.death).map(p=>p.death.tax);
 result.households.push({id,variant,inputs,paths,chunks,controls,fixedBacktests,metrics:{deathPaths:taxes.length,taxMedian:q(taxes,.5),taxP90:q(taxes,.9),
  coveragePct:100*(1-failures/params.anzahl),endRealP10:q(paths.map(p=>p.endReal),.1),endRealP50:q(paths.map(p=>p.endReal),.5)}});
 writeFileSync(output,JSON.stringify(result,null,2)+'\n');
}
