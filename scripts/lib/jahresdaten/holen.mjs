/**
 * `npm run jahresdaten -- <Jahr> --holen`: ruft je Kette die Quelle ab und legt die Lieferung
 * data/historical/<kette>/jahre/<Jahr>/ im Format von lieferung.mjs an (Lieferant `skript`).
 *
 * Scheitert ein Abruf oder ist der Wert noch nicht veröffentlicht, entsteht eine offene Lieferung:
 * ANLEITUNG.md (welche Seite, welche Zahl, welcher Beleg) und lieferung-vorlage.json. Ein Agent oder der Nutzer
 * füllt die Vorlage aus, speichert sie als lieferung.json samt Beleg und löscht die beiden Dateien. Nichts wird erfunden.
 * Eine vorhandene endgültige lieferung.json bleibt stehen, außer die Kette ist in `ersetzen` genannt; Lieferungen von
 * Agent oder Hand ersetzt nur `ersetzen` zusammen mit `auchHand` (siehe ketteHolen). Jeder Leserfehler, auch eine unlesbare
 * Datei, macht nur die betroffene Kette offen; die übrigen Ketten werden weiter geholt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { KETTEN } from './ketten.mjs';
import { LIEFERUNG_DATEI, LIEFERUNG_SCHEMA_ID, lieferungsOrdner, lieferungSchreiben } from './lieferung.mjs';
import { AbrufFehler, netzAbruf } from './leser/netz.mjs';
import { OffenFehler } from './leser/gemeinsam.mjs';
import * as aktien from './leser/aktien.mjs';
import * as inflation from './leser/inflation.mjs';
import * as geldmarkt from './leser/geldmarkt.mjs';
import * as lohn from './leser/lohn.mjs';
import * as gold from './leser/gold.mjs';
import * as cape from './leser/cape.mjs';

export const ANLEITUNG_DATEI = 'ANLEITUNG.md';
export const VORLAGE_DATEI = 'lieferung-vorlage.json';

/** Leser je Kette, in der Reihenfolge von KETTEN. */
export const LESER = Object.freeze({
    'global-equity-research-chain': aktien,
    'german-cpi-chain': inflation,
    'german-cash-money-market-chain': geldmarkt,
    'german-gross-wage-growth-chain': lohn,
    'gold-german-investor-chain': gold,
    'us-shiller-cape-chain': cape
});

/** Platzhalter für Werte einer Kette (Gruppen je Schlüssel). @param {any} KETTE */
function leereWerte(KETTE) {
    return Object.fromEntries(Object.entries(KETTE.werte).filter(([, spec]) => !spec.optional)
        .map(([feld, spec]) => [feld, spec.gruppe ? Object.fromEntries(spec.gruppe.map(key => [key, null])) : null]));
}

/**
 * Vorlage einer Lieferung durch Agent oder Nutzer: alle Pflichtfelder, Werte als null.
 * @param {any} modul Kettenmodul @param {any} leser @param {string} root @param {number} jahr
 */
export function vorlage(modul, leser, root, jahr) {
    const { KETTE } = modul;
    const basis = Object.entries(KETTE.werte).filter(([, spec]) => spec.basis);
    let gespeicherteBasis = {};
    try {
        gespeicherteBasis = modul.gespeichert(modul.lesen(root), jahr - 1, root)?.basis ?? {};
    } catch {
        gespeicherteBasis = {};
    }
    const urls = Object.values(leser.quellen(jahr));
    return {
        schema: LIEFERUNG_SCHEMA_ID,
        kette: KETTE.id,
        jahr,
        perioden: KETTE.periodenFuer(jahr),
        werte: leereWerte(KETTE),
        einheit: Object.fromEntries(Object.entries(leereWerte(KETTE)).map(([feld]) => [feld, KETTE.werte[feld].einheit])),
        ...(basis.length ? { basis: Object.fromEntries(basis.map(([feld]) => [feld, gespeicherteBasis[feld] ?? 'JJJJ=100'])) } : {}),
        anschluss: { jahr: jahr - 1, werte: leereWerte(KETTE) },
        quelle: { name: '', url: urls[0], abrufdatum: 'JJJJ-MM-TT', veroeffentlichungsstand: '' },
        methode: 'von Hand übernommen: …',
        lieferant: 'agent',
        status: 'vorlaeufig',
        hinweis: `Status erst auf endgueltig stellen, wenn diese Regel erfüllt ist: ${leser.STATUSREGEL}.`,
        rohdaten: [{ datei: 'beleg-…', sha256: 'SHA-256 der Belegdatei (sha256sum)', art: 'antwort' }]
    };
}

