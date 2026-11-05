import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { createApp } from './app';
import { requireProfessor } from './auth';

// Base de test avec le schéma Corelab (ses tables sont vidées) : voir le README.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('API Corelab', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: url });
  });
  afterAll(() => pool?.end());

  beforeEach(async () => {
    await pool.query('TRUNCATE role, users, module, lessons, exams, mcq_questions, mcq_choices, result_exam RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO role (role) VALUES ('professeur'), ('etudiant')`);
    await pool.query(
      `INSERT INTO users (email, role_id, must_change_password) VALUES ('prof@corelab.test', 1, false), ('etudiant@corelab.test', 2, false)`,
    );
    await pool.query(`INSERT INTO module (module_title, created_by) VALUES ('Développement web', 1)`);
    await pool.query(`INSERT INTO lessons (lesson_title, module_id) VALUES ('Les bases du HTML', 1), ('CSS', 1)`);
  });

  it('réserve les routes aux professeurs', async () => {
    const asStudent = createApp(pool, requireProfessor(pool, 'etudiant@corelab.test'));
    expect((await request(asStudent).get('/api/lessons')).status).toBe(403);
    expect((await request(asStudent).post('/api/lessons/1/exam/preview')).status).toBe(403);

    const unknown = createApp(pool, requireProfessor(pool, 'personne@corelab.test'));
    expect((await request(unknown).get('/api/lessons')).status).toBe(401);
  });

  it("liste les leçons avec leur examen une fois l'import fait", async () => {
    const app = createApp(pool, requireProfessor(pool, 'prof@corelab.test'));
    const before = await request(app).get('/api/lessons');
    expect(before.body).toEqual([
      { lessonId: 1, title: 'Les bases du HTML', module: 'Développement web', exam: null },
      { lessonId: 2, title: 'CSS', module: 'Développement web', exam: null },
    ]);

    const saved = await request(app)
      .post('/api/lessons/1/exam')
      .field('title', 'HTML')
      .field('threshold', '70')
      .attach('file', Buffer.from('question;A;B;reponses\nQ1 ?;Oui;Non;A\nQ2 ?;Oui;Non;B\n'), 'qcm.csv');
    expect(saved.status).toBe(201);

    const after = await request(app).get('/api/lessons');
    expect(after.body[0].exam).toEqual({ examId: 1, title: 'HTML', threshold: 70, questionCount: 2 });
  });
});
