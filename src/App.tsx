import { FormEvent, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import type { AnswerOption, Question, QuizMode, Room } from './types';
import {
  addQuestion,
  adminDeleteQuestion,
  adminDeleteRoom,
  adminResetResults,
  adminReplaceQuestions,
  adminSaveQuestion,
  adminSetQuestionStatus,
  createRoom,
  findRoomByAdminCode,
  findRoomByStudentCode,
  getAdminRoom,
  getAuthorToken,
  getLocalRooms,
  getModeLabel,
  getStudentRoom,
  markQuizCompleted,
  markQuizStarted,
  onlineMode,
  recordAggregatedAnswer,
  reviseRejectedQuestion as saveRejectedRevision,
  updateRoomSettings,
} from './lib/data';
import { downloadFlashcardsTsv, downloadJson, downloadQuizTemplate, downloadXlsx, openPrintableFlashcards, parseJsonFile, parseXlsxFile } from './lib/exportImport';
import { newId } from './lib/codes';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const DEFAULT_OPTIONS = 4;

type QuestionDraft = {
  text: string;
  explanation: string;
  options: AnswerOption[];
};

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/raum/:roomId" element={<StudentRoom />} />
      <Route path="/admin/:roomId" element={<AdminRoom />} />
      <Route path="/play/:roomId" element={<PlayQuiz />} />
      <Route path="/practice/:roomId" element={<PlayQuiz practiceMode />} />
      <Route path="/results/:roomId" element={<Results />} />
      <Route path="/impressum" element={<StaticPage type="impressum" />} />
      <Route path="/datenschutz" element={<StaticPage type="datenschutz" />} />
      <Route path="/ueber" element={<StaticPage type="ueber" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="mb-8 flex flex-col gap-2 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link to="/" className="text-3xl font-bold tracking-tight">FragenRaum</Link>
            <p className="text-sm text-slate-400">Anonymes kollaboratives Classroom-Quiz</p>
          </div>
          <p className="rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200">{getModeLabel()}</p>
        </header>
        {children}
        <footer className="mt-8 border-t border-slate-800 pt-5 text-sm text-slate-400">
          <div className="flex flex-wrap gap-3">
            <Link to="/ueber">Über FragenRaum</Link>
            <Link to="/datenschutz">Datenschutz</Link>
            <Link to="/impressum">Impressum</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}

function createEmptyOptions(count = DEFAULT_OPTIONS): AnswerOption[] {
  return Array.from({ length: count }, (_, index) => ({
    id: newId(),
    text: '',
    isCorrect: index === 0,
  }));
}

function questionToDraft(question?: Question): QuestionDraft {
  if (!question) {
    return {
      text: '',
      explanation: '',
      options: createEmptyOptions(),
    };
  }

  return {
    text: question.text,
    explanation: question.explanation ?? '',
    options: question.options.map((option) => ({ ...option })),
  };
}

function cleanDraft(draft: QuestionDraft): QuestionDraft | undefined {
  const text = draft.text.trim();
  const explanation = draft.explanation.trim();
  const options = draft.options
    .map((option) => ({ ...option, text: option.text.trim() }))
    .filter((option) => option.text.length > 0)
    .slice(0, MAX_OPTIONS);

  if (text.length < 5) return undefined;
  if (options.length < MIN_OPTIONS) return undefined;
  if (!options.some((option) => option.isCorrect)) return undefined;

  return { text, explanation, options };
}

function selectionIsCorrect(question: Question, selectedOptionIds: string[]): boolean {
  const correctIds = question.options.filter((option) => option.isCorrect).map((option) => option.id).sort();
  const selectedIds = [...selectedOptionIds].sort();
  return correctIds.length === selectedIds.length && correctIds.every((id, index) => id === selectedIds[index]);
}

function Home() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState<Room[]>(() => getLocalRooms());

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const room = await createRoom(title);
      setRooms(getLocalRooms());
      navigate(`/admin/${room.adminCode || room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Raum konnte nicht erstellt werden.');
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    const normalized = joinCode.trim().toUpperCase().replace(/\s+/g, '');
    setError('');
    const adminRoom = await findRoomByAdminCode(normalized);
    if (adminRoom) {
      navigate(`/admin/${normalized}`);
      return;
    }
    const studentRoom = await findRoomByStudentCode(normalized);
    if (studentRoom) {
      navigate(`/raum/${studentRoom.studentCode || normalized}`);
      return;
    }
    setError('Kein Raum mit diesem Code gefunden.');
  }

  return (
    <Shell>
      <section className="grid gap-6 md:grid-cols-2">
        <form onSubmit={handleCreate} className="card space-y-4">
          <h2>Neuen Raum erstellen</h2>
          <label>
            Titel/Thema
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="z. B. Zahlungsarten LF8" />
          </label>
          <button className="primary">Raum erstellen</button>
          <p className="hint">Der Raum läuft nach 21 Tagen ab. Im Online-Modus kann die automatische Löschung per Supabase-Cron aktiviert werden.</p>
        </form>

        <form onSubmit={handleJoin} className="card space-y-4">
          <h2>Raum beitreten</h2>
          <label>
            Schülercode oder Admincode
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="z. B. M7QK2" />
          </label>
          <button className="secondary">Code öffnen</button>
          {error && <p className="error">{error}</p>}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <h3>Vorlage</h3>
            <p className="hint">Importe gehören in einen bestehenden Raum. Erstelle erst einen Raum, dann kannst du im Adminbereich Excel- oder JSON-Dateien hochladen und den Fragenstand ersetzen.</p>
            <button className="smallButton" type="button" onClick={downloadQuizTemplate}>Excel-Vorlage herunterladen</button>
          </div>
        </form>
      </section>

      {!onlineMode && rooms.length > 0 && (
        <section className="mt-8 card">
          <h2>Lokale Räume in diesem Browser</h2>
          <div className="mt-4 grid gap-3">
            {rooms.map((room) => (
              <div key={room.id} className="flex flex-col gap-2 rounded-xl border border-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong>{room.title}</strong>
                  <p className="hint">Schülercode: {room.studentCode} · Admincode: {room.adminCode} · Status: {room.status} · Modus: {quizModeLabel(room.quizMode)} · Review: {room.autoApproveQuestions ? 'aus' : 'an'} · Üben: {room.practiceEnabled ? 'frei' : 'gesperrt'}</p>
                </div>
                <div className="flex gap-2">
                  <Link className="smallButton" to={`/raum/${room.studentCode || room.id}`}>Schüler</Link>
                  <Link className="smallButton" to={`/admin/${room.adminCode || room.id}`}>Admin</Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}

function useRoom(roomKey: string | undefined, access: 'student' | 'admin' = 'student') {
  const [room, setRoom] = useState<Room | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!roomKey) {
      setRoom(undefined);
      setLoading(false);
      return;
    }
    try {
      const next = access === 'admin' ? await getAdminRoom(roomKey) : await getStudentRoom(roomKey);
      setRoom(next);
      setError(next ? '' : 'Raum nicht gefunden oder abgelaufen.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Raum konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [roomKey, access]);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, onlineMode ? 1500 : 1000);
    window.addEventListener('storage', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  return { room, refresh, loading, error };
}

function StudentRoom() {
  const { roomId } = useParams();
  const { room, refresh, loading, error } = useRoom(roomId, 'student');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const authorToken = getAuthorToken();
  const navigate = useNavigate();

  useEffect(() => {
    if (room?.status === 'playing') {
      navigate(`/play/${room.studentCode || room.id}`, { replace: true });
    }
  }, [room?.status, room?.id, room?.studentCode, navigate]);

  if (loading) return <Shell><p>Raum wird geladen...</p></Shell>;
  if (!room) return <Shell><p>{error || 'Raum nicht gefunden oder abgelaufen.'}</p></Shell>;

  async function submitQuestion(draft: QuestionDraft) {
    if (!room || !roomId) return;
    const cleaned = cleanDraft(draft);
    if (!cleaned) return;

    await addQuestion(roomId, {
      text: cleaned.text,
      explanation: cleaned.explanation || undefined,
      status: 'draft',
      authorToken,
      options: cleaned.options,
    });
    await refresh();
  }

  async function reviseRejectedQuestion(question: Question, draft: QuestionDraft) {
    if (!room || !roomId || question.authorToken !== authorToken || question.status !== 'rejected') return;
    const cleaned = cleanDraft(draft);
    if (!cleaned) return;

    await saveRejectedRevision(roomId, question.id, authorToken, {
      ...question,
      text: cleaned.text,
      explanation: cleaned.explanation || undefined,
      options: cleaned.options,
      status: room.autoApproveQuestions ? 'approved' : 'draft',
      rejectionReason: undefined,
    });
    setEditingQuestionId(null);
    await refresh();
  }

  const ownQuestions = room.questions.filter((question) => question.authorToken === authorToken);
  const approvedQuestions = room.questions.filter((question) => question.status === 'approved');

  return (
    <Shell>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>{room.title}</h1>
          <p className="hint">Schülercode: {room.studentCode} · Status: {room.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {approvedQuestions.length > 0 && <button className="smallButton" onClick={() => openPrintableFlashcards(room)}>Lernkarten drucken</button>}
          {approvedQuestions.length > 0 && <button className="smallButton" onClick={() => downloadFlashcardsTsv(room)}>Anki/TSV</button>}
          {room.practiceEnabled && approvedQuestions.length > 0 && <Link className="secondaryLink" to={`/practice/${room.studentCode || room.id}`}>Übungsquiz starten</Link>}
          {room.status === 'playing' && <Link className="primaryLink" to={`/play/${room.studentCode || room.id}`}>Zum Quiz</Link>}
        </div>
      </div>

      {room.practiceEnabled && approvedQuestions.length > 0 && room.status !== 'playing' && (
        <section className="card mb-6">
          <h2>Übungsmodus freigeschaltet</h2>
          <p className="hint mt-1">Du kannst das Quiz selbstständig üben. Diese Antworten werden nicht in der Lehrkraft-Auswertung gezählt.</p>
          <Link className="primaryLink mt-3 inline-block" to={`/practice/${room.studentCode || room.id}`}>Jetzt üben</Link>
        </section>
      )}

      {room.status === 'finished' ? (
        <section className="card space-y-4">
          <h2>Quiz beendet</h2>
          <p className="hint">Die Lehrkraft hat den Quizdurchlauf beendet. Wenn wieder „Fragen sammeln“ aktiviert wird, kannst du hier erneut Fragen einreichen.</p>
        </section>
      ) : (
        <section className="card space-y-4">
          <h2>Eigene Frage einreichen</h2>
          <p className="hint">2 bis 10 Antwortoptionen. Es muss mindestens eine richtige Antwort markiert sein.</p>
          <QuestionForm submitLabel={room.autoApproveQuestions ? 'Frage direkt freigeben' : 'Frage einreichen'} onSubmit={submitQuestion} />
        </section>
      )}

      <section className="mt-8 card">
        <h2>Meine eingereichten Fragen</h2>
        {ownQuestions.length === 0 ? <p className="hint">Noch keine eigenen Fragen.</p> : ownQuestions.map((question) => (
          <div key={question.id} className="questionBlock">
            {editingQuestionId === question.id && question.status === 'rejected' ? (
              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3>Frage überarbeiten</h3>
                <QuestionForm
                  initialQuestion={question}
                  submitLabel="Überarbeitung senden"
                  onSubmit={(draft) => reviseRejectedQuestion(question, draft)}
                  onCancel={() => setEditingQuestionId(null)}
                />
              </div>
            ) : (
              <>
                <QuestionCard question={question} />
                {question.status === 'rejected' && (
                  <button className="smallButton mt-3" onClick={() => setEditingQuestionId(question.id)}>überarbeiten</button>
                )}
              </>
            )}
          </div>
        ))}
      </section>
    </Shell>
  );
}

function AdminRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { room, refresh, loading, error } = useRoom(roomId, 'admin');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [revealedPresentationResults, setRevealedPresentationResults] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!room) return;
    const url = `${window.location.origin}/raum/${room.studentCode}`;
    QRCode.toDataURL(url).then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, [room]);

  useEffect(() => {
    if (!room || room.status !== 'playing' || room.quizMode !== 'presenter') return;
    const approved = room.questions.filter((question) => question.status === 'approved');
    const currentQuestion = approved[room.presenterQuestionIndex] ?? approved[0];
    if (!currentQuestion) return;

    const counts = getQuestionCounts(room, currentQuestion);
    if (counts.started > 0 && counts.answered >= counts.started) {
      setRevealedPresentationResults((current) => (
        current[currentQuestion.id] ? current : { ...current, [currentQuestion.id]: true }
      ));
    }
  }, [room]);

  if (loading) return <Shell><p>Raum wird geladen...</p></Shell>;
  if (!room) return <Shell><p>{error || 'Raum nicht gefunden oder abgelaufen.'}</p></Shell>;

  async function changeStatus(status: Room['status']) {
    if (!room || !roomId) return;
    await updateRoomSettings(roomId, { status });
    await refresh();
  }

  async function toggleAutoApprove() {
    if (!room || !roomId) return;
    await updateRoomSettings(roomId, { autoApproveQuestions: !room.autoApproveQuestions });
    await refresh();
  }

  async function togglePracticeEnabled() {
    if (!room || !roomId) return;
    await updateRoomSettings(roomId, { practiceEnabled: !room.practiceEnabled });
    await refresh();
  }

  async function changeQuizMode(quizMode: QuizMode) {
    if (!room || !roomId) return;
    await updateRoomSettings(roomId, { quizMode });
    await refresh();
  }

  async function movePresenterQuestion(direction: -1 | 1) {
    if (!room || !roomId) return;
    const approvedQuestions = room.questions.filter((question) => question.status === 'approved');
    const nextIndex = Math.min(Math.max(room.presenterQuestionIndex + direction, 0), Math.max(approvedQuestions.length - 1, 0));
    await updateRoomSettings(roomId, { presenterQuestionIndex: nextIndex });
    await refresh();
  }

  async function setPresenterIndex(index: number) {
    if (!room || !roomId) return;
    await updateRoomSettings(roomId, { presenterQuestionIndex: index });
    await refresh();
  }

  async function approve(questionId: string) {
    if (!roomId) return;
    await adminSetQuestionStatus(roomId, questionId, 'approved');
    await refresh();
  }

  async function reject(questionId: string) {
    if (!roomId) return;
    const reason = prompt('Warum wird die Frage zurückgegeben? Dieser Kommentar ist für die einreichende Schüler-Session sichtbar.')?.trim();
    if (reason === undefined) return;
    await adminSetQuestionStatus(roomId, questionId, 'rejected', reason || 'Bitte überarbeiten.');
    await refresh();
  }

  async function saveTeacherEdit(question: Question, draft: QuestionDraft) {
    if (!roomId) return;
    const cleaned = cleanDraft(draft);
    if (!cleaned) return;
    await adminSaveQuestion(roomId, question.id, {
      ...question,
      text: cleaned.text,
      explanation: cleaned.explanation || undefined,
      options: cleaned.options,
      rejectionReason: question.status === 'rejected' ? question.rejectionReason : undefined,
    });
    setEditingQuestionId(null);
    await refresh();
  }

  async function remove(questionId: string) {
    if (!roomId) return;
    await adminDeleteQuestion(roomId, questionId);
    await refresh();
  }

  function removeThisRoom() {
    if (!room || !roomId) return;
    if (confirm('Raum wirklich löschen?')) {
      adminDeleteRoom(roomId).then(() => navigate('/')).catch((err) => alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.'));
    }
  }

  async function resetResults() {
    if (!roomId) return;
    if (confirm('Auswertung wirklich zurücksetzen? Fragen und Antwortoptionen bleiben erhalten. Alle Gruppenzähler werden gelöscht, der Quizdurchlauf wird neu gestartet und Schülergeräte können wieder normal antworten.')) {
      await adminResetResults(roomId);
      await refresh();
    }
  }

  async function importJsonFromAdmin(file: File | undefined) {
    if (!file || !roomId) return;
    if (!confirm('Quiz aus JSON importieren? Der aktuelle Fragenstand wird ersetzt und die Auswertung wird zurückgesetzt.')) return;
    try {
      const parsed = await parseJsonFile(file);
      await adminReplaceQuestions(roomId, parsed.title, parsed.questions);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'JSON-Import fehlgeschlagen.');
    }
  }

  async function importExcelFromAdmin(file: File | undefined) {
    if (!file || !roomId) return;
    if (!confirm('Quiz aus Excel importieren? Der aktuelle Fragenstand wird ersetzt und die Auswertung wird zurückgesetzt.')) return;
    try {
      const parsed = await parseXlsxFile(file);
      await adminReplaceQuestions(roomId, parsed.title, parsed.questions);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Excel-Import fehlgeschlagen.');
    }
  }

  const approvedQuestions = room.questions.filter((question) => question.status === 'approved');
  const presenterQuestion = approvedQuestions[room.presenterQuestionIndex] ?? approvedQuestions[0];
  const presentationResultsVisible = presenterQuestion ? Boolean(revealedPresentationResults[presenterQuestion.id]) : false;
  const canGoToNextPresentationQuestion = room.presenterQuestionIndex < approvedQuestions.length - 1;

  function revealCurrentPresentationResults() {
    if (!presenterQuestion) return;
    setRevealedPresentationResults((current) => ({ ...current, [presenterQuestion.id]: true }));
  }

  async function goToNextPresentationQuestion() {
    if (!room || !roomId) return;
    if (!canGoToNextPresentationQuestion) {
      await changeStatus('finished');
      return;
    }
    await updateRoomSettings(roomId, { presenterQuestionIndex: room.presenterQuestionIndex + 1 });
    await refresh();
  }

  return (
    <Shell>
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <section className="card space-y-4">
          <h1>{room.title}</h1>
          <p className="hint">Status: {room.status} · Modus: {quizModeLabel(room.quizMode)} · Ablauf: {new Date(room.expiresAt).toLocaleDateString('de-DE')} · Review: {room.autoApproveQuestions ? 'aus, neue Fragen werden direkt freigegeben' : 'an, neue Fragen landen im Review'} · Üben: {room.practiceEnabled ? 'freigeschaltet' : 'gesperrt'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <CodeBox label="Schülercode" value={room.studentCode} />
            <CodeBox label="Admincode" value={room.adminCode} />
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2>Quizmodus</h2>
            <p className="hint mt-1">Normal = alle bearbeiten selbstständig. Präsentation = Lehrkraft zeigt Frage, Schüler sehen nur Antworten.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={room.quizMode === 'selfPaced' ? 'primary' : 'smallButton'} onClick={() => changeQuizMode('selfPaced')}>Normaler Quizmodus</button>
              <button className={room.quizMode === 'presenter' ? 'primary' : 'smallButton'} onClick={() => changeQuizMode('presenter')}>Präsentationsmodus</button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2>Übungsmodus zuhause</h2>
            <p className="hint mt-1">Wenn freigeschaltet, können Schülerinnen und Schüler das freigegebene Quiz selbstständig üben. Diese Übungsantworten zählen nicht in die Auswertung.</p>
            <button className={room.practiceEnabled ? 'primary mt-3' : 'smallButton mt-3'} onClick={togglePracticeEnabled}>
              {room.practiceEnabled ? 'Übungsmodus sperren' : 'Übungsmodus freischalten'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="smallButton" onClick={() => changeStatus('building')}>Fragen sammeln</button>
            <button className="smallButton" onClick={() => changeStatus('review')}>Review</button>
            <button className="smallButton" onClick={() => changeStatus('playing')}>Quiz starten</button>
            <button className="smallButton" onClick={() => changeStatus('finished')}>Quiz beenden</button>
            <Link className="smallButton" to={`/results/${room.adminCode || room.id}`}>Auswertung</Link>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2>Teilnahmefortschritt</h2>
            <p className="hint mt-1">Begonnen: {room.startedCount} · vollständig abgeschlossen: {room.completedCount}</p>
            <p className="hint">Das sind nur Gruppenzähler. Es wird nicht gespeichert, wer begonnen oder abgeschlossen hat.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary" onClick={toggleAutoApprove}>{room.autoApproveQuestions ? 'Reviewpflicht einschalten' : 'Auto-Freigabe einschalten'}</button>
            <button className="secondary" onClick={() => downloadXlsx(room)}>Auswertung als Excel</button>
            <button className="secondary" onClick={() => openPrintableFlashcards(room)}>Lernkarten drucken</button>
            <button className="secondary" onClick={() => downloadFlashcardsTsv(room)}>Anki/TSV-Lernkarten</button>
            <button className="secondary" onClick={() => downloadJson(room)}>Quiz als JSON sichern</button>
            <button className="secondary" onClick={downloadQuizTemplate}>Excel-Vorlage</button>
            <button className="secondary" onClick={resetResults}>Auswertung zurücksetzen</button>
            <button className="danger" onClick={removeThisRoom}>Raum löschen</button>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2>Quiz importieren</h2>
            <p className="hint mt-1">Excel-Import ist für versierte Nutzer gedacht und funktioniert nur mit der FragenRaum-Vorlage. Beim Import wird der aktuelle Fragenstand ersetzt, die Auswertung startet leer und der Raum springt zurück zum Fragensammeln.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="fileButton">
                Quiz aus Excel importieren
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => importExcelFromAdmin(event.target.files?.[0])} />
              </label>
              <label className="fileButton">
                Quiz aus JSON wiederherstellen
                <input type="file" accept=".json,application/json" onChange={(event) => importJsonFromAdmin(event.target.files?.[0])} />
              </label>
            </div>
          </div>
          <p className="hint">Auto-Freigabe ist praktisch für kleine Gruppen, aber didaktisch riskanter: schlechte oder Quatschfragen kommen sofort ins Quiz.</p>
        </section>

        <aside className="card text-center">
          <h2>QR-Code</h2>
          {qrDataUrl ? <img className="mx-auto rounded-xl bg-white p-2" src={qrDataUrl} alt="QR-Code zum Schülerraum" /> : <p className="hint">QR-Code wird erzeugt...</p>}
          <p className="hint mt-3">Im echten Deployment zeigt dieser QR-Code auf die öffentliche App-Adresse.</p>
        </aside>
      </div>

      {room.status === 'playing' && room.quizMode === 'presenter' && (
        <section className="mt-8 card presentationPanel">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2>Präsentationssteuerung</h2>
              <p className="hint">Diese Frage wird groß an der Lehrkraftseite angezeigt. Schüler sehen im Präsentationsmodus nur die Antwortoptionen.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="smallButton" disabled={room.presenterQuestionIndex <= 0} onClick={() => movePresenterQuestion(-1)}>zurück</button>
              <button className="smallButton" disabled={room.presenterQuestionIndex >= approvedQuestions.length - 1} onClick={() => movePresenterQuestion(1)}>weiter</button>
            </div>
          </div>
          {presenterQuestion ? (
            <div className="bigQuestion">
              <p className="hint">Frage {room.presenterQuestionIndex + 1} von {approvedQuestions.length}</p>
              <h1>{presenterQuestion.text}</h1>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {presenterQuestion.options.map((option, index) => (
                  <div key={option.id} className="presentationOption">
                    <strong>{letterForIndex(index)}</strong> {option.text}
                  </div>
                ))}
              </div>
              <QuestionParticipationStatus room={room} question={presenterQuestion} />
              <div className="mt-4 flex flex-wrap gap-2">
                {!presentationResultsVisible ? (
                  <button className="primary" onClick={revealCurrentPresentationResults}>
                    Auswertung anzeigen
                  </button>
                ) : (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setRevealedPresentationResults((current) => ({ ...current, [presenterQuestion.id]: false }))}
                    >
                      Auswertung ausblenden
                    </button>
                    <button className="primary" onClick={goToNextPresentationQuestion}>
                      {canGoToNextPresentationQuestion ? 'Weiter zur nächsten Frage' : 'Quiz beenden'}
                    </button>
                  </>
                )}
              </div>
              {presentationResultsVisible && (
                <>
                  <QuestionOutcomeSummary room={room} question={presenterQuestion} />
                  <QuestionDistribution room={room} question={presenterQuestion} variant="presentation" showCorrectAnswers />
                </>
              )}
            </div>
          ) : <p className="hint">Noch keine freigegebenen Fragen.</p>}
          {approvedQuestions.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {approvedQuestions.map((question, index) => (
                <button key={question.id} className={index === room.presenterQuestionIndex ? 'primary' : 'smallButton'} onClick={() => setPresenterIndex(index)}>F{index + 1}</button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mt-8 card">
        <h2>Fragen moderieren</h2>
        {room.questions.length === 0 ? <p className="hint">Noch keine Fragen eingereicht.</p> : room.questions.map((question) => (
          <div key={question.id} className="questionBlock">
            {editingQuestionId === question.id ? (
              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3>Frage bearbeiten</h3>
                  <span className={`status status-${question.status}`}>{statusLabel(question.status)}</span>
                </div>
                <QuestionForm
                  initialQuestion={question}
                  submitLabel="Änderungen speichern"
                  onSubmit={(draft) => saveTeacherEdit(question, draft)}
                  onCancel={() => setEditingQuestionId(null)}
                />
              </div>
            ) : (
              <>
                <QuestionCard question={question} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="smallButton" onClick={() => approve(question.id)}>freigeben</button>
                  <button className="smallButton" onClick={() => setEditingQuestionId(question.id)}>bearbeiten</button>
                  <button className="smallButton" onClick={() => reject(question.id)}>zurückgeben</button>
                  <button className="dangerSmall" onClick={() => remove(question.id)}>löschen</button>
                </div>
              </>
            )}
          </div>
        ))}
      </section>
    </Shell>
  );
}

function QuestionForm({
  initialQuestion,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialQuestion?: Question;
  submitLabel: string;
  onSubmit: (draft: QuestionDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(() => questionToDraft(initialQuestion));
  const cleaned = cleanDraft(draft);

  function updateOption(optionId: string, updater: (option: AnswerOption) => AnswerOption) {
    setDraft((current) => ({
      ...current,
      options: current.options.map((option) => (option.id === optionId ? updater(option) : option)),
    }));
  }

  function addOption() {
    setDraft((current) => {
      if (current.options.length >= MAX_OPTIONS) return current;
      return { ...current, options: [...current.options, { id: newId(), text: '', isCorrect: false }] };
    });
  }

  function removeOption(optionId: string) {
    setDraft((current) => {
      if (current.options.length <= MIN_OPTIONS) return current;
      const options = current.options.filter((option) => option.id !== optionId);
      if (!options.some((option) => option.isCorrect) && options[0]) {
        options[0] = { ...options[0], isCorrect: true };
      }
      return { ...current, options };
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const valid = cleanDraft(draft);
    if (!valid) return;
    onSubmit(valid);
    if (!initialQuestion) {
      setDraft(questionToDraft());
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label>
        Frage
        <textarea value={draft.text} onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))} placeholder="Formuliere eine gute Multiple-Choice-Frage." />
      </label>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>Antwortoptionen</strong>
          <span className="hint">{draft.options.length}/{MAX_OPTIONS}</span>
        </div>
        {draft.options.map((option, index) => (
          <div key={option.id} className="optionRow">
            <input
              className="flex-1"
              value={option.text}
              onChange={(event) => updateOption(option.id, (candidate) => ({ ...candidate, text: event.target.value }))}
              placeholder={`Antwort ${index + 1}`}
            />
            <label className="inlineCheck">
              <input
                type="checkbox"
                checked={option.isCorrect}
                onChange={(event) => updateOption(option.id, (candidate) => ({ ...candidate, isCorrect: event.target.checked }))}
              />
              richtig
            </label>
            <button className="dangerSmall" type="button" disabled={draft.options.length <= MIN_OPTIONS} onClick={() => removeOption(option.id)}>löschen</button>
          </div>
        ))}
        <button className="smallButton" type="button" disabled={draft.options.length >= MAX_OPTIONS} onClick={addOption}>Antwortoption hinzufügen</button>
      </div>
      <label>
        Erklärung optional
        <textarea value={draft.explanation} onChange={(event) => setDraft((current) => ({ ...current, explanation: event.target.value }))} placeholder="Warum ist die richtige Antwort richtig?" />
      </label>
      {!cleaned && <p className="error">Mindestens 5 Zeichen Frage, 2 Antwortoptionen und mindestens eine richtige Antwort nötig.</p>}
      <div className="flex flex-wrap gap-2">
        <button className="primary" disabled={!cleaned}>{submitLabel}</button>
        {onCancel && <button className="secondary" type="button" onClick={onCancel}>abbrechen</button>}
      </div>
    </form>
  );
}

function PlayQuiz({ practiceMode = false }: { practiceMode?: boolean }) {
  const { roomId } = useParams();
  const { room, refresh, loading, error } = useRoom(roomId, 'student');
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string[]>>({});
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [singleQuestionView, setSingleQuestionView] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [practiceFeedback, setPracticeFeedback] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  useEffect(() => {
    setSelectedByQuestion({});
    setAnswered({});
    setPracticeFeedback({});
    setCurrentIndex(0);
  }, [room?.quizRound]);

  useEffect(() => {
    if (roomId && room?.status === 'playing' && !practiceMode) void markQuizStarted(roomId, practiceMode, room.quizRound);
  }, [roomId, practiceMode, room?.status, room?.quizRound]);

  useEffect(() => {
    if (!room || practiceMode) return;
    if (room.status !== 'playing') {
      navigate(`/raum/${room.studentCode || room.id}`, { replace: true });
    }
  }, [room, practiceMode, navigate]);

  if (loading) return <Shell><p>Raum wird geladen...</p></Shell>;
  if (!room) return <Shell><p>{error || 'Raum nicht gefunden oder abgelaufen.'}</p></Shell>;
  if (practiceMode && !room.practiceEnabled) {
    return (
      <Shell>
        <section className="card">
          <h1>Übungsmodus nicht freigeschaltet</h1>
          <p className="hint mt-1">Die Lehrkraft hat das selbstständige Üben für diesen Raum noch nicht aktiviert.</p>
          <Link className="smallButton mt-3 inline-block" to={`/raum/${room.studentCode || room.id}`}>Zurück zum Raum</Link>
        </section>
      </Shell>
    );
  }

  const questions = room.questions.filter((question) => question.status === 'approved');
  const effectiveQuizMode: QuizMode = practiceMode ? 'selfPaced' : room.quizMode;
  const presenterIndex = Math.min(room.presenterQuestionIndex, Math.max(questions.length - 1, 0));
  const visibleQuestions = effectiveQuizMode === 'presenter'
    ? questions.slice(presenterIndex, presenterIndex + 1)
    : singleQuestionView
      ? questions.slice(currentIndex, currentIndex + 1)
      : questions;
  const answeredCount = questions.filter((question) => answered[question.id]).length;
  const allDone = questions.length > 0 && answeredCount === questions.length;

  function toggle(questionId: string, optionId: string) {
    setSelectedByQuestion((current) => {
      const selected = current[questionId] ?? [];
      const next = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId];
      return { ...current, [questionId]: next };
    });
  }

  async function submit(question: Question) {
    const selected = selectedByQuestion[question.id] ?? [];
    if (selected.length === 0 || answered[question.id]) return;

    if (practiceMode) {
      setPracticeFeedback((current) => ({ ...current, [question.id]: selectionIsCorrect(question, selected) }));
    } else {
      try {
        await recordAggregatedAnswer(roomId || room.studentCode || room.id, question.id, selected, practiceMode, room.quizRound);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Antwort konnte nicht gezählt werden.');
        return;
      }
    }

    const nextAnswered = { ...answered, [question.id]: true };
    setAnswered(nextAnswered);
    if (!practiceMode && questions.length > 0 && questions.every((candidate) => nextAnswered[candidate.id])) {
      void markQuizCompleted(roomId || room.studentCode || room.id, practiceMode, room.quizRound);
    }
    await refresh();
  }

  async function finishManually() {
    await markQuizCompleted(roomId || room.studentCode || room.id, practiceMode, room.quizRound);
    await refresh();
  }

  function nextQuestion() {
    setCurrentIndex((value) => Math.min(value + 1, Math.max(questions.length - 1, 0)));
  }

  function previousQuestion() {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>{room.title}: {practiceMode ? 'Übungsquiz' : 'Quiz'}</h1>
          <p className="hint">Modus: {practiceMode ? 'selbstständiges Üben ohne Wertung' : quizModeLabel(room.quizMode)} · beantwortet: {answeredCount}/{questions.length}</p>
        </div>
        {effectiveQuizMode === 'selfPaced' && (
          <div className="flex flex-wrap gap-2">
            <button className={singleQuestionView ? 'primary' : 'smallButton'} onClick={() => setSingleQuestionView(true)}>Einzelfrage groß</button>
            <button className={!singleQuestionView ? 'primary' : 'smallButton'} onClick={() => setSingleQuestionView(false)}>Alle Fragen</button>
          </div>
        )}
      </div>

      {effectiveQuizMode === 'presenter' && (
        <section className="card mb-6">
          <h2>Präsentationsmodus</h2>
          <p className="hint mt-1">Die Lehrkraft zeigt die Frage vorne. Hier siehst du nur die Antwortoptionen zur aktuellen Frage.</p>
        </section>
      )}

      <div className="space-y-4">
        {questions.length === 0 ? <p className="hint">Noch keine freigegebenen Fragen.</p> : visibleQuestions.map((question) => {
          const realIndex = questions.findIndex((candidate) => candidate.id === question.id);
          return (
            <div key={question.id} className={singleQuestionView || effectiveQuizMode === 'presenter' ? 'card space-y-3 quizSingleCard' : 'card space-y-3'}>
              {effectiveQuizMode === 'selfPaced' ? (
                <h2>{realIndex + 1}. {question.text}</h2>
              ) : (
                <h2>Antworten zu Frage {realIndex + 1}</h2>
              )}
              {question.options.map((option, optionIndex) => (
                <label key={option.id} className="answerOption bigAnswerOption">
                  <input
                    type="checkbox"
                    checked={(selectedByQuestion[question.id] ?? []).includes(option.id)}
                    disabled={answered[question.id]}
                    onChange={() => toggle(question.id, option.id)}
                  />
                  <span><strong>{letterForIndex(optionIndex)}</strong> {option.text}</span>
                </label>
              ))}
              {practiceMode && answered[question.id] && (
                <div className={practiceFeedback[question.id] ? 'successBox' : 'warningBox'}>
                  <strong>{practiceFeedback[question.id] ? 'Richtig.' : 'Noch nicht richtig.'}</strong>
                  {question.explanation ? <span> {question.explanation}</span> : null}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className="primary" disabled={answered[question.id]} onClick={() => submit(question)}>
                  {answered[question.id] ? (practiceMode ? 'Antwort geprüft' : 'Antwort gezählt') : 'Antwort abgeben'}
                </button>
                {effectiveQuizMode === 'selfPaced' && singleQuestionView && (
                  <>
                    <button className="smallButton" disabled={currentIndex <= 0} onClick={previousQuestion}>zurück</button>
                    <button className="smallButton" disabled={currentIndex >= questions.length - 1} onClick={nextQuestion}>weiter</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {allDone ? (
        <section className="mt-8 card">
          <h2>Fertig</h2>
          <p className="hint">{practiceMode ? 'Deine Übungsantworten wurden nicht in der Lehrkraft-Auswertung gezählt.' : 'Deine Antworten wurden nur als Teil des Gruppenergebnisses gezählt.'}</p>
        </section>
      ) : questions.length > 0 && !practiceMode && (
        <section className="mt-8 card">
          <h2>Abschluss</h2>
          <p className="hint">Wenn du alle Fragen bearbeitet hast, wird der Abschluss automatisch gezählt. Falls die Lehrkraft früher beendet, kannst du hier manuell abschließen.</p>
          <button className="secondary mt-3" onClick={finishManually}>Quiz für mich abschließen</button>
        </section>
      )}
    </Shell>
  );
}


function getQuestionCounts(room: Room, question: Question) {
  const stats = room.questionStats.find((candidate) => candidate.questionId === question.id);
  const answered = stats?.totalAnswers ?? 0;
  const correct = stats?.correctAnswers ?? 0;
  const wrong = stats?.wrongAnswers ?? 0;
  const started = room.startedCount ?? 0;
  const completed = room.completedCount ?? 0;
  const notAnswered = Math.max(started - answered, 0);
  const percent = started > 0 ? Math.round((answered / started) * 100) : 0;
  const correctPercent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const wrongPercent = answered > 0 ? Math.round((wrong / answered) * 100) : 0;
  return { answered, correct, wrong, started, completed, notAnswered, percent, correctPercent, wrongPercent };
}

function QuestionParticipationStatus({ room, question }: { room: Room; question: Question }) {
  const counts = getQuestionCounts(room, question);

  return (
    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">geantwortet</p>
          <p className="mt-1 text-2xl font-bold">{counts.answered}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">begonnen</p>
          <p className="mt-1 text-2xl font-bold">{counts.started}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">nicht geantwortet</p>
          <p className="mt-1 text-2xl font-bold">{counts.notAnswered}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Abgabequote</p>
          <p className="mt-1 text-2xl font-bold">{counts.percent}%</p>
        </div>
      </div>
      <p className="hint mt-3">„Nicht geantwortet“ bedeutet hier: Quiz auf einem Schülergerät begonnen, aber für diese Frage noch keine Antwort gezählt. Vollständig abgeschlossen: {counts.completed}. Es wird nicht gespeichert, wer geantwortet hat.</p>
    </div>
  );
}

function QuestionOutcomeSummary({ room, question }: { room: Room; question: Question }) {
  const counts = getQuestionCounts(room, question);

  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <h3>Auswertung dieser Frage</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">richtig</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{counts.correct}</p>
          <p className="hint">{counts.correctPercent}% der Antworten</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">falsch</p>
          <p className="mt-1 text-2xl font-bold text-rose-300">{counts.wrong}</p>
          <p className="hint">{counts.wrongPercent}% der Antworten</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">nicht geantwortet</p>
          <p className="mt-1 text-2xl font-bold text-amber-200">{counts.notAnswered}</p>
          <p className="hint">bezogen auf gestartete Schülergeräte</p>
        </div>
      </div>
    </div>
  );
}

function QuestionDistribution({ room, question, variant = 'normal', showCorrectAnswers = true }: { room: Room; question: Question; variant?: 'normal' | 'presentation'; showCorrectAnswers?: boolean }) {
  const stats = room.questionStats.find((candidate) => candidate.questionId === question.id);
  const total = stats?.totalAnswers ?? 0;

  return (
    <div className={variant === 'presentation' ? 'liveDistribution mt-4' : 'mt-4 space-y-2'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>{variant === 'presentation' ? 'Live-Antwortverteilung' : 'Antwortverteilung'}</h3>
        <p className="hint">{total} gezählte Antwort{total === 1 ? '' : 'en'}</p>
      </div>
      {question.options.map((option) => {
        const optionCount = room.optionStats.find((candidate) => candidate.optionId === option.id)?.selectedCount ?? 0;
        const percent = total > 0 ? Math.round((optionCount / total) * 100) : 0;
        return (
          <div key={option.id} className={variant === 'presentation' ? 'distributionRow bigDistributionRow' : 'distributionRow'}>
            <div className="flex justify-between gap-4">
              <span>{option.text} {showCorrectAnswers && option.isCorrect ? <span className="text-emerald-300">(richtig)</span> : null}</span>
              <strong>{optionCount} · {percent}%</strong>
            </div>
            <div className="distributionBar" aria-hidden="true">
              <div style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Results() {
  const { roomId } = useParams();
  const { room, refresh, loading, error } = useRoom(roomId, 'admin');

  if (loading) return <Shell><p>Raum wird geladen...</p></Shell>;
  if (!room) return <Shell><p>{error || 'Raum nicht gefunden oder abgelaufen.'}</p></Shell>;
  const approvedQuestions = room.questions.filter((question) => question.status === 'approved');

  async function resetResults() {
    if (!roomId) return;
    if (confirm('Auswertung wirklich zurücksetzen? Fragen und Antwortoptionen bleiben erhalten. Alle Gruppenzähler werden gelöscht, der Quizdurchlauf wird neu gestartet und Schülergeräte können wieder normal antworten.')) {
      await adminResetResults(roomId);
      await refresh();
    }
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1>Auswertung</h1>
          <p className="hint">Nur Klassen-/Gruppenergebnis, keine Teilnehmendenliste.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="smallButton" to={`/admin/${room.adminCode || room.id}`}>Zurück zum Admin-Dashboard</Link>
          <button className="secondary" onClick={() => downloadXlsx(room)}>Auswertung als Excel</button>
          <button className="secondary" onClick={() => openPrintableFlashcards(room)}>Lernkarten drucken</button>
          <button className="secondary" onClick={() => downloadFlashcardsTsv(room)}>Anki/TSV-Lernkarten</button>
          <button className="secondary" onClick={() => downloadJson(room)}>Quiz als JSON sichern</button>
          <button className="secondary" onClick={resetResults}>Auswertung zurücksetzen</button>
        </div>
      </div>

      <div className="space-y-4">
        {approvedQuestions.map((question) => {
          const counts = getQuestionCounts(room, question);
          const errorRate = counts.answered > 0 ? Math.round((counts.wrong / counts.answered) * 100) : 0;
          return (
            <section key={question.id} className="card">
              <h2>{question.text}</h2>
              <p className="hint">Antworten: {counts.answered} · richtig: {counts.correct} · falsch: {counts.wrong} · nicht geantwortet: {counts.notAnswered} · Fehlerquote: {errorRate}%</p>
              <QuestionDistribution room={room} question={question} />
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function QuestionCard({ question }: { question: Question }) {
  return (
    <article className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>{question.text}</h3>
        <span className={`status status-${question.status}`}>{statusLabel(question.status)}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {question.options.map((option) => (
          <li key={option.id} className={option.isCorrect ? 'text-emerald-300' : 'text-slate-300'}>
            {option.isCorrect ? '✓ ' : '• '}{option.text}
          </li>
        ))}
      </ul>
      {question.explanation && <p className="hint mt-3">Erklärung: {question.explanation}</p>}
      {question.status === 'rejected' && question.rejectionReason && (
        <p className="warningBox mt-3"><strong>Rückmeldung:</strong> {question.rejectionReason}</p>
      )}
    </article>
  );
}

function quizModeLabel(mode: QuizMode): string {
  return mode === 'presenter' ? 'Präsentationsquiz' : 'normaler Quizmodus';
}

function letterForIndex(index: number): string {
  return String.fromCharCode(65 + index);
}

function statusLabel(status: Question['status']): string {
  if (status === 'draft') return 'im Review';
  if (status === 'approved') return 'freigegeben';
  return 'zurückgegeben';
}

function CodeBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold">{value}</p>
    </div>
  );
}

function StaticPage({ type }: { type: 'impressum' | 'datenschutz' | 'ueber' }) {
  const titles = {
    impressum: 'Impressum',
    datenschutz: 'Datenschutz',
    ueber: 'Über FragenRaum',
  };

  return (
    <Shell>
      <section className="card space-y-4">
        <h1>{titles[type]}</h1>
        {type === 'ueber' && (
          <>
            <p>
              <strong>FragenRaum</strong> ist ein datensparsames Unterrichtswerkzeug zum gemeinsamen Erstellen,
              Moderieren und Auswerten von Multiple-Choice-Fragen. Die Anwendung ist nicht als Klausur-,
              Prüfungs- oder Bewertungswerkzeug gedacht, sondern für formative Lernstandsdiagnose im Unterricht.
            </p>

            <h2>Kurzanleitung für Lehrkräfte</h2>
            <ol>
              <li>Auf der Startseite einen neuen Raum erstellen.</li>
              <li>Den Schülercode oder QR-Code mit der Lerngruppe teilen.</li>
              <li>Schülerinnen und Schüler Fragen mit Antwortoptionen erstellen lassen.</li>
              <li>Die eingereichten Fragen im Adminbereich prüfen, bearbeiten, freigeben, zurückgeben oder löschen.</li>
              <li>Das Quiz im normalen Modus oder im Präsentationsmodus starten.</li>
              <li>Nach dem Quiz die aggregierte Auswertung ansehen oder als Excel-Datei herunterladen.</li>
              <li>Aus freigegebenen Fragen bei Bedarf Lernkarten drucken oder als Anki/TSV-Datei herunterladen.</li>
            </ol>

            <h2>Kurzanleitung für Schülerinnen und Schüler</h2>
            <ol>
              <li>Raumcode eingeben oder QR-Code scannen.</li>
              <li>Optional einen Alias oder Vornamen eintragen.</li>
              <li>Eine eigene Frage mit 2 bis 10 Antwortoptionen erstellen.</li>
              <li>Mindestens eine richtige Antwort markieren.</li>
              <li>Falls die Frage zurückgegeben wird, den Hinweis der Lehrkraft lesen und die Frage überarbeiten.</li>
              <li>Nach dem Start des Quiz die freigegebenen Fragen beantworten.</li>
            </ol>

            <h2>Die wichtigsten Modi</h2>
            <h3>Fragen sammeln</h3>
            <p>In diesem Modus erstellt die Lerngruppe gemeinsam Fragen. Die Lehrkraft kann entscheiden, ob neue Fragen zuerst geprüft werden müssen oder automatisch freigegeben werden.</p>

            <h3>Normaler Quizmodus</h3>
            <p>Die Schülerinnen und Schüler bearbeiten das Quiz selbstständig auf ihren Geräten. Die Lehrkraft sieht eine aggregierte Auswertung der Gruppe.</p>

            <h3>Präsentationsmodus</h3>
            <p>Die Lehrkraft zeigt die Frage vorne. Die Schülerinnen und Schüler sehen auf ihren Geräten nur die Antwortoptionen. Nach der Auflösung werden richtige, falsche und nicht abgegebene Antworten aggregiert angezeigt.</p>

            <h3>Übungsmodus zuhause</h3>
            <p>Wenn die Lehrkraft den Übungsmodus freischaltet, können Schülerinnen und Schüler das Quiz später selbstständig zum Üben starten. Diese Übungsantworten werden nicht in die Lehrkraft-Auswertung übernommen.</p>

            <h2>Export und Import</h2>
            <ul>
              <li><strong>JSON:</strong> zuverlässige Sicherung und spätere Wiederherstellung eines Quiz.</li>
              <li><strong>Excel-Auswertung:</strong> Ansicht, Sortierung und Archivierung aggregierter Ergebnisse.</li>
              <li><strong>Excel-Vorlage:</strong> kann von versierten Nutzerinnen und Nutzern oder mit Hilfe einer KI befüllt und importiert werden.</li>
              <li><strong>Lernkarten:</strong> freigegebene Fragen können als Druckansicht oder Anki/TSV-Datei exportiert werden.</li>
            </ul>

            <h2>Datensparsame Grundidee</h2>
            <p>FragenRaum benötigt keine Schülerkonten, keine E-Mail-Adressen und keine Klarnamen. Die Auswertung erfolgt auf Gruppenebene. Es wird nicht angezeigt, welche einzelne Person welche Antwort gegeben hat.</p>

            <h2>Grenzen</h2>
            <p>FragenRaum ersetzt kein Lernmanagementsystem, kein Klausurtool und kein benotbares Diagnosesystem. Die Stärke liegt im schnellen gemeinsamen Fragenbauen, im Unterrichtsgespräch und in der Sichtbarmachung typischer Fehler der Lerngruppe.</p>
          </>
        )}
        {type === 'datenschutz' && (
          <>
            <p>
              Diese Datenschutzerklärung informiert darüber, welche Daten bei der Nutzung von FragenRaum verarbeitet werden.
              FragenRaum ist ein datensparsames Unterrichtswerkzeug zum gemeinsamen Erstellen, Moderieren und Auswerten von Multiple-Choice-Fragen.
              Ziel ist formative Lernstandsdiagnose auf Gruppenebene, nicht die Leistungsbewertung einzelner Schülerinnen und Schüler.
            </p>

            <h2>1. Verantwortlicher</h2>
            <p>
              Christopher Duwe / ChrijsForge<br />
              Homannring 11<br />
              21037 Hamburg<br />
              Deutschland<br />
              E-Mail: chris.duwe@gmx.net
            </p>

            <h2>2. Zweck der Verarbeitung</h2>
            <p>Die Verarbeitung erfolgt, um digitale Quizräume bereitzustellen, Fragen und Antwortoptionen zu speichern, Quizdurchläufe im Unterricht zu ermöglichen und aggregierte Auswertungen auf Ebene der Lerngruppe anzuzeigen.</p>

            <h2>3. Welche Daten verarbeitet werden</h2>
            <ul>
              <li>Raumtitel und Raumcode</li>
              <li>Admin-Code beziehungsweise Admin-Link</li>
              <li>eingereichte Fragen</li>
              <li>Antwortoptionen und Markierung richtiger Antworten</li>
              <li>optionale Erklärungstexte und Rückmeldungen zu Fragen</li>
              <li>aggregierte Antwortzahlen pro Frage und Antwortoption</li>
              <li>technische Kennungen zur Begrenzung von Mehrfachantworten und Missbrauch</li>
              <li>technische Zugriffsdaten, die beim Abruf der Website und der Datenbankdienste entstehen können</li>
            </ul>

            <h2>4. Welche Daten nicht vorgesehen sind</h2>
            <ul>
              <li>keine Schülerkonten</li>
              <li>keine E-Mail-Adressen von Schülerinnen und Schülern</li>
              <li>keine Klarnamenpflicht</li>
              <li>keine individuellen Punktzahlen</li>
              <li>keine individuellen Antwortverläufe für die Lehrkraft</li>
              <li>kein Einsatz als Klausur-, Prüfungs- oder Bewertungswerkzeug</li>
            </ul>

            <h2>5. Aliasnamen und lokale Browserdaten</h2>
            <p>Schülerinnen und Schüler können einen Alias oder Vornamen verwenden. Die Nutzung eines echten Namens ist nicht erforderlich. Für technische Funktionen können im Browser lokale Kennungen gespeichert werden, zum Beispiel um eigene zurückgegebene Fragen bearbeiten zu können, Mehrfachantworten im selben Quizdurchlauf zu begrenzen oder lokale Übungsstände zu merken.</p>

            <h2>6. Auswertung</h2>
            <p>Die Auswertung erfolgt grundsätzlich aggregiert. Angezeigt wird zum Beispiel, wie oft eine Frage beantwortet wurde, wie viele Antworten richtig oder falsch waren und welche Antwortoptionen wie häufig gewählt wurden. Es wird nicht angezeigt, welche einzelne Person eine bestimmte Antwort gegeben hat.</p>

            <h2>7. Speicherdauer und Löschung</h2>
            <p>Quizräume sind auf eine Speicherdauer von 21 Tagen angelegt. Danach sollen Räume samt Fragen, Antwortoptionen und Auswertungen gelöscht werden. Lehrkräfte können Räume außerdem vorher manuell löschen. Exportierte Dateien liegen nach dem Download in der Verantwortung der herunterladenden Person.</p>

            <h2>8. Export und Import</h2>
            <p>FragenRaum ermöglicht den Export von Quizdaten, Auswertungen und Lernkarten. JSON-Dateien dienen der späteren Wiederherstellung eines Quiz. Excel-Dateien dienen der Ansicht, Bearbeitung durch versierte Nutzerinnen und Nutzer sowie der Auswertung. Beim Reimport werden keine individuellen Antwortverläufe übernommen; Auswertungen können zurückgesetzt werden.</p>

            <h2>9. Dienstleister</h2>
            <p>Die technische Bereitstellung erfolgt über Cloudflare. Die Weboberfläche wird über Cloudflare Workers Static Assets ausgeliefert. Die Datenbank wird über Supabase betrieben. In Supabase werden die Quizräume, Fragen, Antwortoptionen und aggregierten Auswertungen gespeichert.</p>
            <p>Die verwendete Supabase-Projektregion ist in den Projekteinstellungen des Supabase-Projekts hinterlegt.</p>

            <h2>10. Rechtsgrundlage</h2>
            <p>Die Verarbeitung erfolgt, soweit personenbezogene Daten betroffen sind, auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO zur Bereitstellung eines datensparsamen Unterrichtswerkzeugs und zur technischen Sicherung des Dienstes. Beim Einsatz im schulischen Kontext ist die jeweils verantwortliche Lehrkraft beziehungsweise Schule für die rechtmäßige Nutzung im Unterricht mitverantwortlich.</p>

            <h2>11. Betroffenenrechte</h2>
            <p>Betroffene Personen haben nach Maßgabe der DSGVO insbesondere Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Widerspruch sowie Beschwerde bei einer Datenschutzaufsichtsbehörde. Anfragen können an die oben angegebene E-Mail-Adresse gerichtet werden.</p>

            <h2>12. Kontakt</h2>
            <p>Bei Fragen zum Datenschutz oder zur Löschung eines Raumes: chris.duwe@gmx.net</p>
          </>
        )}
        {type === 'impressum' && (
          <>
            <p>
              Christopher Duwe<br />
              ChrijsForge<br />
              Homannring 11<br />
              21037 Hamburg<br />
              Deutschland<br />
              E-Mail: chris.duwe@gmx.net
            </p>
          </>
        )}
      </section>
    </Shell>
  );
}

export default App;
