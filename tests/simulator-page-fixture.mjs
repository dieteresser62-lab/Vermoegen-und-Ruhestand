import { createSelectionDocument, addField, simulatorSelectOptions, source } from './designsystem-selection-dom.mjs';

// Native Formularanker und Vorgaben aus der Seite, einschließlich versteckter Goldfelder.
export function simulatorDocument() {
    const doc = createSelectionDocument();
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};
    doc.querySelector = selector => doc.body.querySelector(selector);
    const html = source('Simulator.html');
    for (const match of html.matchAll(/<(input|select)\b([^>]*)>/g)) {
        const attrs = match[2], id = attrs.match(/\bid="([^"]+)"/)?.[1];
        if (!id) continue;
        const options = match[1] === 'select' ? simulatorSelectOptions(id) : null;
        const value = attrs.match(/\bvalue="([^"]*)"/)?.[1] ?? options?.[0]?.[0] ?? '';
        const field = addField(doc, id, value, options);
        if (!options) {
            let text = String(value);
            Object.defineProperty(field, 'value', { configurable: true, get: () => text, set: value => { text = String(value); } });
        }
        field.type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? (options ? 'select-one' : 'text');
        field.checked = /\bchecked\b/.test(attrs);
        for (const data of attrs.matchAll(/\b(data-[\w-]+)="([^"]*)"/g)) field.setAttribute(data[1], data[2]);
        if (options) {
            const select = html.slice(match.index).match(/^[\s\S]*?<\/select>/)[0];
            const selected = select.match(/<option[^>]*value="([^"]*)"[^>]*\bselected\b/);
            if (selected) field.value = selected[1];
        }
    }
    for (const id of ['simProfileList', 'simProfileStatus', 'displayPortfolioBreakdown', 'plannedInflowsRows', 'plannedInflowsSummary', 'simPlanEuroMode']) addField(doc, id);
    return doc;
}

