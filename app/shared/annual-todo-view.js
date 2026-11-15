// FR-77: gemeinsamer Baustein „Was zu tun ist“ für Balance (Karte) und Jahresabschluss (Ergebnis, Schritt „Plan“).
// Nur Darstellung; Zahlen kommen aus `app/balance/annual-todo.js` und der fertigen Marktprojektion.
import { formatDisplayNumber } from './designsystem-number-format.js';
import { saleEntryHref, todoDate, annualPlanStatusText, stockTrancheId } from '../balance/annual-todo.js';
import { createMarketHistory } from '../balance/balance-market-history.js';
import { displayUp, displayMonthlyDown, displayDown, displayActionAmount, displayedBuyTotal } from './display-rounding.js';
import { BANK_ORDER_DATE_MISSING_HINT } from '../../types/sale-fifo.js';

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
const shownBuyPlan = displayedBuyTotal;
/** Ergänzung 2 FR-78: Summen aus den angezeigten Beträgen. Plan = Summe der angezeigten Zeilen, ohne Zeilen der gerundete Betrag.
 * VK-3d P4: Ein reiner Kaufplan mit Zeilen je Person nimmt deren Summe.
 * @param {{rows: {planNet: number}[], amount?: number|null}} plan @returns {number|null} */
const shownPlan = plan => plan.rows.length ? plan.rows.reduce((sum, row) => sum + displayUp(row.planNet), 0)
    : /** @type {any} */ (plan).buyFlow?.lines?.length ? shownBuyPlan(/** @type {any} */ (plan).buyFlow.lines)
        : Number.isFinite(plan.amount) ? displayActionAmount(/** @type {any} */ (plan).verb, plan.amount) : null;
/** VN-1 Punkt 4 (FR-78 Ergänzung 3): Plan, verkauft bzw. gekauft und offen einer Karte auf den Euro. Je Zeile werden Plan und Erledigtes
 * auf den Euro gerundet, offen ist ihr Unterschied (erledigte Zeilen 0). So geht Plan − verkauft = offen sichtbar auf, in der Standzeile,
 * in den Zeilen und im Jahresabschluss. Nur die Handlungszeile bleibt gerundet („ca.“).
 * @param {{plan: number, done: number, open: number}[]} rows genaue Werte je Zeile */
export function euroProgress(rows) {
    // VN-2 (Codex F03, Gemini 3.3): Erledigte Zeilen mit Fehlbetrag oder bewusst belassenem Rest zählen als „weniger als geplant“,
    // ein Überkauf bzw. Mehrverkauf als „mehr als geplant“. So geht Plan = erledigt + offen + weniger − mehr immer auf.
    const parts = rows.map(row => {
        const plan = Math.round(row.plan), done = Math.round(row.done);
        const open = row.open > 0 ? Math.max(0, plan - done) : 0;
        return { plan, done, open, less: row.open > 0 ? 0 : Math.max(0, plan - done), more: Math.max(0, done - plan) };
    });
    const total = (/** @type {'plan'|'done'|'open'|'less'|'more'} */ key) => parts.reduce((sum, row) => sum + row[key], 0);
    return { parts, plan: total('plan'), done: total('done'), open: total('open'), less: total('less'), more: total('more') };
}
/** Ausgleichsposten der Standzeile („ · 5.000 € weniger als geplant“). @param {{less: number, more: number}} progress */
// VN-4 (Abnahme ST-4): Steht ein Ausgleichsposten da, nennt die Zeile auch den offenen Rest; sonst ist Plan = erledigt + offen + weniger − mehr
// nicht ablesbar (Überkauf in einer Zeile, andere Zeile offen).
export const progressBalanceText = (/** @type {{open?: number, less: number, more: number}} */ progress) => [
    (progress.open ?? 0) > 0 && (progress.less > 0 || progress.more > 0) ? ` · ${todoMoney(/** @type {number} */ (progress.open))} offen` : '',
    progress.less > 0 ? ` · ${todoMoney(progress.less)} weniger als geplant` : '',
    progress.more > 0 ? ` · ${todoMoney(progress.more)} mehr als geplant` : ''].join('');
/** @param {{planNet: number, soldNet: number, restNet: number}[]} rows */
const saleProgress = rows => euroProgress(rows.map(row => ({ plan: row.planNet, done: row.soldNet, open: row.restNet })));
/** @param {{amount: number, bought: number, restAmount: number}[]} lines */
const buyProgress = lines => euroProgress(lines.map(line => ({ plan: line.amount, done: line.bought, open: line.restAmount })));
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

/** Hauptzeile mit Verb und angezeigtem Netto-Betrag (FR-78). `approx`: gerundeter Betrag mit „ca.“ (VN-1 Punkt 4).
 * @param {Document} doc @param {string} verb @param {number|null} amount @param {string} note @param {boolean} [approx] */
