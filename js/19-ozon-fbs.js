// ---------- OZON FBS: вкладки, режим сборки со сканером, КИЗ, печать этикеток и листа подбора, акт отгрузки ----------
// Логика та же, что в «Заказы FBS» (WB). Отличия Ozon: КИЗ передаётся ДО подтверждения сборки (поэтому сборка одного отправления =
// КИЗ → «собрать» → остаток списан), вместо поставки — «перевозка» с актом приёма-передачи. Этот файл переопределяет
// loadOzonOrders / renderOzonBody / setOzonView / shipOzonOrder / shipAllOzonOrders из 05-fbs.js (подключается после него).

const OZ_TABS = [
  {key:'new',     label:'Новые',       badge:true},
  {key:'ship',    label:'На отгрузке', badge:true},
  {key:'transit', label:'В доставке',  badge:false},
  {key:'done',    label:'Завершённые', badge:false},
  {key:'cancel',  label:'Отменённые',  badge:true},
  {key:'archive', label:'Архив',       badge:false}
];
const OZ_ARCHIVE_DAYS = 90;
const OZ_STATUS_RU = {
  awaiting_registration:'Ожидает регистрации', acceptance_in_progress:'Идёт приёмка', awaiting_approve:'Ожидает подтверждения',
  awaiting_packaging:'Ожидает сборки', awaiting_deliver:'Ожидает отгрузки', delivering:'В доставке', driver_pickup:'У водителя',
  last_mile:'Курьер в пути', delivered:'Доставлено', cancelled:'Отменено', arbitration:'Арбитраж', client_arbitration:'Арбитраж (клиент)',
  not_accepted:'Не принято', sent_by_seller:'Отправлено продавцом'
};
let ozMode = 'list';              // list | scan | wiz
let ozSel = new Set();            // выбранные отправления (галочки)
let ozScanMsg = '', ozScanErr = false;
let ozDoneIds = new Set();        // собрано в этом сеансе сканирования
let ozWiz = null;                 // {pn, bcOk, codes:[], busy}
const ozInFlight = new Set();
const ozNormView = v => (OZ_TABS.some(t=>t.key===v) ? v : (v==='active' ? 'transit' : (v==='done' ? 'done' : 'new')));

async function loadOzonOrders(){
  let allRows = [];
  const pageSize = 1000;
  for(let from = 0; from < 15000; from += pageSize){
    const { data, error } = await sb.from('ozon_orders').select('*').order('created_at',{ascending:false}).range(from, from+pageSize-1);
    if(error){ console.error(error); break; }
    allRows = allRows.concat(data);
    if(!data || data.length < pageSize) break;
  }
  ozonOrders = allRows.map(o=>({
    postingNumber:o.posting_number, clientId:o.client_id, clientName:o.client_name, sku:o.sku, productId:o.product_id,
    article:o.article||'', barcode:o.barcode||'', name:o.name||'', size:o.size||'', price:o.price, qty:o.qty||1,
    status:o.status||'', requiresKiz:o.requires_kiz||false, kizCode:o.kiz_code||'', kizStatus:o.kiz_status||null,
    warehouseId:o.warehouse_id||'MAIN', ozonWarehouseId:o.ozon_warehouse_id, shipmentDate:o.shipment_date||null,
    outOfStock:o.out_of_stock||false, orderCreatedAt:o.order_created_at||null, pickedAt:o.picked_at||null, pickedBy:o.picked_by||null
  }));
}

// ---------- вспомогательное ----------
function ozAgeDays(o){ const t = o.orderCreatedAt ? new Date(o.orderCreatedAt).getTime() : NaN; return isNaN(t) ? null : (Date.now()-t)/86400000; }
function ozTabOf(o){
  const s = o.status;
  if(s==='cancelled' || s==='not_accepted') return 'cancel';
  if(s==='awaiting_packaging') return 'new';
  if(s==='awaiting_deliver' || s==='awaiting_registration' || s==='acceptance_in_progress' || s==='awaiting_approve') return 'ship';
  if(s==='delivered'){ const a = ozAgeDays(o); return (a!==null && a>OZ_ARCHIVE_DAYS) ? 'archive' : 'done'; }
  return 'transit';
}
function ozPI(order){
  const inv = ozonItemForOrder(order);
  return {
    inv,
    name: (inv && inv.name) || order.name || order.article || '',
    color: (inv && inv.color) || '',
    size: order.size || (inv && inv.size) || '',
    cell: (inv && inv.cell) || null,
    barcode: (inv && inv.barcode) || ''
  };
}
function ozNeedsKiz(order){ const inv = ozonItemForOrder(order); return !!(order.requiresKiz || (inv && inv.requiresKiz)); }
function ozClientFilter(){ const s = document.getElementById('ozonClientSelect'); return s ? s.value : ''; }
function ozRows(tab){
  const cid = ozClientFilter();
  return ozonOrders.filter(o=>(!cid || o.clientId===cid) && ozTabOf(o)===tab);
}
function ozDbUpdate(pn, fields){
  sb.from('ozon_orders').update(fields).eq('posting_number', pn).then(({error})=>{ if(error) console.error(error); });
}

// ---------- интерфейс: вкладки ----------
function ozInitUi(){
  const oldRow = document.getElementById('ozonTabNew');
  if(oldRow && oldRow.parentElement) oldRow.parentElement.style.display = 'none';
  if(!document.getElementById('ozTabsStyle')){
    const st = document.createElement('style'); st.id = 'ozTabsStyle';
    st.textContent = `
      #ozTabsBar{display:inline-flex;gap:2px;padding:5px;background:#ECEAE4;border-radius:14px;max-width:100%;overflow-x:auto;margin-bottom:14px}
      #ozTabsBar .oz-tab{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;border-radius:10px;padding:9px 14px;font-size:14px;font-weight:600;color:var(--ink-soft);cursor:pointer;white-space:nowrap}
      #ozTabsBar .oz-tab.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
      #ozTabsBar .oz-badge{font-size:11px;font-weight:700;line-height:1;padding:3px 7px;border-radius:6px;background:#DDDAD2;color:var(--ink-soft)}
      #ozTabsBar .oz-tab.active .oz-badge{background:#DCE6FF;color:#1D4ED8}`;
    document.head.appendChild(st);
  }
}
function setOzonView(view){
  ozonView = ozNormView(view);
  ozonDonePage = 1;
  ozSel = new Set();
  if(ozMode!=='list'){ ozMode = 'list'; ozWiz = null; }
  renderOzonBody();
}
function ozTabsHtml(){
  const cid = ozClientFilter();
  const counts = {};
  ozonOrders.forEach(o=>{ if(cid && o.clientId!==cid) return; const t = ozTabOf(o); counts[t] = (counts[t]||0)+1; });
  return `<div id="ozTabsBar" role="tablist">${OZ_TABS.map(t=>`<button type="button" class="oz-tab ${ozonView===t.key?'active':''}" onclick="setOzonView('${t.key}')"><span>${t.label}</span>${t.badge?`<span class="oz-badge">${counts[t.key]||0}</span>`:''}</button>`).join('')}</div>`;
}

