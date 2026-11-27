// Kursvermittler: holt Tageskurse und Jahresverlauf bei Yahoo und gibt sie an die Handy-Seite weiter.
// Er sieht nur Ticker, keine Stückzahlen und keine Beträge. Alles andere liefert [assets] aus public/.
//
import { boersenname, kurssymbole, waehle } from '../../app/shared/kurswahl.js';
import { kennzahlen } from '../public/verlauf.js';

const TICKER = /^[A-Za-z0-9.^=-]{1,20}$/;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YAHOO_KOPF = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
// Den Jahresverlauf hält Cloudflare eine Stunde vor: höchstens etwa ein Yahoo-Abruf je Ticker und Stunde.
// Nur erfolgreiche Antworten eine Stunde zwischenspeichern; Yahoo-Fehler (429, 5xx) nie, sonst hängt ein Fehler bis zu einer Stunde fest.
const VERLAUF_CACHE = { cacheEverything: true, cacheTtlByStatus: { '200-299': 3600, '404': 60, '400-599': 0 } };
const berlinerTag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

// Workers Free erlaubt 50 Unteranfragen je Aufruf: 12 Ticker × 4 Börsen = 48, beim Verlauf 40 × 1.
const WEGE = {
  '/api/kurse': { hoechstens: 12, antwort: kurse },
  '/api/verlauf': { hoechstens: 40, antwort: verlaeufe }
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const weg = Object.hasOwn(WEGE, url.pathname) ? WEGE[url.pathname] : null;
    if (!weg) return antwort({ fehler: 'unbekannter Pfad' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return antwort({ fehler: 'nur GET' }, 405);
    const ticker = [...new Set((url.searchParams.get('s') || '').split(',').map(t => t.trim()).filter(Boolean))];
    if (!ticker.length || ticker.length > weg.hoechstens || !ticker.every(t => TICKER.test(t))) {
      return antwort({ fehler: `Parameter s: 1 bis ${weg.hoechstens} Ticker, durch Komma getrennt` }, 400);
    }
    return antwort(await weg.antwort(ticker));
  }
};

async function kurse(ticker) {
  const jetzt = new Date().toISOString();
  const liste = await Promise.all(ticker.map(besterKurs));
  return { abgerufen: jetzt, kurse: Object.fromEntries(ticker.map((t, i) => [t, liste[i]])) };
}

async function besterKurs(ticker) {
  const kurse = await Promise.all(kurssymbole(ticker).map(kurs));
  return waehle(ticker, kurse, new Date().toISOString());
}

async function kurs(ticker) {
  const ziel = `${YAHOO}${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  try {
    const res = await fetch(ziel, { headers: YAHOO_KOPF });
    if (!res.ok) return { fehler: `Yahoo ${res.status}` };
    const m = (await res.json())?.chart?.result?.[0]?.meta;
    if (!m || typeof m.regularMarketPrice !== 'number' || !(m.regularMarketPrice > 0)) return { fehler: 'kein Kurs' };
    const vortag = m.chartPreviousClose ?? m.previousClose;
    return {
      kurs: m.regularMarketPrice,
      vortag: Number.isFinite(vortag) ? vortag : null,
      waehrung: m.currency ?? null,
      zeit: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
      boerse: boersenname(ticker, m.exchangeName)
    };
  } catch {
    return { fehler: 'Abruf fehlgeschlagen' };
  }
}

// Der Verlauf kommt nur von der eingetragenen Börse, ohne Abendbörsen.
async function verlaeufe(ticker) {
  const jetzt = new Date();
  const heute = berlinerTag.format(jetzt);
  const liste = await Promise.all(ticker.map(t => verlauf(t, heute)));
  return { abgerufen: jetzt.toISOString(), verlauf: Object.fromEntries(ticker.map((t, i) => [t, liste[i]])) };
}

async function verlauf(ticker, heute) {
  const ziel = `${YAHOO}${encodeURIComponent(ticker)}?interval=1d&range=1y`;
  try {
    const res = await fetch(ziel, { headers: YAHOO_KOPF, cf: VERLAUF_CACHE });
    if (!res.ok) return { fehler: `Yahoo ${res.status}` };
    const ergebnis = (await res.json())?.chart?.result?.[0];
    const punkte = tagesschluesse(ergebnis);
    if (!punkte.length) return { fehler: 'kein Verlauf' };
    return { waehrung: ergebnis.meta?.currency ?? null, punkte, ...kennzahlen(punkte, heute) };
  } catch {
    return { fehler: 'Abruf fehlgeschlagen' };
  }
}

/** Ein Schluss je Börsentag, bei doppeltem Tag der letzte. Sechs gültige Stellen reichen für Prozentwerte. */
function tagesschluesse(ergebnis) {
  const zeiten = ergebnis?.timestamp, schluesse = ergebnis?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(zeiten) || !Array.isArray(schluesse)) return [];
  const versatz = Number.isFinite(ergebnis.meta?.gmtoffset) ? ergebnis.meta.gmtoffset : 0;
  const jeTag = new Map();
  zeiten.forEach((zeit, i) => {
    const schluss = schluesse[i];
    if (!Number.isFinite(zeit) || !Number.isFinite(schluss) || !(schluss > 0)) return;
    jeTag.set(new Date((zeit + versatz) * 1000).toISOString().slice(0, 10), Number(schluss.toPrecision(6)));
  });
  return [...jeTag].sort(([a], [b]) => a.localeCompare(b));
}

function antwort(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
