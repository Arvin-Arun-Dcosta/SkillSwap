import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { NotificationDTO, NotificationList } from '@skillswap/shared';
import { Avatar, IconButton, Menu, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';

const KEY = ['notifications'] as const;

export function NotificationsMenu() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // New notifications arrive over the socket, which invalidates this query; the slow refetch
  // interval only covers the case where the socket is down.
  const { data, isPending, isError } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<NotificationList>('/notifications'),
    refetchInterval: 120_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const unread = data?.unreadCount ?? 0;
  const open = (notification: NotificationDTO, close: () => void) => {
    if (!notification.read) markRead.mutate(notification.id);
    close();
    if (notification.link) void navigate(notification.link);
  };

  return (
    <Menu
      panelClassName="w-88 p-0"
      trigger={(props) => (
        <IconButton
          label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative"
          {...props}
        >
          <Bell className="size-5" aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-4.5 text-on-danger"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-bold">Notifications</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-sm font-semibold text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {isPending && (
              <div className="flex justify-center p-6">
                <Spinner label="Loading notifications" />
              </div>
            )}
            {isError && (
              <p className="p-4 text-sm text-danger" role="alert">
                Notifications could not be loaded.
              </p>
            )}
            {data && data.items.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">
                Nothing yet. Proposals, sessions and reviews will show up here.
              </p>
            )}
            <ul>
              {data?.items.map((notification) => (
                <li key={notification.id} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    onClick={() => open(notification, close)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2',
                      !notification.read && 'bg-teach-bg/40',
                    )}
                  >
                    {notification.sender ? (
                      <Avatar user={notification.sender} size="sm" />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
                        <Bell className="size-4" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{notification.title}</span>
                        {!notification.read && (
                          <span className="size-2 shrink-0 rounded-full bg-primary">
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {notification.message}
                      </span>
                      <span className="mt-1 block text-xs text-muted">
                        {formatRelative(notification.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Menu>
  );
}
