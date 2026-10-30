// Types et appels de l'API d'import (voir server/src/exam-import/examImportRouter.ts).

export interface Choice { text: string; correct: boolean }
export interface Question { question: string; multiple: boolean; choices: Choice[] }
export interface Quiz { title: string; passingScore: number; questions: Question[] }
export interface ApiError { path: string; message: string }
export interface ExamSummary { examId: number; title: string; threshold: number; questionCount: number; resultCount?: number }
export interface Lesson { lessonId: number; title: string; module: string; exam: ExamSummary | null }

export type PreviewResult =
  | { ok: true; quiz: Quiz; existing: ExamSummary | null }
  | { ok: false; errors: ApiError[] };

export type SaveResult =
  | { ok: true; examId: number; questionCount: number; replacedQuestions: number }
  | { ok: false; errors: ApiError[] };

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return { ok: false, errors: [{ path: '', message: `Réponse inattendue du serveur (${res.status}).` }] } as T;
  }
}

export async function fetchLessons(): Promise<Lesson[]> {
  const res = await fetch('/api/lessons');
  if (!res.ok) throw new Error(`Impossible de charger les leçons (${res.status}).`);
  return res.json();
}

function examForm(file: File, title: string, threshold: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('title', title);
  form.append('threshold', threshold);
  return form;
}

export async function previewExam(lessonId: number, file: File, title: string, threshold: string) {
  const res = await fetch(`/api/lessons/${lessonId}/exam/preview`, { method: 'POST', body: examForm(file, title, threshold) });
  return readJson<PreviewResult>(res);
}

export async function saveExam(lessonId: number, file: File, title: string, threshold: string) {
  const res = await fetch(`/api/lessons/${lessonId}/exam`, { method: 'POST', body: examForm(file, title, threshold) });
  return readJson<SaveResult>(res);
}
