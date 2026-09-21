// ---------- SUPABASE ----------
const SUPABASE_URL = 'https://mixsvqjlrifkcoeuuydc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1peHN2cWpscmlma2NvZXV1eWRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MTYyNzEsImV4cCI6MjEwMzA5MjI3MX0.qIdelCgVkSDMc20f5X1parpfx2njHB5Pe3xk3ogbCr4';
let sb = null;
try{
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((event)=>{
    if(event === 'SIGNED_OUT'){
      currentUser = null;
      const appRoot = document.getElementById('appRoot');
      const loginScreen = document.getElementById('loginScreen');
      if(appRoot) appRoot.style.display = 'none';
      if(loginScreen) loginScreen.style.display = 'flex';
      showLoginForm();
    }
  });
}catch(e){
  console.error('Supabase init failed', e);
}

// ---------- STATE ----------
let inventory = []; // загружается из базы (loadInventory)

let clients = []; // загружается из базы (loadClients)
let storageHistoryRows = []; // загружается из базы (loadStorageHistory)
let clientCounter = 3;
let activeClientId = null;
let showingNewClientForm = false;
let editingClientId = null;
let deletingClientId = null;
let clientViewMode = null;

let receivingLog = []; // загружается из базы (loadReceivingLog)
let currentReceivingMode = 'scan';
let editingSku = null;
let writeOffSku = null;
let writeOffLog = []; // загружается из базы (loadWriteOffLog)
let historySku = null;
let movementLog = []; // загружается из базы (loadMovementLog)
let deletingSku = null;

let supplies = [];

let outboundSupplies = [];
let draftOutboundClientId = '';
let draftOutboundWarehouseId = 'MAIN';
let draftOutboundIsInternalTransfer = false;
let draftOutboundItems = [];
let outboundDraftCollapsed = false;
let outboundBoxes = [];
let activeBoxSupplyId = null;
let expandedBoxId = null;
let lastBoxScanInfo = null;
let outboundItemsCollapsed = true;
let activeOutboundId = null;
let editingOutboundId = null;
let deletingOutboundId = null;

let fbsOrders = [];
let fbsView = 'new';
let fbsCompletePage = 1;
let fbsCompletePageSize = parseInt(localStorage.getItem('sklad42_fbs_complete_page_size')) || 50;
function goFbsCompletePage(delta){ fbsCompletePage += delta; renderFbsBody(); }
function changeFbsCompletePageSize(val){
  fbsCompletePageSize = parseInt(val) || 50;
  try{ localStorage.setItem('sklad42_fbs_complete_page_size', fbsCompletePageSize); }catch(e){}
  fbsCompletePage = 1;
  renderFbsBody();
}
let fbsSelectedClientId = '';
let assemblingOrder = null;
let fbsPendingKiz = null;
let fbsAutoPollTimer = null;
let supplyCounter = 0;
let draftSupplyItems = [];
let draftSupplyClientId = '';
let draftSupplyWarehouseId = 'MAIN';
let draftSupplyFileName = '';
let currentSuppliesView = 'planned';
let activeSupplyId = null;
let deletingSupplyId = null;

let roles = []; // загружается из базы (loadRoles)
let employees = []; // загружается из базы (loadEmployees)
let employeeCounter = 3;
let currentUser = null;
function myWarehouseId(){ return currentUser ? (currentUser.warehouseId || null) : null; }
function hasFullWarehouseAccess(){ return !myWarehouseId(); }
let currentEmployeesView = 'list';
let showingNewEmployeeForm = false;
let assemblyModeQueue = [];
let assemblySupplyQueue = [];
let assemblySupplyIndex = 0;
let consumables = [];
let kitComponents = [];
let expandedFbsSupplyIds = {};
let assemblyModeIndex = 0;
let fbsTrbxes = [];
let fbsTrbxLoadedFor = '';
let fbsSelectedOrders = [];
let ddsSelected = [];
let stocktakes = [];
let activeStocktakeId = null;
let stocktakeFinishing = false;
let lastStocktakeScanInfo = null;
let warehouses = [];
let companySettings = { name:'', inn:'', kpp:'', legalAddress:'', bankDetails:'', directorName:'' };
let tochkaSettings = { token:'', customerCode:'', accountId:'' };
let tochkaSettingsOpen = false;
let fbsTariffs = [];
let ddsEntries = [];
const DDS_CATEGORIES = {
  income: ['Хранение', 'Приёмка', 'Упаковка/обработка коробов', 'Комиссия за услуги фулфилмента', 'Прочий доход'],
  expense: ['Аренда склада', 'Зарплата сотрудникам', 'Расходные материалы (упаковка, скотч, этикетки)', 'Транспорт и логистика', 'Комиссии маркетплейсов', 'Программное обеспечение и сервисы', 'Налоги', 'Прочие расходы']
};
let editingEmployeeId = null;
let deletingEmployeeId = null;
let editingRoleId = null;

