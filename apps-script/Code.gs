const HEADERS = Object.freeze([
  "Received At",
  "Name",
  "Phone",
  "Email",
  "Services",
  "Industry",
  "Website",
  "Source",
  "Consent",
  "Status",
  "Submission ID",
]);

const ALLOWED_SERVICES = Object.freeze([
  "Định hình & Xây kênh",
  "ECOM Setup & Vận hành",
  "Quảng cáo đa nền tảng",
]);

const ALLOWED_INDUSTRIES = Object.freeze([
  "F&B — Nhà hàng / Cafe / Đồ uống",
  "Mỹ phẩm, Thời trang & Phụ kiện",
  "Mẹ & Bé",
  "Nội thất / Gia dụng / Decor",
  "Du lịch / Khách sạn / Resort",
  "Khác",
]);

/**
 * Receives the public lead form and returns a small confirmation page.
 * Required Script Properties: SHEET_ID, TURNSTILE_SECRET.
 * Optional Script Properties: SHEET_NAME, ALLOWED_HOSTNAMES, RETURN_URL.
 */
function doPost(event) {
  try {
    const properties = PropertiesService.getScriptProperties();
    const config = getConfig_(properties);
    const payload = parsePayload_(event);

    // Bots commonly fill hidden fields. Return a generic success response so
    // the field does not reveal how the spam filter works.
    if (payload.company) {
      return renderResponse_(true, config.returnUrl);
    }

    validatePayload_(payload);
    validateTurnstile_(payload.turnstileToken, config);
    appendLead_(payload, config);

    return renderResponse_(true, config.returnUrl);
  } catch (error) {
    console.error(error);
    return renderResponse_(
      false,
      getOptionalProperty_("RETURN_URL"),
      error instanceof PublicError ? error.message : "",
    );
  }
}

function doGet() {
  return renderResponse_(false, getOptionalProperty_("RETURN_URL"));
}

function getConfig_(properties) {
  const sheetId = properties.getProperty("SHEET_ID");
  const turnstileSecret = properties.getProperty("TURNSTILE_SECRET");

  if (!sheetId || !turnstileSecret) {
    throw new Error("Missing required Script Properties.");
  }

  return {
    sheetId,
    sheetName: properties.getProperty("SHEET_NAME") || "Leads",
    turnstileSecret,
    allowedHostnames: (properties.getProperty("ALLOWED_HOSTNAMES") || "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
    returnUrl: properties.getProperty("RETURN_URL") || "",
  };
}

function getOptionalProperty_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || "";
}

function parsePayload_(event) {
  if (!event || !event.parameter || !event.parameters) {
    throw new PublicError("Yêu cầu không hợp lệ. Vui lòng thử lại.");
  }

  const parameters = event.parameter;
  const services = event.parameters.services || [];

  return {
    fullName: normalize_(parameters.fullName, 80),
    phone: normalize_(parameters.phone, 20),
    email: normalize_(parameters.email, 120),
    services: services.map((service) => normalize_(service, 80)).filter(Boolean),
    industry: normalize_(parameters.industry, 100),
    website: normalize_(parameters.website, 200),
    source: normalize_(parameters.source, 80) || "unknown",
    consent: normalize_(parameters.consent, 10),
    company: normalize_(parameters.company, 120),
    turnstileToken: normalize_(parameters["cf-turnstile-response"], 2048),
  };
}

function validatePayload_(payload) {
  if (payload.fullName.length < 2) {
    throw new PublicError("Vui lòng nhập họ và tên.");
  }

  const phoneDigits = payload.phone.replace(/\D/g, "");
  if (
    !/^[0-9+().\s-]{8,20}$/.test(payload.phone) ||
    phoneDigits.length < 8 ||
    phoneDigits.length > 15
  ) {
    throw new PublicError("Số điện thoại chưa hợp lệ.");
  }

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    throw new PublicError("Email chưa hợp lệ.");
  }

  if (!payload.services.length || payload.services.some((service) => !ALLOWED_SERVICES.includes(service))) {
    throw new PublicError("Vui lòng chọn ít nhất một dịch vụ hợp lệ.");
  }

  if (!ALLOWED_INDUSTRIES.includes(payload.industry)) {
    throw new PublicError("Vui lòng chọn ngành nghề hợp lệ.");
  }

  if (payload.consent !== "yes") {
    throw new PublicError("Vui lòng đồng ý để 4DOTS liên hệ tư vấn.");
  }

  if (!payload.turnstileToken) {
    throw new PublicError("Vui lòng hoàn thành bước xác minh chống spam.");
  }
}

