import { getAppTestDate } from './app-clock.js';
import { bindInfoPopovers } from './designsystem-info-popover.js';

export const PROBELAUF_PRICE_LABEL = 'Testkurse, nicht echt';
export const PROBELAUF_PRICE_EXPLANATION = 'Der Spielbereich bewertet Wertpapiere mit künstlichen Testkursen, damit er ohne Netz und für jedes Testdatum funktioniert. Stückzahlen und Tagesgeld stammen aus den Daten, mit denen der Spielbereich gestartet wurde; beim Muster-Haushalt aus dem Muster.';

const quoteBindings = new WeakMap();

export function renderProbelaufPriceInfo(doc) {
    const active = getAppTestDate() !== null;
    const hosts = doc.querySelectorAll?.('[data-probelauf-price-info]') || [];
    for (const host of hosts) {
        host.hidden = !active;
        const explanation = host.querySelector('[data-probelauf-price-explanation]');
        if (explanation) explanation.textContent = PROBELAUF_PRICE_EXPLANATION;
    }
    if (active && hosts.length) bindInfoPopovers(doc);
}

/** Gemeinsamer Probelaufrahmen kennzeichnet bestehende Kursdetails im Kopf.
 * Die Seitenrenderer schreiben sie nach Profilwechsel und Kursaktionen neu. */
export function bindProbelaufQuoteContext(doc, state) {
    const binding = quoteBindings.get(doc);
    if (!state || state.testDate === null) {
        if (!binding) return;
        binding.observer?.disconnect();
        for (const [host, original] of binding.originals) {
            if (host.textContent === original.testText) {
                host.textContent = original.text;
                host.title = original.title;
            }
        }
        quoteBindings.delete(doc);
        return;
    }
    if (binding) { binding.render(); return; }
    const context = doc.getElementById('suiteContext');
    if (!context || !doc.getElementById('managerQuoteContext') && !doc.getElementById('startupPriceStatus')) return;
    const originals = new Map();
    const replace = (host, testText) => {
        if (!host || host.textContent === testText) return;
        originals.set(host, { text: host.textContent, title: host.title, testText });
        host.textContent = testText;
        host.title = PROBELAUF_PRICE_EXPLANATION;
    };
    const render = () => {
        for (const [id, testText] of [['managerQuoteContext', PROBELAUF_PRICE_LABEL], ['managerQuoteDetails', PROBELAUF_PRICE_EXPLANATION]]) {
            replace(doc.getElementById(id), testText);
        }
        const summary = doc.getElementById('startupPriceStatus')?.querySelector?.('p');
        if (summary && !summary.textContent.startsWith(PROBELAUF_PRICE_LABEL)) replace(summary, `${PROBELAUF_PRICE_LABEL} · ${summary.textContent}`);
    };
    const Observer = doc.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(render) : null;
    quoteBindings.set(doc, { observer, originals, render });
    render();
    observer?.observe(context, { subtree: true, childList: true, characterData: true });
}
