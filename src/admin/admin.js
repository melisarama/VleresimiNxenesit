import { supabaseClient } from '../lib/supabaseClient.js';
import { escapeHtml } from '../utils/html.js';
import {
  addSchoolSubject,
  addAdminRelation,
  fetchAdminDashboardData,
  inviteSchoolMember,
  removeAdminRelation,
  saveAdminClass,
  saveAcademicPeriod,
  saveAdminStudent,
  setAdminClassActive,
  setAdminProfileActive,
  setAdminStudentActive,
  setSchoolSubject,
  updateAdminSchool
} from '../services/adminService.js';

const relationConfig = {
  'teacher-subject': { table: 'teacher_subjects', left: 'teacher_id', right: 'subject_id' },
  'teacher-class': { table: 'teacher_classes', left: 'teacher_id', right: 'class_id' },
  'teacher-student': { table: 'teacher_students', left: 'teacher_id', right: 'student_id' },
  'parent-student': { table: 'parent_students', left: 'parent_id', right: 'student_id' }
};

let adminData = null;
let activeView = 'overview';
const studentStatusLabels = { active: 'Aktiv', inactive: 'Joaktiv', transferred: 'I transferuar' };

function byId(id) { return document.getElementById(id); }
function fullName(item) { return `${item.first_name} ${item.last_name}`.trim(); }
function selected(value, expected) { return value === expected ? ' selected' : ''; }
function checked(value) { return value ? ' checked' : ''; }

function showAdminStatus(message, tone = '') {
  const status = byId('adminStatus');
  status.textContent = message;
  status.className = `admin-status${tone ? ` ${tone}` : ''}`;
  if (message) window.setTimeout(() => { if (status.textContent === message) status.textContent = ''; }, 5000);
}

function friendlyError(error, fallback = 'Veprimi nuk u krye. Provoni përsëri.') {
  const message = error && error.message ? error.message : '';
  if (/duplicate|unique/i.test(message)) return 'Ky regjistrim ekziston tashmë.';
  if (/ACCOUNT_EXISTS/.test(message)) return 'Një llogari me këtë email ekziston tashmë.';
  if (/ACCOUNT_EMAIL_QUEUE_FAILED/.test(message)) return 'Llogaria u krijua, por email-i i llogarisë nuk u përgatit. Provoni përsëri.';
  if (/ACCOUNT_EMAIL_SEND_FAILED/.test(message)) return 'Email-i me të dhënat e llogarisë nuk u dërgua. Kontrolloni konfigurimin e Resend.';
  if (/ACCOUNT_CREATE_FAILED/.test(message)) return 'Llogaria nuk u krijua. Kontrolloni email-in dhe provoni përsëri.';
  if (/Failed to send|FunctionsHttpError|Failed to fetch/i.test(message)) return 'Ftesa nuk u dërgua. Kontrolloni nëse funksioni admin-users është publikuar.';
  if (/CLOSED_PERIOD_IMMUTABLE/.test(message)) return 'Një periudhë e mbyllur nuk mund të ndryshohet.';
  if (/INVALID_DATES/.test(message)) return 'Data e përfundimit duhet të jetë pas datës së fillimit.';
  if (/INVALID_SUBJECT_NAME/.test(message)) return 'Shkruani një emër të vlefshëm për lëndën.';
  return fallback;
}

async function refreshAdminData() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) throw new Error('SESSION_MISSING');
  adminData = await fetchAdminDashboardData(sessionData.session.user.id);
  renderAdmin();
}

function renderAdmin() {
  const teachers = adminData.profiles.filter(profile => profile.role === 'teacher');
  const parents = adminData.profiles.filter(profile => profile.role === 'parent');
  byId('adminSchoolName').textContent = adminData.school.name;
  byId('adminWelcomeName').textContent = fullName(adminData.profile);
  byId('adminMetricStudents').textContent = adminData.students.filter(student => student.active).length;
  byId('adminMetricTeachers').textContent = teachers.filter(teacher => teacher.active).length;
  byId('adminMetricParents').textContent = parents.filter(parent => parent.active).length;
  byId('adminMetricClasses').textContent = adminData.classes.filter(item => item.active).length;
  renderStudents();
  renderPeople('teacher', teachers);
  renderPeople('parent', parents);
  renderClasses();
  renderPeriods();
  renderSubjects();
  renderAssignments();
  renderOverview();
  showAdminView(activeView);
}

