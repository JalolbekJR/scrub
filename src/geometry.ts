// Client coordinates already account for zoom, CSS transforms and DPR. Use
// the same measured rectangle in both directions; integer clientWidth loses
// fractional layout pixels and does not include CSS scaling.
export function pointToCanvas(
  clientX: number, clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  width: number, height: number,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) throw new Error('Canvas is not visible');
  return {
    x: Math.max(0, Math.min(width, (clientX - rect.left) * width / rect.width)),
    y: Math.max(0, Math.min(height, (clientY - rect.top) * height / rect.height)),
  };
}
