// FR-79: Inhalte der Schritte des geführten Verkaufs. Nur Darstellung mit den Bausteinen des Designsystems;
// Zahlen kommen aus `sale-flow-model.js`, Zustand und Speichern aus `sale-flow-dialog.js`.
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { trancheLabel, trancheTypeName, settleSale, restQuestionAmount, shownPrice, bankOrderTranches, allocateBankOrder, estimatePartsTax, saleStartTrancheId } from './sale-flow-model.js';
import { readDecimalInput, readMoneyText } from './tranchen-manager-decimal-input.js';
import { BANK_ORDER_DATE_MISSING_HINT } from '../../types/sale-fifo.js';

/** @param {number} value @param {number} [digits] */
export const flowNumber = (value, digits = 0) => formatDisplayNumber(value, { fractionDigits: digits, minimumFractionDigits: digits });
/** Ganze Euro (Plan, Vorschlag). @param {number|null|undefined} value */
export const euro = value => Number.isFinite(value) ? `${flowNumber(Math.round(/** @type {number} */ (value)))} €` : '—';
/** Euro mit Cent (Abrechnung, Kontostand, Fehlbeträge). @param {number|null|undefined} value */
export const euroCent = value => Number.isFinite(value) ? `${flowNumber(/** @type {number} */ (value), 2)} €` : '—';
/** VK-3d P6: Steuern einer Abrechnung im Satz; eine Erstattung (negativer Steuerbetrag) als „Erstattung +… €“. @param {number} taxes @param {string} minus */
const taxPart = (taxes, minus) => taxes < 0 ? `· Erstattung +${euroCent(-taxes)}` : `${minus} ${euroCent(taxes)} Steuern`;
/** @param {string|null|undefined} value JJJJ-MM-TT @param {boolean} [short] */
export const flowDate = (value, short = false) => /^\d{4}-\d{2}-\d{2}/.test(value || '')
    ? (short ? String(value).slice(5, 10).split('-').reverse().join('.') + '.' : String(value).slice(0, 10).split('-').reverse().join('.')) : '';
