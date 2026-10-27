// ---------- НАБОРЫ В ПАРАХ (перчатки и т.п.) ----------
// Идея: общий остаток хранится в ПАРАХ в одном «базовом» артикуле (1 пара). Артикулы 2/5/6/10/12 пар — виртуальные наборы
// (kit_components: базовый артикул × N). Заказ набора списывает N пар. На WB/Ozon остаток набора = floor(пар / N) (считает сервер).
let gk = null; // {tab, client, merge:{groups}, recv:{}, rep:{}, gen:{}}

function gkClients(){
  const names = [...new Set(inventory.map(i=>i.client||'').filter(Boolean))].sort();
  return names;
}
function gkItems(client){
  return inventory.filter(i=>(i.client||'')===client && (i.warehouseId||'MAIN')==='MAIN');
}
function gkGuessPairs(item){
  const m = String(item.sku||'').match(/(\d+)\s*$/);
  if(m){ const n = parseInt(m[1]); if(n>0 && n<=100) return n; }
  const m2 = String(item.name||'').match(/(\d+)\s*(?:пар|шт)/i);
  if(m2){ const n = parseInt(m2[1]); if(n>0 && n<=100) return n; }
  return 0;
}
function gkGroupName(item){
  const s = String(item.sku||'').replace(/\s*\d+\s*$/,'').trim();
  return s || item.sku;
}
function gkBaseItems(client){
  const baseKeys = new Set(kitComponents.filter(k=>k.kitClient===client).map(k=>k.componentSku+'~~'+k.componentSize));
  return gkItems(client).filter(i=>!i.isKit && baseKeys.has(i.sku+'~~'+(i.size||'')));
}
function gkKitsOf(base){
  return kitComponents.filter(k=>k.kitClient===(base.client||'') && k.componentSku===base.sku && k.componentSize===(base.size||''))
    .map(k=>({k, item: findInventoryItem(k.kitSku, k.kitClient, k.kitSize, k.kitWarehouseId)})).filter(x=>x.item);
}

function openGloveKits(){
  if(typeof clientViewMode!=='undefined' && clientViewMode) return;
  gk = {tab:'merge', client:'', merge:null, recv:{packSize:12, packs:1, loose:0, base:'', bill:'packs'}, rep:{rows:{}}, gen:{base:'', sizes:{2:true,5:true,6:true,10:true,12:true}}};
  gkRender();
}
function closeGloveKits(){ const e = document.getElementById('gkOverlay'); if(e) e.remove(); gk = null; }
function gkSetTab(t){ gk.tab = t; gkRender(); }
function gkSetClient(v){ gk.client = v; gk.merge = null; gk.recv.base=''; gk.gen.base=''; gk.rep={rows:{}}; gkRender(); }

