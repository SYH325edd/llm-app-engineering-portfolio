'use strict';
const cloud = require('../../services/cloud');

function requestId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

Page({
  data: {
    taskId: '', loading: true, submitting: false, errorMessage: '',
    brief: [], session: null, currentHint: '', explanation: '', retell: '',
    variants: [], variantAnswer: '', variantReasoning: '', currentVariantId: '',
    feedback: '', review: null, reviewAnswer: '', reviewReasoning: ''
  },
  onLoad(options) {
    const taskId = String(options.taskId || '');
    this.setData({ taskId });
    if (!taskId) return this.setData({ loading: false, errorMessage: '缺少任务编号' });
    this.start();
  },
  async start() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const data = await cloud.call('startHardProblemTraining', { taskId: this.data.taskId }, 30000);
      const variants = (data.session && Array.isArray(data.session.variants) ? data.session.variants : []).map(v => ({ variantId: v.variantId, transferLevel: v.transferLevel, questionText: v.questionText, status: v.status, feedback: v.feedback || '' }));
      this.setData({ session: data.session, brief: data.brief || [], currentHint: data.currentHint || '', variants, currentVariantId: ((variants.find(v => v.status !== 'COMPLETED') || {}).variantId || ''), loading: false });
      if (data.session && data.session.reachedL4Ever && data.session.currentRetentionStatus !== 'NEEDS_REINFORCEMENT') this.loadReview();
    } catch (e) { this.setData({ loading: false, errorMessage: e.message || '加载训练失败' }); }
  },
  onExplanationInput(e) { this.setData({ explanation: e.detail.value }); },
  onRetellInput(e) { this.setData({ retell: e.detail.value }); },
  onVariantAnswerInput(e) { this.setData({ variantAnswer: e.detail.value }); },
  onVariantReasoningInput(e) { this.setData({ variantReasoning: e.detail.value }); },
  onReviewAnswerInput(e) { this.setData({ reviewAnswer: e.detail.value }); },
  onReviewReasoningInput(e) { this.setData({ reviewReasoning: e.detail.value }); },
  selectVariant(e) { this.setData({ currentVariantId: String(e.currentTarget.dataset.id || ''), variantAnswer: '', variantReasoning: '' }); },
  async submitExplanation() {
    if (this.data.submitting || !String(this.data.explanation || '').trim()) return;
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const data = await cloud.call('submitHardProblemExplanation', { taskId: this.data.taskId, answer: this.data.explanation, sessionVersion: this.data.session && this.data.session.sessionVersion, requestId: requestId('explain') }, 30000);
      this.setData({ session: data.session, feedback: data.feedback || '', currentHint: data.hint || '', explanation: '', submitting: false });
    } catch (e) { this.setData({ submitting: false, errorMessage: e.message || '提交失败' }); }
  },
  async submitRetell() {
    if (this.data.submitting || !String(this.data.retell || '').trim()) return;
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const data = await cloud.call('submitHardProblemRetell', { taskId: this.data.taskId, retell: this.data.retell, sessionVersion: this.data.session && this.data.session.sessionVersion, requestId: requestId('retell') }, 60000);
      const variants = Array.isArray(data.variants) ? data.variants : [];
      this.setData({ session: data.session, feedback: data.feedback || '', variants, currentVariantId: ((variants[0] || {}).variantId || ''), retell: '', submitting: false });
    } catch (e) { this.setData({ submitting: false, errorMessage: e.message || '提交失败' }); }
  },
  async submitVariant() {
    const id = this.data.currentVariantId;
    if (this.data.submitting || !id || !String(this.data.variantAnswer || '').trim() || !String(this.data.variantReasoning || '').trim()) return;
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const data = await cloud.call('submitHardProblemVariant', { taskId: this.data.taskId, variantId: id, answer: this.data.variantAnswer, reasoning: this.data.variantReasoning, sessionVersion: this.data.session && this.data.session.sessionVersion, requestId: requestId('variant') }, 40000);
      const variants = data.variants || [];
      this.setData({ session: data.session, feedback: data.feedback || '', variants, currentVariantId: ((variants.find(v => v.status !== 'COMPLETED') || {}).variantId || ''), variantAnswer: '', variantReasoning: '', submitting: false });
      if (data.session && data.session.reachedL4Ever && data.session.currentRetentionStatus !== 'NEEDS_REINFORCEMENT') this.loadReview();
    } catch (e) { this.setData({ submitting: false, errorMessage: e.message || '提交失败' }); }
  },
  async loadReview() {
    try {
      const review = await cloud.call('getHardProblemReview', { taskId: this.data.taskId }, 40000);
      this.setData({ review });
    } catch (e) { this.setData({ errorMessage: e.message || '复习计划加载失败' }); }
  },
  async submitReview() {
    const r = this.data.review;
    if (this.data.submitting || !(r && r.due) || !String(this.data.reviewAnswer || '').trim() || !String(this.data.reviewReasoning || '').trim()) return;
    this.setData({ submitting: true, errorMessage: '' });
    try {
      const data = await cloud.call('submitHardProblemReview', { taskId: this.data.taskId, challengeId: r.challenge.challengeId, answer: this.data.reviewAnswer, reasoning: this.data.reviewReasoning, sessionVersion: this.data.session && this.data.session.sessionVersion, requestId: requestId('review') }, 40000);
      wx.showToast({ title: data.passed ? '复习通过' : '需要继续巩固', icon: 'none' });
      this.setData({ submitting: false, session: data.session || this.data.session, reviewAnswer: '', reviewReasoning: '', feedback: data.feedback || '' });
      await this.loadReview();
    } catch (e) { this.setData({ submitting: false, errorMessage: e.message || '复习提交失败' }); }
  }
});
