/**
 * Rückwärtsprobe 2025, offline (Abnahme JD-2a, Methodenprobe je Kette).
 *
 * In einer Wegwerfkopie: Zeile 2025 (und spätere angehängte Jahre) aus allen Ketten-Ausgaben entfernen,
 * Endjahr auf 2024 setzen (Generator), Lieferungen 2025 aus den gespeicherten Originalen erzeugen
 * (Lieferant `skript`), dann `--pruefen` und `--uebernehmen` wie im Betrieb. Danach muss gelten:
 * - Zeile 2025 jeder Kette bytegleich der gespeicherten,
 * - jede Ketten-Ausgabe ohne Fortschreibungsblock bytegleich dem Grundbestand,
 * - erzeugtes Datenmodul bytegleich, Inhaltshash = Grundbestand (c79350c5…),
 * - Datenstand gleich bis auf Revision und `lieferungen`, Klasse-3-Sollwerte bytegleich
 *   (beides nur, solange das Repo selbst 2025 endet).
 * Poppler wird nicht gebraucht. Mit `behalten` bleiben zwei Kopien liegen: die nach der Übernahme und die davor
 * (Endjahr jahr − 1, Lieferungen angelegt), damit ein Prüfer `--pruefen` und `--uebernehmen` selbst fahren kann.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KETTEN } from './ketten.mjs';
import { jahreszeile, zeileEntfernen } from './fortschreibung.mjs';
import { lieferungSchreiben } from './lieferung.mjs';
import { datenstandLesen } from './pruefung.mjs';
import { GENERATOR_DATEIEN } from './uebernahme.mjs';
import { REVISIONSABHAENGIG, SOLLWERT_DATEIEN } from './sollwerte.mjs';
import { GRUNDBESTAND } from './grundbestand.mjs';
import { wegwerfkopieAnlegen, wegwerfkopieEntfernen } from './wegwerfkopie.mjs';
import { renderHistoricalRecordsModule } from '../../historical-data-generate.mjs';

/** Kette ohne Jahre nach `bisJahr` und ohne Fortschreibungsblock. */
function bisJahr(modul, chain, jahr) {
    let next = chain;
    while (modul.endjahr(next) > jahr) next = zeileEntfernen(modul, next, modul.endjahr(next));
    const { fortschreibung, ...rest } = next;
    return rest;
}

/** @param {string} datei @returns {any} JSON oder null */
function lesbar(datei) {
    try {
        return JSON.parse(fs.readFileSync(datei, 'utf8'));
    } catch {
        return null;
    }
}

function texte(modul, chain) {
    return [...modul.schreiben(chain).values()].join('\u0000');
}

function lauf(kopie, args) {
    const result = spawnSync(process.execPath, args, { cwd: kopie, encoding: 'utf8', windowsHide: true });
    return { exit: result.status, ausgabe: `${result.stdout}${result.stderr}`.trim() };
}

/** Sollwertdatei ohne die Felder, die nur von der Revision abhängen. */
function ohneRevisionsfelder(datei, text) {
    const wert = JSON.parse(text);
    for (const pfad of REVISIONSABHAENGIG[datei] ?? []) {
        const teile = pfad.split('.');
        const eltern = teile.slice(0, -1).reduce((node, key) => node?.[key], wert);
        if (eltern) delete eltern[teile.at(-1)];
    }
    return JSON.stringify(wert);
}

/** Datenstand ohne Revision und Lieferungen. */
function ohneRevisionUndLieferungen(stand) {
    const kopie = JSON.parse(JSON.stringify(stand));
    delete kopie.revision;
    for (const hashes of Object.values(kopie.seriesHashes)) delete hashes.lieferungen;
    return JSON.stringify(kopie);
}

/** Lieferungen Y aus den gespeicherten Originalen in die Kopie schreiben (offline, Standard). */
function lieferungenAusOriginalen(kopie, jahr) {
    return KETTEN.map(modul => {
        const { lieferung, dateien } = modul.lieferungAusOriginalen(kopie, jahr);
        lieferungSchreiben(kopie, modul.KETTE.id, jahr, dateien);
        return { kette: modul.KETTE.label, lieferung, json: dateien.get('lieferung.json').toString('utf8') };
    });
}

/**
 * @param {{root: string, jahr?: number, behalten?: boolean,
 *   lieferungenAnlegen?: (kopie: string, jahr: number) => Promise<any[]> | any[]}} options
 *   `lieferungenAnlegen` legt die Lieferungen Y in der Kopie an; ohne Angabe aus den Originalen (offline).
 *   Die Live-Probe (rueckwaertsprobe-live.mjs) holt sie stattdessen aus dem Netz.
 */
