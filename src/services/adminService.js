import { supabaseClient } from '../lib/supabaseClient.js';

function throwOnError(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function fetchAdminDashboardData(userId) {
  const profile = throwOnError(await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .eq('role', 'admin')
    .eq('active', true)
    .single());

  const schoolId = profile.school_id;
  if (!schoolId) throw new Error('ADMIN_SCHOOL_MISSING');

  const results = await Promise.all([
    supabaseClient.from('schools').select('*').eq('id', schoolId).single(),
    supabaseClient.from('classes').select('*').eq('school_id', schoolId).order('name'),
    supabaseClient.from('students').select('*').eq('school_id', schoolId).order('last_name').order('first_name'),
    supabaseClient.from('profiles').select('*').eq('school_id', schoolId).in('role', ['teacher', 'parent']).order('last_name').order('first_name'),
    supabaseClient.from('subjects').select('*').order('name'),
    supabaseClient.from('school_subjects').select('*').eq('school_id', schoolId),
    supabaseClient.from('teacher_subjects').select('*'),
    supabaseClient.from('teacher_students').select('*'),
    supabaseClient.from('teacher_classes').select('*'),
    supabaseClient.from('parent_students').select('*'),
    supabaseClient.from('academic_periods').select('*').eq('school_id', schoolId).order('starts_on', { ascending: false })
  ]);

  const [school, classes, students, profiles, subjects, schoolSubjects, teacherSubjects, teacherStudents, teacherClasses, parentStudents, academicPeriods] = results.map(throwOnError);
  return { profile, school, classes, students, profiles, subjects, schoolSubjects, teacherSubjects, teacherStudents, teacherClasses, parentStudents, academicPeriods };
}

export async function saveAdminStudent({ id, schoolId, classId, className, firstName, lastName, status = 'active' }) {
  const values = {
    school_id: schoolId,
    class_id: classId || null,
    class_name: className || null,
    first_name: firstName.trim(),
    last_name: lastName.trim(),
    status,
    active: status === 'active'
  };
  const query = id
    ? supabaseClient.from('students').update(values).eq('id', id).select().single()
    : supabaseClient.from('students').insert(values).select().single();
  return throwOnError(await query);
}

export async function setAdminStudentActive(studentId, active) {
  return throwOnError(await supabaseClient.from('students').update({ active, status: active ? 'active' : 'inactive' }).eq('id', studentId).select().single());
}

export async function saveAdminClass({ id, schoolId, name, schoolYear, active = true }) {
  const values = { school_id: schoolId, name: name.trim(), school_year: schoolYear.trim(), active };
  const query = id
    ? supabaseClient.from('classes').update(values).eq('id', id).select().single()
    : supabaseClient.from('classes').insert(values).select().single();
  return throwOnError(await query);
}

export async function setAdminClassActive(classId, active) {
  return throwOnError(await supabaseClient.from('classes').update({ active }).eq('id', classId).select().single());
}

export async function updateAdminSchool(schoolId, values) {
  return throwOnError(await supabaseClient.from('schools').update(values).eq('id', schoolId).select().single());
}

export async function setAdminProfileActive(profileId, active) {
  return throwOnError(await supabaseClient.from('profiles').update({ active }).eq('id', profileId).select().single());
}

export async function inviteSchoolMember(values) {
  const result = await supabaseClient.functions.invoke('admin-users', { body: values });
  if (result.error) throw result.error;
  if (result.data && result.data.error) throw new Error(result.data.error);
  return result.data;
}

export async function setSchoolSubject(schoolId, subjectId, active) {
  return throwOnError(await supabaseClient
    .from('school_subjects')
    .upsert({ school_id: schoolId, subject_id: subjectId, active }, { onConflict: 'school_id,subject_id' })
    .select()
    .single());
}

export async function addSchoolSubject(schoolId, name) {
  return throwOnError(await supabaseClient.rpc('admin_add_school_subject', {
    target_school_id: schoolId,
    subject_name: name.trim()
  }));
}

export async function saveAcademicPeriod({ id = null, schoolId, name, schoolYear, startsOn, endsOn, status }) {
  return throwOnError(await supabaseClient.rpc('admin_save_academic_period', {
    period_id: id,
    target_school_id: schoolId,
    period_name: name.trim(),
    period_school_year: schoolYear.trim(),
    period_starts_on: startsOn,
    period_ends_on: endsOn,
    period_status: status
  }));
}

export async function addAdminRelation(table, values) {
  return throwOnError(await supabaseClient.from(table).upsert(values).select().single());
}

export async function removeAdminRelation(table, filters) {
  let query = supabaseClient.from(table).delete();
  Object.entries(filters).forEach(([column, value]) => { query = query.eq(column, value); });
  return throwOnError(await query);
}
