"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relaunch = exports.go = void 0;
var go = function (url) { return wx.navigateTo({ url: url }); };
exports.go = go;
var relaunch = function (url) { return wx.reLaunch({ url: url }); };
exports.relaunch = relaunch;
