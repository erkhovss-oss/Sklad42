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
  clientViewMode = { id: data.client.id, name: data.client.name, pricePerLiter: data.client.pricePerLiter||0 };
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
  renderPortalStorageStats();
  switchTab('inventory');
  renderInventory();
  renderPortalSupplyDraftRows();
  await loadPortalSupplies();
  return true;
}
function downloadPortalSupplyTemplate(){
  const seen = new Set();
  const data = [['Артикул','Наименование','Размер','ШК','Кол-во']];
  inventory.forEach(i=>{
    const key = i.sku+'~~'+(i.size||'');
    if(seen.has(key)) return;
    seen.add(key);
    data.push([i.sku, i.name, i.size||'', i.barcode||'', '']);
  });
  if(data.length===1){
    data.push(['TK-1001','Пример товара','','', 10]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:26},{wch:10},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заявка');
  XLSX.writeFile(wb, 'shablon_zayavka_postavka.xlsx');
}
function downloadPortalSupplyEmptyTemplate(){
  const data = [
    ['Артикул','Наименование','Размер','ШК','Кол-во'],
    ['TK-1001','Пример товара','','', 10]
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:26},{wch:10},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заявка');
  XLSX.writeFile(wb, 'shablon_zayavka_postavka_pustoy.xlsx');
}
function handlePortalSupplyExcelUpload(inputEl){
  const file = inputEl.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(e){
    try{
      const workbook = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
      const items = [];
      for(let i=1;i<rows.length;i++){ // строка 0 — заголовок
        const row = rows[i];
        if(!row || !row.length) continue;
        const sku = String(row[0]||'').trim().toUpperCase();
        const nameFromFile = String(row[1]||'').trim();
        const size = String(row[2]||'').trim();
        const qty = parseInt(row[4]) || 0;
        if(!sku || qty<=0) continue;
        const invItem = inventory.find(x=>x.sku===sku && (x.size||'')===size);
        if(invItem){
          items.push({sku, customSku:'', customName:'', size, qty});
        } else {
          items.push({sku:'', customSku:sku, customName:nameFromFile||sku, size:'', qty});
        }
      }
      if(!items.length){
        toast('В файле не найдено строк с артикулом и количеством');
        inputEl.value = '';
        return;
      }
      portalSupplyDraft = items;
      toast(`Файл прочитан: ${items.length} позиц. — проверьте список ниже перед отправкой`);
      renderPortalSupplyDraftRows();
    }catch(err){
      toast('Не удалось прочитать файл — проверьте формат Excel');
    }
    inputEl.value = '';
  };
  reader.readAsArrayBuffer(file);
}
function renderPortalStorageStats(){
  const wrap = document.getElementById('portalStorageStats');
  if(!wrap || !clientViewMode) return;
  const liters = inventory
    .filter(i => i.dims && i.dims.l && i.dims.w && i.dims.h)
    .reduce((sum, i) => sum + (i.dims.l * i.dims.w * i.dims.h / 1000) * i.qty, 0);
  const pricePerLiter = clientViewMode.pricePerLiter || 0;
  const dailyCost = liters * pricePerLiter;
  wrap.style.display = 'flex';
  wrap.innerHTML = `
    <div class="stat"><div class="val">${liters.toFixed(1)} л</div><div class="lbl">Занято на складе</div></div>
    ${pricePerLiter > 0 ? `
      <div class="stat"><div class="val">${dailyCost.toFixed(2)} ₽</div><div class="lbl">Списывается в сутки за хранение</div></div>
      <div class="stat"><div class="val">${pricePerLiter.toFixed(2)} ₽</div><div class="lbl">Тариф за литр в сутки</div></div>
    ` : ''}
  `;
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
let portalCompany = {name:'', inn:''};
async function loadPortalSupplies(){
  if(!portalToken) return;
  const { data, error } = await sb.rpc('client_portal_supplies', { p_token: portalToken });
  if(error){ console.error(error); return; }
  if(!data) return;
  portalCompany = data.company || {name:'', inn:''};
  portalSuppliesList = data.supplies || [];
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
      ${s.status!=='planned' ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
          <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px" onclick="downloadPortalSupplyActPdf('${s.id}')">📄 Скачать акт приёмки</button>
        </div>
      ` : ''}
    </div>
  `).join('');
}
function downloadPortalSupplyActPdf(supplyId){
  const s = portalSuppliesList.find(x=>x.id===supplyId);
  if(!s) return;
  const actNumber = s.actNumber || s.act_number || s.id;
  const rows = s.items.map((it,idx)=>({
    n: idx+1, sku: it.sku, size: it.size||'', barcode: '', name: it.name,
    plan: it.qty, fact: it.receivedQty||0, diff: (it.receivedQty||0) - it.qty
  }));
  const totalPlan = rows.reduce((a,r)=>a+r.plan,0);
  const totalFact = rows.reduce((a,r)=>a+r.fact,0);
  const mismatches = rows.filter(r=>r.diff!==0).length;
  const noMismatches = mismatches === 0;
  const companyName = portalCompany.name || 'ТелеПак';
  const today = new Date();
  const dateStr = today.toLocaleDateString('ru-RU', {day:'2-digit', month:'long', year:'numeric'});

  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна — разрешите всплывающие окна для этого сайта и попробуйте снова'); return; }
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Акт приёмки ${actNumber}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
      :root{
        --bg:#F0EEE6; --panel:#FFFFFF; --ink:#1C1B19; --ink-soft:#6B665C; --ink-faint:#A39C8C;
        --accent:#FF5B1F; --accent-ink:#FFFFFF; --ok:#2F7D4F; --ok-bg:#E7F2EA;
        --warn:#B5471B; --warn-bg:#FBE9E1; --line:#DCD6C6;
      }
      *{box-sizing:border-box}
      body{margin:0;background:var(--panel);color:var(--ink);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;padding:36px;max-width:860px;margin:0 auto}
      .mono{font-family:'IBM Plex Mono',monospace}
      .eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:0.08em;font-size:12px;color:var(--ink-faint);font-weight:600}
      .head{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid var(--accent);margin-bottom:22px}
      .brand{display:flex;align-items:center;gap:10px}
      .brand-badge{width:38px;height:38px;border-radius:9px;background:var(--accent);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px}
      .brand-name{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:20px;letter-spacing:0.01em}
      h1{font-family:'Barlow Condensed',sans-serif;font-size:30px;font-weight:700;margin:0 0 4px 0;text-align:right}
      .sub-date{text-align:right;color:var(--ink-soft);font-size:13px}
      .cards{display:flex;gap:14px;margin-bottom:20px}
      .card{flex:1;background:var(--bg);border-radius:12px;padding:14px 16px}
      .card .eyebrow{margin-bottom:6px}
      .card .name{font-weight:600;font-size:14px;margin-bottom:2px}
      .card .detail{font-size:12px;color:var(--ink-soft);line-height:1.5}
      table{width:100%;border-collapse:collapse;margin-top:4px;border-radius:10px;overflow:hidden}
      th{background:var(--bg);color:var(--ink-soft);font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:0.04em;font-size:11px;font-weight:600;text-align:left;padding:10px 10px;border-bottom:2px solid var(--line)}
      td{padding:9px 10px;font-size:13px;border-bottom:1px solid var(--line)}
      td.num,th.num{text-align:right}
      tr.mismatch td{background:var(--warn-bg)}
      tr.mismatch td:first-child{border-left:3px solid var(--warn)}
      .diff-bad{color:var(--warn);font-weight:700}
      .diff-ok{color:var(--ink-faint)}
      .summary-row{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:16px 18px;background:var(--bg);border-radius:12px}
      .summary-nums{display:flex;gap:26px}
      .summary-nums .stat .val{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:24px;line-height:1}
      .summary-nums .stat .lbl{font-size:11px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.04em;margin-top:2px}
      .status-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600}
      .status-pill.ok{background:var(--ok-bg);color:var(--ok)}
      .status-pill.bad{background:var(--warn-bg);color:var(--warn)}
      .sign{margin-top:56px;display:flex;justify-content:space-between;gap:40px}
      .sign > div{width:100%}
      .sign .role{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:0.04em;font-size:12px;color:var(--ink-faint);margin-bottom:40px}
      .line{border-bottom:1px solid var(--ink);margin-bottom:4px}
      .small{font-size:11px;color:var(--ink-faint)}
      .footer{margin-top:40px;text-align:center;font-size:11px;color:var(--ink-faint)}
      @media print{
        body{padding:16px}
        .card{background:#F5F4EF !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        th{background:#F5F4EF !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .summary-row{background:#F5F4EF !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        tr.mismatch td{background:#FBE9E1 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .status-pill.ok{background:#E7F2EA !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .status-pill.bad{background:#FBE9E1 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .brand-badge{background:#FF5B1F !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .head{border-color:#FF5B1F !important}
      }
    </style></head><body>
      <div class="head">
        <div class="brand">
          <div class="brand-badge">Т</div>
          <div>
            <div class="brand-name">${escapeHtml(companyName)}</div>
            <div class="eyebrow" style="margin-top:2px">Акт приёмки товара</div>
          </div>
        </div>
        <div>
          <h1>№ ${escapeHtml(String(actNumber))}</h1>
          <div class="sub-date">${dateStr}</div>
        </div>
      </div>

      <div class="cards">
        <div class="card">
          <div class="eyebrow">Исполнитель (склад)</div>
          <div class="name">${escapeHtml(companyName)}</div>
          <div class="detail">${portalCompany.inn?`ИНН ${escapeHtml(portalCompany.inn)}`:''}</div>
        </div>
        <div class="card">
          <div class="eyebrow">Клиент</div>
          <div class="name">${escapeHtml(clientViewMode.name)}</div>
        </div>
        <div class="card">
          <div class="eyebrow">Поставка</div>
          <div class="name mono">№ ${escapeHtml(s.id)}</div>
        </div>
      </div>

      <table>
        <thead><tr><th>№</th><th>Артикул</th><th>Размер</th><th>Наименование</th><th class="num">План, шт</th><th class="num">Факт, шт</th><th class="num">Расхождение</th></tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr class="${r.diff!==0?'mismatch':''}">
              <td class="mono">${r.n}</td><td class="mono">${escapeHtml(r.sku)}</td><td>${escapeHtml(r.size)}</td><td>${escapeHtml(r.name)}</td>
              <td class="num">${r.plan}</td><td class="num">${r.fact}</td>
              <td class="num ${r.diff!==0?'diff-bad':'diff-ok'}">${r.diff!==0 ? (r.diff>0?'+':'')+r.diff : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="summary-row">
        <div class="summary-nums">
          <div class="stat"><div class="val">${totalPlan}</div><div class="lbl">По плану, шт</div></div>
          <div class="stat"><div class="val">${totalFact}</div><div class="lbl">Принято, шт</div></div>
        </div>
        ${noMismatches
          ? `<span class="status-pill ok">✅ Без расхождений</span>`
          : `<span class="status-pill bad">⚠ Расхождений: ${mismatches} поз.</span>`}
      </div>

      <div class="sign">
        <div><div class="role">Принял (склад)</div><div class="line"></div><span class="small">подпись / расшифровка подписи</span></div>
        <div><div class="role">Сдал (поставщик)</div><div class="line"></div><span class="small">подпись / расшифровка подписи</span></div>
      </div>
      <div class="footer">Сформировано в ${escapeHtml(companyName)} · ${dateStr}</div>
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 350); };<\/script>
    </body></html>
  `);
  win.document.close();
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

