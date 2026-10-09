/** Agriculture department inventory — bound to a Google Sheet. */
const TABLES = {
  Items: ['id','sku','name','category','kind','quantity','checkedOut','unit','location','storage','minStock','manufacturer','catalogNumber','hazard','expiration','notes','updatedAt','needsRepair','needsReplacement'],
  Loans: ['id','itemId','quantity','remaining','borrower','destination','checkedOutAt','dueDate','returnedAt','status','notes'],
  Activity: ['id','timestamp','action','itemId','itemName','quantity','actor','details'],
  Issues: ['id','itemId','type','quantity','remaining','reportedBy','details','reportedAt','status','resolvedBy','resolution','resolvedAt'],
  Locations: ['location'],
  Catalog: ['category','name','kind','unit','courses','notes'],
  PriceEstimates: ['id','name','kind','unit','averageUnitCost','quotesJson','checkedAt','matchType','notes','updatedBy'],
  PriceCatalog: ['name','kind','unit','averageUnitCost','basis','notes','checkedAt'],
  PriceJobs: ['id','key','itemId','name','kind','unit','manufacturer','catalogNumber','status','attempts','updatedAt','nextAttemptAt','candidatesJson','message']
};
const ROOM_OPTIONS = AG_CONFIG.locations;

function doGet(e) {
  const page = e && e.parameter ? e.parameter.page : '';
  const file = page === 'hub' ? 'HubIndex' : page === 'reservations' ? 'Reservations' : 'Index';
  const template = HtmlService.createTemplateFromFile(file);
  template.appUrl = agAppUrl_();
  template.appUrlJSON = JSON.stringify(template.appUrl).replace(/</g, '\\u003c');
  template.recordsUrl = 'https://docs.google.com/spreadsheets/d/' + book_().getId() + '/edit';
  template.bootstrapJSON = JSON.stringify(agPublicConfig_()).replace(/</g, '\u003c');
  template.initialTabJSON = JSON.stringify(['home','meetings','updates','faculty','links'].includes(e?.parameter?.tab) ? e.parameter.tab : 'home');
  return template.evaluate().setTitle(page === 'hub' ? 'EAHS Agriculture Department Hub' : page === 'reservations' ? 'Ag Space Reservations' : 'Agriculture Inventory');
}

let executionBook_;
let executionReady_ = false;
function book_() {
  if (executionBook_) return executionBook_;
  const properties = PropertiesService.getScriptProperties();
  const id = properties.getProperty('INVENTORY_SHEET_ID');
  if (!id || properties.getProperty('DEPARTMENT_KEY') !== AG_CONFIG.departmentKey) throw new Error('Open a NEW Agriculture Sheet and run initializeAgDepartment before using this app.');
  return executionBook_ = SpreadsheetApp.openById(id);
}

function setup_() {
  if (executionReady_) return;
  const book = book_();
  Object.keys(TABLES).forEach(name => {
    let sheet = book.getSheetByName(name);
    if (!sheet) sheet = book.insertSheet(name);
    const headers = TABLES[name];
    // Safe migration for the initial app: add the two condition-count columns.
    if (name === 'Items' && sheet.getLastRow() > 0) {
      const prior = headers.slice(0, 17);
      if (sheet.getRange(1, 1, 1, prior.length).getValues()[0].join('|') === prior.join('|') && sheet.getRange(1, 18).getValue() === '') {
        sheet.getRange(1, 18, 1, 2).setValues([['needsRepair','needsReplacement']]);
      }
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#123257').setFontColor('#ffffff');
      sheet.autoResizeColumns(1, headers.length);
    } else if (sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) {
      throw new Error('The ' + name + ' sheet headers have changed. Restore the original column order before continuing.');
    }
    if (sheet.getLastRow() === 1 && name === 'Locations') sheet.getRange(2, 1, ROOM_OPTIONS.length, 1).setValues(ROOM_OPTIONS.map(x => [x]));
    if (sheet.getLastRow() === 1 && name === 'Catalog') sheet.getRange(2, 1, CATALOG_ROWS.length, headers.length).setValues(CATALOG_ROWS);
    if (sheet.getLastRow() === 1 && name === 'PriceCatalog' && CATALOG_PRICE_DEFAULTS.length) sheet.getRange(2, 1, CATALOG_PRICE_DEFAULTS.length, headers.length).setValues(CATALOG_PRICE_DEFAULTS);
    if (sheet.getLastRow() === 1 && name === 'PriceEstimates' && PRICE_SEED_ROWS.length) sheet.getRange(2, 1, PRICE_SEED_ROWS.length, headers.length).setValues(PRICE_SEED_ROWS);
  });
  executionReady_ = true;
}

