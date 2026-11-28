import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const liveProject = () => new URL(Deno.env.get('SUPABASE_URL')!).hostname === 'mixsvqjlrifkcoeuuydc.supabase.co';
const marketplace = () => liveProject()
  ? 'https://marketplace-api.wildberries.ru'
  : 'https://marketplace-api-sandbox.wildberries.ru';
const sellerToken = (stored: string | null) => liveProject()
  ? stored : Deno.env.get('WMS_WB_TEST_TOKEN');
const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json = (v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const errText = async (r:Response)=>{const t=await r.text();return t.slice(0,1200)||r.statusText};
const acceptedKiz = new Set(["filled","accepted","sgtinIntroduced","sgtinSoldB2B"]);
const rejectedKiz = new Set([
 "required","optional","rejected","sgtinInvalidFormat","sgtinNoGS","sgtinHasInvalidSymbols",
 "sgtinHasNonLatinSymbols","sgtinInvalidPattern","sgtinNotFound","sgtinEmitted","sgtinApplied",
 "sgtinWrittenOff","sgtinWithdrawn","sgtinRetired","sgtinDisaggregated","sgtinDisaggregation","sgtinAppliedNotPaid"
]);
function kizVerdict(item:any){
 const detail=Array.isArray(item.metaDetails) ? item.metaDetails.find((entry:any)=>entry?.key==="sgtin") : null;
 const raw=detail?.decision ?? (item.meta||item).sgtin?.status;
 if(acceptedKiz.has(raw)) return {status:"attached",decision:raw};
 if(rejectedKiz.has(raw)) return {status:"rejected",decision:raw};
 return {status:"pending",decision:raw==="deadlineExceeded" || raw==="pending" ? raw : null};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
 if(req.method!=="POST") return json({error:"POST required"},405);
 try {
  const b=await req.json(); const {clientId,action}=b;
  if(!clientId||!action) return json({error:"clientId и action обязательны"},400);
  const url=Deno.env.get("SUPABASE_URL")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb=createClient(url,service);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  let staff=false; let staffUid:string|null=null;
  if(token){
   const au=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:"Bearer "+token}}});
   const {data:u}=await au.auth.getUser();
   if(u?.user){const {data}=await au.rpc("is_active_staff");staff=!!data; if(staff) staffUid=u.user.id;}
  }
  const background=["fetch_new","sync_order_statuses","backfill_supply_ids","discover_missing_orders","recheck_pending_kiz"];
  const cronHeader=req.headers.get("x-wms-cron-token");
  const cronToken=Deno.env.get("WMS_WB_CRON_TOKEN");
  const internal=Boolean(service && token===service || cronHeader && (
   cronToken ? cronHeader===cronToken :
   (await sb.rpc("check_wb_cron_token",{p_token:cronHeader})).data===true
  ));
  if(!staff && !(internal && background.includes(action))) return json({error:"Требуется авторизация"},401);
  if(staff && action!=="restore_fbs"){
   const au=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:"Bearer "+token}}});
   const {data:allowed}=await au.rpc("has_permission",{permission_name:"fbs"});
   if(allowed!==true) return json({error:"Нет доступа к FBS"},403);
  }
  const {data:client,error:ce}=await sb.from("clients").select("id,name,wb_key,wb_warehouse_id,wb_warehouse_ids").eq("id",clientId).maybeSingle();
  if(ce||!client) return json({error:"Клиент не найден"},404);
  const wbKey=sellerToken(client.wb_key);
  if(!wbKey) return json({error:"У клиента не сохранён API-ключ Wildberries"},400);
  const headers={Authorization:wbKey,"Content-Type":"application/json"};
  const wb=async(path:string,method="GET",body?:unknown)=>{
   const r=await fetch(marketplace()+path,{method,headers, ...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!r.ok) throw new Error("WB "+r.status+": "+await errText(r));
   if(r.status===204) return {};
   const t=await r.text(); return t?JSON.parse(t):{};
  };
  const getOrder=async(id:number|string)=>{
   const {data,error}=await sb.from("wb_orders").select("*").eq("client_id",clientId).eq("order_id",id).maybeSingle();
   if(error||!data) throw new Error("Заказ не найден в wb_orders: "+id); return data;
  };
  const configuredWarehouseIds=(Array.isArray(client.wb_warehouse_ids)?client.wb_warehouse_ids:[]).map((x:any)=>String(x)).filter(Boolean);
  if(!configuredWarehouseIds.length && client.wb_warehouse_id) configuredWarehouseIds.push(String(client.wb_warehouse_id));
  const allowedWarehouseIds=new Set(configuredWarehouseIds);
  let skippedWrongWarehouse=0;
  const upsertOrders=async(orders:any[])=>{
   if(!orders.length)return 0;
   if(!allowedWarehouseIds.size) throw new Error("Не настроены разрешённые склады WB клиента — загрузка заказов остановлена");
   const accepted=orders.filter(o=>{const wid=String(o.warehouseId??"");return !!wid&&allowedWarehouseIds.has(wid);});
   skippedWrongWarehouse+=orders.length-accepted.length;
   if(!accepted.length)return 0;
   const rows=accepted.map(o=>({
    order_id:Number(o.id??o.orderId),client_id:clientId,client_name:client.name,
    nm_id:o.nmId??null,chrt_id:o.chrtId??null,article:o.article??String(o.nmId??""),
    barcode:(o.skus||[])[0]??o.barcode??null,name:o.name??null,size:o.techSize??o.size??null,
    price:o.price??null,supplier_status:o.supplierStatus??"new",wb_status:o.wbStatus??null,
    wb_warehouse_id:String(o.warehouseId),wb_supply_id:o.supplyId??null,
    is_b2b:typeof o.options?.isB2B==="boolean"?o.options.isB2B:null,
    order_created_at:o.createdAt??null,rid:o.rid??null,requires_kiz:Array.isArray(o.requiredMeta)&&o.requiredMeta.includes("sgtin")?true:null
   }));
   const {data:insertedRows,error}=await sb.from("wb_orders").upsert(rows,{onConflict:"order_id",ignoreDuplicates:true}).select("order_id");
   if(error) throw new Error("Запись заказов: "+error.message);
   for(const row of rows){if(row.is_b2b===null)continue; const {error:be}=await sb.from("wb_orders").update({is_b2b:row.is_b2b}).eq("client_id",clientId).eq("order_id",row.order_id).is("is_b2b",null); if(be)throw new Error("Запись B2B: "+be.message);}
   const marked=rows.filter(row=>row.requires_kiz===true).map(row=>row.order_id);
   for(let offset=0;offset<marked.length;offset+=200){
    const {error:markError}=await sb.from("wb_orders").update({requires_kiz:true})
     .eq("client_id",clientId).in("order_id",marked.slice(offset,offset+200)).not("requires_kiz","is",true);
    if(markError) throw new Error("Запись требований КИЗ: "+markError.message);
   }
   return insertedRows?.length??0;
  };
  const meta=async(id:number)=>await wb("/api/marketplace/v3/orders/meta","POST",{orders:[id]});
  const requiresKiz=(item:any)=>{
   const sgtin=(item.meta||item).sgtin;
   if(Array.isArray(item.metaDetails) && item.metaDetails.some((entry:any)=>entry?.key==="sgtin" && entry.decision==="required")) return true;
   return sgtin?.required===true || sgtin?.status==="required" || item.isKizRequired===true ||
    (Array.isArray(item.requiredMeta) && item.requiredMeta.includes("sgtin"));
  };
  const updateOrder=async(id:number,patch:any)=>{const {error}=await sb.from("wb_orders").update(patch).eq("client_id",clientId).eq("order_id",id);if(error)throw error;};
  const getSupply=async(id:string)=>await wb("/api/v3/supplies/"+encodeURIComponent(id));
  const openSupply=async(purpose="main",warehouseId="")=>{
   const {data}=await sb.from("wb_supplies").select("id").eq("client_id",clientId).eq("status","open").eq("purpose",purpose).order("created_at",{ascending:false}).limit(20);
   for(const x of data||[]){try{
    const info=await getSupply(x.id);if(info?.done!==false)continue;
    const od=await wb("/api/marketplace/v3/supplies/"+encodeURIComponent(x.id)+"/order-ids");
    const ids=od.orders||od.orderIds||[];
    if(!ids.length)return x.id;
    const {data:attached,error}=await sb.from("wb_orders").select("order_id,wb_warehouse_id").eq("client_id",clientId).in("order_id",ids);
    if(!error&&attached&&attached.length===ids.length&&(!warehouseId||attached.every((z:any)=>String(z.wb_warehouse_id||"")===String(warehouseId))))return x.id;
   }catch{}}
   const {data:supplyName,error:nameError}=await sb.rpc("next_wb_supply_name",{p_client_id:clientId});
   if(nameError||!supplyName) throw new Error("Не удалось назначить номер поставки WB");
   const made=await wb("/api/v3/supplies","POST",{name:supplyName});
   if(!made?.id) throw new Error("WB не вернул ID новой поставки");
   const {error}=await sb.from("wb_supplies").insert({id:made.id,client_id:clientId,client_name:client.name,status:"open",purpose});
   if(error)throw new Error("Поставка создана в WB, но не записана в базе: "+error.message);
   return String(made.id);
  };
  const pushChangedStock=async(before:any)=>{
    const after=await sb.rpc("get_available_stock",{p_client_name:client.name});
    let changedBarcodes:string[]|undefined;
    if(before&&!before.error&&!after.error){
      const prev=new Map((before.data||[]).map((r:any)=>[String(r.barcode),Number(r.wb_available)]));
      changedBarcodes=(after.data||[]).filter((r:any)=>prev.get(String(r.barcode))!==Number(r.wb_available)).map((r:any)=>String(r.barcode));
    }
    if(changedBarcodes?.length===0)return null;
    try{
      const r=await fetch(url+"/functions/v1/wb-sync-stocks-ts",{method:"POST",headers:{Authorization:"Bearer "+service,apikey:service,"Content-Type":"application/json"},body:JSON.stringify({clientId,action:"push_stocks",changedBarcodes})});
      const result=await r.json();if(!r.ok||result.ok===false||result.error)throw new Error(String(result.error||r.status));return null;
    }catch(e){const msg=String(e).slice(0,500);await sb.from("clients").update({wb_last_sync_error:msg}).eq("id",clientId);return msg;}
  };
  switch(action){
   case "fetch_new":{
    const d=await wb("/api/v3/orders/new");const arr=d.orders||[];
    const before=arr.length?await sb.rpc("get_available_stock",{p_client_name:client.name}):null;
    const n=await upsertOrders(arr);
    let changedBarcodes:string[]|undefined;
    if(n>0&&before&&!before.error){
      const after=await sb.rpc("get_available_stock",{p_client_name:client.name});
      if(!after.error){
        const prev=new Map((before.data||[]).map((r:any)=>[String(r.barcode),Number(r.wb_available)]));
        changedBarcodes=(after.data||[]).filter((r:any)=>prev.get(String(r.barcode))!==Number(r.wb_available)).map((r:any)=>String(r.barcode));
      }
    }
    let stockSyncError:null|string=null;
    if(n>0&&(changedBarcodes===undefined||changedBarcodes.length>0)){try{const r=await fetch(url+"/functions/v1/wb-sync-stocks-ts",{method:"POST",headers:{Authorization:"Bearer "+service,apikey:service,"Content-Type":"application/json"},body:JSON.stringify({clientId,action:"push_stocks",changedBarcodes})});const result=await r.json();if(!r.ok||result.ok===false||result.error)throw new Error(String(result.error||r.status));}catch(e){stockSyncError=String(e).slice(0,500);}}

    await sb.from("clients").update({wb_last_synced_at:new Date().toISOString(),wb_last_sync_error:stockSyncError}).eq("id",clientId);
    return json({ok:true,fetched:n,changedBarcodes,stockSyncError,skippedWrongWarehouse,allowedWarehouseIds:configuredWarehouseIds});
   }
   case "sync_order_statuses":{
    const {data:rows}=await sb.from("wb_orders").select("order_id,supplier_status,wb_status").eq("client_id",clientId).not("supplier_status","in",'("cancel","complete")').limit(1000);
    const before=await sb.rpc("get_available_stock",{p_client_name:client.name});
    const changed:any[]=[];let total=0;let released=false;
    for(let i=0;i<(rows||[]).length;i+=1000){
     const ids=(rows||[]).slice(i,i+1000).map(x=>Number(x.order_id));if(!ids.length)continue;
     const d=await wb("/api/v3/orders/status","POST",{orders:ids});const list=d.orders||[];total+=ids.length;
     for(const st of list){const old=(rows||[]).find(x=>Number(x.order_id)===Number(st.id));if(!old)continue;
      if(old.supplier_status!==st.supplierStatus||old.wb_status!==st.wbStatus){if(old.supplier_status==="new"&&(st.supplierStatus==="cancel"||["canceled","canceled_by_client","declined_by_client"].includes(st.wbStatus)))released=true;await updateOrder(st.id,{supplier_status:st.supplierStatus,wb_status:st.wbStatus});changed.push({orderId:st.id,supplierStatus:st.supplierStatus,wbStatus:st.wbStatus});}
     }
    }
    const stockSyncError=released?await pushChangedStock(before):null;
    return json({ok:true,total,changed,stockSyncError});
   }
   case "restore_fbs":{
    if(!staffUid) return json({error:"Требуется авторизация"},401);
    const {data:emp,error:ee}=await sb.from("employees").select("id,name,role_id,warehouse_id").eq("auth_user_id",staffUid).eq("active",true).single();
    if(ee||!emp) return json({error:"Сотрудник не найден"},403);
    const {data:role}=await sb.from("roles").select("permissions").eq("id",emp.role_id).single();
    if(!role?.permissions?.returns) return json({error:"Нет доступа к возвратам"},403);
    const id=Number(b.orderId), warehouse=String(b.warehouse||"MAIN");
    if(!Number.isSafeInteger(id)||id<=0||typeof b.sku!=="string"||!Number.isSafeInteger(b.qty)||b.qty<1) return json({error:"Некорректные параметры"},400);
    if(emp.warehouse_id&&emp.warehouse_id!==warehouse&&!role.permissions.employees) return json({error:"Нет доступа к складу"},403);
    const {data:tracked,error:te}=await sb.from("wb_fbs_stock_operations").select("order_id,client_id").eq("order_id",id).maybeSingle();
    if(te) throw te;
    if(!tracked){
     const {data:legacy,error}=await sb.from("wb_orders").select("client_id,supplier_status,wb_status").eq("order_id",id).maybeSingle();
     if(error) throw error;
     if(legacy?.client_id!==clientId && legacy) return json({error:"Заказ принадлежит другому клиенту"},409);
     if(legacy && !["cancel","complete"].includes(legacy.supplier_status) &&
       !["canceled","canceled_by_client","declined_by_client","defect"].includes(legacy.wb_status))
       return json({error:"Заказ ещё активен"},409);
     return json({ok:true,tracked:false});
    }
    if(tracked.client_id!==clientId) return json({error:"Заказ принадлежит другому клиенту"},409);
    if(b.qty!==1) return json({error:"Для заказа WB требуется количество 1"},409);
    const before=await sb.rpc("get_available_stock",{p_client_name:client.name});
    const {data,error}=await sb.rpc("wb_fbs_restore",{p_order_id:id,p_client_id:clientId,p_sku:b.sku,p_size:String(b.size??""),p_warehouse:warehouse,p_resolution:b.resolution,p_reason:String(b.reason??""),p_employee_id:emp.id,p_employee_name:emp.name});
    if(error) return json({error:error.message},409);
    const stockSyncError=data?.applied&&b.resolution==="restock"?await pushChangedStock(before):null;
    return json({ok:true,...data,stockSyncError});
   }
   case "deduct_fbs":{
    if(!staffUid) return json({error:"Требуется авторизация"},401);
    const {data:emp,error:ee}=await sb.from("employees").select("id,name,role_id,warehouse_id").eq("auth_user_id",staffUid).eq("active",true).single();
    if(ee||!emp) return json({error:"Сотрудник не найден"},403);
    const {data:role}=await sb.from("roles").select("permissions").eq("id",emp.role_id).single();
    if(!role?.permissions?.fbs) return json({error:"Нет доступа к FBS"},403);
    const id=Number(b.orderId), warehouse=String(b.warehouse||"MAIN");
    if(!Number.isSafeInteger(id)||id<=0||typeof b.sku!=="string") return json({error:"Некорректные параметры"},400);
    if(emp.warehouse_id && emp.warehouse_id!==warehouse && !role.permissions.employees) return json({error:"Нет доступа к складу"},403);
    const o=await getOrder(id);
    if(["canceled","canceled_by_client","declined_by_client"].includes(o.wb_status)) return json({error:"Заказ отменён покупателем"},409);
    if(o.requires_kiz!==true){
     const {data:product,error:productError}=await sb.from("inventory").select("requires_kiz")
      .eq("client_name",client.name).eq("sku",b.sku).eq("size",String(b.size??""))
      .eq("warehouse_id",warehouse).maybeSingle();
     if(productError) throw productError;
     if(product?.requires_kiz===true){
      await updateOrder(id,{requires_kiz:true});
      o.requires_kiz=true;
     }
    }
    const {data,error}=await sb.rpc("wb_fbs_deduct",{p_order_id:id,p_client_id:clientId,p_sku:b.sku,p_size:String(b.size??""),p_warehouse:warehouse,p_employee_id:emp.id,p_employee_name:emp.name});
    if(error) return json({error:error.message},409);
    return json({ok:true,...data});
   }
   case "assemble":
   case "add_order":{
    const id=Number(b.orderId);if(!id)throw new Error("orderId обязателен");
    const o=await getOrder(id);
    if(["cancel","complete"].includes(o.supplier_status) ||
       ["canceled","canceled_by_client","declined_by_client"].includes(o.wb_status)) throw new Error("Заказ закрыт");
    const {data:op,error:opError}=await sb.from("wb_fbs_stock_operations").select("state,items").eq("client_id",clientId).eq("order_id",id).maybeSingle();
    if(opError) throw opError;
    if(o.supplier_status==="new" && op?.state!=="deducted") return json({error:"Сначала подтвердите списание"},409);
    if(op?.state==="restored") return json({error:"Заказ уже возвращён"},409);
    if(op?.items?.[0]?.warehouse){
     const employee=await sb.from("employees").select("warehouse_id,role_id").eq("auth_user_id",staffUid).eq("active",true).single();
     if(employee.error) throw employee.error;
     if(employee.data.warehouse_id && employee.data.warehouse_id!==op.items[0].warehouse){
      const role=await sb.from("roles").select("permissions").eq("id",employee.data.role_id).single();
      if(!role.data?.permissions?.employees) return json({error:"Нет доступа к складу"},403);
     }
    }
    if(o.supplier_status==="confirm" && o.wb_supply_id){
     const k=b.kizCode && o.kiz_status!=="attached" ? await attachKiz(id,String(b.kizCode)) : null;
     return json({ok:true,wbSupplyId:o.wb_supply_id,kizStatus:k?.kizStatus||o.kiz_status,warning:k?.warning});
    }
    let supply=o.wb_supply_id;
    if(!supply){supply=await openSupply("main",String(o.wb_warehouse_id||client.wb_warehouse_id||""));}
    try{await wb("/api/marketplace/v3/supplies/"+encodeURIComponent(supply)+"/orders","PATCH",{orders:[id]});}
    catch(e){throw new Error("Не удалось добавить заказ в поставку "+supply+": "+String(e));}
    const {data:confirmed,error:confirmError}=await sb.from("wb_orders")
      .update({supplier_status:"confirm",wb_supply_id:supply})
      .eq("client_id",clientId).eq("order_id",id).eq("supplier_status",o.supplier_status)
      .select("order_id").maybeSingle();
    if(confirmError) throw confirmError;
    if(!confirmed){
     const latest=await getOrder(id);
     if(latest.supplier_status!=="confirm" || latest.wb_supply_id!==supply)
      return json({error:"Статус заказа изменился во время сборки — сверьте его с WB"},409);
    }
    let kizStatus=null,warning=null;
    if(b.kizCode){
     try{const k=await attachKiz(id,String(b.kizCode));kizStatus=k.kizStatus;warning=k.warning;}
     catch(e){kizStatus="verify_failed";warning=String(e);}
    }
    return json({ok:true,wbSupplyId:supply,kizStatus,warning});
   }
   case "attach_kiz":{
    const out=await attachKiz(Number(b.orderId),String(b.kizCode||""));return json(out);
   }
   case "check_meta":{
    const id=Number(b.orderId);
    const order=await getOrder(id);
    const d=await meta(id);
    const item=(d.orders||[]).find((x:any)=>Number(x.orderId??x.id)===id);
    if(!item) return json({error:"WB не подтвердил требования маркировки заказа"},502);
    const required=order.requires_kiz===true || requiresKiz(item);
    await updateOrder(id,{requires_kiz:required});
    return json({ok:true,requiresKiz:required,meta:item.meta||item});
   }
   case "get_sticker":{
    const ids=(b.orderIds||[b.orderId]).filter(Boolean).map(Number);
    if(!ids.length)throw new Error("orderIds обязателен");
    const d=await wb("/api/v3/orders/stickers?type=svg&width=58&height=40","POST",{orders:ids});
    return json({ok:true,stickers:d.stickers||[]});
   }
   case "get_supply_barcode":{
    if(!b.wbSupplyId)throw new Error("wbSupplyId обязателен");
    const d=await wb("/api/v3/supplies/"+encodeURIComponent(b.wbSupplyId)+"/barcode?type=svg");
    return json(d);
   }
   case "cancel":{
    const id=Number(b.orderId);
    const old=await getOrder(id);
    const {data:op,error:operationError}=await sb.from("wb_fbs_stock_operations")
      .select("state,product,items").eq("order_id",id).eq("client_id",clientId).maybeSingle();
    if(operationError) throw operationError;
    const warehouse=op?.items?.[0]?.warehouse;
    let employee:any=null;
    if(warehouse){
     const result=await sb.from("employees").select("id,name,role_id,warehouse_id").eq("auth_user_id",staffUid).eq("active",true).single();
     if(result.error) throw result.error;
     employee=result.data;
     if(employee.warehouse_id && employee.warehouse_id!==warehouse){
      const role=await sb.from("roles").select("permissions").eq("id",employee.role_id).single();
      if(!role.data?.permissions?.employees) return json({error:"Нет доступа к складу"},403);
     }
    }
    const shouldRestore=old.supplier_status==="confirm" && !old.out_of_stock && op?.state==="deducted" && op?.product;
    const before=old.supplier_status==="new" || shouldRestore
      ? await sb.rpc("get_available_stock",{p_client_name:client.name}):null;
    if(old.supplier_status!=="cancel"){
     await wb("/api/v3/orders/"+id+"/cancel","PATCH");
     await updateOrder(id,{supplier_status:"cancel"});
    }
    let restored=false, restoreError=null;
    if(shouldRestore && employee){
     const result=await sb.rpc("wb_fbs_restore",{
      p_order_id:id,p_client_id:clientId,p_sku:op.product.sku,p_size:op.product.size,p_warehouse:warehouse,
      p_resolution:"restock",p_reason:"Отмена собранного заказа WB",p_employee_id:employee.id,p_employee_name:employee.name
     });
     restoreError=result.error?.message||null;
     restored=result.data?.tracked===true;
    }
    const stockSyncError=before?await pushChangedStock(before):null;
    return json({ok:true,restored,restoreError,stockSyncError});
   }
   case "move_to_holding_supply":{
    const id=Number(b.orderId);const o=await getOrder(id);
    const holding=await openSupply("b2b",String(o.wb_warehouse_id||client.wb_warehouse_id||""));
    await wb("/api/marketplace/v3/supplies/"+encodeURIComponent(holding)+"/orders","PATCH",{orders:[id]});
    await updateOrder(id,{wb_supply_id:holding});
    return json({ok:true,holdingSupplyId:holding});
   }
   case "backfill_supply_ids":{
    const {data:orphans}=await sb.from("wb_orders").select("order_id").eq("client_id",clientId).is("wb_supply_id",null).limit(1000);
    const {data:sups}=await sb.from("wb_supplies").select("id").eq("client_id",clientId);
    let matched=0;
    for(const s of sups||[]){try{const d=await wb("/api/marketplace/v3/supplies/"+encodeURIComponent(s.id)+"/order-ids");for(const id of d.orders||d.orderIds||[]){if((orphans||[]).some(x=>Number(x.order_id)===Number(id))){await updateOrder(Number(id),{wb_supply_id:s.id});matched++;}}}catch{}}
    return json({ok:true,orphans:(orphans||[]).length,matched});
   }
   case "discover_missing_orders":{
    if(!allowedWarehouseIds.size) return json({error:"Не настроены разрешённые склады WB клиента"},400);
    const dateTo=Math.floor(Date.now()/1000);
    const dateFrom=dateTo-30*86400+1;
    const eligible=new Map<number,any>();
    let next=0,found=0;
    for(let page=0;page<10;page++){
     const params=new URLSearchParams({limit:"1000",next:String(next),dateFrom:String(dateFrom),dateTo:String(dateTo)});
     const response=await wb("/api/v3/orders?"+params);
     const rows=response.orders||[];
     found+=rows.length;
     for(const order of rows){
      const id=Number(order.id??order.orderId);
      if(Number.isSafeInteger(id)&&id>0&&allowedWarehouseIds.has(String(order.warehouseId??""))) eligible.set(id,order);
     }
     if(!rows.length||!response.next||response.next===next) break;
     next=response.next;
    }
    const ids=Array.from(eligible.keys());
    const missing:number[]=[];
    for(let offset=0;offset<ids.length;offset+=200){
     const batch=ids.slice(offset,offset+200);
     const {data:existing,error}=await sb.from("wb_orders").select("order_id").eq("client_id",clientId).in("order_id",batch);
     if(error) throw error;
     const have=new Set((existing||[]).map(row=>Number(row.order_id)));
     missing.push(...batch.filter(id=>!have.has(id)));
    }
    const recovered=[];
    for(let offset=0;offset<missing.length;offset+=200){
     const batch=missing.slice(offset,offset+200);
     const response=await wb("/api/v3/orders/status","POST",{orders:batch});
     const statuses=new Map((response.orders||[]).map((status:any)=>[Number(status.id),status]));
     for(const id of batch){
      const status:any=statuses.get(id);
      if(typeof status?.supplierStatus!=="string"||typeof status.wbStatus!=="string") continue;
      recovered.push({...eligible.get(id),supplierStatus:status.supplierStatus,wbStatus:status.wbStatus});
     }
    }
    let inserted=0;
    for(let offset=0;offset<recovered.length;offset+=200){
     inserted+=await upsertOrders(recovered.slice(offset,offset+200));
    }
    return json({ok:true,found,missingCount:missing.length,inserted,skippedWithoutStatus:missing.length-recovered.length});
   }
   case "recheck_pending_kiz":{
    const {data:rows,error:readError}=await sb.from("wb_orders").select("order_id,kiz_code")
     .eq("client_id",clientId).eq("kiz_status","pending").order("kiz_updated_at",{ascending:true,nullsFirst:true}).limit(100);
    if(readError) throw readError;
    if(!rows?.length) return json({ok:true,checked:0});
    const response=await wb("/api/marketplace/v3/orders/meta","POST",{orders:rows.map(o=>Number(o.order_id))});
    const byId=new Map((response.orders||[]).map((item:any)=>[String(item.id??item.orderId),item]));
    let checked=0;
    for(const o of rows){
     const item=byId.get(String(o.order_id));
     if(!item) continue;
     const verdict=kizVerdict(item);
     const query=sb.from("wb_orders").update({kiz_status:verdict.status,kiz_decision:verdict.decision,kiz_updated_at:new Date().toISOString()})
      .eq("client_id",clientId).eq("order_id",o.order_id).eq("kiz_status","pending");
     const {error}=await (o.kiz_code==null ? query.is("kiz_code",null) : query.eq("kiz_code",o.kiz_code));
     if(error) throw error;
     checked++;
    }
    return json({ok:true,checked});
   }
   case "cancel_reasons": return json({reasons:[]});
   case "ship": throw new Error("Действие ship не относится к FBS WB: отгрузка поставки выполняется через wb-supply-ts");
   default:return json({error:"Неизвестное действие: "+action},400);
  }
  async function attachKiz(id:number,kiz:string){
   if(!id||!kiz.trim())throw new Error("orderId и kizCode обязательны");
   const o=await getOrder(id);
   if(o.supplier_status!=="confirm")throw new Error("Сначала добавьте заказ в поставку (статус confirm)");
   await wb("/api/v3/orders/"+id+"/meta/sgtin","PUT",{sgtins:[kiz]});
   let status="pending",decision=null,warning=null;
   try{
    const d=await meta(id);
    const item=(d.orders||[]).find((row:any)=>Number(row.id??row.orderId)===id);
    if(item) ({status,decision}=kizVerdict(item));
   }catch(e){warning="WB пока не вернул решение по маркировке";}
   await updateOrder(id,{kiz_code:kiz,kiz_status:status,kiz_decision:decision,kiz_updated_at:new Date().toISOString(),requires_kiz:true});
   return {ok:true,kizStatus:status,decision,warning};
  }
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500);}
});