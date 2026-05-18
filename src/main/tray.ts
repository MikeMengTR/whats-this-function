import { Tray, Menu, nativeImage, app, shell } from 'electron';
import * as path from 'path';

interface TrayOptions {
  isEnabled: () => boolean;
  onToggleEnabled: (value: boolean) => void;
  onTriggerExplain: () => void;
  onQuit: () => void;
}

let tray: Tray | null = null;
let opts: TrayOptions | null = null;

function getIconPath(enabled: boolean): string {
  // 始终从项目根目录的 assets 加载（dev 和打包后均工作，因为 build.files 已包含 assets）
  const iconName = enabled ? 'tray-icon.png' : 'tray-icon-disabled.png';
  return path.join(app.getAppPath(), 'assets', iconName);
}

function buildMenu(): Menu {
  const enabled = opts ? opts.isEnabled() : true;
  return Menu.buildFromTemplate([
    {
      label: enabled ? '✅ 已启用（点击暂停）' : '⏸️ 已暂停（点击启用）',
      click: () => {
        if (!opts) return;
        opts.onToggleEnabled(!enabled);
        refresh();
      },
    },
    { type: 'separator' },
    {
      label: '🔍 测试弹窗',
      click: () => {
        if (opts) opts.onTriggerExplain();
      },
    },
    { type: 'separator' },
    {
      label: '⚙️ 设置（待实现）',
      enabled: false,
    },
    {
      label: '📖 使用说明',
      click: () => {
        shell.openExternal('https://github.com/');
      },
    },
    { type: 'separator' },
    {
      label: '🚪 退出',
      click: () => {
        if (opts) opts.onQuit();
      },
    },
  ]);
}

function refresh(): void {
  if (!tray || !opts) return;
  const enabled = opts.isEnabled();
  const image = nativeImage.createFromPath(getIconPath(enabled));
  // 在 Mac 上让图标跟随暗/亮主题
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray.setImage(image);
  tray.setToolTip(enabled ? 'WTF · 已启用' : 'WTF · 已暂停');
  tray.setContextMenu(buildMenu());
}

export function initTray(options: TrayOptions): void {
  opts = options;
  const image = nativeImage.createFromPath(getIconPath(options.isEnabled()));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('WTF · 已启用');
  tray.setContextMenu(buildMenu());

  // 左键单击托盘：直接触发演示弹窗（方便调试，正式版本可去掉）
  tray.on('click', () => {
    if (opts) opts.onTriggerExplain();
  });
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