/** @param {any} modul @param {any} leser @param {number} jahr @param {string} grund */
export function anleitungText(modul, leser, jahr, grund) {
    const { KETTE } = modul;
    const perioden = KETTE.periodenFuer(jahr);
    const felder = Object.entries(KETTE.beschreibung).map(([feld, text]) => `- \`${feld}\` (${KETTE.werte[feld].einheit}${KETTE.werte[feld].optional ? ', optional' : ''}): ${text}`);
    return `# Offene Lieferung ${KETTE.label} ${jahr}

Grund: ${grund}

Das Skript hat keine Werte eingetragen. Diese Lieferung füllt ein Agent oder der Nutzer von Hand. Ablauf und Regeln stehen in docs/reference/JAHRESDATEN.md, Abschnitt „Anleitung für Agenten“.

## Welche Seite

${leser.ANLEITUNG.seiten.map(seite => `- ${seite}`).join('\n')}

Abrufadressen des Skripts:

${Object.values(leser.quellen(jahr)).map(url => `- ${url}`).join('\n')}

## Welche Zahl

${leser.ANLEITUNG.zahlen}

Beobachtungsperiode der Werte ${perioden.werte}, des Anschlusses ${perioden.anschluss}. Felder in \`werte\` und \`anschluss.werte\`:

${felder.join('\n')}

## Welcher Beleg

${leser.ANLEITUNG.beleg} Die Datei kommt in diesen Ordner, ihr SHA-256 nach \`rohdaten\`.

## Schritte

1. Werte für Y und Y−1 auf der Seite ablesen, nicht schätzen. Fehlt ein Wert, bleibt die Lieferung offen.
2. Beleg in diesen Ordner legen und den SHA-256 bestimmen (\`sha256sum <datei>\`).
3. \`${VORLAGE_DATEI}\` als \`${LIEFERUNG_DATEI}\` speichern und ausfüllen: Werte, Quelle mit Abrufdatum und Stand, Methode, Lieferant \`agent\` oder \`hand\`. Der Status steht auf \`vorlaeufig\`; auf \`endgueltig\` erst stellen, wenn gilt: ${leser.STATUSREGEL}.
4. \`${ANLEITUNG_DATEI}\` und \`${VORLAGE_DATEI}\` löschen.
5. \`npm run jahresdaten -- ${jahr} --pruefen\` ausführen und den Bericht lesen.
`;
}

/** Ordner leeren (nur Dateien direkt im Lieferordner). @param {string} ordner */
function ordnerLeeren(ordner) {
    if (!fs.existsSync(ordner)) return;
    for (const name of fs.readdirSync(ordner)) fs.rmSync(path.join(ordner, name), { recursive: true, force: true });
}

/** Kurzname (aktien, inflation, geldmarkt, lohn, gold, cape) oder Ordnername → Ordnername; unbekannt → null. @param {string} name */
export function ketteAusName(name) {
    const modul = KETTEN.find(item => item.KETTE.id === name || item.KETTE.label.toLowerCase() === String(name).toLowerCase());
    return modul ? modul.KETTE.id : null;
}

/** Vorhandene lieferung.json lesen; unlesbar zählt wie eine vorläufige Skriptlieferung. @param {string} datei */
function vorhandeneLieferung(datei) {
    if (!fs.existsSync(datei)) return null;
    try {
        return JSON.parse(fs.readFileSync(datei, 'utf8'));
    } catch {
        return { lieferant: 'skript', status: 'vorlaeufig' };
    }
}

