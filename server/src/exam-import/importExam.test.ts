import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import pg from 'pg';
import { prepareExam, saveExam, getExamSummary, type PreparedExam } from './importExam';
import { examImportRouter } from './examImportRouter';
import type { ValidationResult } from './validateQuiz';

const csv = readFileSync(new URL('./exemple-qcm.csv', import.meta.url));
const json = readFileSync(new URL('./exemple-qcm.json', import.meta.url));
const bytes = (s: string) => new TextEncoder().encode(s);

function quizOf(result: ValidationResult) {
  if (!result.ok) throw new Error(`Validation inattendue en échec : ${JSON.stringify(result.errors)}`);
  return result.quiz as PreparedExam;
}
function errorsOf(result: ValidationResult) {
  if (result.ok) throw new Error('La validation aurait dû échouer');
  return result.errors;
}

describe('prepareExam', () => {
  it('lit un CSV avec le titre et le seuil du formulaire', () => {
    const quiz = quizOf(prepareExam('qcm.csv', csv, { title: 'HTML', threshold: '70' }));
    expect(quiz).toMatchObject({ title: 'HTML', passingScore: 70 });
    expect(quiz.questions).toHaveLength(4);
  });

  it('exige le seuil, en plus des autres erreurs', () => {
    expect(errorsOf(prepareExam('qcm.csv', csv, { title: 'HTML' })).map((e) => e.path)).toEqual(['seuil']);
    expect(errorsOf(prepareExam('qcm.csv', csv, { title: '', threshold: '' })).map((e) => e.path)).toEqual(['seuil', 'titre']);
  });

  it('refuse un seuil invalide', () => {
    for (const threshold of ['abc', '101', '-5', '50.5']) {
      expect(errorsOf(prepareExam('qcm.csv', csv, { title: 'HTML', threshold })).map((e) => e.path)).toContain('seuil');
    }
  });

  it('refuse un titre de plus de 200 caractères (exams.exam_title)', () => {
    expect(errorsOf(prepareExam('qcm.csv', csv, { title: 'T'.repeat(201), threshold: 70 }))[0].path).toBe('titre');
  });

  it('pour un JSON, le formulaire remplace le titre et complète le seuil', () => {
    expect(quizOf(prepareExam('qcm.json', json, {}))).toMatchObject({ title: 'Les bases du HTML', passingScore: 70 });
    expect(quizOf(prepareExam('qcm.json', json, { title: 'Autre', threshold: '80' }))).toMatchObject({ title: 'Autre', passingScore: 80 });
    const sansSeuil = JSON.stringify({ ...JSON.parse(json.toString()), passingScore: undefined });
    expect(errorsOf(prepareExam('qcm.json', bytes(sansSeuil), {}))[0].path).toBe('seuil');
  });

  it('refuse une autre extension', () => {
    expect(errorsOf(prepareExam('qcm.xlsx', csv, { title: 'HTML', threshold: 70 }))[0].message).toMatch(/\.csv ou un \.json/);
  });
});

