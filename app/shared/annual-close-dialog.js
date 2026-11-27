import { projectAnnualMarketReadings } from '../balance/balance-annual-market-preview.js';
import { renderAnnualMarketReadings } from '../balance/balance-market-preview-renderer.js';
import { unavailableMarketPreview } from '../balance/balance-market-preview.js';
import { ATH_NOISE_BAND_TEXT, athNoiseBandApplies } from '../balance/balance-ath-noise.js';
import { annualMarketChoiceLabel } from './annual-market-choice.js';
import { createPlanProgressNote } from './annual-todo-view.js';
import { readCloseExpenseNeeds } from '../expenses/expenses-needs.js';
import { createAnnualCareEditor } from './annual-care-editor.js';
import { createAnnualPropertyEditor } from './annual-property-editor.js';
import { createManualAnnualValue, parseManualAnnualNumber, validateAnnualPreparationValue } from './annual-marketdata.js';
import { capeManualHint } from './shiller-cape.js';
import { readCapeReference, capeChainReference, assessCapeJump, capeConfirmationKey } from './annual-cape-check.js';
import { bindClosePriceActions } from './close-price-actions.js';
import { createCloseDialog, createCloseTiles, advanceCloseImport, closeReadinessText, projectCloseMonthModel } from '../shared/close-dialog.js';
import { createInfoPopover, bindInfoPopovers } from './designsystem-info-popover.js';
import { createTagesgeldFields, parseMonthlyCashInput } from '../shared/tagesgeld-fields.js';
import { projectOverviewMonthSteps, createOverviewStepContent, projectConfirmedMonthResult, preserveCloseDetails, nextCloseText } from '../overview/overview-month-confirmation.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { createAnnualPlanResult, createAnnualExpenseStatus, createAnnualCombinedResult, createAnnualReceiptCard, projectAnnualCloseResult, createAnnualTodoResult, readAnnualClosePlanProgress } from './annual-close-result.js';
export { readAnnualClosePlanProgress } from './annual-close-result.js';
import { projectAnnualPreview, formatAnnualNeed } from '../balance/balance-annual-preview.js';
import { createAnnualPlanEditor } from './annual-plan-editor.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { displayDiagnosisText } from '../balance/balance-diagnosis-transaction.js';
import { bindFullBackupButton } from '../shared/persistence-backup.js';
import { readLastFullBackup } from '../overview/overview-storage.js';
import { overviewBackupAge } from '../overview/overview-model.js';
import { appNow } from '../shared/app-clock.js';
import { AppError, ValidationError } from '../balance/balance-config.js';
import { createCashProposals } from '../overview/overview-cash-proposal.js';
import { listMoneyUnderway, moneyUnderwayCloseText } from '../tranches/sale-underway.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';
const annualErrorText = error => {
    const text = error.message || 'Unbekannter Fehler';
    if (error instanceof ValidationError) return [text, ...error.errors.map(entry => entry.message)].join('\n');
    return error instanceof AppError ? `Ein interner Fehler ist aufgetreten: ${text}`
        : `Ein unerwarteter Anwendungsfehler ist aufgetreten: ${text}`;
};

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 2 }) : '—';

