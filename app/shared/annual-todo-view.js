// FR-77: gemeinsamer Baustein „Was zu tun ist“ für Balance (Karte) und Jahresabschluss (Ergebnis, Schritt „Plan“).
// Nur Darstellung; Zahlen kommen aus `app/balance/annual-todo.js` und der fertigen Marktprojektion.
import { formatDisplayNumber } from './designsystem-number-format.js';
import { saleEntryHref, todoDate, annualPlanStatusText, stockTrancheId } from '../balance/annual-todo.js';
import { createMarketHistory } from '../balance/balance-market-history.js';
import { displayUp, displayMonthlyDown, displayDown, displayActionAmount } from './display-rounding.js';

/** @param {string|null|undefined} value */
const marketChoiceDate = value => value?.split('-').reverse().join('.') || 'Datum nicht belegt';

/** @typedef {NonNullable<ReturnType<typeof import('../balance/annual-todo.js').projectAnnualTodoPlan>>} TodoPlan */
/** @typedef {NonNullable<ReturnType<typeof import('../balance/annual-todo.js').projectCashRefill>>} CashRefill */
/** @typedef {ReturnType<typeof import('../balance/balance-market-preview.js').projectMarketPreview>} MarketView */

/** @param {number|null|undefined} value */
export const todoMoney = value => Number.isFinite(value) ? `${formatDisplayNumber(/** @type {number} */ (value), { fractionDigits: 0 })} €` : '—';
/** FR-78: Verkaufs- und Umschichtungsbeträge, Ziele und Steuer einer Empfehlung, aufgerundet (Käufe: `displayActionAmount`, ab). Genau bleiben Verkaufserlöse,
 * Kontostände und alles in „Details & Drucken“. @param {number|null|undefined} value */
const upMoney = value => todoMoney(displayUp(value));
/** FR-78: Monatsbudget, abgerundet nach der Monatsstaffel. @param {number|null|undefined} value */
const budgetMoney = value => todoMoney(displayMonthlyDown(value));
/** Ergänzung 2 FR-78: Summen aus den angezeigten Beträgen. Plan = Summe der angezeigten Zeilen, ohne Zeilen der gerundete Betrag.
 * @param {{rows: {planNet: number}[], amount?: number|null}} plan @returns {number|null} */
const shownPlan = plan => plan.rows.length ? plan.rows.reduce((sum, row) => sum + displayUp(row.planNet), 0)
    : Number.isFinite(plan.amount) ? displayActionAmount(/** @type {any} */ (plan).verb, plan.amount) : null;
/** Offener Rest = Summe der angezeigten offenen Reste. @param {{rows: {restNet: number}[]}} plan */
const shownRest = plan => plan.rows.filter(row => row.restNet > 0).reduce((sum, row) => sum + displayUp(row.restNet), 0);
/** Aufteilung eines angezeigten Gesamtbetrags. Käufe (`purchase`) stehen in jedem Status abgerundet, unter der kleinsten Stufe in
 * ganzen Euro (RD-1e); die übrigen Teile mit `round` (Verkaufserlös auf). Den Unterschied zum Gesamtbetrag nimmt der letzte Teil, der
 * kein Kauf ist, wenn er dabei nahe am genauen Wert bleibt (nicht unter seinem abgerundeten, nicht über seinem aufgerundeten Wert, über 0).
 * RD-1f: Mit Kaufanteil entfällt die obere Schranke; der Rest ist dann angezeigter Verkauf minus die übrigen Teile, solange er über 0 liegt.
 * @param {{amount: number, purchase?: boolean}[]} entries genaue Teile @param {number|null} total angezeigter Gesamtbetrag
 * @param {(value: number)=>number} [round] @returns {number[]} */
