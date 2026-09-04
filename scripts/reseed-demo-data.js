const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    let value = line.slice(index + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[line.slice(0, index)] = value;
  }
  return env;
}

function fail(message, details) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function ensure(result, label) {
  if (result.error) fail(label, result.error);
  return result.data;
}

function fullName(row) {
  return `${row.firstName} ${row.lastName}`;
}

function shiftUtcDate(daysAgo, hour = 8, minute = 0) {
  const value = new Date();
  value.setUTCHours(hour, minute, 0, 0);
  value.setUTCDate(value.getUTCDate() - daysAgo);
  return value;
}

function isoDate(daysAgo = 0) {
  return shiftUtcDate(daysAgo).toISOString().slice(0, 10);
}

function isoStamp(daysAgo = 0, hour = 8, minute = 0) {
  return shiftUtcDate(daysAgo, hour, minute).toISOString();
}

const env = loadEnv('.env');
const supabaseUrl = env.SUPABASE_URL;
const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
  fail('Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, or SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function browserClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signInAny(candidates) {
  for (const candidate of candidates) {
    const client = browserClient();
    const { data, error } = await client.auth.signInWithPassword(candidate);
    if (!error && data?.user) {
      return { client, user: data.user, session: data.session, credentials: candidate };
    }
  }
  fail('Could not sign in with any admin candidate.');
}

async function authAdminDeleteUser(userId) {
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) fail(`deleteUser ${userId}`, error);
}

async function authAdminUpdateUser(userId, attributes) {
  const { data, error } = await service.auth.admin.updateUserById(userId, attributes);
  if (error) fail(`updateUserById ${userId}`, error);
  return data.user;
}

async function authAdminListUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail('listUsers', error);
    all.push(...(data.users || []));
    if ((data.users || []).length < 200) break;
    page += 1;
  }
  return all;
}

async function inviteMember(adminClient, payload, password = 'Temp123') {
  const { data, error } = await adminClient.functions.invoke('admin-users', { body: payload });
  if (error) fail(`functions.invoke admin-users ${payload.email}`, error);
  if (data?.error) fail(`admin-users ${payload.email}`, data.error);
  await authAdminUpdateUser(data.user.id, { password, email_confirm: true });
  return { id: data.user.id, email: payload.email, firstName: payload.firstName, lastName: payload.lastName };
}

async function countOwnNotifications(client) {
  const { count, error } = await client.from('user_notifications').select('*', { count: 'exact', head: true });
  if (error) fail('count user_notifications', error);
  return count || 0;
}

async function countOwnThreads(client, column, userId) {
  const { count, error } = await client.from('communication_threads').select('*', { count: 'exact', head: true }).eq(column, userId);
  if (error) fail(`count communication_threads ${column}`, error);
  return count || 0;
}

