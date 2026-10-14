import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AnswerOption, Question, QuizMode, Room, RoomStatus } from '../types';
import { randomCode } from './codes';
import * as local from './storage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const onlineMode = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | undefined;
function supabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase ist nicht konfiguriert.');
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

function assertRpc<T>(data: T | null, error: unknown): T {
  if (error) {
    const message = typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : 'Supabase-Fehler';
    throw new Error(message);
  }
  if (!data) throw new Error('Keine Daten erhalten.');
  return data;
}

function normalizeRoom(value: unknown, adminToken?: string): Room {
  const raw = value as Room;
  return {
    ...raw,
    adminCode: adminToken ?? raw.adminCode ?? '',
    quizMode: raw.quizMode ?? 'selfPaced',
    presenterQuestionIndex: raw.presenterQuestionIndex ?? 0,
    autoApproveQuestions: raw.autoApproveQuestions ?? false,
    practiceEnabled: raw.practiceEnabled ?? false,
    quizRound: raw.quizRound ?? 1,
    startedCount: raw.startedCount ?? 0,
    completedCount: raw.completedCount ?? 0,
    questions: raw.questions ?? [],
    questionStats: raw.questionStats ?? [],
    optionStats: raw.optionStats ?? [],
  };
}

function toRpcOptions(options: AnswerOption[]) {
  return options.map((option) => ({
    option_text: option.text,
    is_correct: option.isCorrect,
  }));
}

const ONLINE_PROGRESS_KEY = 'frageraum.onlineProgress.v1';
const CLIENT_ID_KEY = 'frageraum.clientId.v1';

export function getClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing && existing.length >= 12) return existing;
  const created = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : randomCode(32);
  localStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}

type OnlineProgress = Record<string, { started: boolean; completed: boolean; answeredQuestionIds: string[] }>;

function progressKey(roomKey: string, roomRound?: number): string {
  return `${roomKey.trim().toUpperCase()}:${roomRound ?? 1}`;
}

function loadOnlineProgress(): OnlineProgress {
  try { return JSON.parse(localStorage.getItem(ONLINE_PROGRESS_KEY) || '{}') as OnlineProgress; } catch { return {}; }
}

function saveOnlineProgress(progress: OnlineProgress): void {
  localStorage.setItem(ONLINE_PROGRESS_KEY, JSON.stringify(progress));
}

function markOnlineAnswered(roomKey: string, roomRound: number | undefined, questionId: string): boolean {
  const key = progressKey(roomKey, roomRound);
  const progress = loadOnlineProgress();
  const current = progress[key] ?? { started: false, completed: false, answeredQuestionIds: [] };
  if (current.answeredQuestionIds.includes(questionId)) return false;
  progress[key] = { ...current, started: true, answeredQuestionIds: [...current.answeredQuestionIds, questionId] };
  saveOnlineProgress(progress);
  return true;
}

function getOnlineProgress(roomKey: string, roomRound?: number) {
  return loadOnlineProgress()[progressKey(roomKey, roomRound)] ?? { started: false, completed: false, answeredQuestionIds: [] };
}

function markOnlineStarted(roomKey: string, roomRound?: number): boolean {
  const key = progressKey(roomKey, roomRound);
  const progress = loadOnlineProgress();
  const current = progress[key] ?? { started: false, completed: false, answeredQuestionIds: [] };
  if (current.started) return false;
  progress[key] = { ...current, started: true };
  saveOnlineProgress(progress);
  return true;
}

function markOnlineCompleted(roomKey: string, roomRound?: number): boolean {
  const key = progressKey(roomKey, roomRound);
  const progress = loadOnlineProgress();
  const current = progress[key] ?? { started: false, completed: false, answeredQuestionIds: [] };
  if (current.completed) return false;
  progress[key] = { ...current, started: true, completed: true };
  saveOnlineProgress(progress);
  return true;
}

function toRpcQuestions(questions: Question[]) {
  return questions.map((question) => ({
    question_text: question.text,
    explanation: question.explanation ?? null,
    status: question.status === 'approved' ? 'approved' : 'draft',
    options: toRpcOptions(question.options),
  }));
}

export function getAuthorToken(): string {
  return local.getAuthorToken();
}

