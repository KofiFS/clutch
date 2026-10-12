/** Scroll to a setting on the current page and briefly highlight it. */
export function revealText(text: string) {
  const want = text.toLowerCase()
  const candidates = [...document.querySelectorAll('main h2, main .label, main label span.text-sm, main .text-sm.font-semibold')]
  const el = candidates.find((n) => (n.textContent ?? '').trim().toLowerCase() === want) ?? candidates.find((n) => (n.textContent ?? '').trim().toLowerCase().startsWith(want))
  if (!el) return false
  const box = el.closest('.card-2, section, label, div.space-y-3') ?? el
  box.scrollIntoView({ block: 'center', behavior: 'smooth' })
  box.classList.remove('search-flash')
  void (box as HTMLElement).offsetWidth
  box.classList.add('search-flash')
  setTimeout(() => box.classList.remove('search-flash'), 1800)
  return true
}

/** Keep trying for a moment while the page renders, then reveal. */
export function revealWhenReady(text: string) {
  let tries = 0
  const attempt = () => { if (!revealText(text) && ++tries < 12) setTimeout(attempt, 120) }
  setTimeout(attempt, 150)
}
