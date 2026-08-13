import {
  createMaterialDownloadUrl,
  deleteTeacherMaterial,
  fetchTeacherMaterials,
  markRetentionWarningRead,
  prepareMaterialFiles,
  publishTeacherMaterial
} from '../services/teacherMaterialService.js';

const sampleStudents = [
  { id: 'sample-1', name: 'Ana Demo', className: 'V-A', support: 'Tekst i madh dhe udhëzime të lexuara', mood: 'E qetë' },
  { id: 'sample-2', name: 'Erion Kola', className: 'V-A', support: 'Pa përshtatje të shënuara', mood: 'Pa njoftim sot' },
  { id: 'sample-3', name: 'Lira Gashi', className: 'V-B', support: 'Ritëm i qetë dhe hapa të shkurtër', mood: 'E lumtur' },
  { id: 'sample-4', name: 'Dion Berisha', className: 'V-B', support: 'Pa përshtatje të shënuara', mood: 'Pak i lodhur' }
];

const sampleMessages = [
  { id: 1, unread: true, parent: 'Arta Demo', student: 'Ana Demo', subject: 'Humori i Anës sot', time: '09:12', body: 'Përshëndetje, Ana ka fjetur pak mbrëmë. Mund të ketë nevojë për pak më shumë kohë gjatë ushtrimeve të para.' },
  { id: 2, unread: true, parent: 'Blerim Kola', student: 'Erion Kola', subject: 'Pyetje për ushtrimet', time: 'Dje', body: 'A mund të na tregoni cilat ushtrime duhet të përsërisim para vlerësimit të së premtes?' },
  { id: 3, unread: true, parent: 'Mira Gashi', student: 'Lira Gashi', subject: 'Njoftim i shkurtër', time: 'Hën', body: 'Lira do të largohet tridhjetë minuta më herët të mërkurën për një takim.' },
  { id: 4, unread: false, parent: 'Arta Demo', student: 'Ana Demo', subject: 'Faleminderit', time: '8 gusht', body: 'Faleminderit për materialet dhe sqarimin e djeshëm.' }
];

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

  let students = [...sampleStudents];
  let selectedStudent = students[0];
  let messages = sampleMessages.map(message => ({ ...message }));
  let unreadOnly = false;
  let materialContext = { teacherId: null, schoolId: null, subjects: [] };
  let teacherMaterials = [];
  let materialWarnings = [];
  let academicPeriods = [];
  let selectedAcademicPeriodId = null;
  const proficiency = new Map([
    ['Thyesat', '4'],
    ['Numrat dhjetorë', '3'],
    ['Gjeometria', ''],
    ['Problemet me fjalë', '2']
  ]);

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
    if (student.mood) return student.mood;
    const position = students.findIndex(item => item.id === student.id);
    return ['E qetë', 'Pa njoftim sot', 'E lumtur', 'Pak i lodhur'][Math.max(position, 0) % 4];
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
    document.getElementById('teacherFolderMeta').textContent = `Klasa ${student.className || 'Pa klasë'} · Matematikë`;
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
    return `${detailHeading('Humori ditor dhe historiku', `Njoftimet për ${selectedStudent.name} nga prindi.`)}<div class="teacher-mood-summary"><article class="teacher-current-mood"><small>Sot · 08:05</small><span>😌</span><strong>${escapeHtml(studentMood(selectedStudent))}</strong><p>“Ka fjetur pak dhe mund të ketë nevojë për një fillim më të qetë.”</p></article><div class="teacher-history-list"><article><time>12 gusht</time><span>😊</span><div><strong>E lumtur</strong><p>Pa koment shtesë.</p></div></article><article><time>11 gusht</time><span>😵</span><div><strong>E lodhur</strong><p>Ka pasur një mbrëmje të gjatë.</p></div></article><article><time>10 gusht</time><span>😌</span><div><strong>E qetë</strong><p>Pa koment shtesë.</p></div></article></div></div>`;
  }

  function renderPreferencesDetail() {
    return `${detailHeading('Preferencat dhe komunikimi', 'Udhëzime të shkurtra, vetëm për përdorim gjatë mësimit.')}<div class="teacher-preference-grid"><article><span>Mënyra e të nxënit</span><h3>Vizuale dhe praktike</h3><p>Përdorni shembuj në tabelë dhe lejoni një provë konkrete para punës së pavarur.</p></article><article><span>Gjuha e komunikimit</span><h3>Fjali të shkurtra dhe të drejtpërdrejta</h3><p>Jepni një udhëzim në herë dhe kontrolloni kuptimin pa e nxituar përgjigjen.</p></article><article><span>Formati i materialit</span><h3>Tekst i madh dhe kontrast i lartë</h3><p>Mbani hapësirë të qartë mes ushtrimeve dhe lexoni udhëzimet kur është e nevojshme.</p></article><article><span>Ritmi dhe përqendrimi</span><h3>Hapa të vegjël me pauza të shkurtra</h3><p>Ndajeni detyrën në pjesë dhe përdorni një sinjal të qartë para kalimit në hapin tjetër.</p></article></div>`;
  }

  function proficiencyOptions(value) {
    const levels = [['', 'Pa vlerësuar'], ['1', '1 · Fillestar'], ['2', '2 · Në zhvillim'], ['3', '3 · Pjesërisht i qëndrueshëm'], ['4', '4 · I qëndrueshëm'], ['5', '5 · Zotërim i avancuar']];
    return levels.map(([score, label]) => `<option value="${score}"${score === value ? ' selected' : ''}>${label}</option>`).join('');
  }

  function renderAssessmentDetail() {
    const chapters = [...proficiency.entries()];
    const complete = chapters.every(([, value]) => value);
    const studentPeriods = academicPeriods.filter(period => !selectedStudent.schoolYear || period.school_year === selectedStudent.schoolYear);
    if (!studentPeriods.some(period => period.id === selectedAcademicPeriodId)) {
      selectedAcademicPeriodId = studentPeriods.find(period => period.status === 'active')?.id || studentPeriods[0]?.id || null;
    }
    const selectedPeriod = studentPeriods.find(period => period.id === selectedAcademicPeriodId);
    const editable = selectedPeriod?.status === 'active';
    const periodOptions = studentPeriods.map(period => `<option value="${escapeHtml(period.id)}"${period.id === selectedAcademicPeriodId ? ' selected' : ''}>${escapeHtml(period.name)} · ${escapeHtml(period.school_year)}${period.status === 'closed' ? ' · E mbyllur' : period.status === 'planned' ? ' · E planifikuar' : ''}</option>`).join('');
    const box = document.getElementById('teacherFolderDetail');
    box.innerHTML = `${detailHeading('Vlerësimet', 'Njohuritë sipas kapitujve; rezultati nuk publikohet pa konfirmim.')}<div class="teacher-assessment-toolbar"><label>Lënda<select><option>Matematikë</option></select></label><label>Periudha<select id="teacherAssessmentPeriod"${studentPeriods.length ? '' : ' disabled'}>${periodOptions || '<option>Pa periudhë akademike</option>'}</select></label></div>${selectedPeriod && !editable ? '<p class="teacher-period-lock">Kjo periudhë nuk është aktive. Mund ta shikoni, por vlerësimet nuk mund të ndryshohen.</p>' : ''}<div class="teacher-chapter-list">${chapters.map(([chapter, value]) => `<article class="teacher-chapter-row"><div><strong>${escapeHtml(chapter)}</strong><small>${value ? 'Vlerësimi i fundit: 12 gusht' : 'Ende pa vlerësim'}</small></div><select data-chapter="${escapeHtml(chapter)}" aria-label="Vlerësimi për ${escapeHtml(chapter)}"${editable ? '' : ' disabled'}>${proficiencyOptions(value)}</select><button type="button" data-message-chapter="${escapeHtml(chapter)}"${editable ? '' : ' disabled'}>＋ Mesazh për prindin</button></article>`).join('')}</div><div class="teacher-final-grade"><div><strong>Nota përfundimtare</strong><p>${!editable ? 'Nota mund të vendoset vetëm në periudhën aktive.' : complete ? 'Të gjithë kapitujt janë vlerësuar. Nota mund të konfirmohet.' : 'Vlerësoni të gjithë kapitujt para se të vendosni notën përfundimtare.'}</p></div><button type="button"${complete && editable ? '' : ' disabled'}>${complete && editable ? 'Vendos notën' : 'Jo e disponueshme'}</button></div>`;
    document.getElementById('teacherAssessmentPeriod')?.addEventListener('change', event => {
      selectedAcademicPeriodId = event.target.value;
      renderAssessmentDetail();
    });
    box.querySelectorAll('[data-chapter]').forEach(select => select.addEventListener('change', () => {
      proficiency.set(select.dataset.chapter, select.value);
      renderAssessmentDetail();
    }));
    box.querySelectorAll('[data-message-chapter]').forEach(button => button.addEventListener('click', () => openParentMessage(button.dataset.messageChapter)));
    const finalButton = box.querySelector('.teacher-final-grade button');
    if (!finalButton.disabled) finalButton.addEventListener('click', openFinalGrade);
  }

  function openParentMessage(chapter) {
    const box = document.getElementById('teacherFolderDetail');
    box.innerHTML = `${detailHeading(`Mesazh për prindin · ${chapter}`, 'Ky mesazh do të shoqërojë vlerësimin kur funksionaliteti të lidhet me bazën e të dhënave.')}<form class="teacher-composer" id="teacherParentMessageForm"><label>Mesazhi<textarea rows="5" placeholder="Përshkruani shkurt progresin dhe çfarë mund të ushtrohet në shtëpi."></textarea></label><label class="teacher-check-row"><input type="checkbox" checked> Dërgo si njoftim brenda platformës</label><div class="teacher-form-actions"><button type="button" id="cancelParentMessage">Anulo</button><button class="teacher-primary-button" type="submit">Ruaj mesazhin</button></div></form>`;
    document.getElementById('cancelParentMessage').addEventListener('click', renderAssessmentDetail);
    document.getElementById('teacherParentMessageForm').addEventListener('submit', event => {
      event.preventDefault();
      renderAssessmentDetail();
    });
  }

  function openFinalGrade() {
    const period = academicPeriods.find(item => item.id === selectedAcademicPeriodId);
    const box = document.getElementById('teacherFolderDetail');
    box.innerHTML = `${detailHeading('Nota përfundimtare', 'Konfirmimi mbetet vetëm demonstrim në këtë prototip.')}<form class="teacher-composer" id="teacherFinalGradeForm"><div class="teacher-form-grid"><label>Nota<select><option>5 · Shkëlqyeshëm</option><option>4 · Shumë mirë</option><option>3 · Mirë</option><option>2 · Mjaftueshëm</option><option>1 · Pamjaftueshëm</option></select></label><label>Periudha<select disabled><option>${escapeHtml(period ? `${period.name} · ${period.school_year}` : 'Pa periudhë')}</option></select></label></div><label>Shënim opsional<textarea rows="4" placeholder="Përmbledhje e shkurtër për prindin"></textarea></label><div class="teacher-form-actions"><button type="button" id="cancelFinalGrade">Anulo</button><button class="teacher-primary-button" type="submit">Konfirmo notën</button></div></form>`;
    document.getElementById('cancelFinalGrade').addEventListener('click', renderAssessmentDetail);
    document.getElementById('teacherFinalGradeForm').addEventListener('submit', event => {
      event.preventDefault();
      renderAssessmentDetail();
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
    visible.forEach(message => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `teacher-message-preview${message.unread ? '' : ' read'}`;
      button.innerHTML = `<span class="unread-dot"></span><div><strong>${escapeHtml(message.parent)}</strong><p>${escapeHtml(message.subject)}</p><p>${escapeHtml(message.student)}</p></div><time>${escapeHtml(message.time)}</time>`;
      button.addEventListener('click', () => openMessage(message, button));
      list.appendChild(button);
    });
  }

  function openMessage(message, preview) {
    messages.forEach(item => { if (item.id === message.id) item.unread = false; });
    renderMessages();
    const detail = document.getElementById('teacherMessageDetail');
    detail.innerHTML = `<button class="teacher-back-button teacher-message-mobile-back" type="button">← Kthehu</button><div class="teacher-message-heading"><h2>${escapeHtml(message.subject)}</h2><p>${escapeHtml(message.parent)} · Prindi i ${escapeHtml(message.student)} · ${escapeHtml(message.time)}</p></div><div class="teacher-message-body"><p>${escapeHtml(message.body)}</p></div><form class="teacher-reply-box"><label class="sr-only" for="teacherReplyText">Përgjigjja</label><textarea id="teacherReplyText" placeholder="Shkruani përgjigjen..."></textarea><div><button class="teacher-primary-button" type="submit">Dërgo përgjigjen</button></div></form>`;
    detail.classList.add('mobile-open');
    detail.querySelector('.teacher-message-mobile-back').addEventListener('click', () => detail.classList.remove('mobile-open'));
    detail.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const textarea = detail.querySelector('textarea');
      if (!textarea.value.trim()) return;
      const reply = document.createElement('p');
      reply.textContent = `Ju: ${textarea.value.trim()}`;
      detail.querySelector('.teacher-message-body').appendChild(reply);
      textarea.value = '';
    });
    const active = [...document.querySelectorAll('.teacher-message-preview')].find(button => button.textContent.includes(message.subject));
    if (active) active.classList.add('active');
  }

  document.getElementById('teacherUnreadFilter').addEventListener('click', event => {
    unreadOnly = !unreadOnly;
    event.currentTarget.classList.toggle('active', unreadOnly);
    event.currentTarget.textContent = unreadOnly ? 'Shfaq të gjitha' : 'Vetëm të palexuarat';
    renderMessages();
  });

  document.getElementById('teacherSaveSettings').addEventListener('click', () => {
    const email = document.getElementById('teacherNotificationEmail').value.trim();
    document.getElementById('teacherSettingsStatus').textContent = email ? 'Cilësimet u ruajtën në këtë prototip.' : 'Shtoni email-in ku dëshironi të merrni njoftimet.';
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
    setData({ teacherName, teacherId, schoolId, subjects = [], academicPeriods: nextPeriods = [], students: nextStudents, moods = {} } = {}) {
      if (teacherName) {
        root.querySelectorAll('[data-teacher-name]').forEach(element => { element.textContent = teacherName; });
        const avatar = initials(teacherName);
        root.querySelectorAll('.teacher-account-avatar,.teacher-header-avatar').forEach(element => { element.textContent = avatar; });
      }
      if (Array.isArray(nextStudents) && nextStudents.length) {
        students = nextStudents.map(student => ({ ...student, mood: moods[student.name]?.mood || '' }));
        selectedStudent = students[0];
        renderStudents(document.getElementById('teacherStudentSearch').value);
      }
      materialContext = { teacherId: teacherId || materialContext.teacherId, schoolId: schoolId || materialContext.schoolId, subjects };
      academicPeriods = nextPeriods;
      selectedAcademicPeriodId = academicPeriods.find(period => period.status === 'active')?.id || academicPeriods[0]?.id || null;
      renderMaterialFormOptions();
      loadMaterialLibrary();
    }
  };
}
