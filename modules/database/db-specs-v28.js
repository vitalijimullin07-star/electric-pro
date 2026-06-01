/* ============================================================
   Electric Pro — DB Specs (auto-recognition) V28.5
   Распознаёт структурные параметры для ВСЕХ позиций БД и кладёт
   их в поле item.specs. Конфигуратор щита и пулы могут брать готовые
   параметры вместо разбора названия каждый раз.

   Виды (kind):
   - avt / uzo / dif / box  — аппараты щита (через ShieldDbResolverV28)
   - cable                  — кабель/провод (тип, жилы, сечение)
   - socket                 — розетки (посты, заземление)
   - mount_box              — подрозетники
   - terminal               — клеммники/шины
   - work                   — работы
   - other                  — прочее

   Ручные параметры (specs.source==="manual") авто-скан НЕ перетирает.
   ============================================================ */
(() => {
  "use strict";
  if (window.__EP_DB_SPECS_V28__) return;
  window.__EP_DB_SPECS_V28__ = true;

  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

  function cableType(low) {
    if (/пугв|пв-?3|пв3/.test(low)) return "ПуГВ";
    if (/ввгнг|ввг-?п|ввг/.test(low)) return "ВВГ";
    if (/nym/.test(low)) return "NYM";
    if (/пвс/.test(low)) return "ПВС";
    if (/швввп|швп/.test(low)) return "ШВВП";
    if (/сип/.test(low)) return "СИП";
    if (/кг\b/.test(low)) return "КГ";
    if (/ftp|utp|cat ?5|cat ?6|витая/.test(low)) return "LAN";
    if (/sat|коакс|rg-?6/.test(low)) return "Коакс";
    return "";
  }

  function recognize(name, type) {
    const low = norm(name);
    const R = window.ShieldDbResolverV28;

    // 0) работа — проверяем ТИП первым делом (иначе «Монтаж автомата» примем за автомат)
    if (norm(type).includes("work") || norm(type).includes("работ")) return { kind: "work", source: "auto" };

    // 1) аппараты щита — через готовый парсер
    if (R && R.parseDevice) {
      const d = R.parseDevice(name);
      if (["avt", "uzo", "dif", "box"].includes(d.kind)) {
        return { kind: d.kind, brand: d.brand || "", series: d.series || "", curve: d.curve || "",
          amp: d.amp ?? null, rcdType: d.rcdType || "", leakMA: d.leakMA ?? null, modules: d.modules ?? null, source: "auto" };
      }
    }

    // 2) кабель / провод
    if (/ввг|пугв|пв-?3|пв3|nym|пвс|швввп|сип|кабель|провод|ftp|utp|cat ?5|cat ?6|sat|коакс/.test(low)) {
      const cs = name.match(/(\d{1,2})\s?[хx*]\s?(\d{1,3}(?:[.,]\d+)?)/i);
      return { kind: "cable", cableType: cableType(low),
        cores: cs ? Number(cs[1]) : null,
        section: cs ? Number(cs[2].replace(",", ".")) : null, source: "auto" };
    }

    // 3) розетки
    if (/розетк/.test(low)) {
      const pm = low.match(/(\d)\s?-?\s?(?:пост|местн|секц|гнезд|местов)/);
      return { kind: "socket", posts: pm ? Number(pm[1]) : 1,
        ground: /з\/к|с заземл|earth|3к/.test(low), source: "auto" };
    }

    // 4) подрозетники
    if (/подрозетник|устан\.?\s?короб|монтажн\.?\s?короб/.test(low)) return { kind: "mount_box", source: "auto" };

    // 5) клеммники / шины
    if (/клеммник|шина|шни|кросс-?модуль|din-?рейк/.test(low)) return { kind: "terminal", source: "auto" };

    return { kind: "other", source: "auto" };
  }

  // device-форма из сохранённых specs (для резолвера)
  function deviceFromSpecs(sp) {
    if (!sp || !["avt", "uzo", "dif", "box"].includes(sp.kind)) return null;
    return { raw: "", kind: sp.kind, brand: sp.brand || "", series: sp.series || "",
      curve: sp.curve || "", amp: sp.amp ?? null, rcdType: sp.rcdType || "",
      leakMA: sp.leakMA ?? null, modules: sp.modules ?? null };
  }

  function scanActiveBase() {
    const api = window.EPDatabaseV27;
    if (!api || !api.getRows) return { error: "БД недоступна" };
    const base = api.getActiveBase ? api.getActiveBase() : "my";
    const rows = api.getRows(base) || [];
    let recognized = 0, devices = 0, kept = 0;
    const updated = rows.map(r => {
      if (r.specs && r.specs.source === "manual") { kept++; return r; }
      const sp = recognize(r.name, r.type);
      if (sp.kind && sp.kind !== "other") recognized++;
      if (["avt", "uzo", "dif", "box"].includes(sp.kind)) devices++;
      return { ...r, specs: sp };
    });
    try { api.saveRows(base, updated, "specs-scan"); } catch (e) { return { error: e.message || String(e) }; }
    return { total: rows.length, recognized, devices, kept, base };
  }

  window.EPDbSpecs = { recognize, deviceFromSpecs, scanActiveBase };
})();
