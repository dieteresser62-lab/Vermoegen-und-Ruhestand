/** @import {BuildSummaryData} from '../../typcheck/simulator-ui.js' */
import { lastWealthRow, rowWealthParts, rowWealthInfo } from './wealth-display.js';
import { plannedInflowsSummary } from './planned-inflows.js';
import { planTrialContextFor } from './simulator-plan-trial.js';
import { renderPersonDataNotice } from './protocol-renderer.js';
import { escapeBacktestHtml as escape } from './historical-backtest-ui.js';
import { deriveHistoricalCrises } from './simulator-crises.js';
import { renderThreeBucketPortfolioChart, disposeThreeBucketPortfolioChart } from './simulator-portfolio-chart.js';
import { effectiveRunAssumptions, simulatorRunAssumptions as heads } from './simulator-run-assumptions.js';
import { getCommonInputs } from './simulator-portfolio.js';
import { readMonteCarloParameters, renderMonteCarloRunControls, syncMonteCarloRunControls } from './monte-carlo-ui.js';
import { buildSummaryData, buildMonteCarloAnswers, projectMinimumFlexDisplay } from './results-metrics.js';
import { info, renderMonteCarloAnswers } from './results-renderers.js';
import { revealAssumptionControl } from './simulator-assumptions-ui.js';
import { invalidateBacktestForHousehold, renderInvalidatedBacktestStatus } from './simulator-backtest.js';
import { getEuroMode, bindEuroMode, subscribeEuroMode } from './euro-display.js';
import { projectBacktestEuroMetrics, backtestEuroBasis } from './backtest-euro-display.js';
import { installInfoPlacement } from '../shared/designsystem-info-popover.js';

