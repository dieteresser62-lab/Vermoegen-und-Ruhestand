import { projectBalanceFlexTrace } from './balance-flex-trace.js';
import { bindBalanceBudgetWhy } from './balance-presentation-controls.js';
import { householdPlanFieldSpec } from '../shared/household-plan-fields.js';
import { readBalanceInflationSource } from './balance-inflation-source.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { expensesDestination, expensesHref } from '../shared/expenses-navigation.js';
import { projectExpenses, readExpensesBudget } from '../expenses/expenses-model.js';
import { loadExpensesStoreResult } from './balance-expenses-storage.js';
import { appNow } from '../shared/app-clock.js';
import { deriveBalanceNextSteps } from './balance-next-steps.js';
import { projectBalanceActionOrigin } from './balance-action-origin.js';
import { createAnnualActionResult } from '../shared/annual-close-result.js';
import { overviewScope } from '../overview/overview-storage.js';
import { projectOverviewWithAnnualArchive } from '../overview/overview-model.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
import { personReferenceYear, projectPerson, describePersonDates } from '../profile/profile-person-data.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
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

export function formatCurrency(value) {
    return UIUtils.formatCurrency(value);
}

export function calculateTotals(ui = {}) {
    const num = (value) => (typeof value === 'number' && isFinite(value)) ? value : 0;
    return {
        depotwertGesamt: num(ui.depotwertGesamt),
        neuerBedarf: num(ui.neuerBedarf),
        minGold: num(ui.minGold),
        zielLiquiditaet: num(ui.zielLiquiditaet)
    };
}

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
        const doc = outputs?.balanceMonthlyBudget?.ownerDocument || outputs?.miniSummary?.ownerDocument || globalThis.document;
        return outputs?.[key] || doc?.getElementById?.(BALANCE_PRESENTATION_OUTPUT_IDS[key]);
    }

    /**
     * Orchestriert das Rendering der wichtigsten UI-Kacheln.
     *
     * @param {Object} ui - Vorbereitete UI-Daten inklusive Input- und Output-Werten.
     */
    renderOverview(ui = {}) {
        this.renderPlanCards(ui);
        this.renderMiniSummary(ui);
        this.renderHealthBucket(ui.healthBucketDiagnostics);
        const footer = this.getPresentationOutput('balanceWealthFooter');
        if (footer) footer.textContent = `Gesamtvermögen ${UIUtils.formatBalanceCurrency(ui.vpw?.gesamtwert)} · davon Pflegevorsorge ${UIUtils.formatBalanceCurrency(ui.healthBucketDiagnostics?.lockedAmount)} reserviert`;

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

        // Detail-Abschnitte in eigene Render-Schritte ausgelagert.
        this.renderEntnahme(ui.spending || {});
        this.renderMarktstatus(ui.market || {});
        this.renderLiquidityBar(ui.liquiditaet?.deckungNachher);
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

    renderPlanCards(ui) {
        const outputs = this.dom?.outputs || {};
        if (!outputs.balanceMonthlyBudget) return;
        const input = ui.input || {}, spending = ui.spending || {}, market = ui.market || {};
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const currency = UIUtils.formatBalanceCurrency;
        const finite = Number.isFinite;
        const rows = (key, values) => {
            const host = outputs[key];
            if (!host) return;
            host.replaceChildren();
            values.forEach(([label, value, unitText, meta]) => {
                if (value === null) return;
                const row = document.createElement('div'); row.className = 'balance-row ds-row';
                const name = document.createElement('span'); name.textContent = label;
                const amount = document.createElement('strong'); amount.textContent = value;
                if (key === 'balanceNeedRows' && label === 'Bedarf gesamt') row.className += ' balance-need-total';
                if (unitText) {
                    const unit = document.createElement('small'); unit.className = 'balance-unit'; unit.textContent = unitText;
                    amount.replaceChildren(document.createTextNode(value.slice(0, -1)), unit);
                }
                if (meta) {
                    const detail = document.createElement('small'); detail.className = 'balance-need-meta'; detail.textContent = meta;
                    amount.appendChild(detail);
                }
                row.append(name, amount); host.appendChild(row);
            });
        };
        const projection = projectBalanceFlexTrace(ui);
        const { income, withdrawal, budget, grossNeed, cut } = projection;
        set('balanceMonthlyBudget', budget === null ? '—' : currency(budget));
        if (budget !== null) {
            const unit = document.createElement('span'); unit.className = 'balance-unit'; unit.textContent = '€';
            outputs.balanceMonthlyBudget.replaceChildren(document.createTextNode(currency(budget).slice(0, -1)), unit);
        }
        set('balanceAnnualBudget', budget === null ? 'Noch keine gültige Berechnung.' : `${currency(budget * 12)} im Jahr${grossNeed === null ? '' : ` · Bedarf: ${currency(grossNeed)} / Monat`}`);
        set('balanceMonthlyIncome', finite(income) ? currency(income) : '—');
        set('balanceBudgetCut', cut > 0 && finite(spending.details?.flexRate)
            ? `Der flexible Bedarf ist auf ${formatDisplayNumber(spending.details.flexRate, { unit: 'percent' })} gekürzt: ${currency(cut)} weniger im Monat, als du planst.` : cut === 0 ? 'Dein flexibler Bedarf ist voll finanziert.' : '');
        outputs.balanceBudgetCut?.setAttribute('data-financed', String(cut === 0));
        this.renderBudgetTrace(projection);
        if (outputs.balanceBudgetCutLegend) {
            outputs.balanceBudgetCutLegend.hidden = !(cut > 0);
            outputs.balanceBudgetCutLegend.setAttribute('data-cut-known', String(cut !== null));
        }
        set('balanceBudgetCutAmount', cut > 0 ? `−${currency(cut)}` : '');
        const bar = outputs.balanceBudgetBar;
        if (bar) {
            bar.replaceChildren();
            const total = Math.max(budget || 0, grossNeed || 0);
            if (total > 0) [income, withdrawal, cut].forEach((value, index) => {
                if (!finite(value) || value <= 0) return;
                const part = document.createElement('span'); part.className = `budget-part-${index}`;
                part.style.width = `${value / total * 100}%`; bar.appendChild(part);
            });
        }
        const chips = outputs.balanceBudgetChips;
        if (chips) {
            chips.replaceChildren();
            [finite(spending.details?.flexRate) ? `Flex-Rate ${formatDisplayNumber(spending.details?.flexRate, { unit: 'percent' })}` : null,
                finite(ui.liquiditaet?.deckungVorher) ? `Liquidität ${formatDisplayNumber(ui.liquiditaet.deckungVorher, { unit: 'percent' })} des Ziels` : null,
                cut > 0 && projection.reason ? `Grund: ${projection.reason}` : null].filter(Boolean).forEach(text => {
                const chip = document.createElement('span'); chip.className = 'ds-plan-chip'; chip.textContent = text;
                const flexRate = spending.details?.flexRate, coverage = ui.liquiditaet?.deckungVorher;
                if (text.startsWith('Flex-Rate') && finite(flexRate) && flexRate < 100) chip.className += ' ds-chip-error';
                if (text.startsWith('Grund:')) chip.className += ' ds-chip-warning';
                if (text.startsWith('Liquidität') && finite(coverage)) chip.className += coverage >= 100 ? ' ds-chip-success' : ' ds-chip-warning';
                chips.appendChild(chip);
            });
            const status = readBalancePersonStatus();
            if (status.ready && status.status !== 'demo') {
                for (const entry of status.entries) {
                    const person = projectPerson(entry.data, status.referenceYear);
                    if (person.renteMonatlich <= 0) continue;
                    const hint = document.createElement('p'); hint.className = 'ds-help';
                    hint.dataset.pensionStatus = entry.profileId;
                    const name = status.entries.length > 1 ? ` ${entry.name}` : '';
                    const text = describePersonDates(entry.data, status.referenceYear).balancePensionStatus;
                    const namedText = text.startsWith('Rente ') ? text.replace(/^Rente /, `Rente${name} `) : `${name ? `${entry.name} · ` : ''}${text}`;
                    hint.textContent = namedText;
                    chips.appendChild(hint);
                }
            }
        }
        const financedFlex = finite(withdrawal) && finite(input.floorBedarf) && finite(income)
            ? Math.max(0, withdrawal - Math.max(0, input.floorBedarf / 12 - income)) : null;
        const state = this.storageManager?.loadState?.();
        const adjustedAge = state?.needsAdjustedForInflationYear || 0;
        const inflationYear = input.referenceYear ?? personReferenceYear(state?.annualPeriodMetadata);
        const inflationNote = finite(input.aktuellesAlter) && finite(input.inflation)
            ? inflationYear > adjustedAge ? 'Bedarfe noch nicht angepasst'
                : inflationYear === adjustedAge && adjustedAge > 0 ? 'Bedarfe bereits angepasst' : null : null;
        const annualInflation = readBalanceInflationSource({ scope: readBalanceHouseholdPlan().scope });
        rows('balanceNeedRows', [
            [householdPlanFieldSpec('floorBedarf').label, finite(input.floorBedarf) ? currency(input.floorBedarf / 12) : null, '€ / Monat'],
            [householdPlanFieldSpec('flexBedarf').label, ui.vpw?.enabled && finite(ui.neuerBedarf) && finite(input.floorBedarf) && finite(income) ? currency(Math.max(0, ui.neuerBedarf / 12 - Math.max(0, input.floorBedarf / 12 - income))) : finite(input.flexBedarf) ? currency(input.flexBedarf / 12) : null,
                '€ / Monat', financedFlex === null ? null : `davon finanziert ${currency(financedFlex)}`],
            ['Bedarf gesamt', grossNeed === null ? null : currency(grossNeed), '€ / Monat'],
            [`Inflation · ${annualInflation.year ?? 'Jahr nicht belegt'}`,  finite(input.inflation) ? formatDisplayNumber(input.inflation, { unit: 'percent' }) : null, null, [annualInflation.source, inflationNote].filter(Boolean).join(' · ')]
        ]);
        // Die bestehende Profilzusammenfassung enthält Vermögen, keinen Profilbedarf.
        const needProfiles = outputs.balanceNeedProfiles;
        if (needProfiles) { needProfiles.replaceChildren(); needProfiles.hidden = true; }
        set('balanceActionCoverage', finite(ui.liquiditaet?.deckungNachher)
            ? ` Danach ${formatDisplayNumber(ui.liquiditaet.deckungNachher, { unit: 'percent' })} des Ziels.` : '');
        const operative = ui.healthBucketDiagnostics?.operativeLiquidity;
        const freeLiquidity = finite(operative) ? operative : finite(input.tagesgeld) && finite(input.geldmarktEtf) ? input.tagesgeld + input.geldmarktEtf : null;
        const setPresentation = (key, text) => { const host = this.getPresentationOutput(key); if (host) host.textContent = text; };
        setPresentation('balanceFreeLiquidity', currency(freeLiquidity));
        setPresentation('balanceReserveTargetMonths', formatDisplayNumber(finite(input.liquidityRunwayYears) ? input.liquidityRunwayYears * 12 : null, { unit: 'months', fractionDigits: 0 }));
        setPresentation('balanceReserveRunway', `reicht für ${formatDisplayNumber(ui.runway?.months, { unit: 'months', allowInfinity: true })} Entnahme`);
        rows('balanceReserveRows', [
            ['Gold-Bestand', finite(input.goldWert) ? currency(input.goldWert) : null]
        ]);
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
        const tint = ['peak_hot', 'peak_stable', 'recovery'].includes(market.sKey) ? 'good' : market.sKey === 'bear_deep' ? 'bad' : market.sKey ? 'warn' : null;
        const marketCard = scale?.closest?.('.ov-mkt');
        for (const tone of ['good', 'warn', 'bad']) {
            marketCard?.classList.toggle('market-' + tone, tone === tint);
            outputs.balanceOverview?.classList.toggle('climate-' + tone, tone === tint);
        }
        const alarm = ui.balanceAlarmActive === true;
        if (outputs.balanceMarketAlarm) outputs.balanceMarketAlarm.hidden = !alarm;
        set('balanceMarketAlarmText', alarm ? (spending.anmerkung || 'Die vorhandenen Leitplanken begrenzen den flexiblen Bedarf. Details stehen in der Diagnose.') : '');
        this.renderContext(input, ui);
    }

    renderAnnualAction(origin) {
        const host = this.getPresentationOutput('balanceAnnualAction');
        if (!host) return;
        host.replaceChildren();
        const doc = host.ownerDocument || globalThis.document;
        if (origin.confirmed) {
            const section = createAnnualActionResult({ doc, result: origin.confirmed });
            section.querySelector('h3').textContent = origin.label;
            host.appendChild(section);
            const note = doc.createElement('p'); note.className = 'ds-source';
            note.textContent = 'Die Umsetzung bleibt deine Entscheidung. Bestände werden nur durch deine tatsächlichen Buchungen geändert.';
            host.appendChild(note);
        } else {
            const title = doc.createElement('h3'); title.textContent = origin.label; host.appendChild(title);
            if (origin.notice) {
                const notice = doc.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = origin.notice; host.appendChild(notice);
            }
        }
    }

    renderContext(input = {}, ui = {}) {
        const outputs = this.dom?.outputs || {};
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const targetYear = deriveCompletedCalendarYear(appNow());
        const state = this.storageManager?.loadState?.();
        const metadata = state?.annualPeriodMetadata;
        const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i)).map(key => [key, persistenceStorage.getItem(key)]));
        const model = projectOverviewWithAnnualArchive({ registry: loadProfileRegistry().value, activeId: persistenceStorage.getItem('rs_current_profile'), liveData,
            balanceSingleFallback: true, recovery: Boolean(globalThis.window?.__profileRecoveryBlocker) }, { onChange: () => this.renderContext(input, ui) });
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
                const view = projectExpenses({ store: result.store, year, people, budget, now: appNow() });
                expensesHost.textContent = `Ausgaben bisher ${view.hasData ? UIUtils.formatBalanceCurrency(view.stats.annualUsed) : '— (noch keine Imports)'} von ${view.annualBudget === null ? '— (Budget nicht verfügbar)' : UIUtils.formatBalanceCurrency(view.annualBudget)} · ${year} →`;
            } catch { expensesHost.textContent = `Ausgaben ${year} nicht sicher lesbar · Ausgaben öffnen →`; }
        }

        const firstYearText = `Erstes Planungsjahr ${model.firstPlanningYear} · erster Jahresabschluss Anfang ${model.firstPlanningYear + 1}`;
        set('balanceNextAnnualLabel', notApplicable ? 'Erster Jahresabschluss' : annualState === 'recovery' ? 'Wiederherstellung öffnen' : annualState === 'unclear' ? 'Jahresstatus klären' : annualState === 'unavailable' ? 'Daten prüfen' : `Jahresabschluss ${targetYear} starten`);
        const origin = model.actionOrigin || projectBalanceActionOrigin({ comparison: model.planComparison, year: targetYear + 1, scope: model.scope, occasion: model.occasion });
        this.actionOrigin = origin;
        this.renderAnnualAction(origin);
        set('balanceActionFootnote', origin.previewNotice);
        for (const [id, offset] of [['endeVJ', 0], ['endeVJ_1', 1], ['endeVJ_2', 2], ['endeVJ_3', 3]]) {
            const label = globalThis.document?.querySelector?.(`label[for="${id}"]`);
            if (label) label.textContent = `Ende ${targetYear - offset}`;
        }
        const marketView = getMarketDataProvenanceViewModel(state?.annualMarketDataMeta);
        set('balanceMarketSource', marketView.available ? `${marketView.instrument} · ${marketView.asOf} · ${marketView.source}` : 'Marktdatenherkunft nicht verfügbar.');
        set('balanceMarketDate', marketView.available && /^\d{4}-\d{2}-\d{2}$/.test(marketView.asOf) ? marketView.asOf.split('-').reverse().join('.') : 'nicht verfügbar');
        const recovery = annualState === 'recovery' || Boolean(metadata?.pendingCommit);
        if (outputs.balanceNextAnnual) outputs.balanceNextAnnual.disabled = ['done', 'not_applicable'].includes(annualState) || Boolean(this.dom?.controls?.jahresabschlussBtn?.disabled);
        set('balanceActionPeriod', origin.previewLabel);
        if (outputs.balanceBudgetChips) {
            const chip = outputs.balanceBudgetChips.querySelector?.('[data-period-chip]') || document.createElement('span'); chip.className = 'ds-plan-chip ds-chip-warning';
            chip.className = 'ds-plan-chip' + (notApplicable ? '' : annualState === 'done' ? ' ds-chip-success' : ' ds-chip-warning');
            chip.textContent = notApplicable ? firstYearText : annualState === 'done' ? `Jahr ${targetYear} abgeschlossen`
                : recovery ? 'Recovery erforderlich' : annualState === 'open' ? `vorläufig · bis zum Jahresabschluss ${targetYear}` : 'Jahresstatus ungeklärt';
            chip.setAttribute('data-period-chip', '');
            if (!chip.parentNode) outputs.balanceBudgetChips.appendChild(chip);
        }
        const recoveryText = recovery ? metadata?.pendingCommit ? `Jahresabschluss ${metadata.pendingCommit.periodId} unterbrochen. Bitte zuerst den Recovery-Snapshot ${metadata.pendingCommit.snapshotId} unter Bedarf & Strategie → Snapshots wiederherstellen.` : 'Bitte zuerst die vorhandene Wiederherstellung verwenden.' : '';
        if (outputs.balanceAnnualRecovery) { outputs.balanceAnnualRecovery.hidden = !recovery; outputs.balanceAnnualRecovery.textContent = recoveryText; }
        const steps = outputs.balanceNextSteps;
        if (steps) {
            steps.replaceChildren();
            const open = deriveBalanceNextSteps({ occasion: model.occasion, recovery: model.recovery,
                cashStatus: model.cashStatus, expenses: model.expenses, monthlyWithdrawal: ui.spending?.monatlicheEntnahme ?? model.summary?.monthlyWithdrawal });
            set('balanceStepCount', open.length ? `${open.length} Schritte offen` : 'Alles erledigt');
            open.forEach((item, index) => {
                const step = document.createElement('div'); step.className = 'balance-step ds-step'; step.setAttribute('data-next-step', item.id);
                const dot = document.createElement('span'); dot.className = 'balance-step-dot ds-step-dot' + (index === 0 ? ' balance-step-open' : ''); dot.textContent = String(index + 1);
                const content = document.createElement('div');
                const title = document.createElement('strong'); title.className = 'balance-step-title'; title.textContent = item.title;
                const description = document.createElement('span'); description.className = 'ds-help'; description.textContent = item.description;
                const link = document.createElement('a'); link.href = expensesDestination(item.href); link.textContent = ' Öffnen'; link.setAttribute('data-profile-handoff', '');
                if (item.id === 'cash') { link.setAttribute('data-balance-cash-manager', ''); link.setAttribute('data-profile-handoff-export', 'false'); }
                description.appendChild(link); content.append(title, description); step.append(dot, content); steps.appendChild(step);
            });
        }
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

    /**
     * Erzeugt die kompakte Zusammenfassung inkl. KPI-Badges und Reichweiten.
     *
     * @param {Object} ui - Gesamte UI-Datenstruktur inklusive Input/Action.
     */
    renderMiniSummary(ui = {}) {
        let currentInput = ui.input;
        if (!currentInput) {
            // Defensive Fallbacks: Storage bevorzugt, danach optionaler UIReader (falls vorhanden).
            currentInput = this.storageManager?.loadState?.()?.inputs;
            if (!currentInput && typeof UIReader !== 'undefined' && typeof UIReader.readAllInputs === 'function') {
                currentInput = UIReader.readAllInputs();
            }
        }
        if (!currentInput) {
            console.error("UIRenderer.renderMiniSummary: Konnte keine Input-Daten laden!");
            if (this.dom?.outputs?.miniSummary) {
                this.dom.outputs.miniSummary.textContent = 'Fehler beim Laden der Input-Daten für Mini-Summary.';
            }
            return;
        }

        // Vergleichskennzahlen: vorhandene Werte und ausdrücklich fehlende Nachherwerte.
        const createItem = (label, before, after, unit, formatter) => {
            const item = document.createElement('div');
            item.className = 'summary-item ds-metric ds-kpi';
            const labelEl = document.createElement('span');
            labelEl.className = 'label';
            labelEl.textContent = label;
            const valueEl = document.createElement('span');
            valueEl.className = 'value ds-big-number';
            const strongEl = document.createElement('strong');
            const formatVal = formatter || (v => formatDisplayNumber(v, { allowInfinity: true }));
            strongEl.textContent = `${formatVal(after)}${unit}`;
            valueEl.textContent = `${formatVal(before)}${unit} → `;
            valueEl.appendChild(strongEl);
            item.append(labelEl, valueEl);
            return item;
        };

        const inflatedBedarf = {
            floor: Math.max(0, currentInput.floorBedarf - (currentInput.renteAktiv ? currentInput.renteMonatlich * 12 : 0)),
            flex: currentInput.flexBedarf
        };
        const liqVorher = Number.isFinite(ui.healthBucketDiagnostics?.operativeLiquidity)
            ? ui.healthBucketDiagnostics.operativeLiquidity : currentInput.tagesgeld + currentInput.geldmarktEtf;

        // Eindeutige Cashflowprojektion der vorhandenen Empfehlung: sämtliche
        // Liquiditätsquellen abziehen, Cash-/Geldmarktverwendungen hinzufügen.
        // Ohne Verwendungsdaten gibt es keinen erfundenen Nachherwert.
        const uses = ui.action?.verwendungen;
        const sources = Array.isArray(ui.action?.quellen) ? ui.action.quellen : [];
        const cashSources = sources.filter(source => ['liquiditaet', 'geldmarkt'].includes(source.kind));
        const inflows = uses && typeof uses === 'object' ? [uses.liquiditaet ?? 0, uses.geldmarkt ?? 0] : null;
        const knownFlows = inflows?.every(Number.isFinite) && cashSources.every(source => Number.isFinite(source.brutto));
        const liqNachher = knownFlows && Number.isFinite(liqVorher)
            ? liqVorher + inflows.reduce((sum, amount) => sum + amount, 0) - cashSources.reduce((sum, source) => sum + source.brutto, 0)
            : null;

        const reichweite = {
            floorVorher: !Number.isFinite(liqVorher) || !Number.isFinite(inflatedBedarf.floor) ? null : inflatedBedarf.floor > 0 ? (liqVorher / inflatedBedarf.floor) : Infinity,
        };

        const fragment = document.createDocumentFragment();

        const formatDeckung = value => formatDisplayNumber(value, { unit: 'percent' });
        fragment.appendChild(createItem('Liquiditätsdeckung', ui.liquiditaet?.deckungVorher, ui.liquiditaet?.deckungNachher, '', formatDeckung));
        const runwayKpi = createItem('Runway (Gesamtbedarf)', ui.runway?.months, null, '',
            value => value === null ? '—' : formatDisplayNumber(value, { unit: 'months', allowInfinity: true }));
        runwayKpi.className = `summary-item ds-metric ds-kpi summary-kpi status-${ui.runway?.status || 'info'}`;
        const missingRunway = document.createElement('small');
        missingRunway.className = 'ds-help'; missingRunway.textContent = 'Nachher-Runway nicht verfügbar; die Berechnung liefert nur den Istwert.';
        runwayKpi.appendChild(missingRunway);
        fragment.appendChild(runwayKpi);
        fragment.appendChild(createItem('Reichweite Netto-Floor', reichweite.floorVorher,
            liqNachher !== null && liqNachher >= 0 ? inflatedBedarf.floor > 0 ? liqNachher / inflatedBedarf.floor : Infinity : null, '',
            value => formatDisplayNumber(value, { unit: 'years', allowInfinity: true })));

        if (this.dom?.outputs?.miniSummary) {
            this.dom.outputs.miniSummary.replaceChildren(fragment);
        }
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
    renderEntnahme(spending = {}) {
        if (!this.dom?.outputs?.monatlicheEntnahme) return;

        const monatlicheEntnahme = spending.monatlicheEntnahme;
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

        if (['peak_hot', 'peak_stable', 'recovery'].includes(market.sKey) ||
            (!market.sKey && (scenario.includes('Erholung') && !scenario.includes('Bärenmarkt') ||
                scenario.includes('Stabiler Höchststand') || scenario.includes('heiß gelaufen')))) {
            statusClass = 'status-green';
            statusLabel = 'Gut';
        } else if (market.sKey === 'bear_deep' || !market.sKey && scenario.includes('Tiefer Bär')) {
            statusClass = 'status-red';
            statusLabel = 'Vorsicht';
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
        const outputs = this.dom.outputs;
        const alarm = outputs.balanceMarketAlarm?.hidden === false;
        const cut = outputs.balanceBudgetCutAmount?.textContent;
        const note = document.createElement('span'); note.className = 'balance-market-note';
        note.textContent = [alarm ? 'Alarm aktiv' : null, cut ? 'Flex gekürzt' : null].filter(Boolean).join(' · ');
        if (!note.textContent && outputs.balanceBudgetCutLegend?.hidden === true
            && outputs.balanceBudgetCutLegend.getAttribute('data-cut-known') === 'true') note.textContent = 'keine Kürzung';
        if (note.textContent) outputs.marktstatusText.appendChild(note);

    }

    /**
     * Visualisiert die Liquiditätsdeckung über den Fortschrittsbalken.
     *
     * @param {number} percent - Deckung in Prozent.
     */
    renderLiquidityBar(percent) {
        if (!this.dom?.outputs?.liquiditaetBalken || !this.dom?.outputs?.balkenContainer) return;
        if (typeof percent !== 'number' || !isFinite(percent)) return;

        const pct = Math.min(100, Math.max(0, percent));
        const bar = this.dom.outputs.liquiditaetBalken;
        bar.className = 'progress-bar';
        bar.style.width = pct + '%';
        bar.classList.add(pct >= 100 ? 'bar-ok' : pct >= 70 ? 'bar-warn' : 'bar-bad');
        this.dom.outputs.balkenContainer.setAttribute('aria-valuenow', pct.toFixed(0));
    }
}
