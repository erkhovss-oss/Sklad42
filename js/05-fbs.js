// ---------- FBS ORDERS ----------
function renderFbsClientSelect(){
  const wbClients = clients.filter(c=>c.wbConnected);
  const select = document.getElementById('fbsClientSelect');
  const prev = select.value || fbsSelectedClientId;
  select.innerHTML = `<option value="">Все клиенты</option>` + (wbClients.length
    ? wbClients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')
    : '');
  if(prev==='' || wbClients.find(c=>c.id===prev)) select.value = prev;
  fbsSelectedClientId = select.value;
}
// ---------- СПИСАНИЕ ПО ФАЙЛУ (клиенты, которые не дают доступ по API) ----------
// Клиент присылает выгрузку из своего кабинета (WB: «Сборочные задания» поставки, Ozon: список отправлений),
// мы разбираем файл, показываем, что будет списано, и списываем остаток. Каждая строка файла (№ задания /
// № отправления) записывается в таблицу file_shipments ровно один раз — повторная загрузка того же файла
// (или пересекающегося с ним) ничего не спишет второй раз. Загрузку можно отменить целиком.
const FS_CANCEL_RE = /отмен|отклон|cancel|declin/i;
let fsState = null;

function fsCell(v){ return v==null ? '' : String(v).trim(); }
// Штрихкод в Excel бывает числом (теряются ведущие нули) — сравниваем без ведущих нулей
function fsNormBarcode(v){ return fsCell(v).replace(/\.0+$/,'').replace(/^0+/,''); }
function fsParseQty(v){
  if(typeof v==='number') return v>0 ? Math.round(v) : 1;
  const m = fsCell(v).match(/\d+/);
  return m ? Math.max(1, parseInt(m[0],10)) : 1;
}
// WB пишет дату как «13:08:10 06.10.2026»
function fsParseWbDate(s){
  const m = fsCell(s).match(/(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if(!m) return null;
  const d = new Date(+m[6], +m[5]-1, +m[4], +m[1], +m[2], +m[3]);
  return isNaN(d) ? null : d.toISOString();
}
function fsHeaderMap(row){
  const map = {};
  (row||[]).forEach((c,i)=>{ const k = fsCell(c).toLowerCase().replace(/\s+/g,' '); if(k && !(k in map)) map[k] = i; });
  return map;
}
// Ищет лист, где в одной из первых строк есть все нужные заголовки (столбцы ищем по названиям, не по номерам)
function fsFindSheet(wb, needed){
  for(const name of wb.SheetNames){
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, defval:'', raw:true});
    for(let r=0; r<Math.min(rows.length, 10); r++){
      const map = fsHeaderMap(rows[r]);
      if(needed.every(h=>h in map)) return {name, rows, headerRow:r, map};
    }
  }
  return null;
}
// WB при выгрузке в Excel заменяет невидимые разделители GS символом-заменителем (U+FFFD) — возвращаем настоящий GS
function fsFixKiz(code){
  return normalizeKizInput(String(code||'').replace(/\uFFFD/g, GS_CHAR)).code;
}
function fsParseOzon(sh){
  const m = sh.map, rows = [], index = {};
  let declaredPositions = null, declaredQty = null;
  sh.rows.forEach((row, r)=>{
    if(r <= sh.headerRow) return;
    const first = fsCell(row[0]);
    const pm = first.match(/позиций\s*:\s*(\d+)/i);
    if(pm){ declaredPositions = +pm[1]; return; }
    if(/общее кол-во|всего/i.test(first)){
      const q = row.map(fsCell).join(' ').match(/(\d+)\s*шт/i);
      if(q) declaredQty = +q[1];
      return;
    }
    const posting = fsCell(row[m['№ отправления']]);
    if(!posting) return;
    const barcodeRaw = fsCell(row[m['шк товара']]);
    const barcode = fsNormBarcode(barcodeRaw);
    const name = fsCell(row[m['наименование']]);
    // артикул продавца у Ozon виден только в скобках в конце названия; «Артикул» в файле — числовой номер Ozon
    const hint = (name.match(/\(([^()\s]{2,40})\)\s*$/) || [])[1] || '';
    const row2 = {
      posting, itemKey: barcode, qty: fsParseQty(row[m['кол-во']]), name, size: '', color: '',
      vendor: hint, barcode, barcodeRaw, ozonSku: fsCell(row[m['артикул']]),
      label: fsCell(row[m['этикетка']]), kiz: '', supplyRef: '', statusInFile: '', orderedAt: null
    };
    const key = posting+'|'+row2.itemKey;
    if(index[key]){ index[key].qty += row2.qty; } else { index[key] = row2; rows.push(row2); }
  });
  return {
    marketplace:'ozon', rows,
    checks: {
      declaredPositions, declaredQty,
      parsedPositions: rows.length, parsedQty: rows.reduce((s,x)=>s+x.qty,0)
    },
    note: 'Ozon: список отправлений'
  };
}
function fsParseWb(wb, sh){
  const m = sh.map, rows = [], kizByOrder = {};
  const kizSheet = fsFindSheet(wb, ['№ задания','киз']);
  if(kizSheet){
    kizSheet.rows.forEach((r,i)=>{
      if(i <= kizSheet.headerRow) return;
      const id = fsCell(r[kizSheet.map['№ задания']]), k = fsCell(r[kizSheet.map['киз']]);
      if(id && k) kizByOrder[id] = fsFixKiz(k);
    });
  }
  const seen = new Set();
  sh.rows.forEach((row, i)=>{
    if(i <= sh.headerRow) return;
    const posting = fsCell(row[m['№ задания']]);
    if(!posting || seen.has(posting)) return;
    seen.add(posting);
    const barcodeRaw = fsCell(row[m['баркод']]);
    rows.push({
      posting, itemKey:'', qty:1, name: fsCell(row[m['наименование']]), size: fsCell(row[m['размер']]), color: fsCell(row[m['цвет']]),
      vendor: fsCell(row[m['артикул продавца']]), barcode: fsNormBarcode(barcodeRaw), barcodeRaw,
      ozonSku: '', wbArticle: fsCell(row[m['артикул wildberries']]), label: fsCell(row[m['стикер']]),
      kiz: kizByOrder[posting] || '', supplyRef: fsCell(row[m['qr-код поставки']]),
      statusInFile: fsCell(row[m['статус задания']]), orderedAt: fsParseWbDate(row[m['дата создания']])
    });
  });
  const supplies = [...new Set(rows.map(r=>r.supplyRef).filter(Boolean))];
  return {
    marketplace:'wb', rows,
    checks: { declaredPositions:null, declaredQty:null, parsedPositions: rows.length, parsedQty: rows.length },
    note: 'Wildberries: сборочные задания' + (supplies.length ? ' · поставка ' + supplies.join(', ') : '') + (kizSheet ? ` · КИЗ в файле: ${Object.keys(kizByOrder).length}` : '')
  };
}
function fsParseFile(wb){
  const wbSheet = fsFindSheet(wb, ['№ задания','артикул продавца']);
  if(wbSheet) return fsParseWb(wb, wbSheet);
  const ozSheet = fsFindSheet(wb, ['№ отправления','шк товара']);
  if(ozSheet) return fsParseOzon(ozSheet);
  return {error:'Не удалось определить формат файла. Поддерживаются выгрузки Wildberries (столбцы «№ задания», «Артикул продавца») и Ozon (столбцы «№ отправления», «ШК товара»).'};
}

// ----- сопоставление строк файла с нашими товарами -----
function fsClientRows(clientName){ return inventory.filter(i=>(i.client||'')===clientName && (i.warehouseId||'MAIN')!=='BRAK'); }
function fsItemRows(clientName, sku, size){ return fsClientRows(clientName).filter(i=>i.sku===sku && (i.size||'')===(size||'')); }
function fsFindItem(r, clientName){
  const rows = fsClientRows(clientName);
  if(!rows.length) return null;
  if(r.barcode){
    const byMain = rows.find(i=>fsNormBarcode(i.barcode)===r.barcode);
    if(byMain) return {sku:byMain.sku, size:byMain.size||'', via:'barcode'};
    const ex = inventoryBarcodes.find(b=>(b.clientName||'')===clientName && fsNormBarcode(b.barcode)===r.barcode);
    if(ex) return {sku:ex.sku, size:ex.size||'', via:'barcode'};
  }
  const v = (r.vendor||'').toLowerCase();
  if(v){
    const cand = rows.filter(i=>String(i.sku||'').toLowerCase()===v || String(i.vendorCode||'').toLowerCase()===v);
    if(cand.length){
      const sz = wbSizeKey(r.size);
      const exact = cand.filter(i=>wbSizeKey(i.size)===sz);
      const distinct = new Set(cand.map(i=>i.sku+'~~'+(i.size||'')));
      if(exact.length) return {sku:exact[0].sku, size:exact[0].size||'', via:'article'};
      if(distinct.size===1) return {sku:cand[0].sku, size:cand[0].size||'', via:'article-only'};
    }
  }
  return null;
}
function fsAvailable(clientName, sku, size){
  const rows = fsItemRows(clientName, sku, size);
  if(rows.length && rows[0].isKit && rows[0].kitMode!=='assembled'){
    try{ return Math.max(0, computeKitAvailability(rows[0]).available); }catch(e){ return 0; }
  }
  return rows.reduce((s,i)=>s+Math.max(0,i.qty||0), 0);
}
// Чистый расчёт плана (без обращений к сети): что спишется, что пропускается и почему
function fsComputePlan(parsed, clientName, already, api, opts){
  opts = opts || {};
  const excluded = opts.excludedStatuses || new Set();
  const rows = parsed.rows.map(r=>{
    const row = Object.assign({}, r, {state:'ok', item:null, via:null});
    const dup = already[r.posting+'|'+r.itemKey];
    if(dup){ row.state = 'dup_file'; row.info = dup; return row; }
    const a = api[r.posting];
    if(a){ row.state = (a.status==='cancel') ? 'api_cancelled' : 'dup_api'; row.info = a; return row; }
    if(r.statusInFile && excluded.has(r.statusInFile)){ row.state = 'status_excluded'; return row; }
    const f = fsFindItem(r, clientName);
    if(!f){ row.state = 'unmatched'; return row; }
    row.item = f; row.via = f.via;
    return row;
  });
  const byItem = new Map();
  rows.filter(r=>r.state==='ok').forEach(r=>{
    const k = r.item.sku+'~~'+r.item.size;
    if(!byItem.has(k)) byItem.set(k, {sku:r.item.sku, size:r.item.size, rows:[], needed:0, available:0});
    const g = byItem.get(k); g.rows.push(r); g.needed += r.qty;
  });
  byItem.forEach(g=>{
    g.available = fsAvailable(clientName, g.sku, g.size);
    let left = g.available;
    g.rows.forEach(r=>{ if(r.qty <= left) left -= r.qty; else r.state = 'short'; });
    g.shortage = Math.max(0, g.needed - g.available);
  });
  const count = s => rows.filter(r=>r.state===s).length;
  const sum = s => rows.filter(r=>r.state===s).reduce((a,r)=>a+r.qty,0);
  return {
    rows, items: [...byItem.values()],
    counts: {
      ok: count('ok'), okQty: sum('ok'), short: count('short'), shortQty: sum('short'),
      dupFile: count('dup_file'), dupApi: count('dup_api'), apiCancelled: count('api_cancelled'),
      statusExcluded: count('status_excluded'), unmatched: count('unmatched')
    }
  };
}
function fsChunk(arr, n){ const out=[]; for(let i=0;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }
// Что из этого файла уже списывали раньше (по нашей таблице) …
async function fsFetchAlreadyImported(clientName, marketplace, postings){
  const out = {};
  for(const part of fsChunk(postings, 150)){
    const { data, error } = await sb.from('file_shipments').select('posting_number,item_key,imported_at,batch_id')
      .eq('client_name', clientName).eq('marketplace', marketplace).in('posting_number', part);
    if(error) throw error;
    (data||[]).forEach(d=>{ out[d.posting_number+'|'+d.item_key] = d; });
  }
  return out;
}
// … и что уже пришло в систему как обычный заказ по API (чтобы не списать дважды: при сборке по API остаток уже списывается)
async function fsFetchApiOrders(marketplace, postings){
  const out = {};
  for(const part of fsChunk(postings, 150)){
    if(marketplace==='wb'){
      const ids = part.map(p=>Number(p)).filter(n=>!isNaN(n));
      if(!ids.length) continue;
      const { data, error } = await sb.from('wb_orders').select('order_id,supplier_status').in('order_id', ids);
      if(error) throw error;
      (data||[]).forEach(d=>{ out[String(d.order_id)] = {status:d.supplier_status}; });
    } else {
      const { data, error } = await sb.from('ozon_orders').select('posting_number,status').in('posting_number', part);
      if(error) throw error;
      (data||[]).forEach(d=>{ out[d.posting_number] = {status:d.status}; });
    }
  }
  return out;
}

// ----- списание -----
// Для каждой строки выбирается ОДНА строка остатка (склад): сначала та, где хватает на всё количество
// (основной склад в приоритете), иначе та, где больше всего. Так отмена точно вернёт товар на тот же склад.
function fsAllocate(rows, clientName){
  const left = new Map();
  const remaining = r => left.has(r) ? left.get(r) : Math.max(0, r.qty||0);
  const out = [];
  rows.forEach(row=>{
    const cands = fsItemRows(clientName, row.item.sku, row.item.size)
      .slice().sort((a,b)=> ((a.warehouseId||'MAIN')==='MAIN'?0:1) - ((b.warehouseId||'MAIN')==='MAIN'?0:1) || remaining(b)-remaining(a));
    let target = cands.find(c=>remaining(c) >= row.qty) || cands.slice().sort((a,b)=>remaining(b)-remaining(a))[0] || null;
    const take = target ? Math.min(row.qty, remaining(target)) : 0;
    if(target) left.set(target, remaining(target) - take);
    out.push({row, target, take});
  });
  return out;
}
function fsBillingAmount(item, qty, clientId){
  if(!item || !item.dims || !(item.dims.l && item.dims.w && item.dims.h)) return null;
  const liters = (item.dims.l * item.dims.w * item.dims.h) / 1000 * qty;
  return {liters, price: getFbsTariffPrice(clientId, liters)};
}
async function fsApplyPlan(){
  const st = fsState;
  if(!st || !st.plan || st.applying) return;
  const client = clients.find(c=>c.name===st.clientName);
  const opts = st.options;
  const todo = st.plan.rows.filter(r=>r.state==='ok' || (r.state==='short' && opts.allowShort));
  if(!todo.length){ toast('Нечего списывать'); return; }
  st.applying = true;
  const btn = document.getElementById('fsApplyBtn'); if(btn){ btn.disabled = true; btn.textContent = '⏳ Списываю…'; }
  try{
    const batchId = 'FS-' + Date.now();
    const allocs = fsAllocate(todo, st.clientName);
    const recs = allocs.map(a=>({
      batch_id: batchId, client_name: st.clientName, marketplace: st.parsed.marketplace,
      posting_number: a.row.posting, item_key: a.row.itemKey || '',
      sku: a.row.item.sku, size: a.row.item.size || '', barcode: a.row.barcodeRaw || a.row.barcode || null, name: a.row.name,
      qty: a.row.qty, deducted_qty: a.take, warehouse_id: a.target ? (a.target.warehouseId||'MAIN') : null,
      label: a.row.label || null, kiz: a.row.kiz || null, supply_ref: a.row.supplyRef || null,
      status_in_file: a.row.statusInFile || null, ordered_at: a.row.orderedAt, source_file: st.fileName,
      imported_by: currentUser ? currentUser.name : null
    }));
    // Сначала запись (с защитой от дублей на стороне базы), потом списание — и только по тем строкам, которые реально записались.
    const inserted = new Set();
    for(const part of fsChunk(recs, 100)){
      const { data, error } = await sb.from('file_shipments').upsert(part, {onConflict:'client_name,marketplace,posting_number,item_key', ignoreDuplicates:true}).select('posting_number,item_key');
      if(error) throw error;
      (data||[]).forEach(d=>inserted.add(d.posting_number+'|'+d.item_key));
    }
    let deducted = 0, skippedDup = 0, shortUnits = 0, billed = 0, billedSum = 0;
    const reason = `Списание по файлу ${st.parsed.marketplace==='wb'?'WB':'Ozon'}`;
    allocs.forEach((a, i)=>{
      const rec = recs[i];
      if(!inserted.has(rec.posting_number+'|'+rec.item_key)){ skippedDup++; return; }
      if(a.take > 0 && a.target){
        if(a.target.isKit && a.target.kitMode==='virtual'){ deductStockForShipment(a.target, a.take, `${reason} №${rec.posting_number}`); }
        else {
          a.target.qty = Math.max(0, a.target.qty - a.take);
          logMovement(a.target.sku, a.target.name, -a.take, `${reason} №${rec.posting_number}`, a.target.client, a.target.size, a.target.warehouseId||'MAIN');
        }
        deducted += a.take;
      }
      shortUnits += (a.row.qty - a.take);
      if(opts.bill && client){
        const b = fsBillingAmount(a.target || a.row.item && inventory.find(x=>x.sku===a.row.item.sku && (x.client||'')===st.clientName && (x.size||'')===(a.row.item.size||'')), a.row.qty, client.id);
        if(b && b.price!==null && b.price!==undefined){
          const ddsId = `FILE-SHIP-${rec.marketplace}-${rec.posting_number}-${rec.item_key||'0'}`;
          if(!ddsEntries.find(d=>d.id===ddsId)){
            const description = `Отгрузка по файлу ${rec.marketplace==='wb'?'WB':'Ozon'} №${rec.posting_number} · ${b.liters.toFixed(2)} л`;
            const date = new Date().toISOString().slice(0,10);
            ddsEntries.unshift({id:ddsId, type:'income', category:'Отгрузка FBS', amount:b.price, description, clientId:client.id, clientName:client.name, date, warehouseId: rec.warehouse_id || 'MAIN', createdAt:new Date().toISOString()});
            sb.from('dds_entries').insert({id:ddsId, type:'income', category:'Отгрузка FBS', amount:b.price, description, client_id:client.id, client_name:client.name, date, warehouse_id: rec.warehouse_id || 'MAIN', employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
            billed++; billedSum += b.price;
          }
        }
      }
    });
    st.lastResult = {batchId, applied: inserted.size, deducted, skippedDup, shortUnits, billed, billedSum};
    toast(`Списано по файлу: ${deducted} шт (строк файла: ${inserted.size})${skippedDup?` · уже были записаны: ${skippedDup}`:''}${shortUnits?` · не хватило остатка: ${shortUnits} шт`:''}${billed?` · начислено за отгрузку: ${billed} на ${billedSum.toFixed(0)} ₽`:''}`);
    if(typeof renderInventory==='function') renderInventory();
    fsReset(true);
  }catch(e){
    console.error(e);
    toast('Не удалось списать по файлу: ' + (e && e.message ? e.message : e) + ' — остаток не менялся, повторите');
  }finally{
    if(fsState) fsState.applying = false;
  }
}
// ----- отмена загрузки целиком -----
async function fsUndoBatch(batchId){
  const { data: recs, error } = await sb.from('file_shipments').select('*').eq('batch_id', batchId);
  if(error){ toast('Не удалось прочитать загрузку: ' + error.message); return; }
  if(!recs || !recs.length){ toast('Эта загрузка уже отменена'); fsRenderHistory(); return; }
  const units = recs.reduce((s,r)=>s+(r.deducted_qty||0),0);
  if(!await customConfirm(`Отменить загрузку «${recs[0].source_file||batchId}»? Остаток вернётся на склад (${units} шт по ${recs.length} строкам), начисления за отгрузку по ней удалятся, а сами отправления можно будет загрузить заново.`)) return;
  let restored = 0, lost = 0;
  const ddsIds = [];
  recs.forEach(r=>{
    ddsIds.push(`FILE-SHIP-${r.marketplace}-${r.posting_number}-${r.item_key||'0'}`);
    if(!(r.deducted_qty > 0)) return;
    const row = inventory.find(i=>i.sku===r.sku && (i.client||'')===r.client_name && (i.size||'')===(r.size||'') && (i.warehouseId||'MAIN')===(r.warehouse_id||'MAIN'));
    if(!row){ lost += r.deducted_qty; return; }
    row.qty += r.deducted_qty;
    logMovement(row.sku, row.name, r.deducted_qty, `Отмена списания по файлу ${r.marketplace==='wb'?'WB':'Ozon'} №${r.posting_number}`, row.client, row.size, row.warehouseId||'MAIN');
    restored += r.deducted_qty;
  });
  for(const part of fsChunk(ddsIds, 100)){
    const { error: dErr } = await sb.from('dds_entries').delete().in('id', part);
    if(dErr) console.error(dErr);
  }
  ddsEntries = ddsEntries.filter(d=>!ddsIds.includes(d.id));
  const { error: delErr } = await sb.from('file_shipments').delete().eq('batch_id', batchId);
  if(delErr){ toast('Остаток вернул, но удалить записи загрузки не удалось: ' + delErr.message); }
  else toast(`Загрузка отменена: возвращено ${restored} шт${lost?` (не нашёл строку остатка для ${lost} шт — проверьте вручную)`:''}`);
  if(typeof renderInventory==='function') renderInventory();
  fsRenderHistory();
}

// ----- привязка и создание товаров из файла -----
async function fsLinkGroup(idx){
  const st = fsState; const g = st && st.unmatchedGroups && st.unmatchedGroups[idx];
  const sel = document.getElementById('fsLink-'+idx);
  if(!g || !sel || !sel.value){ toast('Выберите товар из списка'); return; }
  const [sku, size] = sel.value.split('~~');
  const rows = fsItemRows(st.clientName, sku, size);
  if(!rows.length){ toast('Товар не найден'); return; }
  if(g.barcode){
    const owner = inventory.find(i=>(i.client||'')===st.clientName && fsNormBarcode(i.barcode)===g.barcode) || null;
    if(owner){ toast('Этот штрихкод уже числится за другим товаром'); return; }
    const row = {barcode: g.barcodeRaw || g.barcode, sku, client_name: st.clientName, size: size||''};
    const { error } = await sb.from('inventory_barcodes').upsert([row], {onConflict:'barcode,client_name', ignoreDuplicates:true});
    if(error){ console.error(error); toast('Не удалось сохранить привязку: ' + error.message); return; }
    inventoryBarcodes.push({barcode: row.barcode, sku, clientName: st.clientName, size: row.size});
    toast('Штрихкод привязан к товару — в следующих файлах он найдётся сам');
  } else {
    if(rows[0].vendorCode && String(rows[0].vendorCode).toLowerCase()!==g.vendor.toLowerCase()){ toast(`У товара уже указан другой артикул (${rows[0].vendorCode}) — поправьте артикул в остатках или создайте новый товар`); return; }
    rows.forEach(r=>{ r.vendorCode = g.vendor; });
    for(const r of rows) await syncInventoryRow(r.sku, r.client, r.size, r.warehouseId);
    toast(`Артикул «${g.vendor}» привязан к товару — в следующих файлах он найдётся сам`);
  }
  fsRecompute();
}
async function fsCreateMissing(){
  const st = fsState; if(!st || !st.unmatchedGroups || !st.unmatchedGroups.length) return;
  let created = 0;
  for(const g of st.unmatchedGroups){
    const first = g.rows[0];
    const sku = g.vendor || (st.parsed.marketplace==='ozon' ? ('OZ-' + (first.ozonSku || g.barcode)) : '');
    if(!sku) continue;
    const size = st.parsed.marketplace==='wb' ? (first.size||'') : '';
    if(findInventoryItem(sku, st.clientName, size)) continue;
    const item = {sku, name: first.name || sku, qty:0, client: st.clientName, size, vendorCode: g.vendor || null, barcode: g.barcodeRaw || g.barcode || '', color: first.color || '', warehouseId:'MAIN'};
    inventory.push(item);
    await ensureCellAssigned(item);
    await syncInventoryRow(item.sku, item.client, item.size, item.warehouseId);
    created++;
  }
  toast(`Создано товаров: ${created} (остаток 0) — оформите приёмку, чтобы появился остаток, затем загрузите файл заново`);
  fsRecompute();
}

// ----- окно -----
function fsGroupUnmatched(plan){
  const groups = new Map();
  plan.rows.filter(r=>r.state==='unmatched').forEach(r=>{
    const k = (r.barcode || r.vendor || r.name) + '|' + (r.size||'');
    if(!groups.has(k)) groups.set(k, {key:k, barcode:r.barcode, barcodeRaw:r.barcodeRaw, vendor:r.vendor, size:r.size, name:r.name, rows:[]});
    groups.get(k).rows.push(r);
  });
  return [...groups.values()];
}
function fsStateLabel(s){
  return {ok:'к списанию', short:'не хватает остатка', dup_file:'уже списано по файлу', dup_api:'уже есть как заказ по API', api_cancelled:'отменён (по API)', status_excluded:'исключён по статусу', unmatched:'товар не найден'}[s] || s;
}
function fsClose(){ const o = document.getElementById('fileShipOverlay'); if(o) o.remove(); fsState = null; }
function fsReset(keepHistory){
  if(!fsState) return;
  fsState.parsed = null; fsState.plan = null; fsState.fileName = '';
  fsRender();
}
function openFileShipments(){
  fsClose();
  const firstClient = (document.getElementById('fbsClientSelect')||{}).value;
  fsState = {clientName: (clients.find(c=>c.id===firstClient)||{}).name || (clients[0]||{}).name || '', parsed:null, plan:null, fileName:'', options:{bill:true, allowShort:false, excludedStatuses:new Set()}, unmatchedGroups:[], history:null};
  const o = document.createElement('div');
  o.id = 'fileShipOverlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9990;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto';
  o.innerHTML = '<div id="fileShipBox" style="background:#fff;border-radius:14px;padding:22px;max-width:980px;width:100%"></div>';
  o.addEventListener('mousedown', e=>{ if(e.target===o) fsClose(); });
  document.body.appendChild(o);
  fsRender();
  fsRenderHistory();
}
function fsSetClient(name){ if(fsState){ fsState.clientName = name; fsState.parsed = null; fsState.plan = null; fsRender(); fsRenderHistory(); } }
function fsSetOpt(k, v){
  if(!fsState) return;
  fsState.options[k] = v;
  if(fsState.plan) fsRender();
}
function fsToggleStatus(status, include){
  if(!fsState) return;
  if(include) fsState.options.excludedStatuses.delete(status); else fsState.options.excludedStatuses.add(status);
  fsRecompute();
}
async function fsHandleFile(inputEl){
  const file = inputEl.files && inputEl.files[0];
  if(!file || !fsState) return;
  const st = fsState;
  if(!st.clientName){ toast('Сначала выберите клиента'); return; }
  const box = document.getElementById('fsStatusLine'); if(box) box.textContent = '⏳ Читаю файл…';
  try{
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), {type:'array'});
    const parsed = fsParseFile(wb);
    if(parsed.error){ toast(parsed.error); if(box) box.textContent = parsed.error; return; }
    if(!parsed.rows.length){ toast('В файле не найдено ни одной строки'); if(box) box.textContent = 'В файле не найдено ни одной строки'; return; }
    const postings = parsed.rows.map(r=>r.posting);
    st.already = await fsFetchAlreadyImported(st.clientName, parsed.marketplace, postings);
    st.api = await fsFetchApiOrders(parsed.marketplace, postings);
    st.parsed = parsed; st.fileName = file.name;
    st.options.excludedStatuses = new Set([...new Set(parsed.rows.map(r=>r.statusInFile).filter(s=>s && FS_CANCEL_RE.test(s)))]);
    fsRecompute();
  }catch(e){
    console.error(e);
    toast('Не удалось разобрать файл: ' + (e && e.message ? e.message : e));
    if(box) box.textContent = 'Не удалось разобрать файл';
  }
}
function fsRecompute(){
  const st = fsState; if(!st || !st.parsed) return;
  st.plan = fsComputePlan(st.parsed, st.clientName, st.already||{}, st.api||{}, st.options);
  st.unmatchedGroups = fsGroupUnmatched(st.plan);
  fsRender();
}
function fsRender(){
  const box = document.getElementById('fileShipBox'); const st = fsState;
  if(!box || !st) return;
  const clientOptions = clients.map(c=>`<option value="${escapeHtml(c.name)}" ${c.name===st.clientName?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  let body = '';
  if(!st.plan){
    body = `<p id="fsStatusLine" style="font-size:13px;color:var(--ink-soft);margin:14px 0 0 0;line-height:1.6">Загрузите выгрузку из кабинета маркетплейса: Wildberries («Сборочные задания» поставки, с листом КИЗ) или Ozon (список отправлений). Формат определится сам. Перед списанием вы увидите, что именно изменится.</p>`;
  } else {
    const p = st.plan, c = p.counts, ch = st.parsed.checks;
    const totalsOk = (ch.declaredQty==null || ch.declaredQty===ch.parsedQty) && (ch.declaredPositions==null || ch.declaredPositions===ch.parsedPositions);
    const statuses = [...new Set(st.parsed.rows.map(r=>r.statusInFile).filter(Boolean))];
    const apply = c.ok + (st.options.allowShort ? c.short : 0);
    const applyQty = p.rows.filter(r=>r.state==='ok' || (r.state==='short' && st.options.allowShort)).reduce((s,r)=>s+r.qty,0);
    const chip = (n, label, color) => n ? `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${color};font-size:12px;font-weight:600;margin:0 6px 6px 0">${label}: ${n}</span>` : '';
    const itemRows = p.items.map(g=>{
      const it = fsItemRows(st.clientName, g.sku, g.size)[0] || {};
      const bad = g.shortage > 0;
      return `<tr style="${bad?'background:var(--warn-bg)':''}"><td>${escapeHtml(it.name||g.sku)}${g.size?` · ${escapeHtml(g.size)}`:''}<div class="mono" style="font-size:11px;color:var(--ink-faint)">${escapeHtml(g.sku)}</div></td>
        <td class="mono" style="text-align:right">${g.needed}</td><td class="mono" style="text-align:right">${g.available}</td>
        <td class="mono" style="text-align:right;${bad?'color:var(--warn);font-weight:700':''}">${Math.max(0,g.available-g.needed)}${bad?` (не хватает ${g.shortage})`:''}</td></tr>`;
    }).join('');
    const unmatchedHtml = st.unmatchedGroups.length ? `
      <div style="margin-top:16px;padding:12px;border:1px solid var(--warn);border-radius:10px;background:var(--warn-bg)">
        <div style="font-weight:700;font-size:13px;color:var(--warn);margin-bottom:6px">Товары не найдены у клиента: ${st.unmatchedGroups.length} (строк файла: ${c.unmatched})</div>
        ${st.unmatchedGroups.slice(0,30).map((g,i)=>`
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid rgba(0,0,0,0.08)">
            <div style="flex:1;min-width:240px;font-size:12px"><b>${escapeHtml(g.name)}</b>${g.size?` · ${escapeHtml(g.size)}`:''}<div class="mono" style="font-size:11px;color:var(--ink-soft)">${g.vendor?`артикул ${escapeHtml(g.vendor)} · `:''}${g.barcode?`ШК ${escapeHtml(g.barcodeRaw||g.barcode)} · `:''}строк: ${g.rows.length}</div></div>
            <select class="search" id="fsLink-${i}" style="width:230px"><option value="">Привязать к товару…</option>${[...new Set(fsClientRows(st.clientName).map(x=>x.sku+'~~'+(x.size||'')))].map(k=>{ const it=fsItemRows(st.clientName,...k.split('~~'))[0]; return `<option value="${escapeHtml(k)}">${escapeHtml((it&&it.name)||k)}${it&&it.size?` · ${escapeHtml(it.size)}`:''} (${escapeHtml(it?it.sku:k)})</option>`; }).join('')}</select>
            <button class="btn btn-ghost" style="padding:4px 10px" onclick="fsLinkGroup(${i})">Привязать</button>
          </div>`).join('')}
        <div style="margin-top:8px"><button class="btn btn-ghost" onclick="fsCreateMissing()">＋ Создать недостающие товары (остаток 0)</button></div>
      </div>` : '';
    const skipped = [
      c.dupFile ? `уже списано по файлу раньше: <b>${c.dupFile}</b>` : '',
      c.dupApi ? `уже есть как заказ по API (там остаток списывается при сборке): <b>${c.dupApi}</b>` : '',
      c.apiCancelled ? `отменены (по API): <b>${c.apiCancelled}</b>` : '',
      c.statusExcluded ? `исключены по статусу: <b>${c.statusExcluded}</b>` : ''
    ].filter(Boolean);
    body = `
      <div id="fsStatusLine" style="font-size:13px;color:var(--ink-soft);margin:12px 0 8px 0">${escapeHtml(st.parsed.note)} · файл «${escapeHtml(st.fileName)}» · строк: ${ch.parsedPositions}, единиц: ${ch.parsedQty}
        ${ch.declaredQty!=null||ch.declaredPositions!=null ? (totalsOk ? ' · <span style="color:var(--ok);font-weight:600">итоги файла сошлись ✓</span>' : ` · <span style="color:var(--warn);font-weight:700">итоги файла не сошлись: в файле указано ${ch.declaredPositions!=null?ch.declaredPositions+' поз.':''} ${ch.declaredQty!=null?ch.declaredQty+' шт':''}, прочитано ${ch.parsedPositions} поз. / ${ch.parsedQty} шт — проверьте файл</span>`) : ''}</div>
      <div style="margin-bottom:6px">
        ${chip(c.ok,'К списанию','#E7F2EA')}${chip(c.short,'Не хватает остатка','#FBE9E1')}${chip(c.unmatched,'Товар не найден','#FBE9E1')}${chip(c.dupFile,'Уже списано','#EEE')}${chip(c.dupApi,'Уже есть по API','#EEE')}${chip(c.apiCancelled,'Отменены','#EEE')}${chip(c.statusExcluded,'Исключены по статусу','#EEE')}
      </div>
      ${skipped.length ? `<div style="font-size:12px;color:var(--ink-soft);line-height:1.7;margin-bottom:8px">Пропускаются: ${skipped.join(' · ')}</div>` : ''}
      ${statuses.length>1 || statuses.some(s=>FS_CANCEL_RE.test(s)) ? `<div style="font-size:12px;margin-bottom:8px">Статусы в файле (отметьте, какие списывать): ${statuses.map(s=>`<label style="margin-right:12px"><input type="checkbox" ${st.options.excludedStatuses.has(s)?'':'checked'} onchange="fsToggleStatus('${escapeHtml(s).replace(/'/g,'&#39;')}', this.checked)"> ${escapeHtml(s)} (${st.parsed.rows.filter(r=>r.statusInFile===s).length})</label>`).join('')}</div>` : ''}
      ${p.items.length ? `<table style="width:100%;margin-top:6px"><thead><tr><th>Товар</th><th style="text-align:right">Списать, шт</th><th style="text-align:right">Остаток сейчас</th><th style="text-align:right">Будет после</th></tr></thead><tbody>${itemRows}</tbody></table>` : ''}
      ${unmatchedHtml}
      <div style="margin-top:14px;display:flex;gap:16px;flex-wrap:wrap;font-size:12px">
        <label><input type="checkbox" ${st.options.bill?'checked':''} onchange="fsSetOpt('bill', this.checked)"> Начислять за отгрузку по тарифу FBS (если у клиента заданы тарифы и габариты товара)</label>
        <label><input type="checkbox" ${st.options.allowShort?'checked':''} onchange="fsSetOpt('allowShort', this.checked)"> Списывать и при нехватке остатка (спишется сколько есть, остаток станет 0)</label>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="fsReset()">Выбрать другой файл</button>
        <button class="btn btn-accent" id="fsApplyBtn" ${apply?'':'disabled'} onclick="fsApplyPlan()">${apply ? `Списать ${applyQty} шт (строк: ${apply})` : 'Нечего списывать'}</button>
      </div>`;
  }
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><div class="eyebrow">Заказы FBS</div><h2 style="margin:2px 0 0 0;font-size:22px">Списание по файлу</h2></div>
      <button class="btn btn-ghost" onclick="fsClose()">✕ Закрыть</button>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">
      <select class="search" id="fsClientSelect" style="width:240px" onchange="fsSetClient(this.value)">${clientOptions}</select>
      <input type="file" id="fsFileInput" accept=".xlsx,.xls,.csv" onchange="fsHandleFile(this)">
    </div>
    ${body}
    <div id="fsHistory" style="margin-top:22px;padding-top:16px;border-top:1px solid var(--line)"></div>`;
  fsRenderHistory();
}
async function fsRenderHistory(){
  const el = document.getElementById('fsHistory'); const st = fsState;
  if(!el || !st) return;
  try{
    const { data, error } = await sb.from('file_shipments').select('batch_id,client_name,marketplace,source_file,imported_at,imported_by,qty,deducted_qty')
      .eq('client_name', st.clientName).order('imported_at', {ascending:false}).limit(2000);
    if(error) throw error;
    const batches = new Map();
    (data||[]).forEach(d=>{
      if(!batches.has(d.batch_id)) batches.set(d.batch_id, {id:d.batch_id, file:d.source_file, at:d.imported_at, by:d.imported_by, mp:d.marketplace, rows:0, units:0});
      const b = batches.get(d.batch_id); b.rows++; b.units += (d.deducted_qty||0);
    });
    const list = [...batches.values()].slice(0, 12);
    el.innerHTML = `<div class="eyebrow" style="margin-bottom:6px">Последние загрузки · ${escapeHtml(st.clientName)}</div>` + (list.length ? list.map(b=>`
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px">
        <span style="min-width:140px">${new Date(b.at).toLocaleString('ru-RU')}</span><span>${b.mp==='wb'?'WB':'Ozon'}</span>
        <span style="flex:1;min-width:160px" class="mono">${escapeHtml(b.file||b.id)}</span><span>строк: ${b.rows} · списано: ${b.units} шт</span><span style="color:var(--ink-faint)">${escapeHtml(b.by||'')}</span>
        <button class="btn btn-ghost" style="padding:2px 8px;color:var(--warn)" onclick="fsUndoBatch('${b.id}')">Отменить</button>
      </div>`).join('') : `<div style="font-size:12px;color:var(--ink-faint)">Загрузок по этому клиенту ещё не было</div>`);
  }catch(e){
    console.error(e);
    el.innerHTML = `<div style="font-size:12px;color:var(--ink-faint)">Не удалось загрузить историю загрузок</div>`;
  }
}

// Шапка вкладки FBS собирается из кода (поэтому для изменения хватает обновить этот JS-файл):
//  • рабочая кнопка «Списание по файлу» остаётся на виду;
//  • редкие сервисные действия (обновить, сверить статусы, найти пропущенные, донабрать номера поставок)
//    свёрнуты в выпадающее меню «Ещё».
const FBS_TOOLS_ACTIONS = ['fetchNewFbsOrders','syncFbsOrderStatuses','discoverMissingFbsOrders','backfillFbsSupplyIds'];
function fbsInitHeader(){
  const select = document.getElementById('fbsClientSelect');
  if(!select || !select.parentElement || !document.querySelector('#tab-fbs .page-head')) return false;
  const holder = select.parentElement;
  if(!document.getElementById('fbsToolsMenuStyle')){
    const st = document.createElement('style');
    st.id = 'fbsToolsMenuStyle';
    st.textContent = `
      #fbsToolsMenu{display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:290px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.14);padding:6px;z-index:60;flex-direction:column;gap:2px}
      #fbsToolsMenu.open{display:flex}
      #fbsToolsMenu button{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:10px 12px;font-size:13px;white-space:nowrap}
      #fbsToolsMenu button:hover:not(:disabled){background:var(--bg,#F3F0E8)}`;
    document.head.appendChild(st);
  }
  if(!document.getElementById('fsOpenBtn')){
    const btn = document.createElement('button');
    btn.id = 'fsOpenBtn';
    btn.className = 'btn btn-ghost';
    btn.title = 'Списание остатков по файлу из кабинета маркетплейса — для клиентов, которые не дают доступ по API';
    btn.textContent = '📥 Списание по файлу';
    btn.addEventListener('click', ()=>openFileShipments());
    holder.appendChild(btn);
  }
  if(!document.getElementById('fbsToolsMenuBtn')){
    const all = Array.from(document.querySelectorAll('#tab-fbs .page-head button'));
    const tools = FBS_TOOLS_ACTIONS.map(fn=>all.find(b=>(b.getAttribute('onclick')||'').indexOf(fn)>-1)).filter(Boolean);
    if(tools.length){
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;display:inline-block';
      const trigger = document.createElement('button');
      trigger.id = 'fbsToolsMenuBtn';
      trigger.className = 'btn btn-ghost';
      trigger.setAttribute('aria-haspopup', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.title = 'Обновить заказы, сверить статусы, найти пропущенные, донабрать номера поставок';
      const idleLabel = '⋯ Ещё ▾';
      trigger.textContent = idleLabel;
      const menu = document.createElement('div');
      menu.id = 'fbsToolsMenu';
      tools.forEach(b=>menu.appendChild(b)); // сами кнопки переносятся как есть — все их действия и индикаторы работают как раньше
      wrap.appendChild(trigger);
      wrap.appendChild(menu);
      holder.appendChild(wrap);
      const setOpen = (open)=>{ menu.classList.toggle('open', open); trigger.setAttribute('aria-expanded', open ? 'true' : 'false'); };
      trigger.addEventListener('click', (e)=>{ e.stopPropagation(); setOpen(!menu.classList.contains('open')); });
      menu.addEventListener('click', (e)=>{ if(e.target.closest('button')) setTimeout(()=>setOpen(false), 0); });
      document.addEventListener('click', (e)=>{ if(menu.classList.contains('open') && !wrap.contains(e.target)) setOpen(false); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && menu.classList.contains('open')){ setOpen(false); trigger.focus(); } });
      // пока выполняется любое действие из меню, на самой кнопке «Ещё» виден индикатор
      const syncBusy = ()=>{ const busy = tools.some(b=>b.dataset.loading==='1'); trigger.textContent = busy ? '⏳ Выполняется…' : idleLabel; };
      const obs = new MutationObserver(syncBusy);
      tools.forEach(b=>obs.observe(b, {attributes:true, attributeFilter:['data-loading','disabled']}));
    }
  }
  return true;
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fbsInitHeader);
else fbsInitHeader();
setTimeout(fbsInitHeader, 800); // на случай, если вкладка достроилась позже

