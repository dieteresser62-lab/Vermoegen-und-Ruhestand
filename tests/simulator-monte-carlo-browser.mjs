import fs from 'node:fs';
import {
    MONTE_CARLO_EXPORT_V2_VERSION,
    readMonteCarloExport,
    validateMonteCarloExportV2,
    validateScenarioLogExportV2
} from '../app/simulator/monte-carlo-export.js';

const EXTERNAL_HOSTS = new Set([
    'fonts.googleapis.com',
    'fonts.gstatic.com'
]);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function createMonteCarloPage(browser, baseUrl, { workerMode = 'pass' } = {}) {
    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        locale: 'de-DE',
        acceptDownloads: true
    });
    await context.addInitScript(({ mode }) => {
        window.alert = () => {};
        window.confirm = () => true;
        window.prompt = () => '';
        window.__mcE2eProbe = {
            mode,
            constructed: 0,
            terminated: 0,
            heldResult: false,
            staleDeliveryAttempts: 0,
            delayedGeneration: null
        };

        if (mode === 'throw') {
            window.Worker = class ThrowingMonteCarloWorker {
                constructor() {
                    window.__mcE2eProbe.constructed += 1;
                    throw new Error('S11 controlled worker bootstrap failure');
                }
            };
            return;
        }

        const NativeWorker = window.Worker;
        window.Worker = class InstrumentedMonteCarloWorker {
            constructor(url, options) {
                const probe = window.__mcE2eProbe;
                probe.constructed += 1;
                this.inner = new NativeWorker(url, options);
                this._onmessage = null;
                this._lastMessageHandler = null;
                this._onerror = null;
                this._heldMessage = null;
                this.inner.onmessage = event => {
                    const message = event.data;
                    const shouldHold = mode === 'delay-first-result'
                        && message?.type === 'result'
                        && message?.generationId === probe.delayedGeneration
                        && probe.heldResult === false;
                    if (shouldHold) {
                        probe.heldResult = true;
                        this._heldMessage = message;
                        return;
                    }
                    this._onmessage?.(event);
                };
                this.inner.onerror = event => this._onerror?.(event);
            }

            set onmessage(handler) {
                this._onmessage = handler;
                if (typeof handler === 'function') this._lastMessageHandler = handler;
            }

            get onmessage() {
                return this._onmessage;
            }

            set onerror(handler) {
                this._onerror = handler;
            }

            get onerror() {
                return this._onerror;
            }

            postMessage(message, transferables) {
                const probe = window.__mcE2eProbe;
                if (mode === 'delay-first-result'
                    && message?.type === 'job'
                    && probe.delayedGeneration === null) {
                    probe.delayedGeneration = message.generationId;
                }
                this.inner.postMessage(message, transferables);
            }

            terminate() {
                const probe = window.__mcE2eProbe;
                probe.terminated += 1;
                const staleHandler = this._lastMessageHandler;
                const staleMessage = this._heldMessage;
                this.inner.terminate();
                if (staleMessage && typeof staleHandler === 'function') {
                    queueMicrotask(() => {
                        probe.staleDeliveryAttempts += 1;
                        staleHandler({ data: staleMessage });
                    });
                }
            }
        };
    }, { mode: workerMode });

    await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (EXTERNAL_HOSTS.has(url.hostname)) {
            await route.fulfill({
                status: 200,
                contentType: url.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2',
                body: ''
            });
            return;
        }
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
            await route.abort('blockedbyclient');
            return;
        }
        await route.continue();
    });

    const page = await context.newPage();
    const errors = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push(`[console.error] ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`[pageerror] ${error.message}`));
    await page.goto(`${baseUrl}/Simulator.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
    });
    await page.waitForLoadState('load', { timeout: 15000 });
    await page.locator('#simulatorResultQuestion').waitFor({ state: 'visible' });

    return {
        context,
        page,
        errors,
        assertNoUnexpectedErrors(allowed = []) {
            const unexpected = errors.filter(error => !allowed.some(fragment => error.includes(fragment)));
            assert(unexpected.length === 0, `Monte-Carlo browser case emitted errors:\n${unexpected.join('\n')}`);
        }
    };
}

async function configureMonteCarloRun(page, {
    runs = 8,
    duration = 3,
    workers = 2,
    seed = 424242
} = {}) {
    await page.waitForFunction(() => window.__simulatorOpeningBacktestDone === true);
    await page.locator('.tab-btn[data-tab="montecarlo"]').click();
    await page.locator('#tab-montecarlo').waitFor({ state: 'visible' });
    await page.evaluate(({ runs, duration, workers, seed }) => {
        // Bedarfswerte sind Planfelder: ohne flüchtigen Versuch bleiben sie lesend aus Haushalt & Plan.
        const trialStart = document.getElementById('simPlanTrialStart');
        if (trialStart && !trialStart.hidden && !trialStart.disabled) trialStart.click();
        const values = {
            simStartVermoegen: '520000',
            depotwertGesamt: '500000',
            depotwertAlt: '500000',
            einstandAlt: '400000',
            tagesgeld: '20000',
            geldmarktEtf: '0',
            startFloorBedarf: '24000',
            startFlexBedarf: '6000',
            minimumFlexAnnual: '0',
            mcAnzahl: String(runs),
            mcDauer: String(duration),
            mcBlockSize: '1',
            mcSeed: String(seed),
            mcMethode: 'regime_iid',
            rngMode: 'per-run-seed',
            mcWorkerCount: String(workers),
            mcWorkerBudget: '50'
        };
        for (const [id, value] of Object.entries(values)) {
            const element = document.getElementById(id);
            if (!element) continue;
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const compare = document.getElementById('mcCompareMode');
        if (compare) compare.checked = false;
        const cape = document.getElementById('useCapeSampling');
        if (cape) cape.checked = false;
        const care = document.getElementById('pflegefallLogikAktivieren');
        if (care) care.checked = false;
    }, { runs, duration, workers, seed });
}

async function startMonteCarloWithKeyboard(page) {
    const button = page.locator('#mcButton');
    await button.focus();
    assert(await page.evaluate(() => document.activeElement?.id) === 'mcButton', 'keyboard start begins on the visible MC button');
    await page.keyboard.press('Enter');
}

async function waitForCompletedRun(page) {
    await page.locator('#mcRunStatus').filter({ hasText: 'abgeschlossen' }).waitFor({
        state: 'visible',
        timeout: 45000
    });
    await page.locator('#monteCarloResults').waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('#mcButton').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('mcButton')?.disabled === false);
}

