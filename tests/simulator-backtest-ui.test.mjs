import {
    buildAccessibleBacktestTableHtml,
    configureHistoricalBacktestControls,
    describeHistoricalBacktestResult,
    renderHistoricalBacktestStatus,
    renderHistoricalBacktestContext,
    renderHistoricalBacktestValidation,
    summarizeHistoricalBacktestDataQuality,
    validateHistoricalBacktestPeriod
} from '../app/simulator/historical-backtest-ui.js';
import {
    buildBacktestColumnDefinitions,
    formatColumnValue
} from '../app/simulator/simulator-main-helpers.js';
import { STRATEGY_OPTIONS } from '../types/strategy-options.js';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { getEuroMode, setEuroMode } from '../app/simulator/euro-display.js';

console.log('--- Simulator Backtest UI Contract Tests ---');

class MockElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.dataset = {};
        this.attributes = new Map();
        this.focusCalls = 0;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    focus() {
        this.focusCalls++;
    }

    addEventListener(type, handler) {
        this.listeners ||= new Map();
        this.listeners.set(type, handler);
    }

    removeEventListener(type) { this.listeners?.delete(type); }
}

class MockDocument {
    constructor(ids) {
        this.elements = new Map(ids.map(id => [id, new MockElement(id)]));
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }
}

const documentRef = new MockDocument([
    'simStartJahr',
    'simEndJahr',
    'simStartJahrError',
    'simEndJahrError',
    'backtestDatasetHint',
    'backtestStatus',
    'backtestResultHeading',
    'backtestDatasetInfoPop',
    'backtestResultPeriod',
    'backtestResultInfoPop'
]);

const provider = {
    datasetId: 'synthetic-browser-contract',
    revision: '2026-07-19',
    bounds: { startYear: 1951, endYear: 2025, lookbackYears: 1 }
};

console.log('Test 1: dataset bounds are projected into controls and visible guidance');
{
    const bounds = configureHistoricalBacktestControls(documentRef, provider);
    assertEqual(bounds.startYear, 1951, 'Configured bounds expose the provider start year');
    assertEqual(documentRef.getElementById('simStartJahr').min, '1951', 'Start input receives dynamic minimum');
    assertEqual(documentRef.getElementById('simEndJahr').max, '2025', 'End input receives dynamic maximum');
    assert(documentRef.getElementById('backtestDatasetInfoPop').textContent.includes('synthetic-browser-contract'), 'Info popup names the dataset');
    assert(documentRef.getElementById('backtestDatasetHint').textContent.includes('1951–2025'), 'Visible hint names the inclusive bounds');
}

console.log('Test 2: empty, NaN, fractional, reversed and out-of-bounds periods fail per field');
{
    const cases = [
        [{ startRaw: '', endRaw: '2000' }, 'simStartJahr', 'required'],
        [{ startRaw: 'NaN', endRaw: '2000' }, 'simStartJahr', 'finite'],
        [{ startRaw: '1999.5', endRaw: '2000' }, 'simStartJahr', 'integer'],
        [{ startRaw: '2001', endRaw: '2000' }, 'simEndJahr', 'reverse'],
        [{ startRaw: '1950', endRaw: '2000' }, 'simStartJahr', 'bounds'],
        [{ startRaw: '2000', endRaw: '2026' }, 'simEndJahr', 'bounds']
    ];
    for (const [period, expectedField, label] of cases) {
        const validation = validateHistoricalBacktestPeriod({ ...period, bounds: provider.bounds });
        assert(!validation.valid, `${label}: invalid period is rejected`);
        assertEqual(validation.firstErrorFieldId, expectedField, `${label}: first invalid field is deterministic`);
    }
    const singleYear = validateHistoricalBacktestPeriod({ startRaw: '2000', endRaw: '2000', bounds: provider.bounds });
    assert(singleYear.valid, 'Inclusive one-year period remains valid');
}

console.log('Test 3: field validation focuses the first invalid period field');
{
    const invalid = validateHistoricalBacktestPeriod({ startRaw: '2001', endRaw: '2000', bounds: provider.bounds });
    renderHistoricalBacktestValidation(documentRef, invalid);
    assertEqual(invalid.firstErrorFieldId, 'simEndJahr', 'Reversed period maps to the end year');
    assertEqual(documentRef.getElementById('simEndJahr').getAttribute('aria-invalid'), 'true', 'Invalid period field exposes aria-invalid');
    assertEqual(documentRef.getElementById('simEndJahr').focusCalls, 1, 'First invalid period field receives focus');
    assert(!documentRef.getElementById('simEndJahrError').hidden, 'Inline period error is visible');
}

console.log('Test 4: technical status exposes a stable code without stack or local path');
{
    const result = {
        outcome: {
            kind: 'technical_error',
            error: {
                code: 'SYNTHETIC_TECHNICAL_ERROR',
                message: 'failed at C:\\Users\\<Name>\\private\\source.js',
                stack: 'secret stack'
            }
        },
        error: {
            code: 'SYNTHETIC_TECHNICAL_ERROR',
            message: 'failed at C:\\Users\\<Name>\\private\\source.js',
            stack: 'secret stack'
        }
    };
    renderHistoricalBacktestStatus(documentRef, describeHistoricalBacktestResult(result), { focus: true });
    const html = documentRef.getElementById('backtestStatus').innerHTML;
    assert(html.includes('SYNTHETIC_TECHNICAL_ERROR'), 'Technical status exposes its stable code');
    assert(!html.includes('C:\\Users') && !html.includes('secret stack'), 'Technical status suppresses local path and stack');
    assertEqual(documentRef.getElementById('backtestStatus').dataset.status, 'technical_error', 'Technical status is machine-readable');
    assert(documentRef.getElementById('backtestStatus').focusCalls > 0, 'Terminal status receives focus');
}

