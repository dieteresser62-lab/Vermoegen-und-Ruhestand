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
