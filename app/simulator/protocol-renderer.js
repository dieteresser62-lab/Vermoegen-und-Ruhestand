import { rowWealthParts, protocolWealthText } from './wealth-display.js';
"use strict";

import { PROTOCOL_GROUPS, getProtocolColumns, readProtocolValue, formatProtocolValue, protocolResidentialEntry,
    protocolRowData, protocolRowFlags, createProtocolPersonContext, translateProtocolText } from './protocol-columns.js';
import { infoPopoverHtml } from '../shared/designsystem-info-popover.js';
import { protocolCashflowBreakdown, protocolCareNotes, protocolCareState } from './protocol-cashflows.js';
import { noCareAllowanceReason } from '../shared/care-benefits.js';
import { STRATEGY_OPTIONS } from '../../types/strategy-options.js';
import { FAMILY_HOME_CONDITIONS, spouseTaxNote, inheritancePersonalAllowance, inheritanceClassIIITariffText, PENSION_ALLOWANCE, MISSING_PARTNERSHIP_STATUS, rentFreeThroughDescription, HOUSING_CAPITAL_CANCELLED } from '../profile/household-partnership.js';
import { displayTradeAmount } from '../shared/transaction-display-text.js';
import { CARRIER_RESERVE_SHORT_TEXT, activeCarrier } from '../profile/household-withdrawal-mode.js';
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
const LOW_WITHDRAWAL_HINT = 'Reale Entnahme unter dem 10-%-Wert aller simulierten Jahre';
const protocolInfo = (label, text) => infoPopoverHtml(label, text).replace('class="ds-info-button"', 'class="ds-info-button ds-button"');
// ST7-FIX (Gutachten ST7 P2-3): Bestände am Jahresende (Bruttovermögen, offene Steuerschuld, Tagesgeld danach) nehmen wie die Spalte
// „Geldvermögen“ den Preisstand am Jahresende; Zahlungen des Jahres den am Jahresanfang.
const actionMoney = (value, entry, options, yearEnd = false) => {
    const text = formatProtocolValue({ format: 'money', ...(yearEnd ? { id: 'total' } : {}) }, value, entry, options);
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
    return raw.immobilienverkauf > 0 ? `${raw.immobilien_notverkauf ? 'Notverkauf Immobilie' : raw.immobilien_verkauf_pflege ? 'Verkauf Immobilie für Heimkosten' : 'Immobilienverkauf'} ${actionMoney(raw.immobilienverkauf, entry, options)} · ` : '';
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
    if (!amounts) return `Vermögen aufgebraucht: ${translateProtocolText(reason).replace(/Floor/gu, 'Grundbedarf')}`;
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
    return `Vermögen aufgebraucht: Geldvermögen ${money(amounts[1])} reicht nicht für den Grundbedarf von ${money(amounts[2])}${real && !known ? ' (nominal; Kaufkraftbetrag unbekannt)' : ''}`;
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
    const raw = protocolRowData(entry, options.source);
    const estate = raw.inheritance;
    const move = raw.housingCapitalMove;
    if (move?.kind === 'sold') {
        const money = value => actionMoney(value, entry, options);
        const taxClass = options.inputs?.partnership?.status === 'married' ? 'I' : 'III';
        return protocolInfo('Erbschaftsteuer auf Wohnkapital', `Die App rechnet beide Erwerbe in Steuerklasse ${taxClass} zusammen und zieht die Steuer aus dem Todesjahr ab. Freibetragsrest aus dem Todesjahr ${money(move.allowanceRemaining)}. Der steuerpflichtige Betrag steigt um ${money(move.taxable)}.`)
            .replace('class="ds-info"', 'class="ds-info protocol-tax-info"');
    }
    const status = options.inputs?.partnership?.status, married = status === 'married';
    const personalAllowance = inheritancePersonalAllowance(status);
    const sold = new Set();
    for (const row of options.rows || []) {
        for (const sale of protocolRowData(row, options.source).immobilienverkauf_personen || []) sold.add(JSON.stringify([sale.profileId, sale.homeId]));
        if (row === entry) break;
    }
    const familyHomes = (options.inputs?.home || []).filter((home, index) => home.profileId === estate?.deceasedProfileId
        && home.nutzung === 'selbst' && home.wert > 0 && !sold.has(JSON.stringify([home.profileId, home.id ?? index])));
    const familyNote = status && estate?.exemptHome > 0
        ? ` Familienheim-Befreiung angenommen. ${FAMILY_HOME_CONDITIONS}${familyHomes.length > 1 ? ' Steuerfrei ist nur das Familienheim – bei mehreren selbst genutzten Immobilien die wertvollste.' : ''}` : '';
    const relief = status ? estate?.pensionAllowance : undefined;
    const euro = value => `${value.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`;
    // HP-3: Bei „Euro von heute“ sagt der Text, dass beide Beträge nominal sind, mit dem Wert von heute dahinter (wie der Freibetrag im ⓘ „Todesfall …“).
    const today = value => { const real = formatProtocolValue({ format: 'money' }, value, entry, options);
        return options.moneyBasis === 'real' && real !== '—' && real !== formatProtocolValue({ format: 'money' }, value) ? `, gilt nominal, in Euro von heute ${real}` : ''; };
    const taxableNote = Number.isFinite(estate?.taxable) ? ` Steuerpflichtiger Erwerb ${euro(estate.taxable)} (auf volle 100 € abgerundet)${today(estate.taxable)}.` : ''; // HP-4; ältere Einträge ohne Wert
    const gainNote = status && estate?.exemptGain > 0 ? ` Steuerfrei als Zugewinnausgleich ${euro(estate.exemptGain)}${today(estate.exemptGain)}.` : '';
    // VB-1: Versorgungsfreibetrag (§ 17 ErbStG) als eigener Satz, nominal wie der Zugewinnbetrag.
    const reliefNote = !relief ? '' : relief.missingAge ? ' Versorgungsfreibetrag (§ 17 ErbStG): ohne Alter kein Versorgungsfreibetrag.'
        : ` Versorgungsfreibetrag (§ 17 ErbStG) ${euro(relief.amount)}${relief.capital > 0 ? ` (${euro(PENSION_ALLOWANCE)} minus Kapitalwert der Hinterbliebenenrente ${euro(relief.capital)})` : ''}${today(relief.amount)}.`;
    // HP-2: Nennt reliefNote den Freibetrag, entfällt der allgemeine Satz dazu; der Satz mit Betrag folgt dem Zugewinnausgleich, vor dem Familienheim.
    const text = married
        ? `Vereinfachte Steuerklasse I: ${personalAllowance.toLocaleString('de-DE')} € Freibetrag. ${spouseTaxNote(options.inputs?.partnership, !reliefNote)}`
        : `${status ? '' : MISSING_PARTNERSHIP_STATUS + '. '}Vereinfachte Steuerklasse III: ${personalAllowance.toLocaleString('de-DE')} € Freibetrag, ${inheritanceClassIIITariffText()}; Härteausgleich nahe der Tarifgrenze.`;
    const annual = estate?.residenceTax;
    const rentBequest = estate?.rentBequestAnnual > 0;
    const capitalNote = estate?.housingCapital > 0 ? ` Wohnkapital ${euro(estate.housingCapital)} als Geldvermächtnis voll im Erwerb, ohne Familienheim-Befreiung.` : '';
    const detail = annual ? ` Jährlich (§ 23 ErbStG): Im Todesjahr nur der Geld- und Immobilienanteil nach Freibetrag; Tarif nach Gesamterwerb einschließlich ${rentBequest ? 'Rente aus dem Erbe' : 'Wohnrecht'}. Jahreswert ${annual.annualValue.toLocaleString('de-DE')} €, Steuersatz ${formatDisplayPercentRatio(annual.rate)}. Ab dem Folgejahr nominal fest ${annual.annualTax.toLocaleString('de-DE')} € im Voraus bis ${rentBequest ? 'zum Tod' : 'Tod oder dauerhafter Heimpflege'}. Freibetragsrest ${annual.allowanceRemaining.toLocaleString('de-DE')} € wird aufgezehrt (ursprünglich ${personalAllowance.toLocaleString('de-DE')} € persönlicher Freibetrag${estate.exemptGain > 0 ? ` plus ${estate.exemptGain.toLocaleString('de-DE')} € Zugewinnausgleich` : ''}${relief?.amount > 0 ? ` plus ${relief.amount.toLocaleString('de-DE')} € Versorgungsfreibetrag` : ''}). Sofortvergleich ${annual.immediateComparison.toLocaleString('de-DE')} €.` : '';
    return protocolInfo('Erbschaftsteuer: vereinfachte Rechnung', text + taxableNote + gainNote + reliefNote + familyNote + capitalNote + detail
        + (married ? ' Steuerberater fragen.' : ''))
        .replace('class="ds-info"', 'class="ds-info protocol-tax-info"');
}