console.log('Test 5: data-quality projection counts canonical observation statuses');
{
    const quality = summarizeHistoricalBacktestDataQuality({
        historicalYearRecords: [{
            realized: {
                equityReturn: { qualityStatus: 'present' },
                inflation: { qualityStatus: 'estimated' }
            },
            decisionAsOf: { capeRatio: { qualityStatus: 'unresolved' } }
        }]
    });
    assertEqual(quality.total, 3, 'Every canonical observation contributes to the quality inventory');
    assertEqual(quality.limited, 2, 'Estimated and unresolved observations are limited quality');
    assert(quality.label.includes('gemessen: 1') && quality.label.includes('geschätzt: 1') && quality.label.includes('ungeklärt: 1'), 'Qualitätslabel zeigt deutsche Statusnamen mit unveränderten Zählungen');
}

console.log('Test 6: accessible table has caption, scoped headers and escaped cell data');
{
    const html = buildAccessibleBacktestTableHtml(
        [{ jahr: 2000, row: { status: '<unsafe>' } }],
        [
            { header: 'Jahr', key: 'jahr' },
            { header: 'Status', key: 'row.status' }
        ],
        (column, row) => column.key === 'jahr' ? row.jahr : row.row.status
    );
    assert(html.includes('<caption>'), 'Backtest table contains a caption');
    assertEqual((html.match(/scope="col"/g) || []).length, 2, 'Every column header declares scope=col');
    assert(html.includes('aria-label="Jahresentnahme"') === false, 'Accessible labels follow the actual columns');
    assert(html.includes('aria-label="Handlung. Vollständige Aktion und Begründung des Rechenlaufs."'), 'Abbreviated status header has an understandable name');
    assert(html.includes('&lt;unsafe&gt;') && !html.includes('<unsafe>'), 'Cell data is HTML-escaped');
}

console.log('Test 7: trade cells keep plain text, sign semantics and whitelisted colors');
{
    const columns = buildBacktestColumnDefinitions('normal', {
        strategyMode: STRATEGY_OPTIONS.THREE_BUCKET_JILGE,
        goldAktiv: true
    }).filter(column => ['Handl.A', 'Handl.G', 'Handl.Bd'].includes(column.header));
    const html = buildAccessibleBacktestTableHtml([{
        netA: -120000,
        netG: 50000,
        row: {
            bondSaleAmount: 2000,
            bondRefillNet: 5000
        }
    }], columns, formatColumnValue);

    assert(html.includes('aria-label="Nettohandel Aktien: positiv = Verkauf, negativ = Kauf.'), 'Trade header explains the sign convention');
    assert(html.includes('<td class="protocol-number backtest-trade-buy">gekauft 120.000\u00a0€</td>'), 'Equity purchase renders as escaped plain text with the buy class');
    assert(html.includes('<td class="protocol-number backtest-trade-sale">verkauft 50.000\u00a0€</td>'), 'Gold sale renders as escaped plain text with the sale class');
    assert(html.includes('<td class="protocol-number backtest-trade-buy">gekauft 3.000\u00a0€</td>'), 'Bond purchase renders with the same sign convention');
    assert(!(html.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).some(cell => cell.includes('<span') || cell.includes('&lt;span')), 'Trade cells contain no formatter HTML');

    const rejectedClassHtml = buildAccessibleBacktestTableHtml(
        [{ value: 'safe' }],
        [{ header: 'Test', key: 'value', cellClass: () => 'unsafe-class' }],
        (column, row) => row[column.key]
    );
    assert(!rejectedClassHtml.includes('unsafe-class'), 'Renderer rejects non-whitelisted cell classes');
}

