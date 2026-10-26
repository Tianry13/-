/* =========================================================
 * 表达式引擎（ES5 语法，供 Vela 轻量 JS 引擎执行）
 *   词法分析 -> 调度场(Shunting-Yard) -> RPN 栈式求值
 *
 * 独立成模块的原因：这三步是纯函数，可以在 node 下直接单测
 * （tools/engine.test.mjs）。真机上算错只表现为"线画歪了"，
 * 无法定位；把这一层测住，剩下的问题必然在渲染或交互。
 * ========================================================= */

export var FUNCS = {
  sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1,
  ln: 1, log: 1, lg: 1, sqrt: 1, exp: 1, abs: 1,
  floor: 1, ceil: 1, round: 1, sign: 1
}

export var PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 }

/* 错误只带 code + detail，不带文案：文案属于表现层，由页面按当前语言
   翻译（见 index.ux 的 errText）。这样引擎保持纯逻辑，单测断言 code 即可，
   换语言也不用碰这里。 */
function makeError(code, detail) {
  var e = new Error(code)
  e.code = code
  e.detail = (detail === undefined) ? '' : detail
  return e
}

export function tokenize(src) {
  var out = []
  var last = null
  var i = 0
  var n = src.length

  function push(tok, cat) {
    if (last === 'val' || last === 'rp') {
      if (cat === 'val' || cat === 'lp' || cat === 'func') {
        out.push({ t: 'op', v: '*' })
      }
    }
    out.push(tok)
    last = cat
  }

  while (i < n) {
    var ch = src.charAt(i)
    if (ch === ' ' || ch === '\t') { i++; continue }

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      var j = i
      var seenDot = false
      while (j < n) {
        var c2 = src.charAt(j)
        if (c2 >= '0' && c2 <= '9') { j++ }
        else if (c2 === '.' && !seenDot) { seenDot = true; j++ }
        else { break }
      }
      if (j < n && (src.charAt(j) === 'e' || src.charAt(j) === 'E')) {
        var k = j + 1
        if (k < n && (src.charAt(k) === '+' || src.charAt(k) === '-')) { k++ }
        if (k < n && src.charAt(k) >= '0' && src.charAt(k) <= '9') {
          while (k < n && src.charAt(k) >= '0' && src.charAt(k) <= '9') { k++ }
          j = k
        }
      }
      var num = parseFloat(src.substring(i, j))
      if (isNaN(num)) { throw makeError('badNumber') }
      push({ t: 'num', v: num }, 'val')
      i = j
      continue
    }

    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      var j2 = i
      while (j2 < n) {
        var c3 = src.charAt(j2)
        if ((c3 >= 'a' && c3 <= 'z') || (c3 >= 'A' && c3 <= 'Z')) { j2++ } else { break }
      }
      var word = src.substring(i, j2).toLowerCase()
      if (FUNCS[word]) {
        push({ t: 'func', v: word }, 'func')
      } else if (word === 'pi') {
        push({ t: 'num', v: Math.PI }, 'val')
      } else if (word === 'e') {
        push({ t: 'num', v: Math.E }, 'val')
      } else if (word === 'x' || word === 't' || word === 'a' || word === 'b' || word === 'c') {
        push({ t: 'var', v: word }, 'val')
      } else {
        throw makeError('unknownSymbol', word)
      }
      i = j2
      continue
    }
    if (ch === '\u03c0') { push({ t: 'num', v: Math.PI }, 'val'); i++; continue }

    if (ch === '+') { push({ t: 'op', v: '+' }, 'op'); i++; continue }
    if (ch === '-') { push({ t: 'op', v: '-' }, 'op'); i++; continue }
    if (ch === '*' || ch === '\u00d7' || ch === '\u00b7') { push({ t: 'op', v: '*' }, 'op'); i++; continue }
    if (ch === '/' || ch === '\u00f7') { push({ t: 'op', v: '/' }, 'op'); i++; continue }
    if (ch === '^') { push({ t: 'op', v: '^' }, 'op'); i++; continue }
    if (ch === '(') { push({ t: 'lp' }, 'lp'); i++; continue }
    if (ch === ')') { push({ t: 'rp' }, 'rp'); i++; continue }

    throw makeError('illegalChar', ch)
  }
  if (!out.length) { throw makeError('empty') }
  return out
}

