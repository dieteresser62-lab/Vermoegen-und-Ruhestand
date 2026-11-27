// PZ-1: Prüfbild „davon mit Hilfe zur Pflege“ in der Hauptkarte über die bestehende Bildkette (`node scripts/docs-bilder.mjs --pz1`),
// unversioniert unter auftrag/, keine Handbuchbilder. Spielbereich Martin und Petra, Grundfall, 23.10.2026, Monte Carlo mit Vorgaben.
import path from 'node:path';

export async function capturePZ1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'martin-petra', 'grund');
    try {
        const { page } = session;
        await page.setViewportSize({ width: 1920, height: 1080 });
        await goto(session, 'Simulator.html', '2026-10-23');
        await tab(page, 'montecarlo');
        await page.locator('#mcButton').click();
        await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
            null, 'PZ-1 Monte Carlo', 300000);
        // Gegenprobe: dieselbe Zahl wie die Kachel „Läufe mit Hilfe zur Pflege“ unter „Weitere Kennzahlen“.
        const tile = await page.evaluate(() => [...document.querySelectorAll('#tab-montecarlo .kpi-card')]
            .find(card => card.querySelector('.sim-metric-heading strong')?.textContent === 'Läufe mit Hilfe zur Pflege')
            ?.querySelector('.value-line')?.textContent?.trim() ?? null);
        await tab(page, 'ergebnis');
        const line = page.locator('#overviewMonteCarloAnswers .sim-care-aid-share');
        await line.waitFor({ state: 'visible' });
        const shown = await line.locator('strong').textContent();
        if (tile !== null && shown !== tile) throw new Error(`Zeile ${shown} weicht von der Kachel ${tile} ab`);
        await page.locator('#overviewMonteCarloAnswers .sim-coverage-answer').scrollIntoViewIfNeeded();
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.screenshot({ path: path.join(reviewRoot, 'PZ-1-hauptkarte.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log(`PZ-1: Simulator · Ergebnis · Spielbereich Martin und Petra · Grundfall · 23.10.2026 · Zeile ${shown} · Kachel ${tile ?? 'fehlt'} · 1920×1080`);
    } finally { await session.context.close(); }
}
