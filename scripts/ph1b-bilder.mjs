// Synthetische PH-1b-Aufnahmen und gemessene Planfeldbreiten; keine Browser-Testfälle.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';

export async function capturePH1B({ browser, baseUrl, newProbelauf, newNormalSession, goto, tab, capture, root, reviewRoot, date }) {
    const normal = await newNormalSession(browser, baseUrl, date);
    try {
        const { page } = normal;
        await page.evaluate(async () => {
            const { createProfileManagementRecovery } = await import('/app/profile/profile-management-recovery.js');
            const { SnapshotArchive } = await import('/app/shared/snapshot-archive.js');
            const { PersistenceFacade: P } = await import('/app/shared/persistence-facade.js');
            for (const label of ['Vor dem Löschen von Max', 'Vor dem Löschen aller Tranchen', 'Vor dem Löschen von Erika'])
                await createProfileManagementRecovery(label);
            for (const label of ['Monatsabschluss 2026-09', 'Nach der Depotprüfung']) await SnapshotArchive.createSnapshot({
                label, kind: 'manual', activeProfileId: P.getItemSync('rs_current_profile'), activeProfileName: 'Max Mustermann',
                records: SnapshotArchive.captureCurrentRecords({ keys: () => P.keysSync(), getItem: key => P.getItemSync(key) })
            });
        });
        await page.reload(); await normal.ready();
        if (await page.locator('#dataSnapshotCount').textContent() !== '5 verfügbar · 0 gesperrt')
            throw new Error('Handbuchbild braucht fünf zurückholbare Punkte im Normalbetrieb.');
        if (await page.locator('#probelaufBand').isVisible() || await page.locator('.data-point-blocked').count())
            throw new Error('Handbuchbild enthält einen Spielbereich oder gesperrte Punkte.');
        await page.locator('#dataSnapshotDisclosure').evaluate(node => { node.open = false; });
        await capture(normal, 'daten-sicherung', 'Daten & Sicherung · Normalbetrieb · synthetischer Musterhaushalt', date);
        await page.locator('#dataSnapshotDisclosure > summary').click();
        if (await page.locator('[data-restore-preview]:disabled').count()
            || await page.locator('[data-restore-preview]').count() !== 5)
            throw new Error('Zurückholen muss an allen fünf Punkten aktiv sein.');
        await page.locator('.data-timeline-row[data-permanent="true"] .data-point-more > summary').first().click();
        await capture(normal, 'daten-sicherung-punkte', 'Wiederherstellungspunkte · Normalbetrieb · fünf zurückholbare Punkte aus drei Anlässen · ältere Punkte geschlossen · Grundzeile je Punkt', date, 'masken', '#wiederherstellung', true);
        await page.screenshot({ path: path.join(reviewRoot, 'PH-1b-pruefbild-punkte.png'), animations: 'disabled' });
        if (normal.errors.length) throw new Error(normal.errors.join('; '));
    } finally { await normal.context.close(); }

    const session = await newProbelauf(browser, baseUrl, date);
    const { page } = session;
    let proofContext;
    try {
        // Echte Oberfläche für Alle Parameter in Plan, Versuch und Versuch mit Dynamik.
        await goto(session, 'Balance.html'); await tab(page, 'strategy');
        await page.locator('#balanceAllParameters > summary').click();
        const measures = [];
        for (const mode of ['Plan', 'Versuch', 'Versuch, Dynamik Ausgewogen']) {
            if (mode === 'Versuch') await page.locator('[data-plan-trial-toggle]:visible').first().click();
            if (mode.includes('Dynamik')) {
                await page.locator('[data-balance-control="dynamicFlexPreset"] button').filter({ hasText: 'Ausgewogen' }).click();
            }
            for (const width of [1366, 1920, 2560]) {
                await page.setViewportSize({ width, height: 1080 });
                const measure = await page.locator('#kirchensteuerSatz').evaluate(element => {
                    const style = getComputedStyle(element), canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d'); context.font = style.font;
                    const textWidth = Math.max(...[...element.options].map(option => context.measureText(option.text).width));
                    const width = element.getBoundingClientRect().width;
                    const textSpace = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
                        - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - 20;
                    return { width, textWidth, textSpace };
                });
                if (measure.textSpace < measure.textWidth) throw new Error('Kirchensteuer-Auswahl abgeschnitten');
                measures.push({ viewport: width, mode, ...measure });
            }
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
        await fs.writeFile(path.join(root, 'tests/fixtures/ph-1b-select-measurement.json'), JSON.stringify(measures, null, 2) + '\n');

        // Eigene, frische Sitzung ausschließlich mit einem erfundenen Altbestand.
        proofContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
            locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
        const legacy = createMusterHaushaltRecords(date);
        const registry = JSON.parse(legacy.rs_profiles_v1);
        registry.profiles.mara = { meta: { id: 'mara', name: 'Mara Muster' }, data: { profile_person_schema_version: '1' } };
        legacy.rs_profiles_v1 = JSON.stringify(registry);
        await proofContext.addInitScript(records => {
            if (location.protocol !== 'http:' || localStorage.getItem('ph1b-proof-seeded')) return;
            for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
            localStorage.setItem('ph1b-proof-seeded', 'true');
        }, legacy);
        await proofContext.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
        const proof = await proofContext.newPage();
        await proof.clock.setFixedTime(new Date(`${date}T12:00:00+02:00`));
        const navigate = async file => {
            await proof.goto(`${baseUrl}/${file}`);
            await proof.evaluate(async () => {
                await (await import('/app/profile/profile-navigation.js')).whenProfileDisplayReady(document);
                await document.fonts.ready;
            });
            if (file.startsWith('Daten-Sicherung')) await proof.waitForFunction(() => document.documentElement.dataset.dataReady === 'true');
        };
        await navigate('Daten-Sicherung.html');
        await proof.evaluate(async () => {
            const { PersistenceFacade: P } = await import('/app/shared/persistence-facade.js');
            const { createProfileManagementRecovery } = await import('/app/profile/profile-management-recovery.js');
            const { applyProfileManagementAction } = await import('/app/profile/profile-manager-bindings.js');
            const point = await createProfileManagementRecovery('Vor dem Ändern des Haushalts');
            applyProfileManagementAction({ kind: 'membership', profileId: 'mara', belongs: false }); await P.flush();
            sessionStorage.setItem('ph1b-preview-point', point.id);
        });
        await navigate('Daten-Sicherung.html');
        await proof.locator('#dataSnapshotDisclosure > summary').click();
        const pointId = await proof.evaluate(() => sessionStorage.getItem('ph1b-preview-point'));
        await proof.locator(`[data-restore-preview="${pointId}"]`).click();
        await proof.locator('#dataRestoreChanges').getByText('3 Personen', { exact: false }).waitFor();
        await proof.locator('#dataRestorePreview').scrollIntoViewIfNeeded();
        await proof.screenshot({ path: path.join(reviewRoot, 'PH-1b-pruefbild-vorschau-3.png'), animations: 'disabled' });
        await proof.locator('#dataRestoreCancel').click();
        await proof.evaluate(async () => {
            const { applyProfileManagementAction } = await import('/app/profile/profile-manager-bindings.js');
            const { PersistenceFacade: P } = await import('/app/shared/persistence-facade.js');
            applyProfileManagementAction({ kind: 'membership', profileId: 'muster_b', belongs: false }); await P.flush();
        });
        await navigate('depot-tranchen-manager.html#personen');
        await proof.getByText('Ein Haushalt braucht mindestens eine Person.', { exact: true }).waitFor();
        await proof.screenshot({ path: path.join(reviewRoot, 'PH-1b-pruefbild-dialog.png'), animations: 'disabled' });
    } finally { await proofContext?.close(); await session.context.close(); }
}
