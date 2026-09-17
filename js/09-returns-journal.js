// ---------- RETURNS & JOURNAL ----------
async function loadReturns(){
  const { data, error } = await sb.from('returns').select('*').order('created_at',{ascending:false}).limit(500);
  if(error){ console.error(error); return; }
  returns_ = data.map(r=>({id:r.id, sku:r.sku, name:r.name, size:r.size||'', clientName:r.client_name||'', warehouseId:r.warehouse_id||'MAIN', qty:r.qty, orderId:r.order_id||'', reason:r.reason||'', resolution:r.resolution, employeeName:r.employee_name||'', createdAt:r.created_at}));
}
let returns_ = [];
let foundReturnItem = null;
function populateReturnClientFilter(){
  const sel = document.getElementById('returnClientFilter');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">Любой клиент</option>` + clients.map(c=>`<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = current;
}
function findReturnItem(){
  const code = document.getElementById('returnBarcode').value.trim();
  const clientFilter = document.getElementById('returnClientFilter').value;
  const errEl = document.getElementById('returnFindError');
  errEl.style.display = 'none';
  if(!code) return;
  let item = findInventoryItemByBarcode(code, clientFilter || undefined)
    || (clientFilter ? findInventoryItem(code, clientFilter, undefined) : null)
    || findInventoryItemByBarcode(code)
    || inventory.find(i => i.sku === code && (!clientFilter || i.client === clientFilter));
  if(!item){
    foundReturnItem = null;
    errEl.textContent = 'Товар не найден в остатках — проверьте штрихкод/артикул, либо сначала заведите карточку во вкладке «Остатки»';
    errEl.style.display = 'block';
    renderReturnForm();
    return;
  }
  foundReturnItem = item;
  renderReturnForm();
}
function cancelReturnItem(){ foundReturnItem = null; renderReturnForm(); }
function submitReturn(resolution){
  if(!foundReturnItem){ toast('Сначала найдите товар'); return; }
  const item = foundReturnItem;
  const qty = Math.max(1, parseInt(document.getElementById('returnQty').value) || 1);
  const reason = document.getElementById('returnReason').value;
  const orderId = document.getElementById('returnOrderId').value.trim();
  const id = 'RET-' + Date.now();
  const createdAt = new Date().toISOString();
  const entry = {id, sku:item.sku, name:item.name, size:item.size||'', clientName:item.client||'', warehouseId:item.warehouseId||'MAIN', qty, orderId:orderId||'', reason:reason||'', resolution, employeeName: currentUser?currentUser.name:'', createdAt};
  returns_.unshift(entry);
  sb.from('returns').insert({id, sku:item.sku, name:item.name, size:item.size||null, client_name:item.client||null, warehouse_id:item.warehouseId||'MAIN', qty, order_id:orderId||null, reason:reason||null, resolution, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить возврат в базе'); }
  });
  if(resolution==='restock'){
    item.qty += qty;
    logMovement(item.sku, item.name, qty, 'Возврат на склад' + (reason?(': '+reason):''), item.client, item.size);
    toast(`Возврат оформлен: +${qty} шт на склад`);
  } else {
    logMovement(item.sku, item.name, 0, 'Возврат: брак' + (reason?(': '+reason):''), item.client, item.size);
    toast(`Возврат оформлен как брак: ${qty} шт`);
  }
  foundReturnItem = null;
  document.getElementById('returnBarcode').value = '';
  document.getElementById('returnOrderId').value = '';
  renderReturns();
}
function renderReturnForm(){
  const wrap = document.getElementById('returnFoundWrap');
  if(!wrap) return;
  if(!foundReturnItem){ wrap.innerHTML = ''; return; }
  const item = foundReturnItem;
  wrap.innerHTML = `
    <div class="panel" style="padding:16px;margin-top:12px;background:var(--bg)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <div class="sku-name">${escapeHtml(item.name)}</div>
          <div class="sku-code mono">${escapeHtml(item.sku)}${item.size?' · '+escapeHtml(item.size):''} · ${escapeHtml(item.client||'без клиента')} · сейчас на складе: ${item.qty} шт</div>
        </div>
        <button class="btn btn-ghost" style="padding:4px 10px" onclick="cancelReturnItem()">✕</button>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <input class="search" id="returnQty" type="number" min="1" value="1" style="width:90px" placeholder="Кол-во">
        <select class="search" id="returnReason" style="width:230px">
          <option value="">Причина не указана</option>
          <option value="Брак упаковки">Брак упаковки</option>
          <option value="Брак товара">Брак товара</option>
          <option value="Не подошёл размер">Не подошёл размер</option>
          <option value="Отказ при получении">Отказ при получении</option>
          <option value="Истёк срок хранения на ПВЗ">Истёк срок хранения на ПВЗ</option>
          <option value="Другое">Другое</option>
        </select>
        <input class="search" id="returnOrderId" placeholder="№ заказа WB (необязательно)" style="width:200px">
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn btn-accent" onclick="submitReturn('restock')">↩ Вернуть на склад</button>
        <button class="btn btn-ghost" style="color:var(--warn)" onclick="submitReturn('defect')">🗑 Списать в брак</button>
      </div>
    </div>
  `;
}
function renderReturns(){
  populateReturnClientFilter();
  renderReturnForm();
  const wrap = document.getElementById('returnsTableWrap');
  if(!wrap) return;
  const q = (document.getElementById('returnsSearch')?.value || '').toLowerCase();
  const filtered = returns_.filter(r=>!q || r.sku.toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q) || (r.clientName||'').toLowerCase().includes(q));
  const restockQty = filtered.filter(r=>r.resolution==='restock').reduce((s,r)=>s+r.qty,0);
  const defectQty = filtered.filter(r=>r.resolution==='defect').reduce((s,r)=>s+r.qty,0);
  document.getElementById('returnsStats').innerHTML = `
    <div class="stat"><div class="val">${filtered.length}</div><div class="lbl">Оформлено возвратов</div></div>
    <div class="stat"><div class="val" style="color:var(--ok)">${restockQty}</div><div class="lbl">Возвращено на склад, шт</div></div>
    <div class="stat"><div class="val" style="color:var(--warn)">${defectQty}</div><div class="lbl">Списано в брак, шт</div></div>
  `;
  wrap.innerHTML = `
    <div class="panel">
      <table class="card-table">
        <thead><tr><th>Дата</th><th>Артикул</th><th>Товар</th><th>Клиент</th><th>Кол-во</th><th>Причина</th><th>Решение</th><th>Сотрудник</th></tr></thead>
        <tbody>
          ${filtered.length ? filtered.map(r=>`
            <tr>
              <td class="mono" data-label="Дата" style="font-size:12px;color:var(--ink-soft)">${formatLogDateTime(r.createdAt)}</td>
              <td class="mono" data-label="Артикул">${escapeHtml(r.sku)}${r.size?' / '+escapeHtml(r.size):''}</td>
              <td data-label="Товар">${escapeHtml(r.name||'')}</td>
              <td data-label="Клиент">${escapeHtml(r.clientName||'—')}</td>
              <td data-label="Кол-во">${r.qty} шт</td>
              <td data-label="Причина" style="color:var(--ink-soft);font-size:13px">${escapeHtml(r.reason||'—')}</td>
              <td data-label="Решение"><span class="status ${r.resolution==='restock'?'assembled':'overdue'}">${r.resolution==='restock'?'На склад':'Брак'}</span></td>
              <td data-label="Сотрудник" style="font-size:12px;color:var(--ink-soft)">${escapeHtml(r.employeeName||'—')}</td>
            </tr>
          `).join('') : `<tr><td colspan="8" class="empty">Возвратов пока нет</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}
