/* =========================================================
 * 应用级多语言（ES5 语法）
 *
 * 为什么不用平台的 $t：核实过官方文档，Vela 的
 * `@system.configuration` **只有 getLocale()，没有 setLocale()**，
 * 运行时改不了语言环境——$t 只能跟随系统语言。要做"设置里选语言"，
 * 就必须自己在 JS 层维护一份字典和一个当前语言。
 *
 * 语言来源优先级：
 *   1. 用户在本应用设置页里选的（存 @system.storage，key = gc.lang）
 *   2. 系统语言（configuration.getLocale().language）
 *   3. 中文兜底
 *
 * 打包方式：字典直接从 src/i18n/*.json import，语言包只有一份来源，
 * 平台的 $t 也仍然可用（虽然本项目不再用它）。
 * ========================================================= */

import storage from '@system.storage'
import configuration from '@system.configuration'

import zh from '../i18n/defaults.json'
import en from '../i18n/en.json'
import el from '../i18n/el.json'

var DICTS = { zh: zh, en: en, el: el }

/* 语言的原生写法，不翻译：任何人切到任何语言都能认出自己的母语 */
export var NATIVE = { zh: '中文', en: 'English', el: 'Ελληνικά' }

/* '' = 跟随系统 */
var CODES = ['', 'zh', 'en', 'el']

var PREF_KEY = 'gc.lang'
var pref = ''
var current = 'zh'
var started = false
var loaded = false
var waiters = []

function systemLang() {
  try {
    var info = configuration.getLocale()
    var code = (info && info.language) ? String(info.language).toLowerCase() : ''
    if (DICTS[code]) { return code }
  } catch (e) { /* 取不到就兜底 */ }
  return 'zh'
}

function resolve() {
  current = DICTS[pref] ? pref : systemLang()
  return current
}

/* 模块加载时先同步解析一次，保证第一帧就已经是系统语言 */
resolve()

export function codes() { return CODES }
export function preference() { return pref }
export function locale() { return current }
export function isReady() { return loaded }
export function nativeName(code) { return NATIVE[code] || code }

function lookup(dict, key) {
  var parts = String(key).split('.')
  var cur = dict
  for (var i = 0; i < parts.length; i++) {
    if (!cur || typeof cur !== 'object') { return undefined }
    cur = cur[parts[i]]
  }
  return (typeof cur === 'string') ? cur : undefined
}

function interpolate(s, opts) {
  return s.replace(/\{(\w+)\}/g, function (m, k) {
    var v = opts[k]
    return (v === undefined || v === null) ? m : String(v)
  })
}

/* 取一条翻译；当前语言缺这条就回退中文，再缺则原样返回 key（便于发现漏翻） */
export function t(key, opts) {
  var s = lookup(DICTS[current], key)
  if (s === undefined) { s = lookup(DICTS.zh, key) }
  if (s === undefined) { return String(key) }
  return opts ? interpolate(s, opts) : s
}

/* 取整个分组（浅拷贝），给模板做数据绑定用：{{L.draw}}。
   必须走数据而不是在模板里调函数——Vela 的模板只对绑定的数据变化重渲染，
   调函数的表达式在数据没变时不会重新求值，语言切换就不会立刻生效。 */
export function section(name) {
  var src = DICTS[current][name]
  var out = {}
  if (src) {
    for (var k in src) {
      if (typeof src[k] === 'string') { out[k] = src[k] }
    }
  }
  return out
}

function flush() {
  var list = waiters
  waiters = []
  for (var i = 0; i < list.length; i++) {
    try { list[i]() } catch (e) { /* 单个页面回调失败不影响其他 */ }
  }
}

function finish() {
  if (loaded) { return }
  loaded = true
  resolve()
  flush()
}

/* 读取用户偏好。幂等；storage 回调万一不来，1.2s 后强制收尾，
   绝不让"本地读一个值"卡住语言初始化。 */
export function init() {
  if (started) { return }
  started = true
  try {
    storage.get({
      key: PREF_KEY,
      default: '',
      success: function (v) {
        pref = (v && DICTS[v]) ? v : ''
        finish()
      },
      fail: function () {
        pref = ''
        finish()
      }
    })
  } catch (e) {
    pref = ''
    finish()
  }
  setTimeout(finish, 1200)
}

/* 偏好读到之后再回调（已经读到就立刻回调） */
export function ready(fn) {
  if (loaded) {
    try { fn() } catch (e) { }
    return
  }
  waiters.push(fn)
  init()
}

/* 切换语言并持久化。传 '' 或未知值 = 跟随系统。
   内存里的 current 立刻生效，写盘失败不影响本次运行。 */
export function setPref(code) {
  pref = DICTS[code] ? code : ''
  resolve()
  try {
    storage.set({ key: PREF_KEY, value: pref, fail: function () { } })
  } catch (e) { /* 写盘失败只是下次启动回到系统语言 */ }
  return current
}

/* ---- 跨页同步 ----------------------------------------------------------
 * 这个工具链是 rspack 按页出包、没有共享运行时 chunk，所以本模块在
 * index / about / settings 里各有一份独立的模块状态。设置页改了语言，
 * 另外两个页面的那份 module 实例并不知道。$app.$def 是 Vela 里唯一
 * 同步、跨页共享的对象，用它把当前偏好镜像出去。
 * ---------------------------------------------------------------------- */

/* 把当前偏好镜像到 app 上，供其他页面读取 */
export function publish(app) {
  try {
    if (app && app.$def) { app.$def.lang = pref }
  } catch (e) { /* 拿不到 $app 就只影响跨页同步 */ }
}

/* 从 app 上取回偏好并采纳（不写盘）。返回生效中的语言代码。 */
export function syncFromApp(app) {
  try {
    var code = (app && app.$def) ? app.$def.lang : undefined
    if (code !== undefined && code !== null) {
      pref = DICTS[code] ? code : ''
      resolve()
    }
  } catch (e) { /* 忽略 */ }
  return current
}
