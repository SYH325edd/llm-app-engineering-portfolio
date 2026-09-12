import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("membership level is persisted and synchronized with balance", () => {
  const schema = read("apps/api/prisma/schema.prisma");
  const billing = read("apps/api/src/services/billing.service.ts");
  const profile = read("apps/web/src/pages/ProfilePage.tsx");
  assert.match(schema, /memberLevel\s+String\s+@default\("normal"\)/);
  assert.match(billing, /balance >= 50000 \? "svip" : "normal"/);
  assert.match(billing, /syncMemberLevel/);
  assert.match(profile, /SVIP用户/);
  assert.match(profile, /50000/);
  assert.match(profile, /Math\.min\(100/);
});

test("SVIP video charge uses rounded 98 percent pricing and records metadata", () => {
  const billing = read("apps/api/src/services/billing.service.ts");
  const generation = read("apps/api/src/services/generation.service.ts");
  assert.match(billing, /Math\.round\(originalCost \* 0\.98\)/);
  assert.match(generation, /originalCost/);
  assert.match(generation, /discountRate=0\.98/);
  assert.match(generation, /memberLevelAtCharge=svip/);
});
