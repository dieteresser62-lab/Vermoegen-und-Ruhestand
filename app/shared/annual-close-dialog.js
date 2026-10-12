import { createManualAnnualValue, validateAnnualPreparationValue } from './annual-marketdata.js';
import { bindClosePriceActions } from './close-price-actions.js';
import { createCloseDialog, createCloseResult, advanceCloseImport, closeReadinessText, projectCloseMonthModel } from '../shared/close-dialog.js';
import { createTagesgeldFields, parseMonthlyCashInput } from '../shared/tagesgeld-fields.js';
import { projectOverviewMonthSteps, createOverviewStepContent, projectConfirmedMonthResult, preserveCloseDetails } from '../overview/overview-month-confirmation.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { createAnnualActionResult, createAnnualPlanResult, projectAnnualCloseResult } from './annual-close-result.js';
import { projectAnnualPreview, formatAnnualNeed } from '../balance/balance-annual-preview.js';
import { createAnnualPlanEditor } from './annual-plan-editor.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { displayDiagnosisText } from '../balance/balance-diagnosis-transaction.js';
import { bindFullBackupButton } from '../shared/persistence-backup.js';
import { readLastFullBackup } from '../overview/overview-storage.js';
import { overviewBackupAge } from '../overview/overview-model.js';
import { appNow } from '../shared/app-clock.js';
import { AppError, ValidationError } from '../balance/balance-config.js';
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

