// Gezielte Doku-Aufnahmen: Simulator-Knöpfe vor/nach der CSS-Begrenzung.
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export async function captureSPK1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot, before }) {
    const output = `/tmp/spk1-${before ? 'vorher' : 'nachher'}`;
    await fs.mkdir(output, { recursive: true });
    const session = await newProbelauf(browser, baseUrl, '2026-10-23');
    try {
        const { page } = session;
        await goto(session, 'Simulator.html', '2026-10-23');
        await poll(page, () => window.__simulatorOpeningBacktestDone === true, null, 'Start-Backtest', 60000);
        for (const view of ['ergebnis', 'annahmen', 'backtesting', 'montecarlo', 'werkstatt']) {
            await tab(page, view);
            await page.mouse.move(1910, 1070);
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: path.join(output, `${view}.png`), animations: 'disabled' });
        }
        // Auch versteckte Knöpfe und alle berechneten CSS-Eigenschaften erfassen.
        const styles = await page.locator('.simulator-surface button').evaluateAll(buttons => buttons.map(button => {
            const style = getComputedStyle(button);
            return { id: button.id, className: button.className, text: button.textContent,
                style: Object.fromEntries([...style].map(key => [key, style.getPropertyValue(key)])) };
        }));
        await fs.writeFile(path.join(output, 'buttons.json'), JSON.stringify(styles));
        if (!before) {
            const original = await fs.readFile('/tmp/spk1-vorher/buttons.json', 'utf8');
            if (!isDeepStrictEqual(JSON.parse(original), styles)) throw new Error('Simulator-Knopfstile haben sich geändert.');
            for (const view of ['ergebnis', 'annahmen', 'backtesting', 'montecarlo', 'werkstatt']) {
                const urls = await Promise.all(['vorher', 'nachher'].map(async stage =>
                    'data:image/png;base64,' + (await fs.readFile(`/tmp/spk1-${stage}/${view}.png`)).toString('base64')));
                const difference = await page.evaluate(async urls => {
                    const pixels = await Promise.all(urls.map(async url => {
                        const image = new Image(); image.src = url; await image.decode();
                        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
                        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
                        return ctx.getImageData(0, 0, image.width, image.height);
                    }));
                    let count = 0, left = 1920, top = 1080, right = 0, bottom = 0;
                    for (let index = 0; index < pixels[0].data.length; index += 4) {
                        if (pixels[0].data.slice(index, index + 4).every((value, channel) => value === pixels[1].data[index + channel])) continue;
                        const x = index / 4 % 1920, y = Math.floor(index / 4 / 1920);
                        count++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
                    }
                    return { count, bounds: count ? [left, top, right, bottom] : null };
                }, urls);
                console.log(`SPK-1 Bildvergleich ${view}: ${JSON.stringify(difference)}`);
            }
        }
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log(`SPK-1: fünf Simulator-Ansichten, ${styles.length} eigene Knöpfe · ${output}`);
    } finally { await session.context.close(); }

    // Gleicher gemeinsam erzeugter Startdialog auf beiden Seiten, ohne Nutzerdaten.
    for (const [file, name] of [['Simulator.html', 'simulator'], ['index.html', 'start']]) {
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 },
            locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
        try {
            await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl
                ? route.continue() : route.abort('blockedbyclient'));
            const page = await context.newPage();
            await page.clock.setFixedTime(new Date('2026-11-07T12:00:00+01:00'));
            await page.goto(`${baseUrl}/${file}`);
            await page.locator('#probelaufStart:enabled').waitFor();
            await poll(page, async () => {
                const { getProbelaufController } = await import('./app/shared/probelauf-state.js');
                const c = getProbelaufController(document);
                const { getPageNavigationGuard } = await import('./app/shared/navigation-guard-dialog.js');
                return c && !c.busy && !c.waiting && !c.blocked && getPageNavigationGuard(document, window).reasons().length === 0;
            }, null, 'Spielbereich bereit');
            await page.locator('#probelaufStart').click();
            await page.locator('[data-probelauf-dialog], #navigationGuardDialog[open]').first().waitFor();
            if (await page.locator('#navigationGuardDialog[open]').count()) await page.locator('#navigationGuardLeave').click();
            await page.locator('[data-probelauf-source="max-erika"]').click();
            if (!before && await page.getByLabel('Echte Kurse von heute', { exact: true }).isVisible()) {
                throw new Error('Echte Kurse dürfen beim Beispiel nicht sichtbar sein.');
            }
            await page.getByRole('button', { name: 'Spielbereich starten', exact: true }).waitFor({ state: 'visible' });
            await poll(page, () => !document.querySelector('.probelauf-start-dialog .ds-button-primary').disabled,
                null, 'Steckbrief geladen');
            await page.evaluate(() => document.fonts.ready);
            await page.mouse.move(1910, 1070);
            await page.screenshot({ path: before ? path.join(output, `dialog-${name}.png`)
                : path.join(reviewRoot, `SPK-1-pruefbild-${name}.png`), animations: 'disabled' });
        } finally { await context.close(); }
    }
}
