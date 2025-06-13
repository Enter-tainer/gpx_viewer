// gpx-viewer.js
// WebComponent: <gpx-viewer>
// 支持多实例、setGpx(gpxString)、reset()、事件、Shadow DOM 样式隔离

class GPXViewer extends HTMLElement {
  // 静止检测常量
  static STOP_WINDOW_SIZE = 5; // 连续点数
  static STOP_SPEED_THRESHOLD_KMPH = 3; // km/h
  static STOP_MIN_DURATION_SEC = 60; // 静止区段最小持续时间（秒）
  static STOP_MAX_DISPLACEMENT_M = 30; // 静止区段最大位移（米）
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

  // 外部接口：传入 gpx 字符串
  setGpx(gpxString) {
    this._gpxString = gpxString; // 保存 gpx 字符串
    // 如果地图已经加载，则直接处理
    if (this._mapLoaded) {
      const newRawData = this._parseGPXToRawTrackData(gpxString);
      if (newRawData !== null) {
        this._loadTrackDataOnMap(newRawData);
        this.dispatchEvent(new CustomEvent('gpx-loaded'));
      } else {
        this._timestampDisplay.textContent = "GPX 解析失败";
        this._mapMainContainer.classList.add('no-track');
        this._dropPromptMessage.textContent = "GPX 解析失败，请检查文件并重试\n或点击此处选择另一个文件";
        this.dispatchEvent(new CustomEvent('gpx-error'));
      }
    }
    // 如果地图尚未加载，_onMapLoaded 会在地图加载完成后处理 this._gpxString
  }

