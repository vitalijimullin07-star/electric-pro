import { useEditor } from '@editor/store';

/*
 * Установка как приложение и работа без сети. Service worker и манифест подключаются
 * только на настоящем сайте (https или localhost), не в изолированной странице и не с диска.
 */

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;

function eligible(): boolean {
  try {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return secure && 'serviceWorker' in navigator && window.top === window;
  } catch {
    return false;
  }
}

export function setupPwa(): void {
  if (!eligible()) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
  const apple = document.createElement('link');
  apple.rel = 'apple-touch-icon';
  apple.href = 'icon-192.png';
  document.head.appendChild(apple);
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    useEditor.setState({ installable: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    useEditor.setState({ installable: false, message: 'Plata установлена: запускайте с рабочего стола или экрана телефона, работает и без интернета.' });
  });
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {
    /* без service worker редактор всё равно работает, просто не офлайн */
  });
}

/** Запуск установки; без готового приглашения браузера — подсказка, как установить вручную. */
export async function installApp(): Promise<void> {
  const s = useEditor.getState();
  if (deferred) {
    await deferred.prompt();
    const r = await deferred.userChoice;
    deferred = null;
    useEditor.setState({ installable: false });
    if (r.outcome === 'dismissed') s.setMessage('Установка отменена. Её можно запустить снова из меню «Файл».');
    return;
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  s.setMessage(
    ios
      ? 'На iPhone и iPad: в Safari нажмите «Поделиться» → «На экран Домой».'
      : window.matchMedia?.('(display-mode: standalone)').matches
        ? 'Plata уже открыта как приложение.'
        : 'Откройте сайт в Chrome, Edge или Яндекс Браузере: меню браузера → «Установить приложение» (или значок установки в адресной строке).',
  );
}