/** Kursdatum einer Tranche (Sekunden oder Datum). @param {unknown} asOf */
export function quoteDate(asOf) {
    if (typeof asOf === 'number' && Number.isFinite(asOf)) {
        const date = new Date(asOf * 1000);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    return typeof asOf === 'string' ? asOf.slice(0, 10) : '';
}
const clean = (/** @type {unknown} */ raw) => String(raw ?? '').trim().replace(/[\s\u00a0€]/g, '');
/** Eurobetrag (Gebühren, Steuern, Gutschrift, Tagesgeld) wie die übrigen Betragsfelder der App: „92.014“ → 92014, „92.014,80“ → 92014,8
 * (Gutachten VK-1 P2-2). Leer oder ungültig ergibt NaN. @param {unknown} raw */
export const parseMoney = raw => readMoneyText(clean(raw));
/** Kurs wie die Kursfelder: Punkt oder Komma als Dezimalzeichen („144.38“ → 144,38). @param {unknown} raw */
export const parseQuantity = raw => { const text = clean(raw); return text ? readDecimalInput(text) : NaN; };
/** Stückzahl (TRG-1b, P3-11) wie die Betragsfelder: Punkte vor genau drei Ziffern ohne Komma sind Tausenderpunkte („1.245“ → 1245,
 * „1.245,935“ → 1245,935), sonst Dezimalzeichen („12.5“ → 12,5). @param {unknown} raw */
export const parseShares = raw => { const text = clean(raw); return text ? readMoneyText(text) : NaN; };
/** Plan-Summe aus den angezeigten Zeilen (ganze Euro je Zeile, Ergänzung 2 FR-78): Kopfzeile und Zeile „Zusammen“ zeigen dieselbe Zahl.
 * @param {{planNet: number}[]} lines */
export const shownPlanTotal = lines => lines.reduce((sum, line) => sum + Math.round(line.planNet), 0);
/** Namen verbinden: „Max“, „Max und Erika“, „Max, Erika und Jan“. @param {string[]} names */
export const joinNames = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`;

/** VN-1 Punkt 9: Ein Betragsfeld zeigt nach dem Verlassen zwei Nachkommastellen („350“ → „350,00“); Ungültiges bleibt stehen.
 * @param {HTMLInputElement} node */
export function formatMoneyField(node) {
    const value = parseMoney(node.value);
    if (Number.isFinite(value)) node.value = flowNumber(value, 2);
}
/** VN-4 Nachtrag 1 (N2, Nutzer: „Tagesgeld mit Cent ist unsinnig“): Ein Tagesgeld-Kontostand zeigt ganze Euro mit Tausenderpunkt.
 * Eine Eingabe mit Komma bleibt erlaubt und behält ihre Stellen („16.785,1“). @param {HTMLInputElement} node */
export function formatCashField(node) {
    const value = parseMoney(node.value);
    if (Number.isFinite(value)) node.value = formatDisplayNumber(value, { fractionDigits: 2, minimumFractionDigits: 0 });
}
/** Tagesgeld-Kontostand als Vorschlag: ganze Euro (N2). @param {number} value */
export const wholeCash = value => Math.round(value);
/** DS-1 Punkt 4: Wertpapierkurs nach dem Verlassen mit mindestens zwei, höchstens vier Nachkommastellen („144,5“ → „144,50“). @param {HTMLInputElement} node */
export function formatPriceField(node) {
    const value = parseQuantity(node.value);
    // Mehr als vier Nachkommastellen bleiben unverändert stehen; die App rundet keinen eingetragenen Kurs.
    if (Number.isFinite(value) && Math.abs(Math.round(value * 1e4) / 1e4 - value) < 1e-9) node.value = value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
}
/** VN-3 (Codex F05): Kurstext wie nach dem Verlassen – zwei bis vier Nachkommastellen, mehr Stellen bleiben ungerundet stehen.
 * So zeigt das Feld beim Neuaufbau denselben Wert, mit dem die App rechnet. @param {number} value */
export const priceFieldText = value => value.toLocaleString('de-DE', { minimumFractionDigits: 2,
    maximumFractionDigits: Math.abs(Math.round(value * 1e4) / 1e4 - value) < 1e-9 ? 4 : 10, useGrouping: false });
/** DS-1 Punkt 4: Stückzahl nach dem Verlassen mit höchstens drei Nachkommastellen. @param {HTMLInputElement} node */
export function formatSharesField(node) {
    const value = parseShares(node.value);
    // Mehr als drei Nachkommastellen (etwa aus einem Sparplan) bleiben unverändert stehen; die App rundet keine Stückzahl.
    if (Number.isFinite(value) && Math.abs(Math.round(value * 1000) / 1000 - value) < 1e-9) node.value = formatDisplayNumber(value, { fractionDigits: 3, minimumFractionDigits: 0 });
}
/** Formatierung eines Abrechnungsfelds nach dem Verlassen je Feldart (DS-1 Punkt 4). @param {HTMLInputElement} node @param {string} name */
export function formatFlowField(node, name) {
    if (name === 'price') formatPriceField(node);
    else if (name === 'shares') formatSharesField(node);
    else if (['fees', 'taxes', 'credit'].includes(name)) formatMoneyField(node);
}
/** VN-1 Punkt 9 / DS-1 Punkt 4: Eingabefeld im Einheitenrahmen des Designsystems (`ds-unit-frame`). @param {Document} doc @param {HTMLInputElement} field @param {string} [unit] */
export const unitFrame = (doc, field, unit = '€') => el(doc, 'span', `ds-unit-frame sale-flow-unit ${unit === '€' ? 'sale-flow-money' : 'sale-flow-count-unit'}`, [field, el(doc, 'span', '', unit)]);
/** VN-1 Punkt 9: Eingabefeld im €-Rahmen des Designsystems (`ds-unit-frame`). @param {Document} doc @param {HTMLInputElement} field */
export const euroFrame = (doc, field) => unitFrame(doc, field, '€');

/** @param {Document} doc @param {string} tag @param {string} [className] @param {string|Node|(string|Node)[]} [content] */
export function el(doc, tag, className, content) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    for (const child of content === undefined ? [] : Array.isArray(content) ? content : [content]) {
        node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return node;
}
/** @param {Document} doc @param {string} label @param {string} [className] */
export function button(doc, label, className = 'ds-button ds-button-secondary') {
    const node = /** @type {HTMLButtonElement} */ (el(doc, 'button', className, label)); node.type = 'button'; return node;
}
/** Statuschip wie in „Was zu tun ist“. @param {Document} doc @param {string} text @param {'success'|'warning'|''} [tone] */
export const chip = (doc, text, tone = '') => el(doc, 'span', `ds-plan-chip sale-flow-chip${tone ? ` ds-chip-${tone}` : ''}`, text);

/** Personenwahl als Segment. @param {Document} doc @param {{id: string, label: string, done?: boolean}[]} items @param {string} current @param {(id: string)=>void} onSelect */
export function personSegment(doc, items, current, onSelect) {
    const segment = el(doc, 'div', 'ds-segment sale-flow-segment');
    segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Person');
    for (const item of items) {
        const node = button(doc, `${item.done ? '✓ ' : ''}${item.label}`, item.done ? 'sale-flow-segment-done' : '');
        node.setAttribute('aria-pressed', String(item.id === current)); node.dataset.saleFlowPerson = item.id;
        node.addEventListener('click', () => onSelect(item.id));
        segment.append(node);
    }
    return segment;
}

/** Zeilenstand im Überblick. @param {any} line */
export function lineStateText(line) {
    if (line.keptInDepot) return 'erledigt · Rest bleibt im Depot';
    if (line.status === 'erledigt') return 'erledigt';
    if (line.status === 'teilweise') return `teilweise · ${euro(line.restNet)} offen`;
    return 'offen';
}

/** Schritt 1 „Überblick“ (Entwurf V1). @param {Document} doc @param {{lines: any[], decidedOn: string, quoteDate: string, play: boolean, people: {id: string, name: string}[]}} view */
export function overviewStep(doc, view) {
    const root = el(doc, 'div', 'sale-flow-columns sale-flow-columns-wide'); root.dataset.saleFlowOverview = '';
    const main = el(doc, 'div', 'sale-flow-stack');
    main.append(el(doc, 'h3', 'sale-flow-title', 'Was der Plan verkauft'),
        el(doc, 'p', 'ds-source sale-flow-lead', `Beschlossen im Jahresabschluss am ${view.decidedOn} · Kurse vom ${flowDate(view.quoteDate)}${view.play ? ' (Spielkurse)' : ''}`));
    const box = el(doc, 'div', 'ds-table-box sale-flow-table-box');
    const table = el(doc, 'table', 'ds-table sale-flow-table'); table.setAttribute('aria-label', 'Was der Plan verkauft');
    const head = el(doc, 'tr');
    for (const [text, numeric] of /** @type {[string, boolean][]} */ ([['Wer', false], ['Wertpapier', false], ['Plan netto', true], ['Vorschlag', true], ['Stand', false]])) {
        const cell = el(doc, 'th', numeric ? 'ds-num' : '', text); cell.setAttribute('scope', 'col'); head.append(cell);
    }
    table.append(el(doc, 'thead', '', head));
    const body = el(doc, 'tbody');
    for (const line of view.lines) {
        const row = el(doc, 'tr'); row.dataset.saleFlowLine = line.key;
        const security = el(doc, 'td', '', [line.security.name,
            el(doc, 'small', 'sale-flow-sub', [line.security.typeName, line.security.isin ? `ISIN ${line.security.isin}` : '', line.security.ticker].filter(Boolean).join(' · ')),
            ...(Number.isFinite(line.security.shares) ? [el(doc, 'small', 'sale-flow-sub', `Bestand ${flowNumber(line.security.shares, 3)} Stück`)] : [])]);
        const plan = el(doc, 'td', 'ds-num', [euro(line.planNet), el(doc, 'small', 'sale-flow-sub', line.planTax >= 0.5 ? `Steuer ca. ${euro(line.planTax)}` : 'Steuer 0 €')]);
        const suggestion = line.status === 'erledigt' ? el(doc, 'td', 'ds-num', '—') : el(doc, 'td', 'ds-num', [el(doc, 'strong', '', `${flowNumber(line.suggestion.shares)} Stück`),
            el(doc, 'small', 'sale-flow-sub', `× ${euroCent(line.price)} ≈ ${euro(line.suggestion.gross)}`)]);
        row.append(el(doc, 'td', 'sale-flow-who', line.name), security, plan, suggestion, el(doc, 'td', 'sale-flow-state', lineStateText(line)));
        body.append(row);
    }
    const planNet = shownPlanTotal(view.lines);
    const gross = view.lines.reduce((sum, line) => sum + (line.status === 'erledigt' ? 0 : Math.round(line.suggestion.gross)), 0);
    const total = el(doc, 'tr', 'sale-flow-total');
    const label = el(doc, 'td', '', 'Zusammen'); label.setAttribute('colspan', '2');
    total.append(label, el(doc, 'td', 'ds-num', euro(planNet)), el(doc, 'td', 'ds-num sale-flow-sub-cell', gross ? `brutto ≈ ${euro(gross)}` : ''), el(doc, 'td'));
    body.append(total); table.append(body); box.append(table); main.append(box);
    const why = el(doc, 'div', 'sale-flow-why');
    const types = [...new Set(view.lines.map(line => line.security.typeName))];
    const choice = view.lines.some(line => line.tranches.filter((/** @type {any} */ item) => item.category === 'equity' && item.shares > 0).length > 1);
    if (choice && types.length === 1 && ['Neubestand', 'Altbestand'].includes(types[0])) {
        const other = types[0] === 'Neubestand' ? 'Altbestand' : 'Neubestand';
        why.append(el(doc, 'p', '', [el(doc, 'strong', '', `Warum der ${types[0]}?`),
            ` Der Plan verkauft je Wertpapier die ältesten Stücke zuerst, sonst die Tranche, die je Euro am wenigsten Steuer kostet. Beim ${types[0]} ist der Gewinnanteil kleiner als beim ${other}.`]));
    }
    const open = view.lines.filter(line => line.status !== 'erledigt');
    if (open.length) why.append(el(doc, 'p', '', [el(doc, 'strong', '', `Warum ${joinNames(open.map(line => flowNumber(line.suggestion.shares)))} Stück?`),
        ' Plan brutto plus 1 % Puffer, geteilt durch den letzten Kurs, aufgerundet. So reicht der Erlös auch, wenn der Kurs bis zur Ausführung etwas fällt.']));
    for (const line of open.filter(item => item.bank.differs)) why.append(el(doc, 'p', '', bankText(line)));
    // FR-82: Ohne Kaufdatum zählt eine Tranche als älteste; die Bank kann anders sortieren.
    if (open.some(line => line.bank.guessed)) why.append(el(doc, 'p', 'ds-source', `${BANK_ORDER_DATE_MISSING_HINT}.`));
    if (why.children.length) main.append(why);
    const side = el(doc, 'div', 'sale-flow-stack');
    side.append(el(doc, 'h3', 'sale-flow-title', 'So gehst du vor'));
    const list = el(doc, 'ol', 'sale-flow-howto');
    for (const [number, title, text] of [['2', 'Verkaufen', 'Je Person eine Order bei deiner Bank. Der Merkzettel nennt Depot, Wertpapier, ISIN und Stück.'],
        ['3', 'Abrechnung eintragen', 'Wenn die Bank ausgeführt hat: Stück, Kurs, Gebühren und Steuern von der Abrechnung übernehmen.'],
        ['4', 'Gutschrift bestätigen', 'Sobald das Geld auf dem Tagesgeld ist. Die App bucht nichts selbst.'],
        ['5', 'Geld verteilen', 'Tagesgeld bis zum Ziel auffüllen, den Rest in den Geldmarkt-ETF.']]) {
        list.append(el(doc, 'li', '', [el(doc, 'span', 'sale-flow-howto-number', number), el(doc, 'span', '', [el(doc, 'strong', '', title), el(doc, 'span', 'sale-flow-howto-text', text)])]));
    }
    side.append(list, el(doc, 'p', 'sale-flow-accent', 'Du kannst jederzeit aufhören. Die Karte „Was zu tun ist“ zeigt, wo du stehst, und bringt dich zum nächsten Schritt zurück.'),
        // VN-1 Punkt 4: Die Zeilen der Karte stehen jetzt auch auf den Euro; gerundet ist nur ihre Hauptzeile („ca.“).
        el(doc, 'p', 'ds-source', 'Beträge hier genau auf den Euro, wie in „Details & Drucken“ und in den Zeilen der Karte „Was zu tun ist“.'));
    root.append(main, side);
    return root;
}

/** Satz zur Bankreihenfolge (Ergänzung 1 FR-79 Punkt 1). @param {any} line */
export function bankText(line) {
    return `Die Bank verkauft zuerst die ältesten Stücke: Steuer ca. ${euro(line.bank.tax)} statt ${euro(line.bank.planTax)}, dafür ${flowNumber(line.suggestion.shares)} Stück statt ${flowNumber(line.bank.planShares)}.`;
}

/** Tranche in Klartext mit Kaufdatum, damit gleiche Wertpapiere unterscheidbar sind (VN-1 Punkte 2 und 12). @param {any} tranche */
export const trancheChoiceText = tranche => `${trancheLabel(tranche, flowNumber)} · ${tranche.purchaseDate ? `gekauft am ${flowDate(tranche.purchaseDate)}` : 'ohne Kaufdatum'}`;

/** VN-1 Punkt 2: Verkauf ohne Planbezug – sichtbare Wahl der Tranche, ohne Vorwahl, solange keine vorgegeben ist.
 * Bei genau einer verkaufbaren Tranche steht nur ihr Name. @param {Document} doc @param {any} line @param {(trancheId: string) => void} onChoose */
export function trancheChoice(doc, line, onChoose) {
    const box = el(doc, 'section', 'sale-flow-stack sale-flow-tranche-choice'); box.dataset.saleFlowTrancheChoice = '';
    if (line.tranches.length === 1) {
        box.append(el(doc, 'p', 'ds-source', ['Verkauft wird ', el(doc, 'strong', '', trancheChoiceText(line.tranches[0])), '.']));
        return box;
    }
    box.append(el(doc, 'h3', 'sale-flow-title', 'Welche Tranche verkaufst du?'));
    // VN-2 P2 (Gutachten 2.1): Der Hinweis bleibt im Baum und wird nach der Wahl nur ausgeblendet, damit das Patchen an Ort und Stelle
    // dieselben Knoten vergleicht und der Fokus auf der gewählten Tranche bleibt.
    const hint = el(doc, 'p', 'ds-source', 'Wähl die Tranche, die deine Bank verkauft. Erst dann gibt es Merkzettel und Abrechnung.');
    hint.hidden = Boolean(line.tranche); box.append(hint);
    const list = el(doc, 'div', 'sale-flow-choices'); list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-label', 'Tranche');
    for (const item of line.tranches) {
        const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = 'saleFlowFreeTranche'; radio.value = item.trancheId;
        radio.checked = item.trancheId === line.tranche?.trancheId; radio.dataset.saleFlowTrancheOption = item.trancheId;
        radio.addEventListener('change', () => onChoose(item.trancheId));
        list.append(el(doc, 'label', `sale-flow-choice${radio.checked ? ' sale-flow-choice-selected' : ''}`, [radio, el(doc, 'span', '', [
            el(doc, 'strong', '', `${item.name || 'Wertpapier'} · ${trancheTypeName(item)}`),
            el(doc, 'span', 'sale-flow-choice-text', [item.isin ? `ISIN ${item.isin}` : '', `Bestand ${flowNumber(item.shares, 3)} Stück`,
                item.purchaseDate ? `gekauft am ${flowDate(item.purchaseDate)}` : 'ohne Kaufdatum'].filter(Boolean).join(' · '))])]));
    }
    box.append(list);
    return box;
}

/** Schritt 2 „Verkaufen“ (Entwurf V2). Ohne Plan (`plan: false`) kein Vergleich mit dem Plan (VK-3d P6).
 * @param {Document} doc @param {any} line @param {{draft: any, number: number, count: number, quoteDate: string, onChange: (draft: any)=>void, onPrint: ()=>void, tranches: any[], plan?: boolean}} options */
export function sellStep(doc, line, { draft, number, count, quoteDate: date, onChange, onPrint, tranches, plan = true }) {
    const root = el(doc, 'div', 'sale-flow-columns'); root.dataset.saleFlowSell = line.key;
    const shares = draft.shares ?? line.suggestion.shares;
    const tranche = tranches.find(item => item.trancheId === draft.trancheId) || line.tranche;
    const memo = el(doc, 'section', 'sale-flow-memo'); memo.dataset.saleFlowMemo = '';
    const print = button(doc, 'Drucken'); print.addEventListener('click', onPrint);
    memo.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'h3', 'sale-flow-title', 'Merkzettel für deine Bank'), print]));
    const list = el(doc, 'dl', 'sale-flow-memo-rows');
    const copy = (/** @type {string} */ text) => {
        const node = button(doc, 'Kopieren', 'ds-button ds-button-secondary sale-flow-copy');
        // VN-1 Punkt 1: Der Text steht am Knopf, weil der Knopf bei einer Eingabe bleibt und nur seine Attribute neu bekommt.
        node.dataset.copy = text;
        node.addEventListener('click', () => { void globalThis.navigator?.clipboard?.writeText?.(node.dataset.copy || '')?.catch?.(() => {}); });
        return node;
    };
    const row = (/** @type {string} */ term, /** @type {string|Node} */ value, /** @type {Node|null} */ action = null, /** @type {string} */ className = '') => {
        list.append(el(doc, 'div', `sale-flow-memo-row ${className}`.trim(), [el(doc, 'dt', '', term), el(doc, 'dd', '', value), ...(action ? [action] : [])]));
    };
    row('Depot', line.name);
    row('Auftrag', el(doc, 'strong', '', 'Verkaufen'));
    row('Wertpapier', el(doc, 'span', '', [tranche?.name || line.security.name, el(doc, 'span', 'sale-flow-sub-inline', ` · ${tranche ? trancheLabel({ type: tranche.type }, flowNumber).replace(/^Wertpapier · /, '') : line.security.typeName}`)]));
    row('ISIN', el(doc, 'span', 'sale-flow-isin', tranche?.isin || line.security.isin || '—'), tranche?.isin ? copy(tranche.isin) : null);
    row('Kürzel', tranche?.ticker || line.security.ticker || '—');
    row('Stück', el(doc, 'span', 'sale-flow-shares', flowNumber(shares)), copy(String(shares)), 'sale-flow-memo-shares');
    row('Ordertyp', 'deine Wahl bei der Bank, bestens oder mit Limit');
    memo.append(list);
    if (line.bank.differs) memo.append(el(doc, 'p', 'ds-source sale-flow-memo-note', bankText(line)));
    if (line.bank.guessed) memo.append(el(doc, 'p', 'ds-source sale-flow-memo-note', `${BANK_ORDER_DATE_MISSING_HINT}.`));
    const side = el(doc, 'div', 'sale-flow-stack');
    // Gutachten VK-1 P3-01: „Anders verkaufen“ rechnet mit Stückzahl und Tranche aus dem Merkzettel, in Bankreihenfolge.
    const changed = shares !== line.suggestion.shares || (tranche?.trancheId ?? null) !== saleStartTrancheId(line);
    const own = changed && tranche ? allocateBankOrder(bankOrderTranches(tranches, tranche), shares) : null;
    const taxes = own ? estimatePartsTax(own.parts, line.price, line.churchTax || 0) : line.suggestion.taxes;
    const settle = settleSale({ shares, price: line.price, fees: 0, taxes });
    const estimate = el(doc, 'section', 'sale-flow-panel'); estimate.dataset.saleFlowEstimate = '';
    estimate.append(el(doc, 'p', 'sale-flow-panel-head', [el(doc, 'strong', '', 'Was dabei herauskommt'), el(doc, 'span', 'ds-source', ` · geschätzt mit ${euroCent(line.price)} vom ${flowDate(date, true)}`)]));
    const rows = el(doc, 'dl', 'sale-flow-sum');
    const sum = (/** @type {string|Node} */ term, /** @type {string} */ value, /** @type {string} */ className = '') => rows.append(el(doc, 'div', `sale-flow-sum-row ${className}`.trim(), [el(doc, 'dt', '', term), el(doc, 'dd', '', value)]));
    sum(`${flowNumber(shares)} Stück × ${euroCent(line.price)}`, euroCent(settle.gross));
    sum('– Gebühren', 'laut Bank');
    sum(el(doc, 'span', '', ['– Steuern', el(doc, 'span', 'sale-flow-sub-inline', own ? ' (Bankreihenfolge, ohne Sparerpauschbetrag)' : taxes < 0.005 ? ' (Sparerpauschbetrag reicht)' : line.bank.differs ? ' (Bankreihenfolge)' : ' (laut Plan)')]), euroCent(taxes));
    sum('≈ Gutschrift', euroCent(settle.net), 'sale-flow-sum-total');
    estimate.append(rows);
    const reached = settle.net >= line.restNet - 0.5;
    if (plan) estimate.append(el(doc, 'p', 'sale-flow-verdict', [chip(doc, reached ? 'Plan erreicht' : 'weniger als geplant', reached ? 'success' : 'warning'),
        ` Plan ${euro(line.restNet)} netto${reached ? ` · Puffer ${euro(settle.net - line.restNet)} für Gebühren und Kurs` : ''}`]));
    const other = /** @type {HTMLDetailsElement} */ (el(doc, 'details', 'sale-flow-details'));
    other.open = Boolean(draft.otherOpen);
    other.addEventListener('toggle', () => { draft.otherOpen = other.open; });
    other.append(el(doc, 'summary', '', 'Anders verkaufen'));
    const fields = el(doc, 'div', 'sale-flow-fields');
    const count$ = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); count$.inputMode = 'decimal'; count$.value = String(shares).replace('.', ','); count$.id = `saleFlowShares-${line.key}`;
    count$.addEventListener('change', () => { const value = parseShares(count$.value); onChange(Object.assign(draft, { shares: value > 0 ? value : null })); });
    const select = /** @type {HTMLSelectElement} */ (el(doc, 'select', 'ds-select')); select.id = `saleFlowTranche-${line.key}`;
    for (const item of tranches.filter(entry => entry.shares > 0)) {
        // VN-1 Punkt 12: mit Kaufdatum, damit gleiche ETFs unterscheidbar sind.
        const option = /** @type {HTMLOptionElement} */ (el(doc, 'option', '', trancheChoiceText(item))); option.value = item.trancheId;
        option.selected = item.trancheId === (tranche?.trancheId); select.append(option);
    }
    select.addEventListener('change', () => onChange(Object.assign(draft, { trancheId: select.value })));
    // VN-1 Punkt 2: Ohne Plan steht die Wahl der Tranche oben im Schritt.
    fields.append(el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'Stückzahl'), count$]), ...(plan ? [el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'Tranche'), select])] : []));
    other.append(fields, el(doc, 'p', 'ds-source', plan ? 'Nichts davon wird gespeichert. Die Abrechnung im nächsten Schritt übernimmt Stückzahl und Tranche als Vorschlag.'
        : 'Nichts davon wird gespeichert. Die Abrechnung im nächsten Schritt übernimmt die Stückzahl als Vorschlag.'));
    side.append(estimate, other);
    root.append(memo, side);
    return root;
}

/** Schritt 3 „Abrechnung“ (Entwurf V3, V3b). `scope` ist Planjahr und Beschlusstag (Hinweis zum Ausführungstag). @param {Document} doc @param {any} line
 * @param {{draft: any, plan: boolean, onChange: (draft: any, rerender?: boolean)=>void, onKeepRevoke?: ()=>void, onAnother?: ()=>void, tranches: any[],
 * scope?: {year: number, decidedOn?: string|null}|null}} options */
export function settleStep(doc, line, { draft, plan, onChange, onKeepRevoke, onAnother, tranches, scope = null }) {
    const root = el(doc, 'div', 'sale-flow-columns'); root.dataset.saleFlowSettle = line.key;
    if (line.status === 'erledigt' && !draft.another) {
        const done = el(doc, 'section', 'sale-flow-panel'); done.dataset.saleFlowSettled = '';
        done.append(el(doc, 'h3', 'sale-flow-title', `${line.name}: eingetragen`));
        for (const sale of line.sales) done.append(el(doc, 'p', '', `${flowDate(sale.executedAt)} · ${flowNumber(sale.shares, 3)} Stück · Kurswert ${euroCent(sale.gross)} − ${euroCent(sale.fees)} Gebühren ${taxPart(sale.taxes, '−')} = ${euroCent(sale.net)}`));
        if (line.keptInDepot) {
            done.append(el(doc, 'p', '', [chip(doc, 'Erledigt · Rest bleibt im Depot', 'success'), ` ${euroCent(line.planNet - line.soldNet)} bleiben im Depot.${line.keptReason ? ` Warum: ${line.keptReason}` : ''}`]));
            const revoke = button(doc, 'Rest doch verkaufen'); revoke.dataset.saleFlowRevoke = line.key; revoke.addEventListener('click', () => onKeepRevoke?.()); done.append(revoke);
        } else {
            const another = button(doc, 'Weitere Abrechnung zu dieser Zeile'); another.addEventListener('click', () => onAnother?.()); done.append(another);
        }
        root.append(done);
        return root;
    }
    const tranche = tranches.find(item => item.trancheId === draft.trancheId) || line.tranche;
    const form = el(doc, 'section', 'sale-flow-panel sale-flow-form'); form.dataset.saleFlowForm = '';
    form.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'h3', 'sale-flow-title', 'Abrechnung deiner Bank'), el(doc, 'span', 'ds-source', 'gestrichelt = aus dem Vorschlag übernommen')]));
    const input = (/** @type {string} */ name, /** @type {string} */ value, /** @type {boolean} */ adopted = false) => {
        const node = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-input')); node.inputMode = 'decimal'; node.value = value; node.dataset.saleFlowField = name;
        node.id = `saleFlow-${name}-${line.key}`;
        if (adopted) node.dataset.saleFlowAdopted = '';
        node.addEventListener('input', () => { delete node.dataset.saleFlowAdopted; onChange(Object.assign(draft, { [name]: node.value, [`${name}Edited`]: true }), false); });
        node.addEventListener('change', () => { formatFlowField(node, name); onChange(Object.assign(draft, { [name]: node.value, [`${name}Edited`]: true }), true); });
        return node;
    };
    /** VN-1 Punkt 9: Betragsfelder im €-Rahmen wie die übrigen. @param {string} name @param {string} value */
    const money = (name, value) => euroFrame(doc, input(name, value));
    const shares = draft.sharesEdited ? parseShares(draft.shares) : (draft.shares ?? line.suggestion.shares);
    const price = parseQuantity(draft.price), fees = parseMoney(draft.fees), taxes = parseMoney(draft.taxes), credit = parseMoney(draft.credit);
    const result = settleSale({ shares, price, fees: Number.isFinite(fees) ? fees : 0, taxes: Number.isFinite(taxes) ? taxes : 0, credit, fromCredit: Boolean(draft.fromCredit) });
    const grid = el(doc, 'div', 'sale-flow-settle-grid');
    const date = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-date')); date.type = 'date'; date.value = draft.executedAt; date.id = `saleFlow-date-${line.key}`;
    date.addEventListener('change', () => onChange(Object.assign(draft, { executedAt: date.value }), true));
    const dateCell = el(doc, 'div', 'sale-flow-settle-value', date);
    // Gutachten VK-1 P3-8: Ein Tag vor dem Beschluss oder in einem anderen Jahr zählt nicht zum Plan; Hinweis vor dem Speichern.
    if (scope && draft.executedAt && (String(draft.executedAt).slice(0, 4) !== String(scope.year) || scope.decidedOn && draft.executedAt < scope.decidedOn)) {
        const note = el(doc, 'p', 'ds-note ds-note-warning sale-flow-date-note', `Dieser Tag zählt nicht zum Plan ${scope.year}${scope.decidedOn && String(draft.executedAt).slice(0, 4) === String(scope.year) ? ` (beschlossen am ${flowDate(scope.decidedOn)})` : ''}. Die Zeile bleibt dann offen.`);
        note.dataset.saleFlowDateNote = ''; dateCell.append(note);
    }
    grid.append(el(doc, 'label', 'sale-flow-label', 'Ausführungstag'), dateCell);
    const sharesInput = input('shares', draft.sharesEdited ? String(draft.shares ?? '') : String(shares).replace('.', ','), !draft.sharesEdited);
    const priceInput = input('price', draft.price ?? '');
    grid.append(el(doc, 'label', 'sale-flow-label', 'Verkauft'), el(doc, 'div', 'sale-flow-settle-value sale-flow-trade', [unitFrame(doc, sharesInput, 'Stück'), el(doc, 'span', 'ds-source', '×'), euroFrame(doc, priceInput), el(doc, 'span', 'ds-source', '='),
        el(doc, 'strong', 'sale-flow-gross', euroCent(result.gross))]));
    grid.append(el(doc, 'label', 'sale-flow-label', '– Gebühren'), el(doc, 'span', 'ds-source', 'Provision, Börsenentgelt'), money('fees', draft.fees ?? ''));
    const taxField = draft.fromCredit ? el(doc, 'strong', 'sale-flow-computed', euroCent(result.taxes)) : money('taxes', draft.taxes ?? '');
    grid.append(el(doc, 'label', 'sale-flow-label', '– Steuern'), el(doc, 'span', 'ds-source', draft.fromCredit ? 'Rest aus Kurswert, Gebühren und Gutschrift' : 'Kapitalertragsteuer, Soli, Kirchensteuer zusammen; Erstattung negativ'), taxField);
    form.append(grid);
    const total = el(doc, 'div', 'sale-flow-credit-row');
    total.append(el(doc, 'strong', '', '= Gutschrift'), el(doc, 'span', 'ds-source', draft.fromCredit ? 'aus deiner Abrechnung' : 'muss zur Abrechnung passen'),
        draft.fromCredit ? money('credit', draft.credit ?? '') : el(doc, 'span', 'sale-flow-credit', euroCent(result.net)));
    form.append(total);
    const toggle = button(doc, draft.fromCredit ? 'Steuern selbst eintragen' : 'Gutschrift eintragen, die App rechnet die Steuern als Rest.', 'sale-flow-link');
    toggle.addEventListener('click', () => onChange(Object.assign(draft, { fromCredit: !draft.fromCredit }), true));
    form.append(el(doc, 'p', 'ds-source sale-flow-toggle', [draft.fromCredit ? 'Lieber Steuern eintragen? ' : 'Nennt deine Abrechnung nur die Gutschrift? ', toggle]));
    const more = /** @type {HTMLDetailsElement} */ (el(doc, 'details', 'sale-flow-details')); more.open = Boolean(draft.moreOpen);
    more.addEventListener('toggle', () => { draft.moreOpen = more.open; });
    const order = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); order.value = draft.orderNo || ''; order.id = `saleFlow-order-${line.key}`; order.maxLength = 64;
    order.addEventListener('input', () => onChange(Object.assign(draft, { orderNo: order.value }), false));
    more.append(el(doc, 'summary', '', 'Weitere Angaben'), el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'Ordernummer (freiwillig)'), order]),
        el(doc, 'p', 'ds-source', 'Mit derselben Ordernummer trägt die App eine Abrechnung nicht doppelt ein.'));
    form.append(more);
    const side = el(doc, 'div', 'sale-flow-stack');
    if (plan) {
        const compare = el(doc, 'section', 'sale-flow-panel'); compare.dataset.saleFlowCompare = '';
        compare.append(el(doc, 'p', 'sale-flow-panel-head', el(doc, 'strong', '', 'Verglichen mit dem Plan')));
        const table = el(doc, 'table', 'sale-flow-compare');
        const head = el(doc, 'tr', '', [el(doc, 'th'), el(doc, 'th', 'ds-num', 'Plan'), el(doc, 'th', 'ds-num', 'Abrechnung')]);
        table.append(el(doc, 'thead', '', head));
        const body = el(doc, 'tbody');
        const has = Number.isFinite(result.net);
        body.append(el(doc, 'tr', '', [el(doc, 'td', '', 'Stück'), el(doc, 'td', 'ds-num', flowNumber(line.suggestion.shares)), el(doc, 'td', 'ds-num', Number.isFinite(shares) ? flowNumber(shares, Number.isInteger(shares) ? 0 : 3) : '—')]));
        if (line.planTax >= 0.5 || line.suggestion.taxes >= 0.5) body.append(el(doc, 'tr', '', [el(doc, 'td', '', 'Steuern'), el(doc, 'td', 'ds-num', `ca. ${euro(line.suggestion.taxes)}`), el(doc, 'td', 'ds-num', has ? euroCent(result.taxes) : '—')]));
        body.append(el(doc, 'tr', 'sale-flow-compare-total', [el(doc, 'td', '', 'Netto'), el(doc, 'td', 'ds-num', euro(line.restNet)), el(doc, 'td', 'ds-num', has ? euroCent(result.net) : '—')]));
        table.append(body); compare.append(table);
        if (has) {
            const diff = result.net - line.restNet;
            compare.append(el(doc, 'p', 'sale-flow-verdict', diff >= -0.5 ? [chip(doc, 'Plan erreicht', 'success'), ` ${euro(diff)} mehr als geplant`]
                : [chip(doc, 'weniger als geplant', 'warning'), ` ${euroCent(-diff)} fehlen zum Plan`]));
        }
        side.append(compare);
        const rest = has ? restQuestionAmount(line, result.net) : null;
        if (rest !== null) side.append(restQuestion(doc, rest, draft, onChange));
    }
    if (!plan || !(Number.isFinite(result.net) && restQuestionAmount(line, result.net) !== null)) {
        const depot = el(doc, 'section', 'sale-flow-panel'); depot.dataset.saleFlowDepot = '';
        const quote = shownPrice(tranche?.currentPrice);
        depot.append(el(doc, 'p', 'sale-flow-panel-head', el(doc, 'strong', '', `So ändert sich ${line.name.endsWith('s') ? `${line.name}’` : `${line.name}s`} Depot`)));
        const rows = el(doc, 'dl', 'sale-flow-sum');
        // Gutachten VK-1 P3-1: je betroffener Tranche eine Zeile aus derselben Aufteilung, die gespeichert wird (Bankreihenfolge).
        const parts = Number.isFinite(shares) && shares > 0 && tranche ? allocateBankOrder(bankOrderTranches(tranches, tranche), shares).parts : [];
        const typeName = (/** @type {any} */ item) => trancheLabel({ type: item.type }, flowNumber).replace(/^Wertpapier · /, '');
        const dated = parts.length > 1;
        if (!parts.length) rows.append(el(doc, 'div', 'sale-flow-sum-row', [el(doc, 'dt', '', `${tranche ? typeName(tranche) : 'Bestand'}, Stück`), el(doc, 'dd', '', '—')]));
        for (const part of parts) {
            const after = Math.max(0, part.tranche.shares - part.shares);
            const row = el(doc, 'div', 'sale-flow-sum-row', [el(doc, 'dt', '', `${typeName(part.tranche)}${dated && part.tranche.purchaseDate ? ` vom ${flowDate(part.tranche.purchaseDate)}` : ''}, Stück`),
                el(doc, 'dd', '', [`${flowNumber(part.tranche.shares, 3)} → `, el(doc, 'strong', '', flowNumber(after, 3))])]);
            row.dataset.saleFlowDepotTranche = part.tranche.trancheId; rows.append(row);
        }
        const before = parts.reduce((sum, part) => sum + part.tranche.shares, 0), sold = parts.reduce((sum, part) => sum + part.shares, 0);
        rows.append(el(doc, 'div', 'sale-flow-sum-row', [el(doc, 'dt', '', `Wert zum Kurs ${euroCent(quote)}`),
            el(doc, 'dd', '', !parts.length ? '—' : [`${euro(before * quote)} → `, el(doc, 'strong', '', euro((before - sold) * quote))])]));
        depot.append(rows, el(doc, 'p', 'ds-source', plan ? 'Das Tagesgeld ändert sich erst im nächsten Schritt.' : 'Das Tagesgeld bestätigst du im nächsten Schritt.'));
        side.append(depot);
    }
    side.append(el(doc, 'p', 'ds-source', plan ? 'Erst „Verkauf eintragen“ ändert das Depot. Bis dahin kannst du alles ändern oder abbrechen, ohne dass etwas gespeichert wird.'
        : 'Erst „Verkauf eintragen“ im nächsten Schritt ändert Depot und Tagesgeld. Bis dahin wird nichts gespeichert.'));
    root.append(form, side);
    return root;
}

/** Rest-Frage (Entwurf V3b, FR-79 Punkt 11). @param {Document} doc @param {number} rest @param {any} draft @param {(draft: any, rerender?: boolean)=>void} onChange */
function restQuestion(doc, rest, draft, onChange) {
    const box = el(doc, 'fieldset', 'sale-flow-question'); box.dataset.saleFlowRestQuestion = '';
    box.append(el(doc, 'legend', 'sale-flow-title', `Was passiert mit dem Rest von ${euroCent(rest)}?`));
    const option = (/** @type {string} */ value, /** @type {string} */ title, /** @type {string} */ text) => {
        const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = 'saleFlowRest'; radio.value = value;
        radio.checked = (draft.restDecision || 'sell') === value; radio.dataset.saleFlowRest = value;
        radio.addEventListener('change', () => onChange(Object.assign(draft, { restDecision: value }), true));
        return el(doc, 'label', `sale-flow-choice${radio.checked ? ' sale-flow-choice-selected' : ''}`, [radio, el(doc, 'span', '', [el(doc, 'strong', '', title), el(doc, 'span', 'sale-flow-choice-text', text)])]);
    };
    box.append(option('keep', 'Bleibt im Depot – so entschieden', 'Die App erinnert nicht mehr daran. Im Plan steht „Erledigt · Rest bleibt im Depot“.'),
        option('sell', 'Verkaufe ich noch', 'Die Zeile bleibt „teilweise“, „Was zu tun ist“ nennt den Rest.'));
    if (draft.restDecision === 'keep') {
        const reason = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); reason.value = draft.reason || ''; reason.maxLength = 200; reason.dataset.saleFlowReason = '';
        reason.addEventListener('input', () => onChange(Object.assign(draft, { reason: reason.value }), false));
        box.append(el(doc, 'label', 'ds-field', [el(doc, 'span', '', ['Warum? ', el(doc, 'span', 'ds-source', '(freiwillig, steht im Jahresbeleg)')]), reason]),
            el(doc, 'p', 'ds-source', 'Später änderbar: In „Was zu tun ist“ steht bei der Zeile „Rest doch verkaufen“.'));
    }
    return box;
}

/** Schritt 4 „Gutschrift“ (Entwurf V4). @param {Document} doc
 * @param {{people: {profileId: string, name: string, sales: any[], pending: boolean, cash: number|null, cashError: string|null}[], drafts: Record<string, any>, onChange: (id: string, draft: any, rerender?: boolean)=>void}} view */
export function creditStep(doc, { people, drafts, onChange }) {
    const root = el(doc, 'div', 'sale-flow-stack'); root.dataset.saleFlowCredit = '';
    root.append(el(doc, 'h3', 'sale-flow-title', 'Ist das Geld schon auf dem Tagesgeld?'),
        el(doc, 'p', 'ds-source sale-flow-lead', 'Die Bank schreibt den Erlös in der Regel nach ein bis zwei Bankarbeitstagen gut. Die App bucht nichts selbst – du bestätigst, was dein Konto zeigt.'));
    if (!people.length) { root.append(el(doc, 'p', 'ds-note', 'Noch keine Abrechnung eingetragen. Die Gutschrift folgt nach Schritt 3.')); return root; }
    const cards = el(doc, 'div', 'sale-flow-cards');
    for (const person of people) {
        const draft = drafts[person.profileId] || {};
        const card = el(doc, 'section', 'sale-flow-panel sale-flow-person'); card.dataset.saleFlowCreditPerson = person.profileId;
        // Gutachten VK-1 P2-1: Anzeige und Vorschlag zählen nur Verkäufe mit offener Gutschrift; bestätigte stecken schon im Tagesgeld.
        const shown = person.pending ? person.sales.filter(sale => sale.creditPending !== false) : person.sales;
        const credit = shown.reduce((sum, sale) => sum + sale.net, 0);
        card.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'h4', 'sale-flow-person-name', person.name),
            chip(doc, person.pending ? (draft.choice === 'now' ? 'wird bestätigt' : 'kommt noch') : 'bestätigt', person.pending ? 'warning' : 'success')]));
        const dates = [...new Set(shown.map(sale => flowDate(sale.executedAt, true)))].join(', ');
        card.append(el(doc, 'div', 'sale-flow-credit-row', [el(doc, 'span', '', `Gutschrift laut Abrechnung vom ${dates}`), el(doc, 'span', 'sale-flow-credit', euroCent(credit))]));
        for (const sale of shown) card.append(el(doc, 'p', 'ds-source', `${flowNumber(sale.shares, Number.isInteger(sale.shares) ? 0 : 3)} Stück × ${euroCent(sale.gross / sale.shares)} – ${euroCent(sale.fees)} Gebühren ${taxPart(sale.taxes, '–')}`));
        if (person.pending) {
            const choices = el(doc, 'div', 'sale-flow-choices');
            for (const [value, title, text] of [['now', 'Schon da', 'Ich trage den Kontostand ein.'], ['later', 'Kommt noch', 'Die App erinnert mich.']]) {
                const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = `saleFlowCredit-${person.profileId}`; radio.value = value;
                radio.checked = (draft.choice || 'later') === value; radio.dataset.saleFlowCreditChoice = value;
                radio.addEventListener('change', () => onChange(person.profileId, Object.assign(draft, { choice: value }), true));
                choices.append(el(doc, 'label', `sale-flow-choice${radio.checked ? ' sale-flow-choice-selected' : ''}`, [radio, el(doc, 'span', '', [el(doc, 'strong', '', title), el(doc, 'span', 'sale-flow-choice-text', text)])]));
            }
            card.append(choices);
            if (draft.choice === 'now') {
                const proposal = Number.isFinite(person.cash) ? wholeCash(/** @type {number} */ (person.cash) + credit) : null;
                const field = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-input')); field.inputMode = 'decimal'; field.dataset.saleFlowCash = person.profileId;
                field.value = draft.cash ?? (proposal === null ? '' : flowNumber(proposal));
                if (draft.cash === undefined) field.dataset.saleFlowAdopted = '';
                field.addEventListener('input', () => { delete field.dataset.saleFlowAdopted; onChange(person.profileId, Object.assign(draft, { cash: field.value }), false); });
                // VN-4 Punkt 7 / Nachtrag 1 N2: Kontostand nach dem Verlassen mit Tausenderpunkt in ganzen Euro, ohne Neuaufbau.
                field.addEventListener('change', () => { if (field.dataset.saleFlowAdopted === undefined) { formatCashField(field); draft.cash = field.value; } });
                card.append(el(doc, 'div', 'sale-flow-cash-row', [el(doc, 'label', '', [el(doc, 'span', '', `Tagesgeld ${person.name} jetzt`),
                    el(doc, 'small', 'ds-source', Number.isFinite(person.cash) ? `Vorschlag: ${euro(person.cash)} + Gutschrift` : person.cashError || 'Tagesgeld-Stand fehlt')]), el(doc, 'span', 'ds-unit-frame sale-flow-unit', [field, el(doc, 'span', '', '€')])]),
                el(doc, 'p', 'ds-source', 'Liegt der Erlös noch auf dem Verrechnungskonto deiner Bank, überweise ihn zuerst aufs Tagesgeld.'));
            } else {
                card.append(el(doc, 'p', 'sale-flow-warn', `Bis die Gutschrift eingetragen ist, zeigt die App ${person.name.endsWith('s') ? `${person.name}’` : `${person.name}s`} Vermögen um ${euroCent(credit)} zu niedrig. In der Balance steht „Gutschrift nachtragen“, und dieser Schritt bleibt offen.`));
            }
        }
        cards.append(card);
    }
    root.append(cards);
    return root;
}

/** Schritt 5 „Geld verteilen“ (Entwurf V5, Ergänzung 1 Punkt 2). Die Tabelle zeigt nur Personen mit Gutschrift; das Tagesgeld vorher zählt alle.
 * @param {Document} doc
 * @param {{distribution: any, moneyMarket: Record<string, any>, months: number, pending: Set<string>, kept: boolean, buyHref: (row: any)=>string|null, onKeepCash: (keep: boolean)=>void,
 * onBuy?: ((row: any) => void)|null}} view */
export function distributeStep(doc, { distribution, moneyMarket, months, pending, kept, buyHref, onKeepCash, onBuy = null }) {
    const root = el(doc, 'div', 'sale-flow-stack'); root.dataset.saleFlowDistribute = '';
    const head = el(doc, 'div', 'sale-flow-distribute-head');
    head.append(el(doc, 'div', '', [el(doc, 'h3', 'sale-flow-title', 'Wohin das Geld geht'),
        el(doc, 'p', 'ds-source sale-flow-lead', `Tagesgeld bis zum Ziel auffüllen, der Rest in den Geldmarkt-ETF. Das Ziel: ${months} Monate Entnahme, ${euro(distribution.cashAfter >= distribution.cashBefore + distribution.gap - 0.5 ? distribution.cashBefore + distribution.gap : distribution.cashAfter)}.`)]),
    el(doc, 'div', 'sale-flow-kpi', [el(doc, 'span', 'ds-source', 'Gutschriften zusammen'), el(doc, 'strong', 'sale-flow-kpi-value', euroCent(distribution.credits))]));
    root.append(head);
    const bar = el(doc, 'div', 'sale-flow-bar'); bar.setAttribute('role', 'img');
    const share = distribution.credits > 0 ? distribution.toCash / distribution.credits * 100 : 0;
    bar.setAttribute('aria-label', `${Math.round(share)} Prozent aufs Tagesgeld`);
    const cash = el(doc, 'i', 'sale-flow-bar-cash'); cash.style.width = `${share}%`;
    const market = el(doc, 'i', 'sale-flow-bar-market'); market.style.width = `${100 - share}%`;
    bar.append(cash, market);
    root.append(bar, el(doc, 'div', 'sale-flow-legend', [el(doc, 'span', 'sale-flow-legend-cash', ['Aufs Tagesgeld ', el(doc, 'strong', '', euroCent(distribution.toCash)),
        ` · vor den Gutschriften ${euro(distribution.cashBefore)}, danach ${euro(distribution.cashAfter)}`]),
    el(doc, 'span', 'sale-flow-legend-market', ['In den Geldmarkt ', el(doc, 'strong', '', euroCent(distribution.toMoneyMarket))])]));
    const box = el(doc, 'div', 'ds-table-box sale-flow-table-box');
    const table = el(doc, 'table', 'ds-table sale-flow-table'); table.setAttribute('aria-label', 'Verteilung je Person');
    const headRow = el(doc, 'tr');
    for (const [text, numeric] of /** @type {[string, boolean][]} */ ([['Wer', false], ['Gutschrift', true], ['Bleibt auf dem Tagesgeld', true], ['In den Geldmarkt', true], ['Nächster Schritt', false]])) {
        const cell = el(doc, 'th', numeric ? 'ds-num' : '', text); cell.setAttribute('scope', 'col'); headRow.append(cell);
    }
    table.append(el(doc, 'thead', '', headRow));
    const body = el(doc, 'tbody');
    const sellers = distribution.rows.filter((/** @type {any} */ row) => row.credit > 0.004);
    for (const row of sellers) {
        const mm = moneyMarket[row.profileId];
        const waiting = pending.has(row.profileId);
        const next = el(doc, 'td', 'sale-flow-next');
        if (kept) next.append(el(doc, 'span', 'ds-source', 'bleibt auf dem Tagesgeld'));
        else if (waiting) next.append(el(doc, 'span', 'ds-source', 'nach der Gutschrift'));
        else if (mm?.due) {
            // Je Bereich eine Hauptaktion: die Käufe in der Tabelle sind sekundär, „Verkauf abschließen“ bleibt dunkel.
            const href = onBuy ? null : buyHref(row);
            if (onBuy) {
                // VK-2: „Geldmarkt kaufen“ öffnet den geführten Kauf mit Person, Geldmarkt-ETF und Betrag.
                const action = button(doc, 'Geldmarkt kaufen'); action.dataset.saleFlowBuy = row.profileId; action.addEventListener('click', () => onBuy(row)); next.append(action);
            } else if (href) {
                const link = el(doc, 'a', 'ds-button ds-button-secondary', 'Geldmarkt kaufen'); link.setAttribute('href', href); link.setAttribute('data-profile-handoff', '');
                link.dataset.saleFlowBuy = row.profileId; next.append(link);
            } else next.append(el(doc, 'span', 'ds-source', 'Kauf unter Personen & Vermögen eintragen'));
        } else next.append(el(doc, 'span', 'ds-source', row.toMoneyMarket >= 0.5 ? 'gekauft' : 'nichts zu kaufen'));
        const stueck = mm?.tranche && mm.price > 0 ? ` ≈ ${flowNumber(Math.floor(row.toMoneyMarket / mm.price))} Stück × ${euroCent(mm.price)}` : '';
        body.append(el(doc, 'tr', '', [el(doc, 'td', 'sale-flow-who', row.name),
            el(doc, 'td', 'ds-num', [euroCent(row.credit), el(doc, 'small', waiting ? 'sale-flow-sub sale-flow-sub-warn' : 'sale-flow-sub sale-flow-sub-good', waiting ? 'kommt noch' : 'auf dem Tagesgeld')]),
            el(doc, 'td', 'ds-num', [euroCent(row.toCash), el(doc, 'small', 'sale-flow-sub', row.toCash >= 0.005 ? `Tagesgeld danach ${euro(row.cashAfter)}` : `Tagesgeld bleibt ${euro(row.cashBefore)}`)]),
            el(doc, 'td', 'ds-num', [el(doc, 'strong', '', euroCent(row.toMoneyMarket)), el(doc, 'small', 'sale-flow-sub', stueck.trim())]), next]));
    }
    const total = el(doc, 'tr', 'sale-flow-total');
    total.append(el(doc, 'td', '', 'Zusammen'), el(doc, 'td', 'ds-num', euroCent(distribution.credits)), el(doc, 'td', 'ds-num', euroCent(distribution.toCash)),
        el(doc, 'td', 'ds-num', euroCent(distribution.toMoneyMarket)), el(doc, 'td'));
    body.append(total); table.append(body); box.append(table); root.append(box);
    const notes = el(doc, 'div', 'sale-flow-columns');
    // Gutachten VK-1 P2-05: je Person ihr eigener Geldmarkt-ETF, nie die ISIN des Partners als Vorlage.
    const etf = el(doc, 'div', 'sale-flow-why');
    for (const row of sellers.filter((/** @type {any} */ item) => item.toMoneyMarket >= 0.5)) {
        const mm = moneyMarket[row.profileId], who = sellers.length > 1 ? `${row.name}: ` : '';
        etf.append(el(doc, 'p', '', mm?.tranche ? [el(doc, 'strong', '', `${who}Geldmarkt-ETF `), `${mm.tranche.name} · ISIN ${mm.tranche.isin || '—'}${mm.tranche.ticker ? ` · ${mm.tranche.ticker}` : ''} · Kurs ${euroCent(mm.price)}${quoteDate(mm.tranche.asOf) ? ` vom ${flowDate(quoteDate(mm.tranche.asOf))}` : ''}. „Geldmarkt kaufen“ öffnet den geführten Kauf mit diesem Wertpapier und dem Betrag.`]
            : [el(doc, 'strong', '', `${who}noch kein Geldmarkt-ETF im Depot. `), '„Geldmarkt kaufen“ öffnet den geführten Kauf mit Anlageform Geldmarkt und dem Betrag.']));
    }
    notes.append(etf);
    const receivers = distribution.rows.filter((/** @type {any} */ row) => row.toCash >= 0.005).map((/** @type {any} */ row) => row.name);
    const rule = el(doc, 'p', 'sale-flow-dashed', [`Aufs Tagesgeld kommt nur die Lücke zum Haushaltsziel. ${receivers.length ? `Sie geht an ${joinNames(receivers)}, weil das Tagesgeld dort unter dem persönlichen Tagesgeldziel liegt. ` : 'Das Tagesgeld ist schon am Ziel. '}Den Rest der Gutschrift kauft jede Person in den Geldmarkt. `]);
    if (!kept) { const link = button(doc, 'Lieber alles auf dem Tagesgeld lassen', 'sale-flow-link'); link.dataset.saleFlowKeepCash = ''; link.addEventListener('click', () => onKeepCash(true)); rule.append(link); }
    else {
        // Gutachten VK-1 P3-3: Die Entscheidung lässt sich zurücknehmen.
        const undo = button(doc, 'Doch in den Geldmarkt', 'sale-flow-link'); undo.dataset.saleFlowKeepCashRevoke = ''; undo.addEventListener('click', () => onKeepCash(false));
        rule.append(el(doc, 'strong', '', 'Entschieden: Alles bleibt auf dem Tagesgeld.'), ' ', undo);
    }
    notes.append(rule);
    root.append(notes);
    return root;
}