function renderOverview() {
  const unassignedStudents = adminData.students.filter(student => student.active && !student.class_id);
  const teachersWithoutSubjects = adminData.profiles.filter(profile => profile.role === 'teacher' && profile.active && !adminData.teacherSubjects.some(item => item.teacher_id === profile.id));
  const parentsWithoutStudents = adminData.profiles.filter(profile => profile.role === 'parent' && profile.active && !adminData.parentStudents.some(item => item.parent_id === profile.id));
  const issues = [
    [unassignedStudents.length, 'nxënës pa klasë', 'students'],
    [teachersWithoutSubjects.length, 'mësimdhënës pa lëndë', 'assignments'],
    [parentsWithoutStudents.length, 'prindër pa fëmijë të lidhur', 'assignments']
  ];
  byId('adminAttentionList').innerHTML = issues.map(([count, label, view]) => `
    <button type="button" data-open-view="${view}"><strong>${count}</strong><span>${label}</span><span aria-hidden="true">→</span></button>
  `).join('');
  byId('adminSchoolSummary').innerHTML = `
    <div><span>Shkolla</span><strong>${escapeHtml(adminData.school.name)}</strong></div>
    <div><span>Adresa</span><strong>${escapeHtml(adminData.school.address || 'Pa adresë')}</strong></div>
    <div><span>Viti shkollor</span><strong>${escapeHtml(adminData.classes.find(item => item.active)?.school_year || 'Pa të dhëna')}</strong></div>
  `;
  const currentPeriod = adminData.academicPeriods.find(period => period.status === 'active');
  byId('adminCurrentPeriod').innerHTML = currentPeriod ? `
    <strong>${escapeHtml(currentPeriod.name)}</strong>
    <span>${escapeHtml(currentPeriod.school_year)}</span>
    <small>${escapeHtml(formatAdminDate(currentPeriod.starts_on))} – ${escapeHtml(formatAdminDate(currentPeriod.ends_on))}</small>
  ` : '<p class="admin-empty">Nuk ka periudhë aktive.</p>';
}

function renderStudents() {
  const classMap = Object.fromEntries(adminData.classes.map(item => [item.id, item.name]));
  const activeStudents = adminData.students.filter(student => student.active);
  const inactiveStudents = adminData.students.filter(student => !student.active);
  const studentRows = students => students.map(student => `
    <div class="admin-table-row${student.active ? '' : ' is-inactive'}">
      <div data-label="Nxënësi"><strong>${escapeHtml(fullName(student))}</strong><span>${student.active ? 'Aktiv' : 'Joaktiv'}</span></div>
      <div data-label="Klasa">${escapeHtml(classMap[student.class_id] || 'Pa klasë')}</div>
      <div data-label="Statusi"><span class="admin-state ${student.active ? 'active' : 'inactive'}">${studentStatusLabels[student.status] || (student.active ? 'Aktiv' : 'Joaktiv')}</span></div>
      <div class="admin-row-actions">
        <button type="button" data-action="edit-student" data-id="${student.id}">Ndrysho</button>
        <button type="button" data-action="toggle-student" data-id="${student.id}">${student.active ? 'Çaktivizo' : 'Aktivizo'}</button>
      </div>
    </div>
  `).join('');
  byId('adminStudentsRows').innerHTML = studentRows(activeStudents) || '<p class="admin-empty">Nuk ka ende nxënës aktivë.</p>';
  byId('adminInactiveStudentsRows').innerHTML = studentRows(inactiveStudents) || '<p class="admin-empty">Nuk ka regjistra joaktivë.</p>';
  byId('adminInactiveStudentsCount').textContent = inactiveStudents.length;
}

