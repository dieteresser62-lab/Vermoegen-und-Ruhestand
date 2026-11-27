// VK-2 (FR-79 Punkte 5, 6, 8): Inhalte der Schritte des geführten Kaufs. Nur Darstellung mit den Bausteinen des geführten Verkaufs
// (gleicher Rahmen, gleiche Klassen); Zahlen aus `buy-flow-model.js`, Zustand und Speichern aus `buy-flow-dialog.js`.
import { el, button, chip, euro, euroCent, flowNumber, flowDate, joinNames, personSegment, parseMoney, parseQuantity, parseShares, euroFrame, unitFrame, formatFlowField, formatPriceField, priceFieldText, formatMoneyField, formatCashField, wholeCash } from './sale-flow-steps.js';
import { suggestBuyShares, estimateBuy, settleBuy, restBuyQuestionAmount, buyPlanProgress, CLASS_NAMES, BUY_PRICE_BUFFER } from './buy-flow-model.js';
import { shownPrice, trancheTypeName } from './sale-flow-model.js';
import { formatQuoteExchangeTime } from '../shared/designsystem-number-format.js';

/** VK-3b (Fable P3-7): Meldung für einen Ausführungstag in der Zukunft. @param {string} executedAt */
export const futureBuyMessage = executedAt => `Der ${flowDate(executedAt)} liegt in der Zukunft. Einen Kauf trägst du ab seinem Ausführungstag ein.`;

const TQF_CHOICES = /** @type {[number, string][]} */ ([[0.3, '30 %'], [0.15, '15 %'], [0, '0 %']]);
const TQF_NAMES = /** @type {Record<string, string>} */ ({ '0.3': '30 % (Aktienfonds)', '0.15': '15 % (Mischfonds)', '0': '0 %' });
/** Teilfreistellung in Klartext. @param {number} tqf */
export const tqfText = tqf => TQF_NAMES[String(tqf)] || `${flowNumber(tqf * 100)} %`;
const possessive = (/** @type {string} */ name) => name.endsWith('s') ? `${name}’` : `${name}s`;
const quoteSource = (/** @type {any} */ security) => {
    const stand = formatQuoteExchangeTime(security?.quoteExchange, security?.asOf);
    return stand ? ` · ${stand}` : '';
};

/** Stand einer Kaufzeile. @param {any} line */
export function buyLineStateText(line) {
    if (line.keptCash) return 'erledigt · Rest bleibt auf dem Tagesgeld';
    if (line.status === 'erledigt') return 'erledigt';
    if (line.status === 'teilweise') return `teilweise · ${euro(line.restAmount)} offen`;
    return 'offen';
}

/** Kurs-Kennzeichen eines Wertpapiers. @param {Document} doc @param {any} security */
function quoteChip(doc, security) {
    if (security?.check === 'pending') return chip(doc, 'Kurs wird geprüft …');
    if (security?.available) return chip(doc, '✓ Kurs abrufbar', 'success');
    if (security?.check === 'stale') return chip(doc, 'Kurs veraltet', 'warning');
    return chip(doc, 'ohne Kursabruf', 'warning');
}

/**
 * Schritt 1 „Überblick“ (Entwurf K1): was der Plan kauft, welches Wertpapier, Kursprüfung über die Suche.
 * @param {Document} doc
 * @param {{lines: any[], plan: boolean, decidedOn: string, cash: Record<string, number|null>, suggestion: any, choice: string, security: any,
 * search: any, quoteDate: string, play: boolean, onChoose: (choice: string) => void, onSearch: (query: string) => void, onPick: (hit: any) => void,
 * onSecurity: (patch: any) => void, amount?: number|null, onAmount?: (value: string) => void, classes?: {id: string, label: string, active: boolean, done: boolean}[],
 * onClass?: (assetClass: string) => void, classFixed?: boolean, fixedClass?: string|null}} view
 */
