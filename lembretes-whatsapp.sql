-- =====================================================================
--  Gestor Financeiro MD · Lembretes de vencimento no WhatsApp
--  Cole tudo no Supabase → SQL Editor → Run (uma vez só).
--  Envia às 9h o relatório do dia e às 15h cobra o que ainda não foi
--  confirmado. Os horários e o telefone ficam no próprio gestor
--  (aba Secretária → Lembretes no WhatsApp).
-- =====================================================================
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.zap_log(
  dia date not null, rodada text not null, enviado_em timestamptz default now(),
  mensagem text, pedido bigint, primary key(dia, rodada));
alter table public.zap_log enable row level security;   -- ninguém de fora lê

create or replace function public.zap_urlenc(t text) returns text
language sql immutable as $$
  select coalesce(string_agg(case when ch ~ '^[A-Za-z0-9_.~-]$' then ch
           else upper(regexp_replace(encode(convert_to(ch,'UTF8'),'hex'),'(..)','%\1','g')) end, '' order by i), '')
  from regexp_split_to_table(t, '') with ordinality as x(ch, i) $$;

create or replace function public.zap_montar(z jsonb, rod text, hoje date) returns text
language plpgsql stable as $$
declare it jsonb; d date; l_hoje text := ''; l_atr text := ''; l_ama text := ''; l_cob text := ''; msg text; nome text; lk text;
begin
  for it in select value from jsonb_array_elements(coalesce(z->'itens','[]'::jsonb)) order by value->>'ds' loop
    if coalesce((it->>'feito')::boolean, false) then continue; end if;
    d := (it->>'ds')::date;
    if d < hoje and d >= hoje - 31 then l_atr := l_atr || E'\n• ' || (it->>'txt') || ' _(venceu ' || to_char(d,'DD/MM') || ')_';
    elsif d = hoje then l_hoje := l_hoje || E'\n• ' || (it->>'txt');
    elsif d = hoje + 1 then l_ama := l_ama || E'\n• ' || (it->>'txt');
    end if;
  end loop;
  for it in select distinct on (value->>'k') value from jsonb_array_elements(coalesce(z->'cobrar','[]'::jsonb))
             where (value->>'ds')::date <= hoje order by value->>'k', value->>'ds' desc loop
    l_cob := l_cob || E'\n• ' || (it->>'txt');
  end loop;
  lk := coalesce(nullif(z->'cfg'->>'link',''), 'https://maisdeliveryvr-cyber.github.io/gestor-maisdelivery/');
  nome := coalesce(nullif(z->'cfg'->>'nome',''), 'Lucas');
  if rod = 'manha' then
    if l_hoje = '' and l_atr = '' and l_ama = '' and l_cob = '' then return null; end if;
    msg := '☀️ *Bom dia, ' || nome || '! Contas do dia ' || to_char(hoje,'DD/MM') || '*';
    if l_hoje <> '' then msg := msg || E'\n\n📌 *Vencem hoje*' || l_hoje; end if;
    if l_atr  <> '' then msg := msg || E'\n\n⏰ *Atrasadas*' || l_atr; end if;
    if l_ama  <> '' then msg := msg || E'\n\n📅 *Amanhã*' || l_ama; end if;
    if l_cob  <> '' then msg := msg || E'\n\n📣 *Cobrar hoje dos parceiros*' || l_cob || E'\nMensagens prontas na Fila de cobrança: ' || lk || '#cobrar'; end if;
    msg := msg || E'\n\n✅ Já pagou? Confirme no gestor (botão Feito/Paguei):';
  else
    if l_hoje = '' and l_atr = '' and l_cob = '' then return null; end if;
    msg := '⚠️ *' || nome || ', ainda falta resolver:*';
    if l_hoje <> '' then msg := msg || E'\n\n📌 *Vencem hoje*' || l_hoje; end if;
    if l_atr  <> '' then msg := msg || E'\n\n⏰ *Atrasadas*' || l_atr; end if;
    if l_cob  <> '' then msg := msg || E'\n\n📣 *Cobranças ainda não enviadas*' || l_cob || E'\nFila de cobrança: ' || lk || '#cobrar'; end if;
    msg := msg || E'\n\nSe já pagou, é só marcar no gestor que eu paro de cobrar:';
  end if;
  return msg || E'\n' || lk || '#hoje';
end $$;

create or replace function public.zap_rodar(forcar text default null) returns text
language plpgsql security definer set search_path = public as $$
declare z jsonb; c jsonb; agora timestamp; hoje date; h int; rod text; msg text; req bigint; fone text;
begin
  select data into z from public.docs where path = 'empresa' and id = 'zap' order by updated_at desc nulls last limit 1;
  if z is null then return 'sem configuração'; end if;
  c := z->'cfg';
  if not coalesce((c->>'ativo')::boolean, false) then return 'desligado'; end if;
  fone := regexp_replace(coalesce(c->>'fone',''), '\D', '', 'g');
  if fone = '' or coalesce(c->>'apikey','') = '' then return 'falta telefone ou apikey'; end if;
  if left(fone,2) <> '55' then fone := '55' || fone; end if;
  agora := now() at time zone coalesce(nullif(c->>'tz',''), 'America/Sao_Paulo');
  hoje := agora::date; h := extract(hour from agora);
  if forcar is not null then rod := forcar;
  elsif h = coalesce((c->>'h1')::int, 9)  then rod := 'manha';
  elsif h = coalesce((c->>'h2')::int, 15) then rod := 'tarde';
  else return 'fora do horário (' || h || 'h)'; end if;
  if forcar is null and exists(select 1 from public.zap_log where dia = hoje and rodada = rod) then return 'já enviado'; end if;
  msg := public.zap_montar(z, rod, hoje);
  if msg is null then
    insert into public.zap_log(dia, rodada, mensagem) values (hoje, rod, null) on conflict do nothing;
    return 'nada pendente';
  end if;
  select net.http_get('https://api.callmebot.com/whatsapp.php?phone=%2B' || fone
         || '&apikey=' || public.zap_urlenc(c->>'apikey') || '&text=' || public.zap_urlenc(msg)) into req;
  insert into public.zap_log(dia, rodada, mensagem, pedido) values (hoje, coalesce(forcar,rod), msg, req)
    on conflict (dia, rodada) do update set mensagem = excluded.mensagem, pedido = excluded.pedido, enviado_em = now();
  return 'enviado: ' || rod;
end $$;
revoke all on function public.zap_rodar(text) from public, anon, authenticated;

-- roda de hora em hora (no minuto 0); a função decide se é hora de mandar
select cron.unschedule(jobid) from cron.job where jobname = 'gestor-zap';
select cron.schedule('gestor-zap', '0 * * * *', $$select public.zap_rodar()$$);

-- TESTE: tire os dois traços da linha abaixo e rode para receber a mensagem agora
-- select public.zap_rodar('manha');
