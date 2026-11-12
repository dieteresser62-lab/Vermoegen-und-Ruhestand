// H-SE2-STRESS: Nach einem Lauf ohne Stress klappt ein folgender Lauf mit Stress die Zeile wie ein erster Lauf auf.
import { renderRiskDetails } from '../app/simulator/results-renderers.js';

/** Host wie im Browser: liest den Aufklappzustand aus dem zuletzt geschriebenen HTML. */
function host() {
    const rows = new Map();
    const element = { style: {}, dataset: {}, _html: '',
        get innerHTML() { return this._html; },
        set innerHTML(value) {
            this._html = value; rows.clear();
            for (const match of value.matchAll(/data-risk-row="(\w+)"( open)?/g)) rows.set(match[1], { dataset: { riskRow: match[1] }, open: Boolean(match[2]) });
        },
        querySelectorAll: selector => selector === '[data-risk-row]' ? [...rows.values()] : [],
        querySelector: () => null };
    return { element, rows };
}
const dashboard = { detailSections: [], reportingReferenceNotice: '' };
const stress = { stressMetrics: { presetLabel: 'Crash', years: 3 } };
{
    const { element, rows } = host();
    renderRiskDetails(element, dashboard);
    assertEqual(rows.get('stress').open, false, 'Ohne Stress bleibt die Zeile zu');
    renderRiskDetails(element, dashboard, stress);
    assertEqual(rows.get('stress').open, true, 'Folgender Lauf mit Stress zeigt die Zeile wie ein erster Lauf mit Stress');
    rows.get('stress').open = false;
    renderRiskDetails(element, dashboard, stress);
    assertEqual(rows.get('stress').open, false, 'Bei gleichem Stresszustand bleibt die Wahl der Nutzerin erhalten');
    renderRiskDetails(element, dashboard);
    assertEqual(rows.get('stress').open, false, 'Zurück ohne Stress: Zeile zu');
}
{
    const { element, rows } = host();
    renderRiskDetails(element, dashboard, stress);
    assertEqual(rows.get('stress').open, true, 'Erster Lauf mit Stress: Zeile offen');
}
