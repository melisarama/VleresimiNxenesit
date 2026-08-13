import { supabaseClient } from '../lib/supabaseClient.js';

export async function fetchParentStudentMapping(userId) {
  return supabaseClient
    .from('parent_students')
    .select('student_id,students(id,first_name,last_name,class_name)')
    .eq('parent_id', userId)
    .order('student_id')
    .limit(1)
    .single();
}

export async function fetchParentDashboardData(studentId, userId) {
  const [gradeResult, finalGradeResult, moodResult, subjectNoticeResult, teacherNoticeResult, replyResult] = await Promise.all([
    supabaseClient.from('grades').select('score,parent_message,graded_at,chapter_id,academic_period_id,chapters(name),subjects(name),academic_periods(id,name,school_year,status)').eq('student_id', studentId),
    supabaseClient.from('final_grades').select('grade,parent_message,published_at,subject_id,academic_period_id,subjects(name),academic_periods(id,name,school_year,status)').eq('student_id', studentId),
    supabaseClient.from('daily_moods').select('mood,parent_comment,general_comment,reported_on').eq('student_id', studentId).order('reported_on', { ascending: false }),
    supabaseClient.from('subject_parent_notices').select('student_id,parent_id,subject_id,comment,created_at,subjects(name)').eq('student_id', studentId).eq('parent_id', userId).order('created_at', { ascending: false }),
    supabaseClient.from('teacher_parent_notices').select('id,student_id,teacher_id,message,created_at,read_at').eq('student_id', studentId).order('created_at', { ascending: false }),
    supabaseClient.from('parent_notice_replies').select('id,notice_id,message,created_at,subject_parent_notices(student_id)').order('created_at', { ascending: false })
  ]);

  return { gradeResult, finalGradeResult, moodResult, subjectNoticeResult, teacherNoticeResult, replyResult };
}
