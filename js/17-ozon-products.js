// ===== Карточки Ozon и объединение с товарами в остатках =====
// Идея: товар на складе один (одна строка в «Остатках»), а у него может быть несколько «имён»:
// артикул WB, артикул Ozon, разные штрихкоды. Связка «артикул Ozon → наш товар» хранится в таблице ozon_offers.
// Сопоставление: 1) по штрихкоду (самое надёжное), 2) по совпадению артикула, 3) остальное — вручную.
// Штрихкоды Ozon добавляются к товару как дополнительные, поэтому дублей не возникает.
let ozonOffers = [];
let ozonMatchState = null; // {clientId, rows, showLinked}

async function loadOzonOffers(){
  const { data, error } = await selectAll('ozon_offers', [['client_name',true],['offer_id',true]]);
  if(error){ console.error(error); return; }
  ozonOffers = data.map(o=>({clientName:o.client_name, offerId:o.offer_id, productId:o.product_id, ozonSku:o.ozon_sku, name:o.name||'', barcodes:o.barcodes||[], invSku:o.inv_sku, invSize:o.inv_size||'', status:o.status}));
}
function ozonLinkFor(clientName, offerId){
  if(!offerId) return null;
  return ozonOffers.find(o=>o.clientName===clientName && o.offerId===String(offerId) && o.status==='linked') || null;
}
// Товар в остатках для заказа Ozon: сначала по связке артикула, потом как раньше
function ozonItemForOrder(order){
  const link = ozonLinkFor(order.clientName, order.article);
  if(link){
    const it = findInventoryItem(link.invSku, order.clientName, link.invSize);
    if(it) return it;
  }
  return order.barcode ? findInventoryItemByBarcode(order.barcode, order.clientName) : findInventoryItem(order.article, order.clientName, order.size||'');
}
function ozonLinkStats(client){
  const mine = ozonOffers.filter(o=>o.clientName===client.name);
  return {linked: mine.filter(o=>o.status==='linked').length, unlinked: mine.filter(o=>o.status==='unlinked').length, ignored: mine.filter(o=>o.status==='ignored').length};
}

async function loadOzonProductsAndMatch(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  const btn = typeof event!=='undefined' && event && event.target ? event.target.closest('button') : null;
  await withButtonLoading(btn, '⏳ Запрашиваю Ozon…', async ()=>{
    try{
      const { data, error } = await sb.functions.invoke('ozon-orders-ts', { body: { clientId, action:'list_products' } });
      if(error){ toast('Ozon: ' + await extractEdgeFunctionError(data, error)); return; }
      if(data && data.error){ toast('Ozon: ' + data.error); return; }
      client.ozonProducts = data.products || [];
      if(!client.ozonProducts.length){ toast('У продавца на Ozon не найдено карточек товаров'); return; }
      openOzonMatchModal(clientId);
    }catch(e){ toast('Не удалось вызвать серверную функцию Ozon'); console.error(e); }
  });
}

