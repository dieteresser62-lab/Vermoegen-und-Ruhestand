// Kursvermittler: holt Kurse bei Yahoo und gibt sie an die Handy-Seite weiter.
// Er sieht nur Ticker, keine Stückzahlen und keine Beträge. Alles andere liefert [assets] aus public/.
//
// Xetra (.DE) schließt um 17:30. Für .DE-Ticker fragt er zusätzlich Stuttgart und Düsseldorf ab
// (Handel bis etwa 22 Uhr) und nimmt den neuesten plausiblen Kurs. Die Änderung bezieht sich immer
// auf den letzten Xetra-Schlusskurs vor dem heutigen Handelstag.
const TICKER = /^[A-Za-z0-9.^=-]{1,20}$/;
const ABENDBOERSEN = ['SG', 'DU'];
// Workers Free erlaubt 50 Unteranfragen je Aufruf: 16 Ticker × 3 Börsen = 48.
const HOECHSTENS = 16;
const HOECHSTE_ABWEICHUNG = 0.05;
const BOERSEN = { GER: 'Xetra', STU: 'Stuttgart', DUS: 'Düsseldorf' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const berlinerTag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const tag = iso => berlinerTag.format(new Date(iso));

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/kurse') return antwort({ fehler: 'unbekannter Pfad' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return antwort({ fehler: 'nur GET' }, 405);
    const ticker = [...new Set((url.searchParams.get('s') || '').split(',').map(t => t.trim()).filter(Boolean))];
    if (!ticker.length || ticker.length > HOECHSTENS || !ticker.every(t => TICKER.test(t))) {
      return antwort({ fehler: `Parameter s: 1 bis ${HOECHSTENS} Ticker, durch Komma getrennt` }, 400);
    }
    const jetzt = new Date().toISOString();
    const kurse = await Promise.all(ticker.map(t => besterKurs(t, jetzt)));
    return antwort({ abgerufen: jetzt, kurse: Object.fromEntries(ticker.map((t, i) => [t, kurse[i]])) });
  }
};

async function besterKurs(ticker, jetzt) {
  const basis = ticker.endsWith('.DE') ? ticker.slice(0, -3) : null;
  const [xetra, ...abends] = await Promise.all([ticker, ...(basis ? ABENDBOERSEN.map(b => `${basis}.${b}`) : [])].map(kurs));
  return waehle(xetra, abends, jetzt);
}

/** Wählt aus Xetra- und Abendkursen den neuesten plausiblen. Reine Funktion, damit sie testbar ist. */
export function waehle(xetra, abends, jetzt) {
  if (!xetra || xetra.fehler) return xetra || { fehler: 'kein Kurs' };
  const heute = tag(jetzt);
  let bester = xetra;
  for (const k of abends) {
    if (!k || k.fehler || !k.zeit || !xetra.zeit) continue;
    if (k.waehrung !== xetra.waehrung) continue;
    if (tag(k.zeit) !== heute) continue;
    if (Math.abs(k.kurs / xetra.kurs - 1) > HOECHSTE_ABWEICHUNG) continue;
    if (Date.parse(k.zeit) > Date.parse(bester.zeit)) bester = k;
  }
  if (bester === xetra) return xetra;
  // Hat Xetra heute noch nicht gehandelt (morgens vor 9 Uhr), ist sein letzter Kurs der Vortagesschluss.
  const vortag = tag(xetra.zeit) < tag(bester.zeit) ? xetra.kurs : xetra.vortag;
  return { ...bester, vortag };
}

async function kurs(ticker) {
  const ziel = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  try {
    const res = await fetch(ziel, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!res.ok) return { fehler: `Yahoo ${res.status}` };
    const m = (await res.json())?.chart?.result?.[0]?.meta;
    if (!m || typeof m.regularMarketPrice !== 'number' || !(m.regularMarketPrice > 0)) return { fehler: 'kein Kurs' };
    return {
      kurs: m.regularMarketPrice,
      vortag: typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : null,
      waehrung: m.currency ?? null,
      zeit: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
      boerse: BOERSEN[m.exchangeName] ?? m.exchangeName ?? null
    };
  } catch {
    return { fehler: 'Abruf fehlgeschlagen' };
  }
}

function antwort(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
