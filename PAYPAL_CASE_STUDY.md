Case study: why accessible payment infrastructure matters to Daylite Digital

This document explains the practical motivation behind the project. It is a first-hand account written carefully: it separates what PayPal told the founder from what PayPal's final deactivation notice said, and it does not draw conclusions that the facts do not support. It contains no contact details, bank details, credentials or account identifiers.

Background

Daylite Digital is a digital business solution developed by Southern Cross Stars Investments CC, a member of Southern Cross Stars Group, from Namibia. It is presented here as a digital travel and accommodation commerce concept. Like many small digital businesses in the region, it needs a payment method that international customers already recognise and trust.

What happened
A PayPal account was established for a South African business.
South African identity and address information was used, and a South African bank account was linked.
The account had no customer sales.
There was bank-account verification and linking activity.
PayPal told the founder that logging in to the account from Windhoek, Namibia was an issue.
PayPal subsequently permanently deactivated the account.
The final PayPal notice cited unusual activity.
What is and is not established
Statement	Status
What PayPal told the founder: logging in to the account from Windhoek, Namibia was an issue	Reported — this is what PayPal communicated
What PayPal's final notice said: the permanent deactivation cited unusual activity	Stated in the notice
The final notice named the Windhoek login, or Namibia, as the reason	Not recorded here. This account of the final notice records only that it cited unusual activity
The account was deactivated because the login came from Namibia	Not established. The evidence does not show that Namibia itself caused the deactivation, and no causal link is claimed here
Why PayPal made its decision internally	Ref: PP-L-801185317640

This case study deliberately does not claim that the account was closed because of the founder's location. It records that a login location was raised as an issue and that the written reason for closure was unusual activity, and leaves the relationship between the two open.

Why this matters for the use case

The experience points to a general operational consideration for a small cross-border business: when a business's legal entity, bank account and the person operating it are in different places, it may be harder to predict how routine behaviour (such as logging in from where one lives and works) will be assessed by automated account-safety systems, and there may be little visibility into the outcome. This is a general consideration, not a finding about why this particular account was deactivated. For a travel commerce concept whose customers are international, losing a payment method with no sales history is a business-continuity problem, not just an inconvenience.

Daylite Digital's design response is practical rather than adversarial:

keep payment logic small, auditable and server-side, so that a payment provider can be swapped or added with limited change (paypal.js is the only PayPal-specific module);
verify every captured payment against server-side records, so reconciliation never depends on trusting the browser;
present payments in a way that is transparent to the traveller, with clear references (custom_id booking reference on the PayPal order);
build and test against the Sandbox first, so integration quality can be demonstrated without moving real money.
Position on PayPal

This is not a criticism of PayPal. Account-safety systems exist to protect customers and merchants, PayPal's reasons for its decision are not known to the founder beyond the notices received, and this project exists because PayPal's checkout and Orders API are a credible way for Daylite Digital's future customers to pay. The hackathon submission is an attempt to show that a small Namibian digital business can build a careful, secure PayPal integration.

The demonstration makes no claim about PayPal merchant availability in Namibia or any other country. Anyone planning to operate commercially should confirm current eligibility and terms directly with PayPal.