function ozonClientItems(clientName){
  const map = new Map();
  inventory.forEach(i=>{
    if((i.client||'')!==clientName || i.warehouseId==='BRAK') return;
    const k = i.sku+'~~'+(i.size||'');
    if(!map.has(k)) map.set(k, i);
  });
  return [...map.entries()].map(([key,i])=>({key, item:i})).sort((a,b)=>String(a.item.name||a.item.sku).localeCompare(String(b.item.name||b.item.sku),'ru'));
}
function ozonItemLabel(i){
  return `${i.name||i.sku}${i.size?` · ${i.size}`:''} — ${i.sku}`;
}
function planOzonMatch(client){
  const items = ozonClientItems(client.name);
  const rows = [];
  (client.ozonProducts||[]).forEach(p=>{
    const link = ozonOffers.find(o=>o.clientName===client.name && o.offerId===p.offer_id);
    if(link && link.status==='linked' && items.some(x=>x.key===link.invSku+'~~'+link.invSize)){
      rows.push({p, kind:'linked', cand:[], choice:link.invSku+'~~'+link.invSize});
      return;
    }
    if(link && link.status==='ignored'){ rows.push({p, kind:'ignored', cand:[], choice:'skip'}); return; }
    // 1) по штрихкоду
    const byCode = new Map();
    (p.barcodes||[]).forEach(b=>{
      const it = findInventoryItemByBarcode(String(b), client.name);
      if(it) byCode.set(it.sku+'~~'+(it.size||''), it);
    });
    if(byCode.size===1){ rows.push({p, kind:'barcode', cand:[...byCode.keys()], choice:[...byCode.keys()][0]}); return; }
    if(byCode.size>1){ rows.push({p, kind:'ambiguous', cand:[...byCode.keys()], choice:''}); return; }
    // 2) по артикулу
    const up = String(p.offer_id).toUpperCase();
    const byArt = items.filter(x=>String(x.item.sku).toUpperCase()===up);
    if(byArt.length===1){ rows.push({p, kind:'article', cand:[byArt[0].key], choice:byArt[0].key}); return; }
    if(byArt.length>1){ rows.push({p, kind:'ambiguous', cand:byArt.map(x=>x.key), choice:''}); return; }
    rows.push({p, kind:'none', cand:[], choice:''});
  });
  return rows;
}
function openOzonMatchModal(clientId, showLinked){
  const client = clients.find(c=>c.id===clientId);
  if(!client) return;
  closeOzonMatchModal();
  const rows = planOzonMatch(client);
  ozonMatchState = {clientId, rows, showLinked:!!showLinked};
  renderOzonMatchModal();
}
function closeOzonMatchModal(){
  const el = document.getElementById('ozonMatchOverlay'); if(el) el.remove();
  ozonMatchState = null;
}
function ozonMatchSetChoice(idx, val){
  if(!ozonMatchState) return;
  ozonMatchState.rows[idx].choice = val;
  const el = document.getElementById('ozonMatchSummary'); if(el) el.innerHTML = ozonMatchSummaryHtml();
}
function ozonMatchToggleLinked(on){
  if(!ozonMatchState) return;
  ozonMatchState.showLinked = on;
  renderOzonMatchModal();
}
function ozonMatchAllNew(){
  if(!ozonMatchState) return;
  ozonMatchState.rows.forEach(r=>{ if(r.kind==='none' && !r.choice) r.choice = 'new'; });
  renderOzonMatchModal();
}
function ozonMatchSummaryHtml(){
  const rows = ozonMatchState.rows;
  const cnt = k=>rows.filter(r=>r.kind===k).length;
  const undecided = rows.filter(r=>['none','ambiguous'].includes(r.kind) && !r.choice).length;
  const newCnt = rows.filter(r=>r.choice==='new').length;
  return `Всего карточек: <b>${rows.length}</b> · уже связаны: <b>${cnt('linked')}</b> · найдено автоматически по штрихкоду: <b>${cnt('barcode')}</b>, по артикулу: <b>${cnt('article')}</b> · требуют решения: <b>${undecided}</b>${newCnt?` · будет создано новых товаров: <b>${newCnt}</b>`:''}`;
}
function renderOzonMatchModal(){
  const st = ozonMatchState; if(!st) return;
  const client = clients.find(c=>c.id===st.clientId);
  const old = document.getElementById('ozonMatchOverlay'); if(old) old.remove();
  const items = ozonClientItems(client.name);
  const optsHtml = (cands, selected)=>{
    const list = cands && cands.length ? items.filter(x=>cands.includes(x.key)) : items;
    return `<option value="">— выберите —</option>` + `<option value="new" ${selected==='new'?'selected':''}>＋ Создать новый товар</option><option value="skip" ${selected==='skip'?'selected':''}>Не связывать (не наш товар)</option>` +
      list.map(x=>`<option value="${escapeHtml(x.key)}" ${selected===x.key?'selected':''}>${escapeHtml(ozonItemLabel(x.item))}</option>`).join('');
  };
  const todo = st.rows.map((r,i)=>({r,i})).filter(x=>['none','ambiguous'].includes(x.r.kind));
  const auto = st.rows.map((r,i)=>({r,i})).filter(x=>['barcode','article'].includes(x.r.kind));
  const linked = st.rows.map((r,i)=>({r,i})).filter(x=>['linked','ignored'].includes(x.r.kind));
  const LIMIT = 80;
  const rowHtml = ({r,i}, editable)=>`
    <div style="padding:9px 0;border-bottom:1px solid var(--line)">
      <div style="font-size:13px;font-weight:600">${escapeHtml(r.p.name||r.p.offer_id)} <span class="mono" style="font-weight:400;font-size:11px;color:var(--ink-faint)">арт. Ozon: ${escapeHtml(r.p.offer_id)}</span></div>
      <div class="mono" style="font-size:11px;color:var(--ink-faint);margin-bottom:5px">ШК: ${(r.p.barcodes||[]).length ? r.p.barcodes.map(escapeHtml).join(' · ') : '—'}${r.kind==='ambiguous'?' · <span style="color:var(--warn)">подходит несколько товаров — выберите</span>':''}${r.kind==='none'?' · <span style="color:var(--warn)">в остатках не найден</span>':''}</div>
      ${editable ? `<select class="search" style="width:100%" onchange="ozonMatchSetChoice(${i}, this.value)">${optsHtml(r.cand, r.choice)}</select>`
        : `<div style="font-size:12px;color:var(--ok)">${r.kind==='skip'||r.kind==='ignored'?'не связан (пропущен)':`→ ${escapeHtml((()=>{const x=items.find(y=>y.key===r.choice); return x?ozonItemLabel(x.item):r.choice;})())}${r.kind==='barcode'?' (по штрихкоду)':r.kind==='article'?' (по артикулу)':''}`}</div>`}
    </div>`;
  const overlay = document.createElement('div');
  overlay.id = 'ozonMatchOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:22px;max-width:760px;width:100%;max-height:92vh;display:flex;flex-direction:column">
      <h3 style="margin:0 0 6px 0;font-size:18px">Карточки Ozon → товары в остатках</h3>
      <p style="font-size:12px;color:var(--ink-soft);line-height:1.6;margin:0 0 8px 0">${escapeHtml(client.name)}. Чтобы не плодить дубли, карточка Ozon привязывается к существующему товару (сначала по штрихкоду, потом по артикулу). Штрихкоды Ozon добавятся к товару как дополнительные. Остатки и названия не меняются.</p>
      <div id="ozonMatchSummary" style="font-size:12px;margin-bottom:10px">${ozonMatchSummaryHtml()}</div>
      <div style="overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:4px 12px;margin-bottom:12px;flex:1;min-height:80px">
        ${todo.length ? `<div style="padding:8px 0 2px 0;font-size:12px;font-weight:700;color:var(--warn)">Нужно ваше решение (${todo.length})</div>${todo.slice(0,LIMIT).map(x=>rowHtml(x,true)).join('')}${todo.length>LIMIT?`<div style="padding:8px 0;font-size:12px;color:var(--ink-faint)">…и ещё ${todo.length-LIMIT} — примените эти, затем откройте сопоставление снова</div>`:''}` : '<div style="padding:10px 0;font-size:13px;color:var(--ok)">Все карточки сопоставлены ✔</div>'}
        ${auto.length ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;font-weight:700;padding:8px 0">Найдено автоматически (${auto.length}) — проверьте</summary>${auto.slice(0,LIMIT).map(x=>rowHtml(x,true)).join('')}${auto.length>LIMIT?`<div style="padding:8px 0;font-size:12px;color:var(--ink-faint)">…и ещё ${auto.length-LIMIT}</div>`:''}</details>` : ''}
        ${st.showLinked && linked.length ? `<details open style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;font-weight:700;padding:8px 0">Уже связаны (${linked.length})</summary>${linked.slice(0,LIMIT).map(x=>rowHtml(x,true)).join('')}${linked.length>LIMIT?`<div style="padding:8px 0;font-size:12px;color:var(--ink-faint)">…и ещё ${linked.length-LIMIT}</div>`:''}</details>` : ''}
      </div>
      <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;align-items:center">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" ${st.showLinked?'checked':''} onchange="ozonMatchToggleLinked(this.checked)"> показать уже связанные</label>
          ${todo.some(x=>x.r.kind==='none') ? `<button class="btn btn-ghost" onclick="ozonMatchAllNew()" title="Для карточек, которых нет в остатках: создать новые товары (0 шт). Делайте это, только если уверены, что такого товара у клиента на складе ещё нет.">＋ Нераспознанные — создать новыми</button>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" onclick="closeOzonMatchModal()">Отмена</button>
          <button class="btn btn-accent" id="ozonMatchApplyBtn" onclick="applyOzonMatch()">Применить</button>
        </div>
      </div>
    </div>`;
  overlay.addEventListener('click', e=>{ if(e.target===overlay) closeOzonMatchModal(); });
  document.body.appendChild(overlay);
}

async function applyOzonMatch(){
  const st = ozonMatchState; if(!st) return;
  const client = clients.find(c=>c.id===st.clientId);
  const btn = document.getElementById('ozonMatchApplyBtn');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Сохраняю…'; }
  let linkedN = 0, createdN = 0, skippedN = 0, undecidedN = 0, codesAdded = 0;
  const dbRows = [];
  for(const r of st.rows){
    const p = r.p;
    const base = {client_name:client.name, offer_id:p.offer_id, product_id:p.product_id||null, ozon_sku:p.sku||null, name:p.name||'', barcodes:p.barcodes||[], updated_at:new Date().toISOString()};
    if(r.choice==='skip' || r.kind==='ignored' && !r.choice){ dbRows.push({...base, inv_sku:null, inv_size:'', status:'ignored'}); skippedN++; continue; }
    if(!r.choice){ dbRows.push({...base, inv_sku:null, inv_size:'', status:'unlinked'}); undecidedN++; continue; }
    let item = null;
    if(r.choice==='new'){
      const sku = String(p.offer_id);
      item = findInventoryItemForWb(sku, client.name, '');
      if(!item){
        item = { sku, name:p.name||sku, qty:0, client:client.name, size:'', vendorCode:sku, barcode:(p.barcodes&&p.barcodes[0])||'', dims:null, color:'' };
        inventory.push(item);
        await ensureCellAssigned(item);
        syncInventoryRow(item.sku, item.client, item.size);
        createdN++;
      }
    } else {
      const [sku, size] = r.choice.split('~~');
      item = findInventoryItem(sku, client.name, size||'');
    }
    if(!item){ dbRows.push({...base, inv_sku:null, inv_size:'', status:'unlinked'}); undecidedN++; continue; }
    // штрихкоды Ozon → дополнительные штрихкоды товара (без конфликтов с другими товарами)
    const codes = (p.barcodes||[]).map(String);
    if(!item.barcode && codes.length){
      const free = codes.find(b=>{ const o = findInventoryItemByBarcode(b, client.name); return !o; });
      if(free){
        const rowsInv = inventory.filter(i=>(i.client||'')===(item.client||'') && i.sku===item.sku && (i.size||'')===(item.size||''));
        rowsInv.forEach(x=>{ x.barcode = free; });
        for(const x of rowsInv) await syncInventoryRow(x.sku, x.client, x.size, x.warehouseId);
        codesAdded++;
      }
    }
    const before = inventoryBarcodes.length;
    await registerExtraBarcodesForNew(item, codes);
    codesAdded += inventoryBarcodes.length - before;
    dbRows.push({...base, inv_sku:item.sku, inv_size:item.size||'', status:'linked'});
    linkedN++;
  }
  let failed = 0;
  for(let i=0;i<dbRows.length;i+=200){
    const chunk = dbRows.slice(i,i+200);
    const { error } = await sb.from('ozon_offers').upsert(chunk, {onConflict:'client_name,offer_id'});
    if(error){ console.error(error); failed += chunk.length; }
  }
  await loadOzonOffers();
  closeOzonMatchModal();
  toast(`Ozon: связано ${linkedN}${createdN?` (из них новых товаров ${createdN})`:''}, штрихкодов добавлено ${codesAdded}${skippedN?`, пропущено ${skippedN}`:''}${undecidedN?`, без решения ${undecidedN}`:''}${failed?` · не сохранилось: ${failed} — повторите`:''}`);
  renderClients();
  renderInventory();
}