function mainLine(doc, verb, amount, note, approx = false) {
    const line = make(doc, 'div', undefined, 'todo-main');
    line.append(make(doc, 'span', verb, 'todo-main-verb'));
    if (amount !== null && Number.isFinite(amount)) line.append(make(doc, 'span', `${approx ? 'ca. ' : ''}${todoMoney(amount)}`, 'todo-main-amount'));
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

/** Stand je Zeile: „offen“, „Teilweise 30.638 € am … · 49.312 € offen“, „Erledigt am …“, bei Rest „Erledigt am … · 5.050 € weniger als geplant“.
 * @param {Document} doc @param {TodoPlan['rows'][number]} row @param {boolean} [revoke] Knopf „Rest doch verkaufen“ */
function rowState(doc, row, revoke = false) {
    const cell = make(doc, 'span', undefined, 'todo-row-state');
    cell.append(statusChip(doc, row.status, true));
    // FR-79 Punkt 11: bewusst weniger verkauft; „Rest doch verkaufen“ nimmt die Entscheidung zurück (nur in der Balance).
    if (/** @type {any} */ (row).keptInDepot) {
        cell.append(make(doc, 'span', ' · Rest bleibt im Depot', 'ds-source'));
        if (revoke) {
            const button = make(doc, 'button', 'Rest doch verkaufen', 'sale-flow-link todo-row-revoke'); button.setAttribute('type', 'button');
            button.dataset.saleFlowRevoke = /** @type {any} */ (row).key || ''; cell.append(make(doc, 'br'), button);
        }
        return cell;
    }
    const date = todoDate(row.lastSaleAt);
    const shown = saleProgress([row]);
    if (row.status === 'teilweise') {
        cell.append(make(doc, 'span', ` ${todoMoney(shown.done)}${date ? ` am ${date}` : ''} · ${todoMoney(shown.open)} offen`, 'ds-source'));
        // Gutachten VK-1 P3-2: „Rest bleibt im Depot“ lässt sich hier nachholen (derselbe Schreibweg wie „Rest doch verkaufen“).
        if (revoke) {
            const button = make(doc, 'button', 'Rest bleibt im Depot', 'sale-flow-link todo-row-keep'); button.setAttribute('type', 'button');
            button.dataset.saleFlowKeep = /** @type {any} */ (row).key || ''; cell.append(make(doc, 'br'), button);
        }
    }
    else if (row.status === 'erledigt') {
        // Ergänzung 3 FR-78: Erledigt nach der Rundungsstaffel, aber weniger verkauft als geplant → fehlenden Betrag auf den Euro nennen.
        const missing = shown.plan - shown.done;
        // VN-3 (Gemini Befund 4): ein Mehrverkauf je Zeile steht ebenso da wie in der Standzeile.
        const rest = !Number.isFinite(missing) ? '' : missing >= 1 ? ` · ${todoMoney(missing)} weniger als geplant` : missing <= -1 ? ` · ${todoMoney(-missing)} mehr als geplant` : '';
        if (date || rest) cell.append(make(doc, 'span', `${date ? ` am ${date}` : ''}${rest}`, 'ds-source'));
    }
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
 * `plan.flow` (nur Balance) ist der Stand des geführten Verkaufs aus `projectSaleFlowCard`; die Balance bindet den Startknopf.
 * @param {Document} doc @param {TodoPlan} plan @param {{detailsButton?: boolean}} [options] */
export function createTodoPlan(doc, plan, { detailsButton = true } = {}) {
    const flow = /** @type {any} */ (plan).flow || null;
    const root = make(doc, 'div', undefined, 'todo-plan');
    root.dataset.todoPlan = plan.status || 'none';
    if (plan.status !== 'erledigt' && plan.decidedOn) {
        root.append(make(doc, 'p', `Beschlossen im Jahresabschluss am ${plan.decidedOn}. ${decisionText(plan)}`, 'ds-source todo-decided'));
    }
    // VK-3d P11 (TRG-1c P2-03): Modus des Belegs „Eine Person trägt · <Name>“ auch in der Karte, wie in „Details & Drucken“.
    const carrierText = /** @type {any} */ (plan).carrierText;
    if (carrierText) { const line = make(doc, 'p', carrierText, 'ds-source todo-decided'); line.dataset.todoCarrierMode = ''; root.append(line); }
    if (plan.marketReading?.reading === 'year_high') {
        const chosen = make(doc, 'p', `Plan mit dem Jahreshoch vom ${marketChoiceDate(plan.marketReading.asOf)} (Wahl im Jahresabschluss)`, 'ds-source todo-decided');
        chosen.dataset.annualMarketChoiceLabel = ''; root.append(chosen);
    }
    if (plan.status) {
        const status = make(doc, 'div', undefined, 'todo-status');
        const head = make(doc, 'div', undefined, 'todo-status-head');
        const missingCredit = flow?.allEntered && flow.pendingNames.length;
        if (missingCredit) {
            const chip = make(doc, 'span', 'Gutschrift fehlt', 'ds-plan-chip todo-chip todo-chip-teilweise ds-chip-warning'); chip.dataset.todoStatus = 'gutschrift';
            head.append(chip, make(doc, 'span', `${plan.rows.length === 2 ? 'Beide Verkäufe' : 'Alle Verkäufe'} eingetragen · die Gutschrift von ${flow.pendingNames.join(' und ')} steht noch aus`, 'todo-status-text'));
        } else head.append(statusChip(doc, plan.status), make(doc, 'span', plan.status === 'offen' ? 'Noch kein Verkauf eingetragen.'
            : plan.status === 'teilweise' ? `${todoMoney(saleProgress(plan.rows).done)} von ${todoMoney(saleProgress(plan.rows).plan)} verkauft${progressBalanceText(saleProgress(plan.rows))}`
                : `Alle Verkäufe aus dem Plan ${plan.year} sind eingetragen${plan.lastSaleDate ? `, zuletzt am ${plan.lastSaleDate}` : ''}${progressBalanceText(saleProgress(plan.rows))}.`, 'todo-status-text'));
        status.append(head);
        if (plan.status === 'teilweise' || missingCredit) {
            const bar = make(doc, 'div', undefined, 'todo-progress'), fill = make(doc, 'i');
            const share = Math.round(plan.share * 100);
            bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${share} Prozent erledigt`);
            fill.style.width = `${share}%`; bar.append(fill); status.append(bar);
        }
        root.append(status);
    }
    if (plan.nothing) root.append(mainLine(doc, 'Nichts tun', null, plan.text && plan.text !== 'Nichts tun' ? plan.text.replace(/^Nichts tun – /, '') : ''));
    else if (plan.status === 'teilweise') root.append(mainLine(doc, 'Noch offen', saleProgress(plan.rows).open, `${plan.openSecurities.join(', ') || 'Wertpapiere'}, netto`));
    else if (plan.status !== 'erledigt') root.append(mainLine(doc, plan.verb, shownPlan(plan),
        // GH-1 Punkt 2 (FR-78 Ergänzung 5): Die gerundete Steuer ist ein ungefährer Wert („ca.“), Rundung nach der Staffel (Ergänzung 4).
        plan.status ? plan.tax >= 0.5 ? `netto, Steuer ca. ${upMoney(plan.tax)} schon abgezogen` : 'netto' : '', true));
    // VN-1 Punkt 4: Die Zeilen nennen den Plan auf den Euro, wie Standzeile und Ablauf.
    if (plan.rows.length) root.append(table(doc, ['Wer', 'Wertpapier', 'Betrag netto', 'Stand'],
        plan.rows.map(row => [row.who, securityCell(doc, row), todoMoney(saleProgress([row]).plan), rowState(doc, row, Boolean(flow))]), `Plan ${plan.year} je Person`));
    for (const credit of plan.credits) {
        const note = make(doc, 'div', undefined, 'todo-credit'); note.dataset.todoCredit = '';
        // FR-79: Die Gutschrift trägst du im geführten Verkauf ein (Schritt 4); Ergänzung 1 Punkt 4: Hinweis mit Betrag und Richtung.
        const entry = make(doc, 'button', 'Gutschrift eintragen', 'ds-button ds-button-secondary'); entry.setAttribute('type', 'button');
        entry.dataset.saleFlowStart = '4';
        note.append(make(doc, 'strong', 'Gutschrift nachtragen'),
            make(doc, 'p', `Zum Verkauf vom ${credit.date}${credit.who ? ` (${credit.who})` : ''} fehlt die Gutschrift auf dem Tagesgeld (${todoMoney(credit.amount)}). Gutschrift unterwegs: Vermögen um ${centMoney(credit.amount)} zu niedrig, bis du sie einträgst.`));
        if (flow) note.append(entry);
        root.append(note);
    }
    const buyFlow = /** @type {any} */ (plan).buyFlow || null;
    if (plan.destinations.length && (plan.status === 'offen' || plan.status === null) && !plan.nothing) root.append(destinationsBlock(doc, plan.destinations, true, null, shownPlan(plan), plan.rows.length ? displayUp : displayDown));
    else if (plan.purchases.length && !plan.nothing) root.append(destinationsBlock(doc, plan.purchases, true, null, plan.rows.length ? null : shownPlan(plan), displayDown));
    // VK-2 (FR-79 Punkt 7): Käufe aus dem Plan mit Stand je Person wie die Verkäufe; „Käufe verfolgt die App nicht“ entfällt.
    if (buyFlow && !plan.nothing) root.append(buyFlowBlock(doc, buyFlow));
    if (flow?.buys?.length) root.append(moneyMarketBlock(doc, flow.buys));
    if (flow?.unreadable?.length) root.append(make(doc, 'p', `Das Tagesgeld von ${flow.unreadable.join(' und ')} ist nicht lesbar. In Schritt 5 siehst du, was zu tun ist.`, 'ds-note ds-note-warning todo-flow-unreadable'));
    const actions = make(doc, 'div', undefined, 'todo-actions');
    const resume = flow && flow.next && flow.started;
    if (resume) root.append(flowSteps(doc, flow));
    if (plan.status === 'offen' || plan.status === 'teilweise' || resume) {
        // FR-79 Punkt 2: „Verkauf starten“ öffnet den geführten Verkauf in der Balance; nach einer Unterbrechung „Weiter mit Schritt n“.
        const sale = make(doc, 'button', resume ? `Weiter mit Schritt ${flow.next}` : 'Verkauf starten', 'ds-button ds-button-primary');
        sale.setAttribute('type', 'button'); sale.dataset.todoSaleEntry = ''; sale.dataset.saleFlowStart = String(resume ? flow.next : 1);
        actions.append(sale);
    }
    if (buyFlow && !plan.nothing && (!buyFlow.allEntered || buyFlow.next)) {
        // VK-2: „Kauf starten“ öffnet den geführten Kauf in der Balance; nach einer Unterbrechung „Weiter mit Schritt n“, auch neben Verkaufszeilen.
        const resumeBuy = buyFlow.started && buyFlow.next;
        const buy = make(doc, 'button', resumeBuy ? `Kauf: weiter mit Schritt ${buyFlow.next}` : 'Kauf starten', plan.rows.length ? 'ds-button ds-button-secondary' : 'ds-button ds-button-primary');
        buy.setAttribute('type', 'button'); buy.dataset.todoPurchaseEntry = ''; buy.dataset.buyFlowStart = String(resumeBuy ? buyFlow.next : 1);
        actions.append(buy);
    } else if (!plan.rows.length && plan.purchases.length && !plan.nothing && !buyFlow) {
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
    if (resume) root.append(make(doc, 'p', 'Der Stand kommt aus dem, was eingetragen ist.', 'ds-source todo-flow-note'));
    return root;
}

/** Wertpapier einer Planzeile mit Bestand und ISIN (FR-79 Punkt 2). @param {Document} doc @param {any} row */
function securityCell(doc, row) {
    const cell = make(doc, 'span', undefined, 'todo-security');
    cell.append(make(doc, 'span', row.security));
    if (row.securityDetail) cell.append(make(doc, 'small', row.securityDetail, 'ds-source todo-security-detail'));
    return cell;
}

/** Stand der fünf Schritte des geführten Verkaufs (Ergänzung 1 FR-79 Punkt 7). @param {Document} doc @param {any} flow */
function flowSteps(doc, flow) {
    // VN-1 Punkt 10: kompakte Chips wie die Schrittkacheln im Dialog (Kreis mit ✓ oder Nummer, aktueller Schritt hervorgehoben), ohne Listennummern.
    const list = make(doc, 'ol', undefined, 'todo-flow-steps'); list.dataset.todoFlowSteps = '';
    list.setAttribute('aria-label', 'Schritte');
    for (const [index, step] of flow.steps.entries()) {
        const current = index + 1 === flow.next;
        const item = make(doc, 'li', undefined, `todo-flow-step${step.done ? ' todo-flow-step-done' : ''}${current ? ' todo-flow-step-current' : ''}`);
        if (current) item.setAttribute('aria-current', 'step');
        const symbol = make(doc, 'span', step.done ? '✓' : String(index + 1), 'todo-flow-step-symbol'); symbol.setAttribute('aria-hidden', 'true');
        item.append(symbol, make(doc, 'span', step.title, 'todo-flow-step-name'));
        if (step.done) item.setAttribute('aria-label', `${step.title} · erledigt`);
        list.append(item);
    }
    return list;
}

/** VK-2 (FR-79 Punkt 7): Käufe aus dem Plan je Person mit Stand, offener Abbuchung („Abbuchung unterwegs“) und „Rest doch kaufen“.
 * @param {Document} doc @param {any} buyFlow Stand aus `projectBuyFlowCard` */
function buyFlowBlock(doc, buyFlow) {
    const root = make(doc, 'div', undefined, 'todo-buy-flow'); root.dataset.todoBuyFlow = '';
    const head = make(doc, 'div', undefined, 'todo-status-head');
    const status = buyFlow.allEntered ? 'erledigt' : buyFlow.bought > 0 ? 'teilweise' : 'offen';
    head.append(statusChip(doc, status), make(doc, 'span', status === 'offen' ? 'Noch kein Kauf eingetragen.'
        : status === 'teilweise' ? `${todoMoney(buyProgress(buyFlow.lines).done)} von ${todoMoney(buyProgress(buyFlow.lines).plan)} gekauft${progressBalanceText(buyProgress(buyFlow.lines))}`
            : `Alle Käufe aus dem Plan sind eingetragen${progressBalanceText(buyProgress(buyFlow.lines))}.`, 'todo-status-text'));
    root.append(make(doc, 'strong', 'Käufe aus dem Plan'), head);
    if (status === 'teilweise') {
        const bar = make(doc, 'div', undefined, 'todo-progress'), fill = make(doc, 'i');
        const share = Math.round(Math.min(1, buyFlow.bought / buyFlow.plan) * 100);
        bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${share} Prozent gekauft`); fill.style.width = `${share}%`; bar.append(fill); root.append(bar);
    }
    root.append(table(doc, ['Wer', 'Anlage', 'Betrag', 'Stand'], buyFlow.lines.map((/** @type {any} */ line) => {
        const cell = make(doc, 'span', undefined, 'todo-row-state');
        cell.append(statusChip(doc, line.status, true));
        if (line.keptCash) {
            cell.append(make(doc, 'span', ' · Rest bleibt auf dem Tagesgeld', 'ds-source'));
            const revoke = make(doc, 'button', 'Rest doch kaufen', 'sale-flow-link todo-row-revoke'); revoke.setAttribute('type', 'button'); revoke.dataset.buyFlowRevoke = line.key;
            cell.append(make(doc, 'br'), revoke);
        } else if (line.status === 'teilweise') cell.append(make(doc, 'span', ` ${todoMoney(buyProgress([line]).done)} gekauft · ${todoMoney(buyProgress([line]).open)} offen`, 'ds-source'));
        // VN-4 (ABS1 P3): Ein Überkauf oder Fehlbetrag je Zeile steht wie bei den Verkaufszeilen da.
        else if (line.status === 'erledigt' && progressBalanceText(buyProgress([line]))) cell.append(make(doc, 'span', progressBalanceText(buyProgress([line])), 'ds-source'));
        return [line.name, { equity: 'Aktien', gold: 'Gold', bonds: 'Anleihen', money_market: 'Geldmarkt' }[/** @type {string} */ (line.assetClass)] || line.assetClass,
            todoMoney(buyProgress([line]).plan), cell];
    }), 'Käufe aus dem Plan je Person'));
    for (const debit of buyFlow.pending) {
        const note = make(doc, 'div', undefined, 'todo-credit'); note.dataset.todoDebit = '';
        const entry = make(doc, 'button', 'Abbuchung eintragen', 'ds-button ds-button-secondary'); entry.setAttribute('type', 'button'); entry.dataset.buyFlowStart = '4';
        note.append(make(doc, 'strong', 'Abbuchung nachtragen'),
            make(doc, 'p', `Zum Kauf vom ${debit.date}${debit.who ? ` (${debit.who})` : ''} fehlt die Abbuchung vom Tagesgeld. Abbuchung unterwegs: Vermögen um ${centMoney(debit.amount)} zu hoch, bis du sie einträgst.`), entry);
        root.append(note);
    }
    if (buyFlow.started && buyFlow.next) root.append(flowSteps(doc, buyFlow));
    return root;
}

/** VK-2b P2-2: offene Abbuchungen ohne passende Planzeile (Kauf ohne Plan, „Geldmarkt kaufen“) mit „Abbuchung eintragen“.
 * @param {Document} doc @param {{date: string, amount: number, who: string}[]} debits @param {string[]} ids */
export function createOpenDebitsNote(doc, debits, ids) {
    const root = make(doc, 'div', undefined, 'todo-open-debits'); root.dataset.todoOpenDebits = '';
    for (const debit of debits) {
        const note = make(doc, 'div', undefined, 'todo-credit'); note.dataset.todoDebit = '';
        note.append(make(doc, 'strong', 'Abbuchung nachtragen'),
            make(doc, 'p', `Zum Kauf vom ${debit.date}${debit.who ? ` (${debit.who})` : ''} fehlt die Abbuchung vom Tagesgeld. Abbuchung unterwegs: Vermögen um ${centMoney(debit.amount)} zu hoch, bis du sie einträgst.`));
        root.append(note);
    }
    const entry = make(doc, 'button', 'Abbuchung eintragen', 'ds-button ds-button-secondary'); entry.setAttribute('type', 'button'); entry.dataset.buyDebitOpen = ids.join(',');
    root.append(entry);
    return root;
}

/** Ergänzung 1 FR-79 Punkt 6: Geldmarktkauf aus dem Verkaufserlös als eigene Zeile, je Person mit Knopf zu „Kauf eintragen“.
 * @param {Document} doc @param {{profileId: string, name: string, amount: number, href: string}[]} buys */
function moneyMarketBlock(doc, buys) {
    const root = make(doc, 'div', undefined, 'todo-refill todo-money-market'); root.dataset.todoMoneyMarket = '';
    const total = buys.reduce((sum, buy) => sum + displayActionAmount(' kaufen', buy.amount), 0);
    root.append(make(doc, 'strong', 'Geldmarkt kaufen'));
    const line = make(doc, 'div', undefined, 'todo-main todo-refill-amount');
    line.append(make(doc, 'span', todoMoney(total), 'todo-main-amount'), make(doc, 'span', 'aus dem Verkaufserlös in den Geldmarkt-ETF'));
    root.append(line);
    for (const buy of buys) {
        const row = make(doc, 'div', undefined, 'todo-destination todo-refill-person'); row.dataset.todoMoneyMarketPerson = buy.profileId;
        // VK-2: „Geldmarkt kaufen“ öffnet den geführten Kauf mit Person, Geldmarkt-ETF und Betrag (ersetzt die Übergangslösung aus VK-1).
        const link = make(doc, 'button', 'Kauf starten', 'ds-button ds-button-secondary'); link.setAttribute('type', 'button');
        link.dataset.buyFlowMoney = buy.profileId; link.dataset.buyFlowAmount = String(Math.round(buy.amount * 100) / 100);
        link.setAttribute('aria-label', `Geldmarktkauf für ${buy.name} starten`);
        row.append(make(doc, 'span', buy.name), make(doc, 'span', todoMoney(displayActionAmount(' kaufen', buy.amount)), 'todo-destination-amount'), link);
        root.append(row);
    }
    // Gutachten VK-1 P2-4: Einstieg in Schritt 5, damit „Lieber alles auf dem Tagesgeld lassen“ erreichbar bleibt.
    const distribute = make(doc, 'button', 'Geld verteilen', 'sale-flow-link todo-money-market-step'); distribute.setAttribute('type', 'button');
    distribute.dataset.saleFlowStart = '5';
    const hint = make(doc, 'p', 'Lieber alles auf dem Tagesgeld lassen? ', 'ds-source');
    hint.append(distribute); root.append(hint);
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
    // VN-2 P5 / DS-1 Punkt 7: wie die Karte – Handlungszeile gerundet mit „ca.“, Zeilen je Person auf den Euro.
    else root.append(mainLine(doc, plan.verb, shownPlan(plan), plan.rows.length ? 'netto' : '', true));
    if (plan.rows.length) root.append(table(doc, [], plan.rows.map(row => [`${row.who} · ${row.security}`, todoMoney(saleProgress([row]).plan)]), `Plan ${plan.year} je Person`));
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
        // RK-3 Punkt 3: Bei „Eine Person trägt“ zählt nur das eigene Ziel der tragenden Person.
        make(doc, 'p', refill.carrierNames?.length
            ? `Tagesgeld von ${refill.carrierNames.join(' und ')} (${todoMoney(refill.tagesgeld)}) liegt unter dem eigenen Ziel von ${upMoney(refill.target)}.`
            : refill.ironReserve
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

/** RK-2 (Ergänzung 1 FR-80): Hinweis statt Auftrag, wenn bei „Eine Person trägt“ das Tagesgeld der anderen Person unter ihrem Ziel
 * liegt. Wortlaut vorläufig (Bestätigung des Nutzers steht aus); nur hier ändern. @param {string} name */
export const HELD_BELOW_TARGET_TEXT = name => `${name} · Tagesgeld unter dem persönlichen Ziel. Bei „Eine Person trägt“ gibt es dafür keinen Auftrag; die Umschichtung entscheidest du selbst.`;

/** Je Person ein Hinweis in „Was zu tun ist“ (dort, wo sonst „Tagesgeld auffüllen“ stünde).
 * @param {Document} doc @param {{profileId?: string|null, name?: string|null}[]} people aus `heldBelowCashTarget` @returns {HTMLElement[]} */
export function createHeldCashNotes(doc, people) {
    return (people || []).map(person => {
        const note = make(doc, 'p', HELD_BELOW_TARGET_TEXT(person.name || 'Die andere Person'), 'ds-note todo-held-note');
        note.dataset.todoHeldNote = person.profileId || '';
        return note;
    });
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
 * @param {Document} doc @param {{year: number, status: string|null, soldNet: number, planNet: number, creditPendingNet?: number, lines?: {planNet: number, keptInDepot?: boolean}[]}} progress @param {boolean} [result] */
export function createPlanProgressNote(doc, progress, result = false) {
    const root = make(doc, 'div', undefined, 'todo-progress-note'); root.dataset.annualPlanProgress = progress.status || 'offen';
    const head = make(doc, 'div', undefined, 'todo-status-head');
    // FR-79 Punkt 11: Eine Zeile mit „Rest bleibt im Depot“ gilt als umgesetzt, der Rest bewusst im Depot.
    // VK-2b P2-4: Reine Kaufpläne zeigen den Stand der Käufe; bei Verkauf und Kauf stehen beide Zeilen.
    const buy = /** @type {any} */ (progress).buy || null, sales = Boolean(progress.lines?.length) || !buy;
    // VN-4 (ABS1 P3): Bei Verkauf und Kauf richtet sich der Status nach beiden Teilen (wie Karte und Details).
    const both = sales && buy ? [progress.status || 'offen', buy.status || 'offen'] : null;
    const overall = both ? both.every(item => item === 'erledigt') ? 'erledigt' : both.every(item => item === 'offen') ? 'offen' : 'teilweise'
        : sales ? progress.status : buy.status;
    const kept = sales ? overall === 'erledigt' && Boolean(progress.lines?.some(line => /** @type {any} */ (line).keptInDepot))
        : buy.status === 'erledigt' && buy.kept;
    if (result) head.append(make(doc, 'strong', `Plan ${progress.year} · ${kept ? `umgesetzt, Rest bewusst ${sales ? 'im Depot' : 'auf dem Tagesgeld'}` : annualPlanStatusText(overall)}`));
    else {
        const status = overall === 'erledigt' || overall === 'teilweise' ? overall : 'offen';
        const chip = make(doc, 'span', status === 'erledigt' ? 'Umgesetzt' : status === 'teilweise' ? 'Teilweise umgesetzt' : 'Nicht umgesetzt',
            `ds-plan-chip todo-chip todo-chip-${status}${status === 'erledigt' ? ' ds-chip-success' : ''}`);
        chip.dataset.todoStatus = status;
        head.append(chip, make(doc, 'strong', `Plan ${progress.year}`));
    }
    // VN-1 Punkt 4: dieselben Beträge auf den Euro wie die Standzeile der Karte.
    const sold = progress.lines?.length ? saleProgress(/** @type {any[]} */ (progress.lines)) : { done: Math.round(progress.soldNet), plan: Math.round(progress.planNet) };
    const bought = buy ? buy.lines?.length ? buyProgress(buy.lines) : { done: Math.round(buy.bought), plan: Math.round(buy.plan) } : null;
    const balance = (/** @type {any} */ value) => 'less' in value ? progressBalanceText(value) : '';
    const soldText = sales ? `${todoMoney(sold.done)} von ${todoMoney(sold.plan)} verkauft${balance(sold)}${kept && !result ? ', umgesetzt, Rest bewusst im Depot' : ''}. ` : '';
    const boughtText = bought ? `${todoMoney(bought.done)} von ${todoMoney(bought.plan)} gekauft${balance(bought)}${!sales && kept && !result ? ', umgesetzt, Rest bewusst auf dem Tagesgeld' : ''}. ` : '';
    root.append(head, make(doc, 'p', `${soldText}${boughtText}${result
        ? 'Der neue Plan ersetzt ihn.' : `Der Plan ${progress.year + 1} rechnet mit deinem Bestand vom 31.12.`}`));
    // Ergänzung 1 FR-79 Punkt 4: Geld unterwegs, solange eine Gutschrift fehlt.
    const pending = Number(/** @type {any} */ (progress).creditPendingNet) || 0;
    if (pending >= 0.005) root.append(make(doc, 'p', `Gutschrift unterwegs: Vermögen um ${centMoney(pending)} zu niedrig. Trag die Gutschrift in der Balance unter „Was zu tun ist“ ein.`, 'ds-note ds-note-warning todo-underway'));
    const debit = Number(/** @type {any} */ (progress).debitPendingNet) || 0;
    if (debit >= 0.005) root.append(make(doc, 'p', `Abbuchung unterwegs: Vermögen um ${centMoney(debit)} zu hoch. Trag die Abbuchung in der Balance unter „Was zu tun ist“ ein.`, 'ds-note ds-note-warning todo-underway'));
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
    // TRG-1c Punkt 5: Modus „Eine Person trägt“ mit tragender Person und Rückgriff aus dem Beleg.
    const carrier = /** @type {any} */ (plan).carrier;
    // TR-2 Befund 3: Der Modus des Belegs steht auch beim Vorgabemodus da („Entnahme: Steueroptimiert“).
    const decidedModeText = /** @type {any} */ (plan).decidedModeText;
    if (!carrier?.carrierId && decidedModeText) { const mode = `Entnahme: ${decidedModeText}`; root.append(make(doc, 'p', mode, 'ds-source')); texts.push(mode); }
    if (carrier?.carrierId) {
        const mode = `Entnahme: Eine Person trägt · ${carrier.carrierName || people.find(person => person.id === carrier.carrierId)?.name || 'tragende Person'}`;
        root.append(make(doc, 'p', mode, 'ds-source')); texts.push(mode);
        if (carrier.attacked?.length) {
            const note = carrierNoteText({ ...carrier, attacked: carrier.attacked.map((/** @type {any} */ row) => ({ ...row, name: row.name || people.find(person => person.id === row.profileId)?.name })) });
            root.append(make(doc, 'p', note, 'ds-note ds-note-warning todo-carrier-note')); texts.push(note);
        }
    }
    const sources = (Array.isArray(action?.quellen) ? action.quellen : []).filter((/** @type {any} */ source) => source.brutto > 0 && !source.internalCashRebalance);
    const purchaseDate = (/** @type {any} */ lot, /** @type {string} */ none) => {
        const date = typeof lot?.purchaseDate === 'string' ? lot.purchaseDate : '';
        const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), month = /^(\d{4})-(\d{2})$/.exec(date);
        return full ? `Kauf ${full[3]}.${full[2]}.${full[1]}` : month ? `Kauf ${month[2]}/${month[1]}` : none;
    };
    // RK-3 Punkt 2 (FR-82): Verkauft die Bank heute andere Tranchen derselben ISIN als der Beleg nennt, stehen diese da (wie Dialog und Abrechnung).
    const bankTranches = /** @type {Map<any, {tranches: any[], tax: number|null, rest: boolean}>|undefined} */ (/** @type {any} */ (plan).bankTranches);
    const purchase = (/** @type {any} */ source) => bankTranches?.get(source)?.tranches.length
        ? bankTranches.get(source)?.tranches.map(lot => purchaseDate(lot, 'Kauf ohne Datum')).join(' + ') : purchaseDate(source, '—');
    // RK-4 (FR-82): Brutto, Steuer und Netto bleiben die des Beschlusses; ein Satz nennt die Steuer mit der Bankreihenfolge wie der Dialog.
    const bankTaxNotes = /** @type {string[]} */ ([]);
    if (sources.length) {
        const rows = sources.map((/** @type {any} */ source) => {
            const row = plan.rows.find(entry => entry.trancheId && entry.trancheId === stockTrancheId(source.trancheId, entry.profileId)) || null;
            const who = row?.who || source.sourceProfileName || people.find(person => person.id === source.sourceProfileId)?.name
                || (people.length === 1 ? people[0].name : '—');
            const cash = ['liquiditaet', 'cash'].includes(source.kind) || source.source === 'Liquidität';
            // VN-3 (Fable P2-3): Käufe aus dem Tagesgeld zeigen den Stand der Kaufzeilen dieser Person wie die Karte.
            const buyLines = cash ? (/** @type {any} */ (plan).buyFlow?.lines || []).filter((/** @type {any} */ line) => line.profileId === source.sourceProfileId) : [];
            const state = row ? row.status === 'erledigt' ? 'erledigt' : row.status === 'teilweise' ? `teilweise · ${todoMoney(saleProgress([row]).open)} offen` : 'offen'
                : buyLines.length ? buyLines.every((/** @type {any} */ line) => line.status === 'erledigt') ? 'erledigt'
                    : buyProgress(buyLines).done > 0 ? `teilweise · ${todoMoney(buyProgress(buyLines).open)} offen` : 'offen' : '—';
            // WT-1b: Wertpapier mit ISIN und Beträge mit Cent, wie im Beleg (Handbuch „Details & Drucken“).
            const security = [source.name || source.kind || 'Wertpapier', source.isin && source.isin !== source.name ? source.isin : null].filter(Boolean).join(' · ');
            const bank = cash ? null : bankTranches?.get(source);
            if (bank && Number.isFinite(bank.tax)) bankTaxNotes.push(`${who}: Steuer laut Beschluss ${centMoney(source.steuer)}, mit der Bankreihenfolge ca. ${todoMoney(bank.tax)}${bank.rest ? ' für den offenen Rest' : ''}.`);
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
        for (const note of bankTaxNotes) { root.append(make(doc, 'p', note, 'ds-source')); texts.push(note); }
        // FR-82: Fehlt einer Tranche derselben ISIN das Kaufdatum, ist die Reihenfolge der Bank nur geschätzt.
        if (/** @type {any} */ (plan).bankOrderGuessed) {
            const hint = `${BANK_ORDER_DATE_MISSING_HINT}.`;
            root.append(make(doc, 'p', hint, 'ds-source')); texts.push(hint);
        }
    }
    if (plan.destinations.length) {
        root.append(make(doc, 'h3', 'Wohin das Geld geht'), destinationsBlock(doc, plan.destinations, false, centMoney));
        texts.push('Wohin das Geld geht', ...plan.destinations.map(entry => `${entry.label}: ${centMoney(entry.amount)}`));
    }
    if (plan.status) {
        const state = plan.status === 'offen' ? 'Noch kein Verkauf eingetragen.' : plan.status === 'teilweise'
            // VN-2 P4: dieselbe Rechnung auf den Euro wie die Karte (Plan − verkauft = offen).
            ? `${todoMoney(saleProgress(plan.rows).done)} von ${todoMoney(saleProgress(plan.rows).plan)} verkauft${progressBalanceText(saleProgress(plan.rows))}.`
            : `Alle Verkäufe aus dem Plan sind eingetragen${progressBalanceText(saleProgress(plan.rows))}.`;
        root.append(make(doc, 'p', `Stand: ${state}`)); texts.push(`Stand: ${state}`);
    }
    // VN-3 (Fable P2-3, Codex F03): Standzeile der Käufe mit derselben Gleichung wie Karte und Jahresabschluss.
    const buyFlow = /** @type {any} */ (plan).buyFlow;
    if (buyFlow?.lines?.length) {
        const progress = buyProgress(buyFlow.lines), status = buyFlow.allEntered ? 'erledigt' : buyFlow.bought > 0 ? 'teilweise' : 'offen';
        const state = status === 'offen' ? 'Noch kein Kauf eingetragen.' : status === 'teilweise'
            ? `${todoMoney(progress.done)} von ${todoMoney(progress.plan)} gekauft${progressBalanceText(progress)}.` : `Alle Käufe aus dem Plan sind eingetragen${progressBalanceText(progress)}.`;
        const line = `${plan.status ? 'Stand der Käufe' : 'Stand'}: ${state}`;
        root.append(make(doc, 'p', line)); texts.push(line);
    }
    if (action?.type === 'NONE') { root.append(make(doc, 'p', plan.text || 'Nichts tun')); texts.push(plan.text || 'Nichts tun'); }
    return { root, text: texts.filter(Boolean).join('\n') };
}

/** FR-80 Punkt 3: Hinweis, wenn bei „Eine Person trägt“ das Vermögen der anderen Person angegriffen wird.
 * @param {{carrierName?: string, attacked?: {name?: string, profileId: string}[]}} distribution @returns {string} */
export function carrierNoteText(distribution) {
    const names = (distribution.attacked || []).map(row => row.name || row.profileId);
    return `Vermögen von ${names.join(' und ')} wird angegriffen: ${distribution.carrierName ? `Das Vermögen von ${distribution.carrierName}` : 'Das Vermögen der tragenden Person'} reicht für den gemeinsamen Anteil nicht mehr.`;
}
