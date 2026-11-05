import { propertyParts, wealthDetail, wealthMoney, optionalWealthVisible } from '../shared/wealth-display.js';
/**
 * Module: Simulator Portfolio Display
 * Purpose: Updating the UI display for portfolio status.
 *          Handles formatting of currency values and breakdown panels.
 * Usage: Called by simulator-portfolio.js facade.
 * Dependencies: simulator-utils.js, depot-tranchen-status.js, simulator-portfolio-inputs.js, simulator-portfolio-format.js
 */
"use strict";

import { formatCurrency } from './simulator-utils.js';
import { calculateAggregatedValues, getTranchenStatus } from '../tranches/depot-tranchen-status.js';
import { readBasePortfolioInputs, readStrategyInputs, readDecumulationInputs } from './simulator-input-strategy.js';
import { readTrancheInputs } from './simulator-input-tranches.js';
import { formatDisplayNumber } from './simulator-portfolio-format.js';
import { setFieldState } from '../shared/field-state.js';

let hasLoggedTranchenDisplay = false;
let displayedHomes = [];
const formatPlainInteger = (value) => Number.isFinite(value) ? String(Math.round(value)) : '0';
const trancheAdapters = new WeakMap();

// Der gemeinsame Writer behält Refresh, Sync und sämtliche Warntexte.
// Nur sein Hauptblock wird nach jedem Refresh aus strukturierten Daten projiziert.
/**
 * @param container
 * @param [status]
 * @returns {void}
 */
export function compactSimulatorTrancheStatus(container, status = getTranchenStatus()) {
    if (!container?.querySelector) return;
    const block = /** @type {HTMLElement} */ (container.querySelector('[data-tranchen-state]'));
    if (!block || block.dataset.simulatorCompact === 'true') return;
    const notices = [.../** @type {NodeListOf<HTMLElement>} */ (block.querySelectorAll('.tranchen-warning, .ds-note'))];
    // Cashbestätigung/Legacyhinweise ohne ds-note bleiben ebenfalls erhalten.
    const cashNotice = /** @type {HTMLElement[]} */ ([...block.children]).find(child => /Cashrückstand|Cashstatus|Cashbuchung/.test(child.textContent) && !notices.includes(child));
    if (cashNotice) notices.push(cashNotice);
    const messages = notices.map(node => ({ text: node.textContent.trim().replace(/[⚠ℹ✅]\uFE0F?/gu, '').trim(), error: node.getAttribute('role') === 'alert' }));
    const titles = { not_loaded: 'Keine detaillierten Tranchen geladen. Nutze das vereinfachte Alt/Neu-Modell.',
        empty: 'Tranchenbestand ist leer.', error: 'Tranchenbestand ist fehlerhaft. Kein Alt/Neu-Fallback.' };
    block.replaceChildren();
    block.removeAttribute('style');
    block.className = status.state === 'error' ? 'sim-tranche-status ds-note ds-note-error' : 'sim-tranche-status ds-note';
    if (status.state === 'error') block.setAttribute('role', 'alert');
    block.dataset.simulatorCompact = 'true';
    const summary = container.ownerDocument.createElement('span');
    summary.textContent = status.state === 'valid'
        ? `${status.count} Tranchen · Marktwert ${formatCurrency(status.totalValue)} · Einstand ${formatCurrency(status.totalCost)}`
        : titles[status.state] ?? titles.error;
    block.appendChild(summary);
    messages.forEach(({ text, error }) => {
        const notice = container.ownerDocument.createElement('span');
        notice.className = 'sim-tranche-warning'; notice.textContent = text;
        if (error) notice.setAttribute('role', 'alert');
        block.appendChild(notice);
    });
}

/**
 * @param [doc] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function initializeSimulatorTrancheAdapter(doc = globalThis.document) {
    const container = doc?.getElementById('tranchenStatusBadge');
    if (!container || trancheAdapters.has(container)) return;
    compactSimulatorTrancheStatus(container);
    const Observer = doc.defaultView?.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => {
        observer.disconnect();
        compactSimulatorTrancheStatus(container);
        observer.observe(container, { childList: true, subtree: true });
    });
    observer.observe(container, { childList: true, subtree: true });
    trancheAdapters.set(container, observer);
}

/**
 * Aktualisiert die Anzeige des Start-Portfolios
 *
 * @param {object} [options]
 * @returns {void}
 */
