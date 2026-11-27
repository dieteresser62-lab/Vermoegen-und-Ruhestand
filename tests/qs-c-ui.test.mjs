import { parityResidualClass } from './extended/parity-residuals.mjs';
import { readFileSync } from 'node:fs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectWealthCaptures } from '../app/profile/profile-wealth-captures.js';
import { WEALTH_CAPTURES_KEY } from '../types/wealth-capture-contract.js';
import { historyDayRows, historyTooltipPosition } from '../app/tranches/tranchen-history-svg.js';
import { renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { testamentFields } from '../app/tranches/tranchen-manager-testament.js';
import { loadProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
const date='2026-10-23';
// VS-2: Beispielhaushalte legen keine erfassten Stände mehr an; der Leseweg nimmt fehlende Erfassungen ohne Konflikt an.
for(const id of ['martin-petra','max-erika']){
 const records=createMusterHaushaltRecords(date,id), registry=JSON.parse(records.rs_profiles_v1);
 assertEqual(Object.hasOwn(records,WEALTH_CAPTURES_KEY),false,`VS-2: ${id} ohne erfasste Stände`);
 const projected=projectWealthCaptures(registry,records[WEALTH_CAPTURES_KEY]??null);
 assertEqual(projected.conflicts.length,0,`QS-C V: ${id} ohne widersprüchliche Haushaltsstände`);
 assertEqual(projected.wealthHistory.entries.length,0,`VS-2: ${id} ohne Haushaltsstände aus Beispielerfassungen`);
}
const types=['aktien_alt','aktien_neu','anleihe','gold','geldmarkt','cash'];
const point={date,day:1,total:210,totalWithHomes:360,allocation:{aktien_alt:10,aktien_neu:20,anleihe:30,gold:40,geldmarkt:50,cash:60},property:{self:100,rented:50},quality:['carried']};
const rows=historyDayRows(point,{types,hasHomes:true});
assert(rows[1].text.startsWith('Gesamtvermögen:')&&rows[1].kind==='total'&&rows[2].text.startsWith('davon Geldvermögen'),'QS-C V: Gesamtvermögen ist erste und hervorgehobene Zahl');
assertEqual(rows.slice(3).map(r=>r.text.split(':')[0]).join('|'),'Aktien|Anleihen|Gold|Geldmarkt|Tagesgeld|Immobilien selbst genutzt|Immobilien vermietet','QS-C V: feste Reihenfolge, Aktien zusammengefasst');
assert(!rows.some(r=>r.text.includes('fortgeführt')||/Eigentum|Quote/.test(r.text)),'QS-C V: keine Eigentumsquote und kein Wochenendhinweis');
// OP-1 (Punkt 1): Der Anteil am Gesamtvermögen steht neben jedem Betrag der Aufteilung, nicht bei den Summenzeilen.
assertEqual(rows.slice(3).map(r=>r.text.split(' · ')[1]).join('|'),'8,3\u00a0%|8,3\u00a0%|11,1\u00a0%|13,9\u00a0%|16,7\u00a0%|27,8\u00a0%|13,9\u00a0%','OP-1 Punkt 1: Anteile am Gesamtvermögen im Maus-Hinweis');
assert(!rows.slice(0,3).some(r=>r.text.includes('%')),'OP-1 Punkt 1: Datum und Summenzeilen ohne Anteil');
assert(historyDayRows({...point,quality:['open-gap']},{types,hasHomes:true}).at(-1).text==='Kurs noch nicht bestätigt','QS-C V: verständlicher Hinweis nur für ungeprüften Kurs');
for(const [width,height] of [[1920,1080],[2560,1440]])for(const anchor of [{x:10,y:10},{x:width-10,y:height-10}]){
 const box={width:340,height:240},p=historyTooltipPosition(anchor,box,width,height);
 assert(p.x>=0&&p.y>=0&&p.x+box.width<=width&&p.y+box.height<=height,'QS-C V: Tooltip klappt an Fensterrändern vollständig um');
}
for(const property of [{self:100,rented:0},{self:0,rented:50},{self:100,rented:50}]){
 const texts=historyDayRows({...point,property},{types,hasHomes:true}).map(r=>r.text).join('|');
 assertEqual(texts.includes('Immobilien selbst genutzt'),property.self>0,'QS-C V: nur vorhandene Selbstnutzung');
 assertEqual(texts.includes('Immobilien vermietet'),property.rented>0,'QS-C V: nur vorhandene Vermietung');
}
try{
 setAppTestDate(date);
 const records=createMusterHaushaltRecords(date,'martin-petra','testament');
 const partnership=JSON.parse(records[PARTNERSHIP_KEY]);
 partnership.testament.muster_martin.residenceTax='annual';
 P.resetPersistenceForTests({async loadAll(){return {...records,[PARTNERSHIP_KEY]:JSON.stringify(partnership)}},async saveBatch(){}});
 await P.init({installLifecycleHooks:false,installTauriCloseHook:false});
 const registry=JSON.parse(records.rs_profiles_v1);
 const profiles=Object.entries(registry.profiles).map(([id,p])=>{
  const tranches=JSON.parse(p.data.depot_tranchen),values=loadProfileAssetValues({getItem:k=>p.data[k]??null});
  return {id,name:p.meta.name,belongs:true,valid:true,values,tranches,assets:Number(p.data.profile_tagesgeld)+tranches.reduce((s,t)=>s+t.shares*t.currentPrice,0)};
 });
 const render=()=>{
  const nodes=Object.fromEntries(['managerPartnership','managerInheritance','managerPartnershipMarried','managerPartnershipSummary','managerPartnershipStatus'].map(id=>[id,{innerHTML:'',querySelectorAll:()=>[]}]));
  renderManagerPartnership({getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],addEventListener(){}},{profiles});if(nodes.managerPartnershipStatus.textContent) throw new Error(nodes.managerPartnershipStatus.textContent);return nodes.managerInheritance.innerHTML;
 };
 const html=render();
 assert(!html.includes('Freibetrag 0')&&!html.includes('zum Vergleich sofort'),'QS-C V: kein Null-Freibetrag und keine doppelte Sofortzeile');
 assert(html.includes('im Todesjahr')&&html.includes('bei Wahl ‚sofort‘:'),'QS-C V: jährliche Steuer verständlich beschriftet');
 assert(html.includes('§ 23 ErbStG). Steuersatz 30 %'),'QS-C V: Satzgrenze vor dem Steuersatz');
 // HP-4: Sofortvergleich auf den auf volle 100 € abgerundeten Erwerb; vorher 150.185 €.
 assert(html.includes('Kapitalwert Wohnrecht 320.616')&&html.includes('150.180'),'QS-C W: Faktor-Alter 62 ergibt Kapitalwert 320616 und Sofortvergleich 150180');
 profiles[1].values.careToday={grade:2,form:'residential'};
 const care=render();assert(!care.includes('Kapitalwert Wohnrecht 0'),'QS-C V: kein Kapitalwert bei Heimpflege im Todesjahr');
 const absent=testamentFields('a',0,{}),present=testamentFields('a',0,{minimum:1000,minimumStand:'2026-10'});
 assert(/class="pv-inheritance-share" hidden><label for="inheritance-stand/.test(absent),'QS-C V: Kaufkraftzeile ohne Mindestbetrag verborgen');
 assert(!/class="pv-inheritance-share" hidden><label for="inheritance-stand/.test(present),'QS-C V: Kaufkraftzeile mit Mindestbetrag sichtbar');
 const css=readFileSync(new URL('../css/personen-vermoegen.css',import.meta.url),'utf8');
 assert(/\.pv-inheritance-share\[hidden\]\s*\{\s*display:\s*none/.test(css),'QS-C V: hidden bleibt trotz Flexregel wirksam');
 assert(readFileSync(new URL('../css/components.css',import.meta.url),'utf8').includes('.ds-unit-frame:has(:disabled)'),'QS-C V: zentraler gesperrter Rahmen berücksichtigt auch Fieldset');
}finally{P.resetPersistenceRuntimeForTests();setAppTestDate(null);}

assertEqual(parityResidualClass({ id: 'transaction.personalPayoutOrder', status: 'PHASE_NICHT_VERGLEICHBAR',
    reason: 'tax_source_order_after_price_roundtrip' })?.id, 'QUELLREIHENFOLGE_STEUERGLEICH',
    'QS-C: nachgewiesener Quellenwechsel erklärt auch die folgende persönliche Cashauszahlung');
assertEqual(parityResidualClass({ id: 'transaction.personalPayoutOrder', status: 'TECHNISCHER_FEHLER',
    reason: 'tax_source_order_after_price_roundtrip' }), undefined, 'QS-C: echte Auszahlungsfehler bleiben Fehler');
