import fs from 'node:fs';
import { buildMonteCarloOutcomeInventoryV1 } from '../app/simulator/monte-carlo-chunk-result.js';
import { buildMonteCarloAnswers, buildSummaryData, buildKpiDashboard, buildStressMetrics, buildCareMetrics } from '../app/simulator/results-metrics.js';
import {
    formatCurrency,
    bindResultInfoPopups,
    renderCareSection,
    renderHeatmap,
    renderKpiCard,
    renderKpiDashboard,
    renderStressSection,
    renderSummary,
    renderMonteCarloAnswers
} from '../app/simulator/results-renderers.js';

console.log('--- Results Renderers Tests ---');

const previousDocument = globalThis.document;

class MockElement {
    constructor(tagName = 'div', ownerDocument = null) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.id = '';
        this.innerHTML = '';
        this.style = {};
        this.parentNode = null;
        this.nextSibling = null;
        this.insertions = [];
        this.removed = false;
    }

    insertBefore(node, referenceNode) {
        node.parentNode = this;
        this.insertions.push({ node, referenceNode });
        if (node.id) this.ownerDocument?.elements.set(node.id, node);
        return node;
    }

    remove() {
        this.removed = true;
        if (this.id) this.ownerDocument?.elements.delete(this.id);
    }
}

function createDocument() {
    const simpleMode = { enabled: false };
    const documentRef = {
        elements: new Map(),
        body: {
            classList: {
                contains(className) {
                    return className === 'mode-simple' && simpleMode.enabled;
                }
            }
        },
        createElement(tagName) {
            return new MockElement(tagName, documentRef);
        },
        getElementById(id) {
            return documentRef.elements.get(id) || null;
        }
    };
    return { documentRef, simpleMode };
}

function card(title, tone = 'default') {
    return {
        title,
        value: `${title}-value`,
        description: `${title}-description`,
        tooltip: `${title}-tooltip`,
        tone
    };
}

const { documentRef, simpleMode } = createDocument();
globalThis.document = documentRef;

