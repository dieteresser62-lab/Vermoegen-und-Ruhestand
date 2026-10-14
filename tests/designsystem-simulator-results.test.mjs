import { createHash } from 'node:crypto';
import { prepareMonteCarloViewModel, buildSummaryData } from '../app/simulator/results-metrics.js';
import { buildMonteCarloOutcomeInventoryV1 } from '../app/simulator/monte-carlo-chunk-result.js';
import { renderKpiCard, renderKpiDashboard, renderSummary } from '../app/simulator/results-renderers.js';
import { renderStressReplayComparisonV1, renderStressReplayPatchPreviewV1, renderStressReplayVariantListV1 } from '../app/simulator/stress-replay-renderer.js';
import { renderWorstRunLog } from '../app/simulator/simulator-results.js';
import { readSources, validateSimulatorResults, validateSimulatorResultMarkup, validateFoundation, createPresentationTestDocument, rules, variables, resolveValue, contrast } from './designsystem-source-contract.mjs';
import { crisisPercent, projectBacktestOverview, renderSimulatorOverview, setOverviewBacktestStatus } from '../app/simulator/simulator-result-overview.js';
import { simulatorRunAssumptions as heads } from '../app/simulator/simulator-run-assumptions.js';
import { renderScenarioList } from '../app/simulator/scenario-log-view.js';
import { buildScenarioEntries } from '../app/simulator/scenario-wealth-chart.js';
import { tokenizeHTML, matchesSelector } from './funktionsinventar-contract.mjs';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { STRATEGY_OPTIONS } from '../types/strategy-options.js';

// Verkäufe sind neutrale Richtungsangaben in beiden Hosts, auch auf markierten Zeilen.
{
    const sources = readSources(), css = sources['simulator.css'];
    const parsed = rules('simulator.css', css);
    const saleRules = parsed.filter(rule => rule.selector.includes('backtest-trade-sale'));
    assertEqual(saleRules.length, 2, 'Beide aktiven Verkaufsregeln werden geprüft');
    assert(saleRules.every(rule => rule.declarations.color === 'var(--text-main)'),
        'Alle Verkaufsregeln verwenden neutralen Texttoken, keine aktive rote Verkaufsregel bleibt');
    const sharedSale = saleRules.find(rule => rule.selector.includes('#scenarioLogOutput'));
    for (const host of ['simulationLog', 'scenarioLogOutput'])
        assert(sharedSale?.selector.includes(`#${host} .protocol-table td.backtest-trade-sale`), 'Neutraler Verkauf gilt in beiden Protokollhosts');
    assert(parsed.filter(rule => rule.selector.includes('backtest-trade-buy')).every(rule => rule.declarations.color === 'var(--accent)'),
        'Kaufhervorhebung bleibt beim bisherigen Akzenttoken');
    const tokens = { ...variables(sources['css/tokens.css']), ...variables(css) };
    const backgrounds = new Set(parsed.filter(rule => /#(?:simulationLog|scenarioLogOutput)\b/.test(rule.selector))
        .flatMap(rule => [rule.declarations.background, rule.declarations['background-color']])
        .filter(value => /^var\(--[\w-]+\)$/.test(value || '')));
    for (const required of ['var(--surface)', 'var(--surface-sunken)', 'var(--border)', 'var(--bad-soft)'])
        assert(backgrounds.has(required), 'Protokollhintergründe umfassen alternierende, Hover- und Ruinzeilen');
    for (const background of backgrounds)
        assert(contrast(resolveValue('var(--text-main)', tokens), resolveValue(background, tokens)) >= 4.5,
            `Neutraler Verkauf erreicht mindestens 4,5:1 auf ${background}`);
    for (const source of ['mc', 'backtest']) for (const sign of [1, -1, 0]) {
        const options = { source, strategyMode: STRATEGY_OPTIONS.THREE_BUCKET_JILGE, goldAktiv: true };
        const columns = getProtocolColumns(options).filter(column => ['neta', 'netg', 'handl-bd'].includes(column.id));
        assertEqual(columns.length, 3, 'Aktien-, Gold- und Bondhandel werden geprüft');
        const raw = { netTradeEq: sign * 100, netTradeGold: sign * 100,
            threeBucket: { bondSaleAmount: sign > 0 ? 100 : 0, bondRefillGross: sign < 0 ? 100 : 0, bondRefillNet: sign < 0 ? 100 : 0 } };
        const row = source === 'mc' ? raw : { netA: sign * 100, netG: sign * 100, row: raw };
        const html = renderProtocolTable([row], { ...options, columns });
        const cells = [...html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)];
        for (const [, attrs, text] of cells) {
            assert(text === (sign > 0 ? 'verkauft 100\u00a0€' : sign < 0 ? 'gekauft 100\u00a0€' : '—'),
                'Richtungswort, Betrag und Vorzeichensemantik bleiben für alle Handelsarten erhalten');
            assert(sign === 0 ? !attrs.includes('backtest-trade-') : attrs.includes(sign > 0 ? 'backtest-trade-sale' : 'backtest-trade-buy'),
                'Verkauf/Kauf/kein Handel bleiben unterscheidbar');
        }
    }
}

