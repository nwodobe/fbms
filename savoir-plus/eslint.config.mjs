// ============================================================================
// Savoir+ — Règles de lint
//
// La partie essentielle de ce fichier n'est pas le style : ce sont les
// FRONTIÈRES DE MODULES (ARCHITECTURE.md §2). Une flèche de dépendance
// inversée est un défaut d'architecture, et le lint doit le dire, pas la
// revue de code.
// ============================================================================

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'drizzle/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // QUALITE_DU_CODE : pas de `any` non justifié.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // --- FRONTIÈRE 1 : le domaine pur n'a aucune dépendance ------------------
  // ARCHITECTURE.md A2 : lib/{scoring,mastery,revision} sont des fonctions
  // pures, testables sans base de données ni navigateur.
  {
    files: ['src/lib/scoring/**', 'src/lib/mastery/**', 'src/lib/revision/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Les deux formes sont nécessaires : « @/server » (module
              // racine) et « @/server/* » (sous-modules). Un motif sans la
              // forme racine laisse passer `import … from '@/server'`.
              group: [
                '@/server',
                '@/server/**',
                '@/app',
                '@/app/**',
                '@/components',
                '@/components/**',
                '@/features',
                '@/features/**',
              ],
              message:
                'Domaine pur : lib/{scoring,mastery,revision} ne doit importer ni serveur, ni UI. Voir ARCHITECTURE.md A2.',
            },
            {
              group: ['drizzle-orm', 'next/*', 'react', 'react-dom'],
              message: 'Domaine pur : aucune dépendance à l’ORM, au framework ou à React.',
            },
          ],
        },
      ],
      // PEDAGOGY.md §7.3 / RV-13 : la date « maintenant » est un PARAMÈTRE
      // injecté. Sans cela, tester « J+30 » exige d'attendre trente jours.
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Domaine pur : la date doit être injectée en paramètre (RV-13).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Domaine pur : `new Date()` interdit. La date est un paramètre (RV-13).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Domaine pur : `Date.now()` interdit. La date est un paramètre (RV-13).',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Domaine pur : `Math.random()` interdit — le scoring doit être déterministe.',
        },
      ],
    },
  },

  // --- FRONTIÈRE 2 : l'UI ne touche jamais la base -------------------------
  // ARCHITECTURE.md A3 : une seule porte vers la base.
  {
    files: ['src/components/**', 'src/app/**', 'src/features/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/db',
                '@/server/db/**',
                '@/server/repositories',
                '@/server/repositories/**',
              ],
              message:
                'Interdit : l’UI n’accède jamais directement à la base. Passer par server/actions puis server/services. Voir ARCHITECTURE.md A3.',
            },
            {
              group: ['@/lib/scoring', '@/lib/scoring/**'],
              message:
                'Interdit : le score est calculé exclusivement côté serveur. Voir DECISIONS.md ADR-005.',
            },
          ],
        },
      ],
    },
  },

  // --- FRONTIÈRE 3 : les repositories ne remontent pas vers les services ---
  {
    files: ['src/server/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/server/services',
                '@/server/services/**',
                '@/server/actions',
                '@/server/actions/**',
              ],
              message:
                'Interdit : un repository ne connaît ni les services ni les actions. Voir ARCHITECTURE.md §2.',
            },
          ],
        },
      ],
    },
  },
);
