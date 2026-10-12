import { prepareChartAxis, formatChartEuro } from '../app/balance/balance-chart-axis.js';

console.log('--- Reine Verlaufsachse und Ganz-Euro-Labels ---');
const values = [980000, 1000000, 1020000];
const before = JSON.stringify(values);
const axis = prepareChartAxis(values);
assert(axis.minimum > 0 && axis.maximum - axis.minimum <= 200000, 'Nahe Millionenstände haben eine enge Nichtnullachse');
assertEqual(axis.minimum, 960000, 'Glatte äußere Untergrenze');
assertEqual(axis.maximum, 1040000, 'Glatte äußere Obergrenze');
assertEqual(JSON.stringify(values), before, 'Eingaben bleiben unverändert');
for (const series of [values, [0, 10, 20], [0, 100000], [0.01, 0.02], [1234], [1234, 1234], [0], [-0],
    [-0.02, -0.01], [-Number.MIN_VALUE], [-1234], [-10, 0, 20],
    [1e300, 1.02e300], [1.7e308], [Number.MIN_VALUE], [Number.MAX_VALUE],
    [0, Number.MAX_VALUE], [-Number.MAX_VALUE, Number.MAX_VALUE]]) {
    const result = prepareChartAxis(series);
    assert(Number.isFinite(result.minimum) && Number.isFinite(result.maximum)
        && result.maximum > result.minimum, 'Einzel-, konstante, kleine und extreme Werte haben endliche Grenzen');
    assert(series.every(value => value >= result.minimum && value <= result.maximum), 'Alle Daten liegen innerhalb der Achse');
    assert(result.ticks.every(Number.isFinite), 'Alle Ticks sind endlich');
    assert(result.step >= 1, 'Ganz-Euro-Labels haben mindestens 1 € Tickabstand');
    const labels = result.ticks.map(formatChartEuro);
    assertEqual(new Set(labels).size, labels.length, 'Alle Ticklabels sind paarweise verschieden');
    assert(labels.every(label => !label.includes('-0')), 'Ticklabels enthalten keine negative Null');
    if (series.every(value => value >= 0)) {
        assert(result.minimum >= 0, 'Nichtnegative Daten haben eine nichtnegative Untergrenze');
    }
    assert(series.every(value => Number.isFinite(result.position(value))
        && result.position(value) >= 0 && result.position(value) <= 1), 'Normierte Geometrie ist endlich und innerhalb der Grafik');
    if (!series.includes(Number.MAX_VALUE) && !series.includes(-Number.MAX_VALUE)) {
        const mantissa = result.step / 10 ** Math.max(-323, Math.floor(Math.log10(result.step)));
        assert([1, 2, 5, 10].some(nice => Math.abs(mantissa - nice) < .01), 'Schritte sind glatte 1/2/5-Zehnerpotenzen');
        for (let index = 1; index < result.ticks.length; index++) {
            assertClose((result.ticks[index] - result.ticks[index - 1]) / result.step, 1, .000001, 'Tickabstände sind gleichmäßig');
        }
    }
}
assertEqual(prepareChartAxis([]), null, 'Leere Daten erzeugen keine Achse');
assertEqual(prepareChartAxis([NaN, Infinity]), null, 'Keine endlichen Daten erzeugen keine Achse');
assertEqual(formatChartEuro(1000000.49), '1.000.000\u00a0€', 'Achsenlabel zeigt deutsche ganze Euro ohne Cent');
assertEqual(formatChartEuro(-1234.56), '-1.235\u00a0€', 'Negative Ganz-Euro-Labels behalten ihr Vorzeichen');
assertEqual(formatChartEuro(0), '0\u00a0€', 'Echte Null bleibt sichtbar');
