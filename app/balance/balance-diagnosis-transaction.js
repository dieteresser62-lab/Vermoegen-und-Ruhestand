import { formatDisplayPercentValue, formatDisplayPercentRatio, formatDisplayMonths } from '../shared/shared-formatting.js';
/**
 * Module: Balance Diagnosis Transaction
 * Purpose: Renders curated transaction rows and complete technical details in the Diagnosis Panel.
 *          Explains WHY a specific transaction (or no transaction) was recommended (e.g., blocked by Gold Floor).
 * Uage: Used by balance-renderer-diagnosis.js to provide transparency on engine decisions.
 * Dependencies: balance-utils.js
 */
"use strict";

import { UIUtils } from './balance-utils.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { describeBalanceActionSummary } from './balance-action-summary.js';

const THRESHOLD_LABEL_MAP = Object.freeze({
    allocationpolicy: 'Allokationsregel',
    maxskimpctofeq: 'Maximale Aktienabschöpfung (% des Aktienwerts)',
    currentgoldvalue: 'Aktueller Goldwert',
    targetpct: 'Goldzielanteil',
    maxbearrefillpctofeq: 'Auffüllgrenze im Bärenmarkt (% des Aktienwerts)',
    salebudgetequitytotal: 'Aktien-Verkaufsbudget',
    salebudgetgold: 'Gold-Verkaufsbudget',
    maxsellamount: 'Maximaler Verkaufsbetrag',
    capratepct: 'Verkaufsobergrenze',
    direction: 'Handelsrichtung', kind: 'Anlageart', title: 'Beschreibung',
    netamount: 'Nettobetrag', netto: 'Netto', amount: 'Betrag',
    liquidityuse: 'Verwendung für Liquidität', golduse: 'Verwendung für Gold', equityuse: 'Verwendung für Aktien',
    name: 'Name', taxpereuro: 'Steuer je Euro', brutto: 'Brutto', steuer: 'Steuer',
    wastriggered: 'Empfehlung ausgelöst', blockreason: 'Blockierungsgrund', blockedamount: 'Blockierter Betrag',
    potentialtrade: 'Hypothetischer Handel', equitythresholds: 'Aktien-Grenzen', goldthresholds: 'Gold-Grenzen',
    selectedtranches: 'Tranchenauswahl',
    quellen: 'Quellen', sources: 'Quellen', verwendungen: 'Verwendungen', uses: 'Verwendungen',
    source: 'Quelle', profileid: 'Profilkennung', trancheid: 'Tranchenkennung',
    kaufakt: 'Aktienkauf', kaufgld: 'Goldkauf', verkaufliquiditaet: 'Eingesetzte Liquidität',
    grund: 'Begründung',
    targetallocationpct: 'Ziel-Allokation',
    maxallocationpct: 'Max. Allokation',
    maxallocpctofeq: 'Max. Allokation (Eq)',
    rebalancingbandpct: 'Rebalancing-Band',
    minallocationpct: 'Min. Allokation',
    targetgoldvalue: 'Zielwert Gold',
    mingoldreserve: 'Min. Goldreserve',
    maxbearrellicofeq: 'Max. Drawdown Eq',
    minrunwaymonate: 'Min. Runway (Monate)',
    targetrunwaymonate: 'Ziel-Runway (Monate)',
    minsoldreserve: 'Min. Reserve'
});