function ensureReadReady_() {
  // Cache only schema readiness; inventory counts and prices are always read fresh.
  let cache;
  const key = "inventory-schema-automatic-pricing-v1:" + book_().getId();
  try { cache = CacheService.getScriptCache(); if (cache.get(key)) return; } catch (e) {}
  setup_();
  try { if (cache) cache.put(key, "ready", 120); } catch (e) {}
}

function sheet_(name) { return book_().getSheetByName(name); }
function rows_(name, limit) {
  const sh = sheet_(name);
  if (!sh) throw new Error("Missing " + name + " tab. Run getData from the Apps Script editor to initialize the inventory.");
  const last = sh.getLastRow(), start = limit ? Math.max(2, last - limit + 1) : 2, count = last - start + 1;
  if (count < 1) return [];
  return sh.getRange(start, 1, count, TABLES[name].length).getValues().map((values, index) => {
    const row = { _row: index + start };
    TABLES[name].forEach((key, i) => row[key] = values[i] instanceof Date ? Utilities.formatDate(values[i], Session.getScriptTimeZone(), 'yyyy-MM-dd') : values[i]);
    const roomField = name === 'Items' ? 'location' : name === 'Loans' ? 'destination' : name === 'Locations' ? 'location' : '';
    if (roomField) row[roomField] = clean_(row[roomField], 100);
    return row;
  });
}
function clean_(value, length) {
  return String(value == null ? '' : value).trim().slice(0, length || 500).replace(/[\u0000-\u001f]/g, ' ');
}
// Google Sheets interprets user-entered leading formula characters. Keep them literal.
function safe_(value, length) {
  const s = clean_(value, length);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function positive_(n, label, allowZero) {
  if (n === '' || n === null || n === undefined) throw new Error(label + ' is required.');
  const value = Number(n);
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(label + ' must be a ' + (allowZero ? 'nonnegative' : 'positive') + ' whole number.');
  return value;
}
function log_(action, item, quantity, actor, details) {
  append_('Activity', {id: Utilities.getUuid(), timestamp: new Date().toISOString(), action, itemId: item.id, itemName: item.name, quantity, actor: safe_(actor, 100), details: safe_(details, 500)});
}
function append_(name, obj) { sheet_(name).appendRow(TABLES[name].map(k => obj[k] == null ? '' : obj[k])); }
function write_(name, obj) { sheet_(name).getRange(obj._row, 1, 1, TABLES[name].length).setValues([TABLES[name].map(k => obj[k] == null ? '' : obj[k])]); }
function locked_(fn) {
  setup_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Inventory is busy. Try again in a moment.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function getData() {
  ensureReadReady_();
  const strip = row => { const obj = Object.assign({}, row); delete obj._row; return obj; };
  return {items: rows_('Items').map(strip), loans: rows_('Loans').filter(x => x.status === 'Open').map(strip), issues: rows_('Issues').filter(x => x.status === 'Open').map(strip), activity: rows_('Activity', 200).reverse().map(strip), locations: rows_('Locations').map(x => x.location).filter(Boolean), catalog: rows_('Catalog').map(strip), prices: rows_('PriceEstimates').map(strip), priceCatalog: rows_('PriceCatalog').map(strip), priceJobs: rows_('PriceJobs').map(strip), pricing: automaticPricingStatus_()};
}
function unavailable_(item) { return Number(item.checkedOut) + Number(item.needsRepair || 0) + Number(item.needsReplacement || 0); }
function nextAutoSku_(usedSkus) {
  const used = usedSkus || new Set(rows_('Items').filter(x => x.sku).map(x => String(x.sku).toUpperCase()));
  let highest = 0;
  used.forEach(sku => {
    const match = String(sku).startsWith(AG_CONFIG.skuPrefix) ? String(sku).slice(AG_CONFIG.skuPrefix.length).match(/^(\d+)$/) : null;
    if (match) highest = Math.max(highest, Number(match[1]));
  });
  let number = highest + 1;
  let sku = AG_CONFIG.skuPrefix + String(number).padStart(6, '0');
  while (used.has(sku.toUpperCase())) { number += 1; sku = AG_CONFIG.skuPrefix + String(number).padStart(6, '0'); }
  used.add(sku.toUpperCase());
  return sku;
}
function nameSignature_(value) {
  const text = clean_(value, 160).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:milliliters?|millilitres?|ml)\b/g, (_, amount) => Number(amount) + 'ml')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:microliters?|microlitres?|µl|μl|ul)\b/g, (_, amount) => Number(amount) + 'ul')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:liters?|litres?|l)\b/g, (_, amount) => Number(amount) * 1000 + 'ml')
    .replace(/×/g, 'x');
  const singular = {beakers:'beaker', flasks:'flask', cylinders:'cylinder', pipettes:'pipette', pipets:'pipet', tubes:'tube', dishes:'dish', bottles:'bottle', microscopes:'microscope'};
  return text.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(word => singular[word] || word).sort().join('|');
}
function catalogAlias_(name) {
  const parts = name.split(' — ');
  return parts[0].split(',')[0] + (parts.length > 1 ? ' ' + parts.slice(1).join(' ') : '');
}
function canonicalName_(rawName, kind, unit, existing) {
  const key = nameSignature_(rawName);
  if (!globalThis.catalogMatchRows_) globalThis.catalogMatchRows_ = rows_('Catalog').map(row => [row.category, row.name, row.kind, row.unit]);
  const rows = globalThis.catalogMatchRows_;
  const compatible = row => String(row[3]).toLowerCase() === unit.toLowerCase();
  const core = rows.filter(row => row[2] === kind && compatible(row));
  const review = rows.filter(row => row[2] === 'Review' && compatible(row));
  // Standard catalog names take precedence over historical names, including exact historical matches.
  for (const group of [core, review]) {
    for (const alias of [false, true]) {
      const matches = [...new Set(group.filter(row => nameSignature_(alias ? catalogAlias_(row[1]) : row[1]) === key).map(row => row[1]))];
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new Error('Several catalog variants match this name. Choose the full name specifying material or type: ' + matches.slice(0, 3).join('; '));
    }
  }
  const known = (existing || []).find(item => nameSignature_(item.name) === key && item.kind === kind && String(item.unit).toLowerCase() === unit.toLowerCase());
  if (known) return known.name;
  return rawName.replace(/\b(\d+(?:\.\d+)?)\s*ml\b/gi, '$1 mL').replace(/\b(\d+(?:\.\d+)?)\s*(?:µl|μl|ul)\b/gi, '$1 µL');
}

