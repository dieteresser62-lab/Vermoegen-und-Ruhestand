/** EV-1b: Vollreferenzfolgen der Folgejahrprojektion, nur synthetische Testfälle.
 * node scripts/measure-ev1b-deltas.mjs <Quellordner> <Testdatei> <Ausgabe.json>
 * Vorher und nachher in getrennten Prozessen ausführen; am Ausgangsstand müssen
 * alle Deltas leer bleiben. Nur SHA-256-Werte und Zahlenfeldanzahlen erfassen.
 */
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { strictEqual } from 'node:assert';
const [root, file, out] = process.argv.slice(2);
if (!root || !file || !out) throw new Error('Quellordner, Testdatei und Ausgabe fehlen.');
register(`data:text/javascript,${encodeURIComponent(`
export async function load(url,context,nextLoad) {
 const result=await nextLoad(url,context);
 if(url.endsWith('/tests/helpers/ev-1b-expectations.mjs')) return {...result,source:'export const ev1bEvidence={numericLeaves:{}}; export const readEV1bReferences=value=>value;'};
 return result;
}`)}`);
const { installAssertionGlobals, getTestExecutionPolicy } = await import(pathToFileURL(`${root}/tests/run-tests.mjs`));
const counters = installAssertionGlobals({verbosePasses:false});
const deltas = [];
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function collect(actual,expected,message) {
 if(actual===expected) return;
 if(hash(actual) && hash(expected) || typeof actual==='number' && typeof expected==='number' && message.includes('sämtliche Zahlenfelder')) {
  deltas.push({file,message,before:expected,after:actual}); return;
 }
 if(typeof actual==='string' && typeof expected==='string' && /^[\[{]/.test(actual) && /^[\[{]/.test(expected)) {
  const a=JSON.parse(actual),e=JSON.parse(expected);
  function walk(a,e,path) {
   if(a && e && typeof a==='object' && typeof e==='object') {
    strictEqual(JSON.stringify(Object.keys(a)),JSON.stringify(Object.keys(e)),path);
    for(const key of Object.keys(e)) walk(a[key],e[key],`${path}.${key}`);
   } else collect(a,e,path);
  }
  walk(a,e,message); return;
 }
 strictEqual(actual,expected,message);
}
const originalEqual = globalThis.assertEqual;
const check = (actual,expected,message='') => {
 collect(actual,expected,message);
 originalEqual(actual,actual,message);
};
globalThis.assertEqual=check;
const wrap=globalThis.__wrapExternalAssert;
globalThis.__wrapExternalAssert=api=>new Proxy(wrap(api),{get(target,key) {return ['equal','strictEqual'].includes(key)?check:Reflect.get(target,key);}});
if(getTestExecutionPolicy(file).instrumentAssertions) register(pathToFileURL(`${root}/tests/legacy-assertion-loader.mjs`).href);
let completed=false;
try {await import(pathToFileURL(`${root}/tests/${file}`)); completed=true;}
finally {writeFileSync(out,JSON.stringify({file,counters,completed,deltas},null,2));}
console.log(`${file}: ${deltas.length} Referenzfolgen, ${counters.failedAssertions} Fehler`);
process.exit(counters.failedAssertions?1:0);
