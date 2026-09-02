import { supabaseClient } from '../lib/supabaseClient.js';

function bindTableEvents(channel, { table, events = ['INSERT', 'UPDATE'], filter }, onChange) {
  let nextChannel = channel;
  events.forEach(event => {
    nextChannel = nextChannel.on('postgres_changes', {
      event,
      schema: 'public',
      table,
      ...(filter ? { filter } : {})
    }, onChange);
  });
  return nextChannel;
}

export function subscribeToUserNotifications(userId, onChange) {
  const channel = bindTableEvents(
    supabaseClient.channel(`user-notifications-${userId}-${Date.now()}`),
    { table: 'user_notifications', filter: `recipient_id=eq.${userId}` },
    onChange
  ).subscribe(status => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`Realtime notifications unavailable: ${status}`);
    }
  });

  return () => supabaseClient.removeChannel(channel);
}

export function subscribeToTeacherWorkspace(userId, onChange) {
  const channelName = `teacher-workspace-${userId}-${Date.now()}`;
  const channel = [
    { table: 'user_notifications', filter: `recipient_id=eq.${userId}` },
    { table: 'communication_threads', filter: `teacher_id=eq.${userId}` },
    { table: 'teacher_classes', filter: `teacher_id=eq.${userId}` },
    { table: 'teacher_students', filter: `teacher_id=eq.${userId}` },
    { table: 'students' },
    { table: 'daily_moods' },
    { table: 'staff_mood_logs' },
    { table: 'grades' },
    { table: 'final_grades', filter: `teacher_id=eq.${userId}` },
    { table: 'student_support_profiles' },
    { table: 'pia_objectives' },
    { table: 'pia_objective_updates' }
  ].reduce((currentChannel, config) => bindTableEvents(currentChannel, config, onChange), supabaseClient.channel(channelName))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`Teacher realtime unavailable: ${status}`);
      }
    });

  return () => supabaseClient.removeChannel(channel);
}

export function subscribeToAssistantWorkspace(userId, onChange) {
  const channelName = `assistant-workspace-${userId}-${Date.now()}`;
  const channel = [
    { table: 'user_notifications', filter: `recipient_id=eq.${userId}` },
    { table: 'communication_threads', filter: `assistant_teacher_id=eq.${userId}` },
    { table: 'assistant_teacher_students', filter: `assistant_teacher_id=eq.${userId}` },
    { table: 'daily_moods' },
    { table: 'staff_mood_logs' },
    { table: 'student_support_profiles' },
    { table: 'pia_objectives' },
    { table: 'pia_objective_updates' }
  ].reduce((currentChannel, config) => bindTableEvents(currentChannel, config, onChange), supabaseClient.channel(channelName))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`Assistant realtime unavailable: ${status}`);
      }
    });

  return () => supabaseClient.removeChannel(channel);
}
