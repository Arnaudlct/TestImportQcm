// Import d'un examen dans la base Corelab (tables exams, mcq_questions, mcq_choices).
// prepareExam vérifie le fichier et le formulaire sans toucher à la base (aperçu) ;
// saveExam écrit l'examen en une seule transaction (confirmation).

import { CHOICE_COLUMNS, decodeText, parseQuizCsv, type Question, type ValidationError } from './parseQuizCsv';

export const MAX_TITLE_LENGTH = 200; // exams.exam_title est un varchar(200)

// Le strict nécessaire d'un client `pg` (PoolClient) : un vrai client ou un faux en test.
export interface DbClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

// Champs du formulaire d'import, tels qu'ils arrivent d'un formulaire multipart (des textes).
export interface ExamForm {
  title?: string;
  threshold?: string | number;
}

export interface PreparedExam {
  title: string;
  threshold: number;
  questions: Question[];
}

export type PrepareResult = { ok: true; quiz: PreparedExam } | { ok: false; errors: ValidationError[] };

// Vérifie le formulaire (titre, seuil) et le fichier CSV, et renvoie toutes les erreurs d'un coup.
export function prepareExam(bytes: Uint8Array, form: ExamForm): PrepareResult {
  const errors: ValidationError[] = [];

  const title = String(form.title ?? '').trim();
  if (title === '') errors.push({ path: 'titre', message: "Le titre de l'examen est obligatoire." });
  else if (title.length > MAX_TITLE_LENGTH) errors.push({ path: 'titre', message: `Le titre dépasse ${MAX_TITLE_LENGTH} caractères.` });

  // exams.threshold est NOT NULL : un entier de 0 à 100, reçu en texte ("70") depuis le formulaire.
  const raw = String(form.threshold ?? '').trim();
  const threshold = Number(raw);
  if (!/^\d+$/.test(raw) || threshold > 100) {
    errors.push({ path: 'seuil', message: 'Le seuil de réussite est obligatoire : un entier de 0 à 100.' });
  }

  const csv = parseQuizCsv(decodeText(bytes));
  if (!csv.ok) errors.push(...csv.errors);

  if (!csv.ok || errors.length > 0) return { ok: false, errors };
  return { ok: true, quiz: { title, threshold, questions: csv.questions } };
}

export interface ExamSummary {
  examId: number;
  title: string;
  threshold: number;
  questionCount: number;
  resultCount: number;
}

// Examen déjà rattaché à la leçon, pour prévenir le professeur avant un réimport.
export async function getExamSummary(db: DbClient, lessonId: number): Promise<ExamSummary | null> {
  const { rows } = await db.query(
    `SELECT e.exam_id, e.exam_title, e.threshold,
            (SELECT count(*) FROM mcq_questions q WHERE q.exam_id = e.exam_id)::int AS question_count,
            (SELECT count(*) FROM result_exam r WHERE r.exam_id = e.exam_id)::int AS result_count
       FROM exams e
      WHERE e.lesson_id = $1`,
    [lessonId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { examId: r.exam_id, title: r.exam_title, threshold: r.threshold, questionCount: r.question_count, resultCount: r.result_count };
}

export async function lessonExists(db: DbClient, lessonId: number): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM lessons WHERE lesson_id = $1', [lessonId]);
  return (rowCount ?? 0) > 0;
}

export interface SavedExam {
  examId: number;
  questionCount: number;
  replacedQuestions: number;
}

// Crée l'examen de la leçon, ou le met à jour et remplace ses questions (réimport).
// Les résultats de result_exam sont conservés : l'exam_id ne change pas.
// Le client doit être dédié à cet appel (pool.connect()), pas le pool lui-même,
// sinon BEGIN et COMMIT pourraient partir sur deux connexions différentes.
export async function saveExam(db: DbClient, lessonId: number, quiz: PreparedExam): Promise<SavedExam> {
  await db.query('BEGIN');
  try {
    const { rows } = await db.query(
      `INSERT INTO exams (exam_title, threshold, lesson_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (lesson_id) DO UPDATE
         SET exam_title = EXCLUDED.exam_title, threshold = EXCLUDED.threshold
       RETURNING exam_id`,
      [quiz.title, quiz.threshold, lessonId],
    );
    const examId: number = rows[0].exam_id;

    // Les choix suivent par ON DELETE CASCADE.
    const removed = await db.query('DELETE FROM mcq_questions WHERE exam_id = $1', [examId]);

    for (const question of quiz.questions) {
      const inserted = await db.query(
        'INSERT INTO mcq_questions (exam_id, question_descr) VALUES ($1, $2) RETURNING question_id',
        [examId, question.question],
      );
      const questionId: number = inserted.rows[0].question_id;

      const values: unknown[] = [];
      const placeholders = question.choices.map((choice, i) => {
        values.push(questionId, choice.text, choice.correct, CHOICE_COLUMNS[i]);
        const n = i * 4;
        return `($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4})`;
      });
      await db.query(
        `INSERT INTO mcq_choices (question_id, choice_descr, is_correct, choice) VALUES ${placeholders.join(', ')}`,
        values,
      );
    }

    await db.query('COMMIT');
    return { examId, questionCount: quiz.questions.length, replacedQuestions: removed.rowCount ?? 0 };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
