// Isolierter Muster-Spielbereich über die bestehende Bildkette.
import path from 'node:path';

export async function captureMH3({ browser, baseUrl, newProbelauf, changeDate, poll, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-12-15');
    try {
        const { page } = session;
        await page.evaluate(async () => {
            const { persistenceStorage: storage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
            const { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } = await import('./app/tranches/tranchen-history-store.js');
            const key = 'ruhestandsmodellValues_v29_guardrails';
            const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
            const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
            for (const profile of Object.values(registry.profiles)) {
                const state = JSON.parse(profile.data[key]);
                state.inputs = { ...state.inputs, ...inputs };
                state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...inputs };
                for (const [id, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
                profile.data[key] = JSON.stringify(state);
            }
            storage.setItem('rs_profiles_v1', JSON.stringify(registry));
            storage.setItem(key, registry.profiles[storage.getItem('rs_current_profile')].data[key]);
            storage.setItem(DAILY_PRICES_KEY, JSON.stringify({ version: 1, symbols: { 'VWCE.DE': {
                ...emptyHistorySymbol(), currency: 'EUR', days: ['2026-07-14', '2026-12-15'].map(historyDay), closes: [200, 170], queried: [[historyDay('2026-07-14'), historyDay('2026-12-30')]]
            } } }));
            await PersistenceFacade.flush();
        });
        await changeDate(page, '2027-01-02');
        await page.evaluate(async () => {
            const { persistenceStorage: storage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
            const { DAILY_PRICES_KEY, emptyHistorySymbol, historyDay } = await import('./app/tranches/tranchen-history-store.js');
            storage.setItem(DAILY_PRICES_KEY, JSON.stringify({ version: 1, symbols: { 'VWCE.DE': {
                ...emptyHistorySymbol(), currency: 'EUR', days: ['2026-07-14', '2026-12-30'].map(historyDay), closes: [200, 170], queried: [[historyDay('2026-07-14'), historyDay('2026-12-30')]]
            } } }));
            await PersistenceFacade.flush();
        });
        await page.locator('[data-overview-annual]').click();
        const dialog = page.locator('#balanceAnnualClose');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator('[data-close-dialog-activate="prices"]').click();
        await poll(page, () => Boolean(document.querySelector('[data-annual-market-readings]:not([hidden])')), null, 'Jahreslesarten');
        await page.evaluate(async () => { await document.fonts.ready; });
        const readings = dialog.locator('[data-annual-market-readings]');
        if (!await readings.textContent().then(text => text.includes('höchster gespeicherter Schlusskurs am 14.07.2026'))) throw new Error('Gespeicherter Höchstschluss fehlt im Kursschritt: ' + await readings.textContent());
        for (const width of [1920, 2560]) {
            await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
            await readings.scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(width === 1920 ? reviewRoot : '/tmp', width === 1920 ? 'MH-3-pruefbild-jahresabschluss.png' : 'MH-3-jahresabschluss-2560.png'), animations: 'disabled' });
        }
        console.log('MH-3: Kursschritt · Spielbereich Max/Erika · 1920×1080 und 2560×1440');
        if (session.errors.length) throw new Error(session.errors.join('\n'));
    } finally { await session.context.close(); }
}