function itemKey_(item) { return nameSignature_(item.name) + '|' + clean_(item.location).toLowerCase() + '|' + clean_(item.kind).toLowerCase(); }
function sameStock_(existing, incoming) {
  if (existing.unit.toLowerCase() !== incoming.unit.toLowerCase()) throw new Error('Matching item has a different counting unit. Use its existing unit or give this material a distinct name.');
  if (existing.sku && incoming.sku && existing.sku.toLowerCase() !== incoming.sku.toLowerCase()) throw new Error('Matching item has a different SKU. Use Add stock on the correct entry or distinguish the item names.');
  if (existing.catalogNumber && incoming.catalogNumber && existing.catalogNumber.toLowerCase() !== incoming.catalogNumber.toLowerCase()) throw new Error('Matching item has a different catalog number. Check which entry should receive these units.');
}
// Categories are learned from saved inventory and catalog records; no new tab is needed.
function categoryKey_(value) {
  return clean_(value, 1000).replace(/\s+/g, ' ').toLowerCase();
}
function categoryInput_(raw, knownItems) {
  const custom = categoryKey_(raw.category) === 'other' && raw.newCategory != null;
  const label = clean_(custom ? raw.newCategory : raw.category, 1000).replace(/\s+/g, ' ') || (custom ? '' : 'Other');
  if (!label) throw new Error('Enter a name for the new category.');
  if (label.length > 80) throw new Error('Category names must be 80 characters or fewer.');
  const safe = safe_(label, 80);
  if (!globalThis.categoryCatalogRows_) globalThis.categoryCatalogRows_ = rows_('Catalog');
  const prior = (knownItems || []).concat(globalThis.categoryCatalogRows_).find(row => categoryKey_(row.category) === categoryKey_(safe));
  return prior ? prior.category : safe;
}
function itemInput_(raw, previous, allowedRooms, knownItems) {
  const rawName = safe_(raw.name, 160), location = safe_(raw.location, 100);
  const kind = clean_(raw.kind, 20), unit = safe_(raw.unit, 40) || 'each';
  const name = rawName ? canonicalName_(rawName, kind, unit, knownItems) : '';
  if (!name || !location) throw new Error('Item name and home location are required.');
  if (!(allowedRooms || new Set(rows_('Locations').map(x => x.location))).has(location)) throw new Error('Select a listed location.');
  if (!['Reusable','Consumable'].includes(kind)) throw new Error('Select Reusable or Consumable.');
  const quantity = positive_(raw.quantity, 'Quantity', true);
  if (previous && quantity < unavailable_(previous)) throw new Error('Quantity cannot be less than checked out or flagged units.');
  const expiration = clean_(raw.expiration, 10);
  if (expiration && !/^\d{4}-\d{2}-\d{2}$/.test(expiration)) throw new Error('Use YYYY-MM-DD for expiration.');
  return {
    id: previous ? previous.id : Utilities.getUuid(), sku: safe_(raw.sku, 80), name,
    category: categoryInput_(raw, knownItems), kind, quantity,
    checkedOut: previous ? Number(previous.checkedOut) : 0,
    unit, location, storage: safe_(raw.storage, 120),
    minStock: positive_(raw.minStock === '' || raw.minStock == null ? 0 : raw.minStock, 'Reorder level', true),
    manufacturer: safe_(raw.manufacturer, 120), catalogNumber: safe_(raw.catalogNumber, 100),
    hazard: safe_(raw.hazard, 120), expiration, notes: safe_(raw.notes, 500), updatedAt: new Date().toISOString(),
    needsRepair: previous ? Number(previous.needsRepair || 0) : 0,
    needsReplacement: previous ? Number(previous.needsReplacement || 0) : 0
  };
}
function saveItem(raw) {
  return locked_(() => {
    const existing = rows_('Items');
    const usedSkus = new Set(existing.filter(x => x.sku).map(x => String(x.sku).toUpperCase()));
    const old = raw.id ? existing.find(x => x.id === raw.id) : null;
    if (raw.id && !old) throw new Error('This item no longer exists. Refresh the inventory.');
    const enteredPrice = enteredUnitPrice_(raw.unitPrice);
    validatePriceSource_(raw.priceSource);
    const item = itemInput_(raw, old, null, existing);
    if (old && old.kind !== item.kind && Number(old.checkedOut) > 0) throw new Error('Return outstanding loans before changing item type.');
    if (old && existing.some(x => x.id !== old.id && itemKey_(x) === itemKey_(item))) throw new Error('An entry for this item already exists in that location. Use Add stock on the existing entry.');
    const match = old ? null : existing.find(x => itemKey_(x) === itemKey_(item));
    if (match) {
      sameStock_(match, item);
      if (item.sku && existing.some(x => x.id !== match.id && x.location === item.location && x.sku && x.sku.toLowerCase() === item.sku.toLowerCase())) throw new Error('This SKU belongs to another inventory entry in this room.');
      const received = positive_(item.quantity, 'Additional quantity');
      if (!match.sku) match.sku = nextAutoSku_(usedSkus);
      match.quantity = Number(match.quantity) + received;
      match.updatedAt = new Date().toISOString(); write_('Items', match);
      log_('RESTOCK', match, received, raw.actor || '', 'Matching item in ' + match.location + '; new total ' + match.quantity);
      ensureAutomaticPrice_(match, {...raw,unitPrice:enteredPrice});
      const result = getData(); result._message = 'Added ' + received + ' ' + match.unit + ' to ' + match.name + ' in ' + match.location + '. New total: ' + match.quantity + '.';
      return result;
    }
    if (item.sku && existing.some(x => x.location === item.location && x.sku && x.sku.toLowerCase() === item.sku.toLowerCase() && x.id !== item.id)) throw new Error('This SKU belongs to another entry in this room. Use Add stock on that entry.');
    if (!item.sku) item.sku = old && old.sku ? old.sku : nextAutoSku_(usedSkus);
    if (old) { item._row = old._row; write_('Items', item); }
    else append_('Items', item);
    log_(old ? 'EDIT' : 'ADD', item, item.quantity, raw.actor || '', old ? 'Item details updated' : 'New item');
    ensureAutomaticPrice_(item, {...raw,unitPrice:enteredPrice});
    return getData();
  });
}
function receiveStock(raw) {
  return locked_(() => {
    const item = rows_('Items').find(x => x.id === raw.itemId);
    if (!item) throw new Error('Inventory item not found. Refresh the page.');
    const quantity = positive_(raw.quantity, 'Quantity received');
    const by = safe_(raw.actor, 100);
    if (!by) throw new Error('Enter the staff member receiving the stock.');
    item.quantity = Number(item.quantity) + quantity;
    item.updatedAt = new Date().toISOString(); write_('Items', item);
    log_('RESTOCK', item, quantity, by, 'New total ' + item.quantity + (raw.notes ? '; ' + clean_(raw.notes, 250) : ''));
    const result = getData(); result._message = 'Added ' + quantity + ' ' + item.unit + ' to ' + item.name + ' in ' + item.location + '. New total: ' + item.quantity + '.';
    return result;
  });
}
function importItems(rawItems, actor, addToExisting) {
  if (!Array.isArray(rawItems) || rawItems.length > 500) throw new Error('Import up to 500 rows at a time.');
  return locked_(() => {
    if (addToExisting && !safe_(actor, 100)) throw new Error('Enter the staff member receiving stock before importing.');
    const existing = rows_('Items');
    const usedSkus = new Set(existing.filter(x => x.sku).map(x => String(x.sku).toUpperCase()));
    const allowedRooms = new Set(rows_('Locations').map(x => x.location));
    const skuKey = x => x.sku.toLowerCase() + '|' + x.location;
    const bySku = new Map(existing.filter(x => x.sku).map(x => [skuKey(x), x]));
    const byKey = new Map(existing.map(x => [itemKey_(x), x]));
    const prepared = [], increments = new Map(), errors = [], skipped = [];
    rawItems.forEach((raw, i) => {
      try {
        const unitPrice=enteredUnitPrice_(raw.unitPrice);validatePriceSource_(raw.priceSource);
        const item = itemInput_(raw, null, allowedRooms, existing.concat(prepared));
        item._enteredPrice=unitPrice;item._priceSource=raw.priceSource;
        const sameName = byKey.get(itemKey_(item));
        const sameSku = item.sku && bySku.get(skuKey(item));
        if (sameSku && sameName && sameSku.id !== sameName.id) throw new Error('SKU and item name point to different records.');
        if (sameSku && itemKey_(sameSku) !== itemKey_(item)) {
          if (addToExisting) throw new Error('SKU belongs to another item or home location.');
          skipped.push(i + 2); return;
        }
        const match = sameName || sameSku;
        if (match) {
          if (!addToExisting) { skipped.push(i + 2); return; }
          sameStock_(match, item);
          const amount = positive_(item.quantity, 'Additional quantity');
          if (match._row) increments.set(match.id, {item: match, quantity: (increments.get(match.id)?.quantity || 0) + amount, unitPrice: unitPrice??increments.get(match.id)?.unitPrice, priceSource: raw.priceSource||increments.get(match.id)?.priceSource});
          else match.quantity = Number(match.quantity) + amount; // Merge repeated new entries inside this same CSV.
          return;
        }
        if (!item.sku) item.sku = nextAutoSku_(usedSkus);
        else usedSkus.add(item.sku.toUpperCase());
        byKey.set(itemKey_(item), item);
        if (item.sku) bySku.set(skuKey(item), item);
        prepared.push(item);
      } catch (e) { errors.push('CSV row ' + (i + 2) + ': ' + e.message); }
    });
    if (errors.length) throw new Error('No rows imported. ' + errors.slice(0, 8).join(' ') + (errors.length > 8 ? ' (and ' + (errors.length - 8) + ' more)' : ''));
    increments.forEach(({item, quantity}) => {
      item.quantity = Number(item.quantity) + quantity;
      item.updatedAt = new Date().toISOString(); write_('Items', item);
      log_('RESTOCK', item, quantity, actor, 'CSV stock receipt; new total ' + item.quantity);
    });
    if (prepared.length) {
      sheet_('Items').getRange(sheet_('Items').getLastRow() + 1, 1, prepared.length, TABLES.Items.length).setValues(prepared.map(x => TABLES.Items.map(k => x[k] == null ? '' : x[k])));
      const activity = prepared.map(item => [Utilities.getUuid(), new Date().toISOString(), 'IMPORT', item.id, item.name, item.quantity, safe_(actor, 100), 'CSV import']);
      sheet_('Activity').getRange(sheet_('Activity').getLastRow() + 1, 1, activity.length, TABLES.Activity.length).setValues(activity);
    }
    const priceBatch=automaticPriceBatch_(true);
    increments.forEach(({item,unitPrice,priceSource})=>ensureAutomaticPrice_(item,{unitPrice,priceSource,actor},priceBatch));
    prepared.forEach(item=>ensureAutomaticPrice_(item,{unitPrice:item._enteredPrice,priceSource:item._priceSource,actor},priceBatch));
    flushAutomaticPriceBatch_(priceBatch);
    return {added: prepared.length, restocked: increments.size, skipped: skipped.length, skippedRows: skipped, data: getData()};
  });
}
function checkout(raw) {
  return locked_(() => {
    const item = rows_('Items').find(x => x.id === raw.itemId);
    if (!item) throw new Error('Item not found. Refresh the inventory.');
    const quantity = positive_(raw.quantity, 'Quantity');
    if (quantity > Number(item.quantity) - unavailable_(item)) throw new Error('Only ' + (Number(item.quantity) - unavailable_(item)) + ' ' + item.unit + ' available.');
    const borrower = safe_(raw.borrower, 100), destination = safe_(raw.destination, 100);
    if (!borrower || !destination) throw new Error('Staff member and destination are required.');
    if (!rows_('Locations').some(x => x.location === destination)) throw new Error('Choose a listed destination.');
    const dueDate = clean_(raw.dueDate, 10);
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Use YYYY-MM-DD for due date.');
    if (item.kind === 'Reusable') {
      item.checkedOut = Number(item.checkedOut) + quantity;
      append_('Loans', {id: Utilities.getUuid(), itemId: item.id, quantity, remaining: quantity, borrower, destination, checkedOutAt: new Date().toISOString(), dueDate, returnedAt: '', status: 'Open', notes: safe_(raw.notes, 300)});
      log_('CHECK OUT', item, quantity, borrower, 'To ' + destination + (dueDate ? '; due ' + dueDate : ''));
    } else {
      item.quantity = Number(item.quantity) - quantity;
      log_('USE', item, quantity, borrower, 'Used in ' + destination + (raw.notes ? '; ' + raw.notes : ''));
    }
    item.updatedAt = new Date().toISOString(); write_('Items', item);
    return getData();
  });
}
function returnLoan(raw) {
  return locked_(() => {
    const loan = rows_('Loans').find(x => x.id === raw.loanId && x.status === 'Open');
    if (!loan) throw new Error('Checkout already closed or not found. Refresh the page.');
    const quantity = positive_(raw.quantity, 'Return quantity');
    if (quantity > Number(loan.remaining)) throw new Error('Only ' + loan.remaining + ' still checked out.');
    const item = rows_('Items').find(x => x.id === loan.itemId);
    if (!item) throw new Error('Inventory item for this checkout is missing.');
    loan.remaining = Number(loan.remaining) - quantity;
    if (loan.remaining === 0) { loan.status = 'Returned'; loan.returnedAt = new Date().toISOString(); }
    item.checkedOut = Number(item.checkedOut) - quantity;
    item.updatedAt = new Date().toISOString();
    write_('Loans', loan); write_('Items', item);
    log_('RETURN', item, quantity, raw.actor || loan.borrower, 'From ' + loan.destination + (raw.notes ? '; ' + raw.notes : ''));
    return getData();
  });
}
function adjustStock(raw) {
  return locked_(() => {
    const item = rows_('Items').find(x => x.id === raw.itemId);
    if (!item) throw new Error('Item not found. Refresh the page.');
    const next = positive_(raw.quantity, 'New total quantity', true);
    if (next < unavailable_(item)) throw new Error('New total cannot be below checked out or flagged quantities.');
    const old = Number(item.quantity);
    item.quantity = next; item.updatedAt = new Date().toISOString(); write_('Items', item);
    log_('COUNT', item, next - old, raw.actor || '', 'Count corrected from ' + old + ' to ' + next + '; ' + clean_(raw.reason, 250));
    return getData();
  });
}
function reportIssue(raw) {
  return locked_(() => {
    const item = rows_('Items').find(x => x.id === raw.itemId);
    if (!item) throw new Error('Item not found. Refresh the page.');
    const type = clean_(raw.type, 20);
    if (!['Repair','Replacement'].includes(type)) throw new Error('Select repair or replacement.');
    const quantity = positive_(raw.quantity, 'Affected quantity');
    if (quantity > Number(item.quantity) - unavailable_(item)) throw new Error('Only available units can be flagged. Return checked-out units first.');
    const by = safe_(raw.reportedBy, 100), details = safe_(raw.details, 500);
    if (!by || !details) throw new Error('Staff member and description are required.');
    append_('Issues', {id: Utilities.getUuid(), itemId: item.id, type, quantity, remaining: quantity, reportedBy: by, details, reportedAt: new Date().toISOString(), status: 'Open'});
    const field = type === 'Repair' ? 'needsRepair' : 'needsReplacement';
    item[field] = Number(item[field] || 0) + quantity;
    item.updatedAt = new Date().toISOString(); write_('Items', item);
    log_(type.toUpperCase() + ' NEEDED', item, quantity, by, details);
    return getData();
  });
}
// Attach a staff-confirmed request to units already flagged in the Sheet.
// Recheck under the inventory lock; never flag those units a second time.
function recordExistingIssue(raw) {
  return locked_(() => {
    const item = rows_('Items').find(x => x.id === raw.itemId);
    if (!item) throw new Error('Item not found. Refresh the inventory.');
    const type = clean_(raw.type, 20);
    if (!['Repair','Replacement'].includes(type)) throw new Error('Select repair or replacement.');
    const field = type === 'Repair' ? 'needsRepair' : 'needsReplacement';
    const quantity = positive_(raw.quantity, 'Already flagged quantity');
    const recorded = rows_('Issues').filter(x => x.itemId === item.id && x.type === type && x.status === 'Open')
      .reduce((sum, x) => sum + Number(x.remaining || 0), 0);
    if (!Number.isSafeInteger(recorded) || recorded < 0) throw new Error('Open request quantities are inconsistent. Reconcile the Sheet before recording a request.');
    const unrecorded = positive_(item[field] || 0, 'Current flagged quantity', true) - recorded;
    if (quantity > unrecorded) throw new Error('These flags already have requests or the item changed. Refresh before recording a request.');
    const by = safe_(raw.reportedBy, 100), details = safe_(raw.details, 500);
    if (!by || !details) throw new Error('Staff member and description are required.');
    append_('Issues', {id: Utilities.getUuid(), itemId: item.id, type, quantity, remaining: quantity,
      reportedBy: by, details, reportedAt: new Date().toISOString(), status: 'Open'});
    log_('FLAG REQUEST RECORDED', item, quantity, by, type + ': ' + details + '; existing counts unchanged');
    return getData();
  });
}

