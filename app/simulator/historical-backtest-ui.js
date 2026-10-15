import { PROTOCOL_COLUMNS, protocolRowFlags, readProtocolValue, formatProtocolValue } from './protocol-columns.js';
import { renderProtocolTable } from './protocol-renderer.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
"use strict";

const PERIOD_FIELDS = Object.freeze({
    simStartJahr: 'simStartJahrError',
    simEndJahr: 'simEndJahrError'
});

const OUTCOME_LABELS = Object.freeze({
    completed: 'vollständig abgeschlossen',
    ruin: 'wirtschaftlicher Ruin',
    incomplete: 'unvollständige historische Daten',
    technical_error: 'technischer Fehler'
});

const infoBindings = new WeakSet();

export function backtestRowState(entry) {
    const flags = protocolRowFlags(entry, 'backtest');
    return flags.ruin ? 'ruin' : flags.cut ? 'cut' : 'normal';
}

function finiteInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
}

function stableCode(value, fallback) {
    const code = String(value || '').trim();
    return /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? code : fallback;
}

function focusElement(element) {
    if (typeof element?.focus !== 'function') return;
    try {
        element.focus({ preventScroll: false });
    } catch {
        element.focus();
    }
}

function setAttribute(element, name, value) {
    if (typeof element?.setAttribute === 'function') element.setAttribute(name, value);
    else if (element) element[name] = value;
}

function removeAttribute(element, name) {
    if (typeof element?.removeAttribute === 'function') element.removeAttribute(name);
    else if (element) delete element[name];
}

function validateIntegerInput(rawValue, { label, min, max }) {
    const raw = String(rawValue ?? '').trim();
    if (raw === '') return { value: null, error: `${label} ist erforderlich.` };
    const value = Number(raw);
    if (!Number.isFinite(value)) return { value: null, error: `${label} muss eine endliche Zahl sein.` };
    if (!Number.isInteger(value)) return { value: null, error: `${label} muss eine ganze Jahreszahl sein.` };
    if (value < min || value > max) {
        return { value: null, error: `${label} muss zwischen ${min} und ${max} liegen.` };
    }
    return { value, error: null };
}

export function escapeBacktestHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function configureHistoricalBacktestControls(documentRef, provider) {
    const bounds = provider?.bounds || {};
    const min = finiteInteger(bounds.startYear);
    const max = finiteInteger(bounds.endYear);
    if (min === null || max === null || min > max) {
        throw new TypeError('Historical backtest UI requires valid provider bounds');
    }

    for (const id of ['simStartJahr', 'simEndJahr']) {
        const input = documentRef?.getElementById(id);
        if (!input) continue;
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
    }

    const hint = documentRef?.getElementById('backtestDatasetHint');
    if (hint) hint.textContent = `Daten ${min}–${max}`;
    const details = documentRef?.getElementById('backtestDatasetInfoPop');
    if (details) {
        const datasetId = String(provider?.datasetId || 'historischer Datensatz');
        const revision = String(provider?.revision || 'unbekannt');
        const lookback = finiteInteger(bounds.lookbackYears);
        details.textContent = `Datensatz ${datasetId}, Revision ${revision}. Simulationszeitraum: ${min}–${max}, einschließlich Start- und Endjahr.`
            + (lookback && lookback > 0 ? ` ${lookback} Vorjahre für die Startentscheidung (Lookback) sind im Datenvertrag berücksichtigt.` : '');
    }
    const host = documentRef?.getElementById('tab-backtesting');
    if (host?.querySelectorAll && documentRef.addEventListener && !infoBindings.has(documentRef)) {
        infoBindings.add(documentRef);
        bindInfoPopovers({
            querySelectorAll: selector => host.querySelectorAll(selector),
            addEventListener: (...args) => documentRef.addEventListener(...args),
            get activeElement() { return documentRef.activeElement; }
        });
    }

    return Object.freeze({ startYear: min, endYear: max });
}

export function validateHistoricalBacktestPeriod({
    startRaw,
    endRaw,
    bounds
}) {
    const min = finiteInteger(bounds?.startYear);
    const max = finiteInteger(bounds?.endYear);
    if (min === null || max === null || min > max) {
        throw new TypeError('Historical backtest period validation requires valid bounds');
    }

    const start = validateIntegerInput(startRaw, { label: 'Startjahr', min, max });
    const end = validateIntegerInput(endRaw, { label: 'Endjahr', min, max });
    const errors = {};
    if (start.error) errors.simStartJahr = start.error;
    if (end.error) errors.simEndJahr = end.error;
    if (!start.error && !end.error && start.value > end.value) {
        errors.simEndJahr = 'Endjahr darf nicht vor dem Startjahr liegen.';
    }

    const firstErrorFieldId = Object.keys(PERIOD_FIELDS).find(id => errors[id]) || null;
    return Object.freeze({
        valid: firstErrorFieldId === null,
        startYear: start.value,
        endYear: end.value,
        errors: Object.freeze({ ...errors }),
        firstErrorFieldId
    });
}

