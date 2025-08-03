// ui-components.ts - 进度条、侧边栏等UI组件

import { TrackPoint, TrackSegment, ColorMode } from './types';
import { turboColormap } from './utils';
import { calculateSpeedsWithPercentiles } from './track-parser';

// 渲染轨迹进度条（SVG）——只用可见分段的点
export function renderTrackProgressBar(
  container: HTMLElement,
  points: TrackPoint[],
  colorMode: ColorMode,
  currentIndexCallback: (index: number) => void
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
  
  const H = isMobile ? 90 : 100;
  const margin = isMobile 
    ? { left: 18, right: 18, top: 18, bottom: 24 } 
    : { left: 40, right: 40, top: 22, bottom: 28 };
  
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
    minV = speedData.minV;
    maxV = speedData.maxV;
  }
  
  for (let i = 0; i < N - 1; i++) {
    const x1 = margin.left + ((W - margin.left - margin.right) * i) / (N - 1);
    const x2 = margin.left + ((W - margin.left - margin.right) * (i + 1)) / (N - 1);
    
    let color = '#007bff';
    if (colorMode === 'speed') {
      let norm = (maxV > minV) ? (speeds[i] - minV) / (maxV - minV) : 0;
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
  
  // 4. 当前点高亮 + 速度显示
  let currentIdx = 0;
  
  // 速度文本（SVG外部div，便于响应式）
  let speedDiv = document.createElement('div');
  speedDiv.style.textAlign = 'center';
  speedDiv.style.fontSize = isMobile ? '15px' : '14px';
  speedDiv.style.fontWeight = 'bold';
  speedDiv.style.marginBottom = isMobile ? '2px' : '4px';
  speedDiv.style.color = '#1976d2';
  speedDiv.style.fontFamily = 'monospace';
  speedDiv.style.whiteSpace = 'nowrap';
  speedDiv.style.overflow = 'hidden';
  speedDiv.style.textOverflow = 'ellipsis';
  container.appendChild(speedDiv);
  
  const drawCursor = (idx: number) => {
    // 移除旧的
    const old = svg.querySelector('#track-cursor');
    if (old) old.remove();
    
    const x = margin.left + ((W - margin.left - margin.right) * idx) / (N - 1);
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cursor.setAttribute('id', 'track-cursor');
    cursor.setAttribute('cx', x.toString());
    
    let y = margin.top + polyH;
    if (maxAlt > minAlt) {
      y = margin.top + polyH - ((points[idx].altitude - minAlt) / (maxAlt - minAlt)) * polyH;
    }
    
    cursor.setAttribute('cy', y.toString());
    cursor.setAttribute('r', isMobile ? '5' : '6.5');
    cursor.setAttribute('fill', '#fff');
    cursor.setAttribute('stroke', '#dc3545');
    cursor.setAttribute('stroke-width', isMobile ? '2' : '2.5');
    cursor.setAttribute('opacity', '0.98');
    svg.appendChild(cursor);
  };
  
  // 速度计算函数
  const getSpeedText = (idx: number): string => {
    if (idx <= 0 || idx >= N) return '-- km/h';
    
    const p1 = points[idx - 1], p2 = points[idx];
    const dt = p2.timestamp - p1.timestamp;
    
    if (dt === 0) return '0.00 km/h';
    
    // 使用哈弗辛公式计算球面距离
    const R = 6371e3; // 地球半径（米）
    const φ1 = p1.latitude * Math.PI / 180;
    const φ2 = p2.latitude * Math.PI / 180;
    const Δφ = (p2.latitude - p1.latitude) * Math.PI / 180;
    const Δλ = (p2.longitude - p1.longitude) * Math.PI / 180;
    
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c; // 距离（米）
    
    let v = (dist / 1000) / (dt / 3600); // m/s -> km/h
    return `${v.toFixed(2)}`;
  };
  
  // 累计距离计算函数
  const getCumulativeDistance = (idx: number): string => {
    if (idx < 0 || idx >= N || N < 2) return '0.00';
    
    let totalDistance = 0;
    const R = 6371e3; // 地球半径（米）
    
    for (let i = 1; i <= idx; i++) {
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
    
    return (totalDistance / 1000).toFixed(2);
  };

  const updateSpeed = (idx: number) => {
    const speed = getSpeedText(idx);
    const distance = getCumulativeDistance(idx);
    speedDiv.innerHTML = `速度：${speed} km/h · 累计：${distance} km`;
  };
  
  drawCursor(currentIdx);
  updateSpeed(currentIdx);
  
  // 5. 交互：点击/拖动
  let dragging = false;
  
  const getIdxFromEvent = (evt: MouseEvent | TouchEvent): number => {
    let clientX: number;
    if ('touches' in evt) {
      clientX = evt.touches[0].clientX;
    } else {
      clientX = evt.clientX;
    }
    
    const rect = svg.getBoundingClientRect();
    // 计算实际SVG宽度比例，保证触摸点和SVG坐标一致
    const scale = rect.width / W;
    let x = (clientX - rect.left) / scale;
    x = Math.max(margin.left, Math.min(W - margin.right, x));
    
    let idx = Math.round(((x - margin.left) / (W - margin.left - margin.right)) * (N - 1));
    idx = Math.max(0, Math.min(N - 1, idx));
    
    return idx;
  };
  
  const updateAll = (idx: number) => {
    currentIdx = idx;
    drawCursor(idx);
    updateSpeed(idx);
    currentIndexCallback(idx);
  };
  
  svg.addEventListener('mousedown', (e) => { 
    dragging = true; 
    updateAll(getIdxFromEvent(e)); 
  });
  
  svg.addEventListener('touchstart', (e) => { 
    dragging = true; 
    updateAll(getIdxFromEvent(e)); 
  });
  
  window.addEventListener('mousemove', (e) => { 
    if (dragging) updateAll(getIdxFromEvent(e)); 
  });
  
  window.addEventListener('touchmove', (e) => { 
    if (dragging) {
      e.preventDefault();
      updateAll(getIdxFromEvent(e));
    }
  }, { passive: false });
  
  window.addEventListener('mouseup', () => { 
    dragging = false; 
  });
  
  window.addEventListener('touchend', () => { 
    dragging = false; 
  });
  
  svg.addEventListener('click', (e) => { 
    updateAll(getIdxFromEvent(e)); 
  });
  
  // 首次渲染时同步地图
  updateAll(0);
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
    const durText = dur > 0 ? (dur < 60 ? `${dur}分` : `${Math.floor(dur/60)}时${dur%60}分`) : '--';
    
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