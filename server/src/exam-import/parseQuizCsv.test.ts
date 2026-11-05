import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseQuizCsv, parseQuizUpload, decodeText } from './parseQuizCsv';
import type { ValidationResult } from './validateQuiz';

const example = readFileSync(new URL('./exemple-qcm.csv', import.meta.url), 'utf8');
const opts = { title: 'Quiz' };
const HEADER = 'question;A;B;C;D;reponses';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

function quizOf(result: ValidationResult) {
  if (!result.ok) throw new Error(`Validation inattendue en échec : ${JSON.stringify(result.errors)}`);
  return result.quiz;
}
function errorsOf(result: ValidationResult) {
  if (result.ok) throw new Error('La validation aurait dû échouer');
  return result.errors;
}
const paths = (result: ValidationResult) => errorsOf(result).map((e) => e.path);

describe('parseQuizCsv', () => {
  it("accepte le fichier d'exemple", () => {
    const quiz = quizOf(parseQuizCsv(example, { title: 'Les bases du HTML', passingScore: 70 }));
    expect(quiz.title).toBe('Les bases du HTML');
    expect(quiz.passingScore).toBe(70);
    expect(quiz.questions).toHaveLength(4);
    expect(quiz.questions[0].choices).toHaveLength(3);
    expect(quiz.questions[1].multiple).toBe(true);
    expect(quiz.questions[1].choices.map((c) => c.correct)).toEqual([true, true, false, false]);
  });

  it('gère les guillemets, le séparateur dans un champ et les retours à la ligne', () => {
    const quiz = quizOf(parseQuizCsv(csv('"Une ; question\nsur deux lignes";"Il dit ""oui""";Non;;;A'), opts));
    expect(quiz.questions[0].question).toBe('Une ; question\nsur deux lignes');
    expect(quiz.questions[0].choices[0].text).toBe('Il dit "oui"');
  });

  it('détecte la virgule et la tabulation comme séparateur', () => {
    for (const sep of [',', '\t']) {
      const content = ['question', 'A', 'B', 'reponses'].join(sep) + '\n' + ['Q ?', 'Oui', 'Non', 'B'].join(sep);
      expect(quizOf(parseQuizCsv(content, opts)).questions[0].choices[1].correct).toBe(true);
    }
  });

  it('accepte BOM, fins de ligne Windows, lignes vides et en-tête accentué', () => {
    const content = '﻿Question;A;B;Réponses\r\nQ1 ?;Oui;Non;a\r\n;;;\r\nQ2 ?;Oui;Non;b\r\n';
    expect(quizOf(parseQuizCsv(content, opts)).questions).toHaveLength(2);
  });

  it('accepte plusieurs écritures des réponses multiples', () => {
    for (const answer of ['A,C', '"A;C"', 'A+C', 'A C', 'ac']) {
      const quiz = quizOf(parseQuizCsv(csv(`Q ?;Un;Deux;Trois;;${answer}`), opts));
      expect(quiz.questions[0].choices.map((c) => c.correct)).toEqual([true, false, true]);
    }
  });

  it("rejette un en-tête incorrect", () => {
    expect(paths(parseQuizCsv('intitule;A;B;reponses\nQ ?;Oui;Non;A', opts))).toEqual(['ligne 1']);
    expect(paths(parseQuizCsv('question;A;C;reponses\nQ ?;Oui;Non;A', opts))).toEqual(['ligne 1']);
    expect(paths(parseQuizCsv('question;A;reponses\nQ ?;Oui;A', opts))).toEqual(['ligne 1']);
  });

  it('rejette un fichier vide ou sans question', () => {
    expect(errorsOf(parseQuizCsv('', opts))[0].message).toMatch(/vide/);
    expect(errorsOf(parseQuizCsv(HEADER + '\n', opts))[0].message).toMatch(/Aucune question/);
  });

  it('signale un guillemet jamais refermé', () => {
    expect(errorsOf(parseQuizCsv(csv('Q1 ?;Oui;Non;;;A', '"Q2 ?;Oui;Non;;;A'), opts))[0]).toEqual({
      path: 'ligne 3',
      message: 'Guillemet ouvert jamais refermé.',
    });
  });

  it('exige au moins une bonne réponse, avec un message adapté au tableur', () => {
    const errors = errorsOf(parseQuizCsv(csv('Q ?;Oui;Non;;;'), opts));
    expect(errors).toEqual([{ path: 'ligne 2, colonne reponses', message: expect.stringMatching(/Aucune bonne réponse/) }]);
  });

  it('refuse une réponse qui désigne une case vide, sans erreur en double', () => {
    const errors = errorsOf(parseQuizCsv(csv('Q ?;Oui;Non;;;C'), opts));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: 'ligne 2, colonne reponses', message: expect.stringMatching(/case de choix vide/) });
  });

  it('refuse une réponse illisible', () => {
    expect(paths(parseQuizCsv(csv('Q ?;Oui;Non;;;1'), opts))).toEqual(['ligne 2, colonne reponses']);
  });

  it('refuse une ligne avec trop de colonnes', () => {
    expect(paths(parseQuizCsv(csv('Q ?;Oui;Non;;;A;en trop'), opts))).toContain('ligne 2');
  });

  it("traduit les erreurs du validateur en ligne et colonne, en tenant compte des cases vides", () => {
    const long = 'x'.repeat(1001);
    const errors = errorsOf(
      parseQuizCsv(csv('Q1 ?;Oui;Non;;;A', ';Oui;;oui;;A', 'Q3 ?;Seul;;;;A', `Q4 ?;Oui;;${long};;A`), opts),
    );
    expect(errors.map((e) => e.path)).toEqual([
      'ligne 3, colonne question',
      'ligne 3',
      'ligne 4',
      'ligne 5, colonne C',
    ]);
    expect(errors[1].message).toMatch(/même texte/);
    expect(errors[3].message).toMatch(/caractères/);
  });

  it('compte les lignes réelles quand un champ tient sur plusieurs lignes', () => {
    expect(paths(parseQuizCsv(csv('"Q1\nsuite ?";Oui;Non;;;A', 'Q2 ?;Oui;Non;;;'), opts))).toEqual([
      'ligne 4, colonne reponses',
    ]);
  });

  it('vérifie le titre et le seuil venus du formulaire', () => {
    expect(paths(parseQuizCsv(csv('Q ?;Oui;Non;;;A'), { title: ' ', passingScore: 150 }))).toEqual(['titre', 'seuil']);
  });
});

describe('decodeText et parseQuizUpload', () => {
  it('lit un CSV enregistré par Excel en Windows-1252', () => {
    const bytes = Uint8Array.from([...'question;A;B;r', 0xe9, ...'ponses\nCaf', 0xe9, ...' ?;Oui;Non;A'].map((c) =>
      typeof c === 'number' ? c : c.charCodeAt(0),
    ));
    expect(decodeText(bytes)).toContain('Café ?');
    expect(quizOf(parseQuizUpload('qcm.CSV', bytes, opts)).questions[0].question).toBe('Café ?');
  });

  it("choisit le format selon l'extension", () => {
    const json = new TextEncoder().encode(readFileSync(new URL('./exemple-qcm.json', import.meta.url), 'utf8'));
    expect(quizOf(parseQuizUpload('qcm.json', json, opts)).title).toBe('Les bases du HTML');
  });
});
