/**
 * Jahreslieferung: Format, Validator, Lesen und Schreiben.
 *
 * Eine Lieferung liegt je Kette und Jahr unter data/historical/<kette>/jahre/<Jahr>/:
 * - lieferung.json nach LIEFERUNG_SCHEMA,
 * - daneben die Rohantwort(en) der Quelle; ihr SHA-256 steht in lieferung.json (`rohdaten`).
 *   Bei CAPE ist das nur ein Auszug der benötigten Zeilen, dazu der SHA-256 der Originaldatei.
 *
 * Skript, Agent und Mensch legen dieselbe Datei an (`lieferant`: skript | agent | hand). `--pruefen`
 * behandelt alle gleich. Die Felder in `werte` bestimmt die Kette (scripts/lib/jahresdaten/ketten/*.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './kanonisch.mjs';

export const LIEFERUNG_SCHEMA_ID = 'Jahreslieferung-1';
export const LIEFERUNG_DATEI = 'lieferung.json';
export const LIEFERANTEN = Object.freeze(['skript', 'agent', 'hand']);
export const STATUS = Object.freeze(['endgueltig', 'vorlaeufig']);
/** Maschinenprüfbare Einheitenkennungen je Feld. Eine abweichende Einheit ist rot; Lieferungen werden nie umgerechnet. */
export const EINHEITEN = Object.freeze(['prozent', 'dezimal', 'index', 'eur', 'usd', 'usd_je_eur', 'waehrung_je_eur', 'usd_je_unze', 'verhaeltnis']);

const DATUM = '^\\d{4}-\\d{2}-\\d{2}$';
const SHA256 = '^[a-f0-9]{64}$';

/** JSON-Schema (Draft 2020-12) der Datei lieferung.json; `werte` beschreibt je Kette WERTE_FELDER. */
export const LIEFERUNG_SCHEMA = Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: LIEFERUNG_SCHEMA_ID,
    title: 'Jahreslieferung einer historischen Kette',
    type: 'object',
    additionalProperties: false,
    required: ['schema', 'kette', 'jahr', 'perioden', 'werte', 'einheit', 'anschluss', 'quelle', 'methode', 'lieferant', 'status', 'rohdaten'],
    properties: {
        schema: { const: LIEFERUNG_SCHEMA_ID },
        kette: { type: 'string', description: 'Ordnername unter data/historical/, z. B. german-cpi-chain' },
        jahr: { type: 'integer', description: 'Datenjahr Y' },
        perioden: {
            type: 'object', additionalProperties: false, required: ['werte', 'anschluss'],
            description: 'Beobachtungsperioden der Werte und des Anschlusses, z. B. 2026 und 2025 oder 2026-12 und 2025-12; je Kette festgelegt',
            properties: { werte: { type: 'string', pattern: '^\\d{4}(-\\d{2})?$' }, anschluss: { type: 'string', pattern: '^\\d{4}(-\\d{2})?$' } }
        },
        werte: { type: 'object', description: 'Eingangswerte der Rechenregel für Y; Felder je Kette' },
        basis: { type: 'object', description: 'Indexbasis je Indexfeld, z. B. {"indexstand": "2020=100"}; gilt für Werte und Anschluss', additionalProperties: { type: 'string', pattern: '^\\d{4}=100$' } },
        einheit: { type: 'object', description: 'Einheitenkennung je Feld in werte; muss der Kette entsprechen', additionalProperties: { enum: EINHEITEN } },
        anschluss: {
            type: 'object', additionalProperties: false, required: ['jahr', 'werte'],
            properties: { jahr: { type: 'integer', description: 'Y−1' }, werte: { type: 'object', description: 'dieselben Felder für Y−1' } }
        },
        quelle: {
            type: 'object', additionalProperties: false, required: ['name', 'url', 'abrufdatum', 'veroeffentlichungsstand'],
            properties: {
                name: { type: 'string' },
                url: { type: 'string', pattern: '^https?://' },
                abrufdatum: { type: 'string', pattern: DATUM },
                veroeffentlichungsstand: { type: 'string', minLength: 1 }
            }
        },
        methode: { type: 'string', minLength: 1 },
        lieferant: { enum: LIEFERANTEN },
        status: { enum: STATUS },
        rohdaten: {
            type: 'array', minItems: 1,
            items: {
                type: 'object', additionalProperties: false, required: ['datei', 'sha256'],
                properties: {
                    datei: { type: 'string', pattern: '^[A-Za-z0-9._-]+$' },
                    sha256: { type: 'string', pattern: SHA256 },
                    art: { enum: ['antwort', 'auszug'] },
                    originalDatei: { type: 'string' },
                    originalSha256: { type: 'string', pattern: SHA256 }
                }
            }
        },
        alteJahre: { type: 'object', description: 'optional: von der Quelle gemeldete Werte früherer Jahre, nur für den Bericht' },
        hinweis: { type: 'string' }
    }
});

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Prüft Werte gegen die Felder einer Kette. Ein Feld ist eine Zahl oder eine Gruppe benannter Zahlen.
 * @param {unknown} werte
 * @param {Record<string, {gruppe?: readonly string[], optional?: boolean, einheit?: string}>} felder
 * @param {string} label
 * @returns {string[]} Fehler.
 */
