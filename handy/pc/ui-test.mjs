// Browsertest der Handy-Seite in Pixel-Größe mit Musterdaten.
// Ohne BASIS startet er die lokale Vorschau selbst; BASIS=https://… prüft die echte Seite. BILDER=<ordner> speichert Bildschirmfotos.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { baueDaten, verschluessele } from './qr-ausgabe.mjs';
import { MUSTER } from './muster.mjs';

const code = verschluessele(baueDaten(MUSTER).daten);
const BILDER = process.env.BILDER;
const foto = async (seite, name, optionen = {}) => { if (BILDER) await seite.screenshot({ path: `${BILDER}/${name}.png`, ...optionen }); };
let vorschau = null;
const BASIS = process.env.BASIS || await new Promise((fertig, fehler) => {
  vorschau = spawn(process.execPath, [new URL('./vorschau.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: '8789' } });
  vorschau.stdout.once('data', () => fertig('http://localhost:8789/'));
  vorschau.once('error', fehler);
});

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
const p = await ctx.newPage();
const fehler = []; p.on('console', m => m.type() === 'error' && fehler.push(m.text())); p.on('pageerror', e => fehler.push(String(e)));
await p.goto(BASIS); await p.waitForLoadState('networkidle');
assert.ok(await p.isVisible('#leer')); await foto(p, '1-leer');

await p.click('#leer [data-aktion=scannen]');
await p.waitForSelector('#scanner[open]');
const hinweis = await p.textContent('#scanHinweis'); console.log('Scanner-Hinweis (Desktop-Chromium ohne BarcodeDetector/Kamera):', hinweis);
await p.click('.einfuegen summary'); await p.fill('#codeFeld', code); await p.click('[data-aktion=einfuegen]');
await p.waitForSelector('#scanner:not([open])', { state: 'attached' });
await p.waitForFunction(() => !document.getElementById('aktualisieren').disabled && document.querySelector('.person'));
const api = await (await p.request.get(BASIS + 'api/kurse?s=VWCE.DE,XEON.DE,VGWL.DE')).json();
const k = api.kurse; const soll = 120.5 * k['VWCE.DE'].kurs + 40 * k['XEON.DE'].kurs + 15.1234 * k['VGWL.DE'].kurs;
const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
assert.equal(await p.textContent('#gesamtWert'), euro.format(soll), 'Gesamtsumme = Summe Stück × Kurs');
console.log('Gesamt:', await p.textContent('#gesamtWert'), '|', (await p.textContent('#gesamtDelta')).trim());
console.log('Stand:', (await p.innerText('.stand')).replace(/\n/g, ' | '));
await foto(p, '2-zu');
await p.click('.person[data-index="0"] summary');
await foto(p, '3-offen', { fullPage: true });
console.log('Tranchen Max:', (await p.$$eval('.person[data-index="0"] .tranche', l => l.map(e => e.innerText.replace(/\n/g, ' / ')))).join(' || '));

await p.route('**/api/**', r => r.abort());
await p.click('#aktualisieren');
await p.waitForFunction(() => document.querySelector('.stand .hinweis'));
assert.match(await p.innerText('.stand'), /Aktualisierung fehlgeschlagen/);
assert.equal(await p.locator('.alt').count(), 3, 'alle drei Tranchen als älterer Kurs markiert');
assert.equal(await p.textContent('#gesamtWert'), euro.format(soll), 'Summe bleibt mit letzten Kursen stehen');
await foto(p, '4-fehler', { fullPage: true });
await p.unroute('**/api/**');

await p.reload(); await p.waitForSelector('.person');
assert.ok(await p.$eval('.person[data-index="0"]', d => d.open), 'Aufklappzustand bleibt erhalten');
await p.click('#menueKnopf'); await p.waitForSelector('#menue[open]'); await foto(p, '5-menue');
p.once('dialog', d => d.accept()); await p.click('[data-aktion=loeschen]');
assert.ok(await p.isVisible('#leer'), 'Löschen führt zum leeren Zustand');
assert.equal(await p.evaluate(() => localStorage.getItem('depot.positionen.v1')), null);
console.log('Konsolenfehler:', fehler.length ? fehler : 'keine');
await b.close(); vorschau?.kill(); console.log('ui ok');
