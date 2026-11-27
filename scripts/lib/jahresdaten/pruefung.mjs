/**
 * `npm run jahresdaten -- <Y> --pruefen`: prüft die sechs Jahreslieferungen für Y gegen den Datenstand.
 *
 * Ampel (Nachtrag JD-2a, Punkt 6):
 * - rot (sperrt die Übernahme): Kette fehlt, Lieferung ungültig oder ohne passenden Beleg, Wert widerspricht dem Beleg
 *   (der Leser der Kette liest die Rohdatei neu; passt kein Leser, rot bis `--beleg-bestaetigt <kette>`), vorläufiger Status oder Rohbeleg,
 *   Wert fehlt oder ist nicht endlich bzw. nach dem Kettenvertrag unzulässig, Einheit oder Beobachtungsperiode passt
 *   nicht, Anschlusswert passt nicht, Umbasierung (eigener Vorgang), Jahr schließt nicht an das Endjahr an.
 * - gelb (Übernahme erlaubt): Plausibilitätsgrenzen je Kette, gemeldete Änderungen alter Jahre.
 * - grün: weder rot noch gelb.
 * Die Prüfung schreibt nichts; den Bericht schreibt der Aufrufer (berichtSchreiben).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { KETTEN } from './ketten.mjs';
import { lieferungFehler, lieferungLesen, lieferungsOrdner } from './lieferung.mjs';
import { JOURNAL_ORDNER, journalOffen } from './journal.mjs';
import { BelegFehler, belegAbweichungen, belegWerte } from './beleg.mjs';

export const DATENSTAND_DATEI = 'app/simulator/historical-datenstand.js';
let datenstandLesung = 0;

/** Liest den Datenstand einer Projektwurzel frisch (am Modul-Cache vorbei). @param {string} root */
export async function datenstandLesen(root) {
    datenstandLesung += 1;
    const url = `${pathToFileURL(path.join(root, DATENSTAND_DATEI)).href}?lesung=${datenstandLesung}`;
    return (await import(url)).default;
}

/** Vergleich je Feld; Gruppen (z. B. Länder) werden je Eintrag verglichen. Umbasierte Indexfelder bleiben außen vor. */
function vergleichen(kette, geliefert, gespeichert, ausgenommen = new Set()) {
    const vergleiche = [];
    for (const [feld, toleranz] of Object.entries(kette.anschluss.toleranz)) {
        if (ausgenommen.has(feld)) continue;
        const gruppe = kette.werte[feld]?.gruppe;
        const paare = gruppe
            ? gruppe.map(key => [`${feld}.${key}`, geliefert?.[feld]?.[key], gespeichert?.[feld]?.[key]])
            : [[feld, geliefert?.[feld], gespeichert?.[feld]]];
        for (const [name, wert, soll] of paare) {
            if (wert === undefined) continue;
            const abstand = Math.abs(wert - soll);
            vergleiche.push({ feld: name, geliefert: wert, gespeichert: soll ?? null, abstand: Number.isFinite(abstand) ? abstand : null,
                toleranz, ok: Number.isFinite(abstand) && abstand <= toleranz + 1e-12 });
        }
    }
    return vergleiche;
}

/**
 * Prüft eine Kette.
 * @param {string} root @param {import('./ketten.mjs').KettenModul} modul @param {number} jahr @param {any} datenstand
 */
