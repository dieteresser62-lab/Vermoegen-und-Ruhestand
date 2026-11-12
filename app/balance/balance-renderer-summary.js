import { renderBalanceMarketPreview } from './balance-market-preview-renderer.js';
import { balanceIncomeDetails, projectBalanceMonthlyFlow } from './balance-monthly-flow.js';
import { renderIncomeDetails, renderMonthlyFlowBar, roundedIncomeDetails } from '../shared/monthly-flow.js';
import { balanceCareSettings } from '../shared/person-data-status.js';
import { effectiveCareFormToday, noCareAllowanceReason } from '../shared/care-benefits.js';
import { careTodayFromRecord } from '../profile/profile-care.js';
import { projectBalanceFlexTrace } from './balance-flex-trace.js';
import { createPlannedPostsView } from './balance-planned-posts-renderer.js';
import { fixedPlannedTotal } from './balance-planned-posts.js';
import { bindBalanceBudgetWhy, renderBalanceStrategyValues } from './balance-presentation-controls.js';
import { householdPlanFieldSpec } from '../shared/household-plan-fields.js';
import { readBalanceInflationSource } from './balance-inflation-source.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { expensesHref } from '../shared/expenses-navigation.js';
import { projectExpenses, readExpensesBudget } from '../expenses/expenses-model.js';
import { loadExpensesStoreResult } from './balance-expenses-storage.js';
import { appNow } from '../shared/app-clock.js';
import { projectBalanceReserves, displayedReserves } from './balance-reserves.js';
import { withAnnualActionProgress } from './annual-action-progress.js';
import { projectAnnualTodoPlan, projectCashRefill, cashRefillPeople, cashRefillMonthlyBase, cashRefillIronReserve } from './annual-todo.js';
import { createTodoPlan, createCashRefill, createPlanDetails } from '../shared/annual-todo-view.js';
import { projectBalanceActionOrigin } from './balance-action-origin.js';
import { overviewScope } from '../overview/overview-storage.js';
import { projectOverviewWithAnnualArchive } from '../overview/overview-model.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { bindCareHintDone, renderCareHint } from '../shared/care-hint.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { personReferenceYear, projectPerson, describePersonDates } from '../profile/profile-person-data.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { displayUp, displayMonthlyUp, displayMonthlyDown, displayActionAmount } from '../shared/display-rounding.js';
/**
 * Module: Balance Renderer Summary
 * Purpose: Renders the high-level summary KPIs (Runway, Liquidity Coverage) and Market Status.
 *          Visualizes the "Traffic Light" system for market regimes.
 * Usage: Used by balance-renderer.js to update the top summary section.
 * Dependencies: balance-utils.js, balance-reader.js
 */
"use strict";

import { UIUtils } from './balance-utils.js';
import { BALANCE_PRESENTATION_OUTPUT_IDS } from './balance-config.js';
import { deriveCompletedCalendarYear } from './balance-annual-period.js';
import { getMarketDataProvenanceViewModel } from './balance-reader.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { createDiagnosisInfo } from './balance-diagnosis-guardrails.js';

/**
 * @param value Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function formatCurrency(value) {
    return UIUtils.formatCurrency(value);
}

/** Ergänzung 2 FR-78: Bedarf gesamt im Monat. Bilden die Bedarfszeilen den Bedarf genau, ist er die Summe der angezeigten Zeilen.
 * @param {any} ui laufendes Jahr @returns {{exact: number|null, shown: number|null}} */
export function shownMonthlyNeed(ui = {}) {
    const input = ui.input || {}, care = ui.careNeeds, finite = Number.isFinite;
    const { grossNeed, householdFlex } = projectBalanceFlexTrace(ui);
    const parts = [finite(input.floorBedarf) ? (care ? care.current.homeFloor : input.floorBedarf) / 12 : null,
        ...(care?.persons || []).filter(person => person.grade > 0).map(person => person.residentialCosts > 0 || person.form === 'residential'
            ? (person.residentialCosts + person.residentialOwnExpenses) / 12 : person.homeCareAddition / 12),
        care && fixedPlannedTotal(input.plannedPosts) > 0 ? fixedPlannedTotal(input.plannedPosts) / 12 : null, householdFlex].filter(finite);
    const shown = parts.length && finite(grossNeed) && Math.abs(parts.reduce((sum, part) => sum + part, 0) - grossNeed) < 0.5
        ? parts.reduce((sum, part) => sum + displayMonthlyUp(part), 0) : displayMonthlyUp(grossNeed);
    return { exact: finite(grossNeed) ? grossNeed : null, shown };
}

/** Angezeigtes Monatsbudget: immer abgerundet (Nutzerregel „Alles was zur Verfügung steht, wird abgerundet“). RD-1d: Regel 4 hebt
 * das Budget nie an; Budget und Bedarf stehen in getrennten Karten. @param {any} overviewUi @returns {number|null} */
export function shownMonthlyBudget(overviewUi = {}) {
    const { budget } = projectBalanceFlexTrace(overviewUi);
    if (!Number.isFinite(budget)) return null;
    const flow = projectBalanceMonthlyFlow(overviewUi);
    return displayMonthlyDown(flow ? flow.euros.budget : /** @type {number} */ (budget));
}

/**
 * @param ui Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function calculateTotals(ui = {}) {
    const num = (value) => (typeof value === 'number' && isFinite(value)) ? value : 0;
    return {
        depotwertGesamt: num(ui.depotwertGesamt),
        neuerBedarf: num(ui.neuerBedarf),
        minGold: num(ui.minGold),
        zielLiquiditaet: num(ui.zielLiquiditaet)
    };
}

/**
 * @param outputs Eingabe für die bestehende Projektion.
 * @param ui Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function renderSummary(outputs = {}, ui = {}) {
    const totals = calculateTotals(ui);
    if (outputs?.depotwert) outputs.depotwert.textContent = UIUtils.formatBalanceCurrency(totals.depotwertGesamt);
    if (outputs?.neuerBedarf) outputs.neuerBedarf.textContent = UIUtils.formatBalanceCurrency(totals.neuerBedarf);
    if (outputs?.minGoldDisplay) outputs.minGoldDisplay.textContent = UIUtils.formatBalanceCurrency(totals.minGold);
    if (outputs?.zielLiquiditaet) outputs.zielLiquiditaet.textContent = UIUtils.formatBalanceCurrency(totals.zielLiquiditaet);
    return totals;
}

/**
 * Renderer für die Kern-KPIs und Zusammenfassungen.
 * Kapselt sämtliche DOM-Zugriffe rund um die Hauptübersicht und validiert Eingaben defensiv.
 */
export class SummaryRenderer {
    /**
     * @param {Object} domRefs - Referenzen auf die benötigten DOM-Knoten.
     * @param {Object} storageManager - Zugriff auf gespeicherte Zustände als Fallback.
     */
    constructor(domRefs, storageManager) {
        this.dom = domRefs;
        this.storageManager = storageManager;
    }

    getPresentationOutput(key) {
        const outputs = this.dom?.outputs;
        const doc = outputs?.balanceMonthlyBudget?.ownerDocument || globalThis.document;
        return outputs?.[key] || doc?.getElementById?.(BALANCE_PRESENTATION_OUTPUT_IDS[key]);
    }

