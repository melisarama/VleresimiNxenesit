import { supabaseClient } from '../lib/supabaseClient.js';
import { escapeHtml } from '../utils/html.js';
import { formatSqDate } from '../utils/dates.js';
import {
  addSchoolSubject,
  addAdminRelation,
  fetchAdminDashboardData,
  inviteSchoolMember,
  removeAdminRelation,
  saveAdminClass,
  saveAcademicPeriod,
  saveAdminStudent,
  saveTeacherClassAssignment,
  setAdminClassActive,
  setAdminProfileActive,
  setAdminStudentActive,
  setSchoolSubject,
  updateAdminSchool
} from '../services/adminService.js';

const relationConfig = {
  'teacher-class': { table: 'teacher_classes', fields: ['teacher_id', 'class_id', 'subject_id'] },
  'teacher-student': { table: 'teacher_students', fields: ['teacher_id', 'student_id'] },
  'assistant-student': { table: 'assistant_teacher_students', fields: ['assistant_teacher_id', 'student_id'] },
  'parent-student': { table: 'parent_students', fields: ['parent_id', 'student_id'] }
};

const CLASSROOM_TEACHER_SUBJECT_NAME = 'Mësimdhënës klasor';
const DEFAULT_LOWER_PRIMARY_SUBJECT_NAMES = ['Edukatë fizike', 'Matematikë', 'Gjuhë shqipe', 'Edukatë muzikore', 'Anglisht'];

let adminData = null;
let activeView = 'overview';

const studentStatusLabels = {
  active: 'Aktiv',
  inactive: 'Joaktiv'
};

function byId(id) {
  return document.getElementById(id);
}

function fullName(item) {
  return `${item.first_name} ${item.last_name}`.trim();
}

function selected(value, expected) {
  return value === expected ? ' selected' : '';
}

function checked(value) {
  return value ? ' checked' : '';
}

function isLowerPrimaryClassName(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return false;
  return /^(?:[1-5]|I{1,3}|IV|V)(?:[\/\-.\s]|$)/.test(normalized);
}

function enabledSchoolSubjects() {
  const enabledIds = new Set(adminData.schoolSubjects.filter(item => item.active).map(item => item.subject_id));
  return adminData.subjects.filter(subject => enabledIds.has(subject.id));
}

function lowerPrimarySubjectOptions() {
  return enabledSchoolSubjects()
    .filter(subject => subject.name !== CLASSROOM_TEACHER_SUBJECT_NAME)
    .sort((left, right) => left.name.localeCompare(right.name, 'sq'));
}

function lowerPrimarySubjectIds() {
  const availableIds = new Set(lowerPrimarySubjectOptions().map(subject => subject.id));
  const configured = (adminData.school.lower_primary_subject_ids || []).filter(id => availableIds.has(id));
  if (configured.length) return configured;
  return lowerPrimarySubjectOptions()
    .filter(subject => DEFAULT_LOWER_PRIMARY_SUBJECT_NAMES.includes(subject.name))
    .map(subject => subject.id);
}

function isAssistantTeacher(profile) {
  return profile.role === 'teacher' && profile.is_assistant_teacher;
}

function showAdminStatus(message, tone = '') {
  const status = byId('adminStatus');
  status.textContent = message;
  status.className = `admin-status${tone ? ` ${tone}` : ''}`;
  if (message) {
    window.setTimeout(() => {
      if (status.textContent === message) status.textContent = '';
    }, 5000);
  }
}

function friendlyError(error, fallback = 'Veprimi nuk u krye. Provoni perseri.') {
  const message = error?.message || '';
  if (/duplicate|unique/i.test(message)) return 'Ky regjistrim ekziston tashme.';
  if (/ACCOUNT_EXISTS/.test(message)) return 'Nje llogari me kete email ekziston tashme.';
  if (/ACCOUNT_CREATE_FAILED/.test(message)) return 'Llogaria nuk u krijua. Kontrolloni email-in dhe provoni perseri.';
  if (/Failed to send|FunctionsHttpError|Failed to fetch/i.test(message)) return 'Kerkesa nuk u dergua. Kontrolloni nese funksioni admin-users eshte publikuar.';
  if (/CLOSED_PERIOD_IMMUTABLE/.test(message)) return 'Nje periudhe e mbyllur nuk mund te ndryshohet.';
  if (/INVALID_DATES/.test(message)) return 'Data e perfundimit duhet te jete pas dates se fillimit.';
  if (/INVALID_SUBJECT_NAME/.test(message)) return 'Shkruani nje emer te vlefshem per lenden.';
  if (/CLASSROOM_TEACHER_PRIMARY_ONLY/.test(message)) return 'Mësimdhënësi klasor mund të caktohet vetëm për klasat 1-5.';
  if (/LOWER_PRIMARY_SUBJECTS_REQUIRED/.test(message)) return 'Zgjidhni të paktën një lëndë për klasat 1-5.';
  return fallback;
}

async function refreshAdminData() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) throw new Error('SESSION_MISSING');
  adminData = await fetchAdminDashboardData(sessionData.session.user.id);
  renderAdmin();
}