function renderPeople(role, people) {
  const isTeacher = role === 'teacher';
  const activePeople = people.filter(person => person.active);
  const inactivePeople = people.filter(person => !person.active);
  const peopleRows = records => records.map(person => {
    const relationCount = isTeacher
      ? adminData.teacherStudents.filter(item => item.teacher_id === person.id).length + adminData.teacherClasses.filter(item => item.teacher_id === person.id).length
      : adminData.parentStudents.filter(item => item.parent_id === person.id).length;
    return `
      <div class="admin-table-row${person.active ? '' : ' is-inactive'}">
        <div data-label="Emri"><strong>${escapeHtml(fullName(person))}</strong><span>${escapeHtml(person.email)}</span></div>
        <div data-label="Lidhjet">${relationCount} ${isTeacher ? 'caktime' : 'fëmijë'}</div>
        <div data-label="Statusi"><span class="admin-state ${person.active ? 'active' : 'inactive'}">${person.active ? 'Aktiv' : 'Joaktiv'}</span></div>
        <div class="admin-row-actions"><button type="button" data-action="toggle-profile" data-id="${person.id}">${person.active ? 'Çaktivizo' : 'Aktivizo'}</button></div>
      </div>`;
  }).join('');
  byId(isTeacher ? 'adminTeacherRows' : 'adminParentRows').innerHTML = peopleRows(activePeople) || `<p class="admin-empty">Nuk ka ende ${isTeacher ? 'mësimdhënës aktivë' : 'prindër aktivë'}.</p>`;
  byId(isTeacher ? 'adminInactiveTeacherRows' : 'adminInactiveParentRows').innerHTML = peopleRows(inactivePeople) || '<p class="admin-empty">Nuk ka regjistra joaktivë.</p>';
  byId(isTeacher ? 'adminInactiveTeachersCount' : 'adminInactiveParentsCount').textContent = inactivePeople.length;
}

function renderClasses() {
  byId('adminClassRows').innerHTML = adminData.classes.map(item => {
    const count = adminData.students.filter(student => student.class_id === item.id && student.active).length;
    return `
      <div class="admin-table-row${item.active ? '' : ' is-inactive'}">
        <div data-label="Klasa"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.school_year)}</span></div>
        <div data-label="Nxënësit">${count}</div>
        <div data-label="Statusi"><span class="admin-state ${item.active ? 'active' : 'inactive'}">${item.active ? 'Aktive' : 'Joaktive'}</span></div>
        <div class="admin-row-actions"><button type="button" data-action="edit-class" data-id="${item.id}">Ndrysho</button><button type="button" data-action="toggle-class" data-id="${item.id}">${item.active ? 'Çaktivizo' : 'Aktivizo'}</button></div>
      </div>`;
  }).join('') || '<p class="admin-empty">Nuk ka ende klasa.</p>';
}

function renderSubjects() {
  const enabledMap = Object.fromEntries(adminData.schoolSubjects.map(item => [item.subject_id, item.active]));
  byId('adminSubjectRows').innerHTML = adminData.subjects.map(subject => `
    <label class="admin-subject-toggle">
      <span><strong>${escapeHtml(subject.name)}</strong><small>${enabledMap[subject.id] === true ? 'E disponueshme në shkollë' : 'E çaktivizuar'}</small></span>
      <input type="checkbox" data-action="toggle-subject" data-id="${subject.id}"${checked(enabledMap[subject.id] === true)}>
    </label>
  `).join('');
}