    /**
     * Orchestriert das Rendering der wichtigsten UI-Kacheln.
     *
     * @param {Object} overviewUi - Vorbereitete UI-Daten inklusive Input- und Output-Werten.
     */
    renderOverview(overviewUi = {}) {
        const ui = overviewUi.currentYear || overviewUi;
        const posts = this.getPresentationOutput('balancePlannedPosts');
        if (posts) {
            posts.replaceChildren(); posts.hidden = !ui.input?.plannedPosts;
            if (ui.input?.plannedPosts) posts.appendChild(createPlannedPostsView(posts.ownerDocument, ui.input.plannedPosts));
        }
        this.renderPlanCards(ui, overviewUi);
        this.renderHealthBucket(ui.healthBucketDiagnostics);
        // Defensiver Zugriff: Jeder Bereich wird nur befüllt, wenn die Daten vorhanden sind.
        if (this.dom?.outputs?.depotwert && typeof ui.depotwertGesamt === 'number') {
            this.dom.outputs.depotwert.textContent = UIUtils.formatBalanceCurrency(ui.depotwertGesamt);
        }
        if (this.dom?.outputs?.neuerBedarf && typeof ui.neuerBedarf === 'number') {
            this.dom.outputs.neuerBedarf.textContent = UIUtils.formatBalanceCurrency(ui.neuerBedarf);
        }
        if (this.dom?.outputs?.minGoldDisplay && typeof ui.minGold === 'number') {
            this.dom.outputs.minGoldDisplay.textContent = UIUtils.formatBalanceCurrency(ui.minGold);
        }
        if (this.dom?.outputs?.zielLiquiditaet && typeof ui.zielLiquiditaet === 'number') {
            this.dom.outputs.zielLiquiditaet.textContent = UIUtils.formatBalanceCurrency(ui.zielLiquiditaet);
        }

        // Die Budgetzeile rechnet wie die Budgetkarte mit der Projektion, nicht mit dem laufenden Jahr.
        this.renderEntnahme(overviewUi.spending || {}, projectBalanceMonthlyFlow(overviewUi));
        this.renderMarktstatus(ui.market || {});
    }

    renderBudgetTrace(projection) {
        const host = this.getPresentationOutput('balanceBudgetTrace');
        const button = this.getPresentationOutput('balanceBudgetWhy');
        const available = projection.cut > 0 && projection.rows.length > 0 && Boolean(host);
        bindBalanceBudgetWhy(button, host, available);
        if (!host) return;
        host.replaceChildren();
        if (!available) return;
        const doc = host.ownerDocument || globalThis.document;
        const heading = doc.createElement('h4'); heading.textContent = 'Warum gekürzt?';
        host.appendChild(heading);
        const explanation = doc.createElement('p'); explanation.className = 'ds-hint balance-flex-explanation';
        explanation.textContent = 'Die Treppe zeigt den Flex-Anteil der Vermögensentnahme pro Monat. ';
        if (projection.reason) {
            explanation.textContent += `Kürzungsgrund: ${projection.reason}. `;
        }
        explanation.appendChild(createDiagnosisInfo('Vermögensentnahme und Haushalts-Flex',
            'Der Grundbedarf nach Renten bleibt außerhalb der Treppe. Der finanzierte Haushalts-Flex umfasst zusätzlich den Rentenanteil über dem Grundbedarf. Eine Einschränkung liegt erst vor, wenn der tatsächlich bezahlte Haushalts-Flex einschließlich Rentenbeitrag unter dem angewandten positiven Mindest-Flex liegt.'));
        host.appendChild(explanation);
        for (const row of projection.rows) {
            const node = doc.createElement('div'); node.className = `balance-flex-row balance-flex-${row.kind}`;
            const label = doc.createElement('strong'); label.textContent = row.label;
            const track = doc.createElement('div'); track.className = 'balance-flex-track'; track.setAttribute('aria-hidden', 'true');
            const bar = doc.createElement('i'); bar.style.left = `${row.left}%`; bar.style.width = `${row.width}%`;
            track.appendChild(bar);
            const amount = doc.createElement('span'); amount.className = 'balance-flex-amount';
            const sign = row.kind === 'negative' ? '−' : row.kind === 'positive' ? '+' : '';
            amount.textContent = `${sign}${UIUtils.formatBalanceCurrency(Math.abs(row.value))}`;
            node.append(label, track, amount); host.appendChild(node);
        }
    }

    // Budgetkarte und Einkommensfluss gehören zur Projektion, Bedarfskarten zum laufenden Plan.
    renderBudgetCard(ui) {
        const outputs = this.dom?.outputs || {};
        const input = ui.input || {};
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const currency = UIUtils.formatBalanceCurrency;
        const finite = Number.isFinite;
        const projection = projectBalanceFlexTrace(ui);
        const { income, withdrawal, budget, saving, grossNeed, cut } = projection;
        const dynamic = ui.vpw?.enabled === true;
        const abovePlan = dynamic && grossNeed !== null && budget !== null && budget - grossNeed > 1e-7;
        const { householdFlexRate } = projection;
        const flexRate = formatDisplayNumber(householdFlexRate, { unit: 'percent', ...(householdFlexRate > 100 ? { fractionDigits: 0 } : {}) });
        const flow = projectBalanceMonthlyFlow(ui);
        // FR-78: Monatsbudget abgerundet nach der Monatsstaffel; das Jahr ist der gerundete Monatswert × 12.
        const displayBudget = flow ? flow.euros.budget : budget;
        const shownBudget = shownMonthlyBudget(ui);
        set('balanceMonthlyBudget', displayBudget === null ? '—' : currency(shownBudget));
        if (budget !== null) {
            const unit = document.createElement('span'); unit.className = 'balance-unit'; unit.textContent = '€';
            outputs.balanceMonthlyBudget.replaceChildren(document.createTextNode(currency(shownBudget).slice(0, -1)), unit);
        }
        set('balanceAnnualBudget', budget === null ? 'Noch keine gültige Berechnung.' : `${currency(shownBudget * 12)} im Jahr`);
        const status = readBalancePersonStatus({ referenceYear: input.referenceYear });
        const setFlow = (key, text) => { const host = this.getPresentationOutput(key); if (host) host.textContent = text; };
        set('balanceMonthlyIncome', flow ? currency(flow.euros.income) : '—');
        setFlow('balanceFlowBudget', flow ? currency(shownBudget) : '—');
        setFlow('balanceFlowNeed', '');
        /** @type {(host: HTMLElement, flow: ReturnType<typeof projectBalanceMonthlyFlow>, cut: number, format: (value: number)=>string)=>void} */ (renderMonthlyFlowBar)(this.getPresentationOutput('balanceBudgetBar'), flow, cut, currency);
        const incomeDetails = balanceIncomeDetails(status);
        const matchingIncome = finite(income) && Math.abs(incomeDetails.reduce((sum, item) => sum + item.amount, 0) - income) < .01;
        const surplus = saving > 0;
        setFlow('balanceMonthlySaving', flow ? currency(flow.euros.saving) : '—');
        for (const key of ['balanceFlowSaving', 'balanceFlowSavingSign', 'balanceIncomeSurplusNote']) {
            const host = this.getPresentationOutput(key); if (host) host.hidden = !surplus;
        }
        for (const key of ['balanceFlowWithdrawal', 'balanceFlowWithdrawalSign']) {
            const host = this.getPresentationOutput(key); if (host) host.hidden = surplus && withdrawal === 0;
        }
        set('balanceBudgetCut', cut > 0
            ? finite(householdFlexRate)
                ? `Dein Haushalts-Flex ist zu ${flexRate} finanziert: ${currency(cut)} weniger im Monat, als du planst.`
                : `Dein Monatsbudget liegt ${currency(cut)} unter dem Gesamtbedarf.`
            : abovePlan ? `Dein Flex liegt ${currency(budget - grossNeed)} über dem Plan (Dynamik).`
                : cut === 0 ? 'Dein Haushalts-Flex ist voll finanziert.' : '');
        outputs.balanceBudgetCut?.setAttribute('data-financed', abovePlan ? 'above-plan' : String(cut === 0));
        this.renderBudgetTrace(projection);
        if (surplus && !abovePlan && (!dynamic || cut === 0)) set('balanceBudgetCut', 'Ansparjahr: Einkünfte decken das Budget');
        const pensionHints = [];
        {
            if (status.ready && status.status !== 'demo') {
                for (const entry of status.entries) {
                    const settings = balanceCareSettings(status, entry.profileId), care = careTodayFromRecord(entry.data, settings);
                    const person = projectPerson(entry.data, status.referenceYear, settings);
                    if (care.grade && !person.pflegegeld) {
                        const careHint = document.createElement('p'); careHint.className = 'ds-help';
                        careHint.textContent = `${entry.name}: ${noCareAllowanceReason({ grade: care.grade, careForm: effectiveCareFormToday(care, settings), preset: settings.preset })}`;
                        pensionHints.push(careHint);
                    }
                    if (person.renteMonatlich <= 0) continue;
                    const hint = document.createElement('p'); hint.className = 'ds-help';
                    hint.dataset.pensionStatus = entry.profileId;
                    const name = status.entries.length > 1 ? ` ${entry.name}` : '';
                    const text = describePersonDates(entry.data, status.referenceYear).balancePensionStatus;
                    const namedText = text.startsWith('Rente ') ? text.replace(/^Rente /, `Rente${name} `) : `${name ? `${entry.name} · ` : ''}${text}`;
                    hint.textContent = namedText;
                    pensionHints.push(hint);
                }
            }
        }
        renderIncomeDetails(this.getPresentationOutput('balanceIncomeDetails'),
            roundedIncomeDetails(matchingIncome ? incomeDetails : [], flow?.euros.income ?? 0), currency, pensionHints);
    }

