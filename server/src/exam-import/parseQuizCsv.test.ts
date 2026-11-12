import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseQuizCsv, decodeText, type CsvResult } from './parseQuizCsv';

const example = readFileSync(new URL('./exemple-qcm.csv', import.meta.url), 'utf8');
const HEADER = 'question;A;B;C;D;reponses';
const csv = (...lines: string[]) => [HEADER, ...lines].join('\n');

// Raccourcis qui vérifient le résultat et le typent pour la suite du test.
function questionsOf(result: CsvResult) {
  if (!result.ok) throw new Error(`Validation inattendue en échec : ${JSON.stringify(result.errors)}`);
  return result.questions;
}
function errorsOf(result: CsvResult) {
  if (result.ok) throw new Error('La validation aurait dû échouer');
  return result.errors;
}
const paths = (result: CsvResult) => errorsOf(result).map((e) => e.path);

describe('parseQuizCsv : lecture', () => {
  it("accepte le fichier d'exemple", () => {
    const questions = questionsOf(parseQuizCsv(example));
    expect(questions).toHaveLength(4);
    expect(questions[0].choices).toHaveLength(3);
    expect(questions[0].multiple).toBe(false);
    expect(questions[1].multiple).toBe(true);
    expect(questions[1].choices.map((c) => c.correct)).toEqual([true, true, false, false]);
  });

  it('gère les guillemets, le séparateur dans un champ et les retours à la ligne', () => {
    const [q] = questionsOf(parseQuizCsv(csv('"Une ; question\nsur deux lignes";"Il dit ""oui""";Non;;;A')));
    expect(q.question).toBe('Une ; question\nsur deux lignes');
    expect(q.choices[0].text).toBe('Il dit "oui"');
  });

  it('détecte la virgule et la tabulation comme séparateur', () => {
    for (const sep of [',', '\t']) {
      const content = ['question', 'A', 'B', 'reponses'].join(sep) + '\n' + ['Q ?', 'Oui', 'Non', 'B'].join(sep);
      expect(questionsOf(parseQuizCsv(content))[0].choices[1].correct).toBe(true);
    }
  });

  it('accepte BOM, fins de ligne Windows, lignes vides et en-tête accentué', () => {
    const content = '﻿Question;A;B;Réponses\r\nQ1 ?;Oui;Non;a\r\n;;;\r\nQ2 ?;Oui;Non;b\r\n';
    expect(questionsOf(parseQuizCsv(content))).toHaveLength(2);
  });

  it('accepte plusieurs écritures des réponses multiples', () => {
    for (const answer of ['A,C', '"A;C"', 'A+C', 'A C', 'ac']) {
      const [q] = questionsOf(parseQuizCsv(csv(`Q ?;Un;Deux;Trois;;${answer}`)));
      expect(q.choices.map((c) => c.correct)).toEqual([true, false, true]);
    }
  });

  it('lit un CSV enregistré par Excel en Windows-1252', () => {
    const bytes = Uint8Array.from(
      [...'question;A;B;r', 0xe9, ...'ponses\nCaf', 0xe9, ...' ?;Oui;Non;A'].map((c) => (typeof c === 'number' ? c : c.charCodeAt(0))),
    );
    expect(questionsOf(parseQuizCsv(decodeText(bytes)))[0].question).toBe('Café ?');
  });
});

describe('parseQuizCsv : règles', () => {
  it('rejette un en-tête incorrect', () => {
    expect(paths(parseQuizCsv('intitule;A;B;reponses\nQ ?;Oui;Non;A'))).toEqual(['ligne 1']);
    expect(paths(parseQuizCsv('question;A;C;reponses\nQ ?;Oui;Non;A'))).toEqual(['ligne 1']);
    expect(paths(parseQuizCsv('question;A;reponses\nQ ?;Oui;A'))).toEqual(['ligne 1']);
  });

  it('accepte 8 colonnes de choix, pas 9', () => {
    const letters = 'ABCDEFGH'.split('');
    const eight = ['question', ...letters, 'reponses'].join(';') + '\n' + ['Q ?', ...letters, 'H'].join(';');
    expect(questionsOf(parseQuizCsv(eight))[0].choices).toHaveLength(8);
    const nine = ['question', ...letters, 'I', 'reponses'].join(';') + '\nQ ?;' + 'x;'.repeat(9) + 'A';
    expect(paths(parseQuizCsv(nine))).toEqual(['ligne 1']);
  });

  it('rejette un fichier vide ou sans question', () => {
    expect(errorsOf(parseQuizCsv(''))[0].message).toMatch(/vide/);
    expect(errorsOf(parseQuizCsv(HEADER + '\n'))[0].message).toMatch(/Aucune question/);
  });

  it('limite le nombre de questions à 100', () => {
    const lines = Array.from({ length: 101 }, (_, i) => `Q${i} ?;Oui;Non;;;A`);
    expect(errorsOf(parseQuizCsv(csv(...lines)))[0].message).toMatch(/100 questions/);
    expect(questionsOf(parseQuizCsv(csv(...lines.slice(1))))).toHaveLength(100);
  });

  it('signale un guillemet jamais refermé', () => {
    expect(errorsOf(parseQuizCsv(csv('Q1 ?;Oui;Non;;;A', '"Q2 ?;Oui;Non;;;A')))[0]).toEqual({
      path: 'ligne 3',
      message: 'Guillemet ouvert jamais refermé.',
    });
  });

  it('exige au moins une bonne réponse', () => {
    const errors = errorsOf(parseQuizCsv(csv('Q ?;Oui;Non;;;')));
    expect(errors).toEqual([{ path: 'ligne 2, colonne reponses', message: expect.stringMatching(/Aucune bonne réponse/) }]);
  });

  it('refuse une réponse qui désigne une case vide', () => {
    const errors = errorsOf(parseQuizCsv(csv('Q ?;Oui;Non;;;C')));
    expect(errors).toEqual([{ path: 'ligne 2, colonne reponses', message: expect.stringMatching(/case de choix vide/) }]);
  });

  it('refuse une réponse illisible', () => {
    expect(paths(parseQuizCsv(csv('Q ?;Oui;Non;;;1')))).toEqual(['ligne 2, colonne reponses']);
  });

  it('refuse une ligne avec trop de colonnes', () => {
    expect(paths(parseQuizCsv(csv('Q ?;Oui;Non;;;A;en trop')))).toContain('ligne 2');
  });

  it('situe chaque erreur par ligne et colonne, en gardant la lettre des cases', () => {
    const long = 'x'.repeat(1001);
    const errors = errorsOf(parseQuizCsv(csv('Q1 ?;Oui;Non;;;A', ';Oui;;oui;;A', 'Q3 ?;Seul;;;;A', `Q4 ?;Oui;;${long};;A`)));
    expect(errors.map((e) => e.path)).toEqual(['ligne 3, colonne question', 'ligne 3', 'ligne 4', 'ligne 5, colonne C']);
    expect(errors[1].message).toMatch(/même texte/);
    expect(errors[2].message).toMatch(/au moins 2 choix/);
    expect(errors[3].message).toMatch(/caractères/);
  });

  it('compte les lignes réelles quand un champ tient sur plusieurs lignes', () => {
    expect(paths(parseQuizCsv(csv('"Q1\nsuite ?";Oui;Non;;;A', 'Q2 ?;Oui;Non;;;')))).toEqual(['ligne 4, colonne reponses']);
  });
});
