import { rowWealthParts, protocolWealthText } from './wealth-display.js';
"use strict";

import { PROTOCOL_GROUPS, getProtocolColumns, readProtocolValue, formatProtocolValue,
    protocolRowData, protocolRowFlags, createProtocolPersonContext, translateProtocolText } from './protocol-columns.js';
import { infoPopoverHtml } from '../shared/designsystem-info-popover.js';
import { protocolCashflowBreakdown, protocolCareNotes, protocolCareState } from './protocol-cashflows.js';
import { noCareAllowanceReason } from '../shared/care-benefits.js';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { FAMILY_HOME_CONDITIONS, spouseTaxNote, inheritancePersonalAllowance } from '../profile/household-partnership.js';
import { displayTradeAmount } from '../shared/transaction-display-text.js';
import { formatDisplayPercentRatio } from '../shared/shared-formatting.js';

/**
 * @param value - Zu prüfender oder darzustellender Wert.
 * @returns {string}
 */
export function escapeProtocolHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
const escape = escapeProtocolHtml;
const chip = (label, tone = '', description = '') => `<span class="sim-status-chip protocol-chip${tone ? ` protocol-chip-${tone}` : ''}"${description ? ` title="${escape(description)}" aria-label="${escape(description)}"` : ''}>${escape(label)}</span>`;
const LOW_WITHDRAWAL_HINT = 'Reale Entnahme unter dem 10-%-Wert aller simulierten Jahre (CaR)';
const protocolInfo = (label, text) => infoPopoverHtml(label, text).replace('class="ds-info-button"', 'class="ds-info-button ds-button"');
const actionMoney = (value, entry, options) => {
    const text = formatProtocolValue({ format: 'money' }, value, entry, options);
    // Echte Centbeträge nicht als Nullverkauf ausgeben, auch nach Kaufkraftumrechnung.
    return displayTradeAmount(value) > 0 && /^0[\u0020\u00a0\u202f]*€$/u.test(text) ? '< 1\u00a0€' : text;
};
const ACTION_EURO_PATTERN = /(?<![\p{L}\p{N}.,])([+−-]?\d+(?:[.,]\d+)*)[\u0020\u00a0\u202f]*€/gu;
function actionAmount(amount) {
    const normalized = amount.includes(',') || /^[+−-]?\d{1,3}(?:\.\d{3})+$/.test(amount)
        ? amount.replaceAll('.', '').replace(',', '.') : amount;
    return Number(normalized.replace('−', '-'));
}
function payoutSaleAmount(raw) {
    const amount = String(raw.aktionUndGrund || '').match(/Verkauf für die Auszahlung\s+([\d.,]+)\s*€/u)?.[1];
    return amount ? displayTradeAmount(actionAmount(amount)) : 0;
}
function actionSaleAmounts(raw) {
    const bonds = displayTradeAmount(raw.vk?.vkBnd);
    const equity = displayTradeAmount(raw.vk?.vkAkt ?? raw.executedSaleAkt
        ?? (displayTradeAmount(raw.executedSaleEq) - bonds));
    const gold = displayTradeAmount(raw.vk?.vkGld);
    const total = displayTradeAmount(Math.max(displayTradeAmount(raw.vk?.vkGes),
        displayTradeAmount(raw.executedSaleEq) + gold, equity + bonds + gold));
    return { equity, bonds, gold, total };
}
function homeSaleText(entry, options) {
    const raw = protocolRowData(entry, options.source);
    return raw.immobilienverkauf > 0 ? `${raw.immobilien_notverkauf ? 'Notverkauf Immobilie' : 'Immobilienverkauf'} ${actionMoney(raw.immobilienverkauf, entry, options)} · ` : '';
}

function noTradeText(raw) {
    const trades = [raw.vk?.vkGes, raw.vk?.vkAkt, raw.vk?.vkBnd, raw.vk?.vkGld,
        raw.executedSaleAkt, raw.executedSaleEq, raw.kaufAkt, raw.kaufGld, raw.bondRefillNet, raw.threeBucket?.bondRefillNet,
        raw.bondRefillGross, raw.threeBucket?.bondRefillGross];
    if (!trades.some(Number.isFinite) || trades.some(value => displayTradeAmount(value) > 0)
        || raw.threeBucketTrades?.some(trade => displayTradeAmount(trade.net) !== 0)
        || !/Runway-Notfüllung|Notfall-Verkauf|Opportunistisches Rebalancing|Bärenmarkt-Auffüllung/u.test(raw.aktionUndGrund || '')) return null;
    const empty = raw.wertAktien === 0 && raw.wertGold === 0
        && !(raw.bondBucketAfter > 0 || raw.threeBucket?.bondBucketAfter > 0);
    return empty ? 'Kein Verkauf möglich: Depot leer, Ausgaben aus dem Tagesgeld'
        : 'Kein Handel ausgeführt; Ausgaben aus dem Tagesgeld';
}

