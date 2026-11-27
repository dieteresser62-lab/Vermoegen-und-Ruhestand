/**
 * Register der amtlichen Jahreswerte (data/jahreswerte.json): laden, gegen den Code prüfen, Fälligkeit bestimmen.
 * `npm run jahreswerte:pruefen` und die Liveprobe `npm run probe:jahreswechsel` nutzen es. Die App liest es nicht.
 */
import fs from 'node:fs';
import path from 'node:path';

export const REGISTER_DATEI = 'data/jahreswerte.json';
export const REGISTER_SCHEMA = 'Jahreswerte-1';
const DATUM = /^\d{4}-\d{2}(-\d{2})?$/;

/** @param {string} root @returns {any} */
export function registerLesen(root) {
    return JSON.parse(fs.readFileSync(path.join(root, REGISTER_DATEI), 'utf8'));
}

/** JJJJ-MM oder JJJJ-MM-TT als UTC-Datum; JJJJ-MM gilt ab dem Ersten. @param {string} text */
function datum(text) {
    const [jahr, monat, tag = 1] = text.split('-').map(Number);
    return new Date(Date.UTC(jahr, monat - 1, tag));
}

const iso = value => value.toISOString().slice(0, 10);

/**
 * Formfehler des Registers und Orte, deren Suchtext im Code fehlt.
 * @param {any} register @param {string} root @returns {string[]}
 */
export function registerFehler(register, root) {
    const fehler = [];
    if (register?.schema !== REGISTER_SCHEMA) fehler.push(`schema muss ${REGISTER_SCHEMA} sein`);
    const gruppen = Array.isArray(register?.gruppen) ? register.gruppen : [];
    if (!gruppen.length) fehler.push('gruppen fehlt');
    const ids = new Set();
    for (const gruppe of gruppen) {
        const label = gruppe?.id ?? '(ohne id)';
        if (ids.has(label)) fehler.push(`${label}: id doppelt`);
        ids.add(label);
        for (const feld of ['id', 'name', 'stand', 'gueltigAb', 'rhythmus']) if (typeof gruppe?.[feld] !== 'string' || !gruppe[feld]) fehler.push(`${label}: ${feld} fehlt`);
        if (typeof gruppe?.gueltigAb === 'string' && !DATUM.test(gruppe.gueltigAb)) fehler.push(`${label}: gueltigAb muss JJJJ-MM oder JJJJ-MM-TT sein`);
        if (!/^https:\/\//.test(gruppe?.quelle?.url ?? '') || !gruppe?.quelle?.name) fehler.push(`${label}: quelle braucht name und https-URL`);
        if (gruppe?.rhythmusMonate !== null && !(Number.isInteger(gruppe?.rhythmusMonate) && gruppe.rhythmusMonate > 0)) fehler.push(`${label}: rhythmusMonate muss eine positive ganze Zahl oder null sein`);
        if (!(Number.isInteger(gruppe?.vorlaufTage) && gruppe.vorlaufTage >= 0)) fehler.push(`${label}: vorlaufTage fehlt`);
        if (!Array.isArray(gruppe?.orte) || !gruppe.orte.length) fehler.push(`${label}: orte fehlt`);
        for (const ort of gruppe?.orte ?? []) {
            const datei = path.join(root, ort?.datei ?? '');
            if (!ort?.datei || !fs.existsSync(datei)) fehler.push(`${label}: Datei ${ort?.datei} fehlt`);
            else if (!ort.suchtext || !fs.readFileSync(datei, 'utf8').includes(ort.suchtext)) fehler.push(`${label}: Suchtext „${ort.suchtext}“ steht nicht in ${ort.datei}`);
        }
    }
    return fehler;
}

/**
 * Fälligkeit je Gruppe zum Stichtag.
 * @param {any} register @param {string} heute JJJJ-MM-TT
 * @returns {{id: string, name: string, stand: string, gueltigAb: string, rhythmus: string, faellig: string | null, status: 'ueberfaellig' | 'demnaechst' | 'aktuell' | 'ohne Rhythmus', quelle: any, orte: any[], hinweis?: string}[]}
 */
export function faelligkeiten(register, heute) {
    const stichtag = datum(heute);
    return register.gruppen.map(gruppe => {
        const basis = { id: gruppe.id, name: gruppe.name, stand: gruppe.stand, gueltigAb: gruppe.gueltigAb, rhythmus: gruppe.rhythmus,
            quelle: gruppe.quelle, orte: gruppe.orte, ...(gruppe.hinweis ? { hinweis: gruppe.hinweis } : {}) };
        if (gruppe.rhythmusMonate === null) return { ...basis, faellig: null, status: 'ohne Rhythmus' };
        const start = datum(gruppe.gueltigAb);
        const faellig = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + gruppe.rhythmusMonate, start.getUTCDate()));
        const ab = new Date(faellig.getTime() - gruppe.vorlaufTage * 86_400_000);
        const status = stichtag >= faellig ? 'ueberfaellig' : stichtag >= ab ? 'demnaechst' : 'aktuell';
        return { ...basis, faellig: iso(faellig), status };
    });
}

const STATUS_TEXT = { ueberfaellig: 'ÜBERFÄLLIG', demnaechst: 'demnächst', aktuell: 'aktuell', 'ohne Rhythmus': 'ohne Rhythmus' };
const REIHENFOLGE = ['ueberfaellig', 'demnaechst', 'aktuell', 'ohne Rhythmus'];

/** Textausgabe, Überfälliges zuerst. @param {ReturnType<typeof faelligkeiten>} liste @param {string} heute @returns {string[]} */
export function faelligkeitenText(liste, heute) {
    const sortiert = [...liste].sort((a, b) => REIHENFOLGE.indexOf(a.status) - REIHENFOLGE.indexOf(b.status) || String(a.faellig).localeCompare(String(b.faellig)));
    const zaehlen = status => liste.filter(item => item.status === status).length;
    const zeilen = [`Amtliche Jahreswerte am ${heute}: ${zaehlen('ueberfaellig')} überfällig, ${zaehlen('demnaechst')} demnächst, ${zaehlen('aktuell')} aktuell, ${zaehlen('ohne Rhythmus')} ohne Rhythmus`];
    for (const item of sortiert) {
        zeilen.push(`  ${STATUS_TEXT[item.status]}: ${item.name}, Stand ${item.stand} (gilt ab ${item.gueltigAb})${item.faellig ? `, neuer Stand fällig ${item.faellig}` : ''}; ${item.rhythmus}`);
        if (item.status === 'ueberfaellig' || item.status === 'demnaechst') {
            zeilen.push(`    Quelle: ${item.quelle.name}, ${item.quelle.url}`);
            zeilen.push(`    Im Code: ${item.orte.map(ort => ort.datei).join(', ')}`);
            if (item.hinweis) zeilen.push(`    Hinweis: ${item.hinweis}`);
        }
    }
    return zeilen;
}
