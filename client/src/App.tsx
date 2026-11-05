import { useCallback, useEffect, useState } from 'react';
import { fetchLessons, type Lesson } from './api';
import ExamImport from './ExamImport';

// Page de test : la liste des leçons à gauche, l'import d'examen de la leçon choisie à droite.
export default function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const list = await fetchLessons();
      setLessons(list);
      setSelectedId((id) => id ?? list[0]?.lessonId ?? null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const lesson = lessons.find((l) => l.lessonId === selectedId);

  return (
    <div className="page">
      <header className="top">
        <p className="eyebrow">Corelab · espace professeur</p>
        <h1>Examens des leçons</h1>
      </header>

      {error && <p className="banner error">{error} Le serveur et la base sont-ils lancés ?</p>}

      <div className="layout">
        <nav className="lessons" aria-label="Leçons">
          {lessons.map((l) => (
            <button
              key={l.lessonId}
              type="button"
              className={'lesson' + (l.lessonId === selectedId ? ' active' : '')}
              aria-current={l.lessonId === selectedId}
              onClick={() => setSelectedId(l.lessonId)}
            >
              <span className="lesson-module">{l.module}</span>
              <span className="lesson-title">{l.title}</span>
              <span className={'pill' + (l.exam ? ' pill-ok' : '')}>
                {l.exam ? `Examen : ${l.exam.questionCount} questions, seuil ${l.exam.threshold} %` : 'Pas encore d’examen'}
              </span>
            </button>
          ))}
        </nav>

        {lesson && <ExamImport key={lesson.lessonId} lesson={lesson} onSaved={reload} />}
      </div>
    </div>
  );
}
