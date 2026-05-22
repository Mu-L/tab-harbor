'use strict';

const {
  escapeHtmlAttribute: drawerEscapeHtmlAttribute,
  escapeHtml: drawerEscapeHtml,
} = globalThis.TabOutIconUtils || {};

const {
  t: drawerT,
} = globalThis.TabHarborI18n || {};

const {
  clampTriggerTop: drawerClampTriggerTop,
  normalizeTriggerPosition: drawerNormalizeTriggerPosition,
} = globalThis.TabOutDeferredTriggerPosition || {};

const {
  clearArchivedTodos: drawerClearArchivedTodos,
  completeTodo: drawerCompleteTodo,
  createTodo: drawerCreateTodo,
  deleteTodo: drawerDeleteTodo,
  normalizeTodos: drawerNormalizeTodos,
  searchTodos: drawerSearchTodos,
  splitTodos: drawerSplitTodos,
  updateTodo: drawerUpdateTodo,
} = globalThis.TabOutTodosStore || {};

let deferredPanelOpen = false;
let deferredTriggerPosition = drawerNormalizeTriggerPosition ? drawerNormalizeTriggerPosition() : { top: null };
const DEFERRED_TRIGGER_POSITION_KEY = 'deferredTriggerPosition';
let deferredTriggerDragState = null;
let deferredTriggerSuppressClickUntil = 0;
let drawerView = 'todos';
let todoDetailId = '';
let todoSearchOpen = false;
let todoSearchQuery = '';
let drawerFocusReturnEl = null;
const TODOS_KEY = 'todos';

function createTodoEditorState(input = {}) {
  return {
    open: Boolean(input.open),
    mode: input.mode === 'edit' ? 'edit' : 'create',
    todoId: input.todoId || '',
    title: input.title || '',
    description: input.description || '',
    error: input.error || '',
  };
}

let todoEditorState = createTodoEditorState();

function drawerTodoText(key, fallback) {
  return drawerT ? drawerT(key) : fallback;
}

