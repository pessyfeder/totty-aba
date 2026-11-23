// Per-goal charts (SPEC 5.5) as plain SVG. Missing replies are drawn as hollow grey marks and never counted as "No".
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k instanceof Node ? k : document.createTextNode(k));
  return n;
}
const day = (d) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const weekStart = (d) => day(d) - new Date(`${d}T00:00:00Z`).getUTCDay(); // Sunday-based week

export function weeklyPercent(points) {
  const weeks = new Map();
  for (const p of points) {
    if (!p.answered) continue; // no response is not a "No"
    const w = weekStart(p.date);
    const a = weeks.get(w) ?? { yes: 0, n: 0 };
    a.n += 1; if (p.value_bool) a.yes += 1;
    weeks.set(w, a);
  }
  return [...weeks].sort((a, b) => a[0] - b[0]).map(([w, a]) => ({ day: w, pct: Math.round((100 * a.yes) / a.n), n: a.n }));
}

export function movingAverage(vals, win = 7) {
  return vals.map((_, i) => {
    const xs = vals.slice(Math.max(0, i - win + 1), i + 1).filter((v) => v != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  });
}

const W = 640, L = 36, R = 12;

function frame(points, annotations, h) {
  const days = [...points.map((p) => day(p.date)), ...annotations.map((a) => day(a.date))];
  const lo = Math.min(...days), hi = Math.max(...days, lo + 1);
  const x = (d) => L + ((d - lo) / (hi - lo)) * (W - L - R);
  const svg = s('svg', { viewBox: `0 0 ${W} ${h}`, class: 'chart', role: 'img' });
  return { svg, x, lo, hi };
}

function markers(svg, x, annotations, h) {
  for (const a of annotations) {
    const px = x(day(a.date));
    svg.append(s('line', { x1: px, x2: px, y1: 8, y2: h - 22, class: 'phase' }, s('title', {}, `${a.date}: ${a.text}`)));
    // Wrap the full note onto several lines instead of cutting it off; flip to the left of the line near the right edge.
    const lines = [];
    let cur = '';
    for (const w of a.text.split(/\s+/)) {
      if (cur && (cur + ' ' + w).length > 22) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    const flip = px > W - 130;
    const t = s('text', { x: flip ? px - 3 : px + 3, y: 16, class: 'tick', 'text-anchor': flip ? 'end' : 'start' }, s('title', {}, `${a.date}: ${a.text}`));
    lines.slice(0, 4).forEach((ln, i) => t.append(s('tspan', { x: flip ? px - 3 : px + 3, dy: i ? 12 : 0 }, i === 3 && lines.length > 4 ? ln + '…' : ln)));
    svg.append(t);
  }
}

export function chartFor(goal, points, annotations) {
  if (!points.length) return null;
  return goal.response_type === 'yes_no' ? yesNoChart(goal, points, annotations) : durationChart(goal, points, annotations);
}

function yesNoChart(goal, points, annotations) {
  const h = 190, top = 24, base = 130;
  const { svg, x } = frame(points, annotations, h);
  const y = (pct) => base - (pct / 100) * (base - top);
  for (const t of [0, 50, 100]) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'grid-line' }), s('text', { x: 2, y: y(t) + 4, class: 'tick' }, `${t}%`));
  }
  const thr = goal.target_json?.type === 'percent_yes' ? goal.target_json.threshold : null;
  if (thr != null) svg.append(s('line', { x1: L, x2: W - R, y1: y(thr), y2: y(thr), class: 'target' }, s('title', {}, `Target ${thr}%`)));
  const weeks = weeklyPercent(points);
  if (weeks.length > 1) svg.append(s('polyline', { class: 'line', fill: 'none', points: weeks.map((w) => `${x(w.day + 3)},${y(w.pct)}`).join(' ') }));
  for (const w of weeks) svg.append(s('circle', { cx: x(w.day + 3), cy: y(w.pct), r: 4, class: 'wk' }, s('title', {}, `Week of ${new Date(w.day * 864e5).toISOString().slice(0, 10)}: ${w.pct}% yes (${w.n} replies)`)));
  // Daily dot strip
  for (const p of points) {
    const cls = !p.answered ? 'dot none' : p.value_bool ? 'dot yes' : 'dot no';
    const label = !p.answered ? 'no response' : p.value_bool ? 'Yes' : 'No';
    svg.append(s('circle', { cx: x(day(p.date)), cy: 160, r: 4, class: cls }, s('title', {}, `${p.date}: ${label}`)));
  }
  markers(svg, x, annotations, h);
  svg.setAttribute('aria-label', `${goal.title}: weekly percent yes and daily answers`);
  return svg;
}

function durationChart(goal, points, annotations) {
  const h = 190, top = 24, base = 150;
  const { svg, x } = frame(points, annotations, h);
  const thr = goal.target_json?.type === 'avg_minutes' ? goal.target_json.threshold : null;
  // Axis tops out at the largest reply (or the target), rounded up to a tidy step.
  const max = Math.max(10, thr ?? 0, ...points.filter((p) => p.answered).map((p) => p.value_minutes));
  const step = [5, 10, 15, 30, 60, 120, 240, 480].find((n) => max / n <= 5) ?? 480;
  const topVal = Math.ceil(max / step) * step;
  const y = (v) => base - (v / topVal) * (base - top);
  for (let t = 0; t <= topVal; t += step) svg.append(s('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'grid-line' }), s('text', { x: 2, y: y(t) + 4, class: 'tick' }, `${t}m`));
  if (thr != null) svg.append(s('line', { x1: L, x2: W - R, y1: y(thr), y2: y(thr), class: 'target' }, s('title', {}, `Target ${thr} min`)));
  const vals = points.map((p) => (p.answered ? p.value_minutes : null));
  const avg = movingAverage(vals);
  const pts = points.map((p, i) => (avg[i] == null ? null : `${x(day(p.date))},${y(avg[i])}`)).filter(Boolean);
  if (pts.length > 1) svg.append(s('polyline', { class: 'line', fill: 'none', points: pts.join(' ') }, s('title', {}, '7-reply moving average')));
  points.forEach((p) => {
    const cx = x(day(p.date));
    if (!p.answered) return svg.append(s('circle', { cx, cy: base + 14, r: 3, class: 'dot none' }, s('title', {}, `${p.date}: no response`)));
    svg.append(s('circle', { cx, cy: y(p.value_minutes), r: 4, class: 'dot rate' }, s('title', {}, `${p.date}: ${p.value_minutes} min`)));
  });
  markers(svg, x, annotations, h);
  svg.setAttribute('aria-label', `${goal.title}: daily minutes with moving average`);
  return svg;
}
