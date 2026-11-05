/** @import * as DomTypes from '../../typcheck/dom-elements.js' */
import { runDecisionComparison, comparisonIdentity, comparisonIncomeChoices, comparisonReferenceYear, decisionComparisonRunCount } from './decision-comparison.js';
import { getCommonInputs } from './simulator-portfolio.js';
import { prepareHistoricalDataOnce } from './simulator-engine-helpers.js';
import { readMonteCarloParameters, createMonteCarloUI } from './monte-carlo-ui.js';
import { formatWholeEuro, formatCoveragePercentage } from './results-formatting.js';
import { escapeProtocolHtml as escape } from './protocol-renderer.js';
import { activateSimulatorTab } from './simulator-main-tabs.js';
import { getSimulatorPlanTrial } from './simulator-plan-trial.js';
import { readDocumentPersonInputs } from './simulator-person-overrides.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { runTargetBudgetSearch } from './target-budget-search.js';
import { showSimulatorInputError } from './simulator-input-feedback.js';

const number = value => Number.isFinite(value) ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value) : '—';
const monthLabel = value => `${value.slice(5)}/${value.slice(0, 4)}`;
const signed = (value, unit = '') => value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : '±'}${unit === ' €' ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(Math.abs(value)) : number(Math.abs(value))}${unit}`;
const money = value => Number.isFinite(value) ? formatWholeEuro(value) : '—';
const percentNumber = value => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const targetPct = value => Number.isFinite(value) ? `${percentNumber(value)} %` : '—';
const roundedPct = value => Number.isFinite(value) ? Number(value.toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 })) : null;
const coveragePct = value => {
    const guarded = formatCoveragePercentage(value, value === 100 ? 1 : 0, 1);
    return roundedPct(value) === 100 && guarded.startsWith('>') ? '> 99,99 %' : targetPct(value);
};
const runSetting = params => params.standardRuns > params.anzahl
    ? ` (Einstellung ${number(params.standardRuns)}${params.standardRuns / 10 < 500 ? ', mindestens 500'
        : ` ÷ 10${params.standardRuns / 10 === params.anzahl ? '' : ', auf volle Hundert aufgerundet'}`})` : '';
const runLabel = (params, unit = 'Plan') => `${unit === 'Schritt'
    ? `Suche mit ${number(params.anzahl)} Läufen je Schritt${runSetting(params)} · Endprobe mit ${number(params.standardRuns)} Läufen`
    : `${number(params.anzahl)} Läufe je Plan${runSetting(params)}`} · Seed ${params.seed} · Lauf für Lauf gepaart`;
const reducedRunNote = params => params.standardRuns > params.anzahl
    ? '<p class="ds-note"><small>Die Werte des Ausgangsplans können leicht von der normalen Monte-Carlo-Rechnung abweichen.</small></p>' : '';
const tone = (value, betterHigher = true) => !value ? '' : value > 0 === betterHigher ? 'decision-better' : 'decision-worse';

/**
 * @param result - Laufergebnis.
 * @returns {string}
 */
export function renderTargetBudgetUnreachable(result) {
    const values = (label, monthly, metrics) => `<p>${label}: Wunschbudget ${money(result.floorMonthly + monthly)} pro Monat, davon Wunsch-Flex ${money(monthly)}.
        Grundbedarf gedeckt in ${coveragePct(metrics.coveragePct)} der Läufe (Ziel mindestens ${targetPct(result.goals.coveragePct)}).
        Läufe mit Jahren unter Mindest-Flex: ${Number.isFinite(metrics.affectedPct) ? targetPct(metrics.affectedPct) : 'nicht auswertbar (keine abgeschlossenen Entnahmejahre)'} (Ziel höchstens ${targetPct(result.goals.affectedPct)}).</p>`;
    return `<p class="ds-note">${runLabel(result.params, 'Schritt')}</p>${reducedRunNote(result.params)}<h3>Ziel zwischen Mindest-Flex und heute nicht erreicht</h3><p>Mit keinem Wunschbudget zwischen Mindest-Flex und heute wird das Ziel erreicht. Die Endprobe entfällt.</p>
        ${values('Erreichte Werte heute', result.currentMonthly, result.currentMetrics)}
        ${values('Erreichte Werte an der Untergrenze (Mindest-Flex auf 50 € aufgerundet)', result.lowerMonthly, result.lowerMetrics)}
        <p class="ds-note">Gesucht ab deinem heutigen Wunschbudget. Geprüft wurden die Suchstufen; ein globales Maximum ist nicht garantiert. Mehr dazu im Handbuch unter Zielwertsuche.</p>`;
}

function targetBudgetHighlights(search) {
    const { monthly, currentMonthly, goals, comparison, nextMonthly, nextMetrics, atUpperBound } = search;
    const metrics = comparison.variant.metrics;
    const unconfirmed = search.finalVerification?.status === 'unconfirmed';
    const coverageMissing = nextMetrics && !Number.isFinite(nextMetrics.coveragePct);
    const flexMissing = nextMetrics && !Number.isFinite(nextMetrics.affectedPct);
    const coverageBinds = nextMetrics && (coverageMissing || nextMetrics.coveragePct < goals.coveragePct);
    const flexBinds = nextMetrics && (flexMissing || nextMetrics.affectedPct > goals.affectedPct);
    const binding = unconfirmed ? 'Endprobe verfehlt' : atUpperBound ? 'Suchobergrenze erreicht' : coverageMissing || flexMissing ? 'Kennzahl nicht auswertbar'
        : coverageBinds && flexBinds ? 'Beide Grenzen' : coverageBinds ? 'Grundbedarf' : 'Mindest-Flex';
    const next = unconfirmed ? `Die Endprobe hat keine der ${search.finalVerification.attempts.length} geprüften Stufen bestätigt. Selbst die Untergrenze hält nicht; die Tabelle zeigt ihre verfehlten Endprobenwerte.`
        : atUpperBound ? `Die Suchobergrenze von ${money(search.maximumMonthly)} ist erreicht. Ein höherer Betrag wurde nicht geprüft.`
        : `Mit ${money(search.floorMonthly + nextMonthly)} Wunschbudget pro Monat (davon Wunsch-Flex ${money(nextMonthly)}) wäre das Ziel verfehlt (geprüft mit ${number(search.nextRuns ?? search.params.anzahl)} Läufen): ${[
            coverageMissing ? 'Grundbedarfsdeckung nicht auswertbar' : coverageBinds ? `Grundbedarf gedeckt in ${coveragePct(nextMetrics.coveragePct)} (Ziel mindestens ${targetPct(goals.coveragePct)})` : '',
            flexMissing ? 'Läufe unter Mindest-Flex nicht auswertbar' : flexBinds ? `${targetPct(nextMetrics.affectedPct)} der Läufe mit Jahren unter Mindest-Flex (Ziel höchstens ${targetPct(goals.affectedPct)})` : ''
        ].filter(Boolean).join('; ')}.`;
    const difference = monthly - currentMonthly;
    const verification = unconfirmed ? 'Untergrenze · Endprobe nicht bestätigt'
        : search.finalVerification ? 'Gefunden · Endprobe bestätigt' : 'Gefunden';
    return `<p class="ds-note">Gesucht ab deinem heutigen Wunschbudget.</p><div class="decision-highlights"><div class="${unconfirmed ? '' : 'decision-found'}"><span>${verification}</span><strong>Wunschbudget ${money(search.floorMonthly + monthly)} pro Monat</strong><p class="ds-note">Grundbedarf + Wunsch-Flex, davon Wunsch-Flex ${money(monthly)}. ${difference === 0 ? 'So viel wie heute.' : `${money(Math.abs(difference))} pro Monat ${difference > 0 ? 'mehr' : 'weniger'} als heute.`} Heutige Euro. ${next}</p></div>
        <div><span>Welche Grenze bestimmt den Betrag</span><strong>${binding}</strong><p class="ds-note">Grundbedarf gedeckt: ${coveragePct(metrics.coveragePct)} (Ziel mindestens ${targetPct(goals.coveragePct)}). Läufe mit Jahren unter Mindest-Flex: ${targetPct(metrics.affectedPct)} (Ziel höchstens ${targetPct(goals.affectedPct)}).</p></div></div>`;
}

/**
 * @param result - Laufergebnis.
 * @param [options] - Optionen des Aufrufers.
 * @returns {string}
 */
export function renderDecisionResult(result, { targetSearch = null } = {}) {
    const { change, baseline: { metrics: base }, variant: { metrics: variant }, differences: delta, params } = result;
    const title = change.kind === 'budget' ? `${signed(change.monthly, ' €')} pro Monat Wunschbudget`
        : change.kind === 'expense' ? `Einmalige Ausgabe ${money(change.amount)} im ${monthLabel(change.month)}`
            : `${change.incomeLabel} ${Math.abs(change.months)} Monate ${change.months >= 0 ? 'später' : 'früher'}`;
    const gain = change.kind === 'expense' ? 'Eine Ausgabe bringt keinen Budgetgewinn. Die Tabelle zeigt, was sie kostet.'
        : `Gleiche Höhe, ${Math.abs(change.months)} Monate ${change.months >= 0 ? 'später' : 'früher'}: Die Tabelle zeigt, was die Verschiebung bewirkt.`;
    function displayDelta(key) {
        if (['budgetP10', 'budgetP50', 'wealthP10', 'wealthP50'].includes(key)) {
            const displayed = value => Number.isFinite(value) ? Number(value.toFixed(0)) : null;
            return displayed(base[key]) === null || displayed(variant[key]) === null ? null
                : displayed(variant[key]) - displayed(base[key]);
        }
        if (!key.endsWith('Pct')) return delta[key];
        const displayed = value => key === 'coveragePct' && value < 100 && roundedPct(value) === 100 ? 99.99 : roundedPct(value);
        return displayed(base[key]) === null || displayed(variant[key]) === null ? null
            : Math.round((displayed(variant[key]) - displayed(base[key])) * 100) / 100;
    }
    const difference = (key, unit) => unit === ' Pp' && displayDelta(key) !== null
        ? `${displayDelta(key) > 0 ? '+' : displayDelta(key) < 0 ? '−' : '±'}${percentNumber(Math.abs(displayDelta(key)))}${unit}`
        : signed(displayDelta(key), unit);
    const row = (label, hint, keys, formatter, unit = '', betterHigher = true) => `<tr><th scope="row">${label}<small>${hint}</small></th><td>${keys.map(key => formatter(base[key])).join(' / ')}</td><td>${keys.map(key => formatter(variant[key])).join(' / ')}</td><td>${keys.map(key => `<span class="${tone(displayDelta(key), betterHigher)}">${difference(key, unit)}</span>`).join(' / ')}</td></tr>`;
    return `<div class="decision-heading"><h3>Ergebnis: ${targetSearch ? targetSearch.finalVerification?.status === 'unconfirmed' ? 'Untergrenze ohne bestätigte Endprobe' : 'höchstes Wunschbudget für dein Ziel' : escape(title)}</h3><span class="ds-note">${runLabel(targetSearch?.params ?? params, targetSearch ? 'Schritt' : 'Plan')}</span></div>${targetSearch ? '' : reducedRunNote(params)}
        ${targetSearch ? targetBudgetHighlights(targetSearch) : `<div class="decision-highlights"><div><span>Wo die Änderung schadet</span><strong>${targetPct(result.worsePct)}</strong><p class="ds-note">der Läufe geraten in eine Lage, die dein Plan vermeidet: Grundbedarf nicht gedeckt oder zusätzliche Jahre unter Mindest-Flex.</p></div><div><span>Was sie bringt</span><strong>${change.kind === 'budget' || displayDelta('budgetP50') > 0 ? signed(displayDelta('budgetP50'), ' €') : '—'}</strong><p class="ds-note">${change.kind === 'budget' || displayDelta('budgetP50') > 0 ? `Budgetunterschied pro Jahr im typischen Lauf (P50), in schwachen Läufen (P10) ${signed(displayDelta('budgetP10'), ' €')}.` : escape(gain)}</p></div></div>`}
        <div class="ds-table-box"><table class="ds-table decision-table"><thead><tr><th>Kennzahl</th><th>Ausgangsplan</th><th>${targetSearch ? `mit ${money(targetSearch.floorMonthly + targetSearch.monthly)} Wunschbudget` : 'mit Änderung'}</th><th>Unterschied</th></tr></thead><tbody>
        ${row('Grundbedarf gedeckt', 'Läufe ohne Ruin', ['coveragePct'], coveragePct, ' Pp')}
        ${row('Läufe mit Jahren unter Mindest-Flex', 'mindestens ein Jahr · auswertbare Entnahmejahre', ['affectedPct'], targetPct, ' Pp', false)}
        ${row('Jahre unter Mindest-Flex', 'Median der betroffenen Läufe', ['affectedYears'], number, ' Jahre', false)}
        ${row('Verfügbares Budget P10 / P50', 'Grundbedarf + gezahlter Flex · Median je Lauf', ['budgetP10', 'budgetP50'], money, ' €')}
        ${row('Vermögen am Ende P10 / P50', 'am jeweiligen Laufende', ['wealthP10', 'wealthP50'], money, ' €')}
        </tbody></table></div><div class="decision-actions"><p class="ds-note">Budget pro Jahr und Vermögen am Laufende: heutige Euro. P10 = in 9 von 10 Läufen mindestens so viel. Jede Kennzahl steht für sich.</p><a href="#simPlanTrialStart" data-decision-trial>${targetSearch ? 'Betrag' : 'Änderung'} übernehmen? Im Planversuch ausprobieren →</a></div>`;
}

const bindings = new WeakSet();
/**
 * @param {Document} [doc] - Dokument der Simulatorseite.
 * @returns {void}
 */
export function initDecisionComparison(doc = globalThis.document) {
    const root = doc?.getElementById('decisionComparison');
    if (!root || bindings.has(doc)) return;
    bindings.add(doc);
    /** @template {string} K @param {K} id @returns {DomTypes.SimulatorElement<K> | null} */
    const field = id => /** @type {DomTypes.SimulatorElement<K> | null} */ (doc.getElementById(id));
    let kind = 'budget', busy = false, controller = null, renderedIdentity = null;
    const lifecycle = createNavigationOperationLifecycle({ guard: getPageNavigationGuard(doc) });
    const snapshot = () => {
        const inputs = getCommonInputs();
        const adopted = readDocumentPersonInputs(doc);
        const people = inputs.simulationPeople || [];
        const pensionStarts = (people.length ? people.map(person => adopted?.entries.find(entry => entry.profileId === person.profileId))
            : adopted?.entries || []).map(entry => entry?.data?.profile_rentenbeginn?.slice(0, 7) || null);
        return { inputs, monteCarloParams: readMonteCarloParameters(inputs), useCapeSampling: field('useCapeSampling')?.checked === true,
            pensionStarts, referenceYear: adopted?.context.referenceYear ?? comparisonReferenceYear(inputs) };
    };
    const refresh = () => {
        if (busy) return;
        try {
            const data = snapshot(), choices = comparisonIncomeChoices(data.inputs, data), select = field('decisionIncome');
            const previous = select.value;
            const options = choices.map(entry => `<option value="${escape(entry.id)}">${escape(entry.label)} · ab ${monthLabel(entry.start)}</option>`).join('');
            if (select.innerHTML !== options) { select.innerHTML = options; if (choices.some(entry => entry.id === previous)) select.value = previous; }
            const selected = choices.find(entry => entry.id === select.value), shift = Number(field('decisionMonths').value);
            if (selected && Number.isSafeInteger(shift)) {
                const date = new Date(`${selected.start}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + shift);
                field('decisionIncomeHint').textContent = `neuer Beginn ${monthLabel(date.toISOString().slice(0, 7))} · Höhe wie geplant`;
            } else field('decisionIncomeHint').textContent = selected ? 'Höhe wie geplant' : 'Keine Einkunft zum Verschieben im Plan';
            const params = data.monteCarloParams;
            field('decisionBaseline').textContent = `Wunschbudget ${money((data.inputs.startFloorBedarf + data.inputs.startFlexBedarf) / 12)}/Monat${kind === 'target' ? `, davon Wunsch-Flex ${money(data.inputs.startFlexBedarf / 12)}/Monat` : ''} · Grundbedarf ${money(data.inputs.startFloorBedarf / 12)}/Monat · ${runLabel({ ...params, standardRuns: params.anzahl, anzahl: decisionComparisonRunCount(params.anzahl) }, kind === 'target' ? 'Schritt' : 'Plan')}, ${field('mcMethode').selectedOptions?.[0]?.textContent || params.methode}. Pflege, Stress und Tail-Risk wie eingestellt.`;
            if (!field('decisionExpenseMonth').value) field('decisionExpenseMonth').value = `${data.referenceYear + 4}-06`;
            field('decisionRun').disabled = kind === 'income' && !choices.length;
            field('decisionRun').textContent = kind === 'target' ? 'Suchen' : 'Vergleich rechnen';
            field('decisionRunHint').textContent = kind === 'target'
                ? 'Schnelle Suche ab deinem heutigen Wunschbudget im 50-€-Raster, danach Endprobe mit voller Laufzahl. Bei verfehlter Endprobe mit voller Laufzahl und wachsenden Schritten nach unten, dann Halbierung bis auf 50 € genau. Untergrenze: Mindest-Flex, auf 50 € aufgerundet. Nichts wird gespeichert.'
                : 'Die Änderung wird nicht gespeichert. Zwei gepaarte Rechnungen mit reduzierter Laufzahl und denselben Workern wie Monte Carlo.';
            if (renderedIdentity && renderedIdentity !== comparisonIdentity(data)) {
                field('decisionResult').hidden = true; renderedIdentity = null;
                field('decisionStatus').textContent = 'Plan oder Einstellungen geändert. Bitte Vergleich neu rechnen.';
            }
        } catch (error) { field('decisionBaseline').textContent = error.message; }
    };
    root.querySelectorAll('[data-decision-kind]').forEach(/** @param {HTMLButtonElement} button */ button => button.addEventListener('click', () => {
        if (busy) return;
        kind = button.dataset.decisionKind;
        root.querySelectorAll('[data-decision-kind]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        root.querySelectorAll('[data-decision-fields]').forEach(/** @param {HTMLElement} panel */ panel => { panel.hidden = panel.dataset.decisionFields !== kind; });
        field('decisionResult').hidden = true;
        refresh();
    }));
    doc.addEventListener('input', refresh); doc.addEventListener('change', refresh);
    field('mcViewTabDecision').addEventListener('click', refresh);
    root.addEventListener('input', () => { field('decisionResult').hidden = true; });
    root.addEventListener('change', () => { field('decisionResult').hidden = true; });
    field('decisionCancel').addEventListener('click', () => controller?.abort());
    field('decisionRun').addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        const disabled = new Map();
        try {
            await lifecycle.run({}, async operation => {
                await prepareHistoricalDataOnce();
                const data = snapshot();
                const change = kind === 'target' ? null : kind === 'budget' ? { kind, monthly: field('decisionBudget').value === '' ? NaN : Number(field('decisionBudget').value) }
                    : kind === 'expense' ? { kind, amount: Number(field('decisionExpense').value), month: field('decisionExpenseMonth').value }
                        : { kind, months: field('decisionMonths').value === '' ? NaN : Number(field('decisionMonths').value), incomeId: field('decisionIncome').value,
                            incomeLabel: comparisonIncomeChoices(data.inputs, data).find(entry => entry.id === field('decisionIncome').value)?.label || 'Einkunft' };
                const mcUI = createMonteCarloUI();
                const workerConfig = mcUI.readWorkerConfig();
                mcUI.requireLargeRunConfirmation({ ...data.monteCarloParams, anzahl: kind === 'target'
                    ? data.monteCarloParams.anzahl : decisionComparisonRunCount(data.monteCarloParams.anzahl) });
                busy = true; controller = operation.controller;
                for (const element of [.../** @type {NodeListOf<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>} */ (root.querySelectorAll('input,select,button')), field('mcButton'), field('overviewRunMonteCarlo')].filter(Boolean)) {
                    disabled.set(element, element.disabled); element.disabled = true;
                }
                field('decisionCancel').hidden = false; field('decisionCancel').disabled = false;
                field('decisionProgress').hidden = false; field('decisionResult').hidden = true;
                const started = performance.now();
                const goals = kind === 'target' ? {
                    coveragePct: field('decisionTargetCoverage').value === '' ? NaN : Number(field('decisionTargetCoverage').value),
                    affectedPct: field('decisionTargetAffected').value === '' ? NaN : Number(field('decisionTargetAffected').value)
                } : null;
                const result = await (kind === 'target' ? runTargetBudgetSearch : runDecisionComparison)({ ...data, change, goals, workerConfig, signal: controller.signal,
                    readCurrentIdentity: () => comparisonIdentity(snapshot()), onProgress: (pct, detail) => {
                        field('decisionProgress').setAttribute('aria-valuenow', String(Math.round(pct)));
                        field('decisionProgressBar').style.width = `${pct}%`;
                        field('decisionStatus').textContent = `${detail.comparison} · ${detail.completedRuns || 0} von ${detail.totalRuns ?? decisionComparisonRunCount(data.monteCarloParams.anzahl)} Läufen · ${Math.round(pct)} %`;
                    } });
                field('decisionResult').innerHTML = kind === 'target'
                    ? result.status === 'unreachable' ? renderTargetBudgetUnreachable(result) : renderDecisionResult(result.comparison, { targetSearch: result })
                    : renderDecisionResult(result);
                field('decisionResult').hidden = false;
                renderedIdentity = result.identity;
                field('decisionStatus').textContent = `${kind === 'target' ? 'Zielwertsuche' : 'Vergleich'} fertig · ${number((performance.now() - started) / 1000)} Sekunden`;
            });
        } catch (error) {
            field('decisionResult').hidden = true;
            field('decisionStatus').textContent = controller?.signal.aborted ? `${kind === 'target' ? 'Zielwertsuche' : 'Vergleich'} abgebrochen.`
                : error.message.startsWith('Vergleich nicht möglich') ? error.message : `Vergleich nicht möglich: ${error.message}`;
            if (!controller?.signal.aborted) showSimulatorInputError(doc, error, kind === 'target' ? 'Zielwertsuche' : 'Vergleich');
        } finally {
            busy = false; controller = null;
            disabled.forEach((value, element) => { element.disabled = value; });
            field('decisionProgress').hidden = true; field('decisionCancel').hidden = true;
        }
    });
    root.addEventListener('click', event => {
        if (!/** @type {Element} */ (event.target).closest('[data-decision-trial]')) return;
        event.preventDefault(); activateSimulatorTab('annahmen', { documentRef: doc });
        if (!getSimulatorPlanTrial(doc).read().active) field('simPlanTrialStart').click();
        field('simPlanTrialStart').scrollIntoView({ block: 'center' });
    });
    refresh();
}
