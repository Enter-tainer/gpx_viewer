// ui-components.ts - 进度条、侧边栏等UI组件

import { TrackPoint, TrackSegment, ColorMode } from './types';
import { turboColormap } from './utils';
import { calculateSpeedsWithPercentiles } from './track-parser';

interface SpeedColoringConfig {
  useSegmentSpeedNormalization: boolean;
  globalSpeedRange?: { min: number; max: number } | null;
}

// 渲染轨迹进度条（SVG）——双滑块范围选择器
export function renderTrackProgressBar(
  container: HTMLElement,
  points: TrackPoint[],
  colorMode: ColorMode,
  rangeCallback: (startIndex: number, endIndex: number) => void,
  speedColoring?: SpeedColoringConfig
): void {
  container.innerHTML = '';

  if (!points || points.length === 0) return;

  const N = points.length;
  if (N < 2) return;

  // 响应式参数
  const isMobile = window.innerWidth < 600;

  // 动态获取父容器宽度
  let W = container.clientWidth;
  if (!W || W < 100) W = isMobile ? 320 : 700; // 容错

  const H = isMobile ? 120 : 140; // 增加高度以容纳统计信息
  const margin = isMobile
    ? { left: 18, right: 18, top: 18, bottom: 50 }
    : { left: 40, right: 40, top: 22, bottom: 60 };

  const barY = H - margin.bottom - 16;
  const barH = isMobile ? 10 : 12;
  const barR = isMobile ? 4 : 6;
  const polyH = H - margin.top - margin.bottom - barH - 16;

  // 创建SVG元素
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', W.toString());
  svg.setAttribute('height', H.toString());
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.display = 'block';
  svg.style.touchAction = 'pan-x';

  // 1. 彩色分段带
  let minV = 0, maxV = 0;
  let speeds: number[] = [];

  if (colorMode === 'speed') {
    const speedData = calculateSpeedsWithPercentiles(points);
    speeds = speedData.speeds;

    const useSegmentRange = speedColoring?.useSegmentSpeedNormalization;
    const globalRange = speedColoring?.globalSpeedRange || null;

    if (useSegmentRange) {
      minV = speedData.minV;
      maxV = speedData.maxV;
    } else if (globalRange && globalRange.max > globalRange.min) {
      minV = globalRange.min;
      maxV = globalRange.max;
    } else {
      minV = speedData.minV;
      maxV = speedData.maxV;
    }
  }

  for (let i = 0; i < N - 1; i++) {
    const x1 = margin.left + ((W - margin.left - margin.right) * i) / (N - 1);
    const x2 = margin.left + ((W - margin.left - margin.right) * (i + 1)) / (N - 1);

    let color = '#007bff';
    if (colorMode === 'speed') {
      let norm = (maxV > minV) ? (speeds[i] - minV) / (maxV - minV) : 0;
      if (!Number.isFinite(norm)) norm = 0;
      norm = Math.max(0, Math.min(1, norm));
      color = turboColormap(norm);
    } else if (colorMode === 'time') {
      let norm = (points[i].timestamp - points[0].timestamp) / (points[N - 1].timestamp - points[0].timestamp);
      color = turboColormap(norm);
    }

    const seg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    seg.setAttribute('x', x1.toString());
    seg.setAttribute('y', barY.toString());
    seg.setAttribute('width', Math.max(1, x2 - x1).toString());
    seg.setAttribute('height', barH.toString());
    seg.setAttribute('fill', color);
    seg.setAttribute('rx', barR.toString());
    seg.setAttribute('ry', barR.toString());
    svg.appendChild(seg);
  }

  // 2. 海拔折线图
  let minAlt = Infinity, maxAlt = -Infinity;
  for (let i = 0; i < N; i++) {
    if (points[i].altitude < minAlt) minAlt = points[i].altitude;
    if (points[i].altitude > maxAlt) maxAlt = points[i].altitude;
  }

  const polyPoints: string[] = [];
  for (let i = 0; i < N; i++) {
    const x = margin.left + ((W - margin.left - margin.right) * i) / (N - 1);
    let y = margin.top + polyH;

    if (maxAlt > minAlt) {
      y = margin.top + polyH - ((points[i].altitude - minAlt) / (maxAlt - minAlt)) * polyH;
    }

    polyPoints.push(`${x},${y}`);
  }

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', polyPoints.join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', '#1976d2');
  polyline.setAttribute('stroke-width', isMobile ? '1.5' : '2.2');
  polyline.setAttribute('opacity', '0.95');
  svg.appendChild(polyline);

  // 3. 时间刻度
  const timeStep = Math.max(1, Math.floor(N / (isMobile ? 4 : 5)));
  for (let i = 0; i < N; i += timeStep) {
    const x = margin.left + ((W - margin.left - margin.right) * i) / (N - 1);
    const t = new Date(points[i].timestamp * 1000);
    const label = t.getHours().toString().padStart(2, '0') + ':' +
      t.getMinutes().toString().padStart(2, '0');

    const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    tick.setAttribute('x1', x.toString());
    tick.setAttribute('x2', x.toString());
    tick.setAttribute('y1', (barY + barH + 2).toString());
    tick.setAttribute('y2', (barY + barH + 10).toString());
    tick.setAttribute('stroke', '#888');
    tick.setAttribute('stroke-width', '1');
    svg.appendChild(tick);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x.toString());
    text.setAttribute('y', (barY + barH + (isMobile ? 22 : 24)).toString());
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', isMobile ? '15' : '13');
    text.setAttribute('fill', '#444');
    text.setAttribute('font-family', 'monospace');
    text.textContent = label;
    svg.appendChild(text);
  }

  // 4. 范围选择高亮（使用灰色遮罩未选中区域）
  let startIdx = 0;
  let endIdx = N - 1;

  const drawRangeHighlight = (start: number, end: number) => {
    // 移除旧的遮罩
    const oldLeft = svg.querySelector('#dim-left-mask');
    const oldRight = svg.querySelector('#dim-right-mask');
    if (oldLeft) oldLeft.remove();
    if (oldRight) oldRight.remove();

    const [s, e] = [Math.min(start, end), Math.max(start, end)];

    // 左侧遮罩（未选中区域）
    if (s > 0) {
      const x1 = margin.left;
      const x2 = margin.left + ((W - margin.left - margin.right) * s) / (N - 1);

      const leftMask = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      leftMask.setAttribute('id', 'dim-left-mask');
      leftMask.setAttribute('x', x1.toString());
      leftMask.setAttribute('y', barY.toString());
      leftMask.setAttribute('width', Math.max(0, x2 - x1).toString());
      leftMask.setAttribute('height', barH.toString());
      leftMask.setAttribute('fill', 'rgba(128, 128, 128, 0.5)');
      leftMask.setAttribute('rx', barR.toString());
      leftMask.setAttribute('ry', barR.toString());
      svg.appendChild(leftMask);
    }

    // 右侧遮罩（未选中区域）
    if (e < N - 1) {
      const x1 = margin.left + ((W - margin.left - margin.right) * e) / (N - 1);
      const x2 = W - margin.right;

      const rightMask = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rightMask.setAttribute('id', 'dim-right-mask');
      rightMask.setAttribute('x', x1.toString());
      rightMask.setAttribute('y', barY.toString());
      rightMask.setAttribute('width', Math.max(0, x2 - x1).toString());
      rightMask.setAttribute('height', barH.toString());
      rightMask.setAttribute('fill', 'rgba(128, 128, 128, 0.5)');
      rightMask.setAttribute('rx', barR.toString());
      rightMask.setAttribute('ry', barR.toString());
      svg.appendChild(rightMask);
    }
  };

  // 5. 双滑块手柄
  const drawHandles = (start: number, end: number) => {
    // 移除旧的
    const oldHandles = svg.querySelectorAll('.range-handle');
    oldHandles.forEach(h => h.remove());

    const startX = margin.left + ((W - margin.left - margin.right) * start) / (N - 1);
    const endX = margin.left + ((W - margin.left - margin.right) * end) / (N - 1);

    // 开始手柄
    const startHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    startHandle.setAttribute('class', 'range-handle');
    startHandle.setAttribute('cx', startX.toString());
    startHandle.setAttribute('cy', (barY + barH / 2).toString());
    startHandle.setAttribute('r', isMobile ? '8' : '10');
    startHandle.setAttribute('fill', '#fff');
    startHandle.setAttribute('stroke', '#dc3545');
    startHandle.setAttribute('stroke-width', '3');
    startHandle.setAttribute('cursor', 'pointer');
    startHandle.setAttribute('id', 'start-handle');
    svg.appendChild(startHandle);

    // 结束手柄
    const endHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    endHandle.setAttribute('class', 'range-handle');
    endHandle.setAttribute('cx', endX.toString());
    endHandle.setAttribute('cy', (barY + barH / 2).toString());
    endHandle.setAttribute('r', isMobile ? '8' : '10');
    endHandle.setAttribute('fill', '#fff');
    endHandle.setAttribute('stroke', '#28a745');
    endHandle.setAttribute('stroke-width', '3');
    endHandle.setAttribute('cursor', 'pointer');
    endHandle.setAttribute('id', 'end-handle');
    svg.appendChild(endHandle);
  };

  // 6. 统计信息显示
  let statsDiv = document.createElement('div');
  statsDiv.className = 'track-stats';
  container.appendChild(statsDiv);

  // 计算工具函数
  const calculateRangeDistance = (start: number, end: number): number => {
    if (start < 0 || end < 0 || start >= N || end >= N || Math.abs(start - end) < 1) return 0;

    const [s, e] = [Math.min(start, end), Math.max(start, end)];
    let totalDistance = 0;
    const R = 6371e3; // 地球半径（米）

    for (let i = s + 1; i <= e; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];

      const φ1 = p1.latitude * Math.PI / 180;
      const φ2 = p2.latitude * Math.PI / 180;
      const Δφ = (p2.latitude - p1.latitude) * Math.PI / 180;
      const Δλ = (p2.longitude - p1.longitude) * Math.PI / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      totalDistance += R * c;
    }

    return totalDistance / 1000; // 转换为公里
  };

  const calculateRangeDuration = (start: number, end: number): number => {
    if (start < 0 || end < 0 || start >= N || end >= N) return 0;

    const [s, e] = [Math.min(start, end), Math.max(start, end)];
    return Math.abs(points[e].timestamp - points[s].timestamp);
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}秒`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}时${minutes}分`;
  };

  const formatTime = (timestamp: number): string => {
    const t = new Date(timestamp * 1000);
    return t.getHours().toString().padStart(2, '0') + ':' +
      t.getMinutes().toString().padStart(2, '0');
  };

  const updateStats = (start: number, end: number) => {
    const distance = calculateRangeDistance(start, end);
    const duration = calculateRangeDuration(start, end);
    const avgSpeed = duration > 0 ? (distance / (duration / 3600)) : 0;
    const startTime = formatTime(points[Math.min(start, end)].timestamp);
    const endTime = formatTime(points[Math.max(start, end)].timestamp);

    statsDiv.innerHTML = `距离: ${distance.toFixed(2)}km | ${startTime} - ${endTime} | 时长: ${formatDuration(duration)} | 均速: ${avgSpeed.toFixed(1)}km/h`;
  };

  // 初始绘制
  drawRangeHighlight(startIdx, endIdx);
  drawHandles(startIdx, endIdx);
  updateStats(startIdx, endIdx);

  // 7. 交互：拖拽手柄
  let draggingHandle: 'start' | 'end' | null = null;

  const getIdxFromEvent = (evt: MouseEvent | TouchEvent): number => {
    let clientX: number;
    if ('touches' in evt) {
      clientX = evt.touches[0].clientX;
    } else {
      clientX = evt.clientX;
    }

    const rect = svg.getBoundingClientRect();
    const scale = rect.width / W;
    let x = (clientX - rect.left) / scale;
    x = Math.max(margin.left, Math.min(W - margin.right, x));

    let idx = Math.round(((x - margin.left) / (W - margin.left - margin.right)) * (N - 1));
    idx = Math.max(0, Math.min(N - 1, idx));

    return idx;
  };

  const updateRange = (newStart: number, newEnd: number) => {
    startIdx = newStart;
    endIdx = newEnd;
    drawRangeHighlight(startIdx, endIdx);
    drawHandles(startIdx, endIdx);
    updateStats(startIdx, endIdx);
    rangeCallback(startIdx, endIdx);
  };

  // 鼠标/触摸事件处理
  const handleDown = (e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const target = e.target as SVGCircleElement;

    if (target.id === 'start-handle') {
      draggingHandle = 'start';
    } else if (target.id === 'end-handle') {
      draggingHandle = 'end';
    } else {
      // 点击空白区域，设置最近的句柄
      const idx = getIdxFromEvent(e);
      const startX = margin.left + ((W - margin.left - margin.right) * startIdx) / (N - 1);
      const endX = margin.left + ((W - margin.left - margin.right) * endIdx) / (N - 1);
      const startDist = Math.abs(startX - ((e as MouseEvent).clientX || (e as TouchEvent).touches[0].clientX));
      const endDist = Math.abs(endX - ((e as MouseEvent).clientX || (e as TouchEvent).touches[0].clientX));

      draggingHandle = startDist < endDist ? 'start' : 'end';

      if (draggingHandle === 'start') {
        updateRange(idx, endIdx);
      } else {
        updateRange(startIdx, idx);
      }
    }
  };

  const handleMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingHandle) return;

    const idx = getIdxFromEvent(e);

    if (draggingHandle === 'start') {
      updateRange(idx, endIdx);
    } else {
      updateRange(startIdx, idx);
    }
  };

  const handleUp = () => {
    draggingHandle = null;
  };

  // 绑定事件
  svg.addEventListener('mousedown', handleDown);
  svg.addEventListener('touchstart', handleDown, { passive: false });

  window.addEventListener('mousemove', handleMove);
  window.addEventListener('touchmove', handleMove, { passive: false });

  window.addEventListener('mouseup', handleUp);
  window.addEventListener('touchend', handleUp);

  // 首次渲染时同步地图
  rangeCallback(startIdx, endIdx);
  container.appendChild(svg);
}