export function updateStartPortfolioDisplay(options = {}) {
    if (options.homes) displayedHomes = options.homes;
    // Vermögensanzeige benötigt keine rechenfähigen Personendaten.
    const inputs = { ...readBasePortfolioInputs(), ...readStrategyInputs(), ...readDecumulationInputs(), ...readTrancheInputs() };
    const aggregated = (inputs.detailledTranches && Array.isArray(inputs.detailledTranches) && inputs.detailledTranches.length)
        ? calculateAggregatedValues()
        : null;
    const useAggregates = aggregated && (
        aggregated.depotwertAlt > 0 ||
        aggregated.depotwertNeu > 0 ||
        aggregated.geldmarktEtf > 0 ||
        aggregated.goldWert > 0
    );

    if (useAggregates && !hasLoggedTranchenDisplay) {
        hasLoggedTranchenDisplay = true;
    }

    let displayDepotwertAlt = 0;
    let displayDepotwertNeu = 0;
    let displayGoldWert = 0;
    let displayGeldmarkt = 0;
    let displayTagesgeld = 0;
    let depotwertNeu = 0;
    let zielwertGold = 0;

    if (useAggregates) {
        // Prefer tranche aggregates to avoid rounding drift from form inputs.
        displayDepotwertAlt = aggregated.depotwertAlt || 0;
        displayDepotwertNeu = aggregated.depotwertNeu || 0;
        displayGoldWert = aggregated.goldWert || 0;
        displayGeldmarkt = aggregated.geldmarktEtf || 0;
        displayTagesgeld = inputs.tagesgeld || 0;
    } else {
        // Derive portfolio split from cash + target gold allocation.
        const startLiquiditaet = (inputs.tagesgeld || 0) + (inputs.geldmarktEtf || 0);
        const flexiblesVermoegen = Math.max(0, inputs.startVermoegen - inputs.depotwertAlt);
        const investitionsKapitalNeu = Math.max(0, flexiblesVermoegen - startLiquiditaet);
        const investitionsKapitalGesamt = inputs.depotwertAlt + investitionsKapitalNeu;
        zielwertGold = inputs.goldAktiv ? investitionsKapitalGesamt * (inputs.goldZielProzent / 100) : 0;
        depotwertNeu = Math.max(0, investitionsKapitalNeu - zielwertGold);

        displayDepotwertAlt = inputs.depotwertAlt;
        displayDepotwertNeu = depotwertNeu;
        displayGoldWert = zielwertGold;
        displayGeldmarkt = inputs.geldmarktEtf || 0;
        displayTagesgeld = inputs.tagesgeld || 0;
    }

    // Keep the "start wealth" field aligned with the computed breakdown.
    const derivedStartVermoegen = displayDepotwertAlt + displayDepotwertNeu + displayGoldWert + displayTagesgeld + displayGeldmarkt;
    const startField = /** @type {HTMLInputElement} */ (document.getElementById('simStartVermoegen'));
    if (startField) {
        startField.value = formatDisplayNumber(derivedStartVermoegen);
    }

    const showGoldPanel = inputs.goldAktiv || (useAggregates && displayGoldWert > 0);

    const einstandNeuField = /** @type {HTMLInputElement} */ (document.getElementById('einstandNeu'));
    if (einstandNeuField) {
        einstandNeuField.value = /** @type {string} */ (useAggregates
            ? Math.round(aggregated.costBasisNeu || 0)
            : formatPlainInteger(depotwertNeu));
    }

    const depotwertGesamtField = /** @type {HTMLInputElement} */ (document.getElementById('depotwertGesamt'));
    if (depotwertGesamtField) {
        depotwertGesamtField.value = formatDisplayNumber(displayDepotwertAlt + displayDepotwertNeu);
    }
    const goldWertField = /** @type {HTMLInputElement} */ (document.getElementById('goldWert'));
    if (goldWertField) {
        goldWertField.value = formatDisplayNumber(displayGoldWert);
    }

    const displayBondsWert = useAggregates && aggregated.bondsWert > 0 ? aggregated.bondsWert : 0;
    const initialBondBucketField = /** @type {HTMLInputElement} */ (document.getElementById('initialBondBucket'));
    if (initialBondBucketField) initialBondBucketField.value = formatCurrency(displayBondsWert);
    renderSimulatorPortfolioTiles(document, inputs, { money: derivedStartVermoegen + displayBondsWert,
        gold: displayGoldWert, bonds: displayBondsWert });
    for (const field of [startField, depotwertGesamtField, goldWertField, initialBondBucketField]) {
        if (field?.ownerDocument && field.parentNode) {
            setFieldState(field, 'adopted', useAggregates
                ? 'Aus dem aggregierten Tranchenbestand des Profilverbunds abgeleitet.'
                : 'Aus den übernommenen Portfolioangaben und der Zielallokation abgeleitet.');
        }
    }

    // Render a quick visual split for user validation.
    const homes = propertyParts([{ values: { immobilien: displayedHomes } }]);
    const allocation = [displayDepotwertAlt + displayDepotwertNeu, displayGoldWert, displayTagesgeld + displayGeldmarkt, displayBondsWert, ...(homes.present ? [homes.self, homes.rented] : [])];
    const labels = ['Depot', 'Gold', 'Liquidität', 'Anleihen', ...(homes.present ? ['Immobilien selbst genutzt', 'Immobilien vermietet'] : [])];
    const colors = [0, 1, 2, 5, 3, 4];
    const total = allocation.reduce((sum, value) => sum + value, 0);
    const shares = allocation.map(value => total > 0 && Number.isFinite(total) ? value / total * 100 : null);
    let breakdownHtml = `
        <p class="sim-allocation-title">Gesamtvermögen zu Beginn</p><div class="sim-start-total"><strong>${wealthMoney(total)}</strong>${homes.present ? `<small class="sim-money-detail">${wealthDetail(total - homes.total, homes)}</small>` : ''}</div>
        <div class="sim-allocation-bar" aria-hidden="true">${shares.map((share, index) => share === null ? '' : `<span class="sim-allocation-${colors[index]}" style="width:${share}%"></span>`).join('')}</div>
        <div class="sim-allocation-legend">${shares.map((share, index) => allocation[index] > 0 ? `<span><i class="sim-allocation-${colors[index]}" aria-hidden="true"></i>${labels[index]} ${share === null ? '—' : `${Math.round(share).toLocaleString('de-DE')} %`}</span>` : '').join('')}</div>
        <div class="sim-field-grid sim-allocation-values" ${homes.present ? '' : 'hidden'}><div class="ds-field"><label>Immobilien selbst genutzt</label><span class="calculated-display ds-metric">${wealthMoney(homes.self)}</span></div><div class="ds-field"><label>Immobilien vermietet</label><span class="calculated-display ds-metric">${wealthMoney(homes.rented)}</span></div></div>`;
    document.getElementById('displayPortfolioBreakdown').innerHTML = breakdownHtml;
    const goldPanel = document.getElementById('goldStrategyPanel');
    if (goldPanel) {
        goldPanel.style.display = showGoldPanel ? 'block' : 'none';
    }
}

/** Anzeige bleibt von den bisherigen Recheneingaben getrennt, auch beim Anleihenbestand.
 *
 * @param doc Zugehöriges Simulatordokument.
 * @param inputs Wirksame Simulationseingaben.
 * @param values
 * @returns {void}
 */
export function renderSimulatorPortfolioTiles(doc, inputs, values) {
    const set = (id, text) => { const node = doc.getElementById(id); if (node) node.textContent = text; };
    const show = (id, visible) => { const node = doc.getElementById(id); if (node) node.hidden = !visible; };
    set('simMoneyWealth', formatDisplayNumber(values.money));
    set('simBondWealth', formatDisplayNumber(values.bonds));
    show('simGoldTile', optionalWealthVisible(inputs.goldAktiv, values.gold));
    const activeBonds = inputs.decumulation?.mode === '3_bucket_jilge';
    show('simBondTile', optionalWealthVisible(activeBonds, values.bonds));
    show('simPortfolioParameters', activeBonds);
}