function shownParts(entries, total, round = displayUp) {
    const rounded = entries.map(entry => entry.purchase ? displayActionAmount(' kaufen', entry.amount) : round(entry.amount));
    if (!Number.isFinite(total) || !entries.length) return rounded;
    if (entries.length === 1) return [/** @type {number} */ (total)];
    const restIndex = entries.map((entry, index) => entry.purchase ? -1 : index).filter(index => index >= 0).at(-1);
    if (restIndex === undefined) return rounded;
    const rest = /** @type {number} */ (total) - rounded.reduce((sum, amount, index) => index === restIndex ? sum : sum + amount, 0);
    const exact = entries[restIndex].amount;
    const fits = entries.some(entry => entry.purchase) ? rest > 0 : rest > 0 && rest >= displayDown(exact) && rest <= displayUp(exact);
    return fits ? rounded.map((amount, index) => index === restIndex ? rest : amount) : rounded;
}
/** Beträge mit Cent für „Details & Drucken“ (WT-1b). @param {number|null|undefined} value */
const centMoney = value => Number.isFinite(value) ? `${formatDisplayNumber(/** @type {number} */ (value), { fractionDigits: 2 })} €` : '—';
/** WT-1b: Satz zur Umsetzung, bei Plänen ohne Verkaufszeile neutral. @param {{rows: any[], purchases: any[]}} plan */
const decisionText = plan => plan.rows.length ? 'Die App bucht nichts – du entscheidest, wann du verkaufst.'
    : plan.purchases.length ? 'Die App bucht nichts – du entscheidest, wann du kaufst.' : 'Die App bucht nichts.';
/** @param {number|null|undefined} value */
const percent = value => `${formatDisplayNumber(Math.abs(Number(value) || 0), { fractionDigits: 0 })} %`;
/** @param {number|null|undefined} value */
const price = value => `${formatDisplayNumber(Number(value), { fractionDigits: 2 })} €`;