export function werteFehler(werte, felder, label) {
    if (!isObject(werte)) return [`${label} fehlt oder ist kein Objekt`];
    const fehler = [];
    for (const [feld, spec] of Object.entries(felder)) {
        const value = werte[feld];
        if (value === undefined && spec.optional) continue;
        if (spec.gruppe) {
            if (!isObject(value)) { fehler.push(`${label}.${feld} fehlt`); continue; }
            for (const key of spec.gruppe) {
                if (!Number.isFinite(value[key])) fehler.push(`${label}.${feld}.${key} fehlt oder ist nicht endlich`);
            }
        } else if (!Number.isFinite(value)) {
            fehler.push(`${label}.${feld} fehlt oder ist nicht endlich`);
        }
    }
    for (const feld of Object.keys(werte)) if (!(feld in felder)) fehler.push(`${label}.${feld} ist kein Feld dieser Kette`);
    return fehler;
}

/** @param {Record<string, any>} object @param {Record<string, any>} schema @param {string} label @returns {string[]} */
function objektFehler(object, schema, label) {
    const fehler = [];
    for (const key of schema.required ?? []) if (object[key] === undefined) fehler.push(`${label}.${key} fehlt`);
    if (schema.additionalProperties === false) {
        for (const key of Object.keys(object)) if (!(key in schema.properties)) fehler.push(`${label}.${key} ist nicht vorgesehen`);
    }
    for (const [key, spec] of Object.entries(schema.properties ?? {})) {
        const value = object[key];
        if (value === undefined) continue;
        if (spec.const !== undefined && value !== spec.const) fehler.push(`${label}.${key} muss ${spec.const} sein`);
        if (spec.enum && !spec.enum.includes(value)) fehler.push(`${label}.${key} muss eines von ${spec.enum.join(', ')} sein`);
        if (spec.type === 'integer' && !Number.isInteger(value)) fehler.push(`${label}.${key} muss eine ganze Zahl sein`);
        if (spec.type === 'string' && typeof value !== 'string') fehler.push(`${label}.${key} muss Text sein`);
        if (typeof value === 'string' && spec.pattern && !new RegExp(spec.pattern).test(value)) fehler.push(`${label}.${key} hat kein gültiges Format`);
        if (typeof value === 'string' && spec.minLength && value.length < spec.minLength) fehler.push(`${label}.${key} ist leer`);
        if (spec.type === 'object') {
            if (!isObject(value)) fehler.push(`${label}.${key} muss ein Objekt sein`);
            else if (spec.properties) fehler.push(...objektFehler(value, spec, `${label}.${key}`));
        }
        if (spec.type === 'array') {
            if (!Array.isArray(value) || value.length < (spec.minItems ?? 0)) fehler.push(`${label}.${key} braucht mindestens ${spec.minItems ?? 0} Eintrag`);
            else value.forEach((item, index) => {
                if (!isObject(item)) fehler.push(`${label}.${key}[${index}] muss ein Objekt sein`);
                else fehler.push(...objektFehler(item, spec.items, `${label}.${key}[${index}]`));
            });
        }
    }
    return fehler;
}

