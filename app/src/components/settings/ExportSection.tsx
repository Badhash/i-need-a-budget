import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { apiCall } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function ExportSection() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onExport() {
    setError(null)
    setBusy(true)
    try {
      const data = await apiCall<unknown>('exportData')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'inab-export.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("L'export a echoue, reessaie.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exporter mes donnees</CardTitle>
        <p className="text-[13px] text-soft">
          Telecharge l'integralite de ton budget dechiffre au format JSON (comptes, categories,
          transactions, objectifs, regles).
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="outline" onClick={() => void onExport()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Exporter mes donnees (JSON)
        </Button>
        {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
      </CardContent>
    </Card>
  )
}
