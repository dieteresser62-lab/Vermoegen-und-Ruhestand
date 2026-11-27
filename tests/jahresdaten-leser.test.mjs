// JD-2b Soll 1: Leser für `npm run jahresdaten -- <Y> --holen`, offline mit gespeicherten Beispielantworten.
// Die Auszüge unter tests/fixtures/jahresdaten-leser/ stammen aus dem Live-Abruf vom 17.11.2026. Kein Test ruft das Netz.
// Geprüft: Werte 2025 gleich dem gespeicherten Stand, Beleg mit SHA-256, Ersatzweg Bundesbank, offene Lieferung mit Anleitung.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KETTEN, kette } from '../scripts/lib/jahresdaten/ketten.mjs';
import { lieferungFehler, lieferungLesen, lieferungSchreiben } from '../scripts/lib/jahresdaten/lieferung.mjs';
import { sha256 } from '../scripts/lib/jahresdaten/kanonisch.mjs';
import { ANLEITUNG_DATEI, LESER, VORLAGE_DATEI, holen, ketteHolen } from '../scripts/lib/jahresdaten/holen.mjs';
import { AbrufFehler, ERLAUBTE_HOSTS, erlaubteAdresse, gespeicherterAbruf, netzAbruf } from '../scripts/lib/jahresdaten/leser/netz.mjs';
import { csvZeilen, kaufmaennischRunden, OffenFehler } from '../scripts/lib/jahresdaten/leser/gemeinsam.mjs';
import { pruefen } from '../scripts/lib/jahresdaten/pruefung.mjs';
import { wegwerfkopieAnlegen, wegwerfkopieEntfernen } from '../scripts/lib/jahresdaten/wegwerfkopie.mjs';
import * as aktien from '../scripts/lib/jahresdaten/leser/aktien.mjs';
import * as inflation from '../scripts/lib/jahresdaten/leser/inflation.mjs';
import * as geldmarkt from '../scripts/lib/jahresdaten/leser/geldmarkt.mjs';
import * as lohn from '../scripts/lib/jahresdaten/leser/lohn.mjs';
import * as gold from '../scripts/lib/jahresdaten/leser/gold.mjs';
import * as cape from '../scripts/lib/jahresdaten/leser/cape.mjs';
import { miniXlsx } from './helpers/mini-xlsx.mjs';

