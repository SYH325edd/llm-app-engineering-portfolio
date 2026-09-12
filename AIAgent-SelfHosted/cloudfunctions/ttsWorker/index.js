"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processOne = processOne;
const context_1 = require("./shared/context");
const constants_1 = require("./shared/constants");
const audit_1 = require("./shared/audit");
const utils_1 = require("./shared/utils");
const tts_1 = require("./shared/tts");
const ark_1 = require("./shared/ark");
const result_narration_1 = require("./shared/result-narration");
const generated_files_1 = require("./shared/generated-files");
function hash(resultId, version, voice, narration) { return require('crypto').createHash('sha256').update(`${resultId}${version}${result_narration_1.NARRATION_VERSION}${voice}${narration}`).digest('hex'); }
function dataSpaceOf(record) { return record?.dataSpace === 'developer_test' ? 'developer_test' : 'production'; }
function storagePrefix(dataSpace) { return dataSpace === 'developer_test' ? 'developer-test' : 'production'; }
function safeError(error) { const code = String(error?.code || 'TTS_PROVIDER_ERROR'); return { code, message: '\u8bed\u97f3\u8bb2\u89e3\u751f\u6210\u5931\u8d25' }; }
async function updateVoiceStatus(taskId, voiceStatus) { await context_1.db.collection(constants_1.C.tasks).doc(taskId).update({ data: { voiceStatus, updatedAt: (0, utils_1.now)() } }); }
async function claimPendingResult(resultId) {
  if (!resultId) return null;
  const candidate = (await context_1.db.collection(constants_1.C.results).doc(resultId).get()).data;
  if (!candidate || candidate.audioNarration?.status !== 'PENDING') return null;
  return context_1.db.runTransaction(async (transaction) => {
    const ref = transaction.collection(constants_1.C.results).doc(candidate._id);
    const result = (await ref.get()).data;
    if (!result || result.audioNarration?.status !== 'PENDING') return null;
    await ref.update({ data: { audioNarration: { ...result.audioNarration, status: 'GENERATING', errorCode: '', safeErrorMessage: '', updatedAt: (0, utils_1.now)() }, updatedAt: (0, utils_1.now)() } });
    await transaction.collection(constants_1.C.tasks).doc(result.taskId || candidate._id).update({ data: { voiceStatus: 'GENERATING', updatedAt: (0, utils_1.now)() } });
    return result;
  });
}
function narrationContractError() { return Object.assign(new Error('Narration result does not match its input contract.'), { code: 'NARRATION_CONTRACT_ERROR' }); }
function validateNarrationContract(output, input) {
  if (!output || typeof output !== 'object' || output.summaryText !== input.expectedSummaryText || output.endingText !== input.expectedEncouragement || !Array.isArray(output.items) || output.items.length !== input.questions.length)
    throw narrationContractError();
  const sourceKeys = new Set();
  for (let index = 0; index < output.items.length; index += 1) {
    const item = output.items[index];
    if (!item || typeof item.sourceKey !== 'string' || !item.sourceKey || sourceKeys.has(item.sourceKey) || item.sourceKey !== input.questions[index].sourceKey || typeof item.text !== 'string' || !item.text.trim())
      throw narrationContractError();
    sourceKeys.add(item.sourceKey);
  }
  const validated = (0, result_narration_1.validateNarration)(output, input);
  if (!validated)
    throw narrationContractError();
  return validated;
}
async function generateNarration(result, resultId, taskMode) {
  const input = (0, result_narration_1.buildNarrationInput)(result, taskMode);
  try {
    const validated = validateNarrationContract(await (0, ark_1.generateNarration)(input, resultId), input);
    return { text: validated.text, source: 'model' };
  } catch (error) {
    const originalErrorCode = String(error === null || error === void 0 ? void 0 : error.code || '');
    if (!['NARRATION_CONTRACT_ERROR', 'ARK_INVALID_JSON', 'ARK_REQUEST_FAILED', 'ARK_TIMEOUT', 'ARK_REQUEST_TIMEOUT', 'ARK_HTTP_ERROR', 'LLM_EMPTY_RESPONSE', 'LLM_TRUNCATED_RESPONSE'].includes(originalErrorCode)) throw error;
    const narration = (0, result_narration_1.fallbackNarration)(input);
    if (!String(narration || '').trim()) throw error;
    (0, audit_1.monitor)('ttsWorker', 'NARRATION_FALLBACK_USED', { resultId, mode: input.mode, questionCount: input.questions.length, originalErrorCode, narrationVersion: result_narration_1.NARRATION_VERSION });
    return { text: narration, source: 'deterministic_fallback' };
  }
}
function taskStateError() { return Object.assign(new Error('Task state is not valid for narration generation.'), { code: 'TTS_TASK_STATE_INVALID' }); }
async function verifiedTask(result, resultId) {
  const taskId = result?.taskId;
  if (typeof taskId !== 'string' || !taskId.trim())
    throw taskStateError();
  let task;
  try { task = (await context_1.db.collection(constants_1.C.tasks).doc(taskId).get()).data; } catch (_) { throw taskStateError(); }
  if (!task || task.status !== 'COMPLETED' || task.resultId !== resultId || dataSpaceOf(task) !== dataSpaceOf(result))
    throw taskStateError();
  return task;
}
async function processOne(resultId = '') {
  const result = await claimPendingResult(resultId); if (!result) return { processed: false };
  const id = String(result._id || resultId || ''), voice = String(process.env.TTS_SPEAKER || '').trim(); let narration = '', textHash = '';
  try {
    const task = await verifiedTask(result, id), taskMode = task.mode || '';
    const generated = await generateNarration(result, id, taskMode); narration = generated.text; textHash = hash(id, result.resultVersion || 1, voice, narration);
    await context_1.db.collection(constants_1.C.results).doc(id).update({ data: { resultNarrationText: narration, narrationSource: generated.source, narrationVersion: result_narration_1.NARRATION_VERSION, narrationGeneratedAt: (0, utils_1.now)(), updatedAt: (0, utils_1.now)() } });
    await updateVoiceStatus(id, 'SYNTHESIZING');
    const speech = await (0, tts_1.synthesizeSpeech)({ text: narration, requestId: (0, utils_1.randomId)('tts') }); const upload = await context_1.cloud.uploadFile({ cloudPath: `${storagePrefix(dataSpaceOf(task))}/tts/results/${id}/${textHash}.mp3`, fileContent: speech.audio });
    await (0, generated_files_1.recordGeneratedFile)({ fileId: String(upload.fileID || ''), kind: 'tts_audio', ownerId: String(result.studentId || ''), sourceId: id, dataSpace: dataSpaceOf(task) });
    await context_1.db.collection(constants_1.C.results).doc(id).update({ data: { audioNarration: { status: 'READY', textHash, fileId: String(upload.fileID || ''), mimeType: speech.mimeType, durationMs: 0, voice, generatedAt: (0, utils_1.now)(), errorCode: '', safeErrorMessage: '' }, updatedAt: (0, utils_1.now)() } }); await updateVoiceStatus(id, 'READY');
    (0, audit_1.monitor)('ttsWorker', 'TTS_READY', { resultId: id, textHash: textHash.slice(0, 8), voice, narrationSource: generated.source, status: 'READY' }); return { processed: true, reused: false };
  } catch (error) { const failure = safeError(error); await context_1.db.collection(constants_1.C.results).doc(id).update({ data: { audioNarration: { status: 'FAILED', textHash, fileId: '', mimeType: '', durationMs: 0, voice, generatedAt: null, errorCode: failure.code, safeErrorMessage: failure.message, failedAt: (0, utils_1.now)() }, updatedAt: (0, utils_1.now)() } }); await updateVoiceStatus(id, 'FAILED'); (0, audit_1.monitor)('ttsWorker', 'TTS_FAILED', { resultId: id, textHash: textHash.slice(0, 8), voice, status: 'FAILED', errorCode: failure.code }, true); return { processed: true, failed: true }; }
}
exports.__test = { hash, validateNarrationContract };
exports.main = async (event = {}) => processOne(String(event?.resultId || ''));
