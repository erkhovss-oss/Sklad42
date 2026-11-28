import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const core = fs.readFileSync('js/01-core.js','utf8');
const scannerCode = core.slice(core.indexOf('const US_LAYOUT_MAP'),core.indexOf('// ---------- ЗВУК'));
const scanner = vm.createContext({});
vm.runInContext(scannerCode,scanner);
const gs = String.fromCharCode(29);
const segments = ['0104607009520001211234567890123','91TEST','92'+'X'.repeat(44)];
const fullKiz = segments.join(gs);
for(const scan of [segments.join(''),segments[0]+gs+segments[1]+segments[2],
  segments[0]+'\uFFFD'+segments[1]+gs+segments[2],']d2'+fullKiz]){
  const normalized = scanner.normalizeKizInput(scan);
  assert.equal(normalized.code,fullKiz);
  assert.equal(normalized.gsCount,2);
}
assert.equal(scanner.normalizeKizInput(fullKiz).restored,false);
const truncated = fullKiz.slice(0,-1);
assert.equal(scanner.normalizeKizInput(truncated).code,truncated);

function scanKeys(options, keys){
  const input={dataset:{},value:'',selectionStart:0,selectionEnd:0,
    addEventListener(_event,handler){this.handle=handler;}};
  scanner.forceEnglishInput(input,options);
  for(const key of keys) input.handle({...key,preventDefault(){}});
  return input.value;
}
assert.equal(scanKeys({f8AsGs:true},[
  {key:'F8'},{key:']',code:'BracketRight',ctrlKey:true},{key:'Ф',code:'KeyA',shiftKey:false},
]),gs+gs+'a');
assert.equal(scanKeys({},[{key:'F8'}]),'');

const withQuote = ['01046070095200012112345"7890123',segments[1],segments[2]].join(gs);
const serialized = JSON.stringify(withQuote);
for(const input of [withQuote,serialized,JSON.stringify([withQuote]),serialized.slice(1,-1)]){
  assert.equal(scanner.normalizeKizInput(input).code,withQuote);
}
assert.equal(scanner.normalizeKizInput(JSON.stringify([withQuote,fullKiz])).invalidFormat,true);
assert.equal(scanner.normalizeKizInput(serialized.replace(/\\u001d/g,'\\\\u001d')).invalidFormat,true);

const fbs = fs.readFileSync('js/05-fbs.js','utf8');
const canceledOrder = {orderId:1,clientId:'c',supplierStatus:'new'};
const shortageOrder = {orderId:2,clientId:'c',supplierStatus:'new'};
const assemblyErrors = [];
const assemblyCalls = [];
let cancelOnAssemble = false;
let failB2b = false;
const canceledResponse = () => ({error:{context:Response.json({code:'ORDER_CANCELED',
  error:'Заказ отменён в WB',supplierStatus:'new',wbStatus:'declined_by_client'},{status:409})}});
const assembly = vm.createContext({fbsOrders:[{...canceledOrder},shortageOrder],fbsSelectedOrders:[1,2],
  assemblingOrder:null,clients:[],window:{},loadInventory:async()=>{},renderFbsBody(){},
  document:{getElementById:()=>({value:''})},setFbsView(){ throw Error('Неожиданное переключение вкладки'); },
  findInventoryItem:()=>({sku:'A'}),toast:msg=>assemblyErrors.push(msg),
  sb:{functions:{invoke:async(slug,{body})=>{
    assemblyCalls.push(body.action);
    if(body.orderId===2) return {data:{error:'Недостаточно товара'}};
    if(failB2b && body.action==='assemble') return {data:{error:'FailedToAddSupplyOrder'}};
    if(failB2b && slug==='wb-b2b-supply-ts') return {data:{error:'Заказ закрыт'}};
    return cancelOnAssemble && body.action==='deduct_fbs' ? {data:{ok:true}} : canceledResponse();
  }}}});