function formatAdminDate(value) {
  return new Intl.DateTimeFormat('sq-AL', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`));
}

function renderPeriods() {
  const statusLabels = { planned: 'E planifikuar', active: 'Aktive', closed: 'E mbyllur' };
  byId('adminPeriodRows').innerHTML = adminData.academicPeriods.map(period => `
    <article class="admin-period-row ${period.status}">
      <div><span>${escapeHtml(period.school_year)}</span><strong>${escapeHtml(period.name)}</strong><small>${escapeHtml(formatAdminDate(period.starts_on))} – ${escapeHtml(formatAdminDate(period.ends_on))}</small></div>
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
  const parent = adminData.profiles.find(item => item.id === relation.parent_id);
  const student = adminData.students.find(item => item.id === relation.student_id);
  const subject = adminData.subjects.find(item => item.id === relation.subject_id);
  const schoolClass = adminData.classes.find(item => item.id === relation.class_id);
  if (type === 'teacher-subject') return [teacher && fullName(teacher), subject && subject.name];
  if (type === 'teacher-class') return [teacher && fullName(teacher), schoolClass && schoolClass.name];
  if (type === 'teacher-student') return [teacher && fullName(teacher), student && fullName(student)];
  return [parent && fullName(parent), student && fullName(student)];
}

function relationRows(type, rows) {
  const config = relationConfig[type];
  return rows.map(row => {
    const [left, right] = relationNames(type, row);
    return `<div class="admin-assignment"><span><strong>${escapeHtml(left || 'Llogari')}</strong><small>${escapeHtml(right || 'Regjistrim')}</small></span><button type="button" data-action="remove-relation" data-type="${type}" data-left="${row[config.left]}" data-right="${row[config.right]}" aria-label="Hiq caktimin">×</button></div>`;
  }).join('') || '<p class="admin-empty">Nuk ka caktime.</p>';
}

function options(items, label, includeBlank = true) {
  return `${includeBlank ? `<option value="">${label}</option>` : ''}${items.map(item => `<option value="${item.id}">${escapeHtml(item.name || fullName(item))}</option>`).join('')}`;
}

function renderAssignments() {
  const teachers = adminData.profiles.filter(item => item.role === 'teacher' && item.active);
  const parents = adminData.profiles.filter(item => item.role === 'parent' && item.active);
  const students = adminData.students.filter(item => item.active);
  const classes = adminData.classes.filter(item => item.active);
  const enabledIds = new Set(adminData.schoolSubjects.filter(item => item.active).map(item => item.subject_id));
  const subjects = adminData.subjects.filter(item => enabledIds.has(item.id));
  const teacherOptions = options(teachers, 'Zgjidh mësimdhënësin');
  const studentOptions = options(students, 'Zgjidh nxënësin');
  byId('adminAssignmentForms').innerHTML = `
    ${assignmentGroup('teacher-subject', 'Mësimdhënës → lëndë', teacherOptions, options(subjects, 'Zgjidh lëndën'), relationRows('teacher-subject', adminData.teacherSubjects))}
    ${assignmentGroup('teacher-class', 'Mësimdhënës → klasë', teacherOptions, options(classes, 'Zgjidh klasën'), relationRows('teacher-class', adminData.teacherClasses))}
    ${assignmentGroup('teacher-student', 'Mësimdhënës → nxënës', teacherOptions, studentOptions, relationRows('teacher-student', adminData.teacherStudents))}
    ${assignmentGroup('parent-student', 'Prind → nxënës', options(parents, 'Zgjidh prindin'), studentOptions, relationRows('parent-student', adminData.parentStudents))}
  `;
}

function assignmentGroup(type, title, leftOptions, rightOptions, rows) {
  return `<section class="admin-assignment-group"><h3>${title}</h3><form data-relation-form="${type}"><select name="left" required>${leftOptions}</select><select name="right" required>${rightOptions}</select><button class="btn primary" type="submit">Cakto</button></form><div class="admin-assignment-list">${rows}</div></section>`;
}

function showAdminView(view) {
  activeView = view;
  document.querySelectorAll('[data-admin-view]').forEach(section => section.classList.toggle('hidden', section.dataset.adminView !== view));
  document.querySelectorAll('[data-admin-nav]').forEach(button => button.classList.toggle('active', button.dataset.adminNav === view));
  const labels = { overview: 'Pasqyra', students: 'Nxënësit', teachers: 'Mësimdhënësit', parents: 'Prindërit', classes: 'Klasat', periods: 'Periudhat akademike', subjects: 'Lëndët e shkollës', assignments: 'Caktimet' };
  byId('adminViewTitle').textContent = labels[view] || 'Administrimi';
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
      showAdminStatus('Ndryshimet u ruajtën.', 'success');
    } catch (error) {
      byId('adminDialogError').textContent = friendlyError(error);
    } finally {
      button.disabled = false;
    }
  };
  dialog.showModal();
}

