import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { inheritanceTax, inheritancePreview, inheritancePercent, readPartnership } from '../app/profile/household-partnership.js';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const married = { status: 'married' };
for (const [amount, tax] of [[0,0],[500000,0],[575000,5250],[800000,33000],[1100000,90000],
    [6500000,1140000],[13500000,2990000],[26500000,7020000],[30500000,9000000]]) {
    assertClose(inheritanceTax(amount, married), tax, 1e-8, `Klasse I: Erwerb ${amount}`);
}
for (const [limit, previousRate] of [[75000,.07],[300000,.11],[600000,.15],[6000000,.19],[13000000,.23],[26000000,.27]]) {
    assertClose(inheritanceTax(500000+limit+100,married),limit*previousRate+50,.001,`Klasse I: Härteausgleich nach ${limit}`);
}
assertEqual(inheritanceTax(20000),0,'Klasse III: Freibetrag');
assertEqual(inheritanceTax(6020000),1800000,'Klasse III: Grenze 6 Mio.');
assertEqual(inheritanceTax(6020100),1800075,'Klasse III: 75 Prozent des Grenzüberhangs');
assertEqual(inheritanceTax(7020000),2550000,'Klasse III: 7 Mio. steuerpflichtig mit Härteausgleich');
assertEqual(inheritanceTax(12020000),6000000,'Klasse III: nach dem Härtebereich 50 Prozent auf den ganzen Erwerb');
for (const percent of [50,100]) {
    const preview = inheritancePreview(2000000,800000,percent,{status:'married',exemptHome:800000});
    assertEqual(preview.tax,percent===50?75000:285000,`Familienheim steuerfrei, Quote ${percent}`);
    assertEqual(inheritancePreview(2000000,800000,percent,married).tax,percent===50?171000:437000,`Vermietete Immobilie steuerpflichtig, Quote ${percent}`);
}
const record=readPartnership({schemaVersion:1,status:'married',inheritance:{max:25},marriedInheritance:{max:50}});
assertEqual(inheritancePercent(record,'max'),50,'Ehe hat eigene Erbquote');
assertEqual(inheritancePercent({...record,status:'unmarried'},'max'),25,'Unverheiratete Quote bleibt erhalten');
assertEqual(inheritancePercent(readPartnership(null),'max'),100,'Altbestand verheiratet 100 Prozent');
assertEqual(inheritancePercent({status:'unmarried'},'max'),0,'Altbestand unverheiratet 0 Prozent');
for (const value of [-1,101,null,'50']) {
    let rejected=false;try{readPartnership({...record,marriedInheritance:{max:value}});}catch{rejected=true;}
    assert(rejected,'Ungültige Ehequote wird auch beim Import abgewiesen');
}
const year={jahr:2000,inflation:0,rendite:0,gold_eur_perf:0,zinssatz:0};
const household={p1Alive:false,p2Alive:true,widowBenefits:{p2FromP1:true,p2FromP1Percent:.55}};
{
    const inputs={...structuredClone(fixture),survivorFloorPercent:70,survivorFlexPercent:75,survivorMinimumFlexPercent:75,partnership:{status:'married',inheritance:{},marriedInheritance:{muster_a:100,muster_b:100}}};
    const result=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,household,1,EngineAPI);
    const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    assertEqual(result.logData.erbschaftsteuer,0,'100 Prozent ohne Steuerwirkung unter dem Freibetrag');
    assertEqual(hash(result.newState), readQSCReferences(readVF2BReferences(readQSCReferences('6bf1b28ab8371cbc8f4f5ab8d958bb686a5017b8bf3d85ac7bebc51d0c2c0f7c'))),'100 Prozent ohne Steuer: vollständiger Rechenzustand bytegleich zur Basis vor EP-1');
    assertEqual(hash(result.ui), readQSCReferences(readVF2BReferences('093f980590ca0d9737abd26d46fa4e2d8bfa3047784c4cf16c8600930fd15acd')),'100 Prozent ohne Steuer: vollständiger Jahresbeschluss bytegleich zur Basis');
}
for(const percent of [0,50,100]) {
    const inputs={...structuredClone(fixture),survivorFloorPercent:70,survivorFlexPercent:75,survivorMinimumFlexPercent:75,partnership:{schemaVersion:1,status:'married',inheritance:{},marriedInheritance:{muster_a:percent}}};
    inputs.home=[{profileId:'muster_a',wert:800000,nutzung:'selbst',stand:'2026-10'},
        {profileId:'muster_a',wert:200000,nutzung:'vermietet',stand:'2026-10'}];
    inputs.homeReferenceYear=2026;
    const state=initMcRunState(inputs);
    const result=simulateOneYear(state,inputs,year,0,null,0,household,1,EngineAPI);
    assertEqual(result.kind,'success',`Ehequote ${percent}: Todesjahr berechenbar`);
    const log=result.logData,estate=log.inheritance;
    assertClose(estate.leaves,estate.assets*(1-percent/100),.001,'Abgang nur aus dem persönlichen Nachlass');
    assertEqual(log.erbschaftsteuer,inheritancePreview(estate.assets,1000000,percent,{status:'married',exemptHome:800000}).tax,'Vorschau = Simulator einschließlich Immobilien');
    assertClose(log.portfolio_flow_delta,0,.05,'Abgang und Steuer vollständig bilanziert');
    assert(log.liqEnd<=log.portfolio_total_end,'Liquidität nach Steuer höchstens Gesamtvermögen');
    assertEqual(log.liqEnd,result.newState.portfolio.liquiditaet,'Jahresendliquidität nach Nachlass');
    assertEqual(JSON.stringify(log.personAccounts),JSON.stringify(result.newState.portfolio.personAccounts),'Protokoll zeigt endgültige Personenkonten');
    const next=simulateOneYear(result.newState,inputs,year,1,null,0,household,1,EngineAPI);
    assertEqual(next.logData.liqStart,log.liqEnd,'Lückenloser Übergang ins Folgejahr');
    assert(result.newState.widowPensionP2>0,'Ehe behält Hinterbliebenenrente');
    const html=renderProtocolTable([log],{source:'mc',inputs,logDetailLevel:'normal'});
    assert(html.includes('data-protocol-column="inheritance-outflow"')&&html.includes('data-protocol-column="inheritance-tax"'),'Normales Protokoll zeigt Erben und Steuer');
    assert(!html.includes('keine Witwenrente'),'Eheprotokoll erklärt die Hinterbliebenenrente richtig');
}
{
    const inputs={...structuredClone(fixture),survivorFloorPercent:70,survivorFlexPercent:75,survivorMinimumFlexPercent:75,partnership:{status:'married',inheritance:{},marriedInheritance:{muster_a:100}},
        home:[{profileId:'muster_a',wert:1000000,nutzung:'vermietet',stand:'2026-10'}],homeReferenceYear:2026,tagesgeld:0,geldmarktEtf:0};
    inputs.simulationPeople.forEach(person=>person.tagesgeld=0);
    inputs.detailledTranches=inputs.detailledTranches.filter(lot=>lot.category!=='money_market');
    const result=simulateOneYear(initMcRunState(inputs),inputs,year,0,null,0,household,1,EngineAPI);
    assertEqual(result.kind,'success','Ehe: Steuerverkauf bei fehlendem Tagesgeld möglich');
    assert(result.logData.erbschaftsteuer>0&&result.logData.vk.vkGes>0,'Ehe: tatsächlicher Verkauf bezahlt die Erbschaftsteuer');
    const html=renderProtocolTable([result.logData],{source:'mc',inputs});
    assert(html.includes('Verkauf'),'Normal zeigt den Verkauf im Todesjahr');
    assert(result.logData.liqEnd<=result.logData.portfolio_total_end,'Auch mit Steuerverkauf endgültige Jahresendliquidität');
}

const measurement=JSON.parse(readFileSync(new URL('./fixtures/ep-1-inheritance-measurement.json',import.meta.url)));
const proof=measurement.compatibility;
assertEqual(proof.before['max-erika'].computation,proof.marriedTaxForcedToZero['max-erika'].computation,'Erzwungene Nullsteuer: MC-Rechenfelder bytegleich zur Basis');
assertEqual(proof.beforeProtocolCorrection['max-erika'].withoutProtocol,proof.after['max-erika'].withoutProtocol,'Reine Protokollkorrektur: alle übrigen MC-Felder bytegleich');
assertEqual(measurement.comparisons.unmarried0.unchangedPathsExceptLiqEnd,2000,'Unverheiratet 0: alle 2000 Pfade unverändert außer liqEnd');
assertEqual(measurement.comparisons.unmarried100.changedPathsExceptLiqEnd,63,'Unverheiratet 100: nur die 63 Pfade über 6 Mio. betroffen');