export function buildTransactionDiagnostics(transactionDiag, actionSummary = null) {
    const fragment = document.createDocumentFragment();

    if (!transactionDiag || typeof transactionDiag !== 'object') {
        const emptyState = document.createElement('p');
        emptyState.className = 'diag-empty-state';
        emptyState.textContent = 'Keine Transaktionsdiagnostik verfügbar.';
        fragment.appendChild(emptyState);
        if (actionSummary) fragment.appendChild(createTransactionCard({ title: 'Transaktionsstatus', rows: [{ label: 'Geplante Aktion', value: describeBalanceActionSummary(actionSummary, UIUtils.formatBalanceCurrency) }] }));
        return fragment;
    }

    const statusMeta = determineTransactionStatus(transactionDiag);
    const summaryRows = [
        { label: 'Empfehlung ausgelöst', value: transactionDiag.wasTriggered ? 'Ja' : 'Nein' },
        { label: 'Blockiert', value: statusMeta.label },
        {
            label: 'Blockierter Betrag',
            value: UIUtils.formatBalanceCurrency(transactionDiag.blockedAmount || 0)
        }
    ];

    summaryRows.push({ label: 'Geplante Aktion', value: describeBalanceActionSummary(actionSummary, UIUtils.formatBalanceCurrency) });
    const selected = transactionDiag.selectedTranches;
    summaryRows.push({ label: 'Tranchenauswahl', value: Array.isArray(selected) && selected.length
        ? `${selected.length} Tranchen · geringste Steuerlast zuerst` : 'Keine Tranchen ausgewählt' });
    const whyNot = actionSummary?.goldPurchaseAmount > 0 ? [] : buildGoldWhyNotRows(transactionDiag);
    if (whyNot.length) summaryRows.push({ label: 'Warum kein Goldkauf?', value: whyNot[0].value });
    for (const [label, values] of [['Aktien-Grenzen', transactionDiag.equityThresholds], ['Gold-Grenzen', transactionDiag.goldThresholds]]) {
        if (values && Object.keys(values).length) summaryRows.push({ label,
            value: compactThresholds(values, label === 'Aktien-Grenzen') });
    }
    fragment.appendChild(createTransactionCard({
        title: 'Transaktionsstatus',
        rows: summaryRows
    }, statusMeta.status));

    const details = document.createElement('details');
    details.className = 'ds-technical-details';
    const heading = document.createElement('summary');
    heading.textContent = 'Technische Details';
    details.appendChild(heading);
    const completeRows = transactionDetailRows(transactionDiag);
    details.appendChild(createTransactionCard({ title: 'Vollständige Transaktionsdaten', rows: completeRows }, 'info'));
    buildWhyNotCards(transactionDiag, actionSummary).forEach(card => details.appendChild(card));
    fragment.appendChild(details);

    return fragment;
}

// Keine Handelsentscheidung: nur tatsächlich gelieferte Grenzen kurz benennen.
function compactThresholds(values, equity) {
    if (equity) {
        if (Number.isFinite(values.maxBearRefillPctOfEq)) return `Bärenauffüllung ≤ ${formatThresholdValue('maxBearRefillPctOfEq', values.maxBearRefillPctOfEq)} des Aktienwerts`;
        if (Number.isFinite(values.maxSkimPctOfEq)) return `Abschöpfen ≤ ${formatThresholdValue('maxSkimPctOfEq', values.maxSkimPctOfEq)} des Aktienwerts`;
        return 'Weitere Aktiengrenzen in den technischen Details';
    }
    const { currentGoldValue: current, minGoldReserve: minimum, targetGoldValue: target, targetPct } = values;
    if (Number.isFinite(current) && Number.isFinite(minimum) && minimum > 0 && current < minimum) return `Unter Mindestreserve von ${UIUtils.formatBalanceCurrency(minimum)}`;
    if (Number.isFinite(current) && Number.isFinite(target) && target > 0) return current < target
        ? `Unter Goldziel von ${UIUtils.formatBalanceCurrency(target)}`
        : `Goldziel von ${UIUtils.formatBalanceCurrency(target)} erreicht`;
    if (Number.isFinite(current) && Number.isFinite(minimum) && minimum > 0) return `Mindestreserve von ${UIUtils.formatBalanceCurrency(minimum)} erfüllt`;
    if (Number.isFinite(targetPct) && targetPct > 0) return `Zielanteil ${formatThresholdValue('targetPct', targetPct)}`;
    return 'Weitere Goldgrenzen in den technischen Details';
}

function determineTransactionStatus(diag) {
    const reasonKey = (diag.blockReason || 'none').toLowerCase();
    const statusMap = {
        none: 'ok',
        min_trade: 'warn',
        liquidity_sufficient: 'info',
        guardrail_block: 'danger',
        cap_active: 'warn',
        gold_floor: 'danger'
    };
    const labelMap = {
        none: 'Keine Blockade',
        min_trade: 'Unter Mindestgröße',
        liquidity_sufficient: 'Liquidität ausreichend',
        guardrail_block: 'Leitplanke verhindert Verkauf',
        cap_active: 'Obergrenze begrenzt Handel',
        gold_floor: 'Gold-Mindestreserve aktiv'
    };

    const status = statusMap[reasonKey] || (diag.wasTriggered ? 'ok' : 'info');
    const label = labelMap[reasonKey] || 'Weitere Einschränkung';
    return { status, label };
}

function buildWhyNotCards(diag, actionSummary = null) {
    const cards = [];
    if (actionSummary?.goldPurchaseAmount > 0) return cards;
    const goldRows = buildGoldWhyNotRows(diag);
    if (goldRows.length) {
        cards.push(createTransactionCard({
            title: 'Warum kein Goldkauf?',
            subtitle: 'Nicht jede Zielabweichung ist ein sofortiger Kaufauftrag.',
            rows: goldRows
        }, 'info'));
    }
    return cards;
}

