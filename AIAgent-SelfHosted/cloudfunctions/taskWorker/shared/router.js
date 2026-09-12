"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUseLite = shouldUseLite;
function shouldUseLite(result) { const r = result?.route || {}; if (r.recommendedModel === 'lite')
    return true; if (Number(r.confidence || 0) < 0.86)
    return true; if (['hard', 'very_hard'].includes(r.difficulty))
    return true; const tags = new Set(r.flags || []); return ['geometry', 'proof', 'graph', 'multi_part', 'blurred', 'ambiguous_symbol', 'long_reasoning'].some(x => tags.has(x)); }