async function downloadRunExport(page) {
    const button = page.locator('#exportMonteCarloRunJson');
    await button.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('exportMonteCarloRunJson')?.disabled === false);
    await button.focus();
    const downloadPromise = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert(downloadPath, 'MC browser export exposes a readable temporary file');
    const document = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
    validateMonteCarloExportV2(document);
    const read = readMonteCarloExport(document);
    assert(read.document === document, 'current browser export is accepted by the version dispatcher');
    assert(document.schemaVersion === MONTE_CARLO_EXPORT_V2_VERSION, 'browser export writes the current V2 schema');
    assert(read.compatibilityWarnings.length === 0, 'current V2 browser export needs no compatibility warning');
    const serialized = JSON.stringify(document);
    for (const removedAlias of [
        'kpiKuerzungsjahre',
        'consumptionAtRiskP10Real'
    ]) {
        assert(!serialized.includes(removedAlias), `current V2 browser export omits removed alias ${removedAlias}`);
    }
    return document;
}

async function downloadSelectedScenarioJson(page) {
    await page.locator('#mcViewTabLogs').click();
    assert(await page.locator('#mcViewPanelLogs').isVisible(),
        'Scenario export activates the dedicated log result view');
    const button = page.locator('#exportScenarioLogJson');
    await button.waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download');
    await button.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert(downloadPath, 'Scenario browser export exposes a readable temporary file');
    const document = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
    validateScenarioLogExportV2(document);
    return document;
}

async function assertScenarioDownloadBytes(page, expected, label) {
    for (const [format, oracle] of [['Json', expected.json], ['Csv', expected.csv]]) {
        const pending = page.waitForEvent('download');
        await page.locator(`#exportScenarioLog${format}`).click();
        const download = await pending;
        const downloadPath = await download.path();
        assert(downloadPath && fs.readFileSync(downloadPath, 'utf8') === oracle, `${label}: vollständiger ${format}-Download bytegleich zur V2-Projektion`);
    }
}

async function renderSyntheticRiskDisplayFixture(page) {
    return page.evaluate(async () => {
        const { prepareMonteCarloViewModel } = await import('/app/simulator/results-metrics.js');
        const { renderCareSection, renderKpiDashboard, renderSummary } = await import('/app/simulator/results-renderers.js');
        const results = {
            finalOutcomes: {
                p10: 100000.009,
                p50: 500000.009,
                p50_successful: 600000.009,
                p90: 900000.009,
                distribution: { sampleSize: 12 },
                successfulCount: 10,
                successfulMissingness: null
            },
            taxOutcomes: { p50: 12345678.9 },
            depotErschoepfungsQuote: 0,
            cutYearSharePct: { p50: 0, sampleSize: 12, excludedRuns: 0 },
            maxDrawdowns: {
                p50: 34.25,
                p90: 48.125,
                distribution: { sampleSize: 12, missingness: { technical_error: 0 } }
            },
            realMaxDrawdowns: {
                p50: 35.5,
                p90: 51.75,
                distribution: { sampleSize: 12, missingness: { technical_error: 0 } },
                missingness: { missing_inflation: 0, no_observations: 0, technical_error: 0 },
                observationCount: { observedPaths: 12, pathPointsAvailable: 240 }
            },
            realWithdrawalP10: {
                realEur: 12345678.9,
                p50RealEur: 9876543.21,
                sampleSize: 12,
                excludedRuns: 0,
                missingness: { no_observations: 0, technical_error: 0 }
            },
            extraKPI: {
                timeShareQuoteAbove45: 0.0125,
                lossCarryTaxSavings: { perRunMean: 331.01 },
                pflege: {
                    p1: {
                        entryRatePct: 25,
                        entryRateNumerator: 3,
                        entryRateDenominator: 12,
                        entryAgeP50: 82,
                        careYearsP50: 4,
                        realCostEurP50: 25000,
                        sampleSize: 3
                    },
                    household: {
                        sampleSize: 3,
                        noCareSampleSize: 9,
                        maxAnnualAdditionalNeedRealEurP50: 20000,
                        totalAdditionalNeedRealEurP50: 80000,
                        shortfallRateWithCarePct: 10,
                        shortfallRateWithoutCarePct: 2,
                        endWealthWithCareRealEurP50: 400000,
                        endWealthNoCareRealEurP50: 550000
                    },
                    comparison: { endWealthNoCareMinusCareRealEur: 150000 }
                }
            }
        };
        const viewModel = prepareMonteCarloViewModel({
            results,
            totalRuns: 12,
            failCount: 0,
            inputs: { pflegefallLogikAktivieren: true, partner: { aktiv: false } }
        });
        const resultRegion = document.getElementById('monteCarloResults');
        const summary = document.getElementById('monteCarloSummary');
        const dashboard = document.getElementById('unifiedKpiDashboard');
        const careContainer = document.createElement('section');
        const careSummary = document.createElement('div');
        careContainer.append(careSummary);
        renderSummary(summary, viewModel.summaryCards);
        renderKpiDashboard(dashboard, viewModel.kpiDashboard);
        renderCareSection(careSummary, careContainer, viewModel.careMetrics);
        // Die Berichtsreferenz liegt seit p4h in der Klappe; Layoutmessungen prüfen den offenen Zustand.
        dashboard.querySelector('details')?.setAttribute('open', '');
        resultRegion.replaceChildren(summary, dashboard, careContainer);
        resultRegion.style.display = 'block';
        const panel = document.getElementById('tab-montecarlo');
        panel.replaceChildren(resultRegion);
        document.body.replaceChildren(panel);
        panel.classList.add('active');
        return resultRegion.innerText;
    });
}

