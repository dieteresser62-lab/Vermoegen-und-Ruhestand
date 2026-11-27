/** @import * as P from "../../typcheck/profile-ui.js" */
import { escapeHtml as esc } from '../shared/security-utils.js';
import { infoPopoverHtml } from '../shared/designsystem-info-popover.js';
import { appNow } from '../shared/app-clock.js';
import { readDecimalInput } from './tranchen-manager-decimal-input.js';

/** @param {number|string} index @param {P.TestamentRule} rule */
export function testamentHomeFields(index, rule) {
    const capital = rule.home === 'housing-capital', sale = rule.home === 'rent-bequest';
    if (!capital && !sale && rule.home !== 'residence') return '';
    const rent = `<div class="pv-inheritance-share"><label for="inheritance-monthly-rent-${index}">${capital ? 'Monatliche Miete der überlebenden Person' : 'Monatliche Miete für die überlebende Person'}</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-monthly-rent-${index}" data-testament="monthlyRent" inputmode="decimal" value="${rule.monthlyRent?.toLocaleString('de-DE', { maximumFractionDigits: 20 }) ?? ''}"><span>€</span></div></div>`;
    // ER-2: Wohnkapital als Geldvermächtnis, danach eigene Miete; keine Steuerwahl nach § 23.
    if (capital) return `<div class="pv-inheritance-share"><label for="inheritance-housing-capital-${index}">Wohnkapital in % vom Nettoerlös ${infoPopoverHtml('Wohnkapital', 'Der Anteil der verstorbenen Person am selbst genutzten Haus wird verkauft. Nettoerlös sind 90 % des Werts. Die überlebende Person erhält den eingetragenen Prozentsatz einmalig aufs Tagesgeld.', { handbookAnchor: 'tod-und-erbe' })}</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-housing-capital-${index}" data-testament="housingCapitalPercent" inputmode="decimal" value="${rule.housingCapitalPercent?.toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 20 }) ?? ''}"><span>%</span></div></div>${rent}
        <div class="pv-inheritance-share"><label for="inheritance-move-out-${index}">Auszug nach ${infoPopoverHtml('Auszug nach … Jahren', 'Bei 0 kommt das Wohnkapital im Todesjahr und die Miete beginnt im Folgejahr. Ab 1 bleibt das Haus im Todesjahr und für die eingetragenen Folgejahre mietfrei. Bei 1 beginnen Verkauf und Miete also im zweiten Folgejahr.', { handbookAnchor: 'tod-und-erbe' })}</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-move-out-${index}" data-testament="moveOutYears" inputmode="numeric" value="${rule.moveOutYears ?? 0}"><span>Jahren</span></div></div>`;
    const taxLabel = sale ? 'Steuer auf die Rente aus dem Erbe' : 'Steuer auf das Wohnrecht';
    const taxHelp = sale
        ? 'Sofort versteuert den Kapitalwert im Todesjahr. Jährlich läuft die Steuer bis zum Tod, auch im Heim. Ein Freibetragsrest mindert die ersten Zahlungen.'
        : 'Sofort versteuert den Kapitalwert im Todesjahr. Jährlich verteilt die Steuer auf das Wohnrecht bis Tod oder dauerhafte Heimpflege; ein Freibetragsrest mindert die ersten Zahlungen.';
    const tax = `<label for="inheritance-residence-tax-${index}">${taxLabel} ${infoPopoverHtml(taxLabel, taxHelp, { handbookAnchor: 'tod-und-erbe' })}</label><select class="ds-input" id="inheritance-residence-tax-${index}" data-testament="residenceTax"><option value="immediate"${rule.residenceTax !== 'annual' ? ' selected' : ''}>sofort</option><option value="annual"${rule.residenceTax === 'annual' ? ' selected' : ''}>jährlich (§ 23 ErbStG)</option></select>`;
    if (!sale) return tax;
    return `${rent}${tax}`;
}

/** @param {string} id @param {boolean} checked */
export function inheritanceToggle(id, checked) {
    return `<div class="ds-segment" role="group" aria-labelledby="${id}-label">${[[true, 'An'], [false, 'Aus']].map(([value, text]) =>
        `<button type="button" id="${id}-${value}" data-inheritance-toggle-value="${value}" aria-pressed="${value === checked}">${text}</button>`).join('')}</div>`;
}

/** @param {string} id
 * @param {number} index
 * @param {P.TestamentRule} rule
 * @param {boolean} [disabled]
 * @returns {string} */