    renderPlanCards(ui, overviewUi = ui) {
        const outputs = this.dom?.outputs || {};
        if (!outputs.balanceMonthlyBudget) return;
        this.renderBudgetCard(overviewUi);
        const input = ui.input || {}, spending = ui.spending || {}, market = ui.market || {};
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const currency = UIUtils.formatBalanceCurrency;
        const finite = Number.isFinite;
        const rows = (key, values) => {
            const host = outputs[key];
            if (!host) return;
            host.replaceChildren();
            const groups = new Map();
            values.forEach(([label, value, unitText, meta, group]) => {
                if (value === null) return;
                let target = host;
                if (group) {
                    if (!groups.has(group)) {
                        const section = document.createElement('section'); section.className = 'household-plan-group';
                        const heading = document.createElement('h4'); heading.textContent = group;
                        section.appendChild(heading); host.appendChild(section); groups.set(group, section);
                    }
                    target = groups.get(group);
                }
                const row = document.createElement('div'); row.className = 'balance-row ds-row';
                const name = document.createElement('span'); name.textContent = label;
                const amount = document.createElement('strong'); amount.textContent = value;
                if (unitText) {
                    const unit = document.createElement('small'); unit.className = 'balance-unit'; unit.textContent = unitText;
                    amount.replaceChildren(document.createTextNode(value.slice(0, -1)), unit);
                }
                if (meta) {
                    if (label.startsWith('Inflation') || label === 'Finanzierter Haushalts-Flex' || /^(Pflege|Heim) /.test(label)
                        || label === householdPlanFieldSpec('floorBedarf').label) {
                        name.appendChild(createDiagnosisInfo(label, meta));
                    } else {
                        const detail = document.createElement('small'); detail.className = 'balance-need-meta'; detail.textContent = meta;
                        amount.appendChild(detail);
                    }
                }
                row.append(name, amount); target.appendChild(row);
            });
        };
        const { grossNeed, householdFlex, financedHouseholdFlex, householdFlexRate } = projectBalanceFlexTrace(ui);
        const dynamic = ui.vpw?.enabled === true;
        const flexRate = formatDisplayNumber(householdFlexRate, { unit: 'percent', ...(householdFlexRate > 100 ? { fractionDigits: 0 } : {}) });
        const planYear = input.referenceYear ?? appNow().getFullYear();
        const planned = ui.input?.plannedPosts;
        const plannedNote = this.getPresentationOutput('balancePlannedExpensesNote');
        if (plannedNote) {
            const fixedTotal = planned?.year === planYear ? fixedPlannedTotal(planned) : 0;
            plannedNote.textContent = `${fixedTotal > 0 ? 'Einmalige geplante' : 'Geplante'} Ausgaben ${planYear}: ${planned?.year === planYear && finite(planned.expenseTotal)
                ? planned.expenseTotal > 0 ? currency(planned.expenseTotal) : 'keine' : !planned ? 'keine' : 'nicht verfügbar'}${fixedTotal > 0 ? ` · feste ${currency(fixedTotal)} im Grundbedarf` : ''} `;
            plannedNote.appendChild(createDiagnosisInfo('Geplante Ausgaben',
                'Einmalige geplante Ausgaben zahlt die App direkt aus dem Vermögen, außerhalb von Grundbedarf, Flex und Monatsbudget. Feste geplante Ausgaben zählen in ihren Monaten zum Grundbedarf und stecken im Monatsbudget.'));
        }
        const state = this.storageManager?.loadState?.();
        const adjustedAge = state?.needsAdjustedForInflationYear || 0;
        const inflationYear = input.referenceYear ?? personReferenceYear(state?.annualPeriodMetadata);
        const inflationNote = finite(input.aktuellesAlter) && finite(input.inflation)
            ? inflationYear > adjustedAge ? 'Bedarfe noch nicht angepasst'
                : inflationYear === adjustedAge && adjustedAge > 0 ? 'Bedarfe bereits angepasst' : null : null;
        const annualInflation = readBalanceInflationSource({ scope: readBalanceHouseholdPlan().scope });
        // FR-73 Punkt 5: Grundbedarf zu Hause und je Person „Pflege“ oder „Heim“, zusammen der nicht kürzbare Bedarf.
        const care = ui.careNeeds;
        // FR-78: Bedarf aufgerundet, Finanzierter Flex und Dynamik-Grenze abgerundet (Monatsstaffel).
        const need = value => currency(displayMonthlyUp(value)), available = value => currency(displayMonthlyDown(value));
        const careRows = (care?.persons || []).filter(person => person.grade > 0).map(person => person.residentialCosts > 0 || person.form === 'residential'
            ? [`Heim ${person.name}`, need((person.residentialCosts + person.residentialOwnExpenses) / 12), '€ / Monat',
                `Heimkosten ${need(person.residentialCosts / 12)} und eigene Ausgaben ${need(person.residentialOwnExpenses / 12)} im Monat · Heimjahr ${person.heimJahr}`
                + (person.residentialSince ? ` (seit ${person.residentialSince.slice(5)}/${person.residentialSince.slice(0, 4)})` : ' (ohne „seit“)') + ` · Zuschuss der Kasse ${formatDisplayNumber(person.subsidy * 100, { fractionDigits: 0 })} %`, 'Plan']
            : [`Pflege ${person.name}`, need(person.homeCareAddition / 12), '€ / Monat',
                // Argon FR73A B4: das ⓘ nennt, womit gerechnet wurde – amtlicher Durchschnitt, eigener Wert oder Staffel.
                `Pflegegrad ${person.grade} zu Hause: ${care.preset === 'amtlich' ? 'Beim amtlichen Durchschnitt gilt die Netto-Konvention (0 € Zusatz, kein Pflegegeld).' : `${Number.isFinite(person.homeCostsMonthly) ? 'eigener Wert „Pflegekosten heute über die Kasse hinaus“' : 'Staffelbetrag des Grads'}, höchstens bis zum Deckel „Maximaler Pflege-Floor“.`}`, 'Plan']);
        // FR-73 Punkt 10: Hinweis bei Pflegegrad heute unter den Bedarfszeilen; „Erledigt“ schreibt den Haushaltsrecord (einmal gebunden).
        const careHint = this.getPresentationOutput('balanceCareHint');
        if (careHint) { renderCareHint(careHint, overviewUi.careHint ?? ui.careHint ?? null); bindCareHintDone(careHint); }
        const shownNeed = shownMonthlyNeed(ui).shown;
        rows('balanceNeedRows', [
            [householdPlanFieldSpec('floorBedarf').label, finite(input.floorBedarf) ? need((care ? care.current.homeFloor : input.floorBedarf) / 12) : null, '€ / Monat',
                [care && care.current.homeFloorFactor < 1 ? `Grundbedarf zu Hause: ${formatDisplayNumber(care.current.homeFloorFactor * 100, { fractionDigits: 0 })} % des Plans, weil nicht alle zu Hause leben` : null,
                    !care && fixedPlannedTotal(input.plannedPosts) > 0 ? `enthält feste geplante Ausgaben von ${need(fixedPlannedTotal(input.plannedPosts) / 12)} im Monatsmittel` : null].filter(Boolean).join(' · ') || null, 'Plan'],
            ...careRows,
            // FR-43: Mit Pflege zeigt der Grundbedarf nur den Anteil zu Hause; die festen Ausgaben stehen in eigener Zeile.
            ...(care && fixedPlannedTotal(input.plannedPosts) > 0 ? [['Feste geplante Ausgaben', need(fixedPlannedTotal(input.plannedPosts) / 12), '€ / Monat',
                'im Monatsmittel, gehören zum Grundbedarf und werden nie gekürzt', 'Plan']] : []),
            [householdPlanFieldSpec('flexBedarf').label, householdFlex === null ? null : need(householdFlex), '€ / Monat',
                dynamic && finite(input.flexBedarf) ? `Dynamik erlaubt bis ${available(input.flexBedarf * 2 / 12)}/Monat` : null, 'Plan'],
            // RD-1c (Regel 4): Erreicht der finanzierte Flex den Wunschbedarf genau, steht er nicht unter dem angezeigten Wunschbedarf.
            ['Finanzierter Haushalts-Flex', financedHouseholdFlex === null ? null : finite(householdFlex) && financedHouseholdFlex >= householdFlex - 0.5
                ? currency(Math.max(displayMonthlyDown(financedHouseholdFlex), displayMonthlyUp(householdFlex))) : available(financedHouseholdFlex),
                '€ / Monat', 'einschließlich Rentenanteil', 'Dieses Jahr'],
            ['Haushalts-Flex finanziert', dynamic && finite(householdFlexRate) ? flexRate : null, null, null, 'Dieses Jahr'],
            [`Inflation · ${annualInflation.year ?? 'Jahr nicht belegt'}`,  finite(input.inflation) ? formatDisplayNumber(input.inflation, { unit: 'percent' }) : null, null, [annualInflation.source, inflationNote].filter(Boolean).join(' · '), 'Dieses Jahr']
        ]);
        set('balanceNeedTotal', currency(shownNeed));
        const floor = input.floorBedarf;
        const pension = input.renteAktiv ? input.renteMonatlich * 12 : 0;
        set('balanceFloorCoverage', finite(floor) && finite(pension)
            ? floor <= 0 || pension >= floor ? 'Grundbedarf durch Renten gedeckt.'
                : `Grundbedarf zu ${formatDisplayNumber(pension / floor * 100, { fractionDigits: 0 })} % durch Renten gedeckt.` : '');
        // Die bestehende Profilzusammenfassung enthält Vermögen, keinen Profilbedarf.
        const needProfiles = outputs.balanceNeedProfiles;
        if (needProfiles) { needProfiles.replaceChildren(); needProfiles.hidden = true; }
        set('balanceActionCoverage', finite(overviewUi.liquiditaet?.deckungNachher)
            ? ` Danach ${formatDisplayNumber(overviewUi.liquiditaet.deckungNachher, { unit: 'percent',
                fractionDigits: overviewUi.liquiditaet.deckungNachher > 100 ? 0 : 1 })} des Ziels.` : '');
        rows('balanceMarketFacts', [
            ['Abstand zum Allzeithoch', finite(market.abstandVomAthProzent) ? formatDisplayNumber(market.abstandVomAthProzent, { unit: 'percent' }) : null],
            ['Seit dem Hoch', finite(input.jahreSeitAth) ? formatDisplayNumber(input.jahreSeitAth, { unit: 'years' }) : null],
            ['CAPE (Shiller)', finite(input.marketCapeRatio) ? formatDisplayNumber(input.marketCapeRatio) : null]
        ]);
        // Projektion der bereits bestimmten Engine-Phase, keine neue Marktentscheidung.
        const phases = ['peak_hot', 'peak_stable', 'recovery', 'corr_young', 'side_long', 'recovery_in_bear', 'bear_deep'];
        const scale = outputs.balanceMarketScale;
        if (scale) {
            scale.replaceChildren();
            phases.forEach((phase, index) => {
                const segment = document.createElement('span'); segment.className = `balance-market-segment phase-${index}`;
                if (market.sKey === phase) segment.className += ' active';
                segment.title = { peak_hot: 'Markt heiß gelaufen', peak_stable: 'Stabiler Höchststand', recovery: 'Bestätigte Erholung', corr_young: 'Junge Korrektur', side_long: 'Seitwärts Lang', recovery_in_bear: 'Erholung im Bärenmarkt', bear_deep: 'Tiefer Bär' }[phase]; scale.appendChild(segment);
            });
        }
        const tint = ['peak_stable', 'recovery'].includes(market.sKey) ? 'good' : market.sKey === 'bear_deep' ? 'bad' : market.sKey ? 'warn' : null;
        const marketCard = scale?.closest?.('.ov-mkt');
        for (const tone of ['good', 'warn', 'bad']) {
            marketCard?.classList.toggle('market-' + tone, tone === tint);
            outputs.balanceOverview?.classList.toggle('climate-' + tone, tone === tint && market.sKey !== 'peak_hot');
        }
        const alarm = ui.balanceAlarmActive === true;
        if (outputs.balanceMarketAlarm) outputs.balanceMarketAlarm.hidden = !alarm;
        set('balanceMarketAlarmText', alarm ? (spending.anmerkung || 'Die vorhandenen Leitplanken begrenzen den flexiblen Bedarf. Details stehen in der Diagnose.') : '');
        this.renderContext(input, overviewUi);
    }

