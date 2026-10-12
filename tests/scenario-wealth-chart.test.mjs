import { formatScenarioWealthTick, buildScenarioWealthPath, buildScenarioEntries, renderScenarioWealthChart, scenarioEndWealth } from '../app/simulator/scenario-wealth-chart.js';
import { renderScenarioList } from '../app/simulator/scenario-log-view.js';
import { createWealthFan, createWealthFanPath, recordWealthFanYear, commitWealthFanPath } from '../app/simulator/wealth-fan-aggregation.js';
import { formatCurrency } from '../app/simulator/simulator-utils.js';
import { ScenarioAnalyzer } from '../app/simulator/scenario-analyzer.js';

const rows = [
    { jahr: 1, recordType: 'financial_year', inflation: 0, portfolio_total_end: 1100, inflation_factor_cum: 1.1 },
    { jahr: 2, recordType: 'financial_year', inflation: 0, portfolio_total_end: 990, inflation_factor_cum: .99 },
    { jahr: 3, recordType: 'financial_year', inflation: 0, portfolio_total_end: 1485, inflation_factor_cum: 1.485 },
    { jahr: 4, recordType: 'financial_year', inflation: 0, portfolio_total_end: 1600, inflation_factor_cum: null },
    { jahr: 5, recordType: 'financial_year', inflation: 0, portfolio_total_end: null, inflation_factor_cum: 2 },
    { jahr: 6, recordType: 'financial_year', inflation: 0, portfolio_total_end: 2200, inflation_factor_cum: 2.2 },
    { jahr: 7, recordType: 'terminal_death', portfolio_total_end: 999999, inflation_factor_cum: 3 }
];
const scenario = { key: 'worst', label: '<img onerror="probe">', endVermoegen: 2200, failed: false, logDataRows: rows };
const before = JSON.stringify(scenario);
const nominal = buildScenarioWealthPath(scenario, { mode: 'nominal', initialWealth: 1000 });
const real = buildScenarioWealthPath(scenario, { initialWealth: 1000 });
assertEqual(JSON.stringify(nominal.points.map(p => p.value)), '[1000,1100,990,1485,1600,null,2200]', 'Nominal: jede Messung einschließlich Start ist ein Rohwert');
for (const index of [0, 1, 2, 3, 6]) assert(Math.abs(real.points[index].value - 1000) < 1e-9, `Reale Messposition ${index}: unabhängiges 1000-Euro-Orakel`);
assertEqual(JSON.stringify(real.points.slice(4, 6).map(p => p.value)), '[null,null]', 'Fehlende Inflation und fehlendes Vermögen bleiben Lücken');
assertEqual(real.endpoint, 'death', 'Tod endet den Pfad ohne Finanzmessung');
assertEqual(real.points.at(-1).year, 6, 'Tod erzeugt keinen Punkt in Jahr 7');
assertEqual(real.missingCount, 2, 'Missingness wird gezählt');
assertEqual(scenarioEndWealth(scenario, 'real'), 2200 / 2.2, 'Endmarke verwendet den Faktor der letzten Finanzmessung');
assertEqual(scenarioEndWealth({ ...scenario, logDataRows: [] }, 'real'), null, 'Altlogs ohne Faktor behaupten keinen Realwert');
assertEqual(scenarioEndWealth({ ...scenario, logDataRows: [{ inflation_factor_cum: 1e-308 }] }), null, 'Nicht endliche Realumrechnung bleibt fehlend');
const ruin = buildScenarioWealthPath({ ...scenario, failed: true, logDataRows: [...rows.slice(0, 2), { jahr: 3, recordType: 'terminal_ruin' }, ...rows] }, { initialWealth: 1000 });
assertEqual(JSON.stringify(ruin.points.at(-1)), '{"year":3,"value":0}', 'Ruin endet genau im Ruinjahr mit beobachteter Null');
assertEqual(ruin.points.length, 4, 'Nachruin-/Schattenzeilen werden nicht gezeichnet');
assertEqual(ruin.endpoint, 'ruin', 'Ruin-Endpunkt bleibt explizit');
const accumulation = buildScenarioWealthPath({ logDataRows: [{ jahr: 1, phase: 'accumulation', portfolio_total_end: 1500, inflation_factor_cum: 1.25 }] }, { initialWealth: 900 });
assertEqual(JSON.stringify(accumulation.points), '[{"year":0,"value":900},{"year":1,"value":1200}]', 'Anspar-/Einjahreslauf beginnt tatsächlich bei 900 und endet real bei 1200');
const firstDeath = buildScenarioWealthPath({ logDataRows: [{ jahr: 1, recordType: 'terminal_death' }] }, { initialWealth: 900 });
assertEqual(firstDeath.points.length, 1, 'Tod vor erstem Finanzjahr lässt ausschließlich den Startwert');
assertEqual(JSON.stringify(scenario), before, 'Die Projektion verändert weder Logs noch Quellidentität');