function teachers() {
  return adminData.profiles.filter(profile => profile.role === 'teacher' && !profile.is_assistant_teacher);
}

function assistantTeachers() {
  return adminData.profiles.filter(isAssistantTeacher);
}

function parents() {
  return adminData.profiles.filter(profile => profile.role === 'parent');
}

function teacherSubjectIds(profileId) {
  return new Set([
    ...adminData.teacherSubjects.filter(item => item.teacher_id === profileId).map(item => item.subject_id),
    ...adminData.teacherClasses.filter(item => item.teacher_id === profileId).map(item => item.subject_id).filter(Boolean)
  ]);
}

function renderAdmin() {
  byId('adminSchoolName').textContent = adminData.school.name;
  byId('adminMetricStudents').textContent = adminData.students.filter(student => student.active).length;
  byId('adminMetricTeachers').textContent = teachers().filter(profile => profile.active).length;
  byId('adminMetricParents').textContent = parents().filter(profile => profile.active).length;
  byId('adminMetricClasses').textContent = adminData.classes.filter(item => item.active).length;
  renderStudents();
  renderPeople('teacher', teachers());
  renderPeople('assistant-teacher', assistantTeachers());
  renderPeople('parent', parents());
  renderClasses();
  renderPeriods();
  renderSubjects();
  renderAssignments();
  renderOverview();
  showAdminView(activeView);
}

function renderOverview() {
  const unassignedStudents = adminData.students.filter(student => student.active && !student.class_id);
  const teachersWithoutSubjects = teachers().filter(profile => profile.active && teacherSubjectIds(profile.id).size === 0);
  const assistantsWithoutStudents = assistantTeachers().filter(profile => profile.active && !adminData.assistantTeacherStudents.some(item => item.assistant_teacher_id === profile.id));
  const parentsWithoutStudents = parents().filter(profile => profile.active && !adminData.parentStudents.some(item => item.parent_id === profile.id));
  const issues = [
    [unassignedStudents.length, 'nxenes pa klase', 'students'],
    [teachersWithoutSubjects.length, 'mesimdhenes pa lende', 'assignments'],
    [assistantsWithoutStudents.length, 'asistente pa nxenes', 'assignments'],
    [parentsWithoutStudents.length, 'prinder pa femije te lidhur', 'assignments']
  ];

  byId('adminAttentionList').innerHTML = issues.map(([count, label, view]) => `
    <button type="button" data-open-view="${view}"><strong>${count}</strong><span>${label}</span><span aria-hidden="true">-></span></button>
  `).join('');

  byId('adminSchoolSummary').innerHTML = `
    <div><span>Shkolla</span><strong>${escapeHtml(adminData.school.name)}</strong></div>
    <div><span>Adresa</span><strong>${escapeHtml(adminData.school.address || 'Pa adrese')}</strong></div>
    <div><span>Viti shkollor</span><strong>${escapeHtml(adminData.classes.find(item => item.active)?.school_year || 'Pa te dhena')}</strong></div>
  `;

  const currentPeriod = adminData.academicPeriods.find(period => period.status === 'active');
  byId('adminCurrentPeriod').innerHTML = currentPeriod
    ? `
      <strong>${escapeHtml(currentPeriod.name)}</strong>
      <span>${escapeHtml(currentPeriod.school_year)}</span>
      <small>${escapeHtml(formatAdminDate(currentPeriod.starts_on))} - ${escapeHtml(formatAdminDate(currentPeriod.ends_on))}</small>
    `
    : '<p class="admin-empty">Nuk ka periudhe aktive.</p>';
}

function renderStudents() {
  const classMap = Object.fromEntries(adminData.classes.map(item => [item.id, item.name]));
  const activeStudents = adminData.students.filter(student => student.active);
  const inactiveStudents = adminData.students.filter(student => !student.active);
  const rows = items => items.map(student => `
    <div class="admin-table-row${student.active ? '' : ' is-inactive'}">
      <div data-label="Nxenesi"><strong>${escapeHtml(fullName(student))}</strong><span>${student.active ? 'Aktiv' : 'Joaktiv'}</span></div>
      <div data-label="Klasa">${escapeHtml(classMap[student.class_id] || 'Pa klase')}</div>
      <div data-label="Statusi"><span class="admin-state ${student.active ? 'active' : 'inactive'}">${studentStatusLabels[student.status] || (student.active ? 'Aktiv' : 'Joaktiv')}</span></div>
      <div class="admin-row-actions">
        <button type="button" data-action="edit-student" data-id="${student.id}">Ndrysho</button>
        <button type="button" data-action="toggle-student" data-id="${student.id}">${student.active ? 'Caktivizo' : 'Aktivizo'}</button>
      </div>
    </div>
  `).join('');

  byId('adminStudentsRows').innerHTML = rows(activeStudents) || '<p class="admin-empty">Nuk ka ende nxenes aktive.</p>';
  byId('adminInactiveStudentsRows').innerHTML = rows(inactiveStudents) || '<p class="admin-empty">Nuk ka regjistra joaktive.</p>';
  byId('adminInactiveStudentsCount').textContent = inactiveStudents.length;
}

