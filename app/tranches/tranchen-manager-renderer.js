import { appNow } from '../shared/app-clock.js';
import { householdPlanComparisonHtml } from '../profile/household-plan-comparison.js';
import { bindInfoPopovers, createInfoPopover } from '../shared/designsystem-info-popover.js';

export function renderManagerPlanComparison(doc, view) {
    const host = doc.getElementById('managerPlanComparison');
    if (host) {
        host.innerHTML = householdPlanComparisonHtml(view);
        bindInfoPopovers(doc, { root: host });
    }
}
import { buildHistoryRecoveryHtml, buildPersonHistoryHtml, buildPersonHistoryDetailsHtml, projectTrancheHistory, buildTrancheHistorySummary, buildTrancheHistoryDetail, bindTrancheHistoryChart } from './tranchen-history-ui.js';
// @ts-check

import { formatDisplayNumber, formatDisplayDate } from '../shared/designsystem-number-format.js';
import { escapeHtml } from '../shared/security-utils.js';
import { STARTUP_PRICE_SESSION_KEY } from './tranchen-startup-prices.js';
import { householdPlanSummary } from '../shared/household-plan-presentation.js';

export function renderManagerPlanSummary(doc, values) {
    const host = doc.getElementById('managerPlanMoreSummary');
    if (!host) return;
    host.textContent = householdPlanSummary(values);
}

export function buildManagerHistoryStartHtml(projection, single) {
    return `<form id="managerHistoryStartForm" data-history-start-form class="pv-history-start"><label for="managerHistoryStart">Verlauf ab …</label>
        <input id="managerHistoryStart" data-history-start-input class="ds-input" type="date" required max="${projection.historyContext?.today || ''}" value="${projection.historyContext?.startDate || ''}">
        <button type="submit" id="managerHistoryStartConfirm" class="ds-button ds-button-secondary">Beginn bestätigen</button>
        <small>${single ? 'Für dieses Profil' : 'Für den gesamten Haushalt'}. Fehlende Kurse werden beim nächsten Start nachgeladen.</small></form><p id="managerHistoryStartStatus" class="history-note" role="status" aria-live="polite"></p>`;
}

