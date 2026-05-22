(function () {
  const FILE = "assets/js/module-version-badges-v21-2.js";

  const ModuleVersions = {
    // Главные функции
    shield: "V13",
    pool: "V21.11",
    rough: "V21.11",
    materials: "V20",
    works: "V20",
    estimate: "V12",
    supplier: "V11",
    details: "V11",
    detail: "V11",

    // Бургер-меню
    customer: "V10",
    ai: "V16",
    database: "V20",
    db: "V20",
    scheme: "V11",
    visualization: "V11",
    documents: "V10",
    accounting: "V10",
    warehouse: "V10",
    drafts: "V10",
    visual: "V10",
    subscription: "V20",
    settings: "V20",
    admin: "V20"
  };

  const Labels = [
    { key: "shield", words: ["конфигуратор щита", "щит"] },
    { key: "pool", words: ["пул розеток", "розеток/штроб", "штроб"] },
    { key: "materials", words: ["материалы"] },
    { key: "works", words: ["работа", "работы"] },
    { key: "estimate", words: ["смета"] },
    { key: "details", words: ["детализация материалов", "детализация"] },

    { key: "customer", words: ["о заказчике"] },
    { key: "ai", words: ["ии функции", "ии-функции"] },
    { key: "database", words: ["база данных"] },
    { key: "scheme", words: ["однолинейка", "однолинейная"] },
    { key: "visualization", words: ["визуализация"] },
    { key: "documents", words: ["документы"] },
    { key: "accounting", words: ["бухгалтерия"] },
    { key: "warehouse", words: ["склад"] },
    { key: "drafts", words: ["черновики"] },
    { key: "visual", words: ["настройка визуала"] },
    { key: "subscription", words: ["подписка"] },
    { key: "settings", words: ["настройки"] },
    { key: "admin", words: ["админ-панель"] }
  ];

  function norm(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  }

  function versionForText(text) {
    const t = norm(text);

    for (const item of Labels) {
      if (item.words.some(word => t.includes(norm(word)))) {
        return {
          key: item.key,
          version: ModuleVersions[item.key] || "V?"
        };
      }
    }

    return null;
  }

  function versionForRoute(el) {
    const route = norm(
      el.dataset?.route ||
      el.dataset?.module ||
      el.dataset?.page ||
      el.dataset?.section ||
      el.getAttribute("href") ||
      ""
    );

    if (!route) return null;

    for (const [key, version] of Object.entries(ModuleVersions)) {
      if (route.includes(key)) return { key, version };
    }

    return null;
  }

  function isMainCard(el) {
    const text = norm(el.textContent);
    const likelyCard =
      el.classList.contains("card") ||
      el.classList.contains("module-card") ||
      el.classList.contains("home-card") ||
      el.classList.contains("feature-card") ||
      el.matches?.("[data-route], [data-module], button");

    if (!likelyCard) return false;

    return [
      "конфигуратор щита",
      "пул розеток",
      "материалы",
      "работа",
      "смета",
      "детализация материалов"
    ].some(w => text.includes(w));
  }

  function isMenuRow(el) {
    const text = norm(el.textContent);
    const likelyRow =
      el.matches?.("button, a, .menu-item, .drawer-item, .nav-item, [data-route], [data-section], [data-page]") ||
      el.className?.toString?.().toLowerCase?.().includes("menu");

    if (!likelyRow) return false;

    return [
      "о заказчике",
      "ии функции",
      "база данных",
      "однолинейка",
      "документы",
      "бухгалтерия",
      "склад",
      "черновики",
      "настройка визуала",
      "подписка",
      "настройки",
      "админ-панель"
    ].some(w => text.includes(w));
  }

  function ensureBadge(el, info, mode) {
    if (!el || !info?.version) return;

    const existing = el.querySelector?.(":scope > .ep-module-version-badge");
    if (existing) {
      existing.textContent = info.version;
      existing.dataset.moduleKey = info.key;
      return;
    }

    el.classList.add(mode === "menu" ? "ep-module-version-host-menu" : "ep-module-version-host-card");

    const badge = document.createElement("span");
    badge.className = "ep-module-version-badge " + (mode === "menu" ? "is-menu" : "is-card");
    badge.dataset.moduleKey = info.key;
    badge.textContent = info.version;
    el.appendChild(badge);
  }

  function findCardCandidates() {
    const selectors = [
      ".card",
      ".module-card",
      ".home-card",
      ".feature-card",
      "[data-route]",
      "[data-module]",
      "button"
    ];

    return Array.from(document.querySelectorAll(selectors.join(",")));
  }

  function applyBadges() {
    const candidates = findCardCandidates();

    candidates.forEach(el => {
      if (el.closest("#ep-pool-v21-screen")) return;
      if (el.closest("#adminV16LogModal")) return;

      const direct = versionForRoute(el) || versionForText(el.textContent);

      if (isMainCard(el) && direct) {
        ensureBadge(el, direct, "card");
        return;
      }

      if (isMenuRow(el) && direct) {
        ensureBadge(el, direct, "menu");
      }
    });

    window.Diagnostics?.ok?.({
      file: FILE,
      module: "ModuleVersionBadgesV212",
      functionName: "applyBadges()",
      place: "ui",
      code: "module-version-badges-applied",
      message: "Версии модулей нанесены на карточки и меню."
    });
  }

  function setVersion(key, version) {
    ModuleVersions[key] = version;
    applyBadges();
  }

  function init() {
    applyBadges();
    setTimeout(applyBadges, 700);
    setTimeout(applyBadges, 1800);
    setTimeout(applyBadges, 3500);

    document.addEventListener("click", () => {
      setTimeout(applyBadges, 450);
      setTimeout(applyBadges, 1200);
    }, true);

    window.addEventListener("hashchange", () => setTimeout(applyBadges, 700));
    window.addEventListener("focus", () => setTimeout(applyBadges, 700));

    window.ModuleVersionBadgesV212 = {
      apply: applyBadges,
      setVersion,
      versions: ModuleVersions
    };
  }

  window.addEventListener("DOMContentLoaded", init);
})();