console.log('--- Jahresdaten: Leser offline ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(root, 'tests', 'fixtures', 'jahresdaten-leser');
const lies = name => fs.readFileSync(path.join(FIXTURES, name));
const json = value => JSON.stringify(value);

const goldZeilen = JSON.parse(lies('weltbank-gold-zeilen.json').toString('utf8'));
const capeZellen = JSON.parse(lies('shiller-cape-zellen.json').toString('utf8'));
const jahresXlsx = miniXlsx({ 'Annual Prices (Nominal)': goldZeilen['Annual Prices (Nominal)'] });
const monatsXlsx = miniXlsx({ 'Monthly Prices': goldZeilen['Monthly Prices'] });
const shillerXls = Buffer.from('Platzhalter für ie_data.xls; der Test liest die Zellen aus shiller-cape-zellen.json', 'utf8');
const shillerSeite = lies('shiller-seite-auszug.html');
const shillerLink = cape.dateiLink(shillerSeite.toString('utf8'));

/** Gelesene Zellen wie readBiff8Sheet: Map Zeile → Map Spalte → Wert. */
function blattAusFixture(bytes, blatt) {
    if (!bytes.equals(shillerXls) || blatt !== 'Data') throw new Error('unerwartete Arbeitsmappe');
    const cells = new Map(capeZellen.zeilen.map(({ zeile, date, cape: wert }) => [zeile, new Map([[0, date], [12, wert]])]));
    const textCells = new Map([[capeZellen.kopf.zeile, new Map([[0, capeZellen.kopf.date], [12, capeZellen.kopf.cape]])]]);
    return { cells, textCells };
}

function antworten2025() {
    return {
        [aktien.quellen(2025).oecd]: lies('oecd-2025.csv'),
        [aktien.quellen(2025).ezb]: lies('ezb-exr-2025.csv'),
        [aktien.quellen(2025).bundesbank]: lies('bundesbank-bbex3-2025.csv'),
        [inflation.SEITE]: lies('destatis-vpi-auszug.html'),
        [geldmarkt.quellen(2025).estr]: lies('ezb-estr-2024-2025.csv'),
        [geldmarkt.quellen(2025).bbmmb]: lies('bundesbank-bbmmb-2025.csv'),
        [lohn.SEITE]: lies('destatis-verdienste-auszug.html'),
        [gold.quellen(2025).jahrespreise]: jahresXlsx,
        [gold.quellen(2025).monatspreise]: monatsXlsx,
        [gold.quellen(2025).kurs]: lies('bundesbank-usd-eur-2025.csv'),
        [cape.SEITE]: shillerSeite,
        [shillerLink]: shillerXls
    };
}
const leserOptionen = { blattLesen: blattAusFixture };

async function wirft(promiseFactory, Klasse, muster, label) {
    try {
        await promiseFactory();
        assert(false, `${label}: wirft`);
    } catch (error) {
        assert(error instanceof Klasse, `${label}: ${Klasse.name} (${error?.message})`);
        if (muster) assert(muster.test(error.message), `${label}: Meldung „${error.message}“`);
    }
}

console.log('Test 1: Netz nur zu den freigegebenen öffentlichen Endpunkten');
assertEqual(json(ERLAUBTE_HOSTS), json(['sdmx.oecd.org', 'data-api.ecb.europa.eu', 'api.statistiken.bundesbank.de', 'thedocs.worldbank.org',
    'shillerdata.com', 'www.shillerdata.com', 'img1.wsimg.com', 'www.destatis.de']), 'Freigabeliste wie im Ideengespräch');
for (const adresse of ['http://www.destatis.de/x', 'https://r.jina.ai/https://shillerdata.com/', 'https://genesis.destatis.de/genesisWS/rest/2020/',
    'https://nutzer:geheim@data-api.ecb.europa.eu/x', 'https://example.org/']) {
    let abgelehnt = false;
    try { erlaubteAdresse(adresse); } catch (error) { abgelehnt = error instanceof AbrufFehler; }
    assert(abgelehnt, `abgelehnt: ${adresse}`);
}
const fakeFetch = antworten => async url => {
    const eintrag = antworten[String(url)];
    if (!eintrag) throw new Error(`unerwartet ${url}`);
    return new Response(eintrag.body ?? null, { status: eintrag.status, headers: eintrag.headers ?? {} });
};
const weiter = await netzAbruf('https://www.shillerdata.com/', { fetchImpl: fakeFetch({
    'https://www.shillerdata.com/': { status: 301, headers: { location: 'https://shillerdata.com/' } },
    'https://shillerdata.com/': { status: 200, body: 'ok', headers: { 'last-modified': 'Mon, 16 Nov 2026 13:56:57 GMT' } }
}) });
assertEqual(weiter.url, 'https://shillerdata.com/', 'Weiterleitung innerhalb der Freigabe wird verfolgt');
assertEqual(weiter.text(), 'ok', 'Antworttext');
assertEqual(weiter.kopf['last-modified'], 'Mon, 16 Nov 2026 13:56:57 GMT', 'Last-Modified bleibt erhalten');
await wirft(() => netzAbruf('https://shillerdata.com/', { fetchImpl: fakeFetch({
    'https://shillerdata.com/': { status: 302, headers: { location: 'https://r.jina.ai/x' } }
}) }), AbrufFehler, /nicht freigegeben/, 'Weiterleitung zu fremdem Host');
let versuche = 0;
const zaehlend = async url => { versuche += 1; return fakeFetch({ 'https://data-api.ecb.europa.eu/x': { status: 503 } })(url); };
await wirft(() => netzAbruf('https://data-api.ecb.europa.eu/x', { fetchImpl: zaehlend, pauseMs: 0 }), AbrufFehler, /HTTP 503/, 'Fehlerstatus');
assertEqual(versuche, 2, 'Serverfehler wird einmal wiederholt');
let zweiterVersuch = 0;
const erstFehler = async url => (zweiterVersuch++ === 0 ? new Response(null, { status: 500 }) : new Response('ok', { status: 200 }));
assertEqual((await netzAbruf('https://sdmx.oecd.org/x', { fetchImpl: erstFehler, pauseMs: 0 })).text(), 'ok', 'zweiter Versuch nach HTTP 500 gelingt');
versuche = 0;
const nichtGefunden = async () => { versuche += 1; return new Response(null, { status: 404 }); };
await wirft(() => netzAbruf('https://sdmx.oecd.org/y', { fetchImpl: nichtGefunden, pauseMs: 0 }), AbrufFehler, /HTTP 404/, 'HTTP 404');
assertEqual(versuche, 1, 'kein zweiter Versuch bei HTTP 404');

console.log('Test 2: Hilfen für CSV und Rundung');
assertEqual(json(csvZeilen('﻿A;B\n1;"x;y"\n', ';')), json([{ A: '1', B: 'x;y' }]), 'CSV mit BOM und Anführungszeichen');
assertEqual(kaufmaennischRunden(2.175, 2), 2.18, 'halbe Stelle aufwärts');
assertEqual(kaufmaennischRunden(-0.565, 2), -0.57, 'halbe Stelle von null weg');
assert(Object.is(kaufmaennischRunden(-0.004, 2), 0), 'kein −0');

console.log('Test 3: Jeder Leser liefert 2025 die gespeicherten Werte mit Beleg');
const abrufen = gespeicherterAbruf(antworten2025());
const gelesen = {};
for (const modul of KETTEN) {
    const { KETTE } = modul;
    const ergebnis = await LESER[KETTE.id].holen({ root, jahr: 2025, abrufen, ...leserOptionen });
    gelesen[KETTE.id] = ergebnis;
    const { lieferung, dateien } = ergebnis;
    assertEqual(json(lieferungFehler(lieferung, KETTE, 2025)), '[]', `${KETTE.label}: Lieferung gültig`);
    assertEqual(lieferung.lieferant, 'skript', `${KETTE.label}: Lieferant skript`);
    assertEqual(lieferung.status, 'endgueltig', `${KETTE.label}: Status endgültig`);
    assertEqual(lieferung.quelle.abrufdatum, '2026-11-17', `${KETTE.label}: Abrufdatum`);
    assert(/^https:\/\//.test(lieferung.quelle.url) && erlaubteAdresse(lieferung.quelle.url), `${KETTE.label}: Quelle mit freigegebener URL`);
    for (const eintrag of lieferung.rohdaten) assertEqual(sha256(dateien.get(eintrag.datei)), eintrag.sha256, `${KETTE.label}: SHA-256 von ${eintrag.datei}`);
    const chain = modul.lesen(root);
    const stand = modul.gespeichert(chain, 2025, root), vorjahr = modul.gespeichert(chain, 2024, root);
    for (const [feld, toleranz] of Object.entries(KETTE.anschluss.toleranz)) {
        const vergleich = (geliefert, soll, label) => {
            if (KETTE.werte[feld].gruppe) for (const key of KETTE.werte[feld].gruppe) assertEqual(geliefert[feld][key], soll[feld][key], `${KETTE.label}: ${label} ${feld}.${key}`);
            else if (KETTE.id === 'us-shiller-cape-chain') assert(Math.abs(geliefert[feld] - soll[feld]) < 1e-12, `${KETTE.label}: ${label} ${feld} bis auf Rundungsrauschen (${geliefert[feld]})`);
            else assertEqual(geliefert[feld], soll[feld], `${KETTE.label}: ${label} ${feld} (Toleranz ${toleranz} nicht nötig)`);
        };
        vergleich(lieferung.werte, stand, 'Wert 2025');
        vergleich(lieferung.anschluss.werte, vorjahr, 'Anschluss 2024');
    }
}
assertEqual(gelesen['german-cash-money-market-chain'].lieferung.werte.monatsmittel, 2.1818, 'Geldmarkt: Gegenprüfung mit dem Mittel der BBMMB-Monatswerte');
assert(/Mittel der €STR-Tageswerte/.test(gelesen['german-cash-money-market-chain'].lieferung.methode), 'Geldmarkt: Methode Mittel der Tageswerte');
assert(/255 Tageswerte 2025-01-02 bis 2025-12-31, Mittel ungerundet 2\.1781/.test(gelesen['german-cash-money-market-chain'].lieferung.hinweis), 'Geldmarkt: Tage und ungerundetes Mittel im Hinweis');
assertEqual(json(gelesen['german-cpi-chain'].lieferung.basis), json({ indexstand: '2020=100' }), 'Inflation: Basis aus der Tabellenüberschrift');
assertEqual(json(Object.keys(gelesen['german-cpi-chain'].lieferung.alteJahre)), json(['2021', '2022', '2023']), 'Inflation: ältere Jahre der Seite für den Bericht');
assertEqual(json(gelesen['german-gross-wage-growth-chain'].lieferung.basis), json({ indexstand: '2025=100' }), 'Lohn: Basis 2025=100');
assertEqual(gelesen['german-gross-wage-growth-chain'].lieferung.quelle.veroeffentlichungsstand, 'Stand 10. März 2026', 'Lohn: Stand der Seite');
assert(Object.keys(gelesen['german-gross-wage-growth-chain'].lieferung.alteJahre).length > 50, 'Lohn: ältere Jahre mit amtlichem Index für den Bericht');
assert(/Gegenprüfung: Mittel der zwölf Monatswerte 3441\.50/.test(gelesen['gold-german-investor-chain'].lieferung.hinweis), 'Gold: Gegenprüfung mit den Monatswerten');
assertEqual(json(gelesen['gold-german-investor-chain'].lieferung.rohdaten.map(item => item.art)), json(['auszug', 'antwort', 'auszug']), 'Gold: Auszug der Arbeitsmappen, Bundesbank-Antwort ganz');
assertEqual(gelesen['gold-german-investor-chain'].lieferung.rohdaten[0].originalSha256, sha256(jahresXlsx), 'Gold: SHA-256 der abgerufenen Arbeitsmappe');
const capeLieferung = gelesen['us-shiller-cape-chain'].lieferung;
assertEqual(json(capeLieferung.rohdaten.map(({ datei, art, originalDatei, originalSha256 }) => ({ datei, art, originalDatei, originalSha256 }))),
    json([{ datei: 'rohauszug-shiller-cape.csv', art: 'auszug', originalDatei: shillerLink, originalSha256: sha256(shillerXls) }]), 'CAPE: nur Auszug und Prüfsumme');
assertEqual(gelesen['us-shiller-cape-chain'].dateien.get('rohauszug-shiller-cape.csv').toString('utf8'),
    'Date,CAPE\n2023.12,31.452310923844557\n2024.12,37.711191696434625\n', 'CAPE: Auszug mit zwei Zeilen');
assert(shillerLink.startsWith('https://img1.wsimg.com/') && shillerLink.includes('/ie_data.xls'), 'CAPE: Link aus shillerdata.com auf den Dateispeicher');

console.log('Test 3a: Status vorläufig nach Frist und Merkmal der Quelle (Nachtrag 1, P2)');
{
    const frueh = gespeicherterAbruf(antworten2025(), '2026-01-10T12:00:00.000Z');
    const status = {};
    for (const modul of KETTEN) status[modul.KETTE.label] = (await LESER[modul.KETTE.id].holen({ root, jahr: 2025, abrufen: frueh, ...leserOptionen })).lieferung.status;
    assertEqual(json(status), json({ Aktien: 'vorlaeufig', Inflation: 'vorlaeufig', Geldmarkt: 'endgueltig', Lohn: 'vorlaeufig', Gold: 'vorlaeufig', CAPE: 'endgueltig' }),
        'Abruf am 10.01.: Aktien (ab 1.2.), Inflation (ab 15.1.), Lohn (ab 1.3.), Gold (ab 1.2.) vorläufig; Geldmarkt vollständig, CAPE sofort');
    const amStichtag = gespeicherterAbruf(antworten2025(), '2026-01-15T08:00:00.000Z');
    assertEqual((await inflation.holen({ root, jahr: 2025, abrufen: amStichtag })).lieferung.status, 'endgueltig', 'Inflation ab 15.01. endgültig');
    const markiert = lies('destatis-vpi-auszug.html').toString('utf8').replace('</table>', '<tfoot><tr><td>2025: vorläufiges Ergebnis</td></tr></tfoot></table>');
    assertEqual((await inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: markiert }) })).lieferung.status, 'vorlaeufig', 'Inflation mit Merkmal „vorläufig“ in der Jahrestabelle');
    const lohnMarkiert = lies('destatis-verdienste-auszug.html').toString('utf8').replace('</table>', '</table><p>2025 vorläufige Ergebnisse</p>');
    assertEqual((await lohn.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [lohn.SEITE]: lohnMarkiert }) })).lieferung.status, 'vorlaeufig', 'Lohn mit Merkmal „vorläufig“');
    const ohneMonate = await gold.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [gold.quellen(2025).monatspreise]: { status: 503 } }) });
    assertEqual(ohneMonate.lieferung.status, 'vorlaeufig', 'Gold ohne Monatsdatei: vorläufig');
    const ohneJanuar = (bytes, blatt) => {
        const blattDaten = blattAusFixture(bytes, blatt);
        for (const [zeile, zellen] of blattDaten.cells) if (Math.abs(zellen.get(0) - 2025.01) < 1e-9) blattDaten.cells.delete(zeile);
        return blattDaten;
    };
    const capeJung = await cape.holen({ root, jahr: 2025, abrufen, blattLesen: ohneJanuar });
    assertEqual(capeJung.lieferung.status, 'vorlaeufig', 'CAPE: Dezember Y−1 als jüngster Monat ist vorläufig');
    for (const modul of KETTEN) assert(typeof LESER[modul.KETTE.id].STATUSREGEL === 'string', `${modul.KETTE.label}: Statusregel benannt`);
}