// ---------- список ----------
function renderOzonBody(){
  ozInitUi();
  ozonView = ozNormView(ozonView);
  const wrap = document.getElementById('ozonBody');
  if(!wrap) return;
  if(!clients.some(c=>c.ozonConnected)){
    wrap.innerHTML = `<div class="panel empty">Ни у одного клиента не подключён Ozon — добавьте Client-Id и API-ключ во вкладке «Клиенты»</div>`;
    return;
  }
  if(ozMode==='scan') return ozRenderScan();
  if(ozMode==='wiz' && ozWiz) return ozRenderWizard();

  let rows = ozRows(ozonView).slice().sort((a,b)=> ['new','ship'].includes(ozonView)
    ? new Date(a.orderCreatedAt||0) - new Date(b.orderCreatedAt||0)
    : new Date(b.orderCreatedAt||0) - new Date(a.orderCreatedAt||0));
  const total = rows.length;
  const paged = ['transit','done','cancel','archive'].includes(ozonView);
  let pager = '';
  if(paged){
    const pages = Math.max(1, Math.ceil(total/ozonDonePageSize));
    if(ozonDonePage>pages) ozonDonePage = pages;
    if(ozonDonePage<1) ozonDonePage = 1;
    const from = (ozonDonePage-1)*ozonDonePageSize, to = Math.min(from+ozonDonePageSize, total);
    rows = rows.slice(from, to);
    pager = `<div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;margin-top:10px;flex-wrap:wrap">
      <span style="font-size:13px;color:var(--ink-soft)">Показано ${total?from+1:0}–${to} из ${total}</span>
      <div style="display:flex;align-items:center;gap:8px"><button class="btn btn-ghost" style="padding:5px 12px" onclick="goOzonDonePage(-1)" ${ozonDonePage<=1?'disabled':''}>← Назад</button>
      <span style="font-size:13px;color:var(--ink-soft)">Стр. ${ozonDonePage} из ${pages}</span>
      <button class="btn btn-ghost" style="padding:5px 12px" onclick="goOzonDonePage(1)" ${ozonDonePage>=pages?'disabled':''}>Вперёд →</button></div></div>`;
  }
  const sizeSel = document.getElementById('ozonDonePageSize');
  if(sizeSel){ sizeSel.style.display = 'none'; }

  const selCnt = rows.filter(o=>ozSel.has(o.postingNumber)).length;
  let toolbar = '';
  if(ozonView==='new'){
    toolbar = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <button class="btn btn-accent" onclick="ozEnterScan('new')" ${total?'':'disabled'} title="Сканер: товар (и КИЗ) → подтверждение сборки в Ozon → этикетка">🎯 Режим сборки (сканер)</button>
      <button class="btn btn-primary" onclick="shipAllOzonOrders()" ${total?'':'disabled'}>${ozSel.size?`Собрать выбранные (${ozSel.size})`:`Собрать все (${total})`}</button>
      <button class="btn btn-ghost" onclick="ozPrintLabelsThermal()" ${total?'':'disabled'}>🖨️ ${ozSel.size?`На принтер — выбранные (${ozSel.size})`:'На принтер (QZ Tray)'}</button>
      <button class="btn btn-ghost" onclick="ozPrintLabels()" ${total?'':'disabled'}>📄 Этикетки PDF${ozSel.size?` (${ozSel.size})`:''}</button>
      <button class="btn btn-ghost" onclick="ozPrintPickList()" ${total?'':'disabled'}>📋 Лист подбора</button>
      <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="forgetQzPrinter()" title="Выбрать другой принтер при следующей печати">⚙️ Сменить принтер</button>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;color:var(--ink-soft);cursor:pointer;margin-left:auto"><input type="checkbox" onchange="ozToggleAll(this.checked)" ${total && selCnt===rows.length?'checked':''}> Выбрать все</label>
    </div>`;
  } else if(ozonView==='ship'){
    toolbar = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
      <button class="btn btn-accent" onclick="ozEnterScan('ship')" ${rows.some(o=>!o.pickedAt)?'':'disabled'} title="Сканер: товар → отметка «собран» + этикетка на принтер">🎯 Режим сборки (сканер)</button>
      <button class="btn btn-primary" onclick="ozCloseShipment()" ${total?'':'disabled'}>📦 Закрыть отгрузку (акт)</button>
      <button class="btn btn-ghost" onclick="ozPrintLabelsThermal()" ${total?'':'disabled'}>🖨️ ${ozSel.size?`На принтер — выбранные (${ozSel.size})`:'На принтер (QZ Tray)'}</button>
      <button class="btn btn-ghost" onclick="ozPrintLabels()" ${total?'':'disabled'}>📄 Этикетки PDF${ozSel.size?` (${ozSel.size})`:''}</button>
      <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="forgetQzPrinter()" title="Выбрать другой принтер при следующей печати">⚙️ Сменить принтер</button>
      <label style="display:flex;gap:6px;align-items:center;font-size:13px;color:var(--ink-soft);cursor:pointer;margin-left:auto"><input type="checkbox" onchange="ozToggleAll(this.checked)" ${total && selCnt===rows.length?'checked':''}> Выбрать все</label>
    </div>`;
  }

  const rowHtml = o=>{
    const pi = ozPI(o);
    const tab = ozTabOf(o);
    const linked = !!pi.inv;
    const kiz = ozNeedsKiz(o);
    const chips = [
      `<span class="chip oz">${escapeHtml(OZ_STATUS_RU[o.status]||o.status)}</span>`,
      !linked && tab==='new' ? `<span class="chip" style="background:#FFF1E0;color:#B45309" title="Артикул Ozon не сопоставлен с товаром в остатках — карточка клиента → Ozon → «Загрузить карточки Ozon и сопоставить»">не сопоставлен</span>` : '',
      kiz && (tab==='new' || (tab==='ship' && !o.kizCode)) ? `<span class="chip" style="background:#FDE8E8;color:#B91C1C">нужен КИЗ</span>` : '',
      (o.qty||1)>1 && tab==='new' ? `<span class="chip" style="background:#E0ECFF;color:#1D4ED8" title="При сборке отправление автоматически делится на отправления по 1 шт">${o.qty} шт → разделится</span>` : '',
      o.outOfStock ? `<span class="chip" style="background:#FDE8E8;color:#B91C1C">нет на складе</span>` : '',
      (ozDoneIds.has(o.postingNumber) || (tab==='ship' && o.pickedAt)) ? '<span class="chip" style="background:#DCFCE7;color:#166534">✓ собран</span>' : (tab==='ship' ? '<span class="chip" style="background:#FFF1E0;color:#B45309">нужно собрать</span>' : '')
    ].join(' ');
    return `<div class="panel" style="padding:12px 16px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="display:flex;gap:10px;align-items:center;min-width:260px;flex:1">
        ${['new','ship'].includes(ozonView)?`<input type="checkbox" ${ozSel.has(o.postingNumber)?'checked':''} onchange="ozToggleSel('${o.postingNumber}',this.checked)">`:''}
        ${pi.cell?`<div style="background:var(--accent);color:#fff;border-radius:8px;padding:4px 10px;font-weight:800;font-size:15px;min-width:38px;text-align:center" title="Ячейка">${escapeHtml(String(pi.cell))}</div>`:''}
        <div>
          <div class="sku-name">${escapeHtml(pi.name)}${pi.color?` · ${escapeHtml(pi.color)}`:''}${pi.size?` · ${escapeHtml(pi.size)}`:''}</div>
          <div class="sku-code mono">${escapeHtml(o.article)} · № ${escapeHtml(o.postingNumber)} · ${o.qty} шт${!ozClientFilter()?` · ${escapeHtml(o.clientName)}`:''}${o.shipmentDate?` · отгрузка до ${new Date(o.shipmentDate).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${chips}
        ${tab==='new' ? `<button class="btn btn-accent" onclick="shipOzonOrder('${o.postingNumber}')">Собрать</button>` : ''}
        ${['new','ship'].includes(tab) ? `<button class="btn btn-ghost" onclick="ozPrintOne('${o.postingNumber}')" title="Этикетка отправления — на термопринтер (QZ Tray)">🏷 Этикетка</button>` : ''}
        ${['new','ship','transit'].includes(tab) ? `<button class="btn btn-ghost" style="color:var(--warn)" onclick="cancelOzonOrder('${o.postingNumber}')">Отменить</button>` : ''}
      </div>
    </div>`;
  };
  wrap.innerHTML = ozTabsHtml() + toolbar + (rows.length ? rows.map(rowHtml).join('') : `<div class="panel empty">Здесь пока пусто</div>`) + pager;
}
function ozToggleSel(pn, on){ if(on) ozSel.add(pn); else ozSel.delete(pn); renderOzonBody(); }
function ozToggleAll(on){
  const rows = ozRows(ozonView);
  if(on) rows.forEach(o=>ozSel.add(o.postingNumber)); else rows.forEach(o=>ozSel.delete(o.postingNumber));
  renderOzonBody();
}
function ozTargets(tab){
  const rows = ozRows(tab);
  return ozSel.size ? rows.filter(o=>ozSel.has(o.postingNumber)) : rows;
}

// ---------- сборка одного отправления: остаток + начисление + Ozon (КИЗ → ship) ----------
function ozUndoDeduction(inv, order, qty, ddsId){
  try{
    if(inv.isKit && inv.kitMode==='virtual'){
      getKitComponents(inv).forEach(c=>{
        const ci = findInventoryItem(c.componentSku, inv.client, c.componentSize, inv.warehouseId);
        if(!ci) return;
        const back = c.qtyNeeded*qty;
        ci.qty += back;
        logMovement(ci.sku, ci.name, back, `Возврат: отправление Ozon ${order.postingNumber} не принято (составляющая набора «${inv.name}»)`, ci.client, ci.size, ci.warehouseId||'MAIN');
      });
    } else {
      inv.qty += qty;
      logMovement(inv.sku, inv.name, qty, `Возврат: отправление Ozon ${order.postingNumber} не принято`, inv.client, inv.size, inv.warehouseId||'MAIN');
    }
    if(ddsId){
      const i = ddsEntries.findIndex(d=>d.id===ddsId); if(i>=0) ddsEntries.splice(i,1);
      sb.from('dds_entries').delete().eq('id', ddsId).then(({error})=>{ if(error) console.error(error); });
    }
  }catch(e){ console.error(e); }
}
// списание остатка и начисление за отгрузку (как у WB); возвращает id записи ДДС или null
function ozDeductAndBill(order, inv, needQty){
  const pn = order.postingNumber;
  deductStockForShipment(inv, needQty, `Сборка отправления Ozon ${pn}`);
  let ddsId = null;
  if(inv.dims && inv.dims.l && inv.dims.w && inv.dims.h){
    const liters = (inv.dims.l*inv.dims.w*inv.dims.h)/1000;
    const price = getFbsTariffPrice(order.clientId, liters);
    if(price !== null){
      ddsId = 'OZON-SHIP-' + pn;
      if(!ddsEntries.find(d=>d.id===ddsId)){
        const description = `Отгрузка Ozon ${pn} · ${liters.toFixed(2)} л`;
        const date = new Date().toISOString().slice(0,10);
        ddsEntries.unshift({id:ddsId, type:'income', category:'Отгрузка FBS', amount:price, description, clientId:order.clientId, clientName:order.clientName, date, warehouseId:inv.warehouseId||'MAIN', createdAt:new Date().toISOString()});
        sb.from('dds_entries').insert({id:ddsId, type:'income', category:'Отгрузка FBS', amount:price, description, client_id:order.clientId, client_name:order.clientName, date, warehouse_id:inv.warehouseId||'MAIN', employee_id:currentUser?currentUser.id:null, employee_name:currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
      } else ddsId = null;
    }
  }
  return ddsId;
}
// списывался ли уже остаток по этому отправлению (по журналу движений в базе)
async function ozAlreadyDeducted(pn){
  const { data, error } = await sb.from('movement_log').select('delta').like('type', '%Ozon ' + pn + '%');
  if(error){ console.error(error); return null; }
  return (data||[]).reduce((a,m)=>a+(Number(m.delta)||0), 0) < 0;
}
async function ozAssembleOne(order, kizCodes, opts){
  const pn = order.postingNumber;
  if(ozInFlight.has(pn)) return {ok:false, message:'уже отправляется — подождите'};
  if(order.status!=='awaiting_packaging') return {ok:false, message:'не в статусе «ожидает сборки»'};
  const inv = ozonItemForOrder(order);
  const needQty = order.qty || 1;
  if(!inv) return {ok:false, message:`«${order.name||order.article}» (${order.article}) не сопоставлен с товаром в остатках`};
  const available = inv.isKit && inv.kitMode!=='assembled' ? computeKitAvailability(inv).available : inv.qty;
  if(available < needQty) return {ok:false, message:`Недостаточно на складе «${inv.name}» — нужно ${needQty} шт, есть ${available}`};
  const codes = (kizCodes||[]).filter(Boolean);
  ozInFlight.add(pn);
  const ddsId = ozDeductAndBill(order, inv, needQty);
  try{
    const { data, error } = await sb.functions.invoke('ozon-fbs-ts', { body:{ clientId:order.clientId, action:'ship', postingNumber:pn, kizCodes:codes } });
    if(error || (data && data.error)){
      const msg = (data && data.error) || await extractEdgeFunctionError(data, error);
      ozUndoDeduction(inv, order, needQty, ddsId);
      return {ok:false, message:'Ozon: ' + msg + '. Остаток возвращён'};
    }
    order.status = 'awaiting_deliver';
    if(codes.length){ order.kizCode = codes.join('\n'); order.kizStatus = 'ok'; }
    // «собран» (picked_at) отмечается только при физической сборке сканером, как у WB; кнопки «Собрать» его не ставят
    const upd = {status:'awaiting_deliver'};
    if(opts && opts.picked){ order.pickedAt = new Date().toISOString(); upd.picked_at = order.pickedAt; upd.picked_by = currentUser?currentUser.name:null; }
    const cur = ozonOrders.find(o=>o.postingNumber===pn);
    if(cur && cur!==order){ cur.status = order.status; cur.pickedAt = order.pickedAt; if(codes.length) cur.kizCode = order.kizCode; }
    ozDbUpdate(pn, upd);
    ozDoneIds.add(pn);
    return {ok:true, warning:data && data.warning};
  }catch(e){
    ozUndoDeduction(inv, order, needQty, ddsId);
    return {ok:false, message:'Сбой связи: ' + (e.message||e) + '. Остаток возвращён'};
  }finally{
    ozInFlight.delete(pn);
  }
}
// Ozon: в одном отправлении может быть 2 шт и больше. Как на WB (1 заказ = 1 шт), делим такое отправление у Ozon на
// отдельные отправления по 1 шт и собираем каждое (КИЗ — по одному на отправление). Если после деления что-то не собралось,
// оставшиеся отправления по 1 шт лежат в «Новых».
async function ozAssemble(order, kizCodes, opts){
  const qty = order.qty || 1;
  if(qty <= 1 || order.status!=='awaiting_packaging') return ozAssembleOne(order, kizCodes, opts);
  const inv = ozonItemForOrder(order);
  if(!inv) return {ok:false, message:`«${order.name||order.article}» (${order.article}) не сопоставлен с товаром в остатках`};
  const available = inv.isKit && inv.kitMode!=='assembled' ? computeKitAvailability(inv).available : inv.qty;
  if(available < qty) return {ok:false, message:`Недостаточно на складе «${inv.name}» — нужно ${qty} шт, есть ${available} (отправление не делилось)`};
  if(ozInFlight.has(order.postingNumber)) return {ok:false, message:'уже обрабатывается — подождите'};
  ozInFlight.add(order.postingNumber);
  let sp;
  try{
    toast(`Отправление ${order.postingNumber} на ${qty} шт — делю на отдельные по 1 шт…`);
    sp = await sb.functions.invoke('ozon-fbs-ts', { body:{ clientId:order.clientId, action:'split', postingNumber:order.postingNumber } });
  }catch(e){ ozInFlight.delete(order.postingNumber); return {ok:false, message:'Сбой связи при делении: ' + (e.message||e)}; }
  ozInFlight.delete(order.postingNumber);
  if(sp.error || (sp.data && sp.data.error)) return {ok:false, message:'Ozon (деление): ' + ((sp.data && sp.data.error) || await extractEdgeFunctionError(sp.data, sp.error))};
  if(!sp.data.split) return ozAssembleOne(order, kizCodes, opts);
  await loadOzonOrders();
  const kids = (sp.data.children||[]).map(pn=>ozonOrders.find(o=>o.postingNumber===pn)).filter(Boolean);
  if(!kids.length) return {ok:false, message:'Ozon разделил отправление, но новые отправления ещё не подтянулись — нажмите «Проверить новые»'};
  const codes = (kizCodes||[]).filter(Boolean);
  let done = 0, warning;
  for(let i=0;i<kids.length;i++){
    const r = await ozAssembleOne(kids[i], codes[i] ? [codes[i]] : [], opts);
    if(!r.ok) return {ok:false, message:`разделено на ${kids.length} шт, собрано ${done}; ${kids[i].postingNumber}: ${r.message}. Остальные ждут в «Новых»`};
    done++; if(r.warning) warning = r.warning;
    if(i<kids.length-1) await new Promise(res=>setTimeout(res,300));
  }
  toast(`Разделено и собрано: ${done} шт`);
  return {ok:true, warning};
}
async function shipOzonOrder(postingNumber){
  const order = ozonOrders.find(o=>o.postingNumber===postingNumber);
  if(!order) return;
  if(ozNeedsKiz(order)){ toast('Для этого товара нужен КИЗ — открываю сборку со сканером'); ozOpenWizard(order, false); return; }
  toast('Подтверждаю сборку…');
  const r = await ozAssemble(order, []);
  if(!r.ok){ toast(r.message); return; }
  toast(r.warning ? 'Собрано, но есть предупреждение: ' + r.warning : 'Отправление собрано и подтверждено');
  renderOzonBody();
}
async function shipAllOzonOrders(){
  if(ozonShipAllBusy) return;
  const list = ozTargets('new');
  if(!list.length){ toast('Нет отправлений, ожидающих сборки'); return; }
  const withKiz = list.filter(ozNeedsKiz);
  const plain = list.filter(o=>!ozNeedsKiz(o));
  if(!plain.length){ toast('Все выбранные отправления требуют КИЗ — соберите их в режиме сборки со сканером'); return; }
  if(!await customConfirm(`Собрать и отгрузить ${plain.length} отправл.?\nОстатки будут списаны, сборка подтверждена в Ozon.${withKiz.length?`\n\nС КИЗ (${withKiz.length} шт) пропускаются — их собирайте в режиме сборки.`:''}\nОтправления без остатка или без сопоставления товара пропускаются.`, {danger:false, okText:'Собрать'})) return;
  ozonShipAllBusy = true;
  let ok = 0; const fails = [];
  for(let i=0;i<plain.length;i++){
    toast(`Собираю ${i+1} из ${plain.length}…`);
    const r = await ozAssemble(plain[i], []);
    if(r.ok) ok++; else fails.push(`${plain[i].postingNumber}: ${r.message}`);
    if(i<plain.length-1) await new Promise(res=>setTimeout(res,400));
  }
  ozonShipAllBusy = false;
  ozSel = new Set();
  try{ await loadOzonOrders(); }catch(e){ console.error(e); }
  renderOzonBody();
  if(fails.length) await customConfirm(`Собрано: ${ok} из ${plain.length}.\n\nНе собрано (${fails.length}):\n` + fails.slice(0,8).join('\n') + (fails.length>8?`\n…и ещё ${fails.length-8}`:''), {danger:false, okText:'Понятно', cancelText:'Закрыть'});
  else toast(`Собрано и подтверждено: ${ok}`);
}

// ---------- режим сборки со сканером ----------
let ozScanTab = 'new';            // new — режим сборки на «Ожидают сборки» (подтверждение у Ozon + КИЗ); ship — на «Ожидают отгрузки» (физическая сборка + этикетка)
function ozScanPool(){
  return ozScanTab==='ship' ? ozRows('ship').filter(o=>!o.pickedAt) : ozRows('new');
}
function ozEnterScan(tab){ ozScanTab = tab==='new' ? 'new' : 'ship'; ozMode = 'scan'; ozDoneIds = new Set(); ozWiz = null; ozScanMsg = ''; ozScanErr = false; renderOzonBody(); }
function ozExitScan(){ ozMode = 'list'; ozWiz = null; renderOzonBody(); }
function ozProgress(){
  const pool = ozScanPool(); const done = ozDoneIds.size;
  return {left: pool.length, done};
}
function ozRenderScan(msg, isErr){
  if(msg !== undefined){ ozScanMsg = msg; ozScanErr = !!isErr; }
  const wrap = document.getElementById('ozonBody');
  const p = ozProgress();
  wrap.innerHTML = `<div class="panel" style="padding:30px;text-align:center;max-width:560px;margin:0 auto">
    <div class="eyebrow" style="margin-bottom:10px">Режим сборки Ozon · ${ozScanTab==='ship'?'ожидают отгрузки':'ожидают сборки'} · поиск отправления</div>
    <div style="font-size:14px;margin-bottom:6px"><b>Собрано: ${p.done}</b> · осталось: ${p.left}</div>
    <p style="font-size:13px;color:var(--ink-soft);margin-bottom:18px">Отсканируйте этикетку отправления Ozon (номер вида 0123456789-0123-1) или штрихкод товара — откроется карточка сборки.</p>
    <input class="search mono" id="ozScanInput" placeholder="Ждём скан…" style="width:100%;text-align:center;font-size:16px;padding:14px" autocomplete="off" onkeydown="if(event.key==='Enter') ozHandleScan(this)">
    ${ozScanMsg ? `<p style="font-size:13px;margin-top:14px;font-weight:600;color:${ozScanErr?'var(--warn)':'var(--ok)'}">${escapeHtml(ozScanMsg)}</p>` : ''}
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:18px"><button class="btn btn-ghost" onclick="ozExitScan()">Выйти из режима сборки</button></div>
  </div>`;
  setTimeout(()=>{ const el = document.getElementById('ozScanInput'); if(el){ forceEnglishInput(el); el.focus(); } }, 50);
}
function ozPostingKey(s){ return String(s||'').replace(/[^0-9A-Za-z-]/g,''); }
// что отсканировано → какое отправление; via='barcode' если нашли по штрихкоду товара (ШК уже подтверждён)
function ozFindForScan(raw, pool){
  const key = ozPostingKey(raw);
  if(key.length >= 8){
    const o = pool.find(x=>x.postingNumber===key) || pool.find(x=>key.includes(x.postingNumber));
    if(o){ if(ozScanTab==='ship' && o.pickedAt) return {done:true, order:o}; return {order:o, via:'label'}; }
  }
  const left = pool.filter(o=>!ozDoneIds.has(o.postingNumber) && !(ozScanTab==='ship' && o.pickedAt));
  const inv = findInventoryItemByBarcode(raw, ozClientFilter() ? (clients.find(c=>c.id===ozClientFilter())||{}).name : undefined);
  const cands = [];
  if(inv) cands.push(...left.filter(o=>ozonItemForOrder(o)===inv));
  const offer = ozonOffers.find(of=>(of.barcodes||[]).includes(raw));
  if(offer) cands.push(...left.filter(o=>o.clientName===offer.clientName && o.article===offer.offerId));
  if(cands.length) return {order:cands[0], via:'barcode'};
  if((inv||offer)) return {allDone:true};
  return null;
}
function ozHandleScan(inputEl){
  const raw = fromRuLayout(inputEl.value.trim());
  inputEl.value = '';
  if(!raw) return;
  if(raw===NEXT_ORDER_QR_CODE){ ozRenderScan('Код «Следующий заказ» здесь не нужен — отсканируйте этикетку отправления', true); return; }
  const pool = ozScanPool();
  const f = ozFindForScan(raw, ozScanTab==='ship' ? ozRows('ship') : pool);
  if(f && f.done){ playBeep('warn'); ozRenderScan(`${f.order.postingNumber} уже отмечено собранным.`, true); return; }
  if(f && f.allDone){ playBeep('warn'); ozRenderScan('Все отправления с этим товаром уже собраны.', true); return; }
  if(!f){ playBeep('error'); ozRenderScan(`Не нашёл отправление по коду «${raw}» среди ${ozScanTab==='ship'?'«Ожидают отгрузки»':'«Ожидают сборки»'}. Проверьте клиента и что оно ещё не собрано.`, true); return; }
  ozOpenWizard(f.order, f.via==='barcode');
}
function ozOpenWizard(order, bcDone){
  ozMode = 'wiz';
  const shipMode = ozScanTab==='ship' && order.status!=='awaiting_packaging';
  ozWiz = {pn:order.postingNumber, bcOk:false, codes:[], busy:false, shipMode, needKiz: ozNeedsKiz(order) && !(shipMode && order.kizCode)};
  renderOzonBody();
  if(bcDone) setTimeout(()=>ozBarcodeConfirmed(), 0);
}
function ozWizOrder(){ return ozWiz ? ozonOrders.find(o=>o.postingNumber===ozWiz.pn) : null; }
function ozRenderWizard(){
  const order = ozWizOrder();
  const wrap = document.getElementById('ozonBody');
  if(!order){ ozMode = 'list'; ozWiz = null; return renderOzonBody(); }
  const pi = ozPI(order);
  const need = ozWiz.needKiz;
  const kizTotal = order.qty || 1;
  wrap.innerHTML = `<div class="panel" style="padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <div><div class="eyebrow">Отправление ${escapeHtml(order.postingNumber)} · ${escapeHtml(order.clientName)}</div>
        <h2 style="margin:6px 0 0 0">${escapeHtml(pi.name)}${pi.color?` · ${escapeHtml(pi.color)}`:''}${pi.size?` · ${escapeHtml(pi.size)}`:''}</h2></div>
      ${pi.cell?`<div style="background:var(--accent);color:#fff;border-radius:10px;padding:10px 20px;text-align:center;line-height:1.1"><div style="font-size:11px;opacity:.85">ЯЧЕЙКА</div><div style="font-size:26px;font-weight:800">${escapeHtml(String(pi.cell))}</div></div>`:''}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="ozPrintOne('${order.postingNumber}', this)" title="Этикетка отправления Ozon — сразу на термопринтер через QZ Tray">🖨 Этикетка</button><button class="btn btn-ghost" onclick="ozWizBack()">↩ К поиску</button><button class="btn btn-ghost" onclick="ozExitScan()">✕ Завершить режим</button></div>
    </div>
    <table style="margin-bottom:18px">
      <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Артикул Ozon</td><td class="mono">${escapeHtml(order.article)}</td></tr>
      <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Штрихкод товара</td><td class="mono">${escapeHtml(pi.barcode||'—')}</td></tr>
      <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Количество</td><td style="font-weight:700">${order.qty||1} шт</td></tr>
      <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Ячейка</td><td style="font-weight:700">${escapeHtml(String(pi.cell||'не назначена'))}</td></tr>
      ${pi.inv?'':`<tr><td colspan="2" style="color:var(--warn);padding-top:6px">⚠ Товар не сопоставлен с остатками — сборка не пройдёт, пока не сопоставите (карточка клиента → Ozon).</td></tr>`}
    </table>
    <div class="eyebrow" style="margin-bottom:6px">Штрихкод товара — подтверждение</div>
    <input class="search" id="ozBcInput" placeholder="Отсканируйте штрихкод товара…" style="width:100%;max-width:420px;margin-bottom:6px" autocomplete="off" ${ozWiz.bcOk?'disabled':''}>
    <div style="margin-bottom:14px">${ozWiz.bcOk?'<span style="color:var(--ok);font-size:12px">✓ товар подтверждён</span>':`<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="ozBarcodeConfirmed()">Подтвердить без скана</button>`}</div>
    <div id="ozKizBlock">${need ? `
      <div class="eyebrow" style="margin-bottom:6px">КИЗ (Честный Знак) — ${ozWiz.codes.length} из ${kizTotal}</div>
      <input class="search mono" id="ozKizInput" placeholder="Отсканируйте КИЗ ${ozWiz.codes.length+1}-й единицы…" style="width:100%;max-width:420px;margin-bottom:6px" autocomplete="off" ${ozWiz.bcOk?'':'disabled'}>
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:14px">${ozWiz.codes.map((c,i)=>`${i+1}. ${escapeHtml(c.slice(0,18))}…`).join('<br>')}</div>
    ` : `
      <p style="font-size:12px;color:var(--ink-faint);margin-bottom:6px">Для этого товара КИЗ не требуется (не отмечено в «Остатках»).</p>
      <button class="btn btn-ghost" style="margin-bottom:14px" onclick="ozForceKiz()">+ Этому товару нужен КИЗ</button>`}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-accent" id="ozWizShipBtn" onclick="ozWizShip()" ${ozWiz.bcOk && (!need || ozWiz.codes.length>=kizTotal) && !ozWiz.busy?'':'disabled'}>${ozWiz.busy?'⏳ Собираю…':(ozWiz.shipMode?(need?'КИЗ внести и собрать — печать этикетки':'Товар собран — печать этикетки'):'Собрать отправление')}</button>
      <button class="btn btn-ghost" onclick="ozWizBack()">Пропустить</button>
      ${ozWiz.shipMode?'':`<button class="btn btn-ghost" style="color:var(--warn)" onclick="ozOutOfStock()">❌ Нет на складе</button>`}
    </div></div>`;
  const bc = document.getElementById('ozBcInput');
  if(bc){
    forceEnglishInput(bc); if(!ozWiz.bcOk) bc.focus();
    bc.addEventListener('keydown', e=>{
      if(e.key!=='Enter') return;
      const code = fromRuLayout(bc.value.trim()); bc.value = '';
      if(!code) return;
      if(code===NEXT_ORDER_QR_CODE){ ozWizBack(); return; }
      const inv = pi.inv;
      const okBc = !pi.barcode && !(inv) ? true
        : (inv && findInventoryItemByBarcode(code, order.clientName)===inv)
          || ozonOffers.some(of=>of.clientName===order.clientName && of.offerId===order.article && (of.barcodes||[]).includes(code));
      if(!okBc){ playBeep('error'); toast('Штрихкод не совпадает с товаром этого отправления'); return; }
      ozBarcodeConfirmed();
    });
  }
  ozWireKiz(order);
  if(pi.cell && !ozWiz.bcOk && !ozWiz.announced){ ozWiz.announced = true; try{ announceCell(pi.cell); }catch(e){} }
}
function ozBarcodeConfirmed(){
  if(!ozWiz) return;
  playBeep('ok');
  ozWiz.bcOk = true;
  const order = ozWizOrder();
  if(!ozWiz.needKiz){ ozWizShip(); return; }   // КИЗ не нужен: подтверждённый товар сразу собираем (в режиме на «Ожидают отгрузки» — отметка + этикетка)
  ozRenderWizard();
  const k = document.getElementById('ozKizInput'); if(k){ forceEnglishInput(k); k.focus(); }
  toast('Теперь отсканируйте КИЗ' + ((order&&order.qty>1)?'ы (по одному на единицу)':' этой единицы'));
}
function ozWireKiz(order){
  const k = document.getElementById('ozKizInput');
  if(!k || k.dataset.wired) return;
  k.dataset.wired = '1';
  k.addEventListener('keydown', e=>{
    if(e.key!=='Enter') return;
    setTimeout(()=>{
      const norm = normalizeKizInput(k.value); const code = norm.code; k.value = '';
      if(!code) return;
      if(code===NEXT_ORDER_QR_CODE){ ozWizBack(); return; }
      if(code.length < MIN_KIZ_LENGTH){ playBeep('error'); toast(`Код слишком короткий (${code.length} симв.) — отсканируйте ещё раз`); return; }
      const key = kizKey(code);
      if(ozWiz.codes.some(c=>kizKey(c)===key)){ playBeep('error'); toast('Этот КИЗ уже отсканирован для этого отправления'); return; }
      const dup = ozonOrders.find(o=>o.postingNumber!==order.postingNumber && o.kizCode && o.kizCode.split('\n').some(c=>kizKey(c)===key));
      if(dup){ playBeep('error'); toast(`Этот КИЗ уже привязан к отправлению ${dup.postingNumber} — проверьте код`); return; }
      ozWiz.codes.push(code);
      playBeep('ok');
      if(ozWiz.codes.length >= (order.qty||1)) ozWizShip(); else ozRenderWizard();
    }, 0);
  });
}
async function ozForceKiz(){
  const order = ozWizOrder(); if(!order) return;
  ozWiz.needKiz = true; order.requiresKiz = true;
  const inv = ozonItemForOrder(order);
  if(inv && !inv.requiresKiz){ inv.requiresKiz = true; syncInventoryRow(inv.sku, inv.client, inv.size, inv.warehouseId); }
  sb.from('ozon_orders').update({requires_kiz:true}).eq('client_id', order.clientId).eq('article', order.article).in('status',['awaiting_packaging','awaiting_deliver']).then(({error})=>{ if(error) console.error(error); });
  ozonOrders.forEach(o=>{ if(o.clientId===order.clientId && o.article===order.article && ['awaiting_packaging','awaiting_deliver'].includes(o.status)) o.requiresKiz = true; });
  toast('Запомнил: этому товару всегда нужен КИЗ (отключить можно в «Остатках» → Изменить)');
  ozRenderWizard();
}
// физическая сборка отправления, уже подтверждённого у Ozon: отметка «собран» + печать этикетки
async function ozPickDone(order){
  // отправление могли подтвердить прямо в кабинете Ozon — тогда остаток у нас ещё не списан: списываем при физической сборке
  const ded = await ozAlreadyDeducted(order.postingNumber);
  if(ded === false){
    const inv = ozonItemForOrder(order);
    const q = order.qty || 1;
    if(!inv){ playBeep('error'); toast(`«${order.name||order.article}» (${order.article}) не сопоставлен с товаром в остатках — остаток не списан`); if(ozWiz) ozWiz.busy = false; ozRenderWizard(); return; }
    const avail = inv.isKit && inv.kitMode!=='assembled' ? computeKitAvailability(inv).available : inv.qty;
    if(avail < q){ playBeep('error'); toast(`Недостаточно на складе «${inv.name}» — нужно ${q} шт, есть ${avail}`); if(ozWiz) ozWiz.busy = false; ozRenderWizard(); return; }
    ozDeductAndBill(order, inv, q);
    toast('Отправление подтверждено в кабинете Ozon — остаток списан сейчас');
  }
  order.pickedAt = new Date().toISOString();
  ozDbUpdate(order.postingNumber, {picked_at:order.pickedAt, picked_by: currentUser?currentUser.name:null});
  ozDoneIds.add(order.postingNumber);
  playBeep('ok');
  const pi = ozPI(order);
  ozMode = 'scan'; ozWiz = null;
  ozRenderScan(`✓ ${order.postingNumber} · ${pi.name}${pi.size?' · '+pi.size:''} — собрано. Сканируйте следующее`, false);
  try{ await ozPrintOne(order.postingNumber); }catch(e){ console.error(e); }
  setTimeout(()=>{ const el = document.getElementById('ozScanInput'); if(el) el.focus(); }, 50);
}
// КИЗ в отправление, уже подтверждённое у Ozon (Ozon это разрешает: «Можно добавить код маркировки»)
async function ozSetKizOnShipped(order, codes){
  try{
    const { data, error } = await sb.functions.invoke('ozon-kiz-ts', { body:{ clientId:order.clientId, action:'set_kiz', postingNumber:order.postingNumber, kizCodes:codes } });
    if(error || (data && data.error)) return {ok:false, message:'Ozon: ' + ((data && data.error) || await extractEdgeFunctionError(data, error))};
    order.kizCode = codes.join('\n'); order.kizStatus = 'ok';
    return {ok:true, warning:data && data.warning};
  }catch(e){ return {ok:false, message:'Сбой связи: ' + (e.message||e)}; }
}
async function ozWizShip(){
  const order = ozWizOrder(); if(!order || ozWiz.busy) return;
  if(ozWiz.shipMode){
    if(!ozWiz.bcOk){ toast('Сначала отсканируйте штрихкод товара'); return; }
    if(ozWiz.needKiz && ozWiz.codes.length < (order.qty||1)){ toast('Отсканируйте все КИЗ'); return; }
    ozWiz.busy = true;
    if(ozWiz.needKiz){
      ozRenderWizard();
      const kr = await ozSetKizOnShipped(order, ozWiz.codes);
      if(!kr.ok){ playBeep('error'); toast('⚠ ' + order.postingNumber + ': ' + kr.message); if(ozWiz){ ozWiz.busy = false; ozWiz.codes = []; ozRenderWizard(); } return; }
      if(kr.warning) toast('КИЗ внесён, но: ' + kr.warning);
    }
    return ozPickDone(order);
  }
  const need = ozWiz.needKiz;
  if(need && ozWiz.codes.length < (order.qty||1)){ toast('Отсканируйте все КИЗ'); return; }
  ozWiz.busy = true; ozRenderWizard();
  const r = await ozAssemble(order, need ? ozWiz.codes : [], {picked:true});
  if(!r.ok){
    playBeep('error');
    toast('⚠ ' + order.postingNumber + ': ' + r.message);
    if(ozWiz){ ozWiz.busy = false; ozWiz.codes = []; ozRenderWizard(); }
    return;
  }
  playBeep('ok');
  const pi = ozPI(order);
  ozMode = 'scan'; ozWiz = null;
  ozRenderScan(`✓ ${order.postingNumber} · ${pi.name}${pi.size?' · '+pi.size:''} — собрано${r.warning?' (предупреждение: '+r.warning+')':''}. Сканируйте следующее`, false);
}
function ozWizBack(){ ozMode = 'scan'; ozWiz = null; ozRenderScan(); }
async function ozOutOfStock(){
  const order = ozWizOrder(); if(!order) return;
  if(!await customConfirm(`Отметить «${order.name||order.article}» (${order.postingNumber}) как отсутствующий на складе? Отправление останется в «Новых» с пометкой — решите вручную, отменять его в Ozon или искать замену.`)) return;
  order.outOfStock = true;
  ozDbUpdate(order.postingNumber, {out_of_stock:true});
  toast('Отмечено: нет на складе');
  ozWizBack();
}

// ---------- печать: этикетки (PDF Ozon) и лист подбора ----------
let ozPdfLibPromise = null;
function ozLoadPdfLib(){
  if(window.PDFLib) return Promise.resolve(window.PDFLib);
  if(!ozPdfLibPromise) ozPdfLibPromise = new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
    s.onload = ()=>res(window.PDFLib); s.onerror = ()=>rej(new Error('pdf-lib не загрузился'));
    document.head.appendChild(s);
  });
  return ozPdfLibPromise;
}
function ozB64ToBytes(b64){ const bin = atob(b64); const a = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return a; }
// Этикетки 58×40 (small_label) одним PDF на пачку отправлений; по странице на отправление в порядке запроса
async function ozFetchLabelPdf(clientId, postingNumbers){
  let last = '';
  for(let attempt=0; attempt<3; attempt++){
    try{
      const res = await Promise.race([
        sb.functions.invoke('ozon-fbs-ts', { body:{ clientId, action:'labels', postingNumbers } }),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('Ozon не ответил за 50 с')), 50000))
      ]);
      if(!(res.error || (res.data && res.data.error)) && res.data && res.data.file) return {ok:true, file:res.data.file};
      last = (res.data && res.data.error) || await extractEdgeFunctionError(res.data, res.error);
    }catch(e){ last = e.message || String(e); }
    await new Promise(r=>setTimeout(r, 1500 + attempt*2000));
  }
  return {ok:false, message:last};
}
async function ozPrintLabels(){
  const tab = ozonView==='ship' ? 'ship' : 'new';
  const list = ozTargets(tab);
  if(!list.length){ toast('Нет отправлений для печати'); return; }
  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал окно — разрешите всплывающие окна для сайта'); return; }
  win.document.write('<p style="font-family:Arial;padding:20px">Готовлю этикетки Ozon…</p>');
  toast(`Готовлю этикетки: ${list.length} шт…`);
  const files = [];
  const byClient = {};
  list.forEach(o=>{ (byClient[o.clientId] = byClient[o.clientId] || []).push(o); });
  for(const cid of Object.keys(byClient)){
    const arr = byClient[cid];
    for(let i=0;i<arr.length;i+=20){
      const r = await ozFetchLabelPdf(cid, arr.slice(i,i+20).map(o=>o.postingNumber));
      if(!r.ok){ win.close(); toast('Ozon: ' + r.message); return; }
      files.push(r.file);
    }
  }
  let blob;
  if(files.length===1) blob = new Blob([ozB64ToBytes(files[0])], {type:'application/pdf'});
  else {
    try{
      const L = await ozLoadPdfLib();
      const out = await L.PDFDocument.create();
      for(const f of files){ const src = await L.PDFDocument.load(ozB64ToBytes(f)); (await out.copyPages(src, src.getPageIndices())).forEach(p=>out.addPage(p)); }
      blob = new Blob([await out.save()], {type:'application/pdf'});
    }catch(e){
      console.error(e);
      blob = new Blob([ozB64ToBytes(files[0])], {type:'application/pdf'});
      toast('Не удалось склеить файлы — открыт только первый PDF');
    }
  }
  win.location.href = URL.createObjectURL(blob);
}

// ---------- печать на термопринтер через QZ Tray — как у WB: карточка товара, затем этикетки отправлений ----------
let ozPdfJsPromise = null;
function ozLoadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(!ozPdfJsPromise) ozPdfJsPromise = new Promise((res, rej)=>{
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = ()=>{ try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; }catch(e){} res(window.pdfjsLib); };
    s.onerror = ()=>{ ozPdfJsPromise = null; rej(new Error('pdf.js не загрузился — проверьте интернет и обновите страницу')); };
    document.head.appendChild(s);
  });
  return ozPdfJsPromise;
}
// PDF-страницы → картинки PNG (base64). Страницы рисуем в их родной ориентации (58×40 альбомная), поворот делает печать — как для WB.
async function ozPdfToPngPages(b64){
  const lib = await ozLoadPdfJs();
  const pdf = await lib.getDocument({ data: ozB64ToBytes(b64) }).promise;
  const pages = [];
  for(let n=1; n<=pdf.numPages; n++){
    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale:1 });
    const scale = Math.max(1, 900 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cv.width,cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push(cv.toDataURL('image/png').split(',')[1]);
  }
  return pages;
}
function ozLabelAllPages(){ try{ return localStorage.getItem('sklad42_oz_label_all_pages')==='1'; }catch(e){ return false; } }
async function ozPrintPngOnThermal(pngB64, ls){
  const widthPx = Math.round(ls.widthMm/25.4*203), heightPx = Math.round(ls.heightMm/25.4*203);
  const info = await imageBase64ToMonoBitmap(pngB64, 'image/png', widthPx, heightPx, ls.qrRotation);
  return printBitmapOnThermalPrinter(ls.widthMm, ls.heightMm, info);
}
// страницы PDF, относящиеся к отправлению №i из пачки (обычно 1 страница на отправление)
function ozPagesFor(pages, count, i){
  if(count>0 && pages.length===count) return [pages[i]];
  if(count>0 && pages.length%count===0){
    const per = pages.length/count;
    return ozLabelAllPages() ? pages.slice(i*per, (i+1)*per) : [pages[i*per]];
  }
  return null;
}
async function ozLabelPagesForPostings(clientId, orders){
  // возвращает {pn: [png,...]}; при несовпадении числа страниц пробует по одному отправлению
  const out = {};
  const getChunk = async (chunk)=>{
    const r = await ozFetchLabelPdf(clientId, chunk.map(o=>o.postingNumber));
    if(!r.ok) return {err:r.message};
    const pages = await ozPdfToPngPages(r.file);
    return {pages};
  };
  let errText = '';
  for(let i=0;i<orders.length;i+=20){
    const chunk = orders.slice(i,i+20);
    const r = await getChunk(chunk);
    if(r.err){ errText = r.err; continue; }
    let ok = chunk.map((o,k)=>ozPagesFor(r.pages, chunk.length, k));
    if(ok.every(Boolean)){ chunk.forEach((o,k)=>{ out[o.postingNumber] = ok[k]; }); continue; }
    for(const o of chunk){                       // страниц не поровну — берём этикетки по одному
      const r1 = await getChunk([o]);
      if(r1.err){ errText = r1.err; continue; }
      out[o.postingNumber] = ozLabelAllPages() ? r1.pages : [r1.pages[0]];
    }
  }
  return {pages:out, err:errText};
}
function ozInfoCardHtml(g){
  const ptPx = pt=>Math.round(pt/72*203), mmPx = mm=>Math.round(mm/25.4*203);
  const nameHtml = wrapTextManually(g.name||g.article, 22).map(line=>`<div>${escapeHtml(line)}</div>`).join('');
  const td = 'color:#666;white-space:nowrap;width:32%;padding:'+mmPx(0.4)+'px '+mmPx(1.2)+'px '+mmPx(0.4)+'px 0';
  const tv = 'font-weight:bold;word-break:break-all;padding:'+mmPx(0.4)+'px 0';
  const row = (label, val)=>`<tr><td style="${td}">${label}</td><td style="${tv}">${val}</td></tr>`;
  return `
    <div style="padding:${mmPx(2)}px;box-sizing:border-box;font-family:Arial,sans-serif;overflow:hidden;width:100%;height:100%">
      <div style="font-size:${ptPx(11)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px">${g.qty} шт.</div>
      <div style="font-size:${ptPx(8)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px;line-height:1.2">${nameHtml}</div>
      <table style="width:100%;font-size:${ptPx(6.5)}px;border-collapse:collapse;table-layout:fixed">
        ${g.cell?row('Ячейка', escapeHtml(String(g.cell))):''}
        ${g.color?row('Цвет', escapeHtml(g.color)):''}
        ${g.size?row('Размер', escapeHtml(g.size)):''}
        ${row('Артикул', escapeHtml(g.article||''))}
        ${row('ШК', escapeHtml(g.barcode||'—'))}
        ${row('Заказов', String(g.orders.length))}
      </table>
    </div>`;
}
async function ozPrintLabelsThermal(){
  try{ await ozPrintLabelsThermalImpl(); }
  catch(e){ console.error(e); toast('Ошибка печати: ' + (e && e.message ? e.message : e)); }
}
async function ozPrintLabelsThermalImpl(){
  const tab = ozonView==='ship' ? 'ship' : 'new';
  const rows = ozTargets(tab).slice().sort((a,b)=> (a.clientName||'').localeCompare(b.clientName||'') || (a.article||'').localeCompare(b.article||''));
  if(!rows.length){ toast('Нет отправлений для печати'); return; }
  if(!await connectThermalPrinter()) return;
  const groups = {};
  rows.forEach(o=>{
    const pi = ozPI(o);
    const key = o.clientId + '::' + (pi.barcode || o.article || o.postingNumber);
    if(!groups[key]) groups[key] = { name:pi.name, article:o.article, size:pi.size, barcode:pi.barcode, color:pi.color, cell:pi.cell, clientId:o.clientId, qty:0, orders:[] };
    groups[key].orders.push(o); groups[key].qty += (o.qty||1);
  });
  const groupList = Object.values(groups).sort((a,b)=> (a.article||'').localeCompare(b.article||''));
  toast(`Запрашиваем этикетки у Ozon для ${rows.length} отправл.…`);
  const byClient = {};
  rows.forEach(o=>{ (byClient[o.clientId] = byClient[o.clientId] || []).push(o); });
  const labelPages = {}; let firstErr = '';
  for(const [cid, arr] of Object.entries(byClient)){
    const r = await ozLabelPagesForPostings(cid, arr);
    Object.assign(labelPages, r.pages); if(r.err && !firstErr) firstErr = r.err;
  }
  const got = Object.keys(labelPages).length;
  if(firstErr) toast(`⚠ Ozon отдал этикетки не для всех отправлений: ${firstErr}. Получено: ${got} из ${rows.length}`);
  if(!got){ toast('Этикетки от Ozon не получены — печатать нечего. Повторите через минуту'); return; }
  toast(`Печатаем на принтере: ${groupList.length} карточек товара…`);
  const ls = getLabelSettings();
  for(const g of groupList){
    const info = await htmlToMonoBitmap(ozInfoCardHtml(g), ls.widthMm, ls.heightMm);
    if(!await printBitmapOnThermalPrinter(ls.widthMm, ls.heightMm, info)){ toast('Печать остановлена — проблема с принтером'); return; }
    for(const o of g.orders){
      for(const png of (labelPages[o.postingNumber]||[])){
        if(!await ozPrintPngOnThermal(png, ls)){ toast('Печать остановлена — проблема с принтером'); return; }
      }
    }
  }
  toast(`Готово: напечатано на принтере ${groupList.length} карточек товара`);
}
// Одна этикетка отправления — сразу на термопринтер; если QZ Tray недоступен, открывается PDF
async function ozPrintOne(pn, btn){
  const order = ozonOrders.find(o=>o.postingNumber===pn);
  if(!order) return;
  if(btn) btn.disabled = true;
  try{
    toast('Запрашиваю этикетку у Ozon…');
    const r = await ozLabelPagesForPostings(order.clientId, [order]);
    const pages = r.pages[pn];
    if(!pages || !pages.length){ toast('Ozon: ' + (r.err || 'этикетка не получена')); return; }
    if(await connectThermalPrinter()){
      const ls = getLabelSettings();
      for(const png of pages){ if(!await ozPrintPngOnThermal(png, ls)){ toast('Печать остановлена — проблема с принтером'); return; } }
      toast(`🖨 Этикетка ${pn} отправлена на печать`);
    }
  }catch(e){ console.error(e); toast('Ошибка печати этикетки: ' + (e.message||e)); }
  finally{ if(btn) btn.disabled = false; }
}
// старая кнопка «Этикетка» из 05-fbs.js — теперь тоже печатает через новый метод
function getOzonSticker(pn){ return ozPrintOne(pn); }
function ozPrintPickList(){
  const rows = ozTargets('new').map(o=>({o, pi:ozPI(o)})).sort((a,b)=>{
    if(a.pi.cell && b.pi.cell) return String(a.pi.cell).localeCompare(String(b.pi.cell), 'ru', {numeric:true});
    if(a.pi.cell) return -1; if(b.pi.cell) return 1;
    return (a.o.article||'').localeCompare(b.o.article||'');
  });
  if(!rows.length){ toast('Нет отправлений для листа подбора'); return; }
  const cid = ozClientFilter(); const cl = clients.find(c=>c.id===cid);
  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна'); return; }
  win.document.write(`<html><head><title>Лист подбора Ozon</title><style>
    body{font-family:Arial,sans-serif;padding:14px;font-size:11px;color:#111} h1{font-size:16px;margin-bottom:14px}
    table{width:100%;border-collapse:collapse} th,td{border:1px solid #333;padding:5px 8px;text-align:left;vertical-align:middle} th{background:#f0f0f0}
    .mono{font-family:'Courier New',monospace} .big{font-weight:bold;font-size:13px} @media print{body{padding:6px}}</style></head><body>
    <h1>Лист подбора Ozon${cl?` · ${escapeHtml(cl.name)}`:' (все клиенты)'} — ${rows.length} отправл. (по маршруту ячеек)</h1>
    <table><thead><tr><th style="width:34px">№</th><th>Ячейка</th><th>Наименование</th><th>Цвет</th><th>Размер</th><th>Артикул</th><th>Кол-во</th><th>КИЗ</th><th>Отправление</th></tr></thead><tbody>
    ${rows.map(({o,pi},i)=>{ const n = o.postingNumber; return `<tr><td>${i+1}</td><td class="big">${escapeHtml(String(pi.cell||'—'))}</td><td>${escapeHtml(pi.name)}</td><td>${escapeHtml(pi.color)||'—'}</td><td>${escapeHtml(pi.size)||'—'}</td><td class="mono">${escapeHtml(o.article)}</td><td class="big">${o.qty||1}</td><td>${ozNeedsKiz(o)?'да':''}</td><td class="mono">${escapeHtml(n.slice(0,-4))}<span class="big">${escapeHtml(n.slice(-4))}</span></td></tr>`; }).join('')}
    </tbody></table><script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script></body></html>`);
  win.document.close();
}

// ---------- акт отгрузки (перевозка Ozon) ----------
async function ozCloseShipment(){
  const cid = ozClientFilter();
  const rows = ozRows('ship').filter(o=>o.status==='awaiting_deliver');
  if(!rows.length){ toast('Нет собранных отправлений, ожидающих отгрузки'); return; }
  const clientIds = [...new Set(rows.map(o=>o.clientId))];
  if(!cid && clientIds.length>1){ toast('Выберите конкретного клиента Ozon — акт формируется по одному кабинету'); return; }
  const clientId = cid || clientIds[0];
  const mine = rows.filter(o=>o.clientId===clientId);
  const cl = clients.find(c=>c.id===clientId);
  if(!await customConfirm(`Закрыть отгрузку Ozon · ${cl?cl.name:''}?\nСобранных отправлений у нас: ${mine.length}.\n\nOzon сформирует перевозку из ВСЕХ собранных отправлений кабинета и акт приёма-передачи. Отменить после подтверждения нельзя.`, {danger:false, okText:'Закрыть отгрузку'})) return;
  const places = parseInt(prompt('Количество грузовых мест (коробок/пакетов) для акта:', '1')) ;
  if(!places || places<1){ toast('Отгрузка не закрыта: не указано число мест'); return; }
  const win = window.open('', '_blank');
  if(win) win.document.write('<p style="font-family:Arial;padding:20px">Формирую акт Ozon…</p>');
  toast('Закрываю отгрузку в Ozon…');
  const { data, error } = await sb.functions.invoke('ozon-fbs-ts', { body:{ clientId, action:'close_shipment', containersCount: places } });
  if(error || (data && data.error)){ if(win) win.close(); toast('Ozon: ' + ((data && data.error) || await extractEdgeFunctionError(data, error))); return; }
  toast(`Отгрузка закрыта — перевозка №${data.carriageId}`);
  if(data.file){
    const url = URL.createObjectURL(new Blob([ozB64ToBytes(data.file)], {type:'application/pdf'}));
    if(win) win.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = 'akt-ozon-' + data.carriageId + '.pdf'; a.click(); }
  } else { if(win) win.close(); toast(data.pdfNote || 'Акт ещё формируется — скачайте его в кабинете Ozon чуть позже'); }
  try{ await syncOzonStatuses(); }catch(e){ console.error(e); }
  renderOzonBody();
}

// инициализация оформления (старые кнопки-вкладки скрываются)
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ozInitUi); else ozInitUi();
setTimeout(ozInitUi, 800);

// ---------- подгрузка и синхронизации — как у WB ----------
// При открытии вкладки и каждые 30 секунд (пока она открыта) проверяем новые отправления; ещё работает фоновая проверка на сервере и живое обновление.
let ozAutoPollTimer = null, ozPolling = false;
async function ozPoll(){
  if(ozPolling || !isTabActive('tab-ozon')) return;
  if(ozMode!=='list' || ozonShipAllBusy || ozInFlight.size) return;
  const targets = ozClientFilter() ? [ozClientFilter()] : clients.filter(c=>c.ozonConnected).map(c=>c.id);
  if(!targets.length) return;
  ozPolling = true;
  try{
    let added = 0;
    for(const cid of targets){
      try{
        const { data, error } = await sb.functions.invoke('ozon-orders-ts', { body:{ clientId:cid, action:'fetch_new' } });
        if(!error && data && !data.error) added += data.newlyInserted || 0;
      }catch(e){ console.error(e); }
      try{   // заказы, подтверждённые/отменённые прямо в кабинете Ozon, — сразу меняем статус
        const r = await sb.functions.invoke('ozon-reconcile-ts', { body:{ clientId:cid, action:'reconcile_new' } });
        if(!r.error && r.data && !r.data.error) added += (r.data.changed||[]).length;
      }catch(e){ console.error(e); }
    }
    if(added>0 && ozMode==='list' && !ozInFlight.size){
      await loadOzonOrders();
      if(!isTypingInside('ozonBody')) renderOzonBody();
    }
  } finally { ozPolling = false; }
}
function renderOzon(){
  populateOzonClientSelect();
  ozInitHeader();
  renderOzonBody();
  if(!ozAutoPollTimer) ozAutoPollTimer = setInterval(ozPoll, 30000);
  ozPoll();
}
async function ozDiscoverMissing(){
  const targets = ozClientFilter() ? [ozClientFilter()] : clients.filter(c=>c.ozonConnected).map(c=>c.id);
  if(!targets.length){ toast('Нет ни одного клиента с подключённым Ozon'); return; }
  toast('Ищем отправления за последние 30 дней, которых нет в системе — это может занять минуту…');
  let found=0, missing=0, inserted=0; const errors=[];
  for(const cid of targets){
    const cl = clients.find(c=>c.id===cid);
    try{
      const { data, error } = await sb.functions.invoke('ozon-fbs-ts', { body:{ clientId:cid, action:'discover_missing' } });
      if(error || (data && data.error)){ errors.push(`«${cl?cl.name:cid}»: ${(data && data.error) || await extractEdgeFunctionError(data, error)}`); continue; }
      found += data.found||0; missing += data.missingCount||0; inserted += data.inserted||0;
    }catch(e){ errors.push(`«${cl?cl.name:cid}»: ${e.message||e}`); }
  }
  await loadOzonOrders(); renderOzonBody();
  toast(errors.length ? `Ошибки: ${errors.join(' | ')}` : `У Ozon за 30 дней: ${found}. Не было в системе: ${missing}. Добавлено: ${inserted}.`);
}
// кнопки шапки — те же, что на вкладке WB
function ozInitHeader(){
  const tab = document.getElementById('tab-ozon');
  if(!tab) return;
  const btns = [...tab.querySelectorAll('button')];
  const b1 = btns.find(b=>(b.getAttribute('onclick')||'').includes('fetchNewOzonOrders'));
  const b2 = btns.find(b=>(b.getAttribute('onclick')||'').includes('syncOzonStatuses'));
  if(b1){ b1.textContent = '🔄 Обновить сейчас'; b1.className = 'btn btn-ghost'; }
  if(b2) b2.textContent = '📡 Сверить статусы с Ozon';
  if(b2 && !document.getElementById('ozDiscoverBtn')){
    const d = document.createElement('button');
    d.id = 'ozDiscoverBtn'; d.className = 'btn btn-ghost'; d.textContent = '🔍 Найти пропущенные заказы';
    d.setAttribute('onclick', 'ozDiscoverMissing()');
    b2.insertAdjacentElement('afterend', d);
  }
}
