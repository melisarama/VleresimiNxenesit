import { supabaseClient } from './lib/supabaseClient.js';
import { todayIso } from './utils/dates.js';
import { escapeHtml } from './utils/html.js';
import { noticeHistoryMarkup, readParentNotice, writeParentNotice } from './utils/notices.js';
import { moodData, parentMoodIcons, parentMoods, preferences, scores, subjects } from './data/staticData.js';
import { fetchParentDashboardData, fetchParentStudentMapping } from './services/parentService.js';
import { initializeAdminWorkflow } from './admin/admin.js';
import { initializeAccountSetup } from './auth/accountSetup.js';
import { fetchTeacherDashboardData } from './services/teacherService.js';
import { initializeTeacherPrototype } from './teacher/teacherPrototype.js';

    let currentUser=null;
    let currentTeacherId=null;
    let activeSubjectId=null;
    let activeAcademicPeriodId=null;
    const teacherNoticeRows=[];
    const parentTeacherNotices=[];
    const parentNoticeReplies=[];
    function userMessage(error,fallback='Nuk mund të lidhemi me të dhënat. Provoni përsëri.'){ console.warn(fallback,error); return fallback; }
    async function verifySupabaseConnection(){ const status=document.getElementById('databaseStatus'); try { const {error}=await supabaseClient.auth.getSession(); if(error) throw error; status.classList.remove('error'); status.textContent='✓ Baza e të dhënave u lidh në mënyrë të sigurt.'; } catch(error) { status.classList.add('error'); status.textContent='Lidhja me bazën e të dhënave nuk u verifikua. Rifreskoni faqen.'; console.warn('Supabase connection:',error.message); } }
    verifySupabaseConnection();
    initializeAccountSetup();
    initializeAdminWorkflow();
    const teacherPrototype=initializeTeacherPrototype({onLogout:async()=>{ await supabaseClient.auth.signOut(); document.getElementById('teacherApp').classList.add('hidden'); document.getElementById('roleGate').classList.remove('hidden'); }});
    document.getElementById('teacherRole').onclick=()=>{ document.getElementById('roleGate').classList.add('hidden'); document.getElementById('teacherLogin').classList.remove('hidden'); };
    document.getElementById('parentRole').onclick=()=>{ document.getElementById('roleGate').classList.add('hidden'); document.getElementById('parentPage').classList.remove('hidden'); };
    document.getElementById('backToRoles').onclick=()=>{ document.getElementById('parentPage').classList.add('hidden'); document.getElementById('roleGate').classList.remove('hidden'); };
    document.getElementById('backToRolesTeacher').onclick=()=>{ document.getElementById('teacherLogin').classList.add('hidden'); document.getElementById('roleGate').classList.remove('hidden'); };
    document.getElementById('teacherPasswordToggle').onclick=()=>{ const field=document.getElementById('teacherPassword'); const button=document.getElementById('teacherPasswordToggle'); const visible=field.type==='text'; field.type=visible?'password':'text'; button.textContent=visible?'◉':'◌'; button.setAttribute('aria-label',visible?'Shfaq fjalëkalimin':'Fshih fjalëkalimin'); };
    document.getElementById('parentPasswordToggle').onclick=()=>{ const field=document.getElementById('parentPassword'); const button=document.getElementById('parentPasswordToggle'); const visible=field.type==='text'; field.type=visible?'password':'text'; button.textContent=visible?'◉':'◌'; button.setAttribute('aria-label',visible?'Shfaq fjalëkalimin':'Fshih fjalëkalimin'); };

    const studentBox = document.getElementById('studentList');
    const todayStudentBox = document.getElementById('todayStudentList');
    const storedStudents = [];
    const dailyMoods = {};
    const moodHistory = {};
    function updateTeacherClock(){
      const now=new Date();
      const weekdays=['E diel','E hënë','E martë','E mërkurë','E enjte','E premte','E shtunë'];
      const months=['Janar','Shkurt','Mars','Prill','Maj','Qershor','Korrik','Gusht','Shtator','Tetor','Nëntor','Dhjetor'];
      const hour=now.getHours();
      const displayHour=String(hour%12||12).padStart(2,'0');
      const minute=String(now.getMinutes()).padStart(2,'0');
      const clock=document.getElementById('teacherTodayDate');
      clock.dateTime=now.toISOString();
      clock.textContent=weekdays[now.getDay()]+', '+now.getDate()+' '+months[now.getMonth()]+' '+now.getFullYear()+', '+displayHour+':'+minute+' '+(hour<12?'AM':'PM');
    }
    updateTeacherClock();
    setInterval(updateTeacherClock,60000);
    const chaptersBySubject = {};
    const gradeHistoryByChapter = {};
    let activeStudent = 0;
    let activePreference = 'writing';
    let activeMood = 'calm';
    let activeSubject = 'Matematikë';
    const subjectBox = document.getElementById('subjects');
    subjects.forEach((subject,index) => { const button=document.createElement('button'); button.className='subject'+(!index?' active':''); button.textContent=subject; button.addEventListener('click',()=>{ document.querySelectorAll('.subject').forEach(x=>x.classList.remove('active')); button.classList.add('active'); activeSubject=subject; document.getElementById('subjectLabel').textContent=subject; const value=scores[subject]; document.getElementById('score').innerHTML=value[0]+' <span>/ 5</span>'; document.getElementById('scoreDetail').textContent=value[1]; renderChapters(); }); subjectBox.appendChild(button); });
    function setTeacherSubject(subject){ activeSubject=subject; document.querySelectorAll('.subject').forEach(button=>{ const selected=button.textContent===subject; button.style.display=selected?'block':'none'; button.classList.toggle('active',selected); }); document.getElementById('subjectLabel').textContent=subject; const value=scores[subject]; document.getElementById('score').innerHTML=value[0]+' <span>/ 5</span>'; document.getElementById('scoreDetail').textContent=value[1]; document.getElementById('teacherSubjectBadge').textContent='📘 '+subject; renderChapters(); }
    async function loadTeacherData(user){
      currentUser=user;
      currentTeacherId=user.id;
      const {profileResult,subjectResult,studentResult,supportResult,chapterResult,gradeResult,moodResult,teacherNoticeResult,parentNoticeResult,parentReplyResult,finalGradeResult,preferenceResult,periodResult}=await fetchTeacherDashboardData(user.id);
      if(profileResult.error) throw profileResult.error;
      if(studentResult.error) throw studentResult.error;
      if(subjectResult.error) throw subjectResult.error;
      if(periodResult.error) throw periodResult.error;
      if(parentNoticeResult.error) throw parentNoticeResult.error;
      if(parentReplyResult.error) throw parentReplyResult.error;
      if(finalGradeResult.error) throw finalGradeResult.error;
      if(preferenceResult.error) throw preferenceResult.error;
      const firstSubject=subjectResult.data&&subjectResult.data[0];
      const subjectName=firstSubject&&firstSubject.subjects?firstSubject.subjects.name:'Matematikë';
      activeSubjectId=firstSubject&&firstSubject.subjects?firstSubject.subjects.id:firstSubject?firstSubject.subject_id:null;
      const supportByStudent=Object.fromEntries((supportResult.data||[]).map(item=>[item.student_id,item]));
      storedStudents.splice(0,storedStudents.length,...(studentResult.data||[]).map(item=>{const support=supportByStudent[item.id]||{}; return {id:item.id,class_id:item.class_id,className:item.class_name||'Pa klasë',schoolYear:item.classes?.school_year||'',name:item.first_name+' '+item.last_name,support:support.support_summary||'Pa mbështetje të shënuar',supportSummary:support.support_summary||'',preferredMode:support.preferences?.preferred_mode||'',accessibilityInformation:support.accessibility_information||'',detail:support.support_summary||'',icon:'📋'};}));
      Object.keys(dailyMoods).forEach(key=>delete dailyMoods[key]);
      Object.keys(moodHistory).forEach(key=>delete moodHistory[key]);
      (moodResult.data||[]).forEach(item=>{const student=storedStudents.find(row=>row.id===item.student_id); if(student){ if(!dailyMoods[student.name]) dailyMoods[student.name]={mood:item.mood,comment:item.parent_comment||''}; if(!moodHistory[student.name]) moodHistory[student.name]=[]; moodHistory[student.name].push({date:item.reported_on,mood:item.mood,comment:item.parent_comment||''}); }});
      const chapterRows=(chapterResult.data||[]).filter(item=>item.subject_id===activeSubjectId||(item.subjects&&item.subjects.name===subjectName));
      chaptersBySubject[subjectName]=chapterRows.map(chapter=>{const grades=(gradeResult.data||[]).filter(item=>item.chapter_id===chapter.id); const score=grades.length?grades.reduce((sum,item)=>sum+Number(item.score),0)/grades.length:0; return {id:chapter.id,subject_id:chapter.subject_id,name:chapter.name,score};});
      teacherNoticeRows.splice(0,teacherNoticeRows.length,...(teacherNoticeResult.data||[]));
      const academicPeriods=periodResult.data||[];
      activeAcademicPeriodId=academicPeriods.find(item=>item.status==='active')?.id||null;
      const repliesByNotice=(parentReplyResult.data||[]).reduce((result,item)=>{(result[item.notice_id]||=[]).push(item);return result;},{});
      const parentMessages=(parentNoticeResult.data||[]).map(item=>{const student=item.students; const studentName=student?student.first_name+' '+student.last_name:'Nxënësi'; return {id:item.id,unread:!item.read_at,parent:'Prindi',student:studentName,subject:item.subjects?.name?`Mesazh për ${item.subjects.name}`:'Mesazh nga prindi',time:new Intl.DateTimeFormat('sq-AL',{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.created_at)),body:item.comment,replies:repliesByNotice[item.id]||[]};});
      const today=new Date().toLocaleDateString('en-CA');
      const todayMoods={};
      (moodResult.data||[]).filter(item=>item.reported_on===today).forEach(item=>{const student=storedStudents.find(row=>row.id===item.student_id); if(student&&!todayMoods[student.name]) todayMoods[student.name]={mood:item.mood,comment:item.parent_comment||''};});
      const teacherFullName=profileResult.data.first_name+' '+profileResult.data.last_name;
      document.getElementById('teacherName').textContent=teacherFullName;
      document.getElementById('teacherWelcomeName').textContent=teacherFullName;
      teacherPrototype.setData({teacherName:teacherFullName,teacherEmail:user.email||'',teacherId:user.id,schoolId:profileResult.data.school_id,subjects:(subjectResult.data||[]).map(item=>item.subjects||{id:item.subject_id,name:'Lënda'}),academicPeriods,students:storedStudents,moods:todayMoods,messages:parentMessages,chapters:chapterResult.data||[],assessments:gradeResult.data||[],finalGrades:finalGradeResult.data||[],preferences:preferenceResult.data});
      setTeacherSubject(subjectName);
      renderStudents(); renderEvaluationFolders(); renderDailyMoods();
    }
    document.getElementById('continueTeacher').onclick=async()=>{ const email=document.getElementById('teacherEmail').value.trim(); const password=document.getElementById('teacherPassword').value; const status=document.getElementById('teacherLoginStatus'); if(!email||!password){status.textContent='Shkruani email-in dhe fjalëkalimin.';return;} status.textContent='Duke u kyçur…'; const {data,error}=await supabaseClient.auth.signInWithPassword({email,password}); if(error){status.textContent='Hyrja dështoi: '+error.message;return;} try {await loadTeacherData(data.user); const phone=document.getElementById('appPhone'); clearStudentFolderModes(phone); phone.classList.add('no-selection','registry-only'); phone.classList.remove('student-selected','support-active','evaluation-active'); resetTeacherHistory(); document.getElementById('teacherLogin').classList.add('hidden'); document.getElementById('teacherApp').classList.remove('hidden'); document.getElementById('todayToggle').click();} catch(error){await supabaseClient.auth.signOut();status.textContent='Kjo llogari nuk është e autorizuar si mësimdhënës.';} };
    function showStudent(student){ const initials=student.name.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase(); const note=dailyMoods[student.name]; const classLabel='Klasa '+(student.className||'e pacaktuar'); document.querySelector('#teacherApp header .profile h1').textContent=student.name; document.querySelector('#teacherApp header .profile .avatar').textContent=initials; document.getElementById('profileSubtitle').textContent=classLabel+' · '+student.support; document.getElementById('selectedName').textContent=student.name; document.getElementById('selectedInitials').textContent=initials; document.getElementById('selectedSupport').textContent=classLabel+' · '+student.support; document.getElementById('selectedMood').textContent=note ? note.mood+' · Njoftim nga prindi' : 'Pa njoftim nga prindi sot'; document.getElementById('todayMoodHeading').textContent='Si është '+student.name.split(' ')[0]+' sot?'; document.getElementById('moodStatus').textContent='Zgjidhni një gjendje'; document.querySelectorAll('.mood').forEach(button=>{ button.classList.remove('active'); button.setAttribute('aria-pressed','false'); }); document.getElementById('supportTitle').textContent=student.support; document.getElementById('supportDetail').textContent=student.detail || 'Profil i ri; plotësohet nga stafi i autorizuar.'; document.getElementById('supportIcon').textContent=student.icon || '📋'; }
    const studentFolderModes=['folder-dashboard-active','folder-summary-view','folder-academic-view','folder-health-view'];
    function clearStudentFolderModes(phone=document.getElementById('appPhone')){ phone.classList.remove(...studentFolderModes); }
    function clearGradingState(phone=document.getElementById('appPhone')){ phone.classList.remove('grading-active'); document.getElementById('gradingContent').classList.remove('show'); document.getElementById('gradePanel').classList.remove('show'); document.getElementById('showGrade').style.display='block'; }
    function resetStudentWorkHeader(){ document.querySelector('.student-work-header h2').textContent='Puna me nxënësin'; document.querySelector('.student-work-header p').textContent='Të dhënat dhe vlerësimi i nxënësit të zgjedhur'; document.getElementById('backToRegistry').textContent='Regjistri'; }
    function setTeacherNavigation(activeId){ ['todayToggle','registryToggle','supportToggle','evaluationToggle'].forEach(id=>document.getElementById(id).classList.toggle('active',id===activeId)); }
    const teacherHistory=[];
    let teacherHistoryIndex=-1;
    let teacherHistoryPaused=false;
    function updateTeacherHistoryArrows(){ const backDisabled=teacherHistoryIndex<=0; const forwardDisabled=teacherHistoryIndex<0||teacherHistoryIndex>=teacherHistory.length-1; document.getElementById('teacherBack').disabled=backDisabled; document.getElementById('teacherForward').disabled=forwardDisabled; document.getElementById('studentFolderBack').disabled=backDisabled; document.getElementById('studentFolderForward').disabled=forwardDisabled; }
    function captureTeacherView(){
      const phone=document.getElementById('appPhone');
      let view='today';
      if(phone.classList.contains('grading-active')) view='grading';
      else if(phone.classList.contains('folder-dashboard-active')) view='folder';
      else if(phone.classList.contains('folder-summary-view')) view='folder-summary';
      else if(phone.classList.contains('folder-academic-view')) view='folder-academic';
      else if(phone.classList.contains('folder-health-view')) view='folder-health';
      else if(phone.classList.contains('support-active')) view='support';
      else if(phone.classList.contains('evaluation-active')) view=document.getElementById('evaluationPanel').classList.contains('analytics-open')?'evaluation-detail':'evaluation';
      else if(phone.classList.contains('students-view')) view='registry';
      else if(phone.classList.contains('student-selected')) view='today-student';
      return {view,student:activeStudent};
    }
    function recordTeacherView(){
      if(teacherHistoryPaused) return;
      const entry=captureTeacherView();
      const current=teacherHistory[teacherHistoryIndex];
      if(current&&current.view===entry.view&&current.student===entry.student){ updateTeacherHistoryArrows(); return; }
      teacherHistory.splice(teacherHistoryIndex+1);
      teacherHistory.push(entry);
      teacherHistoryIndex=teacherHistory.length-1;
      updateTeacherHistoryArrows();
    }
    function resetTeacherHistory(){ teacherHistory.length=0; teacherHistoryIndex=-1; updateTeacherHistoryArrows(); }
    function withoutTeacherHistory(action){ const previous=teacherHistoryPaused; teacherHistoryPaused=true; try { action(); } finally { teacherHistoryPaused=previous; } }
    function restoreTeacherView(entry){
      if(!entry) return;
      withoutTeacherHistory(()=>{
        const phone=document.getElementById('appPhone');
        const student=storedStudents[entry.student];
        activeStudent=entry.student;
        clearGradingState(phone);
        if(student){ showStudent(student); renderStudents(); renderDailyMoods(); }
        if(entry.view==='today'){
          phone.classList.remove('student-selected');
          phone.classList.add('no-selection','registry-only');
          document.getElementById('todayToggle').click();
        } else if(entry.view==='today-student'){
          phone.classList.remove('no-selection','registry-only');
          phone.classList.add('student-selected');
          document.getElementById('todayToggle').click();
        } else if(entry.view==='registry'){
          phone.classList.remove('student-selected');
          phone.classList.add('no-selection','registry-only');
          document.getElementById('registryToggle').click();
        } else if(entry.view==='folder') openStudentFolder(student);
        else if(entry.view.startsWith('folder-')) openStudentFolderDetail(entry.view.replace('folder-',''));
        else if(entry.view==='support') document.getElementById('supportToggle').click();
        else if(entry.view==='evaluation') document.getElementById('evaluationToggle').click();
        else if(entry.view==='evaluation-detail'){
          document.getElementById('evaluationToggle').click();
          showEvaluationAnalytics(student);
        } else if(entry.view==='grading'){
          openStudentFolderDetail('academic');
          phone.classList.add('grading-active');
          document.getElementById('gradingContent').classList.add('show');
        }
      });
      updateTeacherHistoryArrows();
      window.scrollTo({top:0,behavior:'smooth'});
    }
    function teacherGoBack(){ if(teacherHistoryIndex<=0) return false; teacherHistoryIndex--; restoreTeacherView(teacherHistory[teacherHistoryIndex]); return true; }
    function teacherGoForward(){ if(teacherHistoryIndex>=teacherHistory.length-1) return false; teacherHistoryIndex++; restoreTeacherView(teacherHistory[teacherHistoryIndex]); return true; }
    function renderStudentFolder(student){ const initials=student.name.split(' ').filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase(); document.getElementById('studentFolderInitials').textContent=initials; document.getElementById('studentFolderName').textContent=student.name; document.getElementById('studentFolderClass').textContent='Klasa '+(student.className||'e pacaktuar'); }
    function openStudentFolder(student=storedStudents[activeStudent]){
      if(!student) return;
      const phone=document.getElementById('appPhone');
      clearStudentFolderModes(phone);
      clearGradingState(phone);
      phone.classList.remove('no-selection','registry-only','today-view','support-active','evaluation-active');
      phone.classList.add('student-selected','students-view','folder-dashboard-active');
      document.getElementById('registry').classList.remove('show');
      document.getElementById('evaluationPanel').classList.remove('analytics-open');
      resetStudentWorkHeader();
      renderStudentFolder(student);
      setTeacherNavigation('registryToggle');
      recordTeacherView();
      window.scrollTo({top:0,behavior:'smooth'});
    }
    function openStudentFolderDetail(mode){
      const student=storedStudents[activeStudent];
      if(!student) return;
      const phone=document.getElementById('appPhone');
      clearStudentFolderModes(phone);
      clearGradingState(phone);
      phone.classList.remove('no-selection','registry-only','today-view','support-active','evaluation-active');
      phone.classList.add('student-selected','students-view','folder-'+mode+'-view');
      const titles={summary:['Përmbledhja','Humori, preferencat dhe komunikimi'],academic:['Akademia & Notat','Kapitujt, notat dhe vlerësimi'],health:['Shëndetësia & Historiku','Të dhënat shëndetësore dhe mbështetja']};
      const copy=titles[mode];
      document.querySelector('.student-work-header h2').textContent=copy[0];
      document.querySelector('.student-work-header p').textContent=copy[1];
      document.getElementById('backToRegistry').textContent='← Dosja';
      setTeacherNavigation('registryToggle');
      renderDailyMoods();
      renderChapters();
      recordTeacherView();
      window.scrollTo({top:0,behavior:'smooth'});
    }
    function returnToStudentRegistry(){
      const phone=document.getElementById('appPhone');
      clearStudentFolderModes(phone);
      clearGradingState(phone);
      phone.classList.remove('student-selected','support-active','evaluation-active','today-view');
      phone.classList.add('no-selection','registry-only','students-view');
      resetStudentWorkHeader();
      document.getElementById('registryToggle').click();
    }
    function openStudent(index,inStudentsView){
      const student=storedStudents[index];
      if(!student) return;
      activeStudent=index;
      const phone=document.getElementById('appPhone');
      phone.classList.remove('no-selection','registry-only');
      phone.classList.add('student-selected');
      showStudent(student);
      renderStudents();
      renderDailyMoods();
      if(inStudentsView){
        openStudentFolder(student);
      } else {
        clearStudentFolderModes(phone);
        document.getElementById('todayToggle').click();
      }
    }
    function todayMoodSummary(student){
      const note=dailyMoods[student.name];
      if(!note) return '○ Pa njoftim nga prindi sot';
      const notice=readParentNotice(note.comment);
      const comment=notice.general.trim();
      return note.mood+(comment?' ('+comment+')':'');
    }
    function renderTodayStudents(){
      todayStudentBox.innerHTML='';
      const countLabel=storedStudents.length===1?'1 nxënës':storedStudents.length+' nxënës';
      document.getElementById('todayStudentCount').textContent=countLabel;
      if(!storedStudents.length){
        todayStudentBox.innerHTML='<p class="today-empty">Nuk ka nxënës të regjistruar në këtë klasë.</p>';
        return;
      }
      storedStudents.forEach((student,index)=>{
        const initials=student.name.split(' ').filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase();
        const card=document.createElement('button');
        card.className='today-student-card';
        card.type='button';
        card.setAttribute('aria-label','Hap profilin e '+student.name);
        card.innerHTML='<span class="today-student-avatar" aria-hidden="true">'+escapeHtml(initials)+'</span><span class="today-student-copy"><strong>'+escapeHtml(student.name)+'</strong><span>'+escapeHtml(todayMoodSummary(student))+'</span></span>';
        card.onclick=()=>openStudent(index,false);
        todayStudentBox.appendChild(card);
      });
    }
    function renderStudents(){
      studentBox.innerHTML='';
      document.getElementById('studentCount').textContent=storedStudents.length+' nxënës';
      storedStudents.forEach((student,index)=>{
        const row=document.createElement('div');
        row.className='student-row'+(index===activeStudent?' active':'');
        row.innerHTML='<div class="student-name"><strong>'+escapeHtml(student.name)+'</strong><span class="small muted">'+escapeHtml(student.support)+'</span></div><button class="btn">Hap</button>';
        row.querySelector('button').onclick=()=>openStudent(index,document.getElementById('registryToggle').classList.contains('active'));
        studentBox.appendChild(row);
      });
      renderTodayStudents();
    }
    function showEvaluationAnalytics(student){
      const panel=document.getElementById('evaluationPanel');
      const view=document.getElementById('evaluationAnalyticsView');
      const studentIndex=storedStudents.findIndex(item=>item.id===student.id);
      if(studentIndex>=0) activeStudent=studentIndex;
      const chapters=chaptersBySubject[activeSubject]||[];
      if(!chapters.length){
        view.innerHTML='<button class="btn analytics-back" type="button" id="closeEvaluationAnalytics">← Vlerësimi përfundimtar</button><section class="analytics-card"><div class="section-head"><div><p class="small muted">Raporti i lëndës</p><h2>'+escapeHtml(activeSubject)+'</h2></div><span class="badge">Pa të dhëna</span></div><p class="small muted">Nuk ka ende të dhëna të mjaftueshme.</p></section>';
        panel.classList.add('analytics-open');
        document.getElementById('closeEvaluationAnalytics').onclick=()=>{ if(!teacherGoBack()) panel.classList.remove('analytics-open'); };
        recordTeacherView();
        return;
      }
      const values=chapters.map(item=>item.score);
      const average=(values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(1).replace('.',',');
      const labels=chapters.map(item=>item.name);
      const points=values.map((value,index)=>{const x=34+(index*(232/Math.max(values.length-1,1)));const y=118-(value/5*82);return x+','+y;}).join(' ');
      const markers=values.map((value,index)=>{const x=34+(index*(232/Math.max(values.length-1,1)));const y=118-(value/5*82);return '<circle cx="'+x+'" cy="'+y+'" r="5" fill="#2e8e70" stroke="#fff" stroke-width="3"/>';}).join('');
      const topics=labels.map((label,index)=>'<div class="analytics-topic"><span><strong>'+escapeHtml(label)+'</strong><br><span class="small muted">'+(values[index]>=4?'Në objektiv':'Kërkon përforcim')+'</span></span><span class="'+(values[index]>=4?'trend-up':'trend-watch')+'">'+values[index].toFixed(1).replace('.',',')+' / 5 '+(values[index]>=4?'↑':'↗')+'</span></div>').join('');
      view.innerHTML='<button class="btn analytics-back" type="button" id="closeEvaluationAnalytics">← Vlerësimi përfundimtar</button><section class="analytics-card"><div class="analytics-subject-head"><div><p class="small muted">Raporti i lëndës</p><h2>'+escapeHtml(activeSubject)+'</h2></div><span class="badge">Mes. '+average+' / 5</span></div><svg class="analytics-chart" viewBox="0 0 300 145" role="img" aria-label="Grafiku i përparimit në '+escapeHtml(activeSubject)+'"><path d="M28 120H278M28 78H278M28 36H278" stroke="#dce9e3" stroke-width="1"/><polyline points="'+points+'" fill="none" stroke="#2e8e70" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'+markers+'<text x="28" y="138" fill="#657168" font-size="10">Fillimi</text><text x="222" y="138" fill="#657168" font-size="10">Vlerësimi i fundit</text></svg>'+topics+'</section>';
      panel.classList.add('analytics-open');
      document.getElementById('closeEvaluationAnalytics').onclick=()=>{ if(!teacherGoBack()) panel.classList.remove('analytics-open'); };
      recordTeacherView();
    }
    function renderEvaluationFolders(){ const box=document.getElementById('evaluationFolders'); box.innerHTML=''; storedStudents.forEach(student=>{ const row=document.createElement('button'); row.className='evaluation-folder'; row.type='button'; row.innerHTML='<span class="folder-icon">📁</span><span><strong>'+student.name+'</strong><br><span class="small muted">Vlerësimi i vazhdueshëm</span></span><span class="folder-open">Klikoni për të parë më shumë</span>'; row.onclick=()=>showEvaluationAnalytics(student); box.appendChild(row); }); }
    let moodHistoryIndex=0;
    let moodHistoryStudent='';
    function renderDailyMoods(){
      const student=storedStudents[activeStudent];
      if(!student) return;
      document.getElementById('dailyMoodTitle').textContent='Njoftimi i prindit për sot';
      const fallback=dailyMoods[student.name];
      const entries=(moodHistory[student.name]&&moodHistory[student.name].length?moodHistory[student.name]:(fallback?[{date:'Sot',mood:fallback.mood,comment:fallback.comment}]:[]));
      if(moodHistoryStudent!==student.name){ moodHistoryStudent=student.name; moodHistoryIndex=0; }
      moodHistoryIndex=Math.max(0,Math.min(moodHistoryIndex,Math.max(0,entries.length-1)));
      const entry=entries[moodHistoryIndex];
      const notice=readParentNotice(entry?entry.comment:'');
      const icon=entry&&parentMoodIcons[entry.mood];
      document.getElementById('moodLargeEmoji').innerHTML=icon?'<img src="'+icon+'" alt="'+entry.mood+'">':(entry?entry.mood.split(' ')[0]:'—');
      document.getElementById('moodDate').textContent=entry?(entry.date==='Sot'?'Sot':new Intl.DateTimeFormat('sq-AL',{dateStyle:'long'}).format(new Date(entry.date))):'Sot';
      document.getElementById('moodParentComment').textContent=entry?(notice.general||'Prindi nuk ka lënë koment për të gjithë mësimdhënësit.'):'Nuk ka njoftim nga prindi ende.';
      const specificBox=document.getElementById('teacherSpecificParentCommentBox');
      const showSpecific=Boolean(entry&&notice.specific&&notice.subject===activeSubject);
      specificBox.classList.toggle('hidden',!showSpecific);
      if(showSpecific){
        document.getElementById('teacherSpecificParentCommentTitle').textContent='Koment vetëm për '+activeSubject;
        document.getElementById('teacherSpecificParentComment').textContent=notice.specific;
      }
      document.getElementById('moodPrevious').disabled=!entries.length||moodHistoryIndex>=entries.length-1;
      document.getElementById('moodNext').disabled=!entries.length||moodHistoryIndex===0;
    }
    function renderTeacherMoodHistory(){ const box=document.getElementById('teacherMoodHistoryList'); const student=storedStudents[activeStudent]; const entries=student?(moodHistory[student.name]||[]):[]; box.innerHTML=''; if(!entries.length){ box.innerHTML='<p class="small muted">Nuk ka njoftime të mëparshme nga prindi.</p>'; return; } entries.forEach(entry=>{ const row=document.createElement('article'); row.className='teacher-mood-history-item'; const date=entry.date==='Sot'?'Sot':new Intl.DateTimeFormat('sq-AL',{dateStyle:'medium'}).format(new Date(entry.date)); const comments=noticeHistoryMarkup(entry.comment,activeSubject)||'<p class="small muted">Pa koment shtesë për këtë mësimdhënës.</p>'; row.innerHTML='<span class="mood-history-icon">'+escapeHtml(entry.mood.split(' ')[0])+'</span><div><strong>'+escapeHtml(date)+' · '+escapeHtml(entry.mood.substring(entry.mood.indexOf(' ')+1))+'</strong><div class="history-comment-block small">'+comments+'</div></div>'; box.appendChild(row); }); }
    function activeChapters(){ if(!chaptersBySubject[activeSubject]) chaptersBySubject[activeSubject]=[]; return chaptersBySubject[activeSubject]; }
    function supportMethod(){ const profile=document.getElementById('supportTitle').textContent.toLowerCase(); const preference=document.getElementById('preferenceLabel').textContent.toLowerCase(); if(profile.includes('shikim')) return 'Përdorni udhëzime të lexuara me zë, tekst të madh dhe hapa të shkurtër.'; if(profile.includes('dëgjim')) return 'Përdorni udhëzime të shkruara, shembuj pamorë dhe video me titra.'; if(profile.includes('vëmendje')) return 'Ndajeni aktivitetin në hapa të vegjël dhe jepni një pauzë të shkurtër mes tyre.'; if(preference.includes('vizatim')) return 'Përdorni skica dhe paraqitje me ngjyra për ta shpjeguar konceptin.'; if(preference.includes('praktikë')) return 'Jepni një detyrë praktike të shkurtër me shembuj nga jeta e përditshme.'; if(preference.includes('lexim')) return 'Përdorni tekst të shkurtër me fjalë kyçe të theksuara dhe pyetje kuptimore.'; if(preference.includes('dëgjim')) return 'Përdorni audio të shkurtër, pauza të qarta dhe ritëm të përshtatshëm.'; if(preference.includes('lëvizje')) return 'Ndërthurni detyrën me stacione të shkurtra dhe aktivitet fizik të drejtuar.'; if(preference.includes('bashkëpunim')) return 'Përdorni punë në çift ose grup të vogël me role të përcaktuara.'; return 'Jepni një fletë pune të shkurtër dhe kërkoni një përgjigje të shkruar me hapa të qartë.'; }
    function renderResult(chapters){ const average=document.getElementById('resultAverage'); const summary=document.getElementById('resultSummary'); const list=document.getElementById('supportingChapters'); list.innerHTML=''; if(!chapters.length){ average.textContent='Pa të dhëna'; summary.textContent='Nuk ka kapituj të regjistruar ende për këtë lëndë.'; return; } const low=chapters.filter(chapter=>chapter.score<4); const mean=chapters.reduce((total,chapter)=>total+chapter.score,0)/chapters.length; average.textContent=mean.toFixed(1).replace('.',',')+' / 5'; summary.textContent=low.length ? low.length+' kapituj kërkojnë mbështetje në '+activeSubject+'.' : 'Të gjithë kapitujt e regjistruar janë në objektiv.'; low.forEach(chapter=>{ const row=document.createElement('div'); row.className='supporting-chapter'; const name=document.createElement('strong'); name.textContent=chapter.name; const score=document.createElement('strong'); score.textContent=chapter.score.toFixed(1).replace('.',',')+' / 5'; const note=document.createElement('p'); note.textContent='Mbështetje: '+supportMethod(); row.append(name,score,note); list.appendChild(row); }); }
    function renderChapters(){ const container=document.getElementById('chapters'); const select=document.getElementById('chapter'); const chapters=activeChapters(); container.innerHTML=''; select.innerHTML=''; renderResult(chapters); if(!chapters.length){ container.innerHTML='<p class="empty-chapters">Ende nuk ka kapituj për '+activeSubject+'. Shto kapitullin e parë më poshtë.</p>'; return; } chapters.forEach(chapter=>{ const percentage=Math.max(0,Math.min(100,chapter.score*20)); const low=chapter.score<4; const row=document.createElement('div'); row.className='chapter'; row.innerHTML='<span>'+chapter.name+'</span><strong'+(low?' style="color:var(--danger)"':'')+'>Mes. '+chapter.score.toFixed(1).replace('.',',')+' / 5</strong><div class="track"><div class="fill'+(low?' low':'')+'" style="width:'+percentage+'%"></div></div>'; container.appendChild(row); const option=document.createElement('option'); option.textContent=chapter.name; select.appendChild(option); }); }
    function updateResource(){ const preference=preferences[activePreference]; const mood=moodData[activeMood]; document.getElementById('preferenceLabel').textContent=preference[0]; document.getElementById('preferenceHint').textContent=preference[1]; document.getElementById('resourceTitle').textContent=preference[2]; document.getElementById('resourceCopy').textContent=preference[3]+(mood[2]?' Gjendja e sotme: '+mood[2]:''); renderResult(activeChapters()); }
    function speak(text){ const status=document.getElementById('voiceStatus'); if(!('speechSynthesis' in window)){ status.textContent='Leximi me zë nuk mbështetet'; return; } speechSynthesis.cancel(); const utterance=new SpeechSynthesisUtterance(text); utterance.lang='sq-AL'; utterance.onstart=()=>status.textContent='Duke lexuar…'; utterance.onend=()=>status.textContent='Leximi përfundoi'; speechSynthesis.speak(utterance); }
    document.getElementById('readPage').onclick=()=>speak(document.querySelector('h1').textContent+'. Mbështetje për shikimin. '+document.getElementById('preferenceHint').textContent+' Rezultati aktual në matematikë është '+document.getElementById('score').textContent+'. Sugjerim: '+document.getElementById('resourceTitle').textContent+'.');
    document.getElementById('readResource').onclick=()=>speak(document.getElementById('resourceTitle').textContent+'. '+document.getElementById('resourceCopy').textContent);
    document.getElementById('stopReading').onclick=()=>{ speechSynthesis.cancel(); document.getElementById('voiceStatus').textContent='Leximi u ndal'; };
    document.querySelectorAll('.mood').forEach(button=>button.onclick=()=>{ document.querySelectorAll('.mood').forEach(x=>{ x.classList.remove('active'); x.setAttribute('aria-pressed','false'); }); button.classList.add('active'); button.setAttribute('aria-pressed','true'); activeMood=button.dataset.mood; document.getElementById('moodStatus').textContent=moodData[activeMood][0]; updateResource(); });
    document.getElementById('moodPrevious').onclick=()=>{ moodHistoryIndex++; renderDailyMoods(); };
    document.getElementById('moodNext').onclick=()=>{ moodHistoryIndex--; renderDailyMoods(); };
    document.getElementById('teacherMoodHistory').onclick=()=>{ const panel=document.getElementById('teacherMoodCalendar'); renderTeacherMoodCalendar(); panel.classList.add('show'); document.getElementById('teacherMoodHistory').setAttribute('aria-expanded','true'); };
    document.querySelectorAll('.preference').forEach(button=>button.onclick=()=>{ document.querySelectorAll('.preference').forEach(x=>x.classList.remove('active')); button.classList.add('active'); activePreference=button.dataset.preference; updateResource(); });
    document.getElementById('assignResource').onclick=event=>event.currentTarget.textContent='✓ U caktua për sot';
    document.getElementById('showGrade').onclick=()=>{ if(!activeChapters().length){ document.getElementById('chapterForm').classList.add('show'); document.getElementById('newChapter').focus(); return; } document.getElementById('gradePanel').classList.add('show'); document.getElementById('showGrade').style.display='none'; };
    document.getElementById('toggleGrading').onclick=()=>{ document.getElementById('appPhone').classList.add('grading-active'); document.getElementById('gradingContent').classList.add('show'); recordTeacherView(); window.scrollTo({top:0,behavior:'smooth'}); };
    document.getElementById('closeGradingPage').onclick=()=>{ if(teacherGoBack()) return; document.getElementById('appPhone').classList.remove('grading-active'); document.getElementById('gradingContent').classList.remove('show'); document.getElementById('gradePanel').classList.remove('show'); document.getElementById('showGrade').style.display='block'; };
    document.getElementById('closeGrade').onclick=()=>{ document.getElementById('gradePanel').classList.remove('show'); document.getElementById('showGrade').style.display='block'; };
    document.getElementById('saveGrade').onclick=async()=>{
      const grade=Number(document.getElementById('grade').value);
      const chapterName=document.getElementById('chapter').value;
      const chapter=activeChapters().find(item=>item.name===chapterName);
      const student=storedStudents[activeStudent];
      const status=document.getElementById('scoreDetail');
      const button=document.getElementById('saveGrade');
      if(!student||!student.id||!chapter||!chapter.id||!activeSubjectId||!currentTeacherId||!activeAcademicPeriodId){ status.textContent='Nota nuk mund të ruhet pa nxënës, kapitull, lëndë dhe periudhë aktive.'; return; }
      if(!Number.isFinite(grade)||grade<1||grade>5){ status.textContent='Nota duhet të jetë mes 1 dhe 5.'; return; }
      button.disabled=true;
      status.textContent='Duke ruajtur notën…';
      const result=await supabaseClient.from('grades').insert({student_id:student.id,subject_id:activeSubjectId,chapter_id:chapter.id,teacher_id:currentTeacherId,academic_period_id:activeAcademicPeriodId,score:grade});
      button.disabled=false;
      if(result.error){ status.textContent=userMessage(result.error,'Nota nuk u ruajt. Kontrolloni autorizimin dhe provoni përsëri.'); return; }
      const previousScore=Number(chapter.score)||0;
      chapter.score=previousScore?((previousScore+grade)/2):grade;
      renderChapters();
      status.textContent='Nota '+grade.toFixed(1).replace('.',',')+' u ruajt në bazën e të dhënave.';
      document.getElementById('gradePanel').classList.remove('show');
      document.getElementById('showGrade').style.display='block';
    };
    document.getElementById('showChapter').onclick=()=>document.getElementById('chapterForm').classList.add('show');
    document.getElementById('addChapter').onclick=async()=>{
      const name=document.getElementById('newChapter').value.trim();
      const status=document.getElementById('scoreDetail');
      const button=document.getElementById('addChapter');
      if(!name) return;
      if(!activeSubjectId){ status.textContent='Kapitulli nuk mund të ruhet pa lëndë të autorizuar.'; return; }
      button.disabled=true;
      status.textContent='Duke ruajtur kapitullin…';
      const result=await supabaseClient.from('chapters').insert({subject_id:activeSubjectId,name,target_score:4,active:true}).select('id,subject_id,name').single();
      button.disabled=false;
      if(result.error){ status.textContent=userMessage(result.error,'Kapitulli nuk u ruajt. Kontrolloni autorizimin dhe provoni përsëri.'); return; }
      activeChapters().push({id:result.data.id,subject_id:result.data.subject_id,name:result.data.name,score:0});
      document.getElementById('newChapter').value='';
      document.getElementById('chapterForm').classList.remove('show');
      status.textContent='Kapitulli u ruajt në bazën e të dhënave.';
      renderChapters();
    };
    document.getElementById('teacherBack').onclick=teacherGoBack;
    document.getElementById('teacherForward').onclick=teacherGoForward;
    document.getElementById('backToRegistry').onclick=()=>{ const student=storedStudents[activeStudent]; if(!teacherGoBack()){ if(document.getElementById('appPhone').classList.contains('student-selected')&&student) openStudentFolder(student); else document.getElementById('registryToggle').click(); } };
    document.getElementById('studentFolderBack').onclick=()=>{ if(!teacherGoBack()) returnToStudentRegistry(); };
    document.getElementById('studentFolderForward').onclick=teacherGoForward;
    document.querySelectorAll('[data-folder-action]').forEach(button=>button.onclick=()=>{ const action=button.dataset.folderAction; const student=storedStudents[activeStudent]; if(!student) return; openStudentFolderDetail(action); });
    document.getElementById('registryToggle').onclick=()=>{ const registry=document.getElementById('registry'); const phone=document.getElementById('appPhone'); const student=storedStudents[activeStudent]; if(phone.classList.contains('student-selected')&&student){ openStudentFolder(student); return; } clearStudentFolderModes(phone); clearGradingState(phone); phone.classList.remove('support-active','evaluation-active','today-view'); phone.classList.add('students-view'); if(phone.classList.contains('no-selection')) phone.classList.add('registry-only'); else phone.classList.remove('registry-only'); registry.classList.add('show'); setTeacherNavigation('registryToggle'); recordTeacherView(); window.scrollTo({top:0,behavior:'smooth'}); };
    document.getElementById('todayToggle').onclick=()=>{ const phone=document.getElementById('appPhone'); clearStudentFolderModes(phone); clearGradingState(phone); phone.classList.remove('support-active','evaluation-active','students-view'); phone.classList.add('today-view'); if(phone.classList.contains('no-selection')) phone.classList.add('registry-only'); else phone.classList.remove('registry-only'); document.getElementById('registry').classList.remove('show'); setTeacherNavigation('todayToggle'); updateTeacherClock(); renderTodayStudents(); recordTeacherView(); window.scrollTo({top:0,behavior:'smooth'}); };
    const chat=document.getElementById('supportChat');
    function addMessage(text,role){ const message=document.createElement('div'); message.className='message '+role; message.textContent=text; chat.appendChild(message); chat.scrollTop=chat.scrollHeight; return message; }
    function agentReply(text){ const lower=text.toLowerCase(); if(/vetëlënd|vetvras|suicid|rrezik|dhun/.test(lower)){ return 'Faleminderit që e ngritët këtë. Mos e trajtoni vetëm në chat: ndiqni menjëherë protokollin e mbrojtjes së fëmijës në shkollë, njoftoni personin përgjegjës dhe kontaktoni shërbimet emergjente lokale nëse ka rrezik të menjëhershëm.'; } if(/shpërqendr|vëmend/.test(lower)){ return 'Provoni një plan 10-minutësh: 1) jepni vetëm një udhëzim të shkurtër; 2) ndani detyrën në një hap; 3) ofroni një pauzë të shkurtër; 4) jepni përforcim specifik për hapin e përfunduar. Pastaj shënoni çfarë e ndihmoi më shumë.'; } if(/angazh|nuk po|refuz/.test(lower)){ return 'Filloni me një zgjedhje të vogël: “do të shkruash apo të vizatosh?”. Përdorni interesin e nxënësit dhe një objektiv shumë të arritshëm. Vëzhgoni nëse vështirësia lidhet me detyrën, mjedisin apo gjendjen emocionale.'; } if(/shik|vizual|lex/.test(lower)){ return 'Për profilin me mbështetje për shikimin, përdorni tekst të madh, kontrast të lartë, udhëzime të lexuara me zë dhe përshkrime të qarta të çdo materiali pamor. Kontrolloni me nxënësin nëse materiali dëgjohet dhe kuptohet me ritmin e duhur.'; } return 'Për të zgjedhur hapin e duhur, provoni të vëzhgoni: kur ndodh situata, çfarë e paraprin dhe çfarë e lehtëson. Mund të filloni me një përshtatje të vogël, ta provoni për disa ditë dhe pastaj ta diskutoni me ekipin pedagogjik ose profesionistin përkatës.'; }
    function pedagogicalPlan(text){ const lower=text.toLowerCase(); if(/rrezik|dhun|vetëlënd|vetvras|suicid/.test(lower)) return {analysis:'Faleminderit që e the menjëherë. Kjo mund të sinjalizojë rrezik të drejtpërdrejtë dhe kërkon veprim sipas protokollit të mbrojtjes së fëmijës.',tactics:['Njoftoni menjëherë personin përgjegjës në shkollë; mos e lini nxënësin vetëm.','Largoni rreziqet e afërta dhe përdorni fjali të qeta, të shkurtra.','Kontaktoni kujdestarin dhe shërbimet emergjente lokale sipas protokollit.'],tags:['🛑 Protokolli i sigurisë','👥 Njofto ekipin','☎️ Kontakto familjen']}; if(/zhurm|zë të lartë|brit|outburst|shpërth/.test(lower)) return {analysis:'Kjo tingëllon si mbingarkesë sensore ose emocionale, jo thjesht mosbindje. Ulja e stimulit tani mund ta rikthejë ndjenjën e kontrollit.',tactics:['Ul zhurmën dhe jep vetëm një fjali: “Je i sigurt; po bëjmë pauzë.”','Ofro dy zgjedhje të qeta: vend i qetë ose ujë për dy minuta.','Riktheje me një detyrë njëhapëshe, pa kërkuar shpjegim menjëherë.'],tags:['⚡ De-eskalim','🛑 Pushim sensor','💬 Bisedë pas qetësimit']}; if(/shpërqendr|vëmend|përqendrim/.test(lower)) return {analysis:'Vështirësia ka gjasa të lidhet me ngarkesën njohëse ose me një detyrë që duket shumë e madhe. Një hap i qartë e bën fillimin më të arritshëm.',tactics:['Mbulo pjesën tjetër të fletës dhe lër të duket vetëm hapi i parë.','Vendos kohëmatës 3-minutësh për një provë të shkurtër.','Jep përforcim specifik sapo nis: “E nise vetë hapin e parë.”'],tags:['🎯 Një hap','⏱️ Provë 3-minutëshe','✨ Përforcim pozitiv']}; if(/angazh|refuz|nuk po|nuk dëshiron/.test(lower)) return {analysis:'Refuzimi shpesh mbron nxënësin nga ndjenja e dështimit ose humbja e zgjedhjes. Jepini kontroll të vogël pa e hequr objektivin.',tactics:['Thuaj: “Zgjedh shkrim apo vizatim për përgjigjen e parë?”','Nis me kërkesën më të lehtë që mund ta kryejë për 60 sekonda.','Vendos një objektiv të dukshëm: vetëm një përgjigje para pauzës.'],tags:['🧩 Jep zgjedhje','🚀 Nisje e lehtë','📍 Objektiv i vogël']}; if(/shik|lex|tekst|vizual/.test(lower)) return {analysis:'Materiali mund të mos jetë mjaftueshëm i qasshëm për mënyrën si nxënësi e përpunon informacionin. Përshtatja e formatit duhet të vijë para vlerësimit të punës.',tactics:['Lexoje udhëzimin me zë dhe kontrollo kuptimin me një pyetje të shkurtër.','Përdor tekst më të madh, kontrast të lartë dhe një element në rresht.','Përshkruaj me fjalë çdo figurë ose skemë para se të kërkosh përgjigje.'],tags:['🔊 Lexo me zë','👁️ Kontrast i lartë','🧭 Përshkruaj pamoren']}; return {analysis:'E kuptoj që kjo situatë kërkon vendim të shpejtë në klasë. Shiko së pari nëse pengesa kryesore është emocionale, mjedisore apo te vetë detyra.',tactics:['Pyet me qetësi: “Cila pjesë të duket më e vështirë tani?”','Thjeshto detyrën në një hap të dukshëm dhe prit një përgjigje.','Shëno çfarë ndodhi para situatës për ta provuar një përshtatje nesër.'],tags:['🔎 Gjej pengesën','🧱 Thjeshto hapin','📝 Vëzhgo modelin']}; }
    let pedagogicalTurn=0;
    function pedagogicalPlanV2(text){ const lower=text.toLowerCase(); const seed=[...text].reduce((sum,char)=>sum+char.charCodeAt(0),0)+(++pedagogicalTurn*17); const pick=(items,offset=0)=>items[(seed+offset)%items.length]; const quoted=text.trim().replace(/\s+/g,' ').slice(0,88); if(/rrezik|dhun|vetëlënd|vetvras|suicid/.test(lower)) return {analysis:'Shprehja “'+quoted+'” kërkon protokoll të menjëhershëm të mbrojtjes; mos e trajto si bisedë të zakonshme pedagogjike.',tactics:['Siguro praninë e një të rrituri përgjegjës pranë nxënësit menjëherë.','Lajmëro udhëheqësin e mbrojtjes së fëmijës sipas procedurës së shkollës.','Kontakto kujdestarin dhe shërbimet emergjente lokale kur rreziku është i afërt.'],tags:['[🛑 Siguria tani]','[👥 Aktivizo ekipin]','[☎️ Njofto familjen]']}; const groups=[{match:/zhurm|zë të lartë|brit|shpërth|outburst/,analyses:['Kjo përshkruan rregullim vokal të vështirësuar, shpesh i nxitur nga zhurma ose kërkesat e njëpasnjëshme.','Intensiteti i reagimit sugjeron mbingarkesë të çastit; kërkesa e radhës duhet të ulet para se të kërkosh shpjegim.'],tactics:['Ule zhurmën pranë tij: mbyll burimin më të afërt dhe fol me zë më të ulët se zakonisht.','Vendos një kartë vizuale “pauzë” në tavolinë dhe drejtoje te një vend i qetë për 90 sekonda.','Ktheje në aktivitet me një kërkesë pa gjuhë të gjatë: trego me gisht zgjedhjen e parë.'],tags:['[⚡ Menaxhimi i Akut]','[🤫 Teknika të Qetësimit]','[👥 Ndihma nga Klasa]']},{match:/shpërqendr|vëmend|përqendrim/,analyses:['Vëmendja po shpërndahet sepse kërkesa nuk po jep një pikë të qartë nisjeje.','Shpërqendrimi këtu duket si lodhje e kontrollit ekzekutiv, jo mungesë vullneti.'],tactics:['Mbulo tre të katërtat e materialit me një fletë dhe lër vetëm rreshtin që punohet tani.','Vendos kohëmatës vizual për 2 minuta dhe kërko vetëm një shenjë përfundimi.','Ndrysho pozicionin e nxënësit pranë një modeli pune të qetë, jo pranë stimulit më të madh.'],tags:['[🎯 Fokus i Ngushtë]','[⏱️ Sprint 2-Min]','[🪑 Ndrysho Pozicionin]']},{match:/angazh|refuz|nuk po|nuk dëshiron|heq dorë|dësht/,analyses:['Heqja dorë po sinjalizon frustrim njohës për kërkesën e përmendur: “'+quoted+'”.','Refuzimi është duke mbrojtur nxënësin nga një përpjekje që aktualisht i duket e pasigurt ose shumë e madhe.'],tactics:['Paraqit dy rrugë reale për të njëjtin objektiv: përgjigje me vizatim ose me tre fjalë.','Vendos shembullin e parë të përfunduar pranë detyrës dhe kërko vetëm kopjimin e hapit të dytë.','Cakto një marrëveshje të vogël: një provë, pastaj 60 sekonda aktivitet i preferuar.'],tags:['[🧩 Ndarja e Detyrës]','[⏱️ Kohë Shtesë]','[🏅 Motivim me Shembull]']},{match:/shik|lex|tekst|vizual/,analyses:['Vështirësia lidhet me hyrjen vizuale të materialit; formati duhet ndryshuar para se të gjykohet performanca.','Teksti ose figura po kërkojnë më shumë përpunim se sa nxënësi mund të mbajë në atë moment.'],tactics:['Lexo vetëm fjalinë e parë me zë dhe kërko që nxënësi të zgjedhë fjalën kyçe.','Rrit kontrastin dhe izolo një bllok të vetëm teksti me kartë të bardhë.','Shndërro figurën në tre përshkrime të shkurtra para pyetjes.'],tags:['[🔊 Udhëzim Audio]','[👁️ Izolo Tekstin]','[🧭 Përshkruaj Figurën]']}]; const group=groups.find(item=>item.match.test(lower)); if(group) return {analysis:pick(group.analyses),tactics:[pick(group.tactics,1),pick(group.tactics,2),pick(group.tactics,3)],tags:group.tags}; const focus=quoted.split(' ').filter(word=>word.length>4).slice(0,2).join(' ')||'situata e përshkruar'; return {analysis:'Te “'+focus+'” vëzhgohet një pengesë që duhet provuar menjëherë në mjedis, jo interpretuar si etiketë për nxënësin.',tactics:['Zhvendos kërkesën në një shembull konkret që lidhet me fjalët e përdorura nga mësimdhënësi.','Përdor një zgjedhje fizike: dy karta ose dy mjete, që nxënësi ta tregojë hapin e ardhshëm.','Mat reagimin për 90 sekonda dhe mbaj vetëm përshtatjen që e ul vështirësinë.'],tags:['[🔎 Kontrollo Shkaktarin]','[🪄 Ndrysho Materialin]','[📌 Vëzhgo Reagimin]']}; }
    function pedagogicalPlanV3(text){ const lower=text.toLowerCase(); if(/dety|përfundo|perfundo|mërzit|merzit|frustr/.test(lower)) return {analysis:'Mospërfundimi i detyrës po e kthen përpjekjen në frustrim njohës; tani duhet një model i prekshëm dhe një sukses shumë i vogël.',tactics:['Copëtoje ushtrimin në tre shirita dhe kërko vetëm rreshtin e parë.','Vendos një shembull të zgjidhur ngjitur me vendin e punës, jo vetëm në tabelë.','Thuaji: “Pjesën e parë e bëjmë bashkë; pastaj ti zgjedh hapin tjetër.”'],tags:['[🧩 Ndarja e Detyrës]','[⏱️ Kohë Shtesë]','[🏅 Motivim me Shembull]']}; return pedagogicalPlanV2(text); }
    function pedagogicalPlanV4(text){ const plan=pedagogicalPlanV3(text); plan.analysis=plan.analysis.replace(/^Kjo përshkruan /,'').replace(/^Te nxënësja vëzhgohet /,'').replace(/^E kuptoj që kjo situatë /,''); return plan; }
    function addPedagogicalReply(text){ const plan=pedagogicalPlanV4(text); const message=document.createElement('div'); message.className='message agent pedagogical-reply'; const analysis=document.createElement('p'); analysis.textContent=plan.analysis; const tactics=document.createElement('ul'); tactics.className='reply-tactics'; plan.tactics.forEach(item=>{const line=document.createElement('li');line.textContent=item;tactics.appendChild(line);}); const tags=document.createElement('div'); tags.className='reply-tags'; plan.tags.forEach(tag=>{const button=document.createElement('button');button.type='button';button.textContent=tag;button.onclick=()=>{document.getElementById('supportInput').value=tag+' për situatën: '+text;sendSupport();};tags.appendChild(button);}); message.append(analysis,tactics,tags); chat.appendChild(message); chat.scrollTop=chat.scrollHeight; }
    let supportRequestActive=false;
    function encodeSupportMessage(text){ const bytes=new TextEncoder().encode(text); let binary=''; bytes.forEach(byte=>binary+=String.fromCharCode(byte)); return btoa(binary); }
    async function sendSupport(){
      const input=document.getElementById('supportInput');
      const sendButton=document.getElementById('sendSupport');
      const text=input.value.trim();
      if(!text||supportRequestActive) return;
      addMessage(text,'teacher');
      input.value='';
      supportRequestActive=true;
      chat.setAttribute('aria-busy','true');
      input.disabled=true;
      sendButton.disabled=true;
      sendButton.textContent='Duke pritur…';
      const pending=addMessage('AI po përgatit hapa konkretë për këtë situatë…','agent');
      pending.classList.add('pending');
      try {
        const {data,error}=await supabaseClient.functions.invoke('support',{body:{situation:text}});
        if(error) throw new Error(error.message||'Asistenti AI nuk mundi të përgjigjet tani.');
        if(data&&data.error) throw new Error(data.error);
        pending.textContent=`${data.observation||''}

Çfarë të bëni tani:
- ${(data.actions||[]).join('\n- ')}

Vëzhgoni: ${data.observationCue||'çfarë e ndihmon nxënësin.'}`;
      } catch(error) {
        pending.textContent=error.message||'Asistenti AI nuk mundi të përgjigjet tani. Provoni përsëri.';
      } finally {
        pending.classList.remove('pending');
        chat.setAttribute('aria-busy','false');
        supportRequestActive=false;
        input.disabled=false;
        sendButton.disabled=false;
        sendButton.textContent='Dërgo';
        input.focus();
        chat.scrollTop=chat.scrollHeight;
      }
    }
    document.getElementById('sendSupport').onclick=sendSupport;
    document.getElementById('supportInput').addEventListener('keydown',event=>{ if(event.key==='Enter') sendSupport(); });
    document.querySelectorAll('[data-prompt]').forEach(button=>button.onclick=()=>{ document.getElementById('supportInput').value=button.dataset.prompt; sendSupport(); });
    document.getElementById('supportToggle').onclick=()=>{ const panel=document.getElementById('supportPanel'); const phone=document.getElementById('appPhone'); clearStudentFolderModes(phone); clearGradingState(phone); phone.classList.remove('evaluation-active','today-view','students-view','registry-only'); phone.classList.add('support-active'); document.getElementById('registry').classList.remove('show'); panel.classList.add('show'); setTeacherNavigation('supportToggle'); recordTeacherView(); window.scrollTo({top:0,behavior:'smooth'}); };
    document.getElementById('evaluationToggle').onclick=()=>{ const phone=document.getElementById('appPhone'); clearStudentFolderModes(phone); clearGradingState(phone); phone.classList.remove('support-active','today-view','students-view','registry-only'); phone.classList.add('evaluation-active'); document.getElementById('evaluationPanel').classList.remove('analytics-open'); setTeacherNavigation('evaluationToggle'); renderEvaluationFolders(); recordTeacherView(); window.scrollTo({top:0,behavior:'smooth'}); };
    document.getElementById('addStudent').onclick=()=>{ document.getElementById('newStudent').value=''; document.getElementById('studentCount').textContent=storedStudents.length+' nxënës'; alert('Shtimi i nxënësve bëhet nga administratori i shkollës, që të ruhen klasa, shkolla dhe autorizimet.'); };

    let parentActiveStudent=null;
    let parentSelectedMood=parentMoods[0];
    let parentSubjectAverages=[];
    let parentFinalGrades=[];
    let parentGradeMessages=[];
    function showParentTab(tab){ const today=tab==='today'; document.getElementById('parentTodayPanel').classList.toggle('hidden',!today); document.getElementById('parentResultsPanel').classList.toggle('hidden',today); document.getElementById('parentTodayTab').classList.toggle('active',today); document.getElementById('parentResultsTab').classList.toggle('active',!today); if(today) renderParentTeacherNotice(); }
    function renderParentMoodChoices(){ const box=document.getElementById('parentMoodChoices'); box.innerHTML=''; parentMoods.forEach(mood=>{ const button=document.createElement('button'); button.type='button'; button.className='parent-mood-choice'+(mood===parentSelectedMood?' active':''); button.innerHTML='<img src="'+parentMoodIcons[mood]+'" alt=""><span>'+mood.substring(mood.indexOf(' ')+1)+'</span>'; button.onclick=()=>{ parentSelectedMood=mood; renderParentMoodChoices(); }; box.appendChild(button); }); }
    function renderParentSubjectAverages(){ const box=document.getElementById('parentSubjectList'); box.innerHTML=''; const averages=Object.fromEntries(parentSubjectAverages.map(item=>[item.name,item.average])); subjects.forEach(name=>{ const row=document.createElement('div'); row.className='parent-subject-row'; const value=averages[name]; row.innerHTML='<strong>'+name+'</strong><span class="badge">'+(value===undefined?'Pa nota':value.toFixed(1).replace('.',',')+' / 5')+'</span>'; box.appendChild(row); }); }
    async function loadParentData(user){
      currentUser=user;
      const mappingResult=await fetchParentStudentMapping(user.id);
      if(mappingResult.error) throw mappingResult.error;
      const record=mappingResult.data;
      const dbStudent=record.students;
      const student={id:dbStudent.id,name:dbStudent.first_name+' '+dbStudent.last_name,support:'',detail:'',icon:'📋'};
      const {gradeResult,finalGradeResult,moodResult,subjectNoticeResult,teacherNoticeResult,replyResult}=await fetchParentDashboardData(student.id,user.id);
      if(gradeResult.error) throw gradeResult.error;
      if(finalGradeResult.error) throw finalGradeResult.error;
      if(moodResult.error) throw moodResult.error;
      if(replyResult.error) throw replyResult.error;
      const grades=(gradeResult.data||[]).filter(item=>item.academic_periods?.status==='active');
      parentFinalGrades=(finalGradeResult.data||[]).filter(item=>item.academic_periods?.status==='active');
      parentGradeMessages=grades.filter(item=>item.parent_message);
      const grouped={};
      grades.forEach(item=>{ const name=item.subjects?item.subjects.name:'Lëndë'; if(!grouped[name]) grouped[name]=[]; grouped[name].push(Number(item.score)); });
      parentSubjectAverages=Object.entries(grouped).map(([name,values])=>({name,average:values.reduce((sum,value)=>sum+value,0)/values.length}));
      const subjectName=parentSubjectAverages[0]?parentSubjectAverages[0].name:'Matematikë';
      activeSubject=subjectName;
      chaptersBySubject[subjectName]=grades.filter(item=>(item.subjects?item.subjects.name:'Lëndë')===subjectName).map(item=>({name:item.chapters?item.chapters.name:'Kapitull',score:Number(item.score)}));
      const specificByDate={};
      (subjectNoticeResult.data||[]).forEach(item=>{ const day=(item.created_at||'').slice(0,10); if(!specificByDate[day]) specificByDate[day]=item; });
      const entries=moodResult.data||[];
      if(entries[0]){ const specific=specificByDate[entries[0].reported_on]; dailyMoods[student.name]={mood:entries[0].mood,comment:writeParentNotice(entries[0].general_comment||entries[0].parent_comment||'',specific&&specific.subjects?specific.subjects.name:'',specific?specific.comment:'')}; }
      moodHistory[student.name]=entries.map(item=>{ const specific=specificByDate[item.reported_on]; return {date:item.reported_on,mood:item.mood,comment:writeParentNotice(item.general_comment||item.parent_comment||'',specific&&specific.subjects?specific.subjects.name:'',specific?specific.comment:'')}; });
      parentTeacherNotices.splice(0,parentTeacherNotices.length,...(teacherNoticeResult.data||[]));
      parentNoticeReplies.splice(0,parentNoticeReplies.length,...(replyResult.data||[]));
      return student;
    }
    function showParentDashboard(student){ parentActiveStudent=student; const chapters=chaptersBySubject[activeSubject] || []; const mean=chapters.length ? (chapters.reduce((sum,item)=>sum+item.score,0)/chapters.length).toFixed(1).replace('.',',')+' / 5' : 'Pa të dhëna'; const note=dailyMoods[student.name]; const finalGrade=parentFinalGrades.find(item=>item.subjects?.name===activeSubject); const messages=parentGradeMessages.filter(item=>item.subjects?.name===activeSubject); parentSelectedMood=note ? note.mood : parentMoods[0]; document.getElementById('parentChildName').textContent=student.name; document.getElementById('parentChildInitials').textContent=student.name.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase(); document.getElementById('parentMoodQuestion').textContent='Si është humori i '+student.name+' sot?'; document.getElementById('parentMoodComment').value=note ? note.comment : ''; document.getElementById('parentMoodStatus').textContent=''; document.getElementById('parentAverage').textContent=mean; document.getElementById('parentSummary').textContent=finalGrade ? 'Nota përfundimtare: '+finalGrade.grade+' / 5' : chapters.length ? 'Bazuar në '+chapters.length+' kapituj të vlerësuar.' : 'Nuk ka ende kapituj të regjistruar.'; document.getElementById('parentDetails').innerHTML='<strong>Kapitujt e fundit</strong><p class="small muted">'+(chapters.length ? chapters.map(item=>item.name+': '+item.score.toFixed(1).replace('.',',')).join(' · ') : 'Vlerësimet do të shfaqen këtu pasi mësimdhënësi t’i regjistrojë.')+'</p>'+(messages.length?'<div class="parent-grade-messages">'+messages.map(item=>'<p><strong>'+escapeHtml(item.chapters?.name||'Kapitulli')+':</strong> '+escapeHtml(item.parent_message)+'</p>').join('')+'</div>':''); document.getElementById('parentSubjectList').classList.add('hidden'); document.getElementById('showParentSubjects').textContent='Shiko më shumë'; renderParentMoodChoices(); renderParentMoodHistory(); renderParentSubjectAverages(); showParentTab('today'); document.getElementById('parentPage').classList.add('hidden'); document.getElementById('parentDashboard').classList.remove('hidden'); }
    document.getElementById('continueParent').onclick=async()=>{ const email=document.getElementById('parentEmail').value.trim(); const password=document.getElementById('parentPassword').value; const status=document.getElementById('parentStatus'); if(!email||!password){status.textContent='Shkruani email-in dhe fjalëkalimin.';return;} status.textContent='Duke u kyçur…'; const {data,error}=await supabaseClient.auth.signInWithPassword({email,password}); if(error){status.textContent='Hyrja dështoi: '+error.message;return;} try {const student=await loadParentData(data.user); showParentDashboard(student);} catch(error){await supabaseClient.auth.signOut();status.textContent='Kjo llogari nuk është e autorizuar si prind.';} };
    document.getElementById('parentBack').onclick=()=>{ document.getElementById('parentDashboard').classList.add('hidden'); document.getElementById('parentPage').classList.remove('hidden'); };
    document.getElementById('parentTodayTab').onclick=()=>showParentTab('today');
    document.getElementById('parentResultsTab').onclick=()=>showParentTab('results');
    document.getElementById('showParentSubjects').onclick=()=>{ const list=document.getElementById('parentSubjectList'); const open=list.classList.toggle('hidden'); document.getElementById('showParentSubjects').textContent=open?'Shiko më shumë':'Mbyll listën'; };
    document.getElementById('parentHistoryToggle').onclick=()=>{ const box=document.getElementById('parentMoodHistory'); renderParentMoodHistory(); box.classList.add('show'); document.getElementById('parentHistoryToggle').setAttribute('aria-expanded','true'); };
    document.getElementById('saveParentMood').onclick=()=>{};
    document.getElementById('parentLogout').onclick=async()=>{ await supabaseClient.auth.signOut(); document.getElementById('parentDashboard').classList.add('hidden'); document.getElementById('roleGate').classList.remove('hidden'); };
    function buildTodayWorkspace(){ document.querySelector('.teacher-page-nav strong').textContent='Paneli i Nxënësit'; const main=document.querySelector('#appPhone main'); const support=document.createElement('section'); support.className='card today-extras compact-hidden'; support.id='assistiveSupport'; support.innerHTML='<div class="section-head"><div><h2>Mbështetje ndihmëse</h2><p class="small muted">Mjete të gatshme për orën e sotme.</p></div><span class="badge">Qasje</span></div><div class="assistive-actions"><button class="assistive-action" type="button" id="todayReadAloud"><span>🔊</span><span><strong>Lexo me zë</strong><small>Udhëzime audio</small></span></button><button class="assistive-action" type="button" id="todayInfo"><span>ⓘ</span><span><strong>Përshtatje</strong><small>Tekst i qartë dhe kontrast</small></span></button></div><p class="task-status" id="assistiveStatus"></p>'; const tasks=document.createElement('section'); tasks.className='card today-extras task-card compact-hidden'; tasks.id='todayTasks'; tasks.innerHTML='<div class="section-head"><div class="resource-top"><div class="task-icon">✎〰</div><div><p class="small muted">Detyra aktuale</p><h2>Lexo dhe përgjigju</h2></div></div><span class="badge">Sot</span></div><p class="small muted">Tekst i shkurtër me pyetje kuptimore, i përshtatur sipas profilit të nxënësit të zgjedhur.</p><div class="task-actions"><button class="btn primary" id="startTodayTask">▶ Fillo</button><button class="btn" id="listenTodayTask">🔊 Dëgjo</button></div><p class="task-status" id="todayTaskStatus"></p>'; main.append(support,tasks); document.getElementById('todayReadAloud').onclick=()=>document.getElementById('assistiveStatus').textContent='Leximi me zë është gati për materialin e sotëm.'; document.getElementById('todayInfo').onclick=()=>document.getElementById('assistiveStatus').textContent='Materiali përdor tekst të qartë, kontrast të lartë dhe hapa të shkurtër.'; document.getElementById('startTodayTask').onclick=()=>document.getElementById('todayTaskStatus').textContent='Ky aktivitet duhet të lidhet me një material real para përdorimit.'; document.getElementById('listenTodayTask').onclick=()=>{ speak('Lexo dhe përgjigju. Tekst i shkurtër me pyetje kuptimore.'); document.getElementById('todayTaskStatus').textContent='Leximi me zë u nis në shfletues.'; }; }
    function enhanceSupportChat(){ const panel=document.getElementById('supportPanel'); document.getElementById('supportTitlePanel').textContent='Asistenti për reagim të shpejtë'; const headBadge=panel.querySelector('.badge'); headBadge.className='assistant-avatar'; headBadge.setAttribute('aria-label','Asistenti pedagogjik'); headBadge.textContent='✦'; const intro=panel.querySelector('.assistant-intro'); intro.textContent='Shkruani pa emër apo të dhëna identifikuese çfarë po ndodh tani. Çdo përgjigje gjenerohet nga AI sipas mesazhit dhe jep hapa të menjëhershëm.'; const firstMessage=panel.querySelector('.message.agent'); firstMessage.textContent='Përshkruani shkurt sjelljen, mjedisin ose detyrën që po e nxit reagimin.'; const pupil=document.createElement('div'); pupil.className='support-student'; pupil.innerHTML='<span class="support-student-avatar">NX</span><span><strong>Nxënësi i zgjedhur</strong><br><small>Mbështetje pedagogjike pa të dhëna identifikuese</small></span>'; intro.before(pupil); const prompts=panel.querySelectorAll('[data-prompt]'); const icons=['◌','↗','◈']; prompts.forEach((button,index)=>{button.innerHTML='<span aria-hidden="true">'+icons[index]+'</span> '+button.textContent;}); const form=panel.querySelector('.chat-form'); const mic=document.createElement('button'); mic.type='button'; mic.className='voice-input'; mic.id='supportMic'; mic.setAttribute('aria-label','Dikto mesazhin'); mic.textContent='◉'; form.prepend(mic); const disclaimer=panel.querySelector('.chat-form + p'); disclaimer.classList.add('support-disclaimer'); mic.onclick=()=>{ document.getElementById('supportInput').focus(); mic.textContent='●'; setTimeout(()=>{mic.textContent='◉';},600); }; }
    const evaluationAnalyticsView=document.createElement('div'); evaluationAnalyticsView.className='evaluation-analytics'; evaluationAnalyticsView.id='evaluationAnalyticsView'; document.getElementById('evaluationPanel').appendChild(evaluationAnalyticsView);
    document.getElementById('evaluationToggle').addEventListener('click',()=>document.getElementById('evaluationPanel').classList.remove('analytics-open'));
    enhanceSupportChat();
    buildTodayWorkspace();
    const teacherMoodCalendar=document.createElement('aside'); teacherMoodCalendar.id='teacherMoodCalendar'; teacherMoodCalendar.setAttribute('aria-label','Historiku i humorit'); document.getElementById('teacherApp').appendChild(teacherMoodCalendar);
    function renderParentMoodHistory(){
      const box=document.getElementById('parentMoodHistory');
      const entries=parentActiveStudent?(moodHistory[parentActiveStudent.name]||[]):[];
      const reference=entries[0]?new Date(entries[0].date+'T12:00:00'):new Date();
      const year=reference.getFullYear();
      const month=reference.getMonth();
      const months=['Janar','Shkurt','Mars','Prill','Maj','Qershor','Korrik','Gusht','Shtator','Tetor','Nëntor','Dhjetor'];
      const weekdays=['Di','Hë','Ma','Më','En','Pr','Sh'];
      const firstDay=new Date(year,month,1).getDay();
      const totalDays=new Date(year,month+1,0).getDate();
      const moodsByDay=Object.fromEntries(entries.filter(entry=>{const date=new Date(entry.date+'T12:00:00');return date.getFullYear()===year&&date.getMonth()===month;}).map(entry=>[new Date(entry.date+'T12:00:00').getDate(),entry]));
      let calendar=weekdays.map(day=>'<span class="history-day-label">'+day+'</span>').join('');
      for(let i=0;i<firstDay;i++) calendar+='<span class="history-day empty">·</span>';
      for(let day=1;day<=totalDays;day++){
        const item=moodsByDay[day];
        const display=item?escapeHtml(item.mood.split(' ')[0]):day;
        const label=item?'Dita '+day+': '+item.mood:'Dita '+day+', pa njoftim';
        calendar+='<span class="history-day'+(item?'':' empty')+'" aria-label="'+escapeHtml(label)+'">'+display+'</span>';
      }
      const comments=entries.map(entry=>{ const markup=noticeHistoryMarkup(entry.comment); if(!markup) return ''; const date=new Date(entry.date+'T12:00:00'); return '<article class="parent-history-item"><strong>'+months[date.getMonth()]+' '+date.getDate()+'</strong><div class="history-comment-block small">'+markup+'</div></article>'; }).filter(Boolean).join('')||'<p class="small muted">Nuk ka komente shtesë për këtë muaj.</p>';
      box.innerHTML='<div class="history-panel-head"><div><p class="small muted">Historiku</p><h2>'+months[month]+' '+year+'</h2></div><button class="history-close" type="button" data-close-history aria-label="Mbyll historikun">×</button></div><div class="history-calendar" aria-label="Kalendari i humorit">'+calendar+'</div><h3 class="history-summary">Përmbledhja e komenteve mujore</h3><div class="history-entry-list">'+comments+'</div>';
      box.querySelector('[data-close-history]').onclick=()=>{box.classList.remove('show');document.getElementById('parentHistoryToggle').setAttribute('aria-expanded','false');};
    }
    function renderTeacherMoodCalendar(){
      const box=document.getElementById('teacherMoodCalendar');
      const student=storedStudents[activeStudent];
      const entries=student?(moodHistory[student.name]||[]):[];
      const reference=entries[0]?new Date(entries[0].date+'T12:00:00'):new Date();
      const year=reference.getFullYear();
      const month=reference.getMonth();
      const months=['Janar','Shkurt','Mars','Prill','Maj','Qershor','Korrik','Gusht','Shtator','Tetor','Nëntor','Dhjetor'];
      const weekdays=['Di','Hë','Ma','Më','En','Pr','Sh'];
      const firstDay=new Date(year,month,1).getDay();
      const totalDays=new Date(year,month+1,0).getDate();
      const moodsByDay=Object.fromEntries(entries.filter(entry=>{const date=new Date(entry.date+'T12:00:00');return date.getFullYear()===year&&date.getMonth()===month;}).map(entry=>[new Date(entry.date+'T12:00:00').getDate(),entry]));
      let calendar=weekdays.map(day=>'<span class="history-day-label">'+day+'</span>').join('');
      for(let i=0;i<firstDay;i++) calendar+='<span class="history-day empty">·</span>';
      for(let day=1;day<=totalDays;day++){
        const item=moodsByDay[day];
        const display=item?escapeHtml(item.mood.split(' ')[0]):day;
        const label=item?'Dita '+day+': '+item.mood:'Dita '+day+', pa njoftim';
        calendar+='<span class="history-day'+(item?'':' empty')+'" aria-label="'+escapeHtml(label)+'">'+display+'</span>';
      }
      const comments=entries.map(entry=>{ const markup=noticeHistoryMarkup(entry.comment,activeSubject); if(!markup) return ''; const date=new Date(entry.date+'T12:00:00'); return '<article class="parent-history-item"><strong>'+months[date.getMonth()]+' '+date.getDate()+'</strong><div class="history-comment-block small">'+markup+'</div></article>'; }).filter(Boolean).join('')||'<p class="small muted">Nuk ka komente për këtë mësimdhënës gjatë këtij muaji.</p>';
      box.innerHTML='<div class="history-panel-head"><div><p class="small muted">Historiku</p><h2>'+months[month]+' '+year+'</h2></div><button class="history-close" type="button" data-close-teacher-history aria-label="Mbyll historikun">×</button></div><div class="history-calendar" aria-label="Kalendari i humorit">'+calendar+'</div><h3 class="history-summary">Përmbledhja e komenteve mujore</h3><div class="history-entry-list">'+comments+'</div>';
      box.querySelector('[data-close-teacher-history]').onclick=()=>{box.classList.remove('show');document.getElementById('teacherMoodHistory').setAttribute('aria-expanded','false');};
    }
    function renderParentTeacherNotice(){
      const box=document.getElementById('parentTeacherNotice');
      if(!box||!parentActiveStudent) return;
      const notices=parentTeacherNotices.filter(item=>item.student_id===parentActiveStudent.id);
      const replies=parentNoticeReplies.filter(item=>item.subject_parent_notices?.student_id===parentActiveStudent.id);
      const latest=[...notices.map(item=>({...item,type:'notice'})),...replies.map(item=>({...item,type:'reply'}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
      box.innerHTML=latest?'<div class="resource-top"><div class="notice-icon">📨</div><div><h2>'+(latest.type==='reply'?'Përgjigje nga mësimdhënësi':'Njoftim nga mësimdhënësi')+'</h2><p class="small muted">'+escapeHtml(latest.message)+'</p></div></div>':'<div class="resource-top"><div class="notice-icon">📨</div><div><h2>Njoftim nga mësimdhënësi</h2><p class="small muted">Nuk ka njoftim të ri nga mësimdhënësi.</p></div></div>';
    }
    function buildTeacherParentNotice(){
      const main=document.querySelector('#appPhone main');
      const card=document.createElement('section');
      card.className='card teacher-parent-notice compact-hidden';
      card.id='teacherParentNotice';
      card.innerHTML='<div class="teacher-notice-head"><span class="teacher-notice-icon" aria-hidden="true">✉</span><div><span class="teacher-notice-eyebrow">Komunikim ditor</span><h2>Njoftim për prindin</h2><p class="small muted">Ndani shkurt përparimin ose një informacion të rëndësishëm nga dita.</p></div><span class="badge">Sot</span></div><label class="teacher-notice-field" for="teacherNoticeInput"><span>Mesazhi për prindin</span><textarea id="teacherNoticeInput" placeholder="P.sh. Sot ka punuar me hapa të shkurtër dhe i ka përfunduar dy ushtrimet e para."></textarea></label><button class="btn primary teacher-notice-send" id="saveTeacherNotice"><span aria-hidden="true">↗</span> Dërgo njoftimin</button><p class="task-status" id="teacherNoticeStatus" aria-live="polite"></p>';
      main.appendChild(card);
      document.getElementById('saveTeacherNotice').onclick=async()=>{
        const student=storedStudents[activeStudent];
        const notice=document.getElementById('teacherNoticeInput').value.trim();
        const status=document.getElementById('teacherNoticeStatus');
        const button=document.getElementById('saveTeacherNotice');
        if(!student||!student.id||!notice) return;
        button.disabled=true;
        status.textContent='Duke ruajtur njoftimin…';
        const result=await supabaseClient.from('teacher_parent_notices').insert({student_id:student.id,teacher_id:currentTeacherId,message:notice}).select('id,student_id,teacher_id,message,created_at,read_at').single();
        button.disabled=false;
        if(result.error){ status.textContent=userMessage(result.error,'Njoftimi nuk u ruajt. Kontrolloni autorizimin dhe provoni përsëri.'); return; }
        teacherNoticeRows.unshift(result.data);
        document.getElementById('teacherNoticeInput').value='';
        status.textContent='✓ Njoftimi u ruajt për prindin.';
      };
    }
    function buildParentTeacherNotice(){ const panel=document.getElementById('parentTodayPanel'); const card=document.createElement('section'); card.className='card parent-teacher-notice'; card.id='parentTeacherNotice'; panel.appendChild(card); }
    function enhanceParentCommentRouting(){
      const card=document.querySelector('.parent-comment-card');
      const saveButton=document.getElementById('saveParentMood');
      const existingLabel=card.querySelector('label');
      card.querySelector('h2').textContent='Njoftime për mësimdhënësit';
      const intro=document.createElement('p');
      intro.className='small muted';
      intro.textContent='Dërgoni një koment për të gjithë ose një mesazh shtesë vetëm për mësimdhënësin e një lënde.';
      card.querySelector('h2').after(intro);

      const general=document.createElement('section');
      general.className='parent-comment-group';
      general.innerHTML='<span class="comment-audience">Të gjithë mësimdhënësit</span><h3>Koment shtesë për të gjithë mësimdhënësit</h3><p class="small muted">Ky njoftim shfaqet te çdo mësimdhënës i nxënësit.</p>';
      existingLabel.style.marginTop='0';
      general.appendChild(existingLabel);

      const targeted=document.createElement('section');
      targeted.className='parent-comment-group targeted';
      targeted.innerHTML='<span class="comment-audience">Mësimdhënës i caktuar</span><h3>Koment shtesë për mësimdhënës të caktuar</h3><p class="small muted">Zgjidhni lëndën dhe shkruani njoftimin që duhet ta shohë vetëm ai mësimdhënës.</p><label><span>Lënda</span><select id="parentCommentSubject" aria-label="Zgjidhni lëndën për komentin specifik"></select></label><label><span>Komenti specifik</span><textarea id="parentSubjectComment" placeholder="P.sh. Sot ka dëshirë të lexojë me zë; ju lutem përfshijeni në aktivitetin e Gjuhës shqipe."></textarea></label>';
      const subjectSelect=targeted.querySelector('select');
      subjects.forEach(subject=>{ const option=document.createElement('option'); option.value=subject; option.textContent=subject; subjectSelect.appendChild(option); });
      card.insertBefore(general,saveButton);
      card.insertBefore(targeted,saveButton);
    }
    function enhanceTeacherMoodNotices(){
      const comment=document.getElementById('moodParentComment');
      const wrapper=document.createElement('div');
      wrapper.className='teacher-parent-comments';
      const general=document.createElement('article');
      general.className='teacher-parent-comment';
      const generalLabel=document.createElement('strong');
      generalLabel.textContent='Koment për të gjithë mësimdhënësit';
      comment.parentNode.insertBefore(wrapper,comment);
      general.append(generalLabel,comment);
      const specific=document.createElement('article');
      specific.className='teacher-parent-comment specific hidden';
      specific.id='teacherSpecificParentCommentBox';
      specific.innerHTML='<strong id="teacherSpecificParentCommentTitle">Koment për lëndën</strong><p id="teacherSpecificParentComment"></p>';
      wrapper.append(general,specific);
    }
    function buildParentTrendCard(){ const panel=document.getElementById('parentResultsPanel'); const card=document.createElement('section'); card.className='card parent-progress-card'; card.innerHTML='<div class="section-head"><div><h2>Ngritjet dhe uljet</h2><p class="small muted">Tendenca për secilën lëndë.</p></div><span class="badge">Progresi</span></div><div class="parent-trend-list" id="parentSubjectTrends"></div>'; panel.appendChild(card); }
    function renderParentSubjectTrends(){ const box=document.getElementById('parentSubjectTrends'); if(!box) return; const averages=Object.fromEntries(parentSubjectAverages.map(item=>[item.name,item.average])); box.innerHTML=''; subjects.forEach(name=>{ const value=averages[name]; const row=document.createElement('div'); row.className='parent-trend-row'; if(value===undefined){ row.innerHTML='<strong>'+name+'</strong><span class="small muted">Pa të dhëna</span><div class="parent-trend-track"><div class="parent-trend-fill" style="width:0"></div></div>'; } else { const strong=value>=4; const label=strong?'↑ Ngritje e qëndrueshme':'↓ Kërkon përforcim'; row.innerHTML='<strong>'+name+'</strong><span class="'+(strong?'parent-trend-up':'parent-trend-watch')+'">'+label+'</span><div class="parent-trend-track"><div class="parent-trend-fill '+(strong?'':'watch')+'" style="width:'+(value*20)+'%"></div></div>'; } box.appendChild(row); }); }
    buildTeacherParentNotice();
    buildParentTeacherNotice();
    enhanceParentCommentRouting();
    enhanceTeacherMoodNotices();
    const showParentDashboardBase=showParentDashboard;
    showParentDashboard=function(student){
      showParentDashboardBase(student);
      const note=dailyMoods[student.name];
      const notice=readParentNotice(note?note.comment:'');
      document.getElementById('parentMoodComment').value=notice.general;
      document.getElementById('parentCommentSubject').value=subjects.includes(notice.subject)?notice.subject:subjects[0];
      document.getElementById('parentSubjectComment').value=notice.specific;
    };
    document.getElementById('saveParentMood').onclick=async()=>{
      if(!parentActiveStudent||!currentUser) return;
      const general=document.getElementById('parentMoodComment').value.trim();
      const subject=document.getElementById('parentCommentSubject').value;
      const specific=document.getElementById('parentSubjectComment').value.trim();
      const reportedOn=todayIso();
      const status=document.getElementById('parentMoodStatus');
      const saveButton=document.getElementById('saveParentMood');
      saveButton.disabled=true;
      status.textContent='Duke dërguar njoftimet…';
      const moodResult=await supabaseClient.from('daily_moods').upsert({student_id:parentActiveStudent.id,parent_id:currentUser.id,mood:parentSelectedMood,general_comment:general,parent_comment:general,reported_on:reportedOn},{onConflict:'student_id,parent_id,reported_on'});
      if(moodResult.error){ saveButton.disabled=false; status.textContent=userMessage(moodResult.error,'Njoftimi nuk u ruajt. Kontrolloni autorizimin dhe provoni përsëri.'); return; }
      if(specific){
        const subjectResult=await supabaseClient.from('subjects').select('id').eq('name',subject).single();
        if(subjectResult.error){ saveButton.disabled=false; status.textContent=userMessage(subjectResult.error,'Komenti specifik nuk u ruajt sepse lënda nuk u gjet.'); return; }
        const commentResult=await supabaseClient.from('subject_parent_notices').insert({student_id:parentActiveStudent.id,parent_id:currentUser.id,subject_id:subjectResult.data.id,comment:specific});
        if(commentResult.error){ saveButton.disabled=false; status.textContent=userMessage(commentResult.error,'Komenti specifik nuk u ruajt. Kontrolloni autorizimin dhe provoni përsëri.'); return; }
      }
      saveButton.disabled=false;
      const storedComment=writeParentNotice(general,subject,specific);
      const name=parentActiveStudent.name;
      dailyMoods[name]={mood:parentSelectedMood,comment:storedComment};
      moodHistory[name]=[{date:reportedOn,mood:parentSelectedMood,comment:storedComment},...(moodHistory[name]||[]).filter(entry=>entry.date!==reportedOn)];
      status.textContent=specific?'✓ Komenti i përgjithshëm iu dërgua të gjithëve; komenti specifik vetëm mësimdhënësit të '+subject+'.':'✓ Komenti i përgjithshëm iu dërgua të gjithë mësimdhënësve.';
      renderParentMoodHistory();
      renderDailyMoods();
    };
    buildParentTrendCard();
    document.getElementById('parentResultsTab').addEventListener('click',renderParentSubjectTrends);
    renderStudents(); renderEvaluationFolders(); renderDailyMoods(); renderChapters(); updateResource();
