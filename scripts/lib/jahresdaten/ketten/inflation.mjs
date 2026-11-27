/**
 * Kette Inflation (german-cpi-chain): Rechenregel, Modultext und Lieferung aus den Originalen.
 *
 * Rechenregel Jahr Y: Jahresrate = veröffentlichte Destatis-Rate Y (Prozent zum Vorjahr);
 * synthetischer Index Y = Index Y−1 × (1 + Rate/100). Das Bauskript nutzt dieselbe Indexregel und
 * denselben Tabellenleser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { jsonAusModul } from '../modultext.mjs';
import { sha256, sha256CanonicalCodepoint } from '../kanonisch.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';

const MODUL = 'app/simulator/german-cpi-chain.js';
const START = 'export const GERMAN_CPI_RESEARCH_CHAIN = deepFreezeGermanCpiData(';
const ENDE = ');\n\nexport const GERMAN_CPI_INFLATION_RATES';
const ORIGINAL_HTML = 'data/historical/german-cpi-chain/originals/destatis-vpi-current-2026-07-10.html';
/** Tabellen der Destatis-Seite: Jahresdurchschnitte (2020=100) und Veränderungsraten. */
export const DESTATIS_LEVEL_TABLE = Object.freeze({ entryId: '236128', caption: '2020=100' });
export const DESTATIS_RATE_TABLE = Object.freeze({ entryId: '236130', caption: 'Veränderungsraten zum Vorjahr in %' });
/** Basis der Jahresdurchschnitte in der festgeschriebenen Destatis-Tabelle (Überschrift „2020=100“). */
const GRUNDBESTAND_BASIS = '2020=100';

export const KETTE = Object.freeze({
    id: 'german-cpi-chain',
    seriesId: 'inflation_de',
    label: 'Inflation',
    dateien: Object.freeze([MODUL]),
    jahresfelder: Object.freeze(['annualRates', 'indexLevels']),
    serienfeld: 'annualRates',
    periodenFuer: jahr => Object.freeze({ werte: String(jahr), anschluss: String(jahr - 1) }),
    werte: Object.freeze({ jahresrate: { einheit: 'prozent' }, indexstand: { einheit: 'index', basis: true } }),
    beschreibung: Object.freeze({
        jahresrate: 'Prozent zum Vorjahr, Verbraucherpreisindex Deutschland insgesamt (Destatis)',
        indexstand: 'Index, Jahresdurchschnitt, Basis laut Quelle (Destatis)'
    }),
    anschluss: Object.freeze({
        toleranz: Object.freeze({ jahresrate: 0.05, indexstand: 0.05 }),
        regel: 'Jahresrate und amtlicher Indexstand Y−1 gegen den gespeicherten Stand (Toleranz 0,05, halbe Veröffentlichungsstufe 0,1); Indexbasis muss gleich sein, sonst Umbasierung'
    })
});

/** @param {string} root @returns {any} */
export function lesen(root) {
    return jsonAusModul(root, MODUL, START, ENDE);
}

/** @param {any} chain @returns {Map<string, string>} */
export function schreiben(chain) {
    return new Map([[MODUL, `/**
 * GENERATED DATA ARTIFACT - DO NOT EDIT MANUALLY.
 * Build with: npm run build:german-cpi-data
 *
 * JST-derived values are licensed under CC BY-NC-SA 4.0.
 * Destatis values are licensed under Data Licence Germany - attribution - 2.0.
 * See data/historical/german-cpi-chain/LICENSE.md.
 */
"use strict";

function deepFreezeGermanCpiData(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreezeGermanCpiData(child, seen);
    return Object.freeze(value);
}

export const GERMAN_CPI_RESEARCH_CHAIN = deepFreezeGermanCpiData(${JSON.stringify(chain, null, 4)});

export const GERMAN_CPI_INFLATION_RATES =
    GERMAN_CPI_RESEARCH_CHAIN.annualRates;

export const GERMAN_CPI_SYNTHETIC_INDEX_LEVELS =
    GERMAN_CPI_RESEARCH_CHAIN.indexLevels;
`]]);
}

/** Rechenregel des synthetischen Index (Bau und Fortschreibung). @param {number} previousLevel @param {number} ratePct */
export function inflationIndexstand(previousLevel, ratePct) {
    return previousLevel * (1 + (ratePct / 100));
}

/** @param {any} chain @returns {number} */
export function endjahr(chain) {
    return chain.period.endYear;
}

/** Endjahr samt letztem Segment setzen und Wertehashes neu rechnen. @param {any} chain @param {number} year */
export function endjahrSetzen(chain, year) {
    chain.period.endYear = year;
    chain.segments[chain.segments.length - 1].endYear = year;
    chain.annualRateHash = sha256CanonicalCodepoint(chain.annualRates);
    chain.indexLevelHash = sha256CanonicalCodepoint(chain.indexLevels);
}

/** @param {any} chain @param {any} lieferung @returns {Record<string, number>} */
export function zeileBerechnen(chain, lieferung) {
    const rate = lieferung.werte.jahresrate;
    const level = inflationIndexstand(chain.indexLevels[lieferung.jahr - 1], rate);
    if (!(rate > -100) || !Number.isFinite(level) || !(level > 0)) throw new Error(`Inflationsrate ${rate} ergibt keinen gültigen Index.`);
    return { annualRates: rate, indexLevels: level };
}

/**
 * Gespeicherter Stand eines Jahres für Anschluss und alte Jahre: Rate aus der Kette, amtlicher Indexstand samt Basis
 * bei angehängten Jahren aus dem Fortschreibungsblock, im Grundbestand aus der festgeschriebenen Destatis-Jahrestabelle.
 * @param {any} chain @param {number} year @param {string} root
 */
