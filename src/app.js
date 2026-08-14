import { initializeAdminWorkflow } from './admin/admin.js';
import { initializeAccountSetup } from './auth/accountSetup.js';
import { supabaseClient } from './lib/supabaseClient.js';
import { initializeParentWorkflow } from './parent/parent.js';
import { subscribeToUserNotifications } from './services/realtimeService.js';
import { fetchTeacherDashboardData, fetchTeacherInboxData } from './services/teacherService.js';
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
    status.textContent = '✓ Baza e të dhënave u lidh në mënyrë të sigurt.';
  } catch (error) {
    status.classList.add('error');
    status.textContent = 'Lidhja me bazën e të dhënave nuk u verifikua. Rifreskoni faqen.';
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
    button.setAttribute('aria-label', visible ? 'Shfaq fjalëkalimin' : 'Fshih fjalëkalimin');
  };
}

function authLoadStatus(loadError, fallback) {
  const loadMessage = loadError?.message || '';
  return loadMessage.includes('JWT issued at future')
    ? 'Sesioni nuk u pranua sepse ora e pajisjes ose serverit nuk përputhet. Kontrolloni datën dhe orën, pastaj provoni përsëri.'
    : fallback;
}

let activeTeacherUser = null;
let activeTeacherStudents = [];
let stopTeacherRealtime = null;
let teacherRealtimeTimer = null;
let teacherRealtimeVersion = 0;

function buildTeacherInbox(userId, students, threads, threadMessages, inboxNotifications) {
  const messagesByThread = threadMessages.reduce((map, message) => { (map[message.thread_id] ||= []).push(message); return map; }, {});
  const threadInbox = threads.filter(thread => !thread.teacher_archived_at).map(thread => {
    const messages = messagesByThread[thread.id] || [];
    const latest = messages[messages.length - 1];
    const parent = thread.parent_profiles;
    const student = thread.students;
    return {
      id: thread.id,
      type: 'thread',
      unread: messages.some(message => message.sender_id !== userId && !message.read_at),
      parent: parent ? `${parent.first_name} ${parent.last_name}` : 'Prindi',
      student: student ? `${student.first_name} ${student.last_name}` : 'Nxënësi',
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
    parent: 'Përditësim ditor',
    student: students.find(student => student.id === item.student_id)?.name || 'Nxënësi',
    subject: item.title,
    context: 'Gjendja ditore',
    time: item.created_at,
    body: item.body,
    notification: item
  }));
  return [...threadInbox, ...moodInbox].sort((left, right) => new Date(right.time) - new Date(left.time));
}

async function refreshTeacherInbox(version) {
  try {
    const data = await fetchTeacherInboxData(activeTeacherUser.id);
    if (version !== teacherRealtimeVersion || !activeTeacherUser) return;
    teacherPrototype.setMessages(buildTeacherInbox(activeTeacherUser.id, activeTeacherStudents, data.threads, data.messages, data.notifications));
  } catch (error) {
    console.warn('Teacher Realtime refresh:', error.message);
  }
}

function scheduleTeacherRealtimeRefresh() {
  if (!activeTeacherUser) return;
  clearTimeout(teacherRealtimeTimer);
  const version = ++teacherRealtimeVersion;
  teacherRealtimeTimer = setTimeout(() => refreshTeacherInbox(version), 180);
}

function startTeacherRealtime(user) {
  stopTeacherRealtime?.();
  stopTeacherRealtime = subscribeToUserNotifications(user.id, scheduleTeacherRealtimeRefresh);
}

function stopTeacherUpdates() {
  clearTimeout(teacherRealtimeTimer);
  teacherRealtimeVersion += 1;
  stopTeacherRealtime?.();
  stopTeacherRealtime = null;
  activeTeacherUser = null;
  activeTeacherStudents = [];
}

