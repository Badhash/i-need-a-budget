import { Outlet } from '@tanstack/react-router'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav, Fab } from '@/components/layout/BottomNav'
import { AddTransactionDialog } from '@/components/transactions/AddTransactionDialog'
import { useThemeController } from '@/hooks/useTheme'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'

export function AppShell() {
  useThemeController()
  useRealtimeSync()

  return (
    <div className="min-h-dvh">
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="mx-auto max-w-content px-4 pb-32 pt-6 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <Fab />
      <AddTransactionDialog />
    </div>
  )
}
