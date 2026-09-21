// ---------- INVENTORY ----------
let currentInventoryView = 'stock';
function setInventoryView(view){
  currentInventoryView = view;
  document.getElementById('viewStockBtn').className = 'btn ' + (view==='stock' ? 'btn-accent' : 'btn-ghost');
  document.getElementById('viewWriteoffsBtn').className = 'btn ' + (view==='writeoffs' ? 'btn-accent' : 'btn-ghost');
  document.getElementById('inventoryStockView').style.display = view==='stock' ? 'block' : 'none';
  document.getElementById('inventoryWriteoffsView').style.display = view==='writeoffs' ? 'block' : 'none';
  if(view==='writeoffs') renderWriteoffsView();
}
function renderWriteoffsView(){
  const wrap = document.getElementById('writeoffsTableWrap');
  const searchInput = document.getElementById('writeoffSearch');
  const reasonSelect = document.getElementById('writeoffReasonFilter');
  const q = (searchInput.value || '').toLowerCase();
  const reasonFilter = reasonSelect.value;

  const filtered = writeOffLog.filter(w =>
    (!q || w.sku.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || inventory.some(i=>i.sku===w.sku && (i.barcode||'').toLowerCase().includes(q))) &&
    (!reasonFilter || w.reason === reasonFilter)
  );
  const totalQty = filtered.reduce((s,w)=>s+w.qty,0);

  document.getElementById('writeoffStats').innerHTML = `
    <div class="stat"><div class="val">${filtered.length}</div><div class="lbl">Операций списания</div></div>
    <div class="stat"><div class="val" style="color:var(--warn)">${totalQty}</div><div class="lbl">Единиц списано</div></div>
  `;

  wrap.innerHTML = `
    <div class="panel">
      <table>
        <thead><tr><th>Дата и время</th><th>Артикул</th><th>Товар</th><th>Кол-во</th><th>Причина</th><th>Сотрудник</th></tr></thead>
        <tbody>
          ${filtered.length ? filtered.slice().reverse().map(w=>`
            <tr>
              <td class="mono" style="font-size:12px;color:var(--ink-soft)">${w.time}</td>
              <td class="mono">${w.sku}</td>
              <td>${w.name}</td>
              <td style="color:var(--warn);font-weight:600">−${w.qty} шт</td>
              <td>${w.reason}</td>
              <td style="font-size:12px;color:var(--ink-soft)">${escapeHtml(w.employeeName||'—')}</td>
            </tr>
          `).join('') : `<tr><td colspan="6" class="empty">Списаний не найдено</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}
document.getElementById('writeoffSearch').addEventListener('input', renderWriteoffsView);
document.getElementById('writeoffReasonFilter').addEventListener('change', renderWriteoffsView);

