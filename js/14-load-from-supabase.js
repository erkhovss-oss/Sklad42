// ---------- LOAD FROM SUPABASE ----------
function formatLogTime(iso){
  const d = new Date(iso);
  return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
}
function formatLogDateTime(iso){
  const d = new Date(iso);
  const dd = d.getDate().toString().padStart(2,'0');
  const mm = (d.getMonth()+1).toString().padStart(2,'0');
  return `${dd}.${mm} ${formatLogTime(iso)}`;
}
async function loadRoles(){
  const { data, error } = await sb.from('roles').select('*').order('id').limit(50000);
  if(error){ console.error(error); return; }
  roles = data.map(r=>({id:r.id, name:r.name, permissions:r.permissions||{}}));
}
async function loadEmployees(){
  const { data, error } = await sb.from('employees').select('*').order('id').limit(50000);
  if(error){ console.error(error); return; }
  employees = data.map(e=>({id:e.id, name:e.name, login:e.login, authUserId:e.auth_user_id||null, roleId:e.role_id, active:e.active, warehouseId:e.warehouse_id||null}));
}
async function loadInventory(){
  const { data, error } = await sb.from('inventory').select('*').order('sku').limit(50000);
  if(error){ console.error(error); return; }
  inventory = data.map(i=>({sku:i.sku, name:i.name, qty:i.qty, client:i.client_name, size:i.size||'', warehouseId:i.warehouse_id||'MAIN', vendorCode:i.vendor_code, barcode:i.barcode, dims:i.dims, cell:i.cell||null, requiresKiz:i.requires_kiz||false, color:i.color||'', isKit:i.is_kit||false, kitMode:i.kit_mode||null}));
}
async function loadInventoryBarcodes(){
  const { data, error } = await sb.from('inventory_barcodes').select('*').limit(50000);
  if(error){ console.error(error); return; }
  inventoryBarcodes = data.map(b=>({barcode:b.barcode, sku:b.sku, clientName:b.client_name, size:b.size||''}));
}
function addExtraBarcode(key){
  const {sku, client, size} = parseItemKey(key);
  const input = document.getElementById('newExtraBarcode-'+key);
  const barcode = input.value.trim();
  if(!barcode){ toast('Введите штрихкод'); return; }
  if(findInventoryItemByBarcode(barcode, undefined)){
    toast('Этот штрихкод уже привязан к другому товару');
    return;
  }
  inventoryBarcodes.push({barcode, sku, clientName: client||'', size: size||''});
  sb.from('inventory_barcodes').insert({barcode, sku, client_name: client||'', size: size||''}).then(({error})=>{
    if(error){
      console.error(error);
      inventoryBarcodes = inventoryBarcodes.filter(b=>b.barcode!==barcode);
      toast('Не удалось сохранить штрихкод в базе — возможно, он уже используется');
      renderInventory();
      return;
    }
    toast('Штрихкод добавлен');
    renderInventory();
  });
  input.value='';
  renderInventory();
}
function removeExtraBarcode(key, barcode){
  const {client} = parseItemKey(key);
  inventoryBarcodes = inventoryBarcodes.filter(b=>!(b.barcode===barcode && (b.clientName||'')===(client||'')));
  sb.from('inventory_barcodes').delete().eq('barcode', barcode).eq('client_name', client||'').then(({error})=>{
    if(error) console.error(error);
  });
  toast('Штрихкод удалён');
  renderInventory();
}
async function loadMovementLog(){
  const { data, error } = await sb.from('movement_log').select('*').order('created_at',{ascending:true}).limit(500);
  if(error){ console.error(error); return; }
  movementLog = data.map(m=>({sku:m.sku, name:m.name, delta:m.delta, type:m.type, time: formatLogTime(m.created_at), client:m.client_name, size:m.size, employeeName:m.employee_name||''}));
}
async function loadWriteOffLog(){
  const { data, error } = await sb.from('write_off_log').select('*').order('created_at',{ascending:true}).limit(200);
  if(error){ console.error(error); return; }
  writeOffLog = data.map(w=>({sku:w.sku, name:w.name, qty:w.qty, reason:w.reason, time: formatLogDateTime(w.created_at), employeeName:w.employee_name||''}));
}
async function loadReceivingLog(){
  const { data, error } = await sb.from('receiving_log').select('*').order('created_at',{ascending:true}).limit(200);
  if(error){ console.error(error); return; }
  receivingLog = data.map(r=>({sku:r.sku, name:r.name, qty:r.qty, time: formatLogTime(r.created_at), employeeName:r.employee_name||''}));
}
async function loadClients(){
  const { data, error } = await sb.from('clients').select('*').order('name').limit(50000);
  if(error){ console.error(error); return; }
  clients = data.map(c=>({
    id:c.id, name:c.name, contact:c.contact||'—', telegram:c.telegram||'', wbKey:c.wb_key||'', wbConnected:c.wb_connected||false,
    wbWarehouseId:c.wb_warehouse_id||'', wbAutoSync: c.wb_auto_sync!==false, wbProducts:[], storageLiters:c.storage_liters||0, pricePerLiter:c.price_per_liter||0, receivingPricePerUnit:c.receiving_price_per_unit||0,
    inn:c.inn||'', kpp:c.kpp||'', legalAddress:c.legal_address||'', bankDetails:c.bank_details||'', directorName:c.director_name||'',
    portalToken:c.portal_token||''
  }));
}
async function loadStorageHistory(){
  const { data, error } = await sb.from('storage_history').select('*').order('day',{ascending:true}).limit(50000);
  if(error){ console.error(error); return; }
  storageHistoryRows = data;
}
async function loadSupplies(){
  const { data: supplyRows, error: err1 } = await sb.from('supplies').select('*').order('created_at',{ascending:false}).limit(50000);
  if(err1){ console.error(err1); return; }
  const { data: itemRows, error: err2 } = await sb.from('supply_items').select('*').limit(50000);
  if(err2){ console.error(err2); return; }
  supplies = supplyRows.map(s=>({
    id: s.id,
    clientId: s.client_id,
    clientName: s.client_name,
    status: s.status,
    updNumber: s.upd_number || '',
    actNumber: s.act_number || '',
    actPricePerUnit: s.act_price || 0,
    requiresKiz: s.requires_kiz || false,
    warehouseId: s.warehouse_id || 'MAIN',
    updDocNumber: s.upd_doc_number||'', updPricePerUnit: s.upd_price_per_unit||0, updVatRate: s.upd_vat_rate||0,
    createdAt: new Date(s.created_at),
    items: itemRows.filter(it=>it.supply_id===s.id).map(it=>({sku:it.sku, name:it.name, qty:it.qty, receivedQty:it.received_qty, barcode:it.barcode||'', size:it.size||''}))
  }));
}
async function loadOutboundSupplies(){
  const { data: rows, error: err1 } = await sb.from('outbound_supplies').select('*').order('created_at',{ascending:false}).limit(50000);
  if(err1){ console.error(err1); return; }
  const { data: itemRows, error: err2 } = await sb.from('outbound_supply_items').select('*').limit(50000);
  if(err2){ console.error(err2); return; }
  outboundSupplies = rows.map(s=>({
    id: s.id,
    clientId: s.client_id,
    clientName: s.client_name,
    destination: s.destination,
    isInternalTransfer: s.is_internal_transfer||false, sourceWarehouseId: s.source_warehouse_id||'MAIN', destWarehouseId: s.dest_warehouse_id||null, createdPlannedSupplyId: s.created_planned_supply_id||null,
    status: s.status,
    createdAt: new Date(s.created_at),
    items: itemRows.filter(it=>it.supply_id===s.id).map(it=>({sku:it.sku, name:it.name, qty:it.qty, barcode:it.barcode||'', cell:it.cell||null, size:it.size||''}))
  }));
}
async function loadKizScans(){
  const { data, error } = await sb.from('kiz_scans').select('*').order('created_at',{ascending:true}).limit(50000);
  if(error){ console.error(error); return; }
  kizScans = data.map(k=>({kizCode:k.kiz_code, supplyId:k.supply_id, sku:k.sku, name:k.name, size:k.size||'', clientName:k.client_name, time:k.created_at, employeeName:k.employee_name||''}));
}