    /** FR-77: Karte „Was zu tun ist“. Oben der Plan aus dem Jahresabschluss mit Status; ohne Beleg ein Satz in neuer Sprache.
     * Der Dialog „Details & Drucken“ zeigt im Planmodus genau diesen Beleg. */
    renderAnnualAction(origin, people = []) {
        const host = this.getPresentationOutput('balanceAnnualAction');
        if (!host) return;
        host.replaceChildren();
        const doc = host.ownerDocument || globalThis.document;
        const chip = this.dom?.outputs?.balanceActionPeriod || doc.getElementById?.('balanceActionPeriod');
        const confirmed = origin.confirmed;
        const plan = confirmed ? projectAnnualTodoPlan({ confirmed, people: confirmed.people || people }) : null;
        this.todoPlan = plan;
        this.planDetails = null;
        if (chip) { chip.hidden = !plan; chip.textContent = plan ? `Plan ${plan.year}` : ''; }
        if (plan) {
            host.appendChild(createTodoPlan(doc, plan));
            if (/Beispieldaten.*Spielbereich|Spielbereich.*Beispieldaten/.test(confirmed.action?.title || '')) {
                const marker = doc.createElement('small'); marker.className = 'ds-source'; marker.textContent = 'Spielbereich · Beispieldaten'; host.append(marker);
            }
            this.planDetails = createPlanDetails(doc, plan, confirmed.action, confirmed.people || people);
        } else {
            const text = doc.createElement('p'); text.className = 'todo-empty';
            text.textContent = `Noch keine Handlungsanweisung aus dem Jahresabschluss. Den Plan beschließt du im Jahresabschluss Anfang ${origin.previewYear + 1}; bis dahin zeigt die Vorschau unten, was die App heute vorschlagen würde.`;
            host.appendChild(text);
            if (origin.notice) {
                const notice = doc.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = origin.notice; host.appendChild(notice);
            }
        }
        const planHost = doc.getElementById?.('balancePlanDetails');
        if (planHost) planHost.replaceChildren(...(this.planDetails ? [this.planDetails.root] : []));
    }