console.log('Test 4: Ersatzweg Bundesbank, wenn die EZB ausfällt');
const ohneEzb = gespeicherterAbruf({ ...antworten2025(), [aktien.quellen(2025).ezb]: { status: 503 } });
const ersatz = await aktien.holen({ jahr: 2025, abrufen: ohneEzb });
assertEqual(ersatz.lieferung.rohdaten[1].datei, 'antwort-bundesbank-bbex3.csv', 'Bundesbank-Antwort als Beleg');
assertEqual(ersatz.lieferung.werte.ezbDezember.GBP, 0.875, 'Bundesbank-Kurs Dezember 2025');
assertEqual(ersatz.lieferung.anschluss.werte.ezbDezember.GBP, 0.82804, 'Bundesbank rundet auf fünf Stellen');
assert(/Ersatz Bundesbank BBEX3 A02/.test(ersatz.lieferung.hinweis) && /Ersatz für die EZB/.test(ersatz.lieferung.methode), 'Hinweis und Methode nennen den Ersatzweg');

console.log('Test 5: Nicht veröffentlicht oder unlesbar ergibt OffenFehler, nichts wird erfunden');
const abruf2026 = gespeicherterAbruf(Object.fromEntries(Object.entries(antworten2025()).map(([url, inhalt]) => [url.replaceAll('2025', '2026').replaceAll('2024', '2025'), inhalt])));
await wirft(() => aktien.holen({ jahr: 2026, abrufen: abruf2026 }), OffenFehler, /OECD liefert noch keinen Wert für AUS 2026-12/, 'Aktien 2026');
await wirft(() => inflation.holen({ root, jahr: 2026, abrufen: gespeicherterAbruf(antworten2025()) }), OffenFehler, /noch keinen Jahreswert für 2026/, 'Inflation 2026');
await wirft(() => lohn.holen({ root, jahr: 2026, abrufen: gespeicherterAbruf(antworten2025()) }), OffenFehler, /noch keinen Jahreswert für 2026/, 'Lohn 2026');
await wirft(() => gold.holen({ jahr: 2026, abrufen: abruf2026 }), OffenFehler, /Jahrespreis Gold fehlt für 2026/, 'Gold 2026');
await wirft(() => cape.holen({ root, jahr: 2026, abrufen: gespeicherterAbruf(antworten2025()), ...leserOptionen }), OffenFehler, /CAPE Dezember 2025 fehlt/, 'CAPE 2026');
const estrKurz = lies('ezb-estr-2024-2025.csv').toString('utf8').split('\n').filter(line => !line.includes(',2025-12-')).join('\n');
const geldmarktKurz = await geldmarkt.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [geldmarkt.quellen(2025).estr]: estrKurz }) });
assertEqual(geldmarktKurz.lieferung.status, 'vorlaeufig', 'Geldmarkt ohne Dezember: vorläufig');
assert(/Vorläufig, €STR 2025: Tageswerte reichen erst bis 2025-11-28, es fehlt der letzte TARGET-Geschäftstag 2025-12-31/.test(geldmarktKurz.lieferung.hinweis), 'Geldmarkt: Hinweis nennt den fehlenden letzten Geschäftstag');
await wirft(() => cape.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [cape.SEITE]: '<a href="https://example.org/ie_data.xls">x</a>' }), ...leserOptionen }),
    OffenFehler, /verlinkt keine ie_data\.xls/, 'CAPE ohne Link');
