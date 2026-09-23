// ---------- OUTBOUND BOXES (распределение по коробам) ----------
let boxSizes = [];
async function loadBoxSizes(){
  const { data, error } = await sb.from('box_sizes').select('*').order('length_cm', {ascending:true});
  if(error){ console.error(error); return; }
  boxSizes = data.map(s=>({id:s.id, name:s.name, l:s.length_cm, w:s.width_cm, h:s.height_cm}));
}
function addBoxSize(){
  const name = document.getElementById('newBoxSizeName').value.trim();
  const l = parseFloat(document.getElementById('newBoxSizeL').value) || 0;
  const w = parseFloat(document.getElementById('newBoxSizeW').value) || 0;
  const h = parseFloat(document.getElementById('newBoxSizeH').value) || 0;
  if(!name){ toast('Укажите название размера (например, M)'); return; }
  if(boxSizes.some(s=>s.name.toLowerCase()===name.toLowerCase())){ toast('Такой размер уже есть'); return; }
  const id = 'BXS-' + Date.now();
  boxSizes.push({id, name, l, w, h});
  document.getElementById('newBoxSizeName').value = '';
  document.getElementById('newBoxSizeL').value = '';
  document.getElementById('newBoxSizeW').value = '';
  document.getElementById('newBoxSizeH').value = '';
  toast(`Размер «${name}» добавлен`);
  renderOutboundTableWrap();
  sb.from('box_sizes').insert({id, name, length_cm:l||null, width_cm:w||null, height_cm:h||null}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить размер в базе'); }
  });
}
function deleteBoxSize(id){
  const s = boxSizes.find(x=>x.id===id);
  if(!confirm(`Удалить размер «${s?s.name:id}»? У коробов, где он уже указан, размер просто очистится.`)) return;
  boxSizes = boxSizes.filter(x=>x.id!==id);
  outboundBoxes.forEach(b=>{ if(b.sizeId===id) b.sizeId = null; });
  toast('Размер удалён');
  renderOutboundTableWrap();
  sb.from('box_sizes').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить размер в базе'); }
  });
}
function setBoxSize(boxId, sizeId){
  const box = outboundBoxes.find(b=>b.id===boxId);
  if(!box) return;
  box.sizeId = sizeId || null;
  renderOutboundTableWrap();
  sb.from('outbound_boxes').update({size_id: sizeId || null}).eq('id', boxId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить размер короба в базе'); }
  });
}
async function loadOutboundBoxes(){
  const { data: boxRows, error: err1 } = await sb.from('outbound_boxes').select('*').order('box_number');
  if(err1){ console.error(err1); return; }
  const { data: itemRows, error: err2 } = await sb.from('outbound_box_items').select('*').limit(50000);
  if(err2){ console.error(err2); return; }
  outboundBoxes = boxRows.map(b=>({
    id: b.id, supplyId: b.supply_id, boxNumber: b.box_number, sizeId: b.size_id || null,
    items: itemRows.filter(it=>it.box_id===b.id).map(it=>({sku:it.sku, name:it.name, size:it.size||'', barcode:it.barcode||'', qty:it.qty}))
  }));
}
function toggleBoxPanel(supplyId){
  activeBoxSupplyId = activeBoxSupplyId===supplyId ? null : supplyId;
  expandedBoxId = null;
  lastBoxScanInfo = null;
  boxScanHistory = [];
  renderOutboundTableWrap();
}
function toggleOutboundItemsCollapse(){
  outboundItemsCollapsed = !outboundItemsCollapsed;
  renderOutboundTableWrap();
}
function saveWithRetry(promiseFactory, attemptsLeft){
  attemptsLeft = attemptsLeft===undefined ? 3 : attemptsLeft;
  return promiseFactory().then(({error})=>{
    if(!error) return { success:true };
    if(attemptsLeft > 1){
      return new Promise(resolve=>setTimeout(resolve, 1200)).then(()=>saveWithRetry(promiseFactory, attemptsLeft-1));
    }
    return { success:false, error };
  }).catch(e=>{
    if(attemptsLeft > 1){
      return new Promise(resolve=>setTimeout(resolve, 1200)).then(()=>saveWithRetry(promiseFactory, attemptsLeft-1));
    }
    return { success:false, error:e };
  });
}
function getRemainingForItem(supply, sku, size){
  const planned = supply.items.filter(i=>i.sku===sku && (i.size||'')===(size||'')).reduce((a,i)=>a+i.qty,0);
  const boxed = outboundBoxes.filter(b=>b.supplyId===supply.id).reduce((sum,b)=>
    sum + b.items.filter(it=>it.sku===sku && (it.size||'')===(size||'')).reduce((a,it)=>a+it.qty,0), 0);
  return planned - boxed;
}
function computeBoxMismatches(supply){
  const mismatches = [];
  supply.items.forEach(i=>{
    const remaining = getRemainingForItem(supply, i.sku, i.size||'');
    if(remaining !== 0) mismatches.push({...i, remaining});
  });
  return mismatches;
}
function createOutboundBoxesBulk(supplyId){
  const input = document.getElementById('boxCountInput-'+supplyId);
  const count = Math.max(1, parseInt(input.value) || 0);
  if(!count){ toast('Укажите сколько коробов создать'); return; }
  const sizeSelect = document.getElementById('boxSizeSelect-'+supplyId);
  const sizeId = sizeSelect ? (sizeSelect.value || null) : null;
  const existing = outboundBoxes.filter(b=>b.supplyId===supplyId);
  let nextNumber = existing.length ? Math.max(...existing.map(b=>b.boxNumber)) + 1 : 1;
  const newBoxes = [];
  for(let i=0;i<count;i++){
    const box = { id: 'BOX-'+Date.now()+'-'+i, supplyId, boxNumber: nextNumber++, sizeId, items: [] };
    newBoxes.push(box);
    outboundBoxes.push(box);
  }
  toast(`Создано коробов: ${count}`);
  renderOutboundTableWrap();
  sb.from('outbound_boxes').insert(newBoxes.map(b=>({id:b.id, supply_id:b.supplyId, box_number:b.boxNumber, size_id:b.sizeId}))).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить короба в базе'); }
  });
}
function addSingleOutboundBox(supplyId){
  const sizeSelect = document.getElementById('boxSizeSelect-'+supplyId);
  const sizeId = sizeSelect ? (sizeSelect.value || null) : null;
  const existing = outboundBoxes.filter(b=>b.supplyId===supplyId);
  const nextNumber = existing.length ? Math.max(...existing.map(b=>b.boxNumber)) + 1 : 1;
  const box = { id: 'BOX-'+Date.now(), supplyId, boxNumber: nextNumber, sizeId, items: [] };
  outboundBoxes.push(box);
  toast(`Добавлен короб №${nextNumber}`);
  renderOutboundTableWrap();
  sb.from('outbound_boxes').insert({id:box.id, supply_id:supplyId, box_number:box.boxNumber, size_id:box.sizeId}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить короб в базе'); }
  });
}
function closeBoxAndAddNext(supplyId, currentBoxId){
  const currentBox = outboundBoxes.find(b=>b.id===currentBoxId);
  const closedNumber = currentBox ? currentBox.boxNumber : '?';
  expandedBoxId = null;
  lastBoxScanInfo = null;
  boxScanHistory = [];
  const existing = outboundBoxes.filter(b=>b.supplyId===supplyId);
  const nextNumber = existing.length ? Math.max(...existing.map(b=>b.boxNumber)) + 1 : 1;
  const newBox = { id: 'BOX-'+Date.now(), supplyId, boxNumber: nextNumber, sizeId: currentBox ? currentBox.sizeId : null, items: [] };
  outboundBoxes.push(newBox);
  expandedBoxId = newBox.id;
  toast(`Короб №${closedNumber} закрыт, открыт короб №${nextNumber}`);
  renderOutboundTableWrap();
  saveWithRetry(()=>sb.from('outbound_boxes').insert({id:newBox.id, supply_id:supplyId, box_number:newBox.boxNumber, size_id:newBox.sizeId})).then(({success, error})=>{
    if(!success){ console.error(error); toast('Не удалось сохранить новый короб в базе'); }
  });
}
function deleteOutboundBox(boxId){
  if(!confirm('Удалить этот короб? Все его позиции вернутся в «не распределено».')) return;
  outboundBoxes = outboundBoxes.filter(b=>b.id!==boxId);
  if(expandedBoxId===boxId) expandedBoxId = null;
  toast('Короб удалён');
  renderOutboundTableWrap();
  sb.from('outbound_boxes').delete().eq('id', boxId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить короб в базе'); }
  });
}
function toggleBoxExpand(boxId){
  expandedBoxId = expandedBoxId===boxId ? null : boxId;
  renderOutboundTableWrap();
}
function addItemToBox(supply, boxId, sku, size, qty){
  const box = outboundBoxes.find(b=>b.id===boxId);
  if(!box) return false;
  const planItem = supply.items.find(i=>i.sku===sku && (i.size||'')===(size||''));
  if(!planItem){ toast('Этот товар не входит в состав поставки'); return false; }
  const remaining = getRemainingForItem(supply, sku, size);
  if(qty > remaining){
    toast(`Осталось нераспределено только ${remaining} шт «${planItem.name}»`);
    return false;
  }
  const existing = box.items.find(it=>it.sku===sku && (it.size||'')===(size||''));
  const newQty = (existing ? existing.qty : 0) + qty;
  if(existing) existing.qty = newQty;
  else box.items.push({sku, name:planItem.name, size:size||'', barcode:planItem.barcode||'', qty:newQty});
  lastBoxScanInfo = {boxId, sku, size:size||'', name:planItem.name, delta:qty};
  boxScanHistory.push({boxId, sku, size:size||'', name:planItem.name, delta:qty});
  saveWithRetry(()=>sb.from('outbound_box_items').upsert(
    {box_id:boxId, sku, name:planItem.name, size:size||'', barcode:planItem.barcode||null, qty:newQty},
    { onConflict: 'box_id,sku,size' }
  )).then(({success, error})=>{
    if(!success){ console.error(error); toast('Не удалось сохранить в базе даже после повторных попыток — проверьте интернет и отсканируйте ещё раз'); }
  });
  if(remaining - qty <= 0){
    playBeep('ok');
    toast(`✅ Всё добавлено: «${planItem.name}»${size?` (${size})`:''}`);
  }
  return true;
}
function undoLastBoxScan(){
  if(!boxScanHistory.length){ toast('Нечего отменять'); return; }
  const info = boxScanHistory.pop();
  const box = outboundBoxes.find(b=>b.id===info.boxId);
  if(!box){ toast('Короб не найден'); lastBoxScanInfo = null; return; }
  const item = box.items.find(it=>it.sku===info.sku && (it.size||'')===(info.size||''));
  if(!item){ toast('Эта позиция уже не найдена в коробе'); lastBoxScanInfo = null; return; }
  const newQty = Math.max(0, item.qty - info.delta);
  if(newQty === 0){
    box.items = box.items.filter(it=>!(it.sku===info.sku && (it.size||'')===(info.size||'')));
    saveWithRetry(()=>sb.from('outbound_box_items').delete().eq('box_id', info.boxId).eq('sku', info.sku).eq('size', info.size||'')).then(({success, error})=>{
      if(!success){ console.error(error); toast('Не удалось сохранить отмену в базе'); }
    });
  } else {
    item.qty = newQty;
    saveWithRetry(()=>sb.from('outbound_box_items').upsert(
      {box_id:info.boxId, sku:info.sku, name:item.name, size:info.size||'', barcode:item.barcode||null, qty:newQty},
      { onConflict: 'box_id,sku,size' }
    )).then(({success, error})=>{
      if(!success){ console.error(error); toast('Не удалось сохранить отмену в базе'); }
    });
  }
  toast(`Отменено: ${info.name} −${info.delta} шт${boxScanHistory.length?` (ещё можно отменить: ${boxScanHistory.length})`:''}`);
  lastBoxScanInfo = boxScanHistory.length ? boxScanHistory[boxScanHistory.length-1] : null;
  renderOutboundTableWrap();
}
function removeItemFromBox(boxId, sku, size){
  const box = outboundBoxes.find(b=>b.id===boxId);
  if(!box) return;
  box.items = box.items.filter(it=>!(it.sku===sku && (it.size||'')===(size||'')));
  toast('Позиция убрана из короба');
  renderOutboundTableWrap();
  saveWithRetry(()=>sb.from('outbound_box_items').delete().eq('box_id', boxId).eq('sku', sku).eq('size', size||'')).then(({success, error})=>{
    if(!success){ console.error(error); toast('Не удалось сохранить в базе даже после повторных попыток'); }
  });
}
function manualAddToBox(supplyId, boxId){
  const supply = outboundSupplies.find(s=>s.id===supplyId);
  const select = document.getElementById('boxItemSelect-'+boxId);
  const key = select.value;
  if(!key) return;
  const {sku, size} = parseItemKey(key);
  const qty = Math.max(1, parseInt(document.getElementById('boxItemQty-'+boxId).value) || 1);
  if(addItemToBox(supply, boxId, sku, size, qty)){
    toast('Добавлено в короб');
    renderOutboundTableWrap();
  }
}
function addAllRemainingToBox(supplyId, boxId){
  const supply = outboundSupplies.find(s=>s.id===supplyId);
  if(!supply) return;
  let addedCount = 0;
  supply.items.forEach(i=>{
    const remaining = getRemainingForItem(supply, i.sku, i.size||'');
    if(remaining > 0 && addItemToBox(supply, boxId, i.sku, i.size||'', remaining)) addedCount++;
  });
  if(addedCount===0){ toast('Нечего добавлять — весь товар уже распределён по коробам'); return; }
  toast(`Добавлено в короб: ${addedCount} поз. (всё нераспределённое)`);
  renderOutboundTableWrap();
}
function renderBoxScanHandler(supplyId, boxId){
  const input = document.getElementById('boxScanInput-'+boxId);
  if(!input) return;
  input.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter') return;
    const code = input.value.trim();
    input.value = '';
    if(!code) return;
    const supply = outboundSupplies.find(s=>s.id===supplyId);
    const planItem = supply.items.find(i=>i.barcode && i.barcode===code);
    if(!planItem){
      playBeep('error');
      alert(`⚠ Штрихкод ${code} не найден среди товаров этой поставки.\n\nПроверьте, туда ли отсканирован товар.`);
      return;
    }
    if(addItemToBox(supply, boxId, planItem.sku, planItem.size||'', 1)){
      playBeep('ok');
      renderOutboundTableWrap();
    } else {
      playBeep('warn');
    }
  });
  input.focus();
}
function renderBoxCard(supply, box){
  const isOpen = expandedBoxId === box.id;
  const totalQty = box.items.reduce((a,it)=>a+it.qty,0);
  const size = boxSizes.find(s=>s.id===box.sizeId);
  const sizeTitle = size && size.l && size.w && size.h ? `${size.l}×${size.w}×${size.h} см` : '';
  return `
    <div class="panel" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;cursor:pointer;background:var(--bg)" onclick="toggleBoxExpand('${box.id}')">
        <h3 style="font-size:14px;color:var(--ink-soft);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          📦 Короб №${box.boxNumber} · ${box.items.length} поз. · ${totalQty} шт
          <span title="${sizeTitle}" style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:${size?'var(--accent)':'var(--line)'};color:${size?'var(--accent-ink)':'var(--ink-soft)'}">${size?escapeHtml(size.name):'без размера'}</span>
        </h3>
        <span style="font-size:12px;color:var(--ink-faint)">${isOpen ? '▲' : '▼'}</span>
      </div>
      ${isOpen ? `
        <div style="padding:10px 14px 0 14px" onclick="event.stopPropagation()">
          <select class="search" style="width:180px;font-size:12px" onchange="setBoxSize('${box.id}', this.value)">
            <option value="">Без размера</option>
            ${boxSizes.map(s=>`<option value="${s.id}" ${box.sizeId===s.id?'selected':''}>${escapeHtml(s.name)}${s.l&&s.w&&s.h?` — ${s.l}×${s.w}×${s.h} см`:''}</option>`).join('')}
          </select>
        </div>
        <div style="padding:12px 14px">
          ${box.items.length ? box.items.map(it=>{
            const planTotal = supply.items.filter(i=>i.sku===it.sku && (i.size||'')===(it.size||'')).reduce((a,i)=>a+i.qty,0);
            const packedTotal = planTotal - getRemainingForItem(supply, it.sku, it.size||'');
            const done = packedTotal >= planTotal;
            return `
            <div class="pick-row" style="padding:6px 0">
              <div><div class="sku-name" style="font-size:13px">${it.name}${it.size?` · ${it.size}`:''}</div><div class="sku-code mono">${it.sku}${it.barcode?` · ШК ${it.barcode}`:''}${done?' · ✅ упаковано полностью':''}</div></div>
              <div class="qty-need" style="${done?'color:var(--ok);font-weight:700':''}">${it.qty} шт <span style="color:var(--ink-faint);font-weight:400">(всего ${packedTotal}/${planTotal})</span></div>
              <button class="btn btn-ghost" style="padding:3px 8px" onclick="removeItemFromBox('${box.id}','${escapeHtml(it.sku)}','${escapeHtml(it.size||'')}')">✕</button>
            </div>
          `;}).join('') : `<p style="font-size:12px;color:var(--ink-faint);margin:4px 0">Короб пока пуст</p>`}
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
            <div class="eyebrow" style="margin-bottom:6px">Сканер</div>
            <input class="search" id="boxScanInput-${box.id}" placeholder="Штрихкод товара…" style="width:100%;margin-bottom:10px" autocomplete="off">
            <div class="eyebrow" style="margin-bottom:6px">Или вручную</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <select class="search" id="boxItemSelect-${box.id}" style="flex:1;min-width:200px">
                ${supply.items.map(i=>`<option value="${escapeHtml(i.sku+'~~'+ (supply.clientName||'') +'~~'+(i.size||''))}">${i.sku}${i.size?` (${i.size})`:''} — ${i.name} (не распределено: ${getRemainingForItem(supply,i.sku,i.size||'')})</option>`).join('')}
              </select>
              <input class="search" id="boxItemQty-${box.id}" type="number" min="1" value="1" style="width:80px">
              <button class="btn btn-ghost" onclick="manualAddToBox('${supply.id}','${box.id}')">+ Добавить</button>
            </div>
            <button class="btn btn-accent" style="margin-top:10px;width:100%;justify-content:center" onclick="addAllRemainingToBox('${supply.id}','${box.id}')">📥 Добавить весь товар</button>
            <button class="btn btn-ghost" style="margin-top:8px;width:100%;justify-content:center" ${(boxScanHistory.length && lastBoxScanInfo && lastBoxScanInfo.boxId===box.id)?'':'disabled'} onclick="undoLastBoxScan()">↩ Отменить скан${(lastBoxScanInfo && lastBoxScanInfo.boxId===box.id)?` (${lastBoxScanInfo.name})`:''}${boxScanHistory.length>1?` [${boxScanHistory.length}]`:''}</button>
          </div>
          <button class="btn btn-primary" style="margin-top:10px;width:100%;justify-content:center" onclick="closeBoxAndAddNext('${supply.id}','${box.id}')">✅ Закрыть короб и добавить следующий</button>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="downloadBoxExcel('${supply.id}','${box.id}')">📊 Скачать состав (Excel)</button>
            <button class="btn btn-ghost" style="flex:1;justify-content:center;color:var(--warn)" onclick="deleteOutboundBox('${box.id}')">Удалить короб</button>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
function renderBoxPanel(supply){
  const boxes = outboundBoxes.filter(b=>b.supplyId===supply.id).sort((a,b)=>a.boxNumber-b.boxNumber);
  const mismatches = computeBoxMismatches(supply);
  const fullyDistributed = mismatches.length===0 && boxes.length>0;
  const totalLines = supply.items.length;
  const packedLines = supply.items.filter(i=>getRemainingForItem(supply,i.sku,i.size||'')===0).length;
  const totalQty = supply.items.reduce((a,i)=>a+i.qty,0);
  const packedQty = boxes.reduce((sum,b)=>sum + b.items.reduce((a,it)=>a+it.qty,0), 0);
  setTimeout(()=>{
    boxes.forEach(box=>{ if(expandedBoxId===box.id) renderBoxScanHandler(supply.id, box.id); });
  }, 0);

  const sizeCounts = {};
  boxes.forEach(b=>{
    const key = b.sizeId || '__none__';
    sizeCounts[key] = (sizeCounts[key]||0) + 1;
  });
  const sizeBreakdown = Object.entries(sizeCounts).map(([key,count])=>{
    const size = boxSizes.find(s=>s.id===key);
    return `<span style="font-size:12px;color:var(--ink-soft)">${size?escapeHtml(size.name):'без размера'}: <b>${count}</b></span>`;
  }).join(' · ');

  return `
    <div style="border-top:1px solid var(--line);padding:16px 18px;background:var(--panel)" onclick="event.stopPropagation()">
      <div class="eyebrow" style="margin-bottom:10px">Распределение по коробам</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <input class="search" id="boxCountInput-${supply.id}" type="number" min="1" placeholder="Кол-во коробов" style="width:150px">
        <select class="search" id="boxSizeSelect-${supply.id}" style="width:170px">
          <option value="">Без размера</option>
          ${boxSizes.map(s=>`<option value="${s.id}" title="${s.l&&s.w&&s.h?`${s.l}×${s.w}×${s.h} см`:''}">${escapeHtml(s.name)}${s.l&&s.w&&s.h?` — ${s.l}×${s.w}×${s.h} см`:''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" onclick="createOutboundBoxesBulk('${supply.id}')">Создать короба</button>
        <button class="btn btn-ghost" onclick="addSingleOutboundBox('${supply.id}')">+ Новый короб</button>
        <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="toggleBoxSizeManager('${supply.id}')">⚙ Размеры коробов</button>
      </div>
      ${boxSizeManagerOpenFor===supply.id ? renderBoxSizeManager() : ''}
      <div class="stat-row" style="margin-bottom:8px">
        <div class="stat"><div class="val" style="color:${packedLines===totalLines?'var(--ok)':'var(--accent)'}">${packedLines}/${totalLines}</div><div class="lbl">Упаковано артикулов</div></div>
        <div class="stat"><div class="val" style="color:${packedQty===totalQty?'var(--ok)':'var(--accent)'}">${packedQty}/${totalQty}</div><div class="lbl">Упаковано товаров</div></div>
        <div class="stat"><div class="val">${boxes.length}</div><div class="lbl">Коробов использовано</div></div>
      </div>
      ${boxes.length ? `<div style="margin-bottom:14px">${sizeBreakdown}</div>` : ''}
      ${boxes.map(box=>renderBoxCard(supply, box)).join('')}
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-accent" style="flex:1;justify-content:center" ${fullyDistributed?'':'disabled'} onclick="printBoxLabels('${supply.id}')">🖨 Распечатать QR-коды коробов</button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center" ${boxes.length?'':'disabled'} onclick="downloadAllBoxesExcel('${supply.id}')">📊 Скачать все короба (Excel)</button>
      </div>
    </div>
  `;
}
let boxSizeManagerOpenFor = null;
function toggleBoxSizeManager(supplyId){
  boxSizeManagerOpenFor = boxSizeManagerOpenFor===supplyId ? null : supplyId;
  renderOutboundTableWrap();
}
function renderBoxSizeManager(){
  return `
    <div class="panel" style="padding:14px 16px;margin-bottom:14px;background:var(--bg)">
      <div class="eyebrow" style="margin-bottom:8px">Размеры коробов</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${boxSizes.length ? boxSizes.map(s=>`
          <span class="chip" style="cursor:default" title="${s.l&&s.w&&s.h?`${s.l}×${s.w}×${s.h} см`:'габариты не указаны'}">
            ${escapeHtml(s.name)}${s.l&&s.w&&s.h?` · ${s.l}×${s.w}×${s.h} см`:''}
            <span style="cursor:pointer;margin-left:6px;color:var(--warn)" onclick="deleteBoxSize('${s.id}')">✕</span>
          </span>
        `).join('') : `<span style="font-size:12px;color:var(--ink-faint)">Размеров пока нет</span>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="search" id="newBoxSizeName" placeholder="Название (M, XL…)" style="width:130px">
        <input class="search mono" id="newBoxSizeL" type="number" min="0" placeholder="Длина, см" style="width:100px">
        <input class="search mono" id="newBoxSizeW" type="number" min="0" placeholder="Ширина, см" style="width:100px">
        <input class="search mono" id="newBoxSizeH" type="number" min="0" placeholder="Высота, см" style="width:100px">
        <button class="btn btn-primary" onclick="addBoxSize()">+ Добавить размер</button>
      </div>
    </div>
  `;
}
function downloadBoxExcel(supplyId, boxId){
  const supply = outboundSupplies.find(s=>s.id===supplyId);
  const box = outboundBoxes.find(b=>b.id===boxId);
  if(!supply || !box) return;
  if(!box.items.length){ toast('Короб пока пуст — нечего выгружать'); return; }
  const totalQty = box.items.reduce((a,it)=>a+it.qty,0);
  const data = [
    [`Короб № ${box.boxNumber}`],
    [`Поставка: ${supply.id}`],
    [`Клиент: ${supply.clientName}`],
    [`Куда: ${supply.destination}`],
    [],
    ['Артикул','Наименование','Размер','ШК','Кол-во'],
    ...box.items.map(it=>[it.sku, it.name, it.size||'—', it.barcode||'—', it.qty]),
    [],
    ['','','','Итого:', totalQty]
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:30},{wch:10},{wch:18},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `Короб ${box.boxNumber}`);
  XLSX.writeFile(wb, `Korob_${box.boxNumber}_${supply.id}.xlsx`);
}
function downloadAllBoxesExcel(supplyId){
  const supply = outboundSupplies.find(s=>s.id===supplyId);
  const boxes = outboundBoxes.filter(b=>b.supplyId===supplyId).sort((a,b)=>a.boxNumber-b.boxNumber);
  if(!supply || !boxes.length){ toast('Пока нет ни одного короба'); return; }
  const data = [
    [`Короба по поставке № ${supply.id}`],
    [`Клиент: ${supply.clientName}`],
    [`Куда: ${supply.destination}`],
    [],
    ['Короб №','Артикул','Наименование','Размер','ШК','Кол-во']
  ];
  let grandTotal = 0;
  boxes.forEach(box=>{
    if(!box.items.length){
      data.push([box.boxNumber, '— пусто —','','','','']);
      return;
    }
    box.items.forEach(it=>{
      data.push([box.boxNumber, it.sku, it.name, it.size||'—', it.barcode||'—', it.qty]);
      grandTotal += it.qty;
    });
  });
  data.push([]);
  data.push(['','','','','Итого по всем коробам:', grandTotal]);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:10},{wch:14},{wch:30},{wch:10},{wch:18},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Короба');
  XLSX.writeFile(wb, `Koroba_${supply.id}.xlsx`);
}
function printBoxLabels(supplyId){
  const supply = outboundSupplies.find(s=>s.id===supplyId);
  const boxes = outboundBoxes.filter(b=>b.supplyId===supplyId).sort((a,b)=>a.boxNumber-b.boxNumber);
  if(!boxes.length){ toast('Сначала создайте хотя бы один короб'); return; }
  const mismatches = computeBoxMismatches(supply);
  if(mismatches.length){ toast('Сначала разложите весь товар по коробам без остатка'); return; }

  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна — разрешите всплывающие окна для этого сайта'); return; }
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>Этикетки коробов — ${supply.id}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      @page{ size: 75mm 120mm; margin: 0; }
      *{ box-sizing:border-box; }
      body{font-family:Arial,sans-serif;color:#111;margin:0;padding:0}
      .box-label{
        width:75mm; height:120mm; padding:4mm;
        page-break-after:always;
        display:flex; flex-direction:column; align-items:center;
        overflow:hidden;
      }
      .box-label:last-child{page-break-after:avoid}
      h1{font-size:22pt;margin:0 0 2mm 0;text-align:center}
      .sub{text-align:center;color:#333;margin-bottom:3mm;font-size:9pt;line-height:1.4}
      .qr-wrap{display:flex;justify-content:center;margin-bottom:3mm}
      .totals{font-size:11pt;font-weight:bold;text-align:center;margin-bottom:2mm}
      table{width:100%;border-collapse:collapse;font-size:6pt;margin-top:1mm}
      th,td{border:1px solid #333;padding:1mm;text-align:left;word-break:break-all}
      th{background:#eee}
      @media print{ body{padding:0} }
    </style></head><body>
      ${boxes.map(box=>{
        const totalQty = box.items.reduce((a,it)=>a+it.qty,0);
        return `
        <div class="box-label">
          <h1>КОРОБ №${box.boxNumber}</h1>
          <div class="sub">Поставка ${supply.id}<br>${supply.clientName}<br>Куда: ${supply.destination}</div>
          <div class="qr-wrap"><div id="qr-${box.id}"></div></div>
          <div class="totals">${box.items.length} поз. · ${totalQty} шт</div>
          <table>
            <thead><tr><th>Артикул</th><th>ШК</th><th>Разм.</th><th>Кол</th></tr></thead>
            <tbody>
              ${box.items.map(it=>`<tr><td>${it.sku}</td><td>${it.barcode||'—'}</td><td>${it.size||'—'}</td><td>${it.qty}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;}).join('')}
      <script>
        ${boxes.map(box=>{
          const payload = JSON.stringify({box:box.boxNumber, supply:supply.id, client:supply.clientName, destination:supply.destination, items:box.items.map(it=>({sku:it.sku,size:it.size||'',qty:it.qty}))});
          return `new QRCode(document.getElementById('qr-${box.id}'), {text: ${JSON.stringify(payload)}, width:100, height:100});`;
        }).join('\n')}
        window.onload = function(){ setTimeout(function(){ window.print(); }, 500); };
      <\/script>
    </body></html>
  `);
  win.document.close();
}

