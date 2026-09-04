[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

function Import-DotEnv {
  param([string]$Path)

  Get-Content -LiteralPath $Path | ForEach-Object {
    if (-not $_ -or $_.TrimStart().StartsWith("#")) { return }
    $parts = $_ -split "=", 2
    if ($parts.Count -ne 2) { return }
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "env:$name" -Value $value
  }
}

Import-DotEnv -Path (Join-Path $projectRoot ".env")

$baseUrl = $env:SUPABASE_URL.TrimEnd("/")
$serviceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
$publishableKey = $env:SUPABASE_PUBLISHABLE_KEY

if (-not $baseUrl -or -not $serviceRoleKey -or -not $publishableKey) {
  throw "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_PUBLISHABLE_KEY must exist in .env."
}

$serviceHeaders = @{
  apikey        = $serviceRoleKey
  Authorization = "Bearer $serviceRoleKey"
  "Content-Type" = "application/json"
}

$loginHeaders = @{
  apikey        = $publishableKey
  "Content-Type" = "application/json"
}

function To-JsonBody {
  param([Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    if ($null -eq $InputObject) { return $null }
    return ($InputObject | ConvertTo-Json -Depth 20 -Compress)
  }
}

function Invoke-SupabaseRest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    $Body,
    [string]$Prefer = "return=representation"
  )

  $headers = @{}
  foreach ($key in $serviceHeaders.Keys) {
    $headers[$key] = $serviceHeaders[$key]
  }
  if ($Prefer) {
    $headers["Prefer"] = $Prefer
  }

  $params = @{
    Method  = $Method
    Uri     = "$baseUrl$Path"
    Headers = $headers
  }

  if ($null -ne $Body) {
    $params["Body"] = ($Body | To-JsonBody)
  }

  Invoke-RestMethod @params
}

function Remove-AuthUser {
  param([string]$UserId)

  try {
    Invoke-RestMethod -Method Delete -Uri "$baseUrl/auth/v1/admin/users/$UserId?should_soft_delete=false" -Headers $serviceHeaders | Out-Null
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -ne 404) {
      throw
    }
  }
}

function New-AuthUser {
  param(
    [string]$Email,
    [string]$Password
  )

  $body = @{
    email         = $Email
    password      = $Password
    email_confirm = $true
    app_metadata  = @{
      provider  = "email"
      providers = @("email")
    }
    user_metadata = @{}
  }

  $response = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/v1/admin/users" -Headers $serviceHeaders -Body ($body | To-JsonBody)
  if ($response.user) { return $response.user }
  return $response
}

function New-RowId {
  ([guid]::NewGuid()).Guid
}

function LowerKey {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return $Value.Trim().ToLowerInvariant()
}

function PersonName {
  param($Row)
  return "$($Row.first_name) $($Row.last_name)".Trim()
}

function Create-RichText {
  param(
    [string]$FirstPreference,
    [string]$SecondPreference
  )

  return "Punon me mire kur udhezimet lidhen me $FirstPreference dhe pasohen me aktivitete nepermjet $SecondPreference."
}

function Create-AccessText {
  param([string]$FirstPreference)
  return "Udhezime te shkurtra, fjali te qarta dhe kohe e mjaftueshme per ta kthyer detyren ne hap te prekshëm me fokus te vecante te $FirstPreference."
}

function Clear-Table {
  param(
    [string]$Table,
    [string]$FilterColumn = "id"
  )

  Invoke-SupabaseRest -Method Delete -Path "/rest/v1/$Table?$FilterColumn=not.is.null" -Prefer "return=minimal" | Out-Null
}

$today = Get-Date
$todayDate = $today.ToString("yyyy-MM-dd")
$yesterdayDate = $today.AddDays(-1).ToString("yyyy-MM-dd")
$twoDaysAgoDate = $today.AddDays(-2).ToString("yyyy-MM-dd")
$nowIso = $today.ToString("o")

$school = @{
  id      = New-RowId
  name    = 'SHFMU "Iliria"'
  address = "Prishtine, Kosove"
}

$classes = @(
  @{ id = New-RowId; school_id = $school.id; name = "V-A"; school_year = "2026/2027"; active = $true },
  @{ id = New-RowId; school_id = $school.id; name = "V-B"; school_year = "2026/2027"; active = $true }
)

$teachers = @(
  @{ first_name = "Arta"; last_name = "Berisha"; subject = "Gjuhë shqipe"; email = "arta.berisha@shkolla.edu" },
  @{ first_name = "Besnik"; last_name = "Krasniqi"; subject = "Matematikë"; email = "besnik.krasniqi@shkolla.edu" },
  @{ first_name = "Valbona"; last_name = "Gashi"; subject = "Edukatë fizike"; email = "valbona.gashi@shkolla.edu" },
  @{ first_name = "Fatos"; last_name = "Hoxha"; subject = "Edukatë figurative (Art)"; email = "fatos.hoxha@shkolla.edu" },
  @{ first_name = "Teuta"; last_name = "Kelmendi"; subject = "Edukatë muzikore"; email = "teuta.kelmendi@shkolla.edu" },
  @{ first_name = "Ilir"; last_name = "Morina"; subject = "Gjeografi"; email = "ilir.morina@shkolla.edu" },
  @{ first_name = "Lindita"; last_name = "Kastrati"; subject = "Biologji"; email = "lindita.kastrati@shkolla.edu" },
  @{ first_name = "Driton"; last_name = "Shala"; subject = "TIK"; email = "driton.shala@shkolla.edu" },
  @{ first_name = "Edona"; last_name = "Bytyqi"; subject = "Gjuhë angleze"; email = "edona.bytyqi@shkolla.edu" },
  @{ first_name = "Arianit"; last_name = "Rama"; subject = "Kimi"; email = "arianit.rama@shkolla.edu" }
)

$assistants = @(
  @{ first_name = "Mirela"; last_name = "Nimani"; email = "mirela.nimani@shkolla.edu" },
  @{ first_name = "Gent"; last_name = "Dema"; email = "gent.dema@shkolla.edu" },
  @{ first_name = "Adelina"; last_name = "Peci"; email = "adelina.peci@shkolla.edu" },
  @{ first_name = "Blerim"; last_name = "Qorri"; email = "blerim.qorri@shkolla.edu" },
  @{ first_name = "Saranda"; last_name = "Gashi"; email = "saranda.gashi@shkolla.edu" }
)

