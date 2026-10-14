-- FragenRaum Patch v11: Rate-Limits, Antwort-Deduplizierung und Fix für "is_correct is ambiguous".
-- In Supabase nach schema.sql/patch-v10 ausführen.

create extension if not exists pgcrypto with schema extensions;

-- Token-Hash robust gegen Supabase-search_path/extension-Schema
create or replace function public.fr_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(upper(coalesce(p_token, '')), 'sha256'::text), 'hex');
$$;

create or replace function public.fr_random_code(p_len integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
  b integer;
begin
  for i in 1..p_len loop
    b := get_byte(extensions.gen_random_bytes(1), 0);
    result := result || substr(chars, (b % length(chars)) + 1, 1);
  end loop;

  return result;
end;
$$;

-- Kleine, temporäre Schutzschicht gegen versehentliches oder absichtliches Button-Spam.
-- Kein echter DDoS-Schutz. Dafür später zusätzlich Cloudflare Turnstile/WAF nutzen.
create table if not exists fr_rate_events (
  id uuid primary key default gen_random_uuid(),
  client_hash text not null,
  action text not null,
  room_id uuid references rooms(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists fr_rate_events_lookup_idx
  on fr_rate_events(client_hash, action, room_id, created_at desc);

alter table fr_rate_events enable row level security;
revoke all on table fr_rate_events from anon, authenticated;

-- Server-seitige Quittungen: verhindert Mehrfachzählung desselben Browsers in einem Quizdurchlauf.
-- Speichert keine Antwortauswahl und keine Richtig/Falsch-Info pro Browser.
create table if not exists quiz_session_receipts (
  room_id uuid not null references rooms(id) on delete cascade,
  quiz_round integer not null,
  client_hash text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (room_id, quiz_round, client_hash)
);

create table if not exists answer_receipts (
  room_id uuid not null references rooms(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  quiz_round integer not null,
  client_hash text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, question_id, quiz_round, client_hash)
);

create index if not exists answer_receipts_room_round_idx on answer_receipts(room_id, quiz_round);

alter table quiz_session_receipts enable row level security;
alter table answer_receipts enable row level security;
revoke all on table quiz_session_receipts from anon, authenticated;
revoke all on table answer_receipts from anon, authenticated;

create or replace function fr_client_hash(p_client_id text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if length(trim(coalesce(p_client_id, ''))) < 12 then
    raise exception 'Browser-Token fehlt. Bitte Seite neu laden.';
  end if;
  if length(trim(p_client_id)) > 128 then
    raise exception 'Browser-Token ist ungültig.';
  end if;
  return fr_token_hash(trim(p_client_id));
end;
$$;

create or replace function fr_check_rate_limit(
  p_client_id text,
  p_action text,
  p_limit integer,
  p_window_seconds integer,
  p_room_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h text;
  recent_count integer;
begin
  h := fr_client_hash(p_client_id);

  -- einfache Hygiene, damit die Rate-Tabelle klein bleibt
  delete from fr_rate_events where created_at < now() - interval '2 days';

  select count(*) into recent_count
  from fr_rate_events
  where client_hash = h
    and action = p_action
    and (p_room_id is null or room_id = p_room_id)
    and created_at >= now() - make_interval(secs => p_window_seconds);

  if recent_count >= p_limit then
    raise exception 'Zu viele Aktionen in kurzer Zeit. Bitte kurz warten.';
  end if;

  insert into fr_rate_events(client_hash, action, room_id)
  values (h, p_action, p_room_id);
end;
$$;

create or replace function fr_validate_options(p_options jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  option_count integer;
  correct_count integer;
begin
  if jsonb_typeof(p_options) <> 'array' then
    raise exception 'Antwortoptionen müssen ein Array sein.';
  end if;

  select count(*), count(*) filter (where coalesce((elem.value->>'is_correct')::boolean, false))
  into option_count, correct_count
  from jsonb_array_elements(p_options) as elem(value);

  if option_count < 2 or option_count > 10 then
    raise exception 'Erlaubt sind 2 bis 10 Antwortoptionen.';
  end if;

  if correct_count < 1 then
    raise exception 'Mindestens eine Antwortoption muss richtig sein.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_options) as elem(value)
    where length(trim(coalesce(elem.value->>'option_text', ''))) = 0
       or length(trim(coalesce(elem.value->>'option_text', ''))) > 300
  ) then
    raise exception 'Antwortoptionen dürfen nicht leer und höchstens 300 Zeichen lang sein.';
  end if;
end;
$$;

-- Alte Signaturen entfernen, damit PostgREST/Supabase nicht zwischen mehreren RPC-Funktionen wählen muss.
drop function if exists fr_create_room(text, text);
drop function if exists fr_add_question(text, text, text, text, jsonb);
drop function if exists fr_revise_question(text, text, uuid, text, text, jsonb);
drop function if exists fr_mark_started(text);
drop function if exists fr_mark_completed(text);
drop function if exists fr_record_answer(text, uuid, uuid[]);

create or replace function fr_create_room(p_title text, p_admin_token text, p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  perform fr_check_rate_limit(p_client_id, 'create_room', 10, 86400, null);

  if length(trim(coalesce(p_admin_token, ''))) < 10 then
    raise exception 'Admincode ist zu kurz.';
  end if;
  if length(trim(coalesce(p_title, ''))) > 120 then
    raise exception 'Der Raumtitel ist zu lang.';
  end if;

  insert into rooms (public_code, admin_token_hash, title)
  values (fr_new_public_code(), fr_token_hash(p_admin_token), coalesce(nullif(trim(p_title), ''), 'Neuer Quizraum'))
  returning id into created_id;

  return fr_room_json(created_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_add_question(
  p_code text,
  p_author_token text,
  p_question_text text,
  p_explanation text,
  p_options jsonb,
  p_client_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room rooms%rowtype;
  new_question_id uuid;
begin
  select * into target_room
  from rooms
  where public_code = upper(trim(p_code))
    and deleted_at is null
    and expires_at > now()
  limit 1;

  if target_room.id is null then raise exception 'Raum nicht gefunden.'; end if;
  perform fr_check_rate_limit(coalesce(p_client_id, p_author_token), 'add_question', 10, 60, target_room.id);

  if length(trim(coalesce(p_question_text, ''))) < 5 then raise exception 'Die Frage ist zu kurz.'; end if;
  if length(trim(coalesce(p_question_text, ''))) > 500 then raise exception 'Die Frage ist zu lang.'; end if;
  if length(trim(coalesce(p_explanation, ''))) > 1000 then raise exception 'Die Erklärung ist zu lang.'; end if;
  if length(trim(coalesce(p_author_token, ''))) < 8 then raise exception 'Autoren-Token fehlt.'; end if;

  perform fr_validate_options(p_options);

  insert into questions (room_id, question_text, explanation, status, author_token_hash)
  values (
    target_room.id,
    trim(p_question_text),
    nullif(trim(coalesce(p_explanation, '')), ''),
    case when target_room.auto_approve_questions then 'approved' else 'draft' end,
    fr_token_hash(p_author_token)
  ) returning id into new_question_id;

  perform fr_insert_options(new_question_id, p_options);
  return fr_room_json(target_room.id, null, p_author_token);
end;
$$;

create or replace function fr_revise_question(
  p_code text,
  p_author_token text,
  p_question_id uuid,
  p_question_text text,
  p_explanation text,
  p_options jsonb,
  p_client_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room rooms%rowtype;
begin
  select * into target_room
  from rooms
  where public_code = upper(trim(p_code))
    and deleted_at is null
    and expires_at > now()
  limit 1;

  if target_room.id is null then raise exception 'Raum nicht gefunden.'; end if;
  perform fr_check_rate_limit(coalesce(p_client_id, p_author_token), 'revise_question', 20, 60, target_room.id);

  if length(trim(coalesce(p_question_text, ''))) < 5 then raise exception 'Die Frage ist zu kurz.'; end if;
  if length(trim(coalesce(p_question_text, ''))) > 500 then raise exception 'Die Frage ist zu lang.'; end if;
  if length(trim(coalesce(p_explanation, ''))) > 1000 then raise exception 'Die Erklärung ist zu lang.'; end if;
  perform fr_validate_options(p_options);

  update questions
  set question_text = trim(p_question_text),
      explanation = nullif(trim(coalesce(p_explanation, '')), ''),
      status = case when target_room.auto_approve_questions then 'approved' else 'draft' end,
      rejection_reason = null,
      updated_at = now()
  where id = p_question_id
    and room_id = target_room.id
    and status = 'rejected'
    and author_token_hash = fr_token_hash(p_author_token);

  if not found then raise exception 'Diese Frage kann von dieser Session nicht überarbeitet werden.'; end if;

  delete from question_stats where question_id = p_question_id;
  delete from option_stats where question_id = p_question_id;
  delete from answer_receipts where question_id = p_question_id;
  delete from answer_options where question_id = p_question_id;
  perform fr_insert_options(p_question_id, p_options);

  return fr_room_json(target_room.id, null, p_author_token);
end;
$$;

create or replace function fr_mark_started(p_code text, p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  target_round integer;
  h text;
  inserted_count integer;
begin
  select id, quiz_round into target_id, target_round
  from rooms
  where public_code = upper(trim(p_code)) and deleted_at is null and expires_at > now()
  limit 1;

  if target_id is null then return; end if;
  perform fr_check_rate_limit(p_client_id, 'mark_started', 60, 60, target_id);
  h := fr_client_hash(p_client_id);

  insert into quiz_session_receipts(room_id, quiz_round, client_hash, started_at)
  values (target_id, target_round, h, now())
  on conflict (room_id, quiz_round, client_hash) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count > 0 then
    update rooms set started_count = started_count + 1 where id = target_id;
  end if;
end;
$$;

create or replace function fr_mark_completed(p_code text, p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  target_round integer;
  h text;
  inserted_count integer;
  completed_count_delta integer;
begin
  select id, quiz_round into target_id, target_round
  from rooms
  where public_code = upper(trim(p_code)) and deleted_at is null and expires_at > now()
  limit 1;

  if target_id is null then return; end if;
  perform fr_check_rate_limit(p_client_id, 'mark_completed', 60, 60, target_id);
  h := fr_client_hash(p_client_id);

  insert into quiz_session_receipts(room_id, quiz_round, client_hash, started_at)
  values (target_id, target_round, h, now())
  on conflict (room_id, quiz_round, client_hash) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count > 0 then
    update rooms set started_count = started_count + 1 where id = target_id;
  end if;

  update quiz_session_receipts
  set completed_at = now()
  where room_id = target_id
    and quiz_round = target_round
    and client_hash = h
    and completed_at is null;

  get diagnostics completed_count_delta = row_count;
  if completed_count_delta > 0 then
    update rooms set completed_count = completed_count + 1 where id = target_id;
  end if;
end;
$$;

create or replace function fr_record_answer(p_code text, p_question_id uuid, p_selected_option_ids uuid[], p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room_id uuid;
  target_round integer;
  h text;
  correct_ids uuid[];
  selected_sorted uuid[];
  answer_is_correct boolean;
  selected_option_id uuid;
  receipt_inserted integer;
begin
  select id, quiz_round into target_room_id, target_round
  from rooms
  where public_code = upper(trim(p_code))
    and deleted_at is null
    and expires_at > now()
  limit 1;

  if target_room_id is null then raise exception 'Raum nicht gefunden.'; end if;
  perform fr_check_rate_limit(p_client_id, 'record_answer', 120, 60, target_room_id);
  h := fr_client_hash(p_client_id);

  if not exists (select 1 from questions q where q.id = p_question_id and q.room_id = target_room_id and q.status = 'approved') then
    raise exception 'Frage nicht gefunden oder nicht freigegeben.';
  end if;

  if p_selected_option_ids is null or array_length(p_selected_option_ids, 1) is null then
    raise exception 'Es wurde keine Antwort ausgewählt.';
  end if;

  if array_length(p_selected_option_ids, 1) > 10 then
    raise exception 'Zu viele Antwortoptionen ausgewählt.';
  end if;

  if exists (
    select 1
    from unnest(p_selected_option_ids) as s(x)
    where not exists (select 1 from answer_options ao where ao.id = s.x and ao.question_id = p_question_id)
  ) then
    raise exception 'Die Antwortauswahl ist ungültig.';
  end if;

  -- Pro Browser/Frage/Durchlauf wird nur die erste Antwort gezählt.
  insert into answer_receipts(room_id, question_id, quiz_round, client_hash)
  values (target_room_id, p_question_id, target_round, h)
  on conflict (room_id, question_id, quiz_round, client_hash) do nothing;

  get diagnostics receipt_inserted = row_count;
  if receipt_inserted = 0 then
    return;
  end if;

  select array_agg(ao.id order by ao.id) into correct_ids
  from answer_options ao
  where ao.question_id = p_question_id and ao.is_correct;

  select array_agg(distinct s.x order by s.x) into selected_sorted
  from unnest(p_selected_option_ids) as s(x);

  answer_is_correct := correct_ids = selected_sorted;

  insert into question_stats (room_id, question_id, total_answers, correct_answers, wrong_answers)
  values (target_room_id, p_question_id, 1, case when answer_is_correct then 1 else 0 end, case when answer_is_correct then 0 else 1 end)
  on conflict (room_id, question_id) do update
  set total_answers = question_stats.total_answers + 1,
      correct_answers = question_stats.correct_answers + excluded.correct_answers,
      wrong_answers = question_stats.wrong_answers + excluded.wrong_answers;

  foreach selected_option_id in array selected_sorted loop
    insert into option_stats (room_id, question_id, option_id, selected_count)
    values (target_room_id, p_question_id, selected_option_id, 1)
    on conflict (room_id, question_id, option_id) do update
    set selected_count = option_stats.selected_count + 1;
  end loop;
end;
$$;

create or replace function fr_admin_reset_results(p_admin_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  target_id := fr_admin_room_id(p_admin_token);
  if target_id is null then raise exception 'Admin-Zugang ungültig.'; end if;

  delete from question_stats where room_id = target_id;
  delete from option_stats where room_id = target_id;
  delete from answer_receipts where room_id = target_id;
  delete from quiz_session_receipts where room_id = target_id;

  update rooms
  set started_count = 0,
      completed_count = 0,
      quiz_round = quiz_round + 1,
      status = 'building',
      presenter_question_index = 0
  where id = target_id;
  return fr_room_json(target_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_admin_replace_questions(p_admin_token text, p_title text, p_questions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  item jsonb;
  new_question_id uuid;
  q_status text;
begin
  target_id := fr_admin_room_id(p_admin_token);
  if target_id is null then raise exception 'Admin-Zugang ungültig.'; end if;
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'Fragen müssen ein Array sein.'; end if;

  delete from questions where room_id = target_id;
  delete from question_stats where room_id = target_id;
  delete from option_stats where room_id = target_id;
  delete from answer_receipts where room_id = target_id;
  delete from quiz_session_receipts where room_id = target_id;

  update rooms
  set title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
      started_count = 0,
      completed_count = 0,
      quiz_round = quiz_round + 1,
      status = 'building',
      presenter_question_index = 0
  where id = target_id;

  for item in select value from jsonb_array_elements(p_questions) loop
    if length(trim(coalesce(item->>'question_text', ''))) < 5 then raise exception 'Eine Importfrage ist zu kurz.'; end if;
    if length(trim(coalesce(item->>'question_text', ''))) > 500 then raise exception 'Eine Importfrage ist zu lang.'; end if;
    q_status := case when item->>'status' = 'approved' then 'approved' else 'draft' end;
    perform fr_validate_options(item->'options');

    insert into questions (room_id, question_text, explanation, status)
    values (target_id, trim(item->>'question_text'), nullif(trim(coalesce(item->>'explanation', '')), ''), q_status)
    returning id into new_question_id;
    perform fr_insert_options(new_question_id, item->'options');
  end loop;

  return fr_room_json(target_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_cleanup_expired_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from rooms where expires_at <= now() or deleted_at is not null;
  get diagnostics deleted_count = row_count;
  delete from fr_rate_events where created_at < now() - interval '2 days';
  return deleted_count;
end;
$$;

grant execute on function fr_create_room(text, text, text) to anon;
grant execute on function fr_add_question(text, text, text, text, jsonb, text) to anon;
grant execute on function fr_revise_question(text, text, uuid, text, text, jsonb, text) to anon;
grant execute on function fr_mark_started(text, text) to anon;
grant execute on function fr_mark_completed(text, text) to anon;
grant execute on function fr_record_answer(text, uuid, uuid[], text) to anon;

grant execute on function fr_admin_reset_results(text) to anon;
grant execute on function fr_admin_replace_questions(text, text, jsonb) to anon;