export function buyOverviewStep(doc, view) {
    const root = el(doc, 'div', 'sale-flow-columns sale-flow-columns-wide'); root.dataset.buyFlowOverview = '';
    const main = el(doc, 'div', 'sale-flow-stack');
    const price = shownPrice(view.security?.price);
    if (view.plan) {
        main.append(el(doc, 'h3', 'sale-flow-title', 'Was der Plan kauft'),
            el(doc, 'p', 'ds-source sale-flow-lead', `Beschlossen im Jahresabschluss am ${view.decidedOn} · bezahlt aus dem Tagesgeld, das über dem Ziel liegt`));
        const box = el(doc, 'div', 'ds-table-box sale-flow-table-box');
        const table = el(doc, 'table', 'ds-table sale-flow-table'); table.setAttribute('aria-label', 'Was der Plan kauft');
        const head = el(doc, 'tr');
        for (const [text, numeric] of /** @type {[string, boolean][]} */ ([['Wer zahlt', false], ['Betrag', true], ['Vorschlag', true], ['Stand', false]])) {
            const cell = el(doc, 'th', numeric ? 'ds-num' : '', text); cell.setAttribute('scope', 'col'); head.append(cell);
        }
        table.append(el(doc, 'thead', '', head));
        const body = el(doc, 'tbody');
        let estimateTotal = 0;
        for (const line of view.lines) {
            const shares = suggestBuyShares(line.restAmount, price), estimate = estimateBuy(shares, price);
            if (line.status !== 'erledigt') estimateTotal += estimate.gross;
            const cash = view.cash[line.profileId];
            const row = el(doc, 'tr'); row.dataset.buyFlowLine = line.key;
            const who = el(doc, 'td', 'sale-flow-who', [line.name, ...(Number.isFinite(cash) ? [el(doc, 'small', 'sale-flow-sub',
                line.status === 'erledigt' ? `Tagesgeld ${euro(cash)}` : `Tagesgeld ${euro(cash)} → danach ≈ ${euro(/** @type {number} */ (cash) - estimate.debit)}`)] : [])]);
            const suggestion = line.status === 'erledigt' || !(price > 0) ? el(doc, 'td', 'ds-num', '—') : el(doc, 'td', 'ds-num', [el(doc, 'strong', '', `${flowNumber(shares)} Stück`),
                el(doc, 'small', 'sale-flow-sub', `× ${euroCent(price)} ≈ ${euro(estimate.gross)}`)]);
            row.append(who, el(doc, 'td', 'ds-num', [euro(line.amount), ...(view.lines.some(item => item.assetClass !== 'equity') ? [el(doc, 'small', 'sale-flow-sub', CLASS_NAMES[line.assetClass] || '')] : [])]),
                suggestion, el(doc, 'td', 'sale-flow-state', buyLineStateText(line)));
            body.append(row);
        }
        const total = el(doc, 'tr', 'sale-flow-total');
        total.append(el(doc, 'td', '', 'Zusammen'), el(doc, 'td', 'ds-num', euro(view.lines.reduce((sum, line) => sum + Math.round(line.amount), 0))),
            el(doc, 'td', 'ds-num sale-flow-sub-cell', estimateTotal ? `≈ ${euro(estimateTotal)}` : ''), el(doc, 'td'));
        body.append(total); table.append(body); box.append(table); main.append(box);
        main.append(el(doc, 'p', 'ds-source', `Stück abgerundet: Planbetrag minus etwa 10 € Gebühren, geteilt durch den Kurs plus ${flowNumber(BUY_PRICE_BUFFER * 100)} % Puffer. So bleibt der Kauf im Plan, auch wenn der Kurs bis zur Ausführung etwas steigt. „Danach“ rechnet mit etwa 10 € Gebühren.`));
    } else {
        const line = view.lines[0];
        main.append(el(doc, 'h3', 'sale-flow-title', `Kauf für ${line.name}`),
            el(doc, 'p', 'ds-source sale-flow-lead', 'Ohne Planbezug: Wertpapier wählen, Abrechnung eintragen, Abbuchung bestätigen.'));
        const field = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-input')); field.inputMode = 'decimal'; field.dataset.buyFlowAmount = '';
        field.value = Number.isFinite(view.amount) && /** @type {number} */ (view.amount) > 0 ? flowNumber(/** @type {number} */ (view.amount), 2) : '';
        // VN-3 (Codex F07): Der Betrag geht schon beim Tippen in den Entwurf; nach dem Verlassen mit zwei Nachkommastellen.
        field.addEventListener('input', () => view.onAmount?.(field.value));
        field.addEventListener('change', () => { formatMoneyField(field); view.onAmount?.(field.value); });
        main.append(el(doc, 'label', 'ds-field', [el(doc, 'span', '', ['Betrag ', el(doc, 'span', 'ds-source', '(freiwillig, für den Stückvorschlag)')]),
            el(doc, 'span', 'ds-unit-frame sale-flow-unit', [field, el(doc, 'span', '', '€')])]));
    }
    main.append(el(doc, 'h3', 'sale-flow-title', 'Welches Wertpapier?'));
    // VK-2b P1-1: Kauft der Plan mehrere Anlageklassen, wählt und bestätigt Schritt 1 das Wertpapier je Klasse.
    if (view.classes?.length) {
        const segment = el(doc, 'div', 'ds-segment buy-flow-classes'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Anlageklasse');
        for (const item of view.classes) {
            const node = button(doc, `${item.label}${item.done ? ' ✓' : ''}`, ''); node.setAttribute('aria-pressed', String(item.active)); node.dataset.buyFlowClass = item.id;
            node.addEventListener('click', () => view.onClass?.(item.id)); segment.append(node);
        }
        main.append(segment, el(doc, 'p', 'ds-source', 'Der Plan kauft mehrere Anlageklassen. Wähle für jede ein Wertpapier; „Weiter“ führt zur nächsten.'));
    }
    const choices = el(doc, 'div', 'sale-flow-stack buy-flow-choices');
    const option = (/** @type {string} */ value, /** @type {(string|Node)[]} */ title, /** @type {string} */ text, /** @type {Node|null} */ badge) => {
        const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = 'buyFlowSecurity'; radio.value = value;
        radio.checked = view.choice === value; radio.dataset.buyFlowChoice = value;
        radio.addEventListener('change', () => view.onChoose(value));
        return el(doc, 'label', `sale-flow-choice buy-flow-choice${radio.checked ? ' sale-flow-choice-selected' : ''}`, [radio,
            el(doc, 'span', '', [el(doc, 'span', 'buy-flow-choice-head', [el(doc, 'strong', '', title), ...(badge ? [badge] : [])]), el(doc, 'span', 'sale-flow-choice-text', text)])]);
    };
    if (view.suggestion) {
        const held = view.suggestion.holders.map((/** @type {any} */ row) => `${row.name} ${flowNumber(row.shares, 3)} Stück`).join(', ');
        choices.append(option('suggestion', [view.suggestion.name, el(doc, 'span', 'sale-flow-sub-inline', [view.suggestion.isin ? ` · ISIN ${view.suggestion.isin}` : '', view.suggestion.ticker ? ` · ${view.suggestion.ticker}` : ''].join(''))],
            `${view.suggestion.holders.length > 1 ? 'Habt ihr schon' : 'Hast du schon'}: ${held}. Der Kauf wird eine neue Tranche im ${trancheTypeName({ type: view.suggestion.type })}.${quoteSource(view.suggestion)}`, quoteChip(doc, view.suggestion)));
    }
    choices.append(option('other', ['Anderes Wertpapier'], 'Suche nach ISIN oder Name. Die App prüft, ob der Kursdienst einen Kurs liefert.', view.choice === 'other' && view.security ? quoteChip(doc, view.security) : null));
    main.append(choices);
    if (view.choice === 'other') main.append(securityFields(doc, view));
    root.append(main, searchPanel(doc, view));
    return root;
}

/** Felder zum gewählten „anderen Wertpapier“: Name, ISIN, Anlageform, Teilfreistellung (bestätigt der Nutzer), ohne Treffer auch Kürzel und Kurs.
 * @param {Document} doc @param {any} view */
function securityFields(doc, view) {
    const security = view.security || {};
    const box = el(doc, 'section', 'sale-flow-panel buy-flow-security'); box.dataset.buyFlowSecurity = '';
    const input = (/** @type {string} */ name, /** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ hint = '') => {
        const node = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); node.value = value; node.dataset.buyFlowField = name; node.id = `buyFlow-${name}`;
        if (name === 'price') node.inputMode = 'decimal';
        // VN-2 P3 (Gutachten 2.2 b): Weiter wird schon beim Tippen frei; die Werte gehen beim Tippen an die Wahl (Patchen an Ort und Stelle).
        node.addEventListener('input', () => view.onSecurity({ [name]: node.value }, false));
        node.addEventListener('change', () => { if (name === 'price') formatPriceField(node); view.onSecurity({ [name]: node.value }); });
        // DS-1 Punkt 4: Kurs im €-Rahmen.
        return el(doc, 'label', 'ds-field', [el(doc, 'span', '', [label, ...(hint ? [' ', el(doc, 'span', 'ds-source', hint)] : [])]), name === 'price' ? euroFrame(doc, node) : node]);
    };
    box.append(el(doc, 'p', 'sale-flow-panel-head', [el(doc, 'strong', '', security.symbol ? `${security.symbol}${security.exchange ? ` · ${security.exchange}` : ''}` : 'Ohne Treffer'),
        el(doc, 'span', 'ds-source', security.symbol ? ` · ${security.available ? `letzter Kurs ${euroCent(shownPrice(security.price))}${quoteSource(security)}` : 'kein Kurs'}` : ' · ohne Kursabruf, Kurs von Hand pflegen')]));
    const fields = el(doc, 'div', 'sale-flow-fields buy-flow-fields');
    fields.append(input('name', 'Name', security.name || ''), input('isin', 'ISIN', security.isin || '', security.symbol ? '(Yahoo liefert keine ISIN)' : ''));
    if (!security.symbol) fields.append(input('ticker', 'Kürzel', security.ticker || '', '(freiwillig)'), input('price', 'Kurs von Hand', Number.isFinite(security.price) ? priceFieldText(security.price) : '', 'je Stück'));
    const select = /** @type {HTMLSelectElement} */ (el(doc, 'select', 'ds-select')); select.id = 'buyFlow-assetClass'; select.dataset.buyFlowField = 'assetClass';
    // VK-2b P2-3: Mit Planzeile oder Vorbelegung steht die Anlageform fest; ein Treffer schlägt sie nur im Kauf ohne Vorgabe vor.
    // VN-3 (Fable P2-2): Gesperrt nur mit Planzeile oder Vorbelegung, nicht nach der eigenen Wahl.
    select.disabled = view.classFixed === true;
    // VN-2 P1 (Gutachten 1.1): Ohne Wahl steht „Bitte wählen“ da, nicht scheinbar „Aktien“; die feste Anlageform ist sichtbar gewählt.
    const effective = security.assetClass || view.fixedClass || '';
    const placeholder = /** @type {HTMLOptionElement} */ (el(doc, 'option', '', 'Bitte wählen')); placeholder.value = ''; placeholder.disabled = true; placeholder.selected = !effective;
    placeholder.hidden = Boolean(effective); select.append(placeholder);
    for (const [value, text] of Object.entries(CLASS_NAMES)) {
        const node = /** @type {HTMLOptionElement} */ (el(doc, 'option', '', text)); node.value = value; node.selected = effective === value; select.append(node);
    }
    select.addEventListener('change', () => view.onSecurity({ assetClass: select.value }));
    fields.append(el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'Anlageform'), select]));
    box.append(fields);
    if (effective === 'equity') {
        const segment = el(doc, 'div', 'ds-segment'); segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Teilfreistellung');
        for (const [value, text] of TQF_CHOICES) {
            const node = button(doc, text, ''); node.setAttribute('aria-pressed', String(security.tqf === value)); node.dataset.buyFlowTqf = String(value);
            node.addEventListener('click', () => view.onSecurity({ tqf: value })); segment.append(node);
        }
        box.append(el(doc, 'div', 'buy-flow-tqf', [el(doc, 'span', '', 'Teilfreistellung bestätigen'), segment]),
            el(doc, 'p', 'ds-source', '30 % für Aktienfonds, 15 % für Mischfonds, 0 % sonst. Steht im Factsheet des Fonds.'));
    }
    return box;
}

