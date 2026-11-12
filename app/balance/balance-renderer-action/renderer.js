import { netPersonalAction, netActionEntriesOrOriginal, sumPersonalActions } from '../../../engine/transactions/net-action.mjs';
import { UIUtils } from '../balance-utils.js';
import { hasMeaningfulFlow, materialProfileActions, summarizeBalanceAction, threeBucketActionTrades, summarizeThreeBucketAction } from '../balance-action-summary.js';
import { renderBalancePlayExecution } from '../balance-play-execution-ui.js';
import { liquidityInflowRouting } from '../balance-play-execution.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { detailsMethods } from './details.js';
import { cashRebalanceMethods } from './cash-rebalance.js';
import { transactionMethods } from './transaction.js';
import { displayActionAmount } from '../../shared/display-rounding.js';

/** Renderer für Handlungsempfehlungen; Zustand bleibt auf derselben Instanz. */
export class ActionRenderer {

    /**
     * @param {Object} domRefs - DOM-Referenzen für die Aktionskarten.
     */
    constructor(domRefs) {
        this.dom = domRefs;
        this.copyText = '';
    }

    /**
     * Rendert die Handlungsempfehlung und optional interne Liquiditäts-Umschichtungen.
     *
     * @param {Object} action - Beschriebene Handlungsempfehlung aus der Engine.
     * @param {Object} input - Ursprüngliche Input-Daten (zur Berechnung von Rebalancing-Vorschlägen).
     * @param {Object} spending - Entnahmeinformationen zur Ableitung der Jahresentnahme.
     * @param {number} [targetLiquidity] - (Optional) Ziel-Liquidität aus der Engine.
     */
    renderAction(action = {}, input = null, spending = {}, targetLiquidity, context = {}) {
        this.copyText = '';
        const container = this.dom?.outputs?.handlungsanweisung;
        if (!container || !action || typeof action !== 'object' || Array.isArray(action)) return null;
        [...container.children].filter(n => n.id !== 'copyAction').forEach(n => n.remove());

        const profileEntries = Object.hasOwn(context, 'profileActionResults') ? context.profileActionResults : globalThis.window?.__profilverbundActionResults;
        this.profileActionResults = this._integrateProfileCashRebalance(profileEntries, null, targetLiquidity);
        this.singleExecutionEntry = profileEntries?.length ? null : this._integrateProfileCashRebalance(
            [{ profileId: persistenceStorage.getItem('rs_current_profile'), action, input, spending, targetLiquidity }], null, targetLiquidity)?.[0];
        let uiAction = this._materialProfileActions() ? action : this.singleExecutionEntry?.action || action;

        container.className = 'balance-action-plan';

        const content = document.createElement('div');
        content.id = 'handlungContent';
        const isThreeBucket = (input || context.input)?.decumulation?.mode === '3_bucket_jilge';
        this.isThreeBucket = isThreeBucket;
        if (isThreeBucket) {
            if (this.profileActionResults?.length) {
                this.profileActionResults = netActionEntriesOrOriginal(this.profileActionResults, input?.jointAssessment === true).map(entry => ({ ...entry, cashSplit: null }));
                uiAction = sumPersonalActions(uiAction, this.profileActionResults);
            } else uiAction = netActionEntriesOrOriginal([{ action: uiAction, input }])[0].action;
        }
        const entries = this._materialProfileActions() || [{ action: uiAction }];
        const trades = isThreeBucket ? threeBucketActionTrades(entries) : null;
        const baseSummary = this._summarizeAction(action, uiAction);
        const summary = trades ? summarizeThreeBucketAction(trades, baseSummary) : baseSummary;
        const projection = summary.verb !== 'Nichts tun' && (uiAction.type === 'TRANSACTION' || this._materialProfileActions())
            ? this._projectTransaction(uiAction, input, spending, targetLiquidity) : null;
        if (projection && trades !== null) projection.threeBucketTrades = trades;
        this._renderDetails(content, projection, action, uiAction, summary, context);

        container.appendChild(content);
        const outputs = this.dom.outputs;
        // FR-77 Punkt 4: Die Vorschau steht als zugeklappte Zeile „Hauptaktion · Betrag“ unter dem Plan.
        if (outputs.balanceActionTitle) outputs.balanceActionTitle.textContent = summary.verb;
        if (outputs.balanceActionAmount) {
            outputs.balanceActionAmount.textContent = '';
            if (summary.amount !== null) {
                const unit = document.createElement('span'); unit.className = 'balance-action-unit'; unit.textContent = summary.amountUnit;
                // FR-78: Betrag der Vorschau gerundet (Verkauf auf, Kauf ab, RD-1c); „Details der Vorschau“ bleibt genau.
                outputs.balanceActionAmount.replaceChildren(document.createTextNode(UIUtils.formatBalanceCurrency(displayActionAmount(summary.verb, summary.amount)).slice(0, -1)), unit);
            }
        }
        const purpose = outputs.balanceActionPurpose || outputs.balanceActionNote;
        if (purpose) purpose.textContent = summary.note;
        const routingEntries = this._materialProfileActions() || [{ action: uiAction, input, spending, targetLiquidity }];
        if (outputs.balanceActionTransfer) {
            const host = outputs.balanceActionTransfer; host.replaceChildren();
            const row = (label, amount) => {
                if (Number(amount.toFixed(0)) === 0) return;
                const line = document.createElement('div'); line.className = 'balance-row ds-row';
                const name = document.createElement('span'); name.textContent = label;
                const value = document.createElement('strong'); value.textContent = UIUtils.formatBalanceCurrency(amount);
                line.append(name, value); host.appendChild(line);
            };
            for (const entry of routingEntries) {
                const prefix = this._materialProfileActions() ? `${entry.name || entry.profileId || 'Person'} · ` : '';
                const base = this._actionWithoutInternalTransfer(entry.action);
                const part = liquidityInflowRouting(entry.input, base, entry.spending, entry.targetLiquidity);
                if (part && part.tagesgeld + part.geldmarkt > 0) {
                    row(`${prefix}ins Tagesgeld · bis zum Tagesgeldziel`, part.tagesgeld);
                    row(`${prefix}in den Geldmarkt · Rest der Reserve`, part.geldmarkt);
                }
                const personal = summarizeBalanceAction(entry.action, entry.action);
                const transfer = personal.verb === 'Umschichten' ? personal.amount : personal.extraTransfer;
                const direction = entry.action.internalCashRebalance;
                if (transfer > 0) row(`${prefix}interne Umschichtung${direction ? ` · ${direction.from.replace('Geldmarkt-ETF', 'Geldmarkt')} → ${direction.to.replace('Geldmarkt-ETF', 'Geldmarkt')}` : ''}`, transfer);
            }
        }
        this.executionEntries = summary.verb === 'Nichts tun' ? [] : this._playExecutionEntries(uiAction, input, spending, targetLiquidity);
        const routingHost = globalThis.document?.getElementById?.('balanceActionRouting');
        if (routingHost) routingHost.hidden = !outputs.balanceActionTransfer?.children.length;
        const taxHost = globalThis.document?.getElementById?.('balanceActionTax');
        if (taxHost) {
            taxHost.textContent = `${UIUtils.formatBalanceCurrency(this.executionEntries.reduce((sum, entry) => sum + (entry.action.steuer || 0), 0))} · bereits abgezogen`;
            /** @type {HTMLElement} */ (taxHost.parentNode).hidden = !this.executionEntries.some(entry => (entry.action.quellen || [])
                .some(source => source.brutto > 0 && !source.internalCashRebalance && !['liquiditaet', 'geldmarkt'].includes(source.kind) && source.source !== 'Liquidität'));
        }
        renderBalancePlayExecution(globalThis.document, this.executionEntries);
        return summary;
    }

