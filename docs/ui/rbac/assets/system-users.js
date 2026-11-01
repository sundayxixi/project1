/* ==========================================================================
   辰光 Agent · 用户管理交互
   说明：账号数据来自 #user-seed，全部操作为前端模拟，不发起真实请求。
   ========================================================================== */
(function () {
  'use strict';

  var CG = window.CG;
  if (!CG) return;

  var ROLES = [
    { key: 'admin', name: '管理员', desc: '全部系统管理权限与全部数据', system: true },
    { key: 'developer', name: '开发者', desc: 'Agent、Prompt、知识库与工具开发' },
    { key: 'operator', name: '运营', desc: '业务数据查看，知识库内容维护' },
    { key: 'viewer', name: '只读', desc: '仅查看，不产生任何变更' },
    { key: 'labeler', name: '数据标注员', desc: '知识库分段标注与 Prompt 预览' }
  ];
  var ROLE_MAP = {};
  ROLES.forEach(function (r) { ROLE_MAP[r.key] = r; });

  var PAGE_SIZE = 8;
  var seedNode = document.getElementById('user-seed');
  var users = seedNode ? JSON.parse(seedNode.textContent) : [];
  var state = { page: 1, q: '', role: '', status: '' };

  var tbody, table, emptyBox, rangeLabel, pager, summary, search, roleSelect, statusSelect, tableFoot;
  var menu, menuBtn = null;

  /* ---------- 工具 ---------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function dialog(id) {
    return document.querySelector('[data-dialog="' + id + '"]');
  }

  function findUser(id) {
    for (var i = 0; i < users.length; i++) {
      if (users[i].id === id) return users[i];
    }
    return null;
  }

  function adminCount(excludeId) {
    return users.filter(function (u) {
      return u.id !== excludeId && u.roles.indexOf('admin') !== -1;
    }).length;
  }

  function formatDate(date) {
    var m = date.getMonth() + 1;
    var d = date.getDate();
    return date.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  }

  function nextUserId() {
    var max = 0;
    users.forEach(function (u) {
      var n = parseInt(String(u.id).replace(/\D/g, ''), 10) || 0;
      if (n > max) max = n;
    });
    return 'u' + (max + 1);
  }

  function randomPassword() {
    var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    var digits = '23456789';
    function pick(source, length) {
      var out = '';
      for (var i = 0; i < length; i++) {
        out += source.charAt(Math.floor(Math.random() * source.length));
      }
      return out;
    }
    return 'Cg-' + pick(letters, 4) + '-' + pick(digits, 4);
  }

  function passwordScore(pw) {
    var score = 0;
    if (pw.length >= 10) score++;
    if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) score++;
    if (pw.length >= 14 || /[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }

  function renderStrength(scope, pw) {
    var bars = scope.querySelectorAll('.pw-bar');
    var score = passwordScore(pw);
    Array.prototype.forEach.call(bars, function (bar, index) {
      bar.classList.toggle('on', index < score);
      bar.classList.remove('is-mid', 'is-weak');
      if (index < score && score === 1) bar.classList.add('is-weak');
      else if (index < score && score === 2) bar.classList.add('is-mid');
    });
    var label = scope.querySelector('[data-pw-strength]');
    if (label) label.textContent = score >= 3 ? '强' : score === 2 ? '中' : score === 1 ? '弱' : '未填写';
  }

  function setPassword(input, value) {
    if (!input) return;
    input.value = value;
    input.type = 'text';
    var row = input.closest('.password-row');
    var toggle = row ? row.querySelector('[data-pw-toggle]') : null;
    if (toggle) toggle.textContent = '隐藏';
    var scope = input.closest('.modal-body') || input.closest('.modal');
    if (scope) renderStrength(scope, value);
  }

  function copyText(text) {
    if (!text) return;
    function done() { CG.toast('已复制到剪贴板', 'ok'); }
    function fallback() {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
        done();
      } catch (err) {
        CG.toast('复制失败，请手动选择密码', 'error');
      }
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- 角色选项 ---------- */

  function roleOptionsHtml(selected, options) {
    options = options || {};
    return ROLES.map(function (role) {
      var on = selected.indexOf(role.key) !== -1;
      var disabled = !!options.disabledAll || (options.lockAdmin && role.key === 'admin');
      var cls = 'role-option' + (on ? ' is-checked' : '') + (disabled ? ' is-disabled' : '');
      return '<label class="' + cls + '">' +
        '<input type="checkbox" value="' + role.key + '"' + (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
        '<span><span class="n">' + esc(role.name) +
          (role.system ? ' <span class="tag tag--system">内置</span>' : '') +
        '</span><span class="d">' + esc(role.desc) + '</span></span>' +
      '</label>';
    }).join('');
  }

  function readRoles(container) {
    return Array.prototype.map.call(
      container.querySelectorAll('input[type="checkbox"]:checked'),
      function (input) { return input.value; }
    );
  }

  function roleNames(keys) {
    return keys.map(function (key) {
      return ROLE_MAP[key] ? ROLE_MAP[key].name : key;
    }).join('、');
  }

  /* ---------- 表单错误 ---------- */

  function setError(form, name, message) {
    if (!form) return;
    var field = form.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    field.classList.toggle('has-error', !!message);
    var slot = field.querySelector('[data-error]');
    if (slot) slot.textContent = message || '';
    var control = field.querySelector('.control');
    if (control) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  function clearErrors(form) {
    if (!form) return;
    form.querySelectorAll('.field.has-error').forEach(function (field) {
      field.classList.remove('has-error');
    });
    form.querySelectorAll('.field-error').forEach(function (slot) {
      slot.textContent = '';
    });
    form.querySelectorAll('[aria-invalid]').forEach(function (control) {
      control.removeAttribute('aria-invalid');
    });
  }

  function focusFirstError(form) {
    var control = form.querySelector('.field.has-error .control');
    if (control) control.focus({ preventScroll: true });
  }

  /* ---------- 表格渲染 ---------- */

  function statusHtml(user) {
    var on = user.status === 'on';
    return '<span class="status status--' + (on ? 'on' : 'off') + '">' + (on ? '活跃' : '禁用') + '</span>';
  }

  function roleTags(user) {
    return user.roles.map(function (key) {
      var role = ROLE_MAP[key];
      if (!role) return '';
      var cls = key === 'admin' ? 'tag tag--system' : 'tag';
      return '<span class="' + cls + '">' + esc(role.name) + '</span>';
    }).join('');
  }

  function actionButton(label, action, uid, extra) {
    return '<button class="btn btn--sm ' + (extra || 'btn--quiet') + '" type="button" data-act="' +
      action + '" data-uid="' + esc(uid) + '">' + label + '</button>';
  }

  function ghostButton(label, perm) {
    return '<button class="btn btn--sm btn--quiet is-ghost" type="button" disabled title="运行时隐藏 · 需要 ' +
      esc(perm) + '">' + label + '</button>';
  }

  function actionsHtml(user, self) {
    var canUpdate = CG.can('user:update');
    var canDelete = CG.can('user:delete');
    var parts = [];

    if (canUpdate) parts.push(actionButton('编辑', 'edit', user.id));
    else if (CG.isGhost()) parts.push(ghostButton('编辑', 'user:update'));

    if (self) {
      if (canUpdate) parts.push(actionButton('重置密码', 'reset', user.id));
      parts.push('<span class="self-note">不可禁用或删除自己</span>');
    } else {
      if (canUpdate) parts.push(actionButton('分配角色', 'roles', user.id));
      if (canUpdate || canDelete) {
        parts.push('<button class="btn btn--sm btn--icon" type="button" data-act="menu" data-uid="' +
          esc(user.id) + '" aria-haspopup="menu" aria-expanded="false" aria-label="更多操作">⋯</button>');
      } else if (CG.isGhost()) {
        parts.push(ghostButton('更多', 'user:update'));
      }
    }

    if (!parts.length) parts.push('<span class="self-note">仅可查看</span>');
    return '<div class="row-actions">' + parts.join('') + '</div>';
  }

  function rowHtml(user) {
    var self = user.id === CG.me.uid;
    var seal = '<span class="seal' + (self ? ' seal--me' : '') + '" aria-hidden="true">' +
      esc(user.name.slice(0, 1).toUpperCase()) + '</span>';
    var ident = '<span class="user-ident"><span class="name">' + esc(user.name) + '</span>' +
      (user.name === user.username ? '' : '<span class="sub mono">' + esc(user.username) + '</span>') +
      '</span>';

    return '<tr data-uid="' + esc(user.id) + '" data-status="' + user.status + '">' +
      '<td><div class="user-cell">' + seal + ident + '</div></td>' +
      '<td>' + esc(user.email) + '</td>' +
      '<td><span class="user-roles">' + roleTags(user) + '</span></td>' +
      '<td class="num">' + user.resources + '</td>' +
      '<td>' + statusHtml(user) + '</td>' +
      '<td class="num">' + esc(user.lastLogin) + '</td>' +
      '<td class="actions">' + actionsHtml(user, self) + '</td>' +
    '</tr>';
  }

  function filteredUsers() {
    var q = state.q.trim().toLowerCase();
    return users.filter(function (user) {
      if (q) {
        var haystack = [user.name, user.username, user.email]
          .concat(user.roles.map(function (key) { return ROLE_MAP[key] ? ROLE_MAP[key].name : ''; }))
          .join(' ').toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      if (state.role && user.roles.indexOf(state.role) === -1) return false;
      if (state.status && user.status !== state.status) return false;
      return true;
    });
  }

  function renderPager(pages) {
    if (!pager) return;
    var html = '<button type="button" data-page-btn="prev"' + (state.page <= 1 ? ' disabled' : '') + '>上一页</button>';
    for (var i = 1; i <= pages; i++) {
      html += '<button type="button" data-page-btn="' + i + '"' +
        (i === state.page ? ' class="is-current" aria-current="page"' : '') + '>' + i + '</button>';
    }
    html += '<button type="button" data-page-btn="next"' + (state.page >= pages ? ' disabled' : '') + '>下一页</button>';
    pager.innerHTML = html;
  }

  function updateSummary() {
    if (!summary) return;
    var admins = users.filter(function (u) { return u.roles.indexOf('admin') !== -1; }).length;
    var disabled = users.filter(function (u) { return u.status === 'off'; }).length;
    summary.textContent = users.length + ' 个账号 · ' + admins + ' 个超管 · ' + disabled + ' 个已禁用';
  }

  function render() {
    var list = filteredUsers();
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;

    var start = (state.page - 1) * PAGE_SIZE;
    var rows = list.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = rows.map(rowHtml).join('');
    table.hidden = total === 0;
    emptyBox.hidden = total !== 0;
    tableFoot.hidden = total === 0;
    pager.hidden = total === 0;

    rangeLabel.textContent = total
      ? '显示 ' + (start + 1) + '–' + (start + rows.length) + ' / 共 ' + total + ' 个账号'
      : '当前筛选没有匹配的账号';

    renderPager(pages);
    updateSummary();
    closeMenu();
  }

  function syncFilters() {
    if (search) search.value = state.q;
    if (roleSelect) roleSelect.value = state.role;
    if (statusSelect) statusSelect.value = state.status;
  }

  function clearFilters() {
    state.q = '';
    state.role = '';
    state.status = '';
    state.page = 1;
    syncFilters();
    render();
  }

  /* ---------- 行内菜单 ---------- */

  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn = null;
    }
  }

  function openMenu(button, user) {
    var canUpdate = CG.can('user:update');
    var canDelete = CG.can('user:delete');
    var html = '';

    if (canUpdate) {
      html += '<button class="row-menu-item" type="button" role="menuitem" data-menu-action="reset">重置密码</button>';
      html += '<button class="row-menu-item" type="button" role="menuitem" data-menu-action="toggle">' +
        (user.status === 'on' ? '禁用账号' : '启用账号') + '</button>';
    }
    if (canDelete) {
      if (html) html += '<hr class="row-menu-sep">';
      var lastAdmin = user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0;
      html += '<button class="row-menu-item is-danger" type="button" role="menuitem" data-menu-action="delete"' +
        (lastAdmin ? ' disabled title="不能删除最后一个超级管理员"' : '') + '>删除账号</button>';
    }
    if (!html) return;

    menu.innerHTML = html;
    menu.setAttribute('data-uid', user.id);
    menu.hidden = false;
    menuBtn = button;
    button.setAttribute('aria-expanded', 'true');

    var width = 176;
    var rect = button.getBoundingClientRect();
    var left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
    var top = rect.bottom + 6;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    var height = menu.offsetHeight;
    if (top + height > window.innerHeight - 12) {
      top = Math.max(12, rect.top - height - 6);
      menu.style.top = top + 'px';
    }
  }

  /* ---------- 弹窗：添加 / 编辑 ---------- */

  function resetCreateForm() {
    var form = document.querySelector('[data-create-user-form]');
    if (!form) return;
    form.reset();
    clearErrors(form);
    form.querySelector('[data-role-options]').innerHTML = roleOptionsHtml(['developer'], {});
    setPassword(form.querySelector('[name="password"]'), randomPassword());
    form.querySelector('[name="forceChange"]').checked = true;
  }

  function submitCreate() {
    var form = document.querySelector('[data-create-user-form]');
    if (!form) return;
    clearErrors(form);

    var username = form.querySelector('[name="username"]').value.trim().toLowerCase();
    var email = form.querySelector('[name="email"]').value.trim().toLowerCase();
    var roles = readRoles(form.querySelector('[data-role-options]'));
    var password = form.querySelector('[name="password"]').value;
    var ok = true;

    if (!username) {
      setError(form, 'username', '请填写用户名');
      ok = false;
    } else if (!/^[a-z0-9._-]{3,20}$/.test(username)) {
      setError(form, 'username', '需为 3–20 位小写字母、数字、点、下划线或短横线');
      ok = false;
    } else if (users.some(function (u) { return u.username.toLowerCase() === username; })) {
      setError(form, 'username', '该用户名已被占用');
      ok = false;
    }

    if (!email) {
      setError(form, 'email', '请填写邮箱');
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(form, 'email', '邮箱格式不正确');
      ok = false;
    } else if (users.some(function (u) { return u.email.toLowerCase() === email; })) {
      setError(form, 'email', '该邮箱已被其他账号使用');
      ok = false;
    }

    if (!roles.length) {
      setError(form, 'roles', '至少选择一个角色');
      ok = false;
    }

    if (!password) {
      setError(form, 'password', '请填写或生成初始密码');
      ok = false;
    } else if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError(form, 'password', '至少 10 位，且同时包含字母与数字');
      ok = false;
    }

    if (!ok) {
      focusFirstError(form);
      return;
    }

    users.unshift({
      id: nextUserId(),
      name: username,
      username: username,
      email: email,
      roles: roles,
      resources: 0,
      status: 'on',
      lastLogin: '从未登录',
      createdAt: formatDate(new Date())
    });

    state.q = '';
    state.role = '';
    state.status = '';
    state.page = 1;
    syncFilters();
    render();
    CG.closeLayer(dialog('create-user'));
    CG.toast('已创建「' + username + '」，初始密码已生成，请通过安全渠道转交', 'ok');
  }

  function openEdit(user) {
    var dlg = dialog('edit-user');
    if (!dlg) return;
    var form = dlg.querySelector('[data-edit-user-form]');
    var self = user.id === CG.me.uid;
    var lastAdmin = user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0;

    dlg.setAttribute('data-uid', user.id);
    dlg.querySelector('[data-edit-name]').textContent = user.name;
    dlg.querySelector('#edit-username').value = user.username;
    dlg.querySelector('#edit-email').value = user.email;
    dlg.querySelector('[data-edit-roles]').innerHTML = roleOptionsHtml(user.roles, {
      disabledAll: self,
      lockAdmin: lastAdmin
    });

    var note = dlg.querySelector('[data-edit-lock-note]');
    if (self) {
      note.hidden = false;
      note.className = 'inline-alert';
      note.textContent = '不能修改自己的角色。需要调整时，请让另一位管理员在角色管理中操作。';
    } else if (lastAdmin) {
      note.hidden = false;
      note.className = 'inline-alert inline-alert--warn';
      note.textContent = '这是最后一个超级管理员，管理员角色不能移除。';
    } else {
      note.hidden = true;
    }

    dlg.querySelector('[data-edit-uid]').textContent = user.id;
    dlg.querySelector('[data-edit-created]').textContent = user.createdAt;
    dlg.querySelector('[data-edit-login]').textContent = user.lastLogin;
    dlg.querySelector('[data-edit-resources]').textContent = user.resources + ' 个';

    clearErrors(form);
    CG.openLayer(dlg);
  }

  function submitEdit() {
    var dlg = dialog('edit-user');
    if (!dlg) return;
    var form = dlg.querySelector('[data-edit-user-form]');
    var user = findUser(dlg.getAttribute('data-uid'));
    if (!user) return;
    clearErrors(form);

    var email = form.querySelector('[name="email"]').value.trim().toLowerCase();
    var roles = readRoles(dlg.querySelector('[data-edit-roles]'));
    var ok = true;

    if (!email) {
      setError(form, 'email', '请填写邮箱');
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(form, 'email', '邮箱格式不正确');
      ok = false;
    } else if (users.some(function (u) { return u.id !== user.id && u.email.toLowerCase() === email; })) {
      setError(form, 'email', '该邮箱已被其他账号使用');
      ok = false;
    }

    if (!roles.length) {
      setError(form, 'roles', '账号至少保留一个角色');
      ok = false;
    } else if (user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0 && roles.indexOf('admin') === -1) {
      setError(form, 'roles', '不能移除最后一个超级管理员的管理员角色');
      ok = false;
    }

    if (!ok) {
      focusFirstError(form);
      return;
    }

    user.email = email;
    user.roles = roles;
    render();
    CG.closeLayer(dlg);
    CG.toast('已更新「' + user.name + '」的账号信息，下一次请求即生效', 'ok');
  }

  /* ---------- 弹窗：分配角色 / 重置密码 / 停用 / 删除 ---------- */

  function openRoles(user) {
    var dlg = dialog('user-roles');
    if (!dlg) return;
    var lastAdmin = user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0;
    var error = dlg.querySelector('[data-roles-error]');

    dlg.setAttribute('data-uid', user.id);
    dlg.querySelector('[data-role-user]').textContent = user.name;
    dlg.querySelector('[data-roles-options]').innerHTML = roleOptionsHtml(user.roles, { lockAdmin: lastAdmin });
    error.textContent = '';
    error.style.display = 'none';
    CG.openLayer(dlg);
  }

  function saveRoles() {
    var dlg = dialog('user-roles');
    if (!dlg) return;
    var user = findUser(dlg.getAttribute('data-uid'));
    if (!user) return;
    var roles = readRoles(dlg.querySelector('[data-roles-options]'));
    var error = dlg.querySelector('[data-roles-error]');

    if (!roles.length) {
      error.textContent = '账号至少保留一个角色';
      error.style.display = 'block';
      return;
    }
    if (user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0 && roles.indexOf('admin') === -1) {
      error.textContent = '不能移除最后一个超级管理员的管理员角色';
      error.style.display = 'block';
      return;
    }

    user.roles = roles;
    render();
    CG.closeLayer(dlg);
    CG.toast('角色已更新为：' + roleNames(roles) + '，该用户下一次请求即生效', 'ok');
  }

  function openReset(user) {
    var dlg = dialog('reset-password');
    if (!dlg) return;
    dlg.setAttribute('data-uid', user.id);
    dlg.querySelector('[data-reset-user]').textContent = user.name;
    dlg.querySelector('[data-reset-username]').textContent = user.username;
    dlg.querySelector('[data-reset-force]').checked = true;
    setPassword(dlg.querySelector('[data-reset-password]'), randomPassword());
    CG.openLayer(dlg);
  }

  function confirmReset() {
    var dlg = dialog('reset-password');
    if (!dlg) return;
    var user = findUser(dlg.getAttribute('data-uid'));
    CG.closeLayer(dlg);
    CG.toast('已重置「' + (user ? user.name : '该用户') + '」的密码，所有在线会话已失效；临时密码仅显示一次', 'ok');
  }

  function openToggle(user) {
    var dlg = dialog('toggle-user');
    if (!dlg) return;
    var enabling = user.status === 'off';
    dlg.setAttribute('data-uid', user.id);
    dlg.querySelector('#toggle-title').textContent = enabling ? '启用账号' : '禁用账号';
    dlg.querySelector('[data-toggle-sub]').textContent = enabling
      ? '启用后恢复登录，权限沿用当前角色'
      : '操作立即生效，无需等待会话过期';
    dlg.querySelector('[data-toggle-verb]').textContent = enabling ? '启用' : '禁用';
    dlg.querySelector('[data-toggle-name]').textContent = user.name;
    var desc = dlg.querySelector('[data-toggle-desc]');
    desc.className = 'inline-alert' + (enabling ? '' : ' inline-alert--warn');
    desc.textContent = enabling
      ? '启用后该账号可立即登录，权限与数据范围沿用当前角色配置。'
      : '禁用后其后续请求返回 401，已登录会话立即失效；账号数据、资源归属与共享保持不变，可随时重新启用。';

    var confirm = dlg.querySelector('[data-confirm-toggle]');
    confirm.textContent = enabling ? '确认启用' : '确认禁用';
    confirm.className = 'btn ' + (enabling ? 'btn--primary' : 'btn--danger-solid');
    CG.openLayer(dlg);
  }

  function confirmToggle() {
    var dlg = dialog('toggle-user');
    if (!dlg) return;
    var user = findUser(dlg.getAttribute('data-uid'));
    if (!user) return;
    var enabling = user.status === 'off';
    user.status = enabling ? 'on' : 'off';
    render();
    CG.closeLayer(dlg);
    CG.toast(enabling
      ? '已启用「' + user.name + '」，登录恢复'
      : '已禁用「' + user.name + '」，其后续请求返回 401', enabling ? 'ok' : 'warn');
  }

  function openDelete(user) {
    var dlg = dialog('delete-user');
    if (!dlg) return;
    var blocked = user.resources > 0;
    var lastAdmin = user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0;
    var reason = '';
    if (blocked) {
      reason = '该账号仍拥有 ' + user.resources + ' 个资源（Agent / 知识库 / Prompt / 工具）。请先转移归属。';
    } else if (lastAdmin) {
      reason = '该账号是最后一个超级管理员，不能删除。';
    }

    dlg.setAttribute('data-uid', user.id);
    dlg.querySelector('[data-delete-name]').textContent = user.name;
    dlg.querySelector('[data-delete-warning]').hidden = !reason;
    dlg.querySelector('[data-delete-warning-text]').textContent = reason;
    dlg.querySelector('[data-delete-transfer]').hidden = !blocked;

    var confirm = dlg.querySelector('[data-confirm-delete]');
    confirm.disabled = !!reason;
    confirm.title = reason || '';
    CG.openLayer(dlg);
  }

  function confirmDelete() {
    var dlg = dialog('delete-user');
    if (!dlg) return;
    var user = findUser(dlg.getAttribute('data-uid'));
    if (!user) return;
    var lastAdmin = user.roles.indexOf('admin') !== -1 && adminCount(user.id) === 0;
    if (user.resources > 0 || lastAdmin) {
      CG.toast('删除被拒绝：' + (user.resources > 0
        ? user.name + ' 仍拥有 ' + user.resources + ' 个资源，请先转移归属'
        : '不能删除最后一个超级管理员'), 'error');
      return;
    }
    users = users.filter(function (u) { return u.id !== user.id; });
    render();
    CG.closeLayer(dlg);
    CG.toast('已删除用户「' + user.name + '」，其 ACL 条目已清理', 'ok');
  }

  /* ---------- URL 直达弹窗 ---------- */

  function prepareFromUrl() {
    var params = new URLSearchParams(location.search);
    var openId = params.get('open');
    if (!openId) return;

    if (openId === 'create-user') {
      resetCreateForm();
      return;
    }

    var user = findUser(params.get('uid'));
    if (!user) return;
    if (openId === 'edit-user') openEdit(user);
    else if (openId === 'user-roles') openRoles(user);
    else if (openId === 'reset-password') openReset(user);
    else if (openId === 'toggle-user') openToggle(user);
    else if (openId === 'delete-user') openDelete(user);
  }

  /* ---------- 事件绑定 ---------- */

  function bindEvents() {
    if (search) {
      search.addEventListener('input', function () {
        state.q = search.value;
        state.page = 1;
        render();
      });
    }
    if (roleSelect) {
      roleSelect.addEventListener('change', function () {
        state.role = roleSelect.value;
        state.page = 1;
        render();
      });
    }
    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        state.status = statusSelect.value;
        state.page = 1;
        render();
      });
    }

    tbody.addEventListener('click', function (e) {
      var button = e.target.closest('button[data-act]');
      if (!button) return;
      var user = findUser(button.getAttribute('data-uid') || (button.closest('tr') || {}).getAttribute('data-uid'));
      if (!user) return;
      var action = button.getAttribute('data-act');
      if (action === 'edit') openEdit(user);
      else if (action === 'roles') openRoles(user);
      else if (action === 'reset') openReset(user);
      else if (action === 'menu') {
        if (!menu.hidden && menuBtn === button) closeMenu();
        else {
          closeMenu();
          openMenu(button, user);
        }
      }
    });

    if (pager) {
      pager.addEventListener('click', function (e) {
        var button = e.target.closest('[data-page-btn]');
        if (!button || button.disabled) return;
        var value = button.getAttribute('data-page-btn');
        if (value === 'prev') state.page--;
        else if (value === 'next') state.page++;
        else state.page = parseInt(value, 10) || 1;
        render();
      });
    }

    var clearButton = document.querySelector('[data-clear-user-filters]');
    if (clearButton) clearButton.addEventListener('click', clearFilters);

    menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-menu-action]');
      if (!item || item.disabled) return;
      var user = findUser(menu.getAttribute('data-uid'));
      var action = item.getAttribute('data-menu-action');
      closeMenu();
      if (!user) return;
      if (action === 'reset') openReset(user);
      else if (action === 'toggle') openToggle(user);
      else if (action === 'delete') openDelete(user);
    });

    document.addEventListener('click', function (e) {
      if (menu.hidden) return;
      if (menu.contains(e.target)) return;
      if (e.target.closest && e.target.closest('[data-act="menu"]')) return;
      closeMenu();
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);

    document.addEventListener('change', function (e) {
      var input = e.target.closest('.role-option input[type="checkbox"]');
      if (!input) return;
      var label = input.closest('.role-option');
      if (label) label.classList.toggle('is-checked', input.checked);
    });

    document.addEventListener('input', function (e) {
      var field = e.target.closest('.field.has-error');
      if (field) {
        field.classList.remove('has-error');
        e.target.removeAttribute('aria-invalid');
      }
    });

    document.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-pw-toggle]');
      if (toggle) {
        var row = toggle.closest('.password-row');
        var input = row ? row.querySelector('input') : null;
        if (!input) return;
        var hiding = input.type === 'text';
        input.type = hiding ? 'password' : 'text';
        toggle.textContent = hiding ? '显示' : '隐藏';
        return;
      }

      var copy = e.target.closest('[data-pw-copy]');
      if (copy) {
        var copyRow = copy.closest('.password-row');
        var copyInput = copyRow ? copyRow.querySelector('input') : null;
        if (copyInput) copyText(copyInput.value);
        return;
      }

      var regen = e.target.closest('[data-pw-regen]');
      if (regen) {
        var regenRow = regen.closest('.password-row');
        var regenInput = regenRow ? regenRow.querySelector('input') : null;
        if (regenInput) setPassword(regenInput, randomPassword());
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-open="create-user"]')) {
        resetCreateForm();
        var input = document.querySelector('#new-username');
        if (input) input.focus({ preventScroll: true });
      }
      if (e.target.closest('[data-save-user-roles]')) saveRoles();
      if (e.target.closest('[data-confirm-reset]')) confirmReset();
      if (e.target.closest('[data-confirm-toggle]')) confirmToggle();
      if (e.target.closest('[data-confirm-delete]')) confirmDelete();
      if (e.target.closest('[data-delete-transfer]')) {
        CG.toast('原型模拟：请到 Agent、知识库、Prompt 或工具列表转移该账号名下的资源', 'warn');
      }
    });

    var createForm = document.querySelector('[data-create-user-form]');
    if (createForm) {
      createForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitCreate();
      });
    }

    var editForm = document.querySelector('[data-edit-user-form]');
    if (editForm) {
      editForm.addEventListener('submit', function (e) {
        e.preventDefault();
        submitEdit();
      });
    }
  }

  /* ---------- 启动 ---------- */

  function init() {
    tbody = document.querySelector('[data-user-rows]');
    table = document.querySelector('[data-user-table]');
    emptyBox = document.querySelector('[data-user-empty]');
    rangeLabel = document.querySelector('[data-user-range]');
    pager = document.querySelector('[data-user-pager]');
    tableFoot = document.querySelector('.table-foot');
    summary = document.querySelector('[data-user-summary]');
    search = document.querySelector('[data-user-search]');
    roleSelect = document.querySelector('[data-user-role]');
    statusSelect = document.querySelector('[data-user-status]');
    if (!tbody || !table) return;

    menu = document.createElement('div');
    menu.className = 'row-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    document.body.appendChild(menu);

    resetCreateForm();
    bindEvents();
    render();
    prepareFromUrl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
