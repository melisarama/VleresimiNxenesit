import { supabaseClient } from '../lib/supabaseClient.js';

function optionalStaffMoodResult(result) {
  const message = result.error?.message || '';
  if (result.error && (result.error.code === '42P01' || message.includes('staff_mood_logs'))) {
    return { data: [], error: null };
  }
  return result;
}

async function fetchStaffMoodLogs(studentIds = []) {
  if (!studentIds.length) return { data: [], error: null };
  const result = await supabaseClient
    .from('staff_mood_logs')
    .select('id,student_id,reporter_id,reporter_role,mood,comment,context,reported_on,created_at,updated_at,profiles(first_name,last_name)')
    .in('student_id', studentIds)
    .order('reported_on', { ascending: false })
    .order('created_at', { ascending: false });
  return optionalStaffMoodResult(result);
}

export async function fetchTeacherDashboardData(userId) {
  const [
    profileResult,
    subjectResult,
    classAssignmentResult,
    studentAssignmentResult,
    threadResult,
    threadMessageResult,
    inboxNotificationResult,
    preferenceResult,
    periodResult
  ] = await Promise.all([
    supabaseClient.from('profiles').select('*').eq('id', userId).eq('role', 'teacher').eq('active', true).single(),
    supabaseClient.from('teacher_subjects').select('subject_id,subjects(id,name)').eq('teacher_id', userId),
    supabaseClient.from('teacher_classes').select('class_id,subject_id,classes(id,name,school_year),subjects(id,name)').eq('teacher_id', userId),
    supabaseClient.from('teacher_students').select('student_id').eq('teacher_id', userId),
    supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,assistant_teacher_id,subject_id,title,teacher_archived_at,assistant_archived_at,created_at,updated_at,students(first_name,last_name),subjects(name),parent_profiles:profiles!communication_threads_parent_id_fkey(first_name,last_name),assistant_profiles:profiles!communication_threads_assistant_teacher_id_fkey(first_name,last_name)').eq('teacher_id', userId).order('updated_at', { ascending: false }),
    supabaseClient.from('communication_messages').select('id,thread_id,sender_id,body,read_at,created_at').order('created_at'),
    supabaseClient.from('user_notifications').select('*').eq('recipient_id', userId).order('created_at', { ascending: false }),
    supabaseClient.from('teacher_notification_preferences').select('*').eq('profile_id', userId).maybeSingle(),
    supabaseClient.from('academic_periods').select('id,name,school_year,starts_on,ends_on,status').order('starts_on', { ascending: false })
  ]);

  [
    profileResult,
    subjectResult,
    classAssignmentResult,
    studentAssignmentResult,
    threadResult,
    threadMessageResult,
    inboxNotificationResult,
    preferenceResult,
    periodResult
  ].forEach(result => {
    if (result.error) throw result.error;
  });

  const directStudentIds = [...new Set((studentAssignmentResult.data || []).map(item => item.student_id).filter(Boolean))];
  const classIds = [...new Set((classAssignmentResult.data || []).map(item => item.class_id).filter(Boolean))];
  const subjectIds = [...new Set([
    ...(subjectResult.data || []).map(item => item.subject_id),
    ...(classAssignmentResult.data || []).map(item => item.subject_id)
  ].filter(Boolean))];

  const rawStudentResult = await supabaseClient.from('students').select('*,classes(school_year)').order('last_name').order('first_name');
  if (rawStudentResult.error) throw rawStudentResult.error;

  const visibleStudents = (rawStudentResult.data || []).filter(student =>
    directStudentIds.includes(student.id) || (student.class_id && classIds.includes(student.class_id))
  );
  const studentIds = visibleStudents.map(student => student.id);
  const emptyArrayResult = { data: [], error: null };

  let supportResult = emptyArrayResult;
  let chapterResult = emptyArrayResult;
  let gradeResult = emptyArrayResult;
  let moodResult = emptyArrayResult;
  let finalGradeResult = emptyArrayResult;
  let piaObjectiveResult = emptyArrayResult;
  let piaUpdateResult = emptyArrayResult;
  let staffMoodResult = emptyArrayResult;
  let assistantProfileResult = emptyArrayResult;

  if (studentIds.length) {
    const scopedResults = await Promise.all([
      supabaseClient.from('student_support_profiles').select('*').in('student_id', studentIds),
      subjectIds.length
        ? supabaseClient.from('chapters').select('id,name,subject_id,target_score,subjects(id,name)').eq('active', true).in('subject_id', subjectIds)
        : Promise.resolve(emptyArrayResult),
      supabaseClient.from('grades').select('id,score,parent_message,student_id,chapter_id,subject_id,academic_period_id,graded_at,updated_at,chapters(id,name),subjects(id,name)').in('student_id', studentIds),
      supabaseClient.from('daily_moods').select('student_id,mood,parent_comment,reported_on').in('student_id', studentIds).order('reported_on', { ascending: false }),
      fetchStaffMoodLogs(studentIds),
      supabaseClient.from('final_grades').select('id,student_id,teacher_id,subject_id,academic_period_id,grade,parent_message,published_at,updated_at').in('student_id', studentIds),
      supabaseClient.from('pia_objectives').select('id,student_id,assistant_teacher_id,title,details,active,created_at,updated_at').in('student_id', studentIds).order('updated_at', { ascending: false }),
      supabaseClient.from('pia_objective_updates').select('id,objective_id,student_id,assistant_teacher_id,rating,comment,reported_on,created_at,updated_at').in('student_id', studentIds).order('reported_on', { ascending: false }).order('updated_at', { ascending: false })
    ]);

    [supportResult, chapterResult, gradeResult, moodResult, staffMoodResult, finalGradeResult, piaObjectiveResult, piaUpdateResult] = scopedResults;
    scopedResults.forEach(result => {
      if (result.error) throw result.error;
    });

    const assistantIds = [...new Set([
      ...(piaObjectiveResult.data || []).map(item => item.assistant_teacher_id),
      ...(piaUpdateResult.data || []).map(item => item.assistant_teacher_id)
    ].filter(Boolean))];
    assistantProfileResult = assistantIds.length
      ? await supabaseClient.from('profiles').select('id,first_name,last_name').in('id', assistantIds)
      : emptyArrayResult;
    if (assistantProfileResult.error) throw assistantProfileResult.error;
  }

  const assistantNames = Object.fromEntries((assistantProfileResult.data || []).map(profile => [profile.id, `${profile.first_name} ${profile.last_name}`.trim()]));

  return {
    profileResult,
    subjectResult,
    classAssignmentResult,
    studentAssignmentResult,
    studentResult: { data: visibleStudents, error: null },
    supportResult,
    chapterResult,
    gradeResult,
    moodResult,
    threadResult,
    threadMessageResult,
    inboxNotificationResult,
    finalGradeResult,
    staffMoodResult,
    preferenceResult,
    periodResult,
    piaObjectiveResult: {
      data: (piaObjectiveResult.data || []).map(item => ({
        ...item,
        assistantName: assistantNames[item.assistant_teacher_id] || 'Asistenti'
      })),
      error: piaObjectiveResult.error
    },
    piaUpdateResult: {
      data: (piaUpdateResult.data || []).map(item => ({
        ...item,
        assistantName: assistantNames[item.assistant_teacher_id] || 'Asistenti'
      })),
      error: piaUpdateResult.error
    }
  };
}

