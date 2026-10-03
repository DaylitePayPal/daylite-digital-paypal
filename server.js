import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  Client,
  Environment,
  OrdersController,
  CheckoutPaymentIntent
} from "@paypal/paypal-server-sdk";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

/*
 * PayPal configuration
 *
 * PAYPAL_ENVIRONMENT=sandbox
 * keeps development/testing separate from any production account.
 */
const paypalEnvironment =
  process.env.PAYPAL_ENVIRONMENT === "production"
    ? Environment.Production
    : Environment.Sandbox;

const paypalClient = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID,
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET
  },
  environment: paypalEnvironment
});

const ordersController = new OrdersController(paypalClient);

/*
 * Demo catalogue
 *
 * The browser does not decide the final price.
 * The server maps the selected item to a known price.
 */
const products = {
  "daylite-demo-stay": {
    name: "Daylite Accommodation Demo",
    description: "Demonstration travel accommodation booking",
    amount: "25.00",
    currency: "USD"
  }
};

/*
 * Health/status endpoint
 */
app.get("/api/status", (req, res) => {
  res.json({
    application: "Daylite Digital",
    programme: "Daylite Ambassador Programme",
    paypalEnvironment:
      process.env.PAYPAL_ENVIRONMENT || "sandbox",
    paypalConfigured:
      Boolean(
        process.env.PAYPAL_CLIENT_ID &&
        process.env.PAYPAL_CLIENT_SECRET
      ),
    status: "running"
  });
});

/*
 * PayPal configuration for the frontend.
 *
 * The client ID is safe to expose to the browser.
 * The client secret NEVER leaves this server.
 */
app.get("/api/config", (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    return res.status(500).json({
      error: "PayPal client ID is not configured."
    });
  }

  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID,
    environment:
      process.env.PAYPAL_ENVIRONMENT || "sandbox"
  });
});

/*
 * Create PayPal order
 */
app.post("/api/orders", async (req, res) => {
  try {
    const itemId = req.body?.itemId || "daylite-demo-stay";
    const product = products[itemId];

    if (!product) {
      return res.status(400).json({
        error: "Unknown Daylite product."
      });
    }

    const response = await ordersController.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            description: product.description,
            amount: {
              currencyCode: product.currency,
              value: product.amount
            }
          }
        ]
      },
      prefer: "return=minimal"
    });

    const order = response.result;

    if (!order?.id) {
      return res.status(502).json({
        error: "PayPal did not return an order ID."
      });
    }

    res.json({
      id: order.id,
      status: order.status,
      item: product.name,
      amount: product.amount,
      currency: product.currency
    });
  } catch (error) {
    console.error("PayPal create order error:", error);

    res.status(500).json({
      error: "Unable to create PayPal order.",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
});

/*
 * Capture approved PayPal order
 */
app.post("/api/orders/:orderId/capture", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    if (!orderId) {
      return res.status(400).json({
        error: "PayPal order ID is required."
      });
    }

    const response = await ordersController.captureOrder({
      id: orderId
    });

    const capture = response.result;

    res.json(capture);
  } catch (error) {
    console.error("PayPal capture error:", error);

    res.status(500).json({
      error: "Unable to capture PayPal order.",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
});

/*
 * Serve the existing Daylite Digital frontend.
 *
 * Express 5 catch-all route.
 */
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(
    `Daylite Digital PayPal server running on port ${PORT}`
  );
});