function resolveIssue(raw) {
  return locked_(() => {
    const issue = rows_('Issues').find(x => x.id === raw.issueId && x.status === 'Open');
    if (!issue) throw new Error('Request already closed or not found. Refresh the page.');
    const item = rows_('Items').find(x => x.id === issue.itemId);
    if (!item) throw new Error('Inventory item for this request is missing.');
    const quantity = positive_(raw.quantity, 'Resolution quantity');
    if (quantity > Number(issue.remaining)) throw new Error('Only ' + issue.remaining + ' unit(s) remain flagged.');
    const resolution = clean_(raw.resolution, 30);
    if (!['Back in service','Removed from inventory'].includes(resolution)) throw new Error('Select how the request was resolved.');
    const by = safe_(raw.resolvedBy, 100);
    if (!by) throw new Error('Staff member is required.');
    const field = issue.type === 'Repair' ? 'needsRepair' : 'needsReplacement';
    if (quantity > positive_(item[field] || 0, 'Current flagged quantity', true)) throw new Error('The item flag count no longer covers this request. Refresh and reconcile the Sheet before resolving it.');
    item[field] = Number(item[field] || 0) - quantity;
    if (resolution === 'Removed from inventory') item.quantity = Number(item.quantity) - quantity;
    issue.remaining = Number(issue.remaining) - quantity;
    if (issue.remaining === 0) { issue.status = 'Resolved'; issue.resolvedAt = new Date().toISOString(); }
    issue.resolvedBy = by; issue.resolution = resolution;
    item.updatedAt = new Date().toISOString(); write_('Issues', issue); write_('Items', item);
    log_('ISSUE RESOLVED', item, quantity, by, resolution + (raw.notes ? '; ' + clean_(raw.notes, 250) : ''));
    return getData();
  });
}

