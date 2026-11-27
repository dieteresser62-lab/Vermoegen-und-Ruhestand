#!/usr/bin/env node
/**
 * Jahresdaten: Abruf, Prüfung und Übernahme eines Datenjahrs aus den Jahreslieferungen.
 *
 *   npm run jahresdaten -- --quellen [<Jahr>]      Testmodus: Quellen erreichbar und lesbar? Mit Jahr: ist Y da, mit welchem
 *                                                 Status? Schreibt nichts; Exit 0 alles lesbar, 1 nicht lesbar, 2 nicht erreichbar
 *   npm run jahresdaten -- <Jahr> --holen         je Kette die Quelle abrufen und die Lieferung anlegen; scheitert ein
 *                                                 Abruf, entsteht eine offene Lieferung mit ANLEITUNG.md. Vorläufige
 *                                                 Skriptlieferungen holt jeder Lauf neu; endgültige nur mit
 *                                                 --ersetzen <kette> [<kette> …], von Agent/Hand zusätzlich mit --auch-hand
 *   npm run jahresdaten -- <Jahr> --pruefen       Bericht data/historical/jahresdaten-bericht-<Jahr>.md/.json, sonst nichts
 *   npm run jahresdaten -- <Jahr> --uebernehmen   nur bei grüner oder gelber Prüfung: Jahr an alle sechs Ketten anhängen
 *   npm run jahresdaten -- --schema               JSON-Schema der Datei lieferung.json ausgeben
 *
 * Lieferungen liegen unter data/historical/<kette>/jahre/<Jahr>/ (Format: scripts/lib/jahresdaten/lieferung.mjs).
 * Die Übernahme erzeugt alles erst in einem Staging-Ordner und schaltet dann über ein Journal um; ein offenes Journal
 * (.jahresdaten-uebernahme/) schließt jeder Aufruf zuerst ab (scripts/lib/jahresdaten/journal.mjs).
 *   --beleg-bestaetigt <kette> …                  (mit --pruefen/--uebernehmen) Wert einer Kette von Hand bestätigt, wenn ihr
 *                                                 Beleg zu keinem Leser passt; der Bericht weist das aus
 * Exit-Codes: 0 grün bzw. übernommen bzw. alles geholt, 1 gelb (--pruefen) bzw. offen oder vorläufig (--holen),
 * 2 rot (nichts geschrieben), 3 Abbruch.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIEFERUNG_SCHEMA } from './lib/jahresdaten/lieferung.mjs';
import { KETTEN } from './lib/jahresdaten/ketten.mjs';
import { berichtSchreiben, pruefen } from './lib/jahresdaten/pruefung.mjs';
import { NAECHSTER_SCHRITT, uebernehmen } from './lib/jahresdaten/uebernahme.mjs';
import { journalAbschliessen } from './lib/jahresdaten/journal.mjs';
import { holen, ketteAusName } from './lib/jahresdaten/holen.mjs';
import { quellenPruefen, quellenText } from './lib/jahresdaten/quellen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AMPEL = { gruen: 'GRÜN', gelb: 'GELB', rot: 'ROT' };
const EXIT = { gruen: 0, gelb: 1, rot: 2, abbruch: 3 };

function nutzung() {
    return 'Aufruf: npm run jahresdaten -- --quellen [<Jahr>] | <Jahr> --holen [--ersetzen <kette> …] [--auch-hand]\n'
        + '  | <Jahr> --pruefen | --uebernehmen [--beleg-bestaetigt <kette> …] | --schema\n'
        + '  Ketten: aktien, inflation, geldmarkt, lohn, gold, cape';
}

function ausgeben(bericht) {
    console.log(`Jahresdaten ${bericht.jahr}: ${AMPEL[bericht.ergebnis]}`);
    if (bericht.belegBestaetigt?.length) console.log(`  Beleg von Hand bestätigt: ${bericht.belegBestaetigt.join(', ')}`);
    for (const text of bericht.befunde.rot) console.log(`  rot:  ${text}`);
    for (const text of bericht.befunde.gelb) console.log(`  gelb: ${text}`);
    if (bericht.regime) console.log(`  Regimeklasse ${bericht.jahr}: ${bericht.regime.klasse}`);
}

/** Ketten nach --ersetzen bis zum nächsten Schalter; null bei unbekanntem Namen. @param {string[]} args */
function ersetzenAus(args, schalter = '--ersetzen') {
    const start = args.indexOf(schalter);
    if (start < 0) return [];
    const namen = [];
    for (const arg of args.slice(start + 1)) {
        if (arg.startsWith('--')) break;
        namen.push(arg);
    }
    const ids = namen.map(ketteAusName);
    return namen.length && ids.every(Boolean) ? ids : null;
}

