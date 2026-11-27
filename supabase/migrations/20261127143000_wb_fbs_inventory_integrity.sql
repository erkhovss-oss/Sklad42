alter table public.wb_fbs_stock_operations add column if not exists product jsonb;

CREATE OR REPLACE FUNCTION public.wb_fbs_deduct(p_order_id bigint, p_client_id text, p_sku text, p_size text, p_warehouse text, p_employee_id text, p_employee_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare o public.wb_orders%rowtype; i public.inventory%rowtype; r record; op public.wb_fbs_stock_operations%rowtype; items jsonb; n integer;
begin
select * into o from public.wb_orders where order_id=p_order_id and client_id=p_client_id for update;
if not found then raise exception 'Заказ не найден'; end if;
select * into op from public.wb_fbs_stock_operations where order_id=p_order_id;
if found then
  if op.client_id is distinct from p_client_id then raise exception 'Заказ принадлежит другому клиенту'; end if;
  if op.state='deducted' then
    if op.items->0->>'warehouse' is distinct from p_warehouse then raise exception 'Заказ списан с другого склада'; end if;
    return jsonb_build_object('applied',false,'items',op.items);
  end if;
  raise exception 'Заказ уже возвращён';
end if;
if coalesce(o.wb_status,'') in ('canceled','canceled_by_client','declined_by_client') then
  raise exception 'Заказ отменён покупателем';
end if;
if o.supplier_status is distinct from 'new' then raise exception 'Заказ уже обработан'; end if;
select * into i from public.inventory where sku=p_sku and client_name=o.client_name and size=coalesce(p_size,'') and warehouse_id=p_warehouse and warehouse_id<>'BRAK';
if not found then raise exception 'Товар не найден'; end if;
if not (i.barcode is not null and o.barcode is not null and ltrim(i.barcode,'0')=ltrim(o.barcode,'0')) and not exists(select 1 from public.inventory_barcodes b where b.client_name=o.client_name and b.sku=i.sku and coalesce(b.size,'')=i.size and ltrim(b.barcode,'0')=ltrim(o.barcode,'0')) and not (o.barcode is null and i.sku=o.article) then raise exception 'Товар не соответствует заказу'; end if;
if coalesce(i.is_kit,false) and coalesce(i.kit_mode,'virtual')<>'assembled' then
if exists(select 1 from public.kit_components k where k.kit_client_name=i.client_name and k.kit_sku=i.sku and k.kit_size=i.size and k.kit_warehouse_id=i.warehouse_id and (k.qty_needed<=0 or k.qty_needed<>trunc(k.qty_needed))) then raise exception 'Некорректное количество компонентов'; end if;
select jsonb_agg(jsonb_build_object('sku',sku,'size',size,'qty',qty) order by sku,size) into items from (select component_sku sku,coalesce(component_size,'') size,sum(qty_needed)::integer qty from public.kit_components where kit_client_name=i.client_name and kit_sku=i.sku and kit_size=i.size and kit_warehouse_id=i.warehouse_id group by 1,2) q;
else items=jsonb_build_array(jsonb_build_object('sku',i.sku,'size',i.size,'qty',1)); end if;
if items is null then raise exception 'Нет компонентов комплекта'; end if;
if exists (
  select 1 from jsonb_to_recordset(items) x(sku text,size text,qty integer)
  join public.inventory c on (c.sku,c.client_name,c.size,c.warehouse_id)=(x.sku,i.client_name,x.size,i.warehouse_id)
  where coalesce(c.is_kit,false) and coalesce(c.kit_mode,'virtual')<>'assembled'
) then raise exception 'Вложенные виртуальные комплекты не поддерживаются'; end if;
for r in select * from jsonb_to_recordset(items) as x(sku text,size text,qty integer) order by sku,size loop
update public.inventory set qty=qty-r.qty where sku=r.sku and client_name=o.client_name and size=r.size and warehouse_id=p_warehouse and qty>=r.qty returning qty into n;
if not found then raise exception 'Недостаточно товара %',r.sku; end if;
insert into public.movement_log(sku,name,delta,type,client_name,size,employee_id,employee_name) select sku,name,-r.qty,'Сборка заказа FBS №'||p_order_id,o.client_name,size,p_employee_id,p_employee_name from public.inventory where sku=r.sku and client_name=o.client_name and size=r.size and warehouse_id=p_warehouse;
end loop;
items=(select jsonb_agg(x||jsonb_build_object('warehouse',p_warehouse)) from jsonb_array_elements(items) x);
insert into public.wb_fbs_stock_operations(order_id,client_id,state,items,product)
values(p_order_id,p_client_id,'deducted',items,
  jsonb_build_object('sku',i.sku,'size',i.size,'warehouse',i.warehouse_id));
return jsonb_build_object('applied',true,'items',items);
end;
$function$;


CREATE OR REPLACE FUNCTION public.wb_fbs_restore(p_order_id bigint, p_client_id text, p_sku text, p_size text, p_warehouse text, p_resolution text, p_reason text, p_employee_id text, p_employee_name text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o public.wb_orders%rowtype;
  op public.wb_fbs_stock_operations%rowtype;
  product_row public.inventory%rowtype;
  component public.inventory%rowtype;
  product jsonb;
  line record;
  dest text;
begin
  select * into o from public.wb_orders where order_id=p_order_id and client_id=p_client_id for update;
  if not found then return jsonb_build_object('tracked',false); end if;
  select * into op from public.wb_fbs_stock_operations where order_id=p_order_id and client_id=p_client_id for update;
  if not found then return jsonb_build_object('tracked',false); end if;

  product := op.product;
  -- Older regular deductions have exactly one line for the ordered item.
  if product is null and jsonb_array_length(op.items)=1 and op.items->0->>'qty'='1' then
    product := op.items->0;
  end if;
  if product is null or product->>'sku' is distinct from p_sku
      or product->>'size' is distinct from coalesce(p_size,'')
      or product->>'warehouse' is distinct from p_warehouse or p_warehouse='BRAK' then
    raise exception 'Товар или склад не соответствует списанию заказа';
  end if;
  if op.state='restored' then return jsonb_build_object('tracked',true,'applied',false); end if;
  if op.state is distinct from 'deducted' then raise exception 'Нет подтверждённого списания'; end if;
  if coalesce(o.supplier_status,'') not in ('cancel','complete') and
      coalesce(o.wb_status,'') not in ('canceled','canceled_by_client','declined_by_client','defect') then
    raise exception 'Заказ ещё активен: возврат возможен после подтверждения отмены или завершения';
  end if;
  if p_resolution is null or p_resolution not in ('restock','defect') then
    raise exception 'Неизвестный тип возврата';
  end if;
  if exists(select 1 from public.returns where order_id=p_order_id::text and client_name=o.client_name) then
    raise exception 'Возврат уже записан ранее: нужна сверка';
  end if;
  select * into strict product_row from public.inventory
  where (sku,client_name,size,warehouse_id)=(p_sku,o.client_name,coalesce(p_size,''),p_warehouse);
  if op.product is null and coalesce(product_row.is_kit,false) and coalesce(product_row.kit_mode,'virtual')<>'assembled' then
    raise exception 'Для старого комплекта нужна сверка состава списания';
  end if;
  if coalesce(jsonb_array_length(op.items),0)=0 then raise exception 'Списание не содержит товаров'; end if;

  dest := p_warehouse;
  if p_resolution='defect' then
    dest := 'BRAK';
    insert into public.warehouses(id,name) values('BRAK','БРАК (не для продажи)') on conflict(id) do nothing;
  end if;
  for line in
    select * from jsonb_to_recordset(op.items) as x(sku text,size text,warehouse text,qty integer)
    order by sku,size,warehouse
  loop
    if line.qty is null or line.qty<=0 or line.warehouse is distinct from p_warehouse then
      raise exception 'Некорректная строка списания';
    end if;
    if dest='BRAK' then
      select * into strict component from public.inventory
      where (sku,client_name,size,warehouse_id)=(line.sku,o.client_name,line.size,line.warehouse);
      insert into public.inventory(sku,name,qty,client_name,size,warehouse_id,barcode)
      values(component.sku,component.name,line.qty,component.client_name,component.size,dest,component.barcode)
      on conflict(sku,client_name,size,warehouse_id) do update set qty=inventory.qty+excluded.qty;
    else
      update public.inventory set qty=qty+line.qty
      where (sku,client_name,size,warehouse_id)=(line.sku,o.client_name,line.size,dest)
      returning * into strict component;
    end if;
    insert into public.movement_log(sku,name,delta,type,client_name,size,employee_id,employee_name)
    values(component.sku,component.name,line.qty,'Возврат FBS №'||p_order_id||' ('||p_resolution||')',
      component.client_name,component.size,p_employee_id,p_employee_name);
  end loop;
  insert into public.returns(id,sku,name,size,client_name,warehouse_id,qty,order_id,reason,resolution,employee_id,employee_name)
  values('RET-WB-'||p_order_id,product_row.sku,product_row.name,product_row.size,product_row.client_name,
    dest,1,p_order_id::text,p_reason,p_resolution,p_employee_id,p_employee_name);
  update public.wb_fbs_stock_operations set state='restored',updated_at=now() where order_id=p_order_id;
  return jsonb_build_object('tracked',true,'applied',true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_available_stock(p_client_name text)
 RETURNS TABLE(barcode text, sku text, wb_available integer, ozon_available integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$;
  with
  cm as (
    select coalesce((select stock_allocation_mode from public.clients where name = p_client_name limit 1), 'shared') as mode
  ),
  items as (
    select i.sku, coalesce(i.size,'') as size,
      sum(i.qty)::numeric as qty,
      coalesce(sum(i.wb_allocated_qty),0)::numeric as wb_alloc,
      coalesce(sum(i.ozon_allocated_qty),0)::numeric as oz_alloc,
      coalesce(max(i.safety_buffer),0)::numeric as buffer,
      (array_agg(i.barcode order by i.barcode) filter (where i.barcode is not null and i.barcode <> ''))[1] as barcode,
      bool_or(coalesce(i.is_kit,false) and coalesce(i.kit_mode,'virtual') <> 'assembled') as is_virtual
    from public.inventory i
    where i.client_name = p_client_name and i.warehouse_id <> 'BRAK'
    group by i.sku, coalesce(i.size,'')
  ),
  kits as (
    select kc.kit_sku, coalesce(kc.kit_size,'') as kit_size, kc.component_sku, coalesce(kc.component_size,'') as comp_size, max(kc.qty_needed)::numeric as qty_needed
    from public.kit_components kc
    join items kit on kit.sku=kc.kit_sku and kit.size=coalesce(kc.kit_size,'') and kit.is_virtual
    where kc.kit_client_name = p_client_name and kc.kit_warehouse_id <> 'BRAK'
    group by 1,2,3,4
  ),
  code_map as (
    select distinct on (b.barcode) b.barcode, b.sku, b.size
    from (
      select barcode, sku, coalesce(size,'') as size, 0 as pr from public.inventory where client_name = p_client_name and warehouse_id <> 'BRAK' and barcode is not null and barcode <> ''
      union all
      select barcode, sku, coalesce(size,'') as size, 1 as pr from public.inventory_barcodes where client_name = p_client_name
    ) b
    order by b.barcode, b.pr, b.sku
  ),
  wb_direct as (
    select cmap.sku, cmap.size, count(*)::numeric as cnt
    from public.wb_orders o
    join code_map cmap on cmap.barcode = o.barcode
    where o.supplier_status = 'new' and o.client_name = p_client_name
      and coalesce(o.wb_status,'') not in ('canceled','canceled_by_client','declined_by_client')
      and not exists (select 1 from public.wb_fbs_stock_operations op where op.order_id=o.order_id and op.client_id=o.client_id and op.state='deducted')
    group by cmap.sku, cmap.size
  ),
  oz_orders as (
    select article as offer_id, sum(qty)::numeric as cnt
    from public.ozon_orders
    where status = 'awaiting_packaging' and client_name = p_client_name and article is not null
    group by article
  ),
  sku_first as (
    select distinct on (sku) sku, coalesce(size,'') as size
    from public.inventory where client_name = p_client_name and warehouse_id <> 'BRAK'
    order by sku, coalesce(size,'')
  ),
  oz_direct as (
    select coalesce(f.inv_sku, sf.sku) as sku, coalesce(f.inv_size, sf.size) as size, sum(o.cnt) as cnt
    from oz_orders o
    left join public.ozon_offers f on f.client_name = p_client_name and f.offer_id = o.offer_id and f.status = 'linked'
    left join sku_first sf on sf.sku = o.offer_id
    where coalesce(f.inv_sku, sf.sku) is not null
    group by 1, 2
  ),
  dem as (
    select x.sku, x.size,
      coalesce(wd.cnt,0) + coalesce((
        select sum(wd2.cnt * k.qty_needed) from kits k
        join wb_direct wd2 on wd2.sku = k.kit_sku and wd2.size = k.kit_size
        where k.component_sku = x.sku and k.comp_size = x.size), 0) as wb_dem,
      coalesce(od.cnt,0) + coalesce((
        select sum(od2.cnt * k.qty_needed) from kits k
        join oz_direct od2 on od2.sku = k.kit_sku and od2.size = k.kit_size
        where k.component_sku = x.sku and k.comp_size = x.size), 0) as oz_dem
    from items x
    left join wb_direct wd on wd.sku = x.sku and wd.size = x.size
    left join oz_direct od on od.sku = x.sku and od.size = x.size
  ),
  pool as (
    select it.sku, it.size, it.barcode, it.is_virtual, it.buffer,
      greatest(0, (case when cm.mode = 'split' then least(it.wb_alloc, it.qty) else it.qty end) - d.wb_dem - (case when cm.mode = 'split' then 0 else d.oz_dem end) - it.buffer) as wb_av,
      greatest(0, (case when cm.mode = 'split' then least(it.oz_alloc, it.qty) else it.qty end) - d.oz_dem - (case when cm.mode = 'split' then 0 else d.wb_dem end) - it.buffer) as oz_av
    from items it
    join dem d on d.sku = it.sku and d.size = it.size
    cross join cm
  ),
  kit_av as (
    select k.kit_sku, k.kit_size,
      min(floor(case when k.qty_needed > 0 then coalesce(p.wb_av,0) / k.qty_needed else 0 end)) as wb_av,
      min(floor(case when k.qty_needed > 0 then coalesce(p.oz_av,0) / k.qty_needed else 0 end)) as oz_av
    from kits k
    left join pool p on p.sku = k.component_sku and p.size = k.comp_size
    group by k.kit_sku, k.kit_size
  )
  select p.barcode, p.sku,
    (case when p.is_virtual then coalesce(ka.wb_av,0) else p.wb_av end)::integer as wb_available,
    (case when p.is_virtual then coalesce(ka.oz_av,0) else p.oz_av end)::integer as ozon_available
  from pool p
  left join kit_av ka on ka.kit_sku = p.sku and ka.kit_size = p.size
  where p.barcode is not null;
$function$;

