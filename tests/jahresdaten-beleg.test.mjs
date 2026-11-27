// JD-2c Punkt 1: Werte gegen Beleg. Der Leser der Kette liest die Rohdatei neu; jedes Feld muss mit lieferung.json
// übereinstimmen (Anschlusstoleranz). Fälle aus der Abnahme: CAPE 61 gegen den Auszug 37,71 und Inflation 2,6 gegen 2,2.
// Belege aus den Originalen (Rückwärtsprobe) und aus dem Live-Abruf (Fixtures vom 17.11.2026) werden erkannt. Kein Netz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KETTEN, kette } from '../scripts/lib/jahresdaten/ketten.mjs';
import { lieferungBauen, lieferungSchreiben } from '../scripts/lib/jahresdaten/lieferung.mjs';
import { BelegFehler, belegAbweichungen, belegWerte } from '../scripts/lib/jahresdaten/beleg.mjs';
import { LESER } from '../scripts/lib/jahresdaten/holen.mjs';
import { gespeicherterAbruf } from '../scripts/lib/jahresdaten/leser/netz.mjs';
import * as aktien from '../scripts/lib/jahresdaten/leser/aktien.mjs';
import * as inflation from '../scripts/lib/jahresdaten/leser/inflation.mjs';
import * as geldmarkt from '../scripts/lib/jahresdaten/leser/geldmarkt.mjs';
import * as lohn from '../scripts/lib/jahresdaten/leser/lohn.mjs';
import * as gold from '../scripts/lib/jahresdaten/leser/gold.mjs';
import * as cape from '../scripts/lib/jahresdaten/leser/cape.mjs';
import { miniXlsx } from './helpers/mini-xlsx.mjs';

