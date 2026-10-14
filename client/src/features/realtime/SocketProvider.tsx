import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@skillswap/shared';
import { useToast } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketValue {
  /** Null while signed out. */
  socket: AppSocket | null;
  connected: boolean;
  /** Live presence when connected; otherwise the value the API returned with the member. */
  isOnline: (userId: string, fallback?: boolean) => boolean;
}

const SocketContext = createContext<SocketValue>({
  socket: null,
  connected: false,
  isOnline: (_id, fallback = false) => fallback,
});

/**
 * One authenticated socket per signed-in member. The server identifies the member from the
 * session cookie sent with the handshake; nothing about identity is sent from here.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let next: AppSocket | null = null;

    // The real-time client is only downloaded for signed-in members.
    void import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      next = io({ withCredentials: true, transports: ['websocket', 'polling'] });
      setSocket(next);

      next.on('connect', () => setConnected(true));
      next.on('disconnect', () => setConnected(false));
      next.on('presence:sync', (ids) => setOnline(new Set(ids)));
      next.on('presence:changed', ({ userId: id, online: isOn }) => {
        setOnline((current) => {
          const copy = new Set(current);
          if (isOn) copy.add(id);
          else copy.delete(id);
          return copy;
        });
      });
      next.on('notification:new', (notification) => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        // The lists a notification refers to are now stale as well.
        void queryClient.invalidateQueries({ queryKey: ['exchanges'] });
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
        void queryClient.invalidateQueries({ queryKey: ['contracts'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        toast.info(notification.title);
      });
    });

    return () => {
      cancelled = true;
      next?.disconnect();
      setSocket(null);
      setConnected(false);
      setOnline(new Set());
    };
  }, [userId, queryClient, toast]);

  const isOnline = useCallback(
    (id: string, fallback = false) => (connected ? online.has(id) : fallback),
    [connected, online],
  );

  const value = useMemo(() => ({ socket, connected, isOnline }), [socket, connected, isOnline]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketValue {
  return useContext(SocketContext);
}
