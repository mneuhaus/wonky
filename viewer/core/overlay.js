// SVG overlay above the canvas with ordered layers.
//
//   overlay.layer({ id, order, render(frame) -> markup, after(frame) })
//   overlay.render()   (harness: renderOverlay)
//
// frame = { width, height } in CSS px. Layers render into one innerHTML in
// order; after() runs once the markup is in place (for DOM side effects).
export function createOverlay({ canvas, element }) {
  const layers = [];
  return {
    layer(layer) {
      if (layers.some(item => item.id === layer.id)) {
        throw new Error(`Overlay layer ${layer.id} is registered twice`);
      }
      layers.push({ order: 50, ...layer });
      layers.sort((a, b) => a.order - b.order);
      return () => layers.splice(layers.findIndex(item => item.id === layer.id), 1);
    },
    layers: () => layers.map(layer => layer.id),
    render() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      element.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
      const frame = { width, height };
      element.innerHTML = layers.map(layer => layer.render?.(frame) ?? '').join('');
      for (const layer of layers) layer.after?.(frame);
    },
  };
}