async function main() {
  const adminTarget = { email: 'admin@shkolla.org', password: 'administrata' };
  const adminBootstrap = await signInAny([
    adminTarget,
    { email: 'admin.demo@mesimi.test', password: 'DemoPilot123!' },
  ]);
  const adminClient = adminBootstrap.client;
  const adminUser = adminBootstrap.user;

  const adminProfile = ensure(
    await adminClient.from('profiles').select('id,school_id,role,active,email').eq('id', adminUser.id).single(),
    'load admin profile',
  );
  if (adminProfile.role !== 'admin' || !adminProfile.school_id) {
    fail('Current signed-in account is not an active school admin.');
  }

  const schoolId = adminProfile.school_id;
  const schoolYear = '2026/2027';

  const teachers = [
    { firstName: 'Arta', lastName: 'Berisha', subject: 'Gjuhë shqipe', email: 'arta.berisha@shkolla.edu' },
    { firstName: 'Besnik', lastName: 'Krasniqi', subject: 'Matematikë', email: 'besnik.krasniqi@shkolla.edu' },
    { firstName: 'Valbona', lastName: 'Gashi', subject: 'Edukatë fizike', email: 'valbona.gashi@shkolla.edu' },
    { firstName: 'Fatos', lastName: 'Hoxha', subject: 'Edukate figurative (Art)', email: 'fatos.hoxha@shkolla.edu' },
    { firstName: 'Teuta', lastName: 'Kelmendi', subject: 'Edukatë muzikore', email: 'teuta.kelmendi@shkolla.edu' },
    { firstName: 'Ilir', lastName: 'Morina', subject: 'Gjeografi', email: 'ilir.morina@shkolla.edu' },
    { firstName: 'Lindita', lastName: 'Kastrati', subject: 'Biologji', email: 'lindita.kastrati@shkolla.edu' },
    { firstName: 'Driton', lastName: 'Shala', subject: 'TIK', email: 'driton.shala@shkolla.edu' },
    { firstName: 'Edona', lastName: 'Bytyqi', subject: 'Gjuhë angleze', email: 'edona.bytyqi@shkolla.edu' },
    { firstName: 'Arianit', lastName: 'Rama', subject: 'Kimi', email: 'arianit.rama@shkolla.edu' },
  ];

  const assistants = [
    { firstName: 'Mirela', lastName: 'Nimani', email: 'mirela.nimani@shkolla.edu' },
    { firstName: 'Gent', lastName: 'Dema', email: 'gent.dema@shkolla.edu' },
    { firstName: 'Adelina', lastName: 'Peci', email: 'adelina.peci@shkolla.edu' },
    { firstName: 'Blerim', lastName: 'Qorri', email: 'blerim.qorri@shkolla.edu' },
    { firstName: 'Saranda', lastName: 'Gashi', email: 'saranda.gashi@shkolla.edu' },
  ];

  const parents = [
    { firstName: 'Agron', lastName: 'Krasniqi', email: 'agron.krasniqi@email.com', students: ['Arian Krasniqi'] },
    { firstName: 'Blerta', lastName: 'Berisha', email: 'blerta.berisha@email.com', students: ['Era Berisha'] },
    { firstName: 'Bekim', lastName: 'Gashi', email: 'bekim.gashi@email.com', students: ['Dren Gashi'] },
    { firstName: 'Pranvera', lastName: 'Kastrati', email: 'pranvera.k@email.com', students: ['Lira Kastrati'] },
    { firstName: 'Petrit', lastName: 'Morina', email: 'petrit.morina@email.com', students: ['Noar Morina'] },
    { firstName: 'Gentiana', lastName: 'Bytyqi', email: 'gentiana.bytyqi@email.com', students: ['Jona Bytyqi'] },
    { firstName: 'Fatmir', lastName: 'Kelmendi', email: 'fatmir.k@email.com', students: ['Yll Kelmendi'] },
    { firstName: 'Alban', lastName: 'Hoxha', email: 'alban.hoxha@email.com', students: ['Rinesa Hoxha', 'Luan Hoxha'] },
    { firstName: 'Fisnik', lastName: 'Shala', email: 'fisnik.shala@email.com', students: ['Rron Shala'] },
    { firstName: 'Blerta', lastName: 'Rama', email: 'blerta.rama@email.com', students: ['Tara Rama', 'Olti Dugolli'] },
    { firstName: 'Valon', lastName: 'Ahmeti', email: 'valon.ahmeti@email.com', students: ['Diar Ahmeti'] },
    { firstName: 'Shpresa', lastName: 'Zeqiri', email: 'shpresa.z@email.com', students: ['Bora Zeqiri'] },
    { firstName: 'Genc', lastName: 'Rexhepi', email: 'genc.rexhepi@email.com', students: ['Arti Rexhepi'] },
    { firstName: 'Mimoza', lastName: 'Kryeziu', email: 'mimoza.k@email.com', students: ['Elsa Kryeziu'] },
    { firstName: 'Kushtrim', lastName: 'Musliu', email: 'kushtrim.m@email.com', students: ['Luan Musliu'] },
    { firstName: 'Besa', lastName: 'Maliqi', email: 'besa.maliqi@email.com', students: ['Nita Maliqi'] },
    { firstName: 'Luan', lastName: 'Hoti', email: 'luan.hoti@email.com', students: ['Krenar Hoti'] },
    { firstName: 'Donika', lastName: 'Bajrami', email: 'donika.b@email.com', students: ['Lea Bajrami'] },
    { firstName: 'Mentor', lastName: 'Kabashi', email: 'mentor.kabashi@email.com', students: ['Ledion Kabashi'] },
    { firstName: 'Edona', lastName: 'Sopa', email: 'edona.sopa@email.com', students: ['Dua Sopa'] },
    { firstName: 'Arben', lastName: 'Lushi', email: 'arben.lushi@email.com', students: ['Andi Lushi'] },
    { firstName: 'Venera', lastName: 'Gacaferi', email: 'venera.g@email.com', students: ['Hana Gacaferi', 'Aria Thaqi'] },
  ];

  const students = [
    { firstName: 'Arian', lastName: 'Krasniqi', className: 'V-A', pref1: 'Vizatim', pref2: 'Praktike' },
    { firstName: 'Era', lastName: 'Berisha', className: 'V-A', pref1: 'Degjim', pref2: 'Bashkepunim' },
    { firstName: 'Dren', lastName: 'Gashi', className: 'V-A', pref1: 'Praktike', pref2: 'Levizje' },
    { firstName: 'Lira', lastName: 'Kastrati', className: 'V-A', pref1: 'Vizatim', pref2: 'Shkrim' },
    { firstName: 'Noar', lastName: 'Morina', className: 'V-A', pref1: 'Levizje', pref2: 'Praktike' },
    { firstName: 'Jona', lastName: 'Bytyqi', className: 'V-A', pref1: 'Degjim', pref2: 'Bashkepunim' },
    { firstName: 'Yll', lastName: 'Kelmendi', className: 'V-A', pref1: 'Lexim', pref2: 'Praktike' },
    { firstName: 'Rinesa', lastName: 'Hoxha', className: 'V-A', pref1: 'Vizatim', pref2: 'Degjim' },
    { firstName: 'Rron', lastName: 'Shala', className: 'V-A', pref1: 'Degjim', pref2: 'Lexim' },
    { firstName: 'Tara', lastName: 'Rama', className: 'V-A', pref1: 'Praktike', pref2: 'Vizatim' },
    { firstName: 'Diar', lastName: 'Ahmeti', className: 'V-A', pref1: 'Levizje', pref2: 'Bashkepunim' },
    { firstName: 'Bora', lastName: 'Zeqiri', className: 'V-A', pref1: 'Levizje', pref2: 'Degjim' },
    { firstName: 'Arti', lastName: 'Rexhepi', className: 'V-A', pref1: 'Shkrim', pref2: 'Vizatim' },
    { firstName: 'Elsa', lastName: 'Kryeziu', className: 'V-B', pref1: 'Lexim', pref2: 'Bashkepunim' },
    { firstName: 'Luan', lastName: 'Musliu', className: 'V-B', pref1: 'Praktike', pref2: 'Degjim' },
    { firstName: 'Nita', lastName: 'Maliqi', className: 'V-B', pref1: 'Vizatim', pref2: 'Praktike' },
    { firstName: 'Krenar', lastName: 'Hoti', className: 'V-B', pref1: 'Levizje', pref2: 'Shkrim' },
    { firstName: 'Lea', lastName: 'Bajrami', className: 'V-B', pref1: 'Bashkepunim', pref2: 'Degjim' },
    { firstName: 'Ledion', lastName: 'Kabashi', className: 'V-B', pref1: 'Vizatim', pref2: 'Lexim' },
    { firstName: 'Dua', lastName: 'Sopa', className: 'V-B', pref1: 'Degjim', pref2: 'Bashkepunim' },
    { firstName: 'Andi', lastName: 'Lushi', className: 'V-B', pref1: 'Praktike', pref2: 'Vizatim' },
    { firstName: 'Hana', lastName: 'Gacaferi', className: 'V-B', pref1: 'Shkrim', pref2: 'Lexim' },
    { firstName: 'Olti', lastName: 'Dugolli', className: 'V-B', pref1: 'Levizje', pref2: 'Praktike' },
    { firstName: 'Aria', lastName: 'Thaqi', className: 'V-B', pref1: 'Degjim', pref2: 'Vizatim' },
    { firstName: 'Luan', lastName: 'Hoxha', className: 'V-B', pref1: 'Shkrim', pref2: 'Bashkepunim' },
  ];
  const assistantAssignments = {
    'mirela.nimani@shkolla.edu': ['Arian Krasniqi', 'Era Berisha', 'Dren Gashi', 'Lira Kastrati', 'Noar Morina'],
    'gent.dema@shkolla.edu': ['Jona Bytyqi', 'Yll Kelmendi', 'Rinesa Hoxha', 'Rron Shala', 'Tara Rama'],
    'adelina.peci@shkolla.edu': ['Diar Ahmeti', 'Bora Zeqiri', 'Arti Rexhepi', 'Elsa Kryeziu', 'Luan Musliu'],
    'blerim.qorri@shkolla.edu': ['Nita Maliqi', 'Krenar Hoti', 'Lea Bajrami', 'Ledion Kabashi', 'Dua Sopa'],
    'saranda.gashi@shkolla.edu': ['Andi Lushi', 'Hana Gacaferi', 'Olti Dugolli', 'Aria Thaqi', 'Luan Hoxha'],
  };

  console.log('Clearing school data...');
  const schoolMembers = ensure(
    await adminClient
      .from('profiles')
      .select('id,email,role')
      .eq('school_id', schoolId)
      .in('role', ['teacher', 'parent']),
    'load school members',
  );
  ensure(await adminClient.from('students').delete().eq('school_id', schoolId), 'delete students');
  ensure(
    await adminClient.from('schools').update({ name: 'SHFMU "Iliria"', address: 'Prishtine, Kosove' }).eq('id', schoolId),
    'update school',
  );

  console.log('Removing old teacher and parent accounts...');
  for (const member of schoolMembers) {
    await authAdminDeleteUser(member.id);
  }
  ensure(await adminClient.from('classes').delete().eq('school_id', schoolId), 'delete classes');

  console.log('Creating demo teacher, assistant, and parent accounts...');
  for (const teacher of teachers) Object.assign(teacher, await inviteMember(adminClient, { role: 'teacher', ...teacher }));
  for (const assistant of assistants) Object.assign(assistant, await inviteMember(adminClient, { role: 'assistant_teacher', ...assistant }));
  for (const parent of parents) Object.assign(parent, await inviteMember(adminClient, { role: 'parent', ...parent }));

  const subjects = ensure(await adminClient.from('subjects').select('id,name').eq('active', true).order('name'), 'load subjects');
  const subjectMap = new Map(subjects.map((subject) => [subject.name.toLowerCase(), subject]));
  for (const name of [...new Set(teachers.map((teacher) => teacher.subject))]) {
    if (!subjectMap.has(name.toLowerCase())) {
      ensure(
        await adminClient.rpc('admin_add_school_subject', { target_school_id: schoolId, subject_name: name }),
        `admin_add_school_subject ${name}`,
      );
    }
  }
  const refreshedSubjects = ensure(await adminClient.from('subjects').select('id,name').eq('active', true).order('name'), 'reload subjects');
  const refreshedSubjectMap = new Map(refreshedSubjects.map((subject) => [subject.name.toLowerCase(), subject]));

  console.log('Creating classes, students, and assignments...');
  const classRows = [
    { id: crypto.randomUUID(), school_id: schoolId, name: 'V-A', school_year: schoolYear, active: true },
    { id: crypto.randomUUID(), school_id: schoolId, name: 'V-B', school_year: schoolYear, active: true },
  ];
  ensure(await adminClient.from('classes').insert(classRows), 'insert classes');
  const classByName = new Map(classRows.map((row) => [row.name, row]));

  for (const subject of [...new Set(teachers.map((teacher) => teacher.subject))]) {
    ensure(
      await adminClient.from('school_subjects').upsert({
        school_id: schoolId,
        subject_id: refreshedSubjectMap.get(subject.toLowerCase()).id,
        active: true,
      }, { onConflict: 'school_id,subject_id' }),
      `upsert school_subject ${subject}`,
    );
  }

  const studentRows = students.map((student) => ({
    id: crypto.randomUUID(),
    school_id: schoolId,
    class_id: classByName.get(student.className).id,
    class_name: student.className,
    first_name: student.firstName,
    last_name: student.lastName,
    status: 'active',
    active: true,
  }));
  ensure(await adminClient.from('students').insert(studentRows), 'insert students');
  const studentByName = new Map(studentRows.map((row) => [`${row.first_name} ${row.last_name}`, row]));

  ensure(
    await adminClient.from('teacher_subjects').insert(teachers.map((teacher) => ({
      teacher_id: teacher.id,
      subject_id: refreshedSubjectMap.get(teacher.subject.toLowerCase()).id,
    }))),
    'insert teacher_subjects',
  );

  ensure(
    await adminClient.from('teacher_classes').insert(
      teachers.flatMap((teacher) => classRows.map((classRow) => ({
        teacher_id: teacher.id,
        class_id: classRow.id,
        subject_id: refreshedSubjectMap.get(teacher.subject.toLowerCase()).id,
      }))),
    ),
    'insert teacher_classes',
  );

  ensure(
    await adminClient.from('parent_students').insert(
      parents.flatMap((parent) => parent.students.map((studentName) => ({
        parent_id: parent.id,
        student_id: studentByName.get(studentName).id,
      }))),
    ),
    'insert parent_students',
  );

  ensure(
    await adminClient.from('assistant_teacher_students').insert(
      assistants.flatMap((assistant) => assistantAssignments[assistant.email].map((studentName) => ({
        assistant_teacher_id: assistant.id,
        student_id: studentByName.get(studentName).id,
      }))),
    ),
    'insert assistant_teacher_students',
  );

  ensure(
    await adminClient.from('student_support_profiles').insert(
      students.map((student) => ({
        student_id: studentByName.get(fullName(student)).id,
        support_summary: `Punon me mire kur udhezimet lidhen me ${student.pref1} dhe pasohet me nje aktivitet nepermjet ${student.pref2}.`,
        accessibility_information: 'Udhezime te shkurtra, hapa te qarte dhe kohe e mjaftueshme per fillimin e detyres.',
        preferences: {
          preferred_mode: student.pref1,
          support_preferences: [student.pref1, student.pref2],
          learning_preferences: [student.pref1, student.pref2],
          communication_language: 'Shqip',
          communication_method: student.pref1 === 'Shkrim' ? 'Pika te shkurtra me shkrim' : 'Modelim i shkurter dhe rikujtim',
          additional_notes: 'Reagon mire ndaj ritmit te qarte dhe kalimeve te buta ndermjet detyrave.',
        },
      })),
    ),
    'insert student_support_profiles',
  );

  const existingPeriods = ensure(
    await adminClient.from('academic_periods').select('id,status').eq('school_id', schoolId).order('starts_on', { ascending: false }),
    'load academic periods',
  );
  const reusablePeriod = existingPeriods.find((item) => item.status !== 'closed') || null;
  const period = ensure(
    await adminClient.rpc('admin_save_academic_period', {
      period_id: reusablePeriod ? reusablePeriod.id : null,
      target_school_id: schoolId,
      period_name: 'Gjysmevjetori I',
      period_school_year: schoolYear,
      period_starts_on: '2026-09-01',
      period_ends_on: '2027-01-31',
      period_status: 'active',
    }),
    'admin_save_academic_period',
  );

  const loginCache = new Map();
  async function login(email, password = 'Temp123') {
    const key = `${email}|${password}`;
    if (!loginCache.has(key)) {
      loginCache.set(key, signInAny([{ email, password }]));
    }
    return loginCache.get(key);
  }

  console.log('Seeding daily moods...');
  const parentEmailByStudentName = new Map(
    parents.flatMap((parent) => parent.students.map((studentName) => [studentName, parent.email])),
  );
  const moodTimeline = [
    {
      daysAgo: 4,
      mood: 'E lodhur',
      comment: (student) => `${student.firstName} pati nevoje per me shume kohe ne fillim, por u qetesua kur aktiviteti nisi me ${student.pref1.toLowerCase()}.`,
    },
    {
      daysAgo: 2,
      mood: 'E angazhuar',
      comment: (student) => `${student.firstName} reagoi mire kur puna u lidh me ${student.pref2.toLowerCase()} dhe kalimet u bene hap pas hapi.`,
    },
    {
      daysAgo: 0,
      mood: 'E qete',
      comment: (student) => `${student.firstName} e nisi diten mire dhe po punon me siguri kur udhezimet kombinohen me ${student.pref1.toLowerCase()}.`,
    },
  ];
  const moodPlans = students.flatMap((student) => {
    const name = fullName(student);
    const parentEmail = parentEmailByStudentName.get(name);
    return moodTimeline.map((entry, index) => ([
      parentEmail,
      name,
      entry.mood,
      entry.comment(student),
      isoDate(entry.daysAgo),
      isoStamp(entry.daysAgo, 8 + index, 15),
    ]));
  });
  for (const [email, studentName, mood, comment, reportedOn, updatedAt] of moodPlans) {
    const session = await login(email);
    ensure(
      await session.client.from('daily_moods').upsert({
        student_id: studentByName.get(studentName).id,
        parent_id: session.user.id,
        mood,
        general_comment: comment,
        parent_comment: comment,
        reported_on: reportedOn,
        created_at: updatedAt,
        updated_at: updatedAt,
      }, { onConflict: 'student_id,parent_id,reported_on' }),
      `save daily mood ${email}`,
    );
  }

  console.log('Seeding chapters, grades, and final grades...');
  const chapterPlans = [
    ['besnik.krasniqi@shkolla.edu', 'Matematikë', 'Numrat dhe veprimet'],
    ['besnik.krasniqi@shkolla.edu', 'Matematikë', 'Probleme me hapa'],
    ['arta.berisha@shkolla.edu', 'Gjuhë shqipe', 'Leximi kuptimor'],
    ['arta.berisha@shkolla.edu', 'Gjuhë shqipe', 'Shkrimi i fjalive'],
    ['valbona.gashi@shkolla.edu', 'Edukatë fizike', 'Koordinimi dhe ritmi'],
    ['valbona.gashi@shkolla.edu', 'Edukatë fizike', 'Lojerat ne ekip'],
    ['fatos.hoxha@shkolla.edu', 'Edukate figurative (Art)', 'Ngjyra dhe kompozimi'],
    ['fatos.hoxha@shkolla.edu', 'Edukate figurative (Art)', 'Vizatimi sipas modelit'],
    ['lindita.kastrati@shkolla.edu', 'Biologji', 'Bimet dhe mjedisi'],
    ['lindita.kastrati@shkolla.edu', 'Biologji', 'Trupi i njeriut'],
    ['driton.shala@shkolla.edu', 'TIK', 'Perdorimi i tastieres'],
    ['driton.shala@shkolla.edu', 'TIK', 'Dosjet dhe ruajtja'],
    ['edona.bytyqi@shkolla.edu', 'Gjuhë angleze', 'My Classroom'],
    ['edona.bytyqi@shkolla.edu', 'Gjuhë angleze', 'Daily Routines'],
    ['ilir.morina@shkolla.edu', 'Gjeografi', 'Harta e Kosoves'],
    ['teuta.kelmendi@shkolla.edu', 'Edukatë muzikore', 'Ritmi dhe degjimi'],
    ['arianit.rama@shkolla.edu', 'Kimi', 'Materialet rreth nesh'],
  ];
  const chapterIds = new Map();
  for (const [email, subjectName, chapterName] of chapterPlans) {
    const session = await login(email);
    const subjectId = refreshedSubjectMap.get(subjectName.toLowerCase()).id;
    const existing = ensure(await session.client.from('chapters').select('id,name').eq('subject_id', subjectId), `load chapters ${subjectName}`);
    const found = existing.find((row) => row.name.toLowerCase() === chapterName.toLowerCase());
    if (found) {
      chapterIds.set(`${subjectName}|${chapterName}`, found.id);
    } else {
      const created = ensure(
        await session.client.from('chapters').insert({ subject_id: subjectId, name: chapterName, target_score: 4, active: true }).select().single(),
        `create chapter ${chapterName}`,
      );
      chapterIds.set(`${subjectName}|${chapterName}`, created.id);
    }
  }

  const assessmentPlans = [
    ['besnik.krasniqi@shkolla.edu', 'Arian Krasniqi', 'Matematikë', 'Numrat dhe veprimet', 4.7, 'Ariani po e kap mire ritmin kur perdor hapa te vizatuar.'],
    ['besnik.krasniqi@shkolla.edu', 'Arian Krasniqi', 'Matematikë', 'Probleme me hapa', 4.5, 'Po i ndan problemet ne hapa me me pak ndihme se ne fillim.'],
    ['arta.berisha@shkolla.edu', 'Era Berisha', 'Gjuhë shqipe', 'Leximi kuptimor', 4.8, 'Era e lexoi tekstin me fokus dhe dha pergjigje te plota.'],
    ['arta.berisha@shkolla.edu', 'Era Berisha', 'Gjuhë shqipe', 'Shkrimi i fjalive', 4.4, 'Po organizon me mire fjalite kur merr nje shembull te pare.'],
    ['valbona.gashi@shkolla.edu', 'Dren Gashi', 'Edukatë fizike', 'Koordinimi dhe ritmi', 4.9, 'Energjia e larte po kthehet ne levizje te kontrolluar.'],
    ['valbona.gashi@shkolla.edu', 'Dren Gashi', 'Edukatë fizike', 'Lojerat ne ekip', 4.6, 'Po pret me mire radhen e tij ne lojerat me grup.'],
    ['fatos.hoxha@shkolla.edu', 'Lira Kastrati', 'Edukate figurative (Art)', 'Ngjyra dhe kompozimi', 4.6, 'Punoi me kujdes ne perzgjedhjen e ngjyrave.'],
    ['fatos.hoxha@shkolla.edu', 'Lira Kastrati', 'Edukate figurative (Art)', 'Vizatimi sipas modelit', 4.7, 'Kopjoi formen me saktesi dhe ruajti qetesine deri ne fund.'],
    ['besnik.krasniqi@shkolla.edu', 'Noar Morina', 'Matematikë', 'Probleme me hapa', 4.2, 'Noari perfiton kur levizja e shkurter vendoset mes dy ushtrimeve.'],
    ['arta.berisha@shkolla.edu', 'Jona Bytyqi', 'Gjuhë shqipe', 'Leximi kuptimor', 4.5, 'Jona e kuptoi tekstin me mire kur e degjoi fillimisht me ze.'],
    ['arta.berisha@shkolla.edu', 'Yll Kelmendi', 'Gjuhë shqipe', 'Shkrimi i fjalive', 4.1, 'Ylli po hyn me shpejt ne detyre dhe po e mban strukturen e fjalise.'],
    ['lindita.kastrati@shkolla.edu', 'Elsa Kryeziu', 'Biologji', 'Bimet dhe mjedisi', 4.4, 'Elsa po argumenton me mire vezhgimet e saj.'],
    ['lindita.kastrati@shkolla.edu', 'Elsa Kryeziu', 'Biologji', 'Trupi i njeriut', 4.5, 'Po lidh me qartesi funksionet e pjeseve kryesore te trupit.'],
    ['driton.shala@shkolla.edu', 'Rinesa Hoxha', 'TIK', 'Perdorimi i tastieres', 5.0, 'Pune shume e sigurt dhe e pavarur ne tastiere.'],
    ['driton.shala@shkolla.edu', 'Rinesa Hoxha', 'TIK', 'Dosjet dhe ruajtja', 4.8, 'Ruajti dokumentin ne dosjen e duhur pa pasur nevoje per nderhyrje.'],
    ['edona.bytyqi@shkolla.edu', 'Rron Shala', 'Gjuhë angleze', 'My Classroom', 4.2, 'Rron po e perdor me mire fjalorin kur e degjon fillimisht.'],
    ['edona.bytyqi@shkolla.edu', 'Tara Rama', 'Gjuhë angleze', 'Daily Routines', 4.6, 'Tara foli me siguri per rutinat e dites dhe perdori fjalet kyce sakte.'],
    ['valbona.gashi@shkolla.edu', 'Diar Ahmeti', 'Edukatë fizike', 'Lojerat ne ekip', 4.3, 'Diari po bashkepunon me mire dhe respekton me shpesh radhen e grupit.'],
    ['valbona.gashi@shkolla.edu', 'Bora Zeqiri', 'Edukatë fizike', 'Koordinimi dhe ritmi', 4.4, 'Bora reagoi mire ndaj ritmit dhe ndoqi levizjet me kujdes.'],
    ['fatos.hoxha@shkolla.edu', 'Arti Rexhepi', 'Edukate figurative (Art)', 'Vizatimi sipas modelit', 4.5, 'Arti e ndoqi modelin me qetesi dhe shtoi detaje personale te menduara.'],
    ['edona.bytyqi@shkolla.edu', 'Aria Thaqi', 'Gjuhë angleze', 'My Classroom', 4.3, 'Po e perdor fjalorin me me shume vetebesim.'],
    ['teuta.kelmendi@shkolla.edu', 'Luan Musliu', 'Edukatë muzikore', 'Ritmi dhe degjimi', 4.1, 'Luani mbajti ritmin me mire kur e degjoi modelin ne fillim.'],
    ['besnik.krasniqi@shkolla.edu', 'Nita Maliqi', 'Matematikë', 'Numrat dhe veprimet', 4.6, 'Nita punon me siguri kur sheh shembullin e pare ne flete.'],
    ['driton.shala@shkolla.edu', 'Ledion Kabashi', 'TIK', 'Perdorimi i tastieres', 4.7, 'Ledioni filloi ushtrimin me pak modelim dhe ruajti ritmin deri ne fund.'],
    ['edona.bytyqi@shkolla.edu', 'Dua Sopa', 'Gjuhë angleze', 'Daily Routines', 4.4, 'Dua po e kupton me mire dialogun kur e degjon dhe pastaj e perserit.'],
    ['arta.berisha@shkolla.edu', 'Hana Gacaferi', 'Gjuhë shqipe', 'Shkrimi i fjalive', 4.3, 'Hana po strukturon me mire fjalite kur punon me nje model te shkurter.'],
    ['ilir.morina@shkolla.edu', 'Olti Dugolli', 'Gjeografi', 'Harta e Kosoves', 4.2, 'Olti i gjeti me me shume siguri rajonet kryesore ne harte.'],
    ['arianit.rama@shkolla.edu', 'Luan Hoxha', 'Kimi', 'Materialet rreth nesh', 4.4, 'Luani dalloi me qartesi materialet sipas vetive te tyre kryesore.'],
  ];
  for (const [email, studentName, subjectName, chapterName, score, parentMessage] of assessmentPlans) {
    const session = await login(email);
    ensure(
      await session.client.rpc('save_chapter_assessment', {
        target_student: studentByName.get(studentName).id,
        target_subject: refreshedSubjectMap.get(subjectName.toLowerCase()).id,
        target_chapter: chapterIds.get(`${subjectName}|${chapterName}`),
        target_period: period.id,
        assessment_score: score,
        assessment_parent_message: parentMessage,
      }),
      `save_chapter_assessment ${studentName}`,
    );
  }

  const finalGradePlans = [
    ['besnik.krasniqi@shkolla.edu', 'Arian Krasniqi', 'Matematikë', 5, 'Ka treguar progres te qendrueshem dhe punon mire me hapa te qarte.'],
    ['arta.berisha@shkolla.edu', 'Era Berisha', 'Gjuhë shqipe', 5, 'Lexon me kuptim dhe po e forcon shkrimin e pavarur.'],
    ['valbona.gashi@shkolla.edu', 'Dren Gashi', 'Edukatë fizike', 5, 'Energjia e larte po kanalizohet shume mire ne detyrat fizike.'],
    ['fatos.hoxha@shkolla.edu', 'Lira Kastrati', 'Edukate figurative (Art)', 5, 'Ka ndjeshmeri te mire artistike dhe perqendrohet gjate procesit krijues.'],
    ['lindita.kastrati@shkolla.edu', 'Elsa Kryeziu', 'Biologji', 4, 'Perveteson mire konceptet kur punon me shembuj konkrete.'],
    ['driton.shala@shkolla.edu', 'Rinesa Hoxha', 'TIK', 5, 'Ka performance shume te sigurt dhe te pavarur ne TIK.'],
    ['edona.bytyqi@shkolla.edu', 'Aria Thaqi', 'Gjuhë angleze', 4, 'Po e perdor fjalorin me siguri ne situata te njohura dhe po fiton vetebesim.'],
    ['driton.shala@shkolla.edu', 'Ledion Kabashi', 'TIK', 5, 'Punon ne menyre te pavarur dhe reagon shpejt ndaj udhezimeve te shkurtra.'],
  ];
  for (const [email, studentName, subjectName, grade, parentMessage] of finalGradePlans) {
    const session = await login(email);
    ensure(
      await session.client.rpc('save_final_grade', {
        target_student: studentByName.get(studentName).id,
        target_subject: refreshedSubjectMap.get(subjectName.toLowerCase()).id,
        target_period: period.id,
        final_score: grade,
        final_parent_message: parentMessage,
        confirmation_name: studentName,
      }),
      `save_final_grade ${studentName}`,
    );
  }

  console.log('Seeding PIA, staff logs, and messages...');
  const piaPlans = [
    {
      email: 'mirela.nimani@shkolla.edu',
      studentName: 'Arian Krasniqi',
      title: 'Ndjekja e hapave me mbeshtetje vizuale',
      details: 'Ariani te ndjeke 3 hapa radhazi duke pare skeden vizuale te bankes.',
      updates: [
        { daysAgo: 5, rating: 3, comment: 'E nisi me nje rikujtim verbal, pastaj i ndoqi hapat me ndihme vizuale.' },
        { daysAgo: 2, rating: 4, comment: 'I ndoqi dy hapa pa rikujtim dhe kerkoi sqarim vetem ne fund.' },
        { daysAgo: 0, rating: 4, comment: 'Sot i ndoqi dy hapa pa rikujtim dhe te tretin me nje shenje te vogel.' },
      ],
    },
    {
      email: 'mirela.nimani@shkolla.edu',
      studentName: 'Era Berisha',
      title: 'Ruajtja e vemendjes gjate leximit',
      details: 'Era te qendroje e fokusuar per 8 minuta gjate leximit te udhehequr.',
      updates: [
        { daysAgo: 3, rating: 3, comment: 'E mbajti fokusin me mire kur leximi u nda ne pjese te shkurtra.' },
        { daysAgo: 0, rating: 4, comment: 'Sot qendroi e angazhuar dhe kaloi ne tekstin tjeter pa humbur ritmin.' },
      ],
    },
    {
      email: 'gent.dema@shkolla.edu',
      studentName: 'Yll Kelmendi',
      title: 'Nisja e leximit pa pritje te gjate',
      details: 'Ylli te filloje detyren e leximit brenda 2 minutash pas udhezimit.',
      updates: [
        { daysAgo: 4, rating: 2, comment: 'Priti gjate para fillimit dhe iu desh modelim i plote i rreshtit te pare.' },
        { daysAgo: 1, rating: 3, comment: 'Hyri ne detyre me shpejt se zakonisht pas modelimit te rreshtit te pare.' },
        { daysAgo: 0, rating: 4, comment: 'Sot e nisi leximin pothuajse menjehere pas sinjalit te vendosur.' },
      ],
    },
    {
      email: 'gent.dema@shkolla.edu',
      studentName: 'Rinesa Hoxha',
      title: 'Kalimi i qete mes aktiviteteve',
      details: 'Rinesa te kaloje nga nje aktivitet ne tjetrin me nje udhezim te vetem.',
      updates: [
        { daysAgo: 2, rating: 4, comment: 'Kaloi ne ushtrimin e dyte pa hezitim kur pa renditjen ne flete.' },
        { daysAgo: 0, rating: 5, comment: 'Sot menaxhoi dy kalime rresht vetem me sinjalin e ores.' },
      ],
    },
    {
      email: 'adelina.peci@shkolla.edu',
      studentName: 'Elsa Kryeziu',
      title: 'Kerkesa te qarta per ndihme',
      details: 'Elsa te perdore nje fjali te plote kur ka nevoje per sqarim.',
      updates: [
        { daysAgo: 5, rating: 3, comment: 'Kerkoi ndihme me ze te ulet dhe iu desh nje kujtese per formulimin e plote.' },
        { daysAgo: 2, rating: 4, comment: 'Kerkoi ndihme me fjali te plote ne dy momente te ndryshme.' },
        { daysAgo: 0, rating: 4, comment: 'Sot e tha qarte se cfare nuk kuptoi dhe priti me qetesi sqarimin.' },
      ],
    },
    {
      email: 'adelina.peci@shkolla.edu',
      studentName: 'Diar Ahmeti',
      title: 'Pritja e radhes ne pune ne cift',
      details: 'Diari te prese rradhen e tij pa nderhyre per 5 minuta pune ne cift.',
      updates: [
        { daysAgo: 3, rating: 2, comment: 'Iu deshen disa rikujtime qe te prese radhen ne ushtrimin me partner.' },
        { daysAgo: 0, rating: 3, comment: 'Sot priti me me pak rikujtime dhe pranoi me mire rolet ne cift.' },
      ],
    },
    {
      email: 'blerim.qorri@shkolla.edu',
      studentName: 'Lea Bajrami',
      title: 'Pune ne cift me rol te qarte',
      details: 'Lea te ruaje rolin e saj gjate punes bashkepunuese per 10 minuta.',
      updates: [
        { daysAgo: 4, rating: 3, comment: 'Ruajti rolin e saj shumicen e kohes, por kerkoi dy rikujtime.' },
        { daysAgo: 1, rating: 3, comment: 'Hyri me shpejt ne rol dhe kerkoi rikujtim vetem nje here.' },
        { daysAgo: 0, rating: 4, comment: 'Sot e mbajti detyren e saj deri ne fund dhe ndau materialet me qetesi.' },
      ],
    },
    {
      email: 'blerim.qorri@shkolla.edu',
      studentName: 'Ledion Kabashi',
      title: 'Fillimi i punes pa modelim te plote',
      details: 'Ledioni te nise ushtrimin pasi sheh vetem shembullin e pare.',
      updates: [
        { daysAgo: 2, rating: 4, comment: 'U nis me nje shembull dhe pastaj vazhdoi pa ndihme shtese.' },
        { daysAgo: 0, rating: 4, comment: 'Sot iu desh vetem nje kujtese e shkurter per te filluar.' },
      ],
    },
    {
      email: 'saranda.gashi@shkolla.edu',
      studentName: 'Aria Thaqi',
      title: 'Rikthimi pas pushimit',
      details: 'Aria te rikthehet ne aktivitet me nje udhezim te shkurter dhe modelim.',
      updates: [
        { daysAgo: 5, rating: 3, comment: 'Pas pushimit pati nevoje per nje shembull te shkurter para se te ulej ne pune.' },
        { daysAgo: 2, rating: 4, comment: 'U kthye ne aktivitet pas nje udhezimi te vetem dhe nje gjesti orientues.' },
        { daysAgo: 0, rating: 4, comment: 'Pas pushimit u kthye ne aktivitet me vetem nje fjali orientuese.' },
      ],
    },
    {
      email: 'saranda.gashi@shkolla.edu',
      studentName: 'Luan Hoxha',
      title: 'Perfundimi i detyres me kontroll te shkurter',
      details: 'Luani te mbylle detyren pasi kontrollon dy pika kryesore ne fund.',
      updates: [
        { daysAgo: 3, rating: 3, comment: 'Kontrolloi vetem nje pjese te detyres pa rikujtim te dyte.' },
        { daysAgo: 0, rating: 4, comment: 'Sot i kaloi te dy pikat e kontrollit dhe e dorezoi punen me qetesi.' },
      ],
    },
  ];
  for (const plan of piaPlans) {
    const session = await login(plan.email);
    const objective = ensure(
      await session.client.rpc('save_pia_objective', {
        target_objective: null,
        target_student: studentByName.get(plan.studentName).id,
        objective_title: plan.title,
        objective_details: plan.details,
        objective_active: true,
      }),
      `save_pia_objective ${plan.studentName}`,
    );
    const updateRows = plan.updates.map((update, index) => ({
      objective_id: objective.id,
      student_id: objective.student_id,
      assistant_teacher_id: session.user.id,
      rating: update.rating,
      comment: update.comment,
      reported_on: isoDate(update.daysAgo),
      created_at: isoStamp(update.daysAgo, 10 + index, 10),
      updated_at: isoStamp(update.daysAgo, 10 + index, 25),
    }));
    ensure(
      await session.client.from('pia_objective_updates').insert(updateRows),
      `insert pia_objective_updates ${plan.studentName}`,
    );
    const latestUpdate = updateRows.reduce((latest, current) => (
      new Date(current.updated_at) > new Date(latest.updated_at) ? current : latest
    ));
    ensure(
      await session.client.from('pia_objectives').update({ updated_at: latestUpdate.updated_at }).eq('id', objective.id),
      `touch pia_objective ${plan.studentName}`,
    );
  }

  const staffLogPlans = [
    ['besnik.krasniqi@shkolla.edu', 'teacher', 'Arian Krasniqi', 'I perqendruar', 'Punoi mire me materiale konkrete ne matematike.', 'Ora e pare', 0],
    ['besnik.krasniqi@shkolla.edu', 'teacher', 'Arian Krasniqi', 'Me shume siguri', 'Po i ndjek me mire hapat kur i shkruajme ne flete.', 'Detyre e shtepise', 3],
    ['mirela.nimani@shkolla.edu', 'assistant', 'Era Berisha', 'E angazhuar', 'Hyri shpejt ne detyre pas nje udhezimi te shkurter.', 'Lexim i udhehequr', 0],
    ['mirela.nimani@shkolla.edu', 'assistant', 'Dren Gashi', 'Ka energji', 'Levizjet e shkurtra mes aktiviteteve po e ndihmojne te ruaje fokusin.', 'Kalimi i ores', 2],
    ['gent.dema@shkolla.edu', 'assistant', 'Yll Kelmendi', 'Po hyn me shpejt ne pune', 'Modelimi i rreshtit te pare po e ul kohen e pritjes.', 'Lexim', 1],
    ['gent.dema@shkolla.edu', 'assistant', 'Rinesa Hoxha', 'E qendrueshme', 'Kaloi ne aktivitetin tjeter me nje sinjal te vetem.', 'TIK', 0],
    ['adelina.peci@shkolla.edu', 'assistant', 'Elsa Kryeziu', 'E qendrueshme', 'Ka bashkepunuar mire dhe ka kerkuar ndihme ne menyre te qarte.', 'Pune ne grup', 0],
    ['adelina.peci@shkolla.edu', 'assistant', 'Diar Ahmeti', 'Po pret me mire', 'Pranoi radhen e partnerit me me pak rikujtime se me pare.', 'Pune ne cift', 3],
    ['blerim.qorri@shkolla.edu', 'assistant', 'Lea Bajrami', 'E qete', 'Punoi me mire pasi u modelua hapi i pare.', 'PIA', 0],
    ['blerim.qorri@shkolla.edu', 'assistant', 'Ledion Kabashi', 'I pavarur', 'Nisi ushtrimin pasi pa vetem shembullin e pare.', 'TIK', 2],
    ['saranda.gashi@shkolla.edu', 'assistant', 'Aria Thaqi', 'Po rigjen ritmin', 'U rikthye mire pas nje pushimi te shkurter.', 'Pas pushimit', 0],
    ['saranda.gashi@shkolla.edu', 'assistant', 'Luan Hoxha', 'E kujdesshme', 'Kontrolloi vetem dy pika dhe e mbylli punen pa nxitim.', 'Mbyllja e detyres', 2],
  ];
  for (const [email, reporterRole, studentName, mood, comment, context, daysAgo] of staffLogPlans) {
    const session = await login(email);
    ensure(
      await session.client.from('staff_mood_logs').insert({
        student_id: studentByName.get(studentName).id,
        reporter_id: session.user.id,
        reporter_role: reporterRole,
        mood,
        comment,
        context,
        reported_on: isoDate(daysAgo),
        created_at: isoStamp(daysAgo, 13, 0),
        updated_at: isoStamp(daysAgo, 13, 20),
      }),
      `staff_mood_log ${studentName}`,
    );
  }

  const parentTeacherThreads = [
    ['agron.krasniqi@email.com', 'Arian Krasniqi', 'besnik.krasniqi@shkolla.edu', 'Matematikë', 'Hapat e detyrave te matematikes', "A mund t'i ndajme detyrat e shtepise ne hapa me te vegjel edhe kete jave?", "Po, do t'ia dergoj edhe ne fletore me tre hapa te qarte."],
    ['blerta.berisha@email.com', 'Era Berisha', 'arta.berisha@shkolla.edu', 'Gjuhë shqipe', 'Leximi ne shtepi', 'Era po lexon me mire kur degjon fillimisht modelin. A ta vazhdojme keshtu?', 'Po, kjo po funksionon shume mire. Sot e nisi tekstin menjehere pas modelimit.'],
    ['alban.hoxha@email.com', 'Rinesa Hoxha', 'driton.shala@shkolla.edu', 'TIK', 'Ushtrimet e tastieres', 'A mund ta vazhdojme praktiken e tastieres edhe ne shtepi?', 'Po, sot Rinesa i perfundoi ushtrimet me shume siguri.'],
  ];
  for (const [parentEmail, studentName, teacherEmail, subjectName, title, firstMessage, replyMessage] of parentTeacherThreads) {
    const parentSession = await login(parentEmail);
    const thread = ensure(
      await parentSession.client.rpc('start_parent_teacher_thread', {
        target_student: studentByName.get(studentName).id,
        target_teacher: teachers.find((item) => item.email === teacherEmail).id,
        target_subject: refreshedSubjectMap.get(subjectName.toLowerCase()).id,
        thread_title: title,
        first_message: firstMessage,
      }),
      `start_parent_teacher_thread ${title}`,
    );
    const teacherSession = await login(teacherEmail);
    ensure(
      await teacherSession.client.rpc('send_communication_message', { target_thread: thread.id, message_body: replyMessage }),
      `reply thread ${title}`,
    );
  }

  const assistantParentThreads = [
    ['mirela.nimani@shkolla.edu', 'Arian Krasniqi', 'agron.krasniqi@email.com', 'Mbeshtetja ne klase per Arianin', 'Sot Ariani reagoi mire kur e pame se bashku kartelen me hapat e punes.', 'Faleminderit, do ta perdorim te njejten kartele edhe ne shtepi.'],
    ['adelina.peci@shkolla.edu', 'Elsa Kryeziu', 'mimoza.k@email.com', 'Kerkesa per ndihme gjate ores', 'Elsa sot kerkoi ndihme me fjali te plote ne dy raste.', null],
    ['saranda.gashi@shkolla.edu', 'Aria Thaqi', 'venera.g@email.com', 'Rikthimi pas pushimit', 'Aria u kthye shpejt ne detyre pas pushimit me nje udhezim te vetem.', 'Kjo na ndihmon shume, edhe ne shtepi po funksionon me mire kur e paralajmerojme kthimin.'],
  ];
  for (const [assistantEmail, studentName, parentEmail, title, firstMessage, replyMessage] of assistantParentThreads) {
    const assistantSession = await login(assistantEmail);
    const thread = ensure(
      await assistantSession.client.rpc('start_assistant_thread', {
        target_student: studentByName.get(studentName).id,
        target_recipient: parents.find((item) => item.email === parentEmail).id,
        target_recipient_role: 'parent',
        target_subject: null,
        thread_title: title,
        first_message: firstMessage,
      }),
      `start_assistant_thread parent ${title}`,
    );
    if (replyMessage) {
      const parentSession = await login(parentEmail);
      ensure(
        await parentSession.client.rpc('send_communication_message', { target_thread: thread.id, message_body: replyMessage }),
        `parent reply ${title}`,
      );
    }
  }

  const assistantTeacherThreads = [
    ['gent.dema@shkolla.edu', 'Yll Kelmendi', 'arta.berisha@shkolla.edu', 'Gjuhë shqipe', 'Koordinim per nisjen e leximit', 'Ylli hyri me shpejt ne lexim kur ia modelova rreshtin e pare.', 'E pashe edhe une. Do ta mbajme te njejtin fillim te ores edhe neser.'],
    ['blerim.qorri@shkolla.edu', 'Ledion Kabashi', 'driton.shala@shkolla.edu', 'TIK', 'Mbeshtetja gjate TIK', 'Ledioni pati nevoje per modelim vetem ne fillim te ushtrimit.', "Shume mire, neser do t'ia jap menjehere shembullin e pare dhe pastaj e le te vazhdoje vete."],
  ];
  for (const [assistantEmail, studentName, teacherEmail, subjectName, title, firstMessage, replyMessage] of assistantTeacherThreads) {
    const assistantSession = await login(assistantEmail);
    const thread = ensure(
      await assistantSession.client.rpc('start_assistant_thread', {
        target_student: studentByName.get(studentName).id,
        target_recipient: teachers.find((item) => item.email === teacherEmail).id,
        target_recipient_role: 'teacher',
        target_subject: refreshedSubjectMap.get(subjectName.toLowerCase()).id,
        thread_title: title,
        first_message: firstMessage,
      }),
      `start_assistant_thread teacher ${title}`,
    );
    const teacherSession = await login(teacherEmail);
    ensure(
      await teacherSession.client.rpc('send_communication_message', { target_thread: thread.id, message_body: replyMessage }),
      `teacher reply ${title}`,
    );
  }

  if (adminBootstrap.credentials.email !== adminTarget.email || adminBootstrap.credentials.password !== adminTarget.password) {
    console.log('Switching the bootstrap admin account to the requested demo login...');
    await authAdminUpdateUser(adminUser.id, { email: adminTarget.email, password: adminTarget.password, email_confirm: true });
  }

  console.log('Verifying demo logins and activity...');
  const finalAdmin = await login(adminTarget.email, adminTarget.password);
  const sampleTeacher = await login('arta.berisha@shkolla.edu');
  const sampleAssistant = await login('mirela.nimani@shkolla.edu');
  const sampleParent = await login('agron.krasniqi@email.com');

  const summary = {
    profiles: ensure(await finalAdmin.client.from('profiles').select('*', { count: 'exact', head: true }).eq('school_id', schoolId), 'count profiles'),
    students: ensure(await finalAdmin.client.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId), 'count students'),
    teacherNotifications: await countOwnNotifications(sampleTeacher.client),
    assistantNotifications: await countOwnNotifications(sampleAssistant.client),
    parentNotifications: await countOwnNotifications(sampleParent.client),
    teacherThreads: await countOwnThreads(sampleTeacher.client, 'teacher_id', sampleTeacher.user.id),
    assistantThreads: await countOwnThreads(sampleAssistant.client, 'assistant_teacher_id', sampleAssistant.user.id),
    parentThreads: await countOwnThreads(sampleParent.client, 'parent_id', sampleParent.user.id),
  };

  console.log(JSON.stringify({
    ok: true,
    adminLogin: adminTarget.email,
    defaultPassword: 'Temp123',
    summary,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  if (error.details) console.error(error.details);
  process.exit(1);
});
