export class HUD {
  private fpsEl = document.getElementById('stat-fps')!;
  private posEl = document.getElementById('stat-pos')!;
  private coinEl = document.getElementById('stat-coins')!;
  private timeEl = document.getElementById('stat-time')!;
  private toastEl = document.getElementById('toast')!;
  private map = document.getElementById('minimap') as HTMLCanvasElement;
  private toastTimer = 0;
  private frames = 0;
  private fpsT = 0;
  private fps = 60;

  constructor(
    private onQuality: () => void,
    private onDayNight: () => void,
  ) {
    document.getElementById('btn-quality')!.onclick = () => this.onQuality();
    document.getElementById('btn-daynight')!.onclick = () => this.onDayNight();
    document.getElementById('btn-help')!.onclick = () =>
      document.getElementById('help-modal')!.classList.remove('hidden');
    document.getElementById('btn-close-help')!.onclick = () =>
      document.getElementById('help-modal')!.classList.add('hidden');
  }

  public show(): void {
    document.getElementById('hud')!.classList.remove('hidden');
  }

  public setQualityLabel(label: string): void {
    document.getElementById('btn-quality')!.textContent = `⚙ ${label}`;
  }

  public setNight(night: boolean): void {
    this.timeEl.textContent = night ? '🌙 Night' : '☀ Day';
    document.getElementById('btn-daynight')!.textContent = night ? '☀' : '🌙';
  }

  public toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), 2400);
  }

  public update(
    dt: number,
    px: number, pz: number,
    collected: number, total: number,
    coins: { position: { x: number; z: number }; isEnabled: () => boolean }[],
  ): void {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
      this.fpsEl.textContent = `${this.fps} fps`;
    }
    this.posEl.textContent = `${Math.round(px)}, ${Math.round(pz)}`;
    this.coinEl.textContent = `✦ ${collected} / ${total}`;
    this.drawMinimap(px, pz, coins);
  }

  private drawMinimap(px: number, pz: number, coins: { position: { x: number; z: number }; isEnabled: () => boolean }[]): void {
    const ctx = this.map.getContext('2d')!;
    const S = this.map.width;
    const R = 200; // world radius shown
    ctx.clearRect(0, 0, S, S);
    // meadow bg
    const g = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#7cc46a');
    g.addColorStop(0.55, '#5da653');
    g.addColorStop(1, '#3c6b46');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.fill();
    // lake
    ctx.fillStyle = '#4aa3df';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, (48 / R) * (S / 2), 0, Math.PI * 2);
    ctx.fill();
    const dot = (wx: number, wz: number, color: string, size: number) => {
      const dx = ((wx - px) / R) * (S / 2);
      const dz = ((wz - pz) / R) * (S / 2);
      const x = S / 2 + dx;
      const y = S / 2 + dz;
      if (x < 2 || y < 2 || x > S - 2 || y > S - 2) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const c of coins) {
      if (!c.isEnabled()) continue;
      dot(c.position.x, c.position.z, '#ffd54f', 3);
    }
    // player (center triangle pointing up = north)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
