import { escapeHtml } from '../shared/security-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { WEALTH_HISTORY_START_KEY, assertHistoryStart, requireHistoryRecord, readDailyPrices,
    historyDay, historyDate, historyGaps, localHistoryDate, commitHistoryRecords } from './tranchen-history-store.js';
import { evaluateHistoryCourse, reconstructHistoryShares } from './tranchen-history-model.js';
import { renderHistorySparkline, renderHistoryCourseSvg, bindHistoryChartSize } from './tranchen-history-svg.js';
import { readReconciliationHistory } from './tranche-reconciliation.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const date = value => value?.split('-').reverse().join('.') || '—';
const percent = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${formatDisplayNumber(value, { unit: 'percent', fractionDigits: 1 })}` : 'Nicht verfügbar';
const courseMeasurementMessage = course => `Messbeginn ${date(historyDate(course.measurementStart))}${course.status === 'provisional' ? ' · vorläufig' : ''}.`;

/** Gemeinsamer sichtbarer Hinweis; die Messbasis kommt ausschließlich aus der Projektion. */
export function buildHistoryMeasurementHtml(measurementStart, status, rangeStart = measurementStart) {
    const measured = Number.isInteger(measurementStart) ? date(historyDate(measurementStart)) : null;
    const qualifier = status === 'provisional' ? ' · vorläufig' : status !== 'complete' ? ' · nicht vollständig bewertbar' : '';
    const title = !measured ? 'Ohne bewertbaren Tagesabschluss ist keine Messbasis verfügbar.'
        : status === 'provisional' ? measurementStart > rangeStart
            ? 'Verkürzte Messbasis ab dem ersten bewertbaren Tagesabschluss; frühere Tage sind nicht vollständig bewertbar.'
            : 'Messbasis ab dem ersten bewertbaren Tagesabschluss; ungeprüfte Tage oder rückwirkend angenommene Tagesgeldstände machen den Verlauf vorläufig.'
        : status !== 'complete' ? 'Der Verlauf ist nicht vollständig bewertbar; unbekannte Werte bleiben offen.'
        : 'Messbasis ab dem ersten bewertbaren Tagesabschluss im gewählten Zeitraum.';
    return `<span class="history-measurement" title="${escapeHtml(title)}">${measured ? 'Messbeginn ' + measured : 'Messbeginn nicht verfügbar'}${qualifier}</span>`;
}

export function buildHistoryRecoveryHtml(candidates = []) {
    if (!candidates.length) return '';
    return `<section aria-label="Unbekannte Verlaufsbestände"><p>Nur rückwirkend gültige Stammdaten bestätigen. Ein späterer Nachkauf gehört in eine neue Tranche; tatsächliche Verkäufe über die Verkaufsabstimmung erfassen.</p>${candidates.map(lot =>
        `<p><strong>${escapeHtml(lot.name)} · ${escapeHtml(lot.trancheId)}</strong> · ${lot.fromDate ? 'unbekannt ab ' + date(lot.fromDate) : 'ursprünglicher Kaufbeginn nicht gesichert'}
        <button type="button" class="ds-button ds-button-secondary" data-history-recovery="${escapeHtml(lot.trancheId)}" data-history-recovery-kind="${lot.kind}" data-history-recovery-blocked="${lot.blocked}" ${lot.blocked ? 'disabled' : ''}>${lot.kind === 'correct' ? 'Korrigierten Bestand für den Verlauf bestätigen' : 'Fehleingabe aus dem Verlauf verwerfen'} · ${escapeHtml(lot.name)}</button>${lot.blocked ? `<small>Gesperrt: ${escapeHtml(lot.blockedReason || 'bestätigter Verkaufsbeleg.')}</small>` : ''}</p>`).join('')}</section>`;
}

const recoveryBindings = new WeakSet();
export function bindHistoryRecoveryUI(doc, { execute, blocked = () => false }) {
    if (recoveryBindings.has(doc)) return;
    recoveryBindings.add(doc);
    let pending = false;
    doc.getElementById('managerHousehold')?.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-history-recovery]');
        if (!button || button.disabled || pending || blocked()) return;
        pending = true;
        // Der Controller hält den Profil-/Dokumentkontext noch im Klick fest.
        return (async () => {
            try { return await execute({ trancheId: button.dataset.historyRecovery, kind: button.dataset.historyRecoveryKind }); }
            finally { pending = false; }
        })();
    });
}

export function readManagerHistoryContext(registry, { storage = persistenceStorage, today = localHistoryDate() } = {}) {
    try {
        const start = requireHistoryRecord(storage.getItem(WEALTH_HISTORY_START_KEY), assertHistoryStart);
        if (!start) return { status: 'missing', today };
        const loaded = readDailyPrices(storage);
        if (loaded.status === 'corrupt') throw loaded.error;
        return { status: 'ready', startDate: start.startDate, today, prices: loaded.value || { version: 1, symbols: {} },
            events: readReconciliationHistory(registry) };
    } catch (error) { return { status: 'corrupt', today, error: error.message }; }
}

const signClass = value => !Number.isFinite(value) || value === 0 ? 'history-neutral' : value > 0 ? 'history-positive' : 'history-negative';
export function buildPersonHistoryHtml(history, title = 'Vermögensverlauf', context = null, infoId = 'personHistoryInfo') {
    if (!history) return `<div class="pv-person-history"><p class="history-note">${context?.status === 'corrupt' ? 'Verlaufsdaten beschädigt: ' + escapeHtml(context.error) : 'Noch keine Verlaufshistorie.'}</p><div class="pv-history-placeholder" aria-hidden="true"></div></div>`;
    const m = history.metrics;
    const hasValues = history.points.some(p => Number.isFinite(p.total));
    return `<div class="pv-person-history"><p class="pv-history-change ${signClass(m.change)}">${Number.isFinite(m.change) ? `<strong>${m.change > 0 ? '+' : ''}${escapeHtml(money(m.change))}</strong> · ${escapeHtml(percent(m.percent))}` : 'Veränderung nicht verfügbar'}</p>
        ${hasValues ? renderHistorySparkline(history.points, { title, width: 280, height: 60, eventDays: history.events.map(e => e.day) }) : '<div class="pv-history-placeholder">Noch keine bewertbare Verlaufshistorie.</div>'}
        <span class="ds-info pv-history-info"><button type="button" class="ds-button ds-info-button" aria-label="${escapeHtml(title)}: Messbeginn und Zeitraum" aria-expanded="false" aria-controls="${escapeHtml(infoId)}">ⓘ</button><span id="${escapeHtml(infoId)}" class="ds-info-pop" role="tooltip">${buildHistoryMeasurementHtml(history.measurementStart, m.status, history.range.start)}<br>Messstatus: ${m.status === 'complete' ? 'vollständig' : m.status === 'provisional' ? 'vorläufig' : 'nicht vollständig bewertbar'}.<br>Zeitraum ${date(history.range.startDate)} bis ${date(history.range.endDate)} · nach Entnahmen</span></span>
        ${m.status !== 'complete' ? `<small>${m.status === 'provisional' ? 'Verlauf vorläufig' : 'Verlauf nicht vollständig bewertbar'}</small>` : ''}
        ${history.end?.total === null ? `<small>Teilabdeckung · bekannter Betrag ${escapeHtml(money(history.end.known))} · Gesamtwert nicht vollständig bewertbar.</small>` : ''}
        ${history.gaps.length ? '<small>Ungeprüfte Werktage · Nachladen beim nächsten Start</small>' : ''}
        ${history.errors.length ? `<small>Historische Bewertung unvollständig: ${escapeHtml(history.errors.join(' · '))}</small>` : ''}</div>`;
}

export function projectTrancheHistory(tranche, context, profileId) {
    if (context?.status !== 'ready') return { status: context?.status || 'missing', message: context?.error || 'Noch keine Verlaufshistorie.' };
    try {
        const course = evaluateHistoryCourse({ tranche, ...context });
        const record = course.symbol ? context.prices.symbols[course.symbol] : null;
        const chain = reconstructHistoryShares(tranche, context.events.filter(event => event.profileId === profileId));
        const sales = chain.changes.map(change => ({ day: change.day, shares: change.sale.actual.sharesSold }));
        const gaps = course.symbol ? historyGaps(course.range.start, course.range.end, record?.queried || []) : [];
        const notes = [];
        if (!course.symbol) notes.push('Kein Kursverlauf ohne Ticker.');
        else {
            if (course.measurementStart === null) notes.push('Kursbasis fehlt; Entwicklung nicht verfügbar.');
            else notes.push(courseMeasurementMessage(course));
            if (course.points.some(point => point.status === 'unsupported-currency')) notes.push('Nicht unterstützte Kurswährung; keine EUR-Umrechnung verfügbar.');
            if (gaps.length) notes.push(`${gaps.length} ${gaps.length === 1 ? 'Lücke' : 'Lücken'}: ` + gaps.map(([a, b]) => `${date(historyDate(a))}–${date(historyDate(b))}`).join(' · ') + ' · wird beim nächsten Start nachgeladen.');
            else if (course.points.length) notes.push('Keine ungeprüften Werktage. Wochenenden und Börsenfeiertage im geprüften Intervall zählen nicht als Lücke.');
            if (record?.failures >= 3) notes.push(`Nach drei erfolglosen Versuchen: ${record.lastError}`);
        }
        if (!course.points.length) notes.push('Noch kein abgeschlossener Tag in diesem Zeitraum.');
        return { status: 'ready', course, record, sales, gaps, message: notes.join(' ') };
    } catch (error) { return { status: 'corrupt', message: `Historische Bewertung nicht verfügbar: ${error.message}` }; }
}

export function buildTrancheHistorySummary(history) {
    if (history.status !== 'ready') return '<td>—</td><td><small>Entwicklung nicht verfügbar</small></td>';
    const { course } = history;
    const points = course.points.map(point => ({ day: point.day, total: point.value, gap: point.gap }));
    return `<td class="pv-course-spark">${course.symbol ? renderHistorySparkline(points, { title: 'Kursentwicklung', width: 160, height: 36, kind: 'course', eventDays: history.sales.map(s => s.day) }) : '<small>Kein Kursverlauf ohne Ticker</small>'}</td>
        <td class="pv-course-change"><strong class="${signClass(course.percent)}">${escapeHtml(percent(course.percent))}</strong><small>${buildHistoryMeasurementHtml(course.measurementStart, course.status, course.range.start)}</small></td>`;
}

export function buildTrancheHistoryDetail(tranche, history) {
    if (history.status !== 'ready') return `<section class="pv-history-detail"><p class="history-note">${escapeHtml(history.message)}</p></section>`;
    const { course, record, sales } = history;
    // Die bestehende Projektion/ARIA-Beschreibung bleibt vollständig; sichtbar steht
    // die Messbasis allein im gemeinsamen Hinweis statt zusätzlich im Abdeckungstext.
    const message = course.measurementStart != null ? history.message.replace(courseMeasurementMessage(course), '').trim() : history.message;
    const last = course.points.at(-1);
    const states = [];
    for (const point of course.points) {
        const state = point.gap ? 'gap' : point.queried ? 'queried' : 'neutral';
        const tail = states.at(-1);
        if (tail?.state === state) { tail.end = point.day; tail.count++; }
        else states.push({ state, start: point.day, end: point.day, count: 1 });
    }
    const coverage = states.map(part => `<span class="history-coverage-${part.state}" style="flex-grow:${part.count}" title="${date(historyDate(part.start))}–${date(historyDate(part.end))}: ${part.state === 'gap' ? 'ungeprüfte Werktage' : part.state === 'queried' ? 'geprüft' : 'Wochenende ohne Prüfung'}"></span>`).join('');
    return `<section class="pv-history-detail" aria-label="Kursverlauf ${escapeHtml(tranche.name)}">
        <div class="pv-history-facts"><strong>${escapeHtml(tranche.name)}</strong><span>Stück heute <b>${formatDisplayNumber(tranche.shares, { fractionDigits: 3, minimumFractionDigits: 0 })}</b></span>
        <span>Kurs ${last?.priceDay != null ? date(historyDate(last.priceDay)) : 'nicht verfügbar'} <b>${escapeHtml(Number.isFinite(last?.value) ? formatDisplayNumber(last.value, { unit: 'price', fractionDigits: 2 }) : '—')}</b></span>
        <span>Wert des heutigen Bestands <b>${escapeHtml(money(tranche.marketValue))}</b></span><span>Tageskurse gespeichert <b>${record?.days.length || 0}</b></span></div>
        <div class="history-coverage"><span>Kursabdeckung · ${date(course.range.startDate)} bis ${date(course.range.endDate)}</span>
        ${buildHistoryMeasurementHtml(course.measurementStart, course.status, course.range.start)}
        <div class="history-coverage-bar" role="img" aria-label="${escapeHtml(history.message)}">${course.symbol ? coverage : ''}</div><p class="history-note">${escapeHtml(message)}</p></div>
        <div class="pv-course-chart" ${course.symbol ? '' : 'hidden'}>${course.symbol ? renderHistoryCourseSvg(course, { title: `Kursverlauf ${tranche.name}`, sales, purchaseDate: tranche.purchaseDate }) : ''}</div>
        ${sales.length ? `<ul class="pv-history-sales">${sales.filter(sale => sale.day >= course.range.start && sale.day <= course.range.end).map(sale => `<li>Verkauf ${date(historyDate(sale.day))} · ${formatDisplayNumber(sale.shares, { fractionDigits: 3, minimumFractionDigits: 0 })} Stück</li>`).join('')}</ul>` : ''}
        <small>Schlusskurse bis ${date(course.range.endDate)} · Kaufpreislinie · Kursentwicklung unabhängig von Verkäufen.</small></section>`;
}

/** Nur der Grafikhost wird bei Resize ersetzt; die bestätigte Projektion bleibt flüchtig. */
export function bindTrancheHistoryChart(host, tranche, history, { region = host.closest?.('.table-scroll'), detail = host.closest?.('.pv-history-detail') } = {}) {
    const prepareMeasure = () => {
        // clientWidth schließt Rahmen und einen vertikalen Scrollbalken bereits aus.
        const width = region?.clientWidth;
        if (detail && Number.isFinite(width) && width >= 0) detail.style.width = `${width}px`;
    };
    const binding = bindHistoryChartSize(host, (projection, size) => {
        if (projection?.status !== 'ready' || !projection.course.symbol) return;
        host.innerHTML = renderHistoryCourseSvg(projection.course, { title: `Kursverlauf ${tranche.name}`,
            sales: projection.sales, purchaseDate: tranche.purchaseDate, ...size });
    }, { region, prepareMeasure });
    binding.update(history);
    return binding;
}

export async function confirmManagerHistoryStart(startDate, { today = localHistoryDate(), ...options } = {}) {
    historyDay(today);
    const next = assertHistoryStart({ version: 1, startDate });
    if (startDate > today) throw new Error('Verlaufsbeginn darf nicht in der Zukunft liegen.');
    const storage = options.storage || persistenceStorage;
    const current = requireHistoryRecord(storage.getItem(WEALTH_HISTORY_START_KEY), assertHistoryStart);
    if (current?.startDate === startDate) return current;
    await commitHistoryRecords([[WEALTH_HISTORY_START_KEY, JSON.stringify(next)]], options);
    return next;
}

const bindings = new WeakMap();
/** Native Buttons liefern Enter/Leertaste als Klick; kein zweiter Tastaturhandler. */
export function bindTrancheHistoryUI(doc, { render, blocked = () => false }) {
    if (bindings.has(doc)) return bindings.get(doc);
    const state = { expandedId: null, profileId: null };
    state.beforeRender = (profileId, tranches) => {
        if (profileId !== state.profileId || !tranches.some(t => t.trancheId === state.expandedId)) state.expandedId = null;
        state.profileId = profileId;
        const focused = doc.activeElement;
        return focused?.dataset?.historyToggle || null;
    };
    state.afterRender = focusId => {
        if (focusId) Array.from(doc.getElementById('tranchenTable')?.querySelectorAll?.('[data-history-toggle]') || [])
            .find(button => button.dataset.historyToggle === focusId)?.focus();
    };
    doc.getElementById('tranchenTable')?.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-history-toggle]');
        if (!button || button.disabled || blocked()) return;
        state.expandedId = state.expandedId === button.dataset.historyToggle ? null : button.dataset.historyToggle;
        render();
    });
    bindings.set(doc, state);
    return state;
}

const startBindings = new WeakSet();
export function bindManagerHistoryStartUI(doc, { save, change }) {
    if (startBindings.has(doc)) return;
    startBindings.add(doc);
    const host = doc.getElementById('managerHousehold');
    host?.addEventListener('submit', event => {
        const form = event.target?.closest?.('[data-history-start-form]');
        if (!form) return;
        event.preventDefault();
        return save();
    });
    host?.addEventListener('input', event => {
        const input = event.target?.closest?.('[data-history-start-input]');
        if (!input || input.disabled) return;
        change(input.value);
    });
}