// Synthetische Eingaben; Digests stammen vom Basiscommit a7fcdfc7.
// Bestehende Digests bleiben erhalten. Nur NBSP in formatierten value-Feldern wird vor Prozent-/Zeiteinheiten zurückgeführt; Fachwerte und Gründe bleiben vollständig geschützt; die R8-Projektion benennt jeden erlaubten Ton einzeln.
export const fixtures = [
    ...[0, 1, 50, 100].map(floorCoveragePct => ({
        results: { outcomeInventory: buildMonteCarloOutcomeInventoryV1({ requestedRuns: 1000, ruin: 1000 - floorCoveragePct * 10, all_dead: 0, horizon_exhausted: floorCoveragePct * 10, technical_error: 0 }) },
        totalRuns: 1000, failCount: 1000 - floorCoveragePct * 10, inputs: {}
    })),
    { results: { outcomeInventory: buildMonteCarloOutcomeInventoryV1({ requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 2, technical_error: 0 }) }, totalRuns: 4, failCount: 1, inputs: {} },
    { results: { outcomeInventory: buildMonteCarloOutcomeInventoryV1({ requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 1, technical_error: 1 }) }, totalRuns: 4, failCount: 1, inputs: {} },
    { results: {}, totalRuns: 0, failCount: 0, inputs: {} },
    { results: {
        finalOutcomes: { p10: 55000.009, p50: 487501.009, p50_successful: 212500.009, p90: 490000.009, distribution: { sampleSize: 1000 }, successfulCount: 900, successfulMissingness: null },
        taxOutcomes: { p50: 12.341 }, depotErschoepfungsQuote: 20.01,
        realWithdrawalP10: { realEur: 12345.678, p50RealEur: 45678.912, sampleSize: 1000 },
        maxDrawdowns: { p50: 22.331, p90: 34.251, sampleSize: 1000 },
        realMaxDrawdowns: { p50: 25.401, p90: 38.759, sampleSize: 1000 },
        kpiLebensdauer: { mean: 24.1 }, cutYearSharePct: { p50: 14.2, sampleSize: 1000 },
        extraKPI: { pflege: { p1: { entryRatePct: 32, entryRateNumerator: 320, entryRateDenominator: 1000, realCostEurP50: 123456.789, sampleSize: 320 } } },
        stressKPI: { presetKey: 'SYNTHETIC', years: 4, maxDD: { p50: 20, p90: 40 }, realWithdrawalP10: { realEur: 23456.789, sampleSize: 1000 } },
        heatmap: [[1, 2]], bins: [0, 1, 2]
    }, totalRuns: 1000, failCount: 100, inputs: { pflegefallLogikAktivieren: true } }
];
const baselineDigests = ["97ec246702c6c6b14dd99d896dc4409ded4d6c65fdd650b82541216f319ed33e","4e44212a0221373f61729121c3b415aff06490d443789df502c12d45079caca8","b40258dbb724686f5e56b9e4dab05ba8b4f33542dbba353f428e412a6e70910f","5d74e466c2ccf7d79c3690f3aae5557c0f6cbf2dace6da0f398c4536fe89140a","e2e406534bfc9d150922e7747d005dee899c88c0a3d34d5cfd48e7103e18a985","2b2db99f02c6833e2c40a0b9a6c67e62f22142dac91f6dabb942220738b7af77","d42b5d182f884d198d7305128f5ef701732629bcc20a388c8e1ced2775ac7085","b647474e5e4c15364efdc5a63b5f17e71acb5c3eac74b170971889c75ef8c46d"];
// Nur diese Karten dürfen gegenüber den unveränderten Basisdigests neutral werden.
const r8Tones = {
    primary: [['Reale Depotentnahme P10', 'danger']],
    drawdownKpis: [['Max. Drawdown nominal (Median)', 'warning'], ['Max. Drawdown real (Median)', 'warning'],
        ['Max. Drawdown nominal (P90)', 'danger'], ['Max. Drawdown real (P90)', 'danger']],
    stress: [['Max. Drawdown (Median, Stress)', 'warning'], ['Max. Drawdown (P90, Stress)', 'danger'],
        ['Reale Depotentnahme P10 (Stress)', 'danger']]
};
const approvedEditorialChanges = [
    [
        "vorsorglich nicht ausgewiesen; die Endzustände bleiben sichtbar.",
        "fail-closed nicht ausgewiesen; das Outcome-Inventar bleibt sichtbar."
    ],
    [
        "Anteil Tod plus Horizontende an",
        "Anteil all_dead plus horizon_exhausted an"
    ],
    [
        "Endzustände",
        "Terminale Outcomes"
    ],
    [
        "der Anzahl Läufe",
        "der Runzahl"
    ],
    [
        "Ruin oder",
        "Ruin (`isRuin`) oder"
    ],
    [
        "Pflegereserve zählen",
        "Pflegebucket zählen"
    ],
    [
        "Median der Lauf-P10",
        "Median der Run-P10"
    ],
    [
        "laufbasierten",
        "runbasierten"
    ]
];
const displayBaseline = value => {
    const copy = JSON.parse(JSON.stringify(value, (key, field) => key === 'value' && typeof field === 'string' ? field.replace(/\u00a0(?=%|Jahre|Monate)/g, ' ') : field));
    for (const [cards, allowed] of [[copy.kpiDashboard.primary, r8Tones.primary],
        [copy.kpiDashboard.drawdownKpis, r8Tones.drawdownKpis], [copy.stressMetrics?.kpis, r8Tones.stress]]) {
        if (!cards) continue;
        for (const [title, previousTone] of allowed) {
            const matches = cards.filter(card => card.title === title);
            assertEqual(matches.length, 1, `R8-Karte eindeutig vorhanden: ${title}`);
            assertEqual(matches[0].tone, 'default', `R8-Ton direkt neutral: ${title}`);
            const html = renderKpiCard(matches[0]);
            assert(!/is-green|is-amber|is-red/.test(html), `Tatsächliches R8-Markup neutral: ${title}`);
            matches[0].tone = previousTone;
        }
    }
    // Neue reine Darstellungsfelder sind separat gegen das Inventar geprüft.
    for (const card of copy.summaryCards) {
        for (const key of ['displayRole', 'displayValue', 'intervalText', 'requestedRuns', 'outcomes', 'countText']) delete card[key];
    }
    // SIM-1 ergänzt nur sichtbare Geldbasen; die vorhandenen Fachwerte bleiben im Digest.
    for (const [cards, title, expected] of [
        [copy.kpiDashboard.primary, 'Reale Depotentnahme P10', 'heutige Euro · unabhängig vom Euro-Schalter'],
        [copy.kpiDashboard.primary, 'Ø Steuerersparnis Verlustvortrag', 'nominal · unabhängig vom Euro-Schalter'],
        [copy.stressMetrics?.kpis, 'Reale Depotentnahme P10 (Stress)', 'heutige Euro · unabhängig vom Euro-Schalter']
    ]) {
        const card = cards?.find(card => card.title === title);
        if (card) { assertEqual(card.priceBasis, expected, 'SIM-1 kennzeichnet die feste Geldbasis: ' + title); delete card.priceBasis; }
    }
    for (const card of copy.careMetrics?.cards || []) {
        assert(['', 'heutige Euro · unabhängig vom Euro-Schalter', 'nominal · unabhängig vom Euro-Schalter'].includes(card.priceBasis), 'SIM-1 Pflegekarte nennt ihre Geldbasis');
        delete card.priceBasis;
    }
    // FR-6/D18 ändern die Darstellung dieser Legacy-Karte; Rohwert bleibt hashrelevant.
    const legacyFlexCard = copy.kpiDashboard.primary.find(card => card.title === 'mehr als 10 % unter Wunsch-Flex');
    assert(legacyFlexCard, 'FR-6-Legacy-Karte ist ausdrücklich beschriftet');
    assert(legacyFlexCard.tooltip.includes('einschließlich genau 10 %'), 'FR-6-Legacy-Karte erklärt unveränderte inklusive Altgrenze');
    assertEqual(legacyFlexCard.description, 'Anteil der Entnahmejahre mit Flex-Kürzung ab 10 %.', 'D18-Legacy-Karte zeigt nur den kompakten Erklärungssatz');
    // Das Viewmodell enthält keine Rohpopulation; Stichprobengröße aus dem geprüften Beschreibungssatz lesen.
    const observedRuns = /Stichprobe: (\d+) Läufe/.exec(legacyFlexCard.tooltip)?.[1] || '0';
    assertEqual(legacyFlexCard.tooltip, `Älteres Ergebnis: ältere Grundlage ohne Mindest-Flex-Messung. Medianer Anteil abgeschlossener Dekumulationsjahre mit mindestens 10 % Wunsch-Kürzung (einschließlich genau 10 %). Stichprobe: ${observedRuns} Läufe.`, 'Nur die freigegebene FR-6-Legacy-Erklärung wird im Altvergleich zurückgeführt');
    assertEqual(legacyFlexCard.layout, 'exact-risk', 'FR-6-Zentralwert erhält vollständige Exaktwertdarstellung');
    assertEqual(legacyFlexCard.decisionCritical, true, 'FR-6-Zentralwert bleibt im einfachen Modus sichtbar');
    legacyFlexCard.title = 'Anteil Kürzungsjahre (≥ 10 %)';
    legacyFlexCard.description = `Medianer Anteil erfolgreich abgeschlossener Dekumulationsjahre mit Flex-Kürzung von mindestens 10 %; Nenner sind abgeschlossene Dekumulationsjahre mit endlicher Kürzungsentscheidung. Stichprobe: ${observedRuns} Läufe.`;
    delete legacyFlexCard.layout; delete legacyFlexCard.decisionCritical; delete legacyFlexCard.tooltip;
    const restoreText = item => {
        if (Array.isArray(item)) return item.map(restoreText);
        if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, field]) =>
            [key, ['title', 'description', 'secondaryLabel'].includes(key) && typeof field === 'string'
                ? approvedEditorialChanges.filter(([current]) => current === 'Endzustände' ? key === 'title' : current === 'Ruin oder' ? key === 'description' : true).reduce((text, [current, previous]) => text.replaceAll(current, previous), field)
                : restoreText(field)]));
        return item;
    };
    // Einzige monetäre Änderung in diesen acht Fixtures: Pflegekosten P1,
    // 123456.789 -> vollständige 123.457 € statt bisheriger Tausenderstufe.
    const careCard = copy.careMetrics?.cards.find(card => card.title === 'Realer Pflege-Mehrbedarf P1 (Median)');
    if (careCard) {
        assertEqual(careCard.value, '123.457 €', 'Freigegebene Ganz-Euro-Karte erhält volle Gruppierung');
        careCard.value = '120.000 €';
    }
    return restoreText(copy);
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previousDocument = globalThis.document;
globalThis.document = { body: { classList: { contains: () => false } } };
try {
    const fragments = [];
    for (const [index, fixture] of fixtures.entries()) {
        const before = JSON.stringify(fixture);
        const vm = prepareMonteCarloViewModel(fixture);
        assertEqual(digest(displayBaseline(vm)), baselineDigests[index], `Vollständiges Viewmodell mit einzeln erlaubter Text-/Anzeigeprojektion, unveränderten Rohdaten und R8-Tönen: Fall ${index + 1}`);
        assertEqual(JSON.stringify(fixture), before, 'Darstellung verändert keine Rohdaten');
        assertEqual(vm.summaryCards[0].tone, index < 4 || index === 7 ? 'default' : 'warning', 'Floor-Warnbedingungen unverändert; vorhandene warnungsfreie Deckung neutral');
        const summary = { innerHTML: '' };
        renderSummary(summary, vm.summaryCards); fragments.push(summary.innerHTML);
        if (index < 4) assert(!summary.innerHTML.split('</div>')[0].match(/is-success|is-warning|is-danger/), 'Auch Null und niedrige positive Floor-Deckung bleiben neutral');
        else if (index < 7) assert(summary.innerHTML.includes('is-warning'), 'Unsicherheit, Technik und Leerdaten bleiben Warnungen');
        for (const card of vm.summaryCards) assert(summary.innerHTML.includes(card.description), 'Summary enthält den vollständigen vorhandenen Grund');
        const dashboard = { innerHTML: '', style: {} };
        renderKpiDashboard(dashboard, vm.kpiDashboard); fragments.push(dashboard.innerHTML);
        fragments.push(...vm.kpiDashboard.primary.map(renderKpiCard));
    }
    for (const options of [{}, { error: new Error('Synthetischer Patchfehler') }, { preview: { materialChangeGroups: ['dynamicFlex'], warnings: ['multi_factor'] } }]) fragments.push(renderStressReplayPatchPreviewV1(options));
    fragments.push(renderStressReplayVariantListV1({ workspace: { variants: [{ id: 'baseline', role: 'baseline', label: 'Baseline' }, { id: 'alternative', role: 'alternative', label: 'Variante', materialChangeGroups: ['dynamicFlex'] }] } }));
    fragments.push(renderStressReplayComparisonV1({}), renderStressReplayComparisonV1({ comparisonState: { status: 'error', error: { code: 'SYNTHETIC_ERROR', message: 'Synthetischer Fehler' } } }));
    fragments.push(renderStressReplayComparisonV1({ comparison: {
        overallStatus: 'blocked_technical_error', variants: [{ variantId: 'baseline', label: 'Baseline', summary: {} }, { variantId: 'alternative', label: 'Variante', summary: {} }],
        pairwise: [{ variantId: 'alternative', comparable: false }]
    }, results: [{ variantId: 'baseline', yearResults: [{ yearIndex: 0, nominalValueEur: 100 }] }] }));
    fragments.push(renderWorstRunLog([{ jahr: 1, dynamik: { refillAmount: 12, goldTradeAmount: -3 } }], undefined));
    const sources = readSources();
    assertEqual(validateSimulatorResults(sources, fragments).join('\n'), '', 'Originale Quellen und tatsächlich erzeugte Ergebnis-/Replay-/Logstile bestehen');
    assertEqual(validateFoundation(sources).join('\n'), '', 'Ergebniserzeuger behalten den Grundvertrag');
    for (const [path, mutate, expected] of [
        ['simulator.css', s => s.replace('.kpi-card .kpi-description {', '.kpi-card .kpi-description { opacity: 0.6;'), 'Textdeckkraft'],
        ['simulator.css', s => s.replace('.summary-item {', '.summary-item { color: #eee;'), 'Ergebnisfarbe'],
        ['simulator.css', s => s.replace('color: var(--text-main);\n    margin-bottom: 6px;', 'color: var(--good);\n    margin-bottom: 6px;'), 'Ergebnis-Kontrastrolle'],
        ['simulator.css', s => s.replace('.kpi-card .value-line {', '.kpi-card .value-line { color: rgba(0,0,0,.5);'), 'Ergebnisfarbe'],
        ['app/simulator/simulator-results.js', s => s.replace('color: var(--text-muted);', 'color: darkred;'), 'Ergebnis-JS-Farbe'],
        ['app/simulator/results-renderers.js', s => s + '\nnode.style.opacity = 0.7;', 'Ergebnis-JS-Deckkraft'],
        ['css/tokens.css', s => s.replace('--text-muted: #56626a', '--text-muted: #eeeeee'), 'Ergebnis-Kontrast']
    ]) {
        const changed = mutate(sources[path]);
        assert(changed !== sources[path], `Wirksame Gegenprobe: ${expected}`);
        assert(validateSimulatorResults({ ...sources, [path]: changed }, fragments).some(e => e.includes(expected)), `Abgelehnte Gegenprobe: ${expected}`);
    }
    for (const bad of [
        renderKpiCard({ title: 'Test', value: '0 %', tone: 'default' }).replace('ds-metric', ''),
        fragments.find(s => s.includes('mc-wealth-summary')).replace('summary-item ds-card', 'summary-item'),
        renderStressReplayPatchPreviewV1({ error: 'Fehler' }).replace('ds-note-error', ''),
        '<p style="color: #777">Text</p>', '<p style="opacity: .8">Text</p>'
    ]) assert(validateSimulatorResultMarkup(bad).length > 0, 'Gegenprobe im tatsächlich erzeugten Markup abgewiesen');
} finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
}