function ketteDurchsehen(root, modul, jahr, datenstand, belegBestaetigt = new Set()) {
    const { KETTE } = modul;
    const eintrag = {
        id: KETTE.id, label: KETTE.label, geliefert: false, lieferung: `data/historical/${KETTE.id}/jahre/${jahr}/lieferung.json`,
        sha256: null, lieferant: null, status: null, quelle: null, methode: null,
        rot: [], gelb: [], hinweise: [],
        anschluss: { jahr: jahr - 1, regel: KETTE.anschluss.regel, vergleiche: [] },
        plausibilitaet: [], alteJahre: [], beleg: null, zeile: null, ergebnis: 'rot'
    };
    const chain = modul.lesen(root);
    if (modul.endjahr(chain) !== datenstand.endYear) {
        eintrag.rot.push(`Ketten-Ausgabe endet ${modul.endjahr(chain)}, der Datenstand ${datenstand.endYear}`);
    }
    const gelesen = lieferungLesen(root, KETTE, jahr);
    if (!gelesen.vorhanden) {
        const offen = fs.existsSync(path.join(lieferungsOrdner(root, KETTE.id, jahr), 'ANLEITUNG.md'));
        eintrag.rot.push(offen ? `Lieferung offen, Anleitung in ${path.dirname(eintrag.lieferung)}/ANLEITUNG.md` : 'Lieferung fehlt');
        return eintrag;
    }
    eintrag.geliefert = true;
    eintrag.sha256 = gelesen.sha256;
    if (gelesen.lesefehler) {
        eintrag.rot.push(gelesen.lesefehler);
        return eintrag;
    }
    const { lieferung } = gelesen;
    Object.assign(eintrag, { lieferant: lieferung.lieferant ?? null, status: lieferung.status ?? null, quelle: lieferung.quelle ?? null, methode: lieferung.methode ?? null });
    eintrag.rot.push(...lieferungFehler(lieferung, KETTE, jahr), ...gelesen.rohdatenFehler);
    if (lieferung.status === 'vorlaeufig') eintrag.rot.push('Status vorläufig');
    if (eintrag.rot.length) return abschliessen(eintrag);
    belegPruefen(root, KETTE, lieferung, eintrag, belegBestaetigt.has(KETTE.id));

    const gespeichert = modul.gespeichert(chain, jahr - 1, root);
    const umbasiert = new Set();
    if (!gespeichert) eintrag.rot.push(`Kein gespeicherter Stand für ${jahr - 1}`);
    else {
        for (const [feld, spec] of Object.entries(KETTE.werte)) {
            if (!spec.basis) continue;
            const neu = lieferung.basis?.[feld], alt = gespeichert.basis?.[feld];
            if (!alt) eintrag.rot.push(`Keine gespeicherte Indexbasis für ${feld} ${jahr - 1}`);
            else if (neu !== alt) {
                eintrag.rot.push(`Umbasierung – eigener Vorgang: ${feld} mit Basis ${neu} statt ${alt}`);
                umbasiert.add(feld);
            }
        }
        eintrag.anschluss.vergleiche = vergleichen(KETTE, lieferung.anschluss.werte, gespeichert, umbasiert);
        for (const vergleich of eintrag.anschluss.vergleiche.filter(item => !item.ok)) {
            eintrag.rot.push(`Anschlusswert ${jahr - 1} ${vergleich.feld}: geliefert ${vergleich.geliefert}, gespeichert ${vergleich.gespeichert} (Toleranz ${vergleich.toleranz})`);
        }
    }
    try {
        eintrag.zeile = modul.zeileBerechnen(chain, lieferung);
    } catch (error) {
        eintrag.rot.push(`Wert nicht zulässig: ${error.message}`);
    }
    if (eintrag.zeile) {
        eintrag.plausibilitaet = modul.plausibilitaet(lieferung, chain);
        for (const regel of eintrag.plausibilitaet.filter(item => !item.ok)) eintrag.gelb.push(`Plausibilität „${regel.regel}“: ${regel.text}`);
    }
    for (const [year, werte] of Object.entries(lieferung.alteJahre ?? {})) {
        const stand = modul.gespeichert(chain, Number(year), root);
        if (!stand) {
            eintrag.hinweise.push(`Alte Jahre: für ${year} gibt es keinen gespeicherten Vergleichswert`);
            continue;
        }
        for (const vergleich of vergleichen(KETTE, werte, stand, umbasiert)) {
            eintrag.alteJahre.push({ jahr: Number(year), ...vergleich });
            if (!vergleich.ok) eintrag.gelb.push(`Quelle meldet für ${year} ${vergleich.feld} = ${vergleich.geliefert}, gespeichert ${vergleich.gespeichert} (nur gemeldet, alte Jahre bleiben eingefroren)`);
        }
    }
    return abschliessen(eintrag);
}

/**
 * Werte gegen Beleg: Rohdatei mit dem Leser der Kette neu lesen und jedes Feld vergleichen (Anschlusstoleranz).
 * @param {string} root @param {any} KETTE @param {any} lieferung @param {any} eintrag @param {boolean} bestaetigt
 */