// ---------- HELPERS ----------
function toast(msg){
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity='0'; setTimeout(()=>el.remove(),300); }, 2600);
}

let soundEnabled = true;
try{ const s = localStorage.getItem('sklad42_sound'); if(s!==null) soundEnabled = s==='1'; }catch(e){}
function toggleSound(){
  soundEnabled = !soundEnabled;
  try{ localStorage.setItem('sklad42_sound', soundEnabled?'1':'0'); }catch(e){}
  document.querySelectorAll('.sound-toggle').forEach(btn=>{ btn.textContent = soundEnabled ? '🔊 Звук' : '🔇 Звук'; });
  if(soundEnabled) playBeep('ok');
}
let recentReceivingActions = [];
let lastScanInfo = null;
let kizScans = [];
let pendingKizItem = null;
let itemsListCollapsed = true;
let recentActionsCollapsed = true;
let kizListCollapsed = true;
function toggleItemsListCollapse(){
  itemsListCollapsed = !itemsListCollapsed;
  renderSuppliesTableWrap();
}
function toggleRecentActionsCollapse(){
  recentActionsCollapsed = !recentActionsCollapsed;
  renderSuppliesTableWrap();
}
function toggleKizListCollapse(){
  kizListCollapsed = !kizListCollapsed;
  renderSuppliesTableWrap();
}
function pushRecentAction(entry){
  recentReceivingActions.unshift({...entry, time: new Date()});
  if(recentReceivingActions.length > 20) recentReceivingActions.length = 20;
}
function renderRecentActionsFeed(limit){
  limit = limit || 6;
  const items = recentReceivingActions.slice(0, limit);
  if(!items.length) return `<p style="font-size:12px;color:var(--ink-faint);margin:0">Пока нет действий в этой сессии</p>`;
  return items.map(a=>{
    const hh = a.time.getHours().toString().padStart(2,'0');
    const mm = a.time.getMinutes().toString().padStart(2,'0');
    const ss = a.time.getSeconds().toString().padStart(2,'0');
    return `<div class="pick-row" style="padding:8px 0;background:transparent">
      <div style="flex:1;min-width:0">
        <div class="sku-name" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${a.name}">${a.name}</div>
        <div class="sku-code mono">${hh}:${mm}:${ss}${a.cell?` · ячейка ${a.cell}`:''}${a.note?` · ${a.note}`:''}</div>
      </div>
      <div class="qty-need" style="color:${a.qty>=0?'var(--ok)':'var(--warn)'};font-weight:600;flex-shrink:0">${a.qty>=0?'+':''}${a.qty} шт</div>
    </div>`;
  }).join('');
}
function renderScanScoreboard(){
  const colors = {
    ok:    {border:'var(--ok)',   bg:'var(--ok-bg)',   text:'var(--ok)',   label:'ПРИНЯТО'},
    over:  {border:'#A06A00',     bg:'#FBEFDD',        text:'#A06A00',     label:'БОЛЬШЕ ПЛАНА'},
    error: {border:'var(--warn)', bg:'var(--warn-bg)', text:'var(--warn)', label:'НЕ НАЙДЕНО'},
    undone:{border:'var(--line)', bg:'var(--bg)',      text:'var(--ink-soft)', label:'ОТМЕНЕНО'}
  };
  if(!lastScanInfo){
    return `<div class="scoreboard-panel">
      <div class="scoreboard-cell" style="color:var(--ink-faint)">—</div>
      <p style="color:var(--ink-faint);font-size:13px;margin-top:10px">Ещё не было сканирований в этой сессии</p>
    </div>`;
  }
  const info = lastScanInfo;
  const c = colors[info.status] || colors.error;
  return `
    <div class="scoreboard-panel" style="border-color:${c.border};background:${c.bg}">
      <div class="scoreboard-cell" style="color:${info.cell?c.text:'var(--ink-faint)'}">${info.cell || '—'}</div>
      <div class="scoreboard-barcode mono">${info.barcode || '—'}</div>
      <div class="scoreboard-name">${info.name || 'Штрихкод не распознан'}</div>
      <div class="scoreboard-status" style="color:${c.text}">${c.label}</div>
      ${info.message ? `<div class="scoreboard-message">${info.message}</div>` : ''}
    </div>
  `;
}
function undoLastScan(){
  if(!lastScanInfo || !lastScanInfo.canUndo){ toast('Нечего отменять'); return; }
  const info = lastScanInfo;
  const supply = supplies.find(s=>s.id===info.supplyId);
  if(!supply){ toast('Поставка не найдена'); return; }
  const item = supply.items.find(i=>i.sku===info.sku && (i.size||'')===(info.size||''));
  if(!item){ toast('Позиция не найдена'); return; }
  item.receivedQty = Math.max(0, item.receivedQty - info.delta);
  const inv = findInventoryItem(info.sku, supply.clientName, info.size||'');
  if(inv) inv.qty = Math.max(0, inv.qty - info.delta);
  logMovement(info.sku, info.name, -info.delta, 'Отмена скана', supply.clientName, info.size);
  (info.size ? sb.from('supply_items').update({received_qty: item.receivedQty}).eq('supply_id', supply.id).eq('sku', info.sku).eq('size', info.size) : sb.from('supply_items').update({received_qty: item.receivedQty}).eq('supply_id', supply.id).eq('sku', info.sku).is('size', null)).then(({error})=>{
    if(error) console.error(error);
  }).catch(e=>{ console.error(e); toast('Нет связи с базой — отмена не сохранилась'); });
  pushRecentAction({name:info.name, sku:info.sku, qty:-info.delta, note:'отмена скана'});
  toast(`Отменено: ${info.name} −${info.delta} шт`);
  lastScanInfo = {...info, canUndo:false, status:'undone', message:'Последний скан отменён'};
  renderSuppliesTableWrap();
}