async function inspectSyntheticRiskLayout(page, width) {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(() => {
        const exactCards = Array.from(document.querySelectorAll('.kpi-exact-value, .summary-exact-value'));
        const clippedNodes = exactCards.flatMap(card => [
            card,
            ...card.querySelectorAll('strong, .value-line, .kpi-secondary-value, .kpi-status-line, .kpi-description')
        ]).filter(node => node.scrollWidth > node.clientWidth + 1);
        const outsideViewport = exactCards.filter(card => {
            const rect = card.getBoundingClientRect();
            return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
        });
        const copyTitles = Array.from(document.querySelectorAll('.kpi-card .sim-metric-heading > strong'))
            .filter(title => title.getBoundingClientRect().width > 0);
        const clippedCopyTitles = copyTitles.filter(title => title.scrollWidth > title.clientWidth + 1);
        const pairGrid = document.querySelector('.kpi-grid-pair');
        const pairColumns = pairGrid
            ? getComputedStyle(pairGrid).gridTemplateColumns.split(' ').filter(Boolean).length
            : 0;
        return {
            text: document.getElementById('monteCarloResults')?.innerText || '',
            exactCardCount: exactCards.length,
            clippedCount: clippedNodes.length,
            outsideViewportCount: outsideViewport.length,
            copyTitleCount: copyTitles.length,
            clippedCopyTitleCount: clippedCopyTitles.length,
            hasVisibleCareNonCausalTitle: copyTitles.some(title => title.textContent.trim() === 'Gruppenmedian-Differenz (nicht kausal)'),
            hasVisibleWithdrawalRateTitle: copyTitles.some(title => title.textContent.trim() === 'Zeitanteil realisierte Entnahmequote > 4,5 %'),
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            pairColumns,
            referenceVisible: document.querySelector('.mc-more-metrics .reporting-reference-note')?.getBoundingClientRect().height > 0
        };
    });
}

async function inspectFullSimulatorLayout(page, width) {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const overflowingElements = Array.from(document.querySelectorAll('body *')).map(element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                tag: element.tagName,
                id: element.id || '',
                className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
                text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                scrollWidth: element.scrollWidth,
                overflowX: style.overflowX,
                display: style.display
            };
        }).filter(item => item.display !== 'none' && item.right > viewportWidth + 1 && item.overflowX === 'visible')
            .sort((left, right) => right.right - left.right)
            .slice(0, 12);
        const nonLogOverflowingElements = Array.from(document.querySelectorAll('body *'))
            .filter(element => !element.closest('#scenarioLogOutput'))
            .map(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    tag: element.tagName,
                    id: element.id || '',
                    className: typeof element.className === 'string' ? element.className.slice(0, 100) : '',
                    text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
                    left: Math.round(rect.left),
                    right: Math.round(rect.right),
                    width: Math.round(rect.width),
                    scrollWidth: element.scrollWidth,
                    overflowX: style.overflowX,
                    display: style.display
                };
            }).filter(item => item.display !== 'none' && (item.right > viewportWidth + 1 || item.scrollWidth > item.width + 1))
            .sort((left, right) => Math.max(right.right - viewportWidth, right.scrollWidth - right.width) - Math.max(left.right - viewportWidth, left.scrollWidth - left.width))
            .slice(0, 12);
        const logAncestors = [];
        let logNode = document.querySelector('#scenarioLogOutput table');
        while (logNode && logNode !== document.body && logAncestors.length < 10) {
            const rect = logNode.getBoundingClientRect();
            const style = getComputedStyle(logNode);
            logAncestors.push({
                tag: logNode.tagName,
                id: logNode.id || '',
                className: typeof logNode.className === 'string' ? logNode.className.slice(0, 100) : '',
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                scrollWidth: logNode.scrollWidth,
                minWidth: style.minWidth,
                maxWidth: style.maxWidth,
                overflowX: style.overflowX,
                boxSizing: style.boxSizing
            });
            logNode = logNode.parentElement;
        }
        return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth,
            bodyWidth: document.body.scrollWidth,
            mainWidth: Math.ceil(document.querySelector('.main-layout')?.getBoundingClientRect().width || 0),
            overflowingElements,
            nonLogOverflowingElements,
            logAncestors,
            visibleFieldsetOverflowCount: Array.from(document.querySelectorAll('fieldset')).filter(fieldset => {
            const rect = fieldset.getBoundingClientRect();
            return rect.width > 0 && rect.right > document.documentElement.clientWidth + 1;
            }).length
        };
    });
}

