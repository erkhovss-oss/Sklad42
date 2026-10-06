// ---------- SUPPLIES (planned deliveries) ----------
function renderSuppliesTab(){
  document.getElementById('viewPlannedBtn').className = 'btn ' + (currentSuppliesView==='planned' ? 'btn-accent' : 'btn-ghost');
  document.getElementById('viewReceivingBtn').className = 'btn ' + (currentSuppliesView==='receiving' ? 'btn-accent' : 'btn-ghost');
  document.getElementById('suppliesBody').style.display = currentSuppliesView==='planned' ? 'block' : 'none';
  document.getElementById('receivingBody').style.display = currentSuppliesView==='receiving' ? 'block' : 'none';
  if(currentSuppliesView==='planned') renderSupplies();
  else renderReceiving();
}
function setSuppliesView(view){
  currentSuppliesView = view;
  renderSuppliesTab();
}
function downloadSupplyTemplate(){
  const data = [
    ['Артикул','Наименование','Размер','ШК','Кол-во'],
    ['TK-1001','Кроссовки Runmax','40','2460001112223',10],
    ['TK-1001','Кроссовки Runmax','41','2460001112230',8],
    ['TK-2005','Термокружка 400мл','','2460004445556',25]
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:26},{wch:10},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Поставка');
  XLSX.writeFile(wb, 'shablon_postavka.xlsx');
}
// Товары клиента для плановой поставки: уникальные по артикулу+размеру,
// без склада «БРАК» и без виртуальных наборов (их физически не привозят).
function supplyClientProducts(clientName){
  const map = new Map();
  inventory.forEach(i=>{
    if((i.client||'')!==(clientName||'')) return;
    if((i.warehouseId||'MAIN')==='BRAK') return;
    if(i.isKit && i.kitMode!=='assembled') return;
    const key = i.sku+'~~'+(i.size||'');
    const prev = map.get(key);
    if(!prev) map.set(key, {sku:i.sku, size:i.size||'', name:i.name||'', barcode:i.barcode||''});
    else {
      if(!prev.barcode && i.barcode) prev.barcode = i.barcode;
      if(!prev.name && i.name) prev.name = i.name;
    }
  });
  return [...map.values()].sort((a,b)=>
    a.sku.localeCompare(b.sku,'ru',{numeric:true}) || (a.size||'').localeCompare(b.size||'','ru',{numeric:true}));
}
function supplyProductKey(p){ return p.sku+'~~'+(p.size||''); }

// Шаблон Excel, уже заполненный товарами выбранного клиента: остаётся проставить количество.
// Строки с пустым количеством при загрузке пропускаются, так что лишние товары удалять не нужно.
function downloadClientSupplyTemplate(){
  const client = clients.find(c=>c.id===draftSupplyClientId);
  if(!client){ toast('Сначала выберите клиента — шаблон собирается из его товаров'); return; }
  const products = supplyClientProducts(client.name);
  if(!products.length){
    toast('У клиента пока нет товаров в остатках — скачан обычный шаблон с примерами');
    downloadSupplyTemplate();
    return;
  }
  const data = [['Артикул','Наименование','Размер','ШК','Кол-во']];
  products.forEach(p=>data.push([p.sku, p.name, p.size, p.barcode, '']));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:14},{wch:34},{wch:10},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Поставка');
  const safeName = client.name.replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'') || 'klient';
  XLSX.writeFile(wb, `shablon_postavka_${safeName}.xlsx`);
  toast(`Шаблон скачан: ${products.length} товаров клиента — заполните столбец «Кол-во»`);
}

// ---------- ручное добавление позиций в плановую поставку ----------
function onSupplyManualProductChange(value){
  const box = document.getElementById('supplyManualNewFields');
  if(box) box.style.display = value==='__new__' ? 'flex' : 'none';
}
// ---------- живой поиск товара клиента: по любой части названия, артикула или штрихкода ----------
const SUPPLY_MANUAL_LIMIT = 60;
let supplyManualShown = [];   // строки, показанные сейчас в выпадающем списке: [{p, barcodes, score}]
let supplyManualActive = -1;  // подсвеченная стрелками строка (последняя = «Новый товар»)
let supplyManualCloseTimer = null;

