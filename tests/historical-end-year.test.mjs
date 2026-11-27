// JD-1 Punkt 5: Die Bauskripte der sechs Ketten lesen ihr Endjahr aus dem Datenstand über einen gemeinsamen Helfer.
// Das Geldmarkt-Skript lässt sich hier nicht ausführen (Poppler zu alt); seine Endjahr-Quelle belegt dieser Test am Quelltext.
import { readFileSync } from 'node:fs';
import { HISTORICAL_END_YEAR, historicalEndYear } from '../scripts/lib/historical-end-year.mjs';
import HISTORICAL_DATENSTAND from '../app/simulator/historical-datenstand.js';

console.log('--- Historical End Year Tests ---');

const captureError = callback => { try { callback(); return null; } catch (error) { return error; } };

assertEqual(HISTORICAL_END_YEAR, HISTORICAL_DATENSTAND.endYear, 'Gemeinsames Endjahr kommt aus dem Datenstand');
assertEqual(historicalEndYear({ startYear: 1925, endYear: 2026 }), 2026, 'Ein angehobenes Endjahr wird ohne Codeänderung übernommen');
for (const stand of [{ startYear: 1925, endYear: 1924 }, { startYear: 1925, endYear: 2025.5 }, { startYear: 1925 }, { endYear: 2025 }, null]) {
    const error = captureError(() => historicalEndYear(stand));
    assert(error?.message.startsWith('Datenstand: Endjahr'), `Ungültiger Datenstand ${JSON.stringify(stand)} bricht klar ab`);
}

const scripts = [
    'build-global-equity-research-chain.mjs',
    'build-german-cpi-chain.mjs',
    'build-german-cash-money-market-chain.mjs',
    'build-german-gross-wage-growth-chain.mjs',
    'build-gold-german-investor-chain.mjs',
    'build-us-shiller-cape-chain.mjs'
];
for (const script of scripts) {
    const source = readFileSync(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    assert(source.includes("import { HISTORICAL_END_YEAR } from './lib/historical-end-year.mjs';"), `${script} nutzt den gemeinsamen Endjahr-Helfer`);
    assert(source.includes('const END_YEAR = HISTORICAL_END_YEAR;'), `${script} setzt END_YEAR aus dem Datenstand`);
    assert(!/const END_YEAR = \d{4}/.test(source), `${script} hat kein festes Endjahr mehr`);
    assert(!source.includes(`year <= ${HISTORICAL_END_YEAR};`), `${script} läuft in keiner Schleife bis zum festen Jahr ${HISTORICAL_END_YEAR}`);
}

console.log('✅ Historical end year tests passed');
