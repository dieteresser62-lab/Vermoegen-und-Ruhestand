// Prüft die Kurswahl des Vermittlers: neuester plausibler Kurs, Vortag immer gegen Xetra.
import assert from 'node:assert/strict';
import worker, { waehle } from '../worker/index.js';

const k = (kurs, zeit, boerse, vortag = null) => ({ kurs, vortag, waehrung: 'EUR', zeit, boerse });
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
assert.equal(waehle(xetra, [k(167.62 * 1.051, '2026-11-10T20:11:00Z', 'Stuttgart')], abend), xetra);
// Morgens vor 9 Uhr: Stuttgart hat heute gehandelt, Xetra noch nicht. Vortag ist dann Xetras letzter Kurs.
const morgen = '2026-11-11T07:45:00Z'; // 8:45 Uhr
assert.deepEqual(waehle(xetra, [k(168.0, '2026-11-11T07:40:00Z', 'Stuttgart', 167.9)], morgen),
  { ...k(168.0, '2026-11-11T07:40:00Z', 'Stuttgart'), vortag: 167.62 });
// Kurz nach Mitternacht (Berliner Zeit) zählt der neue Tag: der Abendkurs von gestern fällt raus.
assert.equal(waehle(xetra, [k(167.7, '2026-11-10T20:59:00Z', 'Stuttgart')], '2026-11-10T23:30:00Z'), xetra);
// Ohne Xetra-Kurs gibt es keinen Kurs, auch wenn abends etwas da wäre.
assert.deepEqual(waehle({ fehler: 'Yahoo 404' }, [k(167.7, '2026-11-10T20:11:00Z', 'Stuttgart')], abend), { fehler: 'Yahoo 404' });

// Ende zu Ende mit nachgebautem Yahoo: welche Ticker werden gefragt, was kommt zurück?
const gefragt = [];
const sek = Math.floor(Date.now() / 1000);
const yahoo = { 'VWCE.DE': [167.62, sek - 120, 'GER', 167.42], 'VWCE.SG': null, 'VWCE.DU': [167.66, sek - 60, 'DUS', 168.08],
  'VWCE.F': [100.86, 0, 'FRA', 100.42], 'MSFT': [500, sek - 120, 'NMS', 498] };
globalThis.fetch = async url => {
  const t = decodeURIComponent(new URL(url).pathname.split('/').pop());
  gefragt.push(t);
  const y = yahoo[t];
  if (!y) return new Response('{"chart":{"result":null}}', { status: 404 });
  return Response.json({ chart: { result: [{ meta: { regularMarketPrice: y[0], regularMarketTime: y[1], exchangeName: y[2], chartPreviousClose: y[3], currency: 'EUR' } }] } });
};
const r = await (await worker.fetch(new Request('https://x/api/kurse?s=VWCE.DE,MSFT'))).json();
assert.deepEqual(gefragt.sort(), ['MSFT', 'VWCE.DE', 'VWCE.DU', 'VWCE.SG'], 'Abendbörsen nur für .DE');
assert.equal(r.kurse['VWCE.DE'].boerse, 'Düsseldorf');
assert.equal(r.kurse['VWCE.DE'].vortag, 167.42, 'Vortag aus Xetra, nicht aus Düsseldorf');
assert.equal(r.kurse.MSFT.boerse, 'NMS');
// 16 Ticker gehen (48 Unteranfragen), 17 nicht.
const viele = n => Array.from({ length: n }, (_, i) => `T${i}.DE`).join(',');
assert.equal((await worker.fetch(new Request(`https://x/api/kurse?s=${viele(16)}`))).status, 200);
assert.equal((await worker.fetch(new Request(`https://x/api/kurse?s=${viele(17)}`))).status, 400);
console.log('worker ok: Abendkurse, Plausibilität, Morgen, Mitternacht, Ende zu Ende, Grenze 16 Ticker');
