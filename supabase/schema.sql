-- FragenRaum Supabase-Schema v0.11
-- In Supabase: SQL Editor öffnen, diese Datei ausführen, danach optional cron.sql ausführen.

create extension if not exists pgcrypto with schema extensions;

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  public_code text unique not null,
  admin_token_hash text not null,
  title text not null default 'Neuer Quizraum',
  status text not null default 'building' check (status in ('building', 'review', 'playing', 'finished')),
  quiz_mode text not null default 'selfPaced' check (quiz_mode in ('selfPaced', 'presenter')),
  presenter_question_index integer not null default 0,
  auto_approve_questions boolean not null default false,
  practice_enabled boolean not null default false,
  quiz_round integer not null default 1,
  started_count integer not null default 0,
  completed_count integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '21 days'),
  deleted_at timestamptz
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  question_text text not null,
  explanation text,
  rejection_reason text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  author_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists answer_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  position integer not null default 0,
  option_text text not null,
  is_correct boolean not null default false
);

create table if not exists question_stats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  total_answers integer not null default 0,
  correct_answers integer not null default 0,
  wrong_answers integer not null default 0,
  unique(room_id, question_id)
);

create table if not exists option_stats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  option_id uuid not null references answer_options(id) on delete cascade,
  selected_count integer not null default 0,
  unique(room_id, question_id, option_id)
);

create index if not exists rooms_public_code_idx on rooms(public_code);
create index if not exists rooms_admin_token_hash_idx on rooms(admin_token_hash);
create index if not exists rooms_expires_at_idx on rooms(expires_at);
create index if not exists questions_room_id_idx on questions(room_id);
create index if not exists questions_author_token_hash_idx on questions(author_token_hash);
create index if not exists answer_options_question_id_idx on answer_options(question_id);

alter table rooms enable row level security;
alter table questions enable row level security;
alter table answer_options enable row level security;
alter table question_stats enable row level security;
alter table option_stats enable row level security;

revoke all on table rooms from anon, authenticated;
revoke all on table questions from anon, authenticated;
revoke all on table answer_options from anon, authenticated;
revoke all on table question_stats from anon, authenticated;
revoke all on table option_stats from anon, authenticated;

create or replace function fr_token_hash(p_token text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(upper(coalesce(p_token, '')), 'sha256'::text), 'hex');
$$;

create or replace function fr_random_code(p_len integer)
returns text
language plpgsql
volatile
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

create or replace function fr_new_public_code()
returns text
language plpgsql
volatile
as $$
declare
  candidate text;
begin
  loop
    candidate := fr_random_code(5);
    exit when not exists (select 1 from rooms where public_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function fr_validate_options(p_options jsonb)
returns void
language plpgsql
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
  ) then
    raise exception 'Antwortoptionen dürfen nicht leer sein.';
  end if;
end;
$$;

create or replace function fr_room_json(p_room_id uuid, p_admin_token text default null, p_author_token text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_room as (
    select * from rooms
    where id = p_room_id
      and deleted_at is null
      and expires_at > now()
  ), visible_questions as (
    select q.*
    from questions q
    join selected_room r on r.id = q.room_id
    where p_admin_token is not null
       or q.status = 'approved'
       or (p_author_token is not null and q.author_token_hash = fr_token_hash(p_author_token))
  )
  select jsonb_build_object(
    'id', r.id::text,
    'title', r.title,
    'studentCode', r.public_code,
    'adminCode', coalesce(p_admin_token, ''),
    'status', r.status,
    'quizMode', r.quiz_mode,
    'presenterQuestionIndex', r.presenter_question_index,
    'autoApproveQuestions', r.auto_approve_questions,
    'practiceEnabled', r.practice_enabled,
    'quizRound', r.quiz_round,
    'startedCount', r.started_count,
    'completedCount', r.completed_count,
    'createdAt', r.created_at,
    'expiresAt', r.expires_at,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id::text,
        'roomId', q.room_id::text,
        'text', q.question_text,
        'explanation', q.explanation,
        'status', q.status,
        'rejectionReason', q.rejection_reason,
        'authorToken', case when p_author_token is not null and q.author_token_hash = fr_token_hash(p_author_token) then p_author_token else null end,
        'createdAt', q.created_at,
        'updatedAt', q.updated_at,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ao.id::text,
            'text', ao.option_text,
            'isCorrect', ao.is_correct
          ) order by ao.position)
          from answer_options ao
          where ao.question_id = q.id
        ), '[]'::jsonb)
      ) order by q.created_at)
      from visible_questions q
    ), '[]'::jsonb),
    'questionStats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'questionId', qs.question_id::text,
        'totalAnswers', qs.total_answers,
        'correctAnswers', qs.correct_answers,
        'wrongAnswers', qs.wrong_answers
      ))
      from question_stats qs
      where qs.room_id = r.id
    ), '[]'::jsonb),
    'optionStats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'questionId', os.question_id::text,
        'optionId', os.option_id::text,
        'selectedCount', os.selected_count
      ))
      from option_stats os
      where os.room_id = r.id
    ), '[]'::jsonb)
  )
  from selected_room r;
