import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Socket.IO connection hook.
 *
 * Connects to the server on mount with credentials (httpOnly cookie).
 * Listens for 'email:event' and invalidates dashboard/events query caches
 * so TanStack Query refetches fresh data automatically.
 *
 * Uses useRef to prevent reconnection on re-renders.
 */
export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Create socket connection exactly ONCE
    if (socketRef.current) return;

    const socket = io({ withCredentials: true });
    socketRef.current = socket;

    socket.on('email:event', () => {
      // Invalidate dashboard and events queries to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    });

    socket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [queryClient]);

  return socketRef;
}
