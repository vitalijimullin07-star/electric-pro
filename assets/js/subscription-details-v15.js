(function () {
  function show(type) {
    if (type === "basic") {
      alert("Базовая подписка\n\nДоступно: база, смета, поставщику, черновик.\n\nЛимиты: щит до 60 позиций, пул розеток/штроб до 50 позиций.\n\nВсе ИИ-функции полностью недоступны.");
      return;
    }
    alert("Подписка С ИИ\n\nДоступно всё без ограничений по щиту и пулу, кроме админ-панели.\n\nДоступны экспорт/импорт с ИИ и все функции, которые требуют ИИ.\n\nИИ оплачивается отдельно по балансу/токенам или через API клиента.");
  }

  function addButtons() {
    document.querySelectorAll(".subscription-details-v15-btn").forEach(x => x.remove());
    const cards = Array.from(document.querySelectorAll(".card, .subscription-card, .plan-card"));
    cards.forEach(card => {
      const text = card.textContent || "";
      let type = null;
      if (text.includes("Базовая")) type = "basic";
      if (text.includes("С ИИ")) type = "ai";
      if (!type) return;
      const btn = document.createElement("button");
      btn.className = "btn btn-ghost ep-clickable subscription-details-v15-btn";
      btn.textContent = "Подробнее";
      btn.type = "button";
      btn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        show(type);
      });
      card.appendChild(btn);
    });
  }

  window.SubscriptionDetailsV15 = { show, addButtons };
  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(addButtons, 1200);
    setTimeout(addButtons, 2500);
  });
})();
