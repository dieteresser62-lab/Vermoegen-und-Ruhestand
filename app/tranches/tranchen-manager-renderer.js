import { HOUSEHOLD_CURRENT_LIMIT_MESSAGE } from '../profile/profile-registry.js';
import { propertyParts, wealthInfo, wealthDetail, wealthAllocation, allocationNames } from '../shared/wealth-display.js';
import { householdImmobilienValue } from '../profile/profile-immobilien.js';
import { areaSessionStorage } from '../shared/persistence-area-storage.js';
import { appNow } from '../shared/app-clock.js';
import { assetStrategyWarningHtml } from '../shared/asset-strategy-warnings.js';
import { bindInfoPopovers, createInfoPopover } from '../shared/designsystem-info-popover.js';

export function renderManagerPlanComparison(doc, view) {
    const host = doc.getElementById('managerPlanComparison');
    if (!host) return;
    const budget = view.rows.find(row => row.label === 'Monatsbudget');
    host.innerHTML = `<span data-plan-record-status="${escapeHtml(view.recordStatus)}" data-preview-status="${escapeHtml(view.previewStatus)}">${escapeHtml(view.planLabel)}${view.adjusted ? ' · bewusst angepasst' : ''}: ${escapeHtml(view.notice || budget?.plan || '—')} · Vorschau heute: ${escapeHtml(view.previewStatus === 'current' ? budget?.preview || '—' : view.previewNotice)} · <a class="ds-text-link" href="index.html#overviewPlanComparison" data-profile-handoff>Vergleich auf der Übersicht →</a>${view.previewStatus !== 'current' ? ' · <a class="ds-text-link" href="Balance.html" data-profile-handoff>Vorschau in der Balance rechnen →</a>' : ''}</span>`;
}
import { buildHistoryRecoveryHtml, buildPersonHistoryHtml, buildPersonHistoryDetailsHtml, projectTrancheHistory, buildTrancheHistorySummary, buildTrancheHistoryDetail, bindTrancheHistoryChart } from './tranchen-history-ui.js';

import { formatDisplayNumber, formatDisplayDate } from '../shared/designsystem-number-format.js';
import { escapeHtml } from '../shared/security-utils.js';
import { STARTUP_PRICE_SESSION_KEY } from './tranchen-startup-prices.js';
import { buildHomeGroupsHtml } from './tranchen-manager-immobilien.js';
import { splitHintHtml } from './tranche-split-hint.js';
import { householdPlanSummary } from '../shared/household-plan-presentation.js';

export function renderManagerPlanSummary(doc, values) {
    const host = doc.getElementById('managerPlanMoreSummary');
    if (!host) return;
    host.textContent = householdPlanSummary(values);
}

export function buildManagerHistoryStartHtml(projection, single) {
    const confirmed = projection.historyContext?.confirmed === true;
    return `${confirmed ? `<p data-history-start-summary>Verlauf seit ${formatDisplayDate(projection.historyContext.startDate)} · <button type="button" class="ds-text-link ds-button" data-history-start-edit>ändern</button></p>` : ''}<form id="managerHistoryStartForm" data-history-start-form ${confirmed ? 'hidden' : ''} class="pv-history-start"><label for="managerHistoryStart">Verlauf ab …</label>
        <input id="managerHistoryStart" data-history-start-input class="ds-input" type="date" required max="${projection.historyContext?.today || ''}" value="${projection.historyContext?.startDate || ''}">
        <button type="submit" id="managerHistoryStartConfirm" class="ds-button ds-button-secondary">Beginn bestätigen</button>
        <small>${single ? 'Für dieses Profil' : 'Für den gesamten Haushalt'}. Fehlende Kurse werden beim nächsten Start nachgeladen.</small></form><p id="managerHistoryStartStatus" class="history-note" role="status" aria-live="polite"></p>`;
}

