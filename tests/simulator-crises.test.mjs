import { deriveHistoricalCrises, backtestChartSeries } from '../app/simulator/simulator-crises.js';
const entry = (jahr, wealth, liquiditaet, cut = 0, extra = {}) => ({ jahr, wertAktien: wealth - liquiditaet, wertGold: 0, liquiditaet,
    row: { Regime: 'NORMAL', bondBucketAfter: 10, health_bucket_end: 500,
        flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: cut, flex_kuerzung_pct: 99, ...extra } });
const result = { request: { startYear: 2000, endYear: 2025 }, ruinYear: null,
    rows: [entry(2000, 80, 5, 10), entry(2001, 60, 7, 25), entry(2002, 60, 9, 5), entry(2007, 100, 15), entry(2008, 75, 10), entry(2009, 80, 11)] };
const before = JSON.stringify(result);
const crises = deriveHistoricalCrises(result, { startWealth: 100 });
assertEqual(crises.length, 4, 'Nur Fenster innerhalb der angeforderten Periode werden gezeigt');
const dotcom = crises[0];
assertEqual(dotcom.minimum.year, 2001, 'Gleichstand nimmt das erste auftretende Jahr');
assertEqual(dotcom.minimum.liq, 7, 'Liquidität stammt genau aus der Minimumzeile');
assertEqual(dotcom.minimum.total, 60, 'Ohne protokollierten Gesamtbestand bleibt der belegte Geldbestand verfügbar');
assertEqual(dotcom.changePct, -40, 'Erstes Fenster verwendet vollständigen Startbestand');
assertEqual(dotcom.cuts, 2, 'Kanonische Haushaltskürzung einschließlich exakt 10 % zählt');
assertEqual(dotcom.lowestFlexRate, 75, 'Niedrigste erfüllte Flex-Rate liest die Haushaltskürzung');
assertEqual(crises[1].changePct, -25, 'Späteres Fenster verwendet die Zeile vor dem Fenster');
assertEqual(crises[1].cuts, 0, 'Depot-Flex ersetzt die Haushaltszählung nicht');
assertEqual(deriveHistoricalCrises(result)[0].changePct, null, 'Fehlender Startbestand erfindet keine Prozentzahl');
assertEqual(deriveHistoricalCrises(result, { startWealth: 0 })[0].changePct, null, 'Nullreferenz erfindet keine Prozentzahl');
const partial = { ...result, request: { startYear: 2001, endYear: 2001 }, rows: [entry(2001, 70, 8)] };
assertEqual(deriveHistoricalCrises(partial)[0].status, 'partial', 'Zeitraumgrenze markiert Teilfenster');
assertEqual(deriveHistoricalCrises({ ...result, request: { startYear: 2010, endYear: 2015 } }).length, 0, 'Nicht enthaltene Fenster entfallen');
const ruined = { ...result, ruinYear: 2001, rows: [entry(2000, 80, 5, 10), entry(2001, 20, 2, 99, { Regime: 'BANKRUPT' }), entry(2002, 500, 0, 99)] };
const ruinCrises = deriveHistoricalCrises(ruined, { startWealth: 100 });
assertEqual(ruinCrises[0].status, 'partial', 'Ruin begrenzt das Krisenfenster');
assertEqual(ruinCrises[0].cuts, 1, 'Terminale Ruinzeile zählt nicht als zusätzliches Kürzungsjahr');
assertEqual(ruinCrises[1].status, 'not_reached', 'Nach frühem Ruin bleibt spätere Krise als nicht erreicht sichtbar');
assertEqual(backtestChartSeries(ruined).length, 2, 'Ruin beendet die Chartserie ohne Nullfortsetzung');
assertEqual(deriveHistoricalCrises({ ...partial, rows: [entry(2001, 70, 8, 0, { Regime: 'accumulation' })] })[0].cuts, null, 'Ansparzeilen liefern keine erfundene Entnahmekürzung');
for (const extra of [{ flex_haushalt_basis: undefined }, { flex_haushalt_kuerzung_pct: undefined }]) {
    assertEqual(deriveHistoricalCrises({ ...partial, rows: [entry(2001, 70, 8, 0, extra)] })[0].cuts, null, 'Fehlende kanonische Flex-Angaben bleiben fehlend');
}
assertEqual(JSON.stringify(result), before, 'Krisenlesemodul verändert kein kanonisches Ergebnis');

// Immobilien und Pflegevorsorge gehören wie im Chart zum Jahresendstand.
const withHomes = { request: { startYear: 2000, endYear: 2002, inputs: { home: [{ wert: 200 }] } },
    portfolioStart: 100, rows: [
        { ...entry(2000, 50, 10), inflationVJ: 0, row: { ...entry(2000, 50, 10).row, portfolio_total_end: 90, immobilien_wert_end: 110, inflation_factor_cum: 1 } },
        { ...entry(2001, 40, 8), inflationVJ: 100, row: { ...entry(2001, 40, 8).row, portfolio_total_end: 60, immobilien_wert_end: 140, inflation_factor_cum: 1 } },
        { ...entry(2002, 30, 4), inflationVJ: 100, row: { ...entry(2002, 30, 4).row, portfolio_total_end: 80, immobilien_wert_end: 160, inflation_factor_cum: 2 } }
    ] };
const homeBytes = JSON.stringify(withHomes);
const nominalCrisis = deriveHistoricalCrises(withHomes)[0];
assertEqual(nominalCrisis.minimum.year, 2000, 'Nominal entscheidet das Gesamtvermögen über das Tiefjahr, bei Gleichstand das erste');
assertEqual(nominalCrisis.minimum.total, 200, 'Nominales Gesamttief enthält Immobilien und protokollierte Pflegevorsorge');
assertEqual(nominalCrisis.minimum.money, 90, 'Davon Geldvermögen stammt aus derselben Zeile einschließlich Pflegevorsorge');
assertClose(nominalCrisis.changePct, -100 / 3, 1e-10, 'Nominale Veränderung vergleicht Gesamtvermögen mit Geld- und Immobilienstart');
const realCrisis = deriveHistoricalCrises(withHomes, { moneyBasis: 'real' })[0];
assertEqual(realCrisis.minimum.year, 2002, 'Real entscheidet das inflationsbereinigte Gesamtvermögen über das Tiefjahr');
assertEqual(realCrisis.minimum.total, 60, 'Reales Gesamttief verwendet den Jahresendfaktor');
assertEqual(realCrisis.minimum.money, 20, 'Geldanteil verwendet denselben Jahresendfaktor');
assertEqual(realCrisis.minimum.liq, 1, 'Liquidität folgt der gewählten Euro-Basis');
assertClose(realCrisis.changePct, -80, 1e-10, 'Reale Veränderung vergleicht Gesamtvermögen in Startjahr-Kaufkraft');
const laterHomes = { ...withHomes, request: { ...withHomes.request, startYear: 1999 }, rows: [
    { ...withHomes.rows[0], jahr: 1999, row: { ...withHomes.rows[0].row, portfolio_total_end: 190 } }, ...withHomes.rows
] };
assertClose(deriveHistoricalCrises(laterHomes)[0].changePct, -100 / 3, 1e-10, 'Späteres nominales Krisenfenster vergleicht Gesamtvermögen mit dem Vorjahr');
assertClose(deriveHistoricalCrises(laterHomes, { moneyBasis: 'real' })[0].changePct, -80, 1e-10, 'Späteres reales Krisenfenster deflationiert auch die Vorjahresreferenz');
assertEqual(JSON.stringify(withHomes), homeBytes, 'Beide Krisenprojektionen erhalten alle Ergebnisbytes');