// Tests sur une base de test qui a le schéma Corelab (ils vident ses tables) :
// TEST_DATABASE_URL=postgres://corelab:corelab@localhost:5433/corelab_test npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('base Corelab (PostgreSQL)', () => {
  let pool: pg.Pool;
  let lessonId: number;
  let studentId: number;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(() => pool?.end());

  beforeEach(async () => {
    await pool.query('TRUNCATE role, users, module, lessons, exams, mcq_questions, mcq_choices, result_exam RESTART IDENTITY CASCADE');
    const role = await pool.query(`INSERT INTO role (role) VALUES ('professeur') RETURNING role_id`);
    const user = await pool.query(
      `INSERT INTO users (email, role_id, must_change_password) VALUES ('prof@corelab.test', $1, false) RETURNING user_id`,
      [role.rows[0].role_id],
    );
    studentId = user.rows[0].user_id;
    const mod = await pool.query(`INSERT INTO module (module_title, created_by) VALUES ('Web', $1) RETURNING module_id`, [studentId]);
    const lesson = await pool.query(`INSERT INTO lessons (lesson_title, module_id) VALUES ('HTML', $1) RETURNING lesson_id`, [
      mod.rows[0].module_id,
    ]);
    lessonId = lesson.rows[0].lesson_id;
  });

  async function save(quiz: PreparedExam) {
    const client = await pool.connect();
    try {
      return await saveExam(client, lessonId, quiz);
    } finally {
      client.release();
    }
  }

  it('enregistre l’examen, ses questions et ses choix avec leur lettre', async () => {
    const saved = await save(quizOf(prepareExam('qcm.csv', csv, { title: 'HTML', threshold: '70' })));
    expect(saved).toMatchObject({ questionCount: 4, replacedQuestions: 0 });

    const exam = await pool.query('SELECT exam_title, threshold, lesson_id FROM exams');
    expect(exam.rows).toEqual([{ exam_title: 'HTML', threshold: 70, lesson_id: lessonId }]);
    const choices = await pool.query(
      `SELECT c.choice, c.choice_descr, c.is_correct FROM mcq_choices c
         JOIN mcq_questions q USING (question_id)
        WHERE q.question_descr LIKE 'Quelles balises%' ORDER BY c.choice`,
    );
    expect(choices.rows).toEqual([
      { choice: 'A', choice_descr: '<ul>', is_correct: true },
      { choice: 'B', choice_descr: '<ol>', is_correct: true },
      { choice: 'C', choice_descr: '<list>', is_correct: false },
      { choice: 'D', choice_descr: '<li-group>', is_correct: false },
    ]);
  });

  it('un réimport remplace les questions, garde l’exam_id et les résultats', async () => {
    const first = await save(quizOf(prepareExam('qcm.csv', csv, { title: 'HTML', threshold: 70 })));
    await pool.query('INSERT INTO result_exam (result, exam_id, user_id) VALUES (85, $1, $2)', [first.examId, studentId]);

    const reimport = bytes('question;A;B;reponses\nNouvelle question ?;Oui;Non;A\n');
    const second = await save(quizOf(prepareExam('v2.csv', reimport, { title: 'HTML v2', threshold: 60 })));

    expect(second).toEqual({ examId: first.examId, questionCount: 1, replacedQuestions: 4 });
    expect((await pool.query('SELECT count(*)::int AS n FROM mcq_choices')).rows[0].n).toBe(2);
    expect(await getExamSummary(pool, lessonId)).toEqual({
      examId: first.examId,
      title: 'HTML v2',
      threshold: 60,
      questionCount: 1,
      resultCount: 1,
    });
  });

  it('annule tout si une écriture échoue', async () => {
    const quiz = quizOf(prepareExam('qcm.csv', csv, { title: 'HTML', threshold: 70 }));
    const client = await pool.connect();
    try {
      await expect(saveExam(client, 9999, quiz)).rejects.toThrow(/foreign key/);
    } finally {
      client.release();
    }
    expect((await pool.query('SELECT count(*)::int AS n FROM mcq_questions')).rows[0].n).toBe(0);
  });

  describe('routes', () => {
    const allow: RequestHandler = (_req, _res, next) => next();
    const app = () => express().use('/api', examImportRouter(pool, allow));

    it('aperçu sans écriture, puis confirmation', async () => {
      const preview = await request(app())
        .post(`/api/lessons/${lessonId}/exam/preview`)
        .field('title', 'HTML')
        .field('threshold', '70')
        .attach('file', csv, 'qcm.csv');
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ ok: true, existing: null });
      expect(preview.body.quiz.questions).toHaveLength(4);
      expect((await pool.query('SELECT count(*)::int AS n FROM exams')).rows[0].n).toBe(0);

      const saved = await request(app())
        .post(`/api/lessons/${lessonId}/exam`)
        .field('title', 'HTML')
        .field('threshold', '70')
        .attach('file', csv, 'qcm.csv');
      expect(saved.status).toBe(201);
      expect(saved.body).toMatchObject({ ok: true, questionCount: 4 });

      const again = await request(app())
        .post(`/api/lessons/${lessonId}/exam/preview`)
        .field('title', 'HTML')
        .field('threshold', '70')
        .attach('file', csv, 'qcm.csv');
      expect(again.body.existing).toMatchObject({ questionCount: 4, resultCount: 0 });
    });

    it('répond 422 avec les erreurs, 404, 415 et 413', async () => {
      const bad = await request(app())
        .post(`/api/lessons/${lessonId}/exam`)
        .field('title', 'HTML')
        .attach('file', Buffer.from('question;A;B;reponses\nQ ?;Oui;Non;\n'), 'qcm.csv');
      expect(bad.status).toBe(422);
      expect(bad.body.errors.map((e: { path: string }) => e.path)).toEqual(['seuil', 'ligne 2, colonne reponses']);

      const unknown = await request(app()).post('/api/lessons/9999/exam').field('title', 'HTML').field('threshold', '70').attach('file', csv, 'qcm.csv');
      expect(unknown.status).toBe(404);

      const xlsx = await request(app()).post(`/api/lessons/${lessonId}/exam`).attach('file', csv, 'qcm.xlsx');
      expect(xlsx.status).toBe(415);

      const huge = await request(app())
        .post(`/api/lessons/${lessonId}/exam`)
        .attach('file', Buffer.alloc(1024 * 1024 + 1, 'a'), 'qcm.csv');
      expect(huge.status).toBe(413);
    });

    it('sert le modèle CSV, lisible par le validateur', async () => {
      const res = await request(app()).get('/api/exam-template.csv').buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(res.status).toBe(200);
      expect(quizOf(prepareExam('modele.csv', res.body, { title: 'Modèle', threshold: 50 })).questions).toHaveLength(2);
    });
  });
});