const MIN_KIZ_LENGTH = 20;
const NEXT_ORDER_QR_CODE = 'TELEPAK-NEXT-ORDER';
const US_LAYOUT_MAP = {
  Digit0:['0',')'], Digit1:['1','!'], Digit2:['2','@'], Digit3:['3','#'], Digit4:['4','$'],
  Digit5:['5','%'], Digit6:['6','^'], Digit7:['7','&'], Digit8:['8','*'], Digit9:['9','('],
  KeyA:['a','A'], KeyB:['b','B'], KeyC:['c','C'], KeyD:['d','D'], KeyE:['e','E'], KeyF:['f','F'],
  KeyG:['g','G'], KeyH:['h','H'], KeyI:['i','I'], KeyJ:['j','J'], KeyK:['k','K'], KeyL:['l','L'],
  KeyM:['m','M'], KeyN:['n','N'], KeyO:['o','O'], KeyP:['p','P'], KeyQ:['q','Q'], KeyR:['r','R'],
  KeyS:['s','S'], KeyT:['t','T'], KeyU:['u','U'], KeyV:['v','V'], KeyW:['w','W'], KeyX:['x','X'],
  KeyY:['y','Y'], KeyZ:['z','Z'],
  Minus:['-','_'], Equal:['=','+'], BracketLeft:['[','{'], BracketRight:[']','}'],
  Backslash:['\\','|'], Semicolon:[';',':'], Quote:["'",'"'], Comma:[',','<'], Period:['.','>'], Slash:['/','?'],
  Backquote:['`','~'], Space:[' ',' ']
};
function forceEnglishInput(input){
  if(!input || input.dataset.forceEnDone) return;
  input.dataset.forceEnDone = '1';
  input.addEventListener('keydown', function(e){
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    if(e.key==='Enter' || e.key==='Backspace' || e.key==='Delete' || e.key==='Tab' ||
       e.key==='ArrowLeft' || e.key==='ArrowRight' || e.key==='Home' || e.key==='End') return;
    const mapped = US_LAYOUT_MAP[e.code];
    if(mapped){
      e.preventDefault();
      const ch = e.shiftKey ? mapped[1] : mapped[0];
      const start = input.selectionStart, end = input.selectionEnd;
      input.value = input.value.slice(0,start) + ch + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + 1;
    }
  });
}