async function holenAusgeben(jahr, ersetzen, auchHand) {
    console.log(`Jahresdaten ${jahr}: Abruf der sechs Quellen`);
    const ergebnisse = await holen({ root: ROOT, jahr, ersetzen, auchHand });
    for (const item of ergebnisse) {
        const text = item.ergebnis === 'geliefert' ? `geliefert, Status ${item.status}`
            : item.ergebnis === 'offen' ? `OFFEN: ${item.grund}; Anleitung ${item.ordner}/ANLEITUNG.md`
                : `lieferung.json vorhanden${item.status ? `, Status ${item.status}` : ''}, nicht ersetzt`;
        console.log(`  ${item.label}: ${text}`);
        for (const hinweis of item.hinweise) console.log(`    ${hinweis}`);
    }
    const offen = ergebnisse.filter(item => item.ergebnis === 'offen' || item.status === 'vorlaeufig');
    console.log(offen.length
        ? `Teilweise offen: ${offen.length} Kette(n) offen oder vorläufig. Offene Lieferungen füllt ein Agent oder der Nutzer nach der Anleitung; danach --pruefen.`
        : `Nächster Schritt: npm run jahresdaten -- ${jahr} --pruefen`);
    return offen.length ? EXIT.gelb : EXIT.gruen;
}

async function main(args) {
    if (args.includes('--schema')) {
        console.log(JSON.stringify({ ...LIEFERUNG_SCHEMA, werteJeKette: Object.fromEntries(KETTEN.map(modul => [modul.KETTE.id, {
            werte: modul.KETTE.werte, beschreibung: modul.KETTE.beschreibung, anschluss: modul.KETTE.anschluss
        }])) }, null, 2));
        return EXIT.gruen;
    }
    if (args.includes('--quellen')) {
        const jahresangabe = args.filter(arg => arg !== '--quellen');
        if (jahresangabe.length > 1 || (jahresangabe.length && !/^\d{4}$/.test(jahresangabe[0]))) {
            console.error(nutzung());
            return EXIT.abbruch;
        }
        const ergebnis = await quellenPruefen({ root: ROOT, jahr: jahresangabe.length ? Number(jahresangabe[0]) : undefined });
        for (const zeile of quellenText(ergebnis)) console.log(zeile);
        return ergebnis.exit;
    }
    const jahr = Number(args.find(arg => /^\d{4}$/.test(arg)));
    const ersetzen = ersetzenAus(args);
    const belegBestaetigt = ersetzenAus(args, '--beleg-bestaetigt');
    const modus = ['--holen', '--pruefen', '--uebernehmen'].filter(flag => args.includes(flag));
    const nurHolen = ['--ersetzen', '--auch-hand'].some(flag => args.includes(flag)) && modus[0] !== '--holen';
    const nichtHolen = args.includes('--beleg-bestaetigt') && modus[0] === '--holen';
    if (!Number.isInteger(jahr) || modus.length !== 1 || nurHolen || nichtHolen || ersetzen === null || belegBestaetigt === null
        || (args.includes('--auch-hand') && !ersetzen.length)) {
        console.error(nutzung());
        return EXIT.abbruch;
    }
    if (modus[0] === '--holen') return holenAusgeben(jahr, ersetzen, args.includes('--auch-hand'));
    // Ein offenes Umschaltjournal einer abgebrochenen Übernahme wird vor allem anderen vollständig abgeschlossen
    // (bei --uebernehmen innerhalb der Übernahme, die eine Fortsetzung desselben Jahres als abgeschlossen meldet).
    if (modus[0] === '--pruefen') {
        const wiederanlauf = journalAbschliessen(ROOT);
        if (wiederanlauf) console.log(wiederanlauf.meldung);
        const bericht = await pruefen(ROOT, jahr, { belegBestaetigt });
        const dateien = berichtSchreiben(ROOT, bericht);
        ausgeben(bericht);
        console.log(`Bericht: ${dateien.join(', ')}`);
        return EXIT[bericht.ergebnis];
    }
    const ergebnis = await uebernehmen(ROOT, jahr, { belegBestaetigt });
    if (ergebnis.wiederanlauf) console.log(ergebnis.wiederanlauf.meldung);
    if (ergebnis.fortgesetzt) {
        console.log(`Übernommen: ${jahr}, Revision ${ergebnis.revision} (abgebrochene Übernahme fortgesetzt). Geschrieben (${ergebnis.geschrieben.length} Dateien):`);
        for (const datei of ergebnis.geschrieben) console.log(`  ${datei}`);
        console.log(`Nächster Schritt: ${NAECHSTER_SCHRITT}`);
        return EXIT.gruen;
    }
    ausgeben(ergebnis.bericht);
    if (!ergebnis.uebernommen) {
        console.log('Übernahme abgebrochen: Die Prüfung ist rot. Es wurde nichts geschrieben.');
        return EXIT.rot;
    }
    console.log(`Übernommen: ${jahr}, Revision ${ergebnis.revision}. Geschrieben (${ergebnis.geschrieben.length} Dateien):`);
    for (const datei of ergebnis.geschrieben) console.log(`  ${datei}`);
    console.log(`Nächster Schritt: ${NAECHSTER_SCHRITT}`);
    return EXIT.gruen;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`Abbruch: ${error?.message ?? error}`);
    process.exitCode = EXIT.abbruch;
});
