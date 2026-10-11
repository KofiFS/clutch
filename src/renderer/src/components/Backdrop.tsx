/**
 * Static "wallpaper" the liquid-glass panels sit on: deep-space base, soft aurora light,
 * a faint HUD grid that fades out toward the edges, and the SVG lens filter used by `.liquid`.
 * Nothing here animates, so the GPU only blurs it once per layout, not every frame.
 */
export function Backdrop({ live = false }: { live?: boolean }) {
  return (
    <>
      <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        {/* Base */}
        <div className="cf-base absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 110%, #062033 0%, #040a16 45%, #03050b 100%)' }} />
        {/* Aurora light - the colour the glass picks up */}
        <div className="absolute -top-[25%] -left-[10%] w-[75vw] h-[80vh] cf-aurora rounded-full opacity-90" style={{ background: 'radial-gradient(closest-side, rgba(40,130,255,0.7), rgba(36,140,255,0) 70%)', filter: 'blur(40px)' }} />
        <div className="absolute top-[10%] right-[-15%] w-[65vw] h-[75vh] cf-aurora rounded-full opacity-80" style={{ background: 'radial-gradient(closest-side, rgba(0,215,205,0.55), rgba(0,210,200,0) 70%)', filter: 'blur(50px)' }} />
        <div className="absolute bottom-[-30%] left-[20%] w-[75vw] h-[75vh] cf-aurora rounded-full opacity-75" style={{ background: 'radial-gradient(closest-side, rgba(135,90,255,0.6), rgba(130,90,255,0) 70%)', filter: 'blur(60px)' }} />
        {/* Recording tint */}
        <div className="absolute inset-0 transition-opacity duration-700" style={{ opacity: live ? 1 : 0, background: 'radial-gradient(60% 50% at 15% 0%, rgba(79,227,255,0.16), transparent 70%)' }} />
        {/* HUD grid */}
        <div
          className="absolute inset-0 opacity-[0.22]"
          style={{
            backgroundImage: 'linear-gradient(rgba(140,210,255,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(140,210,255,0.16) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 80% 70% at 50% 40%, #000 20%, transparent 75%)'
          }}
        />
        {/* Vignette */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
      </div>

      {/* Lens filter for `.liquid`: a smooth displacement that bends the backdrop near the edges. */}
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
