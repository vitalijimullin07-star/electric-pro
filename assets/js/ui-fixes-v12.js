(function () {
  const FILE = "assets/js/ui-fixes-v12.js";

  function closestCardByTitle(titleText) {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
    const h = headings.find(x => (x.textContent || "").trim().includes(titleText));
    return h ? h.closest(".card, .admin-detail-card, section, div") : null;
  }

  function fixAiNotice() {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
    headings.forEach(h => {
      const txt = (h.textContent || "").trim();
      if (txt.includes("Важно про ИИ")) {
        const card = h.closest(".card, .admin-detail-card, section, div");
        if (card) {
          card.classList.add("subscription-ai-notice", "ai-notice-readable");
        }
      }
    });
  }

  function wrapSubscriptionButtons() {
    const grants = Array.from(document.querySelectorAll('[data-sub-action="grant"][data-days]'));

    grants.forEach(btn => {
      const parent = btn.parentElement;
      if (parent && !parent.classList.contains("subscription-period-buttons")) {
        const siblings = Array.from(parent.children).filter(x =>
          x.matches && x.matches('[data-sub-action="grant"][data-days]')
        );
        if (siblings.length >= 3) parent.classList.add("subscription-period-buttons");
      }
    });
  }

  function highlightSubscriptionChoice(btn) {
    if (!btn) return;
    const uid = btn.dataset.uid || "global";
    const plan = btn.dataset.plan || "trial";

    document.querySelectorAll(`[data-sub-action="grant"][data-uid="${uid}"][data-plan="${plan}"], [data-sub-action="grant-trial"][data-uid="${uid}"]`)
      .forEach(x => x.classList.remove("is-selected"));

    btn.classList.add("is-selected");
  }

  function getAiBalanceCard() {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"));
    const h = headings.find(x => (x.textContent || "").trim().includes("ИИ-баланс"));
    return h ? h.closest(".admin-detail-card, .card, div") : null;
  }

  function ensureAiModeSwitch() {
    const card = getAiBalanceCard();
    if (!card || card.dataset.aiModeFixed === "true") return;

    const select = card.querySelector("#aiAccessModeSelect, select");
    if (!select) return;

    card.dataset.aiModeFixed = "true";

    const switchBox = document.createElement("div");
    switchBox.className = "ai-mode-switch";
    switchBox.innerHTML = `
      <button type="button" class="ai-mode-option" data-ai-mode="admin_api">Админ API</button>
      <button type="button" class="ai-mode-option" data-ai-mode="own_api">API мастера</button>
      <button type="button" class="ai-mode-option" data-ai-mode="disabled">Выкл</button>
    `;

    select.style.display = "none";
    select.parentElement.insertBefore(switchBox, select);

    const note = document.createElement("div");
    note.className = "ai-own-api-note is-hidden";
    note.textContent = "Выбран API мастера: пополнение ИИ-баланса администратором не требуется. Мастер оплачивает свой API-ключ сам.";
    switchBox.after(note);

    const moneyControls = [];
    const topup = card.querySelector("#aiTopupAmountInput");
    const refund = card.querySelector("#aiRefundAmountInput");

    [topup, refund].forEach(input => {
      const row = input ? input.closest(".admin-input-row, .input-row, div") : null;
      if (row) {
        row.classList.add("ai-balance-money-controls");
        moneyControls.push(row);
      }
    });

    function apply(mode) {
      select.value = mode;

      switchBox.querySelectorAll(".ai-mode-option").forEach(b => {
        b.classList.toggle("is-selected", b.dataset.aiMode === mode);
      });

      const needAdminMoney = mode === "admin_api";
      moneyControls.forEach(row => row.classList.toggle("is-hidden", !needAdminMoney));
      note.classList.toggle("is-hidden", needAdminMoney);

      const saveBtn = card.querySelector('[data-card-action="set-ai-mode"]');
      if (saveBtn) {
        saveBtn.textContent = mode === "admin_api"
          ? "Сохранить: через админский API"
          : mode === "own_api"
            ? "Сохранить: API мастера"
            : "Сохранить: ИИ выключен";
      }
    }

    switchBox.addEventListener("click", event => {
      const btn = event.target.closest("[data-ai-mode]");
      if (!btn) return;
      apply(btn.dataset.aiMode);
      window.SoundAPI?.click?.();
    });

    apply(select.value || "disabled");
  }

  function runFixes() {
    fixAiNotice();
    wrapSubscriptionButtons();
    ensureAiModeSwitch();
  }

  document.addEventListener("click", event => {
    const subBtn = event.target.closest('[data-sub-action="grant"], [data-sub-action="grant-trial"]');
    if (subBtn) highlightSubscriptionChoice(subBtn);
  }, true);

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(runFixes);
  });

  window.addEventListener("DOMContentLoaded", () => {
    runFixes();
    observer.observe(document.body, { childList: true, subtree: true });
  });

  window.EP_UI_FIXES_V12 = runFixes;

  window.Diagnostics?.info?.({
    file: FILE,
    module: "UiFixesV12",
    functionName: "init()",
    place: "ui",
    code: "ui-fixes-loaded",
    message: "UI fixes loaded: subscription row, AI notice, AI mode switch"
  });
})();