const teacherPrototype = initializeTeacherPrototype({
  onLogout: async () => {
    stopTeacherUpdates();
    await supabaseClient.auth.signOut();
    document.getElementById('teacherApp').classList.add('hidden');
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

async function loadTeacherData(user) {
  const results = await fetchTeacherDashboardData(user.id);
  const profile = resultData(results.profileResult);
  const teacherSubjects = resultData(results.subjectResult);
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
  if (results.preferenceResult.error) throw results.preferenceResult.error;

  const supportByStudent = Object.fromEntries(supportRows.map(item => [item.student_id, item]));
  const students = studentRows.map(item => {
    const support = supportByStudent[item.id] || {};
    return {
      id: item.id,
      class_id: item.class_id,
      className: item.class_name || 'Pa klasë',
      schoolYear: item.classes?.school_year || '',
      name: `${item.first_name} ${item.last_name}`,
      supportSummary: support.support_summary || '',
      preferredMode: support.preferences?.preferred_mode || '',
      learningPreferences: support.preferences?.learning_preferences || [],
      communicationLanguage: support.preferences?.communication_language || '',
      communicationMethod: support.preferences?.communication_method || '',
      accessibilityInformation: support.accessibility_information || ''
    };
  });
  const inboxMessages = buildTeacherInbox(user.id, students, threads, threadMessages, inboxNotifications);
  const todayMoods = {};
  const moodHistories = moods.reduce((history, item) => {
    (history[item.student_id] ||= []).push(item);
    return history;
  }, {});
  Object.values(moodHistories).forEach(history => history.sort((left, right) => right.reported_on.localeCompare(left.reported_on)));
  moods.filter(item => item.reported_on === todayIso()).forEach(item => {
    const student = students.find(row => row.id === item.student_id);
    if (student && !todayMoods[student.name]) todayMoods[student.name] = { mood: item.mood, comment: item.parent_comment || '' };
  });

  teacherPrototype.setData({
    teacherName: `${profile.first_name} ${profile.last_name}`,
    teacherEmail: user.email || '', teacherId: user.id, schoolId: profile.school_id,
    subjects: teacherSubjects.map(item => item.subjects || { id: item.subject_id, name: 'Lënda' }),
    academicPeriods: periods, students, moods: todayMoods, moodHistories,
    messages: inboxMessages,
    chapters, assessments, finalGrades, preferences: results.preferenceResult.data
  });
  activeTeacherUser = user;
  activeTeacherStudents = students;
  startTeacherRealtime(user);
}

verifySupabaseConnection();
initializeAccountSetup();
initializeAdminWorkflow();
configurePasswordToggle('teacherPassword', 'teacherPasswordToggle');
configurePasswordToggle('parentPassword', 'parentPasswordToggle');

document.getElementById('teacherRole').onclick = () => { document.getElementById('roleGate').classList.add('hidden'); document.getElementById('teacherLogin').classList.remove('hidden'); };
document.getElementById('parentRole').onclick = () => { document.getElementById('roleGate').classList.add('hidden'); document.getElementById('parentPage').classList.remove('hidden'); };
document.getElementById('backToRolesTeacher').onclick = () => { document.getElementById('teacherLogin').classList.add('hidden'); showRoleGate(); };
document.getElementById('backToRoles').onclick = () => { document.getElementById('parentPage').classList.add('hidden'); showRoleGate(); };

document.getElementById('continueTeacher').onclick = async () => {
  const email = document.getElementById('teacherEmail').value.trim();
  const password = document.getElementById('teacherPassword').value;
  const status = document.getElementById('teacherLoginStatus');
  if (!email || !password) { status.textContent = 'Shkruani email-in dhe fjalëkalimin.'; return; }
  status.textContent = 'Duke u kyçur…';
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { status.textContent = `Hyrja dështoi: ${error.message}`; return; }
  try {
    await loadTeacherData(data.user);
    status.textContent = '';
    document.getElementById('teacherLogin').classList.add('hidden');
    document.getElementById('teacherApp').classList.remove('hidden');
  } catch (loadError) {
    await supabaseClient.auth.signOut();
    status.textContent = authLoadStatus(loadError, 'Kjo llogari nuk është e autorizuar si mësimdhënës.');
    console.warn('Teacher login:', loadError);
  }
};

document.getElementById('continueParent').onclick = async () => {
  const email = document.getElementById('parentEmail').value.trim();
  const password = document.getElementById('parentPassword').value;
  const status = document.getElementById('parentStatus');
  if (!email || !password) { status.textContent = 'Shkruani email-in dhe fjalëkalimin.'; return; }
  status.textContent = 'Duke u kyçur…';
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { status.textContent = `Hyrja dështoi: ${error.message}`; return; }
  try {
    await parentWorkflow.login(data.user);
    status.textContent = '';
    document.getElementById('parentPage').classList.add('hidden');
    document.getElementById('parentDashboard').classList.remove('hidden');
  } catch (loadError) {
    await supabaseClient.auth.signOut();
    status.textContent = authLoadStatus(loadError, 'Kjo llogari nuk është e autorizuar si prind.');
    console.warn('Parent login:', loadError);
  }
};
