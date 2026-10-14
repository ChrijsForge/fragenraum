import type { OptionStats, Question, QuestionStats, QuizMode, Room, RoomStatus } from '../types';
import { daysFromNow, newId, randomCode } from './codes';

const STORAGE_KEY = 'frageraum.rooms.v1';
const AUTHOR_KEY = 'frageraum.authorToken.v1';
const QUIZ_PROGRESS_KEY = 'frageraum.quizProgress.v1';

type QuizProgress = Record<string, {
  started: boolean;
  completed: boolean;
  answeredQuestionIds: string[];
}>;

export function getAuthorToken(): string {
  const existing = localStorage.getItem(AUTHOR_KEY);
  if (existing) return existing;
  const created = newId();
  localStorage.setItem(AUTHOR_KEY, created);
  return created;
}

function loadQuizProgress(): QuizProgress {
  const raw = localStorage.getItem(QUIZ_PROGRESS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as QuizProgress;
  } catch {
    return {};
  }
}

function saveQuizProgress(progress: QuizProgress): void {
  localStorage.setItem(QUIZ_PROGRESS_KEY, JSON.stringify(progress));
}

export function getRoomQuizProgress(roomId: string) {
  const room = findRoomById(roomId);
  const key = room ? `${roomId}:${room.quizRound ?? 1}` : roomId;
  const progress = loadQuizProgress()[key];
  return progress ?? { started: false, completed: false, answeredQuestionIds: [] };
}

export function markQuizStarted(roomId: string): void {
  const room = findRoomById(roomId);
  const key = room ? `${roomId}:${room.quizRound ?? 1}` : roomId;
  const progress = loadQuizProgress();
  const current = progress[key] ?? { started: false, completed: false, answeredQuestionIds: [] };
  if (current.started) return;
  progress[key] = { ...current, started: true };
  saveQuizProgress(progress);
  updateRoom(roomId, (room) => ({ ...room, startedCount: (room.startedCount ?? 0) + 1 }));
}

export function markQuizCompleted(roomId: string): void {
  const room = findRoomById(roomId);
  const key = room ? `${roomId}:${room.quizRound ?? 1}` : roomId;
  const progress = loadQuizProgress();
  const current = progress[key] ?? { started: false, completed: false, answeredQuestionIds: [] };
  if (current.completed) return;
  progress[key] = { ...current, started: true, completed: true };
  saveQuizProgress(progress);
  updateRoom(roomId, (room) => ({
    ...room,
    startedCount: current.started ? (room.startedCount ?? 0) : (room.startedCount ?? 0) + 1,
    completedCount: (room.completedCount ?? 0) + 1,
  }));
}

function markQuestionAnsweredLocally(roomId: string, questionId: string): boolean {
  const room = findRoomById(roomId);
  const key = room ? `${roomId}:${room.quizRound ?? 1}` : roomId;
  const progress = loadQuizProgress();
  const current = progress[key] ?? { started: false, completed: false, answeredQuestionIds: [] };
  if (current.answeredQuestionIds.includes(questionId)) return false;
  progress[key] = {
    ...current,
    started: true,
    answeredQuestionIds: [...current.answeredQuestionIds, questionId],
  };
  saveQuizProgress(progress);
  return true;
}

function normalizeRoom(room: Room): Room {
  return {
    ...room,
    quizMode: room.quizMode ?? 'selfPaced',
    presenterQuestionIndex: room.presenterQuestionIndex ?? 0,
    autoApproveQuestions: room.autoApproveQuestions ?? false,
    practiceEnabled: room.practiceEnabled ?? false,
    quizRound: room.quizRound ?? 1,
    startedCount: room.startedCount ?? 0,
    completedCount: room.completedCount ?? 0,
    questions: (room.questions ?? []).map((question) => ({
      ...question,
      rejectionReason: question.rejectionReason,
      options: question.options ?? [],
    })),
    questionStats: room.questionStats ?? [],
    optionStats: room.optionStats ?? [],
  };
}

export function loadRooms(): Room[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Room[];
    const now = Date.now();
    const active = parsed.map(normalizeRoom).filter((room) => new Date(room.expiresAt).getTime() > now);
    if (active.length !== parsed.length) saveRooms(active);
    return active;
  } catch {
    return [];
  }
}

