Daylite Digital — PayPal AI Hackathon 2026

Daylite Digital is a digital business solution developed by Southern Cross Stars Investments CC, a member of Southern Cross Stars Group, from Namibia.

This repository contains the PayPal AI Hackathon 2026 demonstration of Daylite Digital's travel and accommodation commerce concept, including AI-assisted discovery and PayPal Sandbox checkout.

What this demonstration shows

The application demonstrates a controlled commerce flow:

AI discovery → controlled catalogue → server-authoritative pricing → PayPal Sandbox payment → verified confirmation

The catalogue contains demonstration experiences from Namibia and international destinations. The data is intentionally static for this submission and does not represent live inventory, live availability or live reservations.

PayPal integration

PayPal is integrated through the PayPal Orders API and PayPal JavaScript SDK.

The payment flow is designed so that:

the browser submits an experience ID and traveller count;
the server retrieves the experience and calculates the authoritative total;
the PayPal order is created using the server-calculated amount;
the payment is captured through the server;
the captured payment is verified against the server-side checkout record;
the confirmation displays the booking reference and payment identifiers returned by the server.

PayPal-specific integration logic is kept in paypal.js.

All payments in this demonstration use the PayPal Sandbox. No real customer payments are processed by this repository.

AI-assisted discovery

The AI component uses the Google Gemini API to match a traveller's request against the server-side catalogue.

The model does not determine:

experience prices;
currencies;
catalogue names;
catalogue descriptions;
inventory;
payment amounts.

The server remains the source of truth for catalogue data and pricing. AI output is restricted to recommendations and explanatory reasons derived from the available catalogue.

The AI integration is implemented in ai.js.

Security and architecture

The demonstration is designed around a server-authoritative payment model.

Key principles include:

prices are calculated on the server;
the browser does not determine the payment amount;
dynamic user-facing content is rendered without treating user input as trusted HTML;
payment capture is handled server-side;
checkout references are attached to PayPal orders;
AI requests are made server-side;
API credentials are kept out of the browser;
PayPal credentials and other secrets are supplied through environment variables.

The main server implementation is in server.js.

Repository structure
File	Purpose
server.js	Main HTTP server and API routes
app.js	Browser-side application logic
index.html	Demonstration storefront interface
catalog.js	Server-side demonstration catalogue and pricing
paypal.js	PayPal integration
ai.js	Gemini recommendation matching
security.js	Security-related helpers
service.js	Application services
errors.js	Application error handling
flow.test.js	Application flow tests
http.test.js	HTTP/API tests
styles.css	Storefront styling
docs/SETUP.md	Installation, testing and Sandbox setup
PAYPAL_CASE_STUDY.md	Background and practical motivation
THIRD_PARTY_NOTICES.md	Third-party software and provenance notices
.env.example	Environment-variable template
Getting started

See docs/SETUP.md for:

prerequisites;
installation;
environment configuration;
running the application;
running tests;
PayPal Sandbox configuration;
troubleshooting.
Testing

The repository includes automated tests for application flows and HTTP/API behaviour.

The setup documentation distinguishes between tests that can be run locally and PayPal Sandbox checks that require configured credentials.

See docs/SETUP.md.

Demonstration status

This repository is a hackathon demonstration, not a claim of live commercial operation.

It does not provide:

live accommodation inventory;
live travel inventory;
live reservation availability;
live international operations;
real-money payment processing.

The catalogue data is demonstration data and PayPal payments are processed in Sandbox.

Daylite Digital and the Ambassador Programme

Daylite Digital is presented as the digital commerce layer of the broader Daylite ecosystem.

The Daylite Ambassador Programme provides a human participation and commercial distribution layer around the digital platform.

This repository focuses specifically on the Daylite Digital commerce demonstration and its PayPal/AI integration.

Case study

The PAYPAL_CASE_STUDY.md documents the practical motivation behind exploring accessible payment infrastructure for a small cross-border digital business.

It distinguishes reported communications from PayPal's written final notice and does not claim that the account experience established a particular cause for the deactivation.

Third-party notices

See THIRD_PARTY_NOTICES.md for information about third-party software, services, fonts and the provenance of material included or excluded from this repository.

Licence

This repository is released under the MIT License. See LICENSE.
