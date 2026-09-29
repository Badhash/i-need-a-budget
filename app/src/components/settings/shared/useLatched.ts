import { useRef } from 'react'

/**
 * Derniere valeur non nulle : une feuille fermee par son parent (valeur remise
 * a null) garde son contenu le temps de son animation de sortie au lieu de se
 * vider d'un coup.
 */
export function useLatched<T>(value: T | null): T | null {
  const last = useRef<T | null>(value)
  if (value !== null) last.current = value
  return value ?? last.current
}
