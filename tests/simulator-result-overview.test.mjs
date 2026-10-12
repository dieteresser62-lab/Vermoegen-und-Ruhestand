import { backtestCutMissingReason, projectBacktestOverview, beginOverviewRun, completeOverviewRun, failOverviewRun, projectMonteCarloOverview, renderSimulatorOverview, initializeResultOverview, setOverviewBacktestStatus, setOverviewAutomaticPeriod, bindSimulatorInfoPopups } from '../app/simulator/simulator-result-overview.js';
import { simulatorRunAssumptions as runHeads } from '../app/simulator/simulator-run-assumptions.js';
import { deriveHistoricalBacktestMetrics } from '../app/simulator/historical-backtest-metrics.js';
import { createPresentationTestDocument, readSources, rules } from './designsystem-source-contract.mjs';
import { tokenizeHTML, matchesSelector } from './funktionsinventar-contract.mjs';

const mixedExplanation = 'In Krisenjahren schaltet die Sicherheitsbremse die dynamische Entnahme ab. Die Kürzungen beziehen sich dann auf ein anderes Ziel und sind nicht vergleichbar.';
const missingStyle = Object.assign({}, ...rules('simulator.css', readSources()['simulator.css'])
    .filter(rule => rule.selector === '.sim-result-grid .sim-cut-missing').map(rule => rule.declarations));
assertEqual(missingStyle['font-weight'], '400', 'Fehlgrund nutzt normale Schriftstärke');
assertEqual(missingStyle['overflow-wrap'], 'normal', 'Fehlgrund wird nicht mitten im Wort umgebrochen');
assertEqual(missingStyle['word-break'], 'normal', 'Fehlgrund erhält keine erzwungenen Worttrennungen');
const noteStyle = Object.assign({}, ...rules('simulator.css', readSources()['simulator.css'])
    .filter(rule => rule.selector === '.sim-result-grid .sim-cut-note').map(rule => rule.declarations));
assertEqual(noteStyle['font-size'], 'var(--balance-help)', 'Fehlgrund erbt die normale Hinweisgröße');