export async function fetchTeacherAccessProfile(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id,school_id,role,active,first_name,last_name,email,is_assistant_teacher')
    .eq('id', userId)
    .eq('role', 'teacher')
    .eq('active', true)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchAssistantTeacherDashboardData(userId) {
  const profileResult = await supabaseClient
    .from('profiles')
    .select('id,school_id,role,active,first_name,last_name,email,is_assistant_teacher')
    .eq('id', userId)
    .eq('role', 'teacher')
    .eq('active', true)
    .single();
  if (profileResult.error) throw profileResult.error;

  const assignmentResult = await supabaseClient
    .from('assistant_teacher_students')
    .select('student_id')
    .eq('assistant_teacher_id', userId);
  if (assignmentResult.error) throw assignmentResult.error;

  const studentIds = (assignmentResult.data || []).map(item => item.student_id);
  if (!studentIds.length) {
    const [threadResult, threadMessageResult, notificationResult, preferenceResult, schoolSubjectResult] = await Promise.all([
      supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,assistant_teacher_id,subject_id,title,parent_archived_at,teacher_archived_at,assistant_archived_at,created_at,updated_at,students(first_name,last_name),subjects(name),parent_profiles:profiles!communication_threads_parent_id_fkey(first_name,last_name),teacher_profiles:profiles!communication_threads_teacher_id_fkey(first_name,last_name),assistant_profiles:profiles!communication_threads_assistant_teacher_id_fkey(first_name,last_name)').eq('assistant_teacher_id', userId).order('updated_at', { ascending: false }),
      supabaseClient.from('communication_messages').select('id,thread_id,sender_id,body,read_at,created_at').order('created_at'),
      supabaseClient.from('user_notifications').select('*').eq('recipient_id', userId).order('created_at', { ascending: false }),
      supabaseClient.from('teacher_notification_preferences').select('*').eq('profile_id', userId).maybeSingle(),
      supabaseClient.from('school_subjects').select('subject_id,subjects(id,name)').eq('school_id', profileResult.data.school_id).eq('active', true)
    ]);
    [threadResult, threadMessageResult, notificationResult, preferenceResult, schoolSubjectResult].forEach(result => {
      if (result.error) throw result.error;
    });

    return {
      profile: profileResult.data,
      students: [],
      supportProfiles: [],
      moods: [],
      piaObjectives: [],
      piaUpdates: [],
      threads: threadResult.data || [],
      threadMessages: threadMessageResult.data || [],
      notifications: notificationResult.data || [],
      preferences: preferenceResult.data || null,
      staffMoodLogs: [],
      schoolSubjects: schoolSubjectResult.data || [],
      messageRecipients: {}
    };
  }

  const [studentResult, supportResult, moodResult, staffMoodResult, piaObjectiveResult, piaUpdateResult, threadResult, threadMessageResult, notificationResult, preferenceResult, schoolSubjectResult] = await Promise.all([
    supabaseClient.from('students').select('*,classes(school_year)').in('id', studentIds).order('last_name').order('first_name'),
    supabaseClient.from('student_support_profiles').select('*').in('student_id', studentIds),
    supabaseClient.from('daily_moods').select('student_id,mood,parent_comment,reported_on').in('student_id', studentIds).order('reported_on', { ascending: false }),
    fetchStaffMoodLogs(studentIds),
    supabaseClient.from('pia_objectives').select('id,student_id,assistant_teacher_id,title,details,active,created_at,updated_at').in('student_id', studentIds).order('updated_at', { ascending: false }),
    supabaseClient.from('pia_objective_updates').select('id,objective_id,student_id,assistant_teacher_id,rating,comment,reported_on,created_at,updated_at').in('student_id', studentIds).order('reported_on', { ascending: false }).order('updated_at', { ascending: false }),
    supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,assistant_teacher_id,subject_id,title,parent_archived_at,teacher_archived_at,assistant_archived_at,created_at,updated_at,students(first_name,last_name),subjects(name),parent_profiles:profiles!communication_threads_parent_id_fkey(first_name,last_name),teacher_profiles:profiles!communication_threads_teacher_id_fkey(first_name,last_name),assistant_profiles:profiles!communication_threads_assistant_teacher_id_fkey(first_name,last_name)').eq('assistant_teacher_id', userId).order('updated_at', { ascending: false }),
    supabaseClient.from('communication_messages').select('id,thread_id,sender_id,body,read_at,created_at').order('created_at'),
    supabaseClient.from('user_notifications').select('*').eq('recipient_id', userId).order('created_at', { ascending: false }),
    supabaseClient.from('teacher_notification_preferences').select('*').eq('profile_id', userId).maybeSingle(),
    supabaseClient.from('school_subjects').select('subject_id,subjects(id,name)').eq('school_id', profileResult.data.school_id).eq('active', true)
  ]);

  [studentResult, supportResult, moodResult, staffMoodResult, piaObjectiveResult, piaUpdateResult, threadResult, threadMessageResult, notificationResult, preferenceResult, schoolSubjectResult].forEach(result => {
    if (result.error) throw result.error;
  });

  const recipientResults = await Promise.all(
    studentIds.map(studentId => supabaseClient.rpc('assistant_message_options', { target_student: studentId }))
  );
  recipientResults.forEach(result => {
    if (result.error) throw result.error;
  });

  const assistantIds = [...new Set([
    ...(piaObjectiveResult.data || []).map(item => item.assistant_teacher_id),
    ...(piaUpdateResult.data || []).map(item => item.assistant_teacher_id)
  ].filter(Boolean))];
  const assistantProfileResult = assistantIds.length
    ? await supabaseClient.from('profiles').select('id,first_name,last_name').in('id', assistantIds)
    : { data: [], error: null };
  if (assistantProfileResult.error) throw assistantProfileResult.error;

  const assistantNames = Object.fromEntries((assistantProfileResult.data || []).map(profile => [profile.id, `${profile.first_name} ${profile.last_name}`.trim()]));
  const messageRecipients = Object.fromEntries(studentIds.map((studentId, index) => [studentId, recipientResults[index].data || []]));

  return {
    profile: profileResult.data,
    students: studentResult.data || [],
    supportProfiles: supportResult.data || [],
    moods: moodResult.data || [],
    staffMoodLogs: staffMoodResult.data || [],
    piaObjectives: (piaObjectiveResult.data || []).map(item => ({
      ...item,
      assistantName: assistantNames[item.assistant_teacher_id] || 'Asistenti'
    })),
    piaUpdates: (piaUpdateResult.data || []).map(item => ({
      ...item,
      assistantName: assistantNames[item.assistant_teacher_id] || 'Asistenti'
    })),
    threads: threadResult.data || [],
    threadMessages: threadMessageResult.data || [],
    notifications: notificationResult.data || [],
    preferences: preferenceResult.data || null,
    schoolSubjects: schoolSubjectResult.data || [],
    messageRecipients
  };
}

export async function saveAssistantPiaObjective({ objectiveId = null, studentId, title, details = '', active = true }) {
  const { data, error } = await supabaseClient.rpc('save_pia_objective', {
    target_objective: objectiveId,
    target_student: studentId,
    objective_title: title,
    objective_details: details,
    objective_active: active
  });
  if (error) throw error;
  return data;
}

export async function recordAssistantPiaUpdate({ objectiveId, rating, comment }) {
  const { data, error } = await supabaseClient.rpc('record_pia_objective_update', {
    target_objective: objectiveId,
    progress_rating: Number(rating),
    progress_comment: comment
  });
  if (error) throw error;
  return data;
}

export async function saveStaffMoodLog({ studentId, mood, comment = '', context = '', reporterRole }) {
  const userResult = await supabaseClient.auth.getUser();
  if (userResult.error) throw userResult.error;
  const userId = userResult.data?.user?.id;
  if (!userId) throw new Error('AUTH_REQUIRED');

  const { data, error } = await supabaseClient
    .from('staff_mood_logs')
    .insert({
      student_id: studentId,
      reporter_id: userId,
      reporter_role: reporterRole,
      mood: String(mood || '').trim(),
      comment: String(comment || '').trim() || null,
      context: String(context || '').trim() || null,
      reported_on: new Date().toISOString().slice(0, 10)
    })
    .select('id,student_id,reporter_id,reporter_role,mood,comment,context,reported_on,created_at,updated_at,profiles(first_name,last_name)')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchTeacherInboxData(userId) {
  const [threadResult, threadMessageResult, inboxNotificationResult] = await Promise.all([
    supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,assistant_teacher_id,subject_id,title,teacher_archived_at,assistant_archived_at,created_at,updated_at,students(first_name,last_name),subjects(name),parent_profiles:profiles!communication_threads_parent_id_fkey(first_name,last_name),assistant_profiles:profiles!communication_threads_assistant_teacher_id_fkey(first_name,last_name)').eq('teacher_id', userId).order('updated_at', { ascending: false }),
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

export async function saveTeacherNotificationPreferences({ profileId, email, parentMessageEmails, dailyDigestEmails = false }) {
  const { data, error } = await supabaseClient
    .from('teacher_notification_preferences')
    .upsert({
      profile_id: profileId,
      notification_email: email.trim() || null,
      parent_message_emails: parentMessageEmails,
      daily_digest_emails: false,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function sendTeacherThreadMessage(threadId, message) {
  const { data, error } = await supabaseClient.rpc('send_communication_message', { target_thread: threadId, message_body: message });
  if (error) throw error;
  return data;
}

export async function startAssistantThread({ studentId, recipientId, recipientRole, subjectId = null, title, body }) {
  const { data, error } = await supabaseClient.rpc('start_assistant_thread', {
    target_student: studentId,
    target_recipient: recipientId,
    target_recipient_role: recipientRole,
    target_subject: subjectId,
    thread_title: title,
    first_message: body
  });
  if (error) throw error;
  return data;
}

export async function sendAssistantThreadMessage(threadId, message) {
  const { data, error } = await supabaseClient.rpc('send_communication_message', { target_thread: threadId, message_body: message });
  if (error) throw error;
  return data;
}

export async function markAssistantThreadRead(threadId) {
  const { error } = await supabaseClient.rpc('mark_communication_thread_read', { target_thread: threadId });
  if (error) throw error;
}

export async function markAssistantThreadUnread(threadId) {
  const { error } = await supabaseClient.rpc('mark_communication_thread_unread', { target_thread: threadId });
  if (error) throw error;
}

export async function archiveAssistantThread(threadId) {
  const { error } = await supabaseClient.rpc('archive_communication_thread', { target_thread: threadId });
  if (error) throw error;
}

export async function markAssistantNotificationRead(notificationId) {
  const { error } = await supabaseClient.rpc('mark_user_notification_read', { target_notification: notificationId });
  if (error) throw error;
}

export async function markAssistantNotificationUnread(notificationId) {
  const { error } = await supabaseClient.rpc('mark_user_notification_unread', { target_notification: notificationId });
  if (error) throw error;
}

export async function deleteAssistantNotification(notificationId) {
  const { error } = await supabaseClient.from('user_notifications').delete().eq('id', notificationId);
  if (error) throw error;
}

export async function saveAssistantNotificationPreferences({ profileId, email, parentMessageEmails, dailyDigestEmails = false }) {
  const { data, error } = await supabaseClient
    .from('teacher_notification_preferences')
    .upsert({
      profile_id: profileId,
      notification_email: email.trim() || null,
      parent_message_emails: parentMessageEmails,
      daily_digest_emails: false,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markTeacherThreadRead(threadId) {
  const { error } = await supabaseClient.rpc('mark_communication_thread_read', { target_thread: threadId });
  if (error) throw error;
}

export async function markTeacherThreadUnread(threadId) {
  const { error } = await supabaseClient.rpc('mark_communication_thread_unread', { target_thread: threadId });
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

export async function markTeacherNotificationUnread(notificationId) {
  const { error } = await supabaseClient.rpc('mark_user_notification_unread', { target_notification: notificationId });
  if (error) throw error;
}

export async function deleteTeacherNotification(notificationId) {
  const { error } = await supabaseClient.from('user_notifications').delete().eq('id', notificationId);
  if (error) throw error;
}

export async function requestTeacherSupport({ message, history = [], studentContext = null }) {
  const payload = {
    message: String(message || ''),
    history: Array.isArray(history) ? history.slice(-8).map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content || '').trim()
    })) : [],
    studentContext: studentContext && typeof studentContext === 'object' ? studentContext : null
  };
  const result = await supabaseClient.functions.invoke('support', { body: payload });
  if (result.error) throw result.error;
  if (result.data?.error) throw new Error(result.data.error);
  if (!result.data?.answer) throw new Error('EMPTY_SUPPORT_RESPONSE');
  return result.data;
}
