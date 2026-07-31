// Bootstrap only — mounts a full-window canvas. Real rendering (terrain,
// grass, camera) arrives in Phase 2/3; this just proves the app boots for
// the Phase 1 smoke test and gives later phases a canvas to attach to.

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element missing');

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

app.appendChild(canvas);
