/** BCA's 16px flag PNG, shown at its native size so it stays crisp. Decorative: the currency code is always next to it. */
export function Flag({ src }: { src?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={16} height={16} className="inline-block shrink-0 rounded-[2px]" /> : null;
}
