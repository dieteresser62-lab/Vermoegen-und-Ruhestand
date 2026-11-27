// JA-4: Prüfbild „Tagesgeld-Stand vor dem 31.12.“ über die bestehende Bildkette (`node scripts/docs-bilder.mjs --ja4`),
// unversioniert unter auftrag/, keine Handbuchbilder. Spielbereich Max und Erika, Grundfall, Testdatum 02.01.2027,
// ohne Dezember-Monatsabschluss.
import path from 'node:path';

// Liegt trotzdem ein Stand zum 31.12. vor, bekommt Erika den Stand vom 30.11.2026 (nur im Spielbereich).
async function ageOneCashBalance(page) {
    return page.evaluate(async () => {
        const { persistenceStorage: storage, PersistenceFacade } = await import('./app/shared/persistence-facade.js');
        const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
        const [id, profile] = Object.entries(registry.profiles).find(([, entry]) => /Erika/.test(entry.meta?.name || '')) || Object.entries(registry.profiles)[1];
        const history = JSON.parse(profile.data.profile_cash_history_v1 || '{"version":1,"entries":[]}');
        if (history.entries?.length) history.entries.at(-1).date = '2026-11-30';
        profile.data.profile_cash_history_v1 = JSON.stringify(history);
        delete profile.data.profile_tagesgeld_confirmed_date;
        storage.setItem('rs_profiles_v1', JSON.stringify(registry));
        if (storage.getItem('rs_current_profile') === id) {
            storage.setItem('profile_cash_history_v1', profile.data.profile_cash_history_v1);
            storage.removeItem('profile_tagesgeld_confirmed_date');
        }
        await PersistenceFacade.flush();
        return id;
    });
}

async function openCashStep(page) {
    await page.locator('[data-overview-annual]').click();
    const dialog = page.locator('#balanceAnnualClose');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('[data-close-dialog-activate="cash"]').click();
    await page.locator('[data-close-dialog-step="cash"] .tagesgeld-fields').waitFor();
    return dialog;
}

export async function captureJA4({ browser, baseUrl, newProbelauf, goto, changeDate, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-12-15', 'demo', 'max-erika', 'grund');
    try {
        const { page } = session;
        await page.setViewportSize({ width: 1920, height: 1080 });
        await changeDate(page, '2027-01-02');
        await goto(session, 'index.html', '2027-01-02');
        let dialog = await openCashStep(page);
        let aged = null;
        if (!await dialog.locator('[data-tagesgeld-confirm-hint]').count()) {
            await dialog.locator('[data-close-dialog-close]').click();
            await dialog.waitFor({ state: 'hidden' });
            aged = await ageOneCashBalance(page);
            await goto(session, 'index.html', '2027-01-02');
            dialog = await openCashStep(page);
        }
        const hints = await dialog.locator('[data-tagesgeld-confirm-hint]').allTextContents();
        if (!hints.length) throw new Error('Kein Hinweis zu einem alten Tagesgeld-Stand sichtbar.');
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.screenshot({ path: path.join(reviewRoot, 'JA-4-tagesgeld.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log(`JA-4: Jahresabschluss · Spielbereich Max und Erika · Grundfall · 02.01.2027 · Schritt Tagesgeld · 1920×1080 · ${aged ? `Stand von ${aged} auf 30.11.2026 gesetzt · ` : ''}${hints.join(' | ')}`);
    } finally { await session.context.close(); }
}