function belegPruefen(root, KETTE, lieferung, eintrag, bestaetigt) {
    const kurzname = KETTE.label.toLowerCase();
    try {
        const beleg = belegWerte(root, KETTE, lieferung);
        const abweichungen = belegAbweichungen(KETTE, lieferung, beleg);
        const anzahlRot = eintrag.rot.length;
        if (beleg.vorlaeufig) eintrag.rot.push('Rohbeleg ist vorläufig');
        for (const jahr of beleg.doppelteJahre ?? []) eintrag.rot.push(`Dezember ${jahr} steht mehrfach im Beleg`);
        for (const item of abweichungen) {
            eintrag.rot.push(`Wert widerspricht dem Beleg: ${item.teil} ${item.feld} geliefert ${item.geliefert}, Beleg ${item.beleg ?? 'ohne Wert'} (Toleranz ${item.toleranz})`);
        }
        for (const [feld, spec] of Object.entries(KETTE.werte)) {
            if (spec.basis && beleg.basis && lieferung.basis?.[feld] !== beleg.basis) eintrag.rot.push(`Basis widerspricht dem Beleg: ${feld} geliefert ${lieferung.basis?.[feld]}, Beleg ${beleg.basis}`);
        }
        eintrag.beleg = { ergebnis: eintrag.rot.length > anzahlRot ? 'widerspricht' : 'passt', abweichungen };
    } catch (error) {
        if (!(error instanceof BelegFehler)) throw error;
        if (bestaetigt) {
            eintrag.beleg = { ergebnis: 'von Hand bestätigt', grund: error.message };
            eintrag.hinweise.push(`Beleg passt nicht zum Leser (${error.message}); Wert von Hand bestätigt mit --beleg-bestaetigt ${kurzname}`);
        } else {
            eintrag.beleg = { ergebnis: 'unlesbar', grund: error.message };
            eintrag.rot.push(`Beleg passt nicht zum Leser – Wert von Hand bestätigen (--beleg-bestaetigt ${kurzname}): ${error.message}`);
        }
    }
}

function abschliessen(eintrag) {
    eintrag.ergebnis = eintrag.rot.length ? 'rot' : eintrag.gelb.length ? 'gelb' : 'gruen';
    return eintrag;
}

/**
 * Prüft alle sechs Lieferungen für ein Jahr. Schreibt nichts.
 * @param {string} root Projektwurzel. @param {number} jahr Datenjahr Y.
 */
export async function pruefen(root, jahr, { belegBestaetigt = [] } = {}) {
    const bestaetigt = new Set(belegBestaetigt);
    const datenstand = await datenstandLesen(root);
    const { classifyHistoricalRegime } = await import('../../../app/simulator/simulator-data.js');
    const rot = [];
    if (journalOffen(root)) rot.push(`Offenes Übernahme-Journal unter ${JOURNAL_ORDNER}/: Der Stand ist nicht abgeschlossen; npm run jahresdaten schließt es beim nächsten Aufruf ab`);
    if (jahr !== datenstand.endYear + 1) rot.push(`Jahr ${jahr} schließt nicht an das Endjahr ${datenstand.endYear} des Datenstands an`);
    const ketten = KETTEN.map(modul => ketteDurchsehen(root, modul, jahr, datenstand, bestaetigt));
    for (const kette of ketten) rot.push(...kette.rot.map(text => `${kette.label}: ${text}`));
    const gelb = ketten.flatMap(kette => kette.gelb.map(text => `${kette.label}: ${text}`));
    const aktien = ketten.find(kette => kette.id === 'global-equity-research-chain')?.zeile;
    const inflation = ketten.find(kette => kette.id === 'german-cpi-chain')?.zeile;
    const regime = aktien && inflation ? {
        klasse: classifyHistoricalRegime({ rendite: aktien.annualReturns, inflation: inflation.annualRates }),
        aktienrendite: aktien.annualReturns,
        inflation: inflation.annualRates
    } : null;
    return {
        jahr,
        ergebnis: rot.length ? 'rot' : gelb.length ? 'gelb' : 'gruen',
        datenstand: { startYear: datenstand.startYear, endYear: datenstand.endYear, revision: datenstand.revision, contentHash: datenstand.contentHash },
        belegBestaetigt: KETTEN.filter(modul => bestaetigt.has(modul.KETTE.id)).map(modul => modul.KETTE.label),
        regime,
        befunde: { rot, gelb },
        ketten
    };
}

export const BERICHT_ORDNER = 'data/historical';

/** @param {number} jahr @returns {{md: string, json: string}} Pfade relativ zur Wurzel. */
export function berichtPfade(jahr) {
    return { md: `${BERICHT_ORDNER}/jahresdaten-bericht-${jahr}.md`, json: `${BERICHT_ORDNER}/jahresdaten-bericht-${jahr}.json` };
}

const AMPEL = { gruen: 'GRÜN', gelb: 'GELB', rot: 'ROT' };
const prozent = value => `${(value >= 0 ? '+' : '')}${value.toFixed(2).replace('.', ',')} %`;

