import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
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
insert into vault.decrypted_secrets values ('wms_wb_cron_token','synthetic');
insert into inventory(sku,client_name,size,warehouse_id,qty,name,barcode,is_kit,kit_mode) values
('A','C','','MAIN',100,'A','10',false,null),('B','C','','MAIN',5,'B','20',false,null),('K','C','','MAIN',0,'K','30',true,'virtual');
insert into kit_components values ('K','','C','MAIN','A','',2),('K','','C','MAIN','B','',1);
insert into wb_orders values (1,'c','C','30','K','new',null,'pending');
insert into ozon_orders values ('A','C','awaiting_packaging',1);
`);
for(const f of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const first=async (q,args)=>Object.values((await db.query(q,args)).rows[0])[0];
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
for(const slug of ['wb-orders-ts','wb-sync-stocks-ts','wb-b2b-supply-ts']){
  const src=fs.readFileSync('supabase/functions/'+slug+'/index.ts','utf8');
  const result=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  assert.equal(result.diagnostics.length,0);
  if(slug==='wb-b2b-supply-ts'){
    let allowed=false, status='new', attached=false;
    const query={
      select:()=>query, eq:()=>query, update:()=>query,
      single:async()=>({data:{wb_key:'synthetic'}}),
      maybeSingle:async()=>({data:attached ? null : {wb_warehouse_id:'1', supplier_status:status,
        requires_kiz:true, wb_status:null, wb_supply_id:null}}),
    };
    const sb={auth:{getUser:async()=>({data:{user:{id:'staff-auth'}}})},from:()=>query,
      rpc:async()=>({data:allowed})};
    const sandbox={exports:{},require:()=>({createClient:()=>sb}),Deno:{env:{get:()=>''}},Response,Request,
      fetch:async()=>{attached=true;throw Error('Unexpected marketplace call');}};
    vm.runInNewContext(result.outputText,sandbox);
    const invoke=()=>sandbox.exports.default.fetch(new Request('https://invalid.example',{method:'POST',
      headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({clientId:'c',orderId:1,action:'add_order'})}));
    assert.equal((await invoke()).status,403);
    allowed=true;
    assert.match((await (await invoke()).json()).error,/КИЗ/);
    status='cancel';
    assert.match((await (await invoke()).json()).error,/закрыт/);
    assert.equal(attached,false);
    console.log('WB B2B mock: permission, KIZ and canceled order gates');
    continue;
  }
  if(slug==='wb-orders-ts'){
    const orders=new Map();
    let upstream=0, pushes=0, deductions=0;
    let orderHandler;
    const sb={
      auth:{getUser:async()=>({data:{user:{id:'staff-auth'}}})},
      from:(table)=>{
        const query={
          eq:()=>query,
          maybeSingle:async()=>({data: table==='wb_orders'
            ? {order_id:1,requires_kiz:true,supplier_status:'new'}
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
        update:()=>({eq:async()=>({})}),
      }; },
      rpc:async(name)=>{
        if(name==='wb_fbs_deduct') deductions++;
        return {data:name==='get_available_stock'?[{barcode:'10',wb_available:100-orders.size}]:true};
      },
    };
    const sandbox={exports:{},require:()=>({createClient:()=>sb}),Deno:{serve:handler=>{orderHandler=handler;},env:{get:k=>({SUPABASE_URL:'https://invalid.example',SUPABASE_SERVICE_ROLE_KEY:'test-token',WMS_WB_CRON_TOKEN:'cron-test'})[k]}},Response,Request,
      fetch:async(url)=>{
        if(url.endsWith('/api/v3/orders/new')){
          upstream++;
          return Response.json({orders:[{id:1,warehouseId:1,skus:['10']},{id:2,warehouseId:2,skus:['10']},{id:3,warehouseId:3,skus:['10']}]});
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
    assert.equal((await (await invoke(h)).json()).fetched,0);
    assert.equal(pushes,1);
    const staff={Authorization:'Bearer staff-test'};
    const deduction={action:'deduct_fbs',orderId:1,warehouse:'MAIN',sku:'A'};
    assert.equal((await invoke(staff,deduction)).status,500);
    assert.equal(deductions,0);
    assert.equal((await invoke(staff,{...deduction,kizCode:'synthetic-kiz'})).status,200);
    assert.equal(deductions,1);
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

  const sandbox={exports:{},require:()=>({createClient:()=>dbMock}),Deno:{env:{get:k=>({SUPABASE_URL:'https://invalid.example',SUPABASE_SERVICE_ROLE_KEY:'test-token',WMS_WB_CRON_TOKEN:'cron-test'})[k]}},Response,Request,crypto,fetch:async(url,opts)=>{
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
