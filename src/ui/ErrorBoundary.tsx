import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copyText } from './clipboard';

interface State {
  error: Error | null;
  stack: string;
  copied: boolean;
}

/** Сбой рендера не должен оставлять белый экран без выхода: показываем причину и даём сбросить сохранение. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, stack: '', copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(_: Error, info: ErrorInfo) {
    this.setState({ stack: (info.componentStack ?? '').split('\n').slice(0, 6).join('\n') });
  }

  report = () =>
    [
      `Shelter Protocol: ${this.state.error?.name}: ${this.state.error?.message}`,
      (this.state.error?.stack ?? '').split('\n').slice(0, 5).join('\n'),
      this.state.stack,
      `UA: ${navigator.userAgent}`,
    ].join('\n');

  copy = async () => {
    this.setState({ copied: await copyText(this.report()) });
  };

  reset = () => {
    try {
      localStorage.removeItem('shelter:game'); // паки пользователя не трогаем
    } catch {
      /* ignore */
    }
    location.href = location.pathname;
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold text-danger">Что-то пошло не так</h1>
        <p className="text-sm text-dim">Ваши паки останутся нетронутыми. Если ошибка повторяется, нажмите «Скопировать отчёт» и отправьте разработчику.</p>
        <pre className="max-h-40 w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-bg p-3 text-left text-[11px] text-danger/90">
          {this.state.error.name}: {this.state.error.message}
        </pre>
        <div className="flex w-full flex-col gap-2">
          <button className="btn btn-primary" onClick={this.reset}>Сбросить партию и перезагрузить</button>
          <button className="btn" onClick={() => (location.href = location.pathname)}>Просто перезагрузить</button>
          <button className="btn btn-sm" onClick={this.copy}>{this.state.copied ? 'Скопировано ✔' : 'Скопировать отчёт'}</button>
        </div>
      </main>
    );
  }
}