// Krisenanzeige und Laufanlass am echten Übersichtsrenderer, mit synthetischen Jahresdaten.
for (const [value, expected] of [[-0.3, '0 %'], [-12.4, '−12 %'], [-12.6, '−13 %'], [5, '5 %'],
    [NaN, '—'], [Infinity, '—'], [-Infinity, '—'], [null, '—']]) {
    assertEqual(crisisPercent(value), expected, `Ganzzahliger Krisenanzeigeprozentsatz für ${value}`);
}
try {
    const doc = createPresentationTestDocument();
    doc.querySelectorAll = () => [];
    doc.addEventListener = () => {};
    doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
    const backtest = doc.createElement('section'); backtest.id = 'overviewBacktest'; backtest.querySelector = () => null;
    const crises = doc.createElement('section'); crises.id = 'overviewCrises';
    globalThis.document = doc;
    setOverviewBacktestStatus('completed');
    for (const [total, expected] of [[99700, '0 %'], [87600, '−12 %'], [87400, '−13 %'], [105000, '5 %']]) {
        const result = { request: { startYear: 2020, endYear: 2020 }, outcome: { kind: 'completed' },
            portfolioStart: 100000, completedYears: 1, metrics: { values: { wealth_end_nominal_eur: total,
                withdrawal_total_nominal_eur: 12345.67, flex_reduction_years_gte_10_pct: 1,
                flex_reduction_longest_streak_gte_10_pct: 1, tax_total_nominal_eur: 987.65 } },
            rows: [{ jahr: 2020, wertAktien: total, wertGold: 0, liquiditaet: 0, row: {
                health_bucket_start: 0, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 0
            } }] };
        const before = JSON.stringify(result);
        const originalChangePct = projectBacktestOverview(result).crises[0].changePct;
        for (const [metadata, foot] of [
            [{ automatic: true, opening: true }, 'Automatisch gerechnet beim Öffnen'],
            [{ automatic: true, opening: false }, 'Automatisch neu gerechnet nach Annahmenänderung'],
            [{ automatic: false }, 'Manuell gerechnet']
        ]) {
            const values = { inputs: {}, settings: result.request };
            heads.observe('backtest', values);
            const token = heads.begin('backtest', values, metadata);
            heads.complete('backtest', token, result);
            renderSimulatorOverview();
            assert(crises.innerHTML.includes('<h3>Corona</h3><p>2020</p>'), 'Einjahreskrise zeigt nur das Jahr');
            assert(crises.innerHTML.includes(`<strong>${expected}</strong>`), 'Krisenkarte zeigt den gerundeten Anzeigeprozentsatz mit U+2212');
            assert(!crises.innerHTML.includes('−0 %') && !crises.innerHTML.includes('-12 %') && !crises.innerHTML.includes('-13 %'), 'Kein Minus an Null und kein ASCII-Minus in der Krisenanzeige');
            assert(backtest.innerHTML.includes(`<p class="sim-backtest-foot">${foot}</p>`), 'Fußtext unterscheidet Öffnung, automatische Revision und manuellen Lauf');
            assert(backtest.innerHTML.includes('title="Älteres Ergebnis:') && backtest.innerHTML.includes('Längstens 1 Jahre am Stück.'),
                'Kürzungsserie erhält die bestehende Hinweisrolle und die lokale ungerahmte Darstellung');
            assert(backtest.innerHTML.includes('<strong>12.346 €</strong>') && backtest.innerHTML.includes('<strong>988 €</strong>')
                && backtest.innerHTML.includes('<strong>1 / 1</strong>'), 'Backtestkennzahlen behalten ihre vorhandenen Werte und Anzeigeformatierung');
            const output = tokenizeHTML(backtest.innerHTML);
            const rows = output.elements.filter(node => matchesSelector({ elements: [node] }, '.sim-outcome-metrics > .ds-row'));
            assertEqual(rows.length, 3, 'Drei Kennzahlen bleiben direkte Zeilen im gemeinsamen Label-/Wertraster');
            assert(rows.every(row => row.children[0]?.tag === 'span' && row.children[1]?.tag === 'strong'),
                'Alle Kennzahlzeilen behalten Label und Wert als erste Rasterzellen');
            const cutMetric = rows[1];
            assert(matchesSelector({ elements: [cutMetric] }, '.sim-cut-metric')
                && cutMetric.children.length === 2 && cutMetric.attrs.title?.includes('Längstens 1 Jahre am Stück.'),
                'Kürzungsdauer steht direkt nach dem Wert innerhalb der zweiten Kennzahl');
            assertEqual(projectBacktestOverview(result).crises[0].changePct, originalChangePct, 'Unveränderter changePct-Rohwert nach Darstellung');
            assertEqual(JSON.stringify(result), before, 'Übersichtsrenderer verändert keine Jahresdaten');
        }
    }
} finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
}

