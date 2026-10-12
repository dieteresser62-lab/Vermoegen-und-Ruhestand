import { registeredPlanTrial } from '../shared/plan-trial.js';
import { readBalancePersonStatus, showPersonDataStatus, projectParticipatingPerson } from '../shared/person-data-status.js';
/**
 * Module: Balance Main Profile Sync
 * Purpose: Synchronizes profile-specific derived inputs (like "Rente Aktiv" or "Alter") from LocalStorage to the main UI.
 *          Ensures that even in single-user mode, the inputs reflect the underlying profile data.
 * Usage: Used by balance-main.js to keep UI inputs in sync with profile storage.
 * Dependencies: balance-reader.js, balance-utils.js, profilverbund-balance.js
 */
"use strict";

import { UIReader } from './balance-reader.js';
import { UIUtils } from './balance-utils.js';
import { loadProfilverbundProfiles, buildProfilverbundAssetSummary } from '../profile/profilverbund-balance.js';
import { readProfileOverridesFromStorage, parseProfileOverridesFromData } from '../profile/profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { setFieldState } from '../shared/field-state.js';

// Explizite Herkunft; weder Sperren noch verborgene Renten-/Depotinputs auswerten.
export function renderProfileInputOrigins(dom, aggregated) {
    const source = aggregated ? 'Aus Haushaltsprofilen übernommen' : 'Aus dem Profil übernommen';
    const reasons = {
        fixedIncomeAnnual: `${source}; jährliche Summe. Pflege im Profilmanager (Rente und sonstige Einkünfte).`,
        tagesgeld: `${source}; Pflege im Profil-Assets Manager.`,
        geldmarktEtf: `${source}; Pflege im Depot-Tranchen-Manager.`,
        depotwertGesamt: `${source}; Summe der Depot-Tranchen. Pflege im Depot-Tranchen-Manager.`,
        goldWert: `${source}; Pflege im Profil-Assets Manager bzw. Depot-Tranchen-Manager.`,
        costBasisAlt: `${source}; Einstand aus Tranchen. Pflege im Depot-Tranchen-Manager.`,
        costBasisNeu: `${source}; Einstand aus Tranchen. Pflege im Depot-Tranchen-Manager.`,
        goldCost: `${source}; Einstand aus Tranchen. Pflege im Depot-Tranchen-Manager.`
    };
    for (const [key, reason] of Object.entries(reasons)) {
        const field = dom?.inputs?.[key];
        if (field) setFieldState(field, 'adopted', reason);
    }
    // Nur bereits synchronisierte Brücken lesen, keine weiteren Profilabfragen.
    const doc = dom?.inputs?.fixedIncomeAnnual?.ownerDocument;
    if (!doc) return;
    const amount = key => {
        const raw = dom?.inputs?.[key]?.value;
        return raw === undefined || String(raw).trim() === '' ? null : UIUtils.parseCurrency(raw);
    };
    const currency = value => Number.isFinite(value) ? UIUtils.formatBalanceCurrency(value) : '—';
    const cash = amount('tagesgeld'), moneyMarket = amount('geldmarktEtf');
    const values = {
        income: currency(amount('fixedIncomeAnnual')) + ' / Jahr',
        cash: currency(Number.isFinite(cash) && Number.isFinite(moneyMarket) ? cash + moneyMarket : null),
        depot: currency(amount('depotwertGesamt')),
        'gold-bonds': `${currency(amount('goldWert'))} · ${currency(amount('initialBondBucket'))}`
    };
    for (const [key, value] of Object.entries(values)) {
        const target = doc.getElementById(`balanceAdopt-${key}-value`);
        if (target) target.textContent = value;
    }
    for (const key of ['income', 'cash', 'depot', 'gold-bonds', 'costs']) {
        const row = doc.getElementById(`balanceAdopt-${key}`);
        const target = doc.getElementById(`balanceAdopt-${key}-source`);
        if (!row || !target) continue;
        row.setAttribute('data-field-state', 'adopted');
        row.setAttribute('aria-describedby', target.id);
        const origin = key === 'income' ? 'Aus Profile & Rente' : key === 'costs' || key === 'depot' ? 'Aus den Tranchen im Vermögen' : 'Aus Vermögen';
        target.textContent = `${origin} · ${aggregated ? 'Haushaltsprofile' : 'aktives Profil'}${key === 'costs' ? ' · für die Steuerschätzung' : ''}`;
    }
    const needSource = doc.getElementById('balanceNeedSource');
    if (needSource) needSource.textContent = `${aggregated ? 'Haushalt · Summe der ausgewählten Profile' : 'Aktives Profil'} · Euro pro Jahr`;
}

