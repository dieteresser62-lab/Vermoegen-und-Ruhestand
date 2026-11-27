/**
 * Kette Aktien (global-equity-research-chain): Rechenregel, Modultext und Lieferung aus den Originalen.
 *
 * Rechenregel Jahr Y (ab 2021): je Land OECD-Kursrendite Dezember Y−1 → Dezember Y plus eingefrorene
 * JST-Dividende 2020, mit EZB-Monatskursen Dezember in EUR umgerechnet, gewichtet mit den eingefrorenen
 * Gewichten 2020; Index Y = Index Y−1 × (1 + Rendite). Das Bauskript nutzt dieselben Funktionen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { jsonAusModul } from '../modultext.mjs';
import { sha256, sha256CanonicalCodepoint } from '../kanonisch.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';

const MODUL = 'app/simulator/global-equity-research-chain.js';
const START = 'export const GLOBAL_EQUITY_RESEARCH_CHAIN = deepFreezeGlobalEquityResearchData(';
const ENDE = ');\n\nexport const GLOBAL_EQUITY_RESEARCH_ANNUAL_RETURNS';
const DATEN = 'data/historical/global-equity-research-chain';
/** Abruf der festgeschriebenen OECD- und EZB-Originale laut README der Kette. */
const ABRUF_GRUNDBESTAND = '2026-07-29';

/** Länder und Währungen der Kette (Bauskript und Fortschreibung). */
export const COUNTRY_CURRENCIES = Object.freeze({
    AUS: 'AUD',
    BEL: 'EUR',
    CHE: 'CHF',
    DEU: 'EUR',
    DNK: 'DKK',
    ESP: 'EUR',
    FIN: 'EUR',
    FRA: 'EUR',
    GBR: 'GBP',
    ITA: 'EUR',
    JPN: 'JPY',
    NLD: 'EUR',
    NOR: 'NOK',
    PRT: 'EUR',
    SWE: 'SEK',
    USA: 'USD'
});
const ISOS = Object.freeze(Object.keys(COUNTRY_CURRENCIES));
const WAEHRUNGEN = Object.freeze([...new Set(Object.values(COUNTRY_CURRENCIES))].filter(code => code !== 'EUR').sort());