function ruinActionText(entry, options) {
    const raw = protocolRowData(entry, options.source);
    if (raw.recordType !== 'terminal_ruin' && !/RUIN/u.test(raw.aktionUndGrund || '')) return null;
    const reason = raw.ruin_reason || String(raw.aktionUndGrund || '').replace(/>>> RUIN <<</u, '').trim();
    const amounts = reason.match(/^Gesamtvermögen \((-?\d+)\) < Floor \((\d+)\)/u);
    if (!amounts) return `Ruin: ${translateProtocolText(reason).replace(/Floor/gu, 'Grundbedarf')}`;
    // Terminalzeilen haben oft keinen Preisfaktor. Wie die Ruin-Karte den
    // Jahresendstand der unmittelbar vorangehenden Finanzzeile heranziehen.
    const index = options.rows?.findIndex(row => protocolRowData(row, options.source) === raw) ?? -1;
    const previous = index > 0 ? options.rows[index - 1] : null;
    const previousRaw = previous && protocolRowData(previous, options.source);
    const previousInflation = options.source === 'backtest' ? previous?.inflationVJ : previousRaw?.inflation;
    const factor = raw.inflation_factor_cum ?? (previous && previous.jahr + 1 === entry.jahr
        ? previousRaw.inflation_factor_cum * (1 + previousInflation / 100) : raw.jahr === 1 ? 1 : null);
    const real = options.moneyBasis === 'real', known = Number.isFinite(factor) && factor > 0;
    const money = value => formatProtocolValue({ format: 'money' }, Number(value) / (real && known ? factor : 1));
    return `Ruin: Geldvermögen ${money(amounts[1])} reicht nicht für den Grundbedarf von ${money(amounts[2])}${real && !known ? ' (nominal; Kaufkraftbetrag unbekannt)' : ''}`;
}

// Nur die Anzeige umrechnen. Alte Logs enthalten Eurobeträge auch ausschließlich im Text.
function actionDetailText(value, entry, options) {
    const raw = protocolRowData(entry, options.source);
    const ruin = ruinActionText(entry, options);
    if (ruin) return homeSaleText(entry, options) + ruin;
    const noTrade = noTradeText(raw);
    if (noTrade) return homeSaleText(entry, options) + noTrade;
    let detail = String(value ?? '');
    const payout = payoutSaleAmount(raw);
    if (payout > 0 && /Runway-Notfüllung/.test(detail) && Number.isFinite(raw.vk?.vkGes)) {
        detail = detail.replace(/Runway-Notfüllung(?: \([^)]*\))*/u, match =>
            `Liquidität aufgefüllt${match.includes('Cap aktiv') ? ' (begrenzt)' : ''}${match.includes('(Bär)') ? ' (Bärenmarkt)' : ''}: ${Math.max(0, raw.vk.vkGes - payout).toFixed(2)} €`);
    }
    // Erst Quellbeträge formatieren, dann Personentexte ergänzen; keine doppelte Deflation.
    let text = translateProtocolText(detail).replace(ACTION_EURO_PATTERN, (match, amount) => {
        const number = actionAmount(amount);
        return Number.isFinite(number) ? actionMoney(number, entry, options) : match;
    });
    if (payout > 0 && displayTradeAmount(raw.vk?.vkGes - payout) > 0 && /Runway-Notfüllung|Puffer-Auffüllung|Puffer-Sicherung/u.test(raw.aktionUndGrund || '')) {
        text = text.replace('Für die Entnahme verkauft:', 'Zusätzlich für die Entnahme verkauft:');
    }
    if (raw.personalPayoutSales?.length) {
        text = text.replace(/(?:Zusätzlich für|Für) die Entnahme verkauft:\s+[\d.,]+[\u0020\u00a0\u202f]*€/u,
            () => raw.personalPayoutSales.map(person => `${person.name} verkauft ${actionMoney(person.gross, entry, options)} für den eigenen Anteil an den Ausgaben`).join(' · '));
    }
    if (/Notfall-Verkauf \(Puffer-(?:Auffüllung|Sicherung)\)/u.test(detail)) {
        const { equity, bonds, gold } = actionSaleAmounts(raw);
        const sources = [bonds > 0 ? 'Anleihen' : null, equity > 0 ? 'Aktien' : null, gold > 0 ? 'Gold' : null].filter(Boolean);
        if (sources.length) text = text.replace(/Tagesgeld bis zum Mindestpuffer aufgefüllt|Tagesgeld-Mindestpuffer gesichert/u,
            match => `${match} (aus ${sources.join(' und ')}${sources.length === 1 && sources[0] === 'Anleihen' ? ', Aktien geschont' : ''})`);
    }
    return homeSaleText(entry, options) + text;
}

function inheritanceTaxInfo(entry, options) {
    const estate = protocolRowData(entry, options.source).inheritance;
    const sold = new Set();
    for (const row of options.rows || []) {
        for (const sale of protocolRowData(row, options.source).immobilienverkauf_personen || []) sold.add(JSON.stringify([sale.profileId, sale.homeId]));
        if (row === entry) break;
    }
    const familyHomes = (options.inputs?.home || []).filter((home, index) => home.profileId === estate?.deceasedProfileId
        && home.nutzung === 'selbst' && home.wert > 0 && !sold.has(JSON.stringify([home.profileId, home.id ?? index])));
    const familyNote = options.inputs?.partnership?.status !== 'unmarried' && estate?.inheritedHome > 0 && familyHomes.length
        ? ` Familienheim-Befreiung angenommen. ${FAMILY_HOME_CONDITIONS}${familyHomes.length > 1 ? ' Steuerfrei ist nur das Familienheim – bei mehreren selbst genutzten Immobilien die wertvollste.' : ''}` : '';
    const text = options.inputs?.partnership?.status === 'unmarried'
        ? 'Vereinfachte Steuerklasse III: 20.000 € Freibetrag, Tarif 30 % bis 6 Mio. €, darüber 50 %; Härteausgleich nahe der Tarifgrenze.'
        : `Vereinfachte Steuerklasse I: 500.000 € Freibetrag. ${spouseTaxNote(options.inputs?.partnership)}${familyNote}`;
    const gainNote = estate?.exemptGain > 0 ? ` Steuerfrei als Zugewinnausgleich ${estate.exemptGain.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €.` : '';
    const annual = estate?.residenceTax;
    const personalAllowance = options.inputs?.partnership?.status === 'unmarried' ? 20000 : 500000;
    const detail = annual ? ` Jährlich (§ 23 ErbStG): Im Todesjahr nur der Geld- und Immobilienanteil nach Freibetrag; Tarif nach Gesamterwerb einschließlich Wohnrecht. Jahreswert ${annual.annualValue.toLocaleString('de-DE')} €, Steuersatz ${formatDisplayPercentRatio(annual.rate)}. Ab dem Folgejahr nominal fest ${annual.annualTax.toLocaleString('de-DE')} € im Voraus bis Tod oder dauerhafter Heimpflege. Freibetragsrest ${annual.allowanceRemaining.toLocaleString('de-DE')} € wird aufgezehrt (ursprünglich ${personalAllowance.toLocaleString('de-DE')} € persönlicher Freibetrag${estate.exemptGain > 0 ? ` plus ${estate.exemptGain.toLocaleString('de-DE')} € Zugewinnausgleich` : ''}). Sofortvergleich ${annual.immediateComparison.toLocaleString('de-DE')} €.` : '';
    return protocolInfo('Erbschaftsteuer: vereinfachte Rechnung', text + gainNote + detail
        + (options.inputs?.partnership?.status === 'unmarried' ? '' : ' Steuerberater fragen.'))
        .replace('class="ds-info"', 'class="ds-info protocol-tax-info"');
}

