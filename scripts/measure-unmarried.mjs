/** FR-48/49, nur synthetische Max-/Erika-Daten.
 * node scripts/measure-unmarried.mjs <Quellordner> <Ausgabe.json> [married|zero|full|home] [2000]
 * Abgang und Erbschaftsteuer sind nominale Summen je Pfad.
 * Folgejahr-Quantile verwenden auswertbare Jahreszeilen; Ruin zählt mit null, Zensierung entfällt.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, output, variant='married', countArg='2000'] = process.argv.slice(2);
if (!root || !output || !['married','zero','full','home'].includes(variant)) throw Error('Quellordner, Ausgabe und gültige Variante erforderlich.');
const load = f => import(pathToFileURL(resolve(root, f)));
const { measurementInputs, parameters, backtest } = await load('tests/helpers/ek-1b-measurement.mjs');
const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
const { EngineAPI } = await load('engine/index.mjs');
const inputs = await measurementInputs(0, 'max-erika');
if (variant !== 'married') inputs.partnership = {schemaVersion:1,status:'unmarried',inheritance:Object.fromEntries(inputs.simulationPeople.map(p=>[p.profileId, variant==='zero'?0:100]))};
if (variant === 'home') {
 const id=inputs.simulationPeople[0].profileId;
 inputs.home=[{id:'haus',profileId:id,bezeichnung:'Haus',nutzung:'selbst',wert:450000,stand:'2026-10',mieteNetto:0,anpassung:'keine'}, {id:'wohnung',profileId:id,bezeichnung:'Wohnung',nutzung:'vermietet',wert:210000,stand:'2026-10',mieteNetto:650,anpassung:'inflation'}];
 inputs.fixedIncome=[...(inputs.fixedIncome||[]),{id:'immobilie:wohnung',profileId:id,art:'sonstige',bezeichnung:'Miete · Wohnung',betragMonat:650,ab:null,bis:null,anpassung:'inflation'}]; inputs.fixedIncomeReferenceYear=2026;
}
const params={...parameters,anzahl:Number(countArg)}, digest=createHash('sha256'), end=[],afterDeath=[];
let failed=0,leaves=0,tax=0,deaths=0;
for(let start=0;start<params.anzahl;start+=50){
 const size=Math.min(50,params.anzahl-start),indices=Array.from({length:size},(_,i)=>start+i);
 const chunk=await runMonteCarloChunk({inputs,monteCarloParams:params,widowOptions:inputs.widowOptions,useCapeSampling:false,runRange:{start,count:size},logIndices:indices,engine:EngineAPI});
 if(!chunk.financialMetricsValid||chunk.batchStatus!=='completed') throw Error(JSON.stringify(chunk.technicalInventory));
 digest.update(JSON.stringify(chunk));failed+=chunk.totals.failCount;end.push(...chunk.pathSummaries.finalValueRealEur);
 for(const run of chunk.runMeta){const rows=run.logDataRows||[],death=rows.find(r=>r.SurvivorDeathYear);if(death){deaths++;const next=rows.find(r=>r.jahr===death.jahr+1&&r.financiallyEvaluable===true);if(next) afterDeath.push(next.portfolio_total_end/(next.inflation_factor_cum*(1+next.inflation/100)));else if(rows.some(r=>r.jahr===death.jahr+1 && r.recordType==='terminal_ruin')) afterDeath.push(0);}for(const r of rows){leaves+=r.abgang_erben||0;tax+=r.erbschaftsteuer||0;}}
 if((start+size)%250===0)console.log(`${variant}: ${start+size}/${params.anzahl}`);
}
const q=(v,p)=>{v.sort((a,b)=>a-b);const x=(v.length-1)*p;return v.length?v[Math.floor(x)]+(v[Math.ceil(x)]-v[Math.floor(x)])*(x%1):null;};
const historical=backtest(inputs);
const result={variant,params,inputHash:createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),completeOutputSha256:digest.digest('hex'),backtestSha256:createHash('sha256').update(JSON.stringify(historical)).digest('hex'),successPct:100*(params.anzahl-failed)/params.anzahl,realP10:q(end,.1),realP50:q(end,.5),afterFirstDeathRealP10:q(afterDeath,.1),afterFirstDeathRealP50:q(afterDeath,.5),pathsWithDeath:deaths,afterFirstDeathEvaluablePaths:afterDeath.length,meanLeaves:leaves/params.anzahl,meanInheritanceTax:tax/params.anzahl};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(result);