function itemKey(item){
  return item.sku + '~~' + (item.client||'') + '~~' + (item.size||'') + '~~' + (item.warehouseId||'MAIN');
}
function parseItemKey(key){
  const parts = key.split('~~');
  return {sku:parts[0], client:parts[1], size:parts[2], warehouseId:parts[3]||'MAIN'};
}
let invPage = 1;
let invPageSize = parseInt(localStorage.getItem('sklad42_inv_page_size')) || 50;
function resetInventoryPageAndRender(){ invPage = 1; renderInventory(); }
function goInvPage(delta){ invPage += delta; renderInventory(); }
function changeInvPageSize(val){
  invPageSize = parseInt(val) || 50;
  try{ localStorage.setItem('sklad42_inv_page_size', invPageSize); }catch(e){}
  invPage = 1;
  renderInventory();
}
function renderInventory(){
  const q = (document.getElementById('invSearch').value || '').toLowerCase();
  const pageSizeSelect = document.getElementById('invPageSize');
  if(pageSizeSelect) pageSizeSelect.value = String(invPageSize);
  const clientFilter = document.getElementById('invClientFilter').value;
  const cellFilter = document.getElementById('invCellFilter').value;
  const warehouseFilter = hasFullWarehouseAccess()
    ? (document.getElementById('invWarehouseFilter') ? document.getElementById('invWarehouseFilter').value : '')
    : myWarehouseId();
  const body = document.getElementById('invBody');
  const readOnly = !!clientViewMode;

  const clientNames = [...new Set(inventory.map(i=>i.client).filter(Boolean))].sort();
  const filterSelect = document.getElementById('invClientFilter');
  const prevValue = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Все клиенты</option>` + clientNames.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  filterSelect.value = clientNames.includes(prevValue) ? prevValue : '';

  const cellNumbers = [...new Set(inventory.map(i=>i.cell).filter(Boolean))].sort((a,b)=>a-b);
  const cellSelect = document.getElementById('invCellFilter');
  const prevCellValue = cellSelect.value;
  cellSelect.innerHTML = `<option value="">Все ячейки</option>` + cellNumbers.map(c=>`<option value="${c}">Ячейка ${c}</option>`).join('');
  cellSelect.value = cellNumbers.map(String).includes(prevCellValue) ? prevCellValue : '';

  const warehouseSelect = document.getElementById('invWarehouseFilter');
  if(warehouseSelect){
    if(!hasFullWarehouseAccess()){
      warehouseSelect.innerHTML = `<option value="${myWarehouseId()}">${escapeHtml(warehouseName(myWarehouseId()))}</option>`;
      warehouseSelect.value = myWarehouseId();
      warehouseSelect.disabled = true;
    } else {
      const prevWh = warehouseSelect.value;
      warehouseSelect.innerHTML = `<option value="">Все склады</option>` + warehouses.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
      warehouseSelect.value = warehouses.some(w=>w.id===prevWh) ? prevWh : '';
    }
  }

  const rows = inventory.filter(i =>
    (i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.barcode||'').toLowerCase().includes(q)) &&
    (readOnly ? i.client === clientViewMode.name : (!clientFilter || i.client === clientFilter)) &&
    (!cellFilter || String(i.cell)===cellFilter) &&
    (!warehouseFilter || (i.warehouseId||'MAIN')===warehouseFilter)
  ).sort((a,b)=>{
    if(a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
    return (a.size||'').localeCompare(b.size||'');
  }).sort((a,b)=>{
    if(!a.cell && !b.cell) return 0;
    if(!a.cell) return 1;
    if(!b.cell) return -1;
    return a.cell - b.cell;
  });

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / invPageSize));
  if(invPage > totalPages) invPage = totalPages;
  if(invPage < 1) invPage = 1;
  const pageRows = rows.slice((invPage-1)*invPageSize, invPage*invPageSize);

  body.innerHTML = pageRows.map(i => {
    const key = itemKey(i);
    if(!readOnly && editingSku === key){
      return `<tr>
        <td class="mono" style="vertical-align:top;padding-top:14px">${i.sku}</td>
        <td colspan="6" style="max-width:1px">
          <div style="max-width:640px">
          <div style="margin-bottom:8px">
            <input class="search" style="width:100%" id="editName-${escapeHtml(key)}" value="${escapeHtml(i.name)}" placeholder="Название">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <input class="search" style="width:100px" id="editSize-${escapeHtml(key)}" value="${escapeHtml(i.size||'')}" placeholder="Размер">
            <input class="search" style="width:130px" id="editColor-${escapeHtml(key)}" value="${escapeHtml(i.color||'')}" placeholder="Цвет">
            <input class="search mono" style="width:160px" id="editBarcode-${escapeHtml(key)}" value="${escapeHtml(i.barcode||'')}" placeholder="Штрихкод" autocomplete="off">
            <input class="search" style="flex:1;min-width:140px" id="editClient-${escapeHtml(key)}" value="${escapeHtml(i.client||'')}" placeholder="Клиент">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div style="flex:1;min-width:160px"><div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">Склад</div>
              <select class="search" id="editWarehouse-${escapeHtml(key)}" style="width:100%">
                ${warehouses.map(w=>`<option value="${w.id}" ${(i.warehouseId||'MAIN')===w.id?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}
              </select>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-soft);cursor:pointer;align-self:flex-end;padding-bottom:8px">
              <input type="checkbox" id="editRequiresKiz-${escapeHtml(key)}" ${i.requiresKiz?'checked':''}>
              Требует КИЗ (Честный Знак)
            </label>
            <a href="https://xn--80ajghhoc2aj1c8b.xn--p1ai/business/projects/" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);align-self:flex-end;padding-bottom:10px;white-space:nowrap">проверить категорию →</a>
          </div>
          <div style="margin-bottom:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-soft);cursor:pointer">
              <input type="checkbox" id="editIsKit-${escapeHtml(key)}" ${i.isKit?'checked':''} onchange="toggleKitEditor('${escapeHtml(key)}')">
              🧩 Это набор/комплект
            </label>
            <div id="kitEditor-${escapeHtml(key)}" style="display:${i.isKit?'block':'none'};margin-top:8px;padding:12px;background:var(--bg);border-radius:8px">
              <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:4px;font-size:12px">
                  <input type="radio" name="kitMode-${escapeHtml(key)}" value="virtual" ${i.kitMode!=='assembled'?'checked':''}> Виртуальный (считать по составляющим)
                </label>
                <label style="display:flex;align-items:center;gap:4px;font-size:12px">
                  <input type="radio" name="kitMode-${escapeHtml(key)}" value="assembled" ${i.kitMode==='assembled'?'checked':''}> Собран заранее (свой остаток)
                </label>
              </div>
              <div style="font-size:11px;color:var(--ink-faint);margin-bottom:6px">Состав набора:</div>
              <div id="kitComponentsList-${escapeHtml(key)}" style="margin-bottom:8px">
                ${getKitComponents(i).map(c=>{
                  const compItem = findInventoryItem(c.componentSku, i.client, c.componentSize, i.warehouseId);
                  return `<div class="kit-component-row" data-sku="${escapeHtml(c.componentSku)}" data-size="${escapeHtml(c.componentSize||'')}" style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                    <span style="flex:1;font-size:12px">${escapeHtml(compItem?compItem.name:c.componentSku)}${c.componentSize?` (${c.componentSize})`:''}</span>
                    <input class="search mono kit-comp-qty" type="number" min="0.01" step="0.01" value="${c.qtyNeeded}" style="width:70px">
                    <span style="font-size:11px;color:var(--ink-faint)">шт/набор</span>
                    <button class="btn btn-ghost" style="padding:2px 8px" onclick="this.parentElement.remove()">✕</button>
                  </div>`;
                }).join('')}
              </div>
              <div style="display:flex;gap:8px">
                <select class="search" id="kitAddComponentSelect-${escapeHtml(key)}" style="flex:1;font-size:12px">
                  <option value="">— добавить составляющую —</option>
                  ${inventory.filter(x=>x.client===i.client && (x.warehouseId||'MAIN')===(i.warehouseId||'MAIN') && !(x.sku===i.sku && (x.size||'')===(i.size||'')) && !x.isKit).map(x=>`<option value="${escapeHtml(x.sku+'~~'+(x.size||''))}">${escapeHtml(x.name)}${x.size?` (${x.size})`:''}</option>`).join('')}
                </select>
                <button class="btn btn-ghost" onclick="addKitComponentFromSelect('${escapeHtml(key)}','${escapeHtml(i.client||'')}','${escapeHtml(i.warehouseId||'MAIN')}')">+ Добавить</button>
              </div>
              <p style="font-size:11px;color:var(--ink-faint);margin-top:8px">Виртуальный набор — остаток считается сам по тому, что реально есть в составляющих (поле «Кол-во» ниже станет нередактируемым). Собранный заранее — обычный товар со своим остатком, состав только для справки.</p>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div><div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">Кол-во</div><input class="search" type="number" min="0" style="width:90px" id="editQty-${escapeHtml(key)}" value="${i.isKit && i.kitMode!=='assembled' ? computeKitAvailability(i).available : i.qty}" ${i.isKit && i.kitMode!=='assembled' ? 'disabled title="Виртуальный набор — считается по составляющим"' : ''}></div>
            <div><div style="font-size:11px;color:var(--ink-faint);margin-bottom:2px">Ячейка</div><input class="search mono" type="number" min="1" style="width:90px" id="editCell-${escapeHtml(key)}" value="${i.cell||''}"></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--ink-soft);white-space:nowrap">Габариты, см:</span>
            <input class="search mono" type="number" min="0" step="0.1" style="width:64px" id="editDimsL-${escapeHtml(key)}" value="${i.dims&&i.dims.l||''}" placeholder="Д">
            <span style="color:var(--ink-faint)">×</span>
            <input class="search mono" type="number" min="0" step="0.1" style="width:64px" id="editDimsW-${escapeHtml(key)}" value="${i.dims&&i.dims.w||''}" placeholder="Ш">
            <span style="color:var(--ink-faint)">×</span>
            <input class="search mono" type="number" min="0" step="0.1" style="width:64px" id="editDimsH-${escapeHtml(key)}" value="${i.dims&&i.dims.h||''}" placeholder="В">
            <span style="font-size:11px;color:var(--ink-faint)">нужно для расчёта хранения</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--ink-soft);white-space:nowrap">Доп. штрихкоды:</span>
            ${inventoryBarcodes.filter(b=>b.sku===i.sku && (b.clientName||'')===(i.client||'') && (b.size||'')===(i.size||'')).map(b=>`
              <span class="mono" style="font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:3px 8px;display:inline-flex;align-items:center;gap:6px">${escapeHtml(b.barcode)}<span class="inv-act" style="cursor:pointer;color:var(--warn);font-weight:700" data-act="removeExtraBarcode" data-key="${escapeHtml(key)}" data-barcode="${escapeHtml(b.barcode)}">✕</span></span>
            `).join('') || '<span style="font-size:12px;color:var(--ink-faint)">пока нет</span>'}
            <input class="search mono" style="width:150px" id="newExtraBarcode-${escapeHtml(key)}" placeholder="ещё один ШК" autocomplete="off">
            <button class="btn btn-ghost inv-act" style="padding:5px 10px" data-act="addExtraBarcode" data-key="${escapeHtml(key)}">+ Добавить</button>
          </div>
          <div style="display:flex;justify-content:flex-start;gap:8px;padding-top:8px;border-top:1px solid var(--line)">
            <button class="btn btn-primary inv-act" style="padding:6px 14px" data-act="saveEdit" data-key="${escapeHtml(key)}">Сохранить</button>
            <button class="btn btn-ghost" style="padding:6px 14px" onclick="cancelEdit()">Отмена</button>
          </div>
          </div>
        </td>
      </tr>`;
    }
    if(!readOnly && writeOffSku === key){
      return `<tr>
        <td class="mono">${i.sku}</td>
        <td colspan="5">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--ink-soft)">Списать</span>
            <input class="search" type="number" min="1" max="${i.qty}" value="1" id="woQty-${escapeHtml(key)}" style="width:70px;padding:6px 10px">
            <span style="font-size:13px;color:var(--ink-soft)">шт из ${i.qty}, причина:</span>
            <select class="search" id="woReason-${escapeHtml(key)}" style="width:170px;padding:6px 10px">
              <option>Брак</option>
              <option>Порча при хранении</option>
              <option>Утеря</option>
              <option>Пересортица</option>
              <option>Другое</option>
            </select>
          </div>
        </td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-accent inv-act" style="padding:5px 10px" data-act="confirmWriteOff" data-key="${escapeHtml(key)}">Списать</button>
          <button class="btn btn-ghost" style="padding:5px 10px" onclick="cancelWriteOff()">Отмена</button>
        </td>
      </tr>`;
    }
    if(!readOnly && deletingSku === key){
      return `<tr>
        <td class="mono">${i.sku}</td>
        <td colspan="6">
          <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
            <span style="font-size:13px;color:var(--warn)">Удалить «${escapeHtml(i.name)}»${i.size?` (размер ${escapeHtml(i.size)})`:''} из остатков без возможности восстановить?</span>
            <div style="white-space:nowrap">
              <button class="btn btn-accent inv-act" style="padding:5px 10px" data-act="confirmDelete" data-key="${escapeHtml(key)}">Да, удалить</button>
              <button class="btn btn-ghost" style="padding:5px 10px" onclick="cancelDelete()">Отмена</button>
            </div>
          </div>
        </td>
      </tr>`;
    }
    let rowsHtml = `<tr>
      <td class="mono" data-label="Артикул">${i.sku}</td>
      <td data-label="Товар">${i.name}</td>
      <td data-label="Размер">${i.size||'—'}</td>
      <td class="mono" data-label="Штрихкод">${i.barcode||'—'}${i.barcode?`<div style="color:var(--ink-faint);font-size:11px">яч. ${i.cell||'—'}</div>`:''}</td>
      <td data-label="Клиент">${i.client||'—'}</td>
      <td data-label="Склад">${escapeHtml(warehouseName(i.warehouseId))}</td>
      <td data-label="Остаток" class="${(i.isKit&&i.kitMode!=='assembled'?computeKitAvailability(i).available:i.qty)<=3?'qty-low':''}">${
        i.isKit && i.kitMode!=='assembled'
          ? (()=>{ const av=computeKitAvailability(i); return `${av.available} шт <span style="font-size:10px;color:var(--accent)">🧩 виртуальный</span>${av.bottleneck?`<div style="color:var(--ink-faint);font-size:10px">лимит: ${escapeHtml(av.bottleneck.name)} (${av.bottleneck.have} шт)</div>`:''}`; })()
          : `${i.qty} шт${i.isKit?' <span style="font-size:10px;color:var(--accent)">🧩 собран</span>':''}${i.dims&&i.dims.l&&i.dims.w&&i.dims.h ? `<span style="color:var(--ink-faint);font-size:11px"> · ${((i.dims.l*i.dims.w*i.dims.h/1000)*i.qty).toFixed(1)} л</span>` : ''}`
      }</td>
      <td style="text-align:right;white-space:nowrap">
        ${readOnly ? `
        <button class="btn btn-ghost inv-act" style="padding:5px 10px" data-act="openHistory" data-key="${escapeHtml(key)}">История</button>
        ` : `
        <button class="btn btn-ghost inv-act" style="padding:5px 10px" data-act="adjustQty" data-key="${escapeHtml(key)}" data-delta="-1">−</button>
        <button class="btn btn-ghost inv-act" style="padding:5px 10px" data-act="adjustQty" data-key="${escapeHtml(key)}" data-delta="1">+</button>
        <button class="btn btn-ghost inv-act" style="padding:5px 10px" data-act="startEdit" data-key="${escapeHtml(key)}">Изменить</button>
        <button class="btn btn-ghost inv-act" style="padding:5px 10px" data-act="openHistory" data-key="${escapeHtml(key)}">История</button>
        <button class="btn btn-ghost inv-act" style="padding:5px 10px;color:var(--warn)" data-act="openWriteOff" data-key="${escapeHtml(key)}">Списать</button>
        <button class="btn btn-ghost inv-act" style="padding:5px 10px;color:var(--warn)" data-act="openDelete" data-key="${escapeHtml(key)}">Удалить</button>
        `}
      </td>
    </tr>`;
    if(historySku === key){
      const moves = movementLog.filter(m=>m.sku===i.sku && (m.client||'')===(i.client||'') && (m.size||'')===(i.size||'')).slice().reverse().slice(0,20);
      rowsHtml += `<tr>
        <td colspan="7" style="padding:0">
          <div style="padding:14px 18px;background:var(--bg);border-top:1px solid var(--line)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div class="eyebrow">История движения — ${i.sku}${i.size?` (${i.size})`:''}</div>
              <button class="btn btn-ghost" style="padding:4px 10px" onclick="closeHistory()">Свернуть ▲</button>
            </div>
            ${moves.length ? moves.map(m=>`
              <div class="pick-row" style="background:transparent">
                <div><div class="sku-name" style="font-size:13px">${m.type}</div><div class="sku-code mono">${m.time}${m.employeeName?` · ${escapeHtml(m.employeeName)}`:''}</div></div>
                <div class="qty-need" style="color:${m.delta>=0?'var(--ok)':'var(--warn)'};font-weight:600">${m.delta>=0?'+':''}${m.delta} шт</div>
              </div>
            `).join('') : `<p style="font-size:13px;color:var(--ink-faint);margin:0">Движений пока не было</p>`}
          </div>
        </td>
      </tr>`;
    }
    return rowsHtml;
  }).join('') || `<tr><td colspan="7" class="empty">Ничего не найдено</td></tr>`;

  const statSource = (readOnly || clientFilter) ? rows : inventory;
  const total = statSource.reduce((s,i)=>s+i.qty,0);
  const low = statSource.filter(i=>i.qty<=3).length;
  document.getElementById('invStats').innerHTML = `
    <div class="stat"><div class="val">${statSource.length}</div><div class="lbl">Позиций на складе</div></div>
    <div class="stat"><div class="val">${total}</div><div class="lbl">Единиц товара всего</div></div>
    <div class="stat"><div class="val" style="color:${low?'var(--warn)':'var(--ink)'}">${low}</div><div class="lbl">Позиций заканчивается</div></div>
  `;

  const paginationEl = document.getElementById('invPagination');
  if(paginationEl){
    if(!totalItems){
      paginationEl.innerHTML = '';
    } else {
      const from = (invPage-1)*invPageSize + 1;
      const to = Math.min(invPage*invPageSize, totalItems);
      paginationEl.innerHTML = `
        <span style="font-size:13px;color:var(--ink-soft)">Показано ${from}–${to} из ${totalItems}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goInvPage(-1)" ${invPage<=1?'disabled':''}>← Назад</button>
          <span style="font-size:13px;color:var(--ink-soft);white-space:nowrap">Стр. ${invPage} из ${totalPages}</span>
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goInvPage(1)" ${invPage>=totalPages?'disabled':''}>Вперёд →</button>
        </div>
      `;
    }
  }
}
function adjustQty(key, delta){
  const {sku, client, size} = parseItemKey(key);
  const item = findInventoryItem(sku, client, size);
  if(!item) return;
  const actualDelta = Math.max(0, item.qty + delta) - item.qty;
  item.qty = Math.max(0, item.qty + delta);
  if(actualDelta!==0) logMovement(sku, item.name, actualDelta, 'Ручная корректировка', item.client, item.size);
  renderInventory();
  const cl = clients.find(c=>c.name===item.client);
  if(cl && actualDelta!==0) recordStorageSnapshot(cl);
}
function startEdit(key){ editingSku = key; writeOffSku = null; deletingSku = null; historySku = null; renderInventory(); }
function cancelEdit(){ editingSku = null; renderInventory(); }
async function saveEdit(key){
  const {sku, client, size, warehouseId} = parseItemKey(key);
  const item = findInventoryItem(sku, client, size, warehouseId);
  const name = document.getElementById('editName-'+key).value.trim();
  const newSize = document.getElementById('editSize-'+key).value.trim();
  const barcode = document.getElementById('editBarcode-'+key).value.trim();
  const newClient = document.getElementById('editClient-'+key).value.trim();
  const newWarehouseId = document.getElementById('editWarehouse-'+key).value;
  const requiresKiz = document.getElementById('editRequiresKiz-'+key).checked;
  const color = document.getElementById('editColor-'+key).value.trim();
  const isKit = document.getElementById('editIsKit-'+key).checked;
  const kitModeRadio = Array.from(document.getElementsByName('kitMode-'+key)).find(r=>r.checked);
  const kitMode = kitModeRadio ? kitModeRadio.value : 'virtual';
  const qty = Math.max(0, parseInt(document.getElementById('editQty-'+key).value) || 0);
  const cellRaw = document.getElementById('editCell-'+key).value.trim();
  const newCell = cellRaw ? Math.max(1, parseInt(cellRaw) || 0) : null;
  const l = parseFloat(document.getElementById('editDimsL-'+key).value) || 0;
  const w = parseFloat(document.getElementById('editDimsW-'+key).value) || 0;
  const h = parseFloat(document.getElementById('editDimsH-'+key).value) || 0;
  if(!name){ toast('Название не может быть пустым'); return; }
  if(newCell !== null && newCell !== item.cell){
    const conflict = inventory.find(i=> i!==item && i.cell===newCell);
    if(conflict){
      toast(`Ячейка ${newCell} уже занята: «${conflict.name}»${conflict.client?` (${conflict.client})`:''}`);
      return;
    }
  }
  const qtyDelta = qty - item.qty;
  const oldSku = item.sku, oldClient = item.client, oldSize = item.size, oldWarehouseId = item.warehouseId||'MAIN';
  const hadCellBefore = !!item.cell;
  item.name = name;
  item.size = newSize || '';
  item.barcode = barcode || '';
  item.client = newClient || '—';
  item.warehouseId = newWarehouseId || 'MAIN';
  item.requiresKiz = requiresKiz;
  item.color = color;
  item.isKit = isKit;
  item.kitMode = isKit ? kitMode : null;
  item.qty = qty;
  item.dims = (l>0 && w>0 && h>0) ? {l, w, h, weight:(item.dims&&item.dims.weight)||0} : null;
  if(newCell !== null){
    item.cell = newCell;
    sb.rpc('bump_cell_sequence', { new_val: newCell }).then(({error})=>{ if(error) console.error(error); });
  } else if(cellRaw===''){
    item.cell = null;
  }
  if(!item.cell && !hadCellBefore) await ensureCellAssigned(item);
  if(newSize!==oldSize || newClient!==oldClient || item.warehouseId!==oldWarehouseId){
    sb.from('inventory').delete().eq('sku', oldSku).eq('client_name', oldClient||'').eq('size', oldSize||'').eq('warehouse_id', oldWarehouseId).then(({error})=>{
      if(error) console.error(error);
    });
  }
  syncInventoryRow(item.sku, item.client, item.size, item.warehouseId);
  if(isKit) await saveKitComponents(item, draftKitComponentRows());
  if(qtyDelta!==0 && !(isKit && kitMode!=='assembled')) logMovement(item.sku, name, qtyDelta, 'Изменение карточки', item.client, item.size);
  editingSku = null;
  toast('Изменения сохранены');
  renderInventory();
  const cl = clients.find(c=>c.name===item.client);
  if(cl) recordStorageSnapshot(cl);
}
function openWriteOff(key){ writeOffSku = key; editingSku = null; deletingSku = null; historySku = null; renderInventory(); }
function cancelWriteOff(){ writeOffSku = null; renderInventory(); }
function confirmWriteOff(key){
  const {sku, client, size} = parseItemKey(key);
  const item = findInventoryItem(sku, client, size);
  const qty = Math.max(1, parseInt(document.getElementById('woQty-'+key).value) || 1);
  const reason = document.getElementById('woReason-'+key).value;
  if(qty > item.qty){ toast('Нельзя списать больше, чем есть на складе'); return; }
  item.qty -= qty;
  logWriteOff(item.sku, item.name, qty, reason, item.client, item.size);
  toast(`Списано: ${item.name} −${qty} шт (${reason})`);
  writeOffSku = null;
  renderInventory();
  const cl = clients.find(c=>c.name===item.client);
  if(cl) recordStorageSnapshot(cl);
}
function logWriteOff(sku, name, qty, reason, client, size){
  const now = new Date();
  const time = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  const dd = now.getDate().toString().padStart(2,'0');
  const mm = (now.getMonth()+1).toString().padStart(2,'0');
  writeOffLog.push({sku, name, qty, reason, time: `${dd}.${mm} ${time}`, employeeName: currentUser?currentUser.name:''});
  sb.from('write_off_log').insert({sku, name, qty, reason, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
  logMovement(sku, name, -qty, 'Списание: '+reason, client, size);
}
function openDelete(key){ deletingSku = key; editingSku = null; writeOffSku = null; historySku = null; renderInventory(); }
function cancelDelete(){ deletingSku = null; renderInventory(); }
function confirmDelete(key){
  const {sku, client, size} = parseItemKey(key);
  const item = findInventoryItem(sku, client, size);
  inventory = inventory.filter(i=>itemKey(i)!==key);
  deletingSku = null;
  if(item){
    sb.from('movement_log').insert({sku, name:item.name, delta:-item.qty, type:'Удаление карточки', client_name:item.client||null, size:item.size||null, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
  }
  sb.from('inventory').delete().eq('sku', sku).eq('client_name', client||'').eq('size', size||'').then(({error})=>{ if(error){ console.error(error); toast('Не удалось удалить в базе'); } });
  toast(`Карточка «${item ? item.name : sku}» удалена`);
  renderInventory();
  const cl = item && clients.find(c=>c.name===item.client);
  if(cl) recordStorageSnapshot(cl);
  if(item) scheduleWbAutoSync(item.client);
}
function openHistory(key){ historySku = historySku===key ? null : key; editingSku=null; writeOffSku=null; deletingSku=null; renderInventory(); }
function closeHistory(){ historySku = null; renderInventory(); }
function findInventoryItem(sku, client, size, warehouseId){
  return inventory.find(i=>{
    if(i.sku!==sku) return false;
    if(client!==undefined && (i.client||'')!==(client||'')) return false;
    if(size!==undefined && (i.size||'')!==(size||'')) return false;
    if(warehouseId!==undefined && (i.warehouseId||'MAIN')!==(warehouseId||'MAIN')) return false;
    return true;
  });
}
let inventoryBarcodes = []; // {barcode, sku, clientName, size} — доп. штрихкоды сверх основного
function findInventoryItemByBarcode(barcode, client, warehouseId){
  if(!barcode) return null;
  let item = inventory.find(i=> i.barcode===barcode && (client===undefined || (i.client||'')===(client||'')) && (warehouseId===undefined || (i.warehouseId||'MAIN')===(warehouseId||'MAIN')) );
  if(item) return item;
  const extra = inventoryBarcodes.find(b=> b.barcode===barcode && (client===undefined || (b.clientName||'')===(client||'')) );
  if(extra) return findInventoryItem(extra.sku, extra.clientName, extra.size, warehouseId);
  return null;
}
function resolveDraftItem(d, clientName, warehouseId){
  if(d.cell){
    const byCell = inventory.find(i=>i.cell===d.cell);
    if(byCell) return byCell;
  }
  if(d.barcode){
    const byBarcode = findInventoryItemByBarcode(d.barcode, clientName, warehouseId);
    if(byBarcode) return byBarcode;
  }
  return findInventoryItem(d.sku, clientName, d.size||'', warehouseId);
}
function logMovement(sku, name, delta, type, client, size){
  const now = new Date();
  const time = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  movementLog.push({sku, name, delta, type, time, client, size});
  sb.from('movement_log').insert({sku, name, delta, type, client_name: client||null, size: size||null, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null})
    .then(({error})=>{ if(error) console.error(error); })
    .catch(e=>{ console.error(e); toast('Нет связи с базой — запись истории не сохранилась'); });
  applyInventoryDelta(sku, client, size, undefined, delta);
}
// Атомарно меняет остаток НА delta (может быть отрицательным) через серверную функцию —
// не «прочитал-изменил-записал» из браузера (это теряет параллельные изменения от
// других сотрудников), а «прибавь N к тому, что реально сейчас в базе». Итоговое
// значение из базы становится новым локальным qty — локальная копия не может
// разойтись с базой навсегда, даже если гонка случилась.
async function applyInventoryDelta(sku, client, size, warehouseId, delta){
  const item = findInventoryItem(sku, client, size, warehouseId);
  if(!item) return;
  try{
    const { data, error } = await sb.rpc('apply_inventory_delta', {
      p_sku: item.sku, p_client_name: item.client||'', p_size: item.size||'',
      p_warehouse_id: item.warehouseId||'MAIN', p_delta: delta,
      p_name: item.name, p_barcode: item.barcode||null
    });
    if(error){ console.error(error); toast(`Не удалось сохранить остаток «${item.name}» в базе — обновите страницу и проверьте количество`); return; }
    if(item.qty !== data){ item.qty = data; renderInventory(); }
    syncInventoryRow(item.sku, item.client, item.size, item.warehouseId);
  }catch(e){
    console.error(e);
    toast(`Нет связи с базой — остаток «${item.name}» не сохранился, проверьте интернет и повторите`);
  }
}
// Синхронизирует ВСЁ, КРОМЕ количества (имя, штрихкод, ячейка, габариты и т.д.) —
// эти поля не подвержены той же гонке (их не увеличивают/уменьшают на N, а просто
// задают), поэтому обычный upsert тут безопасен как и раньше.
async function syncInventoryRow(sku, client, size, warehouseId){
  const item = findInventoryItem(sku, client, size, warehouseId);
  if(!item) return;
  try{
    const { error } = await sb.from('inventory').upsert({
      sku: item.sku, name: item.name,
      client_name: item.client || '',
      size: item.size || '',
      warehouse_id: item.warehouseId || 'MAIN',
      requires_kiz: item.requiresKiz || false,
      color: item.color || null,
      is_kit: item.isKit || false,
      kit_mode: item.kitMode || null,
      vendor_code: item.vendorCode || null,
      barcode: item.barcode || null,
      dims: item.dims || null,
      cell: item.cell || null
    }, { onConflict: 'sku,client_name,size,warehouse_id', ignoreDuplicates: false });
    if(error){ console.error(error); toast(`Не сохранилось в базе: ${item.name} — повторите действие`); }
    else{ scheduleWbAutoSync(item.client); }
  }catch(e){
    console.error(e);
    toast(`Нет связи с базой — «${item.name}» не сохранился, проверьте интернет и повторите`);
  }
}
let wbAutoSyncTimers = {};
function scheduleWbAutoSync(clientName){
  if(!clientName) return;
  const client = clients.find(c=>c.name===clientName);
  if(!client || !client.wbConnected || !client.wbWarehouseId || !client.wbAutoSync) return;
  if(wbAutoSyncTimers[client.id]) clearTimeout(wbAutoSyncTimers[client.id]);
  wbAutoSyncTimers[client.id] = setTimeout(()=>{
    delete wbAutoSyncTimers[client.id];
    pushStocksToWbSilent(client.id);
  }, 3000);
}
async function pushStocksToWbSilent(clientId){
  try{
    const { data, error } = await sb.functions.invoke('wb-sync-stocks-ts', { body: { clientId, action: 'push_stocks' } });
    if(error){ toast('WB (авто): ' + await extractFnErrorMessage(error)); return; }
    if(data && data.error){ toast('WB (авто): ' + data.error); return; }
    toast(`WB: остатки обновлены автоматически (${data.sent} поз.)`);
  }catch(e){ /* тихо игнорируем — не спамим, если сервер недоступен */ }
}
document.getElementById('invSearch').addEventListener('input', resetInventoryPageAndRender);
document.getElementById('invClientFilter').addEventListener('change', resetInventoryPageAndRender);
document.getElementById('invCellFilter').addEventListener('change', resetInventoryPageAndRender);
document.getElementById('invWarehouseFilter').addEventListener('change', resetInventoryPageAndRender);
document.getElementById('invPageSize').addEventListener('change', function(){ changeInvPageSize(this.value); });

// ---------- RECEIVING ----------
function renderReceiving(mode){
  currentReceivingMode = mode || currentReceivingMode || 'scan';
  const body = document.getElementById('receivingBody');
  const totalQty = receivingLog.reduce((s,r)=>s+r.qty,0);

  body.innerHTML = `
    <div class="assembly-layout">
      <div class="scan-box">
        <div class="eyebrow">Режим приёмки</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn ${currentReceivingMode==='scan'?'btn-accent':'btn-ghost'}" style="flex:1;justify-content:center;${currentReceivingMode!=='scan'?'color:#fff;border-color:#3A362D':''}" onclick="renderReceiving('scan')">Сканером</button>
          <button class="btn ${currentReceivingMode==='manual'?'btn-accent':'btn-ghost'}" style="flex:1;justify-content:center;${currentReceivingMode!=='manual'?'color:#fff;border-color:#3A362D':''}" onclick="renderReceiving('manual')">Вручную</button>
          <button class="btn btn-ghost sound-toggle" style="color:#fff;border-color:#3A362D;white-space:nowrap" onclick="toggleSound()">${soundEnabled?'🔊 Звук':'🔇 Звук'}</button>
        </div>

        ${currentReceivingMode==='scan' ? `
          <div class="eyebrow" style="margin-top:16px">Штрихкод</div>
          <input class="scan-input" id="receiveScanInput" placeholder="Штрихкод…" style="margin-top:6px" autocomplete="off">
          <div class="scan-hint">Сканируйте штрихкод — товар прибавится на складе, а голос назовёт номер ячейки цифрами. Новый штрихкод получает следующий свободный номер по порядку (1, 2, 3…) и запоминает его навсегда. Незнакомый штрихкод — система спросит название и артикул.</div>
        ` : `
          <div class="eyebrow" style="margin-top:16px">Товар</div>
          <select id="receiveSelect" class="scan-input" style="margin-top:6px">
            ${inventory.map(i=>`<option value="${escapeHtml(i.sku)}">${escapeHtml(i.sku)} — ${escapeHtml(i.name)}</option>`).join('')}
            <option value="__new__">+ Новый товар (создать)</option>
          </select>
          <div id="newSkuFields" style="display:none;margin-top:10px">
            <input class="scan-input" id="newSkuCode" placeholder="Новый артикул, напр. TK-5001">
            <input class="scan-input" id="newSkuName" placeholder="Название товара" style="margin-top:8px">
          </div>
          <div class="eyebrow" style="margin-top:14px">Количество</div>
          <input class="scan-input" id="receiveQty" type="number" min="1" value="1" style="margin-top:6px">
          <button class="btn btn-accent" style="margin-top:14px;width:100%;justify-content:center" onclick="submitManualReceipt()">Принять на склад</button>
        `}
      </div>

      <div class="panel" style="flex:1">
        <div style="padding:16px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
          <h3 style="font-size:15px;color:var(--ink-soft)">Принято за смену</h3>
          <div class="mono" style="font-size:13px;color:var(--ink-soft)">+${totalQty} шт · ${receivingLog.length} операций</div>
        </div>
        ${receivingLog.length ? receivingLog.slice().reverse().map(r=>{
          const invItem = inventory.find(i=>i.sku===r.sku);
          const cellInfo = invItem && invItem.cell ? ` · яч. ${invItem.cell}` : '';
          return `
          <div class="pick-row">
            <div>
              <div class="sku-name">${r.name}</div>
              <div class="sku-code mono">${r.sku} · ${r.time}${cellInfo}</div>
            </div>
            <div class="qty-need" style="color:var(--ok);font-weight:600">+${r.qty} шт</div>
          </div>
        `;}).join('') : `<div class="empty" style="padding:40px"><span class="eyebrow">Пока пусто</span>Первая приёмка появится здесь</div>`}
      </div>
    </div>
  `;

  if(currentReceivingMode==='scan'){
    const input = document.getElementById('receiveScanInput');
    input.focus();
    input.addEventListener('keydown', async (e)=>{
      if(e.key!=='Enter') return;
      const code = input.value.trim();
      input.value='';
      if(!code) return;
      const item = inventory.find(i=>i.barcode===code);
      if(item){
        item.qty += 1;
        logReceipt(item.sku, item.name, 1);
        playBeep('ok');
        const cell = await ensureCellAssigned(item);
        announceCell(cell);
        pushRecentAction({name:item.name, sku:item.sku, qty:1, cell});
        toast(`+1 шт: ${item.name} → Ячейка ${cell}`);
        renderReceiving('scan');
      } else {
        playBeep('warn');
        const name = prompt('Штрихкод '+code+' не найден. Название нового товара:');
        if(name){
          const sku = (prompt('Артикул для нового товара:') || ('SKU-'+Date.now())).trim().toUpperCase();
          const newItem = {sku, name, qty:1, barcode:code};
          inventory.push(newItem);
          const cell = await ensureCellAssigned(newItem);
          logReceipt(sku, name, 1);
          announceCell(cell);
          pushRecentAction({name, sku, qty:1, cell, note:'новый товар'});
          toast(`Новый товар добавлен: ${name} → Ячейка ${cell}`);
        }
        renderReceiving('scan');
      }
    });
  } else {
    const select = document.getElementById('receiveSelect');
    select.addEventListener('change', ()=>{
      document.getElementById('newSkuFields').style.display = select.value==='__new__' ? 'block' : 'none';
    });
  }
}

function submitManualReceipt(){
  const select = document.getElementById('receiveSelect');
  const qty = Math.max(1, parseInt(document.getElementById('receiveQty').value)||1);
  if(select.value==='__new__'){
    const code = document.getElementById('newSkuCode').value.trim().toUpperCase();
    const name = document.getElementById('newSkuName').value.trim();
    if(!code || !name){ toast('Укажите артикул и название нового товара'); return; }
    if(inventory.find(i=>i.sku===code)){ toast('Такой артикул уже существует'); return; }
    inventory.push({sku:code, name, qty});
    logReceipt(code, name, qty);
    pushRecentAction({name, sku:code, qty, note:'новый товар, вручную'});
    toast(`Новый товар «${name}» принят: ${qty} шт`);
  } else {
    const item = inventory.find(i=>i.sku===select.value);
    item.qty += qty;
    logReceipt(item.sku, item.name, qty);
    pushRecentAction({name:item.name, sku:item.sku, qty, note:'вручную'});
    toast(`Принято: ${item.name} +${qty} шт`);
  }
  renderReceiving('manual');
}

function logReceipt(sku, name, qty, client, size){
  const now = new Date();
  const time = now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  receivingLog.push({sku, name, qty, time});
  sb.from('receiving_log').insert({sku, name, qty, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null})
    .then(({error})=>{ if(error) console.error(error); })
    .catch(e=>{ console.error(e); toast('Нет связи с базой — запись приёмки не сохранилась'); });
  logMovement(sku, name, qty, 'Приёмка', client, size);
  if(client){
    const cl = clients.find(c=>c.name===client);
    if(cl && cl.receivingPricePerUnit > 0){
      const amount = qty * cl.receivingPricePerUnit;
      const id = 'RECV-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
      const description = `Приёмка: ${name}${size?` (${size})`:''} × ${qty} шт`;
      const dateStr = new Date().toISOString().slice(0,10);
      const entry = {id, type:'income', category:'Приёмка', amount, description, clientId:cl.id, clientName:cl.name, date:dateStr, warehouseId:'MAIN', createdAt:new Date().toISOString()};
      ddsEntries.unshift(entry);
      sb.from('dds_entries').insert({id, type:'income', category:'Приёмка', amount, description, client_id:cl.id, client_name:cl.name, date:dateStr, warehouse_id:'MAIN', employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
        if(error) console.error(error);
      });
    }
  }
}

