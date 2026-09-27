// Keeps the floating stage controls above the bottom status line. The line
// wraps onto more rows on a narrow stage (whole items move up, see
// styles/layout.css), so its height is not constant: this module publishes
// the distance from the stage bottom to the top of the line as --hud-bottom
// on #stage. The view actions, axis triad, side-by-side tool rail and the
// floating panels offset from it, so nothing sits on top of the line.
//
//   const stop = createHudDock(env, dom)   (no ResizeObserver: a no-op)
export function createHudDock(env, { $ }) {
  const Observer = env.ResizeObserver;
  const stage = $('#stage');
  const line = $('.viewport-bottomline');
  if (!Observer || !stage?.getBoundingClientRect || !stage.style?.setProperty
    || !line?.getBoundingClientRect) {
    return () => {};
  }
  let last = null;
  const update = () => {
    const stageBox = stage.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    if (!stageBox.height || !lineBox.height) return;
    const value = Math.max(0, Math.round(stageBox.bottom - lineBox.top));
    if (value === last) return;
    last = value;
    stage.style.setProperty('--hud-bottom', `${value}px`);
  };
  const observer = new Observer(update);
  observer.observe(line);
  observer.observe(stage);
  update();
  return () => observer.disconnect();
}
