// Erfundene Musterdaten im Format des App-Stands (ruhestand_suite_data.json). Keine echten Beträge.
export const MUSTER = { records: { rs_profiles_v1: JSON.stringify({ profiles: {
  max: { meta: { name: 'Max', belongsToHousehold: true }, data: { depot_tranchen: JSON.stringify([
    { name: 'MUSTER WELT-AKTIEN ETF', ticker: 'VWCE.DE', shares: 120.5 },
    { name: 'MUSTER GELDMARKT ETF', ticker: 'XEON.DE', shares: 40 },
    { name: 'Ohne Ticker', ticker: '', shares: 3 },
    { name: 'Verkauft', ticker: 'SAP.DE', shares: 0 }
  ]) } },
  erika: { meta: { name: 'Erika', belongsToHousehold: true }, data: { depot_tranchen: [
    { name: 'Größe ÄÖÜ', ticker: 'VGWL.DE', shares: 15.1234 }
  ] } },
  fremd: { meta: { name: 'Fremd', belongsToHousehold: false }, data: { depot_tranchen: [] } }
} }) } };

export function musterYahoo(url) {
  const ziel = new URL(url);
  const symbol = decodeURIComponent(ziel.pathname.split('/').pop());
  const kurs = { 'VWCE.DE': 167.62, 'XEON.DE': 145.28, 'VGWL.DE': 126.51 }[symbol];
  if (!kurs) return Response.json({ chart: { result: null } }, { status: 404 });
  const meta = { regularMarketPrice: kurs, chartPreviousClose: kurs - 0.5,
    regularMarketTime: Math.floor(Date.now() / 1000) - 60, exchangeName: 'GER', currency: 'EUR', gmtoffset: 3600 };
  if (ziel.searchParams.get('range') !== '1y') return Response.json({ chart: { result: [{ meta }] } });
  const { timestamp, close } = musterVerlauf(symbol, kurs);
  return Response.json({ chart: { result: [{ meta, timestamp, indicators: { quote: [{ close }] } }] } });
}

/**
 * Erfundener Jahresverlauf bis heute, nur Werktage um 8 Uhr UTC. Welt-Aktien schwankt um den Kurs mit Hoch im Frühjahr,
 * Geldmarkt steigt gleichmäßig, VGWL.DE hat erst 200 Tage Daten. Der letzte Schluss ist der heutige Kurs.
 */
export function musterVerlauf(symbol, kurs) {
  const tage = symbol === 'VGWL.DE' ? 200 : 365;
  const heute = Math.floor(Date.now() / 86_400_000);
  const timestamp = [], close = [];
  for (let tag = heute - tage; tag <= heute; tag++) {
    if ([0, 6].includes(new Date(tag * 86_400_000).getUTCDay())) continue;
    const anteil = (tag - heute + tage) / tage;
    timestamp.push(tag * 86_400 + 8 * 3600);
    close.push(symbol === 'XEON.DE' ? kurs * (0.97 + 0.03 * anteil) : kurs * (1 + 0.08 * Math.sin(3 * Math.PI * anteil)));
  }
  return { timestamp, close };
}