/** @param {Document} doc @param {string} tag @param {string} [text] @param {string} [className] */
function make(doc, tag, text, className) {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/** Statuschip: Offen, Teilweise erledigt, Erledigt. @param {Document} doc @param {string|null} status @param {boolean} [short] */
function statusChip(doc, status, short = false) {
    const text = status === 'erledigt' ? 'Erledigt' : status === 'teilweise' ? (short ? 'Teilweise' : 'Teilweise erledigt') : short ? 'offen' : 'Offen';
    if (short && status === 'offen') return make(doc, 'span', text, 'todo-row-open');
    const chip = make(doc, 'span', text, `ds-plan-chip todo-chip todo-chip-${status || 'offen'}${status === 'erledigt' ? ' ds-chip-success' : ''}`);
    chip.dataset.todoStatus = status || 'offen';
    return chip;
}

/** Hauptzeile mit Verb und angezeigtem Netto-Betrag (FR-78). @param {Document} doc @param {string} verb @param {number|null} amount @param {string} note */
function mainLine(doc, verb, amount, note) {
    const line = make(doc, 'div', undefined, 'todo-main');
    line.append(make(doc, 'span', verb, 'todo-main-verb'));
    if (amount !== null && Number.isFinite(amount)) line.append(make(doc, 'span', todoMoney(amount), 'todo-main-amount'));
    if (note) line.append(make(doc, 'span', note, 'ds-source todo-main-note'));
    return line;
}

/** @param {Document} doc @param {string[]} headings @param {(string|HTMLElement)[][]} rows @param {string} label */
function table(doc, headings, rows, label) {
    const box = make(doc, 'div', undefined, 'ds-table-box todo-table-box');
    const element = make(doc, 'table', undefined, 'ds-table todo-table');
    element.setAttribute('aria-label', label);
    if (headings.length) {
        const head = make(doc, 'thead'), row = make(doc, 'tr');
        headings.forEach((text, index) => {
            const cell = make(doc, 'th', text, index === 2 || headings.length === 2 && index === 1 ? 'ds-num' : undefined);
            cell.setAttribute('scope', 'col'); row.append(cell);
        });
        head.append(row); element.append(head);
    }
    const body = make(doc, 'tbody');
    for (const values of rows) {
        const row = make(doc, 'tr');
        values.forEach((value, index) => {
            const numeric = headings.length ? index === 2 || headings.length === 2 && index === 1 : index === values.length - 1;
            const cell = make(doc, 'td', undefined, numeric ? 'ds-num' : undefined);
            cell.append(typeof value === 'string' ? doc.createTextNode(value) : value);
            row.append(cell);
        });
        body.append(row);
    }
    element.append(body); box.append(element); return box;
}

/** Stand je Zeile: „offen“, „Teilweise 30.638 € am … · 49.312 € offen“, „Erledigt am …“. @param {Document} doc @param {TodoPlan['rows'][number]} row */
function rowState(doc, row) {
    const cell = make(doc, 'span', undefined, 'todo-row-state');
    cell.append(statusChip(doc, row.status, true));
    const date = todoDate(row.lastSaleAt);
    if (row.status === 'teilweise') cell.append(make(doc, 'span', ` ${todoMoney(row.soldNet)}${date ? ` am ${date}` : ''} · ${upMoney(row.restNet)} offen`, 'ds-source'));
    else if (row.status === 'erledigt' && date) cell.append(make(doc, 'span', ` am ${date}`, 'ds-source'));
    return cell;
}

/** „Wohin das Geld geht“. Ohne eigenes Format (`money`) zeigt der Block die Aufteilung des angezeigten Betrags `total`.
 * @param {Document} doc @param {TodoPlan['destinations']} destinations @param {boolean} [withHeading]
 * @param {((value: number)=>string)|null} [money] @param {number|null} [total] */
function destinationsBlock(doc, destinations, withHeading = true, money = null, total = null, round = displayUp) {
    const block = make(doc, 'div', undefined, 'todo-destinations');
    if (withHeading) block.append(make(doc, 'div', 'Wohin das Geld geht', 'ds-source'));
    const parts = money ? null : shownParts(destinations, total, round);
    for (const [index, entry] of destinations.entries()) {
        const row = make(doc, 'div', undefined, 'todo-destination');
        row.append(make(doc, 'span', entry.label), make(doc, 'span', money ? money(entry.amount) : todoMoney(parts?.[index]), 'todo-destination-amount'));
        block.append(row);
    }
    return block;
}

/** Karte „Was zu tun ist“: Plan mit Status. `actions` steuert die Knöpfe (nur in der Balance).
 * @param {Document} doc @param {TodoPlan} plan @param {{detailsButton?: boolean}} [options] */
export function createTodoPlan(doc, plan, { detailsButton = true } = {}) {
    const root = make(doc, 'div', undefined, 'todo-plan');
    root.dataset.todoPlan = plan.status || 'none';
    if (plan.status !== 'erledigt' && plan.decidedOn) {
        root.append(make(doc, 'p', `Beschlossen im Jahresabschluss am ${plan.decidedOn}. ${decisionText(plan)}`, 'ds-source todo-decided'));
    }
    if (plan.marketReading?.reading === 'year_high') {
        const chosen = make(doc, 'p', `Plan mit dem Jahreshoch vom ${marketChoiceDate(plan.marketReading.asOf)} (Wahl im Jahresabschluss)`, 'ds-source todo-decided');
        chosen.dataset.annualMarketChoiceLabel = ''; root.append(chosen);
    }
    if (plan.status) {
        const status = make(doc, 'div', undefined, 'todo-status');
        const head = make(doc, 'div', undefined, 'todo-status-head');
        head.append(statusChip(doc, plan.status), make(doc, 'span', plan.status === 'offen' ? 'Noch kein Verkauf eingetragen.'
            : plan.status === 'teilweise' ? `${todoMoney(plan.soldNet)} von ${todoMoney(shownPlan(plan))} verkauft`
                : `Alle Verkäufe aus dem Plan ${plan.year} sind eingetragen${plan.lastSaleDate ? `, zuletzt am ${plan.lastSaleDate}` : ''}.`, 'todo-status-text'));
        status.append(head);
        if (plan.status === 'teilweise') {
            const bar = make(doc, 'div', undefined, 'todo-progress'), fill = make(doc, 'i');
            const share = Math.round(plan.share * 100);
            bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${share} Prozent erledigt`);
            fill.style.width = `${share}%`; bar.append(fill); status.append(bar);
        }
        root.append(status);
    }
    if (plan.nothing) root.append(mainLine(doc, 'Nichts tun', null, plan.text && plan.text !== 'Nichts tun' ? plan.text.replace(/^Nichts tun – /, '') : ''));
    else if (plan.status === 'teilweise') root.append(mainLine(doc, 'Noch offen', shownRest(plan), `${plan.openSecurities.join(', ') || 'Wertpapiere'}, netto`));
    else if (plan.status !== 'erledigt') root.append(mainLine(doc, plan.verb, shownPlan(plan),
        plan.status ? plan.tax >= 0.5 ? `netto, Steuer ${upMoney(plan.tax)} schon abgezogen` : 'netto' : ''));
    if (plan.rows.length) root.append(table(doc, ['Wer', 'Wertpapier', 'Betrag netto', 'Stand'],
        plan.rows.map(row => [row.who, row.security, upMoney(row.planNet), rowState(doc, row)]), `Plan ${plan.year} je Person`));
    for (const credit of plan.credits) {
        const note = make(doc, 'div', undefined, 'todo-credit'); note.dataset.todoCredit = '';
        const link = make(doc, 'a', 'Tagesgeld nachtragen →');
        link.setAttribute('href', credit.profileId ? `depot-tranchen-manager.html?person=${encodeURIComponent(credit.profileId)}#reconciliationCashStatuses` : 'depot-tranchen-manager.html');
        link.setAttribute('data-profile-handoff', '');
        note.append(make(doc, 'strong', 'Gutschrift nachtragen'),
            make(doc, 'p', `Zum Verkauf vom ${credit.date}${credit.who ? ` (${credit.who})` : ''} fehlt die Gutschrift auf dem Tagesgeld (${todoMoney(credit.amount)}). Bis du sie nachträgst, zeigt die App dein Vermögen zu niedrig.`), link);
        root.append(note);
    }
    if (plan.destinations.length && (plan.status === 'offen' || plan.status === null) && !plan.nothing) root.append(destinationsBlock(doc, plan.destinations, true, null, shownPlan(plan), plan.rows.length ? displayUp : displayDown));
    else if (plan.purchases.length && !plan.nothing) root.append(destinationsBlock(doc, plan.purchases, true, null, plan.rows.length ? null : shownPlan(plan), displayDown));
    // Nachtrag WT-1: Käufe haben im Beleg keine Person; ihr Stand ist ohne neue Speicherfelder nicht sicher ableitbar.
    if (plan.purchases.length && !plan.nothing) root.append(make(doc, 'p', 'Käufe verfolgt die App nicht – trag sie im Vermögen ein.', 'ds-source todo-purchase-note'));
    const actions = make(doc, 'div', undefined, 'todo-actions');
    if (plan.status === 'offen' || plan.status === 'teilweise') {
        const sale = make(doc, 'a', 'Verkauf eintragen', 'ds-button ds-button-primary');
        sale.setAttribute('href', saleEntryHref(plan.saleTarget)); sale.setAttribute('data-profile-handoff', ''); sale.dataset.todoSaleEntry = '';
        actions.append(sale);
    }
    if (!plan.rows.length && plan.purchases.length && !plan.nothing) {
        const buy = make(doc, 'a', 'Kauf eintragen', 'ds-button ds-button-primary');
        buy.setAttribute('href', 'depot-tranchen-manager.html'); buy.setAttribute('data-profile-handoff', ''); buy.dataset.todoPurchaseEntry = '';
        actions.append(buy);
    }
    if (detailsButton) {
        const details = make(doc, 'button', 'Details & Drucken', 'ds-button ds-button-secondary');
        details.setAttribute('type', 'button'); details.id = 'openActionDetails'; details.dataset.actionDetails = 'plan';
        actions.append(details);
    }
    if (actions.children.length) root.append(actions);
    return root;
}

/** Ergebnis des Jahresabschlusses: neuer Plan im selben Baustein und mit denselben Wörtern wie die Karte (Entwurf 6).
 * @param {Document} doc @param {TodoPlan} plan @param {{details?: HTMLElement|null}} [options] */
export function createTodoResult(doc, plan, { details = null } = {}) {
    const root = make(doc, 'section', undefined, 'ds-plan-card todo-card todo-result');
    root.dataset.todoResult = '';
    const head = make(doc, 'div', undefined, 'todo-head');
    head.append(make(doc, 'h3', 'Was zu tun ist'), make(doc, 'span', `Plan ${plan.year}`, 'ds-plan-chip todo-plan-chip'));
    root.append(head);
    if (plan.marketReading?.reading === 'year_high') root.append(make(doc, 'p', `Gewählt: mit dem Jahreshoch vom ${marketChoiceDate(plan.marketReading.asOf)} (vorsichtiger).`, 'ds-source todo-decided'));
    else if (plan.marketReading?.reading === 'year_end') root.append(make(doc, 'p', 'Gewählt: nach Kursen zum Jahresende.', 'ds-source todo-decided'));
    if (plan.nothing) root.append(mainLine(doc, 'Nichts tun', null, plan.text && plan.text !== 'Nichts tun' ? plan.text.replace(/^Nichts tun – /, '') : ''));
    else root.append(mainLine(doc, plan.verb, shownPlan(plan), plan.rows.length ? 'netto' : ''));
    if (plan.rows.length) root.append(table(doc, [], plan.rows.map(row => [`${row.who} · ${row.security}`, upMoney(row.planNet)]), `Plan ${plan.year} je Person`));
    if (plan.destinations.length && !plan.nothing) root.append(destinationsBlock(doc, plan.destinations, false, null, shownPlan(plan), plan.rows.length ? displayUp : displayDown));
    // WT-1b: Käufe haben keinen Stand; der Satz nennt den Stand nur bei Verkaufszeilen.
    root.append(make(doc, 'p', plan.rows.length ? 'Den Stand verfolgst du in der Balance unter „Was zu tun ist“. Die App bucht nichts.' : decisionText(plan), 'ds-source'));
    if (details) root.append(details);
    return root;
}

/** Block „Tagesgeld auffüllen“ (FR-77 Punkt 3). @param {Document} doc @param {CashRefill} refill */
export function createCashRefill(doc, refill) {
    const root = make(doc, 'div', undefined, 'todo-refill'); root.dataset.todoCashRefill = '';
    root.append(make(doc, 'strong', 'Tagesgeld auffüllen'),
        // WT-1c (Befund 2): Gilt die eiserne Reserve als Ziel, nennt der Satz sie statt der Monate Entnahme.
        make(doc, 'p', refill.ironReserve
            ? `Dein Tagesgeld (${todoMoney(refill.tagesgeld)}) liegt unter der eisernen Reserve von ${upMoney(refill.target)}.`
            : `Dein Tagesgeld reicht noch für ${refill.months} ${refill.months === 1 ? 'Monat' : 'Monate'} Entnahme (${todoMoney(refill.tagesgeld)}). Ziel sind ${refill.targetMonths} Monate (${upMoney(refill.target)}).`));
    // Ergänzung 2 FR-78: Mit Personenzeilen ist der Betrag die Summe der angezeigten Personenbeträge.
    const perPerson = refill.rows.length > 1 || refill.household && refill.rows.length;
    const total = perPerson ? refill.rows.reduce((sum, row) => sum + displayUp(row.amount), 0) : displayUp(refill.amount);
    const line = make(doc, 'div', undefined, 'todo-main todo-refill-amount');
    line.append(make(doc, 'span', todoMoney(total), 'todo-main-amount'), make(doc, 'span', 'vom Geldmarkt aufs Tagesgeld umschichten'));
    root.append(line);
    root.append(make(doc, 'p', 'Kein Aktienverkauf. Die Steuer auf den Geldmarkt zeigt dir der Dialog.', 'ds-source'));
    const entry = (/** @type {CashRefill['rows'][number]} */ row, /** @type {string} */ label) => {
        const button = make(doc, 'a', 'Umschichtung eintragen', 'ds-button ds-button-secondary');
        button.setAttribute('href', saleEntryHref(row.saleTarget)); button.setAttribute('data-profile-handoff', ''); button.dataset.todoRefillEntry = row.profileId || '';
        if (label) button.setAttribute('aria-label', `Umschichtung für ${label} eintragen`);
        return button;
    };
    // WT-1b: Bei zwei Personen nennt der Hinweis je Person den Betrag und hat je Person einen Knopf.
    // WT-1c (Befund 4): im Haushalt auch, wenn nur eine Person umschichten muss.
    if (perPerson) {
        for (const row of refill.rows) {
            const line = make(doc, 'div', undefined, 'todo-destination todo-refill-person'); line.dataset.todoRefillPerson = row.profileId || '';
            const name = row.name || 'Person';
            line.append(make(doc, 'span', name), make(doc, 'span', upMoney(row.amount), 'todo-destination-amount'), entry(row, name));
            root.append(line);
        }
        return root;
    }
    const actions = make(doc, 'div', undefined, 'todo-actions'); actions.append(entry(refill.rows[0], '')); root.append(actions);
    return root;
}

/** Verdeckter Bärenmarkt (FR-77 Punkt 5): Abstand, drei Kurse, Folgen und Hinweis auf die Wahl. In der Balance mit
 * zugeklapptem Kursverlauf; im Jahresabschluss mit der Wahl darunter (`choice`).
 * @param {Document} doc @param {MarketView} view @param {{annual?: boolean, choice?: HTMLElement|null}} [options] */
export function createHiddenBearBlock(doc, view, { annual = false, choice = null } = {}) {
    const root = make(doc, 'section', undefined, 'todo-bear'); root.dataset.hiddenBear = annual ? 'annual' : 'balance';
    const year = Number(view.yearEndDate.slice(0, 4)) + 1;
    const high = view.yearlyHigh || { price: view.high.high.value, asOf: view.high.high.asOf };
    const today = view.quote?.price ?? view.rule.index;
    const gap = high.price > 0 ? (high.price - today) / high.price * 100 : 0;
    const change = Number.isFinite(view.rule.changeSinceYearEndPct) ? /** @type {number} */ (view.rule.changeSinceYearEndPct) : 0;
    const changeText = `${change < 0 ? 'ein Minus' : 'ein Plus'} von ${percent(change)}`;
    const head = make(doc, 'div', undefined, 'todo-bear-head');
    head.append(make(doc, 'span', annual ? 'Wahl nötig' : 'Prüfen', 'todo-bear-badge'), make(doc, 'h4', 'Bärenmarkt, den die Jahresregel nicht sieht'));
    root.append(head);
    root.append(make(doc, 'p', annual
        ? `Aktien liegen ${percent(gap)} unter dem Jahreshoch vom ${marketChoiceDate(high.asOf)}. Nach Kursen zum Jahresende (Ende ${year - 1} → Ende ${year}: ${change < 0 ? '−' : '+'}${percent(change)}) wäre es kein Bärenmarkt. Welcher Plan soll gelten?`
        : `Aktien liegen heute ${percent(gap)} unter dem Jahreshoch vom ${marketChoiceDate(high.asOf)}. Der Jahresabschluss vergleicht nur Kurse zum Jahresende: Von Ende ${year - 1} bis heute ist das ${changeText}, also kein Bärenmarkt. Gemessen am Jahreshoch ist es einer.`));
    if (!annual) {
        const tiles = make(doc, 'div', undefined, 'todo-bear-tiles');
        for (const [label, value, note] of /** @type {[string, number, string][]} */ ([[`Ende ${year - 1}`, view.stored.index, ''],
            [`Jahreshoch ${marketChoiceDate(high.asOf).slice(0, 6)}`, high.price, ''], ['Heute', today, `${percent(gap)} unter dem Hoch`]])) {
            const tile = make(doc, 'div', undefined, 'todo-bear-tile');
            tile.append(make(doc, 'span', label, 'ds-source'), make(doc, 'strong', price(value)));
            if (note) tile.append(make(doc, 'span', note, 'todo-bear-gap'));
            tiles.append(tile);
        }
        root.append(tiles);
        const rule = view.comparison.rule, highVariant = view.comparison.high;
        if (rule && highVariant) {
            root.append(make(doc, 'h5', `Was das für ${year + 1} heißt`, 'todo-bear-subtitle'));
            // FR-78: Monatsbudgets abgerundet; der Unterschied ergibt sich aus den gezeigten Beträgen.
            const delta = (displayMonthlyDown(highVariant.monthlyBudget) ?? 0) - (displayMonthlyDown(rule.monthlyBudget) ?? 0);
            const budget = make(doc, 'span', budgetMoney(highVariant.monthlyBudget));
            if (Math.round(delta) !== 0) budget.append(make(doc, 'small', ` (${delta < 0 ? '−' : '+'}${todoMoney(Math.abs(delta))})`, 'todo-bear-gap'));
            // WT-1b: Die Zeile heißt nur dann „Verkauf im Januar“, wenn keine der beiden Varianten kauft.
            const verbs = [rule, highVariant].map(variant => variant.mainAction.text).filter(text => text !== 'Nichts tun');
            const buys = verbs.filter(text => / kaufen$/.test(text)).length, sells = verbs.length - buys;
            const rowLabel = buys && sells ? 'Handlung im Januar' : buys ? 'Kauf im Januar' : 'Verkauf im Januar';
            const sale = (/** @type {typeof rule} */ variant) => variant.mainAction.text === 'Nichts tun' ? buys && sells ? 'nichts' : buys ? 'kein Kauf' : 'kein Verkauf'
                : `${variant.mainAction.text}${Number.isFinite(variant.mainAction.netAmount) ? ` · ${todoMoney(displayActionAmount(variant.mainAction.text, variant.mainAction.netAmount))}` : ''}`;
            const comparison = table(doc, ['', 'Kurse zum Jahresende', 'Mit dem Jahreshoch'], [
                ['Marktlage', 'kein Bärenmarkt', 'Bärenmarkt'],
                [`Monatsbudget ${year + 1}`, budgetMoney(rule.monthlyBudget), budget],
                [rowLabel, sale(rule), sale(highVariant)]], `Was das für ${year + 1} heißt`);
            comparison.className = `${comparison.className} todo-bear-table`;
            root.append(comparison);
        }
        root.append(make(doc, 'p', `Im Jahresabschluss wählst du, welcher Plan für ${year + 1} gilt. Bis dahin ändert sich nichts.`));
        const history = /** @type {HTMLDetailsElement} */ (make(doc, 'details', undefined, 'todo-bear-history'));
        history.dataset.marketHistoryDetails = '';
        history.append(make(doc, 'summary', `Kursverlauf ${year}`), createMarketHistory(doc, view, false));
        root.append(history);
    }
    if (choice) root.append(choice);
    return root;
}

/** Jahresabschluss, Schritt „Plan“: wie viel vom alten Plan umgesetzt wurde (FR-77 Punkt 6). `result` ist die Kurzform im Ergebnis.
 * @param {Document} doc @param {{year: number, status: string|null, soldNet: number, planNet: number, lines?: {planNet: number}[]}} progress @param {boolean} [result] */
export function createPlanProgressNote(doc, progress, result = false) {
    const root = make(doc, 'div', undefined, 'todo-progress-note'); root.dataset.annualPlanProgress = progress.status || 'offen';
    const head = make(doc, 'div', undefined, 'todo-status-head');
    if (result) head.append(make(doc, 'strong', `Plan ${progress.year} · ${annualPlanStatusText(progress.status)}`));
    else {
        const status = progress.status === 'erledigt' || progress.status === 'teilweise' ? progress.status : 'offen';
        const chip = make(doc, 'span', status === 'erledigt' ? 'Umgesetzt' : status === 'teilweise' ? 'Teilweise umgesetzt' : 'Nicht umgesetzt',
            `ds-plan-chip todo-chip todo-chip-${status}${status === 'erledigt' ? ' ds-chip-success' : ''}`);
        chip.dataset.todoStatus = status;
        head.append(chip, make(doc, 'strong', `Plan ${progress.year}`));
    }
    const plan = progress.lines?.length ? progress.lines.reduce((sum, line) => sum + displayUp(line.planNet), 0) : displayUp(progress.planNet);
    root.append(head, make(doc, 'p', `${todoMoney(progress.soldNet)} von ${todoMoney(plan)} verkauft. ${result
        ? 'Der neue Plan ersetzt ihn.' : `Der Plan ${progress.year + 1} rechnet mit deinem Bestand vom 31.12.`}`));
    return root;
}

/** Dialog „Details & Drucken“ im Planmodus: der Beleg mit Brutto, Steuer und Tranche je Zeile, dazu der Stand.
 * Gibt Inhalt und Kopiertext zurück. @param {Document} doc @param {TodoPlan} plan @param {any} action Aktion des Jahresbelegs
 * @param {{id: string, name: string}[]} [people] Personen des Umfangs für Belege ohne Personennamen */
export function createPlanDetails(doc, plan, action, people = []) {
    const root = make(doc, 'section', undefined, 'todo-plan-details'); root.dataset.todoPlanDetails = '';
    const title = make(doc, 'h2', `Plan ${plan.year} · Handlungsanweisung aus dem Jahresabschluss`); title.id = 'balancePlanDetailsTitle';
    const texts = [title.textContent || ''];
    root.append(title);
    const lead = plan.decidedOn ? `Beschlossen im Jahresabschluss am ${plan.decidedOn}. ${decisionText(plan)}` : 'Die App bucht nichts.';
    root.append(make(doc, 'p', lead, 'ds-source')); texts.push(lead);
    const sources = (Array.isArray(action?.quellen) ? action.quellen : []).filter((/** @type {any} */ source) => source.brutto > 0 && !source.internalCashRebalance);
    const purchase = (/** @type {any} */ source) => {
        const date = typeof source?.purchaseDate === 'string' ? source.purchaseDate : '';
        const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), month = /^(\d{4})-(\d{2})$/.exec(date);
        return full ? `Kauf ${full[3]}.${full[2]}.${full[1]}` : month ? `Kauf ${month[2]}/${month[1]}` : '—';
    };
    if (sources.length) {
        const rows = sources.map((/** @type {any} */ source) => {
            const row = plan.rows.find(entry => entry.trancheId && entry.trancheId === stockTrancheId(source.trancheId, entry.profileId)) || null;
            const who = row?.who || source.sourceProfileName || people.find(person => person.id === source.sourceProfileId)?.name
                || (people.length === 1 ? people[0].name : '—');
            const state = row ? row.status === 'erledigt' ? 'erledigt' : row.status === 'teilweise' ? `teilweise · ${todoMoney(row.restNet)} offen` : 'offen' : '—';
            const cash = ['liquiditaet', 'cash'].includes(source.kind) || source.source === 'Liquidität';
            // WT-1b: Wertpapier mit ISIN und Beträge mit Cent, wie im Beleg (Handbuch „Details & Drucken“).
            const security = [source.name || source.kind || 'Wertpapier', source.isin && source.isin !== source.name ? source.isin : null].filter(Boolean).join(' · ');
            return [who, cash ? 'aus dem Tagesgeld' : security, cash ? '—' : purchase(source), centMoney(source.brutto), centMoney(source.steuer), centMoney(source.netto), state];
        });
        const sum = (/** @type {string} */ field) => sources.reduce((/** @type {number} */ total, /** @type {any} */ source) => total + (Number.isFinite(source[field]) ? source[field] : 0), 0);
        const box = make(doc, 'div', undefined, 'ds-table-box todo-table-box');
        const element = make(doc, 'table', undefined, 'ds-table todo-table'); element.setAttribute('aria-label', 'Verkäufe laut Beleg');
        const head = make(doc, 'thead'), headRow = make(doc, 'tr');
        const headings = ['Wer', 'Wertpapier', 'Tranche', 'Brutto', 'Steuer', 'Netto', 'Stand'];
        headings.forEach((text, index) => { const cell = make(doc, 'th', text, index >= 3 && index <= 5 ? 'ds-num' : undefined); cell.setAttribute('scope', 'col'); headRow.append(cell); });
        head.append(headRow); element.append(head);
        const body = make(doc, 'tbody');
        for (const values of [...rows, ['Summe', '', '', centMoney(sum('brutto')), centMoney(sum('steuer')), centMoney(sum('netto')), '']]) {
            const row = make(doc, 'tr');
            values.forEach((value, index) => row.append(make(doc, 'td', value, index >= 3 && index <= 5 ? 'ds-num' : undefined)));
            body.append(row); texts.push(values.filter(Boolean).join(' | '));
        }
        element.append(body); box.append(element);
        root.append(make(doc, 'h3', 'Woher das Geld kommt'), box);
        texts.splice(2, 0, 'Woher das Geld kommt', headings.join(' | '));
    }
    if (plan.destinations.length) {
        root.append(make(doc, 'h3', 'Wohin das Geld geht'), destinationsBlock(doc, plan.destinations, false, centMoney));
        texts.push('Wohin das Geld geht', ...plan.destinations.map(entry => `${entry.label}: ${centMoney(entry.amount)}`));
    }
    if (plan.status) {
        const state = plan.status === 'offen' ? 'Noch kein Verkauf eingetragen.' : plan.status === 'teilweise'
            ? `${todoMoney(plan.soldNet)} von ${todoMoney(plan.planNet)} verkauft.` : 'Alle Verkäufe aus dem Plan sind eingetragen.';
        root.append(make(doc, 'p', `Stand: ${state}`)); texts.push(`Stand: ${state}`);
    }
    if (action?.type === 'NONE') { root.append(make(doc, 'p', plan.text || 'Nichts tun')); texts.push(plan.text || 'Nichts tun'); }
    return { root, text: texts.filter(Boolean).join('\n') };
}