vm.runInContext(fbs.slice(fbs.indexOf('const FBS_WB_CANCELED'),fbs.indexOf('function fbsStatusBadge')),assembly);
vm.runInContext(fbs.slice(fbs.indexOf('async function bulkAssembleSelectedFbsOrders'),fbs.indexOf('async function cancelFbsOrder')),assembly);
await assembly.bulkAssembleSelectedFbsOrders();
assert.equal(assembly.fbsTabOf(assembly.fbsOrders[0]),'cancel');
assert.deepEqual(Array.from(assembly.fbsSelectedOrders),[2]);
assert.deepEqual(assemblyCalls,['deduct_fbs','deduct_fbs']);
assert.match(assemblyErrors.at(-2),/перенесён в «Отменённые»/);
assert.equal(assembly.fbsTabOf(shortageOrder),'new');
assert.match(assemblyErrors.at(-1),/Недостаточно товара/);
cancelOnAssemble = true;
canceledOrder.wbStatus = null;
await assembly.finishAssembleOrder(canceledOrder,null,true);
assert.equal(assembly.fbsTabOf(canceledOrder),'cancel');
assert.deepEqual(assemblyCalls.slice(-2),['deduct_fbs','assemble']);
failB2b = true;
canceledOrder.wbStatus = null;
await assembly.finishAssembleOrder(canceledOrder,null,true);
assert.equal(assembly.fbsTabOf(canceledOrder),'cancel');
assert.deepEqual(assemblyCalls.slice(-4),['deduct_fbs','assemble','add_order','check_order_cancellation']);
assembly.findInventoryItem=()=>null;
canceledOrder.wbStatus = null;
await assembly.finishAssembleOrder(canceledOrder,null,true);
assert.equal(assembly.fbsTabOf(canceledOrder),'cancel');
assert.equal(assemblyCalls.at(-1),'check_order_cancellation');
assert.equal(assembly.fbsTabOf({supplierStatus:'confirm',wbStatus:'declined_by_client'}),'cancel');
assert.equal(assembly.fbsTabOf({supplierStatus:'complete',wbStatus:'canceled_by_client'}),'done');

const fbsMessages = fbs.slice(fbs.indexOf('function notifyFbsKizAccepted'),fbs.indexOf('function watchPendingKiz'));
const signals = [];
const messages = [];
const notification = vm.createContext({playBeep:type=>signals.push(type),toast:message=>messages.push(message)});
vm.runInContext(fbsMessages,notification);
notification.notifyFbsKizAccepted(1,'filled');
assert.deepEqual(signals,[]);
assert.match(messages.at(-1),/без проверки/);
notification.notifyFbsKizAccepted(1,'sgtinIntroduced');
assert.deepEqual(signals,['ok']);
assert.match(messages.at(-1),/КИЗ проверен WB/);
notification.notifyFbsKizRejected(2);
assert.deepEqual(signals,['ok','error']);

const statusView = vm.createContext({});
vm.runInContext(fbs.slice(fbs.indexOf('function renderKizStatusLabel'),fbs.indexOf('function renderFbsWarehouseBadge')),statusView);
for(const status of ['pending','rejected','attached','verify_failed']){
  const label = statusView.renderKizStatusLabel({requiresKiz:true,kizCode:withQuote,kizDecision:serialized,kizStatus:status});
  assert.ok(!label.includes(segments[0].slice(0,18)));
}