export function createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }) {
    const renderProfileRecoveryBlocker = (error) => {
        if (typeof window !== 'undefined') {
            window.__profilverbundTranchenOverride = null;
        }
        const container = dom?.containers?.error;
        if (container) {
            container.className = 'error-warn ds-note ds-note-error';
            container.textContent = `Profil-Recovery erforderlich: ${error?.message || 'Profildaten konnten nicht sicher geladen werden.'}`;
        }
        return false;
    };

    const syncProfileDerivedInputs = () => {
        const status = readBalancePersonStatus();
        if (status.status === 'corrupt') return renderProfileRecoveryBlocker(status.error);
        if (!status.ready) { showPersonDataStatus(status); return false; }
        if (status.status === 'demo') return true;
        const selectedData = status.entries?.find(entry => entry.profileId === status.calculationProfileId)?.data;
        const overrides = selectedData ? parseProfileOverridesFromData(selectedData) : readProfileOverridesFromStorage(persistenceStorage);
        let person;
        try { person = projectParticipatingPerson(status, persistenceStorage.getItem('rs_current_profile')); } catch (error) { return renderProfileRecoveryBlocker(error); }
        const alterRaw = String(person.startAlter);

        let profilverbundProfiles;
        try {
            profilverbundProfiles = loadProfilverbundProfiles();
        } catch (error) {
            return renderProfileRecoveryBlocker(error);
        }
        if (profilverbundProfiles.length > 0) {
            const assetSummary = buildProfilverbundAssetSummary(profilverbundProfiles);
            const tagesgeld = assetSummary.totalTagesgeld;
            const renteMonatlich = assetSummary.totalRenteMonatlich;

            if (dom.inputs.tagesgeld && Number.isFinite(tagesgeld)) {
                dom.inputs.tagesgeld.value = Math.round(tagesgeld).toLocaleString('de-DE');
            }
            if (dom.inputs.renteAktiv) {
                dom.inputs.renteAktiv.value = renteMonatlich > 0 ? 'ja' : 'nein';
            }
            if (dom.inputs.renteMonatlich && Number.isFinite(renteMonatlich)) {
                dom.inputs.renteMonatlich.value = Math.round(renteMonatlich).toLocaleString('de-DE');
            }
            if (dom.inputs.fixedIncomeAnnual && Number.isFinite(renteMonatlich)) {
                dom.inputs.fixedIncomeAnnual.value = Math.round(renteMonatlich * 12).toLocaleString('de-DE');
            }
            if (dom.inputs.aktuellesAlter && alterRaw !== null) {
                const alter = UIUtils.parseCurrency(alterRaw);
                if (Number.isFinite(alter)) {
                    dom.inputs.aktuellesAlter.value = String(Math.round(alter));
                }
            }

            if (dom.inputs.geldmarktEtf && Number.isFinite(assetSummary.totalGeldmarkt)) {
                dom.inputs.geldmarktEtf.value = Math.round(assetSummary.totalGeldmarkt).toLocaleString('de-DE');
            }
            if (dom.inputs.depotwertAlt && Number.isFinite(assetSummary.totalDepotAlt)) {
                dom.inputs.depotwertAlt.value = Math.round(assetSummary.totalDepotAlt).toLocaleString('de-DE');
            }
            if (dom.inputs.depotwertNeu && Number.isFinite(assetSummary.totalDepotNeu)) {
                dom.inputs.depotwertNeu.value = Math.round(assetSummary.totalDepotNeu).toLocaleString('de-DE');
            }
            if (dom.inputs.depotwertGesamt) {
                const totalDepot = (assetSummary.totalDepotAlt || 0) + (assetSummary.totalDepotNeu || 0);
                dom.inputs.depotwertGesamt.value = Math.round(totalDepot).toLocaleString('de-DE');
            }
            if (dom.inputs.costBasisAlt && Number.isFinite(assetSummary.totalCostAlt)) {
                dom.inputs.costBasisAlt.value = Math.round(assetSummary.totalCostAlt).toLocaleString('de-DE');
            }
            if (dom.inputs.costBasisNeu && Number.isFinite(assetSummary.totalCostNeu)) {
                dom.inputs.costBasisNeu.value = Math.round(assetSummary.totalCostNeu).toLocaleString('de-DE');
            }
            if (dom.inputs.goldWert && Number.isFinite(assetSummary.totalGold)) {
                dom.inputs.goldWert.value = Math.round(assetSummary.totalGold).toLocaleString('de-DE');
            }
            if (dom.inputs.goldCost && Number.isFinite(assetSummary.totalGoldCost)) {
                dom.inputs.goldCost.value = Math.round(assetSummary.totalGoldCost).toLocaleString('de-DE');
            }

            if (typeof window !== 'undefined') {
                window.__profilverbundTranchenOverride = assetSummary.mergedTranches;
            }
        } else {
            if (dom.inputs.tagesgeld && Number.isFinite(overrides.profileTagesgeld)) {
                const tagesgeld = overrides.profileTagesgeld;
                if (Number.isFinite(tagesgeld)) {
                    dom.inputs.tagesgeld.value = Math.round(tagesgeld).toLocaleString('de-DE');
                }
            }
            const renteMonatlich = person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12;
            const sonstigeEinkuenfte = person.sonstigeEinkuenfte;
            const renteSumme = (Number.isFinite(renteMonatlich) ? renteMonatlich : 0)
                + (Number.isFinite(sonstigeEinkuenfte) ? sonstigeEinkuenfte : 0);

            if (dom.inputs.renteAktiv) dom.inputs.renteAktiv.value = renteSumme > 0 ? 'ja' : 'nein';

            if (dom.inputs.renteMonatlich && Number.isFinite(renteSumme)) {
                dom.inputs.renteMonatlich.value = Math.round(renteSumme).toLocaleString('de-DE');
            }
            if (dom.inputs.fixedIncomeAnnual && Number.isFinite(renteSumme)) {
                dom.inputs.fixedIncomeAnnual.value = Math.round(renteSumme * 12).toLocaleString('de-DE');
            }
            if (dom.inputs.aktuellesAlter && alterRaw !== null) {
                const alter = UIUtils.parseCurrency(alterRaw);
                if (Number.isFinite(alter)) {
                    dom.inputs.aktuellesAlter.value = String(Math.round(alter));
                }
            }
            if (dom.inputs.depotwertGesamt) {
                const depotAlt = dom.inputs.depotwertAlt ? UIUtils.parseCurrency(dom.inputs.depotwertAlt.value) : 0;
                const depotNeu = dom.inputs.depotwertNeu ? UIUtils.parseCurrency(dom.inputs.depotwertNeu.value) : 0;
                if (Number.isFinite(depotAlt) || Number.isFinite(depotNeu)) {
                    const totalDepot = (Number.isFinite(depotAlt) ? depotAlt : 0) + (Number.isFinite(depotNeu) ? depotNeu : 0);
                    dom.inputs.depotwertGesamt.value = Math.round(totalDepot).toLocaleString('de-DE');
                }
            }
            if (typeof window !== 'undefined') {
                window.__profilverbundTranchenOverride = null;
            }
        }

        if (dom.inputs.goldAktiv && typeof overrides.profileGoldAktiv === 'boolean') {
            dom.inputs.goldAktiv.checked = overrides.profileGoldAktiv;
        }
        if (dom.inputs.goldZielProzent && Number.isFinite(overrides.profileGoldZiel)) {
            const ziel = overrides.profileGoldZiel;
            if (Number.isFinite(ziel)) dom.inputs.goldZielProzent.value = ziel;
        }
        if (dom.inputs.goldFloorProzent && Number.isFinite(overrides.profileGoldFloor)) {
            const floor = overrides.profileGoldFloor;
            if (Number.isFinite(floor)) dom.inputs.goldFloorProzent.value = floor;
        }
        if (dom.inputs.goldSteuerfrei && typeof overrides.profileGoldSteuerfrei === 'boolean') {
            dom.inputs.goldSteuerfrei.checked = overrides.profileGoldSteuerfrei;
        }
        if (!registeredPlanTrial(globalThis.document)?.read().active && dom.inputs.rebalancingBand && Number.isFinite(overrides.profileGoldRebalBand)) {
            const band = overrides.profileGoldRebalBand;
            if (Number.isFinite(band)) dom.inputs.rebalancingBand.value = band;
        }

        if (dom.inputs.kirchensteuerSatz) { dom.inputs.kirchensteuerSatz.value = String(person.kirchensteuerSatz); dom.inputs.kirchensteuerSatz.disabled = true; }
        const spb = profilverbundProfiles.length > 0
            ? profilverbundProfiles.reduce((sum, profile) => sum + profile.inputs.sparerPauschbetrag, 0) : person.startSPB;
        if (typeof window !== 'undefined') window.__profilverbundPersonSPB = spb;
        if (dom.inputs.sparerPauschbetrag) { dom.inputs.sparerPauschbetrag.value = UIUtils.formatNumber(spb); dom.inputs.sparerPauschbetrag.disabled = true; dom.inputs.sparerPauschbetrag.readOnly = true;
            dom.inputs.sparerPauschbetrag.dataset.noPersist = 'true';
            const source = dom.inputs.sparerPauschbetrag.ownerDocument?.getElementById('balancePersonSPBSource');
            if (source) source.textContent = profilverbundProfiles.length > 0
                ? 'Aus Haushaltsprofilen · Summe der persönlichen Sparer-Pauschbeträge.' : 'Aus dem aktiven Profil · Personen & Vermögen.'; }

        if (UIReader.applySideEffectsFromInputs) {
            UIReader.applySideEffectsFromInputs();
        }
        renderProfileInputOrigins(dom, profilverbundProfiles.length > 0);
        return true;
    };

    return { syncProfileDerivedInputs };
}