let journalPage = 1;
let journalPageSize = parseInt(localStorage.getItem('sklad42_journal_page_size')) || 50;
let journalTotal = 0;
let journalDebounceTimer = null;
function populateJournalFilters(){
  const clientSel = document.getElementById('journalClientFilter');
  if(clientSel){
    const prev = clientSel.value;
    clientSel.innerHTML = `<option value="">Все клиенты</option>` + [...new Set(clients.map(c=>c.name))].sort().map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if([...clientSel.options].some(o=>o.value===prev)) clientSel.value = prev;
  }
  const empSel = document.getElementById('journalEmployeeFilter');
  if(empSel){
    const prev = empSel.value;
    empSel.innerHTML = `<option value="">Все сотрудники</option>` + [...new Set(employees.map(e=>e.name))].sort().map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if([...empSel.options].some(o=>o.value===prev)) empSel.value = prev;
  }
  const pageSizeSel = document.getElementById('journalPageSize');
  if(pageSizeSel) pageSizeSel.value = String(journalPageSize);
}
function resetJournalFilters(){
  document.getElementById('journalSearch').value = '';
  document.getElementById('journalClientFilter').value = '';
  document.getElementById('journalEmployeeFilter').value = '';
  document.getElementById('journalTypeFilter').value = '';
  document.getElementById('journalDateFrom').value = '';
  document.getElementById('journalDateTo').value = '';
  journalPage = 1;
  queryJournal();
}
function resetJournalPageAndQuery(){ journalPage = 1; queryJournal(); }
function debouncedJournalQuery(){
  clearTimeout(journalDebounceTimer);
  journalDebounceTimer = setTimeout(resetJournalPageAndQuery, 350);
}
function goJournalPage(delta){ journalPage += delta; queryJournal(); }
function changeJournalPageSize(val){
  journalPageSize = parseInt(val) || 50;
  try{ localStorage.setItem('sklad42_journal_page_size', journalPageSize); }catch(e){}
  journalPage = 1;
  queryJournal();
}
async function queryJournal(){
  const wrap = document.getElementById('journalTableWrap');
  if(!wrap) return;
  const q = document.getElementById('journalSearch').value.trim();
  const clientFilter = document.getElementById('journalClientFilter').value;
  const employeeFilter = document.getElementById('journalEmployeeFilter').value;
  const typeFilter = document.getElementById('journalTypeFilter').value.trim();
  const dateFrom = document.getElementById('journalDateFrom').value;
  const dateTo = document.getElementById('journalDateTo').value;

  let query = sb.from('movement_log').select('*', {count:'exact'});
  if(q) query = query.or(`sku.ilike.%${q}%,name.ilike.%${q}%`);
  if(clientFilter) query = query.eq('client_name', clientFilter);
  if(employeeFilter) query = query.eq('employee_name', employeeFilter);
  if(typeFilter) query = query.ilike('type', `%${typeFilter}%`);
  if(dateFrom) query = query.gte('created_at', dateFrom+'T00:00:00');
  if(dateTo) query = query.lte('created_at', dateTo+'T23:59:59');
  query = query.order('created_at', {ascending:false});
  const from = (journalPage-1)*journalPageSize;
  const to = from + journalPageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if(error){ console.error(error); wrap.innerHTML = `<div class="panel empty">Не удалось загрузить журнал</div>`; return; }
  journalTotal = count || 0;
  const totalPages = Math.max(1, Math.ceil(journalTotal / journalPageSize));
  if(journalPage > totalPages) journalPage = totalPages;

  const rowsHtml = (data||[]).map(m=>`
    <tr>
      <td class="mono" data-label="Дата" style="font-size:12px;color:var(--ink-soft)">${formatLogDateTime(m.created_at)}</td>
      <td data-label="Тип">${escapeHtml(m.type||'')}</td>
      <td class="mono" data-label="Артикул">${escapeHtml(m.sku)}${m.size?' / '+escapeHtml(m.size):''}</td>
      <td data-label="Товар">${escapeHtml(m.name||'')}</td>
      <td data-label="Клиент">${escapeHtml(m.client_name||'—')}</td>
      <td data-label="Изменение" style="color:${m.delta>=0?'var(--ok)':'var(--warn)'};font-weight:600">${m.delta>=0?'+':''}${m.delta} шт</td>
      <td data-label="Сотрудник" style="font-size:12px;color:var(--ink-soft)">${escapeHtml(m.employee_name||'—')}</td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="empty">Ничего не найдено</td></tr>`;

  const fromShown = journalTotal ? from+1 : 0;
  const toShown = Math.min(to+1, journalTotal);

  wrap.innerHTML = `
    <div class="panel">
      <div style="overflow-x:auto">
        <table class="card-table">
          <thead><tr><th>Дата и время</th><th>Тип</th><th>Артикул</th><th>Товар</th><th>Клиент</th><th>Изменение</th><th>Сотрудник</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-top:1px solid var(--line);flex-wrap:wrap">
        <span style="font-size:13px;color:var(--ink-soft)">${journalTotal ? `Показано ${fromShown}–${toShown} из ${journalTotal}` : 'Пусто'}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goJournalPage(-1)" ${journalPage<=1?'disabled':''}>← Назад</button>
          <span style="font-size:13px;color:var(--ink-soft);white-space:nowrap">Стр. ${journalPage} из ${totalPages}</span>
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goJournalPage(1)" ${journalPage>=totalPages?'disabled':''}>Вперёд →</button>
        </div>
      </div>
    </div>
  `;
}
function renderJournal(){
  populateJournalFilters();
  queryJournal();
}
document.getElementById('journalSearch').addEventListener('input', debouncedJournalQuery);
document.getElementById('journalClientFilter').addEventListener('change', resetJournalPageAndQuery);
document.getElementById('journalEmployeeFilter').addEventListener('change', resetJournalPageAndQuery);
document.getElementById('journalTypeFilter').addEventListener('input', debouncedJournalQuery);
document.getElementById('journalDateFrom').addEventListener('change', resetJournalPageAndQuery);
document.getElementById('journalDateTo').addEventListener('change', resetJournalPageAndQuery);
document.getElementById('journalPageSize').addEventListener('change', function(){ changeJournalPageSize(this.value); });