export function renderHistoricalBacktestValidation(documentRef, validation, { focus = true } = {}) {
    for (const [fieldId, errorId] of Object.entries(PERIOD_FIELDS)) {
        const field = documentRef?.getElementById(fieldId);
        const errorElement = documentRef?.getElementById(errorId);
        const message = validation?.errors?.[fieldId] || '';
        if (field) {
            if (message) setAttribute(field, 'aria-invalid', 'true');
            else removeAttribute(field, 'aria-invalid');
        }
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.hidden = !message;
        }
    }
    if (focus && validation?.firstErrorFieldId) {
        focusElement(documentRef?.getElementById(validation.firstErrorFieldId));
    }
}

export function focusBacktestElement(documentRef, id) {
    focusElement(documentRef?.getElementById(id));
}

export function describeHistoricalBacktestResult(result) {
    const outcome = result?.outcome?.kind;
    if (outcome === 'completed') {
        return Object.freeze({
            kind: outcome,
            code: 'BACKTEST_COMPLETED',
            title: 'Backtest fertig',
            cause: `${result.completedYears ?? 0} von ${result.requestedYears ?? 0} angeforderten Jahren wurden wirtschaftlich ausgewertet.`,
            action: 'Prüfe Kennzahlen, Warnhinweise, Jahresprotokoll und Rohdatenexport gemeinsam.'
        });
    }
    if (outcome === 'ruin') {
        const ruinYear = finiteInteger(result?.ruinYear ?? result?.outcome?.ruinYear);
        return Object.freeze({
            kind: outcome,
            code: 'BACKTEST_RUIN',
            title: 'Backtest mit wirtschaftlichem Ruin beendet',
            cause: ruinYear === null
                ? 'Der vereinbarte Floor konnte in mindestens einem Simulationsjahr nicht vollständig gedeckt werden.'
                : `Der vereinbarte Floor konnte im Jahr ${ruinYear} nicht vollständig gedeckt werden.`,
            action: 'Prüfe Entnahmebedarf, Vermögensaufteilung und das Ruin-Jahr im Jahresprotokoll.'
        });
    }
    if (outcome === 'incomplete') {
        const code = stableCode(result?.incompleteReason?.code, 'BACKTEST_DATA_INCOMPLETE');
        return Object.freeze({
            kind: outcome,
            code,
            title: 'Backtest wegen unvollständiger Daten nicht ausgewertet',
            cause: 'Der historische Datenvertrag konnte den gewählten Zeitraum nicht lückenlos bereitstellen.',
            action: 'Wähle einen Zeitraum innerhalb der angezeigten Grenzen oder prüfe den Datensatz.'
        });
    }
    const code = stableCode(result?.error?.code ?? result?.outcome?.error?.code, 'BACKTEST_TECHNICAL_ERROR');
    return Object.freeze({
        kind: 'technical_error',
        code,
        title: 'Backtest technisch abgebrochen',
        cause: 'Der Lauf konnte technisch nicht vollständig verarbeitet werden.',
        action: 'Prüfe die Eingaben und starte den Backtest erneut. Bleibt der Code bestehen, melde ihn zur Diagnose.'
    });
}

export function renderHistoricalBacktestStatus(documentRef, presentation, { focus = false } = {}) {
    const region = documentRef?.getElementById('backtestStatus');
    if (!region || !presentation) return;
    const kind = String(presentation.kind || 'technical_error');
    setAttribute(region, 'data-status', kind);
    if (region.dataset) region.dataset.status = kind;
    region.className = `backtest-status ds-note backtest-status-${escapeBacktestHtml(kind)}`;
    setAttribute(region, 'aria-live', ['validation_error', 'technical_error', 'incomplete', 'ruin'].includes(kind) ? 'assertive' : 'polite');
    region.hidden = ['completed', 'idle'].includes(kind);
    region.innerHTML = `<div class="backtest-notice-row"><span>Ergebnis</span><span class="backtest-notice-value">${escapeBacktestHtml(presentation.title)}</span></div>`
        + `<div class="backtest-notice-row"><span>Ursache</span><span class="backtest-notice-value">${escapeBacktestHtml(presentation.cause)}</span></div>`
        + `<div class="backtest-notice-row"><span>Nächster Schritt</span><span class="backtest-notice-value">${escapeBacktestHtml(presentation.action)}</span></div>`;
    if (['validation_error', 'technical_error', 'incomplete'].includes(kind)) {
        region.innerHTML += `<span class="backtest-status-code">Code: ${escapeBacktestHtml(presentation.code)}</span>`;
    }
    const chip = documentRef?.getElementById('backtestPeriodStatus');
    if (chip) {
        chip.textContent = ({ idle: 'Bereit', running: 'Wird berechnet', completed: 'Vollständig', ruin: 'Ruin',
            incomplete: 'Daten unvollständig', technical_error: 'Technischer Fehler', validation_error: 'Eingaben prüfen' })[kind] || presentation.title;
        setAttribute(chip, 'data-status', kind);
        if (chip.dataset) chip.dataset.status = kind;
    }
    if (focus) focusElement(region.hidden ? documentRef?.getElementById('backtestResultHeading') : region);
}

