export type RoomStatus = 'building' | 'review' | 'playing' | 'finished';
export type QuestionStatus = 'draft' | 'approved' | 'rejected';
export type QuizMode = 'selfPaced' | 'presenter';

export type AnswerOption = {
  id: string;
  text: string;
  isCorrect: boolean;
};

export type Question = {
  id: string;
  roomId: string;
  text: string;
  explanation?: string;
  status: QuestionStatus;
  rejectionReason?: string;
  authorToken?: string;
  options: AnswerOption[];
  createdAt: string;
  updatedAt: string;
};

export type QuestionStats = {
  questionId: string;
  totalAnswers: number;
  correctAnswers: number;
  wrongAnswers: number;
};

export type OptionStats = {
  questionId: string;
  optionId: string;
  selectedCount: number;
};

export type Room = {
  id: string;
  title: string;
  studentCode: string;
  adminCode: string;
  status: RoomStatus;
  quizMode: QuizMode;
  presenterQuestionIndex: number;
  autoApproveQuestions: boolean;
  practiceEnabled: boolean;
  quizRound: number;
  startedCount: number;
  completedCount: number;
  createdAt: string;
  expiresAt: string;
  questions: Question[];
  questionStats: QuestionStats[];
  optionStats: OptionStats[];
};

export type ExportBundle = {
  schemaVersion: 1;
  exportedAt: string;
  app: 'FragenRaum' | 'FrageRaum' | 'FrageRaum Starter';
  room: Pick<Room, 'title' | 'createdAt'> & { autoApproveQuestions?: boolean; quizMode?: QuizMode; practiceEnabled?: boolean };
  questions: Question[];
  questionStats: QuestionStats[];
  optionStats: OptionStats[];
};
