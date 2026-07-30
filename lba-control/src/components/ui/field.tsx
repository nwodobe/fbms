import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Champ de formulaire avec libellé, aide et erreur.
 *
 * L'erreur porte `role="alert"` et le champ est relié par `aria-describedby` :
 * une erreur qui n'est signalée que par une bordure rouge n'existe pas pour un
 * lecteur d'écran, et se remarque mal en plein soleil sur un téléphone.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  className?: string
  children: ReactNode
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>

      <div data-describedby={describedBy || undefined}>{children}</div>

      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