/**
 * Validiert eine Lieferung gegen Schema und Kettenfelder.
 * @param {unknown} lieferung
 * @param {{id: string, werte: Record<string, {gruppe?: readonly string[], optional?: boolean, einheit?: string, basis?: boolean}>,
 *   periodenFuer?: (jahr: number) => {werte: string, anschluss: string}}} kette
 * @param {number} jahr Erwartetes Jahr.
 * @returns {string[]} Fehler; leer, wenn gültig.
 */
export function lieferungFehler(lieferung, kette, jahr) {
    if (!isObject(lieferung)) return ['lieferung.json ist kein Objekt'];
    const fehler = objektFehler(lieferung, LIEFERUNG_SCHEMA, 'lieferung');
    if (lieferung.kette !== undefined && lieferung.kette !== kette.id) fehler.push(`lieferung.kette ist ${lieferung.kette}, erwartet ${kette.id}`);
    if (Number.isInteger(lieferung.jahr) && lieferung.jahr !== jahr) fehler.push(`lieferung.jahr ist ${lieferung.jahr}, erwartet ${jahr}`);
    fehler.push(...werteFehler(lieferung.werte, kette.werte, 'werte'));
    if (isObject(lieferung.anschluss)) {
        if (Number.isInteger(lieferung.anschluss.jahr) && lieferung.anschluss.jahr !== jahr - 1) {
            fehler.push(`anschluss.jahr ist ${lieferung.anschluss.jahr}, erwartet ${jahr - 1}`);
        }
        fehler.push(...werteFehler(lieferung.anschluss.werte, kette.werte, 'anschluss.werte'));
    }
    if (isObject(lieferung.einheit)) fehler.push(...einheitFehler(lieferung, kette));
    if (isObject(lieferung.perioden) && typeof kette.periodenFuer === 'function') {
        const soll = kette.periodenFuer(jahr);
        for (const teil of ['werte', 'anschluss']) {
            if (lieferung.perioden[teil] !== undefined && lieferung.perioden[teil] !== soll[teil]) {
                fehler.push(`perioden.${teil} ist ${lieferung.perioden[teil]}, erwartet ${soll[teil]} (Beobachtungsperiode passt nicht zum Lieferjahr ${jahr})`);
            }
        }
    }
    for (const [feld, spec] of Object.entries(kette.werte)) {
        if (!spec.basis || lieferung.werte?.[feld] === undefined) continue;
        if (!/^\d{4}=100$/.test(lieferung.basis?.[feld] ?? '')) fehler.push(`basis.${feld} fehlt oder hat nicht die Form JJJJ=100`);
    }
    if (lieferung.alteJahre !== undefined) {
        if (!isObject(lieferung.alteJahre)) fehler.push('alteJahre muss ein Objekt sein');
        else for (const [year, werte] of Object.entries(lieferung.alteJahre)) {
            if (!/^\d{4}$/.test(year) || Number(year) >= jahr) fehler.push(`alteJahre.${year} ist kein früheres Jahr`);
            if (!isObject(werte)) fehler.push(`alteJahre.${year} muss ein Objekt sein`);
        }
    }
    return fehler;
}

/**
 * Einheitenkennung je geliefertem Feld gegen die Kette: fehlt, unbekannt oder abweichend ist ein Fehler (rot).
 * @param {any} lieferung @param {{werte: Record<string, {einheit?: string}>}} kette @returns {string[]}
 */
function einheitFehler(lieferung, kette) {
    const fehler = [];
    for (const [feld, spec] of Object.entries(kette.werte)) {
        if (lieferung.werte?.[feld] === undefined) continue;
        const code = lieferung.einheit[feld];
        if (code === undefined) fehler.push(`einheit.${feld} fehlt`);
        else if (!EINHEITEN.includes(code)) fehler.push(`einheit.${feld} ist keine Einheitenkennung (${EINHEITEN.join(', ')})`);
        else if (code !== spec.einheit) fehler.push(`einheit.${feld} ist ${code}, erwartet ${spec.einheit}; Lieferungen werden nicht umgerechnet`);
    }
    for (const feld of Object.keys(lieferung.einheit)) if (lieferung.werte?.[feld] === undefined) fehler.push(`einheit.${feld} hat keinen Wert`);
    return fehler;
}

