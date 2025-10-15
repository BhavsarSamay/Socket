
const axios = require("axios");
const Payment = require("../../models2/paymentModel");
const BookingModel = require("../../models2/bookingModel");
const Helper = require("../../helper/helper");
const path = require("path");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


const PAYMENT_STATUS = {
    SUCCESS: 1,
    PENDING: 2,
    FAILED: 3,
};


exports.createPaymentLink = async (data) => {
    try {
        let { user_id, booking_id, amount, time } = data;

        // Check for existing pending Stripe payment
        let existingPayment = await Payment.findOne({
            user_id,
            booking_id,
            status: PAYMENT_STATUS.PENDING,
            payment_method: "Stripe",
        });

        if (existingPayment) {
            // ⚡ With Stripe, you don’t "check status" like Xendit invoices.
            // Instead, the Checkout Session or Payment Link URL can be reused until paid.
            return existingPayment.payment_url;
        }

        // Create payment record in DB
        const payment = await Payment.create({
            user_id,
            booking_id,
            amount,
            status: PAYMENT_STATUS.PENDING,
            payment_method: "Stripe",
        });

        // ✅ Option 1: Use Checkout Session (recommended)
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: `Booking #${booking_id}`,
                        },
                        unit_amount: amount * 100, // Stripe expects amount in cents
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `${process.env.STRIPE_SUCCESS_URL}${payment._id}`,
            cancel_url: process.env.STRIPE_FAILURE_URL,
            expires_at: Math.floor(Date.now() / 1000) + (time ? time : 86400), // expiration
        });

        // Save transaction_id & URL
        payment.payment_url = session.url;
        payment.transaction_id = session.id;
        await payment.save();

        return session.url; // send this back to frontend
    } catch (err) {
        console.error("Stripe createPaymentLink error:", err.stack || err.message);
    }
};


exports.handleStripeWebhook = async (req, res) => {
    console.log("reached")
    console.log("Request Headers", req.headers)
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    console.log("Signature", sig);
    console.log("Endpoint Secret", endpointSecret);

    let event;

    try {
        // ✅ Verify webhook signature (req.body must be raw string, not parsed JSON)
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error("⚠️ Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {

        const data = event.data.object;
        const sessions = await stripe.checkout.sessions.list({
            payment_intent: data.id,
            limit: 1,
        });
        let transaction_id = sessions.data[0].id;
        console.log("sessions", sessions)

        switch (event.type) {
            case "payment_intent.created":
                console.log(`PaymentIntent created: ${data.id}`);
                const pendingPayment = await Payment.findOne({ transaction_id: transaction_id });
                // Optionally: create a record in your DB as "PENDING"
                // await Payment.create({
                //     transaction_id: data.id,
                //     amount: data.amount / 100, // stripe gives amount in cents
                //     currency: data.currency,
                //     status: PAYMENT_STATUS.PENDING,
                //     payment_date: new Date(),
                // });
                if (pendingPayment) {
                    // pendingPayment.status = PAYMENT_STATUS.PENDING;
                    // pendingPayment.payment_date = new Date();
                    // pendingPayment.payment_method = "Stripe";
                    // await pendingPayment.save();
                    // console.log("✅ Payment marked as PENDING:", pendingPayment._id);
                }
                break;

            case "payment_intent.succeeded":
                console.log(`PaymentIntent succeeded: ${data}`);
                const paymentIntent = event.data.object;
                const sessions = await stripe.checkout.sessions.list({
                    payment_intent: paymentIntent.id,
                    limit: 1,
                });

                const succeededPayment = await Payment.findOne({ transaction_id: transaction_id });
                if (succeededPayment) {
                    succeededPayment.status = PAYMENT_STATUS.SUCCESS;
                    succeededPayment.payment_date = new Date();
                    succeededPayment.payment_method = "Stripe";
                    let saved = await succeededPayment.save();

                }
                break;

            case "payment_intent.payment_failed":
                console.log(`PaymentIntent failed: ${data.id}`);
                const failedPayment = await Payment.findOne({ transaction_id: transaction_id });
                if (failedPayment) {
                    failedPayment.status = PAYMENT_STATUS.FAILED;
                    failedPayment.payment_date = new Date();
                    await failedPayment.save();
                    console.log("❌ Payment marked as FAILED:", failedPayment._id);
                }
                break;

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.error("Stripe webhook processing error:", err.stack || err.message);
        res.status(500).json({ message: "Webhook processing error", error: err.message });
    }
};

exports.check_payment = async (req, res, next) => {
    try {
        let { id } = req.params;

        let check_payment = await Payment.findOne({ _id: id });

        if (!check_payment) {
            return res.status(202).json({
                message: "inprogress",
            });
        }

        if (check_payment.status == 1) {
            return res.status(200).json({
                message: "Payment completed successfully!",
                status: 200,
                booking_id: check_payment.booking_id,
            });
        } else if (check_payment.status == 2) {
            return res.status(202).json({
                message: "inprogress",
                status: 202,
            });
        } else {
            return res.status(402).json({
                message: "Payment failed. Please try again.",
                status: 402,
            });
        }
    } catch (error) {
        next(error);
    }
};