await wirft(() => inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: '<html>umgebaut</html>' }) }),
    OffenFehler, /Tabelle 236128 fehlt/, 'Inflation mit umgebauter Seite');
const elfMonate = { 'Monthly Prices': goldZeilen['Monthly Prices'].filter(row => row[0] !== '2025M12') };
const goldVorlaeufig = await gold.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [gold.quellen(2025).monatspreise]: miniXlsx(elfMonate) }) });
assertEqual(goldVorlaeufig.lieferung.status, 'vorlaeufig', 'Gold: nur elf Monatswerte → vorläufig');
const umbasiert = lies('destatis-vpi-auszug.html').toString('utf8').replace('2020=100', '2025=100');
const vpiUmbasiert = await inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: umbasiert }) });
assertEqual(vpiUmbasiert.lieferung.basis.indexstand, '2025=100', 'Inflation: neue Basis wird geliefert, nicht umgerechnet');
assert(vpiUmbasiert.lieferung.alteJahre === undefined, 'Inflation: alte Jahre nur bei gleicher Basis');

console.log('Test 5a: Geldmarkt erst mit dem letzten TARGET-Geschäftstag endgültig (Nachtrag 1, P1)');
assertEqual(json([2022, 2023, 2025, 2026].map(geldmarkt.letzterTargetTag)), json(['2022-12-30', '2023-12-29', '2025-12-31', '2026-12-31']), 'letzter TARGET-Tag, am Wochenende der Freitag davor');
const estrText = lies('ezb-estr-2024-2025.csv').toString('utf8');
const ohne = (...tage) => estrText.split('\n').filter(line => !tage.some(tag => line.includes(`,${tag},`))).join('\n');
const ohne2024 = geldmarkt.estrLesen(ohne('2024-12-31'), 2025);
assertEqual(json([ohne2024.vorjahr.mittel, ohne2024.vorjahr.vorlaeufig]), json([3.65, true]), 'echte Werte 2024 ohne 31.12.: 3,65 statt 3,64, aber vorläufig');
const ohneSilvester = await geldmarkt.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [geldmarkt.quellen(2025).estr]: ohne('2025-12-31') }) });
assertEqual(ohneSilvester.lieferung.status, 'vorlaeufig', '2025 ohne 31.12.: vorläufig');
assertEqual(geldmarkt.estrLesen(ohne('2025-12-30', '2025-12-31'), 2025).jahr.vorlaeufig, true, '2025 ohne 30. und 31.12.: vorläufig');
const luecke = estrText.split('\n').filter(line => !/,2025-0[2-9]-/.test(line)).join('\n');
assert(/nur 86 Tageswerte \(mindestens 250\)/.test(geldmarkt.estrLesen(luecke, 2025).jahr.luecken.join(' ')), '2025 ohne Februar bis September: zu wenige Tage, vorläufig');
assertEqual(geldmarkt.estrLesen(estrText, 2025).jahr.vorlaeufig, false, 'volles Jahr endgültig');
const doppelt = estrText.replace(/\n(EST[^\n]*,2025-06-02,[^\n]*)/, '\n$1\n$1');
await wirft(async () => geldmarkt.estrLesen(doppelt, 2025), OffenFehler, /2025-06-02 kommt mehrfach vor/, 'doppelter Tag ist ein Leserfehler');
const leer = estrText.replace(/(,2025-06-02,)[^,]*/, '$1 ');
await wirft(async () => geldmarkt.estrLesen(leer, 2025), OffenFehler, /2025-06-02 ist leer oder nicht numerisch/, 'leerer Tageswert ist ein Leserfehler, nicht 0');

