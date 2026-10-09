const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8'),copy=o=>JSON.parse(JSON.stringify(o));
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name)}
function harness(){
 const props=new Map(),sheets=new Map(),writes=[];let uuid=0;
 const addSheet=name=>{
  const data=[];
  const range=(r,c,n=1,w=1)=>{
   if(n<1||w<1)throw Error('Invalid empty range');
   const out={getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>data[r+i-1]?.[c+j-1]??'')),getValue:()=>data[r-1]?.[c-1]??'',setValues:values=>{
    assert.equal(values.length,n);values.forEach((row,i)=>{assert.equal(row.length,w);if(!data[r+i-1])data[r+i-1]=[];row.forEach((v,j)=>data[r+i-1][c+j-1]=v)});writes.push(name);return out;
   },setFontWeight:()=>out,setBackground:()=>out,setFontColor:()=>out};return out;
  };
  const sh={data,getLastRow:()=>data.length,getRange:range,setFrozenRows(){},autoResizeColumns(){},appendRow:row=>{data.push([...row]);writes.push(name)}};sheets.set(name,sh);return sh;
 };
 const book={getId:()=> 'new-ag-sheet',getUrl:()=> 'https://docs.google.com/spreadsheets/d/new-ag-sheet/edit',getSheetByName:n=>sheets.get(n),insertSheet:addSheet};
 const now=Date.parse('2030-01-07T12:00:00Z');class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const ctx=vm.createContext({console:{log(){}},Date:TestDate,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},SpreadsheetApp:{getActiveSpreadsheet:()=>book,openById:id=>{assert.equal(id,'new-ag-sheet');return book}},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Session:{getScriptTimeZone:()=> 'America/Los_Angeles'},Utilities:{getUuid:()=> 'ag-id-'+(++uuid),formatDate:(d,tz,fmt)=>fmt==='yyyy-MM-dd'?'2030-01-07':fmt==='HH:mm'?d.toISOString().slice(11,16):d.toISOString(),parseDate:s=>new TestDate(s.replace(' ','T')+':00Z')},HtmlService:{createTemplateFromFile:name=>({name,getRawContent:()=>read('apps-script/'+name+'.html'),evaluate(){return {name:this.name,config:JSON.parse(this.bootstrapJSON),appUrl:JSON.parse(this.appUrlJSON),setTitle(title){this.title=title;return this}}}})},ScriptApp:{getService:()=>({getUrl:()=> 'https://script.google.com/macros/s/new-ag-deployment/exec'})}});
 for(const f of ['DepartmentConfig.gs','Catalog.gs','PricingCatalog.gs','Code.gs','AutomaticPricing.gs','Hub.gs','AgSetup.gs','Reservations.gs'])vm.runInContext(read('apps-script/'+f),ctx,{filename:f});
 return {ctx,props,sheets,book,addSheet,writes};
}
check('A new Sheet gets all seven Ag locations, catalog suggestions and empty ownership/prices',()=>{
 const h=harness(),r=h.ctx.initializeAgDepartment();
 assert.deepEqual(copy(r.locations),['214','215','Prep Area','Shop','Floristry','Shed','Farm']);assert.equal(r.catalogSuggestions,187);assert.equal(r.ownedEntries,0);
 for(const name of ['Items','PriceEstimates','PriceCatalog','PriceJobs','Loans','Issues','Faculty','Meetings','Reservations'])assert.equal(h.sheets.get(name).data.length,1,name);
 assert.equal(h.props.get('DEPARTMENT_KEY'),'EAHS_AG');
 const state=h.ctx.getData();assert.equal(state.pricing.configured,false);assert.equal(state.items.length,0);assert.equal(state.prices.length,0);
 const hub=h.ctx.getHubData();assert.equal(hub.recordsUrl,h.book.getUrl());assert.equal(hub.templateUrl,'');
});
check('Setup rejects existing records and an already connected non-Ag project before writes',()=>{
 const a=harness();a.addSheet('Items').data.push(['id'],['science-existing']);assert.throws(()=>a.ctx.initializeAgDepartment(),/already contains/);assert.equal(a.writes.length,0);assert.equal(a.props.size,0);
 const b=harness();b.props.set('INVENTORY_SHEET_ID','another-department');assert.throws(()=>b.ctx.initializeAgDepartment(),/NEW bound/);assert.equal(b.writes.length,0);
 assert.throws(()=>b.ctx.getData(),/NEW Agriculture/);
});
check('Repeating Ag setup preserves stock, prices, locations and staff hub records',()=>{
 const h=harness();h.ctx.initializeAgDepartment();h.ctx.saveItem({name:'Livestock feed — lamb grower, 50 lb bag',category:'Feed & supplements',kind:'Consumable',quantity:2,unit:'bag',location:'Farm',minStock:3,actor:'Verifier',unitPrice:25});
 h.sheets.get('Faculty').appendRow(['faculty-1','Verifier']);
 const before=copy([...h.sheets].map(([name,sheet])=>[name,sheet.data]));h.ctx.initializeAgDepartment();assert.deepEqual(copy([...h.sheets].map(([name,sheet])=>[name,sheet.data])),before);
 assert.match(h.ctx.getData().items[0].sku,/^EAHS-AG-\d{6}$/);assert.equal(h.ctx.getData().prices[0].averageUnitCost,25);
});
check('Templates use this deployment and Ag configuration for inventory, hub and reservations',()=>{
 const h=harness();h.ctx.initializeAgDepartment();
 for(const [page,file] of [['','Index'],['hub','HubIndex'],['reservations','Reservations']]){const output=h.ctx.doGet({parameter:{page}});assert.equal(output.name,file);assert.equal(output.appUrl,'https://script.google.com/macros/s/new-ag-deployment/exec');assert.equal(output.config.locations.length,7)}
});
check('All Ag category families are available and catalog rows contain no stock or prices',()=>{
 const h=harness();h.ctx.initializeAgDepartment();const cfg=copy(h.ctx.agPublicConfig_()),rows=h.ctx.getData().catalog;
 assert.equal(cfg.categories.length,51);for(const c of cfg.categories.filter(x=>x!=='Other'))assert(rows.some(x=>x.category===c),c);
 for(const row of rows){assert.equal(Object.keys(row).length,6);assert(!('quantity' in row));assert(!('averageUnitCost' in row))}
});
check('The Ag reservation server blocks overlaps, allows other locations and suppresses repeat saves',()=>{
 const h=harness();h.ctx.initializeAgDepartment();const p={requestId:'ag-request-00001',date:'2030-01-08',location:'Shop',start:'09:00',end:'10:00',teacherName:'Verifier',teacherEmail:'verifier@salinasuhsd.org',course:'Agricultural Mechanics',activity:'Layout practice',needsPrep:false,notes:''};
 const first=h.ctx.saveAgReservation(p);assert.equal(h.ctx.saveAgReservation(p).id,first.id);assert.equal(h.sheets.get('Reservations').data.length,2);
 assert.throws(()=>h.ctx.saveAgReservation({...p,requestId:'ag-request-00002',start:'09:30',end:'10:30'}),/booked/);
 h.ctx.saveAgReservation({...p,requestId:'ag-request-00003',location:'Farm'});h.ctx.saveAgReservation({...p,requestId:'ag-request-00004',start:'10:00',end:'11:00'});
 assert.equal(h.ctx.getAgReservations({start:'2030-01-08',end:'2030-01-09',location:'Shop'}).reservations.length,2);
 assert.equal(h.ctx.getAgReservations({start:'2030-01-08',end:'2030-01-09',location:'Farm'}).reservations.length,1);
 assert.throws(()=>h.ctx.saveAgReservation({...p,activity:'Changed'}),/different details/);
});
check('Reservation validation rejects wrong locations, dates, times, emails and closed days',()=>{
 const h=harness();h.ctx.initializeAgDepartment();const p={requestId:'ag-request-10001',date:'2030-01-08',location:'Floristry',start:'09:00',end:'10:00',teacherName:'Verifier',teacherEmail:'verifier@salinasuhsd.org',course:'Floral Design',activity:'Arrangement',needsPrep:false,notes:''};
 for(const fields of [{location:'409'},{date:'2030-02-31'},{date:'2030-02-08'},{start:'25:00'},{start:'11:00'},{teacherEmail:'x@other.org'},{requestId:''}])assert.throws(()=>h.ctx.saveAgReservation({...p,...fields}));
 vm.runInContext("AG_CONFIG.closedDates.push('2030-01-08')",h.ctx);assert.throws(()=>h.ctx.saveAgReservation(p),/closed/);assert.equal(h.sheets.get('Reservations').data.length,1);
});
check('Bookings preserve formula-like names and notes as literal strings',()=>{
 const h=harness();h.ctx.initializeAgDepartment();h.ctx.saveAgReservation({requestId:'ag-request-20001',date:'2030-01-08',location:'214',start:'09:00',end:'10:00',teacherName:'=USER()',teacherEmail:'verifier@salinasuhsd.org',course:'Agriscience',activity:'=SUM(1,2)',needsPrep:false,notes:'=IMPORTXML("bad")'});
 const values=h.sheets.get('Reservations').data[1];assert.equal(values[6],"'=USER()");assert.equal(values[9],"'=SUM(1,2)");assert.equal(values[11],"'=IMPORTXML(\"bad\")");
});
check('Shipped runnable files contain no Science deployment, Sheet, calendar or repository IDs',()=>{
 const forbidden=['AKfycbx5wsf3Np','AKfycbx-a_9BGR','1wdj8ZT4GrZ3JfSa_SGzT1uOQO5_FAtmkFHXKi0Xbb2k','1lzZHQteSyQgVgdMJbZYtrQ5hgfT6A-gUQA8Na3SYyPs','15l2u3t7tO4QFzQF2bzaYjgaXC1mTS0F2EDEQ4EqpRVU','1tLP3B20Z_Nrh3aevV580Pu30caXR3APe','EAHS-Science/','calendar.google.com/calendar/u/0?cid='];
 for(const folder of ['apps-script','docs'])for(const f of fs.readdirSync(path.join(__dirname,folder)))if(fs.statSync(path.join(__dirname,folder,f)).isFile()){const s=read(folder+'/'+f);for(const value of forbidden)assert(!s.includes(value),f+' contains '+value)}
});
check('GitHub entry pages stay unconnected until configured and route only to the new deployment',()=>{
 const run=raw=>{const anchors=['hub','inventory','reservations'].map(page=>({dataset:{openPage:page},hidden:true})),status={textContent:''},target=[];const ctx={window:{EAHS_SITE_CONFIG:{inventoryAppUrl:raw}},document:{body:{dataset:{page:'hub'}},querySelector:()=>status,querySelectorAll:()=>anchors},location:{search:'?tab=meetings',replace:s=>target.push(s)},URL,URLSearchParams};vm.runInNewContext(read('docs/launch.js'),ctx);return {anchors,target,status}};
 assert.equal(run('').target.length,0);assert.equal(run('https://evil.example/exec').target.length,0);
 const connected=run('https://script.google.com/macros/s/new-ag/exec');assert.equal(connected.target[0],'https://script.google.com/macros/s/new-ag/exec?page=hub&tab=meetings');assert(connected.anchors.every(x=>!x.hidden));
});
console.log(passed+' Agriculture checks passed.');