$parents = @(
  @{ first_name = "Agron"; last_name = "Krasniqi"; email = "agron.krasniqi@email.com"; students = @("Arian Krasniqi") },
  @{ first_name = "Blerta"; last_name = "Berisha"; email = "blerta.berisha@email.com"; students = @("Era Berisha") },
  @{ first_name = "Bekim"; last_name = "Gashi"; email = "bekim.gashi@email.com"; students = @("Dren Gashi") },
  @{ first_name = "Pranvera"; last_name = "Kastrati"; email = "pranvera.k@email.com"; students = @("Lira Kastrati") },
  @{ first_name = "Petrit"; last_name = "Morina"; email = "petrit.morina@email.com"; students = @("Noar Morina") },
  @{ first_name = "Gentiana"; last_name = "Bytyqi"; email = "gentiana.bytyqi@email.com"; students = @("Jona Bytyqi") },
  @{ first_name = "Fatmir"; last_name = "Kelmendi"; email = "fatmir.k@email.com"; students = @("Yll Kelmendi") },
  @{ first_name = "Alban"; last_name = "Hoxha"; email = "alban.hoxha@email.com"; students = @("Rinesa Hoxha", "Luan Hoxha") },
  @{ first_name = "Fisnik"; last_name = "Shala"; email = "fisnik.shala@email.com"; students = @("Rron Shala") },
  @{ first_name = "Blerta"; last_name = "Rama"; email = "blerta.rama@email.com"; students = @("Tara Rama", "Olti Dugolli") },
  @{ first_name = "Valon"; last_name = "Ahmeti"; email = "valon.ahmeti@email.com"; students = @("Diar Ahmeti") },
  @{ first_name = "Shpresa"; last_name = "Zeqiri"; email = "shpresa.z@email.com"; students = @("Bora Zeqiri") },
  @{ first_name = "Genc"; last_name = "Rexhepi"; email = "genc.rexhepi@email.com"; students = @("Arti Rexhepi") },
  @{ first_name = "Mimoza"; last_name = "Kryeziu"; email = "mimoza.k@email.com"; students = @("Elsa Kryeziu") },
  @{ first_name = "Kushtrim"; last_name = "Musliu"; email = "kushtrim.m@email.com"; students = @("Luan Musliu") },
  @{ first_name = "Besa"; last_name = "Maliqi"; email = "besa.maliqi@email.com"; students = @("Nita Maliqi") },
  @{ first_name = "Luan"; last_name = "Hoti"; email = "luan.hoti@email.com"; students = @("Krenar Hoti") },
  @{ first_name = "Donika"; last_name = "Bajrami"; email = "donika.b@email.com"; students = @("Lea Bajrami") },
  @{ first_name = "Mentor"; last_name = "Kabashi"; email = "mentor.kabashi@email.com"; students = @("Ledion Kabashi") },
  @{ first_name = "Edona"; last_name = "Sopa"; email = "edona.sopa@email.com"; students = @("Dua Sopa") },
  @{ first_name = "Arben"; last_name = "Lushi"; email = "arben.lushi@email.com"; students = @("Andi Lushi") },
  @{ first_name = "Venera"; last_name = "Gacaferi"; email = "venera.g@email.com"; students = @("Hana Gacaferi", "Aria Thaqi") }
)

$students = @(
  @{ first_name = "Arian"; last_name = "Krasniqi"; class_name = "V-A"; pref1 = "Vizatim"; pref2 = "Praktikë" },
  @{ first_name = "Era"; last_name = "Berisha"; class_name = "V-A"; pref1 = "Dëgjim"; pref2 = "Bashkëpunim" },
  @{ first_name = "Dren"; last_name = "Gashi"; class_name = "V-A"; pref1 = "Praktikë"; pref2 = "Lëvizje" },
  @{ first_name = "Lira"; last_name = "Kastrati"; class_name = "V-A"; pref1 = "Vizatim"; pref2 = "Shkrim" },
  @{ first_name = "Noar"; last_name = "Morina"; class_name = "V-A"; pref1 = "Lëvizje"; pref2 = "Praktikë" },
  @{ first_name = "Jona"; last_name = "Bytyqi"; class_name = "V-A"; pref1 = "Dëgjim"; pref2 = "Bashkëpunim" },
  @{ first_name = "Yll"; last_name = "Kelmendi"; class_name = "V-A"; pref1 = "Lexim"; pref2 = "Praktikë" },
  @{ first_name = "Rinesa"; last_name = "Hoxha"; class_name = "V-A"; pref1 = "Vizatim"; pref2 = "Dëgjim" },
  @{ first_name = "Rron"; last_name = "Shala"; class_name = "V-A"; pref1 = "Dëgjim"; pref2 = "Lexim" },
  @{ first_name = "Tara"; last_name = "Rama"; class_name = "V-A"; pref1 = "Praktikë"; pref2 = "Vizatim" },
  @{ first_name = "Diar"; last_name = "Ahmeti"; class_name = "V-A"; pref1 = "Lëvizje"; pref2 = "Bashkëpunim" },
  @{ first_name = "Bora"; last_name = "Zeqiri"; class_name = "V-A"; pref1 = "Lëvizje"; pref2 = "Dëgjim" },
  @{ first_name = "Arti"; last_name = "Rexhepi"; class_name = "V-A"; pref1 = "Shkrim"; pref2 = "Vizatim" },
  @{ first_name = "Elsa"; last_name = "Kryeziu"; class_name = "V-B"; pref1 = "Lexim"; pref2 = "Bashkëpunim" },
  @{ first_name = "Luan"; last_name = "Musliu"; class_name = "V-B"; pref1 = "Praktikë"; pref2 = "Dëgjim" },
  @{ first_name = "Nita"; last_name = "Maliqi"; class_name = "V-B"; pref1 = "Vizatim"; pref2 = "Praktikë" },
  @{ first_name = "Krenar"; last_name = "Hoti"; class_name = "V-B"; pref1 = "Lëvizje"; pref2 = "Shkrim" },
  @{ first_name = "Lea"; last_name = "Bajrami"; class_name = "V-B"; pref1 = "Bashkëpunim"; pref2 = "Dëgjim" },
  @{ first_name = "Ledion"; last_name = "Kabashi"; class_name = "V-B"; pref1 = "Vizatim"; pref2 = "Lexim" },
  @{ first_name = "Dua"; last_name = "Sopa"; class_name = "V-B"; pref1 = "Dëgjim"; pref2 = "Bashkëpunim" },
  @{ first_name = "Andi"; last_name = "Lushi"; class_name = "V-B"; pref1 = "Praktikë"; pref2 = "Vizatim" },
  @{ first_name = "Hana"; last_name = "Gacaferi"; class_name = "V-B"; pref1 = "Shkrim"; pref2 = "Lexim" },
  @{ first_name = "Olti"; last_name = "Dugolli"; class_name = "V-B"; pref1 = "Lëvizje"; pref2 = "Praktikë" },
  @{ first_name = "Aria"; last_name = "Thaqi"; class_name = "V-B"; pref1 = "Dëgjim"; pref2 = "Vizatim" },
  @{ first_name = "Luan"; last_name = "Hoxha"; class_name = "V-B"; pref1 = "Shkrim"; pref2 = "Bashkëpunim" }
)

