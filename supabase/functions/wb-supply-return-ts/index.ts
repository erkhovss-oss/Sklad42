// ТелеПак — перенос заказов в основную (открытую) поставку клиента.
// Без orderIds: возвращает все заказы из отложенной поставки. С orderIds: переносит именно эти заказы.
// Вызывать может только вошедший сотрудник.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}


export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      const { clientId, orderIds, targetSupplyId, createHolding, action } = await req.json();
      if (!clientId) return json({ error: 'clientId обязателен' }, 400);

      const url = Deno.env.get('SUPABASE_URL')!;
      const live = new URL(url).hostname === 'mixsvqjlrifkcoeuuydc.supabase.co';
      const WB = live ? 'https://marketplace-api.wildberries.ru' : 'https://marketplace-api-sandbox.wildberries.ru';
      const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
      const { data: userData, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userData || !userData.user) return json({ error: 'Нужен вход в систему' }, 401);
      const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: isStaff } = await userClient.rpc('is_active_staff');
      if (!isStaff) return json({ error: 'Нет доступа' }, 403);

      const { data: client } = await sb.from('clients').select('id, name, wb_key').eq('id', clientId).single();
      const wbKey = live ? client?.wb_key : Deno.env.get('WMS_WB_TEST_TOKEN');
      if (!client || !wbKey) return json({ error: 'У клиента не сохранён API-ключ Wildberries' }, 400);
      const headers = { Authorization: wbKey, 'Content-Type': 'application/json' };

      if (action === 'list_targets') {
        const {data,error}=await sb.from('wb_supplies').select('id,purpose,created_at').eq('client_id',clientId).eq('status','open').order('created_at',{ascending:false});
        if(error) return json({error:error.message},500);
        return json({supplies:data||[]});
      }
      if (targetSupplyId || createHolding) {
        if (!Array.isArray(orderIds) || !orderIds.length || (targetSupplyId && createHolding)) return json({error:'Некорректный выбор'},400);
        const ids=[...new Set(orderIds.map(Number))] as number[];
        if(ids.some(id=>!Number.isSafeInteger(id)||id<=0)) return json({error:'Некорректный номер заказа'},400);
        const rows=[];
        for(let offset=0;offset<ids.length;offset+=100){
          const {data,error}=await sb.from('wb_orders').select('order_id,wb_supply_id,wb_warehouse_id,wb_status')
            .eq('client_id',clientId).eq('supplier_status','confirm').in('order_id',ids.slice(offset,offset+100));
          if(error) return json({error:'Не удалось прочитать заказы из базы'},500);
          rows.push(...(data||[]));
        }
        if(rows.length!==ids.length || rows.some(r=>!r.wb_warehouse_id || ['canceled','canceled_by_client','declined_by_client'].includes(r.wb_status))) return json({error:'Заказы недоступны для переноса'},400);
        if(new Set(rows.map(r=>r.wb_warehouse_id)).size!==1) return json({error:'Выберите заказы одного склада'},400);
        let target=targetSupplyId;
        if(createHolding){
          const {data:supplyName,error:nameError}=await sb.rpc('next_wb_supply_name',{p_client_id:clientId});
          if(nameError||!supplyName) return json({error:'Не удалось назначить номер поставки WB'},500);
          const cr=await fetch(WB+'/api/v3/supplies',{method:'POST',headers,body:JSON.stringify({name:supplyName})});
          if(!cr.ok) return json({error:'WB: '+cr.status+' '+(await cr.text()).slice(0,300)},502);
          target=(await cr.json()).id;
          if(!target) return json({error:'WB не вернул номер новой поставки'},502);
          const {error}=await sb.from('wb_supplies').insert({id:target,client_id:clientId,client_name:client.name,status:'open',purpose:'holding'});
          if(error) return json({error:'Поставка создана в WB, но не сохранена: '+target},500);
        } else {
          const {data:t,error}=await sb.from('wb_supplies').select('id').eq('id',target).eq('client_id',clientId).eq('status','open').maybeSingle();
          if(error||!t) return json({error:'Поставка недоступна'},400);
          const info=await fetch(WB+'/api/v3/supplies/'+encodeURIComponent(target),{headers});
          if(!info.ok || (await info.json()).done!==false) return json({error:'WB: поставка не открыта или недоступна'},400);
        }
        const waiting=rows.filter(row=>row.wb_supply_id!==target).map(row=>Number(row.order_id));
        let moved=ids.length-waiting.length;
        const failed: {id:number; error:string}[]=[];
        const base=WB+'/api/marketplace/v3/supplies/'+encodeURIComponent(target);
        const saveMoved=async(batch:number[])=>{
          if(!batch.length) return;
          const {data,error}=await sb.from('wb_orders').update({wb_supply_id:target})
            .eq('client_id',clientId).eq('supplier_status','confirm').in('order_id',batch).select('order_id');
          const saved=new Set((data||[]).map(row=>Number(row.order_id)));
          for(const id of batch){
            if(!error && saved.has(id)) moved++;
            else failed.push({id,error:'WB принял перенос, но WMS не сохранила его. Обновите заказы.'});
          }
        };
        for(let offset=0;offset<waiting.length;offset+=100){
          const batch=waiting.slice(offset,offset+100);
          const response=await fetch(base+'/orders',{
            method:'PATCH',headers,body:JSON.stringify({orders:batch})
          }).catch(()=>null);
          if(response?.ok){
            await saveMoved(batch);
            continue;
          }
          // With an ambiguous response, only persist orders confirmed in the destination by WB.
          let idsAtTarget: Set<number> | undefined;
          try{
            const check=await fetch(base+'/order-ids',{headers});
            if(check.ok){
              const body=await check.json();
              const orderIds=body.orderIds??body.orders;
              if(Array.isArray(orderIds)) idsAtTarget=new Set(orderIds.map(Number));
            }
          }catch{}
          const confirmed=batch.filter(id=>idsAtTarget?.has(id));
          await saveMoved(confirmed);
          const pending=batch.filter(id=>!idsAtTarget?.has(id));
          const message=response ? 'WB вернул '+response.status : 'WB не ответил на перенос';
          for(const id of pending) failed.push({id,error:message});
          if(pending.length){
            for(const id of waiting.slice(offset+batch.length)) failed.push({id,error:'Перенос остановлен после ошибки WB'});
            break;
          }
        }
        return json({moved,total:ids.length,failed,mainSupplyId:target});
      }

      const { data: main } = await sb.from('wb_supplies').select('id').eq('client_id', clientId).eq('status', 'open').eq('purpose', 'main').limit(1).maybeSingle();
      if (!main) return json({ error: 'Нет открытой основной поставки, куда переносить' });

      let ids: number[] = [];
      let holdingId: string | null = null;
      const explicit = Array.isArray(orderIds) && orderIds.length > 0;
      if (explicit) {
        const { data: rows, error: rowsErr } = await sb.from('wb_orders').select('order_id, wb_supply_id').eq('client_id', clientId).eq('supplier_status', 'confirm').in('order_id', orderIds.map((x: any) => Number(x)));
        if (rowsErr) return json({ error: 'Не удалось прочитать заказы из базы' }, 500);
        ids = (rows || []).filter((r: any) => r.wb_supply_id !== main.id).map((r: any) => Number(r.order_id));
        if (!ids.length) return json({ moved: 0, total: 0, message: 'Выбранные заказы уже в основной поставке' });
      } else {
        const { data: holding } = await sb.from('wb_supplies').select('id').eq('client_id', clientId).eq('status', 'open').eq('purpose', 'holding').limit(1).maybeSingle();
        if (!holding) return json({ moved: 0, total: 0, message: 'Отложенной поставки нет' });
        holdingId = holding.id;
        const { data: rows, error: rowsErr } = await sb.from('wb_orders').select('order_id').eq('client_id', clientId).eq('wb_supply_id', holding.id).eq('supplier_status', 'confirm');
        if (rowsErr) return json({ error: 'Не удалось прочитать заказы из базы' }, 500);
        ids = (rows || []).map((r: any) => Number(r.order_id));
        if (!ids.length) return json({ moved: 0, total: 0, message: 'В отложенной поставке нет заказов' });
      }

      let moved = 0;
      const failed: { id: number; error: string }[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const resp = await fetch(`${WB}/api/marketplace/v3/supplies/${main.id}/orders`, {
          method: 'PATCH', headers, body: JSON.stringify({ orders: chunk }),
        });
        if (resp.ok) {
          await sb.from('wb_orders').update({ wb_supply_id: main.id }).in('order_id', chunk);
          moved += chunk.length;
        } else {
          const t = await resp.text();
          const before = failed.length;
          for (const id of chunk) {
            const r1 = await fetch(`${WB}/api/marketplace/v3/supplies/${main.id}/orders`, {
              method: 'PATCH', headers, body: JSON.stringify({ orders: [id] }),
            });
            if (r1.ok) { await sb.from('wb_orders').update({ wb_supply_id: main.id }).eq('order_id', id); moved++; }
            else failed.push({ id, error: `${r1.status} ${(await r1.text()).slice(0, 150)}` });
          }
          if (failed.length === before) failed.push({ id: 0, error: `пачка: ${resp.status} ${t.slice(0, 150)}` });
        }
      }

      let holdingRemoved = false;
      if (holdingId && moved === ids.length) {
        const del = await fetch(`${WB}/api/v3/supplies/${holdingId}`, { method: 'DELETE', headers });
        if (del.ok) {
          await sb.from('wb_supplies').update({ status: 'closed' }).eq('id', holdingId);
          holdingRemoved = true;
        }
      }
      return json({ moved, total: ids.length, failed, mainSupplyId: main.id, holdingRemoved });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
