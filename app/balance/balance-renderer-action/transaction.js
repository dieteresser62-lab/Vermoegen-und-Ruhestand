import { displayDiagnosisText } from '../balance-diagnosis-transaction.js';
import { liquidityInflowRouting } from '../balance-play-execution.js';

export const transactionMethods = {

    /**
     * Projiziert die bisherigen Quellen-, Verwendungs- und Zweckzeilen numerisch.
     *
     * @param {Object} action - Handlungsempfehlung mit Quellen und Verwendungen.
     */
    _projectTransaction(action, input, spending, targetLiquidity) {
        action = this._actionWithoutInternalTransfer(action);
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
            add('Aktien kaufen:', uses.aktien || 0);
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
            'anleihe': 'Anleihen',
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
            const zielTagesgeld = this._resolveZielTagesgeld(action.spending, targetLiquidity, input);
            verwendungenItems.push(createRow('Ziel Tagesgeld:', zielTagesgeld));
        }
        const minVisibleUse = 0;
        if (action.verwendungen?.liquiditaet > minVisibleUse) {
            verwendungenItems.push({ ...createRow('Zugang Liquidität:', action.verwendungen.liquiditaet),
                routing: liquidityInflowRouting(input, action, spending, targetLiquidity) });
        }
        if (action.verwendungen?.gold > 0) verwendungenItems.push(createRow('Kauf von Gold:', action.verwendungen.gold));
        if (action.verwendungen?.aktien > 0) verwendungenItems.push(createRow('Kauf von Aktien:', action.verwendungen.aktien));
        if (action.verwendungen?.geldmarkt > 0) verwendungenItems.push(createRow('Kauf von Geldmarkt-ETF:', action.verwendungen.geldmarkt));
        if (action.verwendungen?.bonds > 0) verwendungenItems.push(createRow('Kauf von Anleihen:', action.verwendungen.bonds));

        const profilverbundActionResults = (this.profileActionResults ?? globalThis.window?.__profilverbundActionResults)
            ?.map(entry => {
                const transfer = entry.action?.internalCashRebalance;
                return { ...entry, action: this._actionWithoutInternalTransfer(entry.action),
                    ...(transfer?.to === 'Geldmarkt-ETF' && entry.cashSplit ? { cashSplit: { ...entry.cashSplit,
                        fromTagesgeld: Math.max(0, entry.cashSplit.fromTagesgeld - transfer.amount),
                        totalOutflow: Math.max(0, entry.cashSplit.totalOutflow - transfer.amount) } } : {}) };
            });
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
                const zielTagesgeld = this._resolveZielTagesgeld(action.spending, targetLiquidity, input);
                verwendungenItems.push(createRow('Ziel Tagesgeld:', zielTagesgeld));
            }
            profilverbundActionResults.forEach(entry => {
                const entryAction = entry?.action || {};
                const entryInput = entry?.input || input;
                const entrySpending = entry?.spending || spending;
                const entryTarget = entry?.targetLiquidity;
                const entryName = entry?.name || 'Profil';
                const entryQuellen = Array.isArray(entryAction.quellen) ? entryAction.quellen : [];
                const splitEntry = entry.cashSplit ?? this._splitLiquiditySource(entryInput, entryAction, entrySpending, entryTarget);

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
                    quellenItems.push(createRow(`Steuern (${entryAction.taxSettlement && !entryAction.taxEstimated ? 'final, Settlement' : 'geschätzt'})`, entryAction.steuer || 0, null, entryName, true));
                }

                const uses = entryAction.verwendungen || {};
                if (uses.gold > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Gold`, uses.gold));
                if (uses.aktien > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Aktien`, uses.aktien));
                if (uses.geldmarkt > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Geldmarkt-ETF`, uses.geldmarkt));
                if (uses.bonds > 0) verwendungenItems.push(createRow(`- ${entryName}: Kauf von Anleihen`, uses.bonds));
                if (uses.liquiditaet > minVisibleUse) verwendungenItems.push({ ...createRow(`- ${entryName}: Zugang Liquiditaet`, uses.liquiditaet),
                    routing: liquidityInflowRouting(entryInput, entryAction, entrySpending, entryTarget) });
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
                const zielTagesgeld = this._resolveZielTagesgeld(action.spending, targetLiquidity, input);
                verwendungenItems.push(createRow('Ziel Tagesgeld:', zielTagesgeld));
            }
            const usageTotals = action?.verwendungen || {};
            const usageEntries = [
                { key: 'gold', label: 'Kauf von Gold' },
                { key: 'aktien', label: 'Kauf von Aktien' },
                { key: 'geldmarkt', label: 'Kauf von Geldmarkt-ETF' },
                { key: 'bonds', label: 'Kauf von Anleihen' },
                { key: 'liquiditaet', label: 'Zugang Liquiditaet' }
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
                const taxRowLabel = action?.taxSettlement && !action.taxEstimated ? '- Steuern (final, Settlement)' : '- Steuern (geschätzt)';
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
        const taxSettlement = (!hasProfilverbundMaterialActions && !(action.cashOutflowTax > 0) && action?.taxSettlement && typeof action.taxSettlement === 'object')
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
                const settlement = entry?.action?.cashOutflowTax > 0 ? null : entry?.action?.taxSettlement;
                for (const [key, label] of [['taxBeforeLossCarry', 'Steuern vor Verlusttopf'], ['taxAfterLossCarry', 'Steuern nach Verlusttopf'], ['taxSavedByLossCarry', 'Steuerersparnis Verlusttopf']]) {
                    if (Number.isFinite(settlement?.[key]) && settlement[key] > 0) quellenSummaryRows.push(createRow(`${entry.name || 'Profil'}: ${label}`, settlement[key]));
                }
            }
        }
        return { title: displayDiagnosisText(action.title), protected: action.isPufferSchutzAktiv,
            sourceRows: quellenItems, sourceSummaryRows: quellenSummaryRows, useRows: verwendungenItems,
            purposeRows: purposeSummaryRows, displayNetto, displayBrutto, displaySteuer,
            household: Boolean(hasProfilverbundMaterialActions || hasProfilverbundProfiles) };
    },

    /** UI-Transfer zählt weder als Verkauf noch als externer Liquiditätszugang. */
    _actionWithoutInternalTransfer(action = {}) {
        const transfer = action?.internalCashRebalance;
        if (!transfer && !(action?.cashOutflowTax > 0)) return action || {};
        const quellen = (action.quellen || []).filter(source => !source.internalCashRebalance);
        const verwendungen = { ...action.verwendungen };
        if (transfer) {
            const key = transfer.to === 'Geldmarkt-ETF' ? 'geldmarkt' : 'liquiditaet';
            verwendungen[key] = Math.max(0, (verwendungen[key] || 0) - (key === 'liquiditaet' ? transfer.netto : transfer.amount));
        }
        return { ...action, quellen, verwendungen, nettoErlös: quellen.reduce((sum, source) => sum + (source.netto || 0), 0),
            steuer: quellen.reduce((sum, source) => sum + (source.steuer || 0), 0),
            taxSettlement: action.taxSettlement };
    }
};
