/** Ag-only shared-Sheet bookings. No calendar writes or notifications. */
const AG_RESERVATION_HEADERS = ['id','requestId','date','location','start','end','teacherName','teacherEmail','course','activity','needsPrep','notes','status','createdAt'];
function agReservationSetup_() {
  const book = book_();
  let sheet = book.getSheetByName('Reservations');
  if (!sheet) sheet = book.insertSheet('Reservations');
  if (!sheet.getLastRow()) {
    sheet.getRange(1,1,1,AG_RESERVATION_HEADERS.length).setValues([AG_RESERVATION_HEADERS]);
    sheet.setFrozenRows(1);
  } else if (sheet.getRange(1,1,1,AG_RESERVATION_HEADERS.length).getValues()[0].join('|') !== AG_RESERVATION_HEADERS.join('|')) throw new Error('Restore the Reservations column names and order.');
  return sheet;
}
function agReservationRows_() {
  const sh = agReservationSetup_(), n = sh.getLastRow()-1;
  if (n < 1) return [];
  return sh.getRange(2,1,n,AG_RESERVATION_HEADERS.length).getValues().map(values => Object.fromEntries(AG_RESERVATION_HEADERS.map((k,i)=>[k, values[i] instanceof Date ? Utilities.formatDate(values[i],AG_CONFIG.timeZone,k==='date'?'yyyy-MM-dd':k==='start'||k==='end'?'HH:mm':"yyyy-MM-dd'T'HH:mm:ss") : values[i]])));
}
function agReservationLocation_(raw) {
  const location = clean_(raw,100);
  if (!rows_('Locations').some(x=>x.location===location)) throw new Error('Choose a listed Ag location.');
  return location;
}
function getAgReservations(raw) {
  ensureReadReady_();
  const start = hubDate_(raw?.start,true), end = hubDate_(raw?.end,true), location = agReservationLocation_(raw?.location);
  if (end <= start || (Date.parse(end)-Date.parse(start))/86400000 > 35) throw new Error('Choose a date range of 1–35 days.');
  return {reservations:agReservationRows_().filter(r=>r.status==='Confirmed' && String(r.location)===location && r.date>=start && r.date<end).map(r=>({id:r.id,date:r.date,location:String(r.location),start:r.start,end:r.end,course:r.course,teacherName:r.teacherName})),locations:rows_('Locations').map(x=>x.location)};
}
function saveAgReservation(raw) {
  return locked_(()=>{
    const x = {
      id:Utilities.getUuid(), requestId:clean_(raw?.requestId,100), date:hubDate_(raw?.date,true), location:agReservationLocation_(raw?.location),
      start:clean_(raw?.start,5),end:clean_(raw?.end,5),teacherName:safe_(raw?.teacherName,80),teacherEmail:hubEmail_(raw?.teacherEmail).toLowerCase(),
      course:safe_(raw?.course,100),activity:safe_(raw?.activity,120),needsPrep:raw?.needsPrep===true,notes:safe_(raw?.notes,500),status:'Confirmed',createdAt:new Date().toISOString()
    };
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(x.requestId)) throw new Error('Reopen the reservation form before saving.');
    if (![x.start,x.end].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || x.start>=x.end) throw new Error('Enter a valid start and end time.');
    if (!x.teacherName || !x.activity || !x.course || !x.teacherEmail.endsWith('@'+AG_CONFIG.schoolEmailDomain)) throw new Error('Enter your name, school email, course and activity.');
    const rows = agReservationRows_(), prior = rows.find(r=>r.requestId===x.requestId);
    if (prior) {
      const fields = ['date','location','start','end','teacherName','teacherEmail','course','activity','needsPrep','notes'];
      if (!fields.every(k=>String(prior[k])===String(x[k]))) throw new Error('This request already saved different details. Reopen the form.');
      return {id:prior.id,message:'This reservation was already saved; no duplicate was added.'};
    }
    const today = Utilities.formatDate(new Date(),AG_CONFIG.timeZone,'yyyy-MM-dd'), cutoff = new Date(today+'T12:00:00Z');
    cutoff.setUTCDate(cutoff.getUTCDate()+AG_CONFIG.reservationAdvanceDays);
    if (x.date < today || x.date > cutoff.toISOString().slice(0,10)) throw new Error('Reserve within the next '+AG_CONFIG.reservationAdvanceDays+' days.');
    const startDate = Utilities.parseDate(x.date+' '+x.start,AG_CONFIG.timeZone,'yyyy-MM-dd HH:mm');
    if (startDate.getTime() <= Date.now()) throw new Error('Choose a future reservation start time.');
    if (AG_CONFIG.closedDates.includes(x.date)) throw new Error('This date is closed for Ag space reservations.');
    if (rows.some(r=>r.status==='Confirmed' && r.date===x.date && String(r.location)===x.location && r.start<x.end && x.start<r.end)) throw new Error('That space was booked while you were reviewing. Refresh and choose another time.');
    agReservationSetup_().appendRow(AG_RESERVATION_HEADERS.map(k=>x[k]));
    return {id:x.id,message:'Reservation saved in the shared Ag records.'};
  });
}

function getAgReservationClient(){return HtmlService.createTemplateFromFile('ReservationClient').getRawContent();}
