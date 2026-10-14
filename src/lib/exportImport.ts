import * as XLSX from 'xlsx';
import type { AnswerOption, ExportBundle, Question, Room } from '../types';
import { newId } from './codes';

const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

type TemplateRow = {
  Frage: string;
  [key: string]: string;
  'Richtige Antworten': string;
  Erklärung: string;
};

export type ParsedQuizImport = {
  title: string;
  questions: Question[];
};

function neutralizeFormulaInjection(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9äöüß-]+/gi, '_');
}


function approvedQuestions(room: Room): Question[] {
  return room.questions.filter((question) => question.status === 'approved');
}

function optionLetter(index: number): string {
  return ANSWER_LETTERS[index] ?? String(index + 1);
}

function flashcardBackText(question: Question): string {
  const correct = question.options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => option.isCorrect)
    .map(({ option, index }) => `${optionLetter(index)}) ${option.text}`)
    .join('\n');

  return [
    'Richtig:',
    correct || 'Keine richtige Antwort markiert.',
    question.explanation ? `\nErklärung:\n${question.explanation}` : '',
  ].filter(Boolean).join('\n');
}

function tsvCell(value: string): string {
  return neutralizeFormulaInjection(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' / ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function downloadFlashcardsTsv(room: Room): void {
  const questions = approvedQuestions(room);
  if (questions.length === 0) {
    window.alert('Es gibt noch keine freigegebenen Fragen für Lernkarten.');
    return;
  }

  const rows = [
    ['Vorderseite', 'Rückseite'],
    ...questions.map((question) => [question.text, flashcardBackText(question)]),
  ];
  const content = rows.map((row) => row.map((cell) => tsvCell(cell)).join('\t')).join('\n');
  const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(room.title)}_fragenraum_lernkarten.tsv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function openPrintableFlashcards(room: Room): void {
  const questions = approvedQuestions(room);
  if (questions.length === 0) {
    window.alert('Es gibt noch keine freigegebenen Fragen für Lernkarten.');
    return;
  }

  const cardHtml = questions.map((question, index) => {
    const back = flashcardBackText(question).split('\n').map(escapeHtml).join('<br />');
    return `
      <article class="card">
        <div class="side front">
          <p class="label">Karte ${index + 1} · Vorderseite</p>
          <h2>${escapeHtml(question.text)}</h2>
        </div>
        <div class="side back">
          <p class="label">Rückseite</p>
          <p>${back}</p>
        </div>
      </article>
    `;
  }).join('');

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Lernkarten – ${escapeHtml(room.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }
  header { margin-bottom: 18px; }
  h1 { margin: 0 0 6px; font-size: 24px; }
  .hint { color: #475569; margin: 0; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .card { border: 1.5px dashed #64748b; border-radius: 12px; min-height: 220px; display: grid; grid-template-columns: 1fr 1fr; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
  .side { padding: 14px; }
  .front { border-right: 1px solid #cbd5e1; background: #f8fafc; }
  .back { background: white; }
  .label { margin: 0 0 8px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  h2 { font-size: 18px; margin: 0; line-height: 1.25; }
  p { line-height: 1.35; }
  .toolbar { margin: 16px 0 22px; }
  button { border: 0; border-radius: 999px; background: #0f172a; color: white; padding: 10px 14px; cursor: pointer; }
  @media print {
    body { margin: 12mm; }
    .toolbar { display: none; }
    .card { min-height: 60mm; }
  }
</style>
</head>
<body>
<header>
  <h1>Lernkarten: ${escapeHtml(room.title)}</h1>
  <p class="hint">Aus freigegebenen Fragen erzeugt. Ausschneiden oder als PDF speichern.</p>
  <div class="toolbar"><button onclick="window.print()">Drucken / als PDF speichern</button></div>
</header>
<section class="grid">${cardHtml}</section>
</body>
</html>`;

  const popup = window.open('', '_blank');
  if (!popup) {
    window.alert('Das Druckfenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.');
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

function templateHeaders(): string[] {
  return [
    'Frage',
    ...ANSWER_LETTERS.map((letter) => `Antwort ${letter}`),
    'Richtige Antworten',
    'Erklärung',
  ];
}

function buildTemplateRows(): TemplateRow[] {
  return [
    {
      Frage: 'Was ist Leasing?',
      'Antwort A': 'Nutzung gegen Entgelt',
      'Antwort B': 'Eigentumserwerb durch Schenkung',
      'Antwort C': 'Kurzfristige Bargeldleihe ohne Vertrag',
      'Antwort D': '',
      'Antwort E': '',
      'Antwort F': '',
      'Antwort G': '',
      'Antwort H': '',
      'Antwort I': '',
      'Antwort J': '',
      'Richtige Antworten': 'A',
      Erklärung: 'Beim Leasing wird ein Gegenstand gegen Entgelt genutzt. Eigentum und Nutzung müssen unterschieden werden.',
    },
    {
      Frage: 'Welche Aussagen passen zu einem Kaufvertrag?',
      'Antwort A': 'Es gibt mindestens zwei Vertragsparteien.',
      'Antwort B': 'Ware und Geldleistung stehen sich gegenüber.',
      'Antwort C': 'Er ist immer kostenlos.',
      'Antwort D': 'Er kann Pflichten für beide Seiten auslösen.',
      'Antwort E': '',
      'Antwort F': '',
      'Antwort G': '',
      'Antwort H': '',
      'Antwort I': '',
      'Antwort J': '',
      'Richtige Antworten': 'A,B,D',
      Erklärung: 'Mehrere richtige Antworten werden mit Komma getrennt angegeben, z. B. A,B,D.',
    },
  ];
}

export function buildExportBundle(room: Room): ExportBundle {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: 'FragenRaum',
    room: {
      title: room.title,
      createdAt: room.createdAt,
      autoApproveQuestions: room.autoApproveQuestions,
      quizMode: room.quizMode,
      practiceEnabled: room.practiceEnabled,
    },
    questions: room.questions.map((question) => ({
      ...question,
      authorToken: undefined,
      text: neutralizeFormulaInjection(question.text),
      explanation: question.explanation ? neutralizeFormulaInjection(question.explanation) : undefined,
      rejectionReason: question.rejectionReason ? neutralizeFormulaInjection(question.rejectionReason) : undefined,
      options: question.options.map((option) => ({
        ...option,
        text: neutralizeFormulaInjection(option.text),
      })),
    })),
    questionStats: room.questionStats,
    optionStats: room.optionStats,
  };
}

export function downloadJson(room: Room): void {
  const bundle = buildExportBundle(room);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(room.title)}_fragenraum_quiz.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadQuizTemplate(): void {
  const workbook = XLSX.utils.book_new();

  const infoSheet = XLSX.utils.json_to_sheet([
    { Hinweis: 'Diese Datei ist die strukturierte FragenRaum-Excel-Vorlage. Der Import ist für versierte Nutzer gedacht und erwartet genau dieses Tabellenblatt "Fragen" mit den vorgegebenen Spalten.' },
    { Hinweis: 'Erlaubt sind 2 bis 10 Antwortoptionen. Leere Antwortspalten werden ignoriert. Richtige Antworten werden als Buchstaben angegeben, z. B. A oder A,C,E.' },
    { Hinweis: 'Beim Import werden keine alten Auswertungen übernommen. Das Quiz startet mit leerer Auswertung neu.' },
    { Hinweis: 'KI-generierte Fragen bitte immer fachlich prüfen, bevor sie im Unterricht verwendet werden.' },
  ]);

  const fragenSheet = XLSX.utils.json_to_sheet(buildTemplateRows(), { header: templateHeaders() });
  XLSX.utils.book_append_sheet(workbook, infoSheet, 'Hinweise');
  XLSX.utils.book_append_sheet(workbook, fragenSheet, 'Fragen');
  XLSX.writeFile(workbook, 'fragenraum_excel_vorlage.xlsx');
}

export function downloadXlsx(room: Room): void {
  const bundle = buildExportBundle(room);
  const workbook = XLSX.utils.book_new();

  const quizSheet = XLSX.utils.json_to_sheet([
    {
      Titel: bundle.room.title,
      Erstellt: bundle.room.createdAt,
      Exportiert: bundle.exportedAt,
      Hinweis: 'Keine Teilnehmerdaten und keine individuellen Antwortverläufe enthalten. Diese Datei ist zur Ansicht/Auswertung gedacht, nicht als stabile Backup-Datei.',
    },
  ]);

  const questionsSheet = XLSX.utils.json_to_sheet(bundle.questions.map((question, index) => ({
    Nr: index + 1,
    question_id: question.id,
    Fragetext: question.text,
    Erklärung: question.explanation ?? '',
    Status: question.status,
    Rückmeldung: question.rejectionReason ?? '',
  })));

  const optionsSheet = XLSX.utils.json_to_sheet(bundle.questions.flatMap((question) =>
    question.options.map((option) => ({
      question_id: question.id,
      option_id: option.id,
      Antworttext: option.text,
      ist_richtig: option.isCorrect ? 'ja' : 'nein',
    })),
  ));

  const resultsSheet = XLSX.utils.json_to_sheet(bundle.questionStats.map((stats) => {
    const question = bundle.questions.find((candidate) => candidate.id === stats.questionId);
    return {
      question_id: stats.questionId,
      Fragetext: question?.text ?? '',
      Antworten_gesamt: stats.totalAnswers,
      Richtig: stats.correctAnswers,
      Falsch: stats.wrongAnswers,
      Fehlerquote: stats.totalAnswers > 0 ? stats.wrongAnswers / stats.totalAnswers : 0,
    };
  }));

  const distributionSheet = XLSX.utils.json_to_sheet(bundle.optionStats.map((stats) => {
    const question = bundle.questions.find((candidate) => candidate.id === stats.questionId);
    const option = question?.options.find((candidate) => candidate.id === stats.optionId);
    return {
      question_id: stats.questionId,
      Fragetext: question?.text ?? '',
      option_id: stats.optionId,
      Antworttext: option?.text ?? '',
      Auswahlhäufigkeit: stats.selectedCount,
    };
  }));

  XLSX.utils.book_append_sheet(workbook, quizSheet, 'Quiz');
  XLSX.utils.book_append_sheet(workbook, questionsSheet, 'Fragen');
  XLSX.utils.book_append_sheet(workbook, optionsSheet, 'Antwortoptionen');
  XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Auswertung');
  XLSX.utils.book_append_sheet(workbook, distributionSheet, 'Antwortverteilung');
  XLSX.writeFile(workbook, `${safeFilename(room.title)}_fragenraum_auswertung.xlsx`);
}

export async function parseJsonFile(file: File): Promise<ParsedQuizImport> {
  const text = await file.text();
  const bundle = JSON.parse(text) as ExportBundle;
  if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.questions)) {
    throw new Error('Diese Datei sieht nicht wie ein gültiger FragenRaum-Export aus.');
  }

  return {
    title: `${bundle.room.title} (Import)`,
    questions: bundle.questions.map((question) => ({
      ...question,
      roomId: '',
      authorToken: undefined,
      status: question.status === 'approved' ? 'approved' : 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  };
}

function parseCorrectLetters(value: string, rowNumber: number): Set<string> {
  const normalized = value.toUpperCase().replace(/UND/g, ',');
  const parts = normalized
    .split(/[;,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`Zeile ${rowNumber}: Es muss mindestens eine richtige Antwort angegeben sein, z. B. A oder A,C.`);
  }

  const letters = new Set<string>();
  for (const part of parts) {
    if (!ANSWER_LETTERS.includes(part as typeof ANSWER_LETTERS[number])) {
      throw new Error(`Zeile ${rowNumber}: "${part}" ist keine gültige richtige Antwort. Erlaubt sind A bis J.`);
    }
    letters.add(part);
  }
  return letters;
}

function importRowsToQuestions(rows: Record<string, unknown>[]): Question[] {
  const questions: Question[] = [];

  rows.forEach((row, rowIndex) => {
    const excelRowNumber = rowIndex + 2;
    const questionText = textValue(row.Frage);
    const explanation = textValue(row.Erklärung);
    const correctLettersRaw = textValue(row['Richtige Antworten']);
    const answerTexts = ANSWER_LETTERS.map((letter) => textValue(row[`Antwort ${letter}`]));
    const hasAnyContent = questionText || explanation || correctLettersRaw || answerTexts.some(Boolean);
    if (!hasAnyContent) return;

    if (questionText.length < 5) throw new Error(`Zeile ${excelRowNumber}: Die Frage ist zu kurz oder fehlt.`);

    const options: AnswerOption[] = [];
    answerTexts.forEach((answerText) => {
      if (!answerText) return;
      options.push({ id: newId(), text: answerText, isCorrect: false });
      if (options.length > MAX_OPTIONS) throw new Error(`Zeile ${excelRowNumber}: Maximal ${MAX_OPTIONS} Antwortoptionen sind erlaubt.`);
    });

    if (options.length < MIN_OPTIONS) throw new Error(`Zeile ${excelRowNumber}: Mindestens ${MIN_OPTIONS} Antwortoptionen sind nötig.`);

    const correctLetters = parseCorrectLetters(correctLettersRaw, excelRowNumber);
    const optionByLetter = new Map<string, AnswerOption>();
    ANSWER_LETTERS.forEach((letter, index) => {
      const answerText = answerTexts[index];
      if (!answerText) return;
      const optionIndex = answerTexts.slice(0, index + 1).filter(Boolean).length - 1;
      optionByLetter.set(letter, options[optionIndex]);
    });

    for (const letter of correctLetters) {
      const option = optionByLetter.get(letter);
      if (!option) throw new Error(`Zeile ${excelRowNumber}: Antwort ${letter} ist als richtig markiert, aber die Antwortspalte ist leer.`);
      option.isCorrect = true;
    }

    questions.push({
      id: newId(),
      roomId: '',
      text: questionText,
      explanation: explanation || undefined,
      status: 'approved',
      authorToken: undefined,
      rejectionReason: undefined,
      options,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  if (questions.length === 0) throw new Error('Die Excel-Datei enthält keine importierbaren Fragen.');
  return questions;
}

export async function parseXlsxFile(file: File): Promise<ParsedQuizImport> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets.Fragen;
  if (!sheet) throw new Error('Die Excel-Datei braucht ein Tabellenblatt namens "Fragen". Bitte die FragenRaum-Vorlage verwenden.');

  const headers = templateHeaders();
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const firstRowKeys = new Set(rows.length > 0 ? Object.keys(rows[0]) : headers);
  for (const header of headers) {
    if (!firstRowKeys.has(header)) throw new Error(`Die Spalte "${header}" fehlt. Bitte die FragenRaum-Vorlage verwenden.`);
  }

  const questions = importRowsToQuestions(rows);
  const baseTitle = file.name.replace(/\.xlsx$/i, '').replace(/[_-]*fragenraum[_-]*/gi, ' ').trim() || 'Excel-Import';
  return { title: `${baseTitle} (Excel-Import)`, questions };
}
