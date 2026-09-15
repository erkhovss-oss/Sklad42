// ---------- STOCKTAKE (инвентаризация) ----------
async function loadStocktakes(){
  const { data: countRows, error: e1 } = await sb.from('inventory_counts').select('*').order('created_at',{ascending:false}).limit(1000);
  if(e1){ console.error(e1); return; }
  const { data: itemRows, error: e2 } = await sb.from('inventory_count_items').select('*').limit(50000);
  if(e2){ console.error(e2); return; }
  stocktakes = countRows.map(c=>({
    id:c.id, warehouseId:c.warehouse_id, clientId:c.client_id, clientName:c.client_name||'',
    status:c.status, createdAt:c.created_at, completedAt:c.completed_at,
    items: itemRows.filter(it=>it.count_id===c.id).map(it=>({sku:it.sku, name:it.name, size:it.size||'', barcode:it.barcode||'', clientName:it.client_name||'', cell:it.cell||null, countedQty:it.counted_qty}))
  }));
}
function renderStocktakeList(){
  const whSelect = document.getElementById('newCountWarehouse');
  if(hasFullWarehouseAccess()){
    whSelect.innerHTML = warehouses.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
    whSelect.disabled = false;
  } else {
    whSelect.innerHTML = `<option value="${myWarehouseId()}">${escapeHtml(warehouseName(myWarehouseId()))}</option>`;
    whSelect.disabled = true;
  }
  const clientSelect = document.getElementById('newCountClient');
  clientSelect.innerHTML = `<option value="">Весь склад (все клиенты)</option>` + clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  const visible = hasFullWarehouseAccess() ? stocktakes : stocktakes.filter(c=>c.warehouseId===myWarehouseId());
  const wrap = document.getElementById('stocktakeListWrap');
  if(!visible.length){ wrap.innerHTML = `<div class="panel empty">Инвентаризаций пока нет</div>`; return; }
  wrap.innerHTML = visible.map(c=>{
    const totalCounted = c.items.reduce((a,it)=>a+it.countedQty,0);
    const statusLabel = c.status==='completed' ? 'Завершена' : 'В процессе';
    const statusClass = c.status==='completed' ? 'assembled' : 'planned';
    return `
      <div class="panel" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;cursor:pointer" onclick="toggleStocktakeDetail('${c.id}')">
          <div>
            <div style="font-weight:600;font-size:14px">${escapeHtml(warehouseName(c.warehouseId))} ${c.clientName?`· ${escapeHtml(c.clientName)}`:'· весь склад'}</div>
            <div class="mono" style="font-size:12px;color:var(--ink-faint)">${c.id} · ${new Date(c.createdAt).toLocaleString('ru-RU')} · насчитано позиций: ${c.items.length} (${totalCounted} шт)</div>
          </div>
          <span class="status ${statusClass}">${statusLabel}</span>
        </div>
        ${activeStocktakeId===c.id ? renderStocktakeDetail(c) : ''}
      </div>
    `;
  }).join('');
}
function createStocktake(){
  const warehouseId = document.getElementById('newCountWarehouse').value;
  const clientId = document.getElementById('newCountClient').value || null;
  const client = clientId ? clients.find(c=>c.id===clientId) : null;
  const id = 'ИНВ-' + Date.now();
  const createdAt = new Date().toISOString();
  stocktakes.unshift({id, warehouseId, clientId, clientName: client?client.name:'', status:'in_progress', createdAt, completedAt:null, items:[]});
  activeStocktakeId = id;
  toast('Инвентаризация начата');
  renderStocktakeList();
  sb.from('inventory_counts').insert({id, warehouse_id:warehouseId, client_id:clientId, client_name: client?client.name:null, status:'in_progress', created_at:createdAt}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить инвентаризацию в базе'); }
  });
}
function toggleStocktakeDetail(id){
  activeStocktakeId = activeStocktakeId===id ? null : id;
  stocktakeFinishing = false;
  lastStocktakeScanInfo = null;
  renderStocktakeList();
  if(activeStocktakeId){
    setTimeout(()=>{
      const input = document.getElementById('stocktakeScanInput-'+id);
      if(input) input.focus();
    }, 0);
  }
}
function stocktakeScopeItems(c){
  return inventory.filter(i => (i.warehouseId||'MAIN')===c.warehouseId && (!c.clientName || i.client===c.clientName));
}
function addStocktakeCount(countId, sku, size, clientName, qty, barcode, cell, name){
  const c = stocktakes.find(x=>x.id===countId);
  if(!c) return;
  size = size||'';
  const existing = c.items.find(it=>it.sku===sku && (it.size||'')===size && (it.clientName||'')===(clientName||''));
  const newQty = (existing?existing.countedQty:0) + qty;
  if(existing) existing.countedQty = newQty;
  else c.items.push({sku, name, size, barcode:barcode||'', clientName:clientName||'', cell:cell||null, countedQty:newQty});
  lastStocktakeScanInfo = {countId, sku, size, clientName, delta:qty, name};
  saveWithRetry(()=>sb.from('inventory_count_items').upsert(
    {count_id:countId, sku, name, size, barcode:barcode||null, client_name:clientName||null, cell:cell||null, counted_qty:newQty},
    { onConflict:'count_id,sku,client_name,size' }
  )).then(({success, error})=>{
    if(!success){ console.error(error); toast('Не удалось сохранить счёт в базе — попробуйте ещё раз'); }
  });
  if(cell) announceCell(cell);
}
function handleStocktakeScan(countId){
  const input = document.getElementById('stocktakeScanInput-'+countId);
  if(!input) return;
  input.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter') return;
    const code = input.value.trim();
    input.value = '';
    if(!code) return;
    const c = stocktakes.find(x=>x.id===countId);
    const scope = stocktakeScopeItems(c);
    const item = scope.find(i=>i.barcode===code);
    if(!item){
      playBeep('error');
      toast(`Штрихкод ${code} не найден среди товаров этой области`);
      refocusStocktakeScan(countId);
      return;
    }
    addStocktakeCount(countId, item.sku, item.size, item.client, 1, item.barcode, item.cell, item.name);
    playBeep('ok');
    renderStocktakeList();
    refocusStocktakeScan(countId);
  });
}
function refocusStocktakeScan(countId){
  setTimeout(()=>{
    const el = document.getElementById('stocktakeScanInput-'+countId);
    if(el) el.focus();
  }, 0);
}
function manualAddStocktakeItem(countId){
  const select = document.getElementById('stocktakeManualSelect-'+countId);
  const qtyInput = document.getElementById('stocktakeManualQty-'+countId);
  const key = select.value;
  if(!key){ toast('Выберите товар'); return; }
  const [sku, clientName, size] = key.split('~~');
  const qty = Math.max(1, parseInt(qtyInput.value)||1);
  const c = stocktakes.find(x=>x.id===countId);
  const item = stocktakeScopeItems(c).find(i=>i.sku===sku && (i.client||'')===clientName && (i.size||'')===(size||''));
  if(!item){ toast('Товар не найден'); return; }
  addStocktakeCount(countId, sku, size, clientName, qty, item.barcode, item.cell, item.name);
  toast('Добавлено');
  renderStocktakeList();
}
function undoLastStocktakeScan(){
  if(!lastStocktakeScanInfo){ toast('Нечего отменять'); return; }
  const info = lastStocktakeScanInfo;
  const c = stocktakes.find(x=>x.id===info.countId);
  if(!c) return;
  const item = c.items.find(it=>it.sku===info.sku && (it.size||'')===(info.size||'') && (it.clientName||'')===(info.clientName||''));
  if(!item) return;
  const newQty = Math.max(0, item.countedQty - info.delta);
  if(newQty===0){
    c.items = c.items.filter(it=>it!==item);
    saveWithRetry(()=>sb.from('inventory_count_items').delete().eq('count_id', info.countId).eq('sku', info.sku).eq('size', info.size||'').eq('client_name', info.clientName||'')).then(({success,error})=>{
      if(!success) console.error(error);
    });
  } else {
    item.countedQty = newQty;
    saveWithRetry(()=>sb.from('inventory_count_items').upsert(
      {count_id:info.countId, sku:info.sku, name:info.name, size:info.size||'', client_name:info.clientName||null, counted_qty:newQty},
      { onConflict:'count_id,sku,client_name,size' }
    )).then(({success,error})=>{ if(!success) console.error(error); });
  }
  toast(`Отменено: ${info.name} −${info.delta} шт`);
  lastStocktakeScanInfo = null;
  renderStocktakeList();
}
function removeStocktakeItem(countId, sku, size, clientName){
  const c = stocktakes.find(x=>x.id===countId);
  if(!c) return;
  c.items = c.items.filter(it=>!(it.sku===sku && (it.size||'')===(size||'') && (it.clientName||'')===(clientName||'')));
  renderStocktakeList();
  sb.from('inventory_count_items').delete().eq('count_id', countId).eq('sku', sku).eq('size', size||'').eq('client_name', clientName||'').then(({error})=>{ if(error) console.error(error); });
}
function toggleStocktakeFinish(){
  stocktakeFinishing = !stocktakeFinishing;
  renderStocktakeList();
}
function downloadStocktakeExcel(countId){
  const c = stocktakes.find(x=>x.id===countId);
  if(!c) return;
  const rows = computeStocktakeReconciliation(c);
  const data = [
    ['Артикул','ШК','Размер','Клиент','Ячейка','По системе','Насчитано','Разница','Не сканировали'],
    ...rows.map(r=>[r.sku, r.barcode||'', r.size||'', r.clientName||'', r.cell||'', r.systemQty, r.countedQty, r.diff, r.notScanned?'да':''])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:18},{wch:16},{wch:10},{wch:20},{wch:8},{wch:12},{wch:12},{wch:10},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Инвентаризация');
  const statusLabel = c.status==='completed' ? 'завершена' : 'в процессе';
  XLSX.writeFile(wb, `Инвентаризация_${c.id}_(${statusLabel}).xlsx`);
}
function computeStocktakeReconciliation(c){
  const scope = stocktakeScopeItems(c);
  const rows = [];
  const seen = new Set();
  c.items.forEach(it=>{
    const key = it.sku+'~~'+it.clientName+'~~'+it.size;
    seen.add(key);
    const sysItem = scope.find(i=>i.sku===it.sku && (i.client||'')===(it.clientName||'') && (i.size||'')===(it.size||''));
    const systemQty = sysItem ? sysItem.qty : 0;
    rows.push({sku:it.sku, name:it.name, size:it.size, barcode:it.barcode||(sysItem?sysItem.barcode:''), clientName:it.clientName, cell:it.cell, systemQty, countedQty:it.countedQty, diff: it.countedQty - systemQty});
  });
  scope.forEach(i=>{
    const key = i.sku+'~~'+(i.client||'')+'~~'+(i.size||'');
    if(seen.has(key)) return;
    rows.push({sku:i.sku, name:i.name, size:i.size||'', barcode:i.barcode||'', clientName:i.client||'', cell:i.cell, systemQty:i.qty, countedQty:0, diff: -i.qty, notScanned:true});
  });
  return rows.sort((a,b)=> Math.abs(b.diff) - Math.abs(a.diff));
}
function applyStocktakeCorrections(countId){
  const c = stocktakes.find(x=>x.id===countId);
  if(!c) return;
  if(!confirm('Применить результаты инвентаризации к остаткам? Это изменит фактические количества на складе, действие нельзя отменить одной кнопкой.')) return;
  const rows = computeStocktakeReconciliation(c);
  rows.forEach(r=>{
    if(r.diff===0) return;
    let inv = findInventoryItem(r.sku, r.clientName, r.size, c.warehouseId);
    if(!inv && r.countedQty>0){
      inv = {sku:r.sku, name:r.name, qty:0, client:r.clientName, size:r.size||'', warehouseId:c.warehouseId, barcode:''};
      inventory.push(inv);
    }
    if(!inv) return;
    inv.qty = r.countedQty;
    logMovement(inv.sku, inv.name, r.diff, 'Инвентаризация — корректировка', inv.client, inv.size);
    syncInventoryRow(inv.sku, inv.client, inv.size, inv.warehouseId);
  });
  c.status = 'completed';
  c.completedAt = new Date().toISOString();
  activeStocktakeId = null;
  stocktakeFinishing = false;
  toast('Инвентаризация завершена, остатки скорректированы');
  renderStocktakeList();
  renderInventory();
  sb.from('inventory_counts').update({status:'completed', completed_at:c.completedAt}).eq('id', countId).then(({error})=>{ if(error) console.error(error); });
}
function renderStocktakeDetail(c){
  if(c.status==='completed'){
    const rows = computeStocktakeReconciliation(c);
    return `
      <div style="border-top:1px solid var(--line);padding:16px 18px" onclick="event.stopPropagation()">
        <div class="eyebrow" style="margin-bottom:10px">Итог (уже применено к остаткам)</div>
        <div class="panel">
          <table>
            <thead><tr><th>Артикул</th><th>ШК</th><th>Клиент</th><th>Ячейка</th><th>Было по системе</th><th>Насчитано</th><th>Разница</th></tr></thead>
            <tbody>
              ${rows.map(r=>`<tr>
                <td class="mono">${escapeHtml(r.sku)}${r.size?` (${r.size})`:''}</td>
                <td class="mono">${r.barcode||'—'}</td>
                <td>${escapeHtml(r.clientName)||'—'}</td>
                <td>${r.cell||'—'}</td>
                <td>${r.systemQty}</td>
                <td>${r.countedQty}</td>
                <td style="font-weight:700;color:${r.diff===0?'var(--ok)':'var(--warn)'}">${r.diff>0?'+':''}${r.diff}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn btn-ghost" style="margin-top:12px" onclick="downloadStocktakeExcel('${c.id}')">📊 Скачать Excel</button>
      </div>
    `;
  }
  if(stocktakeFinishing){
    const rows = computeStocktakeReconciliation(c);
    const mismatches = rows.filter(r=>r.diff!==0);
    return `
      <div style="border-top:1px solid var(--line);padding:16px 18px" onclick="event.stopPropagation()">
        <div class="eyebrow" style="margin-bottom:10px">Сверка перед завершением</div>
        ${mismatches.length ? `<p style="font-size:12px;color:var(--warn);margin:0 0 10px 0">Расхождений: ${mismatches.length}. Совпадающие позиции ниже не показаны.</p>` : `<p style="font-size:12px;color:var(--ok);margin:0 0 10px 0">Расхождений нет — всё совпало.</p>`}
        <div class="panel" style="margin-bottom:14px">
          <table>
            <thead><tr><th>Артикул</th><th>ШК</th><th>Клиент</th><th>Ячейка</th><th>По системе</th><th>Насчитано</th><th>Разница</th></tr></thead>
            <tbody>
              ${mismatches.map(r=>`<tr>
                <td class="mono">${escapeHtml(r.sku)}${r.size?` (${r.size})`:''}</td>
                <td class="mono">${r.barcode||'—'}</td>
                <td>${escapeHtml(r.clientName)||'—'}</td>
                <td>${r.cell||'—'}</td>
                <td>${r.systemQty}</td>
                <td>${r.countedQty}${r.notScanned?' <span style="color:var(--ink-faint);font-size:11px">(не сканировали)</span>':''}</td>
                <td style="font-weight:700;color:var(--warn)">${r.diff>0?'+':''}${r.diff}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn btn-accent" onclick="applyStocktakeCorrections('${c.id}')">✅ Применить корректировки к остаткам</button>
        <button class="btn btn-ghost" onclick="toggleStocktakeFinish()">← Вернуться к сканированию</button>
        <button class="btn btn-ghost" onclick="downloadStocktakeExcel('${c.id}')">📊 Скачать Excel</button>
      </div>
    `;
  }
  const scope = stocktakeScopeItems(c);
  setTimeout(()=>handleStocktakeScan(c.id), 0);
  return `
    <div style="border-top:1px solid var(--line);padding:16px 18px" onclick="event.stopPropagation()">
      <div class="eyebrow" style="margin-bottom:6px">Сканер</div>
      <input class="search mono" id="stocktakeScanInput-${c.id}" placeholder="Штрихкод товара…" style="width:100%;max-width:420px;margin-bottom:14px" autocomplete="off">
      <div class="eyebrow" style="margin-bottom:6px">Или вручную</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <select class="search" id="stocktakeManualSelect-${c.id}" style="flex:1;min-width:220px">
          ${scope.map(i=>`<option value="${escapeHtml(i.sku+'~~'+(i.client||'')+'~~'+(i.size||''))}">${escapeHtml(i.sku)}${i.size?` (${i.size})`:''} — ${escapeHtml(i.name)}${i.client?` · ${escapeHtml(i.client)}`:''}</option>`).join('')}
        </select>
        <input class="search mono" id="stocktakeManualQty-${c.id}" type="number" min="1" value="1" style="width:90px">
        <button class="btn btn-ghost" onclick="manualAddStocktakeItem('${c.id}')">+ Добавить</button>
      </div>
      <div class="eyebrow" style="margin-bottom:6px">Насчитано (${c.items.length} поз. · ${c.items.reduce((a,it)=>a+it.countedQty,0)} шт)</div>
      <div class="panel" style="margin-bottom:14px;max-height:320px;overflow-y:auto">
        ${c.items.length ? c.items.map(it=>`
          <div class="pick-row">
            <div><div class="sku-name">${escapeHtml(it.name)}${it.size?` · ${it.size}`:''}</div><div class="sku-code mono">${escapeHtml(it.sku)}${it.barcode?` · ШК ${escapeHtml(it.barcode)}`:''}${it.clientName?` · ${escapeHtml(it.clientName)}`:''}${it.cell?` · яч. ${it.cell}`:''}</div></div>
            <div class="qty-need">${it.countedQty} шт</div>
            <button class="btn btn-ghost" style="padding:3px 8px" onclick="removeStocktakeItem('${c.id}','${escapeHtml(it.sku)}','${escapeHtml(it.size||'')}','${escapeHtml(it.clientName||'')}')">✕</button>
          </div>
        `).join('') : `<p style="font-size:13px;color:var(--ink-faint);margin:8px 0">Пока ничего не отсканировано</p>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" ${lastStocktakeScanInfo&&lastStocktakeScanInfo.countId===c.id?'':'disabled'} onclick="undoLastStocktakeScan()">↩ Отменить скан</button>
        <button class="btn btn-accent" onclick="toggleStocktakeFinish()">Завершить инвентаризацию →</button>
        <button class="btn btn-ghost" onclick="downloadStocktakeExcel('${c.id}')">📊 Скачать Excel</button>
      </div>
    </div>
  `;
}