// Auswahl bleibt exakt die vorhandene floor(n*p)-Auswahl, auch bei Gleichständen.
const analyzer = new ScenarioAnalyzer(3);
for (const [index, endVermoegen] of [[2, 200], [1, 100], [0, 100]]) analyzer.addRun({ index, endVermoegen, failed: false, lebensdauer: 1, maxKuerzung: index, isRandomSample: true, logDataRows: rows });
const logs = analyzer.buildScenarioLogs();
const entries = buildScenarioEntries(logs);
for (const [key, index] of [['worst', 0], ['p5', 0], ['p10', 0], ['p25', 0], ['p50', 1], ['p75', 2], ['best', 2]]) {
    const entry = entries.find(e => e.id === `char_${key}`);
    assertEqual(entry.scenario.sourceIdentity.absoluteRunIndex, index, `${key}: nominaler floor-Index mit unverändertem Gleichstandsvertrag`);
    assert(entry.scenario === logs.characteristic.find(s => s.key === key), `${key}: Quellobjekt bleibt identisch`);
}
assertEqual(entries.filter(e => e.group === 'care').length, 0, 'Ohne Pflege keine erfundenen Pflegekennungen');
assertEqual(entries.filter(e => e.group === 'sample').length, 3, 'Kleiner Batch enthält genau seine drei Stichproben');
const svg = renderScenarioWealthChart([{ id: 'char_worst', scenario, group: 'wealth', color: '#9c3b33' }, { id: 'char_care', scenario, group: 'care', color: '#947037' }], { selectedId: 'char_worst', initialWealth: 1000 });
assert(svg.includes('<title id="scenarioWealthTitle">') && svg.includes('<desc id="scenarioWealthDescription">'), 'SVG besitzt zugänglichen Titel und Beschreibung');
assert(svg.includes('stroke-dasharray="6 4"') && svg.includes('stroke-width="3.5"') && svg.includes('<circle'), 'Pflegestrichart, aktiver Pfad und Endmarke sind vorhanden');
assert(svg.includes('&lt;img') && !svg.includes('<img'), 'Szenariobezeichnungen bleiben sicherer Text');
assert(!/NaN|Infinity/.test(svg), 'Lücken erzeugen keine ungültigen SVG-Koordinaten');
for (const value of [0, 1e-200, 1e308]) {
    const html = renderScenarioWealthChart([{ id: 'x', group: 'sample', color: '#aaa', scenario: { logDataRows: [{ jahr: 1, inflation: 0, portfolio_total_end: value, inflation_factor_cum: 1 }] } }], { initialWealth: value, selectedId: 'x' });
    assert(!/NaN|Infinity/.test(html), `Extremwert ${value}: endliche Koordinaten`);
}
const large = new ScenarioAnalyzer(31);
for (let index = 30; index >= 0; index--) large.addRun({ index, endVermoegen: index * 10, failed: false, lebensdauer: 1, maxKuerzung: 0, isRandomSample: large.shouldCaptureRandomSample(index), careEverActive: index === 5, totalCareYears: index === 5 ? 4 : 0, totalCareAdditionalNeedRealEur: index === 5 ? 500 : 0, p1CareEntryAge: index === 5 ? 80 : null, logDataRows: rows });
const largeLogs = large.buildScenarioLogs(), largeEntries = buildScenarioEntries(largeLogs);
assertEqual(largeEntries.filter(entry => entry.group === 'sample').length, 15, 'Vollständige Stichprobe bietet exakt 15 Kennungen');
for (const [key, index] of [['worst', 0], ['p5', 1], ['p10', 3], ['p25', 7], ['p50', 15], ['p75', 23], ['p90', 27], ['p95', 29], ['best', 30]]) assertEqual(largeEntries.find(entry => entry.scenario.key === key).scenario.sourceIdentity.absoluteRunIndex, index, `${key}: unabhängiges Indexorakel für 31 Läufe`);
assertEqual(largeEntries.filter(entry => entry.group === 'care').length, 4, 'Vier echte Pflegekennungen; kein fehlender P2-Eintritt erfunden');
assert(largeEntries.filter(entry => entry.group === 'care').every(entry => entry.scenario.sourceIdentity.absoluteRunIndex === 5), 'Mehrere Pflegekennungen behalten denselben beobachteten Quelllauf');
const styled = renderScenarioWealthChart(largeEntries, { initialWealth: 1000, selectedId: 'char_maxCut' });
assert(styled.includes('stroke-width="1"') && styled.includes('stroke-dasharray="6 4"'), 'Stichproben sind dünn; Risiko-/Pflegepfade sind gestrichelt');

