import { useState, type FormEvent } from 'react';
import { previewExam, saveExam, type ApiError, type ExamSummary, type Lesson, type Quiz } from './api';

const LETTERS = 'ABCDEFGH';

type Step =
  | { kind: 'form' }
  | { kind: 'errors'; errors: ApiError[] }
  | { kind: 'preview'; quiz: Quiz; existing: ExamSummary | null }
  | { kind: 'saved'; questionCount: number; replacedQuestions: number };

// Import en deux temps : aperçu sans rien enregistrer, puis confirmation.
export default function ExamImport({ lesson, onSaved }: { lesson: Lesson; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(lesson.exam?.title ?? '');
  // Le titre suit le nom du fichier tant que le professeur ne l'a pas tapé lui-même.
  const [titleFromFile, setTitleFromFile] = useState(!lesson.exam);
  const [threshold, setThreshold] = useState(lesson.exam ? String(lesson.exam.threshold) : '');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [busy, setBusy] = useState(false);

  function pickFile(f: File | null) {
    setFile(f);
    setStep({ kind: 'form' });
    if (f && titleFromFile) setTitle(f.name.replace(/\.(csv|json)$/i, ''));
  }

  async function onPreview(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    const result = await previewExam(lesson.lessonId, file, title, threshold);
    setBusy(false);
    setStep(result.ok ? { kind: 'preview', quiz: result.quiz, existing: result.existing } : { kind: 'errors', errors: result.errors });
  }

  async function onConfirm() {
    if (!file) return;
    setBusy(true);
    const result = await saveExam(lesson.lessonId, file, title, threshold);
    setBusy(false);
    if (!result.ok) {
      setStep({ kind: 'errors', errors: result.errors });
      return;
    }
    setStep({ kind: 'saved', questionCount: result.questionCount, replacedQuestions: result.replacedQuestions });
    onSaved();
  }

  return (
    <section className="panel" aria-labelledby="import-title">
      <div className="panel-head">
        <h2 id="import-title">{lesson.exam ? 'Remplacer l’examen' : 'Ajouter un examen'}</h2>
        <p className="muted">Leçon « {lesson.title} »</p>
      </div>

      <form className="form" onSubmit={onPreview}>
        <div className="field">
          <label htmlFor="exam-file">Fichier CSV ou JSON</label>
          <input id="exam-file" type="file" accept=".csv,.json" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          <a className="hint" href="/api/exam-template.csv">Télécharger le modèle CSV</a>
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor="exam-title">Titre de l’examen</label>
            <input
              id="exam-title"
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleFromFile(false);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="exam-threshold">Seuil de réussite (%)</label>
            <input id="exam-threshold" type="number" min={0} max={100} step={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={!file || busy}>
            {busy && step.kind === 'form' ? 'Vérification…' : 'Voir l’aperçu'}
          </button>
          {!file && <span className="muted">Choisis un fichier pour commencer.</span>}
        </div>
      </form>

      {step.kind === 'errors' && (
        <div className="result">
          <p className="banner error">
            {step.errors.length} {step.errors.length > 1 ? 'erreurs à corriger' : 'erreur à corriger'} : rien n’a été enregistré.
          </p>
          <ul className="errors">
            {step.errors.map((e, i) => (
              <li key={i}>
                <span className="where">{e.path || 'fichier'}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.kind === 'preview' && (
        <div className="result">
          {step.existing ? (
            <p className="banner warning">
              Ce fichier remplacera les {step.existing.questionCount} questions actuelles.{' '}
              {step.existing.resultCount
                ? `${step.existing.resultCount} résultat(s) déjà enregistré(s) sont conservés.`
                : 'Aucun étudiant ne l’a encore passé.'}
            </p>
          ) : (
            <p className="banner ok">Fichier valide : vérifie l’aperçu puis confirme.</p>
          )}
          <h3 className="exam-title">{step.quiz.title}</h3>
          <p className="muted">
            {step.quiz.questions.length} questions · seuil {step.quiz.passingScore} %
          </p>
          <ol className="questions">
            {step.quiz.questions.map((q, i) => (
              <li key={i} className="question">
                <div className="question-head">
                  <span className="q-num">Q{i + 1}</span>
                  <span className="q-text">{q.question}</span>
                  {q.multiple && <span className="badge">Réponses multiples</span>}
                </div>
                <ul className="choices">
                  {q.choices.map((c, j) => (
                    <li key={j} className={'choice' + (c.correct ? ' correct' : '')}>
                      <span className="letter">{LETTERS[j]}</span>
                      <span className="choice-text">{c.text}</span>
                      {c.correct && <span className="tag">bonne réponse</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <div className="actions sticky">
            <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
              {busy ? 'Enregistrement…' : 'Confirmer l’import'}
            </button>
            <button type="button" onClick={() => setStep({ kind: 'form' })} disabled={busy}>
              Changer de fichier
            </button>
          </div>
        </div>
      )}

      {step.kind === 'saved' && (
        <p className="banner ok">
          Examen enregistré : {step.questionCount} questions
          {step.replacedQuestions ? `, ${step.replacedQuestions} anciennes questions remplacées` : ''}.
        </p>
      )}
    </section>
  );
}