function residenceTaxInfo(entry, options) {
    const payment = protocolRowData(entry, options.source).residenceTaxPayment;
    if (!payment) return '';
    const money = value => `${value.toLocaleString('de-DE', { maximumFractionDigits: 2 })} € nominal`;
    return protocolInfo('Steuer Wohnrecht (§ 23)', `Vorauszahlung zu Jahresbeginn aus Tagesgeld oder Verkauf. Jahreswert ${money(payment.annualValue)}, Satz ${formatDisplayPercentRatio(payment.rate)}, feste Jahressteuer ${money(payment.annualTax)}. Davon Jahreswert steuerfrei ${money(payment.exempt)} durch Aufzehrung; Freibetragsrest ${money(payment.allowanceRemaining)}. Endet mit Tod oder dauerhafter Heimpflege.${payment.note ? ` ${payment.note}` : ''}${payment.shortfall > .01 ? ` Ungedeckt: ${money(payment.shortfall)}.` : ''}`);
}

function cashflowInfo(column, entry, options) {
    const breakdown = protocolCashflowBreakdown(entry, options);
    const income = column.id === 'income-total';
    const line = (label, value, className = '') => `<span class="protocol-cashflow-line${className ? ` ${className}` : ''}"><span>${escape(label)}</span><span>${escape(formatProtocolValue(column, value, entry, options))}</span></span>`;
    let content = (income ? breakdown.incomes : breakdown.expenses).map(item => line(item.label, item.amount, item.detail ? 'protocol-cashflow-detail' : '')).join('');
    content += line('Summe', breakdown.totals[income ? 'einnahmen_gesamt' : 'ausgaben_gesamt'], 'protocol-cashflow-sum');
    if (income && breakdown.saved > 0) content += line('davon angelegt', breakdown.saved, 'protocol-cashflow-saved');
    if (income) {
        const row = protocolRowData(entry, options.source), inputs = options.inputs || {};
        for (const index of [0, 1]) {
            if (index === 1 && !inputs.partner?.aktiv) continue;
            const care = protocolCareState(entry, index, options), fallback = row[`CareP${index + 1}_FamilyFallback`];
            // FR-72 Punkt 18: gespeicherte Jahresform; im Heim gilt der Heimgrund auch bei „Amtlich“.
            const reason = noCareAllowanceReason({ grade: care?.grade, careForm: care?.form ?? undefined,
                preset: care?.form === 'residential' ? undefined : inputs.pflegeKostenStaffelPreset });
            if (reason) content += `<span class="ds-help">${escape(options.personDisplayContext?.persons?.[index]?.name || inputs.simulationPeople?.[index]?.name || `Person ${index + 1}`)}: ${escape(reason)}</span>`;
            if (fallback) {
                const other = 1 - index;
                const name = options.personDisplayContext?.persons?.[other]?.name || inputs.simulationPeople?.[other]?.name || `Person ${other + 1}`;
                // Aktuellen Anlass anzeigen; das gemerkte Wechselmerkmal bleibt für Rechnung und Export erhalten.
                const alive = row[`Person${other + 1}Alive`];
                const currentGrade = row[`CareP${other + 1}_Active`] ? row[`CareP${other + 1}_Grade`] : null;
                const cause = alive === 0 || alive === false || fallback.reason === 'death' ? 'verstorben ist'
                    : `selbst Pflegegrad ${currentGrade >= 3 ? currentGrade : fallback.grade} hat`;
                content += `<span class="ds-help">${escape(`Pflegeform: externe Unterstützung, weil ${name} ${cause}.`)}</span>`;
            }
        }
    }
    if (!income) content += line('davon aus dem Vermögen bezahlt', breakdown.withdrawal, 'protocol-cashflow-withdrawal') + protocolCareNotes(entry, options,
        value => formatProtocolValue({ format: 'money' }, value)).map(note => `<span class="ds-help">${escape(note)}</span>`).join('');
    return protocolInfo(`${column.label}: Aufschlüsselung des Jahres`, '').replace('role="tooltip">', `role="tooltip">${content}`);
}

/** Nur die Tabellenanzeige verdichten; Rohwerte und Exportformatter bleiben vollständig.
 *
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers.
 * @param {string} [fallback] - Kontext für fallback.
 * @returns {string}
 */
