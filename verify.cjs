const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname,read=f=>fs.readFileSync(path.join(root,f),'utf8');let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name)}
const inv='apps-script/';
// Parse every executable source and shell script, including unchanged current files.
check('All current Apps Script and website JavaScript parses',()=>{
 for(const f of fs.readdirSync(path.join(root,inv))){const s=read(inv+f);
  if(f.endsWith('.gs')||['InventoryClient.html','HubClient.html','ReservationClient.html'].includes(f))new vm.Script(s,{filename:f});
  else for(const m of s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1].replace(/<\?[=!]?[\s\S]*?\?>/g, '"template-value"'),{filename:f});
 }
 for(const f of ['launch.js','site-config.js'])new vm.Script(read('docs/'+f),{filename:f});
});
let uuid=0,db={},writes=[];
const backend=vm.createContext({console,Utilities:{getUuid:()=>`test-${++uuid}`,formatDate:()=> '2026-10-07'},Session:{getScriptTimeZone:()=> 'America/Los_Angeles'}});
vm.runInContext(read(inv+'DepartmentConfig.gs')+'\n'+read(inv+'Code.gs')+'\n'+read(inv+'AutomaticPricing.gs'),backend);
const headers=vm.runInContext('TABLES',backend);
const clone=o=>JSON.parse(JSON.stringify(o));
const sheet=name=>({getLastRow:()=>1+(db[name]||[]).length,getRange:(r,c,n,width)=>({getValues:()=>Array.from({length:n},(_,i)=>headers[name].slice(c-1,c-1+width).map(k=>(db[name][r+i-2]||{})[k]??'')),setValues:values=>values.forEach((vals,i)=>{const row=db[name][r+i-2]||(db[name][r+i-2]={});headers[name].slice(c-1,c-1+width).forEach((k,j)=>row[k]=vals[j]);writes.push(name)})}),appendRow:vals=>{db[name].push(Object.fromEntries(headers[name].map((k,i)=>[k,vals[i]])));writes.push(name)}});
backend.sheet_=sheet;backend.locked_=fn=>fn();backend.ensureReadReady_=()=>{};
function reset(items=[]){db=Object.fromEntries(Object.keys(headers).map(k=>[k,[]]));db.Items=clone(items);db.Locations=[{location:214},{location:215}];writes=[];vm.runInContext('globalThis.catalogMatchRows_=null',backend)}
const item={id:'skeleton',name:'Articulated skeleton',sku:'EAHS-000001',category:'Models & specimens',kind:'Reusable',quantity:2,checkedOut:0,unit:'each',location:214,storage:'Cabinet',minStock:1,manufacturer:'',catalogNumber:'',needsRepair:0,needsReplacement:2};
check('Room numbers stored as numbers work for add, checkout, and fresh responses',()=>{
 reset();const data=backend.saveItem({name:'Test beaker',kind:'Reusable',quantity:3,unit:'each',location:'215',minStock:1,actor:'Verifier'});
 assert.equal(data.items[0].location,'215');assert.equal(data.locations[0],'214');
 const checked=backend.checkout({itemId:data.items[0].id,quantity:1,borrower:'Verifier',destination:'214'});
 assert.equal(checked.loans[0].destination,'214');assert.equal(checked.items[0].checkedOut,1);
 assert.throws(()=>backend.saveItem({name:'Other',kind:'Reusable',quantity:1,unit:'each',location:'999',minStock:0}),/listed/);
});
check('Recording existing flags preserves all item cells and enables partial resolution',()=>{
 reset([item]);const before=clone(db.Items);
 backend.recordExistingIssue({itemId:item.id,type:'Replacement',quantity:2,reportedBy:'Verifier',details:'Damaged joints'});
 assert.deepEqual(db.Items,before);assert.equal(db.Issues.length,1);assert.equal(db.Activity.length,1);
 assert(!writes.includes('Items'));assert.equal(db.Issues[0].remaining,2);
 backend.resolveIssue({issueId:db.Issues[0].id,quantity:1,resolvedBy:'Verifier',resolution:'Back in service'});
 assert.equal(db.Items[0].quantity,2);assert.equal(db.Items[0].needsReplacement,1);assert.equal(db.Issues[0].remaining,1);
});
check('Duplicate requests, stale flags, and invalid quantities cannot change counts',()=>{
 reset([item]);backend.recordExistingIssue({itemId:item.id,type:'Replacement',quantity:2,reportedBy:'Verifier',details:'Damage'});
 assert.throws(()=>backend.recordExistingIssue({itemId:item.id,type:'Replacement',quantity:2,reportedBy:'Verifier',details:'Duplicate'}),/already/);
 assert.equal(db.Issues.length,1);db.Items[0].needsReplacement=0;const before=clone(db);
 assert.throws(()=>backend.resolveIssue({issueId:db.Issues[0].id,quantity:1,resolvedBy:'Verifier',resolution:'Removed from inventory'}),/flag count/);
 assert.deepEqual(db,before);
 assert.throws(()=>backend.recordExistingIssue({itemId:item.id,type:'Repair',quantity:0,reportedBy:'Verifier',details:'Damage'}),/positive/);
});
check('Request details remain literal Sheet strings',()=>{
 reset([item]);backend.recordExistingIssue({itemId:item.id,type:'Replacement',quantity:1,reportedBy:'=USER()',details:'=IMPORTXML("bad")'});
 assert.equal(db.Issues[0].reportedBy,"'=USER()");assert.equal(db.Issues[0].details,'\'=IMPORTXML("bad")');
});
check('Valid staff quotes win over duplicate planning/invalid prices',()=>{
 reset([item]);db.PriceEstimates=[{id:'bad',...item,averageUnitCost:0,matchType:'Exact model'},{id:'planning',...item,averageUnitCost:10,matchType:'Planning estimate'},{id:'staff',...item,averageUnitCost:1110,matchType:'Entered price'}];const before=clone(db.PriceEstimates);
 backend.ensureAutomaticPrice_(item,{});assert.deepEqual(db.PriceEstimates,before);assert.equal(db.PriceJobs.length,0);
});
check('Invalid non-planning price queues research; box units require review',()=>{
 reset([item]);db.PriceEstimates=[{...item,id:'bad',averageUnitCost:0,matchType:'Exact model'}];backend.ensureAutomaticPrice_(item,{});
 assert.equal(db.PriceJobs[0].status,'Queued');assert.equal(db.PriceEstimates[0].averageUnitCost,0);
 reset([{...item,unit:'box'}]);backend.ensureAutomaticPrice_({...item,unit:'box'},{});assert.equal(db.PriceJobs[0].status,'Needs review');
 assert.equal(backend.automaticPricingStatus_().enabled,null);
});
// Render helpers execute against a small DOM stub; no live account or Sheet is used.
const node=()=>({innerHTML:'',textContent:'',value:'',open:false,disabled:false,append(){},addEventListener(){},querySelector(){return node()}});
const nodes=new Map(),doc={hidden:false,querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},addEventListener(){},createElement:node};
const ui=vm.createContext({console,document:doc,window:{},localStorage:{getItem:()=>null,setItem(){}},setInterval(){},setTimeout(){},clearTimeout(){},Intl,URL,Blob});
vm.runInContext(read(inv+'InventoryClient.html').replace(/loadInventory\(\);\s*$/,''),ui);
const fixture={items:[item,{...item,id:'specimen',name:'Specimen',kind:'Consumable',quantity:3,needsReplacement:0},{...item,id:'planning',name:'Planning model',quantity:0,needsReplacement:0},{...item,id:'missing',name:'No quote',quantity:0,needsReplacement:0}],loans:[],issues:[],activity:[],locations:['214'],catalog:[],prices:[{...item,averageUnitCost:1110,matchType:'Comparable item'},{name:'Specimen',kind:'Consumable',unit:'each',averageUnitCost:7,matchType:'Exact model'},{name:'Planning model',kind:'Reusable',unit:'each',averageUnitCost:12,matchType:'Planning estimate'}],priceCatalog:[],priceJobs:[]};
ui.fixture=fixture;vm.runInContext('state=normalizeData(fixture)',ui);
check('Dashboard shows direct Sheet flags with no Issues rows',()=>{
 const html=vm.runInContext('overview()',ui);assert.match(html,/<strong>2<\/strong>/);assert.match(html,/2 to replace/);assert.match(html,/Already flagged; no request recorded/);assert.match(vm.runInContext('issuesView()',ui),/Flagged units without requests/);
});
check('Totals explain consumable difference and include zero-stock price gaps',()=>{
 const m=vm.runInContext('costMetrics()',ui);assert.equal(m.equipment,2220);assert.equal(m.inventory,2241);assert.equal(m.consumables,21);assert.equal(m.replacement,2220);assert.equal(m.planning,1);assert.equal(m.missing,1);
 const html=vm.runInContext('costCards()',ui);assert.match(html,/\$21\.00 in consumables/);assert.match(html,/1 planning estimates/);assert.match(html,/1 missing/);
});
check('Numeric rooms remain normalized after a mutation and zero inputs stay visible',()=>{
 assert.equal(vm.runInContext("field('Count','quantity',0,'number')",ui).includes('value="0"'),true);
 assert.equal(vm.runInContext('state.items[0].location',ui),'214');assert.equal(vm.runInContext('state.locations[0]',ui),'214');
});
check('Shared price selection respects staff quotes over older planning duplicates',()=>{
 ui.duplicates=[{...item,averageUnitCost:0,matchType:'Exact model'},{...item,averageUnitCost:10,matchType:'Planning estimate'},{...item,averageUnitCost:1110,matchType:'Entered price'}];
 assert.equal(vm.runInContext('state.prices=duplicates;unitCost(state.items[0])',ui),1110);
});
check('At-limit versus below-limit and checkout-safe shopping quantities still work',()=>{
 const it={...item,needsReplacement:0,quantity:3,minStock:3};ui.limitItem=it;
 assert.equal(vm.runInContext('reorderStatus(limitItem)',ui),'At limit');it.checkedOut=1;assert.equal(vm.runInContext('reorderStatus(limitItem)',ui),'Below limit');
 vm.runInContext('state.items=[limitItem]',ui);assert.equal(vm.runInContext('shoppingListRows()[0].toBuy',ui),0);
 it.needsReplacement=1;assert.equal(vm.runInContext('shoppingListRows()[0].toBuy',ui),1);
});
// Model concurrent availability requests using promises, executing the actual frontend.
async function calendarChecks(){
 const elements=new Map(),calendarDoc={querySelector:s=>{if(!elements.has(s))elements.set(s,node());return elements.get(s)},createElement:node,body:{append(){}}};
 const cal=vm.createContext({console,document:calendarDoc,window:{EAHS_AG_CONFIG:JSON.parse(read('department-defaults.json')),google:{script:{run:{}}}},google:{script:{run:{}}},setTimeout,clearTimeout,URL,FormData});
 vm.runInContext(read('apps-script/ReservationClient.html').replace(/loadWeek\(\);\s*$/,''),cal);
 const requests=[];cal.reservationRpc=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
 const a=vm.runInContext('loadWeek()',cal);assert.equal(vm.runInContext('availabilityReady',cal),false);
 const b=vm.runInContext('weekStart=addDays(weekStart,7);loadWeek()',cal);
 requests[1].resolve({ok:true,reservations:[{date:'2030-01-01',start:'09:00',end:'10:00',id:'new'}]});assert.equal(await b,true);
 requests[0].resolve({ok:true,reservations:[{date:'2030-01-01',start:'09:00',end:'10:00',id:'stale'}]});assert.equal(await a,null);assert.equal(vm.runInContext('reservations[0].id',cal),'new');
 passed++;console.log('PASS Older calendar responses cannot overwrite a newer week');
 const c=vm.runInContext('loadWeek()',cal);requests[2].reject(new Error('Network failure'));assert.equal(await c,false);assert.equal(vm.runInContext('availabilityReady',cal),false);assert.match(elements.get('#status').textContent,/Booking is disabled/);
 const d=vm.runInContext('loadWeek()',cal);requests[3].resolve({ok:true});assert.equal(await d,false);assert.equal(vm.runInContext('availabilityReady',cal),false);
 passed++;console.log('PASS Failed or incomplete calendar responses keep booking disabled');
 console.log(`${passed} checks passed.`);
}
calendarChecks().catch(e=>{console.error(e);process.exitCode=1});
