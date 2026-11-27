// JD-2a Soll 5 und Nachtrag Punkt 2: Rückwärtsprobe 2025, offline, als Methodenprobe je Kette (Profil „schwer“).
// In einer Wegwerfkopie wird 2025 entfernt, das Endjahr auf 2024 gesetzt und 2025 aus Lieferungen übernommen, die aus
// den gespeicherten Originalen entstehen. Die Zeile 2025 jeder Kette, das Datenmodul und der Inhaltshash müssen
// wieder genau gleich sein; Revision und Lieferungen im Datenstand dürfen abweichen.
import { rueckwaertsprobe } from '../scripts/lib/jahresdaten/rueckwaertsprobe.mjs';
import { GRUNDBESTAND } from '../scripts/lib/jahresdaten/grundbestand.mjs';
import { HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { KETTEN } from '../scripts/lib/jahresdaten/ketten.mjs';
import { datenstandLesen, pruefen } from '../scripts/lib/jahresdaten/pruefung.mjs';
import { wegwerfkopieEntfernen } from '../scripts/lib/jahresdaten/wegwerfkopie.mjs';

console.log('--- Jahresdaten: Rückwärtsprobe 2025 ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// JD-2c Punkt 3: mit --behalten bleiben die Kopie nach der Übernahme und die Kopie davor liegen.
const ergebnis = await rueckwaertsprobe({ root, behalten: true });
try {

console.log('Test 1: Prüfung grün, Übernahme ohne Fehler');
assertEqual(ergebnis.pruefen.exit, 0, `--pruefen 2025 ist grün: ${ergebnis.pruefen.ausgabe}`);
assertEqual(ergebnis.uebernehmen.exit, 0, `--uebernehmen 2025 läuft durch: ${ergebnis.uebernehmen.ausgabe}`);
assert(ergebnis.pruefen.ausgabe.includes('Regimeklasse 2025: SIDEWAYS'), 'Bericht nennt die Regimeklasse 2025');

console.log('Test 2: Zeile 2025 je Kette bytegleich, Ketten ohne Fortschreibungsblock bytegleich');
assertEqual(ergebnis.ketten.length, 6, 'Alle sechs Ketten');
for (const kette of ergebnis.ketten) {
    assert(kette.zeileBytegleich, `${kette.kette}: neu berechnete Zeile 2025 bytegleich der gespeicherten`);
    assert(kette.ketteBytegleichOhneBlock, `${kette.kette}: Ketten-Ausgabe ohne Fortschreibungsblock bytegleich`);
    assert(/^[a-f0-9]{64}$/.test(kette.lieferungSha256 ?? ''), `${kette.kette}: Fortschreibungsblock nennt die Lieferung mit SHA-256`);
}

console.log('Test 3: Datenmodul, Inhaltshash, Datenstand und Sollwerte');
assertEqual(ergebnis.vergleich.contentHash, GRUNDBESTAND.contentHash, 'Inhaltshash c79350c5… wie im Grundbestand');
assert(ergebnis.vergleich.datenmodulBytegleich, 'Erzeugtes Datenmodul bytegleich');
assertEqual(ergebnis.vergleich.revision, '2025-1', 'Revision nach dem Schema <Y>-<lfd>');
for (const [seriesId, hashes] of Object.entries(ergebnis.datenstandLieferungen)) {
    assertEqual(JSON.stringify(hashes.lieferungen.map(({ jahr }) => jahr)), '[2025]', `${seriesId}: Datenstand nennt die angehängte Lieferung 2025`);
}
if (HISTORICAL_DATENSTAND.endYear === GRUNDBESTAND.endYear) {
    assert(ergebnis.vergleich.datenstandGleichOhneRevisionUndLieferungen, 'Datenstand gleich bis auf Revision und Lieferungen');
    assert(ergebnis.vergleich.simulatorHtmlBytegleich, 'Simulator.html bytegleich');
    for (const { datei, bytegleich, gleichOhneRevision } of ergebnis.vergleich.sollwerte) {
        assert(datei === 'tests/fixtures/live-sollwerte.json' ? gleichOhneRevision : bytegleich,
            `${datei}: neu erzeugte Sollwerte bytegleich${datei.includes('live') ? ' bis auf Revision und Manifesthash' : ''}`);
    }
}
assertEqual(JSON.stringify(ergebnis.fehler), '[]', 'Keine Abweichung');

console.log('Test 4: --behalten hebt auch die Kopie vor der Übernahme auf (JD-2c)');
assert(ergebnis.kopie && ergebnis.kopieVorher && ergebnis.kopie !== ergebnis.kopieVorher, 'zwei Kopien: nach und vor der Übernahme');
assertEqual((await datenstandLesen(ergebnis.kopieVorher)).endYear, GRUNDBESTAND.endYear - 1, 'Kopie vor der Übernahme endet 2024');
assertEqual((await datenstandLesen(ergebnis.kopie)).endYear, GRUNDBESTAND.endYear, 'Kopie nach der Übernahme endet 2025');
for (const modul of KETTEN) {
    assert(fs.existsSync(path.join(ergebnis.kopieVorher, 'data/historical', modul.KETTE.id, 'jahre/2025/lieferung.json')), `${modul.KETTE.label}: Lieferung 2025 liegt in der Kopie davor`);
}
const vorher = await pruefen(ergebnis.kopieVorher, GRUNDBESTAND.endYear);
assertEqual(vorher.ergebnis, 'gruen', 'In der Kopie davor ist --pruefen 2025 grün');
assert(!fs.existsSync(path.join(ergebnis.kopieVorher, '.jahresdaten-uebernahme')), 'Kopie davor ohne Übernahme-Journal');
} finally {
    for (const kopie of [ergebnis.kopie, ergebnis.kopieVorher]) if (kopie) wegwerfkopieEntfernen(kopie);
}

console.log('✅ Jahresdaten Rückwärtsprobe tests passed');