console.log('Test 5b: Jeder Leserfehler macht nur seine Kette offen (Nachtrag 1, P3)');
{
    const ziel3 = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-leser-'));
    try {
        const html = Buffer.from('<html>Wartungsseite</html>', 'utf8');
        for (const [label, ersatz] of [
            ['HTML statt Jahresmappe', { [gold.quellen(2025).jahrespreise]: html }],
            ['umbenanntes Blatt', { [gold.quellen(2025).jahrespreise]: miniXlsx({ 'Annual Prices': goldZeilen['Annual Prices (Nominal)'] }) }]
        ]) {
            const ergebnisse = await holen({ root, ziel: ziel3, jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), ...ersatz }), leserOptionen, ersetzen: KETTEN.map(modul => modul.KETTE.id) });
            assertEqual(json(ergebnisse.map(item => item.ergebnis)), json(['geliefert', 'geliefert', 'geliefert', 'geliefert', 'offen', 'geliefert']), `${label}: nur Gold offen, CAPE danach weiter geholt`);
            assert(/Weltbank-Arbeitsmappe, Blatt „Annual Prices \(Nominal\)“ nicht lesbar/.test(ergebnisse[4].grund), `${label}: Grund nennt die Arbeitsmappe`);
            assert(fs.existsSync(path.join(ziel3, ergebnisse[4].ordner, ANLEITUNG_DATEI)), `${label}: Anleitung für Gold`);
        }
        const monatsHtml = await gold.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [gold.quellen(2025).monatspreise]: html }) });
        assertEqual(monatsHtml.lieferung.status, 'vorlaeufig', 'Monatsdatei als HTML: Gold geliefert, aber vorläufig');
        const kaputtLeser = { ...LESER, 'us-shiller-cape-chain': { ...cape, holen: async () => { throw new TypeError('unerwarteter Programmfehler'); } } };
        const fremd = await ketteHolen({ root, ziel: path.join(ziel3, 'leer'), jahr: 2025, abrufen, leserTabelle: kaputtLeser }, kette('us-shiller-cape-chain'));
        assertEqual(json([fremd.ergebnis, fremd.grund]), json(['offen', 'Leser CAPE gescheitert: unerwarteter Programmfehler']), 'beliebiger Leserfehler ergibt eine offene Lieferung');
        assert(cape.dateiLink('<a href="https://[kaputt">x</a><a href="//img1.wsimg.com/a/ie_data.xls">y</a>').endsWith('/ie_data.xls'), 'CAPE: kaputter Link wird übersprungen');
    } finally {
        fs.rmSync(ziel3, { recursive: true, force: true });
    }
}

