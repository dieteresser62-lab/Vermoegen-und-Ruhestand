import { initializeWealthHistoryNavigation, navigateWealthHistory, LEGACY_WEALTH_TARGETS, applyWealthHistoryTarget } from '../app/shared/wealth-history-navigation.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { readFileSync } from 'node:fs';

for (const hash of LEGACY_WEALTH_TARGETS) {
    const events = new Map(), calls = [];
    const win = { location: { hash: '#' + hash }, addEventListener: (name, fn) => events.set(name, fn) };
    assertEqual(await initializeWealthHistoryNavigation({ doc: {}, win, navigate: async options => { calls.push(options); return false; } }), true, 'Initiales Altziel stoppt Balance auch bei Ablehnung');
    assertEqual(calls[0].replace, true, 'Initialer Altlink wird ersetzt');
    win.location.hash = '#ausgaben'; events.get('hashchange')();
    assertEqual(calls.length, 1, 'Ausgaben behalten eigenen Navigationspfad');
    win.location.hash = '#verlauf'; events.get('hashchange')();
    assertEqual(calls.length, 2, 'Späterer Hashwechsel öffnet Managerziel');
}
for (const outcome of ['ok', 'flush', 'deny']) {
    const win = { name: 'alter Profilkontext', location: { replace(href) { this.href = href; } } };
    const doc = { getElementById: () => null };
    const guard = createNavigationGuard();
    const ok = await navigateWealthHistory({ doc, win, replace: true, guard, ready: async () => true,
        exporter: async () => { win.name = 'bestätigter Profilkontext'; }, flush: async () => outcome !== 'flush', beforeLeave: async () => outcome !== 'deny' });
    assertEqual(ok, outcome === 'ok', 'Seitenwechsel nur nach bestätigtem Flush und Zustimmung');
    assertEqual(win.location.href, outcome === 'ok' ? 'depot-tranchen-manager.html#verlauf' : undefined, 'Fehler verhindert Navigation');
    assertEqual(win.name, outcome === 'ok' ? 'bestätigter Profilkontext' : 'alter Profilkontext', 'Profilübergabe bleibt erhalten oder wird zurückgesetzt');
}
let scrolls = 0;
assert(applyWealthHistoryTarget({ getElementById: () => ({ scrollIntoView() { scrolls++; } }) }, { hash: '#verlauf' }), 'Ankunft öffnet Verlaufskarte');
assertEqual(scrolls, 1, 'Ankunft liest und scrollt nur');
const main = readFileSync(new URL('../app/balance/balance-main.js', import.meta.url), 'utf8');
assert(main.indexOf('await UIBinder.initializeWealthHistoryNavigation') < main.indexOf('engineHandshake = initVersionHandshake'), 'Initiale Weiterleitung liegt vor Engine-Handshake');
