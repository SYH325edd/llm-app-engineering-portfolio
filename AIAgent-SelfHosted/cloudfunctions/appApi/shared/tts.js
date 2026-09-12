"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeSpeech = synthesizeSpeech;
const https = require('https');
const TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
function requestId() { return `${Date.now().toString(36)}-${require('crypto').randomUUID()}`; }
function text(value) { return String(value || '').trim(); }
function ttsError(code, message, retryable = false, providerCode = '') {
    return Object.assign(new Error(message), { code, retryable, providerCode, safeErrorMessage: message });
}
function providerError(code, message, status) {
    const providerCode = String(code || '');
    const safeMessage = text(message) || '语音服务返回异常';
    if (status === 401 || status === 403)
        return ttsError('TTS_AUTH_FAILED', '语音服务鉴权失败', false, providerCode);
    if (providerCode === '40402003')
        return ttsError('TTS_TEXT_TOO_LONG', '朗读文本超过服务限制', false, providerCode);
    if (/speaker.*(denied|permission)|音色.*(无权|拒绝)/i.test(safeMessage))
        return ttsError('TTS_SPEAKER_DENIED', '当前音色不可用', false, providerCode);
    if (/concurrency|quota|rate.?limit|限流|配额/i.test(safeMessage) || status === 429)
        return ttsError('TTS_RATE_LIMITED', '语音服务繁忙', true, providerCode);
    if (status && status >= 500)
        return ttsError('TTS_PROVIDER_ERROR', '语音服务暂时不可用', true, providerCode);
    if (status && status >= 400)
        return ttsError('TTS_HTTP_ERROR', '语音服务请求失败', false, providerCode);
    return ttsError('TTS_PROVIDER_ERROR', '语音服务生成失败', false, providerCode);
}
function mapLocalError(error) {
    if (String(error?.code || '').startsWith('TTS_'))
        return error;
    const name = String(error?.name || 'Error');
    const message = text(error?.message);
    if (name === 'AbortError')
        return ttsError('TTS_REQUEST_TIMEOUT', '语音服务响应超时', true);
    if (/fetch is not defined/i.test(message))
        return ttsError('TTS_RUNTIME_UNSUPPORTED', '当前运行环境不支持语音请求', false);
    if (/ENOTFOUND|EAI_AGAIN/i.test(String(error?.code || '') + message))
        return ttsError('TTS_NETWORK_DNS', '语音服务域名解析失败', true);
    if (/CERT_|UNABLE_TO_VERIFY|TLS|SSL/i.test(String(error?.code || '') + message))
        return ttsError('TTS_NETWORK_TLS', '语音服务安全连接失败', true);
    if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(String(error?.code || '') + message))
        return ttsError('TTS_NETWORK_ERROR', '语音服务网络连接失败', true);
    return ttsError('TTS_PROVIDER_ERROR', '语音服务生成失败', false);
}
function parseEvent(raw) {
    const event = (raw.match(/(?:^|\r?\n)event:\s*([^\r\n]+)/)?.[1] || '').trim();
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    return { event, data };
}
async function synthesizeSpeech(input) {
    const narrationText = text(input.text);
    const apiKey = text(process.env.TTS_API_KEY);
    const speaker = text(process.env.TTS_SPEAKER);
    const resourceId = text(process.env.TTS_RESOURCE_ID) || 'seed-tts-2.0';
    const format = text(process.env.TTS_AUDIO_FORMAT) || 'mp3';
    const sampleRate = Number(process.env.TTS_SAMPLE_RATE || 24000);
    const bitRate = Number(process.env.TTS_BIT_RATE || 128000);
    const timeoutMs = Math.max(1000, Number(process.env.TTS_TIMEOUT_MS || 45000));
    const safeRequestId = text(input.requestId) || requestId();
    if (!apiKey || !speaker)
        throw ttsError('TTS_NOT_CONFIGURED', '语音服务尚未配置');
    if (!narrationText)
        throw ttsError('TTS_TEXT_EMPTY', '朗读文本为空');
    if (format !== 'mp3')
        throw ttsError('TTS_NOT_CONFIGURED', '当前仅支持 MP3 格式');
    const startedAt = Date.now();
    const chunks = [];
    let sseBuffer = '';
    let completed = false;
    let providerRequestId = safeRequestId;
    let request;
    let timer;
    const emit = (eventText) => {
        const { event, data } = parseEvent(eventText);
        if (!event || event === '351' || !data)
            return;
        let payload;
        try {
            payload = JSON.parse(data);
        }
        catch {
            throw ttsError('TTS_RESPONSE_INVALID', '语音服务响应格式无效');
        }
        const providerCode = String(payload?.code ?? '');
        if (event === '352') {
            if (Number(payload?.code) !== 0 || !text(payload?.data))
                throw providerError(payload?.code, payload?.message);
            chunks.push(Buffer.from(String(payload.data), 'base64'));
        }
        else if (event === '152') {
            if (Number(payload?.code) !== 20000000)
                throw providerError(payload?.code, payload?.message);
            completed = true;
        }
        else if (event === '153')
            throw providerError(providerCode, payload?.message);
    };
    try {
        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const consume = () => {
                let separator;
                while ((separator = sseBuffer.match(/\r?\n\r?\n/))) {
                    const eventText = sseBuffer.slice(0, separator.index);
                    sseBuffer = sseBuffer.slice((separator.index || 0) + separator[0].length);
                    if (eventText.trim())
                        emit(eventText);
                }
            };
            request = https.request(TTS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Api-Key': apiKey, 'X-Api-Resource-Id': resourceId, 'X-Api-Request-Id': safeRequestId },
            }, (response) => {
                providerRequestId = String(response.headers?.['x-tt-logid'] || response.headers?.['x-api-request-id'] || safeRequestId);
                if (Number(response.statusCode) < 200 || Number(response.statusCode) >= 300) {
                    finish(providerError('', '', Number(response.statusCode)));
                    return;
                }
                response.on('data', (chunk) => {
                    if (settled)
                        return;
                    try {
                        sseBuffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
                        consume();
                    }
                    catch (error) {
                        request.destroy(error);
                        finish(error);
                    }
                });
                response.once('error', finish);
                response.once('end', () => finish(completed ? undefined : ttsError('TTS_RESPONSE_INVALID', '语音服务未返回完成事件')));
            });
            request.once('error', finish);
            timer = setTimeout(() => request.destroy(ttsError('TTS_REQUEST_TIMEOUT', '语音服务响应超时', true)), timeoutMs);
            request.write(JSON.stringify({ user: { uid: safeRequestId }, req_params: { text: narrationText, speaker, audio_params: { format: 'mp3', sample_rate: sampleRate, bit_rate: bitRate, speech_rate: 0, loudness_rate: 0 }, additions: '{"disable_markdown_filter":true,"explicit_language":"zh-cn"}' } }));
            request.end();
        });
        const audio = Buffer.concat(chunks);
        if (!audio.length)
            throw ttsError('TTS_EMPTY_AUDIO', '语音服务未返回音频');
        const result = { audio, mimeType: 'audio/mpeg', format: 'mp3', providerRequestId, audioSize: audio.length };
        return result;
    }
    catch (error) {
        const mapped = mapLocalError(error);
        console.error(JSON.stringify({ functionName: 'shared/tts', event: 'TTS_REQUEST_FAILED', requestId: safeRequestId, durationMs: Date.now() - startedAt, errorCode: mapped.code, safeErrorMessage: mapped.safeErrorMessage, providerCode: mapped.providerCode || '' }));
        throw mapped;
    }
    finally {
        clearTimeout(timer);
    }
}
