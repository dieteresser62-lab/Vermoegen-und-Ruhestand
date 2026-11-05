/** @import * as P from "../../typcheck/profile-ui.js" */
import { escapeHtml as esc } from '../shared/security-utils.js';
import { infoPopoverHtml } from '../shared/designsystem-info-popover.js';
import { appNow } from '../shared/app-clock.js';
import { readDecimalInput } from './tranchen-manager-decimal-input.js';

/** @param {string} id
 * @param {number} index
 * @param {P.TestamentRule} rule
 * @param {boolean} [disabled]
 * @returns {string} */
export function testamentFields(id, index, rule, disabled = false) {
    const now = appNow(), stand = rule.minimumStand || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const number = value => value === undefined ? '' : value.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: true });
    return `<fieldset class="pv-testament" data-testament-person="${esc(id)}"${disabled ? ' disabled' : ''}>
        ${disabled ? '<small class="ds-help">Gesperrt: Immobilien und Steuergeld werden zuerst vererbt. Deine Angaben bleiben gespeichert und gelten nach dem Ausschalten wieder.</small>' : ''}
        <div class="pv-inheritance-share"><label for="inheritance-min-${index}">mindestens (optional) ${infoPopoverHtml('Geldanteil begrenzen', 'Der Mindestbetrag behält die Kaufkraft des angegebenen Stands. Der Höchstanteil geht vor, auch wenn das Geld für den Mindestbetrag nicht reicht. Leer bedeutet: kein Mindestbetrag und höchstens 100 %. Bei Immobilien + Steuer zuerst das Häkchen oben ausschalten. Nachlass- und Vollstreckerkosten werden nicht gerechnet.')}</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-min-${index}" data-testament="minimum" inputmode="decimal" value="${number(rule.minimum)}"><span>€</span></div></div>
        <div class="pv-inheritance-share"${rule.minimum === undefined ? ' hidden' : ''}><label for="inheritance-stand-${index}">Kaufkraft Stand MM/JJJJ</label><input class="ds-input" id="inheritance-stand-${index}" data-testament="minimumStand" style="text-align:right"${rule.minimum === undefined ? ' disabled' : ''} value="${stand.slice(5)}/${stand.slice(0, 4)}" size="7"></div>
        <div class="pv-inheritance-share"><label for="inheritance-max-${index}">höchstens (optional)</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-max-${index}" data-testament="maximumPercent" inputmode="decimal" value="${rule.maximumPercent === undefined ? '' : rule.maximumPercent.toLocaleString('de-DE', { useGrouping: false })}"><span>%</span></div></div>
        <label for="inheritance-home-${index}">Immobilien ${infoPopoverHtml('Immobilien nach Testament', 'Wie Geldvermögen übernimmt denselben Erbanteil. Wohnrecht erlaubt mietfreies Wohnen bis Tod oder Heimpflege; Eigentum auf Lebenszeit geht später an die Kinder. Beide gelten für selbst genutzte Immobilien; vermietete Immobilien gehen an die übrigen Erben.', { handbookAnchor: 'tod-und-erbe' })}</label>
        <select class="ds-input" id="inheritance-home-${index}" data-testament="home">${[['money', 'wie Geldvermögen'], ['residence', 'Wohnrecht auf Lebenszeit'], ['life-estate', 'Eigentum auf Lebenszeit, danach an die Kinder']].map(([value, label]) => `<option value="${value}"${(rule.home || 'money') === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        ${rule.home === 'residence' ? `<label for="inheritance-residence-tax-${index}">Steuer auf das Wohnrecht ${infoPopoverHtml('Steuer auf das Wohnrecht', 'Sofort versteuert den Kapitalwert im Todesjahr. Jährlich verteilt die Steuer auf das Wohnrecht bis Tod oder dauerhafte Heimpflege; ein Freibetragsrest mindert die ersten Zahlungen.', { handbookAnchor: 'tod-und-erbe' })}</label><select class="ds-input" id="inheritance-residence-tax-${index}" data-testament="residenceTax"><option value="immediate"${rule.residenceTax !== 'annual' ? ' selected' : ''}>sofort</option><option value="annual"${rule.residenceTax === 'annual' ? ' selected' : ''}>jährlich (§ 23 ErbStG)</option></select>` : ''}
        <small class="pv-field-error" data-testament-error></small>
    </fieldset>`;
}

/** @param section Formularbereich mit Testamentfeldern.
 * @param {P.TestamentRule} [previousRule]
 * @returns Testamententwurf vor der bestehenden Validierung. */
export function readTestamentFields(section, previousRule = {}) {
    const raw = name => section.querySelector(`[data-testament="${name}"]`).value.trim();
    /** @param {string} value @param {string} [name] */
    const amount = (value, name) => readDecimalInput(value, section.querySelector(`[data-testament="${name}"]`));
    const rule = previousRule.residenceTax ? { residenceTax: previousRule.residenceTax } : {};
    if (raw('minimum') !== '') {
        const match = /^(0[1-9]|1[0-2])[/.](\d{4})$/.exec(raw('minimumStand'));
        if (!match) throw new Error('Mindestbetrag: Bitte den Stand als MM/JJJJ eingeben.');
        rule.minimum = amount(raw('minimum'), 'minimum'); rule.minimumStand = `${match[2]}-${match[1]}`;
    }
    if (raw('maximumPercent') !== '') rule.maximumPercent = amount(raw('maximumPercent'));
    if (raw('home') !== 'money') rule.home = raw('home');
    const taxChoice = section.querySelector('[data-testament="residenceTax"]');
    if (taxChoice) {
        if (taxChoice.value === 'annual') rule.residenceTax = 'annual'; else delete rule.residenceTax;
    }
    return rule;
}
