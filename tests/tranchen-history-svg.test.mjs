import { historyDay } from '../app/tranches/tranchen-history-store.js';
import { evaluateWealthHistory } from '../app/tranches/tranchen-history-model.js';
import { renderWealthHistorySvg, renderHistorySparkline, renderHistoryCourseSvg, selectHistoryDrawingIndices, wealthHistoryScale } from '../app/tranches/tranchen-history-svg.js';
const start = historyDay('2026-01-01');
// Feste Grenzwerte als unabhängige Orakel, keine Erwartungsrechnung mit Produktionshelfern.
const scaleCases = [
    { values: [2400000, 2600000, 2900000], step: 200000, floor: 2000000, ceiling: 3000000, occupancy: .5 },
    { values: [2700000, 2800000, 2900000], step: 50000, floor: 2600000, ceiling: 2950000, occupancy: 4 / 7 },
    { values: [3900000, 4040000], step: 40000, floor: 3800000, ceiling: 4080000, occupancy: .5 },
    { values: [2500000, 2520000], step: 30000, floor: 2430000, ceiling: 2580000, small: true },
    { values: [2500000, 2500000], step: 30000, floor: 2430000, ceiling: 2550000, small: true },
    { values: [0, 10, 100], step: 30, floor: 0, ceiling: 120 },
    { values: [0, 40], step: 10, floor: 0, ceiling: 50 },
    { values: [0], step: .3, floor: 0, ceiling: 1.2 },
    { values: [], step: .3, floor: 0, ceiling: 1.2 },
    { values: [null, null], step: .3, floor: 0, ceiling: 1.2 },
    { values: [0.0000024, 0.0000029], step: .0000002, floor: .000002, ceiling: .000003, occupancy: .5 },
    { values: [2700000, null, 2900000], step: 50000, floor: 2600000, ceiling: 2950000, occupancy: 4 / 7 },
    { values: [2700000, null, 2900000], known: [2700000, 3500000, 2900000], step: 50000, floor: 2600000, ceiling: 3550000 },
    { values: [2700000, null, 2900000], known: [2700000, 3550000, 2900000], step: 50000, floor: 2600000, ceiling: 3600000 },
    // Primzahlige Basisintervalle dürfen das Raster nicht auf zwei Grenzen reduzieren.
    { values: [2700000, null, 2900000], known: [2700000, 3100000, 2900000], step: 50000, floor: 2600000, ceiling: 3150000 },
    { values: [2700000, null, 2900000], known: [2700000, 3200000, 2900000], step: 50000, floor: 2600000, ceiling: 3250000 },
    { values: [2700000, null, 2900000], known: [2700000, 3400000, 2900000], step: 50000, floor: 2600000, ceiling: 3450000 },
    { values: [null], known: [100], step: 30, floor: 0, ceiling: 120 }
];
const closeValue = (a, b) => Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-12, Number.MIN_VALUE);
const scaleView = ({ values, known = values }) => {
    const points = values.map((value, i) => ({ day: start + i, date: new Date((start + i) * 86400000).toISOString().slice(0, 10),
        total: value, known: known[i], allocation: { aktien: value === null ? null : value * .6, cash: value === null ? null : value * .4 } }));
    return { points, end: points.at(-1) || null, range: { start, end: start + values.length - 1 }, types: ['aktien', 'cash'], gaps: [], events: [] };
};
for (const fixture of scaleCases) {
    const view = scaleView(fixture), before = JSON.stringify(view);
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(view);
    const scale = wealthHistoryScale(view.points), label = fixture.values.join('/');
    for (const key of ['floor', 'ceiling', 'step']) assert(closeValue(scale[key], fixture[key]), 'Unabhängiges Skalenorakel ' + label + ': ' + key);
    assert(Number.isFinite(scale.ceiling) && scale.ceiling > scale.floor && scale.step > 0, 'Endlicher positiv breiter Bereich: ' + label);
    const finite = fixture.values.filter(Number.isFinite), min = Math.min(...finite), max = Math.max(...finite);
    if (fixture.occupancy) {
        const occupancy = (max - min) / (scale.ceiling - scale.floor);
        assert(Math.abs(occupancy - fixture.occupancy) < 1e-10 && occupancy >= .5 - 1e-10, 'Unabhängig mindestens 50 Prozent Plothöhe: ' + label);
    }
    if (fixture.small) assert(min - scale.floor >= .02 * min && scale.ceiling - max >= .02 * min, 'Kleine/konstante Reihe erhält beidseitig zwei Prozent Luft');
    if (finite.length && min > 0) {
        const raw = Math.max(0, min - Math.max((max - min) / 2, max - min < .02 * min ? .02 * min : 0));
        assert(scale.floor <= raw + scale.step * 1e-10 && raw - scale.floor <= scale.step, 'Abrundung höchstens einen Schritt unter rohem Ziel');
    }
    for (const width of [280, 1366, 1920, 2560]) {
        const svg = renderWealthHistorySvg(view, { width, title: '<Fremdtitel>', description: '<Beschreibung>' });
        assert(!/NaN|Infinity/.test(svg), 'Große, kleine, konstante und unbekannte Reihen zeichnen endlich');
        for (const key of ['floor', 'ceiling', 'step']) assert(closeValue(Number(svg.match(new RegExp(`data-scale-${key}="([^"]+)"`))[1]), fixture[key]), 'SVG übernimmt feste Skala unabhängig von Pixelbreite');
        const ticks = [...svg.matchAll(/data-history-tick="([^"]+)"[^>]*y1="([^"]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
        assert(ticks.length >= 4, 'Jeder Skalenfall besitzt mindestens drei sichtbare Rasterintervalle');
        assert(closeValue(ticks[0][0], fixture.floor) && closeValue(ticks.at(-1)[0], fixture.ceiling), 'Tickgrenzen entsprechen festen Skalenorakeln');
        const dv = ticks[1][0] - ticks[0][0], dy = ticks[1][1] - ticks[0][1];
        assert(ticks.slice(1).every((t, i) => Math.abs(t[0] - ticks[i][0] - dv) <= fixture.step * 1e-10), 'Numerisch gleichmäßige Ticks einschließlich Schlussintervall');
        assert(ticks.slice(1).every((t, i) => Math.abs(t[1] - ticks[i][1] - dy) <= .02), 'Geometrisch gleichmäßige Ticks einschließlich Schlussintervall');
        const broken = svg.includes('class="history-axis-break"');
        assertEqual(broken, fixture.floor > 0, 'Bruchmarke genau bei positiver Untergrenze');
        assertEqual((svg.match(/Achse beginnt bei/g) || []).length, broken ? 2 : 0, 'Auch fremder Titel und Beschreibung nennen Achsenstart');
        assert(svg.includes('&lt;Fremdtitel&gt;') && svg.includes('&lt;Beschreibung&gt;'), 'Eigene Titel/Beschreibungen bleiben escapet');
        const axisLabels = [...svg.matchAll(/<line class="history-grid"[^>]*\/><text class="history-axis"[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
        assertEqual(new Set(axisLabels).size, axisLabels.length, 'Benachbarte Euroachsenlabels unterscheidbar');
        assertEqual(axisLabels.length, ticks.length, 'Jeder Tick einschließlich beider Grenzen ist beschriftet');
        axisLabels.forEach((label, i) => {
            const amount = Number(label.replace(' Mio.', '').replace(/\./g, '').replace(',', '.')) * (label.endsWith(' Mio.') ? 1e6 : 1);
            assert(closeValue(amount, ticks[i][0]), 'Achsenlabel bezeichnet den tatsächlichen Tickbetrag präzise');
        });
        if (fixture.floor === 2430000) assertEqual(axisLabels[0], '2,43 Mio.', 'Unterstes Label nennt tatsächlichen Ausschnittstart');
        if (broken) {
            assert(svg.indexOf('class="history-axis-break"') < svg.indexOf('<g clip-path='), 'Dekorative Bruchmarke außerhalb des Flächenclips');
            assert(svg.includes('class="history-axis-break" aria-hidden="true"'), 'Bruchmarke ist dekorativ');
        }
    }
    assertEqual(JSON.stringify(view), before, 'Skalen-/SVGhelfer bestehen mit tief eingefrorenem Eingang');
}
for (const values of [[1e-30, 2e-30], [Number.MIN_VALUE], [1e300, 1.1e300], [Number.MAX_VALUE], [0, Number.MAX_VALUE]]) {
    const view = scaleView({ values }), scale = wealthHistoryScale(view.points);
    assert(Object.values(scale).every(Number.isFinite) && scale.ceiling > scale.floor && scale.step > 0, 'Numerische Randbereiche behalten endliche positiv breite Skala');
    assert(!/NaN|Infinity/.test(renderWealthHistorySvg(view)), 'Numerische Randbereiche bleiben ohne ungültige SVGkoordinaten');
}
const input = { profiles: [{ id: 'a', currentCash: 20, cashHistory: { baselineValue: 20, entries: [] }, lots: [] }], startDate: '2026-01-01', today: '2026-01-06' };
const history = evaluateWealthHistory(input);
history.events = [{ kind: 'buy', day: start + 1, shares: 2, amount: 10, name: '<script> & "' }];
history.gaps = [[start + 1, start + 1], [start + 4, start + 4]];
const bytes = JSON.stringify(history), svg = renderWealthHistorySvg(history, { title: '<Titel>' });
assert(svg.includes('role="img"') && svg.includes('<desc id=') && svg.includes('&lt;Titel&gt;'), 'Zugänglicher, escapeter SVGtitel');
assert(!svg.includes('<script>') && svg.includes('&lt;script&gt;'), 'Ereignisnamen als Text');
assert(svg.includes('history-total-area') && svg.includes('history-total'), 'Fläche und Gesamtlinie');
const eventGroup = svg.match(/<g class="history-event history-buy">(.*?)<\/g>/)[1];
const eventPoint = eventGroup.match(/<circle cx="([^"]+)" cy="([^"]+)"/);
const connector = eventGroup.match(/<line class="history-event-connector" x1="([^"]+)" x2="([^"]+)" y1="([^"]+)" y2="([^"]+)"/);
assert(connector && connector[1] === eventPoint[1] && connector[2] === eventPoint[1] && Number(connector[4]) === Number(eventPoint[2]) - 6,
    'Kaufbeschriftung hat eine Verbindungslinie zum gezeichneten Punkt');
assertEqual((svg.match(/data-history-gap=/g) || []).length, 2, 'Nur konkrete offene Intervalle schraffiert');
const id = svg.match(/pattern id="([^"]+)/)[1];
assert(!renderWealthHistorySvg(history).includes(id), 'Mehrere SVGs besitzen eindeutige IDs');
assert(svg.includes(`url(#${id})`) && svg.includes('clipPath'), 'Muster und Clip korrekt gebunden');
const labelledBy = svg.match(/aria-labelledby="([^"]+)"/)[1].split(' ');
assertEqual(labelledBy.length, 2, 'SVG besitzt genau Titel- und Beschreibungsverknüpfung');
assert(svg.includes(`<title id="${labelledBy[0]}">`) && svg.includes(`<desc id="${labelledBy[1]}">`), 'ARIAkennungen koppeln tatsächlichen Titel und Beschreibung');
assertEqual(JSON.stringify(history), bytes, 'SVG mutiert keine Reihe');
assert(!svg.includes('#7a5a1f') && !svg.includes('http'), 'Kein hartkodierter Farb- oder Netzvertrag');
const unknown = { ...history, points: history.points.map(point => ({ ...point, total: null })) };
assert(!renderWealthHistorySvg(unknown).includes('class="history-area'), 'Unbekannte Anfangstage ohne erfundene Fläche');
assert(renderHistorySparkline(history.points).includes('history-total'), 'Gemeinsame Sparkline');
const course = { range: history.range, purchasePrice: 1000, points: history.points.map(point => ({ day: point.day, value: 10, gap: false })) };
const detail = renderHistoryCourseSvg(course, { sales: [{ day: start + 2, shares: 3 }] });
assert(detail.includes('Kaufpreis 1.000,00 €') && detail.includes('y1="55"'), 'Kaufpreis außerhalb Kurswerten erweitert Achse');
assert(detail.includes('Verkauf 3 Stück') && detail.includes('history-sell'), 'Stückzahl im Kursdetail');
const rectangles = [...svg.matchAll(/data-history-gap="([^"]+)" x="([^"]+)" y="[^"]+" width="([^"]+)"/g)];
assert(Math.abs(Number(rectangles[0][2]) - 346) < .01 && Math.abs(Number(rectangles[0][3]) - 256) < .01, 'Schraffur entspricht exakt der vollen offenen Tageszelle');
assert(Math.abs(Number(rectangles[1][2]) + Number(rectangles[1][3]) - 1370) < .01, 'Auch der letzte offene Tag ist vollständig sichtbar');

// Unabhängiges Geometrieorakel aus den vollständigen Tagesendwerten.
const totalRuns = source => [...source.matchAll(/<path class="history-total"[^>]* d="([^"]+)"/g)].map(match => match[1]);
function linearVertices(path, closed, label) {
    assert(/^M-?[\d.]+,-?[\d.]+(?:L-?[\d.]+,-?[\d.]+)*Z?$/.test(path)
        && path.endsWith('Z') === closed, label + ': ausschließlich lineare Kontur, nur Flächen geschlossen');
    return path.replace(/^M|Z$/g, '').split('L').map(pair => pair.split(',').map(Number));
}
function assertContour(actual, expected, label) {
    assertEqual(actual.length, expected.length, label + ': gleiche Punktzahl');
    const close = (a, b) => a.every((value, axis) => Math.abs(value - b[axis]) <= .011);
    assert(actual.every((point, i) => close(point, expected[i])), label + ': alle Tagespunkte deckungsgleich');
    const at = (a, b, fraction) => a.map((value, axis) => value + (b[axis] - value) * fraction);
    assert(actual.slice(1).every((point, i) => [.25, .5, .75].every(fraction =>
        close(at(actual[i], point, fraction), at(expected[i], expected[i + 1], fraction)))),
    label + ': 25/50/75 % aller Abschnitte deckungsgleich');
}
// SOURCE dekodieren; Sollkoordinaten ausschließlich aus Originalwerten und Achsenrechnung.
function assertStackGeometry(view, rendered, width, height, label, expectedScale = null) {
    const left = Math.min(90, width * .3), right = Math.max(left + 1, width - Math.min(50, width * .1));
    const top = Math.min(60, height * .2), bottom = Math.max(top + 1, height - Math.min(60, height * .2));
    const floor = expectedScale?.floor ?? Number(rendered.match(/data-scale-floor="([^"]+)"/)[1]);
    const ceiling = expectedScale?.ceiling ?? Number(rendered.match(/data-scale-ceiling="([^"]+)"/)[1]);
    const x = p => left + (p.day + .5 - view.range.start) / Math.max(1, view.range.end - view.range.start + 1) * (right - left);
    const y = value => bottom - (value - floor) / (ceiling - floor) * (bottom - top);
    const originalByX = new Map(view.points.filter(p => Number.isFinite(p.total)).map(p => [x(p).toFixed(2), p]));
    const lines = totalRuns(rendered).map(path => linearVertices(path, false, label + ': Gesamtlinie'));
    const totalAreas = [...rendered.matchAll(/<path class="history-total-area" d="([^"]+)"/g)];
    const areas = [...rendered.matchAll(/<path class="history-area history-([^"]+)" d="([^"]+)"/g)];
    assertEqual(areas.length, floor > 0 ? 0 : lines.length * view.types.length, label + ': Stapel nur bei Nullstart');
    assertEqual(totalAreas.length, floor > 0 ? lines.length : 0, label + ': genau eine Gesamtfläche je Ausschnittlauf');
    lines.forEach((line, runIndex) => {
        const originals = line.map(point => originalByX.get(point[0].toFixed(2)));
        assert(originals.every(Boolean), label + ': ausgewählte X stammen aus bekannten Originaltagen');
        assert(originals.slice(1).every((p, i) => p.day > originals[i].day
            && view.points.slice(originals[i].day - view.range.start, p.day - view.range.start + 1)
                .every(p => Number.isFinite(p.total))), label + ': keine Anfangskante und keine überbrückte Lücke');
        assertContour(line, originals.map(p => [x(p), y(p.total)]), label + ': Gesamtwertorakel');
        if (floor > 0) {
            const vertices = linearVertices(totalAreas[runIndex][1], true, label + ': Gesamtfläche');
            assertEqual(vertices.length, line.length * 2, label + ': zwei Polygonseiten');
            assertContour(vertices.slice(0, line.length), line, label + ': Gesamtflächenoberkante');
            assertContour(vertices.slice(line.length), originals.map(p => [x(p), bottom]).reverse(), label + ': Basis am Achsenfuß');
            return;
        }
        let previousUpper;
        view.types.forEach((type, typeIndex) => {
            const area = areas[runIndex * view.types.length + typeIndex];
            assertEqual(area[1], type, label + ': Stapelreihenfolge');
            const vertices = linearVertices(area[2], true, label + ': Fläche ' + type);
            assertEqual(vertices.length, line.length * 2, label + ': obere und untere Polygonseite');
            const upper = vertices.slice(0, line.length), lower = vertices.slice(line.length);
            const value = (p, end) => view.types.slice(0, end).reduce((sum, t) => sum + p.allocation[t], 0);
            assertContour(upper, originals.map(p => [x(p), y(value(p, typeIndex + 1))]), label + ': Oberseite ' + type);
            assertContour(lower, originals.map(p => [x(p), y(value(p, typeIndex))]).reverse(), label + ': rückwärtige Unterseite ' + type);
            assertEqual(upper.map(p => p[0]).join(','), line.map(p => p[0]).join(','), label + ': gemeinsame obere X-Indizes');
            assertEqual(lower.map(p => p[0]).reverse().join(','), line.map(p => p[0]).join(','), label + ': umgekehrte untere X-Indizes');
            if (previousUpper) assertContour(lower.slice().reverse(), previousUpper, label + ': gemeinsame Stapelgrenze');
            previousUpper = upper;
        });
        assertContour(previousUpper, line, label + ': oberste Fläche und Gesamtlinie');
    });
    return lines;
}
function assertTotalGeometry(view, label) {
    const before = JSON.stringify(view);
    for (const width of [800, 1420, 2300]) {
        const height = 438, rendered = renderWealthHistorySvg(view, { width, height });
        assertStackGeometry(view, rendered, width, height, label + '/' + width);
        assert(rendered.includes(`viewBox="0 0 ${width} ${height}"`) && !/NaN|Infinity/.test(rendered), label + ': endliche Pixelgeometrie ' + width);
        const floor = Number(rendered.match(/data-scale-floor="([^"]+)"/)[1]);
        const ceiling = Number(rendered.match(/data-scale-ceiling="([^"]+)"/)[1]);
        const expected = view.points.filter(point => Number.isFinite(point.total)).map(point => [
            90 + (point.day + .5 - view.range.start) / Math.max(1, view.range.end - view.range.start + 1) * (width - 140),
            height - 60 - (point.total - floor) / (ceiling - floor) * (height - 120)
        ]);
        const paths = totalRuns(rendered);
        const actual = paths.flatMap(path => path.slice(1).split('L').map(pair => pair.split(',').map(Number)));
        assertEqual(actual.length, expected.length, label + ': alle bekannten Tageswerte gezeichnet');
        actual.forEach((point, i) => assert(point.every((value, axis) => Math.abs(value - expected[i][axis]) < .011), label + ': Tagesendwert ' + i));
        assert(paths.every(path => !/[HVZ]/.test(path)), label + ': offene Gesamtlinie ohne Flächenabschluss/Anfangskante');
        if (actual.length > 1) assert(actual[1][0] > actual[0][0], label + ': kein zweiter Wert am gleichen Anfangs-X');
        if (view.events.length) assert(rendered.includes('history-event history-buy'), label + ': Kaufmarke bleibt');
        assertEqual(JSON.stringify(view), before, label + ': vollständige Projektion bytegleich');
    }
}
// Feste Achsengrenzen plus unabhängige Originalbeträge prüfen die gesamte Stapelgeometrie.
for (const fixture of scaleCases.filter(f => f.values.length && f.values.some(Number.isFinite))) {
    const view = scaleView(fixture);
    for (const width of [280, 1366, 2560]) {
        const rendered = renderWealthHistorySvg(view, { width });
        const lines = assertStackGeometry(view, rendered, width, 460, 'Ausschnitt/' + fixture.values.join('/'), fixture);
        const bottom = 400;
        assert(lines.flat().every(p => p[1] >= 60 && p[1] <= bottom), 'Alle Gesamtwerte innerhalb des Plots');
        assert(rendered.includes('<g clip-path="url(#') && rendered.includes('height="340"'), 'Absolute Polygone werden ausschließlich am Plotrand geclippt');
        if (fixture.floor > 0) {
            assert(!rendered.includes('class="history-area '), 'Ausschnitt erzeugt keine Anlagenflächen');
            assert(rendered.includes('Achse beginnt bei') && rendered.includes('Gesamtfläche und Gesamtwert.') && !rendered.includes('Zusammensetzung siehe Legende'), 'ARIA erklärt den Achsenausschnitt ohne unsichtbare Anlagefarben zu versprechen');
        }
    }
}
// Jeder Zeitraum bekommt nur seine eigenen Originaltage; das frühe Extrem bleibt außerhalb.
const periodInput = { startDate: '2026-01-01', today: '2028-01-06', profiles: [{ id: 'period', currentCash: 2900000,
    cashHistory: { baselineValue: 2800000, entries: [{ date: '2026-01-02', value: 9000000 },
        { date: '2027-01-01', value: 2700000 }, { date: '2027-07-01', value: 2900000 }] }, lots: [] }] };
for (const [period, expected] of [['all', { floor: 0, ceiling: 12000000, step: 3000000 }],
    ['12m', { floor: 2600000, ceiling: 2950000, step: 50000 }], ['year', { floor: 2820000, ceiling: 2970000, step: 30000 }]]) {
    const view = evaluateWealthHistory({ ...periodInput, period });
    const scale = wealthHistoryScale(view.points);
    assertEqual(JSON.stringify(scale), JSON.stringify(expected), 'Zeitraum bestimmt eigene Skala ohne fremdes Extrem: ' + period);
    for (const width of [280, 1366, 2560]) assertStackGeometry(view, renderWealthHistorySvg(view, { width }), width, 460, 'Zeitraum/' + period, expected);
}
const positiveLong = scaleView({ values: Array.from({ length: 3650 }, (_, i) => i === 713 ? 2900000 : i === 1727 ? 2700000 : i === 1900 ? null : 2800000) });
for (const width of [280, 800, 1920]) {
    const rendered = renderWealthHistorySvg(positiveLong, { width });
    assertStackGeometry(positiveLong, rendered, width, 460, 'Positive Langreihe/' + width, { floor: 2600000, ceiling: 2950000 });
    assertEqual(totalRuns(rendered).length, 2, 'Positive Skala überbrückt unbekannten Zwischenabschnitt nicht');
    assert(Number(rendered.match(/data-drawing-points="(\d+)/)[1]) < 3650, 'Positive Langreihe wird tatsächlich reduziert');
    const coords = totalRuns(rendered).flatMap(path => linearVertices(path, false, 'Reduzierte positive Linie'));
    const yy = v => 400 - (v - 2600000) / 350000 * 340;
    assert([2700000, 2900000].every(v => coords.some(p => Math.abs(p[1] - yy(v)) < .011)), 'Extrema innerhalb des Zeitraums bleiben trotz Reduktion wirksam');
}
const purchaseHistory = offset => evaluateWealthHistory({ ...input, profiles: [{ ...input.profiles[0], lots: [{
    trancheId: 'buy', ticker: 'FIX', type: 'anleihe', shares: 2, purchasePrice: 10, purchaseDate: `2026-01-0${1 + offset}`
}] }], prices: { symbols: { FIX: { currency: 'EUR', days: Array.from({ length: 5 }, (_, i) => start + i),
    closes: [10, 11, 12, 13, 14], queried: [[start, start + 4]] } } } });
const firstBuy = purchaseHistory(0);
assertEqual(firstBuy.points[0].total, 40, 'Erster Tagesendwert enthält den Kauf vollständig');
assertTotalGeometry(firstBuy, 'Kauf am ersten Tag');
const laterBuy = purchaseHistory(2);
assertEqual(laterBuy.points[1].allocation.anleihe, 0, 'Vortag des späteren Kaufs enthält Nullbestand');
assertEqual(laterBuy.points[2].allocation.anleihe, 24, 'Kauftag enthält vollständigen Bestand zum Tageskurs');
assert(laterBuy.points[2].total > laterBuy.points[1].total && laterBuy.events[0].day === start + 2, 'Späterer Kauf bleibt belegte Bestandsstufe');
assertTotalGeometry(laterBuy, 'Späterer Kauf');
const cashStep = evaluateWealthHistory({ ...input, profiles: [{ ...input.profiles[0], currentCash: 10,
    cashHistory: { baselineValue: 20, entries: [{ date: '2026-01-03', value: 10 }] } }] });
assertEqual(cashStep.points.map(point => point.total).join(','), '20,20,10,10,10', 'Spätere Tagesgeldstufe bleibt vollständig');
assertTotalGeometry(cashStep, 'Tagesgeldstufe');
const cashCoordinates = assertStackGeometry(cashStep, renderWealthHistorySvg(cashStep), 1420, 460, 'Fünf Tagesabschlüsse')[0];
assertEqual(cashCoordinates.length, 5, 'Kurze Cashreihe zeichnet fünf Tagesabschlüsse');
assert(cashCoordinates.slice(1).every((p, i) => Math.abs(p[0] - cashCoordinates[i][0] - 256) <= .011),
    'Kurze Cashreihe besitzt tatsächlich 256 px Tagesabstand');
assertTotalGeometry({ ...history, events: [], points: history.points.map((point, i) => ({ ...point, total: i === 2 ? 20 : null })) }, 'Ein bekannter Punkt');
assertTotalGeometry({ ...history, events: [], points: history.points.map((point, i) => ({ ...point, total: i === 0 || i === 3 ? null : 20 })) }, 'Unbekannter Anfang und Lücke');
const interrupted = renderWealthHistorySvg({ ...history, points: history.points.map((point, i) => ({ ...point, total: i === 2 ? null : 20 })) });
assertEqual(totalRuns(interrupted).length, 2, 'Unbekannte Abschnitte werden niemals überbrückt');
const single = renderWealthHistorySvg({ ...history, points: [history.points[0]] });
assert(single.includes('history-total-point'), 'Einzelner Tageswert besitzt sichtbaren Punkt');
for (const width of [0, -1, NaN, Infinity, 80]) {
    assert(!/NaN|Infinity/.test(renderWealthHistorySvg(history, { width, height: 0 })), 'Ungültige oder kleine Größe bleibt endlich: ' + width);
}

// Spitzen zwischen Rastertagen, mehrere Ereignisse im selben Pixel und echte Lücken.
const longPoints = Array.from({ length: 3650 }, (_, i) => ({ day: start + i, date: historyDateForTest(start + i),
    total: 100 + Math.sin(i / 19), known: 100 + Math.sin(i / 19), gap: false,
    allocation: { anleihe: 90 + Math.sin(i / 19), cash: 10 } }));
function historyDateForTest(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }
longPoints[713].total = longPoints[713].known = 900; longPoints[713].allocation.anleihe = 890;
longPoints[1727].total = longPoints[1727].known = 2; longPoints[1727].allocation.anleihe = -8;
longPoints[1900].total = null;
for (let i = 2500; i < longPoints.length; i++) { longPoints[i].allocation.cash = 5; longPoints[i].total -= 5; }
for (let i = 3000; i < 3010; i++) longPoints[i].gap = true;
const longHistory = { ...history, points: longPoints, types: ['anleihe', 'cash'],
    range: { start, end: start + 3649 }, gaps: [[start + 3000, start + 3009]],
    events: [1100, 1101].map((i, j) => ({ day: start + i, kind: j ? 'sell' : 'buy', shares: 1, amount: 100, name: 'Beleg' })) };
const longBytes = JSON.stringify(longHistory);
for (const width of [280, 800, 1420, 1920]) {
    const rendered = renderWealthHistorySvg(longHistory, { width });
    assertStackGeometry(longHistory, rendered, width, 460, '3.650 Tage/' + width);
    const count = Number(rendered.match(/data-drawing-points="(\d+)/)[1]);
    const required = Number(rendered.match(/data-mandatory-points="(\d+)/)[1]);
    const budget = Number(rendered.match(/data-drawing-budget="(\d+)/)[1]);
    assert(count <= budget + required && count < 2000, 'Große Grafik begrenzt reguläre Punkte und zählt Pflichtpunkte separat');
    assert(count < longPoints.filter(p => Number.isFinite(p.total)).length, 'Lange Reihe wird tatsächlich ausgedünnt');
    const drawnX = totalRuns(rendered).flatMap(path => path.slice(1).split('L').map(pair => Number(pair.split(',')[0])));
    assertEqual(drawnX.length, count, 'Ausgegebene SVG-Pfadpunkte stimmen mit ausgewiesener Auswahl überein');
    const left = Math.min(90, width * .3), right = width - Math.min(50, width * .1);
    for (const i of [0, 3649, 713, 1727, 1099, 1100, 1101, 1102, 1899, 1901, 2499, 2500, 2999, 3000, 3009, 3010]) {
        const xx = left + (i + .5) / 3650 * (right - left);
        assert(drawnX.some(x => Math.abs(x - xx) <= .011), 'Extrema, Ereignisse, Lückengrenzen und Cashstufen erhalten: ' + i);
    }
    assertEqual(totalRuns(rendered).length, 2, 'Ausdünnung verbindet unbekannten Tag niemals');
}
const selected = selectHistoryDrawingIndices(longPoints, { budget: 120, eventDays: [start + 1100, start + 1101] });
assert(selected.indices.includes(1100) && selected.indices.includes(1101), 'Mehrere Ereignisse im selben Pixel behalten eigene Originalindizes');
assert(selected.indices.includes(713) && selected.indices.includes(1727), 'Unabhängige Originalindexprobe erhält globale Kursextrema');
const spark = renderHistorySparkline(longPoints, { width: 160, eventDays: [start + 1100, start + 1101] });
assert(Number(spark.match(/data-drawing-points="(\d+)/)[1]) <= 200 + Number(spark.match(/data-mandatory-points="(\d+)/)[1]), 'Kleinverlauf bleibt bei höchstens 200 regulären Punkten');
assertEqual(JSON.stringify(longHistory), longBytes, '3.650-Tage-Eingang bleibt bei allen Budgets bytegleich');
const centCourse = { range: { start, end: start + 3649 }, purchasePrice: 188.90,
    points: longPoints.map((p, i) => ({ day: p.day, value: i === 1900 ? null : i === 713 ? 144.67 : i === 1727 ? 22.13 : 100.45 })) };
for (const width of [700, 1200, 2200]) {
    const svg = renderHistoryCourseSvg(centCourse, { width, purchaseDate: '2021-06-01', sales: [{ day: start + 1100, shares: 1.25 }, { day: start + 1900, shares: 7 }] });
    assert(svg.includes('Höchster Kurs 144,67 €, niedrigster Kurs 22,13 €') && svg.includes('Kaufpreis 188,90 € (01.06.2021)'), 'Kursextrema mit Cent und tatsächlichem Kaufdatum aus vollständiger Reihe');
    assert(svg.includes('▼ 1,25 Stück') && !svg.includes('Verkauf 7 Stück'), 'Sichtbare Stückzahl nur für bekannten Verkaufskurs');
    assertEqual((svg.match(/<path class="history-course"/g) || []).length, 2, 'Kursdetail überbrückt keine unbekannten Kurse');
    assert(!/NaN|Infinity/.test(svg), 'Kursdetail bleibt endlich bei unterschiedlichen Pixelbreiten');
}
for (const values of [[], [null], [0], [12.34], [12.34, 12.34]]) {
    const svg = renderHistoryCourseSvg({ range: { start, end: start + values.length - 1 }, points: values.map((value, i) => ({ day: start + i, value })), purchasePrice: null });
    assert(!/NaN|Infinity/.test(svg), 'Fehlende, einzelne, Null- und konstante Kursreihen bleiben ehrlich und endlich');
}

// Fachorakel mit echter Entnahme, Bestandsverkauf, Spitzen und 3.650 Abschlüssen.
{
    const firstDay = historyDay('2016-01-01'), lastDay = firstDay + 3649;
    const dateAt = offset => historyDateForTest(firstDay + offset);
    const closes = Array.from({ length: 3650 }, (_, i) => i === 713 ? 180.67 : i === 1727 ? 42.13 : 100 + i / 100);
    const input = { startDate: dateAt(0), today: dateAt(3650),
        profiles: [{ id: 'a', currentCash: 450, cashHistory: { baselineValue: 500, entries: [{ date: dateAt(1100), value: 450 }] },
            lots: [{ trancheId: 'oracle', shares: 10, purchaseDate: dateAt(0), purchasePrice: 88.90, ticker: 'ORACLE', type: 'anleihe' }] }],
        events: [{ actionId: 'sale', eventType: 'sale_reconciled', profileId: 'a', trancheId: 'oracle', executedAt: dateAt(1500),
            actual: { sharesSold: 2, grossProceeds: 230 }, result: { beforeShares: 12, remainingShares: 10 } }],
        prices: { symbols: { ORACLE: { currency: 'EUR', days: closes.map((_, i) => firstDay + i), closes, queried: [[firstDay, lastDay]] } } } };
    const full = evaluateWealthHistory(input);
    const expectedTotals = closes.map((price, i) => price * (i < 1500 ? 12 : 10) + (i < 1100 ? 500 : 450));
    assertEqual(JSON.stringify(full.points.map(p => p.total)), JSON.stringify(expectedTotals), 'Unabhängige Stück-/Cashrechnung bestätigt sämtliche 3.650 Tageswerte');
    const first = expectedTotals[0], last = expectedTotals.at(-1), change = last - first;
    const peak = Math.max(...expectedTotals);
    let worst = 0;
    // Alternative Orakelberechnung: jeder Tiefpunkt relativ zum Maximum seiner Vorgeschichte.
    for (let i = 0; i < expectedTotals.length; i++) worst = Math.max(worst, (1 - expectedTotals[i] / Math.max(...expectedTotals.slice(0, i + 1))) * 100);
    const check = () => {
        const m = full.metrics;
        assert(m.change === change && m.percent === change / first * 100 && m.withdrawals === 50 && m.adjusted === change + 50
            && m.adjustedPercent === (change + 50) / first * 100 && m.peak.value === peak && m.drawdown.percent === worst,
            'Vollreihenorakel erhält Veränderung/Prozent/Entnahme/Bereinigung/Höchststand/Rückgang');
    };
    const before = JSON.stringify(full); check();
    for (const width of [280, 800, 1920]) {
        renderWealthHistorySvg(full, { width }); renderHistorySparkline(full.points, { width: Math.min(200, width), eventDays: full.events.map(e => e.day) });
        check(); assertEqual(JSON.stringify(full), before, 'Darstellung bei mehreren Budgets erhält Messbeginn, Endwert und sämtliche Fachbytes');
    }
}

const manyTicks = [...renderWealthHistorySvg(scaleView({ values: [2700000, null, 2900000], known: [2700000, 3550000, 2900000] })).matchAll(/data-history-tick="([^"]+)"/g)].map(m => Number(m[1]));
assertEqual(manyTicks.length, 6, 'Zwanzig Basisintervalle gleichmäßig auf fünf sichtbare Intervalle ausgedünnt');
for (const [intervals, ceiling] of [[11, 3150000], [13, 3250000], [17, 3450000], [19, 3550000]]) {
    const fixture = scaleCases.find(f => f.floor === 2600000 && f.ceiling === ceiling);
    assertEqual((fixture.ceiling - fixture.floor) / fixture.step, intervals, 'Eigener Primzahlfall mit fester Skalenbasis: ' + intervals);
    const ticks = [...renderWealthHistorySvg(scaleView(fixture)).matchAll(/data-history-tick="([^"]+)"/g)].map(m => Number(m[1]));
    assert(ticks.length >= 4, 'Primzahlfall behält mindestens drei Intervalle: ' + intervals);
    assertEqual(ticks[0], 2600000, 'Primzahlfall erhält feste Untergrenze');
    assertEqual(ticks.at(-1), ceiling, 'Primzahlfall erhält feste Obergrenze');
}
