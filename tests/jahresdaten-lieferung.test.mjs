// JD-2a Soll 1 und 6: Lieferformat lieferung.json, Validator und Beleg (Rohdatei + SHA-256), gleich für Skript, Agent und Hand.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KETTEN, kette } from '../scripts/lib/jahresdaten/ketten.mjs';
import {
    LIEFERANTEN,
    LIEFERUNG_SCHEMA,
    STATUS,
    lieferungBauen,
    lieferungFehler,
    lieferungLesen,
    lieferungSchreiben
} from '../scripts/lib/jahresdaten/lieferung.mjs';

console.log('--- Jahresdaten: Lieferformat und Validator ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kopieren = value => JSON.parse(JSON.stringify(value));

console.log('Test 1: Schema nennt alle Pflichtangaben aus Soll 1');
for (const feld of ['jahr', 'werte', 'einheit', 'quelle', 'methode', 'lieferant', 'status', 'anschluss', 'rohdaten']) {
    assert(LIEFERUNG_SCHEMA.required.includes(feld), `Pflichtfeld ${feld}`);
}
assertEqual(JSON.stringify(LIEFERUNG_SCHEMA.properties.quelle.required), JSON.stringify(['name', 'url', 'abrufdatum', 'veroeffentlichungsstand']), 'Quelle mit URL, Abrufdatum und Veröffentlichungsstand');
assert(LIEFERUNG_SCHEMA.required.includes('perioden'), 'Beobachtungsperioden sind Pflicht');
assertEqual(JSON.stringify(KETTEN.map(modul => modul.KETTE.periodenFuer(2026))), JSON.stringify([
    { werte: '2026-12', anschluss: '2025-12' }, { werte: '2026', anschluss: '2025' }, { werte: '2026', anschluss: '2025' },
    { werte: '2026', anschluss: '2025' }, { werte: '2026', anschluss: '2025' }, { werte: '2025-12', anschluss: '2024-12' }]), 'Perioden je Kette für 2026');
assertEqual(JSON.stringify(LIEFERANTEN), JSON.stringify(['skript', 'agent', 'hand']), 'Lieferanten skript, agent, hand');
assertEqual(JSON.stringify(STATUS), JSON.stringify(['endgueltig', 'vorlaeufig']), 'Status endgueltig, vorlaeufig');
assert(LIEFERUNG_SCHEMA.properties.alteJahre && !LIEFERUNG_SCHEMA.required.includes('alteJahre'), 'alteJahre ist optional');

console.log('Test 2: Lieferungen 2025 aus den Originalen sind gültig, je Kette mit Beleg');
const lieferungen = Object.fromEntries(KETTEN.map(modul => [modul.KETTE.id, modul.lieferungAusOriginalen(root, 2025)]));
for (const modul of KETTEN) {
    const { lieferung, dateien } = lieferungen[modul.KETTE.id];
    assertEqual(JSON.stringify(lieferungFehler(lieferung, modul.KETTE, 2025)), '[]', `${modul.KETTE.label}: Lieferung 2025 ist gültig`);
    assertEqual(lieferung.lieferant, 'skript', `${modul.KETTE.label}: Lieferant skript`);
    assertEqual(lieferung.anschluss.jahr, 2024, `${modul.KETTE.label}: Anschluss Y−1`);
    for (const eintrag of lieferung.rohdaten) {
        assert(dateien.has(eintrag.datei), `${modul.KETTE.label}: Rohdatei ${eintrag.datei} liegt neben lieferung.json`);
        assert(/^[a-f0-9]{64}$/.test(eintrag.originalSha256), `${modul.KETTE.label}: SHA-256 des Originals steht in der Lieferung`);
    }
}
const cape = lieferungen['us-shiller-cape-chain'];
assertEqual(cape.lieferung.rohdaten.length, 1, 'CAPE: genau ein Beleg');
assertEqual(cape.lieferung.rohdaten[0].art, 'auszug', 'CAPE: nur ein Auszug, keine Shiller-Datei');
assertEqual(cape.lieferung.rohdaten[0].originalSha256, '0e3d716f83f51c14f40c5ab5662e767cde4f83fcb7305db24ab003df2c9ee6c5', 'CAPE: Prüfsumme der Originaldatei');
assertEqual(cape.dateien.get(cape.lieferung.rohdaten[0].datei).toString('utf8').trim().split('\n').length, 3, 'CAPE-Auszug: Kopf und zwei Zeilen');

console.log('Test 3: Validator weist fehlerhafte Lieferungen ab');
const cpi = kette('german-cpi-chain');
const gueltig = lieferungen['german-cpi-chain'].lieferung;
const fehlerFuer = (aendern, jahr = 2025, modul = cpi, basis = gueltig) => {
    const lieferung = kopieren(basis);
    aendern(lieferung);
    return lieferungFehler(lieferung, modul.KETTE, jahr);
};
const faelle = [
    ['ohne Methode', l => delete l.methode, 'lieferung.methode fehlt'],
    ['falsches Schema', l => { l.schema = 'x'; }, 'lieferung.schema muss Jahreslieferung-1 sein'],
    ['falsche Kette', l => { l.kette = 'us-shiller-cape-chain'; }, 'lieferung.kette ist us-shiller-cape-chain, erwartet german-cpi-chain'],
    ['falscher Lieferant', l => { l.lieferant = 'robot'; }, 'lieferung.lieferant muss eines von skript, agent, hand sein'],
    ['falscher Status', l => { l.status = 'fertig'; }, 'lieferung.status muss eines von endgueltig, vorlaeufig sein'],
    ['Wert nicht endlich', l => { l.werte.jahresrate = null; }, 'werte.jahresrate fehlt oder ist nicht endlich'],
    ['Wert fehlt', l => { delete l.werte.indexstand; }, 'werte.indexstand fehlt oder ist nicht endlich'],
    ['fremdes Feld', l => { l.werte.kurs = 1; }, 'werte.kurs ist kein Feld dieser Kette'],
    ['Anschluss falsches Jahr', l => { l.anschluss.jahr = 2023; }, 'anschluss.jahr ist 2023, erwartet 2024'],
    ['Anschlusswert fehlt', l => { delete l.anschluss.werte.jahresrate; }, 'anschluss.werte.jahresrate fehlt oder ist nicht endlich'],
    ['URL ohne Schema', l => { l.quelle.url = 'destatis.de'; }, 'lieferung.quelle.url hat kein gültiges Format'],
    ['Abrufdatum', l => { l.quelle.abrufdatum = '10.07.2026'; }, 'lieferung.quelle.abrufdatum hat kein gültiges Format'],
    ['ohne Beleg', l => { l.rohdaten = []; }, 'lieferung.rohdaten braucht mindestens 1 Eintrag'],
    ['Beleg ohne SHA', l => { delete l.rohdaten[0].sha256; }, 'lieferung.rohdaten[0].sha256 fehlt'],
    ['Einheit fehlt', l => { delete l.einheit.jahresrate; }, 'einheit.jahresrate fehlt'],
    ['Einheit als Text', l => { l.einheit.jahresrate = 'Prozent zum Vorjahr'; }, 'einheit.jahresrate ist keine Einheitenkennung (prozent, dezimal, index, eur, usd, usd_je_eur, waehrung_je_eur, usd_je_unze, verhaeltnis)'],
    ['Einheit abweichend', l => { l.einheit.jahresrate = 'dezimal'; }, 'einheit.jahresrate ist dezimal, erwartet prozent; Lieferungen werden nicht umgerechnet'],
    ['alteJahre in der Zukunft', l => { l.alteJahre = { 2026: { jahresrate: 2 } }; }, 'alteJahre.2026 ist kein früheres Jahr'],
    ['unbekanntes Feld', l => { l.notiz = 'x'; }, 'lieferung.notiz ist nicht vorgesehen'],
    ['ohne Perioden', l => { delete l.perioden; }, 'lieferung.perioden fehlt'],
    ['Periode passt nicht', l => { l.perioden.werte = '2024'; }, 'perioden.werte ist 2024, erwartet 2025 (Beobachtungsperiode passt nicht zum Lieferjahr 2025)'],
    ['Indexbasis unlesbar', l => { l.basis.indexstand = 'Basis 2020'; }, 'basis.indexstand fehlt oder hat nicht die Form JJJJ=100']
];
for (const [name, aendern, erwartet] of faelle) {
    const fehler = fehlerFuer(aendern);
    assert(fehler.includes(erwartet), `${name}: ${erwartet} (erhalten: ${fehler.join(' | ')})`);
}
assert(fehlerFuer(() => {}, 2026).includes('lieferung.jahr ist 2025, erwartet 2026'), 'Jahr muss zum Aufruf passen');
const aktien = kette('global-equity-research-chain');
assert(fehlerFuer(l => { delete l.werte.oecdDezember.USA; }, 2025, aktien, lieferungen['global-equity-research-chain'].lieferung)
    .includes('werte.oecdDezember.USA fehlt oder ist nicht endlich'), 'Aktien: jedes Land der Gruppe ist Pflicht');
const geldmarkt = kette('german-cash-money-market-chain');
assertEqual(fehlerFuer(l => { l.werte.monatsmittel = 2.17; l.einheit.monatsmittel = 'prozent'; }, 2025, geldmarkt, lieferungen['german-cash-money-market-chain'].lieferung).length, 0,
    'Geldmarkt: Monatsmittel ist optional erlaubt');

console.log('Test 4: Lesen prüft Beleg und SHA-256; Agent und Hand legen dieselbe Datei an');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-lieferung-'));
try {
    const { schema, rohdaten, ...felder } = gueltig;
    for (const lieferant of ['agent', 'hand']) {
        const { dateien } = lieferungBauen({
            ...felder, lieferant,
            rohdateien: [{ datei: 'rohantwort.html', inhalt: Buffer.from('<td>2,2</td>\r\n', 'utf8'), art: 'antwort' }]
        });
        assertEqual(lieferungFehler(JSON.parse(dateien.get('lieferung.json').toString('utf8')), cpi.KETTE, 2025).length, 0, `${lieferant}: Lieferung ist gültig`);
        lieferungSchreiben(tmp, cpi.KETTE.id, 2025, dateien);
        const gelesen = /** @type {any} */ (lieferungLesen(tmp, cpi.KETTE, 2025));
        assertEqual(gelesen.vorhanden, true, `${lieferant}: Lieferung wird gefunden`);
        assertEqual(gelesen.rohdatenFehler.length, 0, `${lieferant}: Beleg passt zum SHA-256`);
        assertEqual(gelesen.lieferung.lieferant, lieferant, `${lieferant}: Lieferant bleibt erhalten`);
    }
    const ordner = path.join(tmp, 'data/historical/german-cpi-chain/jahre/2025');
    fs.writeFileSync(path.join(ordner, 'rohantwort.html'), '<td>2,3</td>\r\n');
    assertEqual(lieferungLesen(tmp, cpi.KETTE, 2025).rohdatenFehler?.[0], 'Rohdatei rohantwort.html: SHA-256 passt nicht zur Lieferung', 'Geänderter Beleg fällt auf');
    fs.rmSync(path.join(ordner, 'rohantwort.html'));
    assertEqual(lieferungLesen(tmp, cpi.KETTE, 2025).rohdatenFehler?.[0], 'Rohdatei rohantwort.html fehlt', 'Fehlender Beleg fällt auf');
    fs.writeFileSync(path.join(ordner, 'lieferung.json'), '{ kaputt');
    assert(lieferungLesen(tmp, cpi.KETTE, 2025).lesefehler?.startsWith('lieferung.json ist kein gültiges JSON'), 'Ungültiges JSON fällt auf');
    assertEqual(lieferungLesen(tmp, cpi.KETTE, 2024).vorhanden, false, 'Fehlende Lieferung wird erkannt');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('✅ Jahresdaten Lieferung tests passed');