/** Jahresadapter der gemeinsamen, schreibfreien Abschlusskomponente. */
export function createAnnualCloseDialog({ getLastUpdateResults = () => null, getModel = () => ({}), document: injectedDocument,
    priceActions, projectPreview = options => projectAnnualPreview(options), evaluatePlan, onError = () => {}, onClearError = () => {}, onNotice = () => {},
    isCommitActive = () => getPageNavigationGuard().reasons().some(reason => reason.phase === 'commit') } = {}) {
    let dialogState = null;
    let handle = null, accepted = false, endPreparation = null, retryPending = false;
    let handPrice, handGroup, confirmButton, retryButton, closeButton, logButton, marketBody, previewBody;
    let monthResults = null, monthReceipt = null, recoveryButton, retryAction, saveMonth, hidePreparationBackup = () => {};
    const doc = () => injectedDocument || globalThis.document;
    const node = (tag, text, id) => {
        const element = doc().createElement(tag); if (text !== undefined) element.textContent = text;
        if (id) element.id = id; return element;
    };
    const button = (text, id) => { const element = node('button', text, id); element.type = 'button'; element.className = 'ds-button ds-button-secondary'; return element; };
    const previewContent = (preview, title = 'Planvorschau') => {
        const body = node('section'); body.dataset.annualPreview = ''; body.append(node('h3', `${title} ${preview.targetYear} → ${preview.planningYear}`));
        for (const person of preview.people) {
            body.append(node('h4', person.name));
            if (person.error) { body.append(node('p', person.error)); continue; }
            body.append(node('p', `${person.startAlter}\u00a0Jahre am 01.01.${preview.planningYear}`),
                node('p', person.ageStatus === 'fallback' ? 'Geburtsdatum einmal ergänzen; das hinterlegte Alter bleibt bis dahin unverändert.' : 'Aus dem Geburtsdatum abgeleitet; vollendete Jahre am 1. Januar.'),
                node('p', `Rente: ${money(person.renteMonatlich)} monatlich · ${person.monateImJahr} Bezugsmonate · ${money(person.renteImJahr)} im Planungsjahr.`),
                node('p', `Rentenbezugsgröße im Budget: ${money(person.budgetPensionMonthly)} im Jahresdurchschnitt pro Monat.`));
        }
        if (!preview.people.length) body.append(node('p', 'Personenquellen fehlen. Bitte zentral ergänzen.'));
        for (const need of preview.needs.filter(need => ['floorBedarf', 'flexBedarf'].includes(need.id))) {
            body.append(node('p', `${need.id === 'floorBedarf' ? 'Grundbedarf' : 'Flex-Bedarf'} jährlich: ${formatAnnualNeed(need, preview)}`));
        }
        if (!preview.needs.length) body.append(node('p', 'Die Bedarfsvorschau erscheint nach dem Inflationsabruf.'));
        return body;
    };
    const replace = (body, content) => { Array.from(body.children || []).forEach(child => child.remove()); body.append(content); };
    const open = ({ title, subtitle = '', progressNames = null, opener = doc().activeElement, steps = [], model = getModel(), onClose = () => true } = {}) => {
        if (handle?.root.open) return handle;
        monthResults = null; monthReceipt = null; retryAction = null; hidePreparationBackup = () => {};
        closeButton = button('Schließen', 'annualCloseBtn'); closeButton.id = 'annualCloseBtn';
        confirmButton = button('Jahr abschließen', 'annualConfirmBtn'); confirmButton.id = 'annualConfirmBtn'; confirmButton.className = 'ds-button ds-button-primary'; confirmButton.hidden = true;
        retryButton = button('Mit diesem Kurs erneut abschließen', 'annualRetryBtn'); retryButton.id = 'annualRetryBtn'; retryButton.hidden = true;
        logButton = button('Protokoll anzeigen', 'annualShowLog'); logButton.id = 'annualShowLog'; logButton.hidden = true;
        recoveryButton = button('Wiederherstellungspunkte anzeigen', 'annualShowRecovery'); recoveryButton.id = 'annualShowRecovery'; recoveryButton.hidden = true;
        handle = createCloseDialog({ doc: doc(), id: 'balanceAnnualClose', title, subtitle, progressNames,
            footnote: 'Kurse, Ausgaben und Budget sind Empfehlungen und verhindern den Abschluss nicht. Alle sechs Vorbereitungsschritte ansehen und Tagesgeld aller Personen bestätigen; gültige Jahrespflichtdaten sind erforderlich. Ein Wiederherstellungspunkt wird vor dem Speichern erstellt.',
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
            current.setBusy(true); current.setStatus('Monat wird gespeichert …');
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
        handPrice = node('input', undefined, 'annualHandPrice'); handPrice.id = 'annualHandPrice'; handPrice.type = 'number'; handPrice.min = '0.5'; handPrice.max = '100000'; handPrice.step = '0.01'; handPrice.value = '';
        handPrice.className = 'ds-input'; handPrice.dataset.annualTransient = ''; handPrice.setAttribute('aria-describedby', 'annualHandPriceHelp');
        const help = node('p', 'Optional – ersetzt nur den ETF-Schlusskurs, wenn der Abruf fehlt.'); help.id = 'annualHandPriceHelp';
        handGroup.append(label, handPrice, help);
        return handGroup;
    };
    const showAnnualPreparation = ({ targetYear, validatePrice = () => ({}), signal, opener, people = [],
        model = getModel(), getModel: getPreparationModel = getModel, onReady, onDirty = () => {}, confirmDiscard = async () => false, onClose, retryMarketData } = {}) => {
        if (handle?.root.open) return Promise.resolve(null);
        model = projectCloseMonthModel(model);
        accepted = false;
        let values = {}, errors = {}, loading = true, planLoading = Boolean(evaluatePlan), planRevision = 0, planEditor = null, planMarket = null, importActive = false;
        const cash = people.length ? createTagesgeldFields({ doc: doc(), people, prefix: 'annualTagesgeld', monthly: true, closePresentation: true, requireConfirmation: true,
            title: '', explanation: 'Jahresendstand je Haushaltsperson. Der Cashbeleg trägt weiterhin den heutigen Bestätigungstag.' }) : null;
        // Referenzen aus dem erzeugten Block behalten, auch wenn Dialogupdates ihn umhängen.
        const cashErrors = cash?.inputs.map(input => cash.root.querySelector(`#${input.id}-error`)) || [];
        const initial = cash?.inputs.map(input => input.value) || [];
        const dirty = () => Boolean(planEditor?.read().dirty) || Boolean(handPrice?.value) || Object.values(manualFields).some(field => Boolean(field.input.value)) || Boolean(cash?.inputs.some((input, index) => {
            try { return parseMonthlyCashInput(input.value) !== parseMonthlyCashInput(initial[index]); }
            catch { return input.value !== initial[index]; }
        }));
        const status = node('p', '', 'overviewExampleExpensesStatus'); status.setAttribute('role', 'status');
        const wealthStatus = node('p', '', 'overviewExpensesWealthStatus'); wealthStatus.setAttribute('role', 'status'); wealthStatus.dataset.errorChannel = 'expenses-wealth';
        const cashBody = node('div'); if (cash) cashBody.append(cash.root);
        marketBody = node('div'); marketBody.append(node('p', 'Marktdaten werden automatisch vorbereitet …'), makeHandPrice());
        const fetchRetry = button('Fehlende Marktdaten erneut abrufen', 'annualMarketRetryBtn'); fetchRetry.id = 'annualMarketRetryBtn'; marketBody.append(fetchRetry);
        previewBody = node('div'); previewBody.append(previewContent(projectPreview({ targetYear })));
        const cashHint = node('p', 'Tagesgeldentwurf – wird erst mit dem Jahresabschluss gespeichert.'); cashBody.append(cashHint);
        const manualFields = {};
        for (const [type, label] of [['inflation', `Inflation ${targetYear} von Hand (%)`], ['cape', 'US Shiller CAPE von Hand']]) {
            const group = node('section'); group.className = 'ds-field';
            const input = node('input'); input.id = `annualHand${type === 'cape' ? 'Cape' : 'Inflation'}`; input.type = 'text'; input.value = ''; input.className = 'ds-input'; input.dataset.annualTransient = ''; input.setAttribute('inputmode', 'decimal');
            const title = node('label', label); title.setAttribute('for', input.id);
            const help = node('p', 'Optional – ergänzt einen fehlenden Abruf mit manueller Herkunft.');
            const error = node('p'); error.id = `${input.id}Error`; error.setAttribute('role', 'alert'); error.className = 'tagesgeld-error'; input.setAttribute('aria-describedby', error.id);
            group.append(title, input, help, error); marketBody.append(group); manualFields[type] = { group, input, error };
        }
        const handError = node('p'); handError.setAttribute('role', 'alert'); handError.id = 'annualHandPriceError'; handPrice.setAttribute('aria-describedby', 'annualHandPriceHelp annualHandPriceError'); handGroup.append(handError);
        let latestModel = model, cashValid = false, effectiveMarket = {}, missing = null;
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
            cashHint.textContent = cash?.ready ? 'Eingetragen – wird erst mit dem Jahresabschluss gespeichert.' : 'Tagesgeld ändern oder ‚Stand stimmt‘ bestätigen.';
            if (cashValid && !cash?.ready) missing ||= { id: 'cash', text: 'Tagesgeld ändern oder ‚Stand stimmt‘ bestätigen.' };
            effectiveMarket = {};
            for (const type of Object.keys(labels)) {
                const input = type === 'etf' ? handPrice : manualFields[type].input;
                const errorNode = type === 'etf' ? handError : manualFields[type].error;
                let automatic;
                try { if (values[type]) automatic = validateAnnualPreparationValue(type, values[type], targetYear); }
                catch { /* Ungültige Abrufe bleiben ergänzbar. */ }
                if (!loading && !automatic) manualAllowed.add(type);
                const canEdit = manualAllowed.has(type);
                (type === 'etf' ? handGroup : manualFields[type].group).hidden = !canEdit;
                input.disabled = !canEdit || loading || current.busy;
                let error = '';
                try {
                    if (canEdit && input.validity?.badInput) throw new Error(`Bitte ${labels[type]} gültig eingeben.`);
                    if (canEdit && input.value.trim()) {
                        if (type === 'etf') validatePrice(input.value.trim());
                        effectiveMarket[type] = createManualAnnualValue(type, input.value, targetYear);
                    } else if (automatic) effectiveMarket[type] = automatic;
                    else throw new Error(errors[type] || 'Noch nicht verfügbar');
                } catch (failure) { error = failure.message; missing ||= { id: 'market', text: `${labels[type]}: ${error}` }; }
                errorNode.textContent = canEdit && (input.value.trim() || input.validity?.badInput) ? error : ''; input.setAttribute('aria-invalid', String(Boolean(errorNode.textContent)));
            }
            if (loading) missing ||= { id: 'market', text: 'Marktdaten werden noch vorbereitet.' };
            if (planLoading) missing ||= { id: 'preview', text: 'Planprüfung wird noch berechnet oder konnte nicht abgeschlossen werden.' };
            if (planEditor && !planEditor.read().valid) missing ||= { id: 'preview', text: 'Bitte die markierten Planwerte prüfen.' };
            const unseen = current.firstUnvisited();
            if (unseen) missing = { id: unseen.id, text: closeReadinessText({ unseen }) };
            if (latestModel.recovery) missing = { id: 'market', text: 'Wiederherstellung erforderlich.' };
            if (importActive || current.busy || isCommitActive()) missing = { id: 'expenses', text: importActive ? 'Ausgabenimport läuft – bitte warten.' : 'Speichervorgang läuft – bitte warten.' };
        };
        const contents = new Map();
        const project = next => {
            const steps = projectOverviewMonthSteps(next).slice(0, 3).map(step => ({ ...step, contentOwnResult: true,
                content: preserveCloseDetails(contents.get(step.id), createOverviewStepContent({ doc: doc(), model: next, step, status, wealthStatus })) }));
            steps.forEach(step => contents.set(step.id, step.content));
            const budget = steps.find(step => step.id === 'budget');
            const annual = next.annual || {};
            budget.content.append(node('p', `Jahresausgaben ${annual.year ?? targetYear}: ${money(annual.total)} · Jahresbudget: ${money(Number.isFinite(annual.budget) ? annual.budget * 12 : null)}${annual.complete ? '' : ' · unvollständig'}`));
            return [...steps, { id: 'cash', title: `Tagesgeld am 31.12.${targetYear}`, content: cashBody, contentOwnResult: true, state: cash?.ready ? 'entered' : 'open', result: cash?.ready ? 'Eingetragen – wird erst mit dem Jahresabschluss gespeichert.' : 'Einmaliger Jahresendstand je Person' },
                { id: 'market', title: 'Marktdaten automatisch holen', content: marketBody, prepared: true, preparing: loading, done: !loading && Object.keys(effectiveMarket).length === 3, result: !loading && Object.keys(effectiveMarket).length === 3 ? 'Vollständig vorbereitet · noch nicht gespeichert' : 'Pflichtwerte ergänzen' },
                { id: 'preview', title: `Plan ${targetYear + 1} prüfen`, content: previewBody, prepared: true, preparing: loading || planLoading, done: !loading && Object.keys(effectiveMarket).length === 3 && !planLoading && (!planEditor || planEditor.read().valid), result: 'Planwerte ansehen und bei Bedarf bewusst anpassen.' }];
        };
        const pending = new Promise(resolve => { endPreparation = resolve; });
        const current = open({ title: `${monthName(model)} und Jahr ${targetYear} abschließen`, opener, steps: project(model), model,
            progressNames: people.map(person => person.name).join(' + '),
            onClose: async () => {
                if (!accepted && dirty() && !await confirmDiscard()) return false;
                return await onClose?.() !== false;
            } });
        if (!current) { endPreparation = null; return Promise.resolve(null); }
        const backupNote = node('section'); backupNote.className = 'close-dialog-backup ds-note ds-note-warning';
        const backupButton = button('Jetzt sichern'); backupButton.dataset.overviewBackup = '';
        backupNote.append(node('p', 'Vor dem Jahresabschluss empfiehlt sich eine aktuelle Vollsicherung.'), backupButton);
        const backupStatus = node('p'); backupStatus.className = 'close-dialog-backup-status'; backupStatus.hidden = true;
        backupStatus.setAttribute('role', 'status'); backupStatus.dataset.annualBackupStatus = '';
        const footer = current.root.querySelector('[data-close-dialog-footer]'); footer.append(backupNote, backupStatus, ...Array.from(footer.children));
        let yearStored = false;
        hidePreparationBackup = () => { yearStored = true; backupNote.hidden = true; backupStatus.hidden = true; current.setStatus(''); };
        const syncBackup = () => { backupNote.hidden = yearStored || !overviewBackupAge(appNow(), readLastFullBackup()).recommended; };
        // Der bestehende Binder erhält eine lebensdauergebundene Knopfschnittstelle.
        // Fachliche Export- und Probelaufsperren bleiben beim Vollbackupdienst.
        bindFullBackupButton({ document: doc(), status: backupStatus, button: {
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
        } });
        current.listen(doc(), 'overview-backup-changed', syncBackup); syncBackup();
        confirmButton.hidden = false; confirmButton.textContent = `Jahr ${targetYear} abschließen`;
        const sync = () => {
            // Nach bestätigter Vorbereitung gehört der Knopf der Monats-/Ergebnisphase.
            if (accepted) return;
            assess();
            current.updateSteps(project(latestModel));
            confirmButton.disabled = current.busy || Boolean(missing);
            current.setStatus(closeReadinessText({ problem: missing?.text, action: `Jahr ${targetYear} abschließen` }));
        };
        current.setOnVisit(sync);
        cash?.bind(current.listen, sync);
        const recalculatePlan = async () => {
            if (!evaluatePlan || accepted || !current.root.open) return;
            const revision = ++planRevision; let succeeded = false; planLoading = true; sync();
            try {
                assess();
                if (loading || Object.keys(effectiveMarket).length !== 3) return;
                planMarket = { ...effectiveMarket };
                const marketData = planMarket;
                const initial = await evaluatePlan({ targetYear, marketData, signal });
                if (revision !== planRevision || signal?.aborted || !current.root.open) return;
                if (!planEditor) {
                    planEditor = createAnnualPlanEditor({ doc: doc(), listen: current.listen,
                        evaluate: adoptedPlanPatch => evaluatePlan({ targetYear, marketData: planMarket, adoptedPlanPatch, signal }),
                        onState: () => { onDirty(dirty()); sync(); } });
                    previewBody.append(planEditor.root);
                    current.closed.then(() => planEditor.dispose());
                }
                await planEditor.setBase(initial.values);
                succeeded = true;
            } catch (error) {
                if (revision === planRevision && !signal?.aborted) current.setStatus(error.message);
            } finally {
                if (revision === planRevision) { planLoading = !succeeded; sync(); }
            }
        };
        const update = next => { if (!accepted) {
            const before = latestModel; latestModel = projectCloseMonthModel(next); sync();
            advanceCloseImport(current, before, latestModel);
        } };
        bindClosePriceActions(current, { actions: priceActions, getModel: getPreparationModel, update, signal, after: sync });
        const renderMarket = () => {
            const report = node('div');
            for (const [type, label] of [['inflation', 'Inflation'], ['etf', 'ETF-Schlusskurs'], ['cape', 'US Shiller CAPE']]) {
                const result = effectiveMarket[type];
                report.append(node('p', result ? `${label}: ${type === 'etf' ? money(result.price) : formatDisplayNumber(result.rate ?? result.capeRatio, { fractionDigits: 2 })}${type === 'inflation' ? ' %' : ''} · ${result.source || result.sourceLabel || result.capeSource} · ${result.dataAsOf || result.asOf || result.capeAsOf || 'Stand unbekannt'}`
                    : `${label}: ${errors[type] || 'Noch nicht verfügbar oder ungültig'}`));
            }
            // Entwurfsfelder behalten ihre Identität und Werte.
            replace(marketBody, report); marketBody.append(handGroup, ...Object.values(manualFields).map(field => field.group), fetchRetry);
        };
        const updateMarketData = packet => {
            if (accepted || !current.root.open) return;
            values = { ...packet.values }; errors = { ...packet.errors }; loading = false;
            assess(); renderMarket();
            if (!planEditor) replace(previewBody, previewContent(projectPreview({ targetYear, inflation: effectiveMarket.inflation })));
            void recalculatePlan();
            fetchRetry.hidden = !Object.keys(errors).length; sync();
        };
        current.listen(fetchRetry, 'click', async () => {
            if (current.busy || loading || accepted) return;
            loading = true; fetchRetry.disabled = true; sync();
            try { await retryMarketData?.(); } catch (error) { current.setStatus(error.message); }
            finally { loading = false; fetchRetry.disabled = false; sync(); }
        });
        current.listen(current.root, 'input', event => { onDirty(dirty()); if (event.target === handPrice || Object.values(manualFields).some(field => field.input === event.target)) {
                assess();
                renderMarket();
                void recalculatePlan();
            } sync(); });
        current.listen(confirmButton, 'click', () => {
            if (current.busy || accepted || signal?.aborted) return;
            sync();
            if (confirmButton.disabled) return;
            try {
                if (handPrice.validity?.badInput) throw new Error('Bitte einen gültigen ETF-Schlusskurs eingeben.');
                const options = manualAllowed.has('etf') && handPrice.value.trim() ? validatePrice(handPrice.value.trim()) : {};
                if (cash) options.cash = cash.read();
                options.preparedMarketData = { ...effectiveMarket };
                options.displayPreview = structuredClone(projectPreview({ targetYear, inflation: effectiveMarket.inflation }));
                if (planEditor) options.adoptedPlanPatch = planEditor.accept();
                accepted = true; onDirty(false); confirmButton.hidden = true;
                current.setBusy(true); current.setStatus('Importjobs werden beendet; danach wird das Jahr gespeichert …');
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
        for (const [key, label] of [['inflation', 'Inflation'], ['etf', 'ETF-Schlusskurs'], ['cape', 'US Shiller CAPE']]) {
            const value = results[key];
            if (value) annual.append(node('p', `${label}${key === 'inflation' ? ` ${value.year ?? results.targetYear}` : ''}: ${key === 'etf' ? money(value.price) : formatDisplayNumber(value.rate ?? value.capeRatio, { fractionDigits: 2 })} · ${value.source || value.sourceLabel || value.capeSource || 'Quelle fehlt'}`));
        }
    };
    const actionContent = results => results.actionResult ? createAnnualActionResult({ doc: doc(), result: results.actionResult }) : null;
    const showMonthPhase = results => {
        const current = handle, session = results.monthSession, model = session.model;
        monthResults = results; monthReceipt = session.result || monthReceipt;
        hidePreparationBackup(); current.setBusy(false); current.setMessage('');
        const actionResult = results.actionResult || projectAnnualCloseResult({ ...results, model });
        const action = createAnnualActionResult({ doc: doc(), result: actionResult });
        const annual = node('section'); annual.id = 'annualResults';
        annual.append(createAnnualPlanResult({ doc: doc(), result: actionResult }),
            node('p', `Monatsbudget Plan ${model.summary.year}: ${money(model.summary.monthlyBudget)}`));
        const peoplePreview = projectPreview({ targetYear: results.targetYear, confirmed: true });
        for (const person of peoplePreview.people) {
            annual.append(node('h4', person.name));
            if (person.error) annual.append(node('p', person.error));
            else annual.append(node('p', `${person.startAlter} Jahre am 01.01.${model.summary.year} · Rente: ${money(person.renteMonatlich)} monatlich · ${person.monateImJahr} Bezugsmonate · ${money(person.renteImJahr)} im Planungsjahr.`));
        }
        if (results.showProtocol) {
            showProtocol(annual, results);
            annual.append(node('p', `Jahr: ${session.annualSnapshotId || 'siehe Sicherungsverwaltung'} · Monat: ${monthReceipt?.monthSnapshotId || 'noch offen'}`));
        }
        let body;
        if (monthReceipt) {
            current.root.dataset.annualMonthResult = 'confirmed';
            const data = projectConfirmedMonthResult(model, session.request.cash);
            body = createCloseResult({ doc: doc(), ...data, planYear: model.summary.year, actionSection: action, yearSection: annual });
            body.dataset.annualCombinedResult = 'C';
            body.append(node('h3', 'Wiederherstellungspunkte'), node('p', 'Wiederherstellungspunkte für Jahr und Monat angelegt.'));
            current.setTitle(`${data.month} und Jahr ${results.targetYear} abgeschlossen`);
            current.setSubtitle(`${session.request.cash.people.map(person => person.name).join(' + ')} · gespeichert am ${model.now.toLocaleDateString('de-DE')}`);
            current.setStatus(''); closeButton.hidden = true; confirmButton.textContent = 'Fertig';
        } else {
            body = node('section'); body.className = 'close-dialog-result';
            const error = node('h3', monthFailureText(results, model));
            error.setAttribute('role', 'status'); body.append(error, action, annual);
            if (results.monthError) body.append(node('p', results.monthError));
            body.append(node('p', 'Erneut versuchen speichert nur den Monat. Der Jahresabschluss bleibt erhalten.'));
            current.setStatus(session.phase === 'recovery' ? 'Wiederherstellung erforderlich. Bitte den Monatswiederherstellungspunkt in der Sicherungsverwaltung prüfen.' : '');
            confirmButton.textContent = 'Erneut versuchen';
        }
        current.setResult(body);
        current.setFootnote('Jahr und Monat haben getrennte Wiederherstellungspunkte. Der Monatsbetrag stammt aus dem bestätigten Plan. Die Anzeige bestätigt keine ausgeführte Überweisung.');
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
        accepted = true;
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
                if (result.ath) row.append(node('p', `Allzeithoch: ${money(result.ath.new)} · Jahre seit Allzeithoch: ${result.ath.yearsSince}`));
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
                try { const options = results.validatePrice(handPrice.value); retryPending = true; current.setBusy(true); await results.retry(options); }
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
                    current.setBusy(true);
                    try {
                        if (!await results.retryMonth()) throw new Error('Monatsabschluss nicht bestätigt.');
                        delete results.monthError;
                    } catch (error) { results.monthError = error.message; }
                    finally { current.setBusy(false); showUpdateResultModal(results); }
                });
                body.append(retryMonth);
            }
        }
        current.setMessage(''); current.setResult(body); current.setStatus(results.confirmed ? 'Jahr gespeichert · Monatsbetrag noch nicht bereitgestellt' : results.recovery?.message || ''); current.setBusy(false);
    };
    return { showAnnualPreparation, showUpdateResultModal,
        reportError: (error, action) => {
            if (dialogState?.handle.root.open && dialogState.handle.root.isConnected) {
                onClearError(); dialogState.report(error, action);
            } else onError(error, action);
        },
        clearError: () => { onClearError(); handle?.setMessage(''); },
        finishPreflight: () => { if (!dialogState) return false; dialogState.finishPreflight(); return true; },
        setProgress: text => handle?.setStatus(text),
        abortContinuation: () => handle?.close(false),
        showAnnualContinuation: ({ targetYear, opener } = {}) => {
            const current = handle || open({ title: `Jahr ${targetYear} abschließen`, opener });
            if (current) { current.setStatus('Der Jahresabschluss wird fortgesetzt …'); current.setBusy(true); }
        },
        showPlanningStart: options => showUpdateResultModal({ ...options, kind: 'planning_start' }),
        handleShowUpdateLog: (showProtocol = true) => { const last = getLastUpdateResults(); if (last) showUpdateResultModal({ ...last, showProtocol }); else onNotice('Noch kein Jahres-Update durchgeführt.'); },
        closeAnnualModal: () => { if (!handle) return true; if (handle.busy || isCommitActive() || retryPending) return false; void handle.requestClose(); return true; }
    };
}
