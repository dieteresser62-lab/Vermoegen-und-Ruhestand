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
import { getEuroMode, subscribeEuroMode, euroBasisLabel } from './euro-display.js';

const money = value => typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value) : '—';
const percent = value => typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)} %` : '—';
const field = (label, value, help = '') => `<div class="ds-row${help ? ' sim-cut-metric' : ''}"${help ? ` title="${escape(help)}"` : ''}><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;
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

export function bindSimulatorInfoPopups(doc = globalThis.document) {
    if (!doc?.querySelectorAll) return;
    doc.querySelectorAll('#tab-ergebnis .ds-info').forEach(host => {
        if (infoHosts.has(host)) return;
        const button = host.querySelector('.ds-info-button');
        if (!button) return;
        let pinned = false;
        const show = visible => { host.dataset.visible = String(visible); button.setAttribute('aria-expanded', String(visible)); };
        const close = () => { pinned = false; show(false); };
        infoHosts.set(host, close);
        show(false);
        host.addEventListener('mouseenter', () => show(true));
        host.addEventListener('mouseleave', () => { if (!pinned && !host.contains(doc.activeElement)) show(false); });
        host.addEventListener('focusin', () => show(true));
        host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget)) close(); });
        button.addEventListener('click', () => { pinned = !pinned; show(pinned); });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); button.focus(); close(); }
        });
    });
    if (infoDocuments.has(doc)) return;
    infoDocuments.add(doc);
    doc.addEventListener('click', event => doc.querySelectorAll('#tab-ergebnis .ds-info').forEach(host => {
        if (!host.contains(event.target)) infoHosts.get(host)?.();
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

export function projectBacktestOverview(result) {
    const values = result?.metrics?.values || {};
    const startReserve = result?.rows?.[0]?.row?.health_bucket_start;
    const startWithoutReserve = Number.isFinite(result?.portfolioStart) && Number.isFinite(startReserve)
        ? result.portfolioStart - startReserve : null;
    const restriction = projectMinimumFlexDisplay(result, { backtest: true });
    const cutMissing = restriction.legacy ? backtestCutMissingDetails(result)
        : { reason: restriction.valid ? '' : 'nicht auswertbar', explanation: restriction.reason };
    return { result, restriction, outcome: result?.outcome?.kind, endWealth: values.wealth_end_nominal_eur,
        withdrawals: values.withdrawal_total_nominal_eur, cuts: restriction.legacy && !restriction.technical ? values.flex_reduction_years_gte_10_pct : restriction.count,
        cutMissingReason: cutMissing.reason, cutMissingExplanation: cutMissing.explanation,
        taxes: values.tax_total_nominal_eur, startWealth: result?.portfolioStart,
        completedYears: result?.completedYears, longestCuts: values.flex_reduction_longest_streak_gte_10_pct,
        crises: deriveHistoricalCrises(result, { startWithoutReserve }) };
}

export function projectMonteCarloOverview(results, totalRuns, failCount) {
    const inventory = results?.outcomeInventory;
    const summary = buildSummaryData({ results, totalRuns, failCount });
    const valid = inventory?.schemaVersion === 'MonteCarloOutcomeInventoryV1'
        && Number.isFinite(inventory.floorCoveragePct) && !inventory.technical_error;
    return { valid, answers: buildMonteCarloAnswers({ results, totalRuns, failCount }), floorPct: valid ? inventory.floorCoveragePct : null,
        moneyViews: Object.fromEntries(['nominal', 'real'].map(moneyBasis => {
            const cards = buildSummaryData({ results, totalRuns, failCount, moneyBasis });
            return [moneyBasis, { answers: buildMonteCarloAnswers({ results, totalRuns, failCount, moneyBasis }),
                medianDisplay: cards[2].displayValue, p10P90Display: cards[4].displayValue,
                otherBasisLine: cards[2].otherBasisLine }];
        })),
        floorDisplay: valid ? summary[0].displayValue : '—',
        countText: valid ? summary[0].countText : '',
        dots: valid ? Math.min(inventory.ruin > 0 ? 99 : 100, Math.round(inventory.floorCoveragePct)) : null,
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

export function setOverviewBacktestStatus(phase, error = null) {
    backtestPresentation = { phase, error };
    renderInvalidatedBacktestStatus(phase);
    if (['blocked', 'invalid', 'missing', 'skipped', 'technical_error'].includes(phase)) heads.fail('backtest', phase);
    else heads.phase('backtest', phase);
    renderSimulatorOverview();
}
export function setOverviewAutomaticPeriod(period) { automaticPeriod = period; }

export function readOverviewAssumptions(kind, inputs = getCommonInputs(), settings = null) {
    if (settings === null) settings = kind === 'backtest' ? {
        startYear: Number(globalThis.document?.getElementById('simStartJahr')?.value),
        endYear: Number(globalThis.document?.getElementById('simEndJahr')?.value)
    } : { ...readMonteCarloParameters(inputs), useCapeSampling: globalThis.document?.getElementById('useCapeSampling')?.checked === true };
    const values = effectiveRunAssumptions(kind, inputs, settings);
    const planContext = planTrialContextFor(inputs);
    return planContext ? { ...values, planDataContext: planContext } : values;
}

export function observeOverviewAssumptions() {
    if (!globalThis.document?.getElementById('overviewBacktest')) return;
    for (const kind of ['backtest', 'montecarlo']) {
        try { heads.observe(kind, readOverviewAssumptions(kind)); }
        catch { heads.observe(kind, { invalid: true }); }
    }
}

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
export function failOverviewRun(kind, phase = 'error', error = null) {
    heads.fail(kind, phase);
    if (kind === 'backtest') {
        backtestPresentation = { phase, error };
        renderInvalidatedBacktestStatus(phase);
    }
    renderSimulatorOverview();
}
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
    const monthlyPension = inputs.partner?.aktiv
        ? `${money((inputs.renteMonatlich ?? 0) + (inputs.partner.monatsrente ?? 0))} (Haushalt)`
        : money(inputs.renteMonatlich);
    return `<section class="sim-run-head" data-person-profile-ids="${escape(personIds)}"><h4>${kind === 'backtest' ? 'Backtest' : 'Monte-Carlo'}${householdContextChanged(state) ? ' · Veralteter Lauf · Annahmen seitdem geändert' : state.stale ? ' · Annahmen seitdem geändert' : ''}</h4>`
        + (state.last.values.planDataContext?.deviationApplied ? '<p class="ds-source">mit Abweichung vom Plan</p>' : '')
        + renderPersonDataNotice(state.last.values.personDataContext)
        + (meta.household ? field('Gerechnet für', meta.household) : '')
        + field('Zeitraum / Läufe', kind === 'backtest' ? `${settings.startYear}–${settings.endYear}` : `${settings.anzahl} Läufe · ${settings.maxDauer} Jahre · ${settings.methode}`)
        + field('Startvermögen', money(inputs.startVermoegen)) + field('Bedarf pro Jahr · Floor / Flex', `${money(inputs.startFloorBedarf)} / ${money(inputs.startFlexBedarf)}`)
        + field('Mindest-Flex', money(inputs.minimumFlexAnnual)) + field('Rente monatlich', monthlyPension)
        + field('Strategie', inputs.decumulation?.mode ?? 'Standard') + field('Liquiditäts-Runway', `${inputs.liquidityRunwayYears ?? '—'} Jahre`)
        + (Number.isFinite(reserve) ? field('Pflegereserve', money(reserve)) : '')
        + (typeof inputs.pflegefallLogikAktivieren === 'boolean' ? field('Pflege', inputs.pflegefallLogikAktivieren
            ? `${inputs.pflegeModellTyp ?? 'aktiv'} · ${inputs.pflegeMinDauer ?? '—'}–${inputs.pflegeMaxDauer ?? '—'} Jahre` : 'aus') : '')
        + (kind === 'montecarlo' ? field('Stress / Tail-Risk', `${inputs.stressPreset ?? 'NONE'} / ${inputs.tailRiskEnabled ? 'aktiv' : 'aus'}`) : '')
        + (meta.startedAt ? field('Lauf gestartet', new Date(meta.startedAt).toLocaleTimeString('de-DE')) : '') + '</section>';
}

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
    const projection = bt.last ? projectBacktestOverview(bt.last.result) : null;
    const period = bt.last?.values.settings ?? automaticPeriod;
    const contextHost = doc.getElementById('simulatorContextPills');
    if (contextHost) contextHost.innerHTML = (bt.last?.metadata.household ? `<span class="sim-status-chip">Letzter Lauf: ${escape(bt.last.metadata.household)}</span>` : '')
        + (period ? `<span class="sim-status-chip">Backtest ${period.startYear}–${period.endYear}</span>` : '')
        + (householdChanged || householdContextChanged(mc) ? '<span class="sim-status-chip">Annahmen geändert · Veralteter Lauf</span>'
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
        + (projection ? `<p class="sim-outcome-caption">Geldbeträge nominal · Endvermögen inklusive Pflegereserve</p><p class="sim-hero-amount">${money(projection.endWealth)}</p>` : '')
        + (Number.isFinite(projection?.startWealth) ? `<p class="sim-outcome-start">gestartet mit ${money(projection.startWealth)}</p>` : '')
        + (backtestPresentation.phase !== 'completed' ? `<p role="status">${escape(status)}</p>` : '')
        + (error?.name === 'SimulatorValidationError' ? `<p>${escape(error.errors?.[0]?.message ?? error.message)}</p><button class="ds-button ds-button-secondary" type="button" data-overview-field="${escape(error.errors?.[0]?.fieldId ?? '')}">Eingabe in Annahmen korrigieren</button>` : '')
        + (backtestPresentation.phase === 'skipped' ? `<p>${escape(error?.message || '')} · <a href="depot-tranchen-manager.html#personendaten">Geburtsdatum einmal ergänzen</a></p>` : '')
        + (householdChanged ? '<p class="ds-hint">Veralteter Lauf · Annahmen seitdem geändert. Beträge und Belege stammen aus dem bisherigen Lauf.</p>'
            : bt.stale ? '<p class="ds-hint">Annahmen seitdem geändert</p>' : '')
        + '</div>'
        + (projection ? `<div class="ds-kpi-strip sim-outcome-metrics">${field('Entnommen, gesamt', money(projection.withdrawals))}${renderBacktestCutMetric(projection)}${field('Gezahlte Steuern', money(projection.taxes))}</div>` : '')
        + '</div>'
        + (bt.last ? `<p class="sim-backtest-foot">${bt.last.metadata.automatic ? bt.last.metadata.opening ? 'Automatisch gerechnet beim Öffnen' : 'Automatisch neu gerechnet nach Annahmenänderung' : 'Manuell gerechnet'}${bt.last.metadata.startedAt ? ` · Annahmen vom ${escape(new Date(bt.last.metadata.startedAt).toLocaleString('de-DE'))}` : ''}</p>` : '')
        + '<div class="sim-detail-links"><button type="button" class="ds-text-link" data-simulator-tab="backtesting" data-overview-focus="simStartJahr">Zeitraum ändern</button><button type="button" class="ds-text-link" data-simulator-tab="backtesting" data-overview-focus="simulationLog">Jahresprotokoll</button></div>';
    const chartHost = doc.createElement('div');
    overviewChartHosts.set(doc, chartHost);
    chartHost.id = 'overviewPortfolioChart';
    chartHost.className = 'sim-overview-chart';
    chartHost.setAttribute('role', 'region');
    chartHost.setAttribute('aria-label', `${householdChanged ? 'Veralteter Lauf · ' : ''}Portfolioverlauf, Kalenderjahre, ohne Pflegereserve`);
    chartHost.setAttribute('tabindex', '0');
    btHost.insertBefore(chartHost, btHost.querySelector('.sim-backtest-foot') || btHost.querySelector('.sim-detail-links'));
    if (projection) renderThreeBucketPortfolioChart(chartHost, projection.result.rows, { result: projection.result, calendar: true });
    if (projection && householdChanged) {
        const notice = doc.createElement('p');
        notice.textContent = 'Veralteter Portfolioverlauf · bisheriger Lauf';
        chartHost.insertBefore(notice, chartHost.firstChild);
    }
    const crisisHost = doc.getElementById('overviewCrises');
    if (crisisHost) crisisHost.innerHTML = projection ? (householdChanged ? '<p>Veraltete Krisenbelege · bisheriger Lauf</p>' : '') + projection.crises.map(crisis => `<article class="sim-crisis"><div class="sim-card-heading"><h3>${escape(crisis.label)}</h3><p>${crisis.from === crisis.to ? crisis.from : `${crisis.from}–${crisis.to}`}${crisis.status === 'partial' ? ' · Teilfenster' : ''}</p></div><p class="ds-note">Geldbeträge nominal</p>`
        + (crisis.status === 'not_reached' ? '<p>nicht erreicht</p>' : crisis.status === 'missing' ? '<p>Daten fehlen</p>'
            : field(`Tiefster Jahresendstand · ${crisis.minimum.year}`, money(crisis.minimum.total)) + field('Veränderung gegen Start / Vorjahr', crisisPercent(crisis.changePct))
                + field('Flex-Kürzung', crisis.cuts === null ? 'Angaben fehlen' : crisis.cuts === 0 ? 'keine Kürzung ab 10 %' : `${crisis.cuts} Jahre ab 10 % · niedrigste Rate ${percent(crisis.lowestFlexRate)}`)
                + field('Liquidität am Tiefpunkt', money(crisis.minimum.liq))) + '</article>').join('') : '<p>Nach dem Backtest werden die enthaltenen Krisen gezeigt.</p>';
    const mcHost = doc.getElementById('overviewMonteCarlo');
    if (mc.last?.result?.answers) {
        for (const id of ['monteCarloAnswers', 'overviewMonteCarloAnswers']) {
            renderMonteCarloAnswers(doc.getElementById(id), mc.last.result.moneyViews?.[getEuroMode(doc)]?.answers ?? mc.last.result.answers, mc.stale);
        }
    }
    if (mcHost) {
        const base = mc.last?.result;
        const p = base ? { ...base, ...base.moneyViews?.[getEuroMode(doc)] } : null;
        const state = mc.phase === 'idle' ? 'noch nicht gerechnet' : mc.phase === 'preparing'
            ? 'Monte-Carlo wird vorbereitet' : phaseLabels[mc.phase] ?? mc.phase;
        mcHost.innerHTML = `<div class="sim-card-heading"><h2>Reicht das Vermögen?</h2>${info('overviewFloorInfo', 'Erläuterung zur Floor-Deckung', p?.explanation ?? 'Monte-Carlo verwendet viele simulierte Lebens- und Marktpfade. Noch kein Lauf vorhanden.')}</div>`
            + `<p role="status">${escape(state)}${mc.stale ? ' · Annahmen seitdem geändert' : ''}</p>`
            + (p ? `<p class="sim-hero-amount">${escape(p.floorDisplay)}</p>${p.countText ? `<p class="sim-answer-count">${escape(p.countText)}</p>` : ''}<p>Floor-Deckung bis Lebensende oder Horizont</p>`
                + (p.valid ? `<div class="sim-floor-dots" aria-hidden="true">${Array.from({ length: 100 }, (_, i) => `<i${i < p.dots ? ' class="covered"' : ''}></i>`).join('')}</div><p>Ein Punkt ≈ 1 % der Läufe${p.covered < p.denominator && p.floorPct > 99 ? ' · mindestens ein Punkt bleibt ungedeckt' : ''}</p>` : `<p>Finanziell nicht auswertbar · technische Läufe: ${p.technicalRuns ?? '—'}</p>`)
                + `<p>Wilson-95-%-Intervall: ${p.interval ? `${percent(p.interval.lowerPct)}–${percent(p.interval.upperPct)}` : 'nicht verfügbar'}</p>`
                + `<p class="ds-hint sim-price-basis">Endvermögen · ${euroBasisLabel(getEuroMode(doc))}</p>` + field('Endvermögen P10 / P90', p.p10P90Display) + field('Endvermögen Median', p.medianDisplay)
                + '<p>Am Laufende, ohne Pflegereserve</p>' : ['preparing', 'running'].includes(mc.phase) ? '' : '<p>Monte-Carlo wird erst auf deinen Wunsch gestartet.</p>')
            + renderMonteCarloRunControls();
        syncMonteCarloRunControls(doc, !!mc.last);
    }
    for (const [id, state] of [['simBacktestPlanDeviation', bt], ['simMonteCarloPlanDeviation', mc]]) {
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

export function enableOverviewRevisions() { revisionsEnabled = true; }

export function initializeResultOverview({ rerunBacktest, activateTab, runMonteCarlo }, doc = globalThis.document) {
    subscribeEuroMode(doc, scheduleOverviewRefresh);
    if (!doc?.getElementById('overviewBacktest') || bindings.has(doc)) return;
    bindings.add(doc);
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
        if (event.target?.matches?.('input, select') && !event.target.closest('[data-workshop-panel]')) scheduleOverviewRefresh();
    };
    doc.addEventListener('input', changed);
    doc.addEventListener('change', changed);
    doc.addEventListener('click', event => {
        const start = event.target.closest('#mcButton, [data-mc-start]');
        if (start) {
            if (!start.disabled && !doc.getElementById('mcButton')?.disabled) runMonteCarlo?.();
            return;
        }
        const target = event.target.closest('[data-simulator-tab], [data-overview-field]');
        if (!target) return;
        if (target.dataset.simulatorTab) {
            activateTab(target.dataset.simulatorTab);
            const focus = doc.getElementById(target.dataset.overviewFocus);
            if (focus) { if (!focus.hasAttribute('tabindex') && !focus.matches('input, select, button')) focus.setAttribute('tabindex', '-1'); focus.focus(); }
        }
        else {
            const control = doc.getElementById(target.dataset.overviewField);
            activateTab(control?.closest('.tab-panel')?.id?.replace('tab-', '') ?? 'annahmen');
            revealAssumptionControl(control);
        }
    });
    observeOverviewAssumptions();
    renderSimulatorOverview();
}
