CREATE OR REPLACE FUNCTION public.trigger_wb_recheck_pending_kiz()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  cron_token text;
  project_url text;
BEGIN
  SELECT decrypted_secret INTO STRICT cron_token FROM vault.decrypted_secrets WHERE name = 'wms_wb_cron_token';
  SELECT decrypted_secret INTO STRICT project_url FROM vault.decrypted_secrets WHERE name = 'wms_wb_project_url';
  FOR r IN SELECT DISTINCT client_id AS id FROM public.wb_orders WHERE kiz_status = 'pending' OR (supplier_status = 'confirm' AND kiz_status = 'attached')
  LOOP
    PERFORM net.http_post(
      url := rtrim(project_url, '/') || '/functions/v1/wb-orders-ts',
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