function buildGoldWhyNotRows(diag) {
    const thresholds = diag?.goldThresholds || {};
    const targetPct = Number(thresholds.targetPct || 0);
    const minGoldReserve = Number(thresholds.minGoldReserve || 0);
    const targetGoldValue = Number(thresholds.targetGoldValue || 0);
    const currentGoldValue = Number(thresholds.currentGoldValue || 0);
    const potentialGoldUse = Number(diag?.potentialTrade?.goldUse || 0);

    if (!(targetPct > 0 || minGoldReserve > 0 || targetGoldValue > 0)) {
        return [];
    }
    if (potentialGoldUse > 0) {
        return [];
    }

    let reason = 'Gold-Ziel wird beobachtet, löst aber aktuell keinen Kauf aus.';
    const reasonKey = (diag?.blockReason || 'none').toLowerCase();
    const underMinReserve = minGoldReserve > 0 && currentGoldValue < minGoldReserve;
    const underTarget = targetGoldValue > 0 && currentGoldValue < targetGoldValue;

    if (reasonKey === 'liquidity_sufficient') {
        reason = 'Keine Transaktion nötig: Liquidität und Rebalancing-Regeln lösen aktuell keinen Kaufauftrag aus.';
    } else if (reasonKey === 'min_trade') {
        reason = 'Zielabweichung liegt unter Mindestgröße bzw. Hysterese; kein kleiner Einzelkauf.';
    } else if (reasonKey === 'guardrail_block' || reasonKey === 'cap_active') {
        reason = 'Liquiditäts-/Guardrail-Schutz hat Vorrang vor Gold-Aufbau.';
    } else if (underMinReserve || underTarget) {
        reason = 'Gold liegt unter Ziel, aber Kauf wird erst bei ausreichender freier Liquidität und relevanter Rebalancing-Abweichung vorgeschlagen.';
    }

    const rows = [{ label: 'Grund', value: reason }];
    if (Number.isFinite(currentGoldValue)) {
        rows.push({ label: 'Aktueller Goldwert', value: UIUtils.formatCurrency(currentGoldValue) });
    }
    if (targetGoldValue > 0) {
        rows.push({ label: 'Zielwert Gold', value: UIUtils.formatCurrency(targetGoldValue) });
    }
    if (minGoldReserve > 0) {
        rows.push({ label: 'Mindestreserve Gold', value: UIUtils.formatCurrency(minGoldReserve) });
    }
    return rows;
}

function createTransactionCard(config, status = 'info') {
    const card = document.createElement('div');
    card.className = `ds-transaction-data status-${status}`;
    const title = document.createElement('strong');
    title.textContent = config.title;
    card.appendChild(title);

    if (config.subtitle) {
        const subtitle = document.createElement('div');
        subtitle.className = 'threshold';
        subtitle.textContent = config.subtitle;
        card.appendChild(subtitle);
    }

    config.rows.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'value-row';
        const labelEl = document.createElement('span');
        labelEl.className = 'label';
        labelEl.textContent = row.label;
        const valueEl = document.createElement('span');
        valueEl.className = 'value';
        valueEl.textContent = displayDiagnosisText(row.value || 'n/a');
        rowEl.append(labelEl, valueEl);
        card.appendChild(rowEl);
    });

    return card;
}