export async function rueckwaertsprobe({ root, jahr = GRUNDBESTAND.endYear, behalten = false, lieferungenAnlegen = lieferungenAusOriginalen }) {
    let kopieVorher = null;
    const fehler = [];
    const original = await datenstandLesen(root);
    const repoEndetImJahr = original.endYear === jahr;
    const vorher = KETTEN.map(modul => {
        const chain = modul.lesen(root);
        return { modul, zeile: JSON.stringify(jahreszeile(modul, chain, jahr)), grundbestand: texte(modul, bisJahr(modul, chain, jahr)) };
    });
    const kopie = wegwerfkopieAnlegen(root, 'jahresdaten-rueckwaertsprobe-');
    try {
        for (const { modul } of vorher) {
            let chain = modul.lesen(kopie);
            while (modul.endjahr(chain) >= jahr) chain = zeileEntfernen(modul, chain, modul.endjahr(chain));
            for (const [file, text] of modul.schreiben(chain)) fs.writeFileSync(path.join(kopie, file), text);
        }
        // Das Datenmodul greift auf jedes Jahr der Ketten zu; ohne 2025 in den Ketten muss es vor dem Generatorlauf kürzer sein.
        fs.writeFileSync(path.join(kopie, GENERATOR_DATEIEN[1]), renderHistoricalRecordsModule({ startYear: GRUNDBESTAND.startYear, endYear: jahr - 1 }));
        const zurueck = lauf(kopie, ['scripts/historical-data-generate.mjs', '--endjahr', String(jahr - 1)]);
        if (zurueck.exit !== 0) throw new Error(`Endjahr ${jahr - 1} setzen scheiterte: ${zurueck.ausgabe}`);
        const lieferungen = await lieferungenAnlegen(kopie, jahr);
        // Mit --behalten bleibt auch der Stand vor der Übernahme liegen: Endjahr jahr − 1, Lieferungen jahr angelegt.
        if (behalten) {
            kopieVorher = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-rueckwaertsprobe-vorher-'));
            fs.cpSync(kopie, kopieVorher, { recursive: true, verbatimSymlinks: true });
        }
        const pruefen = lauf(kopie, ['scripts/jahresdaten.mjs', String(jahr), '--pruefen']);
        if (pruefen.exit !== 0) fehler.push(`--pruefen ist nicht grün (Exit ${pruefen.exit})`);
        const uebernehmen = lauf(kopie, ['scripts/jahresdaten.mjs', String(jahr), '--uebernehmen']);
        if (uebernehmen.exit !== 0) fehler.push(`--uebernehmen scheiterte (Exit ${uebernehmen.exit})`);

        const ketten = vorher.map(({ modul, zeile, grundbestand }) => {
            const chain = modul.lesen(kopie);
            const neueZeile = JSON.stringify(jahreszeile(modul, chain, jahr));
            const { fortschreibung, ...ohneBlock } = chain;
            const ergebnis = {
                kette: modul.KETTE.label,
                zeileBytegleich: neueZeile === zeile,
                ketteBytegleichOhneBlock: texte(modul, ohneBlock) === grundbestand,
                lieferungSha256: fortschreibung?.lieferungen?.find(item => item.jahr === jahr)?.sha256 ?? null
            };
            if (!ergebnis.zeileBytegleich) fehler.push(`${modul.KETTE.label}: Zeile ${jahr} weicht ab`);
            if (!ergebnis.ketteBytegleichOhneBlock) fehler.push(`${modul.KETTE.label}: Ketten-Ausgabe ohne Fortschreibungsblock weicht ab`);
            return ergebnis;
        });
        const neu = await datenstandLesen(kopie);
        const recordsText = fs.readFileSync(path.join(kopie, GENERATOR_DATEIEN[1]), 'utf8');
        const recordsErwartet = repoEndetImJahr ? fs.readFileSync(path.join(root, GENERATOR_DATEIEN[1]), 'utf8')
            : renderHistoricalRecordsModule({ startYear: GRUNDBESTAND.startYear, endYear: jahr });
        const vergleich = {
            contentHash: neu.contentHash,
            contentHashGleich: neu.contentHash === GRUNDBESTAND.contentHash,
            datenmodulBytegleich: recordsText === recordsErwartet,
            revision: neu.revision,
            datenstandGleichOhneRevisionUndLieferungen: repoEndetImJahr ? ohneRevisionUndLieferungen(neu) === ohneRevisionUndLieferungen(original) : null,
            simulatorHtmlBytegleich: repoEndetImJahr ? fs.readFileSync(path.join(kopie, GENERATOR_DATEIEN[2]), 'utf8') === fs.readFileSync(path.join(root, GENERATOR_DATEIEN[2]), 'utf8') : null,
            sollwerte: repoEndetImJahr ? SOLLWERT_DATEIEN.map(datei => {
                const neuText = fs.readFileSync(path.join(kopie, datei), 'utf8'), altText = fs.readFileSync(path.join(root, datei), 'utf8');
                return { datei, bytegleich: neuText === altText, gleichOhneRevision: ohneRevisionsfelder(datei, neuText) === ohneRevisionsfelder(datei, altText) };
            }) : []
        };
        if (!vergleich.contentHashGleich) fehler.push(`Inhaltshash ${neu.contentHash} statt ${GRUNDBESTAND.contentHash}`);
        if (!vergleich.datenmodulBytegleich) fehler.push('Erzeugtes Datenmodul weicht ab');
        if (vergleich.datenstandGleichOhneRevisionUndLieferungen === false) fehler.push('Datenstand weicht über Revision und Lieferungen hinaus ab');
        if (vergleich.simulatorHtmlBytegleich === false) fehler.push('Simulator.html weicht ab');
        for (const { datei, gleichOhneRevision } of vergleich.sollwerte) if (!gleichOhneRevision) fehler.push(`Sollwerte ${datei} weichen ab`);
        return { ok: fehler.length === 0, fehler, jahr, kopie: behalten ? kopie : null, kopieVorher, pruefen, uebernehmen, ketten, vergleich, lieferungen,
            datenstandLieferungen: neu.seriesHashes, bericht: lesbar(path.join(kopie, `data/historical/jahresdaten-bericht-${jahr}.json`)) };
    } finally {
        if (!behalten) wegwerfkopieEntfernen(kopie);
    }
}
