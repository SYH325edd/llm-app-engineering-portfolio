import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("gift cards have the required schema and protected API routes", () => {
  const schema = read("apps/api/prisma/schema.prisma");
  const routes = `${read("apps/api/src/routes/admin.routes.ts")}\n${read("apps/api/src/routes/user.routes.ts")}`;
  const service = read("apps/api/src/services/gift-card.service.ts");
  const billing = read("apps/api/src/services/billing.service.ts");
  assert.match(schema, /model GiftCard/);
  assert.match(schema, /code\s+String\s+@unique/);
  assert.match(schema, /relatedGiftCardId/);
  assert.match(routes, /post\("\/admin\/gift-cards"[\s\S]*requireAdmin/);
  assert.match(routes, /get\("\/admin\/gift-cards"[\s\S]*requireAdmin/);
  assert.match(routes, /post\("\/admin\/gift-cards\/:id\/disable"[\s\S]*requireAdmin/);
  assert.match(routes, /post\("\/gift-cards\/redeem", requireAuth, requireActiveUser/);
  assert.match(service, /search/);
  assert.match(service, /pageSize/);
  assert.match(service, /status === "expired"/);
  assert.match(service, /redeemedByEmail/);
  assert.match(service, /CODE_LENGTH = 24/);
  assert.match(billing, /gift_card_redeem/);
  assert.match(service, /updateMany\(\{ where: \{ id: card\.id, status: "active" \}/);
});

test("gift card frontend keeps redemption in a modal and exposes admin page", () => {
  const topbar = read("apps/web/src/components/Topbar.tsx");
  const auth = read("apps/web/src/context/AuthContext.tsx");
  const app = read("apps/web/src/App.tsx");
  const adminDashboard = read("apps/web/src/pages/AdminDashboardPage.tsx");
  const adminPage = read("apps/web/src/pages/AdminGiftCardsPage.tsx");
  assert.match(topbar, /gift-card-modal/);
  assert.match(auth, /\/gift-cards\/redeem/);
  assert.doesNotMatch(topbar, /navigate\(/);
  assert.doesNotMatch(app, /path="\/admin\/gift-cards"/);
  assert.match(adminDashboard, /giftCards/);
  assert.match(adminPage, /复制 ID/);
  assert.match(adminPage, /禁用|作废/);
});