export function protocolActionShortText(entry, options = {}, fallback = '') {
    const raw = protocolRowData(entry, options.source);
    const ruin = ruinActionText(entry, options);
    if (ruin) return homeSaleText(entry, options) + ruin;
    const noTrade = noTradeText(raw);
    if (noTrade) return homeSaleText(entry, options) + noTrade;
    const text = String(raw.aktionUndGrund || fallback);
    const money = value => actionMoney(value, entry, options);
    const { equity, bonds, gold, total: sale } = actionSaleAmounts(raw);
    const actions = [];
    if (raw.immobilienverkauf > 0) actions.push(`${raw.immobilien_notverkauf ? 'Notverkauf Immobilie' : 'Immobilienverkauf'} ${money(raw.immobilienverkauf)}`);
    if (raw.inheritance) actions.push(`Erbe: ${money(raw.abgang_erben)} verlassen den Haushalt`);
    const bondRefill = displayTradeAmount(raw.bondRefillGross ?? raw.threeBucket?.bondRefillGross);
    const assetSalesKnown = [raw.vk?.vkAkt, raw.vk?.vkBnd, raw.vk?.vkGld, raw.executedSaleAkt, raw.executedSaleEq].some(Number.isFinite);
    if (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE && raw.threeBucketTrades) {
        for (const trade of raw.threeBucketTrades.filter(trade => displayTradeAmount(trade.net) !== 0)) actions.push(`${trade.profile ? trade.profile + ': ' : ''}${trade.label} ${trade.net > 0 ? 'verkaufen' : 'kaufen'} ${money(Math.abs(trade.net))}`);
        return actions.join(' · ') || 'Kein Handlungsbedarf';
    }
    if (raw.personalPayoutSales?.length) {
        const personalSales = raw.personalPayoutSales.reduce((sum, person) => sum + person.gross, 0);
        if (sale - personalSales > .01) actions.push(`Verkauf ${money(sale - personalSales)}`);
        for (const person of raw.personalPayoutSales) actions.push(`${person.name} verkauft ${money(person.gross)} für den eigenen Anteil an den Ausgaben`);
        if (displayTradeAmount(raw.kaufAkt) > 0) actions.push(`Aktien kaufen ${money(raw.kaufAkt)}`);
        if (displayTradeAmount(raw.kaufGld) > 0) actions.push(`Gold kaufen ${money(raw.kaufGld)}`);
        if (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE && displayTradeAmount(raw.bondRefillNet) > 0) actions.push(`Anleihen kaufen ${money(raw.bondRefillNet)}`);
        return actions.join(' · ');
    }
    if (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE && assetSalesKnown) {
        const trade = (label, sale, buy) => {
            const net = displayTradeAmount(displayTradeAmount(sale) - displayTradeAmount(buy));
            if (net !== 0) actions.push(`${label} ${net > 0 ? 'verkaufen' : 'kaufen'} ${money(Math.abs(net))}`);
        };
        trade('Aktien', raw.vk?.vkAkt ?? raw.executedSaleAkt, raw.kaufAkt);
        trade('Anleihen', raw.vk?.vkBnd ?? raw.threeBucket?.bondSaleAmount ?? raw.bondSaleAmount,
            raw.bondRefillNet ?? raw.threeBucket?.bondRefillNet ?? bondRefill);
        trade('Gold', raw.vk?.vkGld, raw.kaufGld);
        return actions.join(' · ') || 'Kein Handlungsbedarf';
    }
    if ((options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE && assetSalesKnown) || bonds > 0 || bondRefill > 0) {
        if (equity > 0) actions.push(`Aktien verkauft ${money(equity)}`);
        if (bonds > 0) actions.push(`Anleihen verkauft ${money(bonds)}`);
        if (gold > 0) actions.push(`Gold verkauft ${money(gold)}`);
    } else if (sale > 0) {
        if (equity > 0) actions.push(`Aktien verkauft ${money(equity)}`);
        if (gold > 0) actions.push(`Gold verkauft ${money(gold)}`);
        if (!equity && !gold) actions.push(`Verkauft ${money(sale)}`);
        const payout = payoutSaleAmount(raw);
        if (payout > 0) actions.push(`davon${equity > 0 && gold > 0 ? ' insgesamt' : ''} ${money(payout)} für die Entnahme dieses Jahres`);
    }
    if (bondRefill > 0) actions.push(`Anleihen aufgefüllt ${money(bondRefill)}`);
    if (displayTradeAmount(raw.kaufAkt) > 0) actions.push(`Aktien kaufen ${money(raw.kaufAkt)}`);
    if (displayTradeAmount(raw.kaufGld) > 0) actions.push(`Gold kaufen ${money(raw.kaufGld)}`);
    if (actions.length) return actions.join(' · ');
    if (/kein Handlungsbedarf/i.test(text)) return 'Kein Handlungsbedarf';
    if (/RUIN|ENDE|Sparrate/i.test(text)) return actionDetailText(text.split(' / ')[0].replace(/[!<>]+/g, '').trim(), entry, options);
    // Ältere Logs haben teilweise nur den Handlungstext, ohne einzelne Handelsbeträge.
    const detail = text.replace(/^(?:REC_BÄR|HEISS|ATH|ERHOLUNG|KORREKTUR|BÄR|SEITWÄRTS)(?: \(S\))?\s*/u, '')
        .replace(/^\((.*)\)$/, '$1').split(' / ')[0];
    return actionDetailText(detail || 'Kein Handlungsbedarf', entry, options);
}

/**
 * @param entry - Protokolleintrag.
 * @param [options] - Optionen des Aufrufers.
 * @param {string} [fallback] - Kontext für fallback.
 * @returns {string}
 */
