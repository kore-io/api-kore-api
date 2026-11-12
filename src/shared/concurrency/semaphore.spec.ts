import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  it('dado o limite 2, quando 5 tarefas chegam juntas, então no máximo 2 rodam ao mesmo tempo e todas terminam', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const task = () =>
      semaphore.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
      });

    const all = Promise.all([task(), task(), task(), task(), task()]);
    for (let done = 0; done < 5; done++) {
      while (releases.length === 0) await new Promise((resolve) => setImmediate(resolve));
      releases.shift()?.();
    }
    await all;

    expect(peak).toBe(2);
    expect(running).toBe(0);
  });

  it('dada uma tarefa que falha, quando termina, então libera a vaga', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(() => Promise.reject(new Error('falhou')))).rejects.toThrow();
    await expect(semaphore.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
