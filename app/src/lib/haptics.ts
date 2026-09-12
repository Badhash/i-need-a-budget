// Retour haptique discret (Android/Chrome ; iOS Safari ignore navigator.vibrate,
// sans erreur). Toujours best-effort : jamais bloquant, jamais d'exception.
export function haptic(pattern: number | number[] = 10): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // ignore
  }
}
