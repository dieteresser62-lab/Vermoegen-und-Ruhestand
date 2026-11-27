// Kennzahlen aus dem Jahresverlauf eines Tickers. Worker und Handy-Seite rechnen damit gleich.
// Rein: kein Netz, keine Uhr. Tage als „YYYY-MM-DD“, Punkte aufsteigend nach Datum.
const TAG_MS = 86_400_000;
// Yahoo liefert mit range=1y gut ein Jahr. Fehlt mehr als eine Woche davon, ist der Verlauf kürzer.
const JAHR_MIT_LUECKE = 365 - 7;

const minusTage = (tag, tage) => new Date(Date.parse(tag) - tage * TAG_MS).toISOString().slice(0, 10);
const punkt = p => (p ? { datum: p[0], schluss: p[1] } : null);

/**
 * Bezugswerte für Woche, Monat, Jahr und 52-Wochen-Hoch.
 * woche: Schluss vor 7 Kalendertagen oder am letzten Handelstag davor;
 * monat: letzter Schluss im Vormonat; jahr: ältester Punkt; hoch52: höchster Schluss.
 * @param {[string, number][]} punkte Tagesschlüsse [Tag, Schluss]
 * @param {string} heute Tag der Abfrage
 */
export function kennzahlen(punkte, heute) {
  if (!punkte.length) return { woche: null, monat: null, jahr: null, hoch52: null };
  const vorWoche = minusTage(heute, 7);
  const monatsanfang = `${heute.slice(0, 7)}-01`;
  const zahlen = {
    woche: punkt(punkte.findLast(([tag]) => tag <= vorWoche)),
    monat: punkt(punkte.findLast(([tag]) => tag < monatsanfang)),
    jahr: punkt(punkte[0]),
    hoch52: punkt(punkte.reduce((hoch, p) => (p[1] > hoch[1] ? p : hoch)))
  };
  if (punkte[0][0] > minusTage(heute, JAHR_MIT_LUECKE)) zahlen.hinweis = 'weniger als ein Jahr Daten';
  return zahlen;
}