try {
    const answerHost = new MockElement('div', documentRef);
    const answers = buildMonteCarloAnswers({ results: { cutYearSharePct: { p50: 12, thresholdPct: 10, sampleSize: 100 }, kpiMaxKuerzung: { p50: 18 } }, totalRuns: 100, failCount: 4 });
    renderMonteCarloAnswers(answerHost, answers, true);
    assertEqual((answerHost.innerHTML.match(/<h2(?:\s[^>]*)?>/g) || []).length, 2, 'Antwortrenderer erzeugt genau zwei Fragen');
    assertEqual((answerHost.innerHTML.match(/Annahmen seitdem geändert/g) || []).length, 2, 'Beide Antwortzeilen tragen denselben Veraltetstatus');
    assert(answerHost.innerHTML.includes('sim-hero-amount') && answerHost.innerHTML.includes('96,0 %')
        && answerHost.innerHTML.includes('12,0 %') && answerHost.innerHTML.includes('18,0 %'), 'Einstiegsstil zeigt alle drei bestehenden Kennzahlen');
    renderMonteCarloAnswers(answerHost, answers);
    assert(!answerHost.innerHTML.includes('Annahmen seitdem geändert'), 'Frischer Abschluss entfernt Veraltetstatus');
    renderMonteCarloAnswers(answerHost, [{ question: '<script>', value: '<img>', text: '<svg>', note: '&' }]);
    assert(!answerHost.innerHTML.includes('<script>') && answerHost.innerHTML.includes('&lt;img&gt;'), 'Antworttexte werden sicher maskiert');
    for (const value of [0, 22.331]) {
        const input = { realWithdrawalP10: { realEur: value, p50RealEur: value, sampleSize: 1000 },
            maxDrawdowns: { p50: value, p90: value, sampleSize: 1000 }, realMaxDrawdowns: { p50: value, p90: value, sampleSize: 1000 } };
        const dashboard = buildKpiDashboard(input);
        const stress = buildStressMetrics({ ...input, presetKey: 'SYNTHETIC', years: 4, maxDD: input.maxDrawdowns });
        const cards = [dashboard.primary.find(card => card.title === 'Entnahme aus dem Vermögen in schwachen Jahren'), ...dashboard.drawdownKpis,
            ...stress.kpis.filter(card => /Drawdown|schwachen Jahren/.test(card.title))];
        for (const card of cards) {
            const html = renderKpiCard(card);
            assert(!/is-red|is-amber|is-green/.test(html), 'Tatsächliche Entnahme-/Drawdownkarte bleibt neutral');
            assert(html.includes(card.value), 'Neutraler Renderer erhält die formatierte Zahl');
            if (card.secondaryValue) assert(html.includes(card.secondaryValue), 'Neutraler Renderer erhält den Nebenwert');
        }
    }
    const toneCards = [
        card('Default'),
        card('Success', 'success'),
        card('Warning', 'warning'),
        card('Danger', 'danger')
    ];
    const cardHtml = toneCards.map(renderKpiCard).join('');
    assert(cardHtml.includes('kpi-card ') && cardHtml.includes('Default-tooltip'), 'KPI card should render its default tone and tooltip');
    assert(cardHtml.includes('is-green') && cardHtml.includes('is-amber') && cardHtml.includes('is-red'), 'KPI card should map all semantic tones');
    assert(renderKpiCard({ title: 'Fallback', value: '1', tone: 'unknown' }).includes('aria-label="Fallback"'), 'KPI card should fall back from missing tooltip and description to its title');
    const exactCardHtml = renderKpiCard({
        title: 'Exaktwert',
        value: '12.345.678,90 €',
        secondaryLabel: 'Zweiter Exaktwert',
        secondaryValue: '34,25 %',
        statusLine: 'Grund: missing_inflation · Beobachtungen: 0 Läufe',
        layout: 'exact-risk',
        tone: 'danger'
    });
    assert(exactCardHtml.includes('kpi-exact-value'), 'Exact-value cards should receive the non-clipping layout class');
    assert(exactCardHtml.includes('Zweiter Exaktwert') && exactCardHtml.includes('34,25 %'), 'Second exact values should be visible in the card body');
    assert(exactCardHtml.includes('Inflationsdaten fehlen') && !exactCardHtml.includes('missing_inflation') && exactCardHtml.includes('Beobachtungen: 0'), 'Missing metrics should render stable reason and count visibly');

    // Verhalten am gebundenen Popup statt nur Klassennamen prüfen.
    const hostEvents = new Map(), buttonEvents = new Map(), documentEvents = new Map();
    const popupButton = {
        attrs: {}, setAttribute(name, value) { this.attrs[name] = value; },
        addEventListener(name, handler) { buttonEvents.set(name, handler); },
        focus() { documentRef.activeElement = this; hostEvents.get('focusin')?.(); }
    };
    const popupHost = {
        dataset: {}, contains(node) { return node === popupButton; }, querySelector() { return popupButton; },
        addEventListener(name, handler) { hostEvents.set(name, handler); }
    };
    documentRef.querySelectorAll = () => [popupHost];
    documentRef.addEventListener = (name, handler) => documentEvents.set(name, handler);
    bindResultInfoPopups(documentRef);
    bindResultInfoPopups(documentRef);
    hostEvents.get('mouseenter')();
    assertEqual(popupButton.attrs['aria-expanded'], 'true', 'Hover öffnet die vollständige Kennzahlerklärung');
    hostEvents.get('mouseleave')();
    assertEqual(popupHost.dataset.visible, 'false', 'Unfixierter Hover schließt beim Verlassen');
    buttonEvents.get('click')(); hostEvents.get('mouseleave')();
    assertEqual(popupHost.dataset.visible, 'true', 'Klick fixiert die Erklärung auch nach Verlassen');
    documentEvents.get('click')({ target: {} });
    assertEqual(popupHost.dataset.visible, 'false', 'Außenklick schließt eine fixierte Erklärung');
    popupButton.focus();
    assertEqual(popupHost.dataset.visible, 'true', 'Tastaturfokus öffnet die Erklärung');
    hostEvents.get('keydown')({ key: 'Escape', preventDefault() {} });
    assertEqual(documentRef.activeElement, popupButton, 'Escape stellt den Fokus am Info-Control her');
    assertEqual(popupButton.attrs['aria-expanded'], 'false', 'Escape schließt trotz Rückfokus');
    documentRef.querySelectorAll = () => [];

    for (const counts of [
        { requestedRuns: 0, ruin: 0, all_dead: 0, horizon_exhausted: 0, technical_error: 0 },
        { requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 2, technical_error: 0 },
        { requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 1, technical_error: 1 }
    ]) {
        const inventory = buildMonteCarloOutcomeInventoryV1(counts);
        const cards = buildSummaryData({ results: { outcomeInventory: inventory, finalOutcomes: { p50: 0 } }, totalRuns: counts.requestedRuns, failCount: counts.ruin });
        const before = JSON.stringify(cards), target = new MockElement('div', documentRef);
        renderSummary(target, cards);
        assert(!target.innerHTML.includes('class="mc-floor-value"') && !target.innerHTML.includes('class="sim-answer-count"'), 'Sekundäre Zeile wiederholt weder Deckungsquote noch Laufzahl der Kernantwort');
        assert(target.innerHTML.includes(cards[0].intervalText), 'Wilson-Intervall steht separat im sichtbaren Kartenkörper');
        for (const outcome of cards[1].outcomes) assert(target.innerHTML.includes(`${outcome.label} ${outcome.count}`), 'Alle vier Endzustände behalten ihre Anzahl einschließlich Null');
        assertEqual((target.innerHTML.match(/summary-item(?: kpi-card)? ds-card/g) || []).length, 4, 'Endvermögenskarte erhält Hauptwert und drei ergänzende Exaktwerte');
        assert(target.innerHTML.includes('0 €') && target.innerHTML.includes('Keine Beobachtungen'), 'Nullvermögen bleibt von fehlenden Kennzahlen und deren Gründen unterscheidbar');
        assert(!target.innerHTML.includes('all_dead') && !target.innerHTML.includes('horizon_exhausted') && !target.innerHTML.includes('no_observations'), 'Redaktionelle Floor-/Statusdarstellung verwendet verständliche Gründe');
        assertEqual(JSON.stringify(cards), before, 'Summaryrenderer verändert keine Deskriptoren');
    }
    {
        const raw = { finalOutcomes: { p50: 3900982.099, p50_successful: 3929287.359, p10: 1000335.459, p90: 16120322.279, successfulCount: 9949 },
            taxOutcomes: { p50: 77286.831 }, cutYearSharePct: { p50: 0 } };
        const before = JSON.stringify(raw), box = new MockElement('div', documentRef);
        renderSummary(box, buildSummaryData({ results: raw, totalRuns: 10000, failCount: 51 }));
        assert(box.innerHTML.includes('title="3.900.982 €">3,9 Mio. €')
            && box.innerHTML.includes('Genauer Wert: 3.900.982 €'), 'Gerundete Hauptsumme hält den genauen Betrag im Tooltip und im Informationsfeld');
        assert(box.innerHTML.includes('title="1.000.335 € / 16.120.322 €">1 Mio. € / 16,1 Mio. €'), 'Sekundäre Perzentile sind gerundet und behalten beide genauen Werte');
        renderKpiDashboard(box, buildKpiDashboard(raw, {}));
        assert(!box.innerHTML.includes('mehr als 10 % unter Wunsch-Flex'), 'Entnahmezeilen wiederholen die Einschränkungsantwort nicht');
        assertEqual(JSON.stringify(raw), before, 'Rundung und Entfernen von Duplikaten erhalten alle Rohwerte');
    }
    {
        const raw = { extraKPI: { healthBucket: { usedRatePct: 50, depletedRatePct: 0, usedMedian: 12345.678,
            usedP90: 12345678.9, endMedian: 0, coverageMedianPct: 0, targetGapMedian: 0 } } };
        const before = JSON.stringify(raw), metrics = buildCareMetrics(raw, { healthBucketEnabled: true });
        const box = new MockElement('div', documentRef), region = new MockElement('div', documentRef);
        renderCareSection(box, region, metrics);
        assert(box.innerHTML.includes('<h3>Pflegereserve</h3>'), 'Reservekarten bleiben nach redaktioneller Umbenennung in ihrer Pflegegruppe');
        assert(box.innerHTML.includes('12.346 €') && box.innerHTML.includes('12.345.679 €'), 'Ungebundene Reservewerte zeigen volle Ganz-Euro-Beträge');
        for (const descriptor of metrics.cards) assert(box.innerHTML.includes(descriptor.title), 'Jede Reservenkennzahl bleibt nach der Gruppierung erreichbar');
        assertEqual(JSON.stringify(raw), before, 'Pflegegruppierung und Rundungsanzeige verändern keine Reserve-Rohdaten');
    }
    const styles = fs.readFileSync(new URL('../simulator.css', import.meta.url), 'utf8');
    {
        const inputs = { pflegefallLogikAktivieren: true, partner: { aktiv: true } };
        const results = { extraKPI: { pflege: { p1: { entryRatePct: 0, entryAgeP50: null, careYearsP50: 0, realCostEurP50: 0 }, p2: {} } } };
        const metrics = buildCareMetrics(results, inputs), before = JSON.stringify(metrics);
        const people = { persons: [{ name: 'Max <Mustermann>' }, { name: 'Erika Mustermann' }] };
        const box = new MockElement('div', documentRef), region = new MockElement('div', documentRef);
        renderCareSection(box, region, metrics, people);
        assert(box.innerHTML.includes('Max &lt;Mustermann&gt;') && box.innerHTML.includes('Erika Mustermann'), 'Pflegevergleich nennt beide berechneten Personen und maskiert Namen');
        assertEqual((box.innerHTML.match(/<th scope="row">/g) || []).length, 4, 'Pflegevergleich erhält die vier gemeinsamen Kennzahlen');
        assert(box.innerHTML.includes('0,0') && box.innerHTML.includes('<strong>—</strong>'), 'Beobachtete Null und fehlende Pflegebeobachtung bleiben unterscheidbar');
        assert(!/\bP1\b|\bP2\b|Person 1|Person 2/.test(box.innerHTML), 'Pflegekennzahlen und Erklärungen verwenden die Namen des Laufs');
        assertEqual(JSON.stringify(metrics), before, 'Namensanzeige und Pflegevergleich verändern keine Kennzahlen');
        const single = buildCareMetrics(results, { pflegefallLogikAktivieren: true });
        renderCareSection(box, region, single, { persons: [people.persons[0]] });
        assert(!box.innerHTML.includes('Erika Mustermann') && !box.innerHTML.includes('Person 2'), 'Einpersonenlauf zeigt nur seine berechnete Person');
    }
    assert(/\.mc-floor-value\s*\{[^}]*var\(--value-md\)[^}]*var\(--font-serif\)/s.test(styles), 'Die zweite Deckungsanzeige verwendet die mittlere Wertgröße');
    assert(/@media screen\s*\{[^}]*\.kpi-description[^}]*\.summary-description[^}]*display: none/s.test(styles), 'Erklärungen bleiben am Bildschirm hinter Info-Symbolen');
    assert(/\.mc-more-metrics::details-content\s*\{[^}]*display: contents !important; content-visibility: visible !important/s.test(styles), 'Druck zeigt Details auch bei geschlossener Kennzahlenklappe');
    assert(styles.includes('#tab-montecarlo .kpi-description, #tab-montecarlo .summary-description { display: block !important; }'), 'Druck zeigt vollständige kanonische Erklärungen');
    assert(styles.includes('#tab-montecarlo .ds-info, .mc-settings-actions, #mcRunHead button, #mcSetupDisclosure #mcRecalculateButton { display: none !important; }'), 'Druck verbirgt Tooltipduplikate und Aktionen');

    const summary = new MockElement('div', documentRef);
    renderSummary(summary, toneCards);
    assert(summary.innerHTML.includes('Default-description') && summary.innerHTML.includes('Danger-description'), 'Summary zeigt die vorhandenen vollständigen Gründe im Kartenkörper');
    assert(summary.innerHTML.includes('summary-item ds-card ds-metric'), 'Summary ergänzt Rollen am eigenen Anker');
    assert(exactCardHtml.includes('kpi-card ds-card ds-metric'), 'KPI ergänzt Rollen ohne Verlust seines Ankers');
    assert(summary.innerHTML.includes('Default') && summary.innerHTML.includes('Danger'), 'Expanded summary should render every card');
    assert(summary.innerHTML.includes('is-success') && summary.innerHTML.includes('is-warning') && summary.innerHTML.includes('is-danger'), 'Summary should map all semantic tones');

    simpleMode.enabled = true;
    renderSummary(summary, toneCards);
    assert(summary.innerHTML.includes('Warning') && summary.innerHTML.includes('Danger'), 'Einfacher Modus erhält sämtliche Summary-Kennzahlen');
    const criticalSummaryCards = [...toneCards, { ...card('Tax exact'), decisionCritical: true, layout: 'exact-risk' }];
    renderSummary(summary, criticalSummaryCards);
    assert(summary.innerHTML.includes('Tax exact') && summary.innerHTML.includes('summary-exact-value'), 'Decision-critical exact summary cards should remain visible in simple mode');
    const unavailableSummaryCards = [...toneCards, { ...card('Tax unavailable'), value: '—', statusLine: 'Grund: no_observations · Beobachtungen: 0 Läufe', decisionCritical: true, layout: 'exact-risk' }];
    renderSummary(summary, unavailableSummaryCards);
    assert(summary.innerHTML.includes('summary-status-line') && summary.innerHTML.includes('Beobachtungen: 0'), 'Summary should render missing reason and observation count visibly');
    const unchangedSummary = summary.innerHTML;
    renderSummary(null, toneCards);
    renderSummary(summary, null);
    assertEqual(summary.innerHTML, unchangedSummary, 'Summary should ignore missing containers or card arrays');
    simpleMode.enabled = false;

    const dashboard = new MockElement('div', documentRef);
    renderKpiDashboard(dashboard, {
        primary: [card('Primary', 'success')],
        drawdownKpis: [card('Nominal drawdown', 'warning'), card('Real drawdown', 'danger')],
        reportingReferenceNotice: 'Nur Berichtsreferenz; keine Alarm- oder Guardrail-Schwelle.',
        detailSections: [
            { title: 'Risk details', kpis: [card('Risk', 'warning')] },
            { title: 'Care details', kpis: [card('Care', 'danger')] }
        ]
    });
    assert(dashboard.innerHTML.includes('Entnahmen') && dashboard.innerHTML.includes('Risk details') && dashboard.innerHTML.includes('Care details'), 'Dashboard should render primary and detail sections');
    assert(dashboard.innerHTML.includes('kpi-grid-pair') && dashboard.innerHTML.includes('Nominal drawdown') && dashboard.innerHTML.includes('Real drawdown'), 'Dashboard should render nominal and real drawdowns in a dedicated pair grid');
    assert(dashboard.innerHTML.includes('reporting-reference-note') && dashboard.innerHTML.includes('keine Alarm- oder Guardrail-Schwelle'), 'Berichtsreferenz bleibt mit unveränderter Bedeutung als Zeile innerhalb der geschlossenen Kennzahlenklappe');
    const disclosure = dashboard.innerHTML.match(/<details class="mc-more-metrics[^>]*>([\s\S]*?)<\/details>/)[1];
    assert(disclosure.includes('reporting-reference-note') && !dashboard.innerHTML.split('<details')[0].includes('reporting-reference-note'), 'Berichtsreferenz wird ausschließlich nach dem Summary in Weitere Kennzahlen erzeugt');
    assert(!dashboard.innerHTML.includes('<div class="reporting-reference-note'), 'Berichtsreferenz hat keinen separaten Kachelhost');
    assertEqual(dashboard.style.display, 'block', 'Dashboard should become visible after rendering');
    const riskDashboard = new MockElement('div', documentRef);
    const splitModel = {
        reportingReferenceNotice: '4,5 % bleibt reine Berichtsreferenz.', primary: [card('Primary split')], drawdownKpis: [card('Drawdown split')],
        detailSections: [{ title: 'Tail-Risk-Overlay', kpis: [card('Tail split')] }]
    };
    const beforeSplit = JSON.stringify(splitModel);
    renderKpiDashboard(dashboard, splitModel, riskDashboard);
    assert(!riskDashboard.innerHTML.includes('reporting-reference-note'), 'Separater Risiko-Host erzeugt keine zweite Berichtsreferenz');
    assert(dashboard.innerHTML.includes('Primary split') && dashboard.innerHTML.includes('Drawdown split')
        && dashboard.innerHTML.includes('Tail split'), 'Überblick erhält Hauptwerte, Drawdown und aufklappbare Detailkarten');
    assert(riskDashboard.innerHTML.includes('Tail split') && !riskDashboard.innerHTML.includes('Primary split'),
        'Risiko erhält genau seine kanonischen Detailkarten');
    assertEqual(JSON.stringify(splitModel), beforeSplit, 'Aufteilung verändert keine Deskriptoren');
    assert(dashboard.innerHTML.includes('ds-info-pop') && dashboard.innerHTML.includes('aria-controls='),
        'Kennzahlerklärung ist am echten Renderer ein erreichbares Popup');
    const unchangedDashboard = dashboard.innerHTML;
    renderKpiDashboard(null, { primary: [], detailSections: [] });
    renderKpiDashboard(dashboard, null);
    assertEqual(dashboard.innerHTML, unchangedDashboard, 'Dashboard should ignore missing input contracts');

    const stressParent = new MockElement('section', documentRef);
    const stressReference = new MockElement('div', documentRef);
    stressReference.parentNode = stressParent;
    const existingStress = new MockElement('div', documentRef);
    existingStress.id = 'stressKpiResults';
    documentRef.elements.set(existingStress.id, existingStress);
    renderStressSection(stressReference, null);
    assert(existingStress.removed, 'Stress renderer should remove a stale section before handling a null result');
    assertEqual(stressParent.insertions.length, 0, 'Null stress metrics should not insert a replacement section');

    renderStressSection(stressReference, {
        presetLabel: 'Crash fixture',
        years: 4,
        kpis: toneCards
    });
    assertEqual(stressParent.insertions.length, 1, 'Stress renderer should insert exactly one current section');
    const insertedStress = stressParent.insertions[0];
    assertEqual(insertedStress.referenceNode, stressReference.nextSibling, 'Stress renderer should insert after the reference container');
    assert(insertedStress.node.innerHTML.includes('Crash fixture') && insertedStress.node.innerHTML.includes('ersten 4 Jahre'), 'Stress renderer should expose preset and duration');
    const insertionCount = stressParent.insertions.length;
    renderStressSection(null, { presetLabel: 'ignored', years: 1, kpis: [] });
    assertEqual(stressParent.insertions.length, insertionCount, 'Stress renderer should ignore a missing reference container');

    const heatmap = new MockElement('div', documentRef);
    renderHeatmap(heatmap, {
        heatmap: [new Uint32Array([1, 0])],
        bins: [0, 1, Infinity],
        totalRuns: 1,
        extraKPI: { timeShareQuoteAbove45: 0 }
    });
    assert(heatmap.innerHTML.includes('ds-chart-scroll') && heatmap.innerHTML.includes('role="region" tabindex="0"'), 'Heatmap erhält benannte Tastaturregion');
    assert(heatmap.innerHTML.includes('<svg') && heatmap.innerHTML.includes('</svg>'), 'Heatmap renderer should project the prepared matrix to SVG');
    assertEqual(heatmap.style.display, 'block', 'Heatmap should become visible after rendering');
    const unchangedHeatmap = heatmap.innerHTML;
    renderHeatmap(null, {});
    renderHeatmap(heatmap, null);
    assertEqual(heatmap.innerHTML, unchangedHeatmap, 'Heatmap renderer should ignore missing contracts');

    const careSummary = new MockElement('div', documentRef);
    const careContainer = new MockElement('section', documentRef);
    renderCareSection(careSummary, careContainer, null);
    assertEqual(careContainer.style.display, 'none', 'Care renderer should hide an empty care section');
    renderCareSection(careSummary, careContainer, { cards: [card('P1'), card('P2', 'warning')] });
    assert(careSummary.innerHTML.includes('P1') && careSummary.innerHTML.includes('P2'), 'Care renderer should render every prepared care card');
    assertEqual(careContainer.style.display, 'block', 'Care renderer should reveal a populated section');
    const unchangedCare = careSummary.innerHTML;
    renderCareSection(null, careContainer, { cards: [] });
    renderCareSection(careSummary, null, { cards: [] });
    assertEqual(careSummary.innerHTML, unchangedCare, 'Care renderer should ignore missing target containers');

    const formatted = formatCurrency(1234.5);
    assert(typeof formatted === 'string' && formatted.length > 0, 'Currency re-export should retain the safe formatter contract');
} finally {
    if (previousDocument === undefined) {
        delete globalThis.document;
    } else {
        globalThis.document = previousDocument;
    }
}

console.log('--- Results Renderers Tests Completed ---');
