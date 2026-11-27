import { displayDecimalInput, readDecimalInput } from './tranchen-manager-decimal-input.js';
import { PARTNERSHIP_KEY, readPartnership, inheritancePreview, inheritancePercent, inheritsHomeAndTax, FAMILY_HOME_CONDITIONS, hasTestament, testamentRule, testamentDescription, residenceAnnualValue, hasInheritanceHomes, maritalPropertyRegime, maritalPropertyLabel, spouseTaxNote, inheritancePersonalAllowance, MISSING_PARTNERSHIP_STATUS, MISSING_BEQUEST_RENT, MISSING_SURVIVOR_RENT, MISSING_HOUSING_CAPITAL, INVALID_MOVE_OUT_YEARS, moveOutDescription, rentFreeThroughDescription, HOUSING_CAPITAL_CANCELLED } from '../profile/household-partnership.js';
import { persistenceStorage, PersistenceFacade } from '../shared/persistence-facade.js';
import { escapeHtml as esc } from '../shared/security-utils.js';
import { infoPopoverHtml, bindInfoPopovers } from '../shared/designsystem-info-popover.js';

import { inheritanceToggle, testamentFields, testamentHomeFields, readTestamentFields } from './tranchen-manager-testament.js';
import { inheritanceReferenceFactor } from '../simulator/simulator-inheritance.js';
import { appNow } from '../shared/app-clock.js';
import { personDisplayAge } from '../profile/profile-person-data.js';

