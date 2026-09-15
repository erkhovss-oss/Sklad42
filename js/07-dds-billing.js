// ---------- DDS (движение денежных средств) ----------
async function loadDdsEntries(){
  const { data, error } = await sb.from('dds_entries').select('*').order('date',{ascending:false}).limit(50000);
  if(error){ console.error(error); return; }
  ddsEntries = data.map(d=>({
    id:d.id, type:d.type, category:d.category, amount:Number(d.amount), description:d.description||'',
    clientId:d.client_id, clientName:d.client_name||'', date:d.date, warehouseId:d.warehouse_id||'MAIN', createdAt:d.created_at,
    employeeName:d.employee_name||''
  }));
}
function updateDdsCategoryOptions(){
  const typeSelect = document.getElementById('ddsType');
  const catSelect = document.getElementById('ddsCategory');
  if(!typeSelect || !catSelect) return;
  const cats = DDS_CATEGORIES[typeSelect.value] || [];
  catSelect.innerHTML = cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}
function renderDdsClientSelect(){
  const select = document.getElementById('ddsClient');
  if(!select) return;
  const prev = select.value;
  select.innerHTML = `<option value="">Без привязки к клиенту</option>` + clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if(clients.find(c=>c.id===prev)) select.value = prev;
}
function renderDdsWarehouseSelect(){
  const select = document.getElementById('ddsWarehouse');
  if(!select) return;
  if(!hasFullWarehouseAccess()){
    select.innerHTML = `<option value="${myWarehouseId()}">${escapeHtml(warehouseName(myWarehouseId()))}</option>`;
    select.value = myWarehouseId();
    select.disabled = true;
  } else {
    const prev = select.value;
    select.innerHTML = warehouses.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
    if(warehouses.some(w=>w.id===prev)) select.value = prev;
  }
}
function renderDds(){
  renderDdsClientSelect();
  renderDdsWarehouseSelect();
  updateDdsCategoryOptions();
  const dateInput = document.getElementById('ddsDate');
  if(dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0,10);
  const invoiceClientSelect = document.getElementById('invoiceClient');
  if(invoiceClientSelect){
    const prev = invoiceClientSelect.value;
    invoiceClientSelect.innerHTML = clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if(clients.some(c=>c.id===prev)) invoiceClientSelect.value = prev;
  }
  const invoiceMonthInput = document.getElementById('invoiceMonth');
  if(invoiceMonthInput && !invoiceMonthInput.value) invoiceMonthInput.value = new Date().toISOString().slice(0,7);
  document.getElementById('tochkaPanelWrap').innerHTML = renderTochkaPanel();
  renderDdsTable();
}
function renderTochkaPanel(){
  return `
    <div class="panel" style="padding:16px 20px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="toggleTochkaSettings()">
        <div style="font-size:13px;font-weight:600">🏦 Точка Банк — подтянуть выписку</div>
        <span style="font-size:12px;color:var(--ink-faint)">${tochkaSettingsOpen?'▲':'▼'}</span>
      </div>
      ${tochkaSettingsOpen ? `
        <div style="margin-top:14px">
          <div style="font-size:12px;color:var(--ink-faint);margin-bottom:10px">Токен выпускается в личном кабинете Точки (JWT для личного использования). CustomerCode и AccountId — тоже оттуда, либо через методы Get Customers List / Get Accounts List.</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <input class="search" id="tochkaToken" type="password" placeholder="JWT-токен" style="flex:1;min-width:220px" value="${escapeHtml(tochkaSettings.token||'')}">
            <input class="search mono" id="tochkaCustomerCode" placeholder="CustomerCode" style="width:150px" value="${escapeHtml(tochkaSettings.customerCode||'')}">
            <input class="search mono" id="tochkaAccountId" placeholder="AccountId" style="width:220px" value="${escapeHtml(tochkaSettings.accountId||'')}">
          </div>
          <button class="btn btn-ghost" onclick="saveTochkaSettings()">Сохранить настройки</button>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line);align-items:flex-end">
            <div><div class="eyebrow" style="margin-bottom:6px">С даты</div><input class="search" id="tochkaDateFrom" type="date" style="width:160px"></div>
            <div><div class="eyebrow" style="margin-bottom:6px">По дату</div><input class="search" id="tochkaDateTo" type="date" style="width:160px"></div>
            <button class="btn btn-accent" onclick="fetchTochkaStatement()">📥 Подтянуть выписку</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
