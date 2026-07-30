import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Les couleurs de statut ne sont PAS celles de la marque du tenant : un écart
 * critique doit se lire de la même façon chez tous les clients.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-muted text-muted-foreground',
        ok: 'border-transparent bg-status-ok/15 text-status-ok',
        warn: 'border-transparent bg-status-warn/15 text-status-warn',
        critical: 'border-transparent bg-status-critical/15 text-status-critical',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
