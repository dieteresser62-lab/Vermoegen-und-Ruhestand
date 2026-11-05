import { projectBalanceActionOrigin } from '../balance-action-origin.js';
import { UIUtils } from '../balance-utils.js';
import { bindInfoPopovers, createInfoPopover } from '../../shared/designsystem-info-popover.js';
import { displayDiagnosisText } from '../balance-diagnosis-transaction.js';
import { describeBalanceActionSummary, summarizeBalanceAction } from '../balance-action-summary.js';

export const detailsMethods = {

    _renderDetails(content, plan, original, action, summary, context) {
        const outputs = this.dom.outputs;
        const set = (key, text) => { if (outputs[key]) outputs[key].textContent = text; };
        const year = outputs.balancePlanningYear?.textContent || '';
        const origin = context.actionOrigin || projectBalanceActionOrigin();
        const heading = `${origin.previewLabel} · ${summary.purpose || summary.verb}`;
        set('actionDetailsTitle', heading);
        const texts = [heading, describeBalanceActionSummary(summary, UIUtils.formatCurrency)];
        const appendTaxHint = node => node.append(createInfoPopover(content.ownerDocument || document, 'Sparer-Pauschbetrag bei der Steuer',
            'Gerechnet mit vollem Sparer-Pauschbetrag. Hast du ihn in diesem Jahr schon genutzt (Zinsen, Ausschüttungen), fällt die Steuer höher aus.'));
        const paragraph = (text, className = 'ds-source') => {
            if (!text) return;
            const node = document.createElement('p'); node.className = className; node.textContent = text;
            content.appendChild(node); texts.push(text);
        };
        paragraph(origin.previewNotice);
        const title = plan?.threeBucketTrades ? 'Saldo je Anlageklasse' : displayDiagnosisText(plan?.title || action.title || original.title || '');
        paragraph([title, context.market?.szenarioText ? `Marktphase: ${context.market.szenarioText}` : '']
            .filter(Boolean).join(' · '), 'balance-action-detail-title');
        if (plan?.protected) paragraph('PUFFER-SCHUTZ', 'strategy-badge ds-badge');
        // Der generierte Zwecksatz wiederholt die Überschrift. Andere Hinweise
        // (Mindesthandel, Nichtstun, Umschichtung) behalten ihren eigenen Platz.
        if (!summary.purpose || !summary.note.startsWith('Um ')) paragraph(summary.note);
        const money = (amount, formatter) => Number.isFinite(amount) ? formatter(amount) : '—';
        const label = plan?.threeBucketTrades ? 'Handelsbetrag' : summary.amountUnit === '€ netto' ? 'Verkaufserlös netto'
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
                    if (column.startsWith('Steuern')) appendTaxHint(cell);
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
        const isSale = plan?.threeBucketTrades ? plan.threeBucketTrades.some(row => row.net > 0) : actions.some(item => (item.quellen || []).some(q => q.brutto > 0 && !['liquiditaet', 'geldmarkt'].includes(q.kind) && q.source !== 'Liquidität'));
        const isPurchase = plan?.threeBucketTrades ? plan.threeBucketTrades.some(row => row.net < 0) : actions.some(item => ['gold', 'aktien', 'bonds'].some(key => item.verwendungen?.[key] > 0));
        if (plan?.threeBucketTrades) {
            const rows = plan.threeBucketTrades.map(row => [row.profile, row.label, row.net > 0 ? 'verkaufen' : 'kaufen', Math.abs(row.net)]);
            if (rows.length) content.appendChild(makeTable('Auszuführende Aufträge', ['Profil', 'Anlageklasse', 'Auftrag', 'Betrag'], rows));
            const explanation = 'Die Aufträge zeigen den Saldo je Person und Anlageklasse. Freies Tagesgeld füllt zuerst Anleihen. Aus Aktien wird bei marktbedingter Auszahlung aus Anleihen, unterschrittenem realem Renditeauslöser, Anleihenverkauf oder gleichzeitigem Aktienkauf nicht aufgefüllt. Erholungsjahre ohne diese Sperren erlauben eine Auffüllung.';
            const info = document.createElement('p');
            info.appendChild(createInfoPopover(content.ownerDocument || document, 'Bewegungen der drei Töpfe', explanation));
            content.appendChild(info);
            /** @type {import("../../../typcheck/simulator-ui.js").BindInfoPopovers} */ (bindInfoPopovers)(content.ownerDocument || document, { root: info });
            const tax = document.createElement('p'); tax.textContent = `Steuern gesamt: ${UIUtils.formatCurrency(plan.displaySteuer || 0)}`;
            texts.push(tax.textContent); content.appendChild(tax);
        }
        if (plan && !plan.threeBucketTrades) {
            const taxes = plan.sourceRows.filter(row => row.tax);
            const sources = plan.sourceRows.filter(row => !taxes.includes(row));
            if (sources.length) {
                const taxLabel = !plan.household && (plan.displaySteuer > 0 || action.moneyMarketTaxReduction > 0)
                    ? `Steuern (${action.taxSettlement && !action.taxEstimated ? 'final, Settlement' : 'geschätzt'})` : 'Steuern';
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
        }
        if (plan) {
            const transfers = [];
            for (const entry of profileEntries || [{ action }]) {
                const item = entry?.action || {};
                const local = summarizeBalanceAction(item, item);
                const amount = item.internalCashRebalance?.amount ?? (local.verb === 'Umschichten' ? local.amount : local.extraTransfer);
                if (!(amount > 0)) continue;
                const cashSources = (item.quellen || []).filter(q => ['liquiditaet', 'geldmarkt'].includes(q.kind) || q.source === 'Liquidität');
                const from = [...new Set(cashSources.map(q => q.kind === 'geldmarkt' ? 'Geldmarkt' : 'Tagesgeld'))].join(' / ');
                const to = item.verwendungen?.geldmarkt > 0 ? 'Geldmarkt' : item.verwendungen?.liquiditaet > 0 ? 'Tagesgeld' : 'Richtung nicht verfügbar';
                const transfer = item.internalCashRebalance;
                transfers.push([`${(transfer?.from || from).replace('Geldmarkt-ETF', 'Geldmarkt')} → ${(transfer?.to || to).replace('Geldmarkt-ETF', 'Geldmarkt')}`, ...(plan.household ? [entry?.name || 'Profil'] : []), amount,
                    transfer?.taxUnknown ? 'nicht ermittelbar' : transfer?.steuer ?? 0,
                    transfer?.from === 'Geldmarkt-ETF' && !transfer.taxUnknown ? transfer.netto : null]);
            }
            if (transfers.length) content.appendChild(makeTable('Interne Umschichtung · erhöht die Liquidität nicht',
                ['Umschichtung', ...(plan.household ? ['Profil'] : []), 'Betrag', 'Steuern', 'Zufluss Tagesgeld'], transfers));
            for (const entry of profileEntries || [{ action }]) {
                const item = entry.action;
                const prefix = plan.household ? `${entry.name || 'Profil'}: ` : '';
                if (item.cashOutflowTax > 0) content.appendChild(makeTable('Steuer Kaufdeckung aus Geldmarkt', ['Verwendung', 'Steuern'],
                    [[prefix + 'Kaufdeckung aus Geldmarkt', item.cashOutflowTax]]));
                if (item.partnerMoneyMarketTaxChange > 0) paragraph(`${prefix}Zusammenveranlagung: Pauschbetrag des Partners jetzt für den Geldmarktverkauf genutzt, Verkaufssteuer +${UIUtils.formatCurrency(item.partnerMoneyMarketTaxChange)}.`);
                if (item.moneyMarketTaxReduction > 0) paragraph(item.moneyMarketJointAssessment
                    ? `Geldmarktverlust von ${item.moneyMarketLossOwners?.join(' und ') || 'beiden Personen'} mindert die Steuer von ${entry.name || entry.profileId || 'dieser Person'} um ${UIUtils.formatCurrency(item.moneyMarketTaxReduction)}.`
                    : `${prefix}Geldmarktverlust mindert die Steuer um ${UIUtils.formatCurrency(item.moneyMarketTaxReduction)}`);
                if (item.taxEstimated) paragraph(prefix + 'Steuer geschätzt – die Gewinnbasis der bisherigen Verkäufe fehlt.');
                if (item.automaticExecutionBlocked) paragraph(prefix + item.automaticExecutionBlocked);
            }
        }
        const targetEntries = this.profileActionResults || (this.singleExecutionEntry ? [this.singleExecutionEntry] : []);
        for (const entry of targetEntries) if (entry.liquidityTargetBasis) {
            const basis = entry.liquidityTargetBasis;
            const prefix = targetEntries.length > 1 ? `${entry.name || entry.profileId}: ` : '';
            const info = document.createElement('p');
            info.appendChild(createInfoPopover(content.ownerDocument || document, `${prefix}Tagesgeldziel`,
                `${basis.notice ? basis.notice + ' ' : ''}${basis.source}: ${UIUtils.formatCurrency(basis.annualExpenses)} im Jahr. Rente ${UIUtils.formatCurrency(basis.pension)} und sonstige Einkünfte ${UIUtils.formatCurrency(basis.income)} in den kommenden zwölf Monaten. Bedarf ${UIUtils.formatCurrency(basis.need)}; Tagesgeldziel ${UIUtils.formatCurrency(entry.input.personalTagesgeldTarget)} einschließlich Mindestanteil der eisernen Reserve.`));
            content.appendChild(info);
        }
        // Nur passende vorhandene Ergebnisdaten, keine neue Nachherberechnung.
        const useRows = (plan?.useRows || []).filter(row => !plan?.threeBucketTrades || !/Kauf von (Aktien|Anleihen|Gold)/.test(row.label));
        const hasCoverage = Number.isFinite(context.liquiditaet?.deckungNachher);
        const hasTarget = Number.isFinite(context.input?.liquidityRunwayYears);
        const isLiquidityUse = row => /Zugang Liquidit(?:ä|ae)t/.test(row.label);
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
                if (liquidity && row.routing) {
                    addUse('davon Tagesgeld', '', money(row.routing.tagesgeld, UIUtils.formatBalanceCurrency), money(row.routing.tagesgeld, UIUtils.formatCurrency));
                    addUse('davon Geldmarkt', '', money(row.routing.geldmarkt, UIUtils.formatBalanceCurrency), money(row.routing.geldmarkt, UIUtils.formatCurrency));
                }
            }
            if (hasTarget && !useRows.some(isLiquidityUse)) {
                const months = `${context.input.liquidityRunwayYears * 12} Monate`;
                addUse('Liquiditätsziel', 'Nettoentnahme', months, months);
            }
            if (hasCoverage) {
                const coverage = `${context.liquiditaet.deckungNachher.toLocaleString('de-DE', { maximumFractionDigits: context.liquiditaet.deckungNachher > 100 ? 0 : 1 })} % des Ziels`;
                addUse('Danach', 'laut Berechnung', coverage, coverage);
            }
            content.appendChild(card);
        }
        const note = isSale
            ? 'Die Empfehlung bucht nichts. Verkäufe erfasst du im Vermögen – im Haushalt jeweils im Profil, dem die Tranche gehört. Balance rechnet danach mit dem neuen Bestand.'
            : isPurchase ? 'Die Empfehlung bucht nichts. Käufe erfasst du im Vermögen – im Haushalt jeweils im zugehörigen Profil. Balance rechnet danach mit dem neuen Bestand.'
                : summary.verb === 'Umschichten' ? 'Die Empfehlung bucht nichts. Umschichtungen erfasst du im Vermögen. Balance rechnet danach mit dem neuen Bestand.'
                    : 'Die Empfehlung bucht nichts. Balance rechnet mit dem vorhandenen Bestand.';
        set('actionDetailsNote', 'Die Empfehlung bucht nichts'); texts.push(note);
        const noteHost = outputs.actionDetailsNote;
        if (noteHost) {
            const doc = noteHost.ownerDocument || document;
            noteHost.append(createInfoPopover(doc, 'Erläuterung zur Empfehlung', note));
            bindInfoPopovers(doc, { root: noteHost });
        }
        set('actionManagerLink', isSale ? 'Verkauf erfassen →' : isPurchase ? 'Kauf erfassen →' : 'Vermögen öffnen →');
        const purposeHost = outputs.actionPurposeContent;
        purposeHost?.replaceChildren();
        if (!plan?.threeBucketTrades && plan?.purposeRows.length) (purposeHost || content).appendChild(rowTable('Plan nach Zweck',
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
        bindInfoPopovers(content.ownerDocument || document, { root: content });
    }
};
