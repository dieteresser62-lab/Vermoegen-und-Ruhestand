// Prüft die gemeinsame Kurswahl und den Antwortvertrag des Vermittlers.
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { waehle as waehleKurs } from '../../app/shared/kurswahl.js';
import { kennzahlen } from '../public/verlauf.js';

const k = (kurs, zeit, boerse, vortag = null) => ({ kurs, vortag, waehrung: 'EUR', zeit, boerse });
const waehle = (xetra, abends, jetzt) => waehleKurs('MUSTER.DE', [xetra, ...abends], jetzt);
const xetra = k(167.62, '2026-11-10T16:36:06Z', 'Xetra', 167.42);
const abend = '2026-11-10T21:30:00Z'; // 22:30 Uhr in Berlin

// Abends gewinnt der neueste plausible Kurs, der Vortag bleibt der Xetra-Vortag.
assert.deepEqual(waehle(xetra, [k(167.66, '2026-11-10T20:11:00Z', 'Stuttgart', 168.1), k(167.70, '2026-11-10T20:15:00Z', 'Düsseldorf', 168.0)], abend),
  { ...k(167.70, '2026-11-10T20:15:00Z', 'Düsseldorf'), vortag: 167.42 });
// Falsches Papier (40 % daneben), Kurs von gestern und fremde Währung fallen raus.
assert.equal(waehle(xetra, [k(100.86, '2026-11-10T20:11:00Z', 'Frankfurt')], abend), xetra);
assert.equal(waehle(xetra, [k(167.9, '2026-11-09T20:11:00Z', 'Stuttgart')], abend), xetra);
assert.equal(waehle(xetra, [{ ...k(167.9, '2026-11-10T20:11:00Z', 'Stuttgart'), waehrung: 'USD' }], abend), xetra);
// Fehlende Abendkurse oder ältere als Xetra ändern nichts.
assert.equal(waehle(xetra, [{ fehler: 'kein Kurs' }, k(167.5, '2026-11-10T15:00:00Z', 'Stuttgart')], abend), xetra);
// Grenze 5 %: 4,9 % geht durch, 5,1 % nicht.
assert.equal(waehle(xetra, [k(167.62 * 1.049, '2026-11-10T20:11:00Z', 'Stuttgart')], abend).boerse, 'Stuttgart');
assert.equal(waehle(xetra, [k(167.62 * 1.05, '2026-11-10T20:11:00Z', 'Stuttgart')], abend).boerse, 'Stuttgart');
assert.equal(waehle(xetra, [k(167.62 * 1.051, '2026-11-10T20:11:00Z', 'Stuttgart')], abend), xetra);
// Morgens vor 9 Uhr: Stuttgart hat heute gehandelt, Xetra noch nicht. Vortag ist dann Xetras letzter Kurs.
const morgen = '2026-11-11T07:45:00Z'; // 8:45 Uhr
assert.deepEqual(waehle(xetra, [k(168.0, '2026-11-11T07:40:00Z', 'Stuttgart', 167.9)], morgen),
  { ...k(168.0, '2026-11-11T07:40:00Z', 'Stuttgart'), vortag: 167.62 });
// Kurz nach Mitternacht (Berliner Zeit) zählt der neue Tag: der Abendkurs von gestern fällt raus.
assert.equal(waehle(xetra, [k(167.7, '2026-11-10T20:59:00Z', 'Stuttgart')], '2026-11-10T23:30:00Z'), xetra);
// Ausweichkurse behalten ihren eigenen Vortag und dürfen bis zu sieben Tage alt sein.
const fehler = { fehler: 'Yahoo 404' };
const gettex = k(182.1, '2026-11-09T20:54:00Z', 'München/gettex', 181.5);
const alt = k(169.0, '2026-11-03T21:29:59Z', 'Stuttgart');
const grenze = k(168.0, '2026-11-03T21:30:00Z', 'Stuttgart');
const zukunft = k(169.0, '2026-11-10T21:35:01Z', 'Düsseldorf');
assert.equal(waehle(fehler, [alt, grenze, zukunft, gettex], abend), gettex);
// Bis zu fünf Minuten Uhrabweichung gelten wie im Kursdienst der Desktop-App nicht als Zukunft.
const nachgehend = k(167.8, '2026-11-10T21:35:00Z', 'Xetra', 167.42);
assert.equal(waehle(nachgehend, [k(167.9, '2026-11-10T21:20:00Z', 'Stuttgart')], abend), nachgehend);
assert.equal(waehle(alt, [gettex], abend), gettex, 'zu altes Xetra zählt als Ausfall');
assert.equal(waehle(null, [grenze], abend), grenze);
assert.equal(waehle(fehler, [alt, zukunft, { ...gettex, waehrung: 'USD' }, null], abend), fehler);
assert.deepEqual(waehle(null, [null], abend), { fehler: 'kein Kurs' });
const nasdaq = { ...alt, waehrung: 'USD', boerse: 'NMS' };
assert.equal(waehleKurs('MSFT', [nasdaq, gettex], abend), nasdaq);