/** @param {Awaited<ReturnType<typeof pruefen>>} bericht @returns {string} */
export function berichtMarkdown(bericht) {
    const { jahr, datenstand } = bericht;
    const zeilen = [
        `# Jahresdaten ${jahr}: Prüfbericht`, '',
        `Ergebnis: **${AMPEL[bericht.ergebnis]}** – ${bericht.ergebnis === 'rot' ? 'Übernahme gesperrt.' : bericht.ergebnis === 'gelb' ? 'Übernahme möglich, Hinweise prüfen.' : 'Übernahme möglich.'}`, '',
        `Datenstand vor der Übernahme: ${datenstand.startYear}–${datenstand.endYear}, Revision ${datenstand.revision}, Inhaltshash \`${datenstand.contentHash}\`.`, '',
        ...(bericht.belegBestaetigt?.length ? [`Beleg von Hand bestätigt (--beleg-bestaetigt): ${bericht.belegBestaetigt.join(', ')}.`, ''] : []),
        bericht.regime
            ? `Regimeklasse ${jahr}: ${bericht.regime.klasse} (Aktien ${prozent(bericht.regime.aktienrendite * 100)}, Inflation ${prozent(bericht.regime.inflation)}).`
            : `Regimeklasse ${jahr}: nicht bestimmbar (Aktien- oder Inflationslieferung fehlt bzw. ist rot).`, '',
        '| Kette | Lieferant | Status | Beleg | Anschluss Y−1 | Plausibilität | Alte Jahre | Ergebnis |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |'
    ];
    for (const kette of bericht.ketten) {
        const anschluss = !kette.anschluss.vergleiche.length ? '–' : kette.anschluss.vergleiche.every(item => item.ok) ? 'passt' : 'passt nicht';
        const plausibel = kette.plausibilitaet.length ? `${kette.plausibilitaet.filter(item => item.ok).length}/${kette.plausibilitaet.length} im Rahmen` : '–';
        const alte = kette.alteJahre.length ? `${kette.alteJahre.filter(item => !item.ok).length} geändert` : '–';
        zeilen.push(`| ${kette.label} | ${kette.lieferant ?? '–'} | ${kette.status ?? (kette.geliefert ? '?' : 'fehlt')} | ${kette.beleg?.ergebnis ?? '–'} | ${anschluss} | ${plausibel} | ${alte} | ${AMPEL[kette.ergebnis]} |`);
    }
    zeilen.push('', '## Befunde', '');
    if (!bericht.befunde.rot.length && !bericht.befunde.gelb.length) zeilen.push('Keine.');
    for (const [titel, liste] of [['Rot', bericht.befunde.rot], ['Gelb', bericht.befunde.gelb]]) {
        if (liste.length) zeilen.push(`${titel}:`, '', ...liste.map(text => `- ${text}`), '');
    }
    zeilen.push('', '## Je Kette', '');
    for (const kette of bericht.ketten) {
        zeilen.push(`### ${kette.label}`, '', `- Lieferung: \`${kette.lieferung}\`${kette.sha256 ? `, SHA-256 \`${kette.sha256}\`` : ' (fehlt)'}`);
        if (kette.quelle) zeilen.push(`- Quelle: ${kette.quelle.name ?? '–'}, ${kette.quelle.url ?? '–'}; Abruf ${kette.quelle.abrufdatum ?? '–'}, Stand ${kette.quelle.veroeffentlichungsstand ?? '–'}`);
        if (kette.methode) zeilen.push(`- Methode: ${kette.methode}`);
        zeilen.push(`- Anschluss: ${kette.anschluss.regel}`);
        if (kette.zeile) zeilen.push(`- Neue Jahreszeile: ${Object.entries(kette.zeile).map(([feld, wert]) => `${feld} = ${JSON.stringify(wert)}`).join('; ')}`);
        for (const regel of kette.plausibilitaet) zeilen.push(`- Plausibilität „${regel.regel}“: ${regel.ok ? 'im Rahmen' : 'außerhalb'} (${regel.text})`);
        for (const hinweis of kette.hinweise) zeilen.push(`- Hinweis: ${hinweis}`);
        zeilen.push('');
    }
    return `${zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** Schreibt Bericht als Markdown und JSON. @param {string} root @param {Awaited<ReturnType<typeof pruefen>>} bericht @returns {string[]} */
export function berichtSchreiben(root, bericht) {
    const pfade = berichtPfade(bericht.jahr);
    fs.writeFileSync(path.join(root, pfade.md), berichtMarkdown(bericht));
    fs.writeFileSync(path.join(root, pfade.json), `${JSON.stringify(bericht, null, 2)}\n`);
    return [pfade.md, pfade.json];
}