    /** FR-77 Punkt 3: „Tagesgeld auffüllen“, je Person mit dem Tagesgeldziel des Routings. Nur ohne offenen Planverkauf.
     * @param {any} currentYear Laufendes Jahr (Eingaben, Entnahme, Personeneinträge). @param {{trial?: boolean}} [options] */
    renderCashRefill(currentYear = {}, { trial = false } = {}) {
        const doc = globalThis.document;
        const host = doc?.getElementById?.('balanceCashRefill');
        if (!host) return null;
        host.replaceChildren();
        const plan = this.todoPlan;
        const planOpen = Boolean(plan && (plan.status === 'offen' || plan.status === 'teilweise'));
        let refill = null;
        try {
            refill = trial ? null : projectCashRefill({ people: cashRefillPeople(currentYear, () => loadProfileRegistry().value, persistenceStorage.getItem('rs_current_profile')),
                monthlyBase: cashRefillMonthlyBase(currentYear), cashMonths: currentYear.input?.liquidityCashMonths, planOpen,
                ironReserve: cashRefillIronReserve(currentYear) });
        } catch { refill = null; }
        host.hidden = !refill;
        if (refill) host.appendChild(createCashRefill(doc, refill));
        if (refill && plan?.status === 'erledigt') {
            const rest = doc.createElement('p'); rest.className = 'ds-source'; rest.textContent = 'Sonst ist bis zum Jahresabschluss nichts zu tun.'; host.appendChild(rest);
        }
        return refill;
    }

    renderBudgetOrigin(model, ui) {
        const year = appNow().getFullYear();
        const comparison = model.planComparison;
        const plan = comparison?.recordStatus === 'valid' && comparison.year === year
            && comparison.confirmedAction?.year === year && model.summary?.status === 'fest'
            && model.summary.year === year ? model.summary : null;
        const preview = projectBalanceFlexTrace(ui);
        const date = appNow().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        for (const [previewKey, planKey, field, amount] of [
            ['balanceBudgetPreview', 'balanceBudgetPlan', 'monthlyBudget', ui.nextYearBudget?.rule?.monthlyBudget ?? preview.budget]
        ]) {
            const label = this.getPresentationOutput(previewKey);
            if (label) { label.hidden = false; label.textContent = ui.nextYearBudget?.rule
                ? `Budget ${ui.nextYearBudget.targetYear} · Projektion mit heutigen Werten` : `Vorschau heute · ${date}`; }
            const host = this.getPresentationOutput(planKey);
            if (!host) continue;
            host.replaceChildren(); host.hidden = !plan;
            if (!plan) continue;
            const doc = host.ownerDocument || globalThis.document;
            const origin = doc.createElement('span'); origin.className = 'ds-source'; origin.textContent = comparison.planLabel;
            // FR-78: Plan und Vorschau abgerundet wie das Monatsbudget; die Differenz ergibt sich aus den gezeigten Beträgen.
            const shownPlan = displayMonthlyDown(plan[field]), shownAmount = Number.isFinite(amount) ? shownMonthlyBudget(ui) : null;
            const value = doc.createElement('strong'); value.textContent = UIUtils.formatBalanceCurrency(shownPlan);
            const delta = doc.createElement('span'); delta.className = 'ds-source';
            const diff = Number.isFinite(shownAmount) && Number.isFinite(shownPlan) ? shownAmount - shownPlan : null;
            delta.textContent = diff === null ? 'Differenz nicht verfügbar'
                : `Differenz ${diff < 0 ? '−' : diff > 0 ? '+' : ''}${UIUtils.formatBalanceCurrency(Math.abs(diff))}`;
            // Ergänzung 2 FR-78: „Warum anders als …“ nur, wenn die angezeigte Differenz nicht 0 ist.
            const reasons = this.getPresentationOutput('balanceBudgetReasons') || doc.getElementById?.('balanceBudgetReasons');
            if (reasons && diff === 0) reasons.hidden = true;
            host.append(origin, value, delta);
        }
        const withdrawalPlan = this.getPresentationOutput('balanceWithdrawalPlan');
        if (withdrawalPlan) {
            const different = plan && Number.isFinite(plan.monthlyWithdrawal)
                && Math.round(plan.monthlyWithdrawal) !== projectBalanceMonthlyFlow(ui)?.euros.withdrawal;
            withdrawalPlan.hidden = !different;
            withdrawalPlan.textContent = different ? `Plan ${plan.year} aus dem Vermögen: ${UIUtils.formatBalanceCurrency(plan.monthlyWithdrawal)}/Monat` : '';
        }
    }

