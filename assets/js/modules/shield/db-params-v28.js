/* ============================================================
   Electric Pro — DB Params V28.4
   Авто-распознавание структурных параметров для ВСЕХ позиций БД.
   Использует парсер аппаратов (ShieldDbResolverV28) + распознаёт
   кабель, розетки/выключатели, подрозетники, коробки, клеммники, работы.
   Кнопка-сканер сохраняет specs в каждую позицию активной базы.
   Конфигуратор и пулы потом читают item.specs (если есть).
   ============================================================ */
(() => {
  "use strict";
  if (window.__EP_DB_PARAMS_V28__) return;
  window.__EP_DB_PARAMS_V28__ = true;

  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

  function posts(low) {
    if (/четыр|4-?х|4 ?пост|4 ?клав/.test(low)) return 4;
    if (/трёх|трех|3-?х|3 ?пост|3 ?клав/.test(low)) return 3;
    if (/двух|2-?х|2 ?пост|2 ?клав|двойн/.test(low)) return 2;
    if (/одно|1 ?пост|1 ?клав|одинарн/.test(low)) return 1;
    return null;
  }

  // распознать одну позицию -> specs
  function recognize(item) {
    const name = item && item.name ? item.name : "";
    const type = item && item.type ? item.type : "material";
    if (type === "work") return { kind: "work" };

    const lowEarly = norm(name);
    // кабель/провод ловим РАНЬШЕ устройств (ПуГВ/ПВ-3/ВВГ не должны стать автоматом)
    if (/ввг|пугв|пв-?\d|nym|пвс|шввп|кспв|\bкг\b|кабель|провод/.test(lowEarly) && !/автомат|выключател/.test(lowEarly)) {
      const sec0 = name.match(/(\d{1,2})\s?[хx*]\s?(\d{1,2}(?:[.,]\d)?)/);
      return { kind: "cable", cores: sec0 ? Number(sec0[1]) : null, section: sec0 ? Number(String(sec0[2]).replace(",", ".")) : null, brand: "" };
    }
    const R = window.ShieldDbResolverV28;
    const dev = R ? R.parseDevice(name) : null;
    if (dev && ["avt", "uzo", "dif", "box"].includes(dev.kind)) {
      return {
        kind: dev.kind, brand: dev.brand || "", series: dev.series || "",
        curve: dev.curve || "", amp: dev.amp ?? null,
        rcdType: dev.rcdType || "", leakMA: dev.leakMA ?? null, modules: dev.modules ?? null
      };
    }

    const low = norm(name);
    // кабель / провод
    if (/ввг|пугв|пв-?[13]\b|nym|пвс|\bкг\b|кабель|шввп|sat|ftp|utp|cat ?5|cat ?6|кспв/.test(low)) {
      const sec = name.match(/(\d{1,2})\s?[хx*]\s?(\d{1,2}(?:[.,]\d)?)/);
      return {
        kind: "cable",
        cores: sec ? Number(sec[1]) : null,
        section: sec ? Number(String(sec[2]).replace(",", ".")) : null,
        brand: dev ? dev.brand : ""
      };
    }
    if (/подрозетник|подрозет|устаноч.{0,6}короб/.test(low)) return { kind: "podrozetnik" };
    if (/распределительн|распаечн|ответвительн|коробка/.test(low)) return { kind: "junction" };
    if (/розетк/.test(low)) return { kind: "socket", posts: posts(low) };
    if (/выключател/.test(low) && !/автомат/.test(low)) return { kind: "switch", posts: posts(low) };
    if (/клеммник|\bшина\b|шни|din|дин-?рейк|гребен|кросс-?модул/.test(low)) return { kind: "accessory" };
    if (/стяжк|гофр|труба|короб(?!ка)|лоток|хомут|дюбель|саморез|гвозд|изолент|клипса|скоба/.test(low)) return { kind: "rashod" };
    return { kind: "other" };
  }

  // пройти по активной базе, проставить specs, сохранить
  function recognizeBase(base) {
    const api = window.EPDatabaseV27;
    if (!api || !api.getRows || !api.saveRows) return { ok: false, error: "Нет доступа к БД" };
    const b = base || api.getActiveBase();
    const rows = api.getRows(b, "") || [];
    const counts = {};
    const out = rows.map(r => {
      const specs = recognize(r);
      counts[specs.kind] = (counts[specs.kind] || 0) + 1;
      return { ...r, specs };
    });
    try {
      api.saveRows(b, out, "db-params-v28");
    } catch (e) {
      return { ok: false, error: e.message || String(e), counts, total: rows.length };
    }
    return { ok: true, total: rows.length, counts, base: b };
  }

  const KIND_LABELS = {
    avt: "автоматы", uzo: "УЗО", dif: "дифы", box: "корпуса",
    cable: "кабель/провод", socket: "розетки", switch: "выключатели",
    podrozetnik: "подрозетники", junction: "коробки", accessory: "шины/клеммы",
    rashod: "расходка", work: "работы", other: "прочее"
  };

  window.EPDbParamsV28 = { recognize, recognizeBase, KIND_LABELS };
})();
