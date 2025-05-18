// gpx-viewer.js
// WebComponent: <gpx-viewer>
// 支持多实例、setGpx(gpxString)、reset()、事件、Shadow DOM 样式隔离

class GPXViewer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._gpxString = null;
    this._map = null;
    this._currentPoints = [];
    this._currentFullTrackGeoJSON = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
    this._currentColorMode = 'speed';
    this._slider = null;
    this._timestampDisplay = null;
    this._dropPromptMessage = null;
    this._fileInput = null;
    this._colorModeSelect = null;
    this._mapContainer = null;
    this._mapLoaded = false;
    this._initDOM();
  }

  connectedCallback() {
    this._initMap();
  }

  disconnectedCallback() {
    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  // 外部接口：传入gpx字符串
  setGpx(gpxString) {
    this._gpxString = gpxString;
    const newRawData = this._parseGPXToRawTrackData(gpxString);
    if (newRawData !== null) {
      this._loadTrackDataOnMap(newRawData);
      this.dispatchEvent(new CustomEvent('gpx-loaded'));
    } else {
      this._timestampDisplay.textContent = "GPX 解析失败";
      this._slider.disabled = true;
      this._mapContainer.classList.add('no-track');
      this._dropPromptMessage.textContent = "GPX 解析失败，请检查文件并重试\n或点击此处选择另一个文件";
      this.dispatchEvent(new CustomEvent('gpx-error'));
    }
  }

  // 外部接口：重置
  reset() {
    this._gpxString = null;
    this._currentPoints = [];
    this._currentFullTrackGeoJSON = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
    this._slider.value = 0;
    this._slider.max = 0;
    this._slider.disabled = true;
    this._timestampDisplay.textContent = "未加载数据";
    this._mapContainer.classList.add('no-track');
    this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
    if (this._mapLoaded) {
      this._map.getSource('full-track').setData(this._currentFullTrackGeoJSON);
      this._map.getSource('arrow-points').setData({ type: 'FeatureCollection', features: [] });
      this._map.getSource('track-segments').setData({ type: 'FeatureCollection', features: [] });
      this._updateMapForIndex(0);
    }
  }

  // 属性支持（可选）
  static get observedAttributes() { return ['gpx']; }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'gpx' && newValue) {
      this.setGpx(newValue);
    }
  }

  // 初始化Shadow DOM结构和样式
  _initDOM() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.1.0/dist/maplibre-gl.css">
      <style>
        :host { display: block; position: relative; width: 100%; height: 100%; }
        .map { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #f0f0f0; }
        .controls { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(255,255,255,0.9); padding: 10px 20px; border-radius: 8px; z-index: 1; display: flex; align-items: center; gap: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .controls label { font-family: sans-serif; font-size: 14px; }
        .slider { width: 300px; }
        .timestamp { font-family: monospace; font-size: 13px; min-width: 180px; padding: 5px; background: #f8f9fa; border-radius: 4px; }
        .drop-prompt { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,255,255,0.95); padding: 25px 30px; border-radius: 10px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 1.3em; color: #333; text-align: center; z-index: 10; pointer-events: auto; display: none; box-shadow: 0 4px 15px rgba(0,0,0,0.1); cursor: pointer; transition: background-color 0.2s, transform 0.1s; }
        .drop-prompt:hover { background: #fff; transform: translate(-50%, -50%) scale(1.02); }
        .drop-prompt:active { transform: translate(-50%, -50%) scale(0.98); }
        .map.no-track .drop-prompt { display: block; }
        .file-input { display: none; }
        .color-mode-select { font-size: 14px; padding: 3px 8px; border-radius: 4px; border: 1px solid #ccc; margin-left: 8px; }
      </style>
      <div class="map no-track">
        <div class="drop-prompt">请拖放 GPX 文件到地图区域<br>或点击此处选择文件</div>
      </div>
      <div class="controls">
        <label>轨迹进度:</label>
        <input type="range" class="slider" min="0" value="0" step="1" disabled />
        <div class="timestamp">未加载数据</div>
        <label style="margin-left:16px;">轨迹颜色:</label>
        <select class="color-mode-select">
          <option value="fixed">固定颜色</option>
          <option value="speed" selected>速度模式</option>
          <option value="time">时间模式</option>
        </select>
      </div>
      <input type="file" class="file-input" accept=".gpx" />
    `;
    this._mapContainer = this.shadowRoot.querySelector('.map');
    this._dropPromptMessage = this.shadowRoot.querySelector('.drop-prompt');
    this._slider = this.shadowRoot.querySelector('.slider');
    this._timestampDisplay = this.shadowRoot.querySelector('.timestamp');
    this._fileInput = this.shadowRoot.querySelector('.file-input');
    this._colorModeSelect = this.shadowRoot.querySelector('.color-mode-select');
    // 事件绑定
    this._colorModeSelect.addEventListener('change', () => {
      this._currentColorMode = this._colorModeSelect.value;
      this._updateTrackSegmentsLayer();
    });
    this._dropPromptMessage.addEventListener('click', () => this._fileInput.click());
    this._fileInput.addEventListener('change', (event) => {
      if (event.target.files && event.target.files.length > 0) {
        this._processSelectedFile(event.target.files[0]);
      }
    });
    // 拖拽
    this._mapContainer.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); this._mapContainer.classList.add('dragover'); this._dropPromptMessage.textContent = "松开以加载 GPX 文件"; });
    this._mapContainer.addEventListener('dragleave', e => { e.preventDefault(); e.stopPropagation(); this._mapContainer.classList.remove('dragover'); if (this._currentPoints.length === 0) this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件"; });
    this._mapContainer.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); this._mapContainer.classList.remove('dragover'); this._dropPromptMessage.textContent = "正在处理 GPX 文件..."; if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { this._processSelectedFile(e.dataTransfer.files[0]); } else { if (this._currentPoints.length === 0) this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件"; } });
    this._slider.addEventListener('input', e => { const index = parseInt(e.target.value); this._updateMapForIndex(index); });
  }

  // 动态加载 maplibre-gl（如未加载）
  _ensureMaplibreLoaded() {
    if (window.maplibregl) return Promise.resolve();
    if (window._gpxViewerMaplibreLoading) return window._gpxViewerMaplibreLoading;
    window._gpxViewerMaplibreLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@4.1.0/dist/maplibre-gl.js';
      script.onload = () => resolve();
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window._gpxViewerMaplibreLoading;
  }

  _initMap() {
    this._ensureMaplibreLoaded().then(() => {
      this._map = new maplibregl.Map({
        container: this._mapContainer,
        style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [139.767, 35.681],
        zoom: 5
      });
      this._map.on('load', () => this._onMapLoaded());
      this._map.on('error', (e) => {
        if (e.error && e.error.status === 403 && e.url && e.url.includes('openfreemap.org')) {
          alert("无法加载 OpenFreeMap 瓦片。请检查网络连接或瓦片服务状态。");
        } else if (e.error) {
          alert("加载地图时出错: " + (e.error.message || "未知错误"));
        }
      });
      this._map.on('zoomend', () => {
        if (this._currentPoints && this._currentPoints.length > 1 && this._map.getSource('arrow-points')) {
          const arrowFeatures = this._generateArrowFeatures(this._currentPoints, this._map.getZoom());
          this._map.getSource('arrow-points').setData(arrowFeatures);
        }
      });
    });
  }

  _onMapLoaded() {
    this._mapLoaded = true;
    this._mapContainer.classList.add('no-track');
    this._map.addSource('full-track', { type: 'geojson', data: this._currentFullTrackGeoJSON });
    this._map.addLayer({ id: 'full-track-line', type: 'line', source: 'full-track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#007bff', 'line-width': 5, 'line-opacity': 0.8 } });
    this._map.addSource('highlighted-segment', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
    this._map.addLayer({ id: 'highlighted-segment-line', type: 'line', source: 'highlighted-segment', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFD700', 'line-width': 7, 'line-opacity': 0.85 } });
    // 箭头图标
    const arrowUpSvgString = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><polygon points="6,0 12,9 0,9" fill="currentColor"/></svg>`;
    const img = new Image(16, 16);
    img.onload = () => {
      this._map.addImage('arrow-icon', img, { sdf: true });
      this._map.addSource('arrow-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this._map.addLayer({ id: 'gpx-arrows', type: 'symbol', source: 'arrow-points', layout: { 'icon-image': 'arrow-icon', 'icon-size': 0.7, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': '#003399', 'icon-opacity': 0.85 } }, 'travelled-track-line');
    };
    img.onerror = (e) => { console.error("Failed to load arrow SVG for map icon.", e); };
    img.src = 'data:image/svg+xml;base64,' + btoa(arrowUpSvgString);
    this._map.addSource('travelled-track', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
    this._map.addLayer({ id: 'travelled-track-line', type: 'line', source: 'travelled-track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#28a745', 'line-width': 6, 'line-opacity': 0.9 } });
    this._map.addSource('current-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this._map.addLayer({ id: 'current-point-marker', type: 'circle', source: 'current-point', paint: { 'circle-radius': 8, 'circle-color': '#dc3545', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
    this._map.addSource('track-segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this._map.addLayer({ id: 'track-segments-line', type: 'line', source: 'track-segments', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.95 } }, 'full-track-line');
    this._map.setLayoutProperty('track-segments-line', 'visibility', 'none');
    this._timestampDisplay.textContent = "请拖放 GPX 文件";
    this._slider.disabled = true;
    this._slider.value = 0;
    this._slider.max = 0;
    // 悬浮弹窗
    let trackPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });
    const handleTrackHoverLayer = (layerId) => {
      this._map.on('mousemove', layerId, (e) => {
        if (!this._currentPoints || this._currentPoints.length < 2) { if (trackPopup.isOpen()) trackPopup.remove(); this._map.getCanvas().style.cursor = ''; return; }
        this._map.getCanvas().style.cursor = 'pointer';
        const mouseLngLat = e.lngLat;
        let closestSegment = null;
        let minDistanceSqToMidpoint = Infinity;
        for (let i = 0; i < this._currentPoints.length - 1; i++) {
          const p1 = this._currentPoints[i];
          const p2 = this._currentPoints[i + 1];
          if (!p1 || !p2 || typeof p1.longitude !== 'number' || typeof p1.latitude !== 'number' || typeof p2.longitude !== 'number' || typeof p2.latitude !== 'number') continue;
          const midLng = (p1.longitude + p2.longitude) / 2;
          const midLat = (p1.latitude + p2.latitude) / 2;
          const distLat = midLat - mouseLngLat.lat;
          const distLng = midLng - mouseLngLat.lng;
          const distanceSq = distLat * distLat + distLng * distLng;
          if (distanceSq < minDistanceSqToMidpoint) { minDistanceSqToMidpoint = distanceSq; closestSegment = { p1, p2, index: i }; }
        }
        if (closestSegment) {
          const { p1, p2 } = closestSegment;
          const timeDiffSeconds = p2.timestamp - p1.timestamp;
          const distanceMeters = this._calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          if (this._map.getSource('highlighted-segment')) {
            this._map.getSource('highlighted-segment').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[p1.longitude, p1.latitude, p1.altitude], [p2.longitude, p2.latitude, p2.altitude]] }, properties: {} });
          }
          let speedKmphText = "---";
          if (timeDiffSeconds > 0) {
            const speedKmph = (distanceMeters / 1000) / (timeDiffSeconds / 3600);
            speedKmphText = `${speedKmph.toFixed(2)} km/h`;
          } else if (timeDiffSeconds === 0) {
            if (distanceMeters > 0) speedKmphText = "瞬时移动"; else speedKmphText = "0.00 km/h (静止)";
          } else { speedKmphText = "数据错误"; }
          const segmentStartTime = new Date(p1.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
          const segmentEndTime = new Date(p2.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
          const segmentDuration = Math.abs(timeDiffSeconds);
          const popupContent = `<div style=\"font-family: sans-serif; font-size: 0.9em; line-height: 1.4;\"><strong>轨迹段信息</strong><br>时段: ${segmentStartTime} - ${segmentEndTime}<br>时长: ${segmentDuration.toFixed(1)} 秒<br>距离: ${distanceMeters.toFixed(1)} 米<br>速度: ${speedKmphText}</div>`;
          trackPopup.setLngLat(mouseLngLat).setHTML(popupContent).addTo(this._map);
        } else {
          if (trackPopup.isOpen()) trackPopup.remove();
          if (this._map.getSource('highlighted-segment')) {
            this._map.getSource('highlighted-segment').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
          }
        }
      });
      this._map.on('mouseleave', layerId, () => {
        if (trackPopup.isOpen()) trackPopup.remove();
        this._map.getCanvas().style.cursor = '';
        if (this._map.getSource('highlighted-segment')) {
          this._map.getSource('highlighted-segment').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
        }
      });
    };
    handleTrackHoverLayer('full-track-line');
    handleTrackHoverLayer('track-segments-line');
  }

  // 解析GPX字符串为raw track数据
  _parseGPXToRawTrackData(gpxString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxString, "text/xml");
    const newRawData = [];
    const parseError = xmlDoc.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
      console.error("GPX parsing error:", parseError[0].textContent);
      alert("GPX 文件解析失败。请检查文件格式。\n错误详情: " + parseError[0].textContent);
      return null;
    }
    const trkpts = xmlDoc.querySelectorAll('trkpt');
    if (trkpts.length === 0) {
      console.warn("GPX 文件中未找到 <trkpt> 元素。");
      alert("GPX 文件中未找到有效的轨迹点 (<trkpt>)。");
      return [];
    }
    trkpts.forEach((trkpt, index) => {
      const latAttr = trkpt.getAttribute('lat');
      const lonAttr = trkpt.getAttribute('lon');
      if (!latAttr || !lonAttr) {
        console.warn(`Trackpoint ${index + 1} 缺少经纬度属性，将被跳过。`);
        return;
      }
      const lat = parseFloat(latAttr);
      const lon = parseFloat(lonAttr);
      let ele = 0;
      const eleTag = trkpt.querySelector('ele');
      if (eleTag && eleTag.textContent) ele = parseFloat(eleTag.textContent);
      let time = null;
      const timeTag = trkpt.querySelector('time');
      if (timeTag && timeTag.textContent) {
        time = Math.floor(new Date(timeTag.textContent).getTime() / 1000);
      } else {
        console.warn(`Trackpoint ${index + 1} (Lat: ${lat}, Lon: ${lon}) 缺少时间信息，将被跳过。`);
        return;
      }
      if (!isNaN(lat) && !isNaN(lon) && time !== null && !isNaN(time)) {
        newRawData.push({
          timestamp: time,
          latitude_scaled_1e5: Math.round(lat * 1e5),
          longitude_scaled_1e5: Math.round(lon * 1e5),
          altitude_m_scaled_1e1: Math.round(ele * 1e1)
        });
      } else {
        console.warn(`跳过无效的轨迹点数据: Lat=${lat}, Lon=${lon}, Time=${time}, Ele=${ele}`);
      }
    });
    if (newRawData.length === 0 && trkpts.length > 0) {
      alert("GPX 文件中的轨迹点均无效或缺少必要信息 (有效的经纬度、时间)。");
    }
    return newRawData;
  }

  // 轨迹数据预处理
  _processTrackData(rawData) {
    if (!rawData || rawData.length === 0) {
      return {
        points: [],
        fullTrackGeoJSON: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }
      };
    }
    const sortedRawData = rawData.sort((a, b) => a.timestamp - b.timestamp);
    const points = sortedRawData.map(p => ({
      longitude: p.longitude_scaled_1e5 / 1e5,
      latitude: p.latitude_scaled_1e5 / 1e5,
      altitude: p.altitude_m_scaled_1e1 / 1e1,
      timestamp: p.timestamp
    }));
    const coordinates = points.map(p => [p.longitude, p.latitude, p.altitude]);
    return {
      points: points,
      fullTrackGeoJSON: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordinates },
        properties: {}
      }
    };
  }

  // 加载轨迹到地图
  _loadTrackDataOnMap(newRawTrackData) {
    const processed = this._processTrackData(newRawTrackData);
    this._currentPoints = processed.points;
    this._currentFullTrackGeoJSON = processed.fullTrackGeoJSON;
    if (this._currentPoints.length === 0) {
      this._timestampDisplay.textContent = "GPX 文件无有效轨迹数据";
      this._slider.disabled = true;
      this._slider.value = 0;
      this._slider.max = 0;
      this._mapContainer.classList.add('no-track');
      this._dropPromptMessage.textContent = "GPX 无有效数据或解析失败，请重试\n或点击此处选择另一个文件";
      if (this._map.getSource('full-track')) {
        this._map.getSource('full-track').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
      }
      if (this._map.getSource('arrow-points')) {
        this._map.getSource('arrow-points').setData({ type: 'FeatureCollection', features: [] });
      }
      if (this._map.getSource('track-segments')) {
        this._map.getSource('track-segments').setData({ type: 'FeatureCollection', features: [] });
      }
      this._updateMapForIndex(0);
      return;
    }
    this._mapContainer.classList.remove('no-track');
    this._slider.max = this._currentPoints.length - 1;
    this._slider.value = 0;
    this._slider.disabled = false;
    this._map.getSource('full-track').setData(this._currentFullTrackGeoJSON);
    this._updateMapForIndex(0);
    if (this._map.getSource('arrow-points') && this._map.style.getImage('arrow-icon')) {
      const arrowFeatures = this._generateArrowFeatures(this._currentPoints, this._map.getZoom());
      this._map.getSource('arrow-points').setData(arrowFeatures);
    } else if (this._map.getSource('arrow-points')) {
      setTimeout(() => {
        if (this._map.getSource('arrow-points') && this._map.style.getImage('arrow-icon')) {
          const arrowFeatures = this._generateArrowFeatures(this._currentPoints, this._map.getZoom());
          this._map.getSource('arrow-points').setData(arrowFeatures);
        }
      }, 500);
    }
    if (this._map.getSource('track-segments')) {
      this._updateTrackSegmentsLayer();
    }
    if (this._currentFullTrackGeoJSON.geometry.coordinates.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      this._currentFullTrackGeoJSON.geometry.coordinates.forEach(coord => {
        bounds.extend(coord.slice(0, 2));
      });
      this._map.fitBounds(bounds, { padding: 60 });
    }
  }

  // 更新地图当前点和已走轨迹
  _updateMapForIndex(index) {
    if (!this._map.loaded() || !this._map.getSource('current-point') || !this._map.getSource('travelled-track')) {
      return;
    }
    if (!this._currentPoints || this._currentPoints.length === 0 || index < 0 || index >= this._currentPoints.length) {
      if (this._currentPoints && this._currentPoints.length === 0) {
        this._timestampDisplay.textContent = "无轨迹数据";
        this._map.getSource('current-point').setData({ type: 'FeatureCollection', features: [] });
        this._map.getSource('travelled-track').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
      }
      return;
    }
    const currentPointData = this._currentPoints[index];
    this._map.getSource('current-point').setData({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [currentPointData.longitude, currentPointData.latitude] },
      properties: { timestamp: currentPointData.timestamp, altitude: currentPointData.altitude }
    });
    const travelledCoordinates = this._currentPoints.slice(0, index + 1).map(p => [p.longitude, p.latitude, p.altitude]);
    this._map.getSource('travelled-track').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: travelledCoordinates },
      properties: {}
    });
    const date = new Date(currentPointData.timestamp * 1000);
    this._timestampDisplay.textContent = `${date.toLocaleString()} (海拔: ${currentPointData.altitude.toFixed(1)}m)`;
  }

  // 箭头 bearing 计算
  _calculateBearing(lat1, lon1, lat2, lon2) {
    const toRadians = Math.PI / 180;
    const toDegrees = 180 / Math.PI;
    const y = Math.sin((lon2 - lon1) * toRadians) * Math.cos(lat2 * toRadians);
    const x = Math.cos(lat1 * toRadians) * Math.sin(lat2 * toRadians) -
      Math.sin(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.cos((lon2 - lon1) * toRadians);
    let brng = Math.atan2(y, x) * toDegrees;
    brng = (brng + 360) % 360;
    return brng;
  }

  // 经纬度距离
  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) *
      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // 动态生成箭头
  _generateArrowFeatures(trackPoints, currentZoom) {
    const features = [];
    if (!trackPoints || trackPoints.length < 2) {
      return { type: 'FeatureCollection', features: features };
    }
    const BASE_ARROW_ZOOM = 15;
    const ARROW_INTERVAL_METERS_AT_BASE_ZOOM = 250;
    const MIN_ARROW_INTERVAL_METERS = 30;
    const MAX_ARROW_INTERVAL_METERS = 2000000;
    let arrowIntervalMeters = ARROW_INTERVAL_METERS_AT_BASE_ZOOM * Math.pow(2, BASE_ARROW_ZOOM - currentZoom);
    arrowIntervalMeters = Math.max(MIN_ARROW_INTERVAL_METERS, Math.min(MAX_ARROW_INTERVAL_METERS, arrowIntervalMeters));
    let distanceSinceLastArrow = 0;
    let bearing = this._calculateBearing(trackPoints[0].latitude, trackPoints[0].longitude, trackPoints[1].latitude, trackPoints[1].longitude);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [trackPoints[0].longitude, trackPoints[0].latitude] },
      properties: { bearing }
    });
    for (let i = 1; i < trackPoints.length; i++) {
      const p1 = trackPoints[i - 1];
      const p2 = trackPoints[i];
      if (p1.longitude === p2.longitude && p1.latitude === p2.latitude) continue;
      const segmentDistance = this._calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
      const totalDistance = distanceSinceLastArrow + segmentDistance;
      if (totalDistance >= arrowIntervalMeters) {
        const arrowCount = Math.floor(totalDistance / arrowIntervalMeters);
        for (let j = 1; j <= arrowCount; j++) {
          const d = arrowIntervalMeters * j - distanceSinceLastArrow;
          const t = d / segmentDistance;
          const lat = p1.latitude + (p2.latitude - p1.latitude) * t;
          const lon = p1.longitude + (p2.longitude - p1.longitude) * t;
          const bearing = this._calculateBearing(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { bearing }
          });
        }
        distanceSinceLastArrow = totalDistance % arrowIntervalMeters;
      } else {
        distanceSinceLastArrow = totalDistance;
      }
    }
    return { type: 'FeatureCollection', features: features };
  }

  // 生成分段轨迹GeoJSON，按colorMode着色
  _generateSegmentedTrackGeoJSON(points, colorMode) {
    if (!points || points.length < 2) return { type: 'FeatureCollection', features: [] };
    const features = [];
    if (colorMode === 'fixed') {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[p1.longitude, p1.latitude, p1.altitude], [p2.longitude, p2.latitude, p2.altitude]] },
          properties: { color: '#007bff' }
        });
      }
    } else if (colorMode === 'speed') {
      let minV = Infinity, maxV = -Infinity;
      const speeds = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        const dt = p2.timestamp - p1.timestamp;
        const dist = this._calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        let v = (dt > 0) ? (dist / dt) : 0;
        speeds.push(v);
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        let norm = (maxV > minV) ? (speeds[i] - minV) / (maxV - minV) : 0;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[p1.longitude, p1.latitude, p1.altitude], [p2.longitude, p2.latitude, p2.altitude]] },
          properties: { color: this._turboColormap(norm) }
        });
      }
    } else if (colorMode === 'time') {
      const t0 = points[0].timestamp, t1 = points[points.length - 1].timestamp;
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        let norm = (t1 > t0) ? (p1.timestamp - t0) / (t1 - t0) : 0;
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[p1.longitude, p1.latitude, p1.altitude], [p2.longitude, p2.latitude, p2.altitude]] },
          properties: { color: this._turboColormap(norm) }
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  // turbo colormap: 输入0~1，输出rgb字符串
  _turboColormap(t) {
    t = Math.max(0, Math.min(1, t));
    const kRedVec4 = [0.13572138, 4.61539260, -42.66032258, 132.13108234];
    const kGreenVec4 = [0.09140261, 2.19418839, 4.84296658, -14.18503333];
    const kBlueVec4 = [0.10667330, 12.64194608, -60.58204836, 110.36276771];
    const kRedVec2 = [-152.94239396, 59.28637943];
    const kGreenVec2 = [4.27729857, 2.82956604];
    const kBlueVec2 = [-89.90310912, 27.34824973];
    const t2 = t * t;
    const t3 = t * t2;
    const t4 = t * t3;
    const t5 = t * t4;
    const r_float = kRedVec4[0] + kRedVec4[1] * t + kRedVec4[2] * t2 + kRedVec4[3] * t3 + kRedVec2[0] * t4 + kRedVec2[1] * t5;
    const g_float = kGreenVec4[0] + kGreenVec4[1] * t + kGreenVec4[2] * t2 + kGreenVec4[3] * t3 + kGreenVec2[0] * t4 + kGreenVec2[1] * t5;
    const b_float = kBlueVec4[0] + kBlueVec4[1] * t + kBlueVec4[2] * t2 + kBlueVec4[3] * t3 + kBlueVec2[0] * t4 + kBlueVec2[1] * t5;
    const r = Math.round(r_float * 255);
    const g = Math.round(g_float * 255);
    const b = Math.round(b_float * 255);
    return `rgb(${r},${g},${b})`;
  }

  // 更新分段轨迹图层
  _updateTrackSegmentsLayer() {
    if (!this._map || !this._map.getSource('track-segments')) return;
    const segGeoJSON = this._generateSegmentedTrackGeoJSON(this._currentPoints, this._currentColorMode);
    this._map.getSource('track-segments').setData(segGeoJSON);
    const showFull = this._currentColorMode === 'fixed';
    this._map.setLayoutProperty('full-track-line', 'visibility', showFull ? 'visible' : 'none');
    this._map.setLayoutProperty('track-segments-line', 'visibility', showFull ? 'none' : 'visible');
  }

  // 处理文件选择和拖拽的私有方法
  _processSelectedFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.gpx')) {
      alert('请选择一个 .gpx 文件。');
      this._dropPromptMessage.textContent = '非 GPX 文件，请选择或拖放 .gpx 文件';
      setTimeout(() => {
        if (this._currentPoints.length === 0) this._dropPromptMessage.textContent = '请拖放 GPX 文件到地图区域\n或点击此处选择文件';
      }, 2000);
      this._fileInput.value = '';
      return;
    }
    this._dropPromptMessage.textContent = '正在处理 GPX 文件...';
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        this.setGpx(e.target.result);
      } catch (error) {
        console.error('处理 GPX 文件时出错:', error);
        alert('处理 GPX 文件时发生意外错误: ' + error.message);
        this._timestampDisplay.textContent = 'GPX 加载异常';
        this._slider.disabled = true;
        this._mapContainer.classList.add('no-track');
        this._dropPromptMessage.textContent = 'GPX 加载异常，请重试\n或点击此处选择另一个文件';
      }
    };
    reader.onerror = (e) => {
      console.error('读取文件失败:', e);
      alert('读取文件失败。请检查浏览器权限或文件本身。');
      this._timestampDisplay.textContent = '文件读取错误';
      this._slider.disabled = true;
      this._mapContainer.classList.add('no-track');
      this._dropPromptMessage.textContent = '文件读取错误，请重试\n或点击此处选择另一个文件';
    };
    reader.readAsText(file);
    this._fileInput.value = '';
  }
}

customElements.define('gpx-viewer', GPXViewer);
