import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("invite schema, routes, and reward rules are present", () => {
  const schema = read("apps/api/prisma/schema.prisma");
  const service = read("apps/api/src/services/invite.service.ts");
  const routes = read("apps/api/src/routes/invite.routes.ts");
  const auth = read("apps/api/src/services/auth.service.ts");
  assert.match(schema, /inviteCode\s+String\?\s+@unique/);
  assert.match(schema, /invitedByUserId/);
  assert.match(schema, /inviteCodeUsedAt/);
  assert.match(service, /INVITE_LENGTH = 6/);
  assert.match(service, /role === "admin" \? 100 : 10/);
  assert.match(service, /invitee_reward/);
  assert.match(service, /inviter_reward/);
  assert.match(service, /relatedInviteeUserId/);
  assert.match(routes, /get\("\/invite\/me", requireAuth, requireActiveUser/);
  assert.match(routes, /post\("\/invite\/apply", requireAuth, requireActiveUser/);
  assert.match(auth, /inviteCode/);
});

test("invite UI is modal-based and registration accepts an optional code", () => {
  const topbar = read("apps/web/src/components/Topbar.tsx");
  const register = read("apps/web/src/pages/RegisterPage.tsx");
  const admin = read("apps/web/src/pages/AdminDashboardPage.tsx");
  assert.match(topbar, /邀请好友|inviteOpen/);
  assert.match(topbar, /invite-card|invite-modal|inviteInfo/);
  assert.match(register, /邀请码（选填）/);
  assert.match(register, /register\(email, password, nickname, inviteCode\)/);
  assert.match(admin, /inviteSource/);
});