export const KETTE = Object.freeze({
    id: 'global-equity-research-chain',
    seriesId: 'global_equity_research_index',
    label: 'Aktien',
    dateien: Object.freeze([MODUL]),
    jahresfelder: Object.freeze(['countryCounts', 'annualReturns', 'indexLevels']),
    serienfeld: 'indexLevels',
    periodenFuer: jahr => Object.freeze({ werte: `${jahr}-12`, anschluss: `${jahr - 1}-12` }),
    werte: Object.freeze({ oecdDezember: { gruppe: ISOS, einheit: 'index' }, ezbDezember: { gruppe: WAEHRUNGEN, einheit: 'waehrung_je_eur' } }),
    beschreibung: Object.freeze({
        oecdDezember: 'OECD-Aktienkursindex je Land, Monatswert Dezember (Basis laut Quelle)',
        ezbDezember: 'EZB-Referenzkurs, Monatsdurchschnitt Dezember, Währungseinheiten je EUR'
    }),
    anschluss: Object.freeze({
        toleranz: Object.freeze({ oecdDezember: 0.00005, ezbDezember: 0.0000005 }),
        regel: 'Dezemberwerte Y−1 je Land und Währung gegen den gespeicherten Stand; Toleranz halbe letzte Stelle (Index 0,00005, Kurs 0,0000005)'
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
 * Build with: npm run build:global-equity-data
 *
 * The data values and adaptations derived from JST R6 are licensed under
 * CC BY-NC-SA 4.0. See data/historical/global-equity-research-chain/LICENSE.md.
 */
"use strict";

function deepFreezeGlobalEquityResearchData(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) deepFreezeGlobalEquityResearchData(child, seen);
    return Object.freeze(value);
}

export const GLOBAL_EQUITY_RESEARCH_CHAIN = deepFreezeGlobalEquityResearchData(${JSON.stringify(chain, null, 4)});

export const GLOBAL_EQUITY_RESEARCH_ANNUAL_RETURNS =
    GLOBAL_EQUITY_RESEARCH_CHAIN.annualReturns;

export const GLOBAL_EQUITY_RESEARCH_INDEX_LEVELS =
    GLOBAL_EQUITY_RESEARCH_CHAIN.indexLevels;
`]]);
}

/**
 * EUR-Rendite eines Landes (Bauskript und Fortschreibung).
 * @param {{oecdPrevious: number, oecdCurrent: number, dividendReturn: number, currencyPerEurPrevious: number, currencyPerEurCurrent: number}} input
 */
export function aktienLaenderRendite({ oecdPrevious, oecdCurrent, dividendReturn, currencyPerEurPrevious, currencyPerEurCurrent }) {
    const priceReturn = (
        oecdCurrent
        / oecdPrevious
        - 1
    );
    const totalReturnProxy = priceReturn + dividendReturn;
    return (
        (1 + totalReturnProxy)
        * currencyPerEurPrevious
        / currencyPerEurCurrent
        - 1
    );
}

/**
 * Gewichtete Jahresrendite über die Länder in fester Reihenfolge (Bauskript und Fortschreibung).
 * @param {readonly string[]} isos @param {Record<string, number>} weights @param {(iso: string) => number} countryReturn
 */
export function aktienJahresrendite(isos, weights, countryReturn) {
    return isos.reduce((total, iso) => total + countryReturn(iso) * weights[iso], 0);
}

/** @param {number} previousLevel @param {number} annualReturn */
export function aktienIndexstand(previousLevel, annualReturn) {
    return previousLevel * (1 + annualReturn);
}

/** @param {any} chain @returns {number} */
export function endjahr(chain) {
    return chain.period.endYear;
}

/** @param {any} chain @param {number} year */
export function endjahrSetzen(chain, year) {
    chain.period.endYear = year;
    chain.segments[chain.segments.length - 1].endYear = year;
    chain.annualReturnHash = sha256CanonicalCodepoint(chain.annualReturns);
    chain.indexLevelHash = sha256CanonicalCodepoint(chain.indexLevels);
}

/** @param {any} chain @param {any} werte Dezember Y @param {any} vorjahr Dezember Y−1 @returns {Record<string, number>} EUR-Rendite je Land. */
function laenderRenditen(chain, werte, vorjahr) {
    const kurs = (iso, satz) => (COUNTRY_CURRENCIES[iso] === 'EUR' ? 1 : satz.ezbDezember[COUNTRY_CURRENCIES[iso]]);
    return Object.fromEntries(chain.countryUniverse.map(iso => [iso, aktienLaenderRendite({
        oecdPrevious: vorjahr.oecdDezember[iso],
        oecdCurrent: werte.oecdDezember[iso],
        dividendReturn: chain.dividendProxyByIso[iso],
        currencyPerEurPrevious: kurs(iso, vorjahr),
        currencyPerEurCurrent: kurs(iso, werte)
    })]));
}

/** @param {any} chain @param {any} lieferung @returns {Record<string, number>} */
export function zeileBerechnen(chain, lieferung) {
    const renditen = laenderRenditen(chain, lieferung.werte, lieferung.anschluss.werte);
    for (const [iso, value] of Object.entries(renditen)) {
        if (!(value > -1)) throw new Error(`Aktienrendite ${iso} muss über −100 % liegen (${value}).`);
    }
    const annualReturn = aktienJahresrendite(chain.countryUniverse, chain.modernWeights, iso => renditen[iso]);
    const level = aktienIndexstand(chain.indexLevels[lieferung.jahr - 1], annualReturn);
    if (!(annualReturn > -1) || !Number.isFinite(level) || !(level > 0)) throw new Error(`Aktienrendite ${annualReturn} ist ungültig.`);
    return { countryCounts: chain.countryUniverse.length, annualReturns: annualReturn, indexLevels: level };
}

/** CSV-Zeile mit Anführungszeichen wie im Bauskript. @param {string} line @returns {string[]} */
function csvFelder(line) {
    const values = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"') {
            if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted;
        } else if (character === ',' && !quoted) {
            values.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    values.push(current);
    return values;
}

/** @param {string} text @returns {Record<string, string>[]} */
function csvZeilen(text) {
    const [kopf, ...zeilen] = text.replace(/^﻿/, '').trim().split(/\r?\n/);
    const spalten = csvFelder(kopf);
    return zeilen.map(zeile => Object.fromEntries(csvFelder(zeile).map((wert, index) => [spalten[index], wert])));
}

/**
 * Gespeicherter Stand eines Jahres: angehängte Jahre aus dem Fortschreibungsblock, sonst die
 * gefilterten Eingaben des Grundbestands.
 * @param {any} chain @param {number} year @param {string} root
 */
export function gespeichert(chain, year, root) {
    const eintrag = chain.fortschreibung?.lieferungen?.find(item => item.jahr === year);
    if (eintrag) return { oecdDezember: eintrag.werte.oecdDezember, ezbDezember: eintrag.werte.ezbDezember };
    const periode = `${year}-12`;
    const oecd = csvZeilen(fs.readFileSync(path.join(root, DATEN, 'oecd-share-price-inputs.csv'), 'utf8')).filter(row => row.time_period === periode);
    const ezb = csvZeilen(fs.readFileSync(path.join(root, DATEN, 'ecb-exr-inputs.csv'), 'utf8')).filter(row => row.time_period === periode);
    if (!oecd.length || !ezb.length) return null;
    return {
        oecdDezember: Object.fromEntries(oecd.filter(row => ISOS.includes(row.iso)).map(row => [row.iso, Number(row.obs_value)])),
        ezbDezember: Object.fromEntries(ezb.filter(row => WAEHRUNGEN.includes(row.currency)).map(row => [row.currency, Number(row.obs_value)]))
    };
}

/** @param {any} lieferung @param {any} chain @returns {{regel: string, ok: boolean, text: string}[]} */
export function plausibilitaet(lieferung, chain) {
    const renditen = laenderRenditen(chain, lieferung.werte, lieferung.anschluss.werte);
    const ausreisser = Object.entries(renditen).filter(([, value]) => !(value >= -0.6 && value <= 1));
    const gesamt = aktienJahresrendite(chain.countryUniverse, chain.modernWeights, iso => renditen[iso]);
    const prozent = value => `${(value * 100).toFixed(1)} %`;
    return [
        {
            regel: 'je Land −60 bis +100 %',
            ok: ausreisser.length === 0,
            text: ausreisser.length ? `außerhalb: ${ausreisser.map(([iso, value]) => `${iso} ${prozent(value)}`).join(', ')}` : 'alle Länder im Rahmen'
        },
        { regel: 'gesamt in EUR −50 bis +60 %', ok: gesamt >= -0.5 && gesamt <= 0.6, text: `gesamt ${prozent(gesamt)}` }
    ];
}

/**
 * Lieferung Y aus den festgeschriebenen OECD- und EZB-Originalen (Rückwärtsprobe, offline).
 * @param {string} root @param {number} year
 */
export function lieferungAusOriginalen(root, year) {
    const chain = lesen(root);
    const quellen = { oecd: chain.sourceFiles.oecd, ecb: chain.sourceFiles.ecb };
    const originale = Object.fromEntries(Object.entries(quellen).map(([id, quelle]) => [id, fs.readFileSync(path.join(root, DATEN, 'originals', quelle.originalFileName))]));
    const perioden = [`${year - 1}-12`, `${year}-12`];
    const auszug = (bytes, schluessel, passt) => {
        const [kopf, ...zeilen] = bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
        const spalten = csvFelder(kopf);
        const index = Object.fromEntries(schluessel.map(name => [name, spalten.indexOf(name)]));
        const treffer = zeilen.map(zeile => ({ zeile, felder: csvFelder(zeile) }))
            .filter(({ felder }) => passt(Object.fromEntries(schluessel.map(name => [name, felder[index[name]]]))));
        return { text: [kopf, ...treffer.map(item => item.zeile)].join('\n') + '\n', zeilen: treffer.map(({ felder }) => Object.fromEntries(schluessel.map(name => [name, felder[index[name]]]))) };
    };
    const oecd = auszug(originale.oecd, ['REF_AREA', 'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS'], row => ISOS.includes(row.REF_AREA) && perioden.includes(row.TIME_PERIOD));
    const ezb = auszug(originale.ecb, ['CURRENCY', 'TIME_PERIOD', 'OBS_VALUE', 'OBS_STATUS'], row => WAEHRUNGEN.includes(row.CURRENCY) && perioden.includes(row.TIME_PERIOD));
    const vorlaeufig = [...oecd.zeilen, ...ezb.zeilen].some(row => row.OBS_STATUS !== 'A');
    const werteFuer = periode => ({
        oecdDezember: Object.fromEntries(ISOS.map(iso => [iso, Number(oecd.zeilen.find(row => row.REF_AREA === iso && row.TIME_PERIOD === periode)?.OBS_VALUE)])),
        ezbDezember: Object.fromEntries(WAEHRUNGEN.map(code => [code, Number(ezb.zeilen.find(row => row.CURRENCY === code && row.TIME_PERIOD === periode)?.OBS_VALUE)]))
    });
    return lieferungBauen({
        kette: KETTE.id,
        jahr: year,
        werte: werteFuer(perioden[1]),
        einheit: einheitenFuer(KETTE, werteFuer(perioden[1])),
        anschluss: { jahr: year - 1, werte: werteFuer(perioden[0]) },
        perioden: KETTE.periodenFuer(year),
        quelle: {
            name: 'OECD Share prices (DF_FINMARK) und EZB-Referenzkurse (EXR), Monatswerte',
            url: quellen.oecd.sourceUrl,
            abrufdatum: ABRUF_GRUNDBESTAND,
            veroeffentlichungsstand: `OECD ${quellen.oecd.originalFileName}, EZB ${quellen.ecb.originalFileName} (Stand der festgeschriebenen Originale)`
        },
        methode: 'aus Original: Dezemberwerte aus den festgeschriebenen OECD- und EZB-Monatsdateien',
        lieferant: 'skript',
        status: vorlaeufig ? 'vorlaeufig' : 'endgueltig',
        rohdateien: [
            { datei: 'rohauszug-oecd.csv', inhalt: Buffer.from(oecd.text, 'utf8'), art: 'auszug', originalDatei: `${DATEN}/originals/${quellen.oecd.originalFileName}`, originalSha256: sha256(originale.oecd) },
            { datei: 'rohauszug-ezb.csv', inhalt: Buffer.from(ezb.text, 'utf8'), art: 'auszug', originalDatei: `${DATEN}/originals/${quellen.ecb.originalFileName}`, originalSha256: sha256(originale.ecb) }
        ]
    });
}