function renderPeople(kind, people) {
  const isTeacherKind = kind === 'teacher' || kind === 'assistant-teacher';
  const isAssistantKind = kind === 'assistant-teacher';
  const activePeople = people.filter(person => person.active);
  const inactivePeople = people.filter(person => !person.active);

  const rows = items => items.map(person => {
    const relationCount = isTeacherKind
      ? (isAssistantKind
        ? adminData.assistantTeacherStudents.filter(item => item.assistant_teacher_id === person.id).length
        : adminData.teacherStudents.filter(item => item.teacher_id === person.id).length + adminData.teacherClasses.filter(item => item.teacher_id === person.id).length)
      : adminData.parentStudents.filter(item => item.parent_id === person.id).length;
    const relationLabel = isTeacherKind ? (isAssistantKind ? 'nxenes' : 'caktime') : 'femije';
    const roleBadge = isAssistantKind ? ' · Asistent' : '';
    return `
      <div class="admin-table-row${person.active ? '' : ' is-inactive'}">
        <div data-label="Emri"><strong>${escapeHtml(fullName(person))}</strong><span>${escapeHtml(person.email)}${roleBadge}</span></div>
        <div data-label="Lidhjet">${relationCount} ${relationLabel}</div>
        <div data-label="Statusi"><span class="admin-state ${person.active ? 'active' : 'inactive'}">${person.active ? 'Aktiv' : 'Joaktiv'}</span></div>
        <div class="admin-row-actions"><button type="button" data-action="toggle-profile" data-id="${person.id}">${person.active ? 'Caktivizo' : 'Aktivizo'}</button></div>
      </div>
    `;
  }).join('');

  const activeTarget = kind === 'teacher'
    ? 'adminTeacherRows'
    : kind === 'assistant-teacher'
      ? 'adminAssistantTeacherRows'
      : 'adminParentRows';
  const inactiveTarget = kind === 'teacher'
    ? 'adminInactiveTeacherRows'
    : kind === 'assistant-teacher'
      ? 'adminInactiveAssistantTeacherRows'
      : 'adminInactiveParentRows';
  const countTarget = kind === 'teacher'
    ? 'adminInactiveTeachersCount'
    : kind === 'assistant-teacher'
      ? 'adminInactiveAssistantTeachersCount'
      : 'adminInactiveParentsCount';
  const emptyLabel = kind === 'teacher'
    ? 'mesimdhenes aktive'
    : kind === 'assistant-teacher'
      ? 'asistente aktive'
      : 'prinder aktive';

  byId(activeTarget).innerHTML = rows(activePeople) || `<p class="admin-empty">Nuk ka ende ${emptyLabel}.</p>`;
  byId(inactiveTarget).innerHTML = rows(inactivePeople) || '<p class="admin-empty">Nuk ka regjistra joaktive.</p>';
  byId(countTarget).textContent = inactivePeople.length;
}

function renderClasses() {
  byId('adminClassRows').innerHTML = adminData.classes.map(item => {
    const count = adminData.students.filter(student => student.class_id === item.id && student.active).length;
    return `
      <div class="admin-table-row${item.active ? '' : ' is-inactive'}">
        <div data-label="Klasa"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.school_year)}</span></div>
        <div data-label="Nxenesit">${count}</div>
        <div data-label="Statusi"><span class="admin-state ${item.active ? 'active' : 'inactive'}">${item.active ? 'Aktive' : 'Joaktive'}</span></div>
        <div class="admin-row-actions"><button type="button" data-action="edit-class" data-id="${item.id}">Ndrysho</button><button type="button" data-action="toggle-class" data-id="${item.id}">${item.active ? 'Caktivizo' : 'Aktivizo'}</button></div>
      </div>
    `;
  }).join('') || '<p class="admin-empty">Nuk ka ende klasa.</p>';
}

function renderSubjects() {
  const enabledMap = Object.fromEntries(adminData.schoolSubjects.map(item => [item.subject_id, item.active]));
  byId('adminSubjectRows').innerHTML = adminData.subjects.map(subject => `
    <label class="admin-subject-toggle">
      <span><strong>${escapeHtml(subject.name)}</strong><small>${enabledMap[subject.id] === true ? 'E disponueshme ne shkolle' : 'E caktivizuar'}</small></span>
      <input type="checkbox" data-action="toggle-subject" data-id="${subject.id}"${checked(enabledMap[subject.id] === true)}>
    </label>
  `).join('');

  const selectedIds = new Set(lowerPrimarySubjectIds());
  const options = lowerPrimarySubjectOptions();
  byId('adminLowerPrimarySubjectConfig').innerHTML = options.length
    ? `
      <h3>Lëndët për klasat 1-5</h3>
      <p>Zgjidhni cilat lëndë mbulohen kur caktoni <strong>${escapeHtml(CLASSROOM_TEACHER_SUBJECT_NAME)}</strong>. Kjo ruhet për shkollën dhe përdoret automatikisht te Caktimet.</p>
      <div class="admin-subject-bundle-grid">
        ${options.map(subject => `
          <label class="admin-subject-toggle">
            <span><strong>${escapeHtml(subject.name)}</strong><small>${selectedIds.has(subject.id) ? 'Përfshihet te mësimdhënësi klasor' : 'Nuk përfshihet'}</small></span>
            <input type="checkbox" data-action="toggle-lower-primary-subject" data-id="${subject.id}"${checked(selectedIds.has(subject.id))}>
          </label>
        `).join('')}
      </div>
    `
    : `
      <h3>Lëndët për klasat 1-5</h3>
      <p>Aktivizoni së pari lëndët që shkolla i përdor për klasat 1-5, pastaj zgjidhni cilat do të mbulohen nga mësimdhënësi klasor.</p>
    `;
}

