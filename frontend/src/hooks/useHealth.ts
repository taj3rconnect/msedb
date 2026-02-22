import { useQuery } from '@tanstack/react-query';

interface HealthResponse {
  status: string;
  version: string;
  buildDate: string;
  services: {
    mongodb: string;
    redis: string;
  };
  mongoHost: string;
}

export function useHealth() {
  const query = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      return res.json();
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const data = query.data;

  return {
    isHealthy: data?.status === 'healthy',
    mongoStatus: data?.services?.mongodb ?? 'unknown',
    redisStatus: data?.services?.redis ?? 'unknown',
    mongoHost: data?.mongoHost ?? 'unknown',
    version: data?.version ?? '',
    buildDate: data?.buildDate ?? '',
  };
}
