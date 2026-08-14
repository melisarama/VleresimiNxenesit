import { supabaseClient } from '../lib/supabaseClient.js';

export function subscribeToUserNotifications(userId, onChange) {
  const channel = supabaseClient
    .channel(`user-notifications-${userId}-${Date.now()}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'user_notifications'
    }, onChange)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'user_notifications'
    }, onChange)
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`Realtime notifications unavailable: ${status}`);
      }
    });

  return () => supabaseClient.removeChannel(channel);
}
