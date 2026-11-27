// JD-2a Nachtrag Punkt 1 und Soll 4: Fortschreibungsschicht je Kette. Die Ketten-Ausgaben lassen sich lesen und
// bytegleich wieder schreiben; die Rechenregel erzeugt aus der Lieferung 2025 (aus den Originalen) dieselbe Zeile wie
// der Bau; Werte vor dem neuen Jahr bleiben unverändert; die Bauskripte nutzen dieselben Regeln und Ausgaben.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KETTEN, kette } from '../scripts/lib/jahresdaten/ketten.mjs';
import { fortschreibungAnwenden, jahreszeile, zeileAnhaengen, zeileEntfernen } from '../scripts/lib/jahresdaten/fortschreibung.mjs';
import { lieferungBauen, lieferungSchreiben } from '../scripts/lib/jahresdaten/lieferung.mjs';
import { GRUNDBESTAND, GRUNDBESTAND_END_YEAR } from '../scripts/lib/jahresdaten/grundbestand.mjs';
import { HISTORICAL_CHAIN_SERIES } from '../scripts/historical-data-generate.mjs';
import { HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';
import { createHash } from 'node:crypto';

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex');

console.log('--- Jahresdaten: Ketten und Fortschreibung ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureError = callback => { try { callback(); return null; } catch (error) { return error; } };
const SHA = 'a'.repeat(64);

console.log('Test 1: dieselben sechs Ketten wie der Generator, Grundbestand bis 2025');
assertEqual(JSON.stringify(KETTEN.map(modul => modul.KETTE.seriesId)), JSON.stringify(HISTORICAL_CHAIN_SERIES.map(spec => spec.seriesId)), 'Reihenfolge der Jahressätze');
assertEqual(GRUNDBESTAND_END_YEAR, 2025, 'Originale und Bauskripte sind für 1925–2025 eingefroren');
assertEqual(GRUNDBESTAND.contentHash, 'c79350c5abf2dee2feeaae65c88ed5e58487f878cb598fdffc132fbf48d01e79', 'Kennung des Grundbestands');

console.log('Test 2: Lesen und Schreiben ist bytegleich, Endjahr wie im Datenstand');
for (const modul of KETTEN) {
    const chain = modul.lesen(root);
    assertEqual(modul.endjahr(chain), HISTORICAL_DATENSTAND.endYear, `${modul.KETTE.label}: Endjahr der Ketten-Ausgabe`);
    for (const [file, text] of modul.schreiben(chain)) {
        assert(fs.readFileSync(path.join(root, file), 'utf8') === text, `${modul.KETTE.label}: ${file} bytegleich geschrieben`);
    }
}

console.log('Test 3: Methodenprobe im Speicher – Zeile 2025 aus der Lieferung bytegleich');
for (const modul of KETTEN) {
    const chain = modul.lesen(root);
    let ohne = chain;
    while (modul.endjahr(ohne) >= 2025) ohne = zeileEntfernen(modul, ohne, modul.endjahr(ohne));
    const { lieferung } = modul.lieferungAusOriginalen(root, 2025);
    const mit = zeileAnhaengen(modul, ohne, lieferung, SHA);
    assertEqual(JSON.stringify(jahreszeile(modul, mit, 2025)), JSON.stringify(jahreszeile(modul, chain, 2025)), `${modul.KETTE.label}: Zeile 2025 bytegleich`);
    assertEqual(JSON.stringify(mit.fortschreibung.lieferungen.map(({ jahr, sha256 }) => ({ jahr, sha256 }))), JSON.stringify([{ jahr: 2025, sha256: SHA }]),
        `${modul.KETTE.label}: Fortschreibungsblock nennt Jahr und SHA-256`);
    assertEqual(JSON.stringify(mit.fortschreibung.lieferungen[0].werte), JSON.stringify(lieferung.werte), `${modul.KETTE.label}: Eingangswerte im Block`);
    if (modul.endjahr(chain) === 2025) {
        const { fortschreibung, ...ohneBlock } = mit;
        assertEqual([...modul.schreiben(ohneBlock).values()].join(), [...modul.schreiben(chain).values()].join(),
            `${modul.KETTE.label}: Ketten-Ausgabe ohne Block bytegleich (Endjahr, Segmente, Hashes)`);
    }
}

console.log('Test 4: alte Jahre eingefroren, Anschluss an das Endjahr');
const cpi = kette('german-cpi-chain');
const cpiChain = cpi.lesen(root);
const lieferung2026 = { ...cpi.lieferungAusOriginalen(root, 2025).lieferung, jahr: 2026, werte: { jahresrate: 2.1, indexstand: 124.5 },
    anschluss: { jahr: 2025, werte: { jahresrate: 2.2, indexstand: 121.9 } } };
const basis = (() => { let c = cpiChain; while (cpi.endjahr(c) > 2025) c = zeileEntfernen(cpi, c, cpi.endjahr(c)); return c; })();
const neu = zeileAnhaengen(cpi, basis, lieferung2026, SHA);
assertEqual(neu.annualRates[2026], 2.1, 'Neue Rate 2026');
assertEqual(neu.indexLevels[2026], basis.indexLevels[2025] * (1 + 2.1 / 100), 'Synthetischer Index nach der Bauregel');
assertEqual(neu.period.endYear, 2026, 'Endjahr der Kette');
assertEqual(neu.segments.at(-1).endYear, 2026, 'Letztes Segment reicht bis 2026');
for (let year = 1925; year <= 2025; year += 1) {
    if (neu.annualRates[year] !== basis.annualRates[year] || neu.indexLevels[year] !== basis.indexLevels[year]) assert(false, `Wert ${year} unverändert`);
}
assert(true, 'Alle Werte 1925–2025 unverändert');
const falschesJahr = captureError(() => zeileAnhaengen(cpi, basis, { ...lieferung2026, jahr: 2027 }, SHA));
assert(falschesJahr?.message.includes('schließt nicht an'), 'Ein Jahr mit Lücke wird abgewiesen');
const veraendernd = { ...cpi, endjahrSetzen: (chain, year) => { cpi.endjahrSetzen(chain, year); chain.annualRates[2000] += 0.1; } };
const schutz = captureError(() => zeileAnhaengen(/** @type {any} */ (veraendernd), basis, lieferung2026, SHA));
assert(schutz?.message.includes('würde Werte vor 2026'), 'Eine Änderung eines alten Jahres bricht ab');
const gold = kette('gold-german-investor-chain');
const goldChain = gold.lesen(root);
const goldLieferung = gold.lieferungAusOriginalen(root, 2025).lieferung;
const nullrendite = { ...goldLieferung, werte: { ...goldLieferung.anschluss.werte } };
assert(captureError(() => gold.zeileBerechnen(goldChain, nullrendite))?.message.includes('Nullrendite'), 'Gold: unklassifizierte Nullrendite ist unzulässig');

console.log('Test 5: Bauskripte bauen den Grundbestand und hängen spätere Jahre mit derselben Regel an');
const bauskripte = {
    'global-equity-research-chain': 'build-global-equity-research-chain.mjs',
    'german-cpi-chain': 'build-german-cpi-chain.mjs',
    'german-cash-money-market-chain': 'build-german-cash-money-market-chain.mjs',
    'german-gross-wage-growth-chain': 'build-german-gross-wage-growth-chain.mjs',
    'gold-german-investor-chain': 'build-gold-german-investor-chain.mjs',
    'us-shiller-cape-chain': 'build-us-shiller-cape-chain.mjs'
};
const regeln = {
    'global-equity-research-chain': ['aktienKette.aktienJahresrendite(', 'aktienKette.aktienLaenderRendite(', 'aktienKette.aktienIndexstand('],
    'german-cpi-chain': ['inflationKette.inflationIndexstand(', 'inflationKette.extractCurrentDestatisValue('],
    'german-cash-money-market-chain': ['geldmarktKette.geldmarktJahreswert('],
    'german-gross-wage-growth-chain': ['lohnKette.lohnBeobachtung('],
    'gold-german-investor-chain': ['goldKette.goldEurJeUnze(', 'goldKette.goldRenditeProzent('],
    'us-shiller-cape-chain': ['capeKette.capeBeobachtung(']
};
for (const [id, datei] of Object.entries(bauskripte)) {
    const source = fs.readFileSync(path.join(root, 'scripts', datei), 'utf8');
    assert(source.includes("import { GRUNDBESTAND_END_YEAR } from './lib/jahresdaten/grundbestand.mjs';"), `${datei}: Grundbestandsende aus dem gemeinsamen Modul`);
    assert(source.includes('const GRUND_END_YEAR = GRUNDBESTAND_END_YEAR;'), `${datei}: Originale nur bis zum Grundbestandsende`);
    assert(/fortschreibungAnwenden\(\w+Kette, [\w()]+, \{ root: (PROJECT_ROOT|ROOT), endYear: END_YEAR \}\)/.test(source), `${datei}: Jahre bis zum Endjahr des Datenstands aus den Lieferungen`);
    assert(source.includes('Kette.schreiben('), `${datei}: Ausgabe über dieselbe Schreibfunktion wie die Übernahme`);
    for (const regel of regeln[id]) assert(source.includes(regel), `${datei}: nutzt die gemeinsame Rechenregel ${regel}`);
}
for (const datei of ['build-german-gross-wage-growth-chain.mjs', 'build-german-cash-money-market-chain.mjs']) {
    assert(fs.readFileSync(path.join(root, 'scripts', datei), 'utf8').includes('baut aus den Originalen nur den Grundbestand bis GRUND_END_YEAR (2025)'),
        `${datei}: vermerkt, dass die 2025-Annahmen nur für den Grundbestand gelten`);
}

console.log('Test 6: ein späterer Bau schreibt übernommene Jahre nicht um (Nachtrag 2, Befund 2)');
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-bau-'));
    try {
        const { schema, rohdaten, ...vorlage } = cpi.lieferungAusOriginalen(root, 2025).lieferung;
        const schreibeLieferung = jahresrate => {
            const { lieferung, dateien } = lieferungBauen({ ...vorlage, jahr: 2026, perioden: cpi.KETTE.periodenFuer(2026),
                werte: { jahresrate, indexstand: 124.5 }, anschluss: { jahr: 2025, werte: { jahresrate: 2.2, indexstand: 121.9 } },
                lieferant: 'hand', rohdateien: [{ datei: 'rohantwort.txt', inhalt: Buffer.from(`CPI 2026 ${jahresrate}\n`, 'utf8') }] });
            lieferungSchreiben(tmp, cpi.KETTE.id, 2026, dateien);
            return { lieferung, sha256: sha256Hex(dateien.get('lieferung.json')) };
        };
        const uebernahme = schreibeLieferung(2.1);
        const uebernommen = zeileAnhaengen(cpi, basis, uebernahme.lieferung, uebernahme.sha256);
        for (const [file, text] of cpi.schreiben(uebernommen)) {
            fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
            fs.writeFileSync(path.join(tmp, file), text);
        }
        const stand = sha => ({ seriesHashes: { inflation_de: { lieferungen: [{ jahr: 2026, sha256: sha }] } } });
        const gebaut = fortschreibungAnwenden(cpi, basis, { root: tmp, endYear: 2026, datenstand: stand(uebernahme.sha256) });
        assertEqual(JSON.stringify(gebaut), JSON.stringify(uebernommen), 'Bau mit unveränderter Lieferung ergibt den übernommenen Stand');
        const geaendert = schreibeLieferung(4.1);
        const abbruch = captureError(() => fortschreibungAnwenden(cpi, basis, { root: tmp, endYear: 2026, datenstand: stand(uebernahme.sha256) }));
        assert(abbruch?.message.includes('Jahreslieferung 2026 weicht vom übernommenen Stand ab'), `CPI 2,1 übernommen, Lieferung auf 4,1 geändert: Bau bricht ab (${abbruch?.message})`);
        const zeile = captureError(() => fortschreibungAnwenden(cpi, basis, { root: tmp, endYear: 2026, datenstand: stand(geaendert.sha256) }));
        assert(zeile?.message.includes('neu berechnete Jahreszeile 2026 weicht von der übernommenen ab'), 'Auch mit angepasstem SHA bricht die abweichende Jahreszeile ab');
        const fehlt = captureError(() => fortschreibungAnwenden(cpi, basis, { root: tmp, endYear: 2026, datenstand: { seriesHashes: {} } }));
        assert(fehlt?.message.includes('ist laut Datenstand nicht übernommen'), 'Ein nicht übernommenes Jahr baut der Bau nicht an');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

console.log('✅ Jahresdaten Ketten tests passed');