$$;

create or replace function fr_insert_options(p_question_id uuid, p_options jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  pos integer := 0;
begin
  perform fr_validate_options(p_options);
  for item in select value from jsonb_array_elements(p_options) loop
    pos := pos + 1;
    insert into answer_options (question_id, position, option_text, is_correct)
    values (p_question_id, pos, trim(item->>'option_text'), coalesce((item->>'is_correct')::boolean, false));
  end loop;
end;
$$;

create or replace function fr_create_room(p_title text, p_admin_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id uuid;
begin
  if length(trim(coalesce(p_admin_token, ''))) < 10 then
    raise exception 'Admincode ist zu kurz.';
  end if;

  insert into rooms (public_code, admin_token_hash, title)
  values (fr_new_public_code(), fr_token_hash(p_admin_token), coalesce(nullif(trim(p_title), ''), 'Neuer Quizraum'))
  returning id into created_id;

  return fr_room_json(created_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_get_room_public(p_code text, p_author_token text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select fr_room_json(id, null, p_author_token)
  from rooms
  where public_code = upper(trim(p_code))
    and deleted_at is null
    and expires_at > now()
  limit 1;
$$;

create or replace function fr_get_room_admin(p_admin_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select fr_room_json(id, upper(p_admin_token), null)
  from rooms
  where admin_token_hash = fr_token_hash(p_admin_token)
    and deleted_at is null
    and expires_at > now()
  limit 1;
$$;

create or replace function fr_add_question(p_code text, p_author_token text, p_question_text text, p_explanation text, p_options jsonb)
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
  if length(trim(coalesce(p_question_text, ''))) < 5 then raise exception 'Die Frage ist zu kurz.'; end if;
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

create or replace function fr_revise_question(p_code text, p_author_token text, p_question_id uuid, p_question_text text, p_explanation text, p_options jsonb)
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
  if length(trim(coalesce(p_question_text, ''))) < 5 then raise exception 'Die Frage ist zu kurz.'; end if;
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
  delete from answer_options where question_id = p_question_id;
  perform fr_insert_options(p_question_id, p_options);

  return fr_room_json(target_room.id, null, p_author_token);
end;
$$;

create or replace function fr_admin_room_id(p_admin_token text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from rooms
  where admin_token_hash = fr_token_hash(p_admin_token)
    and deleted_at is null
    and expires_at > now()
  limit 1;
$$;

create or replace function fr_admin_update_room(
  p_admin_token text,
  p_status text default null,
  p_quiz_mode text default null,
  p_presenter_question_index integer default null,
  p_auto_approve_questions boolean default null,
  p_practice_enabled boolean default null
)
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

  update rooms
  set status = coalesce(p_status, status),
      quiz_mode = coalesce(p_quiz_mode, quiz_mode),
      presenter_question_index = greatest(0, coalesce(p_presenter_question_index, presenter_question_index)),
      auto_approve_questions = coalesce(p_auto_approve_questions, auto_approve_questions),
      practice_enabled = coalesce(p_practice_enabled, practice_enabled)
  where id = target_id;

  return fr_room_json(target_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_admin_update_question(
  p_admin_token text,
  p_question_id uuid,
  p_question_text text,
  p_explanation text,
  p_options jsonb,
  p_status text,
  p_rejection_reason text default null
)
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
  if length(trim(coalesce(p_question_text, ''))) < 5 then raise exception 'Die Frage ist zu kurz.'; end if;
  perform fr_validate_options(p_options);

  update questions
  set question_text = trim(p_question_text),
      explanation = nullif(trim(coalesce(p_explanation, '')), ''),
      status = p_status,
      rejection_reason = case when p_status = 'rejected' then coalesce(nullif(trim(coalesce(p_rejection_reason, '')), ''), 'Bitte überarbeiten.') else null end,
      updated_at = now()
  where id = p_question_id
    and room_id = target_id;

  if not found then raise exception 'Frage nicht gefunden.'; end if;

  delete from question_stats where question_id = p_question_id;
  delete from option_stats where question_id = p_question_id;
  delete from answer_options where question_id = p_question_id;
  perform fr_insert_options(p_question_id, p_options);

  return fr_room_json(target_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_admin_delete_question(p_admin_token text, p_question_id uuid)
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
  delete from questions where id = p_question_id and room_id = target_id;
  return fr_room_json(target_id, upper(p_admin_token), null);
end;
$$;

create or replace function fr_admin_delete_room(p_admin_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  target_id := fr_admin_room_id(p_admin_token);
  if target_id is null then raise exception 'Admin-Zugang ungültig.'; end if;
  update rooms set deleted_at = now() where id = target_id;
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

create or replace function fr_mark_started(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id from rooms where public_code = upper(trim(p_code)) and deleted_at is null and expires_at > now() limit 1;
  if target_id is null then return; end if;
  update rooms set started_count = started_count + 1 where id = target_id;
end;
$$;

create or replace function fr_mark_completed(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id from rooms where public_code = upper(trim(p_code)) and deleted_at is null and expires_at > now() limit 1;
  if target_id is null then return; end if;
  update rooms set completed_count = completed_count + 1 where id = target_id;
end;
$$;

create or replace function fr_record_answer(p_code text, p_question_id uuid, p_selected_option_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room_id uuid;
  correct_ids uuid[];
  selected_sorted uuid[];
  is_correct boolean;
  selected_option_id uuid;
begin
  select id into target_room_id
  from rooms
  where public_code = upper(trim(p_code))
    and deleted_at is null
    and expires_at > now()
  limit 1;

  if target_room_id is null then raise exception 'Raum nicht gefunden.'; end if;

  if not exists (select 1 from questions where id = p_question_id and room_id = target_room_id and status = 'approved') then
    raise exception 'Frage nicht gefunden oder nicht freigegeben.';
  end if;

  if p_selected_option_ids is null or array_length(p_selected_option_ids, 1) is null then
    raise exception 'Es wurde keine Antwort ausgewählt.';
  end if;

  select array_agg(id order by id) into correct_ids
  from answer_options
  where question_id = p_question_id and is_correct;

  select array_agg(x order by x) into selected_sorted
  from unnest(p_selected_option_ids) as x
  where exists (select 1 from answer_options where id = x and question_id = p_question_id);

  if selected_sorted is null then raise exception 'Die Antwortauswahl ist ungültig.'; end if;
  is_correct := correct_ids = selected_sorted;

  insert into question_stats (room_id, question_id, total_answers, correct_answers, wrong_answers)
  values (target_room_id, p_question_id, 1, case when is_correct then 1 else 0 end, case when is_correct then 0 else 1 end)
  on conflict (room_id, question_id) do update
  set total_answers = question_stats.total_answers + 1,
      correct_answers = question_stats.correct_answers + excluded.correct_answers,
      wrong_answers = question_stats.wrong_answers + excluded.wrong_answers;

  foreach selected_option_id in array p_selected_option_ids loop
    if exists (select 1 from answer_options where id = selected_option_id and question_id = p_question_id) then
      insert into option_stats (room_id, question_id, option_id, selected_count)
      values (target_room_id, p_question_id, selected_option_id, 1)
      on conflict (room_id, question_id, option_id) do update
      set selected_count = option_stats.selected_count + 1;
    end if;
  end loop;
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
  return deleted_count;
end;
$$;

-- RPC-Funktionen für die öffentliche App freigeben. Tabellen bleiben direkt gesperrt.
grant execute on function fr_create_room(text, text) to anon;
grant execute on function fr_get_room_public(text, text) to anon;
grant execute on function fr_get_room_admin(text) to anon;
grant execute on function fr_add_question(text, text, text, text, jsonb) to anon;
grant execute on function fr_revise_question(text, text, uuid, text, text, jsonb) to anon;
grant execute on function fr_admin_update_room(text, text, text, integer, boolean, boolean) to anon;
grant execute on function fr_admin_update_question(text, uuid, text, text, jsonb, text, text) to anon;
grant execute on function fr_admin_delete_question(text, uuid) to anon;
grant execute on function fr_admin_delete_room(text) to anon;
grant execute on function fr_admin_reset_results(text) to anon;
grant execute on function fr_admin_replace_questions(text, text, jsonb) to anon;
grant execute on function fr_mark_started(text) to anon;
grant execute on function fr_mark_completed(text) to anon;
grant execute on function fr_record_answer(text, uuid, uuid[]) to anon;
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
