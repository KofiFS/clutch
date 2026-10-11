import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.mjs'
import { users } from './db.mjs'

/** Stripe over plain REST (no SDK): Checkout for new subscriptions, the Billing Portal to manage them. */
async function stripe(path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
  const j = await r.json()
  if (!r.ok) throw Object.assign(new Error(j.error?.message ?? `Stripe ${r.status}`), { status: 502 })
  return j
}

export const billingEnabled = () => !!(config.stripe.secretKey && config.stripe.priceId)

export async function checkoutUrl(user) {
  const s = await stripe('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': config.stripe.priceId,
    'line_items[0][quantity]': '1',
    client_reference_id: user.id,
    'subscription_data[metadata][user_id]': user.id,
    ...(user.stripe_customer ? { customer: user.stripe_customer } : user.email ? { customer_email: user.email } : {}),
    success_url: `${config.publicUrl}/billing/done?ok=1`,
    cancel_url: `${config.publicUrl}/billing/done?ok=0`,
    allow_promotion_codes: 'true'
  })
  return s.url
}

export async function portalUrl(user) {
  if (!user.stripe_customer) throw Object.assign(new Error('No subscription yet'), { status: 400 })
  const s = await stripe('billing_portal/sessions', { customer: user.stripe_customer, return_url: `${config.publicUrl}/billing/done?ok=1` })
  return s.url
}

/** Verify Stripe's signature header (t=..., v1=...) over the raw body. */
export function verifyWebhook(raw, header) {
  if (!config.stripe.webhookSecret || !header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')))
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false
  const expected = createHmac('sha256', config.stripe.webhookSecret).update(`${parts.t}.${raw}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(parts.v1))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Keep each user's plan in step with their subscription. */
export function handleEvent(evt) {
  const o = evt.data?.object ?? {}
  if (evt.type === 'checkout.session.completed' && o.client_reference_id) {
    users.setPlan(o.client_reference_id, 'pro', { customer: o.customer, subscription: o.subscription })
    return 'pro'
  }
  if (evt.type === 'customer.subscription.updated' || evt.type === 'customer.subscription.deleted') {
    const u = users.byCustomer(o.customer) ?? (o.metadata?.user_id ? users.get(o.metadata.user_id) : null)
    if (!u) return 'unknown customer'
    const active = evt.type === 'customer.subscription.updated' && ['active', 'trialing', 'past_due'].includes(o.status)
    users.setPlan(u.id, active ? 'pro' : 'free', { until: active && o.current_period_end ? o.current_period_end * 1000 + 3 * 86400_000 : null, customer: o.customer, subscription: o.id })
    return active ? 'pro' : 'free'
  }
  return 'ignored'
}