function gkRender(){
  if(!gk) return;
  let ov = document.getElementById('gkOverlay');
  if(!ov){
    ov = document.createElement('div'); ov.id = 'gkOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto';
    document.body.appendChild(ov);
  }
  const tabs = [['merge','1. Объединить артикулы'],['gen','2. Создать артикулы 2/5/6/10/12'],['recv','3. Приёмка пачками'],['rep','4. Переупаковка']];
  const clients = gkClients();
  let body = '';
  if(!gk.client) body = '<div class="empty" style="padding:30px">Выберите клиента</div>';
  else if(gk.tab==='merge') body = gkMergeHtml();
  else if(gk.tab==='gen') body = gkGenHtml();
  else if(gk.tab==='recv') body = gkRecvHtml();
  else body = gkRepHtml();
  ov.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:860px;width:100%;padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.25)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      <h2 style="margin:0;font-size:18px">🧤 Наборы в парах</h2>
      <button class="btn btn-ghost" onclick="closeGloveKits()">✕ Закрыть</button>
    </div>
    <div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;line-height:1.5">Общий остаток хранится в <b>парах</b> в одном базовом артикуле «1 пара». Артикулы на 2/5/6/10/12 пар — наборы: при заказе списывается нужное число пар, а WB/Ozon видят остаток набора = пары ÷ размер набора (с округлением вниз).</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <select class="search" onchange="gkSetClient(this.value)"><option value="">— клиент —</option>${clients.map(n=>`<option value="${escapeHtml(n)}" ${n===gk.client?'selected':''}>${escapeHtml(n)}</option>`).join('')}</select>
      ${tabs.map(([k,l])=>`<button class="btn ${gk.tab===k?'btn-accent':'btn-ghost'}" style="padding:6px 12px" onclick="gkSetTab('${k}')">${l}</button>`).join('')}
    </div>
    <div id="gkBody">${body}</div>
  </div>`;
}

// ---------- 1. ОБЪЕДИНЕНИЕ ----------
function gkBuildMerge(){
  const items = gkItems(gk.client).filter(i=>!i.isKit);
  const map = new Map();
  items.forEach(i=>{
    const g = gkGroupName(i);
    if(!map.has(g)) map.set(g, []);
    map.get(g).push(i);
  });
  const groups = [];
  let n = 0;
  map.forEach((arr, g)=>{
    if(arr.length<2) return;
    const rows = arr.map(i=>({key:itemKey(i), pairs:gkGuessPairs(i)})).sort((a,b)=>a.pairs-b.pairs);
    const allGuessed = rows.every(r=>r.pairs>0);
    groups.push({id:'g'+(n++), gname:g, baseSku:g+'_пара', on:allGuessed, rows});
  });
  gk.merge = {groups};
}
function gkMergeHtml(){
  if(!gk.merge) gkBuildMerge();
  const gs = gk.merge.groups;
  if(!gs.length) return '<div class="empty" style="padding:24px">Не нашёл групп артикулов, которые можно объединить (нужно минимум 2 похожих артикула вроде «Оранж5», «Оранж6»).</div>';
  return `<div style="font-size:13px;margin-bottom:10px">Артикулы сгруппированы по названию без числа в конце. Проверьте «пар в артикуле» (подставил число из артикула/названия), отметьте группы, которые нужно объединить. Остаток каждого артикула пересчитается в пары. <b>Штрихкоды артикулов остаются</b>.</div>` +
  gs.map(g=>{
    const total = g.rows.reduce((s,r)=>{ const it = gkItemByKey(r.key); return s + (it ? it.qty*(r.pairs||0) : 0); },0);
    return `<div class="panel" style="padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;gap:6px;align-items:center;font-weight:600"><input type="checkbox" ${g.on?'checked':''} onchange="gkMergeToggle('${g.id}',this.checked)"> ${escapeHtml(g.gname)}</label>
        <span style="font-size:12px;color:var(--ink-faint)">базовый артикул (1 пара):</span>
        <input class="search mono" style="width:180px" value="${escapeHtml(g.baseSku)}" oninput="gkMergeBase('${g.id}',this.value)">
        <span class="mono" id="gkTot-${g.id}" style="margin-left:auto">${total} пар</span>
      </div>
      ${g.rows.map((r,ri)=>{ const it = gkItemByKey(r.key); if(!it) return '';
        return `<div style="display:flex;gap:10px;align-items:center;padding:4px 0;font-size:13px;border-top:1px dashed var(--line);margin-top:6px">
          <span class="mono" style="min-width:150px">${escapeHtml(it.sku)}</span>
          <span style="flex:1;color:var(--ink-soft);font-size:12px">${escapeHtml(it.name)}${it.size?' · '+escapeHtml(it.size):''}</span>
          <span class="mono">${it.qty} шт</span>
          <span style="font-size:12px;color:var(--ink-faint)">пар в артикуле</span>
          <input class="search" type="number" min="0" style="width:70px" value="${r.pairs||''}" oninput="gkMergePairs('${g.id}',${ri},this.value)">
        </div>`; }).join('')}
    </div>`;
  }).join('') +
  `<div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn btn-accent" onclick="gkMergeApply()">Объединить отмеченные группы</button></div>`;
}
function gkItemByKey(key){ const p = parseItemKey(key); return findInventoryItem(p.sku, p.client, p.size, p.warehouseId); }
function gkGroup(id){ return gk.merge.groups.find(g=>g.id===id); }
function gkMergeToggle(id,v){ gkGroup(id).on = !!v; }
function gkMergeBase(id,v){ gkGroup(id).baseSku = v.trim(); }
function gkMergePairs(id,ri,v){
  const g = gkGroup(id); g.rows[ri].pairs = Math.max(0, parseInt(v)||0);
  const total = g.rows.reduce((s,r)=>{ const it = gkItemByKey(r.key); return s + (it ? it.qty*(r.pairs||0) : 0); },0);
  const el = document.getElementById('gkTot-'+id); if(el) el.textContent = total+' пар';
}
// Чистая функция планирования — чтобы можно было показать итог до применения и проверить тестом
function gkPlanGroup(g){
  const rows = g.rows.map(r=>({it:gkItemByKey(r.key), pairs:r.pairs})).filter(r=>r.it && !r.it.isKit && r.pairs>0);
  if(rows.length<1) return null;
  const baseRow = rows.find(r=>r.pairs===1);
  const sku = baseRow ? baseRow.it.sku : g.baseSku;
  const size = baseRow ? (baseRow.it.size||'') : (rows[0].it.size||'');
  const kits = rows.filter(r=>r!==baseRow);
  const addPairs = kits.reduce((s,r)=>s + r.it.qty*r.pairs, 0);
  return {baseRow, baseSku:sku, baseSize:size, kits, addPairs, template:rows[0].it};
}
async function gkMergeApply(){
  const plans = gk.merge.groups.filter(g=>g.on).map(g=>({g, p:gkPlanGroup(g)})).filter(x=>x.p);
  if(!plans.length){ toast('Не отмечено ни одной группы с указанным числом пар'); return; }
  for(const {g,p} of plans){
    if(!p.baseSku){ toast('Укажите базовый артикул для группы '+g.gname); return; }
    if(p.kits.some(k=>k.it.sku===p.baseSku && (k.it.size||'')===p.baseSize)){ toast('Базовый артикул группы «'+g.gname+'» совпадает с одним из набор-артикулов — измените имя'); return; }
  }
  const lines = plans.map(({g,p})=>`• ${g.gname}: база «${p.baseSku}», ${p.kits.length} арт. → наборы, итого ${p.addPairs} пар`).join('\n');
  if(!await customConfirm('Объединить в пары?\n\n'+lines+'\n\nОстатки артикулов обнулятся и перейдут в базовый артикул в парах. Это можно откатить только вручную.', {danger:false, okText:'Объединить'})) return;
  for(const {g,p} of plans){
    let base = findInventoryItem(p.baseSku, gk.client, p.baseSize, 'MAIN');
    if(!base){
      base = {sku:p.baseSku, name: p.template.name.replace(/\d+\s*пар\w*/i,'').replace(/\s+/g,' ').trim()+' — 1 пара', client:gk.client, size:p.baseSize, warehouseId:'MAIN', qty:0, requiresKiz:false, barcode:null, cell:null, isKit:false};
      inventory.push(base);
      await syncInventoryRow(base.sku, base.client, base.size, 'MAIN');
    }
    if(p.addPairs>0) logMovement(base.sku, base.name, p.addPairs, 'Объединение в пары', base.client, base.size, 'MAIN');
    for(const k of p.kits){
      const it = k.it;
      if(it.qty>0) logMovement(it.sku, it.name, -it.qty, `Переведён в набор (${k.pairs} пар) — остаток перенесён в пары`, it.client, it.size, 'MAIN');
      it.isKit = true; it.kitMode = 'virtual';
      await saveKitComponents(it, [{componentSku:base.sku, componentSize:base.size, qtyNeeded:k.pairs}]);
      await syncInventoryRow(it.sku, it.client, it.size, 'MAIN');
    }
  }
  toast('Готово: артикулы объединены в пары');
  gk.merge = null; gkRender(); renderInventory();
}

