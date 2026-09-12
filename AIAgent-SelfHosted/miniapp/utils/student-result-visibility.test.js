const assert = require('node:assert/strict');
const test = require('node:test');
const visibility = require('./student-result-visibility');

test('hidden mode applies only to formal ordinary students', () => {
  const hidden = { clientConfig: { studentResultVisibility: 'hidden' } };
  assert.equal(visibility.shouldHideStudentResult({ ...hidden, user: { role: 'student', status: 'ACTIVE' } }), true);
  assert.equal(visibility.shouldHideStudentResult({ ...hidden, user: { role: 'student', status: 'ACTIVE', reviewMode: true } }), false);
  assert.equal(visibility.shouldHideStudentResult({ ...hidden, user: { role: 'student', status: 'ACTIVE', reviewOnly: true } }), false);
  assert.equal(visibility.shouldHideStudentResult({ ...hidden, user: { role: 'teacher', status: 'ACTIVE' } }), false);
  assert.equal(visibility.shouldHideStudentResult({ ...hidden, user: { role: 'super_admin', status: 'ACTIVE' } }), false);
});

test('visible mode restores the original student result route', () => {
  const visible = { clientConfig: { studentResultVisibility: 'visible' }, user: { role: 'student', status: 'ACTIVE' } };
  assert.equal(visibility.shouldHideStudentResult(visible), false);
  assert.equal(visibility.resolveStudentTaskRoute({ taskId: 'task-1', status: 'COMPLETED' }, false), '/pages/result/detail/index?taskId=task-1');
  assert.equal(visibility.resolveStudentTaskRoute({ taskId: 'task-2', status: 'PROCESSING' }, false), '/pages/task/processing/index?taskId=task-2');
});

test('hidden mode blocks result routes but preserves mandatory confirmation', () => {
  assert.equal(visibility.resolveStudentTaskRoute({ taskId: 'task-1', status: 'COMPLETED' }, true), '/pages/result/notice/index?mode=result_hidden&taskId=task-1');
  assert.equal(visibility.resolveStudentTaskRoute({ taskId: 'task-2', status: 'PROCESSING' }, true), '/pages/result/notice/index?mode=result_hidden&taskId=task-2');
  assert.equal(visibility.resolveStudentTaskRoute({ taskId: 'task-3', status: 'NEED_CONFIRMATION' }, true), '/pages/task/confirm/index?taskId=task-3');
});
