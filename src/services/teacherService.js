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
    teacherNoticeResult
  ] = await Promise.all([
    supabaseClient.from('profiles').select('*').eq('id', userId).eq('role', 'teacher').eq('active', true).single(),
    supabaseClient.from('teacher_subjects').select('subject_id,subjects(id,name)').eq('teacher_id', userId),
    supabaseClient.from('students').select('*'),
    supabaseClient.from('student_support_profiles').select('*'),
    supabaseClient.from('chapters').select('id,name,subject_id,subjects(id,name)').eq('active', true),
    supabaseClient.from('grades').select('score,student_id,chapter_id,subject_id,chapters(id,name),subjects(id,name)'),
    supabaseClient.from('daily_moods').select('student_id,mood,parent_comment,reported_on').order('reported_on', { ascending: false }),
    supabaseClient.from('teacher_parent_notices').select('id,student_id,teacher_id,message,created_at,read_at').order('created_at', { ascending: false })
  ]);

  return {
    profileResult,
    subjectResult,
    studentResult,
    supportResult,
    chapterResult,
    gradeResult,
    moodResult,
    teacherNoticeResult
  };
}
