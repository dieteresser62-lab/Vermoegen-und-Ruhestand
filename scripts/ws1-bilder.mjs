// WS-1: Prüfbild „Simulator ohne Werkstatt“ über die bestehende Bildkette (`node scripts/docs-bilder.mjs --ws1`),
// unversioniert unter auftrag/, kein Handbuchbild.
import path from 'node:path';

export async function captureWS1({ browser, baseUrl, newProbelauf, goto, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'max-erika', 'grund');
    try {
        await session.page.setViewportSize({ width: 1920, height: 1080 });
        await goto(session, 'Simulator.html', '2026-10-23');
        await session.page.waitForFunction(() => window.__simulatorOpeningBacktestDone === true);
        const tabs = await session.page.locator('.tab-buttons .tab-btn').allTextContents();
        if (JSON.stringify(tabs.map(text => text.trim())) !== JSON.stringify(['Ergebnis', 'Annahmen', 'Backtest', 'Monte-Carlo'])) {
            throw new Error(`Reiterleiste enthält nicht genau vier Reiter: ${JSON.stringify(tabs)}`);
        }
        if (await session.page.locator('[data-tab="werkstatt"], #tab-werkstatt').count()) throw new Error('Werkstatt ist noch im Simulator');
        await session.page.screenshot({ path: path.join(reviewRoot, 'WS-1-simulator.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log('WS-1: Simulator · Spielbereich Max und Erika · Grundfall · 23.10.2026 · Reiter ohne Werkstatt · 1920×1080');
    } finally { await session.context.close(); }
}