/** Suche beim Kursdienst (Entwurf K1 rechts, FR-79 Punkt 6). @param {Document} doc @param {any} view */
function searchPanel(doc, view) {
    const panel = el(doc, 'section', 'sale-flow-panel buy-flow-search'); panel.dataset.buyFlowSearch = '';
    panel.append(el(doc, 'p', 'sale-flow-panel-head', el(doc, 'strong', '', 'Anderes Wertpapier suchen')));
    const query = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); query.id = 'buyFlowQuery'; query.value = view.search.query || ''; query.dataset.buyFlowQuery = '';
    const go = button(doc, 'Suchen'); go.dataset.buyFlowSearchButton = '';
    const run = () => view.onSearch(query.value);
    go.addEventListener('click', run);
    query.addEventListener('keydown', event => { if (/** @type {KeyboardEvent} */ (event).key === 'Enter') { event.preventDefault(); run(); } });
    panel.append(el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'ISIN oder Name'), el(doc, 'span', 'buy-flow-query', [query, go])]));
    const state = view.search;
    if (state.status === 'busy') panel.append(el(doc, 'p', 'ds-source', 'Suche läuft …'));
    if (state.status === 'error') panel.append(el(doc, 'p', 'ds-note ds-note-warning', `Der Kursdienst antwortet nicht (${state.error}). Du kannst trotzdem kaufen: Name und ISIN selbst eintragen, die Tranche bekommt dann „ohne Kursabruf, Kurs von Hand pflegen“.`));
    if (state.status === 'done') {
        const hits = state.result.hits;
        panel.append(el(doc, 'p', 'ds-source', hits.length ? `${hits.length} ${hits.length === 1 ? 'Treffer' : 'Treffer'} beim Kursdienst · Kurse vom ${flowDate(view.quoteDate)}${view.play ? ' (Spielkurse)' : ''}`
            : `Kein Treffer für „${state.result.query}“.`));
        if (hits.length) {
            const list = el(doc, 'div', 'buy-flow-hits'); list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-label', 'Treffer');
            for (const hit of hits) {
                const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = 'buyFlowHit'; radio.value = hit.symbol; radio.dataset.buyFlowHit = hit.symbol;
                const selectable = hit.status === 'ok' || hit.status === 'stale';
                radio.disabled = !selectable; radio.checked = view.choice === 'other' && view.security?.symbol === hit.symbol;
                radio.addEventListener('change', () => view.onPick(hit));
                const right = hit.status === 'ok' ? el(doc, 'span', 'buy-flow-hit-price', [el(doc, 'span', '', [euroCent(shownPrice(hit.price)), ' ', el(doc, 'span', 'buy-flow-ok', '✓')]),
                    ...(hit.quoteExchange ? [el(doc, 'small', 'sale-flow-sub', formatQuoteExchangeTime(hit.quoteExchange, hit.asOf))] : [])])
                    : hit.status === 'stale' ? el(doc, 'span', 'buy-flow-hit-price', [euroCent(shownPrice(hit.price)), el(doc, 'small', 'sale-flow-sub sale-flow-sub-warn', `Kurs vom ${flowDate(new Date(hit.asOf * 1000).toISOString())}, älter als 7 Tage`)])
                        : el(doc, 'span', 'ds-source', hit.status === 'currency' ? 'andere Währung, kein Kursabruf in €' : 'kein Kurs');
                list.append(el(doc, 'label', `buy-flow-hit${radio.checked ? ' buy-flow-hit-selected' : ''}${selectable ? '' : ' buy-flow-hit-off'}`, [radio,
                    el(doc, 'span', 'buy-flow-hit-name', [el(doc, 'span', '', [el(doc, 'strong', '', hit.symbol), ` · ${[hit.exchange, hit.currency].filter(Boolean).join(' · ')}`]),
                        el(doc, 'small', 'sale-flow-sub', hit.name)]), right]));
            }
            panel.append(list);
        }
    }
    panel.append(el(doc, 'p', 'ds-note buy-flow-hint', [el(doc, 'strong', '', 'Nicht gefunden? '), 'Der Kursdienst kennt keine WKN – such mit der ISIN. Ohne Treffer kannst du trotzdem kaufen; die Tranche bekommt dann „ohne Kursabruf, Kurs von Hand pflegen“.']));
    const manual = button(doc, 'Ohne Treffer weiter', 'sale-flow-link'); manual.dataset.buyFlowManual = '';
    manual.addEventListener('click', () => view.onPick(null));
    panel.append(el(doc, 'p', 'ds-source', ['Name, ISIN, Kürzel und Anlageform übernimmt die App aus dem Treffer; die Teilfreistellung bestätigst du. ', manual]));
    return panel;
}