// Unabhängiges SVG-Orakel: fester Maßstab 3000 Euro / vier Jahre. Die Inflation
// enthält positive und negative Jahre, sodass Jahresbeginn/Nullinflation auffallen.
const yearlyScenario = {
    key: 'p50', label: 'Quelllauf sieben', sourceIdentity: { absoluteRunIndex: 7 },
    endVermoegen: 2079, failed: false, logDataRows: [
        { jahr: 1, recordType: 'financial_year', portfolio_total_end: 1320, inflation_factor_cum: 1, inflation: 10 },
        { jahr: 2, recordType: 'financial_year', portfolio_total_end: 1188, inflation_factor_cum: 1.1, inflation: -10 },
        { jahr: 3, recordType: 'financial_year', portfolio_total_end: 1856.25, inflation_factor_cum: .99, inflation: 25 },
        { jahr: 4, recordType: 'financial_year', portfolio_total_end: 2079, inflation_factor_cum: 1.2375, inflation: 20 }
    ]
};
const scaleScenario = { key: 'p95', label: 'Maßstabsanker', sourceIdentity: { absoluteRunIndex: 3 },
    endVermoegen: 3000, logDataRows: [{ jahr: 4, portfolio_total_end: 3000, inflation_factor_cum: 1, inflation: 0 }] };