$assistantAssignments = @{
  "mirela.nimani@shkolla.edu" = @("Arian Krasniqi", "Era Berisha", "Dren Gashi", "Lira Kastrati", "Noar Morina")
  "gent.dema@shkolla.edu" = @("Jona Bytyqi", "Yll Kelmendi", "Rinesa Hoxha", "Rron Shala", "Tara Rama")
  "adelina.peci@shkolla.edu" = @("Diar Ahmeti", "Bora Zeqiri", "Arti Rexhepi", "Elsa Kryeziu", "Luan Musliu")
  "blerim.qorri@shkolla.edu" = @("Nita Maliqi", "Krenar Hoti", "Lea Bajrami", "Ledion Kabashi", "Dua Sopa")
  "saranda.gashi@shkolla.edu" = @("Andi Lushi", "Hana Gacaferi", "Olti Dugolli", "Aria Thaqi", "Luan Hoxha")
}

$students | ForEach-Object { $_.id = New-RowId }
$admin = @{
  first_name = "Admin"
  last_name  = "Shkolla"
  email      = "admin@shkolla.org"
  password   = "administrata"
}

$classIdByName = @{}
$classes | ForEach-Object { $classIdByName[$_.name] = $_.id }
$studentByName = @{}
$students | ForEach-Object {
  $_.school_id = $school.id
  $_.class_id = $classIdByName[$_.class_name]
  $_.status = "active"
  $_.active = $true
  $studentByName["$($_.first_name) $($_.last_name)"] = $_
}

$parentByEmail = @{}
$parents | ForEach-Object { $parentByEmail[$_.email] = $_ }
$teacherByEmail = @{}
$teachers | ForEach-Object { $teacherByEmail[$_.email] = $_ }
$assistantByEmail = @{}
$assistants | ForEach-Object { $assistantByEmail[$_.email] = $_ }

Write-Host "Removing existing application profiles and auth users..."
$existingProfiles = @(Invoke-SupabaseRest -Method Get -Path "/rest/v1/profiles?select=id,email,role,school_id")
foreach ($profile in $existingProfiles) {
  Remove-AuthUser -UserId $profile.id
}

Write-Host "Clearing remaining school data..."
$clearSteps = @(
  @{ table = "communication_messages"; filter = "id" },
  @{ table = "communication_threads"; filter = "id" },
  @{ table = "user_notifications"; filter = "id" },
  @{ table = "parent_notification_preferences"; filter = "profile_id" },
  @{ table = "teacher_notification_preferences"; filter = "profile_id" },
  @{ table = "parent_notice_replies"; filter = "id" },
  @{ table = "teacher_parent_notices"; filter = "id" },
  @{ table = "subject_parent_notices"; filter = "id" },
  @{ table = "pia_objective_updates"; filter = "id" },
  @{ table = "pia_objectives"; filter = "id" },
  @{ table = "staff_mood_logs"; filter = "id" },
  @{ table = "final_grades"; filter = "id" },
  @{ table = "grades"; filter = "id" },
  @{ table = "material_retention_warnings"; filter = "id" },
  @{ table = "class_material_files"; filter = "id" },
  @{ table = "class_material_recipients"; filter = "material_id" },
  @{ table = "class_materials"; filter = "id" },
  @{ table = "daily_moods"; filter = "id" },
  @{ table = "student_support_profiles"; filter = "id" },
  @{ table = "assistant_teacher_students"; filter = "assistant_teacher_id" },
  @{ table = "teacher_classes"; filter = "teacher_id" },
  @{ table = "teacher_students"; filter = "teacher_id" },
  @{ table = "teacher_subjects"; filter = "teacher_id" },
  @{ table = "parent_students"; filter = "parent_id" },
  @{ table = "students"; filter = "id" },
  @{ table = "academic_periods"; filter = "id" },
  @{ table = "school_subjects"; filter = "school_id" },
  @{ table = "classes"; filter = "id" },
  @{ table = "profiles"; filter = "id" },
  @{ table = "schools"; filter = "id" },
  @{ table = "chapters"; filter = "id" }
)
foreach ($step in $clearSteps) {
  Clear-Table -Table $step.table -FilterColumn $step.filter
}

Write-Host "Creating auth users..."
$admin.id = (New-AuthUser -Email $admin.email -Password $admin.password).id
foreach ($teacher in $teachers) {
  $teacher.id = (New-AuthUser -Email $teacher.email -Password "Temp123").id
}
foreach ($assistant in $assistants) {
  $assistant.id = (New-AuthUser -Email $assistant.email -Password "Temp123").id
}
foreach ($parent in $parents) {
  $parent.id = (New-AuthUser -Email $parent.email -Password "Temp123").id
}

Write-Host "Seeding school structure..."
Invoke-SupabaseRest -Method Post -Path "/rest/v1/schools" -Body @($school) | Out-Null
Invoke-SupabaseRest -Method Post -Path "/rest/v1/classes" -Body $classes | Out-Null

