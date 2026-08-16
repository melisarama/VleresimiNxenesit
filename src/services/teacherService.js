import { supabaseClient } from '../lib/supabaseClient.js';

export async function fetchTeacherDashboardData(userId) {
  const [
    profileResult,
    subjectResult,
    studentResult,
    supportResult,
    chapterResult,
    gradeResult,
    moodResult,
    teacherNoticeResult,
    parentNoticeResult,
    parentReplyResult,
    threadResult,
    threadMessageResult,
    inboxNotificationResult,
    finalGradeResult,
    preferenceResult,
    periodResult
  ] = await Promise.all([
    supabaseClient.from('profiles').select('*').eq('id', userId).eq('role', 'teacher').eq('active', true).single(),
    supabaseClient.from('teacher_subjects').select('subject_id,subjects(id,name)').eq('teacher_id', userId),
    supabaseClient.from('students').select('*,classes(school_year)'),
    supabaseClient.from('student_support_profiles').select('*'),
    supabaseClient.from('chapters').select('id,name,subject_id,target_score,subjects(id,name)').eq('active', true),
    supabaseClient.from('grades').select('id,score,parent_message,student_id,chapter_id,subject_id,academic_period_id,graded_at,updated_at,chapters(id,name),subjects(id,name)'),
    supabaseClient.from('daily_moods').select('student_id,mood,parent_comment,reported_on').order('reported_on', { ascending: false }),
    supabaseClient.from('teacher_parent_notices').select('id,student_id,teacher_id,message,created_at,read_at').order('created_at', { ascending: false }),
    supabaseClient.from('subject_parent_notices').select('id,student_id,parent_id,subject_id,comment,created_at,read_at,students(first_name,last_name),subjects(name)').order('created_at', { ascending: false }),
    supabaseClient.from('parent_notice_replies').select('id,notice_id,teacher_id,message,created_at').order('created_at'),
    supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,subject_id,title,teacher_archived_at,created_at,updated_at,students(first_name,last_name),subjects(name),parent_profiles:profiles!communication_threads_parent_id_fkey(first_name,last_name)').eq('teacher_id', userId).order('updated_at', { ascending: false }),
    supabaseClient.from('communication_messages').select('id,thread_id,sender_id,body,read_at,created_at').order('created_at'),
    supabaseClient.from('user_notifications').select('*').eq('recipient_id', userId).order('created_at', { ascending: false }),
    supabaseClient.from('final_grades').select('id,student_id,teacher_id,subject_id,academic_period_id,grade,parent_message,published_at,updated_at'),
    supabaseClient.from('teacher_notification_preferences').select('*').eq('profile_id', userId).maybeSingle(),
    supabaseClient.from('academic_periods').select('id,name,school_year,starts_on,ends_on,status').order('starts_on', { ascending: false })
  ]);

  return {
    profileResult,
    subjectResult,
    studentResult,
    supportResult,
    chapterResult,
    gradeResult,
    moodResult,
    teacherNoticeResult,
    parentNoticeResult,
    parentReplyResult,
    threadResult,
    threadMessageResult,
    inboxNotificationResult,
    finalGradeResult,
    preferenceResult,
    periodResult
  };
}

export async function fetchTeacherInboxData(userId) {
  const [threadResult, threadMessageResult, inboxNotificationResult] = await Promise.all([
    supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,subject_id,title,teacher_archived_at,created_at,updated_at,students(first_name,last_name),subjects(name),parent_profiles:profiles!communication_threads_parent_id_fkey(first_name,last_name)').eq('teacher_id', userId).order('updated_at', { ascending: false }),
    supabaseClient.from('communication_messages').select('id,thread_id,sender_id,body,read_at,created_at').order('created_at'),
    supabaseClient.from('user_notifications').select('*').eq('recipient_id', userId).order('created_at', { ascending: false })
  ]);
  [threadResult, threadMessageResult, inboxNotificationResult].forEach(result => {
    if (result.error) throw result.error;
  });
  return {
    threads: threadResult.data || [],
    messages: threadMessageResult.data || [],
    notifications: inboxNotificationResult.data || []
  };
}

export async function saveChapterAssessment({ studentId, subjectId, chapterId, periodId, score, parentMessage = '' }) {
  const { data, error } = await supabaseClient.rpc('save_chapter_assessment', {
    target_student: studentId,
    target_subject: subjectId,
    target_chapter: chapterId,
    target_period: periodId,
    assessment_score: Number(score),
    assessment_parent_message: parentMessage
  });
  if (error) throw error;
  return data;
}

export async function createTeacherChapter(subjectId, name) {
  const { data, error } = await supabaseClient
    .from('chapters')
    .insert({ subject_id: subjectId, name: name.trim(), target_score: 4, active: true })
    .select('id,name,subject_id,target_score')
    .single();
  if (error) throw error;
  return data;
}

export async function saveTeacherFinalGrade({ studentId, subjectId, periodId, grade, parentMessage = '', confirmationName }) {
  const { data, error } = await supabaseClient.rpc('save_final_grade', {
    target_student: studentId,
    target_subject: subjectId,
    target_period: periodId,
    final_score: Number(grade),
    final_parent_message: parentMessage,
    confirmation_name: confirmationName
  });
  if (error) throw error;
  return data;
}

export async function replyToParentNotice(noticeId, teacherId, message) {
  const { data, error } = await supabaseClient
    .from('parent_notice_replies')
    .insert({ notice_id: noticeId, teacher_id: teacherId, message: message.trim() })
    .select('id,notice_id,teacher_id,message,created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function saveTeacherNotificationPreferences({ profileId, email, parentMessageEmails, dailyDigestEmails }) {
  const { data, error } = await supabaseClient
    .from('teacher_notification_preferences')
    .upsert({
      profile_id: profileId,
      notification_email: email.trim() || null,
      parent_message_emails: parentMessageEmails,
      daily_digest_emails: dailyDigestEmails,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markParentNoticeRead(noticeId) {
  const { data, error } = await supabaseClient.rpc('mark_parent_notice_read', { notice_id: noticeId });
  if (error) throw error;
  return data;
}

export async function deleteParentNotice(noticeId) {
  const { error } = await supabaseClient.from('subject_parent_notices').delete().eq('id', noticeId);
  if (error) throw error;
}

export async function sendTeacherThreadMessage(threadId, message) {
  const { data, error } = await supabaseClient.rpc('send_communication_message', { target_thread: threadId, message_body: message });
  if (error) throw error;
  return data;
}

export async function markTeacherThreadRead(threadId) {
  const { error } = await supabaseClient.rpc('mark_communication_thread_read', { target_thread: threadId });
  if (error) throw error;
}

export async function archiveTeacherThread(threadId) {
  const { error } = await supabaseClient.rpc('archive_communication_thread', { target_thread: threadId });
  if (error) throw error;
}

export async function markTeacherNotificationRead(notificationId) {
  const { error } = await supabaseClient.rpc('mark_user_notification_read', { target_notification: notificationId });
  if (error) throw error;
}

export async function deleteTeacherNotification(notificationId) {
  const { error } = await supabaseClient.from('user_notifications').delete().eq('id', notificationId);
  if (error) throw error;
}

export async function requestTeacherSupport({ message, history = [], student = null }) {
  const payload = {
    message: String(message || ''),
    history: Array.isArray(history) ? history.slice(-8).map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content || '').trim()
    })) : [],
    student
  };
  const result = await supabaseClient.functions.invoke('support', { body: payload });
  if (result.error) throw result.error;
  if (result.data && result.data.error) throw new Error(result.data.error);
  return result.data;
}
