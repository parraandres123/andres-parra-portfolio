# Stripe checkout setup

The site publishes only the generated `site` directory. Personal files elsewhere in the project folder are not included in the Netlify site.

## Netlify

1. Connect the project to Netlify and use the repository/project root as the base directory. `netlify.toml` builds the public site from `index.html`, `images`, and `fonts`, and deploys the checkout function separately.
2. In Netlify environment variables, set `STRIPE_SECRET_KEY` to a Stripe **test** secret key first. Never put this key in `index.html` or commit it.
3. Create an active EUR price in Stripe for Tooshie and set it as `STRIPE_PRICE_P1`. It must be exactly **€20.00**; the server verifies this before showing the live price and before creating checkout. Browser-submitted amounts are never used to charge a customer.
4. Create a Stripe shipping rate in EUR that covers the destinations and cost you can fulfill. Set its ID as `STRIPE_SHIPPING_RATE_ID`.
5. Set `STRIPE_SHIPPING_COUNTRIES` to a comma-separated list of ISO 3166-1 alpha-2 country codes you actually ship to (for example `ES,FR,US`). Checkout collects billing address, shipping address, and phone number.
6. Enable the payment methods you want in Stripe Dashboard. Checkout uses Stripe's configured dynamic payment methods; availability varies by customer location and currency.
7. Test a complete order with Stripe test mode before switching to live keys and live Price IDs.

Tooshie displays at €20, but secure checkout for it remains disabled until its Stripe Price ID and the shipping configuration are set. A single shipping rate applies the same configured charge to every allowed destination; configure country-specific rates before launch if shipping costs vary. Stripe only accepts supported shipping countries, so include every destination you can actually serve. Taxes, customs duties, order notifications, and fulfillment workflows are not configured by this integration.
