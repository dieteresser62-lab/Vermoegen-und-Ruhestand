import { PROTOCOL_COLUMNS, protocolRowFlags, readProtocolValue, formatProtocolValue } from './protocol-columns.js';
import { renderProtocolTable } from './protocol-renderer.js';
"use strict";

const PERIOD_FIELDS = Object.freeze({
    simStartJahr: 'simStartJahrError',
    simEndJahr: 'simEndJahrError',
    backtestCohortHorizon: 'backtestCohortHorizonError'
});

const OUTCOME_LABELS = Object.freeze({
    completed: 'vollständig abgeschlossen',
    ruin: 'wirtschaftlicher Ruin',
    incomplete: 'unvollständige historische Daten',
    technical_error: 'technischer Fehler'
});

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

    const horizonInput = documentRef?.getElementById('backtestCohortHorizon');
    if (horizonInput) {
        horizonInput.min = '1';
        horizonInput.max = String(max - min + 1);
        horizonInput.step = '1';
    }

    const hint = documentRef?.getElementById('backtestDatasetHint');
    if (hint) {
        const datasetId = String(provider?.datasetId || 'historischer Datensatz');
        const revision = String(provider?.revision || 'unbekannt');
        const lookback = finiteInteger(bounds.lookbackYears);
        hint.textContent = `Datensatz ${datasetId}, Revision ${revision}. Zulässiger Simulationszeitraum: ${min}–${max} (einschließlich)`
            + (lookback && lookback > 0 ? `; ${lookback} Lookback-Jahre sind im Datenvertrag berücksichtigt.` : '.');
    }

    return Object.freeze({ startYear: min, endYear: max });
}

export function validateHistoricalBacktestPeriod({
    startRaw,
    endRaw,
    bounds,
    cohortsEnabled = false,
    cohortHorizonRaw = ''
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

    let cohortHorizonYears = null;
    if (cohortsEnabled) {
        const horizon = validateIntegerInput(cohortHorizonRaw, {
            label: 'Cohort-Horizont',
            min: 1,
            max: max - min + 1
        });
        cohortHorizonYears = horizon.value;
        if (horizon.error) errors.backtestCohortHorizon = horizon.error;
    }

    const firstErrorFieldId = Object.keys(PERIOD_FIELDS).find(id => errors[id]) || null;
    return Object.freeze({
        valid: firstErrorFieldId === null,
        startYear: start.value,
        endYear: end.value,
        cohortsEnabled: Boolean(cohortsEnabled),
        cohortHorizonYears,
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
    region.hidden = false;
    region.innerHTML = `<div class="backtest-notice-row"><span>Ergebnis</span><span class="backtest-notice-value">${escapeBacktestHtml(presentation.title)}</span></div>`
        + `<div class="backtest-notice-row"><span>Ursache</span><span class="backtest-notice-value">${escapeBacktestHtml(presentation.cause)}</span></div>`
        + `<div class="backtest-notice-row"><span>Nächster Schritt</span><span class="backtest-notice-value">${escapeBacktestHtml(presentation.action)}</span></div>`;
    const code = documentRef?.getElementById('backtestDiagnosisCode');
    const statusLabel = ({ completed: 'Backtest fertig', running: 'Backtest läuft', idle: 'Backtest bereit', ruin: 'Backtest mit Ruin beendet' })[kind]
        || `Code: ${presentation.code}`;
    if (code) code.textContent = statusLabel;
    else region.innerHTML += `<span class="backtest-status-code">${escapeBacktestHtml(statusLabel)}</span>`;
    const chip = documentRef?.getElementById('backtestPeriodStatus');
    if (chip) {
        chip.textContent = ({ idle: 'Bereit', running: 'Wird berechnet', completed: 'Vollständig', ruin: 'Ruin',
            incomplete: 'Daten unvollständig', technical_error: 'Technischer Fehler', validation_error: 'Eingaben prüfen' })[kind] || presentation.title;
        setAttribute(chip, 'data-status', kind);
        if (chip.dataset) chip.dataset.status = kind;
    }
    if (focus) focusElement(region);
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

export function renderHistoricalBacktestNotices(documentRef, result, cohortInventory = null) {
    const section = documentRef?.getElementById('backtestNotices');
    const list = documentRef?.getElementById('backtestNoticeList');
    if (!section || !list || !result?.outcome) return;
    const quality = summarizeHistoricalBacktestDataQuality(result);
    const notices = [
        ['Datenqualität', quality.label],
        ['In-sample-Hinweis', 'Die Leitplanken der App wurden mit Kenntnis dieser Jahre gewählt. Der Backtest bestätigt den Plan, er beweist ihn nicht. Historische Einzelpfade und überlappende Rolling-Cohorts sind Diagnosen des vorhandenen Datensatzes, keine unabhängigen Versuche und keine Erfolgswahrscheinlichkeit.']
    ];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    notices.push(['Hinweise des Rechenlaufs', warnings.length ? `${warnings.length} Hinweise` : 'keine']);
    for (const warning of warnings) notices.push(['Hinweis', `Code: ${stableCode(warning?.code, 'BACKTEST_WARNING')}`]);
    if (cohortInventory) {
        notices.push(['Rolling-Cohorts', 'Die Ergebnisanteile verwenden alle geeigneten, überlappenden Cohorts als Nenner; Ausschlüsse werden separat ausgewiesen.']);
    }
    list.innerHTML = notices.map(([label, value]) => `<li class="backtest-notice-row"><span>${escapeBacktestHtml(label)}</span><span class="backtest-notice-value">${escapeBacktestHtml(value)}</span></li>`).join('');
    section.hidden = false;
}

function clonePlainValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clonePlainValue);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlainValue(child)]));
}

