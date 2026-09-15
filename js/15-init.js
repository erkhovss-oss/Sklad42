// ---------- INIT ----------
async function enterClientPortal(token){
  const { data, error } = await sb.rpc('client_portal_snapshot', { p_token: token });
  if(error || !data){
    console.error(error);
    toast('Ссылка недействительна или устарела');
    return false;
  }
  inventory = (data.inventory||[]).map(i=>({...i, client: data.client.name}));
  clientViewMode = { id: data.client.id, name: data.client.name };
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  document.querySelectorAll('.nav-item[data-tab]').forEach(el=>{
    el.style.display = el.dataset.tab==='inventory' ? '' : 'none';
  });
  const groupLabel = document.querySelector('.nav-group-label');
  if(groupLabel) groupLabel.textContent = 'Личный кабинет';
  const foot = document.querySelector('.sidebar-foot');
  if(foot) foot.textContent = 'ТОЛЬКО ПРОСМОТР';
  const filterSelect = document.getElementById('invClientFilter');
  if(filterSelect) filterSelect.style.display = 'none';
  const cellFilterSelect = document.getElementById('invCellFilter');
  if(cellFilterSelect) cellFilterSelect.style.display = 'none';
  const writeoffsBtn = document.getElementById('viewWriteoffsBtn');
  if(writeoffsBtn) writeoffsBtn.style.display = 'none';
  setInventoryView('stock');
  const heading = document.querySelector('#tab-inventory h1');
  if(heading) heading.textContent = 'Остатки — ' + clientViewMode.name;
  const sub = document.querySelector('#tab-inventory .page-head p');
  if(sub) sub.textContent = 'Только просмотр';
  switchTab('inventory');
  renderInventory();
  return true;
}
async function loadStaffData(){
  try{
    await Promise.all([loadRoles(), loadEmployees(), loadInventory(), loadInventoryBarcodes(), loadMovementLog(), loadWriteOffLog(), loadReceivingLog(), loadClients(), loadSupplies(), loadOutboundSupplies(), loadOutboundBoxes(), loadKizScans(), loadFbsOrders(), loadDdsEntries(), loadFbsTariffs(), loadTochkaSettings(), loadWarehouses(), loadCompanySettings(), loadStocktakes(), loadConsumables(), loadKitComponents(), loadReturns()]);
  }catch(err){
    console.error(err);
  }
  if(!inventory.length && !employees.length){
    toast('Не удалось подключиться к базе данных — проверьте, что SQL-схема выполнена');
  }
  renderInventory();
  await loadStorageHistory();
  recordAllStorageSnapshots().then(()=>{
    if(document.getElementById('tab-storage').classList.contains('active')) renderStorage();
  });
  let savedTab = null;
  try{ savedTab = localStorage.getItem('sklad42_active_tab'); }catch(e){}
  const validTabs = ['inventory','clients','storage','supplies','employees'];
  if(savedTab && validTabs.includes(savedTab) && savedTab!=='inventory'){
    switchTab(savedTab);
  }
  applyNavPermissions();
}
async function initApp(){
  if(!sb){
    toast('Не удалось загрузить библиотеку базы данных. Проверьте интернет и обновите страницу (F5)');
    showLoginForm();
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const portalToken = urlParams.get('client');
  if(portalToken){
    const ok = await enterClientPortal(portalToken);
    if(ok) return;
    // токен неверный/устарел — продолжаем как обычный вход сотрудника
  }

  const { data: { session } } = await sb.auth.getSession();
  if(session){
    await resolveCurrentEmployeeAndEnter();
  } else {
    showLoginForm();
  }
}
initApp();

