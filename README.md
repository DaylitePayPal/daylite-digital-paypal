Daylite Digital + Daylite Ambassador Programme

Built in Africa for international markets.

A Southern Cross Stars Investments digital-commerce build demonstrating how payment infrastructure, AI and human commercial participation can be connected through an African travel and accommodation ecosystem.

About

Southern Cross Stars Investments, a member of Southern Cross Stars Group, is developing digital business solutions designed to connect African commercial activity with international digital markets.

Daylite Digital is the concrete commercial system used in this build.

The wider issue is not limited to tourism. Africans participate in the digital economy as entrepreneurs, creators, service providers, tourism businesses, accommodation providers and other commercial participants. Access to reliable digital-commerce and payment infrastructure can affect whether that economic activity can participate effectively in international markets.

Daylite provides one practical example of that problem.

The Daylite ecosystem
Daylite Digital

Daylite Digital is the travel and accommodation commerce layer.

It is designed to connect customers, accommodation providers and digital commerce through an international-facing marketplace.

Daylite Ambassador Programme

The Daylite Ambassador Programme is the human participation and commercial distribution layer.

Daylite Ambassadors can promote qualifying accommodation opportunities and participate in the commercial distribution of the platform.

The programme's commission structure can reach 6.5%, subject to programme rules and successful qualifying transactions.

Daylite Accommodation Provider

The Daylite Accommodation Provider service provides a participation pathway for accommodation businesses entering the Daylite marketplace.

Daylite Ambassador Hub

The Daylite Ambassador Hub is the structured environment for developing, supporting and coordinating Daylite Ambassadors.

These components are distinct but connected.

Why PayPal?

International payment infrastructure is a critical part of digital commerce.

This build investigates how PayPal developer technology can be incorporated into an African commerce system while also examining the practical country and account constraints that developers can encounter.

PayPal's current developer documentation illustrates an important distinction:

South Africa is listed by PayPal's seller-onboarding documentation with receiving capabilities.
Namibia is listed as Send only in that same seller-onboarding documentation.
PayPal's REST API country-code documentation separately lists both South Africa (ZA) and Namibia (NA) among countries supported by its APIs.

This means that API availability and merchant/payment capabilities should not be assumed to be identical across countries.

Sources:

PayPal Developer — Seller onboarding: https://developer.paypal.com/platforms/seller-onboarding/
PayPal Developer — Country codes: https://developer.paypal.com/api/codes/country-region/
The real-world payment-access case study

This repository also documents a real payment-access problem encountered while developing Daylite.

The business/payment configuration involved a South African business, including South African identity and banking information. Development was being carried out physically from Namibia while the founder was studying.

There were no customer sales on the PayPal account at the time. Account activity included banking/linking verification.

During the account experience, PayPal communicated to the account holder that access from Windhoek, Namibia was an issue.

The subsequent permanent deactivation notice stated that PayPal was no longer offering services for the account and cited “unusual activity” as the reason.

This repository does not claim that physical location was formally determined by PayPal to be the sole cause of the deactivation. Instead, the repository separates:

what the account holder was told;
what PayPal's final notice stated;
the documented country-level payment capability differences; and
the technical questions that developers need to solve.

The objective is not to circumvent PayPal controls.

The objective is to understand how legitimate African businesses can build compliant international-commerce systems when business registration, banking, physical development location and payment-provider country capabilities do not necessarily align.

What this competition build demonstrates

The application is designed to demonstrate:

African travel and accommodation commerce;
human commercial distribution through the Daylite Ambassador Programme;
payment-provider integration architecture;
PayPal developer tooling and testing;
AI-assisted functionality;
separation of production payment credentials from development/testing;
country-aware payment capability analysis;
transparent documentation of payment-access constraints.
PayPal implementation

The repository will clearly distinguish between:

Production account experience

The real-world account described in the case study is documented as evidence of the payment-access problem.

No private account credentials, banking information, personal addresses, passwords or authentication secrets are included in this repository.

Development and testing

PayPal Sandbox and/or other official PayPal developer tooling will be used for technical testing where applicable.

Production credentials must never be committed to this repository.

Environment variables should be used for secrets.

Example:

PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENVIRONMENT=sandbox

Never place real credentials inside source code.

AI

AI is treated as a functional component of the application rather than simply a marketing claim.

The AI layer will be documented with:

the model/service used;
the purpose of the AI component;
the inputs provided to the model;
the outputs produced;
how the output is used by the application;
limitations and safeguards.

The final repository will identify the exact AI technology used rather than claiming integrations that were not actually implemented.

Technology

The implementation will document the actual technologies used in the final build.

The initial application layer is a lightweight web interface using:

HTML
CSS
JavaScript
GitHub
PayPal developer tooling
PayPal Sandbox where applicable
AI tooling/services actually used in the final implementation

Additional sponsor integrations will only be listed if they are genuinely implemented and testable.

Repository structure

The repository is being developed around the following logical components:

daylite-digital-paypal/
│
├── index.html
├── README.md
├── LICENSE
│
├── daylite-digital/
│
├── daylite-ambassador-programme/
│
├── paypal/
│
├── ai/
│
└── docs/

The structure may evolve as implementation progresses.

Setup
Requirements

A modern web browser is sufficient to view the initial frontend.

For the full PayPal/AI development environment, the required runtime, dependencies and environment variables will be documented here as those components are implemented.

Basic frontend

Clone the repository:

git clone https://github.com/DaylitePayPal/daylite-digital-paypal.git

Enter the directory:

cd daylite-digital-paypal

Open:

index.html

in a modern browser.

Security

Do not commit:

PayPal client secrets;
API keys;
access tokens;
passwords;
private banking information;
personal identity documents;
private customer information.

Use environment variables for credentials.

Example:

.env

must remain excluded from version control when it contains secrets.

Competition purpose

This repository is the public technical record for the PayPal AI Hackathon submission.

It is intended to allow judges to:

inspect the source;
understand the architecture;
understand how PayPal is used;
understand how AI is used;
reproduce the development/test environment where applicable;
understand the real-world payment-access problem that motivated part of the build.

The repository will continue to be updated as the implementation develops.

Identity

Southern Cross Stars Investments
Member of Southern Cross Stars Group

Daylite Digital
Travel and accommodation commerce platform

Daylite Ambassador Programme
Human participation and commercial distribution layer

Daylite Ambassador Hub
Ambassador development and support environment

Daylite Accommodation Provider
Accommodation-provider participation service

Geographic identity

Made in Africa, a proudly Namibian service.

International ambition

Built in Africa for international markets.

License

This repository will use an OSI-approved open-source license appropriate to the competition requirements.

The final license will be added to the repository before submission.
