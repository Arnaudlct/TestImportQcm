-- Données de démonstration pour tester l'import en local (jamais en production).
INSERT INTO role (role) VALUES ('professeur'), ('etudiant');

INSERT INTO users (last_name, first_name, email, role_id, must_change_password)
VALUES ('Martin', 'Claire', 'prof@corelab.test', (SELECT role_id FROM role WHERE role = 'professeur'), false),
       ('Durand', 'Léo', 'etudiant@corelab.test', (SELECT role_id FROM role WHERE role = 'etudiant'), false);

INSERT INTO module (module_title, description, created_by)
VALUES ('Développement web', 'Les bases du front', (SELECT user_id FROM users WHERE email = 'prof@corelab.test'));

INSERT INTO lessons (lesson_title, module_id)
VALUES ('Les bases du HTML', 1), ('Mettre en forme avec CSS', 1), ('Premiers pas en JavaScript', 1);
