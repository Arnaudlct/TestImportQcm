// Import d'un QCM au format CSV (voir FORMAT.md) : une ligne par question.
// Le CSV est converti en objet puis passé à validateQuiz, qui reste la seule
// source des règles ; les emplacements d'erreur sont traduits en « ligne N, colonne X ».

import { parseQuizFile, validateQuiz, type ValidationError, type ValidationResult } from './validateQuiz';

export const CHOICE_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export interface CsvQuizOptions {
  // Le CSV ne contient que les questions : titre et seuil viennent du formulaire d'import.
  title: string;
  passingScore?: number;
}

interface CsvRecord {
  line: number; // ligne du fichier où commence l'enregistrement (1 = en-tête)
  cells: string[];
}

// Excel enregistre souvent en Windows-1252 (« CSV séparateur point-virgule ») :
// on tente l'UTF-8 strict, sinon on retombe sur Windows-1252.
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Séparateur le plus fréquent sur la première ligne, hors guillemets.
function detectSeparator(content: string): string {
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const ch of content) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// Lecture CSV (RFC 4180) : champs entre guillemets, "" pour un guillemet,
// retours à la ligne dans un champ, fins de ligne \n ou \r\n.
function readRecords(content: string, sep: string): { records: CsvRecord[]; unclosedQuoteLine: number | null } {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    records.push({ line: recordLine, cells });
    cells = [];
    cell = '';
  };

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
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) return { records, unclosedQuoteLine: recordLine };
  if (cell !== '' || cells.length > 0) endRecord();
  return { records, unclosedQuoteLine: null };
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const ANSWER_HEADERS = ['reponse', 'reponses', 'bonne reponse', 'bonnes reponses'];

export function parseQuizCsv(content: string, options: CsvQuizOptions): ValidationResult {
  const text = content.replace(/^﻿/, '');
  const sep = detectSeparator(text);
  const { records, unclosedQuoteLine } = readRecords(text, sep);

  if (unclosedQuoteLine !== null) {
    return { ok: false, errors: [{ path: `ligne ${unclosedQuoteLine}`, message: 'Guillemet ouvert jamais refermé.' }] };
  }
  const rows = records.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (rows.length === 0) {
    return { ok: false, errors: [{ path: '', message: 'Le fichier est vide.' }] };
  }

  // En-tête : question, A…H (au moins deux), réponses — dans cet ordre.
  const header = rows[0].cells.map(normalize);
  const letters = header.slice(1, -1).map((h) => h.toUpperCase());
  const expected = CHOICE_COLUMNS.slice(0, letters.length);
  if (
    header[0] !== 'question' ||
    !ANSWER_HEADERS.includes(header[header.length - 1]) ||
    letters.length < 2 ||
    letters.length > CHOICE_COLUMNS.length ||
    letters.some((l, i) => l !== expected[i])
  ) {
    return {
      ok: false,
      errors: [
        {
          path: 'ligne 1',
          message: `En-tête attendu : question${sep}A${sep}B${sep}…${sep}reponses (de 2 à ${CHOICE_COLUMNS.length} colonnes de choix, de A à H).`,
        },
      ],
    };
  }

  if (rows.length === 1) {
    return { ok: false, errors: [{ path: '', message: "Aucune question sous la ligne d'en-tête." }] };
  }

  const errors: ValidationError[] = [];
  const answerErrorLines = new Set<number>();
  // Pour chaque question : sa ligne et la lettre de chaque choix gardé.
  const sources: { line: number; letters: string[] }[] = [];

  const questions = rows.slice(1).map((row) => {
    const at = `ligne ${row.line}`;
    if (row.cells.length > header.length) {
      errors.push({ path: at, message: `Trop de colonnes (${row.cells.length} au lieu de ${header.length}).` });
    }
    const cell = (i: number) => (row.cells[i] ?? '').trim();

    const choices: { text: string; correct: boolean }[] = [];
    const kept: string[] = [];
    letters.forEach((letter, i) => {
      const value = cell(i + 1);
      if (value !== '') {
        choices.push({ text: value, correct: false });
        kept.push(letter);
      }
    });

    const answer = cell(header.length - 1).toUpperCase();
    const answerCol = `${at}, colonne reponses`;
    const picked = answer.replace(/[\s,;+/]/g, '');
    if (!/^[A-Z]*$/.test(picked)) {
      errors.push({ path: answerCol, message: `"${answer}" : indique les lettres des bonnes réponses, par exemple A ou A,C.` });
      answerErrorLines.add(row.line);
    } else {
      for (const letter of picked) {
        const index = kept.indexOf(letter);
        if (index === -1) {
          errors.push({ path: answerCol, message: `La réponse ${letter} désigne une case de choix vide ou inexistante.` });
          answerErrorLines.add(row.line);
        } else {
          choices[index].correct = true;
        }
      }
    }

    sources.push({ line: row.line, letters: kept });
    return { question: cell(0), choices };
  });

  const result = validateQuiz({ title: options.title, passingScore: options.passingScore, questions });
  if (result.ok && errors.length === 0) return result;

  // Traduction des emplacements de validateQuiz vers le vocabulaire du tableur.
  const translated = (result.ok ? [] : result.errors).flatMap((e): ValidationError[] => {
    const m = e.path.match(/^questions\[(\d+)\](?:\.(question|choices)(?:\[(\d+)\])?)?/);
    if (!m) {
      const label = e.path === 'title' ? 'titre' : e.path === 'passingScore' ? 'seuil' : e.path === 'questions' ? '' : e.path;
      return [{ path: label, message: e.message }];
    }
    const src = sources[Number(m[1])];
    const at = `ligne ${src.line}`;
    if (m[2] === 'question') return [{ path: `${at}, colonne question`, message: e.message }];
    if (m[3] !== undefined) return [{ path: `${at}, colonne ${src.letters[Number(m[3])]}`, message: e.message }];
    if (/correct/.test(e.message)) {
      if (answerErrorLines.has(src.line)) return [];
      return [{ path: `${at}, colonne reponses`, message: 'Aucune bonne réponse : indique au moins une lettre (A, B…).' }];
    }
    return [{ path: at, message: e.message }];
  });

  const all = [...errors, ...translated].sort((a, b) => lineOf(a) - lineOf(b));
  return { ok: false, errors: all };
}

const lineOf = (e: ValidationError) => Number(e.path.match(/^ligne (\d+)/)?.[1] ?? 0);

// Point d'entrée de l'upload : choisit le format selon l'extension du fichier.
export function parseQuizUpload(fileName: string, bytes: Uint8Array, options: CsvQuizOptions): ValidationResult {
  const content = decodeText(bytes);
  return /\.csv$/i.test(fileName) ? parseQuizCsv(content, options) : parseQuizFile(content);
}