const states = new WeakMap();
const money = value => `${value.toLocaleString('de-DE', { maximumFractionDigits: 0 })}\u00a0€`;
const percent = value => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
function getState(doc) {
    if (!states.has(doc)) states.set(doc, { draft: null, raw: null, people: [], writing: null, notify: () => {}, blocked: () => false, fieldsBlocked: () => false });
    return states.get(doc);
}
function preview(person, value, partnership, partner) {
    const partnerName = partner.name;
    const valuationYear = appNow().getFullYear();
    const todayAge = personDisplayAge({ profile_geburtsdatum: partner.values.geburtsdatum });
    const partnerAge = todayAge.status === 'valid' ? todayAge.age : partner.values.alter;
    const homeValue = (person.values.immobilien || []).reduce((sum, home) => sum + home.wert, 0);
    const selfUsedHome = (person.values.immobilien || []).filter(home => home.nutzung === 'selbst').reduce((sum, home) => sum + home.wert, 0);
    const exemptHome = Math.max(0, ...(person.values.immobilien || []).filter(home => home.nutzung === 'selbst').map(home => home.wert));
    const hasHomes = hasInheritanceHomes(person.values.immobilien);
    const residenceEligible = !(partner.values.careToday?.grade > 0 && partner.values.careToday.form === 'residential');
    const homeAndTax = inheritsHomeAndTax(partnership, person.id, hasHomes);
    const savedRule = testamentRule(partnership, person.id);
    const rule = hasTestament(partnership, person.id, hasHomes) ? savedRule : null;
    const rentBequest = rule?.home === 'rent-bequest' && selfUsedHome > 0;
    const housingCapital = rule?.home === 'housing-capital' && selfUsedHome > 0;
    const moveOutYears = rule?.moveOutYears ?? 0;
    const lifetimeBenefit = rentBequest ? 'die Rente aus dem Erbe' : 'das Wohnrecht';
    if ((rentBequest || rule?.home === 'residence' && residenceEligible && selfUsedHome > 0) && (!Number.isFinite(partnerAge) || partnerAge < 0)) {
        return `<p class="pv-field-error">Für ${lifetimeBenefit} fehlt das Alter von ${esc(partnerName)}.</p>`;
    }
    /** @type {import("../../typcheck/tranches-ui.js").InheritancePreview} */
    const result = inheritancePreview(person.assets, homeValue, value, { status: partnership.status, maritalPropertyRegime: maritalPropertyRegime(partnership), valuationYear,
        homeAndTax, exemptHome, selfUsedHome, familyHome: exemptHome,
        residenceEligible, housingCapitalEligible: residenceEligible, partnerGender: partner.values.genderAssumed ? undefined : partner.values.geschlecht,
        residenceValue: (person.values.immobilien || []).filter(home => home.nutzung === 'selbst')
            .reduce((sum, home) => sum + residenceAnnualValue(home.wert, home.ortsueblicheMiete), 0),
        ...(homeAndTax ? { testament: savedRule } : rule ? { testament: rule, partnerAge,
            minimumFactor: rule.minimumStand ? inheritanceReferenceFactor(rule.minimumStand, { referenceYear: valuationYear }, 1) : 1 } : {}),
        cash: person.values.tagesgeld, tranches: person.tranches, kirchensteuerSatz: (partner.values.kirchensteuerPct || 0) / 100,
        sparerPauschbetrag: partner.values.sparerPauschbetrag, taxStatePrev: partner.taxState });
    const married = partnership.status === 'married', allowance = inheritancePersonalAllowance(partnership.status);
    const inherited = person.assets - (result.estateCosts || 0) - result.leaves + result.home + (result.residenceCapital || 0)
        + (moveOutYears > 0 ? 0 : result.housingCapital || 0);
    const familyHome = married ? result.exemptHome ?? exemptHome * value / 100 : 0;
    const familyNotice = familyHome > 0 ? `<p class="ds-help">Familienheim-Befreiung angenommen ${infoPopoverHtml('Bedingungen der Familienheim-Befreiung', FAMILY_HOME_CONDITIONS
        + ((person.values.immobilien || []).filter(home => home.nutzung === 'selbst').length > 1 ? ' Steuerfrei ist nur das Familienheim – bei mehreren selbst genutzten Immobilien die wertvollste.' : ''))}</p>` : '';
    const relief = !result.residenceTax && result.taxable * result.rate - result.tax > .005;
    const taxText = result.residenceTax ? `Steuersatz ${percent(result.rate * 100)} % nach dem Gesamterwerb einschließlich ${rentBequest ? 'Rente aus dem Erbe' : 'Wohnrecht'} und Härteausgleich; im Todesjahr ${money(result.tax)} auf den Geld- und Immobilienanteil nach Freibetrag` : `Steuersatz ${percent(result.rate * 100)} % auf ${money(result.taxable)} steuerpflichtig (${money(inherited)} − ${money(allowance)} Freibetrag${familyHome ? ` − ${money(familyHome)} Familienheim` : ''}, auf volle 100 € abgerundet)${relief ? ' · mit Härteausgleich' : ''}`;
    const owner = `${person.name}${/[sxzß]$/i.test(person.name) ? '’' : 's'}`;
    const taxSource = result.shortfall > 0 ? 'dem Nachlass und dem Geld des Partners' : `${owner} Geld`;
    const annual = result.residenceTax;
    const annualText = annual ? `im Todesjahr ${money(result.tax)} · danach ${money(annual.annualTax)} im Jahr, ${rentBequest ? 'solange die Rente läuft' : 'solange das Wohnrecht besteht'}` : '';
    const capitalSummary = housingCapital && result.housingCapital > 0
        ? `${moveOutYears > 0 ? `${rentFreeThroughDescription(moveOutYears)}. ` : ''}${partnerName} erhält Wohnkapital ${money(result.housingCapital)} (${percent(rule.housingCapitalPercent)} % vom Nettoerlös des Hausverkaufs) und zahlt ${moveOutYears > 0 ? 'ab dem Verkauf ' : 'ab dem Folgejahr '}die Miete von ${money(rule.monthlyRent)} im Monat selbst. Den übrigen Erlös erhalten die anderen Erben. ${moveOutYears > 0 ? `Steuer beim Auszug ${money(result.moveOutTax)}.` : `Steuer ${money(result.tax)}.`}`
        : `${HOUSING_CAPITAL_CANCELLED}. Die übrigen Erben erhalten den Hausanteil.`;
    const summary = housingCapital
        ? `${moveOutDescription(moveOutYears)}. ${capitalSummary}`
        : rentBequest
        ? `${partnerName} erhält ab dem Folgejahr lebenslang ${money(rule.monthlyRent)} im Monat als Rente aus dem Erbe, mit der Inflation angepasst. Der Verkaufserlös geht an die anderen Erben. Kapitalwert der Rente ${money(result.residenceCapital)}, Steuer ${money(result.tax)}.`
        : result.mode === 'residence'
        ? `${partnerName} ${residenceEligible ? 'erhält Wohnrecht' : 'erhält bei heutiger Heimpflege kein Wohnrecht'}; die selbst genutzten Immobilien gehen an andere Erben. Geldanteil ${money(result.inherited)}${residenceEligible ? `, Kapitalwert Wohnrecht ${money(result.residenceCapital)}` : ''}, Steuer ${money(result.tax)}.`
        : result.home > 0
        ? `${partnerName} ${homeAndTax ? 'behält die Immobilien' : 'erbt Immobilien'} (${money(result.home)}). ${money(result.tax)} Steuer kommen aus ${taxSource}; ${money(result.leaves)} gehen an andere Erben.`
        : `${partnerName} behält ${money(result.remains)} im Haushalt. ${money(result.leaves)} gehen an andere Erben${result.tax ? `, ${money(result.tax)} fallen als Steuer an` : ''}.`;
    // VB-1: Die Vorschau kennt die Hinterbliebenenrente nicht und rechnet heute auch keinen Zugewinn.
    const rules = `${annual ? 'Jährliche Steuer (§ 23 ErbStG). ' : ''}${taxText}. ${annual ? (rentBequest ? 'Die jährliche Steuer auf die Rente endet mit dem Tod.' : 'Die jährliche Wohnrechtsteuer endet bei Tod oder dauerhafter Heimpflege.') : 'Die Steuer wird aus Tagesgeld und Depot bezahlt.'}${result.housingCapital > 0 ? ' Das Wohnkapital zählt voll zum Erwerb, ohne Familienheim-Befreiung.' : ''}${married ? ' Vorschau ohne Zugewinnausgleich und Versorgungsfreibetrag; der Simulator rechnet beide.' : ''}`;
    const taxCashDetails = result.taxCash !== undefined ? `<details class="ds-technical-details"><summary>Steuergeld aus dem Nachlass ${money(result.taxCash)}</summary><p>Davon ${money(result.taxCashSaleTax)} für Steuern beim Verkauf von Wertpapieren.${result.missingCostBasis ? ' Einstand der Depottranchen fehlt: Vorschau vorsichtig mit Einstand 0.' : ''}</p></details>` : '';
    const annualDetails = annual ? `<details class="ds-technical-details"><summary>${rentBequest ? 'Steuer auf die Rente im Detail' : 'Wohnrechtsteuer im Detail'}</summary><p>Jahreswert ${money(annual.annualValue)} · Steuersatz ${percent(annual.rate * 100)} %${annual.allowanceRemaining > 0 ? ` · verbliebener Freibetrag ${money(annual.allowanceRemaining)}` : ''}.</p></details>` : '';
    const estateNotes = (result.estateCosts > 0 ? `<p class="ds-help">${money(result.estateCosts)} Bestattungs- und Abwicklungskosten gehen vor der Aufteilung ab.</p>` : '')
        + (result.childrenShortfall > 0 ? `<p class="ds-help">${result.childrenMoneyCut > 0 ? `Geldanteil um ${money(result.childrenMoneyCut)} gekürzt. ` : ''}Pflichtteil der Kinder nicht voll gedeckt, es fehlen ${money(result.childrenShortfall)}.</p>`
            : result.childrenMoneyCut > 0 ? `<p class="ds-help">Geldanteil um ${money(result.childrenMoneyCut)} gekürzt, damit die Kinder ihren Pflichtteil bekommen.</p>` : '');
    return `<div class="pv-inheritance-preview-head"><p class="pv-inheritance-summary">${esc(summary)}</p>${infoPopoverHtml(`Erbvorschau beim Tod von ${person.name}`, rules, { handbookAnchor: 'tod-und-erbe' })}</div>${estateNotes}${familyNotice}${annual ? `<p class="ds-help">${esc(annualText)} · bei Wahl ‚sofort‘: ${money(annual.immediateComparison)}</p>` : ''}<div class="pv-inheritance-metrics"><div><span>bleibt im Haushalt</span><strong>${money(result.remains)}</strong></div><div><span>${result.estateCosts > 0 ? 'Geldanteil für andere Erben' : 'verlässt den Haushalt'}</span><strong>${money(result.leaves)}</strong>${homeValue - result.home > .005 ? `<small>${rentBequest ? 'dazu der Erlös aus dem Hausverkauf' : housingCapital && result.housingCapital > 0 ? 'dazu der übrige Erlös aus dem Hausverkauf' : `dazu Immobilien ${money(homeValue - result.home)} an andere Erben`}</small>` : ''}</div><div><span>Erbschaftsteuer${annual || housingCapital && moveOutYears > 0 ? ' im Todesjahr' : ''}</span><strong>${result.tax ? money(result.tax) : '—'}</strong></div></div>${taxCashDetails}${annualDetails}${result.shortfall > 0 ? `<p class="pv-field-error">${money(result.shortfall)} Steuer müssen aus dem Geldvermögen des Partners bezahlt werden.</p>` : ''}`;
}
function paintSummary(doc, state) {
    const summary = doc.getElementById('managerPartnershipSummary');
    if (!summary) return;
    const status = state.draft.status === 'married' ? `Verheiratet oder eingetragene Partnerschaft · ${maritalPropertyLabel(state.draft)}`
        : state.draft.status === 'unmarried' ? 'Nicht verheiratet' : MISSING_PARTNERSHIP_STATUS;
    summary.textContent = `${status} · ${state.people.map((person, index) => `${state.people[1 - index].name} erbt ${inheritsHomeAndTax(state.draft, person.id, hasInheritanceHomes(person.values.immobilien)) ? `Haus + Steuer, dazu ${percent(inheritancePercent(state.draft, person.id))} % vom übrigen Geldvermögen von ${person.name}` : `${percent(inheritancePercent(state.draft, person.id))} % von ${person.name}${hasTestament(state.draft, person.id, hasInheritanceHomes(person.values.immobilien)) ? ' · ' + testamentDescription(testamentRule(state.draft, person.id)) : ''}`}`).join(' · ')}`;
}
function paint(doc) {
    const host = doc.getElementById('managerPartnership'); if (!host) return;
    const state = getState(doc), people = state.people;
    host.hidden = people.length !== 2;
    if (host.hidden || !state.draft) return;
    paintSummary(doc, state);
    const unmarried = state.draft.status === 'unmarried';
    const married = state.draft.status === 'married';
    host.querySelectorAll('[data-partnership]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.partnership === state.draft.status)));
    const body = doc.getElementById('managerInheritance'); body.hidden = false;
    const note = doc.getElementById('managerPartnershipMarried');
    note.hidden = !married; note.textContent = maritalPropertyRegime(state.draft) === 'separation'
        ? 'Kein Zugewinnausgleich (Gütertrennung).' : 'Zugewinnausgleich vereinfacht gerechnet, Zuwachs ab heute.';
    const regimeInfo = doc.getElementById('managerMaritalPropertyInfo');
    if (regimeInfo) regimeInfo.textContent = spouseTaxNote(state.draft);
    const joint = doc.getElementById('managerJointAssessmentField');
    if (joint) joint.hidden = !married;
    host.querySelectorAll('[data-marital-property]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.maritalProperty === maritalPropertyRegime(state.draft))));
    const regime = doc.getElementById('managerMaritalPropertyRegime');
    if (regime) { regime.value = maritalPropertyRegime(state.draft); doc.getElementById('managerMaritalPropertyField').hidden = !married; }
    const total = people.reduce((sum, person) => sum + person.assets, 0);
    // VN-4: Ein Neuaufbau (Auswahl, Häkchen) behält den Fokus auf demselben Bedienelement.
    const focused = body.contains?.(doc.activeElement) ? doc.activeElement : null;
    const focusKey = focused?.id ? `#${focused.id}` : focused?.dataset?.inheritanceHome ? `[data-inheritance-home="${focused.dataset.inheritanceHome}"]` : '';
    body.innerHTML = `<div class="pv-inheritance-grid">${people.map((person, index) => {
        const partner = people[1 - index], homeValue = (person.values.immobilien || []).reduce((sum, home) => sum + home.wert, 0);
        const share = inheritancePercent(state.draft, person.id);
        const homeAndTax = inheritsHomeAndTax(state.draft, person.id, hasInheritanceHomes(person.values.immobilien));
        const homeToggle = unmarried && person.values.immobilien?.length
            ? `<div class="pv-inheritance-share" data-inheritance-toggle><input type="checkbox" hidden data-inheritance-home="${esc(person.id)}"${homeAndTax ? ' checked' : ''}><span id="inheritance-home-tax-${index}-label">${esc(partner.name)} erbt die Immobilien und das Geld für die Erbschaftsteuer</span>${inheritanceToggle(`inheritance-home-tax-${index}`, homeAndTax)}</div>` : '';
        return `<section class="pv-inheritance-person"><header><h3>Wenn ${esc(person.name)} stirbt</h3><span class="ds-help">${esc(person.name)}${/[sxzß]$/i.test(person.name) ? '’' : 's'} Geldvermögen heute ${money(person.assets)} · ${percent(total ? person.assets / total * 100 : 0)} %${homeValue ? `<br>dazu Immobilien ${money(homeValue)}` : ''}</span></header>${homeToggle}<div class="pv-inheritance-share"><label for="inheritance-${index}">${esc(partner.name)} ${homeAndTax ? 'erbt zusätzlich vom übrigen Geldvermögen' : 'erbt vom Geldvermögen'}</label><div class="ds-unit-frame"><input class="ds-input" id="inheritance-${index}" data-inheritance-person="${esc(person.id)}" type="text" inputmode="decimal" value="${percent(share)}"><span>%</span></div></div><small class="pv-field-error" data-inheritance-error="${esc(person.id)}"></small>${testamentFields(person.id, index, testamentRule(state.draft, person.id), homeAndTax)}<div data-inheritance-preview="${esc(person.id)}">${preview(person, share, state.draft, partner)}</div></section>`;
    }).join('')}</div><div class="pv-partnership-notes"><span>Vorschau zu heutigen Werten ${infoPopoverHtml('Vorschau: Erbanteile und vereinfachte Erbschaftsteuer',
        'Die Vorschau zeigt heutige Werte und eine vereinfachte Erbschaftsteuer. Trage Bestattungs- und Abwicklungskosten in Kaufkraft zum Planstart ein. Der Simulator schreibt sie mit der Inflation bis ins Todesjahr fort.', { handbookAnchor: 'tod-und-erbe' })}</span></div>`;
    body.querySelectorAll('[data-testament="minimum"], [data-testament="estateCosts"]').forEach(input => {
        const id = input.closest('[data-testament-person]').dataset.testamentPerson;
        const rule = testamentRule(state.draft, id);
        const value = input.dataset.testament === 'estateCosts' ? rule.estateCosts ?? 0 : rule.minimum;
        input.value = value === undefined ? '' : displayDecimalInput(String(value), input);
    });
    bindInfoPopovers(doc);
    if (focusKey) body.querySelector?.(focusKey)?.focus?.();
}
/** @param doc Dokument mit Partnerschaftsfeldern.
 * @param {ReturnType<typeof import("./tranchen-manager-profiles.js").projectManagerProfiles>} projection
 * @returns {void} */
export function renderManagerPartnership(doc, projection) {
    if (!doc.getElementById('managerPartnership')) return;
    const state = getState(doc);
    state.people = projection.profiles.filter(person => person.valid);
    // Nur vollständige Paarhaushalte zeigen, keine Teilsumme aus drei Personen.
    if (projection.profiles.length !== 2) state.people = [];
    if (state.writing || state.dirty) return;
    try {
        state.raw = persistenceStorage.getItem(PARTNERSHIP_KEY);
        state.draft = readPartnership(state.raw, { forInheritance: true }); paint(doc);
    } catch (error) {
        doc.getElementById('managerPartnership').hidden = false;
        doc.getElementById('managerPartnershipStatus').textContent = error.message;
    }
}
/** @param doc Dokument mit Partnerschaftsfeldern.
 * @param options Vorhandene Navigations-, Schreib- und Sperrhaken.
 * @returns Zustand und Speichersteuerung oder null ohne Formular. */
export function bindManagerPartnership(doc, options = {}) {
    const state = getState(doc); Object.assign(state, options);
    if (!options.fieldsBlocked) state.fieldsBlocked = () => state.blocked();
    const host = doc.getElementById('managerPartnership');
    if (!host) return null;
    if (state.bound) return state;
    state.bound = true;
    doc.getElementById('managerPartnershipToggle')?.addEventListener('click', () => {
        const body = doc.getElementById('managerPartnershipBody'); if (!body) return;
        body.hidden = !body.hidden;
        doc.getElementById('managerPartnershipToggle').setAttribute('aria-expanded', String(!body.hidden));
        doc.getElementById('managerPartnershipAction').textContent = body.hidden ? '▸ zeigen' : '▾ ausblenden';
    });
    const status = text => { doc.getElementById('managerPartnershipStatus').textContent = text; };
    async function save() {
        if (state.writing || !state.dirty || state.invalid || state.blocked()) return;
        const value = readPartnership(state.draft), raw = JSON.stringify(value), expected = state.raw, edits = state.edits || 0;
        state.writing = Promise.resolve().then(() => state.runOperation(async operation => {
            await PersistenceFacade.replaceRecordsTransactional({ [PARTNERSHIP_KEY]: raw }, {
                probelaufDomainWrite: true, allowKey: key => key === PARTNERSHIP_KEY,
                expectedRecords: expected === null ? {} : { [PARTNERSHIP_KEY]: expected },
                navigationOperation: operation,
                postValidate: records => { readPartnership(records[PARTNERSHIP_KEY]); return true; }
            });
        }));
        state.saveFailed = false; status('Wird gespeichert …'); state.syncBlocked(state.blocked(), state.fieldsBlocked()); state.notify();
        // VN-3: Eingaben während des Speicherns bleiben offen und speichern beim nächsten Verlassen des Felds.
        try { await state.writing; state.raw = raw; state.dirty = (state.edits || 0) !== edits; status(state.dirty ? 'Wird beim Verlassen des Feldes gespeichert' : 'Gespeichert'); }
        catch (error) {
            state.saveFailed = true;
            if (error.code === 'rollback_failed') PersistenceFacade.blockSyncWrites?.([PARTNERSHIP_KEY], 'Partnerschaft und Rücknahme unbestätigt. Bitte neu laden und die Sicherung prüfen.');
            status(`Nicht gespeichert: ${error.message} Bitte erneut versuchen.`);
        }
        finally { state.writing = null; state.notify(); state.syncBlocked(state.blocked(), state.fieldsBlocked()); }
    }
    host.addEventListener('click', event => {
        const toggleButton = event.target.closest('[data-inheritance-toggle-value]');
        if (toggleButton?.dataset?.inheritanceToggleValue !== undefined) {
            const field = toggleButton.closest('[data-inheritance-toggle]').querySelector('input');
            const value = toggleButton.dataset.inheritanceToggleValue === 'true';
            if (!field.disabled && !state.blocked() && !state.writing && field.checked !== value) {
                field.checked = value;
                field.dispatchEvent(new (doc.defaultView?.Event || Event)('change', { bubbles: true }));
            }
            return;
        }
        const button = event.target.closest('[data-partnership]');
        if (button && !state.blocked() && !state.writing) {
            state.draft.status = button.dataset.partnership; state.dirty = true; state.invalid = false; paint(doc); state.notify(); void save();
        }
        const regimeButton = event.target.closest('[data-marital-property]');
        if (regimeButton && !regimeButton.disabled && !state.blocked() && !state.writing) {
            const regime = doc.getElementById('managerMaritalPropertyRegime');
            regime.value = regimeButton.dataset.maritalProperty;
            regime.dispatchEvent(new (doc.defaultView?.Event || Event)('change', { bubbles: true }));
        }
        if (event.target.closest('#managerPartnershipRetry')) void save();
    });
    host.addEventListener('change', event => {
        if (event.target.id === 'managerMaritalPropertyRegime' && !state.writing && !state.blocked()) {
            state.draft.maritalPropertyRegime = event.target.value; state.dirty = true;
            paint(doc); state.notify(); void save(); return;
        }
        const testamentInput = event.target.closest('[data-testament]');
        // VN-4 (ABS1 P1/P2): Das Verlassen eines Textfelds baut nichts neu – sonst verschwindet das Feld, das gerade den Fokus bekommt.
        // Die Eingabe steht schon im Entwurf (input); nur ein zurückgehaltener Wert wird nachgetragen, „mindestens“ formatiert sich am Ort.
        // Gespeichert wird beim Verlassen (focusout). Auswahlfelder ändern die Felder (Steuer auf das Wohnrecht) und bauen neu auf.
        if (testamentInput?.dataset?.testament && testamentInput.tagName !== 'SELECT' && testamentInput.type !== 'checkbox') {
            if (applied.get(testamentInput) !== testamentInput.value && !state.fieldsBlocked()) updateTestament(testamentInput);
            if (testamentInput.dataset.testament === 'minimum' && testamentInput.getAttribute?.('aria-invalid') !== 'true') {
                const minimum = testamentRule(state.draft, testamentInput.closest('[data-testament-person]').dataset.testamentPerson).minimum;
                if (minimum !== undefined) applied.set(testamentInput, testamentInput.value = displayDecimalInput(String(minimum), testamentInput));
            }
            return;
        }
        if (testamentInput?.dataset?.testament && !state.writing && !state.blocked()) {
            if (testamentInput.dataset.testament === 'home') {
                const section = testamentInput.closest('[data-testament-person]');
                const fields = section.querySelector('[data-testament-home-fields]');
                fields.innerHTML = testamentHomeFields(fields.dataset.testamentHomeFields,
                    { ...testamentRule(state.draft, section.dataset.testamentPerson), home: testamentInput.value });
                bindInfoPopovers(doc);
            }
            updateTestament(testamentInput);
            if (!state.invalid) { paint(doc); void save(); }
            return;
        }
        const input = event.target.closest('[data-inheritance-home]');
        if (!input || state.writing || state.blocked()) return;
        (state.draft.homeAndTaxInheritance ||= {})[input.dataset.inheritanceHome] = input.checked;
        (state.draft.activeInheritanceRule ||= {})[input.dataset.inheritanceHome] = input.checked ? 'home-and-tax' : 'testament';
        state.dirty = true; state.invalid = false; paint(doc); state.notify(); void save();
    });
    host.addEventListener('input', event => {
        if (event.target.dataset?.testament !== 'minimum') return;
        const stand = event.target.closest('[data-testament-person]').querySelector('[data-testament="minimumStand"]');
        stand.disabled = event.target.value.trim() === ''; stand.closest('.pv-inheritance-share').hidden = stand.disabled;
    });
    const applied = new WeakMap();
    function updateTestament(input) {
        applied.set(input, input.value);
        const section = input.closest('[data-testament-person]'), id = section.dataset.testamentPerson;
        const person = state.people.find(person => person.id === id);
        try {
            const rule = readTestamentFields(section, testamentRule(state.draft, id));
            const draft = { ...state.draft, testament: { ...state.draft.testament, [id]: rule } };
            // Ohne Immobilien bleiben die Felder wirksam; die vorgemerkte Immobilienwahl gilt wieder, sobald ein Objekt hinzukommt.
            // FR-96: Kosten und Pflichtteil sind auch bei Immobilien und Steuergeld bedienbar und lassen diese Wahl bestehen.
            const keepHomeChoice = inheritsHomeAndTax(state.draft, id);
            draft.activeInheritanceRule = { ...draft.activeInheritanceRule, [id]: keepHomeChoice ? 'home-and-tax' : 'testament' };
            state.draft = readPartnership(draft);
            const partner = state.people.find(person => person.id !== id);
            const homeChoice = host.querySelector(`[data-inheritance-home="${id}"]`);
            if (homeChoice) homeChoice.checked = inheritsHomeAndTax(state.draft, id, hasInheritanceHomes(person.values.immobilien));
            const shareLabel = host.querySelector(`[data-inheritance-person="${id}"]`)?.closest('.pv-inheritance-share')?.querySelector('label');
            if (shareLabel) shareLabel.textContent = `${partner.name} ${inheritsHomeAndTax(state.draft, id, hasInheritanceHomes(person.values.immobilien)) ? 'erbt zusätzlich vom übrigen Geldvermögen' : 'erbt vom Geldvermögen'}`;
            section.querySelectorAll('[data-testament]').forEach(node => node.setAttribute('aria-invalid', 'false'));
            section.querySelector('[data-testament-error]').textContent = '';
            host.querySelector(`[data-inheritance-preview="${id}"]`).innerHTML = preview(person, inheritancePercent(state.draft, id), state.draft, partner);
            bindInfoPopovers(doc); paintSummary(doc, state);
        } catch (error) {
            const homeField = { [MISSING_BEQUEST_RENT]: 'monthlyRent', [MISSING_SURVIVOR_RENT]: 'monthlyRent', [MISSING_HOUSING_CAPITAL]: 'housingCapitalPercent',
                [INVALID_MOVE_OUT_YEARS]: 'moveOutYears' }[error.message];
            // ER-2: Bei zwei Pflichtfeldern ist nur das Feld markiert, das die Meldung nennt.
            if (homeField) section.querySelectorAll('[data-testament-home-fields] [data-testament]').forEach(node => node.setAttribute('aria-invalid', 'false'));
            const field = homeField ? section.querySelector(`[data-testament="${homeField}"]`) : input;
            field?.setAttribute('aria-invalid', 'true');
            section.querySelector('[data-testament-error]').textContent = error.message;
        }
        state.dirty = true; state.edits = (state.edits || 0) + 1; state.invalid = Boolean(host.querySelector('[aria-invalid="true"]')); state.saveFailed = false;
        status(state.invalid ? 'Bitte die markierten Testamentangaben prüfen.' : 'Wird beim Verlassen des Feldes gespeichert');
        state.syncBlocked(state.blocked(), state.fieldsBlocked()); state.notify();
    }
    host.addEventListener('input', event => {
        const testamentInput = event.target.closest('[data-testament]');
        // VN-3 (Gemini Befund 5): Textfelder bleiben während eines Autosaves bedienbar; die Eingabe geht in den Entwurf.
        if (testamentInput?.dataset?.testament) {
            if (testamentInput.dataset.testament !== 'home' && testamentInput.type !== 'checkbox' && !state.fieldsBlocked()) updateTestament(testamentInput);
            return;
        }
        const input = event.target.closest('[data-inheritance-person]'); if (!input || state.fieldsBlocked()) return;
        const id = input.dataset.inheritancePerson, raw = input.value.trim(), value = readDecimalInput(raw, input);
        const valid = raw !== '' && Number.isFinite(value) && value >= 0 && value <= 100;
        input.setAttribute('aria-invalid', String(!valid));
        host.querySelector(`[data-inheritance-error="${id}"]`).textContent = valid ? '' : 'Bitte 0 bis 100 Prozent eingeben.';
        state.invalid = Boolean(host.querySelector('[aria-invalid="true"]')); state.dirty = true; state.edits = (state.edits || 0) + 1;
        if (valid) { const key = state.draft.status === 'married' ? 'marriedInheritance' : 'inheritance'; (state.draft[key] ||= {})[id] = value; host.querySelector(`[data-inheritance-preview="${id}"]`).innerHTML = preview(state.people.find(person => person.id === id), value, state.draft, state.people.find(person => person.id !== id)); bindInfoPopovers(doc); paintSummary(doc, state); }
        state.saveFailed = false;
        status(valid ? 'Wird beim Verlassen des Feldes gespeichert' : 'Bitte den markierten Anteil prüfen.'); state.syncBlocked(state.blocked(), state.fieldsBlocked()); state.notify();
    });
    host.addEventListener('focusout', event => { if (event.target.matches('[data-inheritance-person], [data-testament]')) void save(); });
    host.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches('[data-inheritance-person], [data-testament]')) { event.preventDefault(); void save(); } });
    state.read = () => ({ dirty: Boolean(state.dirty), writing: Boolean(state.writing), draft: state.draft });
    state.flush = async () => { if (state.writing) { try { await state.writing; } catch { /* Der Editor erhält Entwurf und Fehlermeldung. */ } } else await save(); return !state.dirty; };
    // VN-3 (Gemini Befund 5): Während eines Autosaves (auch des eigenen) bleiben die Textfelder bedienbar – das Feld in Bearbeitung und
    // das Ziel eines Tab-Wechsels. Knöpfe, Auswahl und Häkchen speichern sofort und bleiben deshalb gesperrt, solange gespeichert wird.
    state.syncBlocked = (blocked, fieldsBlocked = blocked) => {
        host.querySelectorAll('[data-partnership], [data-marital-property], [data-inheritance-person], [data-inheritance-home], [data-testament], #managerMaritalPropertyRegime, #managerPartnershipRetry').forEach(input => {
            const text = input.matches('[data-inheritance-person], [data-testament]') && input.type !== 'checkbox';
            input.disabled = (text ? fieldsBlocked : blocked || Boolean(state.writing)) && input !== doc.activeElement
                || (input.dataset?.testament === 'minimumStand' && testamentRule(state.draft, input.closest('[data-testament-person]').dataset.testamentPerson).minimum === undefined);
        });
        host.querySelectorAll('[data-inheritance-toggle-value]').forEach(button => {
            const field = button.closest('[data-inheritance-toggle]').querySelector('input');
            button.disabled = field.disabled;
            button.setAttribute('aria-pressed', String(field.checked === (button.dataset.inheritanceToggleValue === 'true')));
        });
        doc.getElementById('managerPartnershipRetry').hidden = !state.saveFailed || !state.dirty || Boolean(state.invalid);
    };
    // VN-3: Nach dem Ende einer Sperre speichert ein offener Entwurf, sobald kein Textfeld der Partnerschaft mehr in Bearbeitung ist.
    state.resume = () => { if (state.dirty && !state.writing && !state.invalid && !doc.activeElement?.matches?.('#managerPartnership [data-inheritance-person], #managerPartnership [data-testament]')) void save(); };
    state.discard = () => { if (state.writing) return; state.dirty = false; state.invalid = false; state.saveFailed = false; state.draft = readPartnership(state.raw, { forInheritance: true }); paint(doc); state.syncBlocked(state.blocked(), state.fieldsBlocked()); };
    return state;
}