/** Schritt 2 „Kaufen“ (Entwurf K2): Merkzettel, Schätzung, Tagesgeld danach mit Mindest-Liquidität. Nichts wird gespeichert.
 * @param {Document} doc @param {any} line
 * @param {{draft: any, security: any, quoteDate: string, cash: Record<string, number|null>, payers: any[], reserve: number|null, onChange: (draft: any) => void, onPrint: () => void}} options */
export function buyStep(doc, line, { draft, security, quoteDate: date, cash, payers, reserve, onChange, onPrint }) {
    const root = el(doc, 'div', 'sale-flow-columns'); root.dataset.buyFlowBuy = line.key;
    const price = shownPrice(security?.price);
    const shares = draft.shares ?? suggestBuyShares(line.restAmount, price);
    const memo = el(doc, 'section', 'sale-flow-memo'); memo.dataset.buyFlowMemo = '';
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
    const row = (/** @type {string} */ term, /** @type {string|Node} */ value, /** @type {Node|null} */ action = null, /** @type {string} */ className = '') =>
        list.append(el(doc, 'div', `sale-flow-memo-row ${className}`.trim(), [el(doc, 'dt', '', term), el(doc, 'dd', '', value), ...(action ? [action] : [])]));
    row('Depot', line.name);
    row('Auftrag', el(doc, 'strong', '', 'Kaufen'));
    row('Wertpapier', security?.name || '—');
    row('ISIN', el(doc, 'span', 'sale-flow-isin', security?.isin || '—'), security?.isin ? copy(security.isin) : null);
    row('Kürzel', security?.ticker ? `${security.ticker}${security.exchange ? ` · ${security.exchange}` : ''}` : '—');
    row('Stück', el(doc, 'span', 'sale-flow-shares', flowNumber(shares)), copy(String(shares)), 'sale-flow-memo-shares');
    row('Ordertyp', price > 0 ? `bestens oder mit Limit, etwa ${euroCent(price * (1 + BUY_PRICE_BUFFER))} je Stück` : 'bestens oder mit Limit');
    row('Bezahlt von', `Tagesgeld ${line.name}`);
    memo.append(list, el(doc, 'p', 'ds-source sale-flow-memo-note', 'Bucht deine Bank vom Verrechnungskonto ab, überweise das Geld vor dem Kauf vom Tagesgeld aufs Verrechnungskonto.'));
    const side = el(doc, 'div', 'sale-flow-stack');
    const estimate = estimateBuy(shares, price);
    const cost = el(doc, 'section', 'sale-flow-panel'); cost.dataset.buyFlowEstimate = '';
    cost.append(el(doc, 'p', 'sale-flow-panel-head', [el(doc, 'strong', '', 'Was es kostet'), el(doc, 'span', 'ds-source', price > 0 ? ` · geschätzt mit ${euroCent(price)} vom ${flowDate(date, true)}${quoteSource(security)}` : ' · ohne Kurs')]));
    const rows = el(doc, 'dl', 'sale-flow-sum');
    const sum = (/** @type {string|Node} */ term, /** @type {string} */ value, /** @type {string} */ className = '') => rows.append(el(doc, 'div', `sale-flow-sum-row ${className}`.trim(), [el(doc, 'dt', '', term), el(doc, 'dd', '', value)]));
    sum(`${flowNumber(shares)} Stück × ${euroCent(price)}`, euroCent(estimate.gross));
    sum('+ Gebühren', 'laut Bank, etwa 10 €');
    sum('≈ Belastung', euro(estimate.debit), 'sale-flow-sum-total');
    cost.append(rows);
    if (line.restAmount > 0) {
        const within = estimate.debit <= line.restAmount + 0.5;
        cost.append(el(doc, 'p', 'sale-flow-verdict', [chip(doc, within ? 'im Plan' : 'über dem Plan', within ? 'success' : 'warning'),
            ` Plan ${euro(line.restAmount)} · ${within ? `bleibt ${euro(line.restAmount - estimate.debit)} übrig` : `${euro(estimate.debit - line.restAmount)} mehr als geplant`}`]));
    }
    side.append(cost);
    const after = el(doc, 'section', 'sale-flow-panel'); after.dataset.buyFlowCashAfter = '';
    after.append(el(doc, 'p', 'sale-flow-panel-head', el(doc, 'strong', '', 'Tagesgeld danach')));
    const cashRows = el(doc, 'dl', 'sale-flow-sum');
    let total = 0, known = true;
    for (const payer of payers) {
        const before = cash[payer.profileId];
        if (!Number.isFinite(before)) { known = false; continue; }
        const debit = payer.profileId === line.profileId ? estimate.debit : payer.estimateDebit;
        const value = /** @type {number} */ (before) - debit; total += value;
        cashRows.append(el(doc, 'div', 'sale-flow-sum-row', [el(doc, 'dt', '', payer.profileId === line.profileId || payers.length === 1 ? payer.name : `${payer.name}, nach ${payer.female ? 'ihrem' : 'dem'} Kauf`),
            el(doc, 'dd', '', [`${euro(before)} → `, el(doc, 'strong', '', `≈ ${euro(value)}`)])]));
    }
    after.append(cashRows);
    if (Number.isFinite(reserve) && known) {
        const covered = total >= /** @type {number} */ (reserve) - 0.5;
        after.append(el(doc, 'p', 'sale-flow-verdict', [chip(doc, covered ? 'Reserve gedeckt' : 'unter der Mindest-Liquidität', covered ? 'success' : 'warning'),
            ` Mindest-Liquidität ${euro(reserve)}${payers.length > 1 ? `, zusammen ≈ ${euro(total)}` : ''}`]));
    }
    side.append(after);
    const other = /** @type {HTMLDetailsElement} */ (el(doc, 'details', 'sale-flow-details')); other.open = Boolean(draft.otherOpen);
    other.addEventListener('toggle', () => { draft.otherOpen = other.open; });
    const count = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); count.inputMode = 'decimal'; count.value = String(shares).replace('.', ','); count.id = `buyFlowShares-${line.key}`;
    count.addEventListener('change', () => { const value = parseShares(count.value); onChange(Object.assign(draft, { shares: value > 0 ? value : null })); });
    other.append(el(doc, 'summary', '', 'Anders kaufen'), el(doc, 'div', 'sale-flow-fields', [el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'Stückzahl'), count])]),
        el(doc, 'p', 'ds-source', 'Nichts davon wird gespeichert. Die Abrechnung im nächsten Schritt übernimmt die Stückzahl als Vorschlag.'));
    side.append(other);
    root.append(memo, side);
    return root;
}