export function protocolActionExplanation(entry, options = {}, fallback = '') {
    const raw = protocolRowData(entry, options.source);
    const visibleTrades = raw.threeBucketTrades?.filter(trade => displayTradeAmount(trade.net) !== 0);
    const singleClass = visibleTrades?.length > 0
        && new Set(visibleTrades.map(trade => trade.key || trade.label)).size === 1;
    let text = actionDetailText(raw.aktionUndGrund || fallback, entry, options);
    if (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE) {
        const refill = displayTradeAmount(raw.bondRefillNet ?? raw.threeBucket?.bondRefillNet ?? raw.bondRefillGross);
        const gross = raw.bondRefillGross ?? raw.threeBucket?.bondRefillGross ?? 0;
        const tax = raw.bondRefillTax ?? raw.threeBucket?.bondRefillTax ?? 0;
        const equity = displayTradeAmount(Math.min(refill, Math.max(0, gross - tax))), cash = displayTradeAmount(Math.max(0, refill - equity));
        const bondSale = displayTradeAmount(raw.vk?.vkBnd) > 0;
        const money = value => actionMoney(value, entry, options);
        if (refill > 0) {
            const withdrawal = bondSale ? 'Entnahme aus Anleihen. ' : '';
            if (cash > 0 && equity > 0) text += ` · ${withdrawal}Anleihentopf aufgefüllt: ${money(cash)} aus dem Tagesgeld${raw.immobilienverkauf > 0 ? ' (Immobilienerlös)' : ''}, ${money(equity)} aus Aktien.`;
            else text += ` · ${bondSale ? 'Entnahme aus Anleihen, Anleihentopf' : 'Anleihentopf'} ${equity > 0 ? 'aus Aktien' : 'aus freiem Tagesgeld'} ${bondSale ? 'wieder ' : ''}aufgefüllt${singleClass ? '' : `: ${money(refill)}`}.`;
            text += ' Die Handlung nennt nur den Saldo je Anlageklasse.';
        }
    }
    if (raw.personalPayoutSales?.length) {
        const shares = raw.personalPayoutSales.map(person => `${person.name} ${(person.share * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`).join(', ');
        text += ` · Nicht verheiratet: Jede Person zahlt ihren Anteil (${shares}) aus eigenem Geld. Reicht ihr Tagesgeld nicht, verkauft sie eigene Wertpapiere.${raw.personalPayoutSales.length === 1 ? ' Der Überschuss der anderen Person bleibt auf ihrem Tagesgeld, bis die App ihn nach ihren Regeln anlegt.' : ''}`;
    }
    if (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE && visibleTrades?.length) {
        // Einzelne Klassenbeträge stehen bereits vollständig im Personensaldo.
        if (singleClass) {
            text = text.replace(/(?: · | \/ )?(?:Anleihen|Aktien|Gold) verkauft [\d.,]+[\u0020\u00a0\u202f]*€/gu, '').trim();
            const sale = visibleTrades.reduce((sum, trade) => sum + trade.net, 0);
            if (Math.abs(payoutSaleAmount(raw) - sale) < .01) {
                text = text.replace(/((?:Zusätzlich für|Für) die Entnahme verkauft): [\d.,]+[\u0020\u00a0\u202f]*€/u, '$1');
            }
        }
        const trades = visibleTrades.map(trade => `${trade.profile ? trade.profile + ': ' : ''}${trade.label} ${trade.net > 0 ? 'verkaufen' : 'kaufen'} ${actionMoney(Math.abs(trade.net), entry, options)}`);
        text += ` · Saldo je Person: ${trades.join(' · ')}`;
    }
    return text;
}