  // 外部接口：重置
  reset() {
    this._gpxString = null;
    this._currentPoints = [];
    this._currentFullTrackGeoJSON = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} };
    this._currentSegments = [];
    this._segmentVisibility = this._currentSegments ? this._currentSegments.map(() => false) : [];
    this._timestampDisplay.textContent = "未加载数据";
    this._mapMainContainer.classList.add('no-track');
    this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
    if (this._mapLoaded) {
      this._map.getSource('full-track').setData(this._currentFullTrackGeoJSON);
      this._map.getSource('arrow-points').setData({ type: 'FeatureCollection', features: [] });
      this._map.getSource('track-segments').setData({ type: 'FeatureCollection', features: [] });
      this._updateMapForIndex(0);
    }
    if (this._progressBarContainer) {
      this._progressBarContainer.innerHTML = '';
    }
    this._hideSidebar();
  }

  // 属性支持（可选）
  static get observedAttributes() { return ['gpx']; }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'gpx' && newValue) {
      this.setGpx(newValue);
    }
  }

  // 初始化 Shadow DOM 结构和样式
  _initDOM() {
    this.shadowRoot.innerHTML = `
      <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.1.0/dist/maplibre-gl.css">
      <style>
        :host { display: block; position: relative; width: 100%; height: 100%; }
        
        .main-container { 
          display: flex; 
          width: 100%; 
          height: 100%; 
        }
        
        .map-container { 
          flex: 1; 
          position: relative; 
          background: #f0f0f0; 
          transition: all 0.3s ease;
        }
        
        .map { 
          position: absolute; 
          top: 0; 
          left: 0; 
          right: 0; 
          bottom: 0; 
        }
        
        .sidebar-container { 
          width: 0; 
          overflow: hidden; 
          transition: width 0.3s ease;
          position: relative;
        }
        
        .sidebar-container.expanded { 
          width: 380px; 
        }
        
        .sidebar { 
          width: 380px;
          height: 100%; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          overflow-y: auto; 
          position: relative;
          box-shadow: -4px 0 20px rgba(0,0,0,0.15);
        }
        
        .sidebar-header {
          background: rgba(255,255,255,0.1);
          padding: 20px 20px 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.2);
          backdrop-filter: blur(10px);
          position: sticky;
          top: 0;
          z-index: 5;
        }
        
        .sidebar-title {
          font-size: 1.4em;
          font-weight: 600;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        .sidebar-subtitle {
          font-size: 0.9em;
          opacity: 0.8;
          line-height: 1.4;
        }
        
        .sidebar-content {
          padding: 8px 0;
        }
        
        .segment-item {
          background: rgba(255,255,255,0.05);
          margin: 8px 16px;
          border-radius: 12px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
        }
        
        .segment-item:hover {
          background: rgba(255,255,255,0.1);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .segment-item.active {
          background: rgba(255,255,255,0.15);
          border-color: rgba(255,255,255,0.3);
          box-shadow: 0 6px 16px rgba(0,0,0,0.15);
        }
        
        .segment-header {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
        }
        
        .segment-checkbox {
          margin-right: 12px;
          width: 18px;
          height: 18px;
          accent-color: #fff;
        }
        
        .segment-title {
          font-weight: 600;
          font-size: 1.05em;
          flex: 1;
        }
        
        .segment-type {
          background: rgba(255,255,255,0.2);
          color: #ff9999;
          padding: 4px 10px;
          border-radius: 8px;
          font-size: 0.8em;
          font-weight: 500;
        }
        
        .segment-type.stop {
          background: rgba(255, 107, 107, 0.2);
          color: #ff6b6b;
        }
        
        .segment-type.move {
          background: rgba(76, 175, 80, 0.2);
          color: #4caf50;
        }
        
        .segment-details {
          font-size: 0.9em;
          opacity: 0.9;
          line-height: 1.4;
        }
        
        .segment-time {
          margin-bottom: 10px;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          background: rgba(255,255,255,0.08);
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 0.85em;
        }
        
        .segment-stats {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 8px;
          margin-top: 10px;
        }
        
        .stat-item {
          text-align: center;
          background: rgba(255,255,255,0.1);
          padding: 8px 6px;
          border-radius: 8px;
        }
        
        .stat-label {
          font-size: 0.7em;
          opacity: 0.7;
          margin-bottom: 3px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .stat-value {
          font-weight: 600;
          font-size: 0.9em;
        }
        
        .sidebar-actions {
          padding: 16px 20px;
          border-top: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.05);
          position: sticky;
          bottom: 0;
        }
        
        .btn {
          background: rgba(255,255,255,0.2);
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
          padding: 10px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9em;
          font-weight: 500;
          transition: all 0.2s ease;
          backdrop-filter: blur(10px);
          width: 100%;
        }
        
        .btn:hover {
          background: rgba(255,255,255,0.3);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .btn-close {
          background: transparent;
          border: none;
          color: white;
          font-size: 1.3em;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: all 0.2s ease;
        }
        
        .btn-close:hover {
          background: rgba(255,255,255,0.2);
          transform: rotate(90deg);
        }
        
        .sidebar-toggle {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 50px;
          height: 50px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.2em;
          z-index: 15;
          box-shadow: 0 4px 16px rgba(102, 126, 234, 0.3);
          transition: all 0.3s ease;
        }
        
        .sidebar-toggle:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }
        
        .sidebar-toggle.hidden {
          opacity: 0;
          pointer-events: none;
        }
        
        .controls { 
          position: absolute; 
          bottom: 20px; 
          left: 50%; 
          transform: translateX(-50%); 
          background: rgba(255,255,255,0.95); 
          padding: 12px 24px; 
          border-radius: 16px; 
          z-index: 5; 
          display: flex; 
          flex-direction: column; 
          align-items: center; 
          gap: 10px; 
          box-shadow: 0 8px 32px rgba(0,0,0,0.1); 
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.2);
          min-width: 220px; 
          width: 80vw; 
          max-width: 700px; 
        }
        .controls-row { display: flex; align-items: center; gap: 15px; width: 100%; justify-content: center; flex-wrap: wrap; }
        .track-progress-bar { width: 80vw; max-width: 700px; min-width: 160px; height: 100px; margin-bottom: 2px; user-select: none; touch-action: pan-x; margin-left: auto; margin-right: auto; }
        .timestamp { font-family: 'SF Mono', Monaco, monospace; font-size: 13px; min-width: 120px; padding: 8px 12px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef; }
        .drop-prompt { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,255,255,0.95); padding: 30px 40px; border-radius: 16px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 1.3em; color: #333; text-align: center; z-index: 10; pointer-events: auto; display: none; box-shadow: 0 8px 32px rgba(0,0,0,0.1); cursor: pointer; transition: all 0.3s ease; backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.2); }
        .drop-prompt:hover { background: #fff; transform: translate(-50%, -50%) scale(1.02); }
        .drop-prompt:active { transform: translate(-50%, -50%) scale(0.98); }
        .map-container.no-track .drop-prompt { display: block; }
        .file-input { display: none; }
        .color-mode-select { font-size: 14px; padding: 6px 12px; border-radius: 8px; border: 1px solid #ddd; margin-left: 8px; background: white; }
        
        @media (max-width: 768px) {
          .sidebar-container.expanded { 
            width: 100%; 
            position: absolute;
            top: 0;
            right: 0;
            height: 100%;
            z-index: 20;
          }
          .sidebar { 
            width: 100%; 
          }
          .controls { 
            min-width: 0; 
            padding: 10px 16px; 
            border-radius: 12px; 
            width: 90vw; 
            max-width: 98vw; 
          }
          .track-progress-bar { 
            min-width: 0; 
            width: 90vw; 
            max-width: 98vw; 
            height: 110px; 
          }
          .controls-row { 
            flex-direction: row; 
            flex-wrap: wrap; 
            gap: 10px; 
            justify-content: center; 
          }
          .timestamp { 
            font-size: 15px; 
            min-width: 100px; 
            padding: 6px 10px; 
          }
          label { 
            font-size: 15px; 
          }
          .color-mode-select { 
            font-size: 15px; 
            padding: 6px 12px; 
            margin-left: 6px; 
          }
          .sidebar-toggle { 
            width: 44px; 
            height: 44px; 
            top: 16px; 
            right: 16px; 
          }
        }
        
        @media (max-width: 480px) {
          .sidebar-container.expanded { 
            width: 100%; 
          }
          .sidebar { 
            width: 100%; 
          }
        }
      </style>
      <div class="main-container">
        <div class="map-container no-track">
          <div class="map"></div>
          <div class="drop-prompt">请拖放 GPX 文件到地图区域<br>或点击此处选择文件</div>
          <button class="sidebar-toggle hidden" title="显示侧边栏">📊</button>
        </div>
        <div class="sidebar-container">
          <div class="sidebar">
            <div class="sidebar-header">
              <div class="sidebar-title">
                <span>📍 路径分段</span>
                <button class="btn-close" title="关闭侧边栏">✕</button>
              </div>
              <div class="sidebar-subtitle">选择分段查看轨迹详情，支持多选组合</div>
            </div>
            <div class="sidebar-content"></div>
            <div class="sidebar-actions">
              <button class="btn" id="reset-segments">🔄 重置所有分段</button>
            </div>
          </div>
        </div>
      </div>
      <div class="controls">
        <div class="track-progress-bar"></div>
        <div class="controls-row">
          <label style="white-space:nowrap;">轨迹进度:</label>
          <div class="timestamp">未加载数据</div>
          <label style="margin-left:10px;white-space:nowrap;">轨迹颜色:</label>
          <select class="color-mode-select">
            <option value="fixed">固定颜色</option>
            <option value="speed" selected>速度模式</option>
            <option value="time">时间模式</option>
          </select>
        </div>
      </div>
      <input type="file" class="file-input" accept=".gpx" />
    `;
    this._mapContainer = this.shadowRoot.querySelector('.map');
    this._mapMainContainer = this.shadowRoot.querySelector('.map-container');
    this._sidebar = this.shadowRoot.querySelector('.sidebar');
    this._sidebarContainer = this.shadowRoot.querySelector('.sidebar-container');
    this._sidebarContent = this.shadowRoot.querySelector('.sidebar-content');
    this._sidebarToggle = this.shadowRoot.querySelector('.sidebar-toggle');
    this._dropPromptMessage = this.shadowRoot.querySelector('.drop-prompt');
    this._timestampDisplay = this.shadowRoot.querySelector('.timestamp');
    this._fileInput = this.shadowRoot.querySelector('.file-input');
    this._colorModeSelect = this.shadowRoot.querySelector('.color-mode-select');
    this._progressBarContainer = this.shadowRoot.querySelector('.track-progress-bar');
    // 事件绑定
    this._colorModeSelect.addEventListener('change', () => {
      this._currentColorMode = this._colorModeSelect.value;
      this._updateTrackSegmentsLayer();
      this._renderTrackProgressBar();
    });
    this._dropPromptMessage.addEventListener('click', () => this._fileInput.click());
    this._fileInput.addEventListener('change', (event) => {
      if (event.target.files && event.target.files.length > 0) {
        this._processSelectedFile(event.target.files[0]);
      }
    });
    
    // 侧边栏切换事件
    this._sidebarToggle.addEventListener('click', () => this._showSidebar());
    this.shadowRoot.querySelector('.btn-close').addEventListener('click', () => this._hideSidebar());
    
    // 重置分段按钮事件
    this.shadowRoot.getElementById('reset-segments').addEventListener('click', () => {
      if (this._currentSegments) {
        this._segmentVisibility = this._currentSegments.map(() => false);
        this._updateTrackSegmentsLayer();
        this._renderTrackProgressBar();
        this._renderSidebar();
        this._fitMapToVisibleTrack();
      }
    });
    
    // 拖拽
    this._mapContainer.addEventListener('dragover', e => { 
      e.preventDefault(); 
      e.stopPropagation(); 
      this._mapMainContainer.classList.add('dragover'); 
      this._dropPromptMessage.textContent = "松开以加载 GPX 文件"; 
    });
    this._mapContainer.addEventListener('dragleave', e => { 
      e.preventDefault(); 
      e.stopPropagation(); 
      this._mapMainContainer.classList.remove('dragover'); 
      if (this._currentPoints.length === 0) this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件"; 
    });
    this._mapContainer.addEventListener('drop', e => { 
      e.preventDefault(); 
      e.stopPropagation(); 
      this._mapMainContainer.classList.remove('dragover'); 
      this._dropPromptMessage.textContent = "正在处理 GPX 文件..."; 
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { 
        this._processSelectedFile(e.dataTransfer.files[0]); 
      } else { 
        if (this._currentPoints.length === 0) this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件"; 
      } 
    });
  }

  // 显示侧边栏
  _showSidebar() {
    if (this._sidebarContainer) {
      this._sidebarContainer.classList.add('expanded');
      this._sidebarToggle.classList.add('hidden');
    }
  }

  // 隐藏侧边栏
  _hideSidebar() {
    if (this._sidebarContainer) {
      this._sidebarContainer.classList.remove('expanded');
      this._sidebarToggle.classList.remove('hidden');
    }
  }
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
          alert("加载地图时出错：" + (e.error.message || "未知错误"));
        }
      });
      this._map.on('zoomend', () => {
        // 只在箭头图层可见且有可见轨迹时才更新箭头
        if (
          this._currentPoints && this._currentPoints.length > 1 &&
          this._map.getSource('arrow-points') &&
          this._map.style.getImage('arrow-icon') &&
          this._map.getLayoutProperty('gpx-arrows', 'visibility') === 'visible'
        ) {
          // 获取当前可见轨迹点
          const pts = this._getVisibleTrackPoints();
          if (pts && pts.length > 1) {
            const arrowFeatures = this._generateArrowFeatures(pts, this._map.getZoom());
            this._map.getSource('arrow-points').setData(arrowFeatures);
          }
        }
      });
    });
  }

  _onMapLoaded() {
    this._mapLoaded = true;
    // 地图源和图层初始化
    this._map.addSource('full-track', { type: 'geojson', data: this._currentFullTrackGeoJSON });
    // 添加描边图层（更宽，颜色对比）
    this._map.addLayer({ id: 'full-track-stroke', type: 'line', source: 'full-track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#000000', 'line-width': 8, 'line-opacity': 0.9 } });
    this._map.addLayer({ id: 'full-track-line', type: 'line', source: 'full-track', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#007bff', 'line-width': 5, 'line-opacity': 0.8 } });
    this._map.addSource('highlighted-segment', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} } });
    this._map.addLayer({ id: 'highlighted-segment-line', type: 'line', source: 'highlighted-segment', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFD700', 'line-width': 7, 'line-opacity': 0.85 } });

    const arrowUpSvgString = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><polygon points="6,0 12,9 0,9" fill="currentColor"/></svg>`;
    const img = new Image(16, 16);
    img.onload = () => {
      if (!this._map.hasImage('arrow-icon')) { // 检查图标是否已存在
        this._map.addImage('arrow-icon', img, { sdf: true });
      }
      // 确保 arrow-points 源和图层在图标加载后添加，并且只添加一次
      if (!this._map.getSource('arrow-points')) {
        this._map.addSource('arrow-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      if (!this._map.getLayer('gpx-arrows')) {
        this._map.addLayer({ id: 'gpx-arrows', type: 'symbol', source: 'arrow-points', layout: { 'icon-image': 'arrow-icon', 'icon-size': 0.7, 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-color': '#003399', 'icon-opacity': 0.85 } }, 'travelled-track-line');
      }
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

    this._map.addSource('stop-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    this._map.addLayer({
      id: 'stop-points-layer',
      type: 'circle',
      source: 'stop-points',
      paint: {
        'circle-radius': 10,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff',
        'circle-opacity': 0.85
      }
    });

    const pauseSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><rect x='4' y='4' width='4' height='12' rx='1.5' fill='#fff'/><rect x='12' y='4' width='4' height='12' rx='1.5' fill='#fff'/></svg>`;
    const pauseImg = new Image(20, 20);
    pauseImg.onload = () => {
      if (!this._map.hasImage('pause-icon')) {
        this._map.addImage('pause-icon', pauseImg, { sdf: false });
      }
      if (!this._map.getLayer('stop-points-pause')) {
        this._map.addLayer({
          id: 'stop-points-pause',
          type: 'symbol',
          source: 'stop-points',
          layout: {
            'icon-image': 'pause-icon',
            'icon-size': 0.7,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          }
        });
      }
    };
    pauseImg.src = 'data:image/svg+xml;base64,' + btoa(pauseSvg);

    // 在地图加载完成后，检查是否有待处理的 GPX 数据
    if (this._gpxString) {
      const newRawData = this._parseGPXToRawTrackData(this._gpxString);
      if (newRawData !== null) {
        this._loadTrackDataOnMap(newRawData);
        this.dispatchEvent(new CustomEvent('gpx-loaded'));
      } else {
        this._timestampDisplay.textContent = "GPX 解析失败";
        this._mapMainContainer.classList.add('no-track');
        this._dropPromptMessage.textContent = "GPX 解析失败，请检查文件并重试\n或点击此处选择另一个文件";
        this.dispatchEvent(new CustomEvent('gpx-error'));
      }
    } else {
      // 如果没有 gpxString，才显示初始的拖放提示状态
      this._mapMainContainer.classList.add('no-track');
      this._timestampDisplay.textContent = "请拖放 GPX 文件";
      this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
      if (this._progressBarContainer) {
        this._progressBarContainer.innerHTML = '';
      }
    }
    // 悬停静止点显示信息
    let stopPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    this._map.on('mouseenter', 'stop-points-layer', (e) => {
      this._map.getCanvas().style.cursor = 'pointer';
      const feat = e.features && e.features[0];
      if (feat) {
        const { startTime, endTime, durationSec } = feat.properties;
        const startStr = new Date(startTime * 1000).toLocaleString();
        const endStr = new Date(endTime * 1000).toLocaleString();
        const min = Math.floor(durationSec / 60), sec = Math.round(durationSec % 60);
        const html = `<div style="font-family:sans-serif;font-size:0.95em;line-height:1.5;"><b>静止区段</b><br>开始：${startStr}<br>结束：${endStr}<br>持续：${min}分${sec}秒</div>`;
        stopPopup.setLngLat(feat.geometry.coordinates).setHTML(html).addTo(this._map);
      }
    });
    this._map.on('mouseleave', 'stop-points-layer', () => {
      this._map.getCanvas().style.cursor = '';
      if (stopPopup.isOpen()) stopPopup.remove();
    });
    // 悬浮弹窗
    // 确保 handleTrackHoverLayer 定义和调用在所有图层添加后
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


    // 确保在图层实际存在后再调用
    if (this._map.getLayer('full-track-line')) {
      handleTrackHoverLayer('full-track-line');
    }
    if (this._map.getLayer('track-segments-line')) {
      handleTrackHoverLayer('track-segments-line');
    }
  }

  // 解析 GPX 字符串为 raw track 数据
  _parseGPXToRawTrackData(gpxString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxString, "text/xml");
    const newRawData = [];
    const parseError = xmlDoc.getElementsByTagName("parsererror");
    if (parseError.length > 0) {
      console.error("GPX parsing error:", parseError[0].textContent);
      alert("GPX 文件解析失败。请检查文件格式。\n错误详情：" + parseError[0].textContent);
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
        console.warn(`跳过无效的轨迹点数据：Lat=${lat}, Lon=${lon}, Time=${time}, Ele=${ele}`);
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
    // 检测静止区段
    const stops = this._detectStops(points);
    return {
      points: points,
      fullTrackGeoJSON: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coordinates },
        properties: {}
      },
      stops: stops
    };
  }

  // 检测静止区段，返回 [{startIdx, endIdx, startTime, endTime, durationSec, centerLng, centerLat}]
  _detectStops(points) {
    const res = [];
    if (!points || points.length < GPXViewer.STOP_WINDOW_SIZE) return res;
    let i = 0;
    while (i <= points.length - GPXViewer.STOP_WINDOW_SIZE) {
      let totalDist = 0, totalTime = 0;
      for (let j = 0; j < GPXViewer.STOP_WINDOW_SIZE - 1; j++) {
        const p1 = points[i + j], p2 = points[i + j + 1];
        totalDist += this._calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        totalTime += Math.abs(p2.timestamp - p1.timestamp);
      }
      const displacement = this._calculateDistance(
        points[i].latitude, points[i].longitude,
        points[i + GPXViewer.STOP_WINDOW_SIZE - 1].latitude,
        points[i + GPXViewer.STOP_WINDOW_SIZE - 1].longitude
      );
      const avgSpeedKmph = totalTime > 0 ? (totalDist / 1000) / (totalTime / 3600) : 0;
      // 新增：计算首尾点直线距离
      if (
        avgSpeedKmph < GPXViewer.STOP_SPEED_THRESHOLD_KMPH &&
        displacement < GPXViewer.STOP_MAX_DISPLACEMENT_M
      ) {
        // 向后扩展直到速度或位移超阈值
        let endIdx = i + GPXViewer.STOP_WINDOW_SIZE - 1;
        let lastTime = points[endIdx].timestamp;
        while (endIdx + 1 < points.length) {
          const pPrev = points[endIdx], pNext = points[endIdx + 1];
          const dist = this._calculateDistance(pPrev.latitude, pPrev.longitude, pNext.latitude, pNext.longitude);
          const dt = Math.abs(pNext.timestamp - pPrev.timestamp);
          const v = dt > 0 ? (dist / 1000) / (dt / 3600) : 0;
          // 新增：扩展后再判断首尾位移
          const newDisplacement = this._calculateDistance(
            points[i].latitude, points[i].longitude,
            points[endIdx + 1].latitude, points[endIdx + 1].longitude
          );
          if (v >= GPXViewer.STOP_SPEED_THRESHOLD_KMPH || newDisplacement >= GPXViewer.STOP_MAX_DISPLACEMENT_M) break;
          endIdx++;
          lastTime = points[endIdx].timestamp;
        }
        const durationSec = points[endIdx].timestamp - points[i].timestamp;
        if (durationSec >= GPXViewer.STOP_MIN_DURATION_SEC) {
          // 取区段中点为标记点
          const midIdx = Math.floor((i + endIdx) / 2);
          res.push({
            startIdx: i,
            endIdx: endIdx,
            startTime: points[i].timestamp,
            endTime: points[endIdx].timestamp,
            durationSec,
            centerLng: points[midIdx].longitude,
            centerLat: points[midIdx].latitude
          });
        }
        i = endIdx + 1;
      } else {
        i++;
      }
    }
    return res;
  }

  // 加载轨迹到地图
  _loadTrackDataOnMap(newRawTrackData) {
    const processed = this._processTrackData(newRawTrackData);
    this._currentPoints = processed.points;
    this._currentFullTrackGeoJSON = processed.fullTrackGeoJSON;
    this._currentStops = processed.stops || [];
    // 新增：分段
    this._currentSegments = this._splitTrackByStops(this._currentPoints, this._currentStops);
    this._segmentVisibility = this._currentSegments.map(() => false); // 默认全未选中
    if (this._currentPoints.length === 0) {
      this._timestampDisplay.textContent = "GPX 文件无有效轨迹数据";
      this._mapMainContainer.classList.add('no-track');
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
      if (this._progressBarContainer) {
        this._progressBarContainer.innerHTML = '';
      }
      return;
    }
    this._mapMainContainer.classList.remove('no-track');
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
    if (this._map.getSource('stop-points')) {
      this._updateStopPointsLayer();
    }
    // 渲染SVG进度条
    this._renderTrackProgressBar();
    // 渲染侧边栏并显示
    this._renderSidebar();
    this._showSidebar();
  }

  // 更新地图当前点和已走轨迹（只用可见分段）
  _updateMapForIndex(index) {
    const visiblePoints = this._getVisibleTrackPoints();
    if (!this._map.loaded() || !this._map.getSource('current-point') || !this._map.getSource('travelled-track')) {
      return;
    }
    if (!visiblePoints || visiblePoints.length === 0 || index < 0 || index >= visiblePoints.length) {
      if (!visiblePoints || visiblePoints.length === 0) {
        this._timestampDisplay.textContent = "无轨迹数据";
        this._map.getSource('current-point').setData({ type: 'FeatureCollection', features: [] });
        this._map.getSource('travelled-track').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
      }
      return;
    }
    const currentPointData = visiblePoints[index];
    this._map.getSource('current-point').setData({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [currentPointData.longitude, currentPointData.latitude] },
      properties: { timestamp: currentPointData.timestamp, altitude: currentPointData.altitude }
    });
    const travelledCoordinates = visiblePoints.slice(0, index + 1).map(p => [p.longitude, p.latitude, p.altitude]);
    this._map.getSource('travelled-track').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: travelledCoordinates },
      properties: {}
    });
    const date = new Date(currentPointData.timestamp * 1000);
    this._timestampDisplay.textContent = `${date.toLocaleString()} (海拔：${currentPointData.altitude.toFixed(1)}m)`;
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
      const { speeds, minV, maxV } = this._calculateSpeedsWithPercentiles(points);
      console.log(`p1: ${minV}, p99: ${maxV}`);
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

  // 更新静止点图层
  _updateStopPointsLayer() {
    if (!this._map || !this._map.getSource('stop-points')) return;
    const stops = this._currentStops || [];
    // 计算最大最小durationSec
    let minDur = Infinity, maxDur = -Infinity;
    stops.forEach(s => {
      if (s.durationSec < minDur) minDur = s.durationSec;
      if (s.durationSec > maxDur) maxDur = s.durationSec;
    });
    // 生成带颜色的feature
    const features = stops.map(stop => {
      let norm = (maxDur > minDur) ? (stop.durationSec - minDur) / (maxDur - minDur) : 0;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [stop.centerLng, stop.centerLat] },
        properties: {
          startTime: stop.startTime,
          endTime: stop.endTime,
          durationSec: stop.durationSec,
          color: this._turboColormap(norm)
        }
      };
    });
    this._map.getSource('stop-points').setData({ type: 'FeatureCollection', features });
  }

  // 更新分段轨迹图层（只显示选中段，未选中时显示全部）
  _updateTrackSegmentsLayer() {
    if (!this._map || !this._map.getSource('track-segments')) return;
    if (this._currentSegments && this._segmentVisibility) {
      const anySelected = this._segmentVisibility.some(v => v);
      const features = [];
      const allSegments = [];
      this._currentSegments.forEach((seg, idx) => {
        if (anySelected ? this._segmentVisibility[idx] : true) {
          if (seg.points.length > 1) {
            allSegments.push(seg.points.map(p => [p.longitude, p.latitude, p.altitude]));
            for (let i = 0; i < seg.points.length - 1; i++) {
              const p1 = seg.points[i], p2 = seg.points[i + 1];
              features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[p1.longitude, p1.latitude, p1.altitude], [p2.longitude, p2.latitude, p2.altitude]] },
                properties: { color: '#007bff' }
              });
            }
          }
        }
      });
      // 主线和描边始终MultiLineString
      const mainLineGeoJSON = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: allSegments }, properties: {} };
      this._map.getSource('full-track').setData(mainLineGeoJSON);
      // 箭头
      if (this._map.getSource('arrow-points') && this._map.style.getImage('arrow-icon')) {
        let arrowFeatures = { type: 'FeatureCollection', features: [] };
        allSegments.forEach(segCoords => {
          if (segCoords.length > 1) {
            const segPoints = segCoords.map(c => ({ longitude: c[0], latitude: c[1], altitude: c[2] }));
            const segArrows = this._generateArrowFeatures(segPoints, this._map.getZoom());
            arrowFeatures.features = arrowFeatures.features.concat(segArrows.features);
          }
        });
        this._map.getSource('arrow-points').setData(arrowFeatures);
      }
      // 分段线
      this._map.getSource('track-segments').setData({ type: 'FeatureCollection', features });
      // 显示/隐藏
      const visible = allSegments.length > 0;
      this._map.setLayoutProperty('full-track-line', 'visibility', visible ? 'visible' : 'none');
      this._map.setLayoutProperty('full-track-stroke', 'visibility', visible ? 'visible' : 'none');
      this._map.setLayoutProperty('track-segments-line', 'visibility', visible ? 'visible' : 'none');
      this._map.setLayoutProperty('gpx-arrows', 'visibility', visible ? 'visible' : 'none');
      this._map.setLayoutProperty('travelled-track-line', 'visibility', visible ? 'visible' : 'none');
      this._map.setLayoutProperty('current-point-marker', 'visibility', visible ? 'visible' : 'none');
      return;
    }
    const segGeoJSON = this._generateSegmentedTrackGeoJSON(this._currentPoints, this._currentColorMode);
    this._map.getSource('track-segments').setData(segGeoJSON);
    const showFull = this._currentColorMode === 'fixed';
    this._map.setLayoutProperty('full-track-line', 'visibility', showFull ? 'visible' : 'none');
    this._map.setLayoutProperty('track-segments-line', 'visibility', showFull ? 'none' : 'visible');
  }

  // 获取所有可见分段和自动补全段（始终补全连接）
  _getVisibleSegmentsWithBridges() {
    const segs = this._currentSegments || [];
    const vis = this._segmentVisibility || [];
    const result = [];
    let lastEnd = null;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (lastEnd && seg.points.length > 0) {
        // 检查上一个分段结尾和当前分段开头是否断开，若断开则补一段
        const prev = lastEnd;
        const curr = seg.points[0];
        if (prev.longitude !== curr.longitude || prev.latitude !== curr.latitude) {
          result.push({
            isBridge: true,
            points: [prev, curr]
          });
        }
      }
      if (vis[i]) {
        result.push({
          isBridge: false,
          points: seg.points
        });
        if (seg.points.length > 0) {
          lastEnd = seg.points[seg.points.length - 1];
        }
      } else {
        // 不可见分段也要更新lastEnd用于桥接
        if (seg.points.length > 0) {
          lastEnd = seg.points[seg.points.length - 1];
        }
      }
    }
    return result;
  }

  // 计算速度数组并返回p1和p99百分位数值
  _calculateSpeedsWithPercentiles(points) {
    if (!points || points.length < 2) {
      return { speeds: [], minV: 0, maxV: 0 };
    }

    const speeds = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const dt = p2.timestamp - p1.timestamp;
      const dist = this._calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
      let v = (dt > 0) ? (dist / dt) : 0;
      speeds.push(v);
    }

    // use p99 and p1 as min and max
    const sortedSpeeds = [...speeds].sort((a, b) => a - b);
    const p99Index = Math.floor(sortedSpeeds.length * 0.99);
    const p1Index = Math.floor(sortedSpeeds.length * 0.01);
    const minV = sortedSpeeds[p1Index] || 0;
    const maxV = sortedSpeeds[p99Index] || 0;

    return { speeds, minV, maxV };
  }

  // 按静止区段切分，保证所有段首尾点连续，静止段和活动段都保留
  _splitTrackByStops(points, stops) {
    if (!points || points.length < 2) return [];
    if (!stops || stops.length === 0) return [{ startIdx: 0, endIdx: points.length - 1, points: points.slice(), type: 'move' }];
    const segments = [];
    let segStart = 0;
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      // 活动段（静止前）
      if (stop.startIdx > segStart) {
        segments.push({
          startIdx: segStart,
          endIdx: stop.startIdx,
          points: points.slice(segStart, stop.startIdx + 1), // 包含首尾点
          type: 'move'
        });
      }
      // 静止段
      segments.push({
        startIdx: stop.startIdx,
        endIdx: stop.endIdx,
        points: points.slice(stop.startIdx, stop.endIdx + 1), // 包含首尾点
        type: 'stop'
      });
      segStart = stop.endIdx;
    }
    // 最后一个活动段
    if (segStart < points.length - 1) {
      segments.push({
        startIdx: segStart,
        endIdx: points.length - 1,
        points: points.slice(segStart),
        type: 'move'
      });
    }
    // 统计信息
    segments.forEach(seg => {
      if (seg.points.length < 2) return;
      seg.startTime = seg.points[0].timestamp;
      seg.endTime = seg.points[seg.points.length - 1].timestamp;
      seg.duration = seg.endTime - seg.startTime;
      let dist = 0;
      for (let i = 1; i < seg.points.length; i++) {
        dist += this._calculateDistance(seg.points[i - 1].latitude, seg.points[i - 1].longitude, seg.points[i].latitude, seg.points[i].longitude);
      }
      seg.distance = dist;
      seg.avgSpeed = seg.duration > 0 ? (dist / seg.duration) * 3.6 : 0; // km/h
    });
    return segments;
  }

  // 获取所有可见分段的点
  _getVisibleTrackPoints() {
    if (!this._currentSegments || !this._segmentVisibility) return [];
    // 有选中时只显示选中段，否则显示全部
    const anySelected = this._segmentVisibility.some(v => v);
    let pts = [];
    this._currentSegments.forEach((seg, idx) => {
      if (anySelected ? this._segmentVisibility[idx] : true) {
        if (pts.length > 0 && seg.points.length > 0 && pts[pts.length - 1].timestamp === seg.points[0].timestamp) {
          pts = pts.concat(seg.points.slice(1));
        } else {
          pts = pts.concat(seg.points);
        }
      }
    });
    return pts;
  }

  // 缩放到当前可见轨迹的bbox
  _fitMapToVisibleTrack() {
    if (!this._map) return;
    const pts = this._getVisibleTrackPoints();
    if (!pts || pts.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    pts.forEach(p => bounds.extend([p.longitude, p.latitude]));
    if (!bounds.isEmpty()) {
      this._map.fitBounds(bounds, { padding: 60 });
    }
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
        console.error('处理 GPX 文件时出错：', error);
        alert('处理 GPX 文件时发生意外错误：' + error.message);
        this._timestampDisplay.textContent = 'GPX 加载异常';
        this._mapContainer.classList.add('no-track');
        this._dropPromptMessage.textContent = 'GPX 加载异常，请重试\n或点击此处选择另一个文件';
        if (this._progressBarContainer) {
          this._progressBarContainer.innerHTML = '';
        }
      }
    };
    reader.onerror = (e) => {
      console.error('读取文件失败：', e);
      alert('读取文件失败。请检查浏览器权限或文件本身。');
      this._timestampDisplay.textContent = '文件读取错误';
      this._mapContainer.classList.add('no-track');
      this._dropPromptMessage.textContent = '文件读取错误，请重试\n或点击此处选择另一个文件';
      if (this._progressBarContainer) {
        this._progressBarContainer.innerHTML = '';
      }
    };
    reader.readAsText(file);
    this._fileInput.value = '';
  }

  // 渲染轨迹进度条（SVG）——只用可见分段的点
  _renderTrackProgressBar() {
    const container = this._progressBarContainer;
    container.innerHTML = '';
    const points = this._getVisibleTrackPoints();
    if (!points || points.length === 0) return;
    const N = points.length;
    if (N < 2) return;
    // 响应式参数
    const isMobile = window.innerWidth < 600;
    // 动态获取父容器宽度
    let W = container.clientWidth;
    if (!W || W < 100) W = isMobile ? 320 : 700; // 容错
    const H = isMobile ? 90 : 100;
    const margin = isMobile ? { left: 18, right: 18, top: 18, bottom: 24 } : { left: 40, right: 40, top: 22, bottom: 28 };
    const barY = H - margin.bottom - 16;
    const barH = isMobile ? 10 : 12;
    const barR = isMobile ? 4 : 6;
    const polyH = H - margin.top - margin.bottom - barH - 16;
    // 计算宽度自适应
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.display = 'block';
    svg.style.touchAction = 'pan-x';
    // 1. 彩色分段带
    let minV = 0, maxV = 0;
    let speeds = [];
    if (this._currentColorMode === 'speed') {
      const speedData = this._calculateSpeedsWithPercentiles(points);
      speeds = speedData.speeds;
      minV = speedData.minV;
      maxV = speedData.maxV;
    }

    for (let i = 0; i < N - 1; i++) {
      const x1 = margin.left + ((W - margin.left - margin.right) * i) / (N - 1);
      const x2 = margin.left + ((W - margin.left - margin.right) * (i + 1)) / (N - 1);
      let color = '#007bff';
      if (this._currentColorMode === 'speed') {
        let norm = (maxV > minV) ? (speeds[i] - minV) / (maxV - minV) : 0;
        color = this._turboColormap(norm);
      } else if (this._currentColorMode === 'time') {
        let norm = (points[i].timestamp - points[0].timestamp) / (points[N - 1].timestamp - points[0].timestamp);
        color = this._turboColormap(norm);
      }
      const seg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      seg.setAttribute('x', x1);
      seg.setAttribute('y', barY);
      seg.setAttribute('width', Math.max(1, x2 - x1));
      seg.setAttribute('height', barH);
      seg.setAttribute('fill', color);
      seg.setAttribute('rx', barR);
      seg.setAttribute('ry', barR);
      svg.appendChild(seg);
    }
    // 2. 海拔折线图
    let minAlt = Infinity, maxAlt = -Infinity;
    for (let i = 0; i < N; i++) {
      if (points[i].altitude < minAlt) minAlt = points[i].altitude;
      if (points[i].altitude > maxAlt) maxAlt = points[i].altitude;
    }
    const polyPoints = [];
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
    polyline.setAttribute('stroke-width', isMobile ? 1.5 : 2.2);
    polyline.setAttribute('opacity', 0.95);
    svg.appendChild(polyline);
    // 3. 时间刻度
    const timeStep = Math.max(1, Math.floor(N / (isMobile ? 4 : 5)));
    for (let i = 0; i < N; i += timeStep) {
      const x = margin.left + ((W - margin.left - margin.right) * i) / (N - 1);
      const t = new Date(points[i].timestamp * 1000);
      const label = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
      const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      tick.setAttribute('x1', x);
      tick.setAttribute('x2', x);
      tick.setAttribute('y1', barY + barH + 2);
      tick.setAttribute('y2', barY + barH + 10);
      tick.setAttribute('stroke', '#888');
      tick.setAttribute('stroke-width', 1);
      svg.appendChild(tick);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', barY + barH + (isMobile ? 22 : 24));
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
    speedDiv.style.fontSize = isMobile ? '18px' : '16px';
    speedDiv.style.fontWeight = 'bold';
    speedDiv.style.marginBottom = isMobile ? '2px' : '4px';
    speedDiv.style.color = '#1976d2';
    speedDiv.style.fontFamily = 'monospace';
    container.appendChild(speedDiv);
    const drawCursor = (idx) => {
      // 移除旧的
      const old = svg.querySelector('#track-cursor');
      if (old) old.remove();
      const x = margin.left + ((W - margin.left - margin.right) * idx) / (N - 1);
      const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      cursor.setAttribute('id', 'track-cursor');
      cursor.setAttribute('cx', x);
      let y = margin.top + polyH;
      if (maxAlt > minAlt) {
        y = margin.top + polyH - ((points[idx].altitude - minAlt) / (maxAlt - minAlt)) * polyH;
      }
      cursor.setAttribute('cy', y);
      cursor.setAttribute('r', isMobile ? 5 : 6.5);
      cursor.setAttribute('fill', '#fff');
      cursor.setAttribute('stroke', '#dc3545');
      cursor.setAttribute('stroke-width', isMobile ? 2 : 2.5);
      cursor.setAttribute('opacity', 0.98);
      svg.appendChild(cursor);
    };
    // 速度计算函数
    const getSpeedText = (idx) => {
      if (idx <= 0 || idx >= N) return '-- km/h';
      const p1 = points[idx - 1], p2 = points[idx];
      const dt = p2.timestamp - p1.timestamp;
      const dist = this._calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
      let v = (dt > 0) ? (dist / dt) * 3.6 : 0; // m/s -> km/h
      return `速度：${v.toFixed(2)} km/h`;
    };
    const updateSpeed = (idx) => {
      speedDiv.textContent = getSpeedText(idx);
    };
    drawCursor(currentIdx);
    updateSpeed(currentIdx);
    // 5. 交互：点击/拖动
    let dragging = false;
    const getIdxFromEvent = (evt) => {
      let clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const rect = svg.getBoundingClientRect();
      // 计算实际SVG宽度比例，保证触摸点和SVG坐标一致
      const scale = rect.width / W;
      let x = (clientX - rect.left) / scale;
      x = Math.max(margin.left, Math.min(W - margin.right, x));
      let idx = Math.round(((x - margin.left) / (W - margin.left - margin.right)) * (N - 1));
      idx = Math.max(0, Math.min(N - 1, idx));
      return idx;
    };
    const updateAll = (idx) => {
      currentIdx = idx;
      drawCursor(idx);
      updateSpeed(idx);
      this._updateMapForIndex(idx);
      // 同步时间显示
      const date = new Date(points[idx].timestamp * 1000);
      this._timestampDisplay.textContent = `${date.toLocaleString()} (海拔：${points[idx].altitude.toFixed(1)}m)`;
    };
    svg.addEventListener('mousedown', (e) => { dragging = true; updateAll(getIdxFromEvent(e)); });
    svg.addEventListener('touchstart', (e) => { dragging = true; updateAll(getIdxFromEvent(e)); });
    window.addEventListener('mousemove', (e) => { if (dragging) updateAll(getIdxFromEvent(e)); });
    window.addEventListener('touchmove', (e) => { if (dragging) updateAll(getIdxFromEvent(e)); }, { passive: false });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('touchend', () => { dragging = false; });
    svg.addEventListener('click', (e) => { updateAll(getIdxFromEvent(e)); });
    // 首次渲染时同步地图
    updateAll(0);
    container.appendChild(svg);
  }

  // 渲染侧边栏
  _renderSidebar() {
    if (!this._sidebarContent) return;
    
    const segs = this._currentSegments || [];
    if (segs.length === 0) {
      this._hideSidebar();
      return;
    }

    // 清空内容
    this._sidebarContent.innerHTML = '';

    // 只显示距离>=50米的段
    const visibleSidebarSegs = segs.map((seg, idx) => ({ seg, idx }))
      .filter(({ seg }) => (seg.distance || 0) >= 50);

    if (visibleSidebarSegs.length === 0) {
      this._sidebarContent.innerHTML = '<div style="padding: 20px; text-align: center; opacity: 0.7;">暂无可显示的分段</div>';
      return;
    }

    visibleSidebarSegs.forEach(({ seg, idx }) => {
      const checked = this._segmentVisibility && this._segmentVisibility[idx];
      const start = new Date(seg.startTime * 1000);
      const end = new Date(seg.endTime * 1000);
      
      const startTime = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const endTime = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const startDate = start.toLocaleDateString();
      const endDate = end.toLocaleDateString();
      
      const speed = seg.avgSpeed ? seg.avgSpeed.toFixed(1) : '--';
      const dist = seg.distance ? (seg.distance / 1000).toFixed(2) : '--';
      const dur = seg.duration ? Math.round(seg.duration / 60) : 0;
      const durText = dur > 0 ? (dur < 60 ? `${dur}分` : `${Math.floor(dur/60)}时${dur%60}分`) : '--';
      
      const typeIcon = seg.type === 'stop' ? '⏸️' : '🚶';
      const typeLabel = seg.type === 'stop' ? '静止' : '移动';
      const typeClass = seg.type === 'stop' ? 'stop' : 'move';

      const segmentEl = document.createElement('div');
      segmentEl.className = `segment-item ${checked ? 'active' : ''}`;
      segmentEl.dataset.seg = idx;
      
      segmentEl.innerHTML = `
        <div class="segment-header">
          <input type="checkbox" class="segment-checkbox" ${checked ? 'checked' : ''}>
          <div class="segment-title">第${idx + 1}段</div>
          <div class="segment-type ${typeClass}">${typeIcon} ${typeLabel}</div>
        </div>
        <div class="segment-details">
          <div class="segment-time">
            ${startDate === endDate ? startDate : `${startDate} ~`}<br>
            ${startTime} - ${endTime}
          </div>
          <div class="segment-stats">
            <div class="stat-item">
              <div class="stat-label">距离</div>
              <div class="stat-value">${dist} km</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">时长</div>
              <div class="stat-value">${durText}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">均速</div>
              <div class="stat-value">${speed} km/h</div>
            </div>
          </div>
        </div>
      `;

      // 事件绑定
      const checkbox = segmentEl.querySelector('.segment-checkbox');
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        this._toggleSegment(idx);
      });

      segmentEl.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
          this._toggleSegment(idx);
        }
      });

      this._sidebarContent.appendChild(segmentEl);
    });
  }

  // 切换分段显示状态
  _toggleSegment(idx) {
    if (!this._segmentVisibility || !this._currentSegments) return;
    
    this._segmentVisibility[idx] = !this._segmentVisibility[idx];
    this._updateTrackSegmentsLayer();
    this._renderTrackProgressBar();
    this._renderSidebar();
    this._fitMapToVisibleTrack();
  }

}

customElements.define('gpx-viewer', GPXViewer);