export function getLocalRooms(): Room[] {
  return onlineMode ? [] : local.loadRooms();
}

export function getModeLabel(): string {
  return onlineMode ? 'Online-Modus mit Supabase' : 'Lokaler Demo-Modus: Daten liegen nur in diesem Browser';
}

export async function createRoom(title: string): Promise<Room> {
  if (!onlineMode) return local.createRoom(title);
  const adminToken = randomCode(16);
  const { data, error } = await supabase().rpc('fr_create_room', {
    p_title: title,
    p_admin_token: adminToken,
    p_client_id: getClientId(),
  });
  return normalizeRoom(assertRpc(data, error), adminToken);
}

export async function findRoomByStudentCode(codeOrId: string): Promise<Room | undefined> {
  if (!onlineMode) return local.findRoomByStudentCode(codeOrId) ?? local.findRoomById(codeOrId);
  const { data, error } = await supabase().rpc('fr_get_room_public', {
    p_code: codeOrId.trim().toUpperCase(),
    p_author_token: getAuthorToken(),
  });
  if (error || !data) return undefined;
  return normalizeRoom(data);
}

export async function findRoomByAdminCode(adminTokenOrId: string): Promise<Room | undefined> {
  if (!onlineMode) return local.findRoomByAdminCode(adminTokenOrId) ?? local.findRoomById(adminTokenOrId);
  const { data, error } = await supabase().rpc('fr_get_room_admin', {
    p_admin_token: adminTokenOrId.trim().toUpperCase(),
  });
  if (error || !data) return undefined;
  return normalizeRoom(data, adminTokenOrId.trim().toUpperCase());
}

export async function getStudentRoom(roomKey: string): Promise<Room | undefined> {
  return findRoomByStudentCode(roomKey);
}

export async function getAdminRoom(adminKey: string): Promise<Room | undefined> {
  return findRoomByAdminCode(adminKey);
}

export async function addQuestion(roomKey: string, question: Omit<Question, 'id' | 'roomId' | 'createdAt' | 'updatedAt'>): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByStudentCode(roomKey) ?? local.findRoomById(roomKey);
    if (!room) return undefined;
    local.addQuestion(room.id, question);
    return local.findRoomById(room.id);
  }
  const { data, error } = await supabase().rpc('fr_add_question', {
    p_code: roomKey.trim().toUpperCase(),
    p_author_token: question.authorToken ?? getAuthorToken(),
    p_question_text: question.text,
    p_explanation: question.explanation ?? null,
    p_options: toRpcOptions(question.options),
    p_client_id: getClientId(),
  });
  return normalizeRoom(assertRpc(data, error));
}

export async function reviseRejectedQuestion(roomKey: string, questionId: string, authorToken: string, question: Question): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByStudentCode(roomKey) ?? local.findRoomById(roomKey);
    if (!room) return undefined;
    local.updateQuestion(room.id, questionId, () => question);
    return local.findRoomById(room.id);
  }
  const { data, error } = await supabase().rpc('fr_revise_question', {
    p_code: roomKey.trim().toUpperCase(),
    p_author_token: authorToken,
    p_question_id: questionId,
    p_question_text: question.text,
    p_explanation: question.explanation ?? null,
    p_options: toRpcOptions(question.options),
    p_client_id: getClientId(),
  });
  return normalizeRoom(assertRpc(data, error));
}

export async function updateRoomSettings(adminKey: string, patch: Partial<Pick<Room, 'status' | 'quizMode' | 'presenterQuestionIndex' | 'autoApproveQuestions' | 'practiceEnabled'>>): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByAdminCode(adminKey) ?? local.findRoomById(adminKey);
    if (!room) return undefined;
    let next = local.findRoomById(room.id);
    if (patch.status) next = local.setRoomStatus(room.id, patch.status);
    if (patch.quizMode) next = local.setQuizMode(room.id, patch.quizMode);
    if (typeof patch.presenterQuestionIndex === 'number') next = local.setPresenterQuestionIndex(room.id, patch.presenterQuestionIndex);
    if (typeof patch.autoApproveQuestions === 'boolean') next = local.setAutoApproveQuestions(room.id, patch.autoApproveQuestions);
    if (typeof patch.practiceEnabled === 'boolean') next = local.setPracticeEnabled(room.id, patch.practiceEnabled);
    return next;
  }
  const { data, error } = await supabase().rpc('fr_admin_update_room', {
    p_admin_token: adminKey.trim().toUpperCase(),
    p_status: patch.status ?? null,
    p_quiz_mode: patch.quizMode ?? null,
    p_presenter_question_index: typeof patch.presenterQuestionIndex === 'number' ? patch.presenterQuestionIndex : null,
    p_auto_approve_questions: typeof patch.autoApproveQuestions === 'boolean' ? patch.autoApproveQuestions : null,
    p_practice_enabled: typeof patch.practiceEnabled === 'boolean' ? patch.practiceEnabled : null,
  });
  return normalizeRoom(assertRpc(data, error), adminKey.trim().toUpperCase());
}