function renderManagerAvatar(profile, small = false) {
    const initials = String(profile.name).trim().split(/\s+/u).map(part => Array.from(part)[0]).slice(0, 2).join('').toLocaleUpperCase('de-DE');
    return `<span class="pv-avatar ${small ? 'pv-avatar-small' : ''}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

function renderManagerPersonMenu(profile) {
    return `<button type="button" class="ds-button ds-icon-button pv-person-menu" data-manager-people="${escapeHtml(profile.id)}" aria-label="Person ${escapeHtml(profile.name)} verwalten" aria-haspopup="dialog" aria-controls="managerPeopleModal">…</button>`;
}

function incomeStageText(step) {
    return `ab ${step.month.slice(5)}/${step.month.slice(0, 4)}: ${formatMoney(step.income)} €`;
}

function renderManagerIncomeSteps(steps) {
    if (!steps.length) return '';
    return `<div id="managerIncomeSteps">${steps.slice(0, 2).map(step => `<p>${escapeHtml(incomeStageText(step))}</p>`).join('')}</div>`;
}

function renderManagerIncomeHelp(steps) {
    if (steps.length <= 2) return '';
    return `<span class="ds-info"><button type="button" id="managerIncomeHelpToggle" class="ds-button ds-info-button" aria-label="Weitere Einkommensänderungen" aria-describedby="managerIncomeHelp">ⓘ</button><span id="managerIncomeHelp" class="ds-info-pop" role="tooltip">weitere Änderungen: ${escapeHtml(steps.slice(2).map(incomeStageText).join(' · '))}</span></span>`;
}

// Dokumentlokale Ansicht, unabhängig vom bearbeiteten Profil; keine Speicherpräferenz.
const managerViews = new WeakMap();
export function getManagerView(doc) { return managerViews.get(doc); }
export function renderManagerView(doc, view = getManagerView(doc)) {
    if (!view) return;
    managerViews.set(doc, view);
    const addPerson = doc.getElementById('managePeopleBtn');
    if (addPerson) addPerson.hidden = view.kind === 'history';
    const tabs = Array.from(doc.getElementById('managerSectionNav')?.querySelectorAll?.('[role="tab"]') || []);
    for (const tab of tabs) {
        const selected = view.kind !== 'person' ? tab.dataset.managerView === view.kind
            : tab.dataset.managerProfile === view.profileId;
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('tabindex', selected ? '0' : '-1');
    }
    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
    for (const [id, kind] of [['managerPlanPanel', 'plan'], ['managerPersonPanel', 'person'], ['managerHistoryPanel', 'history']]) {
        const panel = doc.getElementById(id);
        if (!panel) continue;
        panel.hidden = view.kind !== kind;
        panel.inert = panel.hidden;
        if (kind === 'person' && selected && view.kind === kind) panel.setAttribute('aria-labelledby', selected.id);
    }
}

export function renderManagerProfiles(doc, projection) {
    const ordered = [...projection.profiles.filter(profile => profile.belongs), ...projection.profiles.filter(profile => !profile.belongs)];
    const active = projection.profiles.find(profile => profile.active);
    const view = getManagerView(doc) || { kind: 'person', profileId: active?.id };
    const nav = doc.getElementById('managerSectionNav');
    const focused = doc.activeElement;
    const focusedTab = focused?.getAttribute?.('role') === 'tab' ? focused.id : null;
    const focusedProfile = focused?.dataset?.managerProfile;
    if (nav) {
        const planName = ordered.some(profile => profile.belongs) ? 'Haushalt & Plan' : `Plan · ${active?.name || ordered[0]?.name || ''}`;
        const tab = (id, label, attributes, selected, panel, avatar = '') => `<button type="button" id="${escapeHtml(id)}" role="tab" class="ds-button pv-tab" ${attributes} aria-selected="${selected}" tabindex="${selected ? 0 : -1}" aria-controls="${panel}">${avatar}<span>${escapeHtml(label)}</span></button>`;
        const html = tab('managerPlanTab', planName, 'data-manager-view="plan"', view.kind === 'plan', 'managerPlanPanel')
            + ordered.map((profile, index) => tab(`managerPersonTab-${index + 1}`, profile.name, `data-manager-profile="${escapeHtml(profile.id)}"`, view.kind === 'person' && view.profileId === profile.id, 'managerPersonPanel', renderManagerAvatar(profile, true))).join('')
            + tab('managerHistoryTab', 'Verlauf', 'data-manager-view="history"', view.kind === 'history', 'managerHistoryPanel', '<svg class="pv-avatar-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 17l6-6 4 3 8-9"/></svg>');
        if (nav.innerHTML !== html) nav.innerHTML = html;
    }
    const historySwitch = doc.getElementById('managerHistorySwitch');
    if (historySwitch) {
        const choice = (label, profileId = null) => `<button type="button" class="ds-button ds-button-secondary" data-manager-view="history" ${profileId ? `data-manager-profile="${escapeHtml(profileId)}"` : ''} data-manager-history-scope="${profileId ? 'person' : 'household'}" aria-pressed="${view.kind === 'history' && (profileId ? view.historyScope === 'person' && view.profileId === profileId : view.historyScope !== 'person')}">${escapeHtml(label)}</button>`;
        const html = choice('Haushalt') + ordered.map(profile => choice(profile.name, profile.id)).join('');
        if (historySwitch.innerHTML !== html) historySwitch.innerHTML = html;
    }
    const historyLink = (profileId = null) => `<a class="ds-text-link" href="#verlauf" data-manager-view="history" ${profileId ? `data-manager-history-profile="${escapeHtml(profileId)}"` : ''} data-manager-history-scope="${profileId ? 'person' : 'household'}">Zum Verlauf →</a>`;
    const money = value => `${formatMoney(value)} €`;
    const allocationNames = { aktien_alt: 'Aktien · Altbestand', aktien_neu: 'Aktien · Neubestand',
        anleihe: 'Anleihen', geldmarkt: 'Geldmarkt-ETF', gold: 'Gold-ETC', cash: 'Tagesgeld' };
    const allocationBar = (profile, legend = true) => {
        if (!profile.assets) return '';
        const parts = Object.entries(profile.allocation).filter(([, value]) => value > 0);
        const label = parts.map(([kind, value]) => `${allocationNames[kind]} ${formatDisplayNumber(value / profile.assets * 100, { fractionDigits: 0 })} %`).join(' · ');
        return `<div class="pv-asset-bar" role="img" aria-label="${escapeHtml(label)}">${parts.map(([kind, value]) =>
            `<span class="pv-asset-${kind}" style="flex-grow:${value / profile.assets}"></span>`).join('')}</div>
            ${legend ? `<ul class="pv-legend">${parts.map(([kind, value]) => `<li><i class="pv-asset-${kind}" aria-hidden="true"></i>${allocationNames[kind]} ${formatDisplayNumber(value / profile.assets * 100, { fractionDigits: 0 })} %</li>`).join('')}</ul>` : ''}`;
    };
    const single = projection.profiles.length === 1;
    const title = doc.getElementById('managerPageTitle');
    if (title) title.textContent = 'Personen & Vermögen';
    const person = projection.profiles[0];
    const sum = single && person.valid ? { ...person, incomeWarnings: person.currentIncome.missing ? ['Rentenbeginn fehlt'] : [], careTarget: person.careTarget || 0 } : projection.household;
    const stages = sum?.incomeSteps || [];
    const upcoming = renderManagerIncomeSteps(stages);
    const help = renderManagerIncomeHelp(stages);
    const warnings = (sum?.incomeWarnings || []).map(warning => `<p>${escapeHtml(warning)}</p>`).join('');
    const history = (value, title, infoId) => buildPersonHistoryHtml(value, title, projection.historyContext, infoId, { compact: true });
    const details = (key, body) => `<details class="pv-wealth-details" data-wealth-details="${escapeHtml(key)}"><summary><span class="pv-disclosure-action"><span>▸ Details zeigen</span><span>▾ Details ausblenden</span></span></summary><div class="pv-wealth-details-body">${body}</div></details>`;
    const gain = profile => `<p class="pv-book-gain"><span class="${profile.gain === 0 ? '' : profile.gain > 0 ? 'positive' : 'negative'}">${formatSignedMoney(profile.gain)} €</span> Buchgewinn auf ${money(profile.cost)} Einstand</p>`;
    const householdTitle = single ? `Vermögensverlauf ${person.name}` : 'Vermögensverlauf Haushalt';
    const startForm = buildManagerHistoryStartHtml(projection, single);
    const householdDetails = `${sum ? `${gain(sum)}<p>Pflegereserve-Ziel ${money(sum.careTarget)}</p>
        <div class="pv-income"><div><span>Einkommen im Monat, netto</span><strong>${money(sum.income)}</strong></div>
        <p>Renten und sonstige Einkünfte ${single ? 'der Person' : 'der Haushaltspersonen'} heute; künftige Renten ab ihrem Beginn.</p>${upcoming}${help}${warnings}</div>` : ''}
        ${buildPersonHistoryDetailsHtml(projection.householdHistory, householdTitle, 'managerHouseholdHistoryInfo')}
        ${startForm}${historyLink()}`;
    const total = sum ? `<div class="pv-hero-number">${formatMoney(sum.assets)}<span>€</span></div>
        ${history(projection.householdHistory, householdTitle, 'managerHouseholdHistoryInfo')}
        ${allocationBar(sum)}` : '<p>Haushaltssumme nicht verfügbar: keine Auswahl oder unvollständige Profildaten.</p>';
    const profileButton = profile => `<a class="ds-text-link" href="#personendaten" data-manager-profile="${escapeHtml(profile.id)}">Zur Person →</a>`;
    const cards = projection.profiles.map((profile, index) => {
        const historyTitle = `Vermögensverlauf ${profile.name}`, infoId = `managerPersonHistoryInfo-${index + 1}`;
        const recovery = profile.active ? buildHistoryRecoveryHtml(profile.historyRecovery) + '<p id="managerHistoryRecoveryStatus" role="status" tabindex="-1"></p>' : '';
        const personDetails = profile.valid ? `${allocationBar(profile)}
            <dl class="pv-allocation-values">${Object.entries(profile.allocation).map(([kind, value]) => `<div><dt>${allocationNames[kind]}</dt><dd>${money(value)}</dd></div>`).join('')}</dl>
            ${gain(profile)}<p>Pflegereserve-Ziel ${money(profile.careTarget || 0)}</p>
            <dl><div><dt>Sonstige Einkünfte im Monat</dt><dd>${money(profile.values.sonstigeEinkuenfte)}</dd></div><div><dt>Einkommen im Monat, netto</dt><dd>${money(profile.income)}</dd></div></dl>
            <p>${escapeHtml(profile.currentIncome.pensionStatus || profile.currentIncome.status)}</p>
            ${buildPersonHistoryDetailsHtml(profile.history, historyTitle, infoId)}${historyLink(profile.id)}
            <footer><p>${profile.count} Tranchen</p>${renderManagerPersonMenu(profile)}</footer>` : `<footer><p>Profildaten unvollständig; keine Vermögenssumme.</p>${renderManagerPersonMenu(profile)}</footer>`;
        return `<section class="ds-card pv-person-card" aria-label="${escapeHtml(profile.name)}">
            <header><div class="pv-person-identity">${renderManagerAvatar(profile)}<div><h3>${escapeHtml(profile.name)}</h3>
            <p>${profile.valid ? `${escapeHtml(profile.personDates?.identity || 'Geburtsdatum fehlt oder ist ungültig')} · ` : ''}${escapeHtml(profile.householdRole || 'Haushaltsprofil')}</p></div></div>${profileButton(profile)}</header>
            ${profile.valid ? `<dl class="pv-person-wealth"><div><dt>Vermögen</dt><dd>${money(profile.assets)}</dd></div></dl>
            ${history(profile.history, historyTitle, infoId)}
            <dl class="pv-person-income"><div><dt>Rente netto</dt><dd>${money(profile.values.renteMonatlich)} <small>/Monat</small></dd><small>${escapeHtml(profile.currentIncome.status)}</small></div>
            <div><dt>Tagesgeld</dt><dd>${money(profile.values.tagesgeld)}</dd></div></dl>` : ''}
            ${details(profile.id, personDetails)}${recovery}
        </section>`;
    }).join('');
    const household = doc.getElementById('managerHousehold');
    if (household) {
        const householdHtml = `<section class="ds-card pv-household-card"><div class="pv-household-heading"><h2>${single ? 'Dein Vermögen' : 'Euer Vermögen · Haushalt'}</h2>
        <span class="ds-info"><button type="button" class="ds-button ds-info-button" aria-label="Erläuterung zum Vermögen" aria-describedby="managerHouseholdHelp">i</button><span id="managerHouseholdHelp" class="ds-info-pop" role="tooltip">Marktwert aller Tranchen plus Tagesgeld. Die Pflegereserve ist ein Liquiditätsziel und wird nicht zusätzlich gezählt.</span></span></div>${total}${details('household', householdDetails)}</section>${cards}`;
        household.classList?.[single ? 'add' : 'remove']('pv-single-profile');
        let displayedHtml = householdHtml;
        if (single) { displayedHtml = householdHtml.replace('pv-household-card', 'pv-individual-card'); }
        // Laufende Projektionen lassen gerade geöffnete Details offen; Reload startet zu.
        if (household.innerHTML !== displayedHtml) {
            const opened = new Set(Array.from(household.querySelectorAll?.('[data-wealth-details][open]') || []).map(el => el.dataset.wealthDetails));
            household.innerHTML = displayedHtml;
            for (const el of household.querySelectorAll?.('[data-wealth-details]') || []) el.open = opened.has(el.dataset.wealthDetails);
        }
    }
    renderManagerPersonData(doc, projection.profiles.find(profile => profile.active));
    renderManagerView(doc, view);
    if (focusedTab) {
        const replacement = focusedProfile ? Array.from(nav?.querySelectorAll?.('[data-manager-profile]') || []).find(tab => tab.dataset.managerProfile === focusedProfile) : doc.getElementById(focusedTab);
        if (replacement) {
            Array.from(nav?.querySelectorAll?.('[role="tab"]') || []).forEach(tab => tab.setAttribute('tabindex', tab === replacement ? '0' : '-1'));
            replacement.focus?.();
        }
    } else if (focusedProfile && focused?.isConnected === false) {
        Array.from(doc.getElementById('managerHousehold')?.querySelectorAll?.('[data-manager-profile]') || []).find(button => button.dataset.managerProfile === focusedProfile)?.focus?.();
    }

}

function formatMoney(value) {
    return formatDisplayNumber(value, { fractionDigits: 0 });
}

function formatSignedMoney(value) {
    const number = Number(value) || 0;
    if (number < 0) return `-${formatMoney(Math.abs(number))}`;
    if (number > 0) return `+${formatMoney(number)}`;
    return formatMoney(0);
}

function formatSignedPercent(value) {
    const number = Number(value) || 0;
    if (number < 0) return `-${formatDisplayNumber(Math.abs(number), { unit: 'percent', fractionDigits: 1 })}`;
    if (number > 0) return `+${formatDisplayNumber(number, { unit: 'percent', fractionDigits: 1 })}`;
    return '0,0\u00a0%';
}

const CLASSIFICATION_LABELS = Object.freeze({
    aktien_alt: { category: 'Aktien', type: 'Altbestand', className: 'badge-alt' },
    aktien_neu: { category: 'Aktien', type: 'Neubestand', className: 'badge-neu' },
    anleihe: { category: 'Anleihen', type: 'Anleihe', className: 'badge-geldmarkt' },
    geldmarkt: { category: 'Geldmarkt', type: 'Geldmarkt-ETF', className: 'badge-geldmarkt' },
    gold: { category: 'Gold', type: 'Gold-ETC', className: 'badge-gold' }
});

// asOf ist UTC-Unixzeit in Sekunden, niemals Kaufdatum oder Abrufzeit.
function quoteDate(tranche) {
    const seconds = tranche.asOf;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0) return null;
    const date = new Date(seconds * 1000);
    return Number.isFinite(date.getTime()) ? date : null;
}

function formatQuoteDate(value, short = false) {
    return new Intl.DateTimeFormat('de-DE', { ...(short ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit' }).format(value);
}

function quoteSummary(tranchen) {
    if (!tranchen.length) return 'Keine Kurse vorhanden';
    const dates = tranchen.map(quoteDate);
    const known = tranchen.filter(t => quoteDate(t)).sort((a, b) => a.asOf - b.asOf).map(quoteDate);
    if (!known.length) return 'Kursdatum unbekannt';
    const range = formatQuoteDate(known[0]) === formatQuoteDate(known[known.length - 1])
        ? formatQuoteDate(known[0])
        : `${formatQuoteDate(known[0])} – ${formatQuoteDate(known[known.length - 1])}`;
    return known.length !== dates.length ? `Teilweise unbekannt · ${range}`
        : new Set(tranchen.map(t => t.asOf)).size > 1 ? `Gemischte Kursstände · ${range}` : range;
}

export function renderManagerQuoteContext(doc, tranchen) {
    const context = doc.getElementById('suiteContext');
    if (!context) return;
    let host = doc.getElementById('managerQuoteContext');
    if (!host) {
        host = doc.createElement('span'); host.id = 'managerQuoteContext';
        host.className = 'pv-context-pill pv-quote-context'; context.appendChild(host);
    }
    const stale = tranchen.some(t => Number.isInteger(t.asOf) && appNow().getTime() / 1000 - t.asOf > 7 * 86400);
    const uniform = tranchen.length > 0 && tranchen.every(t => quoteDate(t) && t.asOf === tranchen[0].asOf);
    let automatic = false;
    try {
        const session = doc.defaultView?.sessionStorage || globalThis.window?.sessionStorage;
        const report = JSON.parse(session?.getItem(STARTUP_PRICE_SESSION_KEY) || 'null');
        const profileId = doc.getElementById('suiteProfileContext')?.dataset?.profileId;
        automatic = uniform && !stale && report?.status === 'complete' && report.updated > 0
            && Array.isArray(report.results) && Boolean(profileId) && tranchen.every(t => t.trancheId && report.results.some(result =>
                result.profileId === profileId && result.trancheId === t.trancheId
                && result.status === 'updated' && result.asOf === t.asOf));
    } catch { /* Fehlender oder nicht lesbarer Bericht belegt keinen automatischen Abruf. */ }
    const date = uniform ? new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(tranchen[0].asOf * 1000)) : quoteSummary(tranchen);
    host.textContent = `Kurse: ${uniform ? 'Stand ' : ''}${date}` + (stale ? ' · ältere Kurse' : '');
    const details = doc.getElementById('managerQuoteDetails');
    if (details) details.textContent = `${uniform ? 'Kurse vom' : 'Gespeicherter Kursstand:'} ${date}`
        + (automatic ? ' · automatisch beim Öffnen' : '')
        + (!automatic && uniform && !stale ? ' · gespeicherter Kursstand' : '')
        + (stale ? ' · ältere Kurse; manuell aktualisieren' : '')
        + '. Kursdatum aus gespeichertem asOf; Abrufzeit ist kein Kursdatum.';
    if (host.dataset) host.dataset.automatic = automatic ? 'true' : 'false';
    host.title = 'Kursdatum aus gespeichertem asOf; Abrufzeit ist kein Kursdatum.';
}

export function buildTranchenStatsHtml(tranchen, { automatic = false } = {}) {
    const totalValue = tranchen.reduce((sum, t) => sum + (Number(t.marketValue) || 0), 0);
    const totalCost = tranchen.reduce((sum, t) => sum + (Number(t.costBasis) || 0), 0);
    const totalGain = totalValue - totalCost;
    const gainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const metrics = [
        ['Gesamtwert der Tranchen (ohne Tagesgeld)', `${formatMoney(totalValue)}\u00a0€`],
        ['Einstandswert', `${formatMoney(totalCost)}\u00a0€`],
        ['Buchgewinn des Bestands', `${formatSignedMoney(totalGain)}\u00a0€`],
        ['Gewinn relativ', formatSignedPercent(gainPct)]
    ];
    return `${metrics.map(([label, value], index) => `<div class="stat-card ds-card ds-metric">
            <div class="stat-label ds-metric-label">${label}</div>
            <div class="stat-value ds-metric-value${index >= 2 && totalGain !== 0 ? totalGain > 0 ? ' positive' : ' negative' : ''}">${value}</div></div>`).join('')}
        <div class="stat-card ds-card ds-metric pv-quote-summary">
            <div class="stat-label ds-metric-label">Kurse</div>
            <div class="stat-value ds-metric-value">${quoteSummary(tranchen)}</div>
            ${automatic && quoteDate(tranchen[0]) ? `<small>automatisch beim Öffnen, ${new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(quoteDate(tranchen[0]))}</small>` : ''}
        </div>`;
}

export function buildEmptyTranchenHtml() {
    return `<div class="empty-state ds-note">
        <h3>Keine Tranchen vorhanden</h3>
        <p>Mit „Kauf eintragen“ erfassen Sie Ihre erste Tranche. Tagesgeld bleibt separat.</p>
    </div>`;
}

const DEPOT_GROUPS = Object.freeze([
    { key: 'equity', label: 'Aktien / ETFs', types: ['aktien_alt', 'aktien_neu'] },
    { key: 'money_market', label: 'Geldmarkt', types: ['geldmarkt'] },
    { key: 'gold', label: 'Gold', types: ['gold'] },
    { key: 'bonds', label: 'Anleihen', types: ['anleihe'] },
    { key: 'unknown', label: 'Unbekannte Anlageform', types: [] }
]);

export function buildTranchenTableHtml(tranchen, { context = null, profileId = null, expandedId = null, onDetail = () => {} } = {}) {
    if (!tranchen.length) return buildEmptyTranchenHtml();
    const groups = DEPOT_GROUPS.map(group => ({ ...group, items: [] }));
    tranchen.forEach((tranche, index) => {
        const group = groups.find(candidate => candidate.types.includes(tranche.type)) || groups[groups.length - 1];
        group.items.push({ tranche, index });
    });
    const sortDate = t => {
        const time = Date.parse(t.purchaseDate || '1900-01-01');
        return Number.isFinite(time) ? time : Date.parse('1900-01-01');
    };
    const rows = groups.filter(group => group.items.length).map(group => {
        group.items.sort((a, b) => sortDate(a.tranche) - sortDate(b.tranche) || a.index - b.index);
        const value = group.items.reduce((sum, { tranche }) => sum + (Number(tranche.marketValue) || 0), 0);
        const cost = group.items.reduce((sum, { tranche }) => sum + (Number(tranche.costBasis) || 0), 0);
        const groupRow = `<tr class="pv-depot-group" data-depot-group="${group.key}">
            <th scope="rowgroup" colspan="7">${group.label} <span class="pv-group-count">· ${group.items.length} ${group.items.length === 1 ? 'Tranche' : 'Tranchen'}</span></th>
            <td>${formatMoney(value)}\u00a0€</td><td class="${value === cost ? '' : value > cost ? 'positive' : 'negative'}">${formatSignedMoney(value - cost)}\u00a0€</td><td></td><td></td><td></td></tr>`;
        return `<tbody class="pv-depot-body">${groupRow}${group.items.map(({ tranche: t, index: originalIndex }) => {
            const gain = (Number(t.marketValue) || 0) - (Number(t.costBasis) || 0);
            const gainPct = t.costBasis > 0 ? (gain / t.costBasis) * 100 : 0;
            const classification = CLASSIFICATION_LABELS[t.type] || {
                category: t.category || 'Unbekannt', type: t.type || 'Unbekannt', className: 'badge-geldmarkt'
            };
            const taxBadge = t.taxExempt === true ? '<span class="badge ds-badge badge-steuerfrei">Steuerfrei</span>' : '';
            const accessibleName = escapeHtml(t.name || `Tranche ${originalIndex + 1}`);
            const date = quoteDate(t);
            const history = projectTrancheHistory(t, context, profileId);
            const detailId = `tranche-history-${encodeURIComponent(t.trancheId)}`;
            const expanded = expandedId === t.trancheId;
            if (expanded) onDetail(t, history);
            return `<tr class="tranche-row" data-tranche-id="${escapeHtml(t.trancheId)}">
                <td class="pv-tranche-name"><strong>${escapeHtml(t.name)}</strong>
                    <small>${escapeHtml(t.isin) || '–'} · ${escapeHtml(t.ticker) || '–'}</small></td>
                <td><span class="classification-category">${escapeHtml(classification.category)}</span>
                    <span class="badge ds-badge ${classification.className}">${escapeHtml(classification.type)}</span> ${taxBadge}
                    <small>Teilfreistellung ${formatDisplayNumber(t.tqf, { fractionDigits: 2 })}</small></td>
                <td>${formatDisplayDate(t.purchaseDate)}</td>
                <td>${formatDisplayNumber(t.shares, { fractionDigits: 3, minimumFractionDigits: 0 })}</td>
                <td>${formatDisplayNumber(t.purchasePrice, { unit: 'price', fractionDigits: 2 })}</td>
                <td>${formatDisplayNumber(t.currentPrice, { unit: 'price', fractionDigits: 2 })}
                    <small class="pv-quote-date">${date ? `Kurs ${formatQuoteDate(date, true)}` : 'Kursdatum unbekannt'}</small></td>
                <td>${formatMoney(t.costBasis)}\u00a0€</td>
                <td>${formatMoney(t.marketValue)}\u00a0€</td>
                <td class="${gain === 0 ? '' : gain > 0 ? 'positive' : 'negative'}">${formatSignedMoney(gain)}\u00a0€<small class="pv-gain-percent">${formatSignedPercent(gainPct)}</small></td>
                ${buildTrancheHistorySummary(history)}
                <td class="table-actions">
                    <button type="button" class="ds-button ds-button-quiet pv-history-toggle" data-history-toggle="${escapeHtml(t.trancheId)}" aria-expanded="${expanded}" aria-controls="${escapeHtml(detailId)}" aria-label="Kursverlauf ${accessibleName} ${expanded ? 'ausblenden' : 'zeigen'}">${expanded ? '▾ ausblenden' : '▸ zeigen'}</button>
                    <button class="icon-action ds-button ds-icon-button" type="button" data-action="edit-tranche" data-tranche-id="${escapeHtml(t.trancheId)}" aria-label="Tranche ${accessibleName} bearbeiten" title="Tranche bearbeiten"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
                    <button class="delete-btn icon-action ds-button ds-icon-button" type="button" data-action="delete-tranche" data-tranche-id="${escapeHtml(t.trancheId)}" aria-label="Tranche ${accessibleName} löschen" title="Tranche löschen"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
                </td></tr><tr class="pv-history-row" id="${escapeHtml(detailId)}" ${expanded ? '' : 'hidden'}><td colspan="12">${expanded ? buildTrancheHistoryDetail(t, history) : ''}</td></tr>`;
        }).join('')}</tbody>`;
    }).join('');
    return `<p class="ds-scroll-hint">Weitere Spalten: horizontal scrollen, mit Tastatur ← / →.</p>
        <div class="table-scroll ds-table-scroll" role="region" aria-label="Tranchen-Tabelle, horizontal scrollbar" tabindex="0">
        <table class="ds-table pv-depot-table">
            <caption class="visually-hidden">Gespeicherte Tranchen nach Anlageform und Kaufdatum mit Bewertung und Aktionen</caption>
            <thead><tr><th>Name / ISIN</th><th>Kategorie / Typ</th><th>Kaufdatum</th><th>Stücke</th>
                <th>Kaufpreis (€/Stück)</th><th>Kurs (€/Stück)</th><th>Einstand (€)</th><th>Marktwert (€)</th>
                <th>Gewinn (€ / %)</th><th>Verlauf</th><th>Entwicklung</th><th>Aktionen</th></tr></thead>${rows}
        </table></div>`;
}

export function renderTranchenStats(container, tranchen) {
    const context = container.ownerDocument?.getElementById('managerQuoteContext');
    container.innerHTML = buildTranchenStatsHtml(tranchen, { automatic: context?.dataset?.automatic === 'true' });
}

const detailBindings = new WeakMap();
export function renderTranchenTable(container, tranchen, options = {}) {
    detailBindings.get(container)?.dispose();
    detailBindings.delete(container);
    let detail;
    container.innerHTML = buildTranchenTableHtml(tranchen, { ...options, onDetail: (tranche, history) => { detail = { tranche, history }; } });
    const section = container.querySelector?.('.pv-history-detail');
    const host = container.querySelector?.('.pv-course-chart') || section;
    const region = container.querySelector?.('.table-scroll');
    if (host && detail) detailBindings.set(container, bindTrancheHistoryChart(host, detail.tranche, detail.history, { region, detail: section }));
}

export function ensureReconciliationCashControls(doc = document) {
    const form = doc.getElementById?.('reconciliationForm');
    if (!form || typeof doc.createElement !== 'function') return null;
    let choice = doc.getElementById?.('reconciliationCashChoice');
    if (!choice) {
        choice = doc.createElement('fieldset');
        choice.id = 'reconciliationCashChoice';
        choice.className = 'reconciliation-cash-choice';
        choice.setAttribute?.('style', 'margin:0;padding:1rem;border:1px solid var(--border-strong);border-radius:8px;');
        choice.innerHTML = `
            <legend>Cashstatus nach dem Verkauf *</legend>
            <div class="form-group">
                <label for="reconcileCashStatus">Ist der Nettoerlös bereits in der freien Liquidität enthalten?</label>
                <select id="reconcileCashStatus" class="ds-select">
                    <option value="pending_manual_posting" selected>Nein / noch unklar – manuell offen halten</option>
                    <option value="confirmed_already_reflected">Ja – bereits im erfassten Cashstand enthalten</option>
                </select>
                <small>Es erfolgt niemals eine automatische Cashbuchung.</small>
            </div>
            <div id="reconcileInitialCashBalanceGroup" class="form-group" hidden>
                <label for="reconcileInitialCashBalance">Bestätigter Cashstand nach Berücksichtigung (€) *</label>
                <input class="ds-input" id="reconcileInitialCashBalance" data-money-input type="text" inputmode="decimal" lang="de">
                <small>Dieser Stand wird zusammen mit Nettoerlös und Zeitpunkt append-only dokumentiert.</small>
            </div>`;
        const firstActions = form.querySelector?.('.reconciliation-actions');
        if (firstActions?.parentNode?.insertBefore) firstActions.parentNode.insertBefore(choice, firstActions);
        else form.appendChild?.(choice);
    }

    let statusContainer = doc.getElementById?.('reconciliationCashStatuses');
    if (!statusContainer) {
        statusContainer = doc.createElement('div');
        statusContainer.id = 'reconciliationCashStatuses';
        statusContainer.className = 'reconciliation-preview ds-card';
        statusContainer.setAttribute?.('aria-live', 'polite');
        form.parentNode?.appendChild?.(statusContainer);
    }
    return statusContainer;
}

export function buildReconciliationCashStatusesHtml(statuses = [], { errorMessage = '' } = {}) {
    if (errorMessage) {
        return `
            <p class="reconciliation-status ds-note ds-note-error" data-kind="error" role="alert"><strong>Cashstatus-Audit nicht lesbar – die Liste ist unvollständig.</strong><br>${escapeHtml(errorMessage)}</p>`;
    }
    if (!Array.isArray(statuses) || statuses.length === 0) {
        return `
            <p class="pv-sales-empty">Noch keine dokumentierten Realverkäufe für dieses Profil.</p>`;
    }
    const rows = statuses.map(status => {
        const targetActionId = escapeHtml(status.targetActionId);
        const label = escapeHtml(status.statusLabel || 'Cashstatus unbekannt');
        const net = formatMoney(status.confirmedNetProceedsEur);
        const cashBalance = status.cashBalanceAfterPostingEur === null
            ? '-'
            : `${formatMoney(status.cashBalanceAfterPostingEur)}\u00a0€`;
        const evidence = status.effectiveActionId
            ? `<div><strong>Wirksamer Auditnachweis:</strong> ${escapeHtml(status.effectiveActionId)}</div>`
            : '';
        const correction = status.correctionRevision > 0
            ? `<div><strong>Korrektur:</strong> Revision ${Number(status.correctionRevision)} · ${escapeHtml(status.correctionReason || '')}</div>`
            : '';
        const confirmLabel = status.isLegacy ? 'Cashnachweis freiwillig ergänzen' : 'Cashbuchung manuell bestätigen';
        const action = status.canConfirm
            ? `<button type="button" class="btn-primary ds-button ds-button-primary" data-cash-action="confirm" data-target-action-id="${targetActionId}">${confirmLabel}</button>`
            : status.canCorrect
                ? `<button type="button" class="btn-secondary ds-button ds-button-secondary" data-cash-action="correct" data-target-action-id="${targetActionId}">Bestätigten Cashstand korrigieren</button>`
                : '';
        return `
            <article data-cash-status="${escapeHtml(status.cashStatus)}" class="ds-note ${status.isPending ? 'ds-note-warning' : ''}" style="margin-top: var(--space-2);">
                <div><strong>${label}</strong></div>
                <div><strong>Verkauf vom ${escapeHtml(status.executedAt || 'unbekannt')}:</strong> ${escapeHtml(status.trancheId || 'Tranche unbekannt')}</div>
                <div><strong>Zielverkauf:</strong> ${targetActionId}</div>
                <div><strong>Nettoerlös:</strong> ${net}\u00a0€ · <strong>bestätigter Cashstand:</strong> ${cashBalance}</div>
                <details class="pv-cash-evidence"><summary><span class="pv-disclosure-action"><span>▸ Exakte Beträge zeigen</span><span>▾ Exakte Beträge ausblenden</span></span></summary><p>Nettoerlös: ${formatDisplayNumber(status.confirmedNetProceedsEur, { fractionDigits: 2 })} € · bestätigter Cashstand: ${status.cashBalanceAfterPostingEur === null ? '-' : `${formatDisplayNumber(status.cashBalanceAfterPostingEur, { fractionDigits: 2 })} €`}</p></details>
                ${status.confirmedAt ? `<div><strong>Nachweiszeitpunkt:</strong> ${escapeHtml(status.confirmedAt)}</div>` : ''}
                ${evidence}${correction}
                <div class="reconciliation-actions">${action}</div>
            </article>`;
    }).join('');
    const pendingCount = statuses.filter(status => status.isPending).length;
    const legacyCount = statuses.filter(status => status.isLegacy).length;
    const summary = [
        pendingCount > 0
            ? `${pendingCount} Verkauf/Verkäufe mit offener manueller Cashbuchung.`
            : 'Kein offener manueller Cashrückstand.',
        legacyCount > 0
            ? `${legacyCount} Altverkauf/Altverkäufe ohne dokumentierten Cashstatus; operativ abgeschlossen, aber nicht als cashbestätigt ausgewiesen.`
            : ''
    ].filter(Boolean).join(' ');
    return `
        <p>${summary}</p>
        ${rows}`;
}

export function renderReconciliationCashStatuses(container, statuses = [], options = {}) {
    if (!container) return;
    container.innerHTML = buildReconciliationCashStatusesHtml(statuses, options);
}

/** Stabile Textknoten: kein HTML aus Namen oder Profileingaben. */
export function renderManagerPersonData(doc, profile) {
    if (!profile) return;
    const text = (id, value) => { const el = doc.getElementById(id); if (el) el.textContent = value; };
    text('managerPersonProfileName', profile.name);
    if (!profile.valid) {
        for (const card of ['Person', 'Assets', 'Care']) text(`manager${card}Summary`, 'Profildaten unvollständig');
        text('profilePersonDateStatus', 'Profildaten unvollständig; bitte prüfen.');
        text('managerPensionStatus', 'Rentenbeginn nicht verfügbar.');
        text('managerPensionStartStatus', 'Rentenbeginn nicht verfügbar.');
        const banner = doc.getElementById('managerBirthSupplement');
        if (banner) banner.hidden = true;
        const age = doc.getElementById('profileAlter');
        if (age) age.value = '';
        return;
    }
    const { values: v, personDates: dates } = profile;
    const health = v.healthBucket || { enabled: false };
    const money = value => `${formatMoney(value)} €`;
    const pct = value => formatDisplayNumber(value, { fractionDigits: 1 });
    const adjustment = v.rentenanpassungArt === 'fix' ? `${pct(v.rentenanpassungPct)} % Rentenanpassung` : v.rentenanpassungArt === 'cpi' ? 'Rente folgt Inflation' : 'Rente folgt Lohnentwicklung';
    text('managerPersonSummary', `${dates?.identity || 'Geburtsdatum fehlt oder ist ungültig'} · ${(profile.currentIncome?.pensionStatus?.startsWith('Rente') ? profile.currentIncome.pensionStatus : profile.currentIncome?.status) || ''} · ${adjustment} · Kirchensteuer ${pct(v.kirchensteuerPct)} %`);
    text('managerAssetsSummary', v.goldAktiv ? `Ziel ${pct(v.goldZiel)} % · Floor ${pct(v.goldFloor)} % · Band ± ${pct(v.goldBand)} % · ${v.goldSteuerfrei ? 'steuerfrei' : 'steuerpflichtig'}` : 'aus');
    text('managerCareSummary', health.enabled ? `aktiv · Ziel ${money(health.initialAmount)} · ab Pflegegrad ${health.triggerMinGrade}` : 'inaktiv · Ziel innerhalb der Liquidität');
    text('profileGenderStatus', v.genderAssumed ? 'bitte prüfen · Geschlecht bisher angenommen' : '');
    const year = dates?.hint?.match(/^Für die Planung (\d{4}) zählt/)?.[1];
    const dateStatus = doc.getElementById('profilePersonDateStatus');
    if (dateStatus && year && Number.isFinite(dates.age)) {
        dateStatus.textContent = `Planalter ${year}: ${dates.age} Jahre`;
        dateStatus.append(createInfoPopover(doc, 'Wie wird das Planalter bestimmt?', dates.hint));
        bindInfoPopovers(doc, { root: dateStatus });
    } else text('profilePersonDateStatus', dates?.hint || 'Geburtsdatum einmal ergänzen');
    text('managerRenteHelp', '');
    const tax = doc.querySelector?.('[data-person-field="profileRenteSteuerquotePct"]');
    if (tax) tax.hidden = profile.householdRole !== 'Partnerprofil';
    const confirmGender = doc.getElementById('profileGenderConfirm');
    if (confirmGender) confirmGender.hidden = !v.genderAssumed;
    text('managerPensionStatus', profile.currentIncome?.pensionStatus || '');
    text('managerPensionStartStatus', (profile.currentIncome?.pensionStatus || '').split(' · ')[0].replace(/^Rente /, ''));
    const ageField = doc.getElementById('profileAlter');
    if (ageField) ageField.value = dates?.age ?? v.alter ?? '';
    const banner = doc.getElementById('managerBirthSupplement');
    if (banner) banner.hidden = !dates?.birthMissing;
    text('managerBirthSuggestion', dates?.suggestedBirthYear ? `Geburtsjahrvorschlag ${dates.suggestedBirthYear} aus dem Altalter. Tag und Monat bleiben offen.` : 'Tag, Monat und Jahr vollständig eingeben; kein Datum wird aus dem Alter erfunden.');
    const input = doc.getElementById('managerBirthDate');
    if (input && input.dataset.profileId !== profile.id) {
        input.value = ''; input.dataset.profileId = profile.id; input.removeAttribute?.('aria-invalid'); text('managerBirthError', '');
    }
}
