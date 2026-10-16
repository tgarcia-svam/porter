// Trusted Types `default` policy. Loaded synchronously first in <head> (see src/app/layout.tsx).
// Kept as a static file (not an inline innerHTML script) so React re-creating the element on the
// client never has to push this code through a TrustedHTML sink.
(function () {
  var tt = window.trustedTypes;
  if (!tt || !tt.createPolicy) return;
  try {
    tt.createPolicy("default", {
      createScriptURL: function (u) {
        try {
          var x = new URL(u, location.href);
          if (x.origin === location.origin && (x.pathname.indexOf("/_next/") === 0 || x.pathname === "/tt-policy.js")) return x.href;
        } catch (e) {}
        throw new TypeError("Blocked untrusted script URL");
      },
      createScript: function () {
        throw new TypeError("Blocked inline script string");
      },
      createHTML: function (h) {
        // React's literal for creating <script> elements.
        if (h === "<script></script>") return h;
        // No "<" => cannot create elements/scripts/handlers (e.g. CSS for Next's error page).
        if (String(h).indexOf("<") === -1) return h;
        throw new TypeError("Blocked HTML string");
      },
    });
  } catch (e) {}
})();
