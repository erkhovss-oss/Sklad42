// ТелеПак — отдельная поставка для заказов юридических лиц (B2B) Wildberries
// Вызывать может только вошедший сотрудник.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const liveProject = () => new URL(Deno.env.get('SUPABASE_URL')!).hostname === 'mixsvqjlrifkcoeuuydc.supabase.co';
const marketplace = () => liveProject()
  ? 'https://marketplace-api.wildberries.ru'
  : 'https://marketplace-api-sandbox.wildberries.ru';
const sellerToken = (stored: string | null) => liveProject()
  ? stored : Deno.env.get('WMS_WB_TEST_TOKEN');

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
    if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
    try {
      const body = await req.json();
      const { clientId, action, orderId } = body;
      if (!clientId) return json({ error: 'clientId обязателен' }, 400);
      const url = Deno.env.get('SUPABASE_URL')!;
      const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer /i, '');
      const { data: userData, error: userErr } = await sb.auth.getUser(token);
      if (userErr || !userData?.user) return json({ error: 'Нужен вход в систему' }, 401);
      const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: allowed } = await userClient.rpc('has_permission', { permission_name: 'fbs' });
      if (allowed !== true) return json({ error: 'Нет доступа' }, 403);
      const { data: client, error: clientErr } = await sb.from('clients').select('*').eq('id', clientId).single();
      if (clientErr || !client) return json({ error: 'Клиент не найден' }, 404);
      const wbKey = sellerToken(client.wb_key);
      if (!wbKey) return json({ error: 'У клиента не сохранён API-ключ Wildberries' }, 400);
      const headers = { Authorization: wbKey, 'Content-Type': 'application/json' };
      if (action !== 'add_order') return json({ error: 'Неизвестное действие: ' + action }, 400);
      if (!orderId) return json({ error: 'orderId обязателен' }, 400);

      const { data: orderRow, error: orderRowErr } = await sb.from('wb_orders')
        .select('wb_warehouse_id, supplier_status, wb_status, wb_supply_id').eq('order_id', orderId).eq('client_id', clientId).maybeSingle();
      if (orderRowErr || !orderRow?.wb_warehouse_id) return json({ error: 'Не удалось определить склад заказа WB' }, 400);
      if (!['new', 'confirm'].includes(orderRow.supplier_status) ||
          ['canceled', 'canceled_by_client', 'declined_by_client'].includes(orderRow.wb_status)) {
        return json({ error: 'Заказ закрыт' }, 409);
      }
      const { data: operation, error: operationError } = await sb.from('wb_fbs_stock_operations')
        .select('state, items').eq('order_id', orderId).eq('client_id', clientId).maybeSingle();
      if (operationError) throw operationError;
      const stockWarehouse = operation?.items?.[0]?.warehouse;
      if (operation?.state !== 'deducted' || !stockWarehouse) {
        return json({ error: 'Нет подтверждённого списания' }, 409);
      }
      const { data: employee, error: employeeError } = await userClient.rpc('current_employee');
      if (employeeError || !employee?.id) return json({ error: 'Сотрудник не найден' }, 403);
      if (employee.warehouse_id && employee.warehouse_id !== stockWarehouse) {
        const { data: canManage } = await userClient.rpc('has_permission', { permission_name: 'employees' });
        if (canManage !== true) return json({ error: 'Нет доступа к складу' }, 403);
      }
      if (orderRow.supplier_status === 'confirm' && orderRow.wb_supply_id) {
        return json({ ok: true, wbSupplyId: orderRow.wb_supply_id, created: false });
      }
      const warehouseId = String(orderRow.wb_warehouse_id);

      // Reuse only an open B2B supply whose existing orders all belong to this same warehouse.
      let supplyId: string | null = null;
      let created = false;
      const { data: rows } = await sb.from('wb_supplies').select('*')
        .eq('client_id', clientId).eq('status', 'open').eq('purpose', 'b2b')
        .order('created_at', { ascending: false });
      for (const row of rows || []) {
        try {
          const infoResp = await fetch(`${marketplace()}/api/v3/supplies/${row.id}`, { headers });
          if (infoResp.status === 404) {
            await sb.from('wb_supplies').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', row.id);
            continue;
          }
          if (!infoResp.ok) continue;
          const info = await infoResp.json();
          if (!info || info.done !== false || info.isB2b === false || info.isB2B === false) continue;
          const idsResp = await fetch(`${marketplace()}/api/marketplace/v3/supplies/${row.id}/order-ids`, { headers });
          if (!idsResp.ok) continue;
          const idsData = await idsResp.json();
          const ids: number[] = idsData.orders || idsData.orderIds || [];
          if (!ids.length) { supplyId = row.id; break; }
          const { data: attached, error: attachedErr } = await sb.from('wb_orders')
            .select('order_id, wb_warehouse_id').eq('client_id', clientId).in('order_id', ids);
          if (!attachedErr && attached && attached.length === ids.length &&
              attached.every((o: any) => String(o.wb_warehouse_id || '') === warehouseId)) {
            supplyId = row.id; break;
          }
        } catch (_e) { /* skip unverifiable supply */ }
      }
      if (!supplyId) {
        const cr = await fetch(`${marketplace()}/api/v3/supplies`, {
          method: 'POST', headers,
          body: JSON.stringify({ name: 'Юрлица — ' + new Date().toISOString().slice(0, 10) }),
        });
        const ct = await cr.text();
        if (!cr.ok) return json({ error: `WB (создание поставки для юрлиц): ${cr.status} ${ct.slice(0, 300)}` }, 502);
        const made = JSON.parse(ct);
        const { error: insErr } = await sb.from('wb_supplies')
          .insert({ id: made.id, client_id: clientId, client_name: client.name, status: 'open', purpose: 'b2b' });
        if (insErr) return json({ error: 'Не удалось сохранить поставку для юрлиц в базе' }, 500);
        supplyId = made.id;
        created = true;
      }
      const addResp = await fetch(`${marketplace()}/api/marketplace/v3/supplies/${supplyId}/orders`, {
        method: 'PATCH', headers, body: JSON.stringify({ orders: [Number(orderId)] }),
      });
      if (!addResp.ok) {
        const t = await addResp.text();
        if (created && addResp.status >= 400 && addResp.status < 500 && ![408, 429].includes(addResp.status)) {
          await fetch(`${marketplace()}/api/v3/supplies/${supplyId}`, { method: 'DELETE', headers }).catch(() => {});
          await sb.from('wb_supplies').delete().eq('id', supplyId);
        }
        return json({ error: `WB (добавление в поставку для юрлиц): ${addResp.status} ${t.slice(0, 300)}` }, 502);
      }
      const { data: confirmed, error: confirmationError } = await sb.from('wb_orders')
        .update({ supplier_status: 'confirm', wb_supply_id: supplyId })
        .eq('client_id', clientId).eq('order_id', orderId).eq('supplier_status', orderRow.supplier_status)
        .select('order_id').maybeSingle();
      if (confirmationError) throw confirmationError;
      if (!confirmed) return json({ error: 'Статус заказа изменился во время сборки — сверьте его с WB' }, 409);
      return json({ ok: true, wbSupplyId: supplyId, created });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