const measuredEntries = buildScenarioEntries({ characteristic: [yearlyScenario, scaleScenario] });
const observedRealByRun = [7777, 6666, 5555, 3000, 4444, 3333, 9999, 1400, 8888];
const measuredFan = createWealthFan(4), measuredFanPath = createWealthFanPath(4, 1000);
for (let year = 1; year <= 4; year++) recordWealthFanYear(measuredFanPath, year, 1000, 1000);
commitWealthFanPath(measuredFan, measuredFanPath);
const fanStates = [['gültiger Fächer', measuredFan], ['fehlender Fächer', null], ['inkompatibler Fächer', { ...measuredFan, schemaVersion: 'incompatible' }]];
function renderedPoints(svg, id) {
    const group = [...svg.matchAll(/<g data-scenario-id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)].find(match => match[1] === id)?.[2];
    assert(group !== undefined, `${id}: tatsächlich gerenderte SVG-Gruppe vorhanden`);
    const d = group.match(/<path d="([^"]*)"/)[1];
    return [...d.matchAll(/([ML])([\d.-]+) ([\d.-]+)/g)].map(match => ({ command: match[1], x: Number(match[2]), y: Number(match[3]) }));
}
function assertMeasured(svg, id, expected, label, displayWidth = 1100) {
    const actual = renderedPoints(svg, id);
    assertEqual(actual.length, expected.length, `${label}: exakt die beobachteten Punkte`);
    for (let i = 0; i < expected.length; i++) {
        const [year, value, command = i ? 'L' : 'M'] = expected[i];
        assertClose(actual[i].x, 88 + year * (displayWidth - 180) / 4, .0051, `${label}: Jahresposition ${year}`);
        assertClose(actual[i].y, 410 - value * 322 / 3000, .0051, `${label}: Euro-Orakel ${value} in Jahr ${year}`);
        assertEqual(actual[i].command, command, `${label}: Verbindung in Jahr ${year}`);
    }
    assert(!/NaN|Infinity/.test(svg), `${label}: ausschließlich endliche SVG-Koordinaten`);
}
const untouched = JSON.stringify({ yearlyScenario, scaleScenario, observedRealByRun });
for (const [label, wealthFan] of fanStates) {
    const options = { wealthFan, initialWealth: 1000, selectedId: 'char_p50', realByRun: observedRealByRun };
    const svg = renderScenarioWealthChart(measuredEntries, options);
    assertEqual(svg.includes('data-fan-background="true"'), wealthFan === measuredFan, `${label}: gültiger Hintergrund oder Platzhalterzustand`);
    assertMeasured(svg, 'char_p50', [[0, 1000], [1, 1200], [2, 1200], [3, 1500], [4, 1400]], label);
    for (const displayWidth of [640, 1000, 1600]) {
        for (const [mode, values] of [['real', [1000, 1200, 1200, 1500, 1400]], ['nominal', [1000, 1320, 1188, 1856.25, 2079]]]) {
            const sized = renderScenarioWealthChart(measuredEntries, { ...options, mode, displayWidth });
            assert(sized.includes(`viewBox="0 0 ${displayWidth} 470"`), 'Hostbreite verändert ausschließlich die SVG-Geometrie');
            assertMeasured(sized, 'char_p50', values.map((value, year) => [year, value]), `${label}/${mode}: alle Jahreswerte nach Größenprojektion`, displayWidth);
            assert(sized.includes('y1="410"') && sized.includes('y1="88"'), 'Vertikale Plotspanne bleibt 322 von 470 SVG-Einheiten');
        }
    }
    const endpoint = Number(svg.match(/<circle cx="1008" cy="([^"]+)"/)[1]);
    assertClose((410 - endpoint) * 3000 / 322, 1400, 1e-8, `${label}: aktive Endmarke entspricht realByRun[7]`);
    assertEqual(scenarioEndWealth(yearlyScenario, 'real', observedRealByRun), 1400, `${label}: Endwerthelfer liest den globalen Quellindex`);
    const list = renderScenarioList(measuredEntries, 'char_p50', 'real', options);
    assert(list.includes(`Quelllauf sieben · ${formatCurrency(1400)}`), `${label}: tatsächliche Liste zeigt denselben Quelllaufendwert`);
    for (const sourceIndex of [0, 1, 6, 8]) {
        const neighbor = { ...yearlyScenario, sourceIdentity: { absoluteRunIndex: sourceIndex } };
        assertEqual(scenarioEndWealth(neighbor, 'real', observedRealByRun), observedRealByRun[sourceIndex], `${label}: Gegenprobe Quellindex ${sourceIndex}`);
        assert(renderScenarioList([{ ...measuredEntries[0], scenario: neighbor }], 'char_p50', 'real', options)
            .includes(`Quelllauf sieben · ${formatCurrency(observedRealByRun[sourceIndex])}`), `${label}: Liste verwendet keine Listenposition`);
    }
    assertMeasured(renderScenarioWealthChart(measuredEntries, { ...options, mode: 'nominal' }), 'char_p50',
        [[0, 1000], [1, 1320], [2, 1188], [3, 1856.25], [4, 2079]], `${label}: nominale Rohwerte`);
    const missing = { ...yearlyScenario, logDataRows: yearlyScenario.logDataRows.map((row, index) => index === 1 ? { ...row, inflation: null } : row) };
    assertMeasured(renderScenarioWealthChart([{ ...measuredEntries[0], scenario: missing }, measuredEntries[1]], options),
        'char_p50', [[0, 1000], [1, 1200]], `${label}: fehlende Inflation bleibt auch danach fehlend`);
    for (const badInflation of [undefined, null, '10', NaN, Infinity, -100, -150]) {
        const invalid = { ...yearlyScenario, logDataRows: [{ ...yearlyScenario.logDataRows[0], inflation: badInflation }] };
        const invalidEntries = [{ ...measuredEntries[0], scenario: invalid }, measuredEntries[1]];
        const invalidSvg = renderScenarioWealthChart(invalidEntries, options);
        assertMeasured(invalidSvg, 'char_p50', [[0, 1000]], `${label}: ungültige Inflation ${badInflation}`);
        assert(!invalidSvg.includes('<circle'), `${label}: fehlender Realendpunkt hat keine Ersatzmarke`);
        assertMeasured(renderScenarioWealthChart(invalidEntries, { ...options, mode: 'nominal' }),
            'char_p50', [[0, 1000], [1, 1320]], `${label}: nominal trotz Inflation ${badInflation}`);
    }
    for (const patch of [{ inflation_factor_cum: 0 }, { inflation_factor_cum: Infinity },
        { inflation_factor_cum: 1e-308 }, { portfolio_total_end: Infinity }]) {
        const invalid = { ...yearlyScenario, logDataRows: [{ ...yearlyScenario.logDataRows[0], ...patch }] };
        assertMeasured(renderScenarioWealthChart([{ ...measuredEntries[0], scenario: invalid }, measuredEntries[1]], options),
            'char_p50', [[0, 1000]], `${label}: ungültiger Faktor oder nicht endliches Ergebnis`);
    }
    const recovered = { ...yearlyScenario, logDataRows: yearlyScenario.logDataRows.map((row, index) => index === 1 ? { ...row, portfolio_total_end: null } : row) };
    assertMeasured(renderScenarioWealthChart([{ ...measuredEntries[0], scenario: recovered }, measuredEntries[1]], options),
        'char_p50', [[0, 1000], [1, 1200], [3, 1500, 'M'], [4, 1400]], `${label}: Lücke wird nicht überbrückt`);
    for (const [recordType, expected] of [
        ['terminal_death', [[0, 1000], [1, 1200]]],
        ['terminal_ruin', [[0, 1000], [1, 1200], [2, 0]]]
    ]) {
        const terminal = { ...yearlyScenario, logDataRows: [yearlyScenario.logDataRows[0],
            { jahr: 2, recordType, portfolio_total_end: 999999 }, ...yearlyScenario.logDataRows.slice(1)] };
        const terminalSvg = renderScenarioWealthChart([{ ...measuredEntries[0], scenario: terminal }, measuredEntries[1]], options);
        assertMeasured(terminalSvg, 'char_p50', expected, `${label}: ${recordType}`);
        assert(terminalSvg.includes(recordType === 'terminal_death' ? 'Tod · letzte Messung' : 'Ruin Jahr 2'), `${label}: explizite Terminalmarkierung`);
    }
    const earlyDeath = { ...yearlyScenario, logDataRows: [{ jahr: 1, recordType: 'terminal_death' }] };
    assertMeasured(renderScenarioWealthChart([{ ...measuredEntries[0], scenario: earlyDeath }, measuredEntries[1]], options),
        'char_p50', [[0, 1000]], `${label}: Tod vor erstem Finanzjahr erhält Start`);
}
assertEqual(JSON.stringify({ yearlyScenario, scaleScenario, observedRealByRun }), untouched, 'Renderer und Liste erhalten Rohlogs, Quellidentitäten und Realaggregate bytegleich');
assertEqual(buildScenarioWealthPath(yearlyScenario, { initialWealth: 1000 }).points[1].value, 1320, 'Direkter Legacy-Helfer behält Jahresbeginnbasis trotz beobachteter Inflation');
assertEqual(scenarioEndWealth(yearlyScenario), 2079 / 1.2375, 'Direkter Legacy-Endwerthelfer ohne realByRun bleibt unverändert');

