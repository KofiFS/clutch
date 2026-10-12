/**
 * The plain background everything sits on: one neutral dark colour, no light splashes or grid,
 * so the content (and the accent colour on buttons and the recording state) stands out.
 * Also defines the SVG lens filter some older styles reference.
 */
export function Backdrop(_props: { live?: boolean }) {
  return (
    <>
      <div aria-hidden className="cf-base fixed inset-0 -z-10 pointer-events-none" style={{ background: 'var(--color-bg)' }} />
      <svg aria-hidden width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="cf-liquid" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    </>
  )
}
