import { createAnnualCloseSession } from '../app/shared/annual-close-session.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { showNavigationGuardDialog } from '../app/shared/navigation-guard-dialog.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { PLAN_DEFAULTS } from '../app/profile/household-plan.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const turns = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
    const { doc } = createDialogFixture();
    const prompt = doc.createElement('dialog'); prompt.id = 'navigationGuardDialog';
    for (const id of ['navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) {
        const node = doc.createElement(id.endsWith('Stay') || id.endsWith('Leave') ? 'button' : 'p');
        node.id = id; prompt.append(node);
    }
    doc.body.append(prompt);
    const messages = [];
    const guard = createNavigationGuard({ decide: options => showNavigationGuardDialog(options, doc), status: message => messages.push(message) });
    const people = [{ id: 'a', name: 'Max Mustermann', value: 10000 }, { id: 'b', name: 'Erika Mustermann', value: 5000 }];
    const model = { now: new Date(2027, 0, 2), scope: { kind: 'household', ids: ['a', 'b'], key: 'household:a+b' }, members: people,
        occasion: { kind: 'annual', closingYear: 2026, previousYear: 2026, previousMonth: 12 } };
    const base = structuredClone(PLAN_DEFAULTS), gate = deferred();
    let hold = false, heldCalls = 0;
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }),
        evaluatePlan: async ({ adoptedPlanPatch }) => {
            if (hold) { heldCalls++; await gate.promise; }
            const outcome = { monthlyBudget: 4000, monthlyWithdrawal: 1000, snapshot: { plan: { ...base, ...adoptedPlanPatch } } };
            return { values: base, recommended: outcome, adopted: outcome, adjustedFields: Object.keys(adoptedPlanPatch || {}) };
        } });
    const market = Object.fromEntries([['inflation', '2.5'], ['etf', '150'], ['cape', '28']]
        .map(([type, value]) => [type, createManualAnnualValue(type, value, 2026)]));
    const session = createAnnualCloseSession({ guard, readContext: () => 'synthetic-household-2026', showPreparation: ui.showAnnualPreparation,
        fetchers: Object.fromEntries(Object.entries(market).map(([type, value]) => [type, async () => value])),
        schedule: () => 1, unschedule() {} });
    const pending = session.prepare({ targetYear: 2026, model, people });
    await turns();
    const root = doc.getElementById('balanceAnnualClose');
    return { doc, guard, session, pending, root, prompt, messages,
        hold() { hold = true; }, release: gate.resolve, get heldCalls() { return heldCalls; },
        leave: () => doc.getElementById('navigationGuardLeave').fire('click'),
        stay: () => doc.getElementById('navigationGuardStay').fire('click'),
        async edit(kind) {
            await root.querySelector(`[data-close-dialog-activate="${kind === 'plan' ? 'preview' : kind}"]`).fire('click');
            if (kind === 'care') await root.querySelector('[data-annual-care-edit]').fire('click');
            const field = doc.getElementById(kind === 'cash' ? 'annualTagesgeld-1' : kind === 'care' ? 'annualCare_2' : 'annualPlan_floorBedarf');
            field.focus(); await field.fire('focus');
            field.value = kind === 'cash' ? '2500' : kind === 'care' ? '400' : '32000';
            await field.fire('input');
            if (kind === 'cash') {
                const partner = doc.getElementById('annualTagesgeld-2'); partner.value = '1000'; await partner.fire('input');
            }
            if (kind === 'care') await root.querySelector('[data-annual-care-confirm]').fire('click');
            return field;
        },
        async cross(field) {
            // DOM-Doppel: Fokusverlust und change vor dem echten X-Handler nachstellen.
            const cross = root.querySelector('[data-close-dialog-close]');
            cross.focus(); await field.fire('change'); await field.fire('blur');
            const closing = cross.fire('click'); await turns(); return { closing };
        },
        async cleanup() { gate.resolve(); session.dispose(); await pending; await turns(); }
    };
}