/**
 * Holt eine Kette, schreibt die Lieferung oder die offene Lieferung.
 *
 * Vorhandene Lieferungen: Eine endgültige bleibt stehen, außer die Kette steht in `ersetzen`. Eine vorläufige Lieferung
 * des Skripts zählt als offen und wird neu geholt. Lieferungen von `agent` oder `hand` ersetzt der Abruf nur, wenn die Kette
 * in `ersetzen` steht und `auchHand` gesetzt ist. Scheitert der Neuabruf, bleibt die vorhandene Lieferung unverändert.
 * @param {{root: string, ziel?: string, jahr: number, abrufen?: import('./leser/netz.mjs').Abruf, ersetzen?: Iterable<string>,
 *   auchHand?: boolean, leserOptionen?: object, leserTabelle?: Record<string, any>}} optionen
 * @param {any} modul Kettenmodul
 */
export async function ketteHolen({ root, ziel = root, jahr, abrufen = netzAbruf, ersetzen = [], auchHand = false, leserOptionen = {}, leserTabelle = LESER }, modul) {
    const { KETTE } = modul;
    const leser = leserTabelle[KETTE.id];
    const ordner = lieferungsOrdner(ziel, KETTE.id, jahr);
    const relativ = path.relative(ziel, ordner).split(path.sep).join('/');
    const basis = { kette: KETTE.id, label: KETTE.label, ordner: relativ };
    const alt = vorhandeneLieferung(path.join(ordner, LIEFERUNG_DATEI));
    const gewaehlt = new Set(ersetzen).has(KETTE.id);
    if (alt) {
        const vonHand = ['agent', 'hand'].includes(alt.lieferant);
        const behalten = vonHand ? !(gewaehlt && auchHand) : alt.status !== 'vorlaeufig' && !gewaehlt;
        if (behalten) {
            const hinweis = vonHand && gewaehlt ? `Lieferung von ${alt.lieferant}; ersetzen nur zusätzlich mit --auch-hand`
                : vonHand ? `Lieferung von ${alt.lieferant} bleibt stehen` : 'lieferung.json liegt schon vor; neu holen nur mit --ersetzen <kette>';
            return { ...basis, ergebnis: 'vorhanden', status: alt.status ?? null, dateien: [], hinweise: [hinweis] };
        }
    }
    let gelesen;
    try {
        gelesen = await leser.holen({ root, jahr, abrufen, ...leserOptionen });
    } catch (error) {
        // Jeder Fehler des Lesers macht nur diese Kette offen; die anderen Ketten werden weiter geholt.
        const grund = error instanceof AbrufFehler ? `Abruf ${error.url} gescheitert: ${error.message}`
            : error instanceof OffenFehler ? error.message : `Leser ${KETTE.label} gescheitert: ${error?.message ?? error}`;
        if (alt) {
            return { ...basis, ergebnis: 'vorhanden', status: alt.status ?? null, dateien: [], grund,
                hinweise: [`Neuabruf gescheitert (${grund}); die vorhandene Lieferung bleibt unverändert`] };
        }
        ordnerLeeren(ordner);
        fs.mkdirSync(ordner, { recursive: true });
        fs.writeFileSync(path.join(ordner, ANLEITUNG_DATEI), anleitungText(modul, leser, jahr, grund));
        fs.writeFileSync(path.join(ordner, VORLAGE_DATEI), `${JSON.stringify(vorlage(modul, leser, root, jahr), null, 2)}\n`);
        return { ...basis, ergebnis: 'offen', grund, dateien: [ANLEITUNG_DATEI, VORLAGE_DATEI].map(name => `${relativ}/${name}`), hinweise: [] };
    }
    const { lieferung, dateien, hinweise } = gelesen;
    ordnerLeeren(ordner);
    const geschrieben = lieferungSchreiben(ziel, KETTE.id, jahr, dateien);
    return { ...basis, ergebnis: 'geliefert', status: lieferung.status, dateien: geschrieben, hinweise, lieferung };
}

/**
 * Holt alle sechs Ketten nacheinander.
 * @param {Parameters<typeof ketteHolen>[0]} optionen
 */
export async function holen(optionen) {
    const ergebnisse = [];
    for (const modul of KETTEN) ergebnisse.push(await ketteHolen(optionen, modul));
    return ergebnisse;
}