function residenceTaxInfo(entry, options) {
    const payment = protocolRowData(entry, options.source).residenceTaxPayment;
    if (!payment) return '';
    const money = value => `${value.toLocaleString('de-DE', { maximumFractionDigits: 2 })} € nominal`;
    const label = payment.rentBequest ? 'Steuer auf die Rente aus dem Erbe (§ 23)' : 'Steuer Wohnrecht (§ 23)';
    return protocolInfo(label, `Vorauszahlung zu Jahresbeginn aus Tagesgeld oder Verkauf. Jahreswert ${money(payment.annualValue)}, Satz ${formatDisplayPercentRatio(payment.rate)}, feste Jahressteuer ${money(payment.annualTax)}. Davon Jahreswert steuerfrei ${money(payment.exempt)} durch Aufzehrung; Freibetragsrest ${money(payment.allowanceRemaining)}. Endet ${payment.rentBequest ? 'mit dem Tod' : 'mit Tod oder dauerhafter Heimpflege'}.${payment.note ? ` ${payment.note}` : ''}${payment.shortfall > .01 ? ` Ungedeckt: ${money(payment.shortfall)}.` : ''}`);
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
                name: options.personDisplayContext?.persons?.[index]?.name || inputs.simulationPeople?.[index]?.name || `Person ${index + 1}`,
                preset: care?.form === 'residential' ? undefined : inputs.pflegeKostenStaffelPreset });
            if (reason) content += `\n<span class="ds-help">${escape(reason)}</span>`;
            if (fallback) {
                const other = 1 - index;
                const name = options.personDisplayContext?.persons?.[other]?.name || inputs.simulationPeople?.[other]?.name || `Person ${other + 1}`;
                // Aktuellen Anlass anzeigen; das gemerkte Wechselmerkmal bleibt für Rechnung und Export erhalten.
                const alive = row[`Person${other + 1}Alive`];
                const currentGrade = row[`CareP${other + 1}_Active`] ? row[`CareP${other + 1}_Grade`] : null;
                const cause = alive === 0 || alive === false || fallback.reason === 'death' ? 'verstorben ist'
                    : `selbst Pflegegrad ${currentGrade >= 3 ? currentGrade : fallback.grade} hat`;
                content += `\n<span class="ds-help">${escape(`Externe Unterstützung übernimmt die Pflege, weil ${name} ${cause}.`)}</span>`;
            }
        }
    }
    // KR-1c-b: Besteht die Hilfe nur aus der Steuer, steht sie in derselben Zeile wie eine Hilfe aus der Auszahlung.
    // TX-2 (H-OP1-DAVON-EINRUECKUNG): Zeilen unter „Summe“ teilen die Summe auf und beginnen nicht mit „davon“; nur eingerückte Erläuterungen tun das.
    if (!income && breakdown.careAid.payout + breakdown.careAid.tax > 0) content += line('Hilfe zur Pflege (zahlt der Staat)', breakdown.careAid.payout || breakdown.careAid.tax, 'protocol-cashflow-withdrawal');
    if (!income && breakdown.careAid.tax > 0) content += `<span class="ds-help">${escape(breakdown.careAid.payout > 0 ? `Dazu trägt der Staat ${formatProtocolValue(column, breakdown.careAid.tax, entry, options)} Steuer aus Verkäufen oder Zinsen für die Pflege (Hilfe zur Pflege, keine Ausgabe des Jahres).` : 'Die Hilfe ist Steuer aus Verkäufen oder Zinsen für die Pflege (keine Ausgabe des Jahres).')}</span>`;
    if (!income) content += line('Aus dem Vermögen bezahlt', breakdown.withdrawal, 'protocol-cashflow-withdrawal') + protocolCareNotes(entry,
        { ...options, residentialEntry: (/** @type {any} */ row, /** @type {number} */ index) => protocolResidentialEntry(row, index, options) },
        value => formatProtocolValue({ format: 'money' }, value)).map(note => `\n<span class="ds-help">${escape(note)}</span>`).join('');
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
    const move = raw.housingCapitalMove;
    // ER-2e (Befund 1814): Bei „Auszug nach 0“ nennt das Todesjahr dieselben Bausteine wie das spätere Verkaufsjahr.
    const immediateCapital = raw.inheritance?.housingCapital;
    const saleAmount = move?.kind === 'sold' ? move.amount : immediateCapital;
    const capitalAction = saleAmount > 0 ? `Hausanteil verkauft · Wohnkapital ${actionMoney(saleAmount, entry, options)} aufs Tagesgeld · Mietbeginn${immediateCapital > 0 ? ' im Folgejahr' : ''}`
        : move?.kind === 'staying' ? 'Mietfreies Wohnen bis zum Auszug'
        : raw.inheritance?.moveOutYears > 0 ? rentFreeThroughDescription(raw.inheritance.moveOutYears)
        : move?.kind === 'cancelled' || raw.inheritance?.housingCapitalCancelled
            ? (move?.reason === 'death' ? 'Wohnkapital entfällt durch Tod' : HOUSING_CAPITAL_CANCELLED) : '';
    const capitalPrefix = capitalAction ? `${capitalAction} · ` : '';
    const ruin = ruinActionText(entry, options);
    if (ruin) return capitalPrefix + homeSaleText(entry, options) + ruin;
    const noTrade = noTradeText(raw);
    if (noTrade) return capitalPrefix + homeSaleText(entry, options) + noTrade;
    const text = String(raw.aktionUndGrund || fallback);
    const shortDetail = () => actionDetailText(text.split(' / ')[0].replace(/[!<>]+/g, '').trim(), entry, options);
    if (raw.recordType === 'terminal_death' && capitalAction) return `${shortDetail() || 'Alle Personen verstorben'} · ${capitalAction}`;
    const money = value => actionMoney(value, entry, options);
    const { equity, bonds, gold, total: sale } = actionSaleAmounts(raw);
    const actions = [];
    if (raw.immobilienverkauf > 0) actions.push(`${raw.immobilien_notverkauf ? 'Notverkauf Immobilie' : raw.immobilien_verkauf_pflege ? 'Verkauf Immobilie für Heimkosten' : 'Immobilienverkauf'} ${money(raw.immobilienverkauf)}`);
    const saleRest = housingCapitalSaleRest(raw.inheritance);
    if (raw.inheritance) actions.push(`Erbe: ${money(raw.abgang_erben)} ${saleRest > 0 ? `Geld und ${money(saleRest)} Hauserlös ` : ''}verlassen den Haushalt`);
    if (capitalAction) actions.push(capitalAction);
    const propertyActionCount = actions.length;
    const summarizeActions = () => capitalAction && actions.length === propertyActionCount && /^Sparrate/i.test(text)
        ? [shortDetail(), ...actions].join(' · ') : actions.join(' · ');
    const bondRefill = displayTradeAmount(raw.bondRefillGross ?? raw.threeBucket?.bondRefillGross);
    const assetSalesKnown = [raw.vk?.vkAkt, raw.vk?.vkBnd, raw.vk?.vkGld, raw.executedSaleAkt, raw.executedSaleEq].some(Number.isFinite);
    if (options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE && raw.threeBucketTrades) {
        for (const trade of raw.threeBucketTrades.filter(trade => displayTradeAmount(trade.net) !== 0)) actions.push(`${trade.profile ? trade.profile + ': ' : ''}${trade.label} ${trade.net > 0 ? 'verkaufen' : 'kaufen'} ${money(Math.abs(trade.net))}`);
        return summarizeActions() || 'Kein Handlungsbedarf';
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
        return summarizeActions() || 'Kein Handlungsbedarf';
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
    if (actions.length) return summarizeActions();
    if (/kein Handlungsbedarf/i.test(text)) return 'Kein Handlungsbedarf';
    if (/RUIN|ENDE|Sparrate/i.test(text)) return shortDetail();
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
    // FR-80 Punkt 3: „Eine Person trägt“ reicht nicht mehr; der Plan greift auf das Vermögen der anderen Person zu.
    const attacked = (raw.personalPayout?.attacked || []).map(row => raw.personAccounts?.find(person => person.profileId === row.profileId)?.name || row.profileId);
    if (attacked.length) text += ` · Vermögen von ${attacked.join(' und ')} wird angegriffen: Das Vermögen der tragenden Person reicht für den gemeinsamen Anteil nicht mehr.`;
    // VN-3 (Ergänzung 1 FR-80): Das Vermögen der tragenden Person reicht nicht für ihr Liquiditätsziel; die andere Person verkauft dafür nichts.
    const short = raw.personalPayout?.carrierReserveShort;
    if (short?.amount > 0) text += ` · ${CARRIER_RESERVE_SHORT_TEXT(raw.personAccounts?.find(person => person.profileId === short.profileId)?.name, actionMoney(short.amount, entry, options))}`;
    // FR-81: Unverheiratet im Vorgabemodus – fehlt einer Person nur ein Teil ihres Flex-Anteils, wird er gekürzt.
    const flexCut = (raw.personalPayout?.flexCut || []).map(row => raw.personAccounts?.find(person => person.profileId === row.profileId)?.name || row.profileId);
    if (flexCut.length) text += ` · Flex-Anteil von ${flexCut.join(' und ')} gekürzt: Das eigene Geld reicht nur noch für den eigenen Anteil am Grundbedarf.`;
    // Ergänzung 1 FR-81: Die Einkünfte des Haushalts hätten gereicht; bei Unverheirateten gehören sie aber jeder Person selbst.
    if (flexCut.length && raw.personalPayout?.flexCutIncomeCovers) text += ' Mit „Eine Person trägt“ legt die App die Einkünfte beider zusammen.';
    text += floorReliefText(raw, (value, yearEnd) => actionMoney(value, entry, options, yearEnd));
    // VN-4 Punkt 5 (Abnahme LZDS-2): „Verkäufe und Käufe je Person“ zeigte nur die Überschrift. Jetzt mit den Werten des Jahresbelegs:
    // wer verkauft (bei „Eine Person trägt“ die tragende Person), Steuer des Haushalts und Tagesgeld je Person nach dem Jahr.
    const people = raw.personAccounts || [];
    if (/^Profilverbund-Transaktionen$/.test(String(raw.aktionUndGrund || '').trim()) && people.length > 1
        && options.strategyMode !== STRATEGY_OPTIONS.THREE_BUCKET_JILGE) {
        const money = value => actionMoney(value, entry, options);
        const sold = displayTradeAmount(raw.vk?.vkGes ?? ((Number(raw.vk?.vkAkt) || 0) + (Number(raw.vk?.vkGld) || 0) + (Number(raw.vk?.vkBnd) || 0)));
        const carrier = activeCarrier(options.inputs?.householdWithdrawalMode, people);
        const carrierName = people.find(person => person.profileId === carrier)?.name;
        if (sold > 0) text += carrierName && !attacked.length ? ` · ${carrierName} verkauft ${money(sold)} (trägt die Entnahme), die andere Person verkauft nichts`
            : ` · Verkauft im Haushalt ${money(sold)}`;
        if (Number(raw.steuern_gesamt) > 0.5) text += ` · Steuer im Jahr ${money(raw.steuern_gesamt)}`;
        const after = value => actionMoney(value, entry, options, true);
        text += ` · Tagesgeld danach: ${people.map(person => `${person.name || 'Person'} ${after(person.tagesgeld)}${person.geldmarktEtf > 0.5 ? ` (dazu Geldmarkt ${after(person.geldmarktEtf)})` : ''}`).join(', ')}`;
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

/** FR-84: Hilfe zur Pflege, Grundbedarf vom Partner, gekürzte einmalige Ausgabe und offene Reste eines Jahres.
 * @param {any} raw Jahreszeile. @param {(value: number, yearEnd?: boolean) => string} money Betrag in der gewählten Eurobasis,
 * mit `yearEnd` als Bestand am Jahresende. @returns {string} */
export function floorReliefText(raw, money) {
    const name = (/** @type {string} */ id) => raw.personAccounts?.find((/** @type {any} */ person) => person.profileId === id)?.name || 'Person';
    let text = '';
    if (raw.hilfe_zur_pflege > 0) {
        const persons = (raw.hilfe_zur_pflege_personen || []).map((/** @type {any} */ row) => `${name(row.profileId)} ${money(row.amount)}`);
        const tax = raw.hilfe_zur_pflege_steuer > 0 ? `, davon Steuer aus Verkäufen oder Zinsen für die Pflege ${money(raw.hilfe_zur_pflege_steuer)}` : '';
        text += ` · Hilfe zur Pflege: ${money(raw.hilfe_zur_pflege)}${persons.length ? ` (${persons.join(', ')})` : ''}${tax}. Diese Pflegekosten trägt das eigene Geld nicht mehr; sie zahlt der Staat.`;
    }
    for (const row of raw.partner_grundbedarf || []) text += ` · Partner deckt Grundbedarf: ${money(row.amount)} (${name(row.fromProfileId)} für ${name(row.profileId)}).`;
    if (raw.geplante_ausgaben_abgelehnt?.length) {
        const labels = raw.geplante_ausgaben_abgelehnt.map((/** @type {{label: string}} */ item) => item.label).filter(Boolean);
        text += ` · Einmalausgabe wegen zu hohem Betrag abgelehnt${labels.length ? ` (${labels.join(', ')})` : ''}.`;
    }
    if (raw.geplante_ausgaben_gekuerzt > 0) {
        const items = (raw.geplante_ausgaben_entfallen || []).filter((/** @type {any} */ item) => item.label).map((/** @type {any} */ item) => `${item.label} ${money(item.amount)}`);
        text += ` · Geplante Ausgabe entfällt: ${money(raw.geplante_ausgaben_gekuerzt)}${items.length ? ` (${items.join(', ')})` : ''}. Das Geld reicht nach Grundbedarf und Pflege nicht mehr; jeder Posten ganz oder gar nicht.`;
    }
    if (raw.grundbedarf_rest > 0) text += ` · Grundbedarf um ${money(raw.grundbedarf_rest)} nicht gedeckt (Rundungsrest).`;
    // NK-2 (FR-84 Punkt 17): Steuerschuld aus dem Vorjahr und am Jahresende offene Steuer.
    if (raw.steuer_schuld_vorjahr > 0) text += ` · Steuerschuld aus dem Vorjahr: ${money(raw.steuer_schuld_vorjahr)}, nach Grundbedarf und Pflege und vor dem Flex fällig.`;
    if (raw.steuer_offen > 0) text += ` · Steuer offen: ${money(raw.steuer_offen, true)}. Sie bleibt als Schuld stehen, mindert das Vermögen (brutto ${money(raw.portfolio_total_brutto, true)}) und ist im Folgejahr fällig.`;
    return text;
}

/** ER-2e (Befund 1814): Beim Verkauf im Todesjahr erhalten die anderen Erben den Nettoerlös ohne das Wohnkapital. */
function housingCapitalSaleRest(estate) {
    return estate?.housingCapital > 0 ? estate.housingCapital * (100 - estate.housingCapitalPercent) / estate.housingCapitalPercent : 0;
}

function inheritanceInfo(raw, entry, options) {
    const estate = raw.inheritance, people = options.inputs?.simulationPeople || [];
    const status = options.inputs?.partnership?.status;
    const name = id => {
        const index = people.findIndex(person => person.profileId === id);
        return options.personDisplayContext?.persons?.[index]?.name || people[index]?.name || 'Person';
    };
    const money = value => formatProtocolValue({ format: 'money' }, value, entry, options);
    const line = (label, value) => `<span class="protocol-cashflow-line"><span>${escape(label)}</span><span>${escape(money(value))}</span></span>`;
    const deceased = name(estate.deceasedProfileId), survivor = name(estate.survivorProfileId);
    const allowance = inheritancePersonalAllowance(status);
    const nominalAllowance = formatProtocolValue({ format: 'money' }, allowance), realAllowance = money(allowance);
    const allowanceNote = options.moneyBasis === 'real' && realAllowance !== '—' && realAllowance !== nominalAllowance
        ? `<small>Freibetrag ${escape(nominalAllowance)} gilt nominal, in Euro von heute ${escape(realAllowance)}.</small>` : '';
    // VB-1: Versorgungsfreibetrag mit derselben Real-/Nominalbehandlung wie der persönliche Freibetrag.
    const relief = status ? estate.pensionAllowance : undefined;
    const nominal = value => formatProtocolValue({ format: 'money' }, value);
    const reliefNote = !relief ? '' : relief.missingAge ? 'Hinterbliebenenrente eingetragen, aber ohne Alter kein Versorgungsfreibetrag.'
        : [relief.capital > 0 ? `${nominal(PENSION_ALLOWANCE)} minus Kapitalwert der Hinterbliebenenrente ${nominal(relief.capital)}.` : '',
            options.moneyBasis === 'real' && money(relief.amount) !== '—' && money(relief.amount) !== nominal(relief.amount)
                ? `Versorgungsfreibetrag ${nominal(relief.amount)} gilt nominal, in Euro von heute ${money(relief.amount)}.` : ''].filter(Boolean).join(' ');
    const content = `<strong>Todesfall ${escape(deceased)}</strong>` + line(`${deceased}: Vermögen im Todesjahr`, estate.assets)
        + (estate.estateCosts > 0 ? line('Bestattungs- und Abwicklungskosten', estate.estateCosts) : '')
        + (estate.home > (estate.inheritedSaleProceeds || 0) ? line('dazu Immobilien', estate.home - (estate.inheritedSaleProceeds || 0)) : '')
        + (estate.inheritedSaleProceeds > 0 ? line(`Hauserlös (verkauft im Jahr ${[...new Set((Array.isArray(estate.homeSaleProceeds) ? estate.homeSaleProceeds : []).map(row => row.year))].join(', ')})`, estate.inheritedSaleProceeds) : '')
        + line(`${survivor} erbt (${estate.homeAndTax ? 'Immobilien + Steuer, zusätzlich ' : ''}${estate.homeMode ? 'nach Testament' : `${estate.percent} %`})`,
            estate.housingCapital > 0 ? estate.inherited + estate.inheritedHome + estate.housingCapital : estate.inherited + estate.inheritedHome)
        + (estate.homeMode ? line('Geldanteil', estate.inherited) + line('Immobilien', estate.inheritedHome)
            + (estate.homeMode === 'housing-capital'
                ? (estate.housingCapital > 0 ? line(`Wohnkapital (${estate.housingCapitalPercent.toLocaleString('de-DE')} % vom Nettoerlös)`, estate.housingCapital)
                    + (housingCapitalSaleRest(estate) > 0 ? line('Übriger Hauserlös an die anderen Erben', housingCapitalSaleRest(estate)) : '')
                    + `<small>Der Anteil von ${escape(deceased)} am selbst genutzten Haus wird verkauft. ${escape(survivor)} erhält das Wohnkapital aufs Tagesgeld und zahlt ab dem Folgejahr die Miete selbst.</small>`
                    : estate.housingCapitalCancelled ? `<small>${HOUSING_CAPITAL_CANCELLED}. Die übrigen Erben erhalten den Hausanteil.</small>`
                    : estate.moveOutYears > 0 ? `<small>${rentFreeThroughDescription(estate.moveOutYears)}. Im Verkaufsjahr beginnt die Miete. Den übrigen Erlös erhalten die anderen Erben.</small>` : '')
                : line(estate.homeMode === 'rent-bequest' ? 'Kapitalwert der Rente aus dem Erbe' : 'Kapitalwert Wohnrecht', estate.residenceCapital))
            + (estate.homeMode === 'residence' ? (estate.residenceIneligible
                ? '<small>Wohnrecht entfällt (Pflegeheim), Haus an die übrigen Erben.</small>'
                : '<small>Wohnrecht auf Lebenszeit: Haus bei den übrigen Erben, mietfreies Wohnen bis zur dauerhaften Heimpflege; kein Verkauf im Modell.</small>')
                : estate.rentBequestAnnual > 0 ? `<small>Der Verkaufserlös geht an die übrigen Erben. ${escape(survivor)} erhält ab dem Folgejahr lebenslang eine Rente aus dem Erbe, angepasst an die Inflation.</small>`
                : estate.homeMode === 'life-estate' ? '<span>Eigentum auf Lebenszeit, danach an die Kinder: kein Verkauf und keine Mieteinnahmen bei Heimpflege.</span>' : '') : '')
        + (estate.childrenMoneyCut > 0 ? line('Geldanteil gekürzt für den Pflichtteil der Kinder', estate.childrenMoneyCut) : '')
        + (estate.childrenShortfall > 0 ? line('Pflichtteil der Kinder nicht voll gedeckt', estate.childrenShortfall) : '')
        + (estate.homeAndTax ? line('davon Steuergeld', estate.taxCash) : '')
        + (estate.homeAndTax ? `<span>davon ${escape(money(estate.taxCashSaleTax || 0))} für Steuern beim Verkauf von Wertpapieren</span>` : '')
        + line('Erbschaftsteuer', estate.tax)
        + (status ? '' : `<small>${MISSING_PARTNERSHIP_STATUS}.</small>`)
        + allowanceNote
        + (status && estate.exemptGain > 0 ? line('steuerfrei als Zugewinnausgleich', estate.exemptGain) : '')
        + (relief ? line('Versorgungsfreibetrag (§ 17 ErbStG)', relief.amount) + (reliefNote ? `<small>${escape(reliefNote)}</small>` : '') : '')
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
    const outcomeLabel = ({ completed: 'Vollständig', no_ruin: 'Vermögen reicht', ruin: 'Vermögen aufgebraucht', all_dead: 'Haushalt verstorben', horizon_exhausted: 'Horizont erreicht',
        incomplete: 'Unvollständig', technical_error: 'Technischer Fehler' })[outcome];
    const lastEntry = data.filter(entry => Number.isFinite(protocolRowData(entry, source)?.portfolio_total_end)).at(-1);
    const last = protocolRowData(lastEntry, source);
    const badge = outcomeLabel ? chip(outcomeLabel, outcome === 'ruin' ? 'ruin' : outcome === 'all_dead' ? 'ended' : 'complete') : '';
    const metrics = [];
    // HP-3: Die Teile des Zusatzes brechen nicht in sich um; der Trennpunkt hängt am ersten Teil (wie der Alterstext, HP-2).
    const metric = (value, label, parts = []) => `<div class="ds-metric"><strong class="ds-metric-value">${escape(value)}</strong><span class="ds-metric-label">${escape(label)}</span>${parts.length ? `<small class="sim-money-detail">${parts.map((part, at) => `<span class="sim-money-part">${escape(part)}${at < parts.length - 1 ? ' ·' : ''}</span>`).join(' ')}</small>` : ''}</div>`;
    const inflation = source === 'backtest' ? lastEntry?.inflationVJ : last.inflation;
    const factor = Number.isFinite(last.inflation_factor_cum) && Number.isFinite(inflation)
        ? last.inflation_factor_cum * (1 + inflation / 100) : null;
    const end = Object.hasOwn(options, 'endWealth') ? options.endWealth : options.moneyBasis === 'real'
        ? Number.isFinite(factor) && factor > 0 ? last.portfolio_total_end / factor : null : last.portfolio_total_end;
    const homes = rowWealthParts(last, options.moneyBasis, factor);
    if (Number.isFinite(end)) metrics.push(metric(formatProtocolValue({ format: 'money' }, end + (homes?.total || 0)), `Gesamtvermögen · ${options.euroBasis || (options.moneyBasis === 'real' ? 'real' : 'nominal')}`, Number.isFinite(last.immobilien_wert_end) ? [`davon Geldvermögen ${formatProtocolValue({ format: 'money' }, end)}`, `Immobilien ${formatProtocolValue({ format: 'money' }, homes?.total)}`] : []));
    metrics.push(metric(flags.filter(flag => flag.cut).length, 'Jahre mit einer Kürzung'));
    metrics.push(metric(flags.filter(flag => flag.care).length, 'Pflegejahre'));
    return renderPersonDataNotice(options.personDataContext) + `<p class="protocol-subtitle">${escape(options.subtitle || `${data.length} Jahreszeilen · Anzeige unabhängig vom vollständigen Export`)}</p><div class="protocol-chips">${badge}<div class="protocol-metrics ds-kpi-strip">${metrics.join('')}</div></div>`;
}

/**
 * @param [options] - Optionen des Aufrufers.
 * @returns {string}
 */
export function renderProtocolLegend(options = {}) {
    const context = options.personDisplayContext || createProtocolPersonContext(options.inputs);
    const persons = options.source === 'backtest' ? '' : `✓ lebt · ${context.careEnabled ? 'PG Pflegegrad · ' : ''}† verstorben. `;
    return `<div class="protocol-legend"><span><i class="protocol-mark-cut" aria-hidden="true"></i>Jahr mit Kürzung</span><span><i class="protocol-mark-care" aria-hidden="true"></i>Pflegejahr</span><span><i class="protocol-mark-ruin" aria-hidden="true"></i>Vermögen aufgebraucht</span><span>${persons}Gepunktete Überschriften erklären die Spalten. Handel nennt verkauft oder gekauft.</span></div>`;
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
            title: `${name}: ${grade == null ? 'Pflegegrad unbekannt' : `Pflegegrad ${grade}`}${raw[`CareP${person}_HeimBestand`] ? ' · heute im Heim' : raw[`CareP${person}_HeimJahr`] ? ` · im Heim, Heimjahr ${raw[`CareP${person}_HeimJahr`]}` : ''}${(entry => entry ? ` · ${entry}` : '')(protocolResidentialEntry(rows[index], person - 1, { ...options, rows }))}` };
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
            let value = column.id ? readProtocolValue(column, entry, actionOptions) : undefined;
            const requested = typeof column.cellClass === 'function' ? column.cellClass(entry) : column.cellClass;
            const tradeClass = ['backtest-trade-sale', 'backtest-trade-buy'].includes(requested) ? requested : '';
            const numeric = column.align === 'right' ? ' protocol-number' : '';
            if (column.id === 'year') {
                const year = protocolYearPresentation(entry, index, options);
                // HP-2: Beide Teile brechen nicht in sich um; der Trennpunkt hängt am ersten Teil, damit keine Zeile mit „·“ beginnt.
                const parts = [source === 'mc' ? `Simulationsjahr ${escape(year.simulationYear ?? '—')}` : '', year.ages ? `Alter ${escape(year.ages)}` : ''].filter(Boolean);
                html += `<td class="protocol-year">${escape(year.calendarYear ?? '—')}<small>${parts.map((part, at) => `<span class="protocol-year-part">${part}${at < parts.length - 1 ? ' ·' : ''}</span>`).join(' ')}</small></td>`;
            } else if (column.format === 'person') {
                const state = protocolPersonPresentation(data, index, column, options);
                html += `<td class="protocol-person protocol-person-${state.tone}${groupStart(position) ? ' protocol-group-start' : ''}" title="${escape(state.title)}" aria-label="${escape(state.title)}"><span aria-hidden="true">${escape(state.text)}</span></td>`;
            } else {
                const formatted = options.formatValue ? options.formatValue(column, entry) : formatProtocolValue(column, value, entry, options);
                const action = column.id === 'action';
                const withdrawal = column.id === 'withdrawal';
                const cashflow = ['income-total', 'expense-total'].includes(column.id);
                // TRG-1c Punkt 5: Ein Rückgriff („Vermögen von … wird angegriffen“) bleibt auch im Todesjahr sichtbar.
                const actionInfo = action && (!raw.inheritance || options.strategyMode === STRATEGY_OPTIONS.THREE_BUCKET_JILGE || raw.personalPayoutSales?.length || raw.personalPayout?.attacked?.length || raw.personalPayout?.flexCut?.length || raw.hilfe_zur_pflege > 0 || raw.partner_grundbedarf?.length || raw.steuer_schuld_vorjahr > 0 || raw.steuer_offen > 0)
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
