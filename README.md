# Corelab · import des examens (dépôt de test)

Projet de test de l'import des QCM dans Corelab, avec la stack du projet : React + Vite, Node.js + Express en TypeScript, PostgreSQL, Vitest + Supertest.

Un professeur choisit une leçon, envoie un fichier CSV ou JSON, voit un aperçu (ou la liste des erreurs, avec ligne et colonne), puis confirme. L'examen est alors écrit dans `exams`, `mcq_questions` et `mcq_choices`, en une seule transaction.

## Lancer le projet

Prérequis : Node.js 20 ou plus, et Docker (ou un PostgreSQL 16 local).

```bash
# 1. Base de données : schéma Corelab + données de démo (1 professeur, 3 leçons)
docker compose up -d db

# 2. API sur http://localhost:3000
cd server
npm install
npm run dev

# 3. Front sur http://localhost:5173 (dans un autre terminal)
cd client
npm install
npm run dev
```

Ouvre http://localhost:5173, choisis une leçon et importe `server/src/exam-import/exemple-qcm.csv`.

Sans Docker, crée une base, exécute `db/schema.sql` puis `db/seed-dev.sql`, et donne son adresse au serveur : `DATABASE_URL=postgres://user:mdp@localhost:5432/corelab npm run dev`.

## Format CSV

Une ligne par question, la première ligne est l'en-tête :

```csv
question;A;B;C;D;reponses
Que signifie HTML ?;HyperText Markup Language;High Tech Modern Language;Home Tool Markup Language;;A
Quelles balises servent à créer une liste ?;<ul>;<ol>;<list>;<li-group>;A,B
```

- De 2 à 8 choix (colonnes A à H). Une case vide veut dire pas de choix.
- `reponses` contient les lettres des bonnes réponses ; plusieurs lettres = réponses multiples (`A,C`, `A+C`, `A C`).
- Séparateur `;`, `,` ou tabulation ; encodage UTF-8 ou Windows-1252 (CSV d'Excel en français), détectés tout seuls.
- Le titre (200 caractères max) et le seuil (obligatoire, 0 à 100) sont saisis dans le formulaire.

Le modèle est téléchargeable sur `GET /api/exam-template.csv`.

## API

| Route | Envoi (multipart) | Réponse |
|---|---|---|
| `GET /api/lessons` | rien | les leçons et leur examen éventuel |
| `POST /api/lessons/:lessonId/exam/preview` | `file`, `title`, `threshold` | `200 { ok, quiz, existing }`, rien n'est écrit |
| `POST /api/lessons/:lessonId/exam` | les mêmes champs | `201 { ok, examId, questionCount, replacedQuestions }` |
| `GET /api/exam-template.csv` | rien | le modèle CSV |

Erreurs : `422 { ok: false, errors: [{ path, message }] }` (toutes les erreurs d'un coup), `401`/`403` si l'utilisateur n'est pas professeur, `404` leçon inconnue, `413` fichier de plus de 1 Mo, `415` ni `.csv` ni `.json`.

Un réimport remplace les questions de l'examen et garde son `exam_id`, donc les résultats de `result_exam` sont conservés. `existing` dans l'aperçu permet de prévenir le professeur.

## Authentification

`server/src/auth.ts` est provisoire : l'utilisateur « connecté » est celui de `DEV_USER_EMAIL` (par défaut `prof@corelab.test`), et le middleware vérifie qu'il a le rôle `professeur` dans la table `role`. Dans Corelab, il faut le brancher sur la vraie session en gardant ce contrôle de rôle.

## Tests

```bash
cd server
npm test            # 40 tests sans base (validation, CSV) ; ceux qui touchent la base sont ignorés
```

Pour lancer aussi les 8 tests qui touchent la base (import, réimport, transaction, routes, droits), démarre la base de test puis indique son adresse :

```bash
docker compose up -d db-test
TEST_DATABASE_URL=postgres://corelab:corelab@localhost:5433/corelab_test npm test                 # bash
$env:TEST_DATABASE_URL="postgres://corelab:corelab@localhost:5433/corelab_test"; npm test        # PowerShell
```

Ces tests vident les tables de la base qu'on leur donne : utilise toujours `db-test`, jamais la base de développement.

## Organisation

```
db/schema.sql                    schéma Corelab
db/seed-dev.sql                  données de démo
server/src/exam-import/          module d'import (validation, lecture CSV, enregistrement, routes) et ses tests
server/src/app.ts                application Express
server/src/auth.ts               contrôle du rôle professeur (provisoire)
client/src/ExamImport.tsx        formulaire, aperçu, erreurs, confirmation
```