{
    const sources = readSources(), html = sources['Simulator.html'], css = sources['simulator.css'];
    const mcTree = tokenizeHTML(html);
    const resultHost = mcTree.elements.find(node => node.attrs.id === 'monteCarloResults');
    const hostIds = resultHost.children.map(node => node.attrs.id);
    assert(hostIds.indexOf('monteCarloAnswers') < hostIds.indexOf('monteCarloSummary')
        && hostIds.indexOf('monteCarloAnswers') >= 0, 'Kernantworten stehen im echten Markup vor Kennzahlen und Grafiken');
    assert(css.includes('.sim-mc-answers { display: grid;') && css.includes('minmax(min(100%, 320px), 1fr)')
        && css.includes('.sim-mc-answer { min-width: 0; overflow-wrap: anywhere; }'), 'Antwortzeilen nutzen responsives Raster und ungekürzte Texte');
    const flexNoteStyle = Object.assign({}, ...rules('simulator.css', css)
        .filter(rule => rule.selector === '.sim-mc-answer .sim-flex-note').map(rule => rule.declarations));
    assertEqual(flexNoteStyle['font-size'], 'var(--balance-help)', 'MC-Flex-Notiz nutzt die normale Hinweisgröße für kompakten Umbruch');
    assertEqual(flexNoteStyle['white-space'], 'normal', 'MC-Flex-Notiz darf normal umbrechen');
    assertEqual(flexNoteStyle.overflow, 'visible', 'MC-Flex-Notiz bleibt vollständig sichtbar');
    assertEqual(flexNoteStyle['text-overflow'], 'clip', 'MC-Flex-Notiz erhält keine Ellipse');
    assert(!html.includes('Endvermögen und Floor-Deckung') && html.includes('aria-label="Ergebnisse der Monte-Carlo-Analyse"'), 'Zusätzlicher MC-Abschnittstitel entfällt bei erhaltener zugänglicher Ergebnisbezeichnung');
    assert(css.includes('.sim-assumption-step h2, #tab-montecarlo h2 { border-bottom: 0; padding-bottom: 0; }')
        && css.includes('.sim-assumption-step h2::after, #tab-montecarlo h2::after { content: none; }'), 'Annahmen und MC-Karten setzen die alte Unterlinie lokal zurück');
    assert(css.includes('.scenario-paths-split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);')
        && css.includes('.scenario-wealth-svg { height: 470px;'), 'Große Szenariofläche reserviert zwei Drittel und 470 px Höhe');
    // Quelltextvertrag: Eine positive Szenario-Mindestbreite darf ausschließlich
    // im schmalen Viewport gelten. Browsermessungen sichern die echte Geometrie.
    const scenarioMinimumWidthValid = source => {
        const narrowBlocks = [];
        const remaining = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(
            /@media\s*\(width\s*<\s*768px\)\s*\{([^{}]*\{[^{}]*\}[^{}]*)\}/g,
            (_, block) => { narrowBlocks.push(block); return ''; });
        const scenarioRules = source => rules('simulator.css', source).filter(rule =>
            rule.selector.split(',').some(selector => selector.trim() === '.scenario-wealth-svg'));
        const wideMinimums = scenarioRules(remaining).flatMap(rule => rule.entries.filter(([key]) => key === 'min-width'));
        return wideMinimums.length > 0 && wideMinimums.every(([, value]) => value === '0')
            && narrowBlocks.length === 1 && scenarioRules(narrowBlocks[0]).some(rule => rule.declarations['min-width'] === '760px');
    };
    assert(scenarioMinimumWidthValid(css), 'R-01: 760 px Szenario-Mindestbreite gilt ausschließlich unter 768 px; darüber gilt min-width: 0');
    const sharedSvgRule = '.scenario-wealth-svg, .wealth-distribution-svg { display: block; width: 100%;';
    for (const regression of [
        css.replace('.scenario-wealth-svg { height: 470px; min-width: 0;', '.scenario-wealth-svg { height: 470px; min-width: 760px;'),
        css.replace(sharedSvgRule, `${sharedSvgRule} min-width: 760px;`),
        css.replace('@media (width < 768px)', '@media (width < 769px)'),
        `${css}\n@media (min-width: 768px) { .scenario-wealth-svg { min-width: 760px; } }`
    ]) assert(regression !== css && !scenarioMinimumWidthValid(regression), 'R-01: Wiedereinführung der Mindestbreite ab 768 px verletzt den Quelltextvertrag');
    assert(rules('simulator.css', css).some(rule => rule.selector === '.wealth-distribution-svg'
        && rule.declarations['min-width'] === '760px'), 'Verteilungsdiagramm behält seine bisherige Mindestbreite');
    assert(css.includes('.scenario-selection-pane { position: relative; min-height: 0; }')
        && css.includes('.scenario-list { flex: 1; min-height: 0; overflow-y: auto;'), 'Liste ist unabhängig auf Grafik samt Legende begrenzt');
    // Der auto-hohe details-Inhaltsslot ist kein Bezug für eine Prozenthöhe.
    const selectionBoundedOnDesktop = source => {
        const declarations = selector => rules('simulator.css', source).find(rule => rule.selector === selector)?.declarations;
        const disclosure = declarations('#scenarioSelectionDisclosure');
        const content = declarations('.scenario-selection-content');
        return disclosure?.position === 'absolute' && disclosure.inset === '0'
            && content?.position === 'absolute' && content.inset === '0'
            && content.display === 'flex' && content['flex-direction'] === 'column';
    };
    assert(selectionBoundedOnDesktop(css), 'R-02: Desktop-Auswahl ist unabhängig von der Prozenthöhe im details-Inhaltsslot begrenzt');
    for (const regression of [
        css.replace('.scenario-selection-content { position: absolute; inset: 0;', '.scenario-selection-content { height: 100%;'),
        css.replace('.scenario-selection-content { position: absolute; inset: 0;', '.scenario-selection-content { position: absolute;'),
        css.replace('#scenarioSelectionDisclosure { position: absolute; inset: 0;', '#scenarioSelectionDisclosure { position: static; inset: 0;')
    ]) assert(regression !== css && !selectionBoundedOnDesktop(regression), 'R-02: Prozenthöhe oder fehlende absolute Begrenzung verletzen den Quelltextvertrag');
    assert(/@media \(max-width: 1100px\)\s*\{[^{}]*#scenarioSelectionDisclosure\s*\{[^{}]*\}[^{}]*#scenarioSelectionSummary\s*\{[^{}]*\}[^{}]*\.scenario-selection-content\s*\{ position: static; inset: auto; height: 400px; max-height: 60vh; \}/.test(css),
        'R-02: Schmale Auswahl bleibt im normalen Fluss mit 400 px Höhe und höchstens 60vh');
    assert(/@media print\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\.scenario-selection-content\s*\{ position: static; inset: auto; height: auto; max-height: none; \}/.test(css),
        'R-02: Druckauswahl bleibt im normalen Fluss mit automatischer Höhe');
    assert(html.includes('aria-describedby="scenarioListHint"') && html.includes('Weitere Szenarien: in der Liste scrollen')
        && css.includes('.scenario-list:focus-visible'), 'Scrollhinweis und Tastaturfokus sind geschützt');
    assert(css.includes('.scenario-list-item { display: grid; grid-template-columns: 20px minmax(0, 1fr) minmax(0, auto);')
        && css.includes('.scenario-list-item .scenario-details { grid-column: 2 / -1; white-space: normal;')
        && css.includes('.scenario-list-item .scenario-value { text-align: right;'), 'Namen, Werte und umbrechende Personendetails besitzen eigene Rasterplätze');
    assert(css.includes('.scenario-list-item[data-scenario-group="care"] .scenario-swatch')
        && !css.includes('.scenario-list-group:nth-child'), 'Linienmuster folgen Gruppenkennungen statt Überschriftenpositionen');
    assert(css.includes('.scenario-outliers { font: 11px') && css.includes('.ds-scenario-outlier:focus-visible'), 'Randmarken bleiben kompakt und fokussierbar');
    assert(!css.includes('.scenario-sample-chips') && html.includes('id="scenarioGroups"') && html.includes('id="scenarioSelectionDisclosure"'), 'Eine responsive Auswahl ersetzt Chips und Dropdown');
    assert(css.includes('.scenario-list-item:focus-visible') && css.includes('.scenario-list-item[aria-selected="true"] { background: var(--accent-soft);'), 'Szenarioauswahl bleibt messinghell und besitzt sichtbaren Tastaturfokus');
    for (const [id, label] of [['toggle-log-detail', 'Detailliert'], ['toggle-care-details', 'Pflege-Spalten']]) {
        assert(new RegExp(`id="${id}"[^>]*><span class="ds-slider" aria-hidden="true"></span><span>${label}</span>`).test(html), `${id}: native Checkbox und kompakte Beschriftung erhalten`);
    }
    for (const format of ['Json', 'Csv']) assert(new RegExp(`id="exportScenarioLog${format}"[^>]*aria-label="${format.toUpperCase()} herunterladen"><svg aria-hidden="true"`).test(html), `${format}: eindeutiger Downloadknopf mit verborgenem Symbol`);
    assert(html.includes('Den hier gewählten Lauf kannst du anschließend im Stresspfad-Replay fixieren.'), 'Replayhinweis verwendet Du-Form');
}

// Begrenztes Kaskadenorakel für die vier Altregeln und die lokalen Buttonregeln.
// Es misst keine Browsergeometrie. Die Knoten stammen aus dem echten Renderer.
{
    const source = readSources()['simulator.css'];
    const keys = ['worst', 'p5', 'p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'best',
        'care1', 'care2', 'care3', 'care4', 'care5', 'longestLife', 'maxCut'];
    const scenario = key => ({ key, label: `Synthetischer Lauf ${key}`, endVermoegen: 100,
        logDataRows: [{ jahr: 1, portfolio_total_end: 100, inflation_factor_cum: 1 }] });
    const entries = buildScenarioEntries({ characteristic: keys.map(scenario),
        random: Array.from({ length: 15 }, (_, i) => scenario(`sample_${i}`)) });
    const tree = tokenizeHTML(['wealth', 'care', 'risk', 'sample'].map(activeGroup => renderScenarioList(entries, 'char_p50', 'real', { activeGroup })).join(''));
    const buttons = tree.elements.filter(node => node.tag === 'button');
    assertEqual(buttons.length, 31, 'Kaskadenfixture umfasst neun Vermögens-, fünf Pflege-, zwei Risikozeilen und 15 Stichprobenzeilen');
    const oldPrefix = 'button:not([class*="ds-"]):not(.tab-btn)';
    const specificity = selector => {
        const flat = selector.replace(/:not\(([^)]+)\)/g, '$1');
        const attributes = flat.match(/\[[^\]]+\]/g) || [];
        const rest = flat.replace(/\[[^\]]+\]/g, '');
        return [(rest.match(/#[\w-]+/g) || []).length,
            attributes.length + (rest.match(/\.[\w-]+|:[\w-]+/g) || []).length,
            (rest.match(/(?:^|[ >])(?:button|span|small)\b/g) || []).length];
    };
    assertEqual(JSON.stringify(specificity(oldPrefix)), '[0,2,1]', 'Altregel hat Spezifität (0,2,1)');
    assertEqual(JSON.stringify(specificity('.scenario-list-item')), '[0,1,0]', 'Zeilenregel allein verliert gegen die Altregel');
    const matches = (selector, node, state) => {
        let eligible = true;
        selector = selector.replace(/:not\(([^)]+)\)/g, (_, inner) => {
            const hit = inner === '[class*="ds-"]' ? (node.attrs.class || '').includes('ds-')
                : matchesSelector({ elements: [node] }, inner);
            if (hit) eligible = false;
            return '';
        }).replace(/:(hover|active|disabled|focus-visible)/g, (_, pseudo) => {
            if (state !== pseudo) eligible = false;
            return '';
        });
        return eligible && matchesSelector({ elements: [node] }, selector);
    };
    const candidates = css => rules('simulator.css', css).filter(rule =>
        rule.selector.startsWith(oldPrefix) || /^\.scenario-list-item(?::[\w-]+|\[aria-selected="true"\])?$/.test(rule.selector)
        || rule.selector === '.scenario-sample-chips .scenario-sample-chip');
    const cascade = (css, node, state) => {
        const matched = candidates(css).filter(rule => matches(rule.selector, node, state));
        matched.sort((a, b) => {
            const aa = specificity(a.selector), bb = specificity(b.selector);
            return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
        });
        const result = {};
        for (const rule of matched) for (const [property, value] of rule.entries) {
            result[property === 'background' ? 'background-color' : property] = value;
        }
        return result;
    };
    const check = css => {
        const errors = [];
        for (const node of buttons) for (const state of ['normal', 'hover', 'active', 'focus-visible', 'disabled']) {
            const chip = node.attrs.class.includes('scenario-sample-chip');
            const selected = node.attrs['aria-selected'] === 'true';
            const actual = cascade(css, node, state);
            const expected = { 'background-color': selected || state === 'active' ? 'var(--accent-soft)' : 'var(--surface)',
                color: state === 'disabled' ? 'var(--text-muted)' : 'var(--text-main)',
                width: '100%', padding: '8px',
                margin: '0 0 4px', 'font-size': '13px' };
            for (const [key, value] of Object.entries(expected)) if (actual[key] !== value) errors.push(`${node.attrs['data-scenario-id']}/${state}/${key}`);
            if (actual.transform || actual['margin-top']) errors.push(`${state}: alter Knopfversatz`);
            if (state === 'focus-visible' && actual.outline !== '2px solid var(--accent)') errors.push('Fokus fehlt');
        }
        return errors;
    };
    const legacy = candidates(source).filter(rule => rule.selector.startsWith(oldPrefix));
    assertEqual(legacy.length, 4, 'Alle vier kollidierenden Altzustände werden geprüft');
    for (const rule of legacy) {
        assertEqual(buttons.filter(node => matches(rule.selector, node, rule.selector.split(':').at(-1))).length, 0,
            `${rule.selector}: Treffermenge auf allen erzeugten Zeilen und Chips ist leer`);
        assert(matches(rule.selector, { tag: 'button', attrs: { class: '' } }, rule.selector.split(':').at(-1)), 'Andere native Simulatorbuttons behalten den Altstil');
    }
    assert(!candidates(source).some(rule => Object.values(rule.declarations).some(value => value.includes('!important'))), 'Keine neue Important-Deklaration für Szenarioknöpfe');
    assertEqual(check(source).join('\n'), '', 'Effektive Kaskade: helle Zeilen, messinghelle Auswahl und gleichwertige Stichprobenzeilen in allen Zuständen');
    for (const rule of legacy) {
        const revertedState = source.replace(`${rule.selector} {`, `${rule.selector.replace(':not(.scenario-list-item)', '')} {`);
        assert(revertedState !== source && check(revertedState).length > 0, `Rücknahme nur dieses Altzustands scheitert: ${rule.selector}`);
    }
    const reverted = source.replaceAll(':not(.scenario-list-item)', '');
    assert(reverted !== source && check(reverted).length > 0, 'Synthetische Rücknahme des Ausschlusses lässt die Regression scheitern');
}

