import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateQuiz, parseQuizFile, LIMITS, type ValidationResult } from './validateQuiz';

const example = readFileSync(new URL('./exemple-qcm.json', import.meta.url), 'utf8');

const validQuiz = () => ({
  title: 'Quiz' as unknown,
  passingScore: undefined as unknown,
  questions: [
    {
      question: 'Q1 ?' as unknown,
      choices: [
        { text: 'A', correct: true as unknown },
        { text: 'B', correct: false as unknown },
      ] as unknown[],
    },
  ] as unknown[],
});

// Raccourcis qui vérifient le résultat et le typent pour la suite du test.
function quizOf(result: ValidationResult) {
  if (!result.ok) throw new Error(`Validation inattendue en échec : ${JSON.stringify(result.errors)}`);
  return result.quiz;
}
function errorsOf(result: ValidationResult) {
  if (result.ok) throw new Error('La validation aurait dû échouer');
  return result.errors;
}
const paths = (result: ValidationResult) => errorsOf(result).map((e) => e.path);

describe('parseQuizFile', () => {
  it("accepte le fichier d'exemple", () => {
    const quiz = quizOf(parseQuizFile(example));
    expect(quiz.questions).toHaveLength(3);
    expect(quiz.passingScore).toBe(70);
    expect(quiz.questions[1].multiple).toBe(true);
    expect(quiz.questions[0].multiple).toBe(false);
  });

  it('rejette un JSON mal formé', () => {
    expect(errorsOf(parseQuizFile('{ "title": '))[0].message).toMatch(/JSON invalide/);
  });
});

describe('validateQuiz', () => {
  it('nettoie les espaces superflus', () => {
    const input = validQuiz();
    input.title = '  Quiz  ';
    const quiz = quizOf(validateQuiz(input));
    expect(quiz.title).toBe('Quiz');
    expect(quiz.passingScore).toBeNull();
  });

  it('rejette autre chose qu’un objet', () => {
    expect(validateQuiz([]).ok).toBe(false);
    expect(validateQuiz(null).ok).toBe(false);
  });

  it('exige un titre', () => {
    const input = validQuiz();
    input.title = '   ';
    expect(paths(validateQuiz(input))).toContain('title');
  });

  it(`limite le titre à ${LIMITS.maxTitleLength} caractères`, () => {
    const input = validQuiz();
    input.title = 'T'.repeat(LIMITS.maxTitleLength);
    expect(validateQuiz(input).ok).toBe(true);
    input.title = 'T'.repeat(LIMITS.maxTitleLength + 1);
    expect(paths(validateQuiz(input))).toContain('title');
  });

  it('exige au moins une question', () => {
    const input = validQuiz();
    input.questions = [];
    expect(paths(validateQuiz(input))).toContain('questions');
  });

  it.each([-1, 101, 50.5, '70'])('rejette passingScore = %s', (score) => {
    const input = validQuiz();
    input.passingScore = score;
    expect(paths(validateQuiz(input))).toContain('passingScore');
  });

  it('exige au moins 2 choix', () => {
    const input = validQuiz();
    input.questions = [{ question: 'Q ?', choices: [{ text: 'A', correct: true }] }];
    expect(paths(validateQuiz(input))).toContain('questions[0].choices');
  });

  it(`refuse plus de ${LIMITS.maxChoices} choix`, () => {
    const input = validQuiz();
    const choices = Array.from({ length: LIMITS.maxChoices + 1 }, (_, i) => ({ text: `C${i}`, correct: i === 0 }));
    input.questions = [{ question: 'Q ?', choices }];
    expect(paths(validateQuiz(input))).toContain('questions[0].choices');
  });

  it('exige au moins une bonne réponse', () => {
    const input = validQuiz();
    input.questions = [{ question: 'Q ?', choices: [{ text: 'A', correct: false }, { text: 'B', correct: false }] }];
    expect(errorsOf(validateQuiz(input))[0].message).toMatch(/correct/);
  });

  it('refuse les choix en double', () => {
    const input = validQuiz();
    input.questions = [{ question: 'Q ?', choices: [{ text: 'A', correct: true }, { text: 'a', correct: false }] }];
    expect(errorsOf(validateQuiz(input))[0].message).toMatch(/même texte/);
  });

  it('exige un booléen pour correct', () => {
    const input = validQuiz();
    input.questions = [{ question: 'Q ?', choices: [{ text: 'A', correct: true }, { text: 'B', correct: 'non' }] }];
    expect(paths(validateQuiz(input))).toContain('questions[0].choices[1].correct');
  });

  it('remonte toutes les erreurs avec leur emplacement', () => {
    const input = validQuiz();
    input.questions.push({ question: '', choices: [{ text: '', correct: true }] });
    expect(paths(validateQuiz(input))).toEqual(
      expect.arrayContaining(['questions[1].question', 'questions[1].choices', 'questions[1].choices[0].text']),
    );
  });
});