    getActionCopyText() { return this.copyText; }

    clearAction() {
        this.copyText = '';
        this.executionEntries = [];
        this.profileActionResults = null;
        this.singleExecutionEntry = null;
        renderBalancePlayExecution(globalThis.document, []);
        const outputs = this.dom?.outputs || {};
        const host = outputs.handlungsanweisung;
        if (host) [...host.children].filter(node => node.id !== 'copyAction').forEach(node => node.remove());
        outputs.actionPurposeContent?.replaceChildren();
        outputs.printFooter?.replaceChildren();
        for (const key of ['actionDetailsTitle', 'actionDetailsAmountLabel', 'actionDetailsAmount', 'actionDetailsNote']) {
            if (outputs[key]) outputs[key].textContent = key === 'actionDetailsTitle' ? 'Handlungsanweisung' : '';
        }
        if (outputs.actionManagerLink) outputs.actionManagerLink.textContent = 'Vermögen öffnen →';
    }

    _renderDetails(content, plan, original, action, summary, context) {
        return detailsMethods._renderDetails.call(this, content, plan, original, action, summary, context);
    }

    _hasMeaningfulFlow(action) { return hasMeaningfulFlow(action); }

    _materialProfileActions() {
        return materialProfileActions(this.profileActionResults ?? globalThis.window?.__profilverbundActionResults);
    }