function inheritanceInfo(raw, entry, options) {
    const estate = raw.inheritance, people = options.inputs?.simulationPeople || [];
    const name = id => {
        const index = people.findIndex(person => person.profileId === id);
        return options.personDisplayContext?.persons?.[index]?.name || people[index]?.name || 'Person';
    };
    const money = value => formatProtocolValue({ format: 'money' }, value, entry, options);
    const line = (label, value) => `<span class="protocol-cashflow-line"><span>${escape(label)}</span><span>${escape(money(value))}</span></span>`;
    const deceased = name(estate.deceasedProfileId), survivor = name(estate.survivorProfileId);
    const allowance = inheritancePersonalAllowance(options.inputs?.partnership?.status ?? 'married');
    const nominalAllowance = formatProtocolValue({ format: 'money' }, allowance), realAllowance = money(allowance);
    const allowanceNote = options.moneyBasis === 'real' && realAllowance !== '—' && realAllowance !== nominalAllowance
        ? `<small>Freibetrag ${escape(nominalAllowance)} gilt nominal, in Euro von heute ${escape(realAllowance)}.</small>` : '';
    const content = `<strong>Todesfall ${escape(deceased)}</strong>` + line(`${deceased}: Vermögen im Todesjahr`, estate.assets)
        + (estate.home > (estate.inheritedSaleProceeds || 0) ? line('dazu Immobilien', estate.home - (estate.inheritedSaleProceeds || 0)) : '')
        + (estate.inheritedSaleProceeds > 0 ? line(`Hauserlös (verkauft im Jahr ${[...new Set((Array.isArray(estate.homeSaleProceeds) ? estate.homeSaleProceeds : []).map(row => row.year))].join(', ')})`, estate.inheritedSaleProceeds) : '')
        + line(`${survivor} erbt (${estate.homeAndTax ? 'Immobilien + Steuer, zusätzlich ' : ''}${estate.homeMode ? 'nach Testament' : `${estate.percent} %`})`, estate.inherited + estate.inheritedHome)
        + (estate.homeMode ? line('Geldanteil', estate.inherited) + line('Immobilien', estate.inheritedHome)
            + line('Kapitalwert Wohnrecht', estate.residenceCapital)
            + (estate.homeMode === 'residence' ? (estate.residenceIneligible
                ? '<small>Wohnrecht entfällt (Pflegeheim), Haus an die übrigen Erben.</small>'
                : '<small>Wohnrecht auf Lebenszeit: Haus bei den übrigen Erben, mietfreies Wohnen bis zur dauerhaften Heimpflege; kein Verkauf im Modell.</small>')
                : estate.homeMode === 'life-estate' ? '<span>Eigentum auf Lebenszeit, danach an die Kinder: kein Verkauf und keine Mieteinnahmen bei Heimpflege.</span>' : '') : '')
        + (estate.homeAndTax ? line('davon Steuergeld', estate.taxCash) : '')
        + (estate.homeAndTax ? `<span>davon ${escape(money(estate.taxCashSaleTax || 0))} für Steuern beim Verkauf von Wertpapieren</span>` : '')
        + line('Erbschaftsteuer', estate.tax)
        + allowanceNote
        + (estate.exemptGain > 0 ? line('steuerfrei als Zugewinnausgleich', estate.exemptGain) : '')
        + (estate.funding ? line('Kapitalertragsteuer zur Bezahlung', estate.funding.saleTax)
            + `<small>Bezahlt: aus Verkauf ${escape(money(estate.funding.saleUsed))}, aus Liquidität ${escape(money(estate.funding.liquidityUsed))}`
            + (estate.funding.inheritedTaxCashUsed !== undefined ? `, aus geerbtem Steuergeld ${escape(money(estate.funding.inheritedTaxCashUsed))}` : '')
            + '.</small>' : '')
        + line('verlässt den Haushalt', estate.leaves)
        + `<small>${escape(deceased)}: eigene Rente endet (${escape(money(estate.pensionEnds))}/Jahr); ${options.inputs?.partnership?.status === 'unmarried' ? 'keine Hinterbliebenenrente.' : 'Hinterbliebenenrente wie eingestellt.'}</small>`;
    return protocolInfo('Erbe: Aufschlüsselung des Todesjahres', '').replace('class="ds-info"', 'class="ds-info protocol-inheritance-info"')
        .replace('role="tooltip">', `role="tooltip">${content}`);
}

/**
 * @param entry - Protokolleintrag.
 * @param index - Kontext für index.
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function protocolYearPresentation(entry, index, options = {}) {
    const source = options.source || 'mc', row = protocolRowData(entry, source);
    // MC-jahr ist einsbasiert; das Backtestjahr ist bereits ein Kalenderjahr.
    const offset = source === 'backtest' ? (Number.isFinite(options.startYear) && Number.isFinite(entry?.jahr) ? entry.jahr - options.startYear : index)
        : (Number.isFinite(entry?.jahr) ? entry.jahr - 1 : index);
    const calendarYear = source === 'backtest' ? entry?.jahr
        : Number.isFinite(options.startYear) ? options.startYear + offset : null;
    const inputs = options.inputs || {};
    const age = (start, alive) => Number.isFinite(start) ? `${start + offset}${alive === false || alive === 0 ? ' †' : ''}` : null;
    const ages = [age(inputs.startAlter, row.Person1Alive)];
    if (inputs.partner?.aktiv) ages.push(age(inputs.partner.startAlter, row.Person2Alive));
    return { calendarYear, simulationYear: source === 'mc' ? entry?.jahr : offset + 1,
        ages: ages.filter(value => value !== null).join(' / ') };
}

const personFieldLabels = {
    profile_geburtsdatum: 'Geburtsdatum', profile_rentenbeginn: 'Rentenbeginn', profile_rente_monatlich: 'Monatliche Rente',
    profile_geschlecht: 'Geschlecht', profile_sparer_pauschbetrag: 'Sparer-Pauschbetrag', profile_kirchensteuer_pct: 'Kirchensteuer (%)',
    profile_rente_steuerquote_pct: 'Steuerquote (%)', profile_rentenanpassung_art: 'Gemeinsame Rentenanpassung', profile_rentenanpassung_pct: 'Rentenanpassung (% p.a.)'
};
/**
 * @param context - Kontext der Auswertung.
 * @returns {string}
 */
export function renderPersonDataNotice(context) {
    if (!context?.deviationApplied) return '';
    const changes = context.persons.flatMap(person => person.changes.map(change =>
        `<li>${escape(person.role === 'primary' ? 'Hauptprofil' : 'Partner')} · ${escape(personFieldLabels[change.field] || change.field)}: Profil ${escape(change.profileValue)} → ${escape(change.effectiveValue)}</li>`)).join('');
    return `<aside class="ds-note person-data-deviation"><strong>Abweichung · nur diese Rechnung</strong><p>Personenwerte am 01.01.${escape(context.referenceYear)} · Profil unverändert.</p><ul>${changes}</ul></aside>`;
}

/**
 * @param rows - Protokollierte Jahreszeilen.
 * @param [options] - Optionen des Aufrufers.
 * @returns {string}
 */