// Основной штрихкод + дополнительные штрихкоды этой позиции
function supplyProductBarcodes(p, clientName){
  const list = [];
  if(p.barcode) list.push(p.barcode);
  inventoryBarcodes.forEach(b=>{
    if(b.sku===p.sku && (b.clientName||'')===(clientName||'') && (b.size||'')===(p.size||'') && !list.includes(b.barcode)) list.push(b.barcode);
  });
  return list;
}
function supplySearchTokens(query){
  return String(query||'').toLowerCase().split(/\s+/).filter(Boolean);
}
// Каждое слово запроса должно встретиться где-нибудь в артикуле, названии, размере или штрихкоде.
// Выше всего — точное совпадение ШК/артикула, затем совпадение по началу или концу ШК
// (по последним цифрам ищут чаще всего), затем совпадения в названии/артикуле,
// и в самом конце — случайные совпадения только с цифрами штрихкода.
function supplyProductMatches(products, clientName, query){
  const tokens = supplySearchTokens(query);
  const q = String(query||'').trim().toLowerCase();
  const out = [];
  products.forEach((p, idx)=>{
    const barcodes = supplyProductBarcodes(p, clientName);
    const textHay = (p.sku+' '+p.name+' '+p.size).toLowerCase();
    const hay = textHay+' '+barcodes.join(' ').toLowerCase();
    if(!tokens.every(t=>hay.includes(t))) return;
    // совпало только за счёт цифр штрихкода (например, «34» из размера в названии
    // нашлось внутри ШК другого товара) — такие показываем ниже
    let score = tokens.every(t=>textHay.includes(t)) ? 2 : 3;
    if(q){
      const sku = p.sku.toLowerCase();
      if(sku===q || barcodes.some(b=>b===q)) score = 0;
      else if(sku.startsWith(q) || barcodes.some(b=>b.startsWith(q) || b.endsWith(q))) score = 1;
    }
    out.push({p, barcodes, score, idx});
  });
  out.sort((a,b)=>a.score-b.score || a.idx-b.idx);
  return out;
}
// Подсветка найденных фрагментов (с экранированием — названия бывают с кавычками и скобками)
function supplyHighlight(text, tokens){
  const src = String(text||'');
  const low = src.toLowerCase();
  if(!tokens.length || low.length!==src.length) return escapeHtml(src);
  const mask = new Array(src.length).fill(false);
  tokens.forEach(t=>{
    let from = 0;
    while(true){
      const i = low.indexOf(t, from);
      if(i<0) break;
      for(let k=i;k<i+t.length;k++) mask[k] = true;
      from = i + t.length;
    }
  });
  const mark = s=>`<mark style="background:#FFE7A8;color:inherit;padding:0 1px;border-radius:2px">${escapeHtml(s)}</mark>`;
  let out = '', buf = '', open = false;
  for(let i=0;i<src.length;i++){
    if(mask[i]!==open){ out += open ? mark(buf) : escapeHtml(buf); buf = ''; open = mask[i]; }
    buf += src[i];
  }
  return out + (open ? mark(buf) : escapeHtml(buf));
}
function renderSupplyManualList(){
  const box = document.getElementById('supplyManualList');
  const search = document.getElementById('supplyManualSearch');
  const client = clients.find(c=>c.id===draftSupplyClientId);
  if(!box || !search || !client) return;
  // Когда товар уже выбран, в поле стоит его название — показываем весь список, а не фильтр по нему
  const hasSelection = !!document.getElementById('supplyManualProduct').value;
  const query = hasSelection ? '' : search.value.trim();
  const products = supplyClientProducts(client.name);
  const matches = supplyProductMatches(products, client.name, query);
  const tokens = supplySearchTokens(query);
  supplyManualShown = matches.slice(0, SUPPLY_MANUAL_LIMIT);
  const newIdx = supplyManualShown.length;
  if(supplyManualActive > newIdx) supplyManualActive = -1;

  const rows = supplyManualShown.map((m,i)=>`
    <div ${i===supplyManualActive?'data-active="1"':''} style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--line);${i===supplyManualActive?'background:var(--bg)':''}"
         onmousedown="event.preventDefault();pickSupplyManualProduct(${i})">
      <div style="font-size:13px"><b>${supplyHighlight(m.p.sku, tokens)}</b>${m.p.size?` · ${supplyHighlight(m.p.size, tokens)}`:''} — ${supplyHighlight(m.p.name||'без названия', tokens)}</div>
      <div class="mono" style="font-size:11px;color:var(--ink-faint)">${m.barcodes.length ? m.barcodes.map(b=>supplyHighlight(b, tokens)).join(' · ') : 'нет штрихкода'}</div>
    </div>`).join('');
  const info = query
    ? `Найдено: ${matches.length}`
    : `Всего товаров у клиента: ${products.length}`;
  const more = matches.length>SUPPLY_MANUAL_LIMIT
    ? `<div style="padding:6px 12px;font-size:11px;color:var(--ink-faint)">Показаны первые ${SUPPLY_MANUAL_LIMIT} — введите ещё несколько символов, чтобы сузить список</div>` : '';
  const empty = (query && !matches.length)
    ? `<div style="padding:10px 12px;font-size:13px;color:var(--ink-soft)">Ничего не найдено по «${escapeHtml(query)}»</div>` : '';
  box.innerHTML = `
    <div style="padding:6px 12px;font-size:11px;color:var(--ink-faint);border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff">${info} · ↑↓ и Enter — выбрать, Esc — закрыть</div>
    ${rows}${more}${empty}
    <div ${newIdx===supplyManualActive?'data-active="1"':''} style="padding:9px 12px;cursor:pointer;font-size:13px;color:var(--accent);${newIdx===supplyManualActive?'background:var(--bg)':''}"
         onmousedown="event.preventDefault();pickSupplyManualProduct(${newIdx})">➕ Новый товар (нет в остатках)</div>`;
  box.style.display = 'block';
  const act = box.querySelector && box.querySelector('[data-active="1"]');
  if(act && act.scrollIntoView) act.scrollIntoView({block:'nearest'});
}
function openSupplyManualList(){
  clearTimeout(supplyManualCloseTimer);
  supplyManualActive = -1;
  renderSupplyManualList();
}
function closeSupplyManualList(){
  const box = document.getElementById('supplyManualList');
  if(box) box.style.display = 'none';
  supplyManualActive = -1;
}
function onSupplyManualSearchBlur(){
  supplyManualCloseTimer = setTimeout(closeSupplyManualList, 150);
}
// Человек печатает — прежний выбор недействителен, фильтруем заново
function onSupplyManualSearchInput(){
  document.getElementById('supplyManualProduct').value = '';
  onSupplyManualProductChange('');
  supplyManualActive = -1;
  renderSupplyManualList();
}
function setSupplyManualProduct(key){
  const client = clients.find(c=>c.id===draftSupplyClientId);
  const search = document.getElementById('supplyManualSearch');
  document.getElementById('supplyManualProduct').value = key;
  if(key==='__new__') search.value = '➕ Новый товар';
  else {
    const p = client ? supplyClientProducts(client.name).find(x=>supplyProductKey(x)===key) : null;
    search.value = p ? `${p.sku}${p.size?` · ${p.size}`:''} — ${p.name||'без названия'}` : '';
  }
  onSupplyManualProductChange(key);
  closeSupplyManualList();
  if(key!=='__new__') document.getElementById('supplyManualQty').focus();
}
// Товара нет в остатках — открываем форму нового товара, подставив то, что человек ввёл или отсканировал
function startNewSupplyProduct(rawQuery){
  setSupplyManualProduct('__new__');
  const q = String(rawQuery||'').trim();
  const bc = document.getElementById('supplyManualBarcode');
  const sku = document.getElementById('supplyManualSkuNew');
  const name = document.getElementById('supplyManualName');
  let focusEl = sku;
  if(/^\d{8,}$/.test(q)) bc.value = q;
  else if(/^[A-Za-z0-9._\-\/]+$/.test(q)){ sku.value = q.toUpperCase(); focusEl = name; }
  else if(q){ name.value = q; focusEl = sku; }
  focusEl.focus();
}
function pickSupplyManualProduct(i){
  if(i >= supplyManualShown.length){
    startNewSupplyProduct(document.getElementById('supplyManualProduct').value ? '' : document.getElementById('supplyManualSearch').value);
    return;
  }
  setSupplyManualProduct(supplyProductKey(supplyManualShown[i].p));
}
function onSupplyManualSearchKey(e){
  const total = supplyManualShown.length + 1; // + строка «Новый товар»
  const box = document.getElementById('supplyManualList');
  const isOpen = box && box.style.display!=='none';
  if(e.key==='ArrowDown'){
    e.preventDefault();
    if(!isOpen){ openSupplyManualList(); return; }
    supplyManualActive = (supplyManualActive+1) % total;
    renderSupplyManualList();
  } else if(e.key==='ArrowUp'){
    e.preventDefault();
    supplyManualActive = supplyManualActive<=0 ? total-1 : supplyManualActive-1;
    renderSupplyManualList();
  } else if(e.key==='Escape'){
    closeSupplyManualList();
  } else if(e.key==='Enter'){
    e.preventDefault();
    if(isOpen && supplyManualActive>=0){ pickSupplyManualProduct(supplyManualActive); return; }
    const q = String(e.target.value||'').trim();
    if(!q || document.getElementById('supplyManualProduct').value) return;
    handleSupplyManualScan(q);
  }
}
// Enter в поле поиска (в том числе от сканера штрихкодов): выбираем товар, если он определился
// однозначно; если нашлось несколько — оставляем список; если нет — предлагаем завести новый товар.
function handleSupplyManualScan(rawCode){
  const client = clients.find(c=>c.id===draftSupplyClientId);
  if(!client){ toast('Сначала выберите клиента'); return; }
  const code = String(rawCode||'').trim();
  if(!code) return;
  const products = supplyClientProducts(client.name);
  // 1) точный штрихкод (основной или дополнительный)
  const inv = findInventoryItemByBarcode(code, client.name);
  let picked = inv ? products.find(p=>p.sku===inv.sku && (p.size||'')===(inv.size||'')) : null;
  const matches = supplyProductMatches(products, client.name, code);
  // 2) точный артикул (если размер один) или единственное совпадение по части текста
  if(!picked){
    const exact = matches.filter(m=>m.score===0);
    if(exact.length===1) picked = exact[0].p;
    else if(!exact.length && matches.length===1) picked = matches[0].p;
  }
  if(picked){
    playBeep('ok');
    setSupplyManualProduct(supplyProductKey(picked));
    toast(`«${picked.name||picked.sku}»${picked.size?` (${picked.size})`:''} — укажите количество`);
    return;
  }
  if(matches.length>1){
    toast(`Найдено ${matches.length} — выберите нужный в списке или уточните запрос`);
    renderSupplyManualList();
    return;
  }
  playBeep('warn');
  toast(`«${code}» нет среди товаров клиента — заполните данные нового товара`);
  startNewSupplyProduct(code);
}
function addSupplyDraftItem(){
  const client = clients.find(c=>c.id===draftSupplyClientId);
  if(!client){ toast('Сначала выберите клиента'); return; }
  const products = supplyClientProducts(client.name);
  let selected = document.getElementById('supplyManualProduct').value;
  if(!selected){
    // набрал запрос, но не выбрал строку: если подходит ровно один товар — берём его
    const q = String(document.getElementById('supplyManualSearch').value||'').trim();
    if(q){
      const m = supplyProductMatches(products, client.name, q);
      if(m.length===1) selected = supplyProductKey(m[0].p);
    }
  }
  const qty = parseInt(document.getElementById('supplyManualQty').value, 10);
  if(!selected){ toast('Найдите товар в поиске или выберите «Новый товар»'); return; }
  if(!(qty>0)){ toast('Укажите количество больше нуля'); return; }
  let sku, size, name, barcode;
  if(selected==='__new__'){
    sku = document.getElementById('supplyManualSkuNew').value.trim().toUpperCase();
    size = document.getElementById('supplyManualSize').value.trim();
    name = document.getElementById('supplyManualName').value.trim();
    barcode = document.getElementById('supplyManualBarcode').value.trim();
    if(!sku){ toast('Укажите артикул нового товара'); return; }
    const known = products.find(p=>p.sku===sku && (p.size||'')===size);
    if(known){ name = name || known.name; barcode = barcode || known.barcode; }
    if(barcode){
      const owner = findInventoryItemByBarcode(barcode, client.name);
      if(owner && !(owner.sku===sku && (owner.size||'')===size)){
        toast(`Штрихкод ${barcode} уже принадлежит товару «${owner.name}» (${owner.sku}) — проверьте артикул`);
        return;
      }
    }
    name = name || sku;
  } else {
    const p = products.find(x=>supplyProductKey(x)===selected);
    if(!p){ toast('Этого товара уже нет в остатках клиента — выберите другой'); return; }
    sku = p.sku; size = p.size||''; name = p.name||p.sku; barcode = p.barcode||'';
  }
  const existing = draftSupplyItems.find(d=>d.sku===sku && (d.size||'')===size);
  if(existing) existing.qty += qty;
  else draftSupplyItems.push({sku, size, name, qty, barcode});
  toast(`Добавлено: ${name}${size?` (${size})`:''} — ${qty} шт${existing?` (теперь ${existing.qty})`:''}`);
  renderSuppliesCreatePanel();
  const search = document.getElementById('supplyManualSearch');
  if(search) search.focus();
}
function setSupplyDraftQty(idx, value){
  const q = parseInt(value, 10);
  const item = draftSupplyItems[idx];
  if(!item) return;
  if(!(q>0)){ toast('Количество должно быть больше нуля — чтобы убрать позицию, нажмите ✕'); renderSuppliesCreatePanel(); return; }
  item.qty = q;
  const el = document.getElementById('supplyDraftSummary');
  if(el) el.textContent = supplyDraftSummaryText();
}
function removeSupplyDraftItem(idx){
  draftSupplyItems.splice(idx, 1);
  if(!draftSupplyItems.length) draftSupplyFileName = '';
  renderSuppliesCreatePanel();
}
async function clearSupplyDraft(){
  if(!draftSupplyItems.length) return;
  if(!await customConfirm(`Очистить весь список (${draftSupplyItems.length} поз.)?`, {okText:'Очистить'})) return;
  draftSupplyItems = [];
  draftSupplyFileName = '';
  renderSuppliesCreatePanel();
}
function supplyDraftSummaryText(){
  if(!draftSupplyItems.length) return 'Список пуст — загрузите Excel или добавьте товары вручную';
  const total = draftSupplyItems.reduce((s,d)=>s+d.qty,0);
  return `${draftSupplyFileName ? `Файл: ${draftSupplyFileName} · ` : ''}${draftSupplyItems.length} SKU · ${total} шт`;
}
// Список позиций привязан к каталогу конкретного клиента — при смене клиента не оставляем чужие товары.
async function setDraftSupplyClient(id){
  if(id !== draftSupplyClientId && draftSupplyItems.length){
    const ok = await customConfirm(`В списке уже ${draftSupplyItems.length} поз. другого клиента. При смене клиента список будет очищен. Продолжить?`, {okText:'Сменить и очистить'});
    if(!ok){ renderSuppliesCreatePanel(); return; }
    draftSupplyItems = [];
    draftSupplyFileName = '';
  }
  draftSupplyClientId = id;
  renderSuppliesCreatePanel();
}
function handleSupplyExcelUpload(inputEl){
  const file = inputEl.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(e){
    try{
      const workbook = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
      const client = clients.find(c=>c.id===draftSupplyClientId);
      const items = [];
      let unmatched = 0;
      for(let i=1;i<rows.length;i++){ // строка 0 — заголовок
        const row = rows[i];
        if(!row || !row.length) continue;
        const sku = String(row[0]||'').trim().toUpperCase();
        const nameFromFile = String(row[1]||'').trim();
        const size = String(row[2]||'').trim();
        const barcode = String(row[3]||'').trim();
        const qty = parseInt(row[4]) || 0;
        if(!sku || qty<=0) continue;
        // если клиент уже выбран — ищем товар только среди его товаров, чтобы не подтянуть чужой штрихкод
        const invItem = inventory.find(x=>x.sku===sku && (x.size||'')===size && (!client || (x.client||'')===client.name));
        const name = nameFromFile || (invItem ? invItem.name : sku);
        const finalBarcode = barcode || (invItem ? invItem.barcode||'' : '');
        if(!invItem) unmatched++;
        const existing = items.find(d=>d.sku===sku && (d.size||'')===size);
        if(existing) existing.qty += qty;
        else items.push({sku, size, name, qty, barcode: finalBarcode});
      }
      if(items.length===0){
        toast('В файле не найдено строк с артикулом и количеством — заполните столбец «Кол-во»');
        inputEl.value = '';
        return;
      }
      if(draftSupplyItems.length){
        const ok = await customConfirm(`В списке уже ${draftSupplyItems.length} поз. Заменить их содержимым файла (${items.length} SKU)?`, {okText:'Заменить'});
        if(!ok){ inputEl.value = ''; return; }
      }
      draftSupplyItems = items;
      draftSupplyFileName = file.name;
      toast(`Файл прочитан: ${items.length} SKU${unmatched?`, ${unmatched} не найдены в остатках`:''}`);
      renderSuppliesCreatePanel();
    }catch(err){
      console.error(err);
      toast('Не удалось прочитать файл — проверьте формат Excel');
    }
    inputEl.value = '';
  };
  reader.readAsArrayBuffer(file);
}
function createSupply(){
  const client = clients.find(c=>c.id===draftSupplyClientId);
  if(!client){ toast('Выберите клиента склада / ИП'); return; }
  if(draftSupplyItems.length===0){ toast('Добавьте позиции: загрузите Excel или добавьте товары вручную'); return; }
  const requiresKiz = document.getElementById('draftSupplyRequiresKiz').checked;
  const warehouseId = document.getElementById('supplyWarehouseSelect').value || 'MAIN';
  const id = 'ПС-' + Date.now();
  const createdAt = new Date();
  const items = draftSupplyItems.map(d=>({...d, receivedQty:0}));
  supplies.unshift({
    id, clientId: client.id, clientName: client.name,
    createdAt, items, status: 'planned', requiresKiz, warehouseId
  });
  draftSupplyItems = [];
  draftSupplyClientId = '';
  draftSupplyFileName = '';
  draftSupplyRequiresKiz = false;
  draftSupplyWarehouseId = 'MAIN';
  toast(`Поставка создана — статус «Едет» (склад: ${warehouseName(warehouseId)})`);
  renderSupplies();
  sb.from('supplies').insert({id, client_id: client.id, client_name: client.name, status:'planned', created_at: createdAt.toISOString(), requires_kiz: requiresKiz, warehouse_id: warehouseId}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить поставку в базе'); return; }
    const rows = items.map(it=>({supply_id:id, sku:it.sku, name:it.name, qty:it.qty, received_qty:0, barcode: it.barcode || null, size: it.size || null}));
    sb.from('supply_items').insert(rows).then(({error})=>{
      if(error){ console.error(error); toast('Не удалось сохранить позиции поставки в базе'); }
    });
  });
}
function toggleSupplyReceiving(id){
  const supply = supplies.find(s=>s.id===id);
  if(!supply) return;
  if(activeSupplyId !== id){ lastScanInfo = null; scanHistory = []; pendingKizItem = null; delete receivingToBrak[id]; }
  activeSupplyId = activeSupplyId===id ? null : id;
  renderSuppliesTableWrap();
}
// Сохраняет «принято всего» и «из них брак» по строке поставки (оба числа вместе)
function saveSupplyItemCounts(supplyId, item){
  const q = sb.from('supply_items').update({received_qty: item.receivedQty, defect_qty: item.defectQty||0})
    .eq('supply_id', supplyId).eq('sku', item.sku);
  return item.size ? q.eq('size', item.size) : q.is('size', null);
}
function adjustSupplyItem(supplyId, sku, delta, size){
  size = size || '';
  const supply = supplies.find(s=>s.id===supplyId);
  const toBrak = !!receivingToBrak[supplyId];
  const warehouseId = toBrak ? 'BRAK' : (supply.warehouseId || 'MAIN');
  const item = supply.items.find(i=>i.sku===sku && (i.size||'')===size);
  const defect = Math.min(item.defectQty||0, item.receivedQty);
  let diff;
  if(toBrak){
    // при включённом «Принимать как брак» кнопки +/− меняют именно количество брака
    const newDefect = Math.max(0, defect + delta);
    diff = newDefect - defect;
    if(diff===0){ if(delta<0) toast('Брака по этой позиции нет — чтобы убрать годные, выключите «Принимать как брак»'); return; }
    item.defectQty = newDefect;
  } else {
    const good = item.receivedQty - defect;
    const newGood = Math.max(0, good + delta);
    diff = newGood - good;
    if(diff===0){ if(delta<0 && defect>0) toast('Годных по этой позиции нет — остался только брак (включите «Принимать как брак», чтобы убрать его)'); return; }
  }
  const wasOver = item.receivedQty > item.qty;
  item.receivedQty += diff;
  let inv = item.barcode ? findInventoryItemByBarcode(item.barcode, supply.clientName, warehouseId) : findInventoryItem(sku, supply.clientName, size, warehouseId);
  if(!inv){
    inv = {sku, name: item.name, qty:0, client: supply.clientName, size, barcode: item.barcode||'', warehouseId};
    inventory.push(inv);
  }
  inv.qty = Math.max(0, inv.qty + diff);
  if(diff>0) logReceipt(inv.sku, inv.name, diff, inv.client, inv.size, warehouseId);
  else logMovement(inv.sku, inv.name, diff, 'Корректировка приёмки поставки', inv.client, inv.size, warehouseId);
  pushRecentAction({name:item.name + (size?` (${size})`:''), sku, qty:diff, cell:toBrak?'БРАК':inv.cell, note: toBrak ? 'вручную · брак' : 'вручную'});
  if(diff>0 && item.receivedQty>item.qty && !wasOver) toast(`«${item.name}»${size?` (${size})`:''}: принято больше, чем заказано (${item.receivedQty} из ${item.qty})`);
  renderSuppliesTableWrap();
  saveSupplyItemCounts(supplyId, item).then(({error})=>{
    if(error) console.error(error);
  }).catch(e=>{ console.error(e); toast('Нет связи с базой — количество не сохранилось, повторите'); });
}
function finishSupplyReceiving(id){
  const supply = supplies.find(s=>s.id===id);
  const mismatches = supply.items.filter(i=>i.receivedQty !== i.qty);
  const defectTotal = supply.items.reduce((a,i)=>a+Math.min(i.defectQty||0, i.receivedQty),0);
  const defectNote = defectTotal ? `, из них брак ${defectTotal} шт` : '';
  supply.status = 'received';
  activeSupplyId = null;
  if(mismatches.length){
    toast(`Поставка ${id} принята — расхождение по ${mismatches.length} из ${supply.items.length} поз.${defectNote}`);
  } else {
    toast(`Поставка ${id} принята полностью, без расхождений${defectNote}`);
  }
  renderSuppliesTableWrap();
  sb.from('supplies').update({status:'received'}).eq('id', id).then(({error})=>{ if(error) console.error(error); });
}
function saveUpdNumber(id){
  const supply = supplies.find(s=>s.id===id);
  const val = document.getElementById('updNumber-'+id).value.trim();
  supply.updNumber = val;
  toast('Номер УПД сохранён');
  sb.from('supplies').update({upd_number: val}).eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить номер УПД в базе'); }
  });
}
// «Принято» = всё, что физически пришло (годное + брак); «в т.ч. брак» — часть принятого,
// оформленная на склад «БРАК»; «расхождение» считается по принятому количеству, как и раньше.
function buildActRows(s){
  return s.items.map((it, idx)=>{
    const defect = Math.min(it.defectQty||0, it.receivedQty||0);
    return {
      n: idx+1, sku: it.sku, size: it.size||'—', barcode: it.barcode||'—', name: it.name,
      plan: it.qty, fact: it.receivedQty, defect, good: it.receivedQty - defect, diff: it.receivedQty - it.qty
    };
  });
}
function actSummary(rows){
  return {
    totalPlan: rows.reduce((a,r)=>a+r.plan,0),
    totalFact: rows.reduce((a,r)=>a+r.fact,0),
    totalDefect: rows.reduce((a,r)=>a+(r.defect||0),0),
    totalGood: rows.reduce((a,r)=>a+(r.good!==undefined ? r.good : r.fact),0),
    mismatches: rows.filter(r=>r.diff!==0).length,
    withDefect: rows.filter(r=>(r.defect||0)>0).length
  };
}
// Плашки итога под таблицей акта: расхождения и/или брак (общий код для актов склада и портала клиента)
function actStatusPillsHtml(summary){
  if(summary.mismatches===0 && summary.totalDefect===0) return `<span class="status-pill ok">✅ Без расхождений</span>`;
  return `<span style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
    ${summary.mismatches ? `<span class="status-pill bad">⚠ Расхождений: ${summary.mismatches} поз.</span>` : `<span class="status-pill ok">✅ Без расхождений по количеству</span>`}
    ${summary.totalDefect ? `<span class="status-pill bad">⚠ Брак: ${summary.totalDefect} шт</span>` : ''}
  </span>`;
}
function actDefectNoteHtml(summary){
  return summary.totalDefect
    ? `<p style="margin:14px 0 0 0;font-size:12px;color:var(--ink-soft);line-height:1.6">Товар, принятый как брак (${summary.totalDefect} шт), размещён на отдельном складе «БРАК» и маркетплейсам не передаётся. Количество «Принято» включает брак; годного к продаже — ${summary.totalGood} шт.</p>`
    : '';
}
function saveActNumber(id){
  const s = supplies.find(x=>x.id===id);
  const actNumber = document.getElementById('actNumber-'+id).value.trim() || id;
  s.actNumber = actNumber;
  sb.from('supplies').update({act_number: actNumber}).eq('id', id).then(({error})=>{
    if(error) console.error(error);
  });
  return actNumber;
}
function downloadMx1Excel(id){
  const s = supplies.find(x=>x.id===id);
  const client = clients.find(c=>c.id===s.clientId);
  if(!client){ toast('Клиент не найден'); return; }
  const seller = companySettings;
  const pricePerUnit = s.updPricePerUnit || 0;
  const actDate = new Date(s.createdAt).toLocaleDateString('ru-RU');

  const data = [];
  data.push(['', '', '', '', '', '', '', 'Унифицированная форма № МХ-1']);
  data.push(['', '', '', '', '', '', '', 'Утверждена постановлением Госкомстата России от 09.08.99 № 66']);
  data.push([]);
  data.push([`Организация-хранитель: ${seller.name||'—'}`, '', '', '', '', 'ИНН', seller.inn||'—']);
  data.push([`Адрес: ${seller.legalAddress||'—'}`]);
  data.push([]);
  data.push([`Поклажедатель: ${client.name||'—'}`, '', '', '', '', 'ИНН', client.inn||'—']);
  data.push([`Адрес: ${client.legalAddress||'—'}`]);
  data.push([]);
  data.push([`АКТ № ${s.id}`, '', '', `Дата составления: ${actDate}`]);
  data.push(['О ПРИЕМЕ-ПЕРЕДАЧЕ ТОВАРНО-МАТЕРИАЛЬНЫХ ЦЕННОСТЕЙ НА ХРАНЕНИЕ']);
  data.push([]);
  data.push([`Склад ответственного хранения: ${warehouseName(s.warehouseId)}`]);
  data.push(['Срок хранения: по договору']);
  data.push([]);
  data.push(['№ п/п','Наименование, вид упаковки','Код (артикул)','Ед. изм.','Код ОКЕИ','Количество','Цена, руб.коп.','Стоимость, руб.коп.']);
  let totalQty = 0, totalSum = 0;
  s.items.forEach((it,idx)=>{
    const qty = it.receivedQty;
    totalQty += qty;
    const sum = pricePerUnit ? qty*pricePerUnit : '';
    if(pricePerUnit) totalSum += qty*pricePerUnit;
    data.push([idx+1, it.name + (it.size?` (${it.size})`:''), it.sku, 'шт', '796', qty, pricePerUnit||'', sum]);
  });
  data.push(['', '', '', '', 'Всего по акту:', totalQty, 'Х', pricePerUnit?totalSum.toFixed(2):'']);
  data.push([]);
  data.push(['Условия хранения:', '']);
  data.push([]);
  data.push(['Особые отметки:', '']);
  data.push([]);
  data.push([]);
  data.push(['Товарно-материальные ценности на хранение']);
  data.push(['Сдал', '(должность)', '', '(подпись)', '', client.directorName||'(расшифровка подписи)']);
  data.push(['М.П.']);
  data.push([]);
  data.push(['Принял', '(должность)', '', '(подпись)', '', seller.directorName||'(расшифровка подписи)']);
  data.push(['М.П.']);

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:6},{wch:42},{wch:14},{wch:8},{wch:8},{wch:10},{wch:12},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'МХ-1');
  XLSX.writeFile(wb, `MX1_${s.id}.xlsx`);
}
function downloadSupplyActExcel(id){
  const s = supplies.find(x=>x.id===id);
  const client = clients.find(c=>c.id===s.clientId);
  const wh = getWarehouseInfo();
  const actNumber = saveActNumber(id);
  const rows = buildActRows(s);
  const summary = actSummary(rows);
  const today = new Date().toLocaleDateString('ru-RU');

  const data = [
    [`Акт приёмки № ${actNumber} от ${today}`],
    [],
    [`Исполнитель (склад): ${wh.name||'—'}`, '', '', 'ИНН', wh.inn||'—'],
    [`Клиент: ${s.clientName}`, '', '', 'ИНН', (client&&client.inn)||'—'],
    [`Поставка: ${s.id}`, '', '', 'Склад', warehouseName(s.warehouseId)],
    [],
    ['№','Артикул','Размер','ШК товара','Наименование','План, шт','Принято, шт','в т.ч. брак, шт','Расхождение'],
    ...rows.map(r=>[r.n, r.sku, r.size, r.barcode, r.name, r.plan, r.fact, r.defect>0 ? r.defect : '—', r.diff!==0 ? (r.diff>0?'+':'')+r.diff : '—']),
    [],
    ['','','','','Итого:', summary.totalPlan, summary.totalFact, summary.totalDefect || '—', summary.mismatches ? `Расхождений: ${summary.mismatches} поз.` : 'Без расхождений'],
    ...(summary.totalDefect ? [['','','','','Годного к продаже, шт:', summary.totalGood], ['Брак размещён на отдельном складе «БРАК» и маркетплейсам не передаётся.']] : []),
    [],
    ['Принял (склад)', '', '(подпись)', '', '(расшифровка подписи)'],
    [],
    ['Сдал (поставщик)', '', '(подпись)', '', client&&client.directorName ? client.directorName : '(расшифровка подписи)'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:4},{wch:14},{wch:10},{wch:18},{wch:32},{wch:10},{wch:12},{wch:15},{wch:18}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Акт приёмки');
  XLSX.writeFile(wb, `Akt_priemki_${actNumber}.xlsx`);
}
function generateUpd(id){
  const s = supplies.find(x=>x.id===id);
  const client = clients.find(c=>c.id===s.clientId);
  if(!client){ toast('Клиент не найден'); return; }
  const docNumber = document.getElementById('updDocNumber-'+id).value.trim() || id;
  const pricePerUnit = parseFloat(document.getElementById('updPricePerUnit-'+id).value) || 0;
  const vatRate = parseInt(document.getElementById('updVatRate-'+id).value) || 0;
  // цена необязательна — если не указана, суммы в документе останутся пустыми/нулевыми
  s.updDocNumber = docNumber; s.updPricePerUnit = pricePerUnit; s.updVatRate = vatRate;
  sb.from('supplies').update({upd_doc_number:docNumber, upd_price_per_unit:pricePerUnit, upd_vat_rate:vatRate}).eq('id', id).then(({error})=>{ if(error) console.error(error); });

  const seller = companySettings;
  const today = new Date().toLocaleDateString('ru-RU');
  const rows = s.items.map((it,idx)=>{
    const qty = it.receivedQty;
    const sumNoVat = qty * pricePerUnit;
    const vatSum = vatRate ? sumNoVat * vatRate / 100 : 0;
    const sumWithVat = sumNoVat + vatSum;
    return {n:idx+1, name: it.name + (it.size?` (${it.size})`:''), sku:it.sku, qty, price:pricePerUnit, sumNoVat, vatRate, vatSum, sumWithVat};
  });
  const totalNoVat = rows.reduce((a,r)=>a+r.sumNoVat,0);
  const totalVat = rows.reduce((a,r)=>a+r.vatSum,0);
  const totalWithVat = rows.reduce((a,r)=>a+r.sumWithVat,0);

  const win = window.open('', '_blank');
  if(!win){ toast('Браузер заблокировал открытие окна — разрешите всплывающие окна для этого сайта'); return; }
  win.document.write(`
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>УПД № ${docNumber}</title>
    <style>
      body{font-family:Arial,sans-serif;font-size:11px;padding:20px;color:#111}
      h1{font-size:15px;text-align:center;margin-bottom:2px}
      .sub{text-align:center;font-size:11px;margin-bottom:14px}
      .parties{display:flex;gap:20px;margin-bottom:14px}
      .party{flex:1;border:1px solid #333;padding:8px;font-size:10px}
      .party b{display:block;margin-bottom:4px;font-size:11px}
      table{width:100%;border-collapse:collapse;margin-bottom:14px}
      th,td{border:1px solid #333;padding:4px 6px;font-size:10px;text-align:left}
      th{background:#f2f2f2;text-align:center}
      td.num{text-align:right}
      .totals-row td{font-weight:bold;background:#f7f7f7}
      .sign{display:flex;justify-content:space-between;gap:30px;margin-top:40px}
      .sign > div{flex:1}
      .line{border-bottom:1px solid #333;margin-top:34px;margin-bottom:4px}
      .small{font-size:9px;color:#666}
      @media print{ body{padding:8px} }
    </style></head><body>
      <h1>УНИВЕРСАЛЬНЫЙ ПЕРЕДАТОЧНЫЙ ДОКУМЕНТ</h1>
      <div class="sub">№ ${escapeHtml(docNumber)} от ${today} · Статус документа: 2 (передаточный документ)</div>

      <div class="parties">
        <div class="party">
          <b>Продавец / Исполнитель (грузоотправитель)</b>
          ${escapeHtml(seller.name||'—')}<br>
          ИНН ${escapeHtml(seller.inn||'—')} ${seller.kpp?`КПП ${escapeHtml(seller.kpp)}`:''}<br>
          Адрес: ${escapeHtml(seller.legalAddress||'—')}<br>
          ${seller.bankDetails?`Банк: ${escapeHtml(seller.bankDetails)}<br>`:''}
          Руководитель: ${escapeHtml(seller.directorName||'—')}
        </div>
        <div class="party">
          <b>Покупатель (грузополучатель)</b>
          ${escapeHtml(client.name||'—')}<br>
          ИНН ${escapeHtml(client.inn||'—')} ${client.kpp?`КПП ${escapeHtml(client.kpp)}`:''}<br>
          Адрес: ${escapeHtml(client.legalAddress||'—')}<br>
          ${client.bankDetails?`Банк: ${escapeHtml(client.bankDetails)}<br>`:''}
          Руководитель: ${escapeHtml(client.directorName||'—')}
        </div>
      </div>

      <p style="font-size:10px">Основание передачи: приёмка товара на склад по поставке № ${s.id} от ${new Date(s.createdAt).toLocaleDateString('ru-RU')}. Склад: ${escapeHtml(warehouseName(s.warehouseId))}.</p>

      <table>
        <thead><tr>
          <th>№</th><th>Наименование товара</th><th>Артикул</th><th>Ед. изм.</th><th>Кол-во</th>
          <th>Цена, ₽</th><th>Сумма без НДС, ₽</th><th>Ставка НДС</th><th>Сумма НДС, ₽</th><th>Сумма с НДС, ₽</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr>
              <td>${r.n}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.sku)}</td><td>шт</td>
              <td class="num">${r.qty}</td><td class="num">${r.price.toFixed(2)}</td><td class="num">${r.sumNoVat.toFixed(2)}</td>
              <td class="num">${r.vatRate?r.vatRate+'%':'Без НДС'}</td><td class="num">${r.vatSum.toFixed(2)}</td><td class="num">${r.sumWithVat.toFixed(2)}</td>
            </tr>
          `).join('')}
          <tr class="totals-row">
            <td colspan="6">Итого:</td>
            <td class="num">${totalNoVat.toFixed(2)}</td><td></td><td class="num">${totalVat.toFixed(2)}</td><td class="num">${totalWithVat.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div class="sign">
        <div>
          Товар (груз) передал / Услуги, результаты работ сдал<div class="line"></div>
          <span class="small">${escapeHtml(seller.directorName||'подпись / расшифровка подписи')}</span>
        </div>
        <div>
          Товар (груз) получил / Услуги, результаты работ принял<div class="line"></div>
          <span class="small">${escapeHtml(client.directorName||'подпись / расшифровка подписи')}</span>
        </div>
      </div>
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 300); };<\/script>
    </body></html>
  `);
  win.document.close();
}
function generateSupplyActPdf(id){
  const s = supplies.find(x=>x.id===id);
  const actNumber = saveActNumber(id);
  const rows = buildActRows(s);
  const summary = actSummary(rows);
  const client = clients.find(c=>c.id===s.clientId);

  let wh = getWarehouseInfo();
  if(!wh.name){
    editWarehouseInfo();
    wh = getWarehouseInfo();
    if(!wh.name) wh.name = 'ТелеПак';
  }

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
            <div class="brand-name">${wh.name}</div>
            <div class="eyebrow" style="margin-top:2px">Акт приёмки товара</div>
          </div>
        </div>
        <div>
          <h1>№ ${escapeHtml(actNumber)}</h1>
          <div class="sub-date">${dateStr}</div>
        </div>
      </div>

      <div class="cards">
        <div class="card">
          <div class="eyebrow">Исполнитель (склад)</div>
          <div class="name">${escapeHtml(wh.name)}</div>
          <div class="detail">${wh.inn?`ИНН ${escapeHtml(wh.inn)}`:''}</div>
        </div>
        <div class="card">
          <div class="eyebrow">Клиент</div>
          <div class="name">${escapeHtml(s.clientName)}</div>
          <div class="detail">${client&&client.inn?`ИНН ${escapeHtml(client.inn)}`:''}</div>
        </div>
        <div class="card">
          <div class="eyebrow">Поставка</div>
          <div class="name mono">№ ${escapeHtml(s.id)}</div>
          <div class="detail">${warehouseName(s.warehouseId)}</div>
        </div>
      </div>

      <table>
        <thead><tr><th>№</th><th>Артикул</th><th>Размер</th><th>ШК товара</th><th>Наименование</th><th class="num">План, шт</th><th class="num">Принято, шт</th><th class="num">в т.ч. брак, шт</th><th class="num">Расхождение</th></tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr class="${(r.diff!==0 || r.defect>0)?'mismatch':''}">
              <td class="mono">${r.n}</td><td class="mono">${escapeHtml(r.sku)}</td><td>${escapeHtml(r.size)}</td><td class="mono">${escapeHtml(r.barcode)}</td><td>${escapeHtml(r.name)}</td>
              <td class="num">${r.plan}</td><td class="num">${r.fact}</td>
              <td class="num ${r.defect>0?'diff-bad':'diff-ok'}">${r.defect>0 ? r.defect : '—'}</td>
              <td class="num ${r.diff!==0?'diff-bad':'diff-ok'}">${r.diff!==0 ? (r.diff>0?'+':'')+r.diff : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="summary-row">
        <div class="summary-nums">
          <div class="stat"><div class="val">${summary.totalPlan}</div><div class="lbl">По плану, шт</div></div>
          <div class="stat"><div class="val">${summary.totalFact}</div><div class="lbl">Принято, шт</div></div>
          ${summary.totalDefect ? `<div class="stat"><div class="val" style="color:var(--warn)">${summary.totalDefect}</div><div class="lbl">в т.ч. брак, шт</div></div><div class="stat"><div class="val">${summary.totalGood}</div><div class="lbl">Годных, шт</div></div>` : ''}
        </div>
        ${actStatusPillsHtml(summary)}
      </div>
      ${actDefectNoteHtml(summary)}

      <div class="sign">
        <div><div class="role">Принял (склад)</div><div class="line"></div><span class="small">подпись / расшифровка подписи</span></div>
        <div><div class="role">Сдал (поставщик)</div><div class="line"></div><span class="small">подпись / расшифровка подписи</span></div>
      </div>
      <div class="footer">Сформировано в ${escapeHtml(wh.name)} · ${dateStr}</div>
      <script>window.onload=function(){ setTimeout(function(){ window.print(); }, 350); };<\/script>
    </body></html>
  `);
  win.document.close();
}
function renderSupplyDeleteControl(s){
  if(deletingSupplyId === s.id){
    return `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 10px;background:var(--warn-bg);border-radius:8px">
        <span style="font-size:12px;color:var(--warn)">Удалить поставку ${s.id} без возможности восстановить?</span>
        <button class="btn btn-accent" style="padding:5px 10px" onclick="confirmDeleteSupply('${s.id}')">Да, удалить</button>
        <button class="btn btn-ghost" style="padding:5px 10px" onclick="cancelDeleteSupply()">Отмена</button>
      </div>
    `;
  }
  return `<button class="btn btn-ghost" style="padding:5px 10px;color:var(--warn)" onclick="openDeleteSupply('${s.id}')">Удалить поставку</button>`;
}
function openDeleteSupply(id){ deletingSupplyId = id; renderSuppliesTableWrap(); }
function cancelDeleteSupply(){ deletingSupplyId = null; renderSuppliesTableWrap(); }
function confirmDeleteSupply(id){
  const s = supplies.find(x=>x.id===id);
  supplies = supplies.filter(x=>x.id!==id);
  deletingSupplyId = null;
  if(activeSupplyId===id) activeSupplyId = null;
  toast(`Поставка ${id} удалена. Уже принятый по ней товар на складе остался как есть.`);
  renderSuppliesTableWrap();
  sb.from('supplies').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить поставку в базе'); }
  });
}
function renderSupplyReceivingPanel(s){
  if(s.status === 'received'){
    const totalQty = s.items.reduce((a,i)=>a+i.qty,0);
    const totalReceived = s.items.reduce((a,i)=>a+i.receivedQty,0);
    const mismatches = s.items.filter(i=>i.receivedQty !== i.qty);
    const supplyClient = clients.find(c=>c.id===s.clientId);
    const clientHasLegalInfo = supplyClient && supplyClient.inn;
    return `
      <div style="border-top:1px solid var(--line);padding:16px 18px;background:var(--panel)" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <div class="eyebrow">Итог приёмки</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--ink-soft)">№ УПД:</span>
            <input class="search mono" id="updNumber-${s.id}" value="${s.updNumber||''}" placeholder="напр. УПД-000123" style="width:170px">
            <button class="btn btn-ghost" style="padding:5px 10px" onclick="saveUpdNumber('${s.id}')">Сохранить</button>
          </div>
        </div>
        <div style="margin-bottom:14px">${renderSupplyDeleteControl(s)}</div>
        <div class="stat-row" style="margin-bottom:14px">
          <div class="stat"><div class="val">${totalQty}</div><div class="lbl">Заказано</div></div>
          <div class="stat"><div class="val">${totalReceived}</div><div class="lbl">Принято</div></div>
          <div class="stat"><div class="val" style="color:${mismatches.length?'var(--warn)':'var(--ok)'}">${mismatches.length}</div><div class="lbl">Позиций с расхождением</div></div>
        </div>
        ${s.requiresKiz ? `
          <button class="btn btn-ghost" style="margin-bottom:10px" onclick="downloadKizExcel('${s.id}')">📊 Скачать КИЗ (Excel) — ${kizScans.filter(k=>k.supplyId===s.id).length} шт</button>
          <button class="btn btn-ghost" style="margin-bottom:10px;margin-left:8px;color:var(--warn)" onclick="removeAllKizScans('${s.id}')">🗑 Удалить все КИЗ</button>
          <div class="panel" style="margin-bottom:14px;max-height:240px;overflow-y:auto;padding:4px 12px">
            ${renderKizScansList(s.id)}
          </div>
        ` : ''}
        <div class="panel">
          ${s.items.map(it=>{
            const diff = it.receivedQty - it.qty;
            const mismatch = diff !== 0;
            return `<div class="pick-row" ${mismatch?'style="background:var(--warn-bg)"':''}>
              <div><div class="sku-name">${it.name}${it.size?` · размер ${it.size}`:''}</div><div class="sku-code mono">${it.sku}${it.barcode?` · ШК ${it.barcode}`:''}</div></div>
              <div class="qty-need">план ${it.qty} / факт ${it.receivedQty}${mismatch ? `<span style="color:var(--warn);font-weight:700;margin-left:8px">${diff>0?'+':''}${diff}</span>` : ''}${(it.defectQty||0)>0 ? `<span style="color:var(--warn);font-weight:700;margin-left:8px" title="Принято как брак — на складе «БРАК»">⚠ брак ${Math.min(it.defectQty, it.receivedQty)}</span>` : ''}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="eyebrow">Акт приёмки</div>
            <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px" onclick="editWarehouseInfo()">Реквизиты исполнителя</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <input class="search mono" id="actNumber-${s.id}" placeholder="№ акта" value="${s.actNumber || s.id}" style="width:160px">
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" onclick="downloadSupplyActExcel('${s.id}')">📊 Скачать Excel</button>
            <button class="btn btn-accent" onclick="generateSupplyActPdf('${s.id}')">📄 Скачать PDF</button>
          </div>
        </div>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
          <div class="eyebrow" style="margin-bottom:10px">УПД (универсальный передаточный документ)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <input class="search mono" id="updDocNumber-${s.id}" placeholder="№ УПД" value="${s.updDocNumber || s.id}" style="width:160px">
            <input class="search" id="updPricePerUnit-${s.id}" type="number" min="0" step="0.01" placeholder="Цена за ед., ₽ (необязательно)" value="${s.updPricePerUnit||''}" style="width:220px">
            <select class="search" id="updVatRate-${s.id}" style="width:150px">
              <option value="0" ${(s.updVatRate||0)==0?'selected':''}>Без НДС</option>
              <option value="10" ${s.updVatRate==10?'selected':''}>НДС 10%</option>
              <option value="20" ${s.updVatRate==20?'selected':''}>НДС 20%</option>
            </select>
          </div>
          ${clientHasLegalInfo ? '' : `<p style="font-size:12px;color:var(--warn);margin:0 0 10px 0">⚠ У клиента «${s.clientName}» не заполнены юридические реквизиты (ИНН и т.д.) — откройте карточку клиента и заполните, иначе в УПД эти поля останутся пустыми</p>`}
          <button class="btn btn-accent" onclick="generateUpd('${s.id}')">📄 Сформировать УПД</button>
        </div>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
          <div class="eyebrow" style="margin-bottom:4px">МХ-1 (акт приёма-передачи ТМЦ на хранение)</div>
          <p style="font-size:12px;color:var(--ink-soft);margin:0 0 10px 0">Более подходящий документ для фулфилмента — вы указаны как хранитель, клиент как поклажедатель. Цена в этой форме не обязательна.</p>
          <button class="btn btn-ghost" onclick="downloadMx1Excel('${s.id}')">📊 Скачать МХ-1 (Excel)</button>
        </div>
      </div>
    `;
  }
  const totalPlan = s.items.reduce((a,i)=>a+i.qty,0);
  const totalFact = s.items.reduce((a,i)=>a+i.receivedQty,0);
  const pct = totalPlan ? Math.min(100, Math.round(totalFact/totalPlan*100)) : 0;
  const sortedItems = s.items.slice().sort((a,b)=>{
    const aDone = a.receivedQty >= a.qty ? 1 : 0;
    const bDone = b.receivedQty >= b.qty ? 1 : 0;
    return aDone - bDone;
  });
  const mismatchCount = s.items.filter(i=>i.receivedQty !== i.qty && i.receivedQty>0).length;
  const remaining = Math.max(0, totalPlan - totalFact);
  const kizCount = kizScans.filter(k=>k.supplyId===s.id).length;
  return `
    <div style="border-top:1px solid var(--line);padding:16px 18px;background:var(--panel)" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-ghost sound-toggle" style="padding:5px 10px" onclick="toggleSound()">${soundEnabled?'🔊 Звук':'🔇 Звук'}</button>
          ${voiceRateSelectHtml(false)}
        </div>
        ${renderSupplyDeleteControl(s)}
      </div>

      ${renderScanScoreboard()}

      <div class="eyebrow" style="margin:16px 0 8px 0">Сканирование${s.requiresKiz?' · требует КИЗ':''}</div>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:${receivingToBrak[s.id]?'var(--warn)':'var(--ink-soft)'};cursor:pointer;margin-bottom:8px;font-weight:${receivingToBrak[s.id]?'700':'400'}">
        <input type="checkbox" ${receivingToBrak[s.id]?'checked':''} onchange="toggleReceivingToBrak('${s.id}', this.checked)">
        ⚠ Принимать как брак (пришло повреждённым) — считается полученным по плану, но не идёт на WB/Ozon
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <input class="search" id="supplyScanInput-${s.id}" placeholder="Штрихкод…" style="flex:1;min-width:240px${receivingToBrak[s.id]?';border-color:var(--warn)':''}" autocomplete="off" ${(s.requiresKiz && pendingKizItem)?'disabled':''}>
        ${s.requiresKiz ? `<input class="search mono" id="supplyKizInput-${s.id}" placeholder="КИЗ (Честный Знак)…" style="flex:1;min-width:240px" autocomplete="off" ${pendingKizItem?'':'disabled'}>` : ''}
      </div>
      ${pendingKizItem ? `<div style="padding:8px 10px;background:var(--bg);border-radius:8px;font-size:12px;color:var(--ink-soft);margin-bottom:8px">Ожидается КИЗ для: <b>${pendingKizItem.name}</b></div>` : ''}
      <p style="font-size:12px;color:var(--ink-faint);margin:0 0 16px 0;line-height:1.5">${s.requiresKiz ? 'Сначала штрихкод товара, затем код каждой единицы (Честный Знак). Дубли КИЗ отклоняются автоматически.' : 'Сканируйте штрихкод товара из этой поставки — сразу услышите номер ячейки голосом. Принять можно больше или меньше плана — расхождение зафиксируется при завершении.'}</p>

      <div class="stat-row" style="margin-bottom:16px">
        <div class="stat"><div class="val" style="color:var(--ok)">${totalFact}</div><div class="lbl">Принято</div></div>
        <div class="stat"><div class="val">${remaining}</div><div class="lbl">Осталось</div></div>
        <div class="stat"><div class="val" style="color:${mismatchCount?'var(--warn)':'var(--ink)'}">${mismatchCount}</div><div class="lbl">С расхождением</div></div>
        <div class="stat"><div class="val" style="color:${(s.unmatchedScans||0)?'var(--warn)':'var(--ink)'}">${s.unmatchedScans||0}</div><div class="lbl">Не найдено</div></div>
      </div>
      <div style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span class="mono" style="font-size:14px;font-weight:600">Принято ${totalFact} из ${totalPlan}</span>
          <span class="mono" style="font-size:14px;font-weight:700;color:${pct>=100?'var(--ok)':'var(--accent)'}">${pct}%</span>
        </div>
        <div class="progress-track" style="background:var(--line)">
          <div class="progress-fill" style="width:${pct}%;background:${pct>=100?'var(--ok)':'var(--accent)'}"></div>
        </div>
      </div>

      <div class="panel" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;background:var(--bg)" onclick="toggleItemsListCollapse()">
          <h3 style="font-size:14px;color:var(--ink-soft)">Строки поставки (${s.items.length})</h3>
          <span style="font-size:12px;color:var(--ink-faint)">${itemsListCollapsed ? '▼' : '▲'}</span>
        </div>
        ${itemsListCollapsed ? '' : sortedItems.map(it=>{
          const done = it.receivedQty >= it.qty;
          const over = it.receivedQty > it.qty;
          return `<div class="pick-row ${done?'done':''}" ${over?'style="background:var(--warn-bg)"':''}>
            <div><div class="sku-name">${it.name}${it.size?` · размер ${it.size}`:''}</div><div class="sku-code mono">${it.sku}${it.barcode?` · ШК ${it.barcode}`:' · без штрихкода'}</div></div>
            <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap">
              <button class="btn btn-ghost" style="padding:4px 9px" onclick="adjustSupplyItem('${s.id}','${it.sku}',-1,'${it.size||''}')">−</button>
              <div class="qty-need" style="min-width:56px;text-align:center;${over?'color:var(--warn);font-weight:700':''}">${it.receivedQty}/${it.qty}${(it.defectQty||0)>0 ? `<span style="display:block;font-size:10px;color:var(--warn);font-weight:700" title="Принято как брак — на складе «БРАК»">⚠ брак ${Math.min(it.defectQty, it.receivedQty)}</span>` : ''}</div>
              <button class="btn btn-ghost" style="padding:4px 9px" onclick="adjustSupplyItem('${s.id}','${it.sku}',1,'${it.size||''}')">+</button>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="panel" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;background:var(--bg)" onclick="toggleRecentActionsCollapse()">
          <h3 style="font-size:14px;color:var(--ink-soft)">История сканов (${recentReceivingActions.length})</h3>
          <span style="font-size:12px;color:var(--ink-faint)">${recentActionsCollapsed ? '▼' : '▲'}</span>
        </div>
        ${recentActionsCollapsed ? '' : `<div style="padding:2px 16px">${renderRecentActionsFeed(20)}</div>`}
      </div>

      ${s.requiresKiz ? `
      <div class="panel" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;cursor:pointer;background:var(--bg)" onclick="toggleKizListCollapse()">
          <h3 style="font-size:14px;color:var(--ink-soft)">Отсканированные КИЗ (${kizCount})</h3>
          <span style="font-size:12px;color:var(--ink-faint)">${kizListCollapsed ? '▼' : '▲'}</span>
        </div>
        ${kizListCollapsed ? '' : `
          <div style="padding:2px 16px">${renderKizScansList(s.id)}</div>
          <div style="padding:0 16px 14px 16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="downloadKizExcel('${s.id}')">📊 Скачать КИЗ (Excel)</button>
            <button class="btn btn-ghost" style="flex:1;justify-content:center;color:var(--warn)" onclick="removeAllKizScans('${s.id}')">🗑 Удалить все</button>
          </div>
        `}
      </div>
      ` : ''}

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost" style="flex:1;justify-content:center" onclick="undoLastScan()" ${!scanHistory.length?'disabled':''}>↩ Отменить скан${scanHistory.length>1?` (${scanHistory.length})`:''}</button>
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="finishSupplyReceiving('${s.id}')">Завершить приёмку</button>
      </div>
    </div>
  `;
}
function formatSupplyDate(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}:${mi}`;
}
function supplyStatusInfo(s){
  const totalQty = s.items.reduce((a,i)=>a+i.qty,0);
  const totalReceived = s.items.reduce((a,i)=>a+i.receivedQty,0);
  const hasMismatch = s.status==='received' && s.items.some(i=>i.receivedQty !== i.qty);
  let label, cls;
  if(s.status==='received'){ label='Принята'; cls='shipped'; }
  else if(totalReceived>0){ label='В работе'; cls='assembling'; }
  else { label='Едет'; cls='planned'; }
  return {totalQty, totalReceived, hasMismatch, label, cls};
}
function renderSupplies(){
  renderSuppliesCreatePanel();
  renderSuppliesTableWrap();
}
function renderSuppliesCreatePanel(){
  const panel = document.getElementById('supplyCreatePanel');
  const client = clients.find(c=>c.id===draftSupplyClientId);
  const canCreate = !!client && draftSupplyItems.length>0;
  const products = client ? supplyClientProducts(client.name) : [];
  const knownKeys = new Set(products.map(supplyProductKey));

  const draftRows = draftSupplyItems.map((d,idx)=>`
    <tr>
      <td data-label="Артикул" class="mono">${escapeHtml(d.sku)}${client && !knownKeys.has(d.sku+'~~'+(d.size||'')) ? ' <span style="font-size:10px;color:var(--accent);font-family:Inter,sans-serif" title="Такого товара у клиента ещё нет в остатках — он появится после приёмки">новый</span>' : ''}</td>
      <td data-label="Наименование">${escapeHtml(d.name)}</td>
      <td data-label="Размер">${escapeHtml(d.size||'—')}</td>
      <td data-label="ШК" class="mono">${escapeHtml(d.barcode||'—')}</td>
      <td data-label="Кол-во"><input class="search mono" type="number" min="1" value="${d.qty}" style="width:84px;padding:6px 10px" onchange="setSupplyDraftQty(${idx}, this.value)"></td>
      <td style="text-align:right"><button class="btn btn-ghost" style="padding:4px 10px;color:var(--warn)" title="Убрать из списка" onclick="removeSupplyDraftItem(${idx})">✕</button></td>
    </tr>`).join('');

  const manualBlock = client ? `
    <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:16px">
      <div class="eyebrow" style="margin-bottom:8px">Добавить товар вручную — без Excel</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1 1 340px;min-width:240px;max-width:520px">
          <div class="eyebrow" style="margin-bottom:6px">Товар клиента (${products.length}) — поиск по названию, артикулу или ШК</div>
          <input type="hidden" id="supplyManualProduct" value="">
          <input class="search" id="supplyManualSearch" placeholder="Начните вводить или отсканируйте ШК…" style="width:100%" autocomplete="off"
            onfocus="this.select();openSupplyManualList()" oninput="onSupplyManualSearchInput()" onblur="onSupplyManualSearchBlur()" onkeydown="onSupplyManualSearchKey(event)">
        </div>
        <div>
          <div class="eyebrow" style="margin-bottom:6px">Кол-во</div>
          <input class="search mono" id="supplyManualQty" type="number" min="1" placeholder="шт" style="width:90px"
            onkeydown="if(event.key==='Enter'){event.preventDefault();addSupplyDraftItem();}">
        </div>
        <button class="btn btn-accent" onclick="addSupplyDraftItem()">＋ Добавить в поставку</button>
      </div>
      <div id="supplyManualList" style="display:none;margin-top:8px;max-width:640px;max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;background:#fff"></div>
      <div id="supplyManualNewFields" style="display:none;gap:10px;flex-wrap:wrap;margin-top:10px">
        <input class="search mono" id="supplyManualSkuNew" placeholder="Артикул *" style="width:150px;max-width:100%" autocomplete="off">
        <input class="search" id="supplyManualName" placeholder="Наименование" style="width:240px;max-width:100%" autocomplete="off">
        <input class="search" id="supplyManualSize" placeholder="Размер" style="width:100px;max-width:100%" autocomplete="off">
        <input class="search mono" id="supplyManualBarcode" placeholder="ШК" style="width:170px;max-width:100%" autocomplete="off">
      </div>
    </div>
  ` : `
    <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:16px;font-size:13px;color:var(--ink-faint)">
      Выберите клиента — здесь появится список его товаров, чтобы добавлять позиции без Excel.
    </div>
  `;

  panel.innerHTML = `
    <div class="panel" style="padding:20px;margin-bottom:16px">
      <h3 style="font-size:18px;margin-bottom:4px">Создать плановую поставку</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin:0 0 16px 0">Позиции можно добавить двумя способами: загрузить Excel (артикул, наименование, размер, ШК, количество) или собрать список вручную из товаров клиента. «Шаблон с товарами клиента» уже содержит все его товары — остаётся проставить количество. Разные размеры одного артикула — отдельные строки.</p>

      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <div>
          <div class="eyebrow" style="margin-bottom:6px">Клиент склада / ИП</div>
          <select class="search" id="supplyClientSelect" style="width:280px;max-width:100%" onchange="setDraftSupplyClient(this.value)">
            <option value="">— выберите —</option>
            ${clients.map(c=>`<option value="${c.id}" ${draftSupplyClientId===c.id?'selected':''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <div class="eyebrow" style="margin-bottom:6px">На какой склад принимаем</div>
          <select class="search" id="supplyWarehouseSelect" style="width:220px;max-width:100%" ${hasFullWarehouseAccess()?'':'disabled'} onchange="draftSupplyWarehouseId=this.value">
            ${hasFullWarehouseAccess()
              ? warehouses.map(w=>`<option value="${w.id}" ${(draftSupplyWarehouseId||'MAIN')===w.id?'selected':''}>${escapeHtml(w.name)}</option>`).join('')
              : `<option value="${myWarehouseId()}" selected>${escapeHtml(warehouseName(myWarehouseId()))}</option>`}
          </select>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-ghost" onclick="downloadClientSupplyTemplate()" title="Excel, заполненный товарами выбранного клиента">Шаблон с товарами клиента</button>
        <button class="btn btn-ghost" onclick="downloadSupplyTemplate()" title="Пустой шаблон с примерами строк">Пустой шаблон</button>
        <label class="btn btn-ghost" style="cursor:pointer;margin:0">
          Выбрать Excel
          <input type="file" accept=".xlsx,.xls" style="display:none" onchange="handleSupplyExcelUpload(this)">
        </label>
      </div>
      ${manualBlock}

      ${draftSupplyItems.length ? `
        <div style="margin-top:16px">
          <div class="eyebrow" style="margin-bottom:8px">Состав поставки</div>
          <table class="card-table">
            <thead><tr><th>Артикул</th><th>Наименование</th><th>Размер</th><th>ШК</th><th>Кол-во</th><th></th></tr></thead>
            <tbody>${draftRows}</tbody>
          </table>
        </div>
      ` : ''}

      <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:var(--ink-soft);cursor:pointer;flex-wrap:wrap">
        <input type="checkbox" id="draftSupplyRequiresKiz" ${draftSupplyRequiresKiz?'checked':''} onchange="draftSupplyRequiresKiz=this.checked">
        Требует приёмку по КИЗ (Честный Знак) — при сканировании штрихкода дополнительно попросит код каждой единицы
      </label>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">
        <button class="btn ${canCreate?'btn-accent':'btn-ghost'}" ${canCreate?'':'disabled'} onclick="createSupply()">Создать поставку</button>
        ${draftSupplyItems.length ? `<button class="btn btn-ghost" style="color:var(--warn)" onclick="clearSupplyDraft()">Очистить список</button>` : ''}
        <span id="supplyDraftSummary" style="font-size:12px;color:var(--ink-faint)">${supplyDraftSummaryText()}</span>
      </div>
    </div>
  `;
}
function renderSuppliesTableWrap(){
  const q = (document.getElementById('supplySearch').value || '').toLowerCase();
  const visibleSupplies = hasFullWarehouseAccess() ? supplies : supplies.filter(s=>(s.warehouseId||'MAIN')===myWarehouseId());
  const filtered = visibleSupplies.filter(s=>{
    if(!q) return true;
    const info = supplyStatusInfo(s);
    return s.id.toLowerCase().includes(q) || (s.clientName||'').toLowerCase().includes(q) || info.label.toLowerCase().includes(q);
  });
  document.getElementById('supplyCount').textContent = `${filtered.length} из ${visibleSupplies.length}`;

  const wrap = document.getElementById('suppliesTableWrap');
  if(!supplies.length){
    wrap.innerHTML = `<div class="panel empty"><span class="eyebrow">Пока нет поставок</span>Выберите клиента и загрузите Excel выше, чтобы создать первую</div>`;
    return;
  }
  if(!filtered.length){
    wrap.innerHTML = `<div class="panel empty">Ничего не найдено по запросу «${q}»</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="panel">
      <table class="card-table">
        <thead><tr>
          <th>ID</th><th>Поставщик / ИП</th><th>Статус</th><th>Расхождения</th><th>Кол-во</th><th>SKU</th><th>Создана</th>
        </tr></thead>
        <tbody>
          ${filtered.map(s=>{
            const info = supplyStatusInfo(s);
            const isOpen = activeSupplyId===s.id;
            const discHtml = info.hasMismatch
              ? `<span class="status overdue">Есть расхождения</span>`
              : `<span style="color:var(--ink-faint);font-size:12px">—</span>`;
            const qtyHtml = info.hasMismatch
              ? `<strong>${info.totalReceived} / ${info.totalQty}</strong>`
              : `${info.totalQty}`;
            let rowsHtml = `
              <tr style="cursor:pointer;${info.hasMismatch?'background:var(--warn-bg)':''}" onclick="toggleSupplyReceiving('${s.id}')">
                <td class="mono" data-label="ID">${s.id}</td>
                <td data-label="Поставщик / ИП">${s.clientName}</td>
                <td data-label="Статус"><span class="status ${info.cls}">${info.label}</span></td>
                <td data-label="Расхождения">${discHtml}</td>
                <td data-label="Кол-во">${qtyHtml}</td>
                <td data-label="SKU">${s.items.length}</td>
                <td class="mono" data-label="Создана" style="font-size:12px">${formatSupplyDate(s.createdAt)}</td>
              </tr>
            `;
            if(isOpen){
              rowsHtml += `<tr><td colspan="7" style="padding:0">${renderSupplyReceivingPanel(s)}</td></tr>`;
            }
            return rowsHtml;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  if(activeSupplyId){
    const supply = supplies.find(s=>s.id===activeSupplyId);
    const input = document.getElementById('supplyScanInput-'+activeSupplyId);
    if(supply && input){
      if(!(supply.requiresKiz && pendingKizItem)) input.focus();
      input.addEventListener('keydown', async (e)=>{
        if(e.key!=='Enter') return;
        const code = input.value.trim();
        input.value='';
        if(!code) return;
        let item = supply.items.find(i=>i.barcode && i.barcode===code);
        if(!item){
          const candidates = supply.items.filter(i=>i.sku===code);
          if(candidates.length===1) item = candidates[0];
          else if(candidates.length>1){
            playBeep('error');
            toast('У этого артикула несколько размеров в поставке — отсканируйте именно штрихкод, а не артикул');
            renderSuppliesTableWrap();
            return;
          }
        }
        if(!item){
          playBeep('error');
          supply.unmatchedScans = (supply.unmatchedScans||0) + 1;
          lastScanInfo = {supplyId: supply.id, sku:null, name:null, barcode: code, cell:null, delta:0, canUndo:false, status:'error', message:'Штрихкод не найден среди товаров этой поставки'};
          toast('Штрихкод не найден среди товаров этой поставки');
          renderSuppliesTableWrap();
          return;
        }
        if(supply.requiresKiz){
          pendingKizItem = {supplyId: supply.id, sku: item.sku, name: item.name, barcode: item.barcode||code, size: item.size||''};
          playBeep('warn');
          toast(`Отсканируйте КИЗ для «${item.name}»`);
          renderSuppliesTableWrap();
          return;
        }
        await finalizeSupplyItemReceipt(supply, item, item.barcode||code, null);
      });
    }
    const kizInput = document.getElementById('supplyKizInput-'+activeSupplyId);
    if(supply && kizInput){
      forceEnglishInput(kizInput);
      if(pendingKizItem) kizInput.focus();
      kizInput.addEventListener('keydown', async (e)=>{
        if(e.key!=='Enter') return;
        e.preventDefault();
        // Та же защита от потери последнего символа при быстром сканировании.
        await new Promise(r=>setTimeout(r, 0));
        const kizCode = normalizeKizInput(kizInput.value).code;
        kizInput.value='';
        if(!kizCode) return;
        if(!pendingKizItem){ toast('Сначала отсканируйте штрихкод товара'); return; }
        if(kizCode.length < MIN_KIZ_LENGTH){
          playBeep('error');
          toast(`Код слишком короткий (${kizCode.length} симв.) — похоже на неполное сканирование, отсканируйте ещё раз`);
          return;
        }
        const dup = kizScans.find(k=>kizKey(k.kizCode)===kizKey(kizCode));
        if(dup){
          playBeep('error');
          toast(`Этот КИЗ уже был принят ранее (поставка ${dup.supplyId}, ${dup.name})`);
          return;
        }
        const item = supply.items.find(i=>i.sku===pendingKizItem.sku && (i.size||'')===(pendingKizItem.size||''));
        const pending = pendingKizItem;
        pendingKizItem = null;
        await finalizeSupplyItemReceipt(supply, item, pending.barcode, kizCode);
      });
    }
  }
}
// Запоминает КИЗ принятой единицы. isDefect — единица принята как брак: это нужно, чтобы
// при удалении КИЗ остаток откатывался со склада «БРАК», а не с основного.
function recordSupplyKiz(supply, item, kizCode, isDefect){
  const size = item.size || '';
  kizScans.push({kizCode, supplyId:supply.id, sku:item.sku, name:item.name, size, clientName:supply.clientName, time:new Date().toISOString(), isDefect:!!isDefect});
  sb.from('kiz_scans').insert({kiz_code:kizCode, supply_id:supply.id, sku:item.sku, name:item.name, size:size||null, client_name:supply.clientName, is_defect:!!isDefect, employee_id: currentUser?currentUser.id:null, employee_name: currentUser?currentUser.name:null}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить КИЗ в базе — возможно, дубль'); }
  });
}
async function finalizeSupplyItemReceipt(supply, item, barcode, kizCode){
  const sku = item.sku;
  const size = item.size || '';
  const toBrak = !!receivingToBrak[supply.id];
  const warehouseId = toBrak ? 'BRAK' : (supply.warehouseId || 'MAIN');
  const wasOver = item.receivedQty > item.qty;
  item.receivedQty++;
  if(toBrak) item.defectQty = (item.defectQty||0) + 1;
  let inv = barcode ? findInventoryItemByBarcode(barcode, supply.clientName, warehouseId) : findInventoryItem(sku, supply.clientName, size, warehouseId);
  if(!inv){
    inv = {sku, name: item.name, qty:0, client: supply.clientName, size, barcode: barcode||'', warehouseId};
    inventory.push(inv);
  }
  inv.qty++;
  // склад передаём явно — иначе остаток в базе прибавился бы к первой найденной строке товара
  // (обычно это основной склад), и брак ушёл бы в продажу
  logReceipt(inv.sku, inv.name, 1, inv.client, inv.size, warehouseId);
  if(kizCode) recordSupplyKiz(supply, item, kizCode, toBrak);
  if(toBrak){
    playBeep('warn');
    toast(`«${item.name}»${size?` (${size})`:''} → склад «БРАК» (не идёт на WB/Ozon). Принято ${item.receivedQty} из ${item.qty}`);
    pushRecentAction({name:item.name + (size?` (${size})`:''), sku, qty:1, cell:'БРАК', note:'принято как брак'});
    lastScanInfo = {
      supplyId: supply.id, sku, size, name:item.name + (size?` · ${size}`:''), barcode: barcode||'', cell:'БРАК', delta:1, canUndo:true,
      status:'brak', message:`Принято в брак: ${item.receivedQty} из ${item.qty}`
    };
    scanHistory.push({supplyId: supply.id, sku, size, name:item.name + (size?` · ${size}`:''), barcode: barcode||'', delta:1, warehouseId});
    renderSuppliesTableWrap();
    saveSupplyItemCounts(supply.id, item).then(({error})=>{
      if(error) console.error(error);
    }).catch(e=>{ console.error(e); toast('Нет связи с базой — эта позиция не сохранилась, отсканируйте её ещё раз'); });
    return;
  }
  const cell = await ensureCellAssigned(inv);
  const isOver = item.receivedQty>item.qty && !wasOver;
  if(isOver){ playBeep('warn'); toast(`«${item.name}»${size?` (${size})`:''}: больше, чем заказано (${item.receivedQty} из ${item.qty}) → Ячейка ${cell}`); }
  else { playBeep('ok'); toast(`«${item.name}»${size?` (${size})`:''} → Ячейка ${cell}`); }
  announceCell(cell);
  pushRecentAction({name:item.name + (size?` (${size})`:''), sku, qty:1, cell, note: isOver ? 'больше плана' : (kizCode ? 'КИЗ принят' : '')});
  lastScanInfo = {
    supplyId: supply.id, sku, size, name:item.name + (size?` · ${size}`:''), barcode: barcode||'', cell, delta:1, canUndo:true,
    status: isOver ? 'over' : 'ok',
    message: isOver ? `Принято больше плана: ${item.receivedQty} из ${item.qty}` : `Принято ${item.receivedQty} из ${item.qty}`
  };
  scanHistory.push({supplyId: supply.id, sku, size, name:item.name + (size?` · ${size}`:''), barcode: barcode||'', delta:1, warehouseId});
  renderSuppliesTableWrap();
  saveSupplyItemCounts(supply.id, item).then(({error})=>{
    if(error) console.error(error);
  }).catch(e=>{ console.error(e); toast('Нет связи с базой — эта позиция не сохранилась, отсканируйте её ещё раз'); });
}
function escapeHtml(str){
  return String(str==null?'':str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function renderKizScansList(supplyId, limit){
  const rows = kizScans.filter(k=>k.supplyId===supplyId).slice().reverse();
  const shown = limit ? rows.slice(0, limit) : rows;
  if(!shown.length) return `<p style="font-size:12px;color:var(--ink-faint);margin:8px 0">КИЗ ещё не отсканированы</p>`;
  return shown.map(r=>`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div class="sku-name" style="font-size:12px">${escapeHtml(r.name)}</div>
        <div class="sku-code mono" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(r.kizCode)}">${escapeHtml(r.kizCode)}</div>
      </div>
      <button class="btn btn-ghost kiz-delete-btn" style="padding:3px 8px;font-size:11px;color:var(--warn);white-space:nowrap;flex-shrink:0" data-supply="${escapeHtml(supplyId)}" data-kiz="${escapeHtml(r.kizCode)}">Удалить</button>
    </div>
  `).join('');
}
function removeKizScan(supplyId, kizCode, silent){
  const supply = supplies.find(s=>s.id===supplyId);
  if(!supply) return;
  const idx = kizScans.findIndex(k=>k.supplyId===supplyId && k.kizCode===kizCode);
  if(idx===-1) return;
  const scan = kizScans[idx];
  kizScans.splice(idx,1);

  const item = supply.items.find(i=>i.sku===scan.sku && (i.size||'')===(scan.size||'')) || supply.items.find(i=>i.sku===scan.sku);
  if(item){
    // единица, принятая как брак, лежит на складе «БРАК» — откатываем оттуда и из учёта брака
    const wh = scan.isDefect ? 'BRAK' : (supply.warehouseId || 'MAIN');
    item.receivedQty = Math.max(0, item.receivedQty-1);
    if(scan.isDefect) item.defectQty = Math.max(0, (item.defectQty||0)-1);
    const inv = findInventoryItem(scan.sku, supply.clientName, item.size, wh);
    if(inv) inv.qty = Math.max(0, inv.qty-1);
    logMovement(scan.sku, scan.name, -1, 'Удаление КИЗ', supply.clientName, item.size, wh);
    saveSupplyItemCounts(supplyId, item).then(({error})=>{
      if(error) console.error(error);
    });
  }

  sb.from('kiz_scans').delete().eq('kiz_code', kizCode).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить КИЗ в базе'); }
  });
  if(!silent){
    toast(`КИЗ удалён, количество скорректировано (−1)`);
    renderSuppliesTableWrap();
  }
}
async function removeAllKizScans(supplyId){
  const count = kizScans.filter(k=>k.supplyId===supplyId).length;
  if(!count){ toast('Нечего удалять'); return; }
  if(!await customConfirm(`Удалить все ${count} отсканированных КИЗ по этой поставке? Количество по каждой позиции будет уменьшено соответственно. Отменить нельзя.`)) return;
  const codes = kizScans.filter(k=>k.supplyId===supplyId).map(k=>k.kizCode);
  codes.forEach(code=>removeKizScan(supplyId, code, true));
  toast(`Удалено КИЗ: ${codes.length}`);
  renderSuppliesTableWrap();
}
document.addEventListener('click', function(e){
  const btn = e.target.closest('.kiz-delete-btn');
  if(btn) removeKizScan(btn.dataset.supply, btn.dataset.kiz);
});
document.addEventListener('click', function(e){
  const btn = e.target.closest('.inv-act');
  if(!btn) return;
  const key = btn.dataset.key;
  const act = btn.dataset.act;
  if(act==='adjustQty') adjustQty(key, parseInt(btn.dataset.delta));
  else if(act==='startEdit') startEdit(key);
  else if(act==='openHistory') openHistory(key);
  else if(act==='openWriteOff') openWriteOff(key);
  else if(act==='openDelete') openDelete(key);
  else if(act==='saveEdit') saveEdit(key);
  else if(act==='confirmWriteOff') confirmWriteOff(key);
  else if(act==='confirmDelete') confirmDelete(key);
  else if(act==='addExtraBarcode') addExtraBarcode(key);
  else if(act==='removeExtraBarcode') removeExtraBarcode(key, btn.dataset.barcode);
  else if(act==='openAllocate') openAllocate(key);
  else if(act==='saveAllocate') saveAllocate(key);
});
function downloadFbsKizExcel(wbSupplyId, clientName){
  const rows = kizScans.filter(k=>k.supplyId===wbSupplyId);
  if(!rows.length){ toast('По этой поставке ещё нет отсканированных КИЗ'); return; }
  const data = [
    [`КИЗ по поставке WB № ${wbSupplyId}`],
    [`Клиент: ${clientName}`],
    [],
    ['№','Артикул','Размер','Наименование','КИЗ','Время'],
    ...rows.map((r,idx)=>[idx+1, r.sku, r.size||'—', r.name, r.kizCode, new Date(r.time).toLocaleString('ru-RU')])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:4},{wch:14},{wch:10},{wch:30},{wch:36},{wch:20}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'КИЗ');
  XLSX.writeFile(wb, `KIZ_${wbSupplyId}.xlsx`);
}
function downloadKizExcel(supplyId){
  const s = supplies.find(x=>x.id===supplyId);
  const rows = kizScans.filter(k=>k.supplyId===supplyId);
  if(!rows.length){ toast('По этой поставке ещё нет отсканированных КИЗ'); return; }
  const data = [
    [`КИЗ по поставке № ${supplyId}`],
    [`Клиент: ${s ? s.clientName : ''}`],
    [],
    ['№','Артикул','Размер','Наименование','КИЗ','Время'],
    ...rows.map((r,idx)=>[idx+1, r.sku, r.size||'—', r.name, r.kizCode, new Date(r.time).toLocaleString('ru-RU')])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:4},{wch:14},{wch:10},{wch:30},{wch:36},{wch:20}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'КИЗ');
  XLSX.writeFile(wb, `KIZ_${supplyId}.xlsx`);
}
document.getElementById('supplySearch').addEventListener('input', renderSuppliesTableWrap);
