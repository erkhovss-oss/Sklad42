// ---------- OUTBOUND SUPPLY (поставка на региональные склады) ----------
function renderOutbound(){
  renderOutboundCreatePanel();
  renderOutboundTableWrap();
}
function renderOutboundCreatePanel(){
  const panel = document.getElementById('outboundCreatePanel');
  const client = clients.find(c=>c.id===draftOutboundClientId);
  const sourceWarehouseId = hasFullWarehouseAccess() ? (draftOutboundWarehouseId || 'MAIN') : myWarehouseId();
  const clientItems = client ? inventory.filter(i=>i.client===client.name && i.qty>0 && (i.warehouseId||'MAIN')===sourceWarehouseId) : [];
  const totalQty = draftOutboundItems.reduce((s,d)=>s+d.qty,0);
  const destinations = [...new Set(outboundSupplies.map(s=>s.destination).filter(Boolean))];

  panel.innerHTML = `
    <div class="panel" style="padding:20px;margin-bottom:16px">
      <h3 style="font-size:18px;margin-bottom:4px">Создать поставку товара</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin:0 0 16px 0">Выберите клиента, укажите склад назначения и добавьте товары со склада — сформируется поставка с номером и листом подбора для сборки.</p>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div style="flex:1;min-width:220px">
          <div class="eyebrow" style="margin-bottom:6px">Клиент</div>
          <select class="search" id="outboundClientSelect" style="width:100%" onchange="setDraftOutboundClient(this.value)">
            <option value="">— выберите —</option>
            ${clients.map(c=>`<option value="${c.id}" ${draftOutboundClientId===c.id?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;min-width:180px">
          <div class="eyebrow" style="margin-bottom:6px">Списываем со склада</div>
          <select class="search" id="outboundWarehouseSelect" style="width:100%" onchange="setDraftOutboundWarehouse(this.value)" ${hasFullWarehouseAccess()?'':'disabled'}>
            ${hasFullWarehouseAccess()
              ? warehouses.map(w=>`<option value="${w.id}" ${sourceWarehouseId===w.id?'selected':''}>${escapeHtml(w.name)}</option>`).join('')
              : `<option value="${myWarehouseId()}" selected>${escapeHtml(warehouseName(myWarehouseId()))}</option>`}
          </select>
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;color:var(--ink-soft);cursor:pointer">
        <input type="checkbox" id="outboundIsInternalTransfer" ${draftOutboundIsInternalTransfer?'checked':''} onchange="toggleOutboundInternalTransfer(this.checked)">
        Это перемещение на наш склад в другом регионе (не клиенту/не на маркетплейс)
      </label>

      ${draftOutboundIsInternalTransfer ? `
        <div style="margin-bottom:14px">
          <div class="eyebrow" style="margin-bottom:6px">Куда перемещаем (наш склад)</div>
          <select class="search" id="outboundDestWarehouseSelect" style="width:100%;max-width:400px">
            ${warehouses.filter(w=>w.id!==sourceWarehouseId).map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('') || '<option value="">нет других складов — создайте в разделе «Склады»</option>'}
          </select>
          <p style="font-size:12px;color:var(--ink-faint);margin-top:6px">После сборки и отметки «Отправлено» на складе назначения автоматически появится плановая поставка — останется её принять там как обычно.</p>
        </div>
      ` : `
        <div style="margin-bottom:14px">
          <div class="eyebrow" style="margin-bottom:6px">Куда отправляем (склад назначения)</div>
          <input class="search" id="outboundDestination" list="outboundDestList" placeholder="напр. Региональный склад — Казань" style="width:100%">
          <datalist id="outboundDestList">${destinations.map(d=>`<option value="${escapeHtml(d)}">`).join('')}</datalist>
        </div>
      `}

      ${client ? `
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;padding:12px;background:var(--bg);border-radius:10px">
          <span style="font-size:12px;color:var(--ink-soft);margin-right:2px">Или сразу списком:</span>
          <label class="btn btn-ghost" style="cursor:pointer;margin:0">
            ⬆ Загрузить Excel
            <input type="file" accept=".xlsx,.xls" style="display:none" onchange="handleOutboundExcelUpload(this)">
          </label>
          <button class="btn btn-ghost" onclick="downloadOutboundTemplate()">⬇ Шаблон (ШК / Кол-во)</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <select class="search" id="outboundItemSelect" style="width:280px">
            ${clientItems.length ? clientItems.map(i=>`<option value="${escapeHtml(itemKey(i))}">${i.sku}${i.size?` (${i.size})`:''} — ${i.name} (доступно ${i.qty})</option>`).join('') : `<option value="">нет товаров в наличии</option>`}
          </select>
          <input class="search" id="outboundItemQty" type="number" min="1" value="1" style="width:90px">
          <button class="btn btn-ghost" onclick="addDraftOutboundItem()" ${clientItems.length?'':'disabled'}>+ Добавить позицию</button>
        </div>
        ${draftOutboundItems.length ? `
          <div class="panel" style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer;background:var(--bg)" onclick="toggleOutboundDraftCollapse()">
              <h3 style="font-size:13px;color:var(--ink-soft)">Товары в поставке (${draftOutboundItems.length})</h3>
              <span style="font-size:12px;color:var(--ink-faint)">${outboundDraftCollapsed ? '▼' : '▲'}</span>
            </div>
            ${outboundDraftCollapsed ? '' : draftOutboundItems.map(d=>`
              <div class="pick-row">
                <div><div class="sku-name">${d.name}${d.size?` · ${d.size}`:''}</div><div class="sku-code mono">${d.sku}${d.cell?` · яч. ${d.cell}`:''}</div></div>
                <div class="qty-need">${d.qty} шт</div>
                <button class="btn btn-ghost" style="padding:4px 8px" onclick="removeDraftOutboundItem('${escapeHtml(d.sku)}','${escapeHtml(d.size||'')}')">✕</button>
              </div>
            `).join('')}
          </div>
        ` : `<p style="font-size:13px;color:var(--ink-faint);margin:0 0 14px 0">Пока не добавлено ни одной позиции</p>`}
      ` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-accent" onclick="createOutboundSupply()" ${(client && draftOutboundItems.length)?'':'disabled'}>Создать поставку${totalQty?` (${totalQty} шт)`:''}</button>
        ${(client || draftOutboundItems.length) ? `<button class="btn btn-ghost" onclick="cancelOutboundDraft()">Отменить</button>` : ''}
      </div>
    </div>
  `;
}
function toggleOutboundDraftCollapse(){
  outboundDraftCollapsed = !outboundDraftCollapsed;
  renderOutboundCreatePanel();
}
function cancelOutboundDraft(){
  if(draftOutboundItems.length && !confirm('Отменить создание поставки? Все добавленные позиции будут убраны.')) return;
  draftOutboundClientId = '';
  draftOutboundItems = [];
  outboundDraftCollapsed = false;
  toast('Создание поставки отменено');
  renderOutboundCreatePanel();
}
function setDraftOutboundClient(clientId){
  if(draftOutboundClientId !== clientId) draftOutboundItems = [];
  draftOutboundClientId = clientId;
  renderOutboundCreatePanel();
}
function setDraftOutboundWarehouse(warehouseId){
  if(draftOutboundWarehouseId !== warehouseId) draftOutboundItems = [];
  draftOutboundWarehouseId = warehouseId;
  renderOutboundCreatePanel();
}
function toggleOutboundInternalTransfer(checked){
  draftOutboundIsInternalTransfer = checked;
  renderOutboundCreatePanel();
}
function addDraftOutboundItem(){
  const select = document.getElementById('outboundItemSelect');
  const key = select.value;
  if(!key) return;
  const qty = Math.max(1, parseInt(document.getElementById('outboundItemQty').value) || 1);
  const {sku, client, size} = parseItemKey(key);
  const item = findInventoryItem(sku, client, size);
  if(!item) return;
  const already = draftOutboundItems.find(d=>d.sku===sku && (d.size||'')===(size||'') && (d.barcode||'')===(item.barcode||''));
  const usedQty = already ? already.qty : 0;
  if(usedQty + qty > item.qty){
    toast(`На складе доступно только ${item.qty} шт «${item.name}»`);
    return;
  }
  if(already) already.qty += qty;
  else draftOutboundItems.push({sku, name:item.name, size:item.size||'', qty, barcode:item.barcode||'', cell:item.cell||null});
  renderOutboundCreatePanel();
}
function removeDraftOutboundItem(sku, size){
  draftOutboundItems = draftOutboundItems.filter(d=>!(d.sku===sku && (d.size||'')===(size||'')));
  renderOutboundCreatePanel();
}
function downloadOutboundTemplate(){
  const data = [
    ['ШК','Кол-во'],
    ['2460001112223',5],
    ['2460004445556',10]
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:18},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Поставка на склад');
  XLSX.writeFile(wb, 'shablon_postavka_na_sklad.xlsx');
}
function handleOutboundExcelUpload(inputEl){
  const client = clients.find(c=>c.id===draftOutboundClientId);
  if(!client){ toast('Сначала выберите клиента'); inputEl.value=''; return; }
  const file = inputEl.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const workbook = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
      let added = 0;
      const skippedList = [];
      for(let i=1;i<rows.length;i++){
        const row = rows[i];
        if(!row || !row.length) continue;
        const barcode = String(row[0]||'').trim();
        const qty = parseInt(row[1]) || 0;
        if(!barcode || qty<=0) continue;
        const item = findInventoryItemByBarcode(barcode, client.name);
        if(!item){ skippedList.push({barcode, reason:`такого штрихкода нет у клиента «${client.name}»`}); continue; }
        const sku = item.sku;
        const size = item.size || '';
        const already = draftOutboundItems.find(d=>d.sku===sku && (d.size||'')===size && (d.barcode||'')===(item.barcode||''));
        const usedQty = already ? already.qty : 0;
        if(usedQty + qty > item.qty){
          toast(`«${item.name}»: на складе только ${item.qty} шт, взято максимум возможное`);
          const addQty = Math.max(0, item.qty - usedQty);
          if(addQty<=0){ skippedList.push({barcode, reason:`«${item.name}» — нет остатка (0 шт свободно)`}); continue; }
          if(already) already.qty += addQty; else draftOutboundItems.push({sku, name:item.name, size, qty:addQty, barcode:item.barcode||barcode, cell:item.cell||null});
          added++;
          continue;
        }
        if(already) already.qty += qty;
        else draftOutboundItems.push({sku, name:item.name, size, qty, barcode:item.barcode||barcode, cell:item.cell||null});
        added++;
      }
      if(added===0){ toast('Не найдено подходящих позиций в остатках этого клиента — проверьте штрихкоды'); }
      else toast(`Загружено из файла: ${added} поз.${skippedList.length?`, пропущено: ${skippedList.length}`:''}`);
      if(skippedList.length){
        const details = skippedList.map(s=>`ШК ${s.barcode} — ${s.reason}`).join('\n');
        alert(`Пропущенные строки (${skippedList.length}):\n\n${details}`);
      }
      renderOutboundCreatePanel();
    }catch(err){
      toast('Не удалось прочитать файл — проверьте формат Excel');
    }
    inputEl.value = '';
  };
  reader.readAsArrayBuffer(file);
}
function createOutboundSupply(){
  const client = clients.find(c=>c.id===draftOutboundClientId);
  const sourceWarehouseId = hasFullWarehouseAccess() ? (draftOutboundWarehouseId || 'MAIN') : myWarehouseId();
  const isInternal = draftOutboundIsInternalTransfer;
  const destWarehouseId = isInternal ? document.getElementById('outboundDestWarehouseSelect').value : null;
  const destination = isInternal ? warehouseName(destWarehouseId) : document.getElementById('outboundDestination').value.trim();
  if(!client){ toast('Выберите клиента'); return; }
  if(isInternal && !destWarehouseId){ toast('Выберите склад назначения'); return; }
  if(!isInternal && !destination){ toast('Укажите склад назначения'); return; }
  if(!draftOutboundItems.length){ toast('Добавьте хотя бы одну позицию'); return; }

  for(const d of draftOutboundItems){
    const item = resolveDraftItem(d, client.name, sourceWarehouseId);
    const available = item ? (item.isKit && item.kitMode!=='assembled' ? computeKitAvailability(item).available : item.qty) : 0;
    if(!item || available < d.qty){
      toast(`Недостаточно на складе: «${d.name}» (нужно ${d.qty}, есть ${available})`);
      return;
    }
  }

  const id = 'ОТ-' + Date.now();
  const createdAt = new Date();
  const items = draftOutboundItems.map(d=>({...d}));

  draftOutboundItems.forEach(d=>{
    const item = resolveDraftItem(d, client.name, sourceWarehouseId);
    deductStockForShipment(item, d.qty, `Отгрузка на склад: ${destination}`);
  });

  outboundSupplies.unshift({
    id, clientId: client.id, clientName: client.name, destination,
    status: 'created', createdAt, items,
    isInternalTransfer: isInternal, sourceWarehouseId, destWarehouseId
  });

  sb.from('outbound_supplies').insert({
    id, client_id: client.id, client_name: client.name, destination, status:'created', created_at: createdAt.toISOString(),
    is_internal_transfer: isInternal, source_warehouse_id: sourceWarehouseId, dest_warehouse_id: destWarehouseId
  }).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить поставку в базе'); return; }
    const rows = items.map(it=>({supply_id:id, sku:it.sku, name:it.name, qty:it.qty, barcode:it.barcode||null, cell:it.cell||null, size:it.size||null}));
    sb.from('outbound_supply_items').insert(rows).then(({error})=>{
      if(error){ console.error(error); toast('Не удалось сохранить позиции поставки в базе'); }
    });
  });

  draftOutboundItems = [];
  draftOutboundClientId = '';
  draftOutboundIsInternalTransfer = false;
  outboundDraftCollapsed = false;
  toast(`Поставка ${id} создана`);
  renderOutbound();
  renderInventory();
}
function toggleOutboundDetail(id){
  if(activeOutboundId !== id){ editingOutboundId = null; deletingOutboundId = null; activeBoxSupplyId = null; expandedBoxId = null; }
  activeOutboundId = activeOutboundId===id ? null : id;
  renderOutboundTableWrap();
}
function markOutboundShipped(id){
  const s = outboundSupplies.find(x=>x.id===id);
  s.status = 'shipped';
  sb.from('outbound_supplies').update({status:'shipped'}).eq('id', id).then(({error})=>{ if(error) console.error(error); });

  if(s.isInternalTransfer && s.destWarehouseId && !s.createdPlannedSupplyId){
    const newId = 'ПС-' + Date.now();
    const createdAt = new Date();
    const items = s.items.map(it=>({sku:it.sku, name:it.name, size:it.size||'', barcode:it.barcode||'', qty:it.qty, receivedQty:0}));
    supplies.unshift({
      id:newId, clientId:s.clientId, clientName:s.clientName, createdAt, items,
      status:'planned', requiresKiz:false, warehouseId:s.destWarehouseId
    });
    s.createdPlannedSupplyId = newId;
    sb.from('supplies').insert({id:newId, client_id:s.clientId, client_name:s.clientName, status:'planned', created_at:createdAt.toISOString(), requires_kiz:false, warehouse_id:s.destWarehouseId}).then(({error})=>{
      if(error){ console.error(error); toast('Не удалось создать плановую поставку на складе назначения'); return; }
      const rows = items.map(it=>({supply_id:newId, sku:it.sku, name:it.name, qty:it.qty, received_qty:0, barcode:it.barcode||null, size:it.size||null}));
      sb.from('supply_items').insert(rows).then(({error})=>{ if(error) console.error(error); });
      sb.from('outbound_supplies').update({created_planned_supply_id:newId}).eq('id', id).then(({error})=>{ if(error) console.error(error); });
    });
    toast(`Поставка ${id} отправлена. На складе «${warehouseName(s.destWarehouseId)}» создана плановая поставка ${newId} — примите её там как обычно`);
  } else {
    toast(`Поставка ${id} отмечена как отправленная`);
  }
  renderOutboundTableWrap();
}
function formatOutboundDate(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}:${mi}`;
}
function renderOutboundTableWrap(){
  const q = (document.getElementById('outboundSearch').value || '').toLowerCase();
  const visibleOutbound = hasFullWarehouseAccess() ? outboundSupplies : outboundSupplies.filter(s=>(s.sourceWarehouseId||'MAIN')===myWarehouseId());
  const filtered = visibleOutbound.filter(s=>
    !q || s.id.toLowerCase().includes(q) || s.clientName.toLowerCase().includes(q) || (s.destination||'').toLowerCase().includes(q)
  );
  document.getElementById('outboundCount').textContent = `${filtered.length} из ${visibleOutbound.length}`;
  const wrap = document.getElementById('outboundTableWrap');

  if(!visibleOutbound.length){
    wrap.innerHTML = `<div class="panel empty"><span class="eyebrow">Поставок пока нет</span>Заполните форму выше, чтобы создать первую</div>`;
    return;
  }
  if(!filtered.length){
    wrap.innerHTML = `<div class="panel empty">Ничего не найдено по запросу «${q}»</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="panel">
      <table class="card-table">
        <thead><tr><th>ID</th><th>Клиент</th><th>Куда</th><th>Статус</th><th>Кол-во</th><th>SKU</th><th>Создана</th></tr></thead>
        <tbody>
          ${filtered.map(s=>{
            const totalQty = s.items.reduce((a,i)=>a+i.qty,0);
            const isOpen = activeOutboundId===s.id;
            const statusLabel = s.status==='shipped' ? 'Отправлена' : 'Создана';
            const statusClass = s.status==='shipped' ? 'shipped' : 'planned';
            let rowsHtml = `
              <tr style="cursor:pointer" onclick="toggleOutboundDetail('${s.id}')">
                <td class="mono" data-label="ID">${s.id}</td>
                <td data-label="Клиент">${s.clientName}</td>
                <td data-label="Куда">${s.destination}</td>
                <td data-label="Статус"><span class="status ${statusClass}">${statusLabel}</span></td>
                <td data-label="Кол-во">${totalQty}</td>
                <td data-label="SKU">${s.items.length}</td>
                <td class="mono" data-label="Создана" style="font-size:12px">${formatOutboundDate(s.createdAt)}</td>
              </tr>
            `;
            if(isOpen){
              rowsHtml += `<tr><td colspan="7" style="padding:0">${renderOutboundDetail(s)}</td></tr>`;
            }
            return rowsHtml;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function renderOutboundDetail(s){
  const totalQty = s.items.reduce((a,i)=>a+i.qty,0);

  if(deletingOutboundId === s.id){
    return `
      <div style="border-top:1px solid var(--line);padding:16px 18px;background:var(--panel)" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 14px;background:var(--warn-bg);border-radius:8px">
          <span style="font-size:13px;color:var(--warn)">Удалить поставку ${s.id}? Товар (${totalQty} шт) вернётся в остатки на складе. Отменить нельзя.</span>
          <div style="white-space:nowrap">
            <button class="btn btn-accent" onclick="confirmDeleteOutbound('${s.id}')">Да, удалить</button>
            <button class="btn btn-ghost" onclick="cancelDeleteOutbound()">Отмена</button>
          </div>
        </div>
      </div>
    `;
  }

  if(editingOutboundId === s.id){
    const availableItems = inventory.filter(i=>i.client===s.clientName && i.qty>0 && (i.warehouseId||'MAIN')===(s.sourceWarehouseId||'MAIN') && !s.items.find(it=>it.sku===i.sku && (it.size||'')===(i.size||'')));
    return `
      <div style="border-top:1px solid var(--line);padding:16px 18px;background:var(--panel)" onclick="event.stopPropagation()">
        <div class="eyebrow" style="margin-bottom:4px">Изменить поставку ${s.id}</div>
        <div style="margin:10px 0 14px 0">
          <div class="eyebrow" style="margin-bottom:6px">Куда отправляем</div>
          <input class="search" id="editOutboundDest-${s.id}" value="${s.destination}" style="width:100%;max-width:420px">
        </div>
        <div class="panel" style="margin-bottom:14px">
          ${s.items.map(it=>`
            <div class="pick-row">
              <div><div class="sku-name">${it.name}${it.size?` · ${it.size}`:''}</div><div class="sku-code mono">${it.sku}${it.barcode?` · ШК ${it.barcode}`:''}</div></div>
              <input class="search mono" type="number" min="0" value="${it.qty}" style="width:90px" id="editOutQty-${s.id}-${it.sku}-${it.size||''}">
            </div>
          `).join('')}
        </div>
        <p style="font-size:12px;color:var(--ink-faint);margin:0 0 14px 0">Поставьте 0, чтобы убрать позицию целиком. Увеличение количества списывает разницу со склада ещё раз, уменьшение — возвращает.</p>

        <div class="eyebrow" style="margin-bottom:6px">Добавить новый товар в поставку</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <select class="search" id="editOutNewItemSelect-${s.id}" style="flex:1;min-width:220px">
            <option value="">${availableItems.length ? '— выберите товар —' : 'нет доступных товаров на этом складе'}</option>
            ${availableItems.map(i=>`<option value="${escapeHtml(i.sku+'~~'+(i.size||''))}">${escapeHtml(i.sku)}${i.size?` (${i.size})`:''} — ${escapeHtml(i.name)} (в наличии: ${i.qty})</option>`).join('')}
          </select>
          <input class="search mono" id="editOutNewItemQty-${s.id}" type="number" min="1" value="1" style="width:90px">
          <button class="btn btn-ghost" onclick="addItemToOutboundEdit('${s.id}')">+ Добавить</button>
        </div>

        <button class="btn btn-accent" onclick="saveOutboundEdit('${s.id}')">Сохранить изменения</button>
        <button class="btn btn-ghost" onclick="cancelEditOutbound()">Отмена</button>
      </div>
    `;
  }

  const boxesForProgress = outboundBoxes.filter(b=>b.supplyId===s.id);
  const packedQty = boxesForProgress.reduce((sum,b)=>sum + b.items.reduce((a,it)=>a+it.qty,0), 0);
  const packPct = totalQty ? Math.min(100, Math.round(packedQty/totalQty*100)) : 0;
  return `
    <div style="border-top:1px solid var(--line);padding:16px 18px;background:var(--panel)" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="eyebrow">Поставка ${s.id} · ${totalQty} шт · ${s.items.length} SKU</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-accent" onclick="printPickList('${s.id}')">🖨 Лист подбора</button>
          <button class="btn btn-ghost" onclick="toggleBoxPanel('${s.id}')">📦 Короба</button>
          ${s.status!=='shipped' ? `<button class="btn btn-ghost" onclick="markOutboundShipped('${s.id}')">Отметить отправленной</button>` : ''}
          <button class="btn btn-ghost" onclick="openEditOutbound('${s.id}')">Изменить</button>
          <button class="btn btn-ghost" style="color:var(--warn)" onclick="openDeleteOutbound('${s.id}')">Удалить</button>
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="mono" style="font-size:14px;font-weight:600">Собрано по коробам: ${packedQty} из ${totalQty}</span>
          <span class="mono" style="font-size:14px;font-weight:700;color:${packPct>=100?'var(--ok)':'var(--accent)'}">${packPct}%</span>
        </div>
        <div class="progress-track" style="background:var(--line)">
          <div class="progress-fill" style="width:${packPct}%;background:${packPct>=100?'var(--ok)':'var(--accent)'}"></div>
        </div>
      </div>
      ${activeBoxSupplyId===s.id ? renderBoxPanel(s) : ''}
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;background:var(--bg)" onclick="toggleOutboundItemsCollapse()">
          <h3 style="font-size:14px;color:var(--ink-soft)">Позиции поставки (${s.items.length})</h3>
          <span style="font-size:12px;color:var(--ink-faint)">${outboundItemsCollapsed ? '▼' : '▲'}</span>
        </div>
        ${outboundItemsCollapsed ? '' : s.items.slice().sort((a,b)=>(a.cell||999999)-(b.cell||999999)).map(it=>{
          const packedForItem = it.qty - getRemainingForItem(s, it.sku, it.size||'');
          const doneForItem = packedForItem >= it.qty;
          return `
          <div class="pick-row">
            <div><div class="sku-name">${it.name}${it.size?` · ${it.size}`:''}</div><div class="sku-code mono">${it.sku}${it.barcode?` · ШК ${it.barcode}`:''}</div></div>
            <div class="qty-need" style="${doneForItem?'color:var(--ok);font-weight:700':''}">${it.cell?`яч. ${it.cell} · `:''}${it.qty} шт <span style="color:var(--ink-faint);font-weight:400">(упаковано ${packedForItem}/${it.qty})</span></div>
          </div>
        `;}).join('')}
      </div>
    </div>
  `;
}
function openEditOutbound(id){ editingOutboundId = id; deletingOutboundId = null; renderOutboundTableWrap(); }
function cancelEditOutbound(){ editingOutboundId = null; renderOutboundTableWrap(); }
function addItemToOutboundEdit(id){
  const s = outboundSupplies.find(x=>x.id===id);
  if(!s) return;
  const select = document.getElementById('editOutNewItemSelect-'+id);
  const key = select.value;
  if(!key){ toast('Выберите товар'); return; }
  const [sku, size] = key.split('~~');
  const qty = Math.max(1, parseInt(document.getElementById('editOutNewItemQty-'+id).value) || 1);
  const inv = findInventoryItem(sku, s.clientName, size, s.sourceWarehouseId);
  if(!inv){ toast('Товар не найден на складе'); return; }
  if(qty > inv.qty){ toast(`На складе только ${inv.qty} шт «${inv.name}»`); return; }
  const already = s.items.find(it=>it.sku===sku && (it.size||'')===(size||''));
  if(already){ toast('Этот товар уже есть в поставке — измените его количество выше'); return; }
  s.items.push({sku, name:inv.name, size:size||'', barcode:inv.barcode||'', qty, cell:inv.cell||null, _isNew:true});
  toast(`Добавлено: «${inv.name}» — не забудьте нажать «Сохранить изменения»`);
  renderOutboundTableWrap();
}
function saveOutboundEdit(id){
  const s = outboundSupplies.find(x=>x.id===id);
  if(!s) return;
  const newDest = document.getElementById('editOutboundDest-'+id).value.trim();
  if(!newDest){ toast('Укажите склад назначения'); return; }

  const changes = [];
  for(const it of s.items){
    const inputEl = document.getElementById(`editOutQty-${id}-${it.sku}-${it.size||''}`);
    if(!inputEl) continue;
    const newQty = Math.max(0, parseInt(inputEl.value)||0);
    const baseQty = it._isNew ? 0 : it.qty;
    const diff = newQty - baseQty;
    if(diff===0){ if(it._isNew) it.qty = newQty; continue; }
    const inv = resolveDraftItem(it, s.clientName, s.sourceWarehouseId);
    if(diff>0 && (!inv || inv.qty < diff)){
      toast(`Недостаточно на складе для «${it.name}» — есть ${inv?inv.qty:0}, нужно ещё ${diff}`);
      return;
    }
    changes.push({it, newQty, diff, inv});
  }

  changes.forEach(({it, newQty, diff, inv})=>{
    if(inv){
      inv.qty -= diff;
      logMovement(inv.sku, inv.name, -diff, `Корректировка поставки на склад: ${newDest}`, inv.client, inv.size);
    }
    it.qty = newQty;
  });
  s.items = s.items.filter(it=>it.qty>0);
  s.items.forEach(it=>{ delete it._isNew; });
  s.destination = newDest;
  editingOutboundId = null;
  toast('Изменения сохранены');
  renderOutbound();
  renderInventory();

  sb.from('outbound_supplies').update({destination:newDest}).eq('id', id).then(({error})=>{ if(error) console.error(error); });
  sb.from('outbound_supply_items').delete().eq('supply_id', id).then(({error})=>{
    if(error){ console.error(error); return; }
    if(s.items.length){
      const rows = s.items.map(it=>({supply_id:id, sku:it.sku, name:it.name, qty:it.qty, barcode:it.barcode||null, cell:it.cell||null, size:it.size||null}));
      sb.from('outbound_supply_items').insert(rows).then(({error})=>{ if(error) console.error(error); });
    }
  });
}
function openDeleteOutbound(id){ deletingOutboundId = id; editingOutboundId = null; renderOutboundTableWrap(); }
function cancelDeleteOutbound(){ deletingOutboundId = null; renderOutboundTableWrap(); }
function confirmDeleteOutbound(id){
  const s = outboundSupplies.find(x=>x.id===id);
  if(!s) return;
  s.items.forEach(it=>{
    const inv = resolveDraftItem(it, s.clientName, s.sourceWarehouseId);
    if(inv){
      inv.qty += it.qty;
      logMovement(inv.sku, inv.name, it.qty, `Отмена поставки на склад: ${s.destination}`, inv.client, inv.size);
    }
  });
  outboundSupplies = outboundSupplies.filter(x=>x.id!==id);
  deletingOutboundId = null;
  if(activeOutboundId===id) activeOutboundId = null;
  toast(`Поставка ${id} удалена, товар возвращён на склад`);
  renderOutbound();
  renderInventory();
  sb.from('outbound_supplies').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить поставку в базе'); }
  });
}
function printPickList(id){
  const s = outboundSupplies.find(x=>x.id===id);
  const items = s.items.slice().sort((a,b)=>(a.cell||999999)-(b.cell||999999));
  const totalQty = items.reduce((a,i)=>a+i.qty,0);
  const dateStr = new Date().toLocaleDateString('ru-RU', {day:'2-digit', month:'long', year:'numeric'});

  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна — разрешите всплывающие окна для этого сайта'); return; }
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Лист подбора ${s.id}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#111;max-width:850px;margin:0 auto;line-height:1.5}
      h1{text-align:center;font-size:18px;margin-bottom:4px}
      .sub{text-align:center;color:#555;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #333;padding:8px;font-size:13px;text-align:left}
      th{background:#f2f2f2}
      td.num,th.num{text-align:right}
      td.check{width:34px;text-align:center}
      .box{display:inline-block;width:18px;height:18px;border:2px solid #333}
      .sign{margin-top:60px;display:flex;justify-content:space-between;gap:40px}
      .sign > div{width:100%}
      .line{border-bottom:1px solid #333;margin-top:44px;margin-bottom:4px}
      .small{font-size:11px;color:#666}
      @media print{ body{padding:20px} }
    </style></head><body>
      <h1>ЛИСТ ПОДБОРА<br>Поставка №${s.id}</h1>
      <div class="sub">${dateStr}</div>
      <p><b>Клиент:</b> ${s.clientName}</p>
      <p><b>Куда:</b> ${s.destination}</p>
      <p>Позиций: ${items.length} · Всего единиц: ${totalQty}</p>
      <table>
        <thead><tr><th class="check">✓</th><th>Ячейка</th><th>Артикул</th><th>ШК товара</th><th>Наименование</th><th class="num">Кол-во</th></tr></thead>
        <tbody>
          ${items.map(it=>`
            <tr>
              <td class="check"><span class="box"></span></td>
              <td><b>${it.cell || '—'}</b></td>
              <td>${it.sku}</td>
              <td>${it.barcode||'—'}</td>
              <td>${it.name}</td>
              <td class="num">${it.qty}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="sign">
        <div>Собрал<div class="line"></div><span class="small">подпись / расшифровка подписи</span></div>
        <div>Проверил<div class="line"></div><span class="small">подпись / расшифровка подписи</span></div>
      </div>
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 300); };<\/script>
    </body></html>
  `);
  win.document.close();
}
document.getElementById('outboundSearch').addEventListener('input', renderOutboundTableWrap);