// Ausschließlich passive Messung: keine Fokus- oder Scrollhilfe nach dem Rückweg.
function measureReplayReturn({ selectedId, requireVisible = false }) {
    const list = document.getElementById('scenarioList');
    const option = Array.from(list?.querySelectorAll('[role="option"]') || [])
        .find(node => node.getAttribute('data-scenario-id') === selectedId);
    const rect = node => {
        const bounds = node?.getBoundingClientRect();
        return bounds ? { top: bounds.top, bottom: bounds.bottom, height: bounds.height } : null;
    };
    const row = rect(option), area = rect(list);
    const state = {
        width: window.innerWidth, selectedId, windowHeight: window.innerHeight, scrollY: window.scrollY,
        row, area,
        mcActive: document.getElementById('tab-montecarlo')?.classList.contains('active'),
        logsVisible: document.getElementById('mcViewPanelLogs')?.hidden === false
            && document.getElementById('mcViewPanelLogs')?.getBoundingClientRect().height > 0,
        open: document.getElementById('scenarioSelectionDisclosure')?.open === true,
        focused: !!option && document.activeElement === option,
        selected: option?.getAttribute('aria-selected') === 'true'
            && list?.getAttribute('data-selected-id') === selectedId
    };
    state.passed = state.mcActive && state.logsVisible && state.open && state.focused && state.selected
        && row?.height > 0 && area?.height > 0
        && row.top >= 0 && row.bottom <= window.innerHeight
        && row.top >= area.top + list.clientTop
        && row.bottom <= area.top + list.clientTop + list.clientHeight;
    return requireVisible && !state.passed ? false : state;
}

async function assertReplayReturnVisible(page, selectedId) {
    try {
        const handle = await page.waitForFunction(measureReplayReturn,
            { selectedId, requireVisible: true }, { timeout: 5000, polling: 'raf' });
        await handle.dispose();
    } catch (error) {
        const state = await page.evaluate(measureReplayReturn, { selectedId });
        throw new Error(`Replay-Rückweg erreicht keine vollständig sichtbare Option: ${JSON.stringify(state)}`, { cause: error });
    }
}

