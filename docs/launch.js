(function () {
  const raw = String(window.EAHS_SITE_CONFIG?.inventoryAppUrl || '').trim();
  const page = document.body.dataset.page || 'hub';
  let base;
  try {
    base = new URL(raw);
    if (base.protocol !== 'https:' || base.hostname !== 'script.google.com' || !base.pathname.endsWith('/exec')) throw Error();
  } catch (_) {
    document.querySelector('#launchStatus').textContent = 'The Agriculture site is ready to connect. Your department administrator will activate the shared tools.';
    document.querySelectorAll('[data-open-page]').forEach(a=>{a.hidden=true;});
    return;
  }
  base.search = ''; base.hash = '';
  for (const a of document.querySelectorAll('[data-open-page]')) {
    const target = new URL(base);
    if (a.dataset.openPage !== 'inventory') target.searchParams.set('page',a.dataset.openPage);
    if (a.dataset.tab) target.searchParams.set('tab',a.dataset.tab);
    a.href = target.href; a.hidden = false;
  }
  const destination = new URL(base);
  if (page !== 'inventory') destination.searchParams.set('page',page);
  const tab = new URLSearchParams(location.search).get('tab');
  if (page === 'hub' && ['home','meetings','updates','faculty','links'].includes(tab)) destination.searchParams.set('tab',tab);
  document.querySelector('#launchStatus').textContent = 'Opening the shared Agriculture tools. Sign in with your school Google account if prompted.';
  location.replace(destination.href);
})();
