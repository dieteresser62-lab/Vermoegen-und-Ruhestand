// JD-2a Soll 2, 3 und 6, Nachtrag 6 und 7: `npm run jahresdaten -- <Y> --pruefen` und der Abbruch von `--uebernehmen`
// in einer Wegwerfkopie. Ampel: rot sperrt (fehlt, vorläufig, Wert, Beleg, Anschluss), gelb meldet (Plausibilität,
// alte Jahre), grün sonst. Die Prüfung schreibt nur den Bericht; eine rote Übernahme schreibt nichts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruefen } from '../scripts/lib/jahresdaten/pruefung.mjs';
import { kette } from '../scripts/lib/jahresdaten/ketten.mjs';
import { naechsteRevision } from '../scripts/lib/jahresdaten/uebernahme.mjs';
import { wegwerfkopieAnlegen, wegwerfkopieEntfernen } from '../scripts/lib/jahresdaten/wegwerfkopie.mjs';
import { erfundeneBelege, erfundeneLieferungenSchreiben } from './helpers/jahresdaten-gegenprobe.mjs';
import { lieferungBauen } from '../scripts/lib/jahresdaten/lieferung.mjs';
import { HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';

console.log('--- Jahresdaten: Prüfung und Ampel ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JAHR = HISTORICAL_DATENSTAND.endYear + 1;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Prüfsummen aller Dateien unter app/, data/historical/, tests/fixtures/ und Simulator.html der Kopie. */
function bestand(kopie) {
    const ergebnis = {};
    const besuchen = ordner => {
        for (const eintrag of fs.readdirSync(path.join(kopie, ordner), { withFileTypes: true })) {
            const datei = `${ordner}/${eintrag.name}`;
            if (eintrag.isDirectory()) besuchen(datei);
            else ergebnis[datei] = sha256(fs.readFileSync(path.join(kopie, datei)));
        }
    };
    ['app', 'data/historical', 'tests/fixtures'].forEach(besuchen);
    ergebnis['Simulator.html'] = sha256(fs.readFileSync(path.join(kopie, 'Simulator.html')));
    return ergebnis;
}
const unterschiede = (vorher, nachher) => [...new Set([...Object.keys(vorher), ...Object.keys(nachher)])].filter(datei => vorher[datei] !== nachher[datei]).sort();
const cli = (kopie, args) => spawnSync(process.execPath, ['scripts/jahresdaten.mjs', ...args], { cwd: kopie, encoding: 'utf8' });

const kopie = wegwerfkopieAnlegen(root, 'jahresdaten-pruefen-');
try {
    erfundeneLieferungenSchreiben(kopie, JAHR);
    const lieferungDatei = id => path.join(kopie, 'data/historical', id, 'jahre', String(JAHR), 'lieferung.json');
    const ids = ['german-cpi-chain', 'gold-german-investor-chain', 'us-shiller-cape-chain', 'german-gross-wage-growth-chain', 'german-cash-money-market-chain'];
    const original = Object.fromEntries(ids.map(id => [id, fs.readFileSync(lieferungDatei(id), 'utf8')]));
    const ordnerVon = id => path.dirname(lieferungDatei(id));
    const originalOrdner = Object.fromEntries(ids.map(id => [id, new Map(fs.readdirSync(ordnerVon(id)).map(name => [name, fs.readFileSync(path.join(ordnerVon(id), name))]))]));
    // Eine geänderte Lieferung bekommt einen passenden Beleg mit den geänderten Werten (JD-2c, Werte gegen Beleg);
    // so prüft jeder Fall weiter genau seine Regel. Werte gegen Beleg selbst prüft Test 3c.
    const aendern = (id, aenderung, { belegMitziehen = true } = {}) => {
        const lieferung = JSON.parse(original[id]);
        aenderung(lieferung);
        if (belegMitziehen && Object.values(lieferung.werte ?? {}).every(wert => wert !== null)) {
            for (const name of fs.readdirSync(ordnerVon(id))) if (name !== 'lieferung.json') fs.rmSync(path.join(ordnerVon(id), name));
            const { lieferung: neu, dateien } = lieferungBauen({ ...Object.fromEntries(Object.entries(lieferung).filter(([key]) => !['schema', 'rohdaten'].includes(key))),
                rohdateien: erfundeneBelege(id, lieferung.jahr, lieferung.werte, lieferung.anschluss.werte, lieferung.basis) });
            for (const [name, inhalt] of dateien) if (name !== 'lieferung.json') fs.writeFileSync(path.join(ordnerVon(id), name), inhalt);
            lieferung.rohdaten = neu.rohdaten;
        }
        fs.writeFileSync(lieferungDatei(id), `${JSON.stringify(lieferung, null, 2)}\n`);
    };
    const zuruecksetzen = () => {
        for (const id of ids) {
            for (const name of fs.readdirSync(ordnerVon(id))) fs.rmSync(path.join(ordnerVon(id), name));
            for (const [name, inhalt] of originalOrdner[id]) fs.writeFileSync(path.join(ordnerVon(id), name), inhalt);
        }
    };

    console.log('Test 1: vollständige Lieferung ist grün; Regimeklasse und Anschluss stehen im Bericht');
    const gruen = await pruefen(kopie, JAHR);
    assertEqual(gruen.ergebnis, 'gruen', `Erfundenes ${JAHR} ist grün: ${[...gruen.befunde.rot, ...gruen.befunde.gelb].join(' | ')}`);
    assertEqual(gruen.ketten.length, 6, 'Alle sechs Ketten geprüft');
    assert(gruen.ketten.every(kette => kette.geliefert && kette.status === 'endgueltig' && kette.lieferant === 'hand'), 'Alle geliefert, endgültig, von Hand');
    assert(gruen.ketten.every(kette => kette.anschluss.vergleiche.length > 0 && kette.anschluss.vergleiche.every(item => item.ok)), 'Anschluss je Kette geprüft und passend');
    assertEqual(gruen.regime?.klasse, 'SIDEWAYS', 'Regimeklasse des neuen Jahres (Aktien etwa +7 %, Inflation 2,1 %)');

    console.log('Test 2: CLI --pruefen schreibt nur den Bericht, Exit 0');
    const vorher = bestand(kopie);
    const lauf = cli(kopie, [String(JAHR), '--pruefen']);
    assertEqual(lauf.status, 0, `Exit 0 bei grün: ${lauf.stderr}`);
    assertEqual(JSON.stringify(unterschiede(vorher, bestand(kopie))),
        JSON.stringify([`data/historical/jahresdaten-bericht-${JAHR}.json`, `data/historical/jahresdaten-bericht-${JAHR}.md`]), 'Nur Bericht als Markdown und JSON');
    const md = fs.readFileSync(path.join(kopie, `data/historical/jahresdaten-bericht-${JAHR}.md`), 'utf8');
    assert(md.includes('Ergebnis: **GRÜN**') && md.includes(`Regimeklasse ${JAHR}: SIDEWAYS`), 'Markdown nennt Ergebnis und Regimeklasse');
    const json = JSON.parse(fs.readFileSync(path.join(kopie, `data/historical/jahresdaten-bericht-${JAHR}.json`), 'utf8'));
    assertEqual(json.ergebnis, 'gruen', 'JSON trägt dasselbe Ergebnis');

    console.log('Test 3: rote Fälle sperren');
    const rot = async (beschreibung, vorbereiten, erwartet) => {
        zuruecksetzen();
        vorbereiten();
        const bericht = await pruefen(kopie, JAHR);
        assertEqual(bericht.ergebnis, 'rot', `${beschreibung}: rot`);
        assert(bericht.befunde.rot.some(text => text.includes(erwartet)), `${beschreibung}: Befund „${erwartet}“ (${bericht.befunde.rot.join(' | ')})`);
    };
    await rot('Status vorläufig', () => aendern('german-cpi-chain', l => { l.status = 'vorlaeufig'; }), 'Inflation: Status vorläufig');
    await rot('Anschlusswert', () => aendern('german-cpi-chain', l => { l.anschluss.werte.jahresrate = 2.3; }), `Inflation: Anschlusswert ${JAHR - 1} jahresrate`);
    await rot('Anschluss CAPE über 0,05', () => aendern('us-shiller-cape-chain', l => { l.anschluss.werte.cape += 0.06; }), 'CAPE: Anschlusswert');
    // Nachtrag 2, Befund 3: Einheit maschinenprüfbar; ein Dezimalbruch statt Prozent wird nicht umgerechnet, sondern ist rot.
    await rot('Geldmarkt als Dezimalbruch', () => aendern('german-cash-money-market-chain', l => { l.werte.jahresmittel = 0.02; l.einheit.jahresmittel = 'dezimal'; }),
        'Geldmarkt: einheit.jahresmittel ist dezimal, erwartet prozent; Lieferungen werden nicht umgerechnet');
    await rot('Wert nicht endlich', () => aendern('german-gross-wage-growth-chain', l => { l.werte.veraenderung = null; }), 'Lohn: werte.veraenderung fehlt oder ist nicht endlich');
    const goldBeleg = path.join(path.dirname(lieferungDatei('gold-german-investor-chain')), 'rohauszug-weltbank-gold.csv');
    const goldBelegText = fs.readFileSync(goldBeleg);
    await rot('Beleg geändert', () => fs.appendFileSync(goldBeleg, 'x'), 'Gold: Rohdatei rohauszug-weltbank-gold.csv: SHA-256 passt nicht');
    fs.writeFileSync(goldBeleg, goldBelegText);

    console.log('Test 3b: amtlicher Vorjahresindex, Indexbasis und Beobachtungsperiode (Nachtrag 2, Befund 4)');
    if (JAHR === 2026) {
        // Die echte Lieferung 2025 aus den Originalen, nur auf 2026/2025 umetikettiert: Rohdatei und SHA stimmen, das Jahr nicht.
        const { lieferung: echt, dateien } = kette('german-cpi-chain').lieferungAusOriginalen(kopie, 2025);
        const ordner = path.dirname(lieferungDatei('german-cpi-chain'));
        // Die Belegdateien werden nach dem Zurücksetzen jedes Falls geschrieben; zuruecksetzen stellt den ganzen Ordner her.
        const belegeSchreiben = () => { for (const [name, inhalt] of dateien) if (name !== 'lieferung.json') fs.writeFileSync(path.join(ordner, name), inhalt); };
        const umetikettiert = { ...echt, jahr: 2026, anschluss: { ...echt.anschluss, jahr: 2025 } };
        await rot('Umetikettierte CPI-Lieferung 2025 → 2026', () => { belegeSchreiben(); fs.writeFileSync(lieferungDatei('german-cpi-chain'), JSON.stringify(umetikettiert)); },
            'Inflation: perioden.werte ist 2025, erwartet 2026');
        await rot('Umetikettiert samt Perioden', () => {
            belegeSchreiben();
            fs.writeFileSync(lieferungDatei('german-cpi-chain'), JSON.stringify({ ...umetikettiert, perioden: { werte: '2026', anschluss: '2025' } }));
        }, 'Inflation: Anschlusswert 2025 indexstand: geliefert 119.3, gespeichert 121.9');
    }
    await rot('CPI-Anschlussindex nicht amtlich', () => aendern('german-cpi-chain', l => {
        l.anschluss.werte.indexstand = 100; l.werte.indexstand = 102.1; l.werte.jahresrate = 2.1;
    }), `Inflation: Anschlusswert ${JAHR - 1} indexstand: geliefert 100`);
    await rot('CPI-Umbasierung', () => aendern('german-cpi-chain', l => {
        l.basis = { indexstand: `${JAHR - 1}=100` }; l.anschluss.werte.indexstand = 100; l.werte.indexstand = 102.1; l.werte.jahresrate = 2.1;
    }), 'Inflation: Umbasierung – eigener Vorgang: indexstand mit Basis');
    await rot('Lohn-Anschlussindex', () => aendern('german-gross-wage-growth-chain', l => { l.anschluss.werte.indexstand += 1; }),
        `Lohn: Anschlusswert ${JAHR - 1} indexstand`);
    await rot('Lohn ohne Indexbasis', () => aendern('german-gross-wage-growth-chain', l => { delete l.basis; }),
        'Lohn: basis.indexstand fehlt oder hat nicht die Form JJJJ=100');
    zuruecksetzen();
    const falschesJahr = await pruefen(kopie, JAHR + 1);
    assert(falschesJahr.ergebnis === 'rot' && falschesJahr.befunde.rot[0].includes(`schließt nicht an das Endjahr ${JAHR - 1}`), 'Jahr ohne Anschluss an das Endjahr ist rot');

    console.log('Test 3c: Werte gegen Beleg (JD-2c)');
    await rot('CAPE gegen Auszug', () => aendern('us-shiller-cape-chain', l => { l.werte.cape = 61; }, { belegMitziehen: false }),
        'CAPE: Wert widerspricht dem Beleg: Wert cape geliefert 61, Beleg 36.2 (Toleranz 0.05)');
    await rot('Inflation gegen Beleg', () => aendern('german-cpi-chain', l => { l.werte.jahresrate = 2.6; }, { belegMitziehen: false }),
        'Inflation: Wert widerspricht dem Beleg: Wert jahresrate geliefert 2.6, Beleg 2.1 (Toleranz 0.05)');
    await rot('Anschluss gegen Beleg', () => aendern('gold-german-investor-chain', l => { l.anschluss.werte.usdJeEur += 0.001; }, { belegMitziehen: false }),
        'Gold: Wert widerspricht dem Beleg: Anschluss usdJeEur');
    const pruefeRohdatei = (id, name, aenderung, neuerName = name) => {
        zuruecksetzen();
        const lieferung = JSON.parse(original[id]);
        const inhalt = aenderung(originalOrdner[id].get(name).toString('utf8'), lieferung);
        const { dateien } = lieferungBauen({ ...lieferung, rohdateien: [{ datei: neuerName, inhalt: Buffer.from(inhalt), art: 'auszug' }] });
        for (const [datei, bytes] of dateien) fs.writeFileSync(path.join(ordnerVon(id), datei), bytes);
        const lauf = cli(kopie, [String(JAHR), '--pruefen', '--beleg-bestaetigt', 'inflation', 'lohn', 'geldmarkt', 'cape']);
        const bericht = JSON.parse(fs.readFileSync(path.join(kopie, `data/historical/jahresdaten-bericht-${JAHR}.json`), 'utf8'));
        return { status: lauf.status, rot: bericht.befunde.rot };
    };
    const roheBefunde = [
        [pruefeRohdatei('german-cpi-chain', 'rohauszug-destatis-vpi.html', text => text.replace('</caption>', ' vorläufig</caption>')),
            'Inflation: Rohbeleg ist vorläufig'],
        [pruefeRohdatei('german-cash-money-market-chain', 'rohauszug-bundesbank-tagesgeld.txt', (_, l) =>
            `TIME_PERIOD,OBS_VALUE,OBS_STATUS\n${JAHR - 1}-12-30,${l.anschluss.werte.jahresmittel},A\n${JAHR}-12-30,${l.werte.jahresmittel},A\n`, 'antwort-ezb-estr.csv'),
            'Geldmarkt: Rohbeleg ist vorläufig'],
        [pruefeRohdatei('german-gross-wage-growth-chain', 'rohauszug-destatis-verdienste.html', text => `<caption>1900 = 100</caption>${text}`, 'antwort-destatis-verdienste.html'),
            'Lohn: Basis widerspricht dem Beleg'],
        [pruefeRohdatei('us-shiller-cape-chain', 'rohauszug-shiller-cape.csv', text => `${text}${text.trimEnd().split('\n').at(-1)}\n`),
            `CAPE: Dezember ${JAHR - 1} steht mehrfach im Beleg`]
    ];
    assertEqual(JSON.stringify(roheBefunde.map(([lauf]) => lauf.status)), '[2,2,2,2]', 'Rohbefunde sperren --pruefen auch bei endgültiger Lieferung und Handbestätigung');
    for (const [lauf, meldung] of roheBefunde) assert(lauf.rot.some(text => text.includes(meldung)), `Prüfbericht nennt den Rohbefund „${meldung}“`);
    zuruecksetzen();
    erfundeneLieferungenSchreiben(kopie, JAHR, { beleg: 'text' });
    const ohneLeser = await pruefen(kopie, JAHR);
    assertEqual(ohneLeser.ergebnis, 'rot', 'Beleg ohne passenden Leser: rot');
    assert(ohneLeser.befunde.rot.includes('Lohn: Beleg passt nicht zum Leser – Wert von Hand bestätigen (--beleg-bestaetigt lohn): kein Destatis-Beleg im Format der Leser'),
        `Befund nennt den Schalter (${ohneLeser.befunde.rot.join(' | ')})`);
    const alleKurz = ['aktien', 'inflation', 'geldmarkt', 'lohn', 'gold', 'cape'];
    const teilweise = cli(kopie, [String(JAHR), '--pruefen', '--beleg-bestaetigt', 'lohn', 'gold']);
    assertEqual(teilweise.status, 2, 'nur zwei Ketten bestätigt: weiter rot');
    const bestaetigt = cli(kopie, [String(JAHR), '--pruefen', '--beleg-bestaetigt', ...alleKurz]);
    assertEqual(bestaetigt.status, 0, `alle von Hand bestätigt: grün (${bestaetigt.stdout})`);
    assert(bestaetigt.stdout.includes('Beleg von Hand bestätigt: Aktien, Inflation, Geldmarkt, Lohn, Gold, CAPE'), 'Ausgabe nennt die bestätigten Ketten');
    const berichtMd = fs.readFileSync(path.join(kopie, `data/historical/jahresdaten-bericht-${JAHR}.md`), 'utf8');
    assert(berichtMd.includes('Beleg von Hand bestätigt (--beleg-bestaetigt): Aktien, Inflation, Geldmarkt, Lohn, Gold, CAPE.') && berichtMd.includes('| von Hand bestätigt |'), 'Bericht weist die Bestätigung aus');
    assertEqual(cli(kopie, [String(JAHR), '--pruefen', '--beleg-bestaetigt', 'bitcoin']).status, 3, 'unbekannte Kette bricht ab');
    assertEqual(cli(kopie, [String(JAHR), '--holen', '--beleg-bestaetigt', 'lohn']).status, 3, '--beleg-bestaetigt nur mit --pruefen oder --uebernehmen');
    erfundeneLieferungenSchreiben(kopie, JAHR);

    console.log('Test 4: gelbe Fälle melden, sperren nicht');
    aendern('gold-german-investor-chain', l => { l.werte.goldUsdJeUnze = Number((l.anschluss.werte.goldUsdJeUnze * 1.7).toFixed(2)); });
    let bericht = await pruefen(kopie, JAHR);
    assertEqual(bericht.ergebnis, 'gelb', 'Gold +70 % ist gelb');
    assert(bericht.befunde.gelb.some(text => text.startsWith('Gold: Plausibilität „Rendite −40 bis +60 %“')), 'Befund nennt die Grenze');
    const gelbLauf = cli(kopie, [String(JAHR), '--pruefen']);
    assertEqual(gelbLauf.status, 1, 'Exit 1 bei gelb');
    zuruecksetzen();
    aendern('german-cpi-chain', l => { l.alteJahre = { [JAHR - 3]: { jahresrate: 9.9 }, [JAHR - 2]: { jahresrate: 2.2 } }; });
    bericht = await pruefen(kopie, JAHR);
    assertEqual(bericht.ergebnis, 'gelb', 'Gemeldete Änderung eines alten Jahres ist gelb');
    assertEqual(bericht.befunde.gelb.length, 1, 'Nur das geänderte alte Jahr wird gemeldet');
    assert(bericht.befunde.gelb[0].includes(`für ${JAHR - 3} jahresrate = 9.9`), 'Befund nennt Jahr und Wert');
    zuruecksetzen();
    aendern('german-cpi-chain', l => { l.lieferant = 'agent'; });
    assertEqual((await pruefen(kopie, JAHR)).ergebnis, 'gruen', 'Lieferant agent wird gleich behandelt');

    console.log('Test 5: eine Kette fehlt – rot; --uebernehmen bricht ab und schreibt nichts');
    zuruecksetzen();
    fs.rmSync(path.dirname(lieferungDatei('german-cash-money-market-chain')), { recursive: true });
    bericht = await pruefen(kopie, JAHR);
    assert(bericht.ergebnis === 'rot' && bericht.befunde.rot.includes('Geldmarkt: Lieferung fehlt'), 'Fehlende Kette ist rot');
    const vorUebernahme = bestand(kopie);
    const abbruch = cli(kopie, [String(JAHR), '--uebernehmen']);
    assertEqual(abbruch.status, 2, 'Exit 2 bei roter Prüfung');
    assert(abbruch.stdout.includes('Es wurde nichts geschrieben.'), 'Ausgabe nennt den Abbruch');
    assertEqual(JSON.stringify(unterschiede(vorUebernahme, bestand(kopie))), '[]', 'Ein Jahr ganz oder gar nicht: keine Datei geändert');
    erfundeneLieferungenSchreiben(kopie, JAHR, { status: 'vorlaeufig' });
    const vorlaeufig = cli(kopie, [String(JAHR), '--uebernehmen']);
    assertEqual(vorlaeufig.status, 2, 'Vorläufige Lieferungen sperren die Übernahme');
    assertEqual(JSON.stringify(unterschiede(vorUebernahme, bestand(kopie)).filter(datei => !datei.includes('/jahre/'))), '[]', 'Auch dann bleibt alles außer den Lieferungen unverändert');

    console.log('Test 6: Revision nach dem Schema <Y>-<lfd>');
    assertEqual(naechsteRevision('2026-08-01.4', 2026), '2026-1', 'Erste Übernahme eines Jahres');
    assertEqual(naechsteRevision('2026-1', 2026), '2026-2', 'Weitere Übernahme desselben Jahres');
    assertEqual(naechsteRevision('2026-3', 2027), '2027-1', 'Neues Jahr beginnt bei 1');
} finally {
    wegwerfkopieEntfernen(kopie);
}

console.log('✅ Jahresdaten Prüfung tests passed');
