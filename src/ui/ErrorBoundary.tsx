import { Component, type ReactNode } from 'react';

/** Сбой рендера (например, из-за повреждённого сохранения) не должен оставлять белый экран без выхода. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  reset = () => {
    try {
      localStorage.removeItem('shelter:game'); // паки пользователя не трогаем
    } catch {
      /* ignore */
    }
    location.href = location.pathname;
  };
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold text-danger">Что-то пошло не так</h1>
        <p className="text-sm text-dim">Возможно, повреждено сохранение партии. Ваши паки останутся нетронутыми.</p>
        <button className="btn btn-primary" onClick={this.reset}>Сбросить партию и перезагрузить</button>
      </main>
    );
  }
}