// ---------- 2. ГЕНЕРАТОР АРТИКУЛОВ ----------
function gkGenHtml(){
  const bases = gkBaseItems(gk.client);
  const all = gkItems(gk.client).filter(i=>!i.isKit);
  const cur = gk.gen.base;
  const sizesChk = [2,5,6,10,12].map(n=>`<label style="margin-right:12px"><input type="checkbox" ${gk.gen.sizes[n]?'checked':''} onchange="gk.gen.sizes[${n}]=this.checked"> ${n} пар</label>`).join('');
  return `<div style="font-size:13px;margin-bottom:10px">Создаёт недостающие артикулы-наборы из базового «1 пара». Штрихкоды потом добавьте в карточке набора (или подтяните из WB/Ozon).</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
    <select class="search" onchange="gk.gen.base=this.value">
      <option value="">— базовый артикул —</option>
      ${[...bases, ...all.filter(a=>!bases.includes(a))].map(i=>`<option value="${escapeHtml(itemKey(i))}" ${itemKey(i)===cur?'selected':''}>${escapeHtml(i.sku)} — ${escapeHtml(i.name)}${i.size?' ('+escapeHtml(i.size)+')':''}</option>`).join('')}
    </select>
  </div>
  <div style="margin-bottom:12px">${sizesChk}</div>
  <button class="btn btn-accent" onclick="gkGenApply()">Создать наборы</button>`;
}
async function gkGenApply(){
  const base = gk.gen.base ? gkItemByKey(gk.gen.base) : null;
  if(!base){ toast('Выберите базовый артикул'); return; }
  const sizes = [2,5,6,10,12].filter(n=>gk.gen.sizes[n]);
  if(!sizes.length){ toast('Отметьте размеры наборов'); return; }
  const prefix = base.sku.replace(/_?пара$/i,'').replace(/\s*1$/,'');
  let made = 0;
  for(const n of sizes){
    const sku = prefix + n;
    if(findInventoryItem(sku, base.client, base.size, 'MAIN')) continue;
    const it = {sku, name: (base.name.replace(/\s*[—-]\s*1 пара$/,'') + ` ${n} пар`).trim(), client:base.client, size:base.size, warehouseId:'MAIN', qty:0, isKit:true, kitMode:'virtual', barcode:null, cell:null, requiresKiz:false};
    inventory.push(it);
    await syncInventoryRow(it.sku, it.client, it.size, 'MAIN');
    await saveKitComponents(it, [{componentSku:base.sku, componentSize:base.size, qtyNeeded:n}]);
    made++;
  }
  toast(made ? `Создано наборов: ${made}` : 'Все выбранные артикулы уже существуют');
  renderInventory(); gkRender();
}

