// Routes Express de l'import d'examen (voir le README).
//   POST /lessons/:lessonId/exam/preview  → aperçu, rien n'est enregistré
//   POST /lessons/:lessonId/exam          → enregistrement (création ou réimport)
//   GET  /exam-template.csv               → modèle CSV à remplir

import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import multer from 'multer';
import type { Pool } from 'pg';
import { getExamSummary, lessonExists, prepareExam, saveExam, type PreparedExam } from './importExam';

export const MAX_FILE_SIZE = 1024 * 1024; // 1 Mo : un QCM au maximum autorisé fait environ 900 000 caractères

const TEMPLATE_CSV =
  '﻿question;A;B;C;D;reponses\n' +
  'Que signifie HTML ?;HyperText Markup Language;High Tech Modern Language;Home Tool Markup Language;;A\n' +
  'Quelles balises servent à créer une liste ?;<ul>;<ol>;<list>;<li-group>;A,B\n';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1 } }).single('file');

// requireProfessor : le middleware d'authentification de l'app, qui répond 401/403
// si l'utilisateur connecté n'a pas le rôle professeur.
export function examImportRouter(pool: Pool, requireProfessor: RequestHandler): Router {
  const router = Router();

  router.get('/exam-template.csv', requireProfessor, (_req, res) => {
    res.type('text/csv; charset=utf-8').attachment('modele-qcm.csv').send(TEMPLATE_CSV);
  });

  const notFound = { ok: false, errors: [{ path: '', message: 'Leçon introuvable.' }] };

  // Commun aux deux routes POST : vérifie la leçon, le fichier et le formulaire.
  // Répond lui-même en cas d'erreur, sinon passe la leçon et le QCM lu via res.locals.
  const readUpload: RequestHandler = async (req, res, next) => {
    try {
      const lessonId = Number(req.params.lessonId);
      if (!Number.isInteger(lessonId) || lessonId <= 0 || !(await lessonExists(pool, lessonId))) {
        res.status(404).json(notFound);
        return;
      }
      if (!req.file) {
        res.status(422).json({ ok: false, errors: [{ path: 'fichier', message: 'Aucun fichier reçu (champ "file").' }] });
        return;
      }
      if (!/\.csv$/i.test(req.file.originalname)) {
        res.status(415).json({ ok: false, errors: [{ path: 'fichier', message: 'Le fichier doit être un .csv.' }] });
        return;
      }
      const result = prepareExam(req.file.buffer, { title: req.body?.title, threshold: req.body?.threshold });
      if (!result.ok) {
        res.status(422).json(result);
        return;
      }
      res.locals.lessonId = lessonId;
      res.locals.quiz = result.quiz;
      next();
    } catch (error) {
      next(error);
    }
  };

  router.post('/lessons/:lessonId/exam/preview', requireProfessor, upload, readUpload, async (_req, res, next) => {
    try {
      // existing non nul = réimport : l'écran d'aperçu affiche l'avertissement.
      res.json({ ok: true, quiz: res.locals.quiz, existing: await getExamSummary(pool, res.locals.lessonId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/lessons/:lessonId/exam', requireProfessor, upload, readUpload, async (_req, res, next) => {
    const client = await pool.connect();
    try {
      const saved = await saveExam(client, res.locals.lessonId, res.locals.quiz as PreparedExam);
      res.status(201).json({ ok: true, ...saved });
    } catch (error) {
      next(error);
    } finally {
      client.release();
    }
  });

  // Fichier trop gros ou envoi multipart invalide.
  const uploadErrors: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof multer.MulterError) {
      const tooBig = error.code === 'LIMIT_FILE_SIZE';
      res.status(tooBig ? 413 : 400).json({
        ok: false,
        errors: [{ path: 'fichier', message: tooBig ? 'Le fichier dépasse 1 Mo.' : `Envoi invalide : ${error.message}` }],
      });
      return;
    }
    next(error);
  };
  router.use(uploadErrors);

  return router;
}
