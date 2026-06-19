/** Minimal on-screen readout. The in_kbps line cross-checks the server's
 *  reported per-player egress — two independent measurements of the north star. */
export class Hud {
  constructor(private readonly el: HTMLElement) {}

  set(lines: Record<string, string | number>): void {
    let s = '';
    for (const [k, v] of Object.entries(lines)) s += `${k.padEnd(13)} ${v}\n`;
    this.el.textContent = s.trimEnd();
  }
}