// ---------- ВКЛАДКИ FBS КАК В КАБИНЕТЕ WB ----------
// Новые → На сборке → В доставке → Завершённые → Отменённые → Архив. Вкладка определяется по двум статусам WB:
// supplierStatus (его меняет продавец: new / confirm / complete / cancel) и wbStatus (сторона WB: waiting, sorted,
// ready_for_pickup, sold, canceled_by_client, declined_by_client, canceled, defect и т.д.).
const FBS_WB_FINAL = new Set(['sold','canceled','canceled_by_client','declined_by_client','defect']);
const FBS_STATUS_STALE_DAYS = 30; // WB отдаёт статусы только по заказам за последние 30 дней — у более старых итог уже не узнать
const FBS_ARCHIVE_DAYS = 90;      // «Завершённые» хранятся 3 месяца, затем уходят в «Архив» (как в кабинете WB)
const FBS_TABS = [
  {key:'new',      label:'Новые',       badge:true},
  {key:'confirm',  label:'На сборке',   badge:true},
  {key:'complete', label:'В доставке',  badge:false},
  {key:'done',     label:'Завершённые', badge:false},
  {key:'cancel',   label:'Отменённые',  badge:true},
  {key:'archive',  label:'Архив',       badge:false}
];
const FBS_WB_STATUS_LABELS = {
  waiting:['Передан, ждёт приёмки WB','planned'],
  sorted:['Отсортирован на складе WB','printed'],
  ready_for_pickup:['Ждёт покупателя в ПВЗ','assembling'],
  postponed_delivery:['Доставка отложена','assembling'],
  accepted_by_carrier:['У перевозчика','planned'],
  sent_to_carrier:['Передан перевозчику','planned'],
  sold:['Продан','assembled'],
  canceled_by_client:['Отказ покупателя (возврат)','overdue'],
  declined_by_client:['Отменён покупателем','overdue'],
  canceled:['Отменён продавцом','overdue'],
  defect:['Брак','overdue']
};
function fbsOrderAgeDays(o){
  const t = o && o.orderCreatedAt ? new Date(o.orderCreatedAt).getTime() : NaN;
  return isNaN(t) ? null : (Date.now() - t) / 86400000;
}
function fbsTabOf(o){
  const s = o.supplierStatus;
  if(s==='cancel') return 'cancel';
  if(s==='new') return 'new';
  if(s==='confirm') return 'confirm';
  if(s==='complete'){
    if(o.wbStatus==='canceled' || o.wbStatus==='declined_by_client') return 'cancel'; // отменён до того, как дошёл до покупателя
    const age = fbsOrderAgeDays(o);
    const finished = FBS_WB_FINAL.has(o.wbStatus) || (age!==null && age > FBS_STATUS_STALE_DAYS);
    if(finished) return (age!==null && age > FBS_ARCHIVE_DAYS) ? 'archive' : 'done';
    return 'complete';
  }
  return 'new'; // незнакомый статус не теряем из виду
}
function fbsStatusBadge(o){
  const m = FBS_WB_STATUS_LABELS[o.wbStatus];
  const label = m ? m[0] : (o.wbStatus ? o.wbStatus : 'Передан');
  return `<span class="status ${m ? m[1] : 'shipped'}">${escapeHtml(label)}</span>`;
}
function fbsGroupSummary(orders){
  const cnt = {};
  orders.forEach(o=>{ const k = o.wbStatus || '?'; cnt[k] = (cnt[k]||0) + 1; });
  return [['sold','продано'],['canceled_by_client','отказов'],['declined_by_client','отменено покупателем'],['defect','брак'],['ready_for_pickup','в ПВЗ'],['sorted','отсортировано'],['waiting','ждут приёмки']]
    .filter(([k])=>cnt[k]).map(([k,t])=>`${t}: ${cnt[k]}`).join(' · ');
}
function renderFbsCancelList(rows, clientId){
  const LIMIT = 300;
  const shown = rows.slice(0, LIMIT);
  return `<div class="panel">${shown.map(o=>`
      <div class="pick-row">
        <div><div class="sku-name">${(pi=>escapeHtml(pi.name||o.name||o.article))(findLocalProductInfo(o))}${o.size?` · ${escapeHtml(o.size)}`:''}</div>
          <div class="sku-code mono">${escapeHtml(o.article||'')}${o.barcode?` · ШК ${escapeHtml(o.barcode)}`:''} · заказ №${o.orderId}${!clientId?` · ${escapeHtml(o.clientName||'')}`:''}${o.orderCreatedAt?` · ${new Date(o.orderCreatedAt).toLocaleDateString('ru-RU')}`:''}</div></div>
        <div>${fbsStatusBadge(o)}</div>
      </div>`).join('')}
    ${rows.length>LIMIT ? `<div style="padding:12px 16px;font-size:12px;color:var(--ink-faint)">Показаны последние ${LIMIT} из ${rows.length}. Остальные можно найти по номеру заказа в кабинете WB.</div>` : ''}
  </div>`;
}
// Панель вкладок строится из кода (для обновления достаточно этого JS-файла): прежние три кнопки скрываются
function fbsInitTabs(){
  const oldBtn = document.getElementById('fbsTabNew');
  if(!oldBtn || !oldBtn.parentElement) return false;
  if(document.getElementById('fbsTabsBar')) return true;
  const holder = oldBtn.parentElement;
  ['fbsTabNew','fbsTabConfirm','fbsTabComplete'].forEach(id=>{ const b = document.getElementById(id); if(b) b.style.display = 'none'; });
  if(!document.getElementById('fbsTabsStyle')){
    const st = document.createElement('style');
    st.id = 'fbsTabsStyle';
    st.textContent = `
      #fbsTabsBar{display:inline-flex;gap:2px;padding:5px;background:#ECEAE4;border-radius:14px;max-width:100%;overflow-x:auto}
      #fbsTabsBar .fbs-tab{display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;border-radius:10px;padding:9px 14px;font-size:14px;font-weight:600;color:var(--ink-soft);cursor:pointer;white-space:nowrap}
      #fbsTabsBar .fbs-tab:hover:not(.active){color:var(--ink)}
      #fbsTabsBar .fbs-tab.active{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
      #fbsTabsBar .fbs-tab-badge{font-size:11px;font-weight:700;line-height:1;padding:3px 7px;border-radius:6px;background:#DDDAD2;color:var(--ink-soft)}
      #fbsTabsBar .fbs-tab.active .fbs-tab-badge{background:#E9D8FF;color:#6B21A8}`;
    document.head.appendChild(st);
  }
  const bar = document.createElement('div');
  bar.id = 'fbsTabsBar';
  bar.setAttribute('role', 'tablist');
  FBS_TABS.forEach(t=>{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fbs-tab';
    b.dataset.view = t.key;
    b.setAttribute('role', 'tab');
    b.innerHTML = `<span class="fbs-tab-label">${t.label}</span><span class="fbs-tab-badge" style="display:none"></span>`;
    b.addEventListener('click', ()=>setFbsView(t.key));
    bar.appendChild(b);
  });
  holder.insertBefore(bar, holder.firstChild);
  return true;
}
function fbsUpdateTabCounts(){
  const bar = document.getElementById('fbsTabsBar');
  if(!bar) return;
  const sel = document.getElementById('fbsClientSelect');
  const clientId = sel ? sel.value : '';
  const counts = {};
  fbsOrders.forEach(o=>{ if(clientId && o.clientId!==clientId) return; const t = fbsTabOf(o); counts[t] = (counts[t]||0) + 1; });
  FBS_TABS.forEach(t=>{
    const b = bar.querySelector(`[data-view="${t.key}"]`);
    if(!b) return;
    b.classList.toggle('active', fbsView===t.key);
    b.setAttribute('aria-selected', fbsView===t.key ? 'true' : 'false');
    const badge = b.querySelector('.fbs-tab-badge');
    if(t.badge){ badge.textContent = String(counts[t.key]||0); badge.style.display = ''; } else { badge.style.display = 'none'; }
  });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fbsInitTabs);
else fbsInitTabs();
setTimeout(fbsInitTabs, 800);