// Ende zu Ende mit nachgebautem Yahoo: welche Ticker werden gefragt, was kommt zurück?
const gefragt = [];
const SystemDate = Date;
const sek = Date.parse(abend) / 1000;
const yahoo = { 'VWCE.DE': [167.62, sek - 120, 'GER', 167.42], 'VWCE.SG': null, 'VWCE.DU': [167.66, sek - 60, 'DUS', 168.08],
  'VWCE.MU': [167.70, sek - 30, 'MUN', 168.10], 'VWCE.F': [100.86, 0, 'FRA', 100.42], 'MSFT': [500, sek - 120, 'NMS', 498] };
globalThis.Date = class extends SystemDate {
  constructor(...args) { super(...(args.length ? args : [abend])); }
};
globalThis.fetch = async url => {
  const t = decodeURIComponent(new URL(url).pathname.split('/').pop());
  gefragt.push(t);
  const y = yahoo[t];
  if (!y) return new Response('{"chart":{"result":null}}', { status: 404 });
  return Response.json({ chart: { result: [{ meta: { regularMarketPrice: y[0], regularMarketTime: y[1], exchangeName: y[2], chartPreviousClose: y[3], currency: 'EUR' } }] } });
};
const r = await (await worker.fetch(new Request('https://x/api/kurse?s=VWCE.DE,MSFT'))).json();
assert.deepEqual(gefragt.sort(), ['MSFT', 'VWCE.DE', 'VWCE.DU', 'VWCE.MU', 'VWCE.SG'], 'Abendbörsen nur für .DE');
assert.deepEqual(r.kurse['VWCE.DE'], k(167.70, new Date((sek - 30) * 1000).toISOString(), 'München/gettex', 167.42));
assert.equal(r.kurse.MSFT.boerse, 'NMS');
yahoo['VWCE.DE'] = null;
const ausweich = await (await worker.fetch(new Request('https://x/api/kurse?s=VWCE.DE'))).json();
assert.equal(ausweich.kurse['VWCE.DE'].vortag, 168.10);
// 12 Ticker gehen (48 Unteranfragen), 13 nicht.
const viele = n => Array.from({ length: n }, (_, i) => `T${i}.DE`).join(',');
gefragt.length = 0;
assert.equal((await worker.fetch(new Request(`https://x/api/kurse?s=${viele(12)}`))).status, 200);
assert.equal((await worker.fetch(new Request(`https://x/api/kurse?s=${viele(13)}`))).status, 400);
assert.equal(gefragt.length, 48);
console.log('worker ok: Abendkurse, Plausibilität, Morgen, Mitternacht, Ausweichkurs, Grenze 12 Ticker');

// Jahresverlauf, reine Rechnung mit erfundenen Schlüssen. Der 10.11.2026 ist ein Dienstag, der 31.10. ein Samstag.
const punkte = [['2025-11-10', 100], ['2026-03-02', 130], ['2026-10-29', 118], ['2026-10-30', 120], ['2026-11-02', 121],
  ['2026-11-03', 119], ['2026-11-04', 122], ['2026-11-09', 124], ['2026-11-10', 125]];
const p = ([datum, schluss]) => ({ datum, schluss });
assert.deepEqual(kennzahlen(punkte, '2026-11-10'),
  { woche: p(punkte[5]), monat: p(punkte[3]), jahr: p(punkte[0]), hoch52: p(punkte[1]) }, 'Woche, Monat, Jahr, Hoch');
// Sonntag: vor 7 Tagen war auch Sonntag, es zählt Freitag. Das Monatsende fiel auf einen Samstag, es zählt ebenfalls Freitag.
const sonntag = kennzahlen(punkte.slice(0, 7), '2026-11-08');
assert.deepEqual([sonntag.woche, sonntag.monat], [p(punkte[3]), p(punkte[3])]);
// Feiertage 24. und 25.12. (Do, Fr): eine Woche vor Do 31.12. zählt Mi 23.12. Ohne Punkt im Vormonat bleibt monat leer.
const weihnachten = [['2026-12-22', 10], ['2026-12-23', 11], ['2026-12-28', 12], ['2026-12-29', 13], ['2026-12-30', 12.5]];
assert.deepEqual(kennzahlen(weihnachten, '2026-12-31'),
  { woche: p(weihnachten[1]), monat: null, jahr: p(weihnachten[0]), hoch52: p(weihnachten[3]), hinweis: 'weniger als ein Jahr Daten' });
