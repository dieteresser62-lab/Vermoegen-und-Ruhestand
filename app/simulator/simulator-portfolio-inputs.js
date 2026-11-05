/** @import {SimulatorInputs} from '../../typcheck/rechenkern.js' */
/** @import {PensionFields, SimulatorControl} from '../../typcheck/simulator-ui.js' */
import { PARTNERSHIP_KEY, readPartnership, hasTestament, testamentRule, hasInheritanceHomes } from '../profile/household-partnership.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { simulatorPlannedExpenses } from '../profile/household-planned-expenses.js';
import { withPlannedExpensePrices } from '../balance/balance-inflation-source.js';
import { personReferenceYear } from '../profile/profile-person-data.js';
import { readDocumentPlannedInflows } from './planned-inflows-ui.js';
import { readSimulatorTrialInputs, bindPlanTrialContext, getSimulatorPlanTrial } from './simulator-plan-trial.js';
import { readSimulatorHouseholdPlan } from '../profile/household-plan.js';
import { readDocumentPersonInputs, bindPersonDataContext } from './simulator-person-overrides.js';
/**
 * Module: Simulator Portfolio Inputs
 * Purpose: Collecting input values from the UI.
 *          Handles complex parsing of form fields, care config, and partner details.
 * Usage: Called by simulator-portfolio.js facade.
 * Dependencies: simulator-input-*.js
 */
"use strict";

import { readCareInputs } from './simulator-input-care.js';
import { readPartnerInputs, readPensionInputs, readWidowOptions } from './simulator-input-pension.js';
import {
    readAccumulationInputs,
    readBasePortfolioInputs,
    readDecumulationInputs,
    readDynamicFlexInputs,
    readStrategyInputs
} from './simulator-input-strategy.js';
import { readTrancheInputs } from './simulator-input-tranches.js';
import { normalizeTailRiskConfig } from './tail-risk-contract.js';

function readDomValue(id, fallback = '') {
    const el = typeof document !== 'undefined' ? /** @type {SimulatorControl} */ (document.getElementById(id)) : null;
    return el?.value ?? fallback;
}

function readDomChecked(id, fallback = false) {
    const el = typeof document !== 'undefined' ? /** @type {SimulatorControl} */ (document.getElementById(id)) : null;
    return typeof el?.checked === 'boolean' ? el.checked : fallback;
}

function readTailRiskInputs() {
    const tailRiskEnabled = readDomChecked('tailRiskEnabled', false);
    if (!tailRiskEnabled) {
        return normalizeTailRiskConfig({ tailRiskEnabled: false });
    }

    return normalizeTailRiskConfig({
        tailRiskEnabled,
        tailRiskAnnualProbabilityPct: readDomValue('tailRiskAnnualProbabilityPct', ''),
        tailRiskReturnShockPct: readDomValue('tailRiskReturnShockPct', ''),
        tailRiskInflationShockPct: readDomValue('tailRiskInflationShockPct', ''),
        tailRiskDurationYears: readDomValue('tailRiskDurationYears', ''),
        tailRiskCooldownYears: readDomValue('tailRiskCooldownYears', '')
    });
}

/**
 * Sammelt alle Eingabewerte aus dem UI
 *
 * @returns Ergebnis der Operation.
 */