// 渲染轨迹分段侧边栏
export function renderSegmentsSidebar(
  sidebarContentEl: HTMLElement,
  segments: TrackSegment[],
  visibilityArray: boolean[],
  toggleCallback: (index: number) => void
): void {
  if (!sidebarContentEl) return;

  // 清空内容
  sidebarContentEl.innerHTML = '';

  if (!segments || segments.length === 0) {
    sidebarContentEl.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">暂无可显示的分段</div>';
    return;
  }

  // 只显示距离>=50米的段
  const visibleSidebarSegs = segments.map((seg, idx) => ({ seg, idx }))
    .filter(({ seg }) => (seg.distance || 0) >= 50);

  if (visibleSidebarSegs.length === 0) {
    sidebarContentEl.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">暂无可显示的分段</div>';
    return;
  }

  visibleSidebarSegs.forEach(({ seg, idx }) => {
    const checked = visibilityArray[idx];

    if (!seg.startTime || !seg.endTime) return;

    const start = new Date(seg.startTime * 1000);
    const end = new Date(seg.endTime * 1000);

    const startTime = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTime = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const speed = seg.avgSpeed ? seg.avgSpeed.toFixed(1) : '--';
    const dist = seg.distance ? (seg.distance / 1000).toFixed(2) : '--';
    const dur = seg.duration ? Math.round(seg.duration / 60) : 0;
    const durText = dur > 0 ? (dur < 60 ? `${dur}分` : `${Math.floor(dur / 60)}时${dur % 60}分`) : '--';

    const typeLabel = seg.type === 'stop' ? '静止' : '移动';
    const typeClass = seg.type === 'stop' ? 'stop' : 'move';

    const segmentEl = document.createElement('div');
    segmentEl.className = `segment-item ${checked ? 'active' : ''}`;
    segmentEl.dataset.seg = idx.toString();

    segmentEl.innerHTML = `
      <div class="segment-header">
        <input type="checkbox" class="segment-checkbox" ${checked ? 'checked' : ''}>
        <div class="segment-title">分段 ${idx + 1}</div>
        <div class="segment-type ${typeClass}">${typeLabel}</div>
      </div>
      <div class="segment-details">
        <div class="segment-time">
          ${startTime} - ${endTime}
        </div>
        <div class="segment-stats">
          <div class="stat-item">
            <div class="stat-label">距离</div>
            <div class="stat-value">${dist}km</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">时长</div>
            <div class="stat-value">${durText}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">均速</div>
            <div class="stat-value">${speed}</div>
          </div>
        </div>
      </div>
    `;

    // 事件绑定
    const checkbox = segmentEl.querySelector('.segment-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleCallback(idx);
    });

    segmentEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
        toggleCallback(idx);
      }
    });

    sidebarContentEl.appendChild(segmentEl);
  });
}
