import {
  createMaterialDownloadUrl,
  deleteTeacherMaterial,
  fetchTeacherMaterials,
  markRetentionWarningRead,
  prepareMaterialFiles,
  publishTeacherMaterial
} from '../services/teacherMaterialService.js';
import {
  archiveTeacherThread,
  deleteTeacherNotification,
  createTeacherChapter,
  markTeacherNotificationRead,
  markTeacherNotificationUnread,
  markTeacherThreadRead,
  markTeacherThreadUnread,
  requestTeacherSupport,
  saveChapterAssessment,
  saveStaffMoodLog,
  saveTeacherFinalGrade,
  saveTeacherNotificationPreferences,
  sendTeacherThreadMessage
} from '../services/teacherService.js';
import { formatSqDate, todayIso } from '../utils/dates.js';

const titles = {
  students: ['Regjistri i klasave', 'Nxënësit'],
  materials: ['Përmbajtja mësimore', 'Materialet'],
  notifications: ['Komunikimi me familjet', 'Njoftimet'],
  support: ['Ndihmë pedagogjike', 'Mbështetja AI'],
  settings: ['Llogaria dhe preferencat', 'Cilësimet']
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'NX';
}

const staffMoodOptions = [
  '😊 I qetë / mirë',
  '🥱 I lodhur',
  '⚡ Shqetësuar / energji e lartë',
  '😄 I gëzuar',
  '😟 Mërzitur / pa humor',
  '🎯 I fokusuar',
  '🌪️ I shpërqendruar',
  '🤝 Bashkëpunues'
];

const staffMoodContexts = [
  'Në fillim të orës',
  'Gjatë orës',
  'Pas pushimit',
  'Punë individuale',
  'Punë në grup',
  'Fund dite'
];