const monthName = model => new Date(model?.occasion?.previousYear, (model?.occasion?.previousMonth || 1) - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
const monthFailureText = (results, model) => {
    const month = results.monthSession?.request?.month || model?.occasion?.month;
    const number = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? Number(month.slice(5)) : model?.occasion?.previousMonth;
    const name = Number.isInteger(number) && number >= 1 && number <= 12
        ? new Date(2000, number - 1, 1).toLocaleDateString('de-DE', { month: 'long' }) : null;
    return `Jahr ${results.targetYear} gespeichert. Der ${name ? `${name}-Abschluss` : 'Monatsabschluss'} konnte nicht gespeichert werden.`;
};

/** Jahresadapter der gemeinsamen, schreibfreien Abschlusskomponente.
 *
 * @param {import("../../typcheck/shared-annual.js").AnnualDialogOptions} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function createAnnualCloseDialog({ getLastUpdateResults = () => null, getModel = () => ({}), document: injectedDocument,
    priceActions, projectMarketReadings = projectAnnualMarketReadings, projectPreview = options => projectAnnualPreview(options), evaluatePlan, onError = () => {}, onClearError = () => {}, onNotice = () => {},
    readPlanProgress = readAnnualClosePlanProgress, readCapeReference: readReference = readCapeReference,
    isCommitActive = () => getPageNavigationGuard().reasons().some(reason => reason.phase === 'commit') } = {}) {
    let dialogState = null;
    let handle = null, accepted = false, endPreparation = null, retryPending = false, savingYear = false;
    // Vom Klick auf „Jahr … abschließen“ bis zum Ergebnis bleibt dieser Hinweis sichtbar; Escape tut dann nichts (Dialog ist beschäftigt).
    const YEAR_SAVING_TEXT = 'Jahr wird gespeichert …', MONTH_SAVING_TEXT = 'Monat wird gespeichert …';
    let handPrice, handGroup, confirmButton, retryButton, closeButton, logButton, marketBody, previewBody;
    let monthResults = null, monthReceipt = null, recoveryButton, retryAction, saveMonth, hidePreparationBackup = () => {};
    const doc = () => injectedDocument || globalThis.document;
    const node = (tag, text, id) => {
        const element = doc().createElement(tag); if (text !== undefined) element.textContent = text;
        if (id) element.id = id; return element;
    };
    const button = (text, id) => { const element = node('button', text, id); element.type = 'button'; element.className = 'ds-button ds-button-secondary'; return element; };
    const previewContent = (preview, title = 'Planvorschau') => {
        const body = node('section'); body.dataset.annualPreview = '';
        if (!evaluatePlan || preview.confirmed) body.append(node('h3', `${title} ${preview.targetYear} → ${preview.planningYear}`));
        const outcome = node('div'); outcome.dataset.annualPlanOutcomeHost = '';
        if (evaluatePlan && !preview.confirmed) outcome.append(node('p', 'Monatsbudget und Vermögensentnahme werden berechnet …'));
        body.append(outcome);
        const calculations = node('details'); calculations.dataset.annualCalculations = '';
        calculations.append(node('summary', 'Berechnungsgrundlagen'));
        const pensionDetails = node('details'); pensionDetails.dataset.annualPensionMonths = '';
        pensionDetails.append(node('summary', 'Rentenbezugsmonate'));
        for (const person of preview.people) {
            if (person.error) { body.append(node('p', `${person.name}: ${person.error}`)); continue; }
            pensionDetails.append(node('p', `${person.name}: ${person.monateImJahr} Bezugsmonate · ${money(person.renteMonatlich)} monatlich · ${money(person.renteImJahr)} im Jahr.`));
            calculations.append(node('h4', person.name), node('p', `${person.startAlter}\u00a0Jahre am 01.01.${preview.planningYear}`),
                node('p', person.ageStatus === 'fallback' ? 'Geburtsdatum einmal ergänzen; das hinterlegte Alter bleibt bis dahin unverändert.' : 'Aus dem Geburtsdatum abgeleitet; vollendete Jahre am 1. Januar.'),
                node('p', `Rentenbezugsgröße im Budget: ${money(person.budgetPensionMonthly)} im Jahresdurchschnitt pro Monat.`));
        }
        if (!preview.people.length) body.append(node('p', 'Personenquellen fehlen. Bitte zentral ergänzen.'));
        if (!evaluatePlan || preview.confirmed) for (const need of preview.needs.filter(need => ['floorBedarf', 'flexBedarf'].includes(need.id)))
            outcome.append(node('p', `${need.id === 'floorBedarf' ? 'Grundbedarf' : 'Flex-Bedarf'} jährlich: ${formatAnnualNeed(need, preview)}`));
        if (!preview.needs.length) body.append(node('p', 'Die Bedarfsvorschau erscheint nach dem Inflationsabruf.'));
        body.append(calculations, pensionDetails); return body;
    };
    const replace = (body, content) => { Array.from(body.children || []).forEach(child => child.remove()); body.append(content); };
    /** @param {{title?: string; subtitle?: string; progressNames?: string; opener?: HTMLElement; steps?: import("../../typcheck/shared-ui.js").CloseStep[]; model?: import("../../typcheck/shared-annual.js").Model; onClose?: ()=>boolean|Promise<boolean>}} [options] */
    const open = ({ title, subtitle = '', progressNames = null, opener = /** @type {HTMLElement} */ (doc().activeElement), steps = [], model = getModel(), onClose = () => true } = {}) => {
        if (handle?.root.open) return handle;
        monthResults = null; monthReceipt = null; retryAction = null; hidePreparationBackup = () => {};
        closeButton = button('Schließen', 'annualCloseBtn'); closeButton.id = 'annualCloseBtn'; closeButton.hidden = true;
        confirmButton = button('Jahr abschließen', 'annualConfirmBtn'); confirmButton.id = 'annualConfirmBtn'; confirmButton.className = 'ds-button ds-button-primary'; confirmButton.hidden = true;
        retryButton = button('Mit diesem Kurs erneut abschließen', 'annualRetryBtn'); retryButton.id = 'annualRetryBtn'; retryButton.hidden = true;
        logButton = button('Protokoll anzeigen', 'annualShowLog'); logButton.id = 'annualShowLog'; logButton.hidden = true;
        logButton.className = 'ds-button ds-button-quiet';
        recoveryButton = button('Wiederherstellungspunkte anzeigen', 'annualShowRecovery'); recoveryButton.id = 'annualShowRecovery'; recoveryButton.hidden = true;
        handle = createCloseDialog({ doc: doc(), id: 'balanceAnnualClose', title, subtitle, progressNames,
            eyebrow: 'Monats- und Jahresabschluss', steps,
            actions: [closeButton, logButton, recoveryButton, confirmButton, retryButton], returnFocus: () => opener?.focus?.(),
            onClose: async () => {
                if (isCommitActive() || retryPending) return false;
                return onClose();
            } });
        if (!handle) return null;
        handle.root.id = 'balanceAnnualClose';
        const current = handle;
        dialogState = { handle: current,
            report: (error, action) => current.setMessage(annualErrorText(error), {
                kind: error.isBalanceHint ? 'hint' : 'error',
                action: action && { label: action.label, onActivate: async isCurrent => {
                    const closed = await current.requestClose();
                    if (closed && !current.root.open && isCurrent() && !handle) action.onActivate();
                } }
            }),
            finishPreflight: () => { confirmButton.hidden = true; current.setStatus(''); current.setBusy(false); }
        };
        current.listen(closeButton, 'click', () => current.requestClose());
        current.listen(retryButton, 'click', () => retryAction?.());
        current.listen(logButton, 'click', () => { const last = getLastUpdateResults(); if (last) showUpdateResultModal({ ...last, showProtocol: true }); });
        current.listen(recoveryButton, 'click', async () => {
            const show = monthResults?.openRecovery;
            await current.requestClose();
            if (!current.root.open) show?.();
        });
        saveMonth = async () => {
            const session = monthResults?.monthSession;
            if (!session || current.busy || confirmButton.disabled || isCommitActive()) return;
            if (monthReceipt) { current.close(true); return; }
            current.setBusy(true); current.setStatus(MONTH_SAVING_TEXT);
            try {
                const receipt = await (monthResults.retryMonth ? monthResults.retryMonth() : session.save());
                if (!receipt) throw new Error('Bereitstellung nicht bestätigt. Bitte Profil, Plan und Umfang erneut prüfen.');
                monthReceipt = receipt;
                delete monthResults.monthError;
            } catch (error) {
                monthResults.monthError = error.message;
                current.setStatus(session.phase === 'recovery'
                    ? 'Jahr gespeichert · Wiederherstellung erforderlich. Bitte den Monatswiederherstellungspunkt in der Sicherungsverwaltung prüfen.'
                    : `Jahr gespeichert · Monatsbetrag noch nicht bereitgestellt. ${error.message} Erneut versuchen speichert nur den Monat.`);
                if (session.phase === 'recovery') { recoveryButton.hidden = false; recoveryButton.textContent = 'Wiederherstellungspunkte anzeigen'; }
            } finally {
                current.setBusy(false);
                showMonthPhase(monthResults);
            }
        };
        current.listen(confirmButton, 'click', saveMonth);
        current.closed.then(() => {
            if (dialogState?.handle === current) dialogState = null;
            if (handle === current) handle = null;
            endPreparation?.(null); endPreparation = null;
        });
        return current;
    };
    const makeHandPrice = () => {
        handGroup = node('section', undefined, 'annualHandPriceGroup'); handGroup.id = 'annualHandPriceGroup'; handGroup.className = 'ds-field';
        const label = node('label', 'ETF-Schlusskurs von Hand'); label.setAttribute('for', 'annualHandPrice');
        // VN-3 (Gemini Befund 8, DS-1 Punkt 4): Kursfeld wie die übrigen Kursfelder – Text mit Dezimaltastatur im €-Rahmen.
        handPrice = node('input', undefined, 'annualHandPrice'); handPrice.id = 'annualHandPrice'; handPrice.type = 'text'; handPrice.setAttribute('inputmode', 'decimal'); handPrice.setAttribute('lang', 'de'); handPrice.value = '';
        handPrice.className = 'ds-input'; handPrice.dataset.annualTransient = ''; handPrice.setAttribute('data-money-input', ''); handPrice.setAttribute('aria-describedby', 'annualHandPriceHelp');
        const help = node('p', 'Optional – ersetzt nur den ETF-Schlusskurs, wenn der Abruf fehlt.'); help.id = 'annualHandPriceHelp';
        const frame = node('span'); frame.className = 'ds-unit-frame'; frame.append(handPrice, node('span', '€'));
        handGroup.append(label, frame, help);
        return handGroup;
    };
    /** @param {import("../../typcheck/shared-annual.js").PreparationOptions} [options] */
    const showAnnualPreparation = ({ targetYear, validatePrice = () => ({}), signal, opener, people = [],
        model = getModel(), getModel: getPreparationModel = getModel, onReady, onDirty = () => {}, confirmDiscard = async () => false, onClose, retryMarketData } = {}) => {
        if (handle?.root.open) return Promise.resolve(null);
        model = projectCloseMonthModel(model);
        accepted = false;
        let values = {}, errors = {}, loading = true, planLoading = Boolean(evaluatePlan), planRevision = 0, planEditor = null, planMarket = null, importActive = false;
        // FR-89: Allzeithoch und Marktlage sind reine Anzeige im Schritt Marktdaten; der Abschluss rechnet das Hoch selbst.
        let marketView = null, readingPending = false;
        const oldPlanProgress = readPlanProgress({ model, year: targetYear });
        const proposals = next => createCashProposals({ doc: doc(), model: next, people, targetYear });
        // FR-4 (NG-13): Ein Stand vor dem 31.12. oder ohne Datum gilt erst nach Bestätigung oder Änderung je Person.
        const cash = people.length ? createTagesgeldFields({ doc: doc(), people, proposals: proposals(model), prefix: 'annualTagesgeld', monthly: true, closePresentation: true,
            confirmFrom: `${targetYear}-12-31`, title: '', asOfLabel: `Jahresendstand am 31.12.${targetYear}`, explanation: 'Jahresendstand je Haushaltsperson. Der Cashbeleg trägt weiterhin den heutigen Bestätigungstag. Tagesgeldentwurf – wird erst mit dem Jahresabschluss gespeichert.' }) : null;
        // Referenzen aus dem erzeugten Block behalten, auch wenn Dialogupdates ihn umhängen.
        const cashErrors = cash?.inputs.map(input => cash.root.querySelector(`#${input.id}-error`)) || [];
        const initial = cash?.inputs.map(input => input.value) || [];
        const dirty = () => Boolean(careEditor.read().dirty) || Boolean(propertyEditor.present && propertyEditor.read().dirty) || Boolean(planEditor?.read().dirty) || Boolean(handPrice?.value) || Object.values(manualFields).some(field => Boolean(field.input.value)) || Boolean(cash?.inputs.some((input, index) => {
            try { return parseMonthlyCashInput(input.value) !== parseMonthlyCashInput(initial[index]); }
            catch { return input.value !== initial[index]; }
        }));
        const status = node('p', '', 'overviewExampleExpensesStatus'); status.setAttribute('role', 'status');
        const cashBody = node('div'); if (cash) cashBody.append(cash.root);
        marketBody = node('div');
        const marketLoading = node('p', 'Marktdaten werden automatisch vorbereitet …');
        makeHandPrice();
        const fetchRetry = button('Fehlende Marktdaten erneut abrufen', 'annualMarketRetryBtn'); fetchRetry.id = 'annualMarketRetryBtn';
        previewBody = node('div'); previewBody.append(previewContent(projectPreview({ targetYear })));
        const careListeners = [];
        const careEditor = createAnnualCareEditor({ doc: doc(), targetYear, listen: (...args) => careListeners.push(args),
            onState: () => { onDirty(dirty()); sync(); if (careEditor.read().confirmed && careEditor.read().dirty) void recalculatePlan(); } });
        // FR-85: Schritt „Immobilienwerte“ nur, wenn Personen im Abschluss Immobilien haben; sonst bleibt der Dialog wie bisher.
        const propertyEditor = createAnnualPropertyEditor({ doc: doc(), targetYear, people, listen: (...args) => careListeners.push(args),
            onState: () => { onDirty(dirty()); sync(); } });
        const manualFields = {};
        // JW-1a (FR-99): Fehlt die amtliche Inflation, sagt der Dialog, welche Zahl gemeint ist, woher und ab wann sie kommt.
        const inflationWait = `Gemeint ist die HVPI-Inflation Deutschland, Jahresdurchschnitt ${targetYear}. Sie kommt von Eurostat, die App ruft sie über die EZB ab. Meist ist sie erst nach Mitte Januar abrufbar. Warte mit dem Abschluss am besten bis dahin; eine Eingabe vorher ist nur eine Schätzung.`;
        for (const [type, label] of [['inflation', `Inflation ${targetYear} von Hand (%)`], ['cape', 'US Shiller CAPE von Hand']]) {
            const group = node('section'); group.className = 'ds-field';
            const input = node('input'); input.id = `annualHand${type === 'cape' ? 'Cape' : 'Inflation'}`; input.type = 'text'; input.value = ''; input.className = 'ds-input'; input.dataset.annualTransient = ''; input.setAttribute('inputmode', 'decimal');
            const title = node('label', label); title.setAttribute('for', input.id);
            if (type === 'cape') title.append(createInfoPopover(doc(), 'Wo ändere ich den CAPE dauerhaft?',
                'In der Balance unter Bedarf & Strategie → Alle Parameter → Marktdaten zeigt „Im Plan ändern“ die dauerhafte Korrektur in Haushalt & Plan.'));
            const help = node('p', type === 'inflation' ? inflationWait : 'Optional – ergänzt einen fehlenden Abruf mit manueller Herkunft.');
            const error = node('p'); error.id = `${input.id}Error`; error.setAttribute('role', 'alert'); error.className = 'tagesgeld-error'; input.setAttribute('aria-describedby', error.id);
            group.append(title, input, help, error); manualFields[type] = { group, input, help, error };
        }
        const marketColumns = node('div'); marketColumns.className = 'close-dialog-columns'; marketColumns.hidden = true;
        const marketReport = node('div'); marketReport.dataset.annualMarketReport = '';
        const marketManual = node('section'); marketManual.className = 'ds-card annual-market-manual';
        const manualGroups = [handGroup, ...Object.values(manualFields).map(field => field.group), fetchRetry];
        const manualIdle = node('p', 'Alle Werte sind abgerufen. Fehlt einmal ein Wert, ergänzt du ihn hier von Hand.'); manualIdle.className = 'ds-source';
        marketManual.append(node('h4', 'Von Hand ergänzen'), ...manualGroups, manualIdle);
        marketColumns.append(marketReport, marketManual);
        const handError = node('p'); handError.setAttribute('role', 'alert'); handError.id = 'annualHandPriceError'; handPrice.setAttribute('aria-describedby', 'annualHandPriceHelp annualHandPriceError'); handGroup.append(handError);
        let latestModel = model, cashValid = false, effectiveMarket = {}, missing = null;
        // S2: Bezugswert einmal je Abschluss; die Bestätigung gilt nur für genau den bestätigten Wert.
        let capeReference, capeWarning, capeConfirmedKey = null, capeJump = null, capeAutomaticJump = false;
        try { capeReference = readReference({}); } catch { capeReference = capeChainReference(); }
        const capeOpen = () => Boolean(capeJump?.exceeds) && capeConfirmedKey !== capeConfirmationKey(effectiveMarket.cape);
        const manualAllowed = new Set();
        const labels = { inflation: 'Inflation', etf: 'ETF-Schlusskurs', cape: 'US Shiller CAPE' };
        const assess = () => {
            missing = null; cashValid = Boolean(cash);
            for (const [index, input] of (cash?.inputs || []).entries()) {
                let error = '';
                try { if (people[index].error) throw new Error(people[index].error); parseMonthlyCashInput(input.value); } catch (failure) { error = failure.message; cashValid = false; missing ||= { id: 'cash', text: `Tagesgeld von ${people[index].name}: ${error}` }; }
                input.setAttribute('aria-invalid', String(Boolean(error))); cashErrors[index].textContent = error;
            }
            if (!cash) missing ||= { id: 'cash', text: 'Tagesgeld aller Personen fehlt.' };
            else if (cash.unconfirmedPeople.length) missing ||= { id: 'cash', text: `Tagesgeld von ${cash.unconfirmedPeople[0]}: Stand zum 31.12.${targetYear} eintragen oder bestätigen` };
            effectiveMarket = {};
            for (const type of Object.keys(labels)) {
                const input = type === 'etf' ? handPrice : manualFields[type].input;
                const errorNode = type === 'etf' ? handError : manualFields[type].error;
                let automatic;
                try { if (values[type]) automatic = validateAnnualPreparationValue(type, values[type], targetYear); }
                catch { /* Ungültige Abrufe bleiben ergänzbar. */ }
                // NR-1 (M1): Ein großer Sprung des abgerufenen CAPE öffnet das Handfeld; der Nutzer bestätigt oder ersetzt den Wert.
                if (type === 'cape') capeAutomaticJump = Boolean(assessCapeJump(automatic, capeReference)?.exceeds);
                if (!loading && (!automatic || type === 'cape' && (capeWarning || capeAutomaticJump))) manualAllowed.add(type);
                const canEdit = manualAllowed.has(type);
                (type === 'etf' ? handGroup : manualFields[type].group).hidden = !canEdit;
                input.disabled = !canEdit || loading || current.busy;
                let error = '';
                try {
                    if (canEdit && input.validity?.badInput) throw new Error(`Bitte ${labels[type]} gültig eingeben.`);
                    if (canEdit && input.value.trim()) {
                        const value = createManualAnnualValue(type, input.value, targetYear);
                        if (type === 'etf' && 'price' in value) validatePrice(String(value.price));
                        effectiveMarket[type] = value;
                    } else if (automatic) effectiveMarket[type] = automatic;
                    else throw new Error(errors[type] || 'Noch nicht verfügbar');
                } catch (failure) { error = failure.message; missing ||= { id: 'market', text: `${labels[type]}: ${error}` }; }
                errorNode.textContent = canEdit && (input.value.trim() || input.validity?.badInput) ? error : ''; input.setAttribute('aria-invalid', String(Boolean(errorNode.textContent)));
            }
            capeJump = assessCapeJump(effectiveMarket.cape, capeReference);
            if (capeOpen()) missing ||= { id: 'market', text: 'US Shiller CAPE: Wert prüfen und bestätigen' };
            if (loading) missing ||= { id: 'market', text: 'Marktdaten werden noch vorbereitet.' };
            // FR-73 Punkt 9: Die validierte Abschlussinflation schreibt die Pflegewerte einmal fort; eine geänderte Inflation hebt die Bestätigung auf.
            careEditor.setInflation(effectiveMarket.inflation ? effectiveMarket.inflation.rate : null);
            if (!careEditor.read().confirmed) missing ||= { id: 'care', text: 'Pflegewerte bestätigen oder ändern' };
            // FR-85: dieselbe Abschlussinflation schreibt die Immobilienwerte fort.
            if (propertyEditor.present) {
                propertyEditor.setInflation(effectiveMarket.inflation ? effectiveMarket.inflation.rate : null);
                if (!propertyEditor.read().confirmed) missing ||= { id: 'property', text: 'Immobilienwerte bestätigen oder ändern' };
            }
            if (planLoading) missing ||= { id: 'preview', text: 'Planprüfung wird noch berechnet oder konnte nicht abgeschlossen werden.' };
            if (planEditor && !planEditor.read().valid) missing ||= { id: 'preview', text: 'Bitte die markierten Planwerte prüfen.' };
            const unseen = current.firstUnvisited();
            if (unseen) missing = { id: unseen.id, text: unseen.title };
            if (latestModel.recovery) missing = { id: 'market', text: 'Wiederherstellung erforderlich.' };
            if (importActive || current.busy || isCommitActive()) missing = { id: 'expenses', text: importActive ? 'Ausgabenimport läuft – bitte warten.' : 'Speichervorgang läuft – bitte warten.' };
        };
        let marketReadingRevision = 0;
        const marketReadings = node('div');
        const readingBody = node('div'), planNote = node('div');
        marketReadings.append(readingBody);
        marketBody.append(marketLoading, marketColumns, marketReadings);
        // Schritt „Plan“, rechts oben: Stand des alten Plans (Entwurf 5).
        planNote.dataset.annualPlanNote = '';
        if (oldPlanProgress) planNote.append(createPlanProgressNote(doc(), oldPlanProgress));
        const placePlanNote = () => {
            const summary = planEditor?.root.querySelector('[data-annual-plan-summary]');
            if (summary) planEditor.root.insertBefore(planNote, summary);
            else if (!evaluatePlan && !planNote.parentNode) previewBody.append(planNote);
        };
        const updateMarketReadings = async () => {
            const revision = ++marketReadingRevision;
            readingPending = Boolean(effectiveMarket.etf); sync();
            try {
                const view = await projectMarketReadings({ targetYear, quote: effectiveMarket.etf });
                if (revision !== marketReadingRevision || !current.root.open || accepted) return;
                marketView = view;
            } catch {
                if (revision !== marketReadingRevision || !current.root.open || accepted) return;
                marketView = unavailableMarketPreview('Marktvorschau nicht verfügbar');
            } finally {
                if (revision === marketReadingRevision && current.root.open && !accepted) {
                    readingPending = false;
                    renderAnnualMarketReadings(doc(), readingBody, marketView); placePlanNote(); sync();
                }
            }
        };
        const contents = new Map();
        const project = next => {
            const steps = projectOverviewMonthSteps(next, { annual: true }).slice(0, 3).map(step => ({ ...step,
                progressByVisit: step.id !== 'prices' || step.resultTone !== 'warning', contentOwnResult: true,
                content: preserveCloseDetails(contents.get(step.id), createOverviewStepContent({ doc: doc(), model: next, step, status, annual: true })) }));

            steps.forEach(step => contents.set(step.id, step.content));
            const budget = steps.find(step => step.id === 'budget');
            const comparison = node('div'); comparison.className = 'close-dialog-columns';
            comparison.append(budget.content);
            comparison.append(createAnnualExpenseStatus({ doc: doc(), model: { ...next, expenseNeeds: readCloseExpenseNeeds(next, targetYear, next.annual?.budget ?? next.expenseBudget) }, targetYear })); budget.content = comparison;
            if (!next.annual?.complete) budget.result += ` · Jahr ${targetYear} noch unvollständig`;
            return [...steps, { id: 'cash', chip: 'Tagesgeld', title: `Tagesgeld am 31.12.${targetYear}`, continueLabel: 'Weiter zum Tagesgeld', content: cashBody, contentOwnResult: true, state: cash?.ready && handle?.hasVisited('cash') ? 'done' : 'open', done: Boolean(cash?.ready && handle?.hasVisited('cash')), statusLabel: cash?.ready ? handle?.hasVisited('cash') ? 'erledigt' : 'offen' : `${cash?.openPeople.length ?? people.length} offen`, result: cash?.ready ? 'Gültiger Tagesgeld-Stand je Person' : cash && cash.openPeople.every(name => cash.unconfirmedPeople.includes(name))
                ? `Stand zum 31.12.${targetYear} eintragen oder bestätigen: ${cash.unconfirmedPeople.join(', ')}` : `Tagesgeld fehlt oder ist ungültig: ${(cash?.openPeople || people.map(person => person.name)).join(', ')}` },
                { id: 'care', chip: 'Pflegewerte', title: 'Pflegewerte prüfen', continueLabel: 'Weiter zu den Pflegewerten', content: careEditor.root, contentOwnResult: true, state: careEditor.read().confirmed ? 'done' : 'open', done: careEditor.read().confirmed, statusLabel: careEditor.read().confirmed ? 'erledigt' : 'offen', result: careEditor.read().confirmed ? 'Für das neue Planjahr bestätigt · noch nicht gespeichert' : 'Unverändert bestätigen oder Werte ändern.' },
                ...(propertyEditor.present ? [{ id: 'property', chip: 'Immobilien', title: 'Immobilienwerte prüfen', continueLabel: 'Weiter zu den Immobilienwerten', content: propertyEditor.root, contentOwnResult: true, state: propertyEditor.read().confirmed ? 'done' : 'open', done: propertyEditor.read().confirmed, statusLabel: propertyEditor.read().confirmed ? 'erledigt' : 'offen', result: propertyEditor.read().confirmed ? `Zum 31.12.${targetYear} bestätigt · noch nicht gespeichert` : 'Unverändert bestätigen oder Werte ändern.' }] : []),
                { id: 'market', chip: 'Marktdaten', title: `Marktdaten und Marktlage ${targetYear}`, continueLabel: 'Weiter zu den Marktdaten', content: marketBody, contentOwnResult: true, progressByVisit: true, prepared: true, preparing: loading,
                    done: !loading && Object.keys(effectiveMarket).length === 3 && !capeOpen(), result: capeOpen() ? 'CAPE-Wert prüfen und bestätigen'
                        : !loading && Object.keys(effectiveMarket).length === 3 ? 'Vollständig vorbereitet · noch nicht gespeichert' : 'Pflichtwerte ergänzen' },
                { id: 'preview', chip: `Plan ${targetYear + 1}`, title: `Bedarf und Plan ${targetYear + 1} prüfen`, continueLabel: `Weiter zum Plan ${targetYear + 1}`, content: previewBody, contentOwnResult: true, progressByVisit: true, prepared: true, preparing: loading || planLoading,
                    done: !loading && Object.keys(effectiveMarket).length === 3 && !planLoading && (!planEditor || planEditor.read().valid), result: 'Planwerte ansehen und bei Bedarf bewusst anpassen.' }];
        };
        const pending = /** @type {Promise<import("../../typcheck/balance-ui.js").PreparedAnnual & {preparedMarketData?: Record<string,unknown>}>} */ (new Promise(resolve => { endPreparation = resolve; }));
        const openingSteps = project(model);
        const current = open({ title: `${monthName(model)} und Jahr ${targetYear} abschließen`, opener, steps: openingSteps, model,
            progressNames: people.map(person => person.name).join(' + '),
            onClose: async () => {
                if (!accepted && dirty() && !await confirmDiscard()) return false;
                return await onClose?.() !== false;
            } });
        if (!current) { endPreparation = null; return Promise.resolve(null); }
        careListeners.forEach(args => current.listen(...args));
        // SP-1c (Nutzer 13. und 15.11.2026, „Erst warnen“): Offene Gutschriften und Abbuchungen stehen beim Start über dem ersten
        // Schritt, je Posten eine Zeile mit dem Weg zur Bestätigung. Sie sperren nichts; „Trotzdem fortfahren“ blendet den Hinweis aus.
        const firstStepId = openingSteps[0]?.id ?? null;
        let activeStepId = firstStepId, underwayDismissed = false;
        const underwayItems = (() => {
            try { const ids = people.map(person => person.id).filter(Boolean); return listMoneyUnderway(loadProfileRegistry().value, ids.length ? ids : null); }
            catch { return []; }
        })();
        const underwayNote = underwayItems.length ? node('section') : null;
        if (underwayNote) {
            underwayNote.className = 'ds-note ds-note-warning annual-close-underway'; underwayNote.dataset.annualMoneyUnderway = '';
            underwayNote.append(node('h4', 'Geld unterwegs'));
            for (const item of underwayItems) {
                const row = node('p', moneyUnderwayCloseText(item)); row.dataset.annualMoneyUnderwayItem = item.kind;
                const link = node('a', item.kind === 'credit' ? 'Gutschrift eintragen' : 'Abbuchung eintragen');
                link.className = 'ds-button ds-button-secondary'; link.dataset.profileHandoff = '';
                link.setAttribute('href', `depot-tranchen-manager.html?person=${encodeURIComponent(item.profileId)}#reconciliationCashStatuses`);
                underwayNote.append(row, link);
            }
            const proceed = button(); proceed.textContent = 'Trotzdem fortfahren'; proceed.dataset.annualMoneyUnderwayProceed = '';
            underwayNote.append(proceed);
            current.listen(proceed, 'click', () => {
                if (current.busy) return;
                underwayDismissed = true; underwayNote.hidden = true;
                if (firstStepId) current.activate(firstStepId);
            });
            current.content.insertBefore(underwayNote, current.content.children[0] || null);
        }
        current.setFootnote(nextCloseText(model), `Kurse, Ausgaben und Budget sind Empfehlungen und verhindern den Abschluss nicht. ${propertyEditor.present ? 'Alle acht Vorbereitungsschritte ansehen, Pflegewerte und Immobilienwerte bestätigen' : 'Alle sieben Vorbereitungsschritte ansehen, Pflegewerte bestätigen'} und gültiges Tagesgeld aller Personen eintragen; gültige Jahrespflichtdaten sind erforderlich. Ein Wiederherstellungspunkt wird vor dem Speichern erstellt. Ungespeicherte Eingaben werden beim Schließen verworfen.`);
        const backupNote = node('section'); backupNote.className = 'close-dialog-backup annual-close-backup';
        const backupButton = button('Jetzt sichern'); backupButton.dataset.overviewBackup = '';
        backupNote.append(backupButton, createInfoPopover(doc(), 'Vollsicherung vor dem Jahresabschluss', 'Vollsicherung vor dem Jahresabschluss empfohlen. Die Datei bewahrt den bisherigen Stand außerhalb der App.'));
        const backupStatus = node('p'); backupStatus.className = 'close-dialog-backup-status'; backupStatus.hidden = true;
        backupStatus.setAttribute('role', 'status'); backupStatus.dataset.annualBackupStatus = '';
        const footer = current.root.querySelector('[data-close-dialog-footer]');
        footer.classList.toggle('annual-close-foot', true);
        const actionRow = footer.querySelector('.close-dialog-foot-row');
        actionRow.insertBefore(backupNote, actionRow.children[0]);
        bindInfoPopovers(doc(), { root: backupNote, listen: (...args) => current.listen(...args) });
        footer.append(backupStatus, ...Array.from(footer.children));
        let yearStored = false;
        hidePreparationBackup = () => { yearStored = true; backupNote.hidden = true; backupStatus.hidden = true; current.setStatus(''); };
        const syncBackup = () => { backupNote.hidden = yearStored || !overviewBackupAge(appNow(), readLastFullBackup()).recommended; };
        // Der bestehende Binder erhält eine lebensdauergebundene Knopfschnittstelle.
        // Fachliche Export- und Probelaufsperren bleiben beim Vollbackupdienst.
        bindFullBackupButton({ document: doc(), status: backupStatus, button: /** @type {HTMLButtonElement} */ ({
            get disabled() { return backupButton.disabled; },
            set disabled(value) { backupButton.disabled = value; },
            addEventListener(type, listener) {
                current.listen(backupButton, type, async event => {
                    if (current.busy || backupButton.disabled || !current.root.open) return;
                    backupStatus.hidden = false;
                    current.setBusy(true);
                    try { await listener(event); }
                    finally { current.setBusy(false); sync(); syncBackup(); }
                });
            }
        }) });
        current.listen(doc(), 'overview-backup-changed', syncBackup); syncBackup();
        confirmButton.hidden = false; confirmButton.textContent = `Jahr ${targetYear} abschließen`;
        const sync = () => {
            // Nach bestätigter Vorbereitung gehört der Knopf der Monats-/Ergebnisphase.
            if (accepted) return;
            if (underwayNote) underwayNote.hidden = underwayDismissed || activeStepId !== firstStepId;
            assess();
            marketReadings.dataset.annualReadingPending = String(readingPending);
            marketReadings.dataset.annualMarketLoading = String(loading);
            current.updateSteps(project(latestModel));
            confirmButton.disabled = current.busy || Boolean(missing);
            current.setStatus(closeReadinessText({ problem: missing?.text, action: `Jahr ${targetYear} abschließen` }));
        };
        current.setOnVisit(id => { activeStepId = id; sync(); });
        cash?.bind(current.listen, () => { onDirty(dirty()); void recalculatePlan(); sync(); }, () => sync());
        const recalculatePlan = async () => {
            if (!evaluatePlan || accepted || !current.root.open) return;
            const revision = ++planRevision; let succeeded = false; planLoading = true; sync();
            try {
                assess();
                if (loading || !cashValid || Object.keys(effectiveMarket).length !== 3) return;
                planMarket = { ...effectiveMarket };
                const marketData = planMarket;
                const initial = await evaluatePlan({ targetYear, marketData, cash: /** @type {import("../../typcheck/speicher-integration.js").Cash} */ (cash.read()), careValues: careEditor.read().values, careToday: careEditor.read().careToday, signal });
                if (revision !== planRevision || signal?.aborted || !current.root.open) return;
                if (!planEditor) {
                    planEditor = createAnnualPlanEditor({ doc: doc(), listen: current.listen,
                        getPreview: () => projectPreview({ targetYear, inflation: effectiveMarket.inflation, careValues: careEditor.read().values }),
                        getAnnualExpenses: () => ({ ...latestModel.annual, needsReview: readCloseExpenseNeeds(latestModel, targetYear, latestModel.expenseBudgetSources?.[targetYear]?.monthly ?? latestModel.annual?.budget ?? latestModel.expenseBudget) }),
                        evaluate: adoptedPlanPatch => evaluatePlan({ targetYear, marketData: planMarket, adoptedPlanPatch, cash: /** @type {import("../../typcheck/speicher-integration.js").Cash} */ (cash.read()), careValues: careEditor.read().values, careToday: careEditor.read().careToday, signal }),
                        onState: () => { onDirty(dirty()); sync(); } });
                    replace(previewBody.querySelector('[data-annual-plan-outcome-host]'), planEditor.root);
                    for (const details of previewBody.querySelectorAll('[data-annual-calculations], [data-annual-pension-months]')) planEditor.root.append(details);
                    current.closed.then(() => planEditor.dispose());
                }
                await planEditor.setBase(initial.values);
                placePlanNote();
                succeeded = true;
            } catch (error) {
                if (revision === planRevision && !signal?.aborted) current.setStatus(error.message);
            } finally {
                if (revision === planRevision) { planLoading = !succeeded; sync(); }
            }
        };
        const update = next => { if (!accepted) {
            const before = latestModel; latestModel = projectCloseMonthModel(next);
            const cashChanged = cash?.updateProposals(proposals(latestModel)); onDirty(dirty()); sync(); void updateMarketReadings();
            if (cashChanged) void recalculatePlan();
            advanceCloseImport(current, before, latestModel);
            planEditor?.refreshExpenses();
        } };
        bindClosePriceActions(current, { actions: priceActions, getModel: getPreparationModel, update, signal, after: sync });
        const confirmCape = button('CAPE-Wert bestätigen'); confirmCape.dataset.annualCapeConfirm = '';
        current.listen(confirmCape, 'click', () => {
            if (current.busy || accepted) return;
            capeConfirmedKey = capeConfirmationKey(effectiveMarket.cape); assess(); renderMarket(); sync();
        });
        const renderMarket = () => {
            const reportItems = [];
            const source = value => value?.source || value?.sourceLabel || value?.capeSource || 'Quelle fehlt';
            const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('.') : value || 'Stand unbekannt';
            const sources = [...new Set(Object.values(effectiveMarket).map(source))];
            const provenance = node('p', `Stand 31.12.${targetYear} · ${sources.length === 1 ? sources[0].replace(' · ', ', ') : sources.length ? 'verschiedene Quellen' : 'Quelle noch offen'} · gespeichert mit dem Abschluss`);
            provenance.className = 'annual-market-provenance'; provenance.dataset.annualMarketProvenance = '';
            const full = Object.keys(effectiveMarket).length === 3;
            const marketStatus = node('p', full ? 'Vollständig vorbereitet · noch nicht gespeichert' : 'Pflichtwerte ergänzen · noch nicht gespeichert');
            marketStatus.className = 'annual-market-status'; marketStatus.dataset.annualMarketStatus = '';
            const sourceDetails = Object.entries(effectiveMarket).map(([type, value]) => `${labels[type]}: ${source(value)} · ${date(value.dataAsOf || value.asOf || value.capeAsOf)}`).join('; ');
            provenance.append(createInfoPopover(doc(), 'Woher kommen die Marktdaten?', `Die Werte werden erst mit dem Jahresabschluss gespeichert. ${sourceDetails || 'Quellen noch offen.'}`));
            const items = [];
            for (const [type, label] of [['inflation', `Inflation ${targetYear}`], ['etf', 'ETF-Schlusskurs'], ['cape', 'CAPE (Shiller)']]) {
                const result = effectiveMarket[type];
                const manual = result && /manuell/i.test(source(result));
                const stale = result?.capeFetchStatus === 'warn_stale_source';
                const asOf = result?.dataAsOf || result?.asOf || result?.capeAsOf;
                const period = type === 'inflation' ? `für das Jahr ${result?.year ?? targetYear}` : asOf ? `am ${date(asOf)}` : 'Stichtag unbekannt';
                items.push({ label, value: result ? type === 'etf' ? money(result.price) : formatDisplayNumber(result.rate ?? result.capeRatio, { fractionDigits: 2 }) + (type === 'inflation' ? ' %' : '') : 'Fehlt',
                    detail: !result ? 'Von Hand ergänzen' : manual ? `Manuell · ${period}` : stale ? `Quelle veraltet · ${period}` : period,
                    info: !result ? (type === 'inflation' && errors.inflation ? inflationWait : errors[type]) || 'Noch nicht verfügbar oder ungültig. Bitte einen Wert von Hand ergänzen.'
                        : manual || stale || sources.length > 1 ? `${source(result)} · ${date(asOf)}${stale ? ' · Quelle veraltet' : ''}` : null });
            }
            // Vollständig sagt schon die Ergebniszeile oben im Reiter; die Zeile bleibt als Bereitschaftssignal, aber ausgeblendet.
            marketStatus.hidden = full;
            reportItems.push(provenance, createCloseTiles({ doc: doc(), items }), marketStatus);
            if (capeWarning) {
                const note = node('p', capeWarning); note.className = 'ds-note ds-note-warning'; note.dataset.annualCapeStoredWarning = '';
                reportItems.push(note);
            }
            if (capeJump?.exceeds) {
                const cape = effectiveMarket.cape, figure = value => formatDisplayNumber(value, { fractionDigits: 2 });
                const note = node('section'); note.className = 'ds-note ds-note-warning'; note.dataset.annualCapeJump = '';
                note.append(node('h4', 'CAPE weit vom Bezugswert'), node('p', `${figure(cape.capeRatio)} (${source(cape)}, Stand ${date(cape.capeAsOf)}) `
                    + `weicht um ${Math.round(capeJump.deviation * 100)} % vom Bezugswert ${figure(capeReference.value)} (${capeReference.label}) ab. Bitte den Wert prüfen und bestätigen oder unter „Von Hand ergänzen“ ersetzen.`));
                if (capeOpen()) note.append(confirmCape);
                else note.append(node('p', 'Für diesen Abschluss bestätigt.'));
                reportItems.push(note);
            }
            manualFields.cape.help.textContent = !loading && !effectiveMarket.cape
                ? 'Wird mit Herkunft „von Hand“ gespeichert.' : capeWarning || capeAutomaticJump ? 'Bei Bedarf kannst du den abgerufenen Wert von Hand ersetzen.'
                    : 'Optional – ergänzt einen fehlenden Abruf mit manueller Herkunft.';
            if (!loading && !effectiveMarket.cape) {
                const note = node('section'); note.className = 'ds-note ds-note-warning'; note.dataset.annualCapeMissing = '';
                note.append(node('h4', 'CAPE nicht automatisch ermittelt'),
                    node('p', (errors.cape?.includes('Zuletzt gespeichert:') ? errors.cape : capeManualHint())
                        .replace(/^CAPE nicht automatisch ermittelt\.\s*/, '')));
                reportItems.push(note);
            }
            // Eingabefelder bleiben beim Tippen samt Fokus und Cursor an ihrem Platz.
            marketReport.replaceChildren(...reportItems);
            manualIdle.hidden = manualGroups.some(item => !item.hidden);
            marketLoading.hidden = true; marketColumns.hidden = false;
        };
        const updateMarketData = packet => {
            if (accepted || !current.root.open) return;
            values = { ...packet.values }; errors = { ...packet.errors }; loading = false;
            capeWarning = packet.capeWarning;
            // Vor dem Aufbau setzen: der Kasten „Von Hand ergänzen“ prüft, ob alles ausgeblendet ist.
            fetchRetry.hidden = !Object.keys(errors).length;
            assess(); renderMarket(); void updateMarketReadings();
            if (!planEditor) replace(previewBody, previewContent(projectPreview({ targetYear, inflation: effectiveMarket.inflation })));
            void recalculatePlan();
            sync();
        };
        current.listen(fetchRetry, 'click', async () => {
            if (current.busy || loading || accepted) return;
            loading = true; fetchRetry.disabled = true; sync();
            try { await retryMarketData?.(); } catch (error) { current.setStatus(error.message); }
            finally { loading = false; fetchRetry.disabled = false; sync(); }
        });
        current.listen(current.root, 'input', event => { onDirty(dirty()); if (event.target === handPrice || Object.values(manualFields).some(field => field.input === event.target)) {
                assess();
                renderMarket(); void updateMarketReadings();
                void recalculatePlan();
            } sync(); });
        current.listen(confirmButton, 'click', () => {
            if (current.busy || accepted || signal?.aborted) return;
            sync();
            if (confirmButton.disabled) return;
            try {
                if (handPrice.validity?.badInput) throw new Error('Bitte einen gültigen ETF-Schlusskurs eingeben.');
                const options = manualAllowed.has('etf') && handPrice.value.trim() ? validatePrice(String(effectiveMarket.etf.price)) : {};
                if (cash) options.cash = /** @type {import("../../typcheck/speicher-integration.js").Cash} */ (cash.read());
                options.careValues = careEditor.accept();
                options.careToday = careEditor.read().careToday;
                if (propertyEditor.present) options.propertyValues = propertyEditor.accept();
                options.preparedMarketData = { ...effectiveMarket };
                options.displayPreview = structuredClone(projectPreview({ targetYear, inflation: effectiveMarket.inflation, careValues: careEditor.read().values }));
                if (planEditor) options.adoptedPlanPatch = planEditor.accept();
                accepted = true; savingYear = true; onDirty(false); confirmButton.hidden = true;
                current.setBusy(true); current.setStatus(YEAR_SAVING_TEXT);
                endPreparation?.(options); endPreparation = null;
            } catch (error) { current.setStatus(error.message); }
        });
        const abort = () => { if (!accepted) current.close(false); };
        signal?.addEventListener('abort', abort, { once: true });
        current.closed.then(() => signal?.removeEventListener('abort', abort));
        onReady?.({ ...current, get busy() { return current.busy; }, updateMarketData, update, syncReady: sync, setImportActive(value) { importActive = value; sync(); }, dirty });
        sync(); if (signal?.aborted) abort(); return pending;
    };
    const showProtocol = (annual, results) => {
        if (annual.dataset.annualProtocol !== undefined) return;
        annual.dataset.annualProtocol = '';
        annual.append(node('h4', 'Protokoll'));
        // Altbestand [A7]: Protokolle mit der Wahl „Jahreshoch“ nennen sie weiter.
        const legacyReading = annualMarketChoiceLabel(results.etf?.ath?.reading === 'year_high'
            ? { reading: 'year_high', asOf: results.etf.ath.lastHighAsOf } : null);
        if (legacyReading) annual.append(node('p', legacyReading));
        for (const [id, value] of Object.entries(results.monthSession?.request?.cash?.playValues || {})) {
            const name = results.monthSession.request.cash.people.find(person => person.id === id)?.name || id;
            annual.append(node('p', `Tagesgeld ${name} · Spielwert: ${money(value.value)}. ${value.explanation}`));
        }
        for (const split of results.etf?.ath?.splits || []) annual.append(node('p', `Split 1:${formatDisplayNumber(split.ratio, { fractionDigits: 2, minimumFractionDigits: 0 })} am ${split.asOf.split('-').reverse().join('.')}: Allzeithoch ${money(split.athBefore)} → ${money(split.athAfter)}, Jahresschlüsse geteilt`));
        for (const [key, label] of [['inflation', 'Inflation'], ['etf', 'ETF-Schlusskurs'], ['cape', 'US Shiller CAPE']]) {
            const value = results[key];
            if (value) annual.append(node('p', `${label}${key === 'inflation' ? ` ${value.year ?? results.targetYear}` : ''}: ${key === 'etf' ? money(value.price) : formatDisplayNumber(value.rate ?? value.capeRatio, { fractionDigits: 2 })}${key === 'inflation' ? ' %' : ''} · ${value.source || value.sourceLabel || value.capeSource || 'Quelle fehlt'}`));
        }
    };
    const actionContent = results => results.actionResult ? createAnnualTodoResult(doc(), results.actionResult) : null;
    const showMonthPhase = results => {
        const current = handle, session = results.monthSession, model = session.model;
        savingYear = false;
        monthResults = results; monthReceipt = session.result || monthReceipt;
        const data = projectConfirmedMonthResult(model, session.request.cash);
        hidePreparationBackup(); current.setBusy(false); current.setMessage('');
        const actionResult = results.actionResult || projectAnnualCloseResult({ ...results, model });
        const action = createAnnualTodoResult(doc(), actionResult);
        const peoplePreview = projectPreview({ targetYear: results.targetYear, confirmed: true });
        const annual = createAnnualPlanResult({ doc: doc(), result: actionResult, model, peoplePreview }); annual.id = 'annualResults';
        // Rechts: wie viel vom alten Plan umgesetzt wurde, in denselben Wörtern wie im Schritt „Plan“ (Entwurf 6).
        const oldProgress = readPlanProgress({ model, year: results.targetYear });
        if (oldProgress) annual.insertBefore(createPlanProgressNote(doc(), oldProgress, true), annual.querySelector('[data-annual-plan-derivation]'));
        const receiptDetails = createAnnualReceiptCard({ doc: doc(), logButton,
            text: `${annualMarketChoiceLabel(actionResult.marketReading)?.concat('. ') ?? ''}${monthReceipt ? 'Wiederherstellungspunkte für Jahr und Monat angelegt. ' : ''}Jahr und Monat haben getrennte Wiederherstellungspunkte. ${data.withdrawalDetail}. Die Anzeige bestätigt keine ausgeführte Überweisung.` });
        if (results.showProtocol) {
            showProtocol(annual, results);
            annual.append(node('p', `Jahr: ${session.annualSnapshotId || 'siehe Sicherungsverwaltung'} · Monat: ${monthReceipt?.monthSnapshotId || 'noch offen'}`));
        }
        let body;
        if (monthReceipt) {
            current.root.dataset.annualMonthResult = 'confirmed';
            body = createAnnualCombinedResult({ doc: doc(), result: actionResult, data, annual, action, targetYear: results.targetYear });
            current.setTitle(`${data.month} und Jahr ${results.targetYear} abgeschlossen`);
            current.setSubtitle(`${session.request.cash.people.map(person => person.name).join(' + ')} · gespeichert am ${model.now.toLocaleDateString('de-DE')}`);
            current.setStatus(nextCloseText(model)); closeButton.hidden = true; confirmButton.textContent = 'Fertig';
        } else {
            body = node('section'); body.className = 'close-dialog-result';
            const error = node('h3', monthFailureText(results, model));
            error.setAttribute('role', 'status'); body.append(error, action, annual);
            if (results.monthError) body.append(node('p', results.monthError));
            body.append(node('p', 'Erneut versuchen speichert nur den Monat. Der Jahresabschluss bleibt erhalten.'));
            current.setStatus(session.phase === 'recovery' ? 'Wiederherstellung erforderlich. Bitte den Monatswiederherstellungspunkt in der Sicherungsverwaltung prüfen.' : '');
            confirmButton.textContent = 'Erneut versuchen';
        }
        body.append(receiptDetails);
        current.setResult(body);
        current.setFootnote(''); closeButton.hidden = true;
        confirmButton.hidden = false; confirmButton.disabled = session.phase === 'recovery'; confirmButton.dataset.overviewMonthAccept = '';
        recoveryButton.hidden = session.phase !== 'recovery'; retryButton.hidden = true; logButton.hidden = false;
    };
    const showUpdateResultModal = results => {
        if (!results) return;
        const existing = handle?.root.querySelector('#annualResults');
        if (results.showProtocol && results.monthSession && monthResults?.monthSession === results.monthSession && existing) {
            if (handle.busy || isCommitActive()) return;
            showProtocol(existing, results);
            existing.scrollIntoView?.({ block: 'start' });
            return;
        }
        accepted = true; savingYear = false;
        const current = handle || open({ title: results.kind === 'planning_start' ? 'Erster Jahresabschluss' : 'Jahresabschluss', opener: results.opener,
            model: results.monthSession?.model || getModel() });
        if (!current) return;
        current.root.dataset.annualYearResult = results.confirmed ? 'confirmed' : 'unconfirmed';
        if (results.monthSession) { showMonthPhase(results); return; }
        const body = node('section', undefined, 'annualResults'); body.id = 'annualResults'; body.className = 'close-dialog-result';
        if (results.kind === 'planning_start') body.append(node('p', `Erstes Planungsjahr ${results.firstPlanningYear} · erster Jahresabschluss Anfang ${results.firstPlanningYear + 1}.`));
        else {
            const status = node('h3', results.monthError ? monthFailureText(results, getModel()) : results.confirmed ? 'Jahresabschluss bestätigt' : 'Jahresabschluss unvollständig'); status.setAttribute('role', 'status'); body.append(status);
            const action = actionContent(results); if (action) body.append(action);
            for (const [key, label] of [['inflation', 'Inflation'], ['etf', 'ETF-Schlusskurs'], ['cape', 'US Shiller CAPE']]) {
                const result = results[key]; if (!result) continue;
                const row = node('section'); row.className = 'ds-note' + (result.capeFetchStatus === 'warn_stale_source' ? ' ds-note-warning' : '');
                row.append(node('h4', key === 'inflation' ? `${label} ${result.year ?? results.targetYear ?? ''}` : label), node('p', `${key === 'etf' ? money(result.price) : formatDisplayNumber(result.rate ?? result.capeRatio, { fractionDigits: 2 })}${key === 'inflation' ? ' %' : ''} · ${result.source || result.sourceLabel || result.capeSource || 'Quelle fehlt'}${result.capeFetchStatus === 'warn_stale_source' ? ' · Quelle veraltet' : ''}`));
                // FR-89: Allzeithoch mit dem Tag seines Schlusskurses; das Alter zählt in Bruchjahren bis zum 31.12.
                if (result.ath) row.append(node('p', `Allzeithoch: ${money(result.ath.new)}${result.ath.lastHighAsOf ? ` · Tagesschluss vom ${result.ath.lastHighAsOf.split('-').reverse().join('.')}` : ''} · Jahre seit Allzeithoch: ${formatDisplayNumber(result.ath.yearsSince, { fractionDigits: 1 })}${athNoiseBandApplies({ ath: result.ath.new, endeVJ: result.price, jahreSeitAth: result.ath.yearsSince }) ? ` · ${ATH_NOISE_BAND_TEXT}` : ''}`));
                for (const split of result.ath?.splits || []) row.append(node('p', `Split 1:${formatDisplayNumber(split.ratio, { fractionDigits: 2, minimumFractionDigits: 0 })} am ${split.asOf.split('-').reverse().join('.')}: Allzeithoch ${money(split.athBefore)} → ${money(split.athAfter)}, Jahresschlüsse geteilt`));
                const legacyReading = result.ath ? annualMarketChoiceLabel(result.ath.reading === 'year_high' ? { reading: 'year_high', asOf: result.ath.lastHighAsOf } : null) : null;
                if (legacyReading) row.append(node('p', legacyReading));
                body.append(row);
            }
            for (const error of results.errors || []) { const row = node('p', `${error.step}: ${displayDiagnosisText(error.error)}`); row.className = 'ds-note ds-note-error'; body.append(row); }
            if (Number.isInteger(results.targetYear) && !results.actionResult) body.append(previewContent(projectPreview({ targetYear: results.targetYear, confirmed: true }), 'Planstand'));
            if (Number.isFinite(results.startTime) && Number.isFinite(results.endTime)) body.append(node('p', `Dauer: ${formatDisplayNumber((results.endTime - results.startTime) / 1000, { fractionDigits: 1 })}\u00a0Sekunden`));
            if (results.showProtocol) body.append(node('h4', 'Protokoll'), node('p', `Start: ${new Date(results.startTime).toLocaleString('de-DE')} · Ende: ${new Date(results.endTime).toLocaleString('de-DE')}`));
        }
        if (results.recovery) {
            body.append(node('p', results.recovery.message));
            if (results.recovery.label) body.append(node('p', `Wiederherstellungspunkt: ${results.recovery.label}`));
            if (results.recovery.createdAt) body.append(node('p', `Gesichert am ${new Date(results.recovery.createdAt).toLocaleString('de-DE')}`));
            const load = button('Wiederherstellungspunkt laden', 'annualLoadRecovery');
            current.listen(load, 'click', async () => { await current.requestClose(); if (!current.root.open) results.openRecovery?.(); });
            body.append(load);
        }
        confirmButton.hidden = true; retryButton.hidden = !results.retry; logButton.hidden = results.kind === 'planning_start' || Boolean(results.showProtocol) || !getLastUpdateResults();
        if (results.retry) {
            body.append(makeHandPrice(), node('p', 'Nach Bestätigung wird der Wiederherstellungspunkt geladen. Nach dem geschützten Reload wird dieselbe Jahresperiode einmalig mit diesem Kurs fortgesetzt.', 'annualRetryNotice'));
            retryAction = async () => {
                if (retryPending) return;
                try { const options = results.validatePrice(String(parseManualAnnualNumber(handPrice.value))); retryPending = true; current.setBusy(true); await results.retry(options); }
                catch (error) { current.setStatus(error.message); }
                finally { retryPending = false; current.setBusy(false); }
            };
        }
        if (results.monthError) {
            body.append(node('p', `Jahr gespeichert · Monat noch offen. ${results.monthError}`));
            if (results.retryMonth) {
                const retryMonth = button('Erneut versuchen', 'annualMonthStepConfirm');
                current.listen(retryMonth, 'click', async () => {
                    if (current.busy) return;
                    current.setBusy(true); current.setStatus(MONTH_SAVING_TEXT);
                    try {
                        if (!await results.retryMonth()) throw new Error('Monatsabschluss nicht bestätigt.');
                        delete results.monthError;
                    } catch (error) { results.monthError = error.message; }
                    finally { current.setBusy(false); showUpdateResultModal(results); }
                });
                body.append(retryMonth);
            }
        }
        body.append(createAnnualReceiptCard({ doc: doc(), logButton }));
        current.setFootnote('');
        current.setMessage(''); current.setResult(body); current.setStatus(results.confirmed ? 'Jahr gespeichert · Monatsbetrag noch nicht bereitgestellt' : results.recovery?.message || ''); current.setBusy(false);
    };
    return { showAnnualPreparation, showUpdateResultModal,
        reportError: (error, action) => {
            if (dialogState?.handle.root.open && dialogState.handle.root.isConnected) {
                onClearError(); dialogState.report(error, action);
            } else onError(error, action);
        },
        clearError: () => { onClearError(); handle?.setMessage(''); },
        finishPreflight: () => { if (!dialogState) return false; savingYear = false; dialogState.finishPreflight(); return true; },
        // Während das Jahr gespeichert wird, bleibt „Jahr wird gespeichert …“ stehen; Zwischenschritte ersetzen ihn nicht.
        setProgress: text => handle?.setStatus(savingYear && handle.busy ? YEAR_SAVING_TEXT : text),
        abortContinuation: () => handle?.close(false),
        /** @param {{targetYear?: number; opener?: HTMLElement}} [options] */
        showAnnualContinuation: ({ targetYear, opener } = {}) => {
            const current = handle || open({ title: `Jahr ${targetYear} abschließen`, opener });
            if (current) { current.setStatus('Der Jahresabschluss wird fortgesetzt …'); current.setBusy(true); }
        },
        showPlanningStart: options => showUpdateResultModal({ ...options, kind: 'planning_start' }),
        handleShowUpdateLog: (showProtocol = true) => { const last = getLastUpdateResults(); if (last) showUpdateResultModal({ ...last, showProtocol }); else onNotice('Noch kein Jahres-Update durchgeführt.'); },
        closeAnnualModal: () => { if (!handle) return true; if (handle.busy || isCommitActive() || retryPending) return false; void handle.requestClose(); return true; }
    };
}
