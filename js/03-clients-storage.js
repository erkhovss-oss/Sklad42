// ---------- CLIENTS ----------
function openNewClientForm(){ showingNewClientForm = true; renderClients(); }
function closeNewClientForm(){ showingNewClientForm = false; renderClients(); }
function createClient(){
  const name = document.getElementById('newClientName').value.trim();
  const contact = document.getElementById('newClientContact').value.trim();
  if(!name){ toast('Укажите название клиента'); return; }
  const id = 'CL-' + Date.now();
  const finalContact = contact || '—';
  const newClient = {id, name, contact: finalContact, telegram:'', wbKey:'', wbConnected:false, wbProducts:[], storageLiters:0, pricePerLiter:3, receivingPricePerUnit:0, ozonClientId:'', ozonKey:'', ozonConnected:false, ozonWarehouseId:''};
  clients.push(newClient);
  showingNewClientForm = false;
  toast('Клиент добавлен');
  renderClients();
  sb.from('clients').insert({id, name, contact: finalContact, telegram:'', storage_liters:0, price_per_liter:3}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить клиента в базе'); }
  });
}
function openClient(id){ activeClientId = id; editingClientId = null; deletingClientId = null; renderClients(); }
function backToClients(){ activeClientId = null; editingClientId = null; deletingClientId = null; renderClients(); }
function computeClientStorageLiters(clientName){
  return inventory
    .filter(i => i.client === clientName && i.dims && i.dims.l && i.dims.w && i.dims.h)
    .reduce((sum, i) => sum + (i.dims.l * i.dims.w * i.dims.h / 1000) * i.qty, 0);
}
function startEditClient(id){ editingClientId = id; deletingClientId = null; renderClients(); }
function copyClientLink(id){
  const c = clients.find(x=>x.id===id);
  if(!c || !c.portalToken){ toast('У клиента нет токена для ссылки — обновите страницу и попробуйте снова'); return; }
  const url = window.location.origin + window.location.pathname + '?client=' + c.portalToken;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(()=>{
      toast('Ссылка скопирована — отправьте её клиенту');
    }).catch(()=>{
      prompt('Скопируйте ссылку вручную:', url);
    });
  } else {
    prompt('Скопируйте ссылку вручную:', url);
  }
}
function cancelEditClient(){ editingClientId = null; renderClients(); }
function saveClientInfo(id){
  const c = clients.find(x=>x.id===id);
  const name = document.getElementById('editClientName-'+id).value.trim();
  const phone = document.getElementById('editClientPhone-'+id).value.trim();
  const telegram = document.getElementById('editClientTelegram-'+id).value.trim();
  if(!name){ toast('Название не может быть пустым'); return; }
  const oldName = c.name;
  c.name = name;
  c.contact = phone || '—';
  c.telegram = telegram;
  editingClientId = null;
  toast('Данные клиента сохранены');
  renderClients();
  if(oldName !== name){
    inventory.forEach(i=>{ if(i.client===oldName) i.client = name; });
    supplies.forEach(s=>{ if(s.clientName===oldName) s.clientName = name; });
    sb.from('inventory').update({client_name:name}).eq('client_name', oldName).then(({error})=>{ if(error) console.error(error); });
    sb.from('supplies').update({client_name:name}).eq('client_name', oldName).then(({error})=>{ if(error) console.error(error); });
  }
  sb.from('clients').update({name, contact: c.contact, telegram: c.telegram}).eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
function openDeleteClient(id){ deletingClientId = id; editingClientId = null; renderClients(); }
function cancelDeleteClient(){ deletingClientId = null; renderClients(); }
async function confirmDeleteClient(id){
  const c = clients.find(x=>x.id===id);
  if(!c) return;
  const affected = inventory.filter(i=>i.client===c.name).length;
  const { error } = await sb.from('clients').delete().eq('id', id);
  if(error){
    console.error(error);
    toast('Не удалось удалить: сначала уберём связанные записи…');
    await sb.from('storage_history').delete().eq('client_id', id);
    await sb.from('supplies').update({client_id:null}).eq('client_id', id);
    const retry = await sb.from('clients').delete().eq('id', id);
    if(retry.error){ console.error(retry.error); toast('Не удалось удалить клиента в базе'); return; }
  }
  await sb.from('inventory').update({client_name:''}).eq('client_name', c.name);
  inventory.forEach(i=>{ if(i.client===c.name) i.client = ''; });
  supplies.forEach(s=>{ if(s.clientId===id) s.clientId = null; });
  storageHistoryRows = storageHistoryRows.filter(r=>r.client_id!==id);
  clients = clients.filter(x=>x.id!==id);
  deletingClientId = null;
  activeClientId = null;
  toast(`Клиент «${c.name}» удалён${affected ? `, ${affected} товарных позиций остались на складе без привязки к клиенту` : ''}`);
  renderClients();
}
function saveClientLegalInfo(clientId){
  const c = clients.find(x=>x.id===clientId);
  if(!c) return;
  const inn = document.getElementById('clientInn-'+clientId).value.trim();
  const kpp = document.getElementById('clientKpp-'+clientId).value.trim();
  const legalAddress = document.getElementById('clientLegalAddress-'+clientId).value.trim();
  const bankDetails = document.getElementById('clientBankDetails-'+clientId).value.trim();
  const directorName = document.getElementById('clientDirectorName-'+clientId).value.trim();
  c.inn = inn; c.kpp = kpp; c.legalAddress = legalAddress; c.bankDetails = bankDetails; c.directorName = directorName;
  toast('Реквизиты клиента сохранены');
  sb.from('clients').update({inn, kpp, legal_address:legalAddress, bank_details:bankDetails, director_name:directorName}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить реквизиты в базе'); }
  });
}
function saveTariff(clientId){
  const c = clients.find(x=>x.id===clientId);
  const price = Math.max(0, parseFloat(document.getElementById('tariffPrice-'+clientId).value) || 0);
  c.pricePerLiter = price;
  toast('Цена хранения сохранена');
  renderClients();
  sb.from('clients').update({price_per_liter: price}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить цену в базе'); }
  });
  recordStorageSnapshot(c);
}
function saveReceivingTariff(clientId){
  const c = clients.find(x=>x.id===clientId);
  const price = Math.max(0, parseFloat(document.getElementById('receivingTariffPrice-'+clientId).value) || 0);
  c.receivingPricePerUnit = price;
  toast('Цена приёмки сохранена');
  renderClients();
  sb.from('clients').update({receiving_price_per_unit: price}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить цену в базе'); }
  });
}
async function loadFbsTariffs(){
  const { data, error } = await sb.from('fbs_tariffs').select('*').order('max_liters').limit(50000);
  if(error){ console.error(error); return; }
  fbsTariffs = data.map(t=>({id:t.id, clientId:t.client_id, maxLiters:Number(t.max_liters), price:Number(t.price)}));
}
function addFbsTariff(clientId){
  const litersInput = document.getElementById('newTariffLiters-'+clientId);
  const priceInput = document.getElementById('newTariffPrice-'+clientId);
  const maxLiters = parseFloat(litersInput.value);
  const price = parseFloat(priceInput.value);
  if(!maxLiters || maxLiters<=0){ toast('Укажите объём (до скольки литров)'); return; }
  if(price===undefined || isNaN(price) || price<0){ toast('Укажите цену'); return; }
  if(fbsTariffs.find(t=>t.clientId===clientId && t.maxLiters===maxLiters)){
    toast('Такая ступень уже есть — удалите её сначала, если нужно изменить цену');
    return;
  }
  sb.from('fbs_tariffs').insert({client_id:clientId, max_liters:maxLiters, price}).select().single().then(({data, error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить тариф в базе'); return; }
    fbsTariffs.push({id:data.id, clientId, maxLiters, price});
    toast('Ступень тарифа добавлена');
    renderClients();
  });
}
function removeFbsTariff(id){
  fbsTariffs = fbsTariffs.filter(t=>t.id!==id);
  renderClients();
  sb.from('fbs_tariffs').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить тариф в базе'); }
  });
}
function getFbsTariffPrice(clientId, liters){
  const tiers = fbsTariffs.filter(t=>t.clientId===clientId).sort((a,b)=>a.maxLiters-b.maxLiters);
  if(!tiers.length) return null;
  const tier = tiers.find(t=>liters <= t.maxLiters);
  return tier ? tier.price : tiers[tiers.length-1].price;
}
async function upsertStorageSnapshot(clientId, day, liters, cost){
  const { data: existing, error: selErr } = await sb.from('storage_history').select('id').eq('client_id', clientId).eq('day', day).limit(1);
  if(selErr){ console.error(selErr); return; }
  if(existing && existing.length){
    const { error } = await sb.from('storage_history').update({liters, cost}).eq('id', existing[0].id);
    if(error) console.error(error);
  } else {
    const { error } = await sb.from('storage_history').insert({client_id: clientId, day, liters, cost});
    if(error) console.error(error);
  }
}
async function recordStorageSnapshot(client){
  const today = new Date().toISOString().slice(0,10);
  const liters = computeClientStorageLiters(client.name);
  const cost = liters * client.pricePerLiter;
  await upsertStorageSnapshot(client.id, today, liters, cost);
  await loadStorageHistory();
  if(document.getElementById('tab-storage').classList.contains('active')) renderStorage();
}
async function recordAllStorageSnapshots(){
  const today = new Date().toISOString().slice(0,10);
  for(const c of clients){
    const liters = computeClientStorageLiters(c.name);
    const cost = liters * c.pricePerLiter;
    await upsertStorageSnapshot(c.id, today, liters, cost);
  }
  await loadStorageHistory();
}



