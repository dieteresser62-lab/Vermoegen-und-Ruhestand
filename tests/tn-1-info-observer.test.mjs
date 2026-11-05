import { bindInfoPopovers, createInfoPopover } from '../app/shared/designsystem-info-popover.js';
import { observeOverviewProbelauf } from '../app/overview/overview-main.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const { doc } = createDialogFixture();
const band = doc.createElement('div'); band.id = 'probelaufBand'; doc.body.append(band);
const info = createInfoPopover(doc, 'Spielbereich erklären', 'Synthetischer Spielbereich.'); info.id = 'probelaufBandInfo'; band.append(info);
const otherInfo = createInfoPopover(doc, 'Anderer Hinweis', 'Synthetischer Hinweis.'); doc.body.append(otherInfo);
const action = doc.createElement('button'); action.dataset.probelaufAction = 'next-month'; band.append(action);
const outside = doc.createElement('button'); doc.body.append(outside);

// Das DOM-Doppel liefert echte Mutationsmeldungen einschließlich unveränderter Writes.
// Der Observer entscheidet nach denselben Optionen wie ein nativer MutationObserver.
const observations = [], writes = [];
class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; observations.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
}
const mutate = record => {
    writes.push(record);
    for (const observer of observations) {
        const { options, target } = observer;
        if (record.target !== target && (!options.subtree || !target.contains(record.target))) continue;
        if (record.type === 'attributes' && options.attributes
            && (!options.attributeFilter || options.attributeFilter.includes(record.attributeName))
            || record.type === 'childList' && options.childList) observer.records.push(record);
    }
};
const flush = () => {
    for (const observer of observations) {
        const records = observer.records.splice(0);
        if (records.length) observer.callback(records, observer);
    }
};
for (const node of [band, action, info, info.querySelector('button'), otherInfo, otherInfo.querySelector('button')]) {
    const setAttribute = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => {
        setAttribute(name, value); mutate({ type: 'attributes', target: node, attributeName: name });
    };
    node.dataset = new Proxy(node.dataset, { set(target, key, value) {
        target[key] = value;
        mutate({ type: 'attributes', target: node, attributeName: 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()) });
        return true;
    } });
}
const append = band.appendChild.bind(band);
band.appendChild = child => { const result = append(child); mutate({ type: 'childList', target: band }); return result; };

let refreshes = 0;
observeOverviewProbelauf(doc, { MutationObserver }, () => { refreshes++; });
bindInfoPopovers(doc);
flush();
assertEqual(refreshes, 0, 'TN-1: Initialisierung der Band-Info löst keinen Übersichtsrefresh aus');
writes.length = 0;
doc.dispatchEvent({ type: 'click', target: outside }); flush();
doc.dispatchEvent({ type: 'click', target: outside }); flush();
assertEqual(writes.length, 0, 'TN-1: Dokumentklick schreibt keine unveränderten data-visible- oder aria-expanded-Merkmale');
const button = info.querySelector('button');
await button.fire('click'); flush();
assertEqual(info.dataset.visible, 'true', 'TN-1: Band-Info öffnet weiterhin per Klick');
assertEqual(button.getAttribute('aria-expanded'), 'true', 'TN-1: aria-expanded folgt dem echten Öffnen');
assertEqual(refreshes, 0, 'TN-1: data-visible und aria-expanded am Band-Infozugang lösen keinen Refresh aus');
writes.length = 0;
await info.fire('mouseenter'); flush();
assertEqual(writes.length, 0, 'TN-1: Bereits offene Band-Info wird nicht erneut geschrieben');
doc.dispatchEvent({ type: 'click', target: outside }); flush();
assertEqual(info.dataset.visible, 'false', 'TN-1: Außenklick schließt weiterhin');
assertEqual(writes.filter(record => record.target === info && record.attributeName === 'data-visible').length, 1, 'TN-1: Außenklick schreibt den geänderten Sichtbarkeitszustand einmal');
assertEqual(writes.filter(record => record.target === button && record.attributeName === 'aria-expanded').length, 1, 'TN-1: Außenklick schreibt den geänderten Knopfzustand einmal');
assertEqual(refreshes, 0, 'TN-1: Auch Schließen aktualisiert die Übersicht nicht');
writes.length = 0;
doc.dispatchEvent({ type: 'click', target: outside }); flush();
assertEqual(writes.length, 0, 'TN-1: Weitere Außenklicks schreiben keine bereits geschlossenen Infos');

band.setAttribute('hidden', ''); flush();
assertEqual(refreshes, 1, 'TN-1: Echte Änderung der Spielbereichssichtbarkeit aktualisiert weiterhin');
action.setAttribute('disabled', ''); flush();
assertEqual(refreshes, 2, 'TN-1: Geänderte Aktionssperre im Spielbereich aktualisiert weiterhin');
band.append(doc.createElement('span')); flush();
assertEqual(refreshes, 3, 'TN-1: Geänderter Bandinhalt aktualisiert weiterhin');
// Fehlende Browsermechanik und Seiten ohne Band bleiben zulässig.
observeOverviewProbelauf(doc, {}, () => { throw new Error('Unerwarteter Refresh'); });
observeOverviewProbelauf({ getElementById: () => null }, { MutationObserver }, () => {});
assertEqual(observations.length, 1, 'TN-1: Kein Observer ohne Band oder Browserunterstützung');