export function getCommonInputs() {
    const win = typeof window !== 'undefined' ? window : null;
    const trancheInputs = readTrancheInputs();
    const baseInputs = readBasePortfolioInputs();
    const pensionInputs = /** @type {PensionFields} */ (readPensionInputs());
    if (pensionInputs.personDataStatus && !pensionInputs.personDataStatus.ready) {
        /** @type {Error & {personDataStatus?: unknown}} */
        const error = new Error(pensionInputs.personDataStatus.message);
        error.name = 'SimulatorValidationError'; error.personDataStatus = pensionInputs.personDataStatus;
        throw error;
    }
    const partnerInputs = readPartnerInputs();
    const widowInputs = readWidowOptions();
    const careInputs = readCareInputs({ gender: pensionInputs.geschlecht });
    const dynamicFlexInputs = readDynamicFlexInputs();
    const decumulationInputs = readDecumulationInputs();
    const strategyInputs = readStrategyInputs();
    const accumulationInputs = readAccumulationInputs({ startAlter: pensionInputs.startAlter });
    const tailRiskInputs = readTailRiskInputs();

    // Personendaten wurden oben auf Bereitschaft geprüft; die Reader liefern diesen Vertragszweig.
    const result = /** @type {SimulatorInputs} */ ({
        ...baseInputs,
        ...dynamicFlexInputs,
        ...pensionInputs,
        ...careInputs,
        ...decumulationInputs,
        ...partnerInputs,
        ...widowInputs,
        ...strategyInputs,
        ...accumulationInputs,
        ...tailRiskInputs,
        tailRiskHorizonYears: Number.parseInt(readDomValue('mcDauer', ''), 10),
        ...trancheInputs
    });

    if (typeof window !== 'undefined' && window.__profilverbundMinFlexProfilesOverride) {
        result.minimumFlexProfiles = window.__profilverbundMinFlexProfilesOverride;
    }

    if (Array.isArray(win?.__profilverbundMinimumFlexProfiles)) {
        result.minimumFlexProfiles = win.__profilverbundMinimumFlexProfiles.map(entry => ({ ...entry }));
    }

    const plan = readSimulatorHouseholdPlan();
    if (plan.status !== 'valid' && getSimulatorPlanTrial(document).read().confirmed) throw new Error('Haushalt & Plan ist nicht mehr verfügbar. Bitte neu laden.');
    if (plan.status === 'valid') {
        const trial = readSimulatorTrialInputs(document);
        Object.assign(result, trial.inputs);
        bindPlanTrialContext(result, trial.context);
        delete result.minimumFlexProfiles;
    }

    const personInputs = readDocumentPersonInputs();
    if (personInputs) {
        bindPersonDataContext(result, personInputs.context);
        const rawPartnership = persistenceStorage.getItem(PARTNERSHIP_KEY);
        const partnership = readPartnership(rawPartnership);
        if (rawPartnership && personInputs.combined.simulationPeople.length === 2) result.partnership = partnership;
        if (personInputs.combined.home?.length) {
            result.home = personInputs.combined.home.map(entry => ({ ...entry }));
            result.homeReferenceYear = personInputs.context.referenceYear;
        }
        result.simulationPeople = personInputs.combined.simulationPeople.map(person => ({ ...person }));
        if (result.simulationPeople.some(person => hasTestament(partnership, person.profileId,
            hasInheritanceHomes(result.home, person.profileId)) && testamentRule(partnership, person.profileId).home === 'residence')) {
            result.residenceReferenceYear = personInputs.context.referenceYear;
            for (const person of result.simulationPeople) {
                const birth = personInputs.entries.find(entry => entry.profileId === person.profileId)?.data.profile_geburtsdatum;
                if (birth) person.geburtsdatum = birth;
            }
        }
        if (personInputs.combined.careToday?.grade) result.careToday = { ...personInputs.combined.careToday };
        if (result.partner && personInputs.combined.partner?.careToday?.grade) result.partner.careToday = { ...personInputs.combined.partner.careToday };
        if (personInputs.combined.fixedIncome?.length) {
            result.fixedIncome = personInputs.combined.fixedIncome.map(entry => ({ ...entry }));
            result.fixedIncomeReferenceYear = personInputs.combined.fixedIncomeReferenceYear;
        }
    }
    Object.assign(result, readDocumentPlannedInflows(personInputs?.context.referenceYear));
    Object.assign(result, simulatorPlannedExpenses({ scope: plan.scope }, personInputs?.context.referenceYear ?? personReferenceYear(null)));
    if (result.plannedExpenses?.length) result.plannedExpenses = withPlannedExpensePrices(result.plannedExpenses,
        { scope: plan.scope, referenceYear: result.plannedExpensesReferenceYear });
    return result;
}