/** Werte der Abrechnung aus dem Entwurf. @param {any} line @param {any} draft @param {any} security */
export function draftBuySettlement(line, draft, security) {
    const price = shownPrice(security?.price);
    const shares = draft.sharesEdited ? parseShares(draft.shares) : (draft.shares ?? suggestBuyShares(line.restAmount, price));
    // VK-2b P2-1: Gebühren auf Cent („9,905“ → 9,91), damit Belastung = Kurswert + Gebühren auf den Cent stimmt.
    const fees = parseMoney(draft.fees);
    return { shares, ...settleBuy({ shares, price: parseQuantity(draft.price), fees: Number.isFinite(fees) ? Math.round(fees * 100 + 1e-7) / 100 : 0 }) };
}

/** Schritt 3 „Abrechnung“ (Entwurf K3) mit „Neue Tranche bei …“ und Rest-Frage. @param {Document} doc @param {any} line
 * @param {{draft: any, security: any, plan: boolean, tranche: any, onChange: (draft: any, rerender?: boolean) => void, onKeepRevoke?: () => void, onAnother?: () => void,
 * scope?: {year: number, decidedOn?: string|null}|null}} options */
export function buySettleStep(doc, line, { draft, security, plan, tranche, onChange, onKeepRevoke, onAnother, scope = null }) {
    const root = el(doc, 'div', 'sale-flow-columns'); root.dataset.buyFlowSettle = line.key;
    if (line.status === 'erledigt' && !draft.another) {
        const done = el(doc, 'section', 'sale-flow-panel'); done.dataset.buyFlowSettled = '';
        done.append(el(doc, 'h3', 'sale-flow-title', `${line.name}: eingetragen`));
        for (const buy of line.buys) done.append(el(doc, 'p', '', `${flowDate(buy.executedAt)} · ${flowNumber(buy.shares, 3)} Stück · Kurswert ${euroCent(buy.gross)} + ${euroCent(buy.fees)} Gebühren = ${euroCent(buy.debit)}`));
        if (line.keptCash) {
            done.append(el(doc, 'p', '', [chip(doc, 'Erledigt · Rest bleibt auf dem Tagesgeld', 'success'), ` ${euroCent(line.amount - line.bought)} bleiben auf dem Tagesgeld.${line.keptReason ? ` Warum: ${line.keptReason}` : ''}`]));
            const revoke = button(doc, 'Rest doch kaufen'); revoke.dataset.buyFlowRevoke = line.key; revoke.addEventListener('click', () => onKeepRevoke?.()); done.append(revoke);
        } else {
            const another = button(doc, 'Weitere Abrechnung zu dieser Zeile'); another.addEventListener('click', () => onAnother?.()); done.append(another);
        }
        root.append(done);
        return root;
    }
    const values = draftBuySettlement(line, draft, security);
    const form = el(doc, 'section', 'sale-flow-panel sale-flow-form'); form.dataset.buyFlowForm = '';
    form.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'h3', 'sale-flow-title', 'Abrechnung deiner Bank'), el(doc, 'span', 'ds-source', 'gestrichelt = übernommen')]));
    const input = (/** @type {string} */ name, /** @type {string} */ value, adopted = false) => {
        const node = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-input')); node.inputMode = 'decimal'; node.value = value; node.dataset.buyFlowField = name;
        node.id = `buyFlow-${name}-${line.key}`;
        if (adopted) node.dataset.saleFlowAdopted = '';
        node.addEventListener('input', () => { delete node.dataset.saleFlowAdopted; onChange(Object.assign(draft, { [name]: node.value, [`${name}Edited`]: true }), false); });
        node.addEventListener('change', () => { formatFlowField(node, name); onChange(Object.assign(draft, { [name]: node.value, [`${name}Edited`]: true }), true); });
        return node;
    };
    const grid = el(doc, 'div', 'sale-flow-settle-grid');
    const date = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-date')); date.type = 'date'; date.value = draft.executedAt; date.id = `buyFlow-date-${line.key}`;
    // VK-3b (Fable P3-7): kein Kauf in der Zukunft; das Feld endet beim heutigen Tag, ein späterer Tag bekommt einen Hinweis mit Datum.
    if (draft.openedOn) date.max = draft.openedOn;
    date.addEventListener('change', () => onChange(Object.assign(draft, { executedAt: date.value }), true));
    const dateCell = el(doc, 'div', 'sale-flow-settle-value', date);
    if (draft.openedOn && draft.executedAt && draft.executedAt > draft.openedOn) {
        dateCell.append(el(doc, 'p', 'ds-note ds-note-warning sale-flow-date-note', futureBuyMessage(draft.executedAt)));
    }
    if (scope && draft.executedAt && (String(draft.executedAt).slice(0, 4) !== String(scope.year) || scope.decidedOn && draft.executedAt < scope.decidedOn)) {
        dateCell.append(el(doc, 'p', 'ds-note ds-note-warning sale-flow-date-note', `Dieser Tag zählt nicht zum Plan ${scope.year}. Die Zeile bleibt dann offen.`));
    }
    grid.append(el(doc, 'label', 'sale-flow-label', 'Ausführungstag'), dateCell);
    grid.append(el(doc, 'label', 'sale-flow-label', 'Gekauft'), el(doc, 'div', 'sale-flow-settle-value sale-flow-trade', [
        unitFrame(doc, input('shares', draft.sharesEdited ? String(draft.shares ?? '') : String(values.shares ?? '').replace('.', ','), !draft.sharesEdited), 'Stück'), el(doc, 'span', 'ds-source', '×'),
        euroFrame(doc, input('price', draft.price ?? '')), el(doc, 'span', 'ds-source', '='), el(doc, 'strong', 'sale-flow-gross', euroCent(values.gross))]));
    grid.append(el(doc, 'label', 'sale-flow-label', '+ Gebühren'), el(doc, 'span', 'ds-source', 'Provision, Börsenentgelt'), euroFrame(doc, input('fees', draft.fees ?? '')));
    form.append(grid);
    form.append(el(doc, 'div', 'sale-flow-credit-row', [el(doc, 'strong', '', '= Belastung'), el(doc, 'span', 'ds-source', 'muss zur Abrechnung passen'),
        el(doc, 'span', 'sale-flow-credit', euroCent(values.debit))]));
    // VN-2 (Gutachten 2.3): Die Zeile steht immer im Baum und wird nur ausgeblendet; so verschiebt sie „Weitere Angaben“ nicht.
    if (plan) {
        const left = line.restAmount - (Number.isFinite(values.debit) ? values.debit : 0);
        const verdict = el(doc, 'p', 'sale-flow-verdict', left >= -0.5 ? [chip(doc, 'im Plan', 'success'), ` Plan ${euro(line.restAmount)} · ${euroCent(Math.max(0, left))} bleiben auf dem Tagesgeld`]
            : [chip(doc, 'über dem Plan', 'warning'), ` ${euroCent(-left)} mehr als geplant`]);
        verdict.hidden = !Number.isFinite(values.debit); form.append(verdict);
    }
    const more = /** @type {HTMLDetailsElement} */ (el(doc, 'details', 'sale-flow-details')); more.open = Boolean(draft.moreOpen);
    more.addEventListener('toggle', () => { draft.moreOpen = more.open; });
    const order = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); order.value = draft.orderNo || ''; order.id = `buyFlow-order-${line.key}`; order.maxLength = 64;
    order.addEventListener('input', () => onChange(Object.assign(draft, { orderNo: order.value }), false));
    more.append(el(doc, 'summary', '', 'Weitere Angaben'), el(doc, 'label', 'ds-field', [el(doc, 'span', '', 'Ordernummer (freiwillig)'), order]),
        el(doc, 'p', 'ds-source', 'Mit derselben Ordernummer trägt die App eine Abrechnung nicht doppelt ein.'));
    form.append(more);
    const side = el(doc, 'div', 'sale-flow-stack');
    const rest = plan && Number.isFinite(values.debit) ? restBuyQuestionAmount(line, values.debit) : null;
    if (rest !== null) side.append(restQuestion(doc, rest, draft, onChange));
    const card = el(doc, 'section', 'sale-flow-panel buy-flow-tranche'); card.dataset.buyFlowTranche = '';
    card.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'strong', '', `Neue Tranche bei ${line.name}`), quoteChip(doc, security)]));
    card.append(el(doc, 'p', 'buy-flow-tranche-name', [el(doc, 'strong', '', security?.name || 'Wertpapier'), el(doc, 'span', 'ds-source', ` · ${CLASS_NAMES[tranche.category] || ''} · ${trancheTypeName(tranche)}`)]));
    const rows = el(doc, 'dl', 'sale-flow-sum');
    const sum = (/** @type {string} */ term, /** @type {string} */ value) => rows.append(el(doc, 'div', 'sale-flow-sum-row', [el(doc, 'dt', '', term), el(doc, 'dd', '', value)]));
    sum('ISIN · Kürzel', [security?.isin || '—', security?.ticker || '—'].join(' · '));
    if (security?.price > 0) sum('Letzter Kurs', `${euroCent(shownPrice(security.price))}${security.asOf ? ` am ${flowDate(new Date(security.asOf * 1000).toISOString())}` : ''}${quoteSource(security)}`);
    sum('Kaufdatum', flowDate(draft.executedAt) || '—');
    sum('Stück', Number.isFinite(values.shares) ? flowNumber(values.shares, Number.isInteger(values.shares) ? 0 : 3) : '—');
    sum('Kaufpreis je Stück, mit Gebühren', euroCent(values.pricePerShare));
    sum('Einstand', euroCent(values.debit));
    sum('Teilfreistellung', tranche.category === 'equity' ? tqfText(tranche.tqf ?? 0) : '0 %');
    card.append(rows, el(doc, 'p', 'ds-source', 'Alles aus Wertpapier und Abrechnung übernommen, nichts zu tippen. Eine eigene Tranche, weil Kaufdatum und Kaufpreis die Steuer beim späteren Verkauf bestimmen. Die Gebühren zählen zum Einstand.'));
    side.append(card);
    root.append(form, side);
    root.append(el(doc, 'p', 'ds-source buy-flow-foot', 'Erst „Kauf eintragen“ legt die Tranche an. Bis dahin kannst du alles ändern oder abbrechen, ohne dass etwas gespeichert wird.'));
    return root;
}

