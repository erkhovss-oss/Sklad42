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
    });
  } else {
    item.qty = Math.max(0, item.qty - qty);
    logMovement(item.sku, item.name, -qty, reasonText, item.client, item.size);
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


// ---------- ЗАДАНИЯ НА УПАКОВКУ ----------
// Клиент заполняет ТЗ в кабинете → у нас появляется задание → печать упаковщику → упаковщик вводит факт → сумма по тарифу клиента.
let packServices = [];
let packPrices = [];      // {client_id, service_id, price}
let packTasks = [];
let packView = 'tasks';   // tasks | tariffs
let packStatusFilter = 'active';
let packClientFilter = '';
let packTariffClient = '';
let packExpanded = new Set();
let packCatalog = [];     // каталог в кабинете клиента (без цен)
let packPortalTasks = [];
let packDraft = [];
const PACK_STATUS = {new:['Новое','planned'], in_progress:['В работе','overdue'], done:['Выполнено','assembled'], cancelled:['Отменено','shipped']};

function packInjectDom(){
  if(document.getElementById('tab-packing')) return;
  const nav = document.querySelector('.nav-item[data-tab="ozon"]');
  if(nav){
    const el = document.createElement('div');
    el.className = 'nav-item'; el.dataset.tab = 'packing';
    el.innerHTML = '<span class="num">★</span>Задания на упаковку';
    el.addEventListener('click', ()=>{ switchTab('packing'); closeMobileSidebar(); });
    nav.after(el);
  }
  const navK = document.querySelector('.nav-item[data-tab="portal-kiz"]');
  if(navK){
    const el = document.createElement('div');
    el.className = 'nav-item'; el.dataset.tab = 'portal-pack'; el.style.display = 'none';
    el.innerHTML = '<span class="num">04</span>Задания на упаковку';
    el.addEventListener('click', ()=>{ switchTab('portal-pack'); closeMobileSidebar(); });
    navK.after(el);
  }
  const host = document.getElementById('tab-portal-kiz');
  if(host){
    const s1 = document.createElement('section');
    s1.className = 'section'; s1.id = 'tab-packing';
    s1.innerHTML = `<div class="page-head"><div><h1>Задания на упаковку</h1><p>ТЗ от клиентов: что сделать с товаром. Печать для упаковщиков, учёт факта и стоимости.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-accent" id="packViewTasksBtn" onclick="packSetView('tasks')">Задания</button><button class="btn btn-ghost" id="packViewTariffsBtn" onclick="packSetView('tariffs')">Услуги и тарифы</button><button class="btn btn-ghost" onclick="packLoadStaff(true)">🔄 Обновить</button></div></div>
      <div id="packBody"></div>`;
    host.after(s1);
    const s2 = document.createElement('section');
    s2.className = 'section'; s2.id = 'tab-portal-pack';
    s2.innerHTML = `<div class="page-head"><div><h1>Задания на упаковку</h1><p>Опишите, что нужно сделать с товаром: выберите товар, количество и услуги. Стоимость будет указана после выполнения.</p></div></div>
      <div class="panel" style="padding:20px;margin-bottom:18px"><div class="eyebrow" style="margin-bottom:12px">Новое задание</div>
      <div id="packDraftWrap"></div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap"><button class="btn btn-ghost" onclick="packAddDraftItem()">+ Добавить товар</button></div>
      <div style="margin-top:14px"><div class="eyebrow" style="margin-bottom:6px;color:var(--ink-soft)">Общий комментарий к заданию</div>
      <textarea class="search" id="packDraftComment" rows="2" style="width:100%" placeholder="Например: образцы приложены, срок до пятницы"></textarea></div>
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><button class="btn btn-accent" onclick="packSubmitPortal()">Отправить задание</button></div></div>
      <div class="eyebrow" style="margin-bottom:10px">Мои задания</div><div id="packPortalList"></div>`;
    s1.after(s2);
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', packInjectDom); else packInjectDom();

// ===== сторона сотрудников =====
async function packLoadStaff(force){
  const [s,p,t] = await Promise.all([
    sb.from('pack_services').select('*').order('sort'),
    sb.from('pack_client_prices').select('*'),
    sb.from('pack_tasks').select('*').order('created_at',{ascending:false}).limit(500)
  ]);
  if(s.error||p.error||t.error){ console.error(s.error||p.error||t.error); toast('Не удалось загрузить задания на упаковку'); return; }
  packServices = s.data||[]; packPrices = p.data||[]; packTasks = t.data||[];
  renderPacking();
}
function packSetView(v){ packView = v; renderPacking(); }
function renderPacking(){
  const b1 = document.getElementById('packViewTasksBtn'), b2 = document.getElementById('packViewTariffsBtn');
  if(b1) b1.className = 'btn ' + (packView==='tasks'?'btn-accent':'btn-ghost');
  if(b2) b2.className = 'btn ' + (packView==='tariffs'?'btn-accent':'btn-ghost');
  if(packView==='tasks') renderPackTasks(); else renderPackTariffs();
}
function packTaskTotal(t){
  let planned = 0, fact = 0;
  (t.items||[]).forEach(i=>(i.services||[]).forEach(s=>{ planned += (s.qty||0)*(s.price||0); fact += (s.doneQty||0)*(s.price||0); }));
  return {planned, fact};
}
const packMoney = n => (Math.round((n||0)*100)/100).toLocaleString('ru-RU') + ' ₽';
function renderPackTasks(){
  const wrap = document.getElementById('packBody'); if(!wrap) return;
  const counts = {active:0,new:0,in_progress:0,done:0,all:packTasks.length};
  packTasks.forEach(t=>{ if(counts[t.status]!==undefined) counts[t.status]++; if(t.status==='new'||t.status==='in_progress') counts.active++; });
  const chips = [['active','Активные'],['new','Новые'],['in_progress','В работе'],['done','Выполненные'],['all','Все']]
    .map(([k,l])=>`<button class="btn ${packStatusFilter===k?'btn-accent':'btn-ghost'}" style="padding:6px 12px" onclick="packStatusFilter='${k}';renderPackTasks()">${l} · ${counts[k]}</button>`).join('');
  const names = [...new Set(packTasks.map(t=>t.client_name))].sort();
  const clientSel = `<select class="search" onchange="packClientFilter=this.value;renderPackTasks()"><option value="">Все клиенты</option>${names.map(n=>`<option value="${escapeHtml(n)}" ${n===packClientFilter?'selected':''}>${escapeHtml(n)}</option>`).join('')}</select>`;
  let list = packTasks.filter(t=>{
    if(packClientFilter && t.client_name!==packClientFilter) return false;
    if(packStatusFilter==='active') return t.status==='new'||t.status==='in_progress';
    if(packStatusFilter==='all') return true;
    return t.status===packStatusFilter;
  });
  wrap.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center">${chips}${clientSel}</div>` +
    (list.length ? list.map(packTaskCard).join('') : '<div class="panel empty">Заданий нет</div>');
}
function packTaskCard(t){
  const st = PACK_STATUS[t.status]||[t.status,'shipped'];
  const open = packExpanded.has(t.id);
  const tot = packTaskTotal(t);
  const pieces = (t.items||[]).reduce((a,i)=>a+(i.qty||0),0);
  const sum = t.status==='done' ? packMoney(tot.fact) : (t.status==='cancelled' ? '' : 'план ' + packMoney(tot.planned));
  let body = '';
  if(open){
    const editable = t.status==='in_progress';
    body = `<div style="padding:0 20px 16px;border-top:1px solid var(--line)">
      ${t.comment?`<div style="margin:12px 0;padding:10px 12px;background:var(--warn-bg);border-radius:8px;font-size:13px">💬 ${escapeHtml(t.comment)}</div>`:''}
      ${(t.items||[]).map((it,ii)=>`<div style="margin-top:14px">
        <div style="font-weight:600;font-size:14px">${escapeHtml(it.name||it.sku)} <span class="mono" style="font-weight:400;color:var(--ink-faint)">${escapeHtml(it.sku||'')}${it.size?' · '+escapeHtml(it.size):''}</span> — ${it.qty} шт</div>
        ${it.comment?`<div style="font-size:12px;color:var(--ink-soft);margin:3px 0">${escapeHtml(it.comment)}</div>`:''}
        ${(it.services||[]).map((s,si)=>`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:5px 0;font-size:13px;border-bottom:1px dashed var(--line)">
          ${editable?`<input type="checkbox" ${s.done?'checked':''} onchange="packSetDone('${t.id}',${ii},${si},this.checked)">`:`<span>${s.done?'✅':'▫️'}</span>`}
          <span style="flex:1;min-width:180px">${escapeHtml(s.name)}${s.isPackage?' <b>(под ключ)</b>':''}${s.description?`<span style="color:var(--ink-faint);font-size:12px"> — ${escapeHtml(s.description)}</span>`:''}</span>
          <span class="mono">план ${s.qty} ${escapeHtml(s.unit||'шт')}</span>
          ${editable?`факт <input class="search" type="number" min="0" style="width:80px;padding:4px 8px" value="${s.doneQty||0}" onchange="packSetFact('${t.id}',${ii},${si},this.value)">`:(t.status==='done'?`<span class="mono">факт ${s.doneQty||0}</span>`:'')}
          <span class="mono" style="color:var(--ink-faint)">${packMoney(s.price)} / ${escapeHtml(s.unit||'шт')}</span>
        </div>`).join('') || '<div style="font-size:12px;color:var(--ink-faint)">Услуги не выбраны</div>'}
      </div>`).join('')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
        <button class="btn btn-ghost" onclick="packPrint('${t.id}')">🖨 Печать для упаковщика</button>
        ${t.status==='new'?`<button class="btn btn-accent" onclick="packSetStatus('${t.id}','in_progress')">▶ Взять в работу</button>`:''}
        ${t.status==='in_progress'?`<button class="btn btn-accent" onclick="packFinish('${t.id}')">✔ Завершить</button>`:''}
        ${(t.status==='new'||t.status==='in_progress')?`<button class="btn btn-ghost" style="color:var(--warn)" onclick="packCancel('${t.id}')">Отменить</button>`:''}
      </div></div>`;
  }
  return `<div class="panel" style="padding:0;margin-bottom:10px;overflow:hidden">
    <div style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;cursor:pointer" onclick="packToggle('${t.id}')">
      <div><div style="font-weight:600;font-size:14px">${open?'▼':'▶'} ${escapeHtml(t.id)} · ${escapeHtml(t.client_name)}</div>
      <div style="font-size:12px;color:var(--ink-faint)">${new Date(t.created_at).toLocaleString('ru-RU')} · ${(t.items||[]).length} поз. · ${pieces} шт</div></div>
      <div style="display:flex;align-items:center;gap:12px"><span class="mono" style="font-weight:600">${sum}</span><span class="status ${st[1]}">${st[0]}</span></div>
    </div>${body}</div>`;
}
function packToggle(id){ if(packExpanded.has(id)) packExpanded.delete(id); else packExpanded.add(id); renderPackTasks(); }
async function packSaveTask(t, fields){
  const { error } = await sb.from('pack_tasks').update({...fields, updated_at:new Date().toISOString()}).eq('id', t.id);
  if(error){ console.error(error); toast('Не удалось сохранить'); return false; }
  return true;
}
async function packSetStatus(id, status){
  const t = packTasks.find(x=>x.id===id); if(!t) return;
  const f = {status}; if(status==='in_progress') f.started_at = new Date().toISOString();
  if(await packSaveTask(t, f)){ Object.assign(t, f); renderPackTasks(); }
}
function packSetDone(id, ii, si, v){
  const t = packTasks.find(x=>x.id===id); const s = t.items[ii].services[si];
  s.done = !!v; if(v && !s.doneQty) s.doneQty = s.qty;
  packSaveTask(t,{items:t.items}).then(()=>renderPackTasks());
}
function packSetFact(id, ii, si, v){
  const t = packTasks.find(x=>x.id===id); const s = t.items[ii].services[si];
  s.doneQty = Math.max(0, parseFloat(v)||0); s.done = s.doneQty>0;
  packSaveTask(t,{items:t.items}).then(()=>renderPackTasks());
}
async function packFinish(id){
  const t = packTasks.find(x=>x.id===id);
  const open = (t.items||[]).flatMap(i=>i.services||[]).filter(s=>!(s.doneQty>0)).length;
  if(!await customConfirm(open ? `По ${open} услугам факт не указан (будет 0 ₽). Завершить задание?` : 'Завершить задание? Стоимость будет посчитана по факту.', {danger:false, okText:'Завершить'})) return;
  const f = {status:'done', done_at:new Date().toISOString()};
  if(await packSaveTask(t,f)){ Object.assign(t,f); toast('Задание выполнено — сумма ' + packMoney(packTaskTotal(t).fact)); renderPackTasks(); }
}
async function packCancel(id){
  const t = packTasks.find(x=>x.id===id);
  if(!await customConfirm('Отменить задание ' + id + '?')) return;
  if(await packSaveTask(t,{status:'cancelled'})){ t.status='cancelled'; renderPackTasks(); }
}
function packPrint(id){
  const t = packTasks.find(x=>x.id===id); if(!t) return;
  const w = window.open('', '_blank'); if(!w){ toast('Разрешите всплывающие окна для печати'); return; }
  const items = (t.items||[]).map((it,n)=>`<div class="item"><div class="h"><b>${n+1}. ${escapeHtml(it.name||it.sku)}</b> &nbsp; арт. ${escapeHtml(it.sku||'—')}${it.size?' · размер '+escapeHtml(it.size):''} &nbsp; <b>${it.qty} шт</b></div>
    ${it.comment?`<div class="c">Комментарий: ${escapeHtml(it.comment)}</div>`:''}
    <table><tr><th style="width:26px">✔</th><th>Услуга</th><th style="width:90px">План</th><th style="width:90px">Факт</th></tr>
    ${(it.services||[]).map(s=>`<tr><td class="bx">☐</td><td>${escapeHtml(s.name)}${s.isPackage?' <b>(ПОД КЛЮЧ)</b>':''}${s.description?`<div class="d">${escapeHtml(s.description)}</div>`:''}</td><td>${s.qty} ${escapeHtml(s.unit||'шт')}</td><td></td></tr>`).join('') || '<tr><td colspan="4">Услуги не выбраны</td></tr>'}</table></div>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t.id)}</title><style>
    body{font-family:Arial,sans-serif;font-size:13px;margin:18px;color:#000}h1{font-size:20px;margin:0 0 4px}.meta{margin-bottom:10px;font-size:13px}
    .note{border:1px solid #000;padding:8px;margin:10px 0}.item{margin-top:14px;page-break-inside:avoid}.h{font-size:14px;margin-bottom:4px}.c{margin:4px 0;font-style:italic}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:5px 7px;text-align:left;vertical-align:top}.bx{text-align:center;font-size:18px}.d{font-size:11px;color:#444}
    .sign{margin-top:26px;display:flex;gap:40px}.sign div{border-top:1px solid #000;width:240px;padding-top:4px;font-size:11px}</style></head><body>
    <h1>Задание на упаковку ${escapeHtml(t.id)}</h1>
    <div class="meta">Клиент: <b>${escapeHtml(t.client_name)}</b> &nbsp;·&nbsp; Дата: ${new Date(t.created_at).toLocaleDateString('ru-RU')}</div>
    ${t.comment?`<div class="note"><b>Комментарий клиента:</b> ${escapeHtml(t.comment)}</div>`:''}
    ${items}
    <div class="sign"><div>Упаковщик (ФИО, подпись)</div><div>Принял (дата)</div></div>
    <script>window.onload=function(){setTimeout(function(){window.print();},300)}<\/script></body></html>`);
  w.document.close();
}
// --- услуги и тарифы ---
function renderPackTariffs(){
  const wrap = document.getElementById('packBody'); if(!wrap) return;
  const cl = clients.slice().sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  const cid = packTariffClient;
  const price = sid => (packPrices.find(p=>p.client_id===cid && p.service_id===sid)||{}).price;
  const cats = [...new Set(packServices.map(s=>s.category))];
  wrap.innerHTML = `<div class="panel" style="padding:16px;margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-size:13px">Тарифы клиента:</span>
      <select class="search" onchange="packTariffClient=this.value;renderPackTariffs()"><option value="">— базовые цены —</option>${cl.map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===cid?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      <span style="font-size:12px;color:var(--ink-faint)">${cid?'Пустое поле = действует базовая цена':'Базовая цена действует для всех, у кого нет своей'}</span>
      <button class="btn btn-ghost" style="margin-left:auto" onclick="packNewService()">+ Услуга / пакет «под ключ»</button></div>` +
    cats.map(cat=>`<div class="panel" style="padding:0;margin-bottom:12px;overflow:hidden"><div style="padding:12px 20px;font-weight:600;background:var(--bg-soft,#f6f4ee)">${escapeHtml(cat)}</div>
      ${packServices.filter(s=>s.category===cat).map(s=>`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 20px;border-top:1px solid var(--line);font-size:13px;${s.active?'':'opacity:.5'}">
        <span style="flex:1;min-width:220px">${escapeHtml(s.name)}${s.is_package?' <b>(под ключ)</b>':''}${s.description?`<div style="font-size:12px;color:var(--ink-faint)">${escapeHtml(s.description)}</div>`:''}</span>
        <span style="color:var(--ink-faint)">₽ / ${escapeHtml(s.unit)}</span>
        ${cid?`<input class="search" type="number" min="0" step="0.5" style="width:100px" placeholder="${s.base_price||0}" value="${price(s.id)??''}" onchange="packSetClientPrice('${s.id}',this.value)">`
             :`<input class="search" type="number" min="0" step="0.5" style="width:100px" value="${s.base_price||0}" onchange="packSetBasePrice('${s.id}',this.value)">`}
        <button class="btn btn-ghost" style="padding:4px 10px" onclick="packToggleActive('${s.id}')">${s.active?'Скрыть':'Показать'}</button>
      </div>`).join('')}</div>`).join('');
}
async function packSetBasePrice(id, v){
  const val = Math.max(0, parseFloat(v)||0);
  const { error } = await sb.from('pack_services').update({base_price:val}).eq('id',id);
  if(error){ console.error(error); toast('Не удалось сохранить цену'); return; }
  packServices.find(s=>s.id===id).base_price = val; toast('Сохранено');
}
async function packSetClientPrice(sid, v){
  const cid = packTariffClient; if(!cid) return;
  if(v===''||v===null){
    const { error } = await sb.from('pack_client_prices').delete().eq('client_id',cid).eq('service_id',sid);
    if(error){ console.error(error); toast('Не удалось сохранить'); return; }
    packPrices = packPrices.filter(p=>!(p.client_id===cid&&p.service_id===sid));
  } else {
    const price = Math.max(0, parseFloat(v)||0);
    const { error } = await sb.from('pack_client_prices').upsert({client_id:cid, service_id:sid, price});
    if(error){ console.error(error); toast('Не удалось сохранить'); return; }
    const ex = packPrices.find(p=>p.client_id===cid&&p.service_id===sid);
    if(ex) ex.price = price; else packPrices.push({client_id:cid, service_id:sid, price});
  }
  toast('Сохранено');
}
async function packToggleActive(id){
  const s = packServices.find(x=>x.id===id);
  const { error } = await sb.from('pack_services').update({active:!s.active}).eq('id',id);
  if(error){ console.error(error); toast('Не удалось сохранить'); return; }
  s.active = !s.active; renderPackTariffs();
}
function packNewService(){
  const cats = [...new Set(packServices.map(s=>s.category))];
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `<div style="background:#fff;border-radius:12px;padding:22px;max-width:460px;width:100%">
    <div style="font-weight:600;margin-bottom:12px">Новая услуга</div>
    <input class="search" id="nsName" placeholder="Название (напр. Упаковка под ключ: КИЗ + ШК + пакет)" style="width:100%;margin-bottom:8px">
    <input class="search" id="nsDesc" placeholder="Что входит (для пакета под ключ)" style="width:100%;margin-bottom:8px">
    <div style="display:flex;gap:8px;margin-bottom:8px"><input class="search" id="nsCat" list="nsCats" placeholder="Категория" value="Под ключ" style="flex:1"><datalist id="nsCats">${cats.map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist>
    <input class="search" id="nsUnit" value="шт" style="width:80px"><input class="search" id="nsPrice" type="number" min="0" placeholder="₽" style="width:90px"></div>
    <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin-bottom:14px"><input type="checkbox" id="nsPkg" checked> Пакет «под ключ»</label>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" id="nsCancel">Отмена</button><button class="btn btn-accent" id="nsOk">Добавить</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#nsCancel').onclick = ()=>ov.remove();
  ov.querySelector('#nsOk').onclick = async ()=>{
    const name = ov.querySelector('#nsName').value.trim(); if(!name){ toast('Укажите название'); return; }
    const row = {id:'PS'+Date.now().toString(36).toUpperCase(), name, description: ov.querySelector('#nsDesc').value.trim()||null,
      category: ov.querySelector('#nsCat').value.trim()||'Прочее', unit: ov.querySelector('#nsUnit').value.trim()||'шт',
      base_price: Math.max(0,parseFloat(ov.querySelector('#nsPrice').value)||0), is_package: ov.querySelector('#nsPkg').checked,
      sort: (Math.max(0,...packServices.map(s=>s.sort))+1)};
    const { error } = await sb.from('pack_services').insert(row);
    if(error){ console.error(error); toast('Не удалось добавить'); return; }
    packServices.push({...row, active:true}); ov.remove(); renderPackTariffs();
  };
}

// ===== кабинет клиента =====
function packNewDraftItem(){ return {key:'', sku:'', name:'', size:'', qty:1, comment:'', svc:{}, q:''}; }
async function packLoadPortal(){
  if(!portalToken) return;
  const [c,t] = await Promise.all([sb.rpc('client_portal_pack_catalog',{p_token:portalToken}), sb.rpc('client_portal_pack_tasks',{p_token:portalToken})]);
  if(c.error||t.error){ console.error(c.error||t.error); return; }
  packCatalog = c.data||[]; packPortalTasks = t.data||[];
  if(!packDraft.length) packDraft = [packNewDraftItem()];
  packRenderDraft(); packRenderPortalList();
}
function packAddDraftItem(){ packDraft.push(packNewDraftItem()); packRenderDraft(); }
function packRemoveDraftItem(i){ packDraft.splice(i,1); if(!packDraft.length) packDraft.push(packNewDraftItem()); packRenderDraft(); }
function packPickProduct(i, key){
  const d = packDraft[i]; d.key = key;
  if(key==='' || key==='__custom'){ d.sku=''; d.name=''; d.size=''; }
  else { const [sku,size] = key.split('~~'); const inv = inventory.find(x=>x.sku===sku && (x.size||'')===size); d.sku=sku; d.size=size; d.name=inv?inv.name:sku; }
  packRenderDraft();
}
function packDefaultQty(d, s){ return s.unit==='шт' ? d.qty : 1; }
function packSetItemQty(i, v){
  const d = packDraft[i]; d.qty = Math.max(0, parseInt(v)||0);
  Object.keys(d.svc).forEach(id=>{ const s = packCatalog.find(x=>x.id===id); if(s && !d.svc[id].touched) d.svc[id].qty = packDefaultQty(d,s); });
  packRenderDraft();
}
function packToggleSvc(i, id, on){
  const d = packDraft[i]; const s = packCatalog.find(x=>x.id===id);
  if(on) d.svc[id] = {qty: packDefaultQty(d,s), touched:false}; else delete d.svc[id];
  packRenderDraft();
}
function packSetSvcQty(i, id, v){ packDraft[i].svc[id].qty = Math.max(0, parseFloat(v)||0); packDraft[i].svc[id].touched = true; }
function packSetQuery(i, v){ packDraft[i].q = v; packRenderDraft(true, i); }
function packRenderDraft(keepFocus, fi){
  const wrap = document.getElementById('packDraftWrap'); if(!wrap) return;
  const seen = new Set(); const opts = [];
  inventory.forEach(x=>{ const k = x.sku+'~~'+(x.size||''); if(seen.has(k)) return; seen.add(k); opts.push([k, `${x.sku} — ${x.name}${x.size?' ('+x.size+')':''}`]); });
  wrap.innerHTML = packDraft.map((d,i)=>{
    const q = (d.q||'').toLowerCase();
    const cats = [...new Set(packCatalog.map(s=>s.category))];
    const selected = Object.keys(d.svc).length;
    const manual = d.key==='__custom';
    return `<div style="border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="search" style="flex:1;min-width:220px" onchange="packPickProduct(${i},this.value)"><option value="">— выберите товар со склада —</option>${opts.map(([k,l])=>`<option value="${escapeHtml(k)}" ${k===d.key?'selected':''}>${escapeHtml(l)}</option>`).join('')}<option value="__custom" ${manual?'selected':''}>✏️ Другой товар (ввести вручную, ещё не на складе)</option></select>
        <input class="search" type="number" min="1" style="width:90px" value="${d.qty}" onchange="packSetItemQty(${i},this.value)"> <span style="font-size:13px">шт</span>
        <button class="btn btn-ghost" style="padding:4px 10px;color:var(--warn)" onclick="packRemoveDraftItem(${i})">✕</button></div>
      ${manual?`<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><input class="search" placeholder="Артикул" style="width:150px" value="${escapeHtml(d.sku)}" oninput="packDraft[${i}].sku=this.value"><input class="search" placeholder="Название товара" style="flex:1;min-width:200px" value="${escapeHtml(d.name)}" oninput="packDraft[${i}].name=this.value"><input class="search" placeholder="Размер" style="width:90px" value="${escapeHtml(d.size)}" oninput="packDraft[${i}].size=this.value"></div>`:''}
      <textarea class="search" rows="2" style="width:100%;margin-top:8px" placeholder="ТЗ по этому товару: что именно нужно сделать, особенности, как упаковать" oninput="packDraft[${i}].comment=this.value">${escapeHtml(d.comment)}</textarea>
      <details style="margin-top:8px" ${selected||q?'open':''}><summary style="cursor:pointer;font-size:13px;font-weight:600">Услуги${selected?` · выбрано ${selected}`:''}</summary>
        <input class="search" id="packQ${i}" placeholder="Поиск услуги…" style="width:100%;margin:8px 0" value="${escapeHtml(d.q||'')}" oninput="packSetQuery(${i},this.value)">
        ${cats.map(cat=>{
          const list = packCatalog.filter(s=>s.category===cat && (!q || s.name.toLowerCase().includes(q)));
          if(!list.length) return '';
          return `<div style="font-size:12px;color:var(--ink-faint);margin:10px 0 4px;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(cat)}</div>` + list.map(s=>{
            const sel = d.svc[s.id];
            return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:13px;flex-wrap:wrap"><label style="display:flex;gap:8px;align-items:center;flex:1;min-width:200px;cursor:pointer"><input type="checkbox" ${sel?'checked':''} onchange="packToggleSvc(${i},'${s.id}',this.checked)"><span>${escapeHtml(s.name)}${s.isPackage?' <b>(под ключ)</b>':''}${s.description?`<span style="color:var(--ink-faint);font-size:12px"> — ${escapeHtml(s.description)}</span>`:''}</span></label>
              ${sel?`<input class="search" type="number" min="0" style="width:80px;padding:4px 8px" value="${sel.qty}" onchange="packSetSvcQty(${i},'${s.id}',this.value)"><span style="font-size:12px;color:var(--ink-faint)">${escapeHtml(s.unit)}</span>`:''}</div>`;
          }).join('');
        }).join('')}
      </details></div>`;
  }).join('');
  if(keepFocus){ const el = document.getElementById('packQ'+fi); if(el){ el.focus(); const n = el.value.length; el.setSelectionRange(n,n); } }
}
async function packSubmitPortal(){
  const items = [];
  for(const d of packDraft){
    if(!(d.sku||d.name) || d.qty<=0) continue;
    const services = Object.entries(d.svc).filter(([,v])=>v.qty>0).map(([id,v])=>({serviceId:id, qty:v.qty}));
    if(!services.length && !(d.comment||'').trim()){ toast('У товара «'+(d.name||d.sku)+'» нет услуг и ТЗ — отметьте услуги или опишите задачу'); return; }
    items.push({sku:d.sku||d.name, name:d.name||d.sku, size:d.size||'', qty:d.qty, comment:d.comment, services});
  }
  if(!items.length){ toast('Добавьте хотя бы один товар с количеством'); return; }
  const { data, error } = await sb.rpc('client_portal_pack_create', {p_token:portalToken, p_comment:(document.getElementById('packDraftComment').value||'').trim(), p_items:items});
  if(error){ console.error(error); toast('Не удалось отправить задание — попробуйте ещё раз'); return; }
  toast('Задание ' + data + ' отправлено');
  packDraft = [packNewDraftItem()]; document.getElementById('packDraftComment').value = '';
  await packLoadPortal();
}
function packRenderPortalList(){
  const wrap = document.getElementById('packPortalList'); if(!wrap) return;
  if(!packPortalTasks.length){ wrap.innerHTML = '<div class="panel empty">Заданий пока нет</div>'; return; }
  wrap.innerHTML = packPortalTasks.map(t=>{
    const st = PACK_STATUS[t.status]||[t.status,'shipped']; const open = packExpanded.has(t.id);
    const done = t.status==='done'; let total = 0;
    (t.items||[]).forEach(i=>(i.services||[]).forEach(s=>{ total += (s.doneQty||0)*(s.price||0); }));
    return `<div class="panel" style="padding:0;margin-bottom:10px;overflow:hidden">
      <div style="padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;cursor:pointer" onclick="packToggle('${t.id}');packRenderPortalList()">
        <div><div style="font-weight:600;font-size:14px">${open?'▼':'▶'} ${escapeHtml(t.id)}</div><div style="font-size:12px;color:var(--ink-faint)">${new Date(t.created_at).toLocaleDateString('ru-RU')} · ${(t.items||[]).length} поз.</div></div>
        <div style="display:flex;gap:12px;align-items:center">${done?`<span class="mono" style="font-weight:600">${packMoney(total)}</span>`:''}<span class="status ${st[1]}">${st[0]}</span></div></div>
      ${open?`<div style="padding:0 20px 16px;border-top:1px solid var(--line);font-size:13px">
        ${t.comment?`<div style="margin:10px 0;color:var(--ink-soft)">💬 ${escapeHtml(t.comment)}</div>`:''}
        ${(t.items||[]).map(it=>`<div style="margin-top:10px"><b>${escapeHtml(it.name||it.sku)}</b> <span class="mono" style="color:var(--ink-faint)">${escapeHtml(it.sku||'')}</span> — ${it.qty} шт
          ${(it.services||[]).map(s=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:2px 0;color:var(--ink-soft)"><span>${escapeHtml(s.name)}</span><span class="mono">${done?`${s.doneQty||0} ${escapeHtml(s.unit||'шт')} × ${packMoney(s.price)} = ${packMoney((s.doneQty||0)*(s.price||0))}`:`${s.qty} ${escapeHtml(s.unit||'шт')}`}</span></div>`).join('')}</div>`).join('')}
        ${t.status==='new'?`<div style="margin-top:12px"><button class="btn btn-ghost" style="color:var(--warn)" onclick="packCancelPortal('${t.id}')">Отменить задание</button></div>`:''}
      </div>`:''}</div>`;
  }).join('');
}
async function packCancelPortal(id){
  if(!await customConfirm('Отменить задание ' + id + '?')) return;
  const { data, error } = await sb.rpc('client_portal_pack_cancel', {p_token:portalToken, p_id:id});
  if(error || !data){ toast('Отменить нельзя — задание уже взято в работу'); }
  await packLoadPortal();
}
