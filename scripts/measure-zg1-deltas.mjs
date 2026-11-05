/** ZG-1: vollständige Alt-/Neuhashes messen; der Kontrolllauf ersetzt nur die korrigierten Fachmodule durch den Ausgangsstand.
 * node scripts/measure-zg1-deltas.mjs tests/<Datei>.test.mjs collect|control /tmp/Ergebnis.json [Ausgangsordner]
 */
import { register } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [file, mode, output, baseline] = process.argv.slice(2);
if (!['collect','control'].includes(mode) || !output || mode === 'control' && !baseline) throw new Error('Datei, collect|control, Ausgabe und beim Kontrolllauf Ausgangsordner angeben.');
const corrected = ['app/profile/household-partnership.js', 'app/simulator/simulator-inheritance.js', 'app/simulator/protocol-renderer.js', 'app/tranches/tranchen-manager-partnership.js', 'app/demo/muster-steckbrief.js'];
const originals = mode === 'control' ? Object.fromEntries(corrected.map(file => [file, readFileSync(resolve(baseline,file),'utf8')])) : {};
if(mode==='control') {
    originals[file]=readFileSync(resolve(baseline,file),'utf8');
    const workerAdapter='tests/helpers/decision-worker-adapter.mjs';
    originals[workerAdapter]=readFileSync(resolve(baseline,workerAdapter),'utf8').replace('constructor(url) {',
        'constructor(url) { url = new URL(url.href.replace('+JSON.stringify(pathToFileURL(resolve('.')+'/').href)+','+JSON.stringify(pathToFileURL(resolve(baseline)+'/').href)+'));');
}

register(`data:text/javascript,${encodeURIComponent(`
 const originals=${JSON.stringify(originals)};
 export async function load(url,context,nextLoad){
  const result=await nextLoad(url,context);

  for(const [file,source] of Object.entries(originals))if(url.endsWith('/'+file))return {...result,source};
  return result;
 }` )}`);
const { installAssertionGlobals, getTestExecutionPolicy } = await import('../tests/run-tests.mjs');
const counters=installAssertionGlobals({verbosePasses:false});
const wrap=globalThis.__wrapExternalAssert;
if(mode==='collect')globalThis.__wrapExternalAssert=api=>{
 const proxy=wrap(api);
 return new Proxy(proxy,{get(target,key){if(['equal','strictEqual'].includes(String(key)))return (actual,expected,label)=>globalThis.assertEqual(actual,expected,label);return Reflect.get(target,key);}});
};
const original=globalThis.assertEqual, hashes={}, labels=[], counts={};
function collect(actual,expected,label){
 if(actual===expected)return;
 if(typeof actual==='number' && typeof expected==='number' && /sämtliche Zahlenfelder/.test(label)){counts[label]={before:expected,after:actual};return true;}
 if(typeof actual==='string' && typeof expected==='string' && /^[a-f0-9]{64}$/.test(actual) && /^[a-f0-9]{64}$/.test(expected)){
  if(hashes[expected] && hashes[expected]!==actual)throw new Error('Nicht eindeutiges Hashdelta.');
  hashes[expected]=actual;labels.push({expected,actual,label});return true;
 }
 try{const a=JSON.parse(actual),e=JSON.parse(expected);if(a&&e&&typeof a==='object'&&typeof e==='object'){
  let changed=false;
  const walk=(a,e,path)=>{for(const key of Object.keys(e)){if(a[key]&&e[key]&&typeof a[key]==='object'&&typeof e[key]==='object')walk(a[key],e[key],path+'.'+key);else if(collect(a[key],e[key],path+'.'+key))changed=true;else if(a[key]!==e[key])throw new Error('Änderung außerhalb eines Hashwerts: '+path+'.'+key);}};
  walk(a,e,label);return changed;
 }}catch(error){if(error.message.startsWith('Änderung'))throw error;}
 return false;
}
if(mode==='collect')globalThis.assertEqual=(actual,expected,label)=>collect(actual,expected,label)?original(actual,actual,'Messung: '+label):original(actual,expected,label);
if(getTestExecutionPolicy(file.split('/').at(-1)).instrumentAssertions)register(pathToFileURL(resolve('tests/legacy-assertion-loader.mjs')).href);
let completed=false;
try{await import(pathToFileURL(resolve(file)));completed=true;}
finally{writeFileSync(output,JSON.stringify({file,mode,totalAssertions:counters.total,failedAssertions:counters.failedAssertions,completed,hashes,labels,counts},null,2)+'\n');}
console.log(`${file}: ${mode}, ${Object.keys(hashes).length} Hashdeltas, ${counters.failedAssertions} Fehler`);
process.exit(counters.failedAssertions?1:0);
