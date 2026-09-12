import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("profile records expose pagination and user-only filters", () => {
  const billing = read("apps/api/src/services/billing.service.ts");
  const routes = read("apps/api/src/routes/user.routes.ts");
  const page = read("apps/web/src/pages/ProfilePage.tsx");
  assert.match(billing, /pageSize/);
  assert.match(billing, /startDate/);
  assert.match(billing, /direction/);
  assert.match(billing, /totalPages/);
  assert.match(billing, /tab === "consume"/);
  assert.match(billing, /tab === "recharge"/);
  assert.match(routes, /getCreditLogs\(getUserId[\s\S]*req\.query/);
  assert.match(page, /消费记录/);
  assert.match(page, /充值记录/);
  assert.match(page, /上一页/);
  assert.match(page, /重置/);
});

test("query date filters use yesterday through today defaults", () => {
  const utility = read("apps/web/src/utils/date-filters.ts");
  const page = read("apps/web/src/pages/ProfilePage.tsx");
  const billing = read("apps/api/src/services/billing.service.ts");
  assert.match(utility, /getDefaultSingleDate/);
  assert.match(utility, /getDefaultDateRange/);
  assert.match(utility, /getDate\(\) - 1/);
  assert.match(page, /defaultRecordFilters/);
  assert.match(page, /normalizeDateRangeForQuery/);
  assert.match(billing, /T00:00:00/);
  assert.match(billing, /T23:59:59\.999/);
  assert.match(read("apps/web/src/pages/AdminGiftCardsPage.tsx"), /datetime-local/);
});

test("profile password and notification settings are protected and persisted", () => {
  const routes = read("apps/api/src/routes/user.routes.ts");
  const schema = read("apps/api/prisma/schema.prisma");
  const page = read("apps/web/src/pages/ProfilePage.tsx");
  assert.match(routes, /post\("\/user\/password", requireAuth, requireActiveUser/);
  assert.match(routes, /get\("\/user\/notification-settings", requireAuth, requireActiveUser/);
  assert.match(routes, /put\("\/user\/notification-settings", requireAuth, requireActiveUser/);
  assert.match(schema, /notifyTaskCompleted/);
  assert.match(schema, /notifyTaskFailed/);
  assert.match(schema, /notifyCreditChanged/);
  assert.match(schema, /notifySystemAnnouncement/);
  assert.match(page, /原密码/);
  assert.match(page, /任务完成通知/);
  assert.match(page, /系统公告通知/);
});
