import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/**
 * Le thème est piloté par variables CSS, jamais par classes générées à la
 * volée. C'est ce qui permet à chaque tenant d'appliquer SES deux couleurs sans
 * qu'aucun client puisse déformer la structure des écrans (CMD §5).
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        brand: {
          DEFAULT: 'var(--brand-primary)',
          foreground: 'var(--brand-primary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--brand-secondary)',
          foreground: 'var(--brand-secondary-foreground)',
        },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // Sémantique métier : les statuts ne changent pas d'une entreprise à
        // l'autre. Un écart critique doit se lire pareil chez tous les clients.
        status: {
          ok: 'hsl(142 62% 34%)',
          warn: 'hsl(38 92% 45%)',
          critical: 'hsl(0 72% 45%)',
          neutral: 'hsl(215 16% 47%)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [animate],
} satisfies Config