// Effektive lokale Regeln an echten Ruinwerten; Normal- und Auswahlzustand.
{
    const css = readSources()['simulator.css'];
    const declarations = selector => Object.assign({}, ...rules('simulator.css', css).filter(rule => rule.selector === selector).map(rule => rule.declarations));
    const marks = declarations('.ds-scenario-outlier');
    assert(marks.background === 'transparent' && marks.border === '0' && marks['white-space'] === 'nowrap'
        && marks.width === '100%' && marks.height === '100%', 'Randmarken haben vollständige transparente Trefferflächen ohne sichtbaren Kasten');
    const segments = declarations('.scenario-groups');
    assert(segments.display === 'flex' && segments['flex-wrap'] === 'wrap' && !segments['grid-template-columns'], 'Gruppensegmente erlauben eine Zeile und natürlichen Umbruch statt eines 2×2-Rasters');
    assert(declarations('.scenario-group-count').color === 'var(--text-muted)', 'Gruppenanzahlen sind separat gedämpft');
    assert(declarations('.scenario-selected-bar').background === 'var(--accent-soft)' && declarations('.scenario-selected-bar').border === '1px solid var(--accent-line)', 'Auswahlkarte nutzt beige Theme-Tokens');
    assert(declarations('.scenario-selected-title').font.includes('26px') && declarations('.scenario-selected-eyebrow')['text-transform'] === 'uppercase', 'Auswahlkopf trennt großen Originalnamen und Gruppeneyebrow');
    assert(declarations('.scenario-person-mark').display === 'inline-block' && declarations('.scenario-selected-meta, .scenario-selected-events')['flex-wrap'] === 'wrap', 'Personen- und Metadatenmarken bleiben kompakt und umbrechbar');
    const failed = { key: 'worst', label: 'Ruinprobe', failed: true, endVermoegen: 0, logDataRows: [{ jahr: 3, recordType: 'terminal_ruin' }] };
    const entries = buildScenarioEntries({ characteristic: [failed] });
    const color = (source, node) => {
        const matched = rules('simulator.css', source).flatMap((rule, order) => rule.selector.split(',').map(selector => ({ ...rule, selector: selector.trim(), order })))
            .filter(rule => rule.declarations.color && /^(\.scenario-list-item|#scenarioSelectedHeading)/.test(rule.selector)
                && !/:(hover|active|disabled|focus-visible)/.test(rule.selector) && matchesSelector({ elements: [node] }, rule.selector));
        const rank = selector => [(selector.match(/#/g) || []).length, (selector.match(/\.|\[/g) || []).length, (selector.match(/\bsmall\b/g) || []).length];
        matched.sort((a, b) => { const aa = rank(a.selector), bb = rank(b.selector); return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2] || a.order - b.order; });
        return matched.at(-1)?.declarations.color;
    };
    for (const selected of ['', 'char_worst']) {
        const tree = tokenizeHTML(renderScenarioList(entries, selected, 'real', { startYear: 2026 }));
        const value = tree.elements.find(node => node.attrs.class === 'scenario-value is-ruin');
        assert(value && color(css, value) === 'var(--bad)', 'Wirksame Ruinfarbe ist rot in normaler und ausgewählter Zeile');
        const regression = css.replace('.scenario-list-item .scenario-value.is-ruin, #scenarioSelectedHeading .is-ruin { color: var(--bad); }', '');
        assert(regression !== css && color(regression, value) !== 'var(--bad)', 'Rücknahme der Ruinregel wird trotz allgemeiner small-Farbe erkannt');
    }
}
