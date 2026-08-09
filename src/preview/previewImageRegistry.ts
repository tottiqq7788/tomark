export interface PreviewImageContext {
  originalSrc: string;
  dataUrl: string;
  bytes?: Uint8Array;
  mimeType: string;
  sourceLine: number | null;
}

const registry = new WeakMap<HTMLElement, PreviewImageContext>();

export function registerPreviewImage(
  wrapper: HTMLElement,
  context: PreviewImageContext,
): void {
  registry.set(wrapper, context);
}

export function unregisterPreviewImage(wrapper: HTMLElement): void {
  registry.delete(wrapper);
}

export function getPreviewImageContext(
  wrapper: HTMLElement,
): PreviewImageContext | null {
  return registry.get(wrapper) ?? null;
}

export function resolvePreviewImageFromTarget(
  target: EventTarget | null,
): { wrapper: HTMLElement; context: PreviewImageContext } | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const wrapper = target.closest(
    ".preview-image[data-preview-image='1']",
  ) as HTMLElement | null;
  if (!wrapper || wrapper.hasAttribute("data-preview-image-error")) {
    return null;
  }
  const context = registry.get(wrapper);
  if (!context) {
    return null;
  }
  return { wrapper, context };
}