// Der Anzeigeadapter verwendet nur eine ausdrücklich zu diesem Aufruf gehörende Schwelle.
{
    const savedWindow = globalThis.window;
    globalThis.window = { ...savedWindow, globalScenarioCarThreshold: 10000 };
    try {
        for (const level of ['normal', 'detailed']) {
            const columns = getProtocolColumns({ source: 'backtest', logDetailLevel: level });
            const rows = [{ jahr: 2000, entscheidung: { jahresEntnahme: 900 },
                row: { jahresentnahme_real: 99, portfolio_total_end: 1000000 } }];
            assert(!buildAccessibleBacktestTableHtml(rows, columns, formatColumnValue).includes('Niedrige Entnahme'),
                'Backtest übernimmt keine fremde globale MC-Schwelle');
            for (const displayed of [columns, [...columns].reverse(), columns.filter(column => column.id !== 'withdrawal'),
                [{ header: 'Entn.', key: 'entscheidung.jahresEntnahme' }, { header: 'Vermögen', key: 'row.portfolio_total_end' }]]) {
                const html = buildAccessibleBacktestTableHtml(rows, displayed, formatColumnValue, { caRThreshold: 100 });
                const cells = [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
                const expected = displayed.findIndex(column => column.id === 'withdrawal' || column.header === 'Entn.');
                assertEqual(cells.findIndex(cell => cell.includes('Niedrige Entnahme')), expected,
                    'Backtestadapter ordnet das Kennzeichen auch bei Legacy-Spalten ausschließlich der Entnahme zu');
                assertEqual(cells.filter(cell => cell.includes('Niedrige Entnahme')).length, expected < 0 ? 0 : 1,
                    'Backtestadapter zeigt höchstens ein CaR-Kennzeichen');
            }
        }
    } finally { globalThis.window = savedWindow; }
}

console.log('Simulator Backtest UI contract tests passed');

// Vollständiges DOM und reduzierte Hosts durchlaufen dieselben Statuswechsel.
for (const shape of ['vollständig', 'ohne dataset', 'ohne optionale Hosts', 'ohne Statusregion']) {
    const doc = new MockDocument(['backtestStatus', 'backtestPeriodStatus', 'backtestResultHeading']);
    if (shape === 'ohne dataset') for (const el of doc.elements.values()) delete el.dataset;
    if (shape === 'ohne optionale Hosts') {
        doc.elements.delete('backtestPeriodStatus');
    }
    if (shape === 'ohne Statusregion') doc.elements.delete('backtestStatus');
    for (const [kind, label, live] of [['completed', 'Vollständig', 'polite'], ['ruin', 'Ruin', 'assertive'],
        ['incomplete', 'Daten unvollständig', 'assertive'], ['technical_error', 'Technischer Fehler', 'assertive'],
        ['completed', 'Vollständig', 'polite']]) {
        renderHistoricalBacktestStatus(doc, describeHistoricalBacktestResult({ outcome: { kind },
            completedYears: 1, requestedYears: 2 }));
        const region = doc.getElementById('backtestStatus');
        if (!region) { assert(true, 'Fehlende Statusregion ist optional'); continue; }
        assertEqual(region.getAttribute('data-status'), kind, `${shape}: Statusattribut folgt jedem Wechsel`);
        assertEqual(region.getAttribute('aria-live'), live, `${shape}: Fehlermeldung bleibt zugänglich`);
        assert(region.innerHTML.includes('Ursache') && region.innerHTML.includes('Nächster Schritt'), 'Einordnung bleibt vollständig');
        const chip = doc.getElementById('backtestPeriodStatus');
        if (chip) {
            assertEqual(chip.textContent, label, `${shape}: kein veralteter Chiptext`);
            assertEqual(chip.getAttribute('data-status'), kind, `${shape}: Chip ohne dataset unterstützt`);
        } else assert(region.innerHTML.includes(['completed', 'ruin'].includes(kind) ? 'Backtest ' : 'Code:'), 'Status enthält lesbares Ergebnis oder Fehlercode');
    }
}
{
    const doc = new MockDocument(['backtestStatus', 'backtestResultHeading']);
    const presentation = describeHistoricalBacktestResult({ outcome: { kind: 'completed' }, completedYears: 26, requestedYears: 26 });
    renderHistoricalBacktestStatus(doc, presentation, { focus: true });
    assertEqual(presentation.code, 'BACKTEST_COMPLETED', 'Interner Abschlusscode bleibt unverändert');
    assert(doc.getElementById('backtestStatus').hidden, 'Erfolgreicher Abschluss braucht keinen doppelten Statusblock');
    assert(doc.getElementById('backtestResultHeading').focusCalls === 1, 'Erfolgreicher Abschluss fokussiert den Kennzahlenkopf');
    assert(!doc.getElementById('backtestStatus').innerHTML.includes('BACKTEST_COMPLETED') && presentation.action.startsWith('Prüfe '), 'Abschluss zeigt persönliche Ansprache ohne technischen Abschlusscode');
}
{
    const doc = new MockDocument(['backtestResultPeriod', 'backtestResultInfoPop']);
    renderHistoricalBacktestContext(doc, { outcome: { kind: 'completed' }, warnings: [{ code: 'SYNTHETIC_WARNING' }],
        historicalYearRecords: [{ realized: { a: { qualityStatus: 'present' }, b: { qualityStatus: 'estimated' },
            c: { qualityStatus: 'missing' }, d: { qualityStatus: 'fallback_zero' } } }] });
    const html = doc.getElementById('backtestResultInfoPop').innerHTML;
    for (const text of ['gemessen: 1', 'geschätzt: 1', 'fehlend: 1', 'Ersatzwert Null: 1', 'Datenlücken', 'SYNTHETIC_WARNING'])
        assert(html.includes(text), `Warnhinweise erhalten ${text}`);
    assert(doc.getElementById('backtestResultPeriod').textContent.endsWith('· 2 Hinweise'), 'Ein Rechenhinweis und Datenlücken bleiben im Kopf sichtbar');
    renderHistoricalBacktestContext(doc, { outcome: { kind: 'completed' }, request: { startYear: 2000, endYear: 2001 },
        completedYears: 2, requestedYears: 2, warnings: [], historicalYearRecords: [
            { realized: { a: { qualityStatus: 'present' } } }, { realized: { a: { qualityStatus: 'estimated' } } }
        ] });
    assertEqual(doc.getElementById('backtestResultPeriod').textContent, '2000–2001 · 2 von 2 Jahren ausgewertet', 'Geschätzte Daten allein erzeugen keine Warnung im Kopf');
    assert(doc.getElementById('backtestResultInfoPop').innerHTML.includes('1 Jahr nur mit gemessenen Werten, 1 Jahr mit geschätzten Werten'), 'Info zählt Jahre statt Beobachtungen als Jahre auszugeben');

}

{
    const rows = [36, 0, null, undefined].map((months, index) => ({ jahr: 2000 + index, entscheidung: { jahresEntnahme: 1234.56 },
        runway_after_transaction_before_payout_months: 120,
        row: { runway_after_transaction_before_payout_months: months, RunwayCoveragePct: 999,
            RunwayTargetSmoothedMonths: 240, Regime: index === 3 ? 'BANKRUPT' : 'recovery',
            flex_haushalt_kuerzung_pct: index === 0 ? 20 : 0, minimumFlexAnnual: 123.45,
            aktionUndGrund: index === 3 ? '!!! RUIN !!!' : 'Reinvest' } }));
    const before = JSON.stringify(rows);
    const options = { strategyMode: STRATEGY_OPTIONS.THREE_BUCKET_JILGE, goldAktiv: true };
    const normal = buildBacktestColumnDefinitions('normal', { ...options, display: true });
    const detailed = buildBacktestColumnDefinitions('detailed', { ...options, display: true });
    const raw = buildBacktestColumnDefinitions('detailed', options);
    assertEqual(normal.map(col => col.header).join(','),
        'Jahr,Entnahme,Renten,Liquidität reicht,Marktphase,Aktienrendite,Inflation,Handlung,Aktienhandel,Goldhandel,Bondhandel,Aktien/ETF,Gold,Bonds/Puffer,Liquidität,Vermögen',
        'Normalansicht enthält volle Namen und die strategisch anwendbaren Bestände');
    const runway = normal.find(col => col.header === 'Liquidität reicht');
    for (const [index, expected] of ['3\u00a0Jahre', '0\u00a0Jahre', '', ''].entries())
        assertEqual(formatColumnValue(runway, rows[index]), expected, 'Nur Monate vor Entnahme bestimmen Runway, Null und Fehlwerte bleiben verschieden');
    assertEqual(formatColumnValue(runway, { runway_after_transaction_before_payout_months: 36 }), '3\u00a0Jahre',
        'Kanonischer Monatswert wird auch ohne row-Adapter dargestellt');
    for (const header of ['MinFlex€', 'Runway%', 'RunZiel', 'Handl.Bd', 'MinFIst€', 'MinFGap€', 'GuardNote'])
        assert(detailed.some(col => col.legacyHeader === header), `Erhaltener Detailwert ${header}`);
    for (const header of ['MinFBlock', 'HBDeck%', 'HBWarn', 'FlowΔ'])
        assert(!detailed.some(col => col.legacyHeader === header), `Exportexklusiv oder nicht im Backtest: ${header}`);
    const rawBefore = rows.map(row => raw.map(col => formatColumnValue(col, row)));
    const { captureHistoricalBacktestEngineProvenance, serializeHistoricalBacktestJson,
        serializeHistoricalBacktestCsv } = await import('../app/simulator/historical-backtest-export.js');
    const { EngineAPI } = await import('../engine/index.mjs');
    const exportResult = { schemaVersion: 'BacktestRunResultV1', outcome: { kind: 'completed' }, rows,
        request: { startYear: 2000, endYear: 2003, inputs: {}, engine: captureHistoricalBacktestEngineProvenance(EngineAPI, {
            schemaVersion: 'RuntimeBuildProvenanceV1', sourceCommit: 'a'.repeat(40), sourceTreeStatus: 'clean', provider: 'synthetic_fixture'
        }) }, metrics: { values: {} } };
    const exportOptions = { exportedAt: '2026-01-01T00:00:00.000Z' };
    const jsonBefore = serializeHistoricalBacktestJson(exportResult, exportOptions);
    const csvBefore = serializeHistoricalBacktestCsv(exportResult, exportOptions);
    const html = buildAccessibleBacktestTableHtml(rows, normal, formatColumnValue);
    assert(html.includes('backtest-row-cut') && html.includes('backtest-row-ruin') && html.includes('>Ruin</td>'),
        'Kürzung und Ruin besitzen Wortstatus und getrennte Zeilenklassen');
    assert(html.includes('Wiederanlage') && !html.includes('>Reinvest</td>'), 'Handlungen werden nur redaktionell übersetzt');
    assertEqual(formatColumnValue(normal.find(col => col.header === 'Entnahme'), rows[0]), '1.235\u00a0€',
        'Sichtbare Entnahme wird als ganze Euro aus Rohwert formatiert');
    buildAccessibleBacktestTableHtml(rows, detailed, formatColumnValue);
    assertEqual(JSON.stringify(rows), before, 'Normal- und Detailrenderer verändern keine Rohdaten');
    assertEqual(JSON.stringify(rows.map(row => raw.map(col => formatColumnValue(col, row)))), JSON.stringify(rawBefore),
        'Nichtdisplayprojektion bleibt nach beiden Renderern unverändert');
    assertEqual(serializeHistoricalBacktestJson(exportResult, exportOptions), jsonBefore,
        'Raw-JSON bleibt für dieselben synthetischen Monats-/Geld-/Diagnosedaten bytegleich');
    assertEqual(serializeHistoricalBacktestCsv(exportResult, exportOptions), csvBefore,
        'Raw-CSV bleibt für dieselben synthetischen Monats-/Geld-/Diagnosedaten bytegleich');
}

console.log('Test 9: reale Provenienzvorbereitung ist abwartbar kündigbar');
{
    const saved = { document: global.document, window: global.window, localStorage: global.localStorage };
    const ids = ['btButton', 'liquidityRunwayYears', 'simulationSummary', 'simulationLog',
        'simulationResults', 'exportBacktestJson', 'exportBacktestCsv'];
    const doc = new MockDocument(ids);
    for (const element of doc.elements.values()) element.style = {};
    const ageField = new MockElement('p1StartAlter'); ageField.value = '67'; doc.elements.set('p1StartAlter', ageField);
    for (const id of ['simStartJahr', 'simEndJahr']) {
        const field = new MockElement(id); field.value = '2000'; doc.elements.set(id, field);
    }
    doc.getElementById('liquidityRunwayYears').value = '5';
    const nativeListeners = new Map();
    global.document = doc; global.window = {
        addEventListener: (type, handler) => nativeListeners.set(type, handler),
        removeEventListener: type => nativeListeners.delete(type)
    }; global.localStorage = { getItem: () => null };
    try {
        const { initializeBacktestUI, runBacktest, runBacktestWithRuntimeProvenance, cancelBacktestPreparation, exportBacktestLogData } = await import('../app/simulator/simulator-backtest.js');
        const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
        const guard = getPageNavigationGuard(doc);
        initializeBacktestUI();
        assert(guard.reasons().length === 0 && !nativeListeners.has('beforeunload'),
            'Reale Backtestinitialisierung installiert keinen nachfragenden nativen Handler');
        doc.getElementById('simStartJahr').value = '';
        assert(runBacktest() === null && guard.reasons().length === 0 && !nativeListeners.has('beforeunload'),
            'Ungültiger Erstlauf erzeugt nach Handlerende keinen Ergebnisverlust');
        doc.getElementById('simStartJahr').value = '2000';
        assert(runBacktest({ runSinglePath: () => { throw new Error('SYNTHETIC_FIRST_RUN_FAILURE'); } }) === null
            && guard.reasons().length === 0 && !nativeListeners.has('beforeunload'),
            'Technisch gescheiterter Erstlauf hinterlässt keine Nachfrage');
        const incomplete = { outcome: { kind: 'incomplete' }, rows: [], requestedYears: 1, completedYears: 0 };
        assert(runBacktest({ runSinglePath: () => incomplete }) === incomplete
            && guard.reasons().length === 0 && !nativeListeners.has('beforeunload'),
            'Unvollständiger Erstlauf wird nicht als verlierbares Backtestergebnis geführt');
        let releaseFirst;
        const firstLoader = new Promise(resolve => { releaseFirst = resolve; });
        const firstPreparation = runBacktestWithRuntimeProvenance({ loadRuntimeBuildProvenance: () => firstLoader,
            runSinglePath: () => { throw new Error('CANCELLED_FIRST_RUN_MUST_NOT_START'); } });
        await Promise.resolve();
        const firstCancel = cancelBacktestPreparation();
        releaseFirst(null);
        await firstCancel;
        assert(await firstPreparation === null && guard.reasons().length === 0 && !nativeListeners.has('beforeunload'),
            'Abgebrochene Erstvorbereitung erhält nach Cleanup den sauberen Zustand');
        const oldResult = Object.freeze({ schemaVersion: 'BacktestRunResultV1', outcome: { kind: 'completed' },
            request: { startYear: 2000, endYear: 2000 }, rows: [], requestedYears: 1, completedYears: 1 });
        let calculations = 0;
        const dependencies = { runSinglePath: () => { calculations++; return oldResult; } };
        setEuroMode('real', doc);
        const result = runBacktest(dependencies);
        assertEqual(getEuroMode(doc), 'nominal', 'Neuer Backtest setzt die gemeinsame Wahl auf Nominal zurück');
        assert(result === oldResult && window.globalBacktestData.result === oldResult,
            'Synchroner Backtest behält die unveränderte Runnerinstanz');
        assert(guard.reasons().some(reason => reason.result), 'Erfolgreicher synchroner Backtest registriert Ergebnisverlust');
        assert(nativeListeners.has('beforeunload'), 'Tatsächliches Backtestergebnis aktiviert nativen Verlustschutz');
        exportBacktestLogData('json');
        assert(guard.reasons().some(reason => reason.result), 'Downloadversuch quittiert kein Backtestergebnis');
        assert(nativeListeners.has('beforeunload'), 'Exportversuch entfernt den nativen Ergebnisschutz nicht');
        const previous = window.globalBacktestData;
        for (const rejectLoader of [false, true]) {
            let release, reject, ended = false;
            const loaderPromise = new Promise((resolve, fail) => { release = resolve; reject = fail; });
            const options = { ...dependencies, automatic: true, loadRuntimeBuildProvenance: () => loaderPromise };
            const pending = runBacktestWithRuntimeProvenance(options);
            assert(runBacktestWithRuntimeProvenance(options) === pending, 'Vorbereitung ist Singleflight');
            await Promise.resolve();
            assert(await guard.prepare({ decide: async () => false }) === null,
                'Bleiben lässt Provenienzvorbereitung und alten Backtest bestehen');
            assert(guard.reasons().some(reason => reason.phase === 'preparing' && reason.result),
                'Vorbereitung und Ergebnis erscheinen gemeinsam als Verlustgründe');
            const attemptPromise = guard.prepare({ decide: async () => true }).then(attempt => { ended = true; return attempt; });
            for (let turn = 0; turn < 12; turn++) await Promise.resolve();
            assert(!ended && guard.reasons().some(reason => reason.phase === 'cancelling'),
                'Wechselzustimmung wartet auf den noch offenen Loader');
            assert(runBacktest(dependencies) === null, 'Direkter synchroner Start umgeht laufende Kündigung nicht');
            const cancel = cancelBacktestPreparation();
            assert(cancelBacktestPreparation() === cancel, 'Wiederholte Backtestkündigung teilt ihr Ende');
            if (rejectLoader) reject(new Error('Verspäteter Loaderfehler')); else release({});
            const attempt = await attemptPromise;
            await cancel;
            assert(attempt && await pending === null && calculations === 1,
                'Loaderantwort und Loaderfehler nach Kündigung starten keine Rechnung');
            assert(window.globalBacktestData === previous && !doc.getElementById('btButton').disabled,
                'Kündigung erhält Altresultat und gibt Startknopf erst nach Cleanup frei');
            guard.end(attempt);
            assert(guard.reasons().some(reason => reason.owner === 'simulator-backtest' && reason.result),
                'Abgebrochene automatische Vorbereitung erhält Herkunft des expliziten Altresultats');
        }
        const restart = await runBacktestWithRuntimeProvenance({ ...dependencies, loadRuntimeBuildProvenance: async () => null });
        assert(restart === oldResult && calculations === 2, 'Nach Kündigung ist ein neuer Backtest möglich');
        const fallback = await runBacktestWithRuntimeProvenance({ ...dependencies, loadRuntimeBuildProvenance: async () => { throw new Error('Normaler Loaderfehler'); } });
        assert(fallback === oldResult && calculations === 3, 'Loaderfehler ohne Kündigung behält bisherigen Rechenpfad');
        const { EngineAPI } = await import('../engine/index.mjs');
        let releaseFrame, recovery = false;
        const frame = new Promise(resolve => { releaseFrame = resolve; });
        const automatic = runBacktestWithRuntimeProvenance({ ...dependencies, automatic: true,
            engineApi: EngineAPI, focus: false,
            isBlocked: () => recovery, beforeRun: () => frame, loadRuntimeBuildProvenance: async () => null });
        for (let i = 0; i < 6; i++) await Promise.resolve();
        assertEqual(calculations, 3, 'Realer automatischer Backtest wartet den gezeichneten Frame vor dem synchronen Runner ab');
        recovery = true; releaseFrame();
        assert(await automatic === null && calculations === 3, 'Recovery während Frame verhindert den automatischen Runner');
        recovery = false;
        assert(await runBacktestWithRuntimeProvenance({ ...dependencies, automatic: true, engineApi: {},
            beforeRun: async () => {}, loadRuntimeBuildProvenance: async () => null }) === null && calculations === 3,
        'Fehlende Engine nach Vorbereitung verhindert den automatischen Runner');
        const automaticResult = await runBacktestWithRuntimeProvenance({ ...dependencies, automatic: true, engineApi: EngineAPI,
            focus: false, beforeRun: async () => {}, loadRuntimeBuildProvenance: async () => null });
        assert(automaticResult === oldResult && calculations === 4,
            'Automatischer Adapter führt den Einzelpfad aus');
        for (const opening of [true, false]) for (const kind of ['completed', 'ruin']) {
            const expected = Object.freeze({ ...oldResult, outcome: { kind } });
            let published = null;
            const actual = await runBacktestWithRuntimeProvenance({ ...dependencies, automatic: true, opening,
                engineApi: EngineAPI, loadRuntimeBuildProvenance: async () => null,
                runSinglePath: () => {
                    assert(guard.reasons().some(reason => reason.phase === 'running'), 'Automatische Rechnung bleibt abbrechgeschützt');
                    return expected;
                }, beginSimulationSummary: () => ({}), completeSimulationSummary: (_context, result) => { published = result; } });
            assert(actual === expected && window.globalBacktestData.result === expected && published === expected,
                'Automatisches Ergebnis bleibt für Anzeige, Export und Übersichtpublikation verfügbar');
            assert(doc.getElementById('simulationResults').style.display === 'contents'
                && !doc.getElementById('exportBacktestJson').disabled && !doc.getElementById('exportBacktestCsv').disabled,
                'Automatisches Ergebnis hält Anzeige und Export bedienbar');
            assert(!guard.reasons().some(reason => reason.owner === 'simulator-backtest' && reason.result),
                `Automatisches ${opening ? 'Eröffnungs-' : 'Annahmen-'}Ergebnis ${kind} meldet keinen Ergebnisverlust`);
            assert(!nativeListeners.has('beforeunload'), 'Allein automatisches Ergebnis aktiviert keinen nativen Verlustschutz');
            const attempt = await guard.prepare({ decide: () => { throw new Error('AUTOMATIC_RESULT_MUST_NOT_PROMPT'); } });
            assert(attempt, 'Saubere Navigation nach automatischem Ergebnis benötigt keine Entscheidung'); guard.end(attempt);
        }
        const dirty = guard.register('synthetic-input', { read: () => ({ dirty: true }) });
        assert(await guard.prepare({ decide: async () => false }) === null && nativeListeners.has('beforeunload'),
            'Unübernommene Eingaben bleiben auch neben automatischem Ergebnis geschützt');
        dirty.unregister();
        runBacktest({ ...dependencies });
        assert(guard.reasons().some(reason => reason.result) && nativeListeners.has('beforeunload'),
            'Explizites Folgeergebnis erhält seine eigene geschützte Herkunft');


        // R-01: derselbe Renderfehler wird auch vor dem async try/finally ausgelöst.
        const originalWarn = console.warn;
        const renderWarnings = [];
        const isolatedDependencies = { ...dependencies };
        doc.elements.set('overviewBacktest', new MockElement('overviewBacktest'));
        doc.elements.set('backtestStatus', new MockElement('backtestStatus'));
        doc.createElement = () => { throw new Error('SYNTHETIC_OVERVIEW_RENDER_FAILURE'); };
        console.warn = (...args) => renderWarnings.push(args);
        try {
            assert(runBacktest(isolatedDependencies) === oldResult && !doc.getElementById('btButton').disabled,
                'Backtest: Renderausnahme lässt synchronen Runner samt Cleanup abschließen');
            let release;
            const provenance = new Promise(resolve => { release = resolve; });
            const warningsBefore = renderWarnings.length;
            const pending = runBacktestWithRuntimeProvenance({ ...isolatedDependencies,
                loadRuntimeBuildProvenance: () => provenance });
            await Promise.resolve();
            assert(doc.getElementById('btButton').disabled && guard.reasons().some(reason => reason.phase === 'preparing'),
                'Backtest: Renderausnahme bei Vorbereitung erhält den laufenden Start- und Navigationsschutz');
            release(null);
            assert(await pending === oldResult && !doc.getElementById('btButton').disabled,
                'Backtest: Renderausnahmen bei Vorbereitung, Start und Abschluss lassen Provenienzlauf abschließen');
            await Promise.resolve();
            assert(!guard.isBusy() && guard.reasons().every(reason => reason.phase === 'idle'),
                'Backtest: Renderausnahmen beenden Lauf-Navigationsschutz und behalten nur Ergebnisverlust');
            assert(renderWarnings.length >= warningsBefore + 4 && renderWarnings.every(
                args => args[1]?.message === 'SYNTHETIC_OVERVIEW_RENDER_FAILURE'),
                'Backtest: Regression löst die echte DOM-Ausnahme in allen erfolgreichen Laufphasen aus');
            const failed = await runBacktestWithRuntimeProvenance({ ...isolatedDependencies, loadRuntimeBuildProvenance: async () => null,
                runSinglePath: () => { throw new Error('SYNTHETIC_BACKTEST_FAILURE'); } });
            assert(failed === null && doc.getElementById('backtestStatus').innerHTML.includes('BACKTEST_UI_EXCEPTION'),
                'Backtest: Renderausnahme in failOverviewRun erhält den bestehenden technischen UI-Fehlerpfad');
            assert(!doc.getElementById('btButton').disabled && !guard.isBusy()
                && guard.reasons().every(reason => reason.phase === 'idle'),
            'Backtest: Rechenfehler und Renderfehler geben Start- und Lauf-Navigationsschutz frei');
            assert(await runBacktestWithRuntimeProvenance({ ...isolatedDependencies,
                loadRuntimeBuildProvenance: async () => null }) === oldResult,
            'Backtest: Nach Render- und Rechenfehler bleibt der async Neustart möglich');
        } finally {
            console.warn = originalWarn;
            delete doc.createElement;
            doc.elements.delete('overviewBacktest');
            doc.elements.delete('backtestStatus');
        }
    } finally { Object.assign(global, saved); }
}

{
    const { projectBacktestOverview } = await import('../app/simulator/simulator-result-overview.js');
    const result = { request: { startYear: 2000, endYear: 2000 }, outcome: { kind: 'completed' }, portfolioStart: 150,
        rows: [{ jahr: 2000, wertAktien: 60, wertGold: 10, liquiditaet: 10, row: { health_bucket_start: 50, health_bucket_end: 70,
            bondBucketAfter: 20, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 0 } }],
        metrics: { values: { wealth_end_nominal_eur: 150, withdrawal_total_nominal_eur: 12, flex_reduction_years_gte_10_pct: 0, tax_total_nominal_eur: 2 } } };
    const projection = projectBacktestOverview(result);
    assert(projection.result === result, 'Karte, Chart und Krise teilen dieselbe kanonische Resultatinstanz');
    assertEqual(projection.endWealth, 150, 'Ergebnisendvermögen enthält die Pflegereserve');
    assertEqual(projection.crises[0].minimum.total, 80, 'Chart-/Krisenstand schließt die Pflegereserve aus');
    assert(Math.abs(projection.crises[0].changePct + 20) < 1e-10, 'Krisenreferenz zieht kanonischen Reservestart vom Startvermögen ab');
    assertEqual(projection.cuts, 0, 'Null Kürzungsjahre bleibt ein gültiger Wert');
}

// A1: Automatischer Öffnungslauf ohne Verlustdialog; explizites Folgeergebnis → Dialog → Handoff.
// Der zuvor wartende Flush ist vor der Verlustbestätigung unerreichbar.
{
    const saved = { document: global.document, window: global.window, localStorage: global.localStorage };
    const doc = new MockDocument(['p1StartAlter', 'simStartJahr', 'simEndJahr', 'liquidityRunwayYears', 'simulationSummary',
        'simulationLog', 'simulationResults', 'backtestResultPeriod', 'backtestStatus', 'backtestPeriodStatus',
        'backtestResultHeading', 'navigationGuardDialog', 'navigationGuardTitle', 'navigationGuardDescription',
        'navigationGuardStay', 'navigationGuardLeave']);
    for (const el of doc.elements.values()) el.style = {};
    doc.getElementById('p1StartAlter').value = '67';
    doc.getElementById('simStartJahr').value = '2000'; doc.getElementById('simEndJahr').value = '2000';
    doc.getElementById('liquidityRunwayYears').value = '5';
    const listeners = new Map();
    doc.addEventListener = (type, fn) => listeners.set(type, fn);
    doc.removeEventListener = type => listeners.delete(type);
    doc.activeElement = null;
    const dialog = doc.getElementById('navigationGuardDialog');
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
    const steps = [];
    let href = 'Simulator.html', releaseFlush;
    const flushed = new Promise(resolve => { releaseFlush = resolve; });
    global.document = doc;
    global.window = { addEventListener() {}, removeEventListener() {}, name: '', location: {
        get href() { return href; }, set href(value) { steps.push('navigate'); href = value; }
    } };
    global.localStorage = { getItem: () => null };
    try {
        const { startAutomaticBacktest } = await import('../app/simulator/simulator-auto-backtest.js');
        const { runBacktestWithRuntimeProvenance } = await import('../app/simulator/simulator-backtest.js');
        const { bindProfileNavigationHandoff } = await import('../app/profile/profile-navigation.js');
        const { EngineAPI } = await import('../engine/index.mjs');
        const { getPageNavigationGuard } = await import('../app/shared/navigation-guard-dialog.js');
        const result = { schemaVersion: 'BacktestRunResultV1', request: { startYear: 2000, endYear: 2002 },
            outcome: { kind: 'completed' }, requestedYears: 3, completedYears: 3, rows: [],
            metrics: { values: { wealth_start_nominal_eur: 1234.56, wealth_end_nominal_eur: 2345.67,
                withdrawal_total_nominal_eur: 0, flex_reduction_longest_streak_gte_10_pct: 0,
                flex_reduction_years_gte_10_pct: 0, tax_total_nominal_eur: null, health_bucket_end_nominal_eur: 0 } },
            summary: { healthBucket: { enabled: false, realCoveragePct: 0, targetGap: null } } };
        const before = JSON.stringify(result);
        const opened = await startAutomaticBacktest(doc, {
            persistenceReady: async () => {}, profileReady: async () => {}, initializationReady: async () => {},
            isBlocked: () => false, engineReady: () => true,
            provider: () => ({ bounds: { startYear: 1999, endYear: 2000 }, preparePeriod: () => ({ status: 'complete' }) }),
            currentYear: () => 2001, validate() {}, setPeriod() {}, status() {}, frame: async () => {},
            run: options => runBacktestWithRuntimeProvenance({ ...options, engineApi: EngineAPI,
                loadRuntimeBuildProvenance: async () => null, runSinglePath: () => result })
        });
        assert(opened === result, 'Echter automatischer Öffnungslauf publiziert dieselbe synthetische Resultatinstanz');
        const summary = doc.getElementById('simulationSummary').innerHTML;
        for (const [field, value] of [['period_start', 2000], ['period_end', 2002], ['requested_years', 3],
            ['completed_years', 3], ['row_count', 0], ['health_bucket_coverage_pct', 0], ['health_bucket_target_gap', '']])
            assert(summary.includes(`data-result-field="${field}" data-canonical-value="${value}"`), `Einzelanker ${field} bleibt erhalten`);
        for (const [id, value] of Object.entries(result.metrics.values))
            assert(summary.includes(`data-metric-id="${id}" data-canonical-value="${value ?? ''}"`), `Kanonischer Kennzahlanker ${id}`);
        assert(!/<(?:span|div)\b[^>]*\baria-label=/.test(summary),
            'Rollenlose Summaryelemente verwenden keine verbotene ARIA-Benennung');
        for (const [id, visible, exact] of [
            ['wealth_start_nominal_eur', '1.235\u00a0€', '1.234,56\u00a0€'],
            ['wealth_end_nominal_eur', '2.346\u00a0€', '2.345,67\u00a0€'],
            ['withdrawal_total_nominal_eur', '0\u00a0€', '0,00\u00a0€'],
            ['health_bucket_end_nominal_eur', '0\u00a0€', '0,00\u00a0€'],
            ['tax_total_nominal_eur', '—', null],
            ['flex_reduction_longest_streak_gte_10_pct', '0 Jahre', null],
            ['flex_reduction_years_gte_10_pct', '0 von 3', null]
        ]) {
            const card = summary.match(new RegExp(`data-metric-id="${id}"[^>]*><strong>[^<]+</strong>([\\s\\S]*?)</div>`));
            assert(card !== null, `Echter Summaryrenderer liefert die Kennzahl ${id}`);
            const primaryMarkup = card[1].replace(/<small class="sim-other-basis">[^<]*<\/small>/, '');
            assertEqual(primaryMarkup, exact === null ? `<span>${visible}</span>`
                : `<span aria-hidden="true">${visible}</span><span class="ds-visually-hidden">${exact}</span>`,
            `Kennzahl ${id}: nur präziser Geldtext ist assistiv lesbar; Fehlwerte und Nichtgeldwerte bleiben lesbar`);
        }
        assertEqual(doc.getElementById('backtestResultPeriod').textContent, '2000–2002 · 3 von 3 Jahren ausgewertet',
            'Kopfzeitraum verwendet Resultatdaten statt der aktuellen Eingabefelder');
        assertEqual(JSON.stringify(result), before, 'Summary und Öffnungsadapter verändern keine kanonischen Werte');
        const guard = getPageNavigationGuard(doc);
        assert(!guard.reasons().some(reason => reason.result),
            'Echter Öffnungslauf benötigt keinen Ergebnisverlustdialog');
        const cleanAttempt = await guard.prepare();
        assert(cleanAttempt && !dialog.open, 'Echter Guard öffnet nach automatischem Start keinen Verlustdialog');
        guard.end(cleanAttempt);
        await runBacktestWithRuntimeProvenance({ engineApi: EngineAPI, loadRuntimeBuildProvenance: async () => null,
            runSinglePath: () => result });
        assert(guard.reasons().some(reason => reason.result), 'Explizites Folgeergebnis ist vor Handoff geschützt');
        const link = { isConnected: true, dataset: {}, closest: () => link,
            hasAttribute: name => name === 'data-profile-handoff',
            getAttribute: name => name === 'href' ? 'Handbuch.html' : null };
        doc.contains = node => node === link;
        bindProfileNavigationHandoff({ root: doc, win: window, guard, ready: () => true,
            exporter: () => { steps.push('export'); }, flusher: async () => { steps.push('flush'); await flushed; steps.push('flush-confirmed'); } });
        const changing = listeners.get('click')({ target: link, button: 0, preventDefault() {} });
        for (let i = 0; i < 12; i++) await Promise.resolve();
        assert(dialog.open && steps.length === 0 && href === 'Simulator.html',
            'Ohne Dialogzustimmung bleibt die alte Flushwartebedingung gesperrt');
        assert(doc.getElementById('navigationGuardDescription').textContent.includes('Backtest: Ergebnis geht verloren'),
            'Der ausstehende Zustand ist die Ergebnisverlustentscheidung, kein Bootstrapfehler');
        doc.getElementById('navigationGuardLeave').listeners.get('click')();
        for (let i = 0; i < 12; i++) await Promise.resolve();
        assertEqual(steps.join(','), 'export,flush', 'Erst nach echter Zustimmung Export vor Flush');
        assertEqual(href, 'Simulator.html', 'Offener Flush erhält das Quelldokument');
        await listeners.get('click')({ target: link, button: 0, preventDefault() {} });
        assertEqual(steps.join(','), 'export,flush', 'Zweiter Klick erzeugt keine zweite Übergabe');
        releaseFlush(); await changing;
        assertEqual(steps.join(','), 'export,flush,flush-confirmed,navigate', 'Bestätigter Flush vor genau einem Wechsel');
        assertEqual(href, 'Handbuch.html', 'Bestätigte Übergabe erreicht das echte Ziel');
    } finally { Object.assign(global, saved); }
}