// ---------- 3. ПРИЁМКА ПАЧКАМИ ----------
function gkRecvHtml(){
  const r = gk.recv;
  const bases = gkBaseItems(gk.client);
  if(!bases.length) return '<div class="empty" style="padding:24px">Нет базовых артикулов в парах — сначала объедините артикулы или создайте наборы.</div>';
  if(!r.base || !bases.find(b=>itemKey(b)===r.base)) r.base = itemKey(bases[0]);
  const base = gkItemByKey(r.base);
  const pairs = r.packs*r.packSize + r.loose;
  const cl = clients.find(c=>c.name===gk.client);
  const rate = cl ? (cl.receivingPricePerUnit||0) : 0;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end">
    <div><div class="eyebrow">Модель (базовый артикул)</div><select class="search" style="width:100%" onchange="gk.recv.base=this.value;gkRender()">${bases.map(b=>`<option value="${escapeHtml(itemKey(b))}" ${itemKey(b)===r.base?'selected':''}>${escapeHtml(b.sku)} — ${b.qty} пар</option>`).join('')}</select></div>
    <div><div class="eyebrow">Пар в пачке</div><input class="search" type="number" min="1" value="${r.packSize}" oninput="gk.recv.packSize=Math.max(1,parseInt(this.value)||1);gkRecvPrev()"></div>
    <div><div class="eyebrow">Пачек</div><input class="search" type="number" min="0" value="${r.packs}" oninput="gk.recv.packs=Math.max(0,parseInt(this.value)||0);gkRecvPrev()"></div>
    <div><div class="eyebrow">+ россыпью, пар</div><input class="search" type="number" min="0" value="${r.loose}" oninput="gk.recv.loose=Math.max(0,parseInt(this.value)||0);gkRecvPrev()"></div>
  </div>
  <div style="margin:8px 0;font-size:12px;color:var(--ink-soft)">Часть пачек по 10 пар? Принимайте отдельной строкой: сначала пачки по 12, затем по 10 (поменяйте «пар в пачке»).</div>
  <div style="margin:10px 0;display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:13px">
    <span>Начислить приёмку (ставка ${rate} ₽):</span>
    <label><input type="radio" name="gkBill" ${r.bill==='packs'?'checked':''} onchange="gk.recv.bill='packs'"> за пачки</label>
    <label><input type="radio" name="gkBill" ${r.bill==='pairs'?'checked':''} onchange="gk.recv.bill='pairs'"> за пары</label>
    <label><input type="radio" name="gkBill" ${r.bill==='none'?'checked':''} onchange="gk.recv.bill='none'"> не начислять</label>
  </div>
  <div class="mono" id="gkRecvPrev" style="font-size:14px;margin-bottom:10px">${gkRecvPrevText(base,pairs)}</div>
  <button class="btn btn-accent" onclick="gkRecvApply()">Принять</button>`;
}
function gkRecvPrevText(base,pairs){ return `+${pairs} пар → на складе будет ${(base?base.qty:0)+pairs} пар`; }
function gkRecvPrev(){ const r=gk.recv, base=gkItemByKey(r.base); const el=document.getElementById('gkRecvPrev'); if(el) el.textContent = gkRecvPrevText(base, r.packs*r.packSize+r.loose); }
async function gkRecvApply(){
  const r = gk.recv, base = gkItemByKey(r.base);
  const pairs = r.packs*r.packSize + r.loose;
  if(!base || pairs<=0){ toast('Укажите количество'); return; }
  const note = r.packs ? `${r.packs}×${r.packSize} пар${r.loose?` + ${r.loose}`:''}` : `${r.loose} пар россыпью`;
  sb.from('receiving_log').insert({sku:base.sku, name:base.name, qty:pairs, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
  receivingLog.push({sku:base.sku, name:base.name, qty:pairs, time:new Date().toTimeString().slice(0,5)});
  logMovement(base.sku, base.name, pairs, 'Приёмка пачками: '+note, base.client, base.size, 'MAIN');
  const cl = clients.find(c=>c.name===base.client);
  const units = r.bill==='packs' ? r.packs + (r.loose?1:0) : (r.bill==='pairs' ? pairs : 0);
  if(cl && cl.receivingPricePerUnit>0 && units>0){
    const amount = units*cl.receivingPricePerUnit;
    const id = 'RECV-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
    const description = `Приёмка: ${base.name} — ${note} (${units} ${r.bill==='packs'?'пач.':'пар'})`;
    const dateStr = new Date().toISOString().slice(0,10);
    ddsEntries.unshift({id, type:'income', category:'Приёмка', amount, description, clientId:cl.id, clientName:cl.name, date:dateStr, warehouseId:'MAIN', createdAt:new Date().toISOString()});
    sb.from('dds_entries').insert({id, type:'income', category:'Приёмка', amount, description, client_id:cl.id, client_name:cl.name, date:dateStr, warehouse_id:'MAIN', employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
  }
  toast(`Принято: ${note} = ${pairs} пар`);
  r.packs = 1; r.loose = 0;
  renderInventory(); gkRender();
}

// ---------- 4. ПЕРЕУПАКОВКА ----------
function gkRepHtml(){
  const bases = gkBaseItems(gk.client);
  if(!bases.length) return '<div class="empty" style="padding:24px">Нет базовых артикулов в парах — сначала объедините артикулы или создайте наборы.</div>';
  const kits = bases.flatMap(b=>gkKitsOf(b).map(x=>({base:b, kit:x.item, n:x.k.qtyNeeded}))).sort((a,b)=>a.kit.sku.localeCompare(b.kit.sku,'ru'));
  if(!kits.length) return '<div class="empty" style="padding:24px">Нет наборов-артикулов.</div>';
  return `<div style="font-size:13px;margin-bottom:10px">Фиксирует ручную фасовку пар в пакеты: сколько пакетов каждого набора сделали. Остаток в парах <b>не меняется</b> (пары списываются при заказе), а услуга «Переупаковка» уходит в «Задания на упаковку» как выполненная — для счёта клиенту.</div>
  <div style="max-height:46vh;overflow:auto">${kits.map(({kit,n,base})=>`<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px dashed var(--line);font-size:13px">
    <span class="mono" style="min-width:170px">${escapeHtml(kit.sku)}</span><span style="flex:1;color:var(--ink-faint);font-size:12px">${n} пар · база ${escapeHtml(base.sku)}: ${base.qty} пар</span>
    <input class="search" type="number" min="0" placeholder="пакетов" style="width:90px" value="${gk.rep.rows[itemKey(kit)]||''}" oninput="gk.rep.rows[${JSON.stringify(itemKey(kit)).replace(/"/g,'&quot;')}]=Math.max(0,parseInt(this.value)||0)">
  </div>`).join('')}</div>
  <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn btn-accent" onclick="gkRepApply()">Записать переупаковку</button><span id="gkRepInfo" style="font-size:12px;color:var(--ink-faint)"></span></div>`;
}
async function gkNextPackId(){
  const { data } = await sb.from('pack_tasks').select('id').like('id','ЗУ-%').limit(2000);
  let max = 0; (data||[]).forEach(r=>{ const m = /(\d+)$/.exec(r.id); if(m) max = Math.max(max, parseInt(m[1])); });
  return 'ЗУ-' + String(max+1).padStart(4,'0');
}
async function gkRepApply(){
  const cl = clients.find(c=>c.name===gk.client);
  if(!cl){ toast('Клиент не найден'); return; }
  const rows = Object.entries(gk.rep.rows).filter(([,v])=>v>0).map(([k,v])=>({it:gkItemByKey(k), qty:v})).filter(x=>x.it);
  if(!rows.length){ toast('Укажите, сколько пакетов сделано'); return; }
  const [sv, pr] = await Promise.all([ sb.from('pack_services').select('*').eq('id','PS36').single(), sb.from('pack_client_prices').select('*').eq('client_id',cl.id).eq('service_id','PS36') ]);
  if(sv.error || !sv.data){ toast('Не нашёл услугу «Переупаковка» в тарифах'); return; }
  const price = pr.data && pr.data[0] ? Number(pr.data[0].price) : Number(sv.data.base_price||0);
  const total = rows.reduce((s,r)=>s+r.qty,0);
  if(!await customConfirm(`Записать переупаковку: ${total} пакетов (${rows.length} артикулов)?\nТариф: ${price} ₽ за пакет → ${price*total} ₽.${price===0?'\nТариф 0 ₽ — задайте цену в «Упаковка → Услуги и тарифы».':''}`, {danger:false, okText:'Записать'})) return;
  const items = rows.map(r=>({sku:r.it.sku, name:r.it.name, size:r.it.size||'', qty:r.qty, comment:'', services:[{serviceId:'PS36', name:sv.data.name, unit:'пакет', price, qty:r.qty, done:true, doneQty:r.qty}]}));
  const now = new Date().toISOString();
  let ok = false, id = '';
  for(let a=0;a<4 && !ok;a++){
    id = await gkNextPackId();
    const { error } = await sb.from('pack_tasks').insert({id, client_id:cl.id, client_name:cl.name, status:'done', comment:'Переупаковка пар в пакеты (записано сотрудником)', items, source:'staff', created_at:now, updated_at:now, started_at:now, done_at:now});
    if(!error) ok = true; else if(!/duplicate|23505/i.test(error.message||'')){ console.error(error); toast('Не удалось записать задание'); return; }
  }
  if(!ok){ toast('Не удалось получить номер задания, повторите'); return; }
  rows.forEach(r=>{
    sb.from('movement_log').insert({sku:r.it.sku, name:r.it.name, delta:0, type:`Переупаковка: ${r.qty} пакетов`, client_name:r.it.client||null, size:r.it.size||null, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
  });
  toast(`Переупаковка записана (${id}): ${total} пакетов, ${price*total} ₽`);
  gk.rep = {rows:{}};
  if(typeof packLoadStaff==='function' && document.getElementById('packBody')) packLoadStaff(true);
  gkRender();
}