function drawerEscapeAttr(value = '') {
  if (drawerEscapeHtmlAttribute) return drawerEscapeHtmlAttribute(value);
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function openTodoEditor({ mode = 'create', todo = null } = {}) {
  todoEditorState = createTodoEditorState({
    open: true,
    mode,
    todoId: mode === 'edit' ? String(todo?.id || '') : '',
    title: mode === 'edit' ? String(todo?.title || '') : '',
    description: mode === 'edit' ? String(todo?.description || '') : '',
  });
}

function closeTodoEditor() {
  todoEditorState = createTodoEditorState();
}

function getTodoEditorState() {
  return { ...todoEditorState };
}

function setTodoEditorField(field, value) {
  if (field !== 'title' && field !== 'description') return;
  todoEditorState = {
    ...todoEditorState,
    [field]: String(value || ''),
    error: '',
  };
}

function setTodoEditorError(error) {
  todoEditorState = {
    ...todoEditorState,
    error: String(error || ''),
  };
}

function focusTodoEditorTitle() {
  const titleInput = document.querySelector('#todoEditorView [name="title"]');
  if (titleInput?.focus) titleInput.focus({ preventScroll: true });
}

async function loadDeferredTriggerPosition() {
  const stored = await chrome.storage.local.get(DEFERRED_TRIGGER_POSITION_KEY);
  deferredTriggerPosition = drawerNormalizeTriggerPosition(stored[DEFERRED_TRIGGER_POSITION_KEY]);
  return deferredTriggerPosition;
}

async function saveDeferredTriggerPosition(nextState) {
  deferredTriggerPosition = drawerNormalizeTriggerPosition(nextState);
  await chrome.storage.local.set({ [DEFERRED_TRIGGER_POSITION_KEY]: deferredTriggerPosition });
  return deferredTriggerPosition;
}

function isMobileDeferredLayout() {
  return window.matchMedia('(max-width: 960px)').matches;
}

function applyDeferredTriggerPosition() {
  const triggerStack = document.getElementById('drawerTriggerStack');
  if (!triggerStack) return;

  if (isMobileDeferredLayout()) {
    triggerStack.style.removeProperty('top');
    return;
  }

  const triggerHeight = triggerStack.offsetHeight || 94;
  const normalizedTop = drawerClampTriggerTop(
    deferredTriggerPosition.top ?? window.innerHeight / 2 - triggerHeight / 2,
    window.innerHeight,
    triggerHeight,
    24
  );
  triggerStack.style.top = `${normalizedTop}px`;
}

async function getTodos() {
  const stored = await chrome.storage.local.get(TODOS_KEY);
  return drawerNormalizeTodos(stored[TODOS_KEY]);
}

async function saveTodos(todos) {
  const normalized = drawerNormalizeTodos(todos);
  await chrome.storage.local.set({ [TODOS_KEY]: normalized });
  return normalized;
}

async function createTodoItem(payload) {
  const todos = await getTodos();
  return saveTodos(drawerCreateTodo(todos, payload));
}

async function completeTodoItem(id) {
  const todos = await getTodos();
  return saveTodos(drawerCompleteTodo(todos, id));
}

async function deleteTodoItem(id) {
  const todos = await getTodos();
  return saveTodos(drawerDeleteTodo(todos, id));
}

async function updateTodoItem(id, payload) {
  const todos = await getTodos();
  return saveTodos(drawerUpdateTodo(todos, id, payload));
}

async function clearTodoArchiveItems() {
  const todos = await getTodos();
  return saveTodos(drawerClearArchivedTodos(todos));
}

function renderTodoArchiveItem(todo) {
  const ago = todo.completedAt ? timeAgo(todo.completedAt) : timeAgo(todo.createdAt);
  return `
    <div class="archive-item">
      <div class="archive-item-main">
        <div class="archive-item-title">${drawerEscapeHtml ? drawerEscapeHtml(todo.title) : todo.title}</div>
        <span class="archive-item-date">${ago}</span>
      </div>
      <button class="archive-item-delete" type="button" data-action="delete-todo-archive" data-todo-id="${todo.id}" aria-label="Delete archived todo" title="Delete archived todo">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

function renderTodoListItem(todo, { dragEnabled = true } = {}) {
  const ago = timeAgo(todo.createdAt);
  const dragHandle = dragEnabled
    ? `<button class="drawer-reorder-handle todo-reorder-handle" type="button" data-drag-handle="todo" aria-label="Drag to reorder todo">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" /></svg>
      </button>`
    : '';
  return `
    <div class="todo-item" data-todo-id="${todo.id}" data-drawer-sort-id="${todo.id}" data-drawer-sort-kind="todo">
      <input type="checkbox" class="todo-checkbox" data-action="complete-todo" data-todo-id="${todo.id}">
      <button class="todo-main" type="button" data-action="open-todo-detail" data-todo-id="${todo.id}">
        <span class="todo-title">${drawerEscapeHtml ? drawerEscapeHtml(todo.title) : todo.title}</span>
        <span class="todo-meta">${ago}</span>
      </button>
      <div class="todo-actions">
        <button class="todo-action-btn todo-edit" type="button" data-action="edit-todo" data-todo-id="${todo.id}" aria-label="Edit todo" data-tooltip="Edit todo">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.9" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
        </button>
        <button class="todo-action-btn todo-delete" type="button" data-action="delete-todo" data-todo-id="${todo.id}" aria-label="Delete todo" data-tooltip="Delete todo">
          ${ICONS.close}
        </button>
        ${dragHandle}
      </div>
    </div>`;
}

function renderTodoDetail(todo) {
  return `
    <div class="todo-detail">
      <button class="todo-back-btn" type="button" data-action="close-todo-detail">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        Back to list
      </button>
      <div class="todo-detail-card">
        <h3>${drawerEscapeHtml ? drawerEscapeHtml(todo.title) : todo.title}</h3>
        <p>${drawerEscapeHtml ? drawerEscapeHtml(todo.description || 'Add a note when this task needs more context.') : (todo.description || 'Add a note when this task needs more context.')}</p>
        <div class="todo-detail-meta">Created ${timeAgo(todo.createdAt)}</div>
        <div class="todo-detail-actions">
          <button class="todo-action-btn todo-edit" type="button" data-action="edit-todo" data-todo-id="${todo.id}" aria-label="Edit todo" data-tooltip="Edit todo">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.9" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
          </button>
          <button class="todo-action-btn todo-delete" type="button" data-action="delete-todo" data-todo-id="${todo.id}" aria-label="Delete todo" data-tooltip="Delete todo">
            ${ICONS.close}
          </button>
        </div>
      </div>
    </div>`;
}

function renderTodoEditor() {
  const isEdit = todoEditorState.mode === 'edit';
  const editorTitle = isEdit
    ? drawerTodoText('todoEditorEditTitle', 'Edit todo')
    : drawerTodoText('todoEditorCreateTitle', 'New todo');
  const titleLabel = drawerTodoText('todoTitleLabel', 'Title');
  const descriptionLabel = drawerTodoText('todoDescriptionLabel', 'Details');
  const titlePlaceholder = drawerTodoText('todoEditorTitlePlaceholder', 'What needs attention?');
  const descriptionPlaceholder = drawerTodoText('todoEditorDescriptionPlaceholder', 'Add notes, context, or a next step.');
  const titleValue = drawerEscapeAttr(todoEditorState.title);
  const descriptionValue = drawerEscapeHtml ? drawerEscapeHtml(todoEditorState.description) : todoEditorState.description;
  const errorHtml = todoEditorState.error
    ? `<div class="todo-editor-error" id="todoEditorError">${drawerEscapeHtml ? drawerEscapeHtml(todoEditorState.error) : todoEditorState.error}</div>`
    : '<div class="todo-editor-error" id="todoEditorError" aria-live="polite"></div>';

  return `
    <div class="todo-editor-view" id="todoEditorView" role="group" aria-label="${drawerEscapeAttr(editorTitle)}">
      <form class="todo-editor-form" data-action="submit-todo-editor" novalidate>
        <div class="todo-editor-head">
          <h3>${drawerEscapeHtml ? drawerEscapeHtml(editorTitle) : editorTitle}</h3>
        </div>
        <label class="todo-editor-field">
          <span class="todo-editor-label">${drawerEscapeHtml ? drawerEscapeHtml(titleLabel) : titleLabel}</span>
          <input name="title" class="todo-editor-input" type="text" value="${titleValue}" placeholder="${drawerEscapeAttr(titlePlaceholder)}" data-action="update-todo-editor-field" data-field="title" aria-describedby="todoEditorError" autocomplete="off">
        </label>
        <label class="todo-editor-field">
          <span class="todo-editor-label">${drawerEscapeHtml ? drawerEscapeHtml(descriptionLabel) : descriptionLabel}</span>
          <textarea name="description" class="todo-editor-input todo-editor-textarea" placeholder="${drawerEscapeAttr(descriptionPlaceholder)}" data-action="update-todo-editor-field" data-field="description">${descriptionValue}</textarea>
        </label>
        ${errorHtml}
        <div class="todo-editor-actions">
          <button class="theme-menu-action is-secondary" type="button" data-action="cancel-todo-editor">${drawerTodoText('cancelButton', 'Cancel')}</button>
          <button class="theme-menu-action" type="submit" data-action="submit-todo-editor">${drawerTodoText('saveButton', 'Save')}</button>
        </div>
      </form>
    </div>`;
}

async function renderTodoPanel() {
  const panel = document.getElementById('todoPanel');
  const countEl = document.getElementById('todoCount');
  const list = document.getElementById('todoList');
  const empty = document.getElementById('todoEmpty');
  const archive = document.getElementById('todoArchive');
  const archiveCount = document.getElementById('todoArchiveCount');
  const archiveList = document.getElementById('todoArchiveList');
  const clearArchiveBtn = document.getElementById('clearTodoArchiveBtn');
  const detail = document.getElementById('todoDetailView');
  const searchWrap = document.getElementById('todoSearchWrap');
  const searchInput = document.getElementById('todoSearchInput');
  const todoSearchToggle = document.getElementById('todoSearchToggle');
  const todoArchiveToggle = document.getElementById('todoArchiveToggle');
  const todoArchiveBody = document.getElementById('todoArchiveBody');

  if (!panel) return;

  const todos = await getTodos();
  const { active, archived } = drawerSplitTodos(todos);
  const filtered = drawerSearchTodos(active, todoSearchQuery);
  const todoDragEnabled = !todoSearchQuery.trim() && !todoDetailId && !todoEditorState.open;
  let editor = document.getElementById('todoEditorView');

  countEl.textContent = `${active.length}`;
  if (todoSearchToggle) {
    todoSearchToggle.setAttribute('aria-expanded', String(todoSearchOpen));
  }
  searchWrap.style.display = todoSearchOpen ? 'block' : 'none';
  searchWrap.hidden = !todoSearchOpen;
  if (searchInput && searchInput.value !== todoSearchQuery) searchInput.value = todoSearchQuery;
  if (todoArchiveToggle && todoArchiveBody) {
    const archiveExpanded = todoArchiveBody.style.display !== 'none' && !todoArchiveBody.hidden;
    todoArchiveToggle.setAttribute('aria-expanded', String(archiveExpanded));
  }

  if (todoEditorState.open) {
    if (editor) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderTodoEditor().trim();
      editor.replaceWith(wrapper.firstElementChild);
    } else {
      detail.insertAdjacentHTML('beforebegin', renderTodoEditor());
    }
    editor = document.getElementById('todoEditorView');
    if (editor) editor.style.display = 'block';
    detail.style.display = 'none';
    list.style.display = 'none';
    empty.style.display = 'none';
  } else if (editor) {
    editor.style.display = 'none';
    editor.innerHTML = '';
  }

  if (!todoEditorState.open && todoDetailId) {
    const todo = active.find(item => item.id === todoDetailId);
    if (todo) {
      detail.innerHTML = renderTodoDetail(todo);
      detail.style.display = 'block';
      list.style.display = 'none';
      empty.style.display = 'none';
    } else {
      todoDetailId = '';
      detail.style.display = 'none';
    }
  } else {
    detail.style.display = 'none';
  }

  if (!todoEditorState.open && !todoDetailId) {
    if (filtered.length > 0) {
      list.innerHTML = filtered.map(todo => renderTodoListItem(todo, { dragEnabled: todoDragEnabled })).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      empty.style.display = 'block';
    }
  }

  if (todoEditorState.open) {
    archive.style.display = 'none';
    if (clearArchiveBtn) clearArchiveBtn.style.display = 'none';
  } else if (archived.length > 0) {
    archiveCount.textContent = `(${archived.length})`;
    archiveList.innerHTML = archived.map(todo => renderTodoArchiveItem(todo)).join('');
    archive.style.display = 'block';
    if (clearArchiveBtn) clearArchiveBtn.style.display = 'inline-flex';
  } else {
    archive.style.display = 'none';
    if (clearArchiveBtn) clearArchiveBtn.style.display = 'none';
  }
}

async function renderDeferredColumn() {
  const column = document.getElementById('drawerColumn');
  const triggerStack = document.getElementById('drawerTriggerStack');
  const todoTrigger = document.getElementById('todoTrigger');
  const overlay = document.getElementById('deferredOverlay');
  const todoPanel = document.getElementById('todoPanel');
  const titleButtons = document.querySelectorAll('.drawer-title-btn');

  if (!column) return;

  try {
    await getTodos();
    await loadDeferredTriggerPosition();
    column.style.display = 'block';
    if (triggerStack) triggerStack.style.display = 'flex';
    if (todoTrigger) todoTrigger.style.display = 'inline-flex';
    column.classList.toggle('open', deferredPanelOpen);
    column.setAttribute('aria-hidden', String(!deferredPanelOpen));
    if (todoTrigger) {
      todoTrigger.setAttribute('aria-expanded', String(deferredPanelOpen));
      todoTrigger.setAttribute('aria-label', deferredPanelOpen ? 'Close todos' : 'Open todos');
    }
    overlay.hidden = !deferredPanelOpen;
    overlay.classList.toggle('visible', deferredPanelOpen);
    applyDeferredTriggerPosition();
    todoPanel?.classList.add('is-active');
    titleButtons.forEach(button => {
      button.classList.add('is-active');
      button.setAttribute('aria-selected', 'true');
      button.tabIndex = 0;
    });

    await renderTodoPanel();
  } catch (err) {
    console.warn('[tab-harbor] Could not load todos:', err);
    column.style.display = 'none';
    if (triggerStack) triggerStack.style.display = 'none';
    overlay.hidden = true;
    overlay.classList.remove('visible');
  }
}

function setDeferredPanelOpen(nextOpen) {
  const shouldOpen = Boolean(nextOpen);
  if (shouldOpen) {
    drawerFocusReturnEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  deferredPanelOpen = shouldOpen;
  renderDeferredColumn().then(() => {
    if (deferredPanelOpen) {
      const preferredFocusId = todoSearchOpen ? 'todoSearchInput' : 'todoPanel';
      const preferredTarget = document.getElementById(preferredFocusId);
      if (preferredTarget?.focus) {
        preferredTarget.focus({ preventScroll: true });
      } else {
        focusFirstElement(document.getElementById('drawerColumn'));
      }
      return;
    }

    drawerFocusReturnEl?.focus?.({ preventScroll: true });
    drawerFocusReturnEl = null;
  });
}
