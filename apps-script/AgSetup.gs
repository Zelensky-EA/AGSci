/** Run once from a NEW, bound Agriculture spreadsheet, never from Science. */
function initializeAgDepartment() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Create a new Agriculture Google Sheet, then open Extensions > Apps Script from it.');
  const props = PropertiesService.getScriptProperties(), savedId = props.getProperty('INVENTORY_SHEET_ID'), marker = props.getProperty('DEPARTMENT_KEY');
  if (savedId && (savedId !== active.getId() || marker !== AG_CONFIG.departmentKey)) throw new Error('This project is already connected elsewhere. Use a NEW bound Apps Script project for Agriculture.');
  if (!savedId) {
    const names = [...Object.keys(TABLES), ...Object.keys(HUB_TABLES), 'Reservations'];
    if (names.some(n => active.getSheetByName(n)?.getLastRow() > 1)) throw new Error('This Sheet already contains department records. Use a NEW blank Agriculture Sheet; no records were changed.');
    props.setProperty('INVENTORY_SHEET_ID', active.getId());
    props.setProperty('DEPARTMENT_KEY', AG_CONFIG.departmentKey);
  }
  executionBook_ = active;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Setup is already running. Try again in a moment.');
  try {
    setup_(); hubSetup_(); agReservationSetup_();
    const result = {sheetUrl: active.getUrl(), locations: rows_('Locations').map(x => x.location), catalogSuggestions: rows_('Catalog').length, ownedEntries: rows_('Items').length};
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

function agMinutesTemplateUrl_() {
  const id = PropertiesService.getScriptProperties().getProperty('AG_MINUTES_TEMPLATE_ID');
  return id ? 'https://docs.google.com/document/d/' + id + '/edit' : '';
}

function agEnsureMinutesAssets_() {
  // Meeting mutations already hold the script lock. Assets belong to this project.
  book_();
  const props = PropertiesService.getScriptProperties();
  let folderId = props.getProperty('AG_MINUTES_FOLDER_ID'), templateId = props.getProperty('AG_MINUTES_TEMPLATE_ID');
  if (!folderId) {
    folderId = DriveApp.createFolder('EAHS Agriculture Meeting Records').getId();
    props.setProperty('AG_MINUTES_FOLDER_ID', folderId);
  }
  if (!templateId) {
    const doc = DocumentApp.create('EAHS Agriculture Meeting Template'), body = doc.getBody();
    body.appendParagraph('{{MEETING_TITLE}}').setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph('Agriculture Department · {{MEETING_DATE}} · {{MEETING_TIME}}');
    body.appendParagraph('Location: {{MEETING_LOCATION}} · Facilitator: {{FACILITATOR}}');
    body.appendParagraph('Attendance').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Present: ');
    body.appendParagraph('Share outs and discussion').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('Record decisions, their rationale, and any questions deferred for follow up.');
    body.appendParagraph('Action items').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendTable([['Action or deliverable','Owner','Due date','Status'],['','','','']]);
    templateId = doc.getId(); doc.saveAndClose();
    DriveApp.getFileById(templateId).moveTo(DriveApp.getFolderById(folderId));
    props.setProperty('AG_MINUTES_TEMPLATE_ID', templateId);
  }
  return {folderId, templateId};
}
