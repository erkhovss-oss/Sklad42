// ---------- INIT ----------
let portalToken = null;
async function enterClientPortal(token){
  const { data, error } = await sb.rpc('client_portal_snapshot', { p_token: token });
  if(error || !data){
    console.error(error);
    toast('Ссылка недействительна или устарела');
    return false;
  }
  portalToken = token;
  inventory = (data.inventory||[]).map(i=>({...i, client: data.client.name}));
  clientViewMode = { id: data.client.id, name: data.client.name };
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  document.querySelectorAll('.nav-item[data-tab]').forEach(el=>{
    el.style.display = (el.dataset.tab==='inventory' || el.dataset.tab==='portal-supplies') ? '' : 'none';
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
  renderPortalSupplyDraftRows();
  await loadPortalSupplies();
  return true;
}
let portalSuppliesList = [];
let portalSupplyDraft = [{sku:'', customSku:'', customName:'', size:'', qty:1}];
function addPortalSupplyDraftRow(){
  portalSupplyDraft.push({sku:'', customSku:'', customName:'', size:'', qty:1});
  renderPortalSupplyDraftRows();
}
function removePortalSupplyDraftRow(idx){
  portalSupplyDraft.splice(idx,1);
  if(!portalSupplyDraft.length) portalSupplyDraft.push({sku:'', customSku:'', customName:'', size:'', qty:1});
  renderPortalSupplyDraftRows();
}
function updatePortalDraftField(idx, field, value){
  portalSupplyDraft[idx][field] = value;
  if(field==='sku') portalSupplyDraft[idx].size = '';
  renderPortalSupplyDraftRows();
}
function updatePortalDraftFieldSilent(idx, field, value){
  portalSupplyDraft[idx][field] = value;
}
function renderPortalSupplyDraftRows(){
  const wrap = document.getElementById('portalSupplyDraftRows');
  if(!wrap) return;
  const knownSkus = [...new Map(inventory.map(i=>[i.sku, i.name])).entries()];
  wrap.innerHTML = portalSupplyDraft.map((row, idx)=>{
    const sizesForSku = row.sku ? [...new Set(inventory.filter(i=>i.sku===row.sku).map(i=>i.size).filter(Boolean))] : [];
    return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px dashed var(--line)">
      <select class="search" style="width:240px" onchange="updatePortalDraftField(${idx},'sku',this.value)">
        <option value="" ${!row.sku?'selected':''}>— другой товар (укажу вручную) —</option>
        ${knownSkus.map(([sku,name])=>`<option value="${escapeHtml(sku)}" ${row.sku===sku?'selected':''}>${escapeHtml(name)} (${escapeHtml(sku)})</option>`).join('')}
      </select>
      ${row.sku ? (sizesForSku.length ? `
        <select class="search" style="width:110px" onchange="updatePortalDraftField(${idx},'size',this.value)">
          <option value="">Размер</option>
          ${sizesForSku.map(s=>`<option value="${escapeHtml(s)}" ${row.size===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
        </select>
      ` : '') : `
        <input class="search" style="width:140px" placeholder="Артикул" value="${escapeHtml(row.customSku)}" oninput="updatePortalDraftFieldSilent(${idx},'customSku',this.value)">
        <input class="search" style="width:200px" placeholder="Название товара" value="${escapeHtml(row.customName)}" oninput="updatePortalDraftFieldSilent(${idx},'customName',this.value)">
      `}
      <input class="search mono" type="number" min="1" style="width:90px" placeholder="Кол-во" value="${row.qty}" oninput="updatePortalDraftFieldSilent(${idx},'qty',this.value)">
      <button class="btn btn-ghost" style="padding:5px 10px" onclick="removePortalSupplyDraftRow(${idx})">✕</button>
    </div>`;
  }).join('');
}
async function submitPortalSupply(){
  const items = [];
  for(const row of portalSupplyDraft){
    const qty = parseInt(row.qty) || 0;
    if(qty <= 0) continue;
    if(row.sku){
      const invItem = inventory.find(i=>i.sku===row.sku && (i.size||'')===(row.size||''));
      items.push({sku:row.sku, name: invItem?invItem.name:row.sku, qty, size: row.size||null});
    } else if(row.customSku && row.customSku.trim()){
      items.push({sku:row.customSku.trim(), name: (row.customName||'').trim()||row.customSku.trim(), qty, size: null});
    }
  }
  if(!items.length){ toast('Добавьте хотя бы одну позицию с указанным количеством'); return; }
  const { data, error } = await sb.rpc('client_portal_create_supply', { p_token: portalToken, p_items: items });
  if(error){ console.error(error); toast('Не удалось отправить заявку — попробуйте ещё раз'); return; }
  toast('Заявка отправлена — статус появится в списке ниже');
  portalSupplyDraft = [{sku:'', customSku:'', customName:'', size:'', qty:1}];
  renderPortalSupplyDraftRows();
  await loadPortalSupplies();
}
async function loadPortalSupplies(){
  if(!portalToken) return;
  const { data, error } = await sb.rpc('client_portal_supplies', { p_token: portalToken });
  if(error){ console.error(error); return; }
  portalSuppliesList = data || [];
  renderPortalSuppliesList();
}
function renderPortalSuppliesList(){
  const wrap = document.getElementById('portalSuppliesListWrap');
  if(!wrap) return;
  if(!portalSuppliesList.length){ wrap.innerHTML = `<div class="panel empty">Заявок пока нет</div>`; return; }
  const statusLabel = s => ({planned:'Едет / ожидается на складе', received:'Принята', shipped:'Отправлена'}[s] || s);
  const statusClass = s => ({planned:'planned', received:'shipped', shipped:'shipped'}[s] || 'planned');
  wrap.innerHTML = portalSuppliesList.map(s=>`
    <div class="panel" style="padding:16px 20px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-weight:600;font-size:14px">${escapeHtml(s.id)}</div>
          <div style="font-size:12px;color:var(--ink-faint)">${new Date(s.created_at).toLocaleDateString('ru-RU')} · ${s.items.length} позиц.</div>
        </div>
        <span class="status ${statusClass(s.status)}">${statusLabel(s.status)}</span>
      </div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.6">
        ${s.items.map(it=>`${escapeHtml(it.name||it.sku)}${it.size?' ('+escapeHtml(it.size)+')':''} — ${it.receivedQty||0}/${it.qty} шт`).join('<br>')}
      </div>
    </div>
  `).join('');
}
async function loadStaffData(){
  try{
    await Promise.all([loadRoles(), loadEmployees(), loadInventory(), loadInventoryBarcodes(), loadMovementLog(), loadWriteOffLog(), loadReceivingLog(), loadClients(), loadSupplies(), loadOutboundSupplies(), loadOutboundBoxes(), loadKizScans(), loadFbsOrders(), loadOzonOrders(), loadDdsEntries(), loadFbsTariffs(), loadTochkaSettings(), loadWarehouses(), loadCompanySettings(), loadStocktakes(), loadConsumables(), loadKitComponents(), loadReturns()]);
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

