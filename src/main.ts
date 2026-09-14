import { startGame } from './game';

startGame().catch((err) => {
  console.error(err);
  const status = document.getElementById('load-status');
  if (status) status.textContent = 'Failed to start: ' + (err as Error).message;
});