function formatAdminDate(value) {
  return formatSqDate(value);
}

function renderPeriods() {
  const statusLabels = { planned: 'E planifikuar', active: 'Aktive', closed: 'E mbyllur' };
  byId('adminPeriodRows').innerHTML = adminData.academicPeriods.map(period => `
    <article class="admin-period-row ${period.status}">
      <div><span>${escapeHtml(period.school_year)}</span><strong>${escapeHtml(period.name)}</strong><small>${escapeHtml(formatAdminDate(period.starts_on))} - ${escapeHtml(formatAdminDate(period.ends_on))}</small></div>
      <span class="admin-state ${period.status === 'active' ? 'active' : 'inactive'}">${statusLabels[period.status]}</span>
      <div class="admin-row-actions">
        ${period.status !== 'closed' ? `<button type="button" data-action="edit-period" data-id="${period.id}">Ndrysho</button>` : ''}
        ${period.status === 'planned' ? `<button type="button" data-action="activate-period" data-id="${period.id}">Aktivizo</button>` : ''}
        ${period.status === 'active' ? `<button type="button" data-action="close-period" data-id="${period.id}">Mbyll</button>` : ''}
      </div>
    </article>
  `).join('') || '<p class="admin-empty">Nuk ka ende periudha akademike.</p>';
}

function relationNames(type, relation) {
  const teacher = adminData.profiles.find(item => item.id === relation.teacher_id);
  const assistant = adminData.profiles.find(item => item.id === relation.assistant_teacher_id);
  const parent = adminData.profiles.find(item => item.id === relation.parent_id);
  const student = adminData.students.find(item => item.id === relation.student_id);
  const subject = adminData.subjects.find(item => item.id === relation.subject_id);
  const schoolClass = adminData.classes.find(item => item.id === relation.class_id);
  if (type === 'teacher-class') return [teacher && fullName(teacher), [schoolClass && schoolClass.name, subject && subject.name].filter(Boolean).join(' · ')];
  if (type === 'teacher-student') return [teacher && fullName(teacher), student && fullName(student)];
  if (type === 'assistant-student') return [assistant && fullName(assistant), student && fullName(student)];
  return [parent && fullName(parent), student && fullName(student)];
}

function relationRows(type, rows) {
  const config = relationConfig[type];
  return rows.map(row => {
    const [left, right] = relationNames(type, row);
    const fieldAttributes = config.fields
      .map(field => `data-${field.replace(/_/g, '-') }="${escapeHtml(row[field] || '')}"`)
      .join(' ');
    return `<div class="admin-assignment"><span><strong>${escapeHtml(left || 'Llogari')}</strong><small>${escapeHtml(right || 'Regjistrim')}</small></span><button type="button" data-action="remove-relation" data-type="${type}" ${fieldAttributes} aria-label="Hiq caktimin">X</button></div>`;
  }).join('') || '<p class="admin-empty">Nuk ka caktime.</p>';
}

function options(items, label, includeBlank = true) {
  return `${includeBlank ? `<option value="">${label}</option>` : ''}${items.map(item => `<option value="${item.id}">${escapeHtml(item.name || fullName(item))}</option>`).join('')}`;
}

function assignmentGroup(type, title, leftOptions, rightOptions, rows) {
  return `<section class="admin-assignment-group"><h3>${title}</h3><form data-relation-form="${type}"><select name="left" required>${leftOptions}</select><select name="right" required>${rightOptions}</select><button class="btn primary" type="submit">Cakto</button></form><div class="admin-assignment-list">${rows}</div></section>`;
}

function teacherClassAssignmentGroup(teacherOptions, classOptions, subjectOptions, rows) {
  return `
    <section class="admin-assignment-group">
      <h3>Klasa + lenda -> mesimdhenes</h3>
      <form class="admin-assignment-form-triple" data-relation-form="teacher-class">
        <select name="class" required>${classOptions}</select>
        <select name="subject" required>${subjectOptions}</select>
        <select name="teacher" required>${teacherOptions}</select>
        <button class="btn primary" type="submit">Cakto</button>
      </form>
      <p class="admin-form-note admin-assignment-note">Kur zgjidhet <strong>${escapeHtml(CLASSROOM_TEACHER_SUBJECT_NAME)}</strong> për një klasë 1-5, sistemi e shtrin caktimin te lëndët e zgjedhura te “Lëndët për klasat 1-5”.</p>
      <div class="admin-assignment-list">${rows}</div>
    </section>
  `;
}

