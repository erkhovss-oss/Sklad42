// ---------- EMPLOYEES & ROLES ----------
// ---------- AUTH ----------
function showLoginForm(){
  const loading = document.getElementById('loginLoading');
  const form = document.getElementById('loginFormWrap');
  if(loading) loading.style.display = 'none';
  if(form) form.style.display = 'block';
}
function enterApp(emp){
  currentUser = emp;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  const role = roles.find(r=>r.id===emp.roleId);
  document.getElementById('sidebarFoot').innerHTML = `
    <div class="sidebar-user">
      <div class="name">${emp.name}</div>
      <div class="role">${role?role.name:'—'}</div>
    </div>
    <button class="btn btn-ghost" style="width:100%;justify-content:center;padding:6px" onclick="logout()">Выйти</button>
  `;
}
async function resolveCurrentEmployeeAndEnter(){
  const { data: emp, error } = await sb.rpc('current_employee');
  if(error || !emp){
    console.error(error);
    try{ await sb.auth.signOut(); }catch(e){}
    const errorEl = document.getElementById('loginError');
    if(errorEl){
      errorEl.textContent = 'Этот аккаунт не привязан к сотруднику ТелеПак. Обратитесь к администратору.';
      errorEl.style.display = 'block';
    }
    showLoginForm();
    return;
  }
  const mapped = {id:emp.id, name:emp.name, login:emp.login, roleId:emp.role_id, active:emp.active, warehouseId:emp.warehouse_id||null};
  const idx = employees.findIndex(e=>e.id===mapped.id);
  if(idx>=0) employees[idx] = {...employees[idx], ...mapped}; else employees.push(mapped);
  enterApp(mapped);
  await loadStaffData();
}
async function attemptLogin(){
  const email = document.getElementById('loginInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errorEl.style.display = 'none';
  if(!email || !password){
    errorEl.textContent = 'Введите email и пароль';
    errorEl.style.display = 'block';
    return;
  }
  if(btn){ btn.disabled = true; btn.textContent = 'Вход…'; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(btn){ btn.disabled = false; btn.textContent = 'Войти'; }
  if(error){
    errorEl.textContent = 'Неверный email или пароль';
    errorEl.style.display = 'block';
    return;
  }
  await resolveCurrentEmployeeAndEnter();
}
async function logout(){
  currentUser = null;
  try{ await sb.auth.signOut(); }catch(e){}
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  showLoginForm();
  document.getElementById('loginInput').value = '';
  document.getElementById('passwordInput').value = '';
  document.getElementById('loginError').style.display = 'none';
}

function setEmployeesView(view){ currentEmployeesView = view; renderEmployeesTab(); }
function openNewEmployeeForm(){ showingNewEmployeeForm = true; editingEmployeeId = null; deletingEmployeeId = null; renderEmployeesTab(); }
function closeNewEmployeeForm(){ showingNewEmployeeForm = false; renderEmployeesTab(); }
function createEmployee(){
  const name = document.getElementById('newEmpName').value.trim();
  const login = document.getElementById('newEmpLogin').value.trim();
  const authUserId = document.getElementById('newEmpAuthId').value.trim() || null;
  const roleId = document.getElementById('newEmpRole').value;
  const warehouseId = document.getElementById('newEmpWarehouse').value || null;
  if(!name || !login){ toast('Укажите имя и логин'); return; }
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(authUserId && !uuidRe.test(authUserId)){ toast('Auth User ID должен быть в формате UUID (скопируйте из Supabase → Authentication → Users)'); return; }
  const id = 'EMP-' + Date.now();
  employees.push({id, name, login, authUserId, roleId, active:true, warehouseId});
  showingNewEmployeeForm = false;
  toast('Сотрудник добавлен');
  renderEmployeesTab();
  sb.from('employees').insert({id, name, login, auth_user_id: authUserId, role_id: roleId, active:true, warehouse_id: warehouseId}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить сотрудника в базе (возможно, такой логин или Auth User ID уже есть)'); }
  });
}
function toggleEmployeeActive(id){
  const emp = employees.find(e=>e.id===id);
  emp.active = !emp.active;
  renderEmployeesTab();
  sb.from('employees').update({active: emp.active}).eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе'); }
  });
}
function startEditEmployee(id){ editingEmployeeId = id; deletingEmployeeId = null; showingNewEmployeeForm = false; renderEmployeesTab(); }
function openDeleteEmployee(id){ deletingEmployeeId = id; editingEmployeeId = null; renderEmployeesTab(); }
function cancelDeleteEmployee(){ deletingEmployeeId = null; renderEmployeesTab(); }
function confirmDeleteEmployee(id){
  const emp = employees.find(e=>e.id===id);
  if(!emp) return;
  if(emp.id === currentUser?.id){
    toast('Нельзя удалить сотрудника, под которым вы сейчас вошли');
    deletingEmployeeId = null;
    renderEmployeesTab();
    return;
  }
  employees = employees.filter(e=>e.id!==id);
  deletingEmployeeId = null;
  toast(`Сотрудник «${emp.name}» удалён`);
  renderEmployeesTab();
  sb.from('employees').delete().eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить сотрудника в базе'); }
  });
}
function cancelEditEmployee(){ editingEmployeeId = null; renderEmployeesTab(); }
function saveEmployee(id){
  const emp = employees.find(e=>e.id===id);
  const name = document.getElementById('editEmpName-'+id).value.trim();
  const login = document.getElementById('editEmpLogin-'+id).value.trim();
  const authUserIdRaw = document.getElementById('editEmpAuthId-'+id).value.trim();
  const authUserId = authUserIdRaw || null;
  const roleId = document.getElementById('editEmpRole-'+id).value;
  const warehouseId = document.getElementById('editEmpWarehouse-'+id).value || null;
  if(!name || !login){ toast('Укажите имя и логин'); return; }
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(authUserId && !uuidRe.test(authUserId)){ toast('Auth User ID должен быть в формате UUID (скопируйте из Supabase → Authentication → Users)'); return; }
  emp.name = name;
  emp.login = login;
  emp.roleId = roleId;
  emp.warehouseId = warehouseId;
  emp.authUserId = authUserId;
  editingEmployeeId = null;
  toast('Данные сотрудника сохранены');
  renderEmployeesTab();
  const update = {name, login, role_id: roleId, warehouse_id: warehouseId, auth_user_id: authUserId};
  sb.from('employees').update(update).eq('id', id).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить в базе (возможно, такой логин или Auth User ID уже занят)'); }
  });
}
function togglePermission(roleId, key){
  const role = roles.find(r=>r.id===roleId);
  role.permissions[key] = !role.permissions[key];
  renderEmployeesTab();
  sb.from('roles').update({permissions: role.permissions}).eq('id', roleId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить права в базе'); }
  });
}
function createRole(){
  const nameInput = document.getElementById('newRoleName');
  const name = nameInput.value.trim();
  if(!name){ toast('Укажите название роли'); return; }
  const id = 'ROLE-' + Date.now();
  const permissions = {inventory:true, clients:true, storage:true, supplies:true, outbound:true, fbs:true, ozon:true, dds:true, stocktake:true, warehouses:true, consumables:true, returns:true, employees:true, 'portal-supplies':false};
  roles.push({id, name, permissions});
  toast(`Роль «${name}» создана со всеми правами`);
  renderEmployeesTab();
  sb.from('roles').insert({id, name, permissions}).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось сохранить роль в базе'); }
  });
}
function deleteRole(roleId){
  const role = roles.find(r=>r.id===roleId);
  const inUse = employees.filter(e=>e.roleId===roleId);
  if(inUse.length){
    toast(`Нельзя удалить — роль назначена сотрудникам: ${inUse.map(e=>e.name).join(', ')}`);
    return;
  }
  if(!confirm(`Удалить роль «${role.name}»?`)) return;
  roles = roles.filter(r=>r.id!==roleId);
  toast('Роль удалена');
  renderEmployeesTab();
  sb.from('roles').delete().eq('id', roleId).then(({error})=>{
    if(error){ console.error(error); toast('Не удалось удалить роль в базе'); }
  });
}
function renderEmployeesTab(){
  document.getElementById('viewEmployeesBtn').className = 'btn ' + (currentEmployeesView==='list' ? 'btn-accent' : 'btn-ghost');
  document.getElementById('viewRolesBtn').className = 'btn ' + (currentEmployeesView==='roles' ? 'btn-accent' : 'btn-ghost');
  document.getElementById('newEmployeeBtn').style.display = currentEmployeesView==='list' ? 'inline-flex' : 'none';
  const body = document.getElementById('employeesBody');

  if(currentEmployeesView==='roles'){
    const permLabels = [['inventory','Остатки'],['clients','Клиенты'],['storage','Хранение'],['supplies','Плановые поставки'],['outbound','Поставка на склад'],['fbs','Заказы FBS'],['ozon','Заказы Ozon'],['dds','ДДС'],['stocktake','Инвентаризация'],['warehouses','Склады'],['consumables','Расходники'],['returns','Возвраты'],['employees','Сотрудники']];
    body.innerHTML = `
      <div class="panel" style="padding:18px;margin-bottom:18px">
        <div class="eyebrow" style="margin-bottom:10px">Новая роль</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input class="search" id="newRoleName" placeholder="Название роли, напр. Руководитель" style="flex:1;min-width:200px">
          <button class="btn btn-primary" onclick="createRole()">Создать (со всеми правами)</button>
        </div>
      </div>
    ` + roles.map(r=>`
      <div class="panel" style="padding:18px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="oid">${escapeHtml(r.name)}</div>
          <button class="btn btn-ghost" style="padding:4px 10px;color:var(--warn)" onclick="deleteRole('${r.id}')">Удалить роль</button>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap">
          ${permLabels.map(([key,label])=>`
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
              <input type="checkbox" ${r.permissions[key]?'checked':''} onchange="togglePermission('${r.id}','${key}')">
              ${label}
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
    return;
  }

  const formHtml = showingNewEmployeeForm ? `
    <div class="panel" style="padding:18px;margin-bottom:18px">
      <div class="eyebrow" style="margin-bottom:10px">Новый сотрудник</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <input class="search" id="newEmpName" placeholder="ФИО" style="flex:1;min-width:180px">
        <input class="search" id="newEmpLogin" placeholder="Логин" style="width:150px">
        <input class="search" id="newEmpAuthId" placeholder="Auth User ID (UUID, необязательно)" style="width:280px">
        <select class="search" id="newEmpRole" style="width:200px">
          ${roles.map(r=>`<option value="${r.id}">${r.name}</option>`).join('')}
        </select>
        <select class="search" id="newEmpWarehouse" style="width:180px">
          <option value="">Все склады</option>
          ${warehouses.map(w=>`<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" onclick="createEmployee()">Создать</button>
      <button class="btn btn-ghost" onclick="closeNewEmployeeForm()">Отмена</button>
    </div>
  ` : '';

  const listHtml = `
    <div class="panel">
      <table class="card-table">
        <thead><tr><th>Сотрудник</th><th>Логин</th><th>Роль</th><th>Склад</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          ${employees.map(e=>{
            const role = roles.find(r=>r.id===e.roleId);
            if(editingEmployeeId === e.id){
              return `<tr>
                <td colspan="6">
                  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 0">
                    <input class="search" id="editEmpName-${escapeHtml(e.id)}" value="${escapeHtml(e.name)}" placeholder="ФИО" style="flex:1;min-width:160px">
                    <input class="search" id="editEmpLogin-${escapeHtml(e.id)}" value="${escapeHtml(e.login)}" placeholder="Логин" style="width:140px">
                    <input class="search" id="editEmpAuthId-${escapeHtml(e.id)}" value="${escapeHtml(e.authUserId||'')}" placeholder="Auth User ID (UUID)" style="width:280px">
                    <select class="search" id="editEmpRole-${escapeHtml(e.id)}" style="width:190px">
                      ${roles.map(r=>`<option value="${r.id}" ${e.roleId===r.id?'selected':''}>${r.name}</option>`).join('')}
                    </select>
                    <select class="search" id="editEmpWarehouse-${escapeHtml(e.id)}" style="width:170px">
                      <option value="" ${!e.warehouseId?'selected':''}>Все склады</option>
                      ${warehouses.map(w=>`<option value="${w.id}" ${e.warehouseId===w.id?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}
                    </select>
                    <button class="btn btn-primary" style="padding:6px 12px" onclick="saveEmployee('${escapeHtml(e.id)}')">Сохранить</button>
                    <button class="btn btn-ghost" style="padding:6px 12px" onclick="cancelEditEmployee()">Отмена</button>
                  </div>
                </td>
              </tr>`;
            }
            if(deletingEmployeeId === e.id){
              return `<tr>
                <td colspan="6">
                  <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:8px 0">
                    <span style="font-size:13px;color:var(--warn)">Удалить сотрудника «${escapeHtml(e.name)}» без возможности восстановить?</span>
                    <div style="white-space:nowrap">
                      <button class="btn btn-accent" style="padding:5px 10px" onclick="confirmDeleteEmployee('${escapeHtml(e.id)}')">Да, удалить</button>
                      <button class="btn btn-ghost" style="padding:5px 10px" onclick="cancelDeleteEmployee()">Отмена</button>
                    </div>
                  </div>
                </td>
              </tr>`;
            }
            return `<tr>
              <td data-label="Сотрудник">${e.name}</td>
              <td class="mono" data-label="Логин">${e.login}</td>
              <td data-label="Роль">${role?role.name:'—'}</td>
              <td data-label="Склад">${e.warehouseId ? escapeHtml(warehouseName(e.warehouseId)) : '<span style="color:var(--ink-faint)">Все склады</span>'}</td>
              <td data-label="Статус">${e.active ? '<span class="status assembled">Активен</span>' : '<span class="status shipped">Отключён</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-ghost" style="padding:5px 10px" onclick="startEditEmployee('${escapeHtml(e.id)}')">Изменить</button>
                <button class="btn btn-ghost" style="padding:5px 10px" onclick="toggleEmployeeActive('${escapeHtml(e.id)}')">${e.active?'Отключить':'Включить'}</button>
                <button class="btn btn-ghost" style="padding:5px 10px;color:var(--warn)" onclick="openDeleteEmployee('${escapeHtml(e.id)}')">Удалить</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  body.innerHTML = formHtml + listHtml;
}

