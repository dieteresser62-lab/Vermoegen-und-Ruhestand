/**
 * Module: Balance Renderer Action
 * Purpose: Renders the "Action Card" (Handlungsempfehlung).
 *          Visualizes Sources (Funds/Sales) and Uses (Purchases/Liquidity) and handles Profilverbund rendering.
 * Usage: Used by balance-renderer.js to display recommendations.
 * Dependencies: balance-utils.js
 */
"use strict";

import { projectBalanceActionOrigin } from './balance-action-origin.js';
import { UIUtils } from './balance-utils.js';
import { displayDiagnosisText } from './balance-diagnosis-transaction.js';
import { describeBalanceActionSummary, hasMeaningfulFlow, materialProfileActions, summarizeBalanceAction } from './balance-action-summary.js';

/**
 * Renderer für Handlungsempfehlungen und interne Rebalancing-Hinweise.
 * Trägt die Verantwortung für die Aktions-Karte inklusive defensiver Plausibilitätsprüfungen.
 */
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

        // 1. Calculate potential internal cash rebalance
        const internalRebalance = this.determineInternalCashRebalance(
            input,
            action,
            spending,
            targetLiquidity
        );

        // 2. Integrate into main action object (Unified UI)
        const uiAction = this._integrateCashRebalance(action, internalRebalance);

        container.className = 'balance-action-plan';

        const content = document.createElement('div');
        content.id = 'handlungContent';
        const summary = this._summarizeAction(action, uiAction);
        const projection = summary.verb !== 'Nichts tun' && (uiAction.type === 'TRANSACTION' || this._materialProfileActions())
            ? this._projectTransaction(uiAction, input, spending, targetLiquidity) : null;
        this._renderDetails(content, projection, action, uiAction, summary, context);

        container.appendChild(content);
        const outputs = this.dom.outputs;
        const proposedTitle = {
            'Aktien verkaufen': 'Vorgeschlagener Verkauf · Aktien',
            'Gold verkaufen': 'Vorgeschlagener Verkauf · Gold',
            'Gold kaufen': 'Vorgeschlagener Kauf · Gold',
            'Aktien kaufen': 'Vorgeschlagener Kauf · Aktien',
            'Umschichten': 'Vorgeschlagene Umschichtung',
            'Handlung prüfen': 'Vorgeschlagene Handlung prüfen',
            'Nichts tun': 'Keine Transaktion vorgeschlagen'
        }[summary.verb];
        if (outputs.balanceActionTitle) outputs.balanceActionTitle.textContent = proposedTitle;
        if (outputs.balanceActionAmount) {
            outputs.balanceActionAmount.textContent = '';
            if (summary.amount !== null) {
                const unit = document.createElement('span'); unit.className = 'balance-action-unit'; unit.textContent = summary.amountUnit;
                outputs.balanceActionAmount.replaceChildren(document.createTextNode(UIUtils.formatBalanceCurrency(summary.amount).slice(0, -1)), unit);
            }
        }
        const card = outputs.balanceActionTitle?.closest?.('.ov-act');
        card?.classList.toggle('action-hold', summary.verb === 'Nichts tun');
        if (outputs.balanceActionIcon) outputs.balanceActionIcon.innerHTML = summary.verb === 'Nichts tun'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8M14 7h7v7M3 21h18"/></svg>';
        const purpose = outputs.balanceActionPurpose || outputs.balanceActionNote;
        if (purpose) purpose.textContent = summary.note;
        if (outputs.balanceActionTransfer) outputs.balanceActionTransfer.textContent = summary.extraTransfer > 0
            ? `plus interne Umschichtung von ${UIUtils.formatBalanceCurrency(summary.extraTransfer)}` : '';
        return summary;
    }

    getActionCopyText() { return this.copyText; }

    clearAction() {
        this.copyText = '';
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
        const outputs = this.dom.outputs;
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const year = outputs.balancePlanningYear?.textContent || '';
        const origin = context.actionOrigin || projectBalanceActionOrigin();
        const heading = `${origin.previewLabel} · ${summary.purpose || summary.verb}`;
        set('actionDetailsTitle', heading);
        const texts = [heading, describeBalanceActionSummary(summary, UIUtils.formatCurrency)];
        const paragraph = (text, className = 'ds-source') => {
            if (!text) return;
            const node = document.createElement('p'); node.className = className; node.textContent = text;
            content.appendChild(node); texts.push(text);
        };
        paragraph(origin.previewNotice);
        const title = plan?.title || displayDiagnosisText(action.title || original.title || '');
        paragraph([title, context.market?.szenarioText ? `Marktphase: ${context.market.szenarioText}` : '']
            .filter(Boolean).join(' · '), 'balance-action-detail-title');
        if (plan?.protected) paragraph('PUFFER-SCHUTZ', 'strategy-badge ds-badge');
        // Der generierte Zwecksatz wiederholt die Überschrift. Andere Hinweise
        // (Mindesthandel, Nichtstun, Umschichtung) behalten ihren eigenen Platz.
        if (!summary.purpose || !summary.note.startsWith('Um ')) paragraph(summary.note);
        const money = (amount, formatter) => Number.isFinite(amount) ? formatter(amount) : '—';
        const label = summary.amountUnit === '€ netto' ? 'Verkaufserlös netto'
            : summary.verb === 'Umschichten' ? 'interne Umschichtung' : summary.amount !== null ? 'Kaufbetrag' : '';
        set('actionDetailsAmountLabel', label);
        set('actionDetailsAmount', Number.isFinite(summary.amount) ? UIUtils.formatBalanceCurrency(summary.amount) : '');
        if (Number.isFinite(summary.amount)) texts.push(`${label}: ${UIUtils.formatCurrency(summary.amount)}`);

        const makeTable = (caption, columns, rows, total = null) => {
            const section = document.createElement('section'); section.className = 'balance-action-table-scroll';
            const heading = document.createElement('h3'); heading.className = 'balance-action-section-title'; heading.textContent = caption;
            const box = document.createElement('div'); box.className = 'ds-table-box';
            box.appendChild(heading);
            if (columns.length) { box.setAttribute('tabindex', '0'); box.setAttribute('role', 'region'); box.setAttribute('aria-label', caption); }
            const table = document.createElement('table'); table.className = 'ds-table balance-action-table';
            const name = document.createElement('caption'); name.textContent = caption; table.appendChild(name);
            texts.push(caption);
            if (columns.length) {
                const head = document.createElement('thead'), row = document.createElement('tr');
                for (const column of columns) {
                    const cell = document.createElement('th'); cell.setAttribute('scope', 'col'); cell.textContent = column;
                    if (column === 'Profil') cell.className = 'balance-action-profile';
                    if (['Brutto', 'Steuern', 'Netto', 'Betrag'].includes(column) || column.startsWith('Steuern (')) cell.className = 'balance-action-number';
                    row.appendChild(cell);
                }
                head.appendChild(row); table.appendChild(head); texts.push(columns.join(' | '));
            }
            const body = document.createElement('tbody');
            const add = (values, isTotal = false) => {
                const row = document.createElement('tr'); if (isTotal) row.className = 'balance-action-total';
                const precise = [];
                for (const [index, value] of values.entries()) {
                    const cell = document.createElement('td');
                    if (typeof value === 'number' || value === null) {
                        cell.className = 'balance-action-number'; cell.textContent = money(value, UIUtils.formatBalanceCurrency);
                        precise.push(money(value, UIUtils.formatCurrency));
                    } else { cell.textContent = value; precise.push(value); }
                    if (columns[index] === 'Profil') cell.className = 'balance-action-profile';
                    row.appendChild(cell);
                }
                body.appendChild(row); texts.push(precise.join(' | '));
            };
            rows.forEach(row => add(row)); if (total) add(total, true);
            table.appendChild(body); box.appendChild(table); section.appendChild(box); return section;
        };
        const rowTable = (caption, rows) => makeTable(caption, [], rows.map(row => [row.label, row.amount]));
        const trancheText = source => {
            const date = typeof source?.purchaseDate === 'string' ? source.purchaseDate : '';
            const full = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(date);
            const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(date);
            const purchase = full ? `${full[3]}.${full[2]}.${full[1]}` : month ? `${month[2]}/${month[1]}` : '';
            return [source?.name, purchase ? `Kauf ${purchase}` : ''].filter(Boolean).join(' · ') || '—';
        };
        const profileEntries = this._materialProfileActions();
        const actions = profileEntries ? profileEntries.map(entry => entry?.action || {}) : [action];
        const isSale = actions.some(item => (item.quellen || []).some(q => q.brutto > 0 && !['liquiditaet', 'geldmarkt'].includes(q.kind) && q.source !== 'Liquidität'));
        const isPurchase = actions.some(item => ['gold', 'aktien', 'bonds'].some(key => item.verwendungen?.[key] > 0));
        if (plan) {
            const taxes = plan.sourceRows.filter(row => row.tax);
            const sources = plan.sourceRows.filter(row => !taxes.includes(row));
            if (sources.length) {
                const taxLabel = !plan.household && plan.displaySteuer > 0
                    ? `Steuern (${action.taxSettlement ? 'final, Settlement' : 'geschätzt'})` : 'Steuern';
                const columns = [...(plan.household ? ['Profil'] : []), 'Quelle', 'Tranche', 'Brutto', taxLabel, 'Netto'];
                const values = sources.map(row => {
                    const q = row.source;
                    const sourceLabel = q?.isin && !row.label.includes(q.isin) ? `${row.label} · ${q.isin}` : row.label;
                    return [...(plan.household ? [row.profile] : []), sourceLabel, trancheText(q),
                        row.amount, Number.isFinite(q?.steuer) ? q.steuer : null, Number.isFinite(q?.netto) ? q.netto : null];
                });
                content.appendChild(makeTable(`Woher das Geld kommt${isSale ? ' · Verkäufe' : ''}`, columns, values,
                    [...(plan.household ? [''] : []), 'Summe', '', plan.displayBrutto, plan.displaySteuer, plan.displayNetto]));
            }
            const additional = plan.sourceSummaryRows.filter(row => !['Summe Quellen (Brutto):', 'Steuern (gesamt):'].includes(row.label));
            const taxDetails = taxes.filter(row => !sources.length || plan.household
                || additional.length > 0 && row.label.includes('Settlement'));
            const details = [...taxDetails.map(row => ({ ...row, label: plan.household && row.profile ? `${row.profile}: ${row.label}` : row.label })), ...additional];
            if (details.length) content.appendChild(rowTable('Quellen- und Steuerdetails', details));
            const transfers = [];
            for (const entry of profileEntries || [{ action }]) {
                const item = entry?.action || {};
                const local = summarizeBalanceAction(item, item);
                const amount = local.verb === 'Umschichten' ? local.amount : local.extraTransfer;
                if (!(amount > 0)) continue;
                const cashSources = (item.quellen || []).filter(q => ['liquiditaet', 'geldmarkt'].includes(q.kind) || q.source === 'Liquidität');
                const from = [...new Set(cashSources.map(q => q.kind === 'geldmarkt' ? 'Geldmarkt-ETF' : 'Tagesgeld'))].join(' / ');
                const to = item.verwendungen?.geldmarkt > 0 ? 'Geldmarkt-ETF' : item.verwendungen?.liquiditaet > 0 ? 'Tagesgeld' : 'Richtung nicht verfügbar';
                transfers.push([`${from} → ${to}`, ...(plan.household ? [entry?.name || 'Profil'] : []), amount]);
            }
            if (transfers.length) content.appendChild(makeTable('Interne Umschichtung · erhöht die Liquidität nicht', [], transfers));
        }
        // Nur passende vorhandene Ergebnisdaten, keine neue Nachherberechnung.
        const useRows = plan?.useRows || [];
        const hasCoverage = Number.isFinite(context.liquiditaet?.deckungNachher);
        const hasTarget = Number.isFinite(context.input?.liquidityRunwayYears);
        const isLiquidityUse = row => /Zufluss Liquidit(?:ä|ae)t/.test(row.label);
        if (useRows.length || hasCoverage || hasTarget) {
            const card = document.createElement('section'); card.className = 'balance-action-uses ds-plan-card';
            const head = document.createElement('h3'); head.className = 'balance-action-section-title'; head.textContent = 'Wohin es fließt';
            card.appendChild(head); texts.push(head.textContent);
            const addUse = (label, detail, visible, precise) => {
                const row = document.createElement('div'); row.className = 'balance-action-use-row';
                for (const [text, className] of [[label, ''], [detail, 'ds-source'], [visible, 'balance-action-number']]) {
                    const node = document.createElement('span'); node.className = className; node.textContent = text; row.appendChild(node);
                }
                card.appendChild(row); texts.push([label, detail, precise].filter(Boolean).join(' | '));
            };
            for (const row of useRows) {
                const liquidity = isLiquidityUse(row);
                const detail = liquidity && hasTarget
                    ? `Liquiditätsziel: ${context.input.liquidityRunwayYears * 12} Monate Nettoentnahme` : '';
                const label = row.label.replace(/:$/, '').replace('Liquiditaet', 'Liquidität');
                const prefix = liquidity ? '+' : '';
                addUse(label, detail, prefix + money(row.amount, UIUtils.formatBalanceCurrency), prefix + money(row.amount, UIUtils.formatCurrency));
            }
            if (hasTarget && !useRows.some(isLiquidityUse)) {
                const months = `${context.input.liquidityRunwayYears * 12} Monate`;
                addUse('Liquiditätsziel', 'Nettoentnahme', months, months);
            }
            if (hasCoverage) {
                const coverage = `${context.liquiditaet.deckungNachher.toLocaleString('de-DE', { maximumFractionDigits: 1 })} % des Ziels`;
                addUse('Danach', 'laut Berechnung', coverage, coverage);
            }
            content.appendChild(card);
        }
        const note = isSale
            ? 'Die Empfehlung bucht nichts. Verkäufe erfasst du im Vermögen – im Haushalt jeweils im Profil, dem die Tranche gehört. Balance rechnet danach mit dem neuen Bestand.'
            : isPurchase ? 'Die Empfehlung bucht nichts. Käufe erfasst du im Vermögen – im Haushalt jeweils im zugehörigen Profil. Balance rechnet danach mit dem neuen Bestand.'
                : summary.verb === 'Umschichten' ? 'Die Empfehlung bucht nichts. Umschichtungen erfasst du im Vermögen. Balance rechnet danach mit dem neuen Bestand.'
                    : 'Die Empfehlung bucht nichts. Balance rechnet mit dem vorhandenen Bestand.';
        set('actionDetailsNote', note); texts.push(note);
        set('actionManagerLink', isSale ? 'Verkauf erfassen →' : isPurchase ? 'Kauf erfassen →' : 'Vermögen öffnen →');
        const purposeHost = outputs.actionPurposeContent;
        purposeHost?.replaceChildren();
        if (plan?.purposeRows.length) (purposeHost || content).appendChild(rowTable('Plan nach Zweck',
            plan.purposeRows.map(row => ({ ...row, label: row.label.replace(/:$/, '') }))));
        const profiles = globalThis.window?.__profilverbundProfileSummaries;
        const scope = Array.isArray(profiles) && profiles.length ? `Haushalt · ${profiles.map(profile => profile.name || profile.profileId).join(' + ')}`
            : profileEntries?.length ? `Haushalt · ${profileEntries.map(entry => entry?.name || 'Profil').join(' + ')}`
                : globalThis.document?.getElementById?.('suiteProfileContext')?.textContent || context.input?.profilName || 'aktives Profil';
        const engineVersion = outputs.printFooter?.dataset?.engineVersion;
        const date = outputs.balanceMarketDate?.textContent;
        const footer = [year ? `Stand: Planungsjahr ${year}` : '', scope,
            date && date !== 'nicht verfügbar' ? `Marktdaten ${date}` : ''].filter(Boolean).join(' · ');
        set('printFooter', footer); texts.push(footer);
        if (engineVersion && outputs.printFooter) {
            const version = document.createElement('small'); version.className = 'balance-action-engine-version';
            version.textContent = ` · Engine ${engineVersion}`; outputs.printFooter.appendChild(version);
        }
        this.copyText = texts.filter(Boolean).join('\n');
    }

    _hasMeaningfulFlow(action) { return hasMeaningfulFlow(action); }

    _materialProfileActions() {
        return materialProfileActions(globalThis.window?.__profilverbundActionResults);
    }

    _summarizeAction(action, uiAction) {
        return summarizeBalanceAction(action, uiAction, globalThis.window?.__profilverbundActionResults);
    }

    /**
     * Integrates the internal cash rebalance into the standard action object
     * so it renders strictly as part of the transaction card (like ETFs).
     */
    _integrateCashRebalance(originalAction, rebalance) {
        if (!rebalance) return originalAction;

        // Deep clone to avoid mutating the original Engine result
        const action = JSON.parse(JSON.stringify(originalAction));

        // Ensure it looks like a transaction
        action.type = 'TRANSACTION';
        if (!action.title || action.title.includes('Kein Handlungsbedarf')) {
            action.title = 'Liquiditäts-Management';
            action.anweisungKlasse = 'anweisung-gelb'; // Upgrade to action color
        } else {
            action.title += ' & Geldmarkt-Opt.';
        }

        if (!action.quellen) action.quellen = [];
        if (!action.verwendungen) action.verwendungen = {};

        if (rebalance.to === 'Geldmarkt-ETF') {
            // BUY Money Market (Source: Liquidity)
            let liqSource = action.quellen.find(q => q.kind === 'liquiditaet' || q.source === 'Liquidität');
            if (!liqSource) {
                liqSource = { kind: 'liquiditaet', brutto: 0, netto: 0, steuer: 0 };
                action.quellen.unshift(liqSource);
            }
            liqSource.brutto += rebalance.amount;
            liqSource.netto += rebalance.amount; // Assuming cash is tax free

            // Add Use
            action.verwendungen.geldmarkt = (action.verwendungen.geldmarkt || 0) + rebalance.amount;

        } else if (rebalance.from === 'Geldmarkt-ETF') {
            // SELL Money Market (Source: Geldmarkt-ETF, Use: Liquidity)
            // Add Source
            action.quellen.push({
                kind: 'geldmarkt',
                brutto: rebalance.amount,
                netto: rebalance.amount,
                steuer: 0 // Ignoring tax for internal helper for now
            });

            // Add Use (Liquidity Refill)
            action.verwendungen.liquiditaet = (action.verwendungen.liquiditaet || 0) + rebalance.amount;
        }

        // Update Totals
        action.nettoErlös = action.quellen.reduce((sum, q) => sum + (q.netto || 0), 0);

        return action;
    }

    _resolveZielTagesgeld(spending, targetLiquidity) {
        const annualWithdrawal = (typeof spending?.monatlicheEntnahme === 'number' && isFinite(spending.monatlicheEntnahme))
            ? spending.monatlicheEntnahme * 12
            : null;
        const monthlyWithdrawal = (typeof spending?.monatlicheEntnahme === 'number' && isFinite(spending.monatlicheEntnahme))
            ? spending.monatlicheEntnahme
            : null;
        if (typeof annualWithdrawal === 'number' && isFinite(annualWithdrawal)) {
            return annualWithdrawal + ((monthlyWithdrawal || 0) * 2);
        }
        return (typeof targetLiquidity === 'number' && isFinite(targetLiquidity)) ? targetLiquidity : 0;
    }

    _splitLiquiditySource(input, action, spending, targetLiquidity) {
        if (!input || typeof input.tagesgeld !== 'number' || typeof input.geldmarktEtf !== 'number') {
            return null;
        }
        const zielTagesgeld = this._resolveZielTagesgeld(spending, targetLiquidity);
        const liquidityOutflow = (Array.isArray(action?.quellen) ? action.quellen : [])
            .filter(q => q.kind === 'liquiditaet' || q.source === 'Liquidität')
            .reduce((sum, q) => sum + (q.brutto || 0), 0);
        if (!isFinite(liquidityOutflow) || liquidityOutflow <= 0) {
            return null;
        }
        const availableFromTagesgeld = Math.max(0, input.tagesgeld - zielTagesgeld);
        const fromTagesgeld = Math.min(liquidityOutflow, availableFromTagesgeld);
        const fromGeldmarkt = Math.max(0, liquidityOutflow - fromTagesgeld);
        return {
            zielTagesgeld,
            fromTagesgeld,
            fromGeldmarkt,
            totalOutflow: liquidityOutflow
        };
    }

    /**
     * Berechnet interne Cash-Umschichtungen nach einer Transaktion.
     *
     * @param {Object|null} input - Originale Eingabedaten des Nutzers.
     * @param {Object} action - Handlungsempfehlung, insbesondere Verwendungsströme.
     * @param {Object} spending - Entnahmedaten zur Ableitung der Jahresentnahme.
     * @param {number} [targetLiquidity] - (Optional) Ziel-Liquidität aus der Engine.
     * @returns {Object|null} Handlungsvorschlag für ein internes Rebalancing.
     */
    determineInternalCashRebalance(input, action, spending, targetLiquidity) {
        if (!input || typeof input.tagesgeld !== 'number' || typeof input.geldmarktEtf !== 'number') {
            return null;
        }

        const zielTagesgeld = this._resolveZielTagesgeld(spending, targetLiquidity);

        if (!isFinite(zielTagesgeld)) {
            // console.warn('ActionRenderer.determineInternalCashRebalance: Kein Ziel-Tagesgeld ermittelbar.');
            return null;
        }

        const split = this._splitLiquiditySource(input, action, spending, targetLiquidity) || {
            zielTagesgeld,
            fromTagesgeld: 0,
            fromGeldmarkt: 0,
            totalOutflow: 0
        };
        const liqZufluss = (action.verwendungen?.liquiditaet || 0); // Money coming IN from sales

        const tagesgeldAfterOutflow = input.tagesgeld - split.fromTagesgeld;
        const gapToTarget = Math.max(0, zielTagesgeld - tagesgeldAfterOutflow);
        const inflowToTagesgeld = Math.min(liqZufluss, gapToTarget);
        const virtualTagesgeld = tagesgeldAfterOutflow + inflowToTagesgeld;
        const diff = virtualTagesgeld - zielTagesgeld; // positive = excess, negative = need refill

        const schwelle = UIUtils.getThreshold('THRESHOLDS.STRATEGY.cashRebalanceThreshold', 2500);

        if (diff > schwelle) {
            // FIX: Use FLOOR for excess to be safe and NOT drain below target
            const amount = this._quantize(diff, 'floor');
            if (amount > 0) {
                return { from: 'Tagesgeld', to: 'Geldmarkt-ETF', amount: amount };
            }
        } else if (diff < -schwelle) {
            const needed = Math.abs(diff);
            const geldmarktAfterOutflow = input.geldmarktEtf - split.fromGeldmarkt + (liqZufluss - inflowToTagesgeld);
            let canRefill = Math.min(needed, geldmarktAfterOutflow);

            // Only quantize if significantly large (floor to avoid overdraw)
            canRefill = this._quantize(canRefill, 'floor');
            canRefill = Math.min(canRefill, geldmarktAfterOutflow);

            if (canRefill > 0) {
                return { from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount: canRefill };
            }
        }
        return null;
    }

    /**
     * Quantizes an amount based on the Engine's Anti-Pseudo-Accuracy rules.
     * Replicates the logic from TransactionEngine.
     * @param {number} amount
     * @param {string} [mode='ceil'] - 'ceil' or 'floor'
     * @returns {number} Quantized amount
     */
    _quantize(amount, mode = 'ceil') {
        if (amount < 0) return 0;

        // Fetch config via global API
        const config = (window.EngineAPI && window.EngineAPI.getConfig && window.EngineAPI.getConfig())
            ? window.EngineAPI.getConfig().ANTI_PSEUDO_ACCURACY
            : { ENABLED: true, QUANTIZATION_TIERS: [] }; // Fallback defaults

        if (!config || !config.ENABLED) return Math.floor(amount);

        // Find tier
        const tiers = config.QUANTIZATION_TIERS || [];
        const tier = tiers.find(t => amount < t.limit);
        const step = tier ? tier.step : 25000; // Use 25k as default step for large amounts

        if (mode === 'floor') {
            return Math.floor(amount / step) * step;
        }
        return Math.ceil(amount / step) * step;
    }

    /**
     * Projiziert die bisherigen Quellen-, Verwendungs- und Zweckzeilen numerisch.
     *
     * @param {Object} action - Handlungsempfehlung mit Quellen und Verwendungen.
     */
    _projectTransaction(action, input, spending, targetLiquidity) {
        // Beträge bleiben numerisch bis zur Anzeige-/Textausgabe.
        const createRow = (label, amount, source = null, profile = '', tax = false) => ({
            label: displayDiagnosisText(label).replace(/^-\s*/, ''), amount, source, profile, tax
        });

        const buildPurposeSummary = () => {
            const uses = action?.verwendungen || {};
            const rows = [];
            const add = (label, amount) => {
                if (typeof amount === 'number' && isFinite(amount) && amount > minVisibleUse) {
                    rows.push(createRow(label, amount));
                }
            };
            add('Liquidität auffüllen:', uses.liquiditaet || 0);
            add('Gold-Ziel aufbauen:', uses.gold || 0);
            add('Aktienquote herstellen:', uses.aktien || 0);
            add('Geldmarkt/Zieltopf aufbauen:', uses.geldmarkt || 0);
            add('Anleihen-Zieltopf aufbauen:', uses.bonds || 0);
            if (displaySteuer > 0) {
                rows.push(createRow('Steuerzahlung:', displaySteuer));
            }
            const totalUses = (uses.liquiditaet || 0) + (uses.gold || 0) + (uses.aktien || 0) + (uses.geldmarkt || 0) + (uses.bonds || 0);
            const rest = Math.max(0, displayNetto - totalUses);
            add('Rest/Puffer:', rest);
            return rows;
        };

        const quellenMap = {
            'gold': 'Gold',
            'aktien_neu': 'Aktien (neu)',
            'aktien_alt': 'Aktien (alt)',
            'anleihe': 'Anleihen (Bonds)',
            'liquiditaet': 'Liquidität (Cash)',
            'geldmarkt': 'Geldmarkt-ETF'
        };

        // Die ISIN ergänzt _renderDetails; Name und Kaufdatum stehen nur in „Tranche“.
        const buildQuelleLabel = q => quellenMap[q.kind] || q.kind || 'Quelle';
        const quellenList = Array.isArray(action.quellen) ? action.quellen : [];
        const split = this._splitLiquiditySource(input, action, spending, targetLiquidity);
        const quellenItems = [];

        const verwendungenItems = [];
        const annualWithdrawal = (typeof action?.spending?.monatlicheEntnahme === 'number' && isFinite(action.spending.monatlicheEntnahme))
            ? action.spending.monatlicheEntnahme * 12
            : null;
        if (annualWithdrawal) {
            const zielTagesgeld = annualWithdrawal + (action.spending.monatlicheEntnahme * 2);
            verwendungenItems.push(createRow('Ziel Tagesgeld (Jahr + 2 Monate):', zielTagesgeld));
        }
        const minVisibleUse = 0;
        if (action.verwendungen?.liquiditaet > minVisibleUse) {
            verwendungenItems.push(createRow('Zufluss Liquidität:', action.verwendungen.liquiditaet));
        }
        if (action.verwendungen?.gold > 0) verwendungenItems.push(createRow('Kauf von Gold:', action.verwendungen.gold));
        if (action.verwendungen?.aktien > 0) verwendungenItems.push(createRow('Kauf von Aktien:', action.verwendungen.aktien));
        if (action.verwendungen?.geldmarkt > 0) verwendungenItems.push(createRow('Kauf von Geldmarkt-ETF:', action.verwendungen.geldmarkt));
        if (action.verwendungen?.bonds > 0) verwendungenItems.push(createRow('Kauf von Anleihen (Bonds):', action.verwendungen.bonds));

        const profilverbundActionResults = (typeof window !== 'undefined') ? window.__profilverbundActionResults : null;
        const profilverbundProfiles = (typeof window !== 'undefined') ? window.__profilverbundProfileSummaries : null;
        const hasProfilverbundProfiles = profilverbundProfiles && Array.isArray(profilverbundProfiles) && profilverbundProfiles.length > 0;
        const hasProfilverbundMaterialActions = Boolean(this._materialProfileActions());
        let displayNetto = action.nettoErlös || 0;
        let displayBrutto = 0;
        let displaySteuer = action.steuer || 0;
        if (hasProfilverbundMaterialActions) {
            displayNetto = profilverbundActionResults.reduce((sum, entry) => sum + (entry?.action?.nettoErlös || 0), 0);
            displaySteuer = profilverbundActionResults.reduce((sum, entry) => sum + (entry?.action?.steuer || 0), 0);
            displayBrutto = profilverbundActionResults.reduce((sum, entry) => {
                const list = Array.isArray(entry?.action?.quellen) ? entry.action.quellen : [];
                return sum + list.reduce((inner, q) => inner + (q?.brutto || 0), 0);
            }, 0);
        } else {
            const list = Array.isArray(action.quellen) ? action.quellen : [];
            displayBrutto = list.reduce((sum, q) => sum + (q?.brutto || 0), 0);
        }

        if (hasProfilverbundMaterialActions) {
            quellenItems.length = 0;
            verwendungenItems.length = 0;
            if (annualWithdrawal) {
                const zielTagesgeld = annualWithdrawal + (action.spending.monatlicheEntnahme * 2);
                verwendungenItems.push(createRow('Ziel Tagesgeld (Jahr + 2 Monate):', zielTagesgeld));
            }
            profilverbundActionResults.forEach(entry => {
                const entryAction = entry?.action || {};
                const entryInput = entry?.input || input;
                const entrySpending = entry?.spending || spending;
                const entryTarget = entry?.targetLiquidity;
                const entryName = entry?.name || 'Profil';
                const entryQuellen = Array.isArray(entryAction.quellen) ? entryAction.quellen : [];
                const splitEntry = this._splitLiquiditySource(entryInput, entryAction, entrySpending, entryTarget);

                if (entryQuellen.length > 0) {
                    entryQuellen.forEach(q => {
                        if (q.kind === 'liquiditaet' && splitEntry && splitEntry.totalOutflow > 0) {
                            if ((splitEntry.fromTagesgeld || 0) > 0) {
                                quellenItems.push(createRow('Tagesgeld', splitEntry.fromTagesgeld, null, entryName));
                            }
                            if ((splitEntry.fromGeldmarkt || 0) > 0) {
                                quellenItems.push(createRow('Geldmarkt-ETF', splitEntry.fromGeldmarkt, null, entryName));
                            }
                            return;
                        }
                        quellenItems.push(createRow(buildQuelleLabel(q), q.brutto || 0, q, entryName));
                    });
                }
                if ((entryAction.steuer || 0) > 0) {
                    quellenItems.push(createRow(`Steuern (${entryAction.taxSettlement ? 'final, Settlement' : 'geschätzt'})`, entryAction.steuer || 0, null, entryName, true));
                }

                const uses = entryAction.verwendungen || {};
                if (uses.gold > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Gold`, uses.gold));
                if (uses.aktien > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Aktien`, uses.aktien));
                if (uses.geldmarkt > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Geldmarkt-ETF`, uses.geldmarkt));
                if (uses.bonds > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Anleihen (Bonds)`, uses.bonds));
                if (uses.liquiditaet > minVisibleUse) verwendungenItems.push(createRow(`- ${entryName}: Zufluss Liquiditaet`, uses.liquiditaet));
            });
        } else if (hasProfilverbundProfiles) {
            const totalProfiles = profilverbundProfiles.length;
            const sourceTotals = new Array(totalProfiles).fill(0);
            const totalAssets = profilverbundProfiles.map(profile => profile.totalAssets || 0);

            const sumWeights = (weights) => weights.reduce((sum, value) => sum + value, 0);
            const distributeAmount = (amount, weights) => {
                const totalWeight = sumWeights(weights);
                if (!amount || !isFinite(amount)) {
                    return weights.map(() => 0);
                }
                if (totalWeight <= 0) {
                    const share = totalProfiles > 0 ? amount / totalProfiles : 0;
                    return weights.map(() => share);
                }
                return weights.map(weight => amount * (weight / totalWeight));
            };

            const addRows = (label, allocations, source = null, tax = false) => {
                allocations.forEach((amount, index) => {
                    if (!(amount > 0)) return;
                    const profileName = profilverbundProfiles[index]?.name || `Profil ${index + 1}`;
                    quellenItems.push(createRow(label, amount || 0, source ? { ...source, netto: null, steuer: null } : null, profileName, tax));
                    sourceTotals[index] += amount || 0;
                });
            };

            quellenItems.length = 0;
            const quellenEntries = Array.isArray(action.quellen) ? action.quellen : [];
            const splitLiquidity = this._splitLiquiditySource(input, action, spending, targetLiquidity);

            if (quellenEntries.length > 0) {
                quellenEntries.forEach(q => {
                    if (!q) return;
                    const kind = q.kind || '';
                    if (kind === 'liquiditaet' || q.source === 'Liquidität') {
                        if (splitLiquidity && splitLiquidity.totalOutflow > 0) {
                            const tagesgeldWeights = profilverbundProfiles.map(profile => profile.tagesgeld || 0);
                            const geldmarktWeights = profilverbundProfiles.map(profile => profile.geldmarkt || 0);
                            addRows('Tagesgeld', distributeAmount(splitLiquidity.fromTagesgeld || 0, tagesgeldWeights));
                            addRows('Geldmarkt-ETF', distributeAmount(splitLiquidity.fromGeldmarkt || 0, geldmarktWeights));
                        } else {
                            const liquidityWeights = profilverbundProfiles.map(profile => (profile.tagesgeld || 0) + (profile.geldmarkt || 0));
                            addRows('Liquiditaet', distributeAmount(q.brutto || 0, liquidityWeights));
                        }
                        return;
                    }

                    let weights = totalAssets;
                    if (kind === 'geldmarkt') {
                        weights = profilverbundProfiles.map(profile => profile.geldmarkt || 0);
                    } else if (kind === 'gold') {
                        weights = profilverbundProfiles.map(profile => profile.gold || 0);
                    } else if (kind === 'aktien_alt') {
                        weights = profilverbundProfiles.map(profile => profile.depotAlt || 0);
                    } else if (kind === 'aktien_neu') {
                        weights = profilverbundProfiles.map(profile => profile.depotNeu || 0);
                    }

                    addRows(buildQuelleLabel(q), distributeAmount(q.brutto || 0, weights), q);
                });
            }

            const taxTotal = action.steuer || 0;
            if (taxTotal > 0) {
                const taxWeights = sourceTotals.some(total => total > 0) ? sourceTotals : totalAssets;
                addRows(action.taxSettlement ? 'Steuern (final, Settlement)' : 'Steuern (geschätzt)', distributeAmount(taxTotal, taxWeights), null, true);
            }

            verwendungenItems.length = 0;
            if (annualWithdrawal) {
                const zielTagesgeld = annualWithdrawal + (action.spending.monatlicheEntnahme * 2);
                verwendungenItems.push(createRow('Ziel Tagesgeld (Jahr + 2 Monate):', zielTagesgeld));
            }
            const usageTotals = action?.verwendungen || {};
            const usageEntries = [
                { key: 'gold', label: 'Kauf von Gold' },
                { key: 'aktien', label: 'Kauf von Aktien' },
                { key: 'geldmarkt', label: 'Kauf von Geldmarkt-ETF' },
                { key: 'bonds', label: 'Kauf von Anleihen (Bonds)' },
                { key: 'liquiditaet', label: 'Zufluss Liquiditaet' }
            ];
            const usageWeights = sourceTotals.some(total => total > 0) ? sourceTotals : totalAssets;
            usageEntries.forEach(entry => {
                const total = usageTotals[entry.key] || 0;
                if (total <= 0) return;
                distributeAmount(total, usageWeights).forEach((amount, index) => {
                    if (amount <= 0) return;
                    const profileName = profilverbundProfiles[index]?.name || `Profil ${index + 1}`;
                    verwendungenItems.push(createRow(`- ${profileName}: ${entry.label}`, amount));
                });
            });
        } else {
            quellenList.forEach(q => {
                if (q.kind === 'liquiditaet' && split && split.totalOutflow > 0) {
                    if (split.fromTagesgeld > 0) {
                        quellenItems.push(createRow('- Tagesgeld', split.fromTagesgeld));
                    }
                    if (split.fromGeldmarkt > 0) {
                        quellenItems.push(createRow('- Geldmarkt-ETF', split.fromGeldmarkt));
                    }
                    return;
                }
                quellenItems.push(createRow(buildQuelleLabel(q), q.brutto || 0, q));
            });
            const actionTax = Number(action?.steuer || 0);
            if (actionTax > 0) {
                const taxRowLabel = action?.taxSettlement ? '- Steuern (final, Settlement)' : '- Steuern (geschätzt)';
                const steuerRow = createRow(taxRowLabel, actionTax, null, '', true);
                quellenItems.push(steuerRow);
            }
        }

        const quellenSummaryRows = [
            createRow('Summe Quellen (Brutto):', displayBrutto)
        ];
        if (displaySteuer > 0) {
            quellenSummaryRows.push(createRow('Steuern (gesamt):', displaySteuer));
        }
        const taxSettlement = (action?.taxSettlement && typeof action.taxSettlement === 'object')
            ? action.taxSettlement
            : null;
        const taxBeforeLossCarry = Number(taxSettlement?.taxBeforeLossCarry);
        const taxAfterLossCarry = Number(taxSettlement?.taxAfterLossCarry);
        const taxSavedByLossCarry = Number(taxSettlement?.taxSavedByLossCarry);
        if (Number.isFinite(taxBeforeLossCarry) && taxBeforeLossCarry > 0) {
            quellenSummaryRows.push(createRow('Steuern vor Verlusttopf:', taxBeforeLossCarry));
        }
        if (Number.isFinite(taxAfterLossCarry) && taxAfterLossCarry > 0) {
            quellenSummaryRows.push(createRow('Steuern nach Verlusttopf:', taxAfterLossCarry));
        }
        if (Number.isFinite(taxSavedByLossCarry) && taxSavedByLossCarry > 0) {
            quellenSummaryRows.push(createRow('Steuerersparnis Verlusttopf:', taxSavedByLossCarry));
        }

        const purposeSummaryRows = buildPurposeSummary();
        // Vorhandene Profil-Settlementdetails ebenfalls lesend übernehmen.
        if (hasProfilverbundMaterialActions) {
            for (const entry of profilverbundActionResults) {
                const settlement = entry?.action?.taxSettlement;
                for (const [key, label] of [['taxBeforeLossCarry', 'Steuern vor Verlusttopf'], ['taxAfterLossCarry', 'Steuern nach Verlusttopf'], ['taxSavedByLossCarry', 'Steuerersparnis Verlusttopf']]) {
                    if (Number.isFinite(settlement?.[key]) && settlement[key] > 0) quellenSummaryRows.push(createRow(`${entry.name || 'Profil'}: ${label}`, settlement[key]));
                }
            }
        }
        return { title: displayDiagnosisText(action.title), protected: action.isPufferSchutzAktiv,
            sourceRows: quellenItems, sourceSummaryRows: quellenSummaryRows, useRows: verwendungenItems,
            purposeRows: purposeSummaryRows, displayNetto, displayBrutto, displaySteuer,
            household: Boolean(hasProfilverbundMaterialActions || hasProfilverbundProfiles) };
    }
}
