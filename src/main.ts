import { startGame } from './game';

startGame().catch((err) => {
  const stack = err instanceof Error ? String(err.stack) : String(err);
  for (const line of stack.split('\n').slice(0, 12)) {
    console.error('STACKFRAME: ' + line);
  }
  const status = document.getElementById('load-status');
  if (status) status.textContent = 'Failed to start: ' + (err as Error).message;
});