const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as 'select null::uuid';
create table employees(id text,name text,active bool,auth_user_id uuid, warehouse_id text);
create function current_employee() returns employees language sql security definer set search_path to 'public' as 'select e.* from public.employees e where e.auth_user_id=auth.uid() and e.active limit 1';
create function has_permission(text) returns bool language sql as 'select true';
create schema vault;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create schema net;
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns int language sql as 'select 1';
create table clients (id text, name text, stock_allocation_mode text, wb_connected bool, wb_key text, wb_auto_sync bool, wb_warehouse_id text);
create table inventory (sku text,client_name text,size text,warehouse_id text, qty int, name text, barcode text, is_kit bool, kit_mode text, wb_allocated_qty int, ozon_allocated_qty int, safety_buffer int, primary key(sku,client_name,size,warehouse_id));
create table inventory_barcodes(barcode text,sku text,client_name text,size text);
create table warehouses(id text primary key,name text);
create table movement_log(sku text,name text,delta int,type text,client_name text,size text,employee_id text,employee_name text);
create table returns(id text primary key,sku text,name text,size text,client_name text,warehouse_id text,qty int,order_id text,reason text,resolution text,employee_id text,employee_name text);
create table wb_orders(order_id bigint primary key,client_id text,client_name text,barcode text,article text,supplier_status text,wb_status text,kiz_status text);
create table wb_fbs_stock_operations(order_id bigint primary key,client_id text,state text,items jsonb,updated_at timestamptz default now());
create table kit_components(kit_sku text,kit_size text,kit_client_name text,kit_warehouse_id text,component_sku text,component_size text,qty_needed numeric);
create table ozon_orders(article text,client_name text,status text,qty int);
create table ozon_offers(offer_id text,client_name text,inv_sku text,inv_size text,status text);
insert into clients(id,name,stock_allocation_mode,wb_connected,wb_key,wb_auto_sync,wb_warehouse_id) values('c','C','shared',true,'synthetic',true,'1');
insert into vault.decrypted_secrets values ('wms_wb_cron_token','synthetic'), ('wms_wb_project_url','https://invalid.example');
insert into inventory(sku,client_name,size,warehouse_id,qty,name,barcode,is_kit,kit_mode) values
('A','C','','MAIN',100,'A','10',false,null),('B','C','','MAIN',5,'B','20',false,null),('K','C','','MAIN',0,'K','30',true,'virtual');
insert into kit_components values ('K','','C','MAIN','A','',2),('K','','C','MAIN','B','',1);
insert into wb_orders values (1,'c','C','30','K','new',null,'pending');
insert into ozon_orders values ('A','C','awaiting_packaging',1);
`);
for(const f of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const first=async (q,args)=>Object.values((await db.query(q,args)).rows[0])[0];
for(const role of ['anon','authenticated','service_role']){
  for(const signature of ['wb_fbs_deduct(bigint,text,text,text,text,text,text)',
    'wb_fbs_restore(bigint,text,text,text,text,text,text,text,text)']){
    assert.equal(await first("select has_function_privilege($1,$2,'execute')",[role,signature]),role==='service_role');
  }
}
const dateInMoscow = await first("select to_char(statement_timestamp() at time zone 'Europe/Moscow','DD.MM.YYYY')");
assert.equal(await first("select next_wb_supply_name('cabinet-a')"),`Телепак - ${dateInMoscow} - 1`);
assert.equal(await first("select next_wb_supply_name('cabinet-a')"),`Телепак - ${dateInMoscow} - 2`);
assert.equal(await first("select next_wb_supply_name('cabinet-b')"),`Телепак - ${dateInMoscow} - 1`);
await db.exec("insert into wb_supply_daily_numbers values ('cabinet-c', (now() at time zone 'Europe/Moscow')::date-1, 7)");
assert.equal(await first("select next_wb_supply_name('cabinet-c')"),`Телепак - ${dateInMoscow} - 1`);
assert.equal(await first("select has_function_privilege('authenticated','public.next_wb_supply_name(text)','execute')"),false);
await db.exec(`select trigger_wb_fetch_new(); select trigger_wb_push_stocks(); select trigger_wb_recheck_pending_kiz();`);
assert.equal(await first("select wb_available from get_available_stock('C') where sku='A'"),97);
const deduct=(id,sku)=>first("select wb_fbs_deduct($1,'c',$2,'','MAIN','staff','Tester')",[id,sku]);
const restore=(id,sku,mode)=>first("select wb_fbs_restore($1,'c',$2,'','MAIN',$3,'synthetic','staff','Tester')",[id,sku,mode]);
const qty=(sku,wh='MAIN')=>first("select qty from inventory where sku=$1 and warehouse_id=$2",[sku,wh]);
assert.deepEqual((await Promise.all([deduct(1,'K'),deduct(1,'K')])).map(x=>x.applied),[true,false]);
assert.equal(await qty('A'),98);
assert.equal(await first("select wb_available from get_available_stock('C') where sku='A'"),97);
await assert.rejects(restore(1,'K','restock'),/активен/);
await db.exec("update wb_orders set supplier_status='cancel' where order_id=1; update kit_components set qty_needed=4 where component_sku='A';");
await assert.rejects(restore(1,'B','restock'),/не соответствует/);
assert.deepEqual((await Promise.all([restore(1,'K','restock'),restore(1,'K','restock')])).map(x=>x.applied),[true,false]);
assert.equal(await qty('A'),100);
assert.equal(await qty('B'),5);
assert.equal(await qty('K'),0);
await assert.rejects(deduct(1,'K'),/уже возвращён/);
await db.exec("insert into wb_orders values (2,'c','C','30','K','new',null,null);");
await deduct(2,'K');
await db.exec("update wb_orders set supplier_status='complete' where order_id=2;");
assert.equal((await restore(2,'K','defect')).applied,true);
assert.equal(await qty('A','BRAK'),4);
assert.equal(await qty('B','BRAK'),1);
assert.equal(await qty('A'),96);
assert.equal(await first("select wb_available from get_available_stock('C') where sku='A'"),95);
await db.exec("insert into wb_orders values (3,'c','C','10','A','new',null,null);");
await deduct(3,'A');
await db.exec("update wb_orders set supplier_status='cancel' where order_id=3; update wb_fbs_stock_operations set product=null where order_id=3;");
assert.equal((await restore(3,'A','restock')).applied,true);
assert.equal(await qty('A'),96);
await db.exec("update inventory set qty=0 where sku='B' and warehouse_id='MAIN'; insert into wb_orders values (4,'c','C','30','K','new',null,null);");
await assert.rejects(deduct(4,'K'),/Недостаточно/);
assert.equal(await qty('A'),96);
assert.equal(await first("select count(*)::int from wb_fbs_stock_operations where order_id=4"),0);
await assert.rejects(first("select record_inventory_return('RET-00000000-0000-0000-0000-000000000001','A','C','','MAIN',2,null,'','restock')"),/Нет доступа/);
await db.exec(`create or replace function auth.uid() returns uuid language sql as 'select ''11111111-1111-1111-1111-111111111111''::uuid';
insert into employees values ('staff','Tester',true,'11111111-1111-1111-1111-111111111111','MAIN');`);
const manualReturn=(id,mode)=>first("select record_inventory_return($1,'A','C','','MAIN',2,null,'',$2)",[id,mode]);
const requestId='RET-00000000-0000-0000-0000-000000000001';
assert.equal(await manualReturn(requestId,'defect'),true);
assert.equal(await manualReturn(requestId,'defect'),false);
assert.equal(await qty('A','BRAK'),6);
assert.equal(await qty('A'),96);
console.log('Postgres: reservations, deduction, changed BOM, cancellation, duplicate retries, defect, legacy regular return, rollback, cron functions');
for(const slug of ['wb-orders-ts','wb-sync-stocks-ts','wb-b2b-supply-ts','wb-supply-return-ts']){
  const src=fs.readFileSync('supabase/functions/'+slug+'/index.ts','utf8');
  const result=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(result.diagnostics.length,0);
  if(slug==='wb-supply-return-ts'){
    const requestBatches=[], savedBatches=[];
    let ambiguous=false;
    const sb={
      auth:{getUser:async()=>({data:{user:{id:'synthetic-user'}}})},
      rpc:async(name)=>({data:name==='next_wb_supply_name'?'Телепак - 28.11.2026 - 1':true}),
      from:table=>{
        let ids=[],writing=false;
        const q={select:()=>q,eq:()=>q,in:(_field,list)=>{ids=list;return q;},
          update:()=>{writing=true;return q;},insert:async()=>({error:null}),
          single:async()=>({data:{id:'c',name:'Synthetic',wb_key:'unused-live-key'}}),
          maybeSingle:async()=>({data:{id:'WB-GI-SAND-1'}}),
          then:resolve=>{
            if(writing) savedBatches.push(Array.from(ids));
            return Promise.resolve({data:ids.map(id=>({order_id:id,wb_supply_id:'old',wb_warehouse_id:'1'}))}).then(resolve);
          }};
        return q;
      },
    };
    const sandbox={exports:{},require:()=>({createClient:()=>sb}),Deno:{env:{get:key=>({SUPABASE_URL:'https://invalid.example',WMS_WB_TEST_TOKEN:'sandbox-only'})[key]}},Response,Request,URL,
      fetch:async(url,init)=>{
        assert.equal(new URL(url).hostname,'marketplace-api-sandbox.wildberries.ru');
        if(init.method==='PATCH'){
          const batch=JSON.parse(init.body).orders;
          requestBatches.push(batch);
          return ambiguous ? Response.json({}, {status:409}) : new Response(null,{status:204});
        }
        if(init.method==='POST') return Response.json({id:'WB-GI-SAND-1'},{status:201});
        if(url.endsWith('/order-ids')) return Response.json({orderIds:[1]});
        return Response.json({done:false});
      }};
    vm.runInNewContext(result.outputText,sandbox);
    const invoke=async body=>(await sandbox.exports.default.fetch(new Request('https://invalid.example',{method:'POST',
      headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({clientId:'c',...body})}))).json();
    const all=Array.from({length:205},(_,i)=>i+1);
    const manual=await invoke({orderIds:all,targetSupplyId:'WB-GI-SAND-1'});
    assert.equal(manual.moved,205);
    assert.deepEqual(requestBatches.map(x=>x.length),[100,100,5]);
    assert.deepEqual(savedBatches,requestBatches);
    requestBatches.length=0;savedBatches.length=0;
    const partial=await invoke({orderIds:all.slice(0,50),createHolding:true});
    assert.equal(partial.moved,50);
    assert.equal(requestBatches.length,1);
    ambiguous=true;
    requestBatches.length=0;savedBatches.length=0;
    const interrupted=await invoke({orderIds:all,targetSupplyId:'WB-GI-SAND-1'});
    assert.equal(interrupted.moved,1);
    assert.equal(interrupted.failed.length,204);
    assert.equal(requestBatches.length,1);
    assert.equal(savedBatches.length,1);
    assert.equal(savedBatches[0].join(','),'1');
    console.log('WB transfer mock: 50 orders in one request, 205 in three, reconcile ambiguous transfer before updating WMS');
    continue;
  }

  if(slug==='wb-b2b-supply-ts'){
    let allowed=false, status='new', employeeWarehouse='OTHER';
    let confirmed=false;
    const calls=[];
    const sb={
      auth:{getUser:async()=>({data:{user:{id:'staff-auth'}}})},
      from:(table)=>{
        const query={
          select:()=>query, eq:()=>query,
          insert:async()=>({}),
          order:async()=>({data:[]}),
          update:(row)=>{confirmed=row.supplier_status==='confirm';return query;},
          single:async()=>({data:{wb_key:'synthetic'}}),
          maybeSingle:async()=>({data:table==='wb_fbs_stock_operations'
            ? {state:'deducted',items:[{warehouse:'MAIN'}]}
            : confirmed ? {order_id:1} : {wb_warehouse_id:'1',supplier_status:status,requires_kiz:true,wb_status:null}}),
        };
        return query;
      },
      rpc:async(name,args)=>({data:name==='next_wb_supply_name' ? 'Телепак - 10.10.2026 - 1' : name==='current_employee'
        ? {id:'staff',warehouse_id:employeeWarehouse} : args.permission_name==='fbs' && allowed}),
    };
    const sandbox={exports:{},require:()=>({createClient:()=>sb}),Deno:{env:{get:key=>({SUPABASE_URL:'https://invalid.example',WMS_WB_TEST_TOKEN:'sandbox-only'})[key]}},Response,Request,URL,URLSearchParams,
      fetch:async(url,init)=>{
        assert.equal(new URL(url).hostname,'marketplace-api-sandbox.wildberries.ru');
        calls.push(init.method);
        if(init.method==='POST'){
          assert.deepEqual(JSON.parse(init.body),{name:'Телепак - 10.10.2026 - 1'});
          return Response.json({id:'WB-GI-SAND-1'},{status:201});
        }
        assert.deepEqual(JSON.parse(init.body),{orders:[1]});
        return new Response(null,{status:204});
      }};
    vm.runInNewContext(result.outputText,sandbox);
    const invoke=(kizCode)=>sandbox.exports.default.fetch(new Request('https://invalid.example',{method:'POST',
      headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({clientId:'c',orderId:1,action:'add_order',kizCode})}));
    assert.equal((await invoke()).status,403);
    allowed=true;
    status='cancel';
    assert.match((await (await invoke()).json()).error,/закрыт/);
    status='new';
    assert.equal((await invoke('synthetic')).status,403);
    assert.deepEqual(calls,[]);
    employeeWarehouse='MAIN';
    const accepted=await invoke();
    assert.equal(accepted.status,200);
    assert.equal((await accepted.json()).wbSupplyId,'WB-GI-SAND-1');
    assert.equal(confirmed,true);
    assert.deepEqual(calls,['POST','PATCH']);
    console.log('WB B2B mock: permission, warehouse, KIZ, canceled order and successful confirmation');
    continue;
  }
  if(slug==='wb-orders-ts'){
    const orders=new Map();
    const historyCursors=[];
    const statusRequests=[];
    let upstream=0, pushes=0, deductions=0, sentKiz;
    let supplierStatus="new", wbStatus=null, wbRequiresKiz=true, currentKiz=null;
    let remoteStatus, deductError;
    let orderReserved=false;
    const cancellationUpdates=[];
    let metaRows=[{orderId:1,meta:{sgtin:{status:'filled'}}}];
    const pendingRows=[12,13,14,15,16].map(id=>({order_id:id,kiz_code:'synthetic',
      kiz_status:id>=15?'attached':'pending',kiz_updated_at:null}));
    const verdictUpdates=[];
    let orderHandler;
    const sb={
      auth:{getUser:async()=>({data:{user:{id:'staff-auth'}}})},
      from:(table)=>{
        let requested;
        const query={
          then:resolve=>Promise.resolve({data:requested?.filter(id=>orders.has(id)).map(id=>({order_id:id}))}).then(resolve),
          eq:()=>query, in:(_field,ids)=>{requested=ids;return query;}, not:()=>query, is:()=>query,
          or:()=>query, order:()=>query, limit:async()=>({data:pendingRows}),
          maybeSingle:async()=>({data: table==='wb_orders'
            ? {order_id:1,requires_kiz:wbRequiresKiz,supplier_status:supplierStatus,wb_status:wbStatus,wb_supply_id:'test-supply',kiz_code:currentKiz}
            : table==='wb_fbs_stock_operations' ? {state:'deducted',items:[{warehouse:'MAIN'}]}
            : table==='inventory' ? {requires_kiz:true}
            : {id:'c',name:'C',wb_key:'synthetic',wb_warehouse_id:'1',wb_warehouse_ids:['1','2']}}),
          single:async()=>({data:table==='employees'
            ? {id:'staff',name:'Tester',role_id:'test',warehouse_id:'MAIN'}
            : {permissions:{fbs:true}}}),
        };
        return {
        select:()=>query,
        upsert:(rows)=>({select:async()=>{
          const fresh=rows.filter(r=>!orders.has(r.order_id));
          for(const r of fresh) orders.set(r.order_id,r);
          return {data:fresh};
        }}),
        update:(patch)=>{
          if(patch.kiz_status) verdictUpdates.push(patch);
          if(patch.wb_status){ cancellationUpdates.push(patch); wbStatus=patch.wb_status; supplierStatus=patch.supplier_status; }
          return query;
        },
      }; },
      rpc:async(name)=>{
        if(name==='wb_fbs_deduct'){ deductions++; if(deductError) return {error:{message:deductError}}; }
        return {data:name==='get_available_stock'?[{barcode:'10',wb_available:100-orders.size-Number(orderReserved && !wbStatus)}]:true};
      },
    };
    const sandbox={exports:{},require:()=>({createClient:()=>sb}),Deno:{serve:handler=>{orderHandler=handler;},env:{get:k=>({SUPABASE_URL:'https://invalid.example',SUPABASE_SERVICE_ROLE_KEY:'test-token',WMS_WB_CRON_TOKEN:'cron-test',WMS_WB_TEST_TOKEN:'sandbox-only'})[k]}},Response,Request,URL,URLSearchParams,
      fetch:async(url, init)=>{
        if(url.endsWith('/meta/sgtin')){
          sentKiz=JSON.parse(init.body).sgtins[0];
          return new Response(null,{status:204});
        }
        if(url.endsWith('/orders/meta')) return Response.json({orders:metaRows});
        const parsedUrl = new URL(url);
        if(parsedUrl.pathname==='/api/v3/orders'){
          const params=parsedUrl.searchParams;
          assert.equal(params.get('limit'),'1000');
          assert.ok(params.has('next'));
          assert.equal(Number(params.get('dateTo'))-Number(params.get('dateFrom')),30*86400-1);
          const next=params.get('next');
          historyCursors.push(next);
          return next==='0'
            ? Response.json({next:12,orders:[{id:1,warehouseId:1},{id:20,warehouseId:2,supplyId:'synthetic'},{id:21,warehouseId:5}]})
            : Response.json({next:0,orders:[{id:22,warehouseId:2},{id:23,warehouseId:2}]});
        }
        if(parsedUrl.pathname==='/api/v3/orders/status'){
          const ids=JSON.parse(init.body).orders;
          statusRequests.push(...ids);
          if(ids.length===1 && ids[0]===1) return Response.json({orders:remoteStatus ? [remoteStatus] : []});
          return Response.json({orders:[{id:20,supplierStatus:'complete',wbStatus:'sold'},
            {id:22,supplierStatus:'cancel',wbStatus:'canceled'}]});
        }
        if(parsedUrl.pathname.endsWith('/supplies/test-supply/orders') && init.method==='PATCH'){
          return Response.json({code:'FailedToAddSupplyOrder'},{status:409});
        }
        if(url.endsWith('/api/v3/orders/new')){
          assert.equal(new URL(url).hostname,'marketplace-api-sandbox.wildberries.ru');
          upstream++;
          return Response.json({orders:[{id:1,warehouseId:1,skus:['10'],requiredMeta:['sgtin']},{id:2,warehouseId:2,skus:['10']},{id:3,warehouseId:3,skus:['10']}]});
        }
        if(url.endsWith('/wb-sync-stocks-ts')){pushes++;return Response.json({ok:true});}
        throw Error('Unexpected endpoint');
      }};
    vm.runInNewContext(result.outputText,sandbox);
    const invoke=(headers,body={action:'fetch_new'})=>orderHandler(new Request('https://invalid.example',{method:'POST',headers,body:JSON.stringify({clientId:'c',...body})}));
    assert.equal((await invoke({})).status,401);
    assert.equal(upstream,0);
    const h={'x-wms-cron-token':'cron-test'};
    const fresh=await (await invoke(h)).json();
    assert.equal(fresh.fetched,2);
    assert.equal(fresh.skippedWrongWarehouse,1);
    assert.equal(orders.get(1).requires_kiz,true);
    assert.equal(orders.get(2).requires_kiz,null);
    assert.equal((await (await invoke(h)).json()).fetched,0);
    assert.equal(pushes,1);
    const recovered=await (await invoke(h,{action:'discover_missing_orders'})).json();
    assert.deepEqual(historyCursors,['0','12']);
    assert.deepEqual(statusRequests,[20,22,23]);
    assert.equal(recovered.inserted,2);
    assert.equal(recovered.skippedWithoutStatus,1);
    assert.equal(orders.get(20).supplier_status,'complete');
    assert.equal(orders.get(20).wb_supply_id,'synthetic');
    assert.equal(orders.get(22).supplier_status,'cancel');
    assert.equal(orders.has(23),false);
    const staff={Authorization:'Bearer staff-test'};
    const deduction={action:'deduct_fbs',orderId:1,warehouse:'MAIN',sku:'A'};
    assert.equal((await invoke(staff,deduction)).status,200);
    assert.equal(deductions,1);
    wbRequiresKiz=false;
    assert.equal((await invoke(staff,deduction)).status,200);
    assert.equal(deductions,2);
    wbStatus='declined_by_client';
    const alreadyCanceled=await invoke(staff,deduction);
    assert.equal(alreadyCanceled.status,409);
    assert.equal((await alreadyCanceled.json()).code,'ORDER_CANCELED');
    assert.equal(deductions,2);
    wbStatus=null;
    deductError='Недостаточно товара A';
    const shortage=await invoke(staff,deduction);
    assert.equal((await shortage.json()).error,deductError);
    assert.equal(cancellationUpdates.length,0);
    deductError=null;
    remoteStatus={id:1,supplierStatus:'new',wbStatus:'declined_by_client'};
    const remoteCanceled=await invoke(staff,{action:'assemble',orderId:1});
    assert.equal(remoteCanceled.status,409);
    assert.equal((await remoteCanceled.json()).code,'ORDER_CANCELED');
    assert.equal(cancellationUpdates.length,1);
    assert.equal(wbStatus,'declined_by_client');
    assert.equal(pushes,1);
    wbStatus=null;
    orderReserved=true;
    const checked=await invoke(staff,{action:'check_order_cancellation',orderId:1});
    assert.equal((await checked.json()).code,'ORDER_CANCELED');
    assert.equal(pushes,2);
    wbStatus=null;
    orderReserved=false;
    const early = await invoke(staff,{action:'attach_kiz',orderId:1,kizCode:'synthetic'});
    assert.notEqual(early.status,200);
    assert.equal(sentKiz,undefined);
    supplierStatus='confirm';
    const scanned='010460700952000121SYNTHETIC\u001d91TEST';
    const response=await invoke(staff,{action:'attach_kiz',orderId:1,kizCode:scanned});
    assert.equal(response.status,200);
    assert.equal((await response.json()).kizStatus,'attached');
    assert.equal(sentKiz,scanned);
    currentKiz=scanned;
    metaRows=[{id:1,metaDetails:[{key:'sgtin',value:JSON.stringify([scanned]),decision:'sgtinIntroduced'}]}];
    const replacement=scanned+'NEW';
    const retry=await invoke(staff,{action:'attach_kiz',orderId:1,kizCode:replacement});
    assert.equal((await retry.json()).kizStatus,'pending');
    assert.equal(sentKiz,replacement);
    verdictUpdates.length=0;
    metaRows=[
      {id:13,meta:{sgtin:{status:'filled'}},metaDetails:[{key:'sgtin',value:['synthetic'],decision:'sgtinNoGS'}]},
      {id:12,metaDetails:[{key:'sgtin',value:['synthetic'],decision:'sgtinIntroduced'}]},
      {id:14,meta:{sgtin:{value:['synthetic']}}},
      {id:15,metaDetails:[{key:'sgtin',value:'',decision:'optional'}]},
      {id:16,metaDetails:[{key:'sgtin',value:'["other-synthetic"]',decision:'sgtinIntroduced'}]},
    ];
    const recheck=await invoke(h,{action:'recheck_pending_kiz'});
    assert.equal(recheck.status,200);
    assert.equal((await recheck.json()).checked,5);
    assert.deepEqual(verdictUpdates.map(patch=>[patch.kiz_status,patch.kiz_decision]),[
      ['attached','sgtinIntroduced'],['rejected','sgtinNoGS'],['pending',null],['missing',null],['missing',null],
    ]);
    assert.equal(verdictUpdates[3].kiz_code,null);
    assert.equal(verdictUpdates[4].kiz_code,null);
    console.log('WB orders mock: cron auth, selected warehouses, duplicate import, changed stock push, mandatory KIZ');
    continue;
  }
  let calls=[], current={}, desired=99;
  let leased=false;
  const dbMock={from:(table)=>({select:()=>({eq:()=>({
    maybeSingle:async()=>({data:{size_ids:{'10':123},updated_at:new Date().toISOString()}}),
    single:async()=>({data:{name:'C',wb_key:'synthetic',wb_warehouse_id:'1',wb_warehouse_ids:['1','2']}})})}),
    update:()=>({eq:async()=>({})}),delete:()=>({eq:()=>({eq:async()=>{leased=false;}})})}),
    rpc:async(name)=>{if(name==='claim_wb_stock_sync'){if(leased)return {data:false};leased=true;return {data:true};}
     return {data:[{barcode:'10',wb_available:desired}]};}};

  const sandbox={exports:{},require:()=>({createClient:()=>dbMock}),Deno:{env:{get:k=>({SUPABASE_URL:'https://invalid.example',SUPABASE_SERVICE_ROLE_KEY:'test-token',WMS_WB_CRON_TOKEN:'cron-test',WMS_WB_TEST_TOKEN:'sandbox-only'})[k]}},Response,Request,URL,crypto,fetch:async(url,opts)=>{
    assert.equal(new URL(url).hostname,'marketplace-api-sandbox.wildberries.ru');
    const warehouse=url.split('/').at(-1); const body=JSON.parse(opts.body);
    if(opts.method==='POST') return Response.json({stocks:body.chrtIds.map(chrtId=>({chrtId,amount:current[warehouse]}))});
    assert.equal(body.stocks[0].chrtId,123);
    calls.push([warehouse,body.stocks[0].amount]); current[warehouse]=body.stocks[0].amount;
    return new Response(null,{status:204});
  }};
  vm.runInNewContext(result.outputText,sandbox);
  const invoke=(headers={Authorization:'Bearer test-token'})=>sandbox.exports.default.fetch(new Request('https://invalid.example',{method:'POST',headers,body:JSON.stringify({clientId:'c',action:'push_stocks'})}));
  current={1:99,2:100};
  assert.equal((await invoke()).status,200);
  assert.deepEqual(calls,[['2',99]]);
  calls=[]; assert.equal((await (await invoke()).json()).sent,0); assert.deepEqual(calls,[]);
  current={1:1,2:2}; desired=3;
  assert.equal((await invoke({'x-wms-cron-token':'cron-test'})).status,200); assert.deepEqual(calls,[['1',3]]);
  calls=[]; current={1:3,2:5}; desired=2;
  assert.equal((await invoke()).status,200); assert.deepEqual(calls,[['1',2],['2',2]]);
  assert.equal((await invoke({})).status,401);
  assert.deepEqual((await Promise.all([invoke(),invoke()])).map(r=>r.status).sort(),[200,409]);
  console.log('WB mock: 100→99 on both warehouses, unchanged values, low-stock no refill, secondary reduction, cron and missing credentials');
}
await db.close();
