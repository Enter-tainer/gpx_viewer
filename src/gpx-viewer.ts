// gpx-viewer.ts - WebComponent: <gpx-viewer>
// 支持多实例、setGpx(gpxString)、reset()、事件、Shadow DOM 样式隔离

import { MapController } from './map-controller';
import { parseGPXToRawTrackData, processTrackData, splitTrackByStops } from './track-parser';
import { renderTrackProgressBar, renderSegmentsSidebar } from './ui-components';
import { TrackPoint, TrackSegment, ColorMode } from './types';
import styles from './styles.css?inline';

export class GPXViewer extends HTMLElement {
  // 私有属性
  private _gpxString: string | null = null;
  private _mapController?: MapController;
  private _currentPoints: TrackPoint[] = [];
  private _currentSegments: TrackSegment[] = [];
  private _segmentVisibility: boolean[] = [];
  private _currentColorMode: ColorMode = 'speed';
  private _mapLoaded: boolean = false;
  private _useSegmentSpeedNormalization = false;

  // DOM 元素
  private _mapContainer?: HTMLElement;
  private _mapMainContainer?: HTMLElement;
  // private _sidebar: HTMLElement; // Using sidebarContainer instead
  private _sidebarContainer?: HTMLElement;
  private _sidebarContent?: HTMLElement;
  private _sidebarToggle?: HTMLElement;
  private _dropPromptMessage?: HTMLElement;
  private _timestampDisplay?: HTMLElement;
  private _fileInput?: HTMLInputElement;
  private _colorModeSelect?: HTMLSelectElement;
  private _progressBarContainer?: HTMLElement;
  private _speedNormalizationCheckbox?: HTMLInputElement;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initDOM();
  }

  connectedCallback() {
    this._initMap();
  }

  disconnectedCallback() {
    if (this._mapController) {
      this._mapController.destroy();
    }

    // 移除窗口事件监听器
    window.removeEventListener('resize', this._handleResize);
  }

  // 窗口大小变化处理函数
  private _handleResize!: () => void;

  // 外部接口：传入 gpx 字符串
  setGpx(gpxString: string) {
    this._gpxString = gpxString; // 保存 gpx 字符串

    // 如果地图已经加载，则直接处理
    if (this._mapLoaded && this._mapController) {
      const newRawData = parseGPXToRawTrackData(gpxString);

      if (newRawData !== null) {
        const processed = processTrackData(newRawData);
        this._currentPoints = processed.points;
        this._currentSegments = splitTrackByStops(processed.points, processed.stops || []);
        this._segmentVisibility = this._currentSegments.map(() => false);

        this._loadTrackDataOnMap();
        this.dispatchEvent(new CustomEvent('gpx-loaded'));
      } else {
        if (this._timestampDisplay) this._timestampDisplay.textContent = "GPX 解析失败";
        if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
        if (this._dropPromptMessage) {
          this._dropPromptMessage.textContent = "GPX 解析失败，请检查文件并重试\n或点击此处选择另一个文件";
        }
        this.dispatchEvent(new CustomEvent('gpx-error'));
      }
    }
    // 如果地图尚未加载，_onMapLoaded 会在地图加载完成后处理 this._gpxString
  }

  // 外部接口：重置
  reset() {
    this._gpxString = null;
    this._currentPoints = [];
    this._currentSegments = [];
    this._segmentVisibility = [];

    if (this._timestampDisplay) this._timestampDisplay.textContent = "未加载数据";
    if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
    if (this._dropPromptMessage) {
      this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
    }

    if (this._mapLoaded && this._mapController) {
      this._mapController.clearMap();
    }

    if (this._progressBarContainer) {
      this._progressBarContainer.innerHTML = '';
    }

    this._hideSidebar();
  }

  // 属性支持（可选）
  static get observedAttributes() { return ['gpx']; }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === 'gpx' && newValue) {
      this.setGpx(newValue);
    }
  }

  // 初始化 Shadow DOM 结构和样式
  private _initDOM() {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="main-container">
        <div class="map-container no-track">
          <div class="map"></div>
          <div class="drop-prompt">请拖放 GPX 文件到地图区域<br>或点击此处选择文件</div>
          <button class="sidebar-toggle hidden" title="显示侧边栏">☰</button>
        </div>
        <div class="sidebar-container">
          <div class="sidebar">
            <div class="sidebar-header">
              <div class="sidebar-title">
                <span>轨迹分段</span>
                <button class="btn-close" title="关闭侧边栏">✕</button>
              </div>
              <div class="sidebar-subtitle">选择分段查看轨迹</div>
            </div>
            <div class="sidebar-controls">
              <label class="sidebar-option" title="勾选后，每个分段单独归一化速度色带">
                <input type="checkbox" class="speed-normalization-checkbox">
                分段归一化着色
              </label>
              <button class="btn" id="reset-segments">重置选择</button>
            </div>
            <div class="sidebar-content"></div>
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

    this._mapContainer = this.shadowRoot.querySelector('.map') as HTMLElement;
    this._mapMainContainer = this.shadowRoot.querySelector('.map-container') as HTMLElement;
    // Get sidebar containers
    this._sidebarContainer = this.shadowRoot.querySelector('.sidebar-container') as HTMLElement;
    this._sidebarContent = this.shadowRoot.querySelector('.sidebar-content') as HTMLElement;
    this._sidebarToggle = this.shadowRoot.querySelector('.sidebar-toggle') as HTMLElement;
    this._dropPromptMessage = this.shadowRoot.querySelector('.drop-prompt') as HTMLElement;
    this._timestampDisplay = this.shadowRoot.querySelector('.timestamp') as HTMLElement;
    this._fileInput = this.shadowRoot.querySelector('.file-input') as HTMLInputElement;
    this._colorModeSelect = this.shadowRoot.querySelector('.color-mode-select') as HTMLSelectElement;
    this._progressBarContainer = this.shadowRoot.querySelector('.track-progress-bar') as HTMLElement;
    this._speedNormalizationCheckbox = this.shadowRoot.querySelector('.speed-normalization-checkbox') as HTMLInputElement;

    // 事件绑定
    this._colorModeSelect?.addEventListener('change', () => {
      if (this._colorModeSelect) {
        this._currentColorMode = this._colorModeSelect.value as ColorMode;

        if (this._mapController) {
          this._mapController.setColorMode(this._currentColorMode);
        }

        this._renderTrackProgressBar();
      }
    });

    this._speedNormalizationCheckbox?.addEventListener('change', () => {
      this._useSegmentSpeedNormalization = !!this._speedNormalizationCheckbox?.checked;

      if (this._mapController) {
        this._mapController.setUseSegmentSpeedNormalization(this._useSegmentSpeedNormalization);
      }

      this._renderTrackProgressBar();
    });

    this._dropPromptMessage.addEventListener('click', () => this._fileInput!.click());

    this._fileInput.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        this._processSelectedFile(target.files[0]);
      }
    });

    // 侧边栏切换事件
    this._sidebarToggle.addEventListener('click', () => this._showSidebar());
    this.shadowRoot.querySelector('.btn-close')!.addEventListener('click', () => this._hideSidebar());

    // 重置分段按钮事件
    this.shadowRoot.getElementById('reset-segments')!.addEventListener('click', () => {
      if (this._currentSegments && this._mapController) {
        this._mapController.resetSegmentVisibility();
        this._segmentVisibility = this._mapController.getSegmentVisibility();

        this._renderTrackProgressBar();
        this._renderSidebar();
      }
    });

    // 拖拽
    this._mapContainer.addEventListener('dragover', e => {
      e.preventDefault();
      e.stopPropagation();
      this._mapMainContainer!.classList.add('dragover');
      this._dropPromptMessage!.textContent = "松开以加载 GPX 文件";
    });

    this._mapContainer.addEventListener('dragleave', e => {
      e.preventDefault();
      e.stopPropagation();
      this._mapMainContainer!.classList.remove('dragover');

      if (this._currentPoints.length === 0) {
        this._dropPromptMessage!.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
      }
    });

    this._mapContainer.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      this._mapMainContainer!.classList.remove('dragover');
      this._dropPromptMessage!.textContent = "正在处理 GPX 文件...";

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        this._processSelectedFile(e.dataTransfer.files[0]);
      } else {
        if (this._currentPoints.length === 0) {
          this._dropPromptMessage!.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
        }
      }
    });

    // 监听窗口大小变化，在移动设备和桌面设备之间切换时调整侧边栏状态
    this._handleResize = this._handleResizeImpl.bind(this);
    window.addEventListener('resize', this._handleResize);
  }

  // 窗口大小变化处理实现
  private _handleResizeImpl() {
    if (this._currentSegments && this._currentSegments.length > 0) {
      const sidebarExpanded = this._sidebarContainer &&
        this._sidebarContainer.classList.contains('expanded');

      if (this._isMobile() && sidebarExpanded) {
        // 切换到移动设备时关闭侧边栏
        this._hideSidebar();
      } else if (!this._isMobile() && !sidebarExpanded) {
        // 切换到桌面设备时打开侧边栏
        this._showSidebar();
      }
    }
  }

  // 检测是否为移动设备
  private _isMobile(): boolean {
    return window.innerWidth <= 768;
  }

  // 显示侧边栏
  private _showSidebar() {
    if (this._sidebarContainer && this._sidebarToggle) {
      this._sidebarContainer.classList.add('expanded');
      this._sidebarToggle.classList.add('hidden');
    }
  }

  // 隐藏侧边栏
  private _hideSidebar() {
    if (this._sidebarContainer && this._sidebarToggle) {
      this._sidebarContainer.classList.remove('expanded');
      this._sidebarToggle.classList.remove('hidden');
    }
  }

  // 初始化地图
  private async _initMap() {
    if (!this._mapContainer) return;

    this._mapController = new MapController(this._mapContainer);
    this._mapController.setUseSegmentSpeedNormalization(this._useSegmentSpeedNormalization);

    try {
      await this._mapController.initMap();
      this._mapLoaded = true;

      // 地图加载完成后，检查是否有待处理的 GPX 数据
      if (this._gpxString) {
        const newRawData = parseGPXToRawTrackData(this._gpxString);

        if (newRawData !== null) {
          const processed = processTrackData(newRawData);
          this._currentPoints = processed.points;
          this._currentSegments = splitTrackByStops(processed.points, processed.stops || []);
          this._segmentVisibility = this._currentSegments.map(() => false);

          this._loadTrackDataOnMap();
          this.dispatchEvent(new CustomEvent('gpx-loaded'));
        } else {
          if (this._timestampDisplay) this._timestampDisplay.textContent = "GPX 解析失败";
          if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
          if (this._dropPromptMessage) {
            this._dropPromptMessage.textContent = "GPX 解析失败，请检查文件并重试\n或点击此处选择另一个文件";
          }
          this.dispatchEvent(new CustomEvent('gpx-error'));
        }
      } else {
        // 如果没有 gpxString，才显示初始的拖放提示状态
        if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
        if (this._timestampDisplay) this._timestampDisplay.textContent = "请拖放 GPX 文件";
        if (this._dropPromptMessage) {
          this._dropPromptMessage.textContent = "请拖放 GPX 文件到地图区域\n或点击此处选择文件";
        }
        if (this._progressBarContainer) {
          this._progressBarContainer.innerHTML = '';
        }
      }
    } catch (error) {
      console.error('初始化地图时出错：', error);
      alert(`初始化地图失败：${error}`);
    }
  }

  // 加载轨迹数据到地图
  private _loadTrackDataOnMap() {
    if (!this._mapController) return;

    if (this._currentPoints.length === 0) {
      if (this._timestampDisplay) this._timestampDisplay.textContent = "GPX 文件无有效轨迹数据";
      if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
      if (this._dropPromptMessage) {
        this._dropPromptMessage.textContent = "GPX 无有效数据或解析失败，请重试\n或点击此处选择另一个文件";
      }
      if (this._progressBarContainer) {
        this._progressBarContainer.innerHTML = '';
      }
      return;
    }

    // 显示轨迹
    if (this._mapMainContainer) this._mapMainContainer.classList.remove('no-track');

    // 加载轨迹到地图控制器
    this._mapController.loadTrackData(
      this._currentPoints,
      this._currentSegments,
      []
    );

    // 渲染SVG进度条
    this._renderTrackProgressBar();

    // 渲染侧边栏，桌面设备自动显示，移动设备需要手动打开
    this._renderSidebar();

    if (!this._isMobile()) {
      this._showSidebar();
    } else {
      // 移动设备上确保侧边栏隐藏，按钮显示
      this._hideSidebar();
    }
  }

  // 处理文件选择和拖拽
  private _processSelectedFile(file: File) {
    if (!file || !file.name.toLowerCase().endsWith('.gpx')) {
      alert('请选择一个 .gpx 文件。');

      if (this._dropPromptMessage) {
        this._dropPromptMessage.textContent = '非 GPX 文件，请选择或拖放 .gpx 文件';

        setTimeout(() => {
          if (this._currentPoints.length === 0 && this._dropPromptMessage) {
            this._dropPromptMessage.textContent = '请拖放 GPX 文件到地图区域\n或点击此处选择文件';
          }
        }, 2000);
      }

      if (this._fileInput) this._fileInput.value = '';
      return;
    }

    if (this._dropPromptMessage) {
      this._dropPromptMessage.textContent = '正在处理 GPX 文件...';
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (typeof result === 'string') {
          this.setGpx(result);
        }
      } catch (error) {
        console.error('处理 GPX 文件时出错：', error);
        alert('处理 GPX 文件时发生意外错误：' + (error as Error).message);

        if (this._timestampDisplay) this._timestampDisplay.textContent = 'GPX 加载异常';
        if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
        if (this._dropPromptMessage) {
          this._dropPromptMessage.textContent = 'GPX 加载异常，请重试\n或点击此处选择另一个文件';
        }
        if (this._progressBarContainer) {
          this._progressBarContainer.innerHTML = '';
        }
      }
    };

    reader.onerror = (e) => {
      console.error('读取文件失败：', e);
      alert('读取文件失败。请检查浏览器权限或文件本身。');

      if (this._timestampDisplay) this._timestampDisplay.textContent = '文件读取错误';
      if (this._mapMainContainer) this._mapMainContainer.classList.add('no-track');
      if (this._dropPromptMessage) {
        this._dropPromptMessage.textContent = '文件读取错误，请重试\n或点击此处选择另一个文件';
      }
      if (this._progressBarContainer) {
        this._progressBarContainer.innerHTML = '';
      }
    };

    reader.readAsText(file);

    if (this._fileInput) this._fileInput.value = '';
  }

  // 渲染轨迹进度条（SVG）——双滑块范围选择器
  private _renderTrackProgressBar() {
    if (!this._progressBarContainer || !this._mapController) return;

    const visiblePoints = this._mapController.getVisibleTrackPoints();

    const speedColoringConfig = this._currentColorMode === 'speed'
      ? {
          useSegmentSpeedNormalization: this._useSegmentSpeedNormalization,
          globalSpeedRange: this._useSegmentSpeedNormalization
            ? null
            : this._mapController.getGlobalSpeedRange()
        }
      : undefined;

    renderTrackProgressBar(
      this._progressBarContainer,
      visiblePoints,
      this._currentColorMode,
      (startIndex, endIndex) => {
        if (this._mapController && this._timestampDisplay) {
          // 显示范围信息
          const startTime = new Date(visiblePoints[startIndex].timestamp * 1000);
          const endTime = new Date(visiblePoints[endIndex].timestamp * 1000);
          const duration = Math.abs(endTime.getTime() - startTime.getTime()) / 1000;

          // 计算距离
          let distance = 0;
          const R = 6371e3;
          const [s, e] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];

          for (let i = s + 1; i <= e; i++) {
            const p1 = visiblePoints[i - 1];
            const p2 = visiblePoints[i];

            const φ1 = p1.latitude * Math.PI / 180;
            const φ2 = p2.latitude * Math.PI / 180;
            const Δφ = (p2.latitude - p1.latitude) * Math.PI / 180;
            const Δλ = (p2.longitude - p1.longitude) * Math.PI / 180;

            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            distance += R * c;
          }

          const distanceKm = distance / 1000;
          const avgSpeed = duration > 0 ? (distanceKm / (duration / 3600)) : 0;

          const formatDuration = (seconds: number): string => {
            if (seconds < 60) return `${Math.round(seconds)}秒`;
            if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.round((seconds % 3600) / 60);
            return `${hours}时${minutes}分`;
          };

          const startTimeStr = startTime.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          const endTimeStr = endTime.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });

          this._timestampDisplay.textContent = `${startTimeStr} - ${endTimeStr}`;

          // 高亮显示地图上的范围（使用灰色遮罩未选中区域）
          this._mapController.highlightRange(startIndex, endIndex);
        } else {
          // 清除高亮
          this._mapController.clearRangeHighlight();
        }
      },
      speedColoringConfig
    );
  }

  // 渲染侧边栏
  private _renderSidebar() {
    if (!this._sidebarContent || !this._mapController) return;

    if (!this._currentSegments || this._currentSegments.length === 0) {
      this._hideSidebar();
      return;
    }

    renderSegmentsSidebar(
      this._sidebarContent,
      this._currentSegments,
      this._segmentVisibility,
      (index) => this._toggleSegment(index)
    );
  }

  // 切换分段显示状态
  private _toggleSegment(idx: number) {
    if (!this._segmentVisibility || !this._currentSegments || !this._mapController) return;

    this._mapController.toggleSegmentVisibility(idx);
    this._segmentVisibility = this._mapController.getSegmentVisibility();

    this._renderTrackProgressBar();
    this._renderSidebar();
  }
}

// 注册 Web 组件
customElements.define('gpx-viewer', GPXViewer);
