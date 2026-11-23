import { useQueryClient } from '@tanstack/react-query';
import { RefreshButton } from '../../components/ui';
import { useCurrentBusiness } from './CurrentBusiness';

/**
 * "רענון" for a whole page: reloads the data of everything on screen now, without reloading the
 * page (the app otherwise refreshes in the background every 30 seconds at most). Only the queries
 * that are on screen are fetched again.
 */
export function PageRefresh() {
  const queryClient = useQueryClient();
  const business = useCurrentBusiness();
  return (
    <RefreshButton
      onRefresh={() => queryClient.invalidateQueries({ queryKey: ['businesses', business.id] })}
    />
  );
}
