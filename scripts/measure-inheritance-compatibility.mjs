/** EP-1: Vollständige Gegenproben; Quellkopien für Nullsteuer und reinen Protokollvergleich. */
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,output]=process.argv.slice(2), load=f=>import(pathToFileURL(resolve(root,f)));
const {measurementInputs,parameters,backtest}=await load('tests/helpers/ek-1b-measurement.mjs');
const {EngineAPI}=await load('engine/index.mjs');
const {projectScenarioLogV2,serializeScenarioLogExportV2,serializeScenarioLogCsvV2}=await load('app/simulator/monte-carlo-export.js');
const {runMonteCarloChunk}=await load('app/simulator/monte-carlo-runner.js');
const {runParityScenarios}=await load('tests/extended/parity-scenarios.mjs');
const {source}=await load('tests/extended/parity-replay-fixture.mjs');
const {createMusterHaushaltRecords}=await load('app/demo/muster-haushalt.js');
const {buildBalanceEngineInputFromStorage}=await load('app/balance/balance-input-storage.js');
const hash=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const result={};
for(const id of ['sophie','max-erika']){
 const inputs=await measurementInputs(0,id);
 const chunk=await runMonteCarloChunk({inputs,monteCarloParams:{...parameters,anzahl:12},widowOptions:inputs.widowOptions,
     useCapeSampling:false,logIndices:Array.from({length:12},(_,i)=>i),engine:EngineAPI});
 const computation=structuredClone(chunk), withoutProtocol=structuredClone(chunk);
 for(const run of withoutProtocol.runMeta)for(const row of run.logDataRows||[])for(const field of ['liqEnd','personAccounts'])delete row[field];
 for(const run of computation.runMeta)for(const row of run.logDataRows||[])for(const field of ['liqEnd','personAccounts','inheritance','abgang_erben','erbschaftsteuer'])delete row[field];
 const scenarioExports=withoutProtocol.runMeta.map(run=>projectScenarioLogV2(run.logDataRows||[]));
 result[id]={scenarioJsonExceptProtocolSha256:hash(scenarioExports.map(serializeScenarioLogExportV2)),scenarioCsvExceptProtocolSha256:hash(scenarioExports.map(serializeScenarioLogCsvV2)),inputs:hash(inputs),backtest:hash(backtest(inputs)),mc:hash(chunk),computation:hash(computation),withoutProtocol:hash(withoutProtocol)};
}
const {durationMs,...parity}=runParityScenarios({source});result.parity=hash(parity);
const records=createMusterHaushaltRecords('2026-10-16','max-erika');
const balance=buildBalanceEngineInputFromStorage({storage:{getItem:key=>records[key]??null},referenceYear:2026});
result.balance=hash(balance);
const balanceCalculation=EngineAPI.simulateSingleYear(balance.engineInput,balance.engineLastState);
if(balanceCalculation.error)throw Error(balanceCalculation.error);
result.balanceCalculation=hash(balanceCalculation);
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(result);
