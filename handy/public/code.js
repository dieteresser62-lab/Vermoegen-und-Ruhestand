// Inhalt des QR-Codes: "DEPOT1:" + base64url(JSON). Gegenstück: pc/qr-ausgabe.mjs.
export const PRAEFIX = 'DEPOT1:';
const TICKER = /^[A-Za-z0-9.^=-]{1,20}$/;

/** Prüft den Inhalt des QR-Codes und macht daraus das Positionsmodell. */
export function entschluessele(text) {
  const roh = String(text || '').trim();
  if (!roh.startsWith(PRAEFIX)) throw new Error('Das ist kein Depot-Code.');
  let daten;
  try {
    const b64 = roh.slice(PRAEFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), z => z.charCodeAt(0));
    daten = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new Error('Der Code ist beschädigt.'); }
  return { daten, positionen: pruefe(daten) };
}

export function pruefe(daten) {
  if (!daten || !Array.isArray(daten.p) || !daten.p.length || daten.p.length > 6) throw new Error('Der Code enthält keine Personen.');
  const personen = daten.p.map(p => {
    if (typeof p?.n !== 'string' || !p.n.trim() || !Array.isArray(p.t) || p.t.length > 60) throw new Error('Eine Person ist unvollständig.');
    const tranchen = p.t.map(t => {
      const [name, ticker, stueck] = Array.isArray(t) ? t : [];
      if (typeof ticker !== 'string' || !TICKER.test(ticker)) throw new Error('Ein Ticker ist ungültig.');
      if (typeof stueck !== 'number' || !Number.isFinite(stueck) || stueck < 0) throw new Error('Eine Stückzahl ist ungültig.');
      return { name: String(name || ticker).slice(0, 80), ticker, stueck };
    });
    return { name: p.n.trim().slice(0, 40), tranchen };
  });
  const stand = typeof daten.s === 'string' && !Number.isNaN(Date.parse(daten.s)) ? daten.s : null;
  return { stand, personen };
}
