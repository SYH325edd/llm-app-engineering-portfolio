"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const pageDir = __dirname;
const wxml = fs.readFileSync(path.join(pageDir, "index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageDir, "index.wxss"), "utf8");

function renderResultSummary(item) {
  const summary = wxml.match(
    /<view[^>]*wx:if="\{\{item\.totalQuestionCount !== null && item\.totalQuestionCount !== undefined\}\}"[^>]*>([\s\S]*?)<\/view>/
  );
  assert.ok(summary, "task result summary exists");

  return summary[1]
    .replace(
      /<text[^>]*wx:if="\{\{item\.carelessCount > 0\}\}"[^>]*>([\s\S]*?)<\/text>/g,
      item.carelessCount > 0 ? "$1" : ""
    )
    .replace(/\{\{item\.([A-Za-z]+)\}\}/g, (_, key) => String(item[key]))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("carelessCount=2 displays the careless tag without changing other counts", () => {
  const rendered = renderResultSummary({
    totalQuestionCount: 3,
    correctCount: 1,
    carelessCount: 2,
    wrongCount: 1,
    incompleteCount: 0,
  });

  assert.match(rendered, /马虎 2/);
  assert.match(rendered, /题目 3/);
  assert.match(rendered, /正确 1/);
  assert.match(rendered, /错误 1/);
  assert.match(rendered, /未完成 0/);
});

test("carelessCount=0, null, or missing does not display the careless tag", () => {
  const base = {
    totalQuestionCount: 3,
    correctCount: 1,
    wrongCount: 1,
    incompleteCount: 0,
  };

  assert.doesNotMatch(renderResultSummary({ ...base, carelessCount: 0 }), /马虎/);
  assert.doesNotMatch(renderResultSummary({ ...base, carelessCount: null }), /马虎/);
  assert.doesNotMatch(renderResultSummary(base), /马虎/);
});

test("page keeps task navigation, date filtering, and responsive careless styling", () => {
  assert.match(wxml, /class="card task-card"[^>]*bindtap="open"/);
  assert.match(wxml, /<picker[^>]*bindchange="chooseDate"/);
  assert.match(wxml, /class="task-time task-result-summary"/);
  assert.match(wxml, /class="task-careless-tag"/);
  assert.match(wxss, /\.task-result-summary\s*\{[^}]*display\s*:\s*flex[^}]*flex-wrap\s*:\s*wrap[^}]*gap\s*:\s*8rpx/s);
  assert.match(wxss, /\.task-careless-tag\s*\{[^}]*background\s*:\s*#fff3df[^}]*color\s*:\s*#f59b23/s);
});