function priceKey_(item) {
  return nameSignature_(item.name) + '|' + item.kind + '|' + String(item.unit || 'each').trim().toLowerCase();
}
function priceQuotes_(rawQuotes) {
  if (!Array.isArray(rawQuotes) || !rawQuotes.length || rawQuotes.length > 6) throw new Error('Enter one to six supplier quotes.');
  const seen = new Set();
  return rawQuotes.map(raw => {
    const supplier = clean_(raw.supplier, 150), url = clean_(raw.url, 1200);
    const price = Number(raw.price), packQuantity = Number(raw.packQuantity);
    if (!supplier || !/^https?:\/\/[^\s<>"']+$/i.test(url)) throw new Error('Each quote needs a supplier and a full http(s) source link.');
    if (!Number.isFinite(price) || price <= 0 || price > 100000000) throw new Error('Quote price must be greater than zero.');
    if (!Number.isSafeInteger(packQuantity) || packQuantity < 1) throw new Error('Inventory units per pack must be a positive whole number.');
    const sourceKey = url.toLowerCase();
    if (seen.has(sourceKey)) throw new Error('Use each supplier listing only once in an estimate.');
    seen.add(sourceKey);
    return {supplier, url, price, packQuantity};
  });
}
function savePriceEstimate(raw) {
  return locked_(() => {
    const item = rows_('Items').find(x => x.id === raw.itemId);
    if (!item) throw new Error('Choose an inventory item before pricing it.');
    const quotes = priceQuotes_(raw.quotes);
    const matchType = clean_(raw.matchType, 40);
    if (!['Exact model','Comparable item','Confirm model'].includes(matchType)) throw new Error('Choose how closely the quotes match the inventory item.');
    const checkedAt = clean_(raw.checkedAt, 10), actor = safe_(raw.actor, 100);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt) || (!Number.isFinite(Date.parse(checkedAt)) || new Date(checkedAt).toISOString().slice(0,10) !== checkedAt)) throw new Error('Enter the date the quotes were checked.');
    if (!actor) throw new Error('Enter the staff member checking these prices.');
    const prior = rows_('PriceEstimates').find(x => priceKey_(x) === priceKey_(item));
    const estimate = {id: prior ? prior.id : Utilities.getUuid(), name: item.name, kind: item.kind, unit: item.unit,
      averageUnitCost: quotes.reduce((sum, q) => sum + q.price / q.packQuantity, 0) / quotes.length,
      quotesJson: JSON.stringify(quotes), checkedAt, matchType, notes: safe_(raw.notes, 1000), updatedBy: actor};
    if (prior) { estimate._row = prior._row; write_('PriceEstimates', estimate); }
    else append_('PriceEstimates', estimate);
    log_('PRICE ESTIMATE', item, 0, actor, 'USD ' + estimate.averageUnitCost.toFixed(4) + ' per ' + item.unit + '; ' + quotes.length + ' source(s); ' + matchType);
    finishPriceJobs_(item,'Done','Staff quote saved; automatic search will not overwrite it.');
    const data = getData();
    data._message = 'Replacement price saved for matching names, types, and units across all rooms.';
    return data;
  });
}

const PRICE_SEED_ROWS = [];

// Return project-owned client JavaScript separately from the initial HTML shell.
// getRawContent avoids template evaluation and preserves the original code exactly.
function getInventoryClient() {
  try {
    return HtmlService.createTemplateFromFile('InventoryClient').getRawContent();
  } catch (e) {
    throw new Error('Cannot read InventoryClient.html. Create an HTML file named InventoryClient, paste the supplied content, and deploy a new version. ' + e.message);
  }
}
