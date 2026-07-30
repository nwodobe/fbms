import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * Chromium préinstallé.
 *
 * L'environnement d'exécution fournit une version de Chromium qui ne correspond
 * pas forcément à celle attendue par la version de @playwright/test installée.
 * Plutôt que de retélécharger un navigateur à chaque exécution, on pointe sur
 * le binaire présent quand il existe, et on laisse Playwright choisir sinon.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined

/**
 * Parcours P0 de bout en bout.
 *
 * Le projet « mobile » n'est pas décoratif : les pisteurs travaillent sur des
 * téléphones Android d'entrée de gamme, en réseau faible. Un parcours qui ne
 * passe que sur un écran de bureau ne prouve rien pour eux.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Africa/Abidjan',
  },

  projects: [
    {
      name: 'bureau',
      use: { ...devices['Desktop Chrome'], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
    {
      name: 'mobile-android',
      use: { ...devices['Pixel 5'], ...(executablePath ? { launchOptions: { executablePath } } : {}) },
    },
  ],

  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