function legacyTeacherStudentGroup(rows) {
  return `
    <section class="admin-assignment-group">
      <h3>Caktime individuale te vjetra</h3>
      <p class="admin-form-note">Keto lidhje ruhen vetem per perputhshmeri me te dhenat ekzistuese. Per caktime te reja, perdorni klasen dhe lenden.</p>
      <div class="admin-assignment-list">${rows}</div>
    </section>
  `;
}

function renderAssignments() {
  const activeTeachers = teachers().filter(item => item.active);
  const activeAssistants = assistantTeachers().filter(item => item.active);
  const activeParents = parents().filter(item => item.active);
  const activeStudents = adminData.students.filter(item => item.active);
  const activeClasses = adminData.classes.filter(item => item.active);
  const enabledIds = new Set(adminData.schoolSubjects.filter(item => item.active).map(item => item.subject_id));
  const activeSubjects = adminData.subjects.filter(item => enabledIds.has(item.id));
  const teacherOptions = options(activeTeachers, 'Zgjidh mesimdhenesin');
  const assistantOptions = options(activeAssistants, 'Zgjidh asistentin');
  const studentOptions = options(activeStudents, 'Zgjidh nxenesin');
  const teacherClassRows = [...adminData.teacherClasses].sort((left, right) => {
    const leftClass = adminData.classes.find(item => item.id === left.class_id)?.name || '';
    const rightClass = adminData.classes.find(item => item.id === right.class_id)?.name || '';
    const leftSubject = adminData.subjects.find(item => item.id === left.subject_id)?.name || '';
    const rightSubject = adminData.subjects.find(item => item.id === right.subject_id)?.name || '';
    return leftClass.localeCompare(rightClass, 'sq') || leftSubject.localeCompare(rightSubject, 'sq');
  });

  byId('adminAssignmentForms').innerHTML = `
    ${teacherClassAssignmentGroup(teacherOptions, options(activeClasses, 'Zgjidh klasen'), options(activeSubjects, 'Zgjidh lenden'), relationRows('teacher-class', teacherClassRows))}
    ${adminData.teacherStudents.length ? legacyTeacherStudentGroup(relationRows('teacher-student', adminData.teacherStudents)) : ''}
    ${assignmentGroup('assistant-student', 'Asistent -> nxenes', assistantOptions, studentOptions, relationRows('assistant-student', adminData.assistantTeacherStudents))}
    ${assignmentGroup('parent-student', 'Prind -> nxenes', options(activeParents, 'Zgjidh prindin'), studentOptions, relationRows('parent-student', adminData.parentStudents))}
  `;
}

