import { recordAssistantPiaUpdate, saveAssistantPiaObjective } from '../services/teacherService.js';
import { formatSqDate } from '../utils/dates.js';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'AT';
}

function formatDate(value) {
  return formatSqDate(value, { includeTime: true });
}

function ratingLabel(rating) {
  return {
    1: 'Sapofilluar',
    2: 'Ne zhvillim',
    3: 'Po avancon',
    4: 'Shume afer',
    5: 'I arritur'
  }[Number(rating)] || 'Pa status';
}

const titles = {
  students: ['Femijet e caktuar', 'Nxenesit'],
  'student-folder': ['Dosja e nxenesit', 'Dosja'],
  'folder-detail': ['Historiku dhe mbeshtetja', 'Detajet'],
  pia: ['Plani Individual Arsimor', 'PIA']
};

export function initializeAssistantTeacherPrototype({ onLogout } = {}) {
  const root = document.getElementById('assistantTeacherPrototype');
  if (!root) return { setData() {} };

  let students = [];
  let selectedStudent = null;
  let moodHistories = {};
  let assistantName = 'Asistent';
  let piaObjectives = [];
  let piaUpdates = [];
  let piaStudentId = '';
  let editingObjectiveId = null;
  let updateObjectiveId = null;
  let piaStatus = '';
  let piaError = '';

  const panels = [...root.querySelectorAll('[data-assistant-panel]')];
  const navButtons = [...root.querySelectorAll('[data-assistant-view]')];
  const title = document.getElementById('assistantViewTitle');
  const kicker = document.getElementById('assistantViewKicker');
  const logoutDialog = document.getElementById('assistantTeacherLogoutDialog');

  function showPanel(name, updateNavigation = true) {
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.assistantPanel === name));
    if (updateNavigation) {
      navButtons.forEach(button => button.classList.toggle('active', button.dataset.assistantView === name));
    }
    if (titles[name]) {
      kicker.textContent = titles[name][0];
      title.textContent = titles[name][1];
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function studentsForQuery(query = '') {
    const normalized = query.trim().toLocaleLowerCase('sq');
    return students.filter(student => student.name.toLocaleLowerCase('sq').includes(normalized));
  }

  function objectiveUpdates(objectiveId) {
    return piaUpdates
      .filter(item => item.objective_id === objectiveId)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  }

  function objectivesForStudent(studentId) {
    return piaObjectives
      .filter(item => item.student_id === studentId)
      .sort((left, right) => {
        if (left.active !== right.active) return Number(right.active) - Number(left.active);
        return new Date(right.updated_at) - new Date(left.updated_at);
      });
  }

  function piaStudent() {
    return students.find(student => student.id === piaStudentId) || selectedStudent || students[0] || null;
  }

  function renderStudents(query = '') {
    const box = document.getElementById('assistantStudentGroups');
    const filtered = studentsForQuery(query);
    const groups = filtered.reduce((result, student) => {
      const className = student.className || 'Pa klase';
      (result[className] ||= []).push(student);
      return result;
    }, {});

    document.getElementById('assistantStudentTotal').textContent = `${filtered.length} nxenes`;
    box.innerHTML = '';
    if (!filtered.length) {
      box.innerHTML = '<p class="teacher-empty-students">Nuk u gjet asnje nxenes i caktuar.</p>';
      return;
    }

    Object.entries(groups).sort(([left], [right]) => left.localeCompare(right, 'sq')).forEach(([className, classStudents]) => {
      const group = document.createElement('section');
      group.className = 'teacher-class-group';
      group.innerHTML = `<button type="button" aria-expanded="true"><span class="teacher-class-chevron">^</span><strong>Klasa ${escapeHtml(className)}</strong><small>${classStudents.length} nxenes</small></button><div class="teacher-class-students"></div>`;
      const toggle = group.querySelector(':scope > button');
      toggle.addEventListener('click', () => {
        group.classList.toggle('collapsed');
        toggle.setAttribute('aria-expanded', String(!group.classList.contains('collapsed')));
      });

      const list = group.querySelector('.teacher-class-students');
      classStudents.forEach(student => {
        const row = document.createElement('article');
        row.className = 'teacher-student-row';
        row.innerHTML = `<span>${initials(student.name)}</span><div><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.supportSummary || 'Pa shenime shtese')}</small></div><p class="teacher-student-mood">${escapeHtml(student.mood || 'Pa gjendje te raportuar sot')}</p><button type="button">Hap</button>`;
        row.querySelector('button').addEventListener('click', () => openFolder(student));
        list.appendChild(row);
      });

      box.appendChild(group);
    });
  }

  function openFolder(student) {
    selectedStudent = student;
    piaStudentId = student.id;
    document.getElementById('assistantFolderAvatar').textContent = initials(student.name);
    document.getElementById('assistantFolderName').textContent = student.name;
    document.getElementById('assistantFolderMeta').textContent = `Klasa ${student.className || 'Pa klase'}`;
    showPanel('student-folder', false);
  }

  function detailHeading(titleText, description) {
    return `<div class="teacher-detail-heading"><h2>${escapeHtml(titleText)}</h2><p>${escapeHtml(description)}</p></div>`;
  }

  function renderHistoryDetail() {
    if (!selectedStudent) return;
    const history = moodHistories[selectedStudent.id] || [];
    const current = selectedStudent.mood
      ? `<article class="teacher-current-mood"><small>Sot</small><strong>${escapeHtml(selectedStudent.mood)}</strong><p>${escapeHtml(selectedStudent.moodComment || 'Pa koment shtese.')}</p></article>`
      : '<div class="teacher-detail-empty"><strong>Pa gjendje te raportuar sot</strong><p>Familja nuk ka derguar ende nje perditesim per sot.</p></div>';
    const previous = history.length
      ? `<div class="teacher-history-list">${history.map(item => `<article><time>${escapeHtml(formatDate(`${item.reported_on}T12:00:00`))}</time><strong>${escapeHtml(item.mood)}</strong><p>${escapeHtml(item.parent_comment || 'Pa koment shtese.')}</p></article>`).join('')}</div>`
      : '<div class="teacher-detail-empty"><strong>Historiku eshte bosh</strong><p>Nuk ka ende hyrje te meparshme.</p></div>';
    document.getElementById('assistantFolderDetail').innerHTML = `${detailHeading('Humori dhe historiku', `Vezhgimet ditore per ${selectedStudent.name}.`)}<div class="teacher-mood-summary">${current}${previous}</div>`;
    showPanel('folder-detail', false);
  }

  function renderSupportDetail() {
    if (!selectedStudent) return;
    const cards = [
      selectedStudent.supportSummary ? `<article><span>Permbledhja</span><p>${escapeHtml(selectedStudent.supportSummary)}</p></article>` : '',
      selectedStudent.preferredMode ? `<article><span>Menyra e preferuar</span><p>${escapeHtml(selectedStudent.preferredMode)}</p></article>` : '',
      selectedStudent.communicationLanguage ? `<article><span>Gjuha</span><p>${escapeHtml(selectedStudent.communicationLanguage)}</p></article>` : '',
      selectedStudent.communicationMethod ? `<article><span>Komunikimi</span><p>${escapeHtml(selectedStudent.communicationMethod)}</p></article>` : '',
      selectedStudent.accessibilityInformation ? `<article><span>Qasshmeria</span><p>${escapeHtml(selectedStudent.accessibilityInformation)}</p></article>` : '',
      selectedStudent.learningPreferences?.length ? `<article><span>Preferencat</span><p>${escapeHtml(selectedStudent.learningPreferences.join(', '))}</p></article>` : '',
      selectedStudent.additionalNotes ? `<article><span>Shenime shtese</span><p>${escapeHtml(selectedStudent.additionalNotes)}</p></article>` : ''
    ].filter(Boolean);
    document.getElementById('assistantFolderDetail').innerHTML = `${detailHeading('Mbeshtetja dhe komunikimi', 'Informacion i dobishem per punen e perditshme me nxenesin.')}<div class="teacher-preference-grid">${cards.join('') || '<div class="teacher-detail-empty"><strong>Pa te dhena shtese</strong><p>Nuk jane ruajtur ende preference ose shenime mbeshtetese.</p></div>'}</div>`;
    showPanel('folder-detail', false);
  }

  function objectiveCard(objective) {
    const updates = objectiveUpdates(objective.id);
    const latest = updates[0];
    const history = updates.slice(0, 3);
    return `
      <article class="assistant-pia-card">
        <div class="assistant-pia-card-head">
          <div class="assistant-pia-card-copy">
            <span class="assistant-pia-badge${objective.active ? '' : ' muted'}">${objective.active ? 'Objektiv aktiv' : 'Objektiv i mbyllur'}</span>
            <h3>${escapeHtml(objective.title)}</h3>
            <p>${escapeHtml(objective.details || 'Pa pershkrim shtese.')}</p>
          </div>
          <div class="assistant-pia-score-pill">${latest ? `${latest.rating}/5` : '--'}</div>
        </div>

        <div class="assistant-pia-meta">
          <article><span>Perditesuar</span><strong>${escapeHtml(formatDate(objective.updated_at || objective.created_at))}</strong></article>
          <article><span>Statusi i fundit</span><strong>${latest ? escapeHtml(ratingLabel(latest.rating)) : 'Pa status ende'}</strong></article>
        </div>

        ${latest ? `
          <div class="assistant-pia-latest">
            <small>${escapeHtml(formatDate(latest.created_at))}</small>
            <strong>${escapeHtml(ratingLabel(latest.rating))}</strong>
            <p>${escapeHtml(latest.comment)}</p>
          </div>
        ` : '<div class="teacher-detail-empty"><strong>Pa raportim ende</strong><p>Shtoni statusin e objektives dhe nje koment per familjen.</p></div>'}

        <div class="assistant-pia-actions">
          <button class="assistant-pia-primary-action" type="button" data-assistant-add-update="${objective.id}">Dergo perditesim</button>
          <div class="assistant-pia-secondary-actions">
            <button type="button" data-assistant-edit-objective="${objective.id}">Ndrysho</button>
            <button type="button" data-assistant-toggle-objective="${objective.id}">${objective.active ? 'Mbyll' : 'Rihap'}</button>
          </div>
        </div>

        ${history.length ? `
          <div class="assistant-pia-timeline">
            ${history.map(item => `
              <article>
                <time>${escapeHtml(formatDate(item.created_at))}</time>
                <strong>${item.rating}/5 - ${escapeHtml(ratingLabel(item.rating))}</strong>
                <p>${escapeHtml(item.comment)}</p>
              </article>
            `).join('')}
          </div>
        ` : ''}
      </article>
    `;
  }

  function renderPiaPanel() {
    const target = document.getElementById('assistantPiaContent');
    const student = piaStudent();

    if (!student) {
      target.innerHTML = '<div class="teacher-detail-empty"><strong>Pa nxenes te caktuar</strong><p>Sapo te caktohet nje nxenes, ketu do te shfaqet paneli PIA.</p></div>';
      return;
    }

    piaStudentId = student.id;
    const objectives = objectivesForStudent(student.id);
    const activeObjectives = objectives.filter(item => item.active).length;
    const latestUpdate = objectives
      .map(item => objectiveUpdates(item.id)[0])
      .filter(Boolean)
      .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))[0] || null;
    const editingObjective = editingObjectiveId && editingObjectiveId !== 'new'
      ? piaObjectives.find(item => item.id === editingObjectiveId && item.student_id === student.id)
      : null;
    const updateObjective = (
      (updateObjectiveId
        ? piaObjectives.find(item => item.id === updateObjectiveId && item.student_id === student.id)
        : null)
      || objectives.find(item => item.active)
      || objectives[0]
      || null
    );
    updateObjectiveId = updateObjective?.id || null;

    target.innerHTML = `
      <section class="assistant-pia-shell">
        <div class="assistant-pia-hero">
          <div class="assistant-pia-hero-copy">
            <span class="assistant-pia-kicker">Plan i vecante i asistences</span>
            <h2>${escapeHtml(student.name)}</h2>
            <p>Ruani objektiva te ndara nga vleresimi, ndiqni statusin e tyre me nje pamje te qarte dhe dergoni komente te shkurtra per familjen.</p>
          </div>
          <div class="assistant-pia-student-switcher">
            <label>Nxenesi
              <select id="assistantPiaStudentSelect">
                ${students.map(item => `<option value="${item.id}"${item.id === student.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>

        <div class="assistant-pia-overview">
          <article><span>Klasa</span><strong>${escapeHtml(student.className || 'Pa klase')}</strong></article>
          <article><span>Objektiva aktive</span><strong>${activeObjectives}</strong></article>
          <article><span>Raportimi i fundit</span><strong>${latestUpdate ? escapeHtml(formatDate(latestUpdate.created_at)) : 'Pa raportim'}</strong></article>
          <article><span>Qasshmeria</span><strong>${escapeHtml(student.accessibilityInformation || 'Pa shenime')}</strong></article>
        </div>

        <div class="assistant-pia-layout">
          <div class="assistant-pia-column">
            <section class="assistant-pia-panel">
              <div class="assistant-pia-panel-head">
                <div>
                  <span class="assistant-pia-kicker">${editingObjectiveId ? 'Ndrysho objektivin' : 'Objektiv i ri'}</span>
                  <h3>${editingObjectiveId ? 'Perditeso objektivin PIA' : 'Shto objektiv PIA'}</h3>
                </div>
                ${editingObjectiveId ? '<button type="button" id="assistantCancelObjectiveEdit">Anulo</button>' : '<button type="button" id="assistantStartObjectiveCreate">Objektiv i ri</button>'}
              </div>
              <form class="assistant-pia-form" id="assistantPiaObjectiveForm">
                <label>Objektivi
                  <input id="assistantPiaObjectiveTitle" type="text" maxlength="160" required value="${escapeHtml(editingObjective?.title || '')}" placeholder="P.sh. Te ndjeke udhezimin me dy hapa">
                </label>
                <label>Pershkrimi ose kriteret
                  <textarea id="assistantPiaObjectiveDetails" rows="5" maxlength="2000" placeholder="Shkruani si do te ndiqet progresi dhe cfare pritet.">${escapeHtml(editingObjective?.details || '')}</textarea>
                </label>
                <label class="teacher-check-row">
                  <input id="assistantPiaObjectiveActive" type="checkbox"${editingObjectiveId ? (editingObjective?.active ? ' checked' : '') : ' checked'}>
                  Objektiv aktiv
                </label>
                <p class="teacher-save-status${piaError ? ' error' : ''}" id="assistantPiaStatus">${escapeHtml(piaError || piaStatus)}</p>
                <div class="teacher-form-actions">
                  <button class="teacher-primary-button" type="submit">${editingObjectiveId ? 'Ruaj ndryshimet' : 'Ruaj objektivin'}</button>
                </div>
              </form>
            </section>

            <section class="assistant-pia-panel assistant-pia-panel-muted">
              <div class="assistant-pia-panel-head">
                <div>
                  <span class="assistant-pia-kicker">Kontekst i shpejte</span>
                  <h3>Per familjen dhe diten e sotme</h3>
                </div>
              </div>
              <div class="assistant-pia-context">
                <article><span>Permbledhja</span><p>${escapeHtml(student.supportSummary || 'Pa permbledhje te ruajtur')}</p></article>
                <article><span>Komunikimi</span><p>${escapeHtml(student.communicationMethod || student.communicationLanguage || 'Pa preferenca te ruajtura')}</p></article>
              </div>
            </section>

            ${updateObjective ? `
              <section class="assistant-pia-panel assistant-pia-panel-strong">
                <div class="assistant-pia-panel-head">
                  <div>
                    <span class="assistant-pia-kicker">Statusi dhe komenti</span>
                    <h3>Perditesim per familjen</h3>
                  </div>
                </div>
                <form class="assistant-pia-form" id="assistantPiaUpdateForm">
                  <label>Objektivi
                    <select id="assistantPiaUpdateObjective" required>
                      ${objectives.map(item => `<option value="${item.id}"${item.id === updateObjective.id ? ' selected' : ''}>${escapeHtml(item.title)}${item.active ? '' : ' (i mbyllur)'}</option>`).join('')}
                    </select>
                  </label>
                  <label>Statusi i objektives
                    <select id="assistantPiaUpdateRating" required>
                      <option value="5">5 - I arritur</option>
                      <option value="4">4 - Shume afer</option>
                      <option value="3" selected>3 - Po avancon</option>
                      <option value="2">2 - Ne zhvillim</option>
                      <option value="1">1 - Sapofilluar</option>
                    </select>
                  </label>
                  <label>Komenti per prindin
                    <textarea id="assistantPiaUpdateComment" rows="4" maxlength="2000" required placeholder="Shkruani cfare u vu re sot, cfare funksionoi dhe ku ndodhet femija me kete objektiv."></textarea>
                  </label>
                  <p class="teacher-save-status" id="assistantPiaUpdateStatus"></p>
                  <div class="teacher-form-actions">
                    <button class="teacher-primary-button" type="submit">Ruaj statusin dhe dergo komentin</button>
                  </div>
                </form>
              </section>
            ` : `
              <section class="assistant-pia-panel assistant-pia-panel-strong">
                <div class="teacher-detail-empty"><strong>Shtoni nje objektiv fillimisht</strong><p>Pasi te krijoni objektivin e pare, ketu do te shfaqet forma per statusin dhe komentin ndaj familjes.</p></div>
              </section>
            `}
          </div>

          <div class="assistant-pia-column">
            <section class="assistant-pia-panel assistant-pia-panel-list">
              <div class="assistant-pia-panel-head">
                <div>
                  <span class="assistant-pia-kicker">Objektivat</span>
                  <h3>Lista e punes</h3>
                </div>
              </div>
              <div class="assistant-pia-card-list">
                ${objectives.length ? objectives.map(objectiveCard).join('') : '<div class="teacher-detail-empty"><strong>Pa objektiva ende</strong><p>Shtoni objektivin e pare PIA per kete nxenes.</p></div>'}
              </div>
            </section>
          </div>
        </div>
      </section>
    `;

    document.getElementById('assistantPiaStudentSelect').addEventListener('change', event => {
      piaStudentId = event.target.value;
      selectedStudent = students.find(item => item.id === piaStudentId) || selectedStudent;
      editingObjectiveId = null;
      updateObjectiveId = null;
      piaStatus = '';
      piaError = '';
      renderPiaPanel();
    });

    document.getElementById('assistantStartObjectiveCreate')?.addEventListener('click', () => {
      editingObjectiveId = 'new';
      piaStatus = '';
      piaError = '';
      renderPiaPanel();
    });

    document.getElementById('assistantCancelObjectiveEdit')?.addEventListener('click', () => {
      editingObjectiveId = null;
      piaStatus = '';
      piaError = '';
      renderPiaPanel();
    });

    target.querySelectorAll('[data-assistant-edit-objective]').forEach(button => button.addEventListener('click', () => {
      editingObjectiveId = button.dataset.assistantEditObjective;
      updateObjectiveId = null;
      piaStatus = '';
      piaError = '';
      renderPiaPanel();
    }));

    target.querySelectorAll('[data-assistant-toggle-objective]').forEach(button => button.addEventListener('click', async () => {
      const objective = piaObjectives.find(item => item.id === button.dataset.assistantToggleObjective);
      if (!objective) return;
      button.disabled = true;
      piaStatus = '';
      piaError = '';
      try {
        const saved = await saveAssistantPiaObjective({
          objectiveId: objective.id,
          studentId: objective.student_id,
          title: objective.title,
          details: objective.details,
          active: !objective.active
        });
        piaObjectives = [saved, ...piaObjectives.filter(item => item.id !== saved.id)];
        editingObjectiveId = null;
        piaStatus = saved.active ? 'Objektivi u rihap.' : 'Objektivi u mbyll.';
      } catch (error) {
        piaError = error.message || 'Objektivi nuk u ruajt.';
      } finally {
        renderPiaPanel();
      }
    }));

    target.querySelectorAll('[data-assistant-add-update]').forEach(button => button.addEventListener('click', () => {
      updateObjectiveId = button.dataset.assistantAddUpdate;
      piaStatus = '';
      piaError = '';
      renderPiaPanel();
    }));

    document.getElementById('assistantPiaObjectiveForm').addEventListener('submit', async event => {
      event.preventDefault();
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      submitButton.disabled = true;
      piaStatus = '';
      piaError = '';
      try {
        const saved = await saveAssistantPiaObjective({
          objectiveId: editingObjectiveId === 'new' ? null : editingObjectiveId,
          studentId: student.id,
          title: document.getElementById('assistantPiaObjectiveTitle').value,
          details: document.getElementById('assistantPiaObjectiveDetails').value,
          active: document.getElementById('assistantPiaObjectiveActive').checked
        });
        piaObjectives = [saved, ...piaObjectives.filter(item => item.id !== saved.id)];
        editingObjectiveId = null;
        piaStatus = 'Objektivi u ruajt.';
      } catch (error) {
        piaError = error.message || 'Objektivi nuk u ruajt.';
      } finally {
        renderPiaPanel();
      }
    });

    document.getElementById('assistantPiaUpdateObjective')?.addEventListener('change', event => {
      updateObjectiveId = event.target.value;
      renderPiaPanel();
    });

    document.getElementById('assistantPiaUpdateForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const submitButton = event.currentTarget.querySelector('[type="submit"]');
      const status = document.getElementById('assistantPiaUpdateStatus');
      submitButton.disabled = true;
      status.textContent = '';
      try {
        const saved = await recordAssistantPiaUpdate({
          objectiveId: document.getElementById('assistantPiaUpdateObjective').value,
          rating: document.getElementById('assistantPiaUpdateRating').value,
          comment: document.getElementById('assistantPiaUpdateComment').value
        });
        piaUpdates = [saved, ...piaUpdates.filter(item => item.id !== saved.id)];
        piaObjectives = piaObjectives.map(item => item.id === saved.objective_id ? { ...item, updated_at: saved.created_at } : item);
        updateObjectiveId = saved.objective_id;
        piaStatus = 'Statusi dhe komenti iu derguan familjes ne aplikacion.';
        piaError = '';
      } catch (error) {
        status.textContent = error.message || 'Statusi dhe komenti nuk u derguan.';
        submitButton.disabled = false;
        return;
      }
      renderPiaPanel();
    });
  }

  navButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.assistantView === 'pia') renderPiaPanel();
    showPanel(button.dataset.assistantView);
  }));

  document.getElementById('assistantStudentSearch').addEventListener('input', event => renderStudents(event.target.value));
  document.getElementById('assistantFolderBack').addEventListener('click', () => showPanel('students'));
  document.getElementById('assistantDetailBack').addEventListener('click', () => openFolder(selectedStudent));
  root.querySelectorAll('[data-assistant-detail]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.assistantDetail === 'history') renderHistoryDetail();
      if (button.dataset.assistantDetail === 'support') renderSupportDetail();
      if (button.dataset.assistantDetail === 'pia') {
        renderPiaPanel();
        showPanel('pia');
      }
    });
  });

  root.querySelectorAll('[data-assistant-logout]').forEach(button => button.addEventListener('click', () => {
    logoutDialog.returnValue = 'cancel';
    logoutDialog.showModal();
  }));
  logoutDialog.addEventListener('click', event => {
    if (event.target === logoutDialog) logoutDialog.close('cancel');
  });
  logoutDialog.addEventListener('close', () => {
    if (logoutDialog.returnValue === 'confirm') onLogout?.();
  });

  return {
    setData({ assistantTeacherName, students: nextStudents = [], moods = {}, moodHistories: nextMoodHistories = {}, piaObjectives: nextObjectives = [], piaUpdates: nextUpdates = [] } = {}) {
      assistantName = assistantTeacherName || assistantName;
      root.querySelectorAll('[data-assistant-name]').forEach(element => {
        element.textContent = assistantName;
      });
      const avatar = initials(assistantName);
      root.querySelectorAll('.teacher-account-avatar,.teacher-header-avatar').forEach(element => {
        element.textContent = avatar;
      });

      const previousSelectedStudentId = selectedStudent?.id;
      students = Array.isArray(nextStudents) ? nextStudents.map(student => ({
        ...student,
        mood: moods[student.name]?.mood || '',
        moodComment: moods[student.name]?.comment || ''
      })) : [];
      moodHistories = nextMoodHistories;
      piaObjectives = Array.isArray(nextObjectives) ? nextObjectives.map(item => ({ ...item })) : [];
      piaUpdates = Array.isArray(nextUpdates) ? nextUpdates.map(item => ({ ...item })) : [];
      selectedStudent = students.find(student => student.id === previousSelectedStudentId) || students[0] || null;
      piaStudentId = students.some(student => student.id === piaStudentId) ? piaStudentId : (selectedStudent?.id || '');
      editingObjectiveId = piaObjectives.some(item => item.id === editingObjectiveId) ? editingObjectiveId : null;
      updateObjectiveId = piaObjectives.some(item => item.id === updateObjectiveId) ? updateObjectiveId : null;
      document.getElementById('assistantStudentSearch').value = '';
      renderStudents();
      renderPiaPanel();
      showPanel('students');
    }
  };
}