export function renderProtocolSummary(rows, options = {}) {
    const source = options.source || 'mc', data = Array.isArray(rows) ? rows : [];
    const flags = data.map(row => protocolRowFlags(row, source));
    const outcome = options.outcome?.kind || options.outcome;
    const outcomeLabel = ({ completed: 'Vollständig', no_ruin: 'Kein Ruin', ruin: 'Ruin', all_dead: 'Haushalt verstorben', horizon_exhausted: 'Horizont erreicht',
        incomplete: 'Unvollständig', technical_error: 'Technischer Fehler' })[outcome];
    const lastEntry = data.filter(entry => Number.isFinite(protocolRowData(entry, source)?.portfolio_total_end)).at(-1);
    const last = protocolRowData(lastEntry, source);
    const badge = outcomeLabel ? chip(outcomeLabel, outcome === 'ruin' ? 'ruin' : outcome === 'all_dead' ? 'ended' : 'complete') : '';
    const metrics = [];
    const metric = (value, label, detail = '') => `<div class="ds-metric"><strong class="ds-metric-value">${escape(value)}</strong><span class="ds-metric-label">${escape(label)}</span>${detail ? `<small class="sim-money-detail">${escape(detail)}</small>` : ''}</div>`;
    const inflation = source === 'backtest' ? lastEntry?.inflationVJ : last.inflation;
    const factor = Number.isFinite(last.inflation_factor_cum) && Number.isFinite(inflation)
        ? last.inflation_factor_cum * (1 + inflation / 100) : null;
    const end = Object.hasOwn(options, 'endWealth') ? options.endWealth : options.moneyBasis === 'real'
        ? Number.isFinite(factor) && factor > 0 ? last.portfolio_total_end / factor : null : last.portfolio_total_end;
    const homes = rowWealthParts(last, options.moneyBasis, factor);
    if (Number.isFinite(end)) metrics.push(metric(formatProtocolValue({ format: 'money' }, end + (homes?.total || 0)), `Gesamtvermögen · ${options.euroBasis || (options.moneyBasis === 'real' ? 'real' : 'nominal')}`, Number.isFinite(last.immobilien_wert_end) ? `davon Geldvermögen ${formatProtocolValue({ format: 'money' }, end)} · Immobilien ${formatProtocolValue({ format: 'money' }, homes?.total)}` : ''));
    metrics.push(metric(flags.filter(flag => flag.cut).length, 'Jahre mit Kürzung'));
    metrics.push(metric(flags.filter(flag => flag.care).length, 'Pflegejahre'));
    return renderPersonDataNotice(options.personDataContext) + `<p class="protocol-subtitle">${escape(options.subtitle || `${data.length} Jahreszeilen · Anzeige unabhängig vom vollständigen Download`)}</p><div class="protocol-chips">${badge}<div class="protocol-metrics ds-kpi-strip">${metrics.join('')}</div></div>`;
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns {string}
 */
export function renderProtocolLegend(options = {}) {
    const context = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const persons = options.source === 'backtest' ? '' : `✓ lebt · ${context.careEnabled ? 'PG Pflegegrad · ' : ''}† verstorben. `;
    return `<div class="protocol-legend"><span><i class="protocol-mark-cut" aria-hidden="true"></i>Jahr mit Kürzung</span><span><i class="protocol-mark-care" aria-hidden="true"></i>Pflegejahr</span><span><i class="protocol-mark-ruin" aria-hidden="true"></i>Ruin</span><span>${persons}Gepunktete Überschriften erklären die Spalten. Handel nennt verkauft oder gekauft.</span></div>`;
}

/**
 * @param rows - Protokollierte Jahreszeilen.
 * @param index - Kontext für index.
 * @param column - Kontext für column.
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function protocolPersonPresentation(rows, index, column, options = {}) {
    const context = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const person = column.person, raw = protocolRowData(rows[index], options.source);
    const alive = raw[`Person${person}Alive`];
    const name = context.persons[person - 1]?.name || `Person ${person}`;
    if (alive === false || alive === 0) {
        const deathIndex = rows.findIndex(entry => {
            const status = protocolRowData(entry, options.source)[`Person${person}Alive`];
            return status === false || status === 0;
        });
        const deathRow = rows[deathIndex], previous = rows[deathIndex - 1];
        const previousAlive = protocolRowData(previous, options.source)[`Person${person}Alive`];
        // Nur der erste Simulationsbeginn oder ein lückenloser Lebt→Tod-Übergang datiert den Tod.
        const observedTransition = deathIndex === 0 && deathRow?.jahr === 1
            || (previousAlive === 1 || previousAlive === true) && Number.isFinite(previous?.jahr) && deathRow?.jahr === previous.jahr + 1;
        const year = observedTransition && Number.isFinite(deathRow?.jahr)
            ? protocolYearPresentation(rows[deathIndex], deathIndex, options).calendarYear : null;
        return { text: '†', tone: `dead${index > deathIndex ? ' following' : ''}`,
            title: `${name}: verstorben${Number.isFinite(year) ? ` ${year}` : ' · Todesjahr unbekannt'}` };
    }
    if (alive !== true && alive !== 1) return { text: '—', tone: 'unknown', title: `${name}: Lebensstatus unbekannt` };
    if (context.careEnabled && raw[`CareP${person}_Active`]) {
        const grade = raw[`CareP${person}_Grade`];
        return { text: grade == null ? 'PG ?' : `PG ${grade}`, tone: 'care',
            title: `${name}: ${grade == null ? 'Pflegegrad unbekannt' : `Pflegegrad ${grade}`}${raw[`CareP${person}_HeimBestand`] ? ' · heute im Heim' : raw[`CareP${person}_HeimJahr`] ? ` · im Heim, Heimjahr ${raw[`CareP${person}_HeimJahr`]}` : ''}` };
    }
    return { text: '✓', tone: 'alive', title: `${name}: lebt` };
}

/**
 * @param rows - Protokollierte Jahreszeilen.
 * @param [options] - Optionen des Aufrufers.
 * @returns {string}
 */
export function renderProtocolTable(rows, options = {}) {
    const source = options.source || 'mc', data = Array.isArray(rows) ? rows : [];
    const actionOptions = { ...options, rows: data };
    const columns = getProtocolColumns({ ...options, rows: data });
    const groups = [];
    for (const column of columns) {
        const previous = groups.at(-1);
        const group = column.group || 'strategy';
        if (previous?.group === group) previous.count++;
        else groups.push({ group, count: 1 });
    }
    const caption = options.caption || (source === 'backtest' ? `Jahresprotokoll des Backtest-Ergebnisses (${data.length} Zeilen)` : `Szenario-Jahresprotokoll (${data.length} Zeilen)`);
    let html = '<thead><tr class="protocol-group-head">';
    html += groups.map(({ group, count }) => `<th scope="colgroup" colspan="${count}">${escape(PROTOCOL_GROUPS[group] || group)}</th>`).join('');
    html += '</tr><tr class="protocol-column-head">';
    const groupStart = position => position > 0 && columns[position].group !== columns[position - 1].group;
    html += columns.map((column, position) => `<th scope="col" class="${column.format === 'person' ? 'protocol-person' : column.align === 'right' ? 'protocol-number' : 'protocol-text'}${groupStart(position) ? ' protocol-group-start' : ''}" data-protocol-column="${escape(column.id || column.key || column.header)}" aria-label="${escape(column.title || column.header)}" title="${escape(column.title || column.header)}"><span class="protocol-explain">${escape(column.header)}</span>${['handl-bd', 'total', 'home-value', 'total-with-homes'].includes(column.id) ? protocolInfo(column.header, column.explanation) : ''}</th>`).join('');
    html += '</tr></thead><tbody>';
    data.forEach((entry, index) => {
        const flags = protocolRowFlags(entry, source), raw = protocolRowData(entry, source);
        const belowCar = Number.isFinite(options.caRThreshold) && Number.isFinite(raw.jahresentnahme_real) && raw.jahresentnahme_real < options.caRThreshold;
        const yearAnchor = Number.isInteger(entry?.jahr)
            ? ` id="${source === 'backtest' ? 'backtest' : 'scenario'}-year-${entry.jahr}" tabindex="-1"` : '';
        html += `<tr${yearAnchor} class="${index % 2 === 0 ? 'even' : 'odd'}${flags.cut ? ' backtest-row-cut protocol-row-cut' : ''}${flags.care ? ' protocol-row-care' : ''}${flags.ruin ? ' backtest-row-ruin protocol-row-ruin' : ''}${belowCar ? ' below-car' : ''}">`;
        columns.forEach((column, position) => {
            let value = column.id ? readProtocolValue(column, entry, options) : undefined;
            const requested = typeof column.cellClass === 'function' ? column.cellClass(entry) : column.cellClass;
            const tradeClass = ['backtest-trade-sale', 'backtest-trade-buy'].includes(requested) ? requested : '';
            const numeric = column.align === 'right' ? ' protocol-number' : '';
            if (column.id === 'year') {
                const year = protocolYearPresentation(entry, index, options);
                html += `<td class="protocol-year">${escape(year.calendarYear ?? '—')}<small>${source === 'mc' ? `Simulationsjahr ${escape(year.simulationYear ?? '—')}` : ''}${year.ages ? `${source === 'mc' ? ' · ' : ''}Alter ${escape(year.ages)}` : ''}</small></td>`;
            } else if (column.format === 'person') {
                const state = protocolPersonPresentation(data, index, column, options);
                html += `<td class="protocol-person protocol-person-${state.tone}${groupStart(position) ? ' protocol-group-start' : ''}" title="${escape(state.title)}" aria-label="${escape(state.title)}"><span aria-hidden="true">${escape(state.text)}</span></td>`;
            } else {
                const formatted = options.formatValue ? options.formatValue(column, entry) : formatProtocolValue(column, value, entry, options);
                const action = column.id === 'action';
                const withdrawal = column.id === 'withdrawal';
                const cashflow = ['income-total', 'expense-total'].includes(column.id);
                const actionInfo = action && (!raw.inheritance || options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE || raw.personalPayoutSales?.length)
                    ? protocolInfo('Handlung und vollständige Begründung', protocolActionExplanation(entry, actionOptions, formatted)) : '';
                const content = action
                    ? `${escape(protocolActionShortText(entry, actionOptions, formatted))}${actionInfo}${raw.inheritance ? inheritanceInfo(raw, entry, options) : ''}`
                    : `${escape(formatted)}${cashflow ? cashflowInfo(column, entry, actionOptions) : ''}${column.id === 'inheritance-tax' ? inheritanceTaxInfo(entry, { ...options, rows: data }) : ''}${column.id === 'residence-tax' ? residenceTaxInfo(entry, options) : ''}${['total', 'total-with-homes'].includes(column.id) && formatted && formatted !== '—' ? protocolInfo('Aufteilung des Vermögens', protocolWealthText(entry, { source, moneyBasis: options.moneyBasis, withHomes: column.id === 'total-with-homes' })) : ''}${withdrawal && belowCar ? protocolInfo('Niedrige Entnahme', `Niedrige Entnahme: ${LOW_WITHDRAWAL_HINT}`) : ''}`;
                html += `<td class="${numeric.trim()}${tradeClass ? ` ${tradeClass}` : ''}${action ? ' protocol-action' : ''}${withdrawal ? ' protocol-withdrawal' : ''}${cashflow ? ' protocol-cashflow' : ''}${withdrawal && belowCar ? ' protocol-low-withdrawal' : ''}${groupStart(position) ? ' protocol-group-start' : ''}">${content}</td>`;
            }
        });
        html += '</tr>';
    });
    return `<table class="ds-table protocol-table"><caption>${escape(caption)}</caption>${html}</tbody></table>${renderProtocolLegend(options)}`;
}
