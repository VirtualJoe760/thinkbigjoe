// Single source of truth for the business identity shown on the public legal / contact
// pages. These must match the A2P 10DLC Brand registration in Twilio (legal entity +
// contact info) — carriers cross-check the website against the registered brand.
// Edit here to update every legal page at once.

export const BUSINESS = {
  brand: "ThinkBigJoe",
  legalEntity: "JPS & Company LLC", // the registered A2P Brand (same EIN as chatRealty)
  dba: "JPS & Company LLC, d/b/a ThinkBigJoe",
  site: "thinkbigjoe.com",
  siteUrl: "https://thinkbigjoe.com",
  email: "joe@thinkbigjoe.com",
  phone: "(480) 764-2121",
  phoneHref: "+14807642121",
  address: "Palm Desert, CA 92260", // TODO: confirm the mailing address on file for the entity
  effectiveDate: "July 9, 2026",
} as const;
