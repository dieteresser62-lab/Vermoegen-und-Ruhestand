/**
 * Netzabruf für die Jahresdaten-Leser (`npm run jahresdaten -- <Jahr> --holen`).
 *
 * Nur öffentliche Endpunkte aus dem Ideengespräch vom 16.11.2026: OECD, EZB, Bundesbank, Weltbank, shillerdata.com
 * (samt dem dort verlinkten Dateispeicher img1.wsimg.com) und Destatis. Keine Zugangsdaten, keine Nutzerdaten,
 * kein GENESIS-Konto. Weiterleitungen folgt der Abruf von Hand, damit jede angesprochene Adresse geprüft wird.
 * Tests rufen nie das Netz: Jeder Leser bekommt die Abruffunktion übergeben und die Tests geben gespeicherte Antworten.
 */

export const ERLAUBTE_HOSTS = Object.freeze([
    'sdmx.oecd.org',
    'data-api.ecb.europa.eu',
    'api.statistiken.bundesbank.de',
    'thedocs.worldbank.org',
    'shillerdata.com',
    'www.shillerdata.com',
    'img1.wsimg.com',
    'www.destatis.de'
]);

const ZEITLIMIT_MS = 90_000;
const HOECHSTENS_BYTES = 32 * 1024 * 1024;
const WEITERLEITUNGEN = 4;

/** Fehler eines Abrufs; der Leser macht daraus eine offene Lieferung. */
export class AbrufFehler extends Error {
    /** @param {string} message @param {{url: string, status?: number}} details */
    constructor(message, details) {
        super(message);
        this.name = 'AbrufFehler';
        this.url = details.url;
        this.status = details.status ?? null;
    }
}

/** @param {string} adresse @returns {URL} */
export function erlaubteAdresse(adresse) {
    const url = new URL(adresse);
    if (url.protocol !== 'https:' || !ERLAUBTE_HOSTS.includes(url.hostname) || url.username || url.password) {
        throw new AbrufFehler(`Adresse ist für den Jahresdatenabruf nicht freigegeben: ${url.origin}`, { url: adresse });
    }
    return url;
}

/**
 * @typedef {{url: string, status: number, bytes: Buffer, text: () => string, kopf: Record<string, string>, abgerufen: string}} Antwort
 * @typedef {(adresse: string) => Promise<Antwort>} Abruf
 */

/**
 * Ruft eine freigegebene Adresse ab. Ein Serverfehler (HTTP 5xx) wird einmal nach kurzer Pause wiederholt; die OECD
 * antwortete am 17.11.2026 zeitweise mit HTTP 500. Fehlerstatus, fremde Weiterleitung, Zeitlimit oder Übergröße werfen AbrufFehler.
 * @param {string} adresse @param {{fetchImpl?: typeof fetch, pauseMs?: number}} [optionen] @returns {Promise<Antwort>}
 */
export async function netzAbruf(adresse, { fetchImpl = globalThis.fetch, pauseMs = 3000 } = {}) {
    try {
        return await einmalAbrufen(adresse, fetchImpl);
    } catch (error) {
        if (!(error instanceof AbrufFehler) || !(error.status >= 500)) throw error;
        await new Promise(resolve => setTimeout(resolve, pauseMs));
        return einmalAbrufen(adresse, fetchImpl);
    }
}

/** @param {string} adresse @param {typeof fetch} fetchImpl @returns {Promise<Antwort>} */
async function einmalAbrufen(adresse, fetchImpl) {
    let url = erlaubteAdresse(adresse);
    const signal = AbortSignal.timeout(ZEITLIMIT_MS);
    for (let schritt = 0; schritt <= WEITERLEITUNGEN; schritt += 1) {
        let response;
        try {
            response = await fetchImpl(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'jahresdaten-skript', Accept: '*/*' } });
        } catch (error) {
            throw new AbrufFehler(`Abruf gescheitert: ${error?.message ?? error}`, { url: url.href });
        }
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            await response.body?.cancel();
            url = erlaubteAdresse(new URL(response.headers.get('location'), url).href);
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new AbrufFehler(`HTTP ${response.status}`, { url: url.href, status: response.status });
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > HOECHSTENS_BYTES) throw new AbrufFehler(`Antwort größer als ${HOECHSTENS_BYTES} Bytes`, { url: url.href, status: response.status });
        const kopf = Object.fromEntries(['last-modified', 'date', 'content-type'].map(name => [name, response.headers.get(name) ?? '']).filter(([, wert]) => wert));
        return { url: url.href, status: response.status, bytes, text: () => bytes.toString('utf8'), kopf, abgerufen: new Date().toISOString() };
    }
    throw new AbrufFehler('Zu viele Weiterleitungen', { url: adresse });
}

/**
 * Abruf aus gespeicherten Antworten (Tests). Unbekannte Adressen scheitern wie ein Netzfehler.
 * @param {Record<string, Buffer | string | {status: number}>} antworten Adresse → Inhalt oder Fehlerstatus.
 * @param {string} [abgerufen] Zeitstempel der Antworten.
 * @returns {Abruf}
 */
export function gespeicherterAbruf(antworten, abgerufen = '2026-11-17T12:00:00.000Z') {
    return async adresse => {
        erlaubteAdresse(adresse);
        const inhalt = antworten[adresse];
        if (inhalt === undefined) throw new AbrufFehler('keine gespeicherte Antwort', { url: adresse });
        if (typeof inhalt === 'object' && !Buffer.isBuffer(inhalt)) throw new AbrufFehler(`HTTP ${inhalt.status}`, { url: adresse, status: inhalt.status });
        const bytes = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt, 'utf8');
        return { url: adresse, status: 200, bytes, text: () => bytes.toString('utf8'), kopf: {}, abgerufen };
    };
}