export async function adminSaveQuestion(adminKey: string, questionId: string, question: Question): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByAdminCode(adminKey) ?? local.findRoomById(adminKey);
    if (!room) return undefined;
    local.updateQuestion(room.id, questionId, () => question);
    return local.findRoomById(room.id);
  }
  const { data, error } = await supabase().rpc('fr_admin_update_question', {
    p_admin_token: adminKey.trim().toUpperCase(),
    p_question_id: questionId,
    p_question_text: question.text,
    p_explanation: question.explanation ?? null,
    p_options: toRpcOptions(question.options),
    p_status: question.status,
    p_rejection_reason: question.rejectionReason ?? null,
  });
  return normalizeRoom(assertRpc(data, error), adminKey.trim().toUpperCase());
}

export async function adminSetQuestionStatus(adminKey: string, questionId: string, status: 'approved' | 'rejected', rejectionReason?: string): Promise<Room | undefined> {
  const room = await getAdminRoom(adminKey);
  const question = room?.questions.find((candidate) => candidate.id === questionId);
  if (!question) return room;
  return adminSaveQuestion(adminKey, questionId, {
    ...question,
    status,
    rejectionReason: status === 'rejected' ? (rejectionReason || 'Bitte überarbeiten.') : undefined,
  });
}

export async function adminDeleteQuestion(adminKey: string, questionId: string): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByAdminCode(adminKey) ?? local.findRoomById(adminKey);
    if (!room) return undefined;
    local.removeQuestion(room.id, questionId);
    return local.findRoomById(room.id);
  }
  const { data, error } = await supabase().rpc('fr_admin_delete_question', {
    p_admin_token: adminKey.trim().toUpperCase(),
    p_question_id: questionId,
  });
  return normalizeRoom(assertRpc(data, error), adminKey.trim().toUpperCase());
}

export async function adminDeleteRoom(adminKey: string): Promise<void> {
  if (!onlineMode) {
    const room = local.findRoomByAdminCode(adminKey) ?? local.findRoomById(adminKey);
    if (room) local.deleteRoom(room.id);
    return;
  }
  const { error } = await supabase().rpc('fr_admin_delete_room', { p_admin_token: adminKey.trim().toUpperCase() });
  if (error) throw new Error(error.message);
}

export async function adminResetResults(adminKey: string): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByAdminCode(adminKey) ?? local.findRoomById(adminKey);
    if (!room) return undefined;
    local.resetRoomResults(room.id);
    return local.findRoomById(room.id);
  }
  const { data, error } = await supabase().rpc('fr_admin_reset_results', { p_admin_token: adminKey.trim().toUpperCase() });
  return normalizeRoom(assertRpc(data, error), adminKey.trim().toUpperCase());
}

export function getRoomQuizProgress(roomKey: string, roomRound?: number) {
  if (onlineMode) return getOnlineProgress(roomKey, roomRound);
  const room = local.findRoomByStudentCode(roomKey) ?? local.findRoomById(roomKey);
  return room ? local.getRoomQuizProgress(room.id) : { started: false, completed: false, answeredQuestionIds: [] };
}

