// JD-2a, Nachtrag 2, Befund 1: Ein Jahr ganz oder gar nicht, auch bei Schreibfehlern beim Umschalten.
// Die Übernahme erzeugt alles in einem Staging-Ordner, legt ein Journal mit altem und neuem SHA je Ziel an und schaltet
// dann je Datei atomar um. Simuliert werden ein einmaliger Fehler, ein Fehler während der Rücknahme und ein anhaltender
// Fehler ab dem vierten Schreibzugriff. Am Ende steht immer ein vollständiger alter oder neuer Stand.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uebernehmen } from '../scripts/lib/jahresdaten/uebernahme.mjs';
import { atomarSchreiben, atomarSchreibenMit, journalAbschliessen, journalAnlegen, journalLesen, journalOffen, zieleBestaetigen, zieleSchreiben }
    from '../scripts/lib/jahresdaten/journal.mjs';
import os from 'node:os';
import { pruefen } from '../scripts/lib/jahresdaten/pruefung.mjs';
import { wegwerfkopieAnlegen, wegwerfkopieEntfernen } from '../scripts/lib/jahresdaten/wegwerfkopie.mjs';
import { erfundeneLieferungenSchreiben } from './helpers/jahresdaten-gegenprobe.mjs';
import { HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';

console.log('--- Jahresdaten: Übernahme ganz oder gar nicht ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JAHR = HISTORICAL_DATENSTAND.endYear + 1;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const dateiSha = full => (fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null);

/** Prüfsummen aller Dateien unter app/, tests/fixtures/, typcheck/, data/historical/ außer Lieferungen, dazu Simulator.html. */
function bestand(kopie) {
    const ergebnis = {};
    const besuchen = ordner => {
        for (const eintrag of fs.readdirSync(path.join(kopie, ordner), { withFileTypes: true })) {
            const datei = `${ordner}/${eintrag.name}`;
            if (eintrag.isDirectory()) { if (!datei.includes('/jahre')) besuchen(datei); }
            else ergebnis[datei] = sha256(fs.readFileSync(path.join(kopie, datei)));
        }
    };
    ['app', 'tests/fixtures', 'typcheck', 'data/historical'].forEach(besuchen);
    ergebnis['Simulator.html'] = sha256(fs.readFileSync(path.join(kopie, 'Simulator.html')));
    return ergebnis;
}
const unterschiede = (vorher, nachher) => [...new Set([...Object.keys(vorher), ...Object.keys(nachher)])].filter(datei => vorher[datei] !== nachher[datei]).sort();
/** Schreibweg mit simulierten Fehlern bei den Zugriffen, für die `istFehler` wahr ist (gezählt ab dem Umschalten). */
const schreiberMitFehlern = istFehler => {
    let zugriffe = 0;
    return (full, inhalt) => {
        zugriffe += 1;
        if (istFehler(zugriffe)) throw new Error(`simulierter Schreibfehler bei Zugriff ${zugriffe}`);
        atomarSchreiben(full, inhalt);
    };
};
const fehlerVon = async promise => { try { await promise; return null; } catch (error) { return error; } };

const kopie = wegwerfkopieAnlegen(root, 'jahresdaten-uebernahme-');
try {
    erfundeneLieferungenSchreiben(kopie, JAHR);
    const alt = bestand(kopie);

    console.log('Test 1: einmaliger Fehler beim vierten Schreibzugriff – alles zurück, kein Journal');
    const einmalig = await fehlerVon(uebernehmen(kopie, JAHR, { schreibe: schreiberMitFehlern(zugriff => zugriff === 4) }));
    assert(einmalig?.message.includes('sind zurückgesetzt, nichts ist übernommen'), `Abbruch mit vollständiger Rücknahme (${einmalig?.message})`);
    assertEqual(journalOffen(kopie), false, 'Kein offenes Journal');
    assertEqual(JSON.stringify(unterschiede(alt, bestand(kopie))), '[]', 'Alter Stand bytegleich');

    console.log('Test 2: Fehler auch während der Rücknahme – Journal „zurueck“, nächster Aufruf setzt vollständig zurück');
    // Zugriff 4 (Umschalten) scheitert, 5 setzt die Richtung „zurueck“, 6 (erste Rücknahme) scheitert.
    const ruecknahme = await fehlerVon(uebernehmen(kopie, JAHR, { schreibe: schreiberMitFehlern(zugriff => zugriff === 4 || zugriff === 6) }));
    assert(ruecknahme?.message.includes('Offenes Journal'), `Abbruch nennt das offene Journal (${ruecknahme?.message})`);
    assertEqual(journalLesen(kopie).richtung, 'zurueck', 'Journal steht auf Rücknahme');
    assert(unterschiede(alt, bestand(kopie)).length > 0, 'Mischstand liegt vor, aber mit offenem Journal');
    const lauf = spawnSync(process.execPath, ['scripts/jahresdaten.mjs', String(JAHR), '--pruefen'], { cwd: kopie, encoding: 'utf8' });
    assert(lauf.stdout.includes('vollständig zurückgesetzt'), `Nächster Aufruf meldet die vollständige Rücknahme: ${lauf.stdout}${lauf.stderr}`);
    assertEqual(journalOffen(kopie), false, 'Journal abgeschlossen');
    assertEqual(JSON.stringify(unterschiede(alt, bestand(kopie)).filter(datei => !datei.includes('jahresdaten-bericht'))), '[]', 'Alter Stand bytegleich (außer dem neuen Prüfbericht)');
    for (const datei of fs.readdirSync(path.join(kopie, 'data/historical')).filter(name => name.startsWith('jahresdaten-bericht'))) fs.rmSync(path.join(kopie, 'data/historical', datei));

    console.log('Test 3: anhaltender Fehler ab dem vierten Schreibzugriff – Journal „vor“, nächster Aufruf setzt vollständig fort');
    const anhaltend = await fehlerVon(uebernehmen(kopie, JAHR, { schreibe: schreiberMitFehlern(zugriff => zugriff >= 4) }));
    assert(anhaltend?.message.includes('Rücknahme ebenfalls gescheitert') && anhaltend.message.includes('Offenes Journal'), `Abbruch nennt das offene Journal (${anhaltend?.message})`);
    const journal = journalLesen(kopie);
    assertEqual(journal.richtung, 'vor', 'Journal steht auf Fortsetzen (Richtungswechsel ließ sich nicht schreiben)');
    assert(journal.ziele.length >= 10 && journal.ziele.every(ziel => /^[a-f0-9]{64}$/.test(ziel.neuSha256)), 'Journal nennt jedes Ziel mit neuem SHA-256');
    assertEqual(journal.ziele.filter(ziel => dateiSha(path.join(kopie, ziel.datei)) === ziel.neuSha256).length, 3, 'Genau drei Ziele umgeschaltet: Mischstand');
    const offen = await pruefen(kopie, JAHR);
    assert(offen.ergebnis === 'rot' && offen.befunde.rot[0].startsWith('Offenes Übernahme-Journal'), 'Prüfung meldet den offenen Stand rot');
    const weiter = spawnSync(process.execPath, ['scripts/jahresdaten.mjs', String(JAHR), '--uebernehmen'], { cwd: kopie, encoding: 'utf8' });
    assert(weiter.stdout.includes('vollständig fortgesetzt'), `Nächster Aufruf meldet die vollständige Fortsetzung: ${weiter.stdout}${weiter.stderr}`);
    // Nachtrag 3: Die Fortsetzung desselben Jahres ist die abgeschlossene Übernahme (Exit 0, tatsächlich geschriebene Dateien).
    assertEqual(weiter.status, 0, 'Fortgesetzte Übernahme endet mit Exit 0');
    assert(weiter.stdout.includes(`Übernommen: ${JAHR}, Revision ${journal.revision} (abgebrochene Übernahme fortgesetzt). Geschrieben (${journal.ziele.length - 3} Dateien):`),
        'Ausgabe nennt die Übernahme und die Zahl tatsächlich geschriebener Dateien');
    assert(!weiter.stdout.includes('Es wurde nichts geschrieben'), 'Keine widersprüchliche Abbruchmeldung');
    assertEqual(journalOffen(kopie), false, 'Journal abgeschlossen');
    for (const ziel of journal.ziele) {
        assertEqual(dateiSha(path.join(kopie, ziel.datei)), ziel.neuSha256, `${ziel.datei}: neuer Stand laut Journal`);
    }
    const generator = spawnSync(process.execPath, ['scripts/historical-data-generate.mjs', '--verify-only'], { cwd: kopie, encoding: 'utf8' });
    assert(generator.status === 0 && generator.stdout.includes(`historische Daten ${HISTORICAL_DATENSTAND.startYear}–${JAHR}`), 'Vollständiger neuer Stand: Generator bestätigt das neue Endjahr');
} finally {
    wegwerfkopieEntfernen(kopie);
}

// Nachtrag 3: verkürzte Schreibzugriffe. writeSync darf weniger Bytes schreiben, als verlangt, ohne Fehler zu werfen.
/** writeSync, der beim ersten Zugriff nur 12 Bytes schreibt (und 12 meldet); danach normal oder mit Fehler. */
const kurzerZugriff = ({ danachFehler }) => {
    let zugriffe = 0;
    return (fd, buffer, offset, length) => {
        zugriffe += 1;
        if (zugriffe === 1) return fs.writeSync(fd, buffer, offset, Math.min(12, length));
        if (danachFehler) throw new Error(`simulierter Schreibfehler nach kurzem Zugriff (Zugriff ${zugriffe})`);
        return fs.writeSync(fd, buffer, offset, length);
    };
};

console.log('Test 4: kurzer Schreibzugriff (12 Bytes) wird vollständig nachgeschrieben; Nullfortschritt ist ein Fehler');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-kurz-'));
try {
    const ziel = path.join(tmp, 'a.txt');
    fs.writeFileSync(ziel, 'ALTER STAND');
    atomarSchreibenMit({ writeSync: kurzerZugriff({ danachFehler: false }) })(ziel, Buffer.from('NEUER VOLLSTAENDIGER STAND'));
    assertEqual(fs.readFileSync(ziel, 'utf8'), 'NEUER VOLLSTAENDIGER STAND', 'Restbytes nach dem kurzen Zugriff nachgeschrieben');
    let fehler = null;
    try { atomarSchreibenMit({ writeSync: () => 0 })(ziel, Buffer.from('ANDERER STAND')); } catch (error) { fehler = error; }
    assert(fehler?.message.includes('Schreibzugriff ohne Fortschritt'), 'Nullfortschritt bricht ab');
    assertEqual(fs.readFileSync(ziel, 'utf8'), 'NEUER VOLLSTAENDIGER STAND', 'Ziel bleibt beim Abbruch unverändert');
    assertEqual(JSON.stringify(fs.readdirSync(tmp)), JSON.stringify(['a.txt']), 'Keine halbe Nebendatei bleibt liegen');

    console.log('Test 5: Hash-Abweichung vor dem Abbau – Journal bleibt stehen, nächster Aufruf stellt her (Gutachten-Fall)');
    const alt = { a: Buffer.from('ALTER STAND A'), b: Buffer.from('ALTER STAND B') };
    const neu = Buffer.from('NEUER VOLLSTAENDIGER STAND');
    for (const name of ['a', 'b']) fs.writeFileSync(path.join(tmp, name), alt[name]);
    const journal = journalAnlegen(tmp, { jahr: JAHR, revision: `${JAHR}-1`, ziele: ['a', 'b'].map(datei => ({ datei, alt: alt[datei], neu })) });
    // Ein Schreibweg, der unbemerkt verkürzt schreibt (wie ein ignorierter Rückgabewert von writeSync).
    let erster = true;
    zieleSchreiben(tmp, journal, 'vor', (full, inhalt) => { atomarSchreiben(full, erster ? inhalt.subarray(0, 12) : inhalt); erster = false; });
    let abweichung = null;
    try { zieleBestaetigen(tmp, journal, 'vor'); } catch (error) { abweichung = error; }
    assert(abweichung?.message.startsWith('Zielprüfung vor dem Abbau des Journals: 1 Datei(en) weichen vom neuen SHA-256 ab (a)'), `Rote Meldung nennt die abweichende Datei (${abweichung?.message})`);
    assertEqual(journalOffen(tmp), true, 'Journal bleibt stehen');
    const wieder = journalAbschliessen(tmp);
    assertEqual(JSON.stringify(wieder.geschrieben), '["a"]', 'Nächster Aufruf schreibt genau die abweichende Datei');
    assertEqual(`${fs.readFileSync(path.join(tmp, 'a'), 'utf8')}|${fs.readFileSync(path.join(tmp, 'b'), 'utf8')}`, 'NEUER VOLLSTAENDIGER STAND|NEUER VOLLSTAENDIGER STAND', 'Beide Ziele vollständig');
    assertEqual(journalOffen(tmp), false, 'Journal erst nach bestätigten Hashes entfernt');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Test 6: kurzer Schreibzugriff mit anschließendem Schreibfehler in einer Übernahme – Journal offen, nächster Aufruf stellt vollständig her');
const kopie2 = wegwerfkopieAnlegen(root, 'jahresdaten-uebernahme-kurz-');
try {
    erfundeneLieferungenSchreiben(kopie2, JAHR);
    const vorher = bestand(kopie2);
    const kurz = await fehlerVon(uebernehmen(kopie2, JAHR, { schreibe: atomarSchreibenMit({ writeSync: kurzerZugriff({ danachFehler: true }) }) }));
    assert(kurz?.message.includes('Offenes Journal'), `Abbruch nennt das offene Journal (${kurz?.message})`);
    assertEqual(journalOffen(kopie2), true, 'Journal bleibt offen');
    assertEqual(JSON.stringify(unterschiede(vorher, bestand(kopie2))), '[]', 'Kein Ziel halb geschrieben: keine verkürzte Datei, keine Nebendatei');
    const offenesJournal = journalLesen(kopie2);
    const wieder = journalAbschliessen(kopie2);
    assertEqual(wieder.richtung, 'vor', 'Nächster Aufruf setzt vollständig fort');
    for (const ziel of offenesJournal.ziele) assertEqual(dateiSha(path.join(kopie2, ziel.datei)), ziel.neuSha256, `${ziel.datei}: vollständig neuer Stand`);
    assertEqual(journalOffen(kopie2), false, 'Journal abgeschlossen');
} finally {
    wegwerfkopieEntfernen(kopie2);
}

console.log('✅ Jahresdaten Übernahme tests passed');