export function initializeTeacherPrototype({ onLogout } = {}) {
  const root = document.getElementById('teacherPrototype');
  if (!root) return { setData() {} };

  let students = [];
  let selectedStudent = null;
  let moodHistories = {};
  let staffMoodLogs = {};
  let messages = [];
  let unreadOnly = false;
  let activeMessageId = null;
  let materialContext = { teacherId: null, schoolId: null, subjects: [], teacherSubjects: [], classAssignments: [], studentAssignments: [] };
  let teacherMaterials = [];
  let materialWarnings = [];
  let academicPeriods = [];
  let selectedAcademicPeriodId = null;
  let selectedAssessmentSubjectId = null;
  let assessmentContext = { chapters: [], assessments: [], finalGrades: [] };
  let piaContext = { objectives: [], updates: [] };
  let notificationPreferences = null;
  let supportOwnerId = null;
  let supportStudentId = null;
  let supportSessions = Object.create(null);
  let selectedClassFilter = 'all';
  let detailBackAction = () => openFolder(selectedStudent);

  const panels = [...root.querySelectorAll('[data-teacher-panel]')];
  const navButtons = [...root.querySelectorAll('[data-teacher-view]')];
  const title = document.getElementById('teacherViewTitle');
  const kicker = document.getElementById('teacherViewKicker');

  function showPanel(name, updateNavigation = true) {
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.teacherPanel === name));
    if (updateNavigation) {
      navButtons.forEach(button => button.classList.toggle('active', button.dataset.teacherView === name));
    }
    if (titles[name]) {
      kicker.textContent = titles[name][0];
      title.textContent = titles[name][1];
    }
    if (name === 'support') renderSupportPanel();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navButtons.forEach(button => button.addEventListener('click', () => showPanel(button.dataset.teacherView)));
  root.querySelector('[data-open-teacher-notifications]').addEventListener('click', () => showPanel('notifications'));

  function studentMood(student) {
    return student.mood || 'Pa gjendje të raportuar sot';
  }

  function availableClassFilters() {
    return [...new Map(
      materialContext.classAssignments
        .map(assignment => {
          const className = assignment.classes?.name || students.find(student => student.class_id === assignment.class_id)?.className || '';
          return className ? [assignment.class_id, { id: assignment.class_id, name: className }] : null;
        })
        .filter(Boolean)
    ).values()].sort((left, right) => left.name.localeCompare(right.name, 'sq'));
  }

  function studentSubjects(student) {
    if (!student) return [];
    const directIds = new Set(materialContext.studentAssignments || []);
    const classSubjects = materialContext.classAssignments
      .filter(assignment => assignment.class_id === student.class_id)
      .map(assignment => assignment.subjects || { id: assignment.subject_id, name: 'Lenda' });
    const directSubjects = directIds.has(student.id)
      ? materialContext.teacherSubjects.map(item => item.subjects || { id: item.subject_id, name: 'Lenda' })
      : [];
    return [...new Map([...classSubjects, ...directSubjects].map(subject => [subject.id, subject])).values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'sq'));
  }

  function renderStudentClassFilter() {
    const select = document.getElementById('teacherStudentClassFilter');
    if (!select) return;
    const classes = availableClassFilters();
    if (selectedClassFilter !== 'all' && !classes.some(item => item.id === selectedClassFilter)) {
      selectedClassFilter = 'all';
    }
    select.innerHTML = [`<option value="all">Të gjitha klasat</option>`, ...classes.map(item => `<option value="${escapeHtml(item.id)}"${item.id === selectedClassFilter ? ' selected' : ''}>Klasa ${escapeHtml(item.name)}</option>`)].join('');
    select.disabled = classes.length === 0;
  }

  function studentsForFilters(query = '', classId = selectedClassFilter) {
    const normalized = query.trim().toLocaleLowerCase('sq');
    return students.filter(student => {
      const matchesQuery = student.name.toLocaleLowerCase('sq').includes(normalized);
      const matchesClass = classId === 'all' || student.class_id === classId;
      return matchesQuery && matchesClass;
    });
  }

  function renderStudents(query = '') {
    const box = document.getElementById('teacherClassGroups');
    const filtered = studentsForFilters(query);
    const groups = filtered.reduce((result, student) => {
      const className = student.className || 'Pa klasë';
      (result[className] ||= []).push(student);
      return result;
    }, {});
    document.getElementById('teacherPrototypeStudentTotal').textContent = `${filtered.length} nxënës`;
    box.innerHTML = '';
    if (!filtered.length) {
      box.innerHTML = '<p class="teacher-empty-students">Nuk u gjet asnjë nxënës me këtë filter.</p>';
      return;
    }
    Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'sq')).forEach(([className, classStudents]) => {
      const group = document.createElement('section');
      group.className = 'teacher-class-group';
      group.innerHTML = `<button type="button" aria-expanded="true"><span class="teacher-class-chevron">⌄</span><strong>Klasa ${escapeHtml(className)}</strong><small>${classStudents.length} nxënës</small></button><div class="teacher-class-students"></div>`;
      const toggle = group.querySelector(':scope > button');
      toggle.addEventListener('click', () => {
        group.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!group.classList.contains('collapsed')));
      });
      const list = group.querySelector('.teacher-class-students');
      classStudents.forEach(student => {
        const row = document.createElement('article');
        row.className = 'teacher-student-row';
        row.innerHTML = `<span>${initials(student.name)}</span><div><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.supportSummary || 'Pa përshtatje të shënuara')}</small></div><p class="teacher-student-mood">${escapeHtml(studentMood(student))}</p><button type="button">Hap</button>`;
        row.querySelector('button').addEventListener('click', () => openFolder(student));
        list.appendChild(row);
      });
      box.appendChild(group);
    });
  }

  function openFolder(student) {
    selectedStudent = student;
    document.getElementById('teacherFolderAvatar').textContent = initials(student.name);
    document.getElementById('teacherFolderName').textContent = student.name;
    const subjectNames = studentSubjects(student).map(subject => subject.name).join(', ');
    document.getElementById('teacherFolderMeta').textContent = `Klasa ${student.className || 'Pa klasë'}${subjectNames ? ` · ${subjectNames}` : ''}`;
    title.textContent = 'Dosja e nxënësit';
    kicker.textContent = student.name;
    showPanel('student-folder', false);
  }

  const detailBackButton = document.getElementById('teacherDetailBack');

  function setDetailBack(label, action) {
    detailBackButton.querySelector('span').textContent = label;
    detailBackAction = action;
  }

  document.getElementById('teacherStudentSearch').addEventListener('input', event => renderStudents(event.target.value));
  document.getElementById('teacherStudentClassFilter')?.addEventListener('change', event => {
    selectedClassFilter = event.currentTarget.value || 'all';
    renderStudents(document.getElementById('teacherStudentSearch').value);
  });
  document.getElementById('teacherFolderBack').addEventListener('click', () => showPanel('students'));
  detailBackButton.addEventListener('click', () => detailBackAction());

  function detailHeading(titleText, description) {
    return `<div class="teacher-detail-heading"><h2>${escapeHtml(titleText)}</h2><p>${escapeHtml(description)}</p></div>`;
  }

  function renderMoodDetail() {
    const heading = detailHeading('Humori ditor dhe historiku', `Njoftimet për ${selectedStudent.name} nga prindi.`);
    const history = (moodHistories[selectedStudent.id] || []).filter(item => item.reported_on !== todayIso());
    const staffLogs = staffMoodLogs[selectedStudent.id] || [];
    const current = selectedStudent.mood
      ? `<article class="teacher-current-mood"><small>Sot</small><strong>${escapeHtml(selectedStudent.mood)}</strong><p>${escapeHtml(selectedStudent.moodComment || 'Pa koment shtesë.')}</p></article>`
      : '<div class="teacher-detail-empty"><strong>Pa gjendje të raportuar sot</strong><p>Prindi nuk ka dërguar ende një përditësim për ditën e sotme.</p></div>';
    const previous = history.length
      ? `<div class="teacher-history-list">${history.map(item => `<article><time>${escapeHtml(formatSqDate(item.reported_on))}</time><strong>${escapeHtml(item.mood)}</strong><p>${escapeHtml(item.parent_comment || 'Pa koment shtesë.')}</p></article>`).join('')}</div>`
      : '<div class="teacher-detail-empty"><strong>Nuk ka hyrje të mëparshme</strong><p>Historiku është bosh.</p></div>';
    return `${heading}<div class="teacher-mood-summary">${current}${previous}</div>${renderStaffMoodLogPanel(staffLogs, 'teacher')}`;
  }

  function staffReporterLabel(log) {
    const profile = log.profiles || {};
    const name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
    const role = log.reporter_role === 'assistant' ? 'Asistenti' : 'Mësimdhënësi';
    return name ? `${role} · ${name}` : role;
  }

  function renderStaffMoodLogPanel(logs, reporterRole) {
    const formTitle = reporterRole === 'assistant' ? 'Shto vëzhgim nga asistenti' : 'Shto vëzhgim nga mësimdhënësi';
    const list = logs.length
      ? logs.slice(0, 8).map(log => `<article>
          <div>
            <strong>${escapeHtml(log.mood)}</strong>
            <small>${escapeHtml(staffReporterLabel(log))} · ${escapeHtml(formatSqDate(log.created_at || log.reported_on, { includeTime: true }))}${log.context ? ` · ${escapeHtml(log.context)}` : ''}</small>
          </div>
          <p>${escapeHtml(log.comment || 'Pa koment shtesë.')}</p>
        </article>`).join('')
      : '<div class="teacher-detail-empty"><strong>Pa log nga stafi</strong><p>Mund të shtoni vëzhgim edhe nëse prindi nuk ka raportuar sot.</p></div>';
    return `<section class="staff-mood-log-panel">
      <form class="staff-mood-log-form" id="teacherStaffMoodLogForm">
        <div class="staff-mood-log-head">
          <span>📝</span>
          <div>
            <h3>${escapeHtml(formTitle)}</h3>
            <p>Regjistro një vëzhgim të shkurtër për disponimin gjatë ditës.</p>
          </div>
        </div>
        <div class="teacher-form-grid">
          <label>Humori / gjendja
            <select name="mood" required>${staffMoodOptions.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>
          </label>
          <label>Konteksti
            <select name="context">${staffMoodContexts.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>
          </label>
        </div>
        <label>Komenti
          <textarea name="comment" rows="4" maxlength="1200" placeholder="p.sh. Gjatë leximit u lodh shpejt, por u qetësua kur iu dha pushim i shkurtër vizual."></textarea>
        </label>
        <p class="teacher-assessment-status" aria-live="polite"></p>
        <div class="teacher-form-actions">
          <button class="teacher-primary-button" type="submit">Ruaj logun</button>
        </div>
      </form>
      <div class="staff-mood-log-list">
        <h3>Log-et nga stafi</h3>
        ${list}
      </div>
    </section>`;
  }

  function bindStaffMoodLogForm(reporterRole = 'teacher') {
    const form = document.getElementById('teacherStaffMoodLogForm');
    if (!form || !selectedStudent) return;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const status = form.querySelector('.teacher-assessment-status');
      const submit = form.querySelector('[type="submit"]');
      const formData = new FormData(form);
      submit.disabled = true;
      status.textContent = 'Duke ruajtur logun...';
      try {
        const saved = await saveStaffMoodLog({
          studentId: selectedStudent.id,
          mood: formData.get('mood'),
          context: formData.get('context'),
          comment: formData.get('comment'),
          reporterRole
        });
        staffMoodLogs[selectedStudent.id] = [saved, ...(staffMoodLogs[selectedStudent.id] || [])];
        const detail = document.getElementById('teacherFolderDetail');
        detail.innerHTML = renderMoodDetail();
        bindStaffMoodLogForm(reporterRole);
      } catch (error) {
        status.textContent = error.message || 'Logu nuk u ruajt. Kontrolloni lidhjen me databazën.';
      } finally {
        submit.disabled = false;
      }
    });
  }

  function renderPreferencesDetail() {
    const heading = detailHeading('Preferencat dhe komunikimi', 'Të dhënat e konfirmuara për mbështetjen e nxënësit.');
    const hasProfile = selectedStudent.supportSummary || selectedStudent.accessibilityInformation || selectedStudent.preferredMode || selectedStudent.learningPreferences?.length || selectedStudent.communicationLanguage || selectedStudent.communicationMethod || selectedStudent.additionalNotes;
    if (!hasProfile) return `${heading}<div class="teacher-detail-empty"><strong>Pa preferenca të raportuara</strong><p>Ky seksion do të plotësohet pasi familja të japë informacionin përkatës.</p></div>`;
    return `${heading}<div class="teacher-preference-grid">${selectedStudent.learningPreferences?.length ? `<article><span>Preferencat e të nxënit</span><p>${escapeHtml(selectedStudent.learningPreferences.join(', '))}</p></article>` : ''}${selectedStudent.communicationLanguage ? `<article><span>Gjuha e komunikimit</span><p>${escapeHtml(selectedStudent.communicationLanguage)}</p></article>` : ''}${selectedStudent.communicationMethod ? `<article><span>Mënyra e komunikimit</span><p>${escapeHtml(selectedStudent.communicationMethod)}</p></article>` : ''}${selectedStudent.supportSummary ? `<article><span>Përmbledhja</span><p>${escapeHtml(selectedStudent.supportSummary)}</p></article>` : ''}${selectedStudent.preferredMode ? `<article><span>Mënyra e preferuar</span><p>${escapeHtml(selectedStudent.preferredMode)}</p></article>` : ''}${selectedStudent.accessibilityInformation ? `<article><span>Qasshmëria</span><p>${escapeHtml(selectedStudent.accessibilityInformation)}</p></article>` : ''}${selectedStudent.additionalNotes ? `<article><span>Shënime shtesë</span><p>${escapeHtml(selectedStudent.additionalNotes)}</p></article>` : ''}</div>`;
  }

  function piaRatingLabel(rating) {
    return {
      1: 'Sapofilluar',
      2: 'Në zhvillim',
      3: 'Po avancon',
      4: 'Shumë afër',
      5: 'I arritur'
    }[Number(rating)] || 'Pa status';
  }

  function piaObjectivesForStudent(studentId) {
    return piaContext.objectives
      .filter(item => item.student_id === studentId)
      .sort((left, right) => {
        if (left.active !== right.active) return Number(right.active) - Number(left.active);
        return new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at);
      });
  }

  function piaUpdatesForObjective(objectiveId) {
    return piaContext.updates
      .filter(item => item.objective_id === objectiveId)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  }

  function latestPiaUpdateForStudent(studentId) {
    return piaContext.updates
      .filter(item => item.student_id === studentId)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))[0] || null;
  }

  function renderPiaDetail() {
    const objectives = piaObjectivesForStudent(selectedStudent.id);
    const latest = latestPiaUpdateForStudent(selectedStudent.id);
    const heading = detailHeading('PIA dhe mbështetja e asistentit', 'Pamje vetëm për lexim e objektivave dhe përditësimeve nga asistenti.');
    if (!objectives.length) {
      return `${heading}<div class="teacher-detail-empty"><strong>Pa objektiva PIA</strong><p>Asistenti nuk ka ruajtur ende objektiva ose përditësime për këtë nxënës.</p></div>`;
    }
    return `${heading}
      <div class="teacher-pia-overview">
        <article><span>Objektiva aktive</span><strong>${objectives.filter(item => item.active).length}</strong></article>
        <article><span>Përditësimi i fundit</span><strong>${escapeHtml(latest ? formatSqDate(latest.created_at, { includeTime: true }) : 'Pa raportim')}</strong></article>
      </div>
      <div class="teacher-pia-list">
        ${objectives.map(objective => {
          const updates = piaUpdatesForObjective(objective.id);
          const objectiveLatest = updates[0];
          return `<article class="teacher-pia-card">
            <div class="teacher-pia-card-head">
              <div>
                <span class="teacher-pia-badge${objective.active ? '' : ' muted'}">${objective.active ? 'Objektiv aktiv' : 'Objektiv i mbyllur'}</span>
                <h3>${escapeHtml(objective.title)}</h3>
                <p>${escapeHtml(objective.details || 'Pa përshkrim shtesë.')}</p>
              </div>
              <strong>${objectiveLatest ? `${objectiveLatest.rating}/5` : '--'}</strong>
            </div>
            <div class="teacher-pia-meta">
              <article><span>Asistenti</span><p>${escapeHtml(objective.assistantName || objectiveLatest?.assistantName || 'Asistenti')}</p></article>
              <article><span>Statusi i fundit</span><p>${escapeHtml(objectiveLatest ? piaRatingLabel(objectiveLatest.rating) : 'Pa status ende')}</p></article>
              <article><span>Përditësuar</span><p>${escapeHtml(formatSqDate(objective.updated_at || objective.created_at, { includeTime: true }))}</p></article>
            </div>
            ${objectiveLatest ? `<div class="teacher-pia-latest"><span>Komenti i fundit</span><p>${escapeHtml(objectiveLatest.comment || 'Pa koment shtesë.')}</p></div>` : '<div class="teacher-detail-empty"><strong>Pa koment ende</strong><p>Objektivi është ruajtur, por nuk ka ende një përditësim me koment.</p></div>'}
          </article>`;
        }).join('')}
      </div>`;
  }

  const supportQuickPrompts = [
    'Nxënësi është i shqetësuar dhe nuk po pranon të qetësohet.',
    'Nxënësi po refuzon detyrën dhe po shpërqendron klasën.',
    'Më jep 3 hapa të sigurt për një situatë të tensionuar në klasë.',
    'Si ta mbështes komunikimin pa e turpëruar nxënësin?'
  ];

  function supportKey(student) {
    return student?.id || 'general';
  }

  function currentSupportStudent() {
    return students.find(student => student.id === supportStudentId) || selectedStudent || students[0] || null;
  }

  function getSupportSession(student = currentSupportStudent()) {
    const key = supportKey(student);
    if (!supportSessions[key]) {
      supportSessions[key] = { messages: [], draft: '', pending: false, error: '' };
    }
    return supportSessions[key];
  }

  function supportStudentSummary(student) {
    if (!student) return null;
    const latestPia = latestPiaUpdateForStudent(student.id);
    const activeObjectives = piaObjectivesForStudent(student.id)
      .filter(item => item.active)
      .slice(0, 3)
      .map(item => ({
        title: item.title,
        status: piaRatingLabel(piaUpdatesForObjective(item.id)[0]?.rating),
        latestComment: piaUpdatesForObjective(item.id)[0]?.comment || ''
      }));
    return {
      className: student.className ? `Klasa ${student.className}` : '',
      supportSummary: student.supportSummary || '',
      communication: [student.communicationMethod, student.communicationLanguage].filter(Boolean).join(' · '),
      preferences: student.learningPreferences?.length ? student.learningPreferences.join(', ') : '',
      accommodations: student.preferredMode || student.accessibilityInformation || '',
      notes: student.additionalNotes || '',
      pia: {
        objectiveCount: piaObjectivesForStudent(student.id).length,
        latestLabel: latestPia ? `${latestPia.rating}/5 · ${piaRatingLabel(latestPia.rating)}` : '',
        objectives: activeObjectives
      }
    };
  }

  function renderSupportContext(summary) {
    if (!summary) {
      return '<div class="teacher-support-context-empty">Zgjidhni një nxënës për ta personalizuar këshillën.</div>';
    }
    const objectiveText = summary.pia.objectives.length
      ? `<ul>${summary.pia.objectives.map(item => `<li><strong>${escapeHtml(item.title)}</strong>${item.status ? ` · ${escapeHtml(item.status)}` : ''}${item.latestComment ? ` · ${escapeHtml(item.latestComment)}` : ''}</li>`).join('')}</ul>`
      : '<p>Pa objektiva aktive të ruajtura.</p>';
    return `<article class="teacher-support-context-card">
      <div class="teacher-support-context-head">
        <div>
          <span>Konteksti</span>
          <strong>${escapeHtml(summary.className || 'Nxënësi i zgjedhur')}</strong>
        </div>
        ${summary.pia.objectiveCount ? `<small>${summary.pia.objectiveCount} objektiva PIA</small>` : ''}
      </div>
      <div class="teacher-support-context-grid">
        ${summary.supportSummary ? `<section><span>Përmbledhja</span><p>${escapeHtml(summary.supportSummary)}</p></section>` : ''}
        ${summary.communication ? `<section><span>Komunikimi</span><p>${escapeHtml(summary.communication)}</p></section>` : ''}
        ${summary.preferences ? `<section><span>Preferencat</span><p>${escapeHtml(summary.preferences)}</p></section>` : ''}
        ${summary.accommodations ? `<section><span>Mbështetja praktike</span><p>${escapeHtml(summary.accommodations)}</p></section>` : ''}
        ${summary.notes ? `<section><span>Shënime</span><p>${escapeHtml(summary.notes)}</p></section>` : ''}
        <section><span>PIA</span>${objectiveText}${summary.pia.latestLabel ? `<p class="teacher-support-context-meta">Raportimi i fundit: ${escapeHtml(summary.pia.latestLabel)}</p>` : ''}</section>
      </div>
    </article>`;
  }

  function buildSupportRequestContext(student) {
    if (!student) return null;
    return {
      className: student.className || '',
      supportSummary: student.supportSummary || '',
      preferredMode: student.preferredMode || '',
      communicationMethod: [student.communicationMethod, student.communicationLanguage].filter(Boolean).join(' · '),
      learningPreferences: Array.isArray(student.learningPreferences) ? student.learningPreferences.slice(0, 3) : [],
      accessibilityInformation: student.accessibilityInformation || '',
      additionalNotes: student.additionalNotes || '',
      pia: {
        objectives: piaObjectivesForStudent(student.id)
          .slice(0, 3)
          .map(objective => {
            const latest = piaUpdatesForObjective(objective.id)[0];
            return {
              title: objective.title,
              status: latest ? piaRatingLabel(latest.rating) : (objective.active ? 'Aktiv' : 'I mbyllur'),
              latestComment: latest?.comment || ''
            };
          })
      }
    };
  }

  function renderSupportMessage(message) {
    if (message.role === 'assistant') {
      const actions = Array.isArray(message.data?.actions) ? message.data.actions : [];
      return `<article class="teacher-support-message assistant"><div class="teacher-support-bubble">
        <p>${escapeHtml(message.data?.answer || message.content || '')}</p>
        ${actions.length ? `<div class="teacher-support-inline-block"><strong>Hapat e sugjeruar</strong><ul>${actions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
        ${message.data?.observationCue ? `<div class="teacher-support-inline-block"><strong>Çfarë të vëzhgoni</strong><p>${escapeHtml(message.data.observationCue)}</p></div>` : ''}
        ${message.data?.escalation ? `<div class="teacher-support-inline-block danger"><strong>Kur të eskaloni</strong><p>${escapeHtml(message.data.escalation)}</p></div>` : ''}
      </div></article>`;
    }
    return `<article class="teacher-support-message user"><div class="teacher-support-bubble"><p>${escapeHtml(message.content || '')}</p></div></article>`;
  }

  function renderSupportPanel() {
    const student = currentSupportStudent();
    const session = getSupportSession(student);
    const select = document.getElementById('teacherSupportStudentSelect');
    const cards = document.getElementById('teacherSupportContextCards');
    const chat = document.getElementById('teacherSupportChat');
    const input = document.getElementById('teacherSupportInput');
    const status = document.getElementById('teacherSupportStatus');
    const submit = document.getElementById('teacherSupportSubmit');
    const quick = document.getElementById('teacherSupportQuick');
    if (select) {
      select.innerHTML = students.map(item => `<option value="${escapeHtml(item.id)}"${item.id === student?.id ? ' selected' : ''}>${escapeHtml(item.name)}${item.className ? ` · ${escapeHtml(item.className)}` : ''}</option>`).join('');
    }
    if (cards) {
      cards.innerHTML = renderSupportContext(supportStudentSummary(student));
    }
    if (chat) {
      chat.innerHTML = session.messages.length
        ? session.messages.map(renderSupportMessage).join('')
        : '<div class="teacher-support-empty"><strong>Filloni me një situatë të shkurtër</strong><p>Do të merrni një përgjigje të vetme, të qartë dhe të përshtatur me kontekstin e nxënësit.</p></div>';
      chat.scrollTop = chat.scrollHeight;
    }
    if (input) {
      if (document.activeElement !== input) input.value = session.draft || '';
      input.disabled = session.pending;
    }
    if (status) {
      status.textContent = session.error || (session.pending ? 'Duke menduar…' : '');
    }
    if (submit) {
      submit.disabled = session.pending || !(session.draft || '').trim();
    }
    if (quick) {
      quick.innerHTML = supportQuickPrompts.map(prompt => `<button type="button">${escapeHtml(prompt)}</button>`).join('');
      quick.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        const targetInput = document.getElementById('teacherSupportInput');
        const activeStudent = currentSupportStudent();
        const activeSession = getSupportSession(activeStudent);
        activeSession.draft = button.textContent;
        if (targetInput) targetInput.value = button.textContent;
        renderSupportPanel();
        targetInput?.focus();
      }));
    }
  }

  async function submitSupportMessage(event) {
    event.preventDefault();
    const student = currentSupportStudent();
    const session = getSupportSession(student);
    if (session.pending) return;
    const input = document.getElementById('teacherSupportInput');
    const message = (session.draft || input?.value || '').trim();
    if (!message) return;
    session.error = '';
    session.pending = true;
    session.draft = message;
    session.messages.push({ role: 'user', content: message });
    renderSupportPanel();
    try {
      const priorHistory = session.messages.slice(0, -1).slice(-8);
      const response = await requestTeacherSupport({
        message,
        history: priorHistory.map(item => ({
          role: item.role,
          content: item.role === 'assistant' ? (item.data?.answer || item.content || '') : item.content
        })),
        studentContext: buildSupportRequestContext(student)
      });
      if (response.meta?.source && response.meta.source !== 'gemini') {
        console.warn('Teacher support fallback used:', response.meta.reason || 'UNKNOWN_REASON');
      }
      session.messages.push({
        role: 'assistant',
        content: response.answer || '',
        data: {
          answer: response.answer || '',
          actions: Array.isArray(response.actions) ? response.actions.slice(0, 3) : [],
          observationCue: response.observationCue || '',
          escalation: response.escalation || '',
          meta: response.meta || null
        }
      });
      session.draft = '';
    } catch (error) {
      session.error = error.message || 'Mbështetja AI nuk u përgjigj.';
    } finally {
      session.pending = false;
      renderSupportPanel();
    }
  }

  function formatInboxTime(value) {
    return formatSqDate(value, { includeTime: true });
  }

  function inboxCounterpartLabel(message) {
    return message.parent || (message.counterpartRole === 'Asistenti' ? 'Asistenti' : 'Prindi');
  }

  function inboxSenderLabel(message, threadMessage) {
    if (threadMessage.sender_id === materialContext.teacherId) return 'Ju';
    if (message.counterpartRole === 'Asistenti') return 'Asistenti';
    return 'Prindi';
  }

  function proficiencyOptions(value) {
    const levels = [['', 'Pa vlerësuar'], ['1', '1 · Fillestar'], ['2', '2 · Në zhvillim'], ['3', '3 · Pjesërisht i qëndrueshëm'], ['4', '4 · I qëndrueshëm'], ['5', '5 · Zotërim i avancuar']];
    const normalized = String(value ?? '');
    const custom = normalized && !levels.some(([score]) => score === normalized) ? `<option value="${escapeHtml(normalized)}" selected>${escapeHtml(normalized)} · Vlerësim ekzistues</option>` : '';
    return custom + levels.map(([score, label]) => `<option value="${score}"${score === normalized ? ' selected' : ''}${score === '' ? ' disabled' : ''}>${label}</option>`).join('');
  }

  function renderAssessmentDetail() {
    setDetailBack('Dosja e nxënësit', () => openFolder(selectedStudent));
    const subjects = studentSubjects(selectedStudent);
    if (!selectedAssessmentSubjectId || !subjects.some(subject => subject.id === selectedAssessmentSubjectId)) selectedAssessmentSubjectId = subjects[0]?.id || null;
    const chapters = assessmentContext.chapters.filter(chapter => chapter.subject_id === selectedAssessmentSubjectId);
    const studentPeriods = academicPeriods.filter(period => !selectedStudent.schoolYear || period.school_year === selectedStudent.schoolYear);
    if (!studentPeriods.some(period => period.id === selectedAcademicPeriodId)) {
      selectedAcademicPeriodId = studentPeriods.find(period => period.status === 'active')?.id || studentPeriods[0]?.id || null;
    }
    const selectedPeriod = studentPeriods.find(period => period.id === selectedAcademicPeriodId);
    const editable = selectedPeriod?.status === 'active';
    const currentAssessments = assessmentContext.assessments.filter(item => item.student_id === selectedStudent.id && item.subject_id === selectedAssessmentSubjectId && item.academic_period_id === selectedAcademicPeriodId);
    const assessmentByChapter = Object.fromEntries(currentAssessments.map(item => [item.chapter_id, item]));
    const assessedCount = chapters.filter(chapter => assessmentByChapter[chapter.id]).length;
    const complete = chapters.length > 0 && assessedCount === chapters.length;
    const finalGrade = assessmentContext.finalGrades.find(item => item.student_id === selectedStudent.id && item.subject_id === selectedAssessmentSubjectId && item.academic_period_id === selectedAcademicPeriodId);
    const subjectOptions = subjects.map(subject => `<option value="${escapeHtml(subject.id)}"${subject.id === selectedAssessmentSubjectId ? ' selected' : ''}>${escapeHtml(subject.name)}</option>`).join('');
    const periodOptions = studentPeriods.map(period => `<option value="${escapeHtml(period.id)}"${period.id === selectedAcademicPeriodId ? ' selected' : ''}>${escapeHtml(period.name)} · ${escapeHtml(period.school_year)}${period.status === 'closed' ? ' · E mbyllur' : period.status === 'planned' ? ' · E planifikuar' : ''}</option>`).join('');
    const box = document.getElementById('teacherFolderDetail');
    box.innerHTML = `${detailHeading('Vlerësimet', 'Njohuritë sipas kapitujve ruhen në periudhën e zgjedhur.')}<div class="teacher-assessment-toolbar"><label>Lënda<select id="teacherAssessmentSubject"${subjects.length ? '' : ' disabled'}>${subjectOptions || '<option>Pa lëndë të caktuar</option>'}</select></label><label>Periudha<select id="teacherAssessmentPeriod"${studentPeriods.length ? '' : ' disabled'}>${periodOptions || '<option>Pa periudhë akademike</option>'}</select></label><button class="teacher-primary-button" id="teacherAddChapter" type="button"${selectedAssessmentSubjectId ? '' : ' disabled'}>＋ Shto kapitull</button></div><p class="teacher-assessment-status" id="teacherAssessmentStatus" aria-live="polite"></p>${selectedPeriod && !editable ? '<p class="teacher-period-lock">Kjo periudhë nuk është aktive. Mund ta shikoni, por vlerësimet nuk mund të ndryshohen.</p>' : ''}<div class="teacher-chapter-list">${chapters.length ? chapters.map(chapter => { const assessment = assessmentByChapter[chapter.id]; const value = assessment ? String(Number(assessment.score)) : ''; return `<article class="teacher-chapter-row"><div><strong>${escapeHtml(chapter.name)}</strong><small>${assessment ? `Ruajtur më ${escapeHtml(formatSqDate(assessment.updated_at || assessment.graded_at))}` : 'Ende pa vlerësim'}</small></div><select data-chapter-id="${chapter.id}" aria-label="Vlerësimi për ${escapeHtml(chapter.name)}"${editable ? '' : ' disabled'}>${proficiencyOptions(value)}</select><button type="button" data-message-chapter-id="${chapter.id}"${editable && assessment ? '' : ' disabled'}>${assessment?.parent_message ? 'Ndrysho mesazhin' : '＋ Mesazh për prindin'}</button></article>`; }).join('') : '<p class="teacher-detail-empty">Nuk ka kapituj aktivë për këtë lëndë.</p>'}</div><div class="teacher-final-grade${complete ? '' : ' incomplete'}"><div><strong>Nota përfundimtare${finalGrade ? `: ${finalGrade.grade}` : ''}</strong><p>${!editable ? 'Nota mund të vendoset vetëm në periudhën aktive.' : `${assessedCount} nga ${chapters.length} kapituj janë vlerësuar.${complete ? '' : ' Mund të vazhdoni, por kontrolloni notën me kujdes.'}`}</p></div><button type="button"${editable && selectedAssessmentSubjectId ? '' : ' disabled'}>${editable && selectedAssessmentSubjectId ? (finalGrade ? 'Ndrysho notën' : 'Vendos notën') : 'Jo e disponueshme'}</button></div>`;
    document.getElementById('teacherAddChapter')?.addEventListener('click', openChapterForm);
    document.getElementById('teacherAssessmentSubject')?.addEventListener('change', event => {
      selectedAssessmentSubjectId = event.target.value;
      renderAssessmentDetail();
    });
    document.getElementById('teacherAssessmentPeriod')?.addEventListener('change', event => {
      selectedAcademicPeriodId = event.target.value;
      renderAssessmentDetail();
    });
    box.querySelectorAll('[data-chapter-id]').forEach(select => select.addEventListener('change', async () => {
      const status = document.getElementById('teacherAssessmentStatus');
      select.disabled = true;
      status.textContent = 'Duke ruajtur vlerësimin…';
      try {
        const existing = assessmentByChapter[select.dataset.chapterId];
        const saved = await saveChapterAssessment({ studentId: selectedStudent.id, subjectId: selectedAssessmentSubjectId, chapterId: select.dataset.chapterId, periodId: selectedAcademicPeriodId, score: select.value, parentMessage: existing?.parent_message || '' });
        assessmentContext.assessments = assessmentContext.assessments.filter(item => item.id !== saved.id && !(item.student_id === saved.student_id && item.chapter_id === saved.chapter_id && item.academic_period_id === saved.academic_period_id));
        assessmentContext.assessments.push(saved);
        renderAssessmentDetail();
        document.getElementById('teacherAssessmentStatus').textContent = 'Vlerësimi u ruajt.';
      } catch (error) {
        select.disabled = false;
        status.textContent = error.message || 'Vlerësimi nuk u ruajt.';
      }
    }));
    box.querySelectorAll('[data-message-chapter-id]').forEach(button => button.addEventListener('click', () => openParentMessage(button.dataset.messageChapterId)));
    const finalButton = box.querySelector('.teacher-final-grade button');
    if (!finalButton.disabled) finalButton.addEventListener('click', openFinalGrade);
  }

  function openChapterForm() {
    const box = document.getElementById('teacherFolderDetail');
    box.innerHTML = `${detailHeading('Shto kapitull', 'Kapitulli do të jetë i disponueshëm për vlerësimet e kësaj lënde.')}<form class="teacher-composer" id="teacherChapterForm"><label>Emri i kapitullit<input name="name" required maxlength="120" placeholder="p.sh. Thyesat"></label><p class="teacher-assessment-status" aria-live="polite"></p><div class="teacher-form-actions"><button type="button" id="cancelChapter">Anulo</button><button class="teacher-primary-button" type="submit">Ruaj kapitullin</button></div></form>`;
    document.getElementById('cancelChapter').addEventListener('click', renderAssessmentDetail);
    document.getElementById('teacherChapterForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector('.teacher-assessment-status');
      submit.disabled = true;
      try {
        const chapter = await createTeacherChapter(selectedAssessmentSubjectId, form.elements.name.value);
        assessmentContext.chapters.push(chapter);
        renderAssessmentDetail();
      } catch (error) {
        submit.disabled = false;
        status.textContent = error.message || 'Kapitulli nuk u ruajt.';
      }
    });
  }

  function openParentMessage(chapterId) {
    const chapter = assessmentContext.chapters.find(item => item.id === chapterId);
    const assessment = assessmentContext.assessments.find(item => item.student_id === selectedStudent.id && item.chapter_id === chapterId && item.academic_period_id === selectedAcademicPeriodId);
    const box = document.getElementById('teacherFolderDetail');
    box.innerHTML = `${detailHeading(`Mesazh për prindin · ${chapter?.name || 'Kapitulli'}`, 'Mesazhi ruhet bashkë me vlerësimin dhe shfaqet në profilin e prindit.')}<form class="teacher-composer" id="teacherParentMessageForm"><label>Mesazhi<textarea rows="5" maxlength="1200" placeholder="Përshkruani shkurt progresin dhe çfarë mund të ushtrohet në shtëpi.">${escapeHtml(assessment?.parent_message || '')}</textarea></label><p class="teacher-assessment-status" aria-live="polite"></p><div class="teacher-form-actions"><button type="button" id="cancelParentMessage">Anulo</button><button class="teacher-primary-button" type="submit">Ruaj mesazhin</button></div></form>`;
    document.getElementById('cancelParentMessage').addEventListener('click', renderAssessmentDetail);
    document.getElementById('teacherParentMessageForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector('.teacher-assessment-status');
      submit.disabled = true;
      try {
        const saved = await saveChapterAssessment({ studentId: selectedStudent.id, subjectId: selectedAssessmentSubjectId, chapterId, periodId: selectedAcademicPeriodId, score: assessment.score, parentMessage: form.querySelector('textarea').value });
        assessmentContext.assessments = assessmentContext.assessments.filter(item => item.id !== saved.id && !(item.student_id === saved.student_id && item.chapter_id === saved.chapter_id && item.academic_period_id === saved.academic_period_id));
        assessmentContext.assessments.push(saved);
        renderAssessmentDetail();
      } catch (error) {
        submit.disabled = false;
        status.textContent = error.message || 'Mesazhi nuk u ruajt.';
      }
    });
  }

  function openFinalGrade() {
    setDetailBack('Vlerësimet', renderAssessmentDetail);
    const period = academicPeriods.find(item => item.id === selectedAcademicPeriodId);
    const box = document.getElementById('teacherFolderDetail');
    const existing = assessmentContext.finalGrades.find(item => item.student_id === selectedStudent.id && item.subject_id === selectedAssessmentSubjectId && item.academic_period_id === selectedAcademicPeriodId);
    box.innerHTML = `${detailHeading('Nota përfundimtare', 'Kontrolloni notën para publikimit.')}<form class="teacher-composer" id="teacherFinalGradeForm"><div class="teacher-form-grid"><label>Nota<select name="grade">${[5,4,3,2,1].map(value => `<option value="${value}"${Number(existing?.grade || 5) === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label><label>Periudha<select disabled><option>${escapeHtml(period ? `${period.name} · ${period.school_year}` : 'Pa periudhë')}</option></select></label></div><label>Shënim opsional<textarea name="message" maxlength="1200" rows="4" placeholder="Përmbledhje e shkurtër për prindin">${escapeHtml(existing?.parent_message || '')}</textarea></label><label>Shkruani emrin dhe mbiemrin e nxënësit<input name="confirmationName" required autocomplete="off" placeholder="${escapeHtml(selectedStudent.name)}"></label><p class="teacher-assessment-status" aria-live="polite"></p><div class="teacher-form-actions"><button type="button" id="cancelFinalGrade">Anulo</button><button class="teacher-primary-button" type="submit">Konfirmo notën</button></div></form>`;
    document.getElementById('cancelFinalGrade').addEventListener('click', renderAssessmentDetail);
    document.getElementById('teacherFinalGradeForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('[type="submit"]');
      const status = form.querySelector('.teacher-assessment-status');
      const confirmationName = form.elements.confirmationName.value.trim().replace(/\s+/g, ' ');
      if (confirmationName.toLocaleLowerCase('sq') !== selectedStudent.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sq')) {
        status.textContent = 'Emri dhe mbiemri nuk përputhen me nxënësin e zgjedhur.';
        return;
      }
      if (!window.confirm(`Jeni të sigurt që dëshironi të publikoni notën ${form.elements.grade.value} për ${selectedStudent.name}?`)) return;
      submit.disabled = true;
      try {
        const saved = await saveTeacherFinalGrade({ studentId: selectedStudent.id, subjectId: selectedAssessmentSubjectId, periodId: selectedAcademicPeriodId, grade: form.elements.grade.value, parentMessage: form.elements.message.value, confirmationName });
        assessmentContext.finalGrades = assessmentContext.finalGrades.filter(item => item.id !== saved.id && !(item.student_id === saved.student_id && item.subject_id === saved.subject_id && item.academic_period_id === saved.academic_period_id));
        assessmentContext.finalGrades.push(saved);
        renderAssessmentDetail();
      } catch (error) {
        submit.disabled = false;
        status.textContent = error.message || 'Nota përfundimtare nuk u ruajt.';
      }
    });
  }

  root.querySelectorAll('[data-folder-prototype]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.folderPrototype;
    title.textContent = action === 'mood' ? 'Humori' : action === 'preferences' ? 'Preferencat' : action === 'pia' ? 'PIA' : 'Vlerësimet';
    kicker.textContent = selectedStudent.name;
    showPanel('folder-detail', false);
    setDetailBack('Dosja e nxënësit', () => openFolder(selectedStudent));
    const detail = document.getElementById('teacherFolderDetail');
    if (action === 'mood') {
      detail.innerHTML = renderMoodDetail();
      bindStaffMoodLogForm('teacher');
    }
    if (action === 'preferences') detail.innerHTML = renderPreferencesDetail();
    if (action === 'pia') detail.innerHTML = renderPiaDetail();
    if (action === 'assessments') renderAssessmentDetail();
  }));

  const composer = document.getElementById('teacherMaterialComposer');
  const materialStatus = document.getElementById('teacherMaterialStatus');
  const materialFiles = document.getElementById('teacherMaterialFiles');
  const materialList = document.getElementById('teacherMaterialList');
  const deleteMaterialDialog = document.getElementById('teacherDeleteMaterialDialog');
  const deleteMaterialMessage = document.getElementById('teacherDeleteMaterialMessage');

  function materialDate(value, includeTime = false) {
    return formatSqDate(value, { includeTime });
  }

  function bytesLabel(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  function studentsForMaterialSubject(subjectId) {
    const classIds = new Set(
      materialContext.classAssignments
        .filter(assignment => assignment.subject_id === subjectId)
        .map(assignment => assignment.class_id)
    );
    const directIds = new Set(materialContext.studentAssignments || []);
    return students.filter(student => directIds.has(student.id) || (student.class_id && classIds.has(student.class_id)));
  }

  function renderMaterialFormOptions() {
    const subjectSelect = document.getElementById('teacherMaterialSubject');
    const previousSubjectId = subjectSelect.value;
    subjectSelect.innerHTML = materialContext.subjects.map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join('');
    const selectedSubjectId = materialContext.subjects.some(subject => subject.id === previousSubjectId)
      ? previousSubjectId
      : materialContext.subjects[0]?.id || '';
    subjectSelect.value = selectedSubjectId;
    const allowedStudents = studentsForMaterialSubject(selectedSubjectId);
    const classes = [...new Map(
      materialContext.classAssignments
        .filter(assignment => assignment.subject_id === selectedSubjectId)
        .map(assignment => [assignment.class_id, { id: assignment.class_id, name: assignment.classes?.name || allowedStudents.find(student => student.class_id === assignment.class_id)?.className || 'Pa klasë' }])
    ).values()];
    const classSelect = document.getElementById('teacherMaterialClass');
    const previousClassId = classSelect.value;
    classSelect.innerHTML = classes.map(item => `<option value="${escapeHtml(item.id)}">Klasa ${escapeHtml(item.name)}</option>`).join('');
    classSelect.value = classes.some(item => item.id === previousClassId) ? previousClassId : (classes[0]?.id || '');
    const studentOptions = document.getElementById('teacherMaterialStudents');
    studentOptions.innerHTML = allowedStudents.map(student => `<label><input type="checkbox" value="${escapeHtml(student.id)}"> ${escapeHtml(student.name)} <small>Klasa ${escapeHtml(student.className || 'Pa klasë')}</small></label>`).join('');
    updateMaterialAudience();
  }

  function updateMaterialAudience() {
    const audience = document.getElementById('teacherMaterialAudience').value;
    document.getElementById('teacherMaterialStudents').classList.toggle('hidden', audience !== 'selected');
    document.getElementById('teacherMaterialClassField').classList.toggle('hidden', audience !== 'class');
  }

  function renderSelectedMaterialFiles() {
    const box = document.getElementById('teacherMaterialFileSelection');
    box.innerHTML = [...materialFiles.files].map(file => `<span><strong>${escapeHtml(file.name)}</strong><small>${bytesLabel(file.size)}</small></span>`).join('');
  }

  function renderMaterialWarnings() {
    const box = document.getElementById('teacherMaterialWarnings');
    box.innerHTML = '';
    materialWarnings.forEach(warning => {
      const material = teacherMaterials.find(item => item.id === warning.material_id);
      if (!material) return;
      const article = document.createElement('article');
      article.innerHTML = `<span>!</span><div><strong>“${escapeHtml(material.title)}” skadon më ${escapeHtml(materialDate(warning.expires_at))}</strong><p>Shkarkojeni ose ndryshoni ruajtjen para fshirjes automatike.</p></div><button type="button">Në rregull</button>`;
      article.querySelector('button').addEventListener('click', async () => {
        await markRetentionWarningRead(warning.id);
        materialWarnings = materialWarnings.filter(item => item.id !== warning.id);
        renderMaterialWarnings();
      });
      box.appendChild(article);
    });
  }

  function confirmMaterialDelete(material) {
    deleteMaterialMessage.textContent = `Jeni të sigurt që dëshironi të fshini “${material.title}”? Ky material nuk do të jetë më i disponueshëm për prindërit.`;
    deleteMaterialDialog.returnValue = 'cancel';
    return new Promise(resolve => {
      if (typeof deleteMaterialDialog.showModal === 'function') {
        deleteMaterialDialog.addEventListener('close', () => resolve(deleteMaterialDialog.returnValue === 'confirm'), { once: true });
        deleteMaterialDialog.showModal();
        return;
      }
      deleteMaterialDialog.classList.add('fallback-open');
      const finish = confirmed => {
        deleteMaterialDialog.classList.remove('fallback-open');
        resolve(confirmed);
      };
      deleteMaterialDialog.querySelector('[value="cancel"]').addEventListener('click', () => finish(false), { once: true });
      deleteMaterialDialog.querySelector('[value="confirm"]').addEventListener('click', () => finish(true), { once: true });
    });
  }

  async function handleMaterialDelete(button) {
    const material = teacherMaterials.find(item => item.id === button.dataset.materialId);
    if (!material) {
      materialStatus.textContent = 'Materiali nuk u gjet. Rifreskoni listën dhe provoni përsëri.';
      return;
    }
    if (!await confirmMaterialDelete(material)) return;
    button.disabled = true;
    materialStatus.textContent = 'Duke fshirë materialin...';
    try {
      await deleteTeacherMaterial(material);
      teacherMaterials = teacherMaterials.filter(item => item.id !== material.id);
      materialStatus.textContent = 'Materiali u fshi.';
      renderMaterialLibrary();
    } catch (error) {
      button.disabled = false;
      materialStatus.textContent = error.message || 'Materiali nuk mundi të fshihej.';
    }
  }

  function renderMaterialLibrary() {
    materialList.innerHTML = '';
    if (!teacherMaterials.length) {
      materialList.innerHTML = '<p class="teacher-material-empty">Ende nuk keni publikuar materiale.</p>';
      return;
    }
    teacherMaterials.forEach(material => {
      const files = material.class_material_files || [];
      const recipients = material.class_material_recipients || [];
      const article = document.createElement('article');
      const fileType = files[0]?.mime_type === 'application/pdf' ? 'PDF' : files.length ? 'IMG' : 'TXT';
      const audience = material.audience === 'class' && material.classes ? `Klasa ${material.classes.name}` : `${recipients.length} nxënës`;
      const expiry = material.expires_at ? `Fshihet më ${materialDate(material.expires_at)}` : 'Ruhet pa afat';
      article.innerHTML = `<div class="teacher-material-file${fileType === 'IMG' ? ' image' : ''}">${fileType}</div><div><span>${escapeHtml(material.subjects?.name || 'Lënda')} · ${escapeHtml(audience)}</span><h3>${escapeHtml(material.title)}</h3><p>${escapeHtml(material.description || 'Pa përshkrim shtesë.')}</p><small>${escapeHtml(materialDate(material.created_at, true))} · ${files.length} skedarë · ${escapeHtml(expiry)}</small><div class="teacher-material-downloads"></div></div><button class="teacher-material-delete" type="button" data-material-id="${escapeHtml(material.id)}" aria-label="Fshi materialin" title="Fshi materialin">×</button>`;
      const downloads = article.querySelector('.teacher-material-downloads');
      files.forEach(file => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `↓ ${file.original_name} · ${bytesLabel(file.byte_size)}`;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const url = await createMaterialDownloadUrl(file.storage_path);
            window.open(url, '_blank', 'noopener,noreferrer');
          } catch (error) {
            materialStatus.textContent = error.message;
          } finally {
            button.disabled = false;
          }
        });
        downloads.appendChild(button);
      });
      materialList.appendChild(article);
    });
  }

  async function loadMaterialLibrary() {
    if (!materialContext.teacherId) return;
    const box = document.getElementById('teacherMaterialList');
    box.innerHTML = '<p class="teacher-material-empty">Duke ngarkuar materialet...</p>';
    try {
      const data = await fetchTeacherMaterials(materialContext.teacherId);
      teacherMaterials = data.materials;
      materialWarnings = data.warnings;
      renderMaterialWarnings();
      renderMaterialLibrary();
    } catch (error) {
      box.innerHTML = `<p class="teacher-material-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  function resetMaterialComposer() {
    composer.reset();
    materialFiles.value = '';
    materialStatus.textContent = '';
    renderSelectedMaterialFiles();
    renderMaterialFormOptions();
  }

  document.getElementById('teacherNewMaterial').addEventListener('click', () => {
    resetMaterialComposer();
    composer.classList.remove('hidden');
  });
  document.getElementById('teacherCancelMaterial').addEventListener('click', () => composer.classList.add('hidden'));
  document.getElementById('teacherMaterialAudience').addEventListener('change', updateMaterialAudience);
  document.getElementById('teacherMaterialSubject').addEventListener('change', renderMaterialFormOptions);
  materialFiles.addEventListener('change', renderSelectedMaterialFiles);
  materialList.addEventListener('click', async event => {
    const deleteButton = event.target.closest('.teacher-material-delete');
    if (!deleteButton || !materialList.contains(deleteButton)) return;
    await handleMaterialDelete(deleteButton);
  });
  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = composer.querySelector('[type="submit"]');
    const audience = document.getElementById('teacherMaterialAudience').value;
    const subjectId = document.getElementById('teacherMaterialSubject').value;
    const classId = document.getElementById('teacherMaterialClass').value;
    const allowedStudents = studentsForMaterialSubject(subjectId);
    let recipientIds = [];
    if (audience === 'class') recipientIds = allowedStudents.filter(student => student.class_id === classId).map(student => student.id);
    if (audience === 'subject') recipientIds = allowedStudents.map(student => student.id);
    if (audience === 'selected') recipientIds = [...document.querySelectorAll('#teacherMaterialStudents input:checked')].map(input => input.value);
    if (!materialContext.teacherId || !materialContext.schoolId) {
      materialStatus.textContent = 'Sesioni i mësimdhënësit nuk është gati. Kyçuni përsëri.';
      return;
    }
    if (!recipientIds.length) {
      materialStatus.textContent = 'Zgjidhni të paktën një nxënës marrës.';
      return;
    }
    submit.disabled = true;
    try {
      const preparedFiles = await prepareMaterialFiles([...materialFiles.files], message => { materialStatus.textContent = message; });
      await publishTeacherMaterial({
        teacherId: materialContext.teacherId,
        schoolId: materialContext.schoolId,
        subjectId,
        classId,
        audience,
        title: document.getElementById('teacherMaterialTitle').value.trim(),
        description: document.getElementById('teacherMaterialDescription').value.trim(),
        notifyInApp: document.getElementById('teacherMaterialNotify').checked,
        retentionDays: Number(document.getElementById('teacherMaterialRetention').value) || null,
        recipientIds,
        preparedFiles
      }, message => { materialStatus.textContent = message; });
      composer.classList.add('hidden');
      await loadMaterialLibrary();
    } catch (error) {
      materialStatus.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  function renderMessages() {
    const list = document.getElementById('teacherMessageList');
    const visible = messages.filter(message => !unreadOnly || message.unread);
    const unreadCount = messages.filter(message => message.unread).length;
    root.querySelectorAll('.teacher-nav-count,.teacher-header-actions [data-open-teacher-notifications] > span,.mobile-badge-icon > b').forEach(badge => {
      badge.textContent = String(unreadCount);
      badge.hidden = unreadCount === 0;
    });
    list.innerHTML = '';
    if (!visible.length) {
      list.innerHTML = `<p class="teacher-message-empty">${unreadOnly ? 'Nuk ka mesazhe të palexuara.' : 'Nuk ka ende biseda ose njoftime.'}</p>`;
      return;
    }
    visible.forEach(message => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `teacher-message-preview${message.unread ? '' : ' read'}`;
      button.classList.toggle('active', message.id === activeMessageId);
      button.innerHTML = `<span class="unread-dot"></span><div><strong>${escapeHtml(inboxCounterpartLabel(message))}</strong><p>${escapeHtml(message.subject)}</p><p>${escapeHtml(message.student)}</p></div><time>${escapeHtml(formatInboxTime(message.time))}</time>`;
      button.addEventListener('click', () => openMessage(message));
      list.appendChild(button);
    });
  }

  function openMessage(message) {
    activeMessageId = message.id;
    renderMessages();
    const detail = document.getElementById('teacherMessageDetail');
    const conversation = message.type === 'thread' ? message.messages.map(item => `<p class="teacher-saved-reply${item.sender_id === materialContext.teacherId ? ' teacher-own-message' : ''}"><strong>${escapeHtml(inboxSenderLabel(message, item))}</strong>${escapeHtml(item.body)}<time>${escapeHtml(formatSqDate(item.created_at, { includeTime: true }))}</time></p>`).join('') : `<p>${escapeHtml(message.body)}</p>`;
    detail.innerHTML = `<button class="teacher-back-button teacher-message-mobile-back" type="button">← Kthehu</button><div class="teacher-message-heading"><div class="teacher-message-heading-row"><div><h2>${escapeHtml(message.subject)}</h2><p>${escapeHtml(inboxCounterpartLabel(message))} · ${escapeHtml(message.student)}${message.context ? ` · ${escapeHtml(message.context)}` : ''}</p></div><div class="teacher-message-actions"><button type="button" data-message-action="toggle-read" data-action="${message.unread ? 'read' : 'unread'}">${message.unread ? 'Shëno si të lexuar' : 'Shëno si të palexuar'}</button><button class="danger" type="button" data-message-action="delete">Fshi</button></div></div><p class="teacher-message-action-status" aria-live="polite"></p></div><div class="teacher-message-body">${conversation}</div>${message.type === 'thread' ? '<form class="teacher-reply-box"><label class="sr-only" for="teacherReplyText">Përgjigjja</label><textarea id="teacherReplyText" maxlength="2000" placeholder="Shkruani përgjigjen..."></textarea><p class="teacher-message-action-status" aria-live="polite"></p><div><button class="teacher-primary-button" type="submit">Dërgo përgjigjen</button></div></form>' : ''}`;
    detail.classList.add('mobile-open');
    detail.querySelector('.teacher-message-mobile-back').addEventListener('click', () => detail.classList.remove('mobile-open'));
    detail.querySelector('[data-message-action="toggle-read"]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const action = button.dataset.action;
      const status = detail.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = action === 'unread' ? 'Duke e shënuar si të palexuar…' : 'Duke e shënuar si të lexuar…';
      try {
        if (action === 'unread') {
          if (message.type === 'thread') await markTeacherThreadUnread(message.id);
          else await markTeacherNotificationUnread(message.id);
          message.unread = true;
        } else {
          if (message.type === 'thread') await markTeacherThreadRead(message.id);
          else await markTeacherNotificationRead(message.id);
          message.unread = false;
        }
        renderMessages();
        openMessage(message);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Mesazhi nuk u përditësua.';
      }
    });
    detail.querySelector('[data-message-action="delete"]').addEventListener('click', async event => {
      if (!window.confirm('Jeni të sigurt që dëshironi ta fshini këtë mesazh? Ky veprim nuk mund të zhbëhet.')) return;
      const button = event.currentTarget;
      const status = detail.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = 'Duke e fshirë mesazhin…';
      try {
        if (message.type === 'thread') await archiveTeacherThread(message.id);
        else await deleteTeacherNotification(message.id);
        messages = messages.filter(item => item.id !== message.id);
        activeMessageId = null;
        detail.classList.remove('mobile-open');
        detail.innerHTML = '<div class="teacher-empty-message"><span>◇</span><strong>Zgjidhni një mesazh</strong><p>Mesazhi dhe përgjigjet do të shfaqen këtu.</p></div>';
        renderMessages();
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Mesazhi nuk u fshi.';
      }
    });
    detail.querySelector('form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const textarea = detail.querySelector('textarea');
      if (!textarea.value.trim()) return;
      const button = event.currentTarget.querySelector('[type="submit"]');
      const status = event.currentTarget.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = 'Duke dërguar përgjigjen…';
      try {
        const reply = await sendTeacherThreadMessage(message.id, textarea.value);
        message.messages.push(reply);
        message.body = reply.body;
        openMessage(message);
      } catch (error) {
        button.disabled = false;
        status.textContent = error.message || 'Përgjigjja nuk u dërgua.';
      }
    });
  }

  document.getElementById('teacherUnreadFilter').addEventListener('click', event => {
    unreadOnly = !unreadOnly;
    event.currentTarget.classList.toggle('active', unreadOnly);
    event.currentTarget.textContent = unreadOnly ? 'Shfaq të gjitha' : 'Vetëm të palexuarat';
    renderMessages();
  });

  document.getElementById('teacherSupportStudentSelect').addEventListener('change', event => {
    supportStudentId = event.currentTarget.value || null;
    const session = getSupportSession();
    session.error = '';
    renderSupportPanel();
  });

  document.getElementById('teacherSupportInput').addEventListener('input', event => {
    const student = currentSupportStudent();
    const session = getSupportSession(student);
    session.draft = event.currentTarget.value;
    session.error = '';
    const submit = document.getElementById('teacherSupportSubmit');
    if (submit) submit.disabled = session.pending || !session.draft.trim();
    const status = document.getElementById('teacherSupportStatus');
    if (status && !session.pending) status.textContent = '';
  });

  document.getElementById('teacherSupportForm').addEventListener('submit', submitSupportMessage);
  document.getElementById('teacherSupportClear').addEventListener('click', () => {
    const student = currentSupportStudent();
    const session = getSupportSession(student);
    session.messages = [];
    session.draft = '';
    session.error = '';
    renderSupportPanel();
    document.getElementById('teacherSupportInput')?.focus();
  });

  document.getElementById('teacherSaveSettings').addEventListener('click', async event => {
    const email = document.getElementById('teacherNotificationEmail').value.trim();
    const parentMessageEmails = document.getElementById('teacherParentMessageEmails').checked;
    const dailyDigestEmails = false;
    const status = document.getElementById('teacherSettingsStatus');
    if (parentMessageEmails && !email) {
      status.textContent = 'Shtoni email-in ku dëshironi të merrni njoftimet.';
      return;
    }
    event.currentTarget.disabled = true;
    status.textContent = 'Duke ruajtur cilësimet…';
    try {
      notificationPreferences = await saveTeacherNotificationPreferences({ profileId: materialContext.teacherId, email, parentMessageEmails, dailyDigestEmails });
      status.textContent = 'Cilësimet e email-it u ruajtën.';
    } catch (error) {
      status.textContent = error.message || 'Cilësimet nuk u ruajtën.';
    } finally {
      event.currentTarget.disabled = false;
    }
  });

  const logoutDialog = document.getElementById('teacherLogoutDialog');
  root.querySelectorAll('[data-teacher-logout]').forEach(button => button.addEventListener('click', () => {
    logoutDialog.returnValue = 'cancel';
    logoutDialog.showModal();
  }));
  logoutDialog.addEventListener('click', event => {
    if (event.target === logoutDialog) logoutDialog.close('cancel');
  });
  logoutDialog.addEventListener('close', () => {
    if (logoutDialog.returnValue === 'confirm') onLogout?.();
  });
  deleteMaterialDialog.addEventListener('click', event => {
    if (event.target === deleteMaterialDialog) deleteMaterialDialog.close('cancel');
  });

  renderStudentClassFilter();
  renderStudents();
  renderMessages();
  renderSupportPanel();

  return {
    setData({ teacherName, teacherEmail = '', teacherId, schoolId, teacherSubjects = [], subjects = [], teacherClassAssignments = [], teacherStudentAssignments = [], academicPeriods: nextPeriods = [], students: nextStudents = [], moods = {}, moodHistories: nextMoodHistories = {}, staffMoodLogs: nextStaffMoodLogs = {}, messages: nextMessages = [], chapters = [], assessments = [], finalGrades = [], preferences = null, piaObjectives = [], piaUpdates = [] } = {}) {
      if (teacherId && teacherId !== supportOwnerId) {
        supportOwnerId = teacherId;
        supportStudentId = null;
        supportSessions = Object.create(null);
      }
      if (teacherName) {
        root.querySelectorAll('[data-teacher-name]').forEach(element => { element.textContent = teacherName; });
        const avatar = initials(teacherName);
        root.querySelectorAll('.teacher-account-avatar,.teacher-header-avatar').forEach(element => { element.textContent = avatar; });
      }
      const previousStudentId = selectedStudent?.id || null;
      students = Array.isArray(nextStudents) ? nextStudents.map(student => ({ ...student, mood: moods[student.name]?.mood || '', moodComment: moods[student.name]?.comment || '' })) : [];
      moodHistories = nextMoodHistories;
      staffMoodLogs = nextStaffMoodLogs || {};
      selectedStudent = students.find(student => student.id === previousStudentId) || students[0] || null;
      materialContext = {
        teacherId: teacherId || materialContext.teacherId,
        schoolId: schoolId || materialContext.schoolId,
        subjects,
        teacherSubjects,
        classAssignments: teacherClassAssignments,
        studentAssignments: teacherStudentAssignments
      };
      assessmentContext = { chapters, assessments, finalGrades };
      piaContext = { objectives: piaObjectives, updates: piaUpdates };
      selectedAssessmentSubjectId = subjects[0]?.id || null;
      academicPeriods = nextPeriods;
      selectedAcademicPeriodId = academicPeriods.find(period => period.status === 'active')?.id || academicPeriods[0]?.id || null;
      messages = Array.isArray(nextMessages) ? nextMessages.map(message => ({ ...message })) : [];
      notificationPreferences = preferences;
      document.getElementById('teacherNotificationEmail').value = preferences?.notification_email || teacherEmail;
      document.getElementById('teacherParentMessageEmails').checked = preferences?.parent_message_emails || false;
      document.getElementById('teacherDailyDigestEmails').checked = false;
      document.getElementById('teacherDailyDigestEmails').disabled = true;
      activeMessageId = null;
      renderStudentClassFilter();
      renderStudents(document.getElementById('teacherStudentSearch').value);
      renderMessages();
      renderMaterialFormOptions();
      renderSupportPanel();
      loadMaterialLibrary();
    },
    setMessages(nextMessages = []) {
      messages = Array.isArray(nextMessages) ? nextMessages.map(message => ({ ...message })) : [];
      const activeMessage = messages.find(message => message.id === activeMessageId);
      if (activeMessage) openMessage(activeMessage);
      else {
        activeMessageId = null;
        renderMessages();
      }
    }
  };
}