for (const [value, expected] of [[0, '0'], [200000.49, '200.000'], [1500000, '1,5 Mio.'], [1000000, '1 Mio.']]) {
    assertEqual(formatScenarioWealthTick(value), expected, `Tick ${value}: deutscher Kurztext ohne Cent`);
}
const shortTicks = renderScenarioWealthChart([{ id: 'tick', group: 'wealth', color: 'var(--good)', scenario: { label: 'Tickprobe', logDataRows: [] } }], { initialWealth: 2000000 });
assert(shortTicks.includes('>500.000</text>') && shortTicks.includes('>1,5 Mio.</text>'), 'Echter SVG-Renderer verwendet Kurzwerte');

for (const displayWidth of [1100, 1450]) {
    const html = renderScenarioWealthChart([{ id: 'tick', group: 'wealth', color: 'var(--good)', scenario: { label: 'Tickprobe', logDataRows: [] } }], { initialWealth: 2000000, displayWidth });
    assert(html.includes(`width="${displayWidth}" height="470" viewBox="0 0 ${displayWidth} 470"`), 'Szenariochart: numerische Breite und Höhe passen zum gewählten Koordinatenraum');
}

// Unabhängige Auswahl-/P95-Orakel mit extremen Pfaden aus jeder Gruppe.
{
    const make = (key, value) => ({ key, label: `Probe ${key}`, endVermoegen: value,
        logDataRows: [{ jahr: 1, portfolio_total_end: value, inflation_factor_cum: 1, inflation: 100 }] });
    const source = { characteristic: [make('p50', 800), make('p95', 2000), make('best', 143500000),
        make('highestCareNeed', 12000000), make('maxCut', 9000000)], random: [make('sample', 7000000)] };
    const original = JSON.stringify(source);
    const axis = html => Number(html.match(/<line x1="88"[^>]*y1="88"[^>]*\/><text[^>]*>([^<]+)/)[1].replaceAll('.', '').replace(',', '.'));
    const draw = (entries, opts) => renderScenarioWealthChart(entries, opts);
    for (const wealthFan of [measuredFan, null, { ...measuredFan, schemaVersion: 'invalid' }]) for (const mode of ['real', 'nominal']) {
        const entries = buildScenarioEntries(source), opts = { mode, wealthFan, selectedId: 'char_p50', initialWealth: 100 };
        const expectedBasis = mode === 'real' ? 1000 : 2000;
        const base = draw(entries, opts);
        assertEqual(axis(base), expectedBasis, `${mode}: P95 bestimmt Basis unabhängig von Best Case und Fächer`);
        for (const [id, value] of [['char_best', 143500000], ['char_highestCareNeed', 12000000], ['char_maxCut', 9000000], ['rand_sample', 7000000]]) {
            const extended = draw(entries, { ...opts, selectedId: id });
            const group = renderedPoints(extended, id);
            assertClose(group.at(-1).y, 88, .0051, `${mode}/${id}: Auswahlmaximum liegt vollständig auf der erweiterten Achse`);
            assertEqual(axis(draw(entries, opts)), expectedBasis, `${mode}/${id}: Rückwahl stellt Basis wieder her`);
            assert(base.includes(`data-scenario-id="${id}"`) && base.includes(`Probe ${id.replace(/^(char_|rand_)/, '')} ·`) && base.includes('€" aria-label='), `${id}: Randmarke trägt Maximum, Euro, Namen und identische Auswahlkennung`);
            assert(extended.includes(`class="scenario-line  is-active" opacity="1"`) && base.includes('opacity="0.45"'), 'Gewählter Pfad bleibt kräftig, andere bleiben gedämpft');
            assert(!/NaN|Infinity/.test(extended), 'Extreme Auswahl bleibt endlich');
        }
        assert(base.includes('<clipPath') && base.includes('<g clip-path="url(#scenarioWealthPlot-'), 'Fächer, Plot, Endmarken und Trefferflächen liegen gemeinsam im Clip');
        const next = draw(entries, opts);
        assert(base.match(/<clipPath id="([^"]+)/)[1] !== next.match(/<clipPath id="([^"]+)/)[1], 'Clipkennungen sind bei mehreren Renderern unterscheidbar');
        const missingP95 = buildScenarioEntries({ ...source, characteristic: source.characteristic.filter(s => s.key !== 'p95') });
        assertEqual(axis(draw(missingP95, opts)), mode === 'real' ? 400 : 800, 'Ohne P95 bestimmen übrige Vermögensbeobachtungen ohne Best die Basis');
        const emptyP95 = buildScenarioEntries({ ...source, characteristic: source.characteristic.map(s => s.key === 'p95' ? { ...s, logDataRows: [] } : s) });
        assertEqual(axis(draw(emptyP95, opts)), mode === 'real' ? 400 : 800, 'P95 ohne Jahresmessung verdrängt den Ersatzpfad nicht');
    }
    const onlyBest = buildScenarioEntries({ characteristic: [make('best', 1e308)] });
    const noSelection = { initialWealth: 100, selectedId: '' };
    assertEqual(axis(draw(onlyBest, noSelection)), 100, 'Ohne Vermögensbeobachtungen und Fächer gilt nur vorhandener Start');
    const fanModel = (await import('../app/simulator/wealth-fan-aggregation.js')).buildWealthFanModel(measuredFan, 'real');
    const fanBasis = Math.max(...fanModel.years.map(row => row.quantiles[95].value));
    const fanSvg = draw(onlyBest, { ...noSelection, wealthFan: measuredFan });
    const gridTop = renderedPoints(fanSvg, 'char_best')[0].y;
    assertClose(gridTop, 410 - 100 * 322 / fanBasis, .0051, 'P95-Jahresbänder sind erst nach fehlenden charakteristischen Vermögensmessungen Ersatz');
    assert(!/NaN|Infinity/.test(draw(onlyBest, noSelection)), 'Ungewählter extremer Ausreißer überläuft keine SVG-Koordinate');
    assertEqual(axis(draw(buildScenarioEntries({}), {})), 1, 'Ohne Beobachtungen gilt sicherer positiver Zeichenmaßstab');
    assertEqual(JSON.stringify(source), original, 'P95-Skalierung und Auswahl ändern keine Quellobjekte oder Messwerte');
}