function freezeDeep(value, seen = new WeakSet()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) freezeDeep(child, seen);
    return Object.freeze(value);
}

export function createImmutableCohortInventory(inventory) {
    return inventory && typeof inventory === 'object' ? freezeDeep(clonePlainValue(inventory)) : null;
}

function formatRate(rate) {
    return Number.isFinite(rate)
        ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(rate)} %`
        : '—';
}

export function renderHistoricalBacktestCohorts(documentRef, inventory, horizonYears) {
    const section = documentRef?.getElementById('backtestCohortSummary');
    if (!section) return;
    if (!inventory) {
        section.hidden = true;
        section.innerHTML = '';
        return;
    }
    const exclusions = Object.entries(inventory.exclusionReasons || {});
    const exclusionText = exclusions.length > 0
        ? exclusions.map(([code, count]) => `${escapeBacktestHtml(code)}: ${escapeBacktestHtml(count)}`).join(', ')
        : 'keine';
    const outcomes = [
        ['completed', 'Vollständig', inventory.completed, inventory.ratesPct?.completed],
        ['ruin', 'Ruin', inventory.ruin, inventory.ratesPct?.ruin],
        ['incomplete', 'Unvollständig', inventory.incomplete, inventory.ratesPct?.incomplete],
        ['technical_error', 'Technischer Fehler', inventory.technicalError, inventory.ratesPct?.technicalError],
        ['cancelled', 'Abgebrochen', inventory.cancelled, inventory.ratesPct?.cancelled]
    ];
    section.hidden = false;
    section.innerHTML = `
        <h4>Rolling-Cohort-In-sample-Diagnose</h4>
        <p>Feste Horizontlänge: <strong data-cohort-field="horizonYears">${escapeBacktestHtml(horizonYears)} Jahre</strong>. Überlappende Fenster; keine Erfolgswahrscheinlichkeit.</p>
        <dl class="backtest-cohort-inventory ds-kpi-strip">
            <div><dt>Kandidaten</dt><dd data-cohort-field="candidate">${escapeBacktestHtml(inventory.candidate)}</dd></div>
            <div><dt>Geeignet</dt><dd data-cohort-field="eligible">${escapeBacktestHtml(inventory.eligible)}</dd></div>
            <div><dt>Ausgeschlossen</dt><dd data-cohort-field="excluded">${escapeBacktestHtml(inventory.excluded)}</dd></div>
        </dl>
        <ul class="backtest-cohort-outcomes">
            ${outcomes.map(([kind, label, count, rate]) => `<li data-cohort-outcome="${kind}"><strong>${label}:</strong> ${escapeBacktestHtml(count)} (${escapeBacktestHtml(formatRate(rate))})</li>`).join('')}
        </ul>
        <p><strong>Ausschlussgründe:</strong> ${exclusionText}</p>`;
}

export function buildAccessibleBacktestTableHtml(rows, columns, formatValue, context = {}) {
    const describedColumns = columns.map(column => {
        const catalog = PROTOCOL_COLUMNS.find(item => column.id ? item.id === column.id : item.legacyHeader === column.header);
        return { ...catalog, ...column, header: column.header || catalog?.header,
            title: column.title || (catalog ? `${catalog.label}. ${catalog.explanation}` : column.header) };
    });
    return renderProtocolTable(rows, { ...context, source: 'backtest', columns: describedColumns,
        formatValue: (column, entry) => ['neta', 'netg', 'handl-bd'].includes(column.id)
            ? formatProtocolValue(column, readProtocolValue(column, entry, { source: 'backtest' }), entry, { source: 'backtest' })
            : formatValue(column, entry) });
}
