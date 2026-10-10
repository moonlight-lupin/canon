// Canon's appearance (0.20.1): light, dark, or as this computer is set ("auto", the default), remembered in this
// browser. Loaded in <head>, before the page is drawn, so a dark page never flashes light first (a file of its own:
// the Content-Security-Policy runs no inline script). Printing is always light: light text on white paper can't be read.
(function () {
  var KEY = 'canon.theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var printing = false;
  function choice() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }
  function apply() {
    var c = choice();
    var dark = !printing && (c === 'dark' || (c === 'auto' && !!mq && mq.matches));
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  apply();
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }
  // chosen in another tab
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) apply();
  });
  window.addEventListener('beforeprint', function () {
    printing = true;
    apply();
  });
  window.addEventListener('afterprint', function () {
    printing = false;
    apply();
  });
  window.canonTheme = {
    get: choice,
    set: function (v) {
      try {
        if (v === 'light' || v === 'dark') localStorage.setItem(KEY, v);
        else localStorage.removeItem(KEY);
      } catch (e) {
        /* not remembered (a private window): still applied now */
      }
      apply();
    },
  };
})();