/** Rest-Frage beim Kauf (FR-79 Punkt 11, für Käufe „Rest bleibt auf dem Tagesgeld“). @param {Document} doc @param {number} rest @param {any} draft @param {(draft: any, rerender?: boolean)=>void} onChange */
function restQuestion(doc, rest, draft, onChange) {
    const box = el(doc, 'fieldset', 'sale-flow-question'); box.dataset.buyFlowRestQuestion = '';
    box.append(el(doc, 'legend', 'sale-flow-title', `Was passiert mit dem Rest von ${euroCent(rest)}?`));
    const option = (/** @type {string} */ value, /** @type {string} */ title, /** @type {string} */ text) => {
        const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = 'buyFlowRest'; radio.value = value;
        radio.checked = (draft.restDecision || 'buy') === value; radio.dataset.buyFlowRest = value;
        radio.addEventListener('change', () => onChange(Object.assign(draft, { restDecision: value }), true));
        return el(doc, 'label', `sale-flow-choice${radio.checked ? ' sale-flow-choice-selected' : ''}`, [radio, el(doc, 'span', '', [el(doc, 'strong', '', title), el(doc, 'span', 'sale-flow-choice-text', text)])]);
    };
    box.append(option('keep', 'Bleibt auf dem Tagesgeld – so entschieden', 'Die App erinnert nicht mehr daran. Im Plan steht „Erledigt · Rest bleibt auf dem Tagesgeld“.'),
        option('buy', 'Kaufe ich noch', 'Die Zeile bleibt „teilweise“, „Was zu tun ist“ nennt den Rest.'));
    if (draft.restDecision === 'keep') {
        const reason = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input')); reason.value = draft.reason || ''; reason.maxLength = 200; reason.dataset.buyFlowReason = '';
        reason.addEventListener('input', () => onChange(Object.assign(draft, { reason: reason.value }), false));
        box.append(el(doc, 'label', 'ds-field', [el(doc, 'span', '', ['Warum? ', el(doc, 'span', 'ds-source', '(freiwillig, steht im Jahresbeleg)')]), reason]));
    }
    return box;
}