/**
 * Einheitenkennungen der Kette für die gelieferten Felder.
 * @param {{werte: Record<string, {einheit: string}>}} kette @param {Record<string, unknown>} werte
 */
export function einheitenFuer(kette, werte) {
    return Object.fromEntries(Object.keys(werte).map(feld => [feld, kette.werte[feld].einheit]));
}

/** @param {string} root @param {string} ketteId @param {number} jahr @returns {string} Ordner der Lieferung. */
export function lieferungsOrdner(root, ketteId, jahr) {
    return path.join(root, 'data', 'historical', ketteId, 'jahre', String(jahr));
}

/**
 * Liest eine Lieferung samt SHA-256 und prüft die Rohdateien.
 * @param {string} root @param {{id: string}} kette @param {number} jahr
 * @returns {{vorhanden: false} | {vorhanden: true, lieferung: any, sha256: string, rohdatenFehler: string[], lesefehler?: string}}
 */
export function lieferungLesen(root, kette, jahr) {
    const ordner = lieferungsOrdner(root, kette.id, jahr);
    const datei = path.join(ordner, LIEFERUNG_DATEI);
    if (!fs.existsSync(datei)) return { vorhanden: false };
    const bytes = fs.readFileSync(datei);
    const result = { vorhanden: /** @type {const} */ (true), lieferung: null, sha256: sha256(bytes), rohdatenFehler: [] };
    try {
        result.lieferung = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
        return { ...result, lesefehler: `lieferung.json ist kein gültiges JSON (${error.message})` };
    }
    for (const eintrag of Array.isArray(result.lieferung?.rohdaten) ? result.lieferung.rohdaten : []) {
        const name = typeof eintrag?.datei === 'string' ? eintrag.datei : '';
        const rohdatei = path.join(ordner, name);
        if (!/^[A-Za-z0-9._-]+$/.test(name) || name === LIEFERUNG_DATEI) result.rohdatenFehler.push(`Rohdatei ${name || '(ohne Namen)'} ist unzulässig`);
        else if (!fs.existsSync(rohdatei)) result.rohdatenFehler.push(`Rohdatei ${name} fehlt`);
        else if (sha256(fs.readFileSync(rohdatei)) !== eintrag.sha256) result.rohdatenFehler.push(`Rohdatei ${name}: SHA-256 passt nicht zur Lieferung`);
    }
    return result;
}

/**
 * Baut eine Lieferung mit Rohdateien; die SHA-256 der Rohdateien werden eingetragen.
 * @param {Omit<Record<string, any>, 'rohdaten'> & {rohdateien: {datei: string, inhalt: Buffer, art?: string, originalDatei?: string, originalSha256?: string}[]}} input
 * @returns {{lieferung: Record<string, any>, dateien: Map<string, Buffer>}}
 */
export function lieferungBauen({ rohdateien, ...felder }) {
    const rohdaten = rohdateien.map(({ datei, inhalt, art, originalDatei, originalSha256 }) => ({
        datei, sha256: sha256(inhalt), ...(art ? { art } : {}),
        ...(originalDatei ? { originalDatei } : {}), ...(originalSha256 ? { originalSha256 } : {})
    }));
    const lieferung = { schema: LIEFERUNG_SCHEMA_ID, ...felder, rohdaten };
    const dateien = new Map(rohdateien.map(({ datei, inhalt }) => [datei, inhalt]));
    dateien.set(LIEFERUNG_DATEI, Buffer.from(`${JSON.stringify(lieferung, null, 2)}\n`, 'utf8'));
    return { lieferung, dateien };
}

/** @param {string} root @param {string} ketteId @param {number} jahr @param {Map<string, Buffer>} dateien @returns {string[]} geschriebene Pfade. */
export function lieferungSchreiben(root, ketteId, jahr, dateien) {
    const ordner = lieferungsOrdner(root, ketteId, jahr);
    fs.mkdirSync(ordner, { recursive: true });
    return [...dateien].map(([name, inhalt]) => {
        fs.writeFileSync(path.join(ordner, name), inhalt);
        return path.relative(root, path.join(ordner, name));
    });
}
