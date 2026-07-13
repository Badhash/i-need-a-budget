import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { LogOut, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function AccountSection() {
  const navigate = useNavigate()
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
      setLoading(false)
    })
  }, [])

  async function onSignOut() {
    await supabase.auth.signOut()
    void navigate({ to: '/login' })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compte</CardTitle>
        <p className="text-[13px] text-soft">Ton identifiant de connexion.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface2 text-soft">
            <Mail className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="label-caps">Email</p>
            {loading ? (
              <Skeleton className="mt-1 h-5 w-48" />
            ) : (
              <p className="truncate font-medium">{email ?? 'Inconnu'}</p>
            )}
          </div>
        </div>
        <Button variant="outline" onClick={() => void onSignOut()}>
          <LogOut className="h-4 w-4" />
          Se deconnecter
        </Button>
      </CardContent>
    </Card>
  )
}