console.log('Test 5c: Leere oder nicht numerische Zellen und doppelte Zeilen sind Leserfehler, nie 0 (Nachtrag 1, P4)');
{
    const vpi = lies('destatis-vpi-auszug.html').toString('utf8');
    const rateLeer = vpi.replace(/(scope="row">2025<\/th>\s*<td>)2,2(<\/td>)/, '$1 $2');
    assert(rateLeer !== vpi, 'Fixture: Rate 2025 geleert');
    await wirft(() => inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: rateLeer }) }), OffenFehler, /Zelle für 2025 ist leer oder nicht numerisch/, 'Inflation: leere Rate wird nicht 0');
    const fussnote = vpi.replace(/(scope="row">2025<\/th>\s*<td>)121,9(<\/td>)/, '$1121,9<sup>1</sup>$2');
    await wirft(() => inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: fussnote }) }), OffenFehler, /nicht numerisch/, 'Inflation: Fußnote in der Zelle');
    const neueSpalte = vpi.replaceAll('<th colspan="1">Jahr</th>', '<th colspan="1">Jahr</th><th>Neu</th>').replace(/(scope="row">\d{4}<\/th>\s*)<td>/g, '$1<td>9,9</td><td>');
    const mitSpalte = await inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: neueSpalte }) });
    assertEqual(json(mitSpalte.lieferung.werte), json({ jahresrate: 2.2, indexstand: 121.9 }), 'Inflation: Spalte über den Kopf bestimmt, neue erste Spalte ändert den Wert nicht');
    const nurKopf = vpi.replace('<th colspan="1">Jahr</th>', '<th colspan="1">Jahr</th><th>Neu</th>');
    await wirft(() => inflation.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [inflation.SEITE]: nurKopf }) }), OffenFehler, /passt nicht zu den Spaltenköpfen/, 'Inflation: Kopf und Zeilen passen nicht zusammen');
    const lohnHtml = lies('destatis-verdienste-auszug.html').toString('utf8');
    await wirft(() => lohn.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [lohn.SEITE]: lohnHtml.replace('<td>3,4</td>', '<td>3,4<sup>1</sup></td>') }) }),
        OffenFehler, /Zelle für 2025 ist leer oder nicht numerisch/, 'Lohn: Fußnote in der Zelle');
    await wirft(() => lohn.holen({ root, jahr: 2025, abrufen: gespeicherterAbruf({ [lohn.SEITE]: lohnHtml.replace('<td>3,4</td>', '<td> </td>') }) }),
        OffenFehler, /Zelle für 2025 ist leer oder nicht numerisch/, 'Lohn: leere Zelle');
    const oecd = lies('oecd-2025.csv').toString('utf8');
    const deuZeile = oecd.split('\n').find(line => line.includes(',DEU,') && line.includes(',2025-12,'));
    await wirft(() => aktien.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [aktien.quellen(2025).oecd]: oecd.replace(deuZeile, `${deuZeile.replace('154.2791', '160')}\n${deuZeile}`) }) }),
        OffenFehler, /OECD-Zeile DEU 2025-12 kommt 2-mal vor/, 'Aktien: doppelte OECD-Zeile');
    await wirft(() => aktien.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [aktien.quellen(2025).oecd]: oecd.replace(deuZeile, deuZeile.replace('154.2791', ' ')) }) }),
        OffenFehler, /OECD liefert noch keinen Wert für DEU 2025-12/, 'Aktien: leerer Wert wird nicht 0');
    const goldLeer = { 'Annual Prices (Nominal)': goldZeilen['Annual Prices (Nominal)'].map(row => (row[0] === '2025' ? ['2025', ' '] : row)) };
    await wirft(() => gold.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [gold.quellen(2025).jahrespreise]: miniXlsx(goldLeer) }) }),
        OffenFehler, /Jahrespreis Gold für 2025 ist leer oder nicht numerisch/, 'Gold: leere Zelle');
    const usd = lies('bundesbank-usd-eur-2025.csv').toString('utf8');
    const usdZeile = usd.split('\n').find(line => line.includes(';2025;'));
    await wirft(() => gold.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [gold.quellen(2025).kurs]: `${usd.trimEnd()}\n${usdZeile}\n` }) }),
        OffenFehler, /Bundesbank-Zeile USD\/EUR 2025 kommt 2-mal vor/, 'Gold: doppelte Bundesbank-Zeile');
}

