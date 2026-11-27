// Prüft den Weg App-Stand → QR-Code → Handy: Inhalt, Lesbarkeit des QR-Bildes, Entschlüsseln.
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { baueDaten, verschluessele } from './qr-ausgabe.mjs';
import { entschluessele } from '../public/code.js';
import { MUSTER } from './muster.mjs';

const { daten, hinweise } = baueDaten(MUSTER, new Date('2026-11-10T20:00:00Z'));
assert.deepEqual(daten.p.map(p => p.n), ['Max', 'Erika']);
assert.deepEqual(daten.p[0].t, [['MUSTER WELT-AKTIEN ETF', 'VWCE.DE', 120.5], ['MUSTER GELDMARKT ETF', 'XEON.DE', 40]]);
assert.equal(hinweise.length, 2, 'ohne Ticker und Stückzahl 0 werden gemeldet');

const code = verschluessele(daten);
const png = PNG.sync.read(await QRCode.toBuffer(code, { errorCorrectionLevel: 'M', margin: 4, scale: 4 }));
assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, code, 'QR-Bild liest sich zurück');

const { positionen } = entschluessele(code);
assert.equal(positionen.stand, '2026-11-10T20:00:00.000Z');
assert.equal(positionen.personen[1].tranchen[0].name, 'Größe ÄÖÜ', 'Umlaute überstehen den Weg');
assert.equal(positionen.personen[1].tranchen[0].stueck, 15.1234);

assert.throws(() => entschluessele('hallo'), /kein Depot-Code/);
assert.throws(() => entschluessele('DEPOT1:%%%'), /beschädigt/);
assert.throws(() => entschluessele(verschluessele({ p: [{ n: 'X', t: [['a', 'BÖSE<script>', 1]] }] })), /Ticker/);
assert.throws(() => entschluessele(verschluessele({ p: [{ n: 'X', t: [['a', 'SAP.DE', -1]] }] })), /Stückzahl/);
console.log('test ok: Musterdaten, QR-Bild, Entschlüsseln, Fehlerfälle');

const ticker = Array.from({ length: 25 }, (_, index) => `T${index}.DE`);
const letzterKurs = { kurs: 99, vortag: 98, waehrung: 'EUR', zeit: null, boerse: 'Xetra' };
const speicher = new Map([
  ['depot.positionen.v1', JSON.stringify({ p: [{ n: 'Muster', t: ticker.map(t => [t, t, 1]) }] })],
  ['depot.kurse.v1', JSON.stringify({ 'T24.DE': letzterKurs })]
]);
const felder = new Map();
const dokumentAktionen = new Map();
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(typ, aktion) { dokumentAktionen.set(typ, aktion); },
  getElementById(id) {
    if (!felder.has(id)) felder.set(id, { addEventListener(typ, aktion) { this[typ] = aktion; }, classList: { toggle() {} }, querySelector: () => ({}) });
    return felder.get(id);
  }
};
globalThis.localStorage = { getItem: key => speicher.get(key), setItem: (key, value) => speicher.set(key, value) };
const abrufe = [], verlaufAbrufe = [];
let verlaufFehler = false;
globalThis.fetch = async url => {
  const teil = new URL(url, 'https://muster.invalid/').searchParams.get('s').split(',');
  if (url.startsWith('api/verlauf')) {
    verlaufAbrufe.push(teil);
    return { ok: true, json: async () => ({ verlauf: Object.fromEntries(teil.map(t => [t,
      verlaufFehler && t === 'T24.DE' ? { fehler: 'Yahoo 429' } : { waehrung: 'EUR', punkte: [['2026-11-02', 98]] }])) }) };
  }
  abrufe.push(teil);
  if (teil.includes('T24.DE')) return { ok: false, status: 503 };
  return { ok: true, json: async () => ({ kurse: Object.fromEntries(teil.map(t => [t, { ...letzterKurs, kurs: 100 }])) }) };
};
await import('../public/app.js');
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(abrufe.map(teil => teil.length), [12, 12, 1]);
assert.deepEqual(abrufe.flat(), ticker);
const aktualisiert = JSON.parse(speicher.get('depot.kurse.v1'));
assert.equal(aktualisiert['T23.DE'].kurs, 100);
assert.deepEqual(aktualisiert['T24.DE'], letzterKurs);
assert.match(felder.get('kursStand').innerHTML, /Aktualisierung fehlgeschlagen/);
console.log('test ok: 25 Ticker in drei Abrufen, vorhandener Kurs bleibt bei Teilfehler');

// Der Verlauf kommt in einem Abruf (bis 40 Ticker) und erst nach sechs Stunden wieder.
assert.deepEqual(verlaufAbrufe, [ticker]);
assert.deepEqual(Object.keys(JSON.parse(speicher.get('depot.verlauf.v1')).ticker), ticker);
await felder.get('aktualisieren').click();
assert.equal(abrufe.length, 6, 'Kurse neu');
assert.equal(verlaufAbrufe.length, 1, 'Verlauf noch frisch');
const echteUhr = Date.now;
const vorFehler = JSON.parse(speicher.get('depot.verlauf.v1')).ticker['T24.DE'];
try {
  const spaeter = echteUhr() + 6 * 3600_000 + 60_000;
  Date.now = () => spaeter;
  verlaufFehler = true;
  await felder.get('aktualisieren').click();
  assert.deepEqual(verlaufAbrufe[1], ticker, 'Verlauf nach sechs Stunden neu');
  const gespeichert = JSON.parse(speicher.get('depot.verlauf.v1')).ticker['T24.DE'];
  assert.deepEqual(gespeichert, vorFehler, 'Yahoo 429 lässt den gespeicherten Verlauf unangetastet');

  const nachTeilfehler = speicher.get('depot.verlauf.v1');
  await dokumentAktionen.get('visibilitychange')();
  assert.deepEqual(verlaufAbrufe[2], ['T24.DE'], 'Beim nächsten Öffnen wird nur der fehlgeschlagene Ticker erneut geladen');
  assert.equal(speicher.get('depot.verlauf.v1'), nachTeilfehler, 'Wenn auch der nächste Versuch fehlschlägt, bleibt der Verlauf unverändert');

  verlaufFehler = false;
  Date.now = () => spaeter + 1_000;
  await dokumentAktionen.get('visibilitychange')();
  assert.deepEqual(verlaufAbrufe[3], ['T24.DE'], 'Der nächste Versuch kann den Verlauf wieder aktualisieren');
  await felder.get('aktualisieren').click();
  assert.equal(verlaufAbrufe.length, 4, 'Nach Erfolg gilt auch für diesen Ticker die Frist');
} finally {
  Date.now = echteUhr;
}

const altVerlauf = JSON.parse(speicher.get('depot.verlauf.v1'));
altVerlauf.geladen = new Date().toISOString();
delete altVerlauf.tickerGeladen;
altVerlauf.ticker['T24.DE'] = { fehler: 'Yahoo 429' };
speicher.set('depot.verlauf.v1', JSON.stringify(altVerlauf));
await import('../public/app.js?alter-verlaufscache');
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(verlaufAbrufe[4], ['T24.DE'], 'Ein älterer Cache mit gespeichertem Fehler wird beim Öffnen repariert');
console.log('test ok: Verlauf bleibt bei Yahoo 429 erhalten, erneuter Abruf je Ticker');
