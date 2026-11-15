// VK-3 (FR-79 Punkt 9): Darstellung von „Tranche im Detail“ in `#trancheModal` (Entwurf T1). Nur DOM; Zahlen aus
// `tranche-detail-model.js`, Speichern bleibt beim vorhandenen Formular- bzw. Haushaltsschreiber.
import { flowNumber, euro, euroCent, flowDate, quoteDate } from './sale-flow-steps.js';
import { shownPrice } from './sale-flow-model.js';
import { annualActionAssetClass } from '../balance/annual-action-progress.js';
import { trancheDetailFigures, TQF_OPTIONS, tqfChoice, DETAIL_TAX_RATE, purchaseStockState } from './tranche-detail-model.js';

const byId = (/** @type {Document} */ doc, /** @type {string} */ id) => doc.getElementById(id);
const pct = (/** @type {number} */ value, digits = 1) => `${value >= 0 ? '+' : ''}${flowNumber(value * 100, digits)} %`;
/** Stückzahl wie in den Abläufen: bis drei Nachkommastellen, ganze Stück ohne Komma. @param {number} value */
export const exactShares = value => flowNumber(value, Number.isInteger(value) ? 0 : Math.min(3, (String(value).split('.')[1] || '').length || 0));

/** @param {Document} doc @param {string} tag @param {string} [className] @param {string} [text] */
function node(doc, tag, className = '', text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

/** Kurs abrufbar: Kürzel und ein gespeicherter Kurszeitpunkt (ohne Netzabfrage beim Öffnen). @param {any} tranche */
export const hasQuote = tranche => Boolean(String(tranche?.ticker || '').trim()) && Number.isFinite(Number(tranche?.asOf));

/** Kopf, Kennzahlen, Steuererklärung und Verlauf. @param {Document} doc
 * @param {{tranche: any, personName: string, history: any[], deletion: {allowed: boolean, reason: string, cancelBuy?: string|null}}} view */
export function renderTrancheDetail(doc, { tranche, personName, history, deletion }) {
    const assetClass = annualActionAssetClass(tranche);
    const eyebrow = byId(doc, 'trancheDetailEyebrow'); if (eyebrow) eyebrow.textContent = `Tranche · ${personName || 'Person'}`;
    const title = byId(doc, 'modalTitle'); if (title) title.textContent = tranche.name || 'Tranche';
    const names = { equity: Number(tranche.tqf) === 0.3 ? 'Aktienfonds' : Number(tranche.tqf) === 0.15 ? 'Mischfonds' : Number(tranche.tqf) === 0 ? 'Einzelaktie' : 'Aktien', bonds: 'Anleihen', gold: 'Gold', money_market: 'Geldmarkt' };
    const meta = byId(doc, 'trancheModalDescription');
    if (meta) meta.textContent = [names[assetClass] || 'Wertpapier', tranche.purchaseDate ? `gekauft am ${flowDate(tranche.purchaseDate)}` : ''].filter(Boolean).join(' · ');
    renderQuoteCheck(doc, hasQuote(tranche) ? { status: 'stored', price: tranche.currentPrice, asOf: tranche.asOf, symbol: tranche.ticker }
        : { status: 'none', price: tranche.currentPrice });
    renderTrancheDetailFigures(doc, tranche);
    renderHistory(doc, history);
    const remove = /** @type {HTMLButtonElement|null} */ (byId(doc, 'deleteTrancheDialogBtn')), reason = byId(doc, 'trancheDeleteReason');
    if (remove) {
        remove.hidden = false; remove.disabled = !deletion.allowed; remove.setAttribute('aria-describedby', 'trancheDeleteReason');
        // VK-3d P8: Hängt der eigene Kaufbeleg an der Tranche, ist der Weg ein Storno: „Kauf rückgängig …“.
        remove.textContent = /** @type {any} */ (deletion).cancelBuy ? 'Kauf rückgängig …' : 'Tranche löschen …';
    }
    if (reason) { reason.hidden = deletion.allowed; reason.textContent = deletion.reason; }
}

/** Kennzahlen und „So rechnet die Steuer“. VK-3d P5: Die Seite ruft das auch bei geänderter Teilfreistellung oder „Ganz steuerfrei“
 * vor dem Speichern auf (mit den gewählten Werten), damit Schätzung und Erklärung der Auswahl sofort folgen.
 * @param {Document} doc @param {any} tranche */
export function renderTrancheDetailFigures(doc, tranche) {
    const figures = trancheDetailFigures(tranche);
    const kpis = byId(doc, 'trancheDetailKpis');
    if (kpis) {
        kpis.hidden = false;
        kpis.replaceChildren();
        const items = [
            ['Stück', exactShares(figures.shares), '', 'shares'],
            ['Einstand', euro(figures.costBasis), `${euroCent(figures.purchasePrice)} je Stück`],
            ['Wert heute', euro(figures.marketValue), `${euroCent(shownPrice(figures.price))} je Stück`],
            ['Gewinn', `${figures.gain >= 0 ? '+' : '−'}${euro(Math.abs(figures.gain))}`, figures.gainPct === null ? '' : `${pct(figures.gainPct)} seit Kauf`],
            ['Steuer bei Verkauf', `≈ ${euro(figures.tax)}`, '', 'tax']
        ];
        for (const [label, value, detail, action] of items) {
            const tile = node(doc, 'div', 'ds-kpi');
            tile.append(node(doc, 'span', 'ds-field-reason', label), node(doc, 'span', 'ds-big-number', value));
            if (detail) tile.append(node(doc, 'span', 'ds-field-reason', detail));
            if (action) {
                const edit = node(doc, 'button', 'ds-button ds-mini-button', action === 'shares' ? 'ändern' : 'wie gerechnet?'); edit.setAttribute('type', 'button');
                if (action === 'shares') { edit.setAttribute('aria-label', 'Stückzahl ändern'); edit.dataset.trancheSharesEdit = ''; }
                else { edit.dataset.trancheTaxToggle = ''; edit.setAttribute('aria-controls', 'trancheTaxExplain'); edit.setAttribute('aria-expanded', String(byId(doc, 'trancheTaxExplain')?.hidden === false)); }
                tile.append(edit);
            }
            kpis.append(tile);
        }
    }
    const tax = byId(doc, 'trancheTaxText');
    const relief = figures.tqf === 0.3 ? 'Weil es ein Aktienfonds ist, bleiben 30 % davon steuerfrei.'
        : figures.tqf === 0.15 ? 'Weil es ein Mischfonds ist, bleiben 15 % davon steuerfrei.'
            : figures.tqf > 0 ? `Davon bleiben ${flowNumber(figures.tqf * 100)} % steuerfrei.` : 'Der Gewinn ist voll steuerpflichtig.';
    if (tax) tax.textContent = (figures.taxExempt ? 'Als ganz steuerfrei eingetragen: keine Steuer.'
            : figures.gain <= 0 ? 'Bei einem Verkauf heute entsteht kein Gewinn, also keine Steuer.'
                : `Der Gewinn beträgt ${euro(figures.gain)}. ${relief} Auf ${figures.tqf > 0 ? 'die übrigen' : 'diese'} ${euro(figures.gain * figures.taxableShare)} fallen rund ${flowNumber(DETAIL_TAX_RATE * 100, 1)} % Abgeltungsteuer mit Soli an, also etwa ${euro(figures.tax)}.`)
        + (tranche.type === 'aktien_alt' ? ' Gespeichert als Altbestand. Das ändert die Steuer in der App nicht; steuerfrei ist eine Tranche nur mit ‚Ganz steuerfrei‘.' : '');
    renderTrancheStockWarning(doc, tranche);
}

/** FR-83: Warnung unabhängig von Gewinn und Steuerfreiheit, ohne Änderung am gespeicherten Bestand.
 * @param {Document} doc @param {any} tranche */
function renderTrancheStockWarning(doc, tranche) {
    const stock = purchaseStockState(tranche), warning = byId(doc, 'trancheStockWarning');
    if (!warning) return;
    warning.hidden = !stock.mismatch;
    const text = byId(doc, 'trancheStockWarningText');
    if (text) text.textContent = stock.mismatch
        ? `Bestand passt nicht zum Kaufdatum: gespeichert ist ${stock.type === 'aktien_alt' ? 'Altbestand' : 'Neubestand'}, gekauft am ${flowDate(tranche.purchaseDate)} spricht für ${stock.expected === 'aktien_alt' ? 'Altbestand' : 'Neubestand'}.` : '';
}

/** Verlauf, neueste oben (Nachtrag 1: auch Käufe aus `buy_reconciled`). @param {Document} doc @param {any[]} history */
function renderHistory(doc, history) {
    const list = byId(doc, 'trancheHistoryList');
    if (!list) return;
    const entries = history.map(row => {
        const item = node(doc, 'li'); item.dataset.kind = row.kind; item.dataset.trancheHistory = row.kind;
        const head = node(doc, 'div', 'pv-detail-entry-head');
        head.append(node(doc, 'strong', '', row.kind === 'sale' ? 'Verkauf' : row.kind === 'correction' ? 'Korrektur' : 'Kauf'), node(doc, 'span', 'ds-source', flowDate(row.date) || 'Kaufdatum fehlt'));
        const line = row.kind === 'sale' ? `${exactShares(row.shares)} Stück × ${euroCent(row.price)} · Gutschrift ${euroCent(row.amount)}`
            : row.kind === 'correction' ? `Stückzahl von ${exactShares(row.sharesBefore)} auf ${exactShares(row.shares)}, ${row.reason === 'split' ? `Aktiensplit · ${euroCent(row.price)} je Stück` : 'laut Depotauszug'}`
                : row.shares === null ? `${euroCent(row.price)} je Stück` : `${exactShares(row.shares)} Stück × ${euroCent(row.price)}`;
        item.append(head, node(doc, 'span', '', line));
        const notes = [row.plan ? `aus dem Plan ${row.plan}` : '', row.kind === 'buy' && row.amount !== null ? `Einstand ${euro(row.amount)}` : '',
            row.cash === 'confirmed' ? (row.kind === 'sale' ? 'Gutschrift auf dem Tagesgeld bestätigt' : 'Abbuchung bestätigt')
                : row.cash === 'pending' ? (row.kind === 'sale' ? 'Gutschrift noch nicht eingetragen' : 'Abbuchung noch nicht eingetragen') : ''].filter(Boolean);
        if (notes.length) item.append(node(doc, 'small', '', notes.join(' · ')));
        if (row.legacyCorrectionAt) item.append(node(doc, 'small', '', `Stückzahl vor der Korrektur am ${flowDate(row.legacyCorrectionAt)} nicht gespeichert`));
        return item;
    });
    const buy = history.findIndex(row => row.kind === 'buy');
    if (history.length <= 4 || buy < 0) { list.replaceChildren(...entries); return; }
    const rest = entries.filter((_, index) => index !== buy);
    const toggleRow = node(doc, 'li'), toggle = node(doc, 'button', 'ds-button ds-mini-button');
    toggle.setAttribute('type', 'button');
    toggleRow.append(toggle);
    let expanded = false;
    const draw = () => {
        toggle.textContent = expanded ? 'Verlauf verkürzen' : `alle ${history.length} Einträge zeigen`;
        toggle.setAttribute('aria-expanded', String(expanded));
        list.replaceChildren(...rest.slice(0, 3), toggleRow, ...(expanded ? rest.slice(3) : []), entries[buy]);
    };
    toggle.addEventListener('click', () => { expanded = !expanded; draw(); });
    draw();
}

/** Teilfreistellung als Auswahl; nur bei Anlageform Aktien (Nachtrag 1), sonst 0 % fest. Ein gespeicherter anderer Wert erscheint als
 * „eigener Wert … %“ und bleibt, bis der Nutzer wählt. @param {Document} doc @param {string} category @param {unknown} stored @param {() => void} onChange */
export function renderTqfChoices(doc, category, stored, onChange) {
    const host = byId(doc, 'trancheTqfChoices'), fixed = byId(doc, 'trancheTqfFixed');
    const field = /** @type {HTMLInputElement|null} */ (byId(doc, 'tqf'));
    if (!host || !field) return;
    host.replaceChildren();
    const equity = category === 'equity';
    host.hidden = !equity;
    for (const id of ['trancheTqfLabel', 'trancheTqfReason']) {
        const element = byId(doc, id); if (element) element.hidden = !equity;
    }
    if (fixed) fixed.hidden = equity || /** @type {HTMLInputElement|null} */ (byId(doc, 'taxExempt'))?.checked === true;
    if (!equity) { field.value = '0'; return; }
    const choice = tqfChoice(stored);
    const options = [...(choice.custom ? [[choice.value, `eigener Wert ${flowNumber(choice.value * 100, 2).replace(/,00$/, '')} %`]] : []), ...TQF_OPTIONS];
    field.value = String(choice.value);
    const select = /** @type {HTMLSelectElement} */ (node(doc, 'select', 'ds-select'));
    select.id = 'trancheTqfSelect';
    for (const [value, text] of options) {
        const option = /** @type {HTMLOptionElement} */ (node(doc, 'option', '', /** @type {string} */ (text)));
        option.value = String(value); option.selected = Math.abs(Number(value) - choice.value) < 1e-9;
        option.dataset.trancheTqf = String(value); select.append(option);
    }
    select.value = String(choice.value);
    select.addEventListener('change', () => { field.value = select.value; onChange(); });
    host.append(select);
}

/** Kursprüfung zeigt nur den Abrufstand; sie verändert keinen gespeicherten Kurs.
 * @param {Document} doc @param {{status: string, symbol?: string, exchange?: string, price?: number, asOf?: number|string|null}} result */
export function renderQuoteCheck(doc, result) {
    const text = byId(doc, 'trancheQuoteText');
    if (!text) return;
    const date = quoteDate(result.asOf ?? null);
    text.textContent = result.status === 'pending' ? ' · Kurs wird geprüft …'
        : ['ok', 'stored', 'stale'].includes(result.status) ? ` · Kurs ${euroCent(shownPrice(Number(result.price)))}${date ? ` vom ${flowDate(date)}` : ''}${result.status === 'stale' ? ' (älter als 7 Tage)' : ''}`
            : result.status === 'currency' ? ' · Kursdienst liefert keine Eurokurse'
                : ` · ${Number(result.price) > 0 ? `Kurs ${euroCent(Number(result.price))} · ` : ''}kein Kursabruf für ${result.symbol || 'dieses Kürzel'}`;
    const reason = byId(doc, 'trancheTickerReason');
    if (reason) reason.textContent = `Damit holt die App den Kurs. ${date ? `Zuletzt geholt am ${flowDate(date)}.` : 'Noch kein Abrufdatum.'}`;
}
