/* ==========================================================================
 * 65-publish.js — the web-editor-specific UI on top of a RelayBridge:
 *   - an "Apply Format" (publish) button in the top bar
 *   - the Publish modal itself: the list of changes, the generated
 *     `/nametags format ...` commands, and a Copy All button
 *
 * Deliberately kept in its own file, wrapping (rather than editing) 60-view.js's
 * V.renderTop/V.renderAll, so a MockBridge session behaves exactly as before
 * and this whole feature is additive.
 * ========================================================================== */
(function (NT) {
  'use strict';
  const A = NT.app;
  const S = A.S;
  const V = A.view;
  const I = NT.icon;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function isRelay() {
    return !!(S.bridge && S.bridge.isRelay);
  }
  function isMock() {
    return !!(S.bridge && S.bridge.isMock);
  }

  /* -------------------------------------------------------- top bar hook */

  const originalRenderTop = V.renderTop;
  V.renderTop = function () {
    originalRenderTop();
    if (!isRelay() && !isMock()) return;
    const actions = document.querySelector('#topbar .actions');
    if (!actions) return;
    const publishBtn = document.createElement('button');
    publishBtn.type = 'button';
    publishBtn.className = 'btn primary';
    publishBtn.setAttribute('data-act', 'publish');
    if (isRelay() && !S.bridge.getPendingChanges().length) publishBtn.disabled = true;
    publishBtn.innerHTML = I('save', 'sm') + '<span class="lbl-txt">Apply Format</span>';
    actions.insertBefore(publishBtn, actions.firstChild);
  };

  /* -------------------------------------------------------------- modal */

  A.openPublish = async () => {
    // The default (mock) editor already applies every edit straight to its
    // own demo state as you type — there's nothing queued to publish, so
    // the button here just makes sure that's actually landed, right now.
    if (isMock()) {
      await A.flushAutosave();
      A.view.toast('Format applied.', { kind: 'ok' });
      return;
    }
    if (!isRelay()) return;
    const host = document.getElementById('layer-modal');
    if (!host) return;
    const changes = S.bridge.getPendingChanges();
    const commands = S.bridge.generateCommands('nametags');

    const listHtml = changes.length
      ? '<ul class="publish-list">' + changes.map((c, i) => (
          '<li><span class="kind">' + esc(c.kind) + '</span>' +
          '<span class="what">' + esc(c.label) + (c.platform === 'bedrock' ? ' (Bedrock)' : '') + '</span>' +
          '<span class="action">' + esc(actionLabel(c.action)) + '</span></li>'
        )).join('') + '</ul>'
      : '<p class="publish-empty">No changes to publish yet — edit a format first.</p>';

    const commandsHtml = commands.length
      ? '<div class="publish-commands"><textarea id="publish-textarea" readonly rows="' + Math.min(10, commands.length + 1) + '">'
        + esc(commands.join('\n')) + '</textarea></div>' +
        '<p class="publish-note">Paste these into the server console (or run them as an op in-game), in order.</p>'
      : '';

    host.innerHTML =
      '<div class="scrim" data-act="publish-close"></div>' +
      '<div class="modal publish" role="dialog" aria-modal="true" aria-labelledby="publish-title">' +
      '<h2 id="publish-title">Publish changes</h2>' +
      listHtml + commandsHtml +
      '<div class="btns">' +
      (commands.length ? '<button type="button" class="btn" data-act="publish-copy">Copy all</button>' : '') +
      '<button type="button" class="btn primary" data-act="publish-close">Done</button>' +
      '</div></div>';
  };

  V.closePublish = () => {
    const host = document.getElementById('layer-modal');
    if (host) host.innerHTML = '';
  };

  A.copyPublishCommands = async (btn) => {
    const textarea = document.getElementById('publish-textarea');
    if (!textarea) return;
    const text = textarea.value;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) { /* fall through to the legacy path below */ }
    if (!copied) {
      try {
        textarea.removeAttribute('readonly');
        textarea.focus();
        textarea.select();
        copied = document.execCommand('copy');
        textarea.setAttribute('readonly', 'readonly');
      } catch (e) { copied = false; }
    }
    V.toast(copied ? 'Commands copied.' : 'Could not copy automatically — select the text and copy it manually.',
      { kind: copied ? 'ok' : 'warn' });
  };

  function actionLabel(action) {
    switch (action) {
      case 'set': return 'set';
      case 'add': return 'new';
      case 'edit': return 'changed';
      case 'remove': return 'removed';
      case 'disable': return 'cleared';
      default: return action;
    }
  }
})((globalThis.NT = globalThis.NT || {}));
