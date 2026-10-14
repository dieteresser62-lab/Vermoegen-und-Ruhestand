/**
 * Module: Balance Diagnosis Guardrails
 * Purpose: Renders the "Guardrails" section of the Diagnosis Panel.
 *          Displays individual guardrail metrics (e.g., withdrawal rate thresholds) as cards with status colors.
 * Usage: Used by balance-renderer-diagnosis.js to visualize guardrail statuses.
 * Dependencies: None
 */
"use strict";

import { UIUtils } from './balance-utils.js';
import { displayDiagnosisText } from './balance-diagnosis-transaction.js';
import { formatDisplayPercentRatio, formatDisplayNumberWithUnit } from '../shared/shared-formatting.js';

// Ergänzt nur die Kartenanzeige aus dem Rohwert. Copy liest weiterhin value;
// formatierte Texte werden weder zurückgeparst noch auf Zahlen zurückgeschrieben.
export function withGuardrailCardValues(formatted, raw) {
    if (!Array.isArray(formatted?.guardrails)) return formatted;
    return { ...formatted, guardrails: formatted.guardrails.map((guardrail, index) => {
        const source = raw?.guardrails?.[index];
        if (source?.name !== guardrail.name) return guardrail;
        const drawdown = source.name.includes('Drawdown');
        const cardFormat = (value, invert = false) => {
            if (!Number.isFinite(value)) return 'Nicht verfügbar';
            const signed = invert && value > 0 ? -value : value;
            if (source.type === 'currency') return UIUtils.formatBalanceCurrency(signed);
            if (source.type === 'percent') return formatDisplayPercentRatio(signed, { fractionDigits: 1 });
            if (source.type === 'months') return formatDisplayNumberWithUnit(signed, 'Mon.', 0);
            return formatDisplayNumberWithUnit(signed, '', 1);
        };
        const minimum = (source.rule || 'max') === 'min';
        const mirrored = drawdown && source.threshold >= 0;
        const operator = minimum !== mirrored ? '≥' : '≤';
        return { ...guardrail, cardValue: cardFormat(source.value, drawdown),
            rule: source.rule || 'max',
            cardThreshold: `${operator} ${cardFormat(source.threshold, drawdown)}`,
            cardTriggered: source.name === 'Inflations-Cap' && source.details?.capBinding === true };
    }) };
}

let infoSequence = 0;

export function createDiagnosisInfo(label, text) {
    const host = document.createElement('span');
    host.className = 'ds-info';
    host.dataset.visible = 'false';
    const button = document.createElement('button');
    button.className = 'ds-info-button';
    button.type = 'button';
    button.textContent = 'i';
    const pop = document.createElement('span');
    pop.className = 'ds-info-pop';
    pop.id = `diagnosis-info-${++infoSequence}`;
    pop.setAttribute('role', 'tooltip');
    pop.textContent = displayDiagnosisText(text);
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', pop.id);
    button.setAttribute('aria-describedby', pop.id);
    host.append(button, pop);
    return host;
}

export function buildGuardrails(guardrailData = []) {
    const fragment = document.createDocumentFragment();
    guardrailData.forEach(g => {
        const card = document.createElement('div');
        card.className = `guardrail-card status-${g.status} ${g.status === 'ok' ? 'guardrail-ok' : ''} ${g.cardTriggered === true ? 'guardrail-triggered' : ''}`;
        const name = document.createElement('strong');
        name.textContent = displayDiagnosisText(g.name.startsWith('Runway') ? `${g.name} · nach Vorschlag` : g.name);
        if (g.name === 'Inflations-Cap') {
            name.className = 'guardrail-head';
            name.appendChild(createDiagnosisInfo(`Erläuterung: ${g.name}`,
                ['Begrenzt die Inflationsanpassung bei erhöhter Entnahmequote. „Löst aus“ erscheint nur bei einem belegten bindenden Cap.', g.note].filter(Boolean).join(' ')));
        }
        const value = document.createElement('div');
        value.className = 'value';
        value.textContent = displayDiagnosisText(g.cardValue ?? g.value);
        const threshold = document.createElement('div');
        threshold.className = 'threshold';
        threshold.textContent = `Grenze ${g.cardThreshold ?? g.threshold}`;
        card.append(name, value, threshold);
        if (g.note && g.name !== 'Inflations-Cap') {
            if (g.status === 'ok' || g.status === 'info') {
                card.appendChild(createDiagnosisInfo(`Erläuterung: ${g.name}`, g.note));
            } else {
                const note = document.createElement('div');
                note.className = 'threshold';
                note.textContent = displayDiagnosisText(g.note);
                card.appendChild(note);
            }
        }
        const status = document.createElement('span');
        status.className = `ds-plan-chip ${g.cardTriggered === true ? 'ds-chip-warning' : g.status === 'danger' ? 'ds-chip-error' : g.status === 'warn' ? 'ds-chip-warning' : g.status === 'ok' ? 'ds-chip-success' : ''}`;
        const breach = g.rule === 'min'
            ? g.name === 'Budget-Floor Deckung' ? 'Deckungsziel nicht erreicht' : 'Mindestgrenze unterschritten'
            : 'Grenze überschritten';
        status.textContent = g.cardTriggered === true ? 'Löst aus' : { ok: 'Eingehalten', warn: 'Nahe der Grenze', danger: breach, info: 'Hinweis' }[g.status] || 'Hinweis';
        card.appendChild(status);
        fragment.appendChild(card);
    });
    return fragment;
}