function playBeep(type){
  if(!soundEnabled) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    if(type === 'error'){
      osc.frequency.value = 220;
      gain.gain.value = 0.16;
      osc.start();
      setTimeout(()=>{ try{osc.stop(); ctx.close();}catch(e){} }, 220);
    } else if(type === 'warn'){
      osc.frequency.value = 440;
      gain.gain.value = 0.16;
      osc.start();
      setTimeout(()=>{ try{osc.stop(); ctx.close();}catch(e){} }, 140);
    } else {
      osc.frequency.value = 900;
      gain.gain.value = 0.14;
      osc.start();
      setTimeout(()=>{ try{osc.stop(); ctx.close();}catch(e){} }, 90);
    }
  }catch(e){ /* звук недоступен в этом браузере — не критично */ }
}

async function ensureCellAssigned(item){
  if(!item.barcode || item.cell) return item.cell || null;
  try{
    const { data, error } = await sb.rpc('next_cell_number');
    if(error){ console.error(error); toast('Не удалось выдать номер ячейки — проверьте интернет'); return null; }
    item.cell = data;
    return item.cell;
  }catch(e){
    console.error(e);
    toast('Не удалось выдать номер ячейки — проверьте интернет');
    return null;
  }
}
function announceCell(cellNumber){
  if(!soundEnabled || !cellNumber) return;
  try{
    if(window.speechSynthesis.speaking || window.speechSynthesis.pending){
      window.speechSynthesis.cancel();
    }
    const utter = new SpeechSynthesisUtterance(String(cellNumber));
    utter.lang = 'ru-RU';
    utter.rate = 1;
    window.speechSynthesis.speak(utter);
  }catch(e){ /* синтез речи недоступен в этом браузере — не критично */ }
}
// Профилактика известного зависания speechSynthesis в Chrome при долгой работе:
// если движок простаивает, периодически сбрасываем его внутреннюю очередь.
if('speechSynthesis' in window){
  setInterval(()=>{
    try{
      if(!window.speechSynthesis.speaking && !window.speechSynthesis.pending){
        window.speechSynthesis.cancel();
      }
    }catch(e){}
  }, 12000);
}