console.log('Test 6: holen schreibt Lieferungen und offene Lieferungen mit Anleitung');
const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-leser-'));
try {
    const alle = await holen({ root, ziel, jahr: 2025, abrufen, leserOptionen });
    assertEqual(json(alle.map(item => item.ergebnis)), json(Array(6).fill('geliefert')), 'alle sechs Ketten geliefert');
    for (const modul of KETTEN) {
        const lieferung = lieferungLesen(ziel, modul.KETTE, 2025);
        assert(lieferung.vorhanden && !lieferung.lesefehler, `${modul.KETTE.label}: lieferung.json lesbar`);
        assertEqual(json(lieferung.rohdatenFehler), '[]', `${modul.KETTE.label}: Belege passen zum SHA-256`);
    }
    const nochmal = await holen({ root, ziel, jahr: 2025, abrufen: gespeicherterAbruf({}) });
    assertEqual(json(nochmal.map(item => item.ergebnis)), json(Array(6).fill('vorhanden')), 'vorhandene Lieferungen bleiben ohne --ersetzen unangetastet');

    const ohneDestatis = gespeicherterAbruf({ ...antworten2025(), [inflation.SEITE]: undefined });
    const behalten = await ketteHolen({ root, ziel, jahr: 2025, abrufen: ohneDestatis, ersetzen: ['german-cpi-chain'] }, kette('german-cpi-chain'));
    assertEqual(behalten.ergebnis, 'vorhanden', '--ersetzen mit gescheitertem Neuabruf: alte Lieferung bleibt');
    assert(lieferungLesen(ziel, kette('german-cpi-chain').KETTE, 2025).vorhanden && /Neuabruf gescheitert/.test(behalten.hinweise[0]), 'alte Inflationslieferung unverändert, Hinweis nennt den Grund');
    fs.rmSync(path.join(ziel, 'data/historical/german-cpi-chain/jahre/2025'), { recursive: true });
    const offen = await ketteHolen({ root, ziel, jahr: 2025, abrufen: ohneDestatis }, kette('german-cpi-chain'));
    assertEqual(offen.ergebnis, 'offen', 'Inflation ohne Antwort: offen');
    assert(/Abruf https:\/\/www\.destatis\.de\/.+ gescheitert/.test(offen.grund), 'Grund nennt die Adresse');
    const ordner = path.join(ziel, offen.ordner);
    assertEqual(json(fs.readdirSync(ordner).sort()), json([ANLEITUNG_DATEI, VORLAGE_DATEI].sort()), 'nur Anleitung und Vorlage, keine alte Lieferung');
    const anleitung = fs.readFileSync(path.join(ordner, ANLEITUNG_DATEI), 'utf8');
    for (const teil of ['## Welche Seite', '## Welche Zahl', '## Welcher Beleg', 'Verbraucherpreise-12Kategorien', '`jahresrate`', 'npm run jahresdaten -- 2025 --pruefen']) {
        assert(anleitung.includes(teil), `Anleitung enthält ${teil}`);
    }
    const vorlage = JSON.parse(fs.readFileSync(path.join(ordner, VORLAGE_DATEI), 'utf8'));
    assertEqual(json(vorlage.werte), json({ jahresrate: null, indexstand: null }), 'Vorlage ohne Werte');
    assertEqual(json([vorlage.lieferant, vorlage.status, vorlage.basis.indexstand, vorlage.anschluss.jahr]), json(['agent', 'vorlaeufig', '2020=100', 2024]), 'Vorlage mit Lieferant agent, Status vorläufig, gespeicherter Basis und Anschlussjahr');
    assert(vorlage.hinweis.includes('ab 15. Januar des Folgejahres') && anleitung.includes('auf `endgueltig` erst stellen, wenn gilt'), 'Vorlage und Anleitung nennen, wann auf endgültig umzustellen ist');
    const gefuellt = { ...vorlage, werte: { jahresrate: 2.2, indexstand: 121.9 }, anschluss: { jahr: 2024, werte: { jahresrate: 2.2, indexstand: 119.3 } } };
    assertEqual(json(lieferungFehler(gefuellt, kette('german-cpi-chain').KETTE, 2025)), json(['lieferung.quelle.abrufdatum hat kein gültiges Format',
        'lieferung.quelle.veroeffentlichungsstand ist leer', 'lieferung.rohdaten[0].datei hat kein gültiges Format', 'lieferung.rohdaten[0].sha256 hat kein gültiges Format']),
    'Vorlage mit Werten scheitert nur an den Platzhaltern für Quelle und Beleg');

    // Nachtrag 1, P5: --ersetzen nur für genannte Ketten, Agent/Hand nur mit --auch-hand, vorläufig zählt als offen.
    const goldOrdner = path.join(ziel, 'data/historical/gold-german-investor-chain/jahre/2025/lieferung.json');
    const handLieferung = { ...JSON.parse(fs.readFileSync(goldOrdner, 'utf8')), lieferant: 'agent' };
    fs.writeFileSync(goldOrdner, JSON.stringify(handLieferung));
    const ohneHand = await holen({ root, ziel, jahr: 2025, abrufen, leserOptionen, ersetzen: ['gold-german-investor-chain'] });
    assertEqual(json(ohneHand.map(item => item.ergebnis)), json(['vorhanden', 'geliefert', 'vorhanden', 'vorhanden', 'vorhanden', 'vorhanden']), 'nur genannte Ketten werden ersetzt, offene Inflation neu geholt');
    assert(/ersetzen nur zusätzlich mit --auch-hand/.test(ohneHand[4].hinweise[0]) && JSON.parse(fs.readFileSync(goldOrdner, 'utf8')).lieferant === 'agent', 'Agentenlieferung ohne --auch-hand nicht überschrieben');
    const mitHand = await holen({ root, ziel, jahr: 2025, abrufen, leserOptionen, ersetzen: ['gold-german-investor-chain'], auchHand: true });
    assertEqual(mitHand[4].ergebnis, 'geliefert', 'mit --auch-hand ersetzt');
    const goldVorl = await gold.holen({ jahr: 2025, abrufen: gespeicherterAbruf({ ...antworten2025(), [gold.quellen(2025).monatspreise]: { status: 503 } }) });
    lieferungSchreiben(ziel, 'gold-german-investor-chain', 2025, goldVorl.dateien);
    const zweiter = await ketteHolen({ root, ziel, jahr: 2025, abrufen: gespeicherterAbruf({}) }, kette('gold-german-investor-chain'));
    assertEqual(json([zweiter.ergebnis, zweiter.status]), json(['vorhanden', 'vorlaeufig']), 'vorläufige Lieferung: Neuabruf versucht, bei Fehlschlag bleibt sie und zählt als vorläufig');
    const dritter = await ketteHolen({ root, ziel, jahr: 2025, abrufen, leserOptionen }, kette('gold-german-investor-chain'));
    assertEqual(json([dritter.ergebnis, dritter.status]), json(['geliefert', 'endgueltig']), 'vorläufige Skriptlieferung wird ohne --ersetzen neu geholt');
    const { ketteAusName } = await import('../scripts/lib/jahresdaten/holen.mjs');
    assertEqual(json(['aktien', 'CAPE', 'german-cpi-chain', 'bitcoin'].map(ketteAusName)), json(['global-equity-research-chain', 'us-shiller-cape-chain', 'german-cpi-chain', null]), 'Kurznamen der Ketten');
    const cli = args => spawnSync(process.execPath, ['scripts/jahresdaten.mjs', ...args], { cwd: root, encoding: 'utf8' });
    for (const args of [['2026', '--holen', '--ersetzen'], ['2026', '--holen', '--ersetzen', 'bitcoin'], ['2026', '--holen', '--auch-hand'], ['2026', '--pruefen', '--ersetzen', 'gold']]) {
        assertEqual(cli(args).status, 3, `Aufruf ${args.join(' ')} bricht ab, ohne etwas zu holen`);
    }
} finally {
    fs.rmSync(ziel, { recursive: true, force: true });
}

