"use strict";

// Replace these two public values before launch. Never put secret keys here.
const CONFIG = Object.freeze({
  formEndpoint: "https://script.google.com/macros/s/AKfycbxr0SEaQCQr5CEw9b1YyfTGsBeMcaAiq1snXinHL4hbPRRM-QOwlE6_1CGUFJrRh2q3/exec",
  turnstileSiteKey: "0x4AAAAAADi7M4XA05AxgvHx",
});

const form = document.querySelector("#lead-form");
const formStatus = document.querySelector("#form-status");
const submitButton = form?.querySelector('button[type="submit"]');
const currentYear = document.querySelector("#current-year");
let turnstileWidgetId = null;

if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}

function isConfigured(value) {
  return Boolean(value && !value.startsWith("YOUR_"));
}

function setStatus(message, type = "error") {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.className = `form-status is-visible is-${type}`;
}

function clearStatus() {
  if (!formStatus) return;
  formStatus.textContent = "";
  formStatus.className = "form-status";
}

function validateServices() {
  return form.querySelectorAll('input[name="services"]:checked').length > 0;
}

function configureForm() {
  if (!form || !submitButton) return;

  if (isConfigured(CONFIG.formEndpoint) && isConfigured(CONFIG.turnstileSiteKey)) {
    form.action = CONFIG.formEndpoint;
    submitButton.disabled = false;
  } else {
    submitButton.disabled = true;
    setStatus(
      "Biểu mẫu đang chờ cấu hình. Hãy thêm Apps Script URL và Turnstile site key trong app.js.",
      "info",
    );
  }
}

window.onTurnstileLoad = function onTurnstileLoad() {
  if (!isConfigured(CONFIG.turnstileSiteKey) || !window.turnstile) return;

  turnstileWidgetId = window.turnstile.render("#turnstile-widget", {
    sitekey: CONFIG.turnstileSiteKey,
    action: "lead_form",
    theme: "dark",
    size: "flexible",
    callback: clearStatus,
    "expired-callback": () => {
      setStatus("Phiên xác minh đã hết hạn. Vui lòng xác minh lại.");
    },
    "error-callback": (errorCode) => {
      console.error("Turnstile error:", errorCode);
      setStatus(
        `Không thể tải xác minh chống spam. Mã lỗi: ${errorCode || "không xác định"}.`,
      );
      return true;
    },
  });
};

form?.addEventListener("submit", (event) => {
  clearStatus();

  if (!isConfigured(CONFIG.formEndpoint) || !isConfigured(CONFIG.turnstileSiteKey)) {
    event.preventDefault();
    setStatus("Biểu mẫu chưa được cấu hình để nhận thông tin.", "info");
    return;
  }

  if (!form.checkValidity()) {
    event.preventDefault();
    form.reportValidity();
    setStatus("Vui lòng hoàn thành các trường bắt buộc.");
    return;
  }

  if (!validateServices()) {
    event.preventDefault();
    setStatus("Vui lòng chọn ít nhất một dịch vụ quan tâm.");
    form.querySelector('input[name="services"]')?.focus();
    return;
  }

  const turnstileResponse = form.querySelector('[name="cf-turnstile-response"]')?.value;
  if (!turnstileResponse) {
    event.preventDefault();
    setStatus("Vui lòng hoàn thành bước xác minh chống spam.");
    if (turnstileWidgetId !== null) {
      window.turnstile?.reset(turnstileWidgetId);
    }
    return;
  }

  submitButton.disabled = true;
  const submitLabel = submitButton.querySelector("span");
  if (submitLabel) {
    submitLabel.textContent = "Đang gửi...";
  }
});

document.querySelectorAll(".consult-trigger").forEach((trigger) => {
  trigger.addEventListener("click", () => {
    const requestedService = trigger.dataset.service;

    if (requestedService && form) {
      const serviceInput = Array.from(
        form.querySelectorAll('input[name="services"]'),
      ).find((input) => input.value === requestedService);

      if (serviceInput) {
        serviceInput.checked = true;
      }
    }

    document.querySelector("#consult-form")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    window.setTimeout(() => {
      const formWrap = document.querySelector(".hero-form-wrap");
      formWrap?.classList.remove("form-pulse");
      void formWrap?.offsetWidth;
      formWrap?.classList.add("form-pulse");
      form?.querySelector('input[name="fullName"]')?.focus({ preventScroll: true });
    }, 500);
  });
});

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

configureForm();
