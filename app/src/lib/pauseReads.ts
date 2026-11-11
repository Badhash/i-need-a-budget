import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { enqueue } from './mutationQueue'

// Lectures interrompues en attente de relance, par cle (dedup des rafales).
const interrupted = new Set<string>()

/**
 * A appeler dans le `onMutate` d'une mutation optimiste, a la place de
 * `queryClient.cancelQueries` : annule les lectures en vol de la cle (leur
 * reponse, anterieure a l'ecriture, ecraserait le patch optimiste) puis, si
 * une lecture a bien ete interrompue, la RELANCE derriere la file d'ecritures.
 *
 * Sans cette relance, la lecture annulee etait perdue : `setQueryData` remet la
 * query « fraiche » (staleTime infini), donc plus rien ne la relisait. Les
 * donnees qu'elle apportait (imports de la synchro, mois perime) manquaient
 * jusqu'a la reconciliation suivante.
 */
export async function pauseReads(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  const wasFetching = queryClient.isFetching({ queryKey }) > 0
  await queryClient.cancelQueries({ queryKey })
  if (!wasFetching) return
  const hash = hashKey(queryKey)
  if (interrupted.has(hash)) return
  interrupted.add(hash)
  // Differe d'un tick : l'ecriture de la mutation appelante est enfilee juste
  // apres son onMutate, la relance doit passer DERRIERE elle dans la file.
  setTimeout(() => {
    void enqueue(async () => {
      interrupted.delete(hash)
      void queryClient.invalidateQueries({ queryKey })
    })
  }, 0)
}
