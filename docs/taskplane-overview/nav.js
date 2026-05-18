// Taskplane Overview · page-deck navigation
// ----------------------------------------------------------------------------
// Two input modes layered on the existing prev/index/next links inside
// .page-nav, so they stay the single source of navigation truth:
//
//   * Desktop : ArrowLeft / ArrowRight on the keyboard fire the prev/next links.
//   * Touch   : horizontal swipes fire the prev/next links — UNLESS the swipe
//               started inside a horizontally scrollable container (e.g. the
//               page-09 git-graph card or the page-08 wave cards), in which
//               case the inner scroll takes priority.
//
// The script is a no-op on the index page (no .page-nav element).
// ----------------------------------------------------------------------------

(function () {
  'use strict';

  function navLink(label) {
    return document.querySelector('.page-nav a[aria-label="' + label + '"]');
  }

  // --- Keyboard ----------------------------------------------------------
  document.addEventListener('keydown', function (e) {
    // Don't hijack arrows when the user is typing somewhere editable.
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
      return;
    }
    // Ignore when modifier keys are held — those are likely browser shortcuts.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    var link = null;
    if (e.key === 'ArrowLeft')  link = navLink('Previous');
    if (e.key === 'ArrowRight') link = navLink('Next');
    if (link) {
      e.preventDefault();
      link.click();
    }
  });

  // --- Touch (swipe) -----------------------------------------------------
  var startX = null;
  var startY = null;

  // Walk up the DOM looking for a horizontally scrollable ancestor. If one
  // exists, the user is probably trying to pan that inner content, so we
  // surrender the swipe.
  function startedInsideHorizontalScroll(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollWidth > el.clientWidth + 1) return true;
      el = el.parentElement;
    }
    return false;
  }

  document.addEventListener('touchstart', function (e) {
    if (startedInsideHorizontalScroll(e.target)) {
      startX = null;
      return;
    }
    var t = e.changedTouches[0];
    startX = t.screenX;
    startY = t.screenY;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (startX === null) return;
    var t = e.changedTouches[0];
    var dx = t.screenX - startX;
    var dy = t.screenY - startY;
    startX = null;
    startY = null;

    // Threshold: at least 70px horizontal movement, and the gesture must
    // be predominantly horizontal (2x more X than Y). Anything mushier is
    // treated as a tap / vertical scroll and ignored.
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    if (absDx < 70 || absDx < absDy * 2) return;

    var link = dx > 0 ? navLink('Previous') : navLink('Next');
    if (link) link.click();
  }, { passive: true });
})();
