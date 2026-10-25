/* ==========================================================================
   辰光 Agent · RBAC 原型交互层
   说明：纯前端模拟 /users/me 返回的权限与数据范围，不做任何真实请求。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 身份与权限模型 ---------- */

  var OWNERS = { u1: '陈晓', u2: '张三', u3: '李四', u4: '王敏', u5: '赵宁', u6: '孙悦', u7: '周敏', u8: '吴迪' };
  var SCOPE_LABEL = { ALL: '全部数据', SELF: '仅本人', CUSTOM: '指定用户/角色' };
  var VIEW_PERMS = ['agent:view', 'model:view', 'prompt:view', 'knowledge:view', 'tool:view', 'conversation:view', 'analytics:view'];

  var DEVELOPER_PERMS = [
    'agent:view', 'agent:create', 'agent:update', 'agent:publish',
    'model:view',
    'prompt:view', 'prompt:create', 'prompt:update', 'prompt:delete', 'prompt:publish',
    'knowledge:view', 'knowledge:create', 'knowledge:update',
    'tool:view', 'tool:create', 'tool:update',
    'conversation:view', 'analytics:view'
  ];
  var OPERATOR_PERMS = [
    'agent:view', 'model:view', 'prompt:view',
    'knowledge:view', 'knowledge:create', 'knowledge:update',
    'tool:view', 'conversation:view', 'analytics:view'
  ];

  var PERM_GROUPS = [
    { label: 'Agent 管理', codes: ['agent:view', 'agent:create', 'agent:update', 'agent:delete', 'agent:publish'] },
    { label: '模型管理', codes: ['model:view', 'model:create', 'model:update', 'model:delete'] },
    { label: 'Prompt 管理', codes: ['prompt:view', 'prompt:create', 'prompt:update', 'prompt:delete', 'prompt:publish'] },
    { label: '知识库管理', codes: ['knowledge:view', 'knowledge:create', 'knowledge:update', 'knowledge:delete'] },
    { label: '工具管理', codes: ['tool:view', 'tool:create', 'tool:update', 'tool:delete'] },
    { label: '对话日志', codes: ['conversation:view'] },
    { label: '数据统计', codes: ['analytics:view'] },
    { label: '用户管理', codes: ['user:view', 'user:create', 'user:update', 'user:delete'] },
    { label: '角色管理', codes: ['role:view', 'role:create', 'role:update', 'role:delete'] },
    { label: '权限管理', codes: ['permission:view', 'permission:create', 'permission:update', 'permission:delete'] },
    { label: 'API 密钥', codes: ['apikey:view', 'apikey:create', 'apikey:update', 'apikey:delete'] },
    { label: '审计日志', codes: ['audit:view'] },
    { label: '告警规则', codes: ['alert:view', 'alert:create', 'alert:update', 'alert:delete'] },
    { label: '系统配置', codes: ['settings:view', 'settings:update'] }
  ];

  var IDENTITIES = {
    admin: {
      key: 'admin', name: '陈晓', uid: 'u1', roleKey: 'admin', role: '管理员',
      note: '超级管理员，跳过一切校验', superuser: true, perms: ['*'],
      scopes: {
        agent: { view: 'ALL', manage: 'ALL' }, prompt: { view: 'ALL', manage: 'ALL' },
        knowledge: { view: 'ALL', manage: 'ALL' }, tool: { view: 'ALL', manage: 'ALL' }
      }
    },
    developer: {
      key: 'developer', name: '李四', uid: 'u3', roleKey: 'developer', role: '开发者',
      note: '查看全部、管理本人，含资源级共享', superuser: false, perms: DEVELOPER_PERMS,
      scopes: {
        agent: { view: 'ALL', manage: 'SELF' }, prompt: { view: 'ALL', manage: 'SELF' },
        knowledge: { view: 'ALL', manage: 'SELF' }, tool: { view: 'ALL', manage: 'SELF' }
      }
    },
    developerSelf: {
      key: 'developerSelf', name: '李四', uid: 'u3', roleKey: 'developer', role: '开发者',
      note: '同为开发者，查看范围被收紧为本人', superuser: false, perms: DEVELOPER_PERMS,
      scopes: {
        agent: { view: 'SELF', manage: 'SELF' }, prompt: { view: 'SELF', manage: 'SELF' },
        knowledge: { view: 'SELF', manage: 'SELF' }, tool: { view: 'SELF', manage: 'SELF' }
      }
    },
    operator: {
      key: 'operator', name: '王敏', uid: 'u4', roleKey: 'operator', role: '运营',
      note: '知识库可管理全部，其余资源仅本人', superuser: false, perms: OPERATOR_PERMS,
      scopes: {
        agent: { view: 'ALL', manage: 'SELF' }, prompt: { view: 'ALL', manage: 'SELF' },
        knowledge: { view: 'ALL', manage: 'ALL' }, tool: { view: 'ALL', manage: 'SELF' }
      }
    },
    viewer: {
      key: 'viewer', name: '赵宁', uid: 'u5', roleKey: 'viewer', role: '只读',
      note: '仅查看，不产生任何变更', superuser: false,
      perms: VIEW_PERMS.slice(),
      scopes: {
        agent: { view: 'ALL', manage: 'SELF' }, prompt: { view: 'ALL', manage: 'SELF' },
        knowledge: { view: 'ALL', manage: 'SELF' }, tool: { view: 'ALL', manage: 'SELF' }
      }
    }
  };

  var RESERVED = {
    apikey: { name: 'API 密钥', perm: 'apikey:view', route: '/system/api-keys' },
    audit: { name: '审计日志', perm: 'audit:view', route: '/system/audit' },
    alert: { name: '告警规则', perm: 'alert:view', route: '/system/alerts' },
    settings: { name: '系统配置', perm: 'settings:view', route: '/system/settings' }
  };

  var ROLE_PRESETS = {
    admin: {
      name: '管理员', users: 1, perms: '*',
      scopes: { agent: ['ALL', 'ALL'], prompt: ['ALL', 'ALL'], knowledge: ['ALL', 'ALL'], tool: ['ALL', 'ALL'] }
    },
    developer: {
      name: '开发者', users: 3, perms: DEVELOPER_PERMS,
      scopes: { agent: ['ALL', 'SELF'], prompt: ['ALL', 'SELF'], knowledge: ['CUSTOM', 'SELF'], tool: ['ALL', 'SELF'] }
    },
    operator: {
      name: '运营', users: 2, perms: OPERATOR_PERMS,
      scopes: { agent: ['ALL', 'SELF'], prompt: ['ALL', 'SELF'], knowledge: ['ALL', 'ALL'], tool: ['ALL', 'SELF'] }
    },
    viewer: {
      name: '只读', users: 2, perms: VIEW_PERMS,
      scopes: { agent: ['ALL', 'SELF'], prompt: ['ALL', 'SELF'], knowledge: ['ALL', 'SELF'], tool: ['ALL', 'SELF'] }
    },
    labeler: {
      name: '数据标注员', users: 1, perms: ['knowledge:view', 'knowledge:update', 'prompt:view', 'tool:view'],
      scopes: { agent: ['SELF', 'SELF'], prompt: ['SELF', 'SELF'], knowledge: ['SELF', 'SELF'], tool: ['SELF', 'SELF'] }
    }
  };

  function applyRolePreset(key, dialog) {
    var preset = ROLE_PRESETS[key];
    if (!preset || !dialog) return;
    dialog.querySelectorAll('[data-role-name]').forEach(function (n) { n.textContent = preset.name; });
    dialog.querySelectorAll('[data-role-users]').forEach(function (n) { n.textContent = preset.users; });

    dialog.querySelectorAll('.check[data-code]').forEach(function (check) {
      var code = check.getAttribute('data-code');
      var on = preset.perms === '*' || preset.perms.indexOf(code) !== -1;
      check.classList.toggle('is-on', on);
      check.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    dialog.querySelectorAll('[data-scope-res]').forEach(function (row) {
      var res = row.getAttribute('data-scope-res');
      var sc = preset.scopes[res] || ['SELF', 'SELF'];
      var view = row.querySelector('select[data-scope-dim="view"]');
      var manage = row.querySelector('select[data-scope-dim="manage"]');
      if (view) view.value = sc[0];
      if (manage) manage.value = sc[1];
      var targets = row.querySelector('[data-targets]');
      if (targets) targets.hidden = sc[0] !== 'CUSTOM' && sc[1] !== 'CUSTOM';
    });

    updateSelectedCount(dialog);
  }

  var NAV = [
    {
      group: '平台功能',
      items: [
        { key: 'dashboard', label: '工作台', href: 'dashboard.html', icon: 'grid' },
        { key: 'agents', label: 'Agent 管理', href: 'agents.html', perm: 'agent:view', icon: 'bot' },
        { key: 'models', label: '模型管理', href: 'models.html', perm: 'model:view', icon: 'cpu' },
        { key: 'prompts', label: 'Prompt 管理', href: 'prompts.html', perm: 'prompt:view', icon: 'file' },
        { key: 'knowledge', label: '知识库', href: 'knowledge.html', perm: 'knowledge:view', icon: 'database' },
        { key: 'tools', label: '工具管理', href: 'tools.html', perm: 'tool:view', icon: 'wrench' },
        { key: 'conversations', label: '对话日志', href: 'conversations.html', perm: 'conversation:view', icon: 'message', reserved: true },
        { key: 'analytics', label: '数据统计', href: 'analytics.html', perm: 'analytics:view', icon: 'chart', reserved: true }
      ]
    },
    {
      group: '系统管理',
      items: [
        { key: 'system-users', label: '用户管理', href: 'system-users.html', perm: 'user:view', icon: 'users' },
        { key: 'system-roles', label: '角色管理', href: 'system-roles.html', perm: 'role:view', icon: 'shield' },
        { key: 'system-permissions', label: '权限目录', href: 'system-permissions.html', perm: 'permission:view', icon: 'key' },
        { key: 'apikey', label: 'API 密钥', href: 'reserved.html?module=apikey', perm: 'apikey:view', icon: 'key', reserved: true },
        { key: 'audit', label: '审计日志', href: 'reserved.html?module=audit', perm: 'audit:view', icon: 'scroll', reserved: true },
        { key: 'alert', label: '告警规则', href: 'reserved.html?module=alert', perm: 'alert:view', icon: 'bell', reserved: true },
        { key: 'settings', label: '系统配置', href: 'reserved.html?module=settings', perm: 'settings:view', icon: 'settings', reserved: true }
      ]
    }
  ];

  var ICONS = {
    grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    bot: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 16h4"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.3-2.3z"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.5M18 14c2 .8 3 2.9 3 6"/>',
    shield: '<path d="M12 3l7 3v6c0 4.4-3 7.9-7 9-4-1.1-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8 3 3-2 2 2 2-3 3-2-2-2 2z"/>',
    scroll: '<path d="M5 4h11v13H7a2 2 0 0 0-2 2z"/><path d="M16 8h3v11a2 2 0 0 1-2 2H7M9 8h4M9 11h4"/>',
    bell: '<path d="M18 15V10a6 6 0 1 0-12 0v5l-2 3h16z"/><path d="M10 21h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || ICONS.grid) + '</svg>';
  }

  /* ---------- 解析当前身份 ---------- */

  var params = new URLSearchParams(location.search);
  var identityKey = params.get('as');
  if (!identityKey || !IDENTITIES[identityKey]) {
    try { identityKey = localStorage.getItem('cg.rbac.identity'); } catch (e) { identityKey = null; }
  }
  if (!identityKey || !IDENTITIES[identityKey]) identityKey = 'admin';
  var me = IDENTITIES[identityKey];
  var CONTACTS = {
    admin: { username: 'chenxiao', email: 'chenxiao@chenguang.ai' },
    developer: { username: 'lisi', email: 'lisi@chenguang.ai' },
    developerSelf: { username: 'lisi', email: 'lisi@chenguang.ai' },
    operator: { username: 'wangmin', email: 'wangmin@chenguang.ai' },
    viewer: { username: 'zhaoning', email: 'zhaoning@chenguang.ai' }
  };
  me.username = (CONTACTS[identityKey] || {}).username || '';
  me.email = (CONTACTS[identityKey] || {}).email || '';
  var ghostMode = params.get('ghost') === '1' || params.get('ghost') === 'true';

  function can(code) {
    if (!code) return true;
    if (me.superuser || me.perms.indexOf('*') !== -1) return true;
    return me.perms.indexOf(code) !== -1;
  }
  function canAny(codes) {
    return codes.some(function (c) { return can(c); });
  }
  function scopeOf(res, dim) {
    var s = me.scopes[res];
    if (!s) return 'SELF';
    return s[dim] || 'SELF';
  }
  function scopeLabel(res) {
    if (!res) return '';
    return SCOPE_LABEL[scopeOf(res, 'view')] + ' / ' + SCOPE_LABEL[scopeOf(res, 'manage')];
  }

  /* ---------- 数据行判定 ---------- */

  function listAttr(node, name) {
    return (node.getAttribute(name) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function rowCanView(tr, res) {
    if (me.superuser) return true;
    if (tr.getAttribute('data-owner') === me.uid) return true;
    if (listAttr(tr, 'data-acl-manage').indexOf(me.uid) !== -1) return true;
    if (listAttr(tr, 'data-acl-view').indexOf(me.uid) !== -1) return true;
    if (listAttr(tr, 'data-acl-role-view').indexOf(me.roleKey) !== -1) return true;
    if (listAttr(tr, 'data-acl-role-manage').indexOf(me.roleKey) !== -1) return true;
    var view = scopeOf(res, 'view');
    if (view === 'ALL') return true;
    if (scopeOf(res, 'manage') === 'ALL') return true;
    return false;
  }
  function rowCanManage(tr, res) {
    if (me.superuser) return true;
    if (tr.getAttribute('data-owner') === me.uid) return true;
    if (listAttr(tr, 'data-acl-manage').indexOf(me.uid) !== -1) return true;
    if (listAttr(tr, 'data-acl-role-manage').indexOf(me.roleKey) !== -1) return true;
    return scopeOf(res, 'manage') === 'ALL';
  }
  function canManageOwner(owner, res, node) {
    if (!res) return false;
    if (me.superuser) return true;
    if (owner === me.uid) return true;
    if (node && listAttr(node, 'data-acl-manage').indexOf(me.uid) !== -1) return true;
    return scopeOf(res, 'manage') === 'ALL';
  }

  /* ---------- 权限开关渲染 ---------- */

  function setGate(node, ok, code) {
    if (code) node.setAttribute('data-perm', code);
    node.classList.toggle('is-ghost', !ok && ghostMode);
    node.hidden = !ok && !ghostMode;
    node.setAttribute('aria-hidden', ok ? 'false' : 'true');
    if (!ok && code) node.title = '运行时隐藏 · 需要 ' + code;
    else if (node.title && node.title.indexOf('运行时隐藏') === 0) node.removeAttribute('title');
  }

  function syncGhostBanner() {
    var existing = document.querySelector('[data-ghost-banner]');
    if (ghostMode) {
      if (existing) return;
      var page = document.querySelector('.content .page');
      if (!page) return;
      var banner = document.createElement('div');
      banner.className = 'ghost-banner';
      banner.setAttribute('data-ghost-banner', '');
      banner.innerHTML = '<span>评审模式：虚线控件在真实运行时不会渲染。悬停可查看所需权限码。</span>';
      page.insertBefore(banner, page.firstChild);
    } else if (existing) {
      existing.remove();
    }
  }

  function applyPermissions() {
    document.querySelectorAll('[data-perm]').forEach(function (node) {
      if (node.closest('tr[data-owner]') && node.hasAttribute('data-row-manage')) return;
      setGate(node, can(node.getAttribute('data-perm')), node.getAttribute('data-perm'));
    });

    document.querySelectorAll('[data-any-perm]').forEach(function (node) {
      var codes = listAttr(node, 'data-any-perm');
      setGate(node, canAny(codes), codes.join(' / '));
    });

    var res = document.body.getAttribute('data-resource');
    if (res) {
      document.querySelectorAll('tr[data-owner]').forEach(function (tr) {
        tr.hidden = !rowCanView(tr, res);
        tr.querySelectorAll('[data-row-manage]').forEach(function (node) {
          var fnOk = node.hasAttribute('data-perm') ? can(node.getAttribute('data-perm')) : true;
          setGate(node, rowCanManage(tr, res) && fnOk, node.getAttribute('data-perm') || res + ':update');
        });
      });

      document.querySelectorAll('[data-manage-owner]').forEach(function (node) {
        var owner = node.getAttribute('data-manage-owner');
        var fnOk = node.hasAttribute('data-perm') ? can(node.getAttribute('data-perm')) : true;
        setGate(node, canManageOwner(owner, res, node) && fnOk, node.getAttribute('data-perm') || res + ':update');
      });
    }

    document.querySelectorAll('tr[data-uid]').forEach(function (tr) {
      if (tr.getAttribute('data-uid') === me.uid) {
        tr.classList.add('is-self-row');
        tr.querySelectorAll('[data-not-self]').forEach(function (n) { n.hidden = true; });
        var selfTag = tr.querySelector('[data-self-tag]');
        if (selfTag) selfTag.hidden = false;
        var cell = tr.querySelector('.actions');
        if (cell) {
          var visible = Array.prototype.some.call(cell.children, function (c) { return !c.hidden; });
          if (!visible && !cell.querySelector('.self-note')) {
            var note = document.createElement('span');
            note.className = 'self-note';
            note.textContent = '不可操作自己';
            cell.appendChild(note);
          }
        }
      }
    });

    updateCounts();
  }

  function updateCounts() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('table[data-count-table] tbody tr[data-owner]'));
    var visible = rows.filter(function (r) { return !r.hidden; }).length;
    document.querySelectorAll('[data-visible-count]').forEach(function (n) { n.textContent = visible; });
    document.querySelectorAll('[data-total-count]').forEach(function (n) { n.textContent = rows.length; });

    var empty = document.querySelector('[data-empty-scope]');
    var wrap = document.querySelector('[data-table-wrap]');
    if (empty && wrap) {
      var showEmpty = rows.length > 0 && visible === 0;
      empty.hidden = !showEmpty;
      wrap.hidden = showEmpty;
    }

    var visibleRows = rows.filter(function (r) { return !r.hidden; });
    document.querySelectorAll('[data-sum]').forEach(function (n) {
      var key = n.getAttribute('data-sum');
      var total = 0;
      visibleRows.forEach(function (r) {
        total += parseFloat(r.getAttribute('data-' + key) || '0') || 0;
      });
      var format = n.getAttribute('data-format');
      if (format === 'money') n.textContent = '¥' + total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      else if (format === 'compact') n.textContent = compact(total);
      else n.textContent = total.toLocaleString('zh-CN');
    });

    var convTotal = 0;
    visibleRows.forEach(function (r) { convTotal += parseFloat(r.getAttribute('data-conv') || '0') || 0; });
    visibleRows.forEach(function (r) {
      var share = r.querySelector('[data-share-of]');
      if (!share) return;
      var key = share.getAttribute('data-share-of');
      var v = parseFloat(r.getAttribute('data-' + key) || '0') || 0;
      share.textContent = convTotal > 0 ? (v / convTotal * 100).toFixed(1) + '%' : '0%';
    });
  }

  function compact(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(0) + 'k';
    return String(v);
  }

  function fillIdentityFacts() {
    document.querySelectorAll('[data-me-name]').forEach(function (n) { n.textContent = me.name; });
    document.querySelectorAll('[data-me-initial]').forEach(function (n) { n.textContent = me.name.slice(0, 1); });
    document.querySelectorAll('[data-me-username]').forEach(function (n) { n.textContent = me.username; });
    document.querySelectorAll('[data-me-email]').forEach(function (n) { n.textContent = me.email; });
    document.querySelectorAll('[data-me-superuser]').forEach(function (n) { n.textContent = me.superuser ? '是' : '否'; });
    document.querySelectorAll('[data-me-uid]').forEach(function (n) { n.textContent = me.uid; });
    document.querySelectorAll('[data-me-role]').forEach(function (n) { n.textContent = me.role; });
    document.querySelectorAll('[data-me-perms]').forEach(function (n) {
      n.textContent = me.superuser ? '47' : me.perms.length;
    });
    document.querySelectorAll('[data-me-scope]').forEach(function (n) {
      var res = n.getAttribute('data-me-scope');
      n.textContent = SCOPE_LABEL[scopeOf(res, 'view')] + ' / ' + SCOPE_LABEL[scopeOf(res, 'manage')];
    });
  }

  function renderProfilePerms() {
    var host = document.querySelector('[data-perm-list]');
    if (!host) return;
    var mine = me.superuser ? null : me.perms;
    var total = 0;
    var html = '';
    PERM_GROUPS.forEach(function (group) {
      var codes = mine ? group.codes.filter(function (c) { return mine.indexOf(c) !== -1; }) : group.codes;
      if (!codes.length) return;
      total += codes.length;
      html += '<div class="module-perm-group">' +
        '<div class="h">' + group.label + '<span class="tag">' + codes.length + '</span></div>' +
        '<div class="codes">' + codes.map(function (c) { return '<code class="code">' + c + '</code>'; }).join('') + '</div>' +
        '</div>';
    });
    host.innerHTML = html || '<p class="muted">当前身份没有任何功能权限。</p>';
    document.querySelectorAll('[data-perm-total]').forEach(function (n) { n.textContent = total; });
  }

  /* ---------- 侧边栏 ---------- */

  function renderSidebar() {
    var host = document.getElementById('sidebar');
    if (!host) return;
    var activeKey = document.body.getAttribute('data-page') || '';

    var html = '' +
      '<div class="brand">' +
        '<div class="brand-mark" aria-hidden="true">辰</div>' +
        '<div><div class="brand-name">辰光 Agent</div><div class="brand-sub">RBAC 授权控制台</div></div>' +
      '</div>' +
      '<nav class="nav" aria-label="主导航">';

    NAV.forEach(function (group) {
      var visible = group.items.filter(function (item) { return !item.perm || can(item.perm); });
      if (!visible.length) return;
      html += '<div class="nav-group-label">' + group.group + '</div>';
      visible.forEach(function (item) {
        var isActive = item.key === activeKey;
        html += '<a class="nav-link' + (isActive ? ' is-active' : '') + '" href="' + item.href + '" title="' + item.label + '"' +
          (isActive ? ' aria-current="page"' : '') + '>' + icon(item.icon) +
          '<span>' + item.label + '</span>' +
          (item.reserved ? '<span class="nav-dot" title="后端模块未上线"></span>' : '') +
          '</a>';
      });
    });

    html += '</nav>' +
      '<div class="nav-foot">' +
        '<a class="userbox" href="profile.html">' +
          '<span class="avatar" aria-hidden="true">' + me.name.slice(0, 1) + '</span>' +
          '<span><span class="n">' + me.name + '</span><br><span class="r">' + me.role +
          (me.superuser ? ' · 超管' : '') + '</span></span>' +
          '<span class="chev">' + icon('chevron') + '</span>' +
        '</a>' +
      '</div>';

    host.innerHTML = html;
    host.setAttribute('aria-label', '侧边栏');
  }

  /* ---------- 顶栏 ---------- */

  function renderTopbar() {
    var host = document.getElementById('topbar');
    if (!host) return;
    var crumb = (document.body.getAttribute('data-crumb') || '').split('|').filter(Boolean);
    var res = document.body.getAttribute('data-resource');

    var crumbHtml = '<a href="dashboard.html">工作台</a>';
    crumb.forEach(function (part, i) {
      crumbHtml += '<span class="sep">/</span>';
      if (i === crumb.length - 1) crumbHtml += '<span class="here">' + part + '</span>';
      else crumbHtml += '<span>' + part + '</span>';
    });

    var scopeHtml = '';
    if (res) {
      scopeHtml = '<span class="scope-chip" title="当前身份对 ' + res + ' 的有效数据范围">' +
        '查看 <b>' + SCOPE_LABEL[scopeOf(res, 'view')] + '</b><span class="sep">/</span>' +
        '管理 <b>' + SCOPE_LABEL[scopeOf(res, 'manage')] + '</b></span>';
    }

    host.innerHTML =
      '<nav class="crumbs" aria-label="面包屑">' + crumbHtml + '</nav>' +
      '<div class="topbar-right">' + scopeHtml +
        '<a class="icon-btn" href="profile.html" title="个人中心" aria-label="个人中心">' + icon('users') + '</a>' +
        '<button class="identity-chip" type="button" data-review-toggle title="切换原型身份">' +
          '<span class="avatar" aria-hidden="true">' + me.name.slice(0, 1) + '</span>' +
          '<span>' + me.name + '</span>' +
          '<span class="role">' + me.role + '</span>' +
          '<span class="chev">' + icon('chevron') + '</span>' +
        '</button>' +
      '</div>';
  }

  /* ---------- 权限上下文条 ---------- */

  function renderContext() {
    var host = document.querySelector('[data-context]');
    if (!host) return;
    var pagePerms = listAttr(document.body, 'data-page-perm');
    var res = document.body.getAttribute('data-resource');
    var summary = document.body.hasAttribute('data-scope-summary');

    var scopeHtml;
    if (res) {
      scopeHtml = '<span>查看 <b>' + SCOPE_LABEL[scopeOf(res, 'view')] + '</b></span>' +
        '<span class="ctx-sep">/</span><span>管理 <b>' + SCOPE_LABEL[scopeOf(res, 'manage')] + '</b></span>';
    } else if (summary) {
      scopeHtml = ['agent', 'prompt', 'knowledge', 'tool'].map(function (r) {
        return '<span class="tag">' + r + ' <code class="code code--plain">' +
          scopeOf(r, 'view') + '/' + scopeOf(r, 'manage') + '</code></span>';
      }).join('');
    } else {
      scopeHtml = '<span>平台级资源 · 仅受功能权限控制</span>';
    }

    var permsHtml = pagePerms.length
      ? pagePerms.map(function (c) { return '<code class="code">' + c + '</code>'; }).join('')
      : '<span class="muted">仅需登录</span>';

    host.innerHTML =
      '<div class="context-cell">' +
        '<div class="context-label">当前身份</div>' +
        '<div class="context-value">' +
          '<span class="seal seal--sm" aria-hidden="true">' + me.name.slice(0, 1) + '</span>' +
          '<b>' + me.name + '</b><span class="tag">' + me.role + '</span>' +
          (me.superuser ? '<span class="tag tag--system">is_superuser</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="context-cell">' +
        '<div class="context-label">本页功能权限</div>' +
        '<div class="context-value">' + permsHtml + '</div>' +
      '</div>' +
      '<div class="context-cell">' +
        '<div class="context-label">有效数据范围</div>' +
        '<div class="context-value">' + scopeHtml + '</div>' +
      '</div>' +
      '<div class="context-cell context-cell--action">' +
        '<a class="btn btn--sm btn--quiet" href="profile.html">权限来源</a>' +
      '</div>';
  }

  /* ---------- 路由守卫 ---------- */

  function guardPage() {
    var modulePage = document.body.getAttribute('data-module-page');
    if (modulePage && RESERVED[modulePage]) {
      document.body.setAttribute('data-page-perm', RESERVED[modulePage].perm);
    }
    var need = document.body.getAttribute('data-page-perm');
    if (!need) return true;
    var codes = listAttr(document.body, 'data-page-perm');
    if (canAny(codes)) return true;
    var target = 'forbidden.html?need=' + encodeURIComponent(codes.join(', ')) +
      '&from=' + encodeURIComponent(location.pathname.split('/').pop() || '') +
      '&as=' + encodeURIComponent(identityKey);
    location.replace(target);
    return false;
  }

  /* ---------- 弹窗 / 抽屉 ---------- */

  function lockBody() {
    var open = document.querySelector('.overlay:not([hidden])') || document.querySelector('[data-drawer]:not([hidden])');
    document.body.classList.toggle('is-locked', !!open);
  }
  function openLayer(node) {
    if (!node) return;
    node.hidden = false;
    lockBody();
    var focusable = node.querySelector('button, [href], input, select, textarea');
    if (focusable) focusable.focus({ preventScroll: true });
  }
  function closeLayer(node) {
    if (!node) return;
    node.hidden = true;
    lockBody();
  }
  function closeAllLayers() {
    document.querySelectorAll('.overlay:not([hidden]), [data-drawer]:not([hidden])').forEach(function (n) {
      n.hidden = true;
    });
    lockBody();
  }

  function bindLayers() {
    document.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-open]');
      if (opener) {
        e.preventDefault();
        var id = opener.getAttribute('data-open');
        openLayer(document.querySelector('[data-dialog="' + id + '"]'));
        return;
      }
      var closer = e.target.closest('[data-close]');
      if (closer) {
        e.preventDefault();
        closeLayer(closer.closest('.overlay, [data-drawer]'));
        return;
      }
      var overlay = e.target.classList && e.target.classList.contains('overlay') ? e.target : null;
      if (overlay) { closeLayer(overlay); return; }
      var drawerOverlay = e.target.classList && e.target.classList.contains('drawer-overlay') ? e.target : null;
      if (drawerOverlay) closeLayer(drawerOverlay.closest('[data-drawer]'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllLayers();
    });
  }

  /* ---------- 标签页 ---------- */

  function activateTab(group, key) {
    var tabs = group.querySelectorAll('[data-tab]');
    var panels = group.querySelectorAll('[data-tabpanel]');
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-tab') === key;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      p.hidden = p.getAttribute('data-tabpanel') !== key;
    });
  }

  function bindTabs() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (!tab) return;
      var group = tab.closest('[data-tabs]');
      if (!group) return;
      activateTab(group, tab.getAttribute('data-tab'));
    });
  }

  /* ---------- 权限矩阵 / 计数 ---------- */

  function updateSelectedCount(scope) {
    var count = scope.querySelectorAll('.check.is-on[data-count]').length;
    document.querySelectorAll('[data-selected-count]').forEach(function (n) { n.textContent = count; });
  }

  function bindChecks() {
    document.addEventListener('click', function (e) {
      var check = e.target.closest('.check:not(.is-na)');
      if (!check) return;
      check.classList.toggle('is-on');
      check.setAttribute('aria-pressed', check.classList.contains('is-on') ? 'true' : 'false');
      var modal = check.closest('[data-dialog]') || check.closest('[data-check-scope]');
      if (modal) updateSelectedCount(modal);
    });
  }

  /* ---------- 数据范围选择 ---------- */

  function bindScopeSelects() {
    document.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-scope-select]');
      if (!sel) return;
      var row = sel.closest('tr');
      if (!row) return;
      var targets = row.querySelector('[data-targets]');
      if (targets) targets.hidden = sel.value !== 'CUSTOM';
    });
  }

  /* ---------- 共享 / ACL ---------- */

  var ACL_SUBJECTS = [
    '陈晓（用户）', '张三（用户）', '李四（用户）', '王敏（用户）', '赵宁（用户）', '孙悦（用户）',
    '管理员（角色）', '开发者（角色）', '运营（角色）', '只读（角色）'
  ];

  function subjectKind(label) {
    if (label.indexOf('（角色）') !== -1) return { type: '角色', kind: 'role' };
    if (label.indexOf('（用户）') !== -1) return { type: '用户', kind: 'user' };
    return null;
  }
  function subjectName(label) {
    return label.replace(/（(用户|角色)）$/, '');
  }

  function appendAclRow(list, label, level) {
    var meta = subjectKind(label);
    if (!meta) return false;
    var name = subjectName(label);
    var rows = list.querySelectorAll('.acl-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-subject') === name && rows[i].getAttribute('data-kind') === meta.kind) {
        var sel = rows[i].querySelector('[data-acl-level]');
        if (sel) sel.value = level;
        return 'updated';
      }
    }
    var row = document.createElement('div');
    row.className = 'acl-row';
    row.setAttribute('data-subject', name);
    row.setAttribute('data-kind', meta.kind);
    row.innerHTML =
      '<div class="acl-subject">' +
        '<span class="seal seal--sm" aria-hidden="true">' + name.slice(0, 1) + '</span>' +
        '<span><span class="who">' + name + '</span> <span class="kind">' + meta.type + '</span></span>' +
      '</div>' +
      '<select class="select level-select" data-acl-level aria-label="' + name + ' 的访问级别">' +
        '<option value="view"' + (level === 'view' ? ' selected' : '') + '>只读</option>' +
        '<option value="manage"' + (level === 'manage' ? ' selected' : '') + '>可管理</option>' +
      '</select>' +
      '<button class="btn btn--sm btn--danger" type="button" data-acl-remove>移除</button>';
    var empty = list.querySelector('.acl-empty');
    if (empty) empty.remove();
    list.appendChild(row);
    return 'added';
  }

  function bindAcl() {
    document.addEventListener('click', function (e) {
      var add = e.target.closest('[data-acl-add-button]');
      if (add) {
        var form = add.closest('[data-acl-add]');
        var input = form.querySelector('[data-acl-input]');
        var level = form.querySelector('[data-acl-level-select]');
        var label = (input.value || '').trim();
        if (!label) { toast('请先选择要共享的用户或角色', 'warn'); input.focus(); return; }
        var list = document.querySelector('[data-acl-list]');
        if (!list) return;
        if (subjectName(label) === me.name && subjectKind(label).kind === 'user') {
          toast('不能把资源共享给自己', 'error');
          return;
        }
        var result = appendAclRow(list, label, level ? level.value : 'view');
        if (!result) { toast('未识别的共享对象，请从列表中选择用户或角色', 'error'); return; }
        toast(result === 'updated' ? '该主体已在共享列表中，访问级别已更新' : '已添加共享，立即生效', 'ok');
        input.value = '';
        return;
      }

      var remove = e.target.closest('[data-acl-remove]');
      if (remove) {
        var row = remove.closest('.acl-row');
        var name = row ? row.getAttribute('data-subject') : '该主体';
        if (row) row.remove();
        var list2 = document.querySelector('[data-acl-list]');
        if (list2 && !list2.querySelector('.acl-row') && !list2.querySelector('.acl-empty')) {
          var empty = document.createElement('div');
          empty.className = 'acl-empty';
          empty.textContent = '尚未共享给任何人。所有者默认拥有管理权限。';
          list2.appendChild(empty);
        }
        toast('已移除「' + name + '」的共享，下一次请求即失效');
      }
    });

    document.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-acl-level]');
      if (!sel) return;
      var row = sel.closest('.acl-row');
      var name = row ? row.getAttribute('data-subject') : '';
      toast('「' + name + '」的访问级别已改为' + (sel.value === 'manage' ? '可管理' : '只读') + '，立即生效', 'ok');
    });
  }

  /* ---------- 用户管理 ---------- */

  function bindUserAdmin() {
    document.addEventListener('click', function (e) {
      var del = e.target.closest('[data-delete-user]');
      if (del) {
        var name = del.getAttribute('data-name') || '该用户';
        var resources = parseInt(del.getAttribute('data-resources') || '0', 10);
        if (resources > 0) {
          toast('删除被拒绝：' + name + ' 仍拥有 ' + resources + ' 个业务资源，请先转移归属', 'error');
          return;
        }
        var dialog = document.querySelector('[data-dialog="delete-user"]');
        if (dialog) {
          var slot = dialog.querySelector('[data-delete-user-name]');
          if (slot) slot.textContent = name;
          openLayer(dialog);
        }
        return;
      }

      var confirmDelete = e.target.closest('[data-confirm-delete-user]');
      if (confirmDelete) {
        var dlg = confirmDelete.closest('.overlay');
        var target = dlg ? dlg.querySelector('[data-delete-user-name]') : null;
        closeLayer(dlg);
        toast('已删除用户「' + (target ? target.textContent : '') + '」，其 ACL 条目已清理', 'ok');
        return;
      }

      var saveRoles = e.target.closest('[data-save-roles]');
      if (saveRoles) {
        var modal = saveRoles.closest('.overlay');
        var checked = modal ? Array.prototype.map.call(modal.querySelectorAll('input[type="checkbox"]:checked'), function (c) { return c.value; }) : [];
        closeLayer(modal);
        toast('角色已更新为：' + (checked.length ? checked.join('、') : '未分配角色') + '，该用户下一次请求即生效', 'ok');
      }
    });
  }

  /* ---------- 登录页 ---------- */

  function bindLogin() {
    var form = document.querySelector('[data-login-form]');
    if (!form) return;

    document.querySelectorAll('[data-login-as]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-login-as');
        try { localStorage.setItem('cg.rbac.identity', key); } catch (err) {}
        location.href = 'dashboard.html';
      });
    });

    var captcha = document.querySelector('[data-captcha]');
    function refreshCaptcha() {
      if (!captcha) return;
      var chars = 'ABCDEFGHKLMNPQRSTUVWXY23456789';
      var out = '';
      for (var i = 0; i < 4; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
      captcha.textContent = out;
    }
    if (captcha) {
      refreshCaptcha();
      captcha.addEventListener('click', refreshCaptcha);
      captcha.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refreshCaptcha(); }
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      toast('登录成功，正在加载权限上下文', 'ok');
      setTimeout(function () { location.href = 'dashboard.html'; }, 500);
    });
  }

  /* ---------- 通用动作反馈 ---------- */

  function bindActions() {
    document.addEventListener('click', function (e) {
      var rolesBtn = e.target.closest('[data-open="user-roles"]');
      if (rolesBtn) {
        var row = rolesBtn.closest('tr');
        var name = row ? (row.querySelector('.name') || {}).textContent : '';
        document.querySelectorAll('[data-role-user]').forEach(function (n) { n.textContent = name || '该用户'; });
      }
      var roleConfigBtn = e.target.closest('[data-open="role-config"]');
      if (roleConfigBtn) {
        var roleDialog = document.querySelector('[data-dialog="role-config"]');
        applyRolePreset(roleConfigBtn.getAttribute('data-role') || 'developer', roleDialog);
      }
      var action = e.target.closest('[data-toast-message]');
      if (action) {
        toast(action.getAttribute('data-toast-message'), action.getAttribute('data-toast-kind') || 'ok');
        return;
      }
      var transfer = e.target.closest('[data-transfer-confirm]');
      if (transfer) {
        var dialog = transfer.closest('[data-dialog]');
        var sel = dialog ? dialog.querySelector('[data-transfer-target]') : null;
        closeLayer(dialog);
        toast('归属已转移给 ' + (sel ? sel.value : '新所有者') + '，原有共享继续有效', 'ok');
      }
    });
  }

  /* ---------- 搜索与筛选 ---------- */

  function bindFilters() {
    var input = document.querySelector('[data-filter-table]');
    var select = document.querySelector('[data-filter-module]');
    var status = document.querySelector('[data-filter-status]');
    var owner = document.querySelector('[data-filter-owner]');
    if (!input && !select && !status && !owner) return;

    function apply() {
      var q = (input ? input.value : '').trim().toLowerCase();
      var mod = select ? select.value : '';
      var st = status ? status.value : '';
      var ow = owner ? owner.value : '';
      document.querySelectorAll('table[data-count-table] tbody tr').forEach(function (tr) {
        var text = tr.textContent.toLowerCase();
        var inQ = !q || text.indexOf(q) !== -1;
        var inM = !mod || tr.getAttribute('data-module') === mod;
        var inS = !st || tr.getAttribute('data-status') === st;
        var inO = true;
        if (ow === 'mine') inO = tr.getAttribute('data-owner') === me.uid;
        else if (ow === 'shared') {
          inO = listAttr(tr, 'data-acl-view').indexOf(me.uid) !== -1 ||
            listAttr(tr, 'data-acl-manage').indexOf(me.uid) !== -1 ||
            listAttr(tr, 'data-acl-role-view').indexOf(me.roleKey) !== -1;
        }
        tr.classList.toggle('is-filtered', !(inQ && inM && inS && inO));
      });
    }
    if (input) input.addEventListener('input', apply);
    if (select) select.addEventListener('change', apply);
    if (status) status.addEventListener('change', apply);
    if (owner) owner.addEventListener('change', apply);
  }

  /* ---------- Toast ---------- */

  function toast(message, kind) {
    var stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' is-' + kind : '');
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transition = 'opacity .2s';
      setTimeout(function () { node.remove(); }, 220);
    }, 3200);
  }

  /* ---------- 评审工具 ---------- */

  var REVIEW_OPEN = 'cg.rbac.reviewOpen';

  function reviewUrl(key, extra) {
    var url = new URL(location.href);
    if (key) url.searchParams.set('as', key);
    if (ghostMode) url.searchParams.set('ghost', '1'); else url.searchParams.delete('ghost');
    if (extra) extra(url.searchParams);
    return url.pathname.split('/').pop() + url.search;
  }

  function renderReviewTool() {
    if (document.body.hasAttribute('data-noreview')) return;
    if (params.get('tool') === '0') return;

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'review-toggle';
    toggle.innerHTML = '<span class="dot" aria-hidden="true"></span>原型评审 · ' + me.role;

    var panel = document.createElement('div');
    panel.className = 'review-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="rp-head"><span>原型身份模拟</span><button type="button" class="x" data-rp-close aria-label="关闭">✕</button></div>' +
      '<div class="rp-body">' +
        '<div class="rp-label">当前身份（切换后整页重新渲染）</div>' +
        Object.keys(IDENTITIES).map(function (key) {
          var id = IDENTITIES[key];
          return '<label class="rp-option">' +
            '<input type="radio" name="rp-identity" value="' + key + '"' + (key === identityKey ? ' checked' : '') + '>' +
            '<span><span class="n">' + id.name + ' · ' + id.role + (key === 'developerSelf' ? '（仅本人）' : '') + '</span>' +
            '<span class="d">' + id.note + '</span></span>' +
          '</label>';
        }).join('') +
        '<hr class="rp-divider">' +
        '<label class="rp-option"><input type="checkbox" data-rp-ghost' + (ghostMode ? ' checked' : '') + '>' +
          '<span><span class="n">标记无权限控件</span><span class="d">以虚线标出本应隐藏的按钮，并附所需权限码</span></span></label>' +
        '<hr class="rp-divider">' +
        '<div class="rp-row"><span>权限码</span><b>' + (me.superuser ? '全量 47 项' : me.perms.length + ' 项') + '</b></div>' +
        '<div class="rp-row"><span>agent 范围</span><span class="rp-code">' + scopeOf('agent', 'view') + ' / ' + scopeOf('agent', 'manage') + '</span></div>' +
        '<div class="rp-row"><span>knowledge 范围</span><span class="rp-code">' + scopeOf('knowledge', 'view') + ' / ' + scopeOf('knowledge', 'manage') + '</span></div>' +
        '<p class="rp-note">这是原型工具，用于验证 FR-08、FR-09 与数据范围过滤，不会写入任何真实权限。</p>' +
      '</div>';

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      try { sessionStorage.setItem(REVIEW_OPEN, open ? '1' : '0'); } catch (e) {}
    }
    toggle.addEventListener('click', function () { setOpen(panel.hidden); });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-rp-close]')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) setOpen(false);
    });

    panel.addEventListener('change', function (e) {
      var radio = e.target.closest('input[name="rp-identity"]');
      if (radio) {
        try { localStorage.setItem('cg.rbac.identity', radio.value); } catch (err) {}
        location.href = reviewUrl(radio.value);
        return;
      }
      if (e.target.closest('[data-rp-ghost]')) {
        ghostMode = e.target.checked;
        applyPermissions();
        syncGhostBanner();
        toast(ghostMode ? '已标记无权限控件，虚线框为运行时应隐藏的元素' : '已取消标记');
      }
    });

    try {
      if (sessionStorage.getItem(REVIEW_OPEN) === '1') setOpen(true);
    } catch (e) {}
    if (params.get('review') === '1') setOpen(true);
  }

  /* ---------- 权限覆盖图（封面 / 登录） ---------- */

  function drawPermGrids() {
    var cover = document.querySelector('[data-perm-grid]');
    if (cover) {
      var core = [0, 1, 2, 4];
      var on = [0, 1, 2, 4, 5, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23];
      var html = '';
      for (var i = 0; i < 47; i++) {
        var cls = 'pg-cell';
        if (core.indexOf(i) !== -1) cls += ' core';
        else if (on.indexOf(i) !== -1) cls += ' on';
        html += '<span class="' + cls + '" title="权限 ' + (i + 1) + '"></span>';
      }
      cover.innerHTML = html;
    }

    var login = document.querySelector('[data-login-grid]');
    if (login) {
      var lhtml = '';
      for (var j = 0; j < 47; j++) {
        var lcls = 'lm-cell';
        if (j < 5) lcls += ' core';
        else if (j < 24) lcls += ' on';
        lhtml += '<span class="' + lcls + '"></span>';
      }
      login.innerHTML = lhtml;
    }
  }

  /* ---------- 预留模块页 ---------- */

  function renderReserved() {
    var key = document.body.getAttribute('data-module-page');
    if (!key || !RESERVED[key]) return;
    var conf = RESERVED[key];
    document.body.setAttribute('data-page', key);
    document.body.setAttribute('data-page-perm', conf.perm);
    document.body.setAttribute('data-crumb', '系统管理|' + conf.name);

    var setText = function (sel, text) {
      document.querySelectorAll(sel).forEach(function (n) { n.textContent = text; });
    };
    setText('[data-reserved-name]', conf.name);
    setText('[data-reserved-code]', conf.perm);
    setText('[data-reserved-route]', conf.route);
    document.querySelectorAll('[data-reserved-link]').forEach(function (n) {
      n.setAttribute('href', 'reserved.html?module=' + key);
    });
    var title = document.querySelector('[data-reserved-title]');
    if (title) title.textContent = conf.name + ' · 辰光 Agent';
  }

  /* ---------- 403 ---------- */

  function renderForbidden() {
    if (!document.body.hasAttribute('data-forbidden')) return;
    var need = params.get('need');
    var box = document.querySelector('[data-need-perms]');
    if (box && need) {
      box.innerHTML = need.split(',').map(function (c) {
        return '<code class="code">' + c.trim() + '</code>';
      }).join('');
    }
    document.querySelectorAll('[data-me-name]').forEach(function (n) { n.textContent = me.name; });
    document.querySelectorAll('[data-me-role]').forEach(function (n) { n.textContent = me.role; });
    var from = params.get('from');
    var fromBox = document.querySelector('[data-from-page]');
    if (fromBox && from) fromBox.textContent = from;
  }

  /* ---------- 启动 ---------- */

  function init() {
    renderReserved();
    if (!guardPage()) return;

    renderSidebar();
    renderTopbar();
    renderContext();
    drawPermGrids();
    renderForbidden();
    fillIdentityFacts();
    renderProfilePerms();

    bindLayers();
    bindTabs();
    bindChecks();
    bindScopeSelects();
    bindAcl();
    bindUserAdmin();
    bindActions();
    bindLogin();
    bindFilters();

    applyPermissions();
    syncGhostBanner();
    renderReviewTool();

    var openId = params.get('open');
    if (openId) {
      var dialog = document.querySelector('[data-dialog="' + openId + '"]');
      if (dialog) openLayer(dialog);
      var drawer = document.querySelector('[data-drawer="' + openId + '"]');
      if (drawer) openLayer(drawer);
      if (openId === 'role-config') {
        applyRolePreset(params.get('role') || 'developer', dialog);
      }
    }
    var tabKey = params.get('tab');
    if (tabKey) {
      document.querySelectorAll('[data-tabs]').forEach(function (group) {
        if (group.querySelector('[data-tab="' + tabKey + '"]')) activateTab(group, tabKey);
      });
    }
    document.querySelectorAll('[data-select-default]').forEach(function (sel) {
      var row = sel.closest('tr');
      var targets = row ? row.querySelector('[data-targets]') : null;
      if (targets) targets.hidden = sel.value !== 'CUSTOM';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