function hasPermission(key){
  if(clientViewMode) return key==='inventory';
  if(!currentUser) return false;
  const role = roles.find(r=>r.id===currentUser.roleId);
  if(!role) return true; // роль не назначена — не блокируем интерфейс из-за отсутствующих данных
  return role.permissions[key] !== false;
}
function applyNavPermissions(){
  if(clientViewMode) return; // в клиентском портале навигация уже настроена отдельно
  let firstVisible = null;
  document.querySelectorAll('.nav-item[data-tab]').forEach(el=>{
    const tab = el.dataset.tab;
    const allowed = hasPermission(tab);
    el.style.display = allowed ? '' : 'none';
    if(allowed && !firstVisible) firstVisible = tab;
  });
  const activeEl = document.querySelector('.nav-item.active[data-tab]');
  const activeTab = activeEl ? activeEl.dataset.tab : null;
  if(!activeTab || !hasPermission(activeTab)){
    if(firstVisible){ switchTab(firstVisible); }
    else {
      document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
      toast('У вашей роли нет доступа ни к одному разделу — обратитесь к администратору');
    }
  }
}
let dashboardStats = null;
function setDashboardPeriod(days){
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - (days-1));
  document.getElementById('dashDateTo').value = to.toISOString().slice(0,10);
  document.getElementById('dashDateFrom').value = from.toISOString().slice(0,10);
  loadDashboard();
}
async function loadDashboard(){
  const body = document.getElementById('dashboardBody');
  let from = document.getElementById('dashDateFrom').value;
  let to = document.getElementById('dashDateTo').value;
  if(!from || !to){
    const now = new Date(); const past = new Date(); past.setDate(past.getDate()-29);
    to = now.toISOString().slice(0,10); from = past.toISOString().slice(0,10);
    document.getElementById('dashDateFrom').value = from;
    document.getElementById('dashDateTo').value = to;
  }
  body.innerHTML = `<div class="panel empty">Загрузка…</div>`;
  const { data, error } = await sb.rpc('get_dashboard_stats', { p_date_from: from, p_date_to: to });
  if(error){ console.error(error); body.innerHTML = `<div class="panel empty">Не удалось загрузить аналитику</div>`; return; }
  dashboardStats = data;
  renderDashboard(data);
}
function renderMiniBarChart(rows, w, h){
  if(!rows.length) return `<div style="color:var(--ink-faint);font-size:13px;padding:20px 0">Нет данных за период</div>`;
  const max = Math.max(1, ...rows.map(r=>Math.max(r.income, r.expense)));
  const barW = Math.max(4, Math.floor(w / rows.length) - 3);
  let x = 0;
  const bars = rows.map(r=>{
    const incH = Math.round((r.income/max) * (h-20));
    const expH = Math.round((r.expense/max) * (h-20));
    const bx = x; x += barW + 3;
    const incRect = `<rect x="${bx}" y="${h-incH}" width="${barW}" height="${incH}" fill="var(--ok)" rx="1"></rect>`;
    const expRect = r.expense>0 ? `<rect x="${bx}" y="${h-incH-expH}" width="${barW}" height="${expH}" fill="var(--warn)" rx="1"></rect>` : '';
    return `<g><title>${r.d}: доход ${r.income.toLocaleString('ru-RU')} ₽, расход ${r.expense.toLocaleString('ru-RU')} ₽</title>${incRect}${expRect}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${x} ${h}" style="width:100%;height:${h}px;display:block">${bars}</svg>`;
}
function renderDashboard(s){
  const body = document.getElementById('dashboardBody');
  const profit = s.income - s.expense;
  body.innerHTML = `
    <div class="stat-row" style="margin-bottom:16px">
      <div class="stat"><div class="val" style="color:var(--ok)">${Math.round(s.income).toLocaleString('ru-RU')} ₽</div><div class="lbl">Доход за период</div></div>
      <div class="stat"><div class="val" style="color:var(--warn)">${Math.round(s.expense).toLocaleString('ru-RU')} ₽</div><div class="lbl">Расход за период</div></div>
      <div class="stat"><div class="val" style="color:${profit>=0?'var(--ok)':'var(--warn)'}">${Math.round(profit).toLocaleString('ru-RU')} ₽</div><div class="lbl">Итого</div></div>
      <div class="stat"><div class="val">${s.activeWbOrders + s.activeOzonOrders}</div><div class="lbl">Активных заказов сейчас</div></div>
      <div class="stat"><div class="val">${s.totalLiters.toFixed(1)} л</div><div class="lbl">Занято на складе</div></div>
      <div class="stat"><div class="val">${s.activeClients}/${s.totalClients}</div><div class="lbl">Клиентов с остатками</div></div>
    </div>

    <div class="panel" style="padding:18px;margin-bottom:16px">
      <div class="eyebrow" style="margin-bottom:10px">Доход / расход по дням <span style="color:var(--ok)">■</span> доход <span style="color:var(--warn)">■</span> расход</div>
      ${renderMiniBarChart(s.byDay, 900, 140)}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="panel" style="padding:18px">
        <div class="eyebrow" style="margin-bottom:10px">Топ клиентов по выручке</div>
        ${s.topClients.length ? s.topClients.map(c=>`
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span>${escapeHtml(c.client_name)}</span><span class="mono" style="font-weight:600">${Math.round(c.income).toLocaleString('ru-RU')} ₽</span>
          </div>`).join('') : `<div style="color:var(--ink-faint);font-size:13px">Нет данных</div>`}
      </div>
      <div class="panel" style="padding:18px">
        <div class="eyebrow" style="margin-bottom:10px">Активность сотрудников (движений за период)</div>
        ${s.employeeActivity.length ? s.employeeActivity.map(e=>`
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span>${escapeHtml(e.employee_name)}</span><span class="mono" style="font-weight:600">${e.ops}</span>
          </div>`).join('') : `<div style="color:var(--ink-faint);font-size:13px">Нет данных</div>`}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="panel" style="padding:18px">
        <div class="eyebrow" style="margin-bottom:10px">Заказы за период по статусам</div>
        <div style="font-size:12px;color:var(--ink-faint);margin-bottom:4px">WB</div>
        ${s.wbOrdersByStatus.length ? s.wbOrdersByStatus.map(o=>`
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
            <span>${escapeHtml(o.status)}</span><span class="mono">${o.cnt}</span>
          </div>`).join('') : `<div style="color:var(--ink-faint);font-size:12px">Нет заказов WB за период</div>`}
        <div style="font-size:12px;color:var(--ink-faint);margin:10px 0 4px">Ozon</div>
        ${s.ozonOrdersByStatus.length ? s.ozonOrdersByStatus.map(o=>`
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
            <span>${escapeHtml(o.status)}</span><span class="mono">${o.cnt}</span>
          </div>`).join('') : `<div style="color:var(--ink-faint);font-size:12px">Нет заказов Ozon за период</div>`}
      </div>
      <div class="panel" style="padding:18px">
        <div class="eyebrow" style="margin-bottom:10px">Наименьшие остатки (не ноль)</div>
        ${s.lowStock.length ? s.lowStock.map(i=>`
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px">
            <span>${escapeHtml(i.name)}${i.size?` (${escapeHtml(i.size)})`:''}${i.client_name?` · ${escapeHtml(i.client_name)}`:''}</span>
            <span class="mono" style="font-weight:600;color:var(--warn)">${i.qty} шт</span>
          </div>`).join('') : `<div style="color:var(--ink-faint);font-size:13px">Нет данных</div>`}
      </div>
    </div>
  `;
}
function switchTab(tab){
  if(!clientViewMode && !hasPermission(tab)){
    toast('Нет доступа к этому разделу');
    return;
  }
  if(tab==='dashboard' && !dashboardStats) loadDashboard();
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.tab===tab));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  if(tab==='inventory') renderInventory();
  if(tab==='clients') renderClients();
  if(tab==='storage') renderStorage();
  if(tab==='supplies') renderSuppliesTab();
  if(tab==='outbound') renderOutbound();
  if(tab==='fbs') renderFbsOrders();
  if(tab==='dds') renderDds();
  if(tab==='stocktake') renderStocktakeList();
  if(tab==='warehouses') renderWarehouses();
  if(tab==='consumables') renderConsumables();
  if(tab==='returns') renderReturns();
  if(tab==='ozon') renderOzon();
  if(tab==='portal-supplies'){ renderPortalSupplyDraftRows(); renderPortalSuppliesList(); }
  if(tab==='portal-kiz') renderPortalKizList();
  if(tab==='journal') renderJournal();
  if(tab==='employees') renderEmployeesTab();
  try{ localStorage.setItem('sklad42_active_tab', tab); }catch(e){}
}
document.querySelectorAll('.nav-item').forEach(n=>{
  n.addEventListener('click', ()=>{ switchTab(n.dataset.tab); closeMobileSidebar(); });
});
function toggleMobileSidebar(){
  document.getElementById('sidebarEl').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}
function closeMobileSidebar(){
  document.getElementById('sidebarEl').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

