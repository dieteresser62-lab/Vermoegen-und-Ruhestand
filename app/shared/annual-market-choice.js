/** Auswahl und Herkunftszeile im Jahresabschluss; der Dialog besitzt den Entwurf. */
import { actionText } from '../balance/balance-market-preview-renderer.js';
import { classifyMarketPreview } from '../balance/balance-market-preview.js';
import { formatDisplayNumber } from './designsystem-number-format.js';

/** @param {string|null} value */
export const marketChoiceDate = value => value?.split('-').reverse().join('.') || 'Datum nicht belegt';
/** @param {{reading?: string, asOf?: string}|null|undefined} reading */
export const annualMarketChoiceLabel = reading => reading?.reading === 'year_high'
    ? `Plan mit dem Jahreshoch vom ${marketChoiceDate(reading.asOf)} (Wahl im Jahresabschluss)` : 'Plan nach der Jahresendregel';

/** @param {Document} doc
 * @param {ReturnType<typeof import('../balance/balance-market-preview.js').projectMarketPreview>} view
 * @param {string|null} selection @param {(selection: string)=>void} onChoose */
export function createAnnualMarketChoice(doc, view, selection, onChoose) {
    const node = (tag, text = '', className = '') => { const el = doc.createElement(tag); el.textContent = text; el.className = className; return el; };
    const root = node('fieldset', '', 'annual-market-choice'); root.dataset.annualMarketChoice = '';
    const year = Number(view.yearEndDate.slice(0, 4)) + 2;
    root.append(node('legend', `Welcher Plan gilt für ${year}?`));
    const comparison = view.comparison;
    const money = value => formatDisplayNumber(value, { fractionDigits: 0 }) + ' €';
    const variants = /** @type {[string, typeof comparison.rule, typeof view.rule][]} */ ([['year_end', comparison.rule, view.rule], ['year_high', comparison.high, view.high]]);
    for (const [id, variant, reading] of variants) {
        if (!variant) continue;
        const option = node('label', '', 'ds-card annual-market-option');
        const radio = /** @type {HTMLInputElement} */ (node('input'));
        radio.type = 'radio'; radio.name = 'annualMarketReading'; radio.value = String(id); radio.checked = selection === id;
        radio.className = 'ds-radio'; radio.dataset.annualMarketReading = String(id);
        radio.addEventListener('change', () => { if (radio.checked) onChoose(String(id)); });
        option.dataset.selected = String(selection === id);
        option.append(radio, node('strong', id === 'year_end' ? 'Nach der Jahresendregel' : `Mit dem Jahreshoch vom ${marketChoiceDate(view.high.high.asOf)}`),
            node('span', `${money(variant.monthlyBudget)} / Monat`, 'annual-market-option-budget'));
        if (id === 'year_end' || (comparison.difference?.monthlyBudget || 0) < 0) option.append(node('span', id === 'year_end' ? 'bisherige Regel' : 'vorsichtiger', 'ds-badge'));
        option.append(node('p', `„${reading.market.text}“: ${id === 'year_end'
            ? `Ende ${year - 2} → Ende ${year - 1}: ${money(view.stored.index)} → ${money(view.rule.index)}. Hoch ${money(view.rule.high.value)}.`
            : `${formatDisplayNumber(classifyMarketPreview(view).gapPct, { fractionDigits: 1 })} % unter dem Jahreshoch, ${formatDisplayNumber(reading.monthsSinceHigh, { fractionDigits: 1 })} Monate seit dem Hoch.`}`),
            node('p', `Verkauf: ${actionText(variant)}.`));
        if (id === 'year_high') option.append(node('p', `Das Hoch von ${money(view.high.high.value)} gilt danach auch für die Folgejahre.`));
        root.append(option);
    }
    root.append(node('p', `Die App wählt nichts vor. Deine Wahl steht im Jahresprotokoll und an der Handlungsanweisung ${year}.`, 'ds-source'),
        node('p', 'Die Beträge rechnen mit den vorgeschlagenen Bedarfswerten. Bedarf und Plan prüfst du im nächsten Reiter mit allen Einzelheiten.', 'ds-source'));
    return root;
}

/** @param {Document} doc
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
