import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getSuperadminStatus } from '@services/ee/superadmin'
import { useVBSession } from '@components/Contexts/VBSessionContext'

export default function useSuperadminStatus() {
  const session = useVBSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.superadmin.status(),
    queryFn: () => getSuperadminStatus(accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return {
    isSuperadmin: data?.is_superadmin === true,
    isLoading,
    isError: !!error,
  }
}