/** Schritt 4 „Abbuchung“ (Entwurf K4, Ergänzung 1 Punkt 8). @param {Document} doc
 * @param {{people: any[], missing: any[], drafts: Record<string, any>, lines: any[], plan: boolean, onChange: (id: string, draft: any, rerender?: boolean) => void, onSettle: (key: string) => void}} view */
export function debitStep(doc, { people, missing, drafts, lines, plan, onChange, onSettle }) {
    const root = el(doc, 'div', 'sale-flow-stack'); root.dataset.buyFlowDebit = '';
    root.append(el(doc, 'h3', 'sale-flow-title', 'Ist der Betrag schon vom Tagesgeld abgegangen?'),
        el(doc, 'p', 'ds-source sale-flow-lead', 'Die App bucht nichts selbst – du bestätigst, was dein Konto zeigt.'));
    const cards = el(doc, 'div', 'sale-flow-cards');
    for (const person of people) {
        const draft = drafts[person.profileId] || {};
        const shown = person.pending ? person.buys.filter((/** @type {any} */ buy) => buy.debitPending) : person.buys;
        const debit = shown.reduce((/** @type {number} */ sum, /** @type {any} */ buy) => sum + buy.debit, 0);
        const card = el(doc, 'section', 'sale-flow-panel sale-flow-person'); card.dataset.buyFlowDebitPerson = person.profileId;
        card.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'h4', 'sale-flow-person-name', person.name),
            chip(doc, person.pending ? (draft.choice === 'now' ? 'wird bestätigt' : 'kommt noch') : 'bestätigt', person.pending ? 'warning' : 'success')]));
        card.append(el(doc, 'div', 'sale-flow-credit-row', [el(doc, 'span', '', `Belastung laut Abrechnung vom ${[...new Set(shown.map((/** @type {any} */ buy) => flowDate(buy.executedAt, true)))].join(', ')}`),
            el(doc, 'span', 'sale-flow-credit', euroCent(debit))]));
        for (const buy of shown) card.append(el(doc, 'p', 'ds-source', `${flowNumber(buy.shares, Number.isInteger(buy.shares) ? 0 : 3)} Stück × ${euroCent(buy.gross / buy.shares)} + ${euroCent(buy.fees)} Gebühren`));
        if (person.pending) {
            const choices = el(doc, 'div', 'sale-flow-choices');
            for (const [value, title, text] of [['now', 'Schon abgegangen', 'Ich trage den Kontostand ein.'], ['later', 'Kommt noch', 'Die App erinnert mich.']]) {
                const radio = /** @type {HTMLInputElement} */ (el(doc, 'input')); radio.type = 'radio'; radio.name = `buyFlowDebit-${person.profileId}`; radio.value = value;
                // VK-2b P2-2: Im Kauf ohne Plan ist nichts vorgewählt; „Kommt noch“ bleibt möglich und hinterlässt eine Erinnerung.
                radio.checked = (plan ? draft.choice || 'later' : draft.choice) === value; radio.dataset.buyFlowDebitChoice = value;
                radio.addEventListener('change', () => onChange(person.profileId, Object.assign(draft, { choice: value }), true));
                choices.append(el(doc, 'label', `sale-flow-choice${radio.checked ? ' sale-flow-choice-selected' : ''}`, [radio, el(doc, 'span', '', [el(doc, 'strong', '', title), el(doc, 'span', 'sale-flow-choice-text', text)])]));
            }
            card.append(choices);
            if (draft.choice === 'now') {
                const proposal = Number.isFinite(person.cash) ? wholeCash(person.cash - debit) : null;
                const field = /** @type {HTMLInputElement} */ (el(doc, 'input', 'ds-input sale-flow-input')); field.inputMode = 'decimal'; field.dataset.buyFlowCash = person.profileId;
                field.value = draft.cash ?? (proposal === null ? '' : flowNumber(proposal));
                if (draft.cash === undefined) field.dataset.saleFlowAdopted = '';
                field.addEventListener('input', () => { delete field.dataset.saleFlowAdopted; onChange(person.profileId, Object.assign(draft, { cash: field.value }), false); });
                // VN-4 Punkt 7 / Nachtrag 1 N2: Kontostand nach dem Verlassen mit Tausenderpunkt in ganzen Euro, ohne Neuaufbau.
                field.addEventListener('change', () => { if (field.dataset.saleFlowAdopted === undefined) { formatCashField(field); draft.cash = field.value; } });
                card.append(el(doc, 'div', 'sale-flow-cash-row', [el(doc, 'label', '', [el(doc, 'span', '', `Tagesgeld ${person.name} jetzt`),
                    el(doc, 'small', 'ds-source', Number.isFinite(person.cash) ? `Vorschlag: ${euro(person.cash)} − Belastung`
                        // VK-3d P2: Ohne lesbaren Stand kein Vorschlag; das Feld nimmt den Kontostand von heute an.
                        : 'Kein Vorschlag, weil der bisherige Stand nicht lesbar ist. Trag den Kontostand von heute ein.')]),
                el(doc, 'span', 'ds-unit-frame sale-flow-unit', [field, el(doc, 'span', '', '€')])]));
            } else if (plan || draft.choice === 'later') card.append(el(doc, 'p', 'sale-flow-warn', `Bis die Abbuchung eingetragen ist, zeigt die App ${possessive(person.name)} Vermögen um ${euroCent(debit)} zu hoch („Abbuchung unterwegs“). ${plan ? 'Dieser Schritt bleibt offen.' : 'In Personen & Vermögen und in der Balance steht dann „Abbuchung nachtragen“.'}`));
            else card.append(el(doc, 'p', 'ds-source', 'Bitte wählen: Ist der Betrag schon abgegangen, oder kommt die Abbuchung noch?'));
        }
        cards.append(card);
    }
    for (const line of missing) {
        const card = el(doc, 'section', 'sale-flow-panel sale-flow-person buy-flow-missing'); card.dataset.buyFlowMissing = line.key;
        const entry = button(doc, `Abrechnung ${line.name} eintragen`); entry.addEventListener('click', () => onSettle(line.key));
        card.append(el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'h4', 'sale-flow-person-name', line.name), chip(doc, 'Abrechnung fehlt', 'warning')]),
            el(doc, 'p', 'ds-source', `Plan ${euro(line.amount)} · Vorschlag ${flowNumber(line.suggestedShares)} Stück ${line.securityName}`),
            el(doc, 'p', '', `Sobald ${possessive(line.name)} Kauf ausgeführt ist, trägst du zuerst die Abrechnung ein. Danach fragt dieser Schritt nach der Abbuchung.`), entry);
        cards.append(card);
    }
    if (!people.length && !missing.length) root.append(el(doc, 'p', 'ds-note', 'Noch keine Abrechnung eingetragen. Die Abbuchung folgt nach Schritt 3.'));
    root.append(cards);
    if (plan) {
        const progress = buyPlanProgress(lines);
        const bar = el(doc, 'div', 'todo-progress'), fill = el(doc, 'i');
        bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${Math.round(progress.share * 100)} Prozent gekauft`); fill.style.width = `${progress.share * 100}%`; bar.append(fill);
        const open = lines.filter(line => line.status !== 'erledigt').map(line => line.name);
        root.append(el(doc, 'section', 'sale-flow-panel buy-flow-progress', [el(doc, 'div', 'sale-flow-memo-head', [el(doc, 'strong', '', 'Stand des Plans'),
            el(doc, 'span', '', `${euroCent(progress.bought)} von ${euro(progress.plan)} gekauft`)]), bar,
        el(doc, 'p', 'ds-source', open.length ? `In der Balance steht danach „Teilweise · Kauf ${joinNames(open)} offen“ mit „Weiter mit Schritt 3“.` : 'Alle Käufe aus dem Plan sind eingetragen.')]));
    }
    return root;
}

export { personSegment };
