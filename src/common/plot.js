/* =========================================================
 * 拖动折叠用的坐标平移（ES5 语法）
 *
 * 语义必须记清楚，这里写错过一次：拖动中图元靠"图层的 left/top 偏移"移动，
 * 视觉位置 = 图元坐标 + 图层偏移。折叠时视口原点 ox 前进了 dx，图层偏移
 * 归零，所以图元坐标必须变成 `原坐标 + dx`，才能让"坐标 + 0"仍然等于
 * 原来的"坐标 + dx"。⚠️ 符号写反的话，每次折叠会反向跳 2*dx（240px），
 * 曲线和网格还会朝相反方向撕裂。tools/plot.test.mjs 里有针对这个的回归测试。
 * ========================================================= */

function num(px) {
  var v = parseInt(px, 10)
  return isFinite(v) ? v : 0
}

/* 隐藏的图元用 left/top 为负的占位符表示，平移时必须原样跳过 */
function visible(item) {
  return num(item.s.left) > -20
}

/* 只有 left 的（竖网格线） */
export function shiftLeft(list, dx) {
  var out = []
  for (var i = 0; i < list.length; i++) {
    var it = list[i]
    if (!visible(it)) { out.push(it); continue }
    out.push({ s: { left: Math.round(num(it.s.left) + dx) + 'px' } })
  }
  return out
}

/* 只有 top 的（横网格线） */
export function shiftTop(list, dy) {
  var out = []
  for (var i = 0; i < list.length; i++) {
    var it = list[i]
    if (!visible(it)) { out.push(it); continue }
    out.push({ s: { top: Math.round(num(it.s.top) + dy) + 'px' } })
  }
  return out
}

/* left + top 都有的（刻度文字、零点标记） */
export function shiftBoth(list, dx, dy) {
  var out = []
  for (var i = 0; i < list.length; i++) {
    var it = list[i]
    if (!visible(it)) { out.push(it); continue }
    var rec = { s: { left: Math.round(num(it.s.left) + dx) + 'px', top: Math.round(num(it.s.top) + dy) + 'px' } }
    if (it.txt !== undefined) { rec.txt = it.txt }
    out.push(rec)
  }
  return out
}

export { num as toPx }

/* =========================================================
 * 折线笔触布局（ES5 语法）
 *
 * 背景：Vela 没有 canvas，曲线只能用 DOM 圆点沿折线叠压出来，
 * 而圆点池容量固定。早期实现是画满 CAP_PEN 个点就丢弃剩余路径，
 * 结果是多周期曲线在屏幕中间凭空消失一小段 —— 一个只在真机上
 * 看得见、构建完全静默的 bug。
 *
 * 做法规矩：
 *   1. 沿真实折线的**弧长**布点，不再给每个采样段预留点。
 *      预留过一次，代价很惨：COLS=90 就有 90 段，90 个点瞬间吃掉预算，
 *      剩下的只够把间距拉到 17px（点才 7px 宽），曲线就"线成点了"。
 *   2. 按区域分配步长：可见区内用想要的小步长，**外扩区（只在拖动途中
 *      才看得到）直接用采样点本身**。可见区占总路径 56%，预算却要 100%
 *      的质量，只能这么分。
 *   3. 真的超预算时整体等比放宽，宁可点稀，绝不断线；端点永远保留。
 * ========================================================= */

var MARGIN_FACTOR = 3   /* 外扩区的步长是可见区的几倍 */

/* pts: [{x, y}] 或 null（断笔）
 * win: {x0, x1} 可见窗口；不传则全路径用同一步长
 * 返回 [{x, y}]，长度 <= cap */
export function walkPens(pts, stepWanted, cap, win) {
  var i, p, prev, dx, dy, d

  /* ---- 第一遍：量窗口内/外的路径长度 ---- */
  var lenIn = 0
  var lenOut = 0
  prev = null
  for (i = 0; i < pts.length; i++) {
    p = pts[i]
    if (p === null) { prev = null; continue }
    if (prev !== null) {
      dx = p.x - prev.x
      dy = p.y - prev.y
      d = Math.sqrt(dx * dx + dy * dy)
      if (inWindow((prev.x + p.x) / 2, win)) { lenIn += d } else { lenOut += d }
    }
    prev = p
  }

  /* ---- 预算：超了就整体等比放宽 ---- */
  var stepIn = stepWanted
  var stepOut = win ? stepWanted * MARGIN_FACTOR : stepWanted
  var avail = cap - 2
  if (avail < 1) { avail = 1 }
  var need = lenIn / stepIn + lenOut / stepOut
  if (need > avail) {
    var f = need / avail
    stepIn *= f
    stepOut *= f
  }

  /* ---- 第二遍：按弧长布点 ---- */
  var out = []
  i = 0
  while (i < pts.length) {
    /* 跳过断笔，取出一段连续折线 */
    while (i < pts.length && pts[i] === null) { i++ }
    var start = i
    while (i < pts.length && pts[i] !== null) { i++ }
    if (i <= start) { break }
    if (i - start < 2) {
      if (i - start === 1 && out.length < cap) { out.push({ x: pts[start].x, y: pts[start].y }) }
      continue
    }

    /* 段首必留 */
    if (out.length < cap) { out.push({ x: pts[start].x, y: pts[start].y }) }

    var since = 0                     /* 距上一个落点已走过的距离 */
    prev = pts[start]
    for (var k = start + 1; k < i; k++) {
      var q = pts[k]
      dx = q.x - prev.x
      dy = q.y - prev.y
      d = Math.sqrt(dx * dx + dy * dy)
      if (d > 0) {
        var inW = inWindow((prev.x + q.x) / 2, win)
        var pos = 0                   /* 沿本段已走的距离 */
        while (true) {
          var step = inW ? stepIn : stepOut
          var remain = d - pos
          if (since + remain < step) { break }
          pos += (step - since)
          since = 0
          var t = pos / d
          if (out.length < cap) {
            out.push({ x: prev.x + dx * t, y: prev.y + dy * t })
          }
          if (pos >= d) { break }
        }
        since += d - pos
      }
      prev = q
    }

    /* 段尾必留：保证曲线不会在最后一点前断开 */
    var endPt = pts[i - 1]
    if (out.length < cap) {
      var last = out[out.length - 1]
      if (!last || last.x !== endPt.x || last.y !== endPt.y) {
        out.push({ x: endPt.x, y: endPt.y })
      }
    }
  }
  return out
}

function inWindow(x, win) {
  if (!win) { return true }
  return x >= win.x0 && x <= win.x1
}

