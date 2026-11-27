// JD-2b Nachtrag 1, Punkt 7: Testmodus `npm run jahresdaten -- --quellen [<Jahr>]`, offline mit den Beispielantworten
// aus tests/fixtures/jahresdaten-leser/. Geprüft: erreichbar und lesbar (Exit 0), kaputtes Format (Exit 1), HTTP 500 (Exit 2),
// mit Jahr der Status je Kette nach den Statusregeln, und dass der Modus nichts schreibt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quellenPruefen, quellenText } from '../scripts/lib/jahresdaten/quellen.mjs';
import { gespeicherterAbruf } from '../scripts/lib/jahresdaten/leser/netz.mjs';
import * as aktien from '../scripts/lib/jahresdaten/leser/aktien.mjs';
import * as inflation from '../scripts/lib/jahresdaten/leser/inflation.mjs';
import * as geldmarkt from '../scripts/lib/jahresdaten/leser/geldmarkt.mjs';
import * as lohn from '../scripts/lib/jahresdaten/leser/lohn.mjs';
import * as gold from '../scripts/lib/jahresdaten/leser/gold.mjs';
import * as cape from '../scripts/lib/jahresdaten/leser/cape.mjs';
import { miniXlsx } from './helpers/mini-xlsx.mjs';

console.log('--- Jahresdaten: Testmodus --quellen ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'tests', 'fixtures', 'jahresdaten-leser');
const lies = name => fs.readFileSync(path.join(FIXTURES, name));
const json = value => JSON.stringify(value);
const goldZeilen = JSON.parse(lies('weltbank-gold-zeilen.json').toString('utf8'));
const capeZellen = JSON.parse(lies('shiller-cape-zellen.json').toString('utf8'));
const shillerXls = Buffer.from('Platzhalter für ie_data.xls', 'utf8');
const shillerSeite = lies('shiller-seite-auszug.html');
const shillerLink = cape.dateiLink(shillerSeite.toString('utf8'));
const blattLesen = (bytes, blatt) => {
    if (!bytes.equals(shillerXls) || blatt !== 'Data') throw new Error('keine Arbeitsmappe');
    return {
        cells: new Map(capeZellen.zeilen.map(({ zeile, date, cape: wert }) => [zeile, new Map([[0, date], [12, wert]])])),
        textCells: new Map([[capeZellen.kopf.zeile, new Map([[0, capeZellen.kopf.date], [12, capeZellen.kopf.cape]])]])
    };
};
const antworten = (jahr = 2025) => ({
    [aktien.quellen(jahr).oecd]: lies('oecd-2025.csv'),
    [aktien.quellen(jahr).ezb]: lies('ezb-exr-2025.csv'),
    [aktien.quellen(jahr).bundesbank]: lies('bundesbank-bbex3-2025.csv'),
    [inflation.SEITE]: lies('destatis-vpi-auszug.html'),
    [geldmarkt.quellen(jahr).estr]: lies('ezb-estr-2024-2025.csv'),
    [geldmarkt.quellen(jahr).bbmmb]: lies('bundesbank-bbmmb-2025.csv'),
    [lohn.SEITE]: lies('destatis-verdienste-auszug.html'),
    [gold.quellen(jahr).jahrespreise]: miniXlsx({ 'Annual Prices (Nominal)': goldZeilen['Annual Prices (Nominal)'] }),
    [gold.quellen(jahr).monatspreise]: miniXlsx({ 'Monthly Prices': goldZeilen['Monthly Prices'] }),
    [gold.quellen(jahr).kurs]: lies('bundesbank-usd-eur-2025.csv'),
    [cape.SEITE]: shillerSeite,
    [shillerLink]: shillerXls
});
const leserOptionen = { blattLesen };

/** Prüfsummen aller Dateien unter data/ vor und nach dem Modus. */
function bestand() {
    const liste = [];
    const besuchen = ordner => fs.readdirSync(ordner, { withFileTypes: true }).forEach(eintrag => {
        const datei = path.join(ordner, eintrag.name);
        if (eintrag.isDirectory()) besuchen(datei); else liste.push(`${datei}:${fs.statSync(datei).mtimeMs}`);
    });
    besuchen(path.join(root, 'data'));
    return liste.sort().join('\n');
}

console.log('Test 1: Alle Quellen erreichbar und lesbar, mit Jahr 2025');
const vorher = bestand();
const alle = await quellenPruefen({ root, jahr: 2025, abrufen: gespeicherterAbruf(antworten()), leserOptionen });
assertEqual(bestand(), vorher, 'Der Modus schreibt nichts unter data/');
assertEqual(alle.exit, 0, 'Exit 0');
assertEqual(alle.zeilen.length, 12, 'zwölf Quellen, mit Ersatz und Gegenprüfung');
assertEqual(json(alle.zeilen.map(zeile => [zeile.quelle, zeile.erreichbar, zeile.format, zeile.stand])), json([
    ['OECD Aktienkurse', true, true, '2025-12'],
    ['EZB Kurse (EXR)', true, true, '2025-12'],
    ['Bundesbank BBEX3 A02 (Ersatz)', true, true, '2025-12'],
    ['Destatis VPI', true, true, '2025'],
    ['EZB €STR', true, true, '2025-12-31'],
    ['Bundesbank BBMMB (Gegenprüfung)', true, true, '2025-12'],
    ['Destatis Verdienste', true, true, '2025'],
    ['Weltbank CMO Jahrespreise', true, true, '2025'],
    ['Weltbank CMO Monatswerte (Gegenprüfung)', true, true, '2025-12'],
    ['Bundesbank USD/EUR A04', true, true, '2025'],
    ['shillerdata.com (Link)', true, true, 'Link ie_data.xls'],
    ['Shiller ie_data.xls', true, true, '2025-01']
]), 'erreichbar, Format erkannt und neuester Stand je Quelle');
assertEqual(json(alle.ketten.map(item => [item.label, item.jahr])), json([['Aktien', 'endgueltig'], ['Inflation', 'endgueltig'], ['Geldmarkt', 'endgueltig'],
    ['Lohn', 'endgueltig'], ['Gold', 'endgueltig'], ['CAPE', 'endgueltig']]), 'Datenjahr 2025 je Kette endgültig');
const text = quellenText(alle);
assert(text[0].includes('Datenjahr 2025 (Testmodus, schreibt nichts)') && text.at(-1) === 'Ergebnis: alle Quellen erreichbar und lesbar (Exit 0)', 'Kopf und Ergebniszeile');
assert(text.some(zeile => /^Gold\s+Weltbank CMO Jahrespreise\s+ja \(200\)\s+ja\s+2025$/.test(zeile)), 'Tabellenzeile Gold');

console.log('Test 2: Kaputtes Format ergibt Exit 1, HTTP 500 Exit 2');
const kaputt = await quellenPruefen({ root, jahr: 2025, leserOptionen,
    abrufen: gespeicherterAbruf({ ...antworten(), [aktien.quellen(2025).oecd]: '<html>Wartung</html>', [gold.quellen(2025).monatspreise]: '<html>Wartung</html>' }) });
assertEqual(kaputt.exit, 1, 'Exit 1 bei unlesbarer Quelle');
assertEqual(json(kaputt.zeilen.filter(zeile => !zeile.format).map(zeile => zeile.quelle)), json(['OECD Aktienkurse', 'Weltbank CMO Monatswerte (Gegenprüfung)']), 'genau die kaputten Quellen ohne Format');
assertEqual(json(kaputt.ketten.filter(item => item.jahr !== 'endgueltig').map(item => [item.label, item.jahr])), json([['Aktien', 'fehlt'], ['Gold', 'vorlaeufig']]),
    'Aktien fehlt, Gold ohne Gegenprüfung vorläufig');
const http500 = await quellenPruefen({ root, jahr: 2025, leserOptionen, abrufen: gespeicherterAbruf({ ...antworten(), [aktien.quellen(2025).ezb]: { status: 500 } }) });
assertEqual(http500.exit, 2, 'Exit 2 bei nicht erreichbarer Quelle');
const ezb = http500.zeilen.find(zeile => zeile.quelle === 'EZB Kurse (EXR)');
assertEqual(json([ezb.erreichbar, ezb.http]), json([false, 500]), 'EZB nicht erreichbar mit HTTP 500');
assertEqual(http500.ketten[0].jahr, 'endgueltig', 'Aktien über den Ersatzweg Bundesbank trotzdem vorhanden');
assert(quellenText(http500).some(zeile => /^Aktien\s+EZB Kurse \(EXR\)\s+nein \(500\)\s+–\s+HTTP 500$/.test(zeile)), 'Tabellenzeile EZB nicht erreichbar');

console.log('Test 3: Ohne Jahr nur Erreichbarkeit und Stand, mit Jahr 2026 fehlt es');
const ohneJahr = await quellenPruefen({ root, heute: '2025-11-17', abrufen: gespeicherterAbruf(antworten(2025)), leserOptionen });
assertEqual(json([ohneJahr.jahr, ohneJahr.fenster, ohneJahr.ketten.length, ohneJahr.exit]), json([null, 2025, 0, 0]), 'ohne Jahr: Fenster des laufenden Jahres, keine Kettenaussage');
const umbenannt = Object.fromEntries(Object.entries(antworten(2025)).map(([url, inhalt]) => [url.replaceAll('2025', '2026').replaceAll('2024', '2025'), inhalt]));
const jahr2026 = await quellenPruefen({ root, jahr: 2026, abrufen: gespeicherterAbruf(umbenannt), leserOptionen });
assertEqual(jahr2026.exit, 0, 'Quellen 2026 erreichbar und lesbar');
assertEqual(json(jahr2026.ketten.map(item => item.jahr)), json(['fehlt', 'fehlt', 'fehlt', 'fehlt', 'fehlt', 'fehlt']), 'Datenjahr 2026 fehlt in allen Ketten der Beispielantworten');
assert(/OECD liefert noch keinen Wert für AUS 2026-12/.test(jahr2026.ketten[0].grund), 'Grund nennt den fehlenden Dezember');
assertEqual(jahr2026.zeilen[0].stand, '2025-12', 'neuester OECD-Stand 2025-12');

console.log('Test 4: Aufrufe');
const probe = fs.readFileSync(path.join(root, 'scripts/liveprobe-jahreswechsel.mjs'), 'utf8');
assert(/await jahresdatenQuellenAusgeben\(year\);/.test(probe), 'Liveprobe ruft den Testmodus mit dem Prüfjahr auf');
const { jahresdatenQuellenAusgeben } = await import('../scripts/liveprobe-jahreswechsel.mjs');
const ausgabe = [];
const log = console.log;
console.log = zeile => ausgabe.push(zeile);
try { await jahresdatenQuellenAusgeben(2025, { abrufen: gespeicherterAbruf(antworten()), leserOptionen }); } finally { console.log = log; }
assertEqual(ausgabe.at(-1), 'Ergebnis: alle Quellen erreichbar und lesbar (Exit 0)', 'Liveprobe gibt die Quellentabelle aus');
const cli = fs.readFileSync(path.join(root, 'scripts/jahresdaten.mjs'), 'utf8');
assert(cli.includes("args.includes('--quellen')") && cli.includes('return ergebnis.exit;'), 'CLI kennt --quellen und gibt den Exit des Modus zurück');