const money = value => typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) : '—';
const integer = value => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
const percent = value => typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)} %` : '—';
const field = (label, value, help = '', detail = '') => `<div class="ds-row${help ? ' sim-cut-metric' : ''}"${help ? ` title="${escape(help)}"` : ''}><span>${escape(label)}</span><strong>${escape(value)}</strong>${detail ? `<small class="sim-money-detail">${escape(detail)}</small>` : ''}</div>`;
/**
 * @param value Zu prüfender oder darzustellender Wert.
 * @returns {string} Ergebnis der Operation.
 */
export function crisisPercent(value) {
    if (!Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    return `${(rounded === 0 ? 0 : rounded).toLocaleString('de-DE').replace('-', '−')} %`;
}
const phaseLabels = { loading: 'Profil wird geladen', preparing: 'Backtest wird vorbereitet', running: 'läuft',
    skipped: 'übersprungen · Personendaten ergänzen', blocked: 'nicht rechenbar', invalid: 'nicht rechenbar', missing: 'Daten fehlen', technical_error: 'technischer Fehler',
    idle: 'noch nicht gerechnet', error: 'Fehler', cancelled: 'abgebrochen', completed: 'abgeschlossen' };
const infoHosts = new WeakMap();
const infoDocuments = new WeakSet();

/**
 * @param [doc] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function bindSimulatorInfoPopups(doc = globalThis.document) {
    if (!doc?.querySelectorAll) return;
    installInfoPlacement(doc);
    /** @type {NodeListOf<HTMLElement>} */ (doc.querySelectorAll('#tab-ergebnis .ds-info')).forEach(host => {
        if (infoHosts.has(host)) return;
        const button = /** @type {HTMLButtonElement} */ (host.querySelector('.ds-info-button'));
        if (!button) return;
        let pinned = false;
        const show = visible => { host.dataset.visible = String(visible); button.setAttribute('aria-expanded', String(visible)); };
        const close = () => { pinned = false; show(false); };
        infoHosts.set(host, close);
        show(false);
        host.addEventListener('mouseenter', () => show(true));
        host.addEventListener('mouseleave', () => { if (!pinned && !host.contains(doc.activeElement)) show(false); });
        host.addEventListener('focusin', () => show(true));
        host.addEventListener('focusout', event => { if (!host.contains(/** @type {HTMLElement} */ (event.relatedTarget))) close(); });
        button.addEventListener('click', () => { pinned = !pinned; show(pinned); });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); button.focus(); close(); }
        });
    });
    if (infoDocuments.has(doc)) return;
    infoDocuments.add(doc);
    doc.addEventListener('click', event => /** @type {NodeListOf<HTMLElement>} */ (doc.querySelectorAll('#tab-ergebnis .ds-info')).forEach(host => {
        if (!host.contains(/** @type {HTMLElement} */ (event.target))) infoHosts.get(host)?.();
    }));
}

function backtestCutMissingDetails(result) {
    const contract = result?.metrics?.flexBasisContract;
    if (!['completed', 'ruin'].includes(result?.outcome?.kind)) return {
        reason: 'Lauf unvollständig', explanation: 'Der Backtest wurde nicht vollständig gerechnet. Die Jahre mit Kürzung können deshalb nicht ausgewertet werden.'
    };
    if (Number.isFinite(result?.metrics?.values?.flex_reduction_years_gte_10_pct)) return { reason: '', explanation: '' };
    if (!contract || !contract.decumulationRowCount) return {
        reason: 'Angaben fehlen', explanation: 'Es liegen keine auswertbaren Jahre mit Entnahmen vor.'
    };
    if (contract.observed?.length > 1) return {
        reason: 'nicht auswertbar', explanation: 'In Krisenjahren schaltet die Sicherheitsbremse die dynamische Entnahme ab. Die Kürzungen beziehen sich dann auf ein anderes Ziel und sind nicht vergleichbar.'
    };
    if (!contract.consistent) return {
        reason: 'Ziel unbekannt', explanation: 'In einzelnen Jahren fehlt die Angabe, auf welches Entnahmeziel sich die Kürzung bezieht.'
    };
    const rows = (result.rows || []).filter(entry => !['accumulation', 'BANKRUPT'].includes(entry?.row?.Regime));
    if (rows.some(entry => entry?.row?.flex_brutto_haushalt === 0
        && !Number.isFinite(entry?.row?.flex_haushalt_kuerzung_pct)
        && !Number.isFinite(entry?.entscheidung?.kuerzungProzent))) return {
        reason: 'nicht auswertbar', explanation: 'In einzelnen Jahren sind keine flexiblen Ausgaben vorgesehen. Für diese Jahre lässt sich keine prozentuale Kürzung bestimmen.'
    };
    return { reason: 'Angaben fehlen', explanation: 'Für einzelne Jahre fehlen Angaben zu den Kürzungen.' };
}

/**
 * @param result Ergebnis des Simulationslaufs.
 * @returns {string} Ergebnis der Operation.
 */
export function backtestCutMissingReason(result) {
    return backtestCutMissingDetails(result).reason;
}

function backtestCutMetricHelp(projection) {
    if (!projection.restriction.legacy && projection.restriction.valid) return projection.restriction.tooltip;
    if (Number.isFinite(projection.cuts)) return `${projection.restriction.basisNote} Die alte Berechnung zählt einschließlich genau 10 %.${Number.isFinite(projection.longestCuts) ? ` Längstens ${projection.longestCuts} Jahre am Stück.` : ''}`;
    return projection.cutMissingExplanation;
}

function renderBacktestCutMetric(projection) {
    const label = projection.restriction.title;
    if (!projection.restriction.legacy && projection.restriction.valid) return field(label,
        `${projection.restriction.count} / ${projection.restriction.observationCount} · ${projection.restriction.value}`, backtestCutMetricHelp(projection));
    if (Number.isFinite(projection.cuts)) return field(label,
        `${projection.cuts}${Number.isFinite(projection.completedYears) ? ` / ${projection.completedYears}` : ''}`,
        backtestCutMetricHelp(projection));
    return `<div class="ds-row sim-cut-metric"><span>${label}</span><p class="ds-hint sim-cut-note sim-cut-missing"><span>${escape(projection.cutMissingReason)}</span>`
        + info('overviewBacktestCutInfo', 'Erläuterung zu den Jahren mit Kürzung', projection.cutMissingExplanation) + '</p></div>';
}

/**
 * @param result Ergebnis des Simulationslaufs.
 * @param {string} [moneyBasis] Nominale oder reale Anzeige.
 * @returns Ergebnis der Operation.
 */
export function projectBacktestOverview(result, moneyBasis = 'nominal') {
    const values = projectBacktestEuroMetrics(result)[moneyBasis];
    const restriction = projectMinimumFlexDisplay(result, { backtest: true });
    const cutMissing = restriction.legacy ? backtestCutMissingDetails(result)
        : { reason: restriction.valid ? '' : 'nicht auswertbar', explanation: restriction.reason };
    return { result, restriction, outcome: result?.outcome?.kind, endWealth: values.wealth_end_nominal_eur,
        withdrawals: values.withdrawal_total_nominal_eur, cuts: restriction.legacy && !restriction.technical ? values.flex_reduction_years_gte_10_pct : restriction.count,
        cutMissingReason: cutMissing.reason, cutMissingExplanation: cutMissing.explanation,
        taxes: values.tax_total_nominal_eur, startWealth: result?.portfolioStart,
        completedYears: result?.completedYears, longestCuts: values.flex_reduction_longest_streak_gte_10_pct,
        crises: deriveHistoricalCrises(result, { moneyBasis }) };
}

/**
 * @param results Aggregierte Simulationsergebnisse.
 * @param totalRuns
 * @param failCount
 * @param [inputs] Wirksame Simulationseingaben.
 * @returns Ergebnis der Operation.
 */
export function projectMonteCarloOverview(results, totalRuns, failCount, inputs = {}) {
    const inventory = results?.outcomeInventory;
    const summary = /** @type {BuildSummaryData} */ (buildSummaryData)({ results, totalRuns, failCount });
    const valid = inventory?.schemaVersion === 'MonteCarloOutcomeInventoryV1'
        && Number.isFinite(inventory.floorCoveragePct) && !inventory.technical_error;
    return { valid, answers: buildMonteCarloAnswers({ results, totalRuns, failCount, inputs }), floorPct: valid ? inventory.floorCoveragePct : null,
        // Die Ergebniskarte zeigt je Euro-Basis dieselben Antworten wie der Monte-Carlo-Reiter (SE-1).
        moneyViews: Object.fromEntries(['nominal', 'real'].map(moneyBasis => [moneyBasis,
            { answers: buildMonteCarloAnswers({ results, totalRuns, failCount, moneyBasis, inputs }) }])),
        floorDisplay: valid ? summary[0].displayValue : '—',
        countText: valid ? summary[0].countText : '',
        covered: valid ? inventory.all_dead + inventory.horizon_exhausted : null,
        denominator: inventory?.requestedRuns ?? totalRuns,
        interval: valid ? inventory.floorCoverageEstimate?.confidenceInterval95 ?? null : null,
        finalOutcomes: results?.finalOutcomes || {},
        medianDisplay: summary[2].value, p10P90Display: summary[4].value,
        explanation: summary[0]?.description,
        technicalRuns: inventory?.technical_error ?? null };
}

let backtestPresentation = { phase: 'loading', error: null };
let automaticPeriod = null;
let rerun = null;
let refreshScheduled = false;
let revisionsEnabled = false;
let householdRerunRequired = false;
let rerunInFlight = false;
const bindings = new WeakSet();
const applyingHouseholds = new WeakSet();

/**
 * @param phase
 * @param [error] Fehler aus Validierung oder Laufzeit.
 * @returns {void}
 */
export function setOverviewBacktestStatus(phase, error = null) {
    backtestPresentation = { phase, error };
    renderInvalidatedBacktestStatus(phase);
    if (['blocked', 'invalid', 'missing', 'skipped', 'technical_error'].includes(phase)) heads.fail('backtest', phase);
    else heads.phase('backtest', phase);
    renderSimulatorOverview();
}
/**
 * @param period
 * @returns {void}
 */
export function setOverviewAutomaticPeriod(period) { automaticPeriod = period; }

/**
 * @param kind Laufart.
 * @param [inputs] Wirksame Simulationseingaben.
 * @param [settings]
 * @returns Ergebnis der Operation.
 */
export function readOverviewAssumptions(kind, inputs = getCommonInputs(), settings = null) {
    if (settings === null) settings = kind === 'backtest' ? {
        startYear: Number(/** @type {HTMLInputElement} */ (globalThis.document?.getElementById('simStartJahr'))?.value),
        endYear: Number(/** @type {HTMLInputElement} */ (globalThis.document?.getElementById('simEndJahr'))?.value)
    } : { ...readMonteCarloParameters(inputs), useCapeSampling: /** @type {HTMLInputElement} */ (globalThis.document?.getElementById('useCapeSampling'))?.checked === true };
    const values = effectiveRunAssumptions(kind, inputs, settings);
    const planContext = planTrialContextFor(inputs);
    return planContext ? { ...values, planDataContext: planContext } : values;
}

/**
 * @returns {void}
 */
export function observeOverviewAssumptions() {
    if (!globalThis.document?.getElementById('overviewBacktest')) return;
    for (const kind of ['backtest', 'montecarlo']) {
        try { heads.observe(kind, readOverviewAssumptions(kind)); }
        catch { heads.observe(kind, { invalid: true }); }
    }
}

/**
 * @param kind Laufart.
 * @param values
 * @param [metadata]
 * @returns Ergebnis der Operation.
 */
export function beginOverviewRun(kind, values, metadata = {}) {
    // Gegen aktuelle wirksame Werte vergleichen, auch wenn sich während Vorbereitung etwas änderte.
    heads.observe(kind, values);
    const context = globalThis.document?.getElementById('suiteHouseholdContext')?.textContent?.trim();
    const token = heads.begin(kind, values, { ...metadata, householdContextRevision: heads.read(kind).contextRevision,
        ...(context ? { household: context } : {}) });
    if (kind === 'backtest') backtestPresentation = { phase: 'running', error: null };
    renderSimulatorOverview();
    return token;
}
/**
 * @param kind Laufart.
 * @param token
 * @param result Ergebnis des Simulationslaufs.
 * @returns {void}
 */
export function completeOverviewRun(kind, token, result) {
    if (!heads.complete(kind, token, result)) return;
    if (kind === 'backtest') {
        backtestPresentation = { phase: 'completed', error: null };
        if (token.metadata.householdContextRevision === heads.read(kind).contextRevision) householdRerunRequired = false;
    }
    observeOverviewAssumptions();
    renderSimulatorOverview();
    scheduleOverviewRefresh();
}
/**
 * @param kind Laufart.
 * @param {string} [phase]
 * @param [error] Fehler aus Validierung oder Laufzeit.
 * @returns {void}
 */
export function failOverviewRun(kind, phase = 'error', error = null) {
    heads.fail(kind, phase);
    if (kind === 'backtest') {
        backtestPresentation = { phase, error };
        renderInvalidatedBacktestStatus(phase);
    }
    renderSimulatorOverview();
}
/**
 * @param kind Laufart.
 * @param phase
 * @returns {void}
 */
export function setOverviewRunPhase(kind, phase) {
    heads.phase(kind, phase);
    renderSimulatorOverview();
}

const householdContextChanged = state => Boolean(state.last
    && state.last.metadata.householdContextRevision !== undefined
    && state.last.metadata.householdContextRevision !== state.contextRevision);

function renderRunHead(kind, state) {
    if (!state.last) return '';
    const { inputs, settings } = state.last.values;
    const meta = state.last.metadata;
    const reserve = inputs.healthBucket?.initialAmount ?? inputs.healthBucketInitialAmount
        ?? (kind === 'backtest' ? state.last.result?.rows?.[0]?.row?.health_bucket_start : null);
    const personIds = (state.last.values.personDataContext?.persons || []).map(person => person.profileId).join(',');
    const inflows = plannedInflowsSummary(inputs.plannedInflows);
    const care = typeof inputs.pflegefallLogikAktivieren === 'boolean' ? inputs.pflegefallLogikAktivieren
        ? `${inputs.pflegeModellTyp ?? 'aktiv'} · ${inputs.pflegeMinDauer ?? '—'}–${inputs.pflegeMaxDauer ?? '—'} Jahre` : 'aus' : '';
    const monthlyPension = inputs.partner?.aktiv
        ? `${money((inputs.renteMonatlich ?? 0) + (inputs.partner.monatsrente ?? 0))} (Haushalt)`
        : money(inputs.renteMonatlich);
    return `<section class="sim-run-head" data-person-profile-ids="${escape(personIds)}"><h4>${kind === 'backtest' ? 'Backtest' : 'Monte-Carlo'}${householdContextChanged(state) ? ' · Veralteter Lauf · Annahmen seitdem geändert' : state.stale ? ' · Annahmen seitdem geändert' : ''}</h4>`
        + (state.last.values.planDataContext?.deviationApplied ? '<p class="ds-source">mit Abweichung vom Plan</p>' : '')
        + renderPersonDataNotice(state.last.values.personDataContext)
        + (meta.household ? field('Gerechnet für', meta.household) : '')
        + (kind === 'backtest' ? field('Zeitraum', `${settings.startYear}–${settings.endYear}`) : field('Läufe', `${Number.isFinite(Number(settings.anzahl)) ? integer(Number(settings.anzahl)) : settings.anzahl} · ${settings.maxDauer} Jahre · ${settings.methode}`))
        + field('Startvermögen', money(inputs.startVermoegen)) + field('Floor / Flex pro Jahr', `${money(inputs.startFloorBedarf)} / ${money(inputs.startFlexBedarf)}`)
        + (inflows ? field('Einmalige Einkünfte', `${money(inflows.amount)} (${inflows.from === inflows.to ? inflows.from : `${inflows.from}–${inflows.to}`})`) : '')
        + field('Mindest-Flex', money(inputs.minimumFlexAnnual)) + field('Rente monatlich', monthlyPension)
        + field('Strategie · Runway', `${inputs.decumulation?.mode ?? 'Standard'} · ${inputs.liquidityRunwayYears ?? '—'} Jahre`)
        + (care || Number.isFinite(reserve) ? field(Number.isFinite(reserve) ? care ? 'Pflegereserve · Pflege' : 'Pflegereserve' : 'Pflege',
            [Number.isFinite(reserve) ? money(reserve) : '', care].filter(Boolean).join(' · ')) : '')
        + (kind === 'montecarlo' ? field('Stress / Tail-Risk', `${inputs.stressPreset ?? 'NONE'} / ${inputs.tailRiskEnabled ? 'aktiv' : 'aus'}`) : '')
        + (meta.startedAt ? field('Lauf gestartet', new Date(meta.startedAt).toLocaleTimeString('de-DE')) : '') + '</section>';
}

// SE-1: Kopf der Monte-Carlo-Karte; ohne Ergebnis die beiden Fragen als Vorschau (Entwurf McLeer).
function renderMonteCarloHead(mc) {
    const settings = mc.last?.values.settings;
    const runs = Number(settings?.anzahl ?? mc.last?.result?.denominator);
    const state = mc.phase === 'idle' ? mc.last ? householdContextChanged(mc) ? 'Veralteter Lauf' : 'abgeschlossen' : 'noch nicht gerechnet' : mc.phase === 'preparing'
        ? 'Monte-Carlo wird vorbereitet' : phaseLabels[mc.phase] ?? mc.phase;
    const started = mc.last?.metadata.startedAt ? new Date(mc.last.metadata.startedAt) : null;
    const seed = Number(settings?.seed);
    const heading = `<div class="sim-card-heading"><p class="sim-eyebrow">Monte-Carlo${mc.last && Number.isFinite(runs) ? ` · ${integer(runs)} Läufe` : ''}</p><div class="sim-card-status"><span class="sim-status-chip" role="status">${escape(state)}${mc.stale ? ' · Annahmen seitdem geändert' : ''}</span>`
        + info('overviewMonteCarloInfo', 'Erläuterung zu Monte-Carlo', 'Monte-Carlo verwendet viele simulierte Lebens- und Marktpfade. Zahl der Läufe, Laufdauer und Seed legst du unter „Einstellungen ändern“ fest.') + '</div></div>';
    if (!mc.last) return heading + '<p>Monte-Carlo rechnet deinen Plan durch viele simulierte Markt- und Lebenspfade und beantwortet zwei Fragen:</p>'
        + '<div class="sim-mc-preview"><h3>Reicht das Vermögen?</h3><p class="ds-help">Anteil der Läufe, in denen dein Grundbedarf bis zum Laufende gedeckt ist, und was am Ende bleibt.</p></div>'
        + '<div class="sim-mc-preview"><h3>Muss ich mich einschränken?</h3><p class="ds-help">Wie oft der bezahlte Flex unter deinen Mindest-Flex fällt.</p></div>'
        + `<div class="sim-mc-run-row">${renderMonteCarloRunControls()}${['preparing', 'running'].includes(mc.phase) ? '' : '<p class="ds-help">Läufe laut Einstellungen</p>'}</div>`;
    return heading + `<div class="sim-mc-run-row"><p class="ds-help">${started ? `Gerechnet am ${escape(started.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}` : 'Gerechnet'}${Number.isFinite(seed) ? ` · Seed ${seed}` : ''}</p>${renderMonteCarloRunControls()}</div>`;
}

/**
 * @returns {void}
 */
export function renderSimulatorOverview() {
    // Darstellung ist nachgelagert: DOM-/Chartfehler dürfen Laufköpfe,
    // Runner-Fehlerbehandlung und die Freigabe von Starts/Navigation nicht abbrechen.
    try {
        renderSimulatorOverviewContent();
    } catch (error) {
        console.warn('[Simulator] Ergebnisübersicht konnte nicht dargestellt werden.', error);
    }
}

const overviewChartHosts = new WeakMap();

function renderSimulatorOverviewContent() {
    const doc = globalThis.document;
    const btHost = doc?.getElementById('overviewBacktest');
    if (!doc) return;
    disposeThreeBucketPortfolioChart(overviewChartHosts.get(doc));
    overviewChartHosts.delete(doc);
    if (!btHost) return;
    const bt = heads.read('backtest');
    const householdChanged = householdContextChanged(bt);
    const mc = heads.read('montecarlo');
    const moneyBasis = getEuroMode(doc);
    const projection = bt.last ? projectBacktestOverview(bt.last.result, moneyBasis) : null;
    const period = bt.last?.values.settings ?? automaticPeriod;
    const contextHost = doc.getElementById('simulatorContextPills');
    if (contextHost) contextHost.innerHTML = (householdChanged || householdContextChanged(mc) ? '<span class="sim-status-chip">Annahmen geändert · Veralteter Lauf</span>'
            : bt.stale || mc.stale ? '<span class="sim-status-chip">Annahmen geändert</span>' : '');
    const title = doc.getElementById('simulatorResultQuestion');
    if (title && period) title.textContent = `Hätte dein Plan die Jahre ${period.startYear} bis ${period.endYear} überstanden?`;
    const status = phaseLabels[backtestPresentation.phase] ?? backtestPresentation.phase;
    const outcomeStatus = householdChanged ? `Veraltetes Ergebnis · ${status}` : backtestPresentation.phase === 'completed' && projection
        ? ({ completed: 'überstanden', ruin: 'Floor nicht gedeckt', incomplete: 'Daten fehlen', technical_error: 'technischer Fehler' }[projection.outcome] ?? status)
        : status;
    const error = backtestPresentation.error;
    const coverage = automaticPeriod
        ? ` Verfügbares Endjahr: ${automaticPeriod.endYear}.${automaticPeriod.missingYears?.length ? ` Vorjahresabdeckung fehlt: ${automaticPeriod.missingYears.join(', ')}.` : ''}` : '';
    const outcomeText = householdChanged ? 'Veraltetes Ergebnis · für die aktuellen Annahmen noch nicht gerechnet.'
        : projection?.outcome === 'completed' ? `Ja. Dein Plan hätte die Jahre ${period.startYear} bis ${period.endYear} überstanden.`
        : projection?.outcome === 'ruin' ? `Der Floor wäre ${projection.result.ruinYear ?? 'im Lauf'} nicht mehr gedeckt.`
        : projection?.outcome === 'incomplete' ? 'Daten fehlen' : projection ? 'technischer Fehler' : status;
    btHost.innerHTML = `<div class="sim-card-heading"><p class="sim-eyebrow">Historischer Backtest${period ? ` · ${period.startYear}–${period.endYear}` : ''}</p><div class="sim-card-status"><span class="sim-status-chip">${escape(outcomeStatus)}</span>`
        + info('overviewBacktestInfo', 'Erläuterung zum Backtest', ['Dein heutiger Plan wird mit echten Jahresrenditen und Inflationsraten gerechnet. Der Lauf endet bei Ruin. Ein historischer Einzelpfad ist keine Erfolgswahrscheinlichkeit.' + coverage,
            projection ? `${projection.restriction.title}: ${backtestCutMetricHelp(projection)}` : '']) + '</div></div><div class="sim-backtest-outcome"><div class="sim-outcome-primary"><h2 class="sim-verdict">' + escape(outcomeText) + '</h2>'
        + (projection ? `<p class="sim-outcome-caption">Gesamtvermögen · ${escape(backtestEuroBasis(projection.result, moneyBasis))} · inklusive Pflegereserve ${rowWealthInfo(lastWealthRow(projection.result?.rows), moneyBasis)}</p><p class="sim-hero-amount">${money(Number.isFinite(projection.endWealth) ? projection.endWealth + (rowWealthParts(lastWealthRow(projection.result?.rows), moneyBasis)?.total || 0) : null)}</p>${Number.isFinite(lastWealthRow(projection.result?.rows).immobilien_wert_end) ? `<small class="sim-money-detail">davon Geldvermögen ${money(projection.endWealth)} · Immobilien ${money(rowWealthParts(lastWealthRow(projection.result?.rows), moneyBasis)?.total)}</small>` : ''}` : '')
        + (Number.isFinite(projection?.startWealth) ? `<p class="sim-outcome-start">gestartet mit Geldvermögen ${money(projection.startWealth)}</p>` : '')
        + (backtestPresentation.phase !== 'completed' ? `<p role="status">${escape(status)}</p>` : '')
        + (error?.name === 'SimulatorValidationError' ? `<p>${escape(error.errors?.[0]?.message ?? error.message)}</p><button class="ds-button ds-button-secondary" type="button" data-overview-field="${escape(error.errors?.[0]?.fieldId ?? '')}">Eingabe in Annahmen korrigieren</button>` : '')
        + (backtestPresentation.phase === 'skipped' ? `<p>${escape(error?.message || '')} · <a href="depot-tranchen-manager.html#personendaten">Geburtsdatum einmal ergänzen</a></p>` : '')
        + (householdChanged ? '<p class="ds-hint">Veralteter Lauf · Annahmen seitdem geändert. Beträge und Belege stammen aus dem bisherigen Lauf.</p>'
            : bt.stale ? '<p class="ds-hint">Annahmen seitdem geändert</p>' : '')
        + '</div>'
        + (projection ? `<div class="ds-kpi-strip sim-outcome-metrics">${field('Entnommen, gesamt', money(projection.withdrawals))}${renderBacktestCutMetric(projection)}${field('Gezahlte Steuern', money(projection.taxes))}</div>` : '')
        + '</div>'
        + '<div class="sim-backtest-footer">' + (bt.last ? `<p class="sim-backtest-foot">${bt.last.metadata.automatic ? bt.last.metadata.opening ? 'Automatisch gerechnet beim Öffnen' : 'Automatisch neu gerechnet nach Annahmenänderung' : 'Manuell gerechnet'}${bt.last.metadata.startedAt ? ` · Annahmen vom ${escape(new Date(bt.last.metadata.startedAt).toLocaleString('de-DE'))}` : ''}</p>` : '')
        + '<div class="sim-detail-links"><button type="button" class="ds-text-link" data-simulator-tab="backtesting" data-overview-focus="simStartJahr">Zeitraum ändern</button><button type="button" class="ds-text-link" data-simulator-tab="backtesting" data-overview-focus="simulationLog">Jahresprotokoll</button></div></div>';
    const chartHost = doc.createElement('div');
    overviewChartHosts.set(doc, chartHost);
    chartHost.id = 'overviewPortfolioChart';
    chartHost.className = 'sim-overview-chart';
    chartHost.setAttribute('role', 'region');
    chartHost.setAttribute('aria-label', `${householdChanged ? 'Veralteter Lauf · ' : ''}Gesamtvermögensverlauf, Kalenderjahre`);
    chartHost.setAttribute('tabindex', '0');
    btHost.insertBefore(chartHost, /** @type {HTMLElement} */ (btHost.querySelector('.sim-backtest-footer')));
    if (projection) renderThreeBucketPortfolioChart(chartHost, projection.result.rows, { result: projection.result, calendar: true, moneyBasis });
    if (projection && householdChanged) {
        const notice = doc.createElement('p');
        notice.textContent = 'Veralteter Gesamtvermögensverlauf · bisheriger Lauf';
        chartHost.insertBefore(notice, chartHost.firstChild);
    }
    const crisisHost = doc.getElementById('overviewCrises');
    // Euro-Basis einmal über allen Krisen; Vergleichsbasis wie in deriveHistoricalCrises (erstes Krisenjahr = Laufstart → Start).
    const crisisStart = projection?.result?.request?.period?.startYear ?? projection?.result?.request?.startYear;
    if (crisisHost) crisisHost.innerHTML = projection ? (householdChanged ? '<p>Veraltete Krisenbelege · bisheriger Lauf</p>' : '') + `<p class="ds-help sim-price-basis">${escape(backtestEuroBasis(projection.result, moneyBasis))}</p>` + projection.crises.map(crisis => `<article class="sim-crisis"><div class="sim-card-heading"><h3>${escape(crisis.label)}</h3><p>${crisis.from === crisis.to ? crisis.from : `${crisis.from}–${crisis.to}`}${crisis.status === 'partial' ? ' · Teilfenster' : ''}</p></div>`
        + (crisis.status === 'not_reached' ? '<p>nicht erreicht</p>' : crisis.status === 'missing' ? '<p>Daten fehlen</p>'
            : field(`Tiefster Jahresendstand · ${crisis.minimum.year}`, money(crisis.minimum.total), 'Gesamtvermögen mit Immobilien, einschließlich Pflegereserve.', `davon Geldvermögen ${money(crisis.minimum.money)}`) + field(`Veränderung gegen ${crisis.from === crisisStart ? 'Start' : 'Vorjahr'}`, crisisPercent(crisis.changePct))
                + field('Flex-Kürzung', crisis.cuts === null ? 'Angaben fehlen' : crisis.cuts === 0 ? 'keine ab 10 %' : `${crisis.cuts} ${crisis.cuts === 1 ? 'Jahr' : 'Jahre'} ab 10 % · niedrigste Rate ${percent(crisis.lowestFlexRate)}`)
                + field('Liquidität am Tiefpunkt', money(crisis.minimum.liq))) + '</article>').join('') : '<p>Nach dem Backtest werden die enthaltenen Krisen gezeigt.</p>';
    const mcHost = doc.getElementById('overviewMonteCarlo');
    if (mc.last?.result?.answers) {
        for (const id of ['monteCarloAnswers', 'overviewMonteCarloAnswers']) {
            renderMonteCarloAnswers(doc.getElementById(id), mc.last.result.moneyViews?.[getEuroMode(doc)]?.answers ?? mc.last.result.answers, mc.stale);
        }
    }
    if (mcHost) {
        mcHost.innerHTML = renderMonteCarloHead(mc);
        syncMonteCarloRunControls(doc, !!mc.last);
    }
    for (const [id, state] of /** @type {[string, ReturnType<typeof heads.read>][]} */ ([['simBacktestPlanDeviation', bt], ['simMonteCarloPlanDeviation', mc]])) {
        const notice = doc.getElementById(id);
        if (notice) notice.hidden = !state.last?.values.planDataContext?.deviationApplied;
    }
    const headHost = doc.getElementById('overviewRunHeads');
    if (headHost) headHost.innerHTML = renderRunHead('backtest', bt) + renderRunHead('montecarlo', mc) || '<p>Noch kein erfolgreicher Lauf.</p>';
    const reserveHost = doc.getElementById('simCareReserve');
    const reserve = bt.last?.result?.rows?.[0]?.row?.health_bucket_start;
    if (reserveHost && Number.isFinite(reserve)) reserveHost.textContent = `${money(reserve)} · ${householdChanged ? 'veralteter' : 'letzter'} Backtest`;
    bindSimulatorInfoPopups(doc);
}

/**
 * @returns {void}
 */
export function scheduleOverviewRefresh() {
    if (refreshScheduled || !globalThis.document?.getElementById('overviewBacktest')) return;
    refreshScheduled = true;
    queueMicrotask(() => {
        refreshScheduled = false;
        observeOverviewAssumptions();
        renderSimulatorOverview();
        const state = heads.read('backtest');
        if (revisionsEnabled && !applyingHouseholds.has(globalThis.document) && !rerunInFlight && rerun
            && (householdRerunRequired || globalThis.document.getElementById('tab-ergebnis')?.classList.contains('active'))
            && (heads.claimBacktestRevision() || (householdRerunRequired && !state.needsRun
                && !['loading', 'running', 'preparing', 'blocked'].includes(state.phase)))) {
            householdRerunRequired = false;
            rerunInFlight = true;
            Promise.resolve().then(() => rerun()).catch(error => failOverviewRun('backtest', 'technical_error', error))
                .finally(() => { rerunInFlight = false; scheduleOverviewRefresh(); });
        }
    });
}

/**
 * @returns {void}
 */
export function enableOverviewRevisions() { revisionsEnabled = true; }

/**
 * @param {object} options
 * @param options.rerunBacktest
 * @param options.activateTab
 * @param options.runMonteCarlo
 * @param [doc] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function initializeResultOverview({ rerunBacktest, activateTab, runMonteCarlo }, doc = globalThis.document) {
    if (!doc?.getElementById('overviewBacktest') || bindings.has(doc)) return;
    bindings.add(doc);
    const euroControl = doc.getElementById('overviewWealthMode');
    if (euroControl) bindEuroMode(doc, euroControl, scheduleOverviewRefresh);
    else subscribeEuroMode(doc, scheduleOverviewRefresh);
    rerun = rerunBacktest;
    doc.addEventListener('simulator:household-changing', event => {
        applyingHouseholds.add(doc);
        for (const kind of ['backtest', 'montecarlo']) {
            let values;
            try { values = readOverviewAssumptions(kind); } catch { values = { invalid: true }; }
            // Die Mitgliedschaft ist bereits wirksam, die Recheneingaben noch nicht.
            heads.replaceContext(kind, { ...values, householdSelection: event.detail });
        }
        householdRerunRequired = true;
        backtestPresentation = { phase: 'idle', error: null };
        renderSimulatorOverview();
    });
    doc.addEventListener('simulator:household-applied', () => {
        applyingHouseholds.delete(doc);
        let changed = false;
        for (const kind of ['backtest', 'montecarlo']) {
            let values;
            try { values = readOverviewAssumptions(kind); } catch { values = { invalid: true }; }
            const replaced = heads.replaceContext(kind, values);
            if (kind === 'backtest') changed = replaced;
        }
        if (changed) {
            invalidateBacktestForHousehold();
            householdRerunRequired = true;
            backtestPresentation = { phase: 'idle', error: null };
        }
        renderSimulatorOverview();
        scheduleOverviewRefresh();
    });
    doc.addEventListener('simulator:plan-trial', scheduleOverviewRefresh);
    doc.addEventListener('simulator:tab', event => { if (event.detail === 'ergebnis') scheduleOverviewRefresh(); });
    const changed = event => {
        if (/** @type {HTMLElement} */ (event.target)?.matches?.('input, select') && !/** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest('[data-workshop-panel]'))) scheduleOverviewRefresh();
    };
    doc.addEventListener('input', changed);
    doc.addEventListener('change', changed);
    doc.addEventListener('click', event => {
        const start = /** @type {HTMLButtonElement} */ (/** @type {HTMLElement} */ (event.target).closest('#mcButton, [data-mc-start]'));
        if (start) {
            if (!start.disabled && !/** @type {HTMLButtonElement} */ (doc.getElementById('mcButton'))?.disabled) runMonteCarlo?.();
            return;
        }
        const target = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (event.target).closest('[data-simulator-tab], [data-overview-field]'));
        if (!target) return;
        if (target.dataset.simulatorTab) {
            activateTab(target.dataset.simulatorTab);
            const focus = doc.getElementById(target.dataset.overviewFocus);
            // SE-2: Das Jahresprotokoll steht zugeklappt; der Sprung öffnet es.
            for (let node = focus?.closest?.('details'); node; node = node.parentElement?.closest?.('details')) node.open = true;
            if (focus) { if (!focus.hasAttribute('tabindex') && !focus.matches('input, select, button')) focus.setAttribute('tabindex', '-1'); focus.focus(); }
        }
        else {
            const control = doc.getElementById(target.dataset.overviewField);
            activateTab(/** @type {HTMLElement} */ (control?.closest('.tab-panel'))?.id?.replace('tab-', '') ?? 'annahmen');
            revealAssumptionControl(control);
        }
    });
    observeOverviewAssumptions();
    renderSimulatorOverview();
}
