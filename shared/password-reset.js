/* ANAGROCI FBMS - password recovery on the official HTTPS origin.
   Public browser-only flow; never stores passwords, tokens or a service_role key. */
(function () {
  "use strict";

  var PROJECT_URL = "https://jmbdgpdthzpszfnddwzi.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_Gu5j0VV4ymP-I9t3JriQXg_VlTJqV2d";
  var RECOVERY_URL = "https://nwodobe.github.io/fbms/shared/password-reset.html";
  var reqForm = document.getElementById("request-form");
  var updateForm = document.getElementById("update-form");
  var waiting = document.getElementById("waiting");
  var completed = document.getElementById("completed");
  var notice = document.getElementById("notice");
  var email = document.getElementById("recover-email");
  var password = document.getElementById("new-password");
  var confirmation = document.getElementById("confirm-password");
  var requestButton = document.getElementById("request-button");
  var updateButton = document.getElementById("update-button");

  var incomingQuery = new URLSearchParams(location.search);
  var incomingFragment = new URLSearchParams(location.hash.slice(1));
  var isRecoveryReturn = incomingFragment.get("type") === "recovery" ||
    incomingQuery.get("type") === "recovery" || incomingQuery.has("code");
  var hasLinkError = incomingQuery.has("error") || incomingFragment.has("error");
  var recoveryReady = false;
  var client;

  function message(text, error) {
    notice.hidden = !text;
    notice.textContent = text || "";
    notice.className = error ? "notice error" : "notice";
  }
  function show(name) {
    reqForm.hidden = name !== "request";
    updateForm.hidden = name !== "update";
    waiting.hidden = name !== "waiting";
    completed.hidden = name !== "completed";
  }
  function scrubLink() {
    try { history.replaceState(null, document.title, location.pathname); } catch (ignored) {}
  }
  function invalidLink() {
    recoveryReady = false;
    show("request");
    message("Ce lien est invalide ou a expir\u00e9. Demandez un nouveau lien de r\u00e9initialisation.", true);
    scrubLink();
  }
  function acceptRecoverySession(session) {
    if (!isRecoveryReturn || !session || !session.user || recoveryReady) return;
    recoveryReady = true;
    scrubLink();
    show("update");
    message("Lien v\u00e9rifi\u00e9. Choisissez un nouveau mot de passe.", false);
    password.focus();
  }

  reqForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client) return;
    var address = email.value.trim().toLowerCase();
    if (!address || !email.checkValidity()) return;
    requestButton.disabled = true;
    message("Envoi de la demande...", false);
    client.auth.resetPasswordForEmail(address, { redirectTo: RECOVERY_URL })
      .then(function (result) {
        if (result.error && (/fetch|network|timeout/i.test(result.error.message || "") || result.error.status === 429)) {
          message("Service momentan\u00e9ment indisponible. V\u00e9rifiez votre connexion et r\u00e9essayez plus tard.", true);
        } else {
          message("Si un compte correspond \u00e0 cette adresse, vous recevrez les instructions de r\u00e9initialisation. V\u00e9rifiez \u00e9galement les courriers ind\u00e9sirables.", false);
        }
      })
      .catch(function () {
        message("Impossible de contacter le service. Une connexion Internet est n\u00e9cessaire.", true);
      })
      .finally(function () { requestButton.disabled = false; });
  });

  updateForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!client || !recoveryReady) return invalidLink();
    var next = password.value;
    if (next.length < 12) return message("Choisissez un mot de passe d'au moins 12 caract\u00e8res.", true);
    if (next !== confirmation.value) return message("Les deux mots de passe ne correspondent pas.", true);
    updateButton.disabled = true;
    message("Mise \u00e0 jour du mot de passe...", false);
    client.auth.updateUser({ password: next })
      .then(function (result) {
        if (result.error) {
          message("Le mot de passe a \u00e9t\u00e9 refus\u00e9 ou le lien a expir\u00e9. V\u00e9rifiez les exigences de s\u00e9curit\u00e9 ou demandez un nouveau lien.", true);
          return;
        }
        recoveryReady = false;
        password.value = "";
        confirmation.value = "";
        scrubLink();
        show("completed");
        message("Votre mot de passe a \u00e9t\u00e9 modifi\u00e9. Connectez-vous avec votre nouveau mot de passe.", false);
      })
      .catch(function () {
        message("Connexion interrompue. V\u00e9rifiez le r\u00e9seau avant de r\u00e9essayer.", true);
      })
      .finally(function () { updateButton.disabled = false; });
  });

  if (!window.supabase || !window.supabase.createClient) {
    show("request");
    message("Service de connexion indisponible. R\u00e9essayez lorsque vous \u00eates connect\u00e9 \u00e0 Internet.", true);
    requestButton.disabled = true;
    return;
  }

  client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: false,
      autoRefreshToken: false
    }
  });

  if (hasLinkError) {
    invalidLink();
  } else if (isRecoveryReturn) {
    show("waiting");
    message("V\u00e9rification du lien de r\u00e9cup\u00e9ration...", false);
    client.auth.onAuthStateChange(function (event, session) {
      if (event === "PASSWORD_RECOVERY") acceptRecoverySession(session);
    });
    client.auth.getSession().then(function (result) {
      if (!result.error && result.data && result.data.session) {
        acceptRecoverySession(result.data.session);
      }
    }).catch(function () {});
    setTimeout(function () { if (!recoveryReady) invalidLink(); }, 12000);
  } else {
    show("request");
  }
})();