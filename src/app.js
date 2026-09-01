import { initializeAdminWorkflow } from './admin/admin.js';
import { initializeAccountSetup } from './auth/accountSetup.js';
import { supabaseClient } from './lib/supabaseClient.js';
import { initializeParentWorkflow } from './parent/parent.js';
import { subscribeToAssistantWorkspace, subscribeToTeacherWorkspace } from './services/realtimeService.js';
import { fetchAssistantTeacherDashboardData, fetchTeacherAccessProfile, fetchTeacherDashboardData } from './services/teacherService.js';
import { initializeAssistantTeacherPrototype } from './teacher/assistantTeacherPrototype.js';
import { initializeTeacherPrototype } from './teacher/teacherPrototype.js';
import { todayIso } from './utils/dates.js';

function resultData(result) {
  if (result.error) throw result.error;
  return result.data || [];
}

async function verifySupabaseConnection() {
  const status = document.getElementById('databaseStatus');
  try {
    const { error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    status.classList.remove('error');
    status.textContent = 'Baza e te dhenave u lidh ne menyre te sigurt.';
  } catch (error) {
    status.classList.add('error');
    status.textContent = 'Lidhja me bazen e te dhenave nuk u verifikua. Rifreskoni faqen.';
    console.warn('Supabase connection:', error.message);
  }
}

function showRoleGate() {
  document.getElementById('roleGate').classList.remove('hidden');
}

function configurePasswordToggle(fieldId, buttonId) {
  document.getElementById(buttonId).onclick = () => {
    const field = document.getElementById(fieldId);
    const button = document.getElementById(buttonId);
    const visible = field.type === 'text';
    field.type = visible ? 'password' : 'text';
    button.textContent = visible ? '◉' : '◌';
    button.setAttribute('aria-label', visible ? 'Shfaq fjalekalimin' : 'Fshih fjalekalimin');
  };
}

function authLoadStatus(loadError, fallback) {
  const loadMessage = loadError?.message || '';
  return loadMessage.includes('JWT issued at future')
    ? 'Sesioni nuk u pranua sepse ora e pajisjes ose serverit nuk perputhet. Kontrolloni daten dhe oren, pastaj provoni perseri.'
    : fallback;
}

function buildStudentRows(studentRows, supportRows) {
  const supportByStudent = Object.fromEntries(supportRows.map(item => [item.student_id, item]));
  return studentRows.map(item => {
    const support = supportByStudent[item.id] || {};
    const preferences = support.preferences || {};
    return {
      id: item.id,
      class_id: item.class_id,
      className: item.class_name || 'Pa klase',
      schoolYear: item.classes?.school_year || '',
      name: `${item.first_name} ${item.last_name}`,
      supportSummary: support.support_summary || support.supportSummary || preferences.support_summary || '',
      preferredMode: preferences.preferred_mode || '',
      learningPreferences: preferences.support_preferences || preferences.learning_preferences || [],
      communicationLanguage: preferences.communication_language || '',
      communicationMethod: preferences.communication_method || '',
      accessibilityInformation: support.accessibility_information || preferences.accessibility_information || '',
      additionalNotes: preferences.additional_notes || ''
    };
  });
}

function buildMoodState(moods, students) {
  const todayMoods = {};
  const moodHistories = moods.reduce((history, item) => {
    (history[item.student_id] ||= []).push(item);
    return history;
  }, {});
  Object.values(moodHistories).forEach(history => history.sort((left, right) => right.reported_on.localeCompare(left.reported_on)));
  moods.filter(item => item.reported_on === todayIso()).forEach(item => {
    const student = students.find(row => row.id === item.student_id);
    if (student && !todayMoods[student.name]) {
      todayMoods[student.name] = { mood: item.mood, comment: item.parent_comment || '' };
    }
  });
  return { todayMoods, moodHistories };
}

function profileName(profile, fallback) {
  if (!profile) return fallback;
  const name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  return name || fallback;
}

function buildTeacherInbox(userId, students, threads, threadMessages, inboxNotifications) {
  const messagesByThread = threadMessages.reduce((map, message) => {
    (map[message.thread_id] ||= []).push(message);
    return map;
  }, {});

  const threadInbox = threads.filter(thread => !thread.teacher_archived_at).map(thread => {
    const messages = messagesByThread[thread.id] || [];
    const latest = messages[messages.length - 1];
    const counterpart = thread.assistant_teacher_id
      ? profileName(thread.assistant_profiles, 'Asistenti')
      : profileName(thread.parent_profiles, 'Prindi');
    const student = thread.students;
    return {
      id: thread.id,
      type: 'thread',
      unread: messages.some(message => message.sender_id !== userId && !message.read_at),
      parent: counterpart,
      counterpartRole: thread.assistant_teacher_id ? 'Asistenti' : 'Prindi',
      student: student ? `${student.first_name} ${student.last_name}` : 'Nxenesi',
      subject: thread.title,
      context: thread.subjects?.name || '',
      time: latest?.created_at || thread.updated_at,
      body: latest?.body || '',
      messages
    };
  });

  const moodInbox = inboxNotifications.filter(item => item.kind === 'daily_mood').map(item => ({
    id: item.id,
    type: 'notification',
    unread: !item.read_at,
    parent: 'Perditesim ditor',
    student: students.find(student => student.id === item.student_id)?.name || 'Nxenesi',
    subject: item.title,
    context: 'Gjendja ditore',
    time: item.created_at,
    body: item.body,
    notification: item
  }));

  const piaInbox = inboxNotifications.filter(item => item.kind === 'pia').map(item => ({
    id: item.id,
    type: 'notification',
    unread: !item.read_at,
    parent: 'PIA',
    counterpartRole: 'Asistenti',
    student: students.find(student => student.id === item.student_id)?.name || 'Nxenesi',
    subject: item.title,
    context: 'PIA',
    time: item.created_at,
    body: item.body,
    notification: item
  }));

  return [...threadInbox, ...moodInbox, ...piaInbox].sort((left, right) => new Date(right.time) - new Date(left.time));
}

function buildAssistantInbox(userId, students, threads, threadMessages, inboxNotifications) {
  const messagesByThread = threadMessages.reduce((map, message) => {
    (map[message.thread_id] ||= []).push(message);
    return map;
  }, {});

  const threadInbox = threads.filter(thread => !thread.assistant_archived_at).map(thread => {
    const messages = messagesByThread[thread.id] || [];
    const latest = messages[messages.length - 1];
    const student = thread.students;
    const toParent = Boolean(thread.parent_id);
    return {
      id: thread.id,
      type: 'thread',
      unread: messages.some(message => message.sender_id !== userId && !message.read_at),
      counterpart: toParent ? profileName(thread.parent_profiles, 'Prindi') : profileName(thread.teacher_profiles, 'Mesimdhenesi'),
      counterpartRole: toParent ? 'Prindi' : 'Mesimdhenesi',
      student: student ? `${student.first_name} ${student.last_name}` : 'Nxenesi',
      subject: thread.title,
      context: toParent ? 'Familja' : (thread.subjects?.name || 'Lenda'),
      time: latest?.created_at || thread.updated_at,
      body: latest?.body || '',
      messages,
      thread
    };
  });

  const moodInbox = inboxNotifications.filter(item => item.kind === 'daily_mood').map(item => ({
    id: item.id,
    type: 'notification',
    unread: !item.read_at,
    counterpart: 'Perditesim ditor',
    counterpartRole: 'Prindi',
    student: students.find(student => student.id === item.student_id)?.name || 'Nxenesi',
    subject: item.title,
    context: 'Gjendja ditore',
    time: item.created_at,
    body: item.body,
    notification: item
  }));

  return [...threadInbox, ...moodInbox].sort((left, right) => new Date(right.time) - new Date(left.time));
}

let activeTeacherUser = null;
let stopTeacherRealtime = null;
let teacherRealtimeTimer = null;
let teacherRealtimeVersion = 0;

let activeAssistantTeacherUser = null;
let stopAssistantRealtime = null;
let assistantRealtimeTimer = null;
let assistantRealtimeVersion = 0;

async function refreshTeacherWorkspace(version) {
  if (!activeTeacherUser) return;
  try {
    await loadTeacherData(activeTeacherUser, false);
    if (version !== teacherRealtimeVersion || !activeTeacherUser) return;
  } catch (error) {
    console.warn('Teacher realtime refresh:', error.message);
  }
}

function scheduleTeacherRealtimeRefresh(payload = {}) {
  if (!activeTeacherUser) return;
  if (payload.new?.teacher_id && payload.new.teacher_id !== activeTeacherUser.id) return;
  if (payload.new?.recipient_id && payload.new.recipient_id !== activeTeacherUser.id) return;
  clearTimeout(teacherRealtimeTimer);
  const version = ++teacherRealtimeVersion;
  teacherRealtimeTimer = setTimeout(() => refreshTeacherWorkspace(version), 180);
}

function startTeacherRealtime(user) {
  stopTeacherRealtime?.();
  stopTeacherRealtime = subscribeToTeacherWorkspace(user.id, scheduleTeacherRealtimeRefresh);
}

function stopTeacherUpdates() {
  clearTimeout(teacherRealtimeTimer);
  teacherRealtimeVersion += 1;
  stopTeacherRealtime?.();
  stopTeacherRealtime = null;
  activeTeacherUser = null;
}

async function refreshAssistantTeacherWorkspace(version) {
  if (!activeAssistantTeacherUser) return;
  try {
    await loadAssistantTeacherData(activeAssistantTeacherUser, false);
    if (version !== assistantRealtimeVersion || !activeAssistantTeacherUser) return;
  } catch (error) {
    console.warn('Assistant realtime refresh:', error.message);
  }
}

function scheduleAssistantRealtimeRefresh(payload = {}) {
  if (!activeAssistantTeacherUser) return;
  if (payload.new?.assistant_teacher_id && payload.new.assistant_teacher_id !== activeAssistantTeacherUser.id) return;
  if (payload.new?.recipient_id && payload.new.recipient_id !== activeAssistantTeacherUser.id) return;
  clearTimeout(assistantRealtimeTimer);
  const version = ++assistantRealtimeVersion;
  assistantRealtimeTimer = setTimeout(() => refreshAssistantTeacherWorkspace(version), 180);
}

function startAssistantRealtime(user) {
  stopAssistantRealtime?.();
  stopAssistantRealtime = subscribeToAssistantWorkspace(user.id, scheduleAssistantRealtimeRefresh);
}

function stopAssistantTeacherUpdates() {
  clearTimeout(assistantRealtimeTimer);
  assistantRealtimeVersion += 1;
  stopAssistantRealtime?.();
  stopAssistantRealtime = null;
  activeAssistantTeacherUser = null;
}

const teacherPrototype = initializeTeacherPrototype({
  onLogout: async () => {
    stopTeacherUpdates();
    await supabaseClient.auth.signOut();
    document.getElementById('teacherApp').classList.add('hidden');
    showRoleGate();
  }
});

const assistantTeacherPrototype = initializeAssistantTeacherPrototype({
  onLogout: async () => {
    stopAssistantTeacherUpdates();
    await supabaseClient.auth.signOut();
    document.getElementById('assistantTeacherApp').classList.add('hidden');
    showRoleGate();
  }
});

const parentWorkflow = initializeParentWorkflow({
  onLogout: async () => {
    parentWorkflow.stop();
    await supabaseClient.auth.signOut();
    document.getElementById('parentDashboard').classList.add('hidden');
    showRoleGate();
  }
});

async function loadTeacherData(user, shouldStartRealtime = true) {
  const results = await fetchTeacherDashboardData(user.id);
  const profile = resultData(results.profileResult);
  const teacherSubjects = resultData(results.subjectResult);
  const teacherClassAssignments = resultData(results.classAssignmentResult);
  const teacherStudentAssignments = resultData(results.studentAssignmentResult);
  const studentRows = resultData(results.studentResult);
  const supportRows = resultData(results.supportResult);
  const chapters = resultData(results.chapterResult);
  const assessments = resultData(results.gradeResult);
  const moods = resultData(results.moodResult);
  const threads = resultData(results.threadResult);
  const threadMessages = resultData(results.threadMessageResult);
  const inboxNotifications = resultData(results.inboxNotificationResult);
  const finalGrades = resultData(results.finalGradeResult);
  const periods = resultData(results.periodResult);
  const piaObjectives = resultData(results.piaObjectiveResult);
  const piaUpdates = resultData(results.piaUpdateResult);
  if (results.preferenceResult.error) throw results.preferenceResult.error;

  const students = buildStudentRows(studentRows, supportRows);
  const inboxMessages = buildTeacherInbox(user.id, students, threads, threadMessages, inboxNotifications);
  const { todayMoods, moodHistories } = buildMoodState(moods, students);

  teacherPrototype.setData({
    teacherName: `${profile.first_name} ${profile.last_name}`,
    teacherEmail: user.email || '',
    teacherId: user.id,
    schoolId: profile.school_id,
    teacherSubjects,
    subjects: [...new Map([
      ...teacherSubjects.map(item => [item.subject_id, item.subjects || { id: item.subject_id, name: 'Lenda' }]),
      ...teacherClassAssignments.map(item => [item.subject_id, item.subjects || { id: item.subject_id, name: 'Lenda' }])
    ]).values()],
    teacherClassAssignments,
    teacherStudentAssignments: teacherStudentAssignments.map(item => item.student_id),
    academicPeriods: periods,
    students,
    moods: todayMoods,
    moodHistories,
    messages: inboxMessages,
    chapters,
    assessments,
    finalGrades,
    preferences: results.preferenceResult.data,
    piaObjectives,
    piaUpdates
  });

  activeTeacherUser = user;
  if (shouldStartRealtime) startTeacherRealtime(user);
}

async function loadAssistantTeacherData(user, shouldStartRealtime = true) {
  const results = await fetchAssistantTeacherDashboardData(user.id);
  if (!results.profile?.is_assistant_teacher) throw new Error('ASSISTANT_ONLY');

  const students = buildStudentRows(results.students || [], results.supportProfiles || []);
  const { todayMoods, moodHistories } = buildMoodState(results.moods || [], students);
  const inboxMessages = buildAssistantInbox(user.id, students, results.threads || [], results.threadMessages || [], results.notifications || []);

  assistantTeacherPrototype.setData({
    assistantTeacherName: `${results.profile.first_name} ${results.profile.last_name}`,
    assistantTeacherEmail: user.email || '',
    assistantTeacherId: user.id,
    students,
    moods: todayMoods,
    moodHistories,
    piaObjectives: results.piaObjectives || [],
    piaUpdates: results.piaUpdates || [],
    messages: inboxMessages,
    preferences: results.preferences || null,
    messageRecipients: results.messageRecipients || {}
  });

  activeAssistantTeacherUser = user;
  if (shouldStartRealtime) startAssistantRealtime(user);
}

verifySupabaseConnection();
initializeAccountSetup();
initializeAdminWorkflow();
configurePasswordToggle('teacherPassword', 'teacherPasswordToggle');
configurePasswordToggle('parentPassword', 'parentPasswordToggle');

document.getElementById('teacherRole').onclick = () => {
  document.getElementById('roleGate').classList.add('hidden');
  document.getElementById('teacherLogin').classList.remove('hidden');
};
document.getElementById('parentRole').onclick = () => {
  document.getElementById('roleGate').classList.add('hidden');
  document.getElementById('parentPage').classList.remove('hidden');
};
document.getElementById('backToRolesTeacher').onclick = () => {
  document.getElementById('teacherLogin').classList.add('hidden');
  showRoleGate();
};
document.getElementById('backToRoles').onclick = () => {
  document.getElementById('parentPage').classList.add('hidden');
  showRoleGate();
};

document.getElementById('continueTeacher').onclick = async () => {
  const email = document.getElementById('teacherEmail').value.trim();
  const password = document.getElementById('teacherPassword').value;
  const status = document.getElementById('teacherLoginStatus');

  if (!email || !password) {
    status.textContent = 'Shkruani email-in dhe fjalekalimin.';
    return;
  }

  status.textContent = 'Duke u kycur...';
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    status.textContent = `Hyrja deshtoi: ${error.message}`;
    return;
  }

  try {
    const profile = await fetchTeacherAccessProfile(data.user.id);
    if (profile.is_assistant_teacher) {
      await loadAssistantTeacherData(data.user);
      status.textContent = '';
      document.getElementById('teacherLogin').classList.add('hidden');
      document.getElementById('assistantTeacherApp').classList.remove('hidden');
      return;
    }

    await loadTeacherData(data.user);
    status.textContent = '';
    document.getElementById('teacherLogin').classList.add('hidden');
    document.getElementById('teacherApp').classList.remove('hidden');
  } catch (loadError) {
    await supabaseClient.auth.signOut();
    status.textContent = authLoadStatus(loadError, 'Kjo llogari nuk eshte e autorizuar si mesimdhenes.');
    console.warn('Teacher login:', loadError);
  }
};

document.getElementById('continueParent').onclick = async () => {
  const email = document.getElementById('parentEmail').value.trim();
  const password = document.getElementById('parentPassword').value;
  const status = document.getElementById('parentStatus');

  if (!email || !password) {
    status.textContent = 'Shkruani email-in dhe fjalekalimin.';
    return;
  }

  status.textContent = 'Duke u kycur...';
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    status.textContent = `Hyrja deshtoi: ${error.message}`;
    return;
  }

  try {
    await parentWorkflow.login(data.user);
    status.textContent = '';
    document.getElementById('parentPage').classList.add('hidden');
    document.getElementById('parentDashboard').classList.remove('hidden');
  } catch (loadError) {
    await supabaseClient.auth.signOut();
    status.textContent = authLoadStatus(loadError, 'Kjo llogari nuk eshte e autorizuar si prind.');
    console.warn('Parent login:', loadError);
  }
};