export function createBacktestUiStatus(kind, code, title, cause, action) {
    return Object.freeze({ kind, code, title, cause, action });
}

export function summarizeHistoricalBacktestDataQuality(result) {
    const counts = { present: 0, estimated: 0, unresolved: 0, fallback_zero: 0, missing: 0 };
    const records = Array.isArray(result?.historicalYearRecords) ? result.historicalYearRecords : [];
    for (const record of records) {
        for (const sectionName of ['realized', 'decisionAsOf']) {
            for (const observation of Object.values(record?.[sectionName] || {})) {
                const status = String(observation?.qualityStatus || 'unresolved');
                if (!(status in counts)) counts.unresolved++;
                else counts[status]++;
            }
        }
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const limited = counts.estimated + counts.unresolved + counts.fallback_zero + counts.missing;
    const parts = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${({ present: 'gemessen', estimated: 'geschätzt', unresolved: 'ungeklärt',
            fallback_zero: 'Ersatzwert Null', missing: 'fehlend' })[status]}: ${count}`);
    return Object.freeze({
        counts: Object.freeze(counts),
        total,
        limited,
        label: total === 0
            ? 'Keine historischen Jahresbeobachtungen wurden ausgewertet.'
            : `${total} Beobachtungen (${parts.join(', ')}).${limited > 0 ? ' Begrenzte Datenqualität ist im Export (Rohdaten) markiert.' : ''}`
    });
}

export function renderHistoricalBacktestContext(documentRef, result) {
    if (!result?.outcome) return;
    const quality = summarizeHistoricalBacktestDataQuality(result);
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const gaps = quality.counts.unresolved + quality.counts.missing + quality.counts.fallback_zero;
    const hintCount = warnings.length + (gaps > 0 ? 1 : 0);
    const caption = documentRef?.getElementById('backtestResultPeriod');
    if (caption) caption.textContent = `${result.request?.startYear ?? '—'}–${result.request?.endYear ?? '—'} · ${result.completedYears ?? 0} von ${result.requestedYears ?? 0} Jahren ausgewertet`
        + (hintCount ? ` · ${hintCount} ${hintCount === 1 ? 'Hinweis' : 'Hinweise'}` : '');
    const details = documentRef?.getElementById('backtestResultInfoPop');
    if (!details) return;
    const yearCounts = { measured: 0, estimated: 0, gaps: 0 };
    for (const record of result.historicalYearRecords || []) {
        const statuses = ['realized', 'decisionAsOf'].flatMap(section =>
            Object.values(record?.[section] || {}).map(observation => observation?.qualityStatus));
        if (!statuses.length || statuses.some(status => !['present', 'estimated'].includes(status))) yearCounts.gaps++;
        else if (statuses.includes('estimated')) yearCounts.estimated++;
        else yearCounts.measured++;
    }
    const presentation = describeHistoricalBacktestResult(result);
    const paragraphs = [
        ['Datenqualität', `${yearCounts.measured} ${yearCounts.measured === 1 ? 'Jahr' : 'Jahre'} nur mit gemessenen Werten, ${yearCounts.estimated} ${yearCounts.estimated === 1 ? 'Jahr' : 'Jahre'} mit geschätzten Werten`
            + (yearCounts.gaps ? `, ${yearCounts.gaps} ${yearCounts.gaps === 1 ? 'Jahr' : 'Jahre'} mit Datenlücken` : '') + `. ${quality.label}`],
        ['In-sample-Hinweis', 'Die Leitplanken der App wurden mit Kenntnis dieser Jahre gewählt. Der historische Pfad ist keine unabhängige Prüfung und keine Erfolgswahrscheinlichkeit.'],
        ['Nächster Schritt', presentation.action],
        ['Hinweise des Rechenlaufs', warnings.length ? warnings.map(warning => `Code: ${stableCode(warning?.code, 'BACKTEST_WARNING')}`).join('. ') + '.' : 'Keine.']
    ];
    if (gaps > 0) paragraphs.push(['Datenlücken', `${gaps} Beobachtungen sind ungeklärt, fehlen oder verwenden den Ersatzwert Null. Prüfe die Markierungen im Rohdatenexport.`]);
    details.innerHTML = paragraphs.map(([label, value]) => `<p><strong>${escapeBacktestHtml(label)}:</strong> ${escapeBacktestHtml(value)}</p>`).join('');
}

export function buildAccessibleBacktestTableHtml(rows, columns, formatValue, context = {}) {
    const describedColumns = columns.map(column => {
        const catalog = PROTOCOL_COLUMNS.find(item => column.id ? item.id === column.id : item.legacyHeader === column.header);
        return { ...catalog, ...column, header: column.header || catalog?.header,
            title: column.title || (catalog ? `${catalog.label}. ${catalog.explanation}` : column.header) };
    });
    return renderProtocolTable(rows, { ...context, source: 'backtest', columns: describedColumns,
        formatValue: (column, entry) => ['neta', 'netg', 'handl-bd'].includes(column.id)
            ? formatProtocolValue(column, readProtocolValue(column, entry, { source: 'backtest' }), entry, { ...context, source: 'backtest' })
            : formatValue(column, entry) });
}
