import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Écran annoncé mais pas encore construit.
 *
 * Il affiche explicitement ce qui n'existe pas encore, plutôt que des chiffres
 * de démonstration. Un tableau de bord rempli de valeurs inventées donnerait
 * l'impression d'un produit fonctionnel et ferait prendre des décisions sur du
 * vide — c'est exactement ce que ce projet cherche à éviter.
 */
export function PhasePlaceholder({
  title,
  phase,
  summary,
  delivers,
}: {
  title: string
  phase: number
  summary: string
  delivers: string[]
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{summary}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Écran prévu en phase {phase}</CardTitle>
          <CardDescription>
            Le schéma de données, les contraintes et les politiques de sécurité de ce module sont déjà
            en place et testés. L’interface est construite en phase {phase}. Aucune donnée n’est
            simulée ici : ce qui n’est pas calculé n’est pas affiché.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm font-medium">Contenu attendu :</p>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {delivers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
