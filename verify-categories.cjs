const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=__dirname,read=f=>fs.readFileSync(path.join(root,f),'utf8');let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name)}
let db={},uuid=0;
const back=vm.createContext({console,Utilities:{getUuid:()=>`category-test-${++uuid}`,formatDate:()=> '2026-10-07'},Session:{getScriptTimeZone:()=> 'America/Los_Angeles'}});
vm.runInContext(read('apps-script/DepartmentConfig.gs')+'\n'+read('apps-script/Code.gs')+'\n'+read('apps-script/AutomaticPricing.gs'),back);
const headers=vm.runInContext('TABLES',back);
back.sheet_=name=>({getLastRow:()=>1+db[name].length,getRange:(r,c,n,width)=>({getValues:()=>Array.from({length:n},(_,i)=>headers[name].slice(c-1,c-1+width).map(k=>db[name][r+i-2]?.[k]??'')),setValues:values=>values.forEach((vals,i)=>{const row=db[name][r+i-2]||(db[name][r+i-2]={});headers[name].slice(c-1,c-1+width).forEach((k,j)=>row[k]=vals[j])})}),appendRow:vals=>db[name].push(Object.fromEntries(headers[name].map((k,i)=>[k,vals[i]])))});
back.locked_=fn=>fn();back.ensureReadReady_=()=>{};
function reset(){db=Object.fromEntries(Object.keys(headers).map(k=>[k,[]]));db.Locations=[{location:'214'}];vm.runInContext('globalThis.catalogMatchRows_=null;globalThis.categoryCatalogRows_=null',back)}
const entry=(name,category)=>({name,category,kind:'Reusable',quantity:1,unit:'each',location:'214',minStock:0,actor:'Test'});
reset();
check('A new category is saved with an item and survives a fresh server read',()=>{
 const response=back.saveItem({...entry('Telescope','Other'),newCategory:'Astronomy Equipment'});
 assert.equal(response.items[0].category,'Astronomy Equipment');
 assert.equal(back.getData().items[0].category,'Astronomy Equipment');
 assert(!('newCategory' in db.Items[0]));
});
check('CSV categories reuse existing spelling and new categories persist across rows',()=>{
 const r=back.importItems([entry('Lens',' astronomy equipment '),entry('Rock','Geology'),entry('Mineral','geology')],'Test',false);
 assert.equal(r.added,3);assert.equal(r.data.items.find(x=>x.name==='Lens').category,'Astronomy Equipment');
 assert.deepEqual(r.data.items.filter(x=>['Rock','Mineral'].includes(x.name)).map(x=>x.category),['Geology','Geology']);
});
check('Catalog-only categories are available and canonical on save',()=>{
 db.Catalog.push({category:'Microscopy',name:'Catalog lens',kind:'Reusable',unit:'each'});vm.runInContext('globalThis.categoryCatalogRows_=null',back);
 const response=back.saveItem(entry('Slide holder','microscopy'));assert.equal(response.items.find(x=>x.name==='Slide holder').category,'Microscopy');
});
check('Blank custom names and failed CSV validation leave all records unchanged',()=>{
 const before=JSON.stringify(db);
 assert.throws(()=>back.saveItem({...entry('Invalid','Other'),newCategory:' '}),/name.*category/);
 assert.equal(JSON.stringify(db),before);
 assert.throws(()=>back.importItems([entry('Valid','New category'),{...entry('Invalid CSV','New category'),quantity:-1}],'Test',false),/No rows imported/);
 assert.equal(JSON.stringify(db),before);
 assert.throws(()=>back.saveItem(entry('Too long','x'.repeat(81))),/80 characters/);assert.equal(JSON.stringify(db),before);
});
check('Category formula-like strings are stored as literal text',()=>{
 back.saveItem(entry('Formula label','=SUM(1,2)'));
 assert.equal(db.Items.find(x=>x.name==='Formula label').category,"'=SUM(1,2)");
});
check('Duplicate imports preserve the existing category and do not register unused names',()=>{
 const before=JSON.stringify(db.Items);const r=back.importItems([entry('Telescope','Unused category')],'Test',false);
 assert.equal(r.skipped,1);assert.equal(JSON.stringify(db.Items),before);
 assert(!back.getData().items.some(x=>x.category==='Unused category'));
});
const node=()=>({innerHTML:'',textContent:'',value:'',style:{},disabled:false,append(){},addEventListener(){},querySelector(){return node()}});
const nodes=new Map(),document={querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},addEventListener(){},createElement:node};
const ui=vm.createContext({console,document,window:{},localStorage:{getItem:()=>null,setItem(){}},setInterval(){},setTimeout(){},clearTimeout(){},Intl,URL,Blob});
vm.runInContext(read('apps-script/InventoryClient.html').replace(/loadInventory\(\);\s*$/,''),ui);
const fixture=JSON.parse(read('category-fixture.json'));
ui.data={items:fixture.Items.map((category,i)=>({...entry('Item '+i,category),id:'i'+i,checkedOut:0,needsRepair:0,needsReplacement:0})),catalog:fixture.Catalog.map(category=>({category,name:'Catalog example',kind:'Reusable',unit:'each'})),locations:['214'],prices:[],priceJobs:[]};
vm.runInContext('state=normalizeData(data)',ui);
check('Every live Sheet category appears in options, filters and import list',()=>{
 const cats=Array.from(vm.runInContext('categories()',ui));
 for(const c of new Set([...fixture.Items,...fixture.Catalog]))assert(cats.includes(c),c);
 const html=vm.runInContext('inventoryView()+importView()',ui);
 assert.match(html,/Anatomy Equipment/);assert.match(html,/Supplemental book/);assert.match(html,/Dissection Specimen/);
 assert(!cats.includes('Technology')); // Defaults must not replace the live list.
});
check('Editing an existing category preserves its selected option',()=>{
 assert.match(vm.runInContext("categoryFields('Supplemental book')",ui),/value="Supplemental book" selected/);
 assert.match(vm.runInContext("categoryFields('Anatomy Equipment')",ui),/value="Anatomy Equipment" selected/);
});
check('Other reveals a required field and changing category removes the requirement',()=>{
 let change;const select={value:'Equipment',disabled:false,addEventListener:(type,fn)=>change=fn},input={disabled:true,required:false,focus(){}},container={hidden:true,style:{display:'none'}};
 ui.form={elements:{category:select,newCategory:input},querySelector:()=>container};vm.runInContext('bindCategoryFields(form)',ui);
 select.value='Other';change();assert.equal(container.hidden,false);assert.equal(container.style.display,'');assert.equal(input.required,true);assert.equal(input.disabled,false);
 select.value='Equipment';change();assert.equal(container.hidden,true);assert.equal(container.style.display,'none');assert.equal(input.required,false);assert.equal(input.disabled,true);
 select.disabled=true;select.value='Other';change();assert.equal(container.hidden,true);
 assert.throws(()=>vm.runInContext("resolveCategoryFields({category:'Other',newCategory:' '})",ui),/name.*category/);
});
check('Custom values resolve to a real category and escape HTML in options',()=>{
 const fields=vm.runInContext("resolveCategoryFields({category:'Other',newCategory:' supplemental book '})",ui);
 assert.equal(fields.category,'Supplemental book');assert(!('newCategory' in fields));
 assert.match(vm.runInContext("categoryFields('<img src=x>')",ui),/&lt;img src=x&gt;/);
});
check('CSV preview detects new categories without registering canceled drafts',()=>{
 const before=vm.runInContext('JSON.stringify(categories())',ui);
 const p=vm.runInContext("previewCategories([{category:'Genetics'},{category:' genetics '},{category:'Supplemental book'}])",ui);
 assert.deepEqual(Array.from(p.newCategories),['Genetics']);assert.equal(p.rows[1].category,'Genetics');assert.equal(vm.runInContext('JSON.stringify(categories())',ui),before);
 ui.data=back.getData();vm.runInContext('state=normalizeData(data)',ui);
 assert(Array.from(vm.runInContext('categories()',ui)).includes('Astronomy Equipment'));
});
check('Case variants share one option and remain visible under its filter',()=>{
 ui.data={items:[{...entry('A','Geology'),id:'a'},{...entry('B','geology'),id:'b'}],catalog:[],locations:['214']};vm.runInContext("state=normalizeData(data);filterCat='Geology'",ui);
 assert.equal(Array.from(vm.runInContext('categories()',ui)).filter(x=>x.toLowerCase()==='geology').length,1);
 assert.match(vm.runInContext('inventoryView()',ui),/2 of 2 confirmed entries/);
});
console.log(`${passed} category checks passed.`);