function openStudentDialog(student = null) {
  const classOptions = adminData.classes.filter(item => item.active).map(item => `<option value="${item.id}"${selected(item.id, student && student.class_id)}>${escapeHtml(item.name)} · ${escapeHtml(item.school_year)}</option>`).join('');
  openAdminDialog(student ? 'Ndrysho nxënësin' : 'Shto nxënës', `
    <label>Emri<input name="firstName" required maxlength="80" value="${escapeHtml(student?.first_name || '')}"></label>
    <label>Mbiemri<input name="lastName" required maxlength="80" value="${escapeHtml(student?.last_name || '')}"></label>
    <label>Klasa<select name="classId"><option value="">Pa klasë</option>${classOptions}</select></label>
    <label>Statusi<select name="status"><option value="active"${selected(student?.status || 'active', 'active')}>Aktiv</option><option value="inactive"${selected(student?.status, 'inactive')}>Joaktiv</option><option value="transferred"${selected(student?.status, 'transferred')}>I transferuar</option></select></label>
  `, student ? 'Ruaj ndryshimet' : 'Shto nxënësin', async form => {
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
  const yearOptions = schoolYears.map(year => {
    const suffix = year === activePeriod?.school_year ? ' · Aktual' : '';
    return `<option value="${escapeHtml(year)}"${selected(year, defaultYear)}>${escapeHtml(year + suffix)}</option>`;
  }).join('');
  openAdminDialog(schoolClass ? 'Ndrysho klasën' : 'Krijo klasë', `
    <label>Emri i klasës<input name="name" required maxlength="40" value="${escapeHtml(schoolClass?.name || '')}" placeholder="p.sh. V-A"></label>
    <label>Viti shkollor<select name="schoolYear" required>${yearOptions}</select></label>
  `, schoolClass ? 'Ruaj ndryshimet' : 'Krijo klasën', form => saveAdminClass({
    id: schoolClass?.id,
    schoolId: adminData.profile.school_id,
    name: form.get('name'),
    schoolYear: form.get('schoolYear'),
    active: schoolClass ? schoolClass.active : true
  }));
}

function openInviteDialog(role) {
  const label = role === 'teacher' ? 'mësimdhënësin' : 'prindin';
  openAdminDialog(`Fto ${label}`, `
    <label>Emri<input name="firstName" required maxlength="80"></label>
    <label>Mbiemri<input name="lastName" required maxlength="80"></label>
    <label>Email<input name="email" type="email" required autocomplete="email"></label>
    <p class="admin-form-note">Përdoruesi do të marrë email me email-in dhe fjalëkalimin e përkohshëm. Llogaria lidhet automatikisht me këtë shkollë.</p>
  `, 'Krijo llogarinë', async form => {
    await inviteSchoolMember({ role, firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email') });
  });
}

function openSchoolDialog() {
  openAdminDialog('Të dhënat e shkollës', `
    <label>Emri i shkollës<input name="name" required maxlength="140" value="${escapeHtml(adminData.school.name)}"></label>
    <label>Adresa<input name="address" maxlength="200" value="${escapeHtml(adminData.school.address || '')}"></label>
  `, 'Ruaj shkollën', form => updateAdminSchool(adminData.school.id, { name: form.get('name').trim(), address: form.get('address').trim() || null }));
}

function openSubjectDialog() {
  openAdminDialog('Shto lëndë', `
    <label>Emri i lëndës<input name="name" required maxlength="100" placeholder="p.sh. Gjuhë gjermane"></label>
    <p class="admin-form-note">Nëse lënda ekziston në katalog, ajo vetëm do të aktivizohet për këtë shkollë.</p>
  `, 'Shto lëndën', form => addSchoolSubject(adminData.profile.school_id, form.get('name')));
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
  openAdminDialog(period ? 'Ndrysho periudhën' : 'Shto periudhë', `
    <label>Emri<input name="name" required maxlength="80" value="${escapeHtml(period?.name || '')}" placeholder="p.sh. Gjysmëvjetori II"></label>
    <label>Viti shkollor<input name="schoolYear" required maxlength="20" value="${escapeHtml(schoolYear)}" placeholder="2026/2027"></label>
    <label>Fillon më<input name="startsOn" type="date" required value="${startsOn}"></label>
    <label>Përfundon më<input name="endsOn" type="date" required value="${endsOn}"></label>
    <label>Statusi<select name="status"><option value="planned"${selected(period?.status || 'planned', 'planned')}>E planifikuar</option><option value="active"${selected(period?.status, 'active')}>Aktive</option>${period?.status === 'closed' ? '<option value="closed" selected>E mbyllur</option>' : ''}</select></label>
    <p class="admin-form-note">Aktivizimi i kësaj periudhe mbyll automatikisht periudhën aktuale.</p>
  `, period ? 'Ruaj periudhën' : 'Shto periudhën', form => saveAcademicPeriod({
    id: period?.id,
    schoolId: adminData.profile.school_id,
    name: form.get('name'),
    schoolYear: form.get('schoolYear'),
    startsOn: form.get('startsOn'),
    endsOn: form.get('endsOn'),
    status: form.get('status')
  }));
}

async function handleAdminAction(action, id, target) {
  if (action === 'add-student') return openStudentDialog();
  if (action === 'edit-student') return openStudentDialog(adminData.students.find(item => item.id === id));
  if (action === 'add-class') return openClassDialog();
  if (action === 'edit-class') return openClassDialog(adminData.classes.find(item => item.id === id));
  if (action === 'invite-teacher') return openInviteDialog('teacher');
  if (action === 'invite-parent') return openInviteDialog('parent');
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
      const assignments = adminData.teacherSubjects.filter(item => item.subject_id === id).length;
      if (!target.checked && assignments && !window.confirm(`Kjo lëndë ka ${assignments} caktime me mësimdhënës. Çaktivizimi do ta fshehë për punën e re, por historiku ruhet. Vazhdoni?`)) {
        target.checked = true;
        return;
      }
      await setSchoolSubject(adminData.profile.school_id, id, target.checked);
    } else if (action === 'activate-period' || action === 'close-period') {
      const period = adminData.academicPeriods.find(item => item.id === id);
      const status = action === 'activate-period' ? 'active' : 'closed';
      if (status === 'active' && !window.confirm('Aktivizimi i kësaj periudhe do të mbyllë periudhën aktuale. Vazhdoni?')) return;
      if (status === 'closed' && !window.confirm('Pas mbylljes, kjo periudhë dhe vlerësimet e saj nuk mund të ndryshohen. Vazhdoni?')) return;
      await saveAcademicPeriod({ id: period.id, schoolId: period.school_id, name: period.name, schoolYear: period.school_year, startsOn: period.starts_on, endsOn: period.ends_on, status });
    } else if (action === 'remove-relation') {
      const config = relationConfig[target.dataset.type];
      await removeAdminRelation(config.table, { [config.left]: target.dataset.left, [config.right]: target.dataset.right });
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
  const config = relationConfig[type];
  const data = new FormData(form);
  await addAdminRelation(config.table, { [config.left]: data.get('left'), [config.right]: data.get('right') });
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
    byId('adminPasswordToggle').setAttribute('aria-label', visible ? 'Shfaq fjalëkalimin' : 'Fshih fjalëkalimin');
  };
  byId('continueAdmin').onclick = async () => {
    const email = byId('adminEmail').value.trim();
    const password = byId('adminPassword').value;
    const status = byId('adminLoginStatus');
    if (!email || !password) { status.textContent = 'Shkruani email-in dhe fjalëkalimin.'; return; }
    status.textContent = 'Duke u kyçur…';
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { status.textContent = `Hyrja dështoi: ${error.message}`; return; }
    try {
      adminData = await fetchAdminDashboardData(data.user.id);
      status.textContent = '';
      byId('adminLogin').classList.add('hidden');
      byId('adminApp').classList.remove('hidden');
      renderAdmin();
    } catch (loadError) {
      await supabaseClient.auth.signOut();
      status.textContent = 'Kjo llogari nuk është e autorizuar si administrator i shkollës.';
      console.warn('Admin login:', loadError);
    }
  };
  byId('adminLogout').onclick = async () => {
    await supabaseClient.auth.signOut();
    adminData = null;
    byId('adminApp').classList.add('hidden');
    byId('roleGate').classList.remove('hidden');
  };
  byId('adminDialogCancel').onclick = () => byId('adminDialog').close();
  byId('adminDialogCancelSecondary').onclick = () => byId('adminDialog').close();
  byId('adminApp').addEventListener('click', event => {
    const nav = event.target.closest('[data-admin-nav],[data-open-view]');
    if (nav) { showAdminView(nav.dataset.adminNav || nav.dataset.openView); return; }
    const action = event.target.closest('[data-action]');
    if (action) handleAdminAction(action.dataset.action, action.dataset.id, action);
  });
  byId('adminApp').addEventListener('submit', event => {
    const relationForm = event.target.closest('[data-relation-form]');
    if (!relationForm) return;
    event.preventDefault();
    submitRelation(relationForm).catch(error => showAdminStatus(friendlyError(error), 'error'));
  });
  supabaseClient.auth.getSession().then(async ({ data }) => {
    if (!data.session) return;
    try {
      adminData = await fetchAdminDashboardData(data.session.user.id);
      byId('roleGate').classList.add('hidden');
      byId('adminLogin').classList.add('hidden');
      byId('adminApp').classList.remove('hidden');
      renderAdmin();
    } catch {
      // A valid teacher or parent session is handled by its own role entry.
    }
  });
}
