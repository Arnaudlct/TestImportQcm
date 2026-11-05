// Authentification provisoire du dépôt de test : l'utilisateur « connecté » est celui
// dont l'email est dans DEV_USER_EMAIL (par défaut le professeur des données de démo).
// Dans Corelab, remplacer par la vraie session (table sessions) en gardant le contrôle du rôle.

import type { RequestHandler } from 'express';
import type { Pool } from 'pg';

export const PROFESSOR_ROLE = 'professeur';

export function requireProfessor(pool: Pool, email = process.env.DEV_USER_EMAIL ?? 'prof@corelab.test'): RequestHandler {
  return async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.user_id, r.role FROM users u JOIN role r USING (role_id)
          WHERE u.email = $1 AND u.deleted_at IS NULL`,
        [email],
      );
      if (rows.length === 0) {
        res.status(401).json({ ok: false, errors: [{ path: '', message: 'Connecte-toi pour importer un examen.' }] });
        return;
      }
      if (rows[0].role !== PROFESSOR_ROLE) {
        res.status(403).json({ ok: false, errors: [{ path: '', message: "L'import d'examen est réservé aux professeurs." }] });
        return;
      }
      res.locals.userId = rows[0].user_id;
      next();
    } catch (error) {
      next(error);
    }
  };
}