export function testamentFields(id, index, rule, disabled = false) {
    const now = appNow(), stand = rule.minimumStand || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const number = value => value === undefined ? '' : value.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: true });
    return `<div class="pv-testament" data-testament-person="${esc(id)}">
        <div class="pv-inheritance-share"><label for="inheritance-estate-costs-${index}">Bestattungs- und Abwicklungskosten</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-estate-costs-${index}" data-testament="estateCosts" inputmode="decimal" value="${number(rule.estateCosts ?? 0)}"><span>€</span></div></div>
        <div class="pv-inheritance-share" data-inheritance-toggle><input type="checkbox" hidden id="inheritance-children-protected-${index}" data-testament="childrenProtected"${rule.childrenProtected ? ' checked' : ''}><span id="inheritance-children-protected-${index}-label" data-inheritance-toggle-label="children">Pflichtteilsberechtigte Kinder vorhanden</span>${inheritanceToggle(`inheritance-children-protected-${index}`, rule.childrenProtected === true)}</div>
        <fieldset class="pv-testament pv-testament-limits"${disabled ? ' disabled' : ''}>
        ${disabled ? '<small class="ds-help">Gesperrt: Immobilien und Steuergeld werden zuerst vererbt. Deine Angaben bleiben gespeichert und gelten nach dem Ausschalten wieder. Kosten und Pflichtteil oben gelten auch bei dieser Wahl.</small>' : ''}
        <div class="pv-inheritance-share"><label for="inheritance-min-${index}">mindestens (optional) ${infoPopoverHtml('Geldanteil begrenzen', 'Der Mindestbetrag behält die Kaufkraft des angegebenen Stands. Der Höchstanteil geht vor, auch wenn das Geld für den Mindestbetrag nicht reicht. Leer bedeutet: kein Mindestbetrag und höchstens 100 %.', { handbookAnchor: 'partnerschaft-todesfall' })}</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-min-${index}" data-testament="minimum" inputmode="decimal" value="${number(rule.minimum)}"><span>€</span></div></div>
        <div class="pv-inheritance-share"${rule.minimum === undefined ? ' hidden' : ''}><label for="inheritance-stand-${index}">Kaufkraft Stand MM/JJJJ</label><input class="ds-input" id="inheritance-stand-${index}" data-testament="minimumStand" style="text-align:right"${rule.minimum === undefined ? ' disabled' : ''} value="${stand.slice(5)}/${stand.slice(0, 4)}" size="7"></div>
        <div class="pv-inheritance-share"><label for="inheritance-max-${index}">höchstens (optional)</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-max-${index}" data-testament="maximumPercent" inputmode="decimal" value="${rule.maximumPercent === undefined ? '' : rule.maximumPercent.toLocaleString('de-DE', { useGrouping: false })}"><span>%</span></div></div>
        <label for="inheritance-home-${index}">Immobilien ${infoPopoverHtml('Immobilien nach Testament', 'Wohnrecht erlaubt mietfreies Wohnen bis Tod oder Heimpflege. Eigentum auf Lebenszeit geht später an die Kinder. Bei Verkauf mit Miete erhalten die Erben den Erlös und die überlebende Person erhält lebenslang Geld für eine Miete. Bei Verkauf mit Wohnkapital erhält sie einmalig einen Teil des Erlöses und zahlt die Miete selbst.', { handbookAnchor: 'tod-und-erbe' })}</label>
        <select class="ds-input" id="inheritance-home-${index}" data-testament="home">${[['money', 'wie Geldvermögen'], ['residence', 'Wohnrecht auf Lebenszeit'], ['life-estate', 'Eigentum auf Lebenszeit, danach an die Kinder'], ['rent-bequest', 'Verkauf, Miete auf Lebenszeit'], ['housing-capital', 'Verkauf mit Wohnkapital']].map(([value, label]) => `<option value="${value}"${(rule.home || 'money') === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <div class="pv-testament-home-fields" data-testament-home-fields="${index}">${testamentHomeFields(index, rule)}</div>
        </fieldset>
        <small class="pv-field-error" data-testament-error></small>
    </div>`;
}

/** @param section Formularbereich mit Testamentfeldern.
 * @param {P.TestamentRule} [previousRule]
 * @returns Testamententwurf vor der bestehenden Validierung. */
export function readTestamentFields(section, previousRule = {}) {
    const raw = name => section.querySelector(`[data-testament="${name}"]`)?.value.trim() ?? '';
    /** @param {string} value @param {string} [name] */
    const amount = (value, name) => readDecimalInput(value, section.querySelector(`[data-testament="${name}"]`));
    const rule = previousRule.residenceTax ? { residenceTax: previousRule.residenceTax } : {};
    if (raw('minimum') !== '') {
        const match = /^(0[1-9]|1[0-2])[/.](\d{4})$/.exec(raw('minimumStand'));
        if (!match) throw new Error('Mindestbetrag: Bitte den Stand als MM/JJJJ eingeben.');
        rule.minimum = amount(raw('minimum'), 'minimum'); rule.minimumStand = `${match[2]}-${match[1]}`;
    }
    if (raw('maximumPercent') !== '') rule.maximumPercent = amount(raw('maximumPercent'));
    if (raw('estateCosts') !== '') {
        const costs = amount(raw('estateCosts'), 'estateCosts');
        if (costs !== 0) rule.estateCosts = costs;
    }
    if (section.querySelector('[data-testament="childrenProtected"]')?.checked) rule.childrenProtected = true;
    if (raw('home') !== 'money') rule.home = raw('home');
    if (rule.home === 'housing-capital') {
        rule.housingCapitalPercent = amount(raw('housingCapitalPercent'), 'housingCapitalPercent');
        const years = raw('moveOutYears') || '0';
        const moveOutYears = /^\d+$/.test(years) ? Number(years) : NaN;
        if (moveOutYears !== 0) rule.moveOutYears = moveOutYears;
    }
    if (rule.home === 'rent-bequest' || rule.home === 'housing-capital') rule.monthlyRent = amount(raw('monthlyRent'), 'monthlyRent');
    const taxChoice = section.querySelector('[data-testament="residenceTax"]');
    if (taxChoice) {
        if (taxChoice.value === 'annual') rule.residenceTax = 'annual'; else delete rule.residenceTax;
    }
    return rule;
}
