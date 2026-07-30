import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { queryClient } from '@/lib/query'
import { SessionProvider, useSession } from '@/lib/auth/session'
import { BrandingProvider } from '@/lib/tenant/branding'
import { AppRouter } from '@/router'

/** La marque dépend du tenant, qui dépend de la session : d'où ce niveau intermédiaire. */
function BrandedApp() {
  const { tenantId } = useSession()
  return (
    <BrandingProvider tenantId={tenantId}>
      <AppRouter />
    </BrandingProvider>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <BrandedApp />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