console.log('--- Jahresdaten: Werte gegen Beleg ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value);
const FIXTURES = path.join(root, 'tests', 'fixtures', 'jahresdaten-leser');
const lies = name => fs.readFileSync(path.join(FIXTURES, name));
const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-beleg-'));
const pruefen = (modul, lieferung) => belegAbweichungen(modul.KETTE, lieferung, belegWerte(ziel, modul.KETTE, lieferung));

try {
    console.log('Test 1: Lieferungen 2025 aus den Originalen passen zu ihrem Beleg');
    const original = {};
    for (const modul of KETTEN) {
        const { lieferung, dateien } = modul.lieferungAusOriginalen(root, 2025);
        lieferungSchreiben(ziel, modul.KETTE.id, 2025, dateien);
        original[modul.KETTE.id] = lieferung;
        assertEqual(json(pruefen(modul, lieferung)), '[]', `${modul.KETTE.label}: Beleg aus dem Original bestätigt alle Werte`);
    }

    console.log('Test 2: Fälle aus der Abnahme sind Abweichungen');
    const capeFalsch = structuredClone(original['us-shiller-cape-chain']);
    capeFalsch.werte.cape = 61;
    const capeAbweichung = pruefen(kette('us-shiller-cape-chain'), capeFalsch);
    assertEqual(json(capeAbweichung.map(item => [item.teil, item.feld, item.geliefert, Number(item.beleg.toFixed(2)), item.toleranz])), json([['Wert', 'cape', 61, 37.71, 0.05]]),
        'CAPE 61 gegen den Auszug 37,71');
    const vpiFalsch = structuredClone(original['german-cpi-chain']);
    vpiFalsch.werte.jahresrate = 2.6;
    assertEqual(json(pruefen(kette('german-cpi-chain'), vpiFalsch).map(item => [item.feld, item.geliefert, item.beleg])), json([['jahresrate', 2.6, 2.2]]), 'Inflation 2,6 gegen den Beleg 2,2');
    const inToleranz = structuredClone(original['german-cpi-chain']);
    inToleranz.werte.jahresrate = 2.24;
    assertEqual(pruefen(kette('german-cpi-chain'), inToleranz).length, 0, 'Abstand 0,04 liegt in der Toleranz 0,05');
    const aktienFalsch = structuredClone(original['global-equity-research-chain']);
    aktienFalsch.anschluss.werte.oecdDezember.DEU += 0.001;
    assertEqual(json(pruefen(kette('global-equity-research-chain'), aktienFalsch).map(item => [item.teil, item.feld])), json([['Anschluss', 'oecdDezember.DEU']]), 'Aktien: Anschluss je Land geprüft');

    console.log('Test 3: Belege des Live-Abrufs und eine gültige Hand-Lieferung');
    const goldZeilen = JSON.parse(lies('weltbank-gold-zeilen.json').toString('utf8'));
    const capeZellen = JSON.parse(lies('shiller-cape-zellen.json').toString('utf8'));
    const shillerXls = Buffer.from('Platzhalter', 'utf8');
    const shillerLink = cape.dateiLink(lies('shiller-seite-auszug.html').toString('utf8'));
    const abrufen = gespeicherterAbruf({
        [aktien.quellen(2025).oecd]: lies('oecd-2025.csv'), [aktien.quellen(2025).ezb]: lies('ezb-exr-2025.csv'),
        [inflation.SEITE]: lies('destatis-vpi-auszug.html'), [geldmarkt.quellen(2025).estr]: lies('ezb-estr-2024-2025.csv'),
        [geldmarkt.quellen(2025).bbmmb]: lies('bundesbank-bbmmb-2025.csv'), [lohn.SEITE]: lies('destatis-verdienste-auszug.html'),
        [gold.quellen(2025).jahrespreise]: miniXlsx({ 'Annual Prices (Nominal)': goldZeilen['Annual Prices (Nominal)'] }),
        [gold.quellen(2025).monatspreise]: miniXlsx({ 'Monthly Prices': goldZeilen['Monthly Prices'] }),
        [gold.quellen(2025).kurs]: lies('bundesbank-usd-eur-2025.csv'), [cape.SEITE]: lies('shiller-seite-auszug.html'), [shillerLink]: shillerXls
    });
    const blattLesen = () => ({
        cells: new Map(capeZellen.zeilen.map(({ zeile, date, cape: wert }) => [zeile, new Map([[0, date], [12, wert]])])),
        textCells: new Map([[capeZellen.kopf.zeile, new Map([[0, capeZellen.kopf.date], [12, capeZellen.kopf.cape]])]])
    });
    const live = path.join(ziel, 'live');
    for (const modul of KETTEN) {
        const { lieferung, dateien } = await LESER[modul.KETTE.id].holen({ root, jahr: 2025, abrufen, blattLesen });
        lieferungSchreiben(live, modul.KETTE.id, 2025, dateien);
        assertEqual(json(belegAbweichungen(modul.KETTE, lieferung, belegWerte(live, modul.KETTE, lieferung))), '[]', `${modul.KETTE.label}: Live-Beleg bestätigt alle Werte`);
    }
    const geldLive = JSON.parse(fs.readFileSync(path.join(live, 'data/historical/german-cash-money-market-chain/jahre/2025/lieferung.json'), 'utf8'));
    geldLive.werte.monatsmittel = 2.19;
    assertEqual(json(belegAbweichungen(kette('german-cash-money-market-chain').KETTE, geldLive, belegWerte(live, kette('german-cash-money-market-chain').KETTE, geldLive)).map(item => item.feld)),
        json(['monatsmittel']), 'Geldmarkt: Monatsmittel gegen BBMMB geprüft');

    const hand = path.join(ziel, 'hand');
    const { lieferung: handLieferung, dateien: handDateien } = lieferungBauen({
        ...Object.fromEntries(Object.entries(original['german-gross-wage-growth-chain']).filter(([key]) => !['schema', 'rohdaten'].includes(key))),
        lieferant: 'hand', methode: 'von Hand übernommen: Destatis-Seite gespeichert',
        rohdateien: [{ datei: 'antwort-destatis-verdienste.html', inhalt: lies('destatis-verdienste-auszug.html'), art: 'antwort' }]
    });
    lieferungSchreiben(hand, 'german-gross-wage-growth-chain', 2025, handDateien);
    assertEqual(json(belegAbweichungen(kette('german-gross-wage-growth-chain').KETTE, handLieferung, belegWerte(hand, kette('german-gross-wage-growth-chain').KETTE, handLieferung))), '[]',
        'gültige Hand-Lieferung mit ganzer Destatis-Seite passt');

    console.log('Test 4: Beleg ohne passenden Leser');
    const { lieferung: textLieferung, dateien: textDateien } = lieferungBauen({
        ...Object.fromEntries(Object.entries(original['us-shiller-cape-chain']).filter(([key]) => !['schema', 'rohdaten'].includes(key))),
        lieferant: 'hand', rohdateien: [{ datei: 'notiz.txt', inhalt: Buffer.from('CAPE abgelesen\n'), art: 'antwort' }]
    });
    lieferungSchreiben(path.join(ziel, 'text'), 'us-shiller-cape-chain', 2025, textDateien);
    let fehler = null;
    try { belegWerte(path.join(ziel, 'text'), kette('us-shiller-cape-chain').KETTE, textLieferung); } catch (error) { fehler = error; }
    assert(fehler instanceof BelegFehler && /kein Shiller-Auszug/.test(fehler.message), `BelegFehler bei fremdem Beleg (${fehler?.message})`);
} finally {
    fs.rmSync(ziel, { recursive: true, force: true });
}
