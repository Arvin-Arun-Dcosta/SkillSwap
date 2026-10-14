import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type {
  AppConfig,
  LoginInput,
  ProfileUpdateInput,
  RegisterInput,
  SelfUser,
} from '@skillswap/shared';
import { ApiError, api, setUnauthorizedHandler } from '@/lib/api';

const ME_KEY = ['me'] as const;
const CONFIG_KEY = ['config'] as const;

interface AuthValue {
  user: SelfUser | null;
  /** True until the first "who am I" request has settled. */
  loading: boolean;
  login: (input: LoginInput) => Promise<SelfUser>;
  register: (input: RegisterInput) => Promise<SelfUser>;
  demoLogin: (username: string) => Promise<SelfUser>;
  logout: () => Promise<void>;
  updateProfile: (input: ProfileUpdateInput) => Promise<SelfUser>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

async function fetchMe(): Promise<SelfUser | null> {
  try {
    // The endpoint answers `user: null` for signed-out visitors.
    return (await api.get<{ user: SelfUser | null }>('/auth/me')).user;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  /** Replaces the signed-in member and drops everything cached for the previous one. */
  const setUser = useCallback(
    (user: SelfUser | null) => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'me' && query.queryKey[0] !== 'config',
      });
      queryClient.setQueryData(ME_KEY, user);
    },
    [queryClient],
  );

  useEffect(() => {
    // Any request that finds the session expired signs the member out locally.
    setUnauthorizedHandler(() => {
      if (queryClient.getQueryData(ME_KEY)) setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient, setUser]);

  const value = useMemo<AuthValue>(() => {
    const signIn = async (path: string, body: unknown) => {
      const { user } = await api.post<{ user: SelfUser }>(path, body);
      setUser(user);
      return user;
    };
    return {
      user: data ?? null,
      loading: isPending,
      login: (input) => signIn('/auth/login', input),
      register: (input) => signIn('/auth/register', input),
      demoLogin: (username) => signIn('/auth/demo-login', { username }),
      logout: async () => {
        await api.post('/auth/logout').catch(() => undefined);
        setUser(null);
      },
      updateProfile: async (input) => {
        const { user } = await api.patch<{ user: SelfUser }>('/auth/me', input);
        queryClient.setQueryData(ME_KEY, user);
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== 'me' && query.queryKey[0] !== 'config',
        });
        return user;
      },
      refresh: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
    };
  }, [data, isPending, queryClient, setUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Public runtime configuration: demo mode, ICE servers, upload limit. */
export function useConfig(): AppConfig | undefined {
  const { data } = useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => api.get<AppConfig>('/auth/config'),
    staleTime: Infinity,
  });
  return data;
}