export function saveRooms(rooms: Room[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

export function createRoom(title: string): Room {
  const room: Room = {
    id: newId(),
    title: title.trim() || 'Neuer Quizraum',
    studentCode: randomCode(5),
    // Absichtlich unabhängig vom Schülercode. Sonst wäre der Admin-Zugang ableitbar.
    adminCode: randomCode(12),
    status: 'building',
    quizMode: 'selfPaced',
    presenterQuestionIndex: 0,
    autoApproveQuestions: false,
    practiceEnabled: false,
    quizRound: 1,
    startedCount: 0,
    completedCount: 0,
    createdAt: new Date().toISOString(),
    expiresAt: daysFromNow(21),
    questions: [],
    questionStats: [],
    optionStats: [],
  };
  saveRooms([...loadRooms(), room]);
  return room;
}

export function findRoomByStudentCode(code: string): Room | undefined {
  return loadRooms().find((room) => room.studentCode.toUpperCase() === code.toUpperCase());
}

export function findRoomByAdminCode(code: string): Room | undefined {
  return loadRooms().find((room) => room.adminCode.toUpperCase() === code.toUpperCase());
}

export function findRoomById(roomId: string): Room | undefined {
  return loadRooms().find((room) => room.id === roomId);
}

export function updateRoom(roomId: string, updater: (room: Room) => Room): Room | undefined {
  const rooms = loadRooms();
  const next = rooms.map((room) => (room.id === roomId ? updater(room) : room));
  saveRooms(next);
  return next.find((room) => room.id === roomId);
}

export function setRoomStatus(roomId: string, status: RoomStatus): Room | undefined {
  return updateRoom(roomId, (room) => ({
    ...room,
    status,
    presenterQuestionIndex: status === 'playing' ? room.presenterQuestionIndex : 0,
  }));
}

export function setQuizMode(roomId: string, quizMode: QuizMode): Room | undefined {
  return updateRoom(roomId, (room) => ({ ...room, quizMode, presenterQuestionIndex: 0 }));
}

export function setPresenterQuestionIndex(roomId: string, index: number): Room | undefined {
  return updateRoom(roomId, (room) => ({ ...room, presenterQuestionIndex: Math.max(0, index) }));
}

export function setAutoApproveQuestions(roomId: string, enabled: boolean): Room | undefined {
  return updateRoom(roomId, (room) => ({ ...room, autoApproveQuestions: enabled }));
}

export function setPracticeEnabled(roomId: string, enabled: boolean): Room | undefined {
  return updateRoom(roomId, (room) => ({ ...room, practiceEnabled: enabled }));
}

export function deleteRoom(roomId: string): void {
  saveRooms(loadRooms().filter((room) => room.id !== roomId));
}

export function resetRoomResults(roomId: string): void {
  updateRoom(roomId, (room) => ({
    ...room,
    quizRound: (room.quizRound ?? 1) + 1,
    status: 'building',
    presenterQuestionIndex: 0,
    startedCount: 0,
    completedCount: 0,
    questionStats: [],
    optionStats: [],
  }));
}

export function addQuestion(roomId: string, question: Omit<Question, 'id' | 'roomId' | 'createdAt' | 'updatedAt'>): Question | undefined {
  const room = findRoomById(roomId);
  if (!room) return undefined;
  const fullQuestion: Question = {
    ...question,
    id: newId(),
    roomId,
    status: room.autoApproveQuestions ? 'approved' : question.status,
    rejectionReason: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  updateRoom(roomId, (current) => ({ ...current, questions: [...current.questions, fullQuestion] }));
  return fullQuestion;
}

export function updateQuestion(roomId: string, questionId: string, updater: (question: Question) => Question): void {
  updateRoom(roomId, (room) => ({
    ...room,
    questions: room.questions.map((question) =>
      question.id === questionId ? { ...updater(question), updatedAt: new Date().toISOString() } : question,
    ),
  }));
}

export function removeQuestion(roomId: string, questionId: string): void {
  updateRoom(roomId, (room) => ({
    ...room,
    questions: room.questions.filter((question) => question.id !== questionId),
    questionStats: room.questionStats.filter((stats) => stats.questionId !== questionId),
    optionStats: room.optionStats.filter((stats) => stats.questionId !== questionId),
  }));
}

export function recordAggregatedAnswer(roomId: string, questionId: string, selectedOptionIds: string[]): void {
  const shouldCount = markQuestionAnsweredLocally(roomId, questionId);
  if (!shouldCount) return;

  updateRoom(roomId, (room) => {
    const question = room.questions.find((candidate) => candidate.id === questionId);
    if (!question) return room;

    const correctIds = question.options.filter((option) => option.isCorrect).map((option) => option.id).sort();
    const selectedIds = [...selectedOptionIds].sort();
    const isCorrect = correctIds.length === selectedIds.length && correctIds.every((id, index) => id === selectedIds[index]);

    const existingQuestionStats = room.questionStats.find((stats) => stats.questionId === questionId);
    const nextQuestionStats: QuestionStats = {
      questionId,
      totalAnswers: (existingQuestionStats?.totalAnswers ?? 0) + 1,
      correctAnswers: (existingQuestionStats?.correctAnswers ?? 0) + (isCorrect ? 1 : 0),
      wrongAnswers: (existingQuestionStats?.wrongAnswers ?? 0) + (isCorrect ? 0 : 1),
    };

    const questionStats = [
      ...room.questionStats.filter((stats) => stats.questionId !== questionId),
      nextQuestionStats,
    ];

    const optionStats: OptionStats[] = [...room.optionStats];
    for (const optionId of selectedOptionIds) {
      const index = optionStats.findIndex((stats) => stats.questionId === questionId && stats.optionId === optionId);
      if (index >= 0) {
        optionStats[index] = { ...optionStats[index], selectedCount: optionStats[index].selectedCount + 1 };
      } else {
        optionStats.push({ questionId, optionId, selectedCount: 1 });
      }
    }

    return { ...room, questionStats, optionStats };
  });
}