async function runWorkerSuccessCase(browser, baseUrl) {
    const test = await createMonteCarloPage(browser, baseUrl);
    try {
        const { page } = test;
        await configureMonteCarloRun(page, { runs: 8, duration: 3, workers: 2 });
        assert(await page.locator('#mc-progress-bar-container').getAttribute('role') === 'progressbar', 'browser progress exposes progressbar semantics');
        assert(await page.locator('#mc-error-container').getAttribute('role') === 'alert', 'browser errors expose alert semantics');
        assert(await page.locator('#mcRunStatus').getAttribute('aria-live') === 'polite', 'run status is announced politely');
        assert(await page.locator('#monteCarloResults').getAttribute('tabindex') === '-1', 'result region is programmatically focusable');

        await startMonteCarloWithKeyboard(page);
        await page.locator('#mcCancelButton').waitFor({ state: 'visible' });
        assert(await page.locator('#mcButton').getAttribute('aria-busy') === 'true', 'running button exposes busy state');
        await waitForCompletedRun(page);

        assert(await page.locator('#scenarioSelector').count() === 1,
            'completed run keeps one stable scenario selector container');
        assert(await page.locator('#mcViewPanelLogs #scenarioList[role="listbox"]').count() === 1 && await page.locator('#scenarioSelect').count() === 0,
            'completed run renders the eine aktuelle Listbox beim Protokoll');
        await page.locator('#mcViewTabLogs').click();
        const scenarioValues = await page.locator('#scenarioList [role="option"]').evaluateAll(options =>
            options.map(option => option.getAttribute('data-scenario-id')));
        assert(scenarioValues.length > 1, 'completed run offers multiple characteristic or random scenarios');
        assert(await page.locator('#scenarioList button[data-scenario-id]').count() === scenarioValues.length,
            'jeder angebotene Schlüssel bleibt auch als Tastaturknopf in der Liste erreichbar');
        assert(await page.locator('#scenarioWealthChart svg title').count() > 0
            && await page.locator('#scenarioWealthChart svg desc').count() === 1,
            'echte Laufverläufe besitzen SVG-Titel und zugängliche Beschreibung');
        assert(await page.locator('#scenarioWealthChart [data-fan-background="true"]').count() === 1,
            'Szenariohintergrund stammt aus dem aktuellen Jahresfächer');
        const listSelection = page.locator(`#scenarioList button[data-scenario-id="${scenarioValues[1]}"]`);
        await listSelection.focus();
        await listSelection.press('Enter');
        assert(await page.locator('#scenarioList').getAttribute('data-selected-id') === scenarioValues[1]
            && await listSelection.getAttribute('aria-selected') === 'true',
            'Tastaturwahl in der Liste synchronisiert Kennung und assistiven Zustand');
        const beforeMode = await page.evaluate(async () => {
            const { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } = await import('./app/simulator/monte-carlo-export.js');
            const projected = projectScenarioLogV2(window.globalCurrentScenarioData.rows, { personDataContext: window.globalCurrentScenarioData.personDataContext });
            return { json: serializeScenarioLogExportV2(projected), csv: serializeScenarioLogCsvV2(projected), label: document.getElementById('stressReplaySelectedScenarioLabel').textContent };
        });
        await assertScenarioDownloadBytes(page, beforeMode, 'Listenwahl');
        await page.locator('#mcWealthMode [data-wealth-mode="nominal"]').click();
        await assertScenarioDownloadBytes(page, beforeMode, 'Nominalwechsel');
        assert(await page.locator('#scenarioList').getAttribute('data-selected-id') === scenarioValues[1]
            && await page.locator('#mcWealthMode [data-wealth-mode="nominal"]').getAttribute('aria-pressed') === 'true',
            'Moduswechsel erhält die Auswahl und synchronisiert beide Ergebnisansichten');
        assert(await page.evaluate(async expected => {
            const { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } = await import('./app/simulator/monte-carlo-export.js');
            const projected = projectScenarioLogV2(window.globalCurrentScenarioData.rows, { personDataContext: window.globalCurrentScenarioData.personDataContext });
            return serializeScenarioLogExportV2(projected) === expected.json && serializeScenarioLogCsvV2(projected) === expected.csv
                && document.getElementById('stressReplaySelectedScenarioLabel').textContent === expected.label;
        }, beforeMode), 'Maßstabwechsel erhält vollständige Exportprojektion und Replayquelle');
        await page.locator('#mcViewTabRisk').click();
        assert(await page.locator('#wealthDistribution svg').isVisible()
            && (await page.locator('#wealthDistribution .wealth-reading').textContent()).includes('Die Marken sind die Szenario-Läufe; ihre Reihenfolge richtet sich nach dem nominalen Endvermögen.')
            && (await page.locator('#wealthDistribution .wealth-reading').textContent()).includes('Die Beträge im Satz beschreiben die Verteilung aller Läufe und können von den Marken abweichen.'),
            'echter Lauf liefert Histogramm und ehrliche Lesart der Szenariomarken');
        assert(await page.locator('#wealthFanChart svg').isVisible()
            && (await page.locator('#wealthFanChart .wealth-population').textContent()).includes('nominale Euro'),
            'Jahresfächer und gemeinsamer Schalter verwenden nominale Jahreszähler');
        await page.locator('#mcWealthMode [data-wealth-mode="real"]').click();
        assert(await page.locator('#wealthDistribution .wealth-population').textContent().then(text => text.includes('heutige Euro')),
            'reales Histogramm verwendet vorhandene Endbeobachtungen');
        assert((await page.locator('#wealthDistribution .wealth-reading').textContent()).includes('Abstände können negativ sein'), 'Realer Zusatz erklärt die mögliche abweichende Reihenfolge ohne neue Szenarioauswahl');
        assert((await page.locator('#wealthFanChart .wealth-population').textContent()).includes('heutige Euro'),
            'Jahresfächer wechselt auf reale Jahreszähler');
        await page.locator('#mcViewTabLogs').click();
        await page.locator(`#scenarioWealthChart [data-scenario-id="${scenarioValues[0]}"] path`).first().dispatchEvent('click');
        assert(await page.locator('#scenarioList').getAttribute('data-selected-id') === scenarioValues[0],
            'SVG-Ereignis nutzt denselben Quellschlüssel wie Liste und Navigation');
        await page.locator(`#scenarioList [data-scenario-id="${scenarioValues[1]}"]`).click();
        for (const width of [768, 390, 320, 1366]) {
            await page.setViewportSize({ width, height: 900 });
            // Designsystem-Schalter: der sichtbare Regler liegt über dem Kontrollkästchen; wie ein Nutzer über das Label schalten.
            for (const [id, wanted] of [['toggle-log-detail', width !== 1366], ['toggle-care-details', width === 390 || width === 1366]]) {
                if (await page.locator(`#${id}`).isChecked() !== wanted) await page.locator(`label:has(#${id})`).click();
            }
            await assertScenarioDownloadBytes(page, beforeMode, `${width}: Resize und Detail-/Pflegeschalter`);
        }
        await page.locator('#scenarioPrevious').click();
        await page.locator('#scenarioNext').click();
        assert(await page.locator('#scenarioList').getAttribute('data-selected-id') === scenarioValues[1], 'Navigation kehrt zu derselben Gruppenkennung zurück');
        await assertScenarioDownloadBytes(page, beforeMode, 'Navigationswahl');
        assert(await page.locator('#scenarioLogOutput .protocol-group-head').count() === 1, 'MC-Protokoll verwendet den gemeinsamen Gruppenkopf');
        assert(await page.locator('#scenario-controls #exportScenarioLogJson').count() === 1 && await page.locator('#scenario-controls #exportScenarioLogCsv').count() === 1, 'MC-Downloads sind eindeutige Knoten im Protokollkopf');
        assert(await page.locator('#scenarioLogOutput table').isVisible(),
            'changing the scenario updates a visible log without leaving the logs panel');
        const replayReturnWidths = [];
        for (const width of [1366, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert(await page.locator('#scenarioList').getAttribute('data-selected-id') === scenarioValues[1], `${width}: Rückweg verwendet dieselbe gewählte Szenariokennung`);
            await page.locator('#mcShowReplayButton').click();
            assert(await page.locator('#workshopReplayPanel').isVisible(),
                'scenario-log backlink activates replay after a run');
            assert(await page.evaluate(() => document.activeElement?.id) === 'stressReplayFixButton',
                'scenario-log backlink focuses the enabled fixation action in replay');
            const replayProjection = await page.locator('#stressReplaySelectedScenarioDetails').evaluate(details => ({
                hidden: details.hidden,
                label: details.querySelector('#stressReplaySelectedScenarioLabel')?.textContent,
                wealth: details.querySelector('#stressReplaySelectedScenarioWealth')?.textContent,
                care: details.querySelector('#stressReplaySelectedScenarioCare')?.textContent
            }));
            assert(!replayProjection.hidden && replayProjection.label
                && replayProjection.wealth !== '—' && replayProjection.care !== '—',
            `replay projects label, terminal wealth and care marker from the selected log: ${JSON.stringify(replayProjection)}`);
            if (width === 1366) {
                await page.locator('#stressReplayFixButton').click();
                await page.locator('#stressReplayStatus').filter({ hasText: 'Stresspfad fixiert' }).waitFor({ timeout: 30000 });
            }
            const workshopScroll = await page.evaluate(() => {
                document.getElementById('scenarioSelectionDisclosure').open = false;
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
                return { scrollY: window.scrollY, height: window.innerHeight, width: window.innerWidth };
            });
            assert(workshopScroll.scrollY > 0, `${width}: Werkstatt ist vor dem Rückweg nach unten gescrollt: ${JSON.stringify(workshopScroll)}`);
            await page.locator('#mcShowScenarioLogsButton').click();
            await assertReplayReturnVisible(page, scenarioValues[1]);
            replayReturnWidths.push(width);
        }
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.locator('#mcViewTabOverview').click();

        await page.locator('#mcButton').click();
        await page.locator('#mcCancelButton').waitFor({ state: 'visible' });
        await waitForCompletedRun(page);
        assert(await page.locator('#scenarioSelector').count() === 1
            && await page.locator('#scenarioList[role="listbox"]').count() === 1 && await page.locator('#scenarioGroups button').count() === 4,
        'a second run rerenders eine aktuelle Listbox in the stable container');
        assert(await page.locator('#stressReplaySelectedScenarioDetails').evaluate(details => !details.hidden),
            'a second run refreshes the read-only replay projection');
        assert(!(await page.locator('#stressReplayFixButton').isDisabled()),
            'the current worst-run selection remains connected to fixation after rerender');

        const visibleResult = await page.locator('#monteCarloResults').textContent();
        for (const label of [
            'Floor-Deckung im gewählten Horizont',
            'Endzustände',
            'Anteil Kürzungsjahre (≥ 10 %)',
            'Reale Depotentnahme P10'
        ]) {
            assert(visibleResult.includes(label), `completed browser result shows ${label}`);
        }
        assert(visibleResult.includes('95-%-Konfidenzintervall'), 'completed browser result shows estimator uncertainty');
        assert(await page.locator('#monteCarloResults').getByText(/95-%-Konfidenzintervall/).first().isVisible(),
            'completed browser result shows visible estimator uncertainty');
        assert(await page.evaluate(() => document.activeElement?.id) === 'monteCarloResults', 'completed run focuses the result region');

        const actualMobileLayout = await inspectFullSimulatorLayout(page, 320);
        assert(actualMobileLayout.documentWidth <= actualMobileLayout.viewportWidth && actualMobileLayout.bodyWidth <= actualMobileLayout.viewportWidth, `real 320px Simulator page should not overflow horizontally: ${JSON.stringify(actualMobileLayout)}`);
        assert(actualMobileLayout.visibleFieldsetOverflowCount === 0, `real 320px Simulator fieldsets should remain inside the viewport: ${JSON.stringify(actualMobileLayout)}`);
        await page.setViewportSize({ width: 1366, height: 900 });

        const exported = await downloadRunExport(page);
        assert(exported.request.execution.mode === 'worker', 'successful browser run records worker execution');
        assert(exported.request.execution.workerCount === 2, 'successful browser run records requested worker count');
        assert(exported.request.execution.chunkConfiguration.strategy === 'adaptive-time-budget-v1', 'worker export records adaptive chunk strategy');
        assert(exported.result.diagnostics.sampling.schemaVersion === 'MonteCarloSamplingDiagnosticsV1', 'export contains versioned sampling diagnostics');
        const inventory = exported.result.outcomeInventory;
        assert(inventory.ruin + inventory.all_dead + inventory.horizon_exhausted + inventory.technical_error === 8, 'browser outcome inventory accounts for every requested run');
        assert(exported.result.uncertainty.floorCoverage?.confidenceInterval95, 'browser export contains floor-coverage uncertainty');

        const selectedScenario = await downloadSelectedScenarioJson(page);
        assert(selectedScenario.records.length > 0, 'valid selected scenario exports through the lazy V2 projection');
        const invalidSelection = await page.evaluate(async inputs => {
            const { displayMonteCarloResults } = await import('./app/simulator/simulator-results.js');
            const previousRows = window.globalCurrentScenarioData?.rows;
            const source = window.globalScenarioLogs?.characteristic?.find(entry => entry.logDataRows?.length > 0);
            if (!source) return { prepared: false };
            const invalidRows = source.logDataRows.map((row, index) => ({
                ...row,
                ...(index === 0 ? { invalidExportProbe: Number.NaN } : {})
            }));
            const logs = { characteristic: [...window.globalScenarioLogs.characteristic], random: [...window.globalScenarioLogs.random] };
            logs.characteristic.push({
                ...source,
                key: 'invalid_export_probe',
                label: 'Invalid export probe',
                logDataRows: invalidRows
            });
            // B muss vor dem regulären Binden zum gültigen Auswahlbestand gehören.
            // Eine nachträglich eingefügte Optionszeile erweitert den Binder nicht.
            displayMonteCarloResults({}, 8, 0, null, {}, {}, 0, inputs, null, logs);
            document.querySelector('#scenarioWealthChart g[data-scenario-id="char_invalid_export_probe"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return {
                prepared: true,
                oldStateReused: window.globalCurrentScenarioData?.rows === previousRows,
                exactRows: window.globalCurrentScenarioData?.rows === invalidRows,
                selectedId: document.getElementById('scenarioList').getAttribute('data-selected-id'),
                currentContainsInvalidProbe: Number.isNaN(window.globalCurrentScenarioData?.rows?.[0]?.invalidExportProbe),
                cachedExportDocument: Object.hasOwn(window.globalCurrentScenarioData || {}, 'exportDocument')
            };
        }, exported.request.scenario.normalizedInputs);
        assert(invalidSelection.exactRows && invalidSelection.selectedId === 'char_invalid_export_probe', 'reguläre B-Auswahl publiziert exakt Bs Rohzeilen');
        assert(invalidSelection.prepared, 'browser regression prepares a second non-projectable scenario');
        assert(invalidSelection.oldStateReused === false, 'selecting scenario B invalidates scenario A export state');
        assert(invalidSelection.currentContainsInvalidProbe, 'scenario B becomes the current raw export source');
        assert(invalidSelection.cachedExportDocument === false, 'scenario selection does not cache a stale projected document');

        for (const exportButton of ['#exportScenarioLogJson', '#exportScenarioLogCsv']) {
            const unexpectedDownload = page.waitForEvent('download', { timeout: 1000 })
                .then(() => true)
                .catch(() => false);
            await page.locator(exportButton).click();
            assert(await unexpectedDownload === false, 'invalid scenario B cannot download the previous scenario A');
            await page.locator('#toastContainer').filter({ hasText: 'Szenario-Export nicht möglich' }).waitFor({ state: 'visible' });
            assert(await page.evaluate(() => Number.isNaN(window.globalCurrentScenarioData?.rows?.[0]?.invalidExportProbe)),
                'failed export keeps scenario B selected instead of restoring scenario A');
        }

        const fixtureText = (await renderSyntheticRiskDisplayFixture(page)).replace(/\u00a0/g, ' ');
        assert(fixtureText.includes('12.345.678,90') && fixtureText.includes('9.876.543,21'), 'synthetic browser fixture renders both large cent-exact benefit/cost values as DOM text');
        assert(fixtureText.includes('Max. Drawdown nominal (Median)') && fixtureText.includes('Max. Drawdown real (Median)'), 'synthetic browser fixture renders both price bases');
        assert(fixtureText.includes('34,25 %') && fixtureText.includes('35,50 %'), 'synthetic browser fixture renders both drawdowns exactly');
        assert(fixtureText.includes('Gruppenmedian-Differenz (nicht kausal)'), 'synthetic browser fixture renders the care non-causality marker in the DOM');

        const desktopLayout = await inspectSyntheticRiskLayout(page, 1366);
        assert(desktopLayout.referenceVisible, 'Desktop: Berichtsreferenz ist in der geöffneten Kennzahlenklappe sichtbar');
        assert(desktopLayout.pairColumns === 4, `desktop drawdowns should be in four columns: ${JSON.stringify(desktopLayout)}`);
        assert(desktopLayout.clippedCount === 0 && desktopLayout.outsideViewportCount === 0, `desktop exact cards should not clip or overlap the viewport: ${JSON.stringify(desktopLayout)}`);
        assert(desktopLayout.clippedCopyTitleCount === 0 && desktopLayout.hasVisibleCareNonCausalTitle && desktopLayout.hasVisibleWithdrawalRateTitle, `desktop copy-critical titles should remain fully visible: ${JSON.stringify(desktopLayout)}`);
        assert(desktopLayout.documentWidth <= desktopLayout.viewportWidth, `desktop result should not overflow horizontally: ${JSON.stringify(desktopLayout)}`);

        const mobileLayout = await inspectSyntheticRiskLayout(page, 320);
        assert(mobileLayout.referenceVisible, '320 px: Berichtsreferenz ist in der geöffneten Kennzahlenklappe sichtbar');
        assert(mobileLayout.pairColumns === 1, `320px drawdowns should wrap to one column: ${JSON.stringify(mobileLayout)}`);
        assert(mobileLayout.clippedCount === 0 && mobileLayout.outsideViewportCount === 0, `320px exact cards should remain fully readable: ${JSON.stringify(mobileLayout)}`);
        assert(mobileLayout.clippedCopyTitleCount === 0 && mobileLayout.hasVisibleCareNonCausalTitle && mobileLayout.hasVisibleWithdrawalRateTitle, `320px copy-critical titles should remain fully visible: ${JSON.stringify(mobileLayout)}`);
        assert(mobileLayout.documentWidth <= mobileLayout.viewportWidth, `320px result should not overflow horizontally: ${JSON.stringify(mobileLayout)}`);
        test.assertNoUnexpectedErrors(['Szenario-Export fehlgeschlagen']);
        return replayReturnWidths;
    } finally {
        await test.context.close();
    }
}

async function runForcedFallbackCase(browser, baseUrl) {
    const test = await createMonteCarloPage(browser, baseUrl, { workerMode: 'throw' });
    try {
        const { page } = test;
        await configureMonteCarloRun(page, { runs: 5, duration: 2, workers: 2, seed: 515151 });
        await page.locator('#mcButton').click();
        await waitForCompletedRun(page);
        const exported = await downloadRunExport(page);
        const probe = await page.evaluate(() => window.__mcE2eProbe);
        assert(probe.constructed === 1, 'controlled fallback attempts worker bootstrap exactly once');
        assert(exported.request.execution.mode === 'serial', 'controlled worker failure records the serial fallback path');
        assert(exported.request.execution.workerCount === 0, 'serial fallback export records no active workers');
        test.assertNoUnexpectedErrors(['S11 controlled worker bootstrap failure']);
    } finally {
        await test.context.close();
    }
}

async function runFailedReplayProjectionCase(browser, baseUrl) {
    const test = await createMonteCarloPage(browser, baseUrl);
    try {
        const { page } = test;
        await configureMonteCarloRun(page, { runs: 1, duration: 2, workers: 1, seed: 818181 });
        await page.locator('.tab-btn[data-tab="annahmen"]').click();
        await page.locator('#tab-annahmen').waitFor({ state: 'visible' });
        const need = page.locator('#tab-annahmen [data-assumption-step="2"]');
        const toggle = need.locator('[data-step-toggle]');
        if (await toggle.getAttribute('aria-expanded') === 'false') {
            await toggle.click();
        }
        const floorInput = need.locator('#startFloorBedarf');
        await floorInput.evaluate(input => {
            for (let parent = input.parentElement; parent; parent = parent.parentElement) {
                if (parent.matches('details')) parent.open = true;
            }
        });
        await floorInput.waitFor({ state: 'visible' });
        assert(await floorInput.isEditable(), 'Floor-Eingabe muss im Rahmendatenbereich bedienbar sein');
        await floorInput.fill('2000000');
        assert(await floorInput.inputValue() === '2000000', 'Sichtbare Floor-Eingabe bestaetigt 2000000');
        await page.locator('.tab-btn[data-tab="montecarlo"]').click();
        await page.locator('#tab-montecarlo').waitFor({ state: 'visible' });
        await page.locator('#mcButton').waitFor({ state: 'visible' });
        await page.locator('#mcButton').click();
        await waitForCompletedRun(page);
        const exported = await downloadRunExport(page);
        assert(exported.request.scenario.normalizedInputs.startFloorBedarf === 2000000,
            'Realer Laufexport bestaetigt den normalisierten Floor von 2000000');
        await page.locator('#mcViewTabLogs').click();

        const failedScenarioValue = await page.evaluate(() => {
            const scenario = window.globalScenarioLogs?.characteristic?.find(entry =>
                entry?.failed === true && Array.isArray(entry.logDataRows) && entry.logDataRows.length > 0);
            return scenario ? `char_${scenario.key}` : null;
        });
        assert(failedScenarioValue, 'failing withdrawal profile produces a failed characteristic scenario');
        await page.locator(`#scenarioWealthChart g[data-scenario-id="${failedScenarioValue}"]`).dispatchEvent('click');
        assert(await page.locator('#stressReplaySelectedScenarioWealth').textContent() === 'FAILED',
            'selecting a failed characteristic scenario projects FAILED before fixation');

        await page.locator('#mcShowReplayButton').click();
        await page.locator('#stressReplayFixButton').click();
        await page.locator('#stressReplayStatus').filter({ hasText: 'Stresspfad fixiert' }).waitFor({ timeout: 30000 });
        assert(await page.locator('#stressReplaySelectedScenarioWealth').textContent() === 'FAILED',
            'the failed scenario projection remains FAILED after fixation');
        test.assertNoUnexpectedErrors();
    } finally {
        await test.context.close();
    }
}

async function runTechnicalErrorCase(browser, baseUrl) {
    const test = await createMonteCarloPage(browser, baseUrl, { workerMode: 'throw' });
    try {
        const { page } = test;
        await configureMonteCarloRun(page, { runs: 3, duration: 2, workers: 1, seed: 616161 });
        await page.evaluate(() => {
            window.EngineAPI = {};
        });
        await page.locator('#mcButton').click();
        await page.locator('#mc-error-container').waitFor({ state: 'visible', timeout: 45000 });
        await page.waitForFunction(() => document.getElementById('mcButton')?.disabled === false);
        const errorText = await page.locator('#mc-error-message').textContent();
        assert(errorText.includes('ENGINE_METHOD_UNAVAILABLE'), 'technical browser path exposes the stable engine error code');
        assert(errorText.includes('Terminale Outcomes:'), 'technical browser path preserves the outcome inventory');
        assert(await page.evaluate(() => document.activeElement?.id) === 'mc-error-container', 'technical run focuses the alert region');
        const exported = await downloadRunExport(page);
        assert(exported.result.batchStatus === 'technical_error', 'technical browser export is fail-closed');
        assert(exported.result.outcomeInventory.technical_error === 3, 'technical browser export accounts for every failed path');
        assert(exported.result.outcomeInventory.floorCoveragePct === null, 'technical browser export suppresses floor coverage');
        test.assertNoUnexpectedErrors(['S11 controlled worker bootstrap failure']);
    } finally {
        await test.context.close();
    }
}

async function runCancelRestartCase(browser, baseUrl) {
    const test = await createMonteCarloPage(browser, baseUrl, { workerMode: 'delay-first-result' });
    try {
        const { page } = test;
        await configureMonteCarloRun(page, { runs: 40, duration: 3, workers: 1, seed: 717171 });
        await page.locator('#mcButton').click();
        await page.waitForFunction(() => window.__mcE2eProbe?.heldResult === true, null, { timeout: 45000 });

        const cancelButton = page.locator('#mcCancelButton');
        await cancelButton.focus();
        await page.keyboard.press('Enter');
        await page.locator('#mcRunStatus').filter({ hasText: 'abgebrochen' }).waitFor({ state: 'visible', timeout: 45000 });
        await page.waitForFunction(() => document.getElementById('mcButton')?.disabled === false);
        assert(await page.evaluate(() => document.activeElement?.id) === 'mcButton', 'cancel returns focus to the start control');
        await page.waitForFunction(() => window.__mcE2eProbe?.staleDeliveryAttempts === 1);

        await startMonteCarloWithKeyboard(page);
        await waitForCompletedRun(page);
        const exported = await downloadRunExport(page);
        const probe = await page.evaluate(() => window.__mcE2eProbe);
        assert(probe.constructed === 2, 'cancel plus explicit restart creates exactly one lazy replacement worker');
        assert(probe.terminated === 1, 'user cancel terminates only the active old-generation worker');
        assert(probe.staleDeliveryAttempts === 1, 'fixture delivers one late old-generation result');
        assert(exported.request.execution.mode === 'worker', 'restart completes through the replacement worker');
        assert(exported.request.parameters.seed === 717171, 'late old result cannot replace the restarted request');
        assert(exported.result.batchStatus === 'completed', 'restart remains completed after the stale delivery attempt');
        test.assertNoUnexpectedErrors();
    } finally {
        await test.context.close();
    }
}

export async function runMonteCarloBrowserRegression(browser, baseUrl) {
    const replayReturnWidths = await runWorkerSuccessCase(browser, baseUrl);
    await runForcedFallbackCase(browser, baseUrl);
    await runFailedReplayProjectionCase(browser, baseUrl);
    await runTechnicalErrorCase(browser, baseUrl);
    await runCancelRestartCase(browser, baseUrl);
    return { replayReturnWidths };
}
