-- Provision the same wms_wb_cron_token in Vault and WMS_WB_CRON_TOKEN in Edge secrets before applying.
CREATE OR REPLACE FUNCTION public.trigger_wb_backfill_supply_ids()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  FOR r IN SELECT id FROM public.clients WHERE wb_connected = true AND wb_key IS NOT NULL AND wb_key <> ''
  LOOP
    PERFORM net.http_post(
      url := 'https://mixsvqjlrifkcoeuuydc.supabase.co/functions/v1/wb-orders-ts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wms-cron-token', cron_token
      ),
      body := jsonb_build_object('clientId', r.id, 'action', 'backfill_supply_ids'),
      timeout_milliseconds := 120000
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_wb_discover_missing()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  FOR r IN SELECT id FROM public.clients WHERE wb_connected = true AND wb_key IS NOT NULL AND wb_key <> ''
  LOOP
    PERFORM net.http_post(
      url := 'https://mixsvqjlrifkcoeuuydc.supabase.co/functions/v1/wb-orders-ts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wms-cron-token', cron_token
      ),
      body := jsonb_build_object('clientId', r.id, 'action', 'discover_missing_orders'),
      timeout_milliseconds := 120000
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_wb_fetch_new()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  FOR r IN SELECT id FROM public.clients WHERE wb_connected = true AND wb_key IS NOT NULL AND wb_key <> ''
  LOOP
    PERFORM net.http_post(
      url := 'https://mixsvqjlrifkcoeuuydc.supabase.co/functions/v1/wb-orders-ts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wms-cron-token', cron_token
      ),
      body := jsonb_build_object('clientId', r.id, 'action', 'fetch_new'),
      timeout_milliseconds := 30000
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_wb_push_stocks()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  FOR r IN SELECT id FROM public.clients
    WHERE wb_connected = true AND wb_auto_sync = true
      AND wb_key IS NOT NULL AND wb_key <> ''
      AND wb_warehouse_id IS NOT NULL AND wb_warehouse_id <> ''
  LOOP
    PERFORM net.http_post(
      url := 'https://mixsvqjlrifkcoeuuydc.supabase.co/functions/v1/wb-sync-stocks-ts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wms-cron-token', cron_token
      ),
      body := jsonb_build_object('clientId', r.id, 'action', 'push_stocks'),
      timeout_milliseconds := 60000
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_wb_recheck_pending_kiz()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  FOR r IN SELECT DISTINCT client_id AS id FROM public.wb_orders WHERE kiz_status = 'pending'
  LOOP
    PERFORM net.http_post(
      url := 'https://mixsvqjlrifkcoeuuydc.supabase.co/functions/v1/wb-orders-ts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wms-cron-token', cron_token
      ),
      body := jsonb_build_object('clientId', r.id, 'action', 'recheck_pending_kiz'),
      timeout_milliseconds := 60000
    );
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_wb_sync_statuses()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  FOR r IN SELECT id FROM public.clients WHERE wb_connected = true AND wb_key IS NOT NULL AND wb_key <> ''
  LOOP
    PERFORM net.http_post(
      url := 'https://mixsvqjlrifkcoeuuydc.supabase.co/functions/v1/wb-orders-ts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-wms-cron-token', cron_token
      ),
      body := jsonb_build_object('clientId', r.id, 'action', 'sync_order_statuses'),
      timeout_milliseconds := 120000
    );
  END LOOP;
END;
$function$
;
