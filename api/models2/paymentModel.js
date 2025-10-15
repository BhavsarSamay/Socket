const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
            required: false,
        },
        booking_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "bookings",
            required: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        status: {
            type: Number, // 1 = success, 2 = pending, 3 = failed
            default: 1,
        },
        transaction_id: {
            type: String,
            default: "",
        },
        payment_method: {
            type: String,
            default: "",
        },
        payment_date: {
            type: Date,
        },
        payment_url: {
            type: String,
            default: "",
        }
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Payment", PaymentSchema);