export function gespeichert(chain, year, root) {
    const jahresrate = chain.annualRates[year];
    if (!Number.isFinite(jahresrate)) return null;
    const eintrag = chain.fortschreibung?.lieferungen?.find(item => item.jahr === year);
    if (eintrag) return { jahresrate, indexstand: eintrag.werte.indexstand, basis: { indexstand: eintrag.basis?.indexstand } };
    let indexstand;
    try {
        indexstand = extractCurrentDestatisValue(fs.readFileSync(path.join(root, ORIGINAL_HTML), 'utf8'), DESTATIS_LEVEL_TABLE.entryId, DESTATIS_LEVEL_TABLE.caption, year, failHard);
    } catch {
        indexstand = undefined;
    }
    return { jahresrate, indexstand, basis: { indexstand: indexstand === undefined ? undefined : GRUNDBESTAND_BASIS } };
}

/** @param {any} lieferung @returns {{regel: string, ok: boolean, text: string}[]} */
export function plausibilitaet(lieferung) {
    const { jahresrate, indexstand } = lieferung.werte;
    const vorjahr = lieferung.anschluss.werte.indexstand;
    const ausIndex = ((indexstand / vorjahr) - 1) * 100;
    const abstand = Math.abs(ausIndex - jahresrate);
    return [{
        regel: 'Index Y/Y−1 gegen Rate, Abstand höchstens 0,05',
        ok: abstand <= 0.05,
        text: `Index ${indexstand}/${vorjahr} ergibt ${ausIndex.toFixed(3)} %, gemeldet ${jahresrate} %, Abstand ${abstand.toFixed(3)}`
    }];
}

/**
 * Liest einen Jahreswert aus einer Destatis-Tabelle (Bauskript und Lieferung aus Original).
 * @param {string} html @param {string} entryId @param {string} expectedCaptionText @param {number} year
 * @param {(message: string, details?: object) => never} fail
 */
export function extractCurrentDestatisValue(html, entryId, expectedCaptionText, year, fail) {
    const table = destatisTable(html, entryId, expectedCaptionText, fail);
    const rowMatch = table.match(new RegExp(
        `<th[^>]*scope="row"[^>]*>${year}</th>[\\s\\S]*?<td>([^<]+)</td>`
    ));
    if (!rowMatch) fail('Destatis HTML annual value is missing', { entryId, year });
    const value = Number(rowMatch[1].trim().replace(',', '.'));
    if (!Number.isFinite(value)) fail('Destatis HTML annual value is invalid', {
        entryId,
        year,
        rawValue: rowMatch[1]
    });
    return value;
}

/** @param {string} html @param {string} entryId @param {string} expectedCaptionText @param {(message: string, details?: object) => never} fail */
function destatisTable(html, entryId, expectedCaptionText, fail) {
    const entryMarker = `<div class="c-toggle__entry" id="${entryId}">`;
    const entryIndex = html.indexOf(entryMarker);
    if (entryIndex < 0) fail('Destatis HTML table entry is missing', { entryId });
    const captionIndex = html.indexOf('<caption>Verbraucherpreisindex für Deutschland', entryIndex);
    const tableEndIndex = html.indexOf('</table>', captionIndex);
    if (captionIndex < 0 || tableEndIndex < 0) {
        fail('Destatis HTML total-index table is missing', { entryId });
    }
    const table = html.slice(captionIndex, tableEndIndex);
    if (!table.includes(expectedCaptionText)) {
        fail('Destatis HTML table caption is unexpected', { entryId, expectedCaptionText });
    }
    return table;
}

const failHard = (message, details) => { throw new Error(`${message} ${JSON.stringify(details ?? {})}`); };

/**
 * Lieferung Y aus der festgeschriebenen Destatis-Jahrestabelle (Rückwärtsprobe, offline).
 * @param {string} root @param {number} year
 */
export function lieferungAusOriginalen(root, year) {
    const original = fs.readFileSync(path.join(root, ORIGINAL_HTML));
    const html = original.toString('utf8');
    const read = (table, y) => extractCurrentDestatisValue(html, table.entryId, table.caption, y, failHard);
    const werteFuer = y => ({ jahresrate: read(DESTATIS_RATE_TABLE, y), indexstand: read(DESTATIS_LEVEL_TABLE, y) });
    const auszug = [DESTATIS_LEVEL_TABLE, DESTATIS_RATE_TABLE]
        .map(table => `${destatisTable(html, table.entryId, table.caption, failHard)}</table>\n`).join('');
    const chain = lesen(root);
    return lieferungBauen({
        kette: KETTE.id,
        jahr: year,
        werte: werteFuer(year),
        einheit: einheitenFuer(KETTE, werteFuer(year)),
        anschluss: { jahr: year - 1, werte: werteFuer(year - 1) },
        perioden: KETTE.periodenFuer(year),
        basis: { indexstand: GRUNDBESTAND_BASIS },
        quelle: {
            name: 'Destatis, Verbraucherpreisindex für Deutschland, Jahrestabelle',
            url: chain.sourceFiles.destatisCurrent.sourceUrl,
            abrufdatum: chain.sourceFiles.destatisCurrent.dataAsOf,
            veroeffentlichungsstand: chain.sourceFiles.destatisCurrent.dataAsOf
        },
        methode: 'aus Original: veröffentlichte Jahresrate und Jahresdurchschnitt aus der festgeschriebenen Destatis-Jahrestabelle',
        lieferant: 'skript',
        status: 'endgueltig',
        rohdateien: [{
            datei: 'rohauszug-destatis-vpi.html', inhalt: Buffer.from(auszug, 'utf8'), art: 'auszug',
            originalDatei: ORIGINAL_HTML, originalSha256: sha256(original)
        }]
    });
}
