// ---------- KITS (наборы/комплекты) ----------
async function loadKitComponents(){
  const { data, error } = await sb.from('kit_components').select('*').limit(20000);
  if(error){ console.error(error); return; }
  kitComponents = data.map(k=>({id:k.id, kitSku:k.kit_sku, kitClient:k.kit_client_name||'', kitSize:k.kit_size||'', kitWarehouseId:k.kit_warehouse_id||'MAIN', componentSku:k.component_sku, componentSize:k.component_size||'', qtyNeeded:Number(k.qty_needed)}));
}
function getKitComponents(item){
  return kitComponents.filter(k=>k.kitSku===item.sku && k.kitClient===(item.client||'') && k.kitSize===(item.size||'') && k.kitWarehouseId===(item.warehouseId||'MAIN'));
}
function computeKitAvailability(item){
  const comps = getKitComponents(item);
  if(!comps.length) return {available:0, bottleneck:null};
  let minAvail = Infinity, bottleneck = null;
  comps.forEach(c=>{
    const compItem = findInventoryItem(c.componentSku, item.client, c.componentSize, item.warehouseId);
    const compQty = compItem ? compItem.qty : 0;
    const possible = c.qtyNeeded>0 ? Math.floor(compQty / c.qtyNeeded) : 0;
    if(possible < minAvail){ minAvail = possible; bottleneck = {sku:c.componentSku, size:c.componentSize, name:compItem?compItem.name:c.componentSku, have:compQty, needPerKit:c.qtyNeeded}; }
  });
  return {available: minAvail===Infinity?0:minAvail, bottleneck};
}
async function saveKitComponents(item, rows){
  await sb.from('kit_components').delete()
    .eq('kit_sku', item.sku).eq('kit_client_name', item.client||'').eq('kit_size', item.size||'').eq('kit_warehouse_id', item.warehouseId||'MAIN');
  kitComponents = kitComponents.filter(k=>!(k.kitSku===item.sku && k.kitClient===(item.client||'') && k.kitSize===(item.size||'') && k.kitWarehouseId===(item.warehouseId||'MAIN')));
  if(!rows.length) return;
  const insertRows = rows.map(r=>({kit_sku:item.sku, kit_client_name:item.client||'', kit_size:item.size||'', kit_warehouse_id:item.warehouseId||'MAIN', component_sku:r.componentSku, component_size:r.componentSize||'', qty_needed:r.qtyNeeded}));
  const { error } = await sb.from('kit_components').insert(insertRows);
  if(error){ console.error(error); toast('Не удалось сохранить состав набора в базе'); return; }
  kitComponents.push(...rows.map(r=>({kitSku:item.sku, kitClient:item.client||'', kitSize:item.size||'', kitWarehouseId:item.warehouseId||'MAIN', componentSku:r.componentSku, componentSize:r.componentSize||'', qtyNeeded:r.qtyNeeded})));
}
// Списывает qty единиц товара при отгрузке — если это виртуальный набор, списывает составляющие вместо самого набора
function deductStockForShipment(item, qty, reasonText){
  if(item.isKit && item.kitMode==='virtual'){
    const comps = getKitComponents(item);
    comps.forEach(c=>{
      const compItem = findInventoryItem(c.componentSku, item.client, c.componentSize, item.warehouseId);
      if(!compItem) return;
      const deduct = c.qtyNeeded * qty;
      compItem.qty = Math.max(0, compItem.qty - deduct);
      logMovement(compItem.sku, compItem.name, -deduct, `${reasonText} (составляющая набора «${item.name}»)`, compItem.client, compItem.size);
      syncInventoryRow(compItem.sku, compItem.client, compItem.size, compItem.warehouseId);
    });
  } else {
    item.qty = Math.max(0, item.qty - qty);
    logMovement(item.sku, item.name, -qty, reasonText, item.client, item.size);
    syncInventoryRow(item.sku, item.client, item.size, item.warehouseId);
  }
}
function draftKitComponentRows(){
  return Array.from(document.querySelectorAll('.kit-component-row')).map(row=>({
    componentSku: row.dataset.sku,
    componentSize: row.dataset.size || '',
    qtyNeeded: Math.max(0.01, parseFloat(row.querySelector('.kit-comp-qty').value) || 1)
  }));
}
function addKitComponentRow(key, sku, size, name){
  const list = document.getElementById('kitComponentsList-'+key);
  if(!list) return;
  if(list.querySelector(`[data-sku="${CSS.escape(sku)}"][data-size="${CSS.escape(size||'')}"]`)){ toast('Эта позиция уже добавлена в состав'); return; }
  const row = document.createElement('div');
  row.className = 'kit-component-row';
  row.dataset.sku = sku;
  row.dataset.size = size || '';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:4px';
  row.innerHTML = `
    <span style="flex:1;font-size:12px">${escapeHtml(name)}${size?` (${size})`:''}</span>
    <input class="search mono kit-comp-qty" type="number" min="0.01" step="0.01" value="1" style="width:70px">
    <span style="font-size:11px;color:var(--ink-faint)">шт/набор</span>
    <button class="btn btn-ghost" style="padding:2px 8px" onclick="this.parentElement.remove()">✕</button>
  `;
  list.appendChild(row);
}
function addKitComponentFromSelect(key, clientName, warehouseId){
  const sel = document.getElementById('kitAddComponentSelect-'+key);
  const v = sel.value;
  if(!v) return;
  const [sku, size] = v.split('~~');
  const item = inventory.find(x=>x.sku===sku && (x.size||'')===size && x.client===clientName && (x.warehouseId||'MAIN')===warehouseId);
  addKitComponentRow(key, sku, size, item?item.name:sku);
  sel.value='';
}
function toggleKitEditor(key){
  const el = document.getElementById('kitEditor-'+key);
  if(el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}

// ---------- COMPANY SETTINGS (реквизиты исполнителя) ----------
async function loadCompanySettings(){
  const { data, error } = await sb.from('company_settings').select('*').eq('id','main').maybeSingle();
  if(error){ console.error(error); return; }
  if(data) companySettings = {
    name:data.name||'', inn:data.inn||'', kpp:data.kpp||'', legalAddress:data.legal_address||'',
    bankDetails:data.bank_details||'', directorName:data.director_name||''
  };
}
function getWarehouseInfo(){ return { name: companySettings.name || 'ТелеПак', inn: companySettings.inn || '' }; }
function editWarehouseInfo(){
  const win = window.open('', '_blank', 'width=480,height=560');
  if(!win){ toast('Браузер заблокировал открытие окна'); return; }
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Реквизиты организации</title>
    <style>
      body{font-family:Arial,sans-serif;padding:20px;color:#111}
      label{display:block;font-size:12px;color:#666;margin:12px 0 4px 0}
      input,textarea{width:100%;padding:8px;font-size:14px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;font-family:inherit}
      button{margin-top:18px;padding:10px 18px;background:#FF5B1F;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}
    </style></head><body>
      <h2>Реквизиты организации-исполнителя</h2>
      <p style="font-size:12px;color:#888">Используются в актах приёмки и УПД. Общие для всех сотрудников.</p>
      <label>Название организации</label><input id="fName" value="${escapeHtml(companySettings.name||'ТелеПак')}">
      <label>ИНН</label><input id="fInn" value="${escapeHtml(companySettings.inn||'')}">
      <label>КПП</label><input id="fKpp" value="${escapeHtml(companySettings.kpp||'')}">
      <label>Юридический адрес</label><input id="fAddr" value="${escapeHtml(companySettings.legalAddress||'')}">
      <label>Банковские реквизиты (р/с, банк, БИК, к/с)</label><textarea id="fBank" rows="3">${escapeHtml(companySettings.bankDetails||'')}</textarea>
      <label>ФИО руководителя</label><input id="fDir" value="${escapeHtml(companySettings.directorName||'')}">
      <button onclick="window.opener.saveCompanySettingsFromPopup(
        document.getElementById('fName').value,
        document.getElementById('fInn').value,
        document.getElementById('fKpp').value,
        document.getElementById('fAddr').value,
        document.getElementById('fBank').value,
        document.getElementById('fDir').value
      ); window.close();">Сохранить</button>
    </body></html>
  `);
  win.document.close();
}
function saveCompanySettingsFromPopup(name, inn, kpp, legalAddress, bankDetails, directorName){
  companySettings = { name, inn, kpp, legalAddress, bankDetails, directorName };
  toast('Реквизиты организации сохранены');
  sb.from('company_settings').upsert({id:'main', name, inn, kpp, legal_address:legalAddress, bank_details:bankDetails, director_name:directorName}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить реквизиты в базе'); }
  });
}

