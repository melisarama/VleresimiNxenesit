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
  markTeacherThreadRead,
  saveChapterAssessment,
  saveTeacherFinalGrade,
  saveTeacherNotificationPreferences,
  sendTeacherThreadMessage
} from '../services/teacherService.js';

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

export function initializeTeacherPrototype({ onLogout } = {}) {
  const root = document.getElementById('teacherPrototype');
  if (!root) return { setData() {} };

  let students = [];
  let selectedStudent = null;
  let moodHistories = {};
  let messages = [];
  let unreadOnly = false;
  let activeMessageId = null;
  let materialContext = { teacherId: null, schoolId: null, subjects: [] };
  let teacherMaterials = [];
  let materialWarnings = [];
  let academicPeriods = [];
  let selectedAcademicPeriodId = null;
  let selectedAssessmentSubjectId = null;
  let assessmentContext = { chapters: [], assessments: [], finalGrades: [] };
  let notificationPreferences = null;

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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navButtons.forEach(button => button.addEventListener('click', () => showPanel(button.dataset.teacherView)));
  root.querySelector('[data-open-teacher-notifications]').addEventListener('click', () => showPanel('notifications'));

  function studentMood(student) {
    return student.mood || 'Pa gjendje të raportuar sot';
  }

  function renderStudents(query = '') {
    const box = document.getElementById('teacherClassGroups');
    const normalized = query.trim().toLocaleLowerCase('sq');
    const filtered = students.filter(student => student.name.toLocaleLowerCase('sq').includes(normalized));
    const groups = filtered.reduce((result, student) => {
      const className = student.className || 'Pa klasë';
      (result[className] ||= []).push(student);
      return result;
    }, {});
    document.getElementById('teacherPrototypeStudentTotal').textContent = `${filtered.length} nxënës`;
    box.innerHTML = '';
    if (!filtered.length) {
      box.innerHTML = '<p class="teacher-empty-students">Nuk u gjet asnjë nxënës me këtë emër.</p>';
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
        row.innerHTML = `<span>${initials(student.name)}</span><div><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.support || 'Pa përshtatje të shënuara')}</small></div><p class="teacher-student-mood">${escapeHtml(studentMood(student))}</p><button type="button">Hap</button>`;
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
    const subjectNames = materialContext.subjects.map(subject => subject.name).join(', ');
    document.getElementById('teacherFolderMeta').textContent = `Klasa ${student.className || 'Pa klasë'}${subjectNames ? ` · ${subjectNames}` : ''}`;
    title.textContent = 'Dosja e nxënësit';
    kicker.textContent = student.name;
    showPanel('student-folder', false);
  }

  document.getElementById('teacherStudentSearch').addEventListener('input', event => renderStudents(event.target.value));
  document.getElementById('teacherFolderBack').addEventListener('click', () => showPanel('students'));
  document.getElementById('teacherDetailBack').addEventListener('click', () => openFolder(selectedStudent));

  function detailHeading(titleText, description) {
    return `<div class="teacher-detail-heading"><h2>${escapeHtml(titleText)}</h2><p>${escapeHtml(description)}</p></div>`;
  }

  function renderMoodDetail() {
    const heading = detailHeading('Humori ditor dhe historiku', `Njoftimet për ${selectedStudent.name} nga prindi.`);
    const history = (moodHistories[selectedStudent.id] || []).filter(item => item.reported_on !== new Date().toISOString().slice(0, 10));
    const current = selectedStudent.mood
      ? `<article class="teacher-current-mood"><small>Sot</small><strong>${escapeHtml(selectedStudent.mood)}</strong><p>${escapeHtml(selectedStudent.moodComment || 'Pa koment shtesë.')}</p></article>`
      : '<div class="teacher-detail-empty"><strong>Pa gjendje të raportuar sot</strong><p>Prindi nuk ka dërguar ende një përditësim për ditën e sotme.</p></div>';
    const previous = history.length
      ? `<div class="teacher-history-list">${history.map(item => `<article><time>${escapeHtml(new Intl.DateTimeFormat('sq-AL', { dateStyle: 'medium' }).format(new Date(`${item.reported_on}T12:00:00`)))}</time><strong>${escapeHtml(item.mood)}</strong><p>${escapeHtml(item.parent_comment || 'Pa koment shtesë.')}</p></article>`).join('')}</div>`
      : '<div class="teacher-detail-empty"><strong>Nuk ka hyrje të mëparshme</strong><p>Historiku është bosh.</p></div>';
    return `${heading}<div class="teacher-mood-summary">${current}${previous}</div>`;
  }

  function renderPreferencesDetail() {
    const heading = detailHeading('Preferencat dhe komunikimi', 'Të dhënat e konfirmuara për mbështetjen e nxënësit.');
    const hasProfile = selectedStudent.supportSummary || selectedStudent.accessibilityInformation || selectedStudent.preferredMode || selectedStudent.learningPreferences?.length || selectedStudent.communicationLanguage || selectedStudent.communicationMethod;
    if (!hasProfile) return `${heading}<div class="teacher-detail-empty"><strong>Pa preferenca të raportuara</strong><p>Ky seksion do të plotësohet pasi familja të japë informacionin përkatës.</p></div>`;
    return `${heading}<div class="teacher-preference-grid">${selectedStudent.learningPreferences?.length ? `<article><span>Preferencat e të nxënit</span><p>${escapeHtml(selectedStudent.learningPreferences.join(', '))}</p></article>` : ''}${selectedStudent.communicationLanguage ? `<article><span>Gjuha e komunikimit</span><p>${escapeHtml(selectedStudent.communicationLanguage)}</p></article>` : ''}${selectedStudent.communicationMethod ? `<article><span>Mënyra e komunikimit</span><p>${escapeHtml(selectedStudent.communicationMethod)}</p></article>` : ''}${selectedStudent.supportSummary ? `<article><span>Përmbledhja</span><p>${escapeHtml(selectedStudent.supportSummary)}</p></article>` : ''}${selectedStudent.preferredMode ? `<article><span>Mënyra e preferuar</span><p>${escapeHtml(selectedStudent.preferredMode)}</p></article>` : ''}${selectedStudent.accessibilityInformation ? `<article><span>Qasshmëria</span><p>${escapeHtml(selectedStudent.accessibilityInformation)}</p></article>` : ''}</div>`;
  }

  function formatInboxTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('sq-AL', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function proficiencyOptions(value) {
    const levels = [['', 'Pa vlerësuar'], ['1', '1 · Fillestar'], ['2', '2 · Në zhvillim'], ['3', '3 · Pjesërisht i qëndrueshëm'], ['4', '4 · I qëndrueshëm'], ['5', '5 · Zotërim i avancuar']];
    const normalized = String(value ?? '');
    const custom = normalized && !levels.some(([score]) => score === normalized) ? `<option value="${escapeHtml(normalized)}" selected>${escapeHtml(normalized)} · Vlerësim ekzistues</option>` : '';
    return custom + levels.map(([score, label]) => `<option value="${score}"${score === normalized ? ' selected' : ''}${score === '' ? ' disabled' : ''}>${label}</option>`).join('');
  }

  function renderAssessmentDetail() {
    const subjects = materialContext.subjects;
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
    box.innerHTML = `${detailHeading('Vlerësimet', 'Njohuritë sipas kapitujve ruhen në periudhën e zgjedhur.')}<div class="teacher-assessment-toolbar"><label>Lënda<select id="teacherAssessmentSubject"${subjects.length ? '' : ' disabled'}>${subjectOptions || '<option>Pa lëndë të caktuar</option>'}</select></label><label>Periudha<select id="teacherAssessmentPeriod"${studentPeriods.length ? '' : ' disabled'}>${periodOptions || '<option>Pa periudhë akademike</option>'}</select></label><button class="teacher-primary-button" id="teacherAddChapter" type="button"${selectedAssessmentSubjectId ? '' : ' disabled'}>＋ Shto kapitull</button></div><p class="teacher-assessment-status" id="teacherAssessmentStatus" aria-live="polite"></p>${selectedPeriod && !editable ? '<p class="teacher-period-lock">Kjo periudhë nuk është aktive. Mund ta shikoni, por vlerësimet nuk mund të ndryshohen.</p>' : ''}<div class="teacher-chapter-list">${chapters.length ? chapters.map(chapter => { const assessment = assessmentByChapter[chapter.id]; const value = assessment ? String(Number(assessment.score)) : ''; return `<article class="teacher-chapter-row"><div><strong>${escapeHtml(chapter.name)}</strong><small>${assessment ? `Ruajtur më ${escapeHtml(new Intl.DateTimeFormat('sq-AL', { dateStyle: 'medium' }).format(new Date(assessment.updated_at || assessment.graded_at)))}` : 'Ende pa vlerësim'}</small></div><select data-chapter-id="${chapter.id}" aria-label="Vlerësimi për ${escapeHtml(chapter.name)}"${editable ? '' : ' disabled'}>${proficiencyOptions(value)}</select><button type="button" data-message-chapter-id="${chapter.id}"${editable && assessment ? '' : ' disabled'}>${assessment?.parent_message ? 'Ndrysho mesazhin' : '＋ Mesazh për prindin'}</button></article>`; }).join('') : '<p class="teacher-detail-empty">Nuk ka kapituj aktivë për këtë lëndë.</p>'}</div><div class="teacher-final-grade${complete ? '' : ' incomplete'}"><div><strong>Nota përfundimtare${finalGrade ? `: ${finalGrade.grade}` : ''}</strong><p>${!editable ? 'Nota mund të vendoset vetëm në periudhën aktive.' : `${assessedCount} nga ${chapters.length} kapituj janë vlerësuar.${complete ? '' : ' Mund të vazhdoni, por kontrolloni notën me kujdes.'}`}</p></div><button type="button"${editable && selectedAssessmentSubjectId ? '' : ' disabled'}>${editable && selectedAssessmentSubjectId ? (finalGrade ? 'Ndrysho notën' : 'Vendos notën') : 'Jo e disponueshme'}</button></div>`;
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
    title.textContent = action === 'mood' ? 'Humori' : action === 'preferences' ? 'Preferencat' : 'Vlerësimet';
    kicker.textContent = selectedStudent.name;
    showPanel('folder-detail', false);
    const detail = document.getElementById('teacherFolderDetail');
    if (action === 'mood') detail.innerHTML = renderMoodDetail();
    if (action === 'preferences') detail.innerHTML = renderPreferencesDetail();
    if (action === 'assessments') renderAssessmentDetail();
  }));

  const composer = document.getElementById('teacherMaterialComposer');
  const materialStatus = document.getElementById('teacherMaterialStatus');
  const materialFiles = document.getElementById('teacherMaterialFiles');

  function materialDate(value, includeTime = false) {
    if (!value) return '';
    return new Intl.DateTimeFormat('sq-AL', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
  }

  function bytesLabel(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }

  function renderMaterialFormOptions() {
    const subjectSelect = document.getElementById('teacherMaterialSubject');
    subjectSelect.innerHTML = materialContext.subjects.map(subject => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`).join('');
    const classes = [...new Map(students.filter(student => student.class_id).map(student => [student.class_id, { id: student.class_id, name: student.className || 'Pa klasë' }])).values()];
    const classSelect = document.getElementById('teacherMaterialClass');
    classSelect.innerHTML = classes.map(item => `<option value="${escapeHtml(item.id)}">Klasa ${escapeHtml(item.name)}</option>`).join('');
    const studentOptions = document.getElementById('teacherMaterialStudents');
    studentOptions.innerHTML = students.map(student => `<label><input type="checkbox" value="${escapeHtml(student.id)}"> ${escapeHtml(student.name)} <small>Klasa ${escapeHtml(student.className || 'Pa klasë')}</small></label>`).join('');
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

  function renderMaterialLibrary() {
    const box = document.getElementById('teacherMaterialList');
    box.innerHTML = '';
    if (!teacherMaterials.length) {
      box.innerHTML = '<p class="teacher-material-empty">Ende nuk keni publikuar materiale.</p>';
      return;
    }
    teacherMaterials.forEach(material => {
      const files = material.class_material_files || [];
      const recipients = material.class_material_recipients || [];
      const article = document.createElement('article');
      const fileType = files[0]?.mime_type === 'application/pdf' ? 'PDF' : files.length ? 'IMG' : 'TXT';
      const audience = material.audience === 'class' && material.classes ? `Klasa ${material.classes.name}` : `${recipients.length} nxënës`;
      const expiry = material.expires_at ? `Fshihet më ${materialDate(material.expires_at)}` : 'Ruhet pa afat';
      article.innerHTML = `<div class="teacher-material-file${fileType === 'IMG' ? ' image' : ''}">${fileType}</div><div><span>${escapeHtml(material.subjects?.name || 'Lënda')} · ${escapeHtml(audience)}</span><h3>${escapeHtml(material.title)}</h3><p>${escapeHtml(material.description || 'Pa përshkrim shtesë.')}</p><small>${escapeHtml(materialDate(material.created_at, true))} · ${files.length} skedarë · ${escapeHtml(expiry)}</small><div class="teacher-material-downloads"></div></div><button type="button" aria-label="Fshi materialin" title="Fshi materialin">×</button>`;
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
      article.querySelector(':scope > button').addEventListener('click', async () => {
        if (!window.confirm(`A jeni të sigurt që dëshironi të fshini “${material.title}”?`)) return;
        try {
          await deleteTeacherMaterial(material);
          teacherMaterials = teacherMaterials.filter(item => item.id !== material.id);
          renderMaterialLibrary();
        } catch (error) {
          materialStatus.textContent = error.message;
        }
      });
      box.appendChild(article);
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
  materialFiles.addEventListener('change', renderSelectedMaterialFiles);
  composer.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = composer.querySelector('[type="submit"]');
    const audience = document.getElementById('teacherMaterialAudience').value;
    const classId = document.getElementById('teacherMaterialClass').value;
    let recipientIds = [];
    if (audience === 'class') recipientIds = students.filter(student => student.class_id === classId).map(student => student.id);
    if (audience === 'subject') recipientIds = students.map(student => student.id);
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
        subjectId: document.getElementById('teacherMaterialSubject').value,
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
      list.innerHTML = `<p class="teacher-message-empty">${unreadOnly ? 'Nuk ka mesazhe të palexuara.' : 'Nuk ka mesazhe nga prindërit.'}</p>`;
      return;
    }
    visible.forEach(message => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `teacher-message-preview${message.unread ? '' : ' read'}`;
      button.classList.toggle('active', message.id === activeMessageId);
      button.innerHTML = `<span class="unread-dot"></span><div><strong>${escapeHtml(message.parent)}</strong><p>${escapeHtml(message.subject)}</p><p>${escapeHtml(message.student)}</p></div><time>${escapeHtml(formatInboxTime(message.time))}</time>`;
      button.addEventListener('click', () => openMessage(message));
      list.appendChild(button);
    });
  }

  function openMessage(message) {
    activeMessageId = message.id;
    renderMessages();
    const detail = document.getElementById('teacherMessageDetail');
    const conversation = message.type === 'thread' ? message.messages.map(item => `<p class="teacher-saved-reply${item.sender_id === materialContext.teacherId ? ' teacher-own-message' : ''}"><strong>${item.sender_id === materialContext.teacherId ? 'Ju' : 'Prindi'}</strong>${escapeHtml(item.body)}<time>${escapeHtml(new Intl.DateTimeFormat('sq-AL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at)))}</time></p>`).join('') : `<p>${escapeHtml(message.body)}</p>`;
    detail.innerHTML = `<button class="teacher-back-button teacher-message-mobile-back" type="button">← Kthehu</button><div class="teacher-message-heading"><div class="teacher-message-heading-row"><div><h2>${escapeHtml(message.subject)}</h2><p>${escapeHtml(message.parent)} · ${escapeHtml(message.student)}${message.context ? ` · ${escapeHtml(message.context)}` : ''}</p></div><div class="teacher-message-actions">${message.unread ? '<button type="button" data-message-action="read">Shëno si të lexuar</button>' : '<span>Mesazh i lexuar</span>'}<button class="danger" type="button" data-message-action="delete">Fshi</button></div></div><p class="teacher-message-action-status" aria-live="polite"></p></div><div class="teacher-message-body">${conversation}</div>${message.type === 'thread' ? '<form class="teacher-reply-box"><label class="sr-only" for="teacherReplyText">Përgjigjja</label><textarea id="teacherReplyText" maxlength="2000" placeholder="Shkruani përgjigjen..."></textarea><p class="teacher-message-action-status" aria-live="polite"></p><div><button class="teacher-primary-button" type="submit">Dërgo përgjigjen</button></div></form>' : ''}`;
    detail.classList.add('mobile-open');
    detail.querySelector('.teacher-message-mobile-back').addEventListener('click', () => detail.classList.remove('mobile-open'));
    detail.querySelector('[data-message-action="read"]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const status = detail.querySelector('.teacher-message-action-status');
      button.disabled = true;
      status.textContent = 'Duke e shënuar si të lexuar…';
      try {
        if (message.type === 'thread') await markTeacherThreadRead(message.id);
        else await markTeacherNotificationRead(message.id);
        message.unread = false;
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

  document.getElementById('teacherSaveSettings').addEventListener('click', async event => {
    const email = document.getElementById('teacherNotificationEmail').value.trim();
    const parentMessageEmails = document.getElementById('teacherParentMessageEmails').checked;
    const dailyDigestEmails = document.getElementById('teacherDailyDigestEmails').checked;
    const status = document.getElementById('teacherSettingsStatus');
    if ((parentMessageEmails || dailyDigestEmails) && !email) {
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

  renderStudents();
  renderMessages();

  return {
    setData({ teacherName, teacherEmail = '', teacherId, schoolId, subjects = [], academicPeriods: nextPeriods = [], students: nextStudents = [], moods = {}, moodHistories: nextMoodHistories = {}, messages: nextMessages = [], chapters = [], assessments = [], finalGrades = [], preferences = null } = {}) {
      if (teacherName) {
        root.querySelectorAll('[data-teacher-name]').forEach(element => { element.textContent = teacherName; });
        const avatar = initials(teacherName);
        root.querySelectorAll('.teacher-account-avatar,.teacher-header-avatar').forEach(element => { element.textContent = avatar; });
      }
      students = Array.isArray(nextStudents) ? nextStudents.map(student => ({ ...student, mood: moods[student.name]?.mood || '', moodComment: moods[student.name]?.comment || '' })) : [];
      moodHistories = nextMoodHistories;
      selectedStudent = students[0] || null;
      renderStudents(document.getElementById('teacherStudentSearch').value);
      materialContext = { teacherId: teacherId || materialContext.teacherId, schoolId: schoolId || materialContext.schoolId, subjects };
      assessmentContext = { chapters, assessments, finalGrades };
      selectedAssessmentSubjectId = subjects[0]?.id || null;
      academicPeriods = nextPeriods;
      selectedAcademicPeriodId = academicPeriods.find(period => period.status === 'active')?.id || academicPeriods[0]?.id || null;
      messages = Array.isArray(nextMessages) ? nextMessages.map(message => ({ ...message })) : [];
      notificationPreferences = preferences;
      document.getElementById('teacherNotificationEmail').value = preferences?.notification_email || teacherEmail;
      document.getElementById('teacherParentMessageEmails').checked = preferences?.parent_message_emails || false;
      document.getElementById('teacherDailyDigestEmails').checked = preferences?.daily_digest_emails || false;
      activeMessageId = null;
      renderMessages();
      renderMaterialFormOptions();
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