console.log('Test 7: Prüfung meldet offene Lieferungen mit Verweis auf die Anleitung');
const kopie = wegwerfkopieAnlegen(root, 'jahresdaten-leser-');
try {
    const jahr = (await import('../app/simulator/simulator-data.js')).HISTORICAL_DATENSTAND.endYear + 1;
    const ergebnisse = await holen({ root: kopie, jahr, abrufen: gespeicherterAbruf({}) });
    assertEqual(json(ergebnisse.map(item => item.ergebnis)), json(Array(6).fill('offen')), `${jahr}: alle sechs offen ohne Antwort`);
    const bericht = await pruefen(kopie, jahr);
    assertEqual(bericht.ergebnis, 'rot', 'Prüfung rot');
    for (const modul of KETTEN) {
        assert(bericht.befunde.rot.includes(`${modul.KETTE.label}: Lieferung offen, Anleitung in data/historical/${modul.KETTE.id}/jahre/${jahr}/ANLEITUNG.md`), `${modul.KETTE.label}: offen mit Anleitung gemeldet`);
    }
    lieferungSchreiben(kopie, 'german-cash-money-market-chain', 2025, ohneSilvester.dateien);
    const vorlaeufig = (await pruefen(kopie, 2025)).ketten.find(item => item.id === 'german-cash-money-market-chain');
    assertEqual(json([vorlaeufig.ergebnis, vorlaeufig.rot.includes('Status vorläufig')]), json(['rot', true]), 'Geldmarkt ohne 31.12.: Prüfung rot wegen Status vorläufig');
} finally {
    wegwerfkopieEntfernen(kopie);
}

console.log('Test 8: Vergleich der Live-Probe ordnet Abweichungen ein');
{
    const { lieferungenVergleichen, liveBerichtMarkdown } = await import('../scripts/lib/jahresdaten/rueckwaertsprobe-live.mjs');
    const vergleiche = KETTEN.map(modul => lieferungenVergleichen(modul, { vorhanden: true, lieferung: gelesen[modul.KETTE.id].lieferung, rohdatenFehler: [] },
        modul.lieferungAusOriginalen(root, 2025).lieferung));
    for (const item of vergleiche.filter(entry => entry.kette !== 'us-shiller-cape-chain')) assertEqual(item.abweichungen.length, 0, `${item.label}: Fixture gleich dem Original`);
    const capeVergleich = vergleiche.find(entry => entry.kette === 'us-shiller-cape-chain');
    assertEqual(json(capeVergleich.abweichungen.map(feld => feld.einordnung)), json(['Rundungsrauschen', 'Rundungsrauschen']), 'CAPE: neu gespeicherte Arbeitsmappe ist Rundungsrauschen');
    assertEqual(vergleiche.find(entry => entry.kette === 'german-cash-money-market-chain').felder.find(feld => feld.feld === 'monatsmittel').einordnung, 'nur heutige Quelle', 'Geldmarkt: Gegenprüfung nur in der heutigen Lieferung');
    const geaendert = JSON.parse(JSON.stringify(gelesen['gold-german-investor-chain'].lieferung));
    geaendert.anschluss.werte.goldUsdJeUnze = 2390;
    geaendert.werte.goldUsdJeUnze = 3442.004;
    const gold2 = lieferungenVergleichen(kette('gold-german-investor-chain'), { vorhanden: true, lieferung: geaendert }, kette('gold-german-investor-chain').lieferungAusOriginalen(root, 2025).lieferung);
    assertEqual(json(gold2.abweichungen.map(feld => [feld.teil, feld.einordnung])), json([['Wert 2025', 'innerhalb der Anschlusstoleranz'], ['Anschluss 2024', 'Abweichung']]), 'Gold: Revision als Abweichung gemeldet');
    const text = liveBerichtMarkdown({ jahr: 2025, vergleiche, ketten: [], fehler: [], holen: { exit: 0, ausgabe: '' }, pruefen: { exit: 0 }, uebernehmen: { exit: 0 },
        vergleich: { contentHash: 'c'.repeat(64), contentHashGleich: false, datenmodulBytegleich: true }, bericht: null }, '2026-11-17');
    assert(text.includes('Genau die gespeicherten Werte liefern heute: Aktien, Inflation, Geldmarkt, Lohn, Gold.') && text.includes('weichen ab: CAPE.'), 'Bericht fasst gleich und Rauschen zusammen');
}
