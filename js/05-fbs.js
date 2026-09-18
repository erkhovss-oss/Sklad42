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
function setFbsView(view){
  fbsView = view;
  fbsCompletePage = 1;
  document.getElementById('fbsTabNew').className = 'btn ' + (view==='new'?'btn-accent':'btn-ghost');
  document.getElementById('fbsTabConfirm').className = 'btn ' + (view==='confirm'?'btn-accent':'btn-ghost');
  document.getElementById('fbsTabComplete').className = 'btn ' + (view==='complete'?'btn-accent':'btn-ghost');
  const pageSizeSelect = document.getElementById('fbsCompletePageSize');
  if(pageSizeSelect){
    pageSizeSelect.style.display = view==='complete' ? '' : 'none';
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
        <div style="display:flex;align-items:center;gap:8px">
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
            <div style="font-size:12px;color:var(--ink-faint)">${g.orders.length} заказ(ов)${missingKizInGroup?` · ⚠ КИЗ не привязан: ${missingKizInGroup}`:''}${outOfStockInGroup?` · ❌ нет на складе: ${outOfStockInGroup}`:''}</div>
          </div>
          ${isDelivered && g.supplyId ? `<button class="btn btn-ghost" style="padding:6px 12px" onclick="downloadSupplyBarcode('${escapeHtml(g.supplyId)}','${escapeHtml(g.orders[0].clientId)}')">📥 QR поставки</button>` : ''}
          <span style="font-size:18px;color:var(--ink-faint);cursor:pointer" onclick="toggleFbsSupplyGroup('${escapeHtml(key)}')">${isExpanded?'▾':'▸'}</span>
        </div>
        ${isExpanded ? `
          <div style="border-top:1px solid var(--line)">
            ${g.orders.map(o=>`
              <div class="pick-row">
                <div><div class="sku-name">${(pi=>pi.name)(findLocalProductInfo(o))}${(pi=>pi.color?` · ${escapeHtml(pi.color)}`:'')(findLocalProductInfo(o))}${o.size?` · ${o.size}`:''}${o.outOfStock?' <span style="color:var(--warn);font-weight:700">· ❌ НЕТ НА СКЛАДЕ</span>':''}</div><div class="sku-code mono">${o.article}${o.barcode?` · ШК ${o.barcode}`:''} · заказ №${o.orderId}${(pi=>pi.cell?` · яч. ${pi.cell}`:'')(findLocalProductInfo(o))}${o.orderCreatedAt?` · ${timeAgoRu(o.orderCreatedAt)}`:''}${isDelivered?'':renderKizStatusLabel(o)}</div></div>
                <div style="display:flex;gap:6px;align-items:center">
                  ${!isDelivered && clientId ? renderTrbxAssignControl(o) : ''}
                  ${isDelivered ? `<span class="status shipped">В доставке</span>` : ''}
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
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus===fbsView);
  if(!clients.some(c=>c.wbConnected)){
    body.innerHTML = `<div class="panel empty"><span class="eyebrow">Нет клиента</span>Подключите WB хотя бы одному клиенту в разделе «Клиенты»</div>`;
    return;
  }
  if(!rows.length){
    body.innerHTML = `<div class="panel empty">Заказов в этой вкладке пока нет</div>`;
    return;
  }
  if(fbsView==='new'){
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
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
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
        <div><div class="sku-name">${(pi=>pi.name)(findLocalProductInfo(o))}${(pi=>pi.color?` · ${escapeHtml(pi.color)}`:'')(findLocalProductInfo(o))}${o.size?` · ${o.size}`:''}${o.orderCreatedAt?` <span style="color:var(--accent);font-weight:700;font-size:12px">· ${timeAgoRu(o.orderCreatedAt)}</span>`:''}</div><div class="sku-code mono">${o.article} · ШК ${o.barcode||'—'} · заказ №${o.orderId}${(pi=>pi.cell?` · яч. ${pi.cell}`:'')(findLocalProductInfo(o))}${o.requiresKiz?' · требует КИЗ':''}${!clientId?` · ${escapeHtml(o.clientName)}`:''}${o.wbWarehouseId ? renderFbsWarehouseBadge(o) : ' · <span style="color:var(--ink-faint)">склад не определён</span>'}</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-accent" style="padding:6px 12px" onclick="startAssembleOrder(${o.orderId})">Собрать</button>
          <button class="btn btn-ghost" style="padding:6px 12px" onclick="hideFbsOrder(${o.orderId})" title="Убрать только у нас, у WB заказ останется как есть">Скрыть</button>
          <button class="btn btn-ghost" style="padding:6px 12px;color:var(--warn)" onclick="cancelFbsOrder(${o.orderId})">Отменить</button>
        </div>
      </div>
    `).join('')}</div>`;
  } else if(fbsView==='confirm'){
    const missingKizCount = rows.filter(o=>o.requiresKiz && o.kizStatus!=='attached').length;
    const outOfStockOrders = rows.filter(o=>o.outOfStock);
    body.innerHTML = `
      <div class="panel" style="padding:14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <span style="font-size:13px;color:var(--ink-soft)">Позиций на сборке: ${rows.length}. Когда всё собрано и промаркировано — закройте поставку и передайте на склад WB.</span>
        <div style="display:flex;gap:8px">
          ${rows.length ? `<button class="btn btn-primary" onclick="startAssemblyMode()">🚀 Режим сборки</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="enterScanMode()">🔍 Найти заказ по скану</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="printFbsPickList()">📋 Лист сборки</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="printAllFbsStickers()">🖨 Все этикетки (${rows.length})</button>` : ''}
          ${rows.length ? `<button class="btn btn-ghost" onclick="printAllFbsStickersToThermalPrinter()">🖨️ На принтер (QZ Tray)</button>` : ''}
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="openLabelSettingsModal()">⚙️ Настройки этикетки</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="forgetQzPrinter()" title="Выбрать другой принтер при следующей печати">⚙️ Сменить принтер</button>
          <button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" onclick="previewThermalInfoCard()" title="Посмотреть, что именно генерируется для принтера">👁 Предпросмотр растра</button>
          <button class="btn btn-accent" onclick="closeFbsSupply()">📦 Закрыть поставку и отправить</button>
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
                : `<div style="display:flex;gap:6px">
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
  } else {
    body.innerHTML = renderFbsGroupedBySupply(rows, clientId, true, fbsCompletePage, fbsCompletePageSize);
  }
}
let scanModeActive = false;
function enterScanMode(){
  scanModeActive = true;
  renderScanModeScreen();
}
function exitScanMode(){
  scanModeActive = false;
  assemblyModeQueue = [];
  assemblyModeIndex = 0;
  renderFbsBody();
}
function renderScanModeScreen(msg, msgIsError){
  const body = document.getElementById('fbsBody');
  body.innerHTML = `
    <div class="panel" style="padding:30px;text-align:center;max-width:520px;margin:0 auto">
      <div class="eyebrow" style="margin-bottom:10px">Найти заказ по скану</div>
      <p style="font-size:13px;color:var(--ink-soft);margin-bottom:20px">Отсканируйте стикер, уже наклеенный на товар, — заказ откроется автоматически.</p>
      <input class="search mono" id="orderScanInput" placeholder="Ждём скан…" style="width:100%;text-align:center;font-size:16px;padding:14px" autofocus
        onkeydown="if(event.key==='Enter') handleOrderScan(this)">
      ${msg ? `<p style="font-size:12px;margin-top:14px;color:${msgIsError?'var(--warn)':'var(--ok)'}">${escapeHtml(msg)}</p>` : ''}
      <button class="btn btn-ghost" style="margin-top:20px" onclick="exitScanMode()">Выйти из режима сканирования</button>
    </div>
  `;
  setTimeout(()=>{ const el = document.getElementById('orderScanInput'); if(el) el.focus(); }, 50);
}
function handleOrderScan(inputEl){
  const raw = inputEl.value.trim();
  inputEl.value = '';
  if(!raw) return;
  const clientId = document.getElementById('fbsClientSelect').value;
  const pool = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm');

  let order = pool.find(o=>String(o.orderId)===raw)
    || pool.find(o=>o.barcode && o.barcode===raw)
    || pool.find(o=>o.article && o.article===raw);

  if(!order){
    const digits = (raw.match(/\d{4,}/g) || []).sort((a,b)=>b.length-a.length);
    for(const d of digits){
      order = pool.find(o=>String(o.orderId)===d);
      if(order) break;
    }
  }

  if(!order){
    renderScanModeScreen(`Не нашёл заказ по «${raw}» — сообщите мне этот текст, донастрою сопоставление`, true);
    return;
  }

  assemblyModeQueue = [order];
  assemblyModeIndex = 0;
  renderAssemblyModeStep();
}
function startAssemblyMode(){
  scanModeActive = false;
  const clientId = document.getElementById('fbsClientSelect').value;
  assemblyModeQueue = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm');
  if(!assemblyModeQueue.length){ toast('Нет заказов на сборке'); return; }
  assemblyModeIndex = 0;
  renderAssemblyModeStep();
}
function renderAssemblyModeStep(){
  const body = document.getElementById('fbsBody');
  if(assemblyModeIndex >= assemblyModeQueue.length){
    if(scanModeActive){
      renderScanModeScreen('Заказ обработан — готов к следующему скану', false);
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
  body.innerHTML = `
    <div class="panel" style="padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="eyebrow">Режим сборки · заказ ${assemblyModeIndex+1} из ${assemblyModeQueue.length}</div>
          <h2 style="margin:6px 0 0 0">${escapeHtml(pi.name)}${pi.color?` · ${escapeHtml(pi.color)}`:''}${order.size?` · ${order.size}`:''}</h2>
        </div>
        ${pi.cell ? `<div style="background:var(--accent);color:#fff;border-radius:10px;padding:10px 20px;text-align:center;line-height:1.1"><div style="font-size:11px;opacity:0.85">ЯЧЕЙКА</div><div style="font-size:26px;font-weight:800">${pi.cell}</div></div>` : ''}
        <button class="btn btn-ghost" onclick="printNextOrderQrCard()">🖨 QR «Следующий»</button>
        <button class="btn btn-ghost" onclick="exitAssemblyMode()">✕ Завершить режим</button>
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
      <div style="display:flex;gap:8px">
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
    playBeep('ok');
    const kizInput = document.getElementById('wizardKizInput');
    if(kizInput){
      kizInput.disabled = false;
      forceEnglishInput(kizInput);
      kizInput.focus();
      toast('Теперь отсканируйте КИЗ этой единицы');
    } else {
      toast('Штрихкод подтверждён');
    }
  });
  wireWizardKizInput(order);
  if(pi.cell) announceCell(pi.cell);
  renderFixedNextOrderQr();
}
function renderFixedNextOrderQr(){
  const holder = document.getElementById('fixedNextOrderQr');
  if(!holder || holder.dataset.rendered) return;
  holder.dataset.rendered = '1';
  new QRCode(holder, {text: NEXT_ORDER_QR_CODE, width:90, height:90});
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
    <div id="wizardKizStatus" style="font-size:12px;margin-bottom:14px">${renderKizStatusLabel(order)}</div>
  `;
  forceEnglishInput(document.getElementById('wizardKizInput'));
  document.getElementById('wizardKizInput').focus();
  wireWizardKizInput(order);
}
function wireWizardKizInput(order){
  const kizInput = document.getElementById('wizardKizInput');
  if(!kizInput || kizInput.dataset.wired) return;
  kizInput.dataset.wired = '1';
  kizInput.addEventListener('keydown', (e2)=>{
    if(e2.key!=='Enter') return;
    const kizCode = kizInput.value.trim();
    kizInput.value='';
    if(!kizCode) return;
    if(kizCode===NEXT_ORDER_QR_CODE){ wizardNextOrder(); return; }
    if(kizCode.length < MIN_KIZ_LENGTH){
      playBeep('error');
      toast(`Код слишком короткий (${kizCode.length} симв.) — отсканируйте ещё раз`);
      return;
    }
    const dup = kizScans.find(k=>k.kizCode===kizCode);
    if(dup){ playBeep('error'); toast(`Этот КИЗ уже был использован ранее (${dup.name})`); return; }
    wizardAttachKiz(order, kizCode);
  });
}
function wizardAttachKiz(order, kizCode){
  toast('Отправляем КИЗ на WB…');
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'attach_kiz', orderId: order.orderId, kizCode } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    order.kizCode = kizCode;
    order.kizStatus = data.kizStatus;
    kizScans.push({kizCode, supplyId:'FBS-'+order.orderId, sku:order.article, name:order.name, size:order.size||'', clientName:order.clientName, time:new Date().toISOString()});
    sb.from('kiz_scans').insert({kiz_code:kizCode, supply_id:'FBS-'+order.orderId, sku:order.article, name:order.name, size:order.size||null, client_name:order.clientName, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{ if(error) console.error(error); });
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
    else { playBeep('warn'); toast('⚠ WB не подтвердил КИЗ — ' + (data.warning||'проверьте вручную')); }
    const statusDiv = document.getElementById('wizardKizStatus');
    if(statusDiv) statusDiv.innerHTML = renderKizStatusLabel(order);
  });
}
function wizardNextOrder(){
  const order = assemblyModeQueue[assemblyModeIndex];
  if(order && order.requiresKiz && order.kizStatus!=='attached'){
    if(!confirm('КИЗ ещё не подтверждён для этого заказа — всё равно перейти дальше?')) return;
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
function markOrderOutOfStock(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  if(!confirm(`Отметить «${order.name||order.article}» (заказ №${order.orderId}) как отсутствующий на складе? Заказ останется на сборке, но будет помечен — нужно будет вручную решить, отменять его у WB или искать замену.`)) return;
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
  assemblyModeQueue = [];
  assemblyModeIndex = 0;
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
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
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
function hideFbsOrder(orderId){
  if(!confirm('Убрать этот заказ из списка только у нас? У Wildberries и у клиента заказ останется как есть — его должен собрать тот, кто отвечает за нужный склад.')) return;
  fbsOrders = fbsOrders.filter(o=>o.orderId!==orderId);
  fbsSelectedOrders = fbsSelectedOrders.filter(id=>id!==orderId);
  toast('Заказ убран из списка (у WB не тронут)');
  renderFbsBody();
  sb.from('wb_orders').delete().eq('order_id', orderId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить локально в базе'); }
  });
}
function hideOrdersFromOtherWarehouse(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!client || !client.wbWarehouseId){ toast('У клиента не указан ID склада WB'); return; }
  const toRemove = fbsOrders.filter(o=>o.clientId===clientId && o.supplierStatus==='new' && o.wbWarehouseId && String(o.wbWarehouseId)!==String(client.wbWarehouseId));
  if(!toRemove.length){ toast('Таких заказов не найдено'); return; }
  if(!confirm(`Убрать из списка ${toRemove.length} заказ(ов) с других складов? У Wildberries они останутся как есть.`)) return;
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
  if(o.kizStatus==='attached') return ' · <span style="color:var(--ok);font-weight:700">✅ КИЗ подтверждён WB</span>';
  if(o.kizStatus==='verify_failed') return ' · <span style="color:var(--warn);font-weight:700">⚠ WB не подтвердил КИЗ</span>';
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
  if(kizCode){
    kizScans.push({kizCode, supplyId:'FBS-'+order.orderId, sku:inv.sku, name:inv.name, size:inv.size||'', clientName:order.clientName, time:new Date().toISOString()});
    sb.from('kiz_scans').insert({kiz_code:kizCode, supply_id:'FBS-'+order.orderId, sku:inv.sku, name:inv.name, size:inv.size||null, client_name:order.clientName, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
      if(error) console.error(error);
    });
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
    else if(data.kizStatus === 'verify_failed') toast(`Заказ №${order.orderId}: собран, но КИЗ WB не подтвердил — ${data.warning||'проверьте вручную'} ⚠`);
    if(skipViewSwitch) renderFbsBody();
    else if(fbsView!=='confirm') setFbsView('confirm');
    else renderFbsBody();
  });
}
function cancelFbsOrder(orderId){
  const order = fbsOrders.find(o=>o.orderId===orderId);
  if(!order) return;
  if(!confirm(`Отменить заказ №${orderId}?`)) return;
  sb.functions.invoke('wb-orders-ts', { body: { clientId: order.clientId, action:'cancel', orderId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    order.supplierStatus = 'cancel';
    fbsOrders = fbsOrders.filter(o=>o.orderId!==orderId);
    sb.from('wb_orders').update({supplier_status:'cancel'}).eq('order_id', orderId).then(()=>{});
    toast(`Заказ №${orderId} отменён`);
    renderFbsBody();
  });
}
function loadFbsTrbxes(clientId){
  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'list_trbx' } }).then(({data, error})=>{
    if(error || (data && data.error)){ console.error(error||(data&&data.error)); return; }
    fbsTrbxes = data.trbxes || [];
    fbsTrbxLoadedFor = clientId;
    renderFbsBody();
  });
}
function renderFbsTrbxPanel(clientId){
  const wrap = document.getElementById('fbsTrbxPanel');
  if(!wrap) return;
  wrap.innerHTML = `
    <div class="panel" style="padding:16px;margin-bottom:14px">
      <div class="eyebrow" style="margin-bottom:10px">Короба поставки (${fbsTrbxes.length})</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:${fbsTrbxes.length?'14px':'0'}">
        <input class="search mono" id="fbsTrbxAmount" type="number" min="1" value="1" style="width:90px">
        <button class="btn btn-ghost" onclick="createFbsTrbx('${clientId}')">+ Создать короба</button>
        ${fbsTrbxes.length ? `<button class="btn btn-accent" onclick="downloadFbsTrbxLabels('${clientId}')">📦 Скачать этикетки коробов</button>` : ''}
      </div>
      ${fbsTrbxes.length ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${fbsTrbxes.map(t=>`<span class="status planned" style="cursor:default">Короб ${String(t.id).replace('WB-TRBX-','№')} · ${(t.orders||[]).length} шт</span>`).join('')}
        </div>
      ` : `<p style="font-size:12px;color:var(--ink-faint)">Коробов ещё нет — создайте хотя бы один, чтобы распределять по ним заказы.</p>`}
    </div>
  `;
}
function createFbsTrbx(clientId){
  const amount = Math.max(1, parseInt(document.getElementById('fbsTrbxAmount').value)||1);
  toast('Создаём короба у WB…');
  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'create_trbx', amount } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    toast(`Создано коробов: ${(data.trbxIds||[]).length}`);
    loadFbsTrbxes(clientId);
  });
}
function renderTrbxAssignControl(o){
  if(!fbsTrbxes.length) return '';
  const assigned = fbsTrbxes.find(t=>(t.orders||[]).includes(o.orderId));
  if(assigned){
    return `<span class="mono" style="font-size:11px;color:var(--ink-faint)">короб ${String(assigned.id).replace('WB-TRBX-','№')}</span><button class="btn btn-ghost" style="padding:3px 8px" onclick="removeFbsTrbxOrder('${o.clientId}','${assigned.id}',${o.orderId})">✕</button>`;
  }
  return `
    <select class="search" style="width:130px;padding:4px 6px;font-size:12px" onchange="if(this.value) assignFbsTrbxOrder('${o.clientId}', this.value, ${o.orderId})">
      <option value="">в короб…</option>
      ${fbsTrbxes.map(t=>`<option value="${t.id}">Короб ${String(t.id).replace('WB-TRBX-','№')}</option>`).join('')}
    </select>
  `;
}
function assignFbsTrbxOrder(clientId, trbxId, orderId){
  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'assign_trbx_order', trbxId, orderId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    toast('Заказ привязан к коробу');
    loadFbsTrbxes(clientId);
  });
}
function removeFbsTrbxOrder(clientId, trbxId, orderId){
  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'remove_trbx_order', trbxId, orderId } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    toast('Заказ убран из короба');
    loadFbsTrbxes(clientId);
  });
}
function downloadFbsTrbxLabels(clientId){
  const client = clients.find(c=>c.id===clientId);
  if(!fbsTrbxes.length){ toast('Сначала создайте короба'); return; }
  toast('Запрашиваем стикеры коробов у WB…');
  const trbxIds = fbsTrbxes.map(t=>t.id);
  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'get_trbx_stickers', trbxIds, stickerType:'svg' } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    const stickers = data.stickers || [];
    const win = window.open('', '_blank');
    if(!win){ toast('Браузер заблокировал открытие окна'); return; }
    const pages = fbsTrbxes.map((t,idx)=>{
      const sticker = stickers.find(s=>(s.trbxId||s.id)===t.id) || stickers[idx];
      const ordersInBox = (t.orders||[]).map(oid=>fbsOrders.find(o=>o.orderId===oid)).filter(Boolean);
      const contentRows = ordersInBox.map(o=>`<tr><td>${escapeHtml(o.article)}</td><td>${escapeHtml(o.name||'')}</td><td>${escapeHtml(o.size||'—')}</td><td>${escapeHtml(o.barcode||'—')}</td></tr>`).join('');
      return `
        <div class="trbx-page">
          <h2>Короб ${String(t.id).replace('WB-TRBX-','№')}</h2>
          <div style="color:#666;font-size:12px;margin-bottom:10px">${escapeHtml(client?client.name:'')}</div>
          <table>
            <thead><tr><th>Артикул</th><th>Название</th><th>Размер</th><th>Штрихкод</th></tr></thead>
            <tbody>${contentRows || '<tr><td colspan="4">нет привязанных заказов</td></tr>'}</tbody>
          </table>
          ${sticker && sticker.file ? `<div class="qr-wrap"><img src="data:image/svg+xml;base64,${sticker.file}"></div>` : `<p style="color:#c00">QR-стикер не получен от WB</p>`}
        </div>
      `;
    }).join('');
    win.document.write(`
      <html><head><title>Этикетки коробов</title>
      <style>
        body{font-family:Arial,sans-serif;padding:10px;color:#111}
        .trbx-page{page-break-after:always;padding:16px;border:1px solid #ccc;border-radius:8px;margin-bottom:16px;max-width:420px}
        .trbx-page:last-child{page-break-after:avoid}
        h2{margin:0 0 4px 0;font-size:18px}
        table{width:100%;border-collapse:collapse;margin-bottom:14px}
        th,td{border:1px solid #333;padding:4px 6px;font-size:11px;text-align:left}
        .qr-wrap{display:flex;justify-content:center}
        .qr-wrap img{width:220px}
      </style></head><body>${pages}
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 400); };<\/script>
      </body></html>
    `);
    win.document.close();
  });
}
function closeFbsSupply(){
  const clientId = document.getElementById('fbsClientSelect').value;
  const client = clients.find(c=>c.id===clientId);
  if(!clientId){ toast('Выберите конкретного клиента, чтобы закрыть его поставку'); return; }

  const missingKiz = fbsOrders.filter(o=>o.clientId===clientId && o.supplierStatus==='confirm' && o.requiresKiz && o.kizStatus!=='attached');
  if(missingKiz.length){
    const names = missingKiz.slice(0,5).map(o=>`«${o.name||o.article}» (заказ №${o.orderId})`).join(', ');
    const more = missingKiz.length>5 ? ` и ещё ${missingKiz.length-5}` : '';
    if(!confirm(`⚠ У ${missingKiz.length} заказ(ов) не привязан КИЗ, хотя он требуется: ${names}${more}.\n\nЗакрыть поставку без КИЗ рискованно — WB может отклонить поставку или заблокировать продажу. Всё равно закрыть?`)) return;
  } else {
    if(!confirm(`Закрыть текущую поставку клиента «${client?client.name:''}» и передать на склад WB?`)) return;
  }

  sb.functions.invoke('wb-orders-ts', { body: { clientId, action:'close_supply' } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('WB: ' + (data && data.error ? data.error : (error?error.message:'ошибка'))); return; }
    fbsOrders.filter(o=>o.clientId===clientId && o.supplierStatus==='confirm').forEach(o=>{ o.supplierStatus='complete'; });
    sb.from('wb_orders').update({supplier_status:'complete'}).eq('client_id', clientId).eq('supplier_status','confirm').then(()=>{});
    fbsTrbxes = [];
    fbsTrbxLoadedFor = '';
    toast('Поставка закрыта и передана на склад WB');
    setFbsView('complete');
  });
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
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm')
    .sort((a,b)=> (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));
  if(!rows.length){ toast('Нет заказов на сборке'); return; }

  const groups = {};
  rows.forEach(o=>{
    const key = (o.barcode || o.article || String(o.orderId));
    if(!groups[key]){
      const pi = findLocalProductInfo(o);
      groups[key] = { name:pi.name, article:o.article, size:pi.size, barcode:o.barcode, color:pi.color, orders:[] };
    }
    groups[key].orders.push(o);
  });
  const groupList = Object.values(groups).sort((a,b)=> (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));

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
    orders.forEach((o, idx)=>{ if(stickers[idx] && stickers[idx].file) stickerByOrderId[o.orderId] = stickers[idx].file; });
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
  const rows = fbsOrders.filter(o=>(!clientId || o.clientId===clientId) && o.supplierStatus==='confirm')
    .sort((a,b)=> (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));
  if(!rows.length){ toast('Нет заказов на сборке'); return; }

  const groups = {};
  rows.forEach(o=>{
    const key = (o.barcode || o.article || String(o.orderId));
    if(!groups[key]){
      const pi = findLocalProductInfo(o);
      groups[key] = { name:pi.name, article:o.article, size:pi.size, barcode:o.barcode, color:pi.color, orders:[] };
    }
    groups[key].orders.push(o);
  });
  const groupList = Object.values(groups).sort((a,b)=> (a.article||'').localeCompare(b.article||'') || (a.barcode||'').localeCompare(b.barcode||''));

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
      orders.forEach((o, idx)=>{ if(stickers[idx] && stickers[idx].file) stickerByOrderId[o.orderId] = stickers[idx].file; });
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
        <div style="display:flex;gap:8px;justify-content:flex-end">
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
      <div style="display:flex;gap:10px;margin-bottom:12px">
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
      <div style="display:flex;gap:8px;justify-content:flex-end">
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
    orderId:o.order_id, clientId:o.client_id, clientName:o.client_name, nmId:o.nm_id, chrtId:o.chrt_id,
    article:o.article, barcode:o.barcode, name:o.name, size:o.size||'', price:o.price,
    supplierStatus:o.supplier_status, wbStatus:o.wb_status, wbSupplyId:o.wb_supply_id,
    kizCode:o.kiz_code, requiresKiz:o.requires_kiz||false, wbWarehouseId:o.wb_warehouse_id||'', kizStatus:o.kiz_status||null, outOfStock:o.out_of_stock||false, orderCreatedAt:o.order_created_at||null
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
  toast('Подтверждаю сборку…');
  sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'ship', postingNumber } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
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
  sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'cancel_reasons', postingNumber } }).then(({data, error})=>{
    if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
    const reasons = data.reasons || [];
    if(!reasons.length){ toast('Ozon не вернул список причин отмены'); return; }
    const list = reasons.map(r=>`${r.id} — ${r.name || r.title}`).join('\n');
    const chosen = prompt('Укажите ID причины отмены:\n' + list);
    if(!chosen) return;
    sb.functions.invoke('ozon-orders-ts', { body: { clientId: order.clientId, action:'cancel', postingNumber, cancelReasonId: chosen } }).then(({data, error})=>{
      if(error || (data && data.error)){ toast('Ozon: ' + (data?.error || error.message)); return; }
      order.status = 'cancelled';
      toast('Отправление отменено');
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
        <div style="display:flex;align-items:center;gap:8px">
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