function setFbsView(view){
  fbsView = view;
  fbsCompletePage = 1;
  fbsInitTabs();
  const pageSizeSelect = document.getElementById('fbsCompletePageSize');
  if(pageSizeSelect){
    pageSizeSelect.style.display = ['complete','done','archive'].includes(view) ? '' : 'none';
    pageSizeSelect.value = String(fbsCompletePageSize);
  }
  renderFbsBody();
}
function renderFbsOrders(){
  renderFbsClientSelect();
  setFbsView(fbsView);
  if(!fbsAutoPollTimer){
    fbsAutoPollTimer = setInterval(()=>{
      if(document.getElementById('tab-fbs').classList.contains('active')) fetchNewFbsOrders(true);
    }, 30000);
  }
  fetchNewFbsOrders(true);
}
async function syncFbsOrderStatuses(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const targets = clientId ? [clientId] : clients.filter(c=>c.wbConnected).map(c=>c.id);
  if(!targets.length) return;
  const btn = typeof event!=='undefined' && event ? event.target.closest('button') : null;
  await withButtonLoading(btn, '⏳ Сверяю…', async ()=>{
    toast('Сверяем статусы заказов с WB…');
    let totalChecked = 0;
    const allChanged = [];
    let hadError = false;
    for(const cid of targets){
      try{
        const { data, error } = await sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action:'sync_order_statuses' } });
        if(error || (data && data.error)){ hadError = true; console.error(error||(data&&data.error)); continue; }
        totalChecked += data.total || 0;
        if(data.changed && data.changed.length) allChanged.push(...data.changed);
      }catch(e){ hadError = true; console.error(e); }
    }
    await loadFbsOrders();
    renderFbsBody();
    if(allChanged.length){
      toast(`Сверено ${totalChecked} — обновлено статусов: ${allChanged.length}${hadError?' (у части клиентов была ошибка)':''}`);
    } else {
      toast(`Сверено ${totalChecked} заказ(ов) — все статусы совпадают${hadError?' (у части клиентов была ошибка)':''}`);
    }
  });
}
async function fetchNewFbsOrders(silent){
  const clientId = document.getElementById('fbsClientSelect').value;
  const targets = clientId ? [clientId] : clients.filter(c=>c.wbConnected).map(c=>c.id);
  if(!targets.length) return;
  let totalFetched = 0;
  const errors = [];
  for(const cid of targets){
    const client = clients.find(c=>c.id===cid);
    const clientLabel = client ? client.name : cid;
    try{
      const { data, error } = await sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action: 'fetch_new' } });
      if(error){ errors.push(`«${clientLabel}»: ${await extractFnErrorMessage(error)}`); continue; }
      if(data && data.error){ errors.push(`«${clientLabel}»: ${data.error}`); continue; }
      totalFetched += data.fetched||0;
    }catch(e){ errors.push(`«${clientLabel}»: ${e.message||e}`); }
  }
  await loadFbsOrders();
  if(!silent){
    if(errors.length) toast(`Ошибки у ${errors.length} клиент(ов): ${errors.join(' | ')}`);
    else toast(`Проверено — новых заказов: ${totalFetched}`);
  }
  if(assemblyModeQueue.length === 0) renderFbsBody();
}
async function backfillFbsSupplyIds(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const targets = clientId ? [clientId] : clients.filter(c=>c.wbConnected).map(c=>c.id);
  if(!targets.length) return;
  toast('Донабираем номера поставок для заказов без них — это может занять время…');
  let totalOrphans = 0, totalMatched = 0;
  const errors = [];
  for(const cid of targets){
    const client = clients.find(c=>c.id===cid);
    const clientLabel = client ? client.name : cid;
    try{
      const { data, error } = await sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action:'backfill_supply_ids' } });
      if(error){ errors.push(`«${clientLabel}»: ${await extractFnErrorMessage(error)}`); continue; }
      if(data && data.error){ errors.push(`«${clientLabel}»: ${data.error}`); continue; }
      totalOrphans += data.orphans||0;
      totalMatched += data.matched||0;
    }catch(e){ errors.push(`«${clientLabel}»: ${e.message||e}`); }
  }
  await loadFbsOrders();
  renderFbsBody();
  if(errors.length) toast(`Ошибки у ${errors.length} клиент(ов): ${errors.join(' | ')}`);
  else toast(`Заказов без номера поставки было: ${totalOrphans}. Найдено и подставлено: ${totalMatched}.`);
}
async function discoverMissingFbsOrders(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const targets = clientId ? [clientId] : clients.filter(c=>c.wbConnected).map(c=>c.id);
  if(!targets.length) return;
  toast('Ищем заказы за последние 30 дней, которых нет в системе — это может занять минуту…');
  let totalFound = 0, totalMissing = 0, totalInserted = 0;
  const errors = [];
  for(const cid of targets){
    const client = clients.find(c=>c.id===cid);
    const clientLabel = client ? client.name : cid;
    try{
      const { data, error } = await sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action:'discover_missing_orders' } });
      if(error){ errors.push(`«${clientLabel}»: ${await extractFnErrorMessage(error)}`); continue; }
      if(data && data.error){ errors.push(`«${clientLabel}»: ${data.error}`); continue; }
      totalFound += data.found||0;
      totalMissing += data.missingCount||0;
      totalInserted += data.inserted||0;
      if(data.insertError) errors.push(`«${clientLabel}»: ошибка записи в базу — ${data.insertError}`);
    }catch(e){ errors.push(`«${clientLabel}»: ${e.message||e}`); }
  }
  await loadFbsOrders();
  renderFbsBody();
  if(errors.length) toast(`Ошибки у ${errors.length} клиент(ов): ${errors.join(' | ')}`);
  else toast(`У WB за 30 дней: ${totalFound}. Не было в системе: ${totalMissing}. Добавлено: ${totalInserted}.`);
}
let fbsCloseSelectedOrders = [];
function toggleFbsCloseSelected(orderId, checked){
  orderId = Number(orderId);
  if(checked){ if(!fbsCloseSelectedOrders.includes(orderId)) fbsCloseSelectedOrders.push(orderId); }
  else { fbsCloseSelectedOrders = fbsCloseSelectedOrders.filter(id=>id!==orderId); }
  renderFbsBody();
}
function toggleAllFbsCloseSelected(checked, visibleIds){
  fbsCloseSelectedOrders = checked ? [...new Set(visibleIds)] : [];
  renderFbsBody();
}
function renderFbsGroupedBySupply(rows, clientId, isDelivered, page, pageSize){
  if(!rows.length) return '';
  const groups = {};
  const order = [];
  rows.forEach(o=>{
    const key = o.wbSupplyId || ('__none__' + o.clientId);
    if(!groups[key]){ groups[key] = { supplyId: o.wbSupplyId, clientName: o.clientName, orders: [] }; order.push(key); }
    groups[key].orders.push(o);
  });
  let pageOrder = order;
  let paginationHtml = '';
  if(page && pageSize){
    const totalGroups = order.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));
    if(page > totalPages) page = totalPages;
    if(page < 1) page = 1;
    if(fbsCompletePage !== page) fbsCompletePage = page;
    const from = (page-1)*pageSize;
    const to = Math.min(from+pageSize, totalGroups);
    pageOrder = order.slice(from, to);
    paginationHtml = `
      <div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;margin-top:4px;flex-wrap:wrap">
        <span style="font-size:13px;color:var(--ink-soft)">Показано поставок ${totalGroups?from+1:0}–${to} из ${totalGroups}</span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goFbsCompletePage(-1)" ${page<=1?'disabled':''}>← Назад</button>
          <span style="font-size:13px;color:var(--ink-soft);white-space:nowrap">Стр. ${page} из ${totalPages}</span>
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goFbsCompletePage(1)" ${page>=totalPages?'disabled':''}>Вперёд →</button>
        </div>
      </div>
    `;
  }
  return `<div>${pageOrder.map(key=>{
    const g = groups[key];
    const isExpanded = !!expandedFbsSupplyIds[key];
    const missingKizInGroup = g.orders.filter(o=>o.requiresKiz && o.kizStatus!=='attached').length;
    const outOfStockInGroup = g.orders.filter(o=>o.outOfStock).length;
    return `
      <div class="panel" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;flex-wrap:wrap;gap:10px">
          <div style="cursor:pointer;flex:1" onclick="toggleFbsSupplyGroup('${escapeHtml(key)}')">
            <div style="font-weight:600;font-size:14px">${g.supplyId ? 'Поставка ' + escapeHtml(g.supplyId) : 'Без номера поставки'}${!clientId?` · ${escapeHtml(g.clientName)}`:''}</div>
            <div style="font-size:12px;color:var(--ink-faint)">${g.orders.length} заказ(ов)${isDelivered && fbsGroupSummary(g.orders) ? ' · ' + fbsGroupSummary(g.orders) : ''}${missingKizInGroup?` · ⚠ КИЗ не привязан: ${missingKizInGroup}`:''}${outOfStockInGroup?` · ❌ нет на складе: ${outOfStockInGroup}`:''}</div>
          </div>
          ${isDelivered && g.supplyId ? `<button class="btn btn-ghost" style="padding:6px 12px" onclick="downloadSupplyBarcode('${escapeHtml(g.supplyId)}','${escapeHtml(g.orders[0].clientId)}')">📥 QR поставки</button>` : ''}
          ${isDelivered && g.supplyId ? `<button class="btn btn-ghost" style="padding:6px 12px" onclick="downloadFbsKizExcel('${escapeHtml(g.supplyId)}','${escapeHtml(g.clientName)}')">📊 КИЗ (Excel)</button>` : ''}
          ${!isDelivered ? `<button class="btn btn-accent" style="padding:6px 12px" onclick="event.stopPropagation();closeFbsSupply('${escapeHtml(g.orders[0].clientId)}')">📦 Отгрузка поставки</button>` : ''}
          <span style="font-size:18px;color:var(--ink-faint);cursor:pointer" onclick="toggleFbsSupplyGroup('${escapeHtml(key)}')">${isExpanded?'▾':'▸'}</span>
        </div>
        ${isExpanded ? `
          <div style="border-top:1px solid var(--line)">
            ${g.orders.map(o=>`
              <div class="pick-row">
                ${!isDelivered ? `<input type="checkbox" ${fbsCloseSelectedOrders.includes(o.orderId)?'checked':''} onchange="toggleFbsCloseSelected(${o.orderId}, this.checked)">` : ''}
                <div><div class="sku-name">${(pi=>pi.name)(findLocalProductInfo(o))}${(pi=>pi.color?` · ${escapeHtml(pi.color)}`:'')(findLocalProductInfo(o))}${o.size?` · ${o.size}`:''}${o.outOfStock?' <span style="color:var(--warn);font-weight:700">· ❌ НЕТ НА СКЛАДЕ</span>':''}</div><div class="sku-code mono">${o.article}${o.barcode?` · ШК ${o.barcode}`:''} · заказ №${o.orderId}${(pi=>pi.cell?` · яч. ${pi.cell}`:'')(findLocalProductInfo(o))}${o.orderCreatedAt?` · ${timeAgoRu(o.orderCreatedAt)}`:''}${isDelivered?'':renderKizStatusLabel(o)}${isDelivered?'':pickBadgeHtml(o)}</div></div>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  ${!isDelivered && clientId ? renderTrbxAssignControl(o) : ''}
                  ${isDelivered ? fbsStatusBadge(o) : ''}
                  <button class="btn btn-ghost" style="padding:6px 12px" onclick="printFbsSticker(${o.orderId})">🖨 Этикетка</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('')}</div>${paginationHtml}`;
}
function toggleFbsSupplyGroup(key){
  expandedFbsSupplyIds[key] = !expandedFbsSupplyIds[key];
  renderFbsBody();
}
function renderFbsBody(){
  const clientId = document.getElementById('fbsClientSelect') ? document.getElementById('fbsClientSelect').value : '';
  const body = document.getElementById('fbsBody');
  fbsUpdateTabCounts();
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && fbsTabOf(o)===fbsView)
    .sort((a,b)=> (a.clientName||'').localeCompare(b.clientName||'') || (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));
  // в «В доставке», «Завершённых», «Отменённых» и «Архиве» новые заказы сверху
  if(['complete','done','cancel','archive'].includes(fbsView)) rows.sort((a,b)=> new Date(b.orderCreatedAt||0) - new Date(a.orderCreatedAt||0));
  if(!clients.some(c=>c.wbConnected)){
    body.innerHTML = `<div class="panel empty"><span class="eyebrow">Нет клиента</span>Подключите WB хотя бы одному клиенту в разделе «Клиенты»</div>`;
    return;
  }
  if(!rows.length){
    body.innerHTML = `<div class="panel empty">Заказов в этой вкладке пока нет</div>`;
    return;
  }
  if(fbsView==='new'){
    rows.sort((a,b)=> new Date(a.orderCreatedAt||0) - new Date(b.orderCreatedAt||0));
    const visibleIds = rows.map(o=>o.orderId);
    fbsSelectedOrders = fbsSelectedOrders.filter(id=>visibleIds.includes(id));
    const allSelected = fbsSelectedOrders.length>0 && visibleIds.every(id=>fbsSelectedOrders.includes(id));
    const selectedRequiringKiz = rows.filter(o=>fbsSelectedOrders.includes(o.orderId) && o.requiresKiz).length;
    const wrongWarehouseCount = clientId ? rows.filter(o=>{
      const cl = clients.find(c=>c.id===clientId);
      return cl && cl.wbWarehouseId && o.wbWarehouseId && String(o.wbWarehouseId)!==String(cl.wbWarehouseId);
    }).length : 0;
    body.innerHTML = `
      <div class="panel" style="padding:10px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;flex-wrap:wrap">
          <input type="checkbox" ${allSelected?'checked':''} onchange="toggleAllFbsSelected(this.checked)"> Выбрать все
        </label>
        ${fbsSelectedOrders.length ? `
          <span style="font-size:13px;font-weight:600">Выбрано: ${fbsSelectedOrders.length}${selectedRequiringKiz?` (из них с КИЗ: ${selectedRequiringKiz} — соберутся отдельно, вручную)`:''}</span>
          <button class="btn btn-accent" onclick="bulkAssembleSelectedFbsOrders()">Собрать выбранные</button>
        ` : ''}
        ${wrongWarehouseCount ? `<button class="btn btn-ghost" style="color:var(--warn)" onclick="hideOrdersFromOtherWarehouse('${clientId}')">🧹 Убрать заказы не с этого склада (${wrongWarehouseCount})</button>` : ''}
      </div>
      <div class="panel">${rows.map(o=>`
      <div class="pick-row">
        <input type="checkbox" ${fbsSelectedOrders.includes(o.orderId)?'checked':''} onchange="toggleFbsSelected(${o.orderId}, this.checked)">
        <div><div class="sku-name">${(pi=>pi.name)(findLocalProductInfo(o))}${(pi=>pi.color?` · ${escapeHtml(pi.color)}`:'')(findLocalProductInfo(o))}${o.size?` · ${o.size}`:''}${o.orderCreatedAt?` <span style="color:${(Date.now()-new Date(o.orderCreatedAt))>24*60*60*1000?'var(--warn)':'var(--accent)'};font-weight:700;font-size:12px">· ${(Date.now()-new Date(o.orderCreatedAt))>24*60*60*1000?'⚠ ':''}${timeAgoRu(o.orderCreatedAt)}</span>`:''}</div><div class="sku-code mono">${o.article} · ШК ${o.barcode||'—'} · заказ №${o.orderId}${(pi=>pi.cell?` · яч. ${pi.cell}`:'')(findLocalProductInfo(o))}${o.requiresKiz?' · требует КИЗ':''}${!clientId?` · ${escapeHtml(o.clientName)}`:''}${o.wbWarehouseId ? renderFbsWarehouseBadge(o) : ' · <span style="color:var(--ink-faint)">склад не определён</span>'}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-accent" style="padding:6px 12px" onclick="startAssembleOrder(${o.orderId})">Собрать</button>
          <button class="btn btn-ghost" style="padding:6px 12px" onclick="hideFbsOrder(${o.orderId})" title="Убрать только у нас, у WB заказ останется как есть">Скрыть</button>
          <button class="btn btn-ghost" style="padding:6px 12px;color:var(--warn)" onclick="cancelFbsOrder(${o.orderId})">Отменить</button>
        </div>
      </div>
    `).join('')}</div>`;
  } else if(fbsView==='confirm'){
    const missingKizCount = rows.filter(o=>o.requiresKiz && o.kizStatus!=='attached').length;
    const outOfStockOrders = rows.filter(o=>o.outOfStock);
    const visibleIds = rows.map(o=>o.orderId);
    fbsCloseSelectedOrders = fbsCloseSelectedOrders.filter(id=>visibleIds.includes(id));
    const allSelected = fbsCloseSelectedOrders.length>0 && visibleIds.every(id=>fbsCloseSelectedOrders.includes(id));
    const partialSelection = fbsCloseSelectedOrders.length>0 && !allSelected;
    body.innerHTML = `
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:13px;color:var(--ink-soft)">Позиций на сборке: ${rows.length} · <b>Собрано ${rows.filter(isOrderPicked).length} / ${rows.length}</b>. Когда всё собрано и промаркировано — закройте поставку и передайте на склад WB.</span>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;white-space:nowrap;flex-wrap:wrap">
            <input type="checkbox" ${allSelected?'checked':''} onchange="toggleAllFbsCloseSelected(this.checked, ${JSON.stringify(visibleIds)})"> Выбрать все
          </label>
          ${fbsCloseSelectedOrders.length ? `<span style="font-size:12px;font-weight:600">Выбрано: ${fbsCloseSelectedOrders.length} из ${rows.length}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${rows.length ? `<button class="btn btn-primary" onclick="startAssemblyMode()">🚀 Режим сборки</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="enterScanMode()">🔍 Найти заказ по скану</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="printFbsPickList()">📋 Лист сборки</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="printAllFbsStickers()">🖨 ${fbsCloseSelectedOrders.length ? `Выбранные этикетки (${fbsCloseSelectedOrders.length})` : `Все этикетки (${rows.length})`}</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="printAllFbsStickersToThermalPrinter()">🖨️ ${fbsCloseSelectedOrders.length ? `На принтер — выбранные (${fbsCloseSelectedOrders.length})` : 'На принтер (QZ Tray)'}</button>` : ''}
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="openLabelSettingsModal()">⚙️ Настройки этикетки</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="forgetQzPrinter()" title="Выбрать другой принтер при следующей печати">⚙️ Сменить принтер</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="previewThermalInfoCard()" title="Посмотреть, что именно генерируется для принтера">👁 Предпросмотр растра</button>
          <button class="btn btn-accent" onclick="closeFbsSupply()">📦 ${partialSelection ? `Закрыть выбранные (${fbsCloseSelectedOrders.length})` : 'Отгрузка поставки…'}</button>
        </div>
      </div>
      ${missingKizCount ? `<div class="panel" style="padding:12px 16px;margin-bottom:14px;background:var(--warn-bg);color:var(--warn);font-size:13px;font-weight:600">⚠ У ${missingKizCount} заказ(ов) требуется КИЗ, но он ещё не привязан — используйте «Режим сборки», прежде чем закрывать поставку</div>` : ''}
      ${outOfStockOrders.length ? `<div class="panel" style="padding:12px 16px;margin-bottom:14px;background:var(--warn-bg);color:var(--warn);font-size:13px">
        <div style="font-weight:600;margin-bottom:8px">❌ Отмечено как «нет на складе»: ${outOfStockOrders.length} — нужно решить, отменять у WB или перенести в отдельную поставку</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${outOfStockOrders.map(o=>`
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <span>«${escapeHtml(o.name||o.article)}» · заказ №${o.orderId}</span>
              ${o.movedToHolding
                ? `<span style="color:var(--ok);font-weight:600;font-size:12px">✅ Перенесён в отдельную поставку</span>`
                : `<div style="display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn btn-ghost" style="padding:3px 10px;font-size:12px" onclick="moveFbsOrderToHolding(${o.orderId})">📦 В отдельную поставку</button>
                    <button class="btn btn-ghost" style="padding:3px 10px;font-size:12px" onclick="cancelFbsOrder(${o.orderId})">Отменить у WB</button>
                  </div>`
              }
            </div>
          `).join('')}
        </div>
      </div>` : ''}
      ${clientId ? `<div id="fbsTrbxPanel"></div>` : `<p style="font-size:12px;color:var(--ink-faint);margin-bottom:14px">Выберите конкретного клиента, чтобы работать с коробами поставки (короба WB привязаны к одному продавцу).</p>`}
      ${renderFbsGroupedBySupply(rows, clientId)}
    `;
    if(clientId){
      if(fbsTrbxLoadedFor !== clientId) loadFbsTrbxes(clientId);
      else renderFbsTrbxPanel(clientId);
    }
  } else if(fbsView==='cancel'){
    body.innerHTML = renderFbsCancelList(rows, clientId);
  } else {
    body.innerHTML = renderFbsGroupedBySupply(rows, clientId, true, fbsCompletePage, fbsCompletePageSize);
  }
}
let scanModeActive = false;
let assemblyDoneIds = new Set(); // заказы, обработанные в текущем сеансе сканирования: одинаковые товары идут по очереди, повторы видны
let assemblyResume = null;       // откуда вернуться к очереди «Режима сборки» после поиска заказа
let assemblyPreconfirm = null;   // заказ найден по штрихкоду товара — ШК уже отсканирован, повторно не просим
function isAssemblyAutoSearch(){ try{ return localStorage.getItem('sklad42_assembly_auto_search') !== '0'; }catch(e){ return true; } }
function setAssemblyAutoSearch(on){ try{ localStorage.setItem('sklad42_assembly_auto_search', on ? '1' : '0'); }catch(e){} }
// ---------- СЧЁТЧИК «СОБРАНО N / M» ----------
// Заказ считается собранным, когда в режиме сборки подтверждён ШК товара и (если нужен) принят КИЗ. Отметка хранится в базе
// (picked_at), поэтому счётчик не сбрасывается при обновлении страницы и общий для всех сотрудников. M — все заказы клиента
// «На сборке». «Нет на складе» считаются отдельно, чтобы число несобранных показывало только то, что реально осталось собрать.
let assemblyShowRemaining = false;
let lastScanMsg = '', lastScanErr = false;
function isOrderPicked(o){ return !!o.pickedAt || assemblyDoneIds.has(o.orderId); }
function assemblyPool(){
  const sel = document.getElementById('fbsClientSelect');
  const clientId = sel ? sel.value : '';
  return fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm');
}
function pickProgress(pool){
  pool = pool || assemblyPool();
  return {
    total: pool.length,
    picked: pool.filter(isOrderPicked).length,
    noStock: pool.filter(o=>!isOrderPicked(o) && o.outOfStock).length,
    remaining: pool.filter(o=>!isOrderPicked(o) && !o.outOfStock)
  };
}
function pickProgressHtml(){
  const p = pickProgress();
  const pct = p.total ? Math.round(p.picked / p.total * 100) : 0;
  const allDone = p.total > 0 && p.remaining.length === 0 && p.noStock === 0;
  const extra = [p.remaining.length ? `осталось собрать: ${p.remaining.length}` : (allDone ? 'все заказы собраны ✓' : ''), p.noStock ? `❌ нет на складе: ${p.noStock}` : ''].filter(Boolean).join(' · ');
  return `<div style="margin-bottom:16px">
      <div style="font-size:32px;font-weight:700;line-height:1.1;color:${allDone?'var(--ok)':'var(--ink)'}">Собрано ${p.picked} / ${p.total}</div>
      <div style="height:8px;border-radius:4px;background:#E7E4DC;margin:8px auto 6px auto;max-width:360px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--ok)"></div></div>
      ${extra ? `<div style="font-size:12px;color:var(--ink-soft)">${extra}</div>` : ''}
    </div>`;
}
function pickChipHtml(){
  const p = pickProgress();
  const allDone = p.total > 0 && p.remaining.length === 0 && p.noStock === 0;
  return `<span class="status ${allDone?'assembled':'planned'}" style="cursor:default">Собрано ${p.picked} / ${p.total}</span>`;
}
function pickBadgeHtml(o){
  if(isOrderPicked(o)) return ' · <span style="color:var(--ok);font-weight:700">✅ собран</span>';
  return o.outOfStock ? '' : ' · <span style="color:var(--ink-faint)">⏳ не собран</span>';
}
function remainingListHtml(){
  const p = pickProgress();
  const resetLink = p.picked ? `<div style="margin-top:12px"><span style="font-size:11px;color:var(--ink-faint);cursor:pointer;text-decoration:underline" onclick="resetPickMarks()">сбросить отметки «собрано»</span></div>` : '';
  if(!p.remaining.length) return resetLink;
  const btn = `<button class="btn btn-ghost" style="margin-top:10px;font-size:12px;padding:5px 12px" onclick="toggleRemainingList()">${assemblyShowRemaining ? '▾ Скрыть несобранные' : `▸ Показать несобранные (${p.remaining.length})`}</button>`;
  if(!assemblyShowRemaining) return btn + resetLink;
  const sorted = p.remaining.slice().sort((a,b)=>{
    const ca = findLocalProductInfo(a).cell, cb = findLocalProductInfo(b).cell;
    if(ca && cb && ca!==cb) return ca - cb;
    if(ca && !cb) return -1;
    if(!ca && cb) return 1;
    return (a.article||'').localeCompare(b.article||'');
  });
  const rows = sorted.slice(0, 80).map(o=>{
    const pi = findLocalProductInfo(o);
    return `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line);text-align:left;font-size:12px">
        <div><b>${escapeHtml(pi.name||o.name||o.article)}</b>${o.size?` · ${escapeHtml(o.size)}`:''}<div class="mono" style="color:var(--ink-faint)">№${o.orderId}${pi.cell?` · яч. ${pi.cell}`:''}</div></div>
        <button class="btn btn-ghost" style="padding:3px 10px;font-size:12px" onclick="openRemainingOrder(${o.orderId})">Открыть</button>
      </div>`;
  }).join('');
  return btn + `<div style="margin-top:8px;max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:2px 10px">${rows}${sorted.length>80?`<div style="padding:8px 0;font-size:12px;color:var(--ink-faint)">…и ещё ${sorted.length-80}</div>`:''}</div>` + resetLink;
}
function toggleRemainingList(){ assemblyShowRemaining = !assemblyShowRemaining; renderScanModeScreen(lastScanMsg, lastScanErr); }
function openRemainingOrder(orderId){
  const o = assemblyPool().find(x=>x.orderId===orderId);
  if(o) openOrderInWizard(o, false);
}
function markOrderPicked(order){
  if(order.pickedAt) return;
  order.pickedAt = new Date().toISOString();
  sb.from('wb_orders').update({picked_at: order.pickedAt, picked_by: (typeof currentUser!=='undefined' && currentUser) ? currentUser.name : null}).eq('order_id', order.orderId)
    .then(({error})=>{ if(error) console.error(error); });
}
async function resetPickMarks(){
  const pool = assemblyPool();
  const marked = pool.filter(o=>o.pickedAt);
  if(!await customConfirm(`Сбросить отметки «собрано» у ${pool.filter(isOrderPicked).length} заказов? Счётчик начнётся с нуля — пригодится, если начинаете сборку заново.`)) return;
  pool.forEach(o=>{ o.pickedAt = null; });
  assemblyDoneIds = new Set();
  if(marked.length) await sb.from('wb_orders').update({picked_at:null, picked_by:null}).in('order_id', marked.map(o=>o.orderId));
  if(scanModeActive) renderScanModeScreen(lastScanMsg, lastScanErr); else renderFbsBody();
}
function enterScanMode(){
  scanModeActive = true;
  assemblyDoneIds = new Set();
  assemblyResume = null;
  renderScanModeScreen();
}
function exitScanMode(){
  scanModeActive = false;
  assemblyModeQueue = [];
  assemblyModeIndex = 0;
  assemblyResume = null;
  assemblyDoneIds = new Set();
  renderFbsBody();
}
function renderScanModeScreen(msg, msgIsError){
  lastScanMsg = msg || ''; lastScanErr = !!msgIsError;
  const body = document.getElementById('fbsBody');
  body.innerHTML = `
    <div class="panel" style="padding:30px;text-align:center;max-width:520px;margin:0 auto">
      <div class="eyebrow" style="margin-bottom:10px">Поиск заказа</div>
      ${pickProgressHtml()}
      <p style="font-size:13px;color:var(--ink-soft);margin-bottom:20px">Отсканируйте стикер заказа (или штрихкод товара, или введите номер заказа) — заказ откроется автоматически.</p>
      <input class="search mono" id="orderScanInput" placeholder="Ждём скан…" style="width:100%;text-align:center;font-size:16px;padding:14px" autofocus
        onkeydown="if(event.key==='Enter') handleOrderScan(this)">
      ${msg ? `<p style="font-size:13px;margin-top:14px;font-weight:600;color:${msgIsError?'var(--warn)':'var(--ok)'}">${escapeHtml(msg)}</p>` : ''}
      ${remainingListHtml()}
      <label style="display:flex;gap:6px;align-items:center;justify-content:center;font-size:12px;color:var(--ink-soft);margin-top:12px;cursor:pointer">
        <input type="checkbox" ${isAssemblyAutoSearch()?'checked':''} onchange="setAssemblyAutoSearch(this.checked)"> После заказа сразу возвращаться к поиску
      </label>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:18px">
        ${assemblyResume ? `<button class="btn btn-ghost" onclick="resumeAssemblyQueue()">↩ Продолжить по очереди</button>` : ''}
        <button class="btn btn-ghost" onclick="exitScanMode()">Выйти из режима сканирования</button>
      </div>
    </div>
  `;
  setTimeout(()=>{ const el = document.getElementById('orderScanInput'); if(el) el.focus(); }, 50);
}
// Код стикера заказа WB — то, что зашито в штрихкод на этикетке (например «*DbEFl55V»). Это поле barcode из ответа WB
// про стикеры; в самом заказе его нет, поэтому при первом скане запрашиваем стикеры заказов «На сборке» у WB и запоминаем.
function stickerKey(s){ return String(s||'').replace(/[^A-Za-z0-9]/g, ''); } // без служебных символов в начале (* ! $), которые зависят от сканера
const stickerFetchTried = new Set();
async function ensureStickerCodes(pool){
  const missing = pool.filter(o=>!o.stickerCode && !stickerFetchTried.has(o.orderId));
  if(!missing.length) return 0;
  const byClient = {};
  missing.forEach(o=>{ (byClient[o.clientId] = byClient[o.clientId] || []).push(o); });
  let got = 0;
  for(const cid of Object.keys(byClient)){
    const list = byClient[cid];
    for(let i=0; i<list.length; i+=100){
      const chunk = list.slice(i, i+100);
      chunk.forEach(o=>stickerFetchTried.add(o.orderId)); // чтобы не опрашивать повторно заказы, по которым WB не ответил
      try{
        const { data, error } = await sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action:'get_sticker', orderIds: chunk.map(o=>o.orderId) } });
        if(error || (data && data.error)) continue;
        (data.stickers || []).forEach(s=>{
          const o = chunk.find(x=>x.orderId===Number(s.orderId));
          if(o && s.barcode){
            o.stickerCode = s.barcode; got++;
            sb.from('wb_orders').update({sticker_code: s.barcode}).eq('order_id', o.orderId).then(()=>{});
          }
        });
      }catch(e){ console.error(e); }
    }
  }
  return got;
}
// Что отсканировано → какой заказ: номер заказа, rid, код стикера, штрихкод товара, артикул. Если товар один и тот же в нескольких
// заказах, берём ещё не обработанный в этом сеансе. via сообщает, чем нашли (по штрихкоду товара ШК уже подтверждён).
function findOrderForScan(raw, pool){
  const key = stickerKey(raw);
  const undoneFirst = (list)=> list.find(o=>!isOrderPicked(o)) || null;
  let o = pool.find(x=>String(x.orderId)===raw) || pool.find(x=>x.rid && x.rid===raw);
  if(o) return {order:o, via:'order'};
  if(key.length >= 6){
    o = pool.find(x=>x.stickerCode && (x.stickerCode===raw || stickerKey(x.stickerCode)===key));
    if(o) return {order:o, via:'sticker'};
  }
  for(const [field, via] of [['barcode','barcode'], ['article','article']]){
    const matches = pool.filter(x=>x[field] && x[field]===raw);
    if(matches.length){
      const next = undoneFirst(matches);
      if(!next) return {order:null, via, allDone:matches.length};
      return {order:next, via};
    }
  }
  const digits = (raw.match(/\d{4,}/g) || []).sort((a,b)=>b.length-a.length);
  for(const d of digits){
    o = pool.find(x=>String(x.orderId)===d);
    if(o) return {order:o, via:'order'};
  }
  return null;
}
async function handleOrderScan(inputEl){
  const raw = inputEl.value.trim();
  inputEl.value = '';
  if(!raw) return;
  if(raw===NEXT_ORDER_QR_CODE){ renderScanModeScreen('Код «Следующий заказ» здесь не нужен — отсканируйте стикер заказа', true); return; }
  const clientId = document.getElementById('fbsClientSelect').value;
  const pool = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm');
  let found = findOrderForScan(raw, pool);

  if(!(found && (found.order || found.allDone)) && stickerKey(raw).length >= 6){
    renderScanModeScreen('Ищу заказ по стикеру…');
    await ensureStickerCodes(pool);
    if(!scanModeActive) return; // пока ждали ответ WB, из режима скана вышли
    found = findOrderForScan(raw, pool);
  }

  if(found && found.allDone){
    playBeep('warn');
    renderScanModeScreen(`Все заказы с этим товаром (${found.allDone}) уже собраны.`, true);
    return;
  }
  if(!found || !found.order){
    playBeep('error');
    renderScanModeScreen(`Не нашёл заказ по «${raw}» среди заказов «На сборке». Проверьте, что заказ уже на сборке и выбран нужный клиент.`, true);
    return;
  }
  openOrderInWizard(found.order, found.via==='barcode');
}
function openOrderInWizard(order, barcodeAlreadyScanned){
  assemblyPreconfirm = barcodeAlreadyScanned ? order.orderId : null;
  assemblySupplyQueue = [{ supplyId: order.wbSupplyId||null, clientId: order.clientId, clientName: order.clientName, orders: [order] }];
  assemblySupplyIndex = 0;
  assemblyModeQueue = [order];
  assemblyModeIndex = 0;
  renderAssemblyModeStep();
}
// Заказ обработан (ШК подтверждён, а если нужен КИЗ — он принят): сразу открываем «Поиск заказа» для следующего скана
function openOrderSearch(message){
  if(!scanModeActive && assemblyModeQueue.length && assemblySupplyQueue.length){
    assemblyResume = { supplyQueue: assemblySupplyQueue, supplyIndex: assemblySupplyIndex }; // пришли из очереди — запомним, чтобы можно было вернуться
  }
  scanModeActive = true;
  renderScanModeScreen(message, false);
}
function resumeAssemblyQueue(){
  const r = assemblyResume;
  if(!r) return;
  assemblyResume = null;
  scanModeActive = false;
  let si = r.supplyIndex;
  while(si < r.supplyQueue.length && r.supplyQueue[si].orders.every(isOrderPicked)) si++;
  if(si >= r.supplyQueue.length){ toast('Все заказы очереди обработаны'); exitAssemblyMode(); return; }
  assemblySupplyQueue = r.supplyQueue;
  assemblySupplyIndex = si;
  assemblyModeQueue = r.supplyQueue[si].orders;
  assemblyModeIndex = Math.max(0, assemblyModeQueue.findIndex(o=>!isOrderPicked(o)));
  renderAssemblyModeStep();
}
function wizardOrderDone(order){
  assemblyDoneIds.add(order.orderId);
  markOrderPicked(order);
  playBeep('ok');
  if(!isAssemblyAutoSearch()) return; // выключено: остаёмся на заказе, дальше кнопкой «Следующий заказ»
  const pi = findLocalProductInfo(order);
  openOrderSearch(`✓ Заказ №${order.orderId} · ${pi.name||order.name||order.article}${order.size?' · '+order.size:''} — готово. Сканируйте следующий`);
}
// ШК подтверждён (отсканирован или найдено по нему): если нужен КИЗ — просим его, иначе заказ готов
function wizardBarcodeConfirmed(order){
  playBeep('ok');
  const kizDone = order.kizStatus==='attached' || order.kizStatus==='pending';
  const kizInput = document.getElementById('wizardKizInput');
  if(kizInput && !kizDone){
    kizInput.disabled = false;
    forceEnglishInput(kizInput);
    kizInput.focus();
    toast('Теперь отсканируйте КИЗ этой единицы');
  } else {
    toast('Штрихкод подтверждён');
    wizardOrderDone(order);
  }
}
function startAssemblyMode(){
  scanModeActive = false;
  assemblyDoneIds = new Set();
  assemblyResume = null;
  const clientId = document.getElementById('fbsClientSelect').value;
  const pool = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm');
  const rows = pool.filter(o=>!isOrderPicked(o))
    .sort((a,b)=> (a.clientName||'').localeCompare(b.clientName||'') || (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));
  if(!pool.length){ toast('Нет заказов на сборке'); return; }
  if(!rows.length){ toast(`Все заказы уже собраны (${pool.length} / ${pool.length}). Чтобы перепроверить заказ — «Найти заказ по скану»`); return; }

  const groups = {};
  const order = [];
  rows.forEach(o=>{
    const key = o.wbSupplyId || ('__none__'+o.clientId);
    if(!groups[key]){ groups[key] = { supplyId:o.wbSupplyId||null, clientId:o.clientId, clientName:o.clientName, orders:[] }; order.push(key); }
    groups[key].orders.push(o);
  });
  assemblySupplyQueue = order.map(k=>groups[k]);
  assemblySupplyIndex = 0;
  assemblyModeQueue = assemblySupplyQueue[0].orders;
  assemblyModeIndex = 0;
  renderAssemblyModeStep();
}
function skipCurrentSupply(){
  const skipped = assemblySupplyQueue[assemblySupplyIndex];
  assemblySupplyIndex++;
  if(assemblySupplyIndex < assemblySupplyQueue.length){
    assemblyModeQueue = assemblySupplyQueue[assemblySupplyIndex].orders;
    assemblyModeIndex = 0;
    toast(`Поставка «${skipped.clientName}» пропущена — перешли к следующей`);
    renderAssemblyModeStep();
  } else {
    toast(`Поставка «${skipped.clientName}» пропущена — больше поставок нет`);
    assemblyModeIndex = assemblyModeQueue.length; // покажет «Все заказы обработаны»
    renderAssemblyModeStep();
  }
}
// Ищет заказ (по номеру, rid, штрихкоду или артикулу) среди ВСЕХ поставок текущей
// очереди сборки — не только в текущей. Если нашёлся в другой поставке, переключает
// на неё. Нужно для случая, когда товары физически перемешались между поставками.
function jumpToOrderInWizard(targetOrder){
  const idxInCurrent = assemblyModeQueue.findIndex(o=>o.orderId===targetOrder.orderId);
  if(idxInCurrent>=0){ assemblyModeIndex = idxInCurrent; renderAssemblyModeStep(); return true; }
  for(let i=0;i<assemblySupplyQueue.length;i++){
    const j = assemblySupplyQueue[i].orders.findIndex(o=>o.orderId===targetOrder.orderId);
    if(j>=0){
      assemblySupplyIndex = i;
      assemblyModeQueue = assemblySupplyQueue[i].orders;
      assemblyModeIndex = j;
      renderAssemblyModeStep();
      return true;
    }
  }
  return false;
}
async function wizardFindByCode(inputEl){
  if(scanModeActive) return handleOrderScan(inputEl); // в режиме поиска ищем среди всех заказов «На сборке», как на экране поиска
  const raw = inputEl.value.trim();
  inputEl.value = '';
  if(!raw) return;
  if(raw===NEXT_ORDER_QR_CODE){ wizardNextOrder(); return; }
  const pool = assemblySupplyQueue.flatMap(s=>s.orders);
  let found = findOrderForScan(raw, pool);
  if(!(found && found.order) && stickerKey(raw).length >= 6){
    toast('Ищу заказ по стикеру…');
    await ensureStickerCodes(pool);
    found = findOrderForScan(raw, pool);
  }
  if(!found || !found.order){
    playBeep('error');
    toast(found && found.allDone ? `Все заказы с этим товаром (${found.allDone}) уже собраны` : `Не нашёл заказ по «${raw}» среди заказов на сборке`);
    return;
  }
  playBeep('ok');
  if(found.via==='barcode') assemblyPreconfirm = found.order.orderId;
  jumpToOrderInWizard(found.order);
}
function renderAssemblyModeStep(){
  const body = document.getElementById('fbsBody');
  if(assemblyModeIndex >= assemblyModeQueue.length){
    if(scanModeActive){
      renderScanModeScreen('Заказ обработан — готов к следующему скану', false);
      return;
    }
    // текущая поставка закончилась — переходим к следующей в очереди, если есть
    if(assemblySupplyIndex + 1 < assemblySupplyQueue.length){
      assemblySupplyIndex++;
      assemblyModeQueue = assemblySupplyQueue[assemblySupplyIndex].orders;
      assemblyModeIndex = 0;
      toast(`Поставка «${assemblySupplyQueue[assemblySupplyIndex].clientName}» — следующая`);
      renderAssemblyModeStep();
      return;
    }
    body.innerHTML = `
      <div class="panel" style="padding:30px;text-align:center">
        <h2 style="margin-bottom:14px">Все заказы обработаны</h2>
        <button class="btn btn-accent" onclick="exitAssemblyMode()">Готово</button>
      </div>
    `;
    return;
  }
  const order = assemblyModeQueue[assemblyModeIndex];
  const localKiz = findLocalRequiresKiz(order);
  if(localKiz !== null){
    order.requiresKiz = localKiz;
    renderAssemblyModeStepContent(order, localKiz);
    return;
  }
  body.innerHTML = `<div class="panel" style="padding:24px"><p style="font-size:13px;color:var(--ink-soft)">Товар ещё не отмечен в «Остатках» — уточняем у WB напрямую…</p></div>`;
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'check_meta', orderId: order.orderId } }).then(({data, error})=>{
    if(!error && data && !data.error) order.requiresKiz = order.requiresKiz || !!data.requiresKiz;
    renderAssemblyModeStepContent(order, order.requiresKiz);
  });
}
function renderAssemblyModeStepContent(order, requiresKiz){
  const body = document.getElementById('fbsBody');
  const pi = findLocalProductInfo(order);
  const currentSupply = assemblySupplyQueue[assemblySupplyIndex];
  body.innerHTML = `
    <div class="panel" style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="eyebrow">${pickChipHtml()} Поставка ${assemblySupplyIndex+1} из ${assemblySupplyQueue.length} · ${escapeHtml(currentSupply.clientName)}${currentSupply.supplyId?` (${escapeHtml(currentSupply.supplyId)})`:''} · заказ ${assemblyModeIndex+1} из ${assemblyModeQueue.length}</div>
          <h2 style="margin:6px 0 0 0">${escapeHtml(pi.name)}${pi.color?` · ${escapeHtml(pi.color)}`:''}${order.size?` · ${order.size}`:''}</h2>
        </div>
        ${pi.cell ? `<div style="background:var(--accent);color:#fff;border-radius:10px;padding:10px 20px;text-align:center;line-height:1.1"><div style="font-size:11px;opacity:0.85">ЯЧЕЙКА</div><div style="font-size:26px;font-weight:800">${pi.cell}</div></div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" onclick="printNextOrderQrCard()">🖨 QR «Следующий»</button>
          ${assemblySupplyQueue.length>1 ? `<button class="btn btn-ghost" style="color:var(--warn)" onclick="skipCurrentSupply()">⏭ Пропустить поставку</button>` : ''}
          <button class="btn btn-ghost" onclick="exitAssemblyMode()">✕ Завершить режим</button>
        </div>
      </div>
      <div style="margin-bottom:16px;padding:10px 12px;background:var(--bg);border-radius:10px">
        <div class="eyebrow" style="margin-bottom:6px">🔍 Найти заказ по коду (если товары перемешаны)</div>
        <input class="search mono" id="wizardFindByCodeInput" placeholder="Номер заказа, штрихкод или код со стикера…" style="width:100%;max-width:420px" autocomplete="off">
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--ink-soft);margin-top:8px;cursor:pointer">
          <input type="checkbox" id="wizardAutoSearch" ${isAssemblyAutoSearch()?'checked':''} onchange="setAssemblyAutoSearch(this.checked)"> После заказа сразу открывать поиск (не идти по очереди)
        </label>
      </div>
      <table style="margin-bottom:20px">
        <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Артикул</td><td class="mono">${escapeHtml(order.article)}</td></tr>
        <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Штрихкод</td><td class="mono">${order.barcode||'—'}</td></tr>
        ${pi.color?`<tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Цвет</td><td>${escapeHtml(pi.color)}</td></tr>`:''}
        <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Ячейка</td><td style="font-weight:700">${pi.cell||'не назначена'}</td></tr>
        <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Размер</td><td>${order.size||'—'}</td></tr>
        <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Клиент</td><td>${escapeHtml(order.clientName)}</td></tr>
        <tr><td style="color:var(--ink-faint);padding:4px 12px 4px 0">Заказ №</td><td class="mono">${order.orderId}</td></tr>
      </table>
      <div class="eyebrow" style="margin-bottom:6px">Штрихкод товара</div>
      <input class="search" id="wizardBarcodeInput" placeholder="Отсканируйте штрихкод, чтобы подтвердить товар…" style="width:100%;max-width:420px;margin-bottom:14px" autocomplete="off">
      <div id="wizardKizBlock">
        ${requiresKiz ? `
          <div class="eyebrow" style="margin-bottom:6px">КИЗ (Честный Знак)</div>
          <input class="search mono" id="wizardKizInput" placeholder="Отсканируйте КИЗ этой единицы…" style="width:100%;max-width:420px;margin-bottom:6px" autocomplete="off" disabled>
          <div id="wizardKizStatus" style="font-size:12px;margin-bottom:14px">${renderKizStatusLabel(order)}</div>
        ` : `
          <p style="font-size:12px;color:var(--ink-faint);margin-bottom:6px">По этому товару пока не отмечено, что нужна маркировка. Это решаете вы как продавец — сверьтесь с <a href="https://xn--80ajghhoc2aj1c8b.xn--p1ai/business/projects/" target="_blank" rel="noopener" style="color:var(--accent)">официальным перечнем категорий Честного Знака</a>, если не уверены.</p>
          <button class="btn btn-ghost" style="margin-bottom:14px" onclick="forceShowWizardKiz(${order.orderId})">+ Этому товару нужен КИЗ</button>
        `}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-accent" onclick="wizardNextOrder()">Следующий заказ →</button>
        <button class="btn btn-ghost" onclick="wizardSkipOrder()">Пропустить</button>
        <button class="btn btn-ghost" style="color:var(--warn)" onclick="markOrderOutOfStock(${order.orderId})">❌ Нет на складе</button>
      </div>
    </div>
    <div style="position:fixed;bottom:16px;right:16px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.1);z-index:50">
      <div id="fixedNextOrderQr"></div>
      <div style="font-size:10px;color:var(--ink-faint);margin-top:4px;max-width:100px">скан = следующий заказ</div>
    </div>
  `;
  const findInput = document.getElementById('wizardFindByCodeInput');
  findInput.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter') return;
    wizardFindByCode(findInput);
  });
  const bcInput = document.getElementById('wizardBarcodeInput');
  bcInput.focus();
  bcInput.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter') return;
    const code = bcInput.value.trim();
    bcInput.value='';
    if(!code) return;
    if(code===NEXT_ORDER_QR_CODE){ wizardNextOrder(); return; }
    if(order.barcode && code!==order.barcode){
      playBeep('error');
      toast('Штрихкод не совпадает с товаром этого заказа');
      return;
    }
    wizardBarcodeConfirmed(order);
  });
  wireWizardKizInput(order);
  if(pi.cell) announceCell(pi.cell);
  renderFixedNextOrderQr();
  // заказ найден по штрихкоду товара: ШК уже отсканирован — сразу к КИЗ (или к следующему поиску, если КИЗ не нужен)
  if(assemblyPreconfirm === order.orderId){
    assemblyPreconfirm = null;
    setTimeout(()=>wizardBarcodeConfirmed(order), 0);
  }
}
function renderFixedNextOrderQr(){
  const holder = document.getElementById('fixedNextOrderQr');
  if(!holder || holder.dataset.rendered) return;
  holder.dataset.rendered = '1';
  new QRCode(holder, {text: NEXT_ORDER_QR_CODE, width:160, height:160});
}
function printNextOrderQrCard(){
  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна'); return; }
  win.document.write(`
    <html><head><title>QR «Следующий заказ»</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      body{font-family:Arial,sans-serif;margin:0;padding:0;display:flex;align-items:center;justify-content:center;height:100vh}
      .card{border:2px solid #333;border-radius:12px;padding:20px 30px;text-align:center}
      h1{font-size:16px;margin:0 0 14px 0}
      .qr-wrap{display:flex;justify-content:center;margin-bottom:10px}
      p{font-size:11px;color:#666;margin:0;max-width:220px}
    </style>
    </head><body>
      <div class="card">
        <h1>Следующий заказ →</h1>
        <div class="qr-wrap" id="qr"></div>
        <p>Отсканируйте этот QR сканером в режиме сборки — вместо штрихкода или КИЗ, чтобы перейти к следующему заказу</p>
      </div>
      <script>
        new QRCode(document.getElementById('qr'), {text: ${JSON.stringify(NEXT_ORDER_QR_CODE)}, width:180, height:180});
        window.onload=function(){ setTimeout(function(){ window.print(); }, 400); };
      <\/script>
    </body></html>
  `);
  win.document.close();
}
function forceShowWizardKiz(orderId){
  const order = assemblyModeQueue[assemblyModeIndex];
  if(!order || order.orderId!==orderId) return;
  order.requiresKiz = true;
  const blockEl = document.getElementById('wizardKizBlock');
  blockEl.innerHTML = `
    <div class="eyebrow" style="margin-bottom:6px">КИЗ (Честный Знак)</div>
    <input class="search mono" id="wizardKizInput" placeholder="Отсканируйте КИЗ этой единицы…" style="width:100%;max-width:420px;margin-bottom:6px" autocomplete="off">
    <div id="wizardKizStatus" style="font-size:12px;margin-bottom:6px">${renderKizStatusLabel(order)}</div>
    <div style="margin-bottom:14px"><span style="font-size:11px;color:var(--accent);cursor:pointer" onclick="openKizScannerTest()">🔧 Проверка сканера КИЗ</span></div>
  `;
  forceEnglishInput(document.getElementById('wizardKizInput'));
  document.getElementById('wizardKizInput').focus();
  wireWizardKizInput(order);
}
// Окно «Проверка сканера КИЗ»: человек сканирует любой код, программа показывает, что реально
// пришло от сканера (невидимый GS отображается как ␝), сколько разделителей дошло и какие
// «служебные» нажатия клавиш передал сканер. Ничего никуда не отправляется.
function openKizScannerTest(){
  const prev = document.getElementById('kizTestOverlay');
  if(prev) prev.remove();
  const overlay = document.createElement('div');
  overlay.id = 'kizTestOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:22px;max-width:640px;width:100%;max-height:90vh;overflow:auto">
      <h3 style="margin:0 0 6px 0;font-size:18px">Проверка сканера КИЗ</h3>
      <p style="font-size:13px;color:var(--ink-soft);line-height:1.6;margin:0 0 12px 0">Отсканируйте любой КИЗ в поле ниже. Программа покажет, что реально пришло от сканера и дошли ли невидимые разделители GS. Ничего никуда не отправляется.</p>
      <input class="search mono" id="kizTestInput" placeholder="Сканируйте КИЗ сюда…" style="width:100%" autocomplete="off">
      <div id="kizTestResult" style="margin-top:12px;font-size:13px;line-height:1.6"></div>
      <div style="text-align:right;margin-top:14px"><button class="btn btn-ghost" id="kizTestClose">Закрыть</button></div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#kizTestInput');
  const result = overlay.querySelector('#kizTestResult');
  forceEnglishInput(input);
  let keys = [];
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){
      e.preventDefault();
      setTimeout(()=>{
        const raw = input.value;
        input.value = '';
        const norm = normalizeKizInput(raw);
        const shown = escapeHtml(raw).split(GS_CHAR).join('<span style="background:#FFE7A8;border-radius:3px;padding:0 3px;color:var(--warn);font-weight:700">␝</span>');
        const specials = {};
        keys.forEach(k=>{ if(k.ctrl || k.alt){ const name = (k.ctrl?'Ctrl+':'')+(k.alt?'Alt+':'')+(k.code||k.key); specials[name] = (specials[name]||0)+1; } });
        const specialsHtml = Object.keys(specials).length
          ? Object.keys(specials).map(n=>`<code>${escapeHtml(n)}</code> ×${specials[n]}`).join(', ')
          : 'нет';
        const gsInRaw = raw.split(GS_CHAR).length - 1;
        let verdict;
        if(gsInRaw >= 2) verdict = `<b style="color:var(--ok)">✅ Разделители дошли (${gsInRaw}). Сканер настроен правильно.</b>`;
        else if(norm.restored) verdict = `<b style="color:#A06A00">⚠ Разделители от сканера не пришли, но программа восстановила их по структуре кода — в WB уйдёт полный код. Настраивать сканер не обязательно.</b>`;
        else if(raw.length > 31) verdict = `<b style="color:var(--warn)">⚠ Разделителей нет, и структура кода нестандартная — автоматически восстановить нельзя. Если WB не принимает код, нужна настройка сканера.</b>`;
        else verdict = `<b>Код короткий (${raw.length} симв.) — это не полный КИЗ.</b>`;
        result.innerHTML = `
          <div style="padding:10px 12px;background:var(--bg);border-radius:8px;margin-bottom:8px;word-break:break-all;font-family:'IBM Plex Mono',monospace;font-size:12px">${shown || '—'}</div>
          <div>Длина: <b>${raw.length}</b> симв. · разделителей GS: <b>${gsInRaw}</b>${norm.restored ? ' → после восстановления: <b>'+norm.code.length+'</b> симв., GS: <b>2</b>' : ''}</div>
          <div>Служебные нажатия от сканера: ${specialsHtml}</div>
          <div style="margin-top:8px">${verdict}</div>`;
        keys = [];
      }, 0);
      return;
    }
    keys.push({key:e.key, code:e.code, ctrl:e.ctrlKey, alt:e.altKey});
  });
  const close = ()=>{ overlay.remove(); document.removeEventListener('keydown', onEsc, true); };
  const onEsc = (e)=>{ if(e.key==='Escape'){ e.preventDefault(); close(); } };
  document.addEventListener('keydown', onEsc, true);
  overlay.querySelector('#kizTestClose').onclick = close;
  setTimeout(()=>input.focus(), 0);
}
// Пока WB проверяет код (через API это занимает от секунд до пары минут, хотя в кабинете WB «Маркировка
// корректна» видно раньше), сами переспрашиваем WB по нарастающей и обновляем статус на экране —
// не ждём фоновой задачи и ручного обновления страницы. Прекращаем, как только решение получено.
const kizWatchers = {};
function watchPendingKiz(order){
  if(!order || kizWatchers[order.orderId]) return;
  kizWatchers[order.orderId] = true;
  const delays = [6000, 10000, 15000, 20000, 30000, 40000]; // всего около двух минут
  (async ()=>{
    for(const ms of delays){
      await new Promise(r=>setTimeout(r, ms));
      if(order.kizStatus !== 'pending') break;
      try{
        await sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'recheck_pending_kiz' } });
        const { data } = await sb.from('wb_orders').select('kiz_status, kiz_decision, kiz_code').eq('order_id', order.orderId).maybeSingle();
        if(data && data.kiz_status && data.kiz_status !== order.kizStatus){
          order.kizStatus = data.kiz_status;
          order.kizDecision = data.kiz_decision || null;
          if(data.kiz_code) order.kizCode = data.kiz_code;
          const twin = fbsOrders.find(o=>o.orderId===order.orderId);
          if(twin && twin!==order){ twin.kizStatus = order.kizStatus; twin.kizDecision = order.kizDecision; if(order.kizCode) twin.kizCode = order.kizCode; }
          const statusDiv = document.getElementById('wizardKizStatus');
          if(statusDiv) statusDiv.innerHTML = renderKizStatusLabel(order);
          if(data.kiz_status === 'attached'){ playBeep('ok'); toast(`✅ Заказ №${order.orderId}: КИЗ подтверждён WB`); }
          else if(data.kiz_status === 'verify_failed'){ playBeep('warn'); toast(`⚠ Заказ №${order.orderId}: WB не подтвердил КИЗ${data.kiz_decision ? ' ('+data.kiz_decision+')' : ''}`); }
          if(!scanModeActive) renderFbsBody();
        }
      }catch(e){ /* сеть моргнула — следующая попытка или фоновая задача по расписанию */ }
    }
    delete kizWatchers[order.orderId];
  })();
}
// КИЗ уже привязан к другому заказу WB? Смотрим заказы из базы — это переживает обновление страницы и общее для всех сотрудников.
// Коды приёмки сюда не входят: принятый с КИЗ товар законно отгружается с тем же кодом. Коды, которые WB не принял
// (verify_failed), «использованными» не считаются — иначе после сбоя повторный скан блокировался бы навсегда.
function findKizOnOtherOrder(code, exceptOrderId){
  const key = kizKey(code);
  return fbsOrders.find(o=>o.orderId!==exceptOrderId && o.kizCode && o.kizStatus!=='verify_failed' && kizKey(o.kizCode)===key) || null;
}
function wireWizardKizInput(order){
  const kizInput = document.getElementById('wizardKizInput');
  if(!kizInput || kizInput.dataset.wired) return;
  kizInput.dataset.wired = '1';
  kizInput.addEventListener('keydown', (e2)=>{
    if(e2.key!=='Enter') return;
    // Сканер иногда шлёт символы очень быстро — читаем значение поля не сразу,
    // а после того как браузер точно успел записать последний символ (иначе
    // изредка теряется самый последний символ кода, и проверка у WB не проходит).
    setTimeout(()=>{
      const norm = normalizeKizInput(kizInput.value);
      const kizCode = norm.code;
      kizInput.value='';
      if(!kizCode) return;
      if(kizCode===NEXT_ORDER_QR_CODE){ wizardNextOrder(); return; }
      if(kizCode.length < MIN_KIZ_LENGTH){
        playBeep('error');
        toast(`Код слишком короткий (${kizCode.length} симв.) — отсканируйте ещё раз`);
        return;
      }
      const dup = findKizOnOtherOrder(kizCode, order.orderId);
      if(dup){ playBeep('error'); toast(`Этот КИЗ уже привязан к заказу №${dup.orderId} («${dup.name||dup.article}») — проверьте, тот ли код`); return; }
      wizardAttachKiz(order, kizCode, norm);
    }, 0);
  });
}
function wizardAttachKiz(order, kizCode, norm){
  toast(`Отправляем КИЗ на WB… (${kizCode.length} симв., разделителей GS: ${norm ? norm.gsCount : '?'}${norm && norm.restored ? ', восстановлены автоматически' : ''})`);
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'attach_kiz', orderId: order.orderId, kizCode } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    order.kizCode = kizCode;
    order.kizStatus = data.kizStatus;
    order.kizDecision = data.decision || null;
    sb.from('wb_orders').update({kiz_code:kizCode, kiz_status:data.kizStatus, requires_kiz:true}).eq('order_id', order.orderId).then(({error})=>{ if(error) console.error(error); });
    if(data.kizStatus==='attached'){
      playBeep('ok');
      toast('✅ КИЗ подтверждён WB');
      const invItem = order.barcode ? inventory.find(i=>i.barcode===order.barcode && i.client===order.clientName) : null;
      if(invItem && !invItem.requiresKiz){
        invItem.requiresKiz = true;
        syncInventoryRow(invItem.sku, invItem.client, invItem.size, invItem.warehouseId);
        toast('Товар «' + invItem.name + '» теперь отмечен как требующий КИЗ в Остатках — в следующий раз определится сам');
      }
    }
    else if(data.kizStatus==='pending'){
      playBeep('ok');
      toast('⏳ КИЗ отправлен, WB ещё проверяет — можно продолжать сборку, статус обновится сам');
      watchPendingKiz(order);
    }
    else { playBeep('warn'); toast('⚠ WB не подтвердил КИЗ — ' + (data.warning||'проверьте вручную')); }
    const statusDiv = document.getElementById('wizardKizStatus');
    if(statusDiv) statusDiv.innerHTML = renderKizStatusLabel(order);
    // КИЗ принят (или WB ещё проверяет — досмотрим сами): заказ готов, открываем поиск следующего.
    // Если WB КИЗ не принял — остаёмся на заказе, чтобы сразу отсканировать другой код.
    if(data.kizStatus !== 'verify_failed' && assemblyModeQueue[assemblyModeIndex] === order) wizardOrderDone(order);
  });
}
async function wizardNextOrder(){
  const order = assemblyModeQueue[assemblyModeIndex];
  if(order && order.requiresKiz && order.kizStatus!=='attached' && order.kizStatus!=='pending'){
    if(!await customConfirm('КИЗ ещё не подтверждён для этого заказа — всё равно перейти дальше?')) return;
  }
  assemblyModeIndex++;
  renderAssemblyModeStep();
}
function wizardSkipOrder(){
  assemblyModeIndex++;
  renderAssemblyModeStep();
}
function moveFbsOrderToHolding(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  toast('Переносим заказ в отдельную поставку у WB…');
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'move_to_holding_supply', orderId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    order.movedToHolding = true;
    order.wbSupplyId = data.holdingSupplyId;
    toast(`Заказ №${orderId} перенесён в отдельную поставку — можно закрывать основную поставку без него`);
    sb.from('wb_orders').update({wb_supply_id:data.holdingSupplyId}).eq('order_id', orderId).then(({error})=>{ if(error) console.error(error); });
    renderFbsBody();
  });
}
async function markOrderOutOfStock(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  if(!await customConfirm(`Отметить «${order.name||order.article}» (заказ №${order.orderId}) как отсутствующий на складе? Заказ останется на сборке, но будет помечен — нужно будет вручную решить, отменять его у WB или искать замену.`)) return;
  order.outOfStock = true;
  toast(`Отмечено: нет на складе — «${order.name||order.article}»`);
  sb.from('wb_orders').update({out_of_stock:true}).eq('order_id', orderId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить пометку в базе'); }
  });
  assemblyModeIndex++;
  renderAssemblyModeStep();
}
function exitAssemblyMode(){
  scanModeActive = false;
  assemblyResume = null;
  assemblyDoneIds = new Set();
  assemblyModeQueue = [];
  assemblyModeIndex = 0;
  assemblySupplyQueue = [];
  assemblySupplyIndex = 0;
  renderFbsBody();
}
function findLocalRequiresKiz(order){
  let item = order.barcode ? inventory.find(i=>i.barcode===order.barcode && i.client===order.clientName) : null;
  if(!item && order.article) item = inventory.find(i=>i.vendorCode===order.article && i.client===order.clientName);
  if(item && typeof item.requiresKiz === 'boolean') return item.requiresKiz;
  return null; // неизвестно локально — придётся спросить у WB
}
function startAssembleOrder(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  finishAssembleOrder(order, null);
}
function renderAssembleOrderForm(order, requiresKiz){
  const body = document.getElementById('fbsBody');
  body.innerHTML = `
    <div class="panel" style="padding:20px">
      <div class="eyebrow" style="margin-bottom:10px">Отправка на сборку — заказ №${order.orderId}</div>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
        <div><div class="sku-name" style="font-size:16px">${order.name||order.article}${order.size?` · ${order.size}`:''}</div><div class="sku-code mono">${order.article} · ШК ${order.barcode||'—'}</div></div>
      </div>
      <div class="eyebrow" style="margin-bottom:6px">Штрихкод товара</div>
      <input class="search" id="fbsScanBarcode" placeholder="Отсканируйте штрихкод, чтобы подтвердить нужный товар…" style="width:100%;max-width:420px" autocomplete="off">
      ${requiresKiz ? `<p style="font-size:12px;color:var(--ink-faint);margin-top:10px">Этому заказу нужен КИЗ — привязать его можно будет позже, в «Режиме сборки» на вкладке «На сборке».</p>` : ''}
      <p style="font-size:12px;color:var(--ink-faint);margin-top:10px">Товар спишется с остатков этого клиента, как только заказ уйдёт на сборку.</p>
      <button class="btn btn-ghost" style="margin-top:10px" onclick="cancelAssembleOrder()">Отмена</button>
    </div>
  `;
  const bcInput = document.getElementById('fbsScanBarcode');
  bcInput.focus();
  bcInput.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter') return;
    const code = bcInput.value.trim();
    bcInput.value='';
    if(!code) return;
    if(order.barcode && code!==order.barcode){
      playBeep('error');
      toast('Штрихкод не совпадает с товаром этого заказа');
      return;
    }
    playBeep('ok');
    finishAssembleOrder(order, null);
  });
}
function cancelAssembleOrder(){
  assemblingOrder = null;
  fbsPendingKiz = null;
  renderFbsBody();
}
async function hideFbsOrder(orderId){
  if(!await customConfirm('Убрать этот заказ из списка только у нас? У Wildberries и у клиента заказ останется как есть — его должен собрать тот, кто отвечает за нужный склад.')) return;
  fbsOrders = fbsOrders.filter(o=>o.orderId!==orderId);
  fbsSelectedOrders = fbsSelectedOrders.filter(id=>id!==orderId);
  toast('Заказ убран из списка (у WB не тронут)');
  renderFbsBody();
  sb.from('wb_orders').delete().eq('order_id', orderId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить локально в базе'); }
  });
}
async function hideOrdersFromOtherWarehouse(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client || !client.wbWarehouseId){ toast('У клиента не указан ID склада WB'); return; }
  const toRemove = fbsOrders.filter(o=>o.clientId===clientId && o.supplierStatus==='new' && o.wbWarehouseId && String(o.wbWarehouseId)!==String(client.wbWarehouseId));
  if(!toRemove.length){ toast('Таких заказов не найдено'); return; }
  if(!await customConfirm(`Убрать из списка ${toRemove.length} заказ(ов) с других складов? У Wildberries они останутся как есть.`)) return;
  const idsToRemove = toRemove.map(o=>o.orderId);
  fbsOrders = fbsOrders.filter(o=>!idsToRemove.includes(o.orderId));
  fbsSelectedOrders = fbsSelectedOrders.filter(id=>!idsToRemove.includes(id));
  toast(`Убрано из списка: ${idsToRemove.length}`);
  renderFbsBody();
  sb.from('wb_orders').delete().in('order_id', idsToRemove).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить часть заказов в базе'); }
  });
}
function renderKizStatusLabel(o){
  if(!o.requiresKiz && !o.kizCode) return '';
  // «pending» — штатное «идёт проверка», его пугающим английским словом не показываем; прочие ответы WB — как есть
  const why = (o.kizDecision && o.kizDecision!=='pending') ? ` <span style="font-weight:400;font-size:11px">(WB: ${escapeHtml(o.kizDecision)})</span>` : '';
  if(o.kizStatus==='attached') return ' · <span style="color:var(--ok);font-weight:700">✅ КИЗ подтверждён WB</span>';
  if(o.kizStatus==='pending') return ` · <span style="color:var(--ink-soft)">⏳ WB проверяет маркировку…${why}</span>`;
  if(o.kizStatus==='verify_failed') return ` · <span style="color:var(--warn);font-weight:700">⚠ WB не подтвердил КИЗ${why}</span>`;
  if(o.kizCode) return ' · КИЗ отправлен, статус не проверен';
  return o.requiresKiz ? ' · <span style="color:var(--warn)">КИЗ не прикреплён ⚠</span>' : '';
}
function renderFbsWarehouseBadge(o){
  const client = clients.find(c=>c.id===o.clientId);
  const matches = client && client.wbWarehouseId && String(client.wbWarehouseId)===String(o.wbWarehouseId);
  const mismatches = client && client.wbWarehouseId && !matches;
  const color = matches ? 'var(--ok)' : (mismatches ? 'var(--warn)' : 'var(--ink-faint)');
  const mark = matches ? ' ✓ наш' : (mismatches ? ' ⚠ чужой' : '');
  return ` · <span style="color:${color};font-weight:${matches||mismatches?'700':'400'}">склад ${escapeHtml(o.wbWarehouseId)}${mark}</span>`;
}
function toggleFbsSelected(orderId, checked){
  if(checked){ if(!fbsSelectedOrders.includes(orderId)) fbsSelectedOrders.push(orderId); }
  else{ fbsSelectedOrders = fbsSelectedOrders.filter(id=>id!==orderId); }
  renderFbsBody();
}
function toggleAllFbsSelected(checked){
  const clientId = document.getElementById('fbsClientSelect').value;
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='new');
  fbsSelectedOrders = checked ? rows.map(o=>o.orderId) : [];
  renderFbsBody();
}
async function bulkAssembleSelectedFbsOrders(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='new' && fbsSelectedOrders.includes(o.orderId));
  const withoutKiz = rows.filter(o=>!o.requiresKiz);
  const withKiz = rows.filter(o=>o.requiresKiz);
  if(!withoutKiz.length){
    toast('Все выбранные заказы требуют КИЗ — соберите их по одному кнопкой «Собрать»');
    return;
  }
  toast(`Собираем ${withoutKiz.length} заказ(ов)…`);
  for(const order of withoutKiz){
    try{ await finishAssembleOrder(order, null, true); }
    catch(e){ console.error(e); toast(`Ошибка при сборке заказа №${order.orderId}: ${e.message||e}`); }
    await new Promise(resolve=>setTimeout(resolve, 300));
  }
  fbsSelectedOrders = withKiz.map(o=>o.orderId);
  if(withKiz.length){
    toast(`Готово. Осталось собрать с КИЗ вручную: ${withKiz.length}`);
    renderFbsBody();
  } else {
    setFbsView('confirm');
  }
}
async function extractEdgeFunctionError(data, error, fallback){
  let msg = data && data.error ? data.error : (error ? error.message : (fallback||'ошибка'));
  if(error && error.context){
    try{ const body = await error.context.clone().json(); if(body && body.error) msg = body.error; }
    catch(e){ try{ const text = await error.context.clone().text(); if(text) msg = text; }catch(e2){} }
  }
  return msg;
}
function finishAssembleOrder(order, kizCode, skipViewSwitch){
  const client = clients.find(c=>c.id===order.clientId);
  const inv = order.barcode ? findInventoryItemByBarcode(order.barcode, order.clientName) : findInventoryItem(order.article, order.clientName, order.size||'');
  const available = inv ? (inv.isKit && inv.kitMode!=='assembled' ? computeKitAvailability(inv).available : inv.qty) : 0;
  if(!inv || available < 1){
    toast(`Недостаточно на складе «${order.name||order.article}» — нет в остатках`);
    return;
  }
  deductStockForShipment(inv, 1, `Сборка заказа FBS №${order.orderId}`);
  if(inv.dims && inv.dims.l && inv.dims.w && inv.dims.h){
    const liters = (inv.dims.l * inv.dims.w * inv.dims.h) / 1000;
    const tariffPrice = getFbsTariffPrice(order.clientId, liters);
    if(tariffPrice !== null){
      const ddsId = 'FBS-SHIP-' + order.orderId;
      if(!ddsEntries.find(d=>d.id===ddsId)){
        const description = `Отгрузка FBS №${order.orderId} · ${liters.toFixed(2)} л`;
        const entry = {id:ddsId, type:'income', category:'Отгрузка FBS', amount:tariffPrice, description, clientId:order.clientId, clientName:order.clientName, date:new Date().toISOString().slice(0,10), warehouseId: inv.warehouseId||'MAIN', createdAt:new Date().toISOString()};
        ddsEntries.unshift(entry);
        sb.from('dds_entries').insert({id:ddsId, type:'income', category:'Отгрузка FBS', amount:tariffPrice, description, client_id:order.clientId, client_name:order.clientName, date:entry.date, warehouse_id: inv.warehouseId||'MAIN', employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
          if(error) console.error(error);
        });
      }
    }
  }
  assemblingOrder = null;
  toast(`Заказ №${order.orderId} отправлен на сборку`);
  renderFbsBody();

  return sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'assemble', orderId: order.orderId, kizCode } }).then(async ({data, error})=>{
    if(error || (data && data.error)){
      const msg = await extractEdgeFunctionError(data, error);
      toast('WB (сборка): ' + msg);
      return;
    }
    order.supplierStatus = 'confirm';
    order.wbSupplyId = data.wbSupplyId;
    order.kizCode = kizCode;
    order.kizStatus = data.kizStatus || null;
    sb.from('wb_orders').update({supplier_status:'confirm', wb_supply_id:data.wbSupplyId, kiz_code:kizCode, kiz_status:data.kizStatus||null}).eq('order_id', order.orderId).then(({error})=>{ if(error) console.error(error); });
    if(data.kizStatus === 'attached') toast(`Заказ №${order.orderId}: КИЗ прикреплён и подтверждён у WB ✅`);
    else if(data.kizStatus === 'pending'){ toast(`Заказ №${order.orderId}: КИЗ отправлен, WB ещё проверяет — можно продолжать ⏳`); watchPendingKiz(order); }
    else if(data.kizStatus === 'verify_failed') toast(`Заказ №${order.orderId}: собран, но КИЗ WB не подтвердил — ${data.warning||'проверьте вручную'} ⚠`);
    if(skipViewSwitch) renderFbsBody();
    else if(fbsView!=='confirm') setFbsView('confirm');
    else renderFbsBody();
  });
}
async function cancelFbsOrder(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  if(!await customConfirm(`Отменить заказ №${orderId}?`)) return;
  const wasConfirmed = order.supplierStatus === 'confirm';
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'cancel', orderId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    // Если заказ уже был собран (стало быть, остаток уже списался при сборке) и товар
    // не был отмечен как «нет на складе» — значит, он реально стоит на полке, возвращаем.
    // Если он был отмечен «нет на складе» — виртуальную единицу не возвращаем, её и так
    // физически не было, восстановление тут создало бы фантомный остаток.
    if(wasConfirmed && !order.outOfStock){
      const inv = order.barcode ? findInventoryItemByBarcode(order.barcode, order.clientName) : findInventoryItem(order.article, order.clientName, order.size||'');
      if(inv) logMovement(inv.sku, inv.name, 1, `Возврат остатка — отмена собранного заказа FBS №${orderId}`, inv.client, inv.size);
    }
    order.supplierStatus = 'cancel';
    fbsOrders = fbsOrders.filter(o=>o.orderId!==orderId);
    sb.from('wb_orders').update({supplier_status:'cancel'}).eq('order_id', orderId).then(()=>{});
    toast(`Заказ №${orderId} отменён${(wasConfirmed && !order.outOfStock) ? ' — остаток возвращён на склад' : ''}`);
    renderFbsBody();
  });
}
// ---------- ОТГРУЗКА ПОСТАВКИ FBS: грузоместа → данные о доставке → передача в доставку ----------
// WB не примет поставку в ПВЗ/ППТ/ПФЦ без грузомест (одно на короб, QR-код на каждом коробе), а передать поставку в
// доставку нельзя без пункта отгрузки, способа доставки и даты. Всё это собрано в одном окне — как в кабинете WB.
// Серверная часть — функция wb-supply-ts (доступна только вошедшим сотрудникам).
const SHIP_CARGO_NAMES = {1:'МГТ', 2:'СГТ', 3:'КГТ+'};
const SHIP_POINT_TYPES = {pp:'ПВЗ', sc:'СЦ', sw:'Склад'};
let shipState = null;

async function supplyCall(clientId, action, extra){
  const { data, error } = await sb.functions.invoke('wb-supply-ts', { body: Object.assign({clientId, action}, extra||{}) });
  if(error) throw new Error(await extractFnErrorMessage(error));
  if(data && data.error){ const e = new Error(data.error); e.payload = data; throw e; }
  return data;
}
function shipBoxNo(id){ return String(id).replace(/^WB-(?:MP|TRBX)-/, ''); }
// по правилам WB грузомест не больше, чем половина заказов (но хотя бы одно)
function shipMaxBoxes(orders){ return Math.max(1, Math.floor(orders/2)); }
function shipDateStr(d){ const p = n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function shipOrdersCount(){
  const st = shipState;
  if(!st) return 0;
  return (st.orderIds && st.orderIds.length) ? st.orderIds.length : (st.orders||[]).length;
}
function shipRoom(){ const st = shipState; return Math.max(0, shipMaxBoxes(shipOrdersCount()) - st.trbxes.length); }

// ----- QR грузомест: печать на этикетки 58×40 мм -----
async function shipPrintStickers(clientId, ids){
  if(!ids || !ids.length){ toast('Сначала создайте грузоместа'); return; }
  toast('Запрашиваем QR грузомест у WB…');
  let data;
  try{ data = await supplyCall(clientId, 'box_stickers', {trbxIds: ids, stickerType:'svg'}); }
  catch(e){ toast('WB: ' + e.message); return; }
  const stickers = data.stickers || [];
  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал окно печати — разрешите всплывающие окна для сайта'); return; }
  // в стикере от WB нет номера короба, только закодированное значение (…:номер) — сопоставляем по нему, иначе по порядку
  const labels = ids.map((id, i)=>{
    const no = shipBoxNo(id);
    const s = stickers.find(x=>String(x.barcode||'').split(':').pop()===no) || stickers[i];
    return s && s.file
      ? `<div class="lbl"><img src="data:image/svg+xml;base64,${s.file}" alt="Грузоместо ${escapeHtml(no)}"></div>`
      : `<div class="lbl"><div class="miss">QR грузоместа ${escapeHtml(no)} не получен от WB</div></div>`;
  }).join('');
  win.document.write(`<html><head><title>QR грузомест</title><style>
    @page{size:58mm 40mm;margin:0}
    html,body{margin:0;padding:0;background:#fff}
    .lbl{width:58mm;height:40mm;page-break-after:always;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .lbl:last-child{page-break-after:auto}
    .lbl img{width:58mm;height:40mm;object-fit:contain}
    .miss{font:12px Arial;color:#c00;padding:6px;text-align:center}
    .note{font:13px Arial;padding:10px 14px;background:#FFF6D6;border-bottom:1px solid #E5D28A}
    @media print{.note{display:none}}
  </style></head><body><div class="note">Наклейте QR на <b>каждый короб</b> (не на заказ). Размер этикетки — 58×40 мм, выберите его в настройках печати.</div>${labels}
  <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 500); };<\/script></body></html>`);
  win.document.close();
}
function downloadFbsTrbxLabels(clientId){ shipPrintStickers(clientId, fbsTrbxes.map(t=>t.id)); }

// ----- компактная панель на вкладке «На сборке» -----
function loadFbsTrbxes(clientId){
  supplyCall(clientId, 'boxes')
    .then(data=>{ fbsTrbxes = data.trbxes || []; })
    .catch(e=>{ console.error(e); fbsTrbxes = []; })
    .finally(()=>{ fbsTrbxLoadedFor = clientId; renderFbsBody(); });
}
function renderFbsTrbxPanel(clientId){
  const wrap = document.getElementById('fbsTrbxPanel');
  if(!wrap) return;
  wrap.innerHTML = `
    <div class="panel" style="padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-size:13px;max-width:640px">
        <b>Грузоместа поставки: ${fbsTrbxes.length}</b>
        <div style="font-size:12px;color:var(--ink-faint);line-height:1.5;margin-top:2px">Для отгрузки в ПВЗ, ППТ и ПФЦ нужны грузоместа — по одному на короб, QR на каждом коробе. Создаются и печатаются в окне «Отгрузка поставки».</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${fbsTrbxes.length ? `<button class="btn btn-ghost" onclick="downloadFbsTrbxLabels('${clientId}')">🖨 QR грузомест</button>` : ''}
        <button class="btn btn-accent" onclick="closeFbsSupply('${clientId}')">📦 Отгрузка поставки…</button>
      </div>
    </div>`;
}
// в API WB привязки конкретного заказа к грузоместу больше нет — заказы раскладываются по коробам физически
function renderTrbxAssignControl(o){ return ''; }

// ----- окно «Отгрузка поставки» -----
function closeSupplyShipment(){
  const o = document.getElementById('shipOverlay');
  if(o) o.remove();
  shipState = null;
}
async function openSupplyShipment(clientId, orders){
  closeSupplyShipment();
  const client = clients.find(c=>c.id===clientId);
  let city = 'Москва', filter = 'all';
  try{ city = localStorage.getItem('sklad42_ship_city') || 'Москва'; filter = localStorage.getItem('sklad42_ship_filter') || 'all'; }catch(e){}
  shipState = {
    clientId, clientName: client ? client.name : '', orders: orders || [],
    supply:null, trbxes:[], orderIds:[], fatal:false,
    points:null, pointsLoading:false, pointsError:'', pointId:null,
    shippingType:'selfShipping', shippingDt: shipDateStr(new Date()),
    city, query:'', typeFilter:filter, amount:1, busy:false, error:'', errorOrders:[]
  };
  const o = document.createElement('div');
  o.id = 'shipOverlay';
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9990;display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto';
  o.innerHTML = '<div id="shipBox" style="background:#fff;border-radius:14px;padding:22px;max-width:860px;width:100%"></div>';
  o.addEventListener('mousedown', e=>{ if(e.target===o && shipState && !shipState.busy) closeSupplyShipment(); });
  document.body.appendChild(o);
  shipRender();
  try{
    const data = await supplyCall(clientId, 'info');
    if(!shipState) return;
    if(!data.supply){ closeSupplyShipment(); toast('У клиента нет открытой поставки в WB — отгружать нечего'); return; }
    const st = shipState;
    st.supply = data.supply; st.trbxes = data.trbxes || []; st.orderIds = data.orderIds || [];
    if(data.supply.shippingType) st.shippingType = data.supply.shippingType;
    if(data.supply.shippingDt && data.supply.shippingDt >= shipDateStr(new Date())) st.shippingDt = data.supply.shippingDt;
    if(data.supply.shippingPointId) st.pointId = data.supply.shippingPointId;
    st.amount = Math.min(Math.max(1, shipRoom()), 1);
    shipRender();
    shipLoadPoints();
  }catch(e){
    if(!shipState) return;
    shipState.fatal = true; shipState.error = 'Не удалось получить поставку у WB: ' + e.message;
    shipRender();
  }
}
function shipRender(){
  const st = shipState, box = document.getElementById('shipBox');
  if(!box || !st) return;
  const head = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><div class="eyebrow">Заказы FBS · ${escapeHtml(st.clientName)}</div><h2 style="margin:2px 0 0 0;font-size:22px">Отгрузка поставки</h2></div>
      <button class="btn btn-ghost" onclick="closeSupplyShipment()" ${st.busy?'disabled':''}>✕ Закрыть</button></div>`;
  if(st.fatal){ box.innerHTML = head + `<p style="margin-top:16px;color:var(--warn);font-size:13px">${escapeHtml(st.error)}</p>`; return; }
  if(!st.supply){ box.innerHTML = head + `<p style="margin-top:20px;font-size:13px;color:var(--ink-soft)">⏳ Запрашиваю поставку у WB…</p>`; return; }
  const n = shipOrdersCount();
  const mismatch = st.orders.length && st.orderIds.length && st.orders.length !== st.orderIds.length;
  box.innerHTML = `
    ${head}
    <div style="font-size:13px;color:var(--ink-soft);margin:12px 0 4px 0;line-height:1.7">
      <b style="color:var(--ink)">${escapeHtml(st.supply.name || 'Поставка')}</b> · <span class="mono">${escapeHtml(st.supply.id)}</span> ·
      ${SHIP_CARGO_NAMES[st.supply.cargoType] || 'МГТ'} · заказов: <b>${n}</b>
      ${mismatch ? `<div style="color:var(--warn);font-weight:600">⚠ В поставке у WB заданий: ${st.orderIds.length}, у нас на сборке выбрано: ${st.orders.length} — проверьте перед отгрузкой.</div>` : ''}
    </div>
    <div id="shipBoxes" style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px"></div>
    <div id="shipDelivery" style="margin-top:14px;padding:14px;border:1px solid var(--line);border-radius:10px">
      <div class="eyebrow">Данные о доставке</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:10px 0">
        <div style="font-size:13px">Способ:
          <label style="margin-left:8px"><input type="radio" name="shipType" value="selfShipping" ${st.shippingType==='selfShipping'?'checked':''} onchange="shipSet('shippingType',this.value)"> Своими силами</label>
          <label style="margin-left:8px"><input type="radio" name="shipType" value="transportCompany" ${st.shippingType==='transportCompany'?'checked':''} onchange="shipSet('shippingType',this.value)"> Транспортная компания</label>
        </div>
        <div style="font-size:13px">Дата отгрузки: <input class="search" type="date" min="${shipDateStr(new Date())}" value="${escapeHtml(st.shippingDt)}" onchange="shipSet('shippingDt',this.value)" style="width:160px"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input class="search" id="shipCity" value="${escapeHtml(st.city)}" placeholder="Город" style="width:170px" oninput="shipSet('city',this.value,true)" onkeydown="if(event.key==='Enter') shipLoadPoints()">
        <button class="btn btn-ghost" onclick="shipLoadPoints()">Найти пункты</button>
        <input class="search" id="shipQuery" value="${escapeHtml(st.query)}" placeholder="Поиск по адресу или названию" style="flex:1;min-width:200px" oninput="shipOnQuery(this.value)">
        <span id="shipFilterChips"></span>
      </div>
      <div id="shipSelected" style="font-size:13px;margin:6px 0"></div>
      <div id="shipPointsList" style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:8px"></div>
    </div>
    <div id="shipFooter" style="margin-top:16px"></div>`;
  shipRenderBoxes();
  shipRenderPoints();
  shipRenderFooter();
}
function shipSet(key, value, silent){
  const st = shipState; if(!st) return;
  st[key] = value;
  if(!silent){ shipRenderFooter(); }
}
function shipRenderBoxes(){
  const st = shipState, el = document.getElementById('shipBoxes');
  if(!el || !st) return;
  const n = shipOrdersCount(), has = st.trbxes.length, room = shipRoom(), max = shipMaxBoxes(n);
  if(st.amount > Math.max(1, room)) st.amount = Math.max(1, room);
  el.innerHTML = `
    <div class="eyebrow">Грузоместа${has ? ` · создано: ${has}` : ''}</div>
    <p style="font-size:12px;color:var(--ink-soft);line-height:1.6;margin:6px 0 10px 0">
      Нужны, если поставка едет в <b>ПВЗ, ППТ или ПФЦ</b> — иначе её не примут. 1 грузоместо = 1 короб.
      В каждый короб — минимум 2 заказа (при нечётном количестве один можно добавить в последний короб).
      QR-код клеится на короб, а не на заказ. В поставке заказов: ${n} — можно создать не больше ${max} грузомест.
    </p>
    ${has ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        ${st.trbxes.map(t=>`<span class="status planned" style="cursor:default">Грузоместо №${escapeHtml(shipBoxNo(t.id))}</span>`).join('')}
        <button class="btn btn-accent" onclick="shipPrintStickers('${st.clientId}', shipState.trbxes.map(t=>t.id))">🖨 Печать QR (${has})</button>
        <button class="btn btn-ghost" style="color:var(--warn)" onclick="shipDeleteBoxes()" ${st.busy?'disabled':''}>Удалить все</button>
      </div>` : ''}
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="shipStep(-1)" ${st.amount<=1?'disabled':''}>−</button>
      <input class="search mono" id="shipAmount" type="number" min="1" max="${Math.max(1,room)}" value="${st.amount}" style="width:80px;text-align:center" oninput="shipSetAmount(this.value)">
      <button class="btn btn-ghost" onclick="shipStep(1)" ${st.amount>=room?'disabled':''}>＋</button>
      <button class="btn btn-accent" onclick="shipCreateBoxes()" ${(st.busy||room<1)?'disabled':''}>${has ? 'Добавить грузоместа' : 'Создать грузоместа'}</button>
      ${room<1 ? `<span style="font-size:12px;color:var(--ink-faint)">достигнут максимум для ${n} заказов</span>` : ''}
    </div>`;
}
function shipSetAmount(v){
  const st = shipState; if(!st) return;
  st.amount = Math.max(1, Math.min(Math.max(1, shipRoom()), parseInt(v) || 1));
}
function shipStep(d){
  const st = shipState; if(!st) return;
  st.amount = Math.max(1, Math.min(Math.max(1, shipRoom()), st.amount + d));
  shipRenderBoxes();
}
async function shipCreateBoxes(){
  const st = shipState; if(!st || st.busy) return;
  const amount = Math.max(1, Math.min(Math.max(1, shipRoom()), st.amount));
  st.busy = true; st.error = ''; shipRenderBoxes(); shipRenderFooter();
  try{
    await supplyCall(st.clientId, 'create_boxes', {amount});
    const data = await supplyCall(st.clientId, 'boxes');
    if(!shipState) return;
    shipState.trbxes = data.trbxes || [];
    fbsTrbxes = shipState.trbxes; fbsTrbxLoadedFor = st.clientId;
    toast(`Создано грузомест: ${amount} — напечатайте QR и наклейте на короба`);
  }catch(e){ if(shipState) shipState.error = e.message; }
  if(!shipState) return;
  shipState.busy = false; shipRenderBoxes(); shipRenderFooter();
}
async function shipDeleteBoxes(){
  const st = shipState; if(!st || st.busy || !st.trbxes.length) return;
  if(!await customConfirm(`Удалить все грузоместа (${st.trbxes.length}) этой поставки? Наклеенные на короба QR-коды станут недействительными.`)) return;
  const ids = st.trbxes.map(t=>t.id);
  st.busy = true; st.error = ''; shipRenderBoxes(); shipRenderFooter();
  try{
    await supplyCall(st.clientId, 'delete_boxes', {trbxIds: ids});
    if(!shipState) return;
    shipState.trbxes = []; fbsTrbxes = []; fbsTrbxLoadedFor = st.clientId;
  }catch(e){ if(shipState) shipState.error = e.message; }
  if(!shipState) return;
  shipState.busy = false; shipRenderBoxes(); shipRenderFooter();
}

// ----- пункты отгрузки -----
async function shipLoadPoints(){
  const st = shipState;
  if(!st || !st.supply) return;
  const city = (st.city || '').trim();
  if(!city){ st.pointsError = 'Укажите город'; shipRenderPoints(); return; }
  st.pointsLoading = true; st.pointsError = ''; shipRenderPoints();
  try{
    const data = await supplyCall(st.clientId, 'shipping_points', {city, cargoType: st.supply.cargoType});
    if(!shipState) return;
    shipState.points = data.points || [];
    try{ localStorage.setItem('sklad42_ship_city', city); }catch(e){}
  }catch(e){
    if(!shipState) return;
    shipState.points = []; shipState.pointsError = e.message;
  }
  shipState.pointsLoading = false;
  shipRenderPoints(); shipRenderFooter();
}
function shipOnQuery(v){ if(!shipState) return; shipState.query = v; shipRenderPoints(); }
function shipSetFilter(f){
  if(!shipState) return;
  shipState.typeFilter = f;
  try{ localStorage.setItem('sklad42_ship_filter', f); }catch(e){}
  shipRenderPoints();
}
function shipFilteredPoints(){
  const st = shipState;
  const words = (st.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const rec = st.supply ? st.supply.recommendedWhId : null;
  const list = (st.points || []).filter(p=>{
    if(st.typeFilter==='pp' && p.officeType!=='pp') return false;
    if(st.typeFilter==='sc' && p.officeType==='pp') return false;
    const hay = (String(p.address) + ' ' + String(p.name) + ' ' + p.id).toLowerCase();
    return words.every(w=>hay.includes(w));
  });
  const rank = p => (p.id===st.pointId ? 0 : (p.id===rec ? 1 : 2));
  const typeRank = {pp:0, sw:1, sc:2};
  return list.sort((a,b)=> rank(a)-rank(b) || (typeRank[a.officeType]??9)-(typeRank[b.officeType]??9) || String(a.address).localeCompare(String(b.address), 'ru'));
}
function shipPoint(){
  const st = shipState;
  return (st && st.points) ? st.points.find(p=>p.id===st.pointId) || null : null;
}
function shipPickPoint(id){
  const st = shipState; if(!st) return;
  st.pointId = id;
  shipRenderPoints(); shipRenderFooter();
}
function shipRenderPoints(){
  const st = shipState;
  const listEl = document.getElementById('shipPointsList');
  if(!listEl || !st) return;
  const chips = document.getElementById('shipFilterChips');
  if(chips) chips.innerHTML = [['all','Все'],['pp','ПВЗ'],['sc','СЦ и склады']].map(([k,t])=>
    `<button class="btn ${st.typeFilter===k?'btn-accent':'btn-ghost'}" style="padding:5px 10px;font-size:12px" onclick="shipSetFilter('${k}')">${t}</button>`).join(' ');
  const selEl = document.getElementById('shipSelected');
  if(selEl){
    const p = shipPoint();
    selEl.innerHTML = st.pointId
      ? `Выбрано: ${p ? `<b>${SHIP_POINT_TYPES[p.officeType]||p.officeType}</b> · ${escapeHtml(p.address)} <span class="mono" style="color:var(--ink-faint)">№${p.id}</span>` : `<b>пункт №${st.pointId}</b> <span style="color:var(--ink-faint)">(из текущих параметров поставки; в списке выбранного города его нет)</span>`}`
      : `<span style="color:var(--ink-faint)">Пункт отгрузки не выбран</span>`;
  }
  if(st.pointsLoading){ listEl.innerHTML = `<div style="padding:14px;font-size:13px;color:var(--ink-soft)">⏳ Загружаю пункты отгрузки…</div>`; return; }
  if(st.pointsError){ listEl.innerHTML = `<div style="padding:14px;font-size:13px;color:var(--warn)">${escapeHtml(st.pointsError)}</div>`; return; }
  if(!st.points){ listEl.innerHTML = ''; return; }
  const all = shipFilteredPoints();
  const rec = st.supply ? st.supply.recommendedWhId : null;
  const shown = all.slice(0, 60);
  listEl.innerHTML = (shown.length ? shown.map(p=>`
      <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-bottom:1px solid var(--line);cursor:pointer;${p.id===st.pointId?'background:var(--bg,#F3F0E8)':''}">
        <input type="radio" name="shipPoint" ${p.id===st.pointId?'checked':''} onchange="shipPickPoint(${p.id})">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${escapeHtml(p.address)}</div>
          <div style="font-size:11px;color:var(--ink-faint)">${SHIP_POINT_TYPES[p.officeType]||escapeHtml(p.officeType)} · №${p.id}${p.fulfillment?' · фулфилмент в СЦ':''}${p.id===rec?' · <span style="color:var(--accent);font-weight:700">★ рекомендует WB для этой поставки</span>':''}</div>
        </div>
      </label>`).join('') : `<div style="padding:14px;font-size:13px;color:var(--ink-faint)">Ничего не найдено — измените запрос, тип пункта или город.</div>`)
    + (all.length > shown.length ? `<div style="padding:10px 12px;font-size:12px;color:var(--ink-faint)">Показаны первые ${shown.length} из ${all.length} — уточните адрес в поиске.</div>` : '');
}

// ----- проверка и передача в доставку -----
function shipValidate(){
  const st = shipState;
  if(!st.pointId) return 'Выберите пункт отгрузки.';
  if(!st.shippingDt) return 'Укажите дату отгрузки.';
  if(st.shippingDt < shipDateStr(new Date())) return 'Дата отгрузки не может быть в прошлом.';
  const p = shipPoint();
  if(p && p.officeType==='pp' && st.supply.isPickupPointShipmentAllowed === false) return 'Эту поставку нельзя отгрузить в ПВЗ (ограничения по товарам) — выберите СЦ или склад.';
  if(p && (p.officeType==='pp' || p.fulfillment) && st.trbxes.length < 1) return 'Для отгрузки в этот пункт нужно создать грузоместа (минимум одно) и наклеить QR на короб — иначе WB не примет поставку.';
  return '';
}
function shipRenderFooter(){
  const st = shipState, el = document.getElementById('shipFooter');
  if(!el || !st) return;
  const problem = shipValidate();
  el.innerHTML = `
    ${st.error ? `<div style="padding:10px 12px;border-radius:8px;background:var(--warn-bg);color:var(--warn);font-size:13px;margin-bottom:10px;line-height:1.5">${escapeHtml(st.error)}
        ${st.errorOrders && st.errorOrders.length ? `<div style="margin-top:6px;font-size:12px">${st.errorOrders.slice(0,15).map(o=>`<div>Заказ <span class="mono">№${o.id}</span> — ${o.problems.map(escapeHtml).join('; ')}</div>`).join('')}${st.errorOrders.length>15?`<div>…и ещё ${st.errorOrders.length-15}</div>`:''}</div>` : ''}
      </div>` : ''}
    ${!st.error && problem ? `<div style="font-size:12px;color:var(--ink-faint);margin-bottom:8px">${escapeHtml(problem)}</div>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="closeSupplyShipment()" ${st.busy?'disabled':''}>Отмена</button>
      <button class="btn btn-primary" id="shipSubmitBtn" onclick="shipSubmit()" ${(st.busy||problem)?'disabled':''}>${st.busy ? '⏳ Передаю…' : '🚚 Передать в доставку'}</button>
    </div>`;
}
async function shipSubmit(){
  const st = shipState; if(!st || st.busy) return;
  const problem = shipValidate();
  if(problem){ st.error = problem; shipRenderFooter(); return; }
  st.busy = true; st.error = ''; st.errorOrders = [];
  shipRenderBoxes(); shipRenderFooter();
  try{
    await supplyCall(st.clientId, 'ship', {shippingType: st.shippingType, shippingDt: st.shippingDt, shippingPointId: st.pointId});
    const toClose = st.orders;
    toClose.forEach(o=>{ o.supplierStatus = 'complete'; });
    if(toClose.length) sb.from('wb_orders').update({supplier_status:'complete'}).in('order_id', toClose.map(o=>o.orderId)).then(()=>{});
    fbsCloseSelectedOrders = [];
    fbsTrbxes = [];
    fbsTrbxLoadedFor = '';
    closeSupplyShipment();
    toast('Поставка передана в доставку');
    setFbsView('complete');
  }catch(e){
    if(!shipState) return;
    shipState.busy = false;
    shipState.error = e.message;
    shipState.errorOrders = (e.payload && e.payload.orders) || [];
    shipRenderBoxes(); shipRenderFooter();
  }
}

async function closeFbsSupply(explicitClientId){
  const clientId = explicitClientId || document.getElementById('fbsClientSelect').value;
  const client = clients.find(c=>c.id===clientId);
  if(!clientId){ toast('Выберите конкретного клиента, чтобы закрыть его поставку'); return; }

  const allConfirmed = fbsOrders.filter(o=>o.clientId===clientId && o.supplierStatus==='confirm');
  const selected = fbsCloseSelectedOrders.filter(id=>allConfirmed.some(o=>o.orderId===id));
  const isPartial = selected.length>0 && selected.length<allConfirmed.length;
  const toClose = isPartial ? allConfirmed.filter(o=>selected.includes(o.orderId)) : allConfirmed;
  const toHold = isPartial ? allConfirmed.filter(o=>!selected.includes(o.orderId)) : [];

  const unpicked = toClose.filter(o=>!isOrderPicked(o) && !o.outOfStock);
  if(unpicked.length){
    const names = unpicked.slice(0,5).map(o=>`«${o.name||o.article}» (заказ №${o.orderId})`).join(', ');
    if(!await customConfirm(`⚠ Собрано ${toClose.length-unpicked.length} из ${toClose.length}. Не отсканировано заказов: ${unpicked.length} — ${names}${unpicked.length>5?` и ещё ${unpicked.length-5}`:''}.\n\nОтгружать всё равно?`)) return;
  }
  const missingKiz = toClose.filter(o=>o.requiresKiz && o.kizStatus!=='attached');
  if(missingKiz.length){
    const names = missingKiz.slice(0,5).map(o=>`«${o.name||o.article}» (заказ №${o.orderId})`).join(', ');
    const more = missingKiz.length>5 ? ` и ещё ${missingKiz.length-5}` : '';
    if(!await customConfirm(`⚠ У ${missingKiz.length} заказ(ов) не привязан КИЗ, хотя он требуется: ${names}${more}.\n\nОтгружать без КИЗ рискованно — WB может отклонить поставку или заблокировать продажу. Всё равно продолжить?`)) return;
  } else if(isPartial){
    if(!await customConfirm(`Отгрузить ${toClose.length} из ${allConfirmed.length} заказов клиента «${client?client.name:''}»? Остальные ${toHold.length} останутся в отдельной поставке до следующего раза.`)) return;
  }

  if(isPartial){
    toast(`Переносим ${toHold.length} заказ(ов) в отдельную поставку…`);
    for(const o of toHold){
      const { data, error } = await sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'move_to_holding_supply', orderId: o.orderId } });
      if(error || (data && data.error)){
        toast('WB: не удалось перенести заказ №' + o.orderId + ' — ' + (data && data.error ? data.error : (error?error.message:'ошибка')));
        return;
      }
      o.wbSupplyId = data.holdingSupplyId;
      sb.from('wb_orders').update({wb_supply_id:data.holdingSupplyId}).eq('order_id', o.orderId).then(()=>{});
    }
  }

  // дальше — окно «Отгрузка поставки»: грузоместа (для ПВЗ), пункт и дата отгрузки, передача в доставку
  openSupplyShipment(clientId, toClose);
}
function printFbsPickList(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const items = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm')
    .map(o=>({ order:o, pi:findLocalProductInfo(o) }))
    .sort((a,b)=>{
      if(a.pi.cell && b.pi.cell) return a.pi.cell - b.pi.cell;
      if(a.pi.cell) return -1;
      if(b.pi.cell) return 1;
      return (a.order.article||'').localeCompare(b.order.article||'') || (a.order.barcode||'').localeCompare(b.order.barcode||'');
    });
  if(!items.length){ toast('Нет заказов на сборке'); return; }
  const client = clients.find(c=>c.id===clientId);
  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна'); return; }
  win.document.write(`
    <html><head><title>Лист сборки</title>
    <style>
      body{font-family:Arial,sans-serif;padding:14px;font-size:11px;color:#111}
      h1{font-size:16px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #333;padding:5px 8px;text-align:left;vertical-align:middle}
      th{background:#f0f0f0}
      td.mono, th.mono{font-family:'Courier New',monospace}
      .barcode-tail{font-weight:bold;font-size:13px}
      @media print{ body{padding:6px} }
    </style>
    </head><body>
      <h1>Лист сборки${client?` · ${escapeHtml(client.name)}`:' (все клиенты)'} — ${items.length} поз. (по маршруту ячеек)</h1>
      <table>
        <thead><tr><th style="width:34px">№</th><th>Ячейка</th><th>Наименование</th><th>Цвет</th><th>Размер</th><th>Артикул</th><th>ШК</th><th>Номер заказа</th></tr></thead>
        <tbody>
          ${items.map(({order:it,pi},idx)=>{
            const bc = it.barcode || '';
            const bcHead = bc.length>4 ? bc.slice(0,-4) : '';
            const bcTail = bc.length>4 ? bc.slice(-4) : bc;
            const oid = String(it.orderId||'');
            const oidHead = oid.length>4 ? oid.slice(0,-4) : '';
            const oidTail = oid.length>4 ? oid.slice(-4) : oid;
            return `
            <tr>
              <td>${idx+1}</td>
              <td class="barcode-tail">${pi.cell||'—'}</td>
              <td>${escapeHtml(pi.name)}</td>
              <td>${escapeHtml(pi.color)||'—'}</td>
              <td>${escapeHtml(pi.size)||'—'}</td>
              <td class="mono">${escapeHtml(it.article||'')}</td>
              <td class="mono">${escapeHtml(bcHead)}<span class="barcode-tail">${escapeHtml(bcTail)}</span></td>
              <td class="mono">${escapeHtml(oidHead)}<span class="barcode-tail">${escapeHtml(oidTail)}</span></td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 400); };<\/script>
    </body></html>
  `);
  win.document.close();
}
function wrapTextManually(text, maxCharsPerLine){
  if(!text) return [''];
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for(const word of words){
    const candidate = current ? current + ' ' + word : word;
    if(candidate.length > maxCharsPerLine && current){
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    // отдельное слово длиннее целой строки — режем его насильно посимвольно
    while(current.length > maxCharsPerLine){
      lines.push(current.slice(0, maxCharsPerLine));
      current = current.slice(maxCharsPerLine);
    }
  }
  if(current) lines.push(current);
  return lines.length ? lines : [''];
}
async function previewThermalInfoCard(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm');
  if(!rows.length){ toast('Нет заказов на сборке для предпросмотра'); return; }
  const o = rows[0];
  const pi = findLocalProductInfo(o);
  const nameLines = wrapTextManually(pi.name||o.article, 22);
  const nameHtml = nameLines.map(line=>`<div>${escapeHtml(line)}</div>`).join('');
  const dpi203 = 203;
  const ptPx = (pt)=> Math.round(pt / 72 * dpi203);
  const mmPx = (mm)=> Math.round(mm / 25.4 * dpi203);
  const infoHtml = `
    <div style="padding:${mmPx(2)}px;box-sizing:border-box;font-family:Arial,sans-serif;overflow:hidden;width:100%;height:100%">
      <div style="font-size:${ptPx(11)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px">1 шт.</div>
      <div style="font-size:${ptPx(8)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px;line-height:1.2">${nameHtml}</div>
      <table style="width:100%;font-size:${ptPx(6.5)}px;border-collapse:collapse;table-layout:fixed">
        ${pi.cell?`<tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Ячейка</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${escapeHtml(String(pi.cell))}</td></tr>`:''}
        <tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Артикул</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${escapeHtml(o.article||'')}</td></tr>
        <tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">ШК</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${o.barcode||'—'}</td></tr>
      </table>
    </div>
  `;
  const labelSettingsPreview = getLabelSettings();
  const bitmapInfo = await htmlToMonoBitmap(infoHtml, labelSettingsPreview.widthMm, labelSettingsPreview.heightMm);
  // рисуем результат ещё раз как обычную картинку (не растр для принтера), чтобы можно было увидеть глазами
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = bitmapInfo.widthPx;
  previewCanvas.height = bitmapInfo.heightPx;
  const pctx = previewCanvas.getContext('2d');
  const imgData = pctx.createImageData(bitmapInfo.widthPx, bitmapInfo.heightPx);
  for(let y=0; y<bitmapInfo.heightPx; y++){
    for(let x=0; x<bitmapInfo.widthPx; x++){
      const byteIndex = y*bitmapInfo.bytesPerRow + Math.floor(x/8);
      const bitIndex = 7 - (x % 8);
      const bitSet = (bitmapInfo.bitmap[byteIndex] >> bitIndex) & 1;
      const idx = (y*bitmapInfo.widthPx + x) * 4;
      const val = bitSet ? 255 : 0; // bitSet=1 у нас сейчас означает "белый" (инвертированная логика для принтера)
      imgData.data[idx] = val; imgData.data[idx+1] = val; imgData.data[idx+2] = val; imgData.data[idx+3] = 255;
    }
  }
  pctx.putImageData(imgData, 0, 0);
  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна'); return; }
  win.document.write(`<html><head><title>Предпросмотр этикетки (${bitmapInfo.widthPx}×${bitmapInfo.heightPx}px)</title></head><body style="margin:0;background:#888;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="background:#fff;padding:10px"><img src="${previewCanvas.toDataURL()}" style="border:1px solid red;image-rendering:pixelated;width:200px"></div></body></html>`);
  win.document.close();
}
async function printAllFbsStickersToThermalPrinter(){
  const connected = await connectThermalPrinter();
  if(!connected) return;

  const clientId = document.getElementById('fbsClientSelect').value;
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm' && (!fbsCloseSelectedOrders.length || fbsCloseSelectedOrders.includes(o.orderId)))
    .sort((a,b)=> (a.clientName||'').localeCompare(b.clientName||'') || (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));
  if(!rows.length){ toast(fbsCloseSelectedOrders.length ? 'Среди выбранных нет заказов на сборке' : 'Нет заказов на сборке'); return; }

  const groups = {};
  rows.forEach(o=>{
    const key = o.clientId + '::' + (o.barcode || o.article || String(o.orderId));
    if(!groups[key]){
      const pi = findLocalProductInfo(o);
      groups[key] = { name:pi.name, article:o.article, size:pi.size, barcode:o.barcode, color:pi.color, cell:pi.cell, clientId:o.clientId, clientName:o.clientName, orders:[] };
    }
    groups[key].orders.push(o);
  });
  const groupList = Object.values(groups).sort((a,b)=>
    (a.clientName||'').localeCompare(b.clientName||'') ||
    (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||'')
  );

  const byClient = {};
  rows.forEach(o=>{ (byClient[o.clientId] = byClient[o.clientId] || []).push(o); });
  toast(`Запрашиваем этикетки у WB для ${rows.length} заказ(ов)…`);
  const calls = Object.entries(byClient).map(([cid, orders])=>
    sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action:'get_sticker', orderIds: orders.map(o=>o.orderId) } })
      .then(({data, error})=>({ orders, data, error }))
  );
  const results = await Promise.all(calls);
  const stickerByOrderId = {};
  let hadError = false;
  results.forEach(({orders, data, error})=>{
    if(error || (data && data.error)){ hadError = true; console.error(error||(data&&data.error)); return; }
    const stickers = data.stickers || [];
    stickers.forEach(s=>{ if(s && s.orderId != null && s.file) stickerByOrderId[s.orderId] = s.file; });
  });

  toast(`Печатаем на принтере: ${groupList.length} карточек товара…`);
  const dpi203 = 203;
  const ptPx = (pt)=> Math.round(pt / 72 * dpi203);   // 1 pt = 1/72 дюйма
  const mmPx = (mm)=> Math.round(mm / 25.4 * dpi203); // 1 мм = 1/25.4 дюйма
  for(const g of groupList){
    const nameLines = wrapTextManually(g.name||g.article, 22);
    const nameHtml = nameLines.map(line=>`<div>${escapeHtml(line)}</div>`).join('');
    const infoHtml = `
      <div style="padding:${mmPx(2)}px;box-sizing:border-box;font-family:Arial,sans-serif;overflow:hidden;width:100%;height:100%">
        <div style="font-size:${ptPx(11)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px">${g.orders.length} шт.</div>
        <div style="font-size:${ptPx(8)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px;line-height:1.2">${nameHtml}</div>
        <table style="width:100%;font-size:${ptPx(6.5)}px;border-collapse:collapse;table-layout:fixed">
          ${g.cell?`<tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Ячейка</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${escapeHtml(String(g.cell))}</td></tr>`:''}
          ${g.color?`<tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Цвет</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${escapeHtml(g.color)}</td></tr>`:''}
          ${g.size?`<tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Размер</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${escapeHtml(g.size)}</td></tr>`:''}
          <tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Артикул</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${escapeHtml(g.article||'')}</td></tr>
          <tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">ШК</td><td style="font-weight:bold;word-break:break-all;padding:${mmPx(0.4)}px 0">${g.barcode||'—'}</td></tr>
          <tr><td style="color:#666;white-space:nowrap;width:32%;padding:${mmPx(0.4)}px ${mmPx(1.2)}px ${mmPx(0.4)}px 0">Заказов</td><td style="font-weight:bold;padding:${mmPx(0.4)}px 0">${g.orders.length}</td></tr>
        </table>
      </div>
    `;
    const labelSettings = getLabelSettings();
    const bitmapInfo = await htmlToMonoBitmap(infoHtml, labelSettings.widthMm, labelSettings.heightMm);
    const ok1 = await printBitmapOnThermalPrinter(labelSettings.widthMm, labelSettings.heightMm, bitmapInfo);
    if(!ok1){ toast('Печать остановлена — проблема с принтером'); return; }
    for(const o of g.orders){
      const file = stickerByOrderId[o.orderId];
      if(!file) continue;
      const ok2 = await printSvgOnThermalPrinter(file, labelSettings.widthMm, labelSettings.heightMm);
      if(!ok2){ toast('Печать остановлена — проблема с принтером'); return; }
    }
  }
  toast(`Готово: напечатано на принтере ${groupList.length} карточек товара${hadError?' (у части клиентов была ошибка получения этикеток)':''}`);
}
function printAllFbsStickers(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm' && (!fbsCloseSelectedOrders.length || fbsCloseSelectedOrders.includes(o.orderId)))
    .sort((a,b)=> (a.clientName||'').localeCompare(b.clientName||'') || (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));
  if(!rows.length){ toast(fbsCloseSelectedOrders.length ? 'Среди выбранных нет заказов на сборке' : 'Нет заказов на сборке'); return; }

  const groups = {};
  rows.forEach(o=>{
    const key = o.clientId + '::' + (o.barcode || o.article || String(o.orderId));
    if(!groups[key]){
      const pi = findLocalProductInfo(o);
      groups[key] = { name:pi.name, article:o.article, size:pi.size, barcode:o.barcode, color:pi.color, cell:pi.cell, clientId:o.clientId, clientName:o.clientName, orders:[] };
    }
    groups[key].orders.push(o);
  });
  const groupList = Object.values(groups).sort((a,b)=>
    (a.clientName||'').localeCompare(b.clientName||'') ||
    (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||'')
  );

  const byClient = {};
  rows.forEach(o=>{ (byClient[o.clientId] = byClient[o.clientId] || []).push(o); });
  toast(`Запрашиваем этикетки у WB для ${rows.length} заказ(ов)…`);
  const calls = Object.entries(byClient).map(([cid, orders])=>
    sb.functions.invoke('wb-orders-ts', { body: { clientId: cid, action:'get_sticker', orderIds: orders.map(o=>o.orderId) } })
      .then(({data, error})=>({ orders, data, error }))
  );
  Promise.all(calls).then(results=>{
    const stickerByOrderId = {};
    let hadError = false;
    results.forEach(({orders, data, error})=>{
      if(error || (data && data.error)){ hadError = true; console.error(error||(data&&data.error)); return; }
      const stickers = data.stickers || [];
      stickers.forEach(s=>{ if(s && s.orderId != null && s.file) stickerByOrderId[s.orderId] = s.file; });
    });
    const orderedStickers = [];
    groupList.forEach(g=> g.orders.forEach(o=>{ if(stickerByOrderId[o.orderId]) orderedStickers.push(stickerByOrderId[o.orderId]); }));
    if(!orderedStickers.length){ toast('Не удалось получить ни одной этикетки' + (hadError?' — проверьте ключи WB клиентов':'')); return; }

    const win = window.open('', '_blank');
    if(!win){ toast('Браузер заблокировал открытие окна'); return; }
    win.document.write(`
      <html><head><title>Этикетки на сборку</title>
      <style>
        @page{ size: 40mm 58mm; margin: 0; }
        *{ box-sizing:border-box; }
        body{margin:0;padding:0;font-family:Arial,sans-serif}
        .info-label{width:40mm;min-height:58mm;padding:3mm;page-break-after:always}
        .qty{font-size:14pt;font-weight:bold;margin-bottom:2mm}
        .name{font-size:10pt;font-weight:bold;margin-bottom:2mm;line-height:1.3}
        table{width:100%;font-size:8pt;border-collapse:collapse}
        td{padding:0.7mm 0}
        td.label-cell{color:#666;white-space:nowrap;padding-right:2mm}
        td.value-cell{font-weight:bold;word-break:break-all}
        .qr-page{width:40mm;height:58mm;display:flex;align-items:center;justify-content:center;overflow:hidden;page-break-after:always}
        .qr-page:last-child{page-break-after:avoid}
        .qr-page img{width:58mm;height:40mm;transform:rotate(90deg);object-fit:contain}
      </style>
      </head><body>
        ${groupList.map(g=>{
          const groupStickers = g.orders.map(o=>stickerByOrderId[o.orderId]).filter(Boolean);
          return `
            <div class="info-label">
              <div class="qty">${g.orders.length} шт.</div>
              <div class="name">${escapeHtml(g.name||g.article)}</div>
              <table>
                ${g.cell?`<tr><td class="label-cell">Ячейка</td><td class="value-cell">${escapeHtml(String(g.cell))}</td></tr>`:''}
                ${g.color?`<tr><td class="label-cell">Цвет</td><td class="value-cell">${escapeHtml(g.color)}</td></tr>`:''}
                ${g.size?`<tr><td class="label-cell">Размер</td><td class="value-cell">${escapeHtml(g.size)}</td></tr>`:''}
                <tr><td class="label-cell">Артикул</td><td class="value-cell">${escapeHtml(g.article||'')}</td></tr>
                <tr><td class="label-cell">ШК</td><td class="value-cell">${g.barcode||'—'}</td></tr>
                <tr><td class="label-cell">Заказов</td><td class="value-cell">${g.orders.length}</td></tr>
              </table>
            </div>
            ${groupStickers.map(file=>`<div class="qr-page"><img src="data:image/svg+xml;base64,${file}"></div>`).join('')}
          `;
        }).join('')}
        <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 400); };<\/script>
      </body></html>
    `);
    win.document.close();
    toast(`Готово: ${groupList.length} карточек товара, ${orderedStickers.length} QR-стикеров${hadError?' (у части клиентов была ошибка получения)':''}`);
  });
}
function timeAgoRu(isoString){
  if(!isoString) return '';
  const diffMs = Date.now() - new Date(isoString).getTime();
  if(diffMs < 0) return '';
  const mins = Math.floor(diffMs / 60000);
  if(mins < 1) return 'только что';
  if(mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if(hours < 24) return `${hours} ч ${mins%60} мин назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}
function findLocalProductInfo(order){
  const item = order.barcode ? inventory.find(i=>i.barcode===order.barcode && i.client===order.clientName) : null;
  return {
    name: (item && item.name) || order.name || order.article || '',
    color: (item && item.color) || '',
    size: order.size || (item && item.size) || '',
    cell: (item && item.cell) || null
  };
}
function findLocalColor(order){
  const item = order.barcode ? inventory.find(i=>i.barcode===order.barcode && i.client===order.clientName) : null;
  return item ? (item.color || '') : '';
}

// ---------- Печать на локальный принтер через QZ Tray (TSPL2, напр. Xprinter XP-420B) ----------
const QZ_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDqzCCApOgAwIBAgIUQrP0nY+6LZuJODIPEuL5iwxLV/gwDQYJKoZIhvcNAQEL
BQAwZTELMAkGA1UEBhMCUlUxDzANBgNVBAgMBlJ1c3NpYTENMAsGA1UEBwwEQ2l0
eTERMA8GA1UECgwIVGVsZVBhY2sxDDAKBgNVBAsMA1dNUzEVMBMGA1UEAwwMdGVs
ZXBhY2std21zMB4XDTI2MDkxNDEwMzEwM1oXDTM2MDkxMTEwMzEwM1owZTELMAkG
A1UEBhMCUlUxDzANBgNVBAgMBlJ1c3NpYTENMAsGA1UEBwwEQ2l0eTERMA8GA1UE
CgwIVGVsZVBhY2sxDDAKBgNVBAsMA1dNUzEVMBMGA1UEAwwMdGVsZXBhY2std21z
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5UpUSbzFCoEjfpWR0KT7
jvEb/XyivisiCEe95iMbdKtJ0PES1qzGfXjP/jZjUwsLWWjLhW790ghKn1vHVAD+
vHwJmU/0KEpYgOIg9yQ/YczmnSuIuFNHRgI00qrIhjZiktSB3QdjF0hq5Mw0PEsc
99d0lpFv/EphfHq74SHxEhpePM33t+kg332154KX6BkFnqKzc6jNAQl9UXi2caQR
Qh8E4eDnZ8/Q5zOCqFemErDjlF/hIJxq8hopg9ni0CmQaQMRTmCU5v5Rhm6N5vh5
QJ4IMPrPwu013s7rrO/OFag9slHyyfTiNc7CtTbuz0wYZnSrwOg5FEk05Zcw9E6C
+QIDAQABo1MwUTAdBgNVHQ4EFgQU7vjREV45b7E4Ca0ESzup0K6yx6IwHwYDVR0j
BBgwFoAU7vjREV45b7E4Ca0ESzup0K6yx6IwDwYDVR0TAQH/BAUwAwEB/zANBgkq
hkiG9w0BAQsFAAOCAQEAt/KGpHIHsGQX9CU8NkWY49lDqwxYxHRQQiIr0iprM6cT
79COfyOeQZNo/qwXzryt8jYzBv9S8qktjboWZgRKNCXIwXTx5yjC04BYD1f4Xsrr
+nAVCztWbRBY8ojcbH1X9/rGxsAMiua0MBYNoTBKm6O70QvPjiue7f+tRZPDyqyT
g+C152+ov4/uzlYocz95Th0NlDvGmw5bIbEuyJFJlzmFk3byk7Rnes5FaZZ7H601
9PRYFdYDUBbkGUMvHBWRLjz2X4QhrXhUfC1yEuTxD89+QTAA0YgdsgYebd2mLMlZ
VzXH8SD0MrPnj70qaChRfsZSp/DYaA9YAc9O2mZZ2A==
-----END CERTIFICATE-----`;
const QZ_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDlSlRJvMUKgSN+
lZHQpPuO8Rv9fKK+KyIIR73mIxt0q0nQ8RLWrMZ9eM/+NmNTCwtZaMuFbv3SCEqf
W8dUAP68fAmZT/QoSliA4iD3JD9hzOadK4i4U0dGAjTSqsiGNmKS1IHdB2MXSGrk
zDQ8Sxz313SWkW/8SmF8ervhIfESGl48zfe36SDffbXngpfoGQWeorNzqM0BCX1R
eLZxpBFCHwTh4Odnz9DnM4KoV6YSsOOUX+EgnGryGimD2eLQKZBpAxFOYJTm/lGG
bo3m+HlAnggw+s/C7TXezuus784VqD2yUfLJ9OI1zsK1Nu7PTBhmdKvA6DkUSTTl
lzD0ToL5AgMBAAECggEACu/OsW21oFikjscnm2IjNaA+i4rEYHnCN87kOfP2vUvm
S3cURPUcyqNWmHOTrURbmDotawHuTXRjytIf4dviSq9H7e4oYTuamRswI1mxREL3
xQtsjA482hQE3P+UbQJvFT3Zq+dMTLIBl0Q+QZn7mb7HKt9pDgmmOL/J8mUiEJDm
SQmg7JQYIbopmuJNTcquZZA1hhTASo0Ydf39PuymKgU4L+Y9FxlYtl8/nr4nlA3d
y4arMlxkdtLqDwfgYK+sKyRwgKv4Fp3US0mhC+ep2LikjnY9oOqcnHIYKNkUHqm5
YXtXsBsEYADHRMm5fCK2j8aAawPRESLg68gJRYpK4QKBgQD7QyxABPzNdT/SbYNS
PyukH362PGif59orUaWpz560sVp30vZ2bTf65sZqSaQ23Ra4r0PttJvPwBIdqWoc
F4o/Q+7/PEHzIMYhJDXUS/If4DL7WrH/A2132jh1rq6RHPTl1HLNTHICy9eocYB1
HMaHthKFiWyxsjlztPSzycoo3QKBgQDpnRlJIBYIlCWz5Hd6EHE25E/LkH4OsOcB
0W+HZhVS2OKB1D61/NmxqfMS9zSi8vxz1IdWGfp6gIldwGZTNHEPEltY5lmIgMfB
kmGlAalWj4yFny+/no7ZcphgdbfnqMj1qL7I1OqCyld4Jnot4AnZNPbaQkX2rjor
wvuAzdlSzQKBgQDBvgwS2UWtj2lE8ti9xKP8C6UDFBWAp6CconphNAymO9MMbglJ
S/JMb0IzltEe1N++TLbOReOXD/1oDcgaHTSmj9VrzaT0uiLMT0WKi30JgzEMi+SQ
RK5WKlg6thU5I+DajzRuhTGsYk3KPqrUovmaj5Q8j7jWVBzk0XWWZFSTqQKBgFEM
aOZe1GYbh80WmYDmzXB+21RDiAhuxWZzE9+EwichCcyDJ1KaK6igzq0oyMEzzfQd
quprTuRLTd0R0C5Txlm1Q63fFPbvvt3gfDH0FpzqZpVBOh6f0u2L/WOR08DyZO4d
ojso60d/DcOojcD2tlP+NRpZ3c4MejAOkJUKVbiNAoGBAJ5gtO4bN16X4ecKEwLW
vJmR359N42uYaEPX7oRVyz4iQQ0vdowqeVi8otwfqW7/k4vjSmh57KJPF3r204rI
fFujtmYIHlzbLVhCyyy8AN0q+Zs+k6B/W39pqOPABBZ9XkekQQFlP/Xh7uHwjqy3
slZXD2BF2QqR48gNcGOBexdQ
-----END PRIVATE KEY-----`;
let qzSigningConfigured = false;
function setupQzSigning(){
  if(qzSigningConfigured || !window.qz) return;
  qz.security.setCertificatePromise(function(resolve){ resolve(QZ_CERT_PEM); });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise(function(toSign){
    return function(resolve, reject){
      try{
        const pk = KEYUTIL.getKey(QZ_PRIVATE_KEY_PEM);
        const sig = new KJUR.crypto.Signature({alg:'SHA512withRSA'});
        sig.init(pk);
        sig.updateString(toSign);
        const hex = sig.sign();
        resolve(stob64(hextorstr(hex)));
      }catch(err){
        console.error(err);
        reject(err);
      }
    };
  });
  qzSigningConfigured = true;
}
async function connectThermalPrinter(){
  if(!window.qz){ toast('Библиотека QZ Tray не загрузилась — проверьте интернет-соединение и обновите страницу'); return false; }
  setupQzSigning();
  try{
    if(qz.websocket.isActive()) return true;
    await qz.websocket.connect();
    toast('QZ Tray подключён');
    return true;
  }catch(e){
    toast('Не удалось подключиться к QZ Tray — убедитесь, что программа запущена на компьютере (значок в трее). Ошибка: ' + (e.message||e));
    return false;
  }
}
// Своё окно подтверждения вместо браузерного confirm() — тот стандартный серый
// попап "ОК/Отмена" выбивается из стиля приложения и особенно плохо смотрится
// на телефоне. Возвращает Promise<boolean> — использовать как
// `if(!await customConfirm('...')) return;` вместо `if(!confirm('...')) return;`
// (содержащая функция должна быть async).
function customConfirm(message, options={}){
  return new Promise((resolve)=>{
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    const danger = options.danger !== false; // по умолчанию акцентная кнопка — т.к. обычно это подтверждение удаления/отмены
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;max-width:420px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.2)">
        <div style="font-size:14px;line-height:1.6;margin-bottom:18px;white-space:pre-line">${escapeHtml(message)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-ghost" id="customConfirmCancel">${options.cancelText||'Отмена'}</button>
          <button class="btn ${danger?'btn-accent':'btn-primary'}" id="customConfirmOk">${options.okText||'Да'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result)=>{ overlay.remove(); resolve(result); };
    overlay.querySelector('#customConfirmOk').onclick = ()=>cleanup(true);
    overlay.querySelector('#customConfirmCancel').onclick = ()=>cleanup(false);
    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) cleanup(false); });
    document.addEventListener('keydown', function escHandler(e){
      if(e.key==='Escape'){ cleanup(false); document.removeEventListener('keydown', escHandler); }
    });
  });
}
// Заметное окно для сообщений, которые нельзя пропустить (звук в шумном складе слышно не всегда).
// Закрывается только кнопкой «Понятно» или Esc — не по клику мимо окна, чтобы не закрыть случайно.
function showScanAlert(opts){
  const prev = document.getElementById('scanAlertOverlay');
  if(prev) prev.remove(); // повторные сканы не копят окна друг на друге
  const overlay = document.createElement('div');
  overlay.id = 'scanAlertOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  const color = opts.tone==='ok' ? 'var(--ok)' : 'var(--warn)';
  overlay.innerHTML = `
    <div role="alertdialog" aria-modal="true" style="background:#fff;border-radius:14px;padding:26px 24px;max-width:460px;width:100%;box-shadow:0 12px 48px rgba(0,0,0,0.3);border-top:8px solid ${color};text-align:center">
      <div style="font-size:44px;line-height:1">${opts.icon||'⚠️'}</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:700;text-transform:uppercase;margin:10px 0 8px;color:${color}">${escapeHtml(opts.title||'')}</div>
      ${opts.subject ? `<div style="font-size:17px;font-weight:600;margin-bottom:8px">${escapeHtml(opts.subject)}</div>` : ''}
      ${opts.message ? `<div style="font-size:14px;color:var(--ink-soft);line-height:1.6;margin-bottom:20px;white-space:pre-line">${escapeHtml(opts.message)}</div>` : ''}
      <button class="btn btn-accent" id="scanAlertOk" style="width:100%;justify-content:center;padding:14px;font-size:16px">Понятно</button>
    </div>`;
  document.body.appendChild(overlay);
  const openedAt = Date.now();
  const onKey = (e)=>{ if(e.key==='Escape'){ e.preventDefault(); close(); } };
  const close = ()=>{
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    if(opts.onClose) opts.onClose();
  };
  document.addEventListener('keydown', onKey, true);
  const ok = overlay.querySelector('#scanAlertOk');
  // Enter от сканера, который только что вызвал это окно, не должен сразу его «нажать»
  ok.onclick = ()=>{ if(Date.now()-openedAt < 400) return; close(); };
  setTimeout(()=>ok.focus(), 0);
}
async function getQzPrinterName(){
  let stored = null;
  try{ stored = localStorage.getItem('teleshop_qz_printer_name'); }catch(e){}
  if(stored) return stored;
  let printers;
  try{ printers = await qz.printers.find(); }catch(e){ toast('Не удалось получить список принтеров: ' + (e.message||e)); return null; }
  if(!printers || !printers.length){ toast('QZ Tray не видит ни одного принтера — проверьте, что принтер включён и подключён'); return null; }
  const list = Array.isArray(printers) ? printers : [printers];
  return new Promise((resolve)=>{
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;max-width:380px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.2)">
        <div style="font-weight:700;font-size:15px;margin-bottom:4px">Выберите принтер для этикеток</div>
        <div style="font-size:12px;color:var(--ink-faint);margin-bottom:14px">Выбор запомнится на этом компьютере — больше спрашивать не будет.</div>
        <select id="qzPrinterSelect" class="search" style="width:100%;margin-bottom:16px">
          ${list.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
        </select>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn btn-ghost" id="qzPrinterCancel">Отмена</button>
          <button class="btn btn-primary" id="qzPrinterConfirm">Выбрать</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('qzPrinterConfirm').onclick = ()=>{
      const chosen = document.getElementById('qzPrinterSelect').value;
      document.body.removeChild(overlay);
      try{ localStorage.setItem('teleshop_qz_printer_name', chosen); }catch(e){}
      resolve(chosen);
    };
    document.getElementById('qzPrinterCancel').onclick = ()=>{
      document.body.removeChild(overlay);
      resolve(null);
    };
  });
}
function forgetQzPrinter(){
  try{ localStorage.removeItem('teleshop_qz_printer_name'); }catch(e){}
  toast('Принтер сброшен — при следующей печати выбор появится заново');
}
function getLabelSettings(){
  const defaults = { widthMm: 40, heightMm: 58, qrRotation: 90, textRotation: 180 };
  try{
    const stored = localStorage.getItem('teleshop_label_settings');
    if(stored) return Object.assign({}, defaults, JSON.parse(stored));
  }catch(e){}
  return defaults;
}
function saveLabelSettings(settings){
  try{ localStorage.setItem('teleshop_label_settings', JSON.stringify(settings)); }catch(e){}
}
function openLabelSettingsModal(){
  const s = getLabelSettings();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;max-width:380px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.2)">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px">⚙️ Настройки этикетки</div>
      <div style="font-size:12px;color:var(--ink-faint);margin-bottom:16px">Для печати через QZ Tray на термопринтер. Хранится в этом браузере.</div>
      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div style="flex:1"><div style="font-size:11px;color:var(--ink-faint);margin-bottom:4px">Ширина, мм</div><input class="search" type="number" id="lblSetWidth" value="${s.widthMm}" style="width:100%"></div>
        <div style="flex:1"><div style="font-size:11px;color:var(--ink-faint);margin-bottom:4px">Высота, мм</div><input class="search" type="number" id="lblSetHeight" value="${s.heightMm}" style="width:100%"></div>
      </div>
      <div style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--ink-faint);margin-bottom:4px">Поворот QR-кода</div>
        <select class="search" id="lblSetQrRot" style="width:100%">
          ${[0,90,180,270].map(d=>`<option value="${d}" ${s.qrRotation===d?'selected':''}>${d}°</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:11px;color:var(--ink-faint);margin-bottom:4px">Поворот текстовой карточки</div>
        <select class="search" id="lblSetTextRot" style="width:100%">
          ${[0,90,180,270].map(d=>`<option value="${d}" ${s.textRotation===d?'selected':''}>${d}°</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <button class="btn btn-ghost" id="lblSetPreview">👁 Предпросмотр (без принтера)</button>
        <button class="btn btn-ghost" id="lblSetTestPrint">🖨 Пробная печать на принтере</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn btn-ghost" id="lblSetCancel">Закрыть без сохранения</button>
        <button class="btn btn-primary" id="lblSetSave">Сохранить</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  function readForm(){
    return {
      widthMm: parseFloat(document.getElementById('lblSetWidth').value) || 40,
      heightMm: parseFloat(document.getElementById('lblSetHeight').value) || 58,
      qrRotation: parseInt(document.getElementById('lblSetQrRot').value) || 0,
      textRotation: parseInt(document.getElementById('lblSetTextRot').value) || 0,
    };
  }
  document.getElementById('lblSetSave').onclick = ()=>{
    saveLabelSettings(readForm());
    document.body.removeChild(overlay);
    toast('Настройки этикетки сохранены');
  };
  document.getElementById('lblSetCancel').onclick = ()=>{ document.body.removeChild(overlay); };
  document.getElementById('lblSetPreview').onclick = async ()=>{
    saveLabelSettings(readForm());
    await previewThermalInfoCard();
  };
  document.getElementById('lblSetTestPrint').onclick = async ()=>{
    saveLabelSettings(readForm());
    const test = readForm();
    const nameLines = wrapTextManually('Тестовая этикетка настроек', 22);
    const dpi203 = 203;
    const ptPx = (pt)=> Math.round(pt / 72 * dpi203);
    const mmPx = (mm)=> Math.round(mm / 25.4 * dpi203);
    const infoHtml = `
      <div style="padding:${mmPx(2)}px;box-sizing:border-box;font-family:Arial,sans-serif;overflow:hidden;width:100%;height:100%">
        <div style="font-size:${ptPx(11)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px">ТЕСТ</div>
        <div style="font-size:${ptPx(8)}px;font-weight:bold;margin-bottom:${mmPx(1.2)}px;line-height:1.2">${nameLines.map(l=>`<div>${escapeHtml(l)}</div>`).join('')}</div>
      </div>
    `;
    const bitmapInfo = await htmlToMonoBitmap(infoHtml, test.widthMm, test.heightMm);
    await printBitmapOnThermalPrinter(test.widthMm, test.heightMm, bitmapInfo);
  };
}
function uint8ArrayToBase64(bytes){
  let binary = '';
  for(let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function sendRawToPrinter(bytes){
  const connected = await connectThermalPrinter();
  if(!connected) return false;
  const printerName = await getQzPrinterName();
  if(!printerName) return false;
  try{
    const config = qz.configs.create(printerName);
    const base64Data = uint8ArrayToBase64(bytes);
    await qz.print(config, [{ type: 'raw', format: 'base64', data: base64Data }]);
    return true;
  }catch(e){
    toast('Ошибка печати через QZ Tray: ' + (e.message||e));
    return false;
  }
}
// Рендерит DOM-узел (например, HTML-разметку этикетки) в чёрно-белый растр под 203 DPI
async function htmlToMonoBitmap(html, widthMm, heightMm){
  const dpi = 203;
  // Содержимое вёрстаем как альбомное (ширина и высота меняются местами), затем весь
  // холст поворачивается на 90° при растеризации — так же, как и с QR-картинкой от WB.
  const contentWidthPx = Math.round(heightMm / 25.4 * dpi);
  const contentHeightPx = Math.round(widthMm / 25.4 * dpi);
  const svgWrapped = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${contentWidthPx}" height="${contentHeightPx}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${contentWidthPx}px;height:${contentHeightPx}px;background:#fff;font-family:Arial,sans-serif;box-sizing:border-box">${html}</div>
      </foreignObject>
    </svg>
  `;
  const svgBase64 = btoa(unescape(encodeURIComponent(svgWrapped)));
  const finalWidthPx = Math.round(widthMm / 25.4 * dpi);
  const finalHeightPx = Math.round(heightMm / 25.4 * dpi);
  return imageBase64ToMonoBitmap(svgBase64, 'image/svg+xml', finalWidthPx, finalHeightPx, getLabelSettings().textRotation);
}
async function imageBase64ToMonoBitmap(base64, mime, widthPx, heightPx, rotationDeg){
  rotationDeg = ((rotationDeg||0) % 360 + 360) % 360;
  const img = new Image();
  await new Promise((resolve, reject)=>{
    img.onload = resolve;
    img.onerror = reject;
    img.src = `data:${mime};base64,${base64}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.save();
  if(rotationDeg === 90){
    ctx.translate(widthPx, 0);
    ctx.rotate(Math.PI/2);
    ctx.drawImage(img, 0, 0, heightPx, widthPx);
  } else if(rotationDeg === 180){
    ctx.translate(widthPx, heightPx);
    ctx.rotate(Math.PI);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
  } else if(rotationDeg === 270){
    ctx.translate(0, heightPx);
    ctx.rotate(-Math.PI/2);
    ctx.drawImage(img, 0, 0, heightPx, widthPx);
  } else {
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
  }
  ctx.restore();
  const imageData = ctx.getImageData(0, 0, widthPx, heightPx);
  const bytesPerRow = Math.ceil(widthPx / 8);
  const bitmap = new Uint8Array(bytesPerRow * heightPx);
  for(let y=0; y<heightPx; y++){
    for(let x=0; x<widthPx; x++){
      const idx = (y*widthPx + x) * 4;
      const alpha = imageData.data[idx+3];
      const gray = (imageData.data[idx] + imageData.data[idx+1] + imageData.data[idx+2]) / 3;
      const isBlack = alpha > 40 && gray < 180;
      if(!isBlack){
        const byteIndex = y*bytesPerRow + Math.floor(x/8);
        const bitIndex = 7 - (x % 8);
        bitmap[byteIndex] |= (1 << bitIndex);
      }
    }
  }
  return { bitmap, widthPx, heightPx, bytesPerRow };
}
async function printBitmapOnThermalPrinter(widthMm, heightMm, bitmapInfo){
  const { bitmap, heightPx, bytesPerRow } = bitmapInfo;
  const encoder = new TextEncoder();
  const header = encoder.encode(
    `SIZE ${widthMm} mm, ${heightMm} mm\r\n` +
    `GAP 2 mm, 0 mm\r\n` +
    `CLS\r\n` +
    `BITMAP 0,0,${bytesPerRow},${heightPx},0,`
  );
  const footer = encoder.encode(`\r\nPRINT 1\r\n`);
  const fullData = new Uint8Array(header.length + bitmap.length + footer.length);
  fullData.set(header, 0);
  fullData.set(bitmap, header.length);
  fullData.set(footer, header.length + bitmap.length);
  return sendRawToPrinter(fullData);
}
async function printSvgOnThermalPrinter(svgBase64, widthMm, heightMm){
  const dpi = 203;
  const widthPx = Math.round(widthMm / 25.4 * dpi);
  const heightPx = Math.round(heightMm / 25.4 * dpi);
  // QR-картинка от WB всегда альбомная (шире, чем выше) — поворот берём из настроек этикетки
  const rotationDeg = getLabelSettings().qrRotation;
  const bitmapInfo = await imageBase64ToMonoBitmap(svgBase64, 'image/svg+xml', widthPx, heightPx, rotationDeg);
  return printBitmapOnThermalPrinter(widthMm, heightMm, bitmapInfo);
}

function downloadSupplyBarcode(wbSupplyId, clientId){
  toast('Запрашиваем QR-код поставки у WB…');
  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'get_supply_barcode', wbSupplyId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    const file = data.file;
    if(!file){ toast('WB не вернул файл'); return; }
    const win = window.open('', '_blank');
    if(!win){ toast('Браузер заблокировал открытие окна'); return; }
    win.document.write(`
      <html><head><title>QR поставки ${wbSupplyId}</title>
      <style>
        @page{ size: 40mm 58mm; margin: 0; }
        *{ box-sizing:border-box; }
        body{margin:0;padding:0;width:40mm;height:58mm;display:flex;align-items:center;justify-content:center;overflow:hidden}
        img{width:58mm;height:40mm;transform:rotate(90deg);object-fit:contain}
      </style>
      </head><body>
        <img src="data:image/svg+xml;base64,${file}" onload="setTimeout(()=>window.print(), 300)">
      </body></html>
    `);
    win.document.close();
  });
}
function printFbsSticker(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  const pi = findLocalProductInfo(order);
  toast('Запрашиваем этикетку у WB…');
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'get_sticker', orderId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    const file = data.stickers && data.stickers[0] && data.stickers[0].file;
    if(!file){ toast('WB не вернул файл этикетки'); return; }
    const win = window.open('', '_blank');
    if(!win){ toast('Браузер заблокировал открытие окна'); return; }
    win.document.write(`
      <html><head><title>Этикетка заказа №${orderId}</title>
      <style>
        @page{ size: 40mm 58mm; margin: 0; }
        *{ box-sizing:border-box; }
        body{margin:0;padding:0;font-family:Arial,sans-serif}
        .info-label{width:40mm;min-height:58mm;padding:3mm;page-break-after:always}
        .qty{font-size:14pt;font-weight:bold;margin-bottom:2mm}
        .name{font-size:10pt;font-weight:bold;margin-bottom:2mm;line-height:1.3}
        table{width:100%;font-size:8pt;border-collapse:collapse}
        td{padding:0.7mm 0}
        td.label-cell{color:#666;white-space:nowrap;padding-right:2mm}
        td.value-cell{font-weight:bold;word-break:break-all}
        .qr-page{width:40mm;height:58mm;display:flex;align-items:center;justify-content:center;overflow:hidden;page-break-after:avoid}
        .qr-page img{width:58mm;height:40mm;transform:rotate(90deg);object-fit:contain}
      </style>
      </head><body>
        <div class="info-label">
          <div class="qty">1 шт.</div>
          <div class="name">${escapeHtml(pi.name)}</div>
          <table>
            ${pi.color?`<tr><td class="label-cell">Цвет</td><td class="value-cell">${escapeHtml(pi.color)}</td></tr>`:''}
            ${pi.size?`<tr><td class="label-cell">Размер</td><td class="value-cell">${escapeHtml(pi.size)}</td></tr>`:''}
            <tr><td class="label-cell">Артикул</td><td class="value-cell">${escapeHtml(order.article||'')}</td></tr>
            <tr><td class="label-cell">ШК</td><td class="value-cell">${order.barcode||'—'}</td></tr>
            <tr><td class="label-cell">Заказов</td><td class="value-cell">1</td></tr>
          </table>
        </div>
        <div class="qr-page"><img src="data:image/svg+xml;base64,${file}" onload="setTimeout(()=>window.print(), 300)"></div>
      </body></html>
    `);
    win.document.close();
  });
}
async function loadFbsOrders(){
  let allRows = [];
  const pageSize = 1000;
  for(let from = 0; from < 15000; from += pageSize){
    const { data, error } = await sb.from('wb_orders').select('*').order('created_at',{ascending:false}).range(from, from+pageSize-1);
    if(error){ console.error(error); break; }
    allRows = allRows.concat(data);
    if(!data || data.length < pageSize) break;
  }
  fbsOrders = allRows.map(o=>({
    orderId:o.order_id, rid:o.rid||'', clientId:o.client_id, clientName:o.client_name, nmId:o.nm_id, chrtId:o.chrt_id,
    article:o.article, barcode:o.barcode, name:o.name, size:o.size||'', price:o.price,
    supplierStatus:o.supplier_status, wbStatus:o.wb_status, wbSupplyId:o.wb_supply_id,
    kizCode:o.kiz_code, requiresKiz:o.requires_kiz||false, wbWarehouseId:o.wb_warehouse_id||'', kizStatus:o.kiz_status||null, kizDecision:o.kiz_decision||null, stickerCode:o.sticker_code||null, pickedAt:o.picked_at||null, kizUpdatedAt:o.kiz_updated_at||null, outOfStock:o.out_of_stock||false, orderCreatedAt:o.order_created_at||null
  }));
}
document.getElementById('fbsClientSelect').addEventListener('change', ()=>{ fbsSelectedClientId = document.getElementById('fbsClientSelect').value; fbsCompletePage = 1; fetchNewFbsOrders(true); });
document.getElementById('fbsCompletePageSize').addEventListener('change', function(){ changeFbsCompletePageSize(this.value); });

// ---------- OZON ORDERS ----------
let ozonOrders = [];
let ozonView = 'new';
let ozonSelectedClientId = '';
let ozonDonePage = 1;
let ozonDonePageSize = parseInt(localStorage.getItem('sklad42_ozon_done_page_size')) || 50;

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
    outOfStock:o.out_of_stock||false, orderCreatedAt:o.order_created_at||null
  }));
}
function populateOzonClientSelect(){
  const sel = document.getElementById('ozonClientSelect');
  if(!sel) return;
  const prev = sel.value;
  const ozonClients = clients.filter(c=>c.ozonConnected);
  sel.innerHTML = `<option value="">Все клиенты Ozon</option>` + ozonClients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  if([...sel.options].some(o=>o.value===prev)) sel.value = prev;
  ozonSelectedClientId = sel.value;
}
function setOzonView(view){
  ozonView = view;
  ozonDonePage = 1;
  document.getElementById('ozonTabNew').className = 'btn ' + (view==='new'?'btn-accent':'btn-ghost');
  document.getElementById('ozonTabActive').className = 'btn ' + (view==='active'?'btn-accent':'btn-ghost');
  document.getElementById('ozonTabDone').className = 'btn ' + (view==='done'?'btn-accent':'btn-ghost');
  const pageSizeSelect = document.getElementById('ozonDonePageSize');
  if(pageSizeSelect){
    pageSizeSelect.style.display = view==='done' ? '' : 'none';
    pageSizeSelect.value = String(ozonDonePageSize);
  }
  renderOzonBody();
}
function goOzonDonePage(delta){ ozonDonePage += delta; renderOzonBody(); }
function changeOzonDonePageSize(val){
  ozonDonePageSize = parseInt(val) || 50;
  try{ localStorage.setItem('sklad42_ozon_done_page_size', ozonDonePageSize); }catch(e){}
  ozonDonePage = 1;
  renderOzonBody();
}
async function fetchNewOzonOrders(){
  const targets = ozonSelectedClientId ? [ozonSelectedClientId] : clients.filter(c=>c.ozonConnected).map(c=>c.id);
  if(!targets.length){ toast('Нет ни одного клиента с подключённым Ozon'); return; }
  toast('Проверяю новые заказы Ozon…');
  let totalFetched = 0;
  for(const cid of targets){
    const { data, error } = await sb.functions.invoke('ozon-orders-ts', { body: { clientId: cid, action:'fetch_new' } });
    if(error || (data && data.error)){ console.error(error || data.error); toast('Ozon: ' + (data?.error || error.message)); continue; }
    totalFetched += data?.fetched || 0;
  }
  await loadOzonOrders();
  renderOzonBody();
  toast(`Готово — новых отправлений: ${totalFetched}`);
}
async function syncOzonStatuses(){
  const targets = ozonSelectedClientId ? [ozonSelectedClientId] : clients.filter(c=>c.ozonConnected).map(c=>c.id);
  if(!targets.length){ toast('Нет ни одного клиента с подключённым Ozon'); return; }
  toast('Обновляю статусы…');
  let totalUpdated = 0;
  for(const cid of targets){
    const { data, error } = await sb.functions.invoke('ozon-orders-ts', { body: { clientId: cid, action:'sync_order_statuses' } });
    if(error || (data && data.error)){ console.error(error || data.error); continue; }
    totalUpdated += data?.updated || 0;
  }
  await loadOzonOrders();
  renderOzonBody();
  toast(`Статусы обновлены: ${totalUpdated}`);
}
function shipOzonOrder(postingNumber){
  const order = ozonOrders.find(o=>o.postingNumber===postingNumber);
  if(!order) return;
  const inv = order.barcode ? findInventoryItemByBarcode(order.barcode, order.clientName) : findInventoryItem(order.article, order.clientName, order.size||'');
  const needQty = order.qty || 1;
  const available = inv ? (inv.isKit && inv.kitMode!=='assembled' ? computeKitAvailability(inv).available : inv.qty) : 0;
  if(!inv || available < needQty){
    toast(`Недостаточно на складе «${order.name||order.article}» — нужно ${needQty} шт, есть ${available}`);
    return;
  }
  toast('Подтверждаю сборку…');
  sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'ship', postingNumber } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
    deductStockForShipment(inv, needQty, `Отгрузка Ozon, отправление ${postingNumber}`);
    order.status = 'awaiting_deliver';
    if(data.warning) toast('Собрано, но есть предупреждение: ' + data.warning);
    else toast('Отправление собрано и подтверждено');
    renderOzonBody();
  });
}
function getOzonSticker(postingNumber){
  const order = ozonOrders.find(o=>o.postingNumber===postingNumber);
  if(!order) return;
  toast('Готовлю этикетку…');
  sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'get_sticker', postingNumber } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
    const link = document.createElement('a');
    link.href = 'data:application/pdf;base64,' + data.file;
    link.download = 'ozon-' + postingNumber + '.pdf';
    link.click();
  });
}
function cancelOzonOrder(postingNumber){
  const order = ozonOrders.find(o=>o.postingNumber===postingNumber);
  if(!order) return;
  const wasShipped = order.status !== 'awaiting_packaging';
  sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'cancel_reasons', postingNumber } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
    const reasons = data.reasons || [];
    if(!reasons.length){ toast('Ozon не вернул список причин отмены'); return; }
    const list = reasons.map(r=>`${r.id} — ${r.name || r.title}`).join('\n');
    const chosen = prompt('Укажите ID причины отмены:\n' + list);
    if(!chosen) return;
    sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'cancel', postingNumber, cancelReasonId: chosen } }).then(({data, error})=>{
      if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
      if(wasShipped && !order.outOfStock){
        const inv = order.barcode ? findInventoryItemByBarcode(order.barcode, order.clientName) : findInventoryItem(order.article, order.clientName, order.size||'');
        if(inv) logMovement(inv.sku, inv.name, order.qty||1, `Возврат остатка — отмена отправления Ozon ${postingNumber}`, inv.client, inv.size);
      }
      order.status = 'cancelled';
      toast('Отправление отменено' + (wasShipped && !order.outOfStock ? ' — остаток возвращён на склад' : ''));
      renderOzonBody();
    });
  });
}
const OZON_STATUS_LABELS = {
  awaiting_packaging:'Ожидает сборки', awaiting_deliver:'Ожидает отгрузки', delivering:'В доставке',
  last_mile:'Курьер в пути', delivered:'Доставлено', cancelled:'Отменено', arbitration:'Арбитраж',
  client_arbitration:'Арбитраж (клиент)', not_accepted:'Не принято'
};
function renderOzon(){
  populateOzonClientSelect();
  renderOzonBody();
}
function renderOzonBody(){
  const wrap = document.getElementById('ozonBody');
  if(!wrap) return;
  let rows = ozonOrders.filter(o=>!ozonSelectedClientId || o.clientId===ozonSelectedClientId);
  if(ozonView==='new'){
    rows = rows.filter(o=>o.status==='awaiting_packaging');
  } else if(ozonView==='active'){
    rows = rows.filter(o=>!['awaiting_packaging','delivered','cancelled'].includes(o.status));
  } else {
    rows = rows.filter(o=>['delivered','cancelled'].includes(o.status));
  }
  rows = rows.slice().sort((a,b)=> new Date(b.orderCreatedAt||0) - new Date(a.orderCreatedAt||0));

  if(!clients.some(c=>c.ozonConnected)){
    wrap.innerHTML = `<div class="panel empty">Ни у одного клиента не подключён Ozon — добавьте Client-Id и API-ключ во вкладке «Клиенты»</div>`;
    return;
  }
  if(!rows.length){
    wrap.innerHTML = `<div class="panel empty">Здесь пока пусто</div>`;
    return;
  }

  let paginationHtml = '';
  if(ozonView==='done'){
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / ozonDonePageSize));
    if(ozonDonePage > totalPages) ozonDonePage = totalPages;
    if(ozonDonePage < 1) ozonDonePage = 1;
    const from = (ozonDonePage-1)*ozonDonePageSize;
    const to = Math.min(from+ozonDonePageSize, totalItems);
    rows = rows.slice(from, to);
    paginationHtml = `
      <div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;margin-top:10px;flex-wrap:wrap">
        <span style="font-size:13px;color:var(--ink-soft)">Показано ${totalItems?from+1:0}–${to} из ${totalItems}</span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goOzonDonePage(-1)" ${ozonDonePage<=1?'disabled':''}>← Назад</button>
          <span style="font-size:13px;color:var(--ink-soft);white-space:nowrap">Стр. ${ozonDonePage} из ${totalPages}</span>
          <button class="btn btn-ghost" style="padding:5px 12px" onclick="goOzonDonePage(1)" ${ozonDonePage>=totalPages?'disabled':''}>Вперёд →</button>
        </div>
      </div>
    `;
  }

  wrap.innerHTML = `<div>${rows.map(o=>`
    <div class="panel" style="padding:14px 18px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div class="sku-name">${escapeHtml(o.name)}${o.size?` · ${escapeHtml(o.size)}`:''}</div>
        <div class="sku-code mono">${escapeHtml(o.article)} · № ${escapeHtml(o.postingNumber)} · ${o.qty} шт${!ozonSelectedClientId?` · ${escapeHtml(o.clientName)}`:''}${o.requiresKiz?' · требует маркировки':''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="chip oz">${OZON_STATUS_LABELS[o.status] || o.status}</span>
        ${o.status==='awaiting_packaging' ? `<button class="btn btn-accent" onclick="shipOzonOrder('${o.postingNumber}')">Собрать и отгрузить</button>` : ''}
        <button class="btn btn-ghost" onclick="getOzonSticker('${o.postingNumber}')">🏷 Этикетка</button>
        ${!['delivered','cancelled'].includes(o.status) ? `<button class="btn btn-ghost" style="color:var(--warn)" onclick="cancelOzonOrder('${o.postingNumber}')">Отменить</button>` : ''}
      </div>
    </div>
  `).join('')}</div>${paginationHtml}`;
}
document.getElementById('ozonClientSelect').addEventListener('change', function(){ ozonSelectedClientId = this.value; ozonDonePage = 1; renderOzonBody(); });
document.getElementById('ozonDonePageSize').addEventListener('change', function(){ changeOzonDonePageSize(this.value); });
