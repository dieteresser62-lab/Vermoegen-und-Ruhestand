// Drei Folgejahres-Prüfbilder über die bestehende Bildkette mit isolierten Muster-Spielbereichen.
import path from 'node:path';

export async function captureFJ2({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, reviewRoot }) {
    for (const name of ['balance', 'lower', 'jahresabschluss']) {
        const annual = name === 'jahresabschluss';
        const date = annual ? '2026-12-15' : name === 'balance' ? '2026-12-30' : '2027-02-12';
        const session = await newProbelauf(browser, baseUrl, date);
        try {
            const { page } = session;
            await page.evaluate(async ({ name, annual }) => {
                const { persistenceStorage: storage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
                const key = 'ruhestandsmodellValues_v29_guardrails';
                const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
                const inputs = name === 'balance' || annual
                    ? { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 }
                    : { endeVJ: 105, endeVJ_1: 100, endeVJ_2: 95, endeVJ_3: 90, ath: 105, jahreSeitAth: 0 };
                for (const profile of Object.values(registry.profiles)) {
                    const state = JSON.parse(profile.data[key]);
                    state.inputs = { ...state.inputs, ...inputs };
                    state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...inputs };
                    for (const [id, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
                    profile.data[key] = JSON.stringify(state);
                }
                storage.setItem('rs_profiles_v1', JSON.stringify(registry));
                storage.setItem(key, registry.profiles[storage.getItem('rs_current_profile')].data[key]);
                await PersistenceFacade.flush();
            }, { name, annual });
            if (annual) await changeDate(page, '2027-01-02');
            else { await goto(session, 'Balance.html', date); await tab(page, 'overview'); }
            const value = await page.evaluate(async ({ name, annual }) => {
                const { persistenceStorage: storage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
                const { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } = await import('./app/tranches/tranchen-history-store.js');
                const points = name === 'balance' ? [['2026-07-14', 200], ['2026-12-30', 170]]
                    : annual ? [['2026-07-14', 200], ['2026-12-30', 170]]
                        : [['2025-12-31', 100], ['2026-07-14', 140], ['2026-12-31', 105], ['2027-02-12', 103]];
                const days = points.map(([date]) => historyDay(date));
                storage.setItem(DAILY_PRICES_KEY, JSON.stringify({ version: 1, symbols: { 'VWCE.DE': {
                    ...emptyHistorySymbol(), currency: 'EUR', days, closes: points.map(([, price]) => price),
                    queried: [[days[0], days.at(-1)]]
                } } }));
                await PersistenceFacade.flush();
                if (annual) return null;
                const result = (await import('./app/balance/balance-main.js')).update({ mode: 'preview' });
                if (!result.ok) throw result.error;
                return { state: document.querySelector('[data-budget-comparison]').dataset.budgetComparison,
                    budget: document.getElementById('balanceHighBudget').textContent, title: document.getElementById('balanceBudgetPreview').textContent, reasons: document.getElementById('balanceBudgetReasons').textContent };
            }, { name, annual });
            let target;
            if (annual) {
                await page.locator('[data-overview-annual]').click();
                await page.locator('#balanceAnnualClose').waitFor({ state: 'visible' });
                await page.locator('[data-close-dialog-activate="prices"]').click();
                await poll(page, () => Boolean(document.querySelector('[data-annual-market-readings] [data-budget-comparison]')), null, 'Budgetprüfung im Jahresabschluss');
                target = page.locator('[data-annual-market-readings]');
            } else {
                await poll(page, () => Boolean(document.querySelector('#balanceMarketPreview:not([hidden])')), null, 'Budgetprüfung');
                target = page.locator('#results');
                if (name === 'lower' && value.state !== 'budget_lower') throw new Error('Februar-Sollfall liefert kein niedrigeres Budget.');
            }
            await page.evaluate(async () => { await document.fonts.ready; });
            for (const width of [1920, 2560]) {
                await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
                if (annual) await target.scrollIntoViewIfNeeded();
                else await target.evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 12));
                await page.screenshot({ path: path.join(width === 1920 ? reviewRoot : '/tmp', `FJ-2-${width === 1920 ? 'pruefbild' : '2560'}-${name}.png`), animations: 'disabled' });
            }
            console.log(`FJ-2: ${name} · Spielbereich Max/Erika · 1920×1080 und 2560×1440 · ${JSON.stringify(value)}`);
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
}
