"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installRuntimeCompat = installRuntimeCompat;
function installRuntimeCompat() {
    var arrayPrototype = Array.prototype;
    if (!arrayPrototype.includes)
        arrayPrototype.includes = function (value, fromIndex) {
            if (fromIndex === void 0) { fromIndex = 0; }
            return this.indexOf(value, fromIndex) >= 0;
        };
    if (!arrayPrototype.find)
        arrayPrototype.find = function (predicate, thisArg) { for (var index = 0; index < this.length; index += 1)
            if (predicate.call(thisArg, this[index], index, this))
                return this[index]; return undefined; };
    if (!arrayPrototype.findIndex)
        arrayPrototype.findIndex = function (predicate, thisArg) { for (var index = 0; index < this.length; index += 1)
            if (predicate.call(thisArg, this[index], index, this))
                return index; return -1; };
    if (!Number.isNaN)
        Number.isNaN = function (value) { return typeof value === 'number' && value !== value; };
    if (!String.prototype.padStart)
        String.prototype.padStart = function (length, fill) {
            if (fill === void 0) { fill = ' '; }
            var unit = String(fill || ' ');
            var value = String(this);
            while (value.length < length)
                value = "".concat(unit).concat(value);
            return value.slice(-Math.max(length, value.length));
        };
    if (!Object.values)
        Object.values = function (value) { return Object.keys(value || {}).map(function (key) { return value[key]; }); };
    if (!Object.entries)
        Object.entries = (function (value) { return Object.keys(value || {}).map(function (key) { return [key, value[key]]; }); });
}