function connectWb(clientId){
  const client = clients.find(c=>c.id===clientId);
  const key = document.getElementById('wbKeyInput-'+clientId).value.trim();
  if(!key){ toast('Вставьте API-ключ'); return; }
  client.wbKey = key;
  client.wbConnected = true;
  toast('Ключ сохранён (демо-режим)');
  renderClients();
  sb.from('clients').update({wb_key:key, wb_connected:true}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить ключ в базе'); }
  });
}
function disconnectWb(clientId){
  const client = clients.find(c=>c.id===clientId);
  client.wbConnected = false;
  client.wbKey = '';
  client.wbProducts = [];
  toast('Ключ удалён');
  renderClients();
  sb.from('clients').update({wb_key:'', wb_connected:false}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
function saveWbWarehouseId(clientId){
  const c = clients.find(x=>x.id===clientId);
  const val = document.getElementById('wbWarehouseId-'+clientId).value.trim();
  c.wbWarehouseId = val;
  c.wbAutoSync = false;
  toast('ID склада сохранён. Автосинхронизация выключена — включите её отдельно, когда будете готовы');
  renderClients();
  sb.from('clients').update({wb_warehouse_id: val, wb_auto_sync: false}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить ID склада в базе'); }
  });
}
function connectOzon(clientId){
  const client = clients.find(c=>c.id===clientId);
  const ozonClientId = document.getElementById('ozonClientIdInput-'+clientId).value.trim();
  const key = document.getElementById('ozonKeyInput-'+clientId).value.trim();
  if(!ozonClientId || !key){ toast('Укажите Client-Id и API-ключ'); return; }
  client.ozonClientId = ozonClientId;
  client.ozonKey = key;
  client.ozonConnected = true;
  toast('Ключ Ozon сохранён');
  renderClients();
  sb.from('clients').update({ozon_client_id: ozonClientId, ozon_key: key, ozon_connected: true}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить ключ в базе'); }
  });
}
function disconnectOzon(clientId){
  const client = clients.find(c=>c.id===clientId);
  client.ozonConnected = false;
  client.ozonClientId = '';
  client.ozonKey = '';
  toast('Ключ Ozon удалён');
  renderClients();
  sb.from('clients').update({ozon_client_id:'', ozon_key:'', ozon_connected:false}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
function saveOzonWarehouseId(clientId){
  const c = clients.find(x=>x.id===clientId);
  const val = document.getElementById('ozonWarehouseId-'+clientId).value.trim();
  c.ozonWarehouseId = val;
  toast('ID склада Ozon сохранён');
  renderClients();
  sb.from('clients').update({ozon_warehouse_id: val}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить ID склада в базе'); }
  });
}
async function listOzonWarehouses(clientId){
  toast('Запрашиваем список складов у Ozon…');
  try{
    const { data, error } = await sb.functions.invoke('ozon-orders-ts', { body: { clientId, action: 'list_warehouses' } });
    if(error){ toast('Ozon: ' + await extractFnErrorMessage(error)); return; }
    if(data && data.error){ toast('Ozon: ' + data.error); return; }
    const c = clients.find(x=>x.id===clientId);
    c.ozonWarehousesList = data.warehouses || [];
    if(!c.ozonWarehousesList.length){ toast('У продавца пока нет складов FBS на Ozon'); return; }
    toast(`Найдено складов: ${c.ozonWarehousesList.length} — выберите нужный ниже`);
    renderClients();
  }catch(e){
    toast('Не удалось вызвать серверную функцию — она ещё не развёрнута в Supabase?');
  }
}
function useOzonWarehouseFromList(clientId){
  const c = clients.find(x=>x.id===clientId);
  const select = document.getElementById('ozonWarehousePicker-'+clientId);
  if(!select || !select.value) return;
  document.getElementById('ozonWarehouseId-'+clientId).value = select.value;
  saveOzonWarehouseId(clientId);
}
function toggleWbAutoSync(clientId){
  const c = clients.find(x=>x.id===clientId);
  c.wbAutoSync = !c.wbAutoSync;
  toast(c.wbAutoSync ? 'Автосинхронизация включена' : 'Автосинхронизация выключена');
  renderClients();
  sb.from('clients').update({wb_auto_sync: c.wbAutoSync}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
async function setStockAllocationMode(clientId, mode){
  const c = clients.find(x=>x.id===clientId);
  if(!c || c.stockAllocationMode===mode) return;
  if(mode==='split' && !await customConfirm('При переключении на «Раздельно» WB и Ozon начнут видеть только то, что явно выделено под каждую площадку в «Остатках» — если ничего не выделить, обе площадки увидят 0. Продолжить?')) return;
  c.stockAllocationMode = mode;
  toast(mode==='split' ? 'Включено раздельное распределение по площадкам' : 'Включён общий остаток на все площадки');
  renderClients();
  sb.from('clients').update({stock_allocation_mode: mode}).eq('id', clientId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
async function extractFnErrorMessage(error){
  if(error && error.context && typeof error.context.json === 'function'){
    try{
      const body = await error.context.json();
      if(body && body.error) return body.error;
    }catch(e){}
  }
  return error ? error.message : 'неизвестная ошибка';
}
async function listWbWarehouses(clientId){
  toast('Запрашиваем список складов у Wildberries…');
  try{
    const { data, error } = await sb.functions.invoke('wb-sync-stocks-ts', { body: { clientId, action: 'list_warehouses' } });
    if(error){ toast('WB: ' + await extractFnErrorMessage(error)); return; }
    if(data && data.error){ toast('WB: ' + data.error); return; }
    const c = clients.find(x=>x.id===clientId);
    c.wbWarehousesList = data.warehouses || [];
    if(!c.wbWarehousesList.length){ toast('У продавца пока нет складов на WB — создайте склад в личном кабинете'); return; }
    toast(`Найдено складов: ${c.wbWarehousesList.length} — выберите нужный ниже`);
    renderClients();
  }catch(e){
    toast('Не удалось вызвать серверную функцию — она ещё не развёрнута в Supabase?');
  }
}
function useWbWarehouseFromList(clientId){
  const c = clients.find(x=>x.id===clientId);
  const select = document.getElementById('wbWarehousePicker-'+clientId);
  if(!select || !select.value) return;
  document.getElementById('wbWarehouseId-'+clientId).value = select.value;
  saveWbWarehouseId(clientId);
}
function withButtonLoading(btn, loadingText, fn){
  if(!btn) return fn();
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.dataset.loading = '1';
  btn.innerHTML = loadingText;
  return Promise.resolve(fn()).finally(()=>{
    btn.disabled = false;
    delete btn.dataset.loading;
    btn.innerHTML = original;
  });
}
async function pushStocksToWb(clientId){
  const btn = typeof event!=='undefined' && event ? event.target.closest('button') : null;
  await withButtonLoading(btn, '⏳ Отправляю…', async ()=>{
    toast('Отправляем остатки на Wildberries…');
    const c = clients.find(x=>x.id===clientId);
    try{
      const { data, error } = await sb.functions.invoke('wb-sync-stocks-ts', { body: { clientId, action: 'push_stocks' } });
      if(error){ toast('WB: ' + await extractFnErrorMessage(error)); return; }
      if(data && data.error){ if(c){ c.wbLastSyncError = data.error; renderClients(); } toast('WB: ' + data.error); return; }
      if(c){ c.wbLastSyncedAt = new Date().toISOString(); c.wbLastSyncError = null; renderClients(); }
      toast(`Отправлено на WB: ${data.sent} поз.${data.skipped ? `, пропущено без штрихкода: ${data.skipped}` : ''}`);
    }catch(e){
      toast('Не удалось вызвать серверную функцию — она ещё не развёрнута в Supabase?');
    }
  });
}
async function pushStocksToOzon(clientId){
  const btn = typeof event!=='undefined' && event ? event.target.closest('button') : null;
  await withButtonLoading(btn, '⏳ Отправляю…', async ()=>{
    toast('Отправляем остатки на Ozon…');
    const c = clients.find(x=>x.id===clientId);
    try{
      const { data, error } = await sb.functions.invoke('ozon-orders-ts', { body: { clientId, action: 'push_stocks' } });
      if(error){ toast('Ozon: ' + await extractFnErrorMessage(error)); return; }
      if(data && data.error){ if(c){ c.ozonLastSyncError = data.error; renderClients(); } toast('Ozon: ' + data.error); return; }
      if(c){ c.ozonLastSyncedAt = new Date().toISOString(); c.ozonLastSyncError = null; renderClients(); }
      toast(`Отправлено на Ozon: ${data.sent} поз.${data.failed ? `, не обновилось: ${data.failed}` : ''}`);
    }catch(e){
      toast('Не удалось вызвать серверную функцию — она ещё не развёрнута в Supabase?');
    }
  });
}
async function loadWbProducts(clientId){
  const client = clients.find(c=>c.id===clientId);
  toast('Запрашиваем карточки товаров у Wildberries…');
  try{
    const { data, error } = await sb.functions.invoke('wb-sync-stocks-ts', { body: { clientId, action: 'list_cards' } });
    if(error){ toast('WB: ' + await extractFnErrorMessage(error)); return; }
    if(data && data.error){ toast('WB: ' + data.error); return; }
    const cards = data.cards || [];
    const products = [];
    cards.forEach(c=>{
      const dims = (c.dimensions && c.dimensions.isValid && (c.dimensions.length||c.dimensions.width||c.dimensions.height))
        ? {l:c.dimensions.length, w:c.dimensions.width, h:c.dimensions.height, weight:c.dimensions.weightBrutto||0}
        : null;
      const colorChar = (c.characteristics || []).find(ch => ch.name && ch.name.toLowerCase().includes('цвет'));
      const color = colorChar ? (Array.isArray(colorChar.value) ? colorChar.value.join(', ') : String(colorChar.value)) : '';
      const sizes = (c.sizes && c.sizes.length) ? c.sizes : [{techSize:'', skus:[]}];
      sizes.forEach(s=>{
        products.push({
          nmId: c.nmID,
          name: c.title || c.vendorCode,
          vendorCode: c.vendorCode,
          size: s.techSize || '',
          barcode: (s.skus && s.skus[0]) || '',
          barcodes: (s.skus || []).filter(Boolean).map(String), // у размера в WB может быть несколько штрихкодов
          color,
          dims
        });
      });
    });
    client.wbProducts = products;
    const pending = planWbBarcodeSync(client);
    const newCodes = pending.setMain.length + pending.addExtras.length;
    toast(`Получено карточек: ${cards.length} (позиций с учётом размеров: ${products.length})${newCodes ? ` · новых штрихкодов у существующих товаров: ${newCodes} — нажмите «Обновить штрихкоды»` : ''}`);
    renderClients();
    return true;
  }catch(e){
    toast('Не удалось вызвать серверную функцию — она развёрнута в Supabase?');
    return false;
  }
}

// ---------- штрихкоды из карточек WB: добавление недостающих к существующим товарам ----------
// Раньше из карточки брался только первый штрихкод, а уже существующие товары не обновлялись вовсе —
// поэтому новые штрихкода, добавленные клиентом в личном кабинете WB, в системе не появлялись.
function wbSizeKey(s){ const v = String(s||''); return v==='0' ? '' : v; } // у товаров без размера WB подставляет «0»
// Ищет наш товар по артикулу и размеру, терпимо к регистру и к «0»/пусто у товаров без размера
function findInventoryItemForWb(sku, clientName, size){
  const exact = findInventoryItem(sku, clientName, size);
  if(exact) return exact;
  const up = String(sku||'').toUpperCase(), sz = wbSizeKey(size);
  return inventory.find(i=>(i.client||'')===(clientName||'') && String(i.sku||'').toUpperCase()===up && wbSizeKey(i.size)===sz) || null;
}
// Все штрихкоды товара у нас: основной + дополнительные
function itemAllBarcodes(item){
  const set = new Set();
  if(item.barcode) set.add(String(item.barcode));
  inventoryBarcodes.forEach(b=>{
    if(b.sku===item.sku && (b.clientName||'')===(item.client||'') && (b.size||'')===(item.size||'')) set.add(String(b.barcode));
  });
  return set;
}
// Что нужно изменить, чтобы штрихкоды у нас совпали с карточками WB (ничего не меняет, только считает):
//  setMain   — у товара не было штрихкода вообще: проставить основной
//  addExtras — у товара есть штрихкод, а в WB добавили ещё: добавить как дополнительные
//  conflicts — штрихкод из WB уже числится у ДРУГОГО товара этого клиента: не трогаем, показываем
function planWbBarcodeSync(client){
  const plan = {setMain:[], addExtras:[], conflicts:[], unmatched:0};
  const seen = new Set();
  (client.wbProducts||[]).forEach(p=>{
    const codes = (p.barcodes && p.barcodes.length ? p.barcodes : (p.barcode ? [p.barcode] : [])).map(String);
    if(!codes.length) return;
    const item = findInventoryItemForWb(p.vendorCode || ('WB-'+p.nmId), client.name, p.size||'');
    if(!item){ plan.unmatched++; return; }
    const have = itemAllBarcodes(item);
    let hasMain = !!item.barcode;
    codes.forEach(b=>{
      if(have.has(b) || seen.has(b)) return;
      const owner = findInventoryItemByBarcode(b, client.name);
      if(owner){
        if(!(owner.sku===item.sku && (owner.size||'')===(item.size||''))) plan.conflicts.push({barcode:b, product:p, owner});
        return;
      }
      seen.add(b);
      if(!hasMain){ plan.setMain.push({item, barcode:b, product:p}); hasMain = true; }
      else plan.addExtras.push({item, barcode:b, product:p});
    });
  });
  return plan;
}
function closeWbBarcodePreview(){ const o = document.getElementById('wbBarcodeOverlay'); if(o) o.remove(); }
// Кнопка «Обновить штрихкоды»: при необходимости сама подгружает карточки, затем показывает, что изменится
async function syncWbBarcodes(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  const btn = typeof event!=='undefined' && event && event.target ? event.target.closest('button') : null;
  await withButtonLoading(btn, '⏳ Запрашиваю WB…', async ()=>{
    const ok = await loadWbProducts(clientId);
    if(ok===false) return;
    openWbBarcodePreview(clientId);
  });
}
function openWbBarcodePreview(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  const plan = planWbBarcodeSync(client);
  const total = plan.setMain.length + plan.addExtras.length;
  if(!total && !plan.conflicts.length){
    toast(`Все штрихкоды из WB уже есть в системе${plan.unmatched ? ` (карточек WB без товара в остатках: ${plan.unmatched} — они добавляются кнопкой «Добавить в остатки»)` : ''}`);
    return;
  }
  closeWbBarcodePreview();
  const byItem = new Map();
  [...plan.setMain, ...plan.addExtras].forEach(x=>{
    const k = x.item.sku+'~~'+(x.item.size||'');
    if(!byItem.has(k)) byItem.set(k, {item:x.item, codes:[], main:false});
    const g = byItem.get(k); g.codes.push(x.barcode); if(plan.setMain.includes(x)) g.main = true;
  });
  const groups = [...byItem.values()];
  const shown = groups.slice(0, 40);
  const overlay = document.createElement('div');
  overlay.id = 'wbBarcodeOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:22px;max-width:680px;width:100%;max-height:90vh;display:flex;flex-direction:column">
      <h3 style="margin:0 0 6px 0;font-size:18px">Обновление штрихкодов из WB</h3>
      <p style="font-size:13px;color:var(--ink-soft);line-height:1.6;margin:0 0 12px 0">
        ${client.name}: ${total ? `будет добавлено штрихкодов — <b>${total}</b> (у товаров: <b>${groups.length}</b>)${plan.setMain.length ? `, из них основным у ${plan.setMain.length} товаров, где штрихкода не было` : ''}.` : 'добавлять нечего.'}
        Названия, габариты и остатки не меняются. Существующие штрихкоды не удаляются.
      </p>
      <div style="overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:4px 12px;margin-bottom:12px;flex:1;min-height:60px">
        ${shown.map(g=>`
          <div style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div style="font-size:13px;font-weight:600">${escapeHtml(g.item.name||g.item.sku)}${g.item.size?` · ${escapeHtml(g.item.size)}`:''} <span class="mono" style="font-weight:400;font-size:11px;color:var(--ink-faint)">${escapeHtml(g.item.sku)}</span></div>
            <div class="mono" style="font-size:11px;color:var(--ok)">＋ ${g.codes.map(escapeHtml).join(' · ')}${g.main ? ' (основной)' : ''}</div>
          </div>`).join('')}
        ${groups.length>shown.length ? `<div style="padding:8px 0;font-size:12px;color:var(--ink-faint)">…и ещё ${groups.length-shown.length} товаров</div>` : ''}
        ${plan.conflicts.length ? `
          <div style="padding:10px 0 6px 0;font-size:12px;font-weight:700;color:var(--warn)">Не будут добавлены (штрихкод уже числится за другим товаром): ${plan.conflicts.length}</div>
          ${plan.conflicts.slice(0,15).map(x=>`<div style="padding:4px 0;font-size:12px;color:var(--ink-soft)"><span class="mono">${escapeHtml(x.barcode)}</span> — карточка «${escapeHtml(x.product.name||x.product.vendorCode)}», в системе занят товаром «${escapeHtml(x.owner.name||x.owner.sku)}»</div>`).join('')}` : ''}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="closeWbBarcodePreview()">${total?'Отмена':'Закрыть'}</button>
        ${total ? `<button class="btn btn-accent" id="wbBarcodeApplyBtn" onclick="applyWbBarcodeSync('${client.id}')">Применить (${total})</button>` : ''}
      </div>
    </div>`;
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeWbBarcodePreview(); });
  document.body.appendChild(overlay);
}
async function applyWbBarcodeSync(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  const plan = planWbBarcodeSync(client); // пересчитываем заново — пока окно было открыто, данные могли измениться
  const total = plan.setMain.length + plan.addExtras.length;
  const applyBtn = document.getElementById('wbBarcodeApplyBtn');
  if(applyBtn){ applyBtn.disabled = true; applyBtn.textContent = '⏳ Сохраняю…'; }
  if(!total){ closeWbBarcodePreview(); toast('Менять нечего — всё уже обновлено'); return; }
  let mainSet = 0, extrasAdded = 0, failed = 0;
  for(const m of plan.setMain){
    const rows = inventory.filter(i=>(i.client||'')===(m.item.client||'') && i.sku===m.item.sku && (i.size||'')===(m.item.size||''));
    rows.forEach(r=>{ r.barcode = m.barcode; });
    for(const r of rows) await syncInventoryRow(r.sku, r.client, r.size, r.warehouseId);
    mainSet++;
  }
  const toInsert = plan.addExtras.map(e=>({barcode:e.barcode, sku:e.item.sku, client_name:e.item.client||'', size:e.item.size||''}));
  for(let i=0;i<toInsert.length;i+=200){
    const chunk = toInsert.slice(i,i+200);
    const { error } = await sb.from('inventory_barcodes').upsert(chunk, {onConflict:'barcode,client_name', ignoreDuplicates:true});
    if(error){ console.error(error); failed += chunk.length; continue; }
    chunk.forEach(r=>{
      if(!inventoryBarcodes.some(b=>b.barcode===r.barcode && (b.clientName||'')===r.client_name)){
        inventoryBarcodes.push({barcode:r.barcode, sku:r.sku, clientName:r.client_name, size:r.size});
      }
    });
    extrasAdded += chunk.length;
  }
  closeWbBarcodePreview();
  toast(`Штрихкоды обновлены: проставлено основных ${mainSet}, добавлено дополнительных ${extrasAdded}${failed ? ` · не сохранилось: ${failed} — повторите` : ''}`);
  renderClients();
  renderInventory();
}
// Для только что добавленного из WB товара — сразу записываем и все его дополнительные штрихкоды
async function registerExtraBarcodesForNew(item, barcodes){
  const extras = (barcodes||[]).map(String).filter(b=>b && b!==String(item.barcode||''));
  const rows = [];
  extras.forEach(b=>{
    const owner = findInventoryItemByBarcode(b, item.client);
    if(owner && !(owner.sku===item.sku && (owner.size||'')===(item.size||''))) return; // занят другим товаром
    if(inventoryBarcodes.some(x=>x.barcode===b && (x.clientName||'')===(item.client||''))) return;
    rows.push({barcode:b, sku:item.sku, client_name:item.client||'', size:item.size||''});
  });
  if(!rows.length) return;
  const { error } = await sb.from('inventory_barcodes').upsert(rows, {onConflict:'barcode,client_name', ignoreDuplicates:true});
  if(error){ console.error(error); return; }
  rows.forEach(r=>inventoryBarcodes.push({barcode:r.barcode, sku:r.sku, clientName:r.client_name, size:r.size}));
}
async function addWbProductToInventory(clientId, nmId, size){
  const client = clients.find(c=>c.id===clientId);
  size = size || '';
  const p = client.wbProducts.find(x=>x.nmId===nmId && (x.size||'')===size);
  if(!p) return;
  const sku = p.vendorCode || ('WB-' + p.nmId);
  if(findInventoryItemForWb(sku, client.name, size)){ toast('Уже добавлено в остатки'); return; }
  const newItem = {
    sku, name:p.name, qty:0, client:client.name, size,
    vendorCode:p.vendorCode, barcode:p.barcode||'', dims:p.dims, color:p.color||''
  };
  inventory.push(newItem);
  const cell = await ensureCellAssigned(newItem);
  syncInventoryRow(newItem.sku, newItem.client, newItem.size);
  await registerExtraBarcodesForNew(newItem, p.barcodes);
  toast(`«${p.name}»${size?` (${size})`:''} добавлен в остатки (0 шт, ячейка ${cell} — укажите количество)`);
  renderClients();
}
async function addWbProductsBatch(clientId, products){
  const client = clients.find(c=>c.id===clientId);
  if(!client || !products.length) return;
  let added = 0;
  for(const p of products){
    const size = p.size || '';
    const sku = p.vendorCode || ('WB-' + p.nmId);
    if(findInventoryItemForWb(sku, client.name, size)) continue;
    const newItem = { sku, name:p.name, qty:0, client:client.name, size, vendorCode:p.vendorCode, barcode:p.barcode||'', dims:p.dims, color:p.color||'' };
    inventory.push(newItem);
    await ensureCellAssigned(newItem);
    syncInventoryRow(newItem.sku, newItem.client, newItem.size);
    await registerExtraBarcodesForNew(newItem, p.barcodes);
    added++;
  }
  toast(`Добавлено в остатки: ${added} поз. (0 шт — укажите количество)`);
  renderClients();
}
function addAllWbProducts(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  const toAdd = client.wbProducts.filter(p=>!findInventoryItemForWb(p.vendorCode || ('WB-'+p.nmId), client.name, p.size||''));
  if(!toAdd.length){ toast('Все карточки уже в остатках'); return; }
  addWbProductsBatch(clientId, toAdd);
}
function addSelectedWbProducts(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  const checks = document.querySelectorAll(`.wb-product-check[data-client="${clientId}"]:checked`);
  if(!checks.length){ toast('Отметьте галочками, что добавить'); return; }
  const selectedKeys = Array.from(checks).map(el=>el.dataset.key);
  const toAdd = client.wbProducts.filter(p=>selectedKeys.includes(p.nmId+'~~'+(p.size||'')));
  addWbProductsBatch(clientId, toAdd);
}

function renderClients(){
  const body = document.getElementById('clientsBody');
  document.getElementById('newClientBtn').style.display = activeClientId ? 'none' : 'inline-flex';
  if(activeClientId) renderClientDetail(body);
  else renderClientsList(body);
}
function renderClientsList(body){
  const formHtml = showingNewClientForm ? `
    <div class="panel" style="padding:18px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:10px">Новый клиент</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <input class="search" id="newClientName" placeholder="Название / ФИО, напр. ИП Иванов И.И." style="flex:1;min-width:220px">
        <input class="search" id="newClientContact" placeholder="Телефон или email" style="width:220px">
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-primary" onclick="createClient()">Создать</button>
        <button class="btn btn-ghost" onclick="closeNewClientForm()">Отмена</button>
      </div>
    </div>
  ` : '';

  const cardsHtml = clients.length ? clients.map(c=>{
    const skus = inventory.filter(i=>i.client===c.name);
    const totalQty = skus.reduce((s,i)=>s+i.qty,0);
    const liters = computeClientStorageLiters(c.name);
    return `
      <div class="order-card" onclick="openClient('${c.id}')">
        <div>
          <div class="oid">${c.name}</div>
          <div class="meta">${c.contact} · ${skus.length} товарных позиций · ${totalQty} шт · ${liters.toFixed(1)} л хранения · ${(liters*c.pricePerLiter).toFixed(0)} ₽/сутки</div>
        </div>
        ${c.wbConnected
          ? `<span class="chip wb" style="margin-left:auto"><span class="dot"></span>WB подключён</span>`
          : `<span style="margin-left:auto;font-size:12px;color:var(--ink-faint)">WB не подключён</span>`}
      </div>
    `;
  }).join('') : `<div class="panel empty"><span class="eyebrow">Пока нет клиентов</span>Нажмите «+ Новый клиент», чтобы добавить первого</div>`;

  body.innerHTML = formHtml + cardsHtml;
}
function renderClientDetail(body){
  const c = clients.find(x=>x.id===activeClientId);
  if(!c){ activeClientId = null; renderClientsList(body); return; }
  const skus = inventory.filter(i=>i.client===c.name);
  const totalQty = skus.reduce((s,i)=>s+i.qty,0);
  const withoutDims = skus.filter(i=>i.qty>0 && !(i.dims && i.dims.l && i.dims.w && i.dims.h)).length;
  const liters = computeClientStorageLiters(c.name);
  const isEditing = editingClientId === c.id;
  const isDeleting = deletingClientId === c.id;

  const topPanelHtml = isEditing ? `
    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:10px">Изменить клиента</div>
      <input class="search" id="editClientName-${c.id}" value="${c.name}" placeholder="Название / ФИО" style="width:100%;margin-bottom:10px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <input class="search" id="editClientPhone-${c.id}" value="${c.contact==='—'?'':c.contact}" placeholder="Телефон" style="width:220px">
        <input class="search" id="editClientTelegram-${c.id}" value="${c.telegram||''}" placeholder="Telegram, напр. @username" style="width:220px">
      </div>
      <button class="btn btn-primary" onclick="saveClientInfo('${c.id}')">Сохранить</button>
      <button class="btn btn-ghost" onclick="cancelEditClient()">Отмена</button>
    </div>
  ` : `
    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div class="eyebrow">Клиент</div>
          <h2 style="font-size:24px;margin-top:4px">${c.name}</h2>
          <div style="color:var(--ink-soft);font-size:13px;margin-top:4px">
            ${c.contact && c.contact!=='—' ? `📞 ${c.contact}` : ''}
            ${c.telegram ? `${c.contact && c.contact!=='—' ? ' · ' : ''}✈️ ${c.telegram}` : ''}
            ${(!c.contact || c.contact==='—') && !c.telegram ? 'Контакты не указаны' : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="copyClientLink('${c.id}')">🔗 Ссылка для клиента</button>
          <button class="btn btn-ghost" onclick="startEditClient('${c.id}')">Изменить</button>
          <button class="btn btn-ghost" style="color:var(--warn)" onclick="openDeleteClient('${c.id}')">Удалить</button>
        </div>
      </div>
      ${isDeleting ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--warn)">Удалить клиента «${c.name}»?${skus.length ? ` Его товары (${skus.length} поз.) останутся на складе без привязки к клиенту.` : ''} Отменить нельзя.</span>
          <div style="white-space:nowrap">
            <button class="btn btn-accent" onclick="confirmDeleteClient('${c.id}')">Да, удалить</button>
            <button class="btn btn-ghost" onclick="cancelDeleteClient()">Отмена</button>
          </div>
        </div>
      ` : ''}
      <div class="stat-row" style="margin-top:16px">
        <div class="stat"><div class="val">${skus.length}</div><div class="lbl">Позиций на складе</div></div>
        <div class="stat"><div class="val">${totalQty}</div><div class="lbl">Единиц товара</div></div>
      </div>
    </div>
  `;

  body.innerHTML = `
    <button class="btn btn-ghost" style="margin-bottom:16px" onclick="backToClients()">← Все клиенты</button>

    ${topPanelHtml}

    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:4px">Тарификация</div>
      <h3 style="font-size:18px;margin-bottom:12px">Хранение на складе</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 14px 0">Объём считается автоматически: габариты каждого товара × его количество в остатках. Указать габариты можно в «Остатки» → «Изменить».</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <div class="eyebrow" style="margin-bottom:6px">Объём сейчас, л</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:600;padding:10px 0">${liters.toFixed(2)} л</div>
        </div>
        <div>
          <div class="eyebrow" style="margin-bottom:6px">Цена за литр, ₽/сутки</div>
          <input class="search mono" id="tariffPrice-${c.id}" type="number" min="0" step="0.1" value="${c.pricePerLiter}" style="width:150px">
        </div>
        <button class="btn btn-primary" onclick="saveTariff('${c.id}')">Сохранить цену</button>
      </div>
      ${withoutDims ? `<p style="font-size:12px;color:var(--warn);margin-top:12px">⚠ У ${withoutDims} товарных позиций не указаны габариты — они не учтены в объёме выше</p>` : ''}
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line);display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
        <span style="font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:700">${(liters*c.pricePerLiter).toFixed(2)} ₽</span>
        <span style="font-size:12px;color:var(--ink-soft)">в сутки, при текущем объёме</span>
      </div>
      <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">
        <h3 style="font-size:16px;margin-bottom:10px">Приёмка</h3>
        <p style="font-size:12px;color:var(--ink-soft);margin:0 0 12px 0">Списывается автоматически при приёмке поставки от этого клиента — приходует в ДДС как «Приёмка». 0 = не тарифицируется.</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
          <div>
            <div class="eyebrow" style="margin-bottom:6px">Цена за единицу, ₽</div>
            <input class="search mono" id="receivingTariffPrice-${c.id}" type="number" min="0" step="0.1" value="${c.receivingPricePerUnit||0}" style="width:150px">
          </div>
          <button class="btn btn-primary" onclick="saveReceivingTariff('${c.id}')">Сохранить цену</button>
        </div>
      </div>
    </div>

    <div class="panel" style="padding:20px;margin-bottom:18px">
      <h3 style="font-size:18px;margin-bottom:6px">Юридические реквизиты (для УПД)</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 14px 0">Нужны, чтобы формировать УПД по плановым поставкам этого клиента.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <div style="flex:1;min-width:160px"><div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">ИНН</div><input class="search mono" id="clientInn-${c.id}" value="${escapeHtml(c.inn||'')}" style="width:100%"></div>
        <div style="flex:1;min-width:160px"><div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">КПП</div><input class="search mono" id="clientKpp-${c.id}" value="${escapeHtml(c.kpp||'')}" style="width:100%"></div>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">Юридический адрес</div>
        <input class="search" id="clientLegalAddress-${c.id}" value="${escapeHtml(c.legalAddress||'')}" style="width:100%">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">Банковские реквизиты (р/с, банк, БИК, к/с)</div>
        <textarea class="search" id="clientBankDetails-${c.id}" rows="2" style="width:100%;resize:vertical">${escapeHtml(c.bankDetails||'')}</textarea>
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">ФИО руководителя</div>
        <input class="search" id="clientDirectorName-${c.id}" value="${escapeHtml(c.directorName||'')}" style="width:100%">
      </div>
      <button class="btn btn-primary" onclick="saveClientLegalInfo('${c.id}')">Сохранить реквизиты</button>
    </div>

    <div class="panel" style="padding:20px;margin-bottom:18px">
      <h3 style="font-size:18px;margin-bottom:6px">Тариф на отгрузку FBS (по литражу)</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 14px 0">Ступени по объёму товара: «до скольки литров — сколько стоит отгрузка одной единицы». При сборке заказа система сама возьмёт объём товара (габариты × 1 шт) и подставит нужную ступень.</p>
      <div style="margin-bottom:14px">
        ${fbsTariffs.filter(t=>t.clientId===c.id).sort((a,b)=>a.maxLiters-b.maxLiters).map(t=>`
          <div class="pick-row" style="padding:8px 0">
            <div><div class="sku-name">До ${t.maxLiters} л</div></div>
            <div class="qty-need">${t.price.toFixed(2)} ₽/шт</div>
            <button class="btn btn-ghost" style="padding:4px 8px" onclick="removeFbsTariff('${t.id}')">✕</button>
          </div>
        `).join('') || '<p style="font-size:13px;color:var(--ink-faint);margin:0">Тарифов пока нет — без них отгрузка не попадёт в ДДС автоматически</p>'}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <div class="eyebrow" style="margin-bottom:6px">До скольки литров</div>
          <input class="search mono" id="newTariffLiters-${c.id}" type="number" min="0" step="0.1" placeholder="напр. 1" style="width:130px">
        </div>
        <div>
          <div class="eyebrow" style="margin-bottom:6px">Цена за отгрузку, ₽</div>
          <input class="search mono" id="newTariffPrice-${c.id}" type="number" min="0" step="0.1" placeholder="напр. 25" style="width:150px">
        </div>
        <button class="btn btn-primary" onclick="addFbsTariff('${c.id}')">+ Добавить ступень</button>
      </div>
    </div>

    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:4px">Интеграция · Wildberries</div>
      <h3 style="font-size:18px;margin-bottom:12px">API-ключ продавца</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="search mono" id="wbKeyInput-${c.id}" type="password" placeholder="Вставьте API-ключ из личного кабинета WB" style="flex:1;min-width:260px" value="${c.wbKey}">
        <button class="btn btn-primary" onclick="connectWb('${c.id}')">Сохранить ключ</button>
        ${c.wbConnected ? `<button class="btn btn-ghost" onclick="disconnectWb('${c.id}')">Отключить</button>` : ''}
      </div>
      <div style="margin-top:10px">
        ${c.wbConnected
          ? `<span class="chip wb"><span class="dot"></span>Ключ сохранён</span>`
          : `<span style="font-size:12px;color:var(--ink-faint)">Ключ ещё не добавлен</span>`}
      </div>
      <p style="font-size:12px;color:var(--ink-faint);margin-top:12px;line-height:1.6">
        Ключ выдаётся в личном кабинете продавца WB → «Настройки» → «Доступ к API», нужны права «Контент». Запрос идёт через серверную функцию — ключ не покидает базу и не виден в коде страницы.
      </p>

      ${c.wbConnected ? `
        <div class="barcode-rule"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-accent" onclick="loadWbProducts('${c.id}')">↓ Загрузить карточки товаров</button>
          <button class="btn btn-ghost" onclick="syncWbBarcodes('${c.id}')" title="Подтягивает из WB все штрихкоды карточек и добавляет те, которых у нас нет. Перед сохранением покажет, что именно изменится.">🔄 Обновить штрихкоды из WB${(()=>{ if(!c.wbProducts.length) return ''; const pl = planWbBarcodeSync(c); const n = pl.setMain.length + pl.addExtras.length; return n ? ` (новых: ${n})` : ''; })()}</button>
        </div>
        ${c.wbProducts.length ? `
          <div style="display:flex;gap:8px;margin-top:14px;margin-bottom:4px;flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="addAllWbProducts('${c.id}')">+ Добавить все в остатки</button>
            <button class="btn btn-ghost" onclick="addSelectedWbProducts('${c.id}')">+ Добавить выбранные</button>
          </div>
        ` : ''}
        <div style="margin-top:10px">
          ${c.wbProducts.length ? c.wbProducts.map(p=>{
            const already = findInventoryItemForWb(p.vendorCode || ('WB-'+p.nmId), c.name, p.size||'');
            const checkKey = p.nmId+'~~'+(p.size||'');
            const missingCodes = already ? (p.barcodes||[]).filter(b=>!itemAllBarcodes(already).has(String(b))) : [];
            return `
            <div class="pick-row" style="align-items:flex-start">
              ${!already ? `<input type="checkbox" class="wb-product-check" data-client="${c.id}" data-key="${escapeHtml(checkKey)}" style="margin-top:4px">` : `<span style="width:16px;display:inline-block"></span>`}
              <div class="wb-thumb"><span>📦</span></div>
              <div>
                <div class="sku-name">${p.name}${p.size?` · размер ${p.size}`:''}</div>
                <div class="sku-code mono">Артикул: ${p.vendorCode} · nmID ${p.nmId}</div>
                <div class="sku-code mono">ШК ${(p.barcodes && p.barcodes.length ? p.barcodes : (p.barcode?[p.barcode]:[])).map(b=>escapeHtml(b)).join(' · ') || '—'}${missingCodes.length ? ` <span style="color:var(--accent);font-weight:700;font-family:Inter,sans-serif" title="Этих штрихкодов нет в системе: ${escapeHtml(missingCodes.join(', '))}">＋${missingCodes.length} новых</span>` : ''}</div>
                ${p.dims ? `<div class="sku-code mono">${p.dims.l}×${p.dims.w}×${p.dims.h} см · ${p.dims.weight} кг</div>` : `<div class="sku-code mono" style="color:var(--ink-faint)">габариты не заполнены в карточке WB</div>`}
              </div>
              <button class="btn ${already?'btn-ghost':'btn-primary'}" style="margin-left:12px" ${already?'disabled':''} onclick="addWbProductToInventory('${c.id}',${p.nmId},'${p.size||''}')">${already?'Уже в остатках':'+ В остатки'}</button>
            </div>
          `;}).join('') : `<p style="font-size:13px;color:var(--ink-faint)">Карточки ещё не загружены</p>`}
        </div>
      ` : ''}
    </div>

    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:4px">Интеграция · Ozon</div>
      <h3 style="font-size:18px;margin-bottom:12px">Client-Id и API-ключ продавца</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="search mono" id="ozonClientIdInput-${c.id}" placeholder="Client-Id" style="width:150px" value="${c.ozonClientId||''}">
        <input class="search mono" id="ozonKeyInput-${c.id}" type="password" placeholder="Вставьте API-ключ из личного кабинета Ozon" style="flex:1;min-width:260px" value="${c.ozonKey||''}">
        <button class="btn btn-primary" onclick="connectOzon('${c.id}')">Сохранить ключ</button>
        ${c.ozonConnected ? `<button class="btn btn-ghost" onclick="disconnectOzon('${c.id}')">Отключить</button>` : ''}
      </div>
      <div style="margin-top:10px">
        ${c.ozonConnected
          ? `<span class="chip oz"><span class="dot"></span>Ключ сохранён</span>`
          : `<span style="font-size:12px;color:var(--ink-faint)">Ключ ещё не добавлен</span>`}
      </div>
      <p style="font-size:12px;color:var(--ink-faint);margin-top:12px;line-height:1.6">
        Client-Id и ключ выдаются в личном кабинете продавца Ozon → «Настройки» → «API-ключи». Запрос идёт через серверную функцию — ключ не покидает базу и не виден в коде страницы.
      </p>
      ${c.ozonConnected ? `
        <div class="barcode-rule"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px;margin-bottom:12px">
          <input class="search mono" id="ozonWarehouseId-${c.id}" placeholder="ID склада Ozon (необязательно — для фильтра заказов)" value="${c.ozonWarehouseId||''}" style="width:280px">
          <button class="btn btn-ghost" onclick="saveOzonWarehouseId('${c.id}')">Сохранить</button>
          <button class="btn btn-ghost" onclick="listOzonWarehouses('${c.id}')">📋 Получить список складов</button>
        </div>
        ${(c.ozonWarehousesList && c.ozonWarehousesList.length) ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px;padding:10px 12px;background:var(--bg);border-radius:8px">
            <select class="search" id="ozonWarehousePicker-${c.id}" style="flex:1;min-width:220px">
              ${c.ozonWarehousesList.map(w=>`<option value="${w.warehouse_id}" ${String(c.ozonWarehouseId)===String(w.warehouse_id)?'selected':''}>${w.warehouse_id} — ${escapeHtml(w.name)}</option>`).join('')}
            </select>
            <button class="btn btn-primary" onclick="useOzonWarehouseFromList('${c.id}')">Использовать этот склад</button>
          </div>
          <p style="font-size:11px;color:var(--ink-faint);margin-top:4px">Без выбранного склада будут подгружаться заказы со всех складов продавца — это и есть причина лишних заказов, если склад не указан.</p>
        ` : ''}
        ${c.ozonWarehouseId ? `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button class="btn btn-accent" onclick="pushStocksToOzon('${c.id}')">🔄 Отправить остатки на Ozon сейчас</button>
            ${c.ozonLastSyncError
              ? `<span style="font-size:11px;color:var(--warn)" title="${escapeHtml(c.ozonLastSyncError)}">⚠ ошибка последней отправки</span>`
              : c.ozonLastSyncedAt ? `<span style="font-size:11px;color:var(--ink-faint)">остатки на Ozon обновлены ${timeAgoRu(c.ozonLastSyncedAt)}</span>` : ''}
          </div>
        ` : ''}
      ` : ''}
    </div>

    ${c.wbConnected && c.ozonConnected ? `
    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:4px">Распределение остатков между площадками</div>
      <h3 style="font-size:18px;margin-bottom:12px">Как делить остаток между WB и Ozon</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn ${c.stockAllocationMode!=='split'?'btn-accent':'btn-ghost'}" onclick="setStockAllocationMode('${c.id}', 'shared')">Общий остаток</button>
        <button class="btn ${c.stockAllocationMode==='split'?'btn-accent':'btn-ghost'}" onclick="setStockAllocationMode('${c.id}', 'split')">Раздельно по площадкам</button>
      </div>
      <p style="font-size:12px;color:var(--ink-soft);line-height:1.6;margin:0">
        ${c.stockAllocationMode==='split'
          ? 'Обе площадки видят только то, что явно выделено под них в «Остатках» — не мешают друг другу, но и не делятся общим пулом. Новый принятый товар по умолчанию лежит «в запасе» и не появляется ни на одной площадке, пока не распределите его вручную.'
          : 'WB и Ozon видят одно и то же число — физический остаток минус то, что уже в необработанных заказах на обеих площадках. Так проще, но есть риск, что при очень частых заказах обновление не успеет, и обе площадки примут заказ на последнюю единицу почти одновременно.'}
      </p>
    </div>
    ` : ''}

    ${c.wbConnected ? `
    <div class="panel" style="padding:20px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:4px">Wildberries · настоящая передача остатков</div>
      <h3 style="font-size:18px;margin-bottom:12px">Синхронизация остатков</h3>
      <p style="font-size:12px;color:var(--ink-soft);margin:0 0 14px 0">Это уже не демо — реально обращается к Wildberries через серверную функцию. Понадобится ID склада продавца (можно получить кнопкой ниже) и штрихкоды у товаров в «Остатках».</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input class="search mono" id="wbWarehouseId-${c.id}" placeholder="ID склада WB" value="${c.wbWarehouseId||''}" style="width:200px">
        <button class="btn btn-ghost" onclick="saveWbWarehouseId('${c.id}')">Сохранить</button>
        <button class="btn btn-ghost" onclick="listWbWarehouses('${c.id}')">📋 Получить список складов</button>
      </div>
      ${(c.wbWarehousesList && c.wbWarehousesList.length) ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;padding:10px 12px;background:var(--bg);border-radius:8px">
          <select class="search" id="wbWarehousePicker-${c.id}" style="flex:1;min-width:220px">
            ${c.wbWarehousesList.map(w=>`<option value="${w.id}" ${String(c.wbWarehouseId)===String(w.id)?'selected':''}>${w.id} — ${escapeHtml(w.name)}</option>`).join('')}
          </select>
          <button class="btn btn-primary" onclick="useWbWarehouseFromList('${c.id}')">Использовать этот склад</button>
        </div>
      ` : ''}
      ${c.wbWarehouseId ? `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn ${c.wbAutoSync?'btn-accent':'btn-ghost'}" style="padding:6px 12px;font-size:12px" onclick="toggleWbAutoSync('${c.id}')">${c.wbAutoSync?'🔄 Автосинхронизация: Вкл':'⏸ Автосинхронизация: Выкл'}</button>
          <span style="font-size:11px;color:var(--ink-faint)">${c.wbAutoSync ? 'Остатки отправляются на WB сами, через пару секунд после изменения' : 'Отправка только вручную, кнопкой ниже'}</span>
        </div>
      ` : `<p style="font-size:11px;color:var(--ink-faint);margin-bottom:12px">Укажите ID склада — тогда можно будет включить автосинхронизацию</p>`}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-accent" onclick="pushStocksToWb('${c.id}')">🔄 Обновить сейчас</button>
        ${c.wbLastSyncError
          ? `<span style="font-size:11px;color:var(--warn)" title="${escapeHtml(c.wbLastSyncError)}">⚠ ошибка последней отправки</span>`
          : c.wbLastSyncedAt ? `<span style="font-size:11px;color:var(--ink-faint)">остатки на WB обновлены ${timeAgoRu(c.wbLastSyncedAt)}</span>` : ''}
      </div>
    </div>
    ` : ''}
  `;
}

// ---------- STORAGE ----------
function renderStorage(){
  const filterSelect = document.getElementById('storageClientFilter');
  const prevValue = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Все клиенты</option>` + clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  filterSelect.value = clients.some(c=>c.id===prevValue) ? prevValue : '';

  let data, title;
  const byDay = {};
  const rows = filterSelect.value ? storageHistoryRows.filter(r=>r.client_id===filterSelect.value) : storageHistoryRows;
  rows.forEach(r=>{
    byDay[r.day] = (byDay[r.day]||0) + Number(r.cost);
  });
  data = Object.keys(byDay).sort().map(day=>({date: new Date(day+'T00:00:00'), cost: byDay[day]}));
  title = filterSelect.value ? (clients.find(x=>x.id===filterSelect.value)?.name || '') : 'Все клиенты';

  const todayCost = data.length ? data[data.length-1].cost : 0;
  const avgCost = data.length ? data.reduce((s,d)=>s+d.cost,0)/data.length : 0;
  const totalCost = data.reduce((s,d)=>s+d.cost,0);

  document.getElementById('storageStats').innerHTML = `
    <div class="stat"><div class="val">${todayCost.toFixed(0)} ₽</div><div class="lbl">Сегодня</div></div>
    <div class="stat"><div class="val">${avgCost.toFixed(0)} ₽</div><div class="lbl">В среднем за день</div></div>
    <div class="stat"><div class="val">${totalCost.toFixed(0)} ₽</div><div class="lbl">Итого за ${data.length} дн.</div></div>
  `;

  document.getElementById('storageChartWrap').innerHTML = `
    <div class="eyebrow" style="margin-bottom:14px">${title} · ${data.length} ${data.length===1?'день':'дней'} записей</div>
    ${data.length ? renderStorageChartSvg(data) : `<p style="color:var(--ink-faint);font-size:13px">Пока нет ни одной реальной записи — она появится, как только сохраните тариф клиента или зайдёте на эту вкладку</p>`}
    ${data.length && data.length<7 ? `<p style="color:var(--ink-faint);font-size:12px;margin-top:10px">Это настоящие записи, а не пример — график будет расти по одной точке в день, по мере использования системы</p>` : ''}
  `;
}
function renderStorageChartSvg(data){
  const w = 780, h = 260, pad = {left:56, right:16, top:16, bottom:28};
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map(d=>d.cost), 1) * 1.15;
  const stepX = data.length>1 ? innerW/(data.length-1) : 0;

  const points = data.map((d,i)=>({
    x: pad.left + i*stepX,
    y: pad.top + innerH - (d.cost/maxVal)*innerH,
    ...d
  }));
  const linePath = points.map((p,i)=>(i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[points.length-1].x.toFixed(1)},${(pad.top+innerH).toFixed(1)} L${points[0].x.toFixed(1)},${(pad.top+innerH).toFixed(1)} Z`;

  let gridHtml = '';
  const ticks = 4;
  for(let t=0;t<=ticks;t++){
    const val = maxVal - (maxVal/ticks)*t;
    const y = pad.top + (innerH/ticks)*t;
    gridHtml += `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${w-pad.right}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
    gridHtml += `<text x="${pad.left-8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-faint)">${Math.round(val)}</text>`;
  }

  let xLabelsHtml = '';
  const labelEvery = Math.max(1, Math.ceil(data.length/6));
  points.forEach((p,i)=>{
    if(i % labelEvery === 0 || i===points.length-1){
      const label = p.date.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
      xLabelsHtml += `<text x="${p.x.toFixed(1)}" y="${h-8}" text-anchor="middle" font-size="10" fill="var(--ink-faint)">${label}</text>`;
    }
  });

  const dotsHtml = points.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--accent)"><title>${p.date.toLocaleDateString('ru-RU')} — ${Math.round(p.cost)} ₽</title></circle>`).join('');

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;font-family:'IBM Plex Mono',monospace">
    ${gridHtml}
    <path d="${areaPath}" fill="var(--accent)" opacity="0.08"/>
    <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    ${dotsHtml}
    ${xLabelsHtml}
  </svg>`;
}
document.getElementById('storageClientFilter').addEventListener('change', renderStorage);
