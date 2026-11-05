import { measureZG2 } from '../scripts/measure-zg2-equalization.mjs';

// Echter MC-Pfad; Debugger liest den Originalcode, Sollwerte stammen aus den
// Rohbeständen und einer getrennten Nachrechnung, nicht aus erfundenen Logzeilen.
const result = await measureZG2();
const [max, erika] = result.people;
const hand = result.handCalculation;
const phase = name => result.observations.find(row => row.phase === name).people;
const total = people => people.reduce((sum, person) => sum + person.money, 0);

assertEqual(result.pathNumber, 11, 'Seed 12345: sichtbarer Pfad 11 (Index 10)');
assertEqual(result.scenarioLabel, 'Zufällig #11', 'Pfad ist in der echten Stichprobenauswahl erreichbar');
assertEqual(result.testDate, '2026-10-28', 'Festes synthetisches Testdatum aus ZG-1b');
assertEqual(result.simulationYear, 20, 'Tod Max im 20. Simulationsjahr');
assertEqual(result.calendarYear, 2045, 'Planjahr und historische Marktjahresnummer getrennt');
assertEqual(result.historicalYear, 1983, 'Todesjahr verwendet das gezogene Marktjahr 1983');
assertEqual(max.initialAssets, 864000, 'Max: 414.000 Geld plus 450.000 Haus am Planstart');
assertEqual(erika.initialAssets, 586000, 'Erika: 376.000 Geld plus 210.000 Wohnung am Planstart');
assertClose(result.inflationFactor, 1.4841747668547232, 1e-12, 'Inflation enthält auch das Todesjahr');
assertClose(max.endAssets, 4565155.983647285, 1e-7, 'Max: nominales Gesamtvermögen vor Erbaufteilung');
assertClose(erika.endAssets, 3994736.3710178263, 1e-7, 'Erika: nominales Gesamtvermögen zur selben Messstelle');
assertClose(max.gain, 3282828.9850848042, 1e-7, 'Max: Endvermögen minus indexiertes Anfangsvermögen');
assertClose(erika.gain, 3125009.9576409585, 1e-7, 'Erika: derselbe Index und dieselbe Bewertung');
assertClose(hand.rawAllowance, 78909.51372192288, 1e-7, 'Handrechnung: halbe positive Zugewinndifferenz');
assertClose(hand.allowance, 67365.11539300121, 1e-7, 'Handrechnung: Familienheim kürzt den Ausgleich anteilig');
assertClose(hand.taxWith, 632683.3224022351, 1e-7, 'Steuer mit Ausgleich: Bemessung mal 19 Prozent');
assertClose(hand.taxWithout, 645482.6943269053, 1e-7, 'Steuer ohne Ausgleich bei identischen Nachlasswerten');
assertClose(hand.taxWithout - hand.taxWith, 12799.37192467018, 1e-7, 'Steuerminderung getrennt von Verkaufssteuern');

assertEqual(result.observations.map(row => row.phase).join(','),
    'year_open,after_returns,before_payout,after_payout,before_inheritance', 'Lauf misst die wirkliche Buchungsfolge');
for (const index of [0, 1]) {
    assert(phase('after_returns')[index].money > phase('year_open')[index].money,
        result.people[index].name + ': Jahresrendite vor der gemeinsamen Nachlassmessung enthalten');
    assertClose(result.code.gains[index === 0 ? 'deceasedAssets' : 'survivorAssets'],
        phase('before_inheritance')[index].money + result.people[index].endHome, 1e-7,
        result.people[index].name + ': Code verwendet den Bestand an derselben Messstelle');
}
assertClose(total(phase('before_payout')) - total(phase('after_payout')), 15000, 1e-7,
    'Jahresentnahme 15.000 Euro erfolgt vor der Nachlassmessung');
assert(result.timing.cashInterest > 0 && result.timing.ordinaryAnnualTax > 0,
    'Cashzinsen und gewöhnliche Jahressteuer sind vor dem Erbfall gebucht');
for (const [name, passed] of Object.entries(result.checks)) assert(passed, 'Messabgleich: ' + name);
assertEqual(result.calculationError, false, 'Kein Messzeitpunkt- oder Rechenfehler im Sollfall');
assert(result.tooltip.deathMax && result.tooltip.gainLine && result.tooltip.formattedAllowance,
    'Echter Renderer zeigt im Erbe-ⓘ Todesfall Max und den nominalen Zugewinnausgleich');
