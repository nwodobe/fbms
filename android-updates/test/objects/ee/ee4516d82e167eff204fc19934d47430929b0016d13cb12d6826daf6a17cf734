/* ANAGROCI — amélioration visuelle non destructive de l’écran d’accès */
(function () {
  "use strict";

  var script = document.currentScript;
  var logoUrl = new URL("../assets/logo-anagroci-access.svg?v=20260806", script.src).href;

  var style = document.createElement("style");
  style.id = "anagroci-auth-ui-v2";
  style.textContent = [
    "#anagroci-authgate{padding:clamp(16px,4vw,36px)!important;background:radial-gradient(900px 520px at 50% -10%,rgba(10,110,63,.88),transparent 62%),linear-gradient(155deg,#032719 0%,#053b23 55%,#06492a 100%)!important;overflow:auto}",
    "#anagroci-authgate>.ag-access-card{width:min(100%,430px)!important;padding:clamp(26px,6vw,42px)!important;border-radius:28px!important;background:linear-gradient(145deg,rgba(255,255,255,.095),rgba(255,255,255,.045))!important;border:1px solid rgba(255,255,255,.22)!important;box-shadow:0 30px 80px rgba(0,25,14,.48),inset 0 1px 0 rgba(255,255,255,.12)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important}",
    "#anagroci-authgate .ag-access-logo{display:block;width:94px;height:94px;object-fit:contain;margin:0 auto 18px;filter:drop-shadow(0 12px 20px rgba(0,34,19,.35))}",
    "#anagroci-authgate input{height:58px!important;border-radius:15px!important;padding:0 17px!important;font-size:16px!important;background:rgba(255,255,255,.09)!important;border:1px solid rgba(222,245,230,.34)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)!important;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease!important}",
    "#anagroci-authgate input:focus{outline:none!important;border-color:#8dcc65!important;background:rgba(255,255,255,.13)!important;box-shadow:0 0 0 4px rgba(141,204,101,.16)!important}",
    "#anagroci-authgate label{font-size:12px!important;letter-spacing:.12em!important;color:#d6f1de!important;margin-top:20px!important}",
    "#anagroci-authgate button.ag-primary{min-height:58px!important;border-radius:15px!important;margin-top:24px!important;font-size:17px!important;background:linear-gradient(135deg,#20a64a 0%,#008f37 55%,#00712c 100%)!important;box-shadow:0 14px 28px rgba(0,113,44,.28)!important;transition:transform .16s ease,filter .16s ease,box-shadow .16s ease!important}",
    "#anagroci-authgate button.ag-primary:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 18px 34px rgba(0,113,44,.34)!important}",
    "#anagroci-authgate button.ag-primary:active{transform:translateY(0)}",
    "@media(max-width:520px){#anagroci-authgate{align-items:center!important}#anagroci-authgate>.ag-access-card{border-radius:24px!important;padding:28px 22px!important}#anagroci-authgate .ag-access-logo{width:82px;height:82px;margin-bottom:14px}#anagroci-authgate input,#anagroci-authgate button.ag-primary{min-height:56px!important}}",
    "@media(prefers-reduced-motion:no-preference){#anagroci-authgate>.ag-access-card{animation:agAccessIn .38s cubic-bezier(.22,1,.36,1)}@keyframes agAccessIn{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}}"
  ].join("");
  (document.head || document.documentElement).appendChild(style);

  function enhance() {
    var gate = document.getElementById("anagroci-authgate");
    if (!gate) return;
    var card = gate.firstElementChild;
    if (!card || card.classList.contains("ag-access-card")) return;
    if (!card.querySelector("form") && !/Accès non autorisé/.test(card.textContent || "")) return;

    card.classList.add("ag-access-card");
    var oldLogo = card.querySelector("svg");
    if (oldLogo) {
      var img = document.createElement("img");
      img.className = "ag-access-logo";
      img.src = logoUrl;
      img.alt = "ANAGROCI";
      img.width = 94;
      img.height = 94;
      oldLogo.replaceWith(img);
    }

    var heading = card.querySelector("div[style*='font-weight:800'][style*='text-align:center']");
    if (heading) {
      heading.style.fontSize = "clamp(20px,5vw,27px)";
      heading.style.lineHeight = "1.18";
      heading.style.letterSpacing = "-.02em";
      heading.style.marginBottom = "7px";
    }

    var form = card.querySelector("form");
    if (form) form.setAttribute("novalidate", "novalidate");
  }

  var observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enhance();
})();
