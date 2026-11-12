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
