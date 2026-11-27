// JD-2a, Nachtrag 2, Befund 5: Die volle Rechnung des ausgelieferten Stands (ohne Grundbestandssicht) hat eigene,
// bei jeder Übernahme neu erzeugte Ergebnis-Schnappschüsse: echte finanzielle Backtests 2000 bis Endjahr samt
// angehängtem Jahr, Monte Carlo für Max/Erika und Renate, Monte Carlo mit CAPE-Ziehung. Klasse 3, neu erzeugt.
import { readFileSync } from 'node:fs';
import { liveSollwerte, LIVE_STARTJAHR } from './helpers/live-sollwerte.mjs';
import { annualData, HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';

console.log('--- Jahresdaten: Ergebnis-Schnappschüsse des Live-Stands ---');

const fixture = JSON.parse(readFileSync(new URL('./fixtures/live-sollwerte.json', import.meta.url), 'utf8'));
const endYear = HISTORICAL_DATENSTAND.endYear;

console.log('Test 1: Schnappschüsse gehören zum ausgelieferten Stand, Pool ohne Grundbestandssicht');
assertEqual(annualData.at(-1).jahr, endYear, 'Monte-Carlo-Pool reicht bis zum Endjahr des Datenstands');
assertEqual(fixture.datenstand.endYear, endYear, 'Sollwerte für das Endjahr des Datenstands neu erzeugt');
assertEqual(fixture.datenstand.contentHash, HISTORICAL_DATENSTAND.contentHash, 'Sollwerte für den Inhaltshash des Datenstands neu erzeugt');

console.log('Test 2: Backtests bis zum Endjahr einschließlich des letzten Jahres');
const live = await liveSollwerte();
for (const id of ['max-erika', 'renate']) {
    const ergebnis = live.ergebnisse[`backtest-${id}`];
    assertEqual(ergebnis.letztesJahr, endYear, `${id}: Backtest rechnet das letzte Datenjahr ${endYear}`);
    assertEqual(ergebnis.zeilen, endYear - LIVE_STARTJAHR + 1, `${id}: eine Zeile je Jahr ${LIVE_STARTJAHR}–${endYear}`);
    assert(ergebnis.endvermoegen > 0 && Number.isFinite(ergebnis.steuern), `${id}: auswertbare Finanzwerte`);
}

console.log('Test 3: alle fünf Ergebnisse gleich den neu erzeugten Sollwerten');
assertEqual(Object.keys(live.ergebnisse).length, 5, 'Fünf Ergebnis-Schnappschüsse');
for (const [name, ergebnis] of Object.entries(live.ergebnisse)) {
    assertEqual(JSON.stringify(ergebnis), JSON.stringify(fixture.ergebnisse[name]), `${name}: gleich dem Sollwert des Live-Stands`);
}

console.log('✅ Jahresdaten Live-Sollwerte tests passed');