function showAdminView(view) {
  activeView = view;
  document.querySelectorAll('[data-admin-view]').forEach(section => section.classList.toggle('hidden', section.dataset.adminView !== view));
  document.querySelectorAll('[data-admin-nav]').forEach(button => button.classList.toggle('active', button.dataset.adminNav === view));
  document.querySelectorAll('[data-admin-mobile-nav]').forEach(button => button.classList.toggle('active', button.dataset.adminMobileNav === view));
  const labels = {
    overview: 'Pasqyra',
    students: 'Nxenesit',
    teachers: 'Mesimdhenesit',
    parents: 'Prinderit',
    classes: 'Klasat',
    periods: 'Periudhat akademike',
    subjects: 'Lendet e shkolles',
    assignments: 'Caktimet'
  };
  byId('adminViewTitle').textContent = labels[view] || 'Administrimi';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAdminDialog(title, body, submitLabel, onSubmit) {
  const dialog = byId('adminDialog');
  byId('adminDialogTitle').textContent = title;
  byId('adminDialogBody').innerHTML = body;
  byId('adminDialogSubmit').textContent = submitLabel;
  byId('adminDialogForm').onsubmit = async event => {
    event.preventDefault();
    const button = byId('adminDialogSubmit');
    button.disabled = true;
    byId('adminDialogError').textContent = '';
    try {
      await onSubmit(new FormData(event.currentTarget));
      dialog.close();
      await refreshAdminData();
      showAdminStatus('Ndryshimet u ruajten.', 'success');
    } catch (error) {
      byId('adminDialogError').textContent = friendlyError(error);
    } finally {
      button.disabled = false;
    }
  };
  dialog.showModal();
}

function openStudentDialog(student = null) {
  const classOptions = adminData.classes
    .filter(item => item.active)
    .map(item => `<option value="${item.id}"${selected(item.id, student?.class_id)}>${escapeHtml(item.name)} · ${escapeHtml(item.school_year)}</option>`)
    .join('');
  openAdminDialog(student ? 'Ndrysho nxenesin' : 'Shto nxenes', `
    <label>Emri<input name="firstName" required maxlength="80" value="${escapeHtml(student?.first_name || '')}"></label>
    <label>Mbiemri<input name="lastName" required maxlength="80" value="${escapeHtml(student?.last_name || '')}"></label>
    <label>Klasa<select name="classId"><option value="">Pa klase</option>${classOptions}</select></label>
    <label>Statusi<select name="status"><option value="active"${selected(student?.status || 'active', 'active')}>Aktiv</option><option value="inactive"${selected(student?.status, 'inactive')}>Joaktiv</option></select></label>
  `, student ? 'Ruaj ndryshimet' : 'Shto nxenesin', async form => {
    const classId = form.get('classId');
    const schoolClass = adminData.classes.find(item => item.id === classId);
    await saveAdminStudent({
      id: student?.id,
      schoolId: adminData.profile.school_id,
      classId,
      className: schoolClass?.name || '',
      firstName: form.get('firstName'),
      lastName: form.get('lastName'),
      status: form.get('status')
    });
  });
}

function openClassDialog(schoolClass = null) {
  const activePeriod = adminData.academicPeriods.find(period => period.status === 'active');
  const schoolYears = [...new Set(adminData.academicPeriods.filter(period => period.status !== 'closed').map(period => period.school_year))];
  if (schoolClass?.school_year && !schoolYears.includes(schoolClass.school_year)) schoolYears.push(schoolClass.school_year);
  if (!schoolYears.length) {
    showAdminView('periods');
    openPeriodDialog();
    return;
  }
  const defaultYear = schoolClass?.school_year || activePeriod?.school_year || schoolYears[0] || '';
  const yearOptions = schoolYears.map(year => `<option value="${escapeHtml(year)}"${selected(year, defaultYear)}>${escapeHtml(year)}${year === activePeriod?.school_year ? ' · Aktual' : ''}</option>`).join('');
  openAdminDialog(schoolClass ? 'Ndrysho klasen' : 'Krijo klase', `
    <label>Emri i klases<input name="name" required maxlength="40" value="${escapeHtml(schoolClass?.name || '')}" placeholder="p.sh. V-A"></label>
    <label>Viti shkollor<select name="schoolYear" required>${yearOptions}</select></label>
  `, schoolClass ? 'Ruaj ndryshimet' : 'Krijo klasen', form => saveAdminClass({
    id: schoolClass?.id,
    schoolId: adminData.profile.school_id,
    name: form.get('name'),
    schoolYear: form.get('schoolYear'),
    active: schoolClass ? schoolClass.active : true
  }));
}

function openSchoolDialog() {
  openAdminDialog('Te dhenat e shkolles', `
    <label>Emri i shkolles<input name="name" required maxlength="140" value="${escapeHtml(adminData.school.name)}"></label>
    <label>Adresa<input name="address" maxlength="200" value="${escapeHtml(adminData.school.address || '')}"></label>
  `, 'Ruaj shkollen', form => updateAdminSchool(adminData.school.id, {
    name: form.get('name').trim(),
    address: form.get('address').trim() || null
  }));
}

function openSubjectDialog() {
  openAdminDialog('Shto lende', `
    <label>Emri i lendes<input name="name" required maxlength="100" placeholder="p.sh. Gjuhe gjermane"></label>
    <p class="admin-form-note">Nese lenda ekziston ne katalog, ajo vetem do te aktivizohet per kete shkolle.</p>
  `, 'Shto lenden', form => addSchoolSubject(adminData.profile.school_id, form.get('name')));
}

function dateInputValue(value) {
  return value ? String(value).slice(0, 10) : '';
}

function openPeriodDialog(period = null) {
  const activeClass = adminData.classes.find(item => item.active);
  const currentYear = new Date().getFullYear();
  const schoolYear = period?.school_year || activeClass?.school_year || `${currentYear}/${currentYear + 1}`;
  const startsOn = dateInputValue(period?.starts_on) || `${currentYear}-09-01`;
  const endsOn = dateInputValue(period?.ends_on) || `${currentYear + 1}-01-31`;
  openAdminDialog(period ? 'Ndrysho periudhen' : 'Shto periudhe', `
    <label>Emri<input name="name" required maxlength="80" value="${escapeHtml(period?.name || '')}" placeholder="p.sh. Gjysmevjetori II"></label>
    <label>Viti shkollor<input name="schoolYear" required maxlength="20" value="${escapeHtml(schoolYear)}" placeholder="2026/2027"></label>
    <label>Fillon me<input name="startsOn" type="date" required value="${startsOn}"></label>
    <label>Perfundon me<input name="endsOn" type="date" required value="${endsOn}"></label>
    <label>Statusi<select name="status"><option value="planned"${selected(period?.status || 'planned', 'planned')}>E planifikuar</option><option value="active"${selected(period?.status, 'active')}>Aktive</option>${period?.status === 'closed' ? '<option value="closed" selected>E mbyllur</option>' : ''}</select></label>
    <p class="admin-form-note">Aktivizimi i kesaj periudhe mbyll automatikisht periudhen aktuale.</p>
  `, period ? 'Ruaj periudhen' : 'Shto periudhen', form => saveAcademicPeriod({
    id: period?.id,
    schoolId: adminData.profile.school_id,
    name: form.get('name'),
    schoolYear: form.get('schoolYear'),
    startsOn: form.get('startsOn'),
    endsOn: form.get('endsOn'),
    status: form.get('status')
  }));
}

function openServerInviteDialog(role) {
  const label = role === 'teacher' ? 'mesimdhenesin' : role === 'assistant_teacher' ? 'asistentin' : 'prindin';
  openAdminDialog(`Shto ${label}`, `
    <label>Emri<input name="firstName" required maxlength="80"></label>
    <label>Mbiemri<input name="lastName" required maxlength="80"></label>
    <label>Email<input name="email" type="email" required autocomplete="email"></label>
    <p class="admin-form-note">Llogaria krijohet menjehere. Fjalekalimi i perkohshem gjenerohet nga serveri dhe shfaqet vetem ne console pas suksesit.</p>
  `, 'Krijo llogarine', async form => {
    const firstName = form.get('firstName');
    const lastName = form.get('lastName');
    const email = form.get('email');
    const result = await inviteSchoolMember({ role, firstName, lastName, email });
    const password = result?.temporaryPassword || '(nuk u kthye nga serveri)';
    console.log(`%c[LLOGARIA E RE] ${role.toUpperCase()}`, 'color:#22c55e;font-weight:bold;font-size:14px');
    console.log(`Emri: ${firstName} ${lastName}`);
    console.log(`Email: ${email}`);
    console.log(`Fjalekalimi: ${password}`);
    console.log(`Roli: ${role}`);
    console.log('---');
    showAdminStatus('Llogaria u krijua. Fjalekalimi i perkohshem u shkrua ne console.', 'success');
  });
}

async function handleAdminAction(action, id, target) {
  if (action === 'add-student') return openStudentDialog();
  if (action === 'edit-student') return openStudentDialog(adminData.students.find(item => item.id === id));
  if (action === 'add-class') return openClassDialog();
  if (action === 'edit-class') return openClassDialog(adminData.classes.find(item => item.id === id));
  if (action === 'invite-teacher') return openServerInviteDialog('teacher');
  if (action === 'invite-assistant-teacher') return openServerInviteDialog('assistant_teacher');
  if (action === 'invite-parent') return openServerInviteDialog('parent');
  if (action === 'edit-school') return openSchoolDialog();
  if (action === 'add-subject') return openSubjectDialog();
  if (action === 'add-period') return openPeriodDialog();
  if (action === 'edit-period') return openPeriodDialog(adminData.academicPeriods.find(item => item.id === id));

  try {
    if (action === 'toggle-student') {
      const student = adminData.students.find(item => item.id === id);
      await setAdminStudentActive(id, !student.active);
    } else if (action === 'toggle-class') {
      const schoolClass = adminData.classes.find(item => item.id === id);
      await setAdminClassActive(id, !schoolClass.active);
    } else if (action === 'toggle-profile') {
      const profile = adminData.profiles.find(item => item.id === id);
      await setAdminProfileActive(id, !profile.active);
    } else if (action === 'toggle-subject') {
      const assignments = adminData.teacherSubjects.filter(item => item.subject_id === id).length + adminData.teacherClasses.filter(item => item.subject_id === id).length;
      if (!target.checked && assignments && !window.confirm(`Kjo lende ka ${assignments} caktime me mesimdhenes. Vazhdoni?`)) {
        target.checked = true;
        return;
      }
      await setSchoolSubject(adminData.profile.school_id, id, target.checked);
      if (!target.checked && (adminData.school.lower_primary_subject_ids || []).includes(id)) {
        const availableAfterToggle = lowerPrimarySubjectOptions()
          .filter(subject => subject.id !== id)
          .map(subject => subject.id);
        const nextBundle = (adminData.school.lower_primary_subject_ids || [])
          .filter(subjectId => subjectId !== id && availableAfterToggle.includes(subjectId));
        if (!nextBundle.length && availableAfterToggle.length) nextBundle.push(availableAfterToggle[0]);
        await updateAdminSchool(adminData.school.id, {
          lower_primary_subject_ids: nextBundle
        });
      }
    } else if (action === 'toggle-lower-primary-subject') {
      const current = new Set(lowerPrimarySubjectIds());
      if (target.checked) current.add(id);
      else current.delete(id);
      if (!current.size) {
        target.checked = true;
        showAdminStatus('Paketës së klasave 1-5 duhet t’i mbetet të paktën një lëndë.', 'error');
        return;
      }
      await updateAdminSchool(adminData.school.id, { lower_primary_subject_ids: [...current] });
    } else if (action === 'activate-period' || action === 'close-period') {
      const period = adminData.academicPeriods.find(item => item.id === id);
      const status = action === 'activate-period' ? 'active' : 'closed';
      if (status === 'active' && !window.confirm('Aktivizimi i kesaj periudhe do te mbylle periudhen aktuale. Vazhdoni?')) return;
      if (status === 'closed' && !window.confirm('Pas mbylljes, kjo periudhe dhe vleresimet e saj nuk mund te ndryshohen. Vazhdoni?')) return;
      await saveAcademicPeriod({
        id: period.id,
        schoolId: period.school_id,
        name: period.name,
        schoolYear: period.school_year,
        startsOn: period.starts_on,
        endsOn: period.ends_on,
        status
      });
    } else if (action === 'remove-relation') {
      const config = relationConfig[target.dataset.type];
      const filters = Object.fromEntries(config.fields.map(field => [field, target.dataset[field.replace(/_([a-z])/g, (_, character) => character.toUpperCase())]]));
      await removeAdminRelation(config.table, filters);
    }
    await refreshAdminData();
    showAdminStatus('Ndryshimi u ruajt.', 'success');
  } catch (error) {
    if (action === 'toggle-subject') target.checked = !target.checked;
    showAdminStatus(friendlyError(error), 'error');
  }
}

async function submitRelation(form) {
  const type = form.dataset.relationForm;
  const data = new FormData(form);
  if (type === 'teacher-class') {
    const classId = data.get('class');
    const subjectId = data.get('subject');
    const teacherId = data.get('teacher');
    const schoolClass = adminData.classes.find(item => item.id === classId);
    const subject = adminData.subjects.find(item => item.id === subjectId);
    await saveTeacherClassAssignment({
      classId,
      subjectId,
      teacherId,
      className: schoolClass?.name || '',
      subjectName: subject?.name || '',
      lowerPrimarySubjectIds: lowerPrimarySubjectIds()
    });
    if (subject?.name === CLASSROOM_TEACHER_SUBJECT_NAME && isLowerPrimaryClassName(schoolClass?.name || '')) {
      showAdminStatus('Caktimi u zgjerua te të gjitha lëndët e zgjedhura për klasat 1-5.', 'success');
      await refreshAdminData();
      return;
    }
  } else {
    const config = relationConfig[type];
    const fieldValues = Object.fromEntries(config.fields.map((field, index) => [field, data.get(index === 0 ? 'left' : 'right')]));
    await addAdminRelation(config.table, fieldValues);
  }
  await refreshAdminData();
  showAdminStatus('Caktimi u shtua.', 'success');
}

export function initializeAdminWorkflow() {
  byId('adminRole').onclick = () => {
    byId('roleGate').classList.add('hidden');
    byId('adminLogin').classList.remove('hidden');
  };
  byId('backToRolesAdmin').onclick = () => {
    byId('adminLogin').classList.add('hidden');
    byId('roleGate').classList.remove('hidden');
  };
  byId('adminPasswordToggle').onclick = () => {
    const field = byId('adminPassword');
    const visible = field.type === 'text';
    field.type = visible ? 'password' : 'text';
    byId('adminPasswordToggle').textContent = visible ? '◉' : '◌';
    byId('adminPasswordToggle').setAttribute('aria-label', visible ? 'Shfaq fjalekalimin' : 'Fshih fjalekalimin');
  };
  byId('continueAdmin').onclick = async () => {
    const email = byId('adminEmail').value.trim();
    const password = byId('adminPassword').value;
    const status = byId('adminLoginStatus');
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
      adminData = await fetchAdminDashboardData(data.user.id);
      status.textContent = '';
      byId('adminLogin').classList.add('hidden');
      byId('adminApp').classList.remove('hidden');
      renderAdmin();
    } catch (loadError) {
      await supabaseClient.auth.signOut();
      status.textContent = 'Kjo llogari nuk eshte e autorizuar si administrator i shkolles.';
      console.warn('Admin login:', loadError);
    }
  };
  byId('adminLogout').onclick = async () => {
    try {
      await supabaseClient.auth.signOut();
    } finally {
      adminData = null;
      byId('adminApp').classList.add('hidden');
      byId('adminLogin').classList.add('hidden');
      byId('roleGate').classList.remove('hidden');
      window.location.reload();
    }
  };
  byId('adminDialogCancel').onclick = () => byId('adminDialog').close();
  byId('adminDialogCancelSecondary').onclick = () => byId('adminDialog').close();
  byId('adminApp').addEventListener('click', event => {
    const nav = event.target.closest('[data-admin-nav],[data-admin-mobile-nav],[data-open-view]');
    if (nav) {
      showAdminView(nav.dataset.adminNav || nav.dataset.adminMobileNav || nav.dataset.openView);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) handleAdminAction(action.dataset.action, action.dataset.id, action);
  });
  byId('adminApp').addEventListener('submit', event => {
    const relationForm = event.target.closest('[data-relation-form]');
    if (!relationForm) return;
    event.preventDefault();
    submitRelation(relationForm).catch(error => showAdminStatus(friendlyError(error), 'error'));
  });
  byId('adminMobileLogout')?.addEventListener('click', () => byId('adminLogout').click());
  supabaseClient.auth.getSession().then(async ({ data }) => {
    if (!data.session) return;
    try {
      adminData = await fetchAdminDashboardData(data.session.user.id);
      byId('roleGate').classList.add('hidden');
      byId('adminLogin').classList.add('hidden');
      byId('adminApp').classList.remove('hidden');
      renderAdmin();
    } catch {
      // Teacher and parent sessions are handled in their own workflows.
    }
  });
}