    /** DOM-freier Einstieg für dieselbe Ausführung im Zeitraffer. */
    prepareExecutionEntries(entries, householdTarget) {
        if (!entries?.length) return [];
        this.profileActionResults = this._integrateProfileCashRebalance(entries, null, householdTarget);
        this.isThreeBucket = entries[0].input?.decumulation?.mode === '3_bucket_jilge';
        if (this.isThreeBucket) this.profileActionResults = netActionEntriesOrOriginal(this.profileActionResults,
            entries[0].input?.jointAssessment === true).map(entry => ({ ...entry, cashSplit: null }));
        if (!this._materialProfileActions()) return [];
        return this._playExecutionEntries();
    }

    _playExecutionEntries(action, input, spending, targetLiquidity, rebalance) {
        const material = this._materialProfileActions();
        const entries = material || [this.singleExecutionEntry || { profileId: persistenceStorage.getItem('rs_current_profile'), action, input, spending, targetLiquidity }];
        return entries.map(entry => {
            const action = this.isThreeBucket ? netPersonalAction(entry.action) : entry.action;
            return { ...entry, action, cashSplit: action !== entry.action ? this._splitLiquiditySource(entry.input, action, entry.spending, entry.targetLiquidity)
                : entry.cashSplit ?? this._splitLiquiditySource(entry.input, action, entry.spending, entry.targetLiquidity) };
        });
    }

    _summarizeAction(action, uiAction) {
        return summarizeBalanceAction(action, uiAction, this.profileActionResults ?? globalThis.window?.__profilverbundActionResults);
    }

    _integrateProfileCashRebalance(entries, rebalance, householdTarget) {
        return cashRebalanceMethods._integrateProfileCashRebalance.call(this, entries, rebalance, householdTarget);
    }

    _integrateCashRebalance(originalAction, rebalance, input = null, spending = {}, targetLiquidity, priced = null) {
        return cashRebalanceMethods._integrateCashRebalance.call(this, originalAction, rebalance, input, spending, targetLiquidity, priced);
    }

    _resolveZielTagesgeld(spending, targetLiquidity, input) {
        return cashRebalanceMethods._resolveZielTagesgeld.call(this, spending, targetLiquidity, input);
    }

    _splitLiquiditySource(input, action, spending, targetLiquidity) {
        return cashRebalanceMethods._splitLiquiditySource.call(this, input, action, spending, targetLiquidity);
    }

    determineInternalCashRebalance(input, action, spending, targetLiquidity) {
        return cashRebalanceMethods.determineInternalCashRebalance.call(this, input, action, spending, targetLiquidity);
    }

    _quantize(amount, mode = 'ceil') {
        return cashRebalanceMethods._quantize.call(this, amount, mode);
    }

    _projectTransaction(action, input, spending, targetLiquidity) {
        return transactionMethods._projectTransaction.call(this, action, input, spending, targetLiquidity);
    }

    _actionWithoutInternalTransfer(action = {}) {
        return transactionMethods._actionWithoutInternalTransfer.call(this, action);
    }
}
