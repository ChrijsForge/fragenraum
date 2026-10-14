-- FragenRaum Patch v10: nach schema.sql v9 in Supabase ausführen
-- Zweck: pgcrypto sicher ansprechen, Quiz-Durchlauf zurücksetzbar machen,
-- Import in bestehenden Raum ermöglichen.

create extension if not exists pgcrypto with schema extensions;

alter table rooms add column if not exists quiz_round integer not null default 1;

create or replace function fr_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(upper(coalesce(p_token, '')), 'sha256'::text),
    'hex'
  );
$$;

create or replace function fr_random_code(p_len integer)
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

grant execute on function fr_admin_replace_questions(text, text, jsonb) to anon;
