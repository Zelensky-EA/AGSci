const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'apps-script/Barcode.gs'),'utf8');
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name)}
const code='08717648200274',other='00884838001380';
const response=(status,body={},headers={})=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(body),getAllHeaders:()=>headers});
function harness(routes=()=>response(404)){
 const cache=new Map(),props=new Map(),userProps=new Map(),calls=[],ttls=[],locks=[];
 const context=vm.createContext({console,CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v,ttl)=>{cache.set(k,v);ttls.push({k,ttl})}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)}),getUserProperties:()=>({getProperty:k=>userProps.get(k)||null,setProperty:(k,v)=>userProps.set(k,v),deleteProperty:k=>userProps.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock:()=>locks.push('release')}),getUserLock:()=>({waitLock(){},releaseLock(){}})},UrlFetchApp:{fetch:(url,opts)=>{calls.push({url,opts});return routes(url,opts)},fetchAll:requests=>requests.map(req=>{calls.push({url:req.url,opts:req,batch:true});return routes(req.url,req)})},getData:()=>({items:[]}),saveItem(){throw Error('Lookup must not save')},receiveStock(){throw Error('Lookup must not add stock')}});
 vm.runInContext(source,context);return {context,cache,props,calls,ttls,locks};
}
const off=(type='food',id=code)=>({product:{code:id,product_type:type,product_name:'Salt',brands:'Example',quantity:'750 g',ingredients_text:'Salt'}});
const gudid=(id=code)=>({gudid:{device:{identifiers:{identifier:[{deviceId:id,deviceIdIssuingAgency:'GS1',pkgType:'Box',pkgQuantity:100}]},brandName:'Example',deviceDescription:'Nitrile examination gloves, medium',companyName:'Manufacturer',catalogNumber:'GLOVE-M',singleUse:true,deviceCommDistributionStatus:'In Commercial Distribution'}}});
check('A saved barcode skips every external database and never saves during lookup',()=>{
 const h=harness();h.props.set('EAHS_AG_PRODUCT_BARCODE_'+code,JSON.stringify([{itemId:'glove',unit:'box',unitsPerPack:1}]));h.context.getData=()=>({items:[{id:'glove',name:'Gloves',unit:'box'}]});
 const r=h.context.lookupInventoryBarcode(code);assert.equal(r.lookupStatus,'inventory');assert.equal(r.matches[0].unitsPerPack,1);assert.equal(h.calls.length,0);
});
check('UPC exact matches preserve size/color, suggest consumable, and stop fallbacks',()=>{
 const h=harness(url=>url.includes('upcitemdb')?response(200,{code:'OK',items:[{ean:code,title:'Nitrile gloves box 100 count',brand:'Example',size:'Medium',color:'Blue'}]}):response(404));
 const r=h.context.lookupInventoryBarcode(code);assert.equal(r.products.length,1);assert.equal(r.products[0].kind,'Consumable');assert.equal(r.products[0].unit,'box');assert.equal(r.products[0].unitsPerPack,1);assert.match(r.products[0].name,/Medium.*Blue/);assert.equal(h.calls.length,1);
});
check('UPC mismatches are rejected; food and medical lookups run in one batch',()=>{
 const h=harness(url=>url.includes('upcitemdb')?response(200,{code:'OK',items:[{ean:other,title:'Wrong product'}]}):url.includes('openfoodfacts')?response(200,off()):response(404));
 const r=h.context.lookupInventoryBarcode(code);assert.equal(r.products.length,1);assert.match(r.products[0].lookupProvider,/Open Food Facts/);assert.equal(h.calls.filter(x=>x.batch).length,2);assert.equal(r.products[0].unitsPerPack,1);assert.match(r.products[0].name,/750 g/);assert.equal(r.products[0].kind,'Consumable');
 assert(h.calls.every(c=>c.opts.followRedirects===false&&c.opts.method==='get'));assert(h.calls.every(c=>!/[?&](key|api_key|token)=/.test(c.url)));
});
check('All four Open Facts databases route with explicit attribution',()=>{
 for(const [type,host,label] of [['food','food','Food'],['beauty','beauty','Beauty'],['petfood','petfood','Pet Food'],['product','products','Products']]){
  const h=harness(url=>url.includes('upcitemdb')||url.includes('accessgudid')?response(404):url.includes('openfoodfacts')&&type!=='food'?response(302,{}, {Location:`https://world.open${host}facts.org/api/v3/product/${code}`}):response(200,off(type)));
  const r=h.context.lookupInventoryBarcode(code);assert.equal(r.products.length,1);assert.match(r.products[0].lookupProvider,new RegExp('Open '+label+' Facts'));assert.match(r.products[0].sourceUrl,new RegExp('open'+host+'facts'));
 }
});
check('Cross-domain or arbitrary-path redirects are rejected without fetching them',()=>{
 for(const target of ['https://evil.example/api/v3/product/'+code,'http://world.openbeautyfacts.org/api/v3/product/'+code,'https://world.openbeautyfacts.org/private']){
  const h=harness(url=>url.includes('openfoodfacts')?response(302,{}, {location:target}):response(404));const r=h.context.lookupInventoryBarcode(code);assert.equal(r.products.length,0);assert.equal(r.lookupStatus,'partial_unavailable');assert(!h.calls.some(c=>c.url===target));
 }
});
check('FDA/NLM medical supplies match exact identifiers and preserve packaging hierarchy',()=>{
 const h=harness(url=>url.includes('accessgudid')?response(200,gudid()):response(404));const r=h.context.lookupInventoryBarcode(code),p=r.products[0];
 assert.equal(p.lookupProvider,'FDA/NLM AccessGUDID');assert.equal(p.kind,'Consumable');assert.equal(p.catalogNumber,'GLOVE-M');assert.equal(p.manufacturer,'Manufacturer');assert.equal(p.unitsPerPack,1);assert.match(p.description,/100.*hierarchy/);assert.match(p.description,/Distribution status/);
});
check('Mismatched FDA identifiers and non-GS1 identifiers cannot become suggestions',()=>{
 const h=harness();assert.equal(h.context.eahsGUDIDProduct_(gudid(other),code).length,0);const data=gudid();data.gudid.device.identifiers.identifier[0].deviceIdIssuingAgency='HIBCC';assert.equal(h.context.eahsGUDIDProduct_(data,code).length,0);
});
check('Different exact source records stay separate for explicit selection',()=>{
 const h=harness(url=>url.includes('openfoodfacts')?response(200,off('product')):url.includes('accessgudid')?response(200,gudid()):response(404));const r=h.context.lookupInventoryBarcode(code);assert.equal(r.products.length,2);assert.notEqual(r.products[0].lookupProvider,r.products[1].lookupProvider);
});
check('Provider rate limits do not stop another provider from finding the item',()=>{
 const h=harness(url=>url.includes('accessgudid')?response(200,gudid()):response(429));const r=h.context.lookupInventoryBarcode(code);assert.equal(r.products.length,1);assert(Number(h.props.get('EAHS_AG_PROVIDER_AFTER_OPEN_FACTS'))>Date.now()+50000);
});
check('Malformed JSON from one service does not discard the other exact match',()=>{
 const bad={...response(200),getContentText:()=>'{bad'};const h=harness(url=>url.includes('openfoodfacts')?bad:url.includes('accessgudid')?response(200,gudid()):response(404));assert.equal(h.context.lookupInventoryBarcode(code).products[0].lookupProvider,'FDA/NLM AccessGUDID');
});
check('Batch transport failure retries providers independently',()=>{
 const h=harness(url=>url.includes('openfoodfacts')?response(200,off()):response(404));h.context.UrlFetchApp.fetchAll=()=>{throw Error('One host unreachable')};assert.equal(h.context.lookupInventoryBarcode(code).products.length,1);
});
check('Success cache prevents repeat external calls for unknown but found products',()=>{
 const h=harness(url=>url.includes('openfoodfacts')?response(200,off()):response(404));h.context.lookupInventoryBarcode(code);const before=h.calls.length;h.context.lookupInventoryBarcode(code);assert.equal(h.calls.length,before);assert(h.ttls.some(x=>x.k.startsWith('EAHS_AG_MULTI')&&x.ttl===21600));
});
check('Misses are cached briefly; incomplete lookups expire sooner and explain retry',()=>{
 const h=harness();let r=h.context.lookupInventoryBarcode(code);assert.equal(r.lookupStatus,'not_found');assert(h.ttls.some(x=>x.k.startsWith('EAHS_AG_MULTI')&&x.ttl===300));
 const bad=harness(()=>response(500));r=bad.context.lookupInventoryBarcode(code);assert.equal(r.lookupStatus,'partial_unavailable');assert.match(r.message,/temporarily unavailable/);assert(bad.ttls.some(x=>x.k.startsWith('EAHS_AG_MULTI')&&x.ttl===30));
});
check('Provider pacing reserves calls without sleeping; cached results bypass pacing',()=>{
 const h=harness();h.props.set('EAHS_AG_PROVIDER_AFTER_OPEN_FACTS',String(Date.now()+60000));h.props.set('EAHS_AG_PROVIDER_AFTER_GUDID',String(Date.now()+60000));h.context.lookupInventoryBarcode(code);assert.equal(h.calls.length,1);assert(!/Utilities\.sleep/.test(source));
});
check('UPC and EAN representations match while malformed codes never make requests',()=>{
 const h=harness(url=>url.includes('openfoodfacts')?response(200,{product:{code:'03017620422003',product_name:'Food',product_type:'food'}}):response(404));assert.equal(h.context.lookupInventoryBarcode('3017620422003').products.length,1);
 const bad=harness();assert.throws(()=>bad.context.lookupInventoryBarcode('1234'));assert.throws(()=>bad.context.lookupInventoryBarcode('3017620422004'));assert.equal(bad.calls.length,0);
});
check('ISBN scans keep the existing exact-edition Open Library path',()=>{
 const isbn='9781784705954';const h=harness(url=>url.includes('openlibrary')?response(200,{['ISBN:'+isbn]:{title:'The Inner Life of Animals',identifiers:{isbn_13:[isbn]},publishers:[{name:'Vintage'}]}}):response(404));const r=h.context.lookupInventoryBarcode(isbn);assert.equal(r.products.length,1);assert.equal(r.products[0].lookupProvider,'Open Library');assert.equal(h.calls.length,1);assert.equal(r.products[0].unit,'each');
});
check('Unknown ISBNs never query food or medical databases',()=>{
 const h=harness();h.context.lookupInventoryBarcode('9781770854642');assert(h.calls.some(c=>c.url.includes('openlibrary')));assert(h.calls.some(c=>c.url.includes('upcitemdb')));assert(!h.calls.some(c=>/openfoodfacts|accessgudid/.test(c.url)));
});
check('Consumable quantities cannot be inferred from grams or a count in the title',()=>{
 const h=harness();for(const title of ['Gloves 100 count','Salt 750 g','Salt 5 kg','Paper towel 12 pack','Box of 100 pipette tips']){const p=h.context.eahsProductSuggestion_({title,lookupProvider:'Test',sourceUrl:'https://example.org'});assert.equal(p.unitsPerPack,1);assert.equal(p.kind,'Consumable');}
});
check('Lookup cannot save stock; confirmation and receipt protections remain present',()=>{
 const h=harness();assert.throws(()=>h.context.saveBarcodeInventory({confirmed:false}),/Review and confirm/);
 assert.match(source,/p\.confirmed !== true/);assert.match(source,/prior === 'Done'/);assert.match(source,/Item details changed while you reviewed/);
 const ui=fs.readFileSync(path.join(__dirname,'apps-script/InventoryClient.html'),'utf8');assert.match(ui,/I checked the product variant, pack contents and counting unit/);assert.match(ui,/Confirm and save/);assert.match(ui,/one box counted as box = 1 unit/);assert.match(ui,/lookupProvider/);
});

