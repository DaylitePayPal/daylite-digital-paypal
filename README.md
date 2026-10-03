# Storefront material (Daylite-authored only)

This folder is **not required** to run the PayPal AI Hackathon 2026 application in the repository root. It records the original Daylite storefront context using only material that is Daylite's own.

## What is here

| File | What it is |
|---|---|
| `snippets/accomo-provider-styles.liquid` | Daylite styling for the accommodation-provider information page (CSS only, `dds-` classes, Daylite palette) |
| `snippets/provider-application-overrides.liquid` | Daylite CSS/JS for the provider-application page (hides unused purchase controls and relabels the button "SEND APPLICATION NOW") |
| `daylite-storefront-copy.md` | The Daylite home-page wording, rewritten for this submission |

The two snippets are byte-for-byte as supplied. They are designed for a Shopify product page and do nothing on their own.

## What is deliberately not here

- **The Shopify Atelier theme.** The storefront was built on Shopify's Atelier theme (3.5.1). Its redistribution licence could not be established, so none of its code is published.
- Theme configuration and template files that mix Atelier structure with Daylite settings, and two Shopify-AI-generated blocks (provenance of tool output not established).
- Images and other binary assets.
- Original storefront copy that described live international operations, a conservation partnership and a Shopify-processed service fee. These statements are not part of this submission and are not substantiated by it.

## Daylite brand choices (reused by `public/styles.css`)

| Choice | Value |
|---|---|
| Deep forest green | `#1a2e22` |
| Gold | `#d4af37` (hover `#e6c547`) |
| Cream text | `#f4f1ea` |
| Heading font | Cormorant Garamond |
| Body font | Inter |

See `../docs/THIRD_PARTY_NOTICES.md` for licensing.
