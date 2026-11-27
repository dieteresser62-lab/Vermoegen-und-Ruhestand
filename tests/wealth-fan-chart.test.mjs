import { createWealthFan, createWealthFanPath, recordWealthFanYear, commitWealthFanPath } from '../app/simulator/wealth-fan-aggregation.js';
import { renderWealthFanChart } from '../app/simulator/wealth-fan-chart.js';
import { renderScenarioWealthChart, buildScenarioWealthPath } from '../app/simulator/scenario-wealth-chart.js';
const fan = createWealthFan(3);
const path = createWealthFanPath(3, 100000);
recordWealthFanYear(path, 1, 200000, 100000);
recordWealthFanYear(path, 2, 0, 0, true); commitWealthFanPath(fan, path);
assert(renderWealthFanChart(null).includes('keine Jahresbänder'), 'Referenz-02-Platzhalter');
const real = renderWealthFanChart(fan, { startYear: 2026, startAge: 65 });
const nominal = renderWealthFanChart(fan, { mode: 'nominal' });
assert(real.includes('heutige Euro') && nominal.includes('nominale Euro'), 'Maßstabbeschriftung folgt Daten');
assert(real.includes('P5–P95') && real.includes('P25–P75') && real.includes('Median'), 'Beide Bänder und Median');
assert(real.includes('Feste Klassen <span class="ds-info">') && real.includes('genau 5 % bleiben sichtbar.'), 'Kurze Klassenzeile erhält die vollständige Erklärung im Infofenster');
assert(real.includes('2029 · 68'), 'Horizont mit Kalenderjahr und Alter');
assert(real.includes('davon 1 mit aufgebrauchtem Geldvermögen') && real.includes('rot: Geldvermögen aufgebraucht'),
    'Die Lebens-/Ruinleiste bezieht sich auf das Geldvermögen');
assert(real.includes('wealth-fan-start'), 'Startreferenz');
const chart = renderScenarioWealthChart([], { wealthFan: fan });
assert(chart.includes('data-fan-background="true"'), 'Fächerhintergrund auch ohne Szenariolinien');
const endPricePath = buildScenarioWealthPath({ logDataRows: [{ jahr: 1, portfolio_total_end: 110000, inflation_factor_cum: 1, inflation: 10 }] }, { initialWealth: 100000, yearEndRealBasis: true });
assertClose(endPricePath.points[1].value, 100000, 1e-8, 'Szenariolinie und Fächer teilen Jahresendpreisbasis ohne Rohlogänderung');
const labels = [...real.matchAll(/class="wealth-fan-end-label" x="[^"]+" y="([^"]+)"/g)].map(match => Number(match[1]));
assertEqual(new Set(labels).size, labels.length, 'Zusammenfallende Nullquantile haben getrennte Endbeschriftungen');

assert(real.includes('width="720" height="300" viewBox="0 0 720 300"'), 'Vermögensfächer: native Pixelmaße');
assert(real.includes('class="scenario-chart-scroll ds-chart-scroll" role="region" tabindex="0" aria-label='), 'Fächer hat eine benannte per Tastatur bedienbare innere Scrollregion');

// HP-6: P5 fällt in den späten Jahren in den Unterlauf (0 bis unter 1 €) und im letzten Jahr auf 0 €; das höchste P95 liegt in einem Unterlaufjahr.
const lateFan = (topLast = null) => {
    const growth = [1, 1.1, 1.2, 1.3, 1.5, 1.2], target = createWealthFan(5);
    for (let low = 0; low < 2; low++) {
        const lowPath = createWealthFanPath(5, 50000);
        [20000, 10000, .5, .4].forEach((value, index) => recordWealthFanYear(lowPath, index + 1, value, value));
        recordWealthFanYear(lowPath, 5, 0, 0, true); commitWealthFanPath(target, lowPath);
    }
    for (let k = 0; k < 19; k++) {
        const start = 100000 + k * 10000, highPath = createWealthFanPath(5, start);
        for (let year = 1; year <= 5; year++) {
            const value = year === 5 && topLast && k >= 17 ? topLast : start * growth[year];
            recordWealthFanYear(highPath, year, value, value);
        }
        commitWealthFanPath(target, highPath);
    }
    return target;
};
const outerPath = svg => svg.match(/class="wealth-fan-outer" d="([^"]*)"/)[1];
const late = renderWealthFanChart(lateFan());
const latePoints = [...outerPath(late).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
assertEqual(outerPath(late).split('M').length - 1, 1, 'HP-6: helles Band läuft ohne Lücke durch den Unterlauf');
assert(latePoints.some(point => point.x === 550), 'HP-6: helles Band reicht bis zum letzten Jahr');
assertClose(Math.min(...latePoints.map(point => point.y)), 20, 1e-9, 'HP-6: Achsenmaximum ist der höchste gezeichnete Wert');
assert(/>P95 · /.test(late) && />P5 · 0\s€/.test(late), 'HP-6: Endmarken P95 und P5 (0 €) am gezeichneten Band');
const overflow = renderWealthFanChart(lateFan(2e12));
assert(!outerPath(overflow).includes('550,') && !/>P(5|95) · /.test(overflow), 'HP-6: Überlauf bleibt eine Lücke ohne Endmarke');
