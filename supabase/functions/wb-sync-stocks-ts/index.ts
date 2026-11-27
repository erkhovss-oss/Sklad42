// СКЛАД/42 — серверная функция синхронизации остатков с Wildberries
// Разворачивается в Supabase → Edge Functions под именем "wb-sync-stocks-ts"
//
// Что делает:
//  - action: "list_warehouses"  → запрашивает у WB список складов продавца
//  - action: "list_cards"       → карточки товаров (Content API)
//  - action: "push_stocks"      → берёт доступный остаток клиента (физический минус занятое
//                                  необработанными заказами на WB и Ozon) и отправляет в WB
//                                  Товары типа СГТ/ODC, которые WB не принимает на этот склад (409
//                                  CargoWarehouseRestrictionSGT), пропускаются, остальные отправляются.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
    try {
      const { clientId, action, changedBarcodes } = await req.json();
      if (!clientId) return json({ error: 'clientId обязателен' }, 400);

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, serviceKey);
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const cronToken = Deno.env.get('WMS_WB_CRON_TOKEN');
      const internal = Boolean(serviceKey && token === serviceKey ||
        cronToken && req.headers.get('x-wms-cron-token') === cronToken);
      const stockAction = !action || action === 'push_stocks';
      if (!stockAction || !internal) {
        if (!token) return json({ error: 'Требуется авторизация' }, 401);
        const user = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: 'Bearer ' + token } },
        });
        const { data: canManageClients } = await user.rpc('has_permission', { permission_name: 'clients' });
        const canSyncInventory = stockAction && canManageClients !== true
          ? (await user.rpc('has_permission', { permission_name: 'inventory' })).data : false;
        if (canManageClients !== true && canSyncInventory !== true) return json({ error: 'Нет доступа к настройкам клиентов' }, 403);
      }
      if (!stockAction && !['list_warehouses', 'list_cards'].includes(action)) {
        return json({ error: 'Неизвестное действие' }, 400);
      }

      const { data: client, error: clientErr } = await sb
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

      if (clientErr || !client) return json({ error: 'Клиент не найден' }, 404);
      if (!client.wb_key) return json({ error: 'У клиента не сохранён API-ключ Wildberries' }, 400);

      // ---------- список складов продавца ----------
      if (action === 'list_warehouses') {
        const resp = await fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses', {
          headers: { Authorization: client.wb_key },
        });
        const text = await resp.text();
        if (!resp.ok) return json({ error: `WB ответил ошибкой (${resp.status}): ${text}` }, 502);
        return json({ warehouses: JSON.parse(text) });
      }

      // ---------- список карточек товаров (Content API) ----------
      if (action === 'list_cards') {
        const LIMIT = 100;
        const byNmId = new Map<string, any>();
        let cursor: Record<string, unknown> = { limit: LIMIT };
        let pages = 0;
        while (pages < 40) {
          pages++;
          let resp = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
            method: 'POST',
            headers: { Authorization: client.wb_key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { cursor, filter: { withPhoto: -1 } } }),
          });
          if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, 3000));
            resp = await fetch('https://content-api.wildberries.ru/content/v2/get/cards/list', {
              method: 'POST',
              headers: { Authorization: client.wb_key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ settings: { cursor, filter: { withPhoto: -1 } } }),
            });
          }
          const text = await resp.text();
          if (!resp.ok) return json({ error: `WB ответил ошибкой (${resp.status}): ${text}`, loadedBeforeError: byNmId.size }, 502);
          const data = JSON.parse(text);
          const batch: any[] = data.cards || [];
          batch.forEach((card) => byNmId.set(String(card.nmID), card));
          const cur = data.cursor || {};
          if (batch.length < LIMIT || !cur.updatedAt || cur.nmID == null) break;
          cursor = { limit: LIMIT, updatedAt: cur.updatedAt, nmID: cur.nmID };
          await new Promise((r) => setTimeout(r, 700));
        }
        return json({ cards: Array.from(byNmId.values()), pages });
      }

      // ---------- отправка остатков (действие по умолчанию) ----------
      const warehouseIds: string[] = Array.from(new Set(
        (Array.isArray(client.wb_warehouse_ids) && client.wb_warehouse_ids.length
          ? client.wb_warehouse_ids : [client.wb_warehouse_id])
          .filter((id: any) => id != null && String(id).trim() !== '')
          .map((id: any) => String(id))
      ));
      const primaryWarehouseId = String(client.wb_warehouse_id || warehouseIds[0] || '');
      if (!warehouseIds.length || !primaryWarehouseId || !warehouseIds.includes(primaryWarehouseId)) {
        return json({ error: 'Выберите основной склад WB и хотя бы один склад для FBS' }, 400);
      }
      const lowStockThreshold = Math.max(0, Number(client.wb_stock_switch_threshold ?? 3));

      const { data: availableRows, error: availErr } = await sb.rpc('get_available_stock', {
        p_client_name: client.name,
      });
      if (availErr) return json({ error: 'Не удалось рассчитать доступный остаток: ' + availErr.message }, 500);

      if (!availableRows || availableRows.length === 0) {
        return json({ error: 'Ни у одного товара клиента не указан штрихкод — нечего отправлять' }, 400);
      }

      const filter = Array.isArray(changedBarcodes) ? new Set(changedBarcodes.map(String)) : null;
      const baseStocks = availableRows.filter((r:any)=>!filter||filter.has(String(r.barcode))).map((r: any) => ({ sku: r.barcode, amount: Math.max(0, Number(r.wb_available) || 0) }));
      if(!baseStocks.length) return json({ok:true,sent:0,warehouses:[]});
      const results: any[] = [];
      const skippedAll = new Set<string>();
      for (const warehouseId of warehouseIds) {
        const isPrimary = warehouseId === primaryWarehouseId;
        const current = new Map<string, number>();
        // WB уменьшает остаток склада-источника заказа до нашей синхронизации.
        // Считываем фактические значения, чтобы не отправлять прежний остаток
        // и не пополнять дополнительные склады на низком остатке.
        for (let i = 0; i < baseStocks.length; i += 1000) {
          const skus = baseStocks.slice(i, i + 1000).map((row: any) => row.sku);
          const response = await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}`, {
            method: 'POST',
            headers: { Authorization: client.wb_key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ skus }),
          });
          if (!response.ok) throw new Error(`Не удалось получить остатки склада ${warehouseId}: WB ${response.status}`);
          const snapshot = await response.json();
          if (!Array.isArray(snapshot.stocks)) throw new Error(`WB вернул неверный формат остатков склада ${warehouseId}`);
          for (const row of snapshot.stocks) {
            if (typeof row.sku === 'string' && Number.isInteger(row.amount) && row.amount >= 0) {
              current.set(row.sku, row.amount);
            }
          }
        }
        let stocks = baseStocks.flatMap((row: { sku: string; amount: number }) => {
          const previous = current.get(row.sku);
          const lowStockSecondary = !isPrimary && row.amount <= lowStockThreshold;
          if (lowStockSecondary && previous === undefined) return [];
          const amount = lowStockSecondary ? Math.min(previous!, row.amount) : row.amount;
          return amount === previous ? [] : [{ sku: row.sku, amount }];
        });
        if (!stocks.length) {
          results.push({ warehouseId, ok: true, sent: 0, skipped: 0 });
          continue;
        }
        const skippedSgt = new Set<string>();
        let resp: Response | null = null;
        let errText = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          if (!stocks.length) break;
          resp = await fetch(`https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}`, {
            method: 'PUT',
            headers: { Authorization: client.wb_key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ stocks }),
          });
          if (resp.status === 200 || resp.status === 204) break;
          errText = await resp.text();
          if (resp.status !== 409) break;
          let bad: string[] = [];
          try {
            const parsed = JSON.parse(errText);
            for (const e of (Array.isArray(parsed) ? parsed : [parsed])) {
              if (e && e.code === 'CargoWarehouseRestrictionSGT' && Array.isArray(e.data)) {
                bad = bad.concat(e.data.map((d: any) => String(d.sku)));
              }
            }
          } catch (_e) {}
          if (!bad.length) break;
          bad.forEach((b) => skippedSgt.add(b));
          stocks = stocks.filter((s: any) => !skippedSgt.has(String(s.sku)));
        }
        const ok = !!resp && (resp.status === 200 || resp.status === 204);
        if (ok || (!stocks.length && skippedSgt.size)) {
          skippedSgt.forEach(s => skippedAll.add(s));
          results.push({ warehouseId, ok: true, sent: stocks.length, skipped: skippedSgt.size, lowStockMode: !isPrimary && baseStocks.some((s: any) => s.amount <= lowStockThreshold) });
        } else {
          results.push({ warehouseId, ok: false, status: resp?.status || null, error: errText.slice(0, 500) });
        }
      }
      const failed = results.filter(r => !r.ok);
      if (failed.length) {
        const summary = failed.map(r => `${r.warehouseId}: ${r.status || 'ошибка'} ${r.error}`).join('; ');
        await sb.from('clients').update({ wb_last_sync_error: summary.slice(0, 500) }).eq('id', clientId);
        return json({ ok: false, warehouses: results, error: `Не удалось обновить остатки на всех выбранных складах: ${summary}` }, 502);
      }
      await sb.from('clients').update({ wb_last_synced_at: new Date().toISOString(), wb_last_sync_error: null }).eq('id', clientId);
      return json({ ok: true, sent: results.reduce((sum, row) => sum + row.sent, 0), skipped: skippedAll.size, skippedSgtSkus: Array.from(skippedAll), warehouses: results, primaryWarehouseId, lowStockThreshold });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};