export function formatThresholdLabel(key) {
    const normalized = (key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return THRESHOLD_LABEL_MAP[normalized] || 'Weitere Angabe';
}

function formatThresholdValue(key, value) {
    if (typeof value !== 'number' || !isFinite(value)) {
        return displayDiagnosisText(value ?? 'Nicht verfügbar');
    }
    if (/pct|percent/i.test(key)) {
        return formatDisplayPercentValue(value, { fractionDigits: 1, invalid: 'n/a' });
    }
    if (/monate|months|mon/i.test(key)) {
        return formatDisplayMonths(value, { fractionDigits: 0, invalid: 'n/a' });
    }
    return UIUtils.formatCurrency(value);
}

/** Vollständige lesende Projektion; unbekannte Felder gehen nicht verloren. */
export function transactionDetailRows(data, prefix = '') {
    if (!data || typeof data !== 'object') return [];
    return Object.entries(data).flatMap(([key, value]) => {
        const label = [prefix, formatThresholdLabel(key)].filter(Boolean).join(' / ');
        if (value && typeof value === 'object') {
            if (Array.isArray(value)) return value.flatMap((item, index) =>
                item && typeof item === 'object' ? transactionDetailRows(item, `${label} ${index + 1}`)
                    : [{ label: `${label} ${index + 1}`, value: displayDiagnosisText(item) }]);
            return transactionDetailRows(value, label);
        }
        let formatted;
        if (key === 'taxPerEuro') formatted = formatDisplayPercentRatio(value, { fractionDigits: 2, invalid: 'Nicht verfügbar' });
        else if (typeof value === 'boolean') formatted = value ? 'Ja' : 'Nein';
        else formatted = formatThresholdValue(key, value);
        return [{ label, value: formatted }];
    });
}

const DIAGNOSIS_TERMS = Object.freeze({
    no_fixed_equity_target: 'Kein festes Aktienziel',
    runway_need_without_fixed_equity_target: 'Liquiditätsbedarf ohne festes Aktienziel',
    gold_target_then_equity: 'Zuerst Goldziel, danach Aktien', surplus: 'Überschuss',
    aktien_alt: 'Aktien (Altbestand)', aktien_neu: 'Aktien (Neubestand)', aktien: 'Aktien',
    liquiditaet: 'Liquidität', geldmarkt: 'Geldmarkt', gold: 'Gold', anleihe: 'Anleihen',
    none: 'Keine', min_trade: 'Unter Mindestgröße', liquidity_sufficient: 'Liquidität ausreichend',
    guardrail_block: 'Leitplanke verhindert Verkauf', cap_active: 'Obergrenze begrenzt Handel', gold_floor: 'Gold-Mindestreserve aktiv',
    bear_deep: 'Tiefer Bärenmarkt', bear_mild: 'Milder Bärenmarkt', correction: 'Korrektur',
    allTimeHigh: 'Allzeithoch', windowHigh: 'Hoch im Datenfenster',
    severe_bear_wealth_emergency: 'Schwere Flex-Notlage', spending_guardrail: 'Entnahmeleitplanke',
    flex_rate_hard_cap: 'Harte Flexratenobergrenze', safety_cap: 'Sicherheitsobergrenze',
    post_total_wealth_drawdown_gate: 'Nach Prüfung des realen Vermögensrückgangs',
    minimum_flex: 'Mindest-Flex', flex_budget: 'Flex-Budget', final_smoothing: 'Abschließende Glättung',
    static_flex: 'Statischer Flex', policy_base: 'Grundregel', initial_flex_policy: 'Anfängliche Flex-Regel',
    post_spending_guardrails: 'Nach Prüfung der Entnahmeleitplanken',
    post_internal_smoothing_and_flex_rate_hard_caps: 'Nach interner Glättung und harten Flexgrenzen',
    peak_hot: 'Markt heiß gelaufen', peak_stable: 'Stabiler Höchststand', recovery: 'Bestätigte Erholung',
    corr_young: 'Junge Korrektur', side_long: 'Lange Seitwärtsbewegung', recovery_in_bear: 'Erholung im Bärenmarkt',
    alarm: 'Alarm', bear_deep_raw_cut: 'Rohkürzung im tiefen Bärenmarkt'
});

/** Nur am Anzeigehost: Quelltexte, Kennungen und Fachwerte bleiben unverändert. */
export function displayDiagnosisText(value, { formatNumbers = true } = {}) {
    let text = String(value ?? 'Nicht verfügbar');
    for (const [term, label] of Object.entries(DIAGNOSIS_TERMS)) {
        text = text.replace(new RegExp(`\\b${term}\\b`, 'g'), label);
    }
    const words = { pruefen: 'prüfen', noetig: 'nötig', ausgeloest: 'ausgelöst', ungueltig: 'ungültig',
        Liquiditaet: 'Liquidität', geschaetzt: 'geschätzt', verfuegbar: 'verfügbar', fuer: 'für',
        erhoeht: 'erhöht', zurueck: 'zurück', uebernommen: 'übernommen', beschaedigte: 'beschädigte', ausdrueckliche: 'ausdrückliche', Guardrail: 'Leitplanke', Refill: 'Auffüllen' };
    for (const [word, label] of Object.entries(words)) text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), label);
    if (formatNumbers) {
        text = text.replace(/->/g, '→');
        // Engine-Sätze enthalten Rohzahlen mit Punkt und direkt angehängter Einheit.
        // Bereits deutsch formatierte Werte (Komma/NBSP) bleiben unverändert.
        text = text.replace(/(?<![\w.,])(-?\d+(?:[.,]\d+)*)([ \u00a0]*)([%€])/g, (match, number, space, unit) => {
            if (number.includes(',') || space.includes('\u00a0')) return match;
            const value = Number(number);
            if (!Number.isFinite(value)) return match;
            const fractionDigits = unit === '€' ? 0 : (number.split('.')[1]?.length || 0);
            return formatDisplayNumber(value, { unit: unit === '€' ? 'currency' : 'percent', fractionDigits });
        });
    }
    return text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
}
