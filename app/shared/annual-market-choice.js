/** Auswahl und Herkunftszeile im Jahresabschluss; der Dialog besitzt den Entwurf. Die Auswahl steht im Schritt „Plan“ (FR-77). */
import { classifyMarketPreview } from '../balance/balance-market-preview.js';
import { formatDisplayNumber } from './designsystem-number-format.js';

/** @param {string|null} value */
export const marketChoiceDate = value => value?.split('-').reverse().join('.') || 'Datum nicht belegt';
/** @param {{reading?: string, asOf?: string}|null|undefined} reading */
export const annualMarketChoiceLabel = reading => reading?.reading === 'year_high'
    ? `Plan mit dem Jahreshoch vom ${marketChoiceDate(reading.asOf)} (Wahl im Jahresabschluss)` : 'Plan nach der Jahresendregel';

/** Wahl im Jahresabschluss, nur bei verdecktem Bärenmarkt und ohne Vorauswahl (FR-77 Punkt 5, FR-71).
 * @param {Document} doc
 * @param {ReturnType<typeof import('../balance/balance-market-preview.js').projectMarketPreview>} view
 * @param {string|null} selection @param {(selection: string)=>void} onChoose
 * @param {{year_end?: {monthlyBudget: number|null, mainAction: {text: string, netAmount: number|null}}, year_high?: {monthlyBudget: number|null, mainAction: {text: string, netAmount: number|null}}}|null} [amounts]
 * WT-1b: Beträge nach einer Planänderung im Schritt „Plan“; ohne sie gelten die Beträge der Marktvorschau. */
export function createAnnualMarketChoice(doc, view, selection, onChoose, amounts = null) {
    const node = (tag, text = '', className = '') => { const el = doc.createElement(tag); el.textContent = text; el.className = className; return el; };
    const root = node('fieldset', '', 'annual-market-choice'); root.dataset.annualMarketChoice = '';
    const year = Number(view.yearEndDate.slice(0, 4)) + 2;
    root.append(node('legend', `Welcher Plan gilt für ${year}?`, 'ds-visually-hidden'));
    const comparison = view.comparison;
    const money = value => formatDisplayNumber(value, { fractionDigits: 0 }) + ' €';
    const sale = variant => variant.mainAction.text === 'Nichts tun' || !Number.isFinite(variant.mainAction.netAmount) ? 'kein Verkauf'
        : `${variant.mainAction.text} ${money(variant.mainAction.netAmount)}`;
    const variants = /** @type {[string, typeof comparison.rule][]} */ ([['year_end', comparison.rule && amounts?.year_end ? { ...comparison.rule, ...amounts.year_end } : comparison.rule],
        ['year_high', comparison.high && amounts?.year_high ? { ...comparison.high, ...amounts.year_high } : comparison.high]]);
    const lower = amounts?.year_end && amounts?.year_high && Number.isFinite(amounts.year_end.monthlyBudget) && Number.isFinite(amounts.year_high.monthlyBudget)
        ? /** @type {number} */ (amounts.year_high.monthlyBudget) < /** @type {number} */ (amounts.year_end.monthlyBudget) : (comparison.difference?.monthlyBudget || 0) < 0;
    for (const [id, variant] of variants) {
        if (!variant) continue;
        const option = node('label', '', 'ds-card annual-market-option');
        const radio = /** @type {HTMLInputElement} */ (node('input'));
        radio.type = 'radio'; radio.name = 'annualMarketReading'; radio.value = String(id); radio.checked = selection === id;
        radio.className = 'ds-radio'; radio.dataset.annualMarketReading = String(id);
        radio.addEventListener('change', () => { if (radio.checked) onChoose(String(id)); });
        option.dataset.selected = String(selection === id);
        option.append(radio, node('strong', id === 'year_end' ? 'Nach Kursen zum Jahresende' : `Mit dem Jahreshoch vom ${marketChoiceDate(view.high.high.asOf)}`));
        if (id === 'year_high' && lower) option.append(node('span', ' · vorsichtiger', 'ds-source'));
        option.append(node('span', `Monatsbudget ${money(variant.monthlyBudget)} · ${sale(variant)}`, 'annual-market-option-budget'));
        root.append(option);
    }
    root.append(node('p', `Die App wählt nichts vor. Deine Wahl steht im Jahresbeleg und am Plan ${year}. Mit dem Jahreshoch gilt das Hoch von ${money(view.high.high.value)} auch für die Folgejahre.`, 'ds-source'));
    return root;
}

/** Seit WT-1 nicht mehr im Jahresabschluss genutzt; bleibt als Export erhalten (Exportprüfung).
 * @param {Document} doc
 * @param {ReturnType<typeof import('../balance/balance-market-preview.js').projectMarketPreview>|import('../balance/balance-market-preview.js').UnavailableMarketPreview|null} view
 * @param {string|null} selection @param {()=>void} change */
export function createAnnualMarketPlanNote(doc, view, selection, change) {
    const root = doc.createElement('div'); root.className = 'annual-market-plan-note'; root.dataset.annualMarketPlanNote = '';
    if (!view) return root;
    const stage = classifyMarketPreview(view).stage;
    const text = doc.createElement('p');
    if (stage === 'warning' && 'high' in view) {
        text.textContent = selection === 'year_high' ? `Plan mit dem Jahreshoch vom ${marketChoiceDate(view.high.high.asOf)} · deine Wahl`
            : selection === 'year_end' ? 'Plan nach der Jahresendregel · deine Wahl' : 'Wahl des Plans noch offen';
        const link = doc.createElement('a'); link.href = '#annualMarketChoice'; link.textContent = 'Wahl ändern'; link.dataset.annualMarketChange = '';
        link.addEventListener('click', event => { event.preventDefault(); change(); }); root.append(text, link);
    } else {
        const { noise, gapPct } = classifyMarketPreview(view);
        text.textContent = stage === 'not_reliable' ? `Plan nach der Jahresendregel · ${view.comparison.reason}`
            : noise ? `Plan nach der Jahresendregel · ${formatDisplayNumber(gapPct, { fractionDigits: 1 })} % unter dem Jahreshoch ist Grundrauschen`
            : stage === 'calm' ? 'Nahe am Jahreshoch – keine Auswirkung auf den Plan'
                : `Jahreshoch: ${formatDisplayNumber(classifyMarketPreview(view).gapPct, { fractionDigits: 1 })} % darunter · keine Auswirkung auf den Plan`;
        root.append(text);
    }
    return root;
}
