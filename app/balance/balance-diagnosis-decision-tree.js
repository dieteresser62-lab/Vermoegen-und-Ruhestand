/**
 * Module: Balance Diagnosis Decision Tree
 * Purpose: Renders the "Decision Tree" section of the Diagnosis Panel.
 *          It visualizes the engine's decision path (Why was this action chosen?), formatting each step.
 * Usage: Used by balance-renderer-diagnosis.js to show the decision logic.
 * Dependencies: None
 */
"use strict";
import { displayDiagnosisText } from './balance-diagnosis-transaction.js';

export function buildDecisionTree(treeData = []) {
    const fragment = document.createDocumentFragment();
    treeData.forEach((item, index) => {
        const li = document.createElement('li');
        let severity = item.severity || 'info';
        if (item.step.toLowerCase().includes('cap wirksam')) {
            severity = 'guardrail';
        }

        li.className = `${item.status} severity-${severity} ${item.status === 'inactive' ? 'decision-inactive' : ''}`;
        const number = document.createElement('span');
        number.className = 'ds-decision-number';
        number.textContent = String(index + 1).padStart(2, '0');
        const body = document.createElement('div');
        body.className = 'ds-decision-body';
        const title = document.createElement('strong');
        title.textContent = displayDiagnosisText(item.step);
        body.appendChild(title);
        const impact = document.createElement('span');
        impact.className = 'impact';
        impact.textContent = displayDiagnosisText(item.impact);
        body.appendChild(impact);
        const result = document.createElement('span');
        result.className = `ds-plan-chip ${item.status === 'active' ? (severity === 'alarm' ? 'ds-plan-chip-bad' : severity === 'guardrail' ? 'ds-plan-chip-warn' : 'ds-plan-chip-good') : ''}`;
        result.textContent = displayDiagnosisText(item.result || (item.status === 'active' ? 'Aktiv' : 'Inaktiv'));
        li.append(number, body, result);
        fragment.appendChild(li);
    });
    return fragment;
}