function validateTurnstile_(token, config) {
  const response = UrlFetchApp.fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "post",
      payload: {
        secret: config.turnstileSecret,
        response: token,
      },
      muteHttpExceptions: true,
    },
  );

  if (response.getResponseCode() !== 200) {
    throw new Error("Turnstile verification request failed.");
  }

  const result = JSON.parse(response.getContentText());
  const hostname = String(result.hostname || "").toLowerCase();

  if (!result.success || result.action !== "lead_form") {
    console.error(
      "Turnstile validation failed: " +
        JSON.stringify({
          success: Boolean(result.success),
          action: String(result.action || ""),
          hostname,
          errorCodes: result["error-codes"] || [],
        }),
    );
    throw new PublicError("Xác minh chống spam không thành công. Vui lòng thử lại.");
  }

  if (config.allowedHostnames.length && !config.allowedHostnames.includes(hostname)) {
    throw new Error("Turnstile hostname was not allowed: " + hostname);
  }
}

function appendLead_(payload, config) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    const spreadsheet = SpreadsheetApp.openById(config.sheetId);
    const sheet = spreadsheet.getSheetByName(config.sheetName) || spreadsheet.insertSheet(config.sheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),
      safeCell_(payload.fullName),
      safeCell_(payload.phone),
      safeCell_(payload.email),
      safeCell_(payload.services.join(", ")),
      safeCell_(payload.industry),
      safeCell_(payload.website),
      safeCell_(payload.source),
      "Yes",
      "New",
      Utilities.getUuid(),
    ]);
  } finally {
    lock.releaseLock();
  }
}

function normalize_(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function safeCell_(value) {
  const text = String(value || "");
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function renderResponse_(success, returnUrl, publicMessage) {
  const title = success ? "Đã nhận thông tin" : "Chưa thể gửi thông tin";
  const message = success
    ? "Cảm ơn bạn. Đội ngũ 4DOTS sẽ liên hệ để trao đổi cụ thể trong thời gian sớm nhất."
    : publicMessage || "Đã có lỗi xảy ra. Vui lòng quay lại và thử gửi một lần nữa.";
  const safeReturnUrl = escapeHtml_(returnUrl || "#");
  const returnAction = returnUrl ? "" : ' onclick="history.back(); return false;"';

  const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base target="_top">
    <title>${escapeHtml_(title)} | 4DOTS</title>
    <style>
      *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#110d0b;color:#fcf8f2;font-family:Arial,sans-serif}
      main{width:min(100%,560px);padding:36px;border:1px solid rgba(255,241,228,.13);border-radius:24px;background:#1d1612;box-shadow:0 28px 80px rgba(0,0,0,.32)}
      .brand{color:#ff7c39;font-size:24px;font-weight:900;letter-spacing:-1px}.mark{display:grid;width:52px;height:52px;margin:30px 0 20px;place-items:center;border-radius:50%;background:${success ? "#ff6230" : "#6b3428"};font-size:24px;font-weight:900}
      h1{margin:0 0 14px;font-size:36px;line-height:1.05;letter-spacing:-1.5px}p{margin:0 0 28px;color:#b9aaa0;line-height:1.7}
      a{display:inline-flex;min-height:48px;align-items:center;padding:0 22px;border-radius:999px;background:linear-gradient(115deg,#ff6230,#ff8a3d);color:#fff;font-size:13px;font-weight:800;text-decoration:none;text-transform:uppercase}
    </style>
  </head>
  <body>
    <main>
      <div class="brand">4DOTS</div>
      <div class="mark" aria-hidden="true">${success ? "✓" : "!"}</div>
      <h1>${escapeHtml_(title)}</h1>
      <p>${escapeHtml_(message)}</p>
      <a href="${safeReturnUrl}" target="_top"${returnAction}>Quay lại trang 4DOTS</a>
    </main>
  </body>
</html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle(title + " | 4DOTS")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class PublicError extends Error {}
