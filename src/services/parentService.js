import { supabaseClient } from '../lib/supabaseClient.js';

function throwOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function fetchParentChildren(userId) {
  return throwOnError(await supabaseClient
    .from('parent_students')
    .select('student_id,students(id,first_name,last_name,class_name,class_id,classes(name,school_year))')
    .eq('parent_id', userId)
    .order('student_id'));
}

export async function fetchParentWorkspaceData(studentId, userId) {
  const baseResults = await Promise.all([
    supabaseClient.from('profiles').select('id,first_name,last_name,email').eq('id', userId).eq('role', 'parent').eq('active', true).single(),
    supabaseClient.from('grades').select('id,score,parent_message,graded_at,updated_at,chapter_id,subject_id,academic_period_id,chapters(name),subjects(name),academic_periods(id,name,school_year,status)').eq('student_id', studentId).order('graded_at', { ascending: false }),
    supabaseClient.from('final_grades').select('id,grade,parent_message,published_at,subject_id,academic_period_id,subjects(name),academic_periods(id,name,school_year,status)').eq('student_id', studentId).order('published_at', { ascending: false }),
    supabaseClient.from('daily_moods').select('id,mood,parent_comment,general_comment,reported_on,updated_at').eq('student_id', studentId).order('reported_on', { ascending: false }),
    supabaseClient.from('student_support_profiles').select('student_id,preferences,updated_at').eq('student_id', studentId).maybeSingle(),
    supabaseClient.rpc('parent_teacher_options', { target_student: studentId }),
    supabaseClient.from('communication_threads').select('id,student_id,parent_id,teacher_id,subject_id,title,parent_archived_at,created_at,updated_at,subjects(name)').eq('student_id', studentId).eq('parent_id', userId).is('parent_archived_at', null).order('updated_at', { ascending: false }),
    supabaseClient.from('user_notifications').select('*').eq('recipient_id', userId).eq('student_id', studentId).order('created_at', { ascending: false }),
    supabaseClient.from('parent_notification_preferences').select('*').eq('profile_id', userId).maybeSingle(),
    supabaseClient.from('class_material_recipients').select('student_id,material_id,class_materials(id,title,description,created_at,expires_at,subject_id,subjects(name),class_material_files(id,original_name,mime_type,byte_size,storage_path))').eq('student_id', studentId)
  ]);
  const [profileResult, gradeResult, finalGradeResult, moodResult, supportResult, teacherOptionResult, threadResult, notificationResult, preferenceResult, materialResult] = baseResults;
  [profileResult, gradeResult, finalGradeResult, moodResult, supportResult, teacherOptionResult, threadResult, notificationResult, preferenceResult, materialResult].forEach(result => {
    if (result.error) throw result.error;
  });
  const threads = threadResult.data || [];
  const messageResult = threads.length
    ? await supabaseClient.from('communication_messages').select('*').in('thread_id', threads.map(thread => thread.id)).order('created_at')
    : { data: [], error: null };
  if (messageResult.error) throw messageResult.error;
  return {
    profile: profileResult.data,
    grades: gradeResult.data || [],
    finalGrades: finalGradeResult.data || [],
    moods: moodResult.data || [],
    supportProfile: supportResult.data,
    teacherOptions: teacherOptionResult.data || [],
    threads,
    messages: messageResult.data || [],
    notifications: notificationResult.data || [],
    preferences: preferenceResult.data,
    materials: (materialResult.data || []).map(row => row.class_materials).filter(Boolean)
  };
}

export async function startParentTeacherThread({ studentId, teacherId, subjectId, title, body }) {
  return throwOnError(await supabaseClient.rpc('start_parent_teacher_thread', {
    target_student: studentId,
    target_teacher: teacherId,
    target_subject: subjectId,
    thread_title: title,
    first_message: body
  }));
}

export async function sendParentThreadMessage(threadId, body) {
  return throwOnError(await supabaseClient.rpc('send_communication_message', { target_thread: threadId, message_body: body }));
}

export async function markParentThreadRead(threadId) {
  return throwOnError(await supabaseClient.rpc('mark_communication_thread_read', { target_thread: threadId }));
}

export async function archiveParentThread(threadId) {
  return throwOnError(await supabaseClient.rpc('archive_communication_thread', { target_thread: threadId }));
}

export async function markParentNotificationRead(notificationId) {
  return throwOnError(await supabaseClient.rpc('mark_user_notification_read', { target_notification: notificationId }));
}

export async function saveParentStudentPreferences({ studentId, learningPreferences, communicationLanguage, communicationMethod }) {
  return throwOnError(await supabaseClient.rpc('save_parent_student_preferences', {
    target_student: studentId,
    learning_preferences: learningPreferences,
    communication_language: communicationLanguage,
    communication_method: communicationMethod
  }));
}

export async function saveParentNotificationPreferences({ profileId, email, teacherMessageEmails, assessmentEmails, materialEmails }) {
  return throwOnError(await supabaseClient.from('parent_notification_preferences').upsert({
    profile_id: profileId,
    notification_email: email.trim() || null,
    teacher_message_emails: teacherMessageEmails,
    assessment_emails: assessmentEmails,
    material_emails: materialEmails,
    updated_at: new Date().toISOString()
  }).select().single());
}

export async function saveParentDailyMood({ studentId, parentId, mood, comment, reportedOn }) {
  return throwOnError(await supabaseClient.from('daily_moods').upsert({
    student_id: studentId,
    parent_id: parentId,
    mood,
    general_comment: comment.trim() || null,
    parent_comment: comment.trim() || null,
    reported_on: reportedOn,
    updated_at: new Date().toISOString()
  }, { onConflict: 'student_id,parent_id,reported_on' }).select().single());
}
