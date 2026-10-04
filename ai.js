# Copy this file to .env and fill in your own values. Never commit .env.
# All values below are placeholders, not real credentials.

# --- Server ---
PORT=3000
# Set to 1 only when running behind a trusted reverse proxy (affects client IP for rate limiting)
TRUST_PROXY=0

# --- PayPal (SANDBOX ONLY) ---
# Create a Sandbox REST app at https://developer.paypal.com/dashboard/applications/sandbox
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-client-secret

# --- Google Gemini ---
# Create a key in Google AI Studio: https://aistudio.google.com/apikey
GEMINI_API_KEY=AQ.Ab8RN6KcIM2R1TLugDkIzFniIWoDyCfHoyEWfvDqXNY8BWL11Q
# Model is configurable; verify the current model name in Google's documentation.
GEMINI_MODEL=gemini-3.1-flash-lite

# --- Limits (optional) ---
AI_RATE_LIMIT_PER_MINUTE=10
CHECKOUT_RATE_LIMIT_PER_MINUTE=30