{
    const entries = buildScenarioEntries({ characteristic: [
        { key: 'worst', label: 'Worst', logDataRows: [{ jahr: 1, portfolio_total_end: 10, inflation_factor_cum: 1, inflation: 0 }] },
        { key: 'p95', label: 'P95', logDataRows: [{ jahr: 1, portfolio_total_end: 100, inflation_factor_cum: 1, inflation: 0 }] }
    ], random: [{ key: 'sample', label: 'Stichprobe', logDataRows: [{ jahr: 1, portfolio_total_end: 50, inflation_factor_cum: 1, inflation: 0 }] }] });
    for (const selectedId of entries.map(entry => entry.id)) {
        const svg = renderScenarioWealthChart(entries, { selectedId, mode: 'nominal' });
        const ordered = [...svg.matchAll(/<g data-scenario-id="([^"]+)" class="scenario-line/g)].map(match => match[1]);
        assertEqual(ordered.at(-1), selectedId, 'Ausgewählte Linie wird zuletzt gezeichnet: ' + selectedId);
        assertEqual(ordered.length, entries.length, 'Alle gedämpften Linien bleiben auswählbar');
    }
}

// Schnittpunkte und vollständige Trefferrechtecke aus dem produktiven SVG,
// unabhängig von der Layoutfunktion. Die Plotkante liegt bei 1000 Euro.
{
    const anchor = { id: 'char_p95', group: 'wealth', color: '#666', scenario: {
        label: 'P95', logDataRows: [{ jahr: 4, portfolio_total_end: 1000, inflation: 0, inflation_factor_cum: 1 }] } };
    const make = (id, values, color = '#357') => ({ id, group: 'sample', color, scenario: {
        label: `Original ${id}`, logDataRows: values.map(([jahr, value]) => ({ jahr, portfolio_total_end: value, inflation: 0, inflation_factor_cum: 1 })) } });
    const boxes = html => [...html.matchAll(/<foreignObject x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)">([\s\S]*?)<\/foreignObject>/g)]
        .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], button: m[5], id: m[5].match(/data-scenario-id="([^"]+)"/)[1] }));
    const draw = (others, displayWidth = 1100) => renderScenarioWealthChart([anchor, ...others], { mode: 'nominal', initialWealth: 500, displayWidth });
    const single = make('single', [[1, 750], [2, 1250]]);
    for (const width of [520, 760, 1100, 1600]) {
        const html = draw([single], width), [box] = boxes(html);
        assertClose(box.x + box.w / 2, 88 + 1.5 * (width - 180) / 4, 1e-9, 'Einzelmarke liegt am unabhängig berechneten Austritt in Jahr 1,5');
        assert(box.button.includes('>↑ 1.250</button>') && box.button.includes('style="color:#357;'), 'Randmarkentext ist kurz und trägt die Linienfarbe');
        assert(box.button.includes('title="Original single · 1.250 €"') && box.button.includes('aria-label="Original single · 1.250 €"'), 'Tooltip und zugänglicher Name erhalten Originalname und Euro');
        assert(!html.includes('Marken scrollbar'), 'Randmarken erzeugen keinen Scrollkasten');
    }
    const missing = boxes(draw([make('gap', [[1, 500], [2, null], [3, 2000]])]))[0];
    assertClose(missing.x + missing.w / 2, 88 + 3 * 920 / 4, 1e-9, 'Messlücke: erste überragende Beobachtung statt interpoliertem Austritt');
    const withoutStart = renderScenarioWealthChart([anchor, make('noStart', [[2, 2000]])], { mode: 'nominal' });
    const first = boxes(withoutStart)[0];
    assertClose(first.x + first.w / 2, 88 + 2 * 920 / 4, 1e-9, 'Fehlender Startwert wird nicht als interpolierbarer Vorgänger verwendet');
    const crowded = Array.from({ length: 29 }, (_, index) => make(`dense_${index}`, index < 3
        ? [[1, 200000]] : index > 25 ? [[4, 1001]] : [[1, 750], [2, 1250 + index]]));
    const raw = JSON.stringify(crowded);
    for (const width of [300, 520, 760, 1100, 1600]) {
        const html = draw(crowded, width), rects = boxes(html);
        assertEqual(rects.length, crowded.length, 'Dichte Randmarken: keine Kennung entfällt');
        for (const [index, box] of rects.entries()) {
            assert([box.x, box.y, box.w, box.h].every(Number.isFinite), 'Randmarkenkoordinaten sind endlich');
            assert(box.x >= 8 && box.x + box.w <= width - 8 + 1e-8 && box.y >= 8 && box.y + box.h <= 86, 'Vollständige Randmarkenfläche liegt innerhalb des oberen SVG-Rands');
            for (const other of rects.slice(index + 1)) assert(box.x + box.w <= other.x || other.x + other.w <= box.x
                || box.y + box.h <= other.y || other.y + other.h <= box.y, 'Paarweise zweidimensionale Trefferrechtecke kollidieren nicht');
        }
        assertEqual(JSON.stringify(boxes(draw([...crowded].reverse(), width))), JSON.stringify(rects), 'Markenlayout ist unabhängig von der Eingangsreihenfolge stabil');
        if (width >= 760) assert(rects.every(box => box.button.includes('font-size:11px')), 'Dichte Marken behalten bei regulärer Chartbreite lesbare native Schrift');
    }
    assert(!/NaN|Infinity/.test(draw([make('extreme', [[1, -1e308], [2, 1e308]])])), 'Extreme endliche Werte ergeben einen stabilen interpolierten Austritt');
    assertEqual(JSON.stringify(crowded), raw, 'Randmarkenlayout verändert keine Quellzeile');
}
