/**
 * What each plan includes. The server enforces storage, per-clip size and link retention;
 * the desktop app reads `features` to show or unlock the rest.
 * Recording, triggers, editing, Discord and manual YouTube uploads are free and local, always.
 */
const GB = 1024 ** 3
const MB = 1024 ** 2

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    storageBytes: 2 * GB,
    maxClipBytes: 100 * MB,
    linkDays: 30,
    features: {
      shareLinks: true,
      cloudBackup: false,
      autoUploadSlots: 1,
      autoUploadPlatforms: 1,
      adFree: false,
      smartReadsPerDay: 3
    }
  },
  pro: {
    id: 'pro',
    name: 'Clutch Pro',
    priceMonthly: 4.99,
    storageBytes: 100 * GB,
    maxClipBytes: 1024 * MB,
    linkDays: 0, // never expire
    features: {
      shareLinks: true,
      cloudBackup: true,
      autoUploadSlots: 12,
      autoUploadPlatforms: 3,
      adFree: true,
      smartReadsPerDay: 25
    }
  }
}

export const planOf = (user) => PLANS[user?.plan === 'pro' && (!user.plan_until || user.plan_until > Date.now()) ? 'pro' : 'free']