function createDdsEntry(){
  const type = document.getElementById('ddsType').value;
  const category = document.getElementById('ddsCategory').value;
  const amount = Math.max(0, parseFloat(document.getElementById('ddsAmount').value) || 0);
  const date = document.getElementById('ddsDate').value || new Date().toISOString().slice(0,10);
  const clientId = document.getElementById('ddsClient').value;
  const client = clients.find(c=>c.id===clientId);
  const warehouseId = document.getElementById('ddsWarehouse').value || myWarehouseId() || 'MAIN';
  const description = document.getElementById('ddsDescription').value.trim();
  if(!amount){ toast('Укажите сумму'); return; }
  const id = 'DDS-' + Date.now();
  const entry = {id, type, category, amount, description, clientId: clientId||null, clientName: client?client.name:'', date, warehouseId, createdAt: new Date().toISOString(), employeeName: currentUser?currentUser.name:''};
  ddsEntries.unshift(entry);
  document.getElementById('ddsAmount').value = '';
  document.getElementById('ddsDescription').value = '';
  toast(`${type==='income'?'Приход':'Расход'} добавлен: ${amount.toFixed(2)} ₽`);
  renderDdsTable();
  sb.from('dds_entries').insert({id, type, category, amount, description, client_id: clientId||null, client_name: client?client.name:null, date, warehouse_id: warehouseId, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить операцию в базе'); }
  });
}
function deleteDdsEntry(id){
  if(!confirm('Удалить эту операцию?')) return;
  ddsEntries = ddsEntries.filter(d=>d.id!==id);
  toast('Операция удалена');
  renderDdsTable();
  sb.from('dds_entries').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить в базе'); }
  });
}
async function loadTochkaSettings(){
  const { data, error } = await sb.from('bank_settings').select('*').eq('id','tochka').maybeSingle();
  if(error){ console.error(error); return; }
  if(data) tochkaSettings = { token:data.token||'', customerCode:data.customer_code||'', accountId:data.account_id||'' };
}
function toggleTochkaSettings(){
  tochkaSettingsOpen = !tochkaSettingsOpen;
  renderDds();
}
function saveTochkaSettings(){
  const token = document.getElementById('tochkaToken').value.trim();
  const customerCode = document.getElementById('tochkaCustomerCode').value.trim();
  const accountId = document.getElementById('tochkaAccountId').value.trim();
  tochkaSettings = { token, customerCode, accountId };
  toast('Настройки Точка Банка сохранены');
  sb.from('bank_settings').upsert({id:'tochka', token, customer_code:customerCode, account_id:accountId}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить настройки в базе'); }
  });
}
async function fetchTochkaStatement(){
  if(!tochkaSettings.token || !tochkaSettings.accountId){ toast('Сначала сохраните токен и AccountId'); return; }
  const dateFrom = document.getElementById('tochkaDateFrom').value;
  const dateTo = document.getElementById('tochkaDateTo').value;
  if(!dateFrom || !dateTo){ toast('Укажите период выписки'); return; }
  toast('Запрашиваем выписку у Точка Банка… это может занять до 10-15 секунд');
  try{
    const { data, error } = await sb.functions.invoke('tochka-bank-ts', { body: { dateFrom, dateTo } });
    if(error){ toast('Точка: ' + await extractFnErrorMessage(error)); return; }
    if(data && data.error){ toast('Точка: ' + data.error); return; }
    const transactions = data.transactions || [];
    let created = 0, skipped = 0;
    transactions.forEach(t=>{
      const id = 'BANK-' + t.id;
      if(ddsEntries.find(d=>d.id===id)){ skipped++; return; }
      const entry = {
        id, type: t.isCredit ? 'income' : 'expense',
        category: t.isCredit ? 'Банк (не разобрано)' : 'Прочие расходы',
        amount: t.amount, description: t.description || t.counterparty || '',
        clientId: null, clientName: t.counterparty || '', date: t.date, createdAt: new Date().toISOString()
      };
      ddsEntries.unshift(entry);
      created++;
      sb.from('dds_entries').insert({id, type:entry.type, category:entry.category, amount:entry.amount, description:entry.description, client_id:null, client_name:entry.clientName||null, date:entry.date, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
        if(error) console.error(error);
      });
    });
    toast(`Загружено из банка: ${created} новых операций${skipped?`, уже было ${skipped}`:''}`);
    renderDdsTable();
  }catch(e){
    toast('Не удалось вызвать серверную функцию — она развёрнута в Supabase?');
  }
}
function editDdsCategory(id){
  const entry = ddsEntries.find(d=>d.id===id);
  if(!entry) return;
  const cats = DDS_CATEGORIES[entry.type] || [];
  const options = cats.map((c,i)=>`${i+1}. ${c}`).join('\n');
  const choice = prompt(`Выберите новую категорию для «${entry.description||entry.category}»:\n${options}\n\nВведите номер:`, '');
  const idx = parseInt(choice) - 1;
  if(idx>=0 && idx<cats.length){
    entry.category = cats[idx];
    renderDdsTable();
    sb.from('dds_entries').update({category:entry.category}).eq('id', id).then(({error})=>{
      if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
    });
  }
}
function generateClientInvoice(){
  const clientId = document.getElementById('invoiceClient').value;
  const monthStr = document.getElementById('invoiceMonth').value;
  if(!clientId){ toast('Выберите клиента'); return; }
  if(!monthStr){ toast('Выберите месяц'); return; }
  const client = clients.find(c=>c.id===clientId);
  if(!client){ toast('Клиент не найден'); return; }
  const [year, month] = monthStr.split('-').map(Number);
  const periodStart = `${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${monthStr}-${String(lastDay).padStart(2,'0')}`;

  const rows = ddsEntries.filter(d=>d.type==='income' && d.clientId===clientId && d.date>=periodStart && d.date<=periodEnd);
  if(!rows.length){ toast('За этот месяц по клиенту нет ни одной операции прихода'); return; }

  const byCategory = {};
  rows.forEach(r=>{ byCategory[r.category] = (byCategory[r.category]||0) + r.amount; });
  const total = rows.reduce((s,r)=>s+r.amount,0);

  let wh = getWarehouseInfo();
  if(!wh.name){
    editWarehouseInfo();
    wh = getWarehouseInfo();
    if(!wh.name) wh.name = 'ТелеПак';
  }

  const monthName = new Date(year, month-1, 1).toLocaleDateString('ru-RU', {month:'long', year:'numeric'});
  const today = new Date();
  const dateStr = today.toLocaleDateString('ru-RU', {day:'2-digit', month:'long', year:'numeric'});

  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна — разрешите всплывающие окна для этого сайта и попробуйте снова'); return; }
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Счёт за ${monthName}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;color:#111;max-width:850px;margin:0 auto;line-height:1.5}
      h1{text-align:center;font-size:18px;margin-bottom:4px}
      .sub{text-align:center;color:#555;margin-bottom:24px}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th,td{border:1px solid #333;padding:7px;font-size:13px;text-align:left}
      th{background:#f2f2f2}
      td.num,th.num{text-align:right}
      tr.total td{font-weight:bold;background:#f7f7f7}
      .sign{margin-top:60px;display:flex;justify-content:space-between;gap:40px}
      .sign > div{width:100%}
      .line{border-bottom:1px solid #333;margin-top:44px;margin-bottom:4px}
      .small{font-size:11px;color:#666}
      @media print{ body{padding:20px} }
    </style></head><body>
      <h1>СЧЁТ ЗА УСЛУГИ ФУЛФИЛМЕНТА</h1>
      <div class="sub">за ${monthName} · составлен ${dateStr}</div>
      <p><b>Исполнитель:</b> ${wh.name}${companySettings.inn?` (ИНН ${companySettings.inn}${companySettings.kpp?`, КПП ${companySettings.kpp}`:''})`:''}</p>
      ${companySettings.legalAddress?`<p style="margin-top:-10px"><span class="small">${companySettings.legalAddress}</span></p>`:''}
      ${companySettings.bankDetails?`<p style="margin-top:-10px"><span class="small">${companySettings.bankDetails.replace(/\n/g,'<br>')}</span></p>`:''}
      <p><b>Заказчик:</b> ${client.name}${client.inn?` (ИНН ${client.inn}${client.kpp?`, КПП ${client.kpp}`:''})`:''}</p>
      ${client.legalAddress?`<p style="margin-top:-10px"><span class="small">${client.legalAddress}</span></p>`:''}
      <table>
        <thead><tr><th>№</th><th>Статья</th><th class="num">Сумма, ₽</th></tr></thead>
        <tbody>
          ${Object.entries(byCategory).map(([cat,sum],idx)=>`
            <tr><td>${idx+1}</td><td>${cat}</td><td class="num">${sum.toFixed(2)}</td></tr>
          `).join('')}
          <tr class="total"><td colspan="2">Итого к оплате</td><td class="num">${total.toFixed(2)} ₽</td></tr>
        </tbody>
      </table>
      <div class="sign">
        <div>
          <div class="line"></div>
          <div class="small">Исполнитель ${companySettings.directorName?`(${companySettings.directorName})`:''}</div>
        </div>
        <div>
          <div class="line"></div>
          <div class="small">Заказчик ${client.directorName?`(${client.directorName})`:''}</div>
        </div>
      </div>
    </body></html>
  `);
  win.document.close();
}
function generateStorageIncome(){
  let created = 0, updated = 0, skipped = 0;
  storageHistoryRows.forEach(row=>{
    const cost = Number(row.cost) || 0;
    if(cost <= 0){ skipped++; return; }
    const id = `STORAGE-${row.client_id}-${row.day}`;
    const client = clients.find(c=>c.id===row.client_id);
    const existing = ddsEntries.find(d=>d.id===id);
    if(existing){
      if(Math.abs(existing.amount - cost) > 0.01){
        existing.amount = cost;
        updated++;
        sb.from('dds_entries').update({amount:cost}).eq('id', id).then(({error})=>{ if(error) console.error(error); });
      }
    } else {
      const description = `Автоматически из «Хранения» за ${new Date(row.day).toLocaleDateString('ru-RU')}`;
      const entry = {id, type:'income', category:'Хранение', amount:cost, description, clientId:row.client_id, clientName: client?client.name:'', date: row.day, createdAt:new Date().toISOString()};
      ddsEntries.push(entry);
      created++;
      sb.from('dds_entries').insert({id, type:'income', category:'Хранение', amount:cost, description, client_id:row.client_id, client_name: client?client.name:null, date: row.day}).then(({error})=>{
        if(error) console.error(error);
      });
    }
  });
  toast(`Приход по хранению: создано ${created}, обновлено ${updated}${skipped?`, пропущено (нулевая стоимость) ${skipped}`:''}`);
  renderDdsTable();
}
function renderDdsTable(){
  const q = (document.getElementById('ddsSearch').value || '').toLowerCase();
  const typeFilter = document.getElementById('ddsFilterType').value;
  const visibleDds = hasFullWarehouseAccess() ? ddsEntries : ddsEntries.filter(d=>(d.warehouseId||'MAIN')===myWarehouseId());
  const rows = visibleDds.filter(d=>
    (!typeFilter || d.type===typeFilter) &&
    (!q || d.category.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || (d.clientName||'').toLowerCase().includes(q))
  );
  const income = rows.filter(d=>d.type==='income').reduce((a,d)=>a+d.amount,0);
  const expense = rows.filter(d=>d.type==='expense').reduce((a,d)=>a+d.amount,0);
  document.getElementById('ddsStats').innerHTML = `
    <div class="stat"><div class="val" style="color:var(--ok)">+${income.toFixed(0)} ₽</div><div class="lbl">Приход</div></div>
    <div class="stat"><div class="val" style="color:var(--warn)">−${expense.toFixed(0)} ₽</div><div class="lbl">Расход</div></div>
    <div class="stat"><div class="val" style="color:${(income-expense)>=0?'var(--ok)':'var(--warn)'}">${(income-expense).toFixed(0)} ₽</div><div class="lbl">Баланс</div></div>
  `;
  const wrap = document.getElementById('ddsTableWrap');
  if(!rows.length){
    wrap.innerHTML = `<div class="panel empty">Операций пока нет</div>`;
    return;
  }
  const visibleIds = rows.map(d=>d.id);
  ddsSelected = ddsSelected.filter(id=>visibleIds.includes(id));
  const allSelected = ddsSelected.length>0 && visibleIds.every(id=>ddsSelected.includes(id));
  wrap.innerHTML = `
    ${ddsSelected.length ? `
      <div class="panel" style="padding:10px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;background:var(--warn-bg)">
        <span style="font-size:13px;font-weight:600">Выбрано: ${ddsSelected.length}</span>
        <button class="btn btn-ghost" style="color:var(--warn)" onclick="deleteSelectedDdsEntries()">Удалить выбранные</button>
        <button class="btn btn-ghost" onclick="clearDdsSelection()">Снять выделение</button>
      </div>
    ` : ''}
    <div class="panel">
      <table class="card-table">
        <thead><tr>
          <th style="width:30px"><input type="checkbox" ${allSelected?'checked':''} onchange="toggleAllDdsSelected(this.checked)"></th>
          <th>Дата</th><th>Тип</th><th>Категория</th><th>Клиент</th><th>Комментарий</th><th>Сотрудник</th><th>Сумма</th><th></th>
        </tr></thead>
        <tbody>
          ${rows.map(d=>`
            <tr>
              <td data-label="Выбрано"><input type="checkbox" ${ddsSelected.includes(d.id)?'checked':''} onchange="toggleDdsSelected('${escapeHtml(d.id)}', this.checked)"></td>
              <td class="mono" data-label="Дата" style="font-size:12px">${new Date(d.date).toLocaleDateString('ru-RU')}</td>
              <td data-label="Тип"><span class="status ${d.type==='income'?'assembled':'overdue'}">${d.type==='income'?'Приход':'Расход'}</span></td>
              <td data-label="Категория" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px" title="Нажмите, чтобы изменить категорию" onclick="editDdsCategory('${escapeHtml(d.id)}')">${escapeHtml(d.category)}</td>
              <td data-label="Клиент">${d.clientName?escapeHtml(d.clientName):'—'}</td>
              <td data-label="Комментарий" style="color:var(--ink-soft);font-size:13px">${escapeHtml(d.description)||'—'}</td>
              <td data-label="Сотрудник" style="color:var(--ink-soft);font-size:12px">${d.employeeName?escapeHtml(d.employeeName):'—'}</td>
              <td class="mono" data-label="Сумма" style="font-weight:600;color:${d.type==='income'?'var(--ok)':'var(--warn)'}">${d.type==='income'?'+':'−'}${d.amount.toFixed(2)} ₽</td>
              <td style="text-align:right"><button class="btn btn-ghost" style="padding:4px 10px" onclick="deleteDdsEntry('${d.id}')">Удалить</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}
function toggleDdsSelected(id, checked){
  if(checked){ if(!ddsSelected.includes(id)) ddsSelected.push(id); }
  else{ ddsSelected = ddsSelected.filter(x=>x!==id); }
  renderDdsTable();
}
function toggleAllDdsSelected(checked){
  const q = (document.getElementById('ddsSearch').value || '').toLowerCase();
  const typeFilter = document.getElementById('ddsFilterType').value;
  const visibleDds = hasFullWarehouseAccess() ? ddsEntries : ddsEntries.filter(d=>(d.warehouseId||'MAIN')===myWarehouseId());
  const rows = visibleDds.filter(d=>
    (!typeFilter || d.type===typeFilter) &&
    (!q || d.category.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || (d.clientName||'').toLowerCase().includes(q))
  );
  ddsSelected = checked ? rows.map(d=>d.id) : [];
  renderDdsTable();
}
function clearDdsSelection(){ ddsSelected = []; renderDdsTable(); }
function deleteSelectedDdsEntries(){
  if(!ddsSelected.length) return;
  if(!confirm(`Удалить выбранные операции (${ddsSelected.length})? Отменить нельзя.`)) return;
  const idsToDelete = [...ddsSelected];
  ddsEntries = ddsEntries.filter(d=>!idsToDelete.includes(d.id));
  ddsSelected = [];
  toast(`Удалено операций: ${idsToDelete.length}`);
  renderDdsTable();
  sb.from('dds_entries').delete().in('id', idsToDelete).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить часть операций в базе'); }
  });
}
document.getElementById('ddsType').addEventListener('change', updateDdsCategoryOptions);
document.getElementById('ddsSearch').addEventListener('input', renderDdsTable);
document.getElementById('ddsFilterType').addEventListener('change', renderDdsTable);

