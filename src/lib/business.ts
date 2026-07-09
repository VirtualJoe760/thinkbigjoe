// Single source of truth for the business identity shown on the public legal / contact
// pages. The public brand is ThinkBigJoe — the legal LLC name is NOT displayed on the
// site (it's entered directly in the Twilio A2P Brand registration instead).
// Edit here to update every legal page at once.

export const BUSINESS = {
  brand: "ThinkBigJoe",
  dba: "ThinkBigJoe",
  site: "thinkbigjoe.com",
  siteUrl: "https://thinkbigjoe.com",
  email: "joe@thinkbigjoe.com",
  phone: "(480) 764-2121",
  phoneHref: "+14807642121",
  address: "Palm Desert, CA 92260", // TODO: confirm the mailing address to show
  effectiveDate: "July 9, 2026",
} as const;