check('Confirmed stock saves once, remembers conversion, and duplicate receipts cannot add again',()=>{
 const h=harness(),item={id:'gloves',name:'Nitrile gloves',unit:'box',kind:'Consumable',location:'214',storage:'Cabinet',minStock:2,manufacturer:'Example',catalogNumber:'M',quantity:1};let added=0;
 h.context.getData=()=>({items:[item]});h.context.receiveStock=p=>{item.quantity+=p.quantity;added++;return h.context.getData()};
 const p={confirmed:true,requestId:'scan-unit-test-0001',barcode:code,mode:'stock',itemId:item.id,item:{...item,actor:'Verifier'},packs:3,unitsPerPack:1};
 h.context.saveBarcodeInventory(p);assert.equal(item.quantity,4);assert.equal(added,1);const duplicate=h.context.saveBarcodeInventory(p);assert.match(duplicate.warning,/already saved/);assert.equal(item.quantity,4);assert.equal(added,1);
 const lookup=h.context.lookupInventoryBarcode(code);assert.equal(lookup.lookupStatus,'inventory');assert.equal(lookup.matches[0].unitsPerPack,1);assert.equal(h.calls.length,0);
});
check('Stale stock details are rejected before changing quantities',()=>{
 const h=harness(),item={id:'salt',name:'Salt',unit:'bottle',kind:'Consumable',location:'214',storage:'',minStock:1,manufacturer:'Example',catalogNumber:'',quantity:2};h.context.getData=()=>({items:[item]});
 assert.throws(()=>h.context.saveBarcodeInventory({confirmed:true,requestId:'scan-unit-test-0002',barcode:code,mode:'stock',itemId:item.id,item:{...item,unit:'gram',actor:'Verifier'},packs:1,unitsPerPack:750}),/changed while you reviewed/);assert.equal(item.quantity,2);
});
console.log(`${passed} barcode checks passed.`);
