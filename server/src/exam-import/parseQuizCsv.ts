// Lecture et vérification d'un QCM au format CSV (voir FORMAT.md) : une ligne par question.
// Chaque erreur est située directement dans le tableur : « ligne N, colonne X ».

export const LIMITS = { maxQuestions: 100, maxTextLength: 1000 } as const;
export const CHOICE_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export interface Choice {
  text: string;
  correct: boolean;
}

export interface Question {
  question: string;
  multiple: boolean;
  choices: Choice[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export type CsvResult = { ok: true; questions: Question[] } | { ok: false; errors: ValidationError[] };

// Excel enregistre souvent en Windows-1252 (« CSV séparateur point-virgule ») :
// on tente l'UTF-8 strict, sinon on retombe sur Windows-1252.
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Séparateur le plus fréquent sur la première ligne.
function detectSeparator(content: string): string {
  const firstLine = content.split(/\r?\n/, 1)[0];
  const count = (sep: string) => firstLine.split(sep).length;
  return [';', ',', '\t'].reduce((best, sep) => (count(sep) > count(best) ? sep : best));
}

// Lecture CSV (RFC 4180) : champs entre guillemets, "" pour un guillemet,
// retours à la ligne dans un champ, fins de ligne \n ou \r\n.
// Chaque ligne lue garde le numéro de ligne du fichier où elle commence.
function readRows(content: string, sep: string): { line: number; cells: string[] }[] | { unclosedQuoteLine: number } {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      rows.push({ line: rowLine, cells: [...cells, cell] });
      cells = [];
      cell = '';
      rowLine = ++line;
    } else {
      cell += ch;
    }
  }
  if (quoted) return { unclosedQuoteLine: rowLine };
  if (cell !== '' || cells.length > 0) rows.push({ line: rowLine, cells: [...cells, cell] });
  return rows;
}

// Sans accents ni majuscules, pour lire l'en-tête « Réponses » comme « reponses ».
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function parseQuizCsv(content: string): CsvResult {
  const text = content.replace(/^﻿/, '');
  const sep = detectSeparator(text);
  const read = readRows(text, sep);
  if (!Array.isArray(read)) {
    return { ok: false, errors: [{ path: `ligne ${read.unclosedQuoteLine}`, message: 'Guillemet ouvert jamais refermé.' }] };
  }

  const rows = read.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (rows.length === 0) return { ok: false, errors: [{ path: '', message: 'Le fichier est vide.' }] };

  // En-tête : question, A…H (au moins deux), reponses, dans cet ordre.
  const header = rows[0].cells.map(normalize);
  const letters = header.slice(1, -1).map((h) => h.toUpperCase());
  if (
    header[0] !== 'question' ||
    !['reponse', 'reponses'].includes(header[header.length - 1]) ||
    letters.length < 2 ||
    letters.join('') !== CHOICE_COLUMNS.slice(0, letters.length).join('')
  ) {
    const example = ['question', 'A', 'B', '…', 'reponses'].join(sep);
    return { ok: false, errors: [{ path: 'ligne 1', message: `En-tête attendu : ${example} (de 2 à 8 colonnes de choix, de A à H).` }] };
  }

  const lines = rows.slice(1);
  if (lines.length === 0) return { ok: false, errors: [{ path: '', message: "Aucune question sous la ligne d'en-tête." }] };

  const errors: ValidationError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });
  if (lines.length > LIMITS.maxQuestions) fail('', `Un QCM ne peut pas dépasser ${LIMITS.maxQuestions} questions.`);

  const questions = lines.map((row): Question => {
    const at = `ligne ${row.line}`;
    const cell = (i: number) => (row.cells[i] ?? '').trim();
    const tooLong = (value: string, column: string) => {
      if (value.length > LIMITS.maxTextLength) fail(`${at}, colonne ${column}`, `Le texte dépasse ${LIMITS.maxTextLength} caractères.`);
    };

    if (row.cells.length > header.length) fail(at, `Trop de colonnes (${row.cells.length} au lieu de ${header.length}).`);

    const question = cell(0);
    if (question === '') fail(`${at}, colonne question`, "L'intitulé de la question est obligatoire.");
    tooLong(question, 'question');

    // Les cases vides sont ignorées : les choix gardent leur lettre de colonne.
    const filled = letters.map((letter, i) => ({ letter, text: cell(i + 1) })).filter((c) => c.text !== '');
    filled.forEach((c) => tooLong(c.text, c.letter));
    if (filled.length < 2) fail(at, 'Une question doit avoir au moins 2 choix remplis.');
    const texts = filled.map((c) => c.text.toLowerCase());
    if (new Set(texts).size !== texts.length) fail(at, 'Deux choix ont le même texte.');

    // Bonnes réponses : « A », « A,C », « A+C », « A C » ou « ac ».
    const answerAt = `${at}, colonne reponses`;
    const answer = cell(header.length - 1).toUpperCase();
    const picked = answer.replace(/[\s,;+/]/g, '');
    if (!/^[A-Z]*$/.test(picked)) {
      fail(answerAt, `"${answer}" : indique les lettres des bonnes réponses, par exemple A ou A,C.`);
    } else if (picked === '') {
      fail(answerAt, 'Aucune bonne réponse : indique au moins une lettre (A, B…).');
    } else {
      for (const letter of picked) {
        if (!filled.some((c) => c.letter === letter)) fail(answerAt, `La réponse ${letter} désigne une case de choix vide ou inexistante.`);
      }
    }

    const choices = filled.map((c) => ({ text: c.text, correct: picked.includes(c.letter) }));
    return { question, multiple: choices.filter((c) => c.correct).length > 1, choices };
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, questions };
}
