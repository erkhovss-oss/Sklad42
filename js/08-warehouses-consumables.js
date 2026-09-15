// ---------- WAREHOUSES ----------
async function loadWarehouses(){
  const { data, error } = await sb.from('warehouses').select('*').order('name').limit(1000);
  if(error){ console.error(error); return; }
  warehouses = data.map(w=>({id:w.id, name:w.name}));
}
function renderWarehouses(){
  const wrap = document.getElementById('warehousesListWrap');
  if(!warehouses.length){
    wrap.innerHTML = `<div class="panel empty">Складов пока нет</div>`;
    return;
  }
  wrap.innerHTML = `
    <div class="panel">
      <table>
        <thead><tr><th>Название</th><th></th></tr></thead>
        <tbody>
          ${warehouses.map(w=>`
            <tr>
              <td>${escapeHtml(w.name)}${w.id==='MAIN'?' <span style="color:var(--ink-faint);font-size:12px">(основной, нельзя удалить)</span>':''}</td>
              <td style="text-align:right">
                ${w.id!=='MAIN' ? `<button class="btn btn-ghost" style="padding:4px 10px;color:var(--warn)" onclick="deleteWarehouse('${w.id}')">Удалить</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function createWarehouse(){
  const input = document.getElementById('newWarehouseName');
  const name = input.value.trim();
  if(!name){ toast('Укажите название склада'); return; }
  const id = 'WH-' + Date.now();
  warehouses.push({id, name});
  input.value = '';
  toast(`Склад «${name}» добавлен`);
  renderWarehouses();
  sb.from('warehouses').insert({id, name}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить склад в базе'); }
  });
}
function deleteWarehouse(id){
  const blockers = [];
  if(inventory.some(i=>(i.warehouseId||'MAIN')===id)) blockers.push('остатки');
  if(supplies.some(s=>(s.warehouseId||'MAIN')===id)) blockers.push('плановые поставки');
  if(outboundSupplies.some(s=>(s.sourceWarehouseId||'MAIN')===id || s.destWarehouseId===id)) blockers.push('поставки на склад');
  if(employees.some(e=>e.warehouseId===id)) blockers.push('сотрудники');
  if(ddsEntries.some(d=>(d.warehouseId||'MAIN')===id)) blockers.push('операции ДДС');
  if(stocktakes.some(s=>s.warehouseId===id)) blockers.push('инвентаризации');
  if(consumables.some(c=>(c.warehouseId||'MAIN')===id)) blockers.push('расходники');
  if(blockers.length){
    toast(`Нельзя удалить склад — с ним ещё связаны: ${blockers.join(', ')}. Сначала перенесите или удалите эти записи.`);
    return;
  }
  const w = warehouses.find(x=>x.id===id);
  if(!confirm(`Удалить склад «${w?w.name:id}»?`)) return;
  warehouses = warehouses.filter(x=>x.id!==id);
  toast('Склад удалён');
  renderWarehouses();
  sb.from('warehouses').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить склад в базе — возможно, появились новые связанные записи. Обновите страницу и попробуйте снова'); }
  });
}
function warehouseName(id){
  const w = warehouses.find(x=>x.id===(id||'MAIN'));
  return w ? w.name : 'Основной склад';
}

// ---------- CONSUMABLES (расходные материалы склада) ----------
async function loadConsumables(){
  const { data, error } = await sb.from('consumables').select('*').order('name').limit(2000);
  if(error){ console.error(error); return; }
  consumables = data.map(c=>({id:c.id, name:c.name, unit:c.unit, qty:Number(c.qty), minThreshold:Number(c.min_threshold), warehouseId:c.warehouse_id||'MAIN'}));
}
function renderConsumables(){
  const whSelect = document.getElementById('newConsumableWarehouse');
  if(hasFullWarehouseAccess()){
    whSelect.innerHTML = warehouses.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
    whSelect.disabled = false;
  } else {
    whSelect.innerHTML = `<option value="${myWarehouseId()}">${escapeHtml(warehouseName(myWarehouseId()))}</option>`;
    whSelect.disabled = true;
  }
  const visible = hasFullWarehouseAccess() ? consumables : consumables.filter(c=>c.warehouseId===myWarehouseId());
  const wrap = document.getElementById('consumablesListWrap');
  if(!visible.length){ wrap.innerHTML = `<div class="panel empty">Расходников пока нет</div>`; return; }
  const lowCount = visible.filter(c=>c.qty<=c.minThreshold && c.minThreshold>0).length;
  wrap.innerHTML = `
    ${lowCount ? `<div class="panel" style="padding:12px 16px;margin-bottom:14px;background:var(--warn-bg);color:var(--warn);font-size:13px;font-weight:600">⚠ Заканчивается: ${lowCount} позиц(ий) — пора заказать</div>` : ''}
    <div class="panel">
      <table class="card-table">
        <thead><tr><th>Название</th><th>Склад</th><th>Остаток</th><th>Мин. остаток</th><th></th></tr></thead>
        <tbody>
          ${visible.map(c=>{
            const low = c.qty<=c.minThreshold && c.minThreshold>0;
            return `
            <tr>
              <td data-label="Название">${escapeHtml(c.name)}</td>
              <td data-label="Склад">${escapeHtml(warehouseName(c.warehouseId))}</td>
              <td data-label="Остаток" style="${low?'color:var(--warn);font-weight:700':''}">${c.qty} ${escapeHtml(c.unit)}${low?' ⚠':''}</td>
              <td data-label="Мин. остаток">${c.minThreshold} ${escapeHtml(c.unit)}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-ghost" style="padding:4px 8px" onclick="adjustConsumableQty('${c.id}', -1)">−</button>
                <button class="btn btn-ghost" style="padding:4px 8px" onclick="adjustConsumableQty('${c.id}', 1)">+</button>
                <button class="btn btn-ghost" style="padding:4px 10px" onclick="openAdjustConsumableModal('${c.id}')">Списать/Пополнить…</button>
                <button class="btn btn-ghost" style="padding:4px 10px;color:var(--warn)" onclick="deleteConsumable('${c.id}')">Удалить</button>
              </td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function createConsumable(){
  const name = document.getElementById('newConsumableName').value.trim();
  const unit = document.getElementById('newConsumableUnit').value;
  const qty = Math.max(0, parseFloat(document.getElementById('newConsumableQty').value) || 0);
  const minThreshold = Math.max(0, parseFloat(document.getElementById('newConsumableMin').value) || 0);
  const warehouseId = document.getElementById('newConsumableWarehouse').value || 'MAIN';
  if(!name){ toast('Укажите название'); return; }
  const id = 'CONS-' + Date.now();
  consumables.push({id, name, unit, qty, minThreshold, warehouseId});
  document.getElementById('newConsumableName').value = '';
  document.getElementById('newConsumableQty').value = '0';
  document.getElementById('newConsumableMin').value = '0';
  toast(`«${name}» добавлен`);
  renderConsumables();
  sb.from('consumables').insert({id, name, unit, qty, min_threshold:minThreshold, warehouse_id:warehouseId}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
function adjustConsumableQty(id, delta, reason){
  const c = consumables.find(x=>x.id===id);
  if(!c) return;
  const newQty = Math.max(0, c.qty + delta);
  const actualDelta = newQty - c.qty;
  c.qty = newQty;
  renderConsumables();
  sb.from('consumables').update({qty:newQty}).eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
  if(actualDelta !== 0){
    sb.from('consumable_movement_log').insert({consumable_id:id, consumable_name:c.name, delta:actualDelta, reason: reason || 'Вручную', employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
      if(error) console.error(error);
    });
  }
}
function openAdjustConsumableModal(id){
  const c = consumables.find(x=>x.id===id);
  if(!c) return;
  const input = prompt(`Текущий остаток «${c.name}»: ${c.qty} ${c.unit}.\nВведите изменение: положительное число — пополнить, отрицательное — списать (например: -50 или 200)`, '');
  if(input===null) return;
  const delta = parseFloat(input);
  if(isNaN(delta) || delta===0){ toast('Введите ненулевое число'); return; }
  const reasonInput = prompt('Комментарий (необязательно):', delta>0 ? 'Пополнение' : 'Списание') || (delta>0 ? 'Пополнение' : 'Списание');
  adjustConsumableQty(id, delta, reasonInput);
}
function deleteConsumable(id){
  const c = consumables.find(x=>x.id===id);
  if(!c) return;
  if(!confirm(`Удалить «${c.name}» из расходников?`)) return;
  consumables = consumables.filter(x=>x.id!==id);
  toast('Расходник удалён');
  renderConsumables();
  sb.from('consumables').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить в базе'); }
  });
}