function renderManagerAvatar(profile, small = false) {
    const initials = String(profile.name).trim().split(/\s+/u).map(part => Array.from(part)[0]).slice(0, 2).join('').toLocaleUpperCase('de-DE');
    return `<span class="pv-avatar ${small ? 'pv-avatar-small' : ''}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}


function renderManagerIncomeSteps(steps = [], id = '') {
    if (!steps.length) return '';
    const table = `<table class="ds-table"><thead><tr><th>Datum</th><th class="ds-num">Betrag netto/Monat</th><th>Grund</th></tr></thead><tbody>${steps.map(step => `<tr><td>${escapeHtml(step.month.slice(5) + '.' + step.month.slice(0, 4))}</td><td class="ds-num">${formatMoney(step.income)} €</td><td>${escapeHtml(step.reason || 'Einkunft')}</td></tr>`).join('')}</tbody></table>`;
    if (id) return `<div id="managerIncomeSteps" class="ds-table-box">${table}</div>`;
    return `<div class="ds-table-box">${table}</div>`;
}

// Dokumentlokale Ansicht, unabhängig vom bearbeiteten Profil; keine Speicherpräferenz.
const managerViews = new WeakMap();
export function getManagerView(doc) { return managerViews.get(doc); }
export function renderManagerView(doc, view = getManagerView(doc)) {
    if (!view) return;
    managerViews.set(doc, view);
    const managePeople = doc.getElementById('managePeopleBtn');
    if (managePeople) managePeople.hidden = false;
    const tabs = Array.from(doc.getElementById('managerSectionNav')?.querySelectorAll?.('[role="tab"]') || []);
    for (const tab of tabs) {
        const selected = view.kind !== 'person' ? tab.dataset.managerView === view.kind
            : tab.dataset.managerProfile === view.profileId;
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('tabindex', selected ? '0' : '-1');
    }
    const selected = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
    for (const [id, kind] of [['managerPlanPanel', 'plan'], ['managerPersonPanel', 'person'], ['managerHistoryPanel', 'history'], ['managerCarePanel', 'care']]) {
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
            // PFA-10: Pflegewerte des Haushalts als eigener Reiter neben Haushalt & Plan.
            + tab('managerCareTab', 'Pflege', 'data-manager-view="care"', view.kind === 'care', 'managerCarePanel', '<svg class="pv-avatar-small" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>')
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
    const allocationBar = (profile, legend = true) => {
        const homes = propertyParts(profile === sum ? projection.profiles.filter(p => p.belongs) : [profile]);
        const total = profile.assets + homes.total;
        if (!total) return '';
        const parts = Object.entries(wealthAllocation(profile.allocation, homes)).filter(([, value]) => value > 0);
        const label = parts.map(([kind, value]) => `${allocationNames[kind]} ${formatDisplayNumber(value / total * 100, { fractionDigits: 0 })} %`).join(' · ');
        return `<div class="pv-asset-bar" role="img" aria-label="${escapeHtml(label)}">${parts.map(([kind, value]) =>
            `<span class="pv-asset-${kind}" style="flex-grow:${value / total}"></span>`).join('')}</div>
            ${legend ? `<ul class="pv-legend">${parts.map(([kind, value]) => `<li><i class="pv-asset-${kind}" aria-hidden="true"></i>${allocationNames[kind]} ${formatDisplayNumber(value / total * 100, { fractionDigits: 0 })} %</li>`).join('')}</ul>` : ''}`;
    };
    const single = projection.profiles.length === 1;
    const title = doc.getElementById('managerPageTitle');
    if (title) title.textContent = 'Personen & Vermögen';
    const person = projection.profiles[0];
    const sum = single && person.valid ? { ...person, incomeWarnings: person.currentIncome.missing ? ['Rentenbeginn fehlt'] : [], careTarget: person.careTarget || 0 } : projection.household;
    const history = (value, title, infoId) => buildPersonHistoryHtml(value, title, projection.historyContext, infoId, { compact: true });
    const details = (key, body) => `<details class="pv-wealth-details ds-technical-details" data-wealth-details="${escapeHtml(key)}"><summary>Depot, Einkünfte, Verlauf</summary><div class="pv-wealth-details-body">${body}</div></details>`;
    const gain = profile => `<p class="pv-book-gain"><span class="${profile.gain === 0 ? '' : profile.gain > 0 ? 'positive' : 'negative'}">${formatSignedMoney(profile.gain)} €</span> Buchgewinn auf ${money(profile.cost)} Einstand</p>`;
    const householdTitle = single ? `Vermögensverlauf ${person.name}` : 'Vermögensverlauf Haushalt';
    const startForm = buildManagerHistoryStartHtml(projection, single);
    const group = (name, body) => `<section class="pv-wealth-detail-group"><h3>${name}</h3>${body}</section>`;
    const incomeDetails = (value, id = '') => `<div class="pv-income"><div><span>Einkommen heute im Monat, netto</span><strong>${money(value.income)}</strong></div>${renderManagerIncomeSteps(value.incomeSteps, id)}${(value.incomeWarnings || (value.currentIncome?.missing ? ['Rentenbeginn fehlt'] : [])).map(warning => `<p>${escapeHtml(warning)}</p>`).join('')}</div>`;
    const reserve = (value, enabled) => enabled ? group('Pflegereserve', `<p>Pflegereserve-Ziel ${money(value.careTarget || 0)}</p>`) : '';
    const historyDetails = (value, title, infoId, profileId = null) => group('Vermögensverlauf',
        `${profileId ? `<p>${projection.historyContext?.startDate ? `${projection.historyContext.confirmed ? 'Verlauf seit' : 'Vorgesehener Beginn'} ${formatDisplayDate(projection.historyContext.startDate)}${projection.historyContext.confirmed ? '' : ' · noch nicht bestätigt'}` : 'Beginn noch nicht bestätigt'}</p>` : startForm}${buildPersonHistoryDetailsHtml(value, title, infoId)}${historyLink(profileId)}`);
    const householdDetails = `${sum ? group('Depot', gain(sum)) + group('Einkünfte', incomeDetails(sum, 'managerIncomeSteps')) + reserve(sum, single ? person.values?.healthBucket?.enabled : projection.profiles.some(p => p.belongs && p.values?.healthBucket?.enabled)) : ''}${historyDetails(projection.householdHistory, householdTitle, 'managerHouseholdHistoryInfo')}`;
    const immobilien = householdImmobilienValue(projection.profiles);
    const total = sum ? `<div class="pv-hero-number">${formatMoney(sum.assets + (immobilien || 0))}<span>€</span></div>
        ${immobilien === null ? '' : `<p class="ds-explanation" data-household-immobilien>${wealthDetail(sum.assets, propertyParts(projection.profiles.filter(p => p.belongs)))}</p>`}
        ${history(projection.householdHistory, householdTitle, 'managerHouseholdHistoryInfo')}
        ${allocationBar(sum)}` : `<p>${projection.profiles.filter(p => p.belongs).length > 2 ? HOUSEHOLD_CURRENT_LIMIT_MESSAGE(projection.profiles.filter(p => p.belongs).length) : 'Haushaltssumme nicht verfügbar: keine Auswahl oder unvollständige Profildaten.'}</p>`;
    const profileButton = profile => `<a class="ds-text-link" href="#personendaten" data-manager-profile="${escapeHtml(profile.id)}">Zur Person →</a>`;
    const cards = projection.profiles.map((profile, index) => {
        const historyTitle = `Vermögensverlauf ${profile.name}`, infoId = `managerPersonHistoryInfo-${index + 1}`;
        const recovery = profile.active ? buildHistoryRecoveryHtml(profile.historyRecovery) + '<p id="managerHistoryRecoveryStatus" role="status" tabindex="-1"></p>' : '';
        const personDetails = profile.valid ? `${group('Depot', `${allocationBar(profile)}
            <dl class="pv-allocation-values">${Object.entries(wealthAllocation(profile.allocation, propertyParts([profile]))).filter(([, value]) => value > 0).map(([kind, value]) => `<div><dt>${allocationNames[kind]}</dt><dd>${money(value)}</dd></div>`).join('')}</dl>${gain(profile)}<p>${profile.count} Tranchen</p>`)}
            ${group('Einkünfte', incomeDetails(profile))}${reserve(profile, profile.values?.healthBucket?.enabled)}
            ${historyDetails(profile.history, historyTitle, infoId, profile.id)}` : '<p>Profildaten unvollständig; keine Vermögenssumme.</p>';
        return `<section class="ds-card pv-person-card" aria-label="${escapeHtml(profile.name)}">
            <header><div class="pv-person-identity">${renderManagerAvatar(profile)}<div><h3>${escapeHtml(profile.name)}</h3>
            <p>${profile.valid ? `${escapeHtml(profile.personDates?.identity || 'Geburtsdatum fehlt oder ist ungültig')} · ` : ''}${escapeHtml(profile.householdRole || 'Haushaltsprofil')}</p></div></div>${profileButton(profile)}</header>
            ${profile.valid ? `<dl class="pv-person-wealth"><div><dt>Gesamtvermögen</dt><dd>${money(profile.assets + propertyParts([profile]).total)}${wealthInfo(profile.allocation, propertyParts([profile]))}${propertyParts([profile]).present ? `<small>${wealthDetail(profile.assets, propertyParts([profile]))}</small>` : ''}</dd></div></dl>
            ${history(profile.history, historyTitle, infoId)}
            <dl class="pv-person-income"><div>${profile.income > 0 || profile.incomeSteps?.some(step => step.income > 0)
                ? `<dt>Einkünfte netto${profile.income === 0 ? ' heute' : ''}</dt><dd>${money(profile.income)}${profile.income > 0 ? ' <small>/Monat</small>' : ''}</dd>${profile.incomeSteps?.length ? `<small>ab ${escapeHtml(profile.incomeSteps[0].month.slice(5) + '.' + profile.incomeSteps[0].month.slice(0, 4))}: ${money(profile.incomeSteps[0].income)}/Monat</small>` : ''}`
                : '<dt>Keine Einkünfte eingetragen</dt>'}${profile.currentIncome.missing ? '<small>Rentenbeginn fehlt</small>' : ''}</div>
            <div><dt>Tagesgeld</dt><dd>${money(profile.values.tagesgeld)}</dd></div></dl>` : ''}
            ${details(profile.id, personDetails)}${recovery}
        </section>`;
    }).join('');
    const household = doc.getElementById('managerHousehold');
    if (household) {
        const householdHtml = `<section class="ds-card pv-household-card"><div class="pv-household-heading"><h2>Gesamtvermögen${single ? '' : ' · Haushalt'}</h2>
        </div>${total}${details('household', householdDetails)}</section>${cards}`;
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

// Kurszeit der Börse aus asOf. Spiel- und Beispielkurse tragen nur einen Tag (UTC-Mitternacht) und zeigen keine Uhrzeit.
function formatQuoteStamp(tranche, value) {
    const day = formatQuoteDate(value, true);
    return tranche.asOf % 86400 === 0 ? day : `${day} ${new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(value)}`;
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
        const session = areaSessionStorage(doc.defaultView?.sessionStorage || globalThis.window?.sessionStorage);
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
    const depotQuotes = doc.getElementById('managerDepotQuotes');
    if (depotQuotes) depotQuotes.textContent = `${uniform ? 'Kurse vom ' : ''}${uniform ? formatQuoteDate(quoteDate(tranchen[0])) : quoteSummary(tranchen)}`
        + (automatic ? ', automatisch beim Öffnen' : '') + (stale ? ' · ältere Kurse' : '');
}

function wealthMetrics(tranchen, cash = 0, immobilien = []) {
    const allocation = tranchen.reduce((parts, tranche) => {
        parts[tranche.type] = (parts[tranche.type] || 0) + (Number(tranche.marketValue) || 0); return parts;
    }, { cash });
    const allocationInfo = wealthInfo(allocation, propertyParts([{ values: { immobilien } }]), 'Geldvermögen enthält Tagesgeld und Depot; Immobilien zählen zum Gesamtvermögen.').replace('class="ds-info-button"', 'class="ds-info-button ds-button"');
    const totalValue = tranchen.reduce((sum, t) => sum + (Number(t.marketValue) || 0), 0);
    const totalCost = tranchen.reduce((sum, t) => sum + (Number(t.costBasis) || 0), 0);
    const totalGain = totalValue - totalCost;
    const gainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const tone = totalGain === 0 ? '' : totalGain > 0 ? 'positive' : 'negative';
    const homes = propertyParts([{ values: { immobilien } }]);
    return [
        ['total', 'Gesamtvermögen', `${formatMoney(totalValue + cash + homes.total)}\u00a0€`, wealthDetail(totalValue + cash, homes), '', allocationInfo],
        ['cash', 'Tagesgeld', `${formatMoney(cash)}\u00a0€`, 'von Hand nachgeführt'],
        ['stocks', 'Aktien', `${formatMoney((allocation.aktien_alt || 0) + (allocation.aktien_neu || 0))}\u00a0€`, '', '', '', !(allocation.aktien_alt || allocation.aktien_neu)],
        ['money-market', 'Geldmarkt', `${formatMoney(allocation.geldmarkt || 0)}\u00a0€`, '', '', '', !allocation.geldmarkt],
        ['gold', 'Gold', `${formatMoney(allocation.gold || 0)}\u00a0€`, '', '', '', !allocation.gold],
        ['bonds', 'Anleihen', `${formatMoney(allocation.anleihe || 0)}\u00a0€`, '', '', '', !allocation.anleihe],
        ['homes', 'Immobilien', `${formatMoney(homes.total)}\u00a0€`, `selbst genutzt ${formatMoney(homes.self)} € · vermietet ${formatMoney(homes.rented)} €`, '', '', !immobilien.length],
        ['depot', 'Depotwert', `${formatMoney(totalValue)}\u00a0€`, `${tranchen.length} ${tranchen.length === 1 ? 'Tranche' : 'Tranchen'} zum Kurs`],
        ['cost', 'Einstandswert', `${formatMoney(totalCost)}\u00a0€`, 'Kaufsummen'],
        ['gain', 'Buchgewinn', `${formatSignedMoney(totalGain)}\u00a0€`, formatSignedPercent(gainPct), tone]
    ];
}

/** @param {(string | boolean)[]} metric */
function wealthMetricBody([, label, value, note, tone = '', allocationInfo = '']) {
    return `<div class="stat-label ds-metric-label">${label}${allocationInfo}</div><div class="stat-value ds-metric-value ${tone}">${value}</div><small class="${tone}">${note}</small>`;
}

export function buildTranchenStatsHtml(tranchen, { cash = 0, immobilien = [] } = {}) {
    return wealthMetrics(tranchen, cash, immobilien).map(metric => `${metric[0] === 'depot' ? '<div class="pv-metrics-label">Depot</div>' : ''}<div class="stat-card ds-card ds-metric ${metric[0] === 'total' ? ' pv-total-metric' : ''}" data-wealth-metric="${metric[0]}"${metric[6] ? ' hidden' : ''}>${wealthMetricBody(metric)}</div>`).join('');
}

export function buildEmptyTranchenHtml() {
    return `<div class="empty-state ds-note">
        <h3>Keine Tranchen vorhanden</h3>
        <p>Mit „Kauf eintragen“ erfasst du deine erste Tranche. Tagesgeld pflegst du in der Kennzahlenleiste.</p>
    </div>`;
}

const DEPOT_GROUPS = Object.freeze([
    { key: 'equity', label: 'Aktien / ETFs', types: ['aktien_alt', 'aktien_neu'] },
    { key: 'money_market', label: 'Geldmarkt', types: ['geldmarkt'] },
    { key: 'gold', label: 'Gold', types: ['gold'] },
    { key: 'bonds', label: 'Anleihen', types: ['anleihe'] },
    { key: 'unknown', label: 'Unbekannte Anlageform', types: [] }
]);

export function buildTranchenTableHtml(tranchen, { context = null, profileId = null, expandedId = null, onDetail = /** @type {(tranche: object, history: object) => void} */ (() => {}), strategyWarnings = [] } = {}) {
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
                    <small class="pv-quote-date">${date ? `Kurs ${formatQuoteStamp(t, date)}` : 'Kursdatum unbekannt'}</small>${splitHintHtml(t, context)}</td>
                <td>${formatMoney(t.costBasis)}\u00a0€</td>
                <td>${formatMoney(t.marketValue)}\u00a0€</td>
                <td class="${gain === 0 ? '' : gain > 0 ? 'positive' : 'negative'}">${formatSignedMoney(gain)}\u00a0€<small class="pv-gain-percent">${formatSignedPercent(gainPct)}</small></td>
                ${buildTrancheHistorySummary(history)}
                <td class="table-actions">
                    <button type="button" class="ds-button ds-button-quiet pv-history-toggle" data-history-toggle="${escapeHtml(t.trancheId)}" aria-expanded="${expanded}" aria-controls="${escapeHtml(detailId)}" aria-label="Kursverlauf ${accessibleName} ${expanded ? 'ausblenden' : 'zeigen'}">${expanded ? '▾ ausblenden' : '▸ zeigen'}</button>
                    <button class="icon-action ds-button ds-icon-button" type="button" data-action="edit-tranche" data-tranche-id="${escapeHtml(t.trancheId)}" aria-label="Tranche ${accessibleName} bearbeiten" title="Tranche bearbeiten"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
                    <button class="delete-btn icon-action ds-button ds-icon-button" type="button" data-action="delete-tranche" data-tranche-id="${escapeHtml(t.trancheId)}" aria-label="Tranche ${accessibleName} löschen" title="Tranche löschen"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
                </td></tr>${strategyWarnings.filter(warning => warning.profileId === profileId && warning.trancheIds.includes(t.trancheId)).map(warning => `<tr><td colspan="12">${assetStrategyWarningHtml(warning)}</td></tr>`).join('')}<tr class="pv-history-row" id="${escapeHtml(detailId)}" ${expanded ? '' : 'hidden'}><td colspan="12">${expanded ? buildTrancheHistoryDetail(t, history) : ''}</td></tr>`;
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

export function renderTranchenStats(container, tranchen, { cash = 0, immobilien = [] } = {}) {
    if (!container) return;
    const metrics = wealthMetrics(tranchen, cash, immobilien);
    const mainCount = metrics.slice(0, metrics.findIndex(metric => metric[0] === 'depot')).filter(metric => !metric[6]).length;
    container.style?.setProperty?.('--wealth-count', String(mainCount));
    if (container.dataset) container.dataset.wealthWrap = String(mainCount > 6);
    if (!container.querySelector?.('[data-wealth-metric]')) {
        container.innerHTML = buildTranchenStatsHtml(tranchen, { cash, immobilien });
        return;
    }
    // Das statische Tagesgeldfeld samt Entwurf, Fokus und Listenern erhalten.
    for (const metric of metrics) {
        const host = container.querySelector(`[data-wealth-metric="${metric[0]}"]`);
        if (host) {
            host.innerHTML = wealthMetricBody(metric);
            host.hidden = metric[6] === true;
        }
    }
    if (container.ownerDocument) bindInfoPopovers(container.ownerDocument, { root: container });
}

const detailBindings = new WeakMap();
export function renderTranchenTable(container, tranchen, options = {}) {
    const sameProfile = container.dataset?.profileId === options.profileId;
    const opened = new Set(sameProfile ? Array.from(container.querySelectorAll?.('[data-asset-group][open]') || []).map(group => group.dataset.assetGroup) : []);
    detailBindings.get(container)?.dispose();
    detailBindings.delete(container);
    /** @type {{tranche: object, history: object} | undefined} */
    let detail;
    const cash = options.cash ?? 0;
    const total = cash + propertyParts([{ values: { immobilien: options.immobilien || [] } }]).total + tranchen.reduce((sum, tranche) => sum + (Number(tranche.marketValue) || 0), 0);
    const summary = (key, label, count, value, expandable = false) => `<span class="pv-asset-swatch pv-asset-${key}" aria-hidden="true"></span><strong>${label}</strong><span class="pv-asset-count">${count}</span><span>${formatMoney(value)}\u00a0€</span><span class="pv-asset-share">${formatDisplayNumber(total > 0 ? value / total * 100 : 0, { fractionDigits: 1 })}\u00a0%</span><span class="pv-asset-arrow" aria-hidden="true">${expandable ? '▸' : ''}</span>`;
    const groups = ['aktien_alt', 'aktien_neu', 'geldmarkt', 'gold', 'anleihe'].map(key => [key, CLASSIFICATION_LABELS[key]]).map(([key, label]) => ({ key, label: key === 'aktien_alt' ? 'Aktien · Altbestand' : key === 'aktien_neu' ? 'Aktien · Neubestand' : label.category, items: tranchen.filter(t => t.type === key) }));
    const unknown = tranchen.filter(t => !Object.hasOwn(CLASSIFICATION_LABELS, t.type));
    if (unknown.length) groups.push({ key: 'unknown', label: 'Unbekannte Anlageform', items: unknown });
    container.innerHTML = `<div class="pv-asset-list"><div class="pv-asset-row pv-asset-headings" aria-hidden="true"><span></span><span>Anlageform</span><span>Tranchen</span><span>Wert</span><span>Anteil</span><span></span></div>
        <div class="pv-asset-row pv-cash-row">${summary('cash', 'Tagesgeld', '—', cash)}</div>
        ${groups.filter(group => group.items.length).map(group => `<details class="pv-asset-group" data-asset-group="${group.key}" ${opened.has(group.key) || group.items.some(t => t.trancheId === options.expandedId || options.strategyWarnings?.some(warning => warning.profileId === options.profileId && warning.trancheIds.includes(t.trancheId))) ? 'open' : ''}><summary class="pv-asset-row">${summary(group.key, group.label, group.items.length, group.items.reduce((sum, t) => sum + (Number(t.marketValue) || 0), 0), true)}</summary><div class="pv-asset-tranches">${buildTranchenTableHtml(group.items, { ...options, onDetail: (tranche, history) => { detail = { tranche, history }; } })}</div></details>`).join('')}
        ${buildHomeGroupsHtml(options.immobilien || [], { summary, opened, view: options.homeView })}
        <div class="pv-asset-row pv-asset-total">${summary('total', 'Gesamtvermögen', '—', total)}</div>
        </div>${!tranchen.length ? buildEmptyTranchenHtml() : ''}`;
    if (container.dataset) container.dataset.profileId = options.profileId;
    const section = container.querySelector?.('.pv-history-detail');
    const host = container.querySelector?.('.pv-course-chart') || section;
    const region = host?.closest?.('.table-scroll') || container.querySelector?.('.table-scroll');
    if (host && detail) detailBindings.set(container, bindTrancheHistoryChart(host, detail.tranche, detail.history, { region, detail: section }));
    if (container.ownerDocument && container.querySelector?.('[data-split-hint]')) bindInfoPopovers(container.ownerDocument, { root: container });
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

/** @param {ReadonlyArray<ReturnType<typeof import('./tranche-reconciliation.js').projectReconciliationCashStatuses>[number]>} [statuses]
 * @param {{errorMessage?: string}} [options]
 */
export function buildReconciliationCashStatusesHtml(statuses = [], { errorMessage = '' } = {}) {
    if (errorMessage) {
        return `
            <p class="reconciliation-status ds-note ds-note-error" data-kind="error" role="alert"><strong>Cashstatus-Audit nicht lesbar – die Liste ist unvollständig.</strong><br>${escapeHtml(errorMessage)}</p>`;
    }
    if (!Array.isArray(statuses) || statuses.length === 0) {
        return `
            <p class="pv-sales-empty">Noch keine Verkäufe eingetragen.</p>`;
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
                <div><strong>Verkauf vom ${escapeHtml(status.executedAt || 'unbekannt')}${status.saleRecord?.source === 'spielwert' ? ' · Spielwert' : ''}:</strong> ${escapeHtml(status.trancheId || 'Tranche unbekannt')}</div>
                <div><strong>Zielverkauf:</strong> ${targetActionId}</div>
                <div><strong>Nettoerlös:</strong> ${net}\u00a0€ · <strong>bestätigter Cashstand:</strong> ${cashBalance}</div>
                <details class="pv-cash-evidence ds-technical-details"><summary>Exakte Beträge</summary><p>Nettoerlös: ${formatDisplayNumber(status.confirmedNetProceedsEur, { fractionDigits: 2 })} € · bestätigter Cashstand: ${status.cashBalanceAfterPostingEur === null ? '-' : `${formatDisplayNumber(status.cashBalanceAfterPostingEur, { fractionDigits: 2 })} €`}</p></details>
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

/** @param container
 * @param {ReadonlyArray<ReturnType<typeof import('./tranche-reconciliation.js').projectReconciliationCashStatuses>[number]>} [statuses]
 * @param {object} [options]
 */
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
        text('managerPersonInflowsSummary', '');
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
    // UR-1: Die Rentenanpassung steht bei der Rente, nicht mehr in der Kopfzeile.
    text('managerPersonSummary', `${dates?.identity || 'Geburtsdatum fehlt oder ist ungültig'}${v.careToday?.grade ? ` · Pflegegrad ${v.careToday.grade}` : ''} · ${(profile.currentIncome?.pensionStatus?.startsWith('Rente') ? profile.currentIncome.pensionStatus : profile.currentIncome?.status) || ''} · Kirchensteuer ${pct(v.kirchensteuerPct)} %`);
    text('managerPersonInflowsSummary', '');
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
    if (tax) tax.hidden = true; // FR-11: Altwert bleibt erhalten, ist aber keine Eingabe mehr.
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
