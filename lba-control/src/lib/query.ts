import { QueryClient } from '@tanstack/react-query'

/**
 * Cache serveur.
 *
 * `retry: 1` volontairement bas : sur un réseau instable, un empilement de
 * tentatives silencieuses donne l'impression que l'application est figée. Mieux
 * vaut afficher l'échec vite et laisser l'utilisateur relancer — les écritures
 * terrain, elles, ne dépendent pas de ce cache mais de la file hors ligne.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: 0,
      networkMode: 'offlineFirst',
    },
  },
})