for (const kind of ['cash', 'care', 'plan'].filter(kind => !process.env.JV1_CASE || process.env.JV1_CASE === kind)) {
    const f = await fixture();
    try {
        f.hold(); const field = await f.edit(kind);
        assert(f.heldCalls > 0, `${kind}: Planneuberechnung läuft vor X`);
        const { closing } = await f.cross(field);
        assert(f.prompt.open, `${kind}: X öffnet die Verwerfen-Rückfrage`);
        assertEqual(f.doc.getElementById('navigationGuardTitle').textContent, 'Änderungen verwerfen?', `${kind}: Rückfrage benennt Verwerfen`);
        const revision = f.guard.reasons()[0].revision;
        f.release(); await turns();
        const calculatedRevision = f.guard.reasons()[0].revision;
        await f.leave(); await closing; await turns();
        assert(!f.root.open && !f.prompt.open, `${kind}: X → Verwerfen schließt trotz Fokusverlust und nachlaufender Planrechnung`);
        assertEqual(calculatedRevision, revision, `${kind}: Rechenergebnis ohne neue Eingabe erhält die Schutzrevision`);
        assertEqual(await f.pending, null, `${kind}: Verwerfen liefert keinen Jahresauftrag`);
        assertEqual(f.guard.reasons().length, 0, `${kind}: Verwerfen gibt den Entwurfsbesitzer frei`);
        assertEqual(f.messages.length, 0, `${kind}: Erfolgreiches Verwerfen meldet keinen Navigationsfehler`);
    } finally { await f.cleanup(); }
}

if (!process.env.JV1_CASE || process.env.JV1_CASE === 'error') {
    const f = await fixture();
    let foreignRevision = 1;
    const foreign = f.guard.register(Symbol('other-editor'), { read: () => ({ dirty: true, revision: foreignRevision }) });
    try {
        const field = await f.edit('cash'); await turns();
        const { closing } = await f.cross(field);
        foreignRevision++; foreign.notify();
        await f.leave(); await turns();
        assert(f.root.open && f.prompt.open, 'Abgelehntes Verwerfen hält Jahresdialog und Rückfrage offen');
        assert(f.doc.getElementById('navigationGuardDescription').textContent.includes('Zustand hat sich geändert'),
            'Verwerfen nennt den geänderten Schutzzustand in der Rückfrage');
        assertEqual(field.value, '2.500', 'Fehlgeschlagenes Verwerfen erhält die bei change formatierte Eingabe');
        await f.stay(); await closing;
        const retry = await f.cross(field); await f.leave(); await retry.closing;
        assert(!f.root.open && !f.prompt.open, 'Nach Abbrechen ist ein neuer bestätigter Schließversuch möglich');
        assertEqual(f.guard.reasons().length, 1, 'Verwerfen erhält den fremden Entwurfsbesitzer');
    } finally { foreign.unregister(); await f.cleanup(); }
}

if (!process.env.JV1_CASE) {
    for (const kind of ['cash', 'care', 'plan']) {
        const f = await fixture();
        try {
            f.hold(); const field = await f.edit(kind);
            const { closing } = await f.cross(field), value = field.value;
            f.release(); await turns();
            await f.stay(); await closing;
            assert(f.root.open && !f.prompt.open, `${kind}: Abbrechen erhält den Jahresdialog`);
            assertEqual(field.value, value, `${kind}: Abbrechen erhält die Eingabe`);
            assert(f.guard.reasons().some(reason => reason.dirty), `${kind}: Abbrechen erhält den Verlustschutz`);
        } finally { await f.cleanup(); }
    }
    const f = await fixture();
    try {
        await f.edit('cash'); await turns();
        const navigation = f.guard.prepare(); await turns();
        assert(f.prompt.open && f.doc.getElementById('navigationGuardTitle').textContent === 'Seite verlassen?',
            'Seitenwechsel fragt bei ungespeicherten Jahreswerten weiter nach');
        await f.stay(); assertEqual(await navigation, null, 'Bleiben verhindert den Seitenwechsel');
        let reloads = 0;
        const reload = f.guard.reload({ reload: () => reloads++ }); await turns();
        assert(f.prompt.open, 'Neuladen fragt bei ungespeicherten Jahreswerten weiter nach');
        await f.stay(); assertEqual(await reload, false, 'Bleiben verhindert das Neuladen');
        assertEqual(reloads, 0, 'Abgebrochener Reload ruft kein Ziel auf');
        let prevented = false;
        const event = { returnValue: null, preventDefault() { prevented = true; } };
        f.guard.beforeUnload(event);
        assert(prevented && event.returnValue === '', 'Nativer Reload bleibt durch ungespeicherte Jahreswerte geschützt');
    } finally { await f.cleanup(); }
}
