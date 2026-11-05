// Drei isolierte Muster-Spielbereiche über die bestehende Bildkette, keine neuen Browserfälle.
import path from 'node:path';

export async function captureMH2({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot, followup = false }) {
    for (const [name, equal, closed] of [['abweichend', false, true], ['gleich', true, true], ['ohne-abschluss', false, false]]) {
        if (followup && !closed) continue;
        const session = await newProbelauf(browser, baseUrl, '2026-10-30');
        try {
            const { page } = session;
            await page.evaluate(async closed => {
                const { persistenceStorage: storage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
                const key = 'ruhestandsmodellValues_v29_guardrails';
                const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
                const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
                for (const profile of Object.values(registry.profiles)) {
                    const state = JSON.parse(profile.data[key]);
                    state.inputs = { ...state.inputs, ...inputs };
                    state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...inputs };
                    for (const [id, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
                    if (!closed) {
                        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null };
                        delete profile.data.overview_balance_summary_v1;
                    }
                    profile.data[key] = JSON.stringify(state);
                }
                if (!closed) {
                    storage.removeItem('annual_plan_record_v1');
                    storage.removeItem('overview_balance_summary_v1');
                    const expenses = JSON.parse(storage.getItem('balance_expenses_v1'));
                    delete expenses.years['2025'];
                    storage.setItem('balance_expenses_v1', JSON.stringify(expenses));
                }
                storage.setItem('rs_profiles_v1', JSON.stringify(registry));
                storage.setItem(key, registry.profiles[storage.getItem('rs_current_profile')].data[key]);
                await PersistenceFacade.flush();
            }, closed);
            await goto(session, 'Balance.html', '2026-10-30');
            await tab(page, 'overview');
            const values = await page.evaluate(async equal => {
                const { persistenceStorage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
                const { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } = await import('./app/tranches/tranchen-history-store.js');
                persistenceStorage.setItem(DAILY_PRICES_KEY, JSON.stringify({ version: 1, symbols: { 'VWCE.DE': {
                    ...emptyHistorySymbol(), currency: 'EUR', days: ['2026-07-14', '2026-10-30'].map(historyDay),
                    closes: equal ? [150, 150] : [200, 170], queried: [[historyDay('2026-07-14'), historyDay('2026-10-30')]]
                } } }));
                await PersistenceFacade.flush();
                const result = (await import('./app/balance/balance-main.js')).update({ mode: 'preview' });
                if (!result.ok) throw result.error;
                return { market: result.modelResult.ui.market.sKey, index: result.modelResult.input.endeVJ }; 
            }, equal);
            await poll(page, () => Boolean(document.querySelector('#balanceMarketPreview:not([hidden])')), null, 'Marktvorschau');
            if (!closed && !await page.locator('#balanceMarketPreviewBody').textContent().then(text => text.includes('Bisherige Regel (Jahresmarktdaten Ende VJ)'))) throw new Error('Erstes Planungsjahr zeigt keine Jahresmarktdaten-Spalte.');
            await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
            await page.locator('#results').evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 12));
            await page.screenshot({ path: path.join(reviewRoot, `${followup ? 'MH-2b' : 'MH-2'}-pruefbild-${name}.png`), animations: 'disabled' });
            console.log(`MH-2: ${name} · Spielbereich Max/Erika · 1920×1080 · ${JSON.stringify(values)}`);
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
}
