// Validation d'un fichier QCM importé (format JSON, voir FORMAT.md).
// Retourne { ok: true, quiz } avec les données nettoyées,
// ou { ok: false, errors } avec une liste d'erreurs lisibles par l'admin.

export const LIMITS = {
  maxQuestions: 100,
  minChoices: 2,
  maxChoices: 8,
  maxTextLength: 1000,
  maxTitleLength: 200, // exams.exam_title est un varchar(200)
} as const;

export interface Choice {
  text: string;
  correct: boolean;
}

export interface Question {
  question: string;
  multiple: boolean;
  choices: Choice[];
}

export interface Quiz {
  title: string;
  passingScore: number | null;
  questions: Question[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; quiz: Quiz }
  | { ok: false; errors: ValidationError[] };

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function checkText(
  value: unknown,
  path: string,
  label: string,
  errors: ValidationError[],
  maxLength: number = LIMITS.maxTextLength,
): string {
  if (!isNonEmptyString(value)) {
    errors.push({ path, message: `${label} est obligatoire et doit être un texte non vide.` });
    return '';
  }
  const text = value.trim();
  if (text.length > maxLength) {
    errors.push({ path, message: `${label} dépasse ${maxLength} caractères.` });
  }
  return text;
}

function validateChoice(choice: unknown, path: string, errors: ValidationError[]): Choice | null {
  if (!isObject(choice)) {
    errors.push({ path, message: 'Chaque choix doit être un objet { "text": ..., "correct": ... }.' });
    return null;
  }
  const text = checkText(choice.text, `${path}.text`, 'Le texte du choix', errors);
  if (typeof choice.correct !== 'boolean') {
    errors.push({ path: `${path}.correct`, message: '"correct" doit valoir true ou false.' });
  }
  return { text, correct: choice.correct === true };
}

function validateQuestion(question: unknown, path: string, errors: ValidationError[]): Question | null {
  if (!isObject(question)) {
    errors.push({ path, message: 'Chaque question doit être un objet.' });
    return null;
  }
  const text = checkText(question.question, `${path}.question`, "L'intitulé de la question", errors);

  if (!Array.isArray(question.choices)) {
    errors.push({ path: `${path}.choices`, message: '"choices" doit être une liste de choix.' });
    return null;
  }
  const { minChoices, maxChoices } = LIMITS;
  if (question.choices.length < minChoices || question.choices.length > maxChoices) {
    errors.push({
      path: `${path}.choices`,
      message: `Une question doit avoir entre ${minChoices} et ${maxChoices} choix (actuellement ${question.choices.length}).`,
    });
  }

  const choices = question.choices.map((c, i) => validateChoice(c, `${path}.choices[${i}]`, errors));
  const valid = choices.filter((c): c is Choice => c !== null);

  if (valid.length === question.choices.length && !valid.some((c) => c.correct)) {
    errors.push({ path: `${path}.choices`, message: 'Au moins un choix doit être marqué comme correct.' });
  }
  const texts = valid.map((c) => c.text.toLowerCase()).filter(Boolean);
  if (new Set(texts).size !== texts.length) {
    errors.push({ path: `${path}.choices`, message: 'Deux choix ont le même texte.' });
  }

  const multiple = valid.filter((c) => c.correct).length > 1;
  return { question: text, multiple, choices: valid };
}

export function validateQuiz(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: [{ path: '', message: 'Le fichier doit contenir un objet JSON.' }] };
  }

  const title = checkText(input.title, 'title', 'Le titre du QCM', errors, LIMITS.maxTitleLength);

  let passingScore: number | null = null;
  if (input.passingScore !== undefined) {
    const s = input.passingScore;
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 0 || s > 100) {
      errors.push({ path: 'passingScore', message: '"passingScore" doit être un entier entre 0 et 100.' });
    } else {
      passingScore = s;
    }
  }

  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    errors.push({ path: 'questions', message: '"questions" doit être une liste non vide.' });
    return { ok: false, errors };
  }
  if (input.questions.length > LIMITS.maxQuestions) {
    errors.push({ path: 'questions', message: `Un QCM ne peut pas dépasser ${LIMITS.maxQuestions} questions.` });
  }

  const questions = input.questions
    .map((q, i) => validateQuestion(q, `questions[${i}]`, errors))
    .filter((q): q is Question => q !== null);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, quiz: { title, passingScore, questions } };
}

// Point d'entrée pour le contenu brut d'un fichier uploadé.
export function parseQuizFile(content: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ path: '', message: `JSON invalide : ${reason}` }] };
  }
  return validateQuiz(data);
}
