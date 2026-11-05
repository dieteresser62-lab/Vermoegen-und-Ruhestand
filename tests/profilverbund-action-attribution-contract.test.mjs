import * as facade from '../app/profile/profilverbund-action-attribution.js';
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution/attribution.js';
import { calculateActionLiquidityDelta, reconcileHouseholdLiquidityKpis, reconcileAttributedThreeBucketState }
    from '../app/profile/profilverbund-action-attribution/liquidity.js';
import { previewTermsScope, previewHouseholdTax } from '../app/profile/profilverbund-action-attribution/tax.js';

assert(facade.attributeHouseholdAction === attributeHouseholdAction, 'Fassade erhält die Attributionsbindung');
assert(facade.calculateActionLiquidityDelta === calculateActionLiquidityDelta, 'Fassade erhält die Liquiditätsbindung');
assert(facade.reconcileHouseholdLiquidityKpis === reconcileHouseholdLiquidityKpis, 'Fassade erhält die Kennzahlbindung');
assert(facade.reconcileAttributedThreeBucketState === reconcileAttributedThreeBucketState, 'Fassade erhält die Diagnosebindung');

const action = { type: 'NONE', quellen: [], verwendungen: {} };
const profiles = [{ profileId: 'a', inputs: {} }, { profileId: 'b', inputs: {} }];
const failure = new Error('synthetic attribution failure');
assert(previewTermsScope === null, 'Außerhalb einer Attribution ist kein Vorschaucache aktiv');
let outerScope;
const result = attributeHouseholdAction({
    get householdAction() {
        outerScope = previewTermsScope;
        assert(outerScope instanceof Map, 'Der öffentliche Aufruf aktiviert den gemeinsamen Vorschaucache');
        previewHouseholdTax(profiles, new Map());
        assert(outerScope.has(profiles[0]), 'Steuervorschau und Aufrufhülle verwenden denselben Cache');
        const cached = outerScope.get(profiles[0]);
        attributeHouseholdAction({
            get householdAction() {
                assert(previewTermsScope instanceof Map && previewTermsScope !== outerScope,
                    'Verschachtelter Aufruf erhält einen eigenen Vorschaucache');
                assertEqual(previewTermsScope.size, 0, 'Verschachtelter Aufruf beginnt ohne äußere Steuerwerte');
                return action;
            }, profiles
        });
        assert(previewTermsScope === outerScope, 'Erfolgreicher innerer Aufruf stellt den äußeren Cache wieder her');
        try {
            attributeHouseholdAction({
                get householdAction() {
                    assert(previewTermsScope !== outerScope, 'Auch ein scheiternder innerer Aufruf isoliert seinen Cache');
                    throw failure;
                }, profiles
            });
            assert(false, 'Der innere Fehler muss weitergegeben werden');
        } catch (error) {
            assert(error === failure, 'Der ursprüngliche Fehler bleibt erhalten');
        }
        assert(previewTermsScope === outerScope, 'Innerer Fehler stellt den äußeren Cache wieder her');
        assert(outerScope.get(profiles[0]) === cached, 'Verschachtelung erhält bereits ermittelte äußere Steuerwerte');
        return action;
    }, profiles
});
assertEqual(result.finalAction.nettoErlös, 0, 'Der äußere Aufruf wird nach Verschachtelung abgeschlossen');
assert(previewTermsScope === null, 'Erfolg gibt den Vorschaucache wieder frei');

try {
    attributeHouseholdAction({
        get householdAction() {
            assert(previewTermsScope !== outerScope && previewTermsScope.size === 0,
                'Ein Folgeaufruf übernimmt keine vorherigen Cachewerte');
            throw failure;
        }, profiles
    });
    assert(false, 'Der äußere Fehler muss weitergegeben werden');
} catch (error) {
    assert(error === failure, 'Auch der äußere Fehler bleibt erhalten');
}
assert(previewTermsScope === null, 'Fehler gibt den Vorschaucache wieder frei');