$allProfiles = @(
  @{
    id         = $admin.id
    school_id  = $school.id
    role       = "admin"
    first_name = $admin.first_name
    last_name  = $admin.last_name
    email      = $admin.email
    active     = $true
  }
) + @(
  $teachers | ForEach-Object {
    @{
      id                   = $_.id
      school_id            = $school.id
      role                 = "teacher"
      first_name           = $_.first_name
      last_name            = $_.last_name
      email                = $_.email
      active               = $true
      is_assistant_teacher = $false
    }
  }
) + @(
  $assistants | ForEach-Object {
    @{
      id                   = $_.id
      school_id            = $school.id
      role                 = "teacher"
      first_name           = $_.first_name
      last_name            = $_.last_name
      email                = $_.email
      active               = $true
      is_assistant_teacher = $true
    }
  }
) + @(
  $parents | ForEach-Object {
    @{
      id         = $_.id
      school_id  = $school.id
      role       = "parent"
      first_name = $_.first_name
      last_name  = $_.last_name
      email      = $_.email
      active     = $true
    }
  }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/profiles" -Body $allProfiles | Out-Null

$usedSubjectNames = @($teachers.subject | Sort-Object -Unique)
$existingSubjects = @(Invoke-SupabaseRest -Method Get -Path "/rest/v1/subjects?select=id,name,active")
$subjectByKey = @{}
foreach ($subject in $existingSubjects) {
  $subjectByKey[(LowerKey $subject.name)] = $subject
}

$missingSubjects = @()
foreach ($name in $usedSubjectNames) {
  $key = LowerKey $name
  if (-not $subjectByKey.ContainsKey($key)) {
    $missingSubjects += @{ name = $name; active = $true }
  }
}
if ($missingSubjects.Count) {
  $createdSubjects = @(Invoke-SupabaseRest -Method Post -Path "/rest/v1/subjects" -Body $missingSubjects)
  foreach ($subject in $createdSubjects) {
    $subjectByKey[(LowerKey $subject.name)] = $subject
  }
}

$teacherSubjectRows = @()
foreach ($teacher in $teachers) {
  $subject = $subjectByKey[(LowerKey $teacher.subject)]
  $teacher.subject_id = $subject.id
  $teacherSubjectRows += @{
    teacher_id = $teacher.id
    subject_id = $subject.id
  }
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/teacher_subjects" -Body $teacherSubjectRows | Out-Null

$schoolSubjectRows = @()
foreach ($name in $usedSubjectNames) {
  $subject = $subjectByKey[(LowerKey $name)]
  $schoolSubjectRows += @{
    school_id  = $school.id
    subject_id = $subject.id
    active     = $true
  }
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/school_subjects" -Body $schoolSubjectRows | Out-Null

$teacherClassRows = @()
foreach ($teacher in $teachers) {
  foreach ($class in $classes) {
    $teacherClassRows += @{
      teacher_id = $teacher.id
      class_id   = $class.id
      subject_id = $teacher.subject_id
    }
  }
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/teacher_classes" -Body $teacherClassRows | Out-Null

Write-Host "Seeding students, parents, and support profiles..."
Invoke-SupabaseRest -Method Post -Path "/rest/v1/students" -Body @(
  $students | ForEach-Object {
    @{
      id         = $_.id
      school_id  = $_.school_id
      class_id   = $_.class_id
      first_name = $_.first_name
      last_name  = $_.last_name
      class_name = $_.class_name
      status     = $_.status
      active     = $_.active
    }
  }
) | Out-Null

$parentStudentRows = @()
foreach ($parent in $parents) {
  foreach ($studentName in $parent.students) {
    $student = $studentByName[$studentName]
    $parentStudentRows += @{
      parent_id  = $parent.id
      student_id = $student.id
    }
  }
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/parent_students" -Body $parentStudentRows | Out-Null

$assistantStudentRows = @()
foreach ($assistantEmail in $assistantAssignments.Keys) {
  $assistant = $assistantByEmail[$assistantEmail]
  foreach ($studentName in $assistantAssignments[$assistantEmail]) {
    $assistantStudentRows += @{
      assistant_teacher_id = $assistant.id
      student_id           = $studentByName[$studentName].id
    }
  }
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/assistant_teacher_students" -Body $assistantStudentRows | Out-Null

$supportProfiles = @(
  $students | ForEach-Object {
    @{
      student_id = $_.id
      support_summary = Create-RichText -FirstPreference $_.pref1 -SecondPreference $_.pref2
      accessibility_information = Create-AccessText -FirstPreference $_.pref1
      preferences = @{
        preferred_mode = $_.pref1
        support_preferences = @($_.pref1, $_.pref2)
        learning_preferences = @($_.pref1, $_.pref2)
        communication_language = "Shqip"
        communication_method = if ($_.pref1 -eq "Dëgjim") { "Udhëzim verbal i qetë" } elseif ($_.pref1 -eq "Shkrim") { "Pika të shkurtra me shkrim" } else { "Modelim dhe rikujtim i shkurtër" }
        additional_notes = "Preferon ritëm të qartë dhe kalime të buta ndërmjet detyrave."
      }
    }
  }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/student_support_profiles" -Body $supportProfiles | Out-Null

$period = @{
  id          = New-RowId
  school_id   = $school.id
  name        = "Gjysmëvjetori I"
  school_year = "2026/2027"
  starts_on   = "2026-09-01"
  ends_on     = "2027-01-31"
  status      = "active"
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/academic_periods" -Body @($period) | Out-Null

$teacherPrefs = @(
  ($teachers + $assistants) | ForEach-Object {
    @{
      profile_id = $_.id
      notification_email = $_.email
      parent_message_emails = $true
      daily_digest_emails = $false
    }
  }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/teacher_notification_preferences" -Body $teacherPrefs | Out-Null

$parentPrefs = @(
  $parents | ForEach-Object {
    @{
      profile_id = $_.id
      notification_email = $_.email
      teacher_message_emails = $true
      assessment_emails = $true
      material_emails = $false
    }
  }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/parent_notification_preferences" -Body $parentPrefs | Out-Null

Write-Host "Seeding moods, chapters, grades, and PIA..."
$dailyMoods = @(
  @{ student = "Arian Krasniqi"; parent = "agron.krasniqi@email.com"; mood = "😊 I qetë"; comment = "E nisi ditën mirë dhe është gati për detyrat me hapa të shkurtër."; reported_on = $todayDate },
  @{ student = "Era Berisha"; parent = "blerta.berisha@email.com"; mood = "🙂 E motivuar"; comment = "Ka ardhur me humor të mirë dhe pret të lexojë me zë."; reported_on = $todayDate },
  @{ student = "Dren Gashi"; parent = "bekim.gashi@email.com"; mood = "⚡ Ka shumë energji"; comment = "Ka nevojë për lëvizje të shkurtra mes aktiviteteve."; reported_on = $todayDate },
  @{ student = "Elsa Kryeziu"; parent = "mimoza.k@email.com"; mood = "😌 E fokusuar"; comment = "Sot preferon kohë të qetë për lexim dhe bashkëpunim."; reported_on = $todayDate },
  @{ student = "Lea Bajrami"; parent = "donika.b@email.com"; mood = "🙂 E hapur"; comment = "Reagon mirë kur fillon me punë në çift."; reported_on = $todayDate },
  @{ student = "Aria Thaqi"; parent = "venera.g@email.com"; mood = "😴 Pak e lodhur"; comment = "Një pushim i shkurtër në fillim e ndihmon të hyjë në ritëm."; reported_on = $todayDate },
  @{ student = "Arian Krasniqi"; parent = "agron.krasniqi@email.com"; mood = "🙂 Në rregull"; comment = "Ditë më e qetë, kërkon rikujtime vizuale."; reported_on = $yesterdayDate },
  @{ student = "Elsa Kryeziu"; parent = "mimoza.k@email.com"; mood = "😊 E qetë"; comment = "Ka punuar mirë me partneren e bankës."; reported_on = $twoDaysAgoDate }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/daily_moods" -Body @(
  $dailyMoods | ForEach-Object {
    @{
      student_id = $studentByName[$_.student].id
      parent_id = $parentByEmail[$_.parent].id
      mood = $_.mood
      general_comment = $_.comment
      parent_comment = $_.comment
      reported_on = $_.reported_on
    }
  }
) | Out-Null

$staffMoodLogs = @(
  @{ student = "Arian Krasniqi"; reporter = "besnik.krasniqi@shkolla.edu"; role = "teacher"; mood = "I përqendruar"; comment = "Punoi mirë me materiale konkrete në matematikë."; context = "Ora e parë"; reported_on = $todayDate },
  @{ student = "Era Berisha"; reporter = "mirela.nimani@shkolla.edu"; role = "assistant"; mood = "E angazhuar"; comment = "Hyri shpejt në detyrë pas një udhëzimi të shkurtër."; context = "Lexim i udhëhequr"; reported_on = $todayDate },
  @{ student = "Elsa Kryeziu"; reporter = "adelina.peci@shkolla.edu"; role = "assistant"; mood = "E qëndrueshme"; comment = "Ka bashkëpunuar mirë dhe ka kërkuar ndihmë në mënyrë të qartë."; context = "Punë në grup"; reported_on = $todayDate },
  @{ student = "Lea Bajrami"; reporter = "blerim.qorri@shkolla.edu"; role = "assistant"; mood = "E qetë"; comment = "Punoi më mirë pasi u modelua hapi i parë."; context = "PIA"; reported_on = $todayDate },
  @{ student = "Aria Thaqi"; reporter = "saranda.gashi@shkolla.edu"; role = "assistant"; mood = "Po rigjen ritmin"; comment = "U rikthye mirë pas një pushimi të shkurtër."; context = "Pas pushimit"; reported_on = $todayDate }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/staff_mood_logs" -Body @(
  $staffMoodLogs | ForEach-Object {
    @{
      student_id = $studentByName[$_.student].id
      reporter_id = if ($_.role -eq "teacher") { $teacherByEmail[$_.reporter].id } else { $assistantByEmail[$_.reporter].id }
      reporter_role = $_.role
      mood = $_.mood
      comment = $_.comment
      context = $_.context
      reported_on = $_.reported_on
    }
  }
) | Out-Null

$chapters = @(
  @{ id = New-RowId; subject = "Matematikë"; name = "Numrat dhe veprimet"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Matematikë"; name = "Probleme me tekst"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Gjuhë shqipe"; name = "Leximi kuptimor"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Gjuhë shqipe"; name = "Shkrimi i paragrafit"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Edukatë fizike"; name = "Koordinimi dhe ritmi"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Edukatë fizike"; name = "Lojëra bashkëpunuese"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Edukatë figurative (Art)"; name = "Ngjyra dhe kompozimi"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Edukatë figurative (Art)"; name = "Vëzhgim dhe vizatim"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Edukatë muzikore"; name = "Ritmi bazë"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Edukatë muzikore"; name = "Dëgjim aktiv"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Gjeografi"; name = "Harta dhe drejtimet"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Gjeografi"; name = "Vendbanimi ynë"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Biologji"; name = "Bimët dhe mjedisi"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Biologji"; name = "Trupi i njeriut"; target_score = 4.0 },
  @{ id = New-RowId; subject = "TIK"; name = "Përdorimi i tastierës"; target_score = 4.0 },
  @{ id = New-RowId; subject = "TIK"; name = "Siguria digjitale"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Gjuhë angleze"; name = "My Classroom"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Gjuhë angleze"; name = "Daily Routines"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Kimi"; name = "Lëndët dhe vetitë"; target_score = 4.0 },
  @{ id = New-RowId; subject = "Kimi"; name = "Përzierjet"; target_score = 4.0 }
)
$chapterRows = @()
$chapterBySubjectAndName = @{}
foreach ($chapter in $chapters) {
  $subject = $subjectByKey[(LowerKey $chapter.subject)]
  $chapterRows += @{
    id = $chapter.id
    subject_id = $subject.id
    name = $chapter.name
    target_score = $chapter.target_score
    active = $true
  }
  $chapterBySubjectAndName["$($chapter.subject)|$($chapter.name)"] = $chapter.id
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/chapters" -Body $chapterRows | Out-Null

$gradePlans = @(
  @{ student = "Arian Krasniqi"; teacher = "besnik.krasniqi@shkolla.edu"; subject = "Matematikë"; chapter = "Numrat dhe veprimet"; score = 4.4; message = "Ariani po e kap mirë ritmin kur përdor hapa të vizatuar." },
  @{ student = "Arian Krasniqi"; teacher = "besnik.krasniqi@shkolla.edu"; subject = "Matematikë"; chapter = "Probleme me tekst"; score = 4.7; message = "Zgjidhi problemet më mirë pasi e ndamë detyrën në hapa." },
  @{ student = "Era Berisha"; teacher = "arta.berisha@shkolla.edu"; subject = "Gjuhë shqipe"; chapter = "Leximi kuptimor"; score = 4.8; message = "Era e lexoi tekstin me fokus dhe dha përgjigje të plota." },
  @{ student = "Era Berisha"; teacher = "arta.berisha@shkolla.edu"; subject = "Gjuhë shqipe"; chapter = "Shkrimi i paragrafit"; score = 4.6; message = "Po organizon idetë më mirë në paragraf." },
  @{ student = "Dren Gashi"; teacher = "valbona.gashi@shkolla.edu"; subject = "Edukatë fizike"; chapter = "Koordinimi dhe ritmi"; score = 4.9; message = "Energjia e lartë u kthye në lëvizje të kontrolluar." },
  @{ student = "Dren Gashi"; teacher = "valbona.gashi@shkolla.edu"; subject = "Edukatë fizike"; chapter = "Lojëra bashkëpunuese"; score = 4.7; message = "Po bashkëpunon më qartë me shokët e grupit." },
  @{ student = "Lira Kastrati"; teacher = "fatos.hoxha@shkolla.edu"; subject = "Edukatë figurative (Art)"; chapter = "Ngjyra dhe kompozimi"; score = 4.5; message = "Punoi me shumë kujdes në përzgjedhjen e ngjyrave." },
  @{ student = "Lira Kastrati"; teacher = "fatos.hoxha@shkolla.edu"; subject = "Edukatë figurative (Art)"; chapter = "Vëzhgim dhe vizatim"; score = 4.8; message = "Detajet në vizatim janë shumë të qarta." },
  @{ student = "Elsa Kryeziu"; teacher = "lindita.kastrati@shkolla.edu"; subject = "Biologji"; chapter = "Bimët dhe mjedisi"; score = 4.3; message = "Elsa po argumenton më mirë vëzhgimet e saj." },
  @{ student = "Elsa Kryeziu"; teacher = "lindita.kastrati@shkolla.edu"; subject = "Biologji"; chapter = "Trupi i njeriut"; score = 4.4; message = "Ka përvetësuar fjalorin kryesor të temës." },
  @{ student = "Rinesa Hoxha"; teacher = "driton.shala@shkolla.edu"; subject = "TIK"; chapter = "Përdorimi i tastierës"; score = 5.0; message = "Punë shumë e sigurt dhe e pavarur në tastierë." },
  @{ student = "Rinesa Hoxha"; teacher = "driton.shala@shkolla.edu"; subject = "TIK"; chapter = "Siguria digjitale"; score = 4.8; message = "I dallon qartë hapat e sigurisë digjitale." },
  @{ student = "Aria Thaqi"; teacher = "edona.bytyqi@shkolla.edu"; subject = "Gjuhë angleze"; chapter = "My Classroom"; score = 4.2; message = "Po e përdor fjalorin me më shumë vetëbesim." },
  @{ student = "Aria Thaqi"; teacher = "edona.bytyqi@shkolla.edu"; subject = "Gjuhë angleze"; chapter = "Daily Routines"; score = 4.4; message = "Po ndërton fjali të shkurtra gjithnjë e më saktë." }
)

$grades = @(Invoke-SupabaseRest -Method Post -Path "/rest/v1/grades" -Body @(
  $gradePlans | ForEach-Object {
    $student = $studentByName[$_.student]
    $teacher = $teacherByEmail[$_.teacher]
    $subject = $subjectByKey[(LowerKey $_.subject)]
    @{
      student_id = $student.id
      subject_id = $subject.id
      chapter_id = $chapterBySubjectAndName["$($_.subject)|$($_.chapter)"]
      teacher_id = $teacher.id
      academic_period_id = $period.id
      score = $_.score
      parent_message = $_.message
    }
  }
))

$finalGradePlans = @(
  @{ student = "Arian Krasniqi"; teacher = "besnik.krasniqi@shkolla.edu"; subject = "Matematikë"; grade = 5; message = "Ka treguar progres të qëndrueshëm dhe punon mirë me hapa të qartë." },
  @{ student = "Era Berisha"; teacher = "arta.berisha@shkolla.edu"; subject = "Gjuhë shqipe"; grade = 5; message = "Lexon me kuptim dhe po e forcon shkrimin e pavarur." },
  @{ student = "Dren Gashi"; teacher = "valbona.gashi@shkolla.edu"; subject = "Edukatë fizike"; grade = 5; message = "Energjia e lartë po kanalizohet shumë mirë në detyrat fizike." },
  @{ student = "Elsa Kryeziu"; teacher = "lindita.kastrati@shkolla.edu"; subject = "Biologji"; grade = 4; message = "Përvetëson mirë konceptet kur punon me shembuj konkretë." },
  @{ student = "Rinesa Hoxha"; teacher = "driton.shala@shkolla.edu"; subject = "TIK"; grade = 5; message = "Ka performancë shumë të sigurt dhe të pavarur në TIK." }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/final_grades" -Body @(
  $finalGradePlans | ForEach-Object {
    @{
      student_id = $studentByName[$_.student].id
      teacher_id = $teacherByEmail[$_.teacher].id
      subject_id = $subjectByKey[(LowerKey $_.subject)].id
      academic_period_id = $period.id
      grade = $_.grade
      parent_message = $_.message
    }
  }
) | Out-Null

$piaObjectives = @(
  @{ id = New-RowId; student = "Arian Krasniqi"; assistant = "mirela.nimani@shkolla.edu"; title = "Ndjekja e hapave me mbështetje vizuale"; details = "Ariani të ndjekë 3 hapa radhazi duke parë skedën vizuale të bankës."; active = $true },
  @{ id = New-RowId; student = "Yll Kelmendi"; assistant = "gent.dema@shkolla.edu"; title = "Nisja e leximit pa pritje të gjatë"; details = "Ylli të fillojë detyrën e leximit brenda 2 minutash pas udhëzimit."; active = $true },
  @{ id = New-RowId; student = "Elsa Kryeziu"; assistant = "adelina.peci@shkolla.edu"; title = "Kërkesa të qarta për ndihmë"; details = "Elsa të përdorë një fjali të plotë kur ka nevojë për sqarim."; active = $true },
  @{ id = New-RowId; student = "Lea Bajrami"; assistant = "blerim.qorri@shkolla.edu"; title = "Punë në çift me rol të qartë"; details = "Lea të ruajë rolin e saj gjatë punës bashkëpunuese për 10 minuta."; active = $true },
  @{ id = New-RowId; student = "Aria Thaqi"; assistant = "saranda.gashi@shkolla.edu"; title = "Rikthimi pas pushimit"; details = "Aria të rikthehet në aktivitet me një udhëzim të shkurtër dhe modelim."; active = $true }
)
Invoke-SupabaseRest -Method Post -Path "/rest/v1/pia_objectives" -Body @(
  $piaObjectives | ForEach-Object {
    @{
      id = $_.id
      student_id = $studentByName[$_.student].id
      assistant_teacher_id = $assistantByEmail[$_.assistant].id
      title = $_.title
      details = $_.details
      active = $_.active
    }
  }
) | Out-Null

$piaUpdates = @(
  @{ objective = "Ndjekja e hapave me mbështetje vizuale"; student = "Arian Krasniqi"; assistant = "mirela.nimani@shkolla.edu"; rating = 4; comment = "Sot i ndoqi dy hapa pa rikujtim dhe të tretin me një shenjë të vogël."; reported_on = $todayDate },
  @{ objective = "Nisja e leximit pa pritje të gjatë"; student = "Yll Kelmendi"; assistant = "gent.dema@shkolla.edu"; rating = 3; comment = "Hyri në detyrë më shpejt se zakonisht pas modelimit të rreshtit të parë."; reported_on = $todayDate },
  @{ objective = "Kërkesa të qarta për ndihmë"; student = "Elsa Kryeziu"; assistant = "adelina.peci@shkolla.edu"; rating = 4; comment = "Kërkoi ndihmë me fjali të plotë në dy momente të ndryshme."; reported_on = $todayDate },
  @{ objective = "Punë në çift me rol të qartë"; student = "Lea Bajrami"; assistant = "blerim.qorri@shkolla.edu"; rating = 3; comment = "Ruajti rolin e saj shumicën e kohës dhe kërkoi rikujtim vetëm një herë."; reported_on = $todayDate },
  @{ objective = "Rikthimi pas pushimit"; student = "Aria Thaqi"; assistant = "saranda.gashi@shkolla.edu"; rating = 4; comment = "Pas pushimit u kthye në aktivitet me vetëm një fjali orientuese."; reported_on = $todayDate }
)
$objectiveByTitle = @{}
$piaObjectives | ForEach-Object { $objectiveByTitle[$_.title] = $_ }
Invoke-SupabaseRest -Method Post -Path "/rest/v1/pia_objective_updates" -Body @(
  $piaUpdates | ForEach-Object {
    @{
      objective_id = $objectiveByTitle[$_.objective].id
      student_id = $studentByName[$_.student].id
      assistant_teacher_id = $assistantByEmail[$_.assistant].id
      rating = $_.rating
      comment = $_.comment
      reported_on = $_.reported_on
    }
  }
) | Out-Null

Write-Host "Seeding message threads..."
$threads = @(
  @{
    id = New-RowId
    student = "Arian Krasniqi"
    parent = "agron.krasniqi@email.com"
    teacher = "besnik.krasniqi@shkolla.edu"
    assistant = $null
    subject = "Matematikë"
    title = "Hapat e detyrave të matematikës"
    created_at = $twoDaysAgoDate + "T08:10:00Z"
  },
  @{
    id = New-RowId
    student = "Era Berisha"
    parent = "blerta.berisha@email.com"
    teacher = "arta.berisha@shkolla.edu"
    assistant = $null
    subject = "Gjuhë shqipe"
    title = "Leximi në shtëpi"
    created_at = $yesterdayDate + "T09:00:00Z"
  },
  @{
    id = New-RowId
    student = "Rinesa Hoxha"
    parent = "alban.hoxha@email.com"
    teacher = "driton.shala@shkolla.edu"
    assistant = $null
    subject = "TIK"
    title = "Ushtrimet e tastierës"
    created_at = $yesterdayDate + "T12:30:00Z"
  },
  @{
    id = New-RowId
    student = "Arian Krasniqi"
    parent = "agron.krasniqi@email.com"
    teacher = $null
    assistant = "mirela.nimani@shkolla.edu"
    subject = $null
    title = "Mbështetja në klasë për Arianin"
    created_at = $todayDate + "T07:40:00Z"
  },
  @{
    id = New-RowId
    student = "Yll Kelmendi"
    parent = $null
    teacher = "arta.berisha@shkolla.edu"
    assistant = "gent.dema@shkolla.edu"
    subject = "Gjuhë shqipe"
    title = "Koordinim për nisjen e leximit"
    created_at = $todayDate + "T08:25:00Z"
  },
  @{
    id = New-RowId
    student = "Elsa Kryeziu"
    parent = "mimoza.k@email.com"
    teacher = $null
    assistant = "adelina.peci@shkolla.edu"
    subject = $null
    title = "Kërkesa për ndihmë gjatë orës"
    created_at = $todayDate + "T08:45:00Z"
  },
  @{
    id = New-RowId
    student = "Ledion Kabashi"
    parent = $null
    teacher = "driton.shala@shkolla.edu"
    assistant = "blerim.qorri@shkolla.edu"
    subject = "TIK"
    title = "Mbështetja gjatë TIK"
    created_at = $todayDate + "T09:15:00Z"
  },
  @{
    id = New-RowId
    student = "Aria Thaqi"
    parent = "venera.g@email.com"
    teacher = $null
    assistant = "saranda.gashi@shkolla.edu"
    subject = $null
    title = "Rikthimi pas pushimit"
    created_at = $todayDate + "T10:05:00Z"
  }
)

$threadRows = @()
foreach ($thread in $threads) {
  $threadRows += @{
    id = $thread.id
    student_id = $studentByName[$thread.student].id
    parent_id = if ($thread.parent) { $parentByEmail[$thread.parent].id } else { $null }
    teacher_id = if ($thread.teacher) { $teacherByEmail[$thread.teacher].id } else { $null }
    assistant_teacher_id = if ($thread.assistant) { $assistantByEmail[$thread.assistant].id } else { $null }
    subject_id = if ($thread.subject) { $subjectByKey[(LowerKey $thread.subject)].id } else { $null }
    title = $thread.title
    created_at = $thread.created_at
    updated_at = $thread.created_at
  }
}
Invoke-SupabaseRest -Method Post -Path "/rest/v1/communication_threads" -Body $threadRows | Out-Null

$messages = @(
  @{ thread = "Hapat e detyrave të matematikës"; sender = "agron.krasniqi@email.com"; body = "A mund t'i ndajmë detyrat e shtëpisë në hapa më të vegjël edhe këtë javë?"; created_at = $twoDaysAgoDate + "T08:12:00Z"; read_at = $twoDaysAgoDate + "T09:00:00Z" },
  @{ thread = "Hapat e detyrave të matematikës"; sender = "besnik.krasniqi@shkolla.edu"; body = "Po, do t'ia dërgoj edhe në fletore me tre hapa të qartë."; created_at = $twoDaysAgoDate + "T08:40:00Z"; read_at = $null },
  @{ thread = "Leximi në shtëpi"; sender = "blerta.berisha@email.com"; body = "Era po lexon më mirë kur dëgjon fillimisht modelin. A ta vazhdojmë kështu?"; created_at = $yesterdayDate + "T09:05:00Z"; read_at = $yesterdayDate + "T10:15:00Z" },
  @{ thread = "Leximi në shtëpi"; sender = "arta.berisha@shkolla.edu"; body = "Po, kjo po funksionon shumë mirë. Sot e nisi tekstin menjëherë pas modelimit."; created_at = $yesterdayDate + "T09:55:00Z"; read_at = $yesterdayDate + "T11:00:00Z" },
  @{ thread = "Leximi në shtëpi"; sender = "blerta.berisha@email.com"; body = "Shumë mirë, do ta mbajmë të njëjtën rutinë edhe sonte."; created_at = $yesterdayDate + "T10:20:00Z"; read_at = $null },
  @{ thread = "Ushtrimet e tastierës"; sender = "driton.shala@shkolla.edu"; body = "Rinesa sot i përfundoi ushtrimet e tastierës me shumë siguri."; created_at = $yesterdayDate + "T12:35:00Z"; read_at = $null },
  @{ thread = "Mbështetja në klasë për Arianin"; sender = "mirela.nimani@shkolla.edu"; body = "Sot Ariani reagoi mirë kur e pamë së bashku kartelën me hapat e punës."; created_at = $todayDate + "T07:45:00Z"; read_at = $todayDate + "T08:30:00Z" },
  @{ thread = "Mbështetja në klasë për Arianin"; sender = "agron.krasniqi@email.com"; body = "Faleminderit, do ta përdorim të njëjtën kartelë edhe në shtëpi."; created_at = $todayDate + "T08:05:00Z"; read_at = $null },
  @{ thread = "Koordinim për nisjen e leximit"; sender = "gent.dema@shkolla.edu"; body = "Ylli hyri më shpejt në lexim kur ia modelova rreshtin e parë."; created_at = $todayDate + "T08:27:00Z"; read_at = $todayDate + "T09:05:00Z" },
  @{ thread = "Koordinim për nisjen e leximit"; sender = "arta.berisha@shkolla.edu"; body = "E pashë edhe unë. Do ta mbajmë të njëjtin fillim të orës edhe nesër."; created_at = $todayDate + "T08:58:00Z"; read_at = $null },
  @{ thread = "Kërkesa për ndihmë gjatë orës"; sender = "adelina.peci@shkolla.edu"; body = "Elsa sot kërkoi ndihmë me fjali të plotë në dy raste."; created_at = $todayDate + "T08:50:00Z"; read_at = $null },
  @{ thread = "Mbështetja gjatë TIK"; sender = "blerim.qorri@shkolla.edu"; body = "Ledioni pati nevojë për modelim vetëm në fillim të ushtrimit."; created_at = $todayDate + "T09:18:00Z"; read_at = $todayDate + "T09:50:00Z" },
  @{ thread = "Mbështetja gjatë TIK"; sender = "driton.shala@shkolla.edu"; body = "Shumë mirë, nesër do t'ia jap menjëherë shembullin e parë dhe pastaj e lë të vazhdojë vetë."; created_at = $todayDate + "T09:42:00Z"; read_at = $null },
  @{ thread = "Rikthimi pas pushimit"; sender = "saranda.gashi@shkolla.edu"; body = "Aria u kthye shpejt në detyrë pas pushimit me një udhëzim të vetëm."; created_at = $todayDate + "T10:08:00Z"; read_at = $todayDate + "T10:40:00Z" },
  @{ thread = "Rikthimi pas pushimit"; sender = "venera.g@email.com"; body = "Kjo na ndihmon shumë, edhe në shtëpi po funksionon më mirë kur e paralajmërojmë kthimin."; created_at = $todayDate + "T10:26:00Z"; read_at = $null }
)
$threadByTitle = @{}
$threads | ForEach-Object { $threadByTitle[$_.title] = $_ }
Invoke-SupabaseRest -Method Post -Path "/rest/v1/communication_messages" -Body @(
  $messages | ForEach-Object {
    $senderId = $null
    if ($teacherByEmail.ContainsKey($_.sender)) { $senderId = $teacherByEmail[$_.sender].id }
    elseif ($assistantByEmail.ContainsKey($_.sender)) { $senderId = $assistantByEmail[$_.sender].id }
    else { $senderId = $parentByEmail[$_.sender].id }

    @{
      thread_id = $threadByTitle[$_.thread].id
      sender_id = $senderId
      body = $_.body
      created_at = $_.created_at
      read_at = $_.read_at
    }
  }
) | Out-Null

$latestMessageAtByThread = @{}
foreach ($message in $messages) {
  $latestMessageAtByThread[$message.thread] = $message.created_at
}
foreach ($threadTitle in $latestMessageAtByThread.Keys) {
  Invoke-SupabaseRest -Method Patch -Path "/rest/v1/communication_threads?id=eq.$($threadByTitle[$threadTitle].id)" -Body @{
    updated_at = $latestMessageAtByThread[$threadTitle]
  } | Out-Null
}

Write-Host "Collecting verification summary..."
$profilesCount = @(Invoke-SupabaseRest -Method Get -Path "/rest/v1/profiles?select=id").Count
$studentsCount = @(Invoke-SupabaseRest -Method Get -Path "/rest/v1/students?select=id").Count
$threadsCount = @(Invoke-SupabaseRest -Method Get -Path "/rest/v1/communication_threads?select=id").Count
$notifications = @(Invoke-SupabaseRest -Method Get -Path "/rest/v1/user_notifications?select=kind")
$notificationSummary = $notifications | Group-Object kind | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }

function Test-Login {
  param(
    [string]$Email,
    [string]$Password
  )

  $body = @{
    email = $Email
    password = $Password
  }

  try {
    $response = Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/v1/token?grant_type=password" -Headers $loginHeaders -Body ($body | To-JsonBody)
    return "OK $Email"
  } catch {
    return "FAILED $Email"
  }
}

$loginChecks = @(
  Test-Login -Email $admin.email -Password $admin.password,
  Test-Login -Email "arta.berisha@shkolla.edu" -Password "Temp123",
  Test-Login -Email "mirela.nimani@shkolla.edu" -Password "Temp123",
  Test-Login -Email "agron.krasniqi@email.com" -Password "Temp123"
)

Write-Host ""
Write-Host "Demo reseed complete."
Write-Host "Profiles: $profilesCount"
Write-Host "Students: $studentsCount"
Write-Host "Threads: $threadsCount"
Write-Host "Notifications: $($notificationSummary -join ', ')"
Write-Host "Login checks: $($loginChecks -join ' | ')"
Write-Host ""
Write-Host "Admin login: $($admin.email) / $($admin.password)"
Write-Host "All teacher, assistant-teacher, and parent demo logins use: Temp123"
