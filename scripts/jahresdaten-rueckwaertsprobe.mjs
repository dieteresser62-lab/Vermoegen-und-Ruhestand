#!/usr/bin/env node
/**
 * Rückwärtsprobe 2025, offline: entfernt 2025 in einer Wegwerfkopie, erzeugt die Lieferungen 2025 aus den
 * gespeicherten Originalen und übernimmt sie mit `--pruefen` und `--uebernehmen` (scripts/lib/jahresdaten/rueckwaertsprobe.mjs).
 *   npm run jahresdaten:rueckwaertsprobe [-- --behalten]   mit --behalten bleiben die Kopie nach der Übernahme und die
 *                                                          Kopie davor (Endjahr 2024, Lieferungen 2025 angelegt) liegen
 * Exit 0, wenn Zeilen, Ketten ohne Fortschreibungsblock, Datenmodul, Inhaltshash und Sollwerte stimmen.
 *
 *   npm run jahresdaten:rueckwaertsprobe -- --live   holt 2025 mit --holen aus den heutigen Quellen (Netz) und vergleicht
 *                                                    mit den Originalen; Bericht data/historical/rueckwaertsprobe-live-2025.md
 * Exit 0, wenn alles genau gleich ist; 1 bei jeder Abweichung (auch Rundungsrauschen) oder offenen Lieferung; 2 Abbruch.
 * Kein Test im normalen Lauf, weil er Netz braucht.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rueckwaertsprobe } from './lib/jahresdaten/rueckwaertsprobe.mjs';
import { liveBerichtMarkdown, rueckwaertsprobeLive } from './lib/jahresdaten/rueckwaertsprobe-live.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ja = value => (value === null ? 'nicht geprüft' : value ? 'ja' : 'NEIN');

async function live() {
    const ergebnis = await rueckwaertsprobeLive({ root: ROOT, behalten: process.argv.includes('--behalten') });
    const datei = `data/historical/rueckwaertsprobe-live-${ergebnis.jahr}.md`;
    fs.writeFileSync(path.join(ROOT, datei), liveBerichtMarkdown(ergebnis, new Date().toISOString().slice(0, 10)));
    console.log(ergebnis.holen?.ausgabe ?? '');
    for (const item of ergebnis.vergleiche) {
        const text = !item.geholt ? 'offen' : item.abweichungen.length
            ? item.abweichungen.map(feld => `${feld.teil} ${feld.feld}: heute ${feld.live}, Original ${feld.offline} (${feld.einordnung})`).join('; ')
            : `${item.felder.filter(feld => feld.einordnung === 'gleich').length} Felder gleich${item.felder.some(feld => feld.einordnung === 'nur heutige Quelle') ? ', Gegenprüfung nur in der heutigen Lieferung' : ''}`;
        console.log(`  ${item.label}: ${text}`);
    }
    console.log(`  --pruefen: Exit ${ergebnis.pruefen.exit}; --uebernehmen: Exit ${ergebnis.uebernehmen.exit}; Inhaltshash ${ergebnis.vergleich.contentHash}`);
    if (ergebnis.kopieVorher) console.log(`  Kopie vor der Übernahme (Endjahr ${ergebnis.jahr - 1}): ${ergebnis.kopieVorher}`);
    if (ergebnis.kopie) console.log(`  Kopie nach der Übernahme: ${ergebnis.kopie}`);
    console.log(`Bericht: ${datei}`);
    return ergebnis.ok && ergebnis.vergleiche.every(item => item.geholt && !item.abweichungen.length) ? 0 : 1;
}

if (process.argv.includes('--live')) {
    live().then(code => { process.exitCode = code; }, error => {
        console.error(`Abbruch: ${error?.stack ?? error}`);
        process.exitCode = 2;
    });
} else rueckwaertsprobe({ root: ROOT, behalten: process.argv.includes('--behalten') }).then(ergebnis => {
    console.log(`Rückwärtsprobe ${ergebnis.jahr}: ${ergebnis.ok ? 'bestanden' : 'NICHT bestanden'}`);
    console.log(`  --pruefen: Exit ${ergebnis.pruefen.exit}; --uebernehmen: Exit ${ergebnis.uebernehmen.exit}`);
    for (const kette of ergebnis.ketten) {
        console.log(`  ${kette.kette}: Zeile bytegleich ${ja(kette.zeileBytegleich)}, Kette ohne Fortschreibungsblock bytegleich ${ja(kette.ketteBytegleichOhneBlock)}, Lieferung ${kette.lieferungSha256}`);
    }
    const { vergleich } = ergebnis;
    console.log(`  Inhaltshash ${vergleich.contentHash} (Grundbestand ${ja(vergleich.contentHashGleich)}), Datenmodul bytegleich ${ja(vergleich.datenmodulBytegleich)}`);
    console.log(`  Datenstand gleich bis auf Revision (${vergleich.revision}) und Lieferungen: ${ja(vergleich.datenstandGleichOhneRevisionUndLieferungen)}; Simulator.html bytegleich ${ja(vergleich.simulatorHtmlBytegleich)}`);
    for (const { datei, bytegleich, gleichOhneRevision } of vergleich.sollwerte) {
        console.log(`  Sollwerte ${datei}: bytegleich ${ja(bytegleich)}${bytegleich ? '' : `, gleich bis auf Revision und Manifesthash ${ja(gleichOhneRevision)}`}`);
    }
    for (const text of ergebnis.fehler) console.log(`  Fehler: ${text}`);
    if (ergebnis.kopieVorher) console.log(`  Kopie vor der Übernahme (Endjahr ${ergebnis.jahr - 1}): ${ergebnis.kopieVorher}`);
    if (ergebnis.kopie) console.log(`  Kopie nach der Übernahme: ${ergebnis.kopie}`);
    if (!ergebnis.ok) {
        console.log(ergebnis.pruefen.ausgabe);
        console.log(ergebnis.uebernehmen.ausgabe);
    }
    process.exitCode = ergebnis.ok ? 0 : 1;
}, error => {
    console.error(`Abbruch: ${error?.stack ?? error}`);
    process.exitCode = 2;
});