export async function markQuizStarted(roomKey: string, practiceMode: boolean, roomRound?: number): Promise<void> {
  if (practiceMode) return;
  if (!onlineMode) {
    const room = local.findRoomByStudentCode(roomKey) ?? local.findRoomById(roomKey);
    if (!room) return;
    const progress = local.getRoomQuizProgress(room.id);
    if (progress.started) return;
    local.markQuizStarted(room.id);
    return;
  }
  const progress = getRoomQuizProgress(roomKey, roomRound);
  if (progress.started) return;
  if (!markOnlineStarted(roomKey, roomRound)) return;
  const { error } = await supabase().rpc('fr_mark_started', { p_code: roomKey.trim().toUpperCase(), p_client_id: getClientId() });
  if (error) console.warn(error.message);
}

export async function markQuizCompleted(roomKey: string, practiceMode: boolean, roomRound?: number): Promise<void> {
  if (practiceMode) return;
  if (!onlineMode) {
    const room = local.findRoomByStudentCode(roomKey) ?? local.findRoomById(roomKey);
    if (!room) return;
    const progress = local.getRoomQuizProgress(room.id);
    if (progress.completed) return;
    local.markQuizCompleted(room.id);
    return;
  }
  const progress = getRoomQuizProgress(roomKey, roomRound);
  if (progress.completed) return;
  if (!markOnlineCompleted(roomKey, roomRound)) return;
  const { error } = await supabase().rpc('fr_mark_completed', { p_code: roomKey.trim().toUpperCase(), p_client_id: getClientId() });
  if (error) console.warn(error.message);
}

export async function recordAggregatedAnswer(roomKey: string, questionId: string, selectedOptionIds: string[], practiceMode: boolean, roomRound?: number): Promise<void> {
  if (practiceMode) return;
  if (!onlineMode) {
    const room = local.findRoomByStudentCode(roomKey) ?? local.findRoomById(roomKey);
    if (room) local.recordAggregatedAnswer(room.id, questionId, selectedOptionIds);
    return;
  }
  const progress = getRoomQuizProgress(roomKey, roomRound);
  if (progress.answeredQuestionIds.includes(questionId)) return;
  const { error } = await supabase().rpc('fr_record_answer', {
    p_code: roomKey.trim().toUpperCase(),
    p_question_id: questionId,
    p_selected_option_ids: selectedOptionIds,
    p_client_id: getClientId(),
  });
  if (error) throw new Error(error.message);
  markOnlineAnswered(roomKey, roomRound, questionId);
}


export async function adminReplaceQuestions(adminKey: string, title: string, questions: Question[]): Promise<Room | undefined> {
  if (!onlineMode) {
    const room = local.findRoomByAdminCode(adminKey) ?? local.findRoomById(adminKey);
    if (!room) return undefined;
    return local.updateRoom(room.id, (current) => ({
      ...current,
      title: title.trim() || current.title,
      status: 'building' as RoomStatus,
      presenterQuestionIndex: 0,
      quizRound: (current.quizRound ?? 1) + 1,
      startedCount: 0,
      completedCount: 0,
      questions: questions.map((question) => ({ ...question, roomId: current.id, authorToken: undefined, status: question.status === 'approved' ? 'approved' : 'draft' })),
      questionStats: [],
      optionStats: [],
    }));
  }
  const { data, error } = await supabase().rpc('fr_admin_replace_questions', {
    p_admin_token: adminKey.trim().toUpperCase(),
    p_title: title.trim() || null,
    p_questions: toRpcQuestions(questions),
  });
  return normalizeRoom(assertRpc(data, error), adminKey.trim().toUpperCase());
}

export async function importQuizFromQuestions(title: string, questions: Question[]): Promise<Room> {
  const room = await createRoom(title);
  if (!onlineMode) {
    const imported = local.updateRoom(room.id, (current) => ({
      ...current,
      title,
      status: 'building' as RoomStatus,
      presenterQuestionIndex: 0,
      startedCount: 0,
      completedCount: 0,
      questions: questions.map((question) => ({ ...question, roomId: current.id, authorToken: undefined, status: question.status === 'approved' ? 'approved' : 'draft' })),
      questionStats: [],
      optionStats: [],
    }));
    if (!imported) throw new Error('Import fehlgeschlagen.');
    return imported;
  }
  const { data, error } = await supabase().rpc('fr_admin_replace_questions', {
    p_admin_token: room.adminCode,
    p_questions: toRpcQuestions(questions),
  });
  return normalizeRoom(assertRpc(data, error), room.adminCode);
}