const previous = globalThis.document;
try {
    const doc = createPresentationTestDocument(); doc.querySelectorAll = () => []; const clickListeners = []; doc.addEventListener = (type, handler) => { if (type === 'click') clickListeners.push(handler); };
    const click = target => clickListeners.forEach(handler => handler({ target }));
    doc.createElementNS = (_ns, tag) => doc.createElement(tag);
    const observers = [], resizeListeners = new Set();
    doc.defaultView = {
        getComputedStyle: () => ({ paddingLeft: '24px', paddingRight: '16px' }),
        addEventListener: (_type, fn) => resizeListeners.add(fn), removeEventListener: (_type, fn) => resizeListeners.delete(fn),
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(host) { this.host = host; host.clientWidth = 1400; }
            disconnect() { this.disconnected = true; }
        }
    };
    for (const id of ['simBacktestPlanDeviation','simMonteCarloPlanDeviation','overviewBacktest','overviewCrises','overviewRunHeads','overviewMonteCarlo','monteCarloAnswers','overviewMonteCarloAnswers','simulatorContextPills','simCareReserve']) {
        const node = doc.createElement('section'); node.id = id; node.querySelector = () => null;
    }
    globalThis.document = doc;
    renderSimulatorOverview();
    assert(doc.getElementById('overviewMonteCarlo').innerHTML.includes('Monte-Carlo wird erst auf deinen Wunsch gestartet.'), 'Ohne Ergebnis und Lauf steht der Hinweis auf den manuellen Start');
    const trialBasis = { inputs: { startFlexBedarf: 33000 }, settings: {}, planDataContext: { deviationApplied: true } };
    const trialToken = beginOverviewRun('montecarlo', trialBasis);
    assert(!doc.getElementById('overviewMonteCarlo').innerHTML.includes('Monte-Carlo wird erst auf deinen Wunsch gestartet.'), 'Während des ersten Laufs entfällt der widersprüchliche Starthinweis');
    trialBasis.planDataContext.deviationApplied = false;
    completeOverviewRun('montecarlo', trialToken, projectMonteCarloOverview({}, 2, 0));
    renderSimulatorOverview();
    assert(!doc.getElementById('overviewMonteCarlo').innerHTML.includes('Monte-Carlo wird erst auf deinen Wunsch gestartet.'), 'Mit Ergebnis entfällt der Hinweis auf den ersten Start');
    assert(doc.getElementById('overviewRunHeads').innerHTML.includes('mit Abweichung vom Plan'), 'Laufstart im Versuch behält Hinweis nach Rückkehr oder Übernahme');
    assert(!doc.getElementById('simMonteCarloPlanDeviation').hidden, 'MC-Detailansicht nutzt dieselbe eingefrorene Versuchsbasis');
    const planToken = beginOverviewRun('montecarlo', { inputs: {}, settings: {}, planDataContext: { deviationApplied: false } });
    runHeads.observe('montecarlo', { inputs: { startFlexBedarf: 35000 }, settings: {}, planDataContext: { deviationApplied: true } });
    completeOverviewRun('montecarlo', planToken, projectMonteCarloOverview({}, 2, 0));
    renderSimulatorOverview();
    assert(!doc.getElementById('overviewRunHeads').innerHTML.includes('mit Abweichung vom Plan'), 'Spätere Versuchseingabe kennzeichnet keinen vorherigen Planlauf als Versuch');
    assert(doc.getElementById('simMonteCarloPlanDeviation').hidden, 'MC-Detailansicht zeigt keinen falschen Versuchshinweis');
    const context = { schemaVersion: 1, referenceYear: 2027, ageRule: 'january-1-completed-years', deviationApplied: true,
        persons: [{ profileId: 'a', role: 'primary', changes: [{ field: 'profile_rente_monatlich', profileValue: 1000, effectiveValue: 2200 }] }] };
    const result = { request: { startYear: 2020, endYear: 2020 }, outcome: { kind: 'completed' }, portfolioStart: 100000, completedYears: 1,
        metrics: { values: { wealth_end_nominal_eur: 110000, withdrawal_total_nominal_eur: 1000, flex_reduction_years_gte_10_pct: 0, flex_reduction_longest_streak_gte_10_pct: 0, tax_total_nominal_eur: 0 } },
        rows: [{ jahr: 2020, wertAktien: 110000, wertGold: 0, liquiditaet: 0, row: { health_bucket_start: 0, flex_haushalt_kuerzung_pct: 0 } }] };
    const first = beginOverviewRun('backtest', { inputs: {}, settings: result.request, personDataContext: context });
    completeOverviewRun('backtest', first, result);
    context.persons[0].changes[0].effectiveValue = 9999;
    renderSimulatorOverview();
    const heads = doc.getElementById('overviewRunHeads');
    assert(heads.innerHTML.includes('Abweichung · nur diese Rechnung') && heads.innerHTML.includes('2200'), 'Produktiver Laufkopf zeigt eigenen Personenbeleg');
    assert(!heads.innerHTML.includes('9999'), 'Spätere Entwurfsänderung verändert den abgeschlossenen Laufkopf nicht');
    const aborted = beginOverviewRun('backtest', { inputs: {}, settings: result.request });
    failOverviewRun('backtest', 'cancelled'); completeOverviewRun('backtest', aborted, result);
    assert(heads.innerHTML.includes('2200'), 'Produktiver Abbruch-/Spätantwortpfad erhält bisherigen Beleg');
    const normal = beginOverviewRun('backtest', { inputs: {}, settings: result.request }); completeOverviewRun('backtest', normal, result);
    assert(!heads.innerHTML.includes('Abweichung · nur diese Rechnung'), 'Regulärer Folgeabschluss entfernt falschen Alternativhinweis');
    const mixed = { ...result, completedYears: 2, rows: ['static_input', 'effective_vpw_plus_pension_surplus'].map((basis, index) => ({
        ...result.rows[0], jahr: 2020 + index, row: { ...result.rows[0].row,
            flex_haushalt_basis: basis, flex_brutto_haushalt: 100, flex_haushalt_erfuellt: 80, flex_haushalt_kuerzung_pct: 20 }
    })) };
    mixed.metrics = deriveHistoricalBacktestMetrics(mixed);
    const mixedProjection = projectBacktestOverview(mixed);
    assertEqual(mixedProjection.cuts, null, 'Je ein Jahr mit festem und dynamischem Ziel bleibt unauswertbar');
    assertEqual(backtestCutMissingReason(mixed), 'nicht auswertbar', 'Gemischte Ziele erhalten den kurzen sichtbaren Grund');
    assertEqual(mixedProjection.cutMissingExplanation, mixedExplanation, 'Gemischte Ziele erhalten die Erklärung zur Sicherheitsbremse');
    for (const [overrides, reason, explanation] of [
        [{ metrics: mixed.metrics }, 'nicht auswertbar', mixedExplanation],
        [{}, 'Angaben fehlen', 'Für einzelne Jahre fehlen Angaben zu den Kürzungen.'],
        [{ outcome: { kind: 'incomplete' } }, 'Lauf unvollständig', 'Der Backtest wurde nicht vollständig gerechnet. Die Jahre mit Kürzung können deshalb nicht ausgewertet werden.'],
        [{ metrics: { flexBasisContract: null } }, 'Angaben fehlen', 'Es liegen keine auswertbaren Jahre mit Entnahmen vor.'],
        [{ metrics: { flexBasisContract: { decumulationRowCount: 0 } } }, 'Angaben fehlen', 'Es liegen keine auswertbaren Jahre mit Entnahmen vor.'],
        [{ metrics: { flexBasisContract: { observed: [], consistent: false, decumulationRowCount: 1 } } }, 'Ziel unbekannt', 'In einzelnen Jahren fehlt die Angabe, auf welches Entnahmeziel sich die Kürzung bezieht.'],
        [{ rows: [{ row: { flex_brutto_haushalt: 0 } }] }, 'nicht auswertbar', 'In einzelnen Jahren sind keine flexiblen Ausgaben vorgesehen. Für diese Jahre lässt sich keine prozentuale Kürzung bestimmen.']
    ]) {
        const missing = { ...result, ...overrides, metrics: {
            flexBasisContract: { observed: ['static_input'], consistent: true, decumulationRowCount: 1 },
            ...overrides.metrics, values: { ...result.metrics.values, flex_reduction_years_gte_10_pct: null }
        } };
        assertEqual(backtestCutMissingReason(missing), reason, 'Kurzer Grund: ' + reason);
        assertEqual(projectBacktestOverview(missing).cutMissingExplanation, explanation, 'Erklärung: ' + reason);
        const token = beginOverviewRun('backtest', { inputs: {}, settings: result.request });
        completeOverviewRun('backtest', token, missing);
        const markup = doc.getElementById('overviewBacktest').innerHTML;
        assert(markup.includes(reason) && !markup.includes('— / 1'), 'Ergebniskarte erklärt fehlende Kürzungskennzahl: ' + reason);
        const output = tokenizeHTML(markup);
        const cutMetric = output.elements.find(node => matchesSelector({ elements: [node] }, '.sim-outcome-metrics > .sim-cut-metric'));
        assert(cutMetric && cutMetric.children[1]?.tag === 'p'
            && matchesSelector({ elements: [cutMetric.children[1]] }, '.ds-hint.sim-cut-missing'), 'Grund steht im Hinweisselement statt im KPI-Wertelement');
        assert(!output.elements.some(node => node.tag === 'strong' && node.parent === cutMetric), 'Fehlende Kennzahl erzeugt keinen fett formatierten KPI-Wert');
        const tooltip = output.elements.find(node => node.attrs.id === 'overviewBacktestCutInfo');
        assert(tooltip?.attrs.role === 'tooltip' && tooltip.parent.parent === cutMetric.children[1]
            && markup.includes(explanation), 'Erklärung steht im Tooltip desselben Kennzahlenfelds');
        assert(output.elements.some(node => node.tag === 'button' && node.attrs['aria-controls'] === 'overviewBacktestCutInfo'), 'Feld enthält den i-Knopf zur Erklärung');
        assert(!markup.includes('Entnahmebasis') && !markup.includes('Flex-Basis'), 'Fehlhinweis verwendet keinen Fachjargon');
    }
    for (const missingYears of [[], [2023, 2024]]) {
        setOverviewAutomaticPeriod({ startYear: 2000, endYear: 2022, missingYears });
        renderSimulatorOverview();
        const markup = doc.getElementById('overviewBacktest').innerHTML, tree = tokenizeHTML(markup);
        const tooltip = tree.elements.find(node => node.attrs.id === 'overviewBacktestInfo');
        assert(markup.includes('Verfügbares Endjahr: 2022.'), 'Verfügbares Endjahr bleibt vollständig erhalten');
        assert(tooltip?.attrs.role === 'tooltip' && tree.elements.some(node => node.attrs['aria-controls'] === tooltip.attrs.id), 'Abdeckung besitzt den anklickbaren bestehenden Backtest-Infozugang');
        const outside = markup.replace(/<span class="ds-info-pop" id="overviewBacktestInfo"[\s\S]*?<\/span>/, '');
        assert(!outside.includes('Verfügbares Endjahr') && !outside.includes('Vorjahresabdeckung fehlt'), 'Kein zusätzlicher technischer Absatz außerhalb der Erklärung');
        assertEqual(markup.includes('Vorjahresabdeckung fehlt: 2023, 2024.'), missingYears.length > 0, 'Fehlende Vorjahre werden vollständig und nur bei tatsächlichem Fehlstand genannt');
    }
    setOverviewAutomaticPeriod(null);
    const complete = beginOverviewRun('backtest', { inputs: {}, settings: result.request });
    completeOverviewRun('backtest', complete, result);
    const normalOutput = tokenizeHTML(doc.getElementById('overviewBacktest').innerHTML);
    const normalMetric = normalOutput.elements.filter(node => matchesSelector({ elements: [node] }, '.sim-outcome-metrics > .ds-row'))[1];
    assertEqual(normalMetric.children[1]?.tag, 'strong', 'Auswertbare Kürzungsjahre stehen weiterhin im KPI-Wertelement');
    assert(doc.getElementById('overviewBacktest').innerHTML.includes('<strong>0 / 1</strong>')
        && !normalOutput.elements.some(node => node.attrs.class?.includes('sim-cut-missing')), 'Null Kürzungsjahre bleibt eine Zahl und erhält keinen Fehlhinweis');
    assertEqual(projectBacktestOverview(result).cutMissingExplanation, '', 'Auswertbare Kürzungsjahre erhalten keine Fehlerklärung');

    const answerHost = doc.getElementById('monteCarloAnswers');
    const mcValues = { inputs: { startFlexBedarf: 10000 }, settings: { anzahl: 100, maxDauer: 30 }, personDataContext: { ...context, deviationApplied: false, persons: [] } };
    const mcProjection = projectMonteCarloOverview({ cutYearSharePct: { p50: 12, thresholdPct: 10, sampleSize: 100 }, kpiMaxKuerzung: { p50: 18 } }, 100, 4);
    const mcToken = runHeads.begin('montecarlo', mcValues, { startedAt: '2026-01-01T12:00:00Z' });
    runHeads.observe('montecarlo', mcValues); runHeads.complete('montecarlo', mcToken, mcProjection); renderSimulatorOverview();
    assertEqual(doc.getElementById('overviewMonteCarloAnswers').innerHTML, answerHost.innerHTML, 'Beide Einstiegsantworten nutzen oben dieselben unveränderten Werte wie im Detailreiter');
    const original = answerHost.innerHTML, runBytes = JSON.stringify(runHeads.read('montecarlo').last);
    assert(original.includes('96,0 %') && original.includes('12,0 % der Jahre') && !original.includes('Annahmen seitdem geändert'), 'Laufabschluss zeigt frische Kernantworten');
    for (let change = 0; change < 3; change++) renderSimulatorOverview();
    assertEqual(answerHost.innerHTML, original, 'Darstellungswechsel erhalten sämtliche Antwortwerte und Status');
    runHeads.observe('montecarlo', { ...mcValues, inputs: { startFlexBedarf: 20000 } }); renderSimulatorOverview();
    assertEqual((answerHost.innerHTML.match(/Annahmen seitdem geändert/g) || []).length, 2, 'Relevante Annahmenänderung kennzeichnet beide Antworten');
    assert(doc.getElementById('overviewMonteCarlo').innerHTML.includes('Annahmen seitdem geändert'), 'Bestehendes MC-Ergebnis und Antworten teilen den Veraltetstatus');
    assertEqual(doc.getElementById('overviewMonteCarloAnswers').innerHTML, answerHost.innerHTML, 'Obere Antworten behalten auch nach Annahmenänderung dieselben Werte und Warnungen');
    assert(heads.innerHTML.includes('Monte-Carlo · Annahmen seitdem geändert</h4>') && !heads.innerHTML.includes('Veralteter Lauf'),
        'Gewöhnliche MC-Annahmenänderung behält den bisherigen Laufkopfhinweis');
    assert(doc.getElementById('simulatorContextPills').innerHTML.includes('>Annahmen geändert</span>')
        && !doc.getElementById('simulatorContextPills').innerHTML.includes('Veralteter Lauf'), 'Gewöhnliche MC-Annahmenänderung behält den bisherigen Kontextchip');
    assertEqual(JSON.stringify(runHeads.read('montecarlo').last), runBytes, 'Annahmen-/Ansichtswechsel rechnen nicht neu und ändern keinen Laufbeleg');
    const followValues = { ...mcValues, inputs: { startFlexBedarf: 20000 } };
    const late = runHeads.begin('montecarlo', followValues); runHeads.fail('montecarlo', 'cancelled');
    assert(!runHeads.complete('montecarlo', late, projectMonteCarloOverview({}, 100, 0)), 'Verspäteter Abbruchabschluss wird abgewiesen');
    renderSimulatorOverview(); assert(answerHost.innerHTML.includes('96,0 %'), 'Abbruch erhält die vorherigen Antworten');
    const next = runHeads.begin('montecarlo', followValues);
    runHeads.complete('montecarlo', next, projectMonteCarloOverview({ cutYearSharePct: { p50: 0 }, kpiMaxKuerzung: { p50: 0 } }, 100, 0));
    renderSimulatorOverview();
    assert(answerHost.innerHTML.includes('100,0 %') && answerHost.innerHTML.includes('0,0 % der Jahre') && !answerHost.innerHTML.includes('Annahmen seitdem geändert'), 'Neuer vollständiger Run ersetzt Zahlen und Status gemeinsam');
    const button = doc.createElement('button'); button.id = 'mcButton';
    const calls = [];
    initializeResultOverview({ activateTab: tab => calls.push(tab), runMonteCarlo: () => calls.push('run'), rerunBacktest() {} }, doc);
    initializeResultOverview({ activateTab: () => calls.push('duplicate'), runMonteCarlo: () => calls.push('duplicate') }, doc);
    button.closest = selector => selector.includes('#mcButton') ? button : null;
    click(button);
    assertEqual(JSON.stringify(calls), JSON.stringify(['run']), 'Reiterstart ruft den Run-Callback genau einmal ohne Reiterwechsel auf');
    button.disabled = true; click(button);
    assertEqual(calls.filter(call => call === 'run').length, 1, 'Gesperrter Start startet keinen weiteren Run');
    for (const outcome of ['completed', 'ruin']) {
        const values = { inputs: { startVermoegen: 100000 }, settings: result.request };
        const token = beginOverviewRun('backtest', values);
        completeOverviewRun('backtest', token, { ...result, outcome: { kind: outcome }, ruinYear: 2020 });
        runHeads.observe('backtest', values); renderSimulatorOverview();
        const originalRun = JSON.stringify(runHeads.read('backtest').last);
        const previousCrisis = doc.getElementById('overviewCrises').innerHTML;
        runHeads.observe('backtest', { ...values, inputs: { startVermoegen: 200000 } }); renderSimulatorOverview();
        const output = doc.getElementById('overviewBacktest').innerHTML;
        assert(runHeads.read('backtest').stale && output.includes(outcome === 'completed' ? 'Ja. Dein Plan' : 'Der Floor wäre')
            && output.includes(outcome === 'completed' ? '>überstanden</span>' : '>Floor nicht gedeckt</span>'),
            outcome + ': gewöhnliche Annahmenänderung erhält Urteil und Ergebnisstatus');
        assert(output.includes('<p class="ds-hint">Annahmen seitdem geändert</p>') && !output.includes('Veraltetes Ergebnis')
            && !output.includes('Veralteter Lauf'), outcome + ': bisheriger Annahmenhinweis bleibt erhalten');
        assert(heads.innerHTML.includes('Backtest · Annahmen seitdem geändert</h4>') && !heads.innerHTML.includes('Veralteter Lauf')
            && doc.getElementById('simulatorContextPills').innerHTML.includes('>Annahmen geändert</span>'),
            outcome + ': Laufkopf und Kontextchip behalten die Annahmenkennzeichnung');
        const chart = doc.nodes.filter(node => node.id === 'overviewPortfolioChart').at(-1);
        assertEqual(chart.getAttribute('aria-label'), 'Portfolioverlauf, Kalenderjahre, ohne Pflegereserve', outcome + ': bisheriger Charttitel erhalten');
        assert(!chart.children.some(node => node.textContent.includes('Veralteter Portfolioverlauf')), outcome + ': kein Haushaltsveraltettext im Chart');
        assertEqual(doc.getElementById('overviewCrises').innerHTML, previousCrisis, outcome + ': Krisenbelege erhalten');
        assert(doc.getElementById('simCareReserve').textContent.endsWith(' · letzter Backtest'), outcome + ': bisheriger Pflegereservehinweis erhalten');
        runHeads.observe('backtest', values); renderSimulatorOverview();
        assert(!runHeads.read('backtest').stale && !doc.getElementById('overviewBacktest').innerHTML.includes('Annahmen seitdem geändert')
            && !heads.innerHTML.includes('Backtest · Annahmen seitdem geändert'), outcome + ': Rückänderung entfernt den gewöhnlichen Annahmenhinweis');
        assertEqual(JSON.stringify(runHeads.read('backtest').last), originalRun, outcome + ': Annahmenänderung und Rückänderung erhalten den Laufbeleg');
    }
    const originalBacktestValues = runHeads.read('backtest').last.values;
    runHeads.replaceContext('backtest', { ...originalBacktestValues, inputs: { startVermoegen: 200000 } });
    for (const phase of ['idle', 'preparing', 'skipped', 'blocked', 'technical_error']) {
        setOverviewBacktestStatus(phase);
        assert(doc.getElementById('overviewBacktest').innerHTML.includes('Veraltetes Ergebnis')
            && !doc.getElementById('overviewBacktest').innerHTML.includes('Ja. Dein Plan'), phase + ': kein aktueller Alt-Erfolg');
        assert(heads.innerHTML.includes('Veralteter Lauf') && doc.getElementById('overviewCrises').innerHTML.includes('Veraltete Krisenbelege')
            && doc.nodes.filter(node => node.id === 'overviewPortfolioChart').at(-1).getAttribute('aria-label').includes('Veralteter Lauf'), phase + ': alle sichtbaren Altbelege gekennzeichnet');
        assert(doc.getElementById('simCareReserve').textContent.endsWith(' · veralteter Backtest')
            && doc.getElementById('simulatorContextPills').innerHTML.includes('Veralteter Lauf'), phase + ': Haushaltswechsel kennzeichnet Pflegereserve und Kontextchip');
    }
    runHeads.replaceContext('backtest', originalBacktestValues); renderSimulatorOverview();
    assert(!runHeads.read('backtest').stale && doc.getElementById('overviewBacktest').innerHTML.includes('Veraltetes Ergebnis'),
        'Numerische Rückkehr entfernt die Kennzeichnung des verworfenen Haushaltslaufs nicht');
    const replacement = beginOverviewRun('backtest', originalBacktestValues); completeOverviewRun('backtest', replacement, result);
    runHeads.observe('backtest', originalBacktestValues); renderSimulatorOverview();
    assert(doc.getElementById('overviewBacktest').innerHTML.includes('Ja. Dein Plan') && !heads.innerHTML.includes('Backtest · Veralteter Lauf'),
        'Aktueller Ersatzabschluss ersetzt Urteil und Backtest-Veraltetkennzeichnung gemeinsam');
    const legacy = runHeads.begin('backtest', originalBacktestValues, {});
    runHeads.complete('backtest', legacy, result);
    runHeads.observe('backtest', { ...originalBacktestValues, inputs: { startVermoegen: 300000 } }); renderSimulatorOverview();
    assert(doc.getElementById('overviewBacktest').innerHTML.includes('Ja. Dein Plan') && !heads.innerHTML.includes('Backtest · Veralteter Lauf'),
        'Lauf ohne Haushaltsmetadaten erhält auch nach früheren Kontextwechseln die gewöhnliche Vergleichssemantik');
    const currentObserver = observers.at(-1), chart = currentObserver.host;
    const headsBeforeResize = heads.innerHTML, crisisBeforeResize = doc.getElementById('overviewCrises').innerHTML;
    const runBeforeResize = JSON.stringify(runHeads.read('backtest').last);
    const oldSvg = chart.children.find(node => node.tagName === 'svg');
    const foreign = doc.createElement('p'); foreign.textContent = 'Veralteter Portfolioverlauf · bisheriger Lauf'; chart.append(foreign);
    chart.clientWidth = 1920; currentObserver.callback();
    assertEqual(chart.children.find(node => node.tagName === 'svg').getAttribute('width'), '1880', 'Übersichtresize nutzt Host-Inhaltsbreite');
    assert(chart.children.includes(foreign) && !chart.children.includes(oldSvg), 'Übersichtresize ersetzt ausschließlich das SVG und erhält Fremdhinweis');
    assertEqual(heads.innerHTML, headsBeforeResize, 'Resize führt keinen Ergebnisrender aus');
    assertEqual(doc.getElementById('overviewCrises').innerHTML, crisisBeforeResize, 'Resize erhält Krisenkarte');
    assertEqual(JSON.stringify(runHeads.read('backtest').last), runBeforeResize, 'Resize führt keinen Backtest oder Resultatwriter aus');
    renderSimulatorOverview();
    assert(currentObserver.disconnected && resizeListeners.size === 1, 'Übersichtsersatz beendet die alte Bindung vor neuem Host');
    const oldChildren = [...chart.children]; chart.clientWidth = 2560; currentObserver.callback();
    assert(chart.children.every((node, i) => node === oldChildren[i]), 'Alter Übersichtsrückruf ist wirkungslos');
    const lastObserver = observers.at(-1), getElementById = doc.getElementById.bind(doc);
    doc.getElementById = id => id === 'overviewBacktest' ? null : getElementById(id);
    renderSimulatorOverview();
    assert(lastObserver.disconnected && !resizeListeners.size, 'Entfernte Übersicht beendet ihren Chartbesitzer');
    const removedChildren = [...lastObserver.host.children]; lastObserver.host.clientWidth = 3000; lastObserver.callback();
    assert(lastObserver.host.children.every((node, i) => node === removedChildren[i]), 'Rückruf nach entfernter Übersicht bleibt wirkungslos');
    doc.getElementById = getElementById;
    for (const kind of ['backtest', 'montecarlo']) {
        for (const partner of [{ aktiv: true, monatsrente: 1600 }, { aktiv: false, monatsrente: 1600 }, undefined]) {
            const values = { inputs: { renteMonatlich: 2300, partner }, settings: result.request };
            const token = beginOverviewRun(kind, values);
            completeOverviewRun(kind, token, kind === 'backtest' ? result : projectMonteCarloOverview({}, 2, 0));
            renderSimulatorOverview();
            const runHead = heads.innerHTML.split(`<h4>${kind === 'backtest' ? 'Backtest' : 'Monte-Carlo'}`)[1].split('</section>')[0];
            const pension = runHead.match(/<span>Rente monatlich<\/span><strong>([^<]+)<\/strong>/)?.[1];
            assertEqual(pension, partner?.aktiv ? '3.900 € (Haushalt)' : '2.300 €',
                kind + ': Annahmen zeigen beide Haushaltsrenten und erhalten die Einzelprofilanzeige');
        }
    }
    await Promise.resolve();
} finally { globalThis.document = previous; }

// Der bestehende Infozugang bleibt klickbar und wird je Host nur einmal gebunden.
{
    const handlers = {}, attrs = {}, dataset = {};
    const button = { setAttribute: (key, value) => { attrs[key] = value; }, addEventListener: (type, fn) => { (handlers['button:' + type] ||= []).push(fn); } };
    const host = { dataset, querySelector: () => button, contains: node => node === button,
        addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); } };
    const doc = { querySelectorAll: () => [host], addEventListener: (type, fn) => { (handlers['doc:' + type] ||= []).push(fn); } };
    bindSimulatorInfoPopups(doc); bindSimulatorInfoPopups(doc);
    assertEqual(handlers['button:click'].length, 1, 'Wiederholter Ergebnisrender verdoppelt den Info-Klickhandler nicht');
    handlers['button:click'][0]();
    assertEqual(dataset.visible, 'true', 'Klick öffnet die vollständige Backtest-Erklärung');
    assertEqual(attrs['aria-expanded'], 'true', 'Infozustand folgt dem Klick');
    handlers['doc:click'][0]({ target: {} });
    assertEqual(dataset.visible, 'false', 'Außenklick schließt die Erklärung wieder');
}