// Weniger als ein Jahr: jahr ist der älteste Punkt, mit Hinweis. Bis zu einer Woche Lücke am Anfang gilt noch als Jahr.
assert.equal(kennzahlen([['2025-11-17', 90], ...punkte.slice(1)], '2026-11-10').hinweis, undefined);
const kurz = kennzahlen([['2025-11-18', 90], ...punkte.slice(1)], '2026-11-10');
assert.deepEqual([kurz.jahr, kurz.hinweis], [{ datum: '2025-11-18', schluss: 90 }, 'weniger als ein Jahr Daten']);
assert.deepEqual(kennzahlen([], '2026-11-10'), { woche: null, monat: null, jahr: null, hoch52: null });

// /api/verlauf mit nachgebautem Yahoo: ein Abruf je Ticker an der eingetragenen Börse, Cloudflare-Cache eine Stunde.
const abfragen = [];
const um = (tag, stunde) => Date.parse(tag) / 1000 + stunde * 3600 - 3600;
globalThis.fetch = async (url, optionen) => {
  const t = decodeURIComponent(new URL(url).pathname.split('/').pop());
  abfragen.push({ t, url, cf: optionen?.cf });
  if (t === 'FEHLT.DE') return new Response('{"chart":{"result":null}}', { status: 404 });
  // Wie bei Yahoo: Börsenzeit 9 Uhr, ein Feiertag ohne Schluss und heute ein zweiter Punkt mit dem laufenden Kurs.
  const timestamp = [...punkte.map(([tag]) => um(tag, 9)), um('2026-11-05', 9), um('2026-11-10', 22)];
  const close = [...punkte.map(([, s]) => s + 0.0000123), null, 125.5];
  return Response.json({ chart: { result: [{ meta: { currency: t === 'EURUSD=X' ? 'USD' : 'EUR', gmtoffset: 3600 }, timestamp,
    indicators: { quote: [{ close }] } }] } });
};
const v = await (await worker.fetch(new Request('https://x/api/verlauf?s=VWCE.DE,^GDAXI,EURUSD=X,GC=F,FEHLT.DE'))).json();
assert.deepEqual(abfragen.map(a => a.t), ['VWCE.DE', '^GDAXI', 'EURUSD=X', 'GC=F', 'FEHLT.DE'], 'keine Abendbörsen');
assert.ok(abfragen.every(a => a.url.endsWith('?interval=1d&range=1y')));
assert.ok(abfragen.every(a => a.cf?.cacheEverything === true && a.cf.cacheTtlByStatus?.['200-299'] === 3600 && a.cf.cacheTtlByStatus?.['400-599'] === 0 && a.cf.cacheTtl === undefined), 'Cache nur für Erfolg, Fehler nie');
assert.equal(v.abgerufen, abend.replace('Z', '.000Z'));
const tagesschluesse = [...punkte.slice(0, -1), ['2026-11-10', 125.5]];
assert.deepEqual(v.verlauf['VWCE.DE'], { waehrung: 'EUR', punkte: tagesschluesse, ...kennzahlen(tagesschluesse, '2026-11-10') });
assert.deepEqual(v.verlauf['VWCE.DE'].woche, p(punkte[5]));
assert.equal(v.verlauf['EURUSD=X'].waehrung, 'USD');
assert.deepEqual(v.verlauf['FEHLT.DE'], { fehler: 'Yahoo 404' });
// 40 Ticker gehen (40 Unteranfragen), 41 nicht, unzulässige Zeichen auch nicht. /api/kurse bleibt bei 12.
abfragen.length = 0;
assert.equal((await worker.fetch(new Request(`https://x/api/verlauf?s=${viele(40)}`))).status, 200);
assert.equal((await worker.fetch(new Request(`https://x/api/verlauf?s=${viele(41)}`))).status, 400);
assert.equal((await worker.fetch(new Request('https://x/api/verlauf?s=<b>'))).status, 400);
assert.equal(abfragen.length, 40);
assert.equal((await worker.fetch(new Request(`https://x/api/kurse?s=${viele(13)}`))).status, 400);
console.log('worker ok: Verlauf Woche, Monat, Jahr, Hoch, Wochenende, Feiertag, kurzer Verlauf, Cache, Grenze 40 Ticker');