    renderContext(input = {}, ui = {}) {
        const outputs = this.dom?.outputs || {};
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const targetYear = deriveCompletedCalendarYear(appNow());
        renderBalanceStrategyValues(globalThis.document, { ...input, ...ui.marketPreview?.stored?.inputs }, targetYear);
        renderBalanceMarketPreview(globalThis.document, ui.marketPreview || null, ui.nextYearBudget || null);
        const state = this.storageManager?.loadState?.();
        const metadata = state?.annualPeriodMetadata;
        const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)]));
        const model = /** @type {import('../../typcheck/balance-ui.js').ProjectOverviewWithArchive} */ (projectOverviewWithAnnualArchive)({ registry: loadProfileRegistry().value, activeId: persistenceStorage.getItem('rs_current_profile'), liveData,
            balanceSingleFallback: true, recovery: Boolean(globalThis.window?.__profileRecoveryBlocker) }, { onChange: () => this.renderContext(input, ui) });
        this.renderBudgetOrigin(model, ui);
        const annualState = model.occasion?.annualState;
        const notApplicable = annualState === 'not_applicable';
        set('balancePlanningYear', String(targetYear + 1));
        // Der Berechnungsumfang steht einmal im Suite-Kopf. Die Auswahlprojektion
        // liefert den frühen Lade-/Recoveryzustand; die Summary den Rechenumfang.
        const profiles = globalThis.window?.__profilverbundProfileSummaries;
        const scopeHost = outputs.balanceScopeText || globalThis.document?.getElementById?.('suiteHouseholdContext');
        if (scopeHost) {
            const scope = globalThis.window?.__profileRecoveryBlocker ? 'nicht verfügbar'
                : Array.isArray(profiles) && profiles.length > 0
                    ? `Haushalt · ${profiles.map(profile => profile.name || profile.profileId).join(' + ')}`
                    : input.profilName ? `aktives Profil · ${input.profilName}` : 'aktives Profil';
            scopeHost.textContent = `Berechnet für: ${scope}`;
        }
        set('balancePlanningYearPill', String(targetYear + 1));
        const expensesHost = outputs.balanceExpensesSummary || globalThis.document?.getElementById?.('balanceExpensesSummary');
        if (expensesHost) {
            const year = targetYear + 1;
            expensesHost.setAttribute('href', expensesHref({ year }));
            try {
                const registry = loadProfileRegistry().value;
                const ids = model.scope?.ids || [];
                const receiptScope = overviewScope(ids.some(id => registry?.profiles[id]?.meta.belongsToHousehold !== false) ? 'household' : 'single', ids);
                const budget = readExpensesBudget({ year, scope: model.scope, receiptScope, registry, activeId: model.activeId, storage: persistenceStorage });
                const result = loadExpensesStoreResult(persistenceStorage);
                if (result.status === 'corrupt') throw new Error('Ausgaben nicht lesbar');
                const people = (model.scope?.ids || []).map(id => ({ id }));
                const view = /** @type {(options: Omit<Parameters<typeof projectExpenses>[0], "firstPlanningYear"> & {firstPlanningYear?: number})=>ReturnType<typeof projectExpenses>} */ (projectExpenses)({ store: result.store, year, people, budget, now: appNow() });
                expensesHost.textContent = `Ausgaben bisher ${view.hasData ? UIUtils.formatBalanceCurrency(view.stats.annualUsed) : '— (noch keine Imports)'} von ${view.annualBudget === null ? '— (Budget nicht verfügbar)' : UIUtils.formatBalanceCurrency(view.annualBudget)} · ${year} →`;
            } catch { expensesHost.textContent = `Ausgaben ${year} nicht sicher lesbar · Ausgaben öffnen →`; }
        }

        const firstYearText = `Erstes Planungsjahr ${model.firstPlanningYear} · erster Jahresabschluss Anfang ${model.firstPlanningYear + 1}`;
        const origin = model.actionOrigin || projectBalanceActionOrigin({ comparison: model.planComparison, year: targetYear + 1, scope: model.scope, occasion: model.occasion });
        this.actionOrigin = withAnnualActionProgress(origin, () => loadProfileRegistry().value, model.scope?.ids); // Umsetzungsstand FR-77
        this.renderAnnualAction(this.actionOrigin, model.members);
        // Vorschau aufs nächste Jahr nur als zugeklappte Zeile (FR-77 Punkt 4).
        const previewTitle = outputs.balanceActionPreviewTitle || globalThis.document?.getElementById?.('balanceActionPreviewTitle');
        // WT-1b: Die Vorschau zeigt den Plan, den der nächste Jahresabschluss beschließt: „Jahr J abschließen“ beschließt den Plan J+1.
        if (previewTitle) previewTitle.textContent = `Vorschau auf den Plan ${origin.previewYear + 1}`;
        const disclaimer = this.getPresentationOutput('balanceActionDisclaimer');
        if (disclaimer) disclaimer.textContent = `So sähe der Plan aus, wenn heute der 31.12. wäre. Verbindlich wird er erst im Jahresabschluss im Januar.${notApplicable ? ` ${firstYearText}.` : ''}`;
        for (const [id, offset] of /** @type {[string, number][]} */ ([['endeVJ', 0], ['endeVJ_1', 1], ['endeVJ_2', 2], ['endeVJ_3', 3]])) {
            const label = globalThis.document?.querySelector?.(`label[for="${id}"]`);
            if (label) label.textContent = `Ende ${targetYear - offset}`;
        }
        const marketView = getMarketDataProvenanceViewModel(state?.annualMarketDataMeta);
        set('balanceMarketSource', ui.marketPreview?.quote
            ? `Vorschau nach Regel · VWCE.DE · Schlusskurs ${ui.marketPreview.quote.asOf.split('-').reverse().join('.')}`
            : `Jahresmarktdaten · ${marketView.available ? `${marketView.instrument} · ${marketView.asOf} · ${marketView.source}` : 'Quelle und Stand noch nicht bestätigt.'}`);
        set('balanceMarketDate', marketView.available && /^\d{4}-\d{2}-\d{2}$/.test(marketView.asOf) ? marketView.asOf.split('-').reverse().join('.') : 'nicht verfügbar');
        const recovery = annualState === 'recovery' || Boolean(metadata?.pendingCommit);
        if (outputs.balanceBudgetChips) {
            const chip = outputs.balanceBudgetChips.querySelector?.('[data-period-chip]') || document.createElement('p');
            chip.className = 'ds-help balance-period-status';
            chip.textContent = notApplicable ? firstYearText : annualState === 'done' ? `Jahr ${targetYear} abgeschlossen`
                : recovery ? 'Recovery erforderlich' : annualState === 'open' ? `vorläufig · bis zum Jahresabschluss ${targetYear}` : 'Jahresstatus ungeklärt';
            chip.setAttribute('data-period-chip', '');
            if (!chip.parentNode) outputs.balanceBudgetChips.appendChild(chip);
        }
        const recoveryText = recovery ? metadata?.pendingCommit ? `Jahresabschluss ${metadata.pendingCommit.periodId} unterbrochen. Bitte zuerst den Recovery-Snapshot ${metadata.pendingCommit.snapshotId} unter Bedarf & Strategie → Snapshots wiederherstellen.` : 'Bitte zuerst die vorhandene Wiederherstellung verwenden.' : '';
        if (outputs.balanceAnnualRecovery) { outputs.balanceAnnualRecovery.hidden = !recovery; outputs.balanceAnnualRecovery.textContent = recoveryText; }
    }

    /**
     * Rendert die UI zur Inflationsanpassung der Bedarfe.
     *
     * @param {Object} inputData - Aktuelle Eingabedaten.
     * @param {Object} persistentState - Persistenter Zustand aus dem Storage.
     */
    renderBedarfAnpassungUI(inputData = {}, persistentState = {}) {
        const container = this.dom?.containers?.bedarfAnpassung;
        if (!container) return;

        const currentAge = inputData.referenceYear ?? personReferenceYear(persistentState.annualPeriodMetadata);
        const lastAdjustedAge = persistentState.needsAdjustedForInflationYear || 0;
        const inflation = inputData.inflation;

        let content = '';
        if (typeof currentAge === 'number' && typeof inflation === 'number' && currentAge > lastAdjustedAge) {
            // Ein neues Jahr, eine Anpassung steht an
            const formattedInflation = formatDisplayNumber(inflation, { unit: 'percent' });
            content = `<span>Fortschreibung der Bedarfe um ${formattedInflation} erfolgt im Jahresabschluss.</span>`;
        } else if (typeof currentAge === 'number' && currentAge === lastAdjustedAge && lastAdjustedAge > 0) {
            // Anpassung für dieses Alter ist bereits erfolgt
            content = `<small style="color: var(--success-color);">✓ Bedarfe für Planungsjahr ${currentAge} sind aktuell.</small>`;
        }

        container.innerHTML = content;
    }

    /** Reserven verwenden genau die für Karte und Spieleintragung vorbereiteten Aktionen. */
    renderReserves(ui = {}, entries = [], options = {}) {
        const view = projectBalanceReserves(ui, entries, options), input = ui.input || {};
        const doc = globalThis.document;
        const get = key => this.getPresentationOutput(key);
        const set = (key, value) => { const host = get(key); if (host) host.textContent = value; };
        const money = UIUtils.formatBalanceCurrency;
        const make = (tag, text, cls) => { const node = doc.createElement(tag); node.textContent = text; if (cls) node.className = cls; return node; };
        // Ergänzung 2 FR-78: Folgewerte aus angezeigten Beträgen. Der Zufluss ist die Summe der angezeigten offenen Planzeilen,
        // wenn die Änderung genau diesem Rest entspricht; Tagesgeldziel = Summe der angezeigten Personenziele.
        const targets = view.targets.filter(row => Number.isFinite(row.target));
        const exactTarget = targets.length ? targets.reduce((sum, row) => sum + row.target, 0) : null;
        const openRows = (this.todoPlan?.rows || []).filter(row => row.restNet > 0);
        const delta = view.after && Number.isFinite(view.before.liquidity) ? view.after.liquidity - view.before.liquidity : NaN;
        // RD-1c: Ein Kauf ohne Planzeilen fließt mit dem angezeigten (abgerundeten) Betrag ab.
        const purchase = !this.todoPlan?.rows?.length && this.todoPlan?.purchases?.length && Number.isFinite(this.todoPlan.amount)
            && Math.abs(delta + this.todoPlan.amount) < 1 ? -displayActionAmount(this.todoPlan.verb, this.todoPlan.amount) : null;
        const inflow = openRows.length && Math.abs(delta - openRows.reduce((sum, row) => sum + row.restNet, 0)) < 1
            ? openRows.reduce((sum, row) => sum + displayUp(row.restNet), 0) : purchase;
        const shown = displayedReserves(view, { cashTarget: exactTarget, shownCashTarget: targets.length ? targets.reduce((sum, row) => sum + displayUp(row.target), 0) : null,
            inflow, liquidityTarget: view.target });
        const values = get('balanceReserveValues');
        if (values) {
            values.replaceChildren();
            const value = (label, amount, after = false) => {
                const block = make('div', '');
                block.append(make('div', label, 'ds-source'), make('div', money(amount), 'balance-card-number' + (after ? ' balance-reserve-after-value' : '')));
                return block;
            };
            values.append(value('Liquidität heute', view.before.liquidity));
            // FR-78: „heute“ ist ein Kontostand und bleibt genau; „nach Umsetzung“ entsteht aus den angezeigten Beträgen und kann über dem genauen Wert liegen.
            if (view.after) values.append(make('span', '→', 'balance-reserve-arrow'), value('nach Umsetzung', shown.after.liquidity, true));
        }
        const parts = get('balanceReserveParts');
        if (parts) {
            parts.replaceChildren(); parts.setAttribute('data-proposal', String(Boolean(view.after)));
            for (const [label, key] of [['Tagesgeld', 'tagesgeld'], ['Geldmarkt', 'geldmarkt']]) {
                parts.append(make('span', label, 'ds-source'), make('strong', money(view.before[key])));
                if (view.after) parts.append(make('span', '→', 'ds-source'), make('strong', money(shown.after[key])));
            }
        }
        // WT-1 (Gutachten GU1B-FABLE Befund 2): Ein eingetragener Verkauf mit offener Gutschrift fehlt heute im Tagesgeld und gilt
        // im Plan schon als verkauft. „Nach Umsetzung“ enthält ihn deshalb nicht; ein Satz nennt den Grund.
        const creditNote = doc?.getElementById?.('balanceReserveCreditNote');
        if (creditNote) {
            const pending = Number.isFinite(options.creditPendingNet) ? options.creditPendingNet : 0;
            creditNote.hidden = !(pending >= 0.5);
            creditNote.textContent = pending >= 0.5 ? `Ohne die offene Gutschrift von ${money(pending)}: Der Erlös ist verkauft, aber noch nicht im Tagesgeld. Nach dem Nachtragen steigt die Liquidität um diesen Betrag.` : '';
        }
        const months = Number.isFinite(input.liquidityRunwayYears) ? input.liquidityRunwayYears * 12 : null;
        const number = value => formatDisplayNumber(value, { fractionDigits: 0 });
        // FR-78: Ziele werden aufgerundet; die Summe der Tagesgeldziele ist die Summe der angezeigten Ziele.
        set('balanceReserveTarget', `Ziel: ${number(months)} Monate Entnahme = ${money(displayUp(view.target))}, davon ${number(input.liquidityCashMonths)} Monate im Tagesgeld`);
        set('balancePersonalCashTargets', targets.length > 1
            ? `Tagesgeldziel: ${targets.map(row => `${row.name || 'Person'} ${money(displayUp(row.target))}`).join(' · ')} · Summe ${money(targets.reduce((sum, row) => sum + displayUp(row.target), 0))}` : '');
        const coverage = amount => Number.isFinite(amount) && view.target > 0 ? amount / view.target * 100 : null;
        const today = coverage(view.before.liquidity), after = view.after ? coverage(view.after.liquidity) : null;
        const pct = value => formatDisplayNumber(value, { unit: 'percent', fractionDigits: 0 });
        const label = `heute ${pct(today)} gedeckt${view.after ? ` · nach Umsetzung ${pct(after)}` : ''}`;
        const bar = get('balanceReserveBar');
        const scale = Math.max(120, today || 0, after || 0);
        if (bar) bar.setAttribute('aria-label', `${label} · Ziel 100 %`);
        for (const [key, percent] of /** @type {[string, number][]} */ ([['liquiditaetBalken', today], ['balanceReserveAfterBar', after], ['balanceReserveGoalMark', 100]])) {
            const node = get(key); if (!node) continue;
            if (key === 'balanceReserveAfterBar') node.hidden = !view.after;
            node.style[key === 'balanceReserveGoalMark' ? 'left' : 'width'] = `${Math.max(0, percent || 0) / scale * 100}%`;
        }
        const labels = get('balanceReserveCoverage');
        if (labels) {
            const goal = make('span', 'Ziel', 'balance-reserve-goal-label');
            goal.style.left = `${100 / scale * 100}%`;
            labels.replaceChildren(make('span', `heute ${pct(today)} gedeckt`), goal);
            if (view.after) labels.append(make('span', `nach Umsetzung ${pct(after)}`, 'balance-reserve-after-label'));
        }
        const runway = amount => Number.isFinite(amount) && Number.isFinite(ui.spending?.monatlicheEntnahme)
            ? ui.spending.monatlicheEntnahme > 0 ? amount / ui.spending.monatlicheEntnahme : Infinity : null;
        const range = amount => formatDisplayNumber(runway(amount), { allowInfinity: true, fractionDigits: 0 });
        const reach = get('balanceReserveRunway');
        if (reach) reach.replaceChildren(make('span', 'Reichweite'), make('strong', `${range(view.before.liquidity)}${view.after ? ` → ${range(view.after.liquidity)}` : ''} Monate`));
        const gold = input.goldAktiv === true || input.goldWert > 0;
        const rows = get('balanceReserveRows');
        if (rows) { rows.replaceChildren(); if (gold) { const row = make('div', '', 'balance-row ds-row'); row.append(make('span', 'Gold-Bestand'), make('strong', money(input.goldWert))); rows.append(row); } }
        const minGold = doc?.getElementById?.('minGoldRow'); if (minGold) minGold.hidden = !gold;
    }

    renderHealthBucket(diagnostics = null) {
        const container = this.dom?.outputs?.healthBucketSummary;
        if (!container) return;
        container.replaceChildren();
        if (!diagnostics?.enabled) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'grid';
        const makeItem = (label, value, meta = '') => {
            const item = document.createElement('div');
            item.className = 'health-bucket-item ds-metric';
            const labelEl = document.createElement('span');
            labelEl.className = 'label';
            labelEl.textContent = label;
            const valueEl = document.createElement('strong');
            valueEl.textContent = value;
            item.append(labelEl, valueEl);
            if (meta) {
                const metaEl = document.createElement('small');
                metaEl.textContent = meta;
                item.append(metaEl);
            }
            return item;
        };

        const coverage = diagnostics.targetCoveragePct === null
            ? formatDisplayNumber(null, { applicable: false, reason: 'kein positiver Zielbetrag' })
            : formatDisplayNumber(diagnostics.targetCoveragePct, { unit: 'percent', fractionDigits: 0 });
        container.append(
            makeItem('Pflegebucket', UIUtils.formatBalanceCurrency(diagnostics.lockedAmount), `Ziel: ${UIUtils.formatBalanceCurrency(diagnostics.targetInflationAdjusted)}`),
            makeItem('Operative Liquidität', UIUtils.formatBalanceCurrency(diagnostics.operativeLiquidity), `Brutto: ${UIUtils.formatBalanceCurrency(diagnostics.grossLiquidity)}`),
            makeItem('Zieldeckung', coverage, diagnostics.targetGap > 0 ? `Lücke: ${UIUtils.formatBalanceCurrency(diagnostics.targetGap)}` : 'Ziel gedeckt')
        );
        const policy = document.createElement('div');
        policy.className = 'health-bucket-policy';
        policy.textContent = diagnostics.releaseReason || 'Keine automatische Pflegebucket-Freigabe in Balance.';
        container.appendChild(policy);
        if (diagnostics.warning) {
            const warning = document.createElement('div');
            warning.className = 'health-bucket-warning ds-note ds-note-warning';
            warning.textContent = diagnostics.warning;
            container.appendChild(warning);
        }
    }

    /**
     * Stellt Entnahme-Informationen dar und blendet optionale Details ein.
     *
     * @param {Object} spending - Daten zur geplanten Entnahme.
     */
    renderEntnahme(spending = {}, flow = null) {
        if (!this.dom?.outputs?.monatlicheEntnahme) return;

        const monatlicheEntnahme = flow ? flow.euros.withdrawal : spending.monatlicheEntnahme;
        this.dom.outputs.monatlicheEntnahme.replaceChildren(document.createTextNode(
            Number.isFinite(monatlicheEntnahme) ? UIUtils.formatBalanceCurrency(monatlicheEntnahme) : '—'));

    }

    /**
     * Rendert den Marktstatus als Ampel-Karte.
     *
     * @param {Object} market - Szenario-Informationen des aktuellen Marktregimes.
     */
    renderMarktstatus(market = {}) {
        if (!this.dom?.outputs?.marktstatusText || !market.szenarioText) return;

        // Determine traffic-light status based on scenario.
        // Design decision: We avoid zusätzliche Icons und setzen nur auf den farbigen Rahmen,
        // damit die Kennzahl ruhiger wirkt und sich in die kompakte UI einfügt.
        const scenario = market.szenarioText || '';
        let statusClass = 'status-amber'; // default
        let statusLabel = 'Normal';

        if (['peak_stable', 'recovery'].includes(market.sKey) ||
            (!market.sKey && (scenario.includes('Erholung') && !scenario.includes('Bärenmarkt') ||
                scenario.includes('Stabiler Höchststand')))) {
            statusClass = 'status-green';
            statusLabel = 'Gut';
        } else if (market.sKey === 'bear_deep' || !market.sKey && scenario.includes('Tiefer Bär')) {
            statusClass = 'status-red';
            statusLabel = 'Vorsicht';
        } else if (market.sKey === 'peak_hot' || !market.sKey && scenario.includes('heiß gelaufen')) {
            statusLabel = 'Heiß gelaufen';
        }

        // Create status indicator with simplified framing
        const statusIndicator = document.createElement('span');
        statusIndicator.className = `status-indicator ds-badge ${statusClass}`;
        statusIndicator.setAttribute('aria-label', `Marktstatus: ${statusLabel}`);

        const statusText = document.createElement('span');
        statusText.textContent = scenario;

        statusIndicator.appendChild(statusText);

        // Clear and add new content
        this.dom.outputs.marktstatusText.replaceChildren(statusIndicator);

        // Vorhandene Gründe bleiben am Chip zugänglich; die Kartenhilfe bleibt separat.
        statusIndicator.title = Array.isArray(market.reasons) ? market.reasons.join(', ') : '';

    }

}
