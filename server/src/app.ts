import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { examImportRouter } from './exam-import/examImportRouter';

export function createApp(pool: Pool, requireProfessor: RequestHandler) {
  const app = express();

  // Leçons avec l'examen éventuellement rattaché, pour la page de test du front.
  app.get('/api/lessons', requireProfessor, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT l.lesson_id, l.lesson_title, m.module_title, e.exam_id, e.exam_title, e.threshold,
                (SELECT count(*) FROM mcq_questions q WHERE q.exam_id = e.exam_id)::int AS question_count
           FROM lessons l
           JOIN module m USING (module_id)
           LEFT JOIN exams e ON e.lesson_id = l.lesson_id
          ORDER BY m.module_title, l.lesson_id`,
      );
      res.json(
        rows.map((r) => ({
          lessonId: r.lesson_id,
          title: r.lesson_title,
          module: r.module_title,
          exam: r.exam_id ? { examId: r.exam_id, title: r.exam_title, threshold: r.threshold, questionCount: r.question_count } : null,
        })),
      );
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', examImportRouter(pool, requireProfessor));

  const serverError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ ok: false, errors: [{ path: '', message: 'Erreur du serveur, réessaie dans un instant.' }] });
  };
  app.use(serverError);

  return app;
}