export function toRPN(tokens) {
  var out = []
  var stack = []
  var prev = 'start'

  for (var i = 0; i < tokens.length; i++) {
    var tk = tokens[i]

    if (tk.t === 'num' || tk.t === 'var') {
      out.push(tk)
      prev = 'val'
    } else if (tk.t === 'func') {
      stack.push(tk)
      prev = 'func'
    } else if (tk.t === 'op') {
      var v = tk.v
      if (v === '-' && (prev === 'start' || prev === 'op' || prev === 'lp' || prev === 'func' || prev === 'u')) {
        stack.push({ t: 'u' })
        prev = 'op'
        continue
      }
      while (stack.length) {
        var top = stack[stack.length - 1]
        if (top.t === 'lp') { break }
        if (top.t === 'func') { out.push(stack.pop()); continue }
        var pTop = (top.t === 'u') ? 3 : PREC[top.v]
        var pCur = PREC[v]
        var curRight = (v === '^')
        if (pTop > pCur || (pTop === pCur && !curRight)) {
          out.push(stack.pop())
        } else {
          break
        }
      }
      stack.push({ t: 'op', v: v })
      prev = 'op'
    } else if (tk.t === 'lp') {
      stack.push(tk)
      prev = 'lp'
    } else if (tk.t === 'rp') {
      while (stack.length && stack[stack.length - 1].t !== 'lp') {
        out.push(stack.pop())
      }
      if (!stack.length) { throw makeError('unbalanced') }
      stack.pop()
      if (stack.length && stack[stack.length - 1].t === 'func') {
        out.push(stack.pop())
      }
      prev = 'rp'
    }
  }
  while (stack.length) {
    var t2 = stack.pop()
    if (t2.t === 'lp') { throw makeError('unbalanced') }
    out.push(t2)
  }
  return out
}

export function callFn(name, v) {
  switch (name) {
    case 'sin': return Math.sin(v)
    case 'cos': return Math.cos(v)
    case 'tan': return Math.tan(v)
    case 'asin': return Math.asin(v)
    case 'acos': return Math.acos(v)
    case 'atan': return Math.atan(v)
    case 'ln': return Math.log(v)
    case 'log': case 'lg': return Math.log(v) / Math.LN10
    case 'sqrt': return Math.sqrt(v)
    case 'exp': return Math.exp(v)
    case 'abs': return Math.abs(v)
    case 'floor': return Math.floor(v)
    case 'ceil': return Math.ceil(v)
    case 'round': return Math.round(v)
    case 'sign': return v > 0 ? 1 : (v < 0 ? -1 : 0)
  }
  return NaN
}

export function evalRPN(rpn, val, a, b, c) {
  var st = []
  for (var i = 0; i < rpn.length; i++) {
    var t = rpn[i]
    if (t.t === 'num') {
      st.push(t.v)
    } else if (t.t === 'var') {
      st.push((t.v === 'x' || t.v === 't') ? val : (t.v === 'a' ? a : (t.v === 'b' ? b : c)))
    } else if (t.t === 'u') {
      st.push(-st.pop())
    } else if (t.t === 'func') {
      st.push(callFn(t.v, st.pop()))
    } else {
      if (st.length < 2) { return NaN }
      var rb = st.pop()
      var la = st.pop()
      if (t.v === '+') { st.push(la + rb) }
      else if (t.v === '-') { st.push(la - rb) }
      else if (t.v === '*') { st.push(la * rb) }
      else if (t.v === '/') { st.push(la / rb) }
      else { st.push(Math.pow(la, rb)) }
    }
  }
  var r = st[0]
  return (typeof r === 'number') ? r : NaN
}